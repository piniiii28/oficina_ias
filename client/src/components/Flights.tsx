// Sobres que vuelan por la oficina: del cerebro a cada IA cuando recibe su
// encargo, entre compañeros cuando uno usa el trabajo de otro y de vuelta al
// cerebro cuando entregan.
import { useEffect, useRef } from 'react';
import type { Task } from '../api';
import type { Live } from '../state';

function center(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 3 };
}

function fly(from: Element | null, to: Element | null, emoji: string, delay = 0) {
  if (!from || !to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = center(from), b = center(to);
  const el = document.createElement('span');
  el.className = 'flight';
  el.textContent = emoji;
  document.body.appendChild(el);
  const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 80 };
  const anim = el.animate(
    [
      { transform: `translate(${a.x}px, ${a.y}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${mid.x}px, ${mid.y}px) scale(1.2) rotate(-12deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${b.x}px, ${b.y}px) scale(0.6)`, opacity: 0.2 },
    ],
    { duration: 1100, delay, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'both' },
  );
  anim.onfinish = () => el.remove();
}

export function Flights({ live, brainId, task }: { live: Record<string, Live>; brainId?: string; task?: Task }) {
  const prev = useRef<Record<string, string>>({});
  useEffect(() => {
    const desk = (id: string) => document.querySelector(`[data-agent="${id}"]`);
    for (const [id, l] of Object.entries(live)) {
      const before = prev.current[id];
      if (before === l.status || id === brainId) continue;
      if (l.status === 'working') {
        const step = task?.steps.find((s) => s.agentId === id);
        const deps = step?.dependsOn || [];
        if (deps.length) deps.forEach((d, i) => fly(desk(d), desk(id), '📄', i * 150));
        else fly(desk(brainId || ''), desk(id), '✉️');
      } else if (l.status === 'done' && before === 'working') {
        fly(desk(id), desk(brainId || ''), '📨');
      }
    }
    prev.current = Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v.status]));
  }, [live, brainId, task]);
  return null;
}
