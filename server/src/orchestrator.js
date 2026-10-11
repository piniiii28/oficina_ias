// El Cerebro Central: recibe una tarea, arma un plan, reparte subtareas entre
// los especialistas (en paralelo), integra sus aportes y guarda todo como notas
// conectadas en el grafo. Emite eventos para animar la oficina en vivo.
import { EventEmitter } from 'node:events';
import { Store } from './store.js';
import { callModel, isLive, usableFilter } from './providers.js';
import { classifyError, explainError, isTemporaryError } from './errors.js';
import { demoPlan } from './demo.js';
import { extractKeyIdeas } from './notes.js';
import { relatedNotes } from './librarian.js';
import { readLinks } from './links.js';
import { callWithAccess } from './access.js';
import { callWithAssistants } from './assistants.js';
import { verifyStep, juryStep, healthOf, speedOf } from './metrics.js';
import { onTaskFinished } from './automations.js';

export const bus = new EventEmitter();
/** Controladores para cancelar tareas en curso (id de tarea → AbortController). */
export const running = new Map();
bus.setMaxListeners(100);

const MAX_MEMORY = 40;

export function agentStatus(agentId, status, message = '') {
  bus.emit('event', { type: 'agent', agentId, status, message, at: Date.now() });
}

/**
 * Emisor de texto en vivo: acumula fragmentos y los envía como máximo cada
 * 120 ms para no saturar la conexión.
 */
export function streamer(key) {
  let text = '';
  let timer = null;
  const flush = () => {
    timer = null;
    bus.emit('event', { type: 'delta', key, text });
  };
  const onDelta = (d) => {
    text += d;
    if (!timer) timer = setTimeout(flush, 120);
  };
  onDelta.end = () => {
    clearTimeout(timer);
    bus.emit('event', { type: 'delta', key, text: null });
  };
  return onDelta;
}

/** Instrucciones completas de un agente: rol + entrenamiento + memoria. */
export function buildSystem(agent) {
  let sys = agent.system;
  if (agent.knowledge?.length) {
    sys += '\n\n## Entrenamiento (conocimiento que te enseñó el usuario)\n';
    sys += agent.knowledge.map((k) => `### ${k.title}\n${k.content}`).join('\n\n');
  }
  if (agent.memory?.length) {
    sys += '\n\n## Tu memoria de trabajos anteriores\n';
    sys += agent.memory.slice(-15).map((m) => `- ${m.text}`).join('\n');
  }
  return sys;
}

function brainOf(store) {
  const agents = store.data.agents;
  return agents.find((a) => a.isBrain) || agents[0];
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Sin JSON');
  return JSON.parse(m[0]);
}

async function makePlan(store, task, forced, template) {
  const { settings, agents } = store.data;
  const usable = usableFilter(settings, agents, (a) => healthOf(store, a.id).ok);
  // Las IAs en modo demo no trabajan (salvo que se desactive «solo IAs conectadas»).
  if (forced?.length) forced = forced.filter((id) => usable(agents.find((a) => a.id === id)));
  const pool = agents.filter((a) => !a.isBrain && a.enabled && usable(a) && (!forced?.length || forced.includes(a.id)));
  if (forced?.length) {
    // Respeta el orden elegido (y, al continuar una tarea, sus dependencias).
    const byId = new Map(pool.map((a) => [a.id, a]));
    const deps = new Map((template || []).map((s) => [s.agentId, s.dependsOn || []]));
    return sanitizeDeps({
      analysis: template ? (template.some((t) => t.dependsOn?.length) ? 'Flujo de relevos: cada IA trabaja sobre la entrega anterior.' : 'El mismo equipo retoma la tarea con tu ajuste.') : 'Trabajan las IAs elegidas.',
      subtasks: forced.filter((id) => byId.has(id)).map((id) => ({
        agentId: id,
        dependsOn: deps.get(id) || [],
        instruction: `Desde tu rol de ${byId.get(id).role}, aporta tu parte a: "${task}"`,
      })),
    });
  }
  // Si el Cerebro no está conectado o se quedó sin cupo, planifica su suplente.
  const brain = actingBrain(store);
  const live = isLive(settings, brain);
  const maxTeam = settings.maxTeam || 5;
  if (!live) return demoPlan(task, pool, maxTeam);

  const secs = (a) => {
    const ms = speedOf(store, a.id);
    return ms ? `. Suele tardar ${Math.round(ms / 1000)} s` : '';
  };
  const roster = pool.map((a) => `- ${a.id}: ${a.name}, ${a.role}${secs(a)}${a.isHead ? ' (jefe de su departamento)' : ''}${a.assistants?.length ? ` (tiene asistentes en ${a.assistants.map((x) => x.focus).join(' y ')})` : ''}. Habilidades: ${a.skills.join(', ')}${a.stats?.likes || a.stats?.dislikes ? `. Valoración del usuario: ${a.stats.likes || 0} 👍 / ${a.stats.dislikes || 0} 👎` : ''}`).join('\n');
  const prompt =
    `Tarea del usuario:\n"""${task}"""\n\nEquipo disponible:\n${roster}\n\n` +
    `Elige entre ${Math.min(2, maxTeam)} y ${maxTeam} especialistas (solo los necesarios)`+ ' y escribe una instrucción concreta para cada uno. ' +
    'Ante empates, prefiere a las IAs mejor valoradas por el usuario y, si sirven igual, a las más rápidas (menos segundos). Usa solo las dependencias necesarias: cada relevo hace esperar a los demás. ' +
    'Si alguien necesita el trabajo de otro (p. ej. el tester necesita el código, el redactor necesita la investigación), ' +
    'indícalo en "dependsOn" con los agentId de los que depende; los demás trabajan en paralelo. ' +
    'Responde SOLO con JSON: {"analysis": "una frase", "subtasks": [{"agentId": "...", "instruction": "...", "dependsOn": []}]}';
  try {
    const { text } = await callModel(settings, {
      provider: brain.provider, model: brain.model, agent: brain, effort: 'low',
      system: 'Eres el planificador de una oficina de IAs. Devuelves únicamente JSON válido.',
      messages: [{ role: 'user', content: prompt }],
    });
    const plan = parseJson(text);
    plan.subtasks = (plan.subtasks || []).filter((s) => s && pool.some((a) => a.id === s.agentId)).slice(0, maxTeam);
    // Sin repetir IA (cada paso se identifica por su IA).
    plan.subtasks = plan.subtasks.filter((s, i) => plan.subtasks.findIndex((x) => x.agentId === s.agentId) === i);
    if (!plan.subtasks.length) throw new Error('Plan vacío');
    plan.by = brain.id;
    return sanitizeDeps(plan);
  } catch (err) {
    console.warn('[cerebro] Plan en vivo falló, uso planificador local:', err.message);
    return demoPlan(task, pool, maxTeam);
  }
}

