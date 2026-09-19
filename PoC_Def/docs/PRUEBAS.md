# Atalaya Incendios · Pruebas

**Dueño: constructor L.** Fecha: **2026-09-19**. Servidor de pruebas: **http://localhost:3100**
(`next dev` compartido, agentes vivos, sin persistencia). Nunca se arrancó `next dev` ni
`next build`, y **no se tocó el `:3000` de Javi**.

Petición literal de Javi: *"valida todo con pruebas reales, puedes incluso desarrollar tests
para validar cada aspecto y corroborar que funciona como se espera"*. Eso es lo que hay aquí:
**nada mockeado**. Las unitarias prueban los módulos puros tal cual están escritos; las de
integración hablan con el servidor de verdad, con HelmCode de verdad y con Overpass, OSRM,
Open-Meteo, Nominatim y las cámaras de la DGT de verdad; las de UI abren un Chromium real.

---

## 1. Cómo se ejecutan

```bash
npm run test           # las tres baterías
npm run test:unit      # unitarias: deterministas, sin red, < 1 s
npm run test:integracion   # contra el servidor vivo de ATALAYA_URL (por defecto :3100)
npm run test:ui        # humo de las 12 pantallas con Playwright
npm run test:tipos     # type-check de tests/** y vitest.config.mts
```

- `ATALAYA_URL=http://otro:3100 npm run test:integracion` apunta a otro servidor.
- Las de UI necesitan `npx playwright install chromium` una vez. **Si Playwright no está
  instalado, no fallan**: se degradan a comprobar el HTML servido por el SSR y lo dicen por
  consola (`▶ Playwright no disponible…`). Con navegador sí vigilan la consola, el montaje de
  Leaflet y el flujo de "Declarar foco".
- `tests/preparar-entorno.ts` carga `.env.local` en `process.env` antes de cada batería (Next
  lo hace solo; vitest no). **No imprime ninguna clave.**
- Las de integración **crean datos en :3100** (una ejecución nueva, un foco, observaciones,
  decisiones). No tocan Supabase y no persisten nada.

### Ficheros

| Ruta | Qué es |
|---|---|
| `vitest.config.mts` | Tres proyectos (`unit`, `integracion`, `ui`), alias `@/` como en tsconfig |
| `tests/preparar-entorno.ts` | Carga `.env.local` |
| `tests/tsconfig.json` | Type-check propio (la raíz excluye `tests/` para no romper `next build`) |
| `tests/unit/ayudas/dominio.ts` | Fábricas de `Incendio`, `Meteo`, `Decision`, `Unidad`, `Poblacion` |
| `tests/unit/*.test.ts` | 10 ficheros, módulos puros |
| `tests/integracion/ayudas.ts` | `api`, `esperarHasta`, `esperarValor`, `snapshot`, `medir`, `ejecucionNueva` |
| `tests/integracion/00-escenario.test.ts` | Casos (a)–(i): el ciclo completo de un foco |
| `tests/integracion/10-conocimiento-politica-salud.test.ts` | Casos (j)–(l) |
| `tests/integracion/20-ingesta-camaras.test.ts` | Casos (m)–(n) |
| `tests/ui/humo.test.ts` | Humo de las pantallas |

---

## 2. Qué cubre cada prueba

### 2.1 Unitarias (`tests/unit/`)

