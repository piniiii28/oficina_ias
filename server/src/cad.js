// Taller de Impresión 3D: detecta Blender, OpenSCAD, FreeCAD y los
// laminadores instalados, y ejecuta en ellos los scripts que escriben las IAs.
// Cada ejecución queda en data/taller3d/<fecha>-<nombre>/ con el script, el
// STL y el archivo del programa para abrirlo con su interfaz.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runLogged, launchApp } from './system.js';

const win = process.platform === 'win32';
const mac = process.platform === 'darwin';

export const CAD_TOOLS = {
  blender: {
    label: 'Blender', url: 'https://www.blender.org/download/', bins: ['blender'],
    win: ['C:/Program Files/Blender Foundation/*/blender.exe'], mac: ['/Applications/Blender.app/Contents/MacOS/Blender'],
  },
  openscad: {
    label: 'OpenSCAD', url: 'https://openscad.org/downloads.html', bins: ['openscad'],
    win: ['C:/Program Files/OpenSCAD/openscad.exe', 'C:/Program Files/OpenSCAD (Nightly)/openscad.exe'], mac: ['/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'],
  },
  freecad: {
    label: 'FreeCAD (consola)', url: 'https://www.freecad.org/downloads.php', bins: ['freecadcmd', 'FreeCADCmd'],
    win: ['C:/Program Files/FreeCAD */bin/freecadcmd.exe', 'C:/Program Files/FreeCAD */bin/FreeCADCmd.exe'], mac: ['/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd'],
  },
  freecadGui: {
    label: 'FreeCAD (interfaz)', url: 'https://www.freecad.org/downloads.php', bins: ['freecad', 'FreeCAD'],
    win: ['C:/Program Files/FreeCAD */bin/freecad.exe', 'C:/Program Files/FreeCAD */bin/FreeCAD.exe'], mac: ['/Applications/FreeCAD.app/Contents/MacOS/FreeCAD'],
  },
  prusaslicer: {
    label: 'PrusaSlicer', url: 'https://www.prusa3d.com/page/prusaslicer_424/', bins: ['prusa-slicer', 'prusa-slicer-console'],
    win: ['C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe'], mac: ['/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer'],
  },
  orcaslicer: {
    label: 'OrcaSlicer', url: 'https://github.com/SoftFever/OrcaSlicer/releases', bins: ['orca-slicer'],
    win: ['C:/Program Files/OrcaSlicer/orca-slicer.exe'], mac: ['/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer'],
  },
};

/** Expande un patrón con un "*" en un solo nivel de carpeta (p. ej. "Blender 4.2"). */
function expand(pattern) {
  const parts = pattern.split('/');
  const star = parts.findIndex((p) => p.includes('*'));
  if (star === -1) return fs.existsSync(pattern) ? [pattern] : [];
  const parent = parts.slice(0, star).join('/') || '/';
  const re = new RegExp(`^${parts[star].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace('*', '.*')}$`, 'i');
  let names = [];
  try {
    names = fs.readdirSync(parent).filter((n) => re.test(n)).sort().reverse(); // la versión más nueva primero
  } catch {
    return [];
  }
  return names.flatMap((n) => expand([parent, n, ...parts.slice(star + 1)].join('/')));
}

function which(bin) {
  return new Promise((resolve) => {
    execFile(win ? 'where' : 'which', [bin], { timeout: 4000 }, (err, out) => resolve(err ? null : out.toString().split(/\r?\n/)[0].trim() || null));
  });
}

/** Programas 3D instalados: { blender: ruta | null, … }. Las rutas de Ajustes tienen prioridad. */
export async function detectCad(settings = {}) {
  const out = {};
  await Promise.all(Object.entries(CAD_TOOLS).map(async ([id, t]) => {
    const custom = settings.cadPaths?.[id];
    if (custom && fs.existsSync(custom)) return (out[id] = custom);
    for (const b of t.bins) {
      const p = await which(b);
      if (p) return (out[id] = p);
    }
    const guesses = (win ? t.win : mac ? t.mac : []).flatMap(expand);
    out[id] = guesses[0] || null;
  }));
  return out;
}

