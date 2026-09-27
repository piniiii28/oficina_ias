// Imágenes: las IAs escriben <<imagen prompt="…" formato="16:9">> y la oficina
// la genera con el servicio que elijas en Ajustes → Imágenes, la guarda en
// tu carpeta de datos (imagenes/) y la pone en la respuesta.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { credentials } from './providers.js';

// Servicios de imágenes. Pollinations funciona sin clave (calidad básica);
// Cloudflare y Hugging Face dan cupo gratis con FLUX; Gemini es de pago.
export const IMAGE_SERVICES = {
  cloudflare: { label: 'Cloudflare Workers AI (FLUX, gratis)', tier: 'gratis', hint: '10.000 unidades gratis al día: unas decenas de imágenes FLUX. Necesita tu Account ID y un token de API con permiso «Workers AI».', keyUrl: 'https://dash.cloudflare.com/profile/api-tokens', model: '@cf/black-forest-labs/flux-1-schnell' },
  huggingface: { label: 'Hugging Face (FLUX, créditos gratis)', tier: 'gratis', hint: 'Usa tu clave de Hugging Face (la misma de «Conectar las IAs»). Los créditos gratis del mes alcanzan para pocas imágenes.', keyUrl: 'https://huggingface.co/settings/tokens', model: 'black-forest-labs/FLUX.1-schnell' },
  pollinations: { label: 'Pollinations (sin clave)', tier: 'gratis', hint: 'Funciona sin cuenta, pero la calidad es básica. Con una clave de enter.pollinations.ai hay mejores modelos.', keyUrl: 'https://enter.pollinations.ai', model: 'flux' },
  google: { label: 'Gemini (imagen, de pago)', tier: 'pago', hint: 'La mejor calidad para productos y texto, pero no tiene plan gratis: usa tu clave de Gemini con facturación.', keyUrl: 'https://aistudio.google.com/apikey', model: 'gemini-3.1-flash-image' },
};

const SIZES = { '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1152, 864], '3:4': [864, 1152], '3:2': [1216, 832], '4:5': [896, 1120] };
export const IMAGE_RE = /<<imagen\s+prompt="([^"]{3,2000})"(?:\s+formato="([\d:]+)")?\s*>>/g;
const MAX_PER_ANSWER = 3;

export const imagesDir = (dataDir) => path.join(dataDir, 'imagenes');

/** Qué servicio se usa: el elegido, si está configurado; si no, el primero que lo esté. */
export function imageService(settings) {
  const s = settings.images || {};
  const ready = (id) => {
    if (id === 'pollinations') return true;
    if (id === 'cloudflare') return Boolean(s.cloudflareAccount && s.cloudflareToken);
    if (id === 'huggingface') return credentials(settings, 'huggingface').length > 0;
    if (id === 'google') return credentials(settings, 'google').length > 0 && s.service === 'google';
    return false;
  };
  if (s.service && ready(s.service)) return s.service;
  return ['cloudflare', 'huggingface', 'pollinations'].find(ready);
}

