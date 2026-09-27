// Modelos gratis recomendados por proveedor. Los ids cambian seguido: si uno
// deja de existir, se puede escribir el nuevo desde el perfil de cada IA.
export const FREE_MODELS = {
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', for: 'general' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', for: 'razonamiento' },
    { id: 'qwen/qwen3-32b', label: 'Qwen3 32B', for: 'código' },
    { id: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2', for: 'documentos largos' },
  ],
  cerebras: [
    { id: 'llama-3.3-70b', label: 'Llama 3.3 70B', for: 'general' },
    { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', for: 'razonamiento' },
    { id: 'qwen-3-32b', label: 'Qwen3 32B', for: 'código' },
  ],
  google: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', for: 'general' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', for: 'rápido' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (cupo gratis pequeño)', for: 'razonamiento' },
  ],
  openrouter: [
    { id: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder', for: 'código' },
    { id: 'deepseek/deepseek-chat-v3.1:free', label: 'DeepSeek V3.1', for: 'general' },
    { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1', for: 'razonamiento' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B', for: 'general' },
    { id: 'moonshotai/kimi-k2:free', label: 'Kimi K2', for: 'documentos largos' },
    { id: 'google/gemma-3-27b-it:free', label: 'Gemma 3 27B', for: 'general' },
    { id: 'mistralai/mistral-small-3.2-24b-instruct:free', label: 'Mistral Small 3.2', for: 'redacción' },
    { id: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B', for: 'razonamiento' },
  ],
  mistral: [
    { id: 'mistral-small-latest', label: 'Mistral Small', for: 'general' },
    { id: 'codestral-latest', label: 'Codestral', for: 'código' },
    { id: 'open-mistral-nemo', label: 'Mistral Nemo', for: 'rápido' },
  ],
  ollama: [
    { id: 'gemma3', label: 'Gemma 3', for: 'general' },
    { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder', for: 'código' },
    { id: 'llama3.2', label: 'Llama 3.2 (liviano)', for: 'rápido' },
    { id: 'deepseek-r1', label: 'DeepSeek R1', for: 'razonamiento' },
    { id: 'phi4', label: 'Phi-4', for: 'explicar' },
  ],
};

// Qué tipo de modelo le sirve a cada departamento.
const NEED = {
  codigo: 'código', impresion3d: 'código', datos: 'razonamiento', investigacion: 'general',
  creatividad: 'redacción', negocios: 'general', personas: 'general', direccion: 'razonamiento',
};

// Orden de preferencia de proveedores gratis para cada necesidad.
const ORDER = {
  código: [['openrouter', 'qwen/qwen3-coder:free'], ['groq', 'qwen/qwen3-32b'], ['cerebras', 'qwen-3-32b'], ['mistral', 'codestral-latest'], ['google', 'gemini-2.5-flash'], ['ollama', 'qwen2.5-coder']],
  razonamiento: [['groq', 'openai/gpt-oss-120b'], ['cerebras', 'gpt-oss-120b'], ['openrouter', 'deepseek/deepseek-r1:free'], ['google', 'gemini-2.5-flash'], ['ollama', 'deepseek-r1']],
  redacción: [['google', 'gemini-2.5-flash'], ['mistral', 'mistral-small-latest'], ['openrouter', 'mistralai/mistral-small-3.2-24b-instruct:free'], ['groq', 'llama-3.3-70b-versatile'], ['ollama', 'gemma3']],
  general: [['groq', 'llama-3.3-70b-versatile'], ['google', 'gemini-2.5-flash'], ['cerebras', 'llama-3.3-70b'], ['openrouter', 'deepseek/deepseek-chat-v3.1:free'], ['mistral', 'mistral-small-latest'], ['ollama', 'gemma3']],
};

const PAID = new Set(['anthropic', 'openai', 'xai', 'perplexity', 'together', 'deepseek']);

/**
 * Modo gratis: pasa a un proveedor gratis a cada IA que hoy usa uno de pago.
 * Las IAs que ya funcionan con algo que no cuesta extra (una CLI con tu
 * suscripción, Ollama o un plan gratis) se quedan igual. Prefiere proveedores
 * que ya conectaste. Guarda el modelo anterior para poder volver.
 */
export function freePlan(agents, isConnected) {
  const changes = [];
  for (const a of agents) {
    if (!PAID.has(a.provider)) continue;
    // Si tienes la suscripción conectada por su CLI, esa es gratis para ti.
    const sub = { anthropic: ['cli-claude', ''], openai: ['cli-codex', ''] }[a.provider];
    const need = a.isBrain ? 'razonamiento' : NEED[a.department] || 'general';
    const options = ORDER[need];
    const pick = (sub && isConnected(sub[0]) && sub) || options.find(([p]) => isConnected(p)) || options[0];
    changes.push({ id: a.id, from: { provider: a.provider, model: a.model }, to: { provider: pick[0], model: pick[1] } });
  }
  return changes;
}
