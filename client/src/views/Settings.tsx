// Ajustes: claves de API, modelo del cerebro, modo demo y respaldo.
import { useEffect, useState } from 'react';
import type { AvatarConfig, RemoteInfo, Settings as SettingsT, User } from '../api';
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
      <AccessSection s={s} setS={setS} />
      <RemoteSection />
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
      <p className="muted small">Tailscale es gratis y crea una red privada solo entre tus computadores (Mosquera, Bogotá, Canadá…). La oficina sigue corriendo aquí y los demás entran desde el navegador con su usuario y contraseña. Nadie fuera de tu red de Tailscale puede verla.</p>
      <ol className="steps small">
        <li>Instala <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale ↗</a> en este computador y en los otros, e inicia sesión con la <b>misma cuenta</b> (o invita a los demás a tu red).</li>
        <li>Crea abajo un usuario para cada persona.</li>
        <li>Activa el acceso remoto. {info?.ips.length ? <>Este computador en Tailscale: <code>{info.ips.join(', ')}</code></> : <span className="warn">Todavía no detecto Tailscale en este computador.</span>}</li>
        <li>Los demás entran a {info?.urls.length ? info.urls.map((u) => <code key={u} className="copy">{u}</code>) : <code>http://IP-de-tailscale:{info?.port || 4747}</code>} (o <code>http://{info?.hostname}:{info?.port}</code> con MagicDNS). Este computador debe estar encendido.</li>
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
      <div className="row">
        <button className="btn btn--primary small" disabled={!form.name || form.password.length < 8} onClick={async () => {
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
  const [found, setFound] = useState<Record<string, string | null> | null>(null);
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