async function asBuffer(res, what) {
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = t.slice(0, 300);
    try {
      const j = JSON.parse(t);
      msg = j.errors?.[0]?.message || j.error?.message || j.error || msg;
    } catch {
      /* no era JSON */
    }
    throw new Error(`${what}: ${msg || res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Genera una imagen y devuelve { buffer, ext, service }. */
export async function generateImage(settings, { prompt, formato = '1:1', service } = {}) {
  const id = service || imageService(settings);
  const [width, height] = SIZES[formato] || SIZES['1:1'];
  const s = settings.images || {};
  const signal = AbortSignal.timeout(180000);
  if (id === 'cloudflare') {
    const base = process.env.CLOUDFLARE_AI_BASE || 'https://api.cloudflare.com';
    const res = await fetch(`${base}/client/v4/accounts/${encodeURIComponent(s.cloudflareAccount)}/ai/run/${IMAGE_SERVICES.cloudflare.model}`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${s.cloudflareToken}`, 'Content-Type': 'application/json' },
      // FLUX schnell de Cloudflare solo acepta prompt y steps (hace imágenes de 1024×1024).
      body: JSON.stringify({ prompt, steps: 8 }),
    });
    const data = JSON.parse((await asBuffer(res, 'Cloudflare')).toString());
    const b64 = data.result?.image;
    if (!b64) throw new Error('Cloudflare no devolvió la imagen');
    return { buffer: Buffer.from(b64, 'base64'), ext: 'jpg', service: id };
  }
  if (id === 'huggingface') {
    const key = credentials(settings, 'huggingface')[0]?.key;
    const base = process.env.HF_IMAGE_BASE || 'https://router.huggingface.co/hf-inference/models';
    const res = await fetch(`${base}/${IMAGE_SERVICES.huggingface.model}`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'image/png' },
      body: JSON.stringify({ inputs: prompt, parameters: { width, height } }),
    });
    return { buffer: await asBuffer(res, 'Hugging Face'), ext: 'png', service: id };
  }
  if (id === 'google') {
    const key = credentials(settings, 'google')[0]?.key;
    const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
    const res = await fetch(`${base}/v1beta/models/${IMAGE_SERVICES.google.model}:generateContent`, {
      method: 'POST', signal,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: formato } } }),
    });
    const data = JSON.parse((await asBuffer(res, 'Gemini')).toString());
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part) throw new Error('Gemini no devolvió la imagen (¿tu clave tiene facturación?)');
    return { buffer: Buffer.from(part.inlineData.data, 'base64'), ext: part.inlineData.mimeType?.includes('png') ? 'png' : 'jpg', service: id };
  }
  // Pollinations: sin clave funciona con el modelo básico.
  const base = process.env.POLLINATIONS_BASE || 'https://image.pollinations.ai';
  const q = new URLSearchParams({ width: String(width), height: String(height), nologo: 'true', seed: String(Math.floor(Math.random() * 1e9)), ...(s.pollinationsKey ? { model: IMAGE_SERVICES.pollinations.model } : {}) });
  const res = await fetch(`${base}/prompt/${encodeURIComponent(prompt)}?${q}`, { signal, headers: s.pollinationsKey ? { Authorization: `Bearer ${s.pollinationsKey}` } : {} });
  return { buffer: await asBuffer(res, 'Pollinations'), ext: 'jpg', service: 'pollinations' };
}

/** Guarda la imagen en la carpeta de datos y devuelve su nombre de archivo. */
export function saveImage(dataDir, { buffer, ext }) {
  const dir = imagesDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = `img-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return name;
}

/** Instrucciones para las IAs (se agregan a su sistema). */
export function imageGuide(settings) {
  const id = imageService(settings);
  if (!id || settings.images?.enabled === false) return '';
  return `\n\n## Imágenes\nLa oficina SÍ puede generar imágenes (con ${IMAGE_SERVICES[id].label}). Si te piden una imagen, un dibujo, un logo o una foto, NO digas que no puedes: escribe una línea así (máximo ${MAX_PER_ANSWER} por respuesta):\n<<imagen prompt="descripción detallada en inglés: sujeto, estilo, luz, encuadre" formato="16:9">>\nFormatos: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 4:5. La oficina la genera y la pone en tu respuesta. No uses nombres de marcas ni personas reales en el prompt: describe la forma.`;
}

/** Reemplaza cada <<imagen …>> de un texto por la imagen generada. */
export async function renderImages(settings, dataDir, text, { onImage } = {}) {
  const found = [...String(text).matchAll(IMAGE_RE)];
  if (!found.length) return { text, images: [] };
  const images = [];
  let out = text;
  for (const [i, m] of found.entries()) {
    if (i >= MAX_PER_ANSWER) {
      out = out.replace(m[0], '');
      continue;
    }
    const prompt = m[1].trim();
    try {
      const img = await generateImage(settings, { prompt, formato: m[2] });
      const file = saveImage(dataDir, img);
      images.push({ file, prompt, service: img.service });
      onImage?.(file);
      out = out.replace(m[0], `![${prompt.slice(0, 80).replace(/[[\]]/g, '')}](/api/images/${file})`);
    } catch (err) {
      out = out.replace(m[0], `> ⚠️ No pude generar la imagen: ${err.message}. Revisa **Ajustes → 🎨 Imágenes**.`);
    }
  }
  return { text: out, images };
}
