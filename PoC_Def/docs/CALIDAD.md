# Atalaya Incendios · Control de calidad del backend (constructor J)

Fecha: **2026-09-19**. Servidor de pruebas: **http://localhost:3100** (`next dev` compartido,
agentes vivos, sin persistencia porque arrancó antes de que `.env.local` tuviera claves).
Nunca se reinició ni se tocó el servidor de producción de Javi (`:3000`), ni se lanzó otro
`next dev`, ni se ejecutó `next build`. Supabase se consultó **solo en lectura** con un
script Node aparte.

Todas las cifras de este documento están medidas, no estimadas. Los scripts de prueba
quedaron en el scratchpad de la sesión (`e2e.mjs`, `verif.mjs`, `pob.mjs`, `final.mjs`,
`conf.mjs`, `supa.mjs`).

---

## 1. Qué se probó y con qué resultado

### 1.1 Extremo a extremo: nueva ejecución → foco → ataque inicial autónomo

Punto declarado: **40,4359 / −4,9968** (Hoyocasero, Ávila) y, en las pruebas de población,
**39,79 / −1,05** (Tuéjar, Valencia).

| Hito | Tiempo real medido | Detalle |
|---|---:|---|
| `POST /api/ejecucion {nueva}` → estado limpio | < 0,1 s | 0 incendios, 0 unidades, 0 decisiones, 0 informes. **La persistencia se re-engancha** (`engancharPersistencia(nuevo)`). |
| `POST /api/focos` responde | 0,04 s | El enriquecimiento sigue en segundo plano, como está diseñado. |
| Decisión "Ataque inicial" propuesta | **+3 s** (t=15,4 s) | `competencia: autonoma`, riesgo 25, `parametros.ataqueInicial: true`. |
| Primera unidad **en ruta** | **+3 s** (t=15,4 s) | `B.R.I.F. de La Iglesuela del Tiétar · BUL`, tipo `bomberos`. |
| Repetición (Tuéjar) | **+5 s** (t=17,4 s) | Mismo comportamiento. |

Exigencia del encargo: decisión autónoma ejecutada y ≥ 1 unidad de extinción en ruta en
≤ 40 s. **Cumplido con mucho margen (3-5 s)**, porque el coordinador usa el plan
determinista de ataque inicial y no espera al modelo (el modelo refina en el ciclo
siguiente).

**Candidatas y elección de la unidad.** Catálogo generado por Overpass para ese foco:
`bomberos 10, guardia_civil 8, policia 8, ambulancia 15` (41 unidades). Distancias en línea
recta de los medios de extinción: **27 km las dos B.R.I.F.**, las siguientes a 314 km. La
unidad elegida fue de extinción (`bomberos`), como exige el criterio "< 60 km". Verificado
que `candidatas()` mete siempre los medios de extinción más cercanos aunque haya
ambulancias más próximas en línea recta: con 15 ambulancias en el catálogo, las BRIF
entraron igualmente en la lista OSRM.

### 1.2 Velocidad de las unidades (OSRM × 1,25)

Medido sobre 3 unidades durante 30 s reales (= 6 min de mundo, factor ×12):

| Unidad | Δ progreso | Metros | km/h de mundo | Media OSRM × 1,25 | Nominal |
|---|---:|---:|---:|---:|---:|
| `osm:way/361488277:BUL` | 0,0965 | 6.660 m | **66,6** | 66,6 | 70 |
| `osm:way/361488277:BRP` | 0,1031 | 7.000 m | **70,0** | 74,9 (recortado a nominal) | 70 |
| `osm:node/13004156501:BUL` | 0,0167 | 7.008 m | **70,1** | 100,5 (recortado a nominal) | 70 |

**Correcto**: la velocidad es exactamente la media real de la ruta OSRM × 1,25, con el tope
de la velocidad nominal de la unidad. Nada inventado.

### 1.3 Pausa global ("Parar")

Protocolo: contar líneas `[llm]` en `/tmp/atalaya-dev.log` antes y después de 30 s de pausa.

| Medición | Líneas `[llm]` **completadas** durante la pausa |
|---|---:|
| Antes de mis correcciones | **5** (23.472 ms, 24.920 ms, 12.623 ms, 25.114 ms, 22.888 ms) |
| Después de las correcciones | **2**, y aparecen abortos reales en el registro ("Request was aborted." en `vigia_camaras` y `coordinador`) |

El tick sigue corriendo (12 → 18) pero **no ejecuta ningún ciclo**: `agentes ocupados: []`,
todos los agentes en estado `pausado`, `ahoraMundo` congelado. Eso ya estaba bien.

Lo que estaba mal y he corregido (bug J-2 abajo): una llamada a la IA **ya lanzada** no se
cortaba, y una llamada que esperaba turno en la cola de concurrencia pasaba el control de
pausa *antes* de entrar en la cola y se ejecutaba después.

> **Caveat honesto**: las 2 llamadas que aún se completaron las lanzó la instancia del
> módulo `lib/ia/llm.ts` **anterior al parche**, que el `next dev` con recarga en caliente
> sigue teniendo viva dentro del bucle del orquestador (el `setInterval` capturó el grafo
> de módulos antiguo). El registro `enVuelo` vive en `globalThis`, así que **tras un
> reinicio limpio del proceso el resultado esperado es 0**. No reinicié `:3100` para no
> tumbar el trabajo de G, H e I. **Queda pendiente de confirmar con el servidor reiniciado.**

### 1.4 Reanudar

Tras `POST /api/reloj {pausado:false}`: tick sigue, unidades siguen avanzando por su ruta
desde donde estaban (no hay salto), `agentes en error: []`, decisiones intactas. Correcto.

