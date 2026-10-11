import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Notes, parseLinks, parseTags, extractKeyIdeas } from '../src/notes.js';
import { demoPlan } from '../src/demo.js';
import { DEFAULT_AGENTS } from '../src/agents.js';
import { runTask } from '../src/orchestrator.js';
import { createApp } from '../src/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-'));

test('hay más de 20 IAs especializadas y un cerebro', () => {
  const staff = DEFAULT_AGENTS.filter((a) => !a.isBrain);
  assert.ok(staff.length > 20, `solo hay ${staff.length}`);
  assert.equal(DEFAULT_AGENTS.filter((a) => a.isBrain).length, 1);
  assert.equal(new Set(DEFAULT_AGENTS.map((a) => a.id)).size, DEFAULT_AGENTS.length);
});

test('lee [[enlaces]] y #etiquetas, ignorando el código', () => {
  const md = 'Ver [[Idea A]] y [[Idea B|alias]] #proyecto `[[No]] #no`\n```\n[[Tampoco]]\n```';
  assert.deepEqual(parseLinks(md), ['Idea A', 'Idea B']);
  assert.deepEqual(parseTags(md), ['proyecto']);
});

test('extrae ideas clave', () => {
  const ideas = extractKeyIdeas('Texto\n\n### Ideas clave\n- Primera idea\n- **Segunda** idea\n');
  assert.deepEqual(ideas, ['Primera idea', 'Segunda idea']);
});

test('grafo: enlaces, fantasmas y backlinks; renombrar actualiza enlaces', () => {
  const store = new Store(tmp());
  const notes = new Notes(store);
  const a = notes.create({ title: 'Alfa', content: 'Hacia [[Beta]] y [[Gamma]] #x' });
  const b = notes.create({ title: 'Beta', content: '' });
  const g = notes.graph({ agents: [] });
  assert.ok(g.nodes.some((n) => n.kind === 'ghost' && n.label === 'Gamma'));
  assert.ok(g.links.some((l) => l.source === a.id && l.target === b.id));
  assert.ok(g.nodes.some((n) => n.id === 'tag:x'));
  assert.deepEqual(notes.backlinks(b.id).map((n) => n.id), [a.id]);
  notes.update(b.id, { title: 'Beta 2' });
  assert.match(notes.get(a.id).content, /\[\[Beta 2\]\]/);
  // Títulos únicos
  assert.equal(notes.create({ title: 'Alfa' }).title, 'Alfa (2)');
});

test('el planificador demo reparte según habilidades', () => {
  const plan = demoPlan('Necesito código en react y una campaña de marketing con seo', DEFAULT_AGENTS);
  const ids = plan.subtasks.map((s) => s.agentId);
  assert.ok(ids.includes('opencode'));
  assert.ok(ids.includes('command-mkt'));
  assert.ok(!ids.includes('cerebro'));
});

test('una tarea completa en modo demo crea notas enlazadas y memoria', async () => {
  const store = new Store(tmp());
  createApp(store); // siembra agentes y notas de bienvenida
  store.data.settings.demoMode = 'always';
  const notes = new Notes(store);
  const before = notes.all.length;
  const task = await runTask(store, notes, { prompt: 'Diseña una app web en react con pruebas' });
  assert.equal(task.status, 'done');
  assert.ok(task.steps.length >= 2);
  assert.ok(task.steps.every((s) => s.status === 'done' && s.simulated));
  assert.ok(notes.all.length > before + task.steps.length);
  const main = notes.get(task.noteId);
  assert.equal(main.type, 'tarea');
  assert.ok(notes.backlinks(main.id).length >= task.steps.length);
  const worker = store.data.agents.find((a) => a.id === task.steps[0].agentId);
  assert.equal(worker.memory.length, 1);
});

test('la memoria persiste en disco entre reinicios', () => {
  const dir = tmp();
  const s1 = new Store(dir);
  createApp(s1);
  s1.data.agents[1].knowledge.push({ id: 'k1', title: 'Estilo', content: 'Usa emojis', at: '' });
  s1.flush();
  const s2 = new Store(dir);
  assert.equal(s2.data.agents[1].knowledge.at(-1).content, 'Usa emojis');
  assert.ok(s2.data.agents[1].knowledge[0].builtin, 'trae su manual de fábrica');
  assert.ok(s2.data.notes.length >= 5);
});

test('runGraph respeta dependencias y el límite de paralelismo', async () => {
  const { runGraph, sanitizeDeps } = await import('../src/orchestrator.js');
  const plan = sanitizeDeps({ subtasks: [
    { agentId: 'a', dependsOn: ['c'] }, // dependencia hacia adelante: se descarta
    { agentId: 'b', dependsOn: [] },
    { agentId: 'c', dependsOn: ['a', 'b', 'zzz'] },
  ] });
  assert.deepEqual(plan.subtasks.map((s) => s.dependsOn), [[], [], ['a', 'b']]);
  const order = [];
  let running = 0, peak = 0;
  await runGraph(plan.subtasks, 1, async (s) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    order.push(s.agentId);
    running--;
  });
  assert.equal(peak, 1);
  assert.equal(order.at(-1), 'c');
});

test('bóveda: escribe .md con frontmatter e importa de vuelta', async () => {
  const { Vault, parseMarkdownFile } = await import('../src/vault.js');
  const dir = tmp();
  const store = new Store(dir);
  const notes = new Notes(store);
  notes.create({ title: 'Mi idea: con / raros', content: 'Hola [[Otra]]', tags: ['x'], type: 'idea' });
  const vault = new Vault(path.join(dir, 'boveda'));
  vault.sync(notes.all);
  const files = fs.readdirSync(vault.dir);
  assert.deepEqual(files, ['Mi idea- con - raros.md']);
  const text = fs.readFileSync(path.join(vault.dir, files[0]), 'utf8');
  const parsed = parseMarkdownFile(files[0], text);
  assert.equal(parsed.content, 'Hola [[Otra]]');
  assert.deepEqual(parsed.tags, ['x']);
  assert.equal(parsed.type, 'idea');
  notes.remove(notes.all[0].id);
  vault.sync(notes.all);
  assert.deepEqual(fs.readdirSync(vault.dir), []);
});

test('bibliotecaria: sugiere notas relacionadas y las enlaza en ambos sentidos', async () => {
  const { keywordSuggestions, applyConnection } = await import('../src/librarian.js');
  const store = new Store(tmp());
  const notes = new Notes(store);
  const a = notes.create({ title: 'Café de especialidad', content: 'Granos de café tostado, baristas y cafetería de barrio' });
  const b = notes.create({ title: 'Menú de la cafetería', content: 'Bebidas de café, baristas expertos y granos locales' });
  notes.create({ title: 'Rutina de ejercicio', content: 'Sentadillas, flexiones y cardio tres veces por semana' });
  const s = keywordSuggestions(notes.all);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].from, s[0].to].sort(), [a.id, b.id].sort());
  applyConnection(notes, s[0]);
  assert.match(notes.get(a.id).content, /## Relacionado\n- \[\[Menú de la cafetería\]\]/);
  assert.match(notes.get(b.id).content, /\[\[Café de especialidad\]\]/);
  assert.equal(keywordSuggestions(notes.all).length, 0, 'ya enlazadas no se vuelven a sugerir');
});

test('continuar una tarea reutiliza el equipo y enlaza con la anterior', async () => {
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const notes = new Notes(store);
  const first = await runTask(store, notes, { prompt: 'Plan de marketing en instagram con seo' });
  const next = await runTask(store, notes, { prompt: 'Hazlo más corto', parentId: first.id });
  assert.equal(next.status, 'done');
  assert.equal(next.parentId, first.id);
  assert.deepEqual(next.steps.map((s) => s.agentId), first.steps.map((s) => s.agentId));
  assert.ok(notes.backlinks(first.noteId).some((b) => b.id === next.noteId));
});

test('reunión: las IAs hablan por turnos y el cerebro resume en una nota', async () => {
  const { runMeeting } = await import('../src/meetings.js');
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const notes = new Notes(store);
  const m = await runMeeting(store, notes, { topic: 'Lanzamiento de una app de recetas', agentIds: ['estratega', 'grok'], rounds: 2 });
  assert.equal(m.status, 'done');
  assert.deepEqual(m.transcript.map((t) => t.agentId), ['estratega', 'grok', 'estratega', 'grok']);
  assert.match(m.transcript[1].text, /O-Estratega/, 'responde a quien habló antes');
  assert.equal(notes.get(m.noteId).tags[0], 'reunion');
});

test('CLIs: el prompt va por stdin o como un solo argumento, sin pasar por la consola', { skip: process.platform === 'win32' }, async () => {
  const { callModel, splitCommand } = await import('../src/providers.js');
  assert.deepEqual(splitCommand('tool run "a b" {prompt}', 'x; rm -rf /'), ['tool', 'run', 'a b', 'x; rm -rf /']);
  const viaStdin = await callModel({ apiKeys: {}, cli: { 'cli-claude': { enabled: true, command: 'cat' } } }, {
    provider: 'cli-claude', model: '', system: 'SYS', messages: [{ role: 'user', content: 'hola $(whoami)' }],
  });
  assert.equal(viaStdin.simulated, false);
  assert.match(viaStdin.text, /Usuario: hola \$\(whoami\)/);
  const viaArg = await callModel({ apiKeys: {}, cli: { 'cli-opencode': { enabled: true, command: 'echo {prompt}' } } }, {
    provider: 'cli-opencode', model: '', system: 'S', messages: [{ role: 'user', content: 'a && b' }],
  });
  assert.match(viaArg.text, /Usuario: a && b/);
  const off = await callModel({ apiKeys: {}, cli: {} }, { provider: 'cli-codex', model: '', system: 'S', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(off.simulated, true, 'sin activar, responde en modo demo');
});

test('la API rechaza peticiones de otros sitios', async () => {
  const app = createApp(new Store(tmp()));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api/settings`;
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url, { headers: { Origin: 'https://sitio-malo.com' } })).status, 403);
    const { request } = await import('node:http');
    const status = await new Promise((resolve) => {
      request(url, { headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).end();
    });
    assert.equal(status, 403);
  } finally {
    server.close();
  }
});

test('memoria compartida: una tarea usa y enlaza notas relacionadas del grafo', async () => {
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const notes = new Notes(store);
  notes.create({ title: 'Receta de arepas', content: 'Las arepas de maíz con queso son el plato estrella de la cafetería' });
  const t = await runTask(store, notes, { prompt: 'Diseña el menú de arepas de la cafetería' });
  assert.ok(t.contextNotes.includes('Receta de arepas'));
  assert.match(notes.get(t.noteId).content, /## Contexto usado\n- \[\[Receta de arepas\]\]/);
});

test('rutinas: se ejecutan una sola vez en su hora y día', async () => {
  const { isDue, normalizeRoutine } = await import('../src/routines.js');
  const r = { ...normalizeRoutine({ prompt: 'Resumen', time: '07:30', days: [1] }), lastRun: null };
  const lunes = new Date(2026, 8, 28, 7, 30); // lunes 28 sep 2026
  const stamp = isDue(r, lunes);
  assert.ok(stamp);
  r.lastRun = stamp;
  assert.equal(isDue(r, lunes), false, 'no se repite en el mismo minuto');
  assert.equal(isDue(r, new Date(2026, 8, 29, 7, 30)), false, 'martes no');
  assert.equal(isDue({ ...r, enabled: false, lastRun: null }, lunes), false);
  assert.deepEqual(normalizeRoutine({ prompt: 'x', time: 'mal', days: [9] }).time, '08:00');
});

test('archivos adjuntos: llegan al equipo y quedan en la nota', async () => {
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const notes = new Notes(store);
  const t = await runTask(store, notes, { prompt: 'Analiza estos datos de ventas', attachments: [{ name: 'ventas.csv', content: 'mes,total\nenero,100' }] });
  assert.deepEqual(t.attachments, [{ name: 'ventas.csv', size: 19 }]);
  assert.match(notes.get(t.noteId).content, /📎 ventas\.csv/);
});

test('revisión de calidad final opcional', async () => {
  const store = new Store(tmp());
  createApp(store);
  Object.assign(store.data.settings, { demoMode: 'always', reviewFinal: true });
  const t = await runTask(store, new Notes(store), { prompt: 'Plan de marketing en instagram' });
  assert.equal(t.review.agentId, 'sonar-check');
  assert.match(t.final, /Revisión de calidad \(Sonar\)/);
});

test('tablero: una tarjeta enviada al equipo pasa a «Hecho» al terminar', async () => {
  const store = new Store(tmp());
  const app = createApp(store);
  store.data.settings.demoMode = 'always';
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/cards`;
  try {
    const card = await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Landing de la cafetería' }) })).json();
    assert.equal(card.column, 'todo');
    const running = await (await fetch(`${base}/${card.id}/run`, { method: 'POST' })).json();
    assert.equal(running.column, 'doing');
    for (let i = 0; i < 60 && store.data.cards[0].column !== 'done'; i++) await new Promise((r) => setTimeout(r, 250));
    assert.equal(store.data.cards[0].column, 'done');
    assert.ok(store.data.cards[0].noteId);
  } finally {
    server.close();
  }
});

test('autoentrenamiento: la IA convierte su experiencia en una lección', async () => {
  const { selfTrain } = await import('../src/orchestrator.js');
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  await assert.rejects(selfTrain(store, 'opencode'), /todavía no tiene experiencia/);
  await runTask(store, new Notes(store), { prompt: 'app web en react', agentIds: ['opencode'] });
  const before = store.data.agents.find((a) => a.id === 'opencode').knowledge.length;
  const item = await selfTrain(store, 'opencode');
  assert.match(item.title, /Lecciones aprendidas/);
  assert.equal(store.data.agents.find((a) => a.id === 'opencode').knowledge.length, before + 1);
});

test('los enlaces vacíos [[ ]] de las plantillas no crean nodos', () => {
  assert.deepEqual(parseLinks('Conecta con [[ ]] y [[Real]]'), ['Real']);
});

test('proveedor compatible con OpenAI: streaming por SSE y errores', async () => {
  const { callModel } = await import('../src/providers.js');
  const http = await import('node:http');
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const data = JSON.parse(body);
      if (data.model === 'malo') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'clave inválida' } }));
      }
      assert.equal(data.stream, true);
      assert.equal(data.messages[0].role, 'system');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const w of ['Hola', ' desde', ' el', ' modelo']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const settings = { apiKeys: { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` } };
  try {
    const parts = [];
    const r = await callModel(settings, { provider: 'ollama', model: 'gemma3', system: 'S', messages: [{ role: 'user', content: 'hola' }], onDelta: (d) => parts.push(d) });
    assert.equal(r.text, 'Hola desde el modelo');
    assert.equal(r.simulated, false);
    assert.equal(parts.length, 4);
    await assert.rejects(callModel(settings, { provider: 'ollama', model: 'malo', system: 'S', messages: [{ role: 'user', content: 'x' }] }), /clave inválida/);
  } finally {
    fake.close();
  }
});

test('Anthropic: streaming con el SDK, fallbacks y esfuerzo', async () => {
  const http = await import('node:http');
  let seen;
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen = { url: req.url, beta: req.headers['anthropic-beta'], body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: seen.body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (const t of ['Soy', ' Claude']) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
      ev('message_stop', {});
      res.end();
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  const { callModel } = await import('../src/providers.js');
  try {
    const parts = [];
    const r = await callModel({ apiKeys: { anthropic: 'sk-ant-prueba-unica' } }, {
      provider: 'anthropic', model: 'claude-opus-5', effort: 'low', system: 'S', messages: [{ role: 'user', content: 'hola' }], onDelta: (d) => parts.push(d),
    });
    assert.equal(r.text, 'Soy Claude');
    assert.deepEqual(parts, ['Soy', ' Claude']);
    assert.match(seen.url, /\/v1\/messages/);
    assert.match(seen.beta, /server-side-fallback-2026-07-01/);
    assert.equal(seen.body.fallbacks, 'default');
    assert.deepEqual(seen.body.output_config, { effort: 'low' });
    assert.equal(seen.body.stream, true);
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
    fake.close();
  }
});

test('resumen del día: nota de diario enlazada a las tareas de hoy', async () => {
  const { dailySummary } = await import('../src/orchestrator.js');
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const notes = new Notes(store);
  await assert.rejects(dailySummary(store, notes), /todavía no hay/);
  const t = await runTask(store, notes, { prompt: 'Plan de marketing en instagram' });
  const n = await dailySummary(store, notes);
  assert.equal(n.type, 'diario');
  assert.ok(n.content.includes(`[[${notes.get(t.noteId).title}]]`));
});

test('uso por proveedor y tamaño máximo del equipo', async () => {
  const { demoPlan } = await import('../src/demo.js');
  const plan = demoPlan('código react pruebas marketing seo finanzas presupuesto investigar diseño ui', DEFAULT_AGENTS, 2);
  assert.equal(plan.subtasks.length, 2);
  const { setUsageSink, callModel } = await import('../src/providers.js');
  const got = [];
  setUsageSink((u) => got.push(u));
  await callModel({ apiKeys: {}, cli: { 'cli-claude': { enabled: true, command: 'cat' } } }, { provider: 'cli-claude', model: '', system: 'SYS', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(got.length, 1);
  assert.equal(got[0].calls, 1);
  setUsageSink(null);
});

test('al reiniciar, lo que quedó a medias se marca como interrumpido', () => {
  const dir = tmp();
  const s1 = new Store(dir);
  createApp(s1);
  s1.data.tasks.unshift({ id: 't_x', title: 'x', prompt: 'x', status: 'working', steps: [{ agentId: 'codex', status: 'working' }], final: '' });
  s1.data.cards.push({ id: 'c_x', title: 'x', column: 'doing', taskId: 't_x' });
  s1.flush();
  const s2 = new Store(dir);
  createApp(s2);
  assert.equal(s2.data.tasks[0].status, 'error');
  assert.equal(s2.data.tasks[0].steps[0].status, 'error');
  assert.equal(s2.data.cards[0].column, 'todo');
});

test('cancelar una tarea en curso la detiene', async () => {
  const { running } = await import('../src/orchestrator.js');
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const p = runTask(store, new Notes(store), { prompt: 'app web en react con pruebas y marketing' });
  await new Promise((r) => setTimeout(r, 100));
  running.get(store.data.tasks[0].id).abort();
  const t = await p;
  assert.equal(t.status, 'error');
  assert.match(t.final, /Cancelada por ti/);
  assert.equal(running.size, 0);
});

test('lectura de enlaces: extrae URLs, limpia HTML y bloquea direcciones privadas', async () => {
  const { extractUrls, htmlToText, isPrivateIp, fetchReadable } = await import('../src/links.js');
  assert.deepEqual(extractUrls('Mira https://ejemplo.com/a, y http://x.org.'), ['https://ejemplo.com/a', 'http://x.org']);
  const { title, text } = htmlToText('<html><title>Hola</title><script>x()</script><p>Uno &amp; dos</p><p>Tres</p></html>');
  assert.equal(title, 'Hola');
  assert.match(text, /Uno & dos\s+Tres/);
  assert.ok(isPrivateIp('192.168.1.5') && isPrivateIp('127.0.0.1') && isPrivateIp('::1') && !isPrivateIp('8.8.8.8'));
  await assert.rejects(fetchReadable('http://localhost:4747/api/settings'), /locales o privadas/);
});

test('reunión: el usuario puede intervenir y la siguiente IA le responde', async () => {
  const { runMeeting } = await import('../src/meetings.js');
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const p = runMeeting(store, new Notes(store), { topic: 'Precio del producto', agentIds: ['estratega', 'llama-fin'], rounds: 2 });
  await new Promise((r) => setTimeout(r, 50));
  store.data.meetings[0].transcript.push({ agentId: 'usuario', name: 'Tú', text: '¿Y si cobramos por suscripción?', round: 1 });
  const m = await p;
  const k = m.transcript.findIndex((t) => t.agentId === 'usuario');
  assert.match(m.transcript[k + 1].text, /Buena pregunta/);
});

test('flujos de relevos: cada IA recibe la entrega de la anterior', async () => {
  const { flowPlan } = await import('../src/flows.js');
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const f = flowPlan('app', store.data.agents);
  const t = await runTask(store, new Notes(store), { prompt: 'app de recetas', agentIds: f.agentIds, template: f.template });
  assert.deepEqual(t.steps.map((s) => s.agentId), ['codex', 'opencode', 'sonnet-qa', 'guardian', 'llama-devops']);
  assert.deepEqual(t.steps[2].dependsOn, ['opencode']);
  assert.match(t.steps[1].output, /Partí del trabajo de Codex/);
});

test('trabajar una nota: el resultado la enlaza', async () => {
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const notes = new Notes(store);
  const t = await runTask(store, notes, { prompt: 'Idea: app de recetas', fromNote: 'Bienvenida a la Oficina' });
  assert.ok(notes.backlinks(notes.findByTitle('Bienvenida a la Oficina').id).some((b) => b.id === t.noteId));
});

test('Anthropic con búsqueda web: continúa tras pause_turn', async () => {
  const http = await import('node:http');
  const bodies = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      bodies.push(JSON.parse(body));
      const first = bodies.length === 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: first ? 'Buscando… ' : 'Resultado final' } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: first ? 'pause_turn' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      ev('message_stop', {});
      res.end();
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  const { callModel } = await import('../src/providers.js');
  try {
    const r = await callModel({ apiKeys: { anthropic: 'sk-ant-prueba-web' }, webSearch: true }, {
      provider: 'anthropic', model: 'claude-sonnet-5', system: 'S', messages: [{ role: 'user', content: 'noticias de hoy' }],
    });
    assert.equal(r.text, 'Buscando… Resultado final');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].tools[0].type, 'web_search_20260209');
    assert.equal(bodies[1].messages.at(-1).role, 'assistant');
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
    fake.close();
  }
});

test('valorar un aporte: se guarda en la memoria y en las estadísticas de la IA', async () => {
  const store = new Store(tmp());
  const app = createApp(store);
  store.data.settings.demoMode = 'always';
  const t = await runTask(store, new Notes(store), { prompt: 'app web en react', agentIds: ['opencode'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/tasks/${t.id}/steps/opencode/rate`;
    const post = (b) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    await post({ value: -1, comment: 'Faltaron las pruebas' });
    await post({ value: 1 });
    const a = store.data.agents.find((x) => x.id === 'opencode');
    assert.equal(a.stats.likes, 1);
    assert.equal(a.stats.dislikes, 0, 'cambiar la valoración no la cuenta dos veces');
    assert.ok(a.memory.some((m) => /NO le gustó.*Faltaron las pruebas/.test(m.text)));
  } finally {
    server.close();
  }
});

