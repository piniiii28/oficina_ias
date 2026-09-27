// Notas estilo Obsidian: Markdown con [[enlaces]] y #etiquetas.
// El grafo se deriva de los enlaces, las etiquetas y el origen de cada nota.
import { Store } from './store.js';

export const NOTE_TYPES = ['nota', 'idea', 'tarea', 'aporte', 'diario'];

const norm = (s) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/** Quita bloques y fragmentos de código para no leer enlaces dentro de ellos. */
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

export function parseLinks(content) {
  const out = new Set();
  for (const m of stripCode(content).matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) out.add(m[1].trim());
  return [...out];
}

export function parseTags(content) {
  const out = new Set();
  for (const m of stripCode(content).matchAll(/(?:^|\s)#([\p{L}\d_\-/]+)/gu)) out.add(m[1].toLowerCase());
  return [...out];
}

export class Notes {
  constructor(store) {
    this.store = store;
  }

  get all() {
    return this.store.data.notes;
  }

  get(id) {
    return this.all.find((n) => n.id === id);
  }

  findByTitle(title) {
    const t = norm(title);
    return this.all.find((n) => norm(n.title) === t);
  }

  create({ title, content = '', type = 'nota', tags = [], source = null, x, y }) {
    const now = new Date().toISOString();
    let finalTitle = (title || 'Sin título').trim().slice(0, 140);
    // Títulos únicos, como en Obsidian.
    if (this.findByTitle(finalTitle)) {
      let i = 2;
      while (this.findByTitle(`${finalTitle} (${i})`)) i++;
      finalTitle = `${finalTitle} (${i})`;
    }
    const note = {
      id: Store.id('n_'),
      title: finalTitle,
      content,
      type: NOTE_TYPES.includes(type) ? type : 'nota',
      tags: [...new Set(tags.map((t) => t.toLowerCase()))],
      source,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    if (x !== undefined) Object.assign(note, { x, y });
    this.all.push(note);
    this.store.save();
    return note;
  }

  /** Crea la nota o, si ya existe una con ese título, le añade el contenido. */
  upsertIdea(title, extra, source) {
    const existing = this.findByTitle(title);
    if (existing) {
      if (extra && !existing.content.includes(extra)) {
        existing.content += `\n${extra}`;
        existing.updatedAt = new Date().toISOString();
        this.store.save();
      }
      return existing;
    }
    return this.create({ title, content: extra, type: 'idea', source });
  }

  update(id, patch) {
    const note = this.get(id);
    if (!note) return null;
    const oldTitle = note.title;
    for (const k of ['title', 'content', 'type', 'tags', 'pinned', 'x', 'y']) {
      if (patch[k] !== undefined) note[k] = patch[k];
    }
    // Renombrar actualiza los [[enlaces]] que apuntaban al título anterior.
    if (patch.title && patch.title !== oldTitle) {
      const re = new RegExp(`\\[\\[${escapeRe(oldTitle)}(\\]\\]|[#|])`, 'g');
      for (const n of this.all) {
        if (n.id !== id && re.test(n.content)) n.content = n.content.replace(re, `[[${patch.title}$1`);
      }
    }
    note.updatedAt = new Date().toISOString();
    this.store.save();
    return note;
  }

  remove(id) {
    const i = this.all.findIndex((n) => n.id === id);
    if (i === -1) return false;
    this.all.splice(i, 1);
    this.store.save();
    return true;
  }

  backlinks(id) {
    const note = this.get(id);
    if (!note) return [];
    const t = norm(note.title);
    return this.all
      .filter((n) => n.id !== id && parseLinks(n.content).some((l) => norm(l) === t))
      .map((n) => ({ id: n.id, title: n.title, type: n.type }));
  }

  search(q) {
    const s = norm(q);
    if (!s) return this.all;
    return this.all.filter((n) => norm(n.title).includes(s) || norm(n.content).includes(s) || n.tags.some((t) => t.includes(s)));
  }

  /**
   * Grafo: nodos = notas (+ etiquetas y agentes si se piden);
   * aristas = [[enlaces]], etiquetas y autoría.
   */
  graph({ includeTags = true, includeAgents = true, agents = [] } = {}) {
    const nodes = [];
    const links = [];
    const byTitle = new Map(this.all.map((n) => [norm(n.title), n]));
    const ghostIds = new Map();

    for (const n of this.all) {
      nodes.push({ id: n.id, label: n.title, kind: 'note', type: n.type, tags: n.tags });
    }
    for (const n of this.all) {
      for (const l of parseLinks(n.content)) {
        const target = byTitle.get(norm(l));
        if (target) {
          if (target.id !== n.id) links.push({ source: n.id, target: target.id, kind: 'link' });
        } else {
          // Enlace a una nota que aún no existe (nodo fantasma, como Obsidian).
          const key = norm(l);
          if (!ghostIds.has(key)) {
            ghostIds.set(key, `ghost:${key}`);
            nodes.push({ id: `ghost:${key}`, label: l, kind: 'ghost' });
          }
          links.push({ source: n.id, target: ghostIds.get(key), kind: 'link' });
        }
      }
    }
    if (includeTags) {
      const tagSet = new Set();
      for (const n of this.all) {
        for (const t of new Set([...n.tags, ...parseTags(n.content)])) {
          if (!tagSet.has(t)) {
            tagSet.add(t);
            nodes.push({ id: `tag:${t}`, label: `#${t}`, kind: 'tag' });
          }
          links.push({ source: n.id, target: `tag:${t}`, kind: 'tag' });
        }
      }
    }
    if (includeAgents) {
      const used = new Set(this.all.map((n) => n.source?.agentId).filter(Boolean));
      for (const a of agents.filter((a) => used.has(a.id))) {
        nodes.push({ id: `agent:${a.id}`, label: a.name, kind: 'agent', agentId: a.id });
      }
      for (const n of this.all) {
        if (n.source?.agentId && used.has(n.source.agentId)) {
          links.push({ source: `agent:${n.source.agentId}`, target: n.id, kind: 'author' });
        }
      }
    }
    return { nodes, links };
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extrae viñetas de la sección "Ideas clave" de una respuesta. */
export function extractKeyIdeas(markdown) {
  const m = markdown.match(/#+\s*ideas clave[^\n]*\n([\s\S]*?)(?:\n#+\s|\n\n(?![-*])|$)/i);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').replace(/\*\*/g, '').trim())
    .filter((l) => l.length > 3 && l.length < 120)
    .slice(0, 6);
}
