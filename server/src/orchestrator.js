// El Cerebro Central: recibe una tarea, arma un plan, reparte subtareas entre
// los especialistas (en paralelo), integra sus aportes y guarda todo como notas
// conectadas en el grafo. Emite eventos para animar la oficina en vivo.
import { EventEmitter } from 'node:events';
import { Store } from './store.js';
import { callModel, hasKey } from './providers.js';
import { demoPlan } from './demo.js';
import { extractKeyIdeas } from './notes.js';
import { relatedNotes } from './librarian.js';
import { readLinks } from './links.js';
import { callWithAccess } from './access.js';
import { callWithAssistants } from './assistants.js';
import { verifyStep, juryStep } from './metrics.js';
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
  const pool = agents.filter((a) => !a.isBrain && a.enabled && (!forced?.length || forced.includes(a.id)));
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
  const brain = brainOf(store);
  const live = settings.demoMode !== 'always' && hasKey(settings, brain.provider);
  const maxTeam = settings.maxTeam || 5;
  if (!live) return demoPlan(task, pool, maxTeam);

  const roster = pool.map((a) => `- ${a.id}: ${a.name}, ${a.role}${a.isHead ? ' (jefe de su departamento)' : ''}${a.assistants?.length ? ` (tiene asistentes en ${a.assistants.map((x) => x.focus).join(' y ')})` : ''}. Habilidades: ${a.skills.join(', ')}${a.stats?.likes || a.stats?.dislikes ? `. Valoración del usuario: ${a.stats.likes || 0} 👍 / ${a.stats.dislikes || 0} 👎` : ''}`).join('\n');
  const prompt =
    `Tarea del usuario:\n"""${task}"""\n\nEquipo disponible:\n${roster}\n\n` +
    `Elige entre ${Math.min(2, maxTeam)} y ${maxTeam} especialistas (solo los necesarios)`+ ' y escribe una instrucción concreta para cada uno. ' +
    'Ante empates, prefiere a las IAs mejor valoradas por el usuario. ' +
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
    plan.subtasks = (plan.subtasks || []).filter((s) => pool.some((a) => a.id === s.agentId)).slice(0, maxTeam);
    if (!plan.subtasks.length) throw new Error('Plan vacío');
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
  let extraText = '';
  const knowledgeBase = filesText + (related.length
    ? `\n\nNotas relevantes de la base de conocimiento de la oficina:\n${related.map((n) => `### ${n.title}\n${n.content.slice(0, 900)}`).join('\n\n')}\n`
    : '');
  const ctx = () => knowledgeBase + extraText;
  const task = {
    hub: hub || parent?.hub || 'cerebro',
    parentId: parent?.id || null,
    effort,
    fromNote,
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
  const emitTask = () => bus.emit('event', { type: 'task', task });
  emitTask();

  const brain = brainOf(store);
  const { settings } = store.data;
  const ctrl = new AbortController();
  const signal = ctrl.signal;
  running.set(task.id, ctrl);
  agentStatus(brain.id, 'thinking', 'Planificando…');

  try {
    // Enlaces en la tarea: se leen y se agregan como adjuntos.
    if (settings.readLinks !== false && /https?:\/\//.test(prompt)) {
      agentStatus(brain.id, 'thinking', 'Leyendo los enlaces…');
      const pages = await readLinks(prompt);
      if (pages.length) {
        extraText = `\n\nPáginas enlazadas por el usuario:\n${pages.map((p) => `--- ${p.name} ---\n${p.content.slice(0, 30000)}`).join('\n\n')}\n`;
        task.attachments = [...(task.attachments || []), ...pages.map((p) => ({ name: p.name, size: p.content.length }))];
        emitTask();
      }
    }
    task.plan = await makePlan(store, prompt, agentIds, template || parent?.steps);
    task.status = 'working';
    task.steps = task.plan.subtasks.map((s) => ({ ...s, status: 'pending', output: '', simulated: false, error: null }));
    emitTask();
    agentStatus(brain.id, 'talking', task.plan.analysis);

    const nameOf = (id) => store.data.agents.find((a) => a.id === id)?.name || id;
    for (const s of task.steps) if (s.dependsOn?.length) agentStatus(s.agentId, 'thinking', `Esperando a ${s.dependsOn.map(nameOf).join(', ')}`);

    await runGraph(task.steps, settings.maxParallel || 4, async (step) => {
      if (signal.aborted) {
        step.status = 'error';
        step.error = 'Cancelada';
        return;
      }
      const agent = store.data.agents.find((a) => a.id === step.agentId);
      step.status = 'working';
      emitTask();
      agentStatus(agent.id, 'working', step.instruction);
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
            content: `${step.instruction}\n\n${inputs ? `Trabajo previo de tus compañeros (úsalo y mejóralo):\n\n${inputs}\n\n` : ''}Contexto completo de la tarea: ${background}${prompt}${ctx()}`,
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
      } catch (err) {
        step.status = 'error';
        step.error = err.message;
        agentStatus(agent.id, 'error', err.message);
      }
      onDelta.end();
      emitTask();
    });

    if (signal.aborted) throw new Error('Cancelada por ti');
    // Opcional: el jefe de cada departamento revisa lo que entregó su equipo.
    if (settings.headsReview) await headsReview(store, task, settings, signal, emitTask, nameOf);
    // Síntesis del cerebro.
    task.status = 'synthesizing';
    emitTask();
    agentStatus(brain.id, 'thinking', 'Integrando aportes del equipo…');
    const ok = task.steps.filter((s) => s.status === 'done');
    const names = (id) => store.data.agents.find((a) => a.id === id)?.name || id;
    const contributions = ok.map((s) => `## Aporte de ${names(s.agentId)}\n${s.output}`).join('\n\n');
    const synthDelta = streamer(`task:${task.id}:final`);
    const synth = await callModel(settings, {
      provider: brain.provider, model: brain.model, agent: brain, effort,
      onDelta: synthDelta, signal,
      system: buildSystem(brain),
      messages: [{
        role: 'user',
        content:
          `Tarea original: ${background}${prompt}${ctx()}\n\nAportes del equipo:\n\n${contributions || '(ningún aporte)'}\n\n` +
          'Integra todo en una respuesta final única, coherente y accionable. Menciona a quién se debe cada parte cuando aporte valor. ' +
          'Termina con "### Ideas clave" (3 a 6 viñetas cortas, cada una una idea reutilizable).',
      }],
    });
    synthDelta.end();
    task.final = synth.simulated ? demoSynthesis(prompt, ok, names) : synth.text;

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
    remember(store, store.data.agents.find((a) => a.id === brain.id), `Coordiné "${task.title}" con ${ok.map((s) => names(s.agentId)).join(', ')}`);
    agentStatus(brain.id, 'done', '¡Tarea completada!');

    if (saveNotes) saveTaskNotes(store, notes, task, names);
  } catch (err) {
    task.status = 'error';
    task.final = signal.aborted ? 'Cancelada por ti. Puedes reintentarla cuando quieras.' : `Error: ${err.message}`;
    agentStatus(brain.id, signal.aborted ? 'idle' : 'error', signal.aborted ? '' : err.message);
    for (const st of task.steps) if (st.status === 'pending' || st.status === 'working') st.status = 'error', st.error ||= 'Cancelada';
  }
  running.delete(task.id);
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
  store.save();
  emitTask();
  bus.emit('event', { type: 'notes' });
  onTaskFinished(store, task);
  return task;
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
    if (!head || steps.length < 2 || task.steps.some((s) => s.agentId === head.id)) continue;
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
  const history = (store.data.chats[agentId] ||= []);
  history.push({ role: 'user', content: message, at: new Date().toISOString() });
  agentStatus(agentId, 'thinking', 'Pensando…');
  const onDelta = streamer(`chat:${agentId}`);
  try {
    const res = await callWithAssistants(store, {
      provider: agent.provider, model: agent.model, agent, onDelta,
      system: buildSystem(agent),
      messages: history.slice(-20).map(({ role, content }) => ({ role, content })),
    });
    onDelta.end();
    history.push({ role: 'assistant', content: res.text, simulated: res.simulated, at: new Date().toISOString() });
    agent.stats = { tasks: agent.stats?.tasks || 0, lastActive: new Date().toISOString() };
    agentStatus(agentId, 'done', res.text.replace(/[#*>`]/g, '').slice(0, 140));
    store.save();
    return { reply: res.text, simulated: res.simulated, history };
  } catch (err) {
    onDelta.end();
    history.pop();
    agentStatus(agentId, 'error', err.message);
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
  const brain = brainOf(store);
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
