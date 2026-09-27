// Inicio de sesión para usar la oficina desde otros computadores (Tailscale).
// - En este mismo computador no hace falta iniciar sesión.
// - Desde otro computador, cada persona entra con su usuario y contraseña.
// - «admin» puede cambiar ajustes, claves y permisos; «miembro» trabaja con
//   las IAs, las notas y el tablero, pero no toca este computador.
import crypto from 'node:crypto';
import os from 'node:os';
import { Store } from './store.js';

const SESSION_DAYS = 30;
export const COOKIE = 'oficina_sesion';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString('hex') };
}

function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

export const publicUser = (u) => (u ? { id: u.id, name: u.name, role: u.role, hub: u.hub || null } : null);

export function createUser(store, { name, password, role = 'miembro', hub = null }) {
  const n = String(name || '').trim().slice(0, 30);
  if (!n) throw new Error('Escribe un nombre de usuario');
  if (String(password || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  const users = (store.data.settings.users ||= []);
  if (users.some((u) => u.name.toLowerCase() === n.toLowerCase())) throw new Error('Ya existe un usuario con ese nombre');
  const u = { id: Store.id('u_'), name: n, role: role === 'admin' ? 'admin' : 'miembro', hub: hub || null, ...hashPassword(password), createdAt: new Date().toISOString() };
  users.push(u);
  store.save();
  return u;
}

// Frena los intentos de adivinar contraseñas: 6 por minuto por dirección.
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  attempts.set(ip, list);
  return list.length >= 6;
}

export function login(store, { name, password }, ip) {
  if (tooMany(ip)) throw new Error('Demasiados intentos. Espera un minuto.');
  (attempts.get(ip) || attempts.set(ip, []).get(ip)).push(Date.now());
  const u = (store.data.settings.users || []).find((x) => x.name.toLowerCase() === String(name || '').trim().toLowerCase());
  if (!u || !checkPassword(u, password)) throw new Error('Usuario o contraseña incorrectos');
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = (store.data.sessions ||= {});
  sessions[token] = { userId: u.id, exp: Date.now() + SESSION_DAYS * 86400000 };
  // Limpia sesiones vencidas.
  for (const [t, sess] of Object.entries(sessions)) if (sess.exp < Date.now()) delete sessions[t];
  store.save();
  return { token, user: u };
}

export function logout(store, token) {
  if (store.data.sessions?.[token]) {
    delete store.data.sessions[token];
    store.save();
  }
}

export function cookieOf(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

export function userFromSession(store, token) {
  const sess = token && store.data.sessions?.[token];
  if (!sess || sess.exp < Date.now()) return null;
  return (store.data.settings.users || []).find((u) => u.id === sess.userId) || null;
}

/** Direcciones de Tailscale de este computador (100.64.0.0/10 y fd7a:115c:a1e0::/48). */
export function tailscaleAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal) continue;
      const m = a.address.match(/^100\.(\d+)\./);
      if ((a.family === 'IPv4' || a.family === 4) && m && Number(m[1]) >= 64 && Number(m[1]) <= 127) out.push(a.address);
      if ((a.family === 'IPv6' || a.family === 6) && /^fd7a:115c:a1e0:/i.test(a.address)) out.push(a.address);
    }
  }
  return out;
}

/** ¿Se acepta este nombre de host? (protege contra páginas maliciosas que se hacen pasar por la oficina) */
export function hostAllowed(settings, host) {
  const h = String(host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (['localhost', '127.0.0.1', '::1'].includes(h)) return true;
  if (!settings.remote?.enabled) return false;
  if (tailscaleAddresses().includes(h)) return true;
  if (h === os.hostname().toLowerCase() || h.endsWith('.ts.net')) return true;
  return (settings.remote.extraHosts || []).map((x) => x.toLowerCase()).includes(h);
}

// Lo que solo puede hacer un admin (o la persona frente a este computador).
const ADMIN = [
  [/^\/api\/settings$/, ['PUT']],
  [/^\/api\/(accounts|grants|users|import|export|claude-desktop|n8n|remote)(\/|$)/, null],
  [/^\/api\/cli\//, null],
  [/^\/api\/access\//, ['POST']],
  [/^\/api\/blender\/install$/, null],
  [/^\/api\/printer$/, ['PUT', 'DELETE']],
  [/^\/api\/automations/, ['POST', 'PUT', 'DELETE']],
  [/^\/api\/ollama\/(pull|sync)$/, null],
  [/^\/api\/nodes/, ['POST', 'PUT', 'DELETE']],
  [/^\/api\/mcp\//, ['POST', 'DELETE']],
  [/^\/api\/agents\/reset$/, null],
  [/^\/api\/agents\/(free-mode|gemini-pro)/, null],
  [/^\/api\/cad\/(run|jobs\/[^/]+\/(open|slice))$/, null],
];
export function needsAdmin(method, path) {
  if (method === 'DELETE' && /^\/api\/agents\/[^/]+$/.test(path)) return true;
  return ADMIN.some(([re, methods]) => re.test(path) && (!methods || methods.includes(method)));
}
