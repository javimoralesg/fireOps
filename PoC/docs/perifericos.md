# Periféricos e inputs reales — grafo real, cámaras, publicaciones (sesión poc-07)

Fecha: 2026-09-18. Encargo de Javi: *"que sean grafos reales, que se puedan poner cámaras de móvil para simular eventos y que el modelo responda, poder poner publicaciones, periféricos que nutran la app con inputs reales y cambiantes; que sea una demo real"*.

## 1. La idea en una frase

Atalaya deja de correr un guion y pasa a **reaccionar a lo que le entra por periféricos reales**: el móvil del jurado (cámara, GPS, voz), un móvil en trípode como cámara fija, las **cámaras públicas de tráfico del Ayuntamiento**, publicaciones de una red social simulada y la línea de voz de HappyRobot. Cada observación se geolocaliza sobre un **grafo real de la ciudad (OpenStreetMap → ArangoDB)**, se verifica (FalAI + Claude + Exa), se traduce en un impacto sobre el grafo y, si procede, en una **decisión nueva** que el mando aprueba o deniega. El guion actual se queda como *simulacro* de respaldo.

Por qué importa para el jurado: los tres criterios (decisión, ejecución, supervisión) se ven **en directo sobre inputs que ellos mismos generan**; nadie puede pensar que está grabado.

## 2. Qué es real en la demo

| Input | Fuente real (verificada hoy, sin clave salvo IA) | Qué hace el sistema |
|---|---|---|
| Foto desde el móvil | Cámara + GPS + brújula del móvil del jurado (HTTPS por túnel) | FalAI describe → Claude clasifica (incendio/humo/inundación/accidente…) → nodo `Incidencias/…` en el grafo real → efecto dominó → decisión |
| Cámara fija (modo vigilancia) | Móvil en trípode enviando un fotograma cada 15 s | Solo genera evento cuando **cambia** la escena (de "sin novedad" a "humo", de "humo" a "fuego") → *agrava* / *mitiga* |
| Cámaras de tráfico | `informo.madrid.es/informo/tmadrid/CCTV.kml` (357 cámaras; 44 a < 2,5 km del incidente, dos a 230 m) con JPEG en vivo | Miniaturas en la consola; análisis de visión bajo demanda o periódico |
| Voz | Web Speech API en el móvil (es-ES) o línea HappyRobot (webhook ya existente) | Transcripción → clasificación Haiku → evento |
| Publicaciones | Muro social propio donde el jurado publica texto+foto; Exa para cruzar con lo ya publicado | Duplicados agrupados ("N menciones"), contenido reciclado marcado *sospechoso*, ≥ 3 sospechosos → decisión de **desmentido** para el Gabinete |
| Posición de efectivos | GPS del móvil de un "efectivo" | El nodo `Efectivos/…` se mueve en el mapa; al llegar al destino la acción se marca cumplida |
| Sensor / hardware | Cualquier `POST /api/ingesta/observacion` (ESP32 con sensor de humo, Raspberry con cámara) | Mismo pipeline; el acelerómetro del móvil sirve de sensor de vibración sin hardware |
| Grafo | Overpass (OSM): 490 elementos a 2,5 km (2 hospitales, 6 parques de bomberos, 12 subestaciones, 34 centros sociales/residencias, 132 colegios, 30 estaciones, vías principales) | Vértices con lat/lon; aristas derivadas por geometría; ArangoDB con la query AQL de la spec |
| Entorno | Open-Meteo, tráfico Madrid, REE (ya integrado por poc-55) | Igual que hoy |

## 3. Grafo real

**Fuente.** Overpass API (`overpass-api.de`, espejo `overpass.kumi.systems`) alrededor del incidente. Consulta: `amenity ∈ {hospital, fire_station, police, school, social_facility, fuel, community_centre}`, `power=substation`, `railway=station`, `leisure=sports_centre`, vías `motorway|trunk|primary` con nombre. Resultado cacheado en `data/osm/` y con **snapshot versionado** en `lib/server/grafo-real/snapshot-mendez-alvaro.json` para que la demo no dependa de Overpass en directo.

