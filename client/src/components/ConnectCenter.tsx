// Centro de conexión: conecta IAs paso a paso (primero las gratis), con varias
// cuentas por proveedor, modo gratis y un asistente (el cerebro) que te guía.
import { useEffect, useRef, useState } from 'react';
import { api, type CheckResult, TIER_LABEL, type ChatMessage, type Provider, type Settings, type Tier } from '../api';
import { Markdown } from './Markdown';
import { useOffice } from '../state';
import { clock, errorHelp } from '../errorHelp';

// Qué IAs de la plantilla encajan con cada herramienta de línea de comandos.
export const CLI_MATCH: Record<string, string[]> = {
  'cli-codex': ['codex', 'chatgpt', 'estratega', 'coach'],
  'cli-claude': ['cerebro', 'sonnet-qa', 'bibliotecaria'],
  'cli-opencode': ['opencode'],
  'cli-gemini': ['gemini-data', 'gemini-visual'],
};

const GROUPS: { id: string; title: string; tiers: Tier[] }[] = [
  { id: 'gratis', title: '🆓 Gratis', tiers: ['gratis', 'mixto'] },
  { id: 'suscripcion', title: '🎟️ Con tu suscripción', tiers: ['suscripcion'] },
  { id: 'pago', title: '💳 De pago', tiers: ['pago'] },
];

