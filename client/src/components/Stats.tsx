// Panel de actividad: cifras destacadas y ranking de IAs por trabajos hechos.
import { useEffect, useState } from 'react';
import { api, type NoteSummary } from '../api';
import { useOffice } from '../state';

export function Stats() {
  const { agents, tasks, meetings, notesVersion, providers } = useOffice();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [usage, setUsage] = useState<Record<string, { calls: number; inChars: number; outChars: number }>>({});
  useEffect(() => { api.notes().then(setNotes); api.usage().then(setUsage); }, [notesVersion]);
  const usageRows = Object.entries(usage).sort((a, b) => b[1].calls - a[1].calls);

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
        {usageRows.length > 0 && (
          <>
            <h3>Uso real por proveedor</h3>
            <table className="usage">
              <thead><tr><th>Proveedor</th><th>Llamadas</th><th>Tokens aprox. (entrada / salida)</th></tr></thead>
              <tbody>
                {usageRows.map(([p, u]) => (
                  <tr key={p}>
                    <td>{providers.find((x) => x.id === p)?.label || p}</td>
                    <td>{u.calls}</td>
                    <td>{Math.round(u.inChars / 4).toLocaleString()} / {Math.round(u.outChars / 4).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Estimado (≈4 caracteres por token). Revisa el costo exacto en el panel de cada proveedor. <button className="link" onClick={async () => { await api.resetUsage(); setUsage({}); }}>Reiniciar</button></p>
          </>
        )}
        <h3>IAs más activas</h3>
        {!ranking.length && <p className="muted small">Aún nadie ha trabajado. Envía una tarea desde la Oficina.</p>}
        {ranking.map((a) => {
          const n = a.stats?.tasks || 0;
          return (
            <div key={a.id} className="rank-row" title={`${a.name}: ${n} trabajo${n === 1 ? '' : 's'}`}>
              <span className="rank-name">{a.avatar.prop} {a.name}</span>
              <span className="rank-bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
              <span className="rank-value">{n}{a.stats?.likes ? ` · 👍${a.stats.likes}` : ''}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
