// Reloj en vivo para lo que está en curso: «0:42», «12:05».
import { useEffect, useState } from 'react';

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Milisegundos desde `since` (se actualiza cada segundo mientras `running`). */
export function useElapsed(since: string | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return since ? now - Date.parse(since) : 0;
}
