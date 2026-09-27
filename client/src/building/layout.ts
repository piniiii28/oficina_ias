// Planos del edificio: pisos isométricos (estilo Habbo) con muebles,
// escritorios y un ascensor que conecta todos los pisos.

export type Furniture = {
  i: number;
  j: number;
  kind: 'printer' | 'filament' | 'pingpong' | 'beanbag' | 'rug' | 'pool' | 'bench' | 'gym' | 'telescope' | 'grill' | 'umbrella' | 'desk' | 'plant' | 'coffee' | 'sofa' | 'shelf' | 'board' | 'server' | 'easel' | 'table' | 'vending' | 'reception' | 'arcade' | 'globe' | 'cabinet' | 'bigtable' | 'piano' | 'aquarium';
  w?: number; // ancho en casillas (eje i)
  h?: number; // fondo en casillas (eje j)
  label?: string;
};

export type FloorDef = {
  id: string;
  name: string;
  emoji: string;
  department?: string; // los agentes de este departamento viven aquí
  cols: number;
  rows: number;
  floorA: string;
  floorB: string;
  wall: string;
  furniture: Furniture[];
  desks: { i: number; j: number }[]; // cada escritorio; el asiento está en (i, j - 1)
  elevator: { i: number; j: number }; // casilla frente a la puerta del ascensor
  hangouts?: { i: number; j: number }[]; // lugares preferidos para pasear
  open?: boolean; // al aire libre: barandas en vez de paredes
  art?: string[]; // cuadros en la pared izquierda
};

const deskRow = (j: number, from: number, n: number, gap = 2) => Array.from({ length: n }, (_, k) => ({ i: from + k * gap, j }));

