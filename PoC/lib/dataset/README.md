# Dataset de eventos de emergencia (simulador)

Son eventos de simulacro realistas para inyectarlos en el pipeline real (`POST /api/ingesta/observacion`): clasificación, verificación anti-bulos, geolocalización, impacto en el grafo y propuesta de decisiones. Todo es ficticio (`simulacro: true`), pero los lugares y las coordenadas son reales.

## Estructura

| Archivo | Qué contiene |
|---|---|
| `tipos.ts` | `EventoDataset`, `EscenarioDataset`, `LugarDataset`, `ImagenDataset`, `TipoEmergencia`, `Canal`, `Veracidad` |
| `lugares.ts` | 194 lugares geocodificados con Nominatim y Overpass (generado; no inventes coordenadas) y `aprox()` |
| `imagenes.ts` | 14 imágenes de Wikimedia Commons con autor, licencia y origen |
| `construir.ts` | Ayudantes `llamada()`, `app()`, `red()`, `camara()`, `sensor()`, `aviso()`, `efectivo()` y `escenario()` |
| `escenarios/*.ts` | 16 escenarios, uno por archivo, cada uno con 11-16 eventos ordenados por `offsetSeg` |
| `sueltos.ts` | 34 eventos sin escenario para inyectarlos a mano |
| `index.ts` | `ESCENARIOS`, `ESCENARIO_PRINCIPAL`, `EVENTOS_SUELTOS`, `TODOS_LOS_EVENTOS`, `ETIQUETA_TIPO`, `ETIQUETA_CANAL`, `aObservacion()` |
| `validar.ts` | Comprueba todo el dataset y los JSON exportados |
| `exportar.ts` | Escribe `data/dataset/<escenarioId>.json` y `data/dataset/sueltos.json` para el reproductor del backend |
| `resolver-node.mjs` | Permite ejecutar los `.ts` con Node sin instalar nada |

Las imágenes están en `public/dataset/img/` y sus créditos, en `public/dataset/img/CREDITOS.md`.

## Uso

```ts
import { ESCENARIOS, aObservacion } from "@/lib/dataset";
const esc = ESCENARIOS[0]; // incendio-industrial-mendez-alvaro (principal)
for (const ev of esc.eventos) {
  // programar en ev.offsetSeg (tiempo de demo) y enviar:
  await fetch("/api/ingesta/observacion", { method: "POST", body: JSON.stringify(aObservacion(ev)) });
}
```

`aObservacion()` devuelve una `ObservacionEntrante` con `perifericoId: "simulador"` y `texto = titulo + "\n" + texto`. Añade `imagenUrl` (ruta pública, no base64), `tipoEmergencia`, `simulacro: true`, `datasetId` y `canal`.

Comandos (desde la raíz; `tsx` no está instalado, se usa Node ≥ 22.18):

```bash
node --import ./lib/dataset/resolver-node.mjs lib/dataset/validar.ts   # valida
node --import ./lib/dataset/resolver-node.mjs lib/dataset/exportar.ts  # regenera data/dataset/*.json
```

Si cambias algo en un escenario, vuelve a ejecutar `exportar.ts`: los JSON no se regeneran solos. En el JSON, `canal` usa los nombres cortos del reproductor (`app` y `camara`), tanto en el evento como en la observación. La observación va sin `timestamp` porque lo pone el reproductor.

## Cómo añadir eventos

1. Busca el lugar en `lugares.ts`. Si no está, geocodifícalo (ver abajo) y añádelo con su `osmId` y `fuenteCoordenadas`. Para un aviso impreciso («por la zona de…») usa `aprox(L.lugar, 300, "Zona de…")`: mantiene las coordenadas reales y solo sube `precisionM`.
2. Usa el ayudante del canal (`llamada`, `red`, `sensor("OpenMeteo", …)`…). Rellena `id` único, `offsetSeg` (en orden), `tipoEmergencia`, `categoria` del pipeline, `gravedadEsperada`, `etiquetas` y, si aplica, `decisionEsperada`.
3. Un **duplicado** lleva `veracidad: "duplicado"` y `duplicaDe` apuntando a un evento anterior del mismo escenario. Un **bulo** lleva `veracidad: "bulo"` y un `motivoBulo` concreto: de dónde sale de verdad la foto o la cifra y con qué evento del escenario se desmiente. El **ruido** lleva `veracidad: "ruido"` y `gravedadEsperada: "nula"`.
4. El **título viaja al pipeline**: no puede contener «bulo», «rumor», «ruido» ni «duplicado» (`validar.ts` lo comprueba).
5. Ejecuta `validar.ts` y después `exportar.ts`.

Convenciones: `gravedadEsperada` es la gravedad que debería asignar el sistema **después** de verificar. Un bulo suele quedar en `baja` (solo requiere desmentido) o `media` si el desmentido es urgente (por ejemplo, disparos falsos en una multitud). Un duplicado conserva la gravedad del original. En los sensores de viento, la dirección es de dónde **viene** (convención meteorológica): viento de 200° empuja el humo hacia 20°.

## Fuentes de coordenadas

- **Nominatim** (OpenStreetMap), consultado a 1 petición/s con `User-Agent: AtalayaHackSpainPoC/0.1`, para direcciones, hospitales, plazas y municipios.
- **Overpass** (OpenStreetMap) para estaciones de Metro, Cercanías y Adif, residencias de mayores, subestaciones eléctricas y colegios. Así los nombres coinciden con los del grafo real (`lib/server/grafo-real`).
- Todas las coordenadas salen de esas consultas (© colaboradores de OpenStreetMap, ODbL). `validar.ts` falla si un evento usa coordenadas que no están en `lugares.ts`. Las distancias y rumbos de los textos (por ejemplo, del incendio de Méndez Álvaro al Gregorio Marañón: 2,7 km, rumbo 21°) se han calculado con esas coordenadas.

## Imágenes

Son 14, de Wikimedia Commons (CC BY, CC BY-SA, CC0 o dominio público), consultadas con su API, en JPEG y con 1024 px de ancho como máximo. Ninguna es del suceso simulado:

- Las de eventos reales son **ilustrativas**. La de humo de Méndez Álvaro está recortada para quitar la terminal de contenedores del original australiano.
- Las de los bulos son de **otro suceso anterior** (Buncefield 2005, Filomena 2021, 15M 2011, Surfside 2021, Montparnasse 1895, DANA de Valencia 2024, apagón del 28-4-2025…). El `motivoBulo` dice su origen real según los metadatos de Commons, para que la verificación pueda detectar que la foto está reciclada.

Si añades una imagen, regístrala en `imagenes.ts` y en `CREDITOS.md`.
