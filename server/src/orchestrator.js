// El Cerebro Central: recibe una tarea, arma un plan, reparte subtareas entre
// los especialistas (en paralelo), integra sus aportes y guarda todo como notas
// conectadas en el grafo. Emite eventos para animar la oficina en vivo.
import { EventEmitter } from 'node:events';
import { Store } from './store.js';
import { callModel, hasKey } from './providers.js';
import { demoPlan } from './demo.js';
import { extractKeyIdeas } from './notes.js';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const MAX_MEMORY = 40;

export function agentStatus(agentId, status, message = '') {
  bus.emit('event', { type: 'agent', agentId, status, message, at: Date.now() });
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

async function makePlan(store, task, forced) {
  const { settings, agents } = store.data;
  const pool = agents.filter((a) => !a.isBrain && a.enabled && (!forced?.length || forced.includes(a.id)));
  if (forced?.length) {
    return {
      analysis: 'Trabajan los agentes que elegiste.',
      subtasks: pool.map((a) => ({ agentId: a.id, instruction: `Desde tu rol de ${a.role}, aporta tu parte a: "${task}"` })),
    };
  }
  const brain = brainOf(store);
  const live = settings.demoMode !== 'always' && hasKey(settings, brain.provider);
  if (!live) return demoPlan(task, pool);

  const roster = pool.map((a) => `- ${a.id}: ${a.name}, ${a.role}. Habilidades: ${a.skills.join(', ')}`).join('\n');
  const prompt =
    `Tarea del usuario:\n"""${task}"""\n\nEquipo disponible:\n${roster}\n\n` +
    'Elige entre 2 y 6 especialistas (solo los necesarios) y escribe una instrucción concreta para cada uno. ' +
    'Responde SOLO con JSON: {"analysis": "una frase", "subtasks": [{"agentId": "...", "instruction": "..."}]}';
  try {
    const { text } = await callModel(settings, {
      provider: brain.provider, model: brain.model, agent: brain, effort: 'low',
      system: 'Eres el planificador de una oficina de IAs. Devuelves únicamente JSON válido.',
      messages: [{ role: 'user', content: prompt }],
    });
    const plan = parseJson(text);
    plan.subtasks = (plan.subtasks || []).filter((s) => pool.some((a) => a.id === s.agentId)).slice(0, 8);
    if (!plan.subtasks.length) throw new Error('Plan vacío');
    return plan;
  } catch (err) {
    console.warn('[cerebro] Plan en vivo falló, uso planificador local:', err.message);
    return demoPlan(task, pool);
  }
}

async function runLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
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
export async function runTask(store, notes, { prompt, agentIds, saveNotes = true }) {
  const task = {
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
  store.save();
  const emitTask = () => bus.emit('event', { type: 'task', task });
  emitTask();

  const brain = brainOf(store);
  const { settings } = store.data;
  agentStatus(brain.id, 'thinking', 'Planificando…');

  try {
    task.plan = await makePlan(store, prompt, agentIds);
    task.status = 'working';
    task.steps = task.plan.subtasks.map((s) => ({ ...s, status: 'pending', output: '', simulated: false, error: null }));
    emitTask();
    agentStatus(brain.id, 'talking', task.plan.analysis);

    await runLimited(task.steps, settings.maxParallel || 4, async (step) => {
      const agent = store.data.agents.find((a) => a.id === step.agentId);
      step.status = 'working';
      emitTask();
      agentStatus(agent.id, 'working', step.instruction);
      try {
        const res = await callModel(settings, {
          provider: agent.provider, model: agent.model, agent,
          system: buildSystem(agent),
          messages: [{ role: 'user', content: `${step.instruction}\n\nContexto completo de la tarea: ${prompt}` }],
        });
        step.output = res.text;
        step.simulated = res.simulated;
        step.status = 'done';
        remember(store, agent, `Tarea "${task.title}": ${step.instruction}`);
        agentStatus(agent.id, 'done', res.text.replace(/[#*>`]/g, '').slice(0, 140));
      } catch (err) {
        step.status = 'error';
        step.error = err.message;
        agentStatus(agent.id, 'error', err.message);
      }
      emitTask();
    });

    // Síntesis del cerebro.
    task.status = 'synthesizing';
    emitTask();
    agentStatus(brain.id, 'thinking', 'Integrando aportes del equipo…');
    const ok = task.steps.filter((s) => s.status === 'done');
    const names = (id) => store.data.agents.find((a) => a.id === id)?.name || id;
    const contributions = ok.map((s) => `## Aporte de ${names(s.agentId)}\n${s.output}`).join('\n\n');
    const synth = await callModel(settings, {
      provider: brain.provider, model: brain.model, agent: brain, effort: 'medium',
      system: buildSystem(brain),
      messages: [{
        role: 'user',
        content:
          `Tarea original: ${prompt}\n\nAportes del equipo:\n\n${contributions || '(ningún aporte)'}\n\n` +
          'Integra todo en una respuesta final única, coherente y accionable. Menciona a quién se debe cada parte cuando aporte valor. ' +
          'Termina con "### Ideas clave" (3 a 6 viñetas cortas, cada una una idea reutilizable).',
      }],
    });
    task.final = synth.simulated ? demoSynthesis(prompt, ok, names) : synth.text;
    task.status = 'done';
    task.finishedAt = new Date().toISOString();
    remember(store, store.data.agents.find((a) => a.id === brain.id), `Coordiné "${task.title}" con ${ok.map((s) => names(s.agentId)).join(', ')}`);
    agentStatus(brain.id, 'done', '¡Tarea completada!');

    if (saveNotes) saveTaskNotes(store, notes, task, names);
  } catch (err) {
    task.status = 'error';
    task.final = `Error: ${err.message}`;
    agentStatus(brain.id, 'error', err.message);
  }
  store.save();
  emitTask();
  bus.emit('event', { type: 'notes' });
  return task;
}

function demoSynthesis(prompt, steps, names) {
  const bullets = steps.flatMap((s) => extractKeyIdeas(s.output).slice(0, 1).map((i) => `- ${i} *(de ${names(s.agentId)})*`));
  return [
    '**Claude** — *síntesis simulada (modo demo)*',
    '',
    `Coordiné a ${steps.map((s) => `**${names(s.agentId)}**`).join(', ')} para resolver: *${prompt}*.`,
    '',
    'Plan integrado:',
    ...steps.map((s, i) => `${i + 1}. ${names(s.agentId)} se encarga de su especialidad y entrega un primer borrador.`),
    '',
    'Conecta tus claves en **Ajustes** para que cada IA responda de verdad.',
    '',
    '### Ideas clave',
    ...(bullets.length ? bullets : ['- Dividir el problema en partes pequeñas']),
  ].join('\n');
}

/** Guarda la tarea en el grafo: nota de tarea, aportes enlazados e ideas. */
function saveTaskNotes(store, notes, task, names) {
  const main = notes.create({
    title: task.title,
    type: 'tarea',
    tags: ['tarea'],
    source: { taskId: task.id, agentId: 'cerebro' },
    content: `# ${task.title}\n\n> ${task.prompt}\n\n${task.final}\n\n## Equipo\n${task.steps
      .filter((s) => s.status === 'done')
      .map((s) => `- [[${names(s.agentId)} · ${task.title}]]`)
      .join('\n')}`,
  });
  task.noteId = main.id;

  for (const s of task.steps.filter((s) => s.status === 'done')) {
    const agent = store.data.agents.find((a) => a.id === s.agentId);
    notes.create({
      title: `${names(s.agentId)} · ${task.title}`,
      type: 'aporte',
      tags: [agent?.department || 'equipo'],
      source: { taskId: task.id, agentId: s.agentId },
      content: `Parte de [[${main.title}]]\n\n**Instrucción:** ${s.instruction}\n\n${s.output}`,
    });
  }

  const ideas = extractKeyIdeas(task.final);
  if (ideas.length) {
    for (const idea of ideas) {
      const clean = idea.replace(/\*\(de [^)]*\)\*/, '').replace(/[[\]]/g, '').trim();
      notes.upsertIdea(clean, `- Surgió en [[${main.title}]]`, { taskId: task.id, agentId: 'cerebro' });
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
  try {
    const res = await callModel(store.data.settings, {
      provider: agent.provider, model: agent.model, agent,
      system: buildSystem(agent),
      messages: history.slice(-20).map(({ role, content }) => ({ role, content })),
    });
    history.push({ role: 'assistant', content: res.text, simulated: res.simulated, at: new Date().toISOString() });
    agent.stats = { tasks: agent.stats?.tasks || 0, lastActive: new Date().toISOString() };
    agentStatus(agentId, 'done', res.text.replace(/[#*>`]/g, '').slice(0, 140));
    store.save();
    return { reply: res.text, simulated: res.simulated, history };
  } catch (err) {
    history.pop();
    agentStatus(agentId, 'error', err.message);
    throw err;
  }
}