**Tipos.** Se amplía `TipoNodo` (lib/types.ts, hecho) con `Residencia | Colegio | Subestacion | Estacion | Refugio | Gasolinera`; `NodoGrafo` gana `lat, lon, subtipo, origen, osmId, detalle`. Mapeo: hospital→Hospital, fire_station→Bomberos, police→Policia, social_facility/centro de mayores→Residencia, school→Colegio, substation→Subestacion, station→Estacion, sports_centre/community_centre→Refugio, fuel→Gasolinera, vías→Carretera.

**Ids compatibles.** Los vértices clave conservan los ids del grafo actual para que guion, plantillas y `nodoDeUbicacion` sigan funcionando: `Infraestructuras/hosp-gregorio` (Hospital Gregorio Marañón, se pide explícitamente a 5 km), `Infraestructuras/m30-sur` (vía con `ref=M-30` más cercana), `Infraestructuras/via-mendez-alvaro`, `Infraestructuras/subest-arganzuela` (→ Subestación de Cerro de la Plata, real), `Infraestructuras/ruta-evac-3` y `Infraestructuras/cecom-112` (manuales, con coordenadas), `Efectivos/bomberos-p7` (→ base más cercana: Calle30 · Méndez Álvaro), `Efectivos/policia-u12`, `Efectivos/samur-a3`.

**Aristas derivadas (deterministas y explicables).**
- `Incidencia → BLOQUEA_A → Carretera` a < 350 m o bajo el penacho (sector de 60° a sotavento, 1,2 km, según el viento real).
- `Incidencia → BLOQUEA_A → Subestacion` a < 500 m.
- `Carretera → SUMINISTRA_A → {Hospital, Residencia, Colegio, Estacion, Refugio}`: la vía principal más cercana a < 400 m es su acceso.
- `Subestacion → SUMINISTRA_A → {Hospital, Centro_Comunicaciones, Estacion}`: la subestación más cercana a < 1,5 km.
- `Efectivo → DESPLEGADO_EN`: bomberos más cercanos → incidencia; policía → vía bloqueada; sanitarios → hospital.

**Tamaño.** Todo a < 1,2 km + críticos (hospitales, bomberos, subestaciones, residencias) a < 3 km; colegios solo a < 800 m. Objetivo ≈ 60 vértices.

**ArangoDB.** `docker-compose.yml` con `arangodb` en `:8529`; `aplicarGrafoReal()` re-siembra `Incidencias / Infraestructuras / Efectivos / Relaciones` con los vértices reales (campo `geo: [lon, lat]` con índice geo) y la query de dominó de la spec sigue igual. `TIPOS_CRITICOS` debe ampliarse a `Residencia, Colegio, Subestacion, Estacion` (petición a poc-55).

**Mapa.** `components/perifericos/MapaReal.tsx`: mapa de teselas raster (CARTO light/dark según tema, `© OpenStreetMap contributors © CARTO`) sin dependencias nuevas, con capa SVG: vértices en lat/lon, aristas, penacho según viento real, periféricos con cono de rumbo, cámaras de tráfico, sensores. El `GrafoCiudad` actual sigue funcionando porque el backend proyecta lat/lon a `x,y` 0..100 dentro del bbox.

**Incidencias nuevas.** Una observación grave a > 250 m de cualquier incidencia crea `Incidencias/per-<id>` con aristas a las vías y equipamientos a < 300 m; el dominó se recalcula desde ese vértice. Varias incidencias conviven (incendio + inundación + accidente).

## 4. Periféricos

**Emparejamiento.** `/periferico` en el móvil (QR en la consola con la URL pública). El usuario elige *Ciudadano · Cámara fija · Efectivo · PMA*, pone un nombre y recibe un `Periferico.id` (localStorage). Latido cada 10 s con posición y capacidades; en línea = latido < 30 s.

