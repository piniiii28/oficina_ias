// Ajustes: claves de API, modelo del cerebro, modo demo y respaldo.
import { useEffect, useState } from 'react';
import type { AvatarConfig, VideosInfo, ImagesInfo, McpService, ModelSync, NodeInfo, OllamaServer, RemoteInfo, Settings as SettingsT, UpdateStatus, User } from '../api';
import { Chibi, COSTUMES, HAIR_STYLES, EYE_STYLES, ACCESSORIES, avatarStyle } from '../components/Chibi';
import { api, type Settings as S } from '../api';
import { useOffice } from '../state';
import { ConnectCenter, CLI_MATCH } from '../components/ConnectCenter';

export function Settings() {
  const { reloadAgents, toast, vaultPath } = useOffice();
  const [s, setS] = useState<S | null>(null);

  useEffect(() => {
    api.settings().then(setS);
  }, []);
  if (!s) return <div className="empty">Cargando…</div>;

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
      <ConnectCenter s={s} setS={setS} />
      <CliSection s={s} save={save} />
      <McpSection name="undermind" />
      <ImagesSection s={s} setS={setS} />
      <VideosSection s={s} setS={setS} />
      <AccessSection s={s} setS={setS} />
      <RemoteSection />
      <NodesSection />
      <SystemSection />
      <HubsSection s={s} setS={setS} />
      <CadSection s={s} save={save} />
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
          <input type="checkbox" checked={s.onlyLive !== false} onChange={(e) => save({ onlyLive: e.target.checked }, e.target.checked ? '🟢 Solo trabajan las IAs conectadas' : '✅ Ajustes guardados')} />
          Solo IAs conectadas: las de modo demo no trabajan en tareas ni reuniones y no aparecen en la oficina hasta que las conectes (si aún no hay ninguna conectada, trabajan todas en demo)
        </label>
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={Boolean(s.reviewFinal)} onChange={(e) => save({ reviewFinal: e.target.checked })} />
          Revisión de calidad final: Sonar verifica la respuesta integrada antes de entregarla (una llamada extra por tarea)
        </label>
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={Boolean(s.webSearch)} onChange={(e) => save({ webSearch: e.target.checked })} />
          Búsqueda web para Claude y Sonnet (herramienta de Anthropic; cada búsqueda tiene un costo extra)
        </label>
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={Boolean(s.verifySteps)} onChange={(e) => save({ verifySteps: e.target.checked })} />
          🎯 Verificador: Sonnet (o el cerebro) le pone nota de 1 a 5 a cada aporte, para medir qué tan acertada es cada IA (una llamada extra por aporte)
        </label>
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={Boolean(s.headsReview)} onChange={(e) => save({ headsReview: e.target.checked })} />
          👑 Revisión de los jefes: si trabajan 2 o más IAs de un departamento, su jefe revisa y unifica lo que entregaron (una llamada extra)
        </label>
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={Boolean(s.autoCards)} onChange={(e) => save({ autoCards: e.target.checked })} />
          Crear tarjetas en el tablero con los próximos pasos de cada tarea terminada
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
    <details className="card">
      <summary><h2 style={{ display: 'inline' }}>🖥️ Herramientas de línea de comandos (avanzado)</h2></summary>
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
    </details>
  );
}

