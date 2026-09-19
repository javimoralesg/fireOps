# Grafo de conocimiento, IA y aprendizaje

Dueño: **constructor C**. Cubre `lib/ia/**`, `lib/conocimiento/**`, `lib/aprendizaje/**`,
los agentes `supervisor`, `memoria` y `redactor`, y las pantallas `/conocimiento`,
`/informes` y `/aprendizaje`.

Principio que manda sobre todo lo demás: **si falta un proveedor, sale un error visible;
nunca una respuesta inventada.** Un sistema que se inventa qué dice el BOE en una
evacuación es peor que no tener sistema.

---

## 1. Capa de IA (`lib/ia/llm.ts`)

Proveedores compatibles con la API de OpenAI a través del SDK `openai` 7.19.0.
`LLM_PROVEEDOR` elige: `helmcode` (por defecto), `groq` u `openai`.
`LLM_VISION_PROVEEDOR` permite usar otro solo para visión.

| Papel | Variable | Defecto HelmCode | Defecto Groq |
|---|---|---|---|
| `razonamiento` | `LLM_MODELO_RAZONAMIENTO` | `glm5.3-flash` | `openai/gpt-oss-120b` |
| `rapido` | `LLM_MODELO_RAPIDO` | `qwen3.6` | `openai/gpt-oss-20b` |
| `vision` | `LLM_MODELO_VISION` | `qwen3.6` | `qwen/qwen3.8-27b` |
| transcripción | `LLM_MODELO_TRANSCRIPCION` | `whisper` | `whisper-large-v3-turbo` |
| voz | `LLM_MODELO_VOZ` | `kokoro` | — (Groq no tiene español) |

### Latencias medidas el 2026-09-19 con la clave real de HelmCode

Misma pregunta de supervisión, `json_schema` con `strict: true`:

| Modelo | Latencia | Tokens de salida | Apto para la sala |
|---|---:|---:|---|
| `qwen3.6` | 5,1 s | 836 | sí |
| `glm5.2` | 5,9 s | 804 | sí |
| `glm5.3-flash` | 6,1 s | 706 | sí |
| `deepseek-v4-flash` | **66 s** | 3.136 | **no**: razona demasiado |
| `gemma4` | > 90 s (timeout) | — | no |

Otras medidas del mismo día: texto libre con `deepseek-v4-flash` 2,2 s (236 tokens);
visión con `qwen3.6` sobre data URL base64, 2,5 s (395 tokens).

> **Matiz honesto sobre `deepseek-v4-flash`:** su latencia es MUY variable. En la
> misma prueba repetida ha dado 1,5 s (236 tokens) y 66 s (3.136 tokens): decide
> sobre la marcha cuánto razonar. Los `glm5.*` y `qwen3.6` son consistentes entre
> 5 y 6 s. Para el supervisor, que corre en el camino crítico de cada decisión,
> pesa más la consistencia que el mejor caso.

> **Aviso operativo.** `deepseek-v4-flash` produce buenas respuestas pero tarda un minuto
> por llamada cuando se le pide JSON estructurado, porque gasta miles de tokens en
> `reasoning_content`. El supervisor evalúa **cada** decisión de forma síncrona: con ese
> modelo, la sala se atasca. Por eso el defecto del código es `glm5.3-flash`.
> `.env.local` tiene `LLM_MODELO_RAZONAMIENTO=deepseek-v4-flash` y **anula** ese defecto:
> ver la petición a A en `docs/REPARTO.md`.

### Salida estructurada

`completarJson({system, user, esquema, papel, imagenes?, maxTokens?, signal?})`:

1. `response_format: {type: "json_schema", json_schema: {name, strict: true, schema}}`,
   donde el esquema sale de `z.toJSONSchema()` (zod v4) y se **endurece**: todo objeto
   lleva `additionalProperties: false`, `required` con todas sus claves, y se quitan las
   palabras clave que los proveedores rechazan en modo estricto (`minLength`, `pattern`,
   `format`, `minimum`…).
2. Si el proveedor devuelve 400 quejándose del esquema, se repite con `json_object`
   metiendo el JSON Schema en el `system`, y se valida con zod.
3. Si la validación falla, **un** reintento de reparación enseñándole su salida y el error.
4. Si tampoco, se lanza un error claro. No hay plan C inventado.

Nunca se combinan `json_schema` con `tools` ni con `stream`: Groq lo prohíbe
explícitamente y aquí no hace falta ninguno de los dos.

