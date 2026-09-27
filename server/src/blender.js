// Blender en vivo: la oficina habla con el complemento «Oficina de IAs»
// instalado en Blender (server/addons/oficina_ias.py) para ver la escena,
// ejecutar pasos de modelado, tomar capturas y guardar, sobre el Blender que
// tienes abierto.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectCad } from './cad.js';
import { runLogged } from './system.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ADDON = path.join(here, '..', 'addons', 'oficina_ias.py');
export const BLENDER_PORT = Number(process.env.OFICINA_BLENDER_PORT || 9877);

/** Clave secreta que comparten la oficina y el complemento (se crea una vez). */
export function blenderToken(store) {
  const s = store.data.settings;
  if (!s.blenderToken) {
    s.blenderToken = crypto.randomBytes(18).toString('hex');
    store.save();
  }
  return s.blenderToken;
}

/** El complemento con la clave y el puerto de esta oficina. */
export function addonSource(store) {
  return fs.readFileSync(ADDON, 'utf8').replace('__TOKEN__', blenderToken(store)).replace('__PORT__', String(BLENDER_PORT));
}

/** Envía una orden a Blender y devuelve su respuesta. */
export function blenderCall(store, cmd, extra = {}, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port: BLENDER_PORT });
    let buf = '';
    const fail = (msg) => {
      sock.destroy();
      reject(new Error(msg));
    };
    sock.setTimeout(timeoutMs, () => fail('Blender no respondió a tiempo'));
    sock.on('connect', () => sock.write(`${JSON.stringify({ ...extra, cmd, token: blenderToken(store) })}\n`));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      if (buf.endsWith('\n')) {
        sock.end();
        try {
          resolve(JSON.parse(buf));
        } catch {
          reject(new Error('Respuesta rara de Blender'));
        }
      }
    });
    sock.on('error', (e) => fail(e.code === 'ECONNREFUSED' ? 'Blender no está abierto o el complemento «Oficina de IAs» no está activo' : e.message));
  });
}

/** ¿Hay un Blender abierto con el complemento? (rápido: 1,5 s como máximo) */
export async function blenderStatus(store) {
  try {
    const r = await blenderCall(store, 'ping', {}, 1500);
    return r.ok ? { connected: true, version: r.version, archivo: r.archivo } : { connected: false, error: r.error };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

/** Resumen de la escena en texto, para que la IA sepa cómo va. */
export function sceneText(scene) {
  if (!scene?.ok) return `No pude leer la escena: ${scene?.error || 'sin respuesta'}`;
  const objs = scene.objetos || [];
  return [
    `Archivo: ${scene.archivo} · unidades: ${scene.unidades} (escala ${scene.escala_unidades}) · ${objs.length} objetos · activo: ${scene.activo || '—'}`,
    ...objs.slice(0, 60).map((o) => `- ${o.nombre} (${o.tipo}) en [${o.ubicacion.join(', ')}], medidas [${o.dimensiones.join(', ')}]${o.caras !== undefined ? `, ${o.caras} caras` : ''}${o.modificadores.length ? `, modificadores: ${o.modificadores.join(', ')}` : ''}${o.materiales.length ? `, materiales: ${o.materiales.join(', ')}` : ''}`),
    objs.length > 60 ? `… y ${objs.length - 60} más` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Instala el complemento en tu Blender: lo copia a su carpeta de complementos,
 * lo activa y guarda tus preferencias. Si Blender estaba abierto, hay que
 * cerrarlo y volver a abrirlo.
 */
export async function installAddon(store, onLog = () => {}) {
  const exe = (await detectCad(store.data.settings)).blender;
  if (!exe) throw new Error('No encontré Blender. Instálalo desde blender.org o escribe su ruta en Ajustes → Taller 3D.');
  const src = path.join(store.dir, 'oficina_ias.py');
  fs.writeFileSync(src, addonSource(store));
  const code = [
    'import bpy, os, shutil, addon_utils',
    "d = bpy.utils.user_resource('SCRIPTS', path='addons', create=True)",
    `shutil.copy(${JSON.stringify(src)}, os.path.join(d, 'oficina_ias.py'))`,
    'addon_utils.modules(refresh=True)',
    "bpy.ops.preferences.addon_enable(module='oficina_ias')",
    'bpy.ops.wm.save_userpref()',
    "print('OFICINA_LISTO:' + d)",
  ].join('\n');
  onLog(`▶ ${exe}\n`);
  const r = await runLogged(exe, ['--background', '--python-expr', code], { onData: onLog, timeoutMs: 5 * 60000 });
  const ok = /OFICINA_LISTO:/.test(r.out);
  return { ok, folder: r.out.match(/OFICINA_LISTO:(.*)/)?.[1]?.trim() || null, log: r.out.slice(-3000) };
}
