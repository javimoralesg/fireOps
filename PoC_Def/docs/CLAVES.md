# Atalaya Incendios · Cómo obtener cada clave y dónde ponerla

Actualizado el 2026-09-19. Todo lo de aquí se hace **una vez** y sirve para local y para
producción. Regla del proyecto: **nada simulado**. Si falta una clave, la pantalla enseña el
error con el nombre exacto de la variable (`HappyRobot: falta HAPPYROBOT_API_KEY`) en vez de
inventarse un dato. Por eso conviene tener claro qué se cae sin cada una: está en la tabla
final.

## 0. Dónde se ponen las claves

| Entorno | Archivo / sitio | Cómo se recarga |
|---|---|---|
| Local | `.env.local` en la raíz del repo (copia de `.env.example`, ya ignorado por git) | Hay que **reiniciar** `npm run dev`: Next no relee `.env.local` en caliente para código de servidor |
| Producción | Railway → proyecto → servicio → pestaña **Variables** | Railway redespliega solo al guardar |

```bash
cd /Users/javimg/Documents/Personal/HackSpain/PoC/atalaya-incendios
cp .env.example .env.local     # solo la primera vez; si ya existe, NO lo sobrescribas
```

> `.env.local` **nunca** se commitea (está en `.gitignore`). Las claves que empiezan por
> `NEXT_PUBLIC_` viajan al navegador: ahí solo va la URL de Supabase y la `anon key`, jamás
> la `service role`.

### Orden recomendado y coste

| # | Proveedor | Tiempo | Coste | Prioridad |
|---|---|---|---|---|
| 1 | HelmCode (IA: chat, visión, embeddings, voz) | 5 min si ya hay cuenta | Plan de pago (€399/mes Starter); **la clave la aporta Javi** | Bloqueante: sin IA no hay agentes |
| 2 | Supabase | 10 min | Gratis (plan Free) | Alta: persistencia, RAG, aprendizaje |
| 3 | NASA FIRMS | 5 min | Gratis | Alta: detección por satélite |
| 4 | HappyRobot | 30-45 min | Número USA cubierto por la organización; llamadas salientes gratis | Alta: es el reto, hay que enseñar ejecución real |
| 5 | Telegram | 5 min | Gratis | Alta: canal ciudadano bidireccional |
| 6 | Cloudflare quick tunnel | 3 min | Gratis | Alta en local: webhooks y móvil exigen HTTPS |
| 7 | Exa | 3 min | 10 € gratis al registrarse | Media: prensa y redes |
| 8 | AEMET OpenData | 5 min | Gratis | Media: avisos oficiales |
| 9 | Railway | 15 min | ~5 $/mes de crédito de prueba | Media: solo para el despliegue público |

Sin clave y sin hacer nada: Open-Meteo, Overpass (OSM), OSRM, Nominatim, cámaras DGT,
cámaras del Ayuntamiento de Madrid, Meteoalarm, Google News RSS, Bluesky, OpenStreetMap.

---

## 1. HelmCode — proveedor principal de IA

**Qué nos da:** chat y razonamiento, visión (análisis de cámaras), embeddings, Whisper (voz a
texto) y Kokoro (texto a voz), **todo en infraestructura de la UE** — argumento de peso ante
un jurado para una plataforma de emergencias de la administración española.

**Tiempo:** 5 minutos con cuenta creada. **Coste:** desde €399/mes (Starter); **no hay tier
gratuito ni prueba**. En este proyecto la clave la aporta Javi; nadie debe crear una cuenta
nueva ni meter tarjeta.

1. Entrar en **https://cloud.helmcode.com** (si no hay cuenta:
   https://cloud.helmcode.com/signup y elegir plan; **no hacerlo sin hablar con Javi**).
2. En el menú lateral, **API Keys** → botón **Create key**. La pantalla pide un nombre
   (poner `atalaya-hackspain`) y devuelve la clave **una sola vez**, en un recuadro gris con
   un icono de copiar a la derecha. Empieza por **`sk-hke_`**. Si se pierde, se crea otra: no
   se puede volver a ver.
3. Pegar en `.env.local`:

```bash
LLM_PROVEEDOR=helmcode
HELMCODE_API_KEY=sk-hke_...
LLM_MODELO_RAZONAMIENTO=deepseek-v4-flash
LLM_MODELO_RAPIDO=qwen3.6
LLM_MODELO_VISION=qwen3.6
EMBEDDINGS_PROVEEDOR=helmcode
EMBEDDINGS_MODELO=qwen3-embedding
EMBEDDINGS_DIMENSIONES=512
```

> **La auditoría no depende de esta clave.** Las actas de cada decisión y de cada acción se
> componen de forma determinista a partir de los datos, sin pasar por el modelo; la IA solo añade
> narrativa encima (`conNarrativaIA: false` cuando no la hay). Si HelmCode se cae en mitad de una
> ejecución, el rastro de lo que el sistema hizo de verdad sigue completo.

4. Verificar (debe listar los modelos, no un 401):

