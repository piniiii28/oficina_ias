// La oficina: el Cerebro Central al frente y los departamentos con sus IAs.
import { useMemo, useState } from 'react';
import { api, type Agent, type Task } from '../api';
import { Chibi } from '../components/Chibi';
import { AgentPanel } from '../components/AgentPanel';
import { Flights } from '../components/Flights';
import { Building } from '../building/Building';
import { Feed } from '../components/Feed';
import { MicButton } from '../components/Voice';
import { useOffice, type Live } from '../state';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Disponible', thinking: 'Pensando…', working: 'Trabajando', talking: 'Hablando', done: '¡Listo!', error: 'Error',
};

const EXAMPLES = [
  'Crea un plan de negocio para una cafetería con app de pedidos y campaña en Instagram',
  'Diseña la arquitectura y el código base de una app web de tareas en React con pruebas',
  'Explícame cálculo integral con ejemplos y arma un plan de estudio de 2 semanas',
  'Investiga el estado del arte de la IA en salud y verifica los datos clave',
];

const SHORT: Record<string, string> = { working: '⌨️ trabajando…', done: '✅ ¡listo!', error: '💥 error' };

function Bubble({ live, full = false }: { live?: Live; full?: boolean }) {
  if (!live || live.status === 'idle' || !live.message) return null;
  if (live.status === 'thinking') return <div className="bubble bubble--think"><span /><span /><span /></div>;
  // En los escritorios la burbuja es corta para no taparse con las vecinas; el texto completo va en el tooltip.
  const text = full ? live.message : SHORT[live.status] || live.message;
  const max = full ? 110 : 40;
  return <div className={`bubble bubble--${live.status}`} title={live.message}>{text.slice(0, max)}{text.length > max ? '…' : ''}</div>;
}

function Desk({ agent, live, index, onClick, dim }: { agent: Agent; live?: Live; index: number; onClick: () => void; dim: boolean }) {
  const state = live?.status || 'idle';
  return (
    <button data-agent={agent.id} className={`desk desk--${state} ${dim ? 'desk--dim' : ''} ${agent.enabled ? '' : 'desk--off'}`} onClick={onClick} title={live?.message && state !== 'idle' ? `${agent.name}: ${live.message}` : `${agent.name} · ${agent.role}`}>
      <Bubble live={live} />
      <div className="desk-chibi">
        <Chibi avatar={agent.avatar} state={state} size={78} seed={index} />
      </div>
      <div className="desk-table">
        <div className={`laptop ${state === 'working' ? 'laptop--on' : ''}`}>
          <div className="laptop-screen">{state === 'working' ? <span className="code-rain">{'</>'}</span> : null}</div>
          <div className="laptop-base" />
        </div>
        <span className="desk-prop">{agent.avatar.prop}</span>
        {state === 'done' && <span className="sparkles">✨</span>}
        {state === 'error' && <span className="sparkles">💥</span>}
      </div>
      <div className="nameplate">
        <strong>{agent.name}</strong>
        <small>{agent.role}</small>
        <span className={`dot ${agent.live ? 'dot--live' : 'dot--demo'}`} title={agent.live ? 'Conectada' : 'Modo demo'} />
      </div>
    </button>
  );
}

function TaskProgress({ task, agents }: { task: Task; agents: Agent[] }) {
  const { openNote } = useOffice();
  const name = (id: string) => agents.find((a) => a.id === id)?.name || id;
  const done = task.steps.filter((s) => s.status === 'done' || s.status === 'error').length;
  const pct = task.status === 'done' ? 100 : task.steps.length ? Math.round((done / task.steps.length) * 85) + 5 : 5;
  const label = { planning: 'Planificando', working: 'El equipo trabaja', synthesizing: 'Integrando', reviewing: 'Revisando calidad', done: 'Completada', error: 'Error' }[task.status];
  return (
    <div className="task-progress">
      <div className="task-progress-head">
        <strong>{task.title}</strong>
        <span className={`pill pill--${task.status}`}>{label}</span>
      </div>
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>
      {task.plan && <p className="muted small">{task.plan.analysis}</p>}
      <div className="step-chips">
        {task.steps.map((s) => (
          <span key={s.agentId} className={`chip chip--${s.status}`} title={s.dependsOn?.length ? `Trabaja sobre la entrega de ${s.dependsOn.map(name).join(', ')}` : 'Trabaja en paralelo'}>
            {s.dependsOn?.length ? '↳ ' : ''}{name(s.agentId)}
          </span>
        ))}
      </div>
      {task.status === 'done' && task.noteId && (
        <button className="btn btn--ghost small" onClick={() => openNote({ id: task.noteId! })}>Ver resultado en notas →</button>
      )}
    </div>
  );
}

