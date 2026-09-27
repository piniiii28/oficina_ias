# Oficina de IAs: guía para desarrollar

App web local: un servidor Node (Express) y una interfaz en React + Vite. Todo el texto de la interfaz, los comentarios y los mensajes de commit van en **español**.

## Comandos

- `npm install`: instala todo (usa workspaces `server` y `client`).
- `npm run dev`: servidor en :4747 con recarga, y Vite en :5173 (redirige `/api` al servidor).
- `npm start`: compila la interfaz y sirve todo en http://localhost:4747.
- `npm test`: pruebas del servidor (`node --test`, en `server/test/`).
- `npm run build`: comprueba tipos (`tsc -b`) y compila la interfaz.

Antes de hacer commit, ejecuta `npm test` y `npm run build`.

## Estructura

- `server/src/index.js`: rutas de la API, eventos en vivo (SSE en `/api/events`) y la seguridad (solo localhost; se rechazan Host u Origin externos).
- `server/src/orchestrator.js`: el cerebro. Contiene:
  - `runTask`: plan, pasos con dependencias ejecutados por `runGraph`, síntesis, revisión opcional y notas.
  - `chatWithAgent`, `selfTrain` y `dailySummary`.
  - `streamer()`, que envía el texto en vivo.
- `server/src/providers.js`: Anthropic (SDK oficial, con streaming), los proveedores compatibles con OpenAI, Gemini y las CLIs. Sin clave responde el modo demo (`demo.js`). Cada proveedor tiene `tier` (gratis, mixto, suscripción o pago) y puede tener varias cuentas (`settings.accounts`); `credentials()` da el orden y, si una cuenta se queda sin cupo, se usa la siguiente.
- `server/src/freeModels.js`: modelos gratis recomendados y el «modo gratis».
- `server/src/cad.js`: Taller 3D. Detecta Blender, OpenSCAD, FreeCAD y laminadores, y ejecuta los scripts en `data/taller3d/`. `system.js` abre terminales, instala CLIs y abre archivos.
- `server/src/access.js`: accesos con permiso. Las IAs escriben acciones (`<<buscar ruta="…">>`, `<<abrir … programa="blender">>`…); `callWithAccess` las ejecuta si hay permiso o pide aprobación (evento `access`) y le devuelve los resultados a la IA.
- `server/src/blender.js` y `server/addons/oficina_ias.py`: Blender en vivo. El complemento abre un socket en 127.0.0.1:9877 con una clave (`settings.blenderToken`); las IAs usan `<<blender-escena>>`, `<<blender-ejecutar>>…<</blender-ejecutar>>`, `<<blender-captura>>`, `<<blender-guardar>>` y `<<blender-stl>>`, con permiso.
- `server/src/auth.js`: usuarios, sesiones y acceso por Tailscale. En este computador no hay que iniciar sesión; desde otro, sí. `needsAdmin` lista lo que un miembro no puede hacer.
- `server/src/automations.js`: n8n (webhooks salientes y entrantes con token en `/api/hooks/<token>/…`).
- `server/src/bambu.js`: impresora Bambu Lab por MQTT local (8883) y cámara (6000). `mcp/oficina-mcp.mjs`: servidor MCP para Claude Desktop (usa `settings.apiToken`).
- `server/src/metrics.js`: medidores de acierto y carga, verificador y jurado.
- `server/src/hubs.js`: núcleos del grafo (Cerebro, Nicolás, Santiago, Miguel…). El núcleo activo llega en el encabezado `X-Nucleo` y cada nota guarda su `hub`.
- `server/src/agents.js` y `playbooks.js`: la plantilla de IAs y sus manuales de fábrica.
- `server/src/notes.js`: notas, `[[enlaces]]`, `#etiquetas` y el grafo. `vault.js` escribe la bóveda `.md` para Obsidian.
- `librarian.js` (sugerencias y notas relacionadas), `meetings.js`, `routines.js`.
- `server/src/store.js`: persistencia en `oficina.json` (escritura atómica, copia `.bak` y respaldos diarios). La carpeta la decide `datadir.js` (por defecto Documentos/Oficina de IAs; en pruebas, `OFICINA_DATA` o `new Store(dir)`).
- `server/src/updater.js`: actualizaciones con git; `iniciar.bat` reinicia la oficina cuando sale con el código 75.
- `server/src/node.js` y `devices.js`: nodos (otros computadores por Tailscale) que prestan su impresora y su Ollama. El nodo enciende Ollama, descarga los modelos que le pide la principal (`/nodo/modelos`) y se actualiza (`/nodo/update`, código 75).
- `server/src/images.js`: imágenes. Las IAs escriben `<<imagen prompt="…" formato="16:9">>`; `callWithAccess` las genera (Pollinations, Cloudflare, Hugging Face o Gemini, según `settings.images`), las guarda en `imagenes/` y las sirve en `/api/images/<archivo>`.
- `server/src/video.js`: videos. `<<video prompt="…" escenas="a | b" formato="16:9">>`; gratis con imágenes + FFmpeg (`ffmpeg-static`), o Hailuo (MiniMax) y Veo (Gemini), de pago.
- `metrics.js` → `healthOf`: una IA con 2 fallas seguidas no recibe trabajo (`usableFilter` la excluye). `/api/agents/check` las revisa todas; `/api/agents/rescue` pasa las de demo a proveedores conectados (`rescuePlan`).
- `server/src/mcpServices.js`: servicios que se conectan por MCP a Claude Code (Undermind). La IA con `mcp: '<nombre>'` llama a Claude Code con `--allowedTools mcp__<nombre>` y solo está conectada si `settings.mcp.<nombre>.added`.
- `server/src/ollama.js`: varios Ollama a la vez. Cada IA elige el suyo en `agent.account` (`local`, `node:<id>`, `auto` o nada = el preferido `settings.ollamaNode`); `credentials()` los devuelve en orden y, si uno falla, se usa el siguiente.
- `client/src/state.tsx`: contexto global; recibe los eventos SSE (`agent`, `task`, `meeting`, `delta`, `notes`, `cards`).
- `client/src/views/*`: una vista por sección (`Taller.tsx` es el Taller 3D).
- `client/src/components/ConnectCenter.tsx`: conectar IAs paso a paso, cuentas, modo gratis y el asistente de conexión.
- `client/src/building/*`: el edificio isométrico estilo Habbo:
  - `layout.ts`: planos, muebles y búsqueda de caminos.
  - `useSim.ts`: la vida de las IAs (paseos, ascensor, energía, charlas, mascotas).
  - `Building.tsx`: el dibujo.
- `client/src/components/Chibi.tsx`: los avatares SVG, con disfraces (`costume`).

## Convenciones

- Los datos del usuario viven fuera del repositorio (Documentos/Oficina de IAs; `data/` y `oficina-datos.json` están en `.gitignore`). No subas claves.
- Las funciones nuevas del servidor llevan una prueba en `server/test/oficina.test.js`. Usa `demoMode: 'always'` para no llamar APIs.
- Los ids de modelos se pueden editar desde la interfaz, así que no los asumas fijos.
- Cambios visuales: revísalos en el navegador en tema claro y oscuro, y a 390 px de ancho.
