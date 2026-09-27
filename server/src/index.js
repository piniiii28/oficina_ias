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
import { bus, runTask, chatWithAgent, selfTrain, dailySummary, running } from './orchestrator.js';
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
    return { ...rest, keys, cli, ollamaEnabled: Boolean(apiKeys?.ollamaEnabled), ollamaUrl: apiKeys?.ollamaUrl || '' };
  };

  // --- Meta ---
  app.get('/api/meta', (_req, res) => {
    res.json({
      departments: DEPARTMENTS,
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, keyUrl: p.keyUrl, keyless: Boolean(p.keyless), cli: Boolean(p.cli) })),
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
    const { apiKeys, demoMode, maxParallel, ollamaEnabled, ollamaUrl, cli, reviewFinal, maxTeam } = req.body || {};
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
    for (const k of ['name', 'role', 'department', 'provider', 'model', 'skills', 'system', 'avatar', 'enabled']) {
      if (req.body[k] !== undefined) a[k] = req.body[k];
    }
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
      prompt, agentIds: flow?.agentIds || req.body.agentIds, template: flow?.template, effort: req.body.effort, fromNote: typeof req.body.fromNote === 'string' ? req.body.fromNote.slice(0, 200) : null, parentId: req.body.parentId, attachments: req.body.attachments, saveNotes: req.body.saveNotes !== false,
    });
    // Respondemos enseguida; el progreso llega por /api/events.
    promise.catch((err) => console.error('[tarea]', err));
    res.status(202).json({ id: store.data.tasks[0].id });
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
    const promise = runTask(store, notes, { prompt: `${c.title}${c.details ? `\n\n${c.details}` : ''}`, tags: slug ? [slug] : [] });
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
    runMeeting(store, notes, { topic, agentIds, rounds: Number(req.body.rounds) || 2 }).catch((err) => console.error('[reunión]', err));
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
    const n = notes.create(req.body || {});
    bus.emit('event', { type: 'notes' });
    res.status(201).json(n);
  });
  app.post('/api/notes/resolve', (req, res) => {
    // Abrir un [[enlace]]: si la nota no existe, se crea (como en Obsidian).
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Falta el título' });
    const n = notes.findByTitle(title) || notes.create({ title, content: '' });
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
        notes.create(parsed);
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
    }));
  });

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

  // --- Copia de seguridad ---
  app.get('/api/export', (_req, res) => {
    const { settings, ...rest } = store.data;
    const { apiKeys: _omit, ...safeSettings } = settings;
    res.setHeader('Content-Disposition', 'attachment; filename="oficina-ias-respaldo.json"');
    res.json({ ...rest, settings: safeSettings, exportedAt: new Date().toISOString() });
  });
  app.post('/api/import', (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.agents) || !Array.isArray(b.notes)) return res.status(400).json({ error: 'Archivo de respaldo no válido' });
    // Las claves y los comandos de las CLIs son de este computador: un respaldo ajeno no debe poder cambiarlos.
    const { apiKeys, cli } = store.data.settings;
    const { apiKeys: _k, cli: _c, ...importedSettings } = b.settings || {};
    store.data = { ...store.data, ...b, settings: { ...store.data.settings, ...importedSettings, apiKeys, cli } };
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