### 1.5 Viento forzado por el mando (función nueva de la orquestadora)

`POST /api/focos/<id>/viento {direccionGrados:315, vientoKmh:45, rachasKmh:70}` → 200.

| | Antes | Después (40 s) |
|---|---|---|
| Meteo del foco | N, 6,3 km/h | **NO, 45 km/h** (`meteoForzada` con `fijadoPor: "mando"`) |
| Frente | 183° (S), 1,15 m/min | **135° (SE), 7,9 m/min** (×6,8 más rápido) |
| Evento | — | `viento_gira`: "mando fija el viento en Tuéjar J final: NO a 45 km/h (antes N 6 km/h)" |

`DELETE /api/focos/<id>/viento` → 200, vuelve la previsión real. **Funciona.**

**No verificado**: no vi ninguna decisión nueva con `sustituyeA` en los 40 s de observación.
El evento se emite y despierta al coordinador (`despiertaCon` incluye `viento_gira`), y el
frente sí se recalcula; pero con un ciclo de coordinador de ~25 s por llamada y 40 s de
ventana no da tiempo a confirmarlo. **Riesgo pendiente R-6.**

### 1.6 Reacción autónoma a poblaciones en riesgo (queja de Javi sobre Tuéjar)

Reproducido el caso exacto: foco en 39,79/−1,05, **Tuéjar a 2,9 km, 1.221 habitantes, 4
colectivos vulnerables (camping, colegio, residencia)**.

- **Antes de mis correcciones**: en 168 s el agente `proteccion_poblacion` **no proponía
  nada**. No porque el agente fallara, sino porque de 89 poblaciones **ninguna tenía riesgo
  medio o superior**: Tuéjar salía **`riesgo: "bajo"`** con `etaFrenteMin: 2554` (42 h),
  porque con viento flojo (6 km/h) y humedad 95 % el frente casi no avanza y el riesgo se
  calcula **solo** a partir de la ETA. El agente filtraba por `riesgo >= medio` y Tuéjar
  nunca entraba.