export function Office() {
  const { agents, departments, live, tasks, toast, setView } = useOffice();
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const [layout, setLayoutState] = useState<'edificio' | 'escritorios'>(() => {
    try {
      return localStorage.getItem('oficina.layout') === 'escritorios' ? 'escritorios' : 'edificio';
    } catch {
      return 'edificio';
    }
  });
  const setLayout = (v: 'edificio' | 'escritorios') => {
    setLayoutState(v);
    try {
      localStorage.setItem('oficina.layout', v);
    } catch {
      /* sin almacenamiento local */
    }
  };
  const choose = (a: Agent) => {
    if (a.isBrain && picking) return;
    if (picking) setPick((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]));
    else setSelected(a);
  };

  const brain = agents.find((a) => a.isBrain);
  const staff = agents.filter((a) => !a.isBrain);
  const active = tasks.filter((t) => t.status !== 'done' && t.status !== 'error');
  const latest = active[0] || tasks[0];
  const busy = active.length > 0;

  const byDept = useMemo(() => {
    const m = new Map<string, Agent[]>();
    for (const a of staff) m.set(a.department, [...(m.get(a.department) || []), a]);
    return m;
  }, [staff]);

  const matches = (a: Agent) => {
    const q = filter.trim().toLowerCase();
    return !q || `${a.name} ${a.role} ${a.skills.join(' ')} ${a.model}`.toLowerCase().includes(q);
  };

  async function send() {
    const p = prompt.trim();
    if (!p) return;
    try {
      await api.runTask(p, picking && pick.length ? pick : undefined, undefined, files.length ? files : undefined);
      setPrompt('');
      setFiles([]);
      toast('🧠 Claude recibió la tarea y está armando el equipo');
    } catch (err) {
      toast(`Error: ${(err as Error).message}`);
    }
  }

  const liveCount = agents.filter((a) => a.live).length;
  let idx = 0;

  return (
    <div className="office">
      <section className="hq">
        <div className="hq-brain" data-agent={brain?.id} onClick={() => brain && setSelected(brain)}>
          {brain && (
            <>
              <div className={`brain-aura brain-aura--${live[brain.id]?.status || 'idle'}`} />
              <Bubble live={live[brain.id]} full />
              <Chibi avatar={brain.avatar} state={live[brain.id]?.status || 'idle'} size={120} legs />
              <div className="hq-name">
                <strong>{brain.name}</strong>
                <small>Cerebro Central · {brain.model}</small>
              </div>
            </>
          )}
        </div>
        <div className="hq-console">
          <h1>¿Qué hacemos hoy?</h1>
          <p className="muted">
            Describe una tarea: Claude la divide, elige a los especialistas, trabajan en paralelo y todo queda guardado en tus notas y en el grafo.
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
            }}
            placeholder="Ej.: Crea una landing page para mi emprendimiento y una estrategia de lanzamiento…"
            rows={3}
          />
          <div className="hq-actions">
            <MicButton onText={(t) => setPrompt((p) => (p ? `${p} ${t}` : t))} />
            <label className="btn btn--ghost small" title="Adjunta textos, datos o código para que el equipo los use">
              📎 Adjuntar
              <input type="file" multiple hidden accept=".txt,.md,.csv,.json,.html,.css,.js,.ts,.tsx,.py,.java,.sql,.xml,.yml,.yaml,.log"
                onChange={async (e) => {
                  const list = [...(e.target.files || [])].filter((f) => f.size < 2_000_000);
                  const read = await Promise.all(list.map(async (f) => ({ name: f.name, content: await f.text() })));
                  setFiles((x) => [...x, ...read].slice(0, 10));
                  e.target.value = '';
                }} />
            </label>
            {files.map((f) => (
              <span key={f.name} className="chip">📎 {f.name} <button className="link" onClick={() => setFiles((x) => x.filter((y) => y.name !== f.name))}>✕</button></span>
            ))}
            <label className="check">
              <input type="checkbox" checked={picking} onChange={(e) => setPicking(e.target.checked)} />
              Elegir el equipo yo mismo {picking && pick.length ? `(${pick.length})` : ''}
            </label>
            <button className="btn btn--primary" onClick={send} disabled={!prompt.trim()}>
              {busy ? 'Enviar otra tarea' : 'Enviar al cerebro'} ⌘↵
            </button>
          </div>
          {!prompt && (
            <div className="examples">
              {EXAMPLES.map((e) => (
                <button key={e} className="chip chip--example" onClick={() => setPrompt(e)}>{e}</button>
              ))}
            </div>
          )}
          {liveCount === 0 && (
            <p className="hint">
              🎭 Todas las IAs están en <b>modo demo</b> (respuestas simuladas). <a href="#" onClick={(e) => { e.preventDefault(); setView('ajustes'); }}>Conecta tus claves</a> para que respondan de verdad.
            </p>
          )}
          {latest && <TaskProgress task={latest} agents={agents} />}
        </div>
      </section>

      <Feed />

      <div className="floor-toolbar">
        <h2>La oficina <span className="muted">· {staff.length} IAs</span></h2>
        <div className="row">
          <div className="view-toggle">
            <button className={layout === 'edificio' ? 'on' : ''} onClick={() => setLayout('edificio')}>🏢 Edificio</button>
            <button className={layout === 'escritorios' ? 'on' : ''} onClick={() => setLayout('escritorios')}>▦ Escritorios</button>
          </div>
          {layout === 'escritorios' && <input className="search" placeholder="Buscar IA por nombre, rol o habilidad…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        </div>
      </div>

      {layout === 'edificio' && (
        <>
          {picking && <p className="hint">Haz clic en las IAs del edificio para elegir tu equipo ({pick.length} elegidas: {pick.map((id) => agents.find((a) => a.id === id)?.name).join(', ') || 'ninguna'}).</p>}
          <Building onSelect={choose} />
        </>
      )}

      {layout === 'escritorios' && <div className="floor">
        {departments.filter((d) => byDept.has(d.id)).map((d) => (
          <section key={d.id} className="room" style={{ ['--room' as string]: d.color }}>
            <header className="room-head">
              <span>{d.emoji}</span> {d.name}
              <small className="muted">{byDept.get(d.id)!.length}</small>
            </header>
            <div className="room-floor">
              {byDept.get(d.id)!.map((a) => {
                const i = idx++;
                const chosen = pick.includes(a.id);
                return (
                  <div key={a.id} className={`desk-wrap ${picking && chosen ? 'desk-wrap--picked' : ''}`}>
                    <Desk
                      agent={a}
                      live={live[a.id]}
                      index={i}
                      dim={!matches(a)}
                      onClick={() => choose(a)}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>}

      <div className="legend muted small">
        <span><i className="dot dot--live" /> Conectada a su API</span>
        <span><i className="dot dot--demo" /> Modo demo</span>
        <span>Haz clic en una IA para hablar con ella, entrenarla o editarla.</span>
        {layout === 'edificio' && <span>En el edificio pasean, bajan por café y van a su escritorio cuando tienen trabajo.</span>}
      </div>

      <Flights live={live} brainId={brain?.id} task={active[0]} />
      {selected && <AgentPanel agent={agents.find((a) => a.id === selected.id) || selected} onClose={() => setSelected(null)} status={STATUS_LABEL[live[selected.id]?.status || 'idle']} />}
    </div>
  );
}