### Detalles que costaron una prueba cada uno

- **`content: null` tras razonar.** `qwen3.6` y `deepseek-v4-flash` piensan antes de
  responder; con un tope bajo de tokens se lo gastan pensando y devuelven contenido vacío.
  Se fuerza un mínimo de `LLM_MIN_TOKENS` (1500) y, si aun así vuelve vacío, se reintenta
  una vez con el doble. `chat_template_kwargs: {enable_thinking: false}` **no** funciona:
  HelmCode lo ignora.
- **429.** Se respeta la cabecera `retry-after` una vez; si vuelve a fallar, error con el
  límite del proveedor escrito en el mensaje.
- **Trazas.** Cada llamada (chat, visión, embeddings, audio) llama a `anotarLlamadaIA` de
  `lib/motor/traza.ts`, así que los visores de agentes enseñan modelo, latencia, tokens y
  un resumen del prompt y de la respuesta.
- **Contadores.** `estadisticasLLM()` devuelve llamadas, tokens, errores y latencia media
  por papel; sale en `/api/aprendizaje` y en la pantalla `/aprendizaje`.

Además: `transcribirAudio(bytes, mime)` (Whisper, `language: "es"`) y
`sintetizarVoz(texto)` (kokoro) para quien las necesite.

---

## 2. Embeddings (`lib/ia/embeddings.ts`)

| Proveedor | Modelo | Dimensiones | Clave |
|---|---|---|---|
| `helmcode` (defecto) | `qwen3-embedding` | `dimensions` a la carta | `HELMCODE_API_KEY` |
| `local` (respaldo) | `Xenova/multilingual-e5-small` q8 | 384 nativas | ninguna |
| `jina` | `jina-embeddings-v5-text-small` | a la carta | `JINA_API_KEY` |
| `openai` | `text-embedding-3-small` | a la carta | `OPENAI_API_KEY` |

**`EMBEDDINGS_DIMENSIONES` = 512 por defecto.** Verificado contra la API de HelmCode: los
valores permitidos son 32, 64, 128, 256, 512, 768, 1024, 1536, 2048 y 4096. **384 está
prohibido**, así que el `vector(N)` del esquema de Supabase es `vector(512)`.

- Prefijos E5 obligatorios: `incrustarConsulta()` antepone `"query: "` e
  `incrustarPasajes()` `"passage: "`. Medido: coseno 0,615 entre la pregunta y el pasaje
  relevante frente a 0,222 con uno irrelevante.
- Si el proveedor devuelve más dimensiones de las pedidas, se trunca (Qwen3-Embedding está
  entrenado con Matryoshka y lo tolera) y se renormaliza L2.
- **Modo degradado:** si falta `HELMCODE_API_KEY` se cae al modelo local, que da 384 y se
  rellena con ceros hasta 512. Esos vectores **no son comparables** con los de
  `qwen3-embedding`: hay que reindexar. La pantalla `/aprendizaje` lo avisa.
- `precalentar()` descarga y carga el modelo local por adelantado (en Railway son ~120 MB
  en el primer arranque). Lo llama `scripts/sembrar-conocimiento.ts`.
- `next.config.ts` ya declara `serverExternalPackages: ["@huggingface/transformers",
  "onnxruntime-node", "sharp"]`, que es lo que hace falta en Node 24.

**Latencia medida (HelmCode, 512 dims):** 31 ms por texto sembrando 682 fragmentos en
lotes de 16; 169 ms una consulta suelta.

---

## 3. Corpus (`data/protocolos/`)

| Fichero | Qué es | Origen |
|---|---|---|
| `rd-893-2013-directriz-incendios-forestales.md` | Directriz básica de planificación de protección civil de emergencia por incendios forestales | BOE-A-2013-12823 (XML consolidado) |
| `ley-43-2003-montes.md` | Ley de Montes, **extracto**: capítulo de incendios forestales (arts. 43-50) y lo que los menciona | BOE-A-2003-21339 |
| `ley-17-2015-sistema-nacional-proteccion-civil.md` | Ley del Sistema Nacional de Protección Civil | BOE-A-2015-7730 |
| `rd-524-2023-norma-basica-proteccion-civil.md` | Norma Básica de Protección Civil | BOE-A-2023-14679 |
| `rd-393-2007-norma-basica-autoproteccion.md` | Norma Básica de Autoprotección | BOE-A-2007-6237 |