- **Después**: `proteccion_poblacion` propone en **+80 s** ("Aviso preventivo a Tuéjar por
  incendio a 2,9 km") y también para Chelva. Corregido en el agente (bug J-5); la causa raíz
  está en `lib/simulacion/propagacion.ts`, que ahora es de **K** → petición abierta en
  `docs/REPARTO.md`.

### 1.6.bis Comprobación tras corregir la política (ejecución "Calidad J · confirmación")

Con la política ya sincronizada con la de fábrica:

| Hito | Tiempo | Resultado |
|---|---:|---|
| Ataque inicial | +5 s | `ejecutada`, **riesgo 25, `autonoma`**, 2 despliegues con `exito: true` |
| Aviso a Tuéjar | +100 s | "Aviso preventivo al ayuntamiento de Tuéjar (riesgo inminente…)", **riesgo 20, `autonoma`** (antes: riesgo 45, `supervisada`) |
| Comunicado del portavoz | — | **No se publicó ninguno** |

**Hallazgo sobre los comunicados autónomos.** La política ya es correcta
(`publicar_comunicado: autonoma/25`), pero el portavoz no llega a proponer nada: su
`motivoParaComunicar` exige `poblaciones en riesgo alto/inminente` **o** `nivelGravedad ≥ 1`
**o** `areaHa > 20`. Un foco recién declarado tiene 1,3 ha, nivel 0 y —por el riesgo R-1—
ninguna población en "alto". Es decir, **tras el ataque inicial NO se publica comunicado**,
al contrario de lo que se esperaba. No lo he tocado porque el criterio es defendible (no
inundar el portal ciudadano por cada humo), pero hay que decidirlo antes de la demo: o se
baja el umbral de `areaHa`, o se arregla R-1 (que es lo que de verdad lo desbloquea, porque
entonces Tuéjar sí sería "alto").

### 1.7 Auditoría

`GET /api/auditoria?decisionId=dec-mu7ukiik-zqtsj` → **200** con la cadena completa:

```
agente=coordinador · origenTraza=memoria · trazaLlamadas=8 · historial=4
acciones=2 (2 con acta) · informes=7 (0 sin huella) · eventos=8
fundamentos=7 · evaluacion=sí
```

`GET /api/auditoria/exportar?decisionId=…` → **200**, `Content-Disposition: attachment;
filename="expediente-dec-…-2026-09-19-03-51-34.md"`, **245.063 caracteres** de expediente.

Barridos de comprobación sobre todo el estado:

| Comprobación | Resultado |
|---|---|
| Acciones ejecutadas **sin** `informeId` | **0** |
| Informes **sin** `huella` | **0** |
| Decisiones sin `informeIds` | Solo una recién creada (el acta es asíncrona y tarda lo que tarde la narrativa; a los pocos segundos ya la tiene) |
| Actas **duplicadas** (misma decisión + tipo + estado) | **2 pares** → bug J-1, corregido |
| `historial` completo | `propuesta → aprobada → ejecutando → ejecutada`, 4 entradas, cada una con acta |

### 1.8 Latencia por agente

Medido con `llamadasIA.latenciaMs` de las trazas de `/api/estado`.

| Agente | `tiempoMaximoSeg` | Llamadas | Latencia media | Máxima | Ciclos cancelados |
|---|---:|---:|---:|---:|---:|
| `coordinador` | 240 s | 8 | **24,6 s** | 38,8 s | 0 |
| `proteccion_poblacion` | 180 s (antes: 90 s por defecto) | 6 | **23,4 s** | 54,7 s | 0 (**antes: 1**, a los 90.194 ms) |
| `memoria` | 240 s (antes: 90 s) | — | — | — | 0 (**antes: 1**, a los 90.160 ms) |
| `supervisor` | 120 s (señal propia) | — | — | — | 0 |
| `asesor_legal` | 120 s | — | — | — | 0 |
| `portavoz` | 180 s (nuevo) | — | — | — | 0 |

El modelo de razonamiento (`glm5.3-flash`) está de media en **17,1 s** y en **24-25 s**
cuando el prompt lleva el contexto completo de un foco. Contadores globales de
`/api/salud`: 159 llamadas de razonamiento, 378 k tokens de entrada, 433 k de salida.

**Problema encontrado**: `proteccion_poblacion` trataba 4 pueblos por ciclo × ~25 s = hasta
100 s, con el límite por defecto de 90 s. Al saltar el límite, `Promise.race` rechaza y el
orquestador **descarta el `ResultadoCiclo` entero**, así que se perdían también las
decisiones ya redactadas en ese ciclo. Corregido (bug J-4).

### 1.9 Servicios (`/api/salud`)

Antes solo había `servicios` (los que marcan los agentes al usarlos) y **faltaba por
completo el bloque de IA**. Ahora:

```jsonc
"ia": { "ok": true, "proveedor": "helmcode",
        "modelos": {"razonamiento":"glm5.3-flash","rapido":"qwen3.6","vision":"qwen3.6"},
        "detalle": "helmcode · … · cola 3/4 en curso, 0 esperando",
        "cola": {"enCurso":3,"esperando":0,"maximo":4},
        "porPapel": { "razonamiento": {"llamadas":159,"errores":40,"latenciaMediaMs":17123}, … } }
"integraciones": {
  "HappyRobot": {"ok": false, "detalle": "falta el workflow de voz · Falta HAPPYROBOT_WORKFLOW_SLUG_VOZ · …", "canales":[…]},
  "Telegram":   {"ok": false, "detalle": "Telegram: falta TELEGRAM_BOT_TOKEN"},
  "Supabase":   {"ok": false, "detalle": "Sin SUPABASE_URL o sin SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY: …"},
  "OSRM":       {"ok": true,  "detalle": "N ruta(s) reales calculadas en esta ejecución"} }
```

Servicios que ya se reflejaban bien: Nominatim, Overpass, Open-Meteo, Open-Meteo elevación,
Cámaras DGT, Avisos meteorológicos (Meteoalarm), Peligro por zonas, Exa, Google News,
Bluesky, Conocimiento (RAG), Visión, Supervisor, Redactor de informes, NASA FIRMS (en rojo:
falta `FIRMS_MAP_KEY`).

### 1.10 Persistencia (Supabase, solo lectura)

Comprobado con un script Node aparte contra la API REST, sin arrancar Next y **sin
escribir nada**. Todas las tablas existen y tienen datos:

| Tabla | Filas | | Tabla | Filas |
|---|---:|---|---|---:|
| `ejecuciones` | 13 | | `informes` | 229 |
| `incendios` | 47 | | `comunicados` | 10 |
| `unidades` | 532 | | `eventos` | 753 |
| `poblaciones` | 2.986 | | `trazas` | **1.621** |
| `observaciones` | 75 | | `lecciones` | 62 |
| `decisiones` | 70 | | `documentos` / `chunks` | 5 / 582 |
| `politica` | 1 | | `camaras_analisis` | 31 |
| **`tickets`** | **404 — la tabla NO existe** | | | |

La ejecución activa en base (`ejec-mu7uak3m-8ouxw`) rehidrata correctamente: 3 incendios,
41 unidades, 269 poblaciones, 5 decisiones, 43 informes, 239 eventos, 613 trazas. Una
decisión de muestra trae `informeIds: 6`, `trazaId`, `historial: 4` y 3 acciones → la cadena
de auditoría se reconstruye entera tras un reinicio.

`/api/salud` de **`:3000` (el de Javi) confirma que la persistencia funciona**: `Supabase:
{"ok": true, "detalle": "2 lotes escritos"}` y `persistidos: {trazas: 613, informes: 43}`.
`nuevaEjecucion` sí engancha la persistencia (`engancharPersistencia(nuevo)`), verificado en
código y en la práctica (13 ejecuciones distintas en la tabla).

**Matiz importante**: `SUPABASE_SERVICE_ROLE_KEY` está **vacía** en `.env.local`. Funciona
porque `lib/db/cliente.ts` cae a `SUPABASE_ANON_KEY` (46 caracteres, tipo publicable) y las
tablas no tienen RLS que lo impida. El mensaje de error decía que faltaba la clave de
servicio y era engañoso → corregido (bug J-8). Ver riesgo **R-3**.

### 1.11 Tipos y lint

```
npx tsc --noEmit                    → 0 errores en lib/**, app/api/**, scripts/**
npx eslint lib app/api              → 0 errores en mi ámbito
```

- Encontrado y corregido un `import` duplicado de `EstadoIncendio` en
  `lib/motor/orquestador.ts` que **rompía la compilación de todo el proyecto** (bug J-0).
- Quedan 4 avisos (`warning`) de directivas `eslint-disable no-var` no usadas en los bloques
  `declare global { var … }` de `estado.ts`, `orquestador.ts`, `persistencia.ts` y
  `reloj.ts`. Los dejo a propósito: son defensivos y quitarlos rompería el lint si la
  configuración vuelve a activar la regla.
- Los 2 **errores** de `react-hooks/set-state-in-effect` en `lib/cliente/useTema.ts` y los
  de `components/mapa/MapaCliente.tsx` son de la sala de mando (constructor H), no míos.

---

## 2. Bugs encontrados y corregidos

### M-1 · `lib/fuentes/overpass.ts` · Overpass caído dejaba el foco entero sin datos

**Causa.** `overpass-api.de` devuelve `connection refused` en sus dos IP (65.109.112.52 y
162.55.144.139) desde la red de la demo; el único respaldo configurado, `kumi.systems`, conecta pero
no responde (>60 s). Las dos consultas iban en serie y, al fallar, el foco se quedaba a la vez sin
unidades, sin poblaciones y sin combustible. Es la causa raíz de los fallos (a), (b), (e), (f) y (g)
de la pasada de las 08:02.

**Arreglo.** Lista de espejos ampliada y reordenada con `maps.mail.ru` —el único sano hoy: 2,5-7,4 s
por consulta en frío— y `private.coffee` de última reserva; timeout por consulta de 45 s a 25 s;
dos vueltas completas a la lista con retroceso de 2 s. Se descartó `overpass.osm.ch`: responde 200 en
0,4 s pero con la base VACÍA (`timestamp_osm_base: "117119"`, cero elementos), que es peor que un
error porque se tomaría por bueno; por eso `validar()` rechaza toda respuesta cuyo sello no sea una
fecha de los últimos 30 días.

### M-2 · `lib/fuentes/overpass.ts` + `lib/motor/enriquecer.ts` · una sola consulta para todo

**Causa.** Pueblos y parques viajaban en la misma consulta, así que el ataque inicial (que solo
necesita los parques) esperaba también a los pueblos, y un fallo se llevaba las dos cosas por delante.

**Arreglo.** Tres consultas separadas (`poblacionesCercanas`, `mediosCercanos`, `combustibleCercano`),
cada una con su caché por celda de 0,01° y su propio fallo. El enriquecimiento lanza en paralelo
Nominatim, medios, pueblos, elevación, meteo y cámaras (fuentes distintas, no compiten), y emite
`incendio_actualizado` con `datos.fase = "medios"` en cuanto hay unidades, sin esperar al resto.
MEDIDO en :3100 tras el cambio: municipio 4 s, poblaciones 12 s, unidades 21 s, "Ataque inicial" en
estado `ejecutando` a los 25 s.

### M-3 · `lib/motor/enriquecer.ts` · un fallo de Overpass era definitivo

**Causa.** `enriquecerIncendio` se ejecuta una sola vez al declarar el foco. Si Overpass fallaba en
ese instante, el foco se quedaba sin unidades para siempre y ningún ciclo lo arreglaba.

**Arreglo.** `programarReintento`: hasta tres reintentos con retroceso 30 s / 60 s / 120 s, cada uno
anunciado con un evento visible, y un evento `critico` si se agotan. El evento final de carga lleva
`datos.completo` y `datos.fallos` para que se vea en la sala qué falta.

### M-4 · `lib/ia/llm.ts` · la cadena de mando esperaba detrás de la percepción

**Causa.** Una sola cola FIFO con `LLM_CONCURRENCIA=4`. Con 16 agentes vivos, la evaluación del
supervisor de una decisión de ataque inicial entraba detrás de las llamadas de prensa y de las
cámaras; en el registro se midieron esperas de 60-190 s.

**Arreglo.** Dos colas. `prioridad: "alta"` en supervisor, asesor legal, coordinador, protección a la
población, portavoz y la consulta del conocimiento (hay una persona esperando); el resto sigue en la
cola normal. Dentro de cada cola el orden es estricto, así que nadie se queda atrás indefinidamente.
`estadoColaLLM()` publica ahora `esperandoAlta` y `esperandoNormal`.

### M-5 · `lib/agentes/comunicacion/portavoz.ts` · el comunicado esperaba a sus traducciones

**Causa.** Un único `completarJson` de 2.200 tokens escribía el castellano y las traducciones. El
comunicado no existía hasta que terminaba todo, y eso fijaba el plazo del primer boletín.

**Arreglo.** Dos llamadas: el comunicado en castellano con el modelo de razonamiento y 1.400 tokens
(es lo que la ley exige y lo que marca el plazo), y las traducciones aparte con el papel `rapido`,
lanzadas en segundo plano sobre el comunicado ya guardado. Si la traducción falla, el comunicado sale
igual y queda anotado el motivo.

### M-6 · `lib/agentes/comunicacion/portavoz.ts` · un comunicado escalado se quedaba muerto

**Causa.** Si el supervisor escalaba el comunicado (puntuación por debajo del mínimo), el portavoz no
volvía a intentarlo: quedaba esperando a un humano sin que nadie hubiera atendido la objeción.

**Arreglo.** El portavoz se despierta con `decision_escalada` y reescribe UNA vez atendiendo al
`motivoEscalado`, con una decisión nueva que lleva `sustituyeA` y `motivoReplanificacion`; la versión
vieja caduca. Si la reescritura también se escala, ahí se queda: eso sí es trabajo del humano.

### M-7 · `lib/agentes/comunicacion/portavoz.ts` · el viento forzado salía como previsión real

**Causa.** Con `meteoForzada` puesta, el comunicado presentaba el viento del ejercicio como la
previsión oficial. El supervisor lo penalizaba por incoherente (el parte de Open-Meteo decía otra
cosa) y con razón, y el comunicado no se publicaba.

**Arreglo.** Cuando hay `meteoForzada`, el prompt obliga a decirlo con las palabras "ejercicio del
mando" / "escenario de trabajo" y lo repite como regla del sistema.

### M-8 · `lib/agentes/planificacion/coordinador.ts` · replanificar sin dejar rastro

**Causa.** Tras un `viento_gira`, si el modelo concluía que no había nada que cambiar (listas
vacías), el coordinador no registraba NI decisión NI evento. Desde fuera era indistinguible de "no se
ha enterado del giro", y la prueba (e) agotaba sus 240 s esperando algo que no iba a llegar.

**Arreglo.** Si hubo replanificación y no salió ninguna decisión, se registra un evento `agente` con
`datos.replanificacion = true`, el motivo del giro y las unidades que se mantienen. La prueba (e)
acepta ahora los dos desenlaces, pero sigue exigiendo `sustituyeA` cuando había un plan vivo.

### M-9 · `tests/integracion/00-escenario.test.ts` · (f) leía el estado antes de tiempo

**Causa.** La prueba (f) falló en 16 ms con `expected 0 >= 1`: leía `s.poblaciones` justo después de
que fallara la prueba anterior, sin esperar a que el entorno estuviera cargado.

**Arreglo.** `esperarEntornoCargado(incendioId)` en `tests/integracion/ayudas.ts`, que espera al
evento `incendio_actualizado` con `datos.fase = "completo"` leyéndolo de `/api/eventos` (no del
snapshot, que solo lleva los 200 últimos y en una tanda larga ya se ha ido).

### J-0 · `lib/motor/orquestador.ts:18` — import duplicado que tumbaba la compilación
**Causa**: una edición concurrente dejó `EstadoIncendio` importado dos veces en el mismo
bloque `import type`. `npx tsc --noEmit` daba `TS2300: Duplicate identifier` y `next build`
habría fallado. **Arreglo**: eliminada la línea repetida. **Impacto**: bloqueante para el
despliegue.

### J-1 · `lib/motor/orquestador.ts` (`aprobarDecision` / `generarInforme`) — acta duplicada y `informeId` pisado
**Causa**: al terminar de ejecutar una decisión, `aprobarDecision` llamaba a
`void generarInforme(id)`, que pedía **otro** informe al redactor y hacía
`estado.actualizar(decisiones, id, {informeId: guardado.id})`. Pero el cambio de estado a
`ejecutada` que se acaba de hacer ya había disparado `generarActaDecision`, que escribe el
acta sellada (huella, `trazaId`, `agenteId`, `estadoDecision`) y la engancha a `informeIds`.
Resultado medido: **dos actas del mismo estado "ejecutada" por decisión**
(`inf_mu7um59m_60v2w` + `inf-mu7um59n-x8i78`), el `informeId` de la decisión apuntando a la
que **no** está en `informeIds`, y **una llamada de razonamiento de ~25 s desperdiciada por
decisión**. **Arreglo**: eliminada la llamada y la función; el acta del estado final ya la
escribe `cambiarEstadoDecision`. **Impacto**: auditoría (el expediente mostraba dos versiones
del mismo hecho) + latencia.

### J-2 · `lib/ia/llm.ts` + `lib/motor/reloj.ts` + `lib/motor/orquestador.ts` — la pausa no paraba las llamadas ya lanzadas
**Causa**: dos agujeros. (a) `llamar()` comprobaba `mundoEnPausa()` **antes** de pedir turno
en la cola de concurrencia; una petición que esperaba turno 25 s pasaba el control y se
ejecutaba ya en pausa. (b) Las peticiones en vuelo no tenían ningún `AbortController`
accesible desde fuera: el trabajo lanzado en segundo plano (actas, supervisor a posteriori)
usa `new AbortController().signal` que nunca se aborta, así que seguía hasta el final.
Medido: **5 respuestas completas durante 30 s de "pausa"**. **Arreglo**: registro
`enVuelo: Set<AbortController>` en `globalThis`, cada petición registra su controlador;
`abortarLlamadasIA()` las corta todas y la llaman `pausar()` (inmediato) y
`aplicarPausaGlobal()` (red de seguridad); segunda comprobación de pausa al salir de la cola.
`permitirEnPausa` (consulta del conocimiento) queda exento. **Impacto**: "Parar" ahora para
de verdad, que es un requisito del jurado sobre control humano.

### J-3 · `lib/motor/traza.ts` + `orquestador.ts` — las llamadas a la IA se atribuían al agente equivocado
**Causa**: `AsyncLocalStorage` propaga el contexto de traza a las promesas lanzadas con
`void`. Las actas (redactor), la evaluación del supervisor y la aprobación autónoma se
lanzan así desde dentro del ciclo del agente que propuso la decisión, de modo que sus
llamadas a la IA se anotaban en **la traza del coordinador**. Medido antes: coordinador con
11 llamadas y latencia media de 24.961 ms; **supervisor, asesor_legal, portavoz y redactor
con 0 llamadas** aunque sí llamaban al modelo. Con ese dato era imposible cumplir el encargo
de medir la latencia por agente. **Arreglo**: `sinTraza()` (`AsyncLocalStorage.exit`) en
`traza.ts`, aplicado a las actas y a la aprobación autónoma; el supervisor pasa a ejecutarse
dentro de **su propia traza** (`ejecutarConTraza(estado, "supervisor", …)`) para que su
latencia se vea en `/agentes/supervisor`. Tras el arreglo el coordinador bajó a 8 llamadas.
**Impacto**: diagnóstico y auditoría.

### J-4 · Agentes sin tope de tiempo propio — ciclos cancelados y trabajo perdido
**Causa**: solo `coordinador` tenía `tiempoMaximoSeg`. `proteccion_poblacion` (4 pueblos ×
~25 s) y `memoria` se comían el límite por defecto de 90 s; la traza salía `cancelado`,
contaba como error **y el `ResultadoCiclo` se descartaba entero**, perdiendo también las
decisiones ya redactadas en ese ciclo. Medido: `cicloMax` 90.194 ms y 90.160 ms.
**Arreglo**: `tiempoMaximoSeg` explícito en `proteccion_poblacion` (180 s), `memoria`
(240 s), `patrones` (150 s) y `portavoz` (180 s); `MAX_POR_CICLO` de
`proteccion_poblacion` de 4 → 2 (el resto entra en el ciclo siguiente, 60 s después).
Además se expone `tiempoMaximoSeg` en `EstadoAgenteApp` (campo nuevo y opcional) y se
rellena en `lib/agentes/registro.ts`, para poder ver desde `/api/estado` por qué una traza
sale "cancelado".

### J-5 · `lib/agentes/planificacion/proteccion-poblacion.ts` — pueblos grandes y vulnerables ignorados
**Causa**: el agente solo miraba poblaciones con `riesgo >= medio`, y el riesgo lo calcula el
modelo de propagación **solo a partir de la ETA del frente**. Con viento flojo, Tuéjar
(1.221 hab, camping + colegio + residencia, a 2,9 km) daba ETA de 42 h → `riesgo: "bajo"` →
"Sin avisar" para siempre. Es literalmente lo que vio Javi. **Arreglo**: se entra en la cola
por riesgo **o** por proximidad sensible (≤ 8 km y con colectivos vulnerables o ≥ 500
habitantes). Verificado: propone el aviso de Tuéjar a los 80 s. La causa raíz sigue en
`riesgoPorEta` → petición a **K**.

### J-6 · Topes de tokens por debajo de lo que necesita un modelo razonador
**Causa**: `verificador` 400, `asesor_legal` 800, `patrones` 900, `memoria` 2.000,
`conocimiento/consulta` 1.800. `glm5.3-flash` y `qwen3.6` razonan antes de contestar: con
esos topes se gastaban el presupuesto pensando y devolvían `content: null`, y `llm.ts` tenía
que **reintentar con el doble de tokens** → el doble de latencia. Visible en el registro:
`glm5.3-flash devolvió contenido vacío tras razonar (1500 tokens de salida, tope 1500)` y
`(2000 tokens, tope 2000)`. **Arreglo**: los cinco a **4.000**. Nota: subir el tope no
encarece la llamada si el modelo termina antes; lo que se ahorra es el reintento entero.

### J-7 · Llamadas a la IA sin señal de aborto
**Causa**: `verificador` y `asesor_legal` llamaban a `completarJson` **sin `signal`**, así
que al pausar el mundo o al agotarse el tiempo del ciclo la petición seguía viva.
**Arreglo**: `signal: ctx.abortSignal` propagado hasta `consultarModelo(…)` y
`revisarLegalidad(decision, signal)`. Repasadas todas las llamadas: las demás ya lo tenían,
salvo `conocimiento/consulta.ts` (es una herramienta del humano, con `permitirEnPausa: true`,
y así debe ser) y `redactor`/`supervisor`, que usan señal propia a propósito
(`AbortSignal.timeout`) porque no pueden morir con el ciclo del agente que los invocó.

### J-8 · Mensaje de Supabase engañoso
**Causa**: `persistencia.ts` y `/api/salud` decían "Sin SUPABASE_URL /
SUPABASE_SERVICE_ROLE_KEY", pero `lib/db/cliente.ts` acepta también `SUPABASE_ANON_KEY` —
que es justo lo que está usando el despliegue real. **Arreglo**: el mensaje nombra las dos
claves, en el mismo orden que el cliente.

### J-9 · `lib/motor/orquestador.ts` (`nuevaEjecucion`) — la política de fábrica no se aplicaba nunca
**Causa**: `nuevaEjecucion` hacía `nuevo.politica = anterior.politica` "porque la política la
fija el humano". Efecto real: cambiar `lib/dominio/politica-defecto.ts` **no tenía ningún
efecto** sobre un servidor en marcha, y un servidor con Supabase recupera para siempre la
política guardada. Medido: la orquestadora pasó `avisar_poblacion` a `autonoma/20` y
`publicar_comunicado` a `autonoma/25`, pero el servidor seguía con `supervisada/45` en los
dos, así que **ni los avisos ni los comunicados salían solos** y la decisión de Tuéjar se
quedó en `pendiente_humano` con riesgo 45. **Arreglo**: solo se arrastra la política si
alguien la ha editado de verdad (`actualizadaPor !== "sistema"`); si sigue siendo la de
fábrica, se recargan los valores del código y se registra un evento visible.

### J-10 · `lib/agentes/analisis/verificador.ts` — dos focos para la misma noticia
**Causa**: `KM_CONFIRMA = 5` para todos los canales. Prensa y redes no traen coordenadas: se
geocodifican por municipio y Nominatim devuelve el **centroide del término**, así que dos
noticias del mismo incendio caen a 7-8 km una de otra y se creaban dos focos. **Arreglo**:
radio de 10 km para los canales `prensa` y `rrss` (tanto para "duplicada" como para
"confirma un foco conocido"), 5 km para el resto. Es la opción conservadora que pedía el
encargo: fusionar, no inventar.

### J-11 · El supervisor se pintaba en rojo al pausar
**Causa**: `.catch((e) => marcarServicio("Supervisor", false, …))` marcaba el servicio como
caído también cuando el error era un `AbortError` de la pausa global. Medido:
`Supervisor=KO` en `/api/salud` justo después de una pausa. **Arreglo**: helper `esAborto(e)`;
un aborto no es una avería.

---

## 3. Tabla de agentes: disparadores → qué produce → qué exige humano

Revisados los 16 uno a uno. `⏱` = cadencia, `⚡` = eventos que lo despiertan.

| Agente | ⏱ | ⚡ Se despierta con | Qué produce solo | Qué exige a un humano |
|---|---:|---|---|---|
| `vigia_camaras` | 20 s | `incendio_nuevo` | Analiza cámaras DGT/Madrid/móvil con visión; **2 positivos seguidos → `Observacion` + `camara_positiva`** | Nada |
| `satelite` | 600 s | — | Focos FIRMS agrupados → `Observacion` + evento `satelite` | Nada |
| `prensa_redes` | 180 s | `incendio_nuevo` | Exa + Google News + Bluesky (solo últimos 15 días) → `Observacion` de canal `prensa`/`rrss` (confianza ≤ 0,7) | Nada |
| `centralita` | 30 s | — (entra por webhook) | Extrae lugar/gravedad de llamadas, SMS, email, Telegram y web → `Observacion` | Nada |
| `meteorologo` | 60 s | `incendio_nuevo` | Meteo por foco, avisos, índice de peligro, 30 zonas de España; **giro > 30° → `viento_gira`**, subida → `peligro_sube` | Nada |
| `verificador` | 45 s | `observacion`, `satelite`, `camara_positiva` | Deduplica, cruza fuentes, sube confianza, **crea o confirma el foco** | Nada |
| `propagacion` | 30 s | `viento_gira`, `incendio_actualizado` | Perímetro, frente, predicción +1/+3/+6 h, ETA y riesgo por pueblo | Nada |
| `patrones` | 120 s (máx 150 s) | `incendio_nuevo` | Clúster multi-foco, serie sospechosa (SEPRONA), convergencia | Nada |
| `coordinador` | 90 s (máx 240 s) | `incendio_nuevo`, `incendio_actualizado`, `viento_gira`, `peligro_sube`, `unidad_llega`, `decision_denegada` | **Ataque inicial autónomo** (determinista, sin esperar al modelo); plan de sectores y medios; replanifica con `sustituyeA` | Despliegues que no son ataque inicial (`supervisada/35`); elevar nivel; medios aéreos (`supervisada/50`) |
| `proteccion_poblacion` | 60 s (máx 180 s) | `peligro_sube`, `viento_gira`, `incendio_nuevo`, `incendio_actualizado` | **Aviso preventivo autónomo** (`autonoma/20`) a pueblos en riesgo **o** a ≤ 8 km con vulnerables / ≥ 500 hab | **Confinar y evacuar** (riesgo ≥ 70 → humano; la orden es del Director del Plan) |
| `asesor_legal` | 120 s | `decision_propuesta` | `fundamentos` del grafo + `alertasLegales` | Si detecta problema de competencia, sube la decisión a humano |
| `ejecutor` | por evento | `decision_aprobada` | Llamada / SMS / email por HappyRobot, Telegram, tickets, comunicados | Nada (solo ejecuta lo aprobado) |
| `despachador` | 5 s | `decision_aprobada` | Mueve cada unidad por su ruta OSRM real (×1,25), avisa con `unidad_llega` | Nada |
| `portavoz` | 300 s (máx 180 s) | `poblacion_avisada`, `incendio_actualizado`, `decision_ejecutada` | **Comunicado informativo autónomo** (`autonoma/25`), con traducciones | Comunicados urgentes o con órdenes (riesgo 60 → supervisada) |
| `supervisor` | 120 s | `decision_propuesta`, `agente` | Puntúa 0-100 cada decisión; por debajo del mínimo → `escalada` | Escala a humano lo que no aprueba |
| `memoria` | 300 s (máx 240 s) | `decision_denegada`, `decision_aprobada`, `accion_fallida`, `accion_ejecutada`, `decision_escalada` | `Leccion` con embedding; comparativa entre ejecuciones | Nada |
| `redactor` | 600 s | `decision_ejecutada`, `decision_denegada`, `decision_escalada` | Actas e informes de situación | Nada |

**Cadenas de reacción comprobadas end-to-end**: foco confirmado → ataque inicial en 3-5 s ✔ ·
frente gira → `viento_gira` → frente recalculado ✔ · riesgo alto o pueblo sensible cerca →
aviso propuesto en 80 s ✔ · cámara positiva → observación → verificador ✔ · nivel ≥ 2 →
`nivelGravedadHumano: 2` deja toda decisión del foco en manos de una persona ✔.

**Gaps anotados, no corregidos** (no son bugs claros):
- `centralita` no declara `despiertaCon`. No hace falta: los webhooks llaman a
  `procesarEntrada` directamente, que registra la `Observacion` y con ella despierta al
  verificador. Lo dejo así.
- `redactor` tiene cadencia de 600 s para el informe de situación; las actas no pasan por su
  ciclo sino por `lib/motor/actas.ts`. Correcto, pero hace que su visor parezca vacío.

---

## 4. Riesgos pendientes

**R-1 · El riesgo de una población depende solo de la ETA del frente (alto).**
`riesgoPorEta` en `lib/simulacion/propagacion.ts` devuelve `bajo` para cualquier pueblo con
ETA ≥ 360 min, aunque esté a 2,9 km y tenga un colegio y una residencia. Con viento flojo
**todo** sale "bajo" y el mapa enseña "Riesgo alto · Sin avisar" o directamente "bajo" donde
un director de emergencias vería peligro. Mi parche está en el agente (entra por
proximidad), pero **la etiqueta que ve el usuario en el mapa sigue siendo la equivocada**.
El archivo es de **K** → petición abierta en `docs/REPARTO.md`. Sugerencia concreta: suelo
por distancia, `max(riesgoPorEta, riesgoPorDistancia)`, y subir un escalón si hay colectivos
vulnerables.

**R-2 · `estadoAviso` no pasa a `sin_respuesta` cuando fallan todos los canales (alto).**
En `lib/agentes/ejecucion/ejecutor.ts` (ahora de **K**), si la llamada y el SMS fallan
(HappyRobot sin workflow, que es el estado actual) la población se queda en `sin_avisar`, la
UI no distingue "no se ha intentado" de "se intentó y no hubo manera", y el planificador la
vuelve a coger en el ciclo siguiente **en bucle**. El tipo `EstadoAviso` ya contempla
`"sin_respuesta"`. He puesto la mitad que me tocaba (el planificador ya no reintenta un
`sin_respuesta` salvo que el riesgo suba a `inminente`); **falta la línea del ejecutor** →
petición abierta a K.

**R-3 · La persistencia va con la clave anónima (medio).**
`SUPABASE_SERVICE_ROLE_KEY` está vacía y todo escribe con `SUPABASE_ANON_KEY`. Funciona
porque las tablas no tienen RLS, pero eso significa que **cualquiera con la URL y la clave
publicable puede escribir en la base del jurado**. Antes del despliegue público: rellenar la
clave de servicio o activar RLS.

**R-4 · Falta la tabla `tickets` (bajo).**
`GET /rest/v1/tickets` → 404 `PGRST205`. `Ticket` existe en el contrato de D y la acción
`abrir_ticket` los crea, pero viven solo en memoria. Si se quiere auditar un parte al
SEPRONA tras un reinicio, hay que aplicar la tabla.

**R-5 · Las trazas no se rehidratan en memoria (bajo, por diseño).**
`cargarEjecucionActiva` no rellena `agentes[].trazas`. No rompe la auditoría porque
`trazaDe()` busca la traza en Supabase cuando no está en memoria (probado: 1.621 trazas
guardadas), pero los visores de agente aparecen vacíos justo después de un reinicio.

**R-6 · Replanificación por giro del frente sin confirmar (medio).**
Forzar el viento recalcula el frente y emite `viento_gira`, pero no llegué a ver una decisión
nueva con `sustituyeA` en la ventana de 40 s que medí. El camino existe en el código
(`motivoReplan` en el coordinador). **Hay que verlo una vez antes de la demo**, con 3-4
minutos de observación.

**R-7 · Dos resultados quedan pendientes de un reinicio limpio (medio).**
El `next dev` de `:3100` conserva instancias de módulo anteriores a mis parches dentro del
bucle del orquestador. Por eso todavía se colaron 2 llamadas completas durante la pausa y 1
acta duplicada de una decisión antigua. Esperado tras reiniciar el proceso: **0 y 0**. No
reinicié para no tumbar a G, H e I.

**R-8 · Latencia de las actas en el camino crítico (medio).**
Cada cambio de estado de una decisión pide una narrativa al modelo (~25 s) y
`generarActaAccion` se **espera** dentro del bucle de acciones de `aprobarDecision`. Con 2
acciones, la decisión se queda en `ejecutando` unos 60-90 s aunque las unidades ya estén en
ruta. El acta determinista es instantánea; la narrativa no. Si en la demo se ve lento, la
palanca es `INFORMES_TIMEOUT_NARRATIVA_MS` o generar el acta de acción sin `await`.

**R-9 · Integraciones de salida sin configurar (informativo).**
HappyRobot no tiene los tres `HAPPYROBOT_WORKFLOW_SLUG_*`, Telegram no tiene
`TELEGRAM_BOT_TOKEN`, NASA FIRMS no tiene `FIRMS_MAP_KEY` y `DESTINO_DEMO` está vacío. Los
agentes proponen y ejecutan, pero cada acción de aviso falla con el motivo exacto (que es el
comportamiento correcto: nada simulado). Sin esas claves **no hay ninguna llamada ni SMS real
en la demo**.

---

## 5. Cómo repetir las pruebas

```bash
# contra el servidor de desarrollo compartido (NO arrancar otro next dev)
curl -s -X POST localhost:3100/api/ejecucion -H 'content-type: application/json' -d '{"accion":"nueva"}'
curl -s -X POST localhost:3100/api/focos     -H 'content-type: application/json' \
     -d '{"lat":39.79,"lon":-1.05,"nombre":"Tuéjar"}'
# ≤ 40 s: debe haber "Ataque inicial" autónomo ejecutado y una unidad de bomberos en ruta
curl -s localhost:3100/api/estado | jq '.decisiones[] | {titulo,estado,competencia}'
# pausa dura: ninguna línea "[llm]" con latencia debe aparecer en 30 s
N=$(grep -c '^\[llm\]' /tmp/atalaya-dev.log)
curl -s -X POST localhost:3100/api/reloj -H 'content-type: application/json' -d '{"pausado":true}'
sleep 30; tail -n +$((N+1)) /tmp/atalaya-dev.log | grep '^\[llm\]'
curl -s -X POST localhost:3100/api/reloj -H 'content-type: application/json' -d '{"pausado":false}'
# auditoría
curl -s "localhost:3100/api/auditoria?decisionId=<id>" | jq '{informes:(.cadena.informes|length)}'
curl -sOJ "localhost:3100/api/auditoria/exportar?decisionId=<id>"
# salud (bloques nuevos)
curl -s localhost:3100/api/salud | jq '{ia,integraciones}'
```

Si la política de autonomía parece "atascada" en valores viejos (avisos o comunicados que no
salen solos), es el bug J-9: con el arreglo basta con `POST /api/ejecucion {nueva}`; en un
servidor donde alguien ya la editó a mano, hay que hacer `PUT /api/politica` con el
`catalogo` que devuelve `GET /api/politica`.
