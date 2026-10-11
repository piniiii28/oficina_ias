// Errores de las IAs explicados en palabras simples (el servidor manda el tipo).
export type ErrorKind = 'cupo' | 'clave' | 'modelo' | 'saturado' | 'red' | 'tiempo' | 'servidor' | 'programa' | 'cancelada' | 'otro';

export const ERROR_HELP: Record<ErrorKind, { icon: string; title: string; fix: string }> = {
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

/** Ayuda para un error: por su tipo (si lo mandó el servidor) o adivinando por el texto. */
export function errorHelp(kind?: string | null, message = '') {
  if (kind && kind in ERROR_HELP) return { kind: kind as ErrorKind, ...ERROR_HELP[kind as ErrorKind] };
  const m = message;
  const k: ErrorKind = /^Cancelada/i.test(m) ? 'cancelada'
    : /\b429\b|quota|rate.?limit|l[ií]mite de uso|too many requests|exhausted|sin cupo/i.test(m) ? 'cupo'
      : /no longer available|does not exist|not found|retired|decommissioned|invalid model/i.test(m) ? 'modelo'
        : /\b401\b|\b403\b|unauthori|invalid.{0,20}(api.?key|token)|no es válida/i.test(m) ? 'clave'
          : /overloaded|high demand|\b503\b|unavailable/i.test(m) ? 'saturado'
            : /no respondió|timeout|timed out/i.test(m) ? 'tiempo'
              : /ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(m) ? 'red'
                : 'otro';
  return { kind: k, ...ERROR_HELP[k] };
}

/** «14:05» (o «mañana 08:00») para una hora en milisegundos o ISO. */
export function clock(at: number | string) {
  const d = new Date(at);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString([], { weekday: 'short' })} ${hm}`;
}
