// Estado compartido de la app: agentes, estados animados, tareas y eventos.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Agent, type AgentState, type Department, type OfficeEvent, type Provider, type Task } from './api';

export type Live = { status: AgentState; message: string; at: number };

type Ctx = {
  agents: Agent[];
  departments: Department[];
  providers: Provider[];
  vaultPath: string;
  live: Record<string, Live>;
  tasks: Task[];
  notesVersion: number;
  connected: boolean;
  reloadAgents: () => Promise<void>;
  reloadTasks: () => Promise<void>;
  toast: (msg: string) => void;
  toasts: { id: number; msg: string }[];
  openNote: (idOrTitle: { id?: string; title?: string }) => void;
  pendingNote: { id?: string; title?: string } | null;
  clearPendingNote: () => void;
  view: View;
  setView: (v: View) => void;
};

export type View = 'oficina' | 'tareas' | 'notas' | 'grafo' | 'agentes' | 'ajustes';

const OfficeCtx = createContext<Ctx | null>(null);

// Tras terminar, cada IA vuelve a su estado de reposo.
const SETTLE_MS: Partial<Record<AgentState, number>> = { done: 4500, error: 6000, talking: 5000 };

export function OfficeProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [vaultPath, setVaultPath] = useState('');
  const [live, setLive] = useState<Record<string, Live>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notesVersion, setNotesVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [pendingNote, setPendingNote] = useState<{ id?: string; title?: string } | null>(null);
  const [view, setViewState] = useState<View>(() => {
    try {
      return (localStorage.getItem('oficina.view') as View) || 'oficina';
    } catch {
      return 'oficina';
    }
  });
  const timers = useRef<Record<string, number>>({});

  const setView = useCallback((v: View) => {
    setViewState(v);
    try {
      localStorage.setItem('oficina.view', v);
    } catch {
      /* sin almacenamiento local: no pasa nada */
    }
  }, []);

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const reloadAgents = useCallback(async () => setAgents(await api.agents()), []);
  const reloadTasks = useCallback(async () => setTasks(await api.tasks()), []);

  useEffect(() => {
    api.meta().then((m) => {
      setDepartments(m.departments);
      setProviders(m.providers);
      setVaultPath(m.vaultPath);
    });
    reloadAgents();
    reloadTasks();
  }, [reloadAgents, reloadTasks]);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as OfficeEvent;
      if (e.type === 'agent') {
        setLive((l) => ({ ...l, [e.agentId]: { status: e.status, message: e.message, at: e.at } }));
        clearTimeout(timers.current[e.agentId]);
        const ms = SETTLE_MS[e.status];
        if (ms) {
          timers.current[e.agentId] = window.setTimeout(
            () => setLive((l) => ({ ...l, [e.agentId]: { ...l[e.agentId], status: 'idle' } })),
            ms,
          );
        }
        if (e.status === 'done') reloadAgents();
      } else if (e.type === 'task') {
        setTasks((ts) => {
          const i = ts.findIndex((t) => t.id === e.task.id);
          if (i === -1) return [e.task, ...ts];
          const copy = ts.slice();
          copy[i] = e.task;
          return copy;
        });
      } else if (e.type === 'notes') {
        setNotesVersion((v) => v + 1);
      }
    };
    return () => es.close();
  }, [reloadAgents]);

  const openNote = useCallback(
    (target: { id?: string; title?: string }) => {
      setPendingNote(target);
      setView('notas');
    },
    [setView],
  );

  const value = useMemo<Ctx>(
    () => ({
      agents, departments, providers, vaultPath, live, tasks, notesVersion, connected,
      reloadAgents, reloadTasks, toast, toasts, openNote, pendingNote,
      clearPendingNote: () => setPendingNote(null), view, setView,
    }),
    [agents, departments, providers, vaultPath, live, tasks, notesVersion, connected, reloadAgents, reloadTasks, toast, toasts, openNote, pendingNote, view, setView],
  );
  return <OfficeCtx.Provider value={value}>{children}</OfficeCtx.Provider>;
}

export function useOffice() {
  const c = useContext(OfficeCtx);
  if (!c) throw new Error('useOffice fuera de OfficeProvider');
  return c;
}
