# Fuentes de datos de Atalaya Incendios

> DUEÑO del documento y del código: **constructor B** (percepción y fuentes).
> Todo lo de aquí está **verificado contra la fuente real** el 19-09-2026 (las
> latencias son medidas, no estimadas). El detalle de la investigación previa,
> con las respuestas crudas, está en `docs/investigacion-fuentes-datos.md`.
>
> **Regla de oro: nada simulado.** Si una fuente falla, el módulo lanza un error
> con el motivo literal, el agente lo marca con `estado.marcarServicio(nombre,
> false, detalle)` y la sala de mando lo enseña en rojo. Jamás se rellena un
> hueco con un valor inventado.

## Tabla de fuentes

| Fuente | URL | Clave | Refresco / caché | Límite real | Módulo | Quién la usa |
|---|---|---|---|---|---|---|
| **Open-Meteo** (actual, horaria, elevación, multipunto) | `https://api.open-meteo.com/v1/forecast` · `/v1/elevation` | No | previsión 10 min · actual 5 min · elevación 24 h | ~600 req/min, 5.000/h, 10.000/día (uso no comercial) | `lib/fuentes/openMeteo.ts` | `meteorologo`, núcleo (enriquecimiento), `/api/fuentes/meteo` |
| **Índice de peligro** (cálculo propio) | — | No | en cada ciclo | — | `lib/fuentes/peligro.ts` | `meteorologo`, núcleo |
| **Overpass (OSM)** | `https://overpass-api.de/api/interpreter` → respaldo `https://overpass.kumi.systems/api/interpreter` | No | 6 h por punto redondeado | 2 slots por IP en overpass-api.de (429 si se pasan); kumi sin límite anunciado pero lento | `lib/fuentes/overpass.ts` | núcleo (`enriquecerIncendio`), `/api/fuentes/entorno` |
| **OSRM** (rutas y matriz) | `https://router.project-osrm.org` | No | 30 min por par origen-destino | servidor de demostración, sin SLA; < 1 req/s sostenida | `lib/fuentes/osrm.ts` | constructor D (movimiento de unidades), núcleo |
| **Nominatim** | `https://nominatim.openstreetmap.org` | No | permanente en memoria | **1 req/s** (serializado en una cola) + User-Agent obligatorio | `lib/fuentes/nominatim.ts` | `centralita`, `prensa_redes`, núcleo |
| **Cámaras DGT (eTraffic)** | `POST https://etraffic.dgt.es/etrafficWEB/api/cache/getCamaras` · imagen `https://etraffic.dgt.es/camarasEtraffic/<id>.jpg` | No | catálogo 1 h · imagen 5 s | sin límite documentado (CDN Akamai); la imagen se refresca cada 2–6 min | `lib/fuentes/dgtCamaras.ts` | `vigia_camaras`, `/api/camaras` |
| **Cámaras Ayto. Madrid** | `https://informo.madrid.es/informo/tmadrid/CCTV.kml` · imagen `.../cameras/Camara<n>.jpg` | No | catálogo 1 h | sin límite documentado | `lib/fuentes/camarasMadrid.ts` | `vigia_camaras` |
| **Móvil en campo** (`/movil`) | `POST /api/camaras/movil` (propio) | No | fotograma cada 10 s, analizado al llegar | — | `lib/fuentes/camarasMovil.ts` | `vigia_camaras`, página `/movil` |
| **NASA FIRMS** (focos VIIRS) | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{FUENTE}/-9.5,35.9,4.4,43.9/1` | **Sí** (`FIRMS_MAP_KEY`) | 15 min | **5.000 transacciones / 10 min**; rango máximo **5 días** (medido 2026-09-19: con 7 responde `Invalid day range. Expects [1..5]`) | `lib/fuentes/firms.ts` | `satelite`, `/api/fuentes/satelite` |
| **Meteoalarm** (avisos España) | `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain` | No | 10 min | sin límite publicado; el feed se actualiza cada 10-15 min | `lib/fuentes/avisos.ts` | `meteorologo`, `/api/fuentes/avisos` |
| **AEMET OpenData** (avisos CAP) | `https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/esp` | **Sí** (`AEMET_API_KEY`) | 10 min | no publicado; patrón de **dos pasos** e ISO-8859-15 | `lib/fuentes/avisos.ts` | `meteorologo` (opcional) |
| **Google News RSS** | `https://news.google.com/rss/search?q=…&hl=es&gl=ES&ceid=ES:es` | No | por ciclo (180 s) | no documentado | `lib/fuentes/rss.ts` | `prensa_redes`, `/api/fuentes/prensa` |
| **Bluesky** | `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts` | No | por ciclo (180 s) | ~3.000 req/5 min por IP (no verificado) | `lib/fuentes/bluesky.ts` | `prensa_redes` |
| **Exa** (búsqueda semántica) | `POST https://api.exa.ai/search` | **Sí** (`EXA_API_KEY`) | por ciclo (180 s) | según plan | `lib/fuentes/exa.ts` | `prensa_redes` |
| **Modelo de visión** | proveedor de `lib/ia/llm.ts` (papel `vision`) | **Sí** (clave del proveedor) | `VISION_IMAGENES_POR_MINUTO` (12 por defecto, 3 con Groq) | Groq gratuito: 8.000 TPM ≈ 3 imágenes/min | `lib/agentes/percepcion/vigiaCamaras.ts` | `vigia_camaras` |