test('los errores de la API llegan como JSON', async () => {
  const app = createApp(new Store(tmp()));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{mal' });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'Petición con JSON inválido' });
  } finally {
    server.close();
  }
});

test('menciones sin enlazar: se detectan y se enlazan con un clic', () => {
  const store = new Store(tmp());
  const notes = new Notes(store);
  const a = notes.create({ title: 'Cafetería central', content: 'Idea base' });
  const b = notes.create({ title: 'Plan', content: 'El local de la cafetería central abre en marzo' });
  notes.create({ title: 'Otra', content: 'Ya enlazada: [[Cafetería central]]' });
  const m = notes.unlinkedMentions(a.id);
  assert.deepEqual(m.map((x) => x.id), [b.id]);
  notes.linkMention(b.id, a.id);
  assert.match(notes.get(b.id).content, /\[\[Cafetería central\|cafetería central\]\]/);
  assert.equal(notes.unlinkedMentions(a.id).length, 0);
});

test('tarjetas automáticas con los próximos pasos', async () => {
  const store = new Store(tmp());
  createApp(store);
  Object.assign(store.data.settings, { demoMode: 'always', autoCards: true });
  await runTask(store, new Notes(store), { prompt: 'Plan de marketing en instagram' });
  assert.ok(store.data.cards.length >= 1);
  assert.equal(store.data.cards[0].column, 'todo');
});

test('Gemini: streaming por SSE', async () => {
  const http = await import('node:http');
  let seen;
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen = { url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const t of ['Hola ', 'desde Gemini']) res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`);
      res.end();
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  const { callModel } = await import('../src/providers.js');
  try {
    const r = await callModel({ apiKeys: { google: 'clave-g' } }, { provider: 'google', model: 'gemini-2.5-pro', system: 'S', messages: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'sigue' }] });
    assert.equal(r.text, 'Hola desde Gemini');
    assert.match(seen.url, /gemini-2\.5-pro:streamGenerateContent\?alt=sse/);
    assert.equal(seen.key, 'clave-g');
    assert.deepEqual(seen.body.contents.map((c) => c.role), ['user', 'model', 'user']);
  } finally {
    delete process.env.GEMINI_BASE_URL;
    fake.close();
  }
});

/** Levanta la app en un puerto libre y devuelve un ayudante para llamar a la API. */
async function withApp(store, fn) {
  const app = createApp(store);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  try {
    await fn(call, base);
  } finally {
    server.close();
  }
}

test('varias cuentas: si una se queda sin cupo, se usa la siguiente', async () => {
  const { callModel, PROVIDERS, credentials } = await import('../src/providers.js');
  const http = await import('node:http');
  const seen = [];
  const fake = http.createServer((req, res) => {
    const key = req.headers.authorization;
    seen.push(key);
    req.resume();
    req.on('end', () => {
      if (key === 'Bearer cuenta-1') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Rate limit reached for requests' } }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hola desde la cuenta 2' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const original = PROVIDERS.groq.baseUrl;
  PROVIDERS.groq.baseUrl = `http://127.0.0.1:${fake.address().port}/v1`;
  const settings = { apiKeys: { groq: 'cuenta-1' }, accounts: [{ id: 'acc2', provider: 'groq', label: 'Correo 2', key: 'cuenta-2' }] };
  try {
    assert.deepEqual(credentials(settings, 'groq', 'acc2').map((c) => c.id), ['acc2', 'default']);
    const r = await callModel(settings, { provider: 'groq', model: 'llama', system: 'S', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(r.text, 'hola desde la cuenta 2');
    assert.equal(r.account, 'acc2');
    assert.deepEqual(seen, ['Bearer cuenta-1', 'Bearer cuenta-2']);
    // Un error que no es de cupo no cambia de cuenta.
    await assert.rejects(callModel({ apiKeys: { groq: 'cuenta-1' } }, { provider: 'groq', model: 'llama', system: 'S', messages: [{ role: 'user', content: 'x' }] }), /Rate limit/);
  } finally {
    PROVIDERS.groq.baseUrl = original;
    fake.close();
  }
});

test('cuentas por la API: la clave no se muestra y una CLI recibe su propia carpeta', async () => {
  const store = new Store(tmp());
  await withApp(store, async (call) => {
    let r = await call('POST', '/api/accounts', { provider: 'google', label: 'Correo de Santiago', key: 'AIzaSECRETA1234' });
    assert.equal(r.status, 201);
    const acc = r.data.accounts[0];
    assert.equal(acc.preview, 'AIza…1234');
    assert.ok(!JSON.stringify(r.data).includes('SECRETA'));
    r = await call('POST', '/api/accounts', { provider: 'cli-gemini', label: 'Gemini Pro 2' });
    assert.ok(r.data.accounts[1].home.startsWith(store.dir));
    await call('PUT', '/api/agents/gemini-data', { account: acc.id });
    assert.equal(store.data.agents.find((a) => a.id === 'gemini-data').account, acc.id);
    await call('DELETE', `/api/accounts/${acc.id}`);
    assert.equal(store.data.agents.find((a) => a.id === 'gemini-data').account, undefined);
    const exported = await call('GET', '/api/export');
    assert.ok(!('accounts' in exported.data.settings));
  });
});

test('la sesión de una CLI con otra cuenta usa su propia carpeta', async () => {
  const { cliEnv } = await import('../src/providers.js');
  const dir = tmp();
  assert.equal(cliEnv('cli-codex', dir).CODEX_HOME, dir);
  assert.equal(cliEnv('cli-claude', dir).CLAUDE_CONFIG_DIR, dir);
  const g = cliEnv('cli-gemini', dir);
  assert.equal(g.HOME, dir);
  assert.equal(g.USERPROFILE, dir);
  assert.equal(cliEnv('cli-gemini', null).HOME, process.env.HOME);
});

test('modo gratis: las IAs de pago pasan a modelos gratis y se puede deshacer', async () => {
  const store = new Store(tmp());
  await withApp(store, async (call) => {
    store.data.settings.cli = { 'cli-claude': { enabled: true } };
    const before = Object.fromEntries(store.data.agents.map((a) => [a.id, a.provider]));
    const r = await call('POST', '/api/agents/free-mode');
    assert.ok(r.data.changed > 3);
    const paid = new Set(['anthropic', 'openai', 'xai', 'perplexity', 'together', 'deepseek']);
    assert.ok(store.data.agents.every((a) => !paid.has(a.provider)), 'no quedan IAs de pago');
    // Con Claude Code activo, el cerebro usa la suscripción.
    assert.equal(store.data.agents.find((a) => a.isBrain).provider, 'cli-claude');
    await call('POST', '/api/agents/free-mode/undo');
    assert.deepEqual(Object.fromEntries(store.data.agents.map((a) => [a.id, a.provider])), before);
  });
});

test('la mayoría de las IAs de la plantilla usan modelos gratis', async () => {
  const { PROVIDERS } = await import('../src/providers.js');
  const free = DEFAULT_AGENTS.filter((a) => ['gratis', 'mixto'].includes(PROVIDERS[a.provider].tier) && (PROVIDERS[a.provider].tier !== 'mixto' || a.model.endsWith(':free')));
  assert.ok(free.length > DEFAULT_AGENTS.length / 2, `solo ${free.length} de ${DEFAULT_AGENTS.length} son gratis`);
});

test('núcleos: cada persona tiene sus notas, su perfil y puentes con temas en común', async () => {
  const store = new Store(tmp());
  await withApp(store, async (call) => {
    const nico = { 'X-Nucleo': 'nicolas' };
    await call('POST', '/api/notes', { title: 'Impresora Ender', content: 'Calibrar la impresora ender con filamento petg y cama caliente' }, nico);
    await call('POST', '/api/notes', { title: 'Soporte de celular', content: 'Diseñar soporte en openscad para imprimir con filamento petg' }, nico);
    await call('POST', '/api/notes', { title: 'Taller de Miguel', content: 'Comprar filamento petg y una impresora nueva para el taller' }, { 'X-Nucleo': 'miguel' });
    await call('POST', '/api/notes', { title: 'Nota rara', content: 'x' }, { 'X-Nucleo': 'inventado' });
    assert.equal(store.data.notes.find((n) => n.title === 'Impresora Ender').hub, 'nicolas');
    assert.equal(store.data.notes.find((n) => n.title === 'Nota rara').hub, 'cerebro', 'un núcleo desconocido cae en el cerebro');

    const g = await call('GET', '/api/graph');
    assert.ok(g.data.nodes.some((n) => n.id === 'hub:nicolas' && n.kind === 'hub'));
    assert.ok(g.data.links.some((l) => l.source === 'hub:nicolas' && l.kind === 'hub'));

    const h = await call('GET', '/api/hubs');
    const nicolas = h.data.hubs.find((x) => x.id === 'nicolas');
    assert.equal(nicolas.notes, 2);
    assert.ok(nicolas.topics.some((t) => t.word === 'filamento'));
    const bridge = h.data.bridges.find((b) => [b.a, b.b].sort().join() === 'miguel,nicolas');
    assert.ok(bridge && bridge.shared.includes('filamento'), 'Nicolás y Miguel comparten el tema');

    const s = await call('GET', '/api/hubs/suggest');
    assert.ok(s.data.suggestions.every((x) => store.data.notes.find((n) => n.id === x.from).hub !== store.data.notes.find((n) => n.id === x.to).hub));

    store.data.settings.demoMode = 'always';
    const ask = await call('POST', '/api/hubs/nicolas/ask', { question: '¿qué filamento uso?', save: true });
    assert.ok(ask.data.sources.length >= 1);
    assert.ok(ask.data.sources.every((x) => store.data.notes.find((n) => n.id === x.id).hub === 'nicolas'), 'solo usa notas de ese núcleo');
    assert.equal(store.data.notes.find((n) => n.id === ask.data.noteId).hub, 'nicolas');

    const p = await call('POST', '/api/hubs/nicolas/profile');
    assert.equal(p.data.title, 'Perfil de Nicolás');
    assert.match(p.data.content, /\[\[Perfil de Miguel\]\]/);

    const empty = await call('POST', '/api/hubs/santiago/ask', { question: 'hola' });
    assert.equal(empty.status, 400);

    await call('PUT', '/api/settings', { hubs: [{ name: 'Nicolás' }, { name: 'Laura', color: '#ff0000' }] });
    assert.deepEqual(store.data.settings.hubs.map((x) => x.id), ['cerebro', 'nicolas', 'laura']);
  });
});

test('las tareas guardan sus notas en el núcleo de quien las pidió', async () => {
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.demoMode = 'always';
  const notes = new Notes(store);
  const task = await runTask(store, notes, { prompt: 'Plan para imprimir piezas en 3D', hub: 'santiago' });
  assert.equal(task.hub, 'santiago');
  const mine = store.data.notes.filter((n) => n.source?.taskId === task.id);
  assert.ok(mine.length > 1);
  assert.ok(mine.every((n) => n.hub === 'santiago'));
});

test('Taller 3D: reconoce scripts de Blender, OpenSCAD y FreeCAD', async () => {
  const { extractCadBlocks, wrapPython } = await import('../src/cad.js');
  const md = 'Mira:\n```python\nimport bpy\nbpy.ops.mesh.primitive_cube_add()\n```\n```openscad\ncube(10);\n```\n```python\nimport FreeCAD, Part\n```\n```python\nprint("hola")\n```';
  assert.deepEqual(extractCadBlocks(md).map((b) => b.kind), ['blender', 'openscad', 'freecad']);
  const py = wrapPython('blender', 'import bpy', 'C:\\Users\\Nico\\taller');
  assert.match(py, /OUT_DIR = "C:\\\\Users\\\\Nico\\\\taller"/);
  assert.match(py, /stl_export|export_mesh\.stl/);
});

test('Taller 3D: ejecuta el modelo en el programa y guarda el STL', { skip: process.platform === 'win32' }, async () => {
  const store = new Store(tmp());
  // Un "OpenSCAD" falso que escribe el STL que le piden con -o.
  const fake = path.join(tmp(), 'openscad-falso');
  fs.writeFileSync(fake, '#!/usr/bin/env node\nconst fs = require("fs");\nconst i = process.argv.indexOf("-o");\nfs.writeFileSync(process.argv[i + 1], "solid prueba\\nendsolid prueba\\n");\nconsole.log("Exportado");\n', { mode: 0o755 });
  store.data.settings.cadPaths = { openscad: fake };
  await withApp(store, async (call) => {
    const d = await call('GET', '/api/cad/detect');
    assert.equal(d.data.openscad, fake);
    const r = await call('POST', '/api/cad/run', { kind: 'openscad', code: 'cube([20, 10, 5]);', name: 'Caja de prueba' });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.deepEqual(r.data.files.map((f) => f.name).sort(), ['modelo.scad', 'modelo.stl']);
    assert.match(r.data.log, /Exportado/);
    const jobs = await call('GET', '/api/cad/jobs');
    assert.equal(jobs.data[0].id, r.data.id);
    const bad = await call('GET', `/api/cad/jobs/${r.data.id}/files/..%2F..%2Foficina.json`);
    assert.equal(bad.status, 404);
    // Sin el programa instalado, explica cómo conseguirlo.
    store.data.settings.cadPaths = { blender: '/no/existe' };
    const missing = await call('POST', '/api/cad/run', { kind: 'blender', code: 'import bpy' });
    if (!missing.data.ok) assert.match(missing.data.log, /blender\.org|Blender/);
  });
});

test('oficinas antiguas reciben las IAs del Taller 3D una sola vez', () => {
  const dir = tmp();
  const s1 = new Store(dir);
  createApp(s1);
  s1.data.agents = s1.data.agents.filter((a) => a.department !== 'impresion3d');
  delete s1.data.settings.taller3dSeeded;
  s1.flush();
  const s2 = new Store(dir);
  createApp(s2);
  for (const id of ['blender-3d', 'openscad-3d', 'freecad-3d', 'slicer-3d']) assert.ok(s2.data.agents.some((a) => a.id === id), id);
  s2.data.agents = s2.data.agents.filter((a) => a.id !== 'slicer-3d');
  s2.flush();
  const s3 = new Store(dir);
  createApp(s3);
  assert.ok(!s3.data.agents.some((a) => a.id === 'slicer-3d'), 'si la despides no vuelve');
});

test('accesos: la IA pide ver una carpeta, tú apruebas y sigue con el resultado', async () => {
  const http = await import('node:http');
  const folder = tmp();
  fs.writeFileSync(path.join(folder, 'soporte.stl'), 'solid x');
  fs.writeFileSync(path.join(folder, 'notas.txt'), 'medidas: 80 mm');
  const bodies = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const data = JSON.parse(body);
      bodies.push(data);
      const last = data.messages.at(-1).content;
      const reply = /Resultados de tus acciones/.test(last)
        ? `Encontré: ${/soporte\.stl/.test(last) ? 'soporte.stl' : 'nada'}`
        : `Voy a revisar.\n<<buscar ruta="${folder}" nombre="*.stl">>\n<<leer ruta="${store.dir}/oficina.json">>`;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` };
      await call('PUT', '/api/agents/blender-3d', { provider: 'ollama', model: 'm' });
      const chat = call('POST', '/api/agents/blender-3d/chat', { message: 'busca mis modelos stl' });
      // Aparece la petición de permiso.
      let reqs = [];
      for (let i = 0; i < 50 && !reqs.length; i++) {
        await new Promise((r) => setTimeout(r, 40));
        reqs = (await call('GET', '/api/access')).data.requests;
      }
      assert.equal(reqs.length, 1);
      assert.equal(path.resolve(reqs[0].path), path.resolve(folder));
      assert.equal(reqs[0].mode, 'leer');
      await call('POST', `/api/access/${reqs[0].id}`, { decision: 'always' });
      const r = await chat;
      assert.match(r.data.reply, /Encontré: soporte\.stl/);
      assert.match(r.data.reply, /Accesos usados/);
      // Los datos de la oficina (con las claves) nunca se leen, ni se pregunta.
      const results = bodies[1].messages.at(-1).content;
      assert.match(results, /No permitido/);
      assert.ok(!results.includes('apiKeys'));
      assert.equal(store.data.settings.grants.length, 1, 'quedó guardado el permiso');
      // Con el permiso guardado ya no pregunta.
      const again = await call('POST', '/api/agents/blender-3d/chat', { message: 'otra vez' });
      assert.match(again.data.reply, /soporte\.stl/);
      // No se permite un disco completo.
      const bad = await call('POST', '/api/grants', { path: path.parse(folder).root });
      assert.equal(bad.status, 400);
    });
  } finally {
    fake.close();
  }
});

test('accesos: solo se reconocen las acciones conocidas', async () => {
  const { parseActions } = await import('../src/access.js');
  const acts = parseActions('hola\n<<listar ruta="C:\\Users\\Nico\\Modelos">>\n<<abrir ruta="/tmp/a.stl" programa="blender">>\n<<borrar ruta="/">>');
  assert.deepEqual(acts.map((a) => a.kind), ['listar', 'abrir']);
  assert.equal(acts[0].attrs.ruta, 'C:\\Users\\Nico\\Modelos');
  assert.equal(acts[1].attrs.programa, 'blender');
});

test('Blender en vivo: con tu permiso, la IA modela en la escena abierta y revisa el resultado', async () => {
  const http = await import('node:http');
  const net = await import('node:net');
  const { BLENDER_PORT, addonSource } = await import('../src/blender.js');
  const store = new Store(tmp());
  // Un "Blender" falso que habla como el complemento.
  const received = [];
  const objects = [];
  const blender = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      if (!buf.endsWith('\n')) return;
      const msg = JSON.parse(buf);
      received.push(msg);
      let res;
      if (msg.token !== store.data.settings.blenderToken) res = { ok: false, error: 'Clave incorrecta' };
      else if (msg.cmd === 'ping') res = { ok: true, version: '4.2.0', archivo: '(sin guardar)' };
      else if (msg.cmd === 'ejecutar') {
        objects.push({ nombre: 'Soporte', tipo: 'MESH', ubicacion: [0, 0, 0], dimensiones: [0.08, 0.07, 0.004], modificadores: ['BEVEL'], materiales: [], caras: 6 });
        res = { ok: true, salida: 'creado\n' };
      } else if (msg.cmd === 'escena') res = { ok: true, archivo: '(sin guardar)', unidades: 'METRIC', escala_unidades: 1, objetos: objects, seleccion: [], activo: 'Soporte' };
      else res = { ok: false, error: 'no' };
      sock.end(`${JSON.stringify(res)}\n`);
    });
  });
  blender.listen(BLENDER_PORT, '127.0.0.1');
  await new Promise((r) => blender.once('listening', r));
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const data = JSON.parse(body);
      const last = data.messages.at(-1).content;
      assert.match(data.messages[0].content, /Blender en vivo/, 'la IA sabe que Blender está conectado');
      const reply = /Resultados de tus acciones/.test(last)
        ? `Listo: ${/Soporte \(MESH\)/.test(last) ? 'el soporte ya está en tu escena' : 'no veo nada'}`
        : 'Creo el soporte.\n<<blender-ejecutar>>\n```python\nimport bpy\nbpy.ops.mesh.primitive_cube_add()\n```\n<</blender-ejecutar>>';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  try {
    await withApp(store, async (call) => {
      const st = await call('GET', '/api/blender/status');
      assert.equal(st.data.connected, true);
      assert.equal(st.data.version, '4.2.0');
      assert.ok(!('blenderToken' in (await call('GET', '/api/settings')).data), 'la clave no sale del servidor');
      assert.ok(addonSource(store).includes(store.data.settings.blenderToken));
      assert.ok(!addonSource(store).includes('__TOKEN__'));

      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` };
      await call('PUT', '/api/agents/cerebro', { provider: 'ollama', model: 'm' });
      const chat = call('POST', '/api/agents/cerebro/chat', { message: 'hazme un soporte en blender' });
      let reqs = [];
      for (let i = 0; i < 50 && !reqs.length; i++) {
        await new Promise((r) => setTimeout(r, 40));
        reqs = (await call('GET', '/api/access')).data.requests;
      }
      assert.equal(reqs.length, 1, 'pide permiso antes de tocar la escena');
      assert.equal(reqs[0].mode, 'controlar');
      assert.match(reqs[0].code, /primitive_cube_add/, 'muestra el código que va a ejecutar');
      assert.ok(!received.some((m) => m.cmd === 'ejecutar'), 'no ejecuta nada antes del permiso');
      await call('POST', `/api/access/${reqs[0].id}`, { decision: 'once' });
      const r = await chat;
      assert.match(r.data.reply, /el soporte ya está en tu escena/);
      assert.equal(received.find((m) => m.cmd === 'ejecutar').codigo.trim(), 'import bpy\nbpy.ops.mesh.primitive_cube_add()');
      assert.equal(store.data.settings.blenderControl, undefined, '«solo esta vez» no queda guardado');
      const scene = await call('GET', '/api/blender/escena');
      assert.match(scene.data.texto, /Soporte \(MESH\)/);
    });
  } finally {
    fake.close();
    blender.close();
  }
});

