// Panel lateral de una IA: chat directo, entrenamiento, memoria y perfil.
import { useEffect, useRef, useState } from 'react';
import { api, levelOf, type Agent, type ChatMessage } from '../api';
import { Chibi, ACCESSORIES, COSTUMES, EYE_STYLES, HAIR_STYLES } from './Chibi';
import { Markdown } from './Markdown';
import { useOffice } from '../state';

type Tab = 'chat' | 'entrenamiento' | 'memoria' | 'perfil';

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
            <h2>{agent.name} <span className="level" title="Sube de nivel al completar trabajos">Nv {levelOf(agent)}</span></h2>
            <p className="muted">{agent.role}</p>
            <p className="small">
              <span className={`dot ${agent.live ? 'dot--live' : 'dot--demo'}`} /> {agent.live ? 'Conectada' : 'Modo demo'} · {agent.provider} / <code>{agent.model || '—'}</code>
            </p>
            <p className="small muted">{status} · {agent.stats?.tasks || 0} trabajos · {agent.knowledge?.length || 0} {agent.knowledge?.length === 1 ? 'lección' : 'lecciones'}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>
        <nav className="tabs">
          {(['chat', 'entrenamiento', 'memoria', 'perfil'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {{ chat: '💬 Chat', entrenamiento: '🎓 Entrenamiento', memoria: '🧠 Memoria', perfil: '⚙️ Perfil' }[t]}
            </button>
          ))}
        </nav>
        <div className="drawer-body">
          {tab === 'chat' && <ChatTab agent={agent} />}
          {tab === 'entrenamiento' && <TrainingTab agent={agent} />}
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
  const { reloadAgents, toast, providers, departments } = useOffice();
  const [f, setF] = useState(agent);
  useEffect(() => setF(agent), [agent]);
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setF((x) => ({ ...x, [k]: v }));
  const setAv = (k: keyof Agent['avatar'], v: string) => setF((x) => ({ ...x, avatar: { ...x.avatar, [k]: v } }));

  async function save() {
    await api.updateAgent(agent.id, {
      name: f.name, role: f.role, department: f.department, provider: f.provider, model: f.model,
      skills: f.skills, system: f.system, avatar: f.avatar, enabled: f.enabled,
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
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label>Modelo<input value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="id del modelo" /></label>
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
