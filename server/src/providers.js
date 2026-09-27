// Conectores a los distintos proveedores de IA.
// - Anthropic (Claude): SDK oficial.
// - OpenAI y todos los compatibles (OpenRouter, Groq, Mistral, DeepSeek, xAI,
//   Together, Perplexity, Ollama): endpoint /chat/completions.
// - Google Gemini: API generateContent.
// Si falta la clave de un proveedor, la oficina funciona en "modo demo".
import Anthropic from '@anthropic-ai/sdk';
import { simulate } from './demo.js';

export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI (ChatGPT)', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  google: { label: 'Google (Gemini)', keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter (cientos de modelos)', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
  groq: { label: 'Groq (Llama, ultra rápido)', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  xai: { label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
  perplexity: { label: 'Perplexity (búsqueda web)', baseUrl: 'https://api.perplexity.ai', keyUrl: 'https://www.perplexity.ai/settings/api' },
  together: { label: 'Together AI (open source)', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.xyz/settings/api-keys' },
  ollama: { label: 'Ollama (local, gratis)', baseUrl: 'http://localhost:11434/v1', keyless: true, keyUrl: 'https://ollama.com/download' },
};

/** ¿Hay credenciales para este proveedor? */
export function hasKey(settings, provider) {
  if (PROVIDERS[provider]?.keyless) return Boolean(settings.apiKeys?.ollamaEnabled);
  return Boolean(settings.apiKeys?.[provider] || envKey(provider));
}

function envKey(provider) {
  const names = {
    anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY', groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY', xai: 'XAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY',
    together: 'TOGETHER_API_KEY',
  };
  return names[provider] ? process.env[names[provider]] : undefined;
}

function keyFor(settings, provider) {
  return settings.apiKeys?.[provider] || envKey(provider);
}

/**
 * Llama a un modelo. Devuelve { text, simulated, provider, model }.
 * messages: [{ role: 'user' | 'assistant', content: string }]
 */
export async function callModel(settings, { provider, model, system, messages, agent, effort = 'medium' }) {
  const live = settings.demoMode !== 'always' && hasKey(settings, provider);
  if (!live) {
    const text = await simulate({ agent, system, messages });
    return { text, simulated: true, provider, model };
  }
  let text;
  if (provider === 'anthropic') text = await callAnthropic(keyFor(settings, provider), model, system, messages, effort);
  else if (provider === 'google') text = await callGemini(keyFor(settings, provider), model, system, messages);
  else text = await callOpenAICompatible(provider, keyFor(settings, provider), model, system, messages, settings);
  return { text, simulated: false, provider, model };
}

const anthropicClients = new Map();

async function callAnthropic(apiKey, model, system, messages, effort) {
  if (!anthropicClients.has(apiKey)) anthropicClients.set(apiKey, new Anthropic({ apiKey }));
  const client = anthropicClients.get(apiKey);
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages,
  };
  // Haiku 4.5 no admite `effort`; los modelos actuales sí.
  if (!model.includes('haiku')) params.output_config = { effort };

  let response;
  if (/opus-5|fable/.test(model)) {
    // Si el modelo declina por seguridad, el servidor reintenta con otro modelo.
    response = await client.beta.messages.create({
      ...params,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } else {
    response = await client.messages.create(params);
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('El modelo declinó esta petición por políticas de seguridad.');
  }
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

async function callOpenAICompatible(provider, apiKey, model, system, messages, settings) {
  const base = provider === 'ollama' && settings.apiKeys?.ollamaUrl ? settings.apiKeys.ollamaUrl : PROVIDERS[provider].baseUrl;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:4747';
    headers['X-Title'] = 'Oficina de IAs';
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${PROVIDERS[provider].label}: ${data.error?.message || res.statusText}`);
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGemini(apiKey, model, system, messages) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini: ${data.error?.message || res.statusText}`);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
}
