// Servidor de la Oficina de IAs: API REST + eventos en vivo (SSE) y, en
// producción, la interfaz web compilada.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Notes } from './notes.js';
import { DEFAULT_AGENTS, DEPARTMENTS } from './agents.js';
import { PROVIDERS, hasKey, detectClis, cliCommand, callModel, setUsageSink } from './providers.js';
import { bus, runTask, chatWithAgent, selfTrain, dailySummary, running, streamer, agentStatus, buildSystem } from './orchestrator.js';
import { FREE_MODELS, freePlan } from './freeModels.js';
import { CAD_TOOLS, detectCad, runCad, openInApp, sliceJob, extractCadBlocks, listFiles } from './cad.js';
import { hubsOf, normalizeHubs, hubStats, hubBridges, crossHubSuggestions, askHub, writeHubProfile } from './hubs.js';
import { openTerminal, manualCommand, runLogged, openPath } from './system.js';
import { listRequests, decide, addGrant } from './access.js';
import os from 'node:os';
import { seedWelcome } from './seed.js';
import { Vault, parseMarkdownFile } from './vault.js';
import { suggestConnections, applyConnection } from './librarian.js';
import { runMeeting } from './meetings.js';
import { createRoutine, normalizeRoutine, startScheduler } from './routines.js';
import { FLOWS, flowPlan } from './flows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const DATA_DIR = process.env.OFICINA_DATA || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4747);
// Solo tu computador puede usar la oficina (tiene tus claves y puede ejecutar CLIs).
const HOST = process.env.HOST || '127.0.0.1';

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

  // Tareas o reuniones que quedaron a medias por un reinicio.
  for (const t of store.data.tasks) {
    if (!['done', 'error'].includes(t.status)) {
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

  // Bóveda .md sincronizada para abrirla en Obsidian.
  const vault = new Vault(path.join(store.dir, 'boveda'));
  const onEvent = (e) => e.type === 'notes' && vault.schedule(store.data.notes);
  bus.on('event', onEvent);
  vault.schedule(store.data.notes);

  const app = express();
  // Evita que otras páginas web abiertas en tu navegador usen la API (DNS rebinding).
  app.use((req, res, next) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    const origin = req.headers.origin;
    const localOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
    if (process.env.HOST || (['localhost', '127.0.0.1', '[::1]'].includes(host) && localOrigin)) return next();
    res.status(403).json({ error: 'Acceso solo desde este computador' });
  });
  app.use(express.json({ limit: '25mb' }));
  // Núcleo activo (quién usa la oficina: Nicolás, Santiago, Miguel…): las notas nuevas quedan en su núcleo.
  app.use((req, _res, next) => {
    const h = String(req.headers['x-nucleo'] || '');
    req.hub = hubsOf(store).some((x) => x.id === h) ? h : 'cerebro';
    next();
  });

  const agentById = (id) => store.data.agents.find((a) => a.id === id);
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
    const accounts = (rest.accounts || []).map(({ key, ...a }) => ({ ...a, preview: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null }));
    return { ...rest, keys, cli, accounts, grants: rest.grants || [], accessEnabled: rest.accessEnabled !== false, hubs: hubsOf(store), cadPaths: rest.cadPaths || {}, ollamaEnabled: Boolean(apiKeys?.ollamaEnabled), ollamaUrl: apiKeys?.ollamaUrl || '' };
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
    if (ollamaUrl !== undefined) (s.apiKeys ||= {}).ollamaUrl = String(ollamaUrl).trim();
    if (['auto', 'always'].includes(demoMode)) s.demoMode = demoMode;
    if (maxParallel) s.maxParallel = Math.max(1, Math.min(10, Number(maxParallel)));
    store.save();
    res.json(publicSettings());
  });

  // --- Agentes ---
  app.get('/api/agents', (_req, res) => {
    const s = store.data.settings;
    res.json(store.data.agents.map((a) => ({ ...a, live: s.demoMode !== 'always' && hasKey(s, a.provider) })));
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
    if (!a.account || a.account === 'default') delete a.account;
    store.save();
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
      res.status(500).json({ error: err.message });
    }
  });
  app.delete('/api/agents/:id/chat', (req, res) => {
    delete store.data.chats[req.params.id];
    store.save();
    res.json({ ok: true });
  });

  // --- Tareas (el cerebro coordina al equipo) ---
  app.get('/api/tasks', (_req, res) => res.json(store.data.tasks.slice(0, 100)));
  app.get('/api/tasks/:id', (req, res) => {
    const t = store.data.tasks.find((x) => x.id === req.params.id);
    return t ? res.json(t) : res.status(404).json({ error: 'No existe' });
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
    if (!ctrl) return res.status(404).json({ error: 'Esa tarea no está en curso' });
    ctrl.abort();
    res.json({ ok: true });
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

  // --- Ollama: modelos instalados y descarga de modelos ---
  const ollamaBase = () => (store.data.settings.apiKeys?.ollamaUrl || PROVIDERS.ollama.baseUrl).replace(/\/v1\/?$/, '');
  app.get('/api/ollama/models', async (_req, res) => {
    try {
      const r = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(4000) });
      const data = await r.json();
      res.json({ running: true, models: (data.models || []).map((m) => ({ name: m.name, size: m.size })) });
    } catch {
      res.json({ running: false, models: [] });
    }
  });
  app.post('/api/ollama/pull', async (req, res) => {
    const model = String(req.body?.model || '').trim();
    if (!/^[a-z0-9][a-z0-9._:/-]{0,80}$/i.test(model)) return res.status(400).json({ error: 'Nombre de modelo no válido' });
    const log = streamer(`install:ollama:${model}`);
    log(`$ ollama pull ${model}\n`);
    const r = await runLogged('ollama', ['pull', model], { onData: log, timeoutMs: 60 * 60000 });
    log.end();
    res.json({ ok: r.ok, log: r.out.slice(-2000) });
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

  // --- Taller de Impresión 3D ---
  app.get('/api/cad/detect', async (_req, res) => res.json(await detectCad(store.data.settings)));
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
  app.post('/api/cad/jobs/:id/open', async (req, res) => {
    const job = cadJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'No existe' });
    const ok = req.body?.what === 'folder' ? openPath(job.dir) : await openInApp(store.data.settings, job);
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
Estado actual de la oficina:\n${status}`,
        messages: history.slice(-12).map(({ role, content }) => ({ role, content })),
      });
      onDelta.end();
      const reply = r.simulated
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
    const { settings, ...rest } = store.data;
    const { apiKeys: _omit, accounts: _acc, ...safeSettings } = settings;
    res.setHeader('Content-Disposition', 'attachment; filename="oficina-ias-respaldo.json"');
    res.json({ ...rest, settings: safeSettings, exportedAt: new Date().toISOString() });
  });
  app.post('/api/import', (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.agents) || !Array.isArray(b.notes)) return res.status(400).json({ error: 'Archivo de respaldo no válido' });
    // Las claves y los comandos de las CLIs son de este computador: un respaldo ajeno no debe poder cambiarlos.
    // Los permisos de carpetas también son de este computador.
    const { apiKeys, cli, accounts, cadPaths, grants } = store.data.settings;
    const { apiKeys: _k, cli: _c, accounts: _a, cadPaths: _p, grants: _g, ...importedSettings } = b.settings || {};
    store.data = { ...store.data, ...b, settings: { ...store.data.settings, ...importedSettings, apiKeys, cli, accounts, cadPaths, grants } };
    store.flush();
    bus.emit('event', { type: 'notes' });
    res.json({ ok: true });
  });

  // --- Eventos en vivo ---
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
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
  const store = new Store(DATA_DIR);
  const app = createApp(store);
  startScheduler(store, new Notes(store));
  const shutdown = () => {
    store.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  app.listen(PORT, HOST, () => {
    console.log(`\n  🧠 Oficina de IAs lista en http://localhost:${PORT}`);
    console.log(`  📁 Datos guardados en ${DATA_DIR}\n`);
  });
}
