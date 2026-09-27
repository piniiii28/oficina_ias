import { OfficeProvider, useOffice, type View } from './state';
import { Office } from './views/Office';
import { Notes } from './views/Notes';
import { Graph } from './views/Graph';
import { Tasks } from './views/Tasks';
import { Agents } from './views/Agents';
import { Settings } from './views/Settings';
import { Meetings } from './views/Meetings';
import { Palette } from './components/Palette';
import { Board } from './views/Board';
import { Welcome } from './components/Welcome';
import { useState } from 'react';
import { play, setSounds, soundsOn } from './sounds';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'oficina', label: 'Oficina', icon: '🏢' },
  { id: 'tablero', label: 'Tablero', icon: '📋' },
  { id: 'tareas', label: 'Tareas', icon: '🎯' },
  { id: 'reuniones', label: 'Reuniones', icon: '🗣️' },
  { id: 'notas', label: 'Notas', icon: '📝' },
  { id: 'grafo', label: 'Grafo', icon: '🕸️' },
  { id: 'agentes', label: 'Equipo', icon: '👥' },
  { id: 'ajustes', label: 'Ajustes', icon: '⚙️' },
];

function Shell() {
  const { view, setView, connected, toasts, tasks, agents } = useOffice();
  const running = tasks.filter((t) => t.status !== 'done' && t.status !== 'error').length;
  const [sound, setSound] = useState(soundsOn);
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
        <button className="nav-item search-hint" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}>
          <span>🔍</span><span className="nav-label">Buscar <kbd>Ctrl K</kbd></span>
        </button>
        <button className="nav-item search-hint" onClick={() => { setSounds(!sound); setSound(!sound); if (!sound) setTimeout(() => play('ding'), 50); }}>
          <span>{sound ? '🔊' : '🔈'}</span><span className="nav-label">{sound ? 'Sonido: sí' : 'Sonido: no'}</span>
        </button>
        <div className="sidebar-foot">
          <span className={`dot ${connected ? 'dot--live' : 'dot--off'}`} /> {connected ? 'En vivo' : 'Reconectando…'}
        </div>
      </nav>
      <main className={`content content--${view}`}>
        {view === 'oficina' && <Office />}
        {view === 'tablero' && <Board />}
        {view === 'tareas' && <Tasks />}
        {view === 'reuniones' && <Meetings />}
        {view === 'notas' && <Notes />}
        {view === 'grafo' && <Graph />}
        {view === 'agentes' && <Agents />}
        {view === 'ajustes' && <Settings />}
      </main>
      <Palette />
      <Welcome />
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
