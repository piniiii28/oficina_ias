// El edificio de la oficina (estilo Habbo): pisos isométricos apilados, con
// muebles, ventanas, ascensor y las IAs caminando libremente.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, levelOf, type Agent } from '../api';
import { Chibi } from '../components/Chibi';
import { Meters } from '../components/Meters';
import { useOffice } from '../state';
import { FLOORS, LEVELS, TH, TW, WALL, USE, levelPlacement, roomSize, tileCenter, walkable, type FloorDef, type Furniture } from './layout';

import { ME, PETS, TICK_MS, useSim, weatherNow, type Walker } from './useSim';
import type { AvatarConfig } from '../api';

const CHIBI = 40;

const ACTIVITY: Record<string, string> = {
  working: '⌨️ Trabajando en una tarea', thinking: '💭 Pensando', talking: '💬 Hablando', done: '✅ Acaba de entregar', error: '💥 Tuvo un error',
  escritorio: '🪑 En su escritorio', reunion: '🗣️ En reunión', cafe: '☕ Descansando', volver: '🛗 Volviendo a su piso', pasear: '🚶 Paseando', ascensor: '🛗 En el ascensor',
};

// Skins de piso: se rotan con el botón 🎨 de cada piso.
const THEMES = [
  null, // colores originales
  { name: 'Madera', floorA: '#8b5a2b', floorB: '#9c6b3a', wall: '#d6b38a' },
  { name: 'Mármol', floorA: '#d4d4d8', floorB: '#e4e4e7', wall: '#94a3b8' },
  { name: 'Neón', floorA: '#1e1b4b', floorB: '#312e81', wall: '#db2777' },
  { name: 'Selva', floorA: '#14532d', floorB: '#166534', wall: '#65a30d' },
  { name: 'Candy', floorA: '#f9a8d4', floorB: '#fbcfe8', wall: '#a78bfa' },
  { name: 'Océano', floorA: '#0e7490', floorB: '#0891b2', wall: '#1d4ed8' },
  { name: 'Retro', floorA: '#b45309', floorB: '#f59e0b', wall: '#7c2d12' },
];

function loadThemes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('oficina.skins') || '{}');
  } catch {
    return {};
  }
}
const CHIBI_H = (CHIBI * 166) / 120;

function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `#${((c((n >> 16) & 255) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).padStart(6, '0')}`;
}

/** Vértice superior de la casilla (i, j). */
function P(f: FloorDef, i: number, j: number) {
  const ox = (f.rows * TW) / 2;
  return { x: ox + ((i - j) * TW) / 2, y: WALL + ((i + j) * TH) / 2 };
}
const pts = (list: { x: number; y: number }[]) => list.map((p) => `${p.x},${p.y}`).join(' ');
const up = (p: { x: number; y: number }, z: number) => ({ x: p.x, y: p.y - z });

const LOOK: Record<Furniture['kind'], { z: number; color: string; emoji?: string; size?: number }> = {
  rug: { z: 1, color: '#b91c1c' },
  printer: { z: 40, color: '#e5e7eb', emoji: '🖨️', size: 20 },
  filament: { z: 44, color: '#a16207', emoji: '🧵', size: 16 },
  pingpong: { z: 16, color: '#15803d', emoji: '🏓', size: 18 },
  beanbag: { z: 10, color: '#f97316' },
  pool: { z: 4, color: '#22d3ee', emoji: '🏊', size: 22 },
  bench: { z: 12, color: '#a16207' },
  gym: { z: 8, color: '#52525b', emoji: '🏋️', size: 24 },
  telescope: { z: 6, color: '#334155', emoji: '🔭', size: 24 },
  grill: { z: 22, color: '#27272a', emoji: '🍖', size: 16 },
  umbrella: { z: 4, color: '#f8fafc', emoji: '⛱️', size: 30 },
  desk: { z: 20, color: '#c8a27a' },
  plant: { z: 12, color: '#a16207', emoji: '🪴', size: 26 },
  coffee: { z: 34, color: '#71717a', emoji: '☕', size: 18 },
  sofa: { z: 14, color: '#8b5cf6', emoji: '🛋️', size: 22 },
  shelf: { z: 52, color: '#78350f', emoji: '📚', size: 18 },
  board: { z: 46, color: '#f8fafc', emoji: '📊', size: 16 },
  server: { z: 54, color: '#1f2937', emoji: '🟢', size: 10 },
  easel: { z: 6, color: '#a16207', emoji: '🎨', size: 28 },
  table: { z: 16, color: '#d6b38a', emoji: '🍩', size: 16 },
  vending: { z: 56, color: '#dc2626', emoji: '🥤', size: 18 },
  reception: { z: 24, color: '#b45309' },
  arcade: { z: 50, color: '#7c3aed', emoji: '🕹️', size: 20 },
  globe: { z: 10, color: '#44403c', emoji: '🌍', size: 24 },
  cabinet: { z: 34, color: '#9ca3af', emoji: '🗄️', size: 16 },
  bigtable: { z: 18, color: '#a47148' },
  piano: { z: 24, color: '#18181b', emoji: '🎹', size: 20 },
  aquarium: { z: 30, color: '#38bdf8', emoji: '🐠', size: 18 },
};

