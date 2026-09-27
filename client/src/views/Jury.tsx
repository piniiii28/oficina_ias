// Jurado: las IAs se califican entre sí (a ciegas, con jueces de otro
// proveedor) para mejorar el medidor de acierto.
import { useEffect, useState } from 'react';
import { api, type JuryReport } from '../api';
import { Chibi } from '../components/Chibi';
import { useOffice } from '../state';

export function Jury() {
  const { agents, toast, tasks } = useOffice();
  const [r, setR] = useState<JuryReport | null>(null);
  const load = () => api.jury().then(setR).catch(() => {});
  useEffect(() => {
    load();
  }, [tasks]);
  if (!r) return <div className="empty">Cargando…</div>;
  const ag = (id: string) => agents.find((a) => a.id === id);
  const liveCount = agents.filter((a) => a.live).length;
  return (
    <div className="jury">
      <header>
        <h2>⚖️ Jurado</h2>
        <p className="muted">Después de cada aporte, un jurado de 1 a 3 IAs lo califica de 1 a 5. Califican <b>a ciegas</b> (sin saber quién lo escribió), con una rúbrica fija y prefiriendo jueces de <b>otro proveedor</b>, para que un modelo no favorezca a los de su familia. La nota es la mediana y alimenta el medidor 🎯 de cada IA; tus 👍/👎 siguen pesando más.</p>
      </header>
      <section className="card">
        <label className="check">
          <input type="checkbox" checked={r.settings.enabled} onChange={async (e) => { await api.saveSettings({ jury: { ...r.settings, enabled: e.target.checked } }); load(); }} />
          Activar el jurado en cada tarea
        </label>
        <label className="check">
          Jueces por aporte{' '}
          <select value={r.settings.size} onChange={async (e) => { await api.saveSettings({ jury: { ...r.settings, size: Number(e.target.value) } }); load(); }}>
            <option value={1}>1 (más barato)</option>
            <option value={2}>2</option>
            <option value={3}>3 (más confiable)</option>
          </select>
        </label>
        <p className="muted small">Cada juez es una llamada extra por aporte: con planes gratis, 2 jueces es un buen equilibrio. Solo participan IAs conectadas ({liveCount} ahora); en modo demo no hay jurado porque las notas serían inventadas.</p>
      </section>

      <section className="card">
        <h3>Jueces</h3>
        {!r.judges.length && <p className="muted small">Todavía no hay veredictos.</p>}
        <div className="judge-list">
          {r.judges.map((j) => {
            const a = ag(j.id);
            return (
              <div key={j.id} className="judge">
                {a && <Chibi avatar={a.avatar} size={40} />}
                <div>
                  <b>{j.name}</b>
                  <small>{j.votes} votos · promedio {j.average}/5</small>
                  <small className={Math.abs(j.generosity) >= 1 ? 'warn' : 'muted'}>{j.generosity > 0.4 ? `Generoso (+${j.generosity})` : j.generosity < -0.4 ? `Estricto (${j.generosity})` : 'Equilibrado'}</small>
                  <small className="muted">{j.agreement === null ? 'Aún no hay 👍/👎 tuyos para comparar' : `Coincide contigo el ${j.agreement} % (${j.compared})`}</small>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h3>Veredictos recientes</h3>
        {!r.recent.length && <p className="muted small">Activa el jurado y lanza una tarea con IAs conectadas. También puedes pedirle al jurado que califique un aporte desde la sección Tareas.</p>}
        <ul className="verdicts">
          {r.recent.map((v) => (
            <li key={v.taskId + v.agentId}>
              <div className="row between">
                <span><b>{ag(v.agentId)?.name || v.agentId}</b> en «{v.task}»</span>
                <span className={`pill ${v.score >= 4 ? 'pill--done' : v.score <= 2 ? 'pill--error' : ''}`}>⚖️ {v.score}/5{v.rating ? (v.rating > 0 ? ' · tu 👍' : ' · tu 👎') : ''}</span>
              </div>
              <ul className="small">{v.votes.map((x) => <li key={x.judgeId}>{x.name}: <b>{x.score}</b> — {x.reason}</li>)}</ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>¿Puede fallar?</h3>
        <ul className="small">
          <li><b>Las IAs no pueden comprobar datos del mundo real</b>: un jurado puede aprobar algo que suena bien pero es falso. Por eso tus 👍/👎 pesan el doble.</li>
          <li><b>Sesgos conocidos:</b> algunas IAs premian las respuestas largas o parecidas a su estilo. La rúbrica, el anonimato y los jueces de otro proveedor lo reducen, pero no lo eliminan. Aquí ves qué jueces son generosos o estrictos.</li>
          <li><b>Costo y límites:</b> cada juez es una llamada más; con muchos jueces se agotan antes los planes gratis.</li>
          <li><b>No se califican a sí mismas</b> ni se usa en modo demo.</li>
        </ul>
        <button className="btn btn--ghost small" onClick={() => { load(); toast('🔄 Actualizado'); }}>Actualizar</button>
      </section>
    </div>
  );
}
