// Flujos de trabajo predefinidos: equipos con un orden de relevos.
export const FLOWS = [
  { id: 'app', name: '💻 Crear una app', steps: [['codex'], ['opencode', 'codex'], ['sonnet-qa', 'opencode'], ['guardian', 'opencode'], ['llama-devops', 'opencode']] },
  { id: 'lanzamiento', name: '🚀 Lanzar un producto', steps: [['perplexity'], ['estratega', 'perplexity'], ['command-mkt', 'estratega'], ['gemini-visual', 'estratega'], ['chatgpt', 'command-mkt']] },
  { id: 'contenido', name: '✍️ Contenido para redes', steps: [['perplexity'], ['chatgpt', 'perplexity'], ['grok', 'chatgpt'], ['gemini-visual', 'chatgpt'], ['sonar-check', 'chatgpt']] },
  { id: 'estudio', name: '🎓 Aprender un tema', steps: [['perplexity'], ['phi-tutor', 'perplexity'], ['deepseek-r', 'phi-tutor'], ['bibliotecaria', 'phi-tutor']] },
  { id: 'negocio', name: '📈 Plan de negocio', steps: [['perplexity'], ['estratega', 'perplexity'], ['llama-fin', 'estratega'], ['lexi', 'estratega'], ['nemotron-pm', 'estratega', 'llama-fin']] },
  { id: 'datos', name: '📊 Analizar datos', steps: [['qwen-sql'], ['gemini-data', 'qwen-sql'], ['deepseek-r', 'gemini-data'], ['chatgpt', 'gemini-data']] },
  { id: 'pieza3d', name: '🖨️ Pieza para imprimir (OpenSCAD)', steps: [['openscad-3d'], ['slicer-3d', 'openscad-3d']] },
  { id: 'figura3d', name: '🧊 Figura 3D (Blender)', steps: [['blender-3d'], ['slicer-3d', 'blender-3d']] },
  { id: 'mecanica3d', name: '⚙️ Pieza mecánica (FreeCAD)', steps: [['freecad-3d'], ['slicer-3d', 'freecad-3d']] },
];

/** Convierte un flujo en ids de IAs y la plantilla de dependencias. */
export function flowPlan(id, agents) {
  const f = FLOWS.find((x) => x.id === id);
  if (!f) return null;
  const ok = new Set(agents.filter((a) => a.enabled).map((a) => a.id));
  const steps = f.steps.filter(([aid]) => ok.has(aid));
  return {
    agentIds: steps.map(([aid]) => aid),
    template: steps.map(([aid, ...deps]) => ({ agentId: aid, dependsOn: deps.filter((d) => ok.has(d)) })),
  };
}