test('Blender: instala el complemento con la clave de la oficina', { skip: process.platform === 'win32' }, async () => {
  const { installAddon } = await import('../src/blender.js');
  const store = new Store(tmp());
  const addons = tmp();
  // Un "Blender" falso que ejecuta la parte de copiar del script de instalación.
  const fakeExe = path.join(tmp(), 'blender-falso');
  fs.writeFileSync(fakeExe, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const code = process.argv[process.argv.indexOf('--python-expr') + 1];
const src = JSON.parse(code.match(/shutil\\.copy\\(("[^"]+")/)[1]);
fs.copyFileSync(src, path.join(${JSON.stringify(addons)}, 'oficina_ias.py'));
if (!code.includes("addon_enable(module='oficina_ias')") || !code.includes('save_userpref')) process.exit(1);
console.log('OFICINA_LISTO:' + ${JSON.stringify(addons)});
`, { mode: 0o755 });
  store.data.settings.cadPaths = { blender: fakeExe };
  const r = await installAddon(store);
  assert.equal(r.ok, true);
  assert.equal(r.folder, addons);
  const installed = fs.readFileSync(path.join(addons, 'oficina_ias.py'), 'utf8');
  assert.ok(installed.includes(`TOKEN = "${store.data.settings.blenderToken}"`));
  assert.match(installed, /PORT = \d+/);
});

test('asistentes: el jefe delega, ellos trabajan y él integra', async () => {
  const http = await import('node:http');
  const calls = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const data = JSON.parse(body);
      const last = data.messages.at(-1).content;
      calls.push(data.model);
      let reply;
      if (data.model === 'asis') reply = 'Componente React listo';
      else if (/Entregas de tus asistentes/.test(last)) reply = `Integré: ${/Componente React listo/.test(last) ? 'el componente de Reactito' : 'nada'}`;
      else reply = 'Esto tiene dos partes.\n<<delegar asistente="Reactito" tarea="Haz el componente de login en React">>';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` };
      const put = await call('PUT', '/api/agents/opencode', { provider: 'ollama', model: 'jefe', assistants: [{ name: 'Reactito', focus: 'React', provider: 'ollama', model: 'asis' }, { focus: 'Python' }, { focus: 'sobra' }] });
      assert.equal(put.data.assistants.length, 2, 'máximo 2 asistentes');
      assert.equal(put.data.assistants[1].name, 'Asistente de Python');
      const task = await runTask(store, new Notes(store), { prompt: 'Haz un login', agentIds: ['opencode'] });
      const step = task.steps[0];
      assert.equal(step.output, 'Integré: el componente de Reactito');
      assert.equal(step.assistants.length, 1, 'solo trabajó el asistente al que delegó');
      assert.equal(step.assistants[0].name, 'Reactito');
      assert.deepEqual(calls, ['jefe', 'asis', 'jefe']);
    });
  } finally {
    fake.close();
  }
});

test('asistentes en modo demo y jefes de departamento que revisan a su equipo', async () => {
  const store = new Store(tmp());
  await withApp(store, async (call) => {
    const depts = new Set(DEFAULT_AGENTS.filter((a) => a.isHead).map((a) => a.department));
    assert.equal(depts.size, DEFAULT_AGENTS.filter((a) => a.isHead).length, 'un jefe por departamento');
    assert.ok(depts.size >= 7);
    // Cambiar de jefe deja uno solo.
    await call('PUT', '/api/agents/opencode', { isHead: true });
    assert.deepEqual(store.data.agents.filter((a) => a.isHead && a.department === 'codigo').map((a) => a.id), ['opencode']);
    await call('PUT', '/api/agents/opencode', { isHead: false });
    await call('PUT', '/api/agents/codex', { isHead: true });

    store.data.settings.demoMode = 'always';
    store.data.settings.headsReview = true;
    await call('PUT', '/api/agents/codestral', { assistants: [{ focus: 'Seguridad' }, { focus: 'Rendimiento' }] });
    const task = await runTask(store, new Notes(store), { prompt: 'Revisa mi código', agentIds: ['opencode', 'codestral'] });
    const reviewed = task.steps.find((s) => s.agentId === 'codestral');
    assert.equal(reviewed.assistants.length, 2, 'en demo, sus dos asistentes aportan');
    assert.match(reviewed.output, /Aportes de mi equipo/);
    const head = task.steps.find((s) => s.agentId === 'codex');
    assert.ok(head?.review, 'el jefe de Ingeniería revisó');
    assert.equal(head.status, 'done');
    assert.match(task.final, /.+/);
  });
});

test('IAs nuevas con proveedores gratis llegan una sola vez a oficinas existentes', async () => {
  const { PROVIDERS } = await import('../src/providers.js');
  const ids = ['voltio', 'laser', 'celda', 'clip', 'newton', 'forma'];
  for (const id of ids) {
    const a = DEFAULT_AGENTS.find((x) => x.id === id);
    assert.ok(a, id);
    assert.equal(PROVIDERS[a.provider].tier, 'gratis', `${id} usa un proveedor gratis`);
  }
  for (const p of ['github', 'sambanova', 'huggingface', 'nvidia', 'cohere']) assert.ok(PROVIDERS[p].baseUrl.startsWith('https://'), p);
  const dir = tmp();
  const s1 = new Store(dir);
  createApp(s1);
  s1.data.agents = s1.data.agents.filter((a) => !ids.includes(a.id));
  delete s1.data.settings.agentsV3Seeded;
  s1.flush();
  const s2 = new Store(dir);
  createApp(s2);
  assert.ok(ids.every((id) => s2.data.agents.some((a) => a.id === id)));
  s2.data.agents = s2.data.agents.filter((a) => a.id !== 'clip');
  s2.flush();
  const s3 = new Store(dir);
  createApp(s3);
  assert.ok(!s3.data.agents.some((a) => a.id === 'clip'), 'si la despides no vuelve');
});