**Pantalla móvil.** Cámara (vista previa, *Enviar foto*, *Vigilancia cada 15 s*), Voz (dictado es-ES, textarea de respaldo), Publicar (texto + foto + alias; muro con estado de verificación), Estado (GPS, rumbo, batería, último resultado: *"categoría humo 0,91 → nueva decisión: Corte de C/ Méndez Álvaro"*). Si `!isSecureContext` avisa de que hace falta el túnel. Sacudida fuerte (acelerómetro) = observación `sensor`.

**Reputación.** Cada periférico tiene `confianza` 0..1 que sube con observaciones fiables y baja con falsas/duplicadas; entra en la verificación y se enseña en la consola.

**Cámaras de tráfico.** Se descubren solas desde el KML; la consola muestra las 6 más cercanas con imagen que se refresca cada 60 s y botón *Analizar*; vigilancia periódica opcional (cuesta tokens).

## 5. Pipeline de ingesta (`lib/server/perifericos/pipeline.ts`)

1. **Almacén**: la imagen se guarda en R2 si hay credenciales; si no, en `data/uploads/` servida por `GET /api/ingesta/imagen/[id]`. `imagenUrl` va en el evento.
2. **Visión y texto**: FalAI `fal-ai/moondream2/visual-query` (caption + clases, solo con `FAL_KEY`) → `generarEstructurado` de `lib/server/conectores/llm.ts` (poc-c8): Claude si hay `ANTHROPIC_API_KEY`, si no Ollama local `gemma3:4b` (multimodal) → `AnalisisVision` estructurado (categoría, confianza, gravedad, etiquetas, personas). El texto/voz se clasifica igual (nivel "ligero"). Sin ningún proveedor: imagen → `motor: "ninguno"`, `modelo: "sin-analisis"`; texto → `motor: "palabras-clave"` marcado como tal. Nada se disfraza de modelo. Timeouts: 60 s visión, 50 s texto (Ollama comparte cola con el router y va lento en máquina cargada; con Claude son segundos).
3. **Publicaciones y rumor**: además, `procesarEvento` de `router.ts` (poc-c8) vuelve a clasificar el evento y detecta rumor; se reutiliza.
4. **Verificación**: duplicado por geo+tiempo+similitud (mismo lugar a < 150 m y < 10 min); publicaciones con Exa (`POST https://api.exa.ai/search`, `x-api-key`, `endPublishedDate` = ayer): si el texto/imagen ya circulaba antes del incidente → `sospechoso` con URL y fecha. Reputación del periférico pondera la confianza.
5. **Impacto** (`impacto.ts`): decide `ruido | registrado | confirma | nuevo_foco | agrava | mitiga | desmentido_sugerido` con distancia a incidencias, categoría, gravedad y estado previo del periférico (modo vigilancia solo emite si cambia la categoría o la confianza salta > 0,25). Anti-saturación: ventana de 10 s por periférico y máximo una decisión por foco pendiente.
6. **Motor**: poc-55 expone `ingestarObservacion(evento, { pedirDecision, foco, descripcionFoco, origenDomino, nodoNuevo, aristasNuevas, invalidarFocos, motivoInvalidacion }) → { estado, eventoId, decisionId? }` en `lib/server/motor.ts`: respeta la verificación precalculada, añade vértice/aristas antes de proponer, corre el dominó desde `origenDomino` (la incidencia nueva) y no pide decisión si el evento queda sospechoso/duplicado. El pipeline pide decisión con foco `obs_<categoria>` y una descripción que cita periférico, lugar (vértice más cercano y distancia; Nominatim inverso cuando poc-55 lo exponga) y equipamientos cercanos, e invalida pendientes cuando *agrava*.
7. **Respuesta al periférico**: `ResultadoIngesta` con lo que pasó, para que el móvil lo enseñe.

### Simulador de escenarios (poc-26)

