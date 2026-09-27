# 🧠 Oficina de IAs

Una oficina virtual donde **Claude es el cerebro central** y coordina a **27 IAs especializadas** (ChatGPT, Codex, OpenCode, Gemini, DeepSeek, Grok, Mistral, Perplexity, Llama, Qwen, Kimi y más). Cada IA tiene su **avatar chibi animado**, su escritorio, su memoria y su propio entrenamiento. Todo lo que hace el equipo se guarda como **notas conectadas en un grafo de ideas**, al estilo Obsidian.

![El edificio de la oficina](docs/edificio.png)

| Lobby con reunión en curso | Grafo de ideas |
|---|---|
| ![Lobby](docs/lobby.png) | ![Grafo](docs/grafo.png) |

| Oficina y consola del cerebro | Sala de reuniones |
|---|---|
| ![Oficina](docs/oficina.png) | ![Reuniones](docs/reuniones.png) |

## Qué puedes hacer

| Sección | Qué hace |
|---|---|
| 🏢 **Oficina** | Un **edificio estilo Habbo** con 8 pisos isométricos (penthouse, departamentos y lobby con cafetería y sala de reuniones) donde las IAs caminan, toman el ascensor, van a su escritorio cuando trabajan y se sientan en la mesa del lobby durante las reuniones. Cada una tiene su disfraz (mago, ninja, astronauta…). Le escribes una tarea a Claude. Él la divide, elige a los especialistas, los pone a trabajar **en paralelo** (los ves pensar, teclear y celebrar) e integra todo en una respuesta final. |
| 📋 **Tablero** | Kanban por proyectos (Por hacer, En curso, Hecho). Envía una tarjeta al equipo con un clic; pasa sola a «Hecho» con el enlace al resultado. |
| 🗣️ **Reuniones** | Eliges varias IAs y un tema: conversan por turnos respondiéndose entre ellas y Claude resume acuerdos y próximos pasos. |
| 🎯 **Tareas** | Historial con el plan del cerebro, el aporte de cada IA (escrito en vivo) y la respuesta integrada. Puedes pedir ajustes para que el mismo equipo continúe, y crear **rutinas automáticas** (por ejemplo, un resumen cada mañana a las 7:00). |
| 📝 **Notas** | Editor Markdown con `[[enlaces]]`, `#etiquetas`, backlinks, notas fijadas, ideas y diario. Cada tarea genera notas enlazadas automáticamente. |
| 🕸️ **Grafo** | Mapa interactivo de tus ideas: zoom, arrastre, búsqueda, grafo local (1–2 saltos), nodos de IAs, etiquetas y notas por crear. |
| 👥 **Equipo** | Todas las IAs. Habla con cada una, **entrénala** con tus lecciones y archivos, revisa su memoria, cambia su modelo o su avatar, o contrata IAs nuevas. |
| ⚙️ **Ajustes** | Tus claves de API (con botón **Probar**), herramientas de línea de comandos, tu avatar, el modo demo, la revisión de calidad final, cuántas IAs trabajan a la vez y el respaldo de tus datos. |

Atajo: **Ctrl+K** (⌘K en Mac) abre la búsqueda global de notas, IAs, tareas y secciones.

## Cómo iniciarla

