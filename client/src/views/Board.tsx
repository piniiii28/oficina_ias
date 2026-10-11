// Tablero de proyectos (Kanban): tarjetas que se envían al equipo con un clic.
import { useEffect, useState } from 'react';
import { api, type Card } from '../api';
import { useOffice } from '../state';

const COLUMNS: { id: Card['column']; label: string; emoji: string }[] = [
  { id: 'todo', label: 'Por hacer', emoji: '📥' },
  { id: 'doing', label: 'En curso', emoji: '⚙️' },
  { id: 'done', label: 'Hecho', emoji: '✅' },
];

export function Board() {
  const { cardsVersion, tasks, openNote, toast } = useOffice();
  const [cards, setCards] = useState<Card[]>([]);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [project, setProject] = useState('');
  const [filter, setFilter] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => { api.cards().then(setCards); }, [cardsVersion]);
  const projects = [...new Set(cards.map((c) => c.project).filter(Boolean))];
  const shown = cards.filter((c) => !filter || c.project === filter);

  async function add() {
    if (!title.trim()) return;
    await api.createCard({ title: title.trim(), details, project: project.trim() });
    setTitle('');
    setDetails('');
  }

  return (
    <div className="board">
      <header className="board-head">
        <div className="board-new">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nueva tarjeta: ¿qué hay que hacer?" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="Proyecto (opcional)" list="projects" style={{ maxWidth: 200 }} />
          <datalist id="projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
          <button className="btn btn--primary" onClick={add} disabled={!title.trim()}>Agregar</button>
        </div>
        <textarea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Detalles para el equipo (opcional)" />
        {projects.length > 0 && (
          <div className="type-filter" style={{ maxWidth: 600 }}>
            <button className={!filter ? 'on' : ''} onClick={() => setFilter('')}>Todos</button>
            {projects.map((p) => <button key={p} className={filter === p ? 'on' : ''} onClick={() => setFilter(p)}>{p}</button>)}
          </div>
        )}
      </header>
      <div className="board-cols">
        {COLUMNS.map((col) => (
          <section
            key={col.id}
            className={`board-col ${dragging ? 'board-col--drop' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={async () => {
              if (dragging) await api.updateCard(dragging, { column: col.id });
              setDragging(null);
            }}
          >
            <h3>{col.emoji} {col.label} <span className="muted">{shown.filter((c) => c.column === col.id).length}</span></h3>
            {!shown.length && col.id === 'todo' && (
              <p className="small muted board-empty">Escribe arriba lo que hay que hacer, o pasa las «Ideas clave» de una tarea con 📋. Luego, con «🧠 Enviar al equipo», las IAs la hacen y la tarjeta avanza sola.</p>
            )}
            {shown.filter((c) => c.column === col.id).map((c) => {
              const task = c.taskId ? tasks.find((t) => t.id === c.taskId) : null;
              const running = task && !['done', 'error', 'waiting'].includes(task.status);
              const waiting = task?.status === 'waiting';
              return (
                <article key={c.id} className="kcard" draggable onDragStart={() => setDragging(c.id)} onDragEnd={() => setDragging(null)}>
                  {c.project && <span className="pill">{c.project}</span>}
                  <strong>{c.title}</strong>
                  {c.details && <p className="small muted">{c.details}</p>}
                  <div className="row">
                    {!c.taskId && (
                      <button className="btn btn--primary small" onClick={async () => { await api.runCard(c.id); toast('🧠 El equipo tomó la tarjeta'); }}>🧠 Enviar al equipo</button>
                    )}
                    {running && <span className="pill pill--working">el equipo trabaja…</span>}
                    {waiting && <span className="pill pill--waiting" title="Ninguna IA tiene cupo ahora: se retoma sola">⏳ en espera</span>}
                    {c.noteId && <button className="btn btn--ghost small" onClick={() => openNote({ id: c.noteId! })}>📝 Resultado</button>}
                    <button className="link danger" onClick={() => api.deleteCard(c.id)}>Borrar</button>
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
