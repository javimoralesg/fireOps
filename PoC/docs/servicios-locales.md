# Servicios reales en local (sin modo simulado)

Encargo de Javi (18-09-2026, 22:15): *"lo que se pueda hacer en local se haga en local, nada de poder simular nada"*. Desde esta pasada **no existe ningún modo simulado** en el backend: cada servicio tiene un proveedor real de pago (con clave) y, cuando se puede, un proveedor real **local** sin clave. Si no hay ninguno, el sistema lo dice y la acción falla visible; nunca se inventa un dato, una latencia ni un envío.

| Servicio | Con clave (`.env.local`) | Sin clave: real en local | Sin nada |
|---|---|---|---|
| IA (propuestas, router, interrogatorio, traducción) | Claude (`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_MODEL_LIGERO`) | **Ollama** en el Mac (`OLLAMA_URL`, `OLLAMA_MODEL=gemma3:4b`), salida validada por JSON Schema + zod | `proponer()` lanza; el motor recurre a `plantillaPorTipo` **marcada como plantilla** (decisión de poc-55: un error en el pitch es peor). Router: no registra nada |
| Visión sobre fotos | fal.ai (`FAL_KEY`, `FAL_MODELO`) | Claude multimodal si hay clave; si no **Ollama gemma3:4b** (multimodal) | sin análisis (`visionDisponible()` = false) |
| Búsqueda / contexto / material reciclado | Exa (`EXA_API_KEY`) | **RSS de Google Noticias** (edición España, fechas de publicación reales) → fuente `Prensa` | error de red visible |
| Protocolos aplicables (RAG) | QuiverAI (`QUIVER_API_KEY`, `QUIVER_URL`, `QUIVER_COLECCION`) | **RAG local** sobre normativa oficial descargada del BOE (`data/protocolos/`, embeddings `all-minilm` de Ollama) → fuente `Normativa` con enlace al BOE | el protocolo lo propone el LLM sin cita normativa |
| Alertas de voz | ElevenLabs (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`) + R2 | **`say` de macOS + ffmpeg** (Mónica es, Samantha en, Anna de, Thomas fr) → mp3 en `public/audio/` | `audiosAlerta` vacío y aviso en el log |
| Grafo de ciudad / efecto dominó | ArangoDB (`ARANGO_URL`…) | **ArangoDB 3.12 en Docker local** (`docker run … arangodb:3.12`, puerto 8529) | grafo en memoria, `origenGrafo = "memoria"` visible |
| Ejecución de acciones (SMS, voz, email, tickets) | HappyRobot (poc-b5) o Twilio | — no hay canal local real para llamar o mandar SMS — | proveedor **`Ninguno`**, `ok:false`, "pendiente de envío manual". Órdenes internas → proveedor **`Cuaderno`** (registro real) |
| Datos abiertos (tráfico Madrid, Open-Meteo, REE) | — | ya eran reales sin clave | `modoDatos` lo indica |

## Arquitectura

- `lib/server/conectores/llm.ts` — único punto de acceso al LLM: `generarEstructurado(schema, { system, user, nivel, imagenes?, maxTokens?, timeoutMs?, effort? })`. Orden Claude → Ollama. Timeouts por defecto: `ligero` 10 s, `vision` 120 s, `plan` 300 s. `llmDisponible()`, `llmOcupado()`, `describirLLM()`.
- `lib/server/conectores/ollama.ts` — cliente Ollama: sondeo cacheado (`/api/tags`, 20 s), **precarga** del modelo fuera de las peticiones del motor (los timeouts cortos cancelaban la carga a medias), **cola de una petición** (nada en paralelo), `chatJson()` con `format` = JSON Schema y reintento con el esquema en el prompt, `embeber()`.
- `lib/server/conectores/busqueda-local.ts` — `buscarPrensa(consulta, { horas, max })` sobre `news.google.com/rss/search`.
- `lib/server/conectores/rag-local.ts` + `data/protocolos/` — corpus, índice y búsqueda por coseno (ver `docs/rag-local.md`).
- `lib/server/conectores/tts-local.ts` — `sintetizarLocal(texto, idioma)` con `say` (stdin cerrado) y ffmpeg.
- `exa.ts`, `fal.ts`, `quiver.ts` eligen proveedor y exponen `proveedorBusqueda()`, `proveedorVision()`, `proveedorProtocolos()`; `index.ts` expone `estadoConectores()` (booleanos → `estado.conectores`) y `detalleConectores()` (texto por servicio → `estado.conectoresDetalle`, que pinta el Header).
- `router.ts` — sin LLM no registra procesado; con Ollama ocupado omite la clasificación del evento (no bloquea el motor); visión solo con `imagenUrl` pública (las de periféricos ya vienen analizadas por poc-07).
- `ejecutor.ts` — proveedores `HappyRobot | Twilio | Ninguno`; resultados `Cuaderno` para órdenes internas.

## Modelos locales

Probado el 18-09 en el Mac de Javi (M5, 24 GB, Ollama 0.24, máquina con 9 sesiones abiertas):

| Modelo | Respeta `format` JSON Schema | Visión | Velocidad observada |
|---|---|---|---|
| gemma3:4b (**elegido**) | sí | sí | 4-5 tok/s con la máquina saturada (esperable ≥ 40 tok/s con la máquina libre) |
| gemma3:12b | sí | sí | 4 tok/s, 10 GB en memoria, carga de 30-80 s |
| qwen3.5:9b / 4b | **no** (devuelve otros campos) | sí | 7-10 tok/s |
| qwen2.5:3b | sí | no | 35 tok/s |
| all-minilm:l6-v2 | embeddings 384 dims | — | 0,2-0,3 s por lote |

El log de Ollama muestra `ggml_metal_library_init_from_source: error compiling source` en macOS 27 con Ollama 0.24: hay 0.34 en Homebrew (`brew upgrade ollama`), pendiente de probar si recupera la velocidad.

## Arranque en local

```bash
ollama serve                              # :11434 (o brew services start ollama)
ollama pull gemma3:4b all-minilm:l6-v2    # una vez
docker start atalaya-arango || docker run -d --name atalaya-arango -p 8529:8529 \
  -e ARANGO_ROOT_PASSWORD=atalaya -v atalaya-arango-data:/var/lib/arangodb3 arangodb:3.12
node data/protocolos/construir.mjs        # regenera el índice del RAG (necesita Ollama)
npm run dev                               # :3456
```

## Qué claves aceleran o completan la demo

- `ANTHROPIC_API_KEY`: propuestas en segundos y visión inmediata (Ollama queda de respaldo real).
- `HAPPYROBOT_*` (poc-b5) o `TWILIO_*` + `DESTINO_DEMO`: única forma de que las llamadas/SMS salgan de verdad.
- `EXA_API_KEY`, `FAL_KEY`, `QUIVER_API_KEY`, `ELEVENLABS_API_KEY` (+ `R2_*`): mejoran calidad, pero ya hay equivalente local real.
