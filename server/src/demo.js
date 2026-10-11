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
  // Saludos o preguntas cortas en el chat: la IA se presenta.
  const isChat = !/Contexto completo de la tarea|Tarea original/.test(raw);
  if (isChat && (/^\s*(hola|buen[oa]s|hey|qu[eé] tal|qui[eé]n eres|qu[eé] (sabes|haces|puedes))/i.test(last) || last.split(/\s+/).length <= 4)) {
    return [
      `¡Hola! Soy **${agent?.name || 'una IA'}**, ${(agent?.role || 'especialista').toLowerCase()} de la oficina. 👋`,
      '',
      `Puedo ayudarte con: ${(agent?.skills || []).slice(0, 8).join(', ') || 'lo que necesites'}.`,
      '',
      agent?.knowledge?.length ? `Tengo ${agent.knowledge.length} ${agent.knowledge.length === 1 ? 'lección' : 'lecciones'} de entrenamiento y recuerdo nuestros trabajos anteriores.` : '',
      'Cuéntame qué necesitas. *(Respuesta simulada: conecta mi proveedor en Ajustes para que responda de verdad.)*',
    ].filter(Boolean).join('\n');
  }
  const kw = keywords(last, 3);
  const topic = kw.length ? kw.join(', ') : 'la tarea';
  // El Taller 3D entrega un modelo de ejemplo que sí se puede abrir en el programa.
  if (DEMO_CAD[agent?.id]) return DEMO_CAD[agent.id](topic);
  const angles = ANGLES[agent?.department] || ANGLES.direccion;
  const name = agent?.name || 'Agente';
  const role = agent?.role || 'especialista';

  const lines = [
    `**${name}** (${role}) — *respuesta simulada en modo demo*`,
    '',
    `Analicé la petición sobre **${topic}** desde mi especialidad. Esta es mi propuesta:`,
    '',
    ...angles.map((a, i) => `${i + 1}. **${cap(a)}:** ${sentence(a, kw, i + seedOf(agent?.id || ''))}`),
    '',
    agent?.knowledge?.length ? `> Apliqué ${agent.knowledge.length} elemento(s) de mi entrenamiento personalizado.` : '',
    teammates(raw),
    '',
    '### Ideas clave',
    ...angles.slice(0, 3).map((a) => `- ${cap(a)} para ${kw[0] || 'el proyecto'}`),
  ];
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}

const seedOf = (id) => [...id].reduce((n, c) => n + c.charCodeAt(0), 0);

