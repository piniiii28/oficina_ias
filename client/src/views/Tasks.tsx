// Historial de tareas: el plan del cerebro, cada aporte y la respuesta final.
import { useState } from 'react';
import { api, type Task } from '../api';
import { Chibi } from '../components/Chibi';
import { Markdown } from '../components/Markdown';
import { useOffice } from '../state';

export const STATUS_ES: Record<string, string> = {
  planning: 'planificando', working: 'trabajando', synthesizing: 'integrando', done: 'lista', error: 'error', pending: 'en espera',
};

export function Tasks() {
  const { tasks, agents, reloadTasks, openNote } = useOffice();
  const [openId, setOpenId] = useState<string | null>(null);
  const current = tasks.find((t) => t.id === openId) || tasks[0];
  const agent = (id: string) => agents.find((a) => a.id === id);

  if (!tasks.length) {
    return <div className="empty">Todavía no hay tareas. Ve a la Oficina y pídele algo al Cerebro Central.</div>;
  }

  return (
    <div className="tasks">
      <aside className="tasks-list">
        {tasks.map((t) => (
          <button key={t.id} className={`task-item ${current?.id === t.id ? 'active' : ''}`} onClick={() => setOpenId(t.id)}>
            <strong>{t.title}</strong>
            <small className="muted">{new Date(t.createdAt).toLocaleString()} · {t.steps.length} IAs</small>
            <span className={`pill pill--${t.status}`}>{STATUS_ES[t.status]}</span>
          </button>
        ))}
      </aside>
      {current && <TaskDetail task={current} agent={agent} onDelete={async () => { await api.deleteTask(current.id); setOpenId(null); reloadTasks(); }} openNote={openNote} />}
    </div>
  );
}

function TaskDetail({ task, agent, onDelete, openNote }: {
  task: Task;
  agent: (id: string) => ReturnType<typeof useOffice>['agents'][number] | undefined;
  onDelete: () => void;
  openNote: ReturnType<typeof useOffice>['openNote'];
}) {
  return (
    <main className="task-detail">
      <header className="row between">
        <h2>{task.title}</h2>
        <div className="row">
          {task.noteId && <button className="btn btn--ghost small" onClick={() => openNote({ id: task.noteId! })}>📝 Abrir nota</button>}
          <button className="btn btn--danger small" onClick={onDelete}>Borrar</button>
        </div>
      </header>
      <blockquote>{task.prompt}</blockquote>
      {task.plan && <p className="muted">🧠 {task.plan.analysis}</p>}

      <section className="card final">
        <h3>Respuesta integrada</h3>
        {task.final ? <Markdown text={task.final} onLink={(t) => openNote({ title: t })} /> : <p className="muted">El equipo sigue trabajando…</p>}
      </section>

      <h3>Aportes del equipo</h3>
      {task.steps.map((s) => {
        const a = agent(s.agentId);
        return (
          <details key={s.agentId} className="card step" open={task.steps.length <= 2}>
            <summary>
              {a && <Chibi avatar={a.avatar} size={36} state={s.status === 'working' ? 'working' : s.status === 'error' ? 'error' : 'idle'} />}
              <div>
                <strong>{a?.name || s.agentId}</strong> <small className="muted">{a?.role}</small>
                <div className="small muted">{s.instruction}</div>
                {s.dependsOn?.length ? <div className="small">↳ Trabajó sobre la entrega de {s.dependsOn.map((d) => agent(d)?.name || d).join(', ')}</div> : null}
              </div>
              <span className={`pill pill--${s.status}`}>{s.simulated ? 'demo' : STATUS_ES[s.status]}</span>
            </summary>
            {s.error ? <p className="danger">{s.error}</p> : <Markdown text={s.output || '…'} onLink={(t) => openNote({ title: t })} />}
          </details>
        );
      })}
    </main>
  );
}
