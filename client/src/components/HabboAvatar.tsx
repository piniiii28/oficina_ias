// Avatar en pixel art estilo Habbo (dibujo propio): figura alta en vista 3/4,
// con contorno oscuro y piezas combinables (pelo, camisa, pantalón, zapatos,
// accesorios y disfraces). Usa los mismos datos que el avatar chibi.
import type { AgentState, AvatarConfig } from '../api';

type Props = { avatar: AvatarConfig; state?: AgentState; size?: number; walking?: boolean; seed?: number };

export const HABBO_W = 26;
export const HABBO_H = 50;
const INK = '#1b1320';

function shade(hex: string, amt: number) {
  const n = parseInt((hex || '#888888').replace('#', ''), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `#${((c((n >> 16) & 255) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).padStart(6, '0')}`;
}

/** Bloque con contorno de 1 px (el sello del pixel art). */
function B({ x, y, w, h, c, o = true }: { x: number; y: number; w: number; h: number; c: string; o?: boolean }) {
  return (
    <>
      {o && <rect x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill={INK} />}
      <rect x={x} y={y} width={w} height={h} fill={c} />
    </>
  );
}
/** Píxel sin contorno. */
const px = (x: number, y: number, c: string, w = 1, h = 1, k?: string | number) => <rect key={k ?? `${x},${y},${c}`} x={x} y={y} width={w} height={h} fill={c} />;

const COSTUME_SHIRT: Record<string, string> = { ninja: '#1f2937', chef: '#f8fafc', astronauta: '#e5e7eb', mago: '#6d28d9', rey: '#b91c1c', pirata: '#7c2d12', vaquero: '#a16207' };

function Hair({ style, c }: { style: string; c: string }) {
  const d = shade(c, -0.18), l = shade(c, 0.15);
  switch (style) {
    case 'long':
      return <><B x={6} y={4} w={14} h={5} c={c} /><B x={5} y={7} w={4} h={16} c={d} /><B x={17} y={7} w={3} h={13} c={d} />{px(9, 4, l, 6)}</>;
    case 'bob':
      return <><B x={6} y={4} w={14} h={5} c={c} /><B x={5} y={7} w={4} h={9} c={d} /><B x={17} y={7} w={3} h={8} c={d} />{px(9, 4, l, 6)}</>;
    case 'twintails':
      return <><B x={6} y={4} w={14} h={4} c={c} /><B x={2} y={8} w={3} h={10} c={c} /><B x={21} y={8} w={3} h={10} c={c} />{px(9, 4, l, 6)}</>;
    case 'ponytail':
      return <><B x={6} y={4} w={14} h={4} c={c} /><B x={4} y={7} w={3} h={12} c={d} />{px(9, 4, l, 6)}</>;
    case 'bun':
      return <><B x={10} y={0} w={6} h={4} c={c} /><B x={6} y={4} w={14} h={4} c={c} />{px(11, 1, l, 3)}</>;
    case 'spiky':
      return <><B x={6} y={4} w={14} h={4} c={c} />{[7, 10, 13, 16].map((x) => <B key={x} x={x} y={1} w={2} h={3} c={c} o={false} />)}{px(8, 4, l, 10)}</>;
    case 'messy':
      return <><B x={6} y={3} w={14} h={5} c={c} />{px(5, 5, c, 2, 2)}{px(19, 4, c, 2, 2)}{px(9, 3, l, 3)}{px(14, 3, l, 2)}</>;
    case 'slick':
      return <><B x={6} y={4} w={14} h={3} c={c} />{px(7, 7, c, 3, 2)}{px(10, 4, l, 8)}</>;
    case 'hoodie':
      return null; // la capucha se dibuja con la ropa
    case 'cap':
      return <><B x={6} y={3} w={14} h={4} c={c} /><B x={14} y={6} w={8} h={2} c={shade(c, -0.25)} /></>;
    case 'beret':
      return <><B x={5} y={2} w={15} h={4} c={c} />{px(12, 1, c, 2)}</>;
    default: // short
      return <><B x={6} y={4} w={14} h={4} c={c} />{px(6, 7, d, 2, 3)}{px(9, 4, l, 7)}</>;
  }
}

function Eyes({ style, blink }: { style: string; blink: boolean }) {
  const y = 11;
  if (blink || style === 'happy') return <>{px(11, y, INK, 2)}{px(16, y, INK, 2)}</>;
  if (style === 'dreamy') return <>{px(11, y, INK, 2)}{px(16, y, INK, 2)}{px(11, y - 1, '#a78bfa', 2)}{px(16, y - 1, '#a78bfa', 2)}</>;
  if (style === 'focused') return <>{px(11, y, INK, 2, 2)}{px(16, y, INK, 2, 2)}{px(10, y - 2, INK, 3)}{px(15, y - 2, INK, 3)}</>;
  if (style === 'cool') return <>{px(10, y - 1, INK, 9, 3)}{px(11, y - 1, '#60a5fa', 2)}{px(16, y - 1, '#60a5fa', 2)}</>;
  if (style === 'glasses') return <>{px(10, y - 1, INK, 4, 1)}{px(15, y - 1, INK, 4, 1)}{px(10, y + 2, INK, 4, 1)}{px(15, y + 2, INK, 4, 1)}{px(14, y, INK)}{px(11, y, INK, 2, 2)}{px(16, y, INK, 2, 2)}</>;
  // sparkle (por defecto): ojos con brillo
  return <>{px(11, y, INK, 2, 2)}{px(16, y, INK, 2, 2)}{px(11, y, '#ffffff')}{px(16, y, '#ffffff')}</>;
}

function Accessory({ kind, outfit }: { kind: string; outfit: string }) {
  switch (kind) {
    case 'halo': return <rect x={8} y={-2} width={10} height={2} fill="none" stroke="#fde047" strokeWidth="1" />;
    case 'headphones': return <><B x={5} y={3} w={16} h={1} c="#374151" /><B x={4} y={9} w={3} h={4} c="#111827" /><B x={19} y={9} w={3} h={4} c="#111827" /></>;
    case 'bow': return <><B x={15} y={2} w={2} h={2} c="#ec4899" /><B x={18} y={2} w={2} h={2} c="#ec4899" />{px(17, 2, '#be185d', 1, 2)}</>;
    case 'antenna': return <>{px(13, -2, INK, 1, 5)}<B x={12} y={-4} w={3} h={2} c="#f43f5e" /></>;
    case 'star': return <B x={17} y={2} w={3} h={3} c="#fde047" />;
    case 'shades': return <>{px(10, 10, INK, 9, 3)}{px(11, 10, '#334155', 2)}{px(16, 10, '#334155', 2)}</>;
    case 'glasses': return <>{px(10, 10, INK, 4, 1)}{px(15, 10, INK, 4, 1)}{px(10, 13, INK, 4, 1)}{px(15, 13, INK, 4, 1)}</>;
    case 'tie': return <><B x={12} y={22} w={2} h={7} c="#dc2626" /></>;
    case 'flower': return <><B x={6} y={4} w={3} h={3} c="#f472b6" />{px(7, 5, '#fde047')}</>;
    case 'gradcap': return <><B x={6} y={2} w={15} h={2} c="#111827" /><B x={10} y={4} w={7} h={2} c="#111827" />{px(20, 4, '#fde047', 1, 4)}</>;
    case 'book': return <B x={20} y={29} w={4} h={5} c="#7c3aed" />;
    case 'clipboard': return <><B x={20} y={27} w={4} h={6} c="#a16207" />{px(21, 28, '#f8fafc', 2, 4)}</>;
    case 'megaphone': return <B x={20} y={26} w={5} h={3} c="#f97316" />;
    case 'magnifier': return <><B x={21} y={25} w={3} h={3} c="#bae6fd" />{px(22, 28, INK, 1, 3)}</>;
    case 'pencil': return <><B x={21} y={26} w={1} h={6} c="#facc15" />{px(21, 32, '#f8fafc')}</>;
    case 'whistle': return <><B x={13} y={20} w={2} h={2} c="#e5e7eb" />{px(12, 19, shade(outfit, -0.4), 4, 1)}</>;
    default: return null;
  }
}

function Costume({ kind }: { kind: string }) {
  switch (kind) {
    case 'mago': return <><B x={6} y={3} w={15} h={2} c="#6d28d9" /><B x={9} y={-3} w={8} h={6} c="#6d28d9" /><B x={11} y={-7} w={4} h={4} c="#6d28d9" />{px(12, -1, '#fde047')}{px(15, 1, '#fde047')}</>;
    case 'astronauta': return <rect x={4} y={1} width={18} height={17} rx={6} fill="rgba(186,230,253,0.35)" stroke="#e5e7eb" strokeWidth="1.5" />;
    case 'ninja': return <><B x={6} y={4} w={14} h={5} c="#111827" /><B x={6} y={12} w={14} h={5} c="#111827" />{px(20, 6, '#dc2626', 3, 1)}</>;
    case 'chef': return <><B x={7} y={-3} w={12} h={7} c="#f8fafc" /><B x={6} y={3} w={14} h={2} c="#e5e7eb" /></>;
    case 'rey': return <><B x={7} y={0} w={12} h={4} c="#facc15" />{[8, 12, 16].map((x) => px(x, -2, '#facc15', 2, 2, x))}{px(12, 1, '#dc2626', 2)}</>;
    case 'pirata': return <><B x={5} y={1} w={16} h={4} c="#111827" />{px(12, 2, '#f8fafc', 2)}{px(15, 10, INK, 3, 3)}{px(10, 9, INK, 9, 1)}</>;
    case 'gato': return <><B x={6} y={1} w={3} h={3} c="#1f2937" /><B x={17} y={1} w={3} h={3} c="#1f2937" />{px(7, 2, '#f9a8d4')}{px(18, 2, '#f9a8d4')}</>;
    case 'vaquero': return <><B x={3} y={4} w={20} h={2} c="#92400e" /><B x={7} y={0} w={12} h={4} c="#a16207" /></>;
    default: return null;
  }
}

export function HabboAvatar({ avatar, state = 'idle', size = 26, walking = false, seed = 0 }: Props) {
  const costume = avatar.costume || 'none';
  const shirt = COSTUME_SHIRT[costume] || avatar.outfit || '#60a5fa';
  const pants = costume === 'ninja' ? '#111827' : shade(shirt === '#f8fafc' ? '#475569' : shirt, -0.45);
  const skin = avatar.skin || '#f1c7a5';
  const skinD = shade(skin, -0.12);
  const shoes = '#27272a';
  const hood = avatar.hairStyle === 'hoodie';
  const typing = state === 'working';
  return (
    <svg
      className={`habbo habbo--${state}${walking ? ' habbo--walking' : ''}`}
      viewBox={`-2 -8 ${HABBO_W + 4} ${HABBO_H + 9}`}
      width={size}
      height={(size * (HABBO_H + 9)) / (HABBO_W + 4)}
      shapeRendering="crispEdges"
      style={{ ['--delay' as string]: `${(seed % 7) * -0.37}s` }}
      aria-hidden
    >
      {costume === 'capa' && <B x={5} y={19} w={16} h={20} c="#b91c1c" />}
      {/* Piernas y zapatos (se alternan al caminar) */}
      <g className="habbo-leg-l"><B x={8} y={33} w={4} h={10} c={pants} /><B x={7} y={43} w={6} h={2} c={shoes} /></g>
      <g className="habbo-leg-r"><B x={14} y={33} w={4} h={10} c={shade(pants, -0.08)} /><B x={14} y={43} w={6} h={2} c={shoes} /></g>
      {/* Torso y brazos */}
      <g className="habbo-arm-l"><B x={3} y={20} w={4} h={10} c={shade(shirt, -0.12)} /><B x={3} y={30} w={4} h={3} c={skinD} /></g>
      <B x={6} y={19} w={14} h={15} c={shirt} />
      {px(7, 20, shade(shirt, 0.18), 12, 1)}
      {px(6, 33, shade(shirt, -0.25), 14, 1)}
      <g className={`habbo-arm-r${typing ? ' habbo-typing' : ''}`}><B x={19} y={20} w={4} h={10} c={shade(shirt, -0.05)} /><B x={19} y={30} w={4} h={3} c={skin} /></g>
      {hood && <B x={5} y={3} w={16} h={16} c={shade(shirt, -0.1)} />}
      {/* Cabeza */}
      <B x={11} y={17} w={4} h={2} c={skinD} />
      <B x={7} y={5} w={13} h={13} c={skin} />
      {px(7, 12, skinD, 1, 3)}
      {px(19, 6, shade(skin, 0.1), 1, 5)}
      <Eyes style={avatar.eyes} blink={state === 'done'} />
      {state === 'talking' ? <g className="habbo-mouth">{px(13, 15, '#7f1d1d', 3, 2)}</g> : state === 'error' ? px(13, 16, INK, 3, 1) : <>{px(13, 15, INK, 3, 1)}{px(12, 14, INK)}{px(16, 14, INK)}</>}
      {px(10, 14, '#f9a8d4', 1, 1)}{px(18, 14, '#f9a8d4', 1, 1)}
      {!hood && <Hair style={avatar.hairStyle} c={avatar.hair || '#3f2a1d'} />}
      <Costume kind={costume} />
      <Accessory kind={avatar.accessory} outfit={shirt} />
      {state === 'thinking' && <g className="habbo-think">{px(22, -4, '#ffffff', 3, 3)}{px(24, -7, '#ffffff', 2, 2)}</g>}
    </svg>
  );
}
