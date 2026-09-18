# Backend — Centro de Mando de Crisis AI

Todo el backend vive en `lib/server/*` y `app/api/*` (Next.js route handlers). El estado del sistema es un singleton en memoria persistido en `data/estado.json` (ignorado por git).

## Flujo

```
tick del escenario ──▶ refrescarEntorno (datos reales) ──▶ eventos nuevos ──▶ proponente (Claude | plantilla)
                                                                                     │
        ┌────────────────────────────────────────────────────────────────────────────┘
        ▼
  Decision (pendiente) ──aprobar──▶ ejecutor (HappyRobot | Twilio | Cuaderno · Ninguno) ──▶ acta de decisión
        │
        └──denegar {feedback}──▶ regla de doctrina (persistente) ──▶ nueva propuesta v+1 que la respeta
```

- **Autonomía**: la política de poc-c5 (`Decision.competencia`) decide si la IA ejecuta sola (estado `auto`), si basta supervisión o si exige firma humana; el umbral es una de sus entradas.
- **Giro dinámico**: en el tick 4 el viento rola al rumbo opuesto al Hospital Gregorio Marañón (calculado con coordenadas reales, ≈ SSO) y el humo va hacia el hospital; las propuestas pendientes pasan a `invalidada` y se genera una replanificación.
- **Doctrina**: cada denegación se convierte en una regla que Claude recibe en todas las propuestas siguientes (bonus "aprender de interacciones pasadas").

## Datos reales (sin clave)

| Fuente | Uso |
|---|---|
| informo.madrid.es `pm.xml` | sensores de tráfico a < 1,5 km del incidente: carga, nivel de servicio |
| Open-Meteo forecast | viento (dirección/velocidad), humedad, temperatura |
| Open-Meteo air-quality | PM2.5, PM10, CO |
| REE apidatos | demanda eléctrica nacional |

`estado.modoDatos` indica `real | mixto | sin_datos` según cuántas fuentes respondieron.

## Endpoints

| Método | Ruta | Body | Devuelve |
|---|---|---|---|
| GET | `/api/estado` | — | `EstadoSistema` completo (polling 2 s) |
| POST | `/api/escenario` | `{accion:"tick"|"reset"|"auto", autoAvance?, intervaloSeg?}` | `EstadoSistema` |
| POST | `/api/escenario/tick` | — | `{ok, tick, fase, activo}` |
| POST | `/api/decisiones/[id]/aprobar` | `{rol?, via?}` | `EstadoSistema` |
| POST | `/api/decisiones/[id]/denegar` | `{feedback, rol?, ambito?}` | `EstadoSistema` |
| GET | `/api/doctrina` | — | `ReglaDoctrina[]` |
| PATCH / DELETE | `/api/doctrina/[id]` | `{activa?}` | `{ok}` |
| POST | `/api/config` | `{umbralAutonomia?, rolActivo?, autoAvance?, intervaloSeg?}` | `EstadoSistema` |
| GET | `/api/informes` | — | lista sin markdown |
| POST | `/api/informes` | `{tipo:"sitrep"}` | `Informe` |
| GET | `/api/informes/[id]?formato=md` | — | JSON o Markdown descargable |
| POST | `/api/incidente/cerrar` | — | `{ok, informeId, pdfUrl}` (post-mortem) |
| POST | `/api/voluntarios/[id]/publicar` · `/cancelar` | — | `{ok}` |
| POST | `/api/webhooks/happyrobot/ingesta` | `{titulo|summary, detalle|transcript, ubicacion?, confianza?, pedirDecision?, foco?}` | `{recibido, eventoId}` |
| POST | `/api/webhooks/happyrobot/resultado` | `{decisionId, accionId, ref, ok, detalle, canal?}` | `{recibido, acciones}` |

Los webhooks aceptan la cabecera `x-webhook-secret` si `HAPPYROBOT_WEBHOOK_SECRET` está definida.

## Motor dirigido por eventos (desde 2026-09-18 23:20)

Cada evento que entra (`ingestarObservacion`, webhook, reproductor de escenarios, pipeline de periféricos de poc-07) sigue esta cadena:

1. **Verificación** (`router.ts`): duplicados por similitud, bulos precalculados o detectados por Exa, clasificación con Haiku si hay clave.
2. **Clasificación de emergencia** (`plantillas.ts`: `clasificarEmergencia`): 16 tipos (incendio industrial/urbano/forestal, inundación, accidente de tráfico/ferroviario, fuga de gas, derrumbe, apagón, ola de calor, nevada, sismo, aglomeración, vertido químico, persona en peligro, otro) a partir de texto, etiquetas de visión, categoría del periférico y sensores.
3. **Asignación a incidente** (`incidentes.ts`): se une a un incidente activo del mismo tipo a < 1,5 km y < 2 h; si no, abre uno nuevo. `estado.incidentes[]` los lista y `estado.incidente` es el más grave.
4. **Siguiente foco de decisión** (`FOCOS_POR_TIPO`): cada tipo tiene 3-6 focos ordenados; si ya hay una propuesta pendiente para ese (incidente, foco) el evento la **confirma** añadiendo evidencia en vez de duplicarla.
5. **Propuesta** (`crearDecision`): Claude si hay clave; si no, `plantillaPorTipo` con títulos que citan lugar + dato real. Rutas OSRM, dominó desde el vértice del incidente, evidencia con `nodoId`/lat/lon.
6. **Política de autonomía** (`lib/politica-autonomia.ts`, poc-c5): `Decision.competencia` decide si la IA ejecuta sola, si basta supervisión o si exige firma humana y de qué rol.

El guion de 8 ticks (`escenario.ts`) sigue existiendo como escenario "simulacro-mendez-alvaro" del reproductor.

## Tiempo real y simulación

- `GET /api/estado/stream`: SSE con evento `estado` (EstadoSistema completo con `version`) en cada cambio y `ping` cada 15 s.
- `POST /api/simulacion {escenarioId, velocidad, desde?}` · `GET` · `DELETE` · `POST /api/simulacion/evento {observacion,…}` · `GET /api/simulacion/escenarios`: reproductor en servidor que lee `data/dataset/*.json` (poc-26) e inyecta cada evento por `POST /api/ingesta/observacion` (poc-07) o, si no responde, por `ingestarObservacion`. `estado.simulacion` refleja su estado.

## Geografía real (`lib/server/geo/`)

`utm.ts` (sensores de tráfico UTM 30N → WGS84), `nominatim.ts` (directo e inverso, 1 req/s, caché), `overpass.ts` (POIs), `osrm.ts` (rutas por calle), `penacho.ts` (cono de humo en metros), `nodos-osm.ts` (coordenadas reales de los 10 nodos base con osmId). En el estado: `nodos[].lat/lon/osmId`, `mapa {centro, sensores, pois}`, `entorno.penacho`, `Decision.rutas`. El grafo completo (62 vértices OSM) lo construye `lib/server/grafo-real` (poc-07) al arrancar y con `aplicarGrafo()` en caliente.

## Roles y autorización

El rol activo llega en la cabecera `x-atalaya-rol` (o `body.rol`) y se normaliza con `normalizarRol()` de `lib/roles.ts` (acepta los valores antiguos). Sin permiso: **403** `{ error, permiso, escalarA }`.

| Ruta | Permiso |
|---|---|
| aprobar / denegar | `decidir` y `riesgo ≤ riesgoMaxDecision` del rol (`puedeDecidir`) |
| escalar | cualquier rol; el destino debe tener `decidir` |
| config `umbralAutonomia` | `fijar_umbral` |
| escenario tick/reset/auto, config `autoAvance` | `controlar_simulacion` o Dirección del Plan |
| doctrina (PATCH/DELETE) | `editar_doctrina` |
| voluntarios publicar/cancelar | `gestionar_voluntarios` |
| incidente/cerrar | `firmar_informes` |
| POST informes (SITREP) | `generar_informes` |
| agentes/preguntar | `interrogar_ia` |
| GET estado / publico / informes / doctrina | libre |

Endpoints añadidos para roles: `POST /api/decisiones/[id]/escalar { a: RolId }` (→ `Decision.escaladaA`, llamada por voz vía HappyRobot si está configurado), `GET /api/publico` (portal ciudadano sin datos internos, `lib/server/publico.ts`), `POST /api/agentes/preguntar { pregunta, decisionId? }` (interrogatorio a la IA limitado a evidencia + doctrina + traza, `lib/server/agentes.ts`).