export const FLOORS: FloorDef[] = [
  {
    id: 'azotea', name: 'Azotea · Jardín, gimnasio y piscina', emoji: '🌤️',
    cols: 12, rows: 6, floorA: '#3f7d3a', floorB: '#4a8c44', wall: '#94a3b8', open: true,
    desks: [],
    furniture: [
      { i: 7, j: 2, kind: 'pool', w: 3, h: 2 },
      { i: 1, j: 0, kind: 'gym' }, { i: 2, j: 0, kind: 'gym' },
      { i: 0, j: 5, kind: 'bench', w: 2 }, { i: 11, j: 0, kind: 'telescope' },
      { i: 4, j: 0, kind: 'grill' }, { i: 11, j: 5, kind: 'umbrella' },
      { i: 5, j: 5, kind: 'plant' }, { i: 0, j: 0, kind: 'plant' }, { i: 9, j: 0, kind: 'plant' },
    ],
    elevator: { i: 0, j: 3 },
    hangouts: [{ i: 1, j: 1 }, { i: 2, j: 1 }, { i: 6, j: 3 }, { i: 10, j: 1 }, { i: 1, j: 4 }, { i: 10, j: 5 }, { i: 4, j: 1 }],
  },
  {
    id: 'penthouse', name: 'Penthouse del Cerebro', emoji: '🧠', department: 'direccion',
    cols: 10, rows: 6, floorA: '#3d2f5c', floorB: '#4a3a6e', wall: '#7c5cc4',
    desks: [{ i: 4, j: 3 }],
    furniture: [
      { i: 6, j: 3, kind: 'rug', w: 3, h: 2 },
      { i: 4, j: 3, kind: 'desk', label: '🧠' },
      { i: 8, j: 0, kind: 'shelf', h: 0.6 }, { i: 9, j: 0, kind: 'shelf', h: 0.6 },
      { i: 0, j: 0, kind: 'plant' }, { i: 9, j: 5, kind: 'plant' },
      { i: 7, j: 4, kind: 'sofa', w: 2 },
      { i: 2, j: 0, kind: 'board', w: 2, h: 0.3 },
      { i: 6, j: 1, kind: 'globe' },
      { i: 1, j: 5, kind: 'aquarium' },
    ],
    art: ['🖼️', '🏆'],
    elevator: { i: 0, j: 3 },
    hangouts: [{ i: 8, j: 3 }, { i: 6, j: 2 }, { i: 3, j: 1 }],
  },
  {
    id: 'codigo', name: 'Ingeniería', emoji: '💻', department: 'codigo',
    cols: 11, rows: 7, floorA: '#1f3b5c', floorB: '#26466b', wall: '#3b82f6',
    desks: [...deskRow(2, 2, 4), ...deskRow(5, 2, 3)],
    furniture: [
      { i: 7, j: 4, kind: 'rug', w: 2, h: 2 },
      ...deskRow(2, 2, 4).map((d) => ({ ...d, kind: 'desk' as const, label: '💻' })),
      ...deskRow(5, 2, 3).map((d) => ({ ...d, kind: 'desk' as const, label: '⌨️' })),
      { i: 10, j: 0, kind: 'server' }, { i: 10, j: 1, kind: 'server' }, { i: 10, j: 2, kind: 'server' },
      { i: 0, j: 0, kind: 'plant' }, { i: 9, j: 6, kind: 'vending' },
      { i: 3, j: 0, kind: 'board', w: 2, h: 0.3 },
    ],
    art: ['🖥️', '🐧'],
    elevator: { i: 0, j: 4 },
    hangouts: [{ i: 9, j: 4 }, { i: 8, j: 5 }],
  },
  {
    id: 'datos', name: 'Datos y Razonamiento', emoji: '📊', department: 'datos',
    cols: 10, rows: 6, floorA: '#17443a', floorB: '#1d5246', wall: '#10b981',
    desks: deskRow(3, 2, 3, 3),
    furniture: [
      { i: 3, j: 5, kind: 'rug', w: 3, h: 1 },
      ...deskRow(3, 2, 3, 3).map((d) => ({ ...d, kind: 'desk' as const, label: '📈' })),
      { i: 1, j: 0, kind: 'board', w: 3, h: 0.3 }, { i: 6, j: 0, kind: 'cabinet' }, { i: 7, j: 0, kind: 'cabinet' },
      { i: 9, j: 5, kind: 'plant' }, { i: 9, j: 0, kind: 'server' },
    ],
    art: ['📈', '🧮'],
    elevator: { i: 0, j: 4 },
    hangouts: [{ i: 7, j: 5 }, { i: 4, j: 5 }],
  },
  {
    id: 'creatividad', name: 'Estudio Creativo', emoji: '🎨', department: 'creatividad',
    cols: 10, rows: 6, floorA: '#4a2340', floorB: '#58294c', wall: '#ec4899',
    desks: deskRow(3, 1, 4),
    furniture: [
      { i: 5, j: 4, kind: 'rug', w: 2, h: 1 },
      ...deskRow(3, 1, 4).map((d) => ({ ...d, kind: 'desk' as const, label: '🖌️' })),
      { i: 9, j: 1, kind: 'easel' }, { i: 9, j: 3, kind: 'easel' }, { i: 1, j: 0, kind: 'piano', w: 2 },
      { i: 5, j: 5, kind: 'sofa', w: 2 }, { i: 9, j: 5, kind: 'plant' }, { i: 5, j: 0, kind: 'shelf', h: 0.6 },
    ],
    art: ['🎭', '🖼️'],
    elevator: { i: 0, j: 4 },
    hangouts: [{ i: 8, j: 2 }, { i: 6, j: 4 }, { i: 3, j: 1 }],
  },
  {
    id: 'investigacion', name: 'Investigación', emoji: '🔎', department: 'investigacion',
    cols: 10, rows: 6, floorA: '#4a3a17', floorB: '#58461d', wall: '#f59e0b',
    desks: deskRow(3, 2, 3, 3),
    furniture: [
      { i: 5, j: 4, kind: 'rug', w: 3, h: 2 },
      ...deskRow(3, 2, 3, 3).map((d) => ({ ...d, kind: 'desk' as const, label: '🔬' })),
      { i: 2, j: 0, kind: 'shelf', h: 0.6 }, { i: 3, j: 0, kind: 'shelf', h: 0.6 }, { i: 4, j: 0, kind: 'shelf', h: 0.6 }, { i: 5, j: 0, kind: 'shelf', h: 0.6 },
      { i: 8, j: 0, kind: 'globe' }, { i: 9, j: 5, kind: 'plant' },
    ],
    art: ['🗺️', '🔭'],
    elevator: { i: 0, j: 4 },
    hangouts: [{ i: 7, j: 1 }, { i: 6, j: 5 }],
  },
  {
    id: 'negocios', name: 'Negocios', emoji: '📈', department: 'negocios',
    cols: 10, rows: 6, floorA: '#4a2c17', floorB: '#58351d', wall: '#f97316',
    desks: deskRow(3, 1, 4),
    furniture: [
      { i: 6, j: 4, kind: 'rug', w: 2, h: 1 },
      ...deskRow(3, 1, 4).map((d) => ({ ...d, kind: 'desk' as const, label: '💼' })),
      { i: 3, j: 0, kind: 'board', w: 2, h: 0.3 }, { i: 8, j: 0, kind: 'cabinet' },
      { i: 8, j: 5, kind: 'sofa', w: 2 }, { i: 0, j: 0, kind: 'plant' },
    ],
    art: ['💹', '🏅'],
    elevator: { i: 0, j: 4 },
    hangouts: [{ i: 6, j: 5 }, { i: 9, j: 2 }],
  },
  {
    id: 'personas', name: 'Personas y Conocimiento', emoji: '📚', department: 'personas',
    cols: 11, rows: 7, floorA: '#15423f', floorB: '#1b504c', wall: '#14b8a6',
    desks: [...deskRow(2, 2, 3, 3), ...deskRow(5, 2, 3, 3)],
    furniture: [
      { i: 7, j: 4, kind: 'rug', w: 2, h: 2 },
      ...deskRow(2, 2, 3, 3).map((d) => ({ ...d, kind: 'desk' as const, label: '📖' })),
      ...deskRow(5, 2, 3, 3).map((d) => ({ ...d, kind: 'desk' as const, label: '✏️' })),
      { i: 10, j: 0, kind: 'shelf', h: 0.6 }, { i: 10, j: 1, kind: 'shelf', h: 0.6 }, { i: 10, j: 2, kind: 'shelf', h: 0.6 },
      { i: 0, j: 0, kind: 'plant' }, { i: 10, j: 6, kind: 'plant' },
    ],
    art: ['🎓', '🌻'],
    elevator: { i: 0, j: 3 },
    hangouts: [{ i: 9, j: 4 }, { i: 1, j: 6 }],
  },
  {
    id: 'impresion3d', name: 'Taller de Impresión 3D', emoji: '🖨️', department: 'impresion3d',
    cols: 11, rows: 6, floorA: '#2f3d1c', floorB: '#384922', wall: '#84cc16',
    desks: deskRow(3, 1, 4),
    furniture: [
      { i: 6, j: 5, kind: 'rug', w: 3, h: 1 },
      ...deskRow(3, 1, 4).map((d, k) => ({ ...d, kind: 'desk' as const, label: ['🧊', '📐', '⚙️', '🧅'][k] })),
      { i: 5, j: 0, kind: 'printer' }, { i: 6, j: 0, kind: 'printer' }, { i: 7, j: 0, kind: 'printer' },
      { i: 10, j: 1, kind: 'filament' }, { i: 10, j: 2, kind: 'filament' },
      { i: 1, j: 0, kind: 'board', w: 2, h: 0.3 }, { i: 10, j: 5, kind: 'plant' }, { i: 9, j: 0, kind: 'cabinet' },
    ],
    art: ['🧊', '🛠️'],
    elevator: { i: 0, j: 4 },
    hangouts: [{ i: 6, j: 1 }, { i: 9, j: 2 }, { i: 7, j: 4 }],
  },
  {
    id: 'lobby', name: 'Lobby · Cafetería · Sala de reuniones', emoji: '☕',
    cols: 14, rows: 7, floorA: '#5a4632', floorB: '#6a543c', wall: '#b08968',
    desks: [],
    furniture: [
      { i: 1, j: 2, kind: 'rug', w: 4, h: 3 },
      { i: 1, j: 0, kind: 'coffee' }, { i: 2, j: 0, kind: 'vending' }, { i: 3, j: 0, kind: 'coffee' },
      { i: 2, j: 3, kind: 'table' }, { i: 4, j: 5, kind: 'table' },
      { i: 9, j: 2, kind: 'bigtable', w: 2, h: 2, label: '🗣️' },
      { i: 6, j: 0, kind: 'reception', w: 2, label: '🛎️' },
      { i: 13, j: 0, kind: 'arcade' }, { i: 13, j: 6, kind: 'plant' }, { i: 0, j: 6, kind: 'plant' },
      { i: 12, j: 5, kind: 'sofa', w: 2 },
      { i: 5, j: 0, kind: 'aquarium' },
    ],
    art: ['🖼️', '☕'],
    elevator: { i: 0, j: 3 },
    hangouts: [{ i: 1, j: 1 }, { i: 2, j: 1 }, { i: 3, j: 1 }, { i: 1, j: 3 }, { i: 3, j: 3 }, { i: 3, j: 5 }, { i: 5, j: 5 }, { i: 12, j: 1 }, { i: 12, j: 4 }],
  },
  {
    id: 'sotano', name: 'Sótano · Sala de juegos y servidores', emoji: '🎮',
    cols: 12, rows: 6, floorA: '#262b3a', floorB: '#2f3547', wall: '#6366f1',
    desks: [],
    furniture: [
      { i: 1, j: 1, kind: 'rug', w: 4, h: 3 },
      { i: 2, j: 2, kind: 'pingpong', w: 2 },
      { i: 0, j: 0, kind: 'arcade' }, { i: 1, j: 0, kind: 'arcade' }, { i: 5, j: 0, kind: 'vending' },
      { i: 7, j: 4, kind: 'beanbag' }, { i: 9, j: 4, kind: 'beanbag' }, { i: 8, j: 5, kind: 'beanbag' },
      { i: 9, j: 0, kind: 'server' }, { i: 10, j: 0, kind: 'server' }, { i: 11, j: 0, kind: 'server' }, { i: 11, j: 1, kind: 'server' },
      { i: 11, j: 5, kind: 'plant' },
    ],
    art: ['👾'],
    elevator: { i: 0, j: 3 },
    hangouts: [{ i: 2, j: 1 }, { i: 3, j: 3 }, { i: 8, j: 4 }, { i: 7, j: 5 }, { i: 1, j: 1 }, { i: 10, j: 2 }],
  },
];