/** Videos: gratis con imágenes y FFmpeg, o de pago con Hailuo o Veo. */
function VideosSection({ s, setS }: { s: SettingsT; setS: (s: SettingsT) => void }) {
  const { toast, streams } = useOffice();
  const [info, setInfo] = useState<VideosInfo | null>(null);
  const [prompt, setPrompt] = useState('A tiny robot watering plants in a cozy greenhouse at sunrise');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    api.videos().then(setInfo).catch(() => {});
  }, [s.video?.active]);
  const v = s.video;
  if (!info || !v) return null;
  const save = async (patch: Record<string, unknown>, msg = '🎬 Guardado') => {
    try {
      setS(await api.saveSettings({ video: patch }));
      toast(msg);
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    }
  };
  const chosen = v.service || v.active;
  return (
    <section className="card">
      <div className="row between">
        <h2>🎬 Videos</h2>
        <span className={`pill ${v.enabled ? 'pill--done' : ''}`}>{v.enabled ? `● ${info.services[v.active]?.label.split(' (')[0]}` : 'Apagado'}</span>
      </div>
      <p className="muted small">Pídele un video a una IA (por ejemplo a Clip o a Pixel) y aparece en la respuesta, listo para ver o descargar. Se guardan en tu carpeta de datos, en <code>videos/</code>. Ningún servicio de video con IA real es gratis hoy: el gratis arma el video con imágenes.</p>
      <label className="check"><input type="checkbox" checked={v.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Las IAs pueden hacer videos</label>
      <div className="image-services">
        {Object.entries(info.services).map(([id, svc]) => (
          <label key={id} className={`image-service ${chosen === id ? 'on' : ''}`}>
            <input type="radio" name="video-service" checked={chosen === id} onChange={() => save({ service: id }, `🎬 Ahora se usa ${svc.label.split(' (')[0]}`)} />
            <span><b>{svc.label}</b> <span className={`tier tier--${svc.tier}`}>{svc.tier === 'gratis' ? 'Gratis' : 'De pago'}</span><br /><small className="muted">{svc.hint}{svc.keyUrl && <> <a href={svc.keyUrl} target="_blank" rel="noreferrer">sacar clave ↗</a></>}</small></span>
          </label>
        ))}
      </div>
      {chosen === 'slideshow' && !info.ffmpeg && <p className="small warn">No encuentro FFmpeg. Actualiza la oficina (viene incluido) o instálalo desde ffmpeg.org.</p>}
      {chosen !== 'slideshow' && v.active === 'slideshow' && <p className="small warn">Falta la clave de {chosen === 'veo' ? 'Gemini' : 'MiniMax'} en «Conectar las IAs»; mientras tanto se usa el video con imágenes.</p>}
      <div className="row">
        <input className="grow" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe un video para probar" />
        <button className="btn btn--primary small" disabled={busy || prompt.trim().length < 3} onClick={async () => {
          setBusy(true);
          try {
            const r = await api.generateVideo(prompt, chosen, '16:9');
            setPreview(r.url);
          } catch (err) {
            toast(`❌ ${(err as Error).message}`);
          }
          setBusy(false);
        }}>{busy ? 'Haciendo el video…' : '🎬 Probar'}</button>
      </div>
      {busy && streams['video:prueba'] && <pre className="log">{streams['video:prueba'].slice(-300)}</pre>}
      {preview && <video className="image-preview" src={preview} controls autoPlay muted loop />}
    </section>
  );
}

/** Imágenes: con qué servicio las generan las IAs. */
function ImagesSection({ s, setS }: { s: SettingsT; setS: (s: SettingsT) => void }) {
  const { toast } = useOffice();
  const [info, setInfo] = useState<ImagesInfo | null>(null);
  const [form, setForm] = useState({ cloudflareAccount: s.images?.cloudflareAccount || '', cloudflareToken: '', pollinationsKey: '' });
  const [prompt, setPrompt] = useState('A cozy isometric pixel-art office with small robots working at desks, warm light');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    api.images().then(setInfo).catch(() => {});
  }, [s.images?.active]);
  const img = s.images;
  if (!info || !img) return null;
  const save = async (patch: Record<string, unknown>, msg = '🎨 Guardado') => {
    try {
      setS(await api.saveSettings({ images: patch }));
      toast(msg);
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    }
  };
  const chosen = img.service || img.active || 'pollinations';
  return (
    <section className="card">
      <div className="row between">
        <h2>🎨 Imágenes</h2>
        <span className={`pill ${img.active && img.enabled ? 'pill--done' : ''}`}>{img.enabled ? `● ${info.services[img.active || 'pollinations']?.label.split(' (')[0]}` : 'Apagado'}</span>
      </div>
      <p className="muted small">Cuando le pides una imagen a una IA (por ejemplo a Pixel), la oficina la genera con este servicio y la pone en la respuesta. Se guardan en tu carpeta de datos, en <code>imagenes/</code>.</p>
      <label className="check"><input type="checkbox" checked={img.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Las IAs pueden generar imágenes</label>
      <div className="image-services">
        {Object.entries(info.services).map(([id, svc]) => (
          <label key={id} className={`image-service ${chosen === id ? 'on' : ''}`}>
            <input type="radio" name="img-service" checked={chosen === id} onChange={() => save({ service: id }, `🎨 Ahora se usa ${svc.label.split(' (')[0]}`)} />
            <span><b>{svc.label}</b> <span className={`tier tier--${svc.tier}`}>{svc.tier === 'gratis' ? 'Gratis' : 'De pago'}</span><br /><small className="muted">{svc.hint} <a href={svc.keyUrl} target="_blank" rel="noreferrer">sacar clave ↗</a></small></span>
          </label>
        ))}
      </div>
      {chosen === 'cloudflare' && (
        <div className="grid2">
          <label>Account ID de Cloudflare<input value={form.cloudflareAccount} onChange={(e) => setForm({ ...form, cloudflareAccount: e.target.value })} placeholder="en dash.cloudflare.com, a la derecha" /></label>
          <label>Token de API (Workers AI)<input type="password" value={form.cloudflareToken} onChange={(e) => setForm({ ...form, cloudflareToken: e.target.value })} placeholder={img.cloudflareToken ? 'guardado' : 'pega el token'} /></label>
          <button className="btn btn--primary small" disabled={!form.cloudflareAccount || (!form.cloudflareToken && !img.cloudflareToken)} onClick={() => save({ service: 'cloudflare', cloudflareAccount: form.cloudflareAccount, cloudflareToken: form.cloudflareToken })}>Guardar</button>
        </div>
      )}
      {chosen === 'pollinations' && (
        <div className="grid2">
          <label>Clave de Pollinations (opcional, mejor calidad)<input type="password" value={form.pollinationsKey} onChange={(e) => setForm({ ...form, pollinationsKey: e.target.value })} placeholder={img.pollinationsKey ? 'guardada' : 'sin clave funciona igual'} /></label>
          <button className="btn btn--ghost small" disabled={!form.pollinationsKey} onClick={() => save({ pollinationsKey: form.pollinationsKey })}>Guardar clave</button>
        </div>
      )}
      {(chosen === 'huggingface' || chosen === 'google') && <p className="small muted">Usa la clave de {chosen === 'google' ? 'Gemini' : 'Hugging Face'} que pusiste en «Conectar las IAs».{chosen === 'google' ? ' Necesita facturación activa.' : ''}</p>}
      <div className="row">
        <input className="grow" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe una imagen para probar" />
        <button className="btn btn--primary small" disabled={busy || prompt.trim().length < 3} onClick={async () => {
          setBusy(true);
          try {
            const r = await api.generateImage(prompt, '16:9', chosen);
            setPreview(r.url);
          } catch (err) {
            toast(`❌ ${(err as Error).message}`);
          }
          setBusy(false);
        }}>{busy ? 'Generando…' : '🎨 Probar'}</button>
      </div>
      {preview && <img className="image-preview" src={preview} alt="Imagen de prueba" />}
    </section>
  );
}

