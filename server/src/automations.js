// Automatizaciones con n8n (o cualquier servicio con webhooks).
// - Salientes: cada automatización es la URL de un webhook de n8n. Se activa a
//   mano, al terminar cada tarea o cuando una IA la pide (con tu permiso).
// - Entrantes: n8n puede pedirle tareas a la oficina, crear notas o tarjetas
//   con /api/hooks/<token>/… (el token se ve en Ajustes → Automatizaciones).
import { Store } from './store.js';

export function normalizeAutomation(a = {}) {
  const url = String(a.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('La URL del webhook debe empezar por http:// o https://');
  return {
    id: typeof a.id === 'string' && a.id ? a.id : Store.id('au_'),
    name: String(a.name || '').trim().slice(0, 60) || 'Automatización',
    url: url.slice(0, 500),
    description: String(a.description || '').slice(0, 300),
    trigger: ['manual', 'tarea'].includes(a.trigger) ? a.trigger : 'manual',
    allowAI: Boolean(a.allowAI),
  };
}

/** Llama al webhook y guarda el resultado en el historial. */
export async function runAutomation(store, auto, datos = {}, origen = 'manual') {
  const t0 = Date.now();
  let entry;
  try {
    const res = await fetch(auto.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evento: origen, automatizacion: auto.name, datos, enviadoEn: new Date().toISOString(), oficina: 'Oficina de IAs' }),
      signal: AbortSignal.timeout(30000),
    });
    const text = (await res.text()).slice(0, 2000);
    entry = { ok: res.ok, status: res.status, respuesta: text };
  } catch (err) {
    entry = { ok: false, status: 0, respuesta: err.name === 'TimeoutError' ? 'n8n no respondió en 30 s' : err.message };
  }
  const log = (store.data.automationLog ||= []);
  log.unshift({ id: Store.id('al_'), automationId: auto.id, name: auto.name, origen, ms: Date.now() - t0, at: new Date().toISOString(), ...entry });
  if (log.length > 60) log.length = 60;
  store.save();
  return entry;
}

/** Al terminar una tarea, avisa a las automatizaciones que lo piden. */
export function onTaskFinished(store, task) {
  for (const a of store.data.settings.automations || []) {
    if (a.trigger !== 'tarea') continue;
    runAutomation(store, a, {
      id: task.id, titulo: task.title, pedido: task.prompt, estado: task.status, resultado: task.final.slice(0, 20000),
      equipo: task.steps.map((s) => s.agentId), nucleo: task.hub,
    }, 'tarea-terminada').catch(() => {});
  }
}
