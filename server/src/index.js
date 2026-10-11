// Servidor de la Oficina de IAs: API REST + eventos en vivo (SSE) y, en
// producción, la interfaz web compilada.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Notes } from './notes.js';
import { DEFAULT_AGENTS, DEPARTMENTS } from './agents.js';
import { PROVIDERS, cloudflareAccount, hasKey, isLive, usableFilter, detectClis, cliCommand, callModel, setUsageSink, setCallSink } from './providers.js';
import { recordCall, accuracyOf, loadOf, juryReport, juryStep, healthOf } from './metrics.js';
import { normalizeAutomation, runAutomation } from './automations.js';
import { connectPrinter, PRINTER_COMMANDS } from './bambu.js';
import { addNode, diagnoseNode, nodeById, nodeCall, nodeModels, printerCamera, printerCommand, printerNow, publicNode, pushNodeModels, savePrinter, startNodeModelSync, startNodePrinterPoll, updateNodes } from './devices.js';
import { generate3d, trellisReady } from './model3d.js';
import { VIDEO_SERVICES, ffmpegPath, generateVideo, videoService, videosDir } from './video.js';
import { IMAGE_SERVICES, generateImage, imageService, imagesDir, saveImage } from './images.js';
import { MCP_SERVICES, mcpAdd, mcpLoginCommand, mcpRemove, mcpStatus } from './mcpServices.js';
import { busyNow, ollamaModelsFor, ollamaPull, ollamaServer, ollamaServers, ollamaTags, hasModel, syncModels } from './ollama.js';
import { requestAccess } from './access.js';
import { resolveDataDir, moveDataTo, setDataDir } from './datadir.js';
import { updateStatus, applyUpdate, RESTART_CODE } from './updater.js';
import { COOKIE, cookieOf, createUser, hashPassword, hostAllowed, login, logout, needsAdmin, publicUser, tailscaleAddresses, userFromSession } from './auth.js';
import { bus, runTask, resumeTask, chatWithAgent, selfTrain, dailySummary, running, streamer, agentStatus, buildSystem } from './orchestrator.js';
import { FREE_MODELS, freePlan, healAgents, rescuePlan } from './freeModels.js';
import { CAD_TOOLS, detectCad, runCad, openInApp, openInBambu, sliceJob, extractCadBlocks, listFiles } from './cad.js';
import { hubsOf, normalizeHubs, hubStats, hubBridges, crossHubSuggestions, askHub, writeHubProfile } from './hubs.js';
import { openTerminal, manualCommand, runLogged, openPath } from './system.js';
import { listRequests, decide, addGrant } from './access.js';
import { normalizeAssistants, SUGGESTED } from './assistants.js';
import { addonSource, blenderCall, blenderStatus, installAddon, sceneText } from './blender.js';
import os from 'node:os';
import crypto from 'node:crypto';
import { seedWelcome } from './seed.js';
import { Vault, parseMarkdownFile } from './vault.js';
import { suggestConnections, applyConnection } from './librarian.js';
import { runMeeting } from './meetings.js';
import { createRoutine, normalizeRoutine, startScheduler } from './routines.js';
import { FLOWS, flowPlan } from './flows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
// Tus datos viven fuera del programa (Documentos/Oficina de IAs), para que actualizar no los toque.
const dataDir = () => resolveDataDir(ROOT);
const PORT = Number(process.env.PORT || 4747);
// Solo tu computador puede usar la oficina (tiene tus claves y puede ejecutar CLIs).
const HOST = process.env.HOST || '127.0.0.1';

/**
 * Una tarea en espera guarda su contexto (adjuntos, enlaces) para retomarse;
 * eso no se le envía a la interfaz: solo cuándo se retoma y cuántos intentos van.
 */
const hideResume = (k, v) => (k === 'resume' && v && typeof v === 'object' ? { at: v.at, attempts: v.attempts } : v);

