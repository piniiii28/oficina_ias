// Sala de reuniones: las IAs se sientan en una mesa redonda y conversan por turnos.
import { useEffect, useRef, useState } from 'react';
import { api, type Meeting } from '../api';
import { Chibi } from '../components/Chibi';
import { Markdown } from '../components/Markdown';
import { useOffice } from '../state';

const PRESETS = [
  { label: '🚀 Lanzar un producto', ids: ['estratega', 'command-mkt', 'gemini-visual', 'llama-fin'] },
  { label: '💻 Revisión técnica', ids: ['codex', 'opencode', 'sonnet-qa', 'guardian'] },
  { label: '📚 Aprender un tema', ids: ['phi-tutor', 'perplexity', 'deepseek-r'] },
  { label: '🎬 Idea creativa', ids: ['mistral-story', 'grok', 'chatgpt', 'gemini-visual'] },
];

export function Meetings() {
  const { meetings, agents, live, toast, openNote, setMeetings } = useOffice();
  const [topic, setTopic] = useState('');
  const [pick, setPick] = useState<string[]>(PRESETS[0].ids);
  const [rounds, setRounds] = useState(2);
  const [openId, setOpenId] = useState<string | null>(null);
  const current = meetings.find((m) => m.id === openId) || meetings[0];
  const staff = agents.filter((a) => !a.isBrain && a.enabled && a.usable !== false);
  const brain = agents.find((a) => a.isBrain);

  async function start() {
    try {
      const { id } = await api.startMeeting(topic.trim(), pick, rounds);
      setOpenId(id);
      setTopic('');
      toast('🗣️ La reunión comenzó');
    } catch (err) {
      toast(`Error: ${(err as Error).message}`);
    }
  }

  return (
    <div className="meetings">
      <aside className="meetings-side">
        <section className="card stack">
          <h2>Nueva reunión</h2>
          <textarea rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Tema: ¿Cómo conseguimos los primeros 100 clientes?" />
          <div className="step-chips">
            {PRESETS.map((p) => <button key={p.label} className="chip chip--example" onClick={() => setPick(p.ids.filter((id) => staff.some((a) => a.id === id)))}>{p.label}</button>)}
          </div>
          <div className="picker">
            {staff.map((a, i) => {
              const on = pick.includes(a.id);
              return (
                <button key={a.id} className={`pick ${on ? 'on' : ''}`} title={`${a.name} · ${a.role}`} disabled={!on && pick.length >= 6}
                  onClick={() => setPick((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))}>
                  <Chibi avatar={a.avatar} size={34} seed={i} />
                  <small>{a.name}</small>
                </button>
              );
            })}
          </div>
          <div className="row between">
            <label className="check">Rondas
              <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} style={{ width: 'auto' }}>
                <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
              </select>
            </label>
            <span className="muted small">{pick.length}/6 IAs</span>
          </div>
          <button className="btn btn--primary" disabled={!topic.trim() || pick.length < 2} onClick={start}>Empezar reunión</button>
        </section>
        <div className="meeting-list">
          {meetings.map((m) => (
            <button key={m.id} className={`task-item ${current?.id === m.id ? 'active' : ''}`} onClick={() => setOpenId(m.id)}>
              <strong>{m.topic.slice(0, 70)}</strong>
              <small className="muted">{new Date(m.createdAt).toLocaleString()} · {m.agentIds.length} IAs</small>
              <span className={`pill pill--${m.status === 'running' ? 'working' : m.status}`}>{m.status === 'running' ? 'en curso' : m.status === 'done' ? 'terminada' : 'error'}</span>
            </button>
          ))}
        </div>
      </aside>
      <main className="meeting-main">
        {current ? (
          <MeetingRoom meeting={current} onDelete={async () => {
            await api.deleteMeeting(current.id);
            setMeetings(meetings.filter((m) => m.id !== current.id));
            setOpenId(null);
          }} openNote={openNote} live={live} agents={agents} brainId={brain?.id} />
        ) : (
          <div className="empty">Elige un tema y a las IAs que quieres reunir. Conversarán entre ellas y Claude resumirá los acuerdos.</div>
        )}
      </main>
    </div>
  );
}

