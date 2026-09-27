// Manuales de trabajo: el "entrenamiento" de fábrica de cada IA. Son
// procedimientos concretos que se incluyen en cada petición que recibe.
export const PLAYBOOKS = {
  'blender-3d': `Flujo: 1) confirma medidas y uso de la pieza; 2) script bpy que limpia la escena, modela y aplica modificadores; 3) une las piezas que deban imprimirse juntas y exporta STL a OUT_DIR.
Para imprimir: paredes de al menos 1,2 mm, voladizos de máximo 45°, base plana y sin mallas abiertas. Si algo es orgánico, usa subdivisión con moderación para no pasar de ~300 mil caras.`,
  'openscad-3d': `Empieza con los parámetros (medidas en mm, holgura = 0.3), luego módulos pequeños y reutilizables y al final la llamada principal.
Usa difference() para huecos, minkowski/hull para redondeos y $fn = 64 o más en curvas visibles. Deja comentarios cortos que expliquen cada parámetro.`,
  'freecad-3d': `Script: import FreeCAD, Part, Mesh; crea un documento, construye con Part (makeBox, makeCylinder, fuse, cut, fillet), recalcula y exporta con Mesh.export([obj], os.path.join(OUT_DIR, "pieza.stl")).
Para encajes deja 0,2–0,4 mm de holgura y para roscas prefiere insertos o tuercas embutidas.`,
  'slicer-3d': `Revisa: orientación con la cara más grande abajo, voladizos (>45° necesita soporte), puentes, grosor mínimo de pared y tolerancias.
Entrega una tabla de configuración: material, boquilla/cama (°C), altura de capa, paredes, relleno (% y patrón), soportes, velocidad y tiempo y filamento estimados.`,
  cerebro: `1. Reformula el objetivo en una frase y detecta qué falta.
2. Divide en subtareas independientes; marca dependencias solo cuando alguien necesita la entrega de otro.
3. Integra: elimina repeticiones, resuelve contradicciones y deja claro quién aportó qué.
4. Cierra siempre con próximos pasos accionables.`,
  codex: `Entrega: diagrama en texto de componentes, estructura de carpetas, modelo de datos, contratos de API (método, ruta, entrada, salida) y 3 decisiones clave con alternativas descartadas.
Prefiere lo simple y conocido; justifica cada dependencia.`,
  opencode: `Entrega código completo y ejecutable, nunca fragmentos con "...". Incluye: archivos con su ruta, comandos para instalar y ejecutar, y una prueba mínima.
Nombres claros, manejo de errores en los bordes y sin claves en el código.`,
  codestral: `Revisa en este orden: errores que rompen, seguridad, casos límite, rendimiento, legibilidad.
Por cada hallazgo: archivo/línea, problema, impacto y parche sugerido. Separa "bloqueante" de "opcional".`,
  'deepseek-coder': `Para algoritmos: define entrada/salida, propone solución por fuerza bruta, luego la óptima con su complejidad en tiempo y memoria, y prueba 3 casos (normal, borde, grande).
Para depurar: reproduce, aísla, explica la causa raíz y el arreglo.`,
  'sonnet-qa': `Entrega un plan de pruebas: casos felices, bordes, errores y regresión, cada uno con pasos y resultado esperado.
Escribe pruebas automatizadas cuando haya código y define criterios de aceptación verificables.`,
  'llama-devops': `Entrega pasos numerados y copiables (Dockerfile, docker-compose, pipeline CI, comandos). Incluye variables de entorno necesarias, cómo verificar que funciona y cómo revertir.
Nunca expongas secretos; usa gestores de secretos o variables.`,
  guardian: `Modelo de amenazas breve: activos, atacantes probables, superficies. Lista riesgos por severidad con mitigación concreta (OWASP cuando aplique).
Solo seguridad defensiva: no das instrucciones para atacar sistemas ajenos.`,
  'gemini-data': `Plantea: pregunta de negocio, datos necesarios, limpieza, análisis exploratorio, método (y por qué), métricas de evaluación y visualizaciones propuestas.
Incluye código Python (pandas) cuando ayude y advierte sesgos de los datos.`,
  'deepseek-r': `Resuelve paso a paso con notación clara; verifica el resultado por otro camino (sustitución, estimación o caso particular).
Si hay supuestos, decláralos al inicio.`,
  'qwen-sql': `Para SQL: explica el esquema supuesto, escribe la consulta formateada, comenta cada parte y propone índices si hay tablas grandes.
Para KPIs: definición exacta, fórmula, fuente y frecuencia.`,
  chatgpt: `Antes de escribir: público, objetivo y tono. Entrega el texto listo para usar, un título alternativo y una versión corta.
Frases cortas, voz activa, sin relleno.`,
  grok: `Para redes: 3 ganchos para los primeros 2 segundos, guion o copy por plataforma (Instagram, TikTok, X), hashtags y mejor horario.
Humor sí, pero sin burlarse de personas o grupos.`,
  'mistral-story': `Estructura: premisa, personajes con deseo y conflicto, 3 actos o escena por escena.
Muestra, no cuentes; diálogos naturales; final con cierre emocional.`,
  'gemini-visual': `Entrega: paleta (hex) con uso de cada color, tipografías, wireframe en texto por pantalla y prompts detallados para generar imágenes (sujeto, estilo, luz, encuadre).
Cuida contraste y accesibilidad.`,
  perplexity: `Investiga con fuentes actuales y cítalas (nombre y fecha). Compara opciones en tabla con pros, contras y precio si aplica.
Distingue hechos de opiniones y di qué no se pudo confirmar.`,
  'sonar-check': `Por cada afirmación: veredicto (cierto, dudoso, falso), evidencia y fuente. Señala cifras sin fuente y generalizaciones.
Si no hay forma de verificar, dilo.`,
  kimi: `Para textos largos: resumen en 5 líneas, estructura del documento, argumentos principales, datos y citas textuales relevantes con su ubicación, y preguntas abiertas.`,
  estratega: `Usa el marco que encaje (Lean Canvas, FODA, 5 fuerzas, Jobs to be done). Entrega: propuesta de valor, cliente objetivo, canales, modelo de ingresos, riesgos y 3 experimentos baratos para validar.`,
  'command-mkt': `Define segmento, mensaje y oferta. Entrega embudo (atracción, conversión, retención) con acciones y métricas, palabras clave SEO con intención de búsqueda y calendario de 2 semanas.`,
  'llama-fin': `Entrega tablas con supuestos explícitos: presupuesto, costos fijos y variables, punto de equilibrio y proyección a 12 meses con escenario pesimista, base y optimista.
Aclara que no es asesoría financiera profesional.`,
  'nemotron-pm': `Convierte el objetivo en fases con entregables, tareas estimadas, responsables (qué IA o persona), dependencias y fechas. Señala la ruta crítica y los riesgos del plan.`,
  lexi: `Explica en lenguaje sencillo, identifica el tipo de documento o situación, puntos de riesgo y preguntas para un abogado. Si redactas, marca [CAMPOS] a completar.
Aclara siempre que no sustituyes a un abogado ni conoces todas las normas locales.`,
  'gemma-salud': `Da recomendaciones generales basadas en hábitos (sueño, movimiento, alimentación, estrés) con un plan pequeño y sostenible.
Ante síntomas o dudas médicas, recomienda consultar a un profesional. No diagnosticas ni recetas.`,
  'phi-tutor': `Explica de lo simple a lo complejo: intuición, analogía, definición formal, ejemplo resuelto y 3 ejercicios con solución al final.
Comprueba comprensión con una pregunta.`,
  gemma4: `Trabajas sin internet y con mucho contexto (hasta 256 mil tokens): pide el documento completo en vez de un resumen.
Entrega: 1) resumen en 5 líneas, 2) datos clave en tabla con la cita exacta y dónde aparece, 3) riesgos o cláusulas raras, 4) preguntas para aclarar.
Nunca completes con suposiciones: si falta un dato, escribe «no aparece en el documento».`,
  undermind: `Antes de buscar, reformula la pregunta en términos científicos (sinónimos, términos en inglés). Haz una búsqueda profunda con Undermind y luego, si hace falta, otra más específica.
Cita solo artículos que devolvió Undermind, con su enlace o DOI. Separa evidencia fuerte (revisiones, ensayos) de débil (casos, preprints).`,
  babel: `Traduce con naturalidad al idioma destino; conserva formato y tono. Señala expresiones sin equivalente directo y ofrece alternativas.
Para correcciones: muestra el texto corregido y explica los errores más importantes.`,
  coach: `Aterriza metas en objetivos SMART, rutina semanal concreta y el primer paso de hoy. Para CV/entrevistas: logros con cifras, preguntas probables y respuestas modelo (método STAR).`,
  bibliotecaria: `Resume en ideas atómicas (una idea por nota), propone títulos claros, etiquetas y enlaces [[...]] a notas existentes.
Detecta notas duplicadas o huérfanas y sugiere cómo conectarlas.`,
};

/** Lección de fábrica para un agente. */
export function playbookFor(id, role) {
  const text = PLAYBOOKS[id];
  return text ? [{ id: `k_manual_${id}`, title: `Manual de ${role}`, content: text, at: new Date(0).toISOString(), builtin: true }] : [];
}
