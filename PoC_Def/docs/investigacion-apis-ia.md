# Investigación de APIs de IA para la plataforma de gestión de incendios forestales

**Fecha de investigación:** 2026-09-19
**Contexto:** Next.js en Railway, agentes con inferencia rápida.
**Metodología:** todo lo marcado como verificado proviene de documentación oficial consultada hoy. Lo que no he podido confirmar está marcado como **NO VERIFICADO**.

---

## 1. GROQ

### 1.1 Aviso importante sobre el catálogo

**El catálogo de Groq ha cambiado sustancialmente.** Los modelos que aparecían en la pregunta original **ya no existen**:

- `meta-llama/llama-4-scout-17b-16e-instruct` — **NO está en el catálogo actual**
- `meta-llama/llama-4-maverick-*` — **NO está en el catálogo actual**
- `playai-tts` / `playai-tts-arabic` — **NO están en el catálogo actual** (sustituidos por Orpheus de Canopy Labs)
- `deepseek-r1-distill-*`, `qwen3-32b`, `moonshotai/kimi-k2` — **NO aparecen** en la página de modelos actual

La visión hoy en Groq la dan **modelos Qwen**, no Llama 4.

### 1.2 Tabla de modelos (fuente: https://console.groq.com/docs/models)

#### Production Models

| Model ID | Contexto | Max output | Velocidad | Tool calling | JSON mode | json_schema (strict) | Visión | Precio in/out (1M tok) |
|---|---|---|---|---|---|---|---|---|
| `llama-3.1-8b-instant` | 131.072 | 131.072 | ~560 t/s | Sí (paralelo) | Sí | **No** | No | NO VERIFICADO¹ |
| `llama-3.3-70b-versatile` | 131.072 | 32.768 | ~280 t/s | Sí (paralelo) | Sí | **No** | No | NO VERIFICADO¹ |
| `openai/gpt-oss-120b` | 131.072 | 65.536 | ~500 t/s | Sí | Sí | **Sí (strict)** | No | $0.15 / $0.60 (cached in $0.075) |
| `openai/gpt-oss-20b` | 131.072 | 65.536 | ~1000 t/s | Sí | Sí | **Sí (strict)** | No | $0.075 / $0.30 (cached in $0.037) |
| `whisper-large-v3` | — | — | — | — | — | — | — | $0.111 / hora de audio |
| `whisper-large-v3-turbo` | — | — | — | — | — | — | — | $0.04 / hora de audio |

¹ Fuentes de terceros (cloudzero, eesel, aipricing.guru) indican $0.59/$0.79 para `llama-3.3-70b-versatile` y afirman que **desde agosto/septiembre 2026 los modelos Llama requieren una conversación comercial Enterprise** y ya no son self-serve. La página oficial `/docs/models` los sigue listando como Production y aparecen en la doc de tool-use, pero **NO aparecen en la tabla de rate limits del plan gratuito**, lo que es coherente con esa afirmación. **Riesgo real: no asumas que tienes acceso a Llama con una clave gratuita.** Verifica con `GET /openai/v1/models` en cuanto tengas la clave.

#### Production Systems (agentes con herramientas integradas)

| System ID | Contexto | Max output | Velocidad | Notas |
|---|---|---|---|---|
| `groq/compound` | 131.072 | 8.192 | ~450 t/s | Sistema agéntico con búsqueda web y ejecución de código integradas |
| `groq/compound-mini` | 131.072 | 8.192 | ~450 t/s | Variante ligera |

#### Preview Models

| Model ID | Tipo | Notas |
|---|---|---|
| `qwen/qwen3.8-27b` | Chat multimodal | **Visión + razonamiento + tool use + json_schema strict** |
| `minimaxai/minimax-m2.7` | Chat razonador | Tool use paralelo, razonamiento |
| `openai/gpt-oss-safeguard-20b` | Clasificador de seguridad | json_schema best-effort |
| `meta-llama/llama-prompt-guard-2-22m` | Clasificador | Detección de prompt injection / jailbreak |
| `meta-llama/llama-prompt-guard-2-86m` | Clasificador | Ídem, mayor |
| `canopylabs/orpheus-v1-english` | TTS | **Solo inglés** |
| `canopylabs/orpheus-arabic-saudi` | TTS | **Solo árabe saudí** |

### 1.3 Visión — el mejor modelo y sus límites

Fuente: https://console.groq.com/docs/vision

Solo **dos modelos** tienen visión, y ambos son Qwen:

| | `qwen/qwen3.6-27b` | `qwen/qwen3.8-27b` |
|---|---|---|
| Contexto | 131K | 131.042 |
| Max output | NO VERIFICADO | 16.384 |
| **Imágenes por petición** | **5 máximo** | **3 máximo** |
| **Tokens por imagen** | **2.048** | **2.048** |
| **Tamaño máx. petición con image URL** | **20 MB** | **20 MB** |
| Max file size | NO VERIFICADO | 20 MB |
| Velocidad | NO VERIFICADO | ~450 t/s |
| Precio in/out (1M) | $0.30 / $0.90 (fuente terceros) | $0.80 / $4.00 |
| json_schema strict | No documentado | **Sí** |
| En tabla de rate limits free | **No aparece** | **Sí (30 RPM / 8K TPM)** |

> **Recomendación de visión: `qwen/qwen3.8-27b`.**
> Es el único de los dos que está listado simultáneamente en `/docs/models` (Preview), en la tabla de rate limits del plan gratuito y en la lista de modelos con `json_schema` en modo `strict`. Eso significa que puedes pedirle salida estructurada garantizada al analizar un frame de cámara.
>
> **`qwen/qwen3.6-27b` está PARCIALMENTE VERIFICADO:** aparece en las páginas de visión, razonamiento y tool-use, y tiene página propia en `console.groq.com/docs/model/qwen/qwen3.6-27b`, pero **NO aparece ni en la tabla de modelos de `/docs/models` ni en la tabla de rate limits**. Puede estar en retirada o restringido al plan de pago. No lo pongas en el camino crítico de la demo.

Formatos aceptados: **base64 inline** (`data:image/jpeg;base64,...`) y **URL remota**. Ambos documentados.

```bash
# Visión con URL remota
curl https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen/qwen3.8-27b",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "What'\''s in this image?"},
        {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
      ]
    }]
  }'
```

```javascript
// Visión con base64 desde Node (frame de cámara)
const b64 = frameBuffer.toString("base64");
const res = await client.chat.completions.create({
  model: "qwen/qwen3.8-27b",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "¿Hay humo o llamas visibles? Responde en JSON." },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }
    ]
  }]
});
```

**Cálculo crítico para cámaras en tier gratuito:** el límite es **8.000 TPM** para `qwen/qwen3.8-27b` y cada imagen consume **2.048 tokens**. Eso da un techo teórico de **~3 imágenes por minuto** (menos, contando el prompt de texto y la salida). Si quieres analizar cámaras "cada X segundos", con clave gratuita **X no puede bajar de ~20-25 segundos** para una sola cámara. Con varias cámaras, necesitas plan de pago o muestreo por turnos.

### 1.4 Modelos de razonamiento

Fuente: https://console.groq.com/docs/reasoning

Seis modelos soportan razonamiento:

| Model ID | Velocidad | reasoning_effort |
|---|---|---|
| `openai/gpt-oss-20b` | ~1000 t/s | `low`, `medium`, `high` |
| `openai/gpt-oss-120b` | ~500 t/s | `low`, `medium`, `high` |
| `openai/gpt-oss-safeguard-20b` | NO VERIFICADO | `low`, `medium`, `high` |
| `qwen/qwen3.6-27b` | NO VERIFICADO | `none`, `default`, `low`, `medium`, `high` |
| `qwen/qwen3.8-27b` | ~450 t/s | `none`, `default`, `low`, `medium`, `high` |
| `minimaxai/minimax-m2.7` | NO VERIFICADO | NO VERIFICADO |

