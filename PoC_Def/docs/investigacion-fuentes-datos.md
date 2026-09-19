# Investigación de fuentes de datos reales — plataforma agéntica de incendios forestales (España)

**Fecha de verificación: 2026-09-19 (~02:00–02:20 CEST / 00:00–00:20 UTC)**
Todo lo marcado ✅ VERIFICADO se comprobó con `curl` real desde esta sesión. Lo marcado ⚠️ NO VERIFICADO no se pudo comprobar (normalmente por requerir clave).

Muestras guardadas en esta misma carpeta (`scratchpad/`):
`muestra-dgt-camaras.json`, `dgt-camaras.csv` (1948 cámaras), `muestra-camara-176130.jpg`,
`muestra-madrid-cctv.kml`, `muestra-madrid-cam.jpg`, `muestra-sct-camaras.xml`, `muestra-sct-cam.img`,
`muestra-euskadi-camaras.json`, `muestra-openmeteo-avila.json`, `muestra-openmeteo-rejilla.json`,
`muestra-meteoalarm-es.xml`, `muestra-googlenews.xml`, `muestra-bluesky.json`, `muestra-mastodon.json`,
`muestra-overpass-avila.json`, `muestra-overpass-forest.json`, `muestra-osrm.json`, `muestra-nominatim.json`,
`muestra-municipios-ods.json`, `muestra-effis-nrt-ba.json`, `muestra-effis-viirs-hs.json`, `muestra-effis-fwi.png`,
`effis-caps.xml`, `q-avila.overpassql`, `q-forest.overpassql`.

---

## 1. CÁMARAS DE TRÁFICO

### 1.1 DGT — toda España ✅ VERIFICADO (hallazgo principal)

**El DATEX2 de cámaras NO existe.** `https://infocar.dgt.es/datex2/dgt/CCTVSiteTablePublication/all/content.xml` → **404**.
El índice real `https://infocar.dgt.es/datex2/dgt/` solo publica `MeasuredDataPublication/`, `PredefinedLocationsPublication/` y `SituationPublication/`.
`https://infocar.dgt.es/etraffic/` redirige (302) a `https://etraffic.dgt.es/etrafficWEB/`.
El patrón antiguo `https://infocar.dgt.es/etraffic/data/camaras/<id>.jpg` devuelve **302** (no sirve).

Inspeccionando el bundle `https://etraffic.dgt.es/etrafficWEB/assets/js/index-DImPYmsr.js` se encuentra el API real:

| Campo | Valor |
|---|---|
| **URL listado** | `POST https://etraffic.dgt.es/etrafficWEB/api/cache/getCamaras` |
| **Clave** | **No** |
| **Formato** | texto plano = **base64 + XOR 0x66** (`'f'`) → JSON |
| **Refresco** | `Cache-Control: max-age=2283` (≈38 min) en el listado; **las imágenes cada ~2-6 min** |
| **Límite** | Sin límite documentado; CDN Akamai, `server-timing: cdn-cache; desc=HIT` |
| **CORS** | `access-control-allow-origin: https://etraffic.dgt.es` → **hay que proxear desde el backend Next.js**, no vale fetch desde el navegador |
| **URL imagen** | `https://etraffic.dgt.es/camarasEtraffic/<idCamara>.jpg` (**este sí sin restricción CORS ni Referer**) |

**Requisitos de la petición (importante):** hace falta `Content-Type: application/json` **y un cuerpo** (`--data-raw '{}'`). Sin cuerpo el edge de Akamai devuelve **411 Length Required**.

```bash
curl -s -X POST "https://etraffic.dgt.es/etrafficWEB/api/cache/getCamaras" \
  -H "Content-Type: application/json" \
  -H "Origin: https://etraffic.dgt.es" \
  -H "Referer: https://etraffic.dgt.es/etrafficWEB/" \
  --data-raw '{}' --compressed -o camaras-raw.txt
```

Decodificación (equivalente TS/JS del `Ps()` del bundle):

```ts
export function decodeDgt(b64: string): string {
  const k = 'f'.charCodeAt(0);                 // 0x66
  const bin = Buffer.from(b64, 'base64');
  return Buffer.from(bin.map(b => b ^ k)).toString('utf-8');
}
// JSON.parse(decodeDgt(texto)) -> { camaras: [...], urlBase: "https://etraffic.dgt.es/camarasEtraffic/" }
```

**Respuesta real (fragmento, `muestra-dgt-camaras.json`):**

```json
{
  "urlBase": "https://etraffic.dgt.es/camarasEtraffic/",
  "camaras": [
    { "carretera": "A-62", "pk": 25.3, "coordX": -3.9403, "coordY": 42.2624, "sentido": "-", "idCamara": "176130" },
    { "carretera": "A-62", "pk": 31.2, "coordX": -3.9953, "coordY": 42.2272, "sentido": "+", "idCamara": "176131" },
    { "carretera": "A-62", "pk": 57.9, "coordX": -4.2227, "coordY": 42.0676, "sentido": "-", "idCamara": "2" }
  ]
}
```

**Datos comprobados:**
- **1948 cámaras** en toda España, **196 carreteras** distintas (A-7:145, A-6:119, A-4:88, A-2:82, A-3:79, A-5:74, A-8:65, A-1:54, AP-6:54, AP-66:53...).
- Campos: `idCamara` (string), `carretera`, `pk` (float), `sentido` (`+`/`-`/`-`), `coordX` = **longitud**, `coordY` = **latitud** (WGS84). **No hay campo de nombre**; el nombre legible viene rotulado dentro del propio JPEG.
- **89 cámaras a menos de 60 km de Ávila** (la más cercana a 5,8 km, AP-51 pk 103,9, id 168018).
- CSV completo ya generado en `dgt-camaras.csv` (columnas `idCamara,carretera,pk,sentido,coordY,coordX,urlImagen`).

**Imagen JPEG — verificada:**

```bash
curl -s -D - "https://etraffic.dgt.es/camarasEtraffic/176130.jpg" -o camara.jpg
# HTTP 200 · image/jpeg · 26.596 bytes · 853x480 · Last-Modified: Sat, 19 Sep 2026 00:04:50 GMT
# Cache-Control: max-age=120
```

La imagen descargada lleva rótulo quemado `A-62 PK025+300 D CELADA` arriba y marca de tiempo `19-09-2026 02:04:50` abajo → **el rótulo del JPEG da el topónimo que falta en el JSON**. Muestras de `Last-Modified` de 6 cámaras a las 00:11:11 UTC: 00:02:19, 00:02:33, 00:02:47, 00:03:35, 00:04:50, 00:05:08 → **refresco real ≈ cada 2–6 minutos** (no es vídeo).

**No hay streams m3u8 ni vídeo.** El bundle solo construye `${urlBaseCamaras}${idCamara}.jpg`; no aparece ninguna referencia a HLS/m3u8/RTSP.

