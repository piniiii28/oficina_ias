// Automatizar: n8n (flujos de trabajo) y Claude Desktop (extensión MCP).
import { useEffect, useState } from 'react';
import { api, type Automation, type AutomationLog } from '../api';
import { useOffice } from '../state';

export function Automations() {
  return (
    <div className="automations">
      <header>
        <h2>⚡ Automatizar</h2>
        <p className="muted">Conecta la oficina con <b>n8n</b> para automatizar procesos y con <b>Claude Desktop</b> para usar a tus IAs desde allí.</p>
      </header>
      <N8nSection />
      <ClaudeDesktopSection />
    </div>
  );
}

function N8nSection() {
  const { toast, streams } = useOffice();
  const [data, setData] = useState<{ automations: Automation[]; log: AutomationLog[]; hookBase: string | null } | null>(null);
  const [status, setStatus] = useState<{ running: boolean; url: string } | null>(null);
  const [form, setForm] = useState({ name: '', url: '', description: '', trigger: 'manual' as Automation['trigger'] });
  const [busy, setBusy] = useState('');
  const load = () => api.automations().then(setData).catch(() => {});
  useEffect(() => {
    load();
    api.n8nStatus().then(setStatus).catch(() => {});
  }, []);

  async function add() {
    try {
      await api.createAutomation(form);
      setForm({ name: '', url: '', description: '', trigger: 'manual' });
      load();
      toast('⚡ Automatización guardada');
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    }
  }

  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('📋 Copiado'));

  return (
    <section className="card">
      <div className="row between">
        <h3>🔁 n8n</h3>
        <span className={`pill ${status?.running ? 'pill--done' : ''}`}>{status?.running ? '● n8n funcionando' : '○ n8n no está abierto'}</span>
      </div>
      <p className="muted small">n8n es gratis y corre en tu computador. Con él puedes, por ejemplo, pedirle al equipo un resumen cada lunes, convertir correos o mensajes de WhatsApp en tareas o tarjetas, y guardar resultados en Google Sheets.</p>
      {!status?.running && (
        <ol className="steps">
          <li><b>Instala n8n</b> (una sola vez): <button className="btn btn--ghost small" disabled={busy === 'install'} onClick={async () => { setBusy('install'); try { const r = await api.n8nInstall(); toast(r.ok ? '✅ n8n instalado' : '⚠️ No terminó la instalación'); } finally { setBusy(''); } }}>{busy === 'install' ? 'Instalando…' : 'Instalar con un clic'}</button>{streams['install:n8n'] && <pre className="log">{streams['install:n8n'].slice(-1500)}</pre>}</li>
          <li><b>Ábrelo:</b> <button className="btn btn--ghost small" onClick={async () => { const r = await api.n8nStart(); toast(r.opened ? '🪟 Se abrió n8n en una terminal: espera unos segundos' : `Ejecuta en una terminal: ${r.command}`); setTimeout(() => api.n8nStatus().then(setStatus), 8000); }}>Iniciar n8n</button> y entra a <a href="http://localhost:5678" target="_blank" rel="noreferrer">localhost:5678</a>.</li>
        </ol>
      )}
      {status?.running && <p className="small"><a className="btn btn--ghost small" href={status.url} target="_blank" rel="noreferrer">Abrir n8n ↗</a></p>}

      <h4>De n8n a la oficina</h4>
      <p className="muted small">En n8n usa un nodo <b>HTTP Request</b> (método POST, cuerpo JSON) con estas direcciones. Si n8n corre en Docker, cambia <code>localhost</code> por <code>host.docker.internal</code>. No compartas estas direcciones: llevan tu clave.</p>
      {data?.hookBase ? (
        <table className="hook-table">
          <tbody>
            {[
              ['Pedir una tarea', 'tarea', '{"tarea": "Resume las ventas de la semana", "esperar": true}'],
              ['Crear una nota', 'nota', '{"titulo": "Pedido nuevo", "contenido": "…", "nucleo": "miguel"}'],
              ['Crear una tarjeta', 'tarjeta', '{"titulo": "Imprimir 3 soportes", "proyecto": "Taller"}'],
            ].map(([label, path, body]) => (
              <tr key={path}>
                <td><b>{label}</b><br /><code className="small">{body}</code></td>
                <td><code className="copy small">{`${data.hookBase}/${path}`}</code> <button className="link" onClick={() => copy(`${data.hookBase}/${path}`)}>copiar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted small">Las direcciones solo se ven desde el computador de la oficina.</p>}

      <h4>De la oficina a n8n</h4>
      <p className="muted small">En n8n crea un flujo que empiece con un nodo <b>Webhook</b> y pega aquí su URL de producción. Se puede activar a mano, al terminar cada tarea, o cuando una IA lo pida (te pregunta la primera vez).</p>
      <div className="grid2">
        <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Enviar por WhatsApp" /></label>
        <label>URL del webhook<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://localhost:5678/webhook/…" /></label>
        <label>Para qué sirve (lo leen las IAs)<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Envía el texto por WhatsApp a Miguel" /></label>
        <label>Cuándo se activa
          <select value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value as Automation['trigger'] })}>
            <option value="manual">A mano o cuando una IA lo pida</option>
            <option value="tarea">Cada vez que termina una tarea</option>
          </select>
        </label>
      </div>
      <button className="btn btn--primary small" disabled={!form.url.trim()} onClick={add}>＋ Agregar automatización</button>

      <ul className="auto-list">
        {data?.automations.map((a) => (
          <li key={a.id}>
            <div>
              <b>{a.name}</b> <span className="pill">{a.trigger === 'tarea' ? 'al terminar tareas' : 'manual'}</span>{a.allowAI && <span className="pill pill--done" title="Las IAs la pueden activar sin preguntar">IAs sin preguntar</span>}
              <div className="small muted">{a.description} · <code>{a.url}</code></div>
            </div>
            <div className="row">
              <button className="btn btn--ghost small" onClick={async () => { const r = await api.runAutomation(a.id, { prueba: true, texto: 'Hola desde la Oficina de IAs' }); toast(r.ok ? `✅ n8n respondió (${r.status})` : `❌ Falló: ${r.respuesta.slice(0, 80)}`); load(); }}>Probar</button>
              {a.allowAI && <button className="link" onClick={async () => { await api.updateAutomation(a.id, { allowAI: false }); load(); }}>volver a preguntar</button>}
              <button className="link" onClick={async () => { await api.deleteAutomation(a.id); load(); }}>quitar</button>
            </div>
          </li>
        ))}
      </ul>
      {data?.log.length ? (
        <details>
          <summary className="small">Historial ({data.log.length})</summary>
          <ul className="auto-log">
            {data.log.map((l) => <li key={l.id} className="small"><span className={l.ok ? 'ok' : 'danger'}>{l.ok ? '✔' : '✗'}</span> {new Date(l.at).toLocaleString()} · <b>{l.name}</b> · {l.origen} · {l.status || 'sin respuesta'} <span className="muted">{l.respuesta.slice(0, 80)}</span></li>)}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ClaudeDesktopSection() {
  const { toast } = useOffice();
  const [info, setInfo] = useState<{ configPath: string; installed: boolean; config: unknown } | null>(null);
  const [error, setError] = useState('');
  const load = () => api.claudeDesktop().then(setInfo).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="card">
      <div className="row between">
        <h3>🤖 Claude Desktop</h3>
        {info && <span className={`pill ${info.installed ? 'pill--done' : ''}`}>{info.installed ? '● Instalada' : '○ Sin instalar'}</span>}
      </div>
      <p className="muted small">Con esta extensión, desde Claude Desktop puedes pedirle tareas a la oficina, hablar con una IA («pregúntale a Blendi…»), buscar y crear notas, preguntarle a un núcleo, crear modelos 3D y ver o controlar tu impresora.</p>
      {error && <p className="muted small">{error}</p>}
      {info && (
        <>
          <ol className="steps">
            <li><b>Instala la extensión:</b> <button className="btn btn--primary small" onClick={async () => { try { const r = await api.installClaudeDesktop(); toast(`✅ Instalada en ${r.configPath}`); load(); } catch (err) { toast(`❌ ${(err as Error).message}`); } }}>{info.installed ? 'Reinstalar' : 'Instalar en Claude Desktop'}</button></li>
            <li><b>Cierra Claude Desktop por completo</b> (también desde la bandeja del sistema) y ábrelo otra vez.</li>
            <li>En un chat nuevo pide, por ejemplo: <i>«Usa la oficina para diseñar un soporte para celular y ábrelo en OpenSCAD»</i>. La oficina tiene que estar abierta.</li>
          </ol>
          <details>
            <summary className="small">Configuración manual</summary>
            <p className="small muted">Si prefieres hacerlo a mano, agrega esto en <code>{info.configPath}</code>:</p>
            <pre className="log">{JSON.stringify(info.config, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
