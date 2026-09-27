// Nodo de la Oficina de IAs: corre en tus otros computadores (con nodo.bat) y
// le presta a la oficina principal lo que ese equipo tiene cerca: la impresora
// Bambu Lab de esa casa y su Ollama. Solo escucha en este computador y en
// Tailscale, y cada petición debe traer el código de enlace del nodo.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPrinter, getPrinter, printerInfo, cameraFrame, PRINTER_COMMANDS, isLanHost } from './bambu.js';
import { detectCad } from './cad.js';
import { hostAllowed, tailscaleAddresses } from './auth.js';

export const NODE_PORT = Number(process.env.OFICINA_NODO_PORT || 4748);
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

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

export function createNodeApp(cfg, { remoteHosts = [] } = {}) {
  const settings = () => ({ printer: cfg.data.printer, remote: { enabled: true, extraHosts: remoteHosts } });
  connectPrinter(settings());
  const app = express();
  // Solo este computador, Tailscale y los nombres de Tailscale (protege contra páginas maliciosas).
  app.use((req, res, next) => (hostAllowed(settings(), req.headers.host) && !req.headers.origin ? next() : res.status(403).json({ error: 'No permitido' })));
  const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  // La página del nodo (solo en este computador) muestra el código de enlace.
  app.get('/', (req, res) => {
    if (!isLocal(req)) return res.status(403).send('Abre esta página en el computador del nodo.');
    const info = printerInfo(settings());
    const urls = tailscaleAddresses().filter((ip) => !ip.includes(':')).map((ip) => `http://${ip}:${NODE_PORT}`);
    res.type('html').send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nodo de la Oficina de IAs</title>
<style>body{font:15px system-ui,sans-serif;background:#151024;color:#eee;margin:0;padding:24px;display:grid;place-items:center;min-height:100vh}main{max-width:560px;background:#1f1830;border:1px solid #3b2f55;border-radius:16px;padding:24px}code{background:#0f0b1a;padding:4px 8px;border-radius:6px;word-break:break-all;user-select:all}.ok{color:#4ade80}.warn{color:#fbbf24}li{margin:6px 0}</style>
<main><h1>🛰️ Nodo «${escape(cfg.data.name)}»</h1>
<p>Este computador le presta a tu oficina principal lo que tiene cerca (impresora y Ollama). Déjalo abierto.</p>
<ol><li>En la oficina principal ve a <b>Ajustes → Nodos</b> y pulsa <b>Agregar nodo</b>.</li>
<li>Dirección del nodo: ${urls.length ? urls.map((u) => `<code>${u}</code>`).join(' ') : '<span class="warn">todavía no detecto Tailscale en este computador</span>'}</li>
<li>Código de enlace: <code>${cfg.data.token}</code></li></ol>
<p>Impresora: ${info.configured ? (info.connected ? `<span class="ok">conectada (${escape(info.state?.estado || '')})</span>` : `<span class="warn">sin conexión: ${escape(info.error || '')}</span>`) : 'sin configurar (se configura desde la oficina principal)'}</p></main></html>`);
  });
  const auth = (req, res, next) => (same(String(req.headers['x-nodo-token'] || ''), cfg.data.token) ? next() : res.status(401).json({ error: 'Código de enlace incorrecto' }));
  app.get('/nodo/info', auth, async (_req, res) => {
    let ollama = { running: false, models: [] };
    try {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) });
      ollama = { running: true, models: ((await r.json()).models || []).map((m) => m.name) };
    } catch {
      /* Ollama no está abierto */
    }
    res.json({
      name: cfg.data.name, platform: process.platform, cpus: os.cpus().length, memGB: Math.round(os.totalmem() / 1e9),
      tailscale: tailscaleAddresses(), printer: printerInfo(settings()), ollama, cad: await detectCad({}),
    });
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
      const r = await fetch(`${OLLAMA}${req.url}`, { method: req.method, headers: { 'Content-Type': req.headers['content-type'] || 'application/json' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body });
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

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = new NodeConfig(nodeDataDir());
  const app = createNodeApp(cfg);
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
  console.log(`\n  🛰️ Nodo «${cfg.data.name}» listo. Abre http://localhost:${NODE_PORT} para ver su código de enlace.`);
  console.log(`  Dirección para la oficina principal: ${ips.filter((ip) => !ip.includes(':')).map((ip) => `http://${ip}:${NODE_PORT}`).join(' ') || '(activa Tailscale)'}\n`);
}
