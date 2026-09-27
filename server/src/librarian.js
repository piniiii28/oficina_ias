// La bibliotecaria del grafo: busca notas que hablan de lo mismo pero aún no
// están enlazadas y propone conexiones. Con clave usa su modelo; sin clave (o
// si falla) compara palabras clave (TF-IDF + similitud coseno).
import { callModel, hasKey } from './providers.js';
import { parseLinks } from './notes.js';
import { agentStatus } from './orchestrator.js';

const STOP = new Set(
  ('el la los las un una unos unas de del al a y o u en con por para que como mi tu su sus es son ser se me te lo le les hay ' +
    'esto esta este estos estas eso esa muy mas más pero sin ya también desde cada entre sobre todo toda todos puede ser ' +
    'parte tarea contexto rol aporta simulada respuesta modo demo ideas clave the and of to for in on with is are ' +
    // Frases de relleno de las respuestas simuladas.
    'analice peticion propuesta especialidad definir claridad encaja resultado final entrega entregar primero priorizar impacto ' +
    'accesorio segunda iteracion conectar notas existentes grafo repetir trabajo medir avance indicador simple revisarlo cerebro ' +
    'central encarga primer borrador coordine resolver integrado claves ajustes responda verdad surgio equipo instruccion').split(' '),
);

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

function tokens(text) {
  return (norm(text).match(/[\p{L}\d]{4,}/gu) || []).filter((w) => !STOP.has(w));
}

/** Sugerencias por similitud de contenido. */
export function keywordSuggestions(notes, limit = 12) {
  const docs = notes.map((n) => {
    const tf = new Map();
    for (const w of tokens(`${n.title} ${n.title} ${n.content}`)) tf.set(w, (tf.get(w) || 0) + 1);
    return { n, tf };
  });
  const df = new Map();
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length;
  for (const d of docs) {
    d.vec = new Map();
    let len = 0;
    for (const [w, c] of d.tf) {
      const idf = Math.log((N + 1) / (df.get(w) + 0.5));
      if (idf <= 0.3) continue;
      const v = (1 + Math.log(c)) * idf;
      d.vec.set(w, v);
      len += v * v;
    }
    d.len = Math.sqrt(len) || 1;
  }
  const linked = new Set();
  const titleOf = new Map(notes.map((n) => [norm(n.title), n.id]));
  for (const n of notes) {
    for (const l of parseLinks(n.content)) {
      const t = titleOf.get(norm(l));
      if (t) linked.add([n.id, t].sort().join('|'));
    }
  }
  const out = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i], b = docs[j];
      if (linked.has([a.n.id, b.n.id].sort().join('|'))) continue;
      // Aportes de una misma tarea ya están unidos a través de la nota de la tarea.
      if (a.n.source?.taskId && a.n.source.taskId === b.n.source?.taskId) continue;
      let dot = 0;
      const shared = [];
      for (const [w, v] of a.vec) {
        const u = b.vec.get(w);
        if (u) { dot += v * u; shared.push([w, v * u]); }
      }
      const score = dot / (a.len * b.len);
      if (score < 0.12) continue;
      const words = shared.sort((x, y) => y[1] - x[1]).slice(0, 3).map(([w]) => w);
      out.push({ from: a.n.id, to: b.n.id, fromTitle: a.n.title, toTitle: b.n.title, score: Math.round(score * 100) / 100, reason: `Comparten: ${words.join(', ')}` });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

export async function suggestConnections(store) {
  const notes = store.data.notes;
  const librarian = store.data.agents.find((a) => a.isLibrarian);
  const base = keywordSuggestions(notes);
  if (librarian) agentStatus(librarian.id, 'working', 'Buscando ideas conectadas…');
  const { settings } = store.data;
  const live = librarian && settings.demoMode !== 'always' && hasKey(settings, librarian.provider);
  if (!live || notes.length < 2) {
    if (librarian) agentStatus(librarian.id, 'done', `Encontré ${base.length} posibles conexiones`);
    return { suggestions: base, by: librarian?.name || 'Bibliotecaria', simulated: true };
  }
  try {
    const list = notes.slice(-80).map((n) => `- [${n.id}] ${n.title}: ${n.content.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
    const { text } = await callModel(settings, {
      provider: librarian.provider, model: librarian.model, agent: librarian, effort: 'low',
      system: 'Eres la bibliotecaria de un grafo de conocimiento. Devuelves únicamente JSON válido.',
      messages: [{
        role: 'user',
        content: `Estas son las notas (id entre corchetes):\n${list}\n\nPropón hasta 12 conexiones valiosas entre notas que aún no estén enlazadas. ` +
          'Responde SOLO con JSON: {"suggestions": [{"from": "id", "to": "id", "reason": "por qué se relacionan, en una frase"}]}',
      }],
    });
    const byId = new Map(notes.map((n) => [n.id, n]));
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]).suggestions || [];
    const suggestions = parsed
      .filter((s) => byId.has(s.from) && byId.has(s.to) && s.from !== s.to)
      .map((s) => ({ ...s, fromTitle: byId.get(s.from).title, toTitle: byId.get(s.to).title, score: 1 }));
    agentStatus(librarian.id, 'done', `Propongo ${suggestions.length} conexiones`);
    return { suggestions: suggestions.length ? suggestions : base, by: librarian.name, simulated: false };
  } catch (err) {
    console.warn('[bibliotecaria]', err.message);
    agentStatus(librarian.id, 'done', `Encontré ${base.length} posibles conexiones`);
    return { suggestions: base, by: librarian.name, simulated: true };
  }
}

/** Aplica una conexión añadiendo un enlace en ambas notas. */
export function applyConnection(notesApi, { from, to, reason }) {
  const a = notesApi.get(from), b = notesApi.get(to);
  if (!a || !b) return false;
  const add = (n, other) => {
    if (parseLinks(n.content).some((l) => norm(l) === norm(other.title))) return;
    const line = `- [[${other.title}]]${reason ? ` — ${reason}` : ''}`;
    const content = /\n## Relacionado\n/.test(n.content)
      ? n.content.replace(/\n## Relacionado\n/, `\n## Relacionado\n${line}\n`)
      : `${n.content.trimEnd()}\n\n## Relacionado\n${line}\n`;
    notesApi.update(n.id, { content });
  };
  add(a, b);
  add(b, a);
  return true;
}