| Fichero | Módulo probado | Qué se valida |
|---|---|---|
| `politica.test.ts` | `lib/dominio/politica.ts` | Lista blanca (acción fuera de catálogo → humano, riesgo 90); manda la acción más restrictiva y el orden no importa; el riesgo es el máximo de los `riesgoMinimo`; **la IA no puede rebajarse el riesgo** (declarar 1 en una evacuación sigue dando 85 y "humano"); recorte a 0..100; umbrales `umbralSupervisada`/`umbralHumano`; `nivelGravedadHumano`; alertas legales del asesor; motivo siempre explicado |
| `peligro.test.ts` | `lib/fuentes/peligro.ts` | Regla 30-30-30 (estricta en los tres límites, basta la racha); los cinco niveles y sus cortes; día extremo vs. día tranquilo; monotonía; `factorCombustible` dentro de [0,70 · 1,15]; matorral sube y urbano baja; efecto de la lluvia (8 mm → ×0,45, satura); `precipitacion24hMm` manda sobre la horaria; sin VPD el índice no se hunde |
| `geo.test.ts` | `lib/fuentes/geo.ts` | Haversine contra distancias reales (Madrid–Barcelona 504,6 km); simetría; rumbos; `destino` como inversa exacta de haversine+rumbo (< 1 m); rosa de los vientos y normalización; `diferenciaAngular` por el camino corto; **interpolación circular** (350°→10° pasa por el norte); `bbox`; claves de caché |
| `propagacion.test.ts` | `lib/simulacion/propagacion.ts` | Viento efectivo, L/B, excentricidad, cabeza vs. cola, `factorEstado`, pendiente, lluvia; **pasto + 35 km/h × 60 min → decenas de ha con el frente al NE y radio NE ≥ 10× el radio SO**; sin viento crece poco y casi circular (máx/mín < 1,05); pureza; `predecir`: **pueblo a 3 km a sotavento → "inminente" con ETA < 60 min**, y un **giro de 90° cambia la lista** (Navalacruz → Robledo); fuera del cono a > 2 km → bajo, a < 2 km → medio; +1 h < +3 h < +6 h; **controlado no crece**; estabilizado ×0,2; `factorExtincion` de K |
| `contencion.test.ts` | `lib/simulacion/contencion.ts` | `factorVientoLinea`, `factorAtaque` (forma, no cortes concretos: K los afina); ritmos por tipo de medio; solo cuentan las unidades en intervención sobre ese foco; la línea acumula y nunca pasa del perímetro; `factorExtincion` = (1−f)^1,5 × aéreos × lluvia; aéreos solo de día y con viento < 40 km/h; hitos estabilizado→controlado (60 min) y controlado→extinguido (120 min) |
| `fusion.test.ts` | `lib/simulacion/fusion.ts` | Umbral de 300 m borde a borde; solape → distancia 0; estados fusionables; un foco por pareja y ciclo; pureza; quién sobrevive (confirmado > detectado; a igualdad, el más antiguo); perímetro unido por envolvente convexa, cerrado y mayor que la suma |
| `reloj.test.ts` | `lib/motor/reloj.ts` | ×12: 5 s reales = 1 min de mundo, sin deriva en 12 ticks; **la pausa congela el mundo de verdad** (10 min reales en pausa no mueven `ahoraMundo`); la bandera global que ve `llm.ts`; reanudar no recupera el tiempo perdido; pausar es idempotente; cambiar el factor no reescribe el pasado; recorte [0,1 · 600]; `avanzarMinutos` exacto, funciona en pausa y nunca retrocede; cada cambio sube `version` |
| `traza.test.ts` | `lib/motor/traza.ts` | `ejecutarConTraza` publica `en_curso` y cierra en `ok`; un fallo cierra en `error` y relanza; **un `AbortError` cierra como `cancelado`**; tope de 20 trazas; `agenteActual`/`trazaActual` solo dentro del ciclo; **`anotarLlamadaIA` fuera de un ciclo no hace nada y no lanza**; tope de 30 llamadas; no se filtra a otro agente; `sinTraza` aísla el trabajo en segundo plano (bug J-3) |
| `llm.test.ts` | `lib/ia/llm.ts` | `mundoEnPausa()` con la bandera global y su integración real con `pausar()`/`reanudar()`; solo `true` cuenta como pausa; `estadoColaLLM()` en reposo; `abortarLlamadasIA()` idempotente; proveedor activo = HelmCode y modelo por papel; contadores a cero |
| `recencia.test.ts` | `lib/fuentes/recencia.ts` | Ventana de 15 días para prensa y redes: acepta hasta el límite exacto, descarta lo anterior, deja pasar lo que no tiene fecha (decide el modelo); `desdeVentana` para el `since` de Bluesky |
| `verificador.test.ts` | `lib/agentes/analisis/verificador.ts` | Contrato del agente (id, categoría, `despiertaCon`, modelo) y, desde la fase F0, la regla **"una noticia no confirma otra noticia"**: prensa y rrss son la misma familia, cámara/satélite/sensor otra, manual otra, y llamada/sms/email/telegram/web son "ciudadano" (fallo L-1 cerrado) |
| `esquema-json.test.ts` | `lib/ia/llm.ts` | Endurecimiento del JSON Schema para `strict`: `additionalProperties: false`, **todas** las propiedades en `required` (también las opcionales de zod), recursión en objetos anidados y en `items`, se quitan las palabras clave no soportadas, `enum` se conserva, y la función es pura (fallo L-2 cerrado) |
| `registro-agentes.test.ts` | `lib/agentes/registro.ts` | **Caracterización del inventario**: 16 agentes, sus ids, categoría, cadencia, `despiertaCon` y cuáles son deterministas. Cada fase de la migración lo cambia a propósito y el diff es la revisión |
| `mapeo-plan.test.ts` | `lib/agentes/planificacion/mapeo-plan.ts` | **La frontera zod**: conversión `Plan` → acciones sin proveedor de IA. Rumbos de sector sobre el frente, unidades inventadas o no disponibles que se descartan, tiempo real por carretera en la descripción, no pedir dos veces lo mismo, retiradas solo del propio foco, y pureza |

### 2.2 Integración (`tests/integracion/`) — servidor vivo

Cada caso imprime sus tiempos medidos por consola (`⏱ …`).