Parámetros de control:

- **`reasoning_effort`** — intensidad del razonamiento (valores por modelo arriba).
- **`reasoning_format`** — solo para modelos **no** GPT-OSS:
  - `parsed`: separa el razonamiento en un campo dedicado `message.reasoning`
  - `raw`: incluye el razonamiento dentro de etiquetas `<think>` en el contenido
  - `hidden`: devuelve solo la respuesta final
- **`include_reasoning`** (booleano) — para modelos GPT-OSS, en lugar de `reasoning_format`.

> Recomendación de la propia doc de Groq: **"Avoid system prompts - include all instructions in the user message"** con modelos de razonamiento.

### 1.5 Structured outputs / JSON mode

Fuente: https://console.groq.com/docs/structured-outputs

| Modo | Modelos soportados |
|---|---|
| `json_schema` con **`strict: true`** (decodificación restringida, garantía de esquema) | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` |
| `json_schema` con `strict: false` (best-effort) | Los tres anteriores + `openai/gpt-oss-safeguard-20b` |
| `json_object` (JSON válido, sin garantía de esquema) | **Todos** los modelos |

```json
{
  "model": "openai/gpt-oss-20b",
  "messages": [
    { "role": "system", "content": "Extract product review information from the text." },
    { "role": "user", "content": "I bought the UltraSound Headphones last week and I'm really impressed!" }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "product_review",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "product_name": { "type": "string" },
          "rating": { "type": "number" }
        },
        "required": ["product_name", "rating"],
        "additionalProperties": false
      }
    }
  }
}
```

> ### LIMITACIÓN CRÍTICA PARA EL DISEÑO DE AGENTES
> Cita literal de la documentación:
>
> **"Streaming and tool use are not currently supported with Structured Outputs"**
>
> **No puedes combinar `response_format: json_schema` con `tools` en la misma llamada, ni con `stream: true`.** Esto condiciona la arquitectura de los agentes: hay que separar la fase de *tool calling* (sin `response_format`) de la fase de *salida estructurada final* (sin `tools`), en dos llamadas distintas. Si necesitas streaming hacia la consola SSE, usa `json_object` en lugar de `json_schema`.

Requisitos adicionales del modo `strict`: todos los campos deben estar en `required` y el esquema debe declarar `additionalProperties: false`.

### 1.6 Chat completions, cabeceras y SDK `openai` de npm

Fuente: https://console.groq.com/docs/openai

- **Base URL:** `https://api.groq.com/openai/v1`
- **Endpoint:** `POST /openai/v1/chat/completions`
- **Cabeceras:** `Authorization: Bearer $GROQ_API_KEY`, `Content-Type: application/json`

**Sí, el SDK `openai` de npm funciona con Groq.** Está documentado oficialmente por Groq. Ejemplo oficial (Python), el equivalente JS es idéntico en estructura:

```python
import os
import openai

client = openai.OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.environ.get("GROQ_API_KEY")
)
```

Versión Node/TypeScript para el proyecto:

```javascript
import OpenAI from "openai";

const groq = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

// Salida estructurada (SIN tools — ver limitación arriba)
const clasificacion = await groq.chat.completions.create({
  model: "openai/gpt-oss-20b",
  reasoning_effort: "low",
  messages: [
    { role: "user", content: "Clasifica este aviso: 'Columna de humo en el pinar de Robledo, viento fuerte de poniente'." }
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "clasificacion_aviso",
      strict: true,
      schema: {
        type: "object",
        properties: {
          severidad: { type: "string", enum: ["baja", "media", "alta", "critica"] },
          municipio: { type: "string" },
          requiere_medios_aereos: { type: "boolean" },
          confianza: { type: "number" }
        },
        required: ["severidad", "municipio", "requiere_medios_aereos", "confianza"],
        additionalProperties: false
      }
    }
  }
});

// Tool calling (SIN response_format — ver limitación arriba)
const conHerramientas = await groq.chat.completions.create({
  model: "openai/gpt-oss-120b",
  messages: [{ role: "user", content: "¿Qué medios hay disponibles en Ávila?" }],
  tools: [{
    type: "function",
    function: {
      name: "consultar_medios",
      description: "Consulta medios de extinción disponibles por provincia",
      parameters: {
        type: "object",
        properties: { provincia: { type: "string" } },
        required: ["provincia"]
      }
    }
  }],
  tool_choice: "auto"
});
```

**Campos de OpenAI NO soportados por Groq** (cita de la doc):

- `logprobs`
- `logit_bias`
- `top_logprobs`
- `messages[].name`
- `N` debe ser 1 si se suministra
- Formatos `vtt` y `srt` en transcripción/traducción

**Comportamiento de `temperature`:** un valor de 0 se convierte automáticamente a `1e-8`. La doc recomienda float32 "greater than 0 and less than or equal to 2".

**Versiones actuales en npm (verificadas hoy contra el registry):**

| Paquete | Versión | Última publicación |
|---|---|---|
| `openai` | **7.19.0** | 2026-09-18 |
| `groq-sdk` | **1.6.0** | 2026-08-26 |
| `exa-js` | **2.22.0** | 2026-09-17 |
| `@huggingface/transformers` | **4.3.0** | 2026-09-16 |

> **NO VERIFICADO empíricamente:** no dispongo de clave Groq para ejecutar una llamada real y confirmar en runtime que `response_format: { type: "json_schema" }` y `tools` se serializan correctamente a través del SDK `openai@7.19.0`. Lo afirmado se basa en (a) la compatibilidad OpenAI documentada por Groq y (b) que ambos campos son estándar de la API de OpenAI y están tipados en el SDK. La limitación documentada de que no se pueden combinar es de Groq, no del SDK.

### 1.7 ¿Groq ofrece embeddings?

**NO.** Dicho claramente.