/** ¿Qué programa ejecuta este bloque de código? */
export function cadKind(lang = '', code = '') {
  const l = lang.toLowerCase();
  if (l === 'openscad' || l === 'scad') return 'openscad';
  if (/^\s*(import bpy|from bpy)/m.test(code)) return 'blender';
  if (/^\s*(import FreeCAD|from FreeCAD|import Part\b|import FreeCADGui)/m.test(code)) return 'freecad';
  if (!l && /\b(cube|cylinder|sphere)\s*\(/.test(code) && /;\s*$/m.test(code)) return 'openscad';
  return null;
}

/** Bloques de código 3D dentro de un texto Markdown. */
export function extractCadBlocks(markdown) {
  const out = [];
  for (const m of String(markdown).matchAll(/```([\w-]*)[^\n]*\n([\s\S]*?)```/g)) {
    const kind = cadKind(m[1], m[2]);
    if (kind) out.push({ kind, lang: m[1], code: m[2] });
  }
  return out;
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\d]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'modelo';
const stamp = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

/** Script de Python con la carpeta de salida definida y, al final, guardado y STL automáticos. */
export function wrapPython(kind, code, dir) {
  const head = `# Preparado por la Oficina de IAs\nimport os\nOUT_DIR = ${JSON.stringify(dir)}\nos.makedirs(OUT_DIR, exist_ok=True)\n\n`;
  const tail = kind === 'blender'
    ? `

# --- Añadido por la oficina: guarda el .blend y exporta un STL si el script no lo hizo ---
import glob as _glob
import bpy as _bpy
try:
    _bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "modelo.blend"))
except Exception as _e:
    print("No pude guardar el .blend:", _e)
if not _glob.glob(os.path.join(OUT_DIR, "*.stl")):
    _stl = os.path.join(OUT_DIR, "modelo.stl")
    try:
        _bpy.ops.object.select_all(action="SELECT")
        if hasattr(_bpy.ops.wm, "stl_export"):
            _bpy.ops.wm.stl_export(filepath=_stl)
        else:
            _bpy.ops.export_mesh.stl(filepath=_stl)
    except Exception as _e:
        print("No pude exportar el STL:", _e)
`
    : `

# --- Añadido por la oficina: exporta un STL y guarda el proyecto si el script no lo hizo ---
import glob as _glob
try:
    import FreeCAD as _F
    import Mesh as _M
    _doc = _F.ActiveDocument
    if _doc:
        _doc.recompute()
        if not _glob.glob(os.path.join(OUT_DIR, "*.stl")):
            _objs = [o for o in _doc.Objects if hasattr(o, "Shape") and not o.Shape.isNull()]
            if _objs:
                _M.export(_objs, os.path.join(OUT_DIR, "modelo.stl"))
        _doc.saveAs(os.path.join(OUT_DIR, "modelo.FCStd"))
except Exception as _e:
    print("No pude exportar:", _e)
`;
  return head + code + tail;
}

const listFiles = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
  } catch {
    return [];
  }
};

/**
 * Ejecuta un modelo 3D. Siempre corre primero sin interfaz (para obtener el
 * STL); si `gui` es true, luego abre el resultado en el programa.
 * onLog(texto) recibe la salida en vivo.
 */
