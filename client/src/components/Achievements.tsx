// Logros: insignias que se desbloquean usando la oficina.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, levelOf, type NoteSummary } from '../api';
import { useOffice } from '../state';
import { play } from '../sounds';

type Ctx = { tasks: number; meetings: number; notes: number; ideas: number; maxLevel: number; agents: number; trained: number; links: boolean };

const BADGES: { id: string; emoji: string; name: string; desc: string; test: (c: Ctx) => boolean }[] = [
  { id: 'primera', emoji: '🎯', name: 'Primera tarea', desc: 'El equipo completó su primera tarea', test: (c) => c.tasks >= 1 },
  { id: 'diez', emoji: '🏅', name: 'Oficina productiva', desc: '10 tareas completadas', test: (c) => c.tasks >= 10 },
  { id: 'cincuenta', emoji: '🏆', name: 'Máquina imparable', desc: '50 tareas completadas', test: (c) => c.tasks >= 50 },
  { id: 'reunion', emoji: '🗣️', name: 'Mesa redonda', desc: 'Primera reunión terminada', test: (c) => c.meetings >= 1 },
  { id: 'notas', emoji: '🕸️', name: 'Segundo cerebro', desc: '50 notas en el grafo', test: (c) => c.notes >= 50 },
  { id: 'ideas', emoji: '💡', name: 'Lluvia de ideas', desc: '20 ideas guardadas', test: (c) => c.ideas >= 20 },
  { id: 'nivel3', emoji: '⭐', name: 'Veterana', desc: 'Una IA llegó al nivel 3', test: (c) => c.maxLevel >= 3 },
  { id: 'equipo', emoji: '👥', name: 'Gran equipo', desc: '35 IAs en la oficina', test: (c) => c.agents >= 35 },
  { id: 'maestro', emoji: '🎓', name: 'Maestro', desc: 'Le enseñaste una lección a una IA', test: (c) => c.trained >= 1 },
  { id: 'conectado', emoji: '🔌', name: 'En vivo', desc: 'Conectaste una IA real', test: (c) => c.links },
];

export function useAchievements() {
  const { agents, tasks, meetings, notesVersion } = useOffice();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  useEffect(() => { api.notes().then(setNotes).catch(() => {}); }, [notesVersion]);
  return useMemo(() => {
    const c: Ctx = {
      tasks: tasks.filter((t) => t.status === 'done').length,
      meetings: meetings.filter((m) => m.status === 'done').length,
      notes: notes.length,
      ideas: notes.filter((n) => n.type === 'idea').length,
      maxLevel: Math.max(1, ...agents.map(levelOf)),
      agents: agents.length,
      trained: agents.reduce((n, a) => n + (a.knowledge || []).filter((k) => !k.builtin).length, 0),
      links: agents.some((a) => a.live),
    };
    return BADGES.map((b) => ({ ...b, unlocked: b.test(c) }));
  }, [agents, tasks, meetings, notes]);
}

/** Avisa cuando se desbloquea un logro nuevo. */
export function AchievementWatcher() {
  const badges = useAchievements();
  const { toast, agents } = useOffice();
  const ready = useRef(false);
  useEffect(() => {
    if (!agents.length) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem('oficina.logros') || '[]');
    } catch {
      /* sin almacenamiento local */
    }
    const fresh = badges.filter((b) => b.unlocked && !seen.includes(b.id));
    if (fresh.length) {
      // La primera vez solo se registran, sin avisos acumulados.
      if (ready.current || seen.length) {
        for (const b of fresh) toast(`${b.emoji} ¡Logro desbloqueado! ${b.name}`);
        play('ding');
      }
      try {
        localStorage.setItem('oficina.logros', JSON.stringify([...seen, ...fresh.map((b) => b.id)]));
      } catch {
        /* sin almacenamiento local */
      }
    }
    ready.current = true;
  }, [badges, toast, agents.length]);
  return null;
}

export function AchievementsPanel() {
  const badges = useAchievements();
  const n = badges.filter((b) => b.unlocked).length;
  return (
    <section className="card achievements">
      <h3 style={{ marginTop: 0 }}>🏆 Logros · {n}/{badges.length}</h3>
      <div className="badges">
        {badges.map((b) => (
          <div key={b.id} className={`badge-item ${b.unlocked ? 'on' : ''}`} title={b.desc}>
            <span>{b.unlocked ? b.emoji : '🔒'}</span>
            <strong>{b.name}</strong>
            <small>{b.desc}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
