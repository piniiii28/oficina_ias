// Núcleos del grafo: el Cerebro y cada persona o computador (Nicolás,
// Santiago, Miguel…). Cada nota pertenece a un núcleo; así cada uno va
// formando su perfil, se le pueden hacer preguntas con solo sus notas y se
// detectan los temas que comparten para interconectarlos.
import { Store } from './store.js';
import { callModel, hasKey } from './providers.js';
import { tokens, relatedNotes, keywordSuggestions } from './librarian.js';
import { agentStatus, buildSystem, streamer } from './orchestrator.js';

export const DEFAULT_HUBS = [
  { id: 'cerebro', name: 'Cerebro', emoji: '🧠', color: '#c084fc' },
  { id: 'nicolas', name: 'Nicolás', emoji: '💻', color: '#60a5fa' },
  { id: 'santiago', name: 'Santiago', emoji: '🖥️', color: '#34d399' },
  { id: 'miguel', name: 'Miguel', emoji: '💼', color: '#fbbf24' },
];

export const hubsOf = (store) => (store.data.settings.hubs?.length ? store.data.settings.hubs : DEFAULT_HUBS);
export const hubOf = (note) => note.hub || 'cerebro';

/** Limpia la lista de núcleos que llega de la interfaz. */
export function normalizeHubs(list) {
  const seen = new Set();
  const out = [];
  for (const h of Array.isArray(list) ? list.slice(0, 12) : []) {
    const name = String(h?.name || '').trim().slice(0, 30);
    if (!name) continue;
    const id = String(h.id || name).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || Store.id('h_');
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, emoji: String(h.emoji || '🔵').slice(0, 4), color: /^#[0-9a-f]{6}$/i.test(h.color) ? h.color : '#94a3b8' });
  }
  if (!seen.has('cerebro')) out.unshift(DEFAULT_HUBS[0]);
  return out;
}

/** Palabras más frecuentes de un conjunto de notas (sin las de relleno). */
function topWords(notes, n = 40) {
  const tf = new Map();
  for (const note of notes) {
    // Cada palabra cuenta una vez por nota, para que una nota larga no domine.
    for (const w of new Set(tokens(`${note.title} ${note.content}`))) tf.set(w, (tf.get(w) || 0) + 1);
  }
  return [...tf.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Estadísticas del perfil de un núcleo. */
export function hubStats(notes, hubId) {
  const mine = notes.filter((n) => hubOf(n) === hubId);
  const types = {};
  const tags = new Map();
  for (const n of mine) {
    types[n.type] = (types[n.type] || 0) + 1;
    for (const t of n.tags) if (!['tarea', 'guia', 'diario'].includes(t)) tags.set(t, (tags.get(t) || 0) + 1);
  }
  return {
    hub: hubId,
    notes: mine.length,
    types,
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, c]) => ({ tag: t, count: c })),
    topics: topWords(mine, 12).map(([w, c]) => ({ word: w, count: c })),
    recent: [...mine].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 6).map((n) => ({ id: n.id, title: n.title, type: n.type })),
  };
}

/**
 * Puentes entre núcleos: la nota de un núcleo más parecida a una del otro
 * (TF-IDF, igual que la bibliotecaria) y cuántos [[enlaces]] cruzan de uno a otro.
 */
