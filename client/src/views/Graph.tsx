// Grafo de conocimiento estilo Obsidian: física de fuerzas en canvas,
// zoom, arrastre, resaltado de vecinos, búsqueda y grafo local.
import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { api, type Bridge, type GraphLink, type GraphNode, type HubInfo, type Note, type Suggestion } from '../api';
import { Chibi } from '../components/Chibi';
import { Markdown } from '../components/Markdown';
import { useOffice } from '../state';
import { TYPE_META } from './Notes';

type N = GraphNode & SimulationNodeDatum & { degree: number };
type Kind = GraphLink['kind'] | 'bridge';
type L = SimulationLinkDatum<N> & { kind: Kind; label?: string };

const KIND_COLOR = { tag: '#2dd4bf', ghost: '#52525b', agent: '#c084fc' };

function colorOf(n: N) {
  if (n.kind === 'note') return TYPE_META[n.type || 'nota']?.color || '#94a3b8';
  if (n.kind === 'hub') return n.color || '#c084fc';
  return KIND_COLOR[n.kind];
}

export function Graph() {
  const { notesVersion, openNote, agents, live, toast } = useOffice();
  const [sugg, setSugg] = useState<{ list: Suggestion[]; chosen: Set<number>; by: string } | null>(null);
  const [finding, setFinding] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{ nodes: GraphNode[]; links: (Omit<GraphLink, 'kind'> & { kind: Kind; label?: string })[] }>({ nodes: [], links: [] });
  const [hubInfo, setHubInfo] = useState<{ hubs: HubInfo[]; bridges: Bridge[] }>({ hubs: [], bridges: [] });
  const [hubFilter, setHubFilter] = useState('');
  const [hubPanel, setHubPanel] = useState<string | null>(null);
  const [opts, setOpts] = useState({ tags: true, agents: true, ghosts: true, labels: true, contrib: true });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Note | null>(null);
  const [depth, setDepth] = useState(0); // 0 = grafo global
  const [until, setUntil] = useState<number | null>(null); // línea de tiempo (null = todo)
  const [playing, setPlaying] = useState(false);
  const times = useMemo(() => data.nodes.filter((n) => n.createdAt).map((n) => Date.parse(n.createdAt!)).sort((a, b) => a - b), [data]);
  useEffect(() => {
    if (!playing || times.length < 2) return;
    let k = 0;
    const id = window.setInterval(() => {
      k++;
      if (k >= times.length) {
        setUntil(null);
        setPlaying(false);
      } else setUntil(times[k]);
    }, 450);
    setUntil(times[0]);
    return () => clearInterval(id);
  }, [playing, times]);
  const state = useRef({ k: 1, x: 0, y: 0, hover: null as N | null, drag: null as N | null, panning: false, moved: false, lx: 0, ly: 0 });
  const simRef = useRef<Simulation<N, L> | null>(null);
  // Valores que cambian seguido se leen por ref para no reiniciar la física.
  const view = useRef({ selected, query, labels: opts.labels, redraw: () => {}, fit: () => {} });
  view.current.selected = selected;
  view.current.query = query;
  view.current.labels = opts.labels;
  useEffect(() => view.current.redraw(), [selected, query, opts.labels]);

  useEffect(() => {
    Promise.all([api.graph({ tags: opts.tags, agents: opts.agents }), api.hubs()]).then(([g, h]) => {
      setHubInfo(h);
      // Puentes entre núcleos que comparten temas.
      const bridges = h.bridges.map((b) => ({ source: `hub:${b.a}`, target: `hub:${b.b}`, kind: 'bridge' as const, label: b.shared.slice(0, 3).join(', ') }));
      setData({ nodes: g.nodes, links: [...g.links, ...bridges] });
    });
  }, [notesVersion, opts.tags, opts.agents]);

  // Filtrado: fantasmas y grafo local.
  const center = depth > 0 ? selected : null;
  const graph = useMemo(() => {
    let nodes = data.nodes.filter((n) => (opts.ghosts || n.kind !== 'ghost') && (opts.contrib || n.type !== 'aporte'));
    if (until !== null) {
      // Solo notas creadas hasta ese momento (y lo que cuelga de ellas).
      const visibleNotes = new Set(nodes.filter((n) => n.kind === 'note' && Date.parse(n.createdAt || '0') <= until).map((n) => n.id));
      const attached = new Set<string>();
      for (const l of data.links) {
        if (visibleNotes.has(l.source)) attached.add(l.target);
        if (visibleNotes.has(l.target)) attached.add(l.source);
      }
      nodes = nodes.filter((n) => (n.kind === 'note' ? visibleNotes.has(n.id) : attached.has(n.id)));
    }
    // Un solo núcleo: sus notas, lo que cuelga de ellas y los núcleos con los que comparte temas.
    if (hubFilter) {
      const mine = new Set(nodes.filter((n) => (n.kind === 'note' && (n.hub || 'cerebro') === hubFilter) || n.id === `hub:${hubFilter}`).map((n) => n.id));
      const keep = new Set(mine);
      for (const l of data.links) {
        if (mine.has(l.source)) keep.add(l.target);
        if (mine.has(l.target) && l.kind !== 'hub') keep.add(l.source);
      }
      nodes = nodes.filter((n) => keep.has(n.id));
    }
    let ids = new Set(nodes.map((n) => n.id));
    let links = data.links.filter((l) => ids.has(l.source) && ids.has(l.target));
    if (depth > 0 && center && ids.has(center)) {
      const keep = new Set([center]);
      for (let d = 0; d < depth; d++) {
        for (const l of links) {
          if (keep.has(l.source)) keep.add(l.target);
          if (keep.has(l.target)) keep.add(l.source);
        }
      }
      nodes = nodes.filter((n) => keep.has(n.id));
      ids = keep;
      links = links.filter((l) => ids.has(l.source) && ids.has(l.target));
    }
    const deg = new Map<string, number>();
    for (const l of links) {
      deg.set(l.source, (deg.get(l.source) || 0) + 1);
      deg.set(l.target, (deg.get(l.target) || 0) + 1);
    }
    return { nodes, links, deg };
  }, [data, opts.ghosts, opts.contrib, depth, center, until, hubFilter]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of graph.links) {
      (m.get(l.source) || m.set(l.source, new Set()).get(l.source)!).add(l.target);
      (m.get(l.target) || m.set(l.target, new Set()).get(l.target)!).add(l.source);
    }
    return m;
  }, [graph]);

  // Simulación + dibujo.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const prev = new Map((simRef.current?.nodes() || []).map((n) => [n.id, n]));
    const nodes: N[] = graph.nodes.map((n) => {
      const p = prev.get(n.id);
      return { ...n, degree: graph.deg.get(n.id) || 0, x: p?.x, y: p?.y, vx: p?.vx, vy: p?.vy };
    });
    const links: L[] = graph.links.map((l) => ({ source: l.source, target: l.target, kind: l.kind, label: l.label }));
    const radius = (n: N) => (n.kind === 'hub' ? 18 : n.kind === 'agent' ? 9 : n.kind === 'tag' ? 4 : 4 + Math.sqrt(n.degree) * 2.2);
    const DIST: Partial<Record<Kind, number>> = { tag: 60, author: 80, hub: 120, bridge: 320 };
    const STRENGTH: Partial<Record<Kind, number>> = { hub: 0.12, bridge: 0.04 };

    const sim = forceSimulation<N, L>(nodes)
      .force('link', forceLink<N, L>(links).id((d) => d.id).distance((l) => DIST[l.kind] ?? 75).strength((l) => STRENGTH[l.kind] ?? 0.4))
      .force('charge', forceManyBody().strength(-260))
      .force('center', forceCenter(0, 0))
      .force('x', forceX(0).strength(0.04))
      .force('y', forceY(0).strength(0.04))
      .force('collide', forceCollide<N>().radius((n) => radius(n) + 3));
    if (prev.size) sim.alpha(0.3);
    simRef.current = sim;

    const st = state.current;
    let dpr = window.devicePixelRatio || 1;
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue('--text').trim() || '#e5e7eb';
    const lineColor = styles.getPropertyValue('--graph-line').trim() || 'rgba(148,163,184,0.25)';

    function draw() {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + st.x, h / 2 + st.y);
      ctx.scale(st.k, st.k);
      const { selected, labels } = view.current;
      const q = view.current.query.trim().toLowerCase();
      const focus = st.hover?.id || selected;
      const near = focus ? neighbors.get(focus) || new Set() : null;

      for (const l of links) {
        const s = l.source as N, t = l.target as N;
        const hot = focus && (s.id === focus || t.id === focus);
        const bridge = l.kind === 'bridge';
        ctx.strokeStyle = hot ? '#c084fc' : bridge ? '#f59e0b' : l.kind === 'hub' ? (s.color || lineColor) : lineColor;
        ctx.globalAlpha = focus && !hot ? 0.25 : l.kind === 'hub' ? 0.35 : 1;
        ctx.lineWidth = (hot ? 1.8 : bridge ? 3 : 1) / Math.sqrt(st.k);
        if (l.kind === 'tag' || bridge) ctx.setLineDash(bridge ? [8, 6] : [3, 3]);
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
        ctx.setLineDash([]);
        // Temas en común, escritos a mitad del puente.
        if (bridge && l.label && labels) {
          ctx.globalAlpha = focus && !hot ? 0.3 : 0.95;
          ctx.font = `${11 / st.k}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#f59e0b';
          ctx.fillText(`🔗 ${l.label}`, (s.x! + t.x!) / 2, (s.y! + t.y!) / 2 - 8 / st.k);
        }
      }
      for (const n of nodes) {
        const r = radius(n);
        const isFocus = n.id === focus;
        const dim = (focus && !isFocus && !near!.has(n.id)) || (q && !n.label.toLowerCase().includes(q));
        ctx.globalAlpha = dim ? 0.18 : 1;
        ctx.fillStyle = colorOf(n);
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx.fill();
        if (isFocus || n.id === selected) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 / st.k;
          ctx.stroke();
        }
        if (n.kind === 'hub') {
          ctx.globalAlpha = dim ? 0.18 : 0.25;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, r + 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = dim ? 0.18 : 1;
          ctx.font = `${r * 1.1}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(n.emoji || '🔵', n.x!, n.y! + 1);
        }
        if (n.kind === 'agent') {
          const a = agents.find((x) => x.id === n.agentId);
          ctx.font = `${r * 1.2}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(a?.avatar.prop || '🤖', n.x!, n.y! + 1);
        }
        const showLabel = labels && (st.k > 1.3 || isFocus || (near && near.has(n.id)) || n.degree > 4 || n.kind === 'agent' || n.kind === 'hub');
        if (showLabel && !dim) {
          ctx.font = n.kind === 'hub' ? `bold ${14 / st.k}px system-ui, sans-serif` : `${11 / st.k}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = textColor;
          const max = isFocus ? 60 : 26;
          const label = n.label.length > max ? n.label.slice(0, max - 1) + '…' : n.label;
          ctx.fillText(label, n.x!, n.y! + r + 3 / st.k);
        }
      }
      ctx.globalAlpha = 1;
    }
    // Encuadra todos los nodos en pantalla.
    function fit() {
      if (!nodes.length) return;
      const xs = nodes.map((n) => n.x!), ys = nodes.map((n) => n.y!);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const k = Math.max(0.2, Math.min(2.2, 0.85 * Math.min(w / (x1 - x0 + 80), h / (y1 - y0 + 80))));
      Object.assign(st, { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k });
      draw();
    }
    let ticks = 0;
    sim.on('tick', () => {
      if (!prev.size && ++ticks === 120) fit();
      draw();
    });
    view.current.redraw = draw;
    view.current.fit = fit;

    const toWorld = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (ev.clientX - rect.left - rect.width / 2 - st.x) / st.k, y: (ev.clientY - rect.top - rect.height / 2 - st.y) / st.k };
    };
    const hit = (ev: MouseEvent) => {
      const p = toWorld(ev);
      let best: N | null = null, bestD = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x! - p.x, n.y! - p.y);
        if (d < radius(n) + 5 / st.k && d < bestD) { best = n; bestD = d; }
      }
      return best;
    };

    const onDown = (ev: MouseEvent) => {
      st.moved = false;
      st.lx = ev.clientX; st.ly = ev.clientY;
      const n = hit(ev);
      if (n) {
        st.drag = n;
        sim.alphaTarget(0.3).restart();
        n.fx = n.x; n.fy = n.y;
      } else st.panning = true;
    };
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - st.lx, dy = ev.clientY - st.ly;
      if (Math.abs(dx) + Math.abs(dy) > 2) st.moved = true;
      if (st.drag) {
        const p = toWorld(ev);
        st.drag.fx = p.x; st.drag.fy = p.y;
      } else if (st.panning) {
        st.x += dx; st.y += dy;
        st.lx = ev.clientX; st.ly = ev.clientY;
        draw();
      } else {
        const n = hit(ev);
        if (n !== st.hover) {
          st.hover = n;
          canvas.style.cursor = n ? 'pointer' : 'grab';
          draw();
        }
      }
    };
    const onUp = (ev: MouseEvent) => {
      if (st.drag) {
        const n = st.drag;
        if (!st.moved) {
          setSelected(n.id);
          if (n.kind === 'hub') setHubPanel(n.hub || null);
        }
        n.fx = null; n.fy = null;
        sim.alphaTarget(0);
      } else if (st.panning && !st.moved && !hit(ev)) setSelected(null);
      st.drag = null; st.panning = false;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left - rect.width / 2, my = ev.clientY - rect.top - rect.height / 2;
      const k2 = Math.max(0.15, Math.min(5, st.k * Math.exp(-ev.deltaY * 0.0015)));
      st.x = mx - ((mx - st.x) * k2) / st.k;
      st.y = my - ((my - st.y) * k2) / st.k;
      st.k = k2;
      draw();
    };
    const onDbl = (ev: MouseEvent) => {
      const n = hit(ev);
      if (n?.kind === 'note') openNote({ id: n.id });
      else if (n?.kind === 'ghost') openNote({ title: n.label });
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);
    resize();
    return () => {
      sim.stop();
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }, [graph, neighbors, agents, openNote]);

  // Vista previa del nodo seleccionado.
  useEffect(() => {
    if (selected && !selected.includes(':')) api.note(selected).then(setPreview).catch(() => setPreview(null));
    else setPreview(null);
  }, [selected, notesVersion]);

  const sel = data.nodes.find((n) => n.id === selected);
  const librarian = agents.find((a) => a.isLibrarian);
  const counts = { notas: data.nodes.filter((n) => n.kind === 'note').length, enlaces: data.links.filter((l) => l.kind === 'link').length };

  return (
    <div className="graph">
      <div className="hub-bar">
        <span className="muted small">Núcleos:</span>
        <button className={`hub-chip ${!hubFilter ? 'on' : ''}`} onClick={() => setHubFilter('')}>Todos</button>
        {hubInfo.hubs.map((h) => (
          <button key={h.id} className={`hub-chip ${hubFilter === h.id ? 'on' : ''}`} style={{ ['--hub' as string]: h.color }} onClick={() => { setHubFilter(hubFilter === h.id ? '' : h.id); setHubPanel(h.id); }}>
            {h.emoji} {h.name} <small>{h.notes}</small>
          </button>
        ))}
        <button className="btn btn--ghost small" onClick={async () => {
          const r = await api.hubSuggest();
          setSugg({ list: r.suggestions, chosen: new Set(r.suggestions.map((_, i) => i)), by: 'Entre núcleos se' });
        }} title="Ideas de núcleos distintos que hablan de lo mismo">🔗 Conectar núcleos</button>
      </div>
      <div className="graph-toolbar">
        <input className="search" placeholder="Resaltar nodos…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check"><input type="checkbox" checked={opts.tags} onChange={(e) => setOpts({ ...opts, tags: e.target.checked })} /> Etiquetas</label>
        <label className="check"><input type="checkbox" checked={opts.agents} onChange={(e) => setOpts({ ...opts, agents: e.target.checked })} /> IAs</label>
        <label className="check"><input type="checkbox" checked={opts.ghosts} onChange={(e) => setOpts({ ...opts, ghosts: e.target.checked })} /> Notas sin crear</label>
        <label className="check"><input type="checkbox" checked={opts.contrib} onChange={(e) => setOpts({ ...opts, contrib: e.target.checked })} /> Aportes de IA</label>
        <label className="check"><input type="checkbox" checked={opts.labels} onChange={(e) => setOpts({ ...opts, labels: e.target.checked })} /> Nombres</label>
        <label>
          Vista{' '}
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))} disabled={!selected}>
            <option value={0}>Global</option>
            <option value={1}>Local · 1 salto</option>
            <option value={2}>Local · 2 saltos</option>
          </select>
        </label>
        <button className="btn btn--ghost small" onClick={() => view.current.fit()}>Encuadrar</button>
        {times.length > 1 && (
          <span className="timeline">
            <button className="btn btn--ghost small" onClick={() => setPlaying((p) => !p)} title="Ver cómo creció tu grafo">{playing ? '⏹️' : '▶️'}</button>
            <input type="range" min={0} max={times.length - 1} value={until === null ? times.length - 1 : Math.max(0, times.findIndex((t) => t >= until))}
              onChange={(e) => { setPlaying(false); const k = Number(e.target.value); setUntil(k >= times.length - 1 ? null : times[k]); }} />
            <small className="muted">{until === null ? 'Hoy' : new Date(until).toLocaleString()}</small>
          </span>
        )}
        <span className="muted small">{counts.notas} notas · {counts.enlaces} enlaces</span>
        <button className="btn btn--primary small" disabled={finding} onClick={async () => {
          setFinding(true);
          try {
            const r = await api.suggestLinks();
            setSugg({ list: r.suggestions, chosen: new Set(r.suggestions.map((_, i) => i)), by: r.by });
          } finally {
            setFinding(false);
          }
        }}>{finding ? 'Buscando…' : '🕸️ Conectar ideas'}</button>
      </div>
      <div className="graph-canvas" ref={wrapRef}>
        <canvas ref={canvasRef} />
        <div className="graph-legend">
          {Object.entries(TYPE_META).map(([k, v]) => <span key={k}><i style={{ background: v.color }} />{v.label}</span>)}
          <span><i style={{ background: KIND_COLOR.tag }} />Etiqueta</span>
          <span><i style={{ background: KIND_COLOR.agent }} />IA</span>
          <span><i style={{ background: KIND_COLOR.ghost }} />Sin crear</span>
          <span><i style={{ background: '#f59e0b' }} />Temas en común</span>
        </div>
        {!data.nodes.length && <div className="empty overlay">Aún no hay notas. Envía una tarea en la Oficina o crea notas.</div>}
        {sugg && (
          <div className="graph-suggest">
            <header>
              {librarian && <Chibi avatar={librarian.avatar} size={44} state={live[librarian.id]?.status || 'idle'} />}
              <div>
                <strong>{sugg.by} propone {sugg.list.length} conexiones</strong>
                <div className="muted small">Elige cuáles enlazar; se añaden en la sección «Relacionado» de ambas notas.</div>
              </div>
              <button className="icon-btn" onClick={() => setSugg(null)}>✕</button>
            </header>
            {!sugg.list.length && <p className="muted small">No encontré notas relacionadas sin enlazar. ¡Tu grafo está bien conectado!</p>}
            <ul>
              {sugg.list.map((s, i) => (
                <li key={i}>
                  <label className="check">
                    <input type="checkbox" checked={sugg.chosen.has(i)} onChange={() => {
                      const c = new Set(sugg.chosen);
                      if (c.has(i)) c.delete(i); else c.add(i);
                      setSugg({ ...sugg, chosen: c });
                    }} />
                    <span><b>{s.fromTitle}</b> ↔ <b>{s.toTitle}</b><br /><small className="muted">{s.reason}</small></span>
                  </label>
                </li>
              ))}
            </ul>
            {sugg.list.length > 0 && (
              <button className="btn btn--primary small" disabled={!sugg.chosen.size} onClick={async () => {
                const r = await api.connect(sugg.list.filter((_, i) => sugg.chosen.has(i)));
                toast(`🔗 ${r.applied} conexiones nuevas en tu grafo`);
                setSugg(null);
              }}>Enlazar {sugg.chosen.size}</button>
            )}
          </div>
        )}
        {hubPanel && <HubPanel hub={hubInfo.hubs.find((h) => h.id === hubPanel)} bridges={hubInfo.bridges} hubs={hubInfo.hubs} onClose={() => setHubPanel(null)} />}
        {sel && sel.kind !== 'hub' && (
          <div className="graph-preview">
            <header>
              <strong>{sel.label}</strong>
              <button className="icon-btn" onClick={() => setSelected(null)}>✕</button>
            </header>
            {preview ? (
              <>
                <div className="graph-preview-body"><Markdown text={preview.content.slice(0, 1200)} onLink={(t) => openNote({ title: t })} /></div>
                <button className="btn btn--primary small" onClick={() => openNote({ id: preview.id })}>Abrir nota</button>
              </>
            ) : sel.kind === 'ghost' ? (
              <button className="btn btn--primary small" onClick={() => openNote({ title: sel.label })}>Crear esta nota</button>
            ) : (
              <p className="muted small">{sel.kind === 'agent' ? 'IA de la oficina: se conecta con las notas que escribió.' : 'Etiqueta: agrupa notas relacionadas.'}</p>
            )}
            <p className="muted small">{neighbors.get(sel.id)?.size || 0} conexiones · doble clic en un nodo para abrirlo</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Perfil de un núcleo: sus temas, con quién se conecta y preguntas solo a sus notas. */
function HubPanel({ hub, hubs, bridges, onClose }: { hub?: HubInfo; hubs: HubInfo[]; bridges: Bridge[]; onClose: () => void }) {
  const { openNote, toast, streams } = useOffice();
  const [q, setQ] = useState('');
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState('');
  const [answer, setAnswer] = useState<{ text: string; sources: { id: string; title: string }[] } | null>(null);
  useEffect(() => setAnswer(null), [hub?.id]);
  if (!hub) return null;
  const mine = bridges.filter((b) => b.a === hub.id || b.b === hub.id);
  const nameOf = (id: string) => hubs.find((h) => h.id === id);
  const live = streams[`hub:${hub.id}`];
  return (
    <div className="graph-preview hub-panel" style={{ ['--hub' as string]: hub.color }}>
      <header>
        <strong>{hub.emoji} {hub.name}</strong>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </header>
      <p className="muted small">{hub.notes} notas{hub.tags.length ? ` · ${hub.tags.slice(0, 4).map((t) => `#${t.tag}`).join(' ')}` : ''}</p>
      {hub.topics.length > 0 && <div className="topics">{hub.topics.slice(0, 10).map((t) => <span key={t.word} className="pill">{t.word}</span>)}</div>}
      {mine.length > 0 && (
        <div className="small">
          <b>Se conecta con:</b>
          <ul>{mine.map((b) => {
            const o = nameOf(b.a === hub.id ? b.b : b.a);
            return <li key={b.a + b.b}>{o?.emoji} {o?.name} · afinidad {Math.round(b.score * 100)} %{b.shared.length ? ` (${b.shared.slice(0, 3).join(', ')})` : ''}{b.links ? ` · ${b.links} enlaces` : ''}</li>;
          })}</ul>
        </div>
      )}
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Pregúntale a ${hub.name}…`} onKeyDown={(e) => e.key === 'Enter' && document.getElementById('hub-ask')?.click()} />
        <button id="hub-ask" className="btn btn--primary small" disabled={!q.trim() || Boolean(busy)} onClick={async () => {
          setBusy('ask');
          try {
            const r = await api.askHub(hub.id, q, save);
            setAnswer({ text: r.answer, sources: r.sources });
            if (r.noteId) toast('📝 Respuesta guardada como nota');
          } catch (err) {
            toast(`❌ ${(err as Error).message}`);
          } finally {
            setBusy('');
          }
        }}>{busy === 'ask' ? '…' : 'Preguntar'}</button>
      </div>
      <label className="check small"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Guardar la respuesta en su núcleo</label>
      {(answer || (busy === 'ask' && live)) && (
        <div className="graph-preview-body">
          <Markdown text={answer?.text || live || ''} onLink={(t) => openNote({ title: t })} />
        </div>
      )}
      <button className="btn btn--ghost small" disabled={Boolean(busy)} onClick={async () => {
        setBusy('profile');
        try {
          const n = await api.hubProfile(hub.id);
          openNote({ id: n.id });
        } catch (err) {
          toast(`❌ ${(err as Error).message}`);
        } finally {
          setBusy('');
        }
      }}>{busy === 'profile' ? 'Escribiendo…' : '📝 Ver / actualizar su perfil'}</button>
    </div>
  );
}