### Fuentes descartadas y por qué

- **EFFIS/GWIS como API de focos**: responde sin clave, pero su WFS devuelve
  registros de 2019 y no admite filtro por fecha (comprobado). Solo sirve como
  **capa WMS visual** (`effis.nrt.ba`, `mf010.fwi`; acuérdate de `&styles=`).
  **No hay ninguna alternativa a FIRMS sin clave.**
- **DATEX2 de cámaras de la DGT**: no existe (404). El API bueno es el del
  visor eTraffic (POST + base64 con XOR 0x66).
- **Reddit** (403/OAuth), **Windy Webcams** (clave y poco aporte), **MITECO/EGIF**
  (anual), **INE Tempus3** (OSM ya trae `population`), **Copernicus EMS** (feeds rotos).

## Latencias y volúmenes medidos hoy (19-09-2026)

| Operación | Medida real |
|---|---|
| `meteoActual` / `previsionHoraria` (Ávila) | 14–210 ms |
| `elevacion` | ~150 ms (1.086 m en Ávila) |
| `rejillaViento` 3×3 | ~200 ms, una sola llamada |
| `entornoIncendio(Ávila, 30 km)` | **5–7 s** la consulta de puntuales + **1,8 s** la de superficies (en serie). Devuelve 161 poblaciones, 3 parques de bomberos, 61 centros sanitarios, 61 vulnerables |
| `ruta` OSRM (Ávila → Navaluenga) | 206 ms · 38,4 km · 41 min · 1.178 puntos |
| `municipioDe` Nominatim | ~290 ms (más la cola de 1 s) |
| `listarCamarasDgt` | 237 ms · **1.948 cámaras** |
| `listarCamarasMadrid` | 97 ms · **357 cámaras** |
| Catálogo fusionado | **2.305 cámaras**; 24 a menos de 30 km de Ávila (la más cercana a 5,79 km, AP-51 pk 103,9) |
| Imagen de cámara (proxy) | ~1,1 s · JPEG 1280x720, 70 KB |
| `avisosMeteoalarmEspana` | 213 ms · 16 avisos vigentes |
| `noticiasGoogle` | ~480 ms · 10 titulares |
| `buscarPosts` Bluesky | ~580 ms · 10 publicaciones |
| Análisis de visión (HelmCode qwen3.6) | 2,8–5,6 s por imagen · ~750 tokens de entrada |
| Extracción de la centralita (papel rápido) | ~9 s por aviso |

Trampas ya resueltas en el código (no volver a tropezar con ellas):

- **Overpass sin `User-Agent` → 406.** Agrupar los `amenity` en una sola
  expresión regular baja la consulta de 14 s a 5-7 s.
- **Meteoalarm con cabecera `Accept` → 406.** Hay que mandar solo `User-Agent`.
  El color del aviso está en el `<title>` del entry, no en `awareness_level`.
- **DGT sin cuerpo en el POST → 411.** Hay que enviar `{}` y `Content-Type:
  application/json`; la respuesta es base64 + XOR `0x66` antes de ser JSON.
- **`Number(url.searchParams.get("lat"))` es 0 cuando el parámetro falta**, no
  NaN: todas las rutas usan un ayudante `num(url, nombre)` que devuelve NaN.
- **Open-Meteo redondea las coordenadas a la celda del modelo**: el paso mínimo
  útil de la rejilla de viento es 0,05°.

## Cómo obtener cada clave

### `FIRMS_MAP_KEY` — NASA FIRMS (≈ 5 minutos, PRIORITARIA)

Sin ella **no hay detección satelital**: el agente `satelite` se pone en rojo y
lo dice en pantalla (no inventa focos).

1. Entrar en **https://firms.modaps.eosdis.nasa.gov/api/map_key/**.
2. Pulsar el botón de solicitud e introducir **solo el correo electrónico**. No
   hace falta cuenta Earthdata.
