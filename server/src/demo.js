// Modo demo: respuestas simuladas para probar la oficina sin claves de API.
// Genera un texto con la "voz" del agente, ideas clave y enlaces [[...]] para
// que el grafo de conocimiento se llene de forma realista.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const STOP = new Set(
  'el la los las un una unos unas de del al a y o u en con por para que como mi tu su sus mis es son ser se me te lo le les hay quiero necesito hacer haz dame sobre esto esta este muy mas más pero sin ya también tambien resume resumen resumir explica explícame explicame diseña disena escribe genera ayúdame ayudame investiga analiza organiza conseguimos conseguir hacemos podemos queremos quiero necesito necesitamos mejor mejores primeros primeras tarea tareas desde aporta parte contexto completo tu rol crea crear cómo como plan the and of to for in on with'.split(' '),
);

/** Palabras clave de un texto (para títulos de ideas y enlaces). */
export function keywords(text, n = 4) {
  const counts = new Map();
  for (const w of text.toLowerCase().normalize('NFC').match(/[\p{L}\d]{4,}/gu) || []) {
    if (!STOP.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ANGLES = {
  codigo: ['estructura del proyecto', 'componentes principales', 'pruebas y calidad', 'despliegue'],
  datos: ['métricas a medir', 'fuentes de datos', 'modelo de análisis', 'validación de resultados'],
  creatividad: ['tono y voz', 'gancho inicial', 'identidad visual', 'narrativa'],
  investigacion: ['estado del arte', 'fuentes confiables', 'comparativa de opciones', 'vacíos por investigar'],
  negocios: ['propuesta de valor', 'público objetivo', 'modelo de ingresos', 'riesgos y mitigación'],
  personas: ['conceptos básicos', 'plan paso a paso', 'hábitos sostenibles', 'recursos recomendados'],
  direccion: ['objetivo', 'plan de trabajo', 'responsables', 'siguiente paso'],
};

export async function simulate({ agent, messages }) {
  await wait(600 + Math.random() * 1400);
  const raw = messages[messages.length - 1]?.content || '';
  // En tareas del cerebro, el texto útil va entre comillas o tras "Contexto completo".
  const last = raw.match(/Contexto completo de la tarea: ([\s\S]*?)(?:\n\nNotas relevantes|$)/)?.[1] || raw.match(/"([^"]+)"/)?.[1] || raw;
  const kw = keywords(last, 3);
  const topic = kw.length ? kw.join(', ') : 'la tarea';
  const angles = ANGLES[agent?.department] || ANGLES.direccion;
  const name = agent?.name || 'Agente';
  const role = agent?.role || 'especialista';

  const lines = [
    `**${name}** (${role}) — *respuesta simulada en modo demo*`,
    '',
    `Analicé la petición sobre **${topic}** desde mi especialidad. Esta es mi propuesta:`,
    '',
    ...angles.map((a, i) => `${i + 1}. **${cap(a)}:** ${sentence(a, kw, i)}`),
    '',
    agent?.knowledge?.length ? `> Apliqué ${agent.knowledge.length} elemento(s) de mi entrenamiento personalizado.` : '',
    teammates(raw),
    '',
    '### Ideas clave',
    ...angles.slice(0, 3).map((a) => `- ${cap(a)} para ${kw[0] || 'el proyecto'}`),
  ];
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}

function teammates(raw) {
  const names = [...raw.matchAll(/### Entrega de ([^\n]+)/g)].map((m) => m[1]);
  return names.length ? `> Partí del trabajo de ${names.join(', ')} y lo complementé desde mi especialidad.` : '';
}

function sentence(angle, kw, i) {
  const k = kw[i % Math.max(kw.length, 1)] || 'el objetivo';
  const templates = [
    `definir con claridad cómo "${k}" encaja en el resultado final y qué se entrega primero.`,
    `priorizar lo que más impacto tiene sobre "${k}" y dejar lo accesorio para una segunda iteración.`,
    `conectar "${k}" con las notas existentes en el grafo para no repetir trabajo.`,
    `medir el avance con un indicador simple y revisarlo con el Cerebro Central.`,
  ];
  return templates[i % templates.length];
}

/** Coincidencia al inicio de palabra ("prueba" encaja con "pruebas", "ci" no con "cafetería"). */
function hasWord(text, word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tail = word.length <= 3 ? '(?![\\p{L}\\d])' : '';
  return new RegExp(`(?<![\\p{L}\\d])${esc}${tail}`, 'u').test(text);
}

/** Planificador demo: reparte según las habilidades de cada agente. */
export function demoPlan(task, agents, max = 5) {
  const text = task.toLowerCase();
  const scored = agents
    .filter((a) => !a.isBrain && a.enabled)
    .map((a) => {
      let score = 0;
      for (const s of a.skills) if (hasWord(text, s.toLowerCase())) score += s.includes(' ') ? 3 : 2;
      if (text.includes(a.name.toLowerCase())) score += 5;
      return { a, score };
    })
    .sort((x, y) => y.score - x.score);

  let chosen = scored.filter((s) => s.score > 0).slice(0, max).map((s) => s.a);
  if (chosen.length === 0) {
    // Sin coincidencias: un equipo generalista.
    const pick = ['perplexity', 'estratega', 'chatgpt'];
    chosen = agents.filter((a) => pick.includes(a.id) && a.enabled);
  }
  // Orden natural de trabajo: investigar → crear → revisar.
  const rank = (a) => (REVIEWERS.has(a.id) ? 2 : RESEARCH.has(a.id) ? 0 : 1);
  chosen.sort((x, y) => rank(x) - rank(y));
  const ids = new Set(chosen.map((a) => a.id));
  const subtasks = chosen.map((a) => {
    let dependsOn = [];
    if (REVIEWERS.has(a.id)) dependsOn = chosen.filter((b) => !REVIEWERS.has(b.id)).map((b) => b.id);
    else if (!RESEARCH.has(a.id)) dependsOn = [...RESEARCH].filter((r) => ids.has(r));
    return {
      agentId: a.id,
      dependsOn,
      instruction: REVIEWERS.has(a.id)
        ? `Revisa y mejora lo que entregó el equipo para esta tarea: "${task}"`
        : `Desde tu rol de ${a.role}, aporta tu parte a esta tarea: "${task}"`,
    };
  });
  const waits = subtasks.filter((s) => s.dependsOn.length).length;
  return {
    analysis: `Reparto la tarea entre ${chosen.map((a) => a.name).join(', ')} según sus especialidades` +
      (waits ? `; ${waits} de ellos trabajan sobre lo que entreguen los demás.` : '.'),
    subtasks,
  };
}

const RESEARCH = new Set(['perplexity', 'kimi', 'estratega']);
const REVIEWERS = new Set(['sonnet-qa', 'codestral', 'sonar-check', 'guardian']);