test('medidores: el acierto sube con 👍 y el verificador; la carga sube con textos largos y errores', async () => {
  const http = await import('node:http');
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const data = JSON.parse(body);
      if (data.model === 'sin-cupo') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Rate limit reached' } }));
      }
      const reply = /verificador estricto/.test(data.messages[0].content) ? '{"nota": 4, "motivo": "correcta"}' : 'Aquí está mi aporte';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` };
      let m = (await call('GET', '/api/metrics')).data;
      assert.equal(m.opencode.accuracy.score, 70, 'sin datos parte neutral');
      assert.equal(m.opencode.accuracy.signals, 0);
      assert.equal(m.opencode.load.level, 'tranquila');

      await call('PUT', '/api/agents/opencode', { provider: 'ollama', model: 'm' });
      await call('PUT', '/api/agents/sonnet-qa', { provider: 'ollama', model: 'm' });
      await call('PUT', '/api/settings', { verifySteps: true });
      const task = await runTask(store, new Notes(store), { prompt: 'Haz un script', agentIds: ['opencode'] });
      assert.equal(task.steps[0].verify.score, 4);
      assert.equal(task.steps[0].verify.by, 'Sonnet');
      await call('POST', `/api/tasks/${task.id}/steps/opencode/rate`, { value: 1 });
      m = (await call('GET', '/api/metrics')).data;
      assert.equal(m.opencode.accuracy.parts.verificador.value, 75);
      assert.ok(m.opencode.accuracy.score > 70, `sube con buenas señales (${m.opencode.accuracy.score})`);
      await call('POST', `/api/tasks/${task.id}/steps/opencode/rate`, { value: -1 });
      assert.ok((await call('GET', '/api/metrics')).data.opencode.accuracy.score < m.opencode.accuracy.score, 'baja con 👎');

      // Carga: mensajes enormes y errores por falta de cupo.
      await call('POST', '/api/agents/opencode/chat', { message: 'x'.repeat(150000) });
      await call('PUT', '/api/agents/opencode', { model: 'sin-cupo' });
      for (let i = 0; i < 2; i++) await call('POST', '/api/agents/opencode/chat', { message: 'hola' });
      const load = (await call('GET', '/api/metrics')).data.opencode.load;
      assert.ok(load.parts.contexto > 0);
      assert.ok(load.parts.errores >= 25);
      assert.ok(load.score >= 30, `carga ${load.score}`);
      assert.ok(load.tips.some((t) => /cupo/.test(t)));
    });
  } finally {
    fake.close();
  }
});

test('Claude Desktop: el servidor MCP lista herramientas y usa la oficina', async () => {
  const { spawn } = await import('node:child_process');
  const store = new Store(tmp());
  store.data.settings.demoMode = 'always';
  const app = createApp(store);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const cfg = await (await fetch(`http://127.0.0.1:${port}/api/claude-desktop`)).json();
  assert.ok(cfg.config.mcpServers['oficina-ias'].args[0].endsWith('oficina-mcp.mjs'));
  const token = cfg.config.mcpServers['oficina-ias'].env.OFICINA_TOKEN;
  assert.ok(token.length > 20);
  assert.ok(!('apiToken' in (await (await fetch(`http://127.0.0.1:${port}/api/settings`)).json())), 'el token no sale en los ajustes');
  const child = spawn(process.execPath, [path.resolve('../mcp/oficina-mcp.mjs')], { env: { ...process.env, OFICINA_URL: `http://127.0.0.1:${port}`, OFICINA_TOKEN: token } });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      pending.get(msg.id)?.(msg);
    }
  });
  let n = 0;
  const rpc = (method, params) => new Promise((resolve) => {
    const id = ++n;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'oficina-ias');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tools = (await rpc('tools/list')).result.tools.map((t) => t.name);
    for (const t of ['pedir_tarea', 'hablar_con_ia', 'crear_nota', 'buscar_notas', 'crear_modelo_3d', 'impresora']) assert.ok(tools.includes(t), t);
    const list = await rpc('tools/call', { name: 'listar_ias', arguments: {} });
    assert.match(list.result.content[0].text, /Blendi/);
    await rpc('tools/call', { name: 'crear_nota', arguments: { titulo: 'Desde Claude Desktop', contenido: 'Hola #mcp', nucleo: 'nicolas' } });
    assert.equal(store.data.notes.find((x) => x.title === 'Desde Claude Desktop').hub, 'nicolas');
    const found = await rpc('tools/call', { name: 'buscar_notas', arguments: { texto: 'Claude Desktop' } });
    assert.match(found.result.content[0].text, /Desde Claude Desktop/);
    const chat = await rpc('tools/call', { name: 'hablar_con_ia', arguments: { ia: 'blendi', mensaje: 'hola' } });
    assert.match(chat.result.content[0].text, /Blendi/);
    const bad = await rpc('tools/call', { name: 'hablar_con_ia', arguments: { ia: 'nadie-existe', mensaje: 'x' } });
    assert.equal(bad.result.isError, true);
  } finally {
    child.kill();
    server.close();
  }
});

test('n8n: la oficina llama a sus webhooks y n8n le pide tareas y notas', async () => {
  const http = await import('node:http');
  const got = [];
  const n8n = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      got.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  n8n.listen(0, '127.0.0.1');
  await new Promise((r) => n8n.once('listening', r));
  const url = `http://127.0.0.1:${n8n.address().port}/webhook/abc`;
  const store = new Store(tmp());
  store.data.settings.demoMode = 'always';
  try {
    await withApp(store, async (call, base) => {
      assert.equal((await call('POST', '/api/automations', { name: 'Mal', url: 'ftp://x' })).status, 400);
      const manual = (await call('POST', '/api/automations', { name: 'Guardar en Sheets', url, description: 'Guarda una fila' })).data;
      await call('POST', '/api/automations', { name: 'Avisar', url, trigger: 'tarea' });
      const r = await call('POST', `/api/automations/${manual.id}/run`, { datos: { fila: 1 } });
      assert.equal(r.data.ok, true);
      assert.deepEqual(got[0].datos, { fila: 1 });
      await runTask(store, new Notes(store), { prompt: 'Resumen semanal', agentIds: ['chatgpt'] });
      await new Promise((res) => setTimeout(res, 300));
      const done = got.find((g) => g.evento === 'tarea-terminada');
      assert.ok(done, 'avisa al terminar la tarea');
      assert.equal(done.datos.titulo, 'Resumen semanal');

      // Entrantes: con el token correcto, y aunque n8n llegue con otro Host (Docker).
      const info = (await call('GET', '/api/automations')).data;
      const token = info.hookBase.split('/').pop();
      const viaDocker = await new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: new URL(base).port, path: `/api/hooks/${token}/nota`, method: 'POST', headers: { Host: 'host.docker.internal:4747', 'Content-Type': 'application/json' } }, (res) => {
          let b = '';
          res.on('data', (d) => (b += d));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
        });
        req.end(JSON.stringify({ titulo: 'Pedido de WhatsApp', contenido: 'Cliente quiere 3 soportes', nucleo: 'miguel' }));
      });
      assert.equal(viaDocker.status, 201);
      assert.equal(store.data.notes.find((n) => n.title === 'Pedido de WhatsApp').hub, 'miguel');
      assert.equal((await call('POST', '/api/hooks/malo/nota', { titulo: 'x' })).status, 401);
      const t = await call('POST', `/api/hooks/${token}/tarea`, { tarea: 'Responde al cliente', esperar: true });
      assert.equal(t.data.estado, 'done');
      assert.equal((await call('POST', `/api/hooks/${token}/tarjeta`, { titulo: 'Imprimir soportes' })).status, 201);
      assert.ok(!('hookToken' in (await call('GET', '/api/settings')).data));
      assert.ok((await call('GET', '/api/automations')).data.log.length >= 2);
    });
  } finally {
    n8n.close();
  }
});

test('Bambu Lab P1S: estado por MQTT, órdenes y cámara', async () => {
  const net = await import('node:net');
  const { mqtt } = await import('../src/bambu.js');
  process.env.OFICINA_PRINTER_PLAIN = '1';
  const received = [];
  let auth = null;
  // Una "P1S" falsa: broker MQTT mínimo.
  const broker = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const { packets, rest } = mqtt.parse(buf);
      buf = Buffer.from(rest);
      for (const p of packets) {
        if (p.type === 1) {
          auth = p.body.toString('latin1');
          sock.write(Buffer.from([0x20, 2, 0, auth.includes('12345678') ? 0 : 5]));
        } else if (p.type === 8) sock.write(Buffer.from([0x90, 3, 0, 1, 0]));
        else if (p.type === 3) {
          const msg = JSON.parse(p.payload.toString());
          received.push({ topic: p.topic, msg });
          if (msg.pushing) {
            sock.write(mqtt.publish('device/01P00A123/report', JSON.stringify({ print: { gcode_state: 'RUNNING', mc_percent: 42, mc_remaining_time: 37, layer_num: 80, total_layer_num: 190, nozzle_temper: 219.6, nozzle_target_temper: 220, bed_temper: 55, bed_target_temper: 55, subtask_name: 'soporte', lights_report: [{ node: 'chamber_light', mode: 'on' }] } })));
            // Luego llega solo un cambio parcial (como hace la P1S).
            setTimeout(() => sock.write(mqtt.publish('device/01P00A123/report', JSON.stringify({ print: { mc_percent: 43 } }))), 50);
          }
        }
      }
    });
  });
  broker.listen(0, '127.0.0.1');
  await new Promise((r) => broker.once('listening', r));
  const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  let camAuth = null;
  const camera = net.createServer((sock) => {
    sock.once('data', (d) => {
      camAuth = d;
      const head = Buffer.alloc(16);
      head.writeUInt32LE(jpeg.length, 0);
      sock.write(Buffer.concat([head, jpeg]));
    });
  });
  camera.listen(0, '127.0.0.1');
  await new Promise((r) => camera.once('listening', r));
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      assert.equal((await call('PUT', '/api/printer', { host: '8.8.8.8', serial: 'x', accessCode: 'y' })).status, 400, 'solo IPs locales');
      let st = (await call('PUT', '/api/printer', { host: '127.0.0.1', port: broker.address().port, cameraPort: camera.address().port, serial: '01p00a123', accessCode: '12345678' })).data;
      assert.equal(st.configured, true);
      assert.ok(!JSON.stringify(await call('GET', '/api/settings')).includes('12345678'), 'el código de acceso no sale en los ajustes');
      for (let i = 0; i < 50 && !(st.connected && st.state?.progreso === 43); i++) {
        await new Promise((r) => setTimeout(r, 40));
        st = (await call('GET', '/api/printer/status')).data;
      }
      assert.match(auth, /bblp/);
      assert.equal(st.state.estado, 'imprimiendo');
      assert.equal(st.state.progreso, 43, 'une los cambios parciales');
      assert.equal(st.state.capas, 190);
      assert.equal(st.state.boquilla, 220);
      assert.equal(st.state.luz, true);
      const r = await call('POST', '/api/printer/command', { command: 'pausar' });
      assert.equal(r.status, 200);
      await new Promise((res) => setTimeout(res, 50));
      assert.ok(received.some((x) => x.topic === 'device/01P00A123/request' && x.msg.print?.command === 'pause'));
      assert.equal((await call('POST', '/api/printer/command', { command: 'formatear' })).status, 400);
    });
    // Cámara: autenticación de 80 bytes y una imagen JPEG.
    const { cameraFrame } = await import('../src/bambu.js');
    const frame = await cameraFrame({ host: '127.0.0.1', port: camera.address().port, accessCode: '12345678' }, { plain: true });
    assert.deepEqual([...frame], [...jpeg]);
    assert.equal(camAuth.length, 80);
    assert.equal(camAuth.readUInt32LE(0), 0x40);
    assert.match(camAuth.toString('latin1'), /bblp[\s\S]*12345678/);
  } finally {
    broker.close();
    camera.close();
    const { connectPrinter } = await import('../src/bambu.js');
    connectPrinter({});
    delete process.env.OFICINA_PRINTER_PLAIN;
  }
});

test('acceso remoto: desde otro computador hay que iniciar sesión y los miembros no tocan este equipo', async () => {
  const http = await import('node:http');
  const store = new Store(tmp());
  await withApp(store, async (call, base) => {
    const port = new URL(base).port;
    // Petición "desde otro computador" (con el nombre que da Tailscale).
    const remote = (method, url, body, { cookie, origin, host = 'mi-pc.test' } = {}) => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: `${host}:${port}`, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) } }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode, data: b ? JSON.parse(b) : null, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }));
      });
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    assert.equal((await remote('GET', '/api/agents')).status, 403, 'sin acceso remoto activado, ni responde');
    assert.equal((await call('PUT', '/api/remote', { enabled: true })).status, 400, 'primero hay que crear usuarios');
    assert.equal((await call('POST', '/api/users', { name: 'Santiago', password: 'corta' })).status, 400);
    const santi = (await call('POST', '/api/users', { name: 'Santiago', password: 'contraseña-larga', hub: 'santiago' })).data;
    await call('POST', '/api/users', { name: 'Nicolas', password: 'otra-contraseña', role: 'admin' });
    assert.ok(!JSON.stringify((await call('GET', '/api/users')).data).includes('hash'));
    const on = await call('PUT', '/api/remote', { enabled: true, extraHosts: ['mi-pc.test'] });
    assert.equal(on.data.enabled, true);

    const r401 = await remote('GET', '/api/agents');
    assert.equal(r401.status, 401);
    assert.equal(r401.data.login, true);
    assert.equal((await remote('POST', '/api/auth/login', { name: 'santiago', password: 'mala' })).status, 401);
    const ok = await remote('POST', '/api/auth/login', { name: 'Santiago', password: 'contraseña-larga' });
    assert.equal(ok.status, 200);
    const cookie = ok.cookie;
    assert.match(cookie, /^oficina_sesion=[a-f0-9]{64}$/);
    assert.equal((await remote('GET', '/api/agents', undefined, { cookie })).status, 200);
    const me = await remote('GET', '/api/auth/me', undefined, { cookie });
    assert.equal(me.data.user.name, 'Santiago');
    // Su núcleo se usa por defecto para las notas.
    await remote('POST', '/api/notes', { title: 'Nota desde Bogotá', content: 'x' }, { cookie });
    assert.equal(store.data.notes.find((n) => n.title === 'Nota desde Bogotá').hub, 'santiago');
    // Un miembro no cambia ajustes, no ejecuta scripts en este computador ni aprueba permisos.
    assert.equal((await remote('PUT', '/api/settings', { demoMode: 'always' }, { cookie })).status, 403);
    assert.equal((await remote('POST', '/api/cad/run', { kind: 'openscad', code: 'cube(1);' }, { cookie })).status, 403);
    assert.equal((await remote('POST', '/api/access/r_x', { decision: 'always' }, { cookie })).status, 403);
    assert.equal((await remote('PUT', '/api/remote', { enabled: false }, { cookie })).status, 403);
    // Otra página web no puede usar la sesión.
    assert.equal((await remote('GET', '/api/agents', undefined, { cookie, origin: 'https://pagina-mala.com' })).status, 403);
    assert.equal((await remote('GET', '/api/agents', undefined, { cookie, host: 'pagina-mala.com' })).status, 403);
    // El admin sí puede.
    const admin = await remote('POST', '/api/auth/login', { name: 'Nicolas', password: 'otra-contraseña' });
    assert.equal((await remote('PUT', '/api/settings', { maxTeam: 4 }, { cookie: admin.cookie })).status, 200);
    // Cambiar la contraseña cierra sus sesiones.
    await call('PUT', `/api/users/${santi.id}`, { password: 'nueva-contraseña' });
    assert.equal((await remote('GET', '/api/agents', undefined, { cookie })).status, 401);
    // Demasiados intentos fallidos se frenan.
    let last;
    for (let i = 0; i < 7; i++) last = await remote('POST', '/api/auth/login', { name: 'Santiago', password: 'no' });
    assert.match(last.data.error, /Demasiados intentos/);
    // El respaldo no lleva usuarios ni sesiones.
    const exp = (await call('GET', '/api/export')).data;
    assert.ok(!exp.sessions && !exp.settings.users);
  });
});

