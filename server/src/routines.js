// Rutinas: tareas que el Cerebro Central ejecuta solo, a una hora y en los
// días elegidos, mientras la oficina esté encendida.
import { Store } from './store.js';
import { runTask, resumeTask, bus } from './orchestrator.js';
import { probeFailing } from './metrics.js';

const pad = (n) => String(n).padStart(2, '0');

/** ¿Le toca a esta rutina en este minuto? (hora local del computador). */
export function isDue(r, now = new Date()) {
  if (!r.enabled) return false;
  if (!r.days.includes(now.getDay())) return false;
  if (`${pad(now.getHours())}:${pad(now.getMinutes())}` !== r.time) return false;
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${r.time}`;
  return r.lastRun !== stamp ? stamp : false;
}

export function normalizeRoutine(b) {
  const time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '08:00';
  const days = Array.isArray(b.days) ? [...new Set(b.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [1, 2, 3, 4, 5];
  return {
    prompt: String(b.prompt || '').trim().slice(0, 4000),
    time,
    days: days.length ? days.sort() : [1, 2, 3, 4, 5],
    agentIds: Array.isArray(b.agentIds) ? b.agentIds.slice(0, 8) : [],
    enabled: b.enabled !== false,
  };
}

export function createRoutine(store, body) {
  const r = { id: Store.id('r_'), ...normalizeRoutine(body), lastRun: null, lastTaskId: null, createdAt: new Date().toISOString() };
  (store.data.routines ||= []).push(r);
  store.save();
  return r;
}

/** Revisa cada 20 s si alguna rutina debe correr. */
export function startScheduler(store, notes) {
  let lastProbe = Date.now(); // la primera prueba, 20 minutos después de abrir
  const tick = () => {
    for (const r of store.data.routines || []) {
      const stamp = isDue(r);
      if (!stamp) continue;
      r.lastRun = stamp;
      store.save();
      runTask(store, notes, { prompt: r.prompt, agentIds: r.agentIds.length ? r.agentIds : undefined })
        .then((t) => {
          r.lastTaskId = t.id;
          store.save();
        })
        .catch((err) => console.error('[rutina]', err));
    }
    // Cada 20 minutos se prueban solas las IAs con fallas pasajeras.
    if (Date.now() - lastProbe > 20 * 60000) {
      lastProbe = Date.now();
      probeFailing(store).then((ids) => {
        if (ids.length) {
          store.save();
          for (const id of ids) bus.emit('event', { type: 'agent', agentId: id, status: 'done', message: 'Volvió a responder', at: Date.now() });
        }
      }).catch(() => {});
    }
    // Tareas en espera (sin cupo, sin conexión o cortadas por un reinicio): se retoman solas.
    if (store.data.settings.autoResume !== false) {
      for (const t of store.data.tasks || []) {
        if (t.status === 'waiting' && Date.parse(t.resume?.at || 0) <= Date.now()) resumeTask(store, notes, t)?.catch((err) => console.error('[tarea]', err));
      }
    }
  };
  const id = setInterval(tick, 20000);
  id.unref?.();
  return () => clearInterval(id);
}
