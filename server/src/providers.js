// Conectores a los distintos proveedores de IA.
// - Anthropic (Claude): SDK oficial.
// - OpenAI y todos los compatibles (OpenRouter, Groq, Mistral, DeepSeek, xAI,
//   Together, Perplexity, Ollama): endpoint /chat/completions.
// - Google Gemini: API generateContent.
// Si falta la clave de un proveedor, la oficina funciona en "modo demo".
import Anthropic from '@anthropic-ai/sdk';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  // Herramientas de línea de comandos instaladas en tu computador: usan tu
  // sesión ya iniciada (suscripción), sin clave de API.
  'cli-codex': { label: 'Codex CLI (tu sesión de ChatGPT)', cli: true, bin: 'codex', command: 'codex exec --skip-git-repo-check --sandbox read-only -', keyUrl: 'https://github.com/openai/codex' },
  'cli-claude': { label: 'Claude Code (tu sesión de Claude)', cli: true, bin: 'claude', command: 'claude -p', keyUrl: 'https://code.claude.com/docs' },
  'cli-opencode': { label: 'OpenCode CLI', cli: true, bin: 'opencode', command: 'opencode run {prompt}', keyUrl: 'https://opencode.ai' },
  'cli-gemini': { label: 'Gemini CLI (tu cuenta de Google)', cli: true, bin: 'gemini', command: 'gemini', keyUrl: 'https://github.com/google-gemini/gemini-cli' },
};

/** Comando configurado para una CLI (editable en Ajustes). */
export function cliCommand(settings, provider) {
  return settings.cli?.[provider]?.command || PROVIDERS[provider].command;
}

/** Detecta qué CLIs están instaladas. */
export async function detectClis() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const out = {};
  await Promise.all(Object.entries(PROVIDERS).filter(([, p]) => p.cli).map(([id, p]) => new Promise((resolve) => {
    execFile(finder, [p.bin], { timeout: 4000 }, (err, stdout) => {
      out[id] = err ? null : stdout.toString().split(/\r?\n/)[0].trim();
      resolve();
    });
  })));
  return out;
}