**Otros endpoints del mismo API (misma decodificación, mismo método POST):**
`/etrafficWEB/api/cache/getFilteredData` (incidencias/situaciones DATEX), `/getPMVs` y `/getPMVDatos` (paneles de mensaje variable — útiles para mostrar avisos de corte de carretera), `/getLeyendaCache`, `/getCampanyas`.

> Nota: `getFilteredData` es POST con cuerpo de filtros (`filtrosVia`, `filtrosCausa`, `filtrosSubcausas`, `filtrosSubtipoVialidad`). No lo he ejecutado con filtros reales → ⚠️ NO VERIFICADO el esquema de respuesta de incidencias.

### 1.2 Ayuntamiento de Madrid ✅ VERIFICADO

| Campo | Valor |
|---|---|
| URL listado | `https://informo.madrid.es/informo/tmadrid/CCTV.kml` |
| Clave | No |
| Formato | KML (UTF-8 con BOM) · 239 KB · **357 cámaras** |
| URL imagen | `https://informo.madrid.es/cameras/Camara<Numero>.jpg` |
| Refresco | `Cache-Control: public, max-age=1`; `Last-Modified` ~1 min antes de la petición |
| Resolución | 1280x720, ~114 KB |

```bash
curl -s "https://informo.madrid.es/informo/tmadrid/CCTV.kml" -o CCTV.kml
curl -s "https://informo.madrid.es/cameras/Camara01301.jpg" -o cam.jpg   # HTTP 200, image/jpeg, 114310 bytes
```

Fragmento real:

```xml
<Placemark>
  <description>&lt;div align=center&gt;&lt;img src=https://informo.madrid.es/cameras/Camara06304.jpg?v=60832 width=300 height=220/&gt;&lt;br/&gt;PLAZA DE CASTILLA (SUR)&lt;/div&gt;</description>
  <ExtendedData>
    <Data name="Numero"><Value>06304</Value></Data>
    <Data name="Nombre"><Value>PLAZA DE CASTILLA (SUR)</Value></Data>
  </ExtendedData>
  <Point><coordinates>-3.68963237924212,40.4657761535436,10 </coordinates></Point>
</Placemark>
```

**Utilidad forestal: baja** (urbano puro). Sirve para demo de "más de una red" y para el monte de El Pardo / Casa de Campo.

### 1.3 Servei Català de Trànsit (Cataluña) ✅ VERIFICADO

| Campo | Valor |
|---|---|
| URL listado | `https://www.gencat.cat/transit/opendata/cameres.xml` (⚠️ `transit.gencat.cat/opendata/cameres.xml` da 404) |
| Clave | No |
| Formato | **WFS GML 1.0** (`cite:cameres`) · 91 KB · **164 cámaras** · 78 carreteras |
| Cobertura | lon 0,456→3,139 · lat 40,625→42,615 (incluye Pirineo y prelitoral — **zonas forestales reales**) |
| Imagen | `http://mct.gencat.cat/mct2bo/RenderService?sctidcam=<id>.gif` → **GIF animado 704x480, ~330 KB** (Content-Type declarado `image/jpeg` pero el contenido es GIF89a) |

```xml
<cite:cameres fid="cameres.fid-52bf6eca_1a0b6011fca_-17ad">
  <cite:geom><gml:Point srsName="...epsg.xml#4326">
    <gml:coordinates cs="," ts=" ">2.1849528,41.45989301</gml:coordinates>
  </gml:Point></cite:geom>
  <cite:carretera>C-58</cite:carretera>
  <cite:municipi>Nus Trinitat</cite:municipi>
  <cite:pk>0.50</cite:pk>
  <cite:link>http://mct.gencat.cat/mct2bo/RenderService?sctidcam=nc87.gif</cite:link>
  <cite:font>SCT</cite:font>
</cite:cameres>
```

⚠️ Ojo: `gml:coordinates` va en orden **lon,lat**. El GIF animado es pesado (330 KB) y difícil de pasar a un modelo de visión → si se usa, extraer un frame en el backend.

### 1.4 Euskadi / Bizkaia ✅ VERIFICADO (parcial)

| Campo | Valor |
|---|---|
| URL | `https://api.euskadi.eus/traffic/v1.0/cameras?_page=1` |
| Clave | No |
| Formato | JSON paginado · **489 cámaras**, 25 páginas (20/página) |
| Incidencias | `https://api.euskadi.eus/traffic/v1.0/incidences` (HTTP 200, 7,3 KB) |

```json
{"totalItems":489,"totalPages":25,"currentPage":1,"cameras":[
 {"cameraId":"75","sourceId":"2","cameraName":"CCTV 232 - Cámara DOMO 232","latitude":"4792953.64","longitude":"507650.15","road":"N - 637","kilometer":"016+500","address":"Cruces"},
 {"cameraId":"77","sourceId":"2","cameraName":"CCTV 300 - Cámara DOMO nudo Kukularra","urlImage":"http://www.bizkaimove.com/camaras/cam1.jpg","latitude":"4794665.86","longitude":"503178.8","road":"BI-637","kilometer":"008+500","address":"Kurtzes"}]}
```

⚠️ **Trampa:** `latitude`/`longitude` NO son WGS84, son **UTM ETRS89 huso 30N (EPSG:25830)** en metros. Hay que reproyectar (`proj4js`, `EPSG:25830 → EPSG:4326`). Solo algunas cámaras traen `urlImage`; no he verificado la descarga de esas imágenes → ⚠️ NO VERIFICADO.

### 1.5 Windy Webcams API ⚠️ REQUIERE CLAVE

`https://api.windy.com/webcams/api/v3/webcams?limit=1` → **403** `{"message":"Missing Header 'x-windy-api-key' with API key"}`.
Clave gratuita en https://api.windy.com/keys (plan Webcams gratuito, ~500 req/día aprox — **límite NO VERIFICADO**). Es la mejor opción para webcams *de montaña/forestales* reales, pero añade una clave más. **No recomendado para la PoC.**

### 1.6 Skyline Webcams / Meteocat webcams ⚠️ NO VERIFICADO

Skyline no ofrece API pública documentada y sus streams están protegidos por token de sesión (scraping frágil, términos restrictivos). Meteocat no expone un endpoint público de webcams estable. **Descartados.**

---

## 2. FOCOS ACTIVOS POR SATÉLITE

### 2.1 NASA FIRMS ✅ VERIFICADO (forma del endpoint) / ⚠️ datos requieren MAP_KEY

| Campo | Valor |
|---|---|
| **URL área** | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{DAY_RANGE}[/{YYYY-MM-DD}]` |
| Clave | **Sí, MAP_KEY gratuita** |
| Formato | CSV (también `/api/area/json/...` y `/kml/`) |
| Refresco | NRT: ~3 h tras la pasada del satélite (hasta ~14 pasadas/día sumando SNPP+NOAA20+NOAA21) |
| Límite | **5000 transacciones / 10 minutos**. Un `DAY_RANGE` grande cuenta como varias transacciones. `DAY_RANGE` máx 10 días |

Fuentes válidas: `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`, `MODIS_NRT`, `MODIS_SP`, `VIIRS_SNPP_SP`, `VIIRS_NOAA20_SP`, `LANDSAT_NRT`.

Pruebas reales hechas:

```bash
# Forma del endpoint CORRECTA (responde "Invalid MAP_KEY", es decir la ruta existe):
curl -s "https://firms.modaps.eosdis.nasa.gov/api/area/csv/DUMMY/VIIRS_SNPP_NRT/-9.5,35.9,4.4,43.9/1"
# -> HTTP 400  "Invalid MAP_KEY."