export async function runCad({ settings, dataDir, kind, code, name = 'modelo', gui = false, onLog = () => {} }) {
  if (!['blender', 'openscad', 'freecad'].includes(kind)) throw new Error('Tipo de modelo desconocido');
  const tools = await detectCad(settings);
  const exe = tools[kind];
  const dir = path.join(dataDir, 'taller3d', `${stamp()}-${slug(name)}`);
  fs.mkdirSync(dir, { recursive: true });
  const job = { kind, name, dir, ok: false, log: '', files: [], opened: false };
  if (!exe) {
    job.log = `No encontré ${CAD_TOOLS[kind].label} en este computador. Instálalo desde ${CAD_TOOLS[kind].url} o escribe su ruta en Ajustes → Taller 3D.`;
    fs.writeFileSync(path.join(dir, kind === 'openscad' ? 'modelo.scad' : 'script.py'), kind === 'openscad' ? code : wrapPython(kind, code, dir));
    job.files = listFiles(dir);
    return job;
  }
  let log = '';
  const push = (t) => {
    log += t;
    onLog(t);
  };
  let result;
  let project;
  if (kind === 'openscad') {
    const scad = path.join(dir, 'modelo.scad');
    fs.writeFileSync(scad, code);
    project = scad;
    push(`▶ ${CAD_TOOLS.openscad.label}: exportando STL…\n`);
    result = await runLogged(exe, ['-o', path.join(dir, 'modelo.stl'), scad], { onData: push, cwd: dir, timeoutMs: 10 * 60000 });
  } else {
    const script = path.join(dir, 'script.py');
    fs.writeFileSync(script, wrapPython(kind, code, dir));
    push(`▶ ${CAD_TOOLS[kind].label}: ejecutando el script…\n`);
    const args = kind === 'blender' ? ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script] : [script];
    result = await runLogged(exe, args, { onData: push, cwd: dir, timeoutMs: 10 * 60000 });
    project = path.join(dir, kind === 'blender' ? 'modelo.blend' : 'modelo.FCStd');
  }
  job.files = listFiles(dir);
  const hasStl = job.files.some((f) => f.name.toLowerCase().endsWith('.stl'));
  job.ok = result.ok && hasStl;
  push(job.ok ? '\n✅ Modelo listo.\n' : `\n⚠️ ${result.ok ? 'El programa terminó pero no generó ningún STL.' : `El programa terminó con errores (código ${result.code}).`}\n`);
  if (gui && fs.existsSync(project)) {
    const guiExe = kind === 'freecad' ? tools.freecadGui : exe;
    job.opened = Boolean(guiExe) && launchApp(guiExe, [project], dir);
  }
  job.log = log.slice(-6000);
  return job;
}

/** Abre el proyecto de un trabajo anterior en su programa. */
export async function openInApp(settings, job) {
  const tools = await detectCad(settings);
  const file = { blender: 'modelo.blend', openscad: 'modelo.scad', freecad: 'modelo.FCStd' }[job.kind];
  const target = path.join(job.dir, file);
  const exe = job.kind === 'freecad' ? tools.freecadGui : tools[job.kind];
  if (!exe || !fs.existsSync(target)) return false;
  return launchApp(exe, [target], job.dir);
}

/** Lamina el STL con PrusaSlicer u OrcaSlicer (si están instalados) y guarda el G-code. */
export async function sliceJob(settings, job, onLog = () => {}) {
  const tools = await detectCad(settings);
  const stl = listFiles(job.dir).find((f) => f.name.toLowerCase().endsWith('.stl'));
  if (!stl) throw new Error('Este trabajo no tiene un STL para laminar');
  const exe = tools.prusaslicer || tools.orcaslicer;
  if (!exe) throw new Error('No encontré PrusaSlicer ni OrcaSlicer. Instala uno o abre el STL en tu laminador.');
  const out = path.join(job.dir, stl.name.replace(/\.stl$/i, '.gcode'));
  const args = exe === tools.prusaslicer ? ['--export-gcode', '--output', out, path.join(job.dir, stl.name)] : ['--slice', '0', '--outputdir', job.dir, path.join(job.dir, stl.name)];
  const r = await runLogged(exe, args, { onData: onLog, cwd: job.dir, timeoutMs: 10 * 60000 });
  return { ok: r.ok, log: r.out.slice(-4000), files: listFiles(job.dir) };
}

export { listFiles };