La referencia oficial de API (https://console.groq.com/docs/api-reference) documenta exactamente estas siete familias de endpoints:

1. Chat (create chat completion)
2. Responses (beta)
3. Audio (transcription, translation, speech)
4. Models (list / retrieve)
5. Batches (create, retrieve, list, cancel)
6. Files (upload, list, delete, retrieve, download)
7. Fine Tuning (list, create, get, delete)

**No existe `/openai/v1/embeddings` en la documentación oficial.** La página de compatibilidad OpenAI tampoco menciona embeddings.

> Existen fuentes de terceros (apis.io, agregadores de OpenAPI) que mencionan un "Groq Embeddings API" con el modelo `nomic-embed-text-v1_5`. **NO VERIFICADO y no documentado oficialmente.** Históricamente Groq lo tuvo en acceso privado/limitado. **No construyas el RAG del BOE contando con esto.** Usa una de las opciones de la sección 4.

### 1.8 Speech-to-text (Whisper)

Fuente: https://console.groq.com/docs/speech-to-text

**Endpoints (compatibles OpenAI):**
- `https://api.groq.com/openai/v1/audio/transcriptions`
- `https://api.groq.com/openai/v1/audio/translations`

**Modelos:**

| Model ID | Precio | Notas |
|---|---|---|
| `whisper-large-v3-turbo` | **$0.04 / hora** | Rápido, multilingüe. Mejor relación coste-rendimiento |
| `whisper-large-v3` | **$0.111 / hora** | Máxima precisión, multilingüe |

**Especificaciones de fichero:**
- **Tamaño máximo:** 25 MB (tier gratuito), 100 MB (dev tier)
- **Formatos:** FLAC, MP3, MP4, MPEG, MPGA, M4A, OGG, WAV, WebM
- **Duración mínima:** 0,01 s (se factura con mínimo de 10 segundos)
- **Procesamiento:** el audio se reduce a 16 kHz mono

**Parámetros:**

| Parámetro | Valores |
|---|---|
| `file` o `url` | Entrada de audio (requerido) |
| `model` | ID de modelo (requerido) |
| `language` | ISO-639-1 → **`"es"` para español**. Opcional, mejora la precisión |
| `response_format` | `json`, `verbose_json`, `text` (**`vtt` y `srt` NO soportados**) |
| `timestamp_granularities` | `segment` y/o `word` |
| `prompt` | Guía de estilo, máx. 224 tokens |
| `temperature` | 0-1 (recomendado 0) |

**Español:** ambos modelos son multilingües. La doc no lista los idiomas uno a uno, pero Whisper Large v3 soporta español nativamente y basta con pasar `language: "es"`. **Español soportado — VERIFICADO por la naturaleza multilingüe documentada; el listado explícito de idiomas NO aparece en esa página.**

```bash
curl https://api.groq.com/openai/v1/audio/transcriptions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@/ruta/aviso-112.m4a" \
  -F "model=whisper-large-v3-turbo" \
  -F "language=es" \
  -F "response_format=verbose_json" \
  -F "temperature=0"
```

### 1.9 Text-to-speech

Fuente: https://console.groq.com/docs/text-to-speech

**Endpoint:** `https://api.groq.com/openai/v1/audio/speech`

**Modelos disponibles:**

| Model ID | Idioma |
|---|---|
| `canopylabs/orpheus-v1-english` | **Inglés** — "Expressive TTS with vocal direction controls" |
| `canopylabs/orpheus-arabic-saudi` | **Árabe (dialecto saudí)** |

> ### EL TTS DE GROQ NO SIRVE PARA ESTA PLATAFORMA
> **No hay español.** Solo inglés y árabe saudí. Además, `playai-tts` (que sí tenía más idiomas) **ya no existe** en el catálogo.
>
> Opciones para voz en español: mantener `say` local de macOS (ya decidido en el proyecto), Helmcode `kokoro` si se consigue clave, o un proveedor externo tipo ElevenLabs.

Voces mencionadas: `troy`, `hannah`, `austin` (lista completa no publicada en esa página). Formato por defecto: WAV, configurable vía `response_format`.

```bash
curl https://api.groq.com/openai/v1/audio/speech \
  -X POST \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "canopylabs/orpheus-v1-english",
    "input": "Welcome to Orpheus text-to-speech. [cheerful] This is an example of high-quality English audio generation with vocal directions support.",
    "voice": "austin",
    "response_format": "wav"
  }' \
  --output orpheus-english.wav
```

### 1.10 Rate limits

Fuente: https://console.groq.com/docs/rate-limits

Métricas: **RPM** (requests/min), **RPD** (requests/día), **TPM** (tokens/min), **TPD** (tokens/día), **ASH** (segundos de audio/hora), **ASD** (segundos de audio/día).

#### Plan gratuito (VERIFICADO)

| Model ID | RPM | RPD | TPM | TPD | ASH | ASD |
|---|---|---|---|---|---|---|
| `canopylabs/orpheus-arabic-saudi` | 10 | 100 | 1.2K | 3.6K | — | — |
| `canopylabs/orpheus-v1-english` | 10 | 100 | 1.2K | 3.6K | — | — |
| `groq/compound` | 30 | 250 | 70K | — | — | — |
| `groq/compound-mini` | 30 | 250 | 70K | — | — | — |
| `meta-llama/llama-prompt-guard-2-22m` | 30 | 14.4K | 15K | 500K | — | — |
| `meta-llama/llama-prompt-guard-2-86m` | 30 | 14.4K | 15K | 500K | — | — |
| `openai/gpt-oss-120b` | 30 | 1K | 8K | 200K | — | — |
| `openai/gpt-oss-20b` | 30 | 1K | 8K | 200K | — | — |
| `openai/gpt-oss-safeguard-20b` | 30 | 1K | 8K | 200K | — | — |
| `qwen/qwen3.8-27b` | 30 | 1K | 8K | 200K | — | — |
| `whisper-large-v3` | 20 | 2K | — | — | 7.2K | 28.8K |
| `whisper-large-v3-turbo` | 20 | 2K | — | — | 7.2K | 28.8K |

**Observaciones importantes sobre esta tabla:**
- **`llama-3.1-8b-instant` y `llama-3.3-70b-versatile` NO aparecen.** Refuerza la sospecha de que ya no son self-serve gratuitos.
- **`qwen/qwen3.6-27b` NO aparece.**
- `groq/compound` tiene **70K TPM**, muy por encima del resto (8K). Si necesitas contexto largo con clave gratuita, Compound es la vía.
- Whisper gratuito: **7.200 segundos de audio/hora = 2 horas de audio por hora real.** Muy generoso para la demo.

#### Plan Developer (de pago)

**NO VERIFICADO — valores concretos.** La página tiene una pestaña "Developer Plan Limits" cuyo contenido no se renderiza sin sesión iniciada. La documentación sí dice literalmente: *"Upgrade to Developer plan to access higher limits, Batch and Flex processing, and more"* y *"the limits shown below are the base limits for the Developer plan, and higher limits are available for select workloads and enterprise use cases"*. Para consultarlos hay que entrar en `console.groq.com/settings/billing/plans` con la cuenta.

#### Cabeceras de respuesta de rate limit

- `retry-after` — segundos hasta poder reintentar
- `x-ratelimit-limit-requests` — tope diario de peticiones
- `x-ratelimit-limit-tokens` — tope de tokens por minuto
- `x-ratelimit-remaining-requests` — peticiones disponibles hoy
- `x-ratelimit-remaining-tokens` — tokens disponibles este minuto
- `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens` — tiempo hasta el reset

Superar los límites devuelve **`429 Too Many Requests`**.

### 1.11 Cómo obtener la API key de Groq

1. Ir a **https://console.groq.com** y crear cuenta o iniciar sesión (Google/GitHub/email).
2. Ir directamente a **https://console.groq.com/keys** (la documentación dice literalmente: *"Please visit here to create an API Key"* enlazando a `/keys`).
3. Pulsar **Create API Key**, ponerle nombre, copiarla (solo se muestra una vez).
4. Guardarla como variable de entorno:
   ```bash
   export GROQ_API_KEY=<your-api-key-here>
   ```
5. En Railway: añadir `GROQ_API_KEY` en Variables del servicio.

El tier gratuito **no requiere tarjeta de crédito**.

---

## 2. EXA

### 2.1 Base y autenticación

- **Base URL:** `https://api.exa.ai`
- **Autenticación:** la especificación OpenAPI oficial (`exa-labs/openapi-spec`, v1.2.0) define **dos esquemas equivalentes**:
  - `x-api-key: <token>` (el que usan casi todos los ejemplos)
  - `Authorization: Bearer <token>`

  Cita literal del spec: *"API key can be provided either via x-api-key header or Authorization header with Bearer scheme"*.
- **SDK npm:** `exa-js` **2.22.0**

### 2.2 Endpoints

Del OpenAPI oficial:

| Método | Ruta | Función |
|---|---|---|
| POST | `/search` | Búsqueda web neural/keyword con filtros |
| POST | `/findSimilar` | Páginas similares a una URL dada |
| POST | `/contents` | Extrae texto limpio, highlights o resúmenes de URLs concretas |
| POST | `/answer` | Respuesta sintetizada con citas |
| POST | `/research/v0/tasks` | Tareas de investigación asíncronas |
| GET | `/research/v0/tasks/{id}` | Estado/resultado de la tarea |

Además, fuera del spec principal: **Websets** en `https://api.exa.ai/websets/v0/websets/` (búsqueda estructurada asíncrona con verificación de criterios).

### 2.3 Parámetros de `/search`

| Parámetro | Tipo | Detalle |
|---|---|---|
| `query` | string | **Requerido** |
| `type` | enum | `instant`, `fast`, `auto` (default), `deep-lite`, `deep`, `deep-reasoning` |
| `numResults` | int | 1-100, default 10 |
| `category` | enum | Ver abajo |
| `userLocation` | string | Código ISO de país de 2 letras → **`"ES"`** |
| `startPublishedDate` / `endPublishedDate` | ISO 8601 | Filtra por **fecha de publicación** |
| `startCrawlDate` / `endCrawlDate` | ISO 8601 | Filtra por fecha en que Exa **descubrió** el enlace |
| `includeDomains` / `excludeDomains` | array | Máx. **1200** elementos. Acepta dominios completos, prefijos de ruta (`anthropic.com/news`) y comodines de subdominio (`*.substack.com`) |
| `includeText` / `excludeText` | array | Filtro por texto contenido |
| `contents` | object | Ver 2.4 |
| `outputSchema` | JSON Schema | Síntesis estructurada del conjunto de resultados |
| `systemPrompt` | string | Instrucciones para el procesado de resultados |

#### Categorías (`category`)

Hay una **discrepancia** entre fuentes oficiales, la anoto tal cual:

- **OpenAPI oficial v1.2.0** (enum verbatim): `company`, `research paper`, `news`, `pdf`, `github`, `personal site`, `people`, `financial report`
- **Página de docs web actual**: `company`, `publication`, `news`, `personal site`, `financial report`, `people`

**`news` está en ambas listas** — es la que necesitas y es segura. `research paper` vs `publication` parece un renombrado en curso. La doc añade que otras cadenas se aceptan como *hint*.

> **NO existe una categoría `tweet`.** Ver sección 2.7 sobre redes sociales.

**Restricciones por categoría** (cita del spec): para `company` y `people` **no se soportan** `startPublishedDate`, `endPublishedDate`, `startCrawlDate`, `endCrawlDate`, `includeText`, `excludeText`, `excludeDomains`. Para `people`, `includeDomains` **solo acepta dominios de LinkedIn**. Usar parámetros no soportados devuelve **400**.

### 2.4 Objeto `contents` y frescura

| Campo | Detalle |
|---|---|
| `text` | Booleano u objeto: `maxCharacters` (1-10000), `includeHtmlTags`, `verbosity` (`compact`/`standard`/`full`), `includeSections`, `excludeSections` |
| `highlights` | Booleano u objeto: `query`, `maxCharacters` (1-10000). **Es el default recomendado por Exa** |
| `summary` | Objeto: `query` y `schema` JSON. **Añade coste de LLM por resultado** |
| `extras` | `links`, `imageLinks`, `richImageLinks`, `richLinks`, `codeBlocks` (0-1000 cada uno) |
| `subpages` | Nº de páginas enlazadas a seguir |
| `subpageTarget` | Array de palabras clave de URL a priorizar |
| `maxAgeHours` | Int (-1 a 720). Control de frescura |
| `livecrawl` | **DEPRECADO** |
| `livecrawlTimeout` | Milisegundos máximos para el fetch en vivo |

**`livecrawl` está DEPRECADO.** Valores del enum (por si encuentras código antiguo): `never`, `fallback`, `preferred`, `always`. Cita del spec: *"**Deprecated**: Use `maxAgeHours` instead for more precise control over content freshness."*

Semántica de **`maxAgeHours`** (verbatim del spec):
- **Valor positivo** (ej. 24): usa contenido cacheado si tiene menos de esas horas, si no hace livecrawl
- **`0`**: siempre livecrawl, nunca cache
- **`-1`**: nunca livecrawl, siempre cache
- **Omitido** (default): livecrawl solo como fallback cuando no hay nada en cache

Nota: `verbosity`, `includeSections` y `excludeSections` **requieren `livecrawl: "always"`** para surtir efecto.

### 2.5 Ejemplo: noticias recientes de incendio forestal en español

```bash
curl -X POST "https://api.exa.ai/search" \
  -H "x-api-key: $EXA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "incendio forestal Robledo de Chavela evacuación medios aéreos",
    "type": "auto",
    "category": "news",
    "numResults": 15,
    "userLocation": "ES",
    "startPublishedDate": "2026-09-17T00:00:00.000Z",
    "includeDomains": [
      "eldiario.es", "elpais.com", "rtve.es", "20minutos.es",
      "europapress.es", "efe.com", "lavanguardia.com", "abc.es"
    ],
    "contents": {
      "text": { "maxCharacters": 2000 },
      "highlights": { "query": "superficie afectada, evacuados, medios desplegados, nivel de gravedad" },
      "maxAgeHours": 6
    }
  }'
```

Versión con el SDK en Node:

```javascript
import Exa from "exa-js";
const exa = new Exa(process.env.EXA_API_KEY);

const desde = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

const res = await exa.searchAndContents(
  `incendio forestal ${municipio} ${provincia}`,
  {
    category: "news",
    numResults: 15,
    userLocation: "ES",
    startPublishedDate: desde,
    text: { maxCharacters: 2000 },
    highlights: { query: "superficie afectada, evacuados, medios desplegados" },
    maxAgeHours: 6,
  }
);
```

Respuesta (estructura verbatim de la doc):

```json
{
  "requestId": "b5947044c4b78efa9552a7c89b306d95",
  "results": [
    {
      "title": "A Comprehensive Overview of Large Language Models",
      "url": "https://arxiv.org/pdf/2307.06435.pdf",
      "publishedDate": "2023-11-16T01:36:32.547Z",
      "author": "Humza Naveed, University of Engineering and Technology",
      "id": "https://arxiv.org/abs/2307.06435",
      "text": "Abstract Large Language Models (LLMs) have recently demonstrated remarkable capabilities...",
      "highlights": ["Such requirements have limited their adoption..."]
    }
  ],
  "costDollars": {
    "total": 0.007,
    "search": { "neural": 0.007 }
  },
  "searchTime": 312.4
}
```

Muy útil: **cada respuesta incluye `costDollars`**, así que puedes instrumentar el gasto en tiempo real desde la consola.

### 2.6 `/contest`, `/findSimilar` y `/answer`

```bash
# Contenidos de URLs concretas
curl -s -X POST "https://api.exa.ai/contents" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EXA_API_KEY" \
  -d '{
    "ids": ["https://example.com/research-paper"],
    "highlights": { "query": "methodology and results" }
  }'
```

```bash
# Páginas similares a una noticia ya encontrada
curl -s -X POST "https://api.exa.ai/findSimilar" \
  -H "x-api-key: $EXA_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://paulgraham.com/greatwork.html",
    "numResults": 10,
    "excludeSourceDomain": true,
    "contents": { "text": { "maxCharacters": 1000 } }
  }' | jq '.results[] | {title, url}'
```

`findSimilar` soporta los mismos filtros que `/search` (`includeDomains`, `excludeDomains`, rangos de fecha, `category`), más `excludeSourceDomain` (booleano: excluye resultados del mismo dominio que la URL de origen).

**`/answer`** — parámetros: `query` (requerido), `stream` (booleano, SSE), `text` (booleano, incluir texto completo), `model` (`exa`, `exa-pro`, `exa-research`, `exa-fast`), `outputSchema` (JSON Schema para respuesta estructurada).

Respuesta: `answer` (string u objeto estructurado), `citations` (array con title, url, publishedDate, author, opcionalmente text/image) y `costDollars`. Con `stream: true` emite eventos SSE con deltas de texto, citas, coste o error.

### 2.7 ¿Sirve para redes sociales (X / Bluesky / Reddit)?

**Sí, pero de forma indirecta.** No hay categoría ni endpoint dedicado a redes sociales en la API principal.

El método es **`includeDomains`**:

```javascript
// X/Twitter
{ query: "incendio forestal Ávila", includeDomains: ["x.com", "twitter.com"] }
// Reddit
{ query: "incendio forestal España", includeDomains: ["reddit.com"] }
// Bluesky
{ query: "incendio forestal", includeDomains: ["bsky.app"] }
```

Exa indexa X/Twitter con crawling continuo de datos públicos. **PARCIALMENTE VERIFICADO:** la doc tiene una página de demo "Twitter/X post Retrieval" (`docs.exa.ai/examples/live-demo-twitterx-post-retrieval`) que confirma el enfoque de `includeDomains`. Existen menciones a un endpoint de "advanced search" específico para X en integraciones MCP de terceros, donde **los filtros de texto y dominio no se soportan** para búsquedas de X — **NO VERIFICADO** en la documentación oficial de la API REST.

Para el caso de uso (OSINT de avisos ciudadanos sobre incendios), `includeDomains` sobre X/Bluesky/Reddit es suficiente y es lo documentado.

> **Aviso de seguridad:** todo lo que venga de redes sociales es entrada no confiable. Si lo metes en el contexto de un agente, pásalo antes por `meta-llama/llama-prompt-guard-2-86m` en Groq (gratis: 30 RPM, 14.4K RPD) y trátalo siempre como datos, nunca como instrucciones.

### 2.8 Precios y tier gratuito

Cita literal: *"New accounts get $20 in free credits (around 2,800 searches) and the Free Tier adds $10 in credits every month."*

| Endpoint | Precio base |
|---|---|
| Search | **$7 / 1.000 peticiones** |
| Deep Search | $12-15 / 1.000 peticiones |
| Contents | **$1 / 1.000 páginas** |
| Answer | $5 / 1.000 peticiones |
| Monitors | $15 / 1.000 peticiones |
| Agent | $0,012-$1,00 por ejecución de esfuerzo fijo |

Los precios base de Search, Answer y Monitors **incluyen hasta 10 resultados**. Resultados adicionales y resúmenes generados por IA cuestan **$1 por cada 1.000 elementos** extra.

> **Para el hackathon esto es de sobra.** $20 iniciales ≈ 2.800 búsquedas, más $10/mes recurrentes. No hace falta tarjeta para el tier gratuito.

### 2.9 Cómo obtener la clave de Exa

1. Ir a **https://exa.ai** y registrarse (Google o email).
2. Entrar en el dashboard: **https://dashboard.exa.ai**
3. Sección **API Keys** → **Create API Key**.
4. Los **$20 de créditos gratuitos se aplican automáticamente** al crear la cuenta.
5. Variable de entorno: `EXA_API_KEY`.

---

## 3. HELMCODE

### 3.1 Qué es exactamente

**Helmcode es real y está verificado.** No es un sponsor conocido de HackSpain ni una plataforma de agentes: es un **proveedor de inferencia de LLM europeo**.

- **Web:** https://helmcode.com
- **Docs:** https://helmcode.com/docs
- **Dashboard:** https://cloud.helmcode.com
- **Posicionamiento (cita literal):** *"Private AI Inference for European Teams"* — modelos abiertos ejecutados en infraestructura de la UE a través de una API compatible con OpenAI.
- **Propuesta de valor (citas literales):**
  - *"Prompts are never stored, and every model we run runs on EU infrastructure, never on US hyperscalers subject to the Cloud Act."*
  - *"No token caps: one flat rate per API key, not per token."*
  - *"Every OpenAI SDK and tool works as-is — Cursor, Zed, OpenCode, your own clients."*

> **Cuidado con la homonimia.** Existe un proyecto de GitHub distinto llamado **"Helm Code"** (`buluma/helmcode`, `BioInfo/helm`) que es *"a server-only CLI for Helm Code — an agent harness control surface that drives coding-agent CLIs on your machine"*. **No tiene nada que ver** con el proveedor de inferencia helmcode.com. Si el usuario dice tener una clave de "HelmCode", confirma cuál de los dos es.

> **NO VERIFICADO:** no he encontrado ninguna confirmación de que Helmcode sea sponsor de HackSpain 2026. La búsqueda de sponsors solo confirmó a **HappyRobot** (que aloja el track en `hackspain2026.happyrobot.ai`, evento del 18-20 de septiembre de 2026 en UPM ETSIT, Madrid). Si la clave de HelmCode viene del hackathon, debe ser por otra vía.

### 3.2 API

- **Base URL:** `https://api.helmcode.com/v1`
- **Auth:** `Authorization: Bearer $HELMCODE_API_KEY` (las claves empiezan por `sk-`)
- **Endpoints:** chat completions, embeddings, reranking, text-to-speech, speech-to-text (todos compatibles OpenAI)

### 3.3 Modelos

#### Chat

| Model ID | Contexto | Arquitectura | Notas |
|---|---|---|---|
| `glm5.3` | **1M** | 744B MoE | Coding agéntico. **Add-on de €150/mes** |
| `deepseek-v4-flash` | **1M** | 284B MoE | Razonamiento, tool use multi-paso |
| `qwen3.6` | 256K | 35B MoE | **Visión**, alto throughput para RAG |
| `gemma4` | 256K | 26B MoE | **Visión**, arquitectura Google |

#### Embeddings y reranking

| Model ID | Especificaciones |
|---|---|
| `qwen3-embedding` | 8B params, **4096 dimensiones**, **100+ idiomas** |
| `rerank` | Qwen3-Reranker-8B, cross-lingual |

#### Voz

| Model ID | Especificaciones |
|---|---|
| `kokoro` (TTS) | 82M params, **<1 s de latencia**, **67 voces** |
| `whisper-large-v3` (STT) | 99+ idiomas, **3,2% WER en español** |

#### Frontier (revendidos, pay-per-token)

Cuatro variantes de Claude, tres de GPT y dos de Gemini, facturados con crédito prepago al *"provider's list price, no markup on inference"*. Estos sí salen de la UE.

### 3.4 Ejemplos

```bash
curl https://api.helmcode.com/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.6",
    "messages": [{"role": "user", "content": "Explain RAG in one sentence."}]
  }'
```

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.helmcode.com/v1",
  apiKey: "sk-your-key-here",
});

