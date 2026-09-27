// Impresora Bambu Lab (probado para la P1S; sirve también para P1P, A1 y X1)
// por la red local, sin la nube:
// - Estado y órdenes por MQTT (puerto 8883, usuario «bblp», contraseña = código
//   de acceso LAN que muestra la impresora).
// - Cámara de la P1/A1 por el puerto 6000 (imágenes JPEG).
// La impresora usa su propio certificado, por eso la conexión cifrada no se
// valida contra una autoridad; para limitar el riesgo solo se permiten
// direcciones de la red local.
import tls from 'node:tls';
import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

/** ¿Es una dirección de la red local (o de Tailscale)? */
export function isLanHost(host) {
  const h = String(host || '').trim();
  if (/^(localhost|127\.)/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return /\.local$/i.test(h);
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

// --- MQTT 3.1.1 mínimo (solo lo que necesita la impresora) ---
function varint(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}
const str = (s) => {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
};
const packet = (type, body) => Buffer.concat([Buffer.from([type]), varint(body.length), body]);

export const mqtt = {
  connect: (clientId, user, pass) => packet(0x10, Buffer.concat([str('MQTT'), Buffer.from([4, 0xc2, 0, 60]), str(clientId), str(user), str(pass)])),
  subscribe: (id, topic) => packet(0x82, Buffer.concat([Buffer.from([id >> 8, id & 255]), str(topic), Buffer.from([0])])),
  publish: (topic, payload) => packet(0x30, Buffer.concat([str(topic), Buffer.from(payload)])),
  ping: () => Buffer.from([0xc0, 0]),
  /** Separa paquetes completos de un búfer. Devuelve { packets, rest }. */
  parse(buf) {
    const packets = [];
    let i = 0;
    while (i + 2 <= buf.length) {
      let len = 0, mul = 1, j = i + 1, byte;
      do {
        if (j >= buf.length) return { packets, rest: buf.subarray(i) };
        byte = buf[j++];
        len += (byte & 127) * mul;
        mul *= 128;
      } while (byte & 128);
      if (j + len > buf.length) break;
      const type = buf[i] >> 4;
      const body = buf.subarray(j, j + len);
      if (type === 3) {
        const tl = body.readUInt16BE(0);
        const qos = (buf[i] >> 1) & 3;
        const start = 2 + tl + (qos ? 2 : 0);
        packets.push({ type, topic: body.subarray(2, 2 + tl).toString('utf8'), payload: body.subarray(start) });
      } else packets.push({ type, body });
      i = j + len;
    }
    return { packets, rest: buf.subarray(i) };
  },
};

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') deepMerge(a[k], v);
    else a[k] = v;
  }
  return a;
}

const STATE_ES = { IDLE: 'libre', PREPARE: 'preparando', RUNNING: 'imprimiendo', PAUSE: 'en pausa', FINISH: 'terminó', FAILED: 'falló', SLICING: 'laminando' };

/** Resumen legible del estado que manda la impresora. */
export function summarize(raw) {
  const p = raw.print || {};
  const light = (p.lights_report || []).find((l) => l.node === 'chamber_light');
  return {
    estado: STATE_ES[p.gcode_state] || (p.gcode_state ? String(p.gcode_state).toLowerCase() : 'desconocido'),
    codigo: p.gcode_state || null,
    archivo: p.subtask_name || p.gcode_file || null,
    progreso: p.mc_percent ?? null,
    restante: p.mc_remaining_time ?? null,
    capa: p.layer_num ?? null,
    capas: p.total_layer_num ?? null,
    boquilla: p.nozzle_temper !== undefined ? Math.round(p.nozzle_temper) : null,
    boquillaMeta: p.nozzle_target_temper !== undefined ? Math.round(p.nozzle_target_temper) : null,
    cama: p.bed_temper !== undefined ? Math.round(p.bed_temper) : null,
    camaMeta: p.bed_target_temper !== undefined ? Math.round(p.bed_target_temper) : null,
    ventilador: p.cooling_fan_speed ?? null,
    luz: light ? light.mode === 'on' : null,
    error: p.print_error ? `Código ${p.print_error}` : null,
    wifi: p.wifi_signal || null,
  };
}

const COMMANDS = {
  pausar: { print: { sequence_id: '0', command: 'pause' } },
  reanudar: { print: { sequence_id: '0', command: 'resume' } },
  detener: { print: { sequence_id: '0', command: 'stop' } },
  luz_on: { system: { sequence_id: '0', command: 'ledctrl', led_node: 'chamber_light', led_mode: 'on', led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0 } },
  luz_off: { system: { sequence_id: '0', command: 'ledctrl', led_node: 'chamber_light', led_mode: 'off', led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0 } },
};
export const PRINTER_COMMANDS = Object.keys(COMMANDS);

/** Conexión con la impresora: se mantiene abierta y se reconecta sola. */
export class BambuPrinter extends EventEmitter {
  constructor(cfg, { plain = false } = {}) {
    super();
    this.cfg = cfg;
    this.plain = plain; // solo para pruebas (sin cifrado)
    this.raw = {};
    this.connected = false;
    this.error = null;
    this.closed = false;
    this.#open();
  }

