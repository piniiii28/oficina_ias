// Accesos con permiso: las IAs pueden pedir ver carpetas de tu computador,
// buscar archivos, leerlos, abrirlos en Blender (u otro programa del Taller 3D)
// o copiar sus modelos a una carpeta tuya. Nada pasa sin tu aprobación: la
// oficina muestra cada petición y tú eliges «Permitir siempre», «Solo esta
// vez» o «Rechazar». Las IAs nunca tocan los archivos directamente: escriben
// una acción y el servidor la ejecuta solo si está permitida.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './store.js';
import { callModel } from './providers.js';
import { bus, agentStatus } from './orchestrator.js';
import { detectCad, CAD_TOOLS } from './cad.js';
import { launchApp, openPath } from './system.js';

const win = process.platform === 'win32';
export const MODES = ['leer', 'escribir'];
const MAX_ROUNDS = 4;
const WAIT_MS = 10 * 60000;

/** Carpetas que nunca se pueden permitir (sistema o credenciales). */
function forbidden(p, dataDir) {
  const n = norm(p);
  const root = path.parse(p).root;
  if (norm(root) === n) return 'No se puede dar acceso a un disco completo; elige una carpeta.';
  const sys = win
    ? ['C:\\Windows', 'C:\\ProgramData', process.env.SystemRoot || 'C:\\Windows']
    : ['/etc', '/bin', '/sbin', '/usr', '/System', '/Library', '/var', '/private', '/boot', '/dev', '/proc', '/root'];
  if (sys.some((s) => inside(n, norm(s)))) return 'Es una carpeta del sistema.';
  // Los datos de la oficina guardan tus claves: solo el taller 3D es accesible.
  if (dataDir && inside(n, norm(dataDir)) && !inside(n, norm(path.join(dataDir, 'taller3d')))) return 'Ahí están los datos y claves de la oficina.';
  if (/[\\/](\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.codex|\.claude|\.gemini|\.config[\\/]gcloud)([\\/]|$)/i.test(p)) return 'Ahí hay credenciales.';
  if (/[\\/](\.env[^\\/]*|id_[a-z0-9]+|[^\\/]*\.(pem|key|p12|pfx|kdbx))$/i.test(p)) return 'Es un archivo de credenciales.';
  if (/[\\/](Cookies|Login Data|Local State|Web Data)$/i.test(p)) return 'Son datos privados del navegador.';
  return null;
}

const norm = (p) => {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return win ? r.toLowerCase() : r;
};
const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep) || (win && p.startsWith(dir + '/'));

/** ¿Qué permiso cubre esta ruta? (escribir incluye leer) */
export function allowedBy(settings, p, mode, extra = []) {
  const n = norm(p);
  return [...(settings.grants || []), ...extra].find((g) => inside(n, norm(g.path)) && (mode === 'leer' || g.mode === 'escribir'));
}

/** Guarda un permiso permanente. */
export function addGrant(store, { path: p, mode = 'leer', label = '' }) {
  const why = forbidden(p, store.dir);
  if (why) throw new Error(why);
  if (!fs.existsSync(p)) throw new Error('Esa carpeta no existe en este computador');
  const s = store.data.settings;
  s.grants ||= [];
  const existing = s.grants.find((g) => norm(g.path) === norm(p));
  if (existing) {
    if (mode === 'escribir') existing.mode = 'escribir';
  } else s.grants.push({ id: Store.id('g_'), path: path.resolve(p), mode: MODES.includes(mode) ? mode : 'leer', label: String(label).slice(0, 60), createdAt: new Date().toISOString() });
  store.save();
  return s.grants;
}

// --- Peticiones pendientes (esperan tu respuesta en la interfaz) ---
const pending = new Map(); // id -> { request, resolve }

export function listRequests() {
  return [...pending.values()].map((p) => p.request);
}

function emitRequests() {
  bus.emit('event', { type: 'access', requests: listRequests() });
}

/** Pide permiso y espera tu respuesta: 'always' | 'once' | 'deny'. */
export function requestAccess(store, { agent, path: p, mode, reason, action }) {
  const why = forbidden(p, store.dir);
  if (why) return Promise.resolve({ decision: 'deny', why });
  const request = {
    id: Store.id('r_'), agentId: agent?.id, agentName: agent?.name || 'Una IA', path: path.resolve(p), mode, reason: String(reason || '').slice(0, 300), action, at: new Date().toISOString(),
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => decide(request.id, 'deny', 'No respondiste a tiempo'), WAIT_MS);
    pending.set(request.id, { request, resolve: (r) => { clearTimeout(timer); resolve(r); } });
    if (agent) agentStatus(agent.id, 'thinking', `🔐 Esperando tu permiso para ${mode} ${path.basename(p) || p}`);
    emitRequests();
  });
}

