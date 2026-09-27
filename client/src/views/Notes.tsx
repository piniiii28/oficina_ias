// Notas estilo Obsidian: lista, editor Markdown con vista previa, [[enlaces]] y backlinks.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Note, type NoteSummary, type NoteType } from '../api';
import { Markdown } from '../components/Markdown';
import { useOffice } from '../state';

export const TYPE_META: Record<NoteType, { label: string; emoji: string; color: string }> = {
  nota: { label: 'Nota', emoji: '📝', color: '#94a3b8' },
  idea: { label: 'Idea', emoji: '💡', color: '#fbbf24' },
  tarea: { label: 'Tarea', emoji: '🎯', color: '#c084fc' },
  aporte: { label: 'Aporte de IA', emoji: '🤖', color: '#60a5fa' },
  diario: { label: 'Diario', emoji: '📅', color: '#34d399' },
};

export function Notes() {
  const { notesVersion, pendingNote, clearPendingNote, agents, setView, toast } = useOffice();
  const [list, setList] = useState<NoteSummary[]>([]);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<NoteType | ''>('');
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const saveTimer = useRef<number>();

  const load = useCallback(async () => setList(await api.notes(q)), [q]);
  useEffect(() => { load(); }, [load, notesVersion]);

  const open = useCallback(async (id: string) => {
    const n = await api.note(id);
    setNote(n);
    setDraft(n.content);
    setTitle(n.title);
    setEditing(!n.content);
  }, []);

  const openByTitle = useCallback(async (t: string) => {
    const n = await api.resolveNote(t);
    await open(n.id);
    load();
  }, [open, load]);

  useEffect(() => {
    if (!pendingNote) return;
    if (pendingNote.id) open(pendingNote.id);
    else if (pendingNote.title) openByTitle(pendingNote.title);
    clearPendingNote();
  }, [pendingNote, open, openByTitle, clearPendingNote]);

  // Abre la nota más reciente al entrar.
  useEffect(() => {
    if (!note && !pendingNote && list.length) {
      const first = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      open(first.id);
    }
  }, [list, note, pendingNote, open]);

  // Autoguardado.
  useEffect(() => {
    if (!note || (draft === note.content && title === note.title)) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const n = await api.updateNote(note.id, { content: draft, title: title.trim() || note.title });
        setNote(n);
        load();
      } catch (err) {
        toast(`No se pudo guardar: ${(err as Error).message}`);
      }
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [draft, title, note, load, toast]);

  async function newNote(type: NoteType = 'nota') {
    const base = type === 'diario' ? new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Nueva nota';
    const n = await api.createNote({ title: base, type, content: '' });
    await load();
    await open(n.id);
    setEditing(true);
  }

  const shown = list
    .filter((n) => !typeFilter || n.type === typeFilter)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const author = note?.source?.agentId ? agents.find((a) => a.id === note.source!.agentId) : null;
  const outLinks = [...new Set([...(note?.content.matchAll(/\[\[([^\]|#]+)/g) || [])].map((m) => m[1].trim()))];

  return (
    <div className="notes">
      <aside className="notes-list">
        <div className="notes-list-head">
          <input className="search" placeholder="Buscar notas…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="row">
            <button className="btn btn--primary small" onClick={() => newNote()}>＋ Nota</button>
            <button className="btn btn--ghost small" onClick={() => newNote('idea')}>💡 Idea</button>
            <button className="btn btn--ghost small" onClick={() => newNote('diario')}>📅 Hoy</button>
          </div>
          <div className="type-filter">
            <button className={!typeFilter ? 'on' : ''} onClick={() => setTypeFilter('')}>Todas</button>
            {(Object.keys(TYPE_META) as NoteType[]).map((t) => (
              <button key={t} className={typeFilter === t ? 'on' : ''} onClick={() => setTypeFilter(t)} title={TYPE_META[t].label}>{TYPE_META[t].emoji}</button>
            ))}
          </div>
        </div>
        <ul>
          {shown.map((n) => (
            <li key={n.id} className={note?.id === n.id ? 'active' : ''} onClick={() => open(n.id)}>
              <span className="note-emoji">{n.pinned ? '📌' : TYPE_META[n.type]?.emoji}</span>
              <div>
                <strong>{n.title}</strong>
                <small className="muted">{n.excerpt.replace(/[#*>[\]]/g, '').slice(0, 70)}</small>
              </div>
            </li>
          ))}
          {!shown.length && <li className="muted center">Sin notas</li>}
        </ul>
        <p className="muted small center">{list.length} notas</p>
      </aside>

      <main className="note-editor">
        {note ? (
          <>
            <div className="note-toolbar">
              <input className="note-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <select value={note.type} onChange={async (e) => { setNote(await api.updateNote(note.id, { type: e.target.value as NoteType })); load(); }}>
                {(Object.keys(TYPE_META) as NoteType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].emoji} {TYPE_META[t].label}</option>)}
              </select>
              <button className="btn btn--ghost small" onClick={() => setEditing((e) => !e)}>{editing ? '👁 Ver' : '✏️ Editar'}</button>
              <button className="btn btn--ghost small" onClick={async () => { setNote(await api.updateNote(note.id, { pinned: !note.pinned })); load(); }}>{note.pinned ? 'Desfijar' : '📌 Fijar'}</button>
              <button className="btn btn--danger small" onClick={async () => {
                if (!confirm(`¿Borrar "${note.title}"?`)) return;
                await api.deleteNote(note.id);
                setNote(null);
                load();
              }}>Borrar</button>
            </div>
            <p className="muted small">
              {author ? `Escrita por ${author.name} · ` : ''}Editada {new Date(note.updatedAt).toLocaleString()}
              {' · '}Escribe <code>[[Título]]</code> para enlazar y <code>#etiqueta</code> para agrupar
            </p>
            {editing ? (
              <textarea className="note-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escribe en Markdown…" autoFocus />
            ) : (
              <div className="note-preview" onDoubleClick={() => setEditing(true)}>
                {draft ? <Markdown text={draft} onLink={openByTitle} /> : <p className="muted">Nota vacía. Doble clic para editar.</p>}
              </div>
            )}
          </>
        ) : (
          <div className="empty">
            <p>Selecciona o crea una nota.</p>
          </div>
        )}
      </main>

      <aside className="note-side">
        {note && (
          <>
            <h3>↩ Backlinks ({note.backlinks.length})</h3>
            <ul className="link-list">
              {note.backlinks.map((b) => <li key={b.id}><a href="#" onClick={(e) => { e.preventDefault(); open(b.id); }}>{TYPE_META[b.type]?.emoji} {b.title}</a></li>)}
              {!note.backlinks.length && <li className="muted small">Ninguna nota enlaza aquí todavía.</li>}
            </ul>
            <h3>↪ Enlaces ({outLinks.length})</h3>
            <ul className="link-list">
              {outLinks.map((t) => <li key={t}><a href="#" onClick={(e) => { e.preventDefault(); openByTitle(t); }}>{t}</a></li>)}
            </ul>
            {note.tags.length > 0 && (
              <>
                <h3>Etiquetas</h3>
                <div className="step-chips">{note.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>
              </>
            )}
            <button className="btn btn--ghost small full" onClick={() => setView('grafo')}>🕸️ Ver en el grafo</button>
          </>
        )}
      </aside>
    </div>
  );
}