function teammates(raw) {
  const names = [...raw.matchAll(/### Entrega de ([^\n]+)/g)].map((m) => m[1]);
  return names.length ? `> Partí del trabajo de ${names.join(', ')} y lo complementé desde mi especialidad.` : '';
}

function sentence(angle, kw, i) {
  const k = kw[i % Math.max(kw.length, 1)] || 'el objetivo';
  i = Math.abs(i);
  const templates = [
    `definir con claridad cómo "${k}" encaja en el resultado final y qué se entrega primero.`,
    `priorizar lo que más impacto tiene sobre "${k}" y dejar lo accesorio para una segunda iteración.`,
    `conectar "${k}" con las notas existentes en el grafo para no repetir trabajo.`,
    `medir el avance con un indicador simple y revisarlo con el Cerebro Central.`,
    `empezar con una versión mínima de "${k}" que se pueda probar esta semana.`,
    `listar los supuestos sobre "${k}" y validar primero el más riesgoso.`,
    `documentar las decisiones sobre "${k}" para que el resto del equipo las reutilice.`,
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
      // Las valoraciones del usuario desempatan.
      if (score > 0) score += Math.max(-1.5, Math.min(1.5, ((a.stats?.likes || 0) - (a.stats?.dislikes || 0)) * 0.5));
      return { a, score };
    })
    .sort((x, y) => y.score - x.score);

  let chosen = scored.filter((s) => s.score > 0).slice(0, max).map((s) => s.a);
  if (chosen.length === 0) {
    // Sin coincidencias: un equipo generalista; si esas IAs no están disponibles, las primeras que haya.
    const pick = ['perplexity', 'estratega', 'chatgpt'];
    chosen = agents.filter((a) => pick.includes(a.id) && a.enabled);
    if (!chosen.length) chosen = scored.slice(0, Math.min(3, max)).map((s) => s.a);
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

// Modelos de ejemplo del Taller 3D en modo demo (un soporte sencillo).
const DEMO_CAD = {
  'openscad-3d': (topic) => `**Scad** (Diseño paramétrico) — *respuesta simulada en modo demo*

Propuesta para **${topic}**: un soporte inclinado con base, respaldo y tope. Cambia las medidas al inicio.

\`\`\`openscad
// Soporte inclinado (medidas en mm)
ancho = 80;      // ancho del soporte
fondo = 70;      // profundidad de la base
grosor = 4;      // grosor de las paredes
angulo = 60;     // inclinación del respaldo
alto = 90;       // largo del respaldo
tope = 12;       // altura del tope delantero
$fn = 64;

module base() cube([ancho, fondo, grosor]);
module respaldo() translate([0, fondo * 0.35, 0]) rotate([90 - angulo, 0, 0]) cube([ancho, grosor, alto]);
module labio() translate([0, 0, 0]) cube([ancho, grosor, tope]);

difference() {
  union() { base(); respaldo(); labio(); }
  // Hueco para el cable
  translate([ancho / 2, -1, -1]) cylinder(d = 12, h = tope + 2);
}
\`\`\`

- Imprime acostado sobre la base, sin soportes.
- PLA o PETG, 0,2 mm de capa y 20 % de relleno.
- Aumenta \`grosor\` a 5 si el celular es pesado.

### Ideas clave
- Diseño paramétrico para ${topic}
- Imprimir sin soportes`,
  'blender-3d': (topic) => `**Blendi** (Modeladora en Blender) — *respuesta simulada en modo demo*

Modelo base para **${topic}** con primitivas y un bisel suave.

\`\`\`python
import bpy
import os

# Escena vacía
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

# Base y respaldo (medidas en metros = mm / 1000)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.002))
base = bpy.context.object
base.scale = (0.08, 0.07, 0.004)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.01, 0.04))
respaldo = bpy.context.object
respaldo.scale = (0.08, 0.004, 0.09)
respaldo.rotation_euler = (0.52, 0, 0)

# Unir las piezas y suavizar bordes
for o in (base, respaldo):
    o.select_set(True)
bpy.context.view_layer.objects.active = base
bpy.ops.object.join()
mod = base.modifiers.new("Bisel", "BEVEL")
mod.width = 0.0008
mod.segments = 3

bpy.ops.object.select_all(action="SELECT")
if hasattr(bpy.ops.wm, "stl_export"):
    bpy.ops.wm.stl_export(filepath=os.path.join(OUT_DIR, "modelo.stl"), global_scale=1000)
else:
    bpy.ops.export_mesh.stl(filepath=os.path.join(OUT_DIR, "modelo.stl"), global_scale=1000)
\`\`\`

- Aplica el bisel antes de imprimir si lo editas a mano.
- Revisa en el laminador que la malla no tenga huecos.
- Imprime con la base sobre la cama.

### Ideas clave
- Modelar ${topic} con primitivas
- Exportar STL en milímetros`,
  'freecad-3d': (topic) => `**Fredi** (Ingeniero CAD) — *respuesta simulada en modo demo*

Pieza técnica para **${topic}**, con un agujero pasante de 5 mm para tornillo.

\`\`\`python
import FreeCAD
import Part
import Mesh
import os

doc = FreeCAD.newDocument("Pieza")
base = Part.makeBox(80, 40, 5)
pared = Part.makeBox(80, 5, 40)
pieza = base.fuse(pared)
agujero = Part.makeCylinder(2.5, 10, FreeCAD.Vector(40, 20, -1))
pieza = pieza.cut(agujero)
obj = doc.addObject("Part::Feature", "Soporte")
obj.Shape = pieza.removeSplitter()
doc.recompute()
Mesh.export([obj], os.path.join(OUT_DIR, "pieza.stl"))
\`\`\`

- Holgura del agujero: 0,3 mm para tornillo M5.
- Imprime con la pared vertical para que resista.
- 3 perímetros y 30 % de relleno.

### Ideas clave
- Pieza técnica para ${topic}
- Tolerancias de 0,3 mm`,
};