const resp = await client.chat.completions.create({
  model: "qwen3.6",
  messages: [{ role: "user", content: "Explain RAG in one sentence." }],
});
console.log(resp.choices[0].message.content);
```

```python
# Embeddings — 4096 dimensiones
emb = client.embeddings.create(
    model="qwen3-embedding",
    input="Helmcode runs inference in the EU.",
)
print(len(emb.data[0].embedding))  # 4096
```

### 3.5 Precios y límites — EL PROBLEMA

| Plan | Precio | Incluye |
|---|---|---|
| **Starter** | **€399/mes** | 5 API Keys, tokens ilimitados en Qwen y Gemma, 5B tokens/mes en DeepSeek V4 Flash y GLM 5.3, zero logs, soporte por email |
| **Growth** | **€1.299/mes** | 15 API Keys, 15B tokens/mes DeepSeek/GLM, soporte prioritario, SLA 99,5% |
| **Scale** | **€3.199/mes** | 40 API Keys, 35B tokens/mes, SLA 99,9%, acceso anticipado a modelos |
| **Enterprise** | A medida | +60 API Keys, GPUs dedicadas, modelos custom, SLA custom |

**Rate limits por clave:** 100 RPM, 5 procesos concurrentes por modelo (10 para GLM 5.3), 3M TPM, 1M de contexto por petición.

> ### **NO HAY TIER GRATUITO NI PRUEBA.** El mínimo son **€399/mes**.
>
> **Conclusión práctica:**
> - **Si el usuario YA tiene una clave** (crédito, sponsor, cuenta de empresa): Helmcode es, con diferencia, **la mejor pieza del puzzle**. Resuelve de golpe embeddings multilingües (`qwen3-embedding`, 4096 dims, 100+ idiomas), visión (`qwen3.6`, `gemma4`), **TTS con 67 voces y <1s de latencia** (`kokoro` — lo que Groq no puede dar en español) y STT con 3,2% WER en español. Todo en la UE, que además es un argumento de peso ante un jurado para una plataforma de emergencias de la administración española.
> - **Si NO la tiene:** descartar. €399/mes es inviable para un hackathon y no hay forma de probarlo gratis.

---

## 4. EMBEDDINGS SIN OPENAI (multilingüe / español, desde Node en Railway)

### 4.1 Opción (a): `@huggingface/transformers` en proceso — SIN CLAVE

- **Paquete:** `@huggingface/transformers` — **versión actual 4.3.0** (publicada 2026-09-16)
- **Backend:** ONNX Runtime. En Node se apoya en `onnxruntime-node` (se instala como dependencia del paquete).
- **Modelo recomendado:** `Xenova/multilingual-e5-small` (conversión ONNX oficial de `intfloat/multilingual-e5-small`, con `library_name: transformers.js`, ~202K descargas).

**Especificaciones verificadas** (leídas directamente de `config.json` y la API de HF):

| Propiedad | Valor |
|---|---|
| Arquitectura | `BertModel` con tokenizer `XLMRobertaTokenizer` |
| **Dimensiones del embedding** | **384** (`hidden_size`) |
| **Longitud máxima de secuencia** | **512** tokens (`max_position_embeddings`, `max_seq_length`) |
| Capas / cabezas | 12 / 12 |
| Vocabulario | 250.037 |
| **Idiomas** | **~100, incluido `es`** (declarado en el model card) |

**Tamaños de fichero reales** (consultados vía API de HF, en MB):

| Fichero | Tamaño |
|---|---|
| `onnx/model.onnx` (fp32) | **470,3 MB** |
| `onnx/model_O4.onnx` (optimizado) | **235,1 MB** |
| `onnx/model_qint8_avx512_vnni.onnx` (**q8**) | **118,3 MB** |
| `onnx/tokenizer.json` | 17,1 MB |
| `onnx/sentencepiece.bpe.model` | 5,1 MB |

> **Usa `dtype: "q8"` → ~120 MB de descarga y de RAM.** El fp32 de 470 MB es innecesario para RAG.

**Prefijos obligatorios del modelo E5:** hay que anteponer `"query: "` a las consultas y `"passage: "` a los documentos. **Si se omiten, la calidad de recuperación cae notablemente.** Es el error más común al usar esta familia.

```javascript
import { pipeline } from "@huggingface/transformers";