```bash
curl -s https://api.helmcode.com/v1/models -H "Authorization: Bearer $HELMCODE_API_KEY" | head -c 400
curl -s https://api.helmcode.com/v1/chat/completions \
  -H "Authorization: Bearer $HELMCODE_API_KEY" -H "content-type: application/json" \
  -d '{"model":"qwen3.6","messages":[{"role":"user","content":"di OK"}],"max_tokens":5}'
```

**Modelos que usa Atalaya** (todos por la API compatible con OpenAI, base
`https://api.helmcode.com/v1`):

| Papel | Modelo | Para qué |
|---|---|---|
| Razonamiento | `deepseek-v4-flash` (1M contexto) | Coordinador, protección de población, patrones, supervisor, memoria, portavoz, redactor |
| Rápido + visión | `qwen3.6` (256K) | Verificador, prensa, centralita, asesor legal, análisis de fotogramas de cámara |
| Alternativa | `glm5.3-flash` | Si `deepseek-v4-flash` va saturado |
| Embeddings | `qwen3-embedding` a **512 dimensiones** | RAG del grafo de conocimiento y lecciones |
| Voz | `whisper-large-v3` (STT) · `kokoro` (TTS, 67 voces, <1 s) | Transcripción y locución en español |

> **Ojo con las dimensiones.** `lib/db/schema.sql` declara `vector(512)`. Si alguien cambia
> `EMBEDDINGS_DIMENSIONES`, hay que recrear las columnas `embedding` de `chunks` y
> `lecciones` y las funciones `buscar_chunks` / `buscar_lecciones`. **384 no está permitido
> en HelmCode** (verificado el 2026-09-19).

**Límites por clave:** 100 peticiones/min, 5 procesos concurrentes por modelo, 3M tokens/min.
Con 17 agentes esto se roza: el orquestador serializa y usa el modelo rápido donde puede.

