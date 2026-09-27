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
