# HappyRobot en Atalaya (voz, SMS y email reales)

DUEÑO: constructor D. Instancia **europea**: `https://platform.eu.happyrobot.ai`
(la global `platform.happyrobot.ai` responde `401 invalid or revoked API key` con la misma
clave válida; está verificado).

Este documento es la receta para dejar los cuatro workflows montados en la plataforma. Todo
lo que aquí se marca como **verificado** se ha comprobado contra la API real con la clave de
`.env.local`; lo demás está marcado como **por verificar en la plataforma**.

---

## 1. Contrato de la API (verificado 2026-09-19)

```
POST {HAPPYROBOT_API_BASE}/api/v2/workflows/{slug}/runs?environment=production
Authorization: Bearer sk_live_…
Content-Type: application/json

{ "payload": { "telefono": "+34…", "guion": "…", "webhook_url": "https://…", "secreto": "…" } }
```

- Cada clave de `payload` llega al workflow como variable **`@clave`**. Hay que declararlas
  como *Params* del **Webhook trigger**.
- El `slug` es el identificador corto que aparece en la URL del workflow en la plataforma.
- El resultado vuelve porque el workflow tiene un nodo **Webhook action** que hace `POST` a
  `@webhook_url` con la cabecera `x-webhook-secret: @secreto`.

**Listado de workflows (verificado, HTTP 200):**

```
GET {HAPPYROBOT_API_BASE}/api/v2/workflows
→ { "data": [ { "id", "name", "slug", "latest_version": { "is_published", "is_live", "environment" } } ],
    "pagination": { ... } }
```

Estado de la organización al verificar (19-09-2026): dos workflows, `fireops-smoke-test`
(slug `gl66iagfekl0`, **publicado** en entorno `development`) y `test` (slug `dv8dgak51ypj`,
**sin publicar**, entorno `production`). Un workflow sin publicar no tiene versión viva:
**hay que publicarlo antes de lanzar runs**, y el `environment` del run tiene que coincidir
con el de la versión publicada (`HAPPYROBOT_ENVIRONMENT`).

Lo usa `lib/happyrobot/cliente.ts`: `happyrobotDisponible(canal)`, `llamar`, `enviarSms`,
`enviarEmail`, `verificarWebhook(headers)`, `listarWorkflows()`, `estadoCanal(canal)`.
La pantalla `GET /api/happyrobot/salud` enseña todo esto de un vistazo.

### Indicaciones de los organizadores del reto

- Se puede **comprar un número americano** desde la plataforma: lo cubren ellos.
- Las **llamadas salientes no se cobran**.
- El **SMS funciona con el número americano** (el destino va en E.164: `+34…`).
- Para llamadas **entrantes** se usa un nodo **Web Call** (llamada desde el navegador), no un
  número de teléfono. Su URL va en `HAPPYROBOT_WEB_CALL_URL` y aparece como botón
  "Llamar al 112 virtual" en `/publico` y en `/parte`. Si la variable está vacía, el botón no se muestra.

---

## 2. Qué hace cada lado

| Sentido | Quién | Endpoint | Cuándo |
|---|---|---|---|
| Atalaya → HappyRobot | `lib/happyrobot/cliente.ts` | `POST …/api/v2/workflows/{slug}/runs` | Al ejecutarse una acción `llamar`, `enviar_sms`, `enviar_email`, `avisar_poblacion`, `confinar_poblacion`, `evacuar_poblacion`, `solicitar_medios_aereos`, `cortar_carretera`, `solicitar_confirmacion` |
| HappyRobot → Atalaya | Nodo **Webhook action** | `POST /api/webhooks/happyrobot/resultado` | Al terminar la llamada, el SMS o el email |
| HappyRobot → Atalaya | Nodo **Webhook action** del entrante | `POST /api/webhooks/happyrobot/llamada` (o `/sms`, `/email`) | Al colgar una llamada ciudadana |
| HappyRobot → Atalaya | Nodo **API call** del agente de voz | `GET /api/happyrobot/contexto?texto=&lat=&lon=` | Durante la conversación, para saber si ya hay un incendio cerca |

Los webhooks **exigen** la cabecera `x-webhook-secret` con el valor de
`HAPPYROBOT_WEBHOOK_SECRET`. Sin ella devuelven `401`.

La URL pública la resuelve `urlPublica()` (`lib/motor/entorno.ts`): primero
`data/url-publica.txt` (lo escribe `scripts/tunel.sh`), después `PUBLIC_BASE_URL`. Si no hay
ninguna, **no se manda `webhook_url`** y en el acta queda escrito que no había retorno posible.

---

## 3. Los cuatro workflows

