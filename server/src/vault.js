// Bóveda compatible con Obsidian: cada nota se escribe como un archivo .md
// en data/boveda, así puedes abrir esa carpeta directamente en Obsidian.
// También permite importar archivos .md existentes.
import fs from 'node:fs';
import path from 'node:path';

const safeName = (title) =>
  title.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sin título';

function frontmatter(n) {
  const lines = ['---', `id: ${n.id}`, `tipo: ${n.type}`];
  if (n.tags.length) lines.push(`tags: [${n.tags.join(', ')}]`);
  if (n.source?.agentId) lines.push(`autor: ${n.source.agentId}`);
  lines.push(`creado: ${n.createdAt}`, `editado: ${n.updatedAt}`, '---', '');
  return lines.join('\n');
}

export class Vault {
  constructor(dir) {
    this.dir = dir;
    this.timer = null;
  }

  /** Reescribe la bóveda (con retardo para agrupar cambios). */
  schedule(notes) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(notes), 800);
  }

  sync(notes) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const wanted = new Map();
      for (const n of notes) {
        let name = `${safeName(n.title)}.md`;
        for (let i = 2; wanted.has(name); i++) name = `${safeName(n.title)} ${i}.md`;
        wanted.set(name, frontmatter(n) + n.content);
      }
      // Solo borra archivos que escribió la oficina (frontmatter con id de nota);
      // los que crees tú en Obsidian se respetan.
      for (const f of fs.readdirSync(this.dir)) {
        if (!f.endsWith('.md') || wanted.has(f)) continue;
        const file = path.join(this.dir, f);
        if (/^---\nid: n_/.test(fs.readFileSync(file, 'utf8').slice(0, 64))) fs.rmSync(file);
      }
      for (const [name, body] of wanted) {
        const file = path.join(this.dir, name);
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) fs.writeFileSync(file, body);
      }
    } catch (err) {
      console.error('[bóveda] No pude sincronizar:', err.message);
    }
  }
}

/** Separa el frontmatter YAML sencillo de un archivo .md. */
export function parseMarkdownFile(name, text) {
  let content = text.replace(/\r\n/g, '\n');
  const meta = {};
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    content = content.slice(m[0].length);
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }
  const tags = (meta.tags || '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
  const type = ['nota', 'idea', 'tarea', 'aporte', 'diario'].includes(meta.tipo) ? meta.tipo : 'nota';
  const title = name.replace(/\.md$/i, '').split(/[\\/]/).pop();
  return { title, content, tags, type };
}
