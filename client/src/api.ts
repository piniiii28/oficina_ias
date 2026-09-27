// Cliente de la API del servidor de la oficina.

export type AvatarConfig = {
  skin: string;
  hair: string;
  hairStyle: string;
  eyes: string;
  outfit: string;
  accessory: string;
  prop: string;
};

export type Knowledge = { id: string; title: string; content: string; at: string };
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
  stats: { tasks: number; lastActive: string | null };
  enabled: boolean;
  isBrain?: boolean;
  isLibrarian?: boolean;
  live?: boolean;
};

export type Department = { id: string; name: string; emoji: string; color: string };
export type Provider = { id: string; label: string; keyUrl: string; keyless: boolean };

export type Step = {
  agentId: string;
  instruction: string;
  dependsOn?: string[];
  status: 'pending' | 'working' | 'done' | 'error';
  output: string;
  simulated: boolean;
  error: string | null;
};

export type Task = {
  id: string;
  prompt: string;
  title: string;
  status: 'planning' | 'working' | 'synthesizing' | 'done' | 'error';
  plan: { analysis: string } | null;
  steps: Step[];
  final: string;
  noteId: string | null;
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
  kind: 'note' | 'ghost' | 'tag' | 'agent';
  type?: NoteType;
  agentId?: string;
};
export type GraphLink = { source: string; target: string; kind: 'link' | 'tag' | 'author' };

export type ChatMessage = { role: 'user' | 'assistant'; content: string; at: string; simulated?: boolean };

export type Settings = {
  demoMode: 'auto' | 'always';
  maxParallel: number;
  keys: Record<string, { configured: boolean; preview: string | null }>;
  ollamaEnabled: boolean;
  ollamaUrl: string;
};

export type OfficeEvent =
  | { type: 'agent'; agentId: string; status: AgentState; message: string; at: number }
  | { type: 'task'; task: Task }
  | { type: 'notes' };

export type AgentState = 'idle' | 'thinking' | 'working' | 'talking' | 'done' | 'error';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

export const api = {
  meta: () => req<{ departments: Department[]; providers: Provider[] }>('GET', '/api/meta'),

  agents: () => req<Agent[]>('GET', '/api/agents'),
  createAgent: (a: Partial<Agent>) => req<Agent>('POST', '/api/agents', a),
  updateAgent: (id: string, a: Partial<Agent>) => req<Agent>('PUT', `/api/agents/${id}`, a),
  deleteAgent: (id: string) => req('DELETE', `/api/agents/${id}`),
  resetAgents: () => req<Agent[]>('POST', '/api/agents/reset'),
  addKnowledge: (id: string, k: { title: string; content: string }) => req<Knowledge>('POST', `/api/agents/${id}/knowledge`, k),
  deleteKnowledge: (id: string, kid: string) => req('DELETE', `/api/agents/${id}/knowledge/${kid}`),
  clearMemory: (id: string) => req('DELETE', `/api/agents/${id}/memory`),

  chat: (id: string) => req<ChatMessage[]>('GET', `/api/agents/${id}/chat`),
  sendChat: (id: string, message: string) =>
    req<{ reply: string; simulated: boolean; history: ChatMessage[] }>('POST', `/api/agents/${id}/chat`, { message }),
  clearChat: (id: string) => req('DELETE', `/api/agents/${id}/chat`),

  tasks: () => req<Task[]>('GET', '/api/tasks'),
  runTask: (prompt: string, agentIds?: string[]) => req<{ id: string }>('POST', '/api/tasks', { prompt, agentIds }),
  deleteTask: (id: string) => req('DELETE', `/api/tasks/${id}`),

  notes: (q = '') => req<NoteSummary[]>('GET', `/api/notes?q=${encodeURIComponent(q)}`),
  note: (id: string) => req<Note>('GET', `/api/notes/${id}`),
  createNote: (n: Partial<Note>) => req<Note>('POST', '/api/notes', n),
  resolveNote: (title: string) => req<Note>('POST', '/api/notes/resolve', { title }),
  updateNote: (id: string, n: Partial<Note>) => req<Note>('PUT', `/api/notes/${id}`, n),
  deleteNote: (id: string) => req('DELETE', `/api/notes/${id}`),
  graph: (opts: { tags: boolean; agents: boolean }) =>
    req<{ nodes: GraphNode[]; links: GraphLink[] }>('GET', `/api/graph?tags=${opts.tags ? 1 : 0}&agents=${opts.agents ? 1 : 0}`),

  settings: () => req<Settings>('GET', '/api/settings'),
  saveSettings: (s: Record<string, unknown>) => req<Settings>('PUT', '/api/settings', s),
  importBackup: (data: unknown) => req('POST', '/api/import', data),
};