test('jurado: jueces de otro proveedor califican a ciegas y se usa la mediana', async () => {
  const http = await import('node:http');
  const { PROVIDERS } = await import('../src/providers.js');
  const judged = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const data = JSON.parse(body);
      let reply = 'Mi aporte: un script de Python que hace el inventario.';
      if (/juez de un jurado/.test(data.messages[0].content)) {
        judged.push(data.messages.at(-1).content);
        reply = JSON.stringify({ nota: data.model === 'estricto' ? 2 : data.model === 'generoso' ? 5 : 4, motivo: 'ok' });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const original = PROVIDERS.groq.baseUrl;
  PROVIDERS.groq.baseUrl = `http://127.0.0.1:${fake.address().port}/v1`;
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      store.data.settings.apiKeys = { groq: 'k', ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` };
      // Solo estas IAs están conectadas: el autor en Ollama y tres posibles jueces.
      for (const a of store.data.agents) if (!['opencode', 'codestral', 'guardian', 'llama-devops'].includes(a.id)) a.provider = 'anthropic';
      await call('PUT', '/api/agents/opencode', { provider: 'ollama', model: 'autor' });
      await call('PUT', '/api/agents/codestral', { provider: 'groq', model: 'estricto' });
      await call('PUT', '/api/agents/guardian', { provider: 'groq', model: 'generoso' });
      await call('PUT', '/api/agents/llama-devops', { provider: 'groq', model: 'normal' });
      await call('PUT', '/api/settings', { jury: { enabled: true, size: 3 } });
      const task = await runTask(store, new Notes(store), { prompt: 'Haz un inventario', agentIds: ['opencode'] });
      const j = task.steps[0].jury;
      assert.equal(j.votes.length, 3);
      assert.ok(!j.votes.some((v) => v.judgeId === 'opencode'), 'nadie se califica a sí mismo');
      assert.equal(j.score, 4, 'mediana de 2, 4 y 5');
      assert.ok(judged.every((p) => !/OpenCode/.test(p) && /autor anónimo/.test(p)), 'califican a ciegas');
      const rep = (await call('GET', '/api/jury')).data;
      assert.equal(rep.recent.length, 1);
      const generous = rep.judges.find((x) => x.id === 'guardian');
      const strict = rep.judges.find((x) => x.id === 'codestral');
      assert.ok(generous.generosity > 0 && strict.generosity < 0, 'detecta jueces generosos y estrictos');
      await call('POST', `/api/tasks/${task.id}/steps/opencode/rate`, { value: 1 });
      const after = (await call('GET', '/api/jury')).data.judges.find((x) => x.id === 'guardian');
      assert.equal(after.agreement, 100, 'coincidió contigo');
      const m = (await call('GET', '/api/metrics')).data.opencode.accuracy;
      assert.equal(m.parts.jurado.value, 75);
    });
  } finally {
    PROVIDERS.groq.baseUrl = original;
    fake.close();
  }
});

test('nodos: la impresora de otra casa y su Ollama se usan a través del nodo', async () => {
  const http = await import('node:http');
  const net = await import('node:net');
  const { mqtt } = await import('../src/bambu.js');
  process.env.OFICINA_PRINTER_PLAIN = '1';
  // Ollama falso en la casa del nodo.
  const ollama = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'gemma3:latest' }] }));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `hola desde el nodo (${JSON.parse(body).model})` } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  ollama.listen(0, '127.0.0.1');
  await new Promise((r) => ollama.once('listening', r));
  process.env.OLLAMA_URL = `http://127.0.0.1:${ollama.address().port}`;
  const orders = [];
  const broker = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const { packets, rest } = mqtt.parse(buf);
      buf = Buffer.from(rest);
      for (const p of packets) {
        if (p.type === 1) sock.write(Buffer.from([0x20, 2, 0, 0]));
        else if (p.type === 3) {
          const msg = JSON.parse(p.payload.toString());
          if (msg.pushing) sock.write(mqtt.publish('device/SERIE1/report', JSON.stringify({ print: { gcode_state: 'RUNNING', mc_percent: 12 } })));
          else orders.push(msg);
        }
      }
    });
  });
  broker.listen(0, '127.0.0.1');
  await new Promise((r) => broker.once('listening', r));
  const { NodeConfig, createNodeApp } = await import(`../src/node.js?${Date.now()}`);
  const cfg = new NodeConfig(tmp());
  const nodeApp = createNodeApp(cfg);
  const nodeServer = nodeApp.listen(0, '127.0.0.1');
  await new Promise((r) => nodeServer.once('listening', r));
  const nodeUrl = `http://127.0.0.1:${nodeServer.address().port}`;
  const store = new Store(tmp());
  try {
    // Sin el código de enlace, el nodo no responde.
    assert.equal((await fetch(`${nodeUrl}/nodo/info`)).status, 401);
    await withApp(store, async (call) => {
      assert.equal((await call('POST', '/api/nodes', { url: 'http://8.8.8.8:4748', token: 'x' })).status, 400, 'solo direcciones de Tailscale o de la red local');
      assert.equal((await call('POST', '/api/nodes', { url: nodeUrl, token: 'mal' })).status, 400);
      const added = await call('POST', '/api/nodes', { url: nodeUrl, token: cfg.data.token, name: 'Bogotá' });
      assert.equal(added.status, 201);
      assert.equal(added.data.info.ollama.running, true);
      const nodeId = added.data.id;
      assert.ok(!JSON.stringify((await call('GET', '/api/settings')).data).includes(cfg.data.token), 'el código de enlace no sale en los ajustes');

      // Impresora en la casa del nodo: el código de acceso se guarda en el nodo, no en la principal.
      await call('PUT', '/api/printer', { node: nodeId, name: 'P1S de Bogotá', host: '127.0.0.1', port: broker.address().port, serial: 'serie1', accessCode: 'codigo123' });
      assert.equal(store.data.settings.printer.node, nodeId);
      assert.ok(!JSON.stringify(store.data.settings.printer).includes('codigo123'));
      assert.equal(cfg.data.printer.accessCode, 'codigo123');
      let st;
      for (let i = 0; i < 80; i++) {
        st = (await call('GET', '/api/printer/status')).data;
        if (st.connected && st.state?.progreso === 12) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(st.state.estado, 'imprimiendo');
      assert.equal(st.node.name, 'Bogotá');
      assert.equal((await call('POST', '/api/printer/command', { command: 'luz_on' })).status, 200);
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(orders.some((o) => o.system?.led_mode === 'on'), 'la orden llegó a la impresora de la otra casa');

      // Ollama del nodo.
      await call('PUT', '/api/settings', { ollamaEnabled: true, ollamaNode: nodeId });
      assert.deepEqual((await call('GET', '/api/ollama/models')).data.models.map((m) => m.name), ['gemma3:latest']);
      await call('PUT', '/api/agents/gemma-salud', { provider: 'ollama', model: 'gemma3' });
      const chat = await call('POST', '/api/agents/gemma-salud/chat', { message: 'hola, ¿quién eres?' });
      assert.match(chat.data.reply, /hola desde el nodo \(gemma3\)/);
      const list = (await call('GET', '/api/nodes')).data;
      assert.equal(list[0].online, true);
      assert.ok(!('token' in list[0]));
    });
  } finally {
    nodeServer.close();
    broker.close();
    ollama.close();
    const { connectPrinter } = await import('../src/bambu.js');
    connectPrinter({});
    delete process.env.OFICINA_PRINTER_PLAIN;
    delete process.env.OLLAMA_URL;
  }
});

test('datos en Documentos: se mudan una vez, hay respaldos diarios y se detectan actualizaciones', async () => {
  const { resolveDataDir } = await import('../src/datadir.js');
  const root = tmp();
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'oficina.json'), '{"notes":[{"title":"vieja"}]}');
  const docs = path.join(tmp(), 'Oficina de IAs');
  const dir = resolveDataDir(root, { env: {}, fallback: docs });
  assert.equal(dir, docs);
  assert.match(fs.readFileSync(path.join(docs, 'oficina.json'), 'utf8'), /vieja/);
  assert.ok(fs.existsSync(path.join(root, 'data', 'MOVIDO.txt')));
  assert.equal(resolveDataDir(root, { env: {}, fallback: '/otra' }), docs, 'recuerda la carpeta elegida');
  assert.equal(resolveDataDir(root, { env: { OFICINA_DATA: '/x' } }), '/x');

  const store = new Store(tmp());
  store.flush();
  const backups = fs.readdirSync(path.join(store.dir, 'respaldos'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^oficina-\d{4}-\d{2}-\d{2}\.json$/);

  // Actualizaciones con git: un "GitHub" local con un cambio nuevo.
  const { execFileSync } = await import('node:child_process');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' } }).toString();
  const remote = tmp();
  g(remote, 'init', '--bare', '-q');
  const a = tmp();
  g(a, 'init', '-q');
  fs.writeFileSync(path.join(a, 'x.txt'), '1');
  g(a, 'add', '.');
  g(a, 'commit', '-qm', 'primera');
  g(a, 'push', '-q', remote, 'HEAD:refs/heads/principal');
  const install = path.join(tmp(), 'app');
  g(path.dirname(install), 'clone', '-q', '-b', 'principal', remote, install);
  fs.writeFileSync(path.join(a, 'x.txt'), '2');
  g(a, 'commit', '-qam', 'Mejora nueva');
  g(a, 'push', '-q', remote, 'HEAD:refs/heads/principal');
  const { updateStatus } = await import('../src/updater.js');
  const st = await updateStatus(install);
  assert.equal(st.git, true);
  assert.equal(st.behind, 1);
  assert.match(st.commits[0], /Mejora nueva/);
  assert.equal((await updateStatus(tmp())).git, false);
});

test('dos Ollama a la vez: cada IA elige el suyo, se reparte y si uno falla se usa el otro', async () => {
  const http = await import('node:http');
  const { ollamaOrder, markDown, markUp } = await import('../src/ollama.js');
  // Ollama falso: responde con su nombre y solo tiene los modelos de su lista.
  const fakeOllama = (who, models) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        if (req.url === '/api/version') return res.end('{"version":"0.9"}');
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
        if (req.url === '/api/pull') {
          const { name } = JSON.parse(body);
          if (name.startsWith('solo-')) return res.end(`${JSON.stringify({ error: 'file does not exist' })}\n`);
          res.write(`${JSON.stringify({ status: 'pulling', total: 10, completed: 5 })}\n`);
          models.push(name.includes(':') ? name : `${name}:latest`);
          return res.end(`${JSON.stringify({ status: 'success' })}\n`);
        }
        const { model } = JSON.parse(body);
        if (!models.some((m) => m === model || m === `${model}:latest`)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: `model "${model}" not found` } }));
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `respondo desde ${who}` } }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    srv.listen(0, '127.0.0.1');
    return srv;
  };
  const localModels = ['gemma3:latest', 'solo-local:latest'];
  const nodeModels = ['phi4:latest'];
  const local = fakeOllama('mosquera', localModels);
  const remote = fakeOllama('bogota', nodeModels);
  await Promise.all([local, remote].map((s) => new Promise((r) => (s.listening ? r() : s.once('listening', r)))));
  process.env.OLLAMA_URL = `http://127.0.0.1:${remote.address().port}`;
  const { NodeConfig, createNodeApp, modelSyncer } = await import(`../src/node.js?dos-${Date.now()}`);
  const cfg = new NodeConfig(tmp());
  const syncer = modelSyncer(cfg, { log: () => {} });
  let updates = 0;
  const nodeServer = createNodeApp(cfg, { syncer, update: () => updates++ }).listen(0, '127.0.0.1');
  await new Promise((r) => nodeServer.once('listening', r));
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${local.address().port}/v1` };
      // Solo Gemma y Phi usan Ollama en esta prueba.
      for (const a of store.data.agents) if (a.provider === 'ollama' && !['gemma-salud', 'phi-tutor'].includes(a.id)) a.enabled = false;
      const nodeId = (await call('POST', '/api/nodes', { url: `http://127.0.0.1:${nodeServer.address().port}`, token: cfg.data.token, name: 'Bogotá' })).data.id;
      const waitSync = async () => {
        await new Promise((res) => setTimeout(res, 60));
        while (syncer.state.running) await new Promise((res) => setTimeout(res, 20));
      };
      // Al enlazarlo, el nodo recibe la lista de modelos de las IAs que corren en él: por ahora ninguna.
      await waitSync();
      assert.deepEqual(cfg.data.ollamaModels, []);
      const servers = (await call('GET', '/api/ollama/servers')).data;
      assert.deepEqual(servers.map((s) => s.id), ['local', `node:${nodeId}`]);
      assert.ok(servers.every((s) => s.running));
      assert.deepEqual(servers[0].wanted, ['gemma3', 'phi4'], 'sin elegir, corren en el Ollama preferido (este computador)');

      // Cada IA usa su Ollama: Gemma el de este computador, Phi el del nodo.
      await call('PUT', '/api/agents/gemma-salud', { provider: 'ollama', model: 'gemma3', account: 'local' });
      await call('PUT', '/api/agents/phi-tutor', { provider: 'ollama', model: 'phi4', account: `node:${nodeId}` });
      await waitSync();
      assert.deepEqual(cfg.data.ollamaModels, ['phi4'], 'el nodo solo pide el modelo de la IA que corre en él');
      const [g, p] = await Promise.all([
        call('POST', '/api/agents/gemma-salud/chat', { message: 'hola' }),
        call('POST', '/api/agents/phi-tutor/chat', { message: 'hola' }),
      ]);
      assert.match(g.data.reply, /desde mosquera/);
      assert.match(p.data.reply, /desde bogota/);

      // «Automático»: el modelo se descarga en todos los Ollama.
      await call('PUT', '/api/agents/gemma-salud', { account: 'auto' });
      await waitSync();
      assert.ok(nodeModels.includes('gemma3:latest'), 'el nodo descargó gemma3 solo');
      assert.deepEqual(cfg.data.ollamaModels, ['gemma3', 'phi4']);

      // Si el modelo no está en el Ollama elegido, se usa el otro que sí lo tiene.
      await call('PUT', '/api/agents/gemma-salud', { model: 'solo-local', account: `node:${nodeId}` });
      assert.match((await call('POST', '/api/agents/gemma-salud/chat', { message: 'hola' })).data.reply, /desde mosquera/);
      await waitSync();
      assert.deepEqual(syncer.state.failed.map((f) => f.model), ['solo-local'], 'el nodo cuenta lo que no pudo descargar');

      // Un Ollama que falló hace poco pasa al final de la fila (incluso en «automático»).
      markDown(`node:${nodeId}`);
      assert.equal(ollamaOrder(store.data.settings, `node:${nodeId}`)[0].id, 'local');
      markUp(`node:${nodeId}`);
      assert.equal(ollamaOrder(store.data.settings, 'auto')[0].id, 'local');

      // Faltan modelos: la principal los descarga en el Ollama que elijas.
      await call('PUT', '/api/agents/phi-tutor', { account: 'auto' });
      const sv = (await call('GET', '/api/ollama/servers')).data;
      assert.deepEqual(sv[0].missing, ['phi4']);
      assert.deepEqual(sv[1].missing, ['solo-local']);
      const sync = await call('POST', '/api/ollama/sync', { server: 'local' });
      assert.deepEqual(sync.data.done, ['phi4']);
      assert.ok(localModels.includes('phi4:latest'));
      const r = await call('POST', `/api/nodes/${nodeId}/models`);
      assert.deepEqual(r.data.wanted, ['phi4', 'solo-local']);

      // Un nodo sin Ollama se puede sacar de la fila.
      await call('PUT', `/api/nodes/${nodeId}`, { ollama: false });
      assert.deepEqual((await call('GET', '/api/ollama/servers')).data.map((s) => s.id), ['local']);
      await call('PUT', `/api/nodes/${nodeId}`, { ollama: true });

      // Actualizaciones del nodo: la principal se las pide.
      assert.equal((await call('POST', `/api/nodes/${nodeId}/update`)).status, 200);
      assert.equal(updates, 1);
      const info = (await call('GET', '/api/nodes')).data[0];
      assert.ok(info.info.version.head, 'el nodo dice su versión');
      assert.equal(info.outdated, false);

      // Al quitar el nodo, las IAs que lo usaban vuelven al Ollama preferido.
      await call('DELETE', `/api/nodes/${nodeId}`);
      assert.equal(store.data.agents.find((a) => a.id === 'gemma-salud').account, undefined);
    });
  } finally {
    nodeServer.close();
    local.close();
    remote.close();
    delete process.env.OLLAMA_URL;
  }
});

test('Gemma 4 (12B, local) llega a las oficinas que ya existían', async () => {
  const store = new Store(tmp());
  store.data.agents = store.data.agents.filter((a) => a.id !== 'gemma4');
  store.data.settings.agentsV3Seeded = true;
  createApp(store).locals.stop?.();
  const g = store.data.agents.find((a) => a.id === 'gemma4');
  assert.equal(g.provider, 'ollama');
  assert.equal(g.model, 'gemma4:12b');
  assert.ok(g.knowledge.length, 'trae su manual');
  // Si la despides, no vuelve a aparecer.
  store.data.agents = store.data.agents.filter((a) => a.id !== 'gemma4');
  createApp(store).locals.stop?.();
  assert.ok(!store.data.agents.some((a) => a.id === 'gemma4'));
});

