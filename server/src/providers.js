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
import { FREE_MODELS, RETIRED_MODELS } from './freeModels.js';
import { ollamaOrder, ensureUp, markDown, markUp, track, isDownError } from './ollama.js';

// tier: 'gratis' (tiene plan gratis), 'mixto' (modelos gratis y de pago),
// 'suscripcion' (usa un plan que ya pagas) o 'pago' (cobra por uso).
export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', tier: 'pago', hint: 'Claude por API, se paga aparte del plan. Si ya tienes el plan de Claude, mejor usa Claude Code.', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI (ChatGPT)', tier: 'pago', hint: 'GPT por API. Si ya tienes ChatGPT, mejor usa Codex CLI.', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  google: { label: 'Google (Gemini)', tier: 'gratis', hint: 'Plan gratis con límites diarios. La clave se saca con tu cuenta de Google.', keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter (cientos de modelos)', tier: 'mixto', hint: 'Una sola clave para muchos modelos. Los que terminan en :free son gratis.', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
  groq: { label: 'Groq (gratis, ultra rápido)', tier: 'gratis', hint: 'Plan gratis y muy rápido (GPT-OSS y Qwen 3.8). Retiró los Llama en agosto de 2026.', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  cerebras: { label: 'Cerebras (gratis, ultra rápido)', tier: 'gratis', hint: 'Plan gratis («Free Trial») con GPT-OSS 120B y Qwen 3.8, con límites por minuto.', baseUrl: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai' },
  mistral: { label: 'Mistral', tier: 'gratis', hint: 'Plan gratis («Free mode» en Mistral Studio), pero pide verificar tu número de teléfono y no está en todos los países. Si no te deja, usa Groq, Cerebras u OpenRouter.', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  deepseek: { label: 'DeepSeek', tier: 'pago', hint: 'De pago, pero cuesta centavos.', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  xai: { label: 'xAI (Grok)', tier: 'pago', hint: 'Grok por API.', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
  perplexity: { label: 'Perplexity (búsqueda web)', tier: 'pago', hint: 'Respuestas con búsqueda web.', baseUrl: 'https://api.perplexity.ai', keyUrl: 'https://www.perplexity.ai/settings/api' },
  together: { label: 'Together AI (open source)', tier: 'pago', hint: 'Modelos abiertos; suele regalar créditos al empezar.', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.xyz/settings/api-keys' },
  github: { label: 'GitHub Models (gratis con tu cuenta)', tier: 'gratis', hint: 'Gratis con tu cuenta de GitHub: GPT-4.1, Llama, DeepSeek, Mistral (con límites diarios). La clave es un token de GitHub.', baseUrl: 'https://models.github.ai/inference', keyUrl: 'https://github.com/settings/personal-access-tokens' },
  sambanova: { label: 'SambaNova (gratis, rápido)', tier: 'gratis', hint: 'Créditos gratis para GPT-OSS, DeepSeek, MiniMax M3, Gemma 4 y Llama.', baseUrl: 'https://api.sambanova.ai/v1', keyUrl: 'https://cloud.sambanova.ai/apis' },
  huggingface: { label: 'Hugging Face', tier: 'gratis', hint: 'Créditos gratis cada mes para miles de modelos abiertos.', baseUrl: 'https://router.huggingface.co/v1', keyUrl: 'https://huggingface.co/settings/tokens' },
  nvidia: { label: 'NVIDIA NIM', tier: 'gratis', hint: 'Créditos gratis para probar Nemotron, Kimi K3, GLM 5.3, DeepSeek V4 y más.', baseUrl: 'https://integrate.api.nvidia.com/v1', keyUrl: 'https://build.nvidia.com' },
  cohere: { label: 'Cohere (Command)', tier: 'gratis', hint: 'Clave de prueba gratis: 1.000 llamadas al mes (modelos Command A).', baseUrl: 'https://api.cohere.ai/compatibility/v1', keyUrl: 'https://dashboard.cohere.com/api-keys' },
  cloudflare: { label: 'Cloudflare Workers AI (gratis)', tier: 'gratis', hint: 'Gratis con tu cuenta de Cloudflare (la misma de las imágenes): GPT-OSS, Qwen 3.8, Llama, Kimi. Las 10.000 unidades diarias se comparten con las imágenes.', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{cuenta}/ai/v1', keyUrl: 'https://dash.cloudflare.com/profile/api-tokens', needsAccount: true },
  'ollama-cloud': { label: 'Ollama Cloud (modelos gigantes)', tier: 'gratis', hint: 'Modelos enormes en los servidores de Ollama (GPT-OSS 120B, Kimi K3, GLM 5.3, DeepSeek V4) sin tarjeta de video. Plan gratis con cupo por hora y por día. Lo que envías sale de tu casa.', baseUrl: 'https://ollama.com/v1', keyUrl: 'https://ollama.com/settings/keys' },
  ovh: { label: 'OVHcloud AI Endpoints (Europa)', tier: 'gratis', hint: 'Nube europea (GDPR). Gratis y sin clave, pero solo 2 preguntas por minuto por modelo: úsalo de respaldo. Con clave va más rápido, pero cobra por uso (centavos).', baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', keyUrl: 'https://www.ovh.com/manager/#/public-cloud/pci/projects', anonymous: true },
  minimax: { label: 'MiniMax (M3, muy barato)', tier: 'pago', hint: 'De pago pero muy barato (unos US$0,30 por millón de tokens de entrada). Fuerte para programar y tareas largas. Modelos: MiniMax-M3, MiniMax-M2.7.', baseUrl: 'https://api.minimax.io/v1', keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key' },
  ollama: { label: 'Ollama (local, gratis)', tier: 'gratis', hint: 'Modelos en tu propio computador, gratis y sin límite.', baseUrl: 'http://localhost:11434/v1', keyless: true, keyUrl: 'https://ollama.com/download' },
  // Herramientas de línea de comandos instaladas en tu computador: usan tu
  // sesión ya iniciada (suscripción), sin clave de API.
  'cli-codex': { label: 'Codex CLI (tu sesión de ChatGPT)', tier: 'suscripcion', hint: 'Usa tu cuenta de ChatGPT (incluso la gratis, con pocos usos).', cli: true, bin: 'codex', npm: '@openai/codex', login: 'codex login', homeEnv: 'CODEX_HOME', command: 'codex exec --skip-git-repo-check --sandbox read-only -', keyUrl: 'https://github.com/openai/codex' },
  'cli-claude': { label: 'Claude Code (tu sesión de Claude)', tier: 'suscripcion', hint: 'Usa tu plan Pro o Max de Claude.', cli: true, bin: 'claude', npm: '@anthropic-ai/claude-code', login: 'claude', homeEnv: 'CLAUDE_CONFIG_DIR', command: 'claude -p', keyUrl: 'https://code.claude.com/docs' },
  'cli-opencode': { label: 'OpenCode CLI', tier: 'gratis', hint: 'Programa gratis; trae modelos gratis o usa los tuyos.', cli: true, bin: 'opencode', npm: 'opencode-ai', login: 'opencode auth login', command: 'opencode run {prompt}', keyUrl: 'https://opencode.ai' },
  'cli-gemini': { label: 'Gemini CLI (tu cuenta de Google)', tier: 'gratis', hint: 'Gratis con tu cuenta de Google (1.000 consultas al día); con Google AI Pro, 1.500. Si tienes varias cuentas Pro, agrégalas y se turnan.', cli: true, bin: 'gemini', npm: '@google/gemini-cli', login: 'gemini', command: 'gemini', keyUrl: 'https://github.com/google-gemini/gemini-cli' },
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
  if (PROVIDERS[provider]?.needsAccount && !cloudflareAccount(settings)) return false;
  return credentials(settings, provider).length > 0;
}

/** ¿Esta IA responde de verdad (no en modo demo)? */
export const isLive = (settings, agent) => Boolean(agent) && settings.demoMode !== 'always' && hasKey(settings, agent.provider) && (!agent.mcp || agent.provider !== 'cli-claude' || Boolean(settings.mcp?.[agent.mcp]?.added));

/**
 * «Solo IAs conectadas» (activado por defecto): las IAs en modo demo no
 * trabajan en tareas, reuniones ni como asistentes; tampoco las conectadas
 * que están fallando (healthy). Si todavía no hay ninguna conectada, trabajan
 * todas en demo para que la oficina se pueda probar.
 */
export function usableFilter(settings, agents, healthy = () => true) {
  if (settings.onlyLive === false) return () => true;
  const live = (a) => Boolean(a) && isLive(settings, a);
  const staff = agents.filter((a) => !a.isBrain && a.enabled);
  // Primero las conectadas que funcionan; si todas están fallando, las conectadas igual.
  if (staff.some((a) => live(a) && healthy(a))) return (a) => live(a) && healthy(a);
  if (staff.some(live)) return live;
  return () => true;
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
  // Ollama: cada «cuenta» es un computador (este o un nodo).
  if (def.keyless) return ollamaOrder(settings, accountId).map((server) => ({ id: server.id, label: server.label, key: null, server }));
  const mainKey = keyFor(settings, provider);
  // OVHcloud funciona sin clave (gratis, con pocas peticiones por minuto).
  if (def.anonymous && !mainKey && !extra.length) return settings.apiKeys?.[`${provider}Anon`] ? [{ id: 'default', label: 'Sin clave (gratis)', key: null }] : [];
  const main = def.cli
    ? [{ id: 'default', label: 'Principal', key: null, home: null }]
    : mainKey ? [{ id: 'default', label: 'Principal', key: mainKey }] : [];
  const all = [...main, ...extra];
  const i = all.findIndex((a) => a.id === accountId);
  if (i > 0) all.unshift(...all.splice(i, 1));
  return all;
}

/** ¿El error dice que el modelo ya no existe o dejó de ser gratis? */
export const isRetiredModel = (msg) => /no longer available|does not exist|model_not_found|is not found|not found for API|not supported for generateContent|unavailable for free|decommissioned|has been (deprecated|retired|shut ?down)|not a valid model|invalid model/i.test(String(msg));
/** ¿El modelo está saturado en este momento (se arregla solo en un rato)? */
export const isOverloaded = (msg) => /high demand|overloaded|temporarily unavailable|try again later|\b503\b|\bUNAVAILABLE\b|server is busy/i.test(String(msg));

const modelLists = new Map();
/** Modelos que ofrece hoy un proveedor compatible con OpenAI (se guarda 10 minutos). */
async function listModels(provider, cred) {
  const hit = modelLists.get(provider);
  if (hit && Date.now() - hit.at < 600000) return hit.ids;
  const base = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : PROVIDERS[provider]?.baseUrl;
  if (!base) return [];
  // GitHub Models publica su catálogo en otra dirección.
  const url = provider === 'github' ? 'https://models.github.ai/catalog/models' : `${base}/models`;
  try {
    const r = await fetch(url, { headers: cred?.key ? { Authorization: `Bearer ${cred.key}` } : {}, signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    let items = Array.isArray(data) ? data : data.data || data.models || [];
    // En OpenRouter solo sirven los gratis.
    if (provider === 'openrouter') items = items.filter((m) => m.id?.endsWith(':free') || (+m.pricing?.prompt === 0 && +m.pricing?.completion === 0));
    const ids = items.map((m) => m.id || m.name).filter(Boolean);
    modelLists.set(provider, { at: Date.now(), ids });
    return ids;
  } catch {
    return [];
  }
}

/** Reemplazo gratis para un modelo retirado: el conocido, o uno recomendado que siga existiendo. */
export async function replacementModel(provider, model, cred) {
  const known = RETIRED_MODELS[provider]?.[model];
  if (known && known !== model) return known;
  const recommended = (FREE_MODELS[provider] || []).map((m) => m.id).filter((id) => id !== model);
  if (provider === 'google') return recommended[0] || null;
  const available = await listModels(provider, cred);
  if (!available.length) return null;
  return recommended.find((id) => available.includes(id)) || (provider === 'openrouter' ? available.find((id) => id !== model) : null) || null;
}

const retryWait = () => Number(process.env.OFICINA_RETRY_MS ?? 2500);

/**
 * Llama al modelo y, si falla antes de escribir algo:
 * - saturado («high demand», 503): espera un momento y reintenta; si sigue
 *   saturado, usa por esta vez otro modelo gratis del mismo proveedor;
 * - retirado o ya no gratis: pasa a su reemplazo gratis y la IA se queda con él.
 * No cambia nunca a un modelo de pago.
 */
async function withRecovery(provider, cred, model, run, wrote, onSwitch) {
  const heals = !PROVIDERS[provider]?.cli && !PROVIDERS[provider]?.keyless && provider !== 'anthropic';
  try {
    return await run(model);
  } catch (err) {
    if (!heals || wrote()) throw err;
    if (isOverloaded(err.message)) {
      await new Promise((r) => setTimeout(r, retryWait()));
      let last = err;
      try {
        return await run(model);
      } catch (e2) {
        if (wrote() || !isOverloaded(e2.message)) throw e2;
        last = e2;
      }
      const alt = (FREE_MODELS[provider] || []).map((m) => m.id).find((id) => id !== model);
      if (!alt) throw last;
      console.warn(`[modelos] ${PROVIDERS[provider].label}: «${model}» saturado, uso «${alt}» esta vez`);
      onSwitch(alt, false);
      return run(alt);
    }
    if (isRetiredModel(err.message)) {
      const next = await replacementModel(provider, model, cred);
      if (!next) throw new Error(`${err.message} (Cambia el modelo en el perfil de la IA.)`);
      console.warn(`[modelos] ${PROVIDERS[provider].label}: «${model}» ya no está disponible, la IA pasa a «${next}»`);
      onSwitch(next, true);
      return run(next);
    }
    throw err;
  }
}

/** ¿El error indica que la cuenta se quedó sin cupo? */
export const isQuotaError = (msg) => /\b429\b|quota|rate.?limit|l[ií]mite de uso|usage limit|limit reached|exhausted|too many requests|insufficient/i.test(String(msg));

function envKey(provider) {
  const names = {
    anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY', groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY', xai: 'XAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY',
    together: 'TOGETHER_API_KEY', cerebras: 'CEREBRAS_API_KEY', github: 'GITHUB_MODELS_TOKEN',
    sambanova: 'SAMBANOVA_API_KEY', huggingface: 'HF_TOKEN', nvidia: 'NVIDIA_API_KEY', cohere: 'COHERE_API_KEY', minimax: 'MINIMAX_API_KEY', 'ollama-cloud': 'OLLAMA_API_KEY', ovh: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN',
  };
  return names[provider] ? process.env[names[provider]] : undefined;
}

function keyFor(settings, provider) {
  // Cloudflare: si no hay clave propia, usa el token de Ajustes → Imágenes.
  if (provider === 'cloudflare') return settings.apiKeys?.cloudflare || settings.images?.cloudflareToken || process.env.CLOUDFLARE_API_TOKEN;
  return settings.apiKeys?.[provider] || envKey(provider);
}

/** Account ID de Cloudflare (el de «Conectar las IAs» o el de Imágenes). */
export const cloudflareAccount = (settings) => settings.apiKeys?.cloudflareAccount || settings.images?.cloudflareAccount || process.env.CLOUDFLARE_ACCOUNT_ID || '';

/** Dirección de la API de un proveedor compatible con OpenAI. */
function baseUrlOf(settings, provider) {
  if (provider === 'cloudflare') return `${process.env.CLOUDFLARE_AI_BASE || 'https://api.cloudflare.com'}/client/v4/accounts/${encodeURIComponent(cloudflareAccount(settings))}/ai/v1`;
  return PROVIDERS[provider].baseUrl;
}

// Contador de uso (lo conecta el servidor para guardarlo en disco).
let usageSink = null;
export function setUsageSink(fn) {
  usageSink = fn;
}

// Medidores por IA (acierto y carga): se registra cada llamada, buena o fallida.
let callSink = null;
export function setCallSink(fn) {
  callSink = fn;
}

/**
 * Llama a un modelo. Devuelve { text, simulated, provider, model }.
 * messages: [{ role: 'user' | 'assistant', content: string }]
 * onDelta(fragmento): se llama con cada trozo de texto a medida que llega.
 */
export async function callModel(settings, params) {
  const t0 = Date.now();
  const inChars = (params.system?.length || 0) + (params.messages || []).reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
  const agentId = params.agent?.id;
  try {
    const r = await callModelInner(settings, params);
    if (agentId) callSink?.({ agentId, ok: true, simulated: r.simulated, inChars, ms: Date.now() - t0 });
    return r;
  } catch (err) {
    if (agentId && err.message !== 'Cancelada') callSink?.({ agentId, ok: false, quota: isQuotaError(err.message), error: err.message.slice(0, 200), inChars, ms: Date.now() - t0 });
    throw err;
  }
}

async function callModelInner(settings, { provider, model, system, messages, agent, account, effort = 'medium', onDelta, signal }) {
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
    const ollama = cred.server;
    const done = ollama ? track(ollama.id) : null;
    try {
      if (ollama?.nodeId) await ensureUp(ollama); // un nodo apagado puede tardar mucho en fallar
      const once = (m) => {
        if (PROVIDERS[provider]?.cli) return callCli(settings, provider, system, messages, tap, sig, cred.home, agent?.mcp ? [agent.mcp] : [], m);
        if (provider === 'anthropic') return callAnthropic(cred.key, m, system, messages, effort, tap, sig, Boolean(settings.webSearch));
        if (provider === 'google') return callGemini(cred.key, m, system, messages, tap, sig);
        return callOpenAICompatible(provider, cred, m, system, messages, tap, sig, settings);
      };
      // Si el modelo está saturado o lo retiraron, se recupera solo (ver withRecovery).
      text = await withRecovery(provider, cred, model, once, () => wrote, (next, keep) => {
        if (keep && agent && agent.model === model) agent.model = next;
        model = next;
      });
      if (ollama) markUp(ollama.id);
      used = cred;
      break;
    } catch (err) {
      if (signal?.aborted) throw new Error('Cancelada');
      if (sig.aborted) throw new Error(`${PROVIDERS[provider]?.label || provider}: no respondió en 10 minutos`);
      // Ollama: si este computador está apagado o no tiene el modelo, se prueba con otro.
      if (ollama && i < creds.length - 1 && !wrote) {
        if (isDownError(err.message)) markDown(ollama.id);
        console.warn(`[ollama] «${cred.label}» falló (${err.message.slice(0, 120)}), pruebo con «${creds[i + 1].label}»`);
        continue;
      }
      // Sin cupo en esta cuenta: se prueba con la siguiente (si aún no escribió nada).
      if (i < creds.length - 1 && !wrote && isQuotaError(err.message)) {
        console.warn(`[cuentas] ${PROVIDERS[provider]?.label}: «${cred.label}» sin cupo, pruebo con «${creds[i + 1].label}»`);
        continue;
      }
      throw err;
    } finally {
      done?.();
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

async function callOpenAICompatible(provider, cred, model, system, messages, onDelta, signal, settings = {}) {
  // Ollama puede ser el de este computador o el de un nodo (por Tailscale).
  const base = cred.server ? `${cred.server.base}/v1` : baseUrlOf(settings, provider);
  const headers = { 'Content-Type': 'application/json', ...(cred.server?.headers || {}) };
  if (cred.key) headers.Authorization = `Bearer ${cred.key}`;
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
      // MiniMax separa su razonamiento del texto final (si no, llega entre <think>).
      ...(provider === 'minimax' ? { reasoning_split: true } : {}),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const where = cred.server ? ` (${cred.server.label})` : '';
    throw new Error(`${PROVIDERS[provider].label}${where}: ${data.error?.message || data.error || res.statusText}`);
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
  return provider === 'minimax' ? text.replace(/<think>[\s\S]*?<\/think>\s*/g, '') : text;
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
/**
 * Opción de cada CLI para elegir el modelo, y qué ids le sirven (si la IA venía
 * de otro proveedor con otro modelo, no se pasa y la herramienta usa el suyo).
 */
const CLI_MODEL_FLAG = { 'cli-claude': '--model', 'cli-codex': '-m', 'cli-gemini': '-m', 'cli-opencode': '-m' };
const CLI_MODEL_OK = { 'cli-claude': /^(claude|opus|sonnet|haiku|fable)/i, 'cli-codex': /^(gpt|o\d|codex)/i, 'cli-gemini': /^gemini/i, 'cli-opencode': /\// };

function callCli(settings, provider, system, messages, onDelta, signal, home = null, mcp = [], model = '') {
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
  // Carpetas que el usuario permitió (Ajustes → Accesos): Claude Code y Gemini CLI pueden leerlas.
  const dirs = (settings.grants || []).map((g) => g.path).filter((d) => fs.existsSync(d));
  const q = (d) => (win ? `"${d}"` : d);
  if (dirs.length && !settings.cli?.[provider]?.command) {
    if (provider === 'cli-claude') for (const d of dirs) args.push('--add-dir', q(d));
    if (provider === 'cli-gemini') args.push('--include-directories', q(dirs.join(',')));
  }
  // Modelo elegido en el perfil de la IA (vacío = el que decida la herramienta).
  const m = String(model || '').trim();
  if (m && /^[\w.:/-]+$/.test(m) && !settings.cli?.[provider]?.command && CLI_MODEL_OK[provider]?.test(m)) args.push(CLI_MODEL_FLAG[provider], m);
  // Servicios MCP (p. ej. Undermind): permiso solo para las herramientas de ese servicio.
  if (provider === 'cli-claude' && mcp.length) args.push('--allowedTools', ...mcp.map((n) => `mcp__${n}`));
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
