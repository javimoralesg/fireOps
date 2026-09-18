# RAG local de normativa de protección civil

Recupera el **protocolo aplicable** a un incidente sin depender de ninguna clave.
Es el plan B de `conectores/quiver.ts` cuando no hay `QUIVER_API_KEY`: mismo
contrato (fragmento + cita + URL oficial), pero sobre un corpus descargado del
BOE, del BOCM y del portal de transparencia de Madrid, con embeddings calculados
por Ollama en el propio Mac.

Nada aquí está simulado: todo el texto procede de la fuente oficial, todos los
vectores los calcula el modelo, y si falta el índice o Ollama no responde el
módulo **lanza un error** en vez de devolver algo inventado.

## Piezas

| Ruta | Qué hace |
| --- | --- |
| `data/protocolos/construir.mjs` | Descarga, trocea e indexa (Node ESM, sin dependencias npm) |
| `data/protocolos/*.md` | Texto íntegro de cada documento con cabecera (título, URL, fecha de descarga, identificador, vigencia) |
| `data/protocolos/indice.json` | 1.474 fragmentos con su vector de 384 dimensiones (6,0 MB) |
| `data/protocolos/README.md` | Cómo regenerar el corpus |
| `lib/server/conectores/rag-local.ts` | API del conector |

## Documentos incluidos

Descarga del 18/09/2026. Todos verificados uno a uno contra la fuente oficial.

| Documento | Identificador | Fragmentos | Vigencia | Fuente |
| --- | --- | ---: | --- | --- |
| Ley 17/2015, de 9 de julio, del Sistema Nacional de Protección Civil | BOE-A-2015-7730 | 169 | vigente | BOE, XML consolidado |
| RD 524/2023, Norma Básica de Protección Civil | BOE-A-2023-14679 | 70 | vigente | BOE, XML consolidado |
| RD 393/2007, Norma Básica de Autoprotección | BOE-A-2007-6237 | 98 | vigente | BOE, XML consolidado |
| RD 407/1992, Norma Básica de Protección Civil | BOE-A-1992-9364 | 39 | **derogada** por el RD 524/2023 | BOE, XML consolidado |
| PLATERCAM, Plan Territorial de Protección Civil de la Comunidad de Madrid | BOCM-20190514-22 | 528 | vigente | PDF de 156 págs. en comunidad.madrid |
| PEMAM, Plan Territorial de Emergencia Municipal del Ayuntamiento de Madrid | PEMAM | 570 | vigente | PDF de 506 págs. en transparencia.madrid.es |
| **Total** | | **1.474** | | |

Notas sobre las fuentes:

- El identificador del RD 524/2023 **no** estaba a mano: no aparece en el sumario
  del BOE del 21/06/2023 por la API de datos abiertos, y el buscador web devuelve
  una página vacía a `curl`. Se localizó como `BOE-A-2023-14679` y se verificó
  descargando su XML, cuyo `<titulo>` es exactamente «Real Decreto 524/2023, de
  20 de junio, por el que se aprueba la Norma Básica de Protección Civil».
- El PDF del PEMAM en `www.madrid.es` responde **403**; el mismo fichero en
  `transparencia.madrid.es` sirve correctamente con `User-Agent` de navegador y
  `Referer`. El script usa esa URL.
- Del PEMAM se indexan el cuerpo del plan (págs. 1-57, incluido el Anexo 1) y los
  **Anexos 3 a 9** (págs. 224-405). Se dejan fuera a propósito el **Anexo 2**
  (entorno municipal: tablas estadísticas), y los **Anexos 10 a 13** (directorio
  de interlocutores con teléfonos, catálogo de medios, herramientas de mensajería
  y cartografía): son tablas y planos sin texto recuperable, y el directorio
  además contiene datos de contacto.
- La Ley 7/1985 queda fuera por indicación del reto.

### Qué falta

- **Ninguna fuente pedida se ha quedado sin obtener.** Las seis se descargan y se
  indexan, incluidas las dos que el reto daba por dudosas (PLATERCAM y PEMAM).
- Directrices Básicas de planificación por riesgo (químico, inundaciones,
  incendios forestales, mercancías peligrosas…) y los Planes Especiales de la
  Comunidad de Madrid (INFOMA, INUNCAM, TRANSCAM, QUIMCAM) **no** están. Son las
  que más finura darían para un incidente concreto; añadirlas es solo cuestión de
  meter su identificador BOE en el array `FUENTES` de `construir.mjs`.
