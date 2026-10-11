// Directorio del equipo: ver todas las IAs, contratar nuevas y restaurar la plantilla.
import { useState } from 'react';
import { api, TIER_LABEL, type Agent } from '../api';
import { Chibi, ACCESSORIES, HAIR_STYLES, EYE_STYLES } from '../components/Chibi';
import { AgentPanel } from '../components/AgentPanel';
import { Meters } from '../components/Meters';
import { Stats } from '../components/Stats';
import { CATALOG } from '../catalog';
import { AchievementsPanel } from '../components/Achievements';
import { useOffice } from '../state';
import { clock, errorHelp } from '../errorHelp';

const COLORS = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee', '#f87171'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function randomAvatar(): Agent['avatar'] {
  return {
    skin: pick(['#fde7d6', '#f6d7c3', '#f1c7a5', '#e0ac69', '#c68642', '#8d5524']),
    hair: pick(['#1f2937', '#78350f', '#f59e0b', '#ec4899', '#6366f1', '#10b981', '#e5e7eb']),
    hairStyle: pick(HAIR_STYLES),
    eyes: pick(EYE_STYLES),
    outfit: pick(COLORS),
    accessory: pick(ACCESSORIES),
    prop: pick(['🤖', '🚀', '🧩', '🔧', '🎯', '🪄', '🧬', '🎵']),
  };
}