| Caso | Qué comprueba |
|---|---|
| (a) | `POST /api/focos` → en ≤ 15 s el foco tiene municipio, ≥ 1 población y ≥ 1 unidad en el pool (Nominatim + Overpass reales) |
| (b) | Ataque inicial **autónomo** en ≤ 60 s: decisión "Ataque inicial" en `ejecutando`/`ejecutada`, `competencia: autonoma`, ≥ 1 `desplegar_unidad` ejecutada con `resultado.datos.ruta.distanciaM > 0` (OSRM real) y ≥ 1 unidad `en_ruta`; si hay medios de extinción a < 60 km, tiene que ser uno de ellos |
| (c) | `POST /api/reloj {avanzarMin:10}` → el progreso de la unidad sube y la velocidad medida no pasa de OSRM × 1,25 más un margen del 30 % (el salto de reloj y el tick del despachador no caen en el mismo instante, así que la ventana real es algo mayor de 10 min de mundo) |
| (d) | `POST /api/reloj {pausado:true}` → los 16 agentes en `pausado` en ≤ 10 s, `ahoraMundo` congelado durante 20 s, `/api/conocimiento/consultar` responde sin colgarse, y al reanudar todos vuelven a la vida. Todo dentro de `try/finally`: una aserción rota no puede dejar el mundo parado |
| (d bis) | **`it.fails`, fallo L-3**: el conocimiento debería responder 200 en pausa (`permitirEnPausa`) y responde 503 |
| (d ter) | **Fallo L-4**: en 20 s de pausa el objetivo es 0 llamadas a la IA y hoy se completan entre 0 y 3. La prueba fija el tope medido (3) e imprime el valor de cada ejecución |
| (e) | `POST /api/focos/[id]/viento {225, 45}` → `meteo` refleja SO 45 y `fuente` contiene "forzado"; evento `viento_gira` con `datos.forzado`; la predicción cambia de rumbo (frente al NE); el **coordinador** propone una decisión nueva con `motivoReplanificacion` y, **si tenía un plan todavía vivo**, con `sustituyeA`; `DELETE` borra `meteoForzada` en el acto y la previsión real de Open-Meteo vuelve en cuanto el meteorólogo repite su ciclo |
| (f) | Con pueblos a < 8 km: decisión de `proteccion_poblacion` con `avisar_poblacion` en `ejecutando`/`ejecutada`/`fallida`, `competencia: autonoma`, y `poblacion.ultimoContacto` con motivo. **Sin HappyRobot/Telegram el aviso falla: la prueba acepta el fallo con motivo, nunca la ausencia de intento.** El plazo de 120 s del encargo tampoco se cumple siempre: ver variabilidad V-2 |
| (g) | El portavoz publica un comunicado oficial y `/publico` responde 200. **El plazo de 180 s del encargo no se cumple siempre** (medido: 21 s, 324 s y una tanda sin comunicado en la ventana): ver variabilidad V-1. El presupuesto de la prueba es de 7 min, porque lo que se valida es el circuito, no la latencia. Que el título **se vea de verdad** en el portal se comprueba en la batería de UI: `/publico` lo pinta en cliente y el HTML del servidor no lo lleva |
| (h) | Los focos de `prensa_redes` nacen en `detectado`, con confianza ≤ 0,7 y sin unidades asignadas |
| (i) | `GET /api/auditoria?decisionId=` → ≥ 3 estados en el historial, traza con llamadas a la IA (o motivo `cadencia`/`incendio_actualizado`/…), ≥ 1 acta por estado y por acción, **huella SHA-256 de 64 hex en todas**; `/api/auditoria/exportar` devuelve Markdown con `Content-Disposition: attachment` |
| (j) | `POST /api/conocimiento/consultar` con "¿Quién puede ordenar la evacuación…?" → fundamentos con similitud > 0,3 y respuesta no vacía; `GET /api/conocimiento/grafo` con nodos y aristas |
| (k) | `PUT /api/politica` con `umbralHumano < umbralSupervisada` → **422** y la política guardada intacta; un cambio válido (umbral 1) deja **todas** las decisiones vivas en `humano`; la política original se restaura siempre (el servidor es compartido) |
| (l) | `/api/salud`: IA HelmCode, Open-Meteo, Overpass, Nominatim, Cámaras DGT y OSRM en verde; NASA FIRMS, HappyRobot y Telegram en rojo **con detalle explicativo** |
| (m) | `POST /api/ingesta/observacion` (Navalacruz) → extracción con `esIncendio: true` y gravedad en ≤ 30 s; el verificador resuelve el aviso en ≤ 90 s **con explicación**, y se comprueba la invariante que de verdad importa: si dice `nuevo_foco`, el foco existe; si dice `registrada`/`ruido`, **no ha aparecido ningún foco** (no se inventa nada). Medido las dos ramas: `nuevo_foco` → "Incendio de Hoyocasero" en 4,0 s, y `registrada` con confianza 0,30 ("a la espera de más fuentes") |
| (n) | `/api/camaras?todas=1` → más de 2.000 cámaras; `/api/camaras/<id>/imagen` devuelve un JPEG real (se prueban varias porque alguna DGT puede estar caída) |

### 2.3 UI (`tests/ui/humo.test.ts`)

Chromium real, consola vigilada (con una lista de ruido: favicon, Fast Refresh, HMR, una
cámara DGT caída…). Rutas: `/`, `/auditoria`, `/agentes/coordinador`, `/conocimiento`,
`/informes`, `/aprendizaje`, `/politica`, `/publico`, `/parte`, `/movil`, `/incidencias` y
`/incidencias/<id>` del primer foco vivo. Además:

- **El mapa Leaflet monta** (`.leaflet-container`) y el reloj de mundo se ve.
- **"Declarar foco" → clic en el mapa → confirmar → toast "Foco declarado"**. El botón solo
  se ve con el modo desarrollo, así que la prueba pone `localStorage["atalaya:desarrollo"] =
  "1"` con `addInitScript` antes de cargar la sala. El clic tiene que caer en mapa vacío: si
  cae sobre un marcador (foco, unidad, cámara) Leaflet abre su popup y el diálogo no sale, así
  que la prueba prueba varios puntos hasta que aparece "Declarar un foco".
- **Fuentes de detección**: `tests/unit/escenario.test.ts` (puro, sin red) cubre el catálogo,
  el simulacro, qué agente se apaga, qué canal queda bloqueado (la cámara de móvil pasa, la
  fija no) y `cambiarFuentesDesactivadas` (evento, marcas de agente, desarme/rearme de
  cámaras). `ejecucionNueva` de las pruebas de integración manda `fuentesDesactivadas: []`
  para no heredar un simulacro dejado en el servidor compartido.
