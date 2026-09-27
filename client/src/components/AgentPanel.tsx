// Panel lateral de una IA: chat directo, entrenamiento, memoria y perfil.
import { useEffect, useRef, useState } from 'react';
import { Meters } from './Meters';
import { api, levelOf, TIER_LABEL, type Account, type Agent, type AssistantDef, type ChatMessage, type OllamaServer } from '../api';
import { Chibi, ACCESSORIES, COSTUMES, EYE_STYLES, HAIR_STYLES } from './Chibi';
import { Markdown } from './Markdown';
import { MicButton, SpeakButton } from './Voice';
import { useOffice } from '../state';

type Tab = 'chat' | 'entrenamiento' | 'asistentes' | 'memoria' | 'perfil';

export function AgentPanel({ agent, onClose, status }: { agent: Agent; onClose: () => void; status: string }) {
  const [tab, setTab] = useState<Tab>('chat');
  const { live } = useOffice();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <Chibi avatar={agent.avatar} state={live[agent.id]?.status || 'idle'} size={84} />
          <div>
            <h2>{agent.name} <span className="level" title="Sube de nivel al completar trabajos">Nv {levelOf(agent)}</span>{agent.isHead && <span className="level head" title="Jefe de su departamento">👑 Jefe</span>}</h2>
            <p className="muted">{agent.role}</p>
            <p className="small">
              <span className={`dot ${agent.live ? 'dot--live' : 'dot--demo'}`} /> {agent.live ? 'Conectada' : 'Modo demo'} · {agent.provider} / <code>{agent.model || '—'}</code>
            </p>
            <Meters agentId={agent.id} full />
            <p className="small muted">{status} · {agent.stats?.tasks || 0} trabajos · {agent.knowledge?.length || 0} {agent.knowledge?.length === 1 ? 'lección' : 'lecciones'}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>
        <nav className="tabs">
          {(['chat', 'entrenamiento', 'asistentes', 'memoria', 'perfil'] as Tab[]).filter((t) => t !== 'asistentes' || !agent.isBrain).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {{ chat: '💬 Chat', entrenamiento: '🎓 Entrenamiento', asistentes: `👥 Asistentes${agent.assistants?.length ? ` (${agent.assistants.length})` : ''}`, memoria: '🧠 Memoria', perfil: '⚙️ Perfil' }[t]}
            </button>
          ))}
        </nav>
        <div className="drawer-body">
          {tab === 'chat' && <ChatTab agent={agent} />}
          {tab === 'entrenamiento' && <TrainingTab agent={agent} />}
          {tab === 'asistentes' && <AssistantsTab agent={agent} />}
          {tab === 'memoria' && <MemoryTab agent={agent} />}
          {tab === 'perfil' && <ProfileTab agent={agent} onDeleted={onClose} />}
        </div>
      </aside>
    </div>
  );
}