export function Agents() {
  const { agents, departments, providers, reloadAgents, toast, live, freeModels, setView } = useOffice();
  const [selected, setSelected] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [form, setForm] = useState({ name: '', role: '', department: 'personas', provider: 'groq', model: 'openai/gpt-oss-120b', skills: '', system: '' });
  const [avatar, setAvatar] = useState(randomAvatar);
  const dept = (id: string) => departments.find((d) => d.id === id);

  async function create() {
    if (!form.name.trim()) return;
    const a = await api.createAgent({
      ...form,
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      system: form.system || `Eres ${form.name}, ${form.role}. Responde en español, de forma concreta y con Markdown.`,
      avatar,
    });
    await reloadAgents();
    setCreating(false);
    setForm({ ...form, name: '', role: '', skills: '', system: '' });
    setAvatar(randomAvatar());
    toast(`🎉 ${a.name} se unió a la oficina`);
  }

  const liveCount = agents.filter((a) => a.live).length;

  return (
    <div className="agents-view">
      <header className="row between">
        <div>
          <h2>El equipo · {agents.length} IAs</h2>
          <p className="muted">{liveCount} conectadas · {agents.length - liveCount} en modo demo</p>
        </div>
        <div className="row">
          <button className="btn btn--ghost" onClick={async () => {
            if (!confirm('¿Restaurar los perfiles originales? Se conservan entrenamiento, memoria y las IAs que creaste.')) return;
            await api.resetAgents();
            reloadAgents();
          }}>Restaurar plantilla</button>
          <label className="btn btn--ghost" title="Importa una IA exportada por otra persona">
            ⬆️ Importar IA
            <input type="file" accept=".json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const data = JSON.parse(await f.text());
                const a = data?.agent;
                if (!data?.oficinaIA || !a?.name) throw new Error('No es una IA exportada de la oficina');
                const created = await api.createAgent({ name: a.name, role: a.role, department: a.department, provider: a.provider, model: a.model, skills: a.skills, system: a.system, avatar: a.avatar });
                for (const k of (a.knowledge || []).slice(0, 50)) await api.addKnowledge(created.id, { title: String(k.title || 'Lección'), content: String(k.content || '') });
                await reloadAgents();
                toast(`🎉 ${a.name} se unió con ${(a.knowledge || []).length} lecciones`);
              } catch (err) {
                toast(`No se pudo importar: ${(err as Error).message}`);
              }
            }} />
          </label>
          <button className="btn btn--ghost" onClick={() => setView('ajustes')} title="Conecta proveedores gratis o tus suscripciones">🔌 Conectar IAs</button>
          <button className="btn btn--ghost" onClick={() => setBrowsing((c) => !c)}>📇 Catálogo</button>
          <button className="btn btn--primary" onClick={() => setCreating((c) => !c)}>＋ Crear IA</button>
        </div>
      </header>

      <Stats />
      <AchievementsPanel />

      {browsing && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Catálogo de IAs</h3>
          <p className="muted small">Contrata especialistas extra con un clic. Llegan a su piso del edificio y el cerebro podrá asignarles tareas.</p>
          <div className="agent-cards">
            {CATALOG.map((c, i) => {
              const hired = agents.some((a) => a.name === c.name);
              return (
                <div key={c.name} className="agent-card" style={{ ['--room' as string]: dept(c.department)?.color }}>
                  <Chibi avatar={c.avatar} size={56} seed={i} />
                  <div>
                    <strong>{c.name}</strong>
                    <small>{c.role}</small>
                    <small className="muted">{dept(c.department)?.emoji} {dept(c.department)?.name} · {c.provider}</small>
                    <button className="btn btn--primary small" disabled={hired} onClick={async () => {
                      await api.createAgent(c);
                      await reloadAgents();
                      toast(`🎉 ${c.name} se unió a la oficina`);
                    }}>{hired ? 'Ya trabaja aquí' : 'Contratar'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {creating && (
        <section className="card new-agent">
          <div className="avatar-editor">
            <div className="center">
              <Chibi avatar={avatar} size={100} legs />
              <button className="btn btn--ghost small" onClick={() => setAvatar(randomAvatar())}>🎲 Otro avatar</button>
            </div>
            <div className="grid2">
              <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Chef Bot" /></label>
              <label>Rol<input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Ej.: Experto en recetas" /></label>
              <label>Departamento
                <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                  {departments.filter((d) => d.id !== 'direccion').map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
                </select>
              </label>
              <label>Proveedor
                <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value, model: freeModels[e.target.value]?.[0]?.id || '' })}>
                  {(['gratis', 'mixto', 'suscripcion', 'pago'] as const).map((t) => (
                    <optgroup key={t} label={TIER_LABEL[t]}>
                      {providers.filter((p) => p.tier === t).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </optgroup>
                  ))}
                </select>
                <small className="muted">{providers.find((p) => p.id === form.provider)?.hint}</small>
              </label>
              <label>Modelo
                <input list="nuevo-modelos" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={providers.find((p) => p.id === form.provider)?.cli ? 'lo elige la herramienta' : 'id del modelo'} />
                <datalist id="nuevo-modelos">{(freeModels[form.provider] || []).map((m) => <option key={m.id} value={m.id}>{m.label} (gratis · {m.for})</option>)}</datalist>
              </label>
              <label>Habilidades<input value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="cocina, recetas, nutrición" /></label>
            </div>
          </div>
          <label>Instrucciones (opcional)<textarea rows={3} value={form.system} onChange={(e) => setForm({ ...form, system: e.target.value })} /></label>
          <button className="btn btn--primary" onClick={create} disabled={!form.name.trim()}>Contratar</button>
        </section>
      )}

      <div className="row">
        <input className="search" placeholder="Buscar por nombre, rol, habilidad o modelo…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="type-filter" style={{ flex: 1 }}>
          <button className={!deptFilter ? 'on' : ''} onClick={() => setDeptFilter('')}>Todos</button>
          {departments.map((d) => <button key={d.id} className={deptFilter === d.id ? 'on' : ''} onClick={() => setDeptFilter(d.id)} title={d.name}>{d.emoji}</button>)}
        </div>
      </div>
      <div className="agent-cards">
        {agents.filter((a) => (!deptFilter || a.department === deptFilter) && (!q.trim() || `${a.name} ${a.role} ${a.skills.join(' ')} ${a.model} ${a.provider}`.toLowerCase().includes(q.trim().toLowerCase()))).map((a, i) => (
          <button key={a.id} className={`agent-card ${a.enabled ? '' : 'off'}`} onClick={() => setSelected(a)} style={{ ['--room' as string]: dept(a.department)?.color }}>
            <Chibi avatar={a.avatar} size={70} seed={i} state={live[a.id]?.status || 'idle'} />
            <div>
              <strong>{a.name}{a.isHead && <span title="Jefe de departamento"> 👑</span>}</strong>
              <small>{a.role}{a.assistants?.length ? ` · 👥 ${a.assistants.map((x) => x.focus).join(', ')}` : ''}</small>
              <small className="muted"><span className={`dot ${a.live ? 'dot--live' : 'dot--demo'}`} /> {a.provider} · {a.model}</small>
              {a.live && a.health?.ok === false && (a.health.quota
                ? <small className="warn" title={a.health.error}>⏳ Sin cupo: descansa{a.health.until ? ` hasta las ${clock(a.health.until)}` : ''} y luego vuelve sola</small>
                : <small className="danger" title={a.health.error}>{errorHelp(a.health.kind, a.health.error || '').icon} Con fallas ({errorHelp(a.health.kind, a.health.error || '').title.toLowerCase()}): no recibe trabajo hasta que vuelva a responder</small>)}
              <Meters agentId={a.id} />
              <small className="muted">{dept(a.department)?.emoji} {dept(a.department)?.name} · {a.stats?.tasks || 0} {a.stats?.tasks === 1 ? 'trabajo' : 'trabajos'} · {a.knowledge?.length || 0} {a.knowledge?.length === 1 ? 'lección' : 'lecciones'}</small>
            </div>
          </button>
        ))}
      </div>
      {selected && <AgentPanel agent={agents.find((a) => a.id === selected.id) || selected} onClose={() => setSelected(null)} status="" />}
    </div>
  );
}