/** ¿Hay credenciales para este proveedor? */
export function hasKey(settings, provider) {
  if (PROVIDERS[provider]?.cli) return Boolean(settings.cli?.[provider]?.enabled);
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
 * onDelta(fragmento): se llama con cada trozo de texto a medida que llega.
 */
export async function callModel(settings, { provider, model, system, messages, agent, effort = 'medium', onDelta }) {
  const live = settings.demoMode !== 'always' && hasKey(settings, provider);
  if (!live) {
    const text = await simulate({ agent, system, messages });
    if (onDelta) await typeOut(text, onDelta);
    return { text, simulated: true, provider, model };
  }
  const emit = onDelta || (() => {});
  let text;
  if (PROVIDERS[provider]?.cli) text = await callCli(settings, provider, system, messages, emit);
  else if (provider === 'anthropic') text = await callAnthropic(keyFor(settings, provider), model, system, messages, effort, emit);
  else if (provider === 'google') text = await callGemini(keyFor(settings, provider), model, system, messages, emit);
  else text = await callOpenAICompatible(provider, keyFor(settings, provider), model, system, messages, settings, emit);
  return { text, simulated: false, provider, model };
}

/** En modo demo, "escribe" el texto poco a poco para que se vea en vivo. */
async function typeOut(text, onDelta) {
  const parts = text.match(/\S+\s*/g) || [];
  for (let i = 0; i < parts.length; i += 3) {
    onDelta(parts.slice(i, i + 3).join(''));
    await new Promise((r) => setTimeout(r, 25));
  }
}

const anthropicClients = new Map();

async function callAnthropic(apiKey, model, system, messages, effort, onDelta) {
  if (!anthropicClients.has(apiKey)) anthropicClients.set(apiKey, new Anthropic({ apiKey }));
  const client = anthropicClients.get(apiKey);
  const params = {
    model,
    max_tokens: 32000,
    system,
    messages,
  };
  // Haiku 4.5 no admite `effort`; los modelos actuales sí.
  if (!model.includes('haiku')) params.output_config = { effort };

  // Si el modelo declina por seguridad, el servidor reintenta con otro modelo.
  const stream = /opus-5|fable/.test(model)
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : client.messages.stream(params);
  stream.on('text', (delta) => onDelta(delta));
  let response;
  try {
    response = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Anthropic: la clave de API no es válida.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Anthropic: límite de uso alcanzado, intenta en un momento.');
    if (err instanceof Anthropic.NotFoundError) throw new Error(`Anthropic: el modelo "${model}" no existe o no está disponible para tu cuenta.`);
    if (err instanceof Anthropic.APIError) throw new Error(`Anthropic (${err.status ?? 'red'}): ${err.error?.error?.message || err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('El modelo declinó esta petición por políticas de seguridad.');
  }
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

/** Lee un cuerpo SSE ("data: {...}") y entrega cada evento JSON. */
async function readSSE(res, onEvent) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue; // línea incompleta o de control
      }
      onEvent(event);
    }
  }
}

async function callOpenAICompatible(provider, apiKey, model, system, messages, settings, onDelta) {
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
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`${PROVIDERS[provider].label}: ${data.error?.message || res.statusText}`);
  }
  let text = '';
  await readSSE(res, (e) => {
    if (e.error) throw new Error(`${PROVIDERS[provider].label}: ${e.error.message || 'error'}`);
    const d = e.choices?.[0]?.delta?.content;
    if (d) {
      text += d;
      onDelta(d);
    }
  });
  return text;
}

async function callGemini(apiKey, model, system, messages, onDelta) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Gemini: ${data.error?.message || res.statusText}`);
  }
  let text = '';
  await readSSE(res, (e) => {
    const d = e.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
    if (d) {
      text += d;
      onDelta(d);
    }
  });
  return text;
}

/**
 * Protege un texto para cmd.exe: dentro de comillas dobles & | < > ^ son
 * literales; solo hay que evitar saltos de línea, comillas y la expansión %VAR%.
 */
function winQuote(text) {
  return `"${text.replace(/\r?\n/g, ' ').replace(/"/g, "'").replace(/%/g, ' por ciento ')}"`;
}

/** Divide un comando en argumentos respetando comillas; {prompt} va como un solo argumento. */
export function splitCommand(command, prompt) {
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return parts.map((p) => (p === '{prompt}' ? prompt : p.replace(/^["']|["']$/g, '')));
}

const CLI_DIR = path.join(os.tmpdir(), 'oficina-ias-cli');

/**
 * Ejecuta una CLI (Codex, Claude Code, OpenCode, Gemini…) con la conversación
 * como un único prompt. Se ejecuta en una carpeta temporal vacía para que no
 * toque tus proyectos.
 */
function callCli(settings, provider, system, messages, onDelta) {
  const convo = messages.map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`).join('\n\n');
  const prompt = `${system}\n\n---\n\n${convo}\n\nAsistente:`;
  const command = cliCommand(settings, provider);
  // Si el comando no tiene {prompt}, el prompt se envía por la entrada estándar.
  const viaArg = command.includes('{prompt}');
  const win = process.platform === 'win32';
  fs.mkdirSync(CLI_DIR, { recursive: true });
  // cmd.exe acepta ~8 mil caracteres y Linux ~128 mil por argumento: si el
  // prompt es más largo, va a un archivo que la herramienta lee.
  let argText = prompt;
  if (viaArg && (prompt.length > (win ? 6000 : 100000) || (win && /\r?\n/.test(prompt) && prompt.length > 1500))) {
    const file = path.join(CLI_DIR, `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`);
    fs.writeFileSync(file, prompt);
    argText = `Lee las instrucciones completas en el archivo ${path.basename(file)} de esta carpeta y respóndelas.`;
  }
  const argPrompt = viaArg && win ? winQuote(argText) : argText;
  const [cmd, ...args] = splitCommand(command, argPrompt);
  return new Promise((resolve, reject) => {
    // En Windows las CLIs de npm son .cmd y requieren la consola.
    const child = spawn(cmd, args, { cwd: CLI_DIR, shell: win, env: process.env });
    if (!viaArg) child.stdin.end(prompt);
    else child.stdin.end();
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
    child.stdout.on('data', (d) => {
      const t = d.toString();
      out += t;
      onDelta(t);
    });
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`${PROVIDERS[provider].label}: no pude ejecutar "${cmd}" (${e.code === 'ENOENT' ? 'no está instalado' : e.message})`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || out.trim()) resolve(out.trim());
      else reject(new Error(`${PROVIDERS[provider].label} terminó con código ${code}: ${err.slice(-400)}`));
    });
  });
}