function ChatTab({ agent }: { agent: Agent }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const { toast, openNote, streams } = useOffice();
  const liveReply = streams[`chat:${agent.id}`];
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.chat(agent.id).then(setMsgs);
  }, [agent.id]);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs, sending, liveReply]);

  async function send() {
    const m = text.trim();
    if (!m || sending) return;
    setText('');
    setSending(true);
    setMsgs((x) => [...x, { role: 'user', content: m, at: new Date().toISOString() }]);
    try {
      const r = await api.sendChat(agent.id, m);
      setMsgs(r.history);
    } catch (err) {
      toast(`Error: ${(err as Error).message}`);
      setMsgs((x) => x.slice(0, -1));
      setText(m);
    } finally {
      setSending(false);
    }
  }

  async function saveAsNote(content: string) {
    const n = await api.createNote({ title: `${agent.name}: ${content.replace(/[#*>\n]/g, ' ').trim().slice(0, 50)}`, content, type: 'nota', source: { agentId: agent.id } });
    toast('📝 Guardado en notas');
    openNote({ id: n.id });
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {msgs.length === 0 && <p className="muted center">Escríbele a {agent.name}. Recuerda la conversación aunque cierres la app.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`msg msg--${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.content} /> : <p>{m.content}</p>}
            {m.role === 'assistant' && (
              <div className="msg-actions">
                {m.simulated && <span className="pill">demo</span>}
                <SpeakButton text={m.content} />
                <button className="link" onClick={() => saveAsNote(m.content)}>Guardar como nota</button>
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="msg msg--assistant">
            {liveReply ? <div className="streaming"><Markdown text={liveReply} /></div> : <div className="bubble bubble--think inline"><span /><span /><span /></div>}
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="chat-input">
        <textarea
          rows={2}
          value={text}
          placeholder={`Mensaje para ${agent.name}…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <MicButton onText={(t) => setText((p) => (p ? `${p} ${t}` : t))} />
        {agent.isBrain && (
          <button className="btn btn--ghost" disabled={!text.trim()} title="En lugar de responder solo, Claude reparte esto entre el equipo" onClick={async () => {
            await api.runTask(text.trim());
            setText('');
            toast('🧠 Claude armó el equipo: mira el progreso en la Oficina');
          }}>🚀 Al equipo</button>
        )}
        <button className="btn btn--primary" onClick={send} disabled={sending || !text.trim()}>Enviar</button>
      </div>
      {msgs.length > 0 && (
        <button className="link small" onClick={async () => { await api.clearChat(agent.id); setMsgs([]); }}>Borrar conversación</button>
      )}
    </div>
  );
}

function TrainingTab({ agent }: { agent: Agent }) {
  const { reloadAgents, toast } = useOffice();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [learning, setLearning] = useState(false);

  async function add() {
    if (!content.trim()) return;
    await api.addKnowledge(agent.id, { title: title || 'Lección', content });
    setTitle('');
    setContent('');
    await reloadAgents();
    toast(`🎓 ${agent.name} aprendió algo nuevo`);
  }

  async function loadFile(f: File) {
    const txt = await f.text();
    setTitle(f.name.replace(/\.[^.]+$/, ''));
    setContent(txt.slice(0, 20000));
  }

  return (
    <div className="stack">
      <p className="muted small">
        Enséñale a {agent.name}: guías de estilo, datos de tu negocio, ejemplos de buenas respuestas o reglas. Todo esto se incluye en cada petición que reciba, así que se especializa en lo tuyo.
      </p>
      <input placeholder="Título (ej.: Tono de mi marca)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea rows={6} placeholder="Contenido de la lección…" value={content} onChange={(e) => setContent(e.target.value)} />
      <div className="row">
        <label className="btn btn--ghost">
          📄 Cargar archivo de texto
          <input type="file" accept=".txt,.md,.csv,.json" hidden onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
        </label>
        <button className="btn btn--primary" onClick={add} disabled={!content.trim()}>Añadir lección</button>
      </div>
      <div className="card self-train">
        <strong>🔁 Aprender de mi experiencia</strong>
        <p className="muted small">{agent.name} repasa su memoria y sus últimos trabajos y escribe sus lecciones aprendidas. Así se especializa sola con el uso.</p>
        <button className="btn btn--ghost small" disabled={learning} onClick={async () => {
          setLearning(true);
          try {
            await api.selfTrain(agent.id);
            await reloadAgents();
            toast(`🎓 ${agent.name} escribió sus lecciones aprendidas`);
          } catch (err) {
            toast((err as Error).message);
          } finally {
            setLearning(false);
          }
        }}>{learning ? 'Repasando…' : 'Aprender ahora'}</button>
      </div>
      <h3>Lecciones ({agent.knowledge?.length || 0})</h3>
      {(agent.knowledge || []).map((k) => (
        <details key={k.id} className="card">
          <summary>
            <strong>{k.title}</strong> {k.builtin ? <span className="pill">de fábrica</span> : <small className="muted">{new Date(k.at).toLocaleDateString()}</small>}
            <button className="link danger" onClick={async (e) => { e.preventDefault(); await api.deleteKnowledge(agent.id, k.id); reloadAgents(); }}>Quitar</button>
          </summary>
          <pre className="pre">{k.content}</pre>
        </details>
      ))}
    </div>
  );
}

