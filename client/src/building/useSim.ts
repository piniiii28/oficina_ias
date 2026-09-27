// Simulación de la vida en el edificio: cada IA camina casilla por casilla,
// va a su escritorio cuando trabaja, a la mesa del lobby si está en una
// reunión y, en su tiempo libre, pasea o baja a la cafetería por ascensor.
import { useEffect, useRef, useState } from 'react';
import type { Agent, Meeting } from '../api';
import type { Live } from '../state';
import { FLOORS, MEETING_SEATS, USE, besideFurniture, floorById, nextStep, randomWalkable, walkable, type FloorDef } from './layout';

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
  running?: boolean;
  greeted?: boolean;
  onArrive?: string; // emote al llegar (usar un mueble)
  energy?: number; // 0-100: se gasta trabajando y se recupera en la cafetería o la azotea
};

export const TICK_MS = 340;
export const ME = '__yo';
/** Clima de la azotea: cambia cada ~5 minutos. */
export function weatherNow(t = Date.now()) {
  const slot = Math.floor(t / 300000);
  const r = Math.abs(Math.sin(slot * 12.9898) * 43758.5453) % 1;
  return r < 0.55 ? 'sol' : r < 0.8 ? 'nubes' : 'lluvia';
}

export const PETS = [
  { id: '__michi', name: 'Michi', emoji: '🐈', floor: 'lobby' },
  { id: '__firulais', name: 'Firulais', emoji: '🐕', floor: 'azotea' },
  { id: '__kiwi', name: 'Kiwi', emoji: '🦜', floor: 'penthouse' },
];
const CHATS = ['¡Hola!', '¿Café?', 'Buen trabajo 👏', 'Jaja 😂', '¿Viste la tarea nueva?', '¡Qué idea!', 'Te paso el dato', '🤝'];
const EMOTES = ['☕', '💭', '🎵', '💡', '😄', '📱', '🍪', '👋', '✨', '📚'];

