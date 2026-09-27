// Historial de tareas: el plan del cerebro, cada aporte y la respuesta final.
import React, { useEffect, useState } from 'react';
import { api, type Task } from '../api';
import { Chibi } from '../components/Chibi';
import { Markdown } from '../components/Markdown';
import { Routines } from '../components/Routines';
import { SpeakButton } from '../components/Voice';
import { PlanDiagram } from '../components/PlanDiagram';
import { useOffice } from '../state';

export const STATUS_ES: Record<string, string> = {
  planning: 'planificando', working: 'trabajando', synthesizing: 'integrando', reviewing: 'revisando', done: 'lista', error: 'error', pending: 'en espera',
};

export function Tasks() {
  const { tasks, agents, reloadTasks, openNote } = useOffice();
  const [openId, setOpenId] = useState<string | null>(null);
  const current = tasks.find((t) => t.id === openId) || tasks[0];
  // Al lanzar una continuación, se abre la nueva tarea (por su id, no por su padre:
  // la misma tarea puede tener varias continuaciones).
  const [followId, setFollowId] = useState<string | null>(null);
  useEffect(() => {
    if (followId && tasks.some((t) => t.id === followId)) {
      setOpenId(followId);
      setFollowId(null);
    }
  }, [tasks, followId]);
  const agent = (id: string) => agents.find((a) => a.id === id);

  return (
    <div className="tasks">
      <aside className="tasks-list">
        <Routines />
        {!tasks.length && <p className="muted small center">Todavía no hay tareas. Ve a la Oficina y pídele algo al Cerebro Central.</p>}
        {tasks.map((t) => (
          <button key={t.id} className={`task-item ${current?.id === t.id ? 'active' : ''}`} onClick={() => setOpenId(t.id)}>
            <strong>{t.title}</strong>
            <small className="muted">{new Date(t.createdAt).toLocaleString()} · {t.steps.length} IAs</small>
            <span className={`pill pill--${t.status}`}>{STATUS_ES[t.status]}</span>
          </button>
        ))}
      </aside>
      {!current && <div className="empty">Aquí verás el plan del cerebro, el aporte de cada IA y la respuesta integrada.</div>}
      {current && <TaskDetail task={current} agent={agent} onDelete={async () => { await api.deleteTask(current.id); setOpenId(null); reloadTasks(); }} openNote={openNote} onFollow={setFollowId} parent={tasks.find((t) => t.id === current.parentId)} onOpen={setOpenId} />}
    </div>
  );
}

