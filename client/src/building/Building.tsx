// El edificio de la oficina (estilo Habbo): pisos isométricos apilados, con
// muebles, ventanas, ascensor y las IAs caminando libremente.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { levelOf, type Agent } from '../api';
import { Chibi } from '../components/Chibi';
import { useOffice } from '../state';
import { FLOORS, TH, TW, WALL, roomSize, tileCenter, walkable, type FloorDef, type Furniture } from './layout';

// Qué pasa cuando tu avatar usa un mueble.
const USE: Partial<Record<Furniture['kind'], string>> = {
  coffee: '☕ ¡Café!', vending: '🥤 ¡Refresco!', arcade: '🕹️ ¡Nuevo récord!', piano: '🎹 ♪♫', pool: '🏊 ¡Al agua!', gym: '🏋️ ¡Fuerza!',
  telescope: '🔭 ¡Se ve la luna!', aquarium: '🐠 ¡Hola, peces!', shelf: '📖 Leyendo…', grill: '🍖 ¡Asado!', table: '🍩 ¡Rico!', sofa: '🛋️ Descansando', easel: '🎨 Pintando', globe: '🌍 ¿A dónde viajo?', board: '📝 Anotando ideas', reception: '🛎️ ¡Ding!',
};
import { ME, PETS, TICK_MS, useSim, type Walker } from './useSim';
import type { AvatarConfig } from '../api';

const CHIBI = 40;

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

function Room({ f, night, doorOpen }: { f: FloorDef; night: boolean; doorOpen: boolean }) {
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
      <polygon points={pts([d1, d2, up(d2, 62), up(d1, 62)])} fill={doorOpen ? '#fef3c7' : '#9ca3af'} stroke="#4b5563" strokeWidth="2" />
      {doorOpen ? (
        <>
          <polygon points={pts([d1, { x: d1.x - 4, y: d1.y + 2 }, up({ x: d1.x - 4, y: d1.y + 2 }, 62), up(d1, 62)])} fill="#9ca3af" />
          <polygon points={pts([d2, { x: d2.x + 4, y: d2.y - 2 }, up({ x: d2.x + 4, y: d2.y - 2 }, 62), up(d2, 62)])} fill="#9ca3af" />
        </>
      ) : (
        <line x1={(d1.x + d2.x) / 2} y1={(d1.y + d2.y) / 2} x2={(d1.x + d2.x) / 2} y2={(d1.y + d2.y) / 2 - 62} stroke="#4b5563" strokeWidth="2" />
      )}
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
  if (w.running) style.filter = 'drop-shadow(-6px 0 2px rgba(255,255,255,0.35))';
  const msg = state === 'working' ? '⌨️' : state === 'thinking' ? '💭' : state === 'done' ? '✅' : state === 'error' ? '💥' : state === 'talking' ? '💬' : w.emote;
  return (
    <button className={`walker ${w.moving ? 'walker--moving' : ''} ${me ? 'walker--me' : ''}`} style={style} onClick={(e) => { e.stopPropagation(); onClick(); }} title={`${a.name} · ${a.role}`}>
      {state === 'talking' && l?.message ? <span className="walker-say">{l.message.slice(0, 60)}{l.message.length > 60 ? '…' : ''}</span> : msg && <span className="walker-emote">{msg}</span>}
      <span className="walker-shadow" />
      <span className="walker-body" style={{ transform: `scaleX(${w.dir})` }}>
        <Chibi avatar={a.avatar} size={CHIBI} legs walking={w.moving} seed={idx} state={w.moving ? 'idle' : state} />
      </span>
      <span className="walker-name">{a.name}{!me && <em> · Nv {levelOf(a)} · ⚡{Math.round(w.energy ?? 100)}</em>}</span>
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

function FloorView({ f: base, number, walkers, agents, onSelect, night, me, onTile }: {
  f: FloorDef; number: string; walkers: Record<string, Walker>; agents: Agent[]; onSelect: (a: Agent) => void; night: boolean;
  me: Agent; onTile: (floor: string, i: number, j: number, emote?: string) => void;
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
  const { ref, scale } = useFit(W);
  const all = [...agents.map((a) => walkers[a.id]), walkers[ME]].filter(Boolean);
  const doorOpen = all.some((w) => (w.floor === f.id && w.i === f.elevator.i && w.j === f.elevator.j && (w.moving || w.inElevator > 0)) || (w.inElevator > 0 && w.inElevator <= 2 && w.goal?.floor === f.id));
  const current = tasks.find((t) => t.status !== 'done' && t.status !== 'error');
  const here = agents.filter((a) => walkers[a.id]?.floor === f.id && !walkers[a.id]?.inElevator);
  const working = here.filter((a) => ['working', 'thinking'].includes(live[a.id]?.status || '')).length;
  return (
    <section className={`bfloor ${f.open ? 'bfloor--open' : ''}`} id={`piso-${f.id}`} style={{ ['--wall' as string]: f.wall }}>
      <header className="bfloor-head">
        <span className="bfloor-num">{number}</span>
        <strong>{f.emoji} {f.name}</strong>
        {(f.id === 'lobby' || f.id === 'penthouse') && current && <span className="bfloor-tv" title={current.prompt}>📺 {current.title}</span>}
        <small className="muted">{here.length} aquí{working ? ` · ${working} trabajando` : ''}</small>
        <button className="skin-btn" onClick={cycle} title={`Cambiar skin del piso (${THEMES[theme]?.name || 'original'})`}>🎨</button>
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
          <Room f={f} night={night} doorOpen={doorOpen} />
          {f.furniture.map((m, k) => <Box key={k} f={f} m={m} />)}
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

  const wrap = useRef<HTMLDivElement>(null);
  return (
    <div className="building-wrap" ref={wrap}>
      <nav className="elevator-panel" aria-label="Ir a un piso">
        <button title="Pantalla completa" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen?.())}>⛶</button>
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
            onTile={(floor, i, j, emote) => { walkers[ME].goal = { floor, i, j }; walkers[ME].onArrive = emote; }} />
        ))}
        <div className="street">
          <span>🌳</span><span>🚲</span><span className="street-door">🚪 Entrada</span><span>🚕</span><span>🌳</span>
        </div>
      </div>
    </div>
  );
}
