// Modelos 3D con IA: TRELLIS (de Microsoft, en NVIDIA) convierte una
// descripción o una imagen en un modelo 3D y lo devuelve en STL, listo para
// laminar e imprimir. El resultado queda como un trabajo más del Taller 3D.
import fs from 'node:fs';
import path from 'node:path';
import { credentials } from './providers.js';
import { listFiles } from './cad.js';

export const TRELLIS_RE = /<<modelo3d\s+prompt="([^"]{3,1500})"\s*>>/g;

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'modelo';

export const trellisReady = (settings) => credentials(settings, 'nvidia').length > 0;

/**
 * Genera el modelo. Con `image` (Buffer, PNG o JPG) usa la imagen; si no, el texto.
 * Devuelve un trabajo del Taller: { kind: 'trellis', name, dir, ok, log, files }.
 */
export async function generate3d(settings, dataDir, { prompt = '', image = null, name = 'modelo' } = {}, onLog = () => {}) {
  const key = credentials(settings, 'nvidia')[0]?.key;
  if (!key) throw new Error('TRELLIS necesita tu clave de NVIDIA (Ajustes → Conectar las IAs → NVIDIA NIM)');
  const dir = path.join(dataDir, 'taller3d', `${stamp()}-${slug(name)}`);
  fs.mkdirSync(dir, { recursive: true });
  const body = { output_format: 'stl', seed: Math.floor(Math.random() * 1e6) };
  if (image) {
    const png = image[0] === 0x89;
    fs.writeFileSync(path.join(dir, png ? 'imagen.png' : 'imagen.jpg'), image);
    Object.assign(body, { mode: 'image', image: `data:image/${png ? 'png' : 'jpeg'};base64,${image.toString('base64')}` });
  } else {
    if (String(prompt).trim().length < 3) throw new Error('Describe el objeto que quieres en 3D');
    Object.assign(body, { mode: 'text', prompt: String(prompt).slice(0, 1500) });
  }
  onLog(`🧊 TRELLIS está creando el modelo 3D${image ? ' a partir de la imagen' : ''}… (tarda cerca de un minuto)\n`);
  const base = process.env.NVIDIA_GENAI_BASE || 'https://ai.api.nvidia.com';
  const res = await fetch(`${base}/v1/genai/microsoft/trellis`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60000),
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* no era JSON */
  }
  if (!res.ok) throw new Error(`TRELLIS: ${data.detail || data.error?.message || data.title || text.slice(0, 200) || res.statusText}`);
  const b64 = data.artifacts?.[0]?.base64;
  if (!b64) throw new Error(`TRELLIS no devolvió el modelo (${data.artifacts?.[0]?.finishReason || 'sin detalle'})`);
  fs.writeFileSync(path.join(dir, 'modelo.stl'), Buffer.from(b64, 'base64'));
  if (prompt) fs.writeFileSync(path.join(dir, 'descripcion.txt'), prompt);
  onLog('✅ Modelo 3D listo (modelo.stl).\n');
  return { kind: 'trellis', name, dir, ok: true, log: `TRELLIS (${image ? 'desde imagen' : 'desde texto'}): ${prompt}`.slice(0, 600), files: listFiles(dir), opened: false, code: prompt };
}

/** Instrucciones para las IAs del Taller (y cualquiera que haga objetos). */
export function trellisGuide(settings) {
  if (!trellisReady(settings)) return '';
  return '\n\n## Modelos 3D con IA\nPara objetos orgánicos o decorativos (figuras, personajes, animales, esculturas) que serían difíciles en código, la oficina puede generar el modelo 3D con IA (TRELLIS). Escribe una línea así (máximo una por respuesta):\n<<modelo3d prompt="descripción del objeto en inglés: forma, estilo, detalles; un solo objeto, sin fondo">>\nEl STL queda en el Taller 3D, listo para laminar. Para piezas mecánicas con medidas exactas sigue usando OpenSCAD o FreeCAD.';
}

/** Reemplaza el <<modelo3d …>> de una respuesta por el modelo generado (lo guarda en el Taller). */
export async function renderModels(store, text, onLog) {
  const found = [...String(text).matchAll(TRELLIS_RE)];
  if (!found.length) return { text, jobs: [] };
  let out = text;
  const jobs = [];
  for (const [i, m] of found.entries()) {
    if (i > 0) {
      out = out.replace(m[0], '');
      continue;
    }
    try {
      const job = await generate3d(store.data.settings, store.dir, { prompt: m[1], name: m[1].split(/[,.]/)[0] }, onLog);
      const record = { id: `j_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...job, taskId: null, createdAt: new Date().toISOString() };
      (store.data.cadJobs ||= []).unshift(record);
      if (store.data.cadJobs.length > 60) store.data.cadJobs.length = 60;
      store.save();
      jobs.push(record);
      out = out.replace(m[0], `> 🧊 **Modelo 3D listo** («${m[1].slice(0, 60)}»): está en **Taller 3D**, con vista previa, para abrir en Bambu Studio o laminar.`);
    } catch (err) {
      out = out.replace(m[0], `> ⚠️ No pude crear el modelo 3D: ${err.message}`);
    }
  }
  return { text: out, jobs };
}
