// Guardar como PDF: arma una versión para imprimir (portada, índice, títulos,
// tablas e imágenes) y abre el diálogo del navegador, donde eliges
// «Guardar como PDF». No necesita instalar nada.
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** HTML listo para imprimir (se exporta para poder probarlo). */
export function printableHtml(title: string, markdown: string, subtitle = '') {
  // [[enlaces]] → texto; los #tags se dejan como texto; los videos no van en un PDF.
  const md = markdown
    .replace(/\[\[([^\]|#]+)(?:[#|]([^\]]*))?\]\]/g, (_m, t: string, alias?: string) => (alias || t).trim())
    .replace(/\[🎬 Video:[^\]]*\]\([^)]*\)/g, '_(video: míralo en la oficina)_');
  const body = DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
  // Índice con los títulos de nivel 2.
  const heads = [...body.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  const toc = heads.length >= 3 ? `<nav class="toc"><h2>Contenido</h2><ol>${heads.map((h) => `<li>${h}</li>`).join('')}</ol></nav>` : '';
  const date = new Date().toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><base href="${location.origin}/">
<style>
@page { size: A4; margin: 18mm 16mm 20mm; }
body { font: 11pt/1.55 Georgia, 'Times New Roman', serif; color: #1f2937; margin: 0; }
.cover { height: 92vh; display: flex; flex-direction: column; justify-content: center; border-left: 6px solid #7c3aed; padding-left: 24px; page-break-after: always; }
.cover h1 { font: 700 30pt/1.15 system-ui, sans-serif; margin: 0 0 12px; color: #111827; }
.cover p { font: 12pt system-ui, sans-serif; color: #6b7280; margin: 4px 0; }
.toc { page-break-after: always; } .toc li { margin: 4px 0; }
h1, h2, h3, h4 { font-family: system-ui, sans-serif; color: #111827; page-break-after: avoid; }
h2 { border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-top: 28px; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font: 9.5pt system-ui, sans-serif; page-break-inside: avoid; }
th, td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #f3f4f6; }
img { max-width: 100%; border-radius: 6px; page-break-inside: avoid; }
pre { background: #f6f8fa; padding: 10px; border-radius: 6px; font-size: 8.5pt; white-space: pre-wrap; page-break-inside: avoid; }
code { font-family: Consolas, monospace; }
blockquote { border-left: 3px solid #c4b5fd; margin: 10px 0; padding: 2px 14px; color: #4b5563; }
details { display: none; }
footer { position: fixed; bottom: 0; left: 0; right: 0; font: 8pt system-ui, sans-serif; color: #9ca3af; text-align: center; }
</style></head><body>
<section class="cover"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}<p>${esc(date)}</p><p>Oficina de IAs</p></section>
${toc}<main>${body}</main><footer>${esc(title)} · Oficina de IAs</footer>
<script>window.onload = () => { const imgs = [...document.images]; Promise.all(imgs.map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 150)); };</script>
</body></html>`;
}

/** Abre la versión para imprimir; en el diálogo elige «Guardar como PDF». */
export function saveAsPdf(title: string, markdown: string, subtitle = '') {
  const w = window.open('', '_blank');
  if (!w) {
    alert('El navegador bloqueó la ventana: permite las ventanas emergentes para esta página.');
    return;
  }
  w.document.open();
  w.document.write(printableHtml(title, markdown, subtitle));
  w.document.close();
}
