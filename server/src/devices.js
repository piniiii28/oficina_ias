// Dispositivos de la oficina: la impresora puede estar conectada a este
// computador (misma red) o a un nodo en otra casa. Aquí se decide a cuál
// hablarle, para que el resto de la oficina no tenga que saberlo.
import { Store } from './store.js';
import { printerInfo, getPrinter, cameraFrame, isLanHost, connectPrinter } from './bambu.js';

// --- Nodos (tus otros computadores, por Tailscale) ---
export function normalizeNodeUrl(url) {
  let u;
  try {
    u = new URL(String(url || '').trim());
  } catch {
    throw new Error('Escribe la dirección del nodo, por ejemplo http://100.101.102.103:4748');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('La dirección debe empezar por http://');
  if (!isLanHost(u.hostname) && !/\.ts\.net$/i.test(u.hostname)) throw new Error('Usa la dirección de Tailscale del nodo (100.x.x.x o un nombre .ts.net)');
  return `${u.protocol}//${u.host}`;
}

export async function nodeCall(node, method, url, body, { timeoutMs = 8000, raw = false } = {}) {
  const res = await fetch(`${node.url}${url}`, {
    method,
    headers: { 'X-Nodo-Token': node.token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => {
    throw new Error(`El nodo «${node.name}» no responde. ¿Está encendido, con nodo.bat abierto y Tailscale conectado?`);
  });
  if (raw && res.ok) return Buffer.from(await res.arrayBuffer());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `El nodo respondió ${res.status}`);
  return data;
}

export const nodeById = (settings, id) => (settings.nodes || []).find((n) => n.id === id);
export const publicNode = ({ token, ...n }) => ({ ...n, tokenPreview: token ? `${token.slice(0, 4)}…` : null });

export async function addNode(store, { url, token, name }) {
  const node = { id: Store.id('nd_'), url: normalizeNodeUrl(url), token: String(token || '').trim(), name: String(name || '').trim().slice(0, 40) };
  if (!node.token) throw new Error('Pega el código de enlace que muestra el nodo');
  const info = await nodeCall(node, 'GET', '/nodo/info', undefined, { timeoutMs: 6000 });
  node.name ||= info.name;
  (store.data.settings.nodes ||= []).push(node);
  store.save();
  return { node, info };
}

// --- Impresora: aquí o en un nodo ---
let cache = { key: '', info: null };

/** Estado de la impresora (el de un nodo se refresca cada pocos segundos). */
export function printerNow(settings) {
  const p = settings.printer;
  if (!p?.node) return printerInfo(settings);
  const node = nodeById(settings, p.node);
  if (!node) return { configured: false, name: p.name || 'Mi impresora', connected: false, error: 'El nodo de la impresora ya no existe', state: null };
  const info = cache.key === p.node && cache.info ? cache.info : { configured: true, connected: false, error: 'Consultando al nodo…', state: null };
  return { ...info, name: p.name || info.name, node: { id: node.id, name: node.name } };
}

/** Pregunta el estado al nodo cada 3 s y avisa a la interfaz si cambió. */
export function startNodePrinterPoll(store, emit) {
  let last = '';
  const tick = async () => {
    const p = store.data.settings.printer;
    const node = p?.node && nodeById(store.data.settings, p.node);
    if (!node) return;
    let info;
    try {
      info = await nodeCall(node, 'GET', '/nodo/printer/status', undefined, { timeoutMs: 4000 });
    } catch (err) {
      info = { configured: true, connected: false, error: err.message, state: null };
    }
    cache = { key: node.id, info };
    const now = JSON.stringify(info);
    if (now !== last) {
      last = now;
      emit({ type: 'printer', ...printerNow(store.data.settings) });
    }
  };
  tick();
  return setInterval(tick, 3000).unref();
}

export async function printerCommand(settings, command) {
  const p = settings.printer;
  if (p?.node) {
    const node = nodeById(settings, p.node);
    if (!node) throw new Error('El nodo de la impresora ya no existe');
    return nodeCall(node, 'POST', '/nodo/printer/command', { command });
  }
  const pr = getPrinter();
  if (!pr?.connected) throw new Error(printerInfo(settings).error || 'No estoy conectado a la impresora');
  pr.command(command);
  return { ok: true };
}

export async function printerCamera(settings) {
  const p = settings.printer;
  if (p?.node) {
    const node = nodeById(settings, p.node);
    if (!node) throw new Error('El nodo de la impresora ya no existe');
    return nodeCall(node, 'GET', '/nodo/printer/camera.jpg', undefined, { raw: true, timeoutMs: 12000 });
  }
  if (!p?.host || !p.accessCode) throw new Error('Configura la impresora primero');
  return cameraFrame({ host: p.host, accessCode: p.accessCode, port: p.cameraPort || 6000 }, { plain: process.env.OFICINA_PRINTER_PLAIN === '1' });
}

/**
 * Guarda la impresora. Con `node`, la configuración (y el código de acceso)
 * se guarda en ese nodo; la oficina principal solo recuerda cuál es.
 */
export async function savePrinter(store, body, emit) {
  const s = store.data.settings;
  const b = body || {};
  if (b.node) {
    const node = nodeById(s, b.node);
    if (!node) throw new Error('Ese nodo no existe');
    const info = await nodeCall(node, 'PUT', '/nodo/printer', { name: b.name, model: b.model, host: b.host, serial: b.serial, accessCode: b.accessCode, port: b.port, cameraPort: b.cameraPort });
    const wasLocal = Boolean(s.printer?.host && !s.printer?.node);
    s.printer = { node: node.id, name: String(b.name || info.name || 'Mi P1S').slice(0, 40) };
    store.save();
    if (wasLocal) connectPrinter({}); // suelta la conexión local que había antes
    cache = { key: node.id, info };
    return printerNow(s);
  }
  const prev = s.printer?.node ? {} : s.printer || {};
  const host = String(b.host ?? prev.host ?? '').trim();
  if (host && !isLanHost(host)) throw new Error('Usa la IP local de la impresora (por ejemplo 192.168.1.50)');
  s.printer = {
    name: String(b.name ?? prev.name ?? 'Mi P1S').slice(0, 40), model: String(b.model ?? prev.model ?? 'P1S').slice(0, 20), host,
    port: Number(b.port || prev.port || 8883), serial: String(b.serial ?? prev.serial ?? '').trim().toUpperCase(),
    accessCode: typeof b.accessCode === 'string' && b.accessCode.trim() ? b.accessCode.trim() : prev.accessCode || '',
    cameraPort: Number(b.cameraPort || prev.cameraPort || 6000),
  };
  store.save();
  connectPrinter(s, emit);
  return printerInfo(s);
}