curl -s "https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/DUMMY/ALL"
# -> HTTP 401  "Invalid MAP_KEY."

curl -s "https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=DUMMY"
# -> HTTP 403  "MAP_KEY is invalid or your have exceeded your transaction/time limit."
```

⚠️ **El endpoint por código de país NO existe (o ya no).** Probado `/api/country/csv/DUMMY/VIIRS_SNPP_NRT/ESP/1` y `/api/country/csv/.../ESP/1/2026-09-18` → ambos **"Invalid API call." (400)**, distinto de "Invalid MAP_KEY", lo que indica ruta inválida. También `/api/countries` → "Invalid API call.".
→ **Usar siempre el endpoint `area` con bbox.** Para España peninsular + Baleares: `-9.5,35.9,4.4,43.9`. Canarias aparte: `-18.3,27.5,-13.3,29.5`.

**No hay ningún endpoint de FIRMS sin clave** (el de "data availability" también la exige).

**Columnas del CSV `area` para VIIRS** (documentadas; ⚠️ no verificadas con datos reales por falta de clave):
`country_id, latitude, longitude, bright_ti4, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_ti5, frp, daynight`
- `confidence` en VIIRS es `l`/`n`/`h` (low/nominal/high); en MODIS es 0–100.
- `frp` = Fire Radiative Power en MW (proxy de intensidad → **úsalo para ordenar/dimensionar el marcador**).
- `acq_time` es `HHMM` en UTC.
- `bright_ti4` = temperatura de brillo canal I-4 (K).

**Ejemplo listo para producción** (sustituye `MAP_KEY`):

```bash
curl -s "https://firms.modaps.eosdis.nasa.gov/api/area/csv/$FIRMS_MAP_KEY/VIIRS_NOAA20_NRT/-9.5,35.9,4.4,43.9/1"
```

### 2.2 Copernicus EFFIS / GWIS ✅ VERIFICADO (con matices importantes)

**Base:** `https://maps.effis.emergency.copernicus.eu/effis` · **sin clave** · MapServer WMS 1.3.0/1.1.1 + WFS 1.0.0.

```bash
curl -s "https://maps.effis.emergency.copernicus.eu/effis?service=WMS&request=GetCapabilities&version=1.3.0"
# HTTP 200, 104.545 bytes, 0,48 s
```

Capas útiles (extraídas del GetCapabilities real, `effis-caps.xml`):

| Capa | Qué es |
|---|---|
| `effis.nrt.ba` / `.poly` / `.point` | **Burnt Area NRT** — polígonos de superficie quemada derivados de clustering de hotspots VIIRS, "updated at each acquisition cycle (up to 14 passes per day)" |
| `viirs.hs`, `modis.hs`, `noaa.hs`, `all.hs` | Hotspots (+ `.query` para GetFeatureInfo) |
| `modis.ba.poly.today` / `.week` / `.month` / `.season` | Área quemada MODIS por ventana temporal |
| `mf010.fwi` | **Fire Weather Index** previsto. También `mf010.bui`, `.dc`, `.dmc`, `.ffmc`, `.isi`, `.anomaly`, `.ranking` |
| `fuel_map` | Mapa de combustible |

**⚠️ Tres trampas verificadas:**

1. **`STYLES` es obligatorio** (MapServer ≥ 8). Sin él:
   `ServiceException code="MissingParameterValue" ... Missing required parameter STYLES`.
   Con `&styles=` (vacío) funciona:
   ```bash
   curl -s "https://maps.effis.emergency.copernicus.eu/effis?service=WMS&version=1.1.1&request=GetMap&layers=mf010.fwi&styles=&srs=EPSG:4326&bbox=-9.5,35.9,4.4,43.9&width=600&height=400&format=image/png&transparent=true" -o fwi.png
   # HTTP 200, image/png, PNG 600x400 RGBA  ✅
   ```
   Igual para `layers=effis.nrt.ba` (HTTP 200, PNG válido). **→ Como capa raster de Leaflet (L.tileLayer.wms) funciona perfecto y sin clave.**

2. **El WFS devuelve las coordenadas en orden [lat, lon]** (invertido respecto a GeoJSON estándar). Hay que hacer swap.

3. **El WFS no ordena ni filtra por fecha de forma útil.** `&time=2026-09-17/2026-09-19` se ignora (siguió devolviendo `acq_at: 2019-11-13`) y el filtro OGC `<PropertyIsGreaterThan><PropertyName>acq_at</PropertyName>` devolvió 0 features. `service=WFS&request=GetCapabilities` hace **timeout a 60 s**. `GetFeature` con `version=2.0.0` + `outputFormat=application/json` da **502**.

**Lo que sí funciona en WFS:**

```bash
curl -s "https://maps.effis.emergency.copernicus.eu/effis?service=WFS&version=1.0.0&request=GetFeature&typename=effis.nrt.ba.poly&outputformat=geojson&bbox=-9.5,35.9,4.4,43.9&maxfeatures=2"
```
```json
{ "type": "FeatureCollection", "name": "effis.nrt.ba.poly", "features": [
 { "type": "Feature", "properties": { }, "geometry": { "type": "Polygon", "coordinates": [ [
   [ 36.1750145, 0.3961145 ], [ 36.1837, 0.39246 ], [ 36.1872355, 0.3939245 ], ... ] ] } } ] }
```
(HTTP 200, 0,27 s — nótese `properties: {}` vacío y coords [lat,lon]).

Y para hotspots (`viirs.hs`, con atributos ricos):
```json
{ "type": "Feature", "properties": { "id": "1044625866", "acq_at": "2019-11-13 01:00:00",
  "lon": "-0.24632", "lat": "39.66473", "frp": "5", "confidence": "102", "night": "true",
  "satellite": "N", "bright_mir": "3023", "bright_tir": "2763", "gid_0": "DZA",
  "ver": "1.0NRT", "CLASS": "FireSeason_N" }, "geometry": {...} }
```

`GetFeatureInfo` sobre `mf010.query` en Ávila devolvió `Search returned no results` (probablemente necesita dimensión `time` explícita) → ⚠️ NO VERIFICADO el valor puntual de FWI vía EFFIS.

**Conclusión EFFIS:** úsalo como **capa WMS visual** (perímetros NRT + mapa FWI), no como API de datos. Para datos numéricos, FIRMS.

---

## 3. METEOROLOGÍA

### 3.1 Open-Meteo ✅ VERIFICADO — la mejor opción

