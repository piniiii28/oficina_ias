// Cliente de la API del servidor de la oficina.

export type AvatarConfig = {
  skin: string;
  hair: string;
  hairStyle: string;
  eyes: string;
  outfit: string;
  accessory: string;
  prop: string;
  costume?: string;
};

export type Knowledge = { id: string; title: string; content: string; at: string; builtin?: boolean };
export type Memory = { text: string; at: string };

export type Agent = {
  id: string;
  name: string;
  role: string;
  department: string;
  provider: string;
  model: string;
  skills: string[];
  system: string;
  avatar: AvatarConfig;
  knowledge: Knowledge[];
  memory: Memory[];
  stats: { tasks: number; lastActive: string | null; likes?: number; dislikes?: number };
  enabled: boolean;
  isBrain?: boolean;
  isLibrarian?: boolean;
  live?: boolean;
  account?: string;
  paidBackup?: { provider: string; model: string };
};

export type Flow = { id: string; name: string; agentIds: string[] };
export type Department = { id: string; name: string; emoji: string; color: string };
export type Tier = 'gratis' | 'mixto' | 'suscripcion' | 'pago';
export type Provider = { id: string; label: string; keyUrl: string; keyless: boolean; cli?: boolean; tier: Tier; hint: string; npm: string | null };
export type FreeModel = { id: string; label: string; for: string };
export type CadTool = { id: string; label: string; url: string };
export type Account = { id: string; provider: string; label: string; preview?: string | null; home?: string };
export type Hub = { id: string; name: string; emoji: string; color: string };
export type HubInfo = Hub & {
  notes: number;
  types: Record<string, number>;
  tags: { tag: string; count: number }[];
  topics: { word: string; count: number }[];
  recent: { id: string; title: string; type: NoteType }[];
};
export type Bridge = { a: string; b: string; score: number; links: number; shared: string[] };
export type CadKind = 'blender' | 'openscad' | 'freecad';
export type CadJob = { id: string; kind: CadKind; name: string; dir: string; ok: boolean; log: string; files: { name: string; size: number }[]; opened: boolean; code: string; taskId: string | null; createdAt: string };

export type Step = {
  agentId: string;
  instruction: string;
  dependsOn?: string[];
  rating?: { value: number; comment: string; at: string };
  status: 'pending' | 'working' | 'done' | 'error';
  output: string;
  simulated: boolean;
  error: string | null;
};

export type Task = {
  id: string;
  prompt: string;
  title: string;
  status: 'planning' | 'working' | 'synthesizing' | 'reviewing' | 'done' | 'error';
  plan: { analysis: string } | null;
  steps: Step[];
  final: string;
  noteId: string | null;
  parentId?: string | null;
  contextNotes?: string[];
  attachments?: { name: string; size: number }[];
  createdAt: string;
  finishedAt: string | null;
};

export type NoteType = 'nota' | 'idea' | 'tarea' | 'aporte' | 'diario';

export type NoteSummary = {
  id: string;
  title: string;
  type: NoteType;
  tags: string[];
  pinned: boolean;
  excerpt: string;
  source: { taskId?: string; agentId?: string } | null;
  hub?: string;
  createdAt: string;
  updatedAt: string;
};

export type Note = Omit<NoteSummary, 'excerpt'> & {
  content: string;
  backlinks: { id: string; title: string; type: NoteType }[];
};

export type GraphNode = {
  id: string;
  label: string;
  kind: 'note' | 'ghost' | 'tag' | 'agent' | 'hub';
  type?: NoteType;
  hub?: string;
  color?: string;
  emoji?: string;
  agentId?: string;
  createdAt?: string;
};
export type GraphLink = { source: string; target: string; kind: 'link' | 'tag' | 'author' | 'hub' };

export type Suggestion = { from: string; to: string; fromTitle: string; toTitle: string; reason: string; score: number };

export type Card = { id: string; title: string; details: string; column: 'todo' | 'doing' | 'done'; project: string; taskId: string | null; noteId: string | null; createdAt: string };

export type ChatMessage = { role: 'user' | 'assistant'; content: string; at: string; simulated?: boolean };

export type Settings = {
  demoMode: 'auto' | 'always';
  reviewFinal?: boolean;
  maxTeam?: number;
  webSearch?: boolean;
  autoCards?: boolean;
  maxParallel: number;
  keys: Record<string, { configured: boolean; preview: string | null }>;
  ollamaEnabled: boolean;
  ollamaUrl: string;
  cli: Record<string, { enabled: boolean; command: string; defaultCommand: string }>;
  accounts: Account[];
  hubs: Hub[];
  cadPaths: Record<string, string>;
};

export type Meeting = {
  id: string;
  topic: string;
  agentIds: string[];
  rounds: number;
  status: 'running' | 'done' | 'error';
  speaking: string | null;
  transcript: { agentId: string; name: string; text: string; round: number; simulated: boolean; at: string }[];
  summary: string;
  noteId: string | null;
  createdAt: string;
};