function Box({ f, m }: { f: FloorDef; m: Furniture }) {
  const look = LOOK[m.kind];
  const w = m.w || 1, h = m.h || 1;
  const A = P(f, m.i, m.j), B = P(f, m.i + w, m.j), C = P(f, m.i + w, m.j + h), D = P(f, m.i, m.j + h);
  const z = look.z;
  const top = [up(A, z), up(B, z), up(C, z), up(D, z)];
  const cx = (A.x + C.x) / 2, cy = (A.y + C.y) / 2 - z;
  const { w: W, h: H } = roomSize(f);
  const emoji = m.label || look.emoji;
  return (
    <svg className="iso-item" width={W} height={H} style={{ zIndex: m.kind === 'rug' ? 0 : (m.i + w - 1 + m.j + Math.ceil(h) - 1) * 10 + 2 }} aria-hidden>
      {m.kind === 'rug' && <polygon points={pts([up(A, 1), up(B, 1), up(C, 1), up(D, 1)].map((p, k, arr) => ({ x: p.x + (arr[(k + 2) % 4].x - p.x) * 0.12, y: p.y + (arr[(k + 2) % 4].y - p.y) * 0.12 })))} fill="none" stroke="#fde68a" strokeWidth="2" opacity="0.7" />}
      <polygon points={pts([D, C, up(C, z), up(D, z)])} fill={shade(look.color, -0.18)} />
      <polygon points={pts([C, B, up(B, z), up(C, z)])} fill={shade(look.color, -0.3)} />
      <polygon points={pts(top)} fill={look.color} stroke={shade(look.color, -0.35)} strokeWidth="0.6" />
      {(m.kind === 'aquarium' || m.kind === 'pool') && <polygon className={m.kind === 'pool' ? 'water' : undefined} points={pts(top)} fill="rgba(255,255,255,0.25)" />}
      {emoji && (
        <text x={cx} y={cy - (m.kind === 'desk' || m.kind === 'reception' || m.kind === 'bigtable' ? 4 : 2)} fontSize={look.size || 18} textAnchor="middle" className={m.kind === 'server' ? 'blink' : undefined}>
          {emoji}
        </text>
      )}
    </svg>
  );
}

/** Silla de oficina detrás de cada escritorio (decorativa, no bloquea el paso). */
function Chair({ f, i, j, color }: { f: FloorDef; i: number; j: number; color: string }) {
  const { w: W, h: H } = roomSize(f);
  const c = tileCenter(f, i, j);
  const seat = [{ x: c.x - 11, y: c.y - 2 }, { x: c.x, y: c.y - 8 }, { x: c.x + 11, y: c.y - 2 }, { x: c.x, y: c.y + 4 }];
  const lift = (p: { x: number; y: number }, z: number) => ({ x: p.x, y: p.y - z });
  return (
    <svg className="iso-item" width={W} height={H} style={{ zIndex: (i + j) * 10 + 1 }} aria-hidden>
      <line x1={c.x} y1={c.y + 4} x2={c.x} y2={c.y - 4} stroke="#27272a" strokeWidth="3" />
      <polygon points={pts(seat.map((p) => lift(p, 10)))} fill={color} stroke={shade(color, -0.3)} strokeWidth="1" />
      <polygon points={pts([lift(seat[0], 10), lift(seat[1], 10), lift(seat[1], 32), lift(seat[0], 32)])} fill={shade(color, -0.15)} />
    </svg>
  );
}

