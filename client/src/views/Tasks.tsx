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

/** 75000 → «1 min 15 s». */
const fmtSecs = (ms: number) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);

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
        <div className="row between"><h3>Respuesta integrada{task.ms != null && <small className="muted"> · ⏱ {fmtSecs(task.ms)} en total{task.synthMs ? ` (integrar: ${fmtSecs(task.synthMs)})` : ''}</small>}</h3>
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
                <strong>{a?.name || s.agentId}</strong> {a?.isHead && <span title="Jefe de departamento">👑</span>} <small className="muted">{s.review ? 'Revisión del jefe de departamento' : a?.role}</small>
                <div className="small muted">{s.instruction}</div>
                {s.dependsOn?.length ? <div className="small">↳ Trabajó sobre la entrega de {s.dependsOn.map((d) => agent(d)?.name || d).join(', ')}</div> : null}
              </div>
              {s.jury && <span className={`pill ${s.jury.score >= 4 ? 'pill--done' : s.jury.score <= 2 ? 'pill--error' : ''}`} title={s.jury.votes.map((v) => `${v.name}: ${v.score} — ${v.reason}`).join('\n')}>⚖️ {s.jury.score}/5</span>}
              {s.verify && <span className={`pill ${s.verify.score >= 4 ? 'pill--done' : s.verify.score <= 2 ? 'pill--error' : ''}`} title={`${s.verify.by}: ${s.verify.reason}`}>✔ {s.verify.score}/5</span>}
              {s.ms != null && <span className={`small ${s.ms > 90000 ? 'warn' : 'muted'}`} title="Lo que tardó esta IA">⏱ {fmtSecs(s.ms)}</span>}
              <span className={`pill pill--${s.status}`}>{s.simulated ? 'demo' : STATUS_ES[s.status]}</span>
            </summary>
            {s.error ? <p className="danger">{s.error}</p> : <div className={s.status === 'working' ? 'streaming' : ''}><Markdown text={s.output || streams[`task:${task.id}:${s.agentId}`] || '…'} onLink={(t) => openNote({ title: t })} /></div>}
            {/* Lo que entregaron sus asistentes (o lo que escriben en vivo) */}
            {(s.assistants?.length || (s.status === 'working' && a?.assistants?.some((_, i) => streams[`task:${task.id}:${s.agentId}:asist:${i}`]))) ? (
              <div className="assistant-outputs">
                {(s.assistants || a?.assistants?.map((x, i) => ({ name: x.name, focus: x.focus, task: '', output: streams[`task:${task.id}:${s.agentId}:asist:${i}`] || '', error: undefined as string | undefined })) || []).filter((x) => x.output || x.error).map((x, i) => (
                  <details key={i}>
                    <summary className="small">👥 <b>{x.name}</b> · asistente en {x.focus}{x.task ? ` — ${x.task}` : ''}</summary>
                    {x.error ? <p className="danger small">{x.error}</p> : <Markdown text={x.output} />}
                  </details>
                ))}
              </div>
            ) : null}
            {s.status === 'done' && (
              <div className="rate">
                <span className="muted small">¿Te sirvió? {a?.name} lo recordará:</span>
                <button className={`btn btn--ghost small ${s.rating?.value === 1 ? 'on' : ''}`} onClick={() => api.rateStep(task.id, s.agentId, 1)}>👍</button>
                <button className={`btn btn--ghost small ${s.rating?.value === -1 ? 'on' : ''}`} onClick={() => {
                  const c = prompt(`¿Qué debería mejorar ${a?.name}? (opcional)`) ?? '';
                  api.rateStep(task.id, s.agentId, -1, c);
                }}>👎</button>
                {s.rating?.comment && <small className="muted">«{s.rating.comment}»</small>}
                {!s.simulated && !s.jury && <button className="btn btn--ghost small" title="Otras IAs lo califican a ciegas" onClick={() => api.askJury(task.id, s.agentId).catch((e) => alert(e.message))}>⚖️ Pedir al jurado</button>}
              </div>
            )}
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
