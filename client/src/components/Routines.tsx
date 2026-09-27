// Rutinas: tareas programadas que el cerebro ejecuta solo.
import { useEffect, useState } from 'react';
import { useOffice } from '../state';

type Routine = { id: string; prompt: string; time: string; days: number[]; enabled: boolean; lastRun: string | null };
const DAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

export function Routines() {
  const { toast } = useOffice();
  const [list, setList] = useState<Routine[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ prompt: '', time: '07:00', days: [1, 2, 3, 4, 5] });
  const load = () => call<Routine[]>('GET', '/api/routines').then(setList);
  useEffect(() => { load(); }, []);

  return (
    <section className="routines">
      <button className="routines-head" onClick={() => setOpen((o) => !o)}>
        ⏰ Rutinas automáticas <span className="muted small">({list.filter((r) => r.enabled).length} activas)</span> <span className="muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="stack">
          <p className="muted small">El cerebro las ejecuta solo a esa hora mientras la oficina esté encendida. El resultado queda en Tareas y en tus notas.</p>
          {list.map((r) => (
            <div key={r.id} className="routine">
              <label className="check">
                <input type="checkbox" checked={r.enabled} onChange={async (e) => { await call('PUT', `/api/routines/${r.id}`, { enabled: e.target.checked }); load(); }} />
                <strong>{r.time}</strong> <small className="muted">{r.days.map((d) => DAYS[d]).join(' ')}</small>
              </label>
              <p className="small">{r.prompt}</p>
              <div className="row">
                <button className="link" onClick={async () => { await call('POST', `/api/routines/${r.id}/run`); toast('▶️ Rutina en marcha'); }}>Ejecutar ahora</button>
                <button className="link danger" onClick={async () => { await call('DELETE', `/api/routines/${r.id}`); load(); }}>Borrar</button>
              </div>
            </div>
          ))}
          <textarea rows={2} value={form.prompt} placeholder="Ej.: Resume las novedades de IA de ayer y propón 3 ideas para mi proyecto" onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          <div className="row">
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} style={{ width: 'auto' }} />
            <div className="days">
              {DAYS.map((d, i) => (
                <button key={i} className={form.days.includes(i) ? 'on' : ''} onClick={() => setForm({ ...form, days: form.days.includes(i) ? form.days.filter((x) => x !== i) : [...form.days, i] })}>{d}</button>
              ))}
            </div>
          </div>
          <button className="btn btn--primary small" disabled={!form.prompt.trim() || !form.days.length} onClick={async () => {
            await call('POST', '/api/routines', form);
            setForm({ ...form, prompt: '' });
            load();
            toast('⏰ Rutina creada');
          }}>Crear rutina</button>
        </div>
      )}
    </section>
  );
}
