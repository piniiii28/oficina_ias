// Almacenamiento persistente en disco (JSON). Todo lo que hace la oficina
// —agentes, notas, memorias, tareas y ajustes— sobrevive a reinicios.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = () => ({
  version: 1,
  settings: {
    apiKeys: {},
    demoMode: 'auto', // 'auto' = simula cuando falta la clave; 'always' = siempre simula
    maxParallel: 4,
    language: 'es',
  },
  agents: [],
  notes: [],
  tasks: [],
  meetings: [],
  routines: [],
  cards: [],
  chats: {}, // agentId -> [{role, content, at}]
});

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'oficina.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = this.#load();
    this.timer = null;
  }

  #load() {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        if (fs.existsSync(f)) {
          const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
          const base = EMPTY();
          return { ...base, ...parsed, settings: { ...base.settings, ...parsed.settings } };
        }
      } catch (err) {
        console.error(`[store] No pude leer ${f}:`, err.message);
      }
    }
    return EMPTY();
  }

  /** Guarda con un pequeño retardo para agrupar escrituras. */
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  /** Escritura atómica: primero a un temporal, luego rename. */
  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    fs.renameSync(tmp, this.file);
    this.#dailyBackup();
  }

  /** Un respaldo por día en respaldos/ (se guardan los últimos 14). */
  #dailyBackup() {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (this.lastBackup === day) return;
    this.lastBackup = day;
    try {
      const dir = path.join(this.dir, 'respaldos');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `oficina-${day}.json`);
      if (!fs.existsSync(file)) fs.copyFileSync(this.file, file);
      const old = fs.readdirSync(dir).filter((f) => /^oficina-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 14))) fs.unlinkSync(path.join(dir, f));
    } catch (err) {
      console.error('[respaldo]', err.message);
    }
  }

  static id(prefix = '') {
    return prefix + crypto.randomBytes(6).toString('hex');
  }
}