/** Servicios que se conectan por MCP a tu Claude Code (Undermind…). */
function McpSection({ name }: { name: string }) {
  const { toast, reloadAgents } = useOffice();
  const [svc, setSvc] = useState<McpService | null>(null);
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState('');
  const load = () => api.mcpService(name).then(setSvc).catch(() => {});
  useEffect(() => {
    load();
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!svc) return null;
  const pill = { conectado: ['pill--done', '● Conectado'], 'falta-sesion': ['pill--error', 'Falta iniciar sesión'], 'no-agregado': ['', 'Sin conectar'], 'sin-claude': ['pill--error', 'Falta Claude Code'] }[svc.status];
  return (
    <section className="card">
      <div className="row between">
        <h2>🔬 {svc.label}</h2>
        <span className={`pill ${pill[0]}`}>{pill[1]}</span>
      </div>
      <p className="muted small">{svc.what}. No usa clave de API: se conecta a tu <b>Claude Code</b> y la IA «{svc.label}» (piso de Investigación) lo usa con permiso solo para sus herramientas. {svc.plan} <a href={svc.site} target="_blank" rel="noreferrer">{svc.site.replace('https://', '')} ↗</a></p>
      {!svc.claudeEnabled && <p className="small warn">Primero conecta Claude Code en «Conectar las IAs».</p>}
      <ol className="steps small">
        <li>Crea tu cuenta gratis en {svc.label}.</li>
        <li>Pulsa <b>Conectar</b>: se agrega a Claude Code y se abre una terminal; aprueba el acceso en el navegador.</li>
        <li>Vuelve y pulsa <b>Revisar</b>. Cuando diga «Conectado», pídele a la IA {svc.label} que busque artículos.</li>
      </ol>
      <div className="row">
        {svc.status !== 'conectado' && (
          <button className="btn btn--primary small" disabled={busy || svc.status === 'sin-claude'} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.mcpConnect(name);
              setLogin(r.opened ? '' : r.login);
              toast(r.already ? `✅ ${svc.label} ya estaba conectado` : r.opened ? '🔑 Aprueba el acceso en el navegador que se abrió' : '🔑 Copia el comando en una terminal para iniciar sesión');
              await reloadAgents();
            } catch (err) {
              toast(`❌ ${(err as Error).message}`);
            }
            setBusy(false);
            load();
          }}>{busy ? 'Conectando…' : '🔌 Conectar'}</button>
        )}
        <button className="btn btn--ghost small" onClick={() => { load(); reloadAgents(); }}>🔄 Revisar</button>
        {svc.status !== 'no-agregado' && svc.status !== 'sin-claude' && <button className="link" onClick={async () => { if (confirm(`¿Quitar ${svc.label} de Claude Code?`)) { await api.mcpRemove(name); await reloadAgents(); load(); } }}>quitar</button>}
      </div>
      {(login || svc.status === 'falta-sesion') && <p className="small">Si no se abrió nada, escribe en una terminal: <code>{login || svc.login}</code>. Si ese comando no existe en tu versión, abre <code>claude</code>, escribe <code>/mcp</code> y elige {svc.label}.</p>}
    </section>
  );
}

