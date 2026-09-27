// Medidores de una IA: 🎯 acierto (qué tan buenas resultan sus respuestas) y
// 🔥 carga (qué tan cerca está de responder peor: textos largos, varias
// tareas, errores, memoria o chat muy largos).
import { useOffice } from '../state';

const LOAD_EMOJI = { tranquila: '😌', ocupada: '🙂', cargada: '😰', saturada: '🥵' } as const;
const PART_ES: Record<string, string> = {
  contexto: 'Texto que recibe', trabajo: 'Tareas a la vez', errores: 'Errores recientes', memoria: 'Memoria y entrenamiento', chat: 'Largo del chat',
  valoraciones: 'Tus 👍/👎', verificador: 'Nota del verificador', fiabilidad: 'Tareas sin fallar',
};

const accColor = (v: number) => (v >= 75 ? 'var(--ok)' : v >= 55 ? 'var(--warn)' : 'var(--danger)');
const loadColor = (v: number) => (v < 30 ? 'var(--ok)' : v < 60 ? '#eab308' : v < 80 ? 'var(--warn)' : 'var(--danger)');

export function Meters({ agentId, full = false }: { agentId: string; full?: boolean }) {
  const { metrics } = useOffice();
  const m = metrics[agentId];
  if (!m) return null;
  const { accuracy: a, load: l } = m;
  const accTitle = `Acierto ${a.score}/100 · ${a.signals ? `${a.signals} señales` : 'todavía sin valoraciones (parte de 70)'}\n${Object.entries(a.parts).filter(([, v]) => v).map(([k, v]) => `${PART_ES[k]}: ${v!.value} (${v!.n})`).join('\n')}`;
  const loadTitle = `Carga ${l.score}/100 (${l.level})\n${Object.entries(l.parts).map(([k, v]) => `${PART_ES[k]}: ${v}`).join('\n')}${l.tips.length ? `\n\n${l.tips.join('\n')}` : ''}`;
  return (
    <div className={`meters ${full ? 'meters--full' : ''}`}>
      <div className="meter" title={accTitle}>
        <span>🎯 {full ? 'Acierto' : ''} <b>{a.score}</b>{full && !a.signals && <small className="muted"> (sin datos aún)</small>}</span>
        <i><em style={{ width: `${a.score}%`, background: accColor(a.score) }} /></i>
      </div>
      <div className="meter" title={loadTitle}>
        <span>{LOAD_EMOJI[l.level]} {full ? 'Carga' : ''} <b>{l.score}</b>{full && <small className="muted"> {l.level}</small>}</span>
        <i><em style={{ width: `${Math.max(3, l.score)}%`, background: loadColor(l.score) }} /></i>
      </div>
      {full && (
        <div className="meter-detail small">
          <div>
            {Object.entries(a.parts).filter(([, v]) => v).map(([k, v]) => <span key={k} className="pill">{PART_ES[k]}: {v!.value} % ({v!.n})</span>)}
            {!a.signals && <span className="muted">Valora sus aportes con 👍/👎 (o activa el verificador en Ajustes) para que este medidor sea más preciso.</span>}
          </div>
          {l.tips.length > 0 && <ul>{l.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
          {l.lastError && <p className="muted">Último error: {l.lastError}</p>}
        </div>
      )}
    </div>
  );
}
