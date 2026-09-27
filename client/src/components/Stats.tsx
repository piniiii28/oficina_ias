// Panel de actividad: cifras destacadas y ranking de IAs por trabajos hechos.
import { useEffect, useState } from 'react';
import { api, type NoteSummary } from '../api';
import { useOffice } from '../state';

export function Stats() {
  const { agents, tasks, meetings, notesVersion } = useOffice();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  useEffect(() => { api.notes().then(setNotes); }, [notesVersion]);

  const done = tasks.filter((t) => t.status === 'done').length;
  const ideas = notes.filter((n) => n.type === 'idea').length;
  const ranking = [...agents].filter((a) => (a.stats?.tasks || 0) > 0).sort((a, b) => (b.stats?.tasks || 0) - (a.stats?.tasks || 0)).slice(0, 8);
  const max = Math.max(1, ...ranking.map((a) => a.stats?.tasks || 0));
  const tiles = [
    { label: 'Tareas completadas', value: done },
    { label: 'Notas en el grafo', value: notes.length },
    { label: 'Ideas', value: ideas },
    { label: 'Reuniones', value: meetings.length },
  ];

  return (
    <section className="stats card">
      <div className="stat-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="stat-tile">
            <strong>{t.value}</strong>
            <small>{t.label}</small>
          </div>
        ))}
      </div>
      <div className="ranking">
        <h3>IAs más activas</h3>
        {!ranking.length && <p className="muted small">Aún nadie ha trabajado. Envía una tarea desde la Oficina.</p>}
        {ranking.map((a) => {
          const n = a.stats?.tasks || 0;
          return (
            <div key={a.id} className="rank-row" title={`${a.name}: ${n} trabajo${n === 1 ? '' : 's'}`}>
              <span className="rank-name">{a.avatar.prop} {a.name}</span>
              <span className="rank-bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
              <span className="rank-value">{n}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