**Plan B si HelmCode cae en mitad de la demo:** poner `LLM_PROVEEDOR=groq` y `GROQ_API_KEY`
(gratis, sin tarjeta, en https://console.groq.com/keys), con
`LLM_MODELO_RAZONAMIENTO=openai/gpt-oss-120b`, `LLM_MODELO_RAPIDO=openai/gpt-oss-20b`,
`LLM_MODELO_VISION=qwen/qwen3.8-27b`. Los embeddings NO son intercambiables en caliente
(cambian las dimensiones de pgvector): para eso está `EMBEDDINGS_PROVEEDOR=local`, que
calcula 384 dims en proceso y las rellena a 512.

---

## 2. Supabase — base de datos y pgvector

**Qué nos da:** histórico de ejecuciones, decisiones, **actas de auditoría y trazas de cada ciclo
de agente**, y las tablas `chunks` y `lecciones` con embeddings para el RAG y el aprendizaje entre
ejecuciones.

**Tiempo:** 10 minutos. **Coste:** gratis (plan Free: 500 MB, sobra).

**El proyecto ya existe:** `atalaya-incendios`, ref **`zpbhjyfidueckuegtpia`**, región
**eu-central-1 (Frankfurt)**. No crear otro.

1. Entrar en **https://supabase.com/dashboard/project/zpbhjyfidueckuegtpia**.
2. Menú lateral abajo → **Project Settings** (el engranaje) → **API**. La página tiene tres
   bloques: *Project URL*, *Project API keys* y *JWT Settings*.
   - **Project URL**: `https://zpbhjyfidueckuegtpia.supabase.co` → va en `SUPABASE_URL` y en
     `NEXT_PUBLIC_SUPABASE_URL`.
   - **`anon` / `public`** (en los proyectos nuevos aparece como *publishable key*, empieza
     por `sb_publishable_`): botón **Copy** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Es pública, no
     pasa nada si se ve.
   - **`service_role` / `secret`**: hay que pulsar **Reveal** (ojo tachado) antes de poder
     copiarla → `SUPABASE_SERVICE_ROLE_KEY`. **Solo servidor.** Salta RLS por completo; si se
     filtra, rotarla desde esa misma pantalla.
3. **Contraseña de la base de datos** (para `DATABASE_URL`, opcional — el repositorio usa la
   API REST, no una conexión directa): **Project Settings → Database → Connection string →
   Transaction pooler**, y sustituir `[YOUR-PASSWORD]`. Si no se recuerda: **Reset database
   password** en esa misma pantalla.
4. **Aplicar el esquema.** SQL editor: menú lateral, icono `SQL` → **New query**, o directo a
   **https://supabase.com/dashboard/project/zpbhjyfidueckuegtpia/sql/new**. Pegar entero el
   contenido de `lib/db/schema.sql` y pulsar **Run** (o `⌘↵`). Debe terminar en
   *"Success. No rows returned"*. Es idempotente (`create table if not exists`): se puede
   volver a ejecutar sin romper nada.
5. Comprobar: menú **Table Editor** → deben aparecer `ejecuciones`, `incendios`, `unidades`,
   `poblaciones`, `observaciones`, `decisiones`, `informes`, `trazas`, `comunicados`, `eventos`,
   `camaras_analisis`, `politica`, `documentos`, `chunks`, `lecciones`.
   `informes` guarda las actas (decisión, acción, situación, ciclo, post-mortem) y `trazas` lo que
   vio y pensó cada agente en cada ciclo: juntas son la cadena que sirve `/api/auditoria`.

```bash
SUPABASE_URL=https://zpbhjyfidueckuegtpia.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...            # o sb_secret_...
NEXT_PUBLIC_SUPABASE_URL=https://zpbhjyfidueckuegtpia.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...        # o sb_publishable_...
# Opcional: milisegundos antes de cortar una petición a Supabase (15000 por defecto).
# Con la base lenta o caída ninguna ruta espera más que esto; la persistencia reintenta sola.
SUPABASE_TIMEOUT_MS=15000
# Opcional: nombre de esta instancia en la base compartida (por defecto, el nombre del
# equipo; en Railway, el id del servicio). Cada instancia solo recupera y lista SUS
# ejecuciones, guarda su propia política y sus filas llevan este nombre delante del id.
ATALAYA_INSTANCIA=javi
# Quién guarda la ejecución en Supabase: 1 = esta instancia, 0 = nadie. Sin la variable,
# solo Railway. Los `next dev` sin ella viven en memoria y no cargan la base compartida
# (que se colapsó el 19-09 con cuatro servidores volcando a la vez); lecciones y
# conocimiento se siguen leyendo igual.
SUPABASE_PERSISTIR=1
```

```bash
# Verificación (debe devolver [] o filas, no un 401):
curl -s "$SUPABASE_URL/rest/v1/ejecuciones?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

> Las tablas van **sin RLS a propósito**: solo las toca el proceso Node con la
> `service_role`. No hay ningún cliente de navegador hablando con Supabase.

---

## 3. NASA FIRMS — focos activos por satélite

**Qué nos da:** detecciones VIIRS/MODIS de calor sobre España cada ~3 h tras cada pasada
(hasta ~14 pasadas al día sumando SNPP, NOAA-20 y NOAA-21). Es la fuente del agente Satélite.

**Tiempo:** 5 minutos (la clave llega por email al instante). **Coste:** gratis.

1. Ir a **https://firms.modaps.eosdis.nasa.gov/api/map_key/**.
2. La página tiene un formulario corto con un único campo de **email** y un botón de
   solicitud. Escribir el correo (`javimorgalis@gmail.com`) y enviar. **No hace falta cuenta
   Earthdata.**
3. Llega un email de *FIRMS* con la **MAP_KEY**: una cadena hexadecimal de ~32 caracteres.
4. Si el email ya estaba registrado, la propia web redirige a
   **https://firms.modaps.eosdis.nasa.gov/download/** para reenviar, modificar o borrar la
   mapkey existente.
5. Guardar como `FIRMS_MAP_KEY`.

```bash
# Estado de la clave (JSON con current_transactions / transaction_limit):
curl -s "https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=$FIRMS_MAP_KEY"
# Primera consulta real, España peninsular + Baleares, último día:
curl -s "https://firms.modaps.eosdis.nasa.gov/api/area/csv/$FIRMS_MAP_KEY/VIIRS_NOAA20_NRT/-9.5,35.9,4.4,43.9/1"
```

- **Límite: 5.000 transacciones cada 10 minutos.** Un rango de días grande cuenta como varias
  transacciones; el agente Satélite pide 1 día cada 600 s, así que no se acerca.
- **No existe el endpoint por país** (`/api/country/...` devuelve *"Invalid API call."*).
  Siempre bbox: península + Baleares `-9.5,35.9,4.4,43.9`; Canarias
  `-18.3,27.5,-13.3,29.5`.
- En septiembre puede no haber ningún foco real activo en España. Es lo normal y **no es un
  fallo**: para la demo se declara el foco a mano con un clic en el mapa.

---

## 4. HappyRobot — llamadas, SMS y email reales

**Qué nos da:** la ejecución real fuera del sistema que pide el jurado. Es la plataforma del
reto y la instancia es la **europea**: `https://platform.eu.happyrobot.ai` (la global
responde 401 con la misma clave).

**Tiempo:** 30-45 minutos la primera vez. **Coste:** la organización cubre la compra del
número americano; las llamadas salientes son gratis para los equipos del hackathon.

### 4.1 Crear la API key

1. Entrar en **https://platform.eu.happyrobot.ai** con la cuenta de la organización del
   hackathon.
2. Arriba a la derecha, el selector de organización: comprobar que es la del reto (si hay
   varias, la clave solo vale para la seleccionada).
3. Menú de configuración (engranaje) → **API Keys** → **Create API key**. Nombre
   `atalaya`. Se muestra una sola vez y empieza por **`sk_live_`** (en el entorno de pruebas,
   `sk_test_`).
4. Pegar en `.env.local`:

```bash
HAPPYROBOT_API_BASE=https://platform.eu.happyrobot.ai
HAPPYROBOT_API_KEY=sk_live_...
HAPPYROBOT_ENVIRONMENT=production
```

5. Verificar que la clave ve los workflows:

```bash
curl -s "$HAPPYROBOT_API_BASE/api/v2/workflows" -H "Authorization: Bearer $HAPPYROBOT_API_KEY" | head -c 600
```

### 4.2 Comprar el número americano

1. En el menú lateral, **Phone numbers** (o *Numbers*) → **Buy number**.
2. País **United States**, elegir cualquier prefijo disponible (por ejemplo +1 415 o +1 646).
   Coste mensual bajo; **lo cubre la organización** — confirmarlo con ellos antes de comprar.
3. Tras la compra, el número aparece en la lista con dos desplegables: **Inbound workflow**
   (qué contesta cuando alguien llama) y el número en formato E.164 (`+1XXXXXXXXXX`).
4. Ese número es el remitente de las llamadas y SMS salientes. **Los SMS solo funcionan desde
   un número USA**; a España llegan igual.

> Los teléfonos de los ayuntamientos que saca Overpass de OpenStreetMap son reales, y
> **nunca** se les llama en una demo. Por eso existe `DESTINO_DEMO`: el móvil de quien
> presenta, en E.164 (`+34...`). El núcleo marca esas poblaciones con
> `telefonoEsDemo: true` y la sala lo enseña, para que el jurado vea que no se está
> ocultando nada.

### 4.3 Publicar los workflows

Atalaya dispara tres workflows por su `slug`. Cada uno recibe un `payload`; **cada clave del
payload llega al workflow como `@clave`** y se puede usar dentro de los prompts y plantillas.

| Canal | Variable con el slug | Nodos mínimos | Claves del payload que recibe |
|---|---|---|---|
| Voz saliente | `HAPPYROBOT_WORKFLOW_SLUG_VOZ` | *Outbound call* → *AI agent* (prompt con `@guion`) → *Webhook* al final | `telefono`, `guion`, `contexto`, `decision_id`, `accion_id`, `incendio_id` |
| SMS | `HAPPYROBOT_WORKFLOW_SLUG_SMS` | *Send SMS* | `destino`, `texto`, `decision_id`, `accion_id` |
| Email | `HAPPYROBOT_WORKFLOW_SLUG_EMAIL` | *Send email* | `destino`, `asunto`, `texto`, `decision_id`, `accion_id` |

1. **Workflows** → **New workflow** → elegir el trigger correspondiente.
2. Construir el flujo y, en el nodo del agente de voz, usar `@guion` como instrucciones y
   `@contexto` para los datos del incendio. El guion lo redacta el agente de Protección de
   Población en cada decisión: no hay que escribir el texto a mano.
3. **Publicar**: botón **Publish** arriba a la derecha. Un workflow sin publicar **no se puede
   lanzar por API** (`latest_version.is_published` en falso) y Atalaya lo marcará en rojo.
4. Copiar el **slug** de cada uno: está en la URL
   (`platform.eu.happyrobot.ai/workflows/<slug>`) y en la lista de
   `GET /api/v2/workflows`.
5. Añadir a cada workflow un nodo final de **Webhook** apuntando a
   `<PUBLIC_BASE_URL>/api/webhooks/happyrobot/resultado`, con la cabecera
   `x-webhook-secret`. Así el Ejecutor sabe si el ayuntamiento contestó, confirmó o rechazó.

### 4.4 Llamada entrante con el nodo "Web Call"

Para enseñar al jurado el 112 al revés (un ciudadano llama y la centralita de Atalaya le
atiende) sin depender de la cobertura de la sala:

1. **New workflow** → trigger **Web Call**.
2. Añadir el *AI agent* con el prompt de la centralita: preguntar dónde es, qué ve, si hay
   personas en riesgo, y colgar confirmando.
3. En ese agente, configurar una **herramienta HTTP** que llame a
   `GET <PUBLIC_BASE_URL>/api/happyrobot/contexto?lugar=...` para que el agente de voz sepa si
   ya hay un incendio declarado cerca de ese sitio.
4. Nodo final de **Webhook** a `<PUBLIC_BASE_URL>/api/webhooks/happyrobot/llamada` con la
   cabecera `x-webhook-secret`.
5. **Publish** y copiar la **URL pública de la llamada web** que da la plataforma (un enlace
   con un botón de micrófono que se abre en el navegador). Guardarla en
   `HAPPYROBOT_WEB_CALL_URL`: la sala de mando la usa para el botón "Llamar al 112 virtual".

### 4.5 Secreto de webhook

Lo inventamos nosotros: es una cadena cualquiera que se configura **igual** en los dos lados.

```bash
openssl rand -hex 24        # p. ej. 9f2c...
```

- En `.env.local` / Railway: `HAPPYROBOT_WEBHOOK_SECRET=<esa cadena>`.
- En cada nodo Webhook de HappyRobot: cabecera **`x-webhook-secret`** con el mismo valor (si
  se activa el modo *Enhanced Security*, HappyRobot manda además `x-api-key`; el cliente
  acepta las dos).
- `lib/happyrobot/cliente.ts#verificarWebhook` rechaza con 401 cualquier webhook sin esa
  cabecera. **Sin secreto configurado, todos los webhooks se rechazan**: no hay modo abierto.