- El troceo de los PDF etiqueta como apartado alguna fila de lista numerada
  (`Anexo I · Apdo. 3` para un epígrafe que en realidad es el tercer punto de una
  enumeración). Afecta a la **etiqueta de la cita**, no al texto recuperado.

## Cómo funciona

**Indexado** (`construir.mjs`):

1. Los XML del BOE se parsean por la clase de cada `<p>` (`articulo`,
   `capitulo_num/tit`, `anexo_*`…), así que cada sección conserva su cita real:
   `Art. 7`, `Art. 7 bis`, `Cap. III`, `Disposición final segunda`, `Anexo I`.
2. Los PDF se extraen con `pdftotext -layout`, se les quitan los encabezados y
   pies repetidos del BOCM / del Ayuntamiento y se cortan por numeración de
   apartado, arrastrando el anexo en curso: `Anexo 7 · Apdo. 7.2.3`.
3. Cada sección se parte en fragmentos de 600-900 caracteres con solapamiento
   pequeño (la última frase del anterior). Si una sección da varios fragmentos la
   referencia lo dice: `Art. 15 (2/3)`.
4. Se embebe `epígrafe de la sección + texto` en lotes de 32 contra
   `POST /api/embed`, y el vector se guarda normalizado a 5 decimales.

**Consulta** (`rag-local.ts`): se embebe la consulta con el mismo modelo y se
puntúa cada fragmento del índice, que se carga una sola vez y vive en
`globalThis` para sobrevivir al HMR de Next.

## API

```ts
import {
  ragLocalConfigurado,   // () => boolean            síncrono, cacheado: ¿existe indice.json?
  ragLocalDisponible,    // () => Promise<boolean>    índice + Ollama sirviendo el modelo (cache 30 s)
  buscarProtocoloLocal,  // (consulta, topK = 5) => Promise<FragmentoProtocolo[]>
  modeloEmbeddings,      // () => string
} from "@/lib/server/conectores/rag-local";

interface FragmentoProtocolo {
  id: string;          // "ley-17-2015-…#00042"
  documento: string;   // slug del documento
  titulo: string;      // título oficial completo
  url: string;         // enlace al documento oficial (BOE / BOCM / madrid.es)
  referencia: string;  // "Art. 15 (2/3)", "Anexo 7 · Apdo. 7.2.3"
  texto: string;
  score: number;       // [0,1], de mayor a menor
}
```

| Variable de entorno | Por defecto |
| --- | --- |
| `OLLAMA_URL` | `http://localhost:11434` |
| `OLLAMA_MODEL_EMBED` | `all-minilm:l6-v2` (384 dim) |

`buscarProtocoloLocal` **lanza `Error`** con el remedio dentro del mensaje si
falta el índice o si Ollama no contesta:

```
RAG local sin índice: no existe …/data/protocolos/indice.json. Genéralo con
"node data/protocolos/construir.mjs" (descarga el BOE y calcula los embeddings con Ollama).

RAG local: Ollama no responde en http://127.0.0.1:1 (fetch failed).
Arráncalo con "ollama serve" y descarga el modelo con "ollama pull all-minilm:l6-v2".
```

## Por qué el ranking no es solo coseno

`all-minilm:l6-v2` (22 M de parámetros) está entrenado **en inglés**. Sobre texto
jurídico en español el coseno a secas da resultados pobres: para «corte de
autovía por humo tóxico» el mejor fragmento por coseno puro era un párrafo del
preámbulo de la Ley 17/2015, y el tercero, consejos para bañarse en pantanos.

Así que `buscarProtocoloLocal` combina, mitad y mitad, el coseno del embedding
con un **BM25 léxico** calculado sobre el propio índice (IDF y longitud media se
computan al cargarlo, una sola vez; `k1 = 1.5`, `b = 0.75`, sin acentos y sin
palabras vacías del español). Es lo que engancha «residencia de mayores»,
«confinamiento» o «megafonía» con el articulado que los nombra. Los pesos están
en `PESO_VECTOR` / `PESO_LEXICO`, arriba del módulo.

Antes y después, misma consulta, mismo índice:

| Consulta | Coseno puro, nº 1 | Híbrido, nº 1 |
| --- | --- | --- |
| corte de autovía por humo tóxico | Ley 17/2015, `Preámbulo (44/44)` — «Dos siglos después, es evidente que el Estado…» | PLATERCAM, `Anexo VI · Apdo. 26 (3/4)` — actuación ante incendio |
| evacuación de una residencia de mayores por humo de incendio industrial | PEMAM, `Anexo 7 · Apdo. 7.2.6 (5/5)` | PLATERCAM `Anexo VI · Apdo. 26` + RD 393/2007 `Apdo. 2` (evacuación de quien no puede hacerlo por sus propios medios) |