- **El portal ciudadano pinta los comunicados**. `components/publico/PortalCiudadano.tsx` es
  un componente de cliente: el HTML que sirve el servidor trae "Cargando…" y una lista vacía,
  así que esto **solo** se puede comprobar con navegador.

---

## 3. Resultados de la última ejecución

### AVISO (constructor M, 2026-09-19 08:50): la tabla de abajo es de ANTES de las correcciones M-1…M-9

La última pasada registrada (08:02, 15/20) es la que provocó esas correcciones y **ya no describe el
código actual**: en aquel momento Overpass estaba caído y ningún foco recibía unidades ni pueblos.
**Queda pendiente volver a lanzar `ATALAYA_URL=http://localhost:3100 npm run test:integracion` tres
veces seguidas y sustituir esta sección por la tabla real.**

Lo que SÍ está medido tras el cambio, con sonda manual contra :3100 (foco en 39,79 / −1,05, un solo
foco, servidor recién arrancado):

| Hito | Antes (Overpass caído) | Después | Presupuesto de la prueba |
| --- | --- | --- | --- |
| Municipio (Nominatim) | 3 s | 4 s | — |
| Poblaciones del foco | nunca (0) | 12 s (89 pueblos) | (a) 30 s |
| Unidades en el pool | nunca (0) | 21 s (24 unidades) | (a) 30 s |
| «Ataque inicial» en `ejecutando` | nunca | 25 s | (b) 60 s |
| Consulta Overpass `pueblos` 30 km | — | 2,5-10 s (7,5 s típico) | timeout 25 s |
| Consulta Overpass `medios` 30 km | — | 3,7-19 s (7,4 s típico) | timeout 25 s |
| Consulta Overpass `superficies` 5 km | — | 2,6-9 s | timeout 25 s |
| `overpass-api.de` (primario) | `connection refused` en 0,17-0,19 s | igual | se salta y no cuesta nada |

Los valores altos de la columna «Después» son con varios focos enriqueciéndose a la vez (el agente de
prensa crea los suyos): `maps.mail.ru` encola y pasa de 2,5 s a 19 s. Por eso el enriquecimiento
lanza los seis pasos en paralelo: el tiempo de pared es el del paso más lento, no la suma.


`npm test` completo, **2026-09-19 07:11–07:20** contra `:3100` con los agentes
vivos, HelmCode real y todas las fuentes reales. **Código de salida 0.**

| Batería | Resultado | Duración |
|---|---|---:|
| `unit` (10 ficheros) | 🟢 **157 pasan**, 4 saltadas (fallo L-1) | **0,40 s** |
| `integracion` (3 ficheros) | 🟢 **19 pasan**, 1 fallo esperado (`it.fails`, fallo L-3) | **456,0 s** |
| `ui` (1 fichero, Chromium) | 🟢 **15 pasan** | **60,2 s** |
| `test:tipos` (`tsc -p tests/tsconfig.json`) | 🟢 sin errores | — |
| `eslint tests vitest.config.mts` | 🟢 0 errores, 0 avisos | — |

### Integración · caso por caso, con los tiempos medidos