/** Deja solo dependencias válidas y sin ciclos (un paso solo depende de pasos anteriores). */
export function sanitizeDeps(plan) {
  // Primero ordena para que cada paso quede después de aquellos de los que
  // depende (el plan puede venir desordenado); los ciclos se rompen en el orden original.
  const ids = new Set(plan.subtasks.map((s) => s.agentId));
  const placed = new Set();
  const remaining = [...plan.subtasks];
  const ordered = [];
  while (remaining.length) {
    const i = remaining.findIndex((s) => (s.dependsOn || []).every((d) => d === s.agentId || !ids.has(d) || placed.has(d)));
    const [s] = remaining.splice(i === -1 ? 0 : i, 1);
    ordered.push(s);
    placed.add(s.agentId);
  }
  plan.subtasks = ordered;
  const seen = new Set();
  for (const s of plan.subtasks) {
    s.dependsOn = [...new Set((s.dependsOn || []).filter((d) => seen.has(d) && d !== s.agentId))];
    seen.add(s.agentId);
  }
  return plan;
}

/**
 * Ejecuta pasos respetando dependencias: cada paso arranca en cuanto terminan
 * aquellos de los que depende, con un máximo de `limit` en paralelo.
 */
export async function runGraph(steps, limit, fn) {
  const done = new Set();
  const started = new Set();
  let running = 0;
  return new Promise((resolve) => {
    const pump = () => {
      if (done.size === steps.length) return resolve();
      for (const s of steps) {
        if (running >= limit) break;
        if (started.has(s) || !(s.dependsOn || []).every((d) => steps.some((x) => x.agentId === d && done.has(x)))) continue;
        started.add(s);
        running++;
        Promise.resolve(fn(s)).catch(() => {}).finally(() => {
          running--;
          done.add(s);
          pump();
        });
      }
    };
    pump();
  });
}

function remember(store, agent, text) {
  agent.memory = agent.memory || [];
  agent.memory.push({ text: text.slice(0, 240), at: new Date().toISOString() });
  if (agent.memory.length > MAX_MEMORY) agent.memory.splice(0, agent.memory.length - MAX_MEMORY);
  agent.stats = { tasks: (agent.stats?.tasks || 0) + 1, lastActive: new Date().toISOString() };
  store.save();
}

const shortTitle = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 60) + (s.length > 60 ? '…' : '');

const MAX_SWAPS = 2; // reemplazos por paso si su IA falla
// Esperas entre reintentos de una tarea que no pudo avanzar (minutos).
const RESUME_BACKOFF_MIN = [2, 5, 10, 15, 30, 60, 60, 120];

/** ¿Esta IA puede trabajar ya? (activa, conectada y sin fallas ni falta de cupo) */
const ready = (store, a) => Boolean(a?.enabled) && isLive(store.data.settings, a) && healthOf(store, a.id).ok;

/**
 * Quién reemplaza a una IA que falló en un paso: una conectada y sana que no
 * esté ya en la tarea. Prefiere otro proveedor (si uno se cae o se queda sin
 * cupo, suelen fallar todas sus IAs), luego el mismo departamento, las que
 * comparten habilidades y las más rápidas.
 */
export function pickReplacement(store, task, failed, exclude = new Set(), { allowBrain = false } = {}) {
  const inTask = new Set((task?.steps || []).map((s) => s.agentId));
  const skills = new Set((failed?.skills || []).map((s) => s.toLowerCase()));
  const score = (a) => (failed && a.provider === failed.provider ? 100 : 0)
    + (failed && a.department === failed.department ? 0 : 20)
    - Math.min(15, (a.skills || []).filter((s) => skills.has(s.toLowerCase())).length * 3)
    + Math.min(9, Math.round((speedOf(store, a.id) || 60000) / 15000));
  return store.data.agents
    .filter((a) => (allowBrain || !a.isBrain) && !inTask.has(a.id) && !exclude.has(a.id) && ready(store, a))
    .sort((a, b) => score(a) - score(b))[0] || null;
}

/**
 * El cerebro que trabaja hoy: el Cerebro Central si está conectado y sano; si
 * no (sin clave, sin cupo o con fallas), lo suple la mejor IA conectada, para
 * que el plan y la respuesta final no salgan en modo demo.
 */
export function actingBrain(store, prefer = []) {
  const brain = brainOf(store);
  if (ready(store, brain)) return brain;
  const skills = ['planificar', 'sintetizar', 'coordinar', 'estrategia', 'redacción', 'razonamiento', 'resumen'];
  const score = (a) => (prefer.includes(a.id) ? -50 : 0) + (a.isHead ? -10 : 0)
    - (a.skills || []).filter((s) => skills.includes(s)).length * 5
    + Math.min(20, Math.round((speedOf(store, a.id) || 30000) / 5000));
  return store.data.agents.filter((a) => !a.isBrain && ready(store, a)).sort((a, b) => score(a) - score(b))[0] || brain;
}