/** Tu respuesta a una petición. */
export function decide(id, decision, why = '') {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  p.resolve({ decision: ['always', 'once'].includes(decision) ? decision : 'deny', why });
  emitRequests();
  return true;
}

// --- Acciones que las IAs pueden escribir en su respuesta ---
// <<accion atributo="valor" …>>
const ACTION_RE = /<<(listar|buscar|leer|abrir|copiar|pedir-acceso|buscar-programa)((?:\s+[a-z]+="[^"]*")*)\s*\/?>>/g;

export function parseActions(text) {
  const out = [];
  for (const m of String(text).matchAll(ACTION_RE)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-z]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    out.push({ kind: m[1], attrs, raw: m[0] });
  }
  return out.slice(0, 8);
}

/** Instrucciones que recibe cada IA sobre cómo pedir acceso. */
export function accessGuide(settings, dataDir) {
  const grants = settings.grants || [];
  return `

## Acceso a archivos del computador del usuario (con su permiso)
Si necesitas ver carpetas o archivos del usuario, escribe una acción en una línea propia; la oficina la ejecuta y te devuelve el resultado. Si la ruta aún no está permitida, el usuario recibe una petición y decide. Usa rutas completas.
<<listar ruta="C:\\Users\\...\\Modelos">>   lista una carpeta
<<buscar ruta="C:\\Users\\..." nombre="*.blend">>   busca archivos por nombre (puedes usar *)
<<leer ruta="C:\\...\\notas.txt">>   lee un archivo de texto
<<abrir ruta="C:\\...\\pieza.stl" programa="blender">>   abre un archivo (programa opcional: blender, openscad, freecadGui, prusaslicer, orcaslicer)
<<copiar de="C:\\...\\modelo.stl" a="C:\\...\\Impresiones">>   copia un archivo a una carpeta (necesita permiso de escribir)
<<buscar-programa nombre="blender">>   dónde está instalado un programa del taller
<<pedir-acceso ruta="C:\\..." modo="leer" motivo="para qué lo necesitas">>
Pide solo lo necesario y explica el motivo. Carpeta de inicio del usuario: ${os.homedir()}. Carpeta del Taller 3D (siempre permitida): ${path.join(dataDir, 'taller3d')}.
${grants.length ? `Ya tienes permiso en:\n${grants.map((g) => `- ${g.path} (${g.mode})`).join('\n')}` : 'Todavía no tienes permisos en ninguna carpeta.'}`;
}

const globRe = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');

