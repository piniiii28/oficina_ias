// Mi impresora Bambu Lab (P1S): estado en vivo, cámara y controles por la red local.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useOffice } from '../state';

export function PrinterPanel() {
  const { printer, toast } = useOffice();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: 'Mi P1S', host: '', serial: '', accessCode: '' });
  const [cam, setCam] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState('');

  useEffect(() => {
    if (printer?.configured) setForm((f) => ({ ...f, name: printer.name, host: printer.host, serial: printer.serial }));
  }, [printer?.configured]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cámara: una foto cada 3 s mientras está encendida.
  useEffect(() => {
    if (!camOn) return;
    let stop = false;
    let url: string | null = null;
    const grab = async () => {
      try {
        const r = await fetch(`/api/printer/camera.jpg?t=${Date.now()}`);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'La cámara no respondió');
        const next = URL.createObjectURL(await r.blob());
        if (url) URL.revokeObjectURL(url);
        url = next;
        if (!stop) setCam(next);
        setCamError('');
      } catch (err) {
        setCamError((err as Error).message);
      }
      if (!stop) setTimeout(grab, 3000);
    };
    grab();
    return () => {
      stop = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [camOn]);

  async function save() {
    try {
      await api.savePrinter(form);
      setEditing(false);
      setForm({ ...form, accessCode: '' });
      toast('🖨️ Conectando con la impresora…');
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    }
  }

  async function command(c: string) {
    if (c === 'detener' && !confirm('¿Detener la impresión? No se puede reanudar después.')) return;
    try {
      const r = await api.printerCommand(c);
      toast(r.message);
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    }
  }

  const p = printer;
  const s = p?.state;
  const connected = Boolean(p?.connected);
  const setup = !p?.configured || editing;

  return (
    <section className="card printer-panel">
      <div className="row between">
        <h3>🖨️ {p?.configured ? p.name : 'Mi impresora Bambu Lab'}</h3>
        {p?.configured && <span className={`pill ${p.connected ? 'pill--done' : 'pill--error'}`}>{p.connected ? `● Conectada · ${s?.estado || '…'}` : '○ Sin conexión'}</span>}
      </div>
      {setup ? (
        <>
          <p className="muted small">La oficina se conecta a tu P1S por la red local (sin la nube de Bambu). La impresora y este computador deben estar en la misma red Wi-Fi.</p>
          <ol className="steps small">
            <li>En la pantalla de la impresora: <b>Configuración → WLAN</b>: anota la <b>IP</b> y el <b>código de acceso</b>.</li>
            <li>Activa el <b>modo solo LAN</b> y el <b>modo desarrollador</b> (en el firmware actual, sin eso Bambu no deja que otros programas la controlen). Mientras esté en modo LAN, Bambu Handy no la verá desde fuera de casa.</li>
            <li>Para la cámara, activa <b>LAN Mode Liveview</b>.</li>
            <li>El <b>número de serie</b> está en Configuración → Dispositivo, o en Bambu Studio → Dispositivo.</li>
          </ol>
          <div className="grid2">
            <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>IP de la impresora<input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="192.168.1.50" /></label>
            <label>Número de serie<input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} placeholder="01P00A…" /></label>
            <label>Código de acceso LAN<input type="password" value={form.accessCode} onChange={(e) => setForm({ ...form, accessCode: e.target.value })} placeholder={p?.accessPreview ? `guardado (${p.accessPreview})` : '8 caracteres'} /></label>
          </div>
          <div className="row">
            <button className="btn btn--primary small" disabled={!form.host || !form.serial || (!form.accessCode && !p?.accessPreview)} onClick={save}>Guardar y conectar</button>
            {p?.configured && <button className="btn btn--ghost small" onClick={() => setEditing(false)}>Cancelar</button>}
          </div>
        </>
      ) : (
        <>
          {!connected && p?.error && <p className="danger small">{p.error}</p>}
          {s && (
            <div className="printer-grid">
              <div>
                {s.archivo && <p className="small"><b>{s.archivo}</b></p>}
                <div className="progress"><i style={{ width: `${s.progreso ?? 0}%` }} /></div>
                <p className="small">{s.progreso ?? 0} % · capa {s.capa ?? '—'}/{s.capas ?? '—'} · faltan {s.restante ?? '—'} min</p>
                <p className="small">🔥 Boquilla {s.boquilla ?? '—'}/{s.boquillaMeta ?? '—'} °C · 🛏️ Cama {s.cama ?? '—'}/{s.camaMeta ?? '—'} °C</p>
                {s.error && <p className="danger small">⚠️ {s.error}</p>}
                <div className="row">
                  {s.codigo === 'RUNNING' && <button className="btn btn--ghost small" onClick={() => command('pausar')}>⏸️ Pausar</button>}
                  {s.codigo === 'PAUSE' && <button className="btn btn--primary small" onClick={() => command('reanudar')}>▶️ Reanudar</button>}
                  {(s.codigo === 'RUNNING' || s.codigo === 'PAUSE') && <button className="btn btn--ghost small danger" onClick={() => command('detener')}>⏹️ Detener</button>}
                  <button className="btn btn--ghost small" onClick={() => command(s.luz ? 'luz_off' : 'luz_on')}>{s.luz ? '🌑 Apagar luz' : '💡 Encender luz'}</button>
                </div>
              </div>
              <div>
                <div className="row between">
                  <b className="small">Cámara</b>
                  <button className="btn btn--ghost small" onClick={() => setCamOn((v) => !v)}>{camOn ? 'Apagar' : '📷 Ver cámara'}</button>
                </div>
                {camOn && (cam ? <img className="printer-cam" src={cam} alt="Cámara de la impresora" /> : <p className="muted small">{camError || 'Conectando con la cámara…'}</p>)}
                {camOn && camError && cam && <p className="muted small">{camError}</p>}
              </div>
            </div>
          )}
          <p className="muted small">Las IAs (y Claude Desktop) pueden ver el estado; para usar la cámara o dar órdenes te piden permiso, y <b>detener</b> siempre pregunta.</p>
          <div className="row">
            <button className="link" onClick={() => setEditing(true)}>cambiar configuración</button>
            <button className="link" onClick={async () => { if (confirm('¿Quitar la impresora de la oficina?')) { await api.deletePrinter(); location.reload(); } }}>quitar</button>
          </div>
        </>
      )}
    </section>
  );
}