## Variables de entorno

Ver `.env.example`. Sin `ANTHROPIC_API_KEY` el proponente usa plantillas deterministas que interpolan los datos reales; sin HappyRobot/Twilio las órdenes internas quedan en el "Cuaderno" y las externas se marcan `Ninguno` (sin canal), nunca se disfrazan de reales.

## Guion de la demo (ticks)

| Tick | Qué pasa | Decisión que se pide |
|---|---|---|
| 0 | Reporte ciudadano + visión FalAI + Exa | Despliegue inicial |
| 1 | Telemadrid confirma; humo cruza la M-30 | Corte M-30 (total/parcial según tráfico real) |
| 2 | 112: olor a humo en urgencias del Gregorio Marañón | Proteger hospital + tarea voluntarios |
| 3 | HappyRobot: residencia de mayores a 300 m | Evacuación · SITREP |
| 4 | **Giro**: viento rola a componente sur, humo hacia el Gregorio Marañón (NNE, 2,7 km) | Replanificación; invalida pendientes |
| 5 | Exa: 240 menciones, vídeos reciclados | Comunicado + ES-Alert |
| 6 | Bomberos: controlado al 80 % | SITREP |
| 8 | Cierre | — (POST /api/incidente/cerrar → post-mortem) |

Avance manual: `POST /api/escenario/tick`. Automático: `POST /api/escenario {accion:"auto", autoAvance:true, intervaloSeg:45}`.

## Servicios: proveedor real por capa (pasada "sin modo simulado", poc-c8)

Cada capa tiene un proveedor externo y uno **local real** de respaldo; `estado.conectores` y `estado.conectoresDetalle` dicen cuál responde. Nada se inventa: sin proveedor, la capa se omite y se indica.

| Capa | Externo (con clave) | Local (sin clave) | Sin ninguno |
|---|---|---|---|
| LLM (plan, clasificación, traducción, interrogatorio) | Claude (`ANTHROPIC_API_KEY`) | Ollama (`gemma3:4b`, 0.34, ~20 tok/s) vía `conectores/llm.ts` `generarEstructurado()` | plan por `plantillas.ts`; router no registra modelos |
| Visión (`imagenUrl` http/https) | fal.ai | Ollama multimodal | solo texto |
| Búsqueda / anti-reciclado | Exa | RSS de Google Noticias (fuente "Prensa") | verificador local por similitud |
| Protocolos (RAG) | QuiverAI | RAG local sobre BOE (Ley 17/2015, RD 524/2023, PLATERCAM, PEMAM; 1 474 fragmentos, embeddings Ollama; `docs/rag-local.md`) | protocolo de plantilla |
| Audio de alertas | ElevenLabs (+ R2) | `say` de macOS + ffmpeg → `/audio/*.mp3` | `audiosAlerta = []` |
| Grafo | ArangoDB (Docker `:8529`, BD `crisis`) | `GrafoMemoria` (mismo BFS) | — |
| Ejecución | HappyRobot / Twilio | — | internas → "Cuaderno" (ok); externas → "Ninguno" (ok:false, "sin canal") |

Firmas estables que usa el motor: `proponer(ctx)` (lanza sin LLM), `iaDisponible()`, `MODELO_PLAN()`, `normalizarRegla()`, `procesarEvento()`, `ejecutarDecision()`, `llamarCargo()`, `proveedorDisponible()`, `generarAudios()`, `audioDisponible()`, `elevenlabsDisponible()`, `estadoConectores()`, `detalleConectores()`, `protocolosDisponibles()`, `protocoloAplicable()`, `proveedorGrafo()`, `sembrarArango()`.

Tiempos: dentro del bloqueo del motor toda llamada externa tiene límite (Open-Meteo/REE 8 s, tráfico 12 s, Overpass 6 s, OSRM 8 s, plan `LLM_TIMEOUT_MS` = 45 s con caída a plantilla, clasificación ligera 10 s y omitida si Ollama está ocupado). Las lecturas (`/api/estado`, stream) no esperan al bloqueo.

## Pendiente
- PDF del post-mortem a R2 (`Informe.pdfUrl`, hoy `null`).
- HappyRobot real: falta la forma exacta de su API (docs con código de acceso).
