// Sonidos sintetizados (sin archivos): se activan desde el menú lateral.
let ctx: AudioContext | null = null;

export function soundsOn() {
  try {
    return localStorage.getItem('oficina.sonidos') === '1';
  } catch {
    return false;
  }
}

export function setSounds(on: boolean) {
  try {
    localStorage.setItem('oficina.sonidos', on ? '1' : '0');
  } catch {
    /* sin almacenamiento local */
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.08) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

export function play(kind: 'ding' | 'pop' | 'error') {
  if (!soundsOn()) return;
  try {
    ctx ||= new AudioContext();
    if (kind === 'ding') {
      tone(880, 0, 0.35);
      tone(1320, 0.12, 0.5);
    } else if (kind === 'pop') {
      tone(620, 0, 0.12, 'triangle', 0.05);
    } else {
      tone(220, 0, 0.25, 'square', 0.03);
      tone(180, 0.15, 0.3, 'square', 0.03);
    }
  } catch {
    /* audio no disponible */
  }
}