function homeFloor(a: Agent): FloorDef {
  return FLOORS.find((f) => f.department === a.department) || floorById.get('lobby')!;
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
  // Tu avatar: aparece en el lobby y solo se mueve cuando haces clic.
  if (!walkers.current[ME]) {
    const lobby = floorById.get('lobby')!;
    walkers.current[ME] = { floor: 'lobby', i: lobby.cols - 3, j: lobby.rows - 2, dir: -1, moving: false, goal: null, reason: 'pasear', wait: 0, inElevator: 0 };
  }
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
      step(ws[ME]);
      // Mascotas: pasean al azar por su piso.
      for (const pet of PETS) {
        const f = floorById.get(pet.floor)!;
        let w = ws[pet.id];
        if (!w) w = ws[pet.id] = { floor: f.id, ...randomWalkable(f), dir: 1, moving: false, goal: null, reason: 'pasear', wait: 0, inElevator: 0 };
        if (!w.goal && --w.wait <= 0) {
          w.goal = { floor: f.id, ...randomWalkable(f) };
          w.wait = 6 + Math.floor(Math.random() * 20);
          if (Math.random() < 0.3) w.emote = pet.emoji === '🐈' ? '😺' : pet.emoji === '🐕' ? '🦴' : '🎶';
        }
        step(w);
      }
      const night = new Date().getHours() >= 22 || new Date().getHours() < 6;
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
        w.energy ??= 60 + Math.random() * 40;
        const resting = !w.goal && ['lobby', 'azotea', 'sotano'].includes(w.floor) && w.reason === 'cafe';
        if (busy) w.energy -= 0.5;
        else if (w.moving) w.energy -= 0.12;
        else if (resting) w.energy += 2.5;
        else w.energy += 0.05;
        w.energy = Math.max(0, Math.min(100, w.energy));
        if (resting && w.energy > 95) w.wait = 0; // recargado: vuelve a sus cosas

        // Prioridades: reunión > trabajo > tiempo libre.
        if (seat && w.reason !== 'reunion') w.goal = seat, w.reason = 'reunion', w.onArrive = undefined;
        else if (!seat && w.reason === 'reunion') w.goal = null, w.wait = 0;
        if (!seat && busy && desk && w.reason !== 'escritorio') w.goal = desk, w.reason = 'escritorio', w.onArrive = undefined;

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
            if (night && !w.emote && Math.random() < 0.05) w.emote = '💤';
            continue;
          }
          // Decide qué hacer en su tiempo libre.
          const r = Math.random();
          const cur = floorById.get(w.floor)!;
          const workers = a.isBrain ? agents.filter((x) => x.id !== a.id && live[x.id]?.status === 'working' && ws[x.id] && !ws[x.id].inElevator) : [];
          if (workers.length && r < 0.6) {
            // El cerebro supervisa: visita a alguien que está trabajando.
            const target = ws[workers[Math.floor(Math.random() * workers.length)].id];
            const tf = floorById.get(target.floor)!;
            const near = [[1, 0], [-1, 0], [0, 1], [1, 1]].map(([di, dj]) => ({ i: target.i + di, j: target.j + dj })).find((p) => walkable(tf, p.i, p.j));
            w.goal = { floor: tf.id, ...(near || randomWalkable(tf)) };
            w.reason = 'pasear';
            w.onArrive = '👀 ¿Cómo vamos?';
          } else if ((w.energy ?? 100) < 25 && !['lobby', 'azotea', 'sotano'].includes(w.floor)) {
            const dest = floorById.get(Math.random() < 0.7 || weatherNow() === 'lluvia' ? 'lobby' : 'azotea')!;
            const spot = dest.hangouts![Math.floor(Math.random() * dest.hangouts!.length)];
            w.goal = { floor: dest.id, ...spot };
            w.reason = 'cafe';
            w.emote = '🪫';
          } else if (w.floor !== home.id && r < 0.5 && (w.energy ?? 100) > 60) {
            w.goal = desk || { floor: home.id, ...randomWalkable(home) };
            w.reason = 'volver';
          } else if (w.floor === home.id && r < 0.14) {
            // Descanso: cafetería del lobby, la azotea o la sala de juegos del sótano.
            const pick = Math.random();
            const dest = floorById.get(pick < 0.45 ? 'lobby' : pick < 0.75 && weatherNow() !== 'lluvia' ? 'azotea' : 'sotano')!;
            const spot = dest.hangouts![Math.floor(Math.random() * dest.hangouts!.length)];
            w.goal = { floor: dest.id, ...spot };
            w.reason = 'cafe';
          } else if (r < 0.35 && desk && w.floor === home.id) {
            w.goal = desk;
            w.reason = 'escritorio';
          } else if (Math.random() < 0.3) {
            // Usar un mueble de su piso en el tiempo libre.
            const usable = cur.furniture.filter((m) => USE[m.kind] && m.kind !== 'desk');
            const m = usable[Math.floor(Math.random() * usable.length)];
            const spot = m && besideFurniture(cur, m);
            w.goal = { floor: cur.id, ...(spot || randomWalkable(cur)) };
            w.reason = 'pasear';
            w.onArrive = m && spot ? USE[m.kind] : undefined;
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
          if (w.onArrive) {
            w.emote = w.onArrive;
            w.onArrive = undefined;
          }
          if (!stay || (!busy && !seat && w.reason === 'escritorio')) {
            w.goal = null;
            const tired = w.reason === 'cafe' && (w.energy ?? 100) < 60;
            w.wait = w.reason === 'escritorio' ? 15 + Math.floor(Math.random() * 25) : tired ? 30 + Math.floor(Math.random() * 20) : 4 + Math.floor(Math.random() * 14);
            if (tired) w.emote = '☕';
            if (!tired) w.reason = 'pasear';
          }
          continue;
        }
        // Con trabajo pendiente corren: dos casillas por paso.
        const hurry = (busy && w.reason === 'escritorio') || w.reason === 'reunion' ? 2 : 1;
        for (let k = 0; k < hurry; k++) {
          const t = w.goal.floor === w.floor ? w.goal : { floor: w.floor, ...f.elevator };
          if (w.i === t.i && w.j === t.j) break;
          const next = nextStep(f, w, t);
          if (!next || (!walkable(f, next.i, next.j) && !(next.i === t.i && next.j === t.j))) {
            w.goal = null;
            w.wait = 2;
            break;
          }
          // En pantalla, +i va abajo a la derecha y +j abajo a la izquierda.
          const dx = next.i - w.i - (next.j - w.j);
          if (dx !== 0) w.dir = dx > 0 ? 1 : -1;
          w.i = next.i;
          w.j = next.j;
          w.moving = true;
        }
        w.running = hurry > 1;
      }
      // Te saludan cuando pasas al lado.
      const me = ws[ME];
      for (const a of agents) {
        const w = ws[a.id];
        if (!w || w.floor !== me.floor || w.inElevator || me.inElevator || w.reason === 'reunion') continue;
        if (Math.abs(w.i - me.i) + Math.abs(w.j - me.j) === 1 && !w.greeted && !['working', 'thinking'].includes(live[a.id]?.status || '')) {
          w.greeted = true;
          w.goal = null;
          w.wait = 6;
          w.moving = false;
          w.dir = me.i - w.i - (me.j - w.j) >= 0 ? 1 : -1;
          w.emote = ['👋 ¡Hola!', '¡Hola, jefe! 😄', '¿Te ayudo en algo?', '☕ ¿Un café?'][Math.floor(Math.random() * 4)];
        } else if (Math.abs(w.i - me.i) + Math.abs(w.j - me.j) > 3) w.greeted = false;
      }

      // Charlas espontáneas entre IAs libres que se cruzan.
      const idle = agents.filter((a) => {
        const w = ws[a.id];
        return w && !w.inElevator && (w.reason === 'pasear' || w.reason === 'cafe') && !['working', 'thinking'].includes(live[a.id]?.status || '');
      });
      for (let x = 0; x < idle.length; x++) {
        for (let y = x + 1; y < idle.length; y++) {
          const A = ws[idle[x].id], B = ws[idle[y].id];
          if (A.floor !== B.floor || Math.abs(A.i - B.i) + Math.abs(A.j - B.j) !== 1 || Math.random() > 0.08) continue;
          for (const [w, o] of [[A, B], [B, A]] as const) {
            w.goal = null;
            w.wait = 8 + Math.floor(Math.random() * 6);
            w.moving = false;
            w.dir = o.i - w.i - (o.j - w.j) >= 0 ? 1 : -1;
          }
          A.emote = CHATS[Math.floor(Math.random() * CHATS.length)];
          B.emote = CHATS[Math.floor(Math.random() * CHATS.length)];
        }
      }
      force((n) => n + 1);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused]);

  return walkers.current;
}

