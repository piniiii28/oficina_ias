// Videos: las IAs escriben <<video prompt="…" escenas="a | b | c" formato="16:9">>
// y la oficina lo genera con el servicio elegido en Ajustes → Videos:
// - «Video con imágenes» (gratis): genera una imagen por escena y las une con
//   movimiento y transiciones usando FFmpeg (viene incluido con la oficina).
// - Hailuo (MiniMax) y Veo (Gemini): video real con IA, de pago.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { credentials } from './providers.js';
import { generateImage } from './images.js';
import { runLogged } from './system.js';

export const VIDEO_SERVICES = {
  slideshow: { label: 'Video con imágenes (gratis)', tier: 'gratis', hint: 'Genera una imagen por escena con tu servicio de imágenes y las une con movimiento y transiciones. No es animación real, pero es gratis.', keyUrl: '' },
  minimax: { label: 'Hailuo de MiniMax (de pago)', tier: 'pago', hint: 'Video real de 6 segundos (Hailuo 2.3). Usa tu clave de MiniMax; cada video cuesta unos US$0,25–0,50.', keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key', model: 'MiniMax-Hailuo-2.3' },
  veo: { label: 'Veo de Google (de pago)', tier: 'pago', hint: 'Video con sonido (Veo 3.1 Lite, 8 s). Usa tu clave de Gemini con facturación: unos US$0,05 por segundo. Tu suscripción Pro no sirve aquí.', keyUrl: 'https://aistudio.google.com/apikey', model: 'veo-3.1-lite-generate-preview' },
};

export const VIDEO_RE = /<<video\s+prompt="([^"]{3,2000})"(?:\s+escenas="([^"]{3,4000})")?(?:\s+formato="([\d:]+)")?\s*>>/g;
const SIZES = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1080, 1080], '4:5': [864, 1080] };
const SHOTS = ['wide establishing shot', 'medium shot', 'close-up detail shot', 'dramatic low angle shot', 'side view', 'overhead shot'];

export const videosDir = (dataDir) => path.join(dataDir, 'videos');

/** Ruta a FFmpeg: el que trae la oficina (ffmpeg-static) o el del sistema. */
export async function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const m = await import('ffmpeg-static');
    if (m.default && fs.existsSync(m.default)) return m.default;
  } catch {
    /* no viene incluido */
  }
  return 'ffmpeg';
}

export function videoService(settings) {
  const v = settings.video || {};
  const ready = (id) => (id === 'slideshow' ? true : id === 'minimax' ? credentials(settings, 'minimax').length > 0 : id === 'veo' ? credentials(settings, 'google').length > 0 : false);
  return v.service && ready(v.service) ? v.service : 'slideshow';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pollMs = () => Number(process.env.OFICINA_VIDEO_POLL_MS ?? 8000);

async function json(res, what) {
  const t = await res.text();
  let j = {};
  try {
    j = JSON.parse(t);
  } catch {
    /* no era JSON */
  }
  if (!res.ok) throw new Error(`${what}: ${j.error?.message || j.base_resp?.status_msg || t.slice(0, 200) || res.statusText}`);
  return j;
}

/** Une imágenes en un video con zoom suave y fundidos (FFmpeg). */
export async function slideshow(images, outFile, { formato = '16:9', seconds = 3.5, onLog = () => {} } = {}) {
  const [W, H] = SIZES[formato] || SIZES['16:9'];
  const fps = 25;
  const fade = 0.6;
  const frames = Math.round(seconds * fps);
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const img of images) args.push('-i', img);
  const parts = images.map((_, i) => {
    // Zoom lento hacia adentro o hacia afuera, alternando, para que se sienta vivo.
    const z = i % 2 ? `if(eq(on,1),1.18,max(zoom-0.0016,1.0))` : `min(zoom+0.0016,1.18)`;
    return `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${fps},setsar=1,format=yuv420p[v${i}]`;
  });
  let last = 'v0';
  for (let i = 1; i < images.length; i++) {
    const out = i === images.length - 1 ? 'vout' : `x${i}`;
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${(i * (seconds - fade)).toFixed(2)}[${out}]`);
    last = out;
  }
  if (images.length === 1) parts.push('[v0]null[vout]');
  args.push('-filter_complex', parts.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile);
  const r = await runLogged(await ffmpegPath(), args, { onData: onLog, timeoutMs: 5 * 60000 });
  if (!r.ok || !fs.existsSync(outFile)) throw new Error(`FFmpeg no pudo armar el video: ${r.out.trim().slice(-300) || 'error desconocido'}`);
}

async function viaMinimax(settings, prompt) {
  const key = credentials(settings, 'minimax')[0]?.key;
  const base = process.env.MINIMAX_BASE || 'https://api.minimax.io';
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const task = await json(await fetch(`${base}/v1/video_generation`, { method: 'POST', headers, body: JSON.stringify({ model: VIDEO_SERVICES.minimax.model, prompt, duration: 6, resolution: '768P' }) }), 'MiniMax');
  if (!task.task_id) throw new Error(`MiniMax: ${task.base_resp?.status_msg || 'no creó la tarea'}`);
  for (let i = 0; i < 90; i++) {
    await sleep(pollMs());
    const st = await json(await fetch(`${base}/v1/query/video_generation?task_id=${encodeURIComponent(task.task_id)}`, { headers }), 'MiniMax');
    if (st.status === 'Fail') throw new Error(`MiniMax: el video falló (${st.base_resp?.status_msg || 'sin detalle'})`);
    if (st.status === 'Success' && st.file_id) {
      const f = await json(await fetch(`${base}/v1/files/retrieve?file_id=${encodeURIComponent(st.file_id)}`, { headers }), 'MiniMax');
      const url = f.file?.download_url || f.download_url;
      if (!url) throw new Error('MiniMax no dio el enlace del video');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MiniMax: no pude descargar el video (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    }
  }
  throw new Error('MiniMax tardó demasiado en hacer el video');
}

async function viaVeo(settings, prompt, formato) {
  const key = credentials(settings, 'google')[0]?.key;
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
  const op = await json(await fetch(`${base}/v1beta/models/${VIDEO_SERVICES.veo.model}:predictLongRunning`, {
    method: 'POST', headers,
    body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: formato === '9:16' ? '9:16' : '16:9' } }),
  }), 'Veo');
  if (!op.name) throw new Error('Veo no creó la tarea');
  for (let i = 0; i < 90; i++) {
    await sleep(pollMs());
    const st = await json(await fetch(`${base}/v1beta/${op.name}`, { headers }), 'Veo');
    if (st.error) throw new Error(`Veo: ${st.error.message}`);
    if (st.done) {
      const uri = st.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) throw new Error('Veo no devolvió el video (¿el prompt fue bloqueado?)');
      const res = await fetch(uri, { headers: { 'x-goog-api-key': key }, redirect: 'follow' });
      if (!res.ok) throw new Error(`Veo: no pude descargar el video (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    }
  }
  throw new Error('Veo tardó demasiado en hacer el video');
}