El panel *Simulador* de la consola reproduce un dataset de emergencias (incendio, inundación, fuga de gas, terremoto, ola de calor, nevada, accidente ferroviario, amenaza…) con coordenadas reales de Madrid y lo inyecta **por la misma puerta** (`POST /api/ingesta/observacion` y `/publicacion`) con `perifericoId: "simulador"` y `simulacro: true`. Puede traer `imagenUrl` pública en vez de base64, `categoriaForzada`/`gravedadForzada` (la categoría **esperada** del dataset) y `tipoEmergencia` libre. El pipeline siempre intenta el análisis real; si un modelo real (Claude, Ollama, FalAI) clasifica, la esperada se ignora y sirve para comparar en el panel; solo si ningún modelo ha podido (sin proveedor, timeout, cola ocupada) se usa la esperada con `motor: "dataset"` y `modelo: "dataset (clasificación esperada)"`, anotado así en `procesadoPor`. El periférico virtual "Simulador de escenarios" (tipo `webhook`) se crea solo, no altera reputación, y sus eventos llevan la etiqueta `simulacro` y el título con prefijo `[Simulacro]` para que el jurado distinga lo simulado de lo real. Ventana anti-saturación de 2 s para él.

## 6. Publicaciones

- **Entrada**: muro en `/periferico › Publicar`; `POST /api/ingesta/publicacion`. Se guardan en `data/publicaciones.json` y se listan en `GET /api/ingesta/publicaciones` (con verificación y agrupación de similares).
- **Salida**: los comunicados aprobados por el Gabinete aparecen en el mismo muro con `origen: "gabinete"` (y en `/ciudadano` de poc-18). Opcional si sobra tiempo: publicar el comunicado real en una cuenta de Bluesky (API abierta) para que el jurado lo vea en su móvil.

## 7. Guion de demo real (≈ 10 min)

1. QR en pantalla; el jurado abre `/periferico` (Ciudadano). La consola muestra el mapa real alrededor de Méndez Álvaro con viento y tráfico reales.
2. Miembro A fotografía una lámina impresa de humo → en < 10 s: evento con imagen y etiquetas, nodo nuevo en su posición, dominó con la residencia Emera y la estación de Méndez Álvaro, decisión *Despliegue*. El Director aprueba → HappyRobot/Twilio llama.
3. Miembro B publica *"explosión química, están evacuando todo"* con una foto vieja → Exa la marca *sospechoso* → decisión de *desmentido* para el Gabinete.
4. Móvil en trípode apuntando a una tablet con un vídeo de incendio: modo vigilancia detecta *humo → fuego*: **agrava**, invalida la propuesta pendiente y replanifica.
5. Miembro C se registra como *Efectivo* y camina: su nodo se mueve en el mapa hasta la residencia.
6. Panel de cámaras municipales: análisis de una cámara real de la M-30 a 230 m.
7. Se deniega una propuesta con feedback → doctrina → la siguiente propuesta la respeta. Cierre → post-mortem.

## 8. Requisitos para que sea real

- **HTTPS**: `scripts/tunel.sh` (cloudflared instalado; sin cuenta) deja la URL en `data/url-publica.txt`; el QR la usa. Sin HTTPS el móvil no da cámara ni GPS.
- **Claves**: `ANTHROPIC_API_KEY` (imprescindible), `FAL_KEY`, `EXA_API_KEY`; opcionales `R2_*`; ArangoDB por `docker compose up arango`.
- **Material**: 3–4 láminas impresas (humo, fuego, inundación, calle normal), tablet con vídeo, trípode, un móvil por rol.
- **Red**: móviles y portátil pueden ir por datos; el túnel evita depender de la Wi-Fi del recinto.

## 9. Archivos, contratos y reparto (columna poc-07)

