// Actualizaciones: si la oficina se instaló con git (instalar.bat), se trae la
// versión nueva con «git pull», se reinstalan dependencias, se compila y se
// reinicia sola (iniciar.bat vuelve a abrirla al recibir el código 75).
import fs from 'node:fs';
import path from 'node:path';
import { runLogged } from './system.js';

export const RESTART_CODE = 75;
const win = process.platform === 'win32';
// Nunca se queda esperando una contraseña: si git la pide, se avisa.
const env = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0' });

const git = (root, args, opts = {}) => runLogged('git', args, { cwd: root, env: env(), timeoutMs: 120000, ...opts });

export async function updateStatus(root, { fetch = true } = {}) {
  if (!fs.existsSync(path.join(root, '.git'))) {
    return { git: false, canRestart: process.env.OFICINA_LANZADOR === '1' };
  }
  const head = (await git(root, ['rev-parse', '--short', 'HEAD'])).out.trim();
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
  let error = null;
  if (fetch) {
    const f = await git(root, ['fetch', '--quiet']);
    if (!f.ok) error = /auth|could not read|permission|403|401/i.test(f.out) ? 'GitHub pidió iniciar sesión: abre el actualizador una vez para guardar tu acceso.' : `No pude buscar actualizaciones: ${f.out.trim().slice(-200) || 'sin conexión'}`;
  }
  const count = await git(root, ['rev-list', '--count', 'HEAD..@{u}']);
  const log = await git(root, ['log', '--pretty=format:%h %s', 'HEAD..@{u}', '-n', '20']);
  return {
    git: true, head, branch, error,
    behind: count.ok ? Number(count.out.trim()) || 0 : 0,
    commits: log.ok ? log.out.trim().split('\n').filter(Boolean) : [],
    canRestart: process.env.OFICINA_LANZADOR === '1',
  };
}

/**
 * Trae la versión nueva, instala dependencias y compila. onLog recibe la salida.
 * Un nodo solo necesita el servidor: { build: false, workspace: 'server' }.
 */
export async function applyUpdate(root, onLog = () => {}, { build: doBuild = true, workspace = null } = {}) {
  const pull = await git(root, ['pull', '--ff-only'], { onData: onLog });
  if (!pull.ok) throw new Error(/auth|could not read/i.test(pull.out) ? 'GitHub pidió iniciar sesión: abre el actualizador una vez.' : 'No pude traer la versión nueva (¿cambiaste archivos del programa?).');
  onLog('\n$ npm install\n');
  const inst = await runLogged('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...(workspace ? ['-w', workspace] : [])], { cwd: root, onData: onLog, shell: win, timeoutMs: 15 * 60000 });
  if (!inst.ok) throw new Error('Falló la instalación de dependencias');
  if (!doBuild) return { ok: true };
  onLog('\n$ npm run build\n');
  const build = await runLogged('npm', ['run', 'build'], { cwd: root, onData: onLog, shell: win, timeoutMs: 10 * 60000 });
  if (!build.ok) throw new Error('Falló la compilación de la interfaz');
  return { ok: true };
}
