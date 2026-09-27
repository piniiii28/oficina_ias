import { OfficeProvider, useOffice, type View } from './state';
import { Office } from './views/Office';
import { Notes } from './views/Notes';
import { Graph } from './views/Graph';
import { Tasks } from './views/Tasks';
import { Agents } from './views/Agents';
import { Settings } from './views/Settings';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'oficina', label: 'Oficina', icon: '🏢' },
  { id: 'tareas', label: 'Tareas', icon: '🎯' },
  { id: 'notas', label: 'Notas', icon: '📝' },
  { id: 'grafo', label: 'Grafo', icon: '🕸️' },
  { id: 'agentes', label: 'Equipo', icon: '👥' },
  { id: 'ajustes', label: 'Ajustes', icon: '⚙️' },
];

function Shell() {
  const { view, setView, connected, toasts, tasks, agents } = useOffice();
  const running = tasks.filter((t) => t.status !== 'done' && t.status !== 'error').length;
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-logo">🧠</span>
          <div>
            <strong>Oficina de IAs</strong>
            <small>{agents.length} IAs · cerebro Claude</small>
          </div>
        </div>
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}>
            <span>{n.icon}</span>
            <span className="nav-label">{n.label}</span>
            {n.id === 'tareas' && running > 0 && <span className="badge">{running}</span>}
          </button>
        ))}
        <div className="sidebar-foot">
          <span className={`dot ${connected ? 'dot--live' : 'dot--off'}`} /> {connected ? 'En vivo' : 'Reconectando…'}
        </div>
      </nav>
      <main className={`content content--${view}`}>
        {view === 'oficina' && <Office />}
        {view === 'tareas' && <Tasks />}
        {view === 'notas' && <Notes />}
        {view === 'grafo' && <Graph />}
        {view === 'agentes' && <Agents />}
        {view === 'ajustes' && <Settings />}
      </main>
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <OfficeProvider>
      <Shell />
    </OfficeProvider>
  );
}