```bash
HAPPYROBOT_WORKFLOW_SLUG_VOZ=   # voz saliente DESACTIVADA (solo SMS, 19-09): opcional
HAPPYROBOT_WORKFLOW_SLUG_SMS=
HAPPYROBOT_WORKFLOW_SLUG_EMAIL=
HAPPYROBOT_WEB_CALL_URL=
HAPPYROBOT_WEBHOOK_SECRET=
DESTINO_DEMO=+34...          # llamadas y SMS de las acciones (avisos a población…); vacío → TELEFONO_AVISOS_SMS
TELEFONO_AVISOS_SMS=+34...   # SMS del agente del 112 (aviso registrado + herramienta enviar_sms); vacío → DESTINO_DEMO. Basta con rellenar uno de los dos
EMAIL_DEMO=...
```

> Los nombres exactos de los nodos y de las pestañas pueden variar según la versión de la
> plataforma. Lo que **no** cambia es el contrato que usa Atalaya:
> `POST /api/v2/workflows/{slug}/runs?environment=production` con `Authorization: Bearer` y
> `{"payload": {...}}`. Si un nombre de menú no coincide, buscar el que haga eso mismo.

---

## 5. Telegram — canal ciudadano bidireccional

**Por qué Telegram y no WhatsApp:** WhatsApp Business API exige una cuenta de Meta Business
verificada (días de trámite). Telegram da lo mismo en 5 minutos, gratis, con fotos y
ubicación, y **se valora igual** como canal real.

**Tiempo:** 5 minutos. **Coste:** gratis.

### 5.1 Crear el bot

1. Abrir Telegram y buscar **@BotFather** (el verificado, con el tic azul).
2. `/newbot`.
3. BotFather pide el **nombre visible**: `Atalaya Incendios`.
4. Después pide el **username**, que debe acabar en `bot`: `atalaya_incendios_bot` (si está
   cogido, probar otro).
5. Responde con un mensaje que contiene el **token**, con el formato
   `123456789:AAH...` (un número, dos puntos, ~35 caracteres). Ese es
   `TELEGRAM_BOT_TOKEN`. Si se filtra, `/revoke` en BotFather.
6. Opcional para la demo: `/setdescription` y `/setuserpic` para que el bot tenga cara.

### 5.2 Obtener el chat id

1. En Telegram, **abrir el chat con el bot y pulsar Iniciar / enviar cualquier mensaje**
   (`hola`). Sin ese primer mensaje del humano, el bot **no puede escribir** a nadie: es una
   regla de Telegram, no un fallo nuestro.
2. Pedir los updates:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates" | python3 -m json.tool
```

3. En la respuesta, `result[0].message.chat.id` es el número que buscamos (positivo para un
   chat personal, **negativo** para un grupo, p. ej. `-1001234567890`).
4. Para un grupo ("Ayuntamientos · demo"): crear el grupo, **añadir el bot como miembro**,
   escribir un mensaje en el grupo y repetir el `getUpdates`.
5. Guardar como `TELEGRAM_CHAT_ID_DEMO`.

> Si `getUpdates` devuelve `{"ok":true,"result":[]}` es que (a) no se ha escrito al bot o
> (b) ya hay un webhook registrado, que se queda con los updates. Para el paso 3, borrarlo
> primero: `curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"`.

### 5.3 Registrar el webhook con `secret_token`

Necesita la URL pública HTTPS (§7 túnel o Railway).

```bash
export TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24)
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  -d "{\"url\":\"$PUBLIC_BASE_URL/api/webhooks/telegram\",
       \"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET\",
       \"allowed_updates\":[\"message\",\"edited_message\"],
       \"drop_pending_updates\":true}"
# -> {"ok":true,"result":true,"description":"Webhook was set"}
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | python3 -m json.tool
```

- Telegram enviará cada update con la cabecera **`X-Telegram-Bot-Api-Secret-Token`**, que
  `lib/telegram/cliente.ts#verificarWebhookTelegram` compara con `TELEGRAM_WEBHOOK_SECRET`.
- El `secret_token` solo admite `A-Z a-z 0-9 _ -`, entre 1 y 256 caracteres: `openssl rand
  -hex` cumple.
- Telegram **exige HTTPS con certificado válido**: `localhost` no vale, el túnel sí.
- Alternativa sin tocar curl: la app lo registra sola con
  `configurarWebhook(urlPublica())` cuando la URL pública está disponible.
- **La URL del quick tunnel cambia cada vez que se reabre**: hay que repetir el `setWebhook`.

```bash
TELEGRAM_BOT_TOKEN=123456789:AAH...
TELEGRAM_CHAT_ID_DEMO=-1001234567890
TELEGRAM_WEBHOOK_SECRET=...
```

```bash
# Prueba de envío:
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -H "content-type: application/json" \
  -d "{\"chat_id\":\"$TELEGRAM_CHAT_ID_DEMO\",\"text\":\"Atalaya operativa\"}"
```

---

## 6. Exa — búsqueda web y prensa