export function createApp(store) {
  const notes = new Notes(store);

  // Primera ejecución: contratar al equipo y dejar notas de bienvenida.
  if (!store.data.agents.length) {
    store.data.agents = structuredClone(DEFAULT_AGENTS);
    seedWelcome(notes);
    store.data.settings.playbooksSeeded = true;
    store.flush();
  } else if (!store.data.settings.playbooksSeeded) {
    // Oficinas creadas antes de los manuales: se los agregamos una sola vez
    // (si luego el usuario quita uno, no vuelve a aparecer).
    for (const a of store.data.agents) {
      const d = DEFAULT_AGENTS.find((x) => x.id === a.id);
      a.knowledge ||= [];
      if (d && !a.knowledge.some((k) => k.builtin)) a.knowledge.unshift(...structuredClone(d.knowledge));
    }
    store.data.settings.playbooksSeeded = true;
    store.save();
  }

  // Oficinas creadas antes del Taller 3D: se contratan sus IAs una sola vez.
  if (!store.data.settings.taller3dSeeded) {
    for (const d of DEFAULT_AGENTS.filter((a) => a.department === 'impresion3d')) {
      if (!store.data.agents.some((a) => a.id === d.id)) store.data.agents.push(structuredClone(d));
    }
    store.data.settings.taller3dSeeded = true;
    store.save();
  }

  // IAs nuevas de la plantilla: se contratan una sola vez (si luego las despides, no vuelven).
  const NEW_AGENTS = { agentsV3Seeded: ['voltio', 'laser', 'celda', 'clip', 'newton', 'forma'], gemma4Seeded: ['gemma4'], ollamaV2Seeded: ['coda-local', 'deep-razona', 'qwen-local', 'brisa', 'granito', 'llamita'], undermindSeeded: ['undermind'], minimaxSeeded: ['maxi'], freeV3Seeded: ['zeta', 'samba', 'rayo'], cloudV1Seeded: ['titan'], nvidiaV2Seeded: ['galena', 'balance', 'musa'] };
  for (const [flag, ids] of Object.entries(NEW_AGENTS)) {
    if (store.data.settings[flag]) continue;
    for (const id of ids) if (!store.data.agents.some((a) => a.id === id)) store.data.agents.push(structuredClone(DEFAULT_AGENTS.find((a) => a.id === id)));
    store.data.settings[flag] = true;
    store.save();
  }

  // Google limitó los modelos 2.x a cuentas que ya los usaban: se pasan a los 3.x gratis (una vez).
  if (!store.data.settings.gemini3Seeded) {
    const NEW = { 'gemini-2.5-pro': 'gemini-3.8-flash', 'gemini-2.5-flash': 'gemini-3.7-flash', 'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite', 'gemini-2.0-flash': 'gemini-3.7-flash', 'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite', 'gemini-1.5-pro': 'gemini-3.8-flash', 'gemini-1.5-flash': 'gemini-3.7-flash' };
    for (const a of store.data.agents) {
      if (a.provider === 'google' && NEW[a.model]) a.model = NEW[a.model];
      for (const s of a.assistants || []) if (s.provider === 'google' && NEW[s.model]) s.model = NEW[s.model];
    }
    store.data.settings.gemini3Seeded = true;
    store.save();
  }

  // Modelos que los proveedores retiraron: se pasan a su reemplazo gratis (cada vez que abre).
  const healed = healAgents(store.data.agents);
  if (healed) {
    console.log(`  🔧 Actualicé ${healed} modelos que los proveedores retiraron.`);
    store.save();
  }

  // Oficinas anteriores a los jefes de departamento: se nombran una sola vez.
  if (!store.data.settings.headsSeeded) {
    for (const d of DEFAULT_AGENTS.filter((a) => a.isHead)) {
      const a = store.data.agents.find((x) => x.id === d.id);
      if (a && !store.data.agents.some((x) => x.isHead && x.department === a.department)) a.isHead = true;
    }
    store.data.settings.headsSeeded = true;
    store.save();
  }

  // Tareas o reuniones que quedaron a medias por un reinicio: si se guardó lo
  // necesario, la tarea se retoma sola en unos segundos (lo ya hecho se conserva).
  for (const t of store.data.tasks) {
    if (!['done', 'error', 'waiting'].includes(t.status) && t.resume?.context !== undefined) {
      t.status = 'waiting';
      t.resume.at = new Date(Date.now() + 5000).toISOString();
      t.final = '⏳ La oficina se cerró mientras el equipo trabajaba: la tarea se retoma sola (lo que ya estaba hecho se conserva).';
      for (const st of t.steps) if (st.status === 'working') st.status = 'pending';
    } else if (!['done', 'error', 'waiting'].includes(t.status)) {
      t.status = 'error';
      t.final ||= 'Interrumpida: la oficina se cerró mientras el equipo trabajaba. Puedes volver a enviarla.';
      for (const st of t.steps) if (st.status === 'working' || st.status === 'pending') st.status = 'error', st.error ||= 'Interrumpida por un reinicio';
    }
  }
  for (const m of store.data.meetings || []) if (m.status === 'running') m.status = 'error', m.speaking = null;
  for (const c of store.data.cards || []) {
    const t = c.taskId && store.data.tasks.find((x) => x.id === c.taskId);
    if (c.column === 'doing' && (!t || t.status === 'error')) c.column = 'todo', c.taskId = null;
  }

  // Uso por proveedor (llamadas reales, no simuladas).
  setUsageSink(({ provider, calls, inChars, outChars }) => {
    const u = ((store.data.usage ||= {})[provider] ||= { calls: 0, inChars: 0, outChars: 0 });
    u.calls += calls;
    u.inChars += inChars;
    u.outChars += outChars;
    store.save();
  });

  // Medidores de acierto y carga de cada IA.
  setCallSink((c) => recordCall(store, c));

  // Bóveda .md sincronizada para abrirla en Obsidian.
  const vault = new Vault(path.join(store.dir, 'boveda'));
  const onEvent = (e) => e.type === 'notes' && vault.schedule(store.data.notes);
  bus.on('event', onEvent);
  vault.schedule(store.data.notes);

  const app = express();
  // Evita que otras páginas web abiertas en tu navegador usen la API (DNS rebinding):
  // solo se aceptan los nombres de este computador (y los de Tailscale si activas el acceso remoto).
  app.use((req, res, next) => {
    const host = String(req.headers.host || '');
    const origin = req.headers.origin;
    if (req.path.startsWith('/api/hooks/') && !origin) return next(); // n8n (en Docker llega con otro Host)
    if (!process.env.HOST && !hostAllowed(store.data.settings, host)) return res.status(403).json({ error: 'Acceso solo desde este computador' });
    if (origin) {
      let oh = '';
      try {
        oh = new URL(origin).host;
      } catch {
        /* origen raro */
      }
      if (oh !== host && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(oh)) return res.status(403).json({ error: 'Acceso solo desde este computador' });
    }
    next();
  });
  app.use(express.json({ limit: '25mb' }));
  // Token de la API (lo usan la extensión de Claude Desktop y n8n).
  const apiToken = () => {
    if (!store.data.settings.apiToken) {
      store.data.settings.apiToken = crypto.randomBytes(24).toString('hex');
      store.save();
    }
    return store.data.settings.apiToken;
  };
  app.use((req, _res, next) => {
    const auth = String(req.headers.authorization || '');
    req.viaToken = auth.startsWith('Bearer ') && auth.slice(7) === apiToken();
    next();
  });
  // Quién hace la petición: este computador, la API (Claude Desktop, n8n) o un usuario con sesión.
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (req.viaToken) req.user = { id: 'api', name: 'API', role: 'admin' };
    else if (isLocal(req) && ['localhost', '127.0.0.1', '[::1]'].includes(host)) req.user = { id: 'local', name: 'Este computador', role: 'admin', local: true };
    else req.user = publicUser(userFromSession(store, cookieOf(req)));
    if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth/') || req.path.startsWith('/api/hooks/')) return next();
    if (!req.user) return res.status(401).json({ error: 'Inicia sesión para usar la oficina', login: true });
    if (req.user.role !== 'admin' && needsAdmin(req.method, req.path)) return res.status(403).json({ error: 'Solo un administrador puede hacer esto' });
    next();
  });
  // Núcleo activo (quién usa la oficina: Nicolás, Santiago, Miguel…): las notas nuevas quedan en su núcleo.
  app.use((req, _res, next) => {
    const h = String(req.headers['x-nucleo'] || req.user?.hub || '');
    req.hub = hubsOf(store).some((x) => x.id === h) ? h : 'cerebro';
    next();
  });

  const agentById = (id) => store.data.agents.find((a) => a.id === id);
  // ¿La petición viene de este mismo computador?
  const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const publicSettings = () => {
    const { apiKeys, ...rest } = store.data.settings;
    const keys = {};
    for (const p of Object.keys(PROVIDERS)) {
      const v = apiKeys?.[p];
      keys[p] = { configured: hasKey(store.data.settings, p), preview: v ? `${v.slice(0, 4)}…${v.slice(-4)}` : null };
    }
    const cli = {};
    for (const [p, def] of Object.entries(PROVIDERS)) {
      if (def.cli) cli[p] = { enabled: Boolean(rest.cli?.[p]?.enabled), command: cliCommand(store.data.settings, p), defaultCommand: def.command };
    }
    delete rest.blenderToken; // la clave del complemento no sale del servidor
    delete rest.apiToken;
    delete rest.hookToken;
    delete rest.printer; // el código de acceso de la impresora no sale del servidor
    delete rest.nodes; // ni los códigos de enlace de los nodos
    delete rest.users; // las contraseñas (cifradas) tampoco
    const img = rest.images || {};
    rest.video = { service: rest.video?.service || null, enabled: rest.video?.enabled !== false, active: videoService(store.data.settings) };
    rest.images = { service: img.service || null, enabled: img.enabled !== false, cloudflareAccount: img.cloudflareAccount || '', cloudflareToken: Boolean(img.cloudflareToken), pollinationsKey: Boolean(img.pollinationsKey), active: imageService(store.data.settings) || null };
    const accounts = (rest.accounts || []).map(({ key, ...a }) => ({ ...a, preview: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null }));
    return { ...rest, keys, cli, accounts, grants: rest.grants || [], accessEnabled: rest.accessEnabled !== false, hubs: hubsOf(store), cadPaths: rest.cadPaths || {}, cloudflareAccount: cloudflareAccount(store.data.settings), ovhAnon: Boolean(apiKeys?.ovhAnon), onlyLive: rest.onlyLive !== false, ollamaEnabled: Boolean(apiKeys?.ollamaEnabled), ollamaUrl: apiKeys?.ollamaUrl || '' };
  };

  // --- Meta ---
  app.get('/api/meta', (_req, res) => {
    res.json({
      departments: DEPARTMENTS,
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, keyUrl: p.keyUrl, keyless: Boolean(p.keyless), cli: Boolean(p.cli), tier: p.tier, hint: p.hint, npm: p.npm || null })),
      freeModels: FREE_MODELS,
      cadTools: Object.entries(CAD_TOOLS).map(([id, t]) => ({ id, label: t.label, url: t.url })),
      vaultPath: vault.dir,
      flows: FLOWS.map((f) => ({ id: f.id, name: f.name, agentIds: f.steps.map(([a]) => a) })),
      suggestedAssistants: SUGGESTED,
    });
  });

  // --- Ajustes ---
  app.get('/api/settings', (_req, res) => res.json(publicSettings()));
  app.post('/api/providers/:id/test', async (req, res) => {
    const provider = req.params.id;
    if (!PROVIDERS[provider]) return res.status(404).json({ error: 'Proveedor desconocido' });
    if (!hasKey(store.data.settings, provider)) return res.status(400).json({ error: 'Primero guarda la clave o activa la herramienta' });
    const agent = store.data.agents.find((a) => a.provider === provider && a.model) || store.data.agents.find((a) => a.provider === provider);
    const model = req.body?.model || agent?.model;
    if (!model && !PROVIDERS[provider].cli) return res.status(400).json({ error: 'Ninguna IA usa este proveedor todavía; asígnale uno en su perfil' });
    const t0 = Date.now();
    try {
      const r = await callModel({ ...store.data.settings, demoMode: 'auto' }, {
        provider, model, agent, effort: 'low', system: 'Eres una prueba de conexión.', messages: [{ role: 'user', content: 'Responde solo con: OK' }],
      });
      res.json({ ok: true, model, ms: Date.now() - t0, reply: r.text.slice(0, 120) });
    } catch (err) {
      res.status(502).json({ ok: false, model, error: err.message });
    }
  });
  app.get('/api/usage', (_req, res) => res.json(store.data.usage || {}));
  app.get('/api/jury', (_req, res) => res.json({ settings: store.data.settings.jury || { enabled: false, size: 2 }, ...juryReport(store) }));
  // Pedir al jurado que califique un aporte ya hecho.
  app.post('/api/tasks/:id/steps/:agentId/jury', async (req, res) => {
    const t = store.data.tasks.find((x) => x.id === req.params.id);
    const st = t?.steps.find((x) => x.agentId === req.params.agentId);
    if (!st) return res.status(404).json({ error: 'No existe' });
    if (st.simulated) return res.status(400).json({ error: 'Es una respuesta simulada (modo demo): el jurado solo califica respuestas reales' });
    const j = await juryStep(store, t, st, Number(req.body?.size) || store.data.settings.jury?.size || 2);
    if (!j) return res.status(400).json({ error: 'No hay IAs conectadas que puedan ser jurado (necesitan un proveedor conectado)' });
    st.jury = j;
    store.save();
    bus.emit('event', { type: 'task', task: t });
    res.json(j);
  });
  app.get('/api/metrics', (_req, res) => {
    const busy = new Map();
    for (const t of store.data.tasks) {
      if (t.status === 'done' || t.status === 'error') continue;
      for (const st of t.steps) if (st.status === 'working') busy.set(st.agentId, (busy.get(st.agentId) || 0) + 1);
    }
    res.json(Object.fromEntries(store.data.agents.map((a) => [a.id, { accuracy: accuracyOf(store, a), load: loadOf(store, a, busy.get(a.id) || 0) }])));
  });
  app.delete('/api/usage', (_req, res) => {
    store.data.usage = {};
    store.save();
    res.json({ ok: true });
  });
  app.get('/api/cli/detect', async (_req, res) => res.json(await detectClis()));
  app.put('/api/settings', (req, res) => {
    const s = store.data.settings;
    const { apiKeys, demoMode, maxParallel, ollamaEnabled, ollamaUrl, cli, reviewFinal, maxTeam, webSearch, autoCards, hubs, cadPaths, accessEnabled } = req.body || {};
    if (accessEnabled !== undefined) s.accessEnabled = Boolean(accessEnabled);
    if (req.body?.onlyLive !== undefined) s.onlyLive = Boolean(req.body.onlyLive);
    if (req.body?.video && typeof req.body.video === 'object') {
      const v = (s.video ||= {});
      if (req.body.video.service !== undefined) v.service = VIDEO_SERVICES[req.body.video.service] ? req.body.video.service : null;
      if (req.body.video.enabled !== undefined) v.enabled = Boolean(req.body.video.enabled);
    }
    if (req.body?.images && typeof req.body.images === 'object') {
      const b = req.body.images;
      const img = (s.images ||= {});
      if (b.service !== undefined) img.service = IMAGE_SERVICES[b.service] ? b.service : null;
      if (b.enabled !== undefined) img.enabled = Boolean(b.enabled);
      if (b.cloudflareAccount !== undefined) img.cloudflareAccount = String(b.cloudflareAccount).trim().slice(0, 64);
      // Las claves solo se cambian si llegan escritas (vacías = se conservan; null = se borran).
      for (const k of ['cloudflareToken', 'pollinationsKey']) {
        if (b[k] === null) delete img[k];
        else if (typeof b[k] === 'string' && b[k].trim()) img[k] = b[k].trim();
      }
    }
    if (req.body?.headsReview !== undefined) s.headsReview = Boolean(req.body.headsReview);
    if (req.body?.ollamaNode !== undefined) {
      if (req.body.ollamaNode && !(s.nodes || []).some((n) => n.id === req.body.ollamaNode)) return res.status(400).json({ error: 'Ese nodo no existe' });
      if (req.body.ollamaNode) s.ollamaNode = req.body.ollamaNode;
      else delete s.ollamaNode;
      setImmediate(() => modelSync.changed()); // cambia qué computador corre las IAs sin Ollama elegido
    }
    if (req.body?.verifySteps !== undefined) s.verifySteps = Boolean(req.body.verifySteps);
    if (req.body?.jury && typeof req.body.jury === 'object') s.jury = { enabled: Boolean(req.body.jury.enabled), size: Math.max(1, Math.min(3, Number(req.body.jury.size) || 2)) };
    if (req.body?.blenderControl !== undefined) s.blenderControl = Boolean(req.body.blenderControl);
    if (hubs !== undefined) s.hubs = normalizeHubs(hubs);
    if (cadPaths && typeof cadPaths === 'object') {
      s.cadPaths ||= {};
      for (const [k, v] of Object.entries(cadPaths)) {
        if (!(k in CAD_TOOLS)) continue;
        if (typeof v === 'string' && v.trim()) s.cadPaths[k] = v.trim();
        else delete s.cadPaths[k];
      }
    }
    if (autoCards !== undefined) s.autoCards = Boolean(autoCards);
    if (webSearch !== undefined) s.webSearch = Boolean(webSearch);
    if (maxTeam) s.maxTeam = Math.max(1, Math.min(8, Number(maxTeam)));
    if (reviewFinal !== undefined) s.reviewFinal = Boolean(reviewFinal);
    if (cli && typeof cli === 'object') {
      s.cli ||= {};
      for (const [p, v] of Object.entries(cli)) {
        if (!PROVIDERS[p]?.cli || !v) continue;
        s.cli[p] = { ...s.cli[p] };
        if (v.enabled !== undefined) s.cli[p].enabled = Boolean(v.enabled);
        // Sin {prompt} el texto va por la entrada estándar; vacío vuelve al comando por defecto.
        if (typeof v.command === 'string') {
          if (v.command.trim()) s.cli[p].command = v.command.trim();
          else delete s.cli[p].command;
        }
      }
    }
    if (apiKeys) {
      s.apiKeys ||= {};
      for (const [k, v] of Object.entries(apiKeys)) {
        if (!(k in PROVIDERS)) continue;
        if (v === null || v === '') delete s.apiKeys[k];
        else if (typeof v === 'string') s.apiKeys[k] = v.trim();
      }
    }
    if (ollamaEnabled !== undefined) (s.apiKeys ||= {}).ollamaEnabled = Boolean(ollamaEnabled);
    // Cloudflare necesita también el Account ID; OVHcloud se puede usar sin clave.
    if (req.body?.cloudflareAccount !== undefined) {
      const acct = String(req.body.cloudflareAccount || '').trim();
      if (acct && !/^[a-f0-9]{32}$/i.test(acct)) return res.status(400).json({ error: 'El Account ID de Cloudflare son 32 letras y números' });
      if (acct) (s.apiKeys ||= {}).cloudflareAccount = acct;
      else delete s.apiKeys?.cloudflareAccount;
    }
    if (req.body?.ovhAnon !== undefined) (s.apiKeys ||= {}).ovhAnon = Boolean(req.body.ovhAnon);
    if (ollamaUrl !== undefined) (s.apiKeys ||= {}).ollamaUrl = String(ollamaUrl).trim();
    if (['auto', 'always'].includes(demoMode)) s.demoMode = demoMode;
    if (maxParallel) s.maxParallel = Math.max(1, Math.min(10, Number(maxParallel)));
    store.save();
    res.json(publicSettings());
  });

  // --- Agentes ---
  app.get('/api/agents', (_req, res) => {
    const s = store.data.settings;
    const healthy = (a) => healthOf(store, a.id).ok;
    const usable = usableFilter(s, store.data.agents, healthy);
    // usable: trabaja en tareas y se ve en el edificio (con «solo IAs conectadas», las demo no).
    res.json(store.data.agents.map((a) => ({ ...a, live: isLive(s, a), usable: a.isBrain || usable(a), health: healthOf(store, a.id) })));
  });
  app.post('/api/agents', (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Falta el nombre' });
    const agent = {
      id: Store.id('a_'),
      name: b.name, role: b.role || 'Especialista', department: b.department || 'personas',
      provider: b.provider || 'openrouter', model: b.model || '',
      skills: b.skills || [], system: b.system || `Eres ${b.name}, ${b.role || 'especialista'}.`,
      avatar: b.avatar || DEFAULT_AGENTS[1].avatar,
      knowledge: [], memory: [], stats: { tasks: 0, lastActive: null }, enabled: true,
    };
    store.data.agents.push(agent);
    store.save();
    res.status(201).json(agent);
  });
  app.put('/api/agents/:id', (req, res) => {
    const a = agentById(req.params.id);
    if (!a) return res.status(404).json({ error: 'No existe' });
    for (const k of ['name', 'role', 'department', 'provider', 'model', 'skills', 'system', 'avatar', 'enabled', 'account']) {
      if (req.body[k] !== undefined) a[k] = req.body[k];
    }
    if (req.body.assistants !== undefined) a.assistants = normalizeAssistants(req.body.assistants);
    if (req.body.delegate !== undefined) a.delegate = Boolean(req.body.delegate);
    // Un solo jefe por departamento.
    if (req.body.isHead !== undefined) {
      if (req.body.isHead) for (const o of store.data.agents) if (o.department === a.department) delete o.isHead;
      if (req.body.isHead) a.isHead = true;
      else delete a.isHead;
    }
    if (!a.account || a.account === 'default') delete a.account;
    store.save();
    modelSync.changed();
    res.json(a);
  });
  app.delete('/api/agents/:id', (req, res) => {
    const a = agentById(req.params.id);
    if (!a) return res.status(404).json({ error: 'No existe' });
    if (a.isBrain) return res.status(400).json({ error: 'El Cerebro Central no se puede despedir 🙂' });
    store.data.agents = store.data.agents.filter((x) => x.id !== a.id);
    store.save();
    res.json({ ok: true });
  });
  app.post('/api/agents/reset', (_req, res) => {
    // Restaura la plantilla conservando entrenamiento y memoria.
    const old = new Map(store.data.agents.map((a) => [a.id, a]));
    const custom = store.data.agents.filter((a) => !DEFAULT_AGENTS.some((d) => d.id === a.id));
    store.data.agents = [
      ...structuredClone(DEFAULT_AGENTS).map((d) => ({
        ...d,
        knowledge: [...d.knowledge, ...(old.get(d.id)?.knowledge || []).filter((k) => !k.builtin)],
        memory: old.get(d.id)?.memory || [], stats: old.get(d.id)?.stats || d.stats,
      })),
      ...custom,
    ];
    store.save();
    res.json(store.data.agents);
  });

  // Entrenamiento: conocimiento que el usuario le enseña a un agente.
  app.post('/api/agents/:id/knowledge', (req, res) => {
    const a = agentById(req.params.id);
    if (!a) return res.status(404).json({ error: 'No existe' });
    const { title, content } = req.body || {};
    if (!content) return res.status(400).json({ error: 'Falta el contenido' });
    const item = { id: Store.id('k_'), title: title || 'Lección', content: String(content).slice(0, 20000), at: new Date().toISOString() };
    (a.knowledge ||= []).push(item);
    store.save();
    res.status(201).json(item);
  });
  app.delete('/api/agents/:id/knowledge/:kid', (req, res) => {
    const a = agentById(req.params.id);
    if (!a) return res.status(404).json({ error: 'No existe' });
    a.knowledge = (a.knowledge || []).filter((k) => k.id !== req.params.kid);
    store.save();
    res.json({ ok: true });
  });
  app.post('/api/agents/:id/self-train', async (req, res) => {
    try {
      res.status(201).json(await selfTrain(store, req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.delete('/api/agents/:id/memory', (req, res) => {
    const a = agentById(req.params.id);
    if (!a) return res.status(404).json({ error: 'No existe' });
    a.memory = [];
    store.save();
    res.json({ ok: true });
  });

  // Chat directo con un agente.
  app.get('/api/agents/:id/chat', (req, res) => res.json(store.data.chats[req.params.id] || []));
  app.post('/api/agents/:id/chat', async (req, res) => {
    try {
      res.json(await chatWithAgent(store, req.params.id, String(req.body?.message || '')));
    } catch (err) {
      res.status(500).json({ error: err.message, kind: err.kind || null });
    }
  });
  app.delete('/api/agents/:id/chat', (req, res) => {
    delete store.data.chats[req.params.id];
    store.save();
    res.json({ ok: true });
  });

  // --- Tareas (el cerebro coordina al equipo) ---
  app.get('/api/tasks', (_req, res) => res.type('json').send(JSON.stringify(store.data.tasks.slice(0, 100), hideResume)));
  app.get('/api/tasks/:id', (req, res) => {
    const t = store.data.tasks.find((x) => x.id === req.params.id);
    return t ? res.type('json').send(JSON.stringify(t, hideResume)) : res.status(404).json({ error: 'No existe' });
  });
  app.post('/api/tasks', (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Escribe una tarea' });
    const flow = req.body.flow ? flowPlan(req.body.flow, store.data.agents) : null;
    const promise = runTask(store, notes, {
      prompt, hub: req.hub, agentIds: flow?.agentIds || req.body.agentIds, template: flow?.template, effort: req.body.effort, fromNote: typeof req.body.fromNote === 'string' ? req.body.fromNote.slice(0, 200) : null, parentId: req.body.parentId, attachments: req.body.attachments, saveNotes: req.body.saveNotes !== false,
    });
    // Respondemos enseguida; el progreso llega por /api/events.
    promise.catch((err) => console.error('[tarea]', err));
    res.status(202).json({ id: store.data.tasks[0].id });
  });
  app.post('/api/tasks/:id/steps/:agentId/rate', (req, res) => {
    const t = store.data.tasks.find((x) => x.id === req.params.id);
    const step = t?.steps.find((x) => x.agentId === req.params.agentId);
    const agent = agentById(req.params.agentId);
    if (!step || !agent) return res.status(404).json({ error: 'No existe' });
    const value = Number(req.body?.value) > 0 ? 1 : -1;
    const comment = String(req.body?.comment || '').trim().slice(0, 300);
    const prev = step.rating?.value || 0;
    step.rating = { value, comment, at: new Date().toISOString() };
    agent.stats ||= { tasks: 0, lastActive: null };
    agent.stats.likes = (agent.stats.likes || 0) + (value > 0 ? 1 : 0) - (prev > 0 ? 1 : 0);
    agent.stats.dislikes = (agent.stats.dislikes || 0) + (value < 0 ? 1 : 0) - (prev < 0 ? 1 : 0);
    // La valoración queda en su memoria para mejorar la próxima vez.
    (agent.memory ||= []).push({
      text: `${value > 0 ? 'Al usuario le gustó' : 'Al usuario NO le gustó'} mi aporte en "${t.title}"${comment ? `: ${comment}` : ''}`,
      at: new Date().toISOString(),
    });
    store.save();
    bus.emit('event', { type: 'task', task: t });
    res.json({ ok: true, stats: agent.stats });
  });
  app.post('/api/tasks/:id/cancel', (req, res) => {
    const ctrl = running.get(req.params.id);
    const t = store.data.tasks.find((x) => x.id === req.params.id);
    // Una tarea en espera (sin cupo) se cancela sin más.
    if (!ctrl && t?.status === 'waiting') {
      t.status = 'error';
      t.final = 'Cancelada por ti. Puedes reintentarla cuando quieras.';
      delete t.resume;
      for (const st of t.steps) if (st.status !== 'done') st.status = 'error', st.error ||= 'Cancelada';
      store.save();
      bus.emit('event', { type: 'task', task: t });
      return res.json({ ok: true });
    }
    if (!ctrl) return res.status(404).json({ error: 'Esa tarea no está en curso' });
    ctrl.abort();
    res.json({ ok: true });
  });
  // Retomar ya una tarea en espera (sin esperar a que vuelva el cupo).
  app.post('/api/tasks/:id/resume', (req, res) => {
    const t = store.data.tasks.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'No existe' });
    if (t.status !== 'waiting') return res.status(409).json({ error: 'Esa tarea no está en espera' });
    const p = resumeTask(store, notes, t);
    p?.catch((err) => console.error('[tarea]', err));
    res.status(202).json({ ok: true });
  });
  app.delete('/api/tasks/:id', (req, res) => {
    store.data.tasks = store.data.tasks.filter((t) => t.id !== req.params.id);
    store.save();
    res.json({ ok: true });
  });

  // --- Tablero de proyectos ---
  const COLUMNS = ['todo', 'doing', 'done'];
  const emitCards = () => bus.emit('event', { type: 'cards' });
  app.get('/api/cards', (_req, res) => res.json(store.data.cards || []));
  app.post('/api/cards', (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: 'Escribe un título' });
    const card = { id: Store.id('c_'), title, details: String(req.body?.details || '').slice(0, 4000), column: 'todo', project: String(req.body?.project || '').slice(0, 60), taskId: null, noteId: null, createdAt: new Date().toISOString() };
    (store.data.cards ||= []).push(card);
    store.save();
    emitCards();
    res.status(201).json(card);
  });
  app.put('/api/cards/:id', (req, res) => {
    const c = (store.data.cards || []).find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'No existe' });
    if (COLUMNS.includes(req.body?.column)) c.column = req.body.column;
    for (const k of ['title', 'details', 'project']) if (typeof req.body?.[k] === 'string') c[k] = req.body[k].slice(0, k === 'details' ? 4000 : 200);
    store.save();
    emitCards();
    res.json(c);
  });
  app.post('/api/cards/:id/run', (req, res) => {
    const c = (store.data.cards || []).find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'No existe' });
    const current = c.taskId && store.data.tasks.find((t) => t.id === c.taskId);
    if (current && current.status !== 'done' && current.status !== 'error') return res.status(409).json({ error: 'El equipo ya trabaja en esta tarjeta' });
    const slug = c.project.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\d]+/gu, '-').replace(/^-|-$/g, '');
    const promise = runTask(store, notes, { prompt: `${c.title}${c.details ? `\n\n${c.details}` : ''}`, hub: req.hub, tags: slug ? [slug] : [] });
    c.taskId = store.data.tasks[0].id;
    c.column = 'doing';
    store.save();
    emitCards();
    promise.catch((err) => console.error('[tablero]', err));
    res.status(202).json(c);
  });
  app.delete('/api/cards/:id', (req, res) => {
    store.data.cards = (store.data.cards || []).filter((x) => x.id !== req.params.id);
    store.save();
    emitCards();
    res.json({ ok: true });
  });

  // --- Rutinas programadas ---
  app.get('/api/routines', (_req, res) => res.json(store.data.routines || []));
  app.post('/api/routines', (req, res) => {
    const r = normalizeRoutine(req.body || {});
    if (!r.prompt) return res.status(400).json({ error: 'Escribe qué debe hacer la rutina' });
    res.status(201).json(createRoutine(store, r));
  });
  app.put('/api/routines/:id', (req, res) => {
    const r = (store.data.routines || []).find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'No existe' });
    Object.assign(r, normalizeRoutine({ ...r, ...req.body }));
    store.save();
    res.json(r);
  });
  app.post('/api/routines/:id/run', (req, res) => {
    const r = (store.data.routines || []).find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'No existe' });
    runTask(store, notes, { prompt: r.prompt, agentIds: r.agentIds.length ? r.agentIds : undefined }).catch((err) => console.error('[rutina]', err));
    res.status(202).json({ ok: true });
  });
  app.delete('/api/routines/:id', (req, res) => {
    store.data.routines = (store.data.routines || []).filter((x) => x.id !== req.params.id);
    store.save();
    res.json({ ok: true });
  });

  // --- Sala de reuniones ---
  app.get('/api/meetings', (_req, res) => res.json((store.data.meetings || []).slice(0, 50)));
  app.post('/api/meetings', (req, res) => {
    const topic = String(req.body?.topic || '').trim();
    const agentIds = Array.isArray(req.body?.agentIds) ? req.body.agentIds.slice(0, 6) : [];
    if (!topic || agentIds.length < 2) return res.status(400).json({ error: 'Escribe un tema y elige al menos 2 IAs' });
    const usable = usableFilter(store.data.settings, store.data.agents, (a) => healthOf(store, a.id).ok);
    if (agentIds.filter((id) => usable(agentById(id))).length < 2) return res.status(400).json({ error: 'Elige al menos 2 IAs conectadas (las de modo demo no participan; puedes cambiarlo en Ajustes)' });
    runMeeting(store, notes, { topic, agentIds, hub: req.hub, rounds: Number(req.body.rounds) || 2 }).catch((err) => console.error('[reunión]', err));
    res.status(202).json({ id: store.data.meetings[0].id });
  });
  app.post('/api/meetings/:id/say', (req, res) => {
    const m = (store.data.meetings || []).find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'No existe' });
    if (m.status !== 'running') return res.status(409).json({ error: 'La reunión ya terminó' });
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: 'Escribe algo' });
    const round = m.transcript.at(-1)?.round || 1;
    m.transcript.push({ agentId: 'usuario', name: 'Tú', text, round, simulated: false, at: new Date().toISOString() });
    store.save();
    bus.emit('event', { type: 'meeting', meeting: m });
    res.json({ ok: true });
  });
  app.post('/api/meetings/:id/stop', (req, res) => {
    const m = (store.data.meetings || []).find((x) => x.id === req.params.id);
    if (!m || m.status !== 'running') return res.status(409).json({ error: 'La reunión no está en curso' });
    m.stopRequested = true;
    res.json({ ok: true });
  });
  app.delete('/api/meetings/:id', (req, res) => {
    store.data.meetings = (store.data.meetings || []).filter((m) => m.id !== req.params.id);
    store.save();
    res.json({ ok: true });
  });

  // --- Notas y grafo ---
  app.get('/api/notes', (req, res) => {
    const list = notes.search(String(req.query.q || ''));
    res.json(list.map(({ content, ...n }) => ({ ...n, excerpt: content.slice(0, 160) })));
  });
  app.get('/api/notes/:id', (req, res) => {
    const n = notes.get(req.params.id);
    if (!n) return res.status(404).json({ error: 'No existe' });
    res.json({ ...n, backlinks: notes.backlinks(n.id) });
  });
  app.post('/api/notes', (req, res) => {
    const n = notes.create({ ...(req.body || {}), hub: req.body?.hub || req.hub });
    bus.emit('event', { type: 'notes' });
    res.status(201).json(n);
  });
  app.get('/api/notes/:id/mentions', (req, res) => res.json(notes.unlinkedMentions(req.params.id)));
  app.post('/api/notes/:id/mentions/:fromId/link', (req, res) => {
    const n = notes.linkMention(req.params.fromId, req.params.id);
    if (!n) return res.status(404).json({ error: 'No encontré la mención' });
    bus.emit('event', { type: 'notes' });
    res.json({ ok: true });
  });
  app.post('/api/notes/resolve', (req, res) => {
    // Abrir un [[enlace]]: si la nota no existe, se crea (como en Obsidian).
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Falta el título' });
    const n = notes.findByTitle(title) || notes.create({ title, content: '', hub: req.hub });
    bus.emit('event', { type: 'notes' });
    res.json(n);
  });
  app.post('/api/notes/daily', async (_req, res) => {
    try {
      res.status(201).json(await dailySummary(store, notes));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.post('/api/notes/import', (req, res) => {
    // Importa archivos .md (por ejemplo, de una bóveda de Obsidian).
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    let created = 0, updated = 0;
    for (const f of files.slice(0, 2000)) {
      if (!f?.name || typeof f.content !== 'string') continue;
      const parsed = parseMarkdownFile(f.name, f.content);
      const existing = notes.findByTitle(parsed.title);
      if (existing) {
        notes.update(existing.id, { content: parsed.content, tags: parsed.tags.length ? parsed.tags : existing.tags });
        updated++;
      } else {
        notes.create({ ...parsed, hub: req.hub });
        created++;
      }
    }
    bus.emit('event', { type: 'notes' });
    res.json({ created, updated });
  });
  app.put('/api/notes/:id', (req, res) => {
    const n = notes.update(req.params.id, req.body || {});
    if (!n) return res.status(404).json({ error: 'No existe' });
    bus.emit('event', { type: 'notes' });
    res.json({ ...n, backlinks: notes.backlinks(n.id) });
  });
  app.delete('/api/notes/:id', (req, res) => {
    const ok = notes.remove(req.params.id);
    bus.emit('event', { type: 'notes' });
    res.json({ ok });
  });
  app.get('/api/graph', (req, res) => {
    res.json(notes.graph({
      includeTags: req.query.tags !== '0',
      includeAgents: req.query.agents !== '0',
      agents: store.data.agents,
      hubs: req.query.hubs === '0' ? [] : hubsOf(store),
    }));
  });

  // --- Núcleos del grafo ---
  app.get('/api/hubs', (_req, res) => {
    const hubs = hubsOf(store);
    res.json({ hubs: hubs.map((h) => ({ ...h, ...hubStats(store.data.notes, h.id) })), bridges: hubBridges(store.data.notes, hubs) });
  });
  app.post('/api/hubs/:id/ask', async (req, res) => {
    const question = String(req.body?.question || '').trim().slice(0, 2000);
    if (!question) return res.status(400).json({ error: 'Escribe una pregunta' });
    try {
      const r = await askHub(store, req.params.id, question);
      if (req.body?.save) {
        const hub = hubsOf(store).find((h) => h.id === req.params.id);
        const n = notes.create({ title: `Pregunta a ${hub.name}: ${question.slice(0, 60)}`, type: 'nota', tags: ['pregunta'], hub: hub.id, content: `> ${question}\n\n${r.answer}\n\n## Fuentes\n${r.sources.map((x) => `- [[${x.title}]]`).join('\n')}` });
        r.noteId = n.id;
        bus.emit('event', { type: 'notes' });
      }
      res.json(r);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.post('/api/hubs/:id/profile', async (req, res) => {
    try {
      const n = await writeHubProfile(store, notes, req.params.id);
      bus.emit('event', { type: 'notes' });
      res.json(n);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.get('/api/hubs/suggest', (_req, res) => res.json({ suggestions: crossHubSuggestions(store.data.notes) }));

  app.post('/api/graph/suggest', async (_req, res) => {
    try {
      res.json(await suggestConnections(store));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/graph/connect', (req, res) => {
    const list = Array.isArray(req.body?.connections) ? req.body.connections : [];
    const applied = list.filter((c) => applyConnection(notes, c)).length;
    bus.emit('event', { type: 'notes' });
    res.json({ applied });
  });

  // --- Cuentas extra por proveedor (p. ej. dos cuentas de Gemini) ---
  app.post('/api/accounts', (req, res) => {
    const provider = String(req.body?.provider || '');
    const def = PROVIDERS[provider];
    if (!def || def.keyless) return res.status(400).json({ error: 'Ese proveedor no admite cuentas extra' });
    const label = String(req.body?.label || '').trim().slice(0, 40) || `Cuenta ${(store.data.settings.accounts || []).filter((a) => a.provider === provider).length + 2}`;
    const acc = { id: Store.id('acc_'), provider, label };
    if (def.cli) acc.home = path.join(store.dir, 'cuentas', acc.id);
    else {
      const key = String(req.body?.key || '').trim();
      if (!key) return res.status(400).json({ error: 'Pega la clave de esta cuenta' });
      acc.key = key;
    }
    (store.data.settings.accounts ||= []).push(acc);
    store.save();
    res.status(201).json(publicSettings());
  });
  app.delete('/api/accounts/:id', (req, res) => {
    const s = store.data.settings;
    s.accounts = (s.accounts || []).filter((a) => a.id !== req.params.id);
    for (const a of store.data.agents) if (a.account === req.params.id) delete a.account;
    store.save();
    res.json(publicSettings());
  });

  // Abre una terminal para iniciar sesión en una CLI (con la cuenta elegida).
  app.post('/api/cli/:provider/login', (req, res) => {
    const def = PROVIDERS[req.params.provider];
    if (!def?.cli) return res.status(404).json({ error: 'Herramienta desconocida' });
    const acc = (store.data.settings.accounts || []).find((a) => a.id === req.body?.account && a.provider === req.params.provider);
    const vars = {};
    if (acc?.home) {
      fs.mkdirSync(acc.home, { recursive: true });
      if (def.homeEnv) vars[def.homeEnv] = acc.home;
      else Object.assign(vars, { HOME: acc.home, USERPROFILE: acc.home });
    }
    const opened = openTerminal(def.login, vars);
    res.json({ opened, command: manualCommand(def.login, vars) });
  });

  // Instala una CLI con npm (solo las de la lista, nunca un comando libre).
  const installing = new Set();
  app.post('/api/cli/:provider/install', async (req, res) => {
    const def = PROVIDERS[req.params.provider];
    if (!def?.npm) return res.status(404).json({ error: 'Herramienta desconocida' });
    if (installing.has(def.npm)) return res.status(409).json({ error: 'Ya se está instalando' });
    installing.add(def.npm);
    const log = streamer(`install:${req.params.provider}`);
    log(`$ npm install -g ${def.npm}\n`);
    const r = await runLogged('npm', ['install', '-g', def.npm], { onData: log, shell: process.platform === 'win32' });
    log.end();
    installing.delete(def.npm);
    const found = (await detectClis())[req.params.provider];
    res.json({ ok: r.ok && Boolean(found), path: found, log: r.out.slice(-3000) });
  });

  // --- Ollama: este computador y los nodos (varios a la vez) ---
  const serverOf = (req) => ollamaServer(store.data.settings, req.query.server || req.body?.server);
  app.get('/api/ollama/servers', async (_req, res) => {
    res.json(await Promise.all(ollamaServers(store.data.settings).map(async (sv) => {
      const used = ollamaModelsFor(store.data.settings, store.data.agents, sv.id);
      const out = { id: sv.id, label: sv.label, nodeId: sv.nodeId || null, busy: busyNow(sv.id), wanted: used };
      try {
        const models = await ollamaTags(sv);
        const names = models.map((m) => m.name);
        return { ...out, running: true, models, missing: used.filter((m) => !hasModel(names, m)) };
      } catch {
        return { ...out, running: false, models: [], missing: used };
      }
    })));
  });
  app.get('/api/ollama/models', async (req, res) => {
    const sv = serverOf(req);
    try {
      res.json({ running: true, server: sv.id, models: await ollamaTags(sv) });
    } catch {
      res.json({ running: false, server: sv?.id, models: [] });
    }
  });
  app.post('/api/ollama/pull', async (req, res) => {
    const model = String(req.body?.model || '').trim();
    if (!/^[a-z0-9][a-z0-9._:/-]{0,80}$/i.test(model)) return res.status(400).json({ error: 'Nombre de modelo no válido' });
    const sv = serverOf(req);
    if (!sv) return res.status(404).json({ error: 'Ese Ollama no existe' });
    const log = streamer(`install:ollama:${model}`);
    log(`Descargando ${model} en ${sv.label}…\n`);
    try {
      await ollamaPull(sv, model, log);
      log.end();
      res.json({ ok: true, server: sv.id, log: '' });
    } catch (err) {
      log.end();
      res.json({ ok: false, server: sv.id, log: /fetch failed|ECONNREFUSED/i.test(err.message) ? `Ollama no está abierto en ${sv.label}` : err.message });
    }
  });
  // Descarga en un Ollama todos los modelos que usan las IAs y le faltan.
  app.post('/api/ollama/sync', async (req, res) => {
    const sv = serverOf(req);
    if (!sv) return res.status(404).json({ error: 'Ese Ollama no existe' });
    const log = streamer(`install:ollama-sync:${sv.id}`);
    try {
      const r = await syncModels(sv, ollamaModelsFor(store.data.settings, store.data.agents, sv.id), log);
      log.end();
      res.json({ ok: !r.failed.length, ...r });
    } catch (err) {
      log.end();
      res.status(502).json({ error: `Ollama no responde en ${sv.label}` });
    }
  });

  // --- Modo gratis: IAs de proveedores de pago pasan a modelos gratis ---
  app.post('/api/agents/free-mode', (_req, res) => {
    const s = store.data.settings;
    const connected = (p) => s.demoMode !== 'always' && hasKey(s, p);
    const changes = freePlan(store.data.agents, connected);
    for (const c of changes) {
      const a = agentById(c.id);
      a.paidBackup = c.from;
      a.provider = c.to.provider;
      a.model = c.to.model;
      delete a.account;
    }
    store.save();
    res.json({ changed: changes.length, changes });
  });
  // Suscripción de Gemini (Google AI Pro): las IAs de Google pasan a Gemini CLI
  // con tu cuenta, que da muchas más consultas al día que la clave gratis.
  app.post('/api/agents/gemini-pro', (_req, res) => {
    let n = 0;
    for (const a of store.data.agents) {
      if (a.provider !== 'google') continue;
      a.geminiBackup = { provider: a.provider, model: a.model };
      a.provider = 'cli-gemini';
      a.model = ''; // «Auto»: Gemini CLI elige Pro o Flash según la tarea
      delete a.account;
      n++;
    }
    store.save();
    res.json({ changed: n, cliEnabled: Boolean(store.data.settings.cli?.['cli-gemini']?.enabled) });
  });
  app.post('/api/agents/gemini-pro/undo', (_req, res) => {
    let n = 0;
    for (const a of store.data.agents) {
      if (!a.geminiBackup) continue;
      Object.assign(a, a.geminiBackup);
      delete a.geminiBackup;
      delete a.account;
      n++;
    }
    store.save();
    res.json({ restored: n });
  });
  // Revisar todas las IAs conectadas: una pregunta cortita a cada una. Las que
  // fallan quedan «con fallas» y no reciben trabajo hasta que vuelvan a responder.
  app.post('/api/agents/check', async (_req, res) => {
    const s = store.data.settings;
    const list = store.data.agents.filter((a) => a.enabled !== false && isLive(s, a));
    const results = [];
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const a = list[i++];
        const t0 = Date.now();
        const before = a.model;
        try {
          await callModel(s, {
            provider: a.provider, model: a.model, agent: a, effort: 'low', signal: AbortSignal.timeout(90000),
            system: 'Prueba de conexión. Responde solo con la palabra OK.', messages: [{ role: 'user', content: 'Di OK' }],
          });
          results.push({ id: a.id, name: a.name, provider: a.provider, model: a.model, ok: true, ms: Date.now() - t0, changedModel: before !== a.model ? before : undefined });
        } catch (err) {
          // Una segunda falla la deja «con fallas» (healthOf).
          const again = await callModel(s, { provider: a.provider, model: a.model, agent: a, effort: 'low', signal: AbortSignal.timeout(60000), system: 'Responde OK.', messages: [{ role: 'user', content: 'OK' }] }).then(() => null, (e) => e);
          results.push({ id: a.id, name: a.name, provider: a.provider, model: a.model, ok: !again, ms: Date.now() - t0, error: again ? String(again.message).slice(0, 240) : undefined, firstError: again ? undefined : String(err.message).slice(0, 160) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
    store.save();
    results.sort((x, y) => Number(x.ok) - Number(y.ok) || x.name.localeCompare(y.name));
    res.json({ checked: results.length, failed: results.filter((r) => !r.ok).length, results });
  });

  // Activar las IAs en demo con los proveedores gratis que ya conectaste.
  app.post('/api/agents/rescue', (_req, res) => {
    const s = store.data.settings;
    const connected = (p) => s.demoMode !== 'always' && hasKey(s, p);
    const changes = rescuePlan(store.data.agents, connected);
    for (const c of changes) {
      const a = agentById(c.id);
      a.demoBackup = c.from;
      a.provider = c.to.provider;
      a.model = c.to.model;
      delete a.account;
    }
    store.save();
    modelSync.changed();
    res.json({ changed: changes.length, changes, stillDemo: store.data.agents.filter((a) => a.enabled !== false && !isLive(s, a)).length });
  });
  app.post('/api/agents/rescue/undo', (_req, res) => {
    let n = 0;
    for (const a of store.data.agents) {
      if (!a.demoBackup) continue;
      Object.assign(a, a.demoBackup);
      delete a.demoBackup;
      n++;
    }
    store.save();
    res.json({ restored: n });
  });
  app.post('/api/agents/free-mode/undo', (_req, res) => {
    let n = 0;
    for (const a of store.data.agents) {
      if (!a.paidBackup) continue;
      a.provider = a.paidBackup.provider;
      a.model = a.paidBackup.model;
      delete a.paidBackup;
      n++;
    }
    store.save();
    res.json({ restored: n });
  });

  // --- Accesos: las IAs piden permiso para ver carpetas o abrir programas ---
  app.get('/api/access', (_req, res) => res.json({ requests: listRequests(), grants: store.data.settings.grants || [] }));
  app.post('/api/access/:id', (req, res) => {
    const ok = decide(req.params.id, String(req.body?.decision || 'deny'));
    res.status(ok ? 200 : 404).json(ok ? { ok } : { error: 'Esa petición ya no está pendiente' });
  });
  app.post('/api/grants', (req, res) => {
    try {
      const p = String(req.body?.path || '').trim();
      if (!p || !path.isAbsolute(p)) return res.status(400).json({ error: 'Escribe la ruta completa de la carpeta' });
      res.status(201).json(addGrant(store, { path: p, mode: req.body?.mode, label: req.body?.label }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.delete('/api/grants/:id', (req, res) => {
    const s = store.data.settings;
    s.grants = (s.grants || []).filter((g) => g.id !== req.params.id);
    store.save();
    res.json(s.grants);
  });
  // Carpetas comunes para dar acceso con un clic.
  app.get('/api/grants/suggest', (_req, res) => {
    const home = os.homedir();
    const names = ['Desktop', 'Escritorio', 'Documents', 'Documentos', 'Downloads', 'Descargas', 'Pictures', 'Imágenes', 'OneDrive', '3D Objects', 'Modelos'];
    res.json({ home, folders: names.map((n) => path.join(home, n)).filter((p) => fs.existsSync(p)) });
  });

  // --- Blender en vivo (complemento «Oficina de IAs») ---
  app.get('/api/blender/status', async (_req, res) => {
    const st = await blenderStatus(store);
    res.json({ ...st, blenderPath: (await detectCad(store.data.settings)).blender, control: Boolean(store.data.settings.blenderControl) });
  });
  app.get('/api/blender/addon', (_req, res) => {
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="oficina_ias.py"');
    res.send(addonSource(store));
  });
  app.post('/api/blender/install', async (_req, res) => {
    const log = streamer('install:blender');
    try {
      const r = await installAddon(store, log);
      log.end();
      res.json(r);
    } catch (err) {
      log.end();
      res.status(400).json({ error: err.message });
    }
  });
  app.get('/api/blender/escena', async (_req, res) => {
    try {
      const scene = await blenderCall(store, 'escena');
      res.json({ ...scene, texto: sceneText(scene) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  const capturas = path.join(store.dir, 'taller3d', 'capturas');
  app.post('/api/blender/captura', async (_req, res) => {
    try {
      const r = await blenderCall(store, 'captura');
      if (!r.ok) return res.status(400).json({ error: r.error });
      fs.mkdirSync(capturas, { recursive: true });
      const name = `blender-${Date.now()}.png`;
      fs.writeFileSync(path.join(capturas, name), Buffer.from(r.png, 'base64'));
      res.json({ file: name });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.get('/api/blender/capturas', (_req, res) => {
    let files = [];
    try {
      files = fs.readdirSync(capturas).filter((f) => f.endsWith('.png')).sort().reverse().slice(0, 12);
    } catch {
      /* todavía no hay capturas */
    }
    res.json(files);
  });
  app.get('/api/blender/capturas/:name', (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(capturas, name);
    if (!/^blender-\d+\.png$/.test(name) || !fs.existsSync(file)) return res.status(404).json({ error: 'No existe' });
    res.sendFile(file);
  });

  // --- Automatizaciones (n8n) ---
  const hookToken = () => {
    if (!store.data.settings.hookToken) {
      store.data.settings.hookToken = crypto.randomBytes(16).toString('hex');
      store.save();
    }
    return store.data.settings.hookToken;
  };
  app.get('/api/automations', (req, res) => {
    res.json({
      automations: store.data.settings.automations || [],
      log: (store.data.automationLog || []).slice(0, 30),
      // Solo este computador ve el token de los webhooks entrantes.
      hookBase: isLocal(req) ? `http://localhost:${PORT}/api/hooks/${hookToken()}` : null,
    });
  });
  app.post('/api/automations', (req, res) => {
    try {
      const a = normalizeAutomation(req.body || {});
      (store.data.settings.automations ||= []).push(a);
      store.save();
      res.status(201).json(a);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.put('/api/automations/:id', (req, res) => {
    const list = store.data.settings.automations || [];
    const i = list.findIndex((a) => a.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'No existe' });
    try {
      list[i] = normalizeAutomation({ ...list[i], ...req.body, id: list[i].id });
      store.save();
      res.json(list[i]);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.delete('/api/automations/:id', (req, res) => {
    store.data.settings.automations = (store.data.settings.automations || []).filter((a) => a.id !== req.params.id);
    store.save();
    res.json({ ok: true });
  });
  app.post('/api/automations/:id/run', async (req, res) => {
    const a = (store.data.settings.automations || []).find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: 'No existe' });
    res.json(await runAutomation(store, a, req.body?.datos || {}, 'manual'));
  });
  // Webhooks entrantes: n8n le pide cosas a la oficina.
  const hook = (req, res, next) => (req.params.token === hookToken() ? next() : res.status(401).json({ error: 'Token incorrecto' }));
  app.post('/api/hooks/:token/tarea', hook, async (req, res) => {
    const prompt = String(req.body?.tarea || req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Falta «tarea»' });
    const hub = hubsOf(store).some((h) => h.id === req.body?.nucleo) ? req.body.nucleo : 'cerebro';
    const flow = req.body?.flujo ? flowPlan(req.body.flujo, store.data.agents) : null;
    const promise = runTask(store, notes, { prompt, hub, agentIds: flow?.agentIds, template: flow?.template, tags: ['n8n'] });
    if (req.body?.esperar) {
      const t = await promise;
      return res.json({ id: t.id, estado: t.status, resultado: t.final });
    }
    promise.catch((err) => console.error('[n8n]', err));
    res.status(202).json({ id: store.data.tasks[0].id });
  });
  app.post('/api/hooks/:token/nota', hook, (req, res) => {
    const title = String(req.body?.titulo || '').trim();
    if (!title) return res.status(400).json({ error: 'Falta «titulo»' });
    const n = notes.create({ title, content: String(req.body?.contenido || ''), tags: ['n8n'], hub: hubsOf(store).some((h) => h.id === req.body?.nucleo) ? req.body.nucleo : 'cerebro' });
    bus.emit('event', { type: 'notes' });
    res.status(201).json({ id: n.id, titulo: n.title });
  });
  app.post('/api/hooks/:token/tarjeta', hook, (req, res) => {
    const title = String(req.body?.titulo || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: 'Falta «titulo»' });
    const card = { id: Store.id('c_'), title, details: String(req.body?.detalles || '').slice(0, 4000), column: 'todo', project: String(req.body?.proyecto || 'n8n').slice(0, 60), taskId: null, noteId: null, createdAt: new Date().toISOString() };
    (store.data.cards ||= []).push(card);
    store.save();
    bus.emit('event', { type: 'cards' });
    res.status(201).json({ id: card.id });
  });
  // Instalar y abrir n8n en este computador.
  app.get('/api/n8n/status', async (_req, res) => {
    const url = store.data.settings.n8nUrl || 'http://localhost:5678';
    try {
      const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2500) });
      res.json({ running: r.ok, url });
    } catch {
      res.json({ running: false, url });
    }
  });
  app.post('/api/n8n/install', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Solo desde este computador' });
    const log = streamer('install:n8n');
    log('$ npm install -g n8n\n');
    const r = await runLogged('npm', ['install', '-g', 'n8n'], { onData: log, shell: process.platform === 'win32', timeoutMs: 20 * 60000 });
    log.end();
    res.json({ ok: r.ok, log: r.out.slice(-3000) });
  });
  app.post('/api/n8n/start', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Solo desde este computador' });
    const opened = openTerminal('n8n start');
    res.json({ opened, command: 'n8n start' });
  });

  // --- Inicio de sesión y acceso desde otros computadores (Tailscale) ---
  app.get('/api/auth/me', (req, res) => {
    res.json({ user: req.user || null, local: Boolean(req.user?.local), needsLogin: !req.user, users: (store.data.settings.users || []).length });
  });
  app.post('/api/auth/login', (req, res) => {
    try {
      const { token, user } = login(store, req.body || {}, req.socket.remoteAddress);
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
      res.json({ user: publicUser(user) });
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  });
  app.post('/api/auth/logout', (req, res) => {
    logout(store, cookieOf(req));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });
  app.get('/api/users', (_req, res) => res.json((store.data.settings.users || []).map(publicUser)));
  app.post('/api/users', (req, res) => {
    try {
      res.status(201).json(publicUser(createUser(store, req.body || {})));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.put('/api/users/:id', (req, res) => {
    const u = (store.data.settings.users || []).find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'No existe' });
    if (req.body?.password !== undefined) {
      if (String(req.body.password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      Object.assign(u, hashPassword(req.body.password));
      // Cambiar la contraseña cierra sus sesiones abiertas.
      for (const [t, sess] of Object.entries(store.data.sessions || {})) if (sess.userId === u.id) delete store.data.sessions[t];
    }
    if (req.body?.role) u.role = req.body.role === 'admin' ? 'admin' : 'miembro';
    if (req.body?.hub !== undefined) u.hub = req.body.hub || null;
    store.save();
    res.json(publicUser(u));
  });
  app.delete('/api/users/:id', (req, res) => {
    store.data.settings.users = (store.data.settings.users || []).filter((u) => u.id !== req.params.id);
    for (const [t, sess] of Object.entries(store.data.sessions || {})) if (sess.userId === req.params.id) delete store.data.sessions[t];
    store.save();
    res.json({ ok: true });
  });
  const remoteInfo = () => {
    const ips = tailscaleAddresses();
    return {
      enabled: Boolean(store.data.settings.remote?.enabled),
      ips,
      hostname: os.hostname(),
      port: PORT,
      urls: ips.filter((ip) => !ip.includes(':')).map((ip) => `http://${ip}:${PORT}`),
      listening: app.locals.remoteListening || [],
      users: (store.data.settings.users || []).length,
      extraHosts: store.data.settings.remote?.extraHosts || [],
    };
  };
  app.get('/api/remote', (_req, res) => res.json(remoteInfo()));
  app.put('/api/remote', (req, res) => {
    if (!req.user?.local) return res.status(403).json({ error: 'El acceso remoto se activa desde este computador' });
    const enabled = Boolean(req.body?.enabled);
    if (enabled && !(store.data.settings.users || []).length) return res.status(400).json({ error: 'Primero crea al menos un usuario con contraseña' });
    store.data.settings.remote = {
      enabled,
      extraHosts: Array.isArray(req.body?.extraHosts) ? req.body.extraHosts.map((h) => String(h).trim()).filter(Boolean).slice(0, 10) : store.data.settings.remote?.extraHosts || [],
    };
    store.save();
    app.locals.applyRemote?.();
    res.json(remoteInfo());
  });

  // --- Carpeta de datos y actualizaciones ---
  app.get('/api/system', (_req, res) => res.json({ dataDir: store.dir, appDir: ROOT, canRestart: process.env.OFICINA_LANZADOR === '1' }));
  app.post('/api/system/data-dir', (req, res) => {
    if (!req.user?.local) return res.status(403).json({ error: 'Solo desde este computador' });
    try {
      store.flush();
      moveDataTo(store.dir, String(req.body?.dir || '').trim());
      setDataDir(ROOT, path.resolve(String(req.body.dir).trim()));
      const restart = process.env.OFICINA_LANZADOR === '1';
      res.json({ ok: true, restart });
      if (restart) setTimeout(() => process.exit(RESTART_CODE), 400);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.get('/api/update', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador' });
    res.json(await updateStatus(ROOT, { fetch: req.query.fetch !== '0' }));
  });
  app.post('/api/update', async (req, res) => {
    if (!req.user?.local) return res.status(403).json({ error: 'Actualiza desde el computador principal' });
    const log = streamer('install:update');
    try {
      await applyUpdate(ROOT, log);
      // Los nodos también se actualizan (cada uno trae la versión nueva y se reinicia).
      await updateNodes(store.data.settings, log);
      log.end();
      const restart = process.env.OFICINA_LANZADOR === '1';
      res.json({ ok: true, restart });
      if (restart) {
        store.flush();
        setTimeout(() => process.exit(RESTART_CODE), 600);
      }
    } catch (err) {
      log.end();
      res.status(400).json({ error: err.message });
    }
  });
  app.post('/api/update/terminal', (req, res) => {
    if (!req.user?.local) return res.status(403).json({ error: 'Solo desde este computador' });
    const cmd = process.platform === 'win32' ? `cd /d "${ROOT}" && git pull` : `cd "${ROOT}" && git pull`;
    res.json({ opened: openTerminal(cmd), command: cmd });
  });

  // --- Servicios por MCP en tu Claude Code (Undermind…) ---
  const mcpSvc = (req, res) => MCP_SERVICES[req.params.name] || (res.status(404).json({ error: 'Servicio desconocido' }), null);
  app.get('/api/mcp/:name', async (req, res) => {
    const svc = mcpSvc(req, res);
    if (!svc) return;
    const st = await mcpStatus(req.params.name);
    const saved = (store.data.settings.mcp ||= {});
    // Si lo agregaste a mano en Claude Code, la oficina también lo reconoce.
    const added = st.status === 'conectado' || st.status === 'falta-sesion';
    if (added !== Boolean(saved[req.params.name]?.added) && st.status !== 'sin-claude') {
      saved[req.params.name] = { added };
      store.save();
    }
    res.json({ ...svc, name: req.params.name, ...st, claudeEnabled: Boolean(store.data.settings.cli?.['cli-claude']?.enabled), login: mcpLoginCommand(req.params.name) });
  });
  app.post('/api/mcp/:name/connect', async (req, res) => {
    if (!req.user?.local) return res.status(403).json({ error: 'Se conecta desde el computador principal' });
    const svc = mcpSvc(req, res);
    if (!svc) return;
    try {
      const st = await mcpStatus(req.params.name);
      if (st.status === 'sin-claude') return res.status(409).json({ error: st.detail });
      if (st.status === 'no-agregado') await mcpAdd(req.params.name);
      (store.data.settings.mcp ||= {})[req.params.name] = { added: true };
      store.save();
      // Iniciar sesión se hace en el navegador desde una terminal (una sola vez).
      const login = mcpLoginCommand(req.params.name);
      const opened = st.status === 'conectado' ? false : openTerminal(login);
      res.json({ ok: true, opened, login, already: st.status === 'conectado' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.delete('/api/mcp/:name', async (req, res) => {
    const svc = mcpSvc(req, res);
    if (!svc) return;
    await mcpRemove(req.params.name);
    (store.data.settings.mcp ||= {})[req.params.name] = { added: false };
    store.save();
    res.json({ ok: true });
  });

  // --- Claude Desktop (servidor MCP de la oficina) ---
  const MCP_FILE = path.join(ROOT, 'mcp', 'oficina-mcp.mjs');
  const claudeConfigPath = () => (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'));
  const mcpEntry = () => ({ command: process.execPath, args: [MCP_FILE], env: { OFICINA_URL: `http://localhost:${PORT}`, OFICINA_TOKEN: apiToken() } });
  app.get('/api/claude-desktop', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Solo desde este computador' });
    const file = claudeConfigPath();
    let installed = false;
    try {
      installed = Boolean(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers?.['oficina-ias']);
    } catch {
      /* no existe o no se puede leer */
    }
    res.json({ configPath: file, installed, config: { mcpServers: { 'oficina-ias': mcpEntry() } } });
  });
  app.post('/api/claude-desktop/install', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Solo desde este computador' });
    const file = claudeConfigPath();
    let cfg = {};
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        cfg = raw.trim() ? JSON.parse(raw) : {};
        fs.copyFileSync(file, `${file}.antes-de-oficina`);
      }
    } catch {
      return res.status(400).json({ error: `No pude leer ${file}: arréglalo o bórralo y vuelve a intentar` });
    }
    cfg.mcpServers = { ...(cfg.mcpServers || {}), 'oficina-ias': mcpEntry() };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    res.json({ ok: true, configPath: file });
  });

  // --- Impresora Bambu Lab (en esta red o en la de un nodo) ---
  const emitEvent = (e) => bus.emit('event', e);
  connectPrinter(store.data.settings.printer?.node ? {} : store.data.settings, emitEvent);
  const nodePoll = startNodePrinterPoll(store, emitEvent);
  const modelSync = startNodeModelSync(store);
  app.locals.stop = () => {
    clearInterval(nodePoll);
    modelSync.stop();
  };
  app.get('/api/printer/status', (_req, res) => res.json(printerNow(store.data.settings)));
  app.put('/api/printer', async (req, res) => {
    if (!isLocal(req) || req.viaToken) return res.status(403).json({ error: 'La impresora se configura desde este computador' });
    try {
      res.json(await savePrinter(store, req.body, emitEvent));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.delete('/api/printer', async (req, res) => {
    if (!isLocal(req) || req.viaToken) return res.status(403).json({ error: 'Solo desde este computador' });
    const node = store.data.settings.printer?.node && nodeById(store.data.settings, store.data.settings.printer.node);
    if (node) await nodeCall(node, 'DELETE', '/nodo/printer').catch(() => {});
    delete store.data.settings.printer;
    store.save();
    connectPrinter({});
    res.json(printerNow(store.data.settings));
  });
  app.post('/api/printer/command', async (req, res) => {
    const command = String(req.body?.command || '');
    if (!PRINTER_COMMANDS.includes(command)) return res.status(400).json({ error: 'Orden desconocida' });
    const info = printerNow(store.data.settings);
    if (!info.connected) return res.status(409).json({ error: info.error || 'No estoy conectado a la impresora' });
    // Si la orden no la da la persona frente al computador (Claude Desktop, otro equipo), se pide permiso.
    if (!isLocal(req) || req.viaToken) {
      const allowed = store.data.settings.printerControl && command !== 'detener';
      if (!allowed) {
        const r = await requestAccess(store, { agent: { id: 'externo', name: String(req.body?.via || req.user?.name || 'Una conexión externa').slice(0, 40) }, path: 'Tu impresora Bambu Lab', mode: 'controlar', reason: `Quiere: ${command.replace('_', ' ')}`, action: command, special: true });
        if (r.decision === 'deny') return res.status(403).json({ error: 'El usuario no dio permiso' });
        if (r.decision === 'always' && command !== 'detener') {
          store.data.settings.printerControl = true;
          store.save();
        }
      }
    }
    try {
      await printerCommand(store.data.settings, command);
      res.json({ ok: true, message: { pausar: '⏸️ Impresión en pausa', reanudar: '▶️ Impresión reanudada', detener: '⏹️ Impresión detenida', luz_on: '💡 Luz encendida', luz_off: '🌑 Luz apagada' }[command] });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.get('/api/printer/camera.jpg', async (req, res) => {
    if (!isLocal(req) || req.viaToken) return res.status(403).json({ error: 'La cámara solo se ve desde este computador' });
    try {
      const img = await printerCamera(store.data.settings);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.end(img);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // --- Nodos: tus otros computadores (impresora y Ollama de otras zonas) ---
  // Versión de la principal, para avisar si un nodo quedó atrás.
  let mainHead;
  const headNow = async () => (mainHead ??= (await updateStatus(ROOT, { fetch: false }).catch(() => null))?.head || null);
  app.get('/api/nodes', async (_req, res) => {
    const nodes = store.data.settings.nodes || [];
    const head = await headNow();
    res.json(await Promise.all(nodes.map(async (n) => {
      try {
        const info = await nodeCall(n, 'GET', '/nodo/info', undefined, { timeoutMs: 4000 });
        return { ...publicNode(n), online: true, info, outdated: Boolean(head && info.version?.head && info.version.head !== head) };
      } catch (err) {
        return { ...publicNode(n), online: false, error: err.message };
      }
    })));
  });
  // Probar la conexión con un nodo (antes o después de agregarlo).
  app.post('/api/nodes/test', async (req, res) => {
    const saved = req.body?.id ? nodeById(store.data.settings, req.body.id) : null;
    res.json(await diagnoseNode(saved || req.body || {}));
  });
  app.post('/api/nodes', async (req, res) => {
    try {
      const { node, info } = await addNode(store, req.body || {});
      res.status(201).json({ ...publicNode(node), online: true, info });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.put('/api/nodes/:id', (req, res) => {
    const n = nodeById(store.data.settings, req.params.id);
    if (!n) return res.status(404).json({ error: 'Ese nodo no existe' });
    const b = req.body || {};
    if (b.name !== undefined) n.name = String(b.name).trim().slice(0, 40) || n.name;
    for (const k of ['ollama', 'syncModels']) {
      if (b[k] === undefined) continue;
      if (b[k] === false) n[k] = false;
      else delete n[k];
    }
    store.save();
    pushNodeModels(store, n).catch(() => {});
    res.json(publicNode(n));
  });
  // Descargar ya en el nodo los modelos que usan las IAs.
  app.post('/api/nodes/:id/models', async (req, res) => {
    const n = nodeById(store.data.settings, req.params.id);
    if (!n) return res.status(404).json({ error: 'Ese nodo no existe' });
    try {
      res.json(await nodeCall(n, 'PUT', '/nodo/modelos', { models: nodeModels(store, n), now: true }));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
  app.post('/api/nodes/:id/update', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador' });
    const n = nodeById(store.data.settings, req.params.id);
    if (!n) return res.status(404).json({ error: 'Ese nodo no existe' });
    try {
      res.json(await nodeCall(n, 'POST', '/nodo/update', {}));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
  app.delete('/api/nodes/:id', (req, res) => {
    const s = store.data.settings;
    s.nodes = (s.nodes || []).filter((n) => n.id !== req.params.id);
    if (s.printer?.node === req.params.id) delete s.printer;
    if (s.ollamaNode === req.params.id) delete s.ollamaNode;
    for (const a of store.data.agents) if (a.provider === 'ollama' && a.account === `node:${req.params.id}`) delete a.account;
    store.save();
    res.json({ ok: true });
  });

  // --- Videos ---
  app.get('/api/videos', async (_req, res) => {
    const dir = videosDir(store.dir);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^vid-[\w-]+\.mp4$/.test(f)).sort().reverse().slice(0, 40) : [];
    const ff = await runLogged(await ffmpegPath(), ['-version'], { timeoutMs: 10000 });
    res.json({ services: VIDEO_SERVICES, active: videoService(store.data.settings), files, ffmpeg: ff.ok });
  });
  app.get('/api/videos/:file', (req, res) => {
    const f = req.params.file;
    if (!/^vid-[\w-]+\.mp4$/.test(f)) return res.status(400).json({ error: 'Nombre no válido' });
    const file = path.join(videosDir(store.dir), f);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'No existe' });
    res.sendFile(file);
  });
  app.post('/api/videos', async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
    if (prompt.length < 3) return res.status(400).json({ error: 'Describe el video' });
    const log = streamer('video:prueba');
    try {
      const v = await generateVideo(store.data.settings, store.dir, { prompt, escenas: req.body?.escenas, formato: req.body?.formato, service: VIDEO_SERVICES[req.body?.service] ? req.body.service : undefined }, log);
      log.end();
      res.json({ ...v, url: `/api/videos/${v.file}` });
    } catch (err) {
      log.end();
      res.status(502).json({ error: err.message });
    }
  });

  // --- Imágenes generadas por las IAs ---
  app.get('/api/images', (_req, res) => {
    const dir = imagesDir(store.dir);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^img-[\w-]+\.(jpg|png)$/.test(f)).sort().reverse().slice(0, 60) : [];
    res.json({ services: IMAGE_SERVICES, active: imageService(store.data.settings) || null, files });
  });
  app.get('/api/images/:file', (req, res) => {
    const f = req.params.file;
    if (!/^img-[\w-]+\.(jpg|png)$/.test(f)) return res.status(400).json({ error: 'Nombre no válido' });
    const file = path.join(imagesDir(store.dir), f);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'No existe' });
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(file);
  });
  app.post('/api/images', async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
    if (prompt.length < 3) return res.status(400).json({ error: 'Describe la imagen' });
    try {
      const img = await generateImage(store.data.settings, { prompt, formato: req.body?.formato, service: IMAGE_SERVICES[req.body?.service] ? req.body.service : undefined });
      const file = saveImage(store.dir, img);
      res.json({ file, url: `/api/images/${file}`, service: img.service });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // --- Taller de Impresión 3D ---
  app.get('/api/cad/detect', async (_req, res) => res.json({ ...(await detectCad(store.data.settings)), trellis: trellisReady(store.data.settings) }));
  app.get('/api/cad/jobs', (_req, res) => res.json(store.data.cadJobs || []));
  app.post('/api/cad/extract', (req, res) => res.json(extractCadBlocks(String(req.body?.text || ''))));
  const cadJob = (id) => (store.data.cadJobs || []).find((j) => j.id === id);
  app.post('/api/cad/run', async (req, res) => {
    const code = String(req.body?.code || '');
    const kind = req.body?.kind;
    if (!code.trim() || !['blender', 'openscad', 'freecad'].includes(kind)) return res.status(400).json({ error: 'Falta el código o el programa' });
    const id = Store.id('j_');
    const log = streamer(`cad:${id}`);
    try {
      const job = await runCad({ settings: store.data.settings, dataDir: store.dir, kind, code, name: String(req.body?.name || 'modelo').slice(0, 60), gui: Boolean(req.body?.gui), onLog: log });
      log.end();
      const record = { id, ...job, code: code.slice(0, 50000), taskId: req.body?.taskId || null, createdAt: new Date().toISOString() };
      (store.data.cadJobs ||= []).unshift(record);
      if (store.data.cadJobs.length > 60) store.data.cadJobs.length = 60;
      store.save();
      bus.emit('event', { type: 'cad' });
      res.json(record);
    } catch (err) {
      log.end();
      res.status(400).json({ error: err.message });
    }
  });
  // De texto o imagen a 3D con TRELLIS (NVIDIA).
  app.post('/api/cad/trellis', express.json({ limit: '15mb' }), async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(req.body?.image || ''));
    const log = streamer('cad:trellis');
    try {
      const job = await generate3d(store.data.settings, store.dir, { prompt, image: m ? Buffer.from(m[2], 'base64') : null, name: String(req.body?.name || prompt.split(/[,.]/)[0] || 'modelo').slice(0, 60) }, log);
      log.end();
      const record = { id: Store.id('j_'), ...job, taskId: null, createdAt: new Date().toISOString() };
      (store.data.cadJobs ||= []).unshift(record);
      if (store.data.cadJobs.length > 60) store.data.cadJobs.length = 60;
      store.save();
      bus.emit('event', { type: 'cad' });
      res.json(record);
    } catch (err) {
      log.end();
      res.status(400).json({ error: err.message });
    }
  });
  app.post('/api/cad/jobs/:id/open', async (req, res) => {
    const job = cadJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'No existe' });
    const ok = req.body?.what === 'folder' ? openPath(job.dir) : req.body?.what === 'bambu' ? await openInBambu(store.data.settings, job) : await openInApp(store.data.settings, job);
    res.status(ok ? 200 : 400).json(ok ? { ok } : { error: 'No pude abrirlo: revisa que el programa esté instalado' });
  });
  app.post('/api/cad/jobs/:id/slice', async (req, res) => {
    const job = cadJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'No existe' });
    try {
      const r = await sliceJob(store.data.settings, job, streamer(`cad:${job.id}`));
      job.files = r.files;
      store.save();
      bus.emit('event', { type: 'cad' });
      res.json(r);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.get('/api/cad/jobs/:id/files/:name', (req, res) => {
    const job = cadJob(req.params.id);
    const name = path.basename(req.params.name);
    if (!job || !listFiles(job.dir).some((f) => f.name === name)) return res.status(404).json({ error: 'No existe' });
    res.sendFile(path.join(job.dir, name));
  });
  app.delete('/api/cad/jobs/:id', (req, res) => {
    store.data.cadJobs = (store.data.cadJobs || []).filter((j) => j.id !== req.params.id);
    store.save();
    res.json({ ok: true });
  });

  // --- Asistente de conexión: el cerebro te guía para conectar las IAs ---
  app.get('/api/assistant', (_req, res) => res.json(store.data.chats._asistente || []));
  app.delete('/api/assistant', (_req, res) => {
    delete store.data.chats._asistente;
    store.save();
    res.json({ ok: true });
  });
  app.post('/api/assistant', async (req, res) => {
    const message = String(req.body?.message || '').trim().slice(0, 4000);
    if (!message) return res.status(400).json({ error: 'Escribe tu pregunta' });
    const s = store.data.settings;
    const brain = store.data.agents.find((a) => a.isBrain) || store.data.agents[0];
    const clis = await detectClis();
    const status = Object.entries(PROVIDERS).map(([id, p]) => {
      const users = store.data.agents.filter((a) => a.provider === id).map((a) => a.name);
      const extra = (s.accounts || []).filter((a) => a.provider === id).length;
      return `- ${id} (${p.label}, ${p.tier}): ${hasKey(s, id) ? 'CONECTADO' : 'sin conectar'}${p.cli ? `, ${clis[id] ? 'instalada' : 'no instalada'}` : ''}${extra ? `, ${extra} cuentas extra` : ''}. IAs: ${users.join(', ') || 'ninguna'}`;
    }).join('\n');
    const blender = await blenderStatus(store);
    const blenderPath = (await detectCad(s)).blender;
    const blenderLine = `- Blender: ${blenderPath ? `instalado en ${blenderPath}` : 'no encontrado'}; complemento «Oficina de IAs»: ${blender.connected ? `CONECTADO (Blender ${blender.version})` : 'sin conectar (Blender cerrado o complemento no instalado)'}`;
    const history = (store.data.chats._asistente ||= []);
    history.push({ role: 'user', content: message, at: new Date().toISOString() });
    const onDelta = streamer('chat:_asistente');
    agentStatus(brain.id, 'thinking', 'Ayudando a conectar las IAs…');
    try {
      const r = await callModel(s, {
        provider: brain.provider, model: brain.model, agent: brain, effort: 'low', onDelta,
        system: `${buildSystem(brain)}\n\n## Ahora eres el asistente de conexión de la oficina
Ayudas al usuario (principiante, en ${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'}) a conectar IAs, prefiriendo siempre opciones GRATIS o que usen suscripciones que ya paga. Pasos cortos y numerados.
Puedes proponer acciones que el usuario ejecuta con un clic escribiendo exactamente una de estas marcas en una línea propia:
{{instalar:cli-codex}} {{instalar:cli-claude}} {{instalar:cli-opencode}} {{instalar:cli-gemini}} → instala esa herramienta con npm.
{{sesion:cli-codex}} (o cli-claude, cli-opencode, cli-gemini) → abre una terminal para iniciar sesión.
{{clave:google}} (o groq, cerebras, openrouter, mistral…) → abre el formulario para pegar la clave de ese proveedor.
{{ollama:gemma3}} → descarga ese modelo de Ollama.
{{modo-gratis}} → pasa las IAs de pago a modelos gratis.
{{blender-instalar}} → instala y activa el complemento «Oficina de IAs» en Blender (después hay que cerrar y abrir Blender).
{{blender-probar}} → revisa si Blender está conectado con la oficina.
{{blender-descargar}} → descarga el complemento para instalarlo a mano (Edit → Preferences → Add-ons → Install from Disk, y activarlo).
El complemento deja que las IAs modelen en vivo en el Blender abierto del usuario, con su permiso. Si Blender no está instalado, que lo descargue gratis de blender.org.
Estado actual de la oficina:\n${status}\n${blenderLine}`,
        messages: history.slice(-12).map(({ role, content }) => ({ role, content })),
      });
      onDelta.end();
      const blenderDemo = `Te ayudo a conectar Blender con la oficina (respuesta simulada: conecta a Claude para que te responda de verdad):\n\n1. ${blenderPath ? 'Ya tienes Blender instalado ✓' : 'Instala Blender gratis desde blender.org y vuelve aquí.'}\n2. Instala el complemento «Oficina de IAs» con un clic:\n{{blender-instalar}}\n3. Cierra Blender si estaba abierto y ábrelo otra vez. En la vista 3D, pulsa N y busca la pestaña **Oficina**: debe decir «Conectado».\n4. Comprueba la conexión:\n{{blender-probar}}\n\nSi prefieres hacerlo a mano, descarga el complemento y en Blender ve a Edit → Preferences → Add-ons → Install from Disk:\n{{blender-descargar}}`;
      const reply = r.simulated && /blender/i.test(message)
        ? blenderDemo
        : r.simulated
        ? 'Te ayudo a conectar las IAs gratis (respuesta simulada: conecta a Claude para que te responda de verdad):\n\n1. Lo más fácil y gratis es **Gemini CLI** con tu cuenta de Google.\n{{instalar:cli-gemini}}\n{{sesion:cli-gemini}}\n2. Luego saca una clave gratis de **Groq** (muy rápida).\n{{clave:groq}}\n3. Y pasa las IAs de pago a modelos gratis.\n{{modo-gratis}}'
        : r.text;
      history.push({ role: 'assistant', content: reply, simulated: r.simulated, at: new Date().toISOString() });
      if (history.length > 40) history.splice(0, history.length - 40);
      agentStatus(brain.id, 'done', 'Listo');
      store.save();
      res.json({ reply, simulated: r.simulated, history });
    } catch (err) {
      onDelta.end();
      history.pop();
      agentStatus(brain.id, 'error', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Copia de seguridad ---
  app.get('/api/export', (_req, res) => {
    const { settings, sessions: _s, metrics: _m, ...rest } = store.data;
    const { users: _u, remote: _r, nodes: _n, apiKeys: _omit, accounts: _acc, apiToken: _t, hookToken: _h, blenderToken: _b, printer: _pr, images: _img, ...safeSettings } = settings;
    res.setHeader('Content-Disposition', 'attachment; filename="oficina-ias-respaldo.json"');
    res.json({ ...rest, settings: safeSettings, exportedAt: new Date().toISOString() });
  });
  app.post('/api/import', (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.agents) || !Array.isArray(b.notes)) return res.status(400).json({ error: 'Archivo de respaldo no válido' });
    // Las claves y los comandos de las CLIs son de este computador: un respaldo ajeno no debe poder cambiarlos.
    // Los permisos de carpetas también son de este computador.
    const { apiKeys, cli, accounts, cadPaths, grants, apiToken, hookToken, blenderToken, automations, printer, users, remote, nodes, ollamaNode, images } = store.data.settings;
    const { apiKeys: _k, cli: _c, accounts: _a, cadPaths: _p, grants: _g, apiToken: _t, hookToken: _h, blenderToken: _b, automations: _au, printer: _pr, users: _us, remote: _re, nodes: _no, ollamaNode: _on, images: _im, ...importedSettings } = b.settings || {};
    store.data = { ...store.data, ...b, settings: { ...store.data.settings, ...importedSettings, apiKeys, cli, accounts, cadPaths, grants, apiToken, hookToken, blenderToken, automations, printer, users, remote, nodes, ollamaNode, images }, sessions: store.data.sessions };
    store.flush();
    bus.emit('event', { type: 'notes' });
    res.json({ ok: true });
  });

  // --- Eventos en vivo ---
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    const send = (e) => res.write(`data: ${JSON.stringify(e, hideResume)}\n\n`);
    bus.on('event', send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      bus.off('event', send);
    });
  });

  // Errores inesperados o JSON mal formado: siempre como JSON.
  app.use('/api', (err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: status === 413 ? 'El archivo es demasiado grande' : err.type === 'entity.parse.failed' ? 'Petición con JSON inválido' : err.message || 'Error interno' });
  });

  // --- Interfaz compilada ---
  const dist = path.join(ROOT, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const DATA_DIR = dataDir();
  const store = new Store(DATA_DIR);
  const app = createApp(store);
  startScheduler(store, new Notes(store));
  const shutdown = () => {
    store.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Acceso desde otros computadores: además de 127.0.0.1, escucha en las IPs de Tailscale.
  let remoteServers = [];
  app.locals.applyRemote = () => {
    for (const srv of remoteServers) srv.close();
    remoteServers = [];
    app.locals.remoteListening = [];
    if (!store.data.settings.remote?.enabled || process.env.HOST) return;
    for (const ip of tailscaleAddresses()) {
      const srv = app.listen(PORT, ip, () => app.locals.remoteListening.push(ip));
      srv.on('error', (e) => console.warn(`[remoto] No pude escuchar en ${ip}: ${e.message}`));
      remoteServers.push(srv);
    }
  };
  app.locals.applyRemote();
  // Si Tailscale se conecta después de abrir la oficina, se detecta solo.
  let lastIps = tailscaleAddresses().join();
  setInterval(() => {
    const now = tailscaleAddresses().join();
    if (now !== lastIps) {
      lastIps = now;
      app.locals.applyRemote();
    }
  }, 60000).unref();
  app.listen(PORT, HOST, () => {
    console.log(`\n  🧠 Oficina de IAs lista en http://localhost:${PORT}`);
    console.log(`  📁 Datos guardados en ${DATA_DIR}\n`);
  }).on('error', (err) => {
    // Casi siempre es otra oficina (por ejemplo, una versión vieja) que sigue abierta.
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`\n  ⚠️ Ya hay otra oficina abierta en el puerto ${PORT} (puede ser una versión vieja).`);
    console.error('  Cierra las otras ventanas negras de la oficina (o en el Administrador de tareas termina «Node.js»)');
    console.error('  y vuelve a abrir el acceso directo «Oficina de IAs».\n');
    process.exit(1);
  });
}