function Room({ f, night, doorOpen, weather, partition = false }: { f: FloorDef; night: boolean; doorOpen: boolean; weather: string; partition?: boolean }) {
  const { w: W, h: H } = roomSize(f);
  const top = P(f, 0, 0), right = P(f, f.cols, 0), left = P(f, 0, f.rows), bottom = P(f, f.cols, f.rows);
  const id = `r-${f.id}`;
  const tiles = [];
  for (let i = 0; i < f.cols; i++) {
    for (let j = 0; j < f.rows; j++) {
      tiles.push(<polygon key={`${i},${j}`} points={pts([P(f, i, j), P(f, i + 1, j), P(f, i + 1, j + 1), P(f, i, j + 1)])} fill={(i + j) % 2 ? f.floorA : f.floorB} stroke={shade(f.floorA, -0.18)} strokeWidth="1" />);
    }
  }
  // Ventanales en la pared del fondo: vidrio con marco y parteluces, estilo pixel.
  const windows = [];
  for (let k = 1; k < f.cols - 1; k += 3) {
    const a = P(f, k, 0), b = P(f, k + 2, 0);
    const mid = P(f, k + 1, 0);
    windows.push(
      <g key={k}>
        <polygon points={pts([up(a, WALL - 14), up(b, WALL - 14), up(b, 20), up(a, 20)])} fill={night ? `url(#${id}-night)` : `url(#${id}-sky)`} stroke="#1b1320" strokeWidth="3" />
        <line x1={mid.x} y1={mid.y - 20} x2={mid.x} y2={mid.y - (WALL - 14)} stroke="#1b1320" strokeWidth="2" />
        <polygon points={pts([up(a, WALL - 20), up({ x: a.x + 8, y: a.y + 4 }, WALL - 20), up({ x: a.x + 8, y: a.y + 4 }, 30), up(a, 36)])} fill="rgba(255,255,255,0.35)" />
      </g>,
    );
  }
  const e = f.elevator;
  const d1 = P(f, 0, e.j), d2 = P(f, 0, e.j + 1);
  const wallH = f.open ? 22 : WALL;
  const leftH = partition ? 26 : wallH;
  const dark = shade(f.wall, -0.32);
  const SLAB = 12;
  return (
    <svg className="iso-room" width={W} height={H} aria-hidden shapeRendering="crispEdges">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7dd3fc" /><stop offset="1" stopColor="#e0f2fe" /></linearGradient>
        <linearGradient id={`${id}-night`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1e1b4b" /><stop offset="1" stopColor="#4338ca" /></linearGradient>
        {/* Tablas de madera: líneas paralelas al piso en cada pared */}
        <pattern id={`${id}-planks-r`} width="28" height="9" patternUnits="userSpaceOnUse" patternTransform="skewY(26.565)">
          <rect width="28" height="9" fill={f.wall} />
          <rect y="8" width="28" height="1" fill={dark} />
          <rect x="27" y="0" width="1" height="4" fill={dark} />
          <rect x="13" y="4" width="1" height="4" fill={dark} />
          <rect y="0" width="28" height="1" fill={shade(f.wall, 0.12)} />
        </pattern>
        <pattern id={`${id}-planks-l`} width="28" height="9" patternUnits="userSpaceOnUse" patternTransform="skewY(-26.565)">
          <rect width="28" height="9" fill={shade(f.wall, -0.12)} />
          <rect y="8" width="28" height="1" fill={shade(dark, -0.05)} />
          <rect x="27" y="0" width="1" height="4" fill={dark} />
          <rect x="13" y="4" width="1" height="4" fill={dark} />
        </pattern>
      </defs>
      {f.open && weather !== 'lluvia' && <circle cx={W - 60} cy={30} r={night ? 16 : 22} fill={night ? '#e5e7eb' : '#fde047'} opacity="0.9" />}
      {f.open && weather !== 'sol' && (
        <g fill={weather === 'lluvia' ? '#94a3b8' : '#f8fafc'} opacity="0.9">
          <ellipse cx={W - 90} cy={34} rx={34} ry={14} /><ellipse cx={W - 60} cy={26} rx={26} ry={16} /><ellipse cx={W - 150} cy={50} rx={26} ry={10} />
        </g>
      )}
      {/* Losa: el grosor del piso, visto de frente */}
      <polygon points={pts([left, bottom, { x: bottom.x, y: bottom.y + SLAB }, { x: left.x, y: left.y + SLAB }])} fill={shade(f.floorA, -0.35)} stroke="#1b1320" strokeWidth="1" />
      <polygon points={pts([bottom, right, { x: right.x, y: right.y + SLAB }, { x: bottom.x, y: bottom.y + SLAB }])} fill={shade(f.floorA, -0.48)} stroke="#1b1320" strokeWidth="1" />
      {/* Paredes */}
      {partition ? (
        <polygon points={pts([left, top, up(top, leftH), up(left, leftH)])} fill="rgba(186,230,253,0.28)" stroke="#1b1320" strokeWidth="2" />
      ) : (
        <polygon points={pts([left, top, up(top, leftH), up(left, leftH)])} fill={f.open ? shade(f.wall, -0.12) : `url(#${id}-planks-l)`} opacity={f.open ? 0.8 : 1} stroke="#1b1320" strokeWidth="1.5" />
      )}
      <polygon points={pts([top, right, up(right, wallH), up(top, wallH)])} fill={f.open ? f.wall : `url(#${id}-planks-r)`} opacity={f.open ? 0.8 : 1} stroke="#1b1320" strokeWidth="1.5" />
      {/* Remate superior de las paredes */}
      {!partition && <polygon points={pts([up(left, leftH), up(top, leftH), up(top, leftH + 6), up(left, leftH + 6)])} fill={shade(f.wall, 0.15)} stroke="#1b1320" strokeWidth="1" />}
      <polygon points={pts([up(top, wallH), up(right, wallH), up(right, wallH + 6), up(top, wallH + 6)])} fill={shade(f.wall, 0.22)} stroke="#1b1320" strokeWidth="1" />
      {/* Zócalo */}
      {!f.open && <polygon points={pts([top, right, up(right, 6), up(top, 6)])} fill={dark} />}
      {!f.open && !partition && <polygon points={pts([left, top, up(top, 6), up(left, 6)])} fill={shade(dark, -0.06)} />}
      {!f.open && windows}
      {!f.open && !partition && (f.art || []).map((a, k) => {
        const jj = 1 + k * 2.2;
        if (jj + 1 >= f.elevator.j && jj <= f.elevator.j + 1) return null;
        const p1 = P(f, 0, jj), p2 = P(f, 0, jj + 1);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2 - 52;
        return (
          <g key={k}>
            <polygon points={pts([up(p1, 34), up(p2, 34), up(p2, 66), up(p1, 66)])} fill="#fef3c7" stroke="#1b1320" strokeWidth="3" />
            <text x={mx} y={my + 4} fontSize="18" textAnchor="middle">{a}</text>
          </g>
        );
      })}
      {/* Ascensor */}
      <polygon points={pts([up(d1, -1), up(d2, -1), up(d2, 66), up(d1, 66)])} fill="#52525b" stroke="#1b1320" strokeWidth="2" />
      <polygon points={pts([d1, d2, up(d2, 62), up(d1, 62)])} fill={doorOpen ? '#fef3c7' : '#a1a1aa'} stroke="#1b1320" strokeWidth="1" />
      {doorOpen ? (
        <>
          <polygon points={pts([d1, { x: d1.x - 4, y: d1.y + 2 }, up({ x: d1.x - 4, y: d1.y + 2 }, 62), up(d1, 62)])} fill="#a1a1aa" />
          <polygon points={pts([d2, { x: d2.x + 4, y: d2.y - 2 }, up({ x: d2.x + 4, y: d2.y - 2 }, 62), up(d2, 62)])} fill="#a1a1aa" />
        </>
      ) : (
        <line x1={(d1.x + d2.x) / 2} y1={(d1.y + d2.y) / 2} x2={(d1.x + d2.x) / 2} y2={(d1.y + d2.y) / 2 - 62} stroke="#1b1320" strokeWidth="2" />
      )}
      <text x={(d1.x + d2.x) / 2} y={(d1.y + d2.y) / 2 - 70} fontSize="11" textAnchor="middle">🛗</text>
      {tiles}
      <polygon points={pts([top, right, bottom, left])} fill="none" stroke="#1b1320" strokeWidth="1.5" />
    </svg>
  );
}

function Person({ f, a, w, onClick, idx, me = false }: { f: FloorDef; a: Agent; w: Walker; onClick: () => void; idx: number; me?: boolean }) {
  const { live } = useOffice();
  const c = tileCenter(f, w.i, w.j);
  const l = live[a.id];
  const state = l?.status || 'idle';
  const style: CSSProperties = {
    transform: `translate(${c.x - CHIBI / 2}px, ${c.y - CHIBI_H + 6}px)`,
    zIndex: (w.i + w.j) * 10 + 5,
    transitionDuration: `${TICK_MS}ms`,
  };
  if (w.running) style.filter = 'drop-shadow(-6px 0 2px rgba(255,255,255,0.35))';
  const msg = state === 'working' ? '⌨️' : state === 'thinking' ? '💭' : state === 'done' ? '✅' : state === 'error' ? '💥' : state === 'talking' ? '💬' : w.emote;
  return (
    <button className={`walker ${w.moving ? 'walker--moving' : ''} ${me ? 'walker--me' : ''} ${!me && !a.live ? 'walker--demo' : ''}`} style={style} onClick={(e) => { e.stopPropagation(); onClick(); }} title={`${a.name} · ${a.role} · ${a.live ? 'conectada' : 'modo demo'}`}>
      {!me && <span className={`walker-live ${a.live ? 'on' : ''}`} aria-hidden>{a.live ? '' : 'demo'}</span>}
      {state === 'talking' && l?.message ? <span className="walker-say">{l.message.slice(0, 60)}{l.message.length > 60 ? '…' : ''}</span> : msg && <span className="walker-emote">{msg}</span>}
      <span className="walker-shadow" />
      <span className="walker-body" style={{ transform: `scaleX(${w.dir})` }}>
        <Chibi avatar={a.avatar} size={CHIBI} legs walking={w.moving} seed={idx} state={w.moving ? 'idle' : state} />
      </span>
      {/* Sus asistentes lo acompañan (más pequeños, a su lado) */}
      {!me && a.assistants?.map((x, k) => (
        <span key={x.id} className={`walker-mini walker-mini--${k}`} title={`${x.name} · ${x.focus}`} style={{ transform: `scaleX(${w.dir})` }}>
          <Chibi avatar={{ ...a.avatar, outfit: k ? '#94a3b8' : '#cbd5e1', hair: x.focus.length % 2 ? '#3f2a1d' : '#f59e0b', accessory: 'none', costume: 'none' }} size={CHIBI * 0.62} legs walking={w.moving} seed={idx + k + 3} state={w.moving ? 'idle' : state === 'working' ? 'working' : 'idle'} />
        </span>
      ))}
      {me ? (
        <span className="walker-name">{a.name}</span>
      ) : (
        <span className="walker-name walker-card">
          <span><b>{a.name}</b>{a.isHead && ' 👑'} <em>Nv {levelOf(a)}</em></span>
          {a.assistants?.length ? <small>👥 Asistentes: {a.assistants.map((x) => x.focus).join(', ')}</small> : null}
          <small>{a.role}</small>
          <small className={a.live ? 'ok' : 'muted'}>{a.live ? `● Conectada · ${a.provider}` : '○ Modo demo (sin conectar)'}</small>
          <small>{ACTIVITY[state] || ACTIVITY[w.inElevator ? 'ascensor' : w.reason] || 'Paseando'}</small>
          <Meters agentId={a.id} />
        </span>
      )}
    </button>
  );
}

/** Escala el piso para que quepa en pantallas angostas. */
function useFit(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return { ref, scale };
}

const f0 = (id: string) => id === 'lobby';

function FloorView({ f: base, number, walkers, agents, onSelect, night, me, onTile, x, y, partition, z = 1 }: {
  f: FloorDef; number: string; walkers: Record<string, Walker>; agents: Agent[]; onSelect: (a: Agent) => void; night: boolean;
  me: Agent; onTile: (floor: string, i: number, j: number, emote?: string) => void; x: number; y: number; partition: boolean; z?: number;
}) {
  const { live, tasks, meetings } = useOffice();
  const meeting = f0(base.id) && meetings.find((m) => m.status === 'running');
  const [theme, setTheme] = useState(() => loadThemes()[base.id] || 0);
  const f = useMemo(() => (THEMES[theme] ? { ...base, ...THEMES[theme]!, name: base.name } : base), [base, theme]);
  const cycle = () => {
    const next = (theme + 1) % THEMES.length;
    setTheme(next);
    try {
      localStorage.setItem('oficina.skins', JSON.stringify({ ...loadThemes(), [base.id]: next }));
    } catch {
      /* sin almacenamiento local */
    }
  };
  const { w: W, h: H } = roomSize(f);
  const all = [...agents.map((a) => walkers[a.id]), walkers[ME]].filter(Boolean);
  const doorOpen = all.some((w) => (w.floor === f.id && w.i === f.elevator.i && w.j === f.elevator.j && (w.moving || w.inElevator > 0)) || (w.inElevator > 0 && w.inElevator <= 2 && w.goal?.floor === f.id));
  const current = tasks.find((t) => t.status !== 'done' && t.status !== 'error');
  const here = agents.filter((a) => walkers[a.id]?.floor === f.id && !walkers[a.id]?.inElevator);
  const working = here.filter((a) => ['working', 'thinking'].includes(live[a.id]?.status || '')).length;
  return (
    <>
      {/* Placa de la sala en la fachada, bajo el borde del piso (sigue la inclinación isométrica) */}
      <div className="broom-sign" style={{ left: x + 6, top: y + WALL + (f.rows * TH) / 2 + 16, maxWidth: (f.cols * TW) / 2 - 12 }}>
        <span className="bfloor-num">{number}</span>
        <strong title={f.name}>{f.emoji} {f.name.split(' · ')[0]}</strong>
        <small>{here.length} aquí{here.length ? ` · ${here.filter((a) => a.live).length} 🟢` : ''}{working ? ` · ${working} ⌨️` : ''}</small>
        {(f.id === 'lobby' || f.id === 'penthouse') && current && <span className="bfloor-tv" title={current.prompt}>📺 {current.title}</span>}
        {f.open && <span className="weather" title="Clima">{({ sol: night ? '🌙' : '☀️', nubes: '⛅', lluvia: '🌧️' } as Record<string, string>)[weatherNow()]}</span>}
        <button className="skin-btn" onClick={cycle} title={`Cambiar skin de la sala (${THEMES[theme]?.name || 'original'})`}>🎨</button>
      </div>
    <div className={`broom ${f.open ? 'broom--open' : ''} ${f.open && weatherNow() === 'lluvia' ? 'bfloor--rain' : ''}`} id={`piso-${f.id}`} style={{ left: x, top: y, width: W, height: H, zIndex: z, ['--wall' as string]: f.wall }}>
        <div
          className="bfloor-room"
          style={{ width: W, height: H }}
          onClick={(e) => {
            // De la posición del clic a la casilla isométrica.
            const r = e.currentTarget.getBoundingClientRect();
            const k = r.width / W;
            const x = (e.clientX - r.left) / k - (f.rows * TW) / 2;
            const y = (e.clientY - r.top) / k - WALL;
            const i = Math.floor((x / (TW / 2) + y / (TH / 2)) / 2);
            const j = Math.floor((y / (TH / 2) - x / (TW / 2)) / 2);
            // ¿Clic sobre un mueble? (se mira su caja en pantalla, del más cercano al más lejano)
            const px = x + (f.rows * TW) / 2, py = y + WALL;
            const hit = [...f.furniture]
              .sort((a, b) => b.i + b.j - (a.i + a.j))
              .find((m) => {
                const w = m.w || 1, h = Math.ceil(m.h || 1), z = LOOK[m.kind].z + 16;
                const A = P(f, m.i, m.j), B = P(f, m.i + w, m.j), C = P(f, m.i + w, m.j + h), D = P(f, m.i, m.j + h);
                return px >= D.x && px <= B.x && py >= A.y - z && py <= C.y;
              });
            if (!hit && walkable(f, i, j)) return onTile(f.id, i, j);
            // Clic en un mueble: caminar a su lado y usarlo.
            const m = hit || f.furniture.find((x) => i >= x.i && i < x.i + (x.w || 1) && j >= x.j && j < x.j + Math.ceil(x.h || 1));
            if (!m) return;
            const near = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1]]
              .flatMap(([di, dj]) => [[m.i + di * (m.w || 1), m.j + dj * Math.ceil(m.h || 1)], [m.i + di, m.j + dj]])
              .find(([a, b]) => walkable(f, a, b));
            if (near) onTile(f.id, near[0], near[1], USE[m.kind] || '👀');
          }}
        >
          <Room f={f} night={night} doorOpen={doorOpen} weather={weatherNow()} partition={partition} />
          {f.open && weatherNow() === 'lluvia' && <div className="rain" />}
          {f.furniture.map((m, k) => <Box key={k} f={f} m={m} />)}
          {f.desks.map((d) => <Chair key={`${d.i},${d.j}`} f={f} i={d.i} j={d.j - 1} color={shade(f.wall, -0.1)} />)}
          {here.map((a) => <Person key={a.id} f={f} a={a} w={walkers[a.id]} onClick={() => onSelect(a)} idx={agents.indexOf(a)} />)}
          {meeting && (() => {
            const c = tileCenter(f, 10, 3);
            return <span className="meeting-sign" style={{ transform: `translate(${c.x}px, ${c.y - 70}px) translateX(-50%)` }}>🗣️ {meeting.topic.slice(0, 40)}{meeting.topic.length > 40 ? '…' : ''}</span>;
          })()}
          {PETS.filter((p) => walkers[p.id]?.floor === f.id).map((p) => {
            const w = walkers[p.id];
            const c = tileCenter(f, w.i, w.j);
            return (
              <span key={p.id} className={`pet ${w.moving ? 'walker--moving' : ''}`} title={p.name}
                style={{ transform: `translate(${c.x - 12}px, ${c.y - 22}px)`, zIndex: (w.i + w.j) * 10 + 4, transitionDuration: `${TICK_MS}ms` }}>
                {w.emote && !w.moving && <span className="walker-emote">{w.emote}</span>}
                <span className="walker-body" style={{ transform: `scaleX(${-w.dir})` }}>{p.emoji}</span>
              </span>
            );
          })}
          {walkers[ME]?.floor === f.id && !walkers[ME].inElevator && <Person f={f} a={me} w={walkers[ME]} onClick={() => {}} idx={99} me />}
          {walkers[ME]?.goal?.floor === f.id && <span className="tile-marker" style={{ transform: `translate(${tileCenter(f, walkers[ME].goal!.i, walkers[ME].goal!.j).x - 14}px, ${tileCenter(f, walkers[ME].goal!.i, walkers[ME].goal!.j).y - 7}px)` }} />}
        </div>
    </div>
    </>
  );
}