function search(dir, pattern, dataDir, limit = 150, depth = 7) {
  const re = globRe(pattern || '*');
  const out = [];
  const walk = (d, level) => {
    if (out.length >= limit || level > depth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(d, e.name);
      if (forbidden(full, dataDir) || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      if (re.test(e.name)) out.push(`${full}${e.isDirectory() ? path.sep : ''}`);
      if (e.isDirectory()) walk(full, level + 1);
    }
  };
  walk(dir, 0);
  return out;
}

/**
 * Ejecuta una acción. Si la ruta no está permitida, pide permiso y espera.
 * Devuelve un texto con el resultado para la IA.
 */
async function runAction(store, agent, act, onceGrants) {
  const { kind, attrs } = act;
  const dataDir = store.dir;
  const taller = { path: path.join(dataDir, 'taller3d'), mode: 'escribir' };
  const need = async (p, mode, reason) => {
    if (!p) throw new Error('Falta la ruta');
    const why = forbidden(p, dataDir);
    if (why) throw new Error(`No permitido: ${why}`);
    if (allowedBy(store.data.settings, p, mode, [taller, ...onceGrants])) return;
    const target = kind === 'leer' || kind === 'abrir' || (kind === 'copiar' && mode === 'leer') ? path.dirname(p) : p;
    const r = await requestAccess(store, { agent, path: target, mode, reason: reason || attrs.motivo, action: `${kind} ${p}` });
    if (r.decision === 'deny') throw new Error(`El usuario no dio permiso${r.why ? ` (${r.why})` : ''}`);
    if (r.decision === 'always') addGrant(store, { path: target, mode });
    else onceGrants.push({ path: target, mode });
  };
  try {
    if (kind === 'buscar-programa') {
      const tools = await detectCad(store.data.settings);
      const id = Object.keys(CAD_TOOLS).find((k) => k.toLowerCase().startsWith(String(attrs.nombre || '').toLowerCase().replace(/\s/g, '')));
      return id ? `${CAD_TOOLS[id].label}: ${tools[id] || 'no está instalado'}` : `Programas del taller: ${Object.entries(tools).map(([k, v]) => `${k}=${v || 'no instalado'}`).join(', ')}`;
    }
    if (kind === 'pedir-acceso') {
      const mode = attrs.modo === 'escribir' ? 'escribir' : 'leer';
      if (!fs.existsSync(attrs.ruta || '')) return `La carpeta ${attrs.ruta} no existe.`;
      await need(attrs.ruta, mode, attrs.motivo);
      return `Permiso concedido para ${mode} en ${attrs.ruta}.`;
    }
    if (kind === 'listar') {
      await need(attrs.ruta, 'leer');
      const entries = fs.readdirSync(attrs.ruta, { withFileTypes: true }).slice(0, 200);
      return entries.map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n') || '(carpeta vacía)';
    }
    if (kind === 'buscar') {
      await need(attrs.ruta, 'leer');
      const found = search(attrs.ruta, attrs.nombre, dataDir);
      return found.length ? found.join('\n') : 'No encontré archivos con ese nombre.';
    }
    if (kind === 'leer') {
      await need(attrs.ruta, 'leer');
      const buf = fs.readFileSync(attrs.ruta);
      if (buf.includes(0)) return `${path.basename(attrs.ruta)} es un archivo binario (${Math.round(buf.length / 1000)} KB); no se puede leer como texto.`;
      const text = buf.toString('utf8');
      return text.length > 20000 ? `${text.slice(0, 20000)}\n[…recortado]` : text;
    }
    if (kind === 'abrir') {
      await need(attrs.ruta, 'leer');
      if (!fs.existsSync(attrs.ruta)) return 'Ese archivo no existe.';
      if (attrs.programa) {
        const tools = await detectCad(store.data.settings);
        const exe = tools[attrs.programa];
        if (!exe) return `${attrs.programa} no está instalado.`;
        return launchApp(exe, [attrs.ruta], path.dirname(attrs.ruta)) ? `Abrí ${path.basename(attrs.ruta)} en ${attrs.programa}.` : 'No pude abrirlo.';
      }
      // Sin programa: solo carpetas o modelos 3D, nunca ejecutables.
      if (fs.statSync(attrs.ruta).isFile() && !/\.(stl|obj|3mf|step|stp|blend|scad|fcstd|gcode|png|jpe?g|pdf|txt|md)$/i.test(attrs.ruta)) return 'Solo abro carpetas, modelos 3D, imágenes o documentos.';
      return openPath(attrs.ruta) ? `Abrí ${attrs.ruta}.` : 'No pude abrirlo.';
    }
    if (kind === 'copiar') {
      await need(attrs.de, 'leer');
      await need(attrs.a, 'escribir');
      if (!fs.statSync(attrs.de).isFile()) return 'Solo copio archivos.';
      const dest = fs.existsSync(attrs.a) && fs.statSync(attrs.a).isDirectory() ? path.join(attrs.a, path.basename(attrs.de)) : attrs.a;
      if (fs.existsSync(dest)) return `Ya existe ${dest}; no lo sobrescribo.`;
      fs.copyFileSync(attrs.de, dest);
      return `Copié ${path.basename(attrs.de)} a ${dest}.`;
    }
  } catch (err) {
    return `Error: ${err.message}`;
  }
  return 'Acción desconocida';
}

/**
 * Llama a un modelo dejando que la IA use acciones de acceso: si su respuesta
 * trae acciones, se ejecutan (con tu permiso) y se le devuelven los resultados
 * para que continúe, hasta 4 rondas.
 */
export async function callWithAccess(store, params) {
  const settings = store.data.settings;
  if (settings.accessEnabled === false) return callModel(settings, params);
  const system = params.system + accessGuide(settings, store.dir);
  const messages = [...params.messages];
  const log = [];
  const onceGrants = [];
  let res;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    res = await callModel(settings, { ...params, system, messages });
    const actions = parseActions(res.text);
    if (!actions.length || res.simulated) break;
    const results = [];
    for (const act of actions) {
      const out = await runAction(store, params.agent, act, onceGrants);
      log.push(`${act.raw.replace(/^<<|>>$/g, '')} → ${out.split('\n')[0].slice(0, 120)}`);
      results.push(`### ${act.raw}\n${out}`);
    }
    if (params.agent) agentStatus(params.agent.id, 'working', 'Revisando lo que encontré…');
    messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: `Resultados de tus acciones:\n\n${results.join('\n\n')}\n\nContinúa con la tarea usando estos resultados.` });
    params.onDelta?.('\n\n');
  }
  if (log.length) res = { ...res, text: `${res.text}\n\n<details><summary>🔐 Accesos usados (${log.length})</summary>\n\n${log.map((l) => `- ${l}`).join('\n')}\n</details>`, accessLog: log };
  return res;
}

/** Carpetas permitidas para leer, para pasárselas a Claude Code o Gemini CLI. */
export function readDirs(settings) {
  return (settings.grants || []).map((g) => g.path).filter((p) => fs.existsSync(p));
}