Los dos primeros se descargaron del BOE en XML consolidado y se convirtieron a markdown
con una sección `##` por artículo, capítulo, anexo o disposición; los tres últimos vienen
del corpus ya generado de `crisis-mando-ai`. Cada fichero conserva su cabecera YAML con
`identificador`, `url` oficial, fecha de descarga y vigencia: **toda cita es rastreable
hasta el BOE**.

Para añadir más normativa: arrastrarla en `/conocimiento` (.txt o .md, 2 MB) o dejar el
fichero en `data/protocolos/` y volver a sembrar.

---

## 4. Ingesta (`lib/conocimiento/ingesta.ts`)

`ingerirDocumento({nombreArchivo, titulo?, texto, ambito, territorio?})`:

1. **Troceado** por estructura, no por longitud ciega: encabezados markdown, `Artículo N`,
   `CAPÍTULO`, `TÍTULO`, `ANEXO`, `SECCIÓN`, disposiciones, y epígrafes con enunciado del
   tipo `3.4.1 Órganos de coordinación…:` o `e) Confinamiento, evacuación y albergue:`.
   Dentro de cada sección, trozos de ~700 caracteres con 100 de solape; los párrafos
   kilométricos del BOE se parten por frases.
2. **Entidades** por regex (organismos, cargos como «Director del Plan», niveles como
   «Nivel 2» o «Situación operativa 2», acciones como evacuación o confinamiento) y, en
   los primeros lotes, también con el modelo rápido. Es tolerante: si el LLM falla o no
   hay clave, se queda con la regex y sigue.
   `CONOCIMIENTO_MAX_LOTES_LLM` (3 por defecto, 0 lo desactiva) limita el gasto: cada lote
   de 10 fragmentos cuesta 10-17 s con `qwen3.6`.
3. **Relaciones**: `sigue` (fragmento anterior y siguiente) y `referencia` (una mención a
   «artículo N» apunta al fragmento que encabeza ese artículo). Las aristas `menciona` las
   deriva el grafo de las entidades.
4. **Embeddings** por lotes, con la sección antepuesta al texto.
5. **Guardado** en el índice en memoria, en `data/conocimiento/indice.json` y, si hay
   credenciales, en Supabase (`documentos` y `chunks`). Si Supabase falla, se avisa por
   consola y la demo sigue: el fichero basta.

---

## 5. Consulta (`lib/conocimiento/consulta.ts`)

`buscarFundamentos(pregunta, {k, territorio})`:

1. Embedding de la pregunta con prefijo `query:`.
2. Top-k por coseno: RPC `buscar_chunks(consulta, k, territorio)` en Supabase si responde;
   si no, el índice en memoria.
3. **Expansión por grafo** (esto es lo que lo hace un grafo y no una lista de vectores):
   - toda **referencia cruzada** entra siempre, porque es el salto que daría un jurista;
   - el **fragmento siguiente** entra solo si además se parece a la pregunta
     (`CONOCIMIENTO_UMBRAL_VECINO`, 0,35).
4. Devuelve `Fundamento[]` con cita de ≤ 300 caracteres, documento, sección y similitud.
   `buscarFundamentosExplicados()` añade **por qué** entró cada uno (`vector`,
   `referencia` o `siguiente`), que es lo que pinta `/conocimiento`.

`consultarProtocolo(pregunta)` pasa esos fundamentos al modelo de razonamiento con la
instrucción de responder **solo** con ellos, citando `[Documento §sección]`, y de decir
literalmente «Los documentos indexados no lo dicen» cuando no estén. Comprobado: ante
«¿Quién puede ordenar la evacuación de un pueblo en un incendio de nivel 2?» el modelo
responde justo eso y enumera qué normativa autonómica habría que indexar. Eso es lo
correcto, no un fallo.

`obtenerGrafo(documentoId?)` (`lib/conocimiento/grafo.ts`) devuelve como mucho ~400 nodos
(`CONOCIMIENTO_MAX_NODOS`), repartidos entre documentos para que ninguno acapare la
pantalla.

---

## 6. Aprendizaje (`lib/aprendizaje/memoria.ts`)

- `leccionesPara(agenteId, contexto, k)` — embedding del contexto, RPC `buscar_lecciones`
  o memoria, orden por `similitud × peso`, filtrando por agente o `"*"`. Sube
  `vecesAplicada` y el peso de forma diferida para no bloquear el ciclo.
- `registrarLeccion(l)` — embedding + memoria + `data/aprendizaje/lecciones.json` +
  Supabase.