  #open() {
    if (this.closed) return;
    const { host, port = 8883, serial, accessCode } = this.cfg;
    const opts = { host, port, rejectUnauthorized: false, checkServerIdentity: () => undefined };
    const sock = this.plain ? net.connect({ host, port }) : tls.connect(opts);
    this.sock = sock;
    let buf = Buffer.alloc(0);
    sock.setTimeout(45000, () => sock.destroy(new Error('La impresora dejó de responder')));
    sock.on(this.plain ? 'connect' : 'secureConnect', () => sock.write(mqtt.connect(`oficina-${crypto.randomBytes(4).toString('hex')}`, 'bblp', accessCode)));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const { packets, rest } = mqtt.parse(buf);
      buf = Buffer.from(rest);
      for (const p of packets) {
        if (p.type === 2) {
          if (p.body[1] !== 0) {
            this.error = p.body[1] === 4 || p.body[1] === 5 ? 'Código de acceso incorrecto' : `La impresora rechazó la conexión (${p.body[1]})`;
            this.emit('update');
            return sock.destroy();
          }
          this.connected = true;
          this.error = null;
          sock.write(mqtt.subscribe(1, `device/${serial}/report`));
          this.send({ pushing: { sequence_id: '0', command: 'pushall' } });
          this.emit('update');
        } else if (p.type === 3) {
          try {
            deepMerge(this.raw, JSON.parse(p.payload.toString('utf8')));
            this.lastAt = Date.now();
            this.emit('update');
          } catch {
            /* mensaje que no es JSON */
          }
        }
      }
    });
    const ping = setInterval(() => this.connected && sock.write(mqtt.ping()), 30000);
    sock.on('error', (e) => {
      this.error = e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT' ? `No encuentro la impresora en ${host}. Revisa la IP y que esté encendida en la misma red.` : e.message;
    });
    sock.on('close', () => {
      clearInterval(ping);
      this.connected = false;
      this.emit('update');
      if (!this.closed) this.retry = setTimeout(() => this.#open(), 15000);
    });
  }

  send(obj) {
    if (!this.connected) throw new Error(this.error || 'No estoy conectado a la impresora');
    this.sock.write(mqtt.publish(`device/${this.cfg.serial}/request`, JSON.stringify(obj)));
  }

  command(name) {
    const c = COMMANDS[name];
    if (!c) throw new Error('Orden desconocida');
    this.send(c);
  }

  get state() {
    return summarize(this.raw);
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.sock?.destroy();
  }
}

/** Una imagen JPEG de la cámara de la P1S (puerto 6000). */
export function cameraFrame({ host, accessCode, port = 6000 }, { plain = false, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.alloc(80);
    auth.writeUInt32LE(0x40, 0);
    auth.writeUInt32LE(0x3000, 4);
    auth.write('bblp', 16, 'ascii');
    auth.write(String(accessCode), 48, 'ascii');
    const sock = plain ? net.connect({ host, port }) : tls.connect({ host, port, rejectUnauthorized: false, checkServerIdentity: () => undefined });
    let buf = Buffer.alloc(0);
    const done = (err, img) => {
      sock.destroy();
      if (err) reject(err);
      else resolve(img);
    };
    sock.setTimeout(timeoutMs, () => done(new Error('La cámara no respondió. En la P1S, activa «LAN Mode Liveview» en la pantalla de la impresora.')));
    sock.on(plain ? 'connect' : 'secureConnect', () => sock.write(auth));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 16) return;
      const size = buf.readUInt32LE(0);
      if (size <= 0 || size > 5e6) return done(new Error('La cámara mandó datos raros'));
      if (buf.length >= 16 + size) {
        const img = buf.subarray(16, 16 + size);
        if (img[0] !== 0xff || img[1] !== 0xd8) return done(new Error('La cámara no mandó una imagen'));
        done(null, Buffer.from(img));
      }
    });
    sock.on('error', (e) => done(new Error(e.code === 'ECONNREFUSED' ? 'La cámara no está disponible (¿modo LAN activado?)' : e.message)));
  });
}

// --- Una impresora por oficina: se conecta según Ajustes y avisa los cambios ---
let current = null;
export const getPrinter = () => current;

/** (Re)conecta la impresora con la configuración guardada. emit(e) manda eventos a la interfaz. */
export function connectPrinter(settings, emit = () => {}) {
  current?.close();
  current = null;
  const c = settings.printer;
  if (!c?.host || !c.serial || !c.accessCode || !isLanHost(c.host)) return null;
  current = new BambuPrinter({ host: c.host, port: c.port, serial: c.serial, accessCode: c.accessCode }, { plain: process.env.OFICINA_PRINTER_PLAIN === '1' });
  let timer = null;
  current.on('update', () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (current) emit({ type: 'printer', ...printerInfo(settings) });
    }, 1200);
  });
  return current;
}

export function printerInfo(settings) {
  const c = settings.printer;
  const p = current;
  return {
    configured: Boolean(c?.host && c?.serial && c?.accessCode),
    name: c?.name || 'Mi impresora',
    model: c?.model || 'P1S',
    host: c?.host || '',
    serial: c?.serial || '',
    accessPreview: c?.accessCode ? `${c.accessCode.slice(0, 2)}…${c.accessCode.slice(-2)}` : null,
    connected: Boolean(p?.connected),
    error: p?.error || (c?.host && !isLanHost(c.host) ? 'Solo se permiten direcciones de la red local (192.168…, 10…, 172.16–31…)' : null),
    state: p ? p.state : null,
    updatedAt: p?.lastAt || null,
  };
}
