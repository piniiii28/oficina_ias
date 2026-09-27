// Voz: dictado con el reconocimiento del navegador y lectura en voz alta.
import { useRef, useState } from 'react';

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onend: () => void; onerror: () => void; start: () => void; stop: () => void;
};

function getRecognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Botón de dictado: agrega lo que dices al texto. */
export function MicButton({ onText }: { onText: (t: string) => void }) {
  const [on, setOn] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const R = getRecognition();
  if (!R) return null;
  return (
    <button
      type="button"
      className={`btn btn--ghost small ${on ? 'mic-on' : ''}`}
      title={on ? 'Detener dictado' : 'Dictar por voz'}
      onClick={() => {
        if (on) {
          rec.current?.stop();
          return;
        }
        const r = new R();
        r.lang = 'es-CO';
        r.interimResults = false;
        r.continuous = true;
        r.onresult = (e) => {
          const last = e.results[e.results.length - 1];
          if (last.isFinal) onText(last[0].transcript.trim());
        };
        r.onend = () => setOn(false);
        r.onerror = () => setOn(false);
        rec.current = r;
        r.start();
        setOn(true);
      }}
    >
      {on ? '⏺️ Escuchando…' : '🎤'}
    </button>
  );
}

/** Lee un texto en voz alta (sin Markdown). */
export function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  if (!('speechSynthesis' in window)) return null;
  return (
    <button
      type="button"
      className="btn btn--ghost small"
      title={speaking ? 'Detener lectura' : 'Escuchar en voz alta'}
      onClick={() => {
        if (speaking) {
          speechSynthesis.cancel();
          setSpeaking(false);
          return;
        }
        const clean = text.replace(/```[\s\S]*?```/g, ' (código) ').replace(/[#*_>`[\]|-]/g, ' ').replace(/\s+/g, ' ').slice(0, 6000);
        const u = new SpeechSynthesisUtterance(clean);
        u.lang = 'es-ES';
        u.onend = () => setSpeaking(false);
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
        setSpeaking(true);
      }}
    >
      {speaking ? '⏹️' : '🔊'}
    </button>
  );
}
