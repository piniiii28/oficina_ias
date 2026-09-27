// Varios Ollama a la vez: el de este computador y el de cada nodo (tus otros
// computadores por Tailscale). Cada IA elige cuál usa primero, o «automático»
// (el menos ocupado). Si uno está apagado o no tiene el modelo, se usa otro.
// (Importación circular a propósito: PROVIDERS solo se lee dentro de las funciones.)
import { PROVIDERS } from './providers.js';

// Servidores que fallaron hace poco: se prueban de últimos durante un minuto.
const down = new Map();
// Llamadas en curso por servidor (para repartir en modo automático).
const busy = new Map();
// Último momento en que cada servidor respondió (para no preguntar cada vez).
const lastOk = new Map();

const DOWN_MS = 60000;
const OK_MS = 30000;

/** Ollamas disponibles: este computador y cada nodo. */
export function ollamaServers(settings) {
  const local = (settings.apiKeys?.ollamaUrl || PROVIDERS.ollama.baseUrl).replace(/\/v1\/?$/, '').replace(/\/$/, '');
  return [
    { id: 'local', label: 'Este computador', base: local, headers: {} },
    ...(settings.nodes || []).filter((n) => n.ollama !== false).map((n) => ({
      id: `node:${n.id}`, nodeId: n.id, label: `Nodo «${n.name}»`, base: `${n.url}/nodo/ollama`, headers: { 'X-Nodo-Token': n.token },
    })),
  ];
}

/** Un Ollama por id; sin id (o 'default'), el preferido de la oficina. */
export const ollamaServer = (settings, id) => (id && id !== 'default' && id !== 'auto' ? ollamaServers(settings).find((s) => s.id === id) : ollamaOrder(settings, null)[0]);

/**
 * Orden en que se prueban los Ollama para una IA.
 * pref: 'auto' (el menos ocupado), el id de un servidor ('local' o
 * 'node:<id>'), o nada / 'default' (el preferido de la oficina,
 * `settings.ollamaNode`, y si no, este computador).
 */
export function ollamaOrder(settings, pref) {
  const all = ollamaServers(settings);
  const now = Date.now();
  let first = pref && pref !== 'auto' && all.some((s) => s.id === pref) ? pref : null;
  if (!first && pref !== 'auto' && settings.ollamaNode && all.some((s) => s.id === `node:${settings.ollamaNode}`)) first = `node:${settings.ollamaNode}`;
  const rank = (s) => (s.id === first ? -1 : pref === 'auto' ? busy.get(s.id) || 0 : 0);
  const isDown = (s) => (down.get(s.id) || 0) > now;
  // sort es estable: con empate se respeta el orden (este computador primero).
  return [...all].sort((a, b) => Number(isDown(a)) - Number(isDown(b)) || rank(a) - rank(b));
}

export function markDown(id) {
  down.set(id, Date.now() + DOWN_MS);
  lastOk.delete(id);
}

export function markUp(id) {
  down.delete(id);
  lastOk.set(id, Date.now());
}

/** Cuenta una llamada en curso; devuelve la función que la termina. */
export function track(id) {
  busy.set(id, (busy.get(id) || 0) + 1);
  return () => busy.set(id, Math.max(0, (busy.get(id) || 1) - 1));
}

export const busyNow = (id) => busy.get(id) || 0;

/** ¿El error es de red (servidor apagado o nodo sin Ollama)? */
export const isDownError = (msg) => /fetch failed|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|no responde|no está abierto|timeout|aborted|Bad Gateway|socket/i.test(String(msg));

/**
 * Comprueba rápido que el servidor responde antes de mandarle un trabajo largo
 * (un nodo apagado por Tailscale puede tardar mucho en fallar).
 */
export async function ensureUp(server) {
  if (Date.now() - (lastOk.get(server.id) || 0) < OK_MS) return;
  try {
    const r = await fetch(`${server.base}/api/version`, { headers: server.headers, signal: AbortSignal.timeout(3500) });
    if (!r.ok) throw new Error(r.status === 401 ? 'código de enlace incorrecto' : `respondió ${r.status}`);
    markUp(server.id);
  } catch (err) {
    markDown(server.id);
    throw new Error(`Ollama (${server.label}) no responde: ${err.message}`);
  }
}

/** Modelos instalados en un Ollama. */
export async function ollamaTags(server, timeoutMs = 4000) {
  const r = await fetch(`${server.base}/api/tags`, { headers: server.headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  const data = await r.json();
  markUp(server.id);
  return (data.models || []).map((m) => ({ name: m.name, size: m.size }));
}

/** ¿Ya está ese modelo? («gemma3» es lo mismo que «gemma3:latest»). */
export const hasModel = (names, model) => {
  const full = model.includes(':') ? model : `${model}:latest`;
  return names.some((n) => n === model || n === full);
};

/** Descarga un modelo en un Ollama y va contando el progreso en onLog. */
export async function ollamaPull(server, model, onLog = () => {}) {
  const r = await fetch(`${server.base}/api/pull`, {
    method: 'POST',
    headers: { ...server.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
    signal: AbortSignal.timeout(3 * 60 * 60000),
  });
  if (!r.ok || !r.body) throw new Error(`No pude descargar ${model} (${r.status})`);
  const decoder = new TextDecoder();
  let buf = '';
  let last = '';
  let error = null;
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.error) error = e.error;
      const pct = e.total ? ` ${Math.floor((e.completed || 0) * 100 / e.total)} %` : '';
      const msg = `${e.status || ''}${pct}`;
      if (msg && msg !== last) {
        last = msg;
        onLog(`${msg}\n`);
      }
    }
  }
  if (error) throw new Error(`${model}: ${error}`);
  return { ok: true };
}

/** Modelos de Ollama que usan las IAs (y sus asistentes). */
export function ollamaModelsUsed(agents) {
  const out = new Set();
  for (const a of agents || []) {
    if (a.enabled === false) continue;
    if (a.provider === 'ollama' && a.model) out.add(a.model);
    for (const s of a.assistants || []) if (s.provider === 'ollama' && s.model) out.add(s.model);
  }
  return [...out].sort();
}

/** Descarga en un Ollama los modelos que le faltan. */
export async function syncModels(server, models, onLog = () => {}) {
  const have = (await ollamaTags(server)).map((m) => m.name);
  const missing = models.filter((m) => !hasModel(have, m));
  const done = [];
  const failed = [];
  for (const m of missing) {
    onLog(`⬇️ ${m} en ${server.label}\n`);
    try {
      await ollamaPull(server, m, onLog);
      done.push(m);
    } catch (err) {
      onLog(`❌ ${err.message}\n`);
      failed.push({ model: m, error: err.message });
    }
  }
  return { missing, done, failed };
}
