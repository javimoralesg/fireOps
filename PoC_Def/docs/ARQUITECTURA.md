# Atalaya Incendios · Arquitectura

Plataforma agéntica para gestionar incendios forestales en España: varios focos, en
distintas zonas geográficas, con agentes que **deciden y actúan** (llamadas, SMS, email,
despliegue de medios por carreteras reales, comunicados), un escenario que **cambia
mientras corre** (viento real de la previsión acelerado en el tiempo, satélite, cámaras,
llamadas ciudadanas), **supervisión humana** en una sala de mando y **aprendizaje** entre
ejecuciones.

Reto: HackSpain 2026 (HappyRobot). Jurado evalúa: decisión (sensatez sin todos los datos,
prioridad, adaptación), actuación (coordinación de gente + información + medios; ejecución
real fuera del sistema), supervisión (control humano, creatividad, aprendizaje).

## 1. Principios innegociables

1. **Nada simulado.** Cada dato tiene fuente y URL. Si falta un proveedor, error visible en
   la pantalla ("Groq sin clave"), nunca un valor inventado ni una latencia fingida.
2. **Los agentes actúan fuera del sistema.** Llamadas y SMS por HappyRobot, email por
   HappyRobot, tickets internos, rutas por OSRM. Proponer no basta: se ejecuta.
3. **El humano manda.** Política de autonomía configurable; todo se puede pausar,
   aprobar, denegar (con motivo) o asumir. Lo denegado enseña al sistema.
4. **Tiempo real.** Un solo proceso Node con el estado en memoria, SSE hacia la pantalla,
   persistencia asíncrona en Supabase. Sin polling en la UI.
5. **UX para un director de emergencias bajo presión.** Ver §7.
6. **Español en código, UI y documentación.** Nombres largos y claros; nada de siglas
   crípticas. Comentarios explican el porqué.
7. **Todo auditable.** Cada decisión en cada estado y cada acción ejecutada tiene su
   informe (acta), generado SIEMPRE de forma determinista a partir de los datos y, si hay
   IA, con narrativa añadida. Las trazas de cada ciclo de agente (qué vio, qué modelo llamó,
   qué produjo) se persisten. La vista `/auditoria` encadena decisión → acciones →
   resultados reales → trazas → evidencias → fundamentos, con exportación.

## 2. Stack