/** Un nivel del edificio: una o dos salas, una al lado de la otra. */
function LevelView({ ids, numbers, depth, ...rest }: { ids: string[]; numbers: Record<string, string>; depth: number } & Omit<Parameters<typeof FloorView>[0], 'f' | 'number' | 'x' | 'y' | 'partition'>) {
  const { placed, width, height } = useMemo(() => levelPlacement(ids), [ids]);
  const { ref, scale } = useFit(width);
  // Los niveles se enciman un poco: la pared del fondo de abajo queda tras la losa de arriba.
  return (
    <section className="blevel" style={{ zIndex: 50 - depth, marginTop: depth ? -WALL * 0.9 * scale : 0 }}>
      <div className="blevel-stage" ref={ref} style={{ height: height * scale }}>
        <div className="blevel-inner" style={{ width, height, transform: `translateX(-50%) scale(${scale})` }}>
          {placed.map((p, k) => <FloorView key={p.f.id} f={p.f} number={numbers[p.f.id]} x={p.x} y={p.y} partition={k > 0} z={k + 1} {...rest} />)}
        </div>
      </div>
    </section>
  );
}

const DEFAULT_ME: AvatarConfig = { skin: '#f1c7a5', hair: '#3f2a1d', hairStyle: 'messy', eyes: 'happy', outfit: '#f59e0b', accessory: 'headphones', prop: '🙋', costume: 'none' };