// Singleton: cargar UNA vez en el arranque del servidor, no por petición
let extractor = null;
async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline(
      "feature-extraction",
      "Xenova/multilingual-e5-small",
      { dtype: "q8" }   // ~118 MB en lugar de 470 MB
    );
  }
  return extractor;
}

export async function embed(textos, tipo = "passage") {
  const pipe = await getExtractor();
  const prefijados = textos.map(t => `${tipo}: ${t}`);  // "query: " o "passage: "
  const out = await pipe(prefijados, { pooling: "mean", normalize: true });
  return out.tolist();   // Array de vectores de 384 dimensiones
}

// Uso en el RAG del BOE
const vectoresDocs = await embed(fragmentosBOE, "passage");
const vectorQuery  = await embed(["protocolo de evacuación por incendio forestal"], "query");
```

Ejemplo canónico de la documentación oficial:

```javascript
import { pipeline } from '@huggingface/transformers';

// Allocate a pipeline for feature-extraction
const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

const output = await pipe('This is a simple test.');
// Tensor {
//   dims: [ 1, 384 ],
//   type: 'float32',
//   data: Float32Array [ -0.03771675750613213, 0.15645169258117676, ... ],
//   size: 384
// }
```

Opciones de `dtype` documentadas: `"fp32"` (default en WebGPU), `"fp16"`, `"q8"` (default en WASM), `"q4"`.

**Despliegue en Railway (Node 20+, Linux x64):**

- Funciona sin problema: `onnxruntime-node` tiene binarios precompilados para linux-x64.
- **Cold start:** la primera invocación descarga ~120 MB (q8) + 17 MB de tokenizer desde el CDN de HF. En un contenedor efímero esto ocurre en **cada arranque**.
- **Mitigación recomendada:** precargar el modelo en el paso de build de la imagen (un script que ejecute el `pipeline()` una vez durante `docker build`), o montar un volumen persistente de Railway y fijar `env.cacheDir` / `HF_HOME` a él.
- Instanciar el pipeline **una sola vez** como singleton de módulo. Recrearlo por petición mata el rendimiento.
- Memoria: reservar al menos 512 MB - 1 GB para el servicio.

> **Latencia: NO VERIFICADO.** No he ejecutado benchmarks. Como orden de magnitud razonable para un modelo BERT de 12 capas / 384 dims cuantizado a int8 sobre CPU: **decenas de milisegundos por texto corto**, con batching mejorando mucho el throughput. **Mídelo tú antes de comprometerte con un SLA.** La carga inicial del modelo (tras la descarga) sí es de varios segundos.

### 4.2 Opción (b): Hugging Face Inference Providers — `feature-extraction`

Fuente: https://huggingface.co/docs/inference-providers/tasks/feature-extraction

- **Endpoint (routing de HF):** `https://router.huggingface.co/...` — el enrutado se hace por proveedor y modelo. Para el cliente oficial basta con `InferenceClient`.
- **Cabecera:** `authorization: Bearer hf_****`, donde el token es un *fine-grained token* con permiso **"Inference Providers"**. Se genera en https://huggingface.co/settings/tokens
- **Payload:** `inputs` (string o string[]), más opcionales `normalize` (bool), `prompt_name` (string), `truncate` (bool), `truncation_direction` (`left`/`right`).
- **Respuesta:** array de arrays (los vectores).
- **Modelos servidos** (mapeo de proveedores documentado): `Qwen/Qwen3-Embedding-0.6B` (deepinfra), `BAAI/bge-small-en-v1.5` (hf-inference), `Qwen/Qwen3-Embedding-8B` (scaleway).