**Qué nos da:** noticias recientes de incendios con texto completo, para el agente de Prensa y
redes (junto con Google News RSS y Bluesky, que no llevan clave).

**Tiempo:** 3 minutos. **Coste:** **10 € / 20 $ de crédito gratis al registrarse**, sin
tarjeta, más recarga mensual del tier gratuito. Una búsqueda cuesta $0,007: con el crédito
inicial caben ~2.800.

1. **https://exa.ai** → **Sign up** (Google o email).
2. Dashboard: **https://dashboard.exa.ai**.
3. Menú lateral **API Keys** → **Create API Key** → nombre `atalaya` → copiar (se enseña una
   vez, en un recuadro con botón de copiar).
4. El crédito gratuito se aplica solo; se ve en **Billing / Usage** arriba a la derecha.
5. `EXA_API_KEY=`. Se manda en la cabecera `x-api-key` (también acepta `Authorization:
   Bearer`).

```bash
curl -s https://api.exa.ai/search -H "x-api-key: $EXA_API_KEY" -H "content-type: application/json" \
  -d '{"query":"incendio forestal España hoy","category":"news","numResults":3,
       "startPublishedDate":"2026-09-18T00:00:00.000Z"}' | head -c 500
```

---

## 7. AEMET OpenData — avisos oficiales

**Qué nos da:** avisos CAP oficiales de España y los mapas de riesgo de incendio forestal.
**Opcional**: Meteoalarm (sin clave) reemite los mismos avisos de AEMET y es lo que usa
Atalaya por defecto; AEMET añade el sello oficial y los mapas de riesgo.

**Tiempo:** 5 minutos. **Coste:** gratis.

1. **https://opendata.aemet.es/centrodedescargas/altaUsuario** (también se llega desde
   https://opendata.aemet.es/ → *Obtención API Key* → *Solicitar*).
2. Formulario corto: **email** y casilla de aceptar las condiciones. **Generar**.
3. Llega un **email con un enlace de confirmación**. Al pulsarlo, la web muestra la **API key:
   un JWT largo** (tres bloques separados por puntos, ~300 caracteres). Copiarla entera,
   incluidos los puntos.
4. `AEMET_API_KEY=`.

```bash
# AEMET va en DOS pasos: la API devuelve una URL temporal, y el dato está ahí.
curl -s "https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/esp?api_key=$AEMET_API_KEY"
# -> {"descripcion":"exito","estado":200,"datos":"https://opendata.aemet.es/opendata/sh/XXXX",...}
curl -s "https://opendata.aemet.es/opendata/sh/XXXX" -o avisos.tar.gz
```

- **Encoding ISO-8859-15**, no UTF-8: hay que transcodificar o salen las tildes rotas.
- El riesgo de incendio de AEMET es una **imagen PNG**, no números por municipio: sirve para
  enseñarlo, no para que un agente razone con él. El índice de peligro numérico lo calcula
  `lib/fuentes/peligro.ts` con datos de Open-Meteo.
- Las URLs `sh/` **caducan** en minutos: no guardarlas.

---

## 8. Railway — despliegue público

**Tiempo:** 15 minutos. **Coste:** 5 $ de crédito de prueba; el plan Hobby son 5 $/mes.

1. **https://railway.com** → **Login with GitHub**.
2. **New Project** → **Deploy from GitHub repo** → autorizar la organización → elegir el
   repositorio de Atalaya. Railway detecta Next.js y usa `npm run build` + `npm start`.
   - *Sin repo en GitHub* (este proyecto **no se commitea**): **New Project → Empty Project**,
     y desde el portátil `npm i -g @railway/cli && railway login && railway link && railway up`,
     que sube el directorio tal cual.
3. **Región EU**: servicio → **Settings** → **Deploy** → *Region* → **europe-west4
   (Amsterdam)**. Conviene que coincida con Supabase eu-central-1 para la latencia y por
   coherencia de datos europeos.
4. **Variables**: servicio → pestaña **Variables** → **Raw editor** → pegar el `.env.local`
   entero de golpe (menos `PUBLIC_BASE_URL`, que se pone en el paso 6). Guardar; Railway
   redespliega.
5. **Dominio público**: **Settings** → **Networking** → **Generate Domain** → puerto `3000`.
   Sale algo como `atalaya-incendios-production.up.railway.app`.
6. Volver a **Variables** y poner `PUBLIC_BASE_URL=https://<ese dominio>` (sin barra final).
   Redespliega otra vez.
7. **Healthcheck**: **Settings** → **Deploy** → *Health Check Path* → `/api/salud`.
8. Rehacer los webhooks con el dominio definitivo: `setWebhook` de Telegram y las URLs de los
   nodos Webhook de HappyRobot.

> `instrumentation.ts` arranca el orquestador al levantar el proceso, así que el mundo empieza
> a correr en cuanto Railway despliega. El estado vivo está **en memoria**: cada redespliegue
> reinicia la ejecución (el histórico queda en Supabase). **No redesplegar durante la demo.**

---

## 9. Cloudflare quick tunnel — HTTPS en local

