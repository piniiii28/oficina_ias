// Avatar chibi en SVG: cabeza grande, cuerpo pequeño y animaciones por estado
// (reposo, pensando, trabajando, hablando, listo, error).
import type { AgentState, AvatarConfig } from '../api';

type Props = {
  avatar: AvatarConfig;
  state?: AgentState;
  size?: number;
  legs?: boolean;
  seed?: number;
};

export const HAIR_STYLES = ['short', 'long', 'bob', 'twintails', 'ponytail', 'bun', 'spiky', 'messy', 'hoodie', 'cap', 'slick', 'beret'];
export const EYE_STYLES = ['sparkle', 'happy', 'cool', 'glasses', 'focused', 'dreamy'];
export const ACCESSORIES = ['none', 'halo', 'headphones', 'bow', 'antenna', 'star', 'shades', 'glasses', 'tie', 'flower', 'gradcap', 'book', 'clipboard', 'megaphone', 'magnifier', 'pencil', 'whistle'];

function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const BANGS = 'M24,60 Q20,18 60,17 Q100,18 96,60 Q94,44 84,38 Q78,46 66,40 Q58,48 46,40 Q36,46 30,42 Q26,50 24,60 Z';

function HairBack({ style, color, outfit }: { style: string; color: string; outfit: string }) {
  switch (style) {
    case 'long':
      return <path d="M22,56 Q18,14 60,14 Q102,14 98,56 L102,112 Q84,104 60,108 Q36,104 18,112 Z" fill={shade(color, -0.08)} />;
    case 'bob':
      return <path d="M20,58 Q16,14 60,14 Q104,14 100,58 L100,86 Q92,92 84,84 L36,84 Q28,92 20,86 Z" fill={shade(color, -0.08)} />;
    case 'twintails':
      return (
        <g fill={shade(color, -0.08)}>
          <path d="M26,52 Q4,60 8,96 Q12,112 22,118 Q18,96 30,74 Z" />
          <path d="M94,52 Q116,60 112,96 Q108,112 98,118 Q102,96 90,74 Z" />
        </g>
      );
    case 'ponytail':
      return <path d="M86,30 Q124,34 112,92 Q106,108 98,112 Q106,80 90,54 Z" fill={shade(color, -0.08)} />;
    case 'bun':
      return <circle cx="60" cy="16" r="13" fill={color} />;
    case 'hoodie':
      return <circle cx="60" cy="60" r="44" fill={shade(outfit, -0.12)} />;
    default:
      return null;
  }
}

function HairFront({ style, color, outfit }: { style: string; color: string; outfit: string }) {
  const hi = shade(color, 0.18);
  switch (style) {
    case 'spiky':
      return <path d="M20,62 L24,34 L34,40 L36,16 L48,30 L56,8 L64,28 L76,10 L80,32 L92,20 L92,42 L100,62 Q92,40 60,38 Q30,40 20,62 Z" fill={color} />;
    case 'messy':
      return (
        <path
          d="M22,60 Q16,34 30,26 Q30,12 46,16 Q54,4 66,14 Q80,6 86,22 Q102,26 98,60 Q94,42 82,40 Q76,48 64,40 Q56,50 44,42 Q34,48 30,42 Q24,48 22,60 Z"
          fill={color}
        />
      );
    case 'slick':
      return <path d="M24,58 Q20,16 62,16 Q102,18 96,58 Q94,34 70,30 Q44,28 32,40 Q26,46 24,58 Z" fill={color} />;
    case 'hoodie':
      return <path d="M28,52 Q30,26 60,26 Q90,26 92,52 Q84,40 60,40 Q36,40 28,52 Z" fill={color} />;
    case 'cap':
      return (
        <g>
          <path d={BANGS} fill={color} />
          <path d="M22,44 Q24,12 60,12 Q96,12 98,44 Z" fill={outfit} />
          <path d="M60,44 Q90,42 112,50 Q96,54 60,50 Z" fill={shade(outfit, -0.15)} />
          <circle cx="60" cy="13" r="3" fill={shade(outfit, 0.2)} />
        </g>
      );
    case 'beret':
      return (
        <g>
          <path d={BANGS} fill={color} />
          <ellipse cx="54" cy="22" rx="36" ry="12" transform="rotate(-10 54 22)" fill="#7f1d1d" />
          <circle cx="50" cy="11" r="3" fill="#7f1d1d" />
        </g>
      );
    default:
      return (
        <g>
          <path d={BANGS} fill={color} />
          <path d="M40,24 Q52,18 64,20" stroke={hi} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.7" />
        </g>
      );
  }
}

