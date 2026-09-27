// Guía de bienvenida: se muestra la primera vez que abres la oficina.
import { useState } from 'react';
import { useOffice } from '../state';

const STEPS = [
  { emoji: '🏢', title: 'Bienvenido a tu Oficina de IAs', text: 'Un edificio con más de 25 IAs especializadas y Claude como cerebro central. Pasean, toman el ascensor, van por café y trabajan en equipo. Haz clic en cualquiera para hablar con ella.' },
  { emoji: '🧠', title: 'Pídele cualquier cosa al cerebro', text: 'Escribe una tarea arriba en la Oficina. Claude elige a los especialistas, los pone a trabajar (algunos sobre la entrega de otros) e integra todo en una respuesta final.' },
  { emoji: '🔑', title: 'Conecta las IAs cuando quieras', text: 'Sin claves todo funciona en modo demo. En Ajustes puedes pegar tus claves de API, activar Ollama o usar herramientas que ya tengas instaladas, como Codex CLI o Claude Code.' },
  { emoji: '🕸️', title: 'Todo queda en tu segundo cerebro', text: 'Cada tarea, reunión e idea se guarda como notas enlazadas estilo Obsidian. Explóralas en el Grafo y en Notas; nada se pierde al apagar el computador.' },
];

export function Welcome() {
  const { setView } = useOffice();
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem('oficina.bienvenida');
    } catch {
      return false;
    }
  });
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem('oficina.bienvenida', '1');
    } catch {
      /* sin almacenamiento local */
    }
  };
  const s = STEPS[step];
  return (
    <div className="palette-backdrop" onClick={close}>
      <div className="welcome" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Bienvenida">
        <div className="welcome-emoji">{s.emoji}</div>
        <h2>{s.title}</h2>
        <p>{s.text}</p>
        <div className="welcome-dots">{STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}</div>
        <div className="row between">
          <button className="btn btn--ghost" onClick={close}>Saltar</button>
          {step < STEPS.length - 1 ? (
            <button className="btn btn--primary" onClick={() => setStep(step + 1)}>Siguiente →</button>
          ) : (
            <div className="row">
              <button className="btn btn--ghost" onClick={() => { close(); setView('ajustes'); }}>Conectar IAs</button>
              <button className="btn btn--primary" onClick={() => { close(); setView('oficina'); }}>¡Empezar!</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