**Para qué:** la cámara, el GPS y el micrófono del móvil solo funcionan en contexto seguro
(HTTPS), y los webhooks de HappyRobot y Telegram no pueden apuntar a `localhost`. El quick
tunnel da una URL `https://*.trycloudflare.com` **sin cuenta ni clave**.

**Tiempo:** 3 minutos. **Coste:** gratis.

```bash
brew install cloudflared            # una sola vez
npm run dev -- --port 3456          # terminal 1: la app
scripts/tunel.sh 3456               # terminal 2: el túnel
```

El script imprime la URL en cuanto Cloudflare la asigna y la escribe en
`data/url-publica.txt`. `lib/motor/entorno.ts#urlPublica()` lee ese archivo **con prioridad
sobre `PUBLIC_BASE_URL`**, porque es lo que está vivo ahora mismo; así el QR del móvil y las
URLs de webhook salen correctas sin reiniciar nada.

```
Abriendo túnel hacia http://localhost:3456 …
==> URL pública: https://random-words-1234.trycloudflare.com   (móvil: .../movil)
```

- La página del móvil está en **`/movil`** (el script imprime `/periferico`, nombre antiguo
  de la sesión poc-07: ir siempre a `/movil`).
- **La URL cambia cada vez que se reabre el túnel.** Después de reabrirlo hay que rehacer el
  `setWebhook` de Telegram y editar las URLs de los webhooks en HappyRobot. Por eso conviene
  **abrir el túnel una vez y no cerrarlo** durante toda la demo.
- Los quick tunnels no tienen SLA. Si el túnel se cae en mitad de la presentación: reabrirlo,
  volver a hacer `setWebhook` y seguir; las llamadas salientes de HappyRobot funcionan igual
  (solo se pierde el webhook de resultado).
- Sin túnel, `PUBLIC_BASE_URL` con `localhost` se ignora a propósito: el cliente de HappyRobot
  devuelve `undefined` en vez de mandar una URL de webhook que nunca respondería.
- **Al cerrar el script** (Ctrl+C, cerrar el terminal o caída de cloudflared) `data/url-publica.txt`
  se vacía: si quedara la URL vieja, el QR del móvil apuntaría a un túnel muerto. Además el cuadro
  "Unir un móvil" comprueba que la URL responde (`GET /api/movil/enlace`) y lo avisa si no.
- **Redes que bloquean trycloudflare.com** (la WiFi de la UPM, con filtro DNS: `api.trycloudflare.com`
  devuelve SERVFAIL y el puerto 7844 está cerrado): cloudflared muere con `no such host`. El script lo
  detecta antes de arrancar. Solución: conectar el Mac al hotspot del móvil (comprobado el 19-09-2026).

---

## 10. Variable de entorno → de dónde sale → obligatoria → qué se cae sin ella

