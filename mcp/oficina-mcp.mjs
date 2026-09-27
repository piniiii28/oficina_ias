#!/usr/bin/env node
// Servidor MCP de la Oficina de IAs para Claude Desktop (y cualquier cliente
// MCP). Habla por la entrada y salida estándar (JSON-RPC, un mensaje por
// línea) y usa la API de la oficina que corre en tu computador.
//
// Claude Desktop lo inicia solo; se configura desde Ajustes → Claude Desktop.
// Variables: OFICINA_URL (por defecto http://localhost:4747) y OFICINA_TOKEN.
import readline from 'node:readline';

const BASE = (process.env.OFICINA_URL || 'http://localhost:4747').replace(/\/$/, '');
const TOKEN = process.env.OFICINA_TOKEN || '';

async function api(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    throw new Error(`No pude conectarme con la oficina en ${BASE}. ¿Está abierta? (inicia con iniciar.bat)`);
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function findAgent(nameOrId) {
  const agents = await api('GET', '/api/agents');
  const q = String(nameOrId || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return agents.find((a) => a.id === nameOrId) || agents.find((a) => norm(a.name) === q) || agents.find((a) => norm(a.name).includes(q) || norm(a.role).includes(q));
}

const TOOLS = [
  {
    name: 'estado_oficina',
    description: 'Muestra el estado de la Oficina de IAs: cuántas IAs hay conectadas, tareas en curso y núcleos del grafo.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const [agents, tasks, hubs] = await Promise.all([api('GET', '/api/agents'), api('GET', '/api/tasks'), api('GET', '/api/hubs')]);
      const running = tasks.filter((t) => !['done', 'error'].includes(t.status));
      return [
        `IAs: ${agents.length} (${agents.filter((a) => a.live).length} conectadas, el resto en modo demo).`,
        running.length ? `Tareas en curso:\n${running.map((t) => `- ${t.title} (${t.status})`).join('\n')}` : 'No hay tareas en curso.',
        `Núcleos: ${hubs.hubs.map((h) => `${h.name} (${h.notes} notas)`).join(', ')}`,
      ].join('\n\n');
    },
  },
  {
    name: 'listar_ias',
    description: 'Lista las IAs de la oficina con su rol, departamento, si están conectadas y sus medidores de acierto y carga.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const [agents, metrics] = await Promise.all([api('GET', '/api/agents'), api('GET', '/api/metrics').catch(() => ({}))]);
      return agents.map((a) => `- ${a.name} [${a.id}]: ${a.role} · ${a.department}${a.isHead ? ' · jefe' : ''} · ${a.live ? 'conectada' : 'demo'}${metrics[a.id] ? ` · acierto ${metrics[a.id].accuracy.score}, carga ${metrics[a.id].load.score}` : ''}`).join('\n');
    },
  },
  {
    name: 'pedir_tarea',
    description: 'Le pide una tarea al cerebro de la oficina: arma un equipo de IAs especializadas, trabajan y devuelve la respuesta integrada. Tarda de segundos a varios minutos.',
    inputSchema: {
      type: 'object',
      properties: {
        tarea: { type: 'string', description: 'Lo que necesitas, con todo el contexto' },
        flujo: { type: 'string', description: 'Opcional: un flujo predefinido (app, lanzamiento, contenido, estudio, negocio, datos, pieza3d, figura3d, mecanica3d)' },
        ias: { type: 'array', items: { type: 'string' }, description: 'Opcional: nombres o ids de las IAs que deben trabajar' },
      },
      required: ['tarea'],
    },
    run: async ({ tarea, flujo, ias }) => {
      let agentIds;
      if (Array.isArray(ias) && ias.length) agentIds = (await Promise.all(ias.map(findAgent))).filter(Boolean).map((a) => a.id);
      const { id } = await api('POST', '/api/tasks', { prompt: tarea, flow: flujo, agentIds });
      for (let i = 0; i < 200; i++) {
        await wait(3000);
        const t = await api('GET', `/api/tasks/${id}`);
        if (t.status === 'done' || t.status === 'error') {
          const team = t.steps.map((s) => `${s.agentId}${s.status === 'error' ? ' (falló)' : ''}`).join(', ');
          return `${t.status === 'error' ? '⚠️ ' : ''}${t.final}\n\n---\nEquipo: ${team}${t.noteId ? '\nQuedó guardada como nota en el grafo de la oficina.' : ''}`;
        }
      }
      return `La tarea sigue en curso (id ${id}). Revisa la sección Tareas de la oficina.`;
    },
  },
  {
    name: 'hablar_con_ia',
    description: 'Envía un mensaje directo a una IA específica de la oficina (por nombre o id) y devuelve su respuesta. Recuerda la conversación.',
    inputSchema: { type: 'object', properties: { ia: { type: 'string', description: 'Nombre o id, p. ej. Blendi, Codex, Scad' }, mensaje: { type: 'string' } }, required: ['ia', 'mensaje'] },
    run: async ({ ia, mensaje }) => {
      const a = await findAgent(ia);
      if (!a) throw new Error(`No encontré una IA llamada «${ia}». Usa listar_ias.`);
      const r = await api('POST', `/api/agents/${a.id}/chat`, { message: mensaje });
      return `${a.name}${r.simulated ? ' (modo demo)' : ''}:\n\n${r.reply}`;
    },
  },
  {
    name: 'buscar_notas',
    description: 'Busca notas en el grafo de ideas de la oficina (estilo Obsidian).',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
    run: async ({ texto }) => {
      const list = await api('GET', `/api/notes?q=${encodeURIComponent(texto)}`);
      return list.length ? list.slice(0, 20).map((n) => `- ${n.title} (${n.type}${n.hub ? `, núcleo ${n.hub}` : ''}): ${n.excerpt.replace(/\s+/g, ' ').slice(0, 140)}`).join('\n') : 'No encontré notas.';
    },
  },
  {
    name: 'leer_nota',
    description: 'Lee una nota completa del grafo por su título.',
    inputSchema: { type: 'object', properties: { titulo: { type: 'string' } }, required: ['titulo'] },
    run: async ({ titulo }) => {
      const list = await api('GET', `/api/notes?q=${encodeURIComponent(titulo)}`);
      const n = list.find((x) => x.title.toLowerCase() === titulo.toLowerCase()) || list[0];
      if (!n) throw new Error('No existe esa nota');
      const full = await api('GET', `/api/notes/${n.id}`);
      return `# ${full.title}\n\n${full.content}${full.backlinks.length ? `\n\nEnlazada desde: ${full.backlinks.map((b) => b.title).join(', ')}` : ''}`;
    },
  },
  {
    name: 'crear_nota',
    description: 'Crea una nota en el grafo de la oficina. Usa [[Título]] para enlazar otras notas y #etiquetas.',
    inputSchema: { type: 'object', properties: { titulo: { type: 'string' }, contenido: { type: 'string' }, nucleo: { type: 'string', description: 'Opcional: cerebro, nicolas, santiago, miguel…' } }, required: ['titulo', 'contenido'] },
    run: async ({ titulo, contenido, nucleo }) => {
      const n = await api('POST', '/api/notes', { title: titulo, content: contenido, hub: nucleo });
      return `Nota creada: «${n.title}».`;
    },
  },
  {
    name: 'preguntar_nucleo',
    description: 'Pregunta algo a un núcleo del grafo (Cerebro, Nicolás, Santiago, Miguel…): responde usando solo las notas de esa persona.',
    inputSchema: { type: 'object', properties: { nucleo: { type: 'string' }, pregunta: { type: 'string' } }, required: ['nucleo', 'pregunta'] },
    run: async ({ nucleo, pregunta }) => {
      const hubs = (await api('GET', '/api/hubs')).hubs;
      const q = nucleo.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      const h = hubs.find((x) => x.id === q || x.name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '') === q);
      if (!h) throw new Error(`No existe el núcleo «${nucleo}». Hay: ${hubs.map((x) => x.name).join(', ')}`);
      const r = await api('POST', `/api/hubs/${h.id}/ask`, { question: pregunta });
      return `${r.answer}\n\nFuentes: ${r.sources.map((s) => s.title).join(', ')}`;
    },
  },
  {
    name: 'crear_modelo_3d',
    description: 'Ejecuta un script de modelado 3D en el computador del usuario (Blender con bpy, OpenSCAD o FreeCAD), genera el STL y opcionalmente lo abre en el programa. Guarda los archivos en la variable OUT_DIR (ya definida).',
    inputSchema: {
      type: 'object',
      properties: {
        programa: { type: 'string', enum: ['blender', 'openscad', 'freecad'] },
        codigo: { type: 'string', description: 'Script completo (Python para Blender/FreeCAD, o código OpenSCAD)' },
        nombre: { type: 'string' },
        abrir: { type: 'boolean', description: 'Abrir el resultado en el programa' },
      },
      required: ['programa', 'codigo'],
    },
    run: async ({ programa, codigo, nombre, abrir }) => {
      const j = await api('POST', '/api/cad/run', { kind: programa, code: codigo, name: nombre || 'modelo de Claude', gui: Boolean(abrir) });
      return `${j.ok ? '✅ Modelo listo' : '⚠️ No se generó el STL'}\nCarpeta: ${j.dir}\nArchivos: ${j.files.map((f) => f.name).join(', ')}\n\nRegistro:\n${j.log.slice(-1500)}`;
    },
  },
  {
    name: 'impresora',
    description: 'Consulta o controla la impresora Bambu Lab conectada a la oficina: estado (progreso, temperaturas, tiempo restante), pausar, reanudar, detener o encender/apagar la luz. Las órdenes piden confirmación al usuario en la oficina.',
    inputSchema: { type: 'object', properties: { orden: { type: 'string', enum: ['estado', 'pausar', 'reanudar', 'detener', 'luz_on', 'luz_off'] } } },
    run: async ({ orden = 'estado' }) => {
      if (orden === 'estado') {
        const s = await api('GET', '/api/printer/status');
        if (!s.configured) return 'La impresora todavía no está configurada en la oficina (Taller 3D → Mi impresora).';
        if (!s.connected) return `No estoy conectado a la impresora: ${s.error || 'sin respuesta'}`;
        const p = s.state;
        return `Estado: ${p.estado}${p.archivo ? ` · ${p.archivo}` : ''}\nProgreso: ${p.progreso ?? '—'} % · capa ${p.capa ?? '—'}/${p.capas ?? '—'} · faltan ${p.restante ?? '—'} min\nBoquilla: ${p.boquilla ?? '—'} °C (meta ${p.boquillaMeta ?? '—'}) · cama: ${p.cama ?? '—'} °C (meta ${p.camaMeta ?? '—'})${p.error ? `\nError: ${p.error}` : ''}`;
      }
      const r = await api('POST', '/api/printer/command', { command: orden, via: 'Claude Desktop' });
      return r.message || 'Listo';
    },
  },
];

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notificaciones (p. ej. notifications/initialized)
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'oficina-ias', version: '1.0.0' },
          instructions: 'Herramientas de la Oficina de IAs del usuario: un cerebro central que coordina IAs especializadas, un grafo de notas, un Taller 3D (Blender, OpenSCAD, FreeCAD) y su impresora Bambu Lab. Responde en español.',
        },
      });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ run: _r, ...t }) => t) } });
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Herramienta desconocida: ${params?.name}` } });
      try {
        const text = await tool.run(params.arguments || {});
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      } catch (err) {
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true } });
      }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método no soportado: ${method}` } });
  } catch (err) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } });
  }
  handle(msg);
});
