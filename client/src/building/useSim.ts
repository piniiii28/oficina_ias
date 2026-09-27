// Simulación de la vida en el edificio: cada IA camina casilla por casilla,
// va a su escritorio cuando trabaja, a la mesa del lobby si está en una
// reunión y, en su tiempo libre, pasea o baja a la cafetería por ascensor.
import { useEffect, useRef, useState } from 'react';
import type { Agent, Meeting } from '../api';
import type { Live } from '../state';
import { FLOORS, MEETING_SEATS, floorById, nextStep, randomWalkable, walkable, type FloorDef } from './layout';

export type Walker = {
  floor: string;
  i: number;
  j: number;
  dir: 1 | -1; // mirando a la derecha o izquierda en pantalla
  moving: boolean;
  goal: { floor: string; i: number; j: number } | null;
  reason: 'pasear' | 'escritorio' | 'reunion' | 'cafe' | 'volver';
  wait: number; // ticks antes de decidir de nuevo
  inElevator: number; // ticks dentro del ascensor
  emote?: string;
};

export const TICK_MS = 340;
const EMOTES = ['☕', '💭', '🎵', '💡', '😄', '📱', '🍪', '👋', '✨', '📚'];

function homeFloor(a: Agent): FloorDef {
  return FLOORS.find((f) => f.department === a.department) || FLOORS[FLOORS.length - 1];
}

/** Escritorio asignado: por orden dentro de su departamento. */
function deskOf(a: Agent, agents: Agent[]) {
  const f = homeFloor(a);
  const idx = agents.filter((x) => x.department === a.department && !x.isBrain === !a.isBrain).findIndex((x) => x.id === a.id);
  const d = f.desks[idx];
  return d ? { floor: f.id, i: d.i, j: d.j - 1 } : null;
}

export function useSim(agents: Agent[], live: Record<string, Live>, meetings: Meeting[], paused: boolean) {
  const walkers = useRef<Record<string, Walker>>({});
  const [, force] = useState(0);
  const ctx = useRef({ agents, live, meetings });
  ctx.current = { agents, live, meetings };

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      const { agents, live, meetings } = ctx.current;
      const running = meetings.find((m) => m.status === 'running');
      const seatOf = (aid: string) => {
        const k = running ? running.agentIds.indexOf(aid) : -1;
        return k >= 0 ? { floor: 'lobby', ...MEETING_SEATS[k % MEETING_SEATS.length] } : null;
      };
      const ws = walkers.current;
      for (const a of agents) {
        let w = ws[a.id];
        const home = homeFloor(a);
        const desk = deskOf(a, agents);
        if (!w) {
          const start = desk && Math.random() < 0.6 ? desk : { floor: home.id, ...randomWalkable(home) };
          w = ws[a.id] = { ...start, dir: 1, moving: false, goal: null, reason: 'pasear', wait: Math.floor(Math.random() * 12), inElevator: 0 };
        }
        const status = live[a.id]?.status || 'idle';
        const busy = status === 'working' || status === 'thinking';
        const seat = seatOf(a.id);

        // Prioridades: reunión > trabajo > tiempo libre.
        if (seat && w.reason !== 'reunion') w.goal = seat, w.reason = 'reunion';
        else if (!seat && w.reason === 'reunion') w.goal = null, w.wait = 0;
        if (!seat && busy && desk && w.reason !== 'escritorio') w.goal = desk, w.reason = 'escritorio';

        if (w.inElevator > 0) {
          w.inElevator--;
          if (w.inElevator === 0 && w.goal) {
            const f = floorById.get(w.goal.floor)!;
            Object.assign(w, { floor: f.id, i: f.elevator.i, j: f.elevator.j });
          }
          continue;
        }

        if (!w.goal) {
          if (w.wait > 0) {
            w.wait--;
            w.moving = false;
            if (w.emote && Math.random() < 0.15) w.emote = undefined;
            continue;
          }
          // Decide qué hacer en su tiempo libre.
          const r = Math.random();
          const cur = floorById.get(w.floor)!;
          if (w.floor !== home.id && r < 0.5) {
            w.goal = desk || { floor: home.id, ...randomWalkable(home) };
            w.reason = 'volver';
          } else if (w.floor === home.id && r < 0.12) {
            const lobby = floorById.get('lobby')!;
            const spot = lobby.hangouts![Math.floor(Math.random() * lobby.hangouts!.length)];
            w.goal = { floor: 'lobby', ...spot };
            w.reason = 'cafe';
          } else if (r < 0.35 && desk && w.floor === home.id) {
            w.goal = desk;
            w.reason = 'escritorio';
          } else {
            const spots = cur.hangouts || [];
            const spot = spots.length && Math.random() < 0.4 ? spots[Math.floor(Math.random() * spots.length)] : randomWalkable(cur);
            w.goal = { floor: cur.id, ...spot };
            w.reason = 'pasear';
          }
          if (Math.random() < 0.25) w.emote = w.reason === 'cafe' ? '☕' : EMOTES[Math.floor(Math.random() * EMOTES.length)];
        }

        // Avanza un paso hacia la meta (pasando por el ascensor si cambia de piso).
        const f = floorById.get(w.floor)!;
        const target = w.goal.floor === w.floor ? w.goal : { floor: w.floor, ...f.elevator };
        if (w.i === target.i && w.j === target.j) {
          if (w.goal.floor !== w.floor) {
            w.inElevator = 4;
            w.moving = false;
            continue;
          }
          w.moving = false;
          const stay = w.reason === 'escritorio' || w.reason === 'reunion';
          if (!stay || (!busy && !seat && w.reason === 'escritorio')) {
            w.goal = null;
            w.wait = w.reason === 'escritorio' ? 15 + Math.floor(Math.random() * 25) : 4 + Math.floor(Math.random() * 14);
            w.reason = 'pasear';
          }
          continue;
        }
        const step = nextStep(f, w, target);
        if (!step || (!walkable(f, step.i, step.j) && !(step.i === target.i && step.j === target.j))) {
          w.goal = null;
          w.wait = 2;
          continue;
        }
        // En pantalla, +i va abajo a la derecha y +j abajo a la izquierda.
        const dx = step.i - w.i - (step.j - w.j);
        if (dx !== 0) w.dir = dx > 0 ? 1 : -1;
        w.i = step.i;
        w.j = step.j;
        w.moving = true;
      }
      force((n) => n + 1);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused]);

  return walkers.current;
}
