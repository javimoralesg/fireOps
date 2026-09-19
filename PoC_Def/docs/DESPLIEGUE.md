# Despliegue · Atalaya Incendios

DUEÑO del documento: constructor A (núcleo). La app es **un solo proceso Node**
con la UI, la API, el bucle de agentes y el SSE dentro. Por eso necesita un
servidor persistente (Railway), no una función serverless: el orquestador vive
entre peticiones.

---

## 1. Qué arranca el proceso

`instrumentation.ts` (en la raíz) exporta `register()`, que Next 16 ejecuta una
vez por instancia del servidor **antes** de atender la primera petición. Ahí, y
solo si `process.env.NEXT_RUNTIME === "nodejs"`, se importa dinámicamente
`lib/motor/orquestador.ts` y se llama a `arrancarOrquestador()`:

1. Arranca el bucle (`setInterval` cada `TICK_MS`, 5000 ms por defecto).
2. Registra los agentes de `lib/agentes/registro.ts`.
3. Arranca la persistencia: si hay ejecución activa en Supabase la **recupera**
   (un reinicio de Railway no pierde la partida); si no, crea una nueva.

`instrumentation.ts` es estable desde Next 15 y **no hay que activar nada** en
`next.config.ts`. Además, todas las rutas del núcleo llaman a
`arrancarOrquestador()` (que es idempotente) por si acaso.

## 2. Railway, paso a paso

1. **Crear el proyecto**: Railway → *New Project* → *Deploy from GitHub repo* →
   este repositorio. Railway detecta Next.js con Nixpacks.
2. **Región EU**: en *Settings → Region* elegir `europe-west4` (o la UE más
   cercana). Importante: HappyRobot está en su instancia europea y los datos son
   de emergencias españolas.
3. **Variables**: *Variables → Raw Editor* y pegar el contenido de
   `.env.example` ya relleno. Ver `docs/CLAVES.md` para conseguir cada una.
   Mínimo para que la demo respire:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (persistencia y conocimiento)
   - `LLM_PROVEEDOR` + la clave del proveedor (`HELMCODE_API_KEY`)
   - `HAPPYROBOT_API_KEY`, sus `WORKFLOW_SLUG_*`, `HAPPYROBOT_WEBHOOK_SECRET`,
     `DESTINO_DEMO`, `EMAIL_DEMO`
   - `ACELERACION_TIEMPO`, `TICK_MS`, `CAMARAS_INTERVALO_SEG`
   - `PUBLIC_BASE_URL` → ver §3.
4. **Dominio**: *Settings → Networking → Generate Domain*. Copiar la URL
   (`https://<algo>.up.railway.app`) y **volver a ponerla en `PUBLIC_BASE_URL`**;
   redesplegar para que los webhooks apunten bien.
5. **Healthcheck**: ya viene en `railway.json` (`/api/salud`, 120 s). Railway
   reinicia el contenedor si deja de responder (`ON_FAILURE`, 10 intentos).
6. **Una sola réplica** (`numReplicas: 1`). El estado vive en memoria: con dos
   réplicas habría dos mundos distintos y el SSE mostraría uno u otro.

`railway.json` ya fija build (`npm run build`), arranque (`npm run start`),
healthcheck y política de reinicio, así que no hay que tocar nada en la UI.

### Logs y diagnóstico

- Railway → pestaña *Deployments* → *View Logs* (build y runtime en vivo).
- `GET /api/salud` da lo mismo en JSON: orquestador, reloj, agentes en error,
  servicios externos en rojo, memoria del proceso.
- `node scripts/comprobar.mjs https://<tu-dominio>` imprime ese resumen legible.
- El registro de la demo (lo que vería un humano) está en `GET /api/eventos`.

### Sobre `output: "standalone"`

**No se activa** a propósito. Railway arranca con `npm run start` (= `next
start`), que necesita el build completo y los `node_modules` (que Nixpacks ya
deja en la imagen). `standalone` solo compensa en Docker: obligaría a cambiar el
comando a `node .next/standalone/server.js` y a copiar a mano `public/` y
`.next/static/`, sin ganar nada aquí. Si algún día se pasa a Dockerfile, se
activa en `next.config.ts` y se ajusta el `startCommand`.

`serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node",
"sharp"]` sí está activo: son paquetes con binarios nativos que el bundler no
debe empaquetar.

## 3. URL pública (webhooks y móvil) — `urlPublica()`

Los webhooks de HappyRobot y Telegram y la página del móvil (`/periferico`:
cámara y GPS exigen contexto seguro) necesitan **HTTPS accesible desde fuera**.
`lib/motor/entorno.ts` resuelve la URL efectiva con esta prioridad:

1. `data/url-publica.txt` — lo escribe `scripts/tunel.sh` (túnel de Cloudflare).
2. `PUBLIC_BASE_URL` — la variable de entorno (lo normal en Railway).
3. `undefined` — quien la necesite debe fallar de forma visible, nunca
   inventarse un dominio.

El archivo manda sobre la variable a propósito: en local es lo que está vivo
ahora mismo. En desarrollo:

```bash
npm run dev                 # servidor en :3000
scripts/tunel.sh 3000       # deja la URL en data/url-publica.txt
```

(`brew install cloudflared` la primera vez.) `GET /api/salud` devuelve
`urlPublica: { valor, origen }` para comprobar de un vistazo cuál se está usando.

## 4. Base de datos (Supabase)

El esquema completo está en `lib/db/schema.sql`: tablas genéricas
(`id`, `ejecucion_id`, `incendio_id`, `datos jsonb`, `actualizado_en`) para que
el contrato de `lib/dominio/tipos.ts` pueda crecer sin migraciones, más
`documentos`/`chunks`/`lecciones` con `embedding vector(512)` y las funciones
`buscar_chunks` y `buscar_lecciones` (similitud coseno).

**Ya está aplicado** en el proyecto de Supabase de la demo. Para aplicarlo a
mano en un proyecto nuevo:

1. Supabase → *SQL Editor* → *New query*.
2. Pegar entero el contenido de `lib/db/schema.sql` y *Run*. Es idempotente
   (`create table if not exists`, `create or replace function`).
3. Comprobar en *Database → Extensions* que `vector` está activa (la primera
   línea del script la activa).
4. Copiar `SUPABASE_URL` y la **service role key** (*Settings → API*) a las
   variables del proyecto.

Notas:

- **Sin RLS a propósito**: a estas tablas solo accede el servidor con la service
  role key, que nunca sale del proceso Node. No hay cliente de navegador que
  hable con Supabase. Si algún día la UI leyera directo, habría que activar RLS
  y políticas por ejecución.
- Las dimensiones del vector (512) las fija el proveedor de embeddings
  (`EMBEDDINGS_DIMENSIONES`). Cambiar de proveedor obliga a recrear las columnas
  `embedding` y las dos funciones de búsqueda.
- Si Supabase no responde, la app **sigue funcionando en memoria**: se marca
  "Supabase" en rojo en la barra de servicios y se reintenta el volcado entero
  en el siguiente ciclo.

## 5. Desarrollo en local

```bash
cp .env.example .env.local     # y rellenar claves
npm install
npm run dev                    # http://localhost:3000
node scripts/comprobar.mjs     # resumen de salud y estado
```

Aviso: **Next 16 solo permite un `next dev` por directorio**. Si otra sesión ya
tiene uno levantado, el segundo se niega a arrancar e indica el puerto y el PID
del que manda; hay que usar ese o matarlo.

## 6. Comprobaciones tras desplegar

```bash
curl https://<dominio>/api/salud                 # ok:true, nucleo.arrancado:true
curl -N https://<dominio>/api/estado/stream      # event: estado, luego latidos
curl -X POST https://<dominio>/api/focos \
     -H 'content-type: application/json' \
     -d '{"lat":40.66,"lon":-4.70,"nombre":"Prueba Ávila"}'
curl https://<dominio>/api/eventos?limite=20     # "Entorno cargado: N pueblos…"
```

Lo que hay que ver: el reloj de mundo avanzando (`reloj.tick` sube y
`ahoraMundo` corre a `factor` × tiempo real), `nucleo.agentes` > 0, y los
servicios externos en verde. Cualquiera en rojo sale con su motivo en
`servicios`: eso es correcto y deliberado, nunca se sustituye por un valor
inventado.
