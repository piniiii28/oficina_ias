// Ajustes: claves de API, modelo del cerebro, modo demo y respaldo.
import { useEffect, useState } from 'react';
import { api, type Settings as S } from '../api';
import { useOffice } from '../state';

export function Settings() {
  const { providers, agents, reloadAgents, toast } = useOffice();
  const [s, setS] = useState<S | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    api.settings().then(setS);
  }, []);
  if (!s) return <div className="empty">Cargando…</div>;

  const usage = (p: string) => agents.filter((a) => a.provider === p).map((a) => a.name);

  async function save(patch: Record<string, unknown>, msg = '✅ Ajustes guardados') {
    setS(await api.saveSettings(patch));
    await reloadAgents();
    toast(msg);
  }

  async function importFile(f: File) {
    try {
      await api.importBackup(JSON.parse(await f.text()));
      toast('📦 Respaldo restaurado');
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      toast(`No se pudo importar: ${(err as Error).message}`);
    }
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>🔑 Conectar las IAs</h2>
        <p className="muted">
          Las claves se guardan solo en tu computador (<code>data/oficina.json</code>) y nunca se muestran completas. Si una IA no tiene clave, responde en modo demo.
          Consejo: con una sola clave de <b>OpenRouter</b> se conectan varias IAs de la oficina a la vez.
        </p>
        <div className="keys">
          {providers.filter((p) => !p.keyless).map((p) => {
            const k = s.keys[p.id];
            const who = usage(p.id);
            return (
              <div key={p.id} className="key-row">
                <div>
                  <strong>{p.label}</strong> {k?.configured ? <span className="pill pill--done">conectado {k.preview && `· ${k.preview}`}</span> : <span className="pill">sin clave</span>}
                  <div className="small muted">{who.length ? `Usan esta clave: ${who.join(', ')}` : 'Ninguna IA la usa todavía'} · <a href={p.keyUrl} target="_blank" rel="noreferrer">obtener clave ↗</a></div>
                </div>
                <div className="row">
                  <input type="password" placeholder="Pega tu clave…" value={keys[p.id] || ''} onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })} />
                  <button className="btn btn--primary small" disabled={!keys[p.id]} onClick={async () => { await save({ apiKeys: { [p.id]: keys[p.id] } }, `🔌 ${p.label} conectado`); setKeys({ ...keys, [p.id]: '' }); }}>Guardar</button>
                  {k?.preview && <button className="btn btn--ghost small" onClick={() => save({ apiKeys: { [p.id]: null } }, 'Clave eliminada')}>Quitar</button>}
                </div>
              </div>
            );
          })}
          <div className="key-row">
            <div>
              <strong>Ollama (modelos locales gratis)</strong> {s.ollamaEnabled ? <span className="pill pill--done">activado</span> : <span className="pill">apagado</span>}
              <div className="small muted">Instala Ollama y descarga modelos (p. ej. <code>ollama pull gemma3</code>). Usan Ollama: {usage('ollama').join(', ') || 'nadie'}</div>
            </div>
            <div className="row">
              <input placeholder="http://localhost:11434/v1" defaultValue={s.ollamaUrl} onBlur={(e) => e.target.value !== s.ollamaUrl && save({ ollamaUrl: e.target.value })} />
              <label className="check"><input type="checkbox" checked={s.ollamaEnabled} onChange={(e) => save({ ollamaEnabled: e.target.checked })} /> Activar</label>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>⚙️ Comportamiento</h2>
        <div className="grid2">
          <label>Modo demo
            <select value={s.demoMode} onChange={(e) => save({ demoMode: e.target.value })}>
              <option value="auto">Automático: simula solo las IAs sin clave</option>
              <option value="always">Siempre simular (no gasta créditos)</option>
            </select>
          </label>
          <label>IAs trabajando a la vez
            <input type="number" min={1} max={10} value={s.maxParallel} onChange={(e) => save({ maxParallel: Number(e.target.value) })} />
          </label>
        </div>
        <p className="muted small">El modelo del Cerebro Central se cambia desde su perfil (haz clic en Claude en la Oficina → Perfil).</p>
      </section>

      <section className="card">
        <h2>💾 Memoria y respaldo</h2>
        <p className="muted">
          Todo se guarda automáticamente en la carpeta <code>data/</code> del proyecto y sigue ahí aunque apagues el computador.
          Descarga un respaldo (sin tus claves) para llevar tu oficina a otro equipo.
        </p>
        <div className="row">
          <a className="btn btn--primary" href="/api/export">⬇️ Descargar respaldo</a>
          <label className="btn btn--ghost">
            ⬆️ Restaurar respaldo
            <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </label>
        </div>
      </section>
    </div>
  );
}
