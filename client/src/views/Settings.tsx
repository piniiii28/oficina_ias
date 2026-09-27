// Ajustes: claves de API, modelo del cerebro, modo demo y respaldo.
import { useEffect, useState } from 'react';
import type { AvatarConfig, Settings as SettingsT } from '../api';
import { Chibi, COSTUMES, HAIR_STYLES, EYE_STYLES, ACCESSORIES } from '../components/Chibi';
import { api, type Settings as S } from '../api';
import { useOffice } from '../state';

export function Settings() {
  const { providers, agents, reloadAgents, toast, vaultPath } = useOffice();
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
          {providers.filter((p) => !p.keyless && !p.cli).map((p) => {
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
                  {k?.configured && <TestButton id={p.id} />}
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
              {s.ollamaEnabled && <TestButton id="ollama" />}
              <input placeholder="http://localhost:11434/v1" defaultValue={s.ollamaUrl} onBlur={(e) => e.target.value !== s.ollamaUrl && save({ ollamaUrl: e.target.value })} />
              <label className="check"><input type="checkbox" checked={s.ollamaEnabled} onChange={(e) => save({ ollamaEnabled: e.target.checked })} /> Activar</label>
            </div>
          </div>
        </div>
      </section>

      <CliSection s={s} save={save} />
      <MeSection />

      <section className="card">
        <h2>⚙️ Comportamiento</h2>
        <div className="grid2">
          <label>Modo demo
            <select value={s.demoMode} onChange={(e) => save({ demoMode: e.target.value })}>
              <option value="auto">Automático: simula solo las IAs sin clave</option>
              <option value="always">Siempre simular (no gasta créditos)</option>
            </select>
          </label>
          <label>Máximo de IAs por tarea
            <input type="number" min={1} max={8} value={s.maxTeam || 5} onChange={(e) => save({ maxTeam: Number(e.target.value) })} />
          </label>
          <label>IAs trabajando a la vez
            <input type="number" min={1} max={10} value={s.maxParallel} onChange={(e) => save({ maxParallel: Number(e.target.value) })} />
          </label>
        </div>
        <label className="check" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={Boolean(s.reviewFinal)} onChange={(e) => save({ reviewFinal: e.target.checked })} />
          Revisión de calidad final: Sonar verifica la respuesta integrada antes de entregarla (una llamada extra por tarea)
        </label>
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={Boolean(s.webSearch)} onChange={(e) => save({ webSearch: e.target.checked })} />
          Búsqueda web para Claude y Sonnet (herramienta de Anthropic; cada búsqueda tiene un costo extra)
        </label>
        <p className="muted small">El modelo del Cerebro Central se cambia desde su perfil (haz clic en Claude en la Oficina → Perfil).</p>
      </section>

      <section className="card">
        <h2>💾 Memoria y respaldo</h2>
        <p className="muted">
          Todo se guarda automáticamente en la carpeta <code>data/</code> del proyecto y sigue ahí aunque apagues el computador.
          Descarga un respaldo (sin tus claves) para llevar tu oficina a otro equipo.
        </p>
        <p className="muted">
          🗂️ <b>Bóveda de Obsidian:</b> tus notas también se guardan como archivos <code>.md</code> en <code>{vaultPath}</code>. Abre esa carpeta en Obsidian («Open folder as vault») para verlas allí.
          Para traer notas de Obsidian a la oficina, usa el botón <b>⬆️ .md</b> en Notas.
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

// Qué IAs de la plantilla encajan con cada herramienta de línea de comandos.
const CLI_MATCH: Record<string, string[]> = {
  'cli-codex': ['codex', 'chatgpt', 'estratega', 'coach'],
  'cli-claude': ['cerebro', 'sonnet-qa', 'bibliotecaria'],
  'cli-opencode': ['opencode'],
  'cli-gemini': ['gemini-data', 'gemini-visual'],
};

function CliSection({ s, save }: { s: SettingsT; save: (patch: Record<string, unknown>, msg?: string) => Promise<void> }) {
  const { providers, agents, reloadAgents, toast } = useOffice();
  const [found, setFound] = useState<Record<string, string | null> | null>(null);
  const [cmds, setCmds] = useState<Record<string, string>>({});
  const clis = providers.filter((p) => p.cli);

  async function assign(pid: string) {
    const ids = CLI_MATCH[pid].filter((id) => agents.some((a) => a.id === id));
    await Promise.all(ids.map((id) => api.updateAgent(id, { provider: pid })));
    await reloadAgents();
    toast(`🔁 ${ids.length} IAs ahora usan ${providers.find((p) => p.id === pid)?.label}`);
  }

  return (
    <section className="card">
      <h2>🖥️ Herramientas de línea de comandos</h2>
      <p className="muted">
        Si ya tienes instaladas y con sesión iniciada herramientas como <b>Codex CLI</b>, <b>Claude Code</b>, <b>OpenCode</b> o <b>Gemini CLI</b>,
        la oficina puede usarlas en lugar de claves de API (usan tu suscripción). Se ejecutan en una carpeta temporal vacía y, por defecto, en modo solo lectura cuando la herramienta lo permite.
      </p>
      <button className="btn btn--ghost small" onClick={async () => setFound(await api.detectClis())}>🔍 Detectar instaladas</button>
      <div className="keys">
        {clis.map((p) => {
          const c = s.cli?.[p.id];
          const who = agents.filter((a) => a.provider === p.id).map((a) => a.name);
          return (
            <div key={p.id} className="key-row">
              <div>
                <strong>{p.label}</strong>{' '}
                {c?.enabled ? <span className="pill pill--done">activada</span> : <span className="pill">apagada</span>}{' '}
                {found && (found[p.id] ? <span className="pill pill--done">instalada</span> : <span className="pill pill--error">no encontrada</span>)}
                <div className="small muted">
                  {who.length ? `La usan: ${who.join(', ')}` : 'Ninguna IA la usa todavía'} · <a href={p.keyUrl} target="_blank" rel="noreferrer">instalar ↗</a>
                </div>
              </div>
              <div className="row">
                <input
                  title="Comando. Usa {prompt} para pasar el texto como argumento; si no está, se envía por la entrada estándar."
                  value={cmds[p.id] ?? c?.command ?? ''}
                  onChange={(e) => setCmds({ ...cmds, [p.id]: e.target.value })}
                  onBlur={() => cmds[p.id] !== undefined && cmds[p.id] !== c?.command && save({ cli: { [p.id]: { command: cmds[p.id] } } }, 'Comando guardado')}
                />
                <label className="check"><input type="checkbox" checked={Boolean(c?.enabled)} onChange={(e) => save({ cli: { [p.id]: { enabled: e.target.checked } } })} /> Activar</label>
                {c?.enabled && <TestButton id={p.id} />}
                <button className="btn btn--ghost small" onClick={() => assign(p.id)} title={`Asignar a: ${CLI_MATCH[p.id].join(', ')}`}>Asignar a sus IAs</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MeSection() {
  const { toast } = useOffice();
  const [me, setMe] = useState<{ name: string; avatar: AvatarConfig }>(() => {
    try {
      const raw = localStorage.getItem('oficina.yo');
      if (raw) return JSON.parse(raw);
    } catch {
      /* sin almacenamiento local */
    }
    return { name: 'Tú', avatar: { skin: '#f1c7a5', hair: '#3f2a1d', hairStyle: 'messy', eyes: 'happy', outfit: '#f59e0b', accessory: 'headphones', prop: '🙋', costume: 'none' } };
  });
  const set = (k: keyof AvatarConfig, v: string) => setMe({ ...me, avatar: { ...me.avatar, [k]: v } });
  return (
    <section className="card">
      <h2>🙋 Tu avatar en el edificio</h2>
      <p className="muted small">Apareces en el lobby. Haz clic en cualquier baldosa del edificio para caminar hasta allí; si es otro piso, tomas el ascensor.</p>
      <div className="avatar-editor">
        <Chibi avatar={me.avatar} size={90} legs />
        <div className="grid2">
          <label>Nombre<input value={me.name} maxLength={16} onChange={(e) => setMe({ ...me, name: e.target.value })} /></label>
          <label>Pelo <input type="color" value={me.avatar.hair} onChange={(e) => set('hair', e.target.value)} /></label>
          <label>Ropa <input type="color" value={me.avatar.outfit} onChange={(e) => set('outfit', e.target.value)} /></label>
          <label>Piel <input type="color" value={me.avatar.skin} onChange={(e) => set('skin', e.target.value)} /></label>
          <label>Peinado<select value={me.avatar.hairStyle} onChange={(e) => set('hairStyle', e.target.value)}>{HAIR_STYLES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Ojos<select value={me.avatar.eyes} onChange={(e) => set('eyes', e.target.value)}>{EYE_STYLES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Accesorio<select value={me.avatar.accessory} onChange={(e) => set('accessory', e.target.value)}>{ACCESSORIES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Skin<select value={me.avatar.costume || 'none'} onChange={(e) => set('costume', e.target.value)}>{Object.entries(COSTUMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
      </div>
      <button className="btn btn--primary" onClick={() => {
        try {
          localStorage.setItem('oficina.yo', JSON.stringify({ ...me, name: me.name.trim() || 'Tú' }));
          toast('🙋 Avatar guardado');
        } catch {
          toast('Tu navegador no permite guardar el avatar');
        }
      }}>Guardar mi avatar</button>
    </section>
  );
}

function TestButton({ id }: { id: string }) {
  const { toast } = useOffice();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn--ghost small" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const r = await api.testProvider(id);
        toast(`✅ Conectado (${r.model}, ${(r.ms / 1000).toFixed(1)} s): «${r.reply}»`);
      } catch (err) {
        toast(`❌ ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    }}>{busy ? 'Probando…' : 'Probar'}</button>
  );
}
