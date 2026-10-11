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
import { Taller } from './views/Taller';
import { AccessRequests } from './components/AccessRequests';
import { Login } from './components/Login';
import { Automations } from './views/Automations';
import { Jury } from './views/Jury';
import { api, onLoginNeeded, type User } from './api';
import { Welcome } from './components/Welcome';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AchievementWatcher } from './components/Achievements';
import React, { useEffect, useState } from 'react';
import { play, setSounds, soundsOn } from './sounds';

// El menú, por grupos (en el celular es la barra de abajo, sin títulos).
const NAV: { id: View; label: string; icon: string; group: string }[] = [
  { id: 'oficina', label: 'Oficina', icon: '🏢', group: 'Trabajo' },
  { id: 'tablero', label: 'Tablero', icon: '📋', group: 'Trabajo' },
  { id: 'tareas', label: 'Tareas', icon: '🎯', group: 'Trabajo' },
  { id: 'reuniones', label: 'Reuniones', icon: '🗣️', group: 'Trabajo' },
  { id: 'notas', label: 'Notas', icon: '📝', group: 'Conocimiento' },
  { id: 'grafo', label: 'Grafo', icon: '🕸️', group: 'Conocimiento' },
  { id: 'taller', label: 'Taller 3D', icon: '🖨️', group: 'Herramientas' },
  { id: 'automatizar', label: 'Automatizar', icon: '⚡', group: 'Herramientas' },
  { id: 'jurado', label: 'Jurado', icon: '⚖️', group: 'Herramientas' },
  { id: 'agentes', label: 'Equipo', icon: '👥', group: 'Equipo' },
  { id: 'ajustes', label: 'Ajustes', icon: '⚙️', group: 'Equipo' },
];

function Shell({ user }: { user: (User & { local?: boolean }) | null }) {
  const { view, setView, connected, toasts, tasks, agents, hubs, hub, setHub } = useOffice();
  const me = hubs.find((h) => h.id === hub);
  const running = tasks.filter((t) => !['done', 'error', 'waiting'].includes(t.status)).length;
  const waiting = tasks.filter((t) => t.status === 'waiting').length;
  const [sound, setSound] = useState(soundsOn);
  const [theme, setThemeState] = useState<string>(() => {
    try {
      return localStorage.getItem('oficina.tema') || 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('oficina.tema', theme);
    } catch {
      /* sin almacenamiento local */
    }
  }, [theme]);
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-logo">🧠</span>
          <div>
            <strong>Oficina de IAs</strong>
            <small>{agents.length} IAs · {agents.filter((a) => a.live).length} conectadas</small>
          </div>
        </div>
        {hubs.length > 0 && (
          <label className="hub-picker" title="¿Quién usa la oficina en este computador? Tus notas y tareas quedan en tu núcleo del grafo.">
            <span className="hub-dot" style={{ background: me?.color }}>{me?.emoji || '🧠'}</span>
            <select value={hub} onChange={(e) => setHub(e.target.value)} aria-label="Núcleo activo">
              {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
        )}
        {NAV.map((n, i) => (
          <React.Fragment key={n.id}>
            {n.group !== NAV[i - 1]?.group && <div className="nav-group">{n.group}</div>}
            <button className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}>
              <span>{n.icon}</span>
              <span className="nav-label">{n.label}</span>
              {n.id === 'tareas' && running > 0 && <span className="badge" title="Tareas en curso">{running}</span>}
              {n.id === 'tareas' && waiting > 0 && <span className="badge badge--wait" title="En espera de cupo: se retoman solas">⏳{waiting}</span>}
            </button>
          </React.Fragment>
        ))}
        <button className="nav-item search-hint" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}>
          <span>🔍</span><span className="nav-label">Buscar <kbd>Ctrl K</kbd></span>
        </button>
        <button className="nav-item search-hint" onClick={() => { setSounds(!sound); setSound(!sound); if (!sound) setTimeout(() => play('ding'), 50); }}>
          <span>{sound ? '🔊' : '🔈'}</span><span className="nav-label">{sound ? 'Sonido: sí' : 'Sonido: no'}</span>
        </button>
        <button className="nav-item search-hint" onClick={() => setThemeState(theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto')} title="Cambiar tema">
          <span>{theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🌓'}</span><span className="nav-label">Tema: {theme === 'dark' ? 'oscuro' : theme === 'light' ? 'claro' : 'auto'}</span>
        </button>
        {user && !user.local && (
          <button className="nav-item search-hint" onClick={async () => { await api.logout(); location.reload(); }} title="Cerrar sesión">
            <span>🚪</span><span className="nav-label">{user.name} · Salir</span>
          </button>
        )}
        <div className="sidebar-foot">
          <span className={`dot ${connected ? 'dot--live' : 'dot--off'}`} /> {connected ? 'En vivo' : 'Reconectando…'}
        </div>
      </nav>
      <main className={`content content--${view}`}>
        <ErrorBoundary resetKey={view}>
        {view === 'oficina' && <Office />}
        {view === 'tablero' && <Board />}
        {view === 'tareas' && <Tasks />}
        {view === 'reuniones' && <Meetings />}
        {view === 'notas' && <Notes />}
        {view === 'grafo' && <Graph />}
        {view === 'taller' && <Taller />}
        {view === 'automatizar' && <Automations />}
        {view === 'jurado' && <Jury />}
        {view === 'agentes' && <Agents />}
        {view === 'ajustes' && <Settings />}
        </ErrorBoundary>
      </main>
      <Palette />
      <Welcome />
      <AchievementWatcher />
      <AccessRequests />
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </div>
  );
}

export default function App() {
  // Desde otro computador (Tailscale) primero hay que iniciar sesión.
  const [auth, setAuth] = useState<{ user: (User & { local?: boolean }) | null; needsLogin: boolean } | null>(null);
  const check = () => api.me().then(setAuth).catch(() => setAuth({ user: null, needsLogin: false }));
  useEffect(() => {
    check();
    const on = () => setAuth({ user: null, needsLogin: true });
    onLoginNeeded.addEventListener('login', on);
    return () => onLoginNeeded.removeEventListener('login', on);
  }, []);
  if (!auth) return <div className="empty">Cargando…</div>;
  if (auth.needsLogin) return <Login onDone={() => location.reload()} />;
  return (
    <OfficeProvider>
      <Shell user={auth.user} />
    </OfficeProvider>
  );
}
