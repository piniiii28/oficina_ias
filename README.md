# 🧠 Oficina de IAs

Una oficina virtual donde **Claude es el cerebro central** y coordina a **37 IAs especializadas** (más 16 en el catálogo), 30 de ellas con **modelos gratis** (ChatGPT, Codex, OpenCode, Gemini, DeepSeek, Grok, Mistral, Perplexity, Llama, Qwen, Kimi y más). Cada IA tiene su **avatar chibi animado**, su escritorio, su memoria y su propio entrenamiento. Todo lo que hace el equipo se guarda como **notas conectadas en un grafo de ideas**, al estilo Obsidian.

![El edificio de la oficina](docs/edificio.png)

| Lobby con reunión en curso | Grafo de ideas |
|---|---|
| ![Lobby](docs/lobby.png) | ![Grafo](docs/grafo.png) |

| Oficina y consola del cerebro | Sala de reuniones |
|---|---|
| ![Oficina](docs/oficina.png) | ![Reuniones](docs/reuniones.png) |

| Taller 3D con visor del STL | Núcleos del grafo |
|---|---|
| ![Taller 3D](docs/taller.png) | ![Núcleos](docs/nucleos.png) |

![Conectar las IAs con ayuda de Claude](docs/conectar.png)

## Qué puedes hacer

| Sección | Qué hace |
|---|---|
| 🏢 **Oficina** | Le escribes una tarea a Claude (o se la dictas por voz, con archivos adjuntos o enlaces). Él la divide, elige a los especialistas, los pone a trabajar **en paralelo o en relevos** e integra todo en una respuesta final. Abajo está el **edificio estilo Habbo**: 10 pisos isométricos por donde las IAs caminan, trabajan, se reúnen y descansan. |
| 📋 **Tablero** | Kanban por proyectos (Por hacer, En curso, Hecho). Envía una tarjeta al equipo con un clic; pasa sola a «Hecho» con el enlace al resultado. |
| ⛓️ **Flujos** | Equipos con relevos listos (Crear una app, Lanzar un producto, Contenido para redes, Aprender un tema, Plan de negocio, Analizar datos): cada IA trabaja sobre la entrega de la anterior. |
| 🗣️ **Reuniones** | Eliges varias IAs y un tema: conversan por turnos respondiéndose entre ellas y Claude resume acuerdos y próximos pasos. |
| 🎯 **Tareas** | Historial con el plan del cerebro, el aporte de cada IA (escrito en vivo) y la respuesta integrada. Puedes pedir ajustes para que el mismo equipo continúe, y crear **rutinas automáticas** (por ejemplo, un resumen cada mañana a las 7:00). |
| 📝 **Notas** | Editor Markdown con `[[enlaces]]`, `#etiquetas`, backlinks, casillas `- [ ]` clicables, plantillas, notas fijadas, ideas y diario. Cada tarea genera notas enlazadas automáticamente. Incluye **Resumen del día**, **Trabajar esta nota**, **menciones sin enlazar** y una bóveda compatible con Obsidian (importa archivos o una carpeta completa). |
| 🕸️ **Grafo** | Mapa interactivo de tus ideas: zoom, arrastre, búsqueda, grafo local (1–2 saltos), nodos de IAs, etiquetas, notas por crear y **línea de tiempo**. La bibliotecaria Haiku propone **conexiones entre ideas** relacionadas. Tiene **núcleos** (Cerebro, Nicolás, Santiago, Miguel…): cada persona tiene sus notas, su perfil y se le pueden hacer preguntas; los núcleos que comparten temas se unen con un puente. |
| 🖨️ **Taller 3D** | Departamento de impresión 3D: pides una pieza y las IAs escriben el modelo para **OpenSCAD, Blender o FreeCAD**. Con un clic la oficina lo abre en el programa de tu computador, genera el **STL**, lo muestra en 3D y lo lamina a **G-code** con PrusaSlicer u OrcaSlicer. |
| 👥 **Equipo** | Todas las IAs con estadísticas de actividad y uso por proveedor. Habla con cada una, **entrénala** con lecciones y archivos (o deja que **aprenda de su experiencia**), revisa su memoria, cambia su modelo, avatar o disfraz, contrata IAs del **catálogo**, exporta o importa IAs para compartirlas y desbloquea **logros**. Valora cada aporte con 👍/👎: la IA lo recuerda. |
| ⚙️ **Ajustes** | Tus claves de API (con botón **Probar**), herramientas de línea de comandos, tu avatar, el modo demo, la revisión de calidad final, cuántas IAs trabajan a la vez y el respaldo de tus datos. |

