// Notas de bienvenida para que el grafo no empiece vacío.
export function seedWelcome(notes) {
  notes.create({
    title: 'Bienvenida a la Oficina',
    type: 'nota',
    tags: ['guia'],
    source: { agentId: 'cerebro' },
    content: `# Bienvenida a la Oficina de IAs 🧠

Soy **Claude**, el cerebro central. Coordino a más de 25 IAs especializadas.

- Escríbeme una tarea en [[Cómo pedir tareas]] y reparto el trabajo.
- Todo lo que hacemos se guarda como notas conectadas: mira el [[Grafo de ideas]].
- Cada IA puede aprender: revisa [[Entrenar a una IA]].
- Para respuestas reales, pon tus claves en [[Conectar las IAs]].

#guia #inicio`,
  });
  notes.create({
    title: 'Cómo pedir tareas',
    type: 'nota',
    tags: ['guia'],
    content: `En **Oficina** escribe lo que necesitas, por ejemplo:

> Crea un plan de negocio para una cafetería con app de pedidos y campaña en Instagram.

El cerebro elige a los especialistas (estrategia, código, marketing…), trabajan en paralelo y al final integro todo. El resultado queda en una nota de tipo *tarea*, enlazada a cada aporte y a las ideas clave.

También puedes hacer clic en cualquier IA para hablar con ella directamente.

Volver a [[Bienvenida a la Oficina]] #guia`,
  });
  notes.create({
    title: 'Grafo de ideas',
    type: 'nota',
    tags: ['guia'],
    content: `El grafo funciona como Obsidian:

- Escribe \`[[Nombre de nota]]\` para enlazar notas. Si la nota no existe aparece como nodo fantasma, y al abrirla se crea.
- Usa \`#etiqueta\` para agrupar.
- Los nodos morados son IAs: se conectan con las notas que escribieron.
- Arrastra nodos, haz zoom con la rueda y doble clic para abrir.

Relacionado: [[Cómo pedir tareas]] · #guia`,
  });
  notes.create({
    title: 'Entrenar a una IA',
    type: 'nota',
    tags: ['guia'],
    content: `Abre una IA → pestaña **Entrenamiento** y añade lecciones: guías de estilo, datos de tu empresa, ejemplos de respuestas que te gustan…

Ese conocimiento se incluye en cada petición que recibe esa IA. Además, cada IA guarda automáticamente una **memoria** de los trabajos que hizo.

Ver también [[Bienvenida a la Oficina]] #guia`,
  });
  notes.create({
    title: 'Conectar las IAs',
    type: 'nota',
    tags: ['guia'],
    content: `Ve a **Ajustes** y pega las claves de API que tengas:

- **OpenRouter**: una sola clave da acceso a Qwen, Kimi, Command, Nemotron, Mistral y muchos más.
- **OpenAI** (ChatGPT, Codex), **Anthropic** (Claude), **Google** (Gemini), **Groq**, **Mistral**, **DeepSeek**, **xAI**, **Perplexity**, **Together**.
- **Ollama** para modelos locales gratis.

Sin clave, esa IA responde en *modo demo* (simulado) para que puedas probar todo.

Relacionado: [[Bienvenida a la Oficina]] #guia`,
  });
}
