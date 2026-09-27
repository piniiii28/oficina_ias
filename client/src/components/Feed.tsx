// Registro de actividad de la oficina, estilo chat de equipo.
import { useState } from 'react';
import { Chibi } from './Chibi';
import { useOffice } from '../state';

const VERB: Record<string, string> = { thinking: 'está pensando', working: 'trabaja en', talking: 'dice', done: 'terminó', error: 'tuvo un error' };

export function Feed() {
  const { feed, agents } = useOffice();
  const [open, setOpen] = useState(true);
  if (!feed.length) return null;
  return (
    <section className="feed card">
      <button className="routines-head" onClick={() => setOpen((o) => !o)}>
        📜 Actividad <span className="muted small">({feed.length})</span> <span className="muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul>
          {feed.slice(0, 30).map((e, i) => {
            const a = agents.find((x) => x.id === e.agentId);
            return (
              <li key={`${e.at}-${i}`} className={`feed-${e.status}`}>
                {a && <Chibi avatar={a.avatar} size={24} />}
                <span><strong>{a?.name || e.agentId}</strong> {VERB[e.status] || e.status}{e.message ? ':' : ''} <span className="muted">{e.message.slice(0, 140)}</span></span>
                <time className="muted small">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