/** Nodos: tus otros computadores le prestan a la oficina su impresora y su Ollama. */
function NodesSection() {
  const { toast } = useOffice();
  const [nodes, setNodes] = useState<NodeInfo[] | null>(null);
  const [form, setForm] = useState({ url: '', token: '', name: '' });
  const [ollamaNode, setOllamaNode] = useState('');
  const load = () => {
    api.nodes().then(setNodes).catch(() => setNodes([]));
    api.settings().then((s) => setOllamaNode(s.ollamaNode || '')).catch(() => {});
  };
  useEffect(load, []);
  return (
    <section className="card">
      <h2>🛰️ Nodos (tus otros computadores)</h2>
      <p className="muted small">Un nodo le presta a esta oficina lo que ese computador tiene cerca: la <b>impresora</b> de esa casa y su <b>Ollama</b> (si tiene mejor tarjeta de video). Las IAs de la nube (Claude, Gemini, Groq…) trabajan igual desde cualquier computador.</p>
      <ol className="steps small">
        <li>En el otro computador instala la oficina (con <b>instalar.bat</b>) y Tailscale.</li>
        <li>Abre <b>nodo.bat</b> (en lugar de iniciar.bat). La primera vez instala <b>Ollama</b> si falta y descarga los modelos que usan tus IAs. Se abre una página con su dirección y su <b>código de enlace</b>.</li>
        <li>Pégalos aquí.</li>
      </ol>
      <div className="grid2">
        <label>Dirección del nodo<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://100.101.102.103:4748" /></label>
        <label>Código de enlace<input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} /></label>
        <label>Nombre (opcional)<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bogotá" /></label>
      </div>
      <button className="btn btn--primary small" disabled={!form.url || !form.token} onClick={async () => {
        try {
          await api.addNode(form);
          setForm({ url: '', token: '', name: '' });
          load();
          toast('🛰️ Nodo agregado');
        } catch (err) {
          toast(`❌ ${(err as Error).message}`);
        }
      }}>＋ Agregar nodo</button>
      <ul className="grant-list">
        {nodes?.map((n) => (
          <li key={n.id}>
            <b>{n.name}</b> <span className={`pill ${n.online ? 'pill--done' : 'pill--error'}`}>{n.online ? 'en línea' : 'sin conexión'}</span> <code>{n.url}</code>
            {n.info && <span className="small muted"> · {n.info.cpus} núcleos, {n.info.memGB} GB · Ollama: {n.info.ollama.running ? `${n.info.ollama.models.length} modelos` : 'no'} · Impresora: {n.info.printer.configured ? (n.info.printer.connected ? 'conectada' : 'sin conexión') : 'no'}</span>}
            {n.error && <span className="small danger"> · {n.error}</span>}
            {n.info?.ollama.sync && <span className="small muted"> · {syncText(n.info.ollama.sync)}</span>}
            {n.outdated && <span className="pill pill--error small">versión vieja</span>}
            {n.info?.updating?.running && <span className="small muted"> · actualizándose…</span>}
            <div className="row small">
              <label className="check"><input type="checkbox" checked={n.ollama !== false} onChange={async (e) => { await api.updateNodeSettings(n.id, { ollama: e.target.checked }); load(); }} /> Prestar su Ollama</label>
              {n.ollama !== false && <label className="check"><input type="checkbox" checked={n.syncModels !== false} onChange={async (e) => { await api.updateNodeSettings(n.id, { syncModels: e.target.checked }); load(); }} /> Descargar allí los modelos de las IAs</label>}
              {n.online && n.ollama !== false && <button className="link" onClick={async () => { try { await api.nodeModels(n.id); toast(`🦙 ${n.name} está descargando los modelos que faltan`); setTimeout(load, 1500); } catch (err) { toast(`❌ ${(err as Error).message}`); } }}>descargar modelos ya</button>}
              {n.online && <button className="link" onClick={async () => { try { const r = await api.nodeUpdate(n.id); toast(r.restart ? `⬆️ ${n.name} se está actualizando y se reinicia solo` : `⬆️ ${n.name} se está actualizando; reabre nodo.bat al terminar`); setTimeout(load, 8000); } catch (err) { toast(`❌ ${(err as Error).message}`); } }}>actualizar</button>}
              <button className="link" onClick={async () => { if (confirm(`¿Quitar el nodo ${n.name}?`)) { await api.deleteNode(n.id); load(); } }}>quitar</button>
            </div>
          </li>
        ))}
        {nodes && !nodes.length && <li className="muted small">Todavía no hay nodos.</li>}
      </ul>
      {nodes && nodes.length > 0 && (
        <label className="check">Ollama preferido{' '}
          <select value={ollamaNode} onChange={async (e) => { try { await api.saveSettings({ ollamaNode: e.target.value }); setOllamaNode(e.target.value); toast('🦙 Listo'); } catch (err) { toast(`❌ ${(err as Error).message}`); } }}>
            <option value="">El de este computador</option>
            {nodes.filter((n) => n.ollama !== false).map((n) => <option key={n.id} value={n.id}>El del nodo «{n.name}»</option>)}
          </select>
        </label>
      )}
      {nodes && nodes.length > 0 && <OllamaServers />}
      <p className="muted small">Los nodos se actualizan solos: al abrir nodo.bat, cada 6 horas (si la impresora no está imprimiendo) y cuando actualizas esta oficina. La impresora se elige en Taller 3D → Mi impresora → «¿Dónde está la impresora?».</p>
    </section>
  );
}