function Eyes({ style }: { style: string }) {
  const ink = '#2b2340';
  if (style === 'happy') {
    return (
      <g stroke={ink} strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M40,66 Q46,58 52,66" />
        <path d="M68,66 Q74,58 80,66" />
      </g>
    );
  }
  const lid = style === 'dreamy';
  return (
    <g className="chibi-eyes">
      {[46, 74].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="65" rx="5.5" ry={lid ? 4.5 : 7} fill={ink} />
          <circle cx={x + 2} cy={lid ? 63 : 62} r="2.2" fill="#fff" />
          {style === 'sparkle' && <circle cx={x - 2} cy="68" r="1.2" fill="#fff" />}
          {lid && <path d={`M${x - 7},61 Q${x},57 ${x + 7},61`} stroke={ink} strokeWidth="2.5" fill="none" strokeLinecap="round" />}
        </g>
      ))}
      {style === 'focused' && (
        <g stroke={ink} strokeWidth="2.5" strokeLinecap="round">
          <path d="M39,53 L52,56" />
          <path d="M81,53 L68,56" />
        </g>
      )}
      {style === 'glasses' && <Glasses />}
    </g>
  );
}

function Glasses() {
  return (
    <g stroke="#3f3f46" strokeWidth="2.2" fill="rgba(255,255,255,0.18)">
      <circle cx="46" cy="65" r="10" />
      <circle cx="74" cy="65" r="10" />
      <path d="M56,64 Q60,61 64,64" fill="none" />
    </g>
  );
}

function Accessory({ kind, outfit }: { kind: string; outfit: string }) {
  switch (kind) {
    case 'halo':
      return <ellipse className="chibi-float" cx="60" cy="8" rx="20" ry="5" fill="none" stroke="#fde047" strokeWidth="3.5" filter="url(#glow)" />;
    case 'headphones':
      return (
        <g>
          <path d="M22,58 Q20,12 60,12 Q100,12 98,58" stroke="#27272a" strokeWidth="5" fill="none" />
          <rect x="14" y="52" width="12" height="20" rx="5" fill={shade(outfit, -0.1)} />
          <rect x="94" y="52" width="12" height="20" rx="5" fill={shade(outfit, -0.1)} />
        </g>
      );
    case 'bow':
      return (
        <g transform="translate(84 26) rotate(15)">
          <path d="M0,0 L-12,-8 L-12,8 Z M0,0 L12,-8 L12,8 Z" fill="#f43f5e" />
          <circle r="3.5" fill="#be123c" />
        </g>
      );
    case 'antenna':
      return (
        <g className="chibi-float">
          <line x1="60" y1="20" x2="60" y2="2" stroke="#52525b" strokeWidth="2.5" />
          <circle cx="60" cy="2" r="4.5" fill="#22d3ee" filter="url(#glow)" />
        </g>
      );
    case 'star':
      return <path transform="translate(84 30) scale(0.9)" d="M0,-9 L2.6,-2.8 L9,-2.8 L3.8,1.4 L5.6,8 L0,4 L-5.6,8 L-3.8,1.4 L-9,-2.8 L-2.6,-2.8 Z" fill="#fde047" />;
    case 'shades':
      return (
        <g>
          <rect x="35" y="58" width="22" height="13" rx="5" fill="#111" />
          <rect x="63" y="58" width="22" height="13" rx="5" fill="#111" />
          <path d="M57,63 L63,63" stroke="#111" strokeWidth="3" />
          <path d="M39,61 L46,61" stroke="#fff" strokeWidth="1.5" opacity="0.6" />
        </g>
      );
    case 'glasses':
      return <Glasses />;
    case 'flower':
      return (
        <g transform="translate(86 30)">
          {[0, 72, 144, 216, 288].map((r) => (
            <ellipse key={r} rx="4" ry="7" transform={`rotate(${r}) translate(0 -5)`} fill="#fda4af" />
          ))}
          <circle r="3.5" fill="#fde047" />
        </g>
      );
    case 'gradcap':
      return (
        <g>
          <path d="M26,22 L60,8 L94,22 L60,34 Z" fill="#18181b" />
          <rect x="44" y="24" width="32" height="8" fill="#18181b" />
          <path d="M92,22 L96,40" stroke="#fde047" strokeWidth="2" />
          <circle cx="96" cy="42" r="3" fill="#fde047" />
        </g>
      );
    default:
      return null;
  }
}

