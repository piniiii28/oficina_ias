// Grafo de conocimiento estilo Obsidian: física de fuerzas en canvas,
// zoom, arrastre, resaltado de vecinos, búsqueda y grafo local.
import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { api, type GraphLink, type GraphNode, type Note } from '../api';
import { Markdown } from '../components/Markdown';
import { useOffice } from '../state';
import { TYPE_META } from './Notes';

type N = GraphNode & SimulationNodeDatum & { degree: number };
type L = SimulationLinkDatum<N> & { kind: GraphLink['kind'] };

const KIND_COLOR = { tag: '#2dd4bf', ghost: '#52525b', agent: '#c084fc' };

function colorOf(n: N) {
  if (n.kind === 'note') return TYPE_META[n.type || 'nota']?.color || '#94a3b8';
  return KIND_COLOR[n.kind];
}

export function Graph() {
  const { notesVersion, openNote, agents } = useOffice();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [opts, setOpts] = useState({ tags: true, agents: true, ghosts: true, labels: true });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Note | null>(null);
  const [depth, setDepth] = useState(0); // 0 = grafo global
  const state = useRef({ k: 1, x: 0, y: 0, hover: null as N | null, drag: null as N | null, panning: false, moved: false, lx: 0, ly: 0 });
  const simRef = useRef<Simulation<N, L> | null>(null);
  // Valores que cambian seguido se leen por ref para no reiniciar la física.
  const view = useRef({ selected, query, labels: opts.labels, redraw: () => {}, fit: () => {} });
  view.current.selected = selected;
  view.current.query = query;
  view.current.labels = opts.labels;
  useEffect(() => view.current.redraw(), [selected, query, opts.labels]);

  useEffect(() => {
    api.graph({ tags: opts.tags, agents: opts.agents }).then(setData);
  }, [notesVersion, opts.tags, opts.agents]);

  // Filtrado: fantasmas y grafo local.
  const center = depth > 0 ? selected : null;
  const graph = useMemo(() => {
    let nodes = data.nodes.filter((n) => opts.ghosts || n.kind !== 'ghost');
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
  }, [data, opts.ghosts, depth, center]);

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
    const links: L[] = graph.links.map((l) => ({ source: l.source, target: l.target, kind: l.kind }));
    const radius = (n: N) => (n.kind === 'agent' ? 9 : n.kind === 'tag' ? 4 : 4 + Math.sqrt(n.degree) * 2.2);

    const sim = forceSimulation<N, L>(nodes)
      .force('link', forceLink<N, L>(links).id((d) => d.id).distance((l) => (l.kind === 'tag' ? 60 : l.kind === 'author' ? 80 : 75)).strength(0.4))
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
        ctx.strokeStyle = hot ? '#c084fc' : lineColor;
        ctx.globalAlpha = focus && !hot ? 0.25 : 1;
        ctx.lineWidth = (hot ? 1.8 : 1) / Math.sqrt(st.k);
        if (l.kind === 'tag') ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
        ctx.setLineDash([]);
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
        if (n.kind === 'agent') {
          const a = agents.find((x) => x.id === n.agentId);
          ctx.font = `${r * 1.2}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(a?.avatar.prop || '🤖', n.x!, n.y! + 1);
        }
        const showLabel = labels && (st.k > 1.3 || isFocus || (near && near.has(n.id)) || n.degree > 4 || n.kind === 'agent');
        if (showLabel && !dim) {
          ctx.font = `${11 / st.k}px system-ui, sans-serif`;
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
        if (!st.moved) setSelected(n.id);
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
  const counts = { notas: data.nodes.filter((n) => n.kind === 'note').length, enlaces: data.links.filter((l) => l.kind === 'link').length };

  return (
    <div className="graph">
      <div className="graph-toolbar">
        <input className="search" placeholder="Resaltar nodos…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check"><input type="checkbox" checked={opts.tags} onChange={(e) => setOpts({ ...opts, tags: e.target.checked })} /> Etiquetas</label>
        <label className="check"><input type="checkbox" checked={opts.agents} onChange={(e) => setOpts({ ...opts, agents: e.target.checked })} /> IAs</label>
        <label className="check"><input type="checkbox" checked={opts.ghosts} onChange={(e) => setOpts({ ...opts, ghosts: e.target.checked })} /> Notas sin crear</label>
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
        <span className="muted small">{counts.notas} notas · {counts.enlaces} enlaces</span>
      </div>
      <div className="graph-canvas" ref={wrapRef}>
        <canvas ref={canvasRef} />
        <div className="graph-legend">
          {Object.entries(TYPE_META).map(([k, v]) => <span key={k}><i style={{ background: v.color }} />{v.label}</span>)}
          <span><i style={{ background: KIND_COLOR.tag }} />Etiqueta</span>
          <span><i style={{ background: KIND_COLOR.agent }} />IA</span>
          <span><i style={{ background: KIND_COLOR.ghost }} />Sin crear</span>
        </div>
        {!data.nodes.length && <div className="empty overlay">Aún no hay notas. Envía una tarea en la Oficina o crea notas.</div>}
        {sel && (
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
