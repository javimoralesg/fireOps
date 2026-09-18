# Corpus local de protección civil

Normativa española de protección civil descargada de fuentes oficiales, troceada
por artículo/apartado e indexada con embeddings reales de Ollama. Es lo que
alimenta el RAG local (`lib/server/conectores/rag-local.ts`) cuando no hay clave
de QuiverAI.

## Qué hay aquí

| Fichero | Qué es |
| --- | --- |
| `construir.mjs` | Script de construcción (Node ESM, sin dependencias npm) |
| `*.md` | Texto íntegro de cada documento, con cabecera YAML (título, URL oficial, fecha de descarga, identificador, vigencia) y una sección `##` por artículo/apartado |
| `indice.json` | Índice vectorial: un fragmento con su vector de 384 dimensiones por entrada |

Los `.md` y el `indice.json` son **generados**: no se editan a mano. La fuente de
verdad es el catálogo `FUENTES` de `construir.mjs`.

## Cómo se regenera

Requisitos:

- **Ollama** corriendo en `http://localhost:11434` con el modelo de embeddings:
  ```bash
  ollama serve
  ollama pull all-minilm:l6-v2
  ```
- **`pdftotext`** (poppler) para los planes publicados solo en PDF (PLATERCAM y
  PEMAM). En macOS: `brew install poppler`. Si no está, el script sigue adelante,
  omite esos dos documentos y lo anota en su salida.
- Salida a internet (BOE, comunidad.madrid, transparencia.madrid.es).

Desde la raíz del proyecto:

```bash
# todo: descarga + troceo + embeddings  (~6 min, casi todo embeddings)
node data/protocolos/construir.mjs

# solo volver a descargar y regenerar los .md (sin tocar el índice)
node data/protocolos/construir.mjs --solo-descargar

# solo recalcular el índice a partir de los .md ya presentes
node data/protocolos/construir.mjs --solo-indexar
```

Variables de entorno respetadas (las mismas que el conector):

| Variable | Por defecto |
| --- | --- |
| `OLLAMA_URL` | `http://localhost:11434` |
| `OLLAMA_MODEL_EMBED` | `all-minilm:l6-v2` |

## Cómo se trocea

- Los XML del BOE se parsean por la clase de cada `<p>` (`articulo`,
  `capitulo_num/tit`, `anexo_*`…), de modo que cada sección conserva su cita
  (`Art. 7`, `Art. 7 bis`, `Cap. III`, `Disposición final segunda`, `Anexo I`).
- Los PDF se extraen con `pdftotext -layout`, se les quitan los encabezados y
  pies de página repetidos y se cortan por numeración de apartado
  (`Apdo. 5.2.2`), con el anexo en curso como contexto (`Anexo 7 · Apdo. 7.2.3`).
- Cada sección se parte en fragmentos de 600–900 caracteres con un pequeño
  solapamiento (la última frase del fragmento anterior). Si una sección genera
  varios fragmentos, la referencia lo indica: `Art. 15 (2/3)`.
- Se embebe `epígrafe de la sección + texto` (no el título del documento: al
  repetirse en cientos de fragmentos diluye el vector).
- Los vectores se guardan **normalizados** y redondeados a 5 decimales, en lotes
  de 32 contra `POST /api/embed`. El modelo se publica con `num_ctx=256` aunque
  admite 512, así que el script lo sube por petición (`options.num_ctx`).

## Formato de `indice.json`

```jsonc
{
  "version": 1,
  "modelo": "all-minilm:l6-v2",
  "dimension": 384,
  "normalizado": true,
  "generado": "2026-09-18T…",
  "documentos": [{ "documento": "…", "identificador": "…", "titulo": "…", "url": "…", "vigencia": "vigente", "fragmentos": 169 }],
  "fragmentos": [{ "id": "…#00042", "documento": "…", "titulo": "…", "url": "…", "referencia": "Art. 15 (2/3)", "texto": "…", "vector": [0.0123, …] }]
}
```

Detalle de documentos, cifras y limitaciones conocidas: `docs/rag-local.md`.