/** Genera un video y lo guarda en videos/. Devuelve { file, service }. */
export async function generateVideo(settings, dataDir, { prompt, escenas, formato = '16:9', service } = {}, onLog = () => {}) {
  const id = service || videoService(settings);
  const dir = videosDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = `vid-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}.mp4`;
  const out = path.join(dir, file);
  if (id === 'minimax' || id === 'veo') {
    onLog(`🎬 Pidiendo el video a ${VIDEO_SERVICES[id].label}… (tarda 1 a 5 minutos)\n`);
    fs.writeFileSync(out, id === 'minimax' ? await viaMinimax(settings, prompt) : await viaVeo(settings, prompt, formato));
    return { file, service: id };
  }
  // Gratis: una imagen por escena y FFmpeg las une.
  const scenes = String(escenas || '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 8);
  const list = scenes.length >= 2 ? scenes : SHOTS.slice(0, 4).map((s) => `${prompt}, ${s}`);
  const tmp = fs.mkdtempSync(path.join(dir, '.escenas-'));
  try {
    const imgs = [];
    for (const [i, sc] of list.entries()) {
      onLog(`🖼️ Escena ${i + 1} de ${list.length}…\n`);
      const img = await generateImage(settings, { prompt: sc, formato });
      const f = path.join(tmp, `escena-${i}.${img.ext}`);
      fs.writeFileSync(f, img.buffer);
      imgs.push(f);
    }
    onLog('🎞️ Uniendo las escenas…\n');
    await slideshow(imgs, out, { formato, onLog });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { file, service: 'slideshow' };
}

/** Instrucciones para las IAs. */
export function videoGuide(settings) {
  if (settings.video?.enabled === false) return '';
  const id = videoService(settings);
  const free = id === 'slideshow';
  return `\n\n## Videos\nLa oficina SÍ puede hacer videos (con ${VIDEO_SERVICES[id].label}). Si te piden un video, un clip o una animación, NO digas que no puedes: escribe UNA línea así:\n<<video prompt="descripción del video en inglés" ${free ? 'escenas="escena 1 en inglés | escena 2 | escena 3 | escena 4" ' : ''}formato="16:9">>\n${free ? 'Describe de 3 a 6 escenas (cada una será una imagen; el video las une con movimiento). ' : 'Describe la acción, la cámara y la luz en una sola escena de pocos segundos. '}Formatos: 16:9, 9:16, 1:1. Sin marcas ni personas reales.`;
}

/** Reemplaza el <<video …>> de un texto por el video generado (solo uno por respuesta). */
export async function renderVideos(settings, dataDir, text, { onLog } = {}) {
  const found = [...String(text).matchAll(VIDEO_RE)];
  if (!found.length) return { text, videos: [] };
  let out = text;
  const videos = [];
  for (const [i, m] of found.entries()) {
    if (i > 0) {
      out = out.replace(m[0], '');
      continue;
    }
    try {
      const v = await generateVideo(settings, dataDir, { prompt: m[1], escenas: m[2], formato: m[3] || '16:9' }, onLog);
      videos.push(v);
      out = out.replace(m[0], `[🎬 Video: ${m[1].slice(0, 60).replace(/[[\]]/g, '')}](/api/videos/${v.file})`);
    } catch (err) {
      out = out.replace(m[0], `> ⚠️ No pude hacer el video: ${err.message}. Revisa **Ajustes → 🎬 Videos**.`);
    }
  }
  return { text: out, videos };
}