function syncText(st: ModelSync) {
  if (st.running) return `🦙 descargando ${st.current || 'modelos'}…`;
  if (st.error) return `🦙 ${st.error}`;
  if (st.failed.length) return `🦙 no pudo descargar ${st.failed.map((f) => f.model).join(', ')}`;
  return st.at ? '🦙 modelos al día' : '';
}

/** Varios Ollama a la vez: qué tiene cada computador y qué le falta. */
function OllamaServers() {
  const { toast, streams } = useOffice();
  const [list, setList] = useState<OllamaServer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.ollamaServers().then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="ollama-servers">
      <h3>🦙 Tus Ollama</h3>
      <p className="muted small">Se usan <b>todos a la vez</b>: cada IA elige el suyo en su perfil (⚙️ → «¿Qué Ollama usa?»), o «automático» para mandar el trabajo al menos ocupado. Si uno está apagado o no tiene el modelo, se usa otro. Las IAs sin uno elegido usan el preferido. Cada computador descarga solo los modelos de las IAs que corren en él (los nodos, solos).</p>
      <ul className="grant-list">
        {list?.map((o) => (
          <li key={o.id}>
            <b>{o.label}</b> <span className={`pill ${o.running ? 'pill--done' : 'pill--error'}`}>{o.running ? (o.busy ? `trabajando (${o.busy})` : 'listo') : 'apagado'}</span>
            {o.running && <span className="small muted"> · tiene: {o.models.map((m) => m.name.replace(/:latest$/, '')).join(', ') || 'ningún modelo'}</span>}
            {o.wanted.length > 0 && <span className="small muted"> · corren aquí: {o.wanted.join(', ')}</span>}
            {o.running && o.missing.length > 0 && (
              <>
                <span className="small warn"> · le faltan: {o.missing.join(', ')}</span>{' '}
                <button className="btn btn--ghost small" disabled={busy === o.id} onClick={async () => {
                  setBusy(o.id);
                  try {
                    const r = await api.ollamaSync(o.id);
                    toast(r.failed.length ? `⚠️ No pude descargar ${r.failed.map((f) => f.model).join(', ')}` : `🦙 ${o.label} ya tiene todos los modelos`);
                  } catch (err) {
                    toast(`❌ ${(err as Error).message}`);
                  }
                  setBusy(null);
                  load();
                }}>{busy === o.id ? 'Descargando…' : '⬇️ Descargar los que faltan'}</button>
              </>
            )}
            {busy === o.id && streams[`install:ollama-sync:${o.id}`] && <pre className="log">{streams[`install:ollama-sync:${o.id}`].slice(-300)}</pre>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dónde se guardan los datos y actualizaciones del programa. */
function SystemSection() {
  const { toast, streams } = useOffice();
  const [sys, setSys] = useState<{ dataDir: string; appDir: string; canRestart: boolean } | null>(null);
  const [up, setUp] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.system().then(setSys).catch(() => {});
  }, []);
  const check = async () => {
    setChecking(true);
    try {
      setUp(await api.updateStatus());
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    } finally {
      setChecking(false);
    }
  };
  if (!sys) return null;
  return (
    <section className="card">
      <h2>🔄 Actualizaciones y datos</h2>
      <p className="small">📁 Tus datos (notas, grafo, IAs, tareas y claves) están en <code className="copy">{sys.dataDir}</code>, fuera del programa: actualizar o reinstalar no los toca. Cada día se guarda un respaldo en su carpeta <code>respaldos</code> (los últimos 14).</p>
      <details>
        <summary className="small">Cambiar la carpeta de datos</summary>
        <p className="muted small">Por ejemplo a OneDrive o Google Drive para tener copia en la nube (solo el computador principal debe usarla). Se copian tus datos y la oficina se reinicia.</p>
        <div className="row">
          <input id="nueva-carpeta" placeholder="C:\Users\...\OneDrive\Oficina de IAs" />
          <button className="btn btn--ghost small" onClick={async () => {
            const dir = (document.getElementById('nueva-carpeta') as HTMLInputElement).value.trim();
            if (!dir || !confirm(`¿Mover tus datos a ${dir}?`)) return;
            try {
              const r = await api.moveData(dir);
              toast(r.restart ? '📦 Datos copiados. La oficina se reinicia…' : '📦 Datos copiados. Cierra y vuelve a abrir la oficina.');
              if (r.restart) setTimeout(() => location.reload(), 5000);
            } catch (err) {
              toast(`❌ ${(err as Error).message}`);
            }
          }}>Mover</button>
        </div>
      </details>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn btn--primary small" disabled={checking} onClick={check}>{checking ? 'Buscando…' : '🔍 Buscar actualizaciones'}</button>
        {up?.git && (up.behind || 0) > 0 && (
          <button className="btn btn--primary small" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.applyUpdate();
              toast(r.restart ? '✅ Actualizada. La oficina se reinicia…' : '✅ Actualizada. Cierra y vuelve a abrir la oficina.');
              if (r.restart) setTimeout(() => location.reload(), 8000);
            } catch (err) {
              toast(`❌ ${(err as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'Actualizando…' : `⬇️ Instalar ${up.behind} ${up.behind === 1 ? 'cambio' : 'cambios'}`}</button>
        )}
      </div>
      {streams['install:update'] && <pre className="log">{streams['install:update'].slice(-1500)}</pre>}
      {up && !up.git && <p className="small warn">Esta copia se descargó en ZIP y no se puede actualizar sola. Abre <b>instalar.bat</b> una vez: descarga la oficina con git, trae tus datos y crea un acceso directo que se actualiza solo.</p>}
      {up?.git && !up.error && !(up.behind || 0) && <p className="small ok">✓ Tienes la última versión ({up.head}).</p>}
      {up?.error && <p className="small warn">{up.error} <button className="link" onClick={async () => { const r = await api.updateTerminal(); toast(r.opened ? '🪟 Se abrió una terminal: inicia sesión en GitHub si te lo pide' : `Ejecuta: ${r.command}`); }}>abrir el actualizador</button></p>}
      {(up?.commits?.length || 0) > 0 && <ul className="small">{up!.commits!.map((c) => <li key={c}>{c}</li>)}</ul>}
      <p className="muted small">Solo este computador necesita actualizarse: desde los otros entras por el navegador y ves siempre la versión nueva. Los nodos se actualizan solos al abrir nodo.bat.</p>
    </section>
  );
}

/** Usar la oficina desde otros computadores con Tailscale (y los usuarios con contraseña). */
function RemoteSection() {
  const { toast, hubs } = useOffice();
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ name: '', password: '', role: 'miembro', hub: '' });
  const [error, setError] = useState('');
  const load = () => {
    api.remote().then(setInfo).catch((e) => setError(e.message));
    api.users().then(setUsers).catch(() => {});
  };
  useEffect(load, []);
  if (error) return null; // un miembro remoto no ve esta sección
  return (
    <section className="card">
      <div className="row between">
        <h2>🌐 Otros computadores (Tailscale)</h2>
        {info && <span className={`pill ${info.enabled ? 'pill--done' : ''}`}>{info.enabled ? '● Acceso remoto activo' : '○ Solo este computador'}</span>}
      </div>
      <p className="muted small">Tailscale es gratis y crea una red privada solo entre tus computadores (Mosquera, Bogotá, Canadá…). La oficina sigue corriendo aquí y desde tus otros computadores entras por el navegador con tu usuario y contraseña, usando las mismas IAs y suscripciones. Nadie fuera de tu red de Tailscale puede verla.</p>
      <ol className="steps small">
        <li>Instala <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale ↗</a> en este computador y en los otros, e inicia sesión con la <b>misma cuenta</b> (o invita a los demás a tu red).</li>
        <li>Crea abajo tu usuario (como <b>administrador</b>): con él entras desde tus otros computadores.</li>
        <li>Activa el acceso remoto. {info?.ips.length ? <>Este computador en Tailscale: <code>{info.ips.join(', ')}</code></> : <span className="warn">Todavía no detecto Tailscale en este computador.</span>}</li>
        <li>Desde los otros computadores entra a {info?.urls.length ? info.urls.map((u) => <code key={u} className="copy">{u}</code>) : <code>http://IP-de-tailscale:{info?.port || 4747}</code>} (o <code>http://{info?.hostname}:{info?.port}</code> con MagicDNS). Este computador debe estar encendido.</li>
      </ol>
      <h4>Usuarios</h4>
      <ul className="grant-list">
        {users.map((u) => (
          <li key={u.id}>
            <b>{u.name}</b> <span className={`pill ${u.role === 'admin' ? 'pill--done' : ''}`}>{u.role === 'admin' ? 'administrador' : 'miembro'}</span>
            {u.hub && <span className="muted small"> · núcleo {hubs.find((h) => h.id === u.hub)?.name || u.hub}</span>}
            <button className="link" onClick={async () => { const p = prompt(`Nueva contraseña para ${u.name} (mínimo 8 caracteres):`); if (!p) return; try { await api.updateUser(u.id, { password: p }); toast('🔑 Contraseña cambiada'); } catch (err) { toast(`❌ ${(err as Error).message}`); } }}>cambiar contraseña</button>
            <button className="link" onClick={async () => { if (confirm(`¿Quitar a ${u.name}?`)) { await api.deleteUser(u.id); load(); } }}>quitar</button>
          </li>
        ))}
        {!users.length && <li className="muted small">Todavía no hay usuarios.</li>}
      </ul>
      <div className="grid2">
        <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Santiago" /></label>
        <label>Contraseña<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="mínimo 8 caracteres" /></label>
        <label>Permisos
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="miembro">Miembro: trabaja con las IAs, notas y tablero</option>
            <option value="admin">Administrador: además cambia ajustes, claves y permisos</option>
          </select>
        </label>
        <label>Su núcleo del grafo
          <select value={form.hub} onChange={(e) => setForm({ ...form, hub: e.target.value })}>
            <option value="">(ninguno)</option>
            {hubs.map((h) => <option key={h.id} value={h.id}>{h.emoji} {h.name}</option>)}
          </select>
        </label>
      </div>
      {form.password.length > 0 && form.password.length < 8 && <p className="small warn">La contraseña necesita al menos 8 caracteres (van {form.password.length}).</p>}
      {!form.name && form.password.length >= 8 && <p className="small warn">Escribe un nombre de usuario.</p>}
      <div className="row">
        <button className="btn btn--primary small" disabled={!form.name || form.password.length < 8} title={form.password.length < 8 ? 'La contraseña necesita al menos 8 caracteres' : ''} onClick={async () => {
          try {
            await api.createUser({ ...form, hub: form.hub || null });
            setForm({ name: '', password: '', role: 'miembro', hub: '' });
            load();
            toast('👤 Usuario creado');
          } catch (err) {
            toast(`❌ ${(err as Error).message}`);
          }
        }}>＋ Crear usuario</button>
        {info && (
          <button className={`btn small ${info.enabled ? 'btn--ghost' : 'btn--primary'}`} onClick={async () => {
            try {
              setInfo(await api.setRemote(!info.enabled));
              toast(info.enabled ? '🔒 Solo este computador' : '🌐 Acceso remoto activo');
            } catch (err) {
              toast(`❌ ${(err as Error).message}`);
            }
          }}>{info.enabled ? 'Desactivar acceso remoto' : 'Activar acceso remoto'}</button>
        )}
      </div>
      <p className="muted small">Los miembros no pueden cambiar tus claves, aprobar permisos, ejecutar scripts en este computador ni tocar la impresora: eso queda para ti o para un administrador.</p>
    </section>
  );
}

/** Carpetas del computador que las IAs pueden ver (o donde pueden guardar). */
function AccessSection({ s, setS }: { s: SettingsT; setS: (s: SettingsT) => void }) {
  const { toast } = useOffice();
  const [grants, setGrants] = useState(s.grants);
  const [p, setP] = useState('');
  const [mode, setMode] = useState<'leer' | 'escribir'>('leer');
  const [sugg, setSugg] = useState<string[]>([]);
  useEffect(() => {
    api.suggestGrants().then((r) => setSugg(r.folders)).catch(() => {});
  }, []);
  const add = async (path: string, m = mode) => {
    try {
      setGrants(await api.addGrant(path, m));
      setP('');
      toast('🔓 Acceso guardado');
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    }
  };
  return (
    <section className="card">
      <h2>🔐 Accesos a tu computador</h2>
      <p className="muted small">
        Las IAs (sobre todo Claude) pueden pedir permiso para buscar y leer archivos en tus carpetas, abrir modelos en Blender u otros programas del Taller 3D y copiar sus modelos a una carpeta tuya.
        Cada petición te aparece abajo a la derecha y tú decides. Nunca pueden ver los datos ni las claves de la oficina, carpetas del sistema ni credenciales.
      </p>
      <label className="check">
        <input type="checkbox" checked={s.accessEnabled} onChange={async (e) => setS(await api.saveSettings({ accessEnabled: e.target.checked }))} />
        Permitir que las IAs pidan acceso
      </label>
      {s.blenderControl && (
        <p className="small">🧊 Las IAs pueden trabajar en tu Blender abierto sin preguntar cada vez. <button className="link" onClick={async () => setS(await api.saveSettings({ blenderControl: false }))}>Volver a preguntar</button></p>
      )}
      <ul className="grant-list">
        {grants.map((g) => (
          <li key={g.id}>
            <span className={`pill ${g.mode === 'escribir' ? 'pill--error' : 'pill--done'}`}>{g.mode === 'escribir' ? 'leer y guardar' : 'solo leer'}</span> <code>{g.path}</code>
            <button className="link" onClick={async () => setGrants(await api.deleteGrant(g.id))}>quitar</button>
          </li>
        ))}
        {!grants.length && <li className="muted small">Todavía no diste acceso a ninguna carpeta.</li>}
      </ul>
      <div className="row">
        <input value={p} onChange={(e) => setP(e.target.value)} placeholder="Ruta completa, p. ej. C:\Users\Nicolas\Documents\Modelos 3D" />
        <select value={mode} onChange={(e) => setMode(e.target.value as 'leer' | 'escribir')}>
          <option value="leer">Solo leer</option>
          <option value="escribir">Leer y guardar</option>
        </select>
        <button className="btn btn--primary small" disabled={!p.trim()} onClick={() => add(p.trim())}>Dar acceso</button>
      </div>
      {sugg.filter((f) => !grants.some((g) => g.path === f)).length > 0 && (
        <div className="row small">
          <span className="muted">Rápido:</span>
          {sugg.filter((f) => !grants.some((g) => g.path === f)).map((f) => <button key={f} className="btn btn--ghost small" onClick={() => add(f, 'leer')}>＋ {f.split(/[\\/]/).pop()}</button>)}
        </div>
      )}
      <p className="muted small">Consejo: con Claude Code o Gemini CLI activados, las carpetas permitidas también se les pasan para que puedan leerlas directamente.</p>
    </section>
  );
}

/** Núcleos del grafo: las personas o computadores que usan la oficina. */
function HubsSection({ s, setS }: { s: SettingsT; setS: (s: SettingsT) => void }) {
  const { reloadHubs, toast } = useOffice();
  const [list, setList] = useState(s.hubs);
  const update = (i: number, patch: Partial<SettingsT['hubs'][number]>) => setList(list.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  return (
    <section className="card">
      <h2>🕸️ Núcleos del grafo</h2>
      <p className="muted small">Cada persona o computador tiene su núcleo: sus notas y tareas quedan ahí y el grafo muestra qué temas comparten. Elige el tuyo arriba a la izquierda, en el menú.</p>
      <div className="hub-edit">
        {list.map((h, i) => (
          <div key={h.id || i} className="row">
            <input className="emoji-input" value={h.emoji} maxLength={4} onChange={(e) => update(i, { emoji: e.target.value })} aria-label="Emoji" />
            <input value={h.name} disabled={h.id === 'cerebro'} onChange={(e) => update(i, { name: e.target.value })} aria-label="Nombre" />
            <input type="color" value={h.color} onChange={(e) => update(i, { color: e.target.value })} aria-label="Color" />
            {h.id !== 'cerebro' && <button className="btn btn--ghost small" onClick={() => setList(list.filter((_, j) => j !== i))}>Quitar</button>}
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn btn--ghost small" onClick={() => setList([...list, { id: '', name: '', emoji: '🔵', color: '#94a3b8' }])}>＋ Otro núcleo</button>
        <button className="btn btn--primary small" onClick={async () => {
          const next = await api.saveSettings({ hubs: list });
          setS(next);
          setList(next.hubs);
          await reloadHubs();
          toast('🕸️ Núcleos guardados');
        }}>Guardar núcleos</button>
      </div>
    </section>
  );
}

/** Rutas de Blender, OpenSCAD, FreeCAD y laminadores (si no se detectan solos). */
function CadSection({ s, save }: { s: SettingsT; save: (patch: Record<string, unknown>, msg?: string) => Promise<void> }) {
  const { cadTools } = useOffice();
  const [found, setFound] = useState<Record<string, string | boolean | null> | null>(null);
  useEffect(() => {
    api.cadDetect().then(setFound).catch(() => setFound({}));
  }, [s.cadPaths]);
  return (
    <section className="card">
      <h2>🖨️ Taller 3D</h2>
      <p className="muted small">La oficina busca estos programas sola. Si instalaste alguno en otra carpeta, pega aquí la ruta del ejecutable (por ejemplo <code>C:\Program Files\Blender Foundation\Blender 4.2\blender.exe</code>).</p>
      <div className="keys">
        {cadTools.map((t) => (
          <div key={t.id} className="key-row">
            <div>
              <strong>{t.label}</strong> {found && (found[t.id] ? <span className="pill pill--done">encontrado</span> : <span className="pill">no encontrado</span>)}
              <div className="small muted">{found?.[t.id] || <a href={t.url} target="_blank" rel="noreferrer">descargar gratis ↗</a>}</div>
            </div>
            <input placeholder="Ruta (opcional)" defaultValue={s.cadPaths?.[t.id] || ''} onBlur={(e) => e.target.value !== (s.cadPaths?.[t.id] || '') && save({ cadPaths: { [t.id]: e.target.value } }, 'Ruta guardada')} />
          </div>
        ))}
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
      <label className="check" style={{ marginBottom: 8 }}>
        Estilo de los avatares{' '}
        <select defaultValue={avatarStyle()} onChange={(e) => {
          try {
            localStorage.setItem('oficina.avatares', e.target.value);
          } catch {
            /* sin almacenamiento local */
          }
          location.reload();
        }}>
          <option value="habbo">Pixel (estilo Habbo)</option>
          <option value="chibi">Chibi (clásico)</option>
        </select>
      </label>
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