/**
 * Niveles del edificio, de arriba abajo. Las salas de un mismo nivel quedan una
 * al lado de la otra (separadas por un vidrio), como un solo edificio grande.
 */
export const LEVELS: string[][] = [
  ['azotea'],
  ['penthouse', 'codigo'],
  ['datos', 'creatividad'],
  ['investigacion', 'negocios'],
  ['personas', 'impresion3d'],
  ['lobby'],
  ['sotano'],
];

/** Posición de cada sala dentro de su nivel (en píxeles, sin escalar). */
export function levelPlacement(ids: string[]) {
  const floors = ids.map((id) => floorById.get(id)!).filter(Boolean);
  // El vértice del fondo de cada sala sigue la línea de la pared del fondo de la anterior.
  let tx = 0, ty = 0;
  const placed = floors.map((f, k) => {
    if (k > 0) {
      const prev = floors[k - 1];
      tx += (prev.cols * TW) / 2;
      ty += (prev.cols * TH) / 2;
    }
    return { f, x: tx - (f.rows * TW) / 2, y: ty - WALL };
  });
  const minX = Math.min(...placed.map((p) => p.x)), minY = Math.min(...placed.map((p) => p.y));
  for (const p of placed) {
    p.x -= minX;
    p.y -= minY;
  }
  const width = Math.max(...placed.map((p) => p.x + roomSize(p.f).w));
  const height = Math.max(...placed.map((p) => p.y + roomSize(p.f).h));
  return { placed, width, height };
}