Si algún día hay un modelo de embeddings multilingüe en local (`bge-m3`,
`multilingual-e5`), basta con `OLLAMA_MODEL_EMBED=…`, regenerar el índice y subir
`PESO_VECTOR`.

## Latencia medida

MacBook, Ollama local, índice de 1.474 fragmentos (6,0 MB).

| Operación | Tiempo |
| --- | --- |
| `ragLocalConfigurado()` | < 1 ms (síncrono, cacheado) |
| `ragLocalDisponible()` | ~70 ms cacheado; ~0,5-1,9 s el primer sondeo |
| Primera `buscarProtocoloLocal()` del proceso | **1,0-1,9 s** (lee y parsea los 6 MB del índice + estadísticas BM25 + embed) |
| `buscarProtocoloLocal()` en caliente | **35-150 ms** (mediana ~90 ms sobre 20 consultas; picos de hasta 440 ms cuando Ollama descarga el modelo de la caché), casi todo el embed de la consulta en Ollama |
| Construcción completa del índice | ~6-13 min, prácticamente todo embeddings |

El coste de recorrer los 1.474 fragmentos (coseno + BM25) es despreciable frente
a la llamada a Ollama.

## Resultado de las consultas de prueba

`buscarProtocoloLocal(consulta, 3)`, con el índice ya cargado:

**«evacuación de una residencia de mayores por humo de incendio industrial»** (629 ms)

| # | Score | Referencia | Documento |
| --- | ---: | --- | --- |
| 1 | 0,709 | `Anexo VI · Apdo. 26 (3/4)` | PLATERCAM — actuación ante incendio: orden y serenidad, evacuación |
| 2 | 0,698 | `Anexo II · Apdo. 2.2 (4/6)` | PLATERCAM — catálogo de riesgos por tipo de establecimiento |
| 3 | 0,552 | `Apdo. 2 (4/6)` | RD 393/2007 — actividades con personas que no pueden evacuar por sus propios medios |

**«corte de autovía por humo tóxico»** (90 ms)

| # | Score | Referencia | Documento |
| --- | ---: | --- | --- |
| 1 | 0,747 | `Anexo VI · Apdo. 26 (3/4)` | PLATERCAM — actuación ante incendio |
| 2 | 0,538 | `Anexo VI · Apdo. 17 (12/13)` | PLATERCAM — «gatee si hubiere humo», no usar ascensores, alejarse del siniestro |
| 3 | 0,490 | `Anexo VI · Apdo. 23 (2/5)` | PLATERCAM — vehículo fuera de la calzada, preseñalización a 100 m en autovía |

Otras consultas de control:

| Consulta | nº 1 |
| --- | --- |
| quién declara la emergencia de interés nacional | PEMAM `Anexo 9 · Apdo. 7.2` — «Situación Operativa 3: se declara la Emergencia de Interés Nacional» (0,818) |
| confinamiento de la población por nube tóxica | PEMAM `Anexo 7 · Apdo. 7.2.3` — confinamiento (0,708) |
| activación del PLATERCAM en situación 2 | PLATERCAM `Apdo. 5.1.2` — definición de las situaciones (0,714) |
| aviso a la población por megafonía | PLATERCAM `Apdo. 5.3.1` — megafonía fija y móvil, avisos masivos (0,792) |

## Regenerar

Requiere Ollama con `all-minilm:l6-v2` y `pdftotext` (poppler) para los dos PDF;
sin `pdftotext` el script sigue, omite PLATERCAM y PEMAM y lo anota en su salida.

```bash
node data/protocolos/construir.mjs                 # todo
node data/protocolos/construir.mjs --solo-descargar # solo los .md
node data/protocolos/construir.mjs --solo-indexar   # solo indice.json
```

> **Ojo con `.gitignore`:** la línea `data/` deja fuera todo `data/protocolos/`,
> script incluido. En un clon limpio el RAG local arranca apagado
> (`ragLocalConfigurado() === false`) hasta que alguien ejecute el constructor, y
> el constructor tampoco viaja en el repo. Si se quiere que el corpus vaya con el
> proyecto hay que añadir una excepción (`!data/protocolos/`), decisión que queda
> fuera de este módulo.

Detalle del formato y del troceo: `data/protocolos/README.md`.