const HELD: Record<string, string> = {
  book: '📘', clipboard: '📋', megaphone: '📣', magnifier: '🔍', pencil: '✏️', whistle: '📯',
};

export function Chibi({ avatar, state = 'idle', size = 96, legs = false, seed = 0 }: Props) {
  const { skin, hair, hairStyle, eyes, outfit, accessory } = avatar;
  const delay = `${(seed % 7) * -0.37}s`;
  const typing = state === 'working';
  return (
    <svg
      className={`chibi chibi--${state}`}
      viewBox={legs ? '0 -6 120 166' : '0 -6 120 146'}
      width={size}
      height={size * (legs ? 166 : 146) / 120}
      style={{ ['--delay' as string]: delay }}
      aria-hidden
    >
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g className="chibi-body">
        {legs && (
          <g fill={shade(outfit, -0.3)}>
            <rect x="44" y="130" width="12" height="22" rx="5" />
            <rect x="64" y="130" width="12" height="22" rx="5" />
            <ellipse cx="50" cy="153" rx="9" ry="5" fill="#3f3f46" />
            <ellipse cx="70" cy="153" rx="9" ry="5" fill="#3f3f46" />
          </g>
        )}
        {/* Torso */}
        <path d="M38,98 Q60,90 82,98 L88,134 Q60,142 32,134 Z" fill={outfit} />
        <path d="M52,94 L60,106 L68,94 Z" fill="#fff" opacity="0.9" />
        {accessory === 'tie' && <path d="M58,104 L62,104 L64,124 L60,130 L56,124 Z" fill="#dc2626" />}
        {/* Brazos */}
        <g className={typing ? 'chibi-arm-l typing' : 'chibi-arm-l'}>
          <path d={typing ? 'M40,104 Q32,118 46,126' : 'M40,102 Q28,114 32,126'} stroke={outfit} strokeWidth="11" fill="none" strokeLinecap="round" />
          <circle cx={typing ? 47 : 32} cy={typing ? 127 : 128} r="6" fill={skin} />
        </g>
        <g className={typing ? 'chibi-arm-r typing' : 'chibi-arm-r'}>
          <path d={typing ? 'M80,104 Q88,118 74,126' : 'M80,102 Q92,114 88,126'} stroke={outfit} strokeWidth="11" fill="none" strokeLinecap="round" />
          <circle cx={typing ? 73 : 88} cy={typing ? 127 : 128} r="6" fill={skin} />
        </g>
        {HELD[accessory] && !typing && (
          <text x="92" y="130" fontSize="18" textAnchor="middle">{HELD[accessory]}</text>
        )}
      </g>
      <g className="chibi-head">
        <HairBack style={hairStyle} color={hair} outfit={outfit} />
        <rect x="54" y="86" width="12" height="10" fill={shade(skin, -0.08)} />
        <circle cx="60" cy="58" r="36" fill={skin} />
        <ellipse cx="25" cy="62" rx="5" ry="7" fill={shade(skin, -0.05)} />
        <ellipse cx="95" cy="62" rx="5" ry="7" fill={shade(skin, -0.05)} />
        <ellipse cx="37" cy="76" rx="6" ry="3.5" fill="#fb7185" opacity="0.45" />
        <ellipse cx="83" cy="76" rx="6" ry="3.5" fill="#fb7185" opacity="0.45" />
        <Eyes style={eyes} />
        {state === 'talking' || state === 'thinking' ? (
          <ellipse className="chibi-mouth-talk" cx="60" cy="80" rx="4" ry="3" fill="#7f1d1d" />
        ) : state === 'error' ? (
          <path d="M54,82 Q60,76 66,82" stroke="#7f1d1d" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M53,78 Q60,86 67,78" stroke="#7f1d1d" strokeWidth="2.5" fill={state === 'done' ? '#7f1d1d' : 'none'} strokeLinecap="round" />
        )}
        <HairFront style={hairStyle} color={hair} outfit={outfit} />
        {hairStyle === 'twintails' && (
          <g fill="#f472b6">
            <circle cx="26" cy="50" r="4" />
            <circle cx="94" cy="50" r="4" />
          </g>
        )}
        <Accessory kind={accessory} outfit={outfit} />
      </g>
    </svg>
  );
}