/** Cambia la IA de un paso: los pasos que la esperaban pasan a esperar a la nueva. */
function swapAgent(task, step, newId) {
  const oldId = step.agentId;
  for (const o of task.steps) if (o !== step && o.dependsOn?.includes(oldId)) o.dependsOn = o.dependsOn.map((d) => (d === oldId ? newId : d));
  step.agentId = newId;
  step.output = '';
}

/** Ejecuta una tarea completa en la oficina. */
export async function runTask(store, notes, { prompt, agentIds, saveNotes = true, parentId = null, attachments = [], tags = [], template = null, effort = 'medium', fromNote = null, hub = null }) {
  if (!['low', 'medium', 'high'].includes(effort)) effort = 'medium';
  // Continuación: el equipo recibe el resultado de la tarea anterior.
  const parent = parentId ? store.data.tasks.find((t) => t.id === parentId) : null;
  const background = parent
    ? `Esta es una continuación de la tarea "${parent.prompt}". Resultado anterior del equipo:\n\n${parent.final.slice(0, 6000)}\n\nNuevo pedido: `
    : '';
  if (parent && !agentIds?.length) agentIds = parent.steps.map((s) => s.agentId);
  // Archivos adjuntos: se pasan completos (con un tope) a todo el equipo.
  const files = (attachments || []).filter((f) => f?.name && typeof f.content === 'string').slice(0, 10);
  let budget = 120000;
  const filesText = files.length
    ? `\n\nArchivos adjuntos por el usuario:\n${files.map((f) => {
      const body = f.content.slice(0, Math.max(0, budget));
      budget -= body.length;
      return `--- ${f.name} ---\n${body}${body.length < f.content.length ? '\n[…recortado]' : ''}`;
    }).join('\n\n')}\n`
    : '';
  // Memoria compartida: notas del grafo relacionadas con la tarea.
  const related = relatedNotes(store.data.notes, prompt + ' ' + (parent?.prompt || ''), 4);
  const knowledgeBase = filesText + (related.length
    ? `\n\nNotas relevantes de la base de conocimiento de la oficina:\n${related.map((n) => `### ${n.title}\n${n.content.slice(0, 900)}`).join('\n\n')}\n`
    : '');
  const task = {
    hub: hub || parent?.hub || 'cerebro',
    parentId: parent?.id || null,
    effort,
    fromNote,
    saveNotes,
    contextNotes: related.map((n) => n.title),
    tags,
    attachments: files.map((f) => ({ name: f.name, size: f.content.length })),
    id: Store.id('t_'),
    prompt,
    title: shortTitle(prompt),
    status: 'planning',
    plan: null,
    steps: [],
    final: '',
    noteId: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  store.data.tasks.unshift(task);
  // El historial crudo se recorta; el resultado de cada tarea vive en sus notas.
  if (store.data.tasks.length > 300) store.data.tasks.length = 300;
  store.save();
  bus.emit('event', { type: 'task', task });
  return executeTask(store, notes, task, { background, context: knowledgeBase, agentIds, template: template || parent?.steps, readLinks: true });
}

/**
 * Retoma una tarea que quedó esperando (sin cupo, sin conexión o por un
 * reinicio): lo que ya estaba hecho se conserva y solo se repite lo que faltó.
 */
export function resumeTask(store, notes, task) {
  if (!task || running.has(task.id) || task.status !== 'waiting') return null;
  for (const s of task.steps) {
    if (s.status === 'done') continue;
    s.status = 'pending';
    s.error = null;
    s.errorKind = null;
  }
  task.status = task.plan ? 'working' : 'planning';
  const r = task.resume || {};
  return executeTask(store, notes, task, { background: r.background || '', context: r.context || '', agentIds: r.agentIds || null, template: null, readLinks: false });
}

async function executeTask(store, notes, task, run) {
  const { settings } = store.data;
  const emitTask = () => bus.emit('event', { type: 'task', task });
  const prompt = task.prompt;
  const effort = task.effort || 'medium';
  const ctrl = new AbortController();
  const signal = ctrl.signal;
  running.set(task.id, ctrl);
  const nameOf = (id) => store.data.agents.find((a) => a.id === id)?.name || id;
  // Lo necesario para retomarla si se queda sin cupo o se reinicia la oficina.
  const keep = () => {
    task.resume = { ...(task.resume || {}), background: run.background, context: run.context.slice(0, 200000), agentIds: run.agentIds || null };
    store.save();
  };
  let planner = actingBrain(store);
  agentStatus(planner.id, 'thinking', 'Planificando…');

  try {
    // Enlaces en la tarea: se leen y se agregan como adjuntos.
    if (run.readLinks && settings.readLinks !== false && /https?:\/\//.test(prompt)) {
      agentStatus(planner.id, 'thinking', 'Leyendo los enlaces…');
      const pages = await readLinks(prompt);
      if (pages.length) {
        run.context += `\n\nPáginas enlazadas por el usuario:\n${pages.map((p) => `--- ${p.name} ---\n${p.content.slice(0, 30000)}`).join('\n\n')}\n`;
        task.attachments = [...(task.attachments || []), ...pages.map((p) => ({ name: p.name, size: p.content.length }))];
        emitTask();
      }
    }
    keep();
    if (!task.plan) {
      task.plan = await makePlan(store, prompt, run.agentIds, run.template);
      if (!task.plan.subtasks.length) throw new Error('No hay IAs disponibles para esta tarea: conecta o activa alguna en Ajustes → Conectar las IAs.');
      task.steps = task.plan.subtasks.map((s) => ({ ...s, status: 'pending', output: '', simulated: false, error: null }));
      if (task.plan.by && task.plan.by !== brainOf(store).id) task.plan.analysis = `${task.plan.analysis} (planificó ${nameOf(task.plan.by)}, suplente del Cerebro)`;
    }
    task.status = 'working';
    emitTask();
    agentStatus(planner.id, 'talking', task.plan.analysis);

    for (const s of task.steps) if (s.status !== 'done' && s.dependsOn?.length) agentStatus(s.agentId, 'thinking', `Esperando a ${s.dependsOn.map(nameOf).join(', ')}`);

    await runGraph(task.steps, settings.maxParallel || 4, async (step) => {
      if (step.status === 'done') return; // al retomar, lo ya hecho no se repite
      if (signal.aborted) {
        step.status = 'error';
        step.error = 'Cancelada';
        return;
      }
      const t0 = Date.now();
      step.status = 'working';
      step.error = null;
      step.errorKind = null;
      step.startedAt = new Date(t0).toISOString();
      const tried = new Set([step.agentId]);
      let agent = store.data.agents.find((a) => a.id === step.agentId);
      let replacing = null;
      // Si la IA del plan ya no está o sigue sin cupo, el paso arranca con otra.
      const health = agent && isLive(settings, agent) ? healthOf(store, agent.id) : { ok: true };
      if (!agent || !health.ok) {
        const alt = pickReplacement(store, task, agent, tried);
        if (alt) {
          (step.failed ||= []).push({ agentId: step.agentId, error: agent ? health.error : 'Ya no está en la oficina', kind: agent ? health.kind || 'otro' : 'otro', skipped: true, at: new Date().toISOString() });
          replacing = agent;
          swapAgent(task, step, alt.id);
          agent = alt;
        }
      }
      if (!agent) {
        step.status = 'error';
        step.error = 'Esta IA ya no está en la oficina';
        step.errorKind = 'otro';
        emitTask();
        return;
      }
      for (let attempt = 0; ; attempt++) {
        tried.add(agent.id);
        emitTask();
        agentStatus(agent.id, 'working', replacing ? `Reemplazo a ${replacing.name}: ${step.instruction}` : step.instruction);
        // Trabajo en conjunto: recibe lo que ya entregaron sus compañeros.
        const inputs = (step.dependsOn || [])
          .map((d) => task.steps.find((x) => x.agentId === d))
          .filter((x) => x?.status === 'done')
          .map((x) => `### Entrega de ${nameOf(x.agentId)}\n${x.output}`)
          .join('\n\n');
        const onDelta = streamer(`task:${task.id}:${agent.id}`);
        try {
          // Puede pedir acceso a carpetas o programas del usuario (con su permiso).
          // Si tiene asistentes, decide si les delega partes.
          const res = await callWithAssistants(store, {
            provider: agent.provider, model: agent.model, agent, onDelta, signal, effort,
            system: buildSystem(agent),
            messages: [{
              role: 'user',
              content: `${replacing ? `(Reemplazas a ${replacing.name}, ${replacing.role}, que no pudo hacer esta parte.)\n\n` : ''}${step.instruction}\n\n${inputs ? `Trabajo previo de tus compañeros (úsalo y mejóralo):\n\n${inputs}\n\n` : ''}Contexto completo de la tarea: ${run.background}${prompt}${run.context}`,
            }],
          }, { taskKey: `task:${task.id}:${agent.id}`, allowDemoDelegation: true });
          if (res.assistants) step.assistants = res.assistants;
          step.output = res.text;
          step.simulated = res.simulated;
          step.status = 'done';
          remember(store, agent, `Tarea "${task.title}": ${step.instruction}`);
          // Opcional: un verificador le pone nota al aporte (alimenta el medidor de acierto).
          if (settings.jury?.enabled && !signal.aborted) {
            // Jurado: otras IAs califican el aporte a ciegas.
            agentStatus(agent.id, 'thinking', 'El jurado está revisando mi aporte…');
            const j = await juryStep(store, task, step, settings.jury.size || 2);
            if (j) step.jury = j;
          } else if (settings.verifySteps && !signal.aborted) {
            const v = await verifyStep(store, task, step);
            if (v) step.verify = v;
          }
          agentStatus(agent.id, 'done', res.text.replace(/[#*>`]/g, '').slice(0, 140));
          onDelta.end();
          break;
        } catch (err) {
          onDelta.end();
          if (signal.aborted) {
            step.status = 'error';
            step.error = 'Cancelada';
            break;
          }
          const kind = classifyError(err.message);
          agentStatus(agent.id, 'error', err.message);
          (step.failed ||= []).push({ agentId: agent.id, error: err.message.slice(0, 300), kind, at: new Date().toISOString() });
          // Otra IA retoma el paso (si queda alguna conectada y sana).
          const next = attempt < MAX_SWAPS ? pickReplacement(store, task, agent, tried) : null;
          if (!next) {
            step.status = 'error';
            step.error = err.message;
            step.errorKind = kind;
            break;
          }
          replacing = agent;
          swapAgent(task, step, next.id);
          agent = next;
        }
      }
      step.ms = Date.now() - t0;
      emitTask();
    });

    if (signal.aborted) throw new Error('Cancelada por ti');
    const ok = task.steps.filter((s) => s.status === 'done');
    // Nadie pudo trabajar: si es algo pasajero (sin cupo, sin red…) la tarea espera y se retoma sola.
    if (!ok.length) return finishWithoutContributions(store, task, emitTask, nameOf);
    // Opcional: el jefe de cada departamento revisa lo que entregó su equipo.
    if (settings.headsReview) await headsReview(store, task, settings, signal, emitTask, nameOf);
    // Síntesis del cerebro (o de su suplente).
    task.status = 'synthesizing';
    emitTask();
    const tSynth = Date.now();
    const synth = await synthesize(store, task, { ok, run, effort, signal, nameOf });
    task.synthMs = Date.now() - tSynth;
    if (synth.by && synth.by !== brainOf(store).id) task.synthBy = synth.by;
    task.final = synth.text;
    // Las imágenes que generaron las IAs no se pierden en el resumen final.
    const imgs = [...new Set(ok.flatMap((s) => (s.output || '').match(/!?\[[^\]]*\]\(\/api\/(?:images|videos)\/[\w.-]+\)/g) || []))].filter((m) => !task.final.includes(m.match(/\(([^)]+)\)/)[1]));
    if (imgs.length) task.final = `${imgs.join('\n\n')}\n\n${task.final}`;

    // Revisión de calidad opcional por un verificador antes de entregar.
    const reviewer = settings.reviewFinal
      ? store.data.agents.find((a) => a.id === 'sonar-check' && a.enabled) || store.data.agents.find((a) => a.id === 'sonnet-qa' && a.enabled)
      : null;
    if (reviewer) {
      task.status = 'reviewing';
      emitTask();
      agentStatus(reviewer.id, 'working', 'Revisando la respuesta final…');
      try {
        const rev = await callModel(settings, {
          provider: reviewer.provider, model: reviewer.model, agent: reviewer, effort: 'low',
          system: buildSystem(reviewer),
          messages: [{ role: 'user', content: `Revisa esta respuesta a la tarea "${prompt}". Señala en viñetas breves errores, datos dudosos o faltantes y cómo corregirlos. Si está bien, dilo en una línea.\n\n${task.final}` }],
        });
        task.review = { agentId: reviewer.id, text: rev.text, simulated: rev.simulated };
        task.final += `\n\n---\n### ✅ Revisión de calidad (${reviewer.name})\n${rev.simulated ? '*Revisión simulada (modo demo):* la estructura es completa; verifica cifras y fuentes antes de usarla.' : rev.text}`;
        agentStatus(reviewer.id, 'done', 'Revisión lista');
      } catch (err) {
        agentStatus(reviewer.id, 'error', err.message);
      }
    }
    task.status = 'done';
    task.finishedAt = new Date().toISOString();
    task.ms = Date.parse(task.finishedAt) - Date.parse(task.createdAt || task.finishedAt);
    const brain = store.data.agents.find((a) => a.id === (task.synthBy || brainOf(store).id)) || brainOf(store);
    remember(store, brain, `Coordiné "${task.title}" con ${ok.map((s) => nameOf(s.agentId)).join(', ')}`);
    agentStatus(brain.id, 'done', '¡Tarea completada!');

    if (task.saveNotes !== false) saveTaskNotes(store, notes, task, nameOf);
  } catch (err) {
    task.status = 'error';
    task.final = signal.aborted ? 'Cancelada por ti. Puedes reintentarla cuando quieras.' : `Error: ${err.message}`;
    agentStatus(planner.id, signal.aborted ? 'idle' : 'error', signal.aborted ? '' : err.message);
    for (const st of task.steps) if (st.status === 'pending' || st.status === 'working') st.status = 'error', st.error ||= 'Cancelada';
  } finally {
    running.delete(task.id);
  }
  return finishTask(store, task);
}

/** Cierra la tarea: tablero, automatizaciones y eventos (no se llama mientras espera cupo). */
function finishTask(store, task) {
  const { settings } = store.data;
  if (task.status !== 'waiting') delete task.resume;
  // Opcional: los próximos pasos se convierten en tarjetas del tablero.
  if (task.status === 'done' && settings.autoCards) {
    const m = task.final.match(/#+\s*(próximos pasos|proximos pasos|ideas clave)[^\n]*\n([\s\S]*?)(?:\n#+\s|\n---|$)/i);
    const items = m ? m[2].split('\n').map((l) => l.replace(/^\s*(?:[-*•+]|\d+[.)])\s*(\[[ xX]\]\s*)?/, '').replace(/\*\(de [^)]*\)\*/, '').replace(/\*\*/g, '').trim()).filter((l) => l.length > 3).slice(0, 6) : [];
    for (const title of items) {
      (store.data.cards ||= []).push({ id: Store.id('c_'), title: title.slice(0, 200), details: `Surge de la tarea: ${task.title}`, column: 'todo', project: task.title.slice(0, 40), taskId: null, noteId: null, createdAt: new Date().toISOString() });
    }
    if (items.length) bus.emit('event', { type: 'cards' });
  }
  // Tarjetas del tablero ligadas a esta tarea pasan a «Hecho».
  if (task.status !== 'waiting') {
    for (const c of store.data.cards || []) {
      if (c.taskId === task.id) {
        if (task.status === 'done') {
          c.column = 'done';
          c.noteId = task.noteId;
        } else {
          // Falló: la tarjeta vuelve a «Por hacer» para poder reintentarla.
          c.column = 'todo';
          c.taskId = null;
        }
        bus.emit('event', { type: 'cards' });
      }
    }
  }
  store.save();
  bus.emit('event', { type: 'task', task });
  bus.emit('event', { type: 'notes' });
  if (task.status !== 'waiting') onTaskFinished(store, task);
  return task;
}

/** Errores de todos los intentos de los pasos (para explicar qué pasó). */
function failuresOf(task) {
  return task.steps.flatMap((s) => (s.failed?.length ? s.failed.filter((f) => !f.skipped) : s.error && s.error !== 'Cancelada' ? [{ agentId: s.agentId, error: s.error, kind: s.errorKind || classifyError(s.error) }] : []));
}

/**
 * Ningún paso salió. Si fue por algo pasajero (sin cupo, saturado, sin red…),
 * la tarea queda «esperando» y se retoma sola más tarde; si no, se explica
 * qué falló y qué hacer.
 */
function finishWithoutContributions(store, task, emitTask, nameOf) {
  const fails = failuresOf(task);
  const attempts = task.resume?.attempts || 0;
  const lines = [...new Map(fails.map((f) => [f.agentId, f])).values()].map((f) => {
    const e = explainError(f.error);
    return `- **${nameOf(f.agentId)}** — ${e.icon} ${e.title}: ${f.error.slice(0, 200)}${e.fix ? `\n  ${e.fix}` : ''}`;
  });
  if (fails.some((f) => isTemporaryError(f.error)) && attempts < RESUME_BACKOFF_MIN.length) {
    // Si alguna de estas IAs recupera su cupo antes, se retoma en ese momento.
    const soon = fails.map((f) => healthOf(store, f.agentId).until).filter(Boolean);
    const wait = Math.min(RESUME_BACKOFF_MIN[attempts] * 60000, ...soon.map((u) => u - Date.now()));
    task.status = 'waiting';
    task.resume = { ...(task.resume || {}), attempts: attempts + 1, at: new Date(Date.now() + Math.max(60000, wait)).toISOString() };
    task.final = `⏳ **En espera.** Ninguna IA pudo trabajar en este momento, por algo que suele arreglarse solo. La oficina la retomará sola (intento ${attempts + 1} de ${RESUME_BACKOFF_MIN.length}); también puedes retomarla ya o cancelarla.\n\n${lines.join('\n')}`;
    for (const st of task.steps) if (st.status !== 'done') st.status = 'pending';
    agentStatus(brainOf(store).id, 'idle', 'Esperando a que vuelva el cupo de las IAs…');
  } else {
    task.status = 'error';
    task.final = `No se pudo hacer la tarea: ninguna IA respondió.\n\n${lines.join('\n') || '- No había IAs disponibles.'}`;
    agentStatus(brainOf(store).id, 'error', 'Ninguna IA pudo hacer la tarea');
  }
  emitTask();
  return finishTask(store, task);
}

/**
 * Integra los aportes: el cerebro o, si no puede, otra IA que ya trabajó en la
 * tarea. Si nadie puede integrar, se entregan los aportes tal cual (el trabajo
 * del equipo nunca se pierde por una falla del final).
 */
async function synthesize(store, task, { ok, run, effort, signal, nameOf }) {
  const { settings } = store.data;
  // Con un solo aporte no hace falta integrar: se entrega tal cual (ahorra una llamada).
  if (ok.length === 1 && !ok[0].simulated) return { text: ok[0].output, simulated: false };
  const worked = ok.filter((s) => !s.simulated).map((s) => s.agentId);
  const first = actingBrain(store, worked);
  const others = worked.map((id) => store.data.agents.find((a) => a.id === id)).filter((a) => a && a.id !== first.id && ready(store, a))
    .sort((a, b) => (speedOf(store, a.id) || 60000) - (speedOf(store, b.id) || 60000));
  const order = [first, ...others].slice(0, 3);
  const contributions = ok.map((s) => `## Aporte de ${nameOf(s.agentId)}\n${s.output}`).join('\n\n');
  const failures = [];
  for (const who of order) {
    const brain = who.isBrain;
    agentStatus(who.id, 'thinking', 'Integrando aportes del equipo…');
    const synthDelta = streamer(`task:${task.id}:final`);
    try {
      const r = await callModel(settings, {
        provider: who.provider, model: who.model, agent: who, effort,
        onDelta: synthDelta, signal,
        system: buildSystem(who) + (brain ? '' : '\n\nHoy suples al Cerebro Central: integras los aportes del equipo en una sola respuesta.'),
        messages: [{
          role: 'user',
          content:
            `Tarea original: ${run.background}${task.prompt}${run.context}\n\nAportes del equipo:\n\n${contributions}\n\n` +
            'Integra todo en una respuesta final única, coherente y accionable. Menciona a quién se debe cada parte cuando aporte valor. ' +
            'Termina con "### Ideas clave" (3 a 6 viñetas cortas, cada una una idea reutilizable).',
        }],
      });
      synthDelta.end();
      if (r.simulated) return { text: demoSynthesis(task.prompt, ok, nameOf), simulated: true, by: who.id };
      return { text: r.text, simulated: false, by: who.id };
    } catch (err) {
      synthDelta.end();
      if (signal.aborted) throw err;
      failures.push({ agentId: who.id, error: err.message });
      agentStatus(who.id, 'error', err.message);
    }
  }
  const why = failures.map((f) => `${nameOf(f.agentId)}: ${explainError(f.error).title.toLowerCase()}`).join('; ');
  return {
    text: `> ⚠️ No se pudo integrar la respuesta (${why || 'sin IAs disponibles'}). Aquí están los aportes del equipo tal cual; con «¿Algún ajuste?» puedes pedir que los unan.\n\n${ok.map((s) => `## Aporte de ${nameOf(s.agentId)}\n\n${s.output}`).join('\n\n')}`,
    simulated: false,
  };
}

/** Revisión de los jefes: si 2 o más IAs de un departamento trabajaron, su jefe revisa y ajusta. */
async function headsReview(store, task, settings, signal, emitTask, nameOf) {
  const byDept = new Map();
  for (const s of task.steps.filter((x) => x.status === 'done')) {
    const a = store.data.agents.find((x) => x.id === s.agentId);
    if (!a || a.isHead) continue;
    (byDept.get(a.department) || byDept.set(a.department, []).get(a.department)).push(s);
  }
  for (const [dept, steps] of byDept) {
    const head = store.data.agents.find((a) => a.isHead && a.enabled && a.department === dept);
    if (!head || !usableFilter(settings, store.data.agents, (a) => healthOf(store, a.id).ok)(head) || steps.length < 2 || task.steps.some((s) => s.agentId === head.id)) continue;
    const step = { agentId: head.id, instruction: `Como jefe del departamento, revisa y unifica lo que entregó tu equipo (${steps.map((s) => nameOf(s.agentId)).join(', ')}).`, dependsOn: steps.map((s) => s.agentId), status: 'working', output: '', simulated: false, error: null, review: true };
    task.steps.push(step);
    emitTask();
    agentStatus(head.id, 'working', 'Revisando el trabajo de mi equipo…');
    const onDelta = streamer(`task:${task.id}:${head.id}`);
    try {
      const r = await callModel(settings, {
        provider: head.provider, model: head.model, agent: head, onDelta, signal, effort: 'low',
        system: buildSystem(head),
        messages: [{ role: 'user', content: `${step.instruction} Señala errores, contradicciones y vacíos, y entrega la versión unificada del departamento.\n\nTarea: ${task.prompt}\n\n${steps.map((s) => `### Entrega de ${nameOf(s.agentId)}\n${s.output}`).join('\n\n')}` }],
      });
      step.output = r.text;
      step.simulated = r.simulated;
      step.status = 'done';
      agentStatus(head.id, 'done', 'Revisión del departamento lista');
    } catch (err) {
      step.status = 'error';
      step.error = err.message;
      agentStatus(head.id, 'error', err.message);
    }
    onDelta.end();
    emitTask();
  }
}

function demoSynthesis(prompt, steps, names) {
  const bullets = steps.flatMap((s) => extractKeyIdeas(s.output).slice(0, 1).map((i) => `- ${i} *(de ${names(s.agentId)})*`));
  return [
    '**Claude** — *síntesis simulada (modo demo)*',
    '',
    `Coordiné a ${steps.map((s) => `**${names(s.agentId)}**`).join(', ')} para resolver: *${prompt}*.`,
    '',
    'Plan integrado:',
    ...steps.map((s, i) => {
      // Toma el primer punto numerado de su aporte como resumen.
      const first = s.output.match(/^\s*1\.\s*\*\*([^*]+)\*\*:?\s*(.+)$/m);
      const dep = s.dependsOn?.length ? ` (a partir de lo de ${s.dependsOn.map(names).join(' y ')})` : '';
      return `${i + 1}. **${names(s.agentId)}**${dep}: ${first ? `${first[1].replace(/:$/, '').trim()} — ${first[2].trim()}` : 'aporta su especialidad.'}`;
    }),
    '',
    'Conecta tus claves en **Ajustes** para que cada IA responda de verdad.',
    '',
    '### Ideas clave',
    ...(bullets.length ? bullets : ['- Dividir el problema en partes pequeñas']),
  ].join('\n');
}

/** Guarda la tarea en el grafo: nota de tarea, aportes enlazados e ideas. */
function saveTaskNotes(store, notes, task, names) {
  const parent = task.parentId ? store.data.tasks.find((t) => t.id === task.parentId) : null;
  const main = notes.create({
    title: task.title,
    type: 'tarea',
    tags: ['tarea', ...(task.tags || [])],
    hub: task.hub,
    source: { taskId: task.id, agentId: 'cerebro' },
    content: `# ${task.title}\n\n> ${task.prompt}\n\n${parent?.noteId ? `Continúa [[${notes.get(parent.noteId)?.title || parent.title}]]\n\n` : ''}${task.fromNote ? `A partir de la nota [[${task.fromNote}]]\n\n` : ''}${task.final}\n\n## Equipo\n${task.steps
      .filter((s) => s.status === 'done')
      .map((s) => `- [[${names(s.agentId)} · ${task.title}]]`)
      .join('\n')}`,
  });
  task.noteId = main.id;
  if (task.attachments?.length) {
    main.content += `\n\n## Archivos adjuntos\n${task.attachments.map((f) => `- 📎 ${f.name} (${Math.ceil(f.size / 1000)} mil caracteres)`).join('\n')}`;
    store.save();
  }
  if (task.contextNotes?.length) {
    main.content += `\n\n## Contexto usado\n${task.contextNotes.map((t) => `- [[${t}]]`).join('\n')}`;
    store.save();
  }

  for (const s of task.steps.filter((s) => s.status === 'done')) {
    const agent = store.data.agents.find((a) => a.id === s.agentId);
    notes.create({
      title: `${names(s.agentId)} · ${task.title}`,
      type: 'aporte',
      tags: [agent?.department || 'equipo'],
      hub: task.hub,
      source: { taskId: task.id, agentId: s.agentId },
      content: `Parte de [[${main.title}]]\n\n**Instrucción:** ${s.instruction}\n\n${s.output}`,
    });
  }

  const ideas = extractKeyIdeas(task.final);
  if (ideas.length) {
    for (const idea of ideas) {
      const clean = idea.replace(/\*\(de [^)]*\)\*/, '').replace(/[[\]]/g, '').trim();
      notes.upsertIdea(clean, `- Surgió en [[${main.title}]]`, { taskId: task.id, agentId: 'cerebro' }, task.hub);
    }
    main.content += `\n\n## Ideas\n${ideas.map((i) => `- [[${i.replace(/\*\(de [^)]*\)\*/, '').replace(/[[\]]/g, '').trim()}]]`).join('\n')}`;
    store.save();
  }
}

/** Conversación directa con un agente (con memoria del chat). */
export async function chatWithAgent(store, agentId, message) {
  const agent = store.data.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error('Agente no encontrado');
  const { settings } = store.data;
  const history = (store.data.chats[agentId] ||= []);
  history.push({ role: 'user', content: message, at: new Date().toISOString() });
  agentStatus(agentId, 'thinking', 'Pensando…');
  // Con su propio motor o, si no puede, con el de otra IA conectada (sigue siendo ella: su rol y su memoria).
  const ask = (engine, onDelta) => (engine === agent ? callWithAssistants : callWithAccess)(store, {
    provider: engine.provider, model: engine.model, agent: engine, onDelta,
    system: buildSystem(agent) + (engine === agent ? '' : `\n\n(Hoy respondes con el motor de ${engine.name} porque el tuyo no está disponible; sigues siendo ${agent.name}, con tu rol.)`),
    messages: history.slice(-20).map(({ role, content }) => ({ role, content })),
  });
  let onDelta = streamer(`chat:${agentId}`);
  let res;
  let via = null;
  let failed = null;
  try {
    // En modo demo no se responde con texto simulado si hay otra IA conectada que pueda.
    const sub0 = !isLive(settings, agent) && settings.onlyLive !== false ? pickReplacement(store, null, agent, new Set([agent.id]), { allowBrain: true }) : null;
    if (sub0) {
      via = sub0.id;
      failed = { error: 'No está conectada (modo demo)', kind: 'demo' };
    }
    try {
      res = await ask(sub0 || agent, onDelta);
    } catch (err) {
      onDelta.end();
      if (/^Cancelada/.test(err.message)) throw err;
      const sub = pickReplacement(store, null, agent, new Set([agent.id, sub0?.id]), { allowBrain: true });
      if (!sub) throw err;
      failed = { error: err.message.slice(0, 300), kind: classifyError(err.message) };
      via = sub.id;
      agentStatus(agentId, 'thinking', `Respondo con ayuda de ${sub.name}…`);
      onDelta = streamer(`chat:${agentId}`);
      try {
        res = await ask(sub, onDelta);
      } catch {
        throw err; // se muestra el error de la IA elegida, que es el que hay que arreglar
      }
    }
    onDelta.end();
    history.push({ role: 'assistant', content: res.text, simulated: res.simulated, at: new Date().toISOString(), ...(via ? { via, failed } : {}) });
    agent.stats = { tasks: agent.stats?.tasks || 0, lastActive: new Date().toISOString() };
    agentStatus(agentId, 'done', res.text.replace(/[#*>`]/g, '').slice(0, 140));
    store.save();
    return { reply: res.text, simulated: res.simulated, history, via };
  } catch (err) {
    onDelta.end();
    history.pop();
    agentStatus(agentId, 'error', err.message);
    err.kind = classifyError(err.message);
    throw err;
  }
}

/**
 * Autoentrenamiento: la IA repasa su memoria y sus últimos trabajos y escribe
 * una lección de "lecciones aprendidas" que se suma a su entrenamiento.
 */
export async function selfTrain(store, agentId) {
  const agent = store.data.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error('Agente no encontrado');
  const outputs = store.data.tasks
    .flatMap((t) => t.steps.filter((s) => s.agentId === agentId && s.status === 'done').map((s) => ({ task: t.title, output: s.output })))
    .slice(0, 6);
  const memory = (agent.memory || []).slice(-20);
  if (!memory.length && !outputs.length) throw new Error(`${agent.name} todavía no tiene experiencia: asígnale algunas tareas primero.`);
  agentStatus(agent.id, 'thinking', 'Repasando mi experiencia…');
  const res = await callModel(store.data.settings, {
    provider: agent.provider, model: agent.model, agent, effort: 'low',
    system: buildSystem(agent),
    messages: [{
      role: 'user',
      content: `Repasa tu experiencia y escribe tus "lecciones aprendidas": 4 a 8 viñetas concretas sobre qué funciona, qué prefiere el usuario y qué evitar la próxima vez. Sin introducción.\n\nMemoria:\n${memory.map((m) => `- ${m.text}`).join('\n')}\n\nTrabajos recientes:\n${outputs.map((o) => `### ${o.task}\n${o.output.slice(0, 1200)}`).join('\n\n')}`,
    }],
  });
  const text = res.simulated
    ? ['- Trabajé en: ' + [...new Set(memory.map((m) => m.text.replace(/^Tarea "([^"]+)".*/, '$1').slice(0, 60)))].slice(0, 5).join('; '),
      '- Entregar primero un borrador corto y luego ampliarlo.',
      '- Enlazar mis aportes con las notas existentes del grafo.',
      '- Revisar las entregas de mis compañeros antes de empezar.'].join('\n') + '\n\n*(Lección simulada en modo demo.)*'
    : res.text;
  const item = { id: Store.id('k_'), title: `Lecciones aprendidas · ${new Date().toLocaleDateString('es-CO')}`, content: text.slice(0, 6000), at: new Date().toISOString() };
  (agent.knowledge ||= []).push(item);
  store.save();
  agentStatus(agent.id, 'done', '¡Aprendí algo nuevo!');
  return item;
}

/** Resumen del día: una nota de diario enlazada con todo lo que hizo la oficina hoy. */
export async function dailySummary(store, notes, date = new Date()) {
  // Fecha local (no UTC), para que coincida con sameDay y con el día del usuario.
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const sameDay = (iso) => iso && new Date(iso).toDateString() === date.toDateString();
  const tasks = store.data.tasks.filter((t) => sameDay(t.createdAt) && t.status === 'done');
  const meetings = (store.data.meetings || []).filter((m) => sameDay(m.createdAt) && m.status === 'done');
  const ideas = store.data.notes.filter((n) => n.type === 'idea' && sameDay(n.createdAt));
  if (!tasks.length && !meetings.length) throw new Error('Hoy todavía no hay tareas ni reuniones terminadas.');
  const brain = actingBrain(store);
  const titleOf = (id) => store.data.notes.find((n) => n.id === id)?.title;
  agentStatus(brain.id, 'thinking', 'Escribiendo el resumen del día…');
  const res = await callModel(store.data.settings, {
    provider: brain.provider, model: brain.model, agent: brain, effort: 'low',
    system: buildSystem(brain),
    messages: [{
      role: 'user',
      content: `Escribe el resumen del día de la oficina (máximo 200 palabras): logros, decisiones y qué conviene hacer mañana.\n\nTareas:\n${tasks.map((t) => `- ${t.title}: ${t.final.slice(0, 500)}`).join('\n')}\n\nReuniones:\n${meetings.map((m) => `- ${m.topic}: ${m.summary.slice(0, 400)}`).join('\n')}`,
    }],
  });
  const body = res.simulated
    ? `Hoy la oficina completó ${tasks.length} tarea(s) y ${meetings.length} reunión(es), y surgieron ${ideas.length} idea(s) nuevas. *(Resumen simulado.)*`
    : res.text;
  const links = (arr) => arr.filter(Boolean).map((t) => `- [[${t}]]`).join('\n') || '- (ninguna)';
  const content = `${body}\n\n## Tareas\n${links(tasks.map((t) => titleOf(t.noteId)))}\n\n## Reuniones\n${links(meetings.map((m) => titleOf(m.noteId)))}\n\n## Ideas nuevas\n${links(ideas.map((i) => i.title))}\n\n#diario`;
  const title = `Resumen del día ${day}`;
  const existing = notes.findByTitle(title);
  const note = existing ? notes.update(existing.id, { content }) : notes.create({ title, type: 'diario', tags: ['diario'], source: { agentId: brain.id }, content });
  agentStatus(brain.id, 'done', 'Resumen del día listo');
  bus.emit('event', { type: 'notes' });
  return note;
}