`prompt_name` es útil aquí: permite aplicar el prefijo de `sentence-transformers` automáticamente (por ejemplo `"query"` inyecta `"query: "`), justo lo que necesitan los modelos E5.

```javascript
import { InferenceClient } from "@huggingface/inference";
const hf = new InferenceClient(process.env.HF_TOKEN);

const vectores = await hf.featureExtraction({
  model: "Qwen/Qwen3-Embedding-0.6B",
  inputs: ["protocolo de evacuación por incendio forestal"],
});
```

```bash
curl https://router.huggingface.co/hf-inference/models/BAAI/bge-small-en-v1.5/pipeline/feature-extraction \
  -H "Authorization: Bearer $HF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputs": ["protocolo de evacuación por incendio forestal"], "normalize": true}'
```

> **El tier gratuito es ridículamente pequeño:**
>
> | Tipo de cuenta | Créditos mensuales |
> |---|---|
> | **Free Users** | **$0,10** (sujeto a cambios) |
> | PRO Users | $2,00 |
> | Team / Enterprise | $2,00 por asiento |
>
> **$0,10/mes no sirve para nada en producción.** HF cobra la tarifa del proveedor sin markup. Descartado como opción principal; vale solo para pruebas puntuales. Nota adicional de la doc: desde julio 2025, `hf-inference` se centra en inferencia CPU (embeddings, ranking, clasificación, modelos pequeños), que encaja con el caso de uso pero no compensa el límite de crédito.

### 4.3 Opción (c1): Voyage AI

Fuente: https://docs.voyageai.com/docs/pricing

| Modelo | Precio / 1K tokens | **Tokens gratis** |
|---|---|---|
| `voyage-4-large` | $0,00012 | **200M** |
| `voyage-4` | $0,00006 | **200M** |
| `voyage-4-lite` | **$0,00002** | **200M** |
| `voyage-context-4` | — | 200M |
| `voyage-code-4` | — | 200M |
| `voyage-multilingual-2` | $0,00012 | 50M |
| `voyage-finance-2`, `voyage-law-2`, `voyage-code-2` | — | 50M |
| `voyage-multimodal-3.5` / `-3` | — | 200M tokens texto + 150B píxeles |
| `rerank-3`, `rerank-3-lite` | — | **200M** |