| Variable | De dónde sale | ¿Obligatoria? | Qué deja de funcionar sin ella |
|---|---|---|---|
| `ORGANISMO_NOMBRE` | La escribes tú | No (tiene valor por defecto) | Cabecera y firma de los comunicados salen genéricas |
| `NEXT_PUBLIC_APP_NOMBRE` | La escribes tú | No | La marca de la sala dice "Atalaya" por defecto |
| `PUBLIC_BASE_URL` | Dominio de Railway (§8) o túnel (§9) | **Sí para webhooks** | HappyRobot y Telegram no pueden devolver resultados; el QR del móvil no se genera; la llamada entrante no llega |
| `DATABASE_URL` | Supabase → Settings → Database → pooler (§2.3) | No | Nada: el repositorio usa la API REST. Solo para scripts SQL directos |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL | Recomendada | Sin persistencia: todo vive en memoria y se pierde al reiniciar; sin RAG, sin lecciones entre ejecuciones y sin histórico de auditoría (las actas y trazas de la ejecución en curso siguen en el snapshot). La barra de servicios lo marca en rojo |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` (**Reveal**) | Recomendada | Igual que la anterior: no se escribe ni se lee nada |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | No | Nada hoy (ningún componente de navegador habla con Supabase); reservadas |
| `LLM_PROVEEDOR` | La escribes tú: `helmcode` \| `groq` \| `openai` | Sí | Por defecto `helmcode` |
| `HELMCODE_API_KEY` | cloud.helmcode.com → API Keys (§1) | **Sí** (si `LLM_PROVEEDOR=helmcode`) | **Se cae todo lo que razona**: verificador, coordinador, protección de población, patrones, supervisor, portavoz, memoria, asesor legal y el análisis de cámaras. Quedan los agentes deterministas (satélite, propagación, despachador, ejecutor) y, por diseño, **las actas de auditoría**, que se componen sin modelo |
| `GROQ_API_KEY` | console.groq.com/keys | No (plan B) | Nada mientras HelmCode responda |
| `OPENAI_API_KEY` | platform.openai.com | No | Nada |
| `LLM_MODELO_RAZONAMIENTO` / `_RAPIDO` / `_VISION` | Catálogo del proveedor (§1) | No (hay defaults) | Se usa el modelo por defecto; si el id no existe, error 404 visible del proveedor |
| `LLM_VISION_PROVEEDOR` | La escribes tú | No | La visión usa el mismo proveedor que el chat |
| `EMBEDDINGS_PROVEEDOR` / `_MODELO` / `_DIMENSIONES` | §1 | Sí si se usa el grafo | Con `local` funciona sin clave (384 → rellenado a 512). Si las dimensiones no cuadran con `vector(512)` del esquema, **toda inserción en `chunks`/`lecciones` falla** |
| `JINA_API_KEY` | jina.ai/embeddings (autogenerada en la página) | No | Nada mientras haya otro proveedor de embeddings |
| `EXA_API_KEY` | dashboard.exa.ai → API Keys (§6) | No | El agente de Prensa y redes pierde una de sus tres fuentes; sigue con Google News RSS y Bluesky |
| `HAPPYROBOT_API_BASE` | Fijo: `https://platform.eu.happyrobot.ai` | Sí | Contra la instancia global la clave da 401 |
| `HAPPYROBOT_API_KEY` | Plataforma → API Keys (§4.1) | **Sí para la demo** | **No hay llamadas, SMS ni email reales**: las acciones de esos tipos fallan con "falta HAPPYROBOT_API_KEY". Se pierde el criterio de ejecución real del jurado |
| `HAPPYROBOT_ENVIRONMENT` | `production` o `test` | No | Por defecto `production` |
| `HAPPYROBOT_WORKFLOW_SLUG_VOZ` | URL del workflow publicado (§4.3) | Sí para llamar | Las acciones `llamar` fallan con "Falta HAPPYROBOT_WORKFLOW_SLUG_VOZ" |
| `HAPPYROBOT_WORKFLOW_SLUG_SMS` | Ídem | Sí para SMS | Las acciones `enviar_sms` fallan igual |
| `HAPPYROBOT_WORKFLOW_SLUG_EMAIL` | Ídem | No | Las acciones `enviar_email` fallan; el resto sigue |
| `HAPPYROBOT_WEB_CALL_URL` | URL pública del workflow Web Call (§4.4) | No | Desaparece el botón "Llamar al 112 virtual" de la sala; no se puede enseñar la llamada entrante |
| `HAPPYROBOT_WEBHOOK_SECRET` | La inventas (`openssl rand -hex 24`) (§4.5) | **Sí si hay webhooks** | **Todos los webhooks de HappyRobot se rechazan con 401**: no se sabe si el ayuntamiento contestó ni entran las llamadas ciudadanas |
| `DESTINO_DEMO` | Tu móvil en E.164 | **Sí para la demo** | Se llamaría a teléfonos reales de ayuntamientos sacados de OSM. Sin él, las poblaciones sin teléfono en OSM no se pueden avisar por voz |
| `EMAIL_DEMO` | Tu correo | No | Los emails de demo no tienen destinatario de respaldo |
| `TELEGRAM_BOT_TOKEN` | @BotFather (§5.1) | Recomendada | Sin canal Telegram: no se pueden mandar avisos ni recibir fotos/ubicación de ciudadanos |
| `TELEGRAM_CHAT_ID_DEMO` | `getUpdates` (§5.2) | No | El bot solo puede responder a quien le escriba primero; no hay chat de avisos por defecto |
| `TELEGRAM_WEBHOOK_SECRET` | La inventas (§5.3) | Sí si hay webhook | **Todo update entrante se rechaza**: el bot no recibe nada |
| `FIRMS_MAP_KEY` | Email de NASA FIRMS (§3) | Recomendada | El agente Satélite no detecta nada y se marca en rojo. Los focos hay que declararlos a mano o por cámara/llamada |
| `AEMET_API_KEY` | opendata.aemet.es (§7) | No | Se pierden los avisos oficiales de AEMET y los mapas de riesgo; quedan los de Meteoalarm, que son los mismos sin clave |
| `WINDY_WEBCAMS_KEY` | api.windy.com/keys | No | Nada: no se usa. Hay cámaras DGT y Madrid de sobra |
| `ACELERACION_TIEMPO` | La escribes tú (por defecto 12) | No | Con 12, 5 s reales = 1 min de mundo. Más alto, el viento gira antes; más bajo, la demo se hace larga |
| `TICK_MS` | Por defecto 5000 | No | Periodo del orquestador; bajarlo mucho satura los límites de HelmCode |
| `CAMARAS_INTERVALO_SEG` | Por defecto 20 | No | Cada cuánto analiza el Vigía una cámara vigilada. Bajarlo gasta tokens de visión muy rápido |

### Comprobación final de un tirón

```bash
npm run dev -- --port 3456
open http://localhost:3456/api/salud       # cada servicio con ok/ko y el motivo literal
```

`/api/salud` es la fuente de verdad: enseña Open-Meteo, DGT, Madrid, Overpass, OSRM,
Nominatim, Meteoalarm, FIRMS, Exa, Bluesky, RSS, el proveedor de IA, Supabase, HappyRobot y
Telegram, cada uno con su latencia real y el mensaje de error exacto si falla. Es también la
barra de estado de la sala de mando: **si algo está en rojo ahí, en la demo va a fallar**.
