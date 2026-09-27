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

// tier: 'gratis' (tiene plan gratis), 'mixto' (modelos gratis y de pago),
// 'suscripcion' (usa un plan que ya pagas) o 'pago' (cobra por uso).
export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', tier: 'pago', hint: 'Claude por API, se paga aparte del plan. Si ya tienes el plan de Claude, mejor usa Claude Code.', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI (ChatGPT)', tier: 'pago', hint: 'GPT por API. Si ya tienes ChatGPT, mejor usa Codex CLI.', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  google: { label: 'Google (Gemini)', tier: 'gratis', hint: 'Plan gratis con límites diarios. La clave se saca con tu cuenta de Google.', keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter (cientos de modelos)', tier: 'mixto', hint: 'Una sola clave para muchos modelos. Los que terminan en :free son gratis.', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
  groq: { label: 'Groq (Llama, ultra rápido)', tier: 'gratis', hint: 'Plan gratis y muy rápido (Llama, Qwen, Kimi, GPT-OSS).', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  cerebras: { label: 'Cerebras (gratis, ultra rápido)', tier: 'gratis', hint: 'Plan gratis con modelos abiertos (Llama, Qwen, GPT-OSS).', baseUrl: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai' },
  mistral: { label: 'Mistral', tier: 'gratis', hint: 'Plan gratis de prueba (Mistral Small, Codestral).', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  deepseek: { label: 'DeepSeek', tier: 'pago', hint: 'De pago, pero cuesta centavos.', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  xai: { label: 'xAI (Grok)', tier: 'pago', hint: 'Grok por API.', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
  perplexity: { label: 'Perplexity (búsqueda web)', tier: 'pago', hint: 'Respuestas con búsqueda web.', baseUrl: 'https://api.perplexity.ai', keyUrl: 'https://www.perplexity.ai/settings/api' },
  together: { label: 'Together AI (open source)', tier: 'pago', hint: 'Modelos abiertos; suele regalar créditos al empezar.', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.xyz/settings/api-keys' },
  ollama: { label: 'Ollama (local, gratis)', tier: 'gratis', hint: 'Modelos en tu propio computador, gratis y sin límite.', baseUrl: 'http://localhost:11434/v1', keyless: true, keyUrl: 'https://ollama.com/download' },
  // Herramientas de línea de comandos instaladas en tu computador: usan tu
  // sesión ya iniciada (suscripción), sin clave de API.
  'cli-codex': { label: 'Codex CLI (tu sesión de ChatGPT)', tier: 'suscripcion', hint: 'Usa tu cuenta de ChatGPT (incluso la gratis, con pocos usos).', cli: true, bin: 'codex', npm: '@openai/codex', login: 'codex login', homeEnv: 'CODEX_HOME', command: 'codex exec --skip-git-repo-check --sandbox read-only -', keyUrl: 'https://github.com/openai/codex' },
  'cli-claude': { label: 'Claude Code (tu sesión de Claude)', tier: 'suscripcion', hint: 'Usa tu plan Pro o Max de Claude.', cli: true, bin: 'claude', npm: '@anthropic-ai/claude-code', login: 'claude', homeEnv: 'CLAUDE_CONFIG_DIR', command: 'claude -p', keyUrl: 'https://code.claude.com/docs' },
  'cli-opencode': { label: 'OpenCode CLI', tier: 'gratis', hint: 'Programa gratis; trae modelos gratis o usa los tuyos.', cli: true, bin: 'opencode', npm: 'opencode-ai', login: 'opencode auth login', command: 'opencode run {prompt}', keyUrl: 'https://opencode.ai' },
  'cli-gemini': { label: 'Gemini CLI (tu cuenta de Google)', tier: 'gratis', hint: 'Gratis con tu cuenta de Google; con Gemini Pro tienes más usos.', cli: true, bin: 'gemini', npm: '@google/gemini-cli', login: 'gemini', command: 'gemini', keyUrl: 'https://github.com/google-gemini/gemini-cli' },
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
  return credentials(settings, provider).length > 0;
}

/**
 * Cuentas de un proveedor, en orden de uso: primero la elegida para la IA,
 * luego las demás. Si una cuenta se queda sin cupo, la oficina prueba con la
 * siguiente. Cada cuenta: { id, label, key } (APIs) o { id, label, home } (CLIs).
 */
export function credentials(settings, provider, accountId = null) {
  const def = PROVIDERS[provider];
  if (!def) return [];
  const extra = (settings.accounts || []).filter((a) => a.provider === provider && (def.cli ? a.home : a.key));
  const mainKey = keyFor(settings, provider);
  const main = def.cli || def.keyless
    ? [{ id: 'default', label: 'Principal', key: null, home: null }]
    : mainKey ? [{ id: 'default', label: 'Principal', key: mainKey }] : [];
  const all = [...main, ...extra];
  const i = all.findIndex((a) => a.id === accountId);
  if (i > 0) all.unshift(...all.splice(i, 1));
  return all;
}

/** ¿El error indica que la cuenta se quedó sin cupo? */
export const isQuotaError = (msg) => /\b429\b|quota|rate.?limit|l[ií]mite de uso|usage limit|limit reached|exhausted|too many requests|insufficient/i.test(String(msg));

function envKey(provider) {
  const names = {
    anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY', groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY', xai: 'XAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY',
    together: 'TOGETHER_API_KEY', cerebras: 'CEREBRAS_API_KEY',
  };
  return names[provider] ? process.env[names[provider]] : undefined;
}

function keyFor(settings, provider) {
  return settings.apiKeys?.[provider] || envKey(provider);
}

// Contador de uso (lo conecta el servidor para guardarlo en disco).
let usageSink = null;
export function setUsageSink(fn) {
  usageSink = fn;
}

/**
 * Llama a un modelo. Devuelve { text, simulated, provider, model }.
 * messages: [{ role: 'user' | 'assistant', content: string }]
 * onDelta(fragmento): se llama con cada trozo de texto a medida que llega.
 */
export async function callModel(settings, { provider, model, system, messages, agent, account, effort = 'medium', onDelta, signal }) {
  if (signal?.aborted) throw new Error('Cancelada');
  const live = settings.demoMode !== 'always' && hasKey(settings, provider);
  if (!live) {
    const text = await simulate({ agent, system, messages });
    if (signal?.aborted) throw new Error('Cancelada');
    if (onDelta) await typeOut(text, onDelta);
    return { text, simulated: true, provider, model };
  }
  const emit = onDelta || (() => {});
  const creds = credentials(settings, provider, account ?? agent?.account ?? null);
  let text;
  let used;
  for (let i = 0; i < creds.length; i++) {
    const cred = creds[i];
    // Tiempo límite de 10 minutos por llamada, y cancelable desde la interfaz.
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000);
    let wrote = false;
    const tap = (d) => {
      wrote = true;
      emit(d);
    };
    try {
      if (PROVIDERS[provider]?.cli) text = await callCli(settings, provider, system, messages, tap, sig, cred.home);
      else if (provider === 'anthropic') text = await callAnthropic(cred.key, model, system, messages, effort, tap, sig, Boolean(settings.webSearch));
      else if (provider === 'google') text = await callGemini(cred.key, model, system, messages, tap, sig);
      else text = await callOpenAICompatible(provider, cred.key, model, system, messages, settings, tap, sig);
      used = cred;
      break;
    } catch (err) {
      if (signal?.aborted) throw new Error('Cancelada');
      if (sig.aborted) throw new Error(`${PROVIDERS[provider]?.label || provider}: no respondió en 10 minutos`);
      // Sin cupo en esta cuenta: se prueba con la siguiente (si aún no escribió nada).
      if (i < creds.length - 1 && !wrote && isQuotaError(err.message)) {
        console.warn(`[cuentas] ${PROVIDERS[provider]?.label}: «${cred.label}» sin cupo, pruebo con «${creds[i + 1].label}»`);
        continue;
      }
      throw err;
    }
  }
  const inChars = system.length + messages.reduce((n, m) => n + m.content.length, 0);
  usageSink?.({ provider, model, calls: 1, inChars, outChars: text.length, account: used?.id });
  return { text, simulated: false, provider, model, account: used?.id };
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

async function callAnthropic(apiKey, model, system, messages, effort, onDelta, signal, webSearch = false) {
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

  // Búsqueda web del lado de Anthropic (solo modelos que la admiten).
  if (webSearch && /opus|sonnet/.test(model)) params.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }];

  const convo = [...messages];
  const texts = [];
  let response;
  // Con herramientas del servidor la respuesta puede pausarse (pause_turn): se continúa hasta 3 veces.
  for (let round = 0; round < 4; round++) {
    // Si el modelo declina por seguridad, el servidor reintenta con otro modelo.
    const body = { ...params, messages: convo };
    const stream = /opus-5|fable/.test(model)
      ? client.beta.messages.stream({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
      : client.messages.stream(body, { signal });
    stream.on('text', (delta) => onDelta(delta));
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
    texts.push(...response.content.filter((b) => b.type === 'text').map((b) => b.text));
    if (response.stop_reason !== 'pause_turn') break;
    convo.push({ role: 'assistant', content: response.content });
  }
  return texts.join('');

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

async function callOpenAICompatible(provider, apiKey, model, system, messages, settings, onDelta, signal) {
  const base = provider === 'ollama' && settings.apiKeys?.ollamaUrl ? settings.apiKeys.ollamaUrl : PROVIDERS[provider].baseUrl;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:4747';
    headers['X-Title'] = 'Oficina de IAs';
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
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

async function callGemini(apiKey, model, system, messages, onDelta, signal) {
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
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
 * Variables de entorno para una CLI. Con otra cuenta, la herramienta guarda su
 * sesión en una carpeta propia (así puedes tener dos cuentas de Gemini, por ejemplo).
 */
export function cliEnv(provider, home) {
  const env = { ...process.env };
  if (!home) return env;
  fs.mkdirSync(home, { recursive: true });
  const name = PROVIDERS[provider]?.homeEnv;
  if (name) env[name] = home;
  else {
    env.HOME = home;
    env.USERPROFILE = home;
  }
  return env;
}

/**
 * Ejecuta una CLI (Codex, Claude Code, OpenCode, Gemini…) con la conversación
 * como un único prompt. Se ejecuta en una carpeta temporal vacía para que no
 * toque tus proyectos.
 */
function callCli(settings, provider, system, messages, onDelta, signal, home = null) {
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
    const child = spawn(cmd, args, { cwd: CLI_DIR, shell: win, env: cliEnv(provider, home) });
    if (!viaArg) child.stdin.end(prompt);
    else child.stdin.end();
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
    signal?.addEventListener('abort', () => child.kill(), { once: true });
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
