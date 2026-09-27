// Blender en vivo: instalar el complemento (con ayuda de Claude), ver si está
// conectado, ver la escena y pedirle a una IA que modele en tu Blender abierto.
import { useEffect, useState } from 'react';
import { api, type BlenderStatus } from '../api';
import { Assistant } from './ConnectCenter';
import { Markdown } from './Markdown';
import { useOffice } from '../state';

export function BlenderLive() {
  const { agents, toast, streams, blenderVersion } = useOffice();
  const [st, setSt] = useState<BlenderStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [help, setHelp] = useState(false);
  const [scene, setScene] = useState('');
  const [captures, setCaptures] = useState<string[]>([]);
  const [who, setWho] = useState('cerebro');
  const [ask, setAsk] = useState('');
  const [reply, setReply] = useState('');
  const helpers = agents.filter((a) => a.isBrain || a.id === 'blender-3d');

  const refresh = async () => {
    const s = await api.blenderStatus().catch(() => null);
    setSt(s);
    if (s?.connected) api.blenderScene().then((r) => setScene(r.texto)).catch(() => setScene(''));
    api.blenderCaptures().then(setCaptures).catch(() => {});
  };
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (blenderVersion) refresh();
  }, [blenderVersion]);

  async function install() {
    setBusy('install');
    try {
      const r = await api.blenderInstall();
      toast(r.ok ? '✅ Complemento instalado. Si Blender estaba abierto, ciérralo y ábrelo otra vez.' : '⚠️ No se pudo instalar: revisa el registro');
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    } finally {
      setBusy('');
      refresh();
    }
  }

  async function send() {
    if (!ask.trim()) return;
    setBusy('ask');
    setReply('');
    try {
      const r = await api.sendChat(who, `${ask.trim()}\n\n(Trabaja en mi Blender abierto, paso a paso, y revisa la escena después de cada paso.)`);
      setReply(r.reply);
      setAsk('');
    } catch (err) {
      toast(`❌ ${(err as Error).message}`);
    } finally {
      setBusy('');
      refresh();
    }
  }

  const connected = Boolean(st?.connected);
  const log = streams['install:blender'];
  const live = streams[`chat:${who}`];

  return (
    <section className="card blender-live">
      <div className="row between">
        <h3>🧊 Blender en vivo</h3>
        <span className={`pill ${connected ? 'pill--done' : ''}`}>{connected ? `● Conectado · Blender ${st?.version}` : '○ Sin conectar'}</span>
      </div>
      <p className="muted small">Con el complemento «Oficina de IAs», Claude y Blendi modelan directamente en el Blender que tienes abierto: crean objetos, revisan cómo quedaron y corrigen paso a paso. Antes de tocar tu escena te piden permiso.</p>

      {!connected && (
        <ol className="steps">
          <li>
            <b>Blender:</b> {st?.blenderPath ? <span className="ok">instalado ✓</span> : <>no lo encuentro. <a href="https://www.blender.org/download/" target="_blank" rel="noreferrer">Descárgalo gratis ↗</a></>}
          </li>
          <li>
            <b>Instala el complemento:</b>{' '}
            <button className="btn btn--primary small" disabled={!st?.blenderPath || busy === 'install'} onClick={install}>{busy === 'install' ? 'Instalando…' : 'Instalar con un clic'}</button>{' '}
            <a className="btn btn--ghost small" href="/api/blender/addon">⬇️ Descargar para instalar a mano</a>
            {log && <pre className="log">{log}</pre>}
          </li>
          <li><b>Abre Blender</b> (o ciérralo y ábrelo otra vez). En la vista 3D pulsa <kbd>N</kbd>: en la pestaña <b>Oficina</b> debe decir «Conectado».</li>
          <li>
            <button className="btn btn--ghost small" onClick={refresh}>🔌 Comprobar conexión</button>{' '}
            <button className={`btn small ${help ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setHelp((h) => !h)}>💬 Que Claude me ayude a instalarlo</button>
          </li>
        </ol>
      )}
      {help && !connected && <Assistant starters={['Ayúdame a instalar el complemento de Blender', 'No me aparece la pestaña Oficina en Blender', '¿Dónde descargo Blender?']} refresh={refresh} />}

      {connected && (
        <>
          <div className="blender-grid">
            <div>
              <b className="small">Escena</b>
              <pre className="log">{scene || 'Cargando…'}</pre>
            </div>
            <div>
              <div className="row between">
                <b className="small">Cómo va</b>
                <button className="btn btn--ghost small" disabled={busy === 'shot'} onClick={async () => {
                  setBusy('shot');
                  try {
                    await api.blenderCapture();
                    await refresh();
                  } catch (err) {
                    toast(`❌ ${(err as Error).message}`);
                  } finally {
                    setBusy('');
                  }
                }}>📸 Ver ahora</button>
              </div>
              {captures[0] ? <img className="blender-shot" src={`/api/blender/capturas/${captures[0]}`} alt="Vista 3D de Blender" /> : <p className="muted small">Pulsa «Ver ahora» para ver tu vista 3D.</p>}
            </div>
          </div>
          <div className="row">
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Quién trabaja">
              {helpers.map((a) => <option key={a.id} value={a.id}>{a.name}{a.live ? '' : ' (demo)'}</option>)}
            </select>
            <input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Ej.: crea un soporte para celular de 8 cm con bordes redondeados" />
            <button className="btn btn--primary small" disabled={!ask.trim() || busy === 'ask'} onClick={send}>{busy === 'ask' ? 'Trabajando…' : 'Modelar en Blender'}</button>
          </div>
          {(reply || (busy === 'ask' && live)) && <div className="blender-reply"><Markdown text={reply || live || ''} /></div>}
          {agents.find((a) => a.id === who && !a.live) && <p className="muted small">⚠️ Esa IA está en modo demo: conéctala (por ejemplo Claude con Claude Code) para que modele de verdad.</p>}
        </>
      )}
    </section>
  );
}
