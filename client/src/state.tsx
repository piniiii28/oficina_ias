// Estado compartido de la app: agentes, estados animados, tareas y eventos.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { play } from './sounds';
import { api, setActiveHub, type Agent, type AgentState, type CadTool, type Department, type FreeModel, type Flow, type Hub, type Meeting, type OfficeEvent, type Provider, type Task, type AccessRequest, type Meter, type PrinterInfo } from './api';

export type Live = { status: AgentState; message: string; at: number };

type Ctx = {
  agents: Agent[];
  departments: Department[];
  providers: Provider[];
  vaultPath: string;
  flows: Flow[];
  freeModels: Record<string, FreeModel[]>;
  cadTools: CadTool[];
  suggestedAssistants: Record<string, string[]>;
  hubs: Hub[];
  reloadHubs: () => Promise<void>;
  hub: string;
  setHub: (id: string) => void;
  cadVersion: number;
  accessRequests: AccessRequest[];
  blenderVersion: number;
  metrics: Record<string, Meter>;
  printer: PrinterInfo | null;
  live: Record<string, Live>;
  tasks: Task[];
  meetings: Meeting[];
  streams: Record<string, string>;
  feed: { at: number; agentId: string; status: AgentState; message: string }[];
  setMeetings: (m: Meeting[]) => void;
  notesVersion: number;
  cardsVersion: number;
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

export type View = 'oficina' | 'tablero' | 'tareas' | 'reuniones' | 'notas' | 'grafo' | 'taller' | 'automatizar' | 'jurado' | 'agentes' | 'ajustes';

const OfficeCtx = createContext<Ctx | null>(null);

// Tras terminar, cada IA vuelve a su estado de reposo.
const SETTLE_MS: Partial<Record<AgentState, number>> = { done: 4500, error: 6000, talking: 5000 };

export function OfficeProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [vaultPath, setVaultPath] = useState('');
  const [flows, setFlows] = useState<Flow[]>([]);
  const [freeModels, setFreeModels] = useState<Record<string, FreeModel[]>>({});
  const [cadTools, setCadTools] = useState<CadTool[]>([]);
  const [suggestedAssistants, setSuggestedAssistants] = useState<Record<string, string[]>>({});
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [cadVersion, setCadVersion] = useState(0);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [blenderVersion, setBlenderVersion] = useState(0);
  const [metrics, setMetrics] = useState<Record<string, Meter>>({});
  const [printer, setPrinter] = useState<PrinterInfo | null>(null);
  useEffect(() => {
    api.printer().then(setPrinter).catch(() => {});
  }, []);
  // Medidores de acierto y carga: se refrescan cada 10 s mientras la pestaña está visible.
  useEffect(() => {
    const load = () => !document.hidden && api.metrics().then(setMetrics).catch(() => {});
    load();
    const id = window.setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);
  // Quién usa la oficina en este computador (su núcleo del grafo).
  const [hub, setHubState] = useState<string>(() => {
    let h = 'cerebro';
    try {
      h = localStorage.getItem('oficina.nucleo') || 'cerebro';
    } catch {
      /* sin almacenamiento local */
    }
    setActiveHub(h);
    return h;
  });
  const setHub = useCallback((id: string) => {
    setActiveHub(id);
    setHubState(id);
    try {
      localStorage.setItem('oficina.nucleo', id);
    } catch {
      /* sin almacenamiento local */
    }
  }, []);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [feed, setFeed] = useState<Ctx['feed']>([]);
  const [notesVersion, setNotesVersion] = useState(0);
  const [cardsVersion, setCardsVersion] = useState(0);
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
  const reloadHubs = useCallback(async () => setHubs((await api.settings()).hubs || []), []);

  useEffect(() => {
    api.meta().then((m) => {
      setDepartments(m.departments);
      setProviders(m.providers);
      setVaultPath(m.vaultPath);
      setFlows(m.flows || []);
      setFreeModels(m.freeModels || {});
      setCadTools(m.cadTools || []);
      setSuggestedAssistants(m.suggestedAssistants || {});
    });
    reloadHubs();
    api.access().then((a) => setAccessRequests(a.requests)).catch(() => {});
    reloadAgents();
    reloadTasks();
    api.meetings().then(setMeetings);
  }, [reloadAgents, reloadTasks, reloadHubs]);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as OfficeEvent;
      if (e.type === 'agent') {
        if (e.status !== 'idle') setFeed((f) => [{ at: e.at, agentId: e.agentId, status: e.status, message: e.message }, ...f].slice(0, 80));
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
        if (e.status === 'done') play('pop');
        if (e.status === 'error') play('error');
      } else if (e.type === 'task') {
        if (e.task.status === 'done') play('ding');
        setTasks((ts) => {
          const i = ts.findIndex((t) => t.id === e.task.id);
          if (i === -1) return [e.task, ...ts];
          const copy = ts.slice();
          copy[i] = e.task;
          return copy;
        });
      } else if (e.type === 'delta') {
        setStreams((st) => {
          const copy = { ...st };
          if (e.text === null) delete copy[e.key];
          else copy[e.key] = e.text;
          return copy;
        });
      } else if (e.type === 'meeting') {
        setMeetings((ms) => {
          const i = ms.findIndex((m) => m.id === e.meeting.id);
          if (i === -1) return [e.meeting, ...ms];
          const copy = ms.slice();
          copy[i] = e.meeting;
          return copy;
        });
      } else if (e.type === 'access') {
        if (e.requests.length) play('ding');
        setAccessRequests(e.requests);
      } else if (e.type === 'printer') {
        const { type: _t, ...info } = e;
        setPrinter(info);
      } else if (e.type === 'blender') {
        setBlenderVersion((v) => v + 1);
      } else if (e.type === 'cad') {
        setCadVersion((v) => v + 1);
      } else if (e.type === 'cards') {
        setCardsVersion((v) => v + 1);
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
      agents, departments, providers, vaultPath, flows, freeModels, cadTools, suggestedAssistants, hubs, reloadHubs, hub, setHub, cadVersion, accessRequests, blenderVersion, metrics, printer, live, tasks, meetings, setMeetings, streams, feed, notesVersion, cardsVersion, connected,
      reloadAgents, reloadTasks, toast, toasts, openNote, pendingNote,
      clearPendingNote: () => setPendingNote(null), view, setView,
    }),
    [agents, departments, providers, vaultPath, flows, freeModels, cadTools, suggestedAssistants, hubs, reloadHubs, hub, setHub, cadVersion, accessRequests, blenderVersion, metrics, printer, live, tasks, meetings, streams, feed, notesVersion, cardsVersion, connected, reloadAgents, reloadTasks, toast, toasts, openNote, pendingNote, view, setView],
  );
  return <OfficeCtx.Provider value={value}>{children}</OfficeCtx.Provider>;
}

export function useOffice() {
  const c = useContext(OfficeCtx);
  if (!c) throw new Error('useOffice fuera de OfficeProvider');
  return c;
}