| Pieza | Archivos | Subagente |
|---|---|---|
| Tipos y registro | `lib/tipos-perifericos.ts`, `lib/server/perifericos/registro.ts`, `scripts/tunel.sh`, cambios aditivos en `lib/types.ts` | hecho (poc-07) |
| Grafo real | `lib/server/grafo-real/*` (osm, construir, proyeccion, arango, index, snapshot), `app/api/grafo/real/route.ts`, `docker-compose.yml`, `data/osm/` | A |
| Móvil | `app/periferico/*`, `components/perifericos/{Emparejar,Camara,Voz,Publicar,EstadoMovil}.tsx`, `lib/usePeriferico.ts`, `app/api/perifericos/route.ts`, `app/api/perifericos/[id]/{latido,route}.ts` | B |
| Pipeline | `lib/server/perifericos/{pipeline,vision,almacen,verificacion,impacto,motorAdaptador,camarasMadrid,geocodificacion,publicaciones}.ts`, `app/api/ingesta/*`, `app/api/perifericos/camaras/*`, `data/uploads/`, `data/publicaciones.json` | C |
| Consola | `app/perifericos/page.tsx` (sala de periféricos a pantalla completa), `components/perifericos/{PanelPerifericos,MapaReal,CamarasTrafico,MuroPublicaciones,QrUnirse}.tsx`, `lib/usePerifericos.ts` | D |

**Endpoints nuevos**

| Método | Ruta | Body / respuesta |
|---|---|---|
| GET | `/api/perifericos` | `EstadoPerifericos` |
| POST | `/api/perifericos` | `{nombre, tipo, capacidades?, posicion?}` → `Periferico` |
| POST | `/api/perifericos/[id]/latido` | `{posicion?, capacidades?, modo?, intervaloVigilanciaSeg?}` → `Periferico` |
| PATCH / DELETE | `/api/perifericos/[id]` | cambios / baja |
| GET | `/api/perifericos/camaras` | `CamaraTrafico[]` (las más cercanas al incidente) |
| POST | `/api/perifericos/camaras/[id]/analizar` | → `ResultadoIngesta` |
| POST | `/api/ingesta/observacion` | `ObservacionEntrante` → `ResultadoIngesta` |
| POST | `/api/ingesta/publicacion` | `{perifericoId?, autor, texto, imagenBase64?, posicion?}` → `Publicacion` + `ResultadoIngesta` |
| GET | `/api/ingesta/publicaciones` | `Publicacion[]` |
| GET | `/api/ingesta/imagen/[id]` | JPEG |
| GET / POST | `/api/grafo/real` | grafo real calculado / lo aplica al estado (y a Arango) |

**Peticiones a otras sesiones**
- poc-55: `FuenteDato` += `Periferico | CamaraTrafico | OSM`; `TIPOS_CRITICOS` ampliado (grafo.ts y AQL); `fabricaInicial` usa `construirGrafoReal()` con fallback a `NODOS/ARISTAS`; opcional `ingestarObservacion()` en motor.ts; `.env.example` con `FAL_KEY`, `EXA_API_KEY` ya existen.
- poc-26: `NODO_UI[n.tipo] ?? NODO_DESCONOCIDO` en GrafoCiudad + entradas de los 6 tipos nuevos; `FUENTE_UI` (FeedIngesta y decision/ui.ts) con `Periferico` y `CamaraTrafico`; pestaña *Periféricos* y conmutador *Grafo | Mapa real* en la consola; miniatura `imagenUrl` ya existe.
- poc-18: ✅ `FUENTE_PUBLICA`; añadirá enlaces a `/periferico` (ciudadanía) y `/perifericos` (Administración, Sala 112) en `/acceso` cuando respondan 200.
- poc-26: `components/mapa/*` es suyo; montará `CapasPerifericos` (solo cliente, capas react-leaflet) dentro de `MapaCiudadCliente`; pasa a poc-25 los fallbacks de `NODO_UI`/`FUENTE_UI`; su simulador entra por `/api/ingesta/*`.
- poc-b5 (HappyRobot): sin túnel propio; `conectores/happyrobot.ts` importa `urlPublica()` de `registro.ts` (firma `{ url, segura, origen }` estable) para el callback; Javi arranca `scripts/tunel.sh`.
- poc-25: tokens ya se usan; nada.