| Capa | Elección | Motivo |
|---|---|---|
| App | Next.js 16 (App Router, React 19, TS, Tailwind 4) | Un solo despliegue en Railway con API + UI |
| Proceso | Railway (Node persistente) | Bucle de agentes, SSE, análisis de cámaras cada X s |
| Datos | Supabase Postgres + pgvector (cliente `@supabase/supabase-js`, REST) | Histórico, lecciones, chunks con embeddings, sin gestionar contraseñas de BD |
| IA | HelmCode (inferencia en la UE, API compatible OpenAI, SDK `openai`): `deepseek-v4-flash` razonamiento, `glm5.3-flash`/`qwen3.6` rápido, `qwen3.6` visión, `whisper` STT, `kokoro` TTS · conmutable a Groq (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`) u OpenAI | Tarifa plana, datos en la UE, JSON estructurado (`json_schema` verificado) |
| Embeddings | HelmCode `qwen3-embedding` a 512 dims (matryoshka; 384 no admitido) con prefijos `query:`/`passage:` · respaldo local `@huggingface/transformers` (`Xenova/multilingual-e5-small`, rellenado a 512) · conmutable a Jina/OpenAI | Multilingüe; pgvector `vector(512)` |
| Voz/SMS/email | HappyRobot (instancia EU) | Plataforma del reto; agentes de voz entrantes y salientes |
| Mapa | Leaflet + OpenStreetMap | Toda España, sin clave |
| Geo | Overpass (pueblos, bomberos, hospitales, combustible), OSRM (rutas), Nominatim (geocodificación), Open-Meteo (meteo + elevación) | Reales y sin clave |
| Detección | NASA FIRMS (satélite), cámaras DGT (JPEG), Exa + Google News RSS (prensa), Bluesky (redes), AEMET/Meteoalarm (avisos) | Reales; claves gratuitas donde haga falta |

**Ámbito territorial: solo España.** `lib/dominio/espana.ts` guarda el contorno
administrativo (OSM, 17 anillos: península, Baleares, Canarias, Ceuta, Melilla,
Llívia y plazas de soberanía) y la prueba `enEspana`. Se aplica en un único
sitio por entrada: FIRMS descarta los píxeles de Portugal, Francia y Marruecos
que trae su caja envolvente; Overpass y Nominatim descartan pueblos, medios y
lugares del otro lado de la frontera; `declararFoco`, la centralita, las cámaras
de móvil, las órdenes a unidades y el clic del mapa rechazan puntos de fuera
con el mismo mensaje. El mapa no se desplaza más allá de `LIMITES_NAVEGACION` y pinta el
resto del mundo en rojo como zona excluida (`components/mapa/CapaFueraEspana.tsx` y el
portal público) usando los mismos anillos del contorno como agujeros de la máscara.
Lo heredado con coordenadas de fuera (focos que FIRMS creó en Argelia o Portugal antes
de la restricción, sus medios y pueblos, detecciones, avisos) lo descarta
`lib/motor/saneamientoEspana.ts` al arrancar (tras hidratar de Supabase) y en cada tick.

Los detalles verificados de cada API están en `docs/investigacion-apis-ia.md` y
`docs/investigacion-fuentes-datos.md` (los copia la sesión orquestadora desde el
scratchpad en cuanto los investigadores terminan; hasta entonces, modelos e URLs van por
variables de entorno con valores por defecto razonables).

## 3. Modelo de dominio

Contrato en `lib/dominio/tipos.ts` (leerlo entero antes de programar). Entidades:
`Incendio` (foco con perímetro, frente, predicción, meteo, peligro, combustible),
`Cluster` (patrón multi-foco), `Poblacion` (pueblo a avisar con riesgo y ETA del frente),
`Unidad` (medio con base, posición, ruta OSRM y progreso), `Hospital`, `Camara`,
`FocoSatelite`, `Observacion` (todo lo que entra por cualquier canal), `Decision`
(con `acciones`, `evidencias`, `fundamentos` legales, `evaluacion` del supervisor,
`competencia` por política), `Informe`, `Comunicado`, `Leccion`, `Ejecucion` (métricas),
`EstadoAgenteApp`, `Evento`, `PoliticaAutonomia`, `Documento`/`Chunk`/grafo de
conocimiento, y `Snapshot` (lo que viaja por SSE).

## 4. Tiempo de mundo

`Reloj.factor` minutos de mundo por minuto real (por defecto 12: 5 s reales = 1 min).
La propagación del fuego, el avance de las unidades por su ruta y el índice horario de la
previsión de Open-Meteo usan la hora de mundo. Así el viento **gira de verdad** según la
previsión real, en minutos de demo, y el escenario cambia solo. El usuario puede pausar,
cambiar el factor y "avanzar 1 h". Las entradas externas (llamadas, satélite, cámaras,
prensa) llegan en tiempo real y se sellan también con la hora de mundo.

## 5. Agentes de la aplicación

El registro operativo separa **fichas** y **capacidades**. En la topología por
defecto hay cinco fichas (`observador`, `planificador_operativo`, `comunicador`,
`guardian` y `cronista`) para la sala; bajo ellas siguen ejecutándose las 16
capacidades históricas con su cadencia, eventos, timeout y concurrencia propios.
No se ha concentrado el comportamiento en cinco prompts. `lib/agentes/logicos.ts`
contiene la composición y `lib/agentes/identidad.ts` conserva los ids históricos
como aliases para API, URL y trazas. `AGENT_TOPOLOGY=legacy` conserva el registro
de 16 fichas para rollback; `shadow` no puede aplicar efectos; `five` es el
corte activo.

Cada capacidad implementa `Agente` de `lib/motor/contratos.ts`. El orquestador
(`lib/motor/orquestador.ts`) la ejecuta por cadencia o al recibir un evento de
`despiertaCon`, le inyecta lecciones relevantes y recoge `ResultadoCiclo`,
atribuyendo el resultado a su ficha lógica cuando está activa la topología five.

**Dos cosas distintas comparten tablero** (`lib/dominio/clase-agente.ts`):

- **Agentes** (12): llaman a un modelo, interpretan, proponen y pueden
  equivocarse. Su trabajo hay que supervisarlo, y cuesta tokens y segundos.
- **Entradas deterministas** (4: `satelite`, `meteorologo`, `propagacion`,
  `despachador`): no llaman a ningún modelo. Recogen un dato de una fuente real
  (FIRMS, Open-Meteo, OSRM) o calculan con una fórmula. Mismo dato de entrada,
  mismo resultado, siempre. No hay nada que supervisar y no cuestan ni un token.

La clase se deduce de `modelo`, no es un campo nuevo. La sala las distingue con
una etiqueta: decir "16 agentes" hacía pensar que hay dieciséis cosas razonando
y equivocándose, y son doce.

| id | Nombre | Categoría | Modelo | Cadencia | Se despierta con | Qué hace |
|---|---|---|---|---|---|---|
| `vigia_camaras` | Vigía de cámaras | percepción | visión | `CAMARAS_INTERVALO_SEG` | `incendio_nuevo` | Analiza en vivo las cámaras DGT/Madrid vigiladas (cerca de focos + muestreo de zonas forestales de alto peligro). Dos positivos seguidos → observación `camara` |
| `satelite` | Satélite | percepción | determinista | 600 s | — | FIRMS VIIRS/MODIS sobre España, agrupa puntos, crea/confirma focos |
| `prensa_redes` | Prensa y redes | percepción | rápido | 180 s | `incendio_nuevo` | Exa + Google News RSS + Bluesky, solo publicaciones de los últimos 15 días (`lib/fuentes/recencia.ts`); extrae eventos de incendio con municipio; observaciones `prensa`/`rrss` |
| `centralita` | Centralita | percepción | rápido | evento | webhooks | Recibe llamadas (HappyRobot voz), SMS, email y formulario web; extrae lugar, gravedad, personas en riesgo; geocodifica; observación. Da contexto al agente de voz (`GET /api/happyrobot/contexto`) |
| `meteorologo` | Meteorólogo | percepción | determinista + rápido | 60 s | `incendio_nuevo` | Open-Meteo por foco (actual + horaria acelerada), AEMET/Meteoalarm; índice de peligro; detecta giro > 30° o subida de rachas → evento `viento_gira` |
| `verificador` | Verificador | análisis | rápido | evento | `observacion` | Deduplica, cruza fuentes (cámara/satélite/meteo/otras observaciones), asigna impacto (`ruido`…`nuevo_foco`), sube confianza, crea/actualiza incendios |
| `propagacion` | Analista de propagación | análisis | determinista | 30 s | `viento_gira` | Modelo elíptico (viento, humedad, pendiente, combustible): avanza perímetro, frente, predicción +1/+3/+6 h, ETA por pueblo, riesgo de cada población |
| `patrones` | Analista de patrones | análisis | razonamiento | 120 s | `incendio_nuevo` | Con ≥ 2 focos a < 30 km o < 2 h: mismo incendio / serie sospechosa (SEPRONA) / convergencia; crea `Cluster` y recomendación conjunta |
| `coordinador` | Coordinador de medios | planificación | razonamiento | 90 s | `incendio_nuevo`, `viento_gira`, `peligro_sube`, `unidad_llega` | Plan multi-paso por foco/clúster: qué unidades (OSRM), sectores, medios aéreos, prioridad entre focos; **replanifica** cuando gira el frente (decisión `sustituyeA`) |
| `proteccion_poblacion` | Protección de población | planificación | razonamiento | 60 s | `viento_gira`, `incendio_nuevo` | Por pueblo en trayectoria: avisar / confinar / evacuar, orden y canal; guion de llamada al ayuntamiento; SMS |
| `asesor_legal` | Asesor legal | planificación | rápido + RAG | evento | `decision_propuesta` | Recupera chunks del grafo de conocimiento, añade `fundamentos` y `alertasLegales` (quién puede ordenar qué); si viola protocolo → competencia `humano` |
| `ejecutor` | Ejecutor de comunicaciones | ejecución | determinista | evento | `decision_aprobada` | Ejecuta acciones: HappyRobot voz/SMS/email, tickets; procesa resultados de webhook (contestó, confirmó, rechazó) |
| `despachador` | Despachador de unidades | ejecución | determinista | tick | `decision_aprobada` | Aplica despliegues: ruta OSRM, estado, avance por carretera real según tiempo de mundo, llegada, orden a la unidad (SMS/llamada) |
| `portavoz` | Portavoz | comunicación | razonamiento | evento | `poblacion_avisada`, `incendio_actualizado` | Comunicados oficiales (es + en, opcional ca/gl/eu) al portal ciudadano y canales; requiere aprobación según política |
| `supervisor` | Supervisor de calidad | supervisión | razonamiento | evento | `decision_propuesta` | Evalúa cada decisión (fundamentación, prioridad, coherencia con meteo y medios, legalidad, claridad) 0-100; < mínimo → `escalada` a humano; vigila errores/latencia de agentes y puede pausarlos |
| `memoria` | Memoria y aprendizaje | aprendizaje | razonamiento | evento + 300 s | `decision_denegada`, `decision_aprobada`, `accion_ejecutada`, `accion_fallida` | Extrae `Leccion` de denegaciones (con el comentario humano), resultados de llamadas y puntuaciones; guarda con embedding; al arrancar cada ejecución recupera lecciones y métricas anteriores y las inyecta; post-mortem al cerrar |
| `redactor` | Redactor de informes | comunicación | razonamiento | evento | `decision_ejecutada`, `decision_denegada` | Informe Markdown por decisión teniendo en cuenta las decisiones anteriores del mismo incendio; informe de situación cada 30 min de mundo |

## 6. Flujos

### 6.1 Detección → foco
1. Entra una `Observacion` (llamada/SMS/email/web/prensa/rrss/satélite/cámara/manual).
2. `verificador` deduplica (geo + tiempo), cruza fuentes, decide `impacto`.
3. `nuevo_foco` → `Incendio` en `detectado` (o `confirmado` si ≥ 2 fuentes o si es manual
   desde la sala). Evento `incendio_nuevo`.
4. El núcleo enriquece el foco: municipio/provincia (Nominatim), entorno OSM a
   `radioOperativoKm` (pueblos, bomberos, hospitales, vulnerables, combustible), elevación,
   meteo; crea `Unidad` por cada parque/base real encontrado y `Poblacion` por cada pueblo.
5. Cámaras a < 25 km pasan a `vigilada`.
6. **Fuentes apagadas por el mando** (`Ejecucion.fuentesDesactivadas`, catálogo en
   `lib/dominio/fuentes-deteccion.ts`, cambio en `lib/motor/escenario.ts`): satélite,
   prensa y redes, cámaras fijas y avisos ciudadanos se pueden apagar por separado o todas
   a la vez («Simulacro»). Una fuente apagada no se recoge (su agente no ejecuta ciclos y
   lo dice en su ficha) y sus avisos quedan `registrada` sin crear, confirmar ni corroborar
   focos. Al apagarla, los focos **sin confirmar** que solo sostenía esa fuente se descartan y
   sus pueblos se sueltan (`descartarFocosDeFuentesApagadas`); se quedan los confirmados (por
   otra fuente o por el mando) y los que tienen alguna observación de una fuente activa. La
   declaración a mano y las cámaras de móvil no se apagan nunca: con las cuatro fuentes
   apagadas («Simulacro») en el mapa solo quedan los focos a mano, de móvil y los confirmados.

### 6.2 Decisión → ejecución
1. Un agente de planificación devuelve `Decision` (estado `propuesta`).
2. `asesor_legal` añade fundamentos/alertas.
3. `lib/dominio/politica.ts#evaluarCompetenciasAcciones` fija `riesgo` y
   `competencia` por acción. La decisión muestra el máximo necesario; la política,
   la gravedad y los umbrales solo pueden elevarlo.
4. `supervisor` puntúa. Si `aprueba` y `competencia = autonoma` → `aprobada` sin humano.
   Si `supervisada` → `pendiente_humano` (con recomendación). Si suspende → `escalada`.
5. Humano aprueba/deniega desde la sala (comentario obligatorio al denegar).
6. `ejecutor` y `despachador` ejecutan cada `Accion` respetando `dependeDe`;
   las autónomas independientes pueden avanzar antes de la aprobación de sus
   hermanas humanas. Los resultados reales quedan en `accion.resultado`.
   Evento `decision_ejecutada`.
7. `redactor` genera el `Informe`. `memoria` extrae lecciones.

### 6.3 Replanificación (el frente gira)
`meteorologo` detecta giro → `viento_gira` → `propagacion` recalcula perímetro, ETA y
riesgo por pueblo → `coordinador` y `proteccion_poblacion` se despiertan y proponen
decisiones nuevas con `sustituyeA` y `motivoReplanificacion`; las pendientes obsoletas pasan
a `caducada`. La pantalla muestra "El frente ha girado 40° al NE: se replanifica".

### 6.4 Varios focos
`patrones` agrupa; el `coordinador` prioriza entre focos (población amenazada, ETA,
peligro, medios disponibles) y explica el orden. Reasignaciones entre focos son
`reasignar_unidad` (supervisada).

### 6.5 Intervención humana
- Tablero de agentes: pausar / reanudar / **asumir control** (sus propuestas pasan a
  supervisadas) / forzar ciclo.
- Bandeja "Requiere tu decisión": pendientes y escaladas, ordenadas por prioridad y ETA.
- Acciones manuales: añadir foco (clic en mapa), mover unidad, avisar pueblo, publicar
  comunicado, cerrar incendio. Se registran como `Decision` de `agenteId = "humano"`.
- Política de autonomía editable en vivo.

### 6.6 Aprendizaje
Cada ejecución guarda métricas (§`MetricasEjecucion`). Al arrancar, `memoria` compara con
la anterior y escribe la `comparativa`. Las lecciones se recuperan por similitud (embedding)
con el contexto de cada agente y se inyectan en su prompt con su `peso`; cuando una lección
evita una denegación, `vecesAplicada` sube y su peso también.

## 7. Sala de mando (UX)

Usuario: director/a de emergencias o técnico de sala, bajo presión, en pantalla grande,
a veces con ratón y a veces con dedo. Principios:

- **Un mapa manda.** Ocupa toda la pantalla; España completa al inicio, encuadre automático
  a los focos activos. Capas conmutables con un solo clic (focos y perímetros, predicción,
  unidades, pueblos por riesgo, hospitales, cámaras, viento, satélite). Unidades, bases y
  hospitales llevan además una casilla «solo en incendios» (activa por defecto, persistida)
  que esconde los cientos de parques y unidades en base que no intervienen. Flechas de viento
  alrededor de cada foco con dirección e intensidad; cono de propagación.
- **Jerarquía clara.** Lo urgente arriba a la derecha: "Requiere tu decisión (3)". Después
  agentes (qué hace cada uno, por categoría), después registro vivo. Nunca más de tres
  niveles de profundidad. El borde entre mapa y panel se arrastra para repartir el ancho
  (queda guardado en el navegador; doble clic lo restablece) y el contenido se adapta: a
  partir de ~40 rem las tarjetas pasan a las rejillas por columnas del modo ampliado, con el
  número de columnas según el ancho real del panel (`@container`). El panel se pliega a un carril
  con el contador de cada sección (el mapa gana el espacio) y se amplía a pantalla completa
  (tecla `P`) para gestionar decisiones, agentes y focos sin el mapa delante; "Ver en el
  mapa" devuelve al mapa.
  Plegado no significa ciego: lo que requiere decisión sale como ventanas flotantes
  sobre el mapa, con Aprobar/Denegar, para no perder operatividad.
- **Cada cosa en una frase.** Decisiones con título, por qué, qué se va a hacer, riesgo y
  competencia; botones grandes Aprobar / Denegar (con motivo). Evidencias y fundamentos en
  un desplegable, no delante.
- **Estado siempre visible.** Barra superior: hora de mundo y factor (solo lectura, con
  «EN PAUSA» si procede), insignia de fuentes apagadas («SIMULACRO · solo focos a mano y
  móvil» / «Sin satélite»), servicios (verde/rojo con detalle al pasar el ratón).
- **Modo desarrollo.** Los controles de ejercicio (Pausar, ×N y +1 h del reloj; desplegable
  de ejecución con «Nueva ejecución», cierre y fuentes de detección; PARAR TODO; Declarar
  foco; Viento global) solo se ven con el conmutador «</>» de la segunda fila (preferencia
  del navegador, `lib/cliente/useModoDesarrollo.ts`). Sin él, un foco se declara con `F` +
  clic en el mapa y la pausa global con la barra espaciadora.
- **Feedback inmediato.** Toda acción devuelve confirmación (toast) y aparece en el
  registro. Optimista en UI, corregido por SSE.
- **Tema claro por defecto, oscuro disponible.** Contraste AA, foco visible, atajos de
  teclado (A aprobar, D denegar, Espacio pausa, F añadir foco), estados vacíos con guía
  ("Haz clic en el mapa o pulsa F para declarar un foco").
- **Accesible y tolerante.** Iconos con texto, colores nunca como única señal, tamaños de
  toque ≥ 44 px, sin scroll horizontal, responsive (tablet mínimo).
- **Cámaras en vivo.** Miniaturas que se refrescan solas con el último veredicto ("Sin
  humo · 12 s"), ampliables.

Rutas: `/` sala de mando · `/conocimiento` documentos y grafo · `/politica` autonomía ·
`/informes` · `/aprendizaje` ejecuciones y lecciones · `/agentes/[id]` detalle · `/publico`
portal ciudadano con comunicados · `/parte` formulario ciudadano de aviso.

## 8. API

| Ruta | Método | Uso |
|---|---|---|
| `/api/estado` | GET | Snapshot completo |
| `/api/estado/stream` | GET | SSE (`event: estado`, `data: Snapshot`) |
| `/api/eventos` | GET | Histórico paginado |
| `/api/reloj` | POST | `{factor?, pausado?, avanzarMin?}` |
| `/api/ejecucion` | POST | `{accion: "nueva"|"cerrar"|"fuentes", nombre?, fuentesDesactivadas?, quien?}` · `nueva` hereda las fuentes apagadas salvo que se manden · `fuentes` apaga/enciende fuentes de detección (lista completa; `[]` = operación real) |
| `/api/focos` | POST | Declarar foco manual `{lat, lon, nombre?, notas?}` |
| `/api/focos/[id]` | PATCH | Cambiar estado/notas |
| `/api/decisiones/[id]/aprobar` · `/denegar` | POST | `{quien, comentario}` |
| `/api/decisiones/manual` | POST | Decisión humana directa (acciones) |
| `/api/agentes/[id]` | POST | `{accion: "pausar"|"reanudar"|"asumir"|"liberar"|"ciclo"}` |
| `/api/unidades/[id]/ordenar` | POST | Orden manual `{destino, incendioId}` |
| `/api/poblaciones/[id]/avisar` | POST | Aviso manual |
| `/api/camaras` · `/api/camaras/[id]/imagen` · `/api/camaras/[id]/vigilar` | GET/GET/POST | Lista, proxy JPEG, alternar vigilancia |
| `/api/ingesta/observacion` | POST | Formulario web / integraciones |
| `/api/webhooks/happyrobot/llamada` · `/sms` · `/email` · `/resultado` | POST | Entradas y resultados de HappyRobot (cabecera `x-webhook-secret`) |
| `/api/happyrobot/contexto` | GET | Contexto para el agente de voz (¿incendios cerca de X?) |
| `/api/conocimiento/documentos` | GET/POST | Lista / subida txt-md (multipart o JSON) |
| `/api/conocimiento/grafo` | GET | Nodos y aristas |
| `/api/conocimiento/consultar` | POST | `{pregunta}` → chunks + respuesta |
| `/api/politica` | GET/PUT | Política de autonomía |
| `/api/informes` · `/api/informes/[id]` | GET | Informes |
| `/api/aprendizaje` | GET | Ejecuciones, métricas, lecciones |
| `/api/comunicados` | GET/POST | Portal ciudadano |
| `/api/salud` | GET | Estado de servicios externos |

## 9. Persistencia (Supabase)

Esquema en `lib/db/schema.sql` (lo aplica la sesión orquestadora con el conector de
Supabase). Tablas: `ejecuciones`, `incendios`, `unidades`, `poblaciones`, `observaciones`,
`decisiones`, `informes`, `comunicados`, `lecciones` (con `embedding vector(384)`),
`eventos`, `politica`, `documentos`, `chunks` (con `embedding vector(384)`), `relaciones`,
`camaras_analisis`. Funciones `buscar_chunks(consulta vector, k, filtro)` y
`buscar_lecciones(...)` para similitud coseno. El repositorio (`lib/db/repositorio.ts`)
escribe de forma asíncrona y tolerante: si Supabase no responde, la app sigue en memoria y
la barra de servicios lo muestra en rojo.

## 10. Convenciones

- Sin importar estáticamente archivos que no existen (tumba el servidor de desarrollo).
  Los índices de agentes (`lib/agentes/*/index.ts`) ya existen vacíos.
- Salidas de IA siempre estructuradas con `zod` + JSON Schema y un reintento de reparación.
- Toda llamada externa con `AbortSignal.timeout`, `cache: "no-store"` y caché en memoria
  cuando la fuente lo pide (Overpass, OSRM, Nominatim 1 req/s).
- Registrar en el `Evento` visible todo lo que un humano querría saber; en `console` solo
  diagnóstico.
- Los agentes no bloquean el tick: el orquestador los ejecuta con `Promise.race` contra un
  tiempo máximo y marcan `error` en su estado si fallan.
- Nada de `any`. Nombres en español. Comentario de cabecera en cada archivo con propósito y
  dueño.

## 11. Despliegue

Railway: `npm run build` + `npm start`; `instrumentation.ts` arranca el orquestador al
levantar el proceso (`register()` solo en runtime nodejs). Variables en `.env.example`.
Healthcheck `/api/salud`. Región EU. Ver `docs/DESPLIEGUE.md` y `docs/CLAVES.md` (cómo
obtener cada clave, paso a paso).
