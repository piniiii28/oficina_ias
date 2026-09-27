// Renderiza Markdown con soporte para [[enlaces]] y #etiquetas. Los bloques
// de código de Blender, OpenSCAD o FreeCAD traen botones para crear el modelo
// en el Taller 3D.
import { useMemo, useState } from 'react';
import { marked, type Token } from 'marked';
import DOMPurify from 'dompurify';
import { api, cadKind, type CadKind } from '../api';
import { useOffice } from '../state';

marked.setOptions({ gfm: true, breaks: true });

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const APP: Record<CadKind, string> = { blender: 'Blender', openscad: 'OpenSCAD', freecad: 'FreeCAD' };

export function Markdown({ text, onLink, onToggle, cadName }: { text: string; onLink?: (title: string) => void; onToggle?: (index: number) => void; cadName?: string }) {
  const { toast, setView } = useOffice();
  const [busy, setBusy] = useState(false);
  const { html, blocks } = useMemo(() => {
    const withLinks = text.replace(/\[\[([^\]|#]+)(?:[#|]([^\]]*))?\]\]/g, (_m, title: string, alias?: string) => {
      const t = escapeHtml(title.trim());
      return `<a class="wikilink" href="#" data-title="${t}">${escapeHtml((alias || title).trim())}</a>`;
    });
    const withTags = withLinks.replace(/(^|\s)#([\p{L}\d_\-/]+)/gu, '$1<span class="tag">#$2</span>');
    let html = DOMPurify.sanitize(marked.parse(withTags, { async: false }) as string, { ADD_ATTR: ['data-title'] });
    // Casillas de tareas: se pueden marcar si hay onToggle.
    if (onToggle) html = html.replace(/<input ([^>]*?)disabled="?"?([^>]*)>/g, '<input $1$2>');
    // Bloques de código 3D (en el mismo orden en que aparecen los <pre>).
    const code: { kind: CadKind | null; code: string }[] = [];
    marked.walkTokens(marked.lexer(text), (t: Token) => {
      if (t.type === 'code') code.push({ kind: cadKind((t as Token & { lang?: string }).lang || '', (t as Token & { text: string }).text), code: (t as Token & { text: string }).text });
    });
    let i = -1;
    html = html.replace(/<pre>/g, () => {
      i++;
      const b = code[i];
      if (!b?.kind) return '<pre>';
      return `<div class="cad-bar"><span>🖨️ Modelo para ${APP[b.kind]}</span><button class="btn btn--primary small" data-cad="${i}" data-gui="1">▶ Abrir en ${APP[b.kind]}</button><button class="btn btn--ghost small" data-cad="${i}">Crear STL</button></div><pre>`;
    });
    return { html, blocks: code };
  }, [text, onToggle]);

  async function runCad(i: number, gui: boolean) {
    const b = blocks[i];
    if (!b?.kind || busy) return;
    if (!confirm(`La oficina va a ejecutar este script en ${APP[b.kind]} en tu computador. Revísalo si no confías en él. ¿Continuar?`)) return;
    setBusy(true);
    toast(`🖨️ Creando el modelo en ${APP[b.kind]}…`);
    try {
      const job = await api.cadRun({ kind: b.kind, code: b.code, name: cadName || 'modelo', gui });
      toast(job.ok ? `✅ Modelo listo${job.opened ? `, abierto en ${APP[b.kind]}` : ''}. Míralo en el Taller 3D.` : `⚠️ ${job.log.split('\n').filter(Boolean).at(-1) || 'No se generó el modelo'}`);
      if (job.ok && !gui) setView('taller');
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="markdown"
      onClick={(e) => {
        const box = e.target as HTMLInputElement;
        if (onToggle && box.tagName === 'INPUT' && box.type === 'checkbox') {
          const all = [...(e.currentTarget as HTMLElement).querySelectorAll('input[type=checkbox]')];
          onToggle(all.indexOf(box));
          return;
        }
        const cad = (e.target as HTMLElement).closest('[data-cad]') as HTMLElement | null;
        if (cad) {
          e.preventDefault();
          runCad(Number(cad.dataset.cad), cad.dataset.gui === '1');
          return;
        }
        const a = (e.target as HTMLElement).closest('a.wikilink') as HTMLElement | null;
        if (a && onLink) {
          e.preventDefault();
          onLink(a.dataset.title || '');
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