export type OfficeEvent =
  | { type: 'agent'; agentId: string; status: AgentState; message: string; at: number }
  | { type: 'meeting'; meeting: Meeting }
  | { type: 'delta'; key: string; text: string | null }
  | { type: 'cards' }
  | { type: 'cad' }
  | { type: 'task'; task: Task }
  | { type: 'notes' };

export type AgentState = 'idle' | 'thinking' | 'working' | 'talking' | 'done' | 'error';

// Núcleo activo (quién usa la oficina): se envía en cada petición.
let activeHub = '';
export function setActiveHub(id: string) {
  activeHub = id;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (activeHub) headers['X-Nucleo'] = activeHub;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

export const api = {
  meta: () => req<{ departments: Department[]; providers: Provider[]; vaultPath: string; flows: Flow[]; freeModels: Record<string, FreeModel[]>; cadTools: CadTool[] }>('GET', '/api/meta'),

  agents: () => req<Agent[]>('GET', '/api/agents'),
  createAgent: (a: Partial<Agent>) => req<Agent>('POST', '/api/agents', a),
  updateAgent: (id: string, a: Partial<Agent>) => req<Agent>('PUT', `/api/agents/${id}`, a),
  deleteAgent: (id: string) => req('DELETE', `/api/agents/${id}`),
  resetAgents: () => req<Agent[]>('POST', '/api/agents/reset'),
  addKnowledge: (id: string, k: { title: string; content: string }) => req<Knowledge>('POST', `/api/agents/${id}/knowledge`, k),
  deleteKnowledge: (id: string, kid: string) => req('DELETE', `/api/agents/${id}/knowledge/${kid}`),
  clearMemory: (id: string) => req('DELETE', `/api/agents/${id}/memory`),
  selfTrain: (id: string) => req<Knowledge>('POST', `/api/agents/${id}/self-train`),

  chat: (id: string) => req<ChatMessage[]>('GET', `/api/agents/${id}/chat`),
  sendChat: (id: string, message: string) =>
    req<{ reply: string; simulated: boolean; history: ChatMessage[] }>('POST', `/api/agents/${id}/chat`, { message }),
  clearChat: (id: string) => req('DELETE', `/api/agents/${id}/chat`),

  tasks: () => req<Task[]>('GET', '/api/tasks'),
  runTask: (prompt: string, agentIds?: string[], parentId?: string, attachments?: { name: string; content: string }[], flow?: string, effort?: string, fromNote?: string) =>
    req<{ id: string }>('POST', '/api/tasks', { prompt, agentIds, parentId, attachments, flow, effort, fromNote }),
  deleteTask: (id: string) => req('DELETE', `/api/tasks/${id}`),
  cancelTask: (id: string) => req('POST', `/api/tasks/${id}/cancel`),
  rateStep: (id: string, agentId: string, value: number, comment = '') => req('POST', `/api/tasks/${id}/steps/${agentId}/rate`, { value, comment }),

  meetings: () => req<Meeting[]>('GET', '/api/meetings'),
  startMeeting: (topic: string, agentIds: string[], rounds: number) => req<{ id: string }>('POST', '/api/meetings', { topic, agentIds, rounds }),
  deleteMeeting: (id: string) => req('DELETE', `/api/meetings/${id}`),

  cards: () => req<Card[]>('GET', '/api/cards'),
  createCard: (c: Partial<Card>) => req<Card>('POST', '/api/cards', c),
  updateCard: (id: string, c: Partial<Card>) => req<Card>('PUT', `/api/cards/${id}`, c),
  runCard: (id: string) => req<Card>('POST', `/api/cards/${id}/run`),
  deleteCard: (id: string) => req('DELETE', `/api/cards/${id}`),

  notes: (q = '') => req<NoteSummary[]>('GET', `/api/notes?q=${encodeURIComponent(q)}`),
  note: (id: string) => req<Note>('GET', `/api/notes/${id}`),
  createNote: (n: Partial<Note>) => req<Note>('POST', '/api/notes', n),
  resolveNote: (title: string) => req<Note>('POST', '/api/notes/resolve', { title }),
  updateNote: (id: string, n: Partial<Note>) => req<Note>('PUT', `/api/notes/${id}`, n),
  deleteNote: (id: string) => req('DELETE', `/api/notes/${id}`),
  mentions: (id: string) => req<{ id: string; title: string; snippet: string }[]>('GET', `/api/notes/${id}/mentions`),
  linkMention: (id: string, fromId: string) => req('POST', `/api/notes/${id}/mentions/${fromId}/link`),
  dailySummary: () => req<Note>('POST', '/api/notes/daily'),
  importNotes: (files: { name: string; content: string }[]) => req<{ created: number; updated: number }>('POST', '/api/notes/import', { files }),
  graph: (opts: { tags: boolean; agents: boolean; hubs?: boolean }) =>
    req<{ nodes: GraphNode[]; links: GraphLink[] }>('GET', `/api/graph?tags=${opts.tags ? 1 : 0}&agents=${opts.agents ? 1 : 0}&hubs=${opts.hubs === false ? 0 : 1}`),

  suggestLinks: () => req<{ suggestions: Suggestion[]; by: string; simulated: boolean }>('POST', '/api/graph/suggest'),
  connect: (connections: Suggestion[]) => req<{ applied: number }>('POST', '/api/graph/connect', { connections }),

  testProvider: (id: string) => req<{ ok: boolean; model: string; ms: number; reply: string }>('POST', `/api/providers/${id}/test`, {}),
  usage: () => req<Record<string, { calls: number; inChars: number; outChars: number }>>('GET', '/api/usage'),
  resetUsage: () => req('DELETE', '/api/usage'),
  detectClis: () => req<Record<string, string | null>>('GET', '/api/cli/detect'),
  settings: () => req<Settings>('GET', '/api/settings'),
  saveSettings: (s: Record<string, unknown>) => req<Settings>('PUT', '/api/settings', s),
  importBackup: (data: unknown) => req('POST', '/api/import', data),

  addAccount: (a: { provider: string; label: string; key?: string }) => req<Settings>('POST', '/api/accounts', a),
  deleteAccount: (id: string) => req<Settings>('DELETE', `/api/accounts/${id}`),
  cliLogin: (provider: string, account?: string) => req<{ opened: boolean; command: string }>('POST', `/api/cli/${provider}/login`, { account }),
  cliInstall: (provider: string) => req<{ ok: boolean; path: string | null; log: string }>('POST', `/api/cli/${provider}/install`),
  ollamaModels: () => req<{ running: boolean; models: { name: string; size: number }[] }>('GET', '/api/ollama/models'),
  ollamaPull: (model: string) => req<{ ok: boolean; log: string }>('POST', '/api/ollama/pull', { model }),
  freeMode: () => req<{ changed: number; changes: { id: string; from: { provider: string; model: string }; to: { provider: string; model: string } }[] }>('POST', '/api/agents/free-mode'),
  undoFreeMode: () => req<{ restored: number }>('POST', '/api/agents/free-mode/undo'),

  assistant: () => req<ChatMessage[]>('GET', '/api/assistant'),
  askAssistant: (message: string) => req<{ reply: string; simulated: boolean; history: ChatMessage[] }>('POST', '/api/assistant', { message }),
  clearAssistant: () => req('DELETE', '/api/assistant'),

  hubs: () => req<{ hubs: HubInfo[]; bridges: Bridge[] }>('GET', '/api/hubs'),
  askHub: (id: string, question: string, save = false) => req<{ answer: string; simulated: boolean; sources: { id: string; title: string }[]; noteId?: string }>('POST', `/api/hubs/${id}/ask`, { question, save }),
  hubProfile: (id: string) => req<Note>('POST', `/api/hubs/${id}/profile`),
  hubSuggest: () => req<{ suggestions: Suggestion[] }>('GET', '/api/hubs/suggest'),

  cadDetect: () => req<Record<string, string | null>>('GET', '/api/cad/detect'),
  cadJobs: () => req<CadJob[]>('GET', '/api/cad/jobs'),
  cadRun: (b: { kind: CadKind; code: string; name?: string; gui?: boolean; taskId?: string }) => req<CadJob>('POST', '/api/cad/run', b),
  cadOpen: (id: string, what: 'app' | 'folder') => req('POST', `/api/cad/jobs/${id}/open`, { what }),
  cadSlice: (id: string) => req<{ ok: boolean; log: string }>('POST', `/api/cad/jobs/${id}/slice`),
  cadDelete: (id: string) => req('DELETE', `/api/cad/jobs/${id}`),
};

/** Etiqueta corta del costo de un proveedor. */
export const TIER_LABEL: Record<Tier, string> = { gratis: 'Gratis', mixto: 'Tiene gratis', suscripcion: 'Tu suscripción', pago: 'De pago' };

/** ¿Qué programa ejecuta este bloque de código? (igual que en el servidor) */
export function cadKind(lang: string, code: string): CadKind | null {
  const l = lang.toLowerCase();
  if (l === 'openscad' || l === 'scad') return 'openscad';
  if (/^\s*(import bpy|from bpy)/m.test(code)) return 'blender';
  if (/^\s*(import FreeCAD|from FreeCAD|import Part\b|import FreeCADGui)/m.test(code)) return 'freecad';
  if (!l && /\b(cube|cylinder|sphere)\s*\(/.test(code) && /;\s*$/m.test(code)) return 'openscad';
  return null;
}

/** Nivel de experiencia según trabajos completados (1, 4, 9, 16… para subir). */
export function levelOf(a: { stats?: { tasks: number } }) {
  return Math.floor(Math.sqrt(a.stats?.tasks || 0)) + 1;
}