> **Atajo por API (2026-09-19).** La API pública v2 permite crear los workflows desde plantilla,
> fijar prompt, voz y número, añadir el webhook de resultado y publicar. Todo eso lo hace
> `scripts/happyrobot-workflows.mjs` (Node ≥ 18, sin dependencias, lee `.env.local`):
>
> ```bash
> node scripts/happyrobot-workflows.mjs estado       # qué hay en la organización
> node scripts/happyrobot-workflows.mjs crear        # 4 workflows desde plantilla (sin pruebas)
> node scripts/happyrobot-workflows.mjs configurar   # prompts de esta guía, voz es-ES, +1 573 401 8744, webhook
> node scripts/happyrobot-workflows.mjs publicar     # producción; el de voz exige DESTINO_DEMO
> node scripts/happyrobot-workflows.mjs env          # escribe los slugs en .env.local
> node scripts/happyrobot-workflows.mjs limpiar --confirmar   # borra los cascarones vacíos
> ```
>
> Guarda ids y slugs en `data/happyrobot-workflows.json`. Las plantillas `sms-agent` (Twilio) y
> `email-agent` (Gmail) exigen credenciales en la organización: si fallan al crear, ese canal se
> monta a mano siguiendo 3.2 / 3.3. El enlace del Web Call (3.4) se copia del trigger en la
> plataforma. Al publicar, la plataforma prueba los nodos no probados: el de voz marcaría el
> teléfono de muestra, que es `DESTINO_DEMO`.


Sidebar → **Workflows → Create workflow → From Scratch**. Al terminar cada uno,
**Publish** (y apunta en qué entorno lo publicas).

### 3.1 `Atalaya · Llamada saliente` → `HAPPYROBOT_WORKFLOW_SLUG_VOZ`

**Nodo 1 · Trigger: Webhook.** En *Event Setup* declara estos *Params*:

| Param | Contenido |
|---|---|
| `telefono` / `phone_number` / `destino` | Teléfono en E.164 al que llamar |
| `guion` / `mensaje` | Texto que debe decir el agente (lo escribe el planificador con el LLM) |
| `incendio` | "Incendio de Navalacruz (Navalacruz, Ávila)" |
| `municipio` | Pueblo al que se avisa |
| `organismo` | Nombre del organismo que llama |
| `nivel`, `superficieHa` | Contexto del incendio |
| `tituloDecision`, `resumenDecision` | Qué se ha decidido y por qué |
| `decisionId`, `accionId` | **Se devuelven tal cual** en el webhook de resultado |
| `webhook_url` | Adónde devolver el resultado |
| `secreto` | Valor para la cabecera `x-webhook-secret` |
| `canal` | `voz` |

**Nodo 2 · AI Agent → Outbound Voice Agent.** *To number* = `@telefono`. Número saliente:
el americano comprado en **Telephony**. Voz e idioma: **español (España)**.

Prompt del agente (cópialo tal cual):

```
Eres el operador de voz del @organismo, el centro que coordina la respuesta a un incendio
forestal. Llamas al Ayuntamiento de @municipio (o al organismo indicado) en nombre de la sala
de coordinación. Hablas en español de España, con calma, despacio y sin tecnicismos.

Guion que debes transmitir:
@guion

Contexto por si te preguntan: @incendio, nivel de gravedad @nivel, superficie estimada
@superficieHa hectáreas. Decisión tomada: @tituloDecision. Motivo: @resumenDecision.

Cómo debes conducir la llamada:
1. Preséntate: "Buenos días, le llamo del @organismo".
2. Di en una frase qué ocurre y a qué distancia está el fuego.
3. Di exactamente qué se le pide.
4. Pide confirmación explícita: "¿Me confirma que lo activan?". No cuelgues sin una respuesta
   clara de sí o no.
5. Si te preguntan algo que no está en este contexto, di la verdad: "No tengo ese dato aquí,
   se lo confirmamos enseguida". NUNCA inventes datos, ni número de heridos, ni causas.
6. Si te piden que se lo manden por escrito, di que se envía también por SMS.
7. Despídete dando el 112 como teléfono de emergencias.

No ordenes una evacuación ni un confinamiento por tu cuenta: solo transmites lo que dice el
guion. Si el guion propone una evacuación, deja claro que la orden corresponde al Director
del Plan y que esto es una propuesta de la sala.
```

Variables que debe extraer el agente al terminar: `contestada` (booleano), `confirmado`
(booleano), `transcripcion` (texto completo), `resumen` (una frase).

**Nodo 3 · Webhook action.** `POST @webhook_url`, cabecera `x-webhook-secret: @secreto`,
cuerpo:

```json
{
  "decisionId": "@decisionId",
  "accionId": "@accionId",
  "ref": "@run_id",
  "ok": true,
  "canal": "voz",
  "contestada": "@contestada",
  "confirmado": "@confirmado",
  "transcripcion": "@transcripcion",
  "detalle": "@resumen"
}
```

> El lector del webhook es tolerante con los nombres (`transcript`/`transcripcion`,
> `answered`/`contestada`, `summary`/`detalle`…), así que si la plataforma nombra los campos
> de otra forma también los reconoce.

### 3.2 `Atalaya · SMS saliente` → `HAPPYROBOT_WORKFLOW_SLUG_SMS`

Mismo Webhook trigger (params `telefono`, `texto`/`mensaje`, `decisionId`, `accionId`,
`municipio`, `incendio`, `webhook_url`, `secreto`, `canal` = `sms`).

**Nodo 2 · SMS.** *To* = `@telefono`, *Body* = `@texto`. El texto ya viene recortado a 300
caracteres desde Atalaya. Número emisor: el americano de **Telephony**.

**Nodo 3 · Webhook action.** Igual que el 3.1 con `"canal": "sms"` y sin `transcripcion`.

### 3.3 `Atalaya · Email saliente` → `HAPPYROBOT_WORKFLOW_SLUG_EMAIL`

Webhook trigger con params `destino`/`email`, `asunto`/`subject`, `texto`/`cuerpo`,
`decisionId`, `accionId`, `incendio`, `webhook_url`, `secreto`, `canal` = `email`.

**Nodo 2 · Email.** *To* = `@destino`, *Subject* = `@asunto`, *Body* = `@texto`
(el parte formal ya viene redactado desde Atalaya: no hay que reescribirlo).

**Nodo 3 · Webhook action.** Igual, con `"canal": "email"`.

### 3.4 `Atalaya · 112 entrante` (Web Call) → `HAPPYROBOT_WEB_CALL_URL`

**Nodo 1 · Trigger: Web Call.** Genera una URL pública de llamada desde el navegador; esa URL
va en `HAPPYROBOT_WEB_CALL_URL` y Atalaya la pone como botón "Llamar al 112 virtual" en
`/publico` y `/parte`. (**Por verificar en la plataforma**: el nombre exacto del nodo y si la
URL admite parámetros de query.)

**Nodo 2 · Inbound Voice Agent**, en español. Prompt:

```
Eres el operador del 112 de incendios forestales de España. Atiendes a una persona que llama
para avisar de un posible incendio. Hablas español de España, con calma. Tu trabajo es sacarle
la información imprescindible en menos de un minuto, sin agobiar y sin interrumpir si está
nerviosa.

Lo primero, siempre: "112, ¿hay alguien en peligro ahora mismo?". Si dice que sí, dile que no
cuelgue, que los medios ya están saliendo, y sigue recogiendo datos.

Recoge, por este orden:
1. DÓNDE: municipio o pueblo más cercano, carretera y punto kilométrico, paraje, ermita,
   urbanización, cortafuegos, cualquier referencia que reconozca alguien de la zona. Insiste
   con amabilidad hasta tener algo localizable.
2. QUÉ VE: humo o llamas; de qué color es el humo; si avanza y hacia dónde; cuánto ocupa
   con sus palabras ("como un campo de fútbol").
3. RIESGO: si hay personas, ganado, coches o viviendas cerca; si hay gente atrapada.
4. SU TELÉFONO, para poder llamarle si hace falta confirmar el sitio.

Antes de despedirte, comprueba si ya conocemos el fuego: llama a la herramienta
"contexto_atalaya" con el lugar que te haya dicho. Si devuelve incendios cercanos, dilo
("sí, ya lo tenemos localizado, hay medios en camino") y dale el consejo que devuelva la
herramienta. Si no devuelve ninguno, dile que es el primer aviso y que se va a comprobar
ahora mismo.

Consejos que puedes dar (nunca te inventes otros): alejarse en dirección contraria al humo,
nunca ladera arriba ni por un barranco; no coger el coche para ir a ver el fuego; si le dicen
que se confine, dentro de casa con puertas y ventanas cerradas.

NUNCA inventes datos, ni causas, ni heridos, ni ordenes una evacuación. No prometas tiempos
de llegada. Termina agradeciendo el aviso.
```

**Nodo 3 · API call (herramienta del agente)** llamada `contexto_atalaya`:
`GET {URL_PÚBLICA}/api/happyrobot/contexto?texto={lugar}` (o `?lat=&lon=` si el agente tiene
coordenadas). Devuelve `{ incendiosCercanos: [{nombre, distanciaKm, estado, consejo}],
consejoGeneral }`. Esta ruta **no** pide el secreto: es solo de lectura y no muta nada.

