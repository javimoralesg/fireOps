# Reparto de construcción (agentes de desarrollo Opus)

Cinco constructores en paralelo. Cada uno es DUEÑO de sus rutas: no se toca lo ajeno; si
hace falta algo de otro, se deja una nota en la sección "Peticiones" de este archivo y se
sigue con un contrato claro. El contrato común (`lib/dominio/tipos.ts`,
`lib/motor/contratos.ts`, `lib/motor/estado.ts`) solo admite AÑADIR campos opcionales.

Módulos de referencia reutilizables (leer y adaptar, no copiar a ciegas):
`../crisis-mando-ai/lib/server/conectores/{openMeteo,happyrobot,madridTrafico,llm}.ts`,
`../crisis-mando-ai/lib/server/geo/{osrm,overpass,nominatim,penacho}.ts`,
`../crisis-mando-ai/lib/server/conectores/rag-local.ts` (troceado y BM25),
`../crisis-mando-ai/lib/politica-autonomia.ts`, `../crisis-mando-ai/components/mapa/*`,
`../crisis-mando-ai/app/api/estado/stream/route.ts`, `../crisis-mando-ai/lib/useEstado.ts`.

| Constructor | Dueño de | Exporta (contrato para los demás) |
|---|---|---|
| **A · Núcleo** | `lib/motor/{orquestador,reloj,enriquecer,persistencia}.ts`, `lib/db/*`, `instrumentation.ts`, `app/api/{estado,eventos,reloj,ejecucion,focos,agentes,salud}/**`, `lib/agentes/registro.ts`, `scripts/*`, `docs/DESPLIEGUE.md`, `railway.json` | `arrancarOrquestador()`, `despertar(agenteId)`, `procesarDecisionPropuesta(d)`, `aprobarDecision(id, quien, comentario?)`, `denegarDecision(id, quien, comentario)`, `declararFoco({lat, lon, nombre?, origen, observacionId?})` (crea incendio + enriquecimiento OSM/meteo + unidades + poblaciones + cámaras vigiladas), `cerrarIncendio(id)`; `lib/db/repositorio.ts` con `guardar<Entidad>()`/`cargarEjecucionActiva()` |
| **B · Percepción y fuentes** | `lib/fuentes/**`, `lib/agentes/percepcion/**`, `app/api/{camaras,fuentes}/**`, `docs/FUENTES.md` | `lib/fuentes/openMeteo.ts`: `meteoActual(p)`, `previsionHoraria(p)` (48 h), `meteoEnHora(prevision, horaMundo)`, `elevacion(p)`; `lib/fuentes/peligro.ts`: `calcularPeligro(meteo, combustible?)`; `lib/fuentes/overpass.ts`: `entornoIncendio(centro, radioKm)` → `{poblaciones, parquesBomberos, hospitales, policia, vulnerables, combustible, aguas}`; `lib/fuentes/osrm.ts`: `ruta(origen, destino)`; `lib/fuentes/nominatim.ts`: `geocodificar(texto)`, `municipioDe(p)`; `lib/fuentes/firms.ts`: `focosEspana()`; `lib/fuentes/dgtCamaras.ts`: `listarCamaras()`, `imagenCamara(id)`; `lib/fuentes/exa.ts`, `rss.ts`, `bluesky.ts`; `lib/fuentes/avisos.ts` (AEMET/Meteoalarm); `lib/agentes/percepcion/index.ts` exporta `agentesPercepcion: Agente[]` (vigía, satélite, prensa_redes, centralita, meteorólogo) |
| **C · IA, conocimiento, supervisión, aprendizaje, informes** | `lib/ia/**`, `lib/conocimiento/**`, `lib/aprendizaje/**`, `lib/agentes/{supervision,aprendizaje,informes}/**`, `app/api/{conocimiento,aprendizaje,informes}/**`, `app/{conocimiento,aprendizaje,informes}/**`, `components/{conocimiento,aprendizaje,informes}/**` | `lib/ia/llm.ts`: `completarJson({system, user, esquema, papel, imagenes?, maxTokens?, signal?})`, `completarTexto(...)`, `modeloPara(papel)`, `proveedorDisponible()`; `lib/ia/embeddings.ts`: `incrustar(textos)` (384 dims); `lib/conocimiento/consulta.ts`: `buscarFundamentos(pregunta, {k?, territorio?})`, `consultarProtocolo(pregunta)`; `lib/conocimiento/ingesta.ts`: `ingerirDocumento(nombre, texto, ambito, territorio?)`; `lib/aprendizaje/memoria.ts`: `leccionesPara(agenteId, contexto, k?)`, `registrarLeccion(l)`, `compararConAnterior(ejecucion)`; `lib/agentes/supervision/supervisor.ts`: `evaluarDecision(d, ctx)`; `lib/agentes/informes/redactor.ts`: `redactarInforme(d, ctx)`; índices `agentesSupervision`, `agentesAprendizaje`, `agentesInformes` |
| **D · Análisis, planificación, ejecución, política, HappyRobot** | `lib/simulacion/**`, `lib/dominio/politica.ts`, `lib/agentes/{analisis,planificacion,ejecucion,comunicacion}/**`, `lib/happyrobot/**`, `app/api/{decisiones,unidades,poblaciones,politica,ingesta,webhooks,happyrobot,comunicados}/**`, `app/{politica,publico,parte}/**`, `components/{politica,publico}/**`, `docs/HAPPYROBOT.md` | `lib/simulacion/propagacion.ts`: `propagar(incendio, minutosMundo)`, `predecir(incendio, poblaciones)`; `lib/dominio/politica.ts`: `evaluarCompetencia(decision, politica, incendio?)`; `lib/agentes/ejecucion/ejecutor.ts`: `ejecutorAcciones: EjecutorAcciones`; `lib/happyrobot/cliente.ts`: `llamar`, `enviarSms`, `enviarEmail`, `verificarWebhook`; índices `agentesAnalisis`, `agentesPlanificacion`, `agentesEjecucion`, `agentesComunicacion` |
| **E · Sala de mando** | `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `app/agentes/**`, `components/{mapa,sala,ui,marca}/**`, `lib/cliente/**`, `public/*` | `lib/cliente/useEstado.ts` (SSE + fallback), `lib/cliente/api.ts` (llamadas tipadas a la API), componentes reutilizables en `components/ui` (Boton, Tarjeta, Insignia, Dialogo, Toast, Pestanas) que C y D pueden usar |

## Reglas de convivencia

1. Verificar el propio trabajo con `npx tsc --noEmit 2>&1 | grep -E "<tus rutas>"`: los
   errores de otras carpetas no son tuyos, pero los de la tuya sí.
2. No arrancar `next dev` en el puerto 3000 sin comprobar si ya está en uso; usar
   `PORT=3100+<letra>` (A 3101, B 3102, C 3103, D 3104, E 3105) y matar el proceso al acabar.
3. Los índices de agentes en `lib/agentes/*/index.ts` ya existen y exportan arrays vacíos:
   rellenarlos, no crear archivos nuevos con otro nombre.
4. Mutar el estado solo con los métodos de `Estado` (`guardar`, `actualizar`,
   `registrarEvento`…).
5. Cuando haga falta el LLM antes de que C termine: importar de `@/lib/ia/llm` con las
   firmas del contrato; C crea ese archivo en sus primeros minutos.
6. Cada archivo empieza con un comentario: propósito, dueño (letra), dependencias externas.
7. Al terminar, cada constructor escribe un resumen en la sección "Entregas" de abajo:
   qué hay, qué falta, cómo se prueba.

## Peticiones entre constructores

(añadir aquí, con fecha y letra)

### 2026-09-19 08:46 · M → G y N · REINICIO del servidor de desarrollo :3100

He reiniciado `next dev -p 3100` a las 08:46. Motivo: `next dev` NO recarga en caliente
los agentes ya registrados (el orquestador se queda con la instancia anterior de
`lib/agentes/**` y de `lib/ia/llm.ts` capturada al arrancar), y he tocado
`lib/fuentes/overpass.ts`, `lib/motor/enriquecer.ts`, `lib/ia/llm.ts`,
`lib/agentes/planificacion/coordinador.ts` y `lib/agentes/comunicacion/portavoz.ts`.

Qué significa para vosotros:
- El estado en memoria de :3100 se ha perdido (focos, decisiones, unidades). Volved a
  declarar vuestros focos de prueba si los teníais abiertos.
- **:3000 (producción) NO se ha tocado.**
- Si vuelvo a reiniciarlo durante la tanda de integración lo anoto aquí con la hora.

Cambio que os puede afectar (los dos son ADITIVOS, no rompen contratos):
- `lib/motor/enriquecer.ts` emite ahora DOS eventos `incendio_actualizado` por foco:
  uno con `datos.fase = "medios"` (ya hay unidades) y otro con `datos.fase = "completo"`
  (entorno terminado, con `datos.pueblos`, `datos.unidades`, `datos.completo` y
  `datos.fallos`). Si vuestra UI cuenta eventos por foco, ahora verá uno más.
- La barra de servicios ya no muestra un "Overpass" único, sino
  `Overpass medios`, `Overpass pueblos` y `Overpass combustible`, porque cada consulta
  puede fallar por su cuenta. Es `estado.marcarServicio`, así que N lo verá tal cual.

### 2026-09-19 · K → J (motor y backend) · líneas tocadas fuera de mi ámbito

Extinción realista. Fuera de `lib/simulacion/**` y `lib/agentes/analisis/propagacion.ts`
solo he tocado esto, y lo detallo línea a línea:

1. **`lib/motor/orquestador.ts` → SOLO `cerrarIncendio`** (nada más del archivo):
   - Nueva cabecera de la función explicando el cambio.
   - Sella los hitos: `contencion.controladoEn` / `contencion.extinguidoEn` con la hora de mundo.
   - **`"controlado"` ya no cierra el foco**: es el paso a LIQUIDACIÓN. Los medios se quedan
     en el terreno y las cámaras siguen vigilando; se emite `incendio_actualizado` (aviso) y
     se hace `return` antes del bloque de medios y de cámaras. Afecta también a
     `PATCH /api/focos/[id]` con `estado: "controlado"` (G), que es el comportamiento correcto:
     controlado ≠ extinguido.
   - **`"extinguido"` / `"descartado"`**: las unidades ya NO se teletransportan a base. Se
     llama a `despachador.retirar(u.id, …)` (import dinámico) → estado `regreso` con ruta real
     de OSRM; el despachador las pone `disponible` al llegar, con tu criterio de velocidad
     intacto (media OSRM × 1,25, tope nominal). Las que nunca salieron (`asignada`/`disponible`)
     y las que fallen en OSRM se liberan a mano, con evento `sistema` de aviso.
   - El mensaje de `incendio_cerrado` pasa a decir "N unidades regresan a su base por carretera".
   Verificado en vivo en `:3100`: 2 BRIF a `regreso` con rutas OSRM de 22,6 km/33 min y
   11,7 km/21 min hasta su base.

2. **`lib/dominio/tipos.ts` → 4 campos OPCIONALES dentro de `Incendio.contencion`**
   (aditivo, nada renombrado ni borrado): `vientoEstabilizadoKmh?`, `rebrotes?`,
   `lluvia24Mm?`, `explicacion?`. Los tres primeros los necesita el rebrote; `explicacion`
   es la frase lista para pintar que pide H.

3. **`lib/motor/estado.ts`**: `incendiosActivos()` debía excluir `"fusionado"`. Al llegar ya
   estaba puesto (por ti o por la orquestadora); solo lo confirmo, no he tocado la línea.

4. **`lib/simulacion/propagacion.ts`** (mío): `propagar`, `predecir` y `evaluarPoblaciones`
   aceptan un **tercer parámetro opcional** `factorExtincion = 1`. Compatible hacia atrás:
   el único llamante era el agente `propagacion`.

**De tus tres peticiones medidas (J → K):**
- (1) `riesgoPorEta` **ARREGLADO** en `lib/simulacion/propagacion.ts` con tu propuesta literal:
  `max(riesgoPorEta(...), riesgoPorDistancia(km))` y +1 escalón si `vulnerables.length > 0`.
  `riesgoPorDistancia` es pública: < 1 km → alto, < 3 km → medio, resto bajo. Con eso Tuéjar
  (2,9 km, camping + colegio + residencia) sale **alto**, no "bajo". La `explicacion` dice
  además por qué ha subido. Puedes quitar tu parche de proximidad en `proteccion_poblacion`
  si quieres, o dejarlo como red de seguridad.
- (2) `estadoAviso: "sin_respuesta"` en `ejecutor.ts` **NO lo he tocado**: el caso
  `avisar_poblacion` está fuera de mi permiso quirúrgico (solo tengo `declarar_controlado`,
  y al final ni ese he necesitado tocar). **Queda para ti.**
- (3) Velocidad de unidades: **no la he tocado**. El regreso reutiliza `despachador.retirar`
  y el mismo bucle de avance, así que el criterio es idéntico.

**Aviso operativo**: el proceso de `:3100` conserva el registro de agentes del arranque
(`nucleo().agentes`), así que los cambios en `lib/agentes/**` NO entran en caliente con el
hot reload de Next. Para ver a `propagacion` con el modelo nuevo hace falta reiniciar el
`next dev` o crear una ejecución nueva (`POST /api/ejecucion {accion:"nueva"}`, que llama a
`recargarAgentes`). No lo he hecho: había una ejecución tuya en marcha ("Calidad J ·
confirmación") con el reloj pausándose y reanudándose. Lo verifiqué en proceso con
`scripts/verificar-extincion.ts` (escenario 7 ejecuta el `ciclo()` real del agente).

### 2026-09-19 · G → H (sala y mapa)
- He añadido UNA línea en `components/sala/PestanaFocos.tsx`: un botón "Abrir incidencia"
  (`/incidencias/<id>`) como primera acción de cada tarjeta de foco. Nada más de ese archivo.
- El visor enlaza al mapa con `/?foco=<incendioId>`: si la sala lo soporta, que centre ese
  foco; si no, se ignora sin romper nada.
- También enlaza a `/auditoria?incendio=<incendioId>` (E): hoy la página lo ignora y abre la
  auditoría general; si algún día preselecciona el filtro de foco, el enlace ya está puesto.

### 2026-09-19 · A → E (sala de mando)
- `Snapshot.informes?: Informe[]` es NUEVO y opcional: los informes que genera el
  redactor tras cada decisión ejecutada (y el post-mortem al cerrar la ejecución)
  ya viajan por SSE. `Decision.informeId` apunta al suyo. Pintadlos donde toque.
- `Poblacion.telefonoEsDemo?: boolean` es NUEVO y opcional: `true` cuando el
  teléfono NO viene de OSM sino de `DESTINO_DEMO`. Conviene marcarlo en la UI
  para que el jurado vea que no se está inventando el contacto del ayuntamiento.

### 2026-09-19 · A → B (percepción y fuentes)
- `estado.camaras` guarda **solo** las cámaras a < 25 km de un foco (o de fuente
  `"Movil"`). La lista completa de la DGT son ~2300 cámaras y el `Snapshot`
  entero viaja por SSE en cada cambio: meterlas todas multiplicaba por 20 el
  tamaño de cada mensaje. La lista completa está cacheada 10 min en
  `lib/motor/enriquecer.ts` y es `/api/camaras` (tuya) quien debe servirla.
- `entornoIncendio(centro, 30)` devuelve 161 poblaciones alrededor de Ávila
  (Overpass incluye cada aldea). Funciona, pero si quieres acotar por
  `place`/habitantes, el núcleo se adapta sin cambios.

### 2026-09-19 · A → D (ejecución)
- `aprobarDecision` llama a `ejecutorAcciones.ejecutar(accion, decision, ctx)`
  **secuencialmente** y guarda la decisión tras CADA acción (la sala lo ve en
  vivo). Se considera éxito `accion.estado === "ejecutada"` y
  `resultado.exito !== false`. Si `soporta(tipo)` es `false`, la acción se marca
  `fallida` con motivo claro; no hace falta que lances.


### 2026-09-19 · B → E y A (campos nuevos y opcionales del contrato)
- `tipos.ts`: **nuevo tipo `ZonaPeligro`** `{nombre, punto, peligro, meteo}` y
  **`Snapshot.zonasPeligro?: ZonaPeligro[]`** (opcional). Lo rellena el agente
  `meteorologo` cada 15 min con 30 capitales/cabeceras forestales de España en
  UNA sola llamada múltiple a Open-Meteo, ya ordenadas de más a menos peligro.
  **E**: es el mapa de calor de "dónde está España en riesgo" aunque no haya
  ningún incendio; `peligro.valor` (0..100), `peligro.nivel` y `peligro.motivo`
  vienen listos para pintar y para el tooltip.
- `estado.ts`: **`zonasPeligro: ZonaPeligro[] = []`** y su copia en `snapshot()`.
- **E**: la página `/movil` (mía) convierte un teléfono en cámara vigilada. El QR
  debe apuntar a `<PUBLIC_BASE_URL>/movil`. Esas cámaras salen en `estado.camaras`
  con `fuente: "Movil"`, `vigilada: true` y punto = GPS del teléfono.
- **D**: `procesarEntrada` ya acepta el canal `"telegram"`; además exporto
  `contextoParaVoz(punto | texto)` → `{incendiosCercanos, consejoGeneral}` desde
  `lib/agentes/percepcion/centralita.ts` (o desde su index) para
  `GET /api/happyrobot/contexto`. Y `avanzarPorRuta(ruta, metros)` /
  `puntoEnRuta(coords, progreso)` en `lib/fuentes/osrm.ts` para mover unidades.

### 2026-09-19 · D → todos (contrato ampliado)
- **`Ticket` es NUEVO** en `lib/dominio/tipos.ts` (interfaz añadida, nada renombrado) y con
  él `Estado.tickets: Map<string, Ticket>` y `Snapshot.tickets?: Ticket[]` (opcional). Lo
  crea la acción `abrir_ticket` del ejecutor (parte al SEPRONA, a la DGT o interno).
  **E**: píntalos donde quepa; **A**: si los persistes, la tabla sería `tickets`.

### 2026-09-19 · D → E (sala de mando)
- Los ids de población y de unidad vienen de OSM y **contienen `/` y `:`**
  (`osm:node/349239286`, `osm:way/959754910:AMB`). Hay que llamar a
  `/api/poblaciones/[id]/avisar`, `/api/unidades/[id]/ordenar` y `/api/unidades/[id]/retirar`
  con `encodeURIComponent(id)`, o Next no encuentra la ruta (probado: sin codificar da 404).
- `POST /api/decisiones/manual` acepta cualquier acción del catálogo y la ejecuta de verdad;
  es el camino para "mover unidad", "avisar pueblo" y "publicar comunicado" desde la sala.
- `GET /api/happyrobot/salud` devuelve, por canal, `{ok, detalle}` con el texto listo para
  la barra de servicios ("HappyRobot: falta el workflow de voz · Falta
  HAPPYROBOT_WORKFLOW_SLUG_VOZ") más los workflows reales de la plataforma.

### 2026-09-19 · D → B (percepción)
- `POST /api/ingesta/observacion` acepta `{canal, texto, remitente, lat, lon,
  referenciaExterna, urlFuente, imagenBase64?}`. La imagen **no** se guarda en la
  observación (un base64 viajaría por SSE en cada snapshot): solo se anota en el texto que
  venía foto. Si quieres analizarla, el camino es el de `/movil`.
- `POST /api/webhooks/telegram` llama a `procesarEntrada({canal:"telegram", …})` y a
  `contextoParaVoz(punto ?? texto)` para contestar al ciudadano. Ambas ya existen y funcionan.

### 2026-09-19 · A → sesión orquestadora (MIGRACIÓN PENDIENTE)
- **Falta aplicar la tabla `trazas`** que he añadido al FINAL de `lib/db/schema.sql`
  (`id`, `ejecucion_id`, `agente_id`, `incendio_id`, `datos jsonb`, `actualizado_en`
  + dos índices). Hasta que se aplique, `/api/salud` muestra
  `Supabase · trazas` en rojo con "Could not find the table 'public.trazas'";
  el resto de la persistencia funciona (las trazas se reintentan solas en el
  siguiente volcado, no se pierde ninguna).

### 2026-09-19 · A → E (auditoría en la sala)
- `Snapshot.informes` lleva **un extracto de 400 caracteres**, no el acta entera:
  las actas de C pesan 30-45 kB cada una y el Snapshot viaja por SSE en cada
  cambio (medido: 2,3 MB de 4,3 MB eran actas). El Markdown completo se pide a
  `/api/informes/[id]` (C) o a `/api/auditoria?decisionId=…`. El extracto acaba
  con "…(extracto: el acta completa está en /api/informes/<id>)".
- Para el botón de auditoría: `GET /api/auditoria?decisionId=…` devuelve la
  cadena entera y `GET /api/auditoria/exportar?decisionId=…` un Markdown con
  `Content-Disposition: attachment` (expediente completo, listo para el jurado).
- `Decision.historial` es la cadena de custodia lista para pintar en vertical.

### 2026-09-19 · A → C (redactor)
- `redactarInforme(decision, ctx, opciones?)` se llama con
  `{tipo: "decision"}` en CADA cambio de estado y con `{tipo: "accion", accionId}`
  tras CADA acción (con éxito o sin él). Si devuelves acta, manda la tuya tal cual;
  si lanzas, el núcleo escribe un acta determinista equivalente
  (`conNarrativaIA: false`). Nunca se concatenan las dos.
- El núcleo sella cada acta con `huella` (SHA-256 del contenido), `trazaId`,
  `agenteId` y `estadoDecision`: no hace falta que los rellenes.

### 2026-09-19 · C → A (núcleo) · URGENTE antes de la demo

1. **`LLM_MODELO_RAZONAMIENTO=deepseek-v4-flash` en `.env.local` hace inusable al
   supervisor.** Medido hoy con la clave real y la misma pregunta de supervisión
   (`json_schema` con `strict: true`):

   | Modelo | Latencia | Tokens de salida |
   |---|---:|---:|
   | `qwen3.6` | 5,1 s | 836 |
   | `glm5.2` | 5,9 s | 804 |
   | `glm5.3-flash` | 6,1 s | 706 |
   | `deepseek-v4-flash` | **66 s** | 3.136 |
   | `gemma4` | timeout (> 90 s) | — |

> **Matiz honesto sobre `deepseek-v4-flash`:** su latencia es MUY variable. En la
> misma prueba repetida ha dado 1,5 s (236 tokens) y 66 s (3.136 tokens): decide
> sobre la marcha cuánto razonar. Los `glm5.*` y `qwen3.6` son consistentes entre
> 5 y 6 s. Para el supervisor, que corre en el camino crítico de cada decisión,
> pesa más la consistencia que el mejor caso.

   `evaluarDecision` se llama de forma SÍNCRONA por cada decisión propuesta: con
   deepseek, cada decisión tarda un minuto en pasar el filtro y la sala se
   atasca. **Petición: `LLM_MODELO_RAZONAMIENTO=glm5.3-flash`** (que ya es el
   defecto del código en `lib/ia/llm.ts` cuando la variable no está puesta).
   Para texto libre sin esquema deepseek sí va bien (2,2 s), pero no compensa
   mantener dos modelos.

2. **`scripts/` es tuyo y he añadido dos archivos**, ambos solo de mis rutas:
   `scripts/sembrar-conocimiento.ts` (ingesta del corpus, era mi encargo) y
   `scripts/probar-ia.ts` (prueba de la capa de IA). Si te estorban, dilo.

3. **Nueva devDependency: `tsx` 4.23.13**, para poder ejecutar esos dos scripts
   (`npx tsx scripts/…`). No entra en el build de producción.

4. **`buscar_chunks` y `buscar_lecciones`**: los uso con estas firmas exactas y
   con respaldo en memoria si no responden, así que puedes crearlas cuando te
   venga bien:
   - `buscar_chunks(consulta vector(512), k int, territorio text default null)`
     → `id, documento_id, seccion, texto, entidades, relacionados, similitud`
   - `buscar_lecciones(consulta vector(512), k int, agente_id text default null)`
     → `id, datos jsonb, similitud`
   Tabla `chunks`: `id, documento_id, indice, seccion, texto, entidades text[],
   relacionados text[], embedding vector(512), datos jsonb`. Tabla `documentos`:
   `id, titulo, nombre_archivo, ambito, territorio, subido_en, tamano_bytes,
   num_chunks, estado`. Tabla `lecciones`: `id, ejecucion_id, agente_id, datos
   jsonb, embedding vector(512)`. **512, no 384**: la API de HelmCode prohíbe
   384 (solo 32/64/128/256/512/768/1024/1536/2048/4096).

5. **Repositorio**: uso por import dinámico tolerante `guardarInforme(informe)`,
   `listarInformes()`, `obtenerInforme(id)` y `listarEjecuciones()`. Si no
   existen, todo sigue funcionando con el estado en memoria y los ficheros de
   `data/`. Cuando los tengas, se enganchan solos.

### 2026-09-19 · C → E (sala de mando)

- `/informes` es mío y complementa tu `/auditoria`: yo listo y filtro las actas
  (tipo, incendio, agente, estado) con su huella; tú reconstruyes la cadena de
  una decisión. El botón "Descargar todos" usa `GET /api/auditoria/exportar` si
  existe y, si no, concatena las actas con `GET /api/informes/[id]?formato=md`.
- Para enseñar un acta desde tus tarjetas: `GET /api/informes/[id]` devuelve el
  `Informe` completo y `?formato=md` lo descarga con `Content-Disposition`.
- `GET /api/informes` acepta `incendioId`, `tipo`, `agenteId`, `decisionId` y
  `estadoDecision`, y devuelve los informes SIN el markdown (con `caracteres`).

### 2026-09-19 · J → K (extinción realista) · TRES COSAS MEDIDAS

1. **`riesgoPorEta` deja "bajo" a pueblos pegados al foco** (`lib/simulacion/propagacion.ts`).
   Medido hoy: foco en 39,79/−1,05, **Tuéjar a 2,9 km, 1.221 habitantes, camping + colegio +
   residencia** → `riesgo: "bajo"`, `etaFrenteMin: 2554` (42 h), porque con viento de 6 km/h
   y HR 95 % el frente avanza a 1,15 m/min. En la misma tanda, aldeas de 0 habitantes salían
   "inminente" por estar dentro del perímetro. **Es exactamente lo que Javi vio en el mapa**
   ("Tuéjar · Riesgo alto · Sin avisar" / "bajo") y lo que hacía que `proteccion_poblacion`
   no propusiera nada: filtraba por `riesgo >= medio`.
   He puesto un parche **en mi lado** (el agente entra también por proximidad sensible: ≤ 8 km
   con colectivos vulnerables o ≥ 500 hab), pero **la etiqueta que ve el usuario sigue mal**.
   Sugerencia concreta, tuya la decisión: `max(riesgoPorEta(...), riesgoPorDistancia(km))` y
   subir un escalón si `poblacion.vulnerables.length > 0`.

2. **`estadoAviso` no pasa a `"sin_respuesta"`** (`lib/agentes/ejecucion/ejecutor.ts`, caso
   `avisar_poblacion`/`confinar`/`evacuar`, ~línea 249). Si fallan la llamada **y** el SMS
   (hoy siempre: HappyRobot no tiene los `HAPPYROBOT_WORKFLOW_SLUG_*`), la población se queda
   en `sin_avisar`: la UI no distingue "no se intentó" de "se intentó y no hubo manera", y el
   planificador la vuelve a coger **en bucle**. El tipo `EstadoAviso` ya contempla
   `"sin_respuesta"`. La mitad del planificador ya está hecha por mí: `proteccion_poblacion`
   no reintenta un `sin_respuesta` salvo que el riesgo suba a `inminente`. Falta tu línea:
   `estadoAviso: algoFue ? nuevoEstadoAviso : "sin_respuesta"`.

3. **Velocidad de las unidades: correcta, no la toques sin medir.** Comprobado con 3 unidades
   en 30 s reales: 66,6 km/h de mundo = media real de la ruta OSRM (53,3) × 1,25, y las otras
   dos recortadas al nominal de 70. Si cambias el regreso a base, mantén el mismo criterio.

### 2026-09-19 · J → D y orquestadora (política y portavoz)

1. **La política de fábrica no llegaba nunca al servidor** y por eso ni los avisos ni los
   comunicados salían solos. `nuevaEjecucion` hacía `nuevo.politica = anterior.politica`, así
   que tocar `lib/dominio/politica-defecto.ts` no tenía ningún efecto sobre un proceso vivo, y
   un servidor con Supabase recupera para siempre la política guardada. Medido: el código ya
   decía `avisar_poblacion: autonoma/20` y `publicar_comunicado: autonoma/25`, pero el estado
   vivo seguía con `supervisada/45` en los dos. **Corregido por mí** en `lib/motor/orquestador.ts`:
   solo se arrastra la política si alguien la ha editado de verdad (`actualizadaPor !== "sistema"`).
   **Aviso para `:3000`**: ese proceso sigue con la política vieja en memoria y la persiste en
   Supabase. Antes de la demo, o se reinicia, o se hace `PUT /api/politica` con el `catalogo`
   que devuelve `GET /api/politica`. Tras el arreglo, verificado en `:3100`: el aviso a Tuéjar
   sale con **riesgo 20 y competencia `autonoma`**.

2. **El portavoz no publica nada tras el ataque inicial.** La política ya es correcta, pero
   `motivoParaComunicar` (en `lib/agentes/comunicacion/portavoz.ts`) exige poblaciones en
   riesgo alto/inminente, o `nivelGravedad >= 1`, o `areaHa > 20`. Un foco recién declarado
   tiene 1,3 ha y nivel 0, y por el punto 1 de la petición a K ninguna población llega a
   "alto". No lo he cambiado porque el criterio es defendible; hay que **decidirlo**: bajar el
   umbral de `areaHa`, o arreglar el riesgo por distancia (que lo desbloquea solo).

3. **Falta la tabla `tickets` en Supabase** (`GET /rest/v1/tickets` → 404 `PGRST205`). La
   acción `abrir_ticket` los crea, pero viven solo en memoria y no se auditan tras un reinicio.

4. **`SUPABASE_SERVICE_ROLE_KEY` está vacía en `.env.local`**: todo se escribe con
   `SUPABASE_ANON_KEY` porque `lib/db/cliente.ts` cae a ella. Funciona (13 ejecuciones, 229
   informes y 1.621 trazas guardadas), pero significa que la clave publicable escribe en la
   base. Antes de enseñarla al jurado: rellenar la clave de servicio o activar RLS.

### 2026-09-19 · L → C y J (capa de IA) · `permitirEnPausa` no llega a `completarTexto`

**Fallo L-3, medido en `:3100` y reproducible en 30 s.** `lib/ia/llm.ts:747` —
`completarTexto` construye la llamada así:

```ts
const crudo = await llamar({ papel, mensajes, maxTokens, temperatura, signal: p.signal });
```

y **no pasa `permitirEnPausa: p.permitirEnPausa`**, que sí pasa `completarJson`
(líneas 681 y 696). Como `llamar()` bloquea con
`mundoEnPausa() && !args[0]?.permitirEnPausa`, todo lo que use `completarTexto`
queda bloqueado en pausa **aunque esté marcado como permitido**.

Reproducción:

```bash
curl -XPOST :3100/api/reloj -H 'content-type: application/json' -d '{"pausado":true}'
curl -XPOST :3100/api/conocimiento/consultar -H 'content-type: application/json' \
  -d '{"pregunta":"¿Qué es un incendio de nivel 1?"}'
# → HTTP 503  {"error":"Mundo en pausa: no se hacen llamadas a la IA hasta reanudar", "explicados":[9 fragmentos]}
curl -XPOST :3100/api/reloj -H 'content-type: application/json' -d '{"pausado":false}'
# → mismo curl: HTTP 200 en 15,8 s, 11 fundamentos (mejor similitud 0,656) y respuesta completa
```

Afectados: `lib/conocimiento/consulta.ts:212` (`consultarProtocolo`, la ÚNICA
herramienta que el mando puede usar con el mundo parado — justo el momento en
que la va a usar) y `lib/agentes/informes/redactor.ts:767`. **Arreglo: una línea**
(`permitirEnPausa: p.permitirEnPausa` en `completarTexto`). De paso, el reintento
de reparación de `completarJson` (~línea 707) tampoco lo propaga.

Prueba que lo fija: `tests/integracion/00-escenario.test.ts` → `(d bis)`, marcada
`it.fails`. **Cuando lo arregléis se pondrá roja**: quitadle el `.fails` (o
avisadme) y listo.

### 2026-09-19 · L → D (análisis) · exportar `familiaCanal` del verificador

**Fallo L-1.** `lib/agentes/analisis/verificador.ts:22` — `familiaCanal` es una
función de módulo sin `export`. Implementa una de las reglas de negocio más
importantes del sistema ("una noticia no confirma otra noticia": `prensa` y
`rrss` son la misma familia; `camara`/`satelite`/`sensor` otra; `manual` otra;
llamada/sms/email/telegram/web son "ciudadano") y hoy **no se puede probar de
forma aislada**: haría falta montar un `ContextoAgente` entero con IA real.

Petición: `export function familiaCanal(...)`. Es aditivo y no cambia
comportamiento. La prueba ya está escrita en
`tests/unit/verificador.test.ts` (`describe.skip`, con el porqué); en cuanto se
exporte, se descomenta y entra en la batería determinista.

### 2026-09-19 · L → C (IA) · exportar `esquemaJson`/`endurecer` (opcional)

**Fallo L-2, menor.** `lib/ia/llm.ts:283` (`endurecer`) y `:311` (`esquemaJson`)
tampoco se exportan, así que el endurecimiento del JSON Schema
(`additionalProperties: false`, `required` completo…) solo se valida de rebote,
cuando una llamada real a HelmCode con `strict: true` no da error. Si los
exportáis, escribo las unitarias deterministas (zod → JSON Schema endurecido)
en 10 minutos. No es bloqueante: es que hoy un cambio ahí solo se detecta en
producción.

### 2026-09-19 · L → todos · tres cosas del entorno de pruebas

1. **`tsconfig.json` excluye `tests/`** (lo hizo la orquestadora para que
   `next build` no se rompiera). El type-check de las pruebas va aparte:
   `npm run test:tipos` (`tests/tsconfig.json`). Si tocáis contratos de
   `lib/dominio/tipos.ts`, ejecutadlo: mis fábricas de prueba
   (`tests/unit/ayudas/dominio.ts`) construyen `Incendio`, `Decision`, `Unidad`
   y `Poblacion` completos y se enteran enseguida.
2. **Las pruebas de integración crean una ejecución nueva en `:3100`**
   (`POST /api/ejecucion {accion:"nueva"}`) y trabajan sobre un foco en
   39,79/−1,05 (Tuéjar). Si estáis mirando la sala en ese momento, veréis
   "Pruebas L · escenario". **Siempre devuelven el mundo en marcha y sin viento
   forzado** (`afterAll` + `try/finally`), y la política se restaura tal cual
   estaba. No tocan Supabase.
3. **Dependencias nuevas de desarrollo**: `vitest` 5.0.1, `vite` (peer de
   vitest) y `playwright` (+ Chromium). Instaladas con `--legacy-peer-deps`
   porque vitest 5 declara `peerOptional @types/node ^22 || >=24` y el árbol
   resolvía 26.6.2. No entran en el build de producción.

### 2026-09-19 · L → J y A (núcleo) · pausar ESCALA para siempre lo que esté en vuelo

**Fallo L-5, medido en `:3100` durante la batería de integración.** Con el mundo
en pausa, una decisión recién propuesta se queda **`escalada` a un humano de
forma permanente** porque el supervisor no puede evaluarla:

```
=== Aviso preventivo al Ayuntamiento de Higueruelas | riesgo 20 | competencia autonoma
  evaluacion: null   (puntuacion None, aprueba None, motivoEscalado None)
  historial: propuesta (proteccion_poblacion, "Propuesta por el agente")
           → escalada  (supervisor,           "El supervisor no ha podido evaluar
                                               (Mundo en pausa: no se hacen llamadas…)")
```

Es decir: **pulsar "Parar" convierte en trabajo para una persona una decisión
que la política marca como autónoma** (riesgo 20, `avisar_poblacion` →
`autonoma/20`), y al reanudar **no se reintenta**: se queda `escalada` con
`evaluacion: null`, sin puntuación y sin motivo que enseñarle al mando. En la
demo esto se ve: aparecen decisiones en "Requiere tu decisión" que nadie ha
escalado por criterio, sino por haber pausado.

Sugerencia (vuestra la decisión): que un `AbortError` de pausa **no** escale;
que la decisión se quede en `propuesta` y el supervisor la vuelva a coger al
reanudar (igual que J hizo en el bug J-11 con `esAborto(e)` para no pintar el
servicio en rojo). Es el mismo patrón y el mismo origen.

No hay prueba que lo fije todavía: es un efecto de carrera y prefiero no meter
una prueba que dependa de que el supervisor esté justo en ese punto. Queda
documentado en `docs/PRUEBAS.md` §4.

### 2026-09-19 · L → J y A (núcleo y supervisión) · pausar 3 veces DESACTIVA el vigía de cámaras y el asesor legal

**Fallo L-6, y es el más gordo que he encontrado.** Cada `AbortError` de "Mundo
en pausa" cuenta como **error del agente**, y a los 5 el supervisor lo **pausa de
forma permanente**. Registro real de `:3100` durante la batería de pruebas, que
pausa el mundo tres veces (unos 20 s cada vez):

```
05:12:06 agente   El asesor legal no ha podido revisar "…": Mundo en pausa: no se hacen llamadas a la IA
05:12:36 sistema  No se pudo analizar la cámara A-66 PK 614,9: Mundo en pausa: no se hacen llamadas a la IA
05:12:36 sistema  No se pudo analizar la cámara EX-A1 PK 51,3: Mundo en pausa: no se hacen llamadas a la IA
05:18:55 agente   Pausado Asesor legal por errores repetidos (5): requiere revisión humana.
05:20:30 agente   Pausado Vigía de cámaras por errores repetidos (5): requiere revisión humana.
```

Traducido a la demo: **si Javi pulsa "Parar" tres veces, se queda sin vigía de
cámaras y sin asesor legal**, y hay que reactivarlos a mano en `/agentes/<id>`.
El vigía es de lo más vistoso que hay, y el asesor legal es el que pone los
fundamentos a cada decisión: sin él, las decisiones salen sin normativa citada.

Es **la misma familia que el bug J-11** (donde ya aplicaste `esAborto(e)` para
que un aborto no pintara el servicio en rojo): falta aplicar el mismo criterio al
**contador de errores del agente**. Un aborto provocado por el propio mando no es
una avería del agente. Junto con L-5 (pausar escala decisiones autónomas para
siempre), son los dos efectos colaterales de "Parar" que quedan.

**Y hay una segunda mitad**: **"reanudar" no recupera al agente**, porque el
contador de errores no se reinicia. Medido: tras
`POST /api/agentes/asesor_legal {accion:"reanudar"}` vuelve a `observando` pero
conserva `contadores.errores: 6`, y al primer error siguiente el supervisor lo
vuelve a pausar (pasó a los pocos minutos: *"Pausado Asesor legal por errores
repetidos (6)"*). Es decir: **el botón de reanudar de la sala no arregla nada de
forma duradera**. Sugerencia: poner el contador a cero cuando reanuda un humano.

**Nota aparte, medida en el mismo sitio y que os afecta a los dos**: en este
proceso `asesor_legal` y `vigia_camaras` tienen `tiempoMaximoSeg: undefined` y el
error que los tumba es *"Tiempo máximo agotado (30 s)"*, cuando J dejó
`asesor_legal` en 120 s (`docs/CALIDAD.md` §1.8). Es lo mismo que ya avisasteis J
y K: el registro de agentes se capturó al arrancar el proceso y la recarga en
caliente no lo renueva. **Conviene reiniciar `:3100` antes de la demo** para que
corran de verdad todos vuestros parches (los de J sobre la pausa y los tiempos
máximos, y el `propagacion` nuevo de K).

**Lo he dejado reanudado en el servidor** (`POST /api/agentes/<id>
{accion:"reanudar"}`, los dos a `observando`, mundo en marcha), pero con los
contadores en 5 y 6: se volverán a pausar al primer error.

### 2026-09-19 · L → orquestadora y C (portavoz) · el comunicado tarda entre 21 s y más de 5 min

**No es un fallo, es variabilidad, y conviene decidirla antes de la demo.** Tres
tandas medidas sobre el mismo escenario (foco manual en 39,79/−1,05, ejecución
limpia cada vez):

| Tanda | Comunicado publicado |
|---|---|
| 1 | **no** dentro de los 180 s |
| 2 | **+5 min 24 s** desde el ataque inicial (`04:33:20 → 04:38:44`) |
| 3 | **+21 s** |

Causa localizada: al portavoz no lo despierta el ataque inicial sino el primer
`poblacion_avisada`, y eso depende de cuándo `proteccion_poblacion` consiga
proponer **y ejecutar** un aviso (medido entre 32 s y 90 s). Además
`motivoParaComunicar` exige riesgo alto/inminente, `nivelGravedad ≥ 1` o
`areaHa > 20`, y un foco recién declarado en bosque húmedo tiene 1,4 ha y nivel 0.
J lo dio por "no publicado" con ventana corta (`docs/CALIDAD.md` §1.6.bis); con
ventana larga **sí sale siempre**.

**Qué significa para la demo**: `/publico` puede estar vacío los primeros minutos,
que son justo los que se enseñan. Tres palancas, vuestra la decisión: bajar el
umbral de `areaHa`, bajar la cadencia del portavoz (300 s), o arreglar el riesgo
de las poblaciones (la petición de J a K sobre `riesgoPorEta`). **No lo he tocado.**

La prueba `(g)` de `tests/integracion/00-escenario.test.ts` usa 7 minutos de
presupuesto a propósito: valida el circuito portavoz → `/api/comunicados` →
`/publico`, no la latencia.

**Aviso para H y G**: `components/publico/PortalCiudadano.tsx` es de cliente, así
que el HTML que sirve el servidor para `/publico` trae "Cargando…" y una lista
vacía. Cualquier prueba (o comprobación manual con `curl`) que busque el título de
un comunicado en el HTML del servidor va a fallar aunque todo funcione. Lo he
movido a la batería de UI, con navegador.

### 2026-09-19 · L → J y D (supervisión y protección de población) · el aviso tarda entre 32 s y > 2 min

Cuatro tandas medidas del primer `avisar_poblacion` intentado desde que se declara
el foco: **82,7 s · 90,8 s · 32,3 s · > 120 s**.

La cuarta es la que merece la pena contar, porque **el sistema se comportó bien**:
`proteccion_poblacion` propuso "Aviso preventivo a Higueruelas por incendio activo
a 16 km" y "Aviso preventivo a Torrijas (27 km)", y el **supervisor las escaló las
dos** con motivos razonados ("*revisar por qué se avisa a Torrijas, fuera de la
lista del ciclo*"). El aviso que sí procedía —Tuéjar, a 2,9 km— salió solo, en
`autonoma`, y falló con el motivo correcto (*"llamada: Falta DESTINO_DEMO"*).

O sea: la supervisión de calidad funciona y **cuesta tiempo**. Mi prueba `(f)`
usa ya 4 minutos de presupuesto. Lo dejo anotado por si para la demo interesa que
`proteccion_poblacion` no proponga avisos a pueblos a 16 y 27 km (que es lo que el
supervisor le está afeando): son ciclos de razonamiento gastados y decisiones que
acaban en la bandeja del humano sin necesidad.

## Entregas

### M · Estabilización del backend y de la batería de integración (2026-09-19 08:50)

**Hecho.** Diagnosticada la causa raíz de los cinco fallos de la pasada de las 08:02: `overpass-api.de`
rechaza la conexión desde esta red (`connection refused` en sus dos IP), así que ningún foco recibía
unidades ni poblaciones y caían en cascada (a), (b), (e), (f) y (g). Corregido en
`lib/fuentes/overpass.ts` (espejos nuevos con `maps.mail.ru` como respaldo sano, validación del
`timestamp_osm_base` para descartar espejos con la base vacía, timeout 25 s, dos vueltas con
retroceso, tres consultas separadas —pueblos / medios / combustible— con caché por celda),
`lib/motor/enriquecer.ts` (los seis pasos en paralelo, evento `incendio_actualizado` con
`datos.fase = "medios"` en cuanto hay unidades y otro `fase = "completo"` al terminar, reintento con
retroceso si Overpass falla), `lib/ia/llm.ts` (dos colas: la cadena de mando pasa delante de la
percepción), `lib/agentes/planificacion/coordinador.ts` (tras `viento_gira` deja huella aunque
concluya "sin cambios"), `lib/agentes/comunicacion/portavoz.ts` (comunicado y traducciones en dos
llamadas, las traducciones en segundo plano con el papel rápido; reescritura única cuando el
supervisor escala; menciona el "ejercicio del mando" cuando el viento está forzado) y las pruebas
(`esperarEntornoCargado` en `tests/integracion/ayudas.ts`, usado por (f); (e) acepta decisión nueva
o revisión motivada). `npx tsc --noEmit`, `npm run test:unit` (157) y `npm run test:tipos`, limpios.
Medido tras el cambio en :3100: municipio 4 s, poblaciones 12 s, unidades 21 s, ataque inicial
ejecutándose a los 25 s (antes: nada de eso llegaba nunca).

**Pendiente.** NO he podido completar las tres pasadas seguidas de `npm run test:integracion` (cada
una son 8-15 min y se ha cortado la sesión): queda ejecutarlas y volcar la tabla real en
docs/PRUEBAS.md §3, y revisar si con el entorno ya cargado el presupuesto de (g) (420 s) y el tope
de (d ter) (3 llamadas en pausa, ahora que el proceso se ha reiniciado debería ser 0) se pueden
ajustar a la baja.

(añadir aquí al terminar)

### 2026-09-19 · A · Núcleo — entregado y probado de extremo a extremo

**Qué hay**

- `lib/motor/reloj.ts` — tiempo de mundo. `actualizarReloj`, `establecerFactor`,
  `pausar`, `reanudar`, `avanzarMinutos`, `minutosMundoEntre`, `reiniciarAncla`.
  Acumula minutos de mundo tick a tick (en pausa no acumula), así que cambiar el
  factor o saltar "+1 h" no reescribe el pasado. El acumulador vive en
  `globalThis` (con un WeakMap por módulo, la recarga en caliente de Next creaba
  dos relojes que se pisaban y los saltos se perdían).
- `lib/motor/orquestador.ts` — sustituye al stub **manteniendo sus firmas**.
  Bucle `setInterval(TICK_MS)`, agentes por cadencia o por evento
  (`despiertaCon`), exclusión mutua por agente, `Promise.race` + `AbortController`
  con 90 s (razonamiento) / 30 s (resto), inyección de lecciones antes de cada
  ciclo, y actualización de `EstadoAgenteApp` (estado, tareaActual, contadores,
  ultimoError). Cada ciclo va envuelto en `ejecutarConTraza` con
  `anotarTraza({entradas})` antes y `{resumen, decisiones, observaciones,
  eventos}` después; el timeout rechaza con un error `AbortError` para que la
  traza se cierre como "cancelado". Extras: `emitir`, `recargarAgentes`,
  `pararOrquestador`, `nuevaEjecucion`, `cerrarEjecucion`, `consolidarMetricas`,
  `contextoParaSistema`, `estadoDelNucleo`.
- **Pipeline de decisión**: `procesarDecisionPropuesta` (normaliza ids → guarda →
  `buscarFundamentos(k:4)` → `evaluarCompetencia` → `evaluarDecision` del
  supervisor → enrutado). `controlHumano` sube cualquier decisión autónoma a
  supervisada. Sin proveedor de IA, el supervisor falla → evento de aviso
  "Supervisor sin IA: la decisión pasa a un humano" y la decisión se escala.
  `aprobarDecision` / `denegarDecision` (comentario obligatorio) / caducidad por
  `politica.minutosCaducidad` en minutos de mundo.
- `lib/motor/enriquecer.ts` — `enriquecerIncendio` + geometría reutilizable
  (`distanciaKm`, `rumboGrados`, `rumboTexto`, `circulo`, `areaHaCirculo`,
  `riesgoPorDistancia`). Cinco pasos independientes, cada uno con
  `marcarServicio`: Nominatim → Overpass (poblaciones, unidades, hospitales,
  vulnerables, combustible) → elevación → meteo + peligro → cámaras < 25 km.
  Reutiliza unidades/poblaciones ya comprometidas con otro foco vivo.
- `lib/motor/persistencia.ts` — suscripción al estado, debounce 2 s, huella JSON
  por id, upserts en lote. Si Supabase falla: `marcarServicio("Supabase", false)`,
  se olvidan las huellas y se reintenta entero. Al arrancar recupera la ejecución
  activa (**probado**: sobrevive a un reinicio real del proceso).
- `lib/db/schema.sql` (aplicado ya en Supabase por la sesión orquestadora),
  `lib/db/repositorio.ts` (`guardarEntidad`, `guardarLote`, `guardarEjecucion`,
  `cargarEjecucionActiva`, `listarEjecuciones`, `guardarPolitica`, `volcarTodo`).
- `lib/agentes/registro.ts` — junta los ocho índices, sin duplicados, y crea la
  ficha de cada agente conservando pausado/controlHumano/contadores.
- `lib/motor/entorno.ts` — `urlPublica()` / `origenUrlPublica()`:
  `data/url-publica.txt` (túnel) manda sobre `PUBLIC_BASE_URL`.
- `lib/motor/respuestas.ts` — helpers de respuesta JSON y validación zod para las
  rutas del núcleo (NUEVO archivo mío, dentro de lib/motor).
- **Rutas** (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, errores `{error}`
  con código HTTP correcto, validación zod): `GET /api/estado`,
  `GET /api/estado/stream` (SSE), `GET /api/eventos`, `GET|POST /api/reloj`,
  `GET|POST /api/ejecucion`, `GET|POST /api/focos`, `GET|PATCH /api/focos/[id]`,
  `GET|POST /api/agentes/[id]`, `GET /api/salud`.
- `instrumentation.ts`, `next.config.ts` (`serverExternalPackages`),
  `railway.json`, `docs/DESPLIEGUE.md`, `scripts/comprobar.mjs`.

**Auditoría total (requisito de Javi, 2026-09-19)**

- `lib/motor/actas.ts` — toda decisión y toda acción deja acta. En CADA cambio
  de estado se llama a `redactarInforme(d, ctx, {tipo:"decision"})` y tras CADA
  acción a `{tipo:"accion", accionId}`. Si C no puede redactar (sin IA, error),
  el núcleo escribe un **acta determinista** con los mismos datos
  (`conNarrativaIA: false`): sin IA se pierde la prosa, nunca la trazabilidad.
  Cada acta va sellada con `huella` SHA-256, `trazaId`, `agenteId` y
  `estadoDecision`.
- `cambiarEstadoDecision(...)` en el orquestador: TODO cambio de estado pasa por
  ahí y añade `{en, enMundo, estado, quien, motivo}` a `Decision.historial`
  (propuesta → pendiente_humano/escalada/aprobada → ejecutando →
  ejecutada/fallida, denegada, caducada).
- Cada decisión nace sellada con `trazaId` = traza del ciclo que la pensó
  (`trazaActual()`, añadida a `lib/motor/traza.ts` con autorización). Cada acción
  se sella con `autorizadaPor` y `ordenadaEn` antes de ejecutarse.
- `lib/motor/auditoria.ts` + `GET /api/auditoria` (cadena completa por
  `decisionId`, o lista cronológica paginada por `incendioId`/`desde`/`hasta`) y
  `GET /api/auditoria/exportar?decisionId=` (expediente Markdown descargable).
  La traza se busca en memoria y, si ya rotó (solo se guardan 20 por agente), en
  Supabase.
- Persistencia: tabla `trazas` nueva en `schema.sql` (**migración pendiente**,
  ver Peticiones) + cada traza se guarda al cerrarse, una sola vez. `/api/salud`
  añade el bloque `auditoria` con actas por tipo, trazas y recuentos persistidos
  (con tope de 1,5 s para no colgar el healthcheck de Railway de la base de datos).

**Contrato: campos opcionales añadidos** (ver también "Peticiones")

- `Snapshot.informes?: Informe[]` y `Estado.informes: Map<string, Informe>`.
- `Poblacion.telefonoEsDemo?: boolean`.

**Cómo se prueba**

```bash
npx tsc --noEmit                      # limpio en lib/motor, lib/db, app/api del núcleo
npm run dev                           # ojo: Next 16 solo admite UN next dev por directorio
node scripts/comprobar.mjs http://localhost:3000
curl -X POST localhost:3000/api/focos -H 'content-type: application/json' \
     -d '{"lat":40.66,"lon":-4.70,"nombre":"Prueba Ávila"}'
curl -N localhost:3000/api/estado/stream      # event: estado + latido cada 15 s
```

Probado el 2026-09-19 contra las fuentes reales: Nominatim (Ávila, Castilla y
León), Overpass (161 poblaciones, 3 parques → 35 unidades, 60 hospitales),
Open-Meteo (1086 m, 13 °C, viento 4 km/h SSO), cámaras DGT (2305 listadas, 12
vigiladas a < 25 km), Supabase escribiendo lotes y recuperando la ejecución tras
reiniciar el proceso. Reloj: pausa congela el mundo, ×N y "+60 min" se conservan.

**Qué falta / avisos**

- `poblacion.telefono` sale vacío porque `DESTINO_DEMO` está sin rellenar en
  `.env.local`: en cuanto tenga valor, las poblaciones sin teléfono en OSM lo
  reciben con `telefonoEsDemo: true`. Nada se inventa.
- `cerrarIncendio` devuelve las unidades a base y las deja `disponible` de
  inmediato (el paso por "regreso" es instantáneo). Si D quiere un regreso real
  por carretera, que lo lleve el despachador.
- El núcleo persiste incendios, unidades, poblaciones, observaciones, decisiones,
  informes, comunicados, eventos y análisis de cámaras. `clusters`, `hospitales`
  y `focosSatelite` viven solo en memoria (no hay tabla en el esquema).
- `decisionesAprobadas` cuenta también las autónomas (además de
  `decisionesAutonomas`), que es lo que se quiere para la comparativa.
- El bucle no ejecuta el catálogo de decisiones si los índices de agentes están
  vacíos: eso lo llenan B, C y D. Con 16 agentes registrados, funciona.
- **Peso del Snapshot**: con las actas ya arregladas (extracto de 400 car) el
  bloque de informes pasó de 2,3 MB a 4 kB. Lo siguiente que más pesa son
  `poblaciones` y `zonasPeligro`: con varios focos activos el Snapshot ronda los
  2 MB y viaja entero por SSE. Si la sala va lenta, ese es el sitio a mirar
  (es de B/D, ya avisado).

### 2026-09-19 · B · Percepción y fuentes — entregado y probado contra las fuentes reales

**Qué hay**

- `lib/fuentes/geo.ts` — `haversine`, `distanciaM`, `rumbo`, `gradosATexto`,
  `destino`, `diferenciaAngular`, `interpolarAngulo`, `bbox`, `claveRedondeada`.
- `lib/fuentes/openMeteo.ts` — `meteoActual`, `previsionHoraria` (96 h: 1 día
  pasado + 3 de previsión, `Europe/Madrid`), `meteoEnHora` (interpolación lineal
  y **circular** para la dirección), `precipitacionAcumulada`, `elevacion`,
  `elevaciones`, `rejillaViento(centro, radioKm, n)` (n×n en una sola llamada),
  `meteoMultipunto`. Caché por punto redondeado.
- `lib/fuentes/peligro.ts` — `calcularPeligro(meteo, combustible?, lluvia24?)`
  (FWI simplificado 0..100, fórmula documentada en la cabecera del archivo),
  `regla30_30_30`, `nivelDe`, `factorCombustible`.
- `lib/fuentes/overpass.ts` — `entornoIncendio(centro, radioKm)`: pueblos con
  `population` y teléfono del ayuntamiento cercano, bomberos, policía/guardia
  civil, hospitales y centros de salud, vulnerables (colegios, residencias,
  campings), aguas y `combustible` por **suma de áreas** de los polígonos OSM en
  5 km. Dos consultas en serie, overpass-api.de con respaldo en kumi.systems.
- `lib/fuentes/osrm.ts` — `ruta`, `tiemposDesde` (matriz), `puntoEnRuta`,
  `avanzarPorRuta`. `lib/fuentes/nominatim.ts` — `geocodificar`, `municipioDe`
  con cola de 1 req/s.
- `lib/fuentes/firms.ts` — `focosEspana()`, `agruparFocos()`, `firmsDisponible()`.
- `lib/fuentes/dgtCamaras.ts` — `listarCamaras()` (**fusiona DGT + Madrid**),
  `listarCamarasDgt`, `listarTodasLasCamaras`, `camaraPorId`, `imagenCamara`
  (DGT, Madrid y móvil), `camarasCercanas`, `decodificarDgt`.
  `lib/fuentes/camarasMadrid.ts` y `lib/fuentes/camarasMovil.ts`.
- `lib/fuentes/{exa,rss,bluesky,avisos,salud}.ts`.
- Agentes (`lib/agentes/percepcion/`): `vigia_camaras`, `satelite`,
  `prensa_redes`, `centralita` (+ `procesarEntrada`, `contextoParaVoz`),
  `meteorologo`. `index.ts` los exporta en `agentesPercepcion`.
- Rutas: `/api/camaras`, `/api/camaras/[id]/imagen`, `/api/camaras/[id]/vigilar`,
  `/api/camaras/movil`, `/api/fuentes/{salud,meteo,entorno,satelite,prensa,
  avisos,centralita,camaras/cercanas}`.
- Página **`/movil`** + `components/movil/VigilanciaMovil.tsx`: cámara trasera +
  GPS, fotograma JPEG ≤ 800 px cada 15 s, botón "Enviar ahora", "Dar parte"
  (POST `/api/ingesta/observacion`, de D) e indicador "Vigilancia activa ·
  último envío hace 12 s · analizado: sin humo (0,95)".
- `docs/FUENTES.md`: tabla de fuentes (URL, clave, refresco, límite, agente),
  latencias medidas, trampas resueltas y **cómo obtener FIRMS, AEMET y Exa**.

**Qué falta / limitaciones conocidas**

- **`FIRMS_MAP_KEY` sigue vacía** → el agente `satelite` está en rojo y lo dice
  en pantalla con el enlace para pedirla. No hay alternativa sin clave (EFFIS
  devuelve datos de 2019). Es la única pieza de percepción sin datos reales.
- `AEMET_API_KEY` vacía: se usan los avisos de Meteoalarm (16 vigentes ahora
  mismo). Si se pone la clave, `avisosAemet` hace el patrón de dos pasos pero
  **no descomprime el TAR.GZ**: avisa y sigue con Meteoalarm.
- Overpass a 30 km tarda 5–7 s la primera vez (luego 6 h de caché).
- Cataluña (SCT) y Euskadi no están integradas: sus imágenes son GIF animado de
  330 KB y coordenadas UTM ETRS89, y no aportan a la demo.

**Cómo probarlo**

```bash
PORT=3102 npx next dev
curl "localhost:3102/api/fuentes/salud" | jq
curl "localhost:3102/api/fuentes/meteo?lat=40.66&lon=-4.70&rejilla=5&radio=15" | jq
curl "localhost:3102/api/fuentes/entorno?lat=40.66&lon=-4.70&radio=30" | jq .resumen
curl "localhost:3102/api/fuentes/camaras/cercanas?lat=40.66&lon=-4.70&radio=30" | jq .total
curl -o cam.jpg "localhost:3102/api/camaras/dgt:168018/imagen"
curl -X POST "localhost:3102/api/fuentes/centralita" -H "Content-Type: application/json" \
  -d '{"canal":"llamada","texto":"Humo espeso en el monte junto a Navaluenga, Ávila"}' | jq
curl "localhost:3102/api/fuentes/centralita?lat=40.41&lon=-4.71" | jq
```

**Medido hoy contra las fuentes reales** (detalle en `docs/FUENTES.md`):
2.305 cámaras (1.948 DGT + 357 Madrid), la más cercana a Ávila a 5,79 km;
entorno de Ávila con 161 poblaciones y 3 parques de bomberos en 5–7 s; ruta OSRM
Ávila→Navaluenga 38,4 km/41 min en 206 ms; 16 avisos de Meteoalarm; visión
HelmCode qwen3.6 en 2,8–5,6 s por imagen (17 cámaras analizadas en la prueba,
todas correctamente "sin humo" con descripciones de escena nocturna).

---

## Entrega · Constructor E · Sala de mando (2026-09-19)

**Rutas y carpetas de las que soy dueño** (añadida `app/auditoria/**` a la tabla
de arriba por petición de la sesión orquestadora): `app/page.tsx`,
`app/layout.tsx`, `app/globals.css`, `app/agentes/**`, `app/auditoria/**`,
`components/{mapa,sala,ui,marca}/**`, `lib/cliente/**`, `public/*`.

### 1. `components/ui` — listos para C y D

`import { Boton, Tarjeta, … } from "@/components/ui";`

| Componente | Props |
|---|---|
| `Boton` | `variante` `"primario"\|"secundario"\|"peligro"\|"fantasma"` (def. secundario) · `tamano` `"sm"\|"md"\|"lg"` (def. md, alturas 36/44/48 px) · `icono?: ReactNode` · `cargando?: boolean` · `ancho?: boolean` · resto de props de `<button>` |
| `Tarjeta` | `titulo?` · `subtitulo?` · `icono?` · `accion?` (derecha de la cabecera) · `tono` `"neutro"\|"peligro"\|"aviso"\|"exito"\|"info"` (barra lateral de color) · `className?` |
| `Insignia` | `tono` `"neutro"\|"peligro"\|"aviso"\|"exito"\|"info"\|"marca"\|"fuego"` · `punto?` · `pequena?` · `title?`. Además exporta `TEXTO_ESTADO_INCENDIO`, `TEXTO_PELIGRO`, `TEXTO_RIESGO`, `TEXTO_COMPETENCIA`, `TEXTO_ESTADO_UNIDAD`, `TEXTO_ESTADO_DECISION` y `tonoEstadoIncendio/tonoPeligro/tonoRiesgo/tonoCompetencia/tonoEstadoUnidad/tonoEstadoDecision/tonoPrioridad` |
| `Dialogo` | `abierto` · `onCerrar` · `titulo` · `descripcion?` · `pie?` · `ancho` `"sm"\|"md"\|"lg"`. Foco atrapado, Esc, `aria-modal`, devuelve el foco al abridor, bloquea el scroll del cuerpo |
| `ProveedorToast` / `useToast` | Ya montado en `app/layout.tsx`. `useToast()` → `{ mostrar, exito, error, aviso, info }`; `(titulo, detalle?)`. Región `aria-live` |
| `Pestanas` + `PanelPestana` | `pestanas: {id, etiqueta, cuenta?, icono?, urgente?}[]` · `activa` · `onCambiar` · `idBase`. `PanelPestana`: `id` · `activa` · `idBase`. Flechas/Home/End del teclado |
| `Interruptor` | `activo` · `onCambiar` · `etiqueta` · `nota?` · `color?` (punto de leyenda) · `desactivado?` |
| `Desplegable` | `titulo` · `cuenta?` · `abiertoPorDefecto?` (`<details>` con cabecera ≥ 44 px) |
| `Tooltip` | `titulo?` · `contenido` · `lado` `"arriba"\|"abajo"\|"izquierda"\|"derecha"`. Se abre con ratón y con el tabulador, se cierra con Esc |
| `Vacio` | `icono?` · `titulo` · `guia?` · `accion?` |

`components/marca`: `Logo({tamano, className})`, `Marca({organismo})`,
`SelectorTema({compacto})` (sistema/claro/oscuro, persiste en `localStorage`).

`app/globals.css` define los tokens (`--panel`, `--brand`, `--danger`,
`--riesgo-*`, `--fuego`…) en `:root`, en `@media (prefers-color-scheme: dark)`
(salvo `[data-theme="light"]`) y en `[data-theme="dark"]`, expuestos a Tailwind 4
por `@theme inline` (`bg-panel`, `text-muted`, `border-danger/45`…). Utilidades:
`.tabular`, `.scroll-fino`, `.solo-lectores`, `.latido`. `app/layout.tsx` aplica
el tema guardado antes del primer pintado (sin fogonazo), `lang="es"`, título
"Atalaya · Sala de mando".

### 2. `lib/cliente`

- `useEstado()` → `{ snapshot, conectado, ultimaVersion, error, cargando, refrescar }`.
  Fetch inicial de `/api/estado` + SSE (`event: estado` y `event: latido`),
  reconexión con retroceso 1 s→30 s, vigilante de silencio (45 s) y polling de
  respaldo cada 5 s. También `useAhora(ms)`.
- `api.ts`: `obtenerEstado`, `obtenerSalud`, `ajustarReloj`, `ejecucion`,
  `declararFoco`, `actualizarFoco`, `cerrarFoco`, `aprobarDecision`,
  `denegarDecision`, `decisionManual`, `accionAgente`, `ordenarUnidad`,
  `avisarPoblacion`, `listarCamaras`, `vigilarCamara`, `urlImagenCamara`,
  `obtenerPolitica`, `guardarPolitica`, `listarInformes`, `obtenerAuditoria`,
  `urlExportarAuditoria`. Errores como `ErrorApi` + `mensajeDeError(e)` (frase en
  español lista para un toast).
- `formato.ts`: `hora`, `horaSegundos`, `fechaHora`, `horaMundo(iso, factor)` →
  "14:32 (×12)", `haceCuanto` ("hace 2 min"), `duracion`, `minutos`, `numero`,
  `hectareas`, `distancia`, `confianza`, `rumboTexto`, `viento`, `rumboFrase`,
  `recortar`…
- `useTema.ts`: `{ tema, oscuro, cambiarTema }`.

### 3. Mapa (`components/mapa`)

`<Mapa />` (carga dinámica `ssr:false`). Props: `snapshot`,
`incendioSeleccionado`, `onSeleccionarIncendio`, `modoDeclarar`, `onClicMapa`,
`onAvisarPoblacion`, `onVigilarCamara`, `centrarEn {lat, lon, sello}`.
Capas conmutables y persistidas en `localStorage`: focos (perímetro relleno por
estado), predicción +1/+3/+6 h (discontinuas con opacidad decreciente),
unidades (divIcon lucide por tipo, ruta OSRM y movimiento interpolado entre
snapshots), pueblos (círculo por riesgo, etiqueta permanente si alto/inminente,
ficha con "Avisar ahora"), hospitales, cámaras (popup con la imagen refrescada
cada `intervaloSeg`, veredicto "Sin humo · hace 12 s · 0,91", vigilar/dejar de
vigilar, anillo si vigilada; las de `fuente:"Movil"` con icono de teléfono,
nombre y anillo en vivo), viento (rejilla 5×5 de ~20 km calculada en el cliente
con `incendio.meteo`, más las flechas y el punto de `zonasPeligro` si vienen),
satélite (radio ∝ FRP) y avisos meteo. Encuadre: España al inicio, a los focos
cuando aparece el primero, botón "Ver todo", y no roba el mapa si el usuario lo
ha movido en los últimos 20 s. Leyenda plegable abajo a la izquierda.

### 4. Sala (`app/page.tsx` + `components/sala`)

- **Barra superior**: marca, reloj de mundo grande con factor, pausa, ×6/×12/×30
  y "+1 h"; ejecución con menú nueva/cerrar; puntos de salud por servicio con
  tooltip de detalle; "Declarar foco", "Vista de agentes", "Unir un móvil";
  enlaces a Conocimiento, Política, Informes, **Auditoría**, Aprendizaje y
  Portal ciudadano; selector de tema y "Atajos".
- **Panel derecho** (420 px, plegable; hoja inferior por debajo de 1024 px):
  (a) **Requiere tu decisión (N)** — pendientes y escaladas por prioridad y ETA,
  con "por qué" plegado, acciones en frases, alertas legales destacadas,
  evaluación del supervisor, evidencias y fundamentos plegados, Aprobar/Denegar
  grandes (denegar exige motivo, con sugerencias rápidas), estado optimista y
  toast; debajo "En ejecución" y "Ejecutadas recientes" con el resultado real de
  cada acción. (b) **Agentes** por categoría con punto de estado, tarea, última
  traza y pausar/asumir/forzar ciclo. (c) **Focos** con meteo, frente, peligro,
  pueblos, unidades, clúster, informes y acciones centrar / cambiar estado /
  añadir nota. (d) **Registro** filtrable por nivel e incendio. (e) **Lecciones**
  con peso, agente y la comparativa entre ejecuciones.
- **Tira inferior** con las métricas de la ejecución.
- **Atajos** (inactivos al escribir): `F` declarar foco · `A` aprobar la primera
  pendiente · `D` ir a denegar · `Espacio` pausar/reanudar · `G` vista de
  agentes · `Esc` salir del modo declarar · `?` ayuda.

### 5. Visores de agentes

- Pestaña "Agentes" y `/agentes/[id]`: última traza (motivo · duración ·
  resumen · nº de llamadas de IA) con pulso "pensando…" si está `en_curso`.
- `/agentes/[id]`: línea de tiempo con las ≤ 20 trazas, cada una expandible en
  **entradas → llamadas de IA** (proveedor, modelo, papel, latencia, tokens y
  prompt/respuesta en bloques monoespaciados plegables) **→ salida** (decisiones
  enlazadas, observaciones) **→ error**. Además decisiones propuestas y eventos.
- **Vista de agentes** a pantalla completa (botón en la barra o tecla `G`):
  rejilla por categoría con estado, tarea, última traza y controles.

### 6. Auditoría (`/auditoria`)

Línea de tiempo cronológica con decisiones, cambios de estado (quién y motivo),
acciones con su resultado real, actas, observaciones y eventos críticos;
filtros por foco, agente, tipo y fecha, y buscador de texto libre. Al elegir una
decisión, la cadena completa: tarjeta → historial → traza del ciclo → acciones
(cada una con su acta) → actas con huella SHA-256 → evidencias/fundamentos →
lecciones aplicadas, con "Exportar Markdown" (`/api/auditoria/exportar`) y
"Copiar enlace". Usa `GET /api/auditoria?decisionId=` y, si esa ruta aún no
responde, reconstruye la cadena con el Snapshot y lo avisa en pantalla. En la
sala, cada tarjeta de decisión lleva "Ver auditoría" y cada acción con
`informeId` abre su acta en un diálogo (Markdown con react-markdown), mostrando
`autorizadaPor` y `ordenadaEn`.

### Peticiones a otros constructores

- **A**: `GET /api/auditoria?decisionId=` con la forma
  `{decision, traza?, acciones: [{accion, informe?}], informes?, eventos?, evidencias?, fundamentos?, lecciones?}`
  (todo opcional salvo `decision`); `GET /api/auditoria/exportar?decisionId=`
  debe responder con `Content-Disposition: attachment` para que el botón
  descargue. `PATCH /api/focos/[id]` con `{estado}` y `{notas}`.
- **D**: `POST /api/poblaciones/[id]/avisar` acepta `{quien}`;
  `POST /api/decisiones/[id]/denegar` exige `{quien, comentario}`.
- **B**: `zonasPeligro` ya se lee con `meteo`/`peligro` anidados o planos; las
  cámaras `fuente:"Movil"` se pintan distintas.

### Qué falta / avisos

- Dependencia nueva: **`qrcode`** (+`@types/qrcode`) para el QR de "Unir un
  móvil"; se genera en el cliente, sin red.
- Las lecciones, las zonas de peligro y los informes se muestran si vienen; si
  no, hay estado vacío con guía, nunca una caja en blanco.
- `npx tsc --noEmit` limpio en mis rutas. Verificado en vivo contra el núcleo de
  A en `localhost:3105`: SSE entregando snapshots, 13 agentes con trazas y
  llamadas reales de HelmCode, 2 focos, 30 zonas de peligro y el mapa Leaflet
  pintando teselas y 426 marcadores en Chrome sin errores de consola.

**Cómo probarlo**

```bash
PORT=3105 npx next dev
# Sala: http://localhost:3105/  ·  Auditoría: /auditoria  ·  Agente: /agentes/supervisor
# F declara un foco (clic en el mapa) · G abre la vista de agentes · ? los atajos
```

### 2026-09-19 · D · Análisis, planificación, ejecución, política, HappyRobot y Telegram

**Qué hay**

*Modelo de propagación* — `lib/simulacion/geometria.ts` (área real por shoelace con
proyección local, punto dentro de polígono, remuestreo radial de un perímetro; reutiliza
`lib/fuentes/geo.ts` de B en vez de duplicarlo) y `lib/simulacion/propagacion.ts`: modelo
elíptico tipo Rothermel simplificado, documentado fórmula a fórmula en la cabecera del
archivo. `propagar(incendio, minutosMundo)` expande un perímetro de 36 vértices (cada uno
avanza según su ángulo respecto al rumbo del frente), recalcula `areaHa` y `frente`;
`predecir(incendio, poblaciones)` da perímetros a +1/+3/+6 h, poblaciones en trayectoria con
ETA y una frase de explicación. Extras exportados: `evaluarPoblaciones` (riesgo y ETA de
TODAS las poblaciones, lo usa el agente), `velocidadCabezaMmin`, `relacionLongitudAnchura`,
`perimetroInicial`. Estados: estabilizado ×0,2 · controlado/extinguido/descartado ×0. Sin
meteo **no propaga** y lo dice.

*Agentes de análisis* — `verificador` (dedupe < 2 km/< 30 min de mundo, confirma o agrava
focos a < 5 km subiendo confianza +0,15, declara foco nuevo con `declararFoco`, y consulta al
modelo rápido solo cuando las reglas no deciden), `propagacion` (determinista, cada 30 s:
perímetro, frente, predicción, riesgo y ETA por pueblo, evento `peligro_sube` crítico con
evidencia meteorológica) y `patrones` (agrupa focos a < 30 km o < 2 h, LLM con esquema
`{tipo, analisis, recomendacion}` → `Cluster`; serie sospechosa → decisión con `abrir_ticket`
al SEPRONA + email; convergencia → evento crítico y `despertar("coordinador")`).

*Agentes de planificación* — `coordinador` (cada 90 s: pide a OSRM el tiempo REAL por
carretera de las 6 candidatas más cercanas y se lo pasa al LLM; decide despliegues por
sector A/B/C/D, medios aéreos, elevación de nivel, reasignaciones entre focos y retiradas
por seguridad; replanifica con `sustituyeA` + `motivoReplanificacion` cuando llega
`viento_gira` o una denegación humana, y caduca lo pendiente; máximo 2 decisiones por foco y
ciclo), `proteccion_poblacion` (avisar / confinar / evacuar por orden de ETA, con guion de
llamada y SMS ≤ 300 caracteres escritos por el LLM, + acción `enviar_telegram`; el
razonamiento deja dicho que confinar y evacuar los ordena el Director del Plan) y
`asesor_legal` (RAG + modelo rápido con esquema `{conforme, alertas, fundamentosClave}`;
si no es conforme escribe `alertasLegales` y sube la competencia a `humano`). Exporta
también `revisarLegalidad(decision)` por si A la quiere en su pipeline.
Todos inyectan `ctx.lecciones` y el resumen de las decisiones previas del mismo incendio
(`lib/agentes/planificacion/comun.ts`: `decisionBase`, `bloqueLecciones`,
`bloqueDecisionesPrevias`, `hayEquivalenteViva`, `caducarPendientes`, `DOCTRINA_ESPANA`).

*Ejecución real* — `lib/agentes/ejecucion/ejecutor.ts` (`ejecutorAcciones`) ejecuta los 18
tipos de acción del catálogo, incluido `enviar_telegram`. Llamadas, SMS y correo por
HappyRobot; mensajes por la Bot API de Telegram;
despliegues, reasignaciones y retiradas por `despachador.asignar`/`retirar` con ruta OSRM
real; `publicar_comunicado`, `elevar_nivel`, `declarar_controlado` (→ `cerrarIncendio`),
`abrir_ticket`, `vigilar_camara` y `solicitar_confirmacion`. `despachador` es además un
agente que cada tick mueve las unidades por su polilínea
(`metros = velocidadKmh/60 × minutosMundo × 1000`, con `avanzarPorRuta` de B) y lanza
`unidad_llega`. `lib/agentes/ejecucion/orden-manual.ts` (`decisionManual`) es el camino de
las órdenes humanas: crea la `Decision` con `agenteId: "humano"`, ya aprobada, y la ejecuta.

*Comunicación* — `portavoz` (cada 300 s, máximo un comunicado por incendio cada 30 min de
mundo salvo cambio grave): redacta el comunicado oficial con traducciones a `en` + la lengua
cooficial que toque por comunidad (ca/gl/eu), lo deja en `pendiente_aprobacion` y propone
`publicar_comunicado`. Recoge también los borradores que deja el ejecutor al confinar o
evacuar.

*Integraciones* — `lib/happyrobot/cliente.ts` (API v2 EU: `happyrobotDisponible`, `llamar`,
`enviarSms`, `enviarEmail`, `verificarWebhook`, `listarWorkflows`, `estadoCanal`,
`motivoNoDisponible`, `urlLlamadaWeb`), `lib/happyrobot/webhooks.ts` (lectura tolerante de
nombres de campo) y `lib/telegram/cliente.ts` (`telegramDisponible`, `enviarMensaje`,
`enviarMensajeTrazado`, `enviarUbicacion`, `configurarWebhook`, `obtenerArchivo`,
`verificarWebhookTelegram`, `infoWebhook`).

*Rutas* — `GET /api/decisiones`, `POST /api/decisiones/[id]/aprobar` y `/denegar` (motivo
obligatorio), `POST /api/decisiones/manual`, `POST /api/unidades/[id]/ordenar` y `/retirar`,
`POST /api/poblaciones/[id]/avisar`, `GET|PUT /api/politica`, `POST /api/ingesta/observacion`,
`POST /api/webhooks/happyrobot/{llamada,sms,email,resultado}`, `POST /api/webhooks/telegram`,
`POST|GET /api/telegram/configurar`, `GET /api/happyrobot/contexto`, `GET /api/happyrobot/salud`,
`GET|POST /api/comunicados`.

*Páginas* — `/politica` (matriz por tipo de acción con los tres modos explicados en lenguaje
llano, riesgo mínimo por acción, umbrales globales, nivel de gravedad, caducidad, guardado con
confirmación y historial de la sesión), `/publico` (comunicados publicados con selector de
idioma, mapa Leaflet de focos activos, consejos y botón del 112 virtual si hay
`HAPPYROBOT_WEB_CALL_URL`) y `/parte` (formulario ciudadano con "usar mi ubicación").

*Auditoría* — cada acción deja en `accion.resultado.datos`: `peticion` (payload enviado SIN
el secreto del webhook), `respuesta` (cruda, 2 KB), `urlPeticion`, `destino` enmascarado
(`+346***22`), `duracionMs` y `duracionTotalMs`, y para despliegues
`ruta: {distanciaM, duracionS, puntos, salida, llegadaPrevista}`. Cada acción emite además
`accion_ejecutada` / `accion_fallida` con `{decisionId, accionId, tipo, referencia, resumen}`.
El webhook de resultado **añade** `transcripcion`, `contestada`, `confirmado` y el cuerpo
crudo a `datos` sin sustituir lo anterior, y encadena el resumen (`"… → contestada · confirmado"`).

**Qué falta (y no depende de mí)**

- **Los tres workflows de HappyRobot y el Web Call**: `HAPPYROBOT_WORKFLOW_SLUG_VOZ`,
  `_SMS`, `_EMAIL` y `HAPPYROBOT_WEB_CALL_URL`. Están todos descritos paso a paso, con los
  params del Webhook trigger y los prompts completos de los agentes de voz en español, en
  `docs/HAPPYROBOT.md`. Ojo: en la organización hay dos workflows (`fireops-smoke-test`,
  publicado en entorno **development**; `test`, sin publicar) y `HAPPYROBOT_ENVIRONMENT` debe
  coincidir con el entorno en el que se publique.
- **`DESTINO_DEMO`** (móvil E.164) y **`EMAIL_DEMO`**: sin ellos las acciones fallan con
  "Falta DESTINO_DEMO" / "Falta EMAIL_DEMO".
- **Telegram**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID_DEMO`, `TELEGRAM_WEBHOOK_SECRET`
  (receta en `docs/TELEGRAM.md`: @BotFather, `getUpdates` para el chat id, `setWebhook`).
- **`PUBLIC_BASE_URL` o el túnel** (`data/url-publica.txt`): sin URL pública no se manda
  `webhook_url` a HappyRobot y no hay retorno de resultados; queda anotado en el acta.

**Cómo se prueba**

```bash
# Modelo de propagación (sin servidor):
#   pasto + viento 35 km/h del SO, 60 min → 91,2 ha, frente al NE a 58,8 m/min;
#   pueblo a 3 km al NE → "inminente" (ETA 50 min desde el foco recién declarado);
#   giro de 90° (viento del SE) → el frente pasa al NO y la lista de pueblos en peligro
#   cambia de Navalacruz a Robledo; estabilizado 11,8 m/min, controlado 0.
npx tsc --noEmit    # limpio en todas mis rutas (y en todo el proyecto)

PORT=3104 npx next dev   # Next 16 solo deja UN dev server por carpeta: si ya hay uno, úsalo

curl -s localhost:3104/api/happyrobot/salud | jq          # workflows reales + qué falta
curl -s "localhost:3104/api/happyrobot/contexto?lat=40.4&lon=-4.9" | jq
curl -s -X POST localhost:3104/api/ingesta/observacion -H 'content-type: application/json' \
  -d '{"canal":"web","texto":"Humo denso saliendo del pinar","lat":40.42,"lon":-4.92}'
curl -s -X POST localhost:3104/api/webhooks/happyrobot/resultado -d '{}' \
  -H 'content-type: application/json' -o /dev/null -w '%{http_code}\n'   # → 401 sin secreto
# Ids OSM: hay que codificarlos
curl -s -X POST "localhost:3104/api/poblaciones/$(python3 -c 'import urllib.parse;print(urllib.parse.quote("osm:node/349239286",safe=""))')/avisar" \
  -H 'content-type: application/json' -d '{"quien":"Yo","canal":"sms"}'
```

Verificado hoy contra el servidor vivo: `/politica`, `/publico` y `/parte` responden 200; el
`PUT /api/politica` recalcula competencias sin ejecutar nada y rechaza umbrales incoherentes;
denegar sin motivo da 422 y denegar dos veces da 409; una orden manual a una unidad calculó
una ruta OSRM real de 674 km / 6.279 puntos y dejó la unidad `en_ruta`; el SMS a esa unidad
falló con "Falta HAPPYROBOT_WORKFLOW_SLUG_SMS" (visible, no simulado); aprobar una decisión
del portavoz publicó su comunicado en `/publico` (con traducción al gallego en el foco de
Quiroga); `GET /api/v2/workflows` contra la API real de HappyRobot devuelve 200.

**Campos opcionales añadidos al contrato**

- `lib/dominio/tipos.ts`: interfaz **`Ticket`** y `Snapshot.tickets?: Ticket[]`.
- `lib/motor/estado.ts`: `Estado.tickets = new Map<string, Ticket>()` y su volcado al snapshot.
- Nada más: no se ha renombrado ni borrado nada del contrato.

### 2026-09-19 · C · IA, conocimiento, supervisión, aprendizaje e informes

**Qué hay**

- **`lib/ia/llm.ts`** — HelmCode (por defecto), Groq y OpenAI por el SDK
  `openai`. Papeles `razonamiento` / `rapido` / `vision` con modelo por variable
  de entorno. `completarJson` usa `response_format: json_schema` con
  `strict: true` sobre el esquema de `z.toJSONSchema()` endurecido
  (`additionalProperties: false`, todo en `required`, fuera las palabras clave
  que el modo estricto rechaza); si el proveedor lo rechaza con 400, repite con
  `json_object` + el esquema en el system y valida con zod; si la validación
  falla, un reintento de reparación. Nunca combina `json_schema` con `tools` ni
  con `stream`. Además: 429 respetando `retry-after` una vez, reintento con el
  doble de tokens cuando un modelo razonador devuelve `content: null`,
  `estadisticasLLM()`, `proveedorDisponible()`, `modeloPara()`, `completarTexto`,
  `transcribirAudio` (Whisper, `language: "es"`) y `sintetizarVoz` (kokoro).
  Cada llamada (chat, visión, embeddings, audio) llama a `anotarLlamadaIA` de
  `lib/motor/traza.ts`.
- **`lib/ia/embeddings.ts`** — `incrustar`, `incrustarConsulta` ("query: ") e
  `incrustarPasajes` ("passage: "). Proveedores helmcode (`qwen3-embedding`,
  defecto), local (`Xenova/multilingual-e5-small` q8, sin clave), jina y openai.
  Dimensiones por `EMBEDDINGS_DIMENSIONES` (512). `precalentar()` para el primer
  arranque en Railway. Si falta la clave, cae al modelo local y lo marca como
  **degradado** (384 rellenadas con ceros: hay que reindexar).
- **`lib/conocimiento/`** — `ingesta.ts` (troceado por estructura legal:
  encabezados, `Artículo N`, `CAPÍTULO`, `ANEXO`, disposiciones y epígrafes tipo
  `3.4.1 …:` o `e) Confinamiento, evacuación y albergue:`; ~700 caracteres con
  100 de solape; entidades por regex + LLM rápido tolerante; relaciones `sigue`
  y `referencia`; embeddings por lotes), `almacen.ts` (memoria +
  `data/conocimiento/indice.json` + Supabase, tolerante a que la base no esté),
  `consulta.ts` (`buscarFundamentos`, `buscarFundamentosExplicados`,
  `consultarProtocolo` con expansión por grafo) y `grafo.ts` (`obtenerGrafo`,
  ≤ 400 nodos).
- **`lib/aprendizaje/memoria.ts`** — `leccionesPara`, `registrarLeccion`,
  `extraerLecciones`, `compararConAnterior` (sin LLM: son cifras),
  `listarLecciones`, `listarEjecuciones`, `registrarEjecucion`. Triple
  persistencia: memoria, `data/aprendizaje/*.json` y Supabase.
- **Agentes** — `supervisor` (rúbrica de 6 criterios + vigilancia de los demás
  agentes, con pausa a los 5 errores), `memoria` (lecciones y comparativa) y
  `redactor` (actas). Los tres índices rellenados.
- **`redactarInforme(decision, ctx, {tipo?, accionId?})`** — **acta determinista
  que nunca falla**: cabecera con ids, historial de estados con quién y por qué,
  situación con meteo y su URL, la decisión, la acción con proveedor, referencia
  externa y resultado real, evaluación del supervisor, fundamentos y evidencias
  con URL, lecciones aplicadas, decisiones previas y la traza del ciclo con cada
  llamada de IA. Después, si hay IA y responde en < 20 s, añade "Análisis" y
  marca `conNarrativaIA: true`; si no, se guarda igual con `false`. **Huella
  SHA-256** al pie y en `informe.huella`. Los parámetros de las acciones se
  escriben filtrando claves y tokens. No escribe en `estado.informes` (lo hace A)
  salvo en sus partes de situación cada 30 min de mundo.
- **API** — `GET/POST /api/conocimiento/documentos`,
  `DELETE /api/conocimiento/documentos/[id]`, `GET /api/conocimiento/grafo`
  (`?documentoId=`, `?chunkId=`), `POST /api/conocimiento/consultar`,
  `GET /api/aprendizaje`, `GET /api/informes` (filtros) y
  `GET /api/informes/[id]` (`?formato=md` descarga).
- **Pantallas** — `/conocimiento` (buscador "¿Cómo procedo si…?" con la
  respuesta y los fragmentos consultados con su similitud y su motivo —vector,
  referencia cruzada o fragmento siguiente—, subida por arrastrar y soltar con
  ámbito y territorio, lista de documentos y grafo SVG con layout de fuerzas
  propio y sin dependencias nuevas), `/informes` (filtros, visor markdown,
  huella, descarga individual y masiva) y `/aprendizaje` ("qué cambió esta vez",
  ejecuciones con métricas, lecciones con peso/vecesAplicada/origen/agente y uso
  real de los modelos). Todas enlazan a `/`.
- **Corpus `data/protocolos/`** — RD 893/2013 (Directriz básica de incendios
  forestales) y Ley 43/2003 de Montes (extracto del capítulo de incendios),
  ambos descargados hoy del **BOE en XML consolidado** y convertidos a markdown
  con una sección por artículo; más Ley 17/2015, RD 524/2023 y RD 393/2007. Cada
  fichero conserva su cabecera YAML con identificador, URL oficial y vigencia:
  toda cita es rastreable hasta el BOE.
- **`docs/CONOCIMIENTO.md`** — documentación completa, con las latencias
  medidas y las variables de entorno.

**Campos opcionales del contrato**

Ninguno añadido por mí: `Snapshot.informes`, `Informe.{tipo, accionId, agenteId,
trazaId, estadoDecision, conNarrativaIA, huella}`, `Decision.{trazaId, historial,
informeIds}` y `Accion.{autorizadaPor, ordenadaEn, informeId}` ya venían del
contrato ampliado por A y D, y los uso todos.

**Latencias medidas (2026-09-19, clave real de HelmCode)**

- LLM, `json_schema` strict, pregunta de supervisión: `qwen3.6` 5,1 s ·
  `glm5.2` 5,9 s · `glm5.3-flash` 6,1 s · `deepseek-v4-flash` 66 s ·
  `gemma4` timeout. Texto libre con deepseek 2,2 s. Visión con `qwen3.6` sobre
  data URL base64: 2,5 s.
- Embeddings `qwen3-embedding` a 512 dims: **31 ms por texto** en lotes de 16;
  169 ms una consulta suelta. Coseno pregunta↔pasaje relevante 0,615 frente a
  0,222 con uno irrelevante.
- Siembra del corpus completo: **682 fragmentos en 5 documentos**, ~12 min, de
  los cuales los embeddings son solo 22 s; el resto es la extracción de entidades
  con el LLM (`CONOCIMIENTO_MAX_LOTES_LLM=0` la desactiva y baja a < 1 min).

**Qué falta / avisos**

- **El modelo de razonamiento de `.env.local` hay que cambiarlo** (ver
  Peticiones). Es lo único que puede estropear la demo de mi parte.
- Las funciones RPC `buscar_chunks` / `buscar_lecciones` todavía no existen en
  Supabase: se usa el índice en memoria, que para 682 fragmentos va sobrado.
  Cuando A las cree, se usan solas.
- La extracción de entidades por LLM está limitada a 3 lotes por documento
  porque `qwen3.6` razona mucho y cada lote cuesta 10-17 s. La regex ya reconoce
  organismos, cargos, niveles y acciones, así que el grafo no se queda cojo.
- Verificado en vivo contra el núcleo de A en `localhost:3105`: el supervisor
  está puntuando decisiones reales y **cazando alucinaciones** ("el 'nivel 2 con
  UME y 14 medios aéreos' no aparece en el contexto", 35/100 en fundamentación),
  el agente de memoria ya escribió la comparativa entre ejecuciones y el redactor
  ya publicó partes de situación. `/conocimiento`, `/informes` y `/aprendizaje`
  responden 200.
- `npx tsc --noEmit` y `npx eslint` limpios en mis rutas.

**Cómo probarlo**

```bash
npx tsx scripts/probar-ia.ts                 # los 3 papeles + embeddings + RAG, con latencias
npx tsx scripts/sembrar-conocimiento.ts      # ingiere data/protocolos (--forzar reindexa)
npx tsx scripts/sembrar-conocimiento.ts --consulta "¿Quién puede ordenar la evacuación de un pueblo en un incendio de nivel 2?"
PORT=3103 npx next dev                       # /conocimiento · /informes · /aprendizaje

# Sin clave debe fallar de forma VISIBLE y no inventarse nada:
HELMCODE_API_KEY= npx tsx scripts/probar-ia.ts
```


### 2026-09-19 · Sesión orquestadora · Integración

Tras las entregas A-F: `next build` limpio; esquema y tabla `trazas` aplicados en Supabase; flujo
completo verificado con el servidor de producción (declarar foco → agentes → supervisor 86/100 →
aprobación humana → despliegues OSRM reales → 6 actas con huella → expediente exportado → lección
aprendida). Correcciones aplicadas sobre archivos de otros constructores (avisadas aquí):
- `lib/motor/enriquecer.ts`: las unidades ya no llevan `incendioId` al crearse (pool compartido).
- `lib/motor/orquestador.ts`: caducidad en minutos reales; `tiempoMaximoSeg` por agente; motivo real
  cuando el supervisor falla.
- `lib/agentes/planificacion/coordinador.ts`: ataque inicial obligatorio (+ respaldo determinista),
  regla de niveles, espera a `incendio_actualizado`, 2 focos por ciclo, 240 s, 4000 tokens.
- `lib/agentes/supervision/supervisor.ts`: 6000 tokens y señal propia de 120 s.
- `lib/agentes/informes/redactor.ts`: señal propia de 60 s, 5000 tokens; `INFORMES_TIMEOUT_NARRATIVA_MS=60000`.
- `lib/agentes/ejecucion/despachador.ts`: velocidad media real de OSRM ×1,25.
- `lib/ia/llm.ts`: cola de concurrencia `LLM_CONCURRENCIA` (4).
- `components/sala/DialogoInforme.tsx`: pide el acta completa a `/api/informes/[id]`.
- `app/api/decisiones/[id]/{aprobar,denegar}`: no duplica el prefijo `humano:`.
- `lib/motor/contratos.ts`: `Agente.tiempoMaximoSeg?`.


### 2026-09-19 · G · Visor de incidencia (canvas de agentes + hilo en vivo + expediente)

Petición literal de Javi: *"que haya un visor de canvas de cada incidencia: los flujos de
agentes que están interviniendo, y a su derecha que se pueda sacar un informe en vivo de
comunicaciones que se están haciendo y demás, como un hilo de noticias / timeline de ese
evento, y que quede en un sitio todo esto registrado para poder auditarlo"*.

**Qué hay ahora**

- **`/incidencias`** — índice de focos de la ejecución (activos primero), con estado, nivel,
  superficie, frente, pueblos por riesgo, medios, decisiones, acciones ejecutadas y cuántas
  fallaron, y lo que espera al mando. Cada tarjeta abre el visor o descarga su expediente.
- **`/incidencias/[id]`** — visor a dos columnas (apilado por debajo de 1024 px), en vivo por SSE
  (`useEstado`). Cabecera con la ficha del foco (municipio, estado, nivel, área, frente, peligro,
  meteo, hora de mundo) y cuatro botones: **Ver en el mapa** (`/?foco=id`), **Informe en vivo**,
  **Exportar expediente** y **Auditoría**. Si el foco fue absorbido por otro (contrato de fusión)
  aparece la banda "Este foco se unió a X" con su enlace; si absorbió a otros, se listan y su
  rastro entra en el hilo marcado con su procedencia.
- **Izquierda · `components/incidencia/LienzoFlujoAgentes.tsx`** — canvas 2D propio, sin librerías.
  Nodos: los agentes que han intervenido **de verdad en ese foco** (deducidos de eventos con
  `incendioId`+`agenteId`, `decisiones.agenteId` y trazas que citan sus decisiones/observaciones),
  más `Humano (mando)`, `Autónomo`, una unidad por medio asignado, `Poblaciones avisadas` y un nodo
  por canal externo usado (HappyRobot, Telegram, Email, Portal ciudadano, Ticket). Columnas:
  percepción → análisis → planificación → supervisión/mando → ejecución → destinos reales.
  Aristas = traspasos reales: observación → verificador → incendio; decisión: proponente →
  asesor legal → supervisor → humano/autónomo → ejecutor/despachador → unidad, población o canal,
  en verde/rojo según el resultado real de la acción. Pulsos solo para lo ocurrido en los últimos
  30 s, halo en el agente que está razonando sobre ese foco, contadores (ciclos, decisiones,
  acciones) en cada nodo. Clic en un nodo → panel con sus traspasos y su **última traza sobre esta
  incidencia** (motivo, qué vio, qué concluyó, llamadas de IA resumidas con pregunta y respuesta).
  Arrastre de nodos (ratón y dedo) con posiciones en `localStorage` (try/catch, y nunca se pierde
  un arrastre en curso aunque llegue un tick), rueda para zoom, arrastre del fondo para desplazar,
  botones Reordenar / Encuadrar / Acercar / Alejar. Colores leídos de los tokens del tema con
  `getComputedStyle` (se refrescan al cambiar de tema) y `prefers-reduced-motion` respetado.
- **Derecha · `components/incidencia/HiloIncidencia.tsx`** — hilo de noticias del foco, lo más
  reciente arriba, con "Ir al inicio". Fusiona observaciones, decisiones **y cada cambio de estado**
  (quién y por qué), acciones con su **resultado real** (canal, destino enmascarado, proveedor,
  referencia externa, transcripción/confirmación; en despliegues: unidad, distancia y duración OSRM
  y sector), movimientos y llegadas de unidades, avisos a poblaciones, comunicados, fusiones de
  focos y actas (enlace que abre el acta completa en `Dialogo` pidiendo `/api/informes/[id]`).
  Filtros Comunicaciones · Decisiones · Unidades · Percepción · Actas, buscador, hora de mundo y
  hora real en cada entrada y marca "Nuevo" durante 10 s.
- **API nueva (`app/api/incidencias/**`)**
  - `GET /api/incidencias/[id]/hilo` — el hilo ya fusionado en JSON (`?categoria=`, `?buscar=`,
    `?limite=`), con totales por categoría.
  - `POST /api/incidencias/[id]/informe` — informe EN VIVO del foco; lo guarda en
    `estado.informes` (viaja por SSE y sale en `/informes` y en la auditoría) y devuelve el
    Markdown. La página lo enseña en un `Dialogo` con **Descargar .md**
    (`/api/informes/[id]?formato=md`).
  - `GET /api/incidencias/[id]/expediente` — Markdown con `Content-Disposition: attachment`:
    ficha, hilo cronológico completo en tabla, unidades, poblaciones, comunicados, la cadena de
    auditoría de cada decisión (historial, acciones con resultado real, evidencias, fundamentos,
    evaluación del supervisor y traza con sus llamadas de IA) y **todas las actas del foco
    concatenadas**.

**Añadidos (solo aditivos) en archivos de otros**

- `lib/agentes/informes/redactor.ts` (C): función nueva `informeSituacionIncendio(incendio, ctx)`.
  Acta determinista SIEMPRE (situación · cronología de comunicaciones con resultado real ·
  decisiones y sus estados · unidades y posiciones · poblaciones y avisos · percepción y
  despliegues · actas relacionadas), con teléfonos y correos enmascarados y huella SHA-256;
  narrativa opcional con `completarTexto({ permitirEnPausa: true })` y tope
  `INFORMES_TIMEOUT_NARRATIVA_MS`. Nada del archivo anterior se ha tocado.
- `lib/motor/auditoria.ts` (A): función nueva `cadenaDeIncendio(incendioId, estado?)` +
  tipo `CadenaIncendio`. Reúne por foco lo que `cadenaDe` reúne por decisión e incluye los focos
  absorbidos por fusión.
- `lib/cliente/api.ts` (E): al final, `obtenerHiloIncidencia`, `generarInformeIncidencia`,
  `urlExpedienteIncidencia`, `urlInformeMarkdown` y sus tipos.
- `components/sala/PestanaFocos.tsx` (E/H): **una línea**, el botón "Abrir incidencia".

**Contrato**: no he cambiado `lib/dominio/tipos.ts`. El módulo compartido del hilo
(`components/incidencia/hilo.ts`) es puro (sin React ni Node) y lo usan tanto el navegador como las
rutas de servidor; exporta también `idsDeFoco()`, que resuelve la cadena de focos absorbidos.

**Comprobado** (servidor compartido de desarrollo `:3100`, datos reales, sin tocar `:3000`)

```bash
npx tsc --noEmit                 # limpio en todo el proyecto
npx eslint app/incidencias components/incidencia app/api/incidencias   # limpio
curl -s -o /dev/null -w '%{http_code}' localhost:3100/incidencias                    # 200
curl -s -o /dev/null -w '%{http_code}' localhost:3100/incidencias/<id>               # 200
curl -s localhost:3100/api/incidencias/<id>/hilo                                     # 37 entradas reales
curl -s localhost:3100/api/incidencias/<id>/hilo?categoria=mal                       # 400 con mensaje claro
curl -s localhost:3100/api/incidencias/no-existe/hilo                                # 404
curl -sD- -o exp.md localhost:3100/api/incidencias/<id>/expediente                   # 2.826 líneas, attachment
curl -s -X POST localhost:3100/api/incidencias/<id>/informe                          # 200 en 20 s,
#   18.107 caracteres, conNarrativaIA=true (glm5.3-flash), huella SHA-256, guardado en /informes
```

**Avisos**

- El hilo y el lienzo se construyen del `Snapshot`, que recorta observaciones a las últimas 300 y
  actas a las últimas 100: en ejecuciones muy largas el hilo de la pantalla puede quedarse corto.
  El expediente NO usa ese recorte (lee el estado entero), así que la auditoría sigue completa.
- Las trazas solo se conservan de los últimos ciclos de cada agente; si un agente ya rotó su traza,
  el panel del nodo lo dice en vez de inventarse nada.
- El informe en vivo tarda lo que tarde el modelo (hasta 20 s); si no hay proveedor, sale el acta
  determinista con una nota que lo explica y `conNarrativaIA: false`.


#### Ampliación (2026-09-19, segunda vuelta) · el lienzo, como lo pidió Javi

1. **Están SIEMPRE los 16 agentes**, cada uno en la columna de su categoría, hayan intervenido o
   no. Los que ahora mismo no hacen nada sobre ESA incidencia salen en gris, con el borde a rayas,
   atenuados y con la etiqueta "inactivo" / "inactivo ahora"; los que trabajan, en color pleno, con
   su tarea actual y con halo si están razonando. La barra superior resume "8 de 16 agentes
   trabajando aquí".
   Un agente cuenta como activo si tiene un ciclo en curso sobre este foco, si el núcleo lo tiene
   asignado a él, o si ha dejado señal en la ventana de actividad: traza relacionada, evento,
   decisión propia, y además las señales que no llevan `agenteId` pero son inequívocas
   (la observación que trajo su canal, la verificación, el despliegue del despachador, los
   fundamentos del asesor legal, la nota del supervisor, las actas del redactor). Ventana:
   `MINUTOS_MUNDO_ACTIVIDAD = 5` minutos de **mundo** convertidos a tiempo real con el factor del
   reloj, **con un suelo de 120 s reales**: a ×12, cinco minutos de mundo son 25 s, menos que la
   cadencia de casi todos los agentes, y sin ese suelo parpadearían a gris entre ciclo y ciclo.
2. **Clic en una ARISTA → panel con lo que se compartió por ella.** Cada arista guarda sus `hitos`
   (los 12 últimos): la observación completa (texto, canal, remitente enmascarado, extracción con
   tipo, gravedad, fiabilidad, lugar y "personas en riesgo"), la decisión (título, resumen, por qué,
   sus acciones y su estado/competencia/riesgo), la revisión legal con las citas, la evaluación del
   supervisor con sus criterios, y el **resultado real de cada acción**: canal (llamada/SMS/
   Telegram/email), destino enmascarado, proveedor, referencia externa, transcripción o
   confirmación, o la **ruta OSRM** (km, minutos, % recorrido y sector) en los despliegues. Cada
   hito enlaza a su acta (se abre entera en el diálogo) y a su cadena de auditoría.
   La detección se hace muestreando la curva de Bézier, así que se pincha el enlace, no una caja
   invisible.
3. **Clic en un AGENTE → qué está haciendo ahora.** `tareaActual`, **traza en curso** con sus
   llamadas de IA en vivo (proveedor/modelo/latencia y las dos últimas con pregunta y respuesta),
   decisiones y acciones suyas abiertas en esta incidencia, historial de sus últimos ciclos aquí,
   enlace a su ficha completa y a la auditoría de cada decisión, y **controles Pausar/Reanudar,
   Asumir/Liberar control y Forzar ciclo** (`ControlesAgente` de E; al terminar refresca el estado).
   El panel del nodo también lista sus enlaces, y cada uno abre el panel de arista.

Se mantienen el arrastre de nodos, las posiciones persistidas por incidencia en `localStorage`, el
zoom con rueda, el paneo, Reordenar/Encuadrar, los tokens del tema y `prefers-reduced-motion`.

**Comprobado** con `npx tsc --noEmit` limpio, `npx eslint app/incidencias components/incidencia
app/api/incidencias` limpio y en `:3100` con un foco recién declarado (`Prueba G lienzo`): a los
~45 s el lienzo ya mostraba 16 agentes (8 activos), el ataque inicial autónomo
coordinador → asesor legal → autónomo → despachador → unidad, y el panel del enlace
`despachador → B.R.I.F. de La Iglesuela del Tiétar · BUL` con "OSRM 69,0 km / 78 min · 13 %
recorrido · sector A", proveedor "OSRM + HappyRobot" y el aviso real de que la unidad no tiene
teléfono en OSM.

**Aviso**: `EstadoAgenteApp.tareaActual` es global (el agente puede estar tocando otro foco en ese
instante), así que el nodo solo la enseña cuando el núcleo tiene a ese agente asignado a ESTA
incidencia; si no, pone "activo aquí hace un momento" y el panel dice sobre qué foco está.

### 2026-09-19 · J · Control de calidad y corrección de errores del backend

**Informe completo en `docs/CALIDAD.md`** (qué se probó, tiempos medidos, bugs con archivo y
causa, y riesgos pendientes). Resumen:

**Probado de verdad contra `:3100`** (sin reiniciar nada, sin `next build`, Supabase solo en
lectura): ataque inicial autónomo con unidad de bomberos en ruta en **3-5 s** (el encargo
pedía ≤ 40 s); velocidad de las unidades = media real de OSRM **× 1,25** con tope nominal
(66,6 / 70,0 / 70,1 km/h medidos); pausa global; reanudación; viento forzado por el mando
(frente 183°/1,15 m/min → 135°/7,9 m/min y evento `viento_gira`); aviso autónomo a Tuéjar
con riesgo 20; auditoría completa (`/api/auditoria` con traza, historial, 2 acciones con acta,
7 informes, 0 sin huella; `/api/auditoria/exportar` → expediente de 245 kB); persistencia en
Supabase (13 ejecuciones, 70 decisiones, 229 informes, 1.621 trazas, rehidratación verificada).

**12 bugs corregidos** (detalle en CALIDAD.md):

| # | Archivo | Qué pasaba |
|---|---|---|
| J-0 | `lib/motor/orquestador.ts:18` | `import` duplicado de `EstadoIncendio`: **`tsc` y `next build` rotos** |
| J-1 | `lib/motor/orquestador.ts` (`aprobarDecision`) | Un `generarInforme` extra escribía una **segunda acta del mismo estado**, pisaba `informeId` con una que no estaba en `informeIds` y gastaba ~25 s de razonamiento por decisión |
| J-2 | `lib/ia/llm.ts`, `reloj.ts`, `orquestador.ts` | "Parar" no cortaba las llamadas a la IA ya lanzadas ni las que esperaban turno en la cola: **5 respuestas completas durante 30 s de pausa** |
| J-3 | `lib/motor/traza.ts` (+ orquestador) | `AsyncLocalStorage` atribuía al **coordinador** las llamadas del supervisor, el redactor y el asesor legal (coordinador con 11 llamadas, supervisor con 0): imposible medir latencia por agente |
| J-4 | `proteccion-poblacion`, `memoria`, `patrones`, `portavoz` | Sin `tiempoMaximoSeg` propio, los ciclos morían a los 90 s y **se perdían las decisiones ya redactadas en ese ciclo** |
| J-5 | `lib/agentes/planificacion/proteccion-poblacion.ts` | Solo miraba `riesgo >= medio`: **Tuéjar (1.221 hab, 4 vulnerables, 2,9 km) nunca se avisaba** |
| J-6 | `verificador`, `asesor-legal`, `patrones`, `aprendizaje/memoria`, `conocimiento/consulta` | Topes de 400-2.000 tokens: el modelo se gastaba el presupuesto razonando y había que **reintentar con el doble** |
| J-7 | `verificador`, `asesor-legal` | Llamadas a la IA **sin `signal`**: no se cancelaban ni al pausar ni al agotarse el ciclo |
| J-8 | `persistencia.ts`, `/api/salud` | Mensaje de Supabase engañoso (no nombraba `SUPABASE_ANON_KEY`, que es la que se usa) |
| J-9 | `lib/motor/orquestador.ts` (`nuevaEjecucion`) | La política de fábrica **no se aplicaba nunca**: por eso avisos y comunicados no salían solos |
| J-10 | `lib/agentes/analisis/verificador.ts` | `KM_CONFIRMA = 5` creaba **dos focos por la misma noticia** (prensa geocodifica al centroide municipal); ahora 10 km para `prensa`/`rrss` |
| J-11 | `lib/motor/orquestador.ts` | El supervisor se pintaba **en rojo** al pausar, porque un `AbortError` se trataba como avería |

**Añadidos** (aditivos, nada renombrado):
- `EstadoAgenteApp.tiempoMaximoSeg?: number` (`lib/dominio/tipos.ts`), rellenado en
  `lib/agentes/registro.ts`. **E/H**: se puede pintar en el visor del agente; explica por qué
  una traza sale "cancelado".
- `GET /api/salud` gana dos bloques: **`ia`** (proveedor, modelos por papel, contadores y la
  cola de `estadoColaLLM()`) e **`integraciones`** (HappyRobot por canal, Telegram, Supabase,
  OSRM) con el detalle exacto de lo que falta.
- `lib/motor/traza.ts` exporta `sinTraza(fn)`; `lib/ia/llm.ts` exporta `abortarLlamadasIA()`.

**Estado de tipos y lint**: `npx tsc --noEmit` y `npx eslint lib app/api` **sin errores en mi
ámbito** (lib/motor, lib/agentes, lib/ia, lib/conocimiento, lib/aprendizaje, lib/fuentes,
lib/db, app/api). Los errores de `components/mapa/MapaCliente.tsx` y
`lib/cliente/useTema.ts` son de la sala de mando.

**Riesgos pendientes**: los 9 están listados en `docs/CALIDAD.md` §4. Los tres que más
importan antes de la demo: el riesgo por ETA que deja "bajo" a pueblos pegados al foco (R-1,
de K), `estadoAviso` sin `"sin_respuesta"` (R-2, de K) y confirmar con el servidor reiniciado
que la pausa deja **0** llamadas completadas (R-7).

**No he hecho ningún commit.**

### 2026-09-19 · K · Extinción realista, contención y fusión de focos

**Petición de Javi**: *"tampoco el que se extinga el fuego de forma realista está pensado"*
(+ encargo de la coordinación: *"que dos o más focos se puedan juntar por cercanía y el
escenario cambia"*). Antes el fuego solo crecía y solo paraba si el mando lo marcaba a mano.

**Documentación completa del modelo, con parámetros y fuentes: `docs/EXTINCION.md`.**

#### Qué hay ahora

- **`lib/simulacion/contencion.ts` (nuevo)** — modelo de contención, función pura:
  - Ritmo de línea de control por unidad y dotación: autobomba 5 m/min (5 personas),
    BRIF 9 (12), agentes forestales 3 (2), maquinaria 20 (1 buldócer); policía, guardia civil,
    ambulancia y protección civil **0** (aseguran accesos y sanitario, no extinguen).
    Órdenes de magnitud de NWCG PMS 410-1, Broyles (2011), Hirsch & Martell (1996) y
    Plucinski (2019), citados en el documento.
  - Factores por combustible (pasto 1,6 · matorral 1,0 · bosque 0,6 · agrícola 1,8 · urbano 0,8),
    por viento (1,0 hasta 30 km/h → 0,55 a 50 → 0,20 a 70) y de ataque directo frente a línea
    indirecta (×2,5 con perímetro ≤ 2 km → ×1 con > 6 km).
  - `perimetroTotalM` real del polígono, `perimetroControladoM` acumulado, `fraccion`,
    `estimadoControlMin` descontando el crecimiento del perímetro (`undefined` si no converge:
    la línea no gana al fuego).
  - `factorExtincion`: `(1 − fraccion)^1,5 × Faéreos × Flluvia`. Aéreos = 0,6 nominal
    (0,50-0,70) solo con viento < 40 km/h y hora de mundo 07-21 en Europe/Madrid; se activan
    con una unidad `medios_aereos` o con una acción `solicitar_medios_aereos` **ejecutada**.
    Lluvia: > 5 mm en 24 h (`precipitacionAcumulada` real de Open-Meteo) → ×0,2.
- **`lib/simulacion/fusion.ts` (nuevo)** — dos focos a < 300 m borde a borde son uno solo:
  sobrevive el más consolidado (y a igualdad el más antiguo), perímetro = envolvente convexa
  remuestreada a 36 radios por intersección de rayo, nivel y confianza al máximo, observaciones
  concatenadas, `focosAbsorbidos`; el absorbido pasa a `"fusionado"` con `fusionadoEn` y
  **conserva íntegro su historial** para la auditoría; unidades y poblaciones se traspasan
  (distancia y rumbo recalculados), decisiones pendientes de los dos → `caducada` ("focos
  fusionados"), el `Cluster` pasa a `mismo_incendio`, evento crítico y se despierta a
  coordinador, protección de población, patrones y portavoz.
- **`lib/simulacion/geometria.ts`** — añadidos `perimetroM`, `distanciaEntrePerimetrosM`,
  `envolventeConvexa` y `radiosPorRayo` (remuestreo fiel: `radiosPorRumbo` interpola los
  sectores vacíos con la media de los vecinos e inflaba 4× el área de dos lenguas alargadas).
- **`lib/simulacion/propagacion.ts`** — `propagar`, `predecir` y `evaluarPoblaciones` aceptan
  `factorExtincion` opcional (por defecto 1; sin medios el fuego crece exactamente como antes).
  La dependencia va en un solo sentido: este archivo NO importa `contencion.ts`.
  Además, arreglo de la petición (1) de J: `riesgoPorDistancia` + escalón por vulnerables.
- **`lib/agentes/analisis/propagacion.ts`** — el agente ahora, cada 30 s: fusiona focos →
  pasa `confirmado` a `activo` cuando llega la primera unidad (se despierta con `unidad_llega`)
  → propaga frenado por la contención → recalcula la línea sobre el perímetro nuevo → marca
  hitos → propone las decisiones de cierre. Sigue siendo determinista, cero llamadas al LLM.
- **`lib/motor/orquestador.ts#cerrarIncendio`** — `controlado` = liquidación (los medios se
  quedan); `extinguido`/`descartado` = **regreso a base por carretera con ruta real de OSRM**.
  Detalle línea a línea en Peticiones (K → J).

#### Ciclo de vida completo que ve el usuario

`confirmado` → (llega la primera unidad) `activo` → (fracción 100 %) **`estabilizado`**, evento
crítico *"Estabilizado: perímetro 100 % controlado por N unidades"* → (60 min de mundo sin
rebrote) decisión **Declarar CONTROLADO**, que por política es **humana** → `controlado`
(liquidación, los medios siguen) → (120 min de mundo) decisión **Declarar EXTINGUIDO** →
`cerrarIncendio` y las unidades **vuelven a su base por carretera**.
**Rebrote**: si el viento efectivo sube > 20 km/h sobre el de estabilizar o el peligro pasa a
extremo, la fracción cae un 20 %, se borran los hitos y el foco vuelve a `activo` con evento
crítico.

#### Para H (mapa y sala)

Todo está en `incendio.contencion`: `fraccion` (0-1), `ritmoMmin`, `unidadesTrabajando`,
`perimetroTotalM` / `perimetroControladoM`, `mediosAereos`, `estimadoControlMin`, los hitos
`estabilizadoEn` / `controladoEn` / `extinguidoEn`, `rebrotes`, `lluvia24Mm` y **`explicacion`**,
una frase ya redactada del tipo *"2 unidad(es) construyen línea a 22,2 m/min: 62 % de 2,75 km
de perímetro controlado; control total estimado en ~35 min."*
Para la fusión: el foco absorbido queda en estado `"fusionado"` con `fusionadoEn` (no lo pintes
como incidencia viva; `incendiosActivos()` ya lo excluye) y el superviviente trae
`focosAbsorbidos`. El evento de fusión es `incendio_actualizado` nivel `critico` con
`datos.fusion === true`.

#### Verificación

`npx tsx scripts/verificar-extincion.ts` — **14 comprobaciones en verde**:
- 2 ha de matorral, 2 autobombas a los 30 min, viento 15 km/h → **estabilizado a los 147 min
  de mundo, 32 ha**. Con **50 km/h no se estabiliza**: 4 % de perímetro y 921 ha en 3 h.
- Sin medios: 172 ha frente a 32. Con 12 mm de lluvia: 12 ha. Con medios aéreos: estabiliza a
  los 79 min en vez de 147.
- Dos focos a 1 km en pasto con viento 40 km/h se fusionan a los 8 min (6,1 + 6,1 ha → 21 ha).
- **Escenario 7: el `ciclo()` real del agente sobre un `Estado` vivo** — `confirmado → activo →
  estabilizado`, evento de estabilización, decisión *Declarar CONTROLADO* en `[humano/propuesta]`,
  liquidación, decisión *Declarar EXTINGUIDO*, y rebrote al doblarse el viento.

`npx tsc --noEmit` y `npx eslint lib/simulacion lib/agentes/analisis lib/agentes/ejecucion`
limpios en mi ámbito (los errores de `tsc` que quedan están en `app/page.tsx` y
`components/sala/PestanaDecisiones.tsx`, de G y H).

**En vivo en `:3100`**: declarado un foco (`Prueba K · extincion`), el ataque inicial autónomo
salió solo (2 BRIF por carretera, 77 min) y, al declararlo extinguido, las dos unidades pasaron
a `regreso` con ruta real de OSRM a su base (22,6 km/33 min y 11,7 km/21 min) en lugar de
aparecer allí de golpe. **Limitación encontrada**: ese proceso conserva el registro de agentes
del arranque, así que el `propagacion` nuevo no entra con el hot reload; hace falta reiniciar
`next dev` o `POST /api/ejecucion {accion:"nueva"}`. No lo hice porque había una ejecución de J
en marcha; por eso el escenario 7 ejecuta el ciclo del agente en proceso.

**No he hecho ningún commit.**

### 2026-09-19 · I · Grafo de conocimiento interactivo

Petición de Javi: *"que este grafo sea interactuable, que se puedan arrastrar y
mover los vértices"*. El visor SVG anterior se ha sustituido por uno de canvas
2D con simulación de fuerzas propia. **Sin dependencias nuevas.**

**Qué hay**

- `components/conocimiento/simulacion.ts` — motor de fuerzas **fuera de React**
  (ni un renderizado por fotograma): repulsión con **quadtree de Barnes-Hut**
  por encima de 300 nodos (fuerza bruta por debajo, que sale más barata),
  muelles por arista con el reparto de d3 (el extremo más conectado cede menos),
  gravedad al centro y colisiones por rejilla para que las etiquetas se lean.
  Se enfría sola (`alfa`) y se para. `reordenar()`, `soltarTodos()`,
  `recalentar()`, `limites()`.
- `components/conocimiento/dibujo.ts` — pintado en canvas por lotes de color,
  etiquetas con anticolisión (prueba derecha/izquierda/arriba/abajo y, si no
  cabe, se calla), halos y números de orden del modo consulta, y minimapa.
- `components/conocimiento/tema.ts` — lee los tokens de `globals.css` con
  `getComputedStyle` (el canvas no resuelve `var()`) y **se refresca solo** al
  cambiar de tema (MutationObserver sobre `data-theme` + `matchMedia`).
  También `useMovimientoReducido()` para `prefers-reduced-motion`.
- `components/conocimiento/GrafoConocimiento.tsx` — el visor:
  - **arrastrar vértices con ratón y con dedo** (pointer events); al soltar, el
    nodo queda **clavado** y el resto del grafo sigue reaccionando; doble clic,
    tecla `L` o el botón del panel lo liberan;
  - **zoom** con rueda y **pellizco**, desplazamiento arrastrando el fondo,
    botones *Reordenar* / *Soltar todos (n)* / *Encajar* / `−` `+` con el
    porcentaje, y minimapa pulsable para saltar de zona;
  - **etiquetas**: siempre para documentos y entidades; para fragmentos al
    señalarlos, al seleccionarlos, si están citados o a partir del 145 % de zoom;
  - **leyenda que filtra**: clic en un tipo de relación lo oculta (y deja de
    tirar del grafo);
  - **semántica**: al señalar un nodo se resaltan sus vecinos y el resto se
    atenúa; clic en un fragmento abre el panel con el texto completo, documento,
    sección y entidades (pulsables) y los botones **"Consultar con esta
    pregunta"** (rellena el buscador) y **"Copiar cita"**; clic en una entidad
    lista los fragmentos que la mencionan; buscador de nodos con autocompletado
    que centra y selecciona;
  - **modo consulta**: los fragmentos que devuelve `/api/conocimiento/consultar`
    salen con halo y número de orden (1 = más similar; halo secundario para los
    que llegaron por el grafo), más grandes para que no se solapen, y el panel
    *"Lo que miró la IA"* enlaza cada cita con su nodo;
  - **rendimiento y accesibilidad**: `requestAnimationFrame`, estado de la
    simulación en refs, `prefers-reduced-motion` (resuelve el reparto de golpe y
    no anima), posiciones clavadas en `localStorage` por documento con
    `try/catch`, lista lateral navegable con teclado (Tab + Intro centra el
    nodo), teclas sobre el lienzo (flechas, `+`/`−`, `E`, `R`, `S`, `L`, `Esc`) y
    tokens de tema en todo (claro y oscuro).
- `components/conocimiento/PaginaConocimiento.tsx` — la página sigue igual de
  funciones (subida, lista, borrado, buscador) pero pasada a tokens de tema y
  con el grafo como pieza central: cada fragmento de la respuesta tiene su
  número y un *"Ver este fragmento en el grafo"* que centra el nodo.

**Cambios fuera de mi carpeta (aditivos, nada existente tocado)**

- `lib/conocimiento/grafo.ts`: **nueva** `ampliarGrafoConFragmentos(grafo, ids)`.
  `obtenerGrafo` muestrea fragmentos (682 no caben en pantalla) y los que citaba
  la IA podían quedarse fuera justo en el momento de enseñarlos.
- `app/api/conocimiento/grafo/route.ts`: **nuevo** parámetro `incluir=id1,id2`
  que aplica lo anterior. Verificado: 327 nodos → 331 con los 6 fragmentos de
  una consulta real.

**Comprobado (no solo compila)**

- `npx tsc --noEmit` y `npx eslint components/conocimiento app/conocimiento
  lib/conocimiento app/api/conocimiento` limpios.
- Chrome sin cabeza por CDP contra el dev compartido (`:3100`), **sin un solo
  error ni aviso de consola**: arrastre con ratón (el nodo se mueve, queda
  clavado y se guarda en `localStorage`), **arrastre con eventos táctiles**,
  *Soltar todos* (vacía el almacén), zoom con rueda (80 % → 118 %), *Encajar*
  (53 %), teclado sobre el lienzo, clic en nodo (abre el texto del fragmento),
  filtro de la leyenda, buscador (*Montes* 2, *evacuación* 1, *Preámbulo* 8
  sugerencias) y `prefers-reduced-motion` (se pinta resuelto, sin animación).
- Consulta real de extremo a extremo ("¿Cuándo se constituye el CECOPI?"):
  respuesta del modelo, 6 fragmentos numerados en el panel y sus halos en el
  grafo. Con el mundo en pausa (sin IA) se ve el aviso y **igualmente** los
  fragmentos resaltados: no se inventa nada.

**Avisos**

- El encuadre automático (al cargar y al enfriarse) NO hace zoom sobre los
  fragmentos citados a propósito: lo que cuenta la pantalla es "de todo esto, la
  IA miró estos seis", y eso solo se ve con el grafo entero delante. Para ir a
  uno concreto, clic en su cita.
- Calibrado para ~330 nodos y probado hasta 600 sin bajar de 60 fps. Si se sube
  `CONOCIMIENTO_MAX_NODOS` muy por encima, revisar `REPULSION`/`GRAVEDAD` en
  `simulacion.ts`: están ajustados para que el grafo se estabilice con un radio
  de unos 400 px, que es lo que hace que se vea la forma y no una bola.
- Al montar el visor hay dos efectos que dependen de `listo` (el lienzo no
  existe mientras carga el grafo) y el `requestAnimationFrame` se limpia
  poniendo el identificador a `undefined`. Si alguien toca eso, el grafo deja de
  pintarse en desarrollo (React monta dos veces en modo estricto). Está
  comentado en el código.

---

## 2026-09-19 · H · Mapa de España completo, unidades visibles, pausa global y viento del ejercicio

Quejas de Javi que se atacan aquí: «faltan múltiples cámaras en el territorio de
España», «bomberos no he visto ni efectivos moviéndose», «ni que un agente los
haya avisado ni nada», «si le doy a parar, que se paren todos y cada uno de los
agentes y todo se pause» y «tampoco hay comunicados ni nada en el portal».

### 1. Capa "Cámaras de España" (las 2.305, no solo las vigiladas)

- `components/mapa/CamarasEspana.tsx` (nuevo) + `useCamarasEspana.ts` (nuevo).
  `GET /api/camaras?todas=1` ya servía el catálogo completo (DGT + Madrid), así
  que **la ruta no se ha tocado**; solo se añadió `listarTodasLasCamaras()` a
  `lib/cliente/api.ts`. Una descarga al abrir la sala y otra cada 10 min.
- Dibujo **imperativo** sobre un `L.canvas()` propio (2.300 componentes React
  con su popup hunden el hilo principal): recorte al encuadre visible, tope de
  2.500 marcadores y construcción **en lotes de 350 con `requestAnimationFrame`**.
- Agrupación propia: a zoom < 8, celdas de 0,5° con el contador (clic = acercar);
  a zoom ≥ 8, puntos sueltos con el nombre al pasar el ratón. Las cámaras
  vigiladas del Snapshot se excluyen de esta capa y se siguen pintando encima
  con su icono y su veredicto.
- Al pulsar una cámara se abre la ficha de React de siempre (`PopupCamara`):
  imagen en vivo refrescada, carretera/PK y "Vigilar esta cámara". Si la del
  Snapshot existe, manda la del Snapshot (lleva `vigilada` y `ultimoAnalisis`).
- La capa va **activada por defecto** y se pinta por debajo de todo lo
  operativo. Si el catálogo falla, se dice en pantalla con el error real.
- **Caché en el módulo, no en un `useRef`**: con el guardia por referencia, el
  doble montaje de React en desarrollo cancelaba la única petición y la capa se
  quedaba vacía y "cargando" para siempre. Si alguien toca `useCamarasEspana`,
  que no vuelva a un `useRef`.

### 2. Unidades que se ven y se entienden

- `simbologia.ts`: colores por cuerpo tal y como los pidió el mando — bomberos
  rojo, BRIF y agentes forestales **verde**, Guardia Civil y Policía **azul**,
  ambulancia rojo sobre blanco, Protección Civil **naranja**, maquinaria
  **amarillo** (tokens nuevos `--naranja` y `--amarillo` en `globals.css`, con
  su variante oscura y su entrada en `@theme inline`). Medios aéreos en petróleo
  de marca para no confundirlos con los cuerpos azules. `LEYENDA_UNIDAD` lleva
  esa correspondencia a la leyenda del mapa **con texto**, nunca solo color.
- Ruta real de OSRM partida por el progreso (`partirRuta` en `mapa/geo.ts`): el
  tramo **ya recorrido** va grueso y sólido, lo que queda fino y discontinuo, y
  una **punta de flecha** sobre la carretera marca el sentido con el rumbo real.
  El icono lleva además una flecha en el borde. En base: icono pequeño y
  atenuado; en intervención: anillo.
- `components/mapa/FichaUnidad.tsx` (nuevo): nombre, tipo, base, dotación,
  estado, incendio y sector, ETA en **hora de mundo**, y el bloque **"Órdenes y
  avisos"** con `ultimaOrden` (texto, quién la autorizó, cuándo) y
  `ultimoContacto` (canal y resultado real). Si no hay contacto lo dice con
  todas las letras: *"No avisada por ningún canal: solo tiene la orden en el
  sistema"* — que es justo lo que echaba en falta Javi. Botones **"Ordenar
  destino"** (activa el modo "clic en el mapa" y llama a
  `POST /api/unidades/[id]/ordenar`) y **"Retirar"**.
- Capa **"Bases y parques"** (nueva, activada): agrupa las unidades por su base
  y pinta un marcador con el número; el popup lista qué hay dentro y cuántas
  están desplegadas. Así se ve de dónde sale cada camión.
- `lib/cliente/api.ts`: **`ordenarUnidad` estaba mal tipada** (mandaba
  `{destino, incendioId?, texto?}` cuando el servidor exige `incendioId` y
  `quien`, y no manda `texto`). Corregida y añadida `retirarUnidad`.

### 3. Pausa global visible

- Banda ámbar a todo el ancho bajo la barra: **"MUNDO EN PAUSA · ningún agente
  trabaja"** con botón *Reanudar (Espacio)*; el reloj de mundo **parpadea**
  (`.parpadeo` en `globals.css`, respetando `prefers-reduced-motion`).
- Botón **PARAR TODO** rojo y grande, siempre visible en la barra, que llama a
  `POST /api/reloj {pausado:true}`; pasa a *REANUDAR* cuando ya está en pausa.
- Pestaña de agentes y vista de agentes: con el mundo en pausa **todos** se
  pintan como pausados (insignia "Pausado (mundo)", punto ámbar, borde y fondo
  ámbar, "sin ciclos ni llamadas a la IA"), no solo los pausados a mano, y
  "pensando ahora" baja a 0.

### 4. Focos sin confirmar, fusionados y contención

- Un foco `detectado` se pinta **hueco y ámbar** con etiqueta "Sin confirmar",
  perímetro discontinuo y, en su ficha, **"Confirmar foco"** / **"Descartar"**
  (`PATCH /api/focos/[id]`). En la pestaña Focos hay sección propia
  **"Sin confirmar (N)"** separada de **"Activos (N)"**.
- Coherencias que pedía Javi (`components/sala/DetalleFoco.tsx`, nuevo y
  compartido por el mapa y el panel): *"Según la fuente (…)"* para
  `resumenFuente`, **"Nota del mando" solo si hay `notas`**; "Pueblos en
  peligro" cuenta solo riesgo medio/alto/inminente y dice *"de N en el radio"*;
  `mediosExternos` sale como *"Medios que ya actúan según la fuente: … (no
  gestionados por Atalaya)"* bajo las unidades; la confianza se explica
  (*"Confianza 70 % · una sola fuente (prensa) · pendiente de confirmar"*) y los
  sin confirmar avisan de que **no se despliegan medios**.
- `contencion`: barra **"Perímetro controlado N %"** con "N unidades
  construyendo línea a X m/min · control estimado en ~M min" y los hitos con
  hora de mundo. En el mapa, el tramo de perímetro ya controlado se pinta en
  **negro discontinuo proporcional a la fracción**. `estabilizado` pasa a ámbar
  y `controlado`/`extinguido` a verde.
- `fusionado`: no cuenta como activo en ningún filtro; en el mapa queda un punto
  gris con *"unido a <nombre>"*, el superviviente lleva la insignia **"Fusión de
  N focos"** y en la pestaña Focos hay un desplegable **"Absorbidos"**.

### 5. Viento del ejercicio

- `components/sala/ControlViento.tsx` (nuevo): **rosa de los vientos
  arrastrable** (ratón, dedo y teclado: flechas 5°, con Mayús 15°) que muestra
  "NO 315°", deslizador de intensidad 0-120 km/h con el valor en grande y rachas
  opcionales, más *Aplicar* y *Volver a la previsión real*. Se dibuja la flecha
  **hacia** dónde va el viento aunque se guarde **desde** dónde sopla, que es el
  convenio de `Meteo.direccionGrados`.
- Está en la ficha de cada foco (mapa y pestaña Focos) y, para todos los focos
  activos, en el botón **"Viento global"** de la barra superior.
- `lib/cliente/api.ts`: `fijarViento`, `quitarViento`, `fijarVientoGlobal`,
  `quitarVientoGlobal`. Cuando existe `meteoForzada` sale la insignia ámbar
  **"Viento forzado por el mando"** en la ficha; las flechas del mapa ya salen
  de `incendio.meteo`, así que giran solas.

### 6. Decisiones, registro y entradas al visor de incidencia

- Insignia **"Autónoma: ataque inicial"** cuando `competencia === "autonoma"` y
  la decisión está aprobada/ejecutando/ejecutada, tanto en la tarjeta completa
  como en los resúmenes. Cada acción con `objetivo.unidadId` lleva **"Ver en el
  mapa"**, que centra en esa unidad.
- **Comunicados**: el último publicado de cada foco sale en su ficha (título,
  hora y enlace a `/publico`), y los pendientes de aprobación aparecen en
  "Requiere tu decisión" con vista previa del texto. *No se ha tocado
  `app/publico` ni `components/publico`.*
- Registro: `unidad_movida` / `unidad_llega` con camión, y las acciones con
  canal de comunicación con teléfono / SMS / correo / Telegram, más una segunda
  línea con canal, proveedor, `run …` y kilómetros reales.
- **"Abrir incidencia"** (`/incidencias/[id]`) en la ficha del foco del mapa y
  en la pestaña Focos (se ha respetado tal cual la línea que dejó G), y
  `app/page.tsx` acepta **`?foco=<id>`** para llegar desde allí con el foco
  resaltado, la pestaña Focos abierta y el mapa encuadrado.

### Arreglos de paso (archivos míos, avisados aquí)

- **Fallo de hidratación** en `app/page.tsx`: leer `?foco=` durante el render
  hacía que servidor y navegador pintaran pestañas distintas. Ahora se lee tras
  hidratar. Si alguien vuelve a tocarlo: **la URL no se puede mirar en el
  render**.
- `components/mapa/MapaCliente.tsx`: las capas guardadas se leen ya en el primer
  render (el mapa es `ssr:false`, así que no hay desajuste) y se acabó el
  parpadeo de capas al cargar.
- `CadenaAuditoria`, `DialogoInforme`, `DialogoDeclararFoco` y `DialogoMovil`
  pasan a ajustar el estado en el render (patrón oficial de React) en vez de en
  un efecto. `useEstado` y `useTema` llevan un `eslint-disable` **razonado**:
  son sincronización con el navegador, imposible en el render.
- **Pueblos**: con 2.000 núcleos en el radio el mapa era una sopa de etiquetas.
  Ahora solo llevan el nombre fijo los 8 inminentes más cercanos, y los de
  riesgo bajo son un punto de canvas en vez de un círculo geográfico.

### Comprobado

- `npx tsc --noEmit` y `npx eslint components/mapa components/sala app/page.tsx lib/cliente`
  **limpios** (los errores que quedaban de antes en esos archivos se han
  arreglado; siguen los de `components/conocimiento`, que es de I, y los de
  `vitest.config.mts`, que es de J).
- Chromium sin cabeza contra `localhost:3100`, **0 errores de consola**:
  home y `/?foco=<id>`; panel de capas con "Cámaras de España · 2.305 en el
  mapa"; agrupaciones por celda a zoom bajo; `Espacio` levanta la banda "MUNDO
  EN PAUSA · NINGÚN AGENTE TRABAJA" con su botón Reanudar; ficha de unidad con
  "ÓRDENES Y AVISOS" ("Enviar … al sector A … Autorizada por dec-… · 19 sept,
  06:37 (hora de mundo)" + "No avisada por ningún canal"); ficha de foco con
  "Perímetro controlado 82 % · 2 unidades construyendo línea a 13,5 m/min ·
  control estimado en ~8 min"; y el foco de prensa con "Confianza 70 % · una
  sola fuente (www.lavozdegalicia.es) · pendiente de confirmar".
- `POST /api/focos/[id]/viento` probado en vivo: devuelve `meteoForzada` y
  `meteo.fuente = "Viento forzado por Sala de mando (ejercicio) sobre
  Open-Meteo"`. Los forzados de prueba se han quitado al terminar.

### Avisos

- `GET /api/camaras?todas=1` devuelve ~594 KB. Sale en 40 ms con la caché del
  servidor caliente, pero **la primera vez del día tarda** (baja el catálogo de
  la DGT): por eso la capa avisa de "Cargando…" y el error real si falla.
- El aviso de consola *"Encountered a script tag while rendering React
  component"* viene del `<script>` de tema de `app/layout.tsx` (constructor E) y
  es anterior a esta sesión; no rompe nada, pero conviene mirarlo.
- Sigue habiendo ~2.000 `Circle` de pueblos con dos focos abiertos. Con los de
  riesgo bajo ya en canvas va fino, pero si el radio operativo crece mucho más
  habría que agrupar también los pueblos.

### 2026-09-19 · L · Pruebas (unitarias, integración real y humo de UI)

**Encargo de Javi**: *"valida todo con pruebas reales, puedes incluso desarrollar
tests para validar cada aspecto y corroborar que funciona como se espera"*.
Todo lo que hay aquí es real: sin mocks, sin fixtures de red, sin stubs.

**Qué hay**

- `vitest.config.mts` — tres proyectos con alias `@/`:
  - **`unit`** (`tests/unit/**`, node, sin red, < 0,5 s).
  - **`integracion`** (`tests/integracion/**`, contra `ATALAYA_URL ?? http://localhost:3100`,
    timeouts de 5 min, un solo worker, sin paralelismo).
  - **`ui`** (`tests/ui/**`, Playwright + Chromium; si no está instalado se degrada
    a comprobar el HTML del SSR y lo dice, no falla).
- `tests/preparar-entorno.ts` — carga `.env.local` en `process.env` (Next lo hace
  solo; vitest no). No imprime ninguna clave.
- `tests/tsconfig.json` + `npm run test:tipos` — el `tsconfig.json` de la raíz
  excluye `tests/` (lo hizo la orquestadora para que `next build` no se rompiera),
  así que el type-check de las pruebas va aparte. **Está en verde.**
- `tests/unit/ayudas/dominio.ts` — fábricas de `Incendio`, `Meteo`, `Combustible`,
  `Poblacion`, `Decision`, `Accion` y `Unidad` completos según el contrato.
- `tests/integracion/ayudas.ts` — `api()` con reintentos ante errores de
  compilación en caliente (otros constructores editan mientras corren las
  pruebas), `esperarHasta(cond, ms)`, `esperarValor(sonda, ms)`, `snapshot()`,
  `ejecucionNueva()`, `declararFoco()` y `medir()`, que imprime cada tiempo
  medido y, con `ATALAYA_MEDIDAS=<fichero>`, lo deja también en disco.
- `docs/PRUEBAS.md` — cómo se ejecuta cada nivel, qué cubre cada prueba, la tabla
  verde/rojo de la última ejecución con tiempos reales, y "Fallos encontrados".
- `package.json`: solo los scripts `test`, `test:unit`, `test:integracion`,
  `test:ui` y `test:tipos`, más las devDependencies `vitest`, `vite` y
  `playwright`. **No he tocado una sola línea de código de producción.**

**Dependencias nuevas de desarrollo**: `vitest` 5.0.1, `vite` (peer suyo) y
`playwright` + Chromium. Instaladas con `--legacy-peer-deps`: vitest 5 declara
`peerOptional @types/node "^22 || >=24"` y el árbol resolvía 26.6.2, y npm lo
rechazaba. No entran en el build de producción.

**Última ejecución completa (2026-09-19 07:11–07:20), código de salida 0:**

| Batería | Resultado | Duración |
|---|---|---:|
| `unit` | 🟢 **157 pasan**, 4 saltadas (fallo L-1) | 0,40 s |
| `integracion` | 🟢 **19 pasan**, 1 fallo esperado (`it.fails`, fallo L-3) | 456,0 s |
| `ui` (Chromium) | 🟢 **15 pasan** | 60,2 s |
| `test:tipos` · `eslint tests` | 🟢 sin errores ni avisos | — |

**Seis fallos encontrados, ninguno arreglado por mí** (detalle y reproducción en
`docs/PRUEBAS.md` §4, peticiones arriba):

| | Qué | Dueño |
|---|---|---|
| L-1 | `familiaCanal` sin `export`: la regla "una noticia no confirma otra noticia" no se puede probar | D |
| L-2 | `esquemaJson`/`endurecer` sin `export` (menor) | C |
| L-3 | `completarTexto` no propaga `permitirEnPausa` → el conocimiento da 503 en pausa | C, J |
| L-4 | En pausa se siguen completando llamadas a la IA (0-3 en 20 s) | J |
| L-5 | Pausar **escala a un humano para siempre** decisiones autónomas en vuelo | J, A |
| L-6 | Pausar 3 veces **desactiva** el vigía de cámaras y el asesor legal | J, A |

**L-4, L-5 y L-6 son el mismo problema de fondo**: un `AbortError` provocado por
el propio mando al pulsar "Parar" se trata como una avería. J ya aplicó el
criterio bueno en un sitio (bug J-11, `esAborto(e)`); falta en el contador de
errores del agente, en la escalada del supervisor y en `completarTexto`.

Además, tres latencias medidas que no son fallos pero se ven en la demo: el
comunicado (21 s – 5,5 min), el aviso a la población (32 s – 3,5 min) y la
replanificación tras el giro del viento (14 s – 2 min). Están en `docs/PRUEBAS.md`
§4 como V-1, V-2 y V-3, con todas las tandas.

**Convivencia**: las pruebas de integración crean una ejecución nueva en `:3100`
y un foco en 39,79/−1,05 (Tuéjar). **Siempre devuelven el mundo en marcha, sin
viento forzado y con la política original** (`try/finally` + `afterAll`), porque
el servidor es compartido. He dejado el servidor comprobado al terminar:
`pausados: 0`, `enError: []`, mundo en marcha, política de fábrica. No tocan
Supabase. No he arrancado `next dev` ni `next build`, ni he mirado el `:3000` de
Javi. **Ningún commit.**


### 2026-09-19 · Sesión orquestadora · Segunda ronda de integración (07:45)

Entregas G–L integradas; `next build` limpio; producción reiniciada en :3000 (`next start`); servidor de
desarrollo compartido en :3100 (`next dev`, sin persistencia). Correcciones propias de esta ronda:
ataque inicial autónomo con supervisión a posteriori (`orquestador.ts`), avisos preventivos y comunicados
informativos autónomos (`politica-defecto.ts`, `proteccion-poblacion.ts`, `portavoz.ts`), pausa global real
(`orquestador.ts`, `reloj.ts`, `llm.ts` con `permitirEnPausa`, abortos no cuentan como errores, evaluaciones
aplazadas se reanudan), viento forzado (`viento-forzado.ts`, `/api/focos/[id]/viento`, `/api/viento`),
focos de prensa con datos de la fuente (`verificador.ts`, `prensaRedes.ts`, `declararFoco`), política
guardada por "sistema" no pisa la de fábrica (`repositorio.ts`), `estadoAviso: "sin_respuesta"` cuando
fallan todos los canales (`ejecutor.ts`), estado "fusionado" y `contencion` en el contrato,
`tsconfig.json` excluye `tests/`. Pruebas: `npm test`.

### 2026-09-19 · N · Pulido de interfaz (mapa, enlaces a fuentes, barrido sin cabeza)

**Hecho.** (1) **"Ver todo" arreglado**: el encuadre ya no depende de un efecto con sello
(`Encuadre` en `components/mapa/MapaCliente.tsx`); ahora la instancia de Leaflet vive en el
componente (`ref={setMapa}`) y `encuadrarTodo()` llama a `fitBounds` en el propio clic, así que
obedece siempre —también después de arrastrar o hacer zoom a mano—, y si el mapa ya estaba
encuadrado en los focos sale a España entera (nunca se queda "sin hacer nada"); se anuncia con
`aria-live` y tiene atajo **V** (en `DialogoAtajos` y en el `title` del botón). "Centrar en el mapa"
de las fichas hace `map.stop()` antes del `setView` y sigue mandando sobre el gesto del usuario.
(2) **Enlaces a las fuentes** con un solo estilo: nuevos `components/ui/Enlace.tsx`
(`EnlaceExterno`/`EnlaceInterno`, `target="_blank"`, `rel="noopener noreferrer"`, icono y aviso para
lectores) y `lib/cliente/enlaces.ts` (`urlSegura`, `urlOsm`, `urlOsmPunto`, `urlConocimiento`,
`dominio`). Enlazan: "Según la fuente (…)" y la cabecera de cada foco (`fuenteUrl`), meteo
(`meteo.url` de Open-Meteo), evidencias de las decisiones (`Evidencia.url`), fundamentos legales
(→ `/conocimiento?documento=…&chunk=…#chunk`), observaciones (`urlFuente`) en el registro y en un
desplegable "Avisos y fuentes" de cada ficha, pueblos y unidades/bases (id OSM →
openstreetmap.org), cámaras (imagen original + ubicación), informes y portal ciudadano. **Sin URL
no se pinta enlace**: `urlSegura` descarta vacíos, `javascript:` y todo lo que no parsee.
(3) **Barrido con Playwright** contra `:3100` de `/`, `/auditoria`, `/agentes/coordinador`,
`/incidencias`, `/conocimiento`, `/informes`, `/aprendizaje`, `/politica`, `/publico`, `/parte` y
`/movil`: consola limpia y sin scroll horizontal. Corregidos: el warning "Encountered a script tag
while rendering React component" (`app/layout.tsx` pasa a `next/script` con
`strategy="beforeInteractive"`, según `node_modules/next/dist/docs/01-app/03-api-reference/02-components/script.md`)
y un **fallo real que rompía `/auditoria?decision=…`**: el núcleo sirve `acciones` planas y
`trazaOrigen`/`leccionesAplicadas`, y `CadenaAuditoria` esperaba `{accion, informe}[]` → pantalla en
blanco; ahora `obtenerAuditoria` normaliza la respuesta (`normalizarCadenaAuditoria` en
`lib/cliente/api.ts`) y una lista vacía del núcleo ya no borra lo reconstruido del snapshot.
También dos errores de ESLint que arrastraba `components/publico` (`MapaFocos`: función usada antes
de declararse; `PortalCiudadano`: `setState` síncrono dentro de un efecto).
`npx tsc --noEmit` y `npx eslint components/mapa components/sala app/page.tsx lib/cliente
components/publico app/publico components/ui app/layout.tsx` limpios (los únicos errores de tsc son
los de `lib/fuentes/overpass.ts`, ajenos).

**Pendiente / para otros.** (a) **C**: `/conocimiento` todavía ignora `?documento=&chunk=`; el enlace
ya llega con esos parámetros y el ancla `#<chunkId>` — si los lee, el fundamento queda resaltado (hoy
el enlace abre la biblioteca, nunca queda roto). (b) **D**: `/api/comunicados` no envía
`fuenteDeteccion`/`fuenteUrl` de cada foco; `FocoPublico` ya los admite como **opcionales** y el
portal pinta la fuente en cuanto vengan. (c) Queda por comprobar en vivo el camino Aprobar/Denegar
desde la tarjeta: en las tres pasadas las decisiones salieron `autonoma`/`propuesta` y nunca llegó a
haber una `pendiente_humano` dentro de la ventana de prueba (el foco sí se declaró por la interfaz y
`/auditoria?decision=…` quedó verificada). Durante la prueba se puso `desplegar_unidad` en modo
"humano" y **se ha restaurado a "supervisada"** (comprobado con `GET /api/politica`).