function TaskDetail({ task, agent, onDelete, openNote, onFollow, parent, onOpen }: {
  task: Task;
  onFollow: (id: string) => void;
  parent?: Task;
  onOpen: (id: string) => void;
  agent: (id: string) => ReturnType<typeof useOffice>['agents'][number] | undefined;
  onDelete: () => void;
  openNote: ReturnType<typeof useOffice>['openNote'];
}) {
  const { streams, agents } = useOffice();
  const liveFinal = streams[`task:${task.id}:final`];
  return (
    <main className="task-detail">
      <header className="row between">
        <h2>{task.title}</h2>
        <div className="row">
          {task.status !== 'done' && task.status !== 'error' && (
            <button className="btn btn--danger small" onClick={() => api.cancelTask(task.id)}>✖ Cancelar</button>
          )}
          {task.status === 'error' && (
            <button className="btn btn--primary small" onClick={async () => {
              const { id } = await api.runTask(task.prompt, task.steps.map((s) => s.agentId));
              onFollow(id);
            }}>🔁 Reintentar</button>
          )}
          {task.noteId && <button className="btn btn--ghost small" onClick={() => openNote({ id: task.noteId! })}>📝 Abrir nota</button>}
          <button className="btn btn--danger small" onClick={onDelete}>Borrar</button>
        </div>
      </header>
      {parent && <p className="small">↩ Continúa <a href="#" onClick={(e) => { e.preventDefault(); onOpen(parent.id); }}>{parent.title}</a></p>}
      <blockquote>{task.prompt}</blockquote>
      {task.plan && <p className="muted">🧠 {task.plan.analysis}</p>}
      <PlanDiagram task={task} agents={agents} />
      {task.attachments?.length ? <p className="small">📎 Adjuntos: {task.attachments.map((f) => f.name).join(', ')}</p> : null}
      {task.contextNotes?.length ? (
        <p className="small">📚 Usó de tu grafo:{' '}
          {task.contextNotes.map((t) => <a key={t} href="#" className="wikilink" onClick={(e) => { e.preventDefault(); openNote({ title: t }); }}>{t}</a>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}
        </p>
      ) : null}

      <section className="card final">
        <div className="row between"><h3>Respuesta integrada</h3>
          <div className="row">
            {task.status === 'done' && <CardsButton task={task} />}
            {task.final && <SpeakButton text={task.final} />}
          </div>
        </div>
        {task.final ? <Markdown text={task.final} onLink={(t) => openNote({ title: t })} /> : liveFinal ? <div className="streaming"><Markdown text={liveFinal} /></div> : <p className="muted">El equipo sigue trabajando…</p>}
      </section>

      {task.status === 'done' && <FollowUp task={task} onSent={onFollow} />}

      <h3>Aportes del equipo</h3>
      {task.steps.map((s) => {
        const a = agent(s.agentId);
        return (
          <details key={s.agentId} className="card step" open={task.steps.length <= 2 || s.status === 'working'}>
            <summary>
              {a && <Chibi avatar={a.avatar} size={36} state={s.status === 'working' ? 'working' : s.status === 'error' ? 'error' : 'idle'} />}
              <div>
                <strong>{a?.name || s.agentId}</strong> <small className="muted">{a?.role}</small>
                <div className="small muted">{s.instruction}</div>
                {s.dependsOn?.length ? <div className="small">↳ Trabajó sobre la entrega de {s.dependsOn.map((d) => agent(d)?.name || d).join(', ')}</div> : null}
              </div>
              <span className={`pill pill--${s.status}`}>{s.simulated ? 'demo' : STATUS_ES[s.status]}</span>
            </summary>
            {s.error ? <p className="danger">{s.error}</p> : <div className={s.status === 'working' ? 'streaming' : ''}><Markdown text={s.output || streams[`task:${task.id}:${s.agentId}`] || '…'} onLink={(t) => openNote({ title: t })} /></div>}
          </details>
        );
      })}
    </main>
  );
}

function FollowUp({ task, onSent }: { task: Task; onSent: (id: string) => void }) {
  const [text, setText] = useState('');
  const { toast } = useOffice();
  return (
    <section className="card followup">
      <h3>¿Algún ajuste?</h3>
      <p className="muted small">El mismo equipo retoma el resultado anterior y lo mejora con tu pedido.</p>
      <div className="chat-input">
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej.: Hazlo más corto y agrega un presupuesto…" />
        <button className="btn btn--primary" disabled={!text.trim()} onClick={async () => {
          const { id } = await api.runTask(text.trim(), undefined, task.id);
          setText('');
          onSent(id);
          toast('🔁 El equipo retoma la tarea');
        }}>Continuar</button>
      </div>
    </section>
  );
}

/** Convierte las ideas clave y próximos pasos de la respuesta en tarjetas del tablero. */
function CardsButton({ task }: { task: Task }) {
  const { toast, setView } = useOffice();
  const items = (() => {
    const m = task.final.match(/#+\s*(ideas clave|próximos pasos|proximos pasos)[^\n]*\n([\s\S]*?)(?:\n#+\s|\n---|$)/i);
    if (!m) return [];
    return m[2].split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+\.)\s*(\[[ x]\]\s*)?/, '').replace(/\*\(de [^)]*\)\*/, '').replace(/\*\*/g, '').trim()).filter((l) => l.length > 3).slice(0, 8);
  })();
  if (!items.length) return null;
  return (
    <button className="btn btn--ghost small" title={items.join('\n')} onClick={async () => {
      await Promise.all(items.map((title) => api.createCard({ title, details: `Surge de la tarea: ${task.title}`, project: task.title.slice(0, 40) })));
      toast(`📋 ${items.length} tarjetas nuevas en el tablero`);
      setView('tablero');
    }}>📋 Pasar {items.length} al tablero</button>
  );
}