**200 millones de tokens gratis es enormemente generoso** — más que suficiente para indexar el BOE completo varias veces.

> **Matiz sobre multilingüe:** la doc etiqueta explícitamente `voyage-multilingual-2` como multilingüe. La generación `voyage-4-*` **no lleva etiqueta explícita de multilingüe** en la tabla de precios, aunque es la generación actual y presumiblemente la cubre. **PARCIALMENTE VERIFICADO.** Si vas por Voyage y el español es crítico, valida la calidad en español antes de comprometerte, o usa `voyage-multilingual-2` (50M gratis, también de sobra).

Requiere tarjeta de crédito en el registro en algunos casos — **NO VERIFICADO**.

### 4.4 Opción (c2): Jina AI

Fuente: https://jina.ai/embeddings/

| Modelo | Params | Contexto |
|---|---|---|
| `jina-embeddings-v5-text-small` | 677M | **32K** |
| `jina-embeddings-v5-text-nano` | 239M | 8K |
| `jina-embeddings-v5-omni-small` | 1,6B | Multimodal |
| `jina-embeddings-v5-omni-nano` | 0,9B | Multimodal |
| `jina-embeddings-v4` / `v3` | — | Legacy |

**Multilingüe: sí.** Todos los modelos publicados desde 2024 son multilingües. Los v5 de texto están construidos sobre un backbone Qwen3 con amplia cobertura multilingüe; `v5-text-nano` cubre *"15 major European and global languages including English, French, German, **Spanish**, Chinese, Japanese, Arabic, and Hindi"*.

**Tier gratuito:** los usuarios nuevos reciben *"an auto-generated API key with free tokens usable across any of our models"*. Límites: **100 RPM / 100.000 TPM**.

**La gran ventaja de Jina: la clave gratuita se autogenera sin registro ni tarjeta.** Se obtiene directamente desde https://jina.ai/embeddings/ (aparece en la página). Es la opción con menor fricción absoluta para conseguir una clave hoy mismo.

```bash
curl "https://api.jina.ai/v1/embeddings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JINA_API_KEY" \
  -d '{"model": "jina-embeddings-v5-text-small", "input": ["your text here"]}'
```

```javascript
// Compatible con el SDK openai
import OpenAI from "openai";
const jina = new OpenAI({
  baseURL: "https://api.jina.ai/v1",
  apiKey: process.env.JINA_API_KEY,
});
const { data } = await jina.embeddings.create({
  model: "jina-embeddings-v5-text-small",
  input: ["protocolo de evacuación por incendio forestal"],
});
```

### 4.5 Recomendación de embeddings

| Escenario | Elección | Por qué |
|---|---|---|
| **Por defecto, SIN clave** | **`@huggingface/transformers` 4.3.0 + `Xenova/multilingual-e5-small` con `dtype: "q8"`** | Cero claves, cero coste, cero latencia de red, funciona offline. 384 dims, ~118 MB, 100 idiomas incl. español. Encaja con la decisión del proyecto de "nada simulado, todo local". Coste: ~120 MB de cold start en Railway (mitigable precargando en build). |
| **Mejor opción CON clave** | **Jina `jina-embeddings-v5-text-small`** | Clave gratuita autogenerada sin registro ni tarjeta (fricción mínima, la consigues en 30 segundos), 32K de contexto, multilingüe con español explícito, 100 RPM / 100K TPM gratis, compatible con el SDK `openai`. |
| **Alternativa con más margen gratuito** | **Voyage `voyage-4-lite`** (200M tokens gratis) o `voyage-multilingual-2` (50M, multilingüe confirmado) | Si necesitas indexar volúmenes grandes. Requiere registro. |
| **Si hay clave de Helmcode** | **`qwen3-embedding`** (4096 dims, 100+ idiomas) | Máxima calidad y todo en la UE. Solo si la clave ya existe. |
| **Descartado** | HF Inference Providers | $0,10/mes de crédito gratuito. |
| **Imposible** | Groq | No tiene endpoint de embeddings. |

**Nota de arquitectura:** la dimensionalidad importa para ArangoDB. `multilingual-e5-small` da **384**, Jina v5 da otra cosa, `qwen3-embedding` da **4096**. Si empiezas con transformers.js y luego migras, hay que reindexar. Decide pronto y, si quieres flexibilidad, encapsula la generación de embeddings tras una interfaz única.

---

## 5. RECOMENDACIÓN PARA LA PLATAFORMA

| Función | Modelo / servicio | Justificación |
|---|---|---|
| **Agentes de razonamiento y orquestación** | **Groq `openai/gpt-oss-120b`** | 131K de contexto, ~500 t/s, tool use + `json_schema` strict + `reasoning_effort`. $0,15/$0,60 por millón. El mejor equilibrio del catálogo. Gratis: 30 RPM / 8K TPM / 1K RPD. |
| **Clasificación rápida y triaje de alto volumen** | **Groq `openai/gpt-oss-20b`** con `reasoning_effort: "low"` y `json_schema` strict | **~1000 t/s**, el más rápido del catálogo. $0,075/$0,30. Ideal para clasificar avisos entrantes en tiempo real. |
| **Clasificación trivial ultrabarata** | Groq `llama-3.1-8b-instant` (~560 t/s) | Solo `json_object`, sin `json_schema`. **Riesgo: puede requerir cuenta Enterprise** (ver §1.2). No lo pongas en el camino crítico. |
| **Visión de cámaras cada X segundos** | **Groq `qwen/qwen3.8-27b`** | Único modelo de visión con `json_schema` strict y presencia confirmada en la tabla de rate limits. 3 imágenes/petición, 20 MB, 2048 tokens/imagen, ~450 t/s. **Límite duro: con clave gratuita (8K TPM) el intervalo mínimo realista es ~20-25 s por cámara.** |
| **Contexto largo con clave gratuita** | Groq `groq/compound` | **70K TPM** frente a los 8K del resto. Además trae búsqueda web y ejecución de código integradas. |
| **Speech-to-text (llamadas al 112, partes de campo)** | **Groq `whisper-large-v3-turbo`** con `language: "es"` | $0,04/hora. Gratis: 20 RPM, 2.000 RPD y **7.200 segundos de audio por hora** (2 h de audio por hora real). De sobra para la demo. |
| **Text-to-speech en español** | **NO usar Groq** → mantener **`say` local** (ya decidido) o Helmcode `kokoro` si hay clave | Groq solo tiene inglés y árabe saudí. `playai-tts` ya no existe. |
| **Embeddings para el RAG del BOE** | **`@huggingface/transformers` + `Xenova/multilingual-e5-small` (q8, 384 dims)** | Sin clave, sin coste, offline. Upgrade con clave: Jina `v5-text-small`. |
| **Noticias y OSINT de incendios** | **Exa `/search`** con `category: "news"`, `startPublishedDate`, `userLocation: "ES"`, `maxAgeHours: 6` | $20 gratis (~2.800 búsquedas) + $10/mes. `costDollars` en cada respuesta para instrumentar el gasto. |
| **Redes sociales (X / Bluesky / Reddit)** | **Exa `/search`** con `includeDomains: ["x.com","twitter.com","reddit.com","bsky.app"]` | No hay categoría dedicada; el método documentado es por dominio. |
| **Defensa anti prompt-injection en entradas OSINT** | **Groq `meta-llama/llama-prompt-guard-2-86m`** | Gratis y generoso: 30 RPM, **14.400 RPD**, 15K TPM. Imprescindible si metes texto de redes sociales en el contexto de un agente. |

### Reglas de arquitectura derivadas de las limitaciones encontradas