/** Asientos alrededor de la mesa de reuniones del lobby. */
export const MEETING_SEATS = [
  { i: 9, j: 1 }, { i: 10, j: 1 }, { i: 11, j: 2 }, { i: 11, j: 3 }, { i: 10, j: 4 }, { i: 9, j: 4 }, { i: 8, j: 3 },
];

export const floorById = new Map(FLOORS.map((f) => [f.id, f]));

/** Casillas ocupadas por muebles. */
export function blockedTiles(f: FloorDef) {
  const set = new Set<string>();
  for (const m of f.furniture) {
    if (m.kind === 'rug') continue; // las alfombras se pisan
    for (let a = 0; a < (m.w || 1); a++) for (let b = 0; b < Math.ceil(m.h || 1); b++) set.add(`${m.i + a},${m.j + b}`);
  }
  return set;
}

const BLOCKED = new Map(FLOORS.map((f) => [f.id, blockedTiles(f)]));

export function walkable(f: FloorDef, i: number, j: number) {
  return i >= 0 && j >= 0 && i < f.cols && j < f.rows && !BLOCKED.get(f.id)!.has(`${i},${j}`);
}

/** Siguiente paso (4 direcciones) hacia la meta, por búsqueda en anchura. */
export function nextStep(f: FloorDef, from: { i: number; j: number }, to: { i: number; j: number }) {
  if (from.i === to.i && from.j === to.j) return null;
  const key = (i: number, j: number) => `${i},${j}`;
  const prev = new Map<string, string | null>([[key(from.i, from.j), null]]);
  const queue = [from];
  while (queue.length) {
    const c = queue.shift()!;
    if (c.i === to.i && c.j === to.j) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { i: c.i + di, j: c.j + dj };
      const k = key(n.i, n.j);
      const isGoal = n.i === to.i && n.j === to.j;
      if (prev.has(k) || (!walkable(f, n.i, n.j) && !isGoal)) continue;
      if (n.i < 0 || n.j < 0 || n.i >= f.cols || n.j >= f.rows) continue;
      prev.set(k, key(c.i, c.j));
      queue.push(n);
    }
  }
  let k = key(to.i, to.j);
  if (!prev.has(k)) return null;
  const start = key(from.i, from.j);
  while (prev.get(k) !== start) {
    const p = prev.get(k);
    if (!p) return null;
    k = p;
  }
  const [i, j] = k.split(',').map(Number);
  return { i, j };
}

