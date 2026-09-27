// Lectura de enlaces: si una tarea trae URLs, se descarga el texto de cada
// página (con límites) para que el equipo lo use como adjunto.
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 300_000;

/** true si la IP es local o privada (no se deben leer desde aquí). */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

export function extractUrls(text) {
  return [...new Set((text.match(/https?:\/\/[^\s<>"')\]]+/g) || []).map((u) => u.replace(/[.,;:!?]+$/, '')))].slice(0, 3);
}

/** Convierte HTML en texto legible. */
export function htmlToText(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return { title, text: body };
}

async function checkHost(u) {
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Solo http o https');
  const { address } = await dns.lookup(u.hostname);
  if (isPrivateIp(address)) throw new Error('Por seguridad no leo direcciones locales o privadas');
}

export async function fetchReadable(url, { timeoutMs = 15000 } = {}) {
  let u = new URL(url);
  let res;
  const signal = AbortSignal.timeout(timeoutMs);
  // Sigue hasta 3 redirecciones, revisando cada destino.
  for (let hop = 0; ; hop++) {
    await checkHost(u);
    res = await fetch(u, { redirect: 'manual', signal, headers: { 'User-Agent': 'OficinaDeIAs/1.0 (+lectura de enlaces)', Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' } });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop >= 3) throw new Error('Demasiadas redirecciones');
      u = new URL(loc, u);
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error(`La página respondió ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!/text\/|json|xml/.test(type)) throw new Error(`Tipo de contenido no legible (${type || 'desconocido'})`);
  const reader = res.body.getReader();
  let size = 0;
  const chunks = [];
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const raw = Buffer.concat(chunks).toString('utf8');
  const { title, text } = /html/.test(type) ? htmlToText(raw) : { title: '', text: raw };
  return { name: `${title || u.hostname} (${u.hostname})`, content: `Fuente: ${url}\n\n${text.slice(0, 60000)}` };
}

/** Lee las URLs de una tarea; los errores se devuelven como notas breves. */
export async function readLinks(prompt) {
  const urls = extractUrls(prompt);
  const out = [];
  for (const url of urls) {
    try {
      out.push(await fetchReadable(url));
    } catch (err) {
      out.push({ name: `No se pudo leer ${url}`, content: `No se pudo leer ${url}: ${err.message}` });
    }
  }
  return out;
}
