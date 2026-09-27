// Modelos gratis recomendados por proveedor. Los ids cambian seguido: si uno
// deja de existir, se puede escribir el nuevo desde el perfil de cada IA.
export const FREE_MODELS = {
  groq: [
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', for: 'general' },
    { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', for: 'código' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (más rápido)', for: 'rápido' },
  ],
  cerebras: [
    { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', for: 'general' },
    { id: 'qwen-3.8-27b', label: 'Qwen 3.8 27B', for: 'código' },
  ],
  google: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (el más capaz gratis)', for: 'razonamiento' },
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', for: 'general' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', for: 'rápido' },
    // gemini-3.1-pro-preview no tiene plan gratis (solo de pago).
  ],
  openrouter: [
    { id: 'qwen/qwen3.8-27b:free', label: 'Qwen 3.8 27B', for: 'código' },
    { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B', for: 'general' },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B', for: 'razonamiento' },
    { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', for: 'redacción' },
    { id: 'thinkingmachines/inkling:free', label: 'Inkling (1M de contexto)', for: 'documentos largos' },
    { id: 'cohere/north-mini-code:free', label: 'North Mini Code', for: 'código' },
    { id: 'openrouter/free', label: 'Automático (el gratis disponible)', for: 'general' },
  ],
  github: [
    { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini', for: 'general' },
    { id: 'openai/gpt-4.1', label: 'GPT-4.1 (pocos usos al día)', for: 'razonamiento' },
    { id: 'meta/Llama-4-Scout-17B-16E-Instruct', label: 'Llama 4 Scout', for: 'general' },
    { id: 'deepseek/DeepSeek-V3-0324', label: 'DeepSeek V3', for: 'código' },
    { id: 'mistral-ai/mistral-small-2503', label: 'Mistral Small', for: 'redacción' },
  ],
  sambanova: [
    { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', for: 'general' },
    { id: 'MiniMax-M3', label: 'MiniMax M3 (vista previa)', for: 'código' },
    { id: 'DeepSeek-V3.1', label: 'DeepSeek V3.1', for: 'razonamiento' },
    { id: 'gemma-4-31B-it', label: 'Gemma 4 31B', for: 'redacción' },
    { id: 'Meta-Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', for: 'general' },
  ],
  huggingface: [
    { id: 'Qwen/Qwen3.8-27B', label: 'Qwen 3.8 27B', for: 'general' },
    { id: 'deepseek-ai/DeepSeek-V4.1-Flash', label: 'DeepSeek V4.1 Flash', for: 'código' },
    { id: 'moonshotai/Kimi-K3', label: 'Kimi K3', for: 'documentos largos' },
    { id: 'zai-org/GLM-5.3', label: 'GLM 5.3', for: 'razonamiento' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', for: 'general' },
  ],
  nvidia: [
    { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', for: 'general' },
    { id: 'moonshotai/kimi-k3', label: 'Kimi K3', for: 'documentos largos' },
    { id: 'z-ai/glm-5.3', label: 'GLM 5.3', for: 'razonamiento' },
    { id: 'deepseek-ai/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', for: 'código' },
    { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B', for: 'redacción' },
  ],
  cohere: [
    { id: 'command-a-plus-05-2026', label: 'Command A+', for: 'redacción' },
    { id: 'command-a-03-2025', label: 'Command A', for: 'general' },
    { id: 'command-r7b-12-2024', label: 'Command R7B (rápido)', for: 'rápido' },
  ],
  cloudflare: [
    { id: '@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B', for: 'general' },
    { id: '@cf/qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', for: 'código' },
    { id: '@cf/moonshotai/kimi-k2.6', label: 'Kimi K2.6', for: 'documentos largos' },
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B (rápido)', for: 'redacción' },
    { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B (gasta menos)', for: 'rápido' },
  ],
  'ollama-cloud': [
    { id: 'gpt-oss:120b', label: 'GPT-OSS 120B', for: 'general' },
    { id: 'kimi-k3', label: 'Kimi K3', for: 'documentos largos' },
    { id: 'glm-5.3', label: 'GLM 5.3', for: 'razonamiento' },
    { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', for: 'código' },
    { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', for: 'rápido' },
    { id: 'gemma4:31b', label: 'Gemma 4 31B', for: 'redacción' },
  ],
  ovh: [
    { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', for: 'general' },
    { id: 'Qwen3.8-27B', label: 'Qwen 3.8 27B', for: 'razonamiento' },
    { id: 'Qwen3-Coder-30B-A3B-Instruct', label: 'Qwen3 Coder 30B', for: 'código' },
    { id: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'Mistral Small 3.2', for: 'redacción' },
    { id: 'Meta-Llama-3_3-70B-Instruct', label: 'Llama 3.3 70B', for: 'general' },
  ],
  mistral: [
    { id: 'mistral-small-latest', label: 'Mistral Small', for: 'general' },
    { id: 'codestral-latest', label: 'Codestral', for: 'código' },
    { id: 'open-mistral-nemo', label: 'Mistral Nemo', for: 'rápido' },
  ],
  ollama: [
    { id: 'gemma4:12b', label: 'Gemma 4 12B (7,6 GB, lee imágenes)', for: 'documentos largos' },
    { id: 'qwen3.5', label: 'Qwen 3.5 (6,6 GB, lee imágenes)', for: 'general' },
    { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder (4,7 GB)', for: 'código' },
    { id: 'deepseek-r1', label: 'DeepSeek R1 (5,2 GB)', for: 'razonamiento' },
    { id: 'mistral', label: 'Mistral 7B (4,4 GB)', for: 'redacción' },
    { id: 'granite4', label: 'Granite 4 de IBM (2,1 GB)', for: 'negocios' },
    { id: 'llama3.2', label: 'Llama 3.2 (2 GB, liviano)', for: 'rápido' },
    { id: 'gemma3', label: 'Gemma 3 (3,3 GB)', for: 'general' },
    { id: 'phi4', label: 'Phi-4 (9,1 GB)', for: 'explicar' },
    { id: 'gpt-oss:20b', label: 'GPT-OSS 20B (14 GB, necesita buena tarjeta)', for: 'razonamiento' },
    { id: 'hermes3', label: 'Hermes 3 (4,7 GB)', for: 'redacción' },
  ],
};

// Qué tipo de modelo le sirve a cada departamento.
const NEED = {
  codigo: 'código', impresion3d: 'código', datos: 'razonamiento', investigacion: 'general',
  creatividad: 'redacción', negocios: 'general', personas: 'general', direccion: 'razonamiento',
};

/**
 * Modelos que los proveedores retiraron (o dejaron de dar gratis) y su
 * reemplazo gratis. Se aplican solos al abrir la oficina y cuando una llamada
 * falla porque el modelo ya no existe.
 */
export const RETIRED_MODELS = {
  groq: {
    'llama-3.3-70b-versatile': 'openai/gpt-oss-120b', 'llama-3.1-8b-instant': 'openai/gpt-oss-20b', 'qwen/qwen3-32b': 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b': 'qwen/qwen3.8-27b',
    'meta-llama/llama-4-scout-17b-16e-instruct': 'openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct': 'openai/gpt-oss-120b', 'deepseek-r1-distill-llama-70b': 'openai/gpt-oss-120b',
  },
  sambanova: { 'Qwen3-32B': 'gpt-oss-120b', 'DeepSeek-V3-0324': 'DeepSeek-V3.1', 'DeepSeek-R1': 'DeepSeek-V3.1', 'Meta-Llama-3.1-8B-Instruct': 'gpt-oss-120b' },
  huggingface: { 'Qwen/Qwen3-32B': 'Qwen/Qwen3.8-27B', 'deepseek-ai/DeepSeek-V3-0324': 'deepseek-ai/DeepSeek-V4.1-Flash' },
  nvidia: { 'meta/llama-3.3-70b-instruct': 'nvidia/nemotron-3-super-120b-a12b', 'deepseek-ai/deepseek-r1': 'z-ai/glm-5.3', 'qwen/qwen2.5-coder-32b-instruct': 'deepseek-ai/deepseek-v4.1-flash' },
  cerebras: { 'llama-3.3-70b': 'gpt-oss-120b', 'qwen-3-32b': 'qwen-3.8-27b', 'llama3.1-8b': 'gpt-oss-120b' },
  openrouter: {
    'qwen/qwen3-coder:free': 'qwen/qwen3.8-27b:free', 'deepseek/deepseek-chat-v3.1:free': 'nvidia/nemotron-3-super-120b-a12b:free', 'deepseek/deepseek-r1:free': 'nvidia/nemotron-3-ultra-550b-a55b:free',
    'meta-llama/llama-3.3-70b-instruct:free': 'nvidia/nemotron-3-super-120b-a12b:free', 'moonshotai/kimi-k2:free': 'thinkingmachines/inkling:free', 'google/gemma-3-27b-it:free': 'google/gemma-4-31b-it:free',
    'mistralai/mistral-small-3.2-24b-instruct:free': 'google/gemma-4-31b-it:free', 'openai/gpt-oss-20b:free': 'nvidia/nemotron-3-super-120b-a12b:free', 'z-ai/glm-4.5-air:free': 'qwen/qwen3.8-27b:free',
  },
  google: { 'gemini-2.5-pro': 'gemini-3.8-flash', 'gemini-2.5-flash': 'gemini-3.7-flash', 'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite', 'gemini-2.0-flash': 'gemini-3.7-flash', 'gemini-1.5-pro': 'gemini-3.8-flash', 'gemini-1.5-flash': 'gemini-3.7-flash' },
};

/** Cambia en las IAs (y sus asistentes) los modelos retirados. Devuelve cuántos cambió. */
export function healAgents(agents) {
  let n = 0;
  const fix = (x) => {
    const next = RETIRED_MODELS[x.provider]?.[x.model];
    if (next) {
      x.model = next;
      n++;
    }
  };
  for (const a of agents || []) {
    fix(a);
    for (const s of a.assistants || []) fix(s);
    if (a.paidBackup) fix(a.paidBackup);
  }
  return n;
}

// Orden de preferencia de proveedores gratis para cada necesidad.
const ORDER = {
  código: [['openrouter', 'qwen/qwen3.8-27b:free'], ['groq', 'qwen/qwen3.8-27b'], ['cerebras', 'qwen-3.8-27b'], ['ollama-cloud', 'kimi-k2.7-code'], ['cloudflare', '@cf/qwen/qwen3.8-27b'], ['mistral', 'codestral-latest'], ['google', 'gemini-3.7-flash'], ['ollama', 'qwen2.5-coder']],
  razonamiento: [['groq', 'openai/gpt-oss-120b'], ['cerebras', 'gpt-oss-120b'], ['ollama-cloud', 'glm-5.3'], ['openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free'], ['google', 'gemini-3.8-flash'], ['ollama', 'deepseek-r1']],
  redacción: [['google', 'gemini-3.7-flash'], ['mistral', 'mistral-small-latest'], ['openrouter', 'google/gemma-4-31b-it:free'], ['groq', 'openai/gpt-oss-120b'], ['ollama', 'gemma3']],
  general: [['groq', 'openai/gpt-oss-120b'], ['google', 'gemini-3.7-flash'], ['cerebras', 'gpt-oss-120b'], ['cloudflare', '@cf/openai/gpt-oss-120b'], ['ollama-cloud', 'gpt-oss:120b'], ['github', 'openai/gpt-4.1-mini'], ['sambanova', 'Meta-Llama-3.3-70B-Instruct'], ['openrouter', 'nvidia/nemotron-3-super-120b-a12b:free'], ['nvidia', 'nvidia/nemotron-3-super-120b-a12b'], ['huggingface', 'Qwen/Qwen3.8-27B'], ['mistral', 'mistral-small-latest'], ['ovh', 'gpt-oss-120b'], ['ollama', 'gemma3']],
};

/**
 * IAs en modo demo (su proveedor no está conectado): se pasan a un proveedor
 * gratis que SÍ conectaste, según lo que hace cada una. Las que usan una CLI o
 * un servicio especial (Undermind) no se tocan.
 */
export function rescuePlan(agents, isConnected) {
  const changes = [];
  for (const a of agents) {
    if (a.enabled === false || a.mcp || a.provider.startsWith('cli-') || isConnected(a.provider)) continue;
    const need = a.isBrain ? 'razonamiento' : NEED[a.department] || 'general';
    const pick = ORDER[need].find(([p]) => isConnected(p)) || ORDER.general.find(([p]) => isConnected(p));
    if (pick) changes.push({ id: a.id, from: { provider: a.provider, model: a.model }, to: { provider: pick[0], model: pick[1] } });
  }
  return changes;
}

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
