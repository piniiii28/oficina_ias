// Dónde viven tus datos: por defecto en Documentos/Oficina de IAs, fuera de la
// carpeta del programa, para que actualizar o reinstalar nunca los toque.
// La ruta elegida se guarda en oficina-datos.json (junto al programa).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultDataDir() {
  const docs = path.join(os.homedir(), 'Documents');
  return path.join(fs.existsSync(docs) ? docs : os.homedir(), 'Oficina de IAs');
}

const pointerOf = (root) => path.join(root, 'oficina-datos.json');

/**
 * Carpeta de datos para esta instalación. La primera vez mueve (copia) los
 * datos de la carpeta vieja `data/` a Documentos y deja una nota allí.
 */
export function resolveDataDir(root, { env = process.env, fallback = defaultDataDir() } = {}) {
  if (env.OFICINA_DATA) return env.OFICINA_DATA;
  try {
    const dir = JSON.parse(fs.readFileSync(pointerOf(root), 'utf8')).dir;
    if (dir) return dir;
  } catch {
    /* todavía no hay puntero */
  }
  const old = path.join(root, 'data');
  const target = fallback;
  if (fs.existsSync(path.join(old, 'oficina.json')) && !fs.existsSync(path.join(target, 'oficina.json'))) {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(old, target, { recursive: true });
    fs.writeFileSync(path.join(old, 'MOVIDO.txt'), `Tus datos ahora están en:\n${target}\n\nEsta carpeta es una copia vieja; puedes borrarla cuando quieras.\n`);
    console.log(`  📦 Moví tus datos a ${target}`);
  }
  fs.mkdirSync(target, { recursive: true });
  setDataDir(root, target);
  return target;
}

export function setDataDir(root, dir) {
  fs.writeFileSync(pointerOf(root), JSON.stringify({ dir }, null, 2));
}

/** Copia todos los datos a otra carpeta (para cambiar de ubicación). */
export function moveDataTo(current, dir) {
  if (!path.isAbsolute(dir)) throw new Error('Escribe la ruta completa de la carpeta');
  if (path.resolve(dir) === path.resolve(current)) throw new Error('Ya es la carpeta actual');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(path.join(dir, 'oficina.json'))) throw new Error('Esa carpeta ya tiene datos de otra oficina');
  fs.cpSync(current, dir, { recursive: true });
}
