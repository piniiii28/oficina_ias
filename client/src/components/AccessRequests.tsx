// Peticiones de acceso de las IAs: aparecen abajo a la derecha y tú decides.
import { api } from '../api';
import { Chibi } from './Chibi';
import { useOffice } from '../state';

export function AccessRequests() {
  const { accessRequests, agents, toast } = useOffice();
  if (!accessRequests.length) return null;
  const answer = async (id: string, decision: 'always' | 'once' | 'deny') => {
    try {
      await api.decideAccess(id, decision);
      toast(decision === 'deny' ? '🚫 Acceso rechazado' : decision === 'always' ? '🔓 Permitido siempre (lo puedes quitar en Ajustes → Accesos)' : '🔓 Permitido solo esta vez');
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    }
  };
  return (
    <div className="access-requests" role="alertdialog" aria-label="Peticiones de acceso">
      {accessRequests.map((r) => {
        const a = agents.find((x) => x.id === r.agentId);
        return (
          <div key={r.id} className="access-card">
            <header>
              {a && <Chibi avatar={a.avatar} size={40} state="thinking" />}
              <div>
                <strong>🔐 {r.agentName} pide {r.mode === 'controlar' ? 'trabajar en' : r.mode === 'escribir' ? 'guardar archivos en' : 'ver'}</strong>
                <code>{r.path}</code>
              </div>
            </header>
            {r.reason && <p className="small">«{r.reason}»</p>}
            <p className="muted small">Acción: {r.action}</p>
            {r.code && <details><summary className="small">Ver el código que va a ejecutar</summary><pre className="log">{r.code}</pre></details>}
            <div className="row">
              <button className="btn btn--primary small" onClick={() => answer(r.id, 'always')}>Permitir siempre</button>
              <button className="btn btn--ghost small" onClick={() => answer(r.id, 'once')}>Solo esta vez</button>
              <button className="btn btn--ghost small danger" onClick={() => answer(r.id, 'deny')}>Rechazar</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