## 10. Riesgos y respaldos

| Riesgo | Respaldo |
|---|---|
| Overpass caído en la demo | snapshot versionado |
| Sin FAL_KEY / ANTHROPIC | Claude solo / categoría `otro` marcada como no analizada; el evento entra igual |
| Sin túnel | texto y publicaciones funcionan por HTTP; cámara/GPS no |
| Arango no arranca | `GrafoMemoria` con los mismos vértices reales (`origenGrafo: memoria`) |
| Saturación de fotos del jurado | ventana de 10 s por periférico, agrupación de duplicados, una decisión por foco |
| iOS bloquea brújula | permiso bajo gesto; sin rumbo el cono no se dibuja |

## 11. Estado a 2026-09-18 22:30 y cómo probarlo

Todo lo de la columna poc-07 está desplegado en `:3456` y `npx tsc --noEmit` da 0 errores en el proyecto.

| Pieza | Estado | Comprobación rápida |
|---|---|---|
| Móvil `/periferico` | ✅ | `curl -s -o /dev/null -w "%{http_code}" localhost:3456/periferico` |
| Registro `/api/perifericos` | ✅ | `curl -s -X POST -H 'content-type: application/json' localhost:3456/api/perifericos -d '{"nombre":"Móvil de Javi","tipo":"movil_ciudadano"}'` |
| Pipeline `/api/ingesta/observacion` | ✅ | ver abajo |
| Publicaciones `/api/ingesta/publicacion` | ✅ | dos veces el mismo texto → la segunda `duplicado`, `menciones: 2` |
| Cámaras municipales `/api/perifericos/camaras` | ✅ | `POST /api/perifericos/camaras/02306/analizar` → evento `CamaraTrafico` con imagen servida |
| Grafo real `/api/grafo/real` | ✅ 62 vértices / 51 aristas (snapshot) | `GET` lo calcula; `POST` lo aplica al estado (pendiente: poc-55 lo engancha en `fabricaInicial` para que sobreviva al reset) |
| Sala `/perifericos` | ✅ | mapa Leaflet con capas de periféricos, cámaras y observaciones |

Prueba de extremo a extremo hecha (sin claves de IA, con el grafo real aplicado): observación de voz *"fuerte olor a gas y un escape visible…"* en Pedro Bosch → categoría `fuga_gas` (clasificador de palabras clave), lugar por Nominatim *"Calle de Pedro Bosch, Retiro · a 22 m de Calle del Doctor Esquerdo"*, **nuevo foco** `Incidencias/per-…` con `BLOQUEA_A` a dos vías OSM, equipamientos cercanos reales (estación Pacífico a 45 m, centro de mayores a 91 m), decisión `obs_fuga_gas` con dominó real (escuela infantil, residencias, estaciones) y acciones de la plantilla de fuga de gas. Con `ANTHROPIC_API_KEY` la clasificación y la redacción las hace Claude; con `FAL_KEY` las fotos se describen de verdad; con `EXA_API_KEY` las publicaciones recicladas se marcan sospechosas.

Para la demo con móviles:
1. `scripts/tunel.sh` (deja la URL https en `data/url-publica.txt`; el QR de la sala y la consola la usan; HappyRobot también).
2. Claves en `.env.local`: `ANTHROPIC_API_KEY`, `FAL_KEY`, `EXA_API_KEY` (y `R2_*` si se quiere imagen pública). ArangoDB: `docker compose up -d arango` + `ARANGO_*` en `.env.local`.
3. Reset del escenario y comprobar que `estado.nodos` trae 60+ vértices con lat/lon (si no, `POST /api/grafo/real`).
4. Abrir `/perifericos` en la pantalla grande y escanear el QR con los móviles.