- `extraerLecciones(evento, decision?, comentarioHumano?)` — el modelo de razonamiento
  convierte un hecho en una lección accionable. Por orden de valor probatorio: denegación
  humana con su comentario, aprobación comentada, acción fallida, puntuación baja del
  supervisor. Se descartan duplicados con similitud > 0,92
  (`APRENDIZAJE_UMBRAL_DUPLICADO`).
- `compararConAnterior(ejecucion)` — **sin LLM**: son cifras y las cifras se cuentan, no se
  redactan. Compara tiempos hasta el primer aviso y el primer despliegue, denegaciones,
  escalados, pueblos avisados y sin avisar, nota media del supervisor y falsos positivos
  de cámara, y devuelve un párrafo del tipo «Respecto a la ejecución anterior (…): el
  primer aviso a población tardó 6 min frente a 14 (mejor); 2 decisiones denegadas…».
- `listarEjecuciones()` usa `@/lib/db/repositorio` por import dinámico tolerante y, si no
  existe, `data/aprendizaje/ejecuciones.json`.

---

## 7. Agentes

### `supervisor` (supervisión, cadencia 120 s, despierta con `decision_propuesta`, `agente`)

`evaluarDecision(d, ctx)` lo llama el núcleo **de forma síncrona** en el pipeline de cada
decisión. Rúbrica de seis criterios: fundamentación, prioridad, coherencia, legalidad,
claridad y proporcionalidad. Aprueba si la nota global ≥
`politica.puntuacionMinimaSupervisor` **y** ningún criterio baja de 40
(`SUPERVISOR_MINIMO_CRITERIO`); si no, escribe `motivoEscalado` en una frase para el
humano.

Su ciclo vigila a los demás: ≥ 3 errores seguidos o silencio de más de 3× su cadencia →
evento `agente` de nivel aviso; ≥ 5 errores → lo **pausa** y lanza un evento crítico. Un
agente roto que sigue proponiendo es peor que un agente parado.

### `memoria` (aprendizaje, cadencia 300 s)

Despierta con `decision_denegada`, `decision_aprobada`, `accion_fallida`,
`accion_ejecutada` y `decision_escalada`. Procesa los eventos nuevos desde su último ciclo
(guarda el último id), como mucho `APRENDIZAJE_MAX_POR_CICLO` (3) por ciclo y dando
prioridad a las denegaciones. En su primer ciclo de cada ejecución escribe
`ejecucion.comparativa` y publica un evento `leccion` con las tres lecciones de más peso
que va a aplicar.

### `redactor` (comunicación, cadencia 600 s)

`redactarInforme(decision, ctx, {tipo?, accionId?})`. **El acta es determinista y nunca
falla**: primero se compone un markdown solo con hechos (cabecera con ids y huella,
historial de estados con quién y por qué, situación con meteo y su URL, la decisión, la
acción con su proveedor y referencia externa y su resultado real, la evaluación del
supervisor, fundamentos y evidencias con URL, lecciones aplicadas, decisiones previas y la
traza del ciclo con cada llamada de IA). **Después**, si hay proveedor y responde en menos
de 20 s (`INFORMES_TIMEOUT_NARRATIVA_MS`), se añade la sección «Análisis» y
`conNarrativaIA: true`; si no, el acta se guarda igual con `conNarrativaIA: false`.

Cada acta lleva al pie su **huella SHA-256** (`node:crypto`), también en `informe.huella`:
si alguien la edita, se nota.

Los parámetros de las acciones se escriben filtrando claves, tokens y contraseñas: un acta
no es sitio para un secreto.

Su ciclo propio saca un parte de situación cada 30 minutos de mundo
(`INFORMES_MINUTOS_SITUACION`).

---

## 8. API y pantallas

| Ruta | Método | Qué hace |
|---|---|---|
| `/api/conocimiento/documentos` | GET | Documentos, resumen del índice y estadísticas de embeddings |
| `/api/conocimiento/documentos` | POST | Subida multipart (`archivos`, `ambito`, `territorio`) o JSON `{nombreArchivo, texto, ambito, territorio}`; máximo 2 MB |
| `/api/conocimiento/documentos/[id]` | DELETE | Borra el documento y sus fragmentos |
| `/api/conocimiento/grafo` | GET | `?documentoId=` el grafo; `?chunkId=` un fragmento entero |
| `/api/conocimiento/consultar` | POST | `{pregunta, territorio?, k?}` → `ConsultaConocimiento` + `explicados` |
| `/api/aprendizaje` | GET | Ejecuciones con métricas y comparativa, lecciones, uso de modelos |
| `/api/informes` | GET | Filtros `incendioId`, `tipo`, `agenteId`, `decisionId`, `estadoDecision` |
| `/api/informes/[id]` | GET | El acta completa; `?formato=md` la descarga |