Necesitas [Node.js](https://nodejs.org) 20 o superior.

- **Windows:** doble clic en `iniciar.bat`.
- **macOS / Linux:** ejecuta `./iniciar.sh`.
- **Manual:** `npm install` y luego `npm start`. Abre http://localhost:4747

Desde Chrome o Edge puedes **instalarla como app** (ícono de instalar en la barra de direcciones) para abrirla en su propia ventana.

Para desarrollar con recarga en vivo: `npm run dev`, que abre la interfaz en http://localhost:5173.

## Conectar las IAs

Sin claves, todo funciona en **modo demo** con respuestas simuladas, así que puedes probar la oficina completa gratis. Para respuestas reales, ve a **Ajustes** y pega las claves que tengas:

| Proveedor | IAs de la oficina que lo usan |
|---|---|
| **Anthropic** | Claude (cerebro), Sonnet (QA), Haiku (bibliotecaria del grafo) |
| **OpenAI** | Codex, ChatGPT, O-Estratega, Coach |
| **Google Gemini** | Gemini (datos), Pixel (diseño) |
| **OpenRouter** | OpenCode, Kimi, Command, Nemo PM, Lexi. Con una sola clave accedes a cientos de modelos. |
| **Groq** | Llama Ops, Guardián |
| **Mistral** | Codestral, Mistral, Babel |
| **DeepSeek** | DeepSeek, DeepSeek R |
| **xAI** | Grok |
| **Perplexity** | Perplexity, Sonar |
| **Together** | Qwen, Llama Finanzas |
| **Ollama** (local, gratis) | Gemma, Phi |

### Con herramientas de línea de comandos (sin claves)

Si tienes instaladas y con sesión iniciada **Codex CLI**, **Claude Code**, **OpenCode** o **Gemini CLI**, actívalas en **Ajustes → Herramientas de línea de comandos**. Ahí mismo puedes detectar cuáles están instaladas y usar **Asignar a sus IAs**: por ejemplo, Codex y ChatGPT pasan a usar tu sesión de ChatGPT a través de Codex CLI. El comando de cada herramienta es editable: con `{prompt}` el texto se pasa como argumento y, si no aparece, se envía por la entrada estándar. Se ejecutan en una carpeta temporal vacía y, por defecto, en modo de solo lectura cuando la herramienta lo admite.

Puedes cambiar el proveedor y el modelo de cualquier IA desde su perfil. Los modelos se actualizan seguido, así que si uno deja de existir escribe el id nuevo. Por ejemplo, puedes pasar todas las IAs a OpenRouter y usar una sola clave.

También se leen variables de entorno: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `PERPLEXITY_API_KEY`, `TOGETHER_API_KEY`.

## El edificio

- **Azotea**: jardín, gimnasio y piscina para los descansos.
- **Penthouse**: la oficina de Claude, el cerebro central.
- **Pisos 6 a 1**: Ingeniería, Datos, Estudio Creativo, Investigación, Negocios, y Personas y Conocimiento.
- **Planta baja**: lobby, cafetería y la mesa de reuniones.

Las IAs caminan casilla por casilla, se detienen a conversar cuando se cruzan y usan el ascensor (su puerta se abre al llegar alguien). Tú también tienes un avatar: haz clic en cualquier baldosa para caminar y personalízalo en **Ajustes**. Si prefieres la vista clásica, usa el botón **▦ Escritorios**.

## Entrenamiento y memoria

Los modelos de las empresas no se pueden reentrenar desde aquí. Lo que hace la oficina es **especializar** a cada IA en tres capas:

1. **Rol e instrucciones:** su personalidad y especialidad, editables en su perfil.
2. **Entrenamiento:** lecciones que tú le enseñas (texto o archivos `.txt`, `.md`, `.csv`, `.json`) y que se incluyen en cada petición.
3. **Memoria:** se llena sola con cada trabajo que hace, para que mantenga el contexto de tus proyectos.

Con el botón **Aprender de mi experiencia** (pestaña Entrenamiento), cada IA repasa su memoria y sus trabajos y escribe sus propias «lecciones aprendidas»: se especializa sola con el uso.

Además, la oficina tiene una **memoria compartida**: antes de cada tarea, el cerebro busca en tu grafo las notas relacionadas y se las pasa al equipo. La nota del resultado las enlaza en «Contexto usado».

## Seguridad

La oficina solo escucha en tu propio computador (`127.0.0.1`) y rechaza peticiones que vengan de otras páginas web, porque guarda tus claves y puede ejecutar herramientas de línea de comandos. Si de verdad quieres abrirla a tu red, inicia con la variable `HOST=0.0.0.0`, bajo tu responsabilidad.

## ¿Dónde se guarda todo?

En `data/oficina.json`, dentro de la carpeta del proyecto, con una copia de seguridad automática en `oficina.json.bak`. **Nada se pierde al apagar el computador.** Desde Ajustes puedes descargar un respaldo (sin tus claves) y restaurarlo en otro equipo.

## Estructura

```
server/   API en Node + Express: orquestador, proveedores, notas y grafo, persistencia
client/   Interfaz en React + Vite: oficina animada, notas, grafo (d3-force), equipo
data/     Tus datos (se crea sola; no se sube a git)
```

Pruebas: `npm test`.