function MemoryTab({ agent }: { agent: Agent }) {
  const { reloadAgents } = useOffice();
  const mem = [...(agent.memory || [])].reverse();
  return (
    <div className="stack">
      <p className="muted small">La memoria se llena sola cada vez que {agent.name} trabaja en una tarea. Le ayuda a mantener el contexto de tus proyectos.</p>
      {mem.length === 0 && <p className="muted center">Aún no tiene recuerdos.</p>}
      <ul className="memory">
        {mem.map((m, i) => (
          <li key={i}>
            <small className="muted">{new Date(m.at).toLocaleString()}</small>
            <p>{m.text}</p>
          </li>
        ))}
      </ul>
      {mem.length > 0 && <button className="btn btn--ghost" onClick={async () => { await api.clearMemory(agent.id); reloadAgents(); }}>Borrar memoria</button>}
    </div>
  );
}

const SKINS = ['#fde7d6', '#f6d7c3', '#f1c7a5', '#e8b890', '#e0ac69', '#d59a6a', '#c68642', '#8d5524'];

function ProfileTab({ agent, onDeleted }: { agent: Agent; onDeleted: () => void }) {
  const { reloadAgents, toast, providers, departments, freeModels } = useOffice();
  const [f, setF] = useState(agent);
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => setF(agent), [agent]);
  useEffect(() => {
    api.settings().then((s) => setAccounts(s.accounts || []));
  }, []);
  // Ollama: el de este computador o el de un nodo (se pueden usar varios a la vez).
  const [ollamas, setOllamas] = useState<OllamaServer[] | null>(null);
  useEffect(() => {
    if (f.provider === 'ollama' && !ollamas) api.ollamaServers().then(setOllamas).catch(() => setOllamas([]));
  }, [f.provider, ollamas]);
  const mine = accounts.filter((a) => a.provider === f.provider);
  const ollamaIds = ['auto', ...(ollamas || []).map((o) => o.id)];
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setF((x) => ({ ...x, [k]: v }));
  const setAv = (k: keyof Agent['avatar'], v: string) => setF((x) => ({ ...x, avatar: { ...x.avatar, [k]: v } }));

  async function save() {
    await api.updateAgent(agent.id, {
      name: f.name, role: f.role, department: f.department, provider: f.provider, model: f.model,
      skills: f.skills, system: f.system, avatar: f.avatar, enabled: f.enabled,
      account: f.provider === 'ollama' ? (f.account && ollamaIds.includes(f.account) ? f.account : 'default') : mine.some((a) => a.id === f.account) ? f.account : 'default',
    });
    await reloadAgents();
    toast('✅ Perfil guardado');
  }

  return (
    <div className="stack">
      <div className="avatar-editor">
        <Chibi avatar={f.avatar} size={110} legs state="idle" />
        <div className="grid2">
          <label>Piel<div className="swatches">{SKINS.map((c) => <button key={c} style={{ background: c }} className={f.avatar.skin === c ? 'on' : ''} onClick={() => setAv('skin', c)} />)}</div></label>
          <label>Pelo <input type="color" value={f.avatar.hair} onChange={(e) => setAv('hair', e.target.value)} /></label>
          <label>Ropa <input type="color" value={f.avatar.outfit} onChange={(e) => setAv('outfit', e.target.value)} /></label>
          <label>Peinado<select value={f.avatar.hairStyle} onChange={(e) => setAv('hairStyle', e.target.value)}>{HAIR_STYLES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Ojos<select value={f.avatar.eyes} onChange={(e) => setAv('eyes', e.target.value)}>{EYE_STYLES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Accesorio<select value={f.avatar.accessory} onChange={(e) => setAv('accessory', e.target.value)}>{ACCESSORIES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Skin / disfraz<select value={f.avatar.costume || 'none'} onChange={(e) => setAv('costume', e.target.value)}>{Object.entries(COSTUMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Objeto (emoji) <input value={f.avatar.prop} maxLength={4} onChange={(e) => setAv('prop', e.target.value)} /></label>
        </div>
      </div>
      <div className="grid2">
        <label>Nombre<input value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label>Rol<input value={f.role} onChange={(e) => set('role', e.target.value)} /></label>
        <label>Proveedor
          <select value={f.provider} onChange={(e) => set('provider', e.target.value)}>
            {(['gratis', 'mixto', 'suscripcion', 'pago'] as const).map((t) => (
              <optgroup key={t} label={TIER_LABEL[t]}>
                {providers.filter((p) => p.tier === t).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>Modelo
          <input list={`perfil-modelos-${f.provider}`} value={f.model} onChange={(e) => set('model', e.target.value)} placeholder={providers.find((p) => p.id === f.provider)?.cli ? 'lo elige la herramienta' : 'id del modelo'} />
          <datalist id={`perfil-modelos-${f.provider}`}>{(freeModels[f.provider] || []).map((m) => <option key={m.id} value={m.id}>{m.label} (gratis · {m.for})</option>)}</datalist>
        </label>
        {f.provider === 'ollama' && ollamas && ollamas.length > 1 && (
          <label>¿Qué Ollama usa?
            <select value={f.account && ollamaIds.includes(f.account) ? f.account : 'default'} onChange={(e) => set('account', e.target.value)}>
              <option value="default">El preferido de la oficina</option>
              <option value="auto">Automático (el menos ocupado)</option>
              {ollamas.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}{o.running ? '' : ' (apagado)'}{f.model && o.running && !o.models.some((m) => m.name === f.model || m.name === `${f.model}:latest`) ? ' · sin este modelo' : ''}
                </option>
              ))}
            </select>
            <small className="muted">Si ese computador está apagado o no tiene el modelo, usa otro.</small>
          </label>
        )}
        {mine.length > 0 && f.provider !== 'ollama' && (
          <label>Cuenta que usa primero
            <select value={f.account || 'default'} onChange={(e) => set('account', e.target.value)}>
              <option value="default">Principal</option>
              {mine.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
        )}
        {!agent.isBrain && (
          <label>Departamento
            <select value={f.department} onChange={(e) => set('department', e.target.value)}>
              {departments.filter((d) => d.id !== 'direccion').map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
            </select>
          </label>
        )}
        {!agent.isBrain && (
          <label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Activa (el cerebro puede asignarle tareas)</label>
        )}
      </div>
      <label>Habilidades (separadas por coma; el cerebro las usa para repartir trabajo)
        <input value={f.skills.join(', ')} onChange={(e) => set('skills', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </label>
      <label>Instrucciones de sistema (su personalidad y especialidad)
        <textarea rows={6} value={f.system} onChange={(e) => set('system', e.target.value)} />
      </label>
      {agent.isBrain && <p className="muted small">El modelo del cerebro también se puede cambiar en Ajustes.</p>}
      <div className="row">
        <button className="btn btn--primary" onClick={save}>Guardar</button>
        <button className="btn btn--ghost" title="Descarga esta IA (perfil, avatar y lecciones) para compartirla" onClick={() => {
          const { id: _id, memory: _m, stats: _s, live: _l, isBrain: _b, ...shareable } = agent;
          const url = URL.createObjectURL(new Blob([JSON.stringify({ oficinaIA: 1, agent: shareable }, null, 2)], { type: 'application/json' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = `IA-${agent.name}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }}>⬇️ Exportar IA</button>
        {!agent.isBrain && (
          <button className="btn btn--danger" onClick={async () => {
            if (!confirm(`¿Despedir a ${agent.name}? Se borran su entrenamiento y memoria.`)) return;
            await api.deleteAgent(agent.id);
            await reloadAgents();
            onDeleted();
          }}>Despedir</button>
        )}
      </div>
    </div>
  );
}

/** Hasta 2 asistentes especializados; el jefe decide cuándo delegarles. */
function AssistantsTab({ agent }: { agent: Agent }) {
  const { reloadAgents, toast, providers, freeModels, suggestedAssistants } = useOffice();
  const [list, setList] = useState<AssistantDef[]>(agent.assistants || []);
  const [focus, setFocus] = useState('');
  useEffect(() => setList(agent.assistants || []), [agent]);
  const save = async (next: AssistantDef[], msg = '✅ Asistentes guardados') => {
    const a = await api.updateAgent(agent.id, { assistants: next });
    setList(a.assistants || []);
    await reloadAgents();
    toast(msg);
  };
  const add = (f: string) => {
    if (!f.trim() || list.length >= 2) return;
    save([...list, { id: '', name: '', focus: f.trim(), provider: 'groq', model: 'llama-3.3-70b-versatile' }], `👥 ${agent.name} tiene un asistente de ${f.trim()}`);
    setFocus('');
  };
  const edit = (i: number, patch: Partial<AssistantDef>) => setList(list.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const ideas = (suggestedAssistants[agent.id] || []).filter((f) => !list.some((x) => x.focus === f));
  return (
    <div className="stack">
      <p className="muted small">
        Los asistentes son especialistas en una tecnología o tema. Cuando una tarea es compleja, {agent.name} les delega partes, ellos trabajan en paralelo y {agent.name} revisa e integra lo que entregan. Si la tarea es simple, la hace solo.
        Usan modelos rápidos y gratis para gastar poco.
      </p>
      <label className="check">
        <input type="checkbox" checked={agent.delegate !== false} onChange={async (e) => { await api.updateAgent(agent.id, { delegate: e.target.checked }); await reloadAgents(); }} />
        Dejar que {agent.name} delegue en sus asistentes
      </label>
      {list.map((a, i) => (
        <div key={a.id || i} className="assistant-card">
          <div className="grid2">
            <label>Nombre<input value={a.name} onChange={(e) => edit(i, { name: e.target.value })} /></label>
            <label>Especialidad<input value={a.focus} onChange={(e) => edit(i, { focus: e.target.value })} /></label>
            <label>Proveedor
              <select value={a.provider} onChange={(e) => edit(i, { provider: e.target.value, model: freeModels[e.target.value]?.[0]?.id || a.model })}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label>Modelo
              <input list={`as-models-${i}`} value={a.model} onChange={(e) => edit(i, { model: e.target.value })} />
              <datalist id={`as-models-${i}`}>{(freeModels[a.provider] || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
            </label>
          </div>
          <div className="row">
            <button className="btn btn--primary small" onClick={() => save(list)}>Guardar</button>
            <button className="btn btn--ghost small" onClick={() => save(list.filter((_, k) => k !== i), 'Asistente quitado')}>Quitar</button>
          </div>
        </div>
      ))}
      {list.length < 2 && (
        <>
          <div className="row">
            <input value={focus} onChange={(e) => setFocus(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(focus)} placeholder="Especialidad, p. ej. React, Python, Excel, resina…" />
            <button className="btn btn--primary small" disabled={!focus.trim()} onClick={() => add(focus)}>＋ Agregar asistente</button>
          </div>
          {ideas.length > 0 && <div className="row small"><span className="muted">Sugeridos:</span>{ideas.map((f) => <button key={f} className="btn btn--ghost small" onClick={() => add(f)}>＋ {f}</button>)}</div>}
        </>
      )}
      {list.length >= 2 && <p className="muted small">Máximo 2 asistentes por IA, para que no se disparen las llamadas.</p>}
    </div>
  );
}