export function randomWalkable(f: FloorDef) {
  for (let t = 0; t < 50; t++) {
    const i = Math.floor(Math.random() * f.cols), j = Math.floor(Math.random() * f.rows);
    if (walkable(f, i, j)) return { i, j };
  }
  return f.elevator;
}

// Geometría isométrica.
export const TW = 56; // ancho de casilla
export const TH = 28; // alto de casilla
export const WALL = 86; // alto de pared

export function roomSize(f: FloorDef) {
  return { w: ((f.cols + f.rows) * TW) / 2, h: WALL + ((f.cols + f.rows) * TH) / 2 + 12 };
}

/** Centro en pantalla de la casilla (i, j). */
export function tileCenter(f: FloorDef, i: number, j: number) {
  const ox = (f.rows * TW) / 2;
  return { x: ox + ((i - j) * TW) / 2, y: WALL + ((i + j) * TH) / 2 + TH / 2 };
}


// Qué pasa cuando tu avatar usa un mueble.
export const USE: Partial<Record<Furniture['kind'], string>> = {
  pingpong: '🏓 ¡Punto!', beanbag: '😌 Relajado', coffee: '☕ ¡Café!', vending: '🥤 ¡Refresco!', arcade: '🕹️ ¡Nuevo récord!', piano: '🎹 ♪♫', pool: '🏊 ¡Al agua!', gym: '🏋️ ¡Fuerza!',
  printer: '🖨️ Imprimiendo capa por capa…', filament: '🧵 Cambiando el filamento', telescope: '🔭 ¡Se ve la luna!', aquarium: '🐠 ¡Hola, peces!', shelf: '📖 Leyendo…', grill: '🍖 ¡Asado!', table: '🍩 ¡Rico!', sofa: '🛋️ Descansando', easel: '🎨 Pintando', globe: '🌍 ¿A dónde viajo?', board: '📝 Anotando ideas', reception: '🛎️ ¡Ding!',
};

/** Casilla libre junto a un mueble (para usarlo). */
export function besideFurniture(f: FloorDef, m: Furniture) {
  const w = m.w || 1, h = Math.ceil(m.h || 1);
  const cands: [number, number][] = [];
  for (let a = -1; a <= w; a++) for (let b = -1; b <= h; b++) {
    const inside = a >= 0 && a < w && b >= 0 && b < h;
    if (!inside) cands.push([m.i + a, m.j + b]);
  }
  const ok = cands.filter(([a, b]) => walkable(f, a, b));
  return ok.length ? { i: ok[0][0], j: ok[0][1] } : null;
}
