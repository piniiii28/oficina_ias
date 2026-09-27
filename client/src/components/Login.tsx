// Pantalla de inicio de sesión (solo aparece al entrar desde otro computador).
import { useState } from 'react';
import { api } from '../api';

export function Login({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(name, password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🧠</div>
        <h1>Oficina de IAs</h1>
        <p className="muted">Estás entrando desde otro computador. Inicia sesión con el usuario que te dio el administrador.</p>
        <label>Usuario<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoFocus /></label>
        <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="danger small">{error}</p>}
        <button className="btn btn--primary" disabled={busy || !name || !password}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