| Campo | Valor |
|---|---|
| URL | `https://api.open-meteo.com/v1/forecast` |
| **Clave** | **NO** |
| Formato | JSON |
| Refresco | Modelo actualizado cada hora; `current` con `interval: 900` (15 min) |
| Límite | ~10.000 llamadas/día, 5.000/h, 600/min para uso no comercial. **Sin registro.** |
| Latencia medida | **0,20–0,21 s** |

**Petición real para Ávila (40.66, -4.70):**

```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=40.66&longitude=-4.70&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,vapour_pressure_deficit,soil_moisture_0_to_1cm,et0_fao_evapotranspiration&forecast_days=2&timezone=Europe%2FMadrid"
```

Respuesta real (`muestra-openmeteo-avila.json`, HTTP 200, 3.623 bytes, 0,21 s):

```json
{"latitude":40.6875,"longitude":-4.6875,"generationtime_ms":0.229,"utc_offset_seconds":7200,
 "timezone":"Europe/Madrid","timezone_abbreviation":"GMT+2","elevation":1086.0,
 "hourly_units":{"time":"iso8601","temperature_2m":"°C","relative_humidity_2m":"%",
   "wind_speed_10m":"km/h","wind_direction_10m":"°","wind_gusts_10m":"km/h","precipitation":"mm",
   "vapour_pressure_deficit":"kPa","soil_moisture_0_to_1cm":"m³/m³","et0_fao_evapotranspiration":"mm"},
 "hourly":{"time":["2026-09-19T00:00","2026-09-19T01:00", ...]}}
```

**Todas las variables pedidas existen y responden 200:** `temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `precipitation`, `vapour_pressure_deficit`, `soil_moisture_0_to_1cm` (y `_1_to_3cm`, `_3_to_9cm`, `_9_to_27cm`, `_27_to_81cm`), `et0_fao_evapotranspiration`.
Previsión a 7 días: `&forecast_days=7` con `hourly` (por defecto ya son 7).

**Modelos ✅ VERIFICADO:** `&models=meteofrance_arome_france_hd,icon_eu,best_match` → HTTP 200. AROME HD (1,3 km) **no cubre España salvo la franja pirenaica**; para España usa `best_match` (ECMWF/ICON mezclado) o `icon_eu` (7 km). Cada modelo devuelve su propia serie sufijada (`wind_speed_10m_icon_eu`, …).

**❌ NO existe índice FWI en Open-Meteo:**
```bash
curl -s ".../forecast?latitude=40.66&longitude=-4.70&hourly=fire_weather_index"
# HTTP 400 {"error":true,"reason":"Invalid value: Cannot initialize ... from invalid String value fire_weather_index"}
```
→ **Hay que calcularlo o aproximarlo.** Recomendación pragmática para la PoC: índice propio derivado de variables que sí existen:
`riesgo = f(temperature_2m↑, 100-relative_humidity_2m↑, wind_speed_10m↑, wind_gusts_10m↑, vapour_pressure_deficit↑, días_sin_precipitation↑, soil_moisture_0_to_1cm↓)`.
El VPD (`vapour_pressure_deficit`, kPa) es el mejor predictor individual y es defendible ante un jurado. Si quieres FWI canadiense de verdad, se implementa con las ecuaciones de Van Wagner sobre T, HR, viento y lluvia de las 12:00 locales (FFMC→DMC→DC→ISI→BUI→FWI), pero es trabajo extra y necesita estado del día anterior.

**Elevation API ✅ VERIFICADO:**
```bash
curl -s "https://api.open-meteo.com/v1/elevation?latitude=40.66,40.41&longitude=-4.70,-4.71"
# {"elevation":[1086.0, 763.0]}
```
Acepta hasta 100 coordenadas por llamada. Útil para calcular pendiente (el fuego sube ~2x más rápido por pendiente).

**Multipunto ✅ VERIFICADO** (clave para el campo de viento — ver §7):
```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=40.60,40.66,40.72&longitude=-4.76,-4.70,-4.64&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,relative_humidity_2m&timezone=UTC"
```
Devuelve un **array JSON**, un objeto por punto (HTTP 200, 1.582 bytes, **0,20 s para 3 puntos**):
```json
[{"latitude":40.625,"longitude":-4.75,"elevation":1103.0,
  "current_units":{"wind_speed_10m":"km/h","wind_direction_10m":"°",...},
  "current":{"time":"2026-09-19T00:00","interval":900,"wind_speed_10m":3.5,"wind_direction_10m":246,"wind_gusts_10m":5.4,...}}, ...]
```

### 3.2 AEMET OpenData ⚠️ RUTAS VERIFICADAS, DATOS NO (requiere clave)

| Campo | Valor |
|---|---|
| Base | `https://opendata.aemet.es/opendata` |
| Clave | **Sí, gratuita** (`?api_key=` o cabecera `api_key`). Es un **JWT** |
| Formato | **Dos pasos**: la API devuelve `{"estado":200,"datos":"https://opendata.aemet.es/opendata/sh/XXXX","metadatos":"..."}` y hay que hacer un segundo GET a `datos` |
| Encoding | ⚠️ **ISO-8859-15**, no UTF-8. Hay que transcodificar |
| Límite | No publicado explícitamente; en la práctica ~unas pocas req/s. Los ficheros `sh/` caducan |

Verificación de rutas (con `api_key=X` inválida; **401 = la ruta existe**, **404 = la ruta no existe**):

```bash
curl -s "https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/esp?api_key=X"
# 401 {"descripcion":"JWT strings must contain exactly 2 period characters. Found: 0","estado":401}  -> RUTA OK ✅

curl -s "https://opendata.aemet.es/opendata/api/incendios/mapasriesgo/previsto/dia/1/area/p?api_key=X"   # 401 -> RUTA OK ✅
curl -s "https://opendata.aemet.es/opendata/api/incendios/mapasriesgo/estimado/area/p?api_key=X"          # 401 -> RUTA OK ✅
curl -s "https://opendata.aemet.es/opendata/api/observacion/convencional/todas?api_key=X"                 # 401 -> RUTA OK ✅
curl -s "https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion/2444?api_key=X"   # 401 -> RUTA OK ✅
curl -s "https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/diaria/05019?api_key=X"   # 401 -> RUTA OK ✅

# Contraste (ruta inventada):
curl -s "https://opendata.aemet.es/opendata/api/incendios/mapasriesgo/previsto/area/p?api_key=X"
# 404 HTML "HTTP Status 404"  -> confirma que el filtro sí distingue rutas
```

**Endpoints relevantes confirmados:**
- **Avisos CAP:** `/api/avisos_cap/ultimoelaborado/area/{area}` — `area` ∈ `esp`, `61` (And.), `62` (Arg.)... y por CCAA. Devuelve un TAR.GZ de XMLs CAP 1.2.
- **Riesgo de incendio forestal previsto:** `/api/incendios/mapasriesgo/previsto/dia/{1..N}/area/{area}` — **devuelve una IMAGEN de mapa**, no niveles por zona en datos estructurados. Áreas: `p` (península), `c` (Canarias), `b` (Baleares), etc.
- **Riesgo estimado:** `/api/incendios/mapasriesgo/estimado/area/{area}`.
- **Observación:** `/api/observacion/convencional/todas` (todas las estaciones, última hora) y `/api/observacion/convencional/datos/estacion/{idema}`.

