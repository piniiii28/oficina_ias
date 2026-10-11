// Medidores de cada IA:
// - 🎯 Acierto: qué tan buenas resultan sus respuestas, según tus 👍/👎, cuántas
//   veces falla y (si lo activas) la nota que le pone un verificador.
// - 🔥 Carga: las condiciones que empeoran sus respuestas (la IA no se estresa
//   como una persona): mucho texto de entrada, varias tareas a la vez, errores
//   recientes, memoria o chat muy largos.
import { callModel, hasKey } from './providers.js';

const HOUR = 3600000;

/** Registra una llamada (la conecta el servidor con setCallSink). */
export function recordCall(store, { agentId, ok, simulated, inChars, ms, quota, retryMs, kind, error }) {
  const all = (store.data.metrics ||= {});
  const m = (all[agentId] ||= { calls: 0, errors: 0, recent: [] });
  m.calls++;
  if (!ok) m.errors++;
  const at = Date.now();
  m.recent.push({ at, ok, sim: Boolean(simulated), in: inChars, ms, quota: Boolean(quota), until: quota ? at + (retryMs || 10 * 60000) : undefined, kind: kind || undefined, error: error || undefined });
  if (m.recent.length > 30) m.recent.splice(0, m.recent.length - 30);
  store.save();
}

/**
 * ¿La IA está funcionando?
 * - Si se quedó sin cupo, descansa hasta que su proveedor lo devuelva
 *   (`until`, según el error) y mientras tanto no recibe trabajo.
 * - Si sus últimas 2 llamadas reales fallaron por otra cosa (y la última hace
 *   menos de 6 horas), queda «con fallas» hasta que vuelva a responder (por
 *   ejemplo con «Revisar todas»).
 */
export function healthOf(store, agentId) {
  const recent = (store.data.metrics?.[agentId]?.recent || []).filter((r) => !r.sim);
  const lastOne = recent.at(-1);
  if (lastOne && !lastOne.ok && lastOne.quota) {
    const until = lastOne.until || lastOne.at + 10 * 60000;
    if (Date.now() < until) return { ok: false, quota: true, until, kind: 'cupo', error: lastOne.error || 'Sin cupo por ahora', at: lastOne.at };
    return { ok: true, rested: true };
  }
  const last = recent.filter((r) => r.ok || !r.quota).slice(-2);
  if (last.length < 2 || last.some((r) => r.ok)) return { ok: true };
  if (Date.now() - last[1].at > 6 * 3600000) return { ok: true, stale: true };
  return { ok: false, kind: last[1].kind || null, error: last[1].error || 'Falló dos veces seguidas', at: last[1].at };
}

/** Cuánto tarda una IA en responder (promedio de sus últimas respuestas reales, en ms). */
export function speedOf(store, agentId) {
  const ok = (store.data.metrics?.[agentId]?.recent || []).filter((r) => r.ok && !r.sim && r.ms).slice(-8);
  if (!ok.length) return null;
  return Math.round(ok.reduce((n, r) => n + r.ms, 0) / ok.length);
}

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