export function ConnectCenter({ s, setS }: { s: Settings; setS: (s: Settings) => void }) {
  const { providers, agents, reloadAgents, toast } = useOffice();
  const [group, setGroup] = useState('gratis');
  const [open, setOpen] = useState<string | null>(null);
  const [helper, setHelper] = useState(false);
  const liveCount = agents.filter((a) => a.live).length;
  const backups = agents.filter((a) => a.paidBackup).length;
  const onGeminiCli = agents.filter((a) => a.geminiBackup).length;
  const rescued = agents.filter((a) => a.demoBackup).length;
  const inDemo = agents.filter((a) => a.enabled && !a.live && !a.isBrain).length;
  const [check, setCheck] = useState<{ busy: boolean; results: CheckResult[] | null }>({ busy: false, results: null });
  const googleApi = agents.filter((a) => a.provider === 'google').length;

  const connected = (p: Provider) => s.keys[p.id]?.configured || (p.cli && s.cli[p.id]?.enabled) || (p.keyless && s.ollamaEnabled);
  const list = providers.filter((p) => GROUPS.find((g) => g.id === group)!.tiers.includes(p.tier));

  async function refresh() {
    setS(await api.settings());
    await reloadAgents();
  }

  return (
    <section className="card connect-center">
      <div className="row between">
        <div>
          <h2>🔌 Conectar las IAs</h2>
          <p className="muted small">{liveCount} de {agents.length} IAs responden de verdad; las demás están en modo demo. Empieza por las gratis.</p>
        </div>
        <div className="row">
          <button className="btn btn--primary" onClick={async () => {
            const r = await api.freeMode();
            await refresh();
            toast(r.changed ? `🆓 ${r.changed} IAs pasaron a modelos gratis` : 'Todas las IAs ya usan opciones gratis o tu suscripción');
          }} title="Las IAs que usan proveedores de pago pasan a modelos gratis (o a tu suscripción si la conectaste)">🆓 Modo gratis</button>
          {backups > 0 && <button className="btn btn--ghost small" onClick={async () => { const r = await api.undoFreeMode(); await refresh(); toast(`↩️ ${r.restored} IAs volvieron a su modelo anterior`); }}>Deshacer</button>}
          {googleApi > 0 && <button className="btn btn--ghost" title="Tus IAs de Gemini pasan a Gemini CLI con tu cuenta de Google AI Pro: 1.500 consultas al día (la clave gratis da 250)" onClick={async () => {
            const r = await api.geminiPro();
            await refresh();
            toast(r.cliEnabled ? `✨ ${r.changed} IAs de Gemini usan ahora tu suscripción Pro` : `✨ ${r.changed} IAs pasaron a Gemini CLI: conéctalo abajo (Gratis → Gemini CLI) e inicia sesión con tu cuenta Pro`);
          }}>✨ Usar mi Gemini Pro</button>}
          {onGeminiCli > 0 && <button className="btn btn--ghost small" onClick={async () => { const r = await api.undoGeminiPro(); await refresh(); toast(`↩️ ${r.restored} IAs volvieron a la clave de Gemini`); }}>Volver a la clave</button>}
          <button className={`btn ${helper ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setHelper((h) => !h)}>💬 Ayuda de Claude</button>
        </div>
      </div>
      <div className="row check-row">
        <button className="btn btn--ghost small" disabled={check.busy || !liveCount} title="Le hace una pregunta cortita a cada IA conectada para ver cuáles funcionan" onClick={async () => {
          setCheck({ busy: true, results: null });
          try {
            const r = await api.checkAgents();
            setCheck({ busy: false, results: r.results });
            await refresh();
            toast(r.failed ? `⚠️ ${r.failed} de ${r.checked} IAs están fallando: no recibirán trabajo hasta que vuelvan a responder` : r.resting ? `⏳ ${r.resting} IAs están sin cupo por ahora (vuelven solas); las demás responden` : `✅ Las ${r.checked} IAs conectadas responden`);
          } catch (err) {
            setCheck({ busy: false, results: null });
            toast(`❌ ${(err as Error).message}`);
          }
        }}>{check.busy ? '🩺 Revisando… (puede tardar un minuto)' : '🩺 Revisar todas las IAs'}</button>
        {inDemo > 0 && <button className="btn btn--ghost small" title="Las IAs en modo demo pasan a un proveedor gratis que ya conectaste" onClick={async () => {
          const r = await api.rescueAgents();
          await refresh();
          toast(r.changed ? `🔁 ${r.changed} IAs de demo ahora usan tus proveedores conectados${r.stillDemo ? ` (quedan ${r.stillDemo} en demo)` : ''}` : 'Conecta al menos un proveedor gratis (por ejemplo Groq) para activarlas');
        }}>🔁 Activar las {inDemo} de demo</button>}
        {rescued > 0 && <button className="link" onClick={async () => { const r = await api.undoRescue(); await refresh(); toast(`↩️ ${r.restored} IAs volvieron a su proveedor anterior`); }}>deshacer</button>}
        <button className="btn btn--ghost small" title="Copia un informe (sin claves) del estado de cada IA y sus últimos errores, para pegárselo a Claude" onClick={async () => {
          try {
            const text = await api.diagnostics();
            await navigator.clipboard.writeText(text);
            toast('📋 Diagnóstico copiado: pégalo en el chat con Claude');
          } catch (e) {
            toast(`No pude copiarlo: ${(e as Error).message}`);
          }
        }}>📋 Copiar diagnóstico</button>
      </div>
      {check.results && (
        <ul className="check-results">
          {check.results.map((r) => (
            <li key={r.id} className={r.ok ? 'ok' : r.kind === 'cupo' ? 'rest' : 'bad'}>
              {r.ok ? '✅' : r.kind === 'cupo' ? '⏳' : '❌'} <b>{r.name}</b> <span className="muted small">{r.provider} / {r.model}{r.ok ? ` · ${(r.ms / 1000).toFixed(1)} s` : ''}</span>
              {r.changedModel && <span className="small muted"> · cambió de {r.changedModel} (ya no existía)</span>}
              {r.error && (() => {
                const h = errorHelp(r.kind, r.error);
                const p = providers.find((x) => x.id === r.provider);
                return (
                  <div className="small">
                    <span className={h.kind === 'cupo' ? 'warn' : 'danger'}>{h.icon} {h.title}</span>{h.fix ? ` — ${h.fix}` : ''}
                    {p && (h.kind === 'clave' || h.kind === 'programa') && <> <button className="link" onClick={() => { setGroup(GROUPS.find((g) => g.tiers.includes(p.tier))!.id); setOpen(p.id); }}>{h.kind === 'clave' ? 'Revisar la clave' : 'Instalar'}</button></>}
                    <details><summary className="muted">Detalle técnico</summary><code>{r.error}</code></details>
                  </div>
                );
              })()}
            </li>
          ))}
        </ul>
      )}

      {helper && <Assistant onAction={(kind, arg) => {
        if (kind === 'clave' || kind === 'instalar' || kind === 'sesion') {
          const p = providers.find((x) => x.id === arg);
          if (p) {
            setGroup(GROUPS.find((g) => g.tiers.includes(p.tier))!.id);
            setOpen(p.id);
          }
        }
      }} refresh={refresh} />}

      <div className="type-filter">
        {GROUPS.map((g) => <button key={g.id} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)}>{g.title}</button>)}
      </div>
      <div className="provider-grid">
        {list.map((p) => {
          const users = agents.filter((a) => a.provider === p.id);
          const extra = s.accounts.filter((a) => a.provider === p.id).length;
          return (
            <button key={p.id} className={`provider-card ${open === p.id ? 'on' : ''} ${connected(p) ? 'is-on' : ''}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
              <div className="row between">
                <strong>{p.label}</strong>
                <span className={`tier tier--${p.tier}`}>{TIER_LABEL[p.tier]}</span>
              </div>
              <small className="muted">{p.hint}</small>
              <small>{connected(p) ? <span className="ok">● Conectado{extra ? ` · ${extra + 1} cuentas` : ''}</span> : <span className="muted">○ Sin conectar</span>} · {users.length} {users.length === 1 ? 'IA' : 'IAs'}</small>
              {connected(p) && (() => {
                // Cómo le va hoy a este proveedor: sin cupo (y hasta cuándo) o con fallas.
                const resting = users.filter((a) => a.health?.ok === false && a.health.quota);
                const failing = users.filter((a) => a.health?.ok === false && !a.health.quota);
                const back = resting.map((a) => a.health?.until || 0).filter(Boolean).sort((x, y) => x - y)[0];
                if (!resting.length && !failing.length) return null;
                return (
                  <small className="provider-health">
                    {resting.length > 0 && <span className="warn">⏳ {resting.length} sin cupo{back ? ` hasta las ${clock(back)}` : ''}</span>}
                    {failing.length > 0 && <span className="danger" title={failing.map((a) => `${a.name}: ${a.health?.error || ''}`).join('\n')}>{errorHelp(failing[0].health?.kind, failing[0].health?.error || '').icon} {failing.length} con fallas ({errorHelp(failing[0].health?.kind, failing[0].health?.error || '').title.toLowerCase()})</span>}
                  </small>
                );
              })()}
            </button>
          );
        })}
      </div>
      {open && <ConnectPanel key={open} p={providers.find((x) => x.id === open)!} s={s} setS={setS} refresh={refresh} />}
    </section>
  );
}

