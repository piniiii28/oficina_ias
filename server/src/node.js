// Nodo de la Oficina de IAs: corre en tus otros computadores (con nodo.bat) y
// le presta a la oficina principal lo que ese equipo tiene cerca: la impresora
// Bambu Lab de esa casa y su Ollama. Solo escucha en este computador y en
// Tailscale, y cada petición debe traer el código de enlace del nodo.
// Al abrir, enciende Ollama, descarga los modelos que usan las IAs y busca
// actualizaciones (y cada pocas horas vuelve a buscar).
import express from 'express';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPrinter, getPrinter, printerInfo, cameraFrame, PRINTER_COMMANDS, isLanHost } from './bambu.js';
import { detectCad } from './cad.js';
import { hostAllowed, tailscaleAddresses } from './auth.js';
import { syncModels } from './ollama.js';
import { updateStatus, applyUpdate, RESTART_CODE } from './updater.js';

export const NODE_PORT = Number(process.env.OFICINA_NODO_PORT || 4748);
const ollamaUrl = () => process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL_RE = /^[a-z0-9][a-z0-9._:/-]{0,80}$/i;

/** Modelos que el nodo debe tener: los que le pidió la oficina (al enlazarlo se los dice). */
export const wantedModels = (cfg) => (Array.isArray(cfg.data.ollamaModels) ? cfg.data.ollamaModels : []);

/** Descargas de modelos del nodo (una a la vez, en segundo plano). */
export function modelSyncer(cfg, { log = (t) => process.stdout.write(t) } = {}) {
  const state = { running: false, current: null, done: [], failed: [], at: null, error: null };
  const server = () => ({ id: 'local', label: 'este nodo', base: ollamaUrl(), headers: {} });
  let again = false;
  async function run() {
    if (state.running) {
      again = true;
      return state;
    }
    Object.assign(state, { running: true, current: null, done: [], failed: [], error: null });
    try {
      do {
        again = false;
        const r = await syncModels(server(), wantedModels(cfg), (t) => {
          const m = /^⬇️ (\S+)/.exec(t);
          if (m) state.current = m[1];
          log(t);
        });
        state.done.push(...r.done);
        state.failed = r.failed;
      } while (again);
    } catch (err) {
      state.error = /fetch failed|ECONNREFUSED/i.test(err.message) ? 'Ollama no está abierto en este computador' : err.message;
    } finally {
      Object.assign(state, { running: false, current: null, at: new Date().toISOString() });
    }
    return state;
  }
  return { state, run };
}

/** Dónde puede estar el programa de Ollama en este computador. */
function ollamaBin() {
  const c = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe')]
    : ['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama'];
  return c.find((f) => f && fs.existsSync(f)) || 'ollama';
}