⚠️ **Limitación importante:** el "riesgo de incendio" de AEMET es un **PNG/mapa**, no un valor numérico por municipio. No sirve para que un agente razone con números; sí para mostrarlo como imagen en el panel.

**Cómo obtener la clave:** ver §"Cómo obtener cada clave" al final.

### 3.3 Meteoalarm ✅ VERIFICADO — avisos de España SIN clave

| Campo | Valor |
|---|---|
| URL Atom | `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain` |
| URL JSON | `https://feeds.meteoalarm.org/api/v1/warnings/feeds-spain` |
| Clave | **NO** |
| Formato | Atom + CAP 1.2 embebido (86 KB) / JSON (2,3 MB) |
| Refresco | `<updated>` a 00:05:17 UTC en una petición de las 00:15 → **~cada 10-15 min** |
| Licencia | CC BY 4.0 con condiciones adicionales para redistribución |

```bash
curl -s "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain"
```
Fragmento real (`muestra-meteoalarm-es.xml`):

```xml
<updated>2026-09-19T00:05:17.763770Z</updated>
<entry>
  <cap:geocode><valueName>EMMA_ID</valueName><value>ES224</value></cap:geocode>
  <link title="Valle del Guadalentín, Lorca y Águilas" href="https://meteoalarm.org?geocode=EMMA_ID:ES224"/>
  <cap:areaDesc>Valle del Guadalentín, Lorca y Águilas</cap:areaDesc>
  <cap:event>Moderate thunderstorm warning</cap:event>
  <cap:sent>2026-09-18T16:28:08+00:00</cap:sent>
  <cap:expires>2026-09-19T15:59:59+00:00</cap:expires>
  <cap:effective>2026-09-18T16:25:44+00:00</cap:effective>
</entry>
```

**El feed JSON (2,3 MB) trae los avisos de España con geocódigo EMMA_ID por zona.** Es el sustituto sin clave de los avisos CAP de AEMET (de hecho, Meteoalarm reemite los de AEMET). El `awareness_type` incluye viento, calor extremo y **fuego** en temporada.

---

## 4. NOTICIAS Y REDES

### 4.1 Google News RSS ✅ VERIFICADO

| Campo | Valor |
|---|---|
| URL | `https://news.google.com/rss/search?q=incendio+forestal&hl=es&gl=ES&ceid=ES:es` |
| Clave | **NO** |
| Formato | RSS 2.0 + `media:` · **185.844 bytes, 105 items** |
| Refresco | Continuo (`lastBuildDate` al minuto) |
| Límite | No documentado; funciona sin User-Agent especial pero conviene ponerlo. Copyright restringe uso a "personal feed reader" — ⚠️ riesgo legal formal, tolerable en un hackathon |

Fragmento real (`muestra-googlenews.xml`), noticia de hoy:

```xml
<item>
  <title>Un incendio fuera de control en Tuéjar, Valencia, obliga a movilizar la UME y deja dos bomberos heridos leves - RTVE.es</title>
  <link>https://news.google.com/rss/articles/CBMisgFBVV95cUxONk1uUmdkd3BsN3g1QWtzM01vNnlz...?oc=5</link>
  <guid isPermaLink="false">CBMisgFBVV95cUxONk1uUmdkd3BsN3g1QWtzM01vNnlz...</guid>
</item>
```

⚠️ Los `<link>` son URLs de redirección de Google codificadas en base64 — para obtener la URL final hay que seguir el redirect o extraer el nombre del medio del `<title>` (formato `Titular - Medio`) y del `<source>`.
**Truco útil:** se pueden hacer búsquedas geográficas: `q=incendio+forestal+Ávila`, o acotar por tiempo con `q=incendio+forestal+when:1d`.

### 4.2 Bluesky ✅ VERIFICADO (con corrección de host)

**⚠️ `public.api.bsky.app` devuelve 403 para `searchPosts`** (probado con y sin User-Agent, con y sin `lang`). **El host que funciona es `api.bsky.app`.**

| Campo | Valor |
|---|---|
| URL | `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=incendio+forestal&lang=es&limit=25` |
| Clave | **NO** |
| Formato | JSON |
| CORS | `access-control-allow-origin: *` → **se puede llamar desde el navegador** |
| Límite | No devuelve cabeceras `ratelimit-*` en este endpoint. AT Protocol aplica ~3000 req/5 min por IP (⚠️ NO VERIFICADO) |

```bash
curl -s "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=incendio%20forestal&lang=es&limit=3"
```

Respuesta real (`muestra-bluesky.json`, HTTP 200, 7.378 bytes):
- Claves de nivel superior: `posts`, `cursor`, `hitsTotal`
- Claves de cada post: `uri`, `cid`, `author`, `record`, `embed`, `bookmarkCount`, `replyCount`, `repostCount`, `likeCount`, `quoteCount`, `indexedAt`, `labels`
- Primer resultado obtenido en vivo:
  - autor: `rioja2eldiario.bsky.social`
  - `record.createdAt`: `2026-09-18T18:48:46.541Z`
  - `record.text`: *"ÚLTIMA HORA: Controlado el incendio forestal de Igea que afecta a 25 hectáreas — www.eldiario.es/la-rioja/dec..."*
  - `likeCount: 0`, `repostCount: 0`

Parámetros útiles: `sort=latest`, `since`/`until` (ISO), `cursor` para paginar.

### 4.3 Reddit ❌ BLOQUEADO

```bash
curl -s -A "crisis-mando-ai/1.0" "https://www.reddit.com/r/spain/search.json?q=incendio&restrict_sr=1&sort=new&limit=3"
# HTTP 403 (189 KB de HTML de bloqueo)
```
Reddit exige ahora OAuth (`oauth.reddit.com` + app registrada). **Descartar para la PoC.**

### 4.4 Mastodon ✅ VERIFICADO — funciona SIN token (timeline de hashtag)

| Endpoint | Token | Resultado |
|---|---|---|
| `https://mastodon.social/api/v2/search?q=incendio&type=statuses` | requiere | HTTP 200 pero vacío sin token |
| `https://mastodon.social/api/v1/timelines/tag/incendio?limit=40` | **NO** | **HTTP 200, 9.349 bytes con contenido real** ✅ |

```bash
curl -s "https://mastodon.social/api/v1/timelines/tag/incendio?limit=2"
```
```json
[{"id":"117294173704132742","created_at":"2026-09-18T21:30:31.000Z","sensitive":false,
  "visibility":"public","language":"gl",
  "uri":"https://tardigram.com/m/MedioAmbiente/t/72999", ...}]
```
Límite: 300 req/5 min por IP (documentado, ⚠️ no verificado con cabeceras).

### 4.5 X/Twitter y Telegram — descartados (confirmado por el planteamiento).

---

## 5. OPENSTREETMAP

### 5.1 Overpass API ✅ VERIFICADO — rápido y suficiente