3. La clave llega **por email** (texto hexadecimal de ~32 caracteres), en minutos.
4. Si el correo ya estaba registrado, se reenvía desde
   `https://firms.modaps.eosdis.nasa.gov/download/`.
5. Comprobarla:
   ```bash
   curl -s "https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=$FIRMS_MAP_KEY"
   curl -s "https://firms.modaps.eosdis.nasa.gov/api/area/csv/$FIRMS_MAP_KEY/VIIRS_NOAA20_NRT/-9.5,35.9,4.4,43.9/1"
   ```
6. Guardarla como `FIRMS_MAP_KEY` en `.env.local` y en las variables de Railway.
   Límite: **5.000 transacciones cada 10 minutos** (pedir varios días cuenta como
   varias transacciones).

### `AEMET_API_KEY` — AEMET OpenData (≈ 5 minutos, OPCIONAL)

Sin ella se usan los avisos de **Meteoalarm**, que reemite los de AEMET.

1. Entrar en **https://opendata.aemet.es/centrodedescargas/altaUsuario**.
2. Poner el correo y aceptar las condiciones (no hay formulario largo).
3. Llega un correo con un enlace de confirmación; al pulsarlo se obtiene la
   clave, que es un **JWT largo** (tres segmentos separados por puntos).
4. Comprobarla (recordar el **patrón de dos pasos**):
   ```bash
   curl -s "https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/esp?api_key=$AEMET_API_KEY"
   # -> {"estado":200,"datos":"https://opendata.aemet.es/opendata/sh/XXXX", ...}
   curl -s "https://opendata.aemet.es/opendata/sh/XXXX" -o avisos.tar.gz   # segundo GET obligatorio
   ```
5. Ojo: el paquete es un **TAR.GZ** de XMLs CAP en **ISO-8859-15**. El módulo
   lee XML plano; si llega comprimido lo dice y usa Meteoalarm.

### `EXA_API_KEY` — Exa (≈ 3 minutos, OPCIONAL)

Sin ella el agente de prensa se queda con Google News RSS + Bluesky, que no
necesitan clave.

1. Entrar en **https://exa.ai** y crear una cuenta (hay plan gratuito de prueba).
2. En el panel, sección **API Keys**, crear una clave nueva y copiarla.
3. Comprobarla:
   ```bash
   curl -s -X POST https://api.exa.ai/search -H "x-api-key: $EXA_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"query":"incendio forestal España","category":"news","numResults":3}'
   ```
4. Guardarla como `EXA_API_KEY`.

### Sin clave (no hay que hacer nada)

Open-Meteo · Overpass · OSRM · Nominatim · cámaras de la DGT · cámaras del
Ayuntamiento de Madrid · Meteoalarm · Google News RSS · Bluesky (`api.bsky.app`).

## Rutas de diagnóstico (todas devuelven datos reales)

| Ruta | Para qué |
|---|---|
| `GET /api/fuentes/salud` | Una petición mínima a cada fuente con su latencia; deja el resultado en `estado.servicios` |
| `GET /api/fuentes/meteo?lat&lon[&hora&rejilla=5&radio=15]` | Meteo actual, interpolada a una hora de mundo, peligro, regla 30-30-30 y rejilla de viento |
| `GET /api/fuentes/entorno?lat&lon&radio` | Pueblos, bomberos, policía, sanidad, vulnerables, aguas y combustible del OSM |
| `GET /api/fuentes/satelite[?dias&canarias=1]` | Focos VIIRS agrupados (503 con instrucciones si falta la clave) |
| `GET /api/fuentes/prensa?q=…` | Google News + Bluesky + Exa, cada fuente con su error si falla |
| `GET /api/fuentes/camaras/cercanas?lat&lon[&radio&max]` | Cámaras reales ordenadas por distancia |
| `GET /api/fuentes/avisos` | Avisos vigentes (AEMET si hay clave, Meteoalarm si no) |
| `POST /api/fuentes/centralita` `{canal, texto, remitente?, lat?, lon?}` | Prueba de `procesarEntrada` sin depender de los webhooks |
| `GET /api/fuentes/centralita?lat&lon` ó `?lugar=` | Contexto para el agente de voz |
| `GET /api/camaras[?lat&lon&radio&max&todas=1]` | Catálogo completo con las vigiladas primero y su último análisis |
| `GET /api/camaras/[id]/imagen` | Proxy del JPEG en vivo (`Cache-Control: no-store`) |
| `POST /api/camaras/[id]/vigilar` `{vigilada}` | Poner o quitar una cámara de la ronda del Vigía |
| `POST /api/camaras/movil` | Fotograma + GPS desde la página `/movil` |