Atajo: **Ctrl+K** (⌘K en Mac) abre la búsqueda global de notas, IAs, tareas y secciones.

## Cómo instalarla y actualizarla

La forma recomendada es **`instalar.bat`** (Windows) o **`./instalar.sh`** (Mac/Linux), una sola vez:

- Instala Git y Node.js si faltan, descarga la oficina con git en `%USERPROFILE%\OficinaIAs`, trae tus datos si venías de una versión en ZIP y crea un acceso directo **«Oficina de IAs»** en el escritorio.
- Desde ahí, cada vez que la abres **se actualiza sola**. También hay un botón **Ajustes → Buscar actualizaciones**, que instala los cambios y reinicia la oficina.
- La primera vez GitHub puede pedirte iniciar sesión (el repositorio es privado); queda guardado.

También puedes abrirla con `iniciar.bat` / `./iniciar.sh`, o a mano con `npm install` y `npm start`. Abre http://localhost:4747

### Dónde quedan tus datos

En **Documentos → Oficina de IAs** (fuera del programa, así actualizar o reinstalar no los toca). Ahí están la base de la oficina, la bóveda de notas `.md` para Obsidian, el Taller 3D y **respaldos diarios** (los últimos 14). La primera vez que abres esta versión, tus datos de la carpeta `data/` se copian allí solos. Puedes moverlos (por ejemplo a OneDrive) en **Ajustes → Actualizaciones y datos**.

Desde Chrome o Edge puedes **instalarla como app** (ícono de instalar en la barra de direcciones) para abrirla en su propia ventana.

Para desarrollar con recarga en vivo: `npm run dev`, que abre la interfaz en http://localhost:5173.

## Conectar las IAs

Sin claves, todo funciona en **modo demo** con respuestas simuladas, así que puedes probar la oficina completa gratis. Para respuestas reales ve a **Ajustes → Conectar las IAs**:

- Los proveedores están ordenados en **Gratis**, **Con tu suscripción** y **De pago**. Cada uno tiene sus pasos: abrir la página de la clave, pegarla, probarla y elegir qué IAs lo usan (con una lista de modelos gratis).
- Las herramientas de línea de comandos se **instalan con un clic** y el botón **Iniciar sesión** abre una terminal para entrar con tu cuenta.
- **🆓 Modo gratis** pasa de una vez las IAs de proveedores de pago a modelos gratis (o a tu suscripción, si conectaste Claude Code o Codex CLI). Se puede deshacer.
- **💬 Ayuda de Claude**: el cerebro te guía paso a paso y sus respuestas traen botones para instalar, iniciar sesión o conectar.
- **Varias cuentas por proveedor**: por ejemplo, dos cuentas de Gemini con correos distintos. Si una se queda sin cupo, la oficina sigue con la siguiente. En el perfil de cada IA eliges qué cuenta usa primero. Con las CLIs, cada cuenta guarda su sesión en su propia carpeta.

Proveedores y las IAs de la plantilla que los usan:

| Proveedor | IAs de la oficina que lo usan |
|---|---|
| **Groq** (gratis) | Llama Ops, Guardián, Qwen, Kimi, O-Estratega, Capa, Voltio (electrónica y Arduino) |
| **Google Gemini** (gratis) | Gemini, Pixel, Command, Coach, Scad, Láser (corte láser y CNC) |
| **OpenRouter** (modelos `:free`) | OpenCode, DeepSeek, DeepSeek R, Nemo PM, Lexi, Blendi, Fredi |
| **Cerebras** (gratis) | Llama Finanzas |
| **GitHub Models** (gratis con tu cuenta) | Celda (Excel) |
| **SambaNova** (gratis) | Clip (video) |
| **NVIDIA NIM** (créditos gratis) | Newton (tutor de matemáticas y física) |
| **Cohere** (clave de prueba gratis) | Forma (diseño de producto) |
| **Hugging Face** (créditos gratis) | Disponible para cualquier IA |
| **Mistral** (gratis) | Codestral, Mistral, Babel |
| **Ollama** (local, gratis) | Gemma, Phi, Gemma 4 (12B), Coda (Qwen Coder), Deep (DeepSeek R1), Qwen (3.5), Brisa (Mistral), Granito (Granite 4), Llamita (Llama 3.2) |
| **Anthropic** (de pago, o tu plan con Claude Code) | Claude (cerebro), Sonnet (QA), Haiku (bibliotecaria del grafo) |
| **OpenAI** (de pago, o tu ChatGPT con Codex CLI) | Codex, ChatGPT |
| **xAI** / **Perplexity** (de pago) | Grok / Perplexity, Sonar |