| Campo | Valor |
|---|---|
| URL | `https://overpass-api.de/api/interpreter` (POST con la query como cuerpo) |
| Clave | **NO** |
| Formato | JSON (`[out:json]`) |
| **⚠️ User-Agent obligatorio** | Sin UA devuelve **406 Not Acceptable** |
| Límite | 2 slots simultáneos por IP, ~10.000 s de CPU/día. `curl -s .../api/status` te dice tus slots |
| Refresco | ~1 minuto de retraso sobre OSM |

**Query verificada (radio 30 km, Ávila 40.66,-4.70) — `q-avila.overpassql`:**

```overpassql
[out:json][timeout:90];
(
  node["place"~"^(city|town|village|hamlet)$"](around:30000,40.66,-4.70);
  nwr["amenity"="fire_station"](around:30000,40.66,-4.70);
  nwr["amenity"="hospital"](around:30000,40.66,-4.70);
  nwr["amenity"="clinic"](around:30000,40.66,-4.70);
  nwr["amenity"="police"](around:30000,40.66,-4.70);
  nwr["amenity"="school"](around:30000,40.66,-4.70);
  nwr["social_facility"](around:30000,40.66,-4.70);
  nwr["man_made"="water_tower"](around:30000,40.66,-4.70);
  nwr["landuse"="reservoir"](around:30000,40.66,-4.70);
);
out center tags;
```

```bash
curl -s -A "crisis-mando-ai/1.0 (hackathon)" -X POST -d @q-avila.overpassql \
  https://overpass-api.de/api/interpreter
```

**Resultado real: HTTP 200, 113.413 bytes, 4,44 s, 275 elementos**
`village: 88, hamlet: 72, school: 45, water_tower: 26, clinic: 15, police: 13, social_facility: 10, fire_station: 3, hospital: 2, city: 1`

Fragmento real (`muestra-overpass-avila.json`) — **fíjate que OSM España trae `population` y `ref:ine`, oro puro:**

```json
{"type":"node","id":26024413,"lat":40.5547207,"lon":-4.8237308,
 "tags":{"capital":"8","ele":"1127","name":"Mironcillo","place":"village",
         "population":"108","population:date":"2025","ref:ine":"05130000101",
         "source":"Instituto Geográfico Nacional"}}
{"type":"node","id":64835827,"lat":40.414358,"lon":-4.785769,
 "tags":{"ele":"831","name":"Burgohondo","place":"village","population":"1196",
         "population:date":"2025","ref:ine":"05163000101"}}
```

**Query de superficies forestales/agua (geometría) — `q-forest.overpassql`, radio 15 km:**

```overpassql
[out:json][timeout:120];
(
  way["landuse"="forest"](around:15000,40.66,-4.70);
  way["natural"="wood"](around:15000,40.66,-4.70);
  way["natural"="scrub"](around:15000,40.66,-4.70);
  way["natural"="water"](around:15000,40.66,-4.70);
);
out geom;
```
**Resultado real: HTTP 200, 384.725 bytes, 1,74 s, 138 elementos** (wood 48, water 47, forest 32, scrub 11).

**Cómo trocear si se pone lento (recomendación):**
1. **Dos queries separadas**: "activos puntuales" (`out center tags`, ligera, 4 s / 113 KB) y "superficies" (`out geom`, pesada, crece con el cuadrado del radio). Nunca las mezcles.
2. Para superficies, **limita el radio a 10-15 km** y usa `out geom` solo ahí; para el halo exterior usa la capa WMS de EFFIS o el fondo del mapa.
3. Si necesitas >30 km, **trocea en 4 cuadrantes con `bbox`** y lánzalos secuencialmente (recuerda: solo 2 slots por IP; lanzar 4 en paralelo te da 429).
4. **Cachea en ArangoDB por celda geohash** (precisión 5, ~4,9 km): el mundo físico no cambia durante la demo.
5. Añade `[timeout:90]` y `[maxsize:67108864]` siempre.
6. `natural=heath`, `landuse=farmland` y `man_made=cutline` existen pero son raros en Ávila; inclúyelos solo si el coste no sube.

**Servidores alternativos ✅ VERIFICADOS (ambos responden `/api/status`):**
- `https://overpass.kumi.systems/api/interpreter` — sin límite de slots anunciado (`Rate limit: 0` = sin límite)
- `https://overpass.private.coffee/api/interpreter` — igual
- ❌ `https://overpass.osm.jp/` — **certificado TLS caducado**, no usar.

→ **Estrategia recomendada:** kumi.systems como primario (rate limit 0) y overpass-api.de como fallback.

### 5.2 OSRM público ✅ VERIFICADO — funciona en España rural

| Campo | Valor |
|---|---|
| URL | `https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}` |
| Clave | **NO** |
| Formato | JSON |
| Límite | "Demo server", sin SLA. No documenta límite exacto; recomiendan <1 req/s sostenida |

```bash
curl -s "https://router.project-osrm.org/route/v1/driving/-4.7000,40.6600;-4.7080,40.4101?overview=full&geometries=geojson&steps=false"
```
**Resultado real (Ávila → Navaluenga, carretera de montaña): HTTP 200, 26.321 bytes, 0,22 s**
`code: Ok`, `distance: 38407.3 m`, `duration: 2456.4 s (41 min)`, **1178 puntos de geometría**
`coordinates[0..2] = [[-4.699813,40.66003],[-4.699902,40.660346],[-4.69999,40.660657]]`

✅ Funciona perfectamente en rural. Parámetros útiles: `annotations=duration,distance`, `alternatives=true`.
**Para isócronas / "qué parque de bomberos llega antes":** usa `/table/v1/driving/{coords}?sources=0` (matriz de tiempos) en lugar de N rutas.

### 5.3 Nominatim ✅ VERIFICADO

| Campo | Valor |
|---|---|
| Búsqueda | `https://nominatim.openstreetmap.org/search?q=Navaluenga,%20Avila&format=jsonv2&limit=2&addressdetails=1` |
| Reverse | `https://nominatim.openstreetmap.org/reverse?lat=40.66&lon=-4.70&format=jsonv2&zoom=10&addressdetails=1` |
| Clave | **NO** |
| **Límite duro** | **1 req/s** y **User-Agent identificativo obligatorio**. Uso masivo = baneo de IP |

Respuestas reales:
```json
// search
[{"place_id":294334871,"osm_type":"relation","osm_id":342367,"lat":"40.4101393","lon":"-4.7079974",
  "addresstype":"village","name":"Navaluenga",
  "display_name":"Navaluenga, Ávila, Castilla y León, 05100, España",
  "address":{"village":"Navaluenga","state_district":"Ávila","ISO3166-2-lvl6":"ES-AV",
             "state":"Castilla y León","ISO3166-2-lvl4":"ES-CL","postcode":"05100","country":"España"},
  "boundingbox":["40.3574384","40.4387965","-4.7536000","-4.6198365"]}]

// reverse (zoom=10 -> municipio)
{"place_id":289802554,"osm_type":"relation","osm_id":348905,"addresstype":"city","name":"Ávila",
 "display_name":"Ávila, Castilla y León, España",
 "address":{"city":"Ávila","state_district":"Ávila","ISO3166-2-lvl6":"ES-AV",
            "state":"Castilla y León","country":"España","country_code":"es"},
 "boundingbox":["40.5607574","40.7536666","-4.8164528","-4.4536129"]}
```
`state_district` = provincia. `zoom=10` da municipio; `zoom=8` da provincia.

