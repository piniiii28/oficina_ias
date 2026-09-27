// Renderiza Markdown con soporte para [[enlaces]] y #etiquetas.
import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function Markdown({ text, onLink, onToggle }: { text: string; onLink?: (title: string) => void; onToggle?: (index: number) => void }) {
  const html = useMemo(() => {
    const withLinks = text.replace(/\[\[([^\]|#]+)(?:[#|]([^\]]*))?\]\]/g, (_m, title: string, alias?: string) => {
      const t = escapeHtml(title.trim());
      return `<a class="wikilink" href="#" data-title="${t}">${escapeHtml((alias || title).trim())}</a>`;
    });
    const withTags = withLinks.replace(/(^|\s)#([\p{L}\d_\-/]+)/gu, '$1<span class="tag">#$2</span>');
    let html = DOMPurify.sanitize(marked.parse(withTags, { async: false }) as string, { ADD_ATTR: ['data-title'] });
    // Casillas de tareas: se pueden marcar si hay onToggle.
    if (onToggle) html = html.replace(/<input ([^>]*?)disabled="?"?([^>]*)>/g, '<input $1$2>');
    return html;
  }, [text, onToggle]);

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
