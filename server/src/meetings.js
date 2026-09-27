// Sala de reuniones: varias IAs conversan por turnos sobre un tema, cada una
// leyendo lo que dijeron las demás, y el Cerebro Central cierra con un resumen
// que se guarda como nota enlazada.
import { Store } from './store.js';
import { callModel, usableFilter } from './providers.js';
import { bus, agentStatus, buildSystem } from './orchestrator.js';
import { keywords } from './demo.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const OPENERS = {
  codigo: ['Desde lo técnico, propongo', 'Para que funcione de verdad necesitamos', 'Veo un riesgo técnico:'],
  datos: ['Los números sugieren', 'Deberíamos medir', 'Si miramos los datos,'],
  creatividad: ['Imaginemos esto:', 'Para que conecte con la gente,', 'La historia aquí es'],
  investigacion: ['Según lo que se sabe,', 'Hay evidencia de que', 'Conviene verificar que'],
  negocios: ['Desde el negocio,', 'El valor para el cliente está en', 'Para que sea rentable,'],
  personas: ['Pensando en las personas,', 'Para explicarlo simple:', 'Lo importante para el usuario es'],
  direccion: ['Resumiendo hasta aquí,'],
};

async function demoTurn(agent, topic, transcript, round) {
  await wait(700 + Math.random() * 900);
  const kw = keywords(topic, 3);
  const k = kw[round % Math.max(kw.length, 1)] || 'el tema';
  const opener = (OPENERS[agent.department] || OPENERS.personas)[round % 3] || 'Propongo';
  const prev = transcript.at(-1);
  const reply = prev?.agentId === 'usuario'
    ? `¡Buena pregunta! Sobre lo que dices ("${prev.text.slice(0, 50)}"), `
    : prev && prev.agentId !== agent.id
    ? `${round % 2 ? 'Coincido con' : 'Buen punto de'} ${prev.name}, ${round % 2 ? 'y agrego algo:' : 'aunque lo matizaría:'} `
    : '';
  return `${reply}${opener} enfocarnos en **${k}** desde mi rol de ${agent.role.toLowerCase()}. *(turno simulado)*`;
}

export async function runMeeting(store, notes, { topic, agentIds, rounds = 2, hub = 'cerebro' }) {
  const usable = usableFilter(store.data.settings, store.data.agents);
  const agents = agentIds.map((id) => store.data.agents.find((a) => a.id === id)).filter((a) => a && usable(a));
  if (agents.length < 2) throw new Error('Para la reunión elige al menos 2 IAs conectadas');
  const brain = store.data.agents.find((a) => a.isBrain);
  const meeting = {
    id: Store.id('m_'),
    topic,
    agentIds: agents.map((a) => a.id),
    rounds: Math.max(1, Math.min(3, rounds)),
    status: 'running',
    speaking: null,
    transcript: [],
    summary: '',
    noteId: null,
    createdAt: new Date().toISOString(),
  };
  (store.data.meetings ||= []).unshift(meeting);
  if (store.data.meetings.length > 100) store.data.meetings.length = 100;
  store.save();
  const emit = () => bus.emit('event', { type: 'meeting', meeting });
  emit();
  const { settings } = store.data;

  try {
    rounds: for (let r = 0; r < meeting.rounds; r++) {
      for (const a of agents) {
        if (meeting.stopRequested) break rounds;
        meeting.speaking = a.id;
        emit();
        agentStatus(a.id, 'thinking', 'Preparando su intervención…');
        const convo = meeting.transcript.map((t) => `**${t.name}:** ${t.text}`).join('\n\n');
        const res = settings.demoMode === 'always'
          ? { text: await demoTurn(a, topic, meeting.transcript, r), simulated: true }
          : await callModel(settings, {
            provider: a.provider, model: a.model, agent: a, effort: 'low',
            system: buildSystem(a) + '\n\nEstás en una reunión con otras IAs. Habla en primera persona, máximo 120 palabras, sin títulos. Responde a lo que dijeron los demás (si el usuario, «Tú», intervino, respóndele primero) y aporta algo nuevo desde tu especialidad.',
            messages: [{ role: 'user', content: `Tema de la reunión: ${topic}\n\n${convo ? `Lo que se ha dicho:\n\n${convo}\n\n` : ''}Tu turno (ronda ${r + 1} de ${meeting.rounds}).` }],
          }).catch((err) => ({ text: `(No pude intervenir: ${err.message})`, simulated: false }));
        const text = res.simulated && settings.demoMode !== 'always' ? await demoTurn(a, topic, meeting.transcript, r) : res.text;
        meeting.transcript.push({ agentId: a.id, name: a.name, text, round: r + 1, simulated: res.simulated, at: new Date().toISOString() });
        agentStatus(a.id, 'talking', text.replace(/[*#>]/g, '').slice(0, 120));
        emit();
      }
    }

    meeting.speaking = brain.id;
    emit();
    agentStatus(brain.id, 'thinking', 'Resumiendo la reunión…');
    const convo = meeting.transcript.map((t) => `**${t.name}:** ${t.text}`).join('\n\n');
    const res = await callModel(settings, {
      provider: brain.provider, model: brain.model, agent: brain, effort: 'low',
      system: buildSystem(brain),
      messages: [{ role: 'user', content: `Resume esta reunión sobre "${topic}": acuerdos, desacuerdos y próximos pasos (con responsable). Termina con "### Ideas clave".\n\n${convo}` }],
    });
    meeting.summary = res.simulated
      ? [
        '**Claude** — *resumen simulado (modo demo)*',
        '',
        `Participaron ${agents.map((a) => `**${a.name}**`).join(', ')} durante ${meeting.rounds} ronda(s).`,
        '',
        '**Próximos pasos**',
        ...agents.map((a) => `- ${a.name}: preparar una propuesta desde ${a.role.toLowerCase()}.`),
        '',
        '### Ideas clave',
        ...keywords(topic, 3).map((k) => `- Profundizar en ${k}`),
      ].join('\n')
      : res.text;
    meeting.status = 'done';
    agentStatus(brain.id, 'done', 'Reunión terminada');

    const note = notes.create({
      title: `Reunión: ${topic.slice(0, 70)}`,
      type: 'nota',
      tags: ['reunion'],
      hub,
      source: { agentId: brain.id, meetingId: meeting.id },
      content: `# Reunión: ${topic}\n\n**Participantes:** ${agents.map((a) => a.name).join(', ')}\n\n## Resumen\n${meeting.summary}\n\n## Conversación\n${convo}`,
    });
    meeting.noteId = note.id;
    for (const a of agents) {
      a.memory = a.memory || [];
      a.memory.push({ text: `Participé en la reunión "${topic.slice(0, 120)}"`, at: new Date().toISOString() });
    }
  } catch (err) {
    meeting.status = 'error';
    meeting.summary = `Error: ${err.message}`;
    agentStatus(brain.id, 'error', err.message);
  }
  meeting.speaking = null;
  store.save();
  emit();
  bus.emit('event', { type: 'notes' });
  return meeting;
}
