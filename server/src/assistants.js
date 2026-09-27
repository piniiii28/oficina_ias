// Asistentes: cada IA puede tener hasta 2 asistentes especializados en una
// tecnología o tema (por ejemplo, Codex con «React» y «Python»). La IA jefa
// decide si les delega: si la tarea es simple la resuelve sola; si es
// compleja, les reparte partes, ellos trabajan en paralelo con modelos rápidos
// y gratis, y la jefa revisa e integra sus entregas.
import { Store } from './store.js';
import { callModel, isLive } from './providers.js';
import { callWithAccess } from './access.js';
import { agentStatus, streamer } from './orchestrator.js';

export const MAX_ASSISTANTS = 2;

// Sugerencias de asistentes por IA (se agregan con un clic).
export const SUGGESTED = {
  codex: ['Arquitectura en la nube', 'Bases de datos'],
  opencode: ['React y frontend', 'Python y backend'],
  codestral: ['Seguridad del código', 'Rendimiento'],
  'deepseek-coder': ['Algoritmos', 'Depuración'],
  'sonnet-qa': ['Pruebas automáticas', 'Pruebas de usabilidad'],
  'llama-devops': ['Docker', 'GitHub Actions'],
  'gemini-data': ['Pandas y visualización', 'Machine learning'],
  'qwen-sql': ['PostgreSQL', 'Power BI'],
  chatgpt: ['Textos para redes', 'Correos y ventas'],
  'gemini-visual': ['Paletas y tipografías', 'Prompts de imágenes'],
  perplexity: ['Noticias recientes', 'Estudios científicos'],
  estratega: ['Modelo de negocio', 'Competencia'],
  'command-mkt': ['SEO', 'Publicidad pagada'],
  'llama-fin': ['Costos y precios', 'Impuestos en Colombia'],
  lexi: ['Contratos', 'Protección de datos'],
  'phi-tutor': ['Matemáticas', 'Programación para principiantes'],
  'blender-3d': ['Escultura orgánica', 'Piezas funcionales'],
  'openscad-3d': ['Encajes y tolerancias', 'Cajas y soportes'],
  'freecad-3d': ['Ensambles', 'Roscas y tornillería'],
  'slicer-3d': ['PLA y PETG', 'Resina'],
};

/** Limpia la lista de asistentes que llega de la interfaz. */
export function normalizeAssistants(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_ASSISTANTS).map((a) => {
    const focus = String(a?.focus || '').trim().slice(0, 60);
    return {
      id: typeof a?.id === 'string' && a.id ? a.id.slice(0, 30) : Store.id('as_'),
      name: String(a?.name || '').trim().slice(0, 30) || `Asistente de ${focus || 'apoyo'}`,
      focus: focus || 'apoyo general',
      provider: String(a?.provider || 'groq'),
      model: String(a?.model || 'openai/gpt-oss-120b').slice(0, 120),
    };
  });
}

const DELEGATE_RE = /<<delegar\s+asistente="([^"]+)"\s+tarea="([^"]+)"\s*\/?>>/g;

/** Instrucciones para la IA jefa. */
function bossGuide(agent) {
  return `

## Tus asistentes
Tienes ${agent.assistants.length} asistente(s): ${agent.assistants.map((a) => `«${a.name}» (especialista en ${a.focus})`).join(' y ')}.
Si la tarea es simple, respóndela tú. Si es compleja y una parte encaja con la especialidad de un asistente, delégala escribiendo en una línea propia:
<<delegar asistente="${agent.assistants[0].name}" tarea="lo que debe hacer, concreto">>
Cuando entreguen, revisas su trabajo y escribes la respuesta final integrada.`;
}

/**
 * Llama a una IA que puede tener asistentes. Si no tiene, es igual que
 * callWithAccess. Devuelve además `assistants`: lo que entregó cada uno.
 */
export async function callWithAssistants(store, params, { taskKey = null, allowDemoDelegation = false } = {}) {
  const agent = params.agent;
  const s = store.data.settings;
  // Con «solo IAs conectadas», un jefe conectado no delega en asistentes en modo demo.
  const team = (agent?.delegate === false ? [] : agent?.assistants || []).filter((a) => s.onlyLive === false || !isLive(s, agent) || isLive(s, a));
  if (!team.length) return callWithAccess(store, params);
  const first = await callWithAccess(store, { ...params, system: params.system + bossGuide(agent) });
  let orders = [...first.text.matchAll(DELEGATE_RE)]
    .map((m) => ({ assistant: team.find((a) => a.name.toLowerCase() === m[1].trim().toLowerCase()) || team.find((a) => m[1].toLowerCase().includes(a.focus.toLowerCase())), task: m[2] }))
    .filter((o) => o.assistant)
    .slice(0, MAX_ASSISTANTS);
  // En modo demo se muestra cómo trabaja el equipo: cada asistente aporta su parte.
  if (!orders.length && first.simulated && allowDemoDelegation) orders = team.map((a) => ({ assistant: a, task: `Aporta desde ${a.focus}` }));
  if (!orders.length) return first;

  agentStatus(agent.id, 'working', `Delegando a ${orders.map((o) => o.assistant.name).join(' y ')}…`);
  const context = params.messages.at(-1)?.content || '';
  const results = await Promise.all(orders.map(async (o, i) => {
    const onDelta = taskKey ? streamer(`${taskKey}:asist:${i}`) : undefined;
    try {
      const r = await callModel(store.data.settings, {
        provider: o.assistant.provider, model: o.assistant.model, effort: 'low', signal: params.signal, onDelta,
        agent: { id: `${agent.id}:${o.assistant.id}`, name: o.assistant.name, role: `asistente de ${agent.name} en ${o.assistant.focus}`, department: agent.department, skills: [o.assistant.focus] },
        system: `Eres ${o.assistant.name}, asistente de ${agent.name} (${agent.role}), especializado en ${o.assistant.focus}. Haz solo la parte que te pide, con detalle técnico y en Markdown. Responde en español.`,
        messages: [{ role: 'user', content: `${o.task}\n\nContexto de la tarea:\n${context.slice(0, 12000)}` }],
      });
      return { name: o.assistant.name, focus: o.assistant.focus, task: o.task, output: r.text, simulated: r.simulated };
    } catch (err) {
      return { name: o.assistant.name, focus: o.assistant.focus, task: o.task, output: '', error: err.message };
    } finally {
      onDelta?.end();
    }
  }));

  agentStatus(agent.id, 'working', 'Revisando lo que entregaron mis asistentes…');
  const deliveries = results.map((r) => `### ${r.name} (${r.focus})\n${r.error ? `(no pudo: ${r.error})` : r.output}`).join('\n\n');
  let final;
  if (first.simulated) {
    final = { ...first, text: `${first.text.replace(DELEGATE_RE, '').trim()}\n\n### Aportes de mi equipo\n${results.map((r) => `- **${r.name}** (${r.focus}): ${r.error ? `no pudo (${r.error})` : r.output.replace(/[#*>`]/g, '').replace(/\s+/g, ' ').slice(0, 160)}…`).join('\n')}` };
  } else {
    final = await callWithAccess(store, {
      ...params,
      messages: [...params.messages, { role: 'assistant', content: first.text }, { role: 'user', content: `Entregas de tus asistentes:\n\n${deliveries}\n\nRevísalas, corrige lo que haga falta y escribe tu respuesta final integrada (sin volver a delegar).` }],
    });
  }
  return { ...final, assistants: results };
}