| Caso | | Medido |
|---|:--:|---|
| Ejecución nueva y limpia | 🟢 | 12,2 s |
| (a) Foco → municipio, poblaciones y unidades | 🟢 | **inmediato**: Tuéjar (Valencia), **89 poblaciones**, **20 unidades** (Nominatim + Overpass reales) |
| (b) Ataque inicial autónomo | 🟢 | **6,1 s**, `competencia: autonoma`, `desplegar_unidad` ejecutada con ruta OSRM real de **8,3 km / 13 min**, 1 unidad de bomberos en ruta (había medios de extinción a < 60 km) |
| (c) Las unidades avanzan | 🟢 | +10 min de mundo → progreso 0,000 → 1,000 (**8.264 m**); OSRM 628 m/min, medido 826 m/min (dentro de ×1,25 + margen) |
| (d) Pausa | 🟢 | **16 agentes en `pausado` en 3,6 s**; el mundo no se mueve ni un milisegundo en 20 s (`05:24:06.707Z` antes y después); al reanudar, **16 agentes vivos en 4,6 s** |
| (d bis) Conocimiento en pausa | 🔴 **esperado** | HTTP **503** "Mundo en pausa" → **fallo L-3** |
| (d ter) Llamadas a la IA en pausa | 🟠 | **+2** en 20 s (objetivo 0) → **fallo L-4**, dentro del tope medido |
| (e) Viento forzado | 🟢 | `meteo` SO 45 km/h con `fuente` "Viento forzado por pruebas L (ejercicio) sobre Open-Meteo"; evento `viento_gira` con `datos.forzado` **inmediato**; predicción recalculada en **6,1 s** (frente al NE a 4,6 m/min, con `×0,66` de los medios); **replanificación del coordinador a los 129,1 s** con `sustituyeA`; `DELETE` → previsión real (N 7 km/h) en **6,1 s** |
| (f) Aviso autónomo a la población | 🟢 | pueblos a < 8 km: **Tuéjar 2,9 · Mozaira 5,2 · Chelva 6,4 · Bercuta 7,1 · Ahillas 7,2 km**; aviso intentado a los **206,0 s**, `competencia: autonoma`, acción **fallida con motivo** (*"llamada: Falta DESTINO_DEMO"*) y `ultimoContacto` escrito |
| (g) Comunicado y portal | 🟢 | "Comunicado oficial: incendio forestal activo en Tuéjar (Valencia)", publicado `05:16:13Z`; `/publico` → 200 |
| (h) Focos de prensa/redes | 🟢 | 0 en esta tanda (en otras: "Incendio de Ponteareas", `detectado`, confianza 0,7, sin unidades) |
| (i) Auditoría | 🟢 | **4 estados** de historial, **7 actas** (todas con huella de 64 hex), traza de origen con **10 llamadas a la IA**; expediente Markdown de **166.837 caracteres** con `Content-Disposition: attachment` |
| (j) Conocimiento | 🟢 | **15,4 s**, **11 fundamentos**, mejor similitud **0,655**, respuesta de 1.278 caracteres; grafo con **327 nodos y 499 aristas** |
| (k) Política | 🟢 | incoherente → **422** ("El umbral de supervisión no puede ser mayor que el de decisión humana") y la guardada intacta; endurecida → **5 decisiones recalculadas**, las 5 vivas a `humano`; restaurada |
| (l) Salud | 🟢 | IA **helmcode** en verde; Nominatim, Overpass, Open-Meteo (+elevación), Cámaras DGT, Conocimiento (RAG), Exa, Google News, Bluesky, Peligro por zonas, Visión, Supervisor, Redactor y Avisos meteorológicos en verde; **NASA FIRMS en rojo** (falta `FIRMS_MAP_KEY`), **HappyRobot y Telegram en rojo con detalle** |
| (m) Ingesta | 🟢 | aviso aceptado en 15,5 s; extracción `esIncendio: true`, gravedad `moderada`, tipo `incendio_activo`, lugar reconocido; veredicto del verificador: **`duplicada`** del aviso anterior *"(mismo canal web, a menos de 2 km y 30 min)"* → **no duplica el foco**. En otras tandas: `nuevo_foco` ("Incendio de Hoyocasero", confianza 0,80) y `registrada` (confianza 0,30) |
| (n) Cámaras | 🟢 | **2.305 cámaras** en el catálogo (77 vigiladas); `/api/camaras/dgt:879/imagen` → **image/jpeg, 126.925 bytes** |

### UI · Chromium real

| Pantalla | | Medido |
|---|:--:|---|
| `/` · `/auditoria` · `/agentes/coordinador` · `/conocimiento` · `/informes` · `/aprendizaje` · `/politica` · `/publico` · `/parte` · `/movil` · `/incidencias` | 🟢 | HTTP 200 y **0 errores de consola** en las 11, ~4,1 s cada una |
| `/incidencias/<id>` | 🟢 | HTTP 200, 3,1 s |
| Mapa Leaflet + reloj de mundo | 🟢 | `.leaflet-container` montado en **0,6 s** |
| Portal ciudadano pintando comunicados | 🟢 | se ve "Comunicado oficial" en el navegador (el HTML del servidor no lo lleva) |
| **Declarar foco** (clic en el mapa → confirmar → toast) | 🟢 | toast **"Foco declarado"** en **10,2 s** |

---

## 4. Fallos encontrados

**No he tocado una sola línea de código de producción.** Cada fallo tiene su
prueba escrita y marcada donde se puede (`it.fails` o `describe.skip`), su
petición en `docs/REPARTO.md` dirigida al dueño, y su reproducción exacta. Cuando
el dueño lo arregle, la prueba marcada `it.fails` **se pondrá roja**: esa es la
señal de que hay que quitarle la marca.

| | Qué | Dueño | Prueba |
|---|---|---|---|
| ~~**L-1**~~ | ~~`familiaCanal` no se exporta~~ · **CERRADO en la fase F0**: exportado, `describe` activo con 6 casos | D | 🟢 |
| ~~**L-2**~~ | ~~`esquemaJson`/`endurecer` no se exportan~~ · **CERRADO en la fase F0**: ver `tests/unit/esquema-json.test.ts` | C | 🟢 |
| **L-3** | `completarTexto` no propaga `permitirEnPausa`: el conocimiento devuelve 503 con el mundo en pausa | C, J | `(d bis)` `it.fails` |
| **L-4** | En pausa se siguen completando llamadas a la IA (0-3 en 20 s; el objetivo es 0) | J | `(d ter)` con tope |
| **L-5** | Pausar **escala a un humano para siempre** las decisiones autónomas que estaban en vuelo | J, A | — |
| **L-6** | Pausar 3 veces **desactiva de forma permanente** el vigía de cámaras y el asesor legal | J, A | — |

**Los tres últimos son el mismo problema de fondo**: un `AbortError` provocado
por el propio mando al pulsar "Parar" se está tratando como si fuera una avería.
J ya aplicó el criterio correcto en un sitio (bug J-11, `esAborto(e)`); falta
aplicarlo al contador de errores del agente, a la escalada del supervisor y a
`completarTexto`.

### L-1 · `familiaCanal` no se exporta — la regla "una noticia no confirma otra noticia" no se puede probar

