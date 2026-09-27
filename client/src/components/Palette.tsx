// Búsqueda global (Ctrl+K / ⌘K): notas, IAs, tareas y secciones.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type NoteSummary } from '../api';
import { useOffice, type View } from '../state';

type Item = { key: string; icon: string; label: string; hint: string; run: () => void };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

export function Palette() {
  const { agents, tasks, setView, openNote, notesVersion } = useOffice();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
    }
  }, [open]);
  useEffect(() => {
    if (open) api.notes().then(setNotes);
  }, [open, notesVersion]);

  const items = useMemo<Item[]>(() => {
    const go = (v: View) => () => setView(v);
    const views: Item[] = [
      ['oficina', '🏢', 'Oficina'], ['tablero', '📋', 'Tablero'], ['tareas', '🎯', 'Tareas'], ['reuniones', '🗣️', 'Reuniones'], ['notas', '📝', 'Notas'],
      ['grafo', '🕸️', 'Grafo'], ['agentes', '👥', 'Equipo'], ['ajustes', '⚙️', 'Ajustes'],
    ].map(([v, icon, label]) => ({ key: `v:${v}`, icon, label, hint: 'Sección', run: go(v as View) }));
    const ns: Item[] = notes.map((n) => ({ key: `n:${n.id}`, icon: '📝', label: n.title, hint: 'Nota', run: () => openNote({ id: n.id }) }));
    const as: Item[] = agents.map((a) => ({ key: `a:${a.id}`, icon: a.avatar.prop, label: a.name, hint: `IA · ${a.role}`, run: go('agentes') }));
    const ts: Item[] = tasks.slice(0, 50).map((t) => ({ key: `t:${t.id}`, icon: '🎯', label: t.title, hint: 'Tarea', run: go('tareas') }));
    const all = [...views, ...as, ...ns, ...ts];
    const s = norm(q.trim());
    return (s ? all.filter((i) => norm(`${i.label} ${i.hint}`).includes(s)) : all).slice(0, 12);
  }, [q, notes, agents, tasks, setView, openNote]);

  if (!open) return null;
  const choose = (i: Item | undefined) => {
    if (!i) return;
    i.run();
    setOpen(false);
  };
  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Buscar">
        <input
          ref={input}
          autoFocus
          value={q}
          placeholder="Buscar notas, IAs, tareas o secciones…"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
            if (e.key === 'Enter') choose(items[sel]);
          }}
        />
        <ul>
          {items.map((i, k) => (
            <li key={i.key} className={k === sel ? 'on' : ''} onMouseEnter={() => setSel(k)} onClick={() => choose(i)}>
              <span>{i.icon}</span> <strong>{i.label}</strong> <small className="muted">{i.hint}</small>
            </li>
          ))}
          {!items.length && <li className="muted">Sin resultados</li>}
        </ul>
        <p className="muted small">↑↓ para moverte · Enter para abrir · Esc para cerrar</p>
      </div>
    </div>
  );
}