function loadMe(): { name: string; avatar: AvatarConfig } {
  try {
    const raw = localStorage.getItem('oficina.yo');
    if (raw) return JSON.parse(raw);
  } catch {
    /* sin almacenamiento local */
  }
  return { name: 'Tú', avatar: DEFAULT_ME };
}

export function Building({ onSelect }: { onSelect: (a: Agent) => void }) {
  const { agents, live, meetings, reloadAgents, toast } = useOffice();
  const [meCfg] = useState(loadMe);
  const me = useMemo<Agent>(() => ({
    id: ME, name: meCfg.name, role: 'Visitante (haz clic en el piso para caminar)', department: 'lobby', provider: '', model: '', skills: [], system: '',
    avatar: meCfg.avatar, knowledge: [], memory: [], stats: { tasks: 0, lastActive: null }, enabled: true,
  }), [meCfg]);
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  // «Solo IAs conectadas» (Ajustes): las de modo demo no se ven hasta conectarlas.
  const [onlyLive, setOnlyLive] = useState(true);
  useEffect(() => {
    api.settings().then((s) => setOnlyLive(s.onlyLive !== false)).catch(() => {});
  }, []);
  const liveCount = agents.filter((a) => a.enabled && a.live).length;
  const active = useMemo(() => agents.filter((a) => a.enabled && a.usable !== false), [agents]);
  const walkers = useSim(active, live, meetings, hidden);
  const hour = new Date().getHours();
  const night = hour < 6 || hour >= 19;
  // Número de piso por nivel (las dos salas de un nivel comparten número).
  const levelNum = (k: number, ids: string[]) => (ids.includes('azotea') ? 'AZ' : ids.includes('lobby') ? 'PB' : ids.includes('sotano') ? 'S1' : String(LEVELS.length - 2 - k));
  const numbers = FLOORS.map((f) => {
    const k = LEVELS.findIndex((ids) => ids.includes(f.id));
    return k === -1 ? '' : levelNum(k, LEVELS[k]);
  });
  const inElevator = active.filter((a) => walkers[a.id]?.inElevator);
  const numberOf = useMemo(() => Object.fromEntries(FLOORS.map((f, k) => [f.id, numbers[k]])), [numbers]);

  const wrap = useRef<HTMLDivElement>(null);
  const [tour, setTour] = useState(false);
  useEffect(() => {
    if (!tour) return;
    let k = 0;
    const go = () => {
      document.getElementById(`piso-${LEVELS[k % LEVELS.length][0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      k++;
    };
    go();
    const id = window.setInterval(go, 8000);
    return () => clearInterval(id);
  }, [tour]);
  return (
    <div className="building-wrap" ref={wrap}>
      <nav className="elevator-panel" aria-label="Ir a un piso">
        <button title="Pantalla completa" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen?.())}>🖥️</button>
        <button title={tour ? 'Detener recorrido' : 'Recorrido automático por los pisos'} className={tour ? 'on' : ''} onClick={() => setTour((t) => !t)}>📹</button>
        <button className={onlyLive ? 'on' : ''} title={onlyLive ? 'Solo trabajan y se ven las IAs conectadas. Clic: mostrar y usar también las de modo demo' : `Clic: usar y mostrar solo las ${liveCount} IAs conectadas`} onClick={async () => {
          try {
            await api.saveSettings({ onlyLive: !onlyLive });
            setOnlyLive(!onlyLive);
            await reloadAgents();
            toast(onlyLive ? '👥 Ahora trabajan todas, también las de modo demo' : `🟢 Solo trabajan las ${liveCount} IAs conectadas`);
          } catch (err) {
            toast(`❌ ${(err as Error).message}`);
          }
        }}>🟢<small>{liveCount}</small></button>
        <span>🛗</span>
        {LEVELS.map((ids, k) => (
          <button key={ids[0]} title={ids.map((id) => FLOORS.find((f) => f.id === id)?.name).join(' · ')} onClick={() => document.getElementById(`piso-${ids[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            {levelNum(k, ids)}
          </button>
        ))}
        {inElevator.length > 0 && <small title={inElevator.map((a) => a.name).join(', ')}>{inElevator.length} en el ascensor</small>}
      </nav>
      <div className={`building ${night ? 'building--night' : ''}`}>
        <div className="roof">
          <span className="antenna" />
          <div className="roof-sign">🧠 OFICINA DE IAS</div>
        </div>
        {LEVELS.map((ids, depth) => (
          <div key={ids.join('-')} className="blevel-wrap" style={{ zIndex: 50 - depth }}>
            {ids.includes('sotano') && (
              <div className="street">
                <span>🌳</span><span>🚲</span><span className="street-door">🚪 Entrada</span><span>🚕</span><span>🌳</span>
              </div>
            )}
            <LevelView ids={ids} depth={ids.includes('sotano') ? 0 : depth} numbers={numberOf} walkers={walkers} agents={active} onSelect={onSelect} night={night} me={me}
              onTile={(floor, i, j, emote) => { walkers[ME].goal = { floor, i, j }; walkers[ME].onArrive = emote; }} />
          </div>
        ))}
        <div className="ground" />
      </div>
    </div>
  );
}