- **Dónde**: `lib/agentes/analisis/verificador.ts:22`. Dueño: **D**.
- **Qué pasa**: `familiaCanal` es una función de módulo sin `export`. Implementa
  una de las reglas de negocio centrales del sistema (prensa y rrss son la misma
  familia y no se confirman entre sí; cámara/satélite/sensor son otra; manual
  otra; llamada/sms/email/telegram/web son "ciudadano"), y para probarla haría
  falta montar un `ContextoAgente` entero con IA real.
- **Prueba**: `tests/unit/verificador.test.ts` → `describe.skip` con el motivo y
  las aserciones ya escritas, comentadas.
- **Arreglo**: añadir `export`. Es aditivo y no cambia comportamiento.

### L-2 · `esquemaJson` / `endurecer` no se exportan (menor)

- **Dónde**: `lib/ia/llm.ts:283` y `:311`. Dueño: **C**.
- **Qué pasa**: el endurecimiento del JSON Schema (`additionalProperties: false`,
  `required` completo, recursión en `properties`/`$defs`) solo se valida de
  rebote, cuando una llamada real a HelmCode con `strict: true` no da error. Un
  cambio ahí hoy solo se detecta en producción.
- **Prueba**: no hay; queda anotado en la cabecera de `tests/unit/llm.test.ts`.
- **Arreglo**: exportarlos y escribo las unitarias deterministas.

### L-3 · `completarTexto` no propaga `permitirEnPausa`: el conocimiento no funciona en pausa

- **Dónde**: `lib/ia/llm.ts:747` (`completarTexto`). Dueño: **C** (con **J**).
- **Qué pasa**: `completarTexto` llama a `llamar({ papel, mensajes, maxTokens,
  temperatura, signal })` **sin `permitirEnPausa: p.permitirEnPausa`**, que sí
  pasa `completarJson` (líneas 681 y 696). Como `llamar()` bloquea con
  `mundoEnPausa() && !args[0]?.permitirEnPausa`, todo lo que use `completarTexto`
  queda bloqueado en pausa aunque esté marcado como permitido. Afecta a
  `lib/conocimiento/consulta.ts:212` (`consultarProtocolo`) —**la única
  herramienta que el mando puede usar con el mundo parado**— y a
  `lib/agentes/informes/redactor.ts:767`.
- **Reproducción**:
  ```bash
  curl -XPOST :3100/api/reloj -d '{"pausado":true}'  -H 'content-type: application/json'
  curl -XPOST :3100/api/conocimiento/consultar -H 'content-type: application/json' \
       -d '{"pregunta":"¿Qué es un incendio de nivel 1?"}'
  # → 503 {"error":"Mundo en pausa: no se hacen llamadas a la IA hasta reanudar"}
  curl -XPOST :3100/api/reloj -d '{"pausado":false}' -H 'content-type: application/json'
  # → mismo curl: 200 en 11-16 s, 11 fundamentos (similitud 0,655) y respuesta completa
  ```
- **Prueba**: `tests/integracion/00-escenario.test.ts` → **`(d bis)`, `it.fails`**.
- **Arreglo**: una línea. (De paso, el reintento de reparación de `completarJson`,
  ~línea 707, tampoco lo propaga.)

### L-4 · En pausa siguen completándose llamadas a la IA

- **Dónde**: `lib/ia/llm.ts` + el bucle del orquestador. Dueño: **J**.
- **Qué pasa**: con los 16 agentes en estado `pausado` y el reloj de mundo
  congelado, el contador de `/api/salud` subió **+2 en 20 s** sin provocar nada
  desde fuera (medido dos veces: 514 → 517 con una consulta propia de por medio,
  y 550 → 552 sin ninguna). J ya corrigió la causa principal (bug J-2:
  `abortarLlamadasIA()` y la segunda comprobación al salir de la cola) y dejó
  escrito el matiz: `next dev` mantiene viva la instancia **anterior** de
  `lib/ia/llm.ts` dentro del `setInterval` del orquestador, así que esto **no se
  puede dar por cerrado hasta reiniciar el proceso**. No lo he reiniciado para no
  tumbar el trabajo de los demás.
- **Medido en cinco ventanas limpias de 20 s**: **+0, +1, +1, +2 y +3**. Como a
  veces sale 0, marcarla `it.fails` la haría inestable, así que
  `tests/integracion/00-escenario.test.ts` → **`(d ter)`** fija el **tope medido
  hoy** (`TOPE_LLAMADAS_EN_PAUSA = 3`), imprime el valor de cada ejecución y
  avisa por consola cuando sale 0. **Cuando se reinicie el proceso de `:3100`,
  bajar el tope a 0 y cerrar este fallo.**
- **Lo que SÍ está verde**: los 16 agentes pasan a `pausado` en ~5 s, el reloj de
  mundo no avanza ni un milisegundo, y al reanudar todos vuelven a la vida.

### L-5 · Pausar ESCALA para siempre las decisiones que estaban en vuelo

- **Dónde**: supervisión/orquestación (`lib/agentes/supervision/supervisor.ts` +
  `lib/motor/orquestador.ts`). Dueños: **J** y **A**.
- **Qué pasa**: una decisión propuesta justo cuando se pausa el mundo queda
  **`escalada` a un humano de forma permanente**, con `evaluacion: null`, porque
  el supervisor no pudo evaluarla:
  ```
  Aviso preventivo al Ayuntamiento de Higueruelas | riesgo 20 | competencia autonoma
    evaluacion: null (puntuación None, aprueba None, motivoEscalado None)
    historial: propuesta (proteccion_poblacion) → escalada (supervisor,
               "El supervisor no ha podido evaluar (Mundo en pausa: no se hacen llamadas…)")
  ```
  Es decir: **pulsar "Parar" convierte en trabajo para una persona una decisión
  que la política marca como autónoma**, y al reanudar no se reintenta. En la
  demo se ve: aparecen decisiones en "Requiere tu decisión" que nadie ha escalado
  por criterio.
