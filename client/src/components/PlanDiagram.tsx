// Diagrama del plan: columnas por etapa y flechas de quién usa la entrega de quién.
import type { Agent, Task } from '../api';

const STATUS_COLOR: Record<string, string> = { pending: 'var(--muted)', working: 'var(--accent)', done: 'var(--ok)', error: 'var(--danger)' };

export function PlanDiagram({ task, agents }: { task: Task; agents: Agent[] }) {
  const steps = task.steps;
  if (steps.length < 2) return null;
  const level = new Map<string, number>();
  for (const s of steps) level.set(s.agentId, 1 + Math.max(-1, ...(s.dependsOn || []).map((d) => level.get(d) ?? -1)));
  const cols = Math.max(...level.values()) + 1;
  const byCol = Array.from({ length: cols }, (_, c) => steps.filter((s) => level.get(s.agentId) === c));
  const rows = Math.max(...byCol.map((c) => c.length));
  const BW = 150, BH = 34, GX = 60, GY = 14;
  const W = cols * BW + (cols - 1) * GX + 8, H = rows * BH + (rows - 1) * GY + 8;
  const pos = new Map<string, { x: number; y: number }>();
  byCol.forEach((col, c) => col.forEach((s, r) => {
    const offset = ((rows - col.length) * (BH + GY)) / 2;
    pos.set(s.agentId, { x: 4 + c * (BW + GX), y: 4 + offset + r * (BH + GY) });
  }));
  const name = (id: string) => agents.find((a) => a.id === id);
  return (
    <div className="plan-diagram" role="img" aria-label="Diagrama del plan del equipo">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {steps.flatMap((s) => (s.dependsOn || []).map((d) => {
          const a = pos.get(d), b = pos.get(s.agentId);
          if (!a || !b) return null;
          const x1 = a.x + BW, y1 = a.y + BH / 2, x2 = b.x, y2 = b.y + BH / 2;
          return <path key={`${d}-${s.agentId}`} d={`M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2 - 2},${y2}`} fill="none" stroke="var(--muted)" strokeWidth="1.5" markerEnd="url(#arrow)" />;
        }))}
        {steps.map((s) => {
          const p = pos.get(s.agentId)!;
          const a = name(s.agentId);
          return (
            <g key={s.agentId}>
              <rect x={p.x} y={p.y} width={BW} height={BH} rx="9" fill="var(--panel)" stroke={STATUS_COLOR[s.status]} strokeWidth={s.status === 'working' ? 2.5 : 1.5} />
              <text x={p.x + 10} y={p.y + BH / 2 + 4} fontSize="12" fill="var(--text)" fontWeight="700">{a?.avatar.prop} {(a?.name || s.agentId).slice(0, 15)}</text>
              <circle cx={p.x + BW - 12} cy={p.y + BH / 2} r="4" fill={STATUS_COLOR[s.status]} />
            </g>
          );
        })}
      </svg>
      <small className="muted">De izquierda a derecha: las IAs de una misma columna trabajan en paralelo; las flechas muestran quién usa la entrega de quién.</small>
    </div>
  );
}