### Con herramientas de línea de comandos (sin claves)

Si tienes instaladas y con sesión iniciada **Codex CLI**, **Claude Code**, **OpenCode** o **Gemini CLI**, actívalas en **Ajustes → Herramientas de línea de comandos**. Ahí mismo puedes detectar cuáles están instaladas y usar **Asignar a sus IAs**: por ejemplo, Codex y ChatGPT pasan a usar tu sesión de ChatGPT a través de Codex CLI. El comando de cada herramienta es editable: con `{prompt}` el texto se pasa como argumento y, si no aparece, se envía por la entrada estándar. Se ejecutan en una carpeta temporal vacía y, por defecto, en modo de solo lectura cuando la herramienta lo admite.

Puedes cambiar el proveedor y el modelo de cualquier IA desde su perfil. Los modelos se actualizan seguido, así que si uno deja de existir escribe el id nuevo. Por ejemplo, puedes pasar todas las IAs a OpenRouter y usar una sola clave.

También se leen variables de entorno: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GITHUB_MODELS_TOKEN`, `SAMBANOVA_API_KEY`, `HF_TOKEN`, `NVIDIA_API_KEY`, `COHERE_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `PERPLEXITY_API_KEY`, `TOGETHER_API_KEY`.

Los planes gratis y los ids de modelos cambian seguido; si un modelo deja de existir, escribe el nuevo en el perfil de la IA.

## Taller de Impresión 3D

El piso 1 del edificio es el taller, con cuatro IAs (todas con modelos gratis):

- **Blendi** modela en **Blender** (formas libres, figuras).
- **Scad** diseña piezas paramétricas en **OpenSCAD** (medidas exactas).
- **Fredi** hace piezas mecánicas en **FreeCAD** (tolerancias, encajes).
- **Capa** revisa si se puede imprimir y da la configuración del laminador.