- **`/conocimiento`** — buscador «¿Cómo procedo si…?» con la respuesta y los fragmentos
  consultados (similitud y motivo: vector o vecino del grafo), subida por arrastrar y
  soltar con ámbito y territorio, lista de documentos y visor del grafo en SVG con layout
  de fuerzas propio (sin dependencias nuevas), coloreado por tipo y con clic para leer el
  fragmento.
- **`/informes`** — filtros por tipo, incendio, agente y estado; visor markdown
  (`react-markdown` + `remark-gfm`), huella visible, descarga de un acta o de todas
  (usa `GET /api/auditoria/exportar` de A si existe y, si no, las concatena).
- **`/aprendizaje`** — panel «qué cambió esta vez», tabla de ejecuciones con métricas,
  lecciones con peso, veces aplicada, origen y agente, y uso real de los modelos.

Todas enlazan de vuelta a `/`.

---

## 9. Cómo probarlo

```bash
# 1. Capa de IA completa (razonamiento, rápido, texto, visión, embeddings y RAG)
npx tsx scripts/probar-ia.ts

# 2. Sembrar el corpus (idempotente; --forzar reindexa)
npx tsx scripts/sembrar-conocimiento.ts
npx tsx scripts/sembrar-conocimiento.ts --forzar \
  --consulta "¿Quién puede ordenar la evacuación de un pueblo en un incendio de nivel 2?"

# 3. La aplicación
PORT=3103 npx next dev     # /conocimiento, /informes, /aprendizaje
```

Para comprobar que **sin clave falla de forma visible y no se inventa nada**:

```bash
HELMCODE_API_KEY= LLM_PROVEEDOR=helmcode npx tsx scripts/probar-ia.ts
```

Debe fallar cada prueba con «Sin proveedor de IA: falta HELMCODE_API_KEY…», y la pantalla
`/conocimiento` debe enseñar ese mismo texto en un aviso, devolviendo aun así los
fragmentos recuperados (los embeddings tienen respaldo local): la norma se puede leer
aunque nadie la resuma.

---

## 10. Variables de entorno propias

| Variable | Defecto | Para qué |
|---|---|---|
| `LLM_PROVEEDOR` | `helmcode` | `helmcode`, `groq` u `openai` |
| `LLM_VISION_PROVEEDOR` | — | Proveedor distinto solo para visión |
| `LLM_MODELO_RAZONAMIENTO` / `_RAPIDO` / `_VISION` | ver §1 | Modelo por papel |
| `LLM_MODELO_TRANSCRIPCION` / `LLM_MODELO_VOZ` / `LLM_VOZ` | ver §1 | Whisper y kokoro |
| `LLM_TIMEOUT_MS` | 90000 | Tiempo máximo por llamada |
| `LLM_MAX_TOKENS` | 4096 | Tope de salida por defecto |
| `LLM_MIN_TOKENS` | 1500 | Mínimo para modelos que razonan antes de responder |
| `EMBEDDINGS_PROVEEDOR` / `_MODELO` / `_DIMENSIONES` / `_LOTE` | `helmcode` / `qwen3-embedding` / 512 / 16 | Embeddings |
| `CONOCIMIENTO_TAMANO_CHUNK` / `_SOLAPE_CHUNK` | 700 / 100 | Troceado |
| `CONOCIMIENTO_MAX_LOTES_LLM` | 3 | Lotes de entidades por LLM y documento (0 lo desactiva) |
| `CONOCIMIENTO_K` / `_UMBRAL_VECINO` / `_MAX_NODOS` | 6 / 0,35 / 400 | Consulta y grafo |
| `APRENDIZAJE_UMBRAL_DUPLICADO` / `_MAX_POR_CICLO` | 0,92 / 3 | Lecciones |
| `SUPERVISOR_MINIMO_CRITERIO` | 40 | Nota mínima por criterio |
| `INFORMES_MINUTOS_SITUACION` / `_TIMEOUT_NARRATIVA_MS` | 30 / 20000 | Redactor |
