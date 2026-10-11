// Taller de Impresión 3D: pide un modelo al equipo, ejecútalo en Blender,
// OpenSCAD o FreeCAD de tu computador, míralo en 3D y lamínalo para imprimir.
import { useEffect, useState } from 'react';
import { api, type CadJob, type CadKind } from '../api';
import { Chibi } from '../components/Chibi';
import { Markdown } from '../components/Markdown';
import { StlViewer } from '../components/StlViewer';
import { BlenderLive } from '../components/BlenderLive';
import { PrinterPanel } from '../components/PrinterPanel';
import { useOffice } from '../state';

const APPS: { kind: CadKind; label: string; flow: string; hint: string }[] = [
  { kind: 'openscad', label: 'OpenSCAD', flow: 'pieza3d', hint: 'Piezas con medidas exactas: soportes, cajas, repuestos.' },
  { kind: 'blender', label: 'Blender', flow: 'figura3d', hint: 'Formas libres: figuras, personajes, decoración.' },
  { kind: 'freecad', label: 'FreeCAD', flow: 'mecanica3d', hint: 'Piezas mecánicas con tolerancias y encajes.' },
];

const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);

export function Taller() {
  const { agents, tasks, cadTools, cadVersion, toast, setView, live, reloadAgents } = useOffice();
  const [tools, setTools] = useState<Record<string, string | boolean | null> | null>(null);
  const [ai3d, setAi3d] = useState({ prompt: '', image: '' as string, busy: false });
  const [jobs, setJobs] = useState<CadJob[]>([]);
  const [prompt, setPrompt] = useState('');
  const [app, setApp] = useState<CadKind>('openscad');
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const team = agents.filter((a) => a.department === 'impresion3d');

  useEffect(() => {
    api.cadDetect().then(setTools).catch(() => setTools({}));
  }, []);
  useEffect(() => {
    api.cadJobs().then(setJobs);
  }, [cadVersion]);

  // Tareas del taller: las que hizo alguna IA de impresión 3D.
  const ids = new Set(team.map((a) => a.id));
  const shopTasks = tasks.filter((t) => t.steps.some((s) => ids.has(s.agentId))).slice(0, 5);

  async function ask() {
    if (!prompt.trim()) return;
    const flow = APPS.find((a) => a.kind === app)!.flow;
    await api.runTask(`${prompt.trim()}\n\n(Modelo para ${APPS.find((a) => a.kind === app)!.label}, listo para imprimir en 3D.)`, undefined, undefined, undefined, flow);
    setPrompt('');
    toast('🖨️ El taller está diseñando tu modelo. Cuando termine, ábrelo con un clic.');
  }

  async function run(kind: CadKind, gui: boolean) {
    if (!code.trim()) return;
    setBusy('run');
    try {
      const job = await api.cadRun({ kind, code, name: 'script manual', gui });
      toast(job.ok ? '✅ Modelo listo' : '⚠️ No se generó el STL: revisa el registro');
      setJobs(await api.cadJobs());
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  const missing = tools && APPS.filter((a) => !tools[a.kind]);

  return (
    <div className="taller">
      <header>
        <h2>🖨️ Taller de Impresión 3D</h2>
        <p className="muted">Pide una pieza y el equipo escribe el modelo; la oficina lo abre en el programa de tu computador, genera el STL y te lo muestra aquí.</p>
      </header>

      <section className="card taller-team">
        {team.map((a, i) => (
          <div key={a.id} className="taller-member">
            <Chibi avatar={a.avatar} size={54} seed={i} state={live[a.id]?.status || 'idle'} />
            <div>
              <strong>{a.name}</strong>
              <small>{a.role}</small>
              <small className="muted"><span className={`dot ${a.live ? 'dot--live' : 'dot--demo'}`} /> {a.live ? 'Conectada' : 'Modo demo'} · {a.provider}</small>
            </div>
          </div>
        ))}
        {!team.length && <p className="muted small">No hay IAs del taller. Ve a Equipo → Restaurar plantilla para contratarlas.</p>}
        {team.some((a) => !a.live) && agents.some((a) => a.live && !a.isBrain) && (
          <p className="small taller-demo">
            🎭 {team.filter((a) => !a.live).length} de {team.length} están en modo demo: mientras tanto, las piezas las hacen otras IAs conectadas.{' '}
            <button className="link small" onClick={async () => {
              const r = await api.rescueAgents();
              await reloadAgents();
              toast(r.changed ? `🔁 ${r.changed} IAs pasaron a proveedores conectados` : 'Conecta un proveedor gratis en Ajustes para activarlas');
            }}>🔁 Activarlas con un proveedor gratis</button>
          </p>
        )}
      </section>

      <PrinterPanel />
      <BlenderLive />

      <section className="card">
        <h3>Programas en tu computador</h3>
        {!tools && <p className="muted small">Buscando…</p>}
        {tools && (
          <div className="tool-chips">
            {cadTools.map((t) => (
              <span key={t.id} className={`pill ${tools[t.id] ? 'pill--done' : ''}`} title={typeof tools[t.id] === 'string' ? (tools[t.id] as string) : 'No encontrado'}>
                {tools[t.id] ? '✓' : '✗'} {t.label}
                {!tools[t.id] && <> · <a href={t.url} target="_blank" rel="noreferrer">descargar ↗</a></>}
              </span>
            ))}
          </div>
        )}
        {missing && missing.length > 0 && (
          <p className="muted small">Todos son gratis. Si instalaste alguno en otra carpeta, escribe su ruta en <a href="#" onClick={(e) => { e.preventDefault(); setView('ajustes'); }}>Ajustes → Taller 3D</a>.</p>
        )}
      </section>

      <section className="card">
        <h3>Pide un modelo</h3>
        <div className="app-pick">
          {APPS.map((a) => (
            <button key={a.kind} className={`app-choice ${app === a.kind ? 'on' : ''}`} onClick={() => setApp(a.kind)}>
              <strong>{a.label}</strong>
              <small>{a.hint}</small>
              {tools && !tools[a.kind] && <small className="warn">No instalado</small>}
            </button>
          ))}
        </div>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ej.: un soporte para celular de 8 cm de ancho, inclinado 60°, con hueco para el cable" />
        <div className="row between">
          <button className="btn btn--ghost small" onClick={() => setManual((m) => !m)}>{manual ? 'Ocultar' : '📋 Pegar un script propio'}</button>
          <button className="btn btn--primary" disabled={!prompt.trim()} onClick={ask}>Diseñar con el taller</button>
        </div>
        {manual && (
          <div className="manual-script">
            <textarea rows={8} className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder={'cube([20, 20, 10]);   ← OpenSCAD\no un script de Python con "import bpy" (Blender) o "import FreeCAD"'} />
            <div className="row">
              {APPS.map((a) => (
                <button key={a.kind} className="btn btn--ghost small" disabled={!code.trim() || busy === 'run'} onClick={() => run(a.kind, true)}>▶ Abrir en {a.label}</button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h3>🧊 De texto o imagen a 3D (TRELLIS)</h3>
        <p className="muted small">Para figuras, personajes, animales o decoración: la IA TRELLIS (de Microsoft, en NVIDIA) crea el modelo 3D y lo entrega en STL, listo para laminar. Para piezas con medidas exactas usa «Pide un modelo» con OpenSCAD o FreeCAD.</p>
        {tools && !tools.trellis ? (
          <p className="small warn">Necesita tu clave de NVIDIA: Ajustes → Conectar las IAs → NVIDIA NIM.</p>
        ) : (
          <>
            <div className="row">
              <input className="grow" value={ai3d.prompt} onChange={(e) => setAi3d({ ...ai3d, prompt: e.target.value })} placeholder="Ej.: a cute low-poly fox sitting, single object" />
              <label className="btn btn--ghost small">
                🖼️ {ai3d.image ? 'Imagen lista' : 'Desde una imagen'}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => setAi3d((x) => ({ ...x, image: String(r.result) }));
                  r.readAsDataURL(f);
                }} />
              </label>
              <button className="btn btn--primary small" disabled={ai3d.busy || (!ai3d.image && ai3d.prompt.trim().length < 3)} onClick={async () => {
                setAi3d((x) => ({ ...x, busy: true }));
                try {
                  await api.cadTrellis({ prompt: ai3d.prompt.trim(), image: ai3d.image || undefined });
                  toast('🧊 Modelo 3D listo: míralo abajo en «Modelos creados»');
                  setAi3d({ prompt: '', image: '', busy: false });
                  setJobs(await api.cadJobs());
                } catch (err) {
                  toast(`❌ ${(err as Error).message}`);
                  setAi3d((x) => ({ ...x, busy: false }));
                }
              }}>{ai3d.busy ? 'Creando… (≈1 min)' : '🧊 Crear modelo 3D'}</button>
            </div>
            {ai3d.image && <p className="small">Usará la imagen (el texto es opcional). <button className="link" onClick={() => setAi3d({ ...ai3d, image: '' })}>quitar imagen</button></p>}
            <p className="muted small">Tip: una imagen de un solo objeto, con fondo liso, da el mejor resultado. Escribe en inglés para más precisión.</p>
          </>
        )}
      </section>

      {shopTasks.length > 0 && (
        <section className="card">
          <h3>Diseños del equipo</h3>
          {shopTasks.map((t) => {
            const design = t.steps.find((s) => s.status === 'done' && /```/.test(s.output));
            return (
              <details key={t.id} className="shop-task" open={t === shopTasks[0]}>
                <summary><strong>{t.title}</strong> <span className={`pill pill--${t.status}`}>{t.status === 'done' ? 'listo' : t.status === 'error' ? 'error' : 'diseñando…'}</span></summary>
                {design ? <Markdown text={design.output} cadName={t.title} /> : <p className="muted small">{t.status === 'done' ? 'El diseño no trae un script. Pide que lo escriba en OpenSCAD, Blender o FreeCAD.' : 'El equipo está trabajando…'}</p>}
                {t.steps.filter((s) => s !== design && s.status === 'done').map((s) => (
                  <details key={s.agentId}><summary className="small">Revisión de {agents.find((a) => a.id === s.agentId)?.name}</summary><Markdown text={s.output} /></details>
                ))}
              </details>
            );
          })}
        </section>
      )}

      <section className="card">
        <h3>Modelos creados</h3>
        {!jobs.length && <p className="muted small">Aún no hay modelos. Cuando el equipo entregue un script, pulsa «Abrir en…» o «Crear STL».</p>}
        <div className="jobs">
          {jobs.map((j) => {
            const stl = j.files.find((f) => f.name.toLowerCase().endsWith('.stl'));
            return (
              <article key={j.id} className={`job ${j.ok ? '' : 'job--error'}`}>
                <header className="row between">
                  <div>
                    <strong>{j.name}</strong>
                    <small className="muted"> · {(j.kind === 'trellis' ? 'TRELLIS (IA)' : APPS.find((a) => a.kind === j.kind)?.label)} · {new Date(j.createdAt).toLocaleString()}</small>
                  </div>
                  <span className={`pill ${j.ok ? 'pill--done' : 'pill--error'}`}>{j.ok ? 'STL listo' : 'sin STL'}</span>
                </header>
                {stl && <StlViewer url={`/api/cad/jobs/${j.id}/files/${encodeURIComponent(stl.name)}`} />}
                <div className="files">
                  {j.files.map((f) => <a key={f.name} className="pill" href={`/api/cad/jobs/${j.id}/files/${encodeURIComponent(f.name)}`} download>⬇️ {f.name} <small>({size(f.size)})</small></a>)}
                </div>
                <div className="row">
                  <button className="btn btn--ghost small" onClick={() => api.cadOpen(j.id, 'app').catch((e) => toast(`❌ ${e.message}`))}>🪟 Abrir en {j.kind === 'trellis' ? 'tu programa de STL' : APPS.find((a) => a.kind === j.kind)?.label}</button>
                  <button className="btn btn--ghost small" onClick={() => api.cadOpen(j.id, 'folder').catch((e) => toast(`❌ ${e.message}`))}>📁 Carpeta</button>
                  {stl && <button className="btn btn--ghost small" title="Para laminarlo y mandarlo a tu Bambu Lab" onClick={() => api.cadOpen(j.id, 'bambu').catch((e) => toast(`❌ ${e.message}. Instala Bambu Studio.`))}>🟩 Bambu Studio</button>}
                  {stl && (
                    <button className="btn btn--ghost small" disabled={busy === j.id} onClick={async () => {
                      setBusy(j.id);
                      try {
                        const r = await api.cadSlice(j.id);
                        toast(r.ok ? '✅ G-code listo' : '⚠️ El laminador no terminó: revisa el registro');
                        setJobs(await api.cadJobs());
                      } catch (err) {
                        toast(`❌ ${(err as Error).message}`);
                      } finally {
                        setBusy('');
                      }
                    }}>{busy === j.id ? 'Laminando…' : '🧅 Laminar (G-code)'}</button>
                  )}
                  <button className="btn btn--ghost small" onClick={async () => { await api.cadDelete(j.id); setJobs(await api.cadJobs()); }}>Quitar</button>
                </div>
                <details><summary className="small muted">Registro y script</summary><pre className="log">{j.log}</pre><pre className="log">{j.code}</pre></details>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