test('solo IAs conectadas: las de modo demo no trabajan ni se ven, salvo que no haya ninguna conectada', async () => {
  const http = await import('node:http');
  const fake = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'respuesta real' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      // Sin ninguna conectada, trabajan todas en demo (para poder probar la oficina).
      let agents = (await call('GET', '/api/agents')).data;
      assert.ok(agents.every((a) => a.usable));
      assert.equal((await call('GET', '/api/settings')).data.onlyLive, true, 'viene activado');

      // Se conecta Ollama: sus IAs (Gemma, Phi, Gemma 4, Coda…) quedan conectadas; las demás, en demo.
      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` };
      agents = (await call('GET', '/api/agents')).data;
      const live = agents.filter((a) => a.usable && !a.isBrain).map((a) => a.id).sort();
      assert.deepEqual(live, store.data.agents.filter((a) => a.provider === 'ollama').map((a) => a.id).sort());
      assert.ok(live.includes('gemma4') && live.includes('coda-local') && !live.includes('opencode'));
      assert.ok(agents.find((a) => a.isBrain).usable, 'el cerebro siempre se ve');

      // El cerebro (en demo) solo reparte entre las conectadas, y si eliges una en demo se ignora.
      const t1 = await runTask(store, new Notes(store), { prompt: 'Explícame un tema de salud y hábitos de estudio' });
      assert.ok(t1.steps.length > 0);
      assert.ok(t1.steps.every((s) => live.includes(s.agentId)), `trabajaron: ${t1.steps.map((s) => s.agentId)}`);
      const t2 = await runTask(store, new Notes(store), { prompt: 'Haz un script', agentIds: ['opencode', 'phi-tutor'] });
      assert.deepEqual(t2.steps.map((s) => s.agentId), ['phi-tutor']);

      // Asistentes en demo: un jefe conectado no les delega.
      await call('PUT', '/api/agents/phi-tutor', { assistants: [{ name: 'Demo', focus: 'Python', provider: 'groq', model: 'x' }] });
      const chat = await call('POST', '/api/agents/phi-tutor/chat', { message: 'hola' });
      assert.equal(chat.data.reply, 'respuesta real');

      // Reuniones: hacen falta 2 conectadas.
      assert.equal((await call('POST', '/api/meetings', { topic: 'x', agentIds: ['opencode', 'phi-tutor'] })).status, 400);

      // Desactivado, vuelven a trabajar todas.
      await call('PUT', '/api/settings', { onlyLive: false });
      assert.ok((await call('GET', '/api/agents')).data.every((a) => a.usable));
      const t3 = await runTask(store, new Notes(store), { prompt: 'Haz un script', agentIds: ['opencode', 'phi-tutor'] });
      assert.deepEqual(t3.steps.map((s) => s.agentId), ['opencode', 'phi-tutor']);
    });
  } finally {
    fake.close();
  }
});

test('Gemini: los modelos retirados pasan a los 3.x gratis, y llegan las IAs nuevas de Ollama', async () => {
  const http = await import('node:http');
  const { callModel } = await import('../src/providers.js');
  const seen = [];
  const fake = http.createServer((req, res) => {
    req.resume();
    seen.push(req.url);
    if (req.url.includes('gemini-2.5-pro')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'This model models/gemini-2.5-pro is no longer available to new users. Please update your code to use models/gemini-3.1-pro-preview.' } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hola desde 3.8' }] } }] })}\n\n`);
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  try {
    // Una IA con un modelo retirado sigue funcionando con el gratis recomendado, y se queda con él.
    const agent = { id: 'x', name: 'X', provider: 'google', model: 'gemini-2.5-pro' };
    const r = await callModel({ apiKeys: { google: 'k' } }, { provider: 'google', model: agent.model, agent, system: 'S', messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(r.text, 'hola desde 3.8');
    assert.equal(agent.model, 'gemini-3.8-flash');
    assert.ok(seen.at(-1).includes('gemini-3.8-flash'), 'no usa el de pago que sugiere el error');
  } finally {
    fake.close();
    delete process.env.GEMINI_BASE_URL;
  }

  // Oficina que ya existía: se cambian los modelos 2.5 y se agregan las IAs de Ollama.
  const store = new Store(tmp());
  store.data.agents = structuredClone(DEFAULT_AGENTS);
  const g = store.data.agents.find((a) => a.id === 'gemini-data');
  g.model = 'gemini-2.5-pro';
  g.assistants = [{ id: 'as1', name: 'A', focus: 'x', provider: 'google', model: 'gemini-2.5-flash' }];
  store.data.agents = store.data.agents.filter((a) => a.id !== 'coda-local');
  Object.assign(store.data.settings, { agentsV3Seeded: true, gemma4Seeded: true });
  createApp(store).locals.stop?.();
  assert.equal(g.model, 'gemini-3.8-flash');
  assert.equal(g.assistants[0].model, 'gemini-3.7-flash');
  assert.ok(store.data.agents.some((a) => a.id === 'coda-local'));
  assert.ok(!DEFAULT_AGENTS.some((a) => a.provider === 'google' && /gemini-2/.test(a.model)));
});

test('Undermind: se conecta a tu Claude Code y la IA lo usa con permiso solo para sus herramientas', async () => {
  const bin = tmp();
  const state = path.join(bin, 'estado.txt');
  // Claude Code falso: guarda si Undermind está agregado y muestra con qué argumentos lo llamaron.
  fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
const st = fs.existsSync(${JSON.stringify(state)}) ? fs.readFileSync(${JSON.stringify(state)}, 'utf8') : '';
if (a[0] === 'mcp' && a[1] === 'list') console.log(st ? 'undermind: https://mcp.undermind.ai/mcp (HTTP) - ' + (st === 'sesion' ? '✓ Connected' : '⚠ Needs authentication') : 'No MCP servers configured.');
else if (a[0] === 'mcp' && a[1] === 'add') { fs.writeFileSync(${JSON.stringify(state)}, 'agregado'); console.log('Added HTTP MCP server ' + a[a.length - 2]); }
else if (a[0] === 'mcp' && a[1] === 'remove') fs.rmSync(${JSON.stringify(state)}, { force: true });
else { process.stdin.resume(); process.stdin.on('end', () => console.log('ARGS ' + JSON.stringify(a))); }
`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      store.data.settings.cli = { 'cli-claude': { enabled: true } };
      let s = (await call('GET', '/api/mcp/undermind')).data;
      assert.equal(s.status, 'no-agregado');
      assert.equal((await call('GET', '/api/agents')).data.find((a) => a.id === 'undermind').live, false, 'sin Undermind agregado sigue en demo');

      const c = await call('POST', '/api/mcp/undermind/connect');
      assert.equal(c.status, 200);
      assert.equal(c.data.login, 'claude mcp login undermind');
      assert.equal(fs.readFileSync(state, 'utf8'), 'agregado');
      s = (await call('GET', '/api/mcp/undermind')).data;
      assert.equal(s.status, 'falta-sesion');
      fs.writeFileSync(state, 'sesion');
      assert.equal((await call('GET', '/api/mcp/undermind')).data.status, 'conectado');
      assert.equal((await call('GET', '/api/agents')).data.find((a) => a.id === 'undermind').live, true);

      // La IA llama a Claude Code con permiso solo para las herramientas de Undermind.
      const chat = await call('POST', '/api/agents/undermind/chat', { message: '¿qué dice la literatura sobre el sueño y la memoria?' });
      const args = JSON.parse(chat.data.reply.replace(/^ARGS /, ''));
      assert.deepEqual(args.slice(args.indexOf('--allowedTools')), ['--allowedTools', 'mcp__undermind']);
      // Las demás IAs de Claude Code no reciben ese permiso.
      await call('PUT', '/api/agents/sonnet-qa', { provider: 'cli-claude', model: '' });
      assert.ok(!(await call('POST', '/api/agents/sonnet-qa/chat', { message: 'hola' })).data.reply.includes('allowedTools'));

      // Quitarlo: la IA vuelve a demo.
      await call('DELETE', '/api/mcp/undermind');
      assert.equal((await call('GET', '/api/agents')).data.find((a) => a.id === 'undermind').live, false);
      assert.equal((await call('GET', '/api/mcp/nada')).status, 404);
    });
  } finally {
    process.env.PATH = oldPath;
  }
});

test('MiniMax (compatible con OpenAI), el modelo en las CLIs y «Usar mi Gemini Pro»', async () => {
  const http = await import('node:http');
  const { callModel, PROVIDERS } = await import('../src/providers.js');
  let body;
  const fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      body = { auth: req.headers.authorization, ...JSON.parse(b) };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '<think>pienso…</think>\nListo.' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const oldBase = PROVIDERS.minimax.baseUrl;
  PROVIDERS.minimax.baseUrl = `http://127.0.0.1:${fake.address().port}/v1`;
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'gemini'), '#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on("end", () => console.log("ARGS " + JSON.stringify(process.argv.slice(2))));\n', { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  try {
    const r = await callModel({ apiKeys: { minimax: 'mm-clave' } }, { provider: 'minimax', model: 'MiniMax-M3', system: 'S', messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(r.text, 'Listo.', 'se quita el razonamiento <think>');
    assert.equal(body.auth, 'Bearer mm-clave');
    assert.equal(body.reasoning_split, true);
    assert.equal(body.model, 'MiniMax-M3');
    assert.equal(DEFAULT_AGENTS.find((a) => a.id === 'maxi').provider, 'minimax');

    const store = new Store(tmp());
    await withApp(store, async (call) => {
      store.data.settings.cli = { 'cli-gemini': { enabled: true } };
      // Modelo elegido en el perfil: se le pasa a la CLI solo si es de Gemini.
      await call('PUT', '/api/agents/babel', { provider: 'cli-gemini', model: 'gemini-3.8-flash' });
      let reply = (await call('POST', '/api/agents/babel/chat', { message: 'hola' })).data.reply;
      assert.deepEqual(JSON.parse(reply.replace(/^ARGS /, '')).slice(-2), ['-m', 'gemini-3.8-flash']);
      await call('PUT', '/api/agents/babel', { model: 'mistral-small-latest' });
      reply = (await call('POST', '/api/agents/babel/chat', { message: 'hola' })).data.reply;
      assert.ok(!reply.includes('"-m"'), 'un modelo de otro proveedor no se pasa');

      // «Usar mi Gemini Pro»: las IAs de Google pasan a Gemini CLI (modo Auto) y se puede deshacer.
      const google = store.data.agents.filter((a) => a.provider === 'google').map((a) => [a.id, a.model]);
      assert.ok(google.length >= 3);
      const g = await call('POST', '/api/agents/gemini-pro');
      assert.equal(g.data.changed, google.length);
      assert.equal(g.data.cliEnabled, true);
      for (const [id] of google) {
        const a = store.data.agents.find((x) => x.id === id);
        assert.equal(a.provider, 'cli-gemini');
        assert.equal(a.model, '');
      }
      assert.equal((await call('POST', '/api/agents/gemini-pro/undo')).data.restored, google.length);
      for (const [id, model] of google) assert.equal(store.data.agents.find((x) => x.id === id).model, model);
    });
  } finally {
    fake.close();
    PROVIDERS.minimax.baseUrl = oldBase;
    process.env.PATH = oldPath;
  }
});

test('imágenes: la IA escribe <<imagen …>>, la oficina la genera, la guarda y la pone en la respuesta', async () => {
  const http = await import('node:http');
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const seen = [];
  let sawGuide = false;
  const fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: b });
      if (req.url.startsWith('/prompt/')) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(JPG);
      }
      if (req.url.includes('/ai/run/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ result: { image: JPG.toString('base64') }, success: true }));
      }
      // Ollama falso: responde pidiendo una imagen.
      sawGuide ||= JSON.parse(b).messages[0].content.includes('## Imágenes');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Aquí está:\n<<imagen prompt="black angular game console, studio light" formato="16:9">>\nListo.' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const base = `http://127.0.0.1:${fake.address().port}`;
  process.env.POLLINATIONS_BASE = base;
  process.env.CLOUDFLARE_AI_BASE = base;
  const store = new Store(tmp());
  try {
    await withApp(store, async (call, appBase) => {
      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `${base}/v1` };
      assert.equal((await call('GET', '/api/images')).data.active, 'pollinations', 'sin claves funciona con Pollinations');
      await call('PUT', '/api/agents/gemini-visual', { provider: 'ollama', model: 'm' });
      const chat = await call('POST', '/api/agents/gemini-visual/chat', { message: 'hazme una imagen de una consola' });
      assert.ok(sawGuide, 'las IAs saben que pueden generar imágenes');
      const m = chat.data.reply.match(/!\[[^\]]*\]\(\/api\/images\/(img-[\w-]+\.jpg)\)/);
      assert.ok(m, chat.data.reply);
      assert.ok(!chat.data.reply.includes('<<imagen'));
      assert.match(decodeURIComponent(seen.find((x) => x.url.startsWith('/prompt/')).url), /width=1344&height=768/);
      const img = await fetch(`${appBase}/api/images/${m[1]}`);
      assert.equal(img.status, 200);
      assert.deepEqual(Buffer.from(await img.arrayBuffer()), JPG);
      assert.equal((await fetch(`${appBase}/api/images/..%2Foficina.json`)).status, 400);

      // Cloudflare: con Account ID y token, pasa a ser el servicio; el token no sale en los ajustes.
      const s = (await call('PUT', '/api/settings', { images: { service: 'cloudflare', cloudflareAccount: 'cuenta1', cloudflareToken: 'cf-secreto' } })).data;
      assert.equal(s.images.active, 'cloudflare');
      assert.equal(s.images.cloudflareToken, true);
      assert.ok(!JSON.stringify(s).includes('cf-secreto'));
      const gen = await call('POST', '/api/images', { prompt: 'a cat', formato: '1:1' });
      assert.equal(gen.data.service, 'cloudflare');
      const cf = seen.find((x) => x.url.includes('/ai/run/'));
      assert.match(cf.url, /accounts\/cuenta1\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell/);
      assert.equal(cf.auth, 'Bearer cf-secreto');
      assert.deepEqual(Object.keys(JSON.parse(cf.body)).sort(), ['prompt', 'steps'], 'Cloudflare no acepta width ni height');
      assert.ok((await call('GET', '/api/images')).data.files.length >= 2);

      // Apagado: las IAs ya no reciben la guía.
      await call('PUT', '/api/settings', { images: { enabled: false } });
      sawGuide = false;
      await call('POST', '/api/agents/gemini-visual/chat', { message: 'otra' });
      assert.equal(sawGuide, false);
    });
  } finally {
    fake.close();
    delete process.env.POLLINATIONS_BASE;
    delete process.env.CLOUDFLARE_AI_BASE;
  }
});

test('modelos retirados o saturados: la oficina se recupera sola y nunca pasa a uno de pago', async () => {
  const http = await import('node:http');
  const { callModel, PROVIDERS } = await import('../src/providers.js');
  const { healAgents, RETIRED_MODELS } = await import('../src/freeModels.js');
  process.env.OFICINA_RETRY_MS = '10';
  const calls = [];
  let busy = 0;
  const fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      const { model } = JSON.parse(b);
      calls.push(model);
      const fail = (status, message) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message } }));
      };
      if (model === 'llama-3.3-70b-versatile') return fail(404, 'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.');
      if (model === 'openai/gpt-oss-120b' && busy-- > 0) return fail(503, 'This model is currently experiencing high demand. Please try again later.');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `ok con ${model}` } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const oldBase = PROVIDERS.groq.baseUrl;
  PROVIDERS.groq.baseUrl = `http://127.0.0.1:${fake.address().port}`;
  const settings = { apiKeys: { groq: 'gk' } };
  const ask = (agent) => callModel(settings, { provider: 'groq', model: agent.model, agent, system: 'S', messages: [{ role: 'user', content: 'hola' }] });
  try {
    // Retirado: pasa a su reemplazo y la IA se queda con él.
    const a = { id: 'x', provider: 'groq', model: 'llama-3.3-70b-versatile' };
    assert.equal((await ask(a)).text, 'ok con openai/gpt-oss-120b');
    assert.equal(a.model, 'openai/gpt-oss-120b');
    // Saturado una vez: reintenta el mismo modelo.
    busy = 1;
    calls.length = 0;
    assert.equal((await ask(a)).text, 'ok con openai/gpt-oss-120b');
    assert.deepEqual(calls, ['openai/gpt-oss-120b', 'openai/gpt-oss-120b']);
    // Sigue saturado: usa otro gratis del mismo proveedor solo esta vez.
    busy = 2;
    calls.length = 0;
    assert.equal((await ask(a)).text, 'ok con qwen/qwen3.8-27b');
    assert.equal(a.model, 'openai/gpt-oss-120b', 'no cambia su modelo por una saturación');
  } finally {
    fake.close();
    PROVIDERS.groq.baseUrl = oldBase;
    delete process.env.OFICINA_RETRY_MS;
  }
  // Al abrir, las IAs y sus asistentes pasan a los reemplazos; ningún reemplazo es de pago.
  const agents = [{ provider: 'groq', model: 'qwen/qwen3-32b', assistants: [{ provider: 'openrouter', model: 'qwen/qwen3-coder:free' }] }, { provider: 'cerebras', model: 'llama-3.3-70b' }];
  assert.equal(healAgents(agents), 3);
  assert.equal(agents[0].model, 'qwen/qwen3.8-27b');
  assert.equal(agents[0].assistants[0].model, 'qwen/qwen3.8-27b:free');
  for (const next of Object.values(RETIRED_MODELS.openrouter)) assert.match(next, /:free$/);
  for (const a of DEFAULT_AGENTS) assert.ok(!RETIRED_MODELS[a.provider]?.[a.model], `${a.id} usa un modelo retirado`);
});