/** Un paso de tu avatar hacia donde hiciste clic (con ascensor si cambias de piso). */
function step(w: Walker) {
  if (w.inElevator > 0) {
    w.inElevator--;
    if (w.inElevator === 0 && w.goal) {
      const f = floorById.get(w.goal.floor)!;
      Object.assign(w, { floor: f.id, i: f.elevator.i, j: f.elevator.j });
    }
    return;
  }
  if (!w.goal) {
    w.moving = false;
    return;
  }
  const f = floorById.get(w.floor)!;
  const target = w.goal.floor === w.floor ? w.goal : { floor: w.floor, ...f.elevator };
  if (w.i === target.i && w.j === target.j) {
    w.moving = false;
    if (w.goal.floor !== w.floor) w.inElevator = 4;
    else {
      w.goal = null;
      if (w.onArrive) {
        w.emote = w.onArrive;
        w.onArrive = undefined;
      }
    }
    return;
  }
  const n = nextStep(f, w, target);
  if (!n) {
    w.goal = null;
    w.moving = false;
    return;
  }
  const dx = n.i - w.i - (n.j - w.j);
  if (dx !== 0) w.dir = dx > 0 ? 1 : -1;
  w.i = n.i;
  w.j = n.j;
  w.moving = true;
  w.emote = undefined; // al volver a caminar se borra el globo anterior
}