/** Acierto (0–100) con de qué señales sale. */
export function accuracyOf(store, agent) {
  const likes = agent.stats?.likes || 0, dislikes = agent.stats?.dislikes || 0;
  let done = 0, failed = 0, vSum = 0, vN = 0, jSum = 0, jN = 0;
  for (const t of store.data.tasks) {
    for (const s of t.steps) {
      // Si falló y otra IA retomó su paso, cuenta como falla suya.
      for (const f of s.failed || []) if (f.agentId === agent.id && !f.skipped && f.kind !== 'cancelada') failed++;
      if (s.agentId !== agent.id) continue;
      if (s.status === 'done') done++;
      else if (s.status === 'error' && s.error !== 'Cancelada') failed++;
      if (s.verify?.score) {
        vSum += s.verify.score;
        vN++;
      }
      if (s.jury?.score) {
        jSum += s.jury.score;
        jN++;
      }
    }
  }
  const parts = {
    valoraciones: likes + dislikes ? { value: Math.round((likes / (likes + dislikes)) * 100), n: likes + dislikes } : null,
    verificador: vN ? { value: Math.round(((vSum / vN - 1) / 4) * 100), n: vN } : null,
    jurado: jN ? { value: Math.round(((jSum / jN - 1) / 4) * 100), n: jN } : null,
    fiabilidad: done + failed ? { value: Math.round((done / (done + failed)) * 100), n: done + failed } : null,
  };
  // Promedio ponderado: tus valoraciones pesan más; parte de un 70 neutral,
  // así que con pocos datos el medidor se mueve poco.
  let sum = 70 * 3, w = 3;
  if (parts.valoraciones) (sum += parts.valoraciones.value * parts.valoraciones.n * 2), (w += parts.valoraciones.n * 2);
  if (parts.verificador) (sum += parts.verificador.value * parts.verificador.n), (w += parts.verificador.n);
  if (parts.jurado) (sum += parts.jurado.value * parts.jurado.n), (w += parts.jurado.n);
  if (parts.fiabilidad) (sum += parts.fiabilidad.value * Math.min(6, parts.fiabilidad.n) * 0.5), (w += Math.min(6, parts.fiabilidad.n) * 0.5);
  const signals = (parts.valoraciones?.n || 0) + (parts.verificador?.n || 0) + (parts.jurado?.n || 0);
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

// --- Jurado: las IAs se califican entre sí ---
// En vez de que todas califiquen a todas (demasiadas llamadas y mucho ruido),
// un jurado pequeño (1 a 3 IAs) califica cada aporte:
// - a ciegas (no sabe qué IA lo escribió),
// - con una rúbrica fija (correcto, completo, claro y sin inventos),
// - con jueces de otro proveedor distinto al del autor (evita que un modelo
//   favorezca a los de su misma familia) y rotando para repartir el trabajo.
// La nota final es la mediana, y tus 👍/👎 siguen pesando más en el medidor.
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Elige a los jueces para un aporte. */
export function pickJudges(store, authorId, size = 2) {
  const s = store.data.settings;
  const author = store.data.agents.find((a) => a.id === authorId);
  const live = store.data.agents.filter((a) => a.enabled && a.id !== authorId && s.demoMode !== 'always' && hasKey(s, a.provider));
  const given = new Map();
  for (const t of store.data.tasks.slice(0, 60)) for (const st of t.steps) for (const v of st.jury?.votes || []) given.set(v.judgeId, (given.get(v.judgeId) || 0) + 1);
  return live
    .sort((a, b) => Number(a.provider === author?.provider) - Number(b.provider === author?.provider) || (given.get(a.id) || 0) - (given.get(b.id) || 0))
    .slice(0, Math.max(1, Math.min(3, size)));
}

/** El jurado califica un aporte. Devuelve { votes, score } o null. */
export async function juryStep(store, task, step, size = 2) {
  if (step.simulated || !step.output) return null;
  const judges = pickJudges(store, step.agentId, size);
  if (!judges.length) return null;
  const votes = (await Promise.all(judges.map(async (j) => {
    try {
      const r = await callModel(store.data.settings, {
        provider: j.provider, model: j.model, agent: j, effort: 'low',
        system: 'Eres juez de un jurado que califica respuestas de otras IAs. Eres justo y estricto, no premias el largo ni el tono sino la calidad. Devuelves únicamente JSON válido.',
        messages: [{
          role: 'user',
          content: `Tarea: ${task.prompt}\nLo que se le pidió: ${step.instruction}\n\nRespuesta a calificar (autor anónimo):\n${step.output.slice(0, 12000)}\n\n` +
            'Rúbrica: 5 = correcta, completa, clara y sin datos inventados; 3 = útil pero con fallas o vacíos; 1 = incorrecta o inventada. ' +
            'Responde SOLO con JSON: {"nota": 1-5, "motivo": "una frase concreta"}',
        }],
      });
      const o = JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]);
      const score = Math.max(1, Math.min(5, Math.round(Number(o.nota))));
      return score ? { judgeId: j.id, name: j.name, score, reason: String(o.motivo || '').slice(0, 200) } : null;
    } catch {
      return null;
    }
  }))).filter(Boolean);
  return votes.length ? { votes, score: median(votes.map((v) => v.score)), at: new Date().toISOString() } : null;
}

/** Resumen del jurado: veredictos recientes, qué tan generoso es cada juez y si coincide contigo. */
export function juryReport(store) {
  const recent = [];
  const judges = new Map();
  const received = new Map();
  for (const t of store.data.tasks) {
    for (const st of t.steps) {
      if (!st.jury?.votes?.length) continue;
      recent.push({ taskId: t.id, task: t.title, agentId: st.agentId, score: st.jury.score, votes: st.jury.votes, rating: st.rating?.value ?? null, at: st.jury.at });
      const r = received.get(st.agentId) || { sum: 0, n: 0 };
      r.sum += st.jury.score;
      r.n++;
      received.set(st.agentId, r);
      for (const v of st.jury.votes) {
        const j = judges.get(v.judgeId) || { id: v.judgeId, name: v.name, n: 0, sum: 0, diff: 0, agree: 0, compared: 0 };
        j.n++;
        j.sum += v.score;
        j.diff += v.score - st.jury.score; // positivo = más generoso que el resto del jurado
        if (st.rating?.value) {
          j.compared++;
          if ((st.rating.value > 0 && v.score >= 4) || (st.rating.value < 0 && v.score <= 2)) j.agree++;
        }
        judges.set(v.judgeId, j);
      }
    }
  }
  return {
    recent: recent.slice(0, 40),
    judges: [...judges.values()].map((j) => ({ id: j.id, name: j.name, votes: j.n, average: Math.round((j.sum / j.n) * 10) / 10, generosity: Math.round((j.diff / j.n) * 10) / 10, agreement: j.compared ? Math.round((j.agree / j.compared) * 100) : null, compared: j.compared })).sort((a, b) => b.votes - a.votes),
    received: Object.fromEntries([...received].map(([id, r]) => [id, { average: Math.round((r.sum / r.n) * 10) / 10, n: r.n }])),
  };
}
