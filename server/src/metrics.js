// Medidores de cada IA:
// - 🎯 Acierto: qué tan buenas resultan sus respuestas, según tus 👍/👎, cuántas
//   veces falla y (si lo activas) la nota que le pone un verificador.
// - 🔥 Carga: las condiciones que empeoran sus respuestas (la IA no se estresa
//   como una persona): mucho texto de entrada, varias tareas a la vez, errores
//   recientes, memoria o chat muy largos.
import { callModel, hasKey } from './providers.js';

const HOUR = 3600000;

/** Registra una llamada (la conecta el servidor con setCallSink). */
export function recordCall(store, { agentId, ok, simulated, inChars, ms, quota, error }) {
  const all = (store.data.metrics ||= {});
  const m = (all[agentId] ||= { calls: 0, errors: 0, recent: [] });
  m.calls++;
  if (!ok) m.errors++;
  m.recent.push({ at: Date.now(), ok, sim: Boolean(simulated), in: inChars, ms, quota: Boolean(quota), error: error || undefined });
  if (m.recent.length > 30) m.recent.splice(0, m.recent.length - 30);
  store.save();
}

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

/** Acierto (0–100) con de qué señales sale. */
export function accuracyOf(store, agent) {
  const likes = agent.stats?.likes || 0, dislikes = agent.stats?.dislikes || 0;
  let done = 0, failed = 0, vSum = 0, vN = 0;
  for (const t of store.data.tasks) {
    for (const s of t.steps) {
      if (s.agentId !== agent.id) continue;
      if (s.status === 'done') done++;
      else if (s.status === 'error' && s.error !== 'Cancelada') failed++;
      if (s.verify?.score) {
        vSum += s.verify.score;
        vN++;
      }
    }
  }
  const parts = {
    valoraciones: likes + dislikes ? { value: Math.round((likes / (likes + dislikes)) * 100), n: likes + dislikes } : null,
    verificador: vN ? { value: Math.round(((vSum / vN - 1) / 4) * 100), n: vN } : null,
    fiabilidad: done + failed ? { value: Math.round((done / (done + failed)) * 100), n: done + failed } : null,
  };
  // Promedio ponderado: tus valoraciones pesan más; parte de un 70 neutral,
  // así que con pocos datos el medidor se mueve poco.
  let sum = 70 * 3, w = 3;
  if (parts.valoraciones) (sum += parts.valoraciones.value * parts.valoraciones.n * 2), (w += parts.valoraciones.n * 2);
  if (parts.verificador) (sum += parts.verificador.value * parts.verificador.n), (w += parts.verificador.n);
  if (parts.fiabilidad) (sum += parts.fiabilidad.value * Math.min(6, parts.fiabilidad.n) * 0.5), (w += Math.min(6, parts.fiabilidad.n) * 0.5);
  const signals = (parts.valoraciones?.n || 0) + (parts.verificador?.n || 0);
  return { score: Math.round(sum / w), signals, parts };
}

/** Carga (0–100): qué tan cerca está de dar respuestas peores, y por qué. */
export function loadOf(store, agent, busy = 0) {
  const m = store.data.metrics?.[agent.id];
  const now = Date.now();
  const recent = (m?.recent || []).slice(-5);
  const avgIn = recent.length ? recent.reduce((n, r) => n + (r.in || 0), 0) / recent.length : 0;
  const lastHour = (m?.recent || []).filter((r) => now - r.at < HOUR);
  const errs = lastHour.filter((r) => !r.ok);
  const quota = errs.filter((r) => r.quota).length;
  const knowledgeChars = (agent.knowledge || []).reduce((n, k) => n + (k.content?.length || 0), 0);
  const chat = store.data.chats?.[agent.id]?.length || 0;
  const parts = {
    contexto: clamp((avgIn / 120000) * 40, 0, 40), // ~30 mil tokens por petición ya es mucho
    trabajo: clamp(busy * 15, 0, 20),
    errores: clamp((errs.length - quota) * 10 + quota * 15, 0, 25),
    memoria: clamp(((agent.memory?.length || 0) / 40) * 5 + (knowledgeChars / 40000) * 10, 0, 15),
    chat: clamp((chat / 40) * 10, 0, 10),
  };
  const score = Math.round(clamp(Object.values(parts).reduce((a, b) => a + b, 0)));
  const tips = [];
  if (parts.contexto >= 20) tips.push('Recibe textos muy largos: divide la tarea o adjunta menos archivos.');
  if (parts.trabajo >= 15) tips.push('Está en varias tareas a la vez: espera a que termine o baja «IAs trabajando a la vez».');
  if (quota) tips.push('Se quedó sin cupo en su proveedor: agrega otra cuenta o cámbiala a otro modelo gratis.');
  else if (parts.errores >= 10) tips.push('Tuvo errores recientes: prueba su conexión en Ajustes.');
  if (parts.chat >= 6) tips.push('Su chat es largo: bórralo para que se enfoque en lo nuevo.');
  if (parts.memoria >= 10) tips.push('Tiene mucha memoria y entrenamiento: quita lo que ya no sirva.');
  return {
    score,
    level: score < 30 ? 'tranquila' : score < 60 ? 'ocupada' : score < 80 ? 'cargada' : 'saturada',
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])),
    avgInChars: Math.round(avgIn),
    errorsLastHour: errs.length,
    lastError: errs.at(-1)?.error || null,
    tips,
  };
}

/** Quién verifica: Sonnet (QA) si está conectado; si no, el cerebro. */
function verifierOf(store) {
  const s = store.data.settings;
  const live = (a) => a && a.enabled && s.demoMode !== 'always' && hasKey(s, a.provider);
  const qa = store.data.agents.find((a) => a.id === 'sonnet-qa');
  const brain = store.data.agents.find((a) => a.isBrain);
  return live(qa) ? qa : live(brain) ? brain : null;
}

/**
 * Verificación opcional: otra IA le pone nota (1 a 5) a un aporte.
 * No se usa en modo demo (sería una nota inventada).
 */
export async function verifyStep(store, task, step) {
  const verifier = verifierOf(store);
  if (!verifier || verifier.id === step.agentId || step.simulated || !step.output) return null;
  try {
    const r = await callModel(store.data.settings, {
      provider: verifier.provider, model: verifier.model, agent: verifier, effort: 'low',
      system: 'Eres un verificador estricto. Devuelves únicamente JSON válido.',
      messages: [{
        role: 'user',
        content: `Tarea: ${task.prompt}\nInstrucción para la IA: ${step.instruction}\n\nRespuesta de la IA:\n${step.output.slice(0, 12000)}\n\n` +
          'Califica de 1 a 5 qué tan correcta, completa y sin datos inventados es la respuesta (5 = excelente). ' +
          'Responde SOLO con JSON: {"nota": 1-5, "motivo": "una frase"}',
      }],
    });
    const j = JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]);
    const score = Math.max(1, Math.min(5, Math.round(Number(j.nota))));
    if (!score) return null;
    return { score, reason: String(j.motivo || '').slice(0, 200), by: verifier.name };
  } catch {
    return null;
  }
}
