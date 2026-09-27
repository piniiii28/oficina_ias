// El edificio de la oficina (estilo Habbo): pisos isométricos apilados, con
// muebles, ventanas, ascensor y las IAs caminando libremente.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Agent } from '../api';
import { Chibi } from '../components/Chibi';
import { useOffice } from '../state';
import { FLOORS, TH, TW, WALL, roomSize, tileCenter, walkable, type FloorDef, type Furniture } from './layout';
import { ME, TICK_MS, useSim, type Walker } from './useSim';
import type { AvatarConfig } from '../api';

const CHIBI = 40;
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
    <svg className="iso-item" width={W} height={H} style={{ zIndex: (m.i + w - 1 + m.j + Math.ceil(h) - 1) * 10 + 2 }} aria-hidden>
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

function Room({ f, night }: { f: FloorDef; night: boolean }) {
  const { w: W, h: H } = roomSize(f);
  const top = P(f, 0, 0), right = P(f, f.cols, 0), left = P(f, 0, f.rows);
  const tiles = [];
  for (let i = 0; i < f.cols; i++) {
    for (let j = 0; j < f.rows; j++) {
      tiles.push(<polygon key={`${i},${j}`} points={pts([P(f, i, j), P(f, i + 1, j), P(f, i + 1, j + 1), P(f, i, j + 1)])} fill={(i + j) % 2 ? f.floorA : f.floorB} />);
    }
  }
  // Ventanas en la pared derecha.
  const windows = [];
  for (let k = 1; k < f.cols - 1; k += 3) {
    const a = P(f, k, 0), b = P(f, k + 1.6, 0);
    windows.push(
      <polygon key={k} points={pts([up(a, WALL - 22), up(b, WALL - 22), up(b, 26), up(a, 26)])} fill={night ? 'url(#night)' : 'url(#sky)'} stroke={shade(f.wall, -0.35)} strokeWidth="3" />,
    );
  }
  const e = f.elevator;
  const d1 = P(f, 0, e.j), d2 = P(f, 0, e.j + 1);
  const wallH = f.open ? 22 : WALL;
  return (
    <svg className="iso-room" width={W} height={H} aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7dd3fc" /><stop offset="1" stopColor="#e0f2fe" /></linearGradient>
        <linearGradient id="night" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1e1b4b" /><stop offset="1" stopColor="#4338ca" /></linearGradient>
      </defs>
      {f.open && <circle cx={W - 60} cy={30} r={night ? 16 : 22} fill={night ? '#e5e7eb' : '#fde047'} opacity="0.9" />}
      <polygon points={pts([left, top, up(top, wallH), up(left, wallH)])} fill={shade(f.wall, -0.12)} opacity={f.open ? 0.8 : 1} />
      <polygon points={pts([top, right, up(right, wallH), up(top, wallH)])} fill={f.wall} opacity={f.open ? 0.8 : 1} />
      <polygon points={pts([up(left, wallH), up(top, wallH), up(top, wallH + 6), up(left, wallH + 6)])} fill={shade(f.wall, 0.15)} />
      <polygon points={pts([up(top, wallH), up(right, wallH), up(right, wallH + 6), up(top, wallH + 6)])} fill={shade(f.wall, 0.2)} />
      {!f.open && windows}
      {/* Ascensor */}
      <polygon points={pts([d1, d2, up(d2, 62), up(d1, 62)])} fill="#9ca3af" stroke="#4b5563" strokeWidth="2" />
      <line x1={(d1.x + d2.x) / 2} y1={(d1.y + d2.y) / 2} x2={(d1.x + d2.x) / 2} y2={(d1.y + d2.y) / 2 - 62} stroke="#4b5563" strokeWidth="2" />
      <text x={(d1.x + d2.x) / 2} y={(d1.y + d2.y) / 2 - 68} fontSize="11" textAnchor="middle">🛗</text>
      {tiles}
      <polygon points={pts([top, right, P(f, f.cols, f.rows), left])} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
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
  const msg = state === 'working' ? '⌨️' : state === 'thinking' ? '💭' : state === 'done' ? '✅' : state === 'error' ? '💥' : state === 'talking' ? '💬' : w.emote;
  return (
    <button className={`walker ${w.moving ? 'walker--moving' : ''} ${me ? 'walker--me' : ''}`} style={style} onClick={(e) => { e.stopPropagation(); onClick(); }} title={`${a.name} · ${a.role}`}>
      {state === 'talking' && l?.message ? <span className="walker-say">{l.message.slice(0, 60)}{l.message.length > 60 ? '…' : ''}</span> : msg && <span className="walker-emote">{msg}</span>}
      <span className="walker-shadow" />
      <span className="walker-body" style={{ transform: `scaleX(${w.dir})` }}>
        <Chibi avatar={a.avatar} size={CHIBI} legs walking={w.moving} seed={idx} state={w.moving ? 'idle' : state} />
      </span>
      <span className="walker-name">{a.name}</span>
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

function FloorView({ f, number, walkers, agents, onSelect, night, me, onTile }: {
  f: FloorDef; number: string; walkers: Record<string, Walker>; agents: Agent[]; onSelect: (a: Agent) => void; night: boolean;
  me: Agent; onTile: (floor: string, i: number, j: number) => void;
}) {
  const { live } = useOffice();
  const { w: W, h: H } = roomSize(f);
  const { ref, scale } = useFit(W);
  const here = agents.filter((a) => walkers[a.id]?.floor === f.id && !walkers[a.id]?.inElevator);
  const working = here.filter((a) => ['working', 'thinking'].includes(live[a.id]?.status || '')).length;
  return (
    <section className={`bfloor ${f.open ? 'bfloor--open' : ''}`} id={`piso-${f.id}`} style={{ ['--wall' as string]: f.wall }}>
      <header className="bfloor-head">
        <span className="bfloor-num">{number}</span>
        <strong>{f.emoji} {f.name}</strong>
        <small className="muted">{here.length} aquí{working ? ` · ${working} trabajando` : ''}</small>
      </header>
      <div className="bfloor-stage" ref={ref} style={{ height: H * scale }}>
        <div
          className="bfloor-room"
          style={{ width: W, height: H, transform: `translateX(-50%) scale(${scale})` }}
          onClick={(e) => {
            // De la posición del clic a la casilla isométrica.
            const r = e.currentTarget.getBoundingClientRect();
            const k = r.width / W;
            const x = (e.clientX - r.left) / k - (f.rows * TW) / 2;
            const y = (e.clientY - r.top) / k - WALL;
            const i = Math.floor((x / (TW / 2) + y / (TH / 2)) / 2);
            const j = Math.floor((y / (TH / 2) - x / (TW / 2)) / 2);
            if (walkable(f, i, j)) onTile(f.id, i, j);
          }}
        >
          <Room f={f} night={night} />
          {f.furniture.map((m, k) => <Box key={k} f={f} m={m} />)}
          {here.map((a) => <Person key={a.id} f={f} a={a} w={walkers[a.id]} onClick={() => onSelect(a)} idx={agents.indexOf(a)} />)}
          {walkers[ME]?.floor === f.id && !walkers[ME].inElevator && <Person f={f} a={me} w={walkers[ME]} onClick={() => {}} idx={99} me />}
          {walkers[ME]?.goal?.floor === f.id && <span className="tile-marker" style={{ transform: `translate(${tileCenter(f, walkers[ME].goal!.i, walkers[ME].goal!.j).x - 14}px, ${tileCenter(f, walkers[ME].goal!.i, walkers[ME].goal!.j).y - 7}px)` }} />}
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
  const { agents, live, meetings } = useOffice();
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
  const active = useMemo(() => agents.filter((a) => a.enabled), [agents]);
  const walkers = useSim(active, live, meetings, hidden);
  const hour = new Date().getHours();
  const night = hour < 6 || hour >= 19;
  const numbers = FLOORS.map((f, k) => (f.id === 'lobby' ? 'PB' : f.id === 'penthouse' ? 'PH' : f.id === 'azotea' ? 'AZ' : String(FLOORS.length - 1 - k)));
  const inElevator = active.filter((a) => walkers[a.id]?.inElevator);

  return (
    <div className="building-wrap">
      <nav className="elevator-panel" aria-label="Ir a un piso">
        <span>🛗</span>
        {FLOORS.map((f, k) => (
          <button key={f.id} title={f.name} onClick={() => document.getElementById(`piso-${f.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            {numbers[k]}
          </button>
        ))}
        {inElevator.length > 0 && <small title={inElevator.map((a) => a.name).join(', ')}>{inElevator.length} en el ascensor</small>}
      </nav>
      <div className={`building ${night ? 'building--night' : ''}`}>
        <div className="roof">
          <span className="antenna" />
          <div className="roof-sign">🧠 OFICINA DE IAS</div>
        </div>
        {FLOORS.map((f, k) => (
          <FloorView key={f.id} f={f} number={numbers[k]} walkers={walkers} agents={active} onSelect={onSelect} night={night} me={me}
            onTile={(floor, i, j) => { walkers[ME].goal = { floor, i, j }; }} />
        ))}
        <div className="street">
          <span>🌳</span><span>🚲</span><span className="street-door">🚪 Entrada</span><span>🚕</span><span>🌳</span>
        </div>
      </div>
    </div>
  );
}