function MeetingRoom({ meeting, onDelete, openNote, live, agents, brainId }: {
  meeting: Meeting;
  onDelete: () => void;
  openNote: ReturnType<typeof useOffice>['openNote'];
  live: ReturnType<typeof useOffice>['live'];
  agents: ReturnType<typeof useOffice>['agents'];
  brainId?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), [meeting.transcript.length]);
  const seats = [...meeting.agentIds, ...(brainId ? [brainId] : [])];
  const byId = (id: string) => agents.find((a) => a.id === id);
  const lastLine = (id: string) => [...meeting.transcript].reverse().find((t) => t.agentId === id);

  return (
    <div className="meeting-room">
      <header className="row between">
        <h2>{meeting.topic}</h2>
        <div className="row">
          {meeting.noteId && <button className="btn btn--ghost small" onClick={() => openNote({ id: meeting.noteId! })}>📝 Ver nota</button>}
          {meeting.status === 'running' && <button className="btn btn--ghost small" onClick={() => fetch(`/api/meetings/${meeting.id}/stop`, { method: 'POST' })}>⏹️ Terminar y resumir</button>}
          <button className="btn btn--danger small" onClick={onDelete}>Borrar</button>
        </div>
      </header>

      <div className="round-table">
        <div className="table-top">
          <span>🗣️</span>
          <small>{meeting.status === 'running' ? `Ronda ${Math.min(meeting.rounds, (meeting.transcript.at(-1)?.round || 1))} de ${meeting.rounds}` : meeting.status === 'done' ? 'Reunión terminada' : 'Error'}</small>
        </div>
        {seats.map((id, i) => {
          const a = byId(id);
          if (!a) return null;
          const angle = (i / seats.length) * Math.PI * 2 - Math.PI / 2;
          const speaking = meeting.speaking === id;
          const line = lastLine(id);
          return (
            <div key={id} className={`seat ${speaking ? 'seat--speaking' : ''}`} style={{ left: `calc(50% + ${Math.cos(angle) * 40}% )`, top: `calc(50% + ${Math.sin(angle) * 36}%)` }}>
              {speaking && <div className="bubble bubble--think"><span /><span /><span /></div>}
              {!speaking && line && meeting.status === 'running' && <div className="bubble" title={line.text}>{line.text.replace(/[*#>]/g, '').slice(0, 34)}…</div>}
              <Chibi avatar={a.avatar} size={64} seed={i} state={speaking ? (live[id]?.status === 'talking' ? 'talking' : 'thinking') : 'idle'} />
              <small className="seat-name">{a.name}</small>
            </div>
          );
        })}
      </div>

      <section className="transcript">
        {meeting.transcript.map((t, i) => {
          const a = byId(t.agentId);
          return (
            <div key={i} className="line">
              {a ? <Chibi avatar={a.avatar} size={36} /> : <span className="you-badge">🙋</span>}
              <div>
                <strong>{t.name}</strong> <small className="muted">ronda {t.round}{t.simulated ? ' · demo' : ''}{t.via ? ` · con el motor de ${byId(t.via)?.name || t.via}` : ''}</small>
                <Markdown text={t.text} />
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </section>
      {meeting.status === 'running' && <SayBox id={meeting.id} />}
      {meeting.summary && (
        <section className="card final">
          <h3>Resumen de {byId(meeting.summaryBy || brainId || '')?.name || 'Claude'}</h3>
          <Markdown text={meeting.summary} onLink={(t) => openNote({ title: t })} />
        </section>
      )}
    </div>
  );
}

function SayBox({ id }: { id: string }) {
  const [text, setText] = useState('');
  const { toast } = useOffice();
  return (
    <div className="chat-input">
      <textarea rows={2} value={text} placeholder="Intervén en la reunión: tu opinión, una pregunta o un dato…" onChange={(e) => setText(e.target.value)} />
      <button className="btn btn--primary" disabled={!text.trim()} onClick={async () => {
        try {
          await fetch(`/api/meetings/${id}/say`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).then((r) => { if (!r.ok) throw new Error('La reunión ya terminó'); });
          setText('');
        } catch (err) {
          toast((err as Error).message);
        }
      }}>Hablar</button>
    </div>
  );
}