- **Sugerencia**: que un `AbortError` de pausa no escale; dejar la decisión en
  `propuesta` y que el supervisor la recoja al reanudar. Es el mismo patrón que
  J aplicó en el bug J-11 (`esAborto(e)`).
- **Prueba**: ninguna todavía. Es un efecto de carrera y prefiero no meter una
  prueba que dependa de pillar al supervisor en ese punto exacto.

### L-6 · Pausar el mundo unas cuantas veces DESACTIVA agentes de forma permanente

- **Dónde**: el contador de errores por agente (`lib/motor/orquestador.ts`) y la
  vigilancia del supervisor (`lib/agentes/supervision/supervisor.ts`). Dueños:
  **J** y **A**.
- **Qué pasa**: cada `AbortError` de "Mundo en pausa" cuenta como **error del
  agente**, y a los 5 el supervisor lo **pausa de forma permanente**. Durante la
  batería de pruebas (que pausa el mundo tres veces, unos 20 s cada vez) el
  registro quedó así:
  ```
  05:12:06 agente   El asesor legal no ha podido revisar "…": Mundo en pausa: no se hacen llamadas a la IA
  05:12:36 sistema  No se pudo analizar la cámara A-66 PK 614,9: Mundo en pausa: no se hacen llamadas a la IA
  05:12:36 sistema  No se pudo analizar la cámara EX-A1 PK 51,3: Mundo en pausa: no se hacen llamadas a la IA
  05:18:55 agente   Pausado Asesor legal por errores repetidos (5): requiere revisión humana.
  05:20:30 agente   Pausado Vigía de cámaras por errores repetidos (5): requiere revisión humana.
  ```
  Es decir: **pulsar "Parar" tres veces deja sin vigía de cámaras y sin asesor
  legal**, y hay que reactivarlos a mano desde `/agentes/<id>`. En la demo, el
  vigía de cámaras es una de las cosas más vistosas y el asesor legal es el que
  pone los fundamentos a cada decisión.
- **Misma familia que L-5 y que el bug J-11** (J ya aplicó `esAborto(e)` para que
  un aborto no pintara el servicio en rojo): falta aplicar el mismo criterio al
  **contador de errores del agente**. Un aborto provocado por el propio mando no
  es una avería del agente.
- **Y "reanudar" no recupera al agente**: el contador de errores **no se
  reinicia**. Medido: tras `POST /api/agentes/asesor_legal {accion:"reanudar"}`
  el agente vuelve a `observando` pero conserva `contadores.errores: 6`, así que
  el siguiente error lo vuelve a pausar en el acto (pasó a los pocos minutos:
  *"Pausado Asesor legal por errores repetidos (6)"*). Desde la sala, el botón de
  reanudar **no arregla nada de forma duradera**. Sugerencia: poner el contador a
  cero al reanudar a mano.
- **Nota aparte, medida en el mismo sitio**: en este proceso `asesor_legal` y
  `vigia_camaras` tienen `tiempoMaximoSeg: undefined` y el error que los tumba es
  *"Tiempo máximo agotado (30 s)"*, cuando J dejó `asesor_legal` en 120 s
  (`docs/CALIDAD.md` §1.8). Pinta a lo mismo que ya avisaron J y K: el registro de
  agentes se capturó al arrancar el proceso y la recarga en caliente no lo
  renueva. **Conviene reiniciar `:3100` antes de la demo** para que corran de
  verdad todos los parches de J y de K.
- **Prueba**: ninguna automatizada; hace falta pausar varias veces y es un efecto
  acumulativo entre ejecuciones. Queda medido y documentado.
- **Lo he dejado reanudado en `:3100`** (`POST /api/agentes/<id>
  {accion:"reanudar"}`), pero con los contadores en 5 y 6: se volverán a pausar
  al primer error. **Reiniciar el proceso antes de la demo.**

### V-1, V-2 y V-3 · Latencias variables (no son fallos, pero importan para la demo)

Los tres apartados siguientes no son errores: son **medidas**. Las tres cosas que
el jurado va a ver tardar —el comunicado, el aviso al pueblo y el plan nuevo tras
el giro del viento— dependen de cuándo despierte cada agente y de cuánto tarde el
modelo, y el peor caso es varias veces el mejor. Los plazos que pedía el encargo
(180 s, 120 s) **no se cumplen siempre**; el comportamiento sí.

#### V-1 · El comunicado del portavoz tarda entre 21 s y más de 5 minutos

Seis tandas medidas sobre el mismo escenario (foco manual en 39,79/−1,05,
ejecución limpia cada vez):

| Tanda | Comunicado publicado |
|---|---|
| 1 | **no** dentro de los 180 s del encargo |
| 2 | **+5 min 24 s** desde el ataque inicial (`04:33:20 → 04:38:44`) |
| 3 | **+21 s** |
| 4 | **+10 s** |
| 5 | **+90 s** |
| 6 | **+65 s** |