async function ollamaRunning() {
  try {
    return (await fetch(`${ollamaUrl()}/api/version`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

/** Enciende Ollama si está instalado pero cerrado. */
export async function startOllama() {
  if (await ollamaRunning()) return true;
  try {
    const child = spawn(ollamaBin(), ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    return false;
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 750));
    if (await ollamaRunning()) return true;
  }
  return false;
}

/** Versión (commit) de este nodo, para saber si está al día con la oficina. */
let versionCache = null;
async function nodeVersion() {
  if (versionCache) return versionCache;
  const st = await updateStatus(ROOT, { fetch: false }).catch(() => null);
  versionCache = st?.git ? { head: st.head, branch: st.branch } : { head: null };
  return versionCache;
}

const updating = { running: false, log: '', error: null };

/** Trae la versión nueva del nodo (solo el servidor) y lo reinicia. */
export async function updateNode({ restart = process.env.OFICINA_LANZADOR === '1', exit = (c) => process.exit(c) } = {}) {
  if (updating.running) return updating;
  Object.assign(updating, { running: true, log: '', error: null });
  try {
    await applyUpdate(ROOT, (t) => (updating.log = (updating.log + t).slice(-4000)), { build: false, workspace: 'server' });
    versionCache = null;
    if (restart) setTimeout(() => exit(RESTART_CODE), 500);
  } catch (err) {
    updating.error = err.message;
  } finally {
    updating.running = false;
  }
  return updating;
}

export function nodeDataDir() {
  if (process.env.OFICINA_NODO_DATA) return process.env.OFICINA_NODO_DATA;
  const docs = path.join(os.homedir(), 'Documents');
  return path.join(fs.existsSync(docs) ? docs : os.homedir(), 'Oficina de IAs (nodo)');
}

/** Configuración del nodo (nombre, código de enlace e impresora). */
export class NodeConfig {
  constructor(dir) {
    this.file = path.join(dir, 'nodo.json');
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    this.data.token ||= crypto.randomBytes(18).toString('hex');
    this.data.name ||= os.hostname();
    this.save();
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createNodeApp(cfg, { remoteHosts = [], syncer = modelSyncer(cfg), update = updateNode } = {}) {
  const settings = () => ({ printer: cfg.data.printer, remote: { enabled: true, extraHosts: remoteHosts } });
  connectPrinter(settings());
  const app = express();
  // Solo este computador, Tailscale y los nombres de Tailscale (protege contra páginas maliciosas).
  app.use((req, res, next) => {
    if (req.headers.origin) return res.status(403).json({ error: 'No permitido desde una página web' });
    if (!hostAllowed(settings(), req.headers.host)) return res.status(403).json({ error: `El nodo no reconoce la dirección «${req.headers.host}»: usa la 100.x.x.x que muestra su página (http://localhost:${NODE_PORT} en ese computador).` });
    next();
  });
  const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  // La página del nodo (solo en este computador) muestra el código de enlace.
  app.get('/', (req, res) => {
    // Desde otro computador: la conexión funciona, pero el código solo se muestra aquí.
    if (!isLocal(req)) {
      return res.status(403).type('html').send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nodo de la Oficina de IAs</title>
<body style="font:15px system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px"><h1>✅ El nodo «${escape(cfg.data.name)}» responde</h1>
<p>La red funciona: este computador llega al nodo por Tailscale.</p>
<p>Para agregarlo, en la oficina principal ve a <b>Ajustes → Nodos → Agregar nodo</b> y pega:</p>
<ul><li>Dirección: <code>http://${escape(String(req.headers.host || ''))}</code></li>
<li>Código de enlace: por seguridad solo se ve en el computador del nodo, abriendo <code>http://localhost:${NODE_PORT}</code> allá.</li></ul></body></html>`);
    }
    const info = printerInfo(settings());
    const urls = tailscaleAddresses().filter((ip) => !ip.includes(':')).map((ip) => `http://${ip}:${NODE_PORT}`);
    res.type('html').send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nodo de la Oficina de IAs</title>
<style>body{font:15px system-ui,sans-serif;background:#151024;color:#eee;margin:0;padding:24px;display:grid;place-items:center;min-height:100vh}main{max-width:560px;background:#1f1830;border:1px solid #3b2f55;border-radius:16px;padding:24px}code{background:#0f0b1a;padding:4px 8px;border-radius:6px;word-break:break-all;user-select:all}.ok{color:#4ade80}.warn{color:#fbbf24}li{margin:6px 0}</style>
<main><h1>🛰️ Nodo «${escape(cfg.data.name)}»</h1>
<p>Este computador le presta a tu oficina principal lo que tiene cerca (impresora y Ollama). Déjalo abierto.</p>
<ol><li>En la oficina principal ve a <b>Ajustes → Nodos</b> y pulsa <b>Agregar nodo</b>.</li>
<li>Dirección del nodo: ${urls.length ? urls.map((u) => `<code>${u}</code>`).join(' ') : '<span class="warn">todavía no detecto Tailscale en este computador: ábrelo e inicia sesión en la misma red que la oficina principal. El nodo empieza a escuchar solo en cuanto aparezca (revisa cada minuto).</span>'}</li>
<li>Código de enlace: <code>${cfg.data.token}</code></li></ol>
<p>Ollama: ${ollamaLine(syncer.state)} · modelos: ${wantedModels(cfg).map(escape).join(', ') || 'los que pida la oficina al enlazar este nodo'}</p>
<p>Impresora: ${info.configured ? (info.connected ? `<span class="ok">conectada (${escape(info.state?.estado || '')})</span>` : `<span class="warn">sin conexión: ${escape(info.error || '')}</span>`) : 'sin configurar (se configura desde la oficina principal)'}</p></main></html>`);
  });
  const auth = (req, res, next) => (same(String(req.headers['x-nodo-token'] || ''), cfg.data.token) ? next() : res.status(401).json({ error: 'Código de enlace incorrecto' }));
  app.get('/nodo/info', auth, async (_req, res) => {
    let ollama = { running: false, models: [] };
    try {
      const r = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(2500) });
      ollama = { running: true, models: ((await r.json()).models || []).map((m) => m.name) };
    } catch {
      /* Ollama no está abierto */
    }
    res.json({
      name: cfg.data.name, platform: process.platform, cpus: os.cpus().length, memGB: Math.round(os.totalmem() / 1e9),
      tailscale: tailscaleAddresses(), printer: printerInfo(settings()), ollama: { ...ollama, wanted: wantedModels(cfg), sync: syncer.state }, cad: await detectCad({}),
      version: await nodeVersion(), updating: { running: updating.running, error: updating.error },
    });
  });
  // La oficina principal le dice qué modelos usan sus IAs; el nodo descarga los que falten.
  app.put('/nodo/modelos', auth, express.json(), (req, res) => {
    const models = Array.isArray(req.body?.models) ? [...new Set(req.body.models.map(String).filter((m) => MODEL_RE.test(m)))].slice(0, 40) : null;
    if (!models) return res.status(400).json({ error: 'Falta la lista de modelos' });
    const changed = JSON.stringify(models) !== JSON.stringify(cfg.data.ollamaModels);
    cfg.data.ollamaModels = models;
    cfg.save();
    if (changed || req.body?.now) syncer.run();
    res.json({ wanted: models, sync: syncer.state });
  });
  app.get('/nodo/modelos', auth, (_req, res) => res.json({ wanted: wantedModels(cfg), sync: syncer.state }));
  // Actualizaciones del nodo (las pide la oficina principal al actualizarse).
  app.get('/nodo/update', auth, async (req, res) => res.json({ ...(await updateStatus(ROOT, { fetch: req.query.fetch !== '0' })), updating }));
  app.post('/nodo/update', auth, (_req, res) => {
    if (!fs.existsSync(path.join(ROOT, '.git'))) return res.status(409).json({ error: 'Este nodo no se instaló con instalar.bat: actualízalo a mano.' });
    update();
    res.status(202).json({ ok: true, restart: process.env.OFICINA_LANZADOR === '1' });
  });
  app.use('/nodo/printer', express.json());
  app.get('/nodo/printer/status', auth, (_req, res) => res.json(printerInfo(settings())));
  app.put('/nodo/printer', auth, (req, res) => {
    const b = req.body || {};
    const prev = cfg.data.printer || {};
    const host = String(b.host ?? prev.host ?? '').trim();
    if (host && !isLanHost(host)) return res.status(400).json({ error: 'Usa la IP local de la impresora (por ejemplo 192.168.1.50)' });
    cfg.data.printer = {
      name: String(b.name ?? prev.name ?? 'Mi P1S').slice(0, 40), model: String(b.model ?? prev.model ?? 'P1S'), host,
      port: Number(b.port || prev.port || 8883), cameraPort: Number(b.cameraPort || prev.cameraPort || 6000),
      serial: String(b.serial ?? prev.serial ?? '').trim().toUpperCase(),
      accessCode: typeof b.accessCode === 'string' && b.accessCode.trim() ? b.accessCode.trim() : prev.accessCode || '',
    };
    cfg.save();
    connectPrinter(settings());
    res.json(printerInfo(settings()));
  });
  app.delete('/nodo/printer', auth, (_req, res) => {
    delete cfg.data.printer;
    cfg.save();
    connectPrinter(settings());
    res.json(printerInfo(settings()));
  });
  app.post('/nodo/printer/command', auth, (req, res) => {
    const command = String(req.body?.command || '');
    if (!PRINTER_COMMANDS.includes(command)) return res.status(400).json({ error: 'Orden desconocida' });
    try {
      const p = getPrinter();
      if (!p?.connected) throw new Error(printerInfo(settings()).error || 'No estoy conectado a la impresora');
      p.command(command);
      res.json({ ok: true });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });
  app.get('/nodo/printer/camera.jpg', auth, async (_req, res) => {
    const c = cfg.data.printer;
    if (!c?.host) return res.status(404).json({ error: 'Impresora sin configurar' });
    try {
      const img = await cameraFrame({ host: c.host, accessCode: c.accessCode, port: c.cameraPort || 6000 }, { plain: process.env.OFICINA_PRINTER_PLAIN === '1' });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.end(img);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
  // Ollama del nodo: la oficina principal lo usa a través de aquí (con el código de enlace).
  app.use('/nodo/ollama', auth, express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
    try {
      const r = await fetch(`${ollamaUrl()}${req.url}`, { method: req.method, headers: { 'Content-Type': req.headers['content-type'] || 'application/json' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body });
      res.status(r.status);
      res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
      for await (const chunk of r.body) res.write(chunk);
      res.end();
    } catch {
      res.status(502).json({ error: 'Ollama no está abierto en el nodo' });
    }
  });
  return app;
}

function ollamaLine(st) {
  if (st.running) return `descargando ${escape(st.current || 'modelos')}…`;
  if (st.error) return `<span class="warn">${escape(st.error)}</span>`;
  if (st.failed?.length) return `<span class="warn">no pude descargar ${st.failed.map((f) => escape(f.model)).join(', ')}</span>`;
  return st.at ? '<span class="ok">modelos listos</span>' : 'revisando…';
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = new NodeConfig(nodeDataDir());
  const syncer = modelSyncer(cfg);
  const app = createNodeApp(cfg, { syncer });
  const listen = (host) => app.listen(NODE_PORT, host).on('error', (e) => console.warn(`[nodo] ${host}: ${e.message}`));
  listen('127.0.0.1');
  let ips = tailscaleAddresses();
  ips.forEach(listen);
  // Si Tailscale se conecta después, empieza a escuchar ahí también.
  setInterval(() => {
    const now = tailscaleAddresses();
    for (const ip of now) if (!ips.includes(ip)) listen(ip);
    ips = now;
  }, 60000).unref();
  // Ollama: se enciende y descarga los modelos que usan las IAs.
  startOllama().then((ok) => {
    if (!ok) return console.log('  🦙 No encontré Ollama funcionando. Instálalo desde https://ollama.com/download (nodo.bat lo instala solo).');
    console.log(`  🦙 Ollama listo. Reviso los modelos: ${wantedModels(cfg).join(', ') || 'ninguno'}`);
    syncer.run().then((st) => console.log(st.error ? `  🦙 ${st.error}` : `  🦙 Modelos al día${st.failed.length ? ` (fallaron: ${st.failed.map((f) => f.model).join(', ')})` : ''}.`));
  });
  // Cada 6 horas busca actualizaciones y, si no está imprimiendo, se actualiza y se reinicia.
  if (process.env.OFICINA_LANZADOR === '1') {
    setInterval(async () => {
      const st = await updateStatus(ROOT).catch(() => null);
      const printing = ['RUNNING', 'PAUSE', 'PREPARE'].includes(getPrinter()?.state?.codigo);
      if (st?.behind > 0 && !printing) {
        console.log(`  ⬆️ Hay ${st.behind} cambios nuevos: actualizando el nodo…`);
        updateNode();
      }
    }, 6 * 3600000).unref();
  }
  console.log(`\n  🛰️ Nodo «${cfg.data.name}» listo. Abre http://localhost:${NODE_PORT} para ver su código de enlace.`);
  console.log(`  Dirección para la oficina principal: ${ips.filter((ip) => !ip.includes(':')).map((ip) => `http://${ip}:${NODE_PORT}`).join(' ') || '(activa Tailscale)'}\n`);
}