⚠️ **1 req/s es incompatible con geocodificar muchos puntos en la demo.** → usar el dataset local de §6.2.

---

## 6. OTROS DATOS DE ESPAÑA

### 6.1 Municipios con coordenadas ✅ VERIFICADO — la mejor opción sin clave

| Campo | Valor |
|---|---|
| URL | `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-spain-municipio/records` |
| Clave | **NO** |
| Formato | JSON (`limit` máx 100 por página; hay `/exports/csv` y `/exports/geojson` para bajarlo entero) |
| Total | **8.223 municipios** con centroide, código INE y provincia |
| Límite | ~10.000 llamadas/día anónimas en el portal público |

```bash
curl -s "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-spain-municipio/records?limit=1&select=mun_name,mun_code,prov_name,geo_point_2d"
```
```json
{"total_count": 8223, "results": [
  {"mun_name":"Cantiveros","mun_code":"05048","prov_name":"Ávila",
   "geo_point_2d":{"lon":-4.960137620359768,"lat":40.95583599853469}}]}
```

**Recomendación:** descargar **una sola vez** el CSV completo (`.../exports/csv?select=mun_name,mun_code,prov_name,geo_point_2d`) y guardarlo en el repo / ArangoDB. Geocodificación instantánea y offline, sin depender de Nominatim.
Alternativa oficial de códigos (sin coords): `https://www.ine.es/daco/daco42/codmun/diccionario25.xlsx` ✅ HTTP 200, 306 KB.

### 6.2 INE — población por municipio ✅ VERIFICADO (parcialmente)

```bash
curl -s "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/2879?nult=1"
# HTTP 200, 120.154 bytes, application/json
```
Sin clave. ⚠️ La API Tempus3 del INE es incómoda (tablas por id, series anidadas) y NO he validado el mapeo tabla→municipio.
**→ No merece la pena:** OSM ya trae `population` + `population:date` + `ref:ine` en los nodos `place` (verificado arriba, con datos de 2025). Usa eso.

### 6.3 Hospitales de España ⚠️ NO VERIFICADO / no recomendado

El Catálogo Nacional de Hospitales del Ministerio de Sanidad (`https://www.sanidad.gob.es/ciudadanos/prestaciones/centrosServiciosSNS/hospitales/home.htm`, también en `datos.gob.es`) se publica en **Excel/PDF/CSV con actualización ANUAL (enero)** y sin coordenadas geográficas fiables.
**→ Usa Overpass (`amenity=hospital`, `amenity=clinic`, `healthcare=*`), que sí trae lat/lon y está actualizado.**

### 6.4 MITECO / incendios forestales ⚠️ NO HAY TIEMPO REAL

La Estadística General de Incendios Forestales (EGIF) del MITECO es **anual y retrospectiva** (partes de incendio consolidados con años de retraso). No existe API pública de incendios activos del Ministerio. Las CCAA (que tienen la competencia) publican de forma dispar y sin API estable.
**→ Para "incendios activos ahora" la única fuente real y nacional es FIRMS + EFFIS + noticias.**

### 6.5 datos.gob.es API ✅ VERIFICADO (catálogo, no datos)

```bash
curl -s -H "Accept: application/json" \
 "https://datos.gob.es/apidata/catalog/dataset/title/incendios?_sort=title&_pageSize=3&_page=0"
# HTTP 200, 16.229 bytes, formato "linked-data-api" v0.2
```
Sin clave. Sirve para **descubrir** datasets, no para consumir datos en tiempo real.

### 6.6 Copernicus EMS (activaciones Rapid Mapping) ❌ NO VERIFICADO

`https://emergency.copernicus.eu/mapping/activations-rapid/feed` → **301**;
`https://rapidmapping.emergency.copernicus.eu/backend/feed/activations` → **404**.
El portal se ha reestructurado y no he encontrado un feed estable. **Descartar para la PoC.**

---

## 7. VIENTO PARA VISUALIZACIÓN EN LEAFLET

Opciones evaluadas:

| Opción | Veredicto |
|---|---|
| **Rejilla NxN con Open-Meteo multipunto** | ✅ **RECOMENDADA.** Verificada: 3 puntos en **0,20 s / 1,6 KB** |
| `leaflet-velocity` con GFS GRIB → JSON | ❌ Requiere formato específico (header `gribs` con `nx, ny, lo1, la1, dx, dy` + arrays `data` U y V completos), y hay que descargar y decodificar GRIB2 en el servidor. Demasiado para una demo |
| Windy Map Forecast API | ❌ Requiere clave y tiene coste |

**Recomendación concreta y verificada:**

Una **rejilla de 5x5 = 25 puntos** centrada en el incendio, paso ~0,05° (≈5,5 km), **en UNA sola llamada**:

```bash
curl -s "https://api.open-meteo.com/v1/forecast\
?latitude=40.56,40.56,...,40.76\
&longitude=-4.80,-4.75,...,-4.60\
&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m\
&timezone=UTC"
```

Generación de los parámetros (TS):

```ts
const N = 5, step = 0.05;
const lats: number[] = [], lons: number[] = [];
for (let i = 0; i < N; i++)
  for (let j = 0; j < N; j++) {
    lats.push(+(lat0 + (i - (N - 1) / 2) * step).toFixed(4));
    lons.push(+(lon0 + (j - (N - 1) / 2) * step).toFixed(4));
  }
const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}`
          + `&longitude=${lons.join(',')}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=UTC`;