En la sección **Taller 3D** eliges el programa y describes la pieza. Cuando el equipo entrega el script, pulsa **▶ Abrir en…**: la oficina lo ejecuta en el programa instalado en tu computador, guarda el STL y el proyecto en `data/taller3d/` y lo abre en el programa para que sigas editando. También puedes pegar un script propio. Los programas son gratis: [Blender](https://www.blender.org/download/), [OpenSCAD](https://openscad.org/downloads.html), [FreeCAD](https://www.freecad.org/downloads.php), [PrusaSlicer](https://www.prusa3d.com/page/prusaslicer_424/) y [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer/releases). Si alguno está en otra carpeta, pon su ruta en **Ajustes → Taller 3D**. Antes de ejecutar un script, la oficina te pide confirmación.

### Blender en vivo

Además de ejecutar scripts, Claude y Blendi pueden **trabajar sobre el Blender que tienes abierto**, como la extensión de Claude para Blender: ven la escena, crean y modifican objetos, revisan cómo quedó y corrigen paso a paso; también guardan el `.blend` y exportan el STL.

1. En **Taller 3D → Blender en vivo** pulsa **Instalar con un clic** (o **💬 Que Claude me ayude a instalarlo** y sigue sus botones). Si prefieres, descarga el complemento y en Blender ve a *Edit → Preferences → Add-ons → Install from Disk*.
2. Abre Blender (o ciérralo y ábrelo otra vez). En la vista 3D pulsa **N**: la pestaña **Oficina** debe decir «Conectado».
3. Escribe lo que quieres, por ejemplo «crea un soporte para celular de 8 cm con bordes redondeados», y pulsa **Modelar en Blender**. La primera vez te pide permiso para tocar tu escena y te deja ver el código antes.

El complemento solo escucha en tu computador (127.0.0.1) y exige una clave secreta propia de tu oficina.

## Accesos a tu computador (con permiso)

Las IAs, sobre todo Claude, pueden **pedir acceso** a cosas fuera de su carpeta: buscar carpetas y archivos, leer textos, abrir un modelo en **Blender** (u OpenSCAD, FreeCAD, PrusaSlicer, OrcaSlicer) y copiar sus modelos a una carpeta tuya. Por ejemplo: «Claude, busca mis archivos .blend en Documentos y abre el último en Blender».

- Cada petición aparece abajo a la derecha con la carpeta y el motivo: **Permitir siempre**, **Solo esta vez** o **Rechazar**.
- Los permisos guardados se ven y se quitan en **Ajustes → Accesos a tu computador**; ahí también puedes dar acceso a una carpeta por adelantado (solo leer, o leer y guardar).
- Las IAs no tocan los archivos: escriben la acción y la oficina la ejecuta solo si está permitida. Nunca se permite ver los datos y claves de la oficina, carpetas del sistema, discos completos ni credenciales.
- Si usas Claude Code o Gemini CLI, las carpetas permitidas también se les pasan para que puedan leerlas.

## Núcleos del grafo

Arriba a la izquierda eliges **quién usa la oficina** en ese computador (Nicolás, Santiago, Miguel o el Cerebro). Las notas, tareas y reuniones nuevas quedan en su núcleo. En el **Grafo**:

- Cada núcleo es un nodo grande con sus notas alrededor; los botones de arriba muestran uno solo.
- Los núcleos que comparten temas se unen con un **puente naranja** que dice qué palabras tienen en común.
- Al hacer clic en un núcleo puedes **preguntarle** (el cerebro responde usando solo sus notas), guardar la respuesta y generar su **perfil**.
- **🔗 Conectar núcleos** propone enlaces entre notas de personas distintas que hablan de lo mismo.

Los nombres, emojis y colores se cambian en **Ajustes → Núcleos del grafo**.

## El edificio

Es un solo edificio en pixel art (estilo Habbo, con dibujos propios): paredes de madera, ventanales, losas y dos salas por nivel separadas por un vidrio. Cada sala tiene su placa en la fachada. Los avatares también son pixel art, con piezas combinables (pelo, ropa, accesorios y disfraces); si prefieres los chibi de antes, cámbialo en **Ajustes → Tu avatar**.

- **Azotea**: jardín, gimnasio y piscina para los descansos.
- **Penthouse**: la oficina de Claude, el cerebro central.
- **Pisos 7 a 2**: Ingeniería, Datos, Estudio Creativo, Investigación, Negocios, y Personas y Conocimiento.
- **Piso 1**: Taller de Impresión 3D, con impresoras y bobinas de filamento.
- **Planta baja**: lobby, cafetería y la mesa de reuniones.
- **Sótano**: sala de juegos (arcades, ping-pong, puffs) y servidores.

Las IAs caminan casilla por casilla, se detienen a conversar cuando se cruzan y usan el ascensor (su puerta se abre al llegar alguien). Tú también tienes un avatar: haz clic en cualquier baldosa para caminar o en un mueble (cafetera, arcade, piano, piscina, telescopio…) para usarlo, y personalízalo en **Ajustes**. Las IAs tienen energía: se cansan trabajando y recargan con café o en la azotea. Hay mascotas (Michi, Firulais y Kiwi) y cada piso tiene skins (botón 🎨). Las IAs en modo demo se ven desteñidas y con la etiqueta «demo»; las conectadas llevan un punto verde. Con **Solo IAs conectadas** (activado por defecto, en Ajustes → Comportamiento o con el botón **🟢** del panel del ascensor), las IAs en modo demo no trabajan en tareas, reuniones ni como asistentes, y no aparecen en la oficina hasta que las conectes. Mientras no haya ninguna conectada, trabajan todas en demo para que puedas probar. Si prefieres la vista clásica, usa el botón **▦ Escritorios**.

## Jefes y asistentes

- **Jefes de departamento** (👑): Codex en Ingeniería, Gemini en Datos, ChatGPT en el Estudio Creativo, Perplexity en Investigación, O-Estratega en Negocios, Coach en Personas y Blendi en el Taller 3D. Se cambian desde el perfil de cada IA. Si activas **Ajustes → Revisión de los jefes**, cuando trabajan 2 o más IAs de un departamento su jefe revisa y unifica lo que entregaron.
- **Asistentes opcionales**: en la pestaña **👥 Asistentes** de cada IA puedes darle hasta 2 especialistas en una tecnología o tema (por ejemplo, OpenCode con «React» y «Python»). Si la tarea es compleja, la IA les delega partes, trabajan en paralelo con modelos rápidos y gratis, y ella revisa e integra; si es simple, la hace sola. En el edificio caminan a su lado y en **Tareas** se ve lo que entregó cada uno.

No conviene ponerle asistentes a todas: cada uno suma llamadas y los planes gratis tienen límites por minuto.

## Medidores de cada IA

Cada IA muestra dos medidores (en **Equipo**, en su perfil y al pasar el mouse sobre ella en el edificio):

- **🎯 Acierto (0–100):** qué tan buenas resultan sus respuestas. Sale de tus 👍/👎, de cuántas tareas termina sin fallar y, si activas **Ajustes → Verificador**, de la nota de 1 a 5 que Sonnet (o el cerebro) le pone a cada aporte. Sin datos parte de 70 y se mueve poco hasta tener varias señales.
- **🔥 Carga (0–100):** la IA no se estresa como una persona, pero sí responde peor cuando recibe textos muy largos, hace varias tareas a la vez, tiene errores recientes (por ejemplo, sin cupo) o su memoria y su chat son muy largos. El medidor suma esas causas y da consejos para bajarla.

## Entrenamiento y memoria

Los modelos de las empresas no se pueden reentrenar desde aquí. Lo que hace la oficina es **especializar** a cada IA en tres capas:

1. **Rol e instrucciones:** su personalidad y especialidad, editables en su perfil.
2. **Entrenamiento:** lecciones que tú le enseñas (texto o archivos `.txt`, `.md`, `.csv`, `.json`) y que se incluyen en cada petición.
3. **Memoria:** se llena sola con cada trabajo que hace, para que mantenga el contexto de tus proyectos.

Con el botón **Aprender de mi experiencia** (pestaña Entrenamiento), cada IA repasa su memoria y sus trabajos y escribe sus propias «lecciones aprendidas»: se especializa sola con el uso.

Además, la oficina tiene una **memoria compartida**: antes de cada tarea, el cerebro busca en tu grafo las notas relacionadas y se las pasa al equipo. La nota del resultado las enlaza en «Contexto usado».

## Leer enlaces

Si pegas una URL en una tarea, la oficina descarga el texto de esa página (hasta 3 enlaces) y se lo pasa al equipo como adjunto. Por seguridad no lee direcciones locales ni privadas. Algunas redes sociales, como Instagram, exigen iniciar sesión y no dejan leer su contenido.

## Automatizar con n8n

En **⚡ Automatizar** conectas la oficina con [n8n](https://n8n.io) (gratis, corre en tu computador; se instala y se abre con un botón):

- **De n8n a la oficina:** con un nodo *HTTP Request* puedes pedir tareas (`/tarea`), crear notas (`/nota`) o tarjetas del tablero (`/tarjeta`). Las direcciones llevan una clave secreta y se ven solo en este computador. Si n8n corre en Docker, usa `host.docker.internal` en lugar de `localhost`.
- **De la oficina a n8n:** pega la URL de un nodo *Webhook* de n8n. Se activa a mano, al terminar cada tarea, o cuando una IA lo pide (te pregunta la primera vez y te muestra los datos que va a enviar).

## Claude Desktop

En **⚡ Automatizar → Claude Desktop** pulsa **Instalar en Claude Desktop** y reinícialo. Desde Claude Desktop podrás pedirle tareas a la oficina, hablar con una IA específica, buscar y crear notas, preguntarle a un núcleo, crear modelos 3D y ver o controlar tu impresora. Es un servidor MCP (`mcp/oficina-mcp.mjs`) que usa la oficina abierta en tu computador con una clave propia.

## Impresora Bambu Lab (P1S)

En **Taller 3D → Mi impresora** escribe la IP, el número de serie y el código de acceso LAN de la impresora (en su pantalla: Configuración → WLAN). En el firmware actual hay que activar el **modo solo LAN** y el **modo desarrollador**, y para la cámara **LAN Mode Liveview**. La oficina se conecta sin la nube de Bambu y muestra el progreso, la capa, las temperaturas y el tiempo restante, deja pausar, reanudar, detener y prender la luz, y ver la cámara. Las IAs y Claude Desktop pueden consultar el estado; para ver la cámara o dar órdenes te piden permiso, y **detener** siempre pregunta. Los modelos del Taller se abren en **Bambu Studio** con un clic para laminarlos y enviarlos.

## Usarla desde otros computadores (Tailscale)

1. Instala [Tailscale](https://tailscale.com/download) (gratis) en todos los computadores con la misma cuenta.
2. En **Ajustes → Otros computadores**, crea tu usuario con contraseña (como administrador). Si alguien más la va a usar, dale un usuario propio como miembro. Tus suscripciones son personales: tú puedes usarlas desde tus tres computadores, pero no compartirlas con otras personas.
3. Activa el acceso remoto: la oficina también escucha en la IP de Tailscale de este computador (`http://100.x.y.z:4747`). Los demás entran desde el navegador e inician sesión.

En este computador no hace falta iniciar sesión. Los **miembros** trabajan con las IAs, las notas y el tablero, pero no pueden cambiar tus claves, aprobar permisos, ejecutar scripts en tu computador ni tocar la impresora. Nadie fuera de tu red de Tailscale puede ver la oficina.

## Nodos: tus otros computadores

Las IAs de la nube (Claude, Gemini, Groq…) trabajan igual desde cualquier computador, así que no hace falta repartirles trabajo. Lo que sí aporta otro computador es lo que tiene **cerca**: la impresora de esa casa o su Ollama (si tiene mejor tarjeta de video).

1. En el otro computador instala la oficina y Tailscale, y abre **`nodo.bat`** (o `./nodo.sh`). La primera vez instala lo que falte (Node.js, Git y **Ollama**), enciende Ollama y descarga los modelos que usan tus IAs. Se abre una página con su dirección de Tailscale y su **código de enlace**.
2. En la oficina principal: **Ajustes → Nodos → Agregar nodo**.
3. Para la impresora de esa casa: **Taller 3D → Mi impresora → ¿Dónde está la impresora? → En la casa del nodo…**. El código de acceso se guarda en el nodo.

### Varios Ollama a la vez

Se usan **todos a la vez**: el de este computador y el de cada nodo.

- **Cada IA elige el suyo** en su perfil (⚙️ → «¿Qué Ollama usa?»): el preferido de la oficina, uno en concreto, o **automático** (el menos ocupado). Así, en una tarea con varias IAs, cada computador trabaja en paralelo.
- **Respaldo:** si ese computador está apagado o no tiene el modelo, se usa otro. Uno que falló se deja de últimas durante un minuto.
- **Modelos:** cada computador descarga solo los modelos de las IAs que corren en él (las que lo eligieron, las de «automático», y las demás en el preferido). La oficina se lo avisa a cada nodo al agregarlo, al cambiar una IA y cada 10 minutos, y el nodo descarga los que le falten. En **Ajustes → Nodos → Tus Ollama** ves qué tiene cada uno y descargas lo que falta. Se puede apagar por nodo.

### Actualizaciones de los nodos

El nodo se actualiza solo: al abrir `nodo.bat`, cada 6 horas (si la impresora no está imprimiendo) y cuando actualizas la oficina principal, que les pide a los nodos que se actualicen. Si un nodo quedó con una versión vieja, en **Ajustes → Nodos** sale el aviso y el botón «actualizar».

El nodo solo responde por Tailscale y con su código de enlace.

## Jurado

En **⚖️ Jurado** activas que 1 a 3 IAs califiquen cada aporte de 1 a 5, **a ciegas** (sin saber quién lo escribió), con una rúbrica fija y prefiriendo jueces de otro proveedor. La nota (mediana) alimenta el medidor 🎯. Ahí ves qué jueces son generosos o estrictos y cuánto coinciden con tus 👍/👎, que siguen pesando más. No se usa en modo demo.

## Seguridad

La oficina solo escucha en tu propio computador (`127.0.0.1`) y rechaza peticiones que vengan de otras páginas web, porque guarda tus claves y puede ejecutar herramientas de línea de comandos. Para usarla desde otros computadores, activa el acceso por Tailscale (con usuarios y contraseñas) en vez de abrirla a internet.

## ¿Dónde se guarda todo?

En **Documentos → Oficina de IAs** (`oficina.json`), con una copia automática en `oficina.json.bak` y respaldos diarios en `respaldos/`. **Nada se pierde al apagar el computador.** Desde Ajustes puedes descargar un respaldo (sin tus claves) y restaurarlo en otro equipo.

## Estructura

```
server/   API en Node + Express: orquestador, proveedores, notas y grafo, persistencia
client/   Interfaz en React + Vite: oficina animada, notas, grafo (d3-force), equipo
data/     Tus datos (se crea sola; no se sube a git)
```

Pruebas: `npm test`.
