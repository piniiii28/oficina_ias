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
    await fn(call);
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
  assert.equal(s2.data.agents.filter((a) => a.department === 'impresion3d').length, 4);
  s2.data.agents = s2.data.agents.filter((a) => a.id !== 'slicer-3d');
  s2.flush();
  const s3 = new Store(dir);
  createApp(s3);
  assert.ok(!s3.data.agents.some((a) => a.id === 'slicer-3d'), 'si la despides no vuelve');
});