// La respuesta es un ARRAY de 25 objetos, en el MISMO orden que enviaste las coordenadas.
```

Render: **no uses leaflet-velocity.** Dibuja 25 flechas como `L.Marker` con `divIcon` (un `<svg>` rotado `transform: rotate(${dir + 180}deg)` — +180 porque `wind_direction_10m` es la dirección **de la que viene** el viento) y longitud/opacidad proporcional a `wind_speed_10m`. Es 30 líneas de código, va a 60 fps y es trivial de explicar al jurado.

Si quieres partículas animadas sin GRIB: interpola bilinealmente la rejilla 5x5 a una malla más fina en el cliente y anima sobre un `<canvas>` superpuesto. Verificado que Open-Meteo aguanta hasta ~100 coordenadas por llamada sin degradarse.

⚠️ Open-Meteo redondea las coordenadas a la celda del modelo (pediste 40.60 y devuelve `latitude: 40.625`), así que con paso <0,05° obtendrás puntos duplicados. **0,05° es el paso mínimo útil.**

---

# RECOMENDACIÓN — qué usar en la plataforma

## Núcleo (sin ninguna clave, todo verificado hoy)

| # | Fuente | Para qué | Latencia medida |
|---|---|---|---|
| 1 | **DGT `getCamaras` + `camarasEtraffic/<id>.jpg`** | 1948 cámaras reales en toda España. **Es el "wow" de la demo**: imagen real de carretera con timestamp quemado, a 5 km del incendio, que puedes pasar a un modelo de visión para "¿se ve humo?" | listado 0,25 s / imagen ~0,3 s |
| 2 | **Open-Meteo** | Meteo actual + previsión 7 días + elevación + rejilla de viento. Sin clave, sin registro | 0,20 s |
| 3 | **Overpass (kumi.systems)** | Pueblos con población, parques de bomberos, hospitales, colegios, residencias, agua, masas forestales | 1,7–4,4 s |
| 4 | **OSRM demo** | Rutas y tiempos de llegada de medios; `/table` para "quién llega antes" | 0,22 s |
| 5 | **EFFIS WMS** (`effis.nrt.ba`, `mf010.fwi`) | Capas raster en Leaflet: perímetro quemado NRT y mapa de peligro FWI europeo. **Recordar `&styles=`** | 0,3–0,5 s |
| 6 | **Google News RSS** | Contexto informativo, confirmación cruzada de incendios activos | inmediato |
| 7 | **Bluesky `api.bsky.app`** | Señal social en tiempo real. **CORS `*`**, se puede llamar desde el cliente | rápido |
| 8 | **Meteoalarm Atom/JSON España** | Avisos oficiales CAP sin clave (sustituye a AEMET para el MVP) | rápido |
| 9 | **georef-spain-municipio (OpenDataSoft)** | 8.223 municipios con centroide y código INE — **descargar el CSV una vez** y geocodificar en local | descarga única |

## Con clave gratuita (añadir si da tiempo)

| # | Fuente | Por qué merece la pena |
|---|---|---|
| 10 | **NASA FIRMS** (MAP_KEY) | **Es la fuente de verdad de "dónde hay fuego ahora"**. Sin ella no tienes detección satelital real. **Consíguela: 5 minutos.** Prioridad ALTA |
| 11 | **AEMET OpenData** (JWT) | Solo si quieres el sello "dato oficial español": observación de estaciones y mapa de riesgo de incendio. El riesgo es una IMAGEN, no números. Prioridad MEDIA |

## Descartar

Reddit (403/OAuth), Windy Webcams (clave + poco aporte), Skyline, Copernicus EMS (feeds rotos), MITECO/EGIF (anual), INE Tempus3 (OSM ya trae población), Catálogo Nacional de Hospitales (anual, sin coords), leaflet-velocity con GRIB (sobreingeniería).

## Avisos de implementación (Next.js en Railway)

1. **Proxea en el servidor**: DGT `getCamaras` (CORS restringido a `etraffic.dgt.es`), EFFIS, Overpass, FIRMS. Solo Bluesky (`ACAO: *`) y Open-Meteo admiten fetch directo desde el navegador.
2. **Las imágenes JPEG de la DGT sí se pueden poner directamente en un `<img src>`** (200 sin Origin ni Referer). Añade `?t=${Date.now()}` para saltarte el `max-age=120`.
3. **User-Agent identificativo obligatorio** en Overpass (si no, 406) y Nominatim.
4. **Cachea agresivamente**: listado DGT 30 min, Overpass por geohash indefinido, Open-Meteo 10 min, FIRMS 15 min. Con 5000 tx/10 min de FIRMS y 2 slots de Overpass, sin caché la demo se cae.
5. **Encoding**: AEMET es ISO-8859-15; el KML de Madrid lleva BOM UTF-8; la respuesta de DGT es base64+XOR antes de ser JSON.
6. **Reproyección**: Euskadi está en EPSG:25830 (UTM 30N). Cataluña y DGT ya en WGS84. EFFIS WFS devuelve [lat,lon] invertido.

---

# CÓMO OBTENER CADA CLAVE (pasos exactos)

## FIRMS MAP_KEY (NASA) — ~5 minutos, PRIORITARIA

1. Ir a **https://firms.modaps.eosdis.nasa.gov/api/map_key/**
2. Pulsar el botón de solicitud e introducir **solo el email** (`javimorgalis@gmail.com`). No hace falta cuenta Earthdata para el MAP_KEY.
3. La clave **llega por email** (texto tipo hex de ~32 caracteres). Es inmediata en la práctica.
4. Si el email ya estuviera registrado, el propio sitio indica entrar por `https://firms.modaps.eosdis.nasa.gov/download/` para reenviar / borrar / modificar la mapkey.
5. Verificar que funciona:
   ```bash
   curl -s "https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=$FIRMS_MAP_KEY"
   # con clave válida devuelve JSON con current_transactions / transaction_limit
   ```
6. Primera llamada real:
   ```bash
   curl -s "https://firms.modaps.eosdis.nasa.gov/api/area/csv/$FIRMS_MAP_KEY/VIIRS_NOAA20_NRT/-9.5,35.9,4.4,43.9/1"
   ```
7. Guardar como `FIRMS_MAP_KEY` en las variables de entorno de Railway.
- **Límite: 5000 transacciones / 10 minutos.** Pedir 7 días cuenta como varias transacciones.

## AEMET OpenData API key — ~5 minutos, OPCIONAL

1. Ir a **https://opendata.aemet.es/centrodedescargas/altaUsuario** (enlace "Solicitar" / "Obtención API Key" desde https://opendata.aemet.es/).
2. Introducir el email y aceptar las condiciones. **No hay formulario largo.**
3. Llega un **email con un enlace de confirmación**; al pulsarlo se muestra/envía la **API key, que es un JWT largo** (tres segmentos separados por puntos).
4. Verificar:
   ```bash
   curl -s "https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/esp?api_key=$AEMET_API_KEY"
   # -> {"descripcion":"exito","estado":200,"datos":"https://opendata.aemet.es/opendata/sh/XXXXXXX","metadatos":"..."}
   curl -s "https://opendata.aemet.es/opendata/sh/XXXXXXX" -o avisos.tar.gz   # SEGUNDO paso obligatorio
   ```
5. Guardar como `AEMET_API_KEY`. **Recordar el patrón de dos pasos y el encoding ISO-8859-15.**

## Windy Webcams API key — SOLO SI SE USA (no recomendado)

1. https://api.windy.com/keys → registrarse y crear una key del producto **Webcams API**.
2. Usar en la cabecera `x-windy-api-key: <clave>` (verificado: sin ella devuelve 403 con ese mensaje exacto).
3. Límite del plan gratuito: ⚠️ NO VERIFICADO.

## Sin clave (no hay que hacer nada)

DGT etraffic · Ayto. Madrid · SCT Cataluña · api.euskadi.eus · Open-Meteo · Meteoalarm · EFFIS/GWIS · Overpass · OSRM · Nominatim · Google News RSS · Bluesky (`api.bsky.app`) · Mastodon (timeline de hashtag) · OpenDataSoft georef-spain-municipio · datos.gob.es.