1. **Nunca combines `response_format: json_schema` con `tools` ni con `stream: true` en Groq.** Separa el ciclo de tool calling de la llamada final de extracción estructurada. Para streaming hacia la consola SSE, usa `json_object`.
2. **Presupuesta el TPM del tier gratuito antes de fijar la frecuencia de las cámaras.** 8.000 TPM ÷ 2.048 tokens por imagen ≈ 3 imágenes/minuto de techo teórico.
3. **Verifica el acceso real a los modelos Llama nada más obtener la clave** con `GET https://api.groq.com/openai/v1/models`. Varias señales apuntan a que ya no son self-serve.
4. **Fija la dimensionalidad del embedding pronto** (384 con e5-small) y encapsula la generación tras una interfaz única, para no tener que reindexar ArangoDB si cambias de proveedor.
5. **Precarga el modelo ONNX en el build de Railway** para evitar 120 MB de descarga en cada cold start.
6. **Trata todo lo que venga de Exa (y sobre todo de redes sociales) como datos no confiables**, nunca como instrucciones para el agente.

---

## 6. CÓMO OBTENER CADA CLAVE

### Groq — GRATIS, sin tarjeta
1. https://console.groq.com → crear cuenta (Google / GitHub / email).
2. Ir a **https://console.groq.com/keys**
3. **Create API Key** → nombre → copiar (solo se muestra una vez).
4. `export GROQ_API_KEY=<clave>` / variable `GROQ_API_KEY` en Railway.
5. Verificar acceso: `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"`

### Exa — GRATIS ($20 iniciales + $10/mes)
1. https://exa.ai → registrarse (Google o email).
2. Dashboard: **https://dashboard.exa.ai**
3. Sección **API Keys** → **Create API Key**.
4. Los $20 de crédito se aplican solos al crear la cuenta.
5. Variable `EXA_API_KEY`. Cabecera: `x-api-key` o `Authorization: Bearer`.

### Jina AI — GRATIS, clave autogenerada sin registro
1. Ir a **https://jina.ai/embeddings/**
2. La clave gratuita con tokens incluidos **aparece autogenerada en la propia página**. Copiarla.
3. Variable `JINA_API_KEY`. Límites gratuitos: 100 RPM / 100K TPM.
   *(La vía de menor fricción de todo este informe.)*

### Voyage AI — GRATIS (200M tokens)
1. https://www.voyageai.com → **Sign up** / dashboard.
2. Sección de API keys → crear clave.
3. Los tokens gratuitos se aplican por modelo (200M en la familia `voyage-4-*`).
4. Variable `VOYAGE_API_KEY`.

### Hugging Face — token para Inference Providers (crédito casi nulo)
1. https://huggingface.co/settings/tokens
2. Crear un **fine-grained token** con permiso **"Inference Providers"** (enlace directo desde la doc: `settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained`).
3. Variable `HF_TOKEN`.
   *(Solo $0,10/mes de crédito en cuentas gratuitas. **No** hace falta para usar `@huggingface/transformers` en local, que funciona sin token.)*

### Helmcode — DE PAGO, desde €399/mes, sin tier gratuito
1. **https://cloud.helmcode.com/signup** (botones "get started" en helmcode.com, con selección de plan).
2. Elegir plan (Starter €399/mes mínimo).
3. En el Dashboard → **API Keys** → **Create key**.
4. `export HELMCODE_API_KEY="sk-your-key-here"`
5. Base URL: `https://api.helmcode.com/v1`
   *(Si el usuario ya tiene clave por otra vía, saltar directamente al paso 3.)*

---

## 7. RESUMEN DE LO **NO VERIFICADO**

| Punto | Estado |
|---|---|
| Precio exacto de `llama-3.1-8b-instant` y `llama-3.3-70b-versatile` | Solo fuentes de terceros ($0,59/$0,79 para el 70B). La página oficial `groq.com/pricing` ya no existe (redirige a la home). |
| Si los modelos Llama siguen siendo self-serve o requieren Enterprise | Fuentes de terceros dicen que requieren venta Enterprise desde ago/sep 2026. La doc los sigue listando como Production pero **no aparecen en la tabla de rate limits**. **Verificar con la clave real.** |
| Existencia y disponibilidad real de `qwen/qwen3.6-27b` | Tiene página de modelo y aparece en docs de visión/reasoning/tool-use, pero **no está en `/docs/models` ni en rate limits**. |
| Rate limits concretos del plan Developer de Groq | La pestaña no se renderiza sin sesión. Consultar en `console.groq.com/settings/billing/plans`. |
| Endpoint de embeddings de Groq con `nomic-embed-text-v1_5` | Solo agregadores de terceros. **No está en la referencia oficial de API.** Asumir que no existe. |
| Listado explícito de idiomas de Whisper en Groq | La doc solo dice "multilingual". Español funciona con `language: "es"` por la naturaleza del modelo. |
| Lista completa de voces de Orpheus TTS | Solo se mencionan `troy`, `hannah`, `austin`. Irrelevante: no hay español. |
| Ejecución real de `response_format: json_schema` + `tools` vía `openai@7.19.0` contra Groq | No dispongo de clave para probarlo en runtime. La incompatibilidad entre ambos **está documentada por Groq**. |
| Enum definitivo de `category` en Exa | Discrepancia entre el OpenAPI v1.2.0 (`research paper`, `pdf`, `github`) y la web de docs (`publication`). **`news` está en ambos y es seguro.** |
| Endpoint "advanced search" de Exa dedicado a X/Twitter | Mencionado solo en integraciones MCP de terceros, no en la API REST oficial. |
| Si Voyage `voyage-4-*` es explícitamente multilingüe | La tabla solo etiqueta `voyage-multilingual-2` como tal. |
| Latencia real de transformers.js con e5-small q8 en Railway | Sin benchmark ejecutado. Los tamaños de fichero y las dimensiones **sí** están verificados contra la API de HF. |
| Si Helmcode es sponsor de HackSpain 2026 | **Sin confirmación.** Solo verifiqué HappyRobot como proveedor del track (hackspain2026.happyrobot.ai, 18-20 sep 2026, UPM ETSIT Madrid). |

---

## Fuentes

- https://console.groq.com/docs/models
- https://console.groq.com/docs/vision
- https://console.groq.com/docs/reasoning
- https://console.groq.com/docs/structured-outputs
- https://console.groq.com/docs/tool-use
- https://console.groq.com/docs/openai
- https://console.groq.com/docs/speech-to-text
- https://console.groq.com/docs/text-to-speech
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/api-reference
- https://console.groq.com/docs/quickstart
- https://console.groq.com/docs/model/qwen/qwen3.8-27b
- https://console.groq.com/docs/model/openai/gpt-oss-120b
- https://console.groq.com/docs/model/openai/gpt-oss-20b
- https://console.groq.com/docs/model/llama-3.1-8b-instant
- https://exa.ai/docs/reference/getting-started
- https://exa.ai/docs/reference/search
- https://exa.ai/docs/reference/contents
- https://exa.ai/docs/reference/answer
- https://exa.ai/docs/reference/pricing
- https://exa.ai/docs/reference/search-api-guide
- https://raw.githubusercontent.com/exa-labs/openapi-spec/refs/heads/master/exa-openapi-spec.yaml
- https://helmcode.com/ · /about · /docs · /docs/models · /docs/quickstart · /docs/examples · /pricing
- https://huggingface.co/docs/transformers.js/en/index
- https://huggingface.co/docs/inference-providers/tasks/feature-extraction
- https://huggingface.co/docs/inference-providers/pricing
- https://huggingface.co/intfloat/multilingual-e5-small (config.json + API de ficheros)
- https://huggingface.co/Xenova/multilingual-e5-small
- https://docs.voyageai.com/docs/pricing
- https://jina.ai/embeddings/
- Registry de npm: `openai`, `groq-sdk`, `exa-js`, `@huggingface/transformers`