test('salud de las IAs: las que fallan seguido no reciben trabajo; «Revisar todas» y «Activar las de demo»', async () => {
  const http = await import('node:http');
  let broken = new Set(['roto']);
  const fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (req.url === '/api/tags' || req.url === '/api/version') return res.end('{"models":[]}');
      if (broken.has(JSON.parse(b).model)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end('{"error":{"message":"se cayó"}}');
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'OK' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` };
      // Gemma usa un modelo que se cae.
      await call('PUT', '/api/agents/gemma-salud', { model: 'roto' });
      const r1 = await call('POST', '/api/agents/check');
      const g = r1.data.results.find((x) => x.id === 'gemma-salud');
      assert.equal(g.ok, false);
      assert.ok(r1.data.results.find((x) => x.id === 'phi-tutor').ok);
      let agents = (await call('GET', '/api/agents')).data;
      assert.equal(agents.find((a) => a.id === 'gemma-salud').health.ok, false);
      assert.equal(agents.find((a) => a.id === 'gemma-salud').usable, false, 'con fallas no recibe trabajo');
      assert.equal(agents.find((a) => a.id === 'phi-tutor').usable, true);
      const t = await runTask(store, new Notes(store), { prompt: 'Consejos de salud y de estudio', agentIds: ['gemma-salud', 'phi-tutor'] });
      assert.deepEqual(t.steps.map((s) => s.agentId), ['phi-tutor']);
      // Se arregla: al revisar otra vez vuelve a trabajar.
      broken = new Set();
      await call('POST', '/api/agents/check');
      assert.equal((await call('GET', '/api/agents')).data.find((a) => a.id === 'gemma-salud').usable, true);

      // Las de demo pasan a lo que tienes conectado (aquí solo Ollama).
      const before = store.data.agents.find((a) => a.id === 'babel').provider;
      const rescue = await call('POST', '/api/agents/rescue');
      assert.ok(rescue.data.changed > 5);
      const babel = store.data.agents.find((a) => a.id === 'babel');
      assert.equal(babel.provider, 'ollama');
      assert.equal(babel.demoBackup.provider, before);
      assert.ok(!store.data.agents.find((a) => a.id === 'undermind').demoBackup, 'Undermind no se toca');
      assert.ok((await call('POST', '/api/agents/rescue/undo')).data.restored > 5);
      assert.equal(store.data.agents.find((a) => a.id === 'babel').provider, before);
    });
  } finally {
    fake.close();
  }
  assert.ok(['zeta', 'samba', 'rayo'].every((id) => DEFAULT_AGENTS.some((a) => a.id === id)));
});

test('videos: gratis uniendo imágenes con FFmpeg, o Hailuo de MiniMax; la IA escribe <<video …>>', async () => {
  const http = await import('node:http');
  const { ffmpegPath } = await import('../src/video.js');
  const { runLogged } = await import('../src/system.js');
  // Una imagen JPEG de verdad para las escenas.
  const dir = tmp();
  const jpgFile = path.join(dir, 'escena.jpg');
  await runLogged(await ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=512x512', '-frames:v', '1', jpgFile]);
  const JPG = fs.readFileSync(jpgFile);
  const MP4 = Buffer.from('video-de-minimax');
  const seen = [];
  const fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push({ url: req.url, body: b });
      if (req.url.startsWith('/prompt/')) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(JPG);
      }
      if (req.url === '/v1/video_generation') return res.end(JSON.stringify({ task_id: 't1', base_resp: { status_code: 0 } }));
      if (req.url.startsWith('/v1/query/video_generation')) return res.end(JSON.stringify({ status: seen.filter((x) => x.url.startsWith('/v1/query')).length > 1 ? 'Success' : 'Processing', file_id: 'f1' }));
      if (req.url.startsWith('/v1/files/retrieve')) return res.end(JSON.stringify({ file: { download_url: `http://127.0.0.1:${fake.address().port}/descarga.mp4` } }));
      if (req.url === '/descarga.mp4') return res.end(MP4);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Tu video:\n<<video prompt="a robot in a greenhouse" escenas="robot enters | robot waters plants | sunrise over plants" formato="16:9">>' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const base = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { POLLINATIONS_BASE: base, MINIMAX_BASE: base, OFICINA_VIDEO_POLL_MS: '5' });
  const store = new Store(tmp());
  try {
    await withApp(store, async (call, appBase) => {
      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `${base}/v1` };
      const info = (await call('GET', '/api/videos')).data;
      assert.equal(info.active, 'slideshow');
      assert.equal(info.ffmpeg, true, 'FFmpeg viene con la oficina');
      await call('PUT', '/api/agents/clip', { provider: 'ollama', model: 'm' });
      const chat = await call('POST', '/api/agents/clip/chat', { message: 'hazme un video' });
      const m = chat.data.reply.match(/\(\/api\/videos\/(vid-[\w-]+\.mp4)\)/);
      assert.ok(m, chat.data.reply);
      assert.equal(seen.filter((x) => x.url.startsWith('/prompt/')).length, 3, 'una imagen por escena');
      const vid = await fetch(`${appBase}/api/videos/${m[1]}`);
      assert.equal(vid.status, 200);
      const head = Buffer.from(await vid.arrayBuffer()).subarray(4, 8).toString();
      assert.equal(head, 'ftyp', 'es un MP4 de verdad');

      // Hailuo de MiniMax (de pago): crea la tarea, espera y descarga.
      store.data.settings.apiKeys.minimax = 'mm';
      await call('PUT', '/api/settings', { video: { service: 'minimax' } });
      const v = await call('POST', '/api/videos', { prompt: 'a cat surfing' });
      assert.equal(v.data.service, 'minimax');
      assert.equal(JSON.parse(seen.find((x) => x.url === '/v1/video_generation').body).model, 'MiniMax-Hailuo-2.3');
      assert.deepEqual(Buffer.from(await (await fetch(`${appBase}${v.data.url}`)).arrayBuffer()), MP4);
      assert.equal((await fetch(`${appBase}/api/videos/..%2Foficina.json`)).status, 400);
    });
  } finally {
    fake.close();
    for (const k of ['POLLINATIONS_BASE', 'MINIMAX_BASE', 'OFICINA_VIDEO_POLL_MS']) delete process.env[k];
  }
});

test('Cloudflare (texto, con la cuenta de Imágenes), Ollama Cloud y OVHcloud sin clave', async () => {
  const http = await import('node:http');
  const { callModel, PROVIDERS, hasKey } = await import('../src/providers.js');
  const seen = [];
  const fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, model: JSON.parse(b || '{}').model });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hola' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const base = `http://127.0.0.1:${fake.address().port}`;
  process.env.CLOUDFLARE_AI_BASE = base;
  const old = { oc: PROVIDERS['ollama-cloud'].baseUrl, ovh: PROVIDERS.ovh.baseUrl };
  PROVIDERS['ollama-cloud'].baseUrl = `${base}/oc/v1`;
  PROVIDERS.ovh.baseUrl = `${base}/ovh/v1`;
  const ask = (settings, provider, model) => callModel(settings, { provider, model, system: 'S', messages: [{ role: 'user', content: 'hola' }] });
  try {
    // Cloudflare usa el mismo Account ID y token de Ajustes → Imágenes.
    const acct = 'a'.repeat(32);
    const s1 = { images: { cloudflareAccount: acct, cloudflareToken: 'cf-tok' } };
    assert.equal(hasKey(s1, 'cloudflare'), true);
    assert.equal(hasKey({ images: { cloudflareToken: 'x' } }, 'cloudflare'), false, 'sin Account ID no está conectado');
    assert.equal((await ask(s1, 'cloudflare', '@cf/openai/gpt-oss-120b')).text, 'hola');
    assert.equal(seen.at(-1).url, `/client/v4/accounts/${acct}/ai/v1/chat/completions`);
    assert.equal(seen.at(-1).auth, 'Bearer cf-tok');
    // Ollama Cloud con tu clave de ollama.com.
    await ask({ apiKeys: { 'ollama-cloud': 'oc-key' } }, 'ollama-cloud', 'glm-5.3');
    assert.equal(seen.at(-1).url, '/oc/v1/chat/completions');
    assert.equal(seen.at(-1).auth, 'Bearer oc-key');
    // OVHcloud: gratis sin clave (si lo activas); no manda Authorization.
    assert.equal(hasKey({}, 'ovh'), false);
    await ask({ apiKeys: { ovhAnon: true } }, 'ovh', 'gpt-oss-120b');
    assert.equal(seen.at(-1).url, '/ovh/v1/chat/completions');
    assert.equal(seen.at(-1).auth, undefined);

    const store = new Store(tmp());
    await withApp(store, async (call) => {
      assert.equal((await call('PUT', '/api/settings', { cloudflareAccount: 'no-es-valido' })).status, 400);
      const st = (await call('PUT', '/api/settings', { cloudflareAccount: acct, ovhAnon: true })).data;
      assert.equal(st.cloudflareAccount, acct);
      assert.equal(st.ovhAnon, true);
      assert.equal(st.keys.ovh.configured, true);
    });
    assert.ok(DEFAULT_AGENTS.some((a) => a.id === 'titan' && a.provider === 'ollama-cloud'));
  } finally {
    fake.close();
    delete process.env.CLOUDFLARE_AI_BASE;
    PROVIDERS['ollama-cloud'].baseUrl = old.oc;
    PROVIDERS.ovh.baseUrl = old.ovh;
  }
});

test('CLIs: si Codex no acepta el modelo con tu cuenta de ChatGPT, usa el suyo; si el servidor falla, reintenta', async () => {
  const { callModel } = await import('../src/providers.js');
  process.env.OFICINA_RETRY_MS = '10';
  const bin = tmp();
  const count = path.join(bin, 'veces.txt');
  // Codex falso: rechaza -m como con una cuenta de ChatGPT. OpenCode falso: falla la primera vez.
  fs.writeFileSync(path.join(bin, 'codex'), `#!/usr/bin/env node
const a = process.argv.slice(2);
process.stdin.resume(); process.stdin.on('end', () => {
  if (a.includes('-m')) { console.error('ERROR: {"type":"invalid_request_error","message":"The \\'gpt-5-mini\\' model is not supported when using Codex with a ChatGPT account."}'); process.exit(1); }
  console.log('hola desde codex');
});
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'opencode'), `#!/usr/bin/env node
const fs = require('fs'); const f = ${JSON.stringify(count)};
const n = fs.existsSync(f) ? +fs.readFileSync(f, 'utf8') : 0; fs.writeFileSync(f, String(n + 1));
if (n === 0) { console.error('Error: { "name": "UnknownError", "data": { "message": "Unexpected server error. Check server logs for details." } }'); process.exit(1); }
console.log('hola desde opencode');
`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  try {
    const settings = { cli: { 'cli-codex': { enabled: true }, 'cli-opencode': { enabled: true } } };
    const agent = { id: 'chatgpt', provider: 'cli-codex', model: 'gpt-5-mini' };
    const r = await callModel(settings, { provider: 'cli-codex', model: agent.model, agent, system: 'S', messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(r.text, 'hola desde codex');
    assert.equal(agent.model, '', 'la IA queda con el modelo que elija Codex');
    const o = await callModel(settings, { provider: 'cli-opencode', model: '', system: 'S', messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(o.text, 'hola desde opencode');
    assert.equal(fs.readFileSync(count, 'utf8'), '2');
  } finally {
    process.env.PATH = oldPath;
    delete process.env.OFICINA_RETRY_MS;
  }
});

test('tiempos: cada paso mide cuánto tardó, con un solo aporte no se integra de nuevo y Gemini CLI confía en su carpeta', async () => {
  const http = await import('node:http');
  const { cliEnv } = await import('../src/providers.js');
  assert.equal(cliEnv('cli-gemini', null).GEMINI_CLI_TRUST_WORKSPACE, 'true');
  let calls = 0;
  const fake = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Aporte único.\n\n### Ideas clave\n- una' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      store.data.settings.apiKeys = { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` };
      await call('PUT', '/api/agents/cerebro', { provider: 'ollama', model: 'm' });
      const t = await runTask(store, new Notes(store), { prompt: 'Una pregunta corta', agentIds: ['phi-tutor'] });
      assert.equal(t.steps.length, 1);
      assert.equal(typeof t.steps[0].ms, 'number');
      assert.equal(typeof t.ms, 'number');
      assert.match(t.final, /Aporte único/);
      assert.equal(calls, 1, 'el cerebro no vuelve a escribir lo mismo');
    });
  } finally {
    fake.close();
  }
});

test('NVIDIA: imágenes FLUX en cualquier formato, TRELLIS de texto o imagen a STL, y Mistral sin cuenta de Mistral', async () => {
  const http = await import('node:http');
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const STL = Buffer.from('solid modelo\nendsolid modelo\n');
  const seen = [];
  const fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      const body = b ? JSON.parse(b) : {};
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/genai/black-forest-labs/flux.1-schnell') return res.end(JSON.stringify({ artifacts: [{ base64: JPG.toString('base64'), finishReason: 'SUCCESS' }] }));
      if (req.url === '/v1/genai/microsoft/trellis') return res.end(JSON.stringify({ artifacts: [{ base64: STL.toString('base64'), finishReason: 'SUCCESS' }] }));
      res.setHeader('Content-Type', 'text/event-stream');
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Listo:\n<<modelo3d prompt="a cute low-poly fox">>' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  process.env.NVIDIA_GENAI_BASE = `http://127.0.0.1:${fake.address().port}`;
  const store = new Store(tmp());
  try {
    await withApp(store, async (call) => {
      assert.equal((await call('GET', '/api/cad/detect')).data.trellis, false);
      store.data.settings.apiKeys = { nvidia: 'nv-key', ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${fake.address().port}/v1` };
      assert.equal((await call('GET', '/api/cad/detect')).data.trellis, true);
      // Imágenes con NVIDIA: 16:9 de verdad.
      await call('PUT', '/api/settings', { images: { service: 'nvidia' } });
      const img = await call('POST', '/api/images', { prompt: 'a fox', formato: '16:9' });
      assert.equal(img.data.service, 'nvidia');
      const nv = seen.find((x) => x.url.includes('flux'));
      assert.equal(nv.auth, 'Bearer nv-key');
      assert.deepEqual([nv.body.width, nv.body.height], [1344, 768]);
      // TRELLIS desde texto (botón del Taller).
      const t = await call('POST', '/api/cad/trellis', { prompt: 'a small dragon figurine' });
      assert.equal(t.data.kind, 'trellis');
      assert.ok(t.data.files.some((f) => f.name === 'modelo.stl'));
      assert.equal(seen.find((x) => x.url.includes('trellis')).body.mode, 'text');
      assert.equal(seen.find((x) => x.url.includes('trellis')).body.output_format, 'stl');
      // Desde una imagen.
      await call('POST', '/api/cad/trellis', { image: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}` });
      assert.equal(seen.filter((x) => x.url.includes('trellis')).at(-1).body.mode, 'image');
      // Una IA lo pide con <<modelo3d …>> y queda en el Taller.
      await call('PUT', '/api/agents/blender-3d', { provider: 'ollama', model: 'm' });
      const chat = await call('POST', '/api/agents/blender-3d/chat', { message: 'hazme un zorro para imprimir' });
      assert.match(chat.data.reply, /Modelo 3D listo/);
      assert.equal((await call('GET', '/api/cad/jobs')).data.filter((j) => j.kind === 'trellis').length, 3);
      // Las IAs de Mistral (sin cuenta de Mistral) pasan a Mistral Large 2 por NVIDIA.
      await call('POST', '/api/agents/rescue');
      const m = store.data.agents.find((a) => a.id === 'mistral-story');
      assert.equal(m.provider, 'nvidia');
      assert.equal(m.model, 'mistralai/mistral-large-2-instruct');
    });
  } finally {
    fake.close();
    delete process.env.NVIDIA_GENAI_BASE;
  }
  assert.ok(['galena', 'balance', 'musa'].every((id) => DEFAULT_AGENTS.find((a) => a.id === id)?.provider === 'nvidia'));
});

test('Ollama Cloud: si el modelo no entra en el plan gratis, prueba los económicos hasta dar con uno', async () => {
  const http = await import('node:http');
  const { callModel, PROVIDERS } = await import('../src/providers.js');
  const tried = [];
  const fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (req.method === 'GET') return res.end(JSON.stringify({ data: ['gpt-oss:20b', 'nemotron-3-super', 'gemma4'].map((id) => ({ id })) }));
      const { model } = JSON.parse(b);
      tried.push(model);
      if (model !== 'nemotron-3-super') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'this model is not included in your free usage, add usage credits to pay as you go' }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  fake.listen(0, '127.0.0.1');
  await new Promise((r) => fake.once('listening', r));
  const old = PROVIDERS['ollama-cloud'].baseUrl;
  PROVIDERS['ollama-cloud'].baseUrl = `http://127.0.0.1:${fake.address().port}/v1`;
  try {
    const agent = { id: 'titan', provider: 'ollama-cloud', model: 'gpt-oss:120b' };
    const r = await callModel({ apiKeys: { 'ollama-cloud': 'k' } }, { provider: 'ollama-cloud', model: agent.model, agent, system: 'S', messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(r.text, 'ok');
    assert.deepEqual(tried, ['gpt-oss:120b', 'gpt-oss:20b', 'nemotron-3-super']);
    assert.equal(agent.model, 'nemotron-3-super', 'se queda con el que sí está incluido');
  } finally {
    fake.close();
    PROVIDERS['ollama-cloud'].baseUrl = old;
  }
});

test('OpenCode CLI: con un modelo de otro proveedor usa los gratis de OpenCode Zen hasta dar con uno que funcione', async () => {
  const { callModel } = await import('../src/providers.js');
  process.env.OFICINA_RETRY_MS = '5';
  const bin = tmp();
  const log = path.join(bin, 'args.txt');
  // Solo responde con Nemotron 3 Ultra (los demás, «Unexpected server error»).
  fs.writeFileSync(path.join(bin, 'opencode'), `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a.filter((x) => x !== a[1])) + '\\n');
const m = a[a.indexOf('-m') + 1];
if (!a.includes('-m') || m !== 'opencode/nemotron-3-ultra-free') { console.error('Error: { "name": "UnknownError", "data": { "message": "Unexpected server error." } }'); process.exit(1); }
console.log('hola desde nemotron');
`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  try {
    const agent = { id: 'opencode', provider: 'cli-opencode', model: 'qwen/qwen3.8-27b:free' };
    const r = await callModel({ cli: { 'cli-opencode': { enabled: true } } }, { provider: 'cli-opencode', model: agent.model, agent, system: 'S', messages: [{ role: 'user', content: 'hola' }] });
    assert.equal(r.text, 'hola desde nemotron');
    assert.equal(agent.model, 'opencode/nemotron-3-ultra-free');
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(!calls[0].includes('-m'), 'un modelo de OpenRouter no se le pasa a OpenCode');
  } finally {
    process.env.PATH = oldPath;
    delete process.env.OFICINA_RETRY_MS;
  }
});

test('nodos: «Probar conexión» explica qué falla (dirección, llegada, código, Ollama)', async () => {
  const { diagnoseNode, normalizeNodeUrl } = await import('../src/devices.js');
  assert.equal(normalizeNodeUrl('http://la97:4748'), 'http://la97:4748', 'acepta el nombre corto de Tailscale');
  assert.throws(() => normalizeNodeUrl('https://google.com'));
  const { NodeConfig, createNodeApp } = await import(`../src/node.js?diag-${Date.now()}`);
  const cfg = new NodeConfig(tmp());
  const srv = createNodeApp(cfg, { syncer: { state: {}, run: async () => ({}) } }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    const ok = await diagnoseNode({ url, token: cfg.data.token });
    assert.ok(ok.steps.slice(0, 3).every((s) => s.ok), JSON.stringify(ok.steps));
    const bad = await diagnoseNode({ url, token: 'malo' });
    assert.match(bad.steps.at(-1).fix, /código de enlace no coincide/);
    // Un puerto donde no hay nada escuchando (nodo.bat cerrado).
    const net = await import('node:net');
    const free = await new Promise((r) => { const t = net.createServer().listen(0, '127.0.0.1', () => { const p = t.address().port; t.close(() => r(p)); }); });
    const closed = await diagnoseNode({ url: `http://127.0.0.1:${free}`, token: 'x' });
    assert.match(closed.steps.at(-1).fix, /abre nodo\.bat/);
  } finally {
    srv.close();
  }
});

test('errores de las IAs: tipo, explicación y cuánto esperar', async () => {
  const { classifyError, retryAfterMs, isTemporaryError } = await import('../src/errors.js');
  assert.equal(classifyError('Groq: Rate limit reached for model. Please try again in 7m12.5s. (429)'), 'cupo');
  assert.equal(classifyError('OpenRouter: Invalid API key (401)'), 'clave');
  assert.equal(classifyError('Gemini: models/gemini-2.5-pro is no longer available'), 'modelo');
  assert.equal(classifyError('fetch failed'), 'red');
  assert.equal(classifyError('Cerebras: Service Unavailable (503)'), 'saturado');
  assert.equal(classifyError('No encontré el comando «codex»'), 'programa');
  assert.equal(classifyError('Cancelada'), 'cancelada');
  assert.ok(isTemporaryError('too many requests') && !isTemporaryError('Invalid API key (401)'));
  assert.equal(retryAfterMs('Please try again in 7m12.5s'), (7 * 60 + 12.5) * 1000 + 2000);
  assert.equal(retryAfterMs('Please retry in 41.2s'), Math.ceil(41.2 * 1000) + 2000);
  assert.equal(retryAfterMs('x', 30000), 30000, 'el encabezado Retry-After manda');
  assert.equal(retryAfterMs('Rate limit exceeded: free-models-per-day'), 120 * 60000);
  assert.equal(retryAfterMs('Rate limit'), 10 * 60000);
  assert.equal(retryAfterMs('You have hit your usage limit, try again in 2 days 3 hours'), (2 * 24 + 3) * 3600000 > 3 * 24 * 3600000 ? 3 * 24 * 3600000 : (2 * 24 + 3) * 3600000 + 2000);
  assert.equal(retryAfterMs('Rate limit reached. Please try again in 500ms.'), 2500);
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const ms = retryAfterMs(`Claude AI usage limit reached|${reset}`);
  assert.ok(ms > 3590000 && ms < 3700000, `vuelve en ~1 h (${ms})`);
});

/** Proveedor falso compatible con OpenAI: responde según el modelo pedido. */
async function fakeModels(rules) {
  const http = await import('node:http');
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const { model } = JSON.parse(body || '{}');
      calls.push(model);
      const rule = rules[model] || 'ok';
      if (rule === 'cupo') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Rate limit reached for model. Please try again in 1m30s.' } }));
      }
      if (rule === 'cae') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Internal error' } }));
      }
      if (rule === 'vacio' || rule === 'piensa') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const content = rule === 'piensa' ? '<think>pensando en voz alta…</think>\n\nRespuesta limpia' : '';
        return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `Respuesta de ${model}` } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  srv.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { srv, calls, url: `http://127.0.0.1:${srv.address().port}/v1` };
}