**Nodo 4 · Webhook action** al colgar: `POST {URL_PÚBLICA}/api/webhooks/happyrobot/llamada`,
cabecera `x-webhook-secret`, cuerpo:

```json
{
  "transcripcion": "@transcript",
  "resumen": "@summary",
  "telefono": "@caller_number",
  "lugar": "@lugar",
  "municipio": "@municipio",
  "lat": "@lat",
  "lon": "@lon",
  "run_id": "@run_id"
}
```

Atalaya entrega ese texto a la centralita (constructor B), que extrae lugar y gravedad,
geocodifica y crea la `Observacion`. El verificador decide si declara un foco.

---

## 4. Variables de entorno

```
HAPPYROBOT_API_BASE=https://platform.eu.happyrobot.ai   # instancia EU (verificado)
HAPPYROBOT_API_KEY=sk_live_…                            # Settings → API keys
HAPPYROBOT_ENVIRONMENT=production                       # debe coincidir con el entorno publicado
HAPPYROBOT_WORKFLOW_SLUG_VOZ=                           # 3.1  ← FALTA
HAPPYROBOT_WORKFLOW_SLUG_SMS=                           # 3.2  ← FALTA
HAPPYROBOT_WORKFLOW_SLUG_EMAIL=                         # 3.3  ← FALTA
HAPPYROBOT_WEB_CALL_URL=                                # 3.4  ← FALTA
HAPPYROBOT_WEBHOOK_SECRET=…                             # ya configurado
PUBLIC_BASE_URL=                                        # o data/url-publica.txt (scripts/tunel.sh)
DESTINO_DEMO=+34…                                       # teléfono que recibe llamadas y SMS  ← FALTA
EMAIL_DEMO=…                                            # correo que recibe los emails        ← FALTA
```

Mientras falten los slugs, la app **funciona igual** y enseña en rojo
`HappyRobot: falta el workflow de voz · Falta HAPPYROBOT_WORKFLOW_SLUG_VOZ`. Las acciones
quedan `fallida` con ese mismo texto en `accion.resultado.resumen`. **Nunca se finge un envío.**

---

## 5. Pruebas

```bash
# 1. ¿Qué workflows hay y cuáles usa Atalaya?
curl -s localhost:3104/api/happyrobot/salud | jq

# 2. Contexto para el agente de voz (lo llama el nodo API call)
curl -s "localhost:3104/api/happyrobot/contexto?lat=40.4&lon=-4.9" | jq

# 3. Simular una llamada ciudadana entrante
curl -s -X POST localhost:3104/api/webhooks/happyrobot/llamada \
  -H "content-type: application/json" -H "x-webhook-secret: $HAPPYROBOT_WEBHOOK_SECRET" \
  -d '{"transcripcion":"Veo una columna de humo en la N-403 km 62, cerca de Navalacruz","telefono":"+34600000000","lugar":"N-403 km 62, Navalacruz, Ávila"}'

# 4. Simular el resultado de una llamada que disparamos nosotros
curl -s -X POST localhost:3104/api/webhooks/happyrobot/resultado \
  -H "content-type: application/json" -H "x-webhook-secret: $HAPPYROBOT_WEBHOOK_SECRET" \
  -d '{"decisionId":"<id>","accionId":"<id>","ref":"run-1","ok":true,"contestada":true,"confirmado":true,"transcripcion":"El ayuntamiento confirma que activa el aviso"}'

# 5. Sin la cabecera del secreto → 401 (comprobación de seguridad)
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3104/api/webhooks/happyrobot/resultado \
  -H "content-type: application/json" -d '{}'
```

---

## 6. Auditoría

Cada acción deja en `accion.resultado`:

```jsonc
{
  "en": "2026-09-19T…",
  "proveedor": "HappyRobot",
  "referencia": "<id del run>",
  "resumen": "Llamada lanzada a +346***00 (run …). → contestada · confirmado",
  "exito": true,
  "datos": {
    "peticion": { /* payload enviado, SIN el secreto del webhook */ },
    "respuesta": "…respuesta cruda de la API, 2 KB máximo…",
    "urlPeticion": "https://platform.eu.happyrobot.ai/api/v2/workflows/…/runs?environment=production",
    "destino": "+346***00",
    "duracionMs": 412,
    "duracionTotalMs": 460,
    "transcripcion": "…", "contestada": true, "confirmado": true,
    "webhook": "…cuerpo crudo del webhook, 2 KB máximo…"
  }
}
```

Nada de eso incluye la clave de API ni el secreto del webhook. El teléfono y el correo van
parcialmente enmascarados.