export function hubBridges(notes, hubs) {
  const pool = notes.slice(-600);
  const hubById = new Map(pool.map((n) => [n.id, hubOf(n)]));
  const known = new Set(hubs.map((h) => h.id));
  const pairKey = (a, b) => [a, b].sort().join('|');
  const acc = new Map();
  const get = (key) => acc.get(key) || acc.set(key, { score: 0, words: new Map(), links: 0 }).get(key);
  for (const s of keywordSuggestions(pool, 5000)) {
    const a = hubById.get(s.from), b = hubById.get(s.to);
    if (a === b || !known.has(a) || !known.has(b)) continue;
    const e = get(pairKey(a, b));
    e.score = Math.max(e.score, s.score);
    for (const w of s.reason.replace(/^Comparten:\s*/, '').split(/,\s*/)) if (w) e.words.set(w, (e.words.get(w) || 0) + s.score);
  }
  const titleHub = new Map(pool.map((n) => [n.title.toLowerCase(), hubOf(n)]));
  for (const n of pool) {
    for (const m of n.content.matchAll(/\[\[([^\]|#]+)/g)) {
      const other = titleHub.get(m[1].trim().toLowerCase());
      if (other && other !== hubOf(n) && known.has(other) && known.has(hubOf(n))) get(pairKey(hubOf(n), other)).links++;
    }
  }
  return [...acc.entries()]
    .map(([key, e]) => {
      const [a, b] = key.split('|');
      return { a, b, score: Math.round(e.score * 100) / 100, links: e.links, shared: [...e.words.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([w]) => w) };
    })
    .sort((x, y) => y.score + y.links / 10 - (x.score + x.links / 10));
}

/** Conexiones propuestas solo entre notas de núcleos distintos. */
export function crossHubSuggestions(notes, limit = 12) {
  const hubById = new Map(notes.map((n) => [n.id, hubOf(n)]));
  return keywordSuggestions(notes, 400).filter((s) => hubById.get(s.from) !== hubById.get(s.to)).slice(0, limit);
}

const brainOf = (store) => store.data.agents.find((a) => a.isBrain) || store.data.agents[0];

/** Pregunta a un núcleo: el cerebro responde usando solo las notas de ese núcleo. */
export async function askHub(store, hubId, question) {
  const hub = hubsOf(store).find((h) => h.id === hubId);
  if (!hub) throw new Error('Ese núcleo no existe');
  const mine = store.data.notes.filter((n) => hubOf(n) === hubId);
  if (!mine.length) throw new Error(`${hub.name} todavía no tiene notas. Crea notas o lanza tareas con su perfil activo.`);
  let sources = relatedNotes(mine, question, 6);
  if (!sources.length) sources = [...mine].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 4);
  const brain = brainOf(store);
  const { settings } = store.data;
  agentStatus(brain.id, 'thinking', `Consultando el núcleo de ${hub.name}…`);
  const onDelta = streamer(`hub:${hubId}`);
  try {
    const res = await callModel(settings, {
      provider: brain.provider, model: brain.model, agent: brain, effort: 'low', onDelta,
      system: `${buildSystem(brain)}\n\nAhora respondes como la memoria del núcleo «${hub.name}» del grafo de ideas. Usa solo las notas que te paso; si no alcanzan, dilo. Cita las notas con [[Título]].`,
      messages: [{ role: 'user', content: `Pregunta: ${question}\n\nNotas del núcleo ${hub.name}:\n\n${sources.map((n) => `### ${n.title}\n${n.content.slice(0, 1500)}`).join('\n\n')}` }],
    });
    onDelta.end();
    const answer = res.simulated
      ? `*Respuesta simulada (modo demo).* Estas son las notas de **${hub.name}** que más se relacionan con tu pregunta:\n\n${sources.map((n) => `- [[${n.title}]]: ${n.content.replace(/[#*>`[\]]/g, '').replace(/\s+/g, ' ').slice(0, 140)}…`).join('\n')}`
      : res.text;
    agentStatus(brain.id, 'done', `Respondí con ${sources.length} notas de ${hub.name}`);
    return { answer, simulated: res.simulated, sources: sources.map((n) => ({ id: n.id, title: n.title })) };
  } catch (err) {
    onDelta.end();
    agentStatus(brain.id, 'error', err.message);
    throw err;
  }
}

/** Escribe (o actualiza) la nota «Perfil de …» con los temas del núcleo y sus puentes. */
export async function writeHubProfile(store, notes, hubId) {
  const hubs = hubsOf(store);
  const hub = hubs.find((h) => h.id === hubId);
  if (!hub) throw new Error('Ese núcleo no existe');
  const stats = hubStats(store.data.notes, hubId);
  if (!stats.notes) throw new Error(`${hub.name} todavía no tiene notas.`);
  const bridges = hubBridges(store.data.notes, hubs).filter((b) => b.a === hubId || b.b === hubId);
  const brain = brainOf(store);
  const { settings } = store.data;
  const live = settings.demoMode !== 'always' && hasKey(settings, brain.provider);
  let summary = `${hub.name} tiene ${stats.notes} notas. Sus temas más frecuentes son ${stats.topics.slice(0, 5).map((t) => t.word).join(', ') || '—'}.`;
  if (live) {
    agentStatus(brain.id, 'thinking', `Escribiendo el perfil de ${hub.name}…`);
    try {
      const mine = store.data.notes.filter((n) => hubOf(n) === hubId).slice(-25);
      const res = await callModel(settings, {
        provider: brain.provider, model: brain.model, agent: brain, effort: 'low',
        system: buildSystem(brain),
        messages: [{ role: 'user', content: `Escribe el perfil del núcleo «${hub.name}» de un grafo de ideas (máximo 150 palabras): qué le interesa, en qué proyectos trabaja y qué podría explorar después. Basado en sus notas:\n\n${mine.map((n) => `- ${n.title}: ${n.content.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')}` }],
      });
      summary = res.text;
      agentStatus(brain.id, 'done', `Perfil de ${hub.name} listo`);
    } catch (err) {
      agentStatus(brain.id, 'error', err.message);
    }
  }
  const nameOf = (id) => hubs.find((h) => h.id === id)?.name || id;
  const content = [
    `# ${hub.emoji} Perfil de ${hub.name}`,
    '',
    summary,
    '',
    '## Temas',
    stats.topics.length ? stats.topics.map((t) => `- ${t.word} (${t.count})`).join('\n') : '- (todavía pocos)',
    '',
    '## Etiquetas',
    stats.tags.length ? stats.tags.map((t) => `#${t.tag}`).join(' ') : '(ninguna)',
    '',
    '## Conexiones con otros núcleos',
    bridges.length
      ? bridges.map((b) => {
        const other = b.a === hubId ? b.b : b.a;
        return `- [[Perfil de ${nameOf(other)}]]: afinidad de ${Math.round(b.score * 100)} %${b.shared.length ? ` (${b.shared.join(', ')})` : ''}${b.links ? `, ${b.links} enlaces directos` : ''}`;
      }).join('\n')
      : '- Todavía no comparte temas con otros núcleos.',
    '',
    '## Notas recientes',
    stats.recent.map((r) => `- [[${r.title}]]`).join('\n'),
  ].join('\n');
  const title = `Perfil de ${hub.name}`;
  const existing = notes.findByTitle(title);
  return existing ? notes.update(existing.id, { content, hub: hubId }) : notes.create({ title, content, type: 'nota', tags: ['perfil'], hub: hubId, source: { agentId: brain.id } });
}