/** Oficina con solo unas IAs reales (Groq y Ollama apuntan al proveedor falso). */
async function liveOffice(url, team) {
  const { PROVIDERS } = await import('../src/providers.js');
  const store = new Store(tmp());
  createApp(store);
  store.data.settings.apiKeys = { groq: 'clave', ollamaEnabled: true, ollamaUrl: url };
  store.data.settings.headsReview = false;
  const original = PROVIDERS.groq.baseUrl;
  PROVIDERS.groq.baseUrl = url;
  for (const a of store.data.agents) {
    const t = team[a.id];
    a.enabled = Boolean(t || a.isBrain);
    if (t) Object.assign(a, t, { assistants: [] });
  }
  return { store, restore: () => (PROVIDERS.groq.baseUrl = original) };
}

test('si una IA falla o se queda sin cupo, otra retoma su paso', async () => {
  const { healthOf } = await import('../src/metrics.js');
  const fake = await fakeModels({ 'sin-cupo': 'cupo' });
  const { store, restore } = await liveOffice(fake.url, {
    cerebro: { provider: 'groq', model: 'cerebro' },
    chatgpt: { provider: 'groq', model: 'sin-cupo' },
    perplexity: { provider: 'ollama', model: 'suplente' },
  });
  try {
    const t = await runTask(store, new Notes(store), { prompt: 'Escribe un saludo', agentIds: ['chatgpt'], saveNotes: false });
    assert.equal(t.status, 'done', t.final);
    assert.equal(t.steps.length, 1);
    assert.equal(t.steps[0].agentId, 'perplexity', 'la IA suplente hizo el paso');
    assert.equal(t.steps[0].failed[0].agentId, 'chatgpt');
    assert.equal(t.steps[0].failed[0].kind, 'cupo');
    assert.match(t.final, /Respuesta de suplente/);
    const h = healthOf(store, 'chatgpt');
    assert.equal(h.ok, false, 'sin cupo: descansa un rato');
    assert.ok(h.quota && h.until > Date.now() + 60000);
    assert.equal(healthOf(store, 'perplexity').ok, true);
  } finally {
    restore();
    fake.srv.close();
  }
});

test('sin cupo en ninguna IA: la tarea espera y se retoma sola con lo que faltó', async () => {
  const { resumeTask } = await import('../src/orchestrator.js');
  const rules = { 'a-sin-cupo': 'cupo', 'b-sin-cupo': 'cupo' };
  const fake = await fakeModels(rules);
  const { store, restore } = await liveOffice(fake.url, {
    cerebro: { provider: 'groq', model: 'cerebro' },
    chatgpt: { provider: 'groq', model: 'a-sin-cupo' },
    perplexity: { provider: 'ollama', model: 'b-sin-cupo' },
  });
  try {
    const t = await runTask(store, new Notes(store), { prompt: 'Resume esto', agentIds: ['chatgpt'], saveNotes: false });
    assert.equal(t.status, 'waiting', t.final);
    assert.ok(Date.parse(t.resume.at) > Date.now(), 'tiene hora para retomarse');
    assert.equal(t.resume.attempts, 1);
    assert.match(t.final, /Sin cupo/);
    // Vuelve el cupo: el proveedor responde y termina la espera.
    delete rules['a-sin-cupo'];
    for (const m of Object.values(store.data.metrics)) for (const r of m.recent) if (r.until) r.until = Date.now() - 1;
    const done = await resumeTask(store, new Notes(store), t);
    assert.equal(done.status, 'done', done.final);
    assert.match(done.final, /Respuesta de a-sin-cupo/);
    assert.equal(done.resume, undefined, 'ya no guarda el contexto para retomarla');
  } finally {
    restore();
    fake.srv.close();
  }
});

test('si el Cerebro falla al integrar, lo suple otra IA (el trabajo no se pierde)', async () => {
  const fake = await fakeModels({ 'cerebro-caido': 'cae' });
  const { store, restore } = await liveOffice(fake.url, {
    cerebro: { provider: 'groq', model: 'cerebro-caido' },
    chatgpt: { provider: 'groq', model: 'redactor' },
    perplexity: { provider: 'ollama', model: 'investigador' },
  });
  try {
    const t = await runTask(store, new Notes(store), { prompt: 'Plan de un viaje', agentIds: ['perplexity', 'chatgpt'], saveNotes: false });
    assert.equal(t.status, 'done', t.final);
    assert.equal(t.steps.filter((s) => s.status === 'done').length, 2);
    assert.ok(['chatgpt', 'perplexity'].includes(t.synthBy), `integró ${t.synthBy}`);
    assert.match(t.final, /Respuesta de (redactor|investigador)/);
  } finally {
    restore();
    fake.srv.close();
  }
});

test('chat: si su motor falla (o no está conectada) responde con el de otra IA, sin dejar de ser ella', async () => {
  const { chatWithAgent } = await import('../src/orchestrator.js');
  const fake = await fakeModels({ 'sin-cupo': 'cupo' });
  const { store, restore } = await liveOffice(fake.url, {
    cerebro: { provider: 'groq', model: 'cerebro' },
    chatgpt: { provider: 'groq', model: 'sin-cupo' },
    perplexity: { provider: 'ollama', model: 'suplente' },
    lexi: { provider: 'anthropic', model: 'claude-sonnet-5' },
  });
  try {
    const r = await chatWithAgent(store, 'chatgpt', 'hola');
    assert.equal(r.reply, 'Respuesta de suplente');
    assert.equal(r.via, 'perplexity', 'prefiere otro proveedor');
    const last = store.data.chats.chatgpt.at(-1);
    assert.equal(last.failed.kind, 'cupo');
    // Lexi está en modo demo (sin clave de Anthropic): responde con un motor conectado, no con texto simulado.
    const d = await chatWithAgent(store, 'lexi', '¿qué es un contrato?');
    assert.equal(d.simulated, false);
    assert.ok(d.via);
    assert.equal(store.data.chats.lexi.at(-1).failed.kind, 'demo');
  } finally {
    restore();
    fake.srv.close();
  }
});

test('reunión: quien falla no llena la charla de errores y otra IA hace el resumen', async () => {
  const { runMeeting } = await import('../src/meetings.js');
  const fake = await fakeModels({ 'cerebro-caido': 'cae', 'cae-tambien': 'cae' });
  const { store, restore } = await liveOffice(fake.url, {
    cerebro: { provider: 'groq', model: 'cerebro-caido' },
    chatgpt: { provider: 'groq', model: 'cae-tambien' },
    perplexity: { provider: 'ollama', model: 'investigador' },
    lexi: { provider: 'ollama', model: 'legal' },
  });
  try {
    const m = await runMeeting(store, new Notes(store), { topic: 'Precios de la tienda', agentIds: ['chatgpt', 'perplexity', 'lexi'], rounds: 2 });
    assert.equal(m.status, 'done', m.summary);
    const fromChatgpt = m.transcript.filter((t) => t.agentId === 'chatgpt');
    assert.equal(fromChatgpt.length, 1, 'solo aparece una vez');
    assert.match(fromChatgpt[0].text, /No pudo intervenir/);
    assert.equal(m.transcript.filter((t) => t.agentId === 'perplexity').length, 2);
    assert.ok(['perplexity', 'lexi'].includes(m.summaryBy), `resumió ${m.summaryBy}`);
    assert.match(m.summary, /Respuesta de (investigador|legal)/);
  } finally {
    restore();
    fake.srv.close();
  }
});

test('si el proveedor se queda callado, se corta pronto (no espera los 10 minutos)', async () => {
  const { callModel } = await import('../src/providers.js');
  const http = await import('node:http');
  const hung = http.createServer(() => {}); // recibe la petición y nunca contesta
  hung.listen(0, '127.0.0.1');
  await new Promise((r) => hung.once('listening', r));
  process.env.OFICINA_IDLE_MS = '300';
  const t0 = Date.now();
  try {
    await assert.rejects(
      callModel({ apiKeys: { ollamaEnabled: true, ollamaUrl: `http://127.0.0.1:${hung.address().port}/v1` } }, { provider: 'ollama', model: 'x', system: 'S', messages: [{ role: 'user', content: 'hola' }] }),
      /dejó de responder/,
    );
    assert.ok(Date.now() - t0 < 5000);
  } finally {
    delete process.env.OFICINA_IDLE_MS;
    hung.closeAllConnections?.();
    hung.close();
  }
});

test('cupo por segundos: espera y reintenta; máximo 2 llamadas a la vez por cuenta gratis; clave rechazada vale para todo el proveedor', async () => {
  const { callModel, PROVIDERS, setCallSink } = await import('../src/providers.js');
  const { recordCall, healthOf } = await import('../src/metrics.js');
  const http = await import('node:http');
  let n = 0;
  let now = 0;
  let peak = 0;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const { model } = JSON.parse(body);
      if (req.headers.authorization === 'Bearer vencida') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }));
      }
      if (model === 'por-segundos' && n++ === 0) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Rate limit reached for model. Please try again in 0.05s.' } }));
      }
      now++;
      peak = Math.max(peak, now);
      setTimeout(() => {
        now--;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
      }, model === 'lento' ? 150 : 0);
    });
  });
  srv.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const original = PROVIDERS.groq.baseUrl;
  PROVIDERS.groq.baseUrl = `http://127.0.0.1:${srv.address().port}/v1`;
  const settings = { apiKeys: { groq: 'clave' } };
  const ask = (model, s = settings, agent) => callModel(s, { provider: 'groq', model, agent, system: 'S', messages: [{ role: 'user', content: 'x' }] });
  try {
    assert.equal((await ask('por-segundos')).text, 'ok', 'esperó unos segundos y reintentó');
    await Promise.all([ask('lento'), ask('lento'), ask('lento'), ask('lento')]);
    assert.equal(peak, 2, 'nunca más de 2 a la vez en la misma cuenta');
    // Clave rechazada: las demás IAs de Groq también quedan con fallas.
    const store = new Store(tmp());
    store.data.agents = [{ id: 'a', provider: 'groq', enabled: true }, { id: 'b', provider: 'groq', enabled: true }, { id: 'c', provider: 'ollama', enabled: true }];
    setCallSink((c) => recordCall(store, c));
    await assert.rejects(ask('x', { apiKeys: { groq: 'vencida' } }, store.data.agents[0]), /Invalid API Key/);
    assert.equal(healthOf(store, 'b').ok, false);
    assert.equal(healthOf(store, 'b').kind, 'clave');
    assert.equal(healthOf(store, 'c').ok, true);
    await ask('x', settings, store.data.agents[1]);
    assert.equal(healthOf(store, 'a').ok, true, 'cuando una vuelve a responder, se levanta para todas');
    // Cupo del día agotado: tampoco se prueba con las demás IAs de ese proveedor hasta que vuelva.
    recordCall(store, { agentId: 'a', provider: 'groq', providerDown: true, ok: false, quota: true, retryMs: 60000, kind: 'cupo', error: 'free-models-per-day' });
    assert.equal(healthOf(store, 'b').quota, true);
    assert.ok(healthOf(store, 'b').until > Date.now());
  } finally {
    setCallSink(null);
    PROVIDERS.groq.baseUrl = original;
    srv.close();
  }
});

test('probar una sola IA desde su perfil', async () => {
  const fake = await fakeModels({ 'sin-cupo': 'cupo' });
  const { store, restore } = await liveOffice(fake.url, {
    cerebro: { provider: 'groq', model: 'cerebro' },
    chatgpt: { provider: 'groq', model: 'sin-cupo' },
    perplexity: { provider: 'ollama', model: 'bien' },
    lexi: { provider: 'anthropic', model: 'claude-sonnet-5' },
  });
  try {
    await withApp(store, async (call) => {
      let r = await call('POST', '/api/agents/perplexity/check');
      assert.equal(r.status, 200);
      assert.equal(r.data.ok, true);
      r = await call('POST', '/api/agents/chatgpt/check');
      assert.equal(r.data.ok, false);
      assert.equal(r.data.kind, 'cupo');
      assert.equal(r.data.health.quota, true);
      r = await call('POST', '/api/agents/lexi/check');
      assert.equal(r.status, 400, 'en demo no hay nada que probar');
      assert.match(r.data.error, /modo demo/);
    });
  } finally {
    restore();
    fake.srv.close();
  }
});

test('respuesta vacía: otra IA retoma el paso; el razonamiento <think> no queda en la respuesta', async () => {
  const fake = await fakeModels({ mudo: 'vacio', pensador: 'piensa' });
  const { store, restore } = await liveOffice(fake.url, {
    cerebro: { provider: 'groq', model: 'cerebro' },
    chatgpt: { provider: 'groq', model: 'mudo' },
    perplexity: { provider: 'ollama', model: 'pensador' },
  });
  try {
    const t = await runTask(store, new Notes(store), { prompt: 'Hola', agentIds: ['chatgpt'], saveNotes: false });
    assert.equal(t.status, 'done', t.final);
    assert.equal(t.steps[0].agentId, 'perplexity');
    assert.equal(t.steps[0].failed[0].kind, 'vacio');
    assert.equal(t.steps[0].output, 'Respuesta limpia');
  } finally {
    restore();
    fake.srv.close();
  }
});

test('una tarea cortada por un reinicio queda en espera para retomarse (si guardó su contexto)', () => {
  const dir = tmp();
  const store = new Store(dir);
  createApp(store);
  store.data.tasks.unshift(
    { id: 't_a', prompt: 'A', title: 'A', status: 'working', plan: { analysis: '' }, steps: [{ agentId: 'chatgpt', status: 'done', output: 'listo' }, { agentId: 'lexi', status: 'working', output: '' }], final: '', resume: { context: 'adjuntos', background: '' }, createdAt: new Date().toISOString() },
    { id: 't_b', prompt: 'B', title: 'B', status: 'working', plan: null, steps: [], final: '', createdAt: new Date().toISOString() },
  );
  store.flush();
  const again = new Store(dir);
  createApp(again);
  const a = again.data.tasks.find((t) => t.id === 't_a');
  assert.equal(a.status, 'waiting');
  assert.equal(a.steps[0].status, 'done', 'lo hecho se conserva');
  assert.equal(a.steps[1].status, 'pending');
  assert.ok(Date.parse(a.resume.at) <= Date.now() + 10000);
  assert.equal(again.data.tasks.find((t) => t.id === 't_b').status, 'error', 'sin contexto guardado no se puede retomar');
});
