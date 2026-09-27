// Servicios que se conectan por MCP a tu Claude Code (no dan clave de API):
// la oficina los agrega a Claude Code, tú inicias sesión una vez en el
// navegador, y las IAs que los usan llaman a Claude Code con permiso solo para
// las herramientas de ese servicio.
import { runLogged } from './system.js';
import { cliEnv } from './providers.js';

export const MCP_SERVICES = {
  undermind: {
    label: 'Undermind',
    what: 'Búsqueda profunda de artículos científicos',
    url: 'https://mcp.undermind.ai/mcp',
    site: 'https://www.undermind.ai',
    plan: 'Plan gratis con límite de búsquedas; Pro desde US$16 al mes.',
  },
};

const win = process.platform === 'win32';
const claude = (args, opts = {}) => runLogged('claude', args, { shell: win, timeoutMs: 30000, env: cliEnv('cli-claude', null), ...opts });

/** Comando para iniciar sesión (se abre en una terminal). */
export const mcpLoginCommand = (name) => `claude mcp login ${name}`;

/**
 * Estado en Claude Code: 'conectado', 'falta-sesion' (agregado, sin iniciar
 * sesión), 'no-agregado' o 'sin-claude' (Claude Code no está instalado).
 */
export async function mcpStatus(name) {
  const r = await claude(['mcp', 'list']);
  if (!r.ok && /No encontré|ENOENT|no se reconoce|command not found|not recognized/i.test(r.out)) return { status: 'sin-claude', detail: 'Instala Claude Code primero (Ajustes → Conectar las IAs).' };
  const line = r.out.split(/\r?\n/).find((l) => l.trim().toLowerCase().startsWith(`${name}:`));
  if (!line) return { status: 'no-agregado', detail: '' };
  if (/✓|connected/i.test(line) && !/fail|error|needs/i.test(line)) return { status: 'conectado', detail: line.trim() };
  return { status: 'falta-sesion', detail: line.trim() };
}

/** Agrega el servicio a Claude Code (para todas las carpetas del usuario). */
export async function mcpAdd(name, onLog = () => {}) {
  const svc = MCP_SERVICES[name];
  const r = await claude(['mcp', 'add', '--transport', 'http', '--scope', 'user', name, svc.url], { onData: onLog });
  if (!r.ok && !/already exists|ya existe/i.test(r.out)) throw new Error(`No pude agregar ${svc.label} a Claude Code: ${r.out.trim().slice(-300) || 'error desconocido'}`);
  return { ok: true };
}

export async function mcpRemove(name) {
  const r = await claude(['mcp', 'remove', '--scope', 'user', name]);
  return { ok: r.ok };
}