/** Pasos para conectar un proveedor: clave o instalación, cuentas y a qué IAs asignarlo. */
function ConnectPanel({ p, s, setS, refresh }: { p: Provider; s: Settings; setS: (s: Settings) => void; refresh: () => Promise<void> }) {
  const { toast, streams } = useOffice();
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState('');
  const [installed, setInstalled] = useState<string | null | undefined>(undefined);
  const [manual, setManual] = useState('');
  const [ollama, setOllama] = useState<{ running: boolean; models: { name: string }[] } | null>(null);
  const accounts = s.accounts.filter((a) => a.provider === p.id);
  const mainOn = s.keys[p.id]?.configured;

  useEffect(() => {
    if (p.cli) api.detectClis().then((d) => setInstalled(d[p.id]));
    if (p.keyless) api.ollamaModels().then(setOllama);
  }, [p.id, p.cli, p.keyless]);

  async function test() {
    setBusy('test');
    try {
      const r = await api.testProvider(p.id);
      toast(`✅ ${p.label} responde (${(r.ms / 1000).toFixed(1)} s): «${r.reply}»`);
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function saveKey() {
    const k = key.trim();
    if (!k) return;
    if (!mainOn) setS(await api.saveSettings({ apiKeys: { [p.id]: k } }));
    else setS(await api.addAccount({ provider: p.id, label: label.trim(), key: k }));
    setKey('');
    setLabel('');
    await refresh();
    toast(mainOn ? '👥 Cuenta agregada: si una se queda sin cupo, la oficina usa la otra' : `🔌 ${p.label} conectado`);
  }

  async function login(account?: string) {
    const r = await api.cliLogin(p.id, account);
    setManual(r.opened ? '' : r.command);
    toast(r.opened ? '🪟 Se abrió una terminal: inicia sesión y vuelve aquí' : 'Copia el comando de abajo en una terminal');
  }

  const log = streams[`install:${p.id}`];

  return (
    <div className="connect-panel">
      {p.cli && (
        <ol className="steps">
          <li>
            <b>Instalar.</b>{' '}
            {installed === undefined ? <span className="muted">Buscando…</span> : installed ? <span className="ok">Ya está instalada ✓</span> : (
              <button className="btn btn--primary small" disabled={busy === 'install'} onClick={async () => {
                setBusy('install');
                try {
                  const r = await api.cliInstall(p.id);
                  setInstalled(r.path);
                  toast(r.ok ? '✅ Instalada' : '⚠️ No terminó la instalación: revisa el registro');
                } catch (err) {
                  toast(`❌ ${(err as Error).message}`);
                } finally {
                  setBusy('');
                }
              }}>{busy === 'install' ? 'Instalando…' : `Instalar con un clic (npm i -g ${p.npm})`}</button>
            )}
            {log && <pre className="log">{log}</pre>}
          </li>
          <li><b>Iniciar sesión</b> con tu cuenta. <button className="btn btn--ghost small" onClick={() => login()}>🪟 Abrir terminal para iniciar sesión</button></li>
          <li>
            <b>Activar y probar.</b>{' '}
            <label className="check"><input type="checkbox" checked={Boolean(s.cli[p.id]?.enabled)} onChange={async (e) => { setS(await api.saveSettings({ cli: { [p.id]: { enabled: e.target.checked } } })); await refresh(); }} /> Activada</label>{' '}
            {s.cli[p.id]?.enabled && <button className="btn btn--ghost small" disabled={busy === 'test'} onClick={() => test()}>{busy === 'test' ? 'Probando…' : 'Probar'}</button>}
          </li>
        </ol>
      )}
      {manual && <p className="small">Ejecuta esto en una terminal: <code className="copy">{manual}</code></p>}

      {p.keyless && (
        <ol className="steps">
          <li><b>Instala Ollama</b> desde <a href={p.keyUrl} target="_blank" rel="noreferrer">ollama.com ↗</a> y ábrelo. {ollama ? (ollama.running ? <span className="ok">Está funcionando ✓</span> : <span className="warn">No lo encuentro funcionando</span>) : null}</li>
          <li>
            <b>Descarga modelos</b> (gratis, se quedan en tu computador):{' '}
            <DownloadOllama installed={ollama?.models.map((m) => m.name) || []} onDone={() => api.ollamaModels().then(setOllama)} />
          </li>
          <li><b>Actívalo:</b> <label className="check"><input type="checkbox" checked={s.ollamaEnabled} onChange={async (e) => { setS(await api.saveSettings({ ollamaEnabled: e.target.checked })); await refresh(); }} /> Usar Ollama</label>{s.ollamaEnabled && <> <button className="btn btn--ghost small" onClick={() => test()}>Probar</button></>}</li>
        </ol>
      )}

      {p.id === 'cloudflare' && (
        <div className="small connect-extra">
          {s.images?.cloudflareToken && s.cloudflareAccount
            ? <p className="ok">✓ Usa tu cuenta de Cloudflare de «🎨 Imágenes»: no hace falta otra clave.</p>
            : <p className="muted">Necesita tu <b>Account ID</b> (32 letras y números, en la dirección del navegador en dash.cloudflare.com) y un token con permiso «Workers AI». Si ya los pusiste en «🎨 Imágenes», se usan esos.</p>}
          <label>Account ID
            <input defaultValue={s.cloudflareAccount || ''} placeholder="3f9a1b2c…" onBlur={async (e) => {
              const v = e.target.value.trim();
              if (v === (s.cloudflareAccount || '')) return;
              try {
                setS(await api.saveSettings({ cloudflareAccount: v }));
                await refresh();
                toast('☁️ Account ID guardado');
              } catch (err) {
                toast(`❌ ${(err as Error).message}`);
              }
            }} />
          </label>
          {s.keys[p.id]?.configured && <button className="btn btn--ghost small" disabled={busy === 'test'} onClick={() => test()}>{busy === 'test' ? 'Probando…' : 'Probar'}</button>}
        </div>
      )}
      {p.id === 'ovh' && (
        <div className="small connect-extra">
          <label className="check"><input type="checkbox" checked={Boolean(s.ovhAnon)} onChange={async (e) => { setS(await api.saveSettings({ ovhAnon: e.target.checked })); await refresh(); }} /> Usar gratis y sin clave (2 preguntas por minuto por modelo)</label>
          {s.ovhAnon && <button className="btn btn--ghost small" disabled={busy === 'test'} onClick={() => test()}>{busy === 'test' ? 'Probando…' : 'Probar'}</button>}
          <p className="muted">Abajo puedes poner una clave para ir más rápido, pero con clave OVHcloud cobra por uso.</p>
        </div>
      )}

      {!p.cli && !p.keyless && !(p.id === 'cloudflare' && s.images?.cloudflareToken && s.cloudflareAccount) && (
        <ol className="steps">
          <li><b>{p.id === 'ovh' ? 'Opcional: crea tu clave' : 'Crea tu clave'}</b> (con tu correo): <a className="btn btn--ghost small" href={p.keyUrl} target="_blank" rel="noreferrer">Abrir la página ↗</a></li>
          <li>
            <b>{mainOn ? 'Agrega otra cuenta' : 'Pégala aquí'}</b>
            <div className="row">
              {mainOn && <input placeholder="Nombre (p. ej. correo de Santiago)" value={label} onChange={(e) => setLabel(e.target.value)} />}
              <input type="password" placeholder="Pega la clave…" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveKey()} />
              <button className="btn btn--primary small" disabled={!key.trim()} onClick={saveKey}>Guardar</button>
              {mainOn && <button className="btn btn--ghost small" disabled={busy === 'test'} onClick={() => test()}>Probar</button>}
            </div>
          </li>
        </ol>
      )}

      {!p.keyless && (
        <div className="accounts">
          <b className="small">Cuentas</b>
          <ul>
            {(mainOn || p.cli) && (
              <li>
                Principal {s.keys[p.id]?.preview && <code>{s.keys[p.id].preview}</code>}
                {!p.cli && s.keys[p.id]?.preview && <button className="link" onClick={async () => { setS(await api.saveSettings({ apiKeys: { [p.id]: null } })); await refresh(); }}>quitar</button>}
              </li>
            )}
            {accounts.map((a) => (
              <li key={a.id}>
                {a.label} {a.preview && <code>{a.preview}</code>}
                {p.cli && <button className="link" onClick={() => login(a.id)}>iniciar sesión</button>}
                <button className="link" onClick={async () => { setS(await api.deleteAccount(a.id)); await refresh(); }}>quitar</button>
              </li>
            ))}
          </ul>
          {p.cli && (
            <button className="btn btn--ghost small" onClick={async () => {
              const name = prompt('Nombre de la otra cuenta (por ejemplo, el correo):');
              if (!name) return;
              const next = await api.addAccount({ provider: p.id, label: name });
              setS(next);
              const acc = next.accounts.filter((a) => a.provider === p.id).at(-1);
              if (acc) await login(acc.id);
            }}>＋ Otra cuenta (otro correo)</button>
          )}
          <p className="muted small">Con varias cuentas, cuando una se queda sin cupo la oficina sigue con la siguiente. En el perfil de cada IA puedes elegir qué cuenta usa primero.</p>
        </div>
      )}

      <AssignAgents p={p} refresh={refresh} />
    </div>
  );
}

function DownloadOllama({ installed, onDone }: { installed: string[]; onDone: () => void }) {
  const { freeModels, toast, streams } = useOffice();
  const [busy, setBusy] = useState('');
  return (
    <span className="row wrap">
      {(freeModels.ollama || []).map((m) => {
        const has = installed.some((n) => n === m.id || n.startsWith(`${m.id}:`));
        return (
          <button key={m.id} className="btn btn--ghost small" disabled={has || Boolean(busy)} title={m.for} onClick={async () => {
            setBusy(m.id);
            try {
              const r = await api.ollamaPull(m.id);
              toast(r.ok ? `✅ ${m.label} descargado` : `⚠️ No se pudo descargar ${m.label}: ¿Ollama está abierto?`);
              onDone();
            } finally {
              setBusy('');
            }
          }}>{has ? `✓ ${m.label}` : busy === m.id ? 'Descargando…' : `⬇️ ${m.label}`}</button>
        );
      })}
      {busy && streams[`install:ollama:${busy}`] && <pre className="log">{streams[`install:ollama:${busy}`].slice(-400)}</pre>}
    </span>
  );
}

/** Elige qué IAs usan este proveedor y con qué modelo gratis. */
function AssignAgents({ p, refresh }: { p: Provider; refresh: () => Promise<void> }) {
  const { agents, freeModels, toast } = useOffice();
  const models = freeModels[p.id] || [];
  const suggested = new Set([...(CLI_MATCH[p.id] || []), ...agents.filter((a) => a.provider === p.id).map((a) => a.id)]);
  const [pick, setPick] = useState<Set<string>>(() => new Set(agents.filter((a) => suggested.has(a.id)).map((a) => a.id)));
  const [model, setModel] = useState(models[0]?.id || '');
  const [onlyDemo, setOnlyDemo] = useState(false);
  const shown = agents.filter((a) => !onlyDemo || !a.live || pick.has(a.id));
  return (
    <div className="assign">
      <div className="row between">
        <b className="small">¿Qué IAs lo usan?</b>
        <label className="check small"><input type="checkbox" checked={onlyDemo} onChange={(e) => setOnlyDemo(e.target.checked)} /> Solo las que están en demo</label>
      </div>
      <div className="assign-list">
        {shown.map((a) => (
          <label key={a.id} className={`assign-item ${pick.has(a.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={pick.has(a.id)} onChange={(e) => {
              const next = new Set(pick);
              if (e.target.checked) next.add(a.id);
              else next.delete(a.id);
              setPick(next);
            }} />
            <span className={`dot ${a.live ? 'dot--live' : 'dot--demo'}`} /> {a.name} <small className="muted">{a.role}</small>
          </label>
        ))}
      </div>
      <div className="row">
        {!p.cli && (
          <label className="small">Modelo
            <input list={`models-${p.id}`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="id del modelo" />
            <datalist id={`models-${p.id}`}>{models.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.for}</option>)}</datalist>
          </label>
        )}
        <button className="btn btn--primary small" disabled={!pick.size || (!p.cli && !model.trim())} onClick={async () => {
          await Promise.all([...pick].map((id) => api.updateAgent(id, p.cli ? { provider: p.id } : { provider: p.id, model: model.trim() })));
          await refresh();
          toast(`🔁 ${pick.size} IAs ahora usan ${p.label}`);
        }}>Asignar a {pick.size} {pick.size === 1 ? 'IA' : 'IAs'}</button>
      </div>
    </div>
  );
}

/** El cerebro como asistente de conexión; sus respuestas traen botones de acción. */
export function Assistant({ onAction = () => {}, refresh = async () => {}, starters = ['Quiero conectar todo gratis', 'Tengo el plan de Claude', 'Tengo dos cuentas de Gemini Pro'] }: { onAction?: (kind: string, arg: string) => void; refresh?: () => Promise<void>; starters?: string[] }) {
  const { streams, toast } = useOffice();
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.assistant().then(setHistory);
  }, []);
  const live = streams['chat:_asistente'];
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [history, live]);

  async function send(msg: string) {
    if (!msg.trim() || busy) return;
    setBusy(true);
    setHistory((h) => [...h, { role: 'user', content: msg, at: new Date().toISOString() }]);
    setText('');
    try {
      const r = await api.askAssistant(msg);
      setHistory(r.history);
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(kind: string, arg: string) {
    try {
      if (kind === 'instalar') {
        toast('⏳ Instalando…');
        const r = await api.cliInstall(arg);
        toast(r.ok ? '✅ Instalada' : '⚠️ La instalación no terminó');
      } else if (kind === 'sesion') {
        const r = await api.cliLogin(arg);
        toast(r.opened ? '🪟 Se abrió una terminal para iniciar sesión' : `Ejecuta en una terminal: ${r.command}`);
      } else if (kind === 'ollama') {
        toast(`⏳ Descargando ${arg}…`);
        const r = await api.ollamaPull(arg);
        toast(r.ok ? `✅ ${arg} listo` : '⚠️ No se pudo: ¿Ollama está abierto?');
      } else if (kind === 'blender-instalar') {
        toast('⏳ Instalando el complemento en Blender…');
        const r = await api.blenderInstall();
        toast(r.ok ? '✅ Complemento instalado. Cierra Blender (si estaba abierto) y ábrelo otra vez.' : '⚠️ No se pudo instalar: revisa que Blender esté instalado');
      } else if (kind === 'blender-probar') {
        const st = await api.blenderStatus();
        toast(st.connected ? `✅ Blender ${st.version} está conectado con la oficina` : `❌ ${st.error || 'Blender no está conectado'}`);
      } else if (kind === 'blender-descargar') {
        window.location.href = '/api/blender/addon';
      } else if (kind === 'modo-gratis') {
        const r = await api.freeMode();
        toast(`🆓 ${r.changed} IAs pasaron a modelos gratis`);
      }
      await refresh();
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    }
    onAction(kind, arg);
  }

  return (
    <div className="assistant">
      <div className="assistant-log" ref={logRef}>
        {!history.length && <p className="muted small">Pregúntame, por ejemplo: «quiero conectar todo gratis», «tengo Gemini Pro en dos correos» o «¿cómo conecto Codex con mi ChatGPT?».</p>}
        {history.map((m, i) => (
          <div key={i} className={`msg msg--${m.role}`}>{m.role === 'assistant' ? <WithActions text={m.content} onAct={act} /> : m.content}</div>
        ))}
        {busy && <div className="msg msg--assistant">{live ? <Markdown text={live.replace(/\{\{[^}]*\}\}/g, '')} /> : 'Pensando…'}</div>}
      </div>
      <div className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(text)} placeholder="Escribe tu pregunta…" />
        <button className="btn btn--primary small" disabled={busy || !text.trim()} onClick={() => send(text)}>Enviar</button>
        {starters.map((q) => (
          <button key={q} className="btn btn--ghost small" disabled={busy} onClick={() => send(q)}>{q}</button>
        ))}
        {history.length > 0 && <button className="link small" onClick={async () => { await api.clearAssistant(); setHistory([]); }}>borrar</button>}
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, (arg: string) => string> = {
  instalar: (a) => `⬇️ Instalar ${a.replace('cli-', '')}`,
  sesion: (a) => `🪟 Iniciar sesión en ${a.replace('cli-', '')}`,
  clave: (a) => `🔑 Conectar ${a}`,
  ollama: (a) => `⬇️ Descargar ${a}`,
  'modo-gratis': () => '🆓 Activar modo gratis',
  'blender-instalar': () => '🧊 Instalar el complemento en Blender',
  'blender-probar': () => '🔌 Probar la conexión con Blender',
  'blender-descargar': () => '⬇️ Descargar el complemento',
};

/** Convierte las marcas {{accion:arg}} del asistente en botones. */
function WithActions({ text, onAct }: { text: string; onAct: (kind: string, arg: string) => void }) {
  const parts = text.split(/(\{\{[a-z-]+(?::[\w.:/-]+)?\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\{\{([a-z-]+)(?::([\w.:/-]+))?\}\}$/);
        if (m && ACTION_LABEL[m[1]]) return <button key={i} className="btn btn--primary small action-btn" onClick={() => onAct(m[1], m[2] || '')}>{ACTION_LABEL[m[1]](m[2] || '')}</button>;
        return part.trim() ? <Markdown key={i} text={part} /> : null;
      })}
    </>
  );
}
