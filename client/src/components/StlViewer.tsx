// Visor 3D liviano para archivos STL (sin librerías): dibuja los triángulos en
// un canvas con sombreado plano. Arrastra para girar y usa la rueda para acercar.
import { useEffect, useRef, useState } from 'react';

type Tri = [number, number, number, number, number, number, number, number, number];

/** Lee un STL binario o de texto. */
export function parseStl(buf: ArrayBuffer): Tri[] {
  const bytes = new Uint8Array(buf);
  const head = new TextDecoder().decode(bytes.slice(0, 256)).trimStart();
  const dv = new DataView(buf);
  const count = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const binary = buf.byteLength === 84 + count * 50 || !head.startsWith('solid') || !/facet/.test(new TextDecoder().decode(bytes.slice(0, 2000)));
  const tris: Tri[] = [];
  if (binary && buf.byteLength >= 84) {
    for (let i = 0; i < count && 84 + i * 50 + 50 <= buf.byteLength; i++) {
      const o = 84 + i * 50 + 12;
      const t = [] as number[];
      for (let k = 0; k < 9; k++) t.push(dv.getFloat32(o + k * 4, true));
      tris.push(t as Tri);
    }
    return tris;
  }
  const nums = [...new TextDecoder().decode(bytes).matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  for (let i = 0; i + 2 < nums.length; i += 3) tris.push([...nums[i], ...nums[i + 1], ...nums[i + 2]] as Tri);
  return tris;
}

export function StlViewer({ url, height = 260 }: { url: string; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tris, setTris] = useState<Tri[] | null>(null);
  const [error, setError] = useState('');
  const view = useRef({ rx: -0.9, rz: 0.6, zoom: 1, drag: null as null | { x: number; y: number }, auto: true });

  useEffect(() => {
    let off = false;
    setTris(null);
    setError('');
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('No encontré el archivo'))))
      .then((b) => !off && setTris(parseStl(b)))
      .catch((e) => !off && setError(e.message));
    return () => {
      off = true;
    };
  }, [url]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !tris?.length) return;
    // Centro y tamaño del modelo.
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (let k = 0; k < 9; k++) {
      min[k % 3] = Math.min(min[k % 3], t[k]);
      max[k % 3] = Math.max(max[k % 3], t[k]);
    }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const size = Math.max(...[0, 1, 2].map((k) => max[k] - min[k])) || 1;
    // Con muchos triángulos se dibuja una muestra mientras giras.
    const step = Math.max(1, Math.ceil(tris.length / 40000));
    let raf = 0;
    const color = getComputedStyle(c).getPropertyValue('--accent').trim() || '#a78bfa';
    const rgb = /^#([0-9a-f]{6})$/i.test(color) ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : [167, 139, 250];
    const draw = () => {
      const v = view.current;
      if (v.auto && !v.drag) v.rz += 0.006;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) c.width = w * dpr;
      if (c.height !== h * dpr) c.height = h * dpr;
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const s = (Math.min(w, h) * 0.7 * v.zoom) / size;
      const cz = Math.cos(v.rz), sz = Math.sin(v.rz), cx = Math.cos(v.rx), sx = Math.sin(v.rx);
      const proj = (x: number, y: number, z: number) => {
        x -= center[0]; y -= center[1]; z -= center[2];
        const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
        const y2 = y1 * cx - z * sx, z2 = y1 * sx + z * cx;
        return [w / 2 + x1 * s, h / 2 + y2 * s, z2];
      };
      const faces: { p: number[][]; d: number; l: number }[] = [];
      for (let i = 0; i < tris.length; i += step) {
        const t = tris[i];
        const a = proj(t[0], t[1], t[2]), b = proj(t[3], t[4], t[5]), d = proj(t[6], t[7], t[8]);
        // Normal en pantalla para la luz (y para descartar caras de espalda).
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        faces.push({ p: [a, b, d], d: (a[2] + b[2] + d[2]) / 3, l: Math.abs(nz / len) * 0.75 + Math.abs(ny / len) * 0.1 + 0.15 });
      }
      faces.sort((f1, f2) => f1.d - f2.d);
      for (const f of faces) {
        const k = Math.min(1, f.l);
        g.fillStyle = `rgb(${rgb.map((c0) => Math.round(c0 * k + 20 * (1 - k))).join(',')})`;
        g.beginPath();
        g.moveTo(f.p[0][0], f.p[0][1]);
        g.lineTo(f.p[1][0], f.p[1][1]);
        g.lineTo(f.p[2][0], f.p[2][1]);
        g.closePath();
        g.fill();
        g.strokeStyle = g.fillStyle;
        g.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [tris]);

  if (error) return <div className="stl-viewer empty small">No pude mostrar el modelo: {error}</div>;
  return (
    <div className="stl-viewer" style={{ height }}>
      {!tris && <span className="muted small">Cargando modelo…</span>}
      {tris && !tris.length && <span className="muted small">El STL está vacío.</span>}
      <canvas
        ref={canvas}
        style={{ width: '100%', height: '100%' }}
        onPointerDown={(e) => {
          view.current.drag = { x: e.clientX, y: e.clientY };
          view.current.auto = false;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = view.current.drag;
          if (!d) return;
          view.current.rz += (e.clientX - d.x) * 0.01;
          view.current.rx += (e.clientY - d.y) * 0.01;
          view.current.drag = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (view.current.drag = null)}
        onWheel={(e) => {
          view.current.zoom = Math.max(0.3, Math.min(5, view.current.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
        }}
      />
      {tris && tris.length > 0 && <small className="stl-info">{tris.length.toLocaleString('es-CO')} triángulos · arrastra para girar</small>}
    </div>
  );
}
