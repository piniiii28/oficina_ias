// Utilidades del sistema: abrir una terminal (para iniciar sesión en una CLI),
// ejecutar comandos conocidos mostrando su salida en vivo (instalaciones) y
// abrir archivos o carpetas con el programa del computador.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const win = process.platform === 'win32';
const mac = process.platform === 'darwin';

/** Texto para mostrar al usuario: cómo correr el comando a mano con esas variables. */
export function manualCommand(cmdline, vars = {}) {
  const sets = Object.entries(vars).map(([k, v]) => (win ? `set "${k}=${v}" && ` : `${k}="${v}" `)).join('');
  return `${sets}${cmdline}`;
}

/**
 * Abre una ventana de terminal que ejecuta `cmdline` con variables extra.
 * Devuelve false si no se pudo (entonces el usuario lo corre a mano).
 */
export function openTerminal(cmdline, vars = {}) {
  const env = { ...process.env, ...vars };
  try {
    if (win) {
      spawn('cmd.exe', ['/c', 'start', '"Oficina de IAs"', 'cmd', '/k', cmdline], { env, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
      return true;
    }
    if (mac) {
      // Terminal.app no hereda variables: se escriben en un script temporal.
      const file = path.join(os.tmpdir(), `oficina-login-${Date.now()}.command`);
      const exports = Object.entries(vars).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join('\n');
      fs.writeFileSync(file, `#!/bin/bash\n${exports}\n${cmdline}\n`, { mode: 0o755 });
      spawn('open', ['-a', 'Terminal', file], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    for (const term of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm']) {
      const args = term === 'gnome-terminal' ? ['--', 'bash', '-c', `${cmdline}; exec bash`] : ['-e', 'bash', '-c', `${cmdline}; exec bash`];
      const child = spawn(term, args, { env, detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      if (child.pid) {
        child.unref();
        return true;
      }
    }
  } catch {
    /* sin terminal gráfica */
  }
  return false;
}

/**
 * Ejecuta un comando y entrega la salida en vivo. Resuelve con { ok, code, out }.
 * Solo se usa con programas y argumentos fijos del servidor (nunca texto libre del usuario).
 */
export function runLogged(cmd, args, { onData = () => {}, cwd, env, timeoutMs = 15 * 60000, shell = false } = {}) {
  return new Promise((resolve) => {
    let out = '';
    const push = (d) => {
      const t = d.toString();
      out += t;
      onData(t);
    };
    // Sin consola por defecto, para que las rutas con espacios lleguen enteras;
    // en Windows, npm necesita la consola (es un .cmd).
    const child = spawn(cmd, args, { cwd, env: env || process.env, shell });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (e) => {
      clearTimeout(timer);
      push(`\n${e.code === 'ENOENT' ? `No encontré "${cmd}" en este computador.` : e.message}\n`);
      resolve({ ok: false, code: -1, out });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, out });
    });
  });
}

/** Abre un archivo o carpeta con el programa predeterminado del sistema. */
export function openPath(target) {
  const [cmd, args] = win ? ['explorer.exe', [target]] : mac ? ['open', [target]] : ['xdg-open', [target]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Lanza un programa con interfaz (Blender, OpenSCAD…) sin esperar a que se cierre. */
export function launchApp(exe, args = [], cwd) {
  try {
    const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
