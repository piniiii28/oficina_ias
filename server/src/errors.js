// Errores de las IAs: qué significa cada uno, qué hacer y cuándo volver a
// intentar. Sirve para elegir otra IA, poner en espera a la que se quedó sin
// cupo y explicar el problema en palabras simples.

/** ¿La cuenta se quedó sin cupo o pasó el límite de peticiones? */
export const isQuotaError = (msg) => /\b429\b|quota|rate.?limit|l[ií]mite de uso|usage limit|limit reached|exhausted|too many requests|insufficient(?!.{0,20}permission)|sin cupo|credit balance|out of credits|tokens per (minute|day)|requests per (minute|day)/i.test(String(msg));

/** ¿El modelo ya no existe o dejó de ser gratis? */
export const isRetiredModel = (msg) => /not included in your free usage|requires? (a )?(paid|pro) (plan|subscription)|no longer available|does not exist|model_not_found|is not found|not found for API|not supported for generateContent|unavailable for free|decommissioned|has been (deprecated|retired|shut ?down)|not a valid model|invalid model/i.test(String(msg));

/** ¿El modelo está saturado en este momento (se arregla solo en un rato)? */
export const isOverloaded = (msg) => /high demand|overloaded|temporarily unavailable|try again later|\b503\b|\bUNAVAILABLE\b|server is busy|unexpected server error/i.test(String(msg));

/** ¿Una CLI rechazó el modelo que se le pidió (p. ej. Codex con cuenta de ChatGPT)? */
export const isCliModelError = (msg) => /model.{0,80}(not supported|not available|not found|unknown|invalid|does not exist)|(unknown|invalid|unsupported) model/i.test(String(msg));

const isAuthError = (msg) => /\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid.{0,20}(api.?key|token|credential)|incorrect api key|api key not valid|authentication|la clave de api no es válida|permission denied|not logged in|please log ?in|inicia sesi[oó]n/i.test(String(msg));
const isNetworkError = (msg) => /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket hang up|fetch failed|network/i.test(String(msg));
const isMissingProgram = (msg) => /no encontré el comando|is not recognized|no se reconoce|command not found|ENOENT/i.test(String(msg));
const isTimeout = (msg) => /no respondió en|dejó de responder|timed? ?out|ETIMEDOUT|tard[oó] demasiado/i.test(String(msg));
const isServerError = (msg) => /\b50[0-9]\b|internal server error|bad gateway|gateway timeout/i.test(String(msg));

/**
 * Tipo de error: 'cancelada' | 'cupo' | 'clave' | 'modelo' | 'saturado' |
 * 'red' | 'tiempo' | 'servidor' | 'programa' | 'otro'.
 */
export function classifyError(msg) {
  const m = String(msg || '');
  if (/^Cancelada/i.test(m)) return 'cancelada';
  // «No incluido en tu plan gratis» es del modelo (hay que cambiarlo), aunque llegue con un 429.
  if (isRetiredModel(m) || isCliModelError(m)) return 'modelo';
  if (isQuotaError(m)) return 'cupo';
  if (isAuthError(m)) return 'clave';
  if (isOverloaded(m)) return 'saturado';
  if (isMissingProgram(m)) return 'programa';
  if (isTimeout(m)) return 'tiempo';
  if (isNetworkError(m)) return 'red';
  if (isServerError(m)) return 'servidor';
  return 'otro';
}

/** Lo que significa cada tipo y qué puede hacer el usuario. */
export const ERROR_HELP = {
  cupo: { icon: '⏳', title: 'Sin cupo por ahora', fix: 'Se acabó el cupo gratis de este proveedor (por minuto o por día). La oficina le pasa el trabajo a otra IA y vuelve a probar con esta más tarde. Si pasa seguido, agrega otra cuenta o pásala a otro proveedor gratis.' },
  clave: { icon: '🔑', title: 'Clave o sesión no válida', fix: 'La clave está vencida, mal copiada o sin permiso (o la CLI no tiene la sesión iniciada). Pégala de nuevo en Ajustes → Conectar las IAs.' },
  modelo: { icon: '🧩', title: 'Modelo no disponible', fix: 'Ese modelo ya no existe o dejó de ser gratis. Elige otro en el perfil de la IA (⚙️) o usa «🔁 Activar las de demo» en Conectar las IAs.' },
  saturado: { icon: '🚦', title: 'Proveedor saturado', fix: 'El proveedor tiene mucha demanda en este momento. Se arregla solo en unos minutos; mientras tanto trabaja otra IA.' },
  red: { icon: '📡', title: 'Sin conexión', fix: 'No se pudo llegar al proveedor: revisa internet, el firewall o que el programa (Ollama, la CLI o el nodo) esté abierto.' },
  tiempo: { icon: '🐢', title: 'Tardó demasiado', fix: 'La IA no respondió a tiempo. Prueba con una tarea más corta o con un modelo más rápido.' },
  servidor: { icon: '🛠️', title: 'Falla del proveedor', fix: 'El servidor del proveedor tuvo un error. Suele arreglarse solo; se vuelve a intentar más tarde.' },
  programa: { icon: '🧰', title: 'Programa no instalado', fix: 'Falta instalar la herramienta de esta IA (por ejemplo la CLI de Claude, Codex o Gemini). Instálala desde Ajustes → Conectar las IAs.' },
  cancelada: { icon: '✖', title: 'Cancelada', fix: '' },
  otro: { icon: '⚠️', title: 'Error', fix: 'Prueba la conexión de esta IA en Ajustes → Conectar las IAs (🩺 Revisar todas).' },
};

/** { kind, icon, title, fix } para mostrar un error en la interfaz. */
export function explainError(msg) {
  const kind = classifyError(msg);
  return { kind, ...ERROR_HELP[kind] };
}

/** Errores que se arreglan solos con el tiempo (vale la pena esperar y reintentar). */
export const isTemporaryError = (msg) => ['cupo', 'saturado', 'red', 'tiempo', 'servidor'].includes(classifyError(msg));

const MIN = 60000;

/**
 * Cuánto esperar antes de volver a usar una IA que se quedó sin cupo, según
 * lo que diga el error («try again in 7m12s», «retry in 41s», Retry-After…).
 * Sin pista: 2 min si es por minuto, 2 h si es por día y 10 min si no se sabe.
 */
export function retryAfterMs(msg, headerMs = 0) {
  if (headerMs > 0) return Math.min(headerMs, 24 * 60 * MIN);
  const m = String(msg || '');
  const hms = m.match(/(?:try again|retry|reintenta)[^0-9]{0,20}(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:([\d.]+)\s*s)?/i);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    const ms = ((Number(hms[1]) || 0) * 3600 + (Number(hms[2]) || 0) * 60 + (Number(hms[3]) || 0)) * 1000;
    if (ms > 0) return Math.min(Math.ceil(ms) + 2000, 24 * 60 * MIN);
  }
  const delay = m.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i);
  if (delay) return Math.ceil(Number(delay[1]) * 1000) + 2000;
  if (/per.?day|daily|por d[ií]a|\bRPD\b|free-models-per-day|requests per day|tokens per day/i.test(m)) return 120 * MIN;
  if (/credit|balance|billing|month|insufficient/i.test(m)) return 360 * MIN;
  if (/per.?minute|\bRPM\b|\bTPM\b|tokens per minute|requests per minute/i.test(m)) return 2 * MIN;
  return 10 * MIN;
}