La causa está localizada: lo que despierta al portavoz no es el ataque inicial,
sino el primer `poblacion_avisada`, y eso depende de cuándo `proteccion_poblacion`
consiga proponer y ejecutar un aviso (medido entre 32 s y 206 s). Su
`motivoParaComunicar` además exige poblaciones en riesgo alto/inminente,
`nivelGravedad ≥ 1` o `areaHa > 20`, y un foco recién declarado en bosque húmedo
tiene 1,4 ha y nivel 0. J lo dio por "no publicado" con una ventana corta
(`docs/CALIDAD.md` §1.6.bis); con ventana larga **sí sale siempre**.

**Qué significa para la demo**: el portal ciudadano `/publico` puede estar vacío
los primeros minutos. Si eso importa, hay tres palancas (decisión de C y de la
orquestadora): bajar el umbral de `areaHa`, bajar la cadencia del portavoz
(300 s), o arreglar el riesgo de las poblaciones (petición abierta de J a K sobre
`riesgoPorEta`). **No lo he tocado.**

La prueba `(g)` usa un presupuesto de 7 minutos a propósito: valida el circuito
portavoz → `/api/comunicados` → `/publico`, no la latencia.

#### V-2 · El aviso autónomo a la población tarda entre 32 s y 3,5 minutos

Cinco tandas medidas, mismo escenario:

| Tanda | Primer `avisar_poblacion` intentado |
|---|---|
| 1 | **+82,7 s** (Tuéjar) |
| 2 | **+90,8 s** (Higueruelas) |
| 3 | **+32,3 s** (Higueruelas) |
| 4 | **> 120 s**: el supervisor escaló las dos primeras propuestas y el aviso bueno llegó después |
| 5 | **+206,0 s** (Torrijas) |

La tanda 4 es la interesante y **el sistema se comportó bien**: el supervisor
devolvió a un humano un "Aviso preventivo a Higueruelas por incendio activo a
16 km" y un "Aviso preventivo a Torrijas (27 km)" con motivos razonados
("*revisar por qué se avisa a Torrijas, fuera de la lista del ciclo*"), y el aviso
que sí procedía —Tuéjar, a 2,9 km— se ejecutó solo, en autónoma, y falló con el
motivo correcto (*"llamada: Falta DESTINO_DEMO"*). Es decir: la supervisión de
calidad funciona y cuesta tiempo. La prueba `(f)` usa 4 minutos de presupuesto por
eso.

#### V-3 · La replanificación por giro del viento tarda entre 14 s y más de 2 minutos

Seis tandas, desde `POST /api/focos/[id]/viento` hasta que el coordinador
propone la decisión nueva:

| Tanda | Replanificación propuesta |
|---|---|
| 1 | **+14,1 s** |
| 2 | **+42,3 s** |
| 3 | **+60,5 s** |
| 4 | **+84,7 s** |
| 5 | **+129,1 s** |
| 6 | **> 120 s** (la que agotó la ventana antigua) |

Es el riesgo **R-6** que dejó anotado J, ahora con seis medidas: el coordinador
tiene cadencia de 90 s y su modelo de razonamiento tarda 17-25 s, así que el peor
caso pasa de dos minutos. **El evento `viento_gira` y el recálculo del frente son
inmediatos** (≤ 6,1 s en las cuatro tandas): lo que tarda es la decisión nueva.
Para la demo conviene saberlo: tras forzar el viento, el mapa cambia enseguida
pero el plan nuevo puede tardar. La prueba `(e)` usa 4 minutos de presupuesto.

### Cosas que NO son fallos, pero conviene saber

- **`DELETE /api/focos/[id]/viento` no devuelve la meteo real en el acto.**
  Borra `meteoForzada` inmediatamente, pero `incendio.meteo` conserva los valores
  forzados hasta que el meteorólogo (al que se despierta en el acto) repite su
  ciclo. Es correcto, pero la prueba `(e)` tuvo que esperar a que vuelva la
  previsión real en vez de comprobarlo en la respuesta del DELETE.
- **`prensa_redes` puede no crear ningún foco** en una ejecución corta (medido:
  0 en una tanda y 1 en otra, "Incendio de Ponteareas", `detectado`, confianza
  0,7, sin unidades). La prueba `(h)` no exige que los haya: comprueba las
  invariantes solo sobre los que aparezcan.
- **El verificador es conservador con una sola fuente ciudadana, y está bien.**
  El mismo aviso web dio `nuevo_foco` en una tanda y `registrada` (confianza
  0,30, *"a la espera de más fuentes"*) en otra. No es un fallo: es la regla de
  "una noticia no confirma otra noticia" funcionando. Por eso `(m)` prueba la
  invariante (si no declara foco, no aparece ninguno) y no el veredicto concreto.
- **La replanificación no siempre lleva `sustituyeA`, y es correcto.** Si el
  único plan del coordinador ya estaba `ejecutada` cuando gira el viento, no hay
  nada que sustituir: la decisión nueva llega con `motivoReplanificacion` y
  `sustituyeA: null`. `(e)` solo exige `sustituyeA` si había un plan del
  coordinador vivo.
- **Los cortes de `factorAtaque`** en `lib/simulacion/contencion.ts` cambiaron
  mientras escribía las pruebas (1.000/4.000 → 2.000/6.000 m). La prueba fija
  ahora la **forma** (meseta 2,5 para focos pequeños, meseta 1 para grandes,
  monótona decreciente), no los cortes, para que K pueda seguir afinando.
