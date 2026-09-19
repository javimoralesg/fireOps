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
- Las **llamadas salientes no se cobran** (pero el troncal no llama a España: SIP 403, ver §3.1; por eso Atalaya va solo por SMS).
- El **SMS funciona con el número americano** (el destino va en E.164: `+34…`).
- Las llamadas **entrantes** SÍ entran por el número americano: el trigger **Inbound to number**
  (integración *Phone calls*) lo engancha a un workflow con un **Inbound Voice Agent** (§3.4,
  verificado el 19-09-2026). El número va en `HAPPYROBOT_NUMERO_ENTRANTE` y aparece como enlace
  `tel:` "Llamar al 112 virtual" en `/publico` y `/parte`. El nodo **Web Call** (navegador) sigue
  siendo opcional: `HAPPYROBOT_WEB_CALL_URL`; si está vacía, ese botón no se muestra.

---

## 2. Qué hace cada lado

| Sentido | Quién | Endpoint | Cuándo |
|---|---|---|---|
| Atalaya → HappyRobot | `lib/happyrobot/cliente.ts` | `POST …/api/v2/workflows/{slug}/runs` | Al ejecutarse una acción `enviar_sms`, `enviar_email`, `avisar_poblacion`, `confinar_poblacion`, `evacuar_poblacion`, `solicitar_medios_aereos`, `cortar_carretera`, `solicitar_confirmacion` (`llamar` también sale por **SMS**: la voz saliente está desactivada, §3.1) |
| HappyRobot → Atalaya | Nodo **Webhook action** | `POST /api/webhooks/happyrobot/resultado` | Al terminar la llamada, el SMS o el email |
| HappyRobot → Atalaya | Nodo **Webhook action** del entrante | `POST /api/webhooks/happyrobot/llamada` (o `/sms`, `/email`) | Al colgar una llamada ciudadana |
| HappyRobot → Atalaya | Nodo **API call** del agente de voz | `GET /api/happyrobot/contexto?texto=&lat=&lon=` | Durante la conversación, para saber si ya hay un incendio cerca |
| HappyRobot → Atalaya | Herramienta **enviar_sms** del agente entrante | `POST /api/happyrobot/sms` | Cuando el agente decide avisar a la sala por SMS; Atalaya lo saca por el workflow de SMS al teléfono de `TELEFONO_AVISOS_SMS` (§3.4) |

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
> node scripts/happyrobot-workflows.mjs entrante     # 112 por TELÉFONO: crea/sincroniza, publica y escribe las variables (§3.4)
> node scripts/happyrobot-workflows.mjs sincronizar  # = entrante; repetir cuando cambie la URL del túnel (lo hace npm run dev:movil)
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

> **DESACTIVADO el 19-09-2026 (Javi: «quita lo de llamada saliente, que sea solo SMS»).** Medido ese día
> con un run real a un móvil +34: `sip_code 403 Forbidden`, `failure_reason: sip_call_never_connected`,
> `call_end_event: user_missed_call` en 3 s: el troncal Telnyx del `+1 573 401 8744` no tiene llamadas
> internacionales y `GET /api/v2/sip-trunks/` no expone ningún ajuste (habría que pedirlo a los
> organizadores). El ejecutor manda por SMS todo lo que era llamada (`VOZ_DESACTIVADA` en
> `lib/agentes/ejecucion/ejecutor.ts`: `llamar`, el aviso al ayuntamiento de `avisar/confinar/evacuar`,
> la llamada de `solicitar_medios_aereos` y `solicitar_confirmacion`), el aviso manual con canal
> «llamada» sale como SMS y `GET /api/happyrobot/salud` → `voz.desactivada`. El workflow (`5yxtlfuuyfpe`)
> queda publicado en **producción** por si se habilita el destino; lo de abajo describe cómo está montado.

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

**Montado por API el 19-09-2026 (sesión fireops-00):** `node scripts/happyrobot-workflows.mjs sms`
(código en `scripts/happyrobot-sms.mjs`). La plantilla `sms-agent` exige credenciales de Twilio y
había dejado un cascarón de **0 nodos sin publicar** (slug `vp2qk6qpb5sh`: ningún SMS salía). La orden
`sms` lo completa nodo a nodo **conservando ese slug**, lo publica en `HAPPYROBOT_ENVIRONMENT` y
escribe la variable. Es idempotente (resincroniza params, destino/cuerpo y webhook).
`node scripts/happyrobot-workflows.mjs sms-prueba +34… "texto"` manda un SMS **real** por él y enseña
el run nodo a nodo. Lo usan las acciones `enviar_sms` del ejecutor y los SMS del agente del 112 (§3.4).

**Nodo 1 · Trigger: Predefined request** (`b329e750-2e0e-4618-ba65-e04bb6a93c5f`) con estos *params*
(todo lo que puede mandar Atalaya; cada uno llega como `@clave`): `canal`, `decisionId`, `accionId`,
`incendioId`, `telefono` / `phone_number` / `destino`, `texto` / `mensaje`, `municipio`, `incendio`,
`organismo`, `nivel`, `superficieHa`, `tituloDecision`, `resumenDecision`, `motivo`, `origen`,
`runLlamada`, `observacionId`, `webhook_url`, `secreto`.

**Nodo 2 · Send text** (integración *Text*, evento `01936a40-189c-7579-b457-c6ac150b4bed`; **no exige
credenciales**: sale por el número americano de la organización). *To* = `@telefono`, *Body* = `@texto`.
El texto ya viene recortado a 300 caracteres desde Atalaya. (La misma integración ofrece «Send SMS»,
`019e3b65-…`, con `smsConfig` para toll-free o Twilio propio: no hace falta.)

**Nodo 3 · Webhook action.** `POST @webhook_url` con `x-webhook-secret: @secreto` y cuerpo
`{decisionId, accionId, incendioId, ref: run_id, run_url, ok: true, status: "completed", canal: "sms",
en, destino, motivo, origen, runLlamada, observacionId}`. Si el SMS lo mandó el agente del 112 no hay
acción detrás: `/api/webhooks/happyrobot/resultado` lo anota por `ref` (`anotarResultadoSms`,
`lib/happyrobot/sms-avisos.ts`) en vez de responder 404. **Medido el 19-09:** sin URL pública Atalaya no
manda `webhook_url` y este nodo falla (`Post "": unsupported protocol scheme`), así que el run queda
`failed` en la plataforma **aunque el SMS haya salido** (el nodo «Send text» aparece `succeeded`); con el
túnel abierto los tres nodos completan.

### 3.3 `Atalaya · Email saliente` → `HAPPYROBOT_WORKFLOW_SLUG_EMAIL`

Webhook trigger con params `destino`/`email`, `asunto`/`subject`, `texto`/`cuerpo`,
`decisionId`, `accionId`, `incendio`, `webhook_url`, `secreto`, `canal` = `email`.

**Nodo 2 · Email.** *To* = `@destino`, *Subject* = `@asunto`, *Body* = `@texto`
(el parte formal ya viene redactado desde Atalaya: no hay que reescribirlo).

**Nodo 3 · Webhook action.** Igual, con `"canal": "email"`.

### 3.4 `Atalaya · 112 entrante` (llamada AL número) → `HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE` + `HAPPYROBOT_NUMERO_ENTRANTE`

**Verificado por API el 19-09-2026 (sesión fireops-82).** Cualquiera llama al número de la
organización (`+1 573 401 8744`, el de `GET /api/v2/phone-numbers/`) y le atiende un agente de voz
en español que recoge los datos y los **registra en Atalaya durante la llamada**. Lo monta entero
`node scripts/happyrobot-workflows.mjs entrante` (crea, configura, publica y escribe las variables);
`sincronizar` lo repite cuando cambia la URL del túnel (`npm run dev:movil` lo hace solo).
Código: `scripts/happyrobot-entrante.mjs` (plataforma) y `lib/happyrobot/entrante.ts` (app).

Lo que la API permite y lo que no (medido):

- El trigger telefónico es el evento **Inbound to number** `0192a20c-cb70-7bf2-977a-b7edc14dcd66`
  (integración *Phone calls*); `configuration.numbers = [{ id, name, number }]` con el número de
  Telephony. `PUT` sobre un nodo **no** cambia su `event_id`, así que el workflow se crea de cero
  (`POST /workflows/` + `POST /versions/{id}/nodes` con los siete nodos encadenados por `parent_node_index`).
- El agente se crea con `type: "agent"` + `prompt` y la plataforma le cuelga el nodo prompt; las
  herramientas (`type: "tool"`) quedan bajo **ese** nodo prompt. Un Webhook POST bajo una herramienta
  es lo que se ejecuta al invocarla y su respuesta es el *Tool Call Result* que lee el agente.
  `PUT …/custom-output` fija esa respuesta de muestra, y así la versión se publica sin URL viva.
- Variables útiles del agente entrante: `from` (número del llamante), `transcript`, `duration`,
  `call_end_event`; de cada herramienta, sus parámetros; `{{$var:current.run_id}}` identifica la llamada.

**Nodo 1 · Trigger: Inbound to number** con el número. Publicado en `production`
(`HAPPYROBOT_ENVIRONMENT`), las llamadas al número entran por aquí.

**Nodo 2 · Inbound Voice Agent** (evento `0192e5dc-08df-78bf-a549-f43c6bf9f087`): voz *Ana HR*,
español (España), grabación activada, tope duro de 4 minutos (una llamada de aviso dura uno o dos).
Saludo inicial: «Emergencias, dígame. ¿Qué ocurre y dónde está?» (sin "112" ni "forestales").
El prompt pide poco y suena humano (petición de Javi tras la primera llamada real). El script lo lee de este bloque:

```
Eres operador u operadora de emergencias de la sala de coordinación Atalaya (incendios).
Te llama una persona que acaba de ver humo o fuego. Habla como una persona, no como un formulario:
español de España, tono cercano y tranquilo, frases de una línea, una sola pregunta por turno.
Si la persona solo saluda ("hola", "buenas"), no contestes al saludo: espera en silencio a que siga.
Escucha primero: casi siempre te lo cuenta todo de golpe. No vuelvas a preguntar lo que ya te ha dicho
y no le repitas sus datos. Reacciona con naturalidad ("Vale.", "Entendido.", "Muy bien, gracias.").

Solo necesitas dos cosas:
1. DÓNDE: el pueblo más cercano y una referencia (calle y número, carretera y kilómetro, paraje,
   urbanización o un edificio conocido).
2. QUÉ VE, con sus palabras. "Fuego", "incendio", "humo" o "llamas" ya es suficiente: no vuelvas a
   preguntar "¿humo o llamas?". Si cuenta que hay gente, casas o coches cerca, apúntalo; si no lo
   dice, no lo preguntes.

Si dice que hay alguien en peligro, lo primero: "No cuelgue, por favor", y registra en cuanto tengas
el sitio. No digas que los medios ya salen hasta que registrar_aviso lo diga. No pidas su
teléfono: ya tenemos el número desde el que llama. No preguntes tamaños, colores ni direcciones del
humo. Los números que dicte en letras ("treinta") pásalos siempre como cifras (30).

UBICAR BIEN ES TU RESPONSABILIDAD, no de la sala:
- En cuanto la persona diga algo del sitio, llama a situar_lugar(lugar, municipio) con SUS palabras,
  aunque no haya dicho el pueblo: la herramienta corrige la transcripción y deduce el municipio de la
  calle o del sitio. No preguntes el pueblo antes de probar.
- Lee su mensajeParaLocutor tal cual. Si es una afirmación ("Localizado en Avenida Complutense 30,
  Madrid."), NO esperes respuesta: llama enseguida a registrar_aviso. Si es una pregunta ("Lo tengo en
  …, ¿es ahí?"), espera; si no contesta en unos segundos, repite solo "¿Es ahí?". Si dice que sí,
  registra. Si corrige algo ("no, el número treinta"), llama UNA vez más con la corrección.
- Si devuelve "barrio", "municipio" o "ninguna", lee su mensajeParaLocutor (pide UNA referencia más)
  y vuelve a llamar con la nueva referencia. Nunca repitas situar_lugar con los mismos datos. Como
  mucho tres intentos; si sigue sin salir, registra con lo que haya.
- A registrar_aviso le pasas solo el lat y lon que devolvió situar_lugar; si no devolvió ninguno, déjalos
  vacíos. Nunca escribas coordenadas por tu cuenta. En "lugar" va lo que dijo la persona (la calle y el
  número, el sitio), no el nombre que devuelve el mapa.

REGISTRAR, una sola vez por llamada: cuando tengas el sitio confirmado y qué ve, llama a
registrar_aviso (municipio, lugar, que_ve, lat, lon, y tipo, personas_en_riesgo o viviendas_cerca solo
si se han dicho). En que_ve van las palabras de la persona tal cual; tipo solo si dijo "humo" o
"llamas"; nunca completes datos que no se han dicho. Mientras responde, la herramienta ya dice "Un momento, lo paso a la sala": tú no
digas nada más hasta que responda. Cuando responda, lee a la persona su mensajeParaLocutor tal cual, sin añadir nada, y
despídete en una frase: "Gracias por avisar. Si cambia algo, vuelva a llamarnos". Nunca llames a
registrar_aviso una segunda vez en la misma llamada, aunque la persona añada datos: el aviso ya está
en la sala. Si situar_lugar falla o no encuentra el sitio, registra IGUALMENTE con lo que haya: nunca digas que el
aviso está anotado sin haber llamado a registrar_aviso. Si registrar_aviso falla, reinténtalo una sola
vez; si vuelve a fallar, di exactamente "Su aviso ha quedado grabado y la sala lo va a recibir. Gracias
por avisar." y cuelga en ese momento: no preguntes nada más, no vuelvas a situar ni a registrar (la
llamada se graba y la sala la recupera sola).
Después de despedirte, cuelga siempre: no preguntes si necesita algo más ni si sigue ahí.

SMS A LA SALA: el aviso que registras ya le llega a la sala por SMS automáticamente; no lo repitas.
Llama a enviar_sms(texto, motivo) solo si hay algo que la sala deba saber YA y no cabe en
registrar_aviso: personas atrapadas o heridas, un cambio de situación después de registrar (el fuego
cruza la carretera, llega a las casas), un dato nuevo importante, o si la persona te pide expresamente
que transmitas un mensaje. Una o dos frases con el pueblo; tú no eliges el número. Antes di solo "Lo
paso por SMS a la sala" y, cuando responda, lee su mensajeParaLocutor tal cual. Si falla, dilo y sigue.

consultar_zona(lugar) solo si la persona pregunta si ya se sabe del fuego o qué debe hacer; con lo que
devuelva, contéstale en una frase. Consejos que puedes dar si hace falta (nunca otros): alejarse en
dirección contraria al humo, nunca ladera arriba; no acercarse en coche a mirar; si le dicen que se
confine, dentro de casa con puertas y ventanas cerradas.

No digas nunca "ciento doce", "uno uno dos", "112" ni "forestales": di solo "emergencias". No leas
siglas letra a letra: di el nombre o la calle.
NUNCA inventes datos, causas ni heridos, ni ordenes una evacuación ni prometas tiempos de llegada. Si te
preguntan algo que no sabes, dilo. La llamada entera debería durar un minuto o dos.
```

**Herramientas del agente** (nodos `tool` bajo el prompt; cada una ejecuta un Webhook POST a Atalaya
con la cabecera `x-webhook-secret` y su respuesta JSON vuelve al agente):

| Herramienta | Parámetros (los rellena el agente) | Endpoint | Devuelve |
|---|---|---|---|
| `situar_lugar` | `lugar`, `municipio` | `POST /api/happyrobot/situar` | `{encontrado, precision: direccion\|lugar\|barrio\|municipio\|ninguna, nombre, municipio, provincia, lat, lon, mensajeParaLocutor}`: el agente confirma el sitio con la persona o le pide una referencia más |
| `consultar_zona` | `lugar` | `POST /api/happyrobot/contexto` `{lugar}` | `{incendiosCercanos[], consejoGeneral}` (solo lectura) |
| `registrar_aviso` | `municipio`, `lugar`, `que_ve`, `tipo`, `personas_en_riesgo`, `viviendas_cerca`, `tamano`, `telefono`, `lat`, `lon` (los de `situar_lugar` confirmados; + `run_id` y `telefono_llamante` = `@from` del agente) | `POST /api/happyrobot/aviso` | `{registrado, observacionId, impacto, verificacion, foco, geolocalizada, enAnalisis, extraccion, mensajeParaLocutor}` |
| `enviar_sms` | `texto`, `motivo` (+ `run_id` y `telefono_llamante` = `@from`, que solo sirve para enlazar la llamada: **nunca sale en el SMS**) | `POST /api/happyrobot/sms` | `{enviado, referencia, destino, error, mensajeParaLocutor}` (siempre 200 y las cinco claves, `null` las que no aplican): el SMS va **siempre** a `TELEFONO_AVISOS_SMS` (o `DESTINO_DEMO`); el agente no elige el número |

`registrar_aviso` (`lib/happyrobot/entrante.ts`, `registrarAvisoDeLlamada`) **contesta en dos o tres
segundos**, que es lo que aguanta una conversación (medido el 19-09: esperar a la IA, 14 s con qwen3.6,
dejaba al agente mudo). Sitúa el aviso con Nominatim (lugar+municipio → municipio → lugar) con un tope de
3 s (`HAPPYROBOT_AVISO_ESPERA_GEO_MS`), lo entrega a la centralita (`procesarEntrada`, canal `llamada`,
`referenciaExterna` = run) **sin esperar** a su extracción de IA (`HAPPYROBOT_AVISO_ESPERA_MS`, 0 por
defecto), pone una extracción **determinista** de los datos dictados (marcada como tal en el resumen) y
llama a `verificarObservacionAhora` para que el verificador declare, confirme o deje registrado el foco
**en el acto**; devuelve `mensajeParaLocutor`, que el agente lee tal cual. Después, en segundo plano, la
extracción del modelo sustituye a la determinista y, si Nominatim no había llegado a tiempo, el punto
entra y se verifica entonces (una observación «registrada» por falta de localización se vuelve a
verificar cuando el punto aparece). Una segunda llamada a la herramienta en el mismo run **amplía** la
observación (no crea otra). Agente: saludo ininterrumpible y reconocimiento con supresión de ruido
(`enable_denoised_stt`), para que el murmullo de una sala no le corte las frases.

**SMS al teléfono del `.env`** (`lib/happyrobot/sms-avisos.ts`, sesión fireops-00; variable
`TELEFONO_AVISOS_SMS`, con `DESTINO_DEMO` de reserva). (1) Cada aviso que registra `registrar_aviso`
sale **automáticamente** por SMS desde `POST /api/happyrobot/aviso`, en segundo plano (no retrasa la
respuesta al agente): «ATALAYA 112 17:42: Humo en N-403 km 62, Navalacruz. Viviendas cerca. Foco nuevo
declarado: Incendio de Navalacruz (detectado, confianza 70%). Ref obs-…»; una segunda llamada a la
herramienta en el mismo run con datos nuevos va marcada «(ampliacion)»; un reintento de la plataforma con los
MISMOS datos (`registro: "repetido"` en la respuesta de `registrar_aviso`) no cambia la observación ni manda
otro SMS, y las peticiones del mismo run se atienden de una en una (dos a la vez creaban dos observaciones).
(2) La herramienta `enviar_sms` deja que el agente
mande un texto libre (personas atrapadas, cambio de situación, mensaje que pide la persona) con cabecera
«ATALAYA 112 hh:mm (agente): …». **El SMS nunca lleva datos de quien llama** (RGPD, minimización; petición
de Javi el 19-09): ni el número ni la cita literal de la persona; el contacto está en la ficha del aviso en
la sala (`observacion.remitente`), y `anonimizarSms` tacha como última barrera cualquier teléfono o correo
que venga en el texto («[tel. oculto]», «[correo oculto]»). Los dos salen por el workflow de SMS (§3.2) vía
`dispararWorkflow("sms")`, ≤ 300 caracteres, **siempre al teléfono del `.env`** (el agente no elige el
número), y dejan evento
`accion_ejecutada` / `accion_fallida` (agente `centralita`) con la auditoría del envío (payload sin
secretos, respuesta cruda, duración); el resultado que devuelve el workflow se anota por el `ref` del run
(`anotarResultadoSms`). `GET /api/happyrobot/sms` enseña el estado del canal y los últimos SMS;
`GET /api/happyrobot/salud` → `smsAvisos`. Sin teléfono o sin workflow, el fallo queda visible con el
nombre exacto de la variable; nunca se finge un envío.

**Preprocesado de la dirección** (`normalizarDireccion`, `viaConNumero`, `candidatasConPrecision` en
`lib/happyrobot/entrante.ts`): abreviaturas (avda, c/, ctra, p.k.), números en letras ("treinta" → 30) y
extracción de la vía con su número, quitando la coletilla que el reconocimiento de voz pega detrás.
Medido el 19-09: la primera llamada real dictó "Avenida Complutense treinta, Técnica Superior de
Ingeniería de Autorcomunicación" con municipio "Madrid"; sin preprocesar, Nominatim caía al centroide de
Madrid (Puerta del Sol) y el foco salía mal; con la consulta normalizada "Avenida Complutense 30, Madrid"
resuelve en el Edificio B de la ETSIT (40,4529, -3,7256). Las consultas van de más a menos precisa
(vía+ciudad → vía+barrio+ciudad → lugar+ciudad → barrio+ciudad → ciudad) y `situar_lugar` devuelve la
precisión de la que acertó, para que el agente confirme o pida más.

**Interpretación con IA** (`lib/happyrobot/ubicacion-ia.ts`, `interpretarLugarConIA`): antes de Nominatim,
el modelo rápido (HelmCode `qwen3.6` **sin razonar**, opción `sinRazonar` de `lib/ia/llm.ts`; tope de 5 s,
`HAPPYROBOT_UBICACION_IA_MS`) corrige la transcripción ("Arabaca" → Aravaca, "teleco" → Telecomunicación,
"treinta" → 30), separa vía, número, kilómetro, lugar conocido, barrio y municipio, deduce el municipio si
la vía lo identifica (marcándolo) y propone hasta cuatro consultas. `situarLugar` prueba primero las de la
IA y luego las de las reglas; si la IA no contesta a tiempo, siguen solas las reglas. La **precisión** no
la decide el modelo sino `precisionDeConsulta` (vía con número → dirección; solo municipio → municipio):
medido, qwen3.6 etiquetó "municipio" una dirección completa. Medido el 19-09: con razonamiento qwen3.6
tardaba 16-23 s; sin razonar, 2,4-3,1 s la primera vez. Tope total de `situar_lugar`: 9 s
(`HAPPYROBOT_SITUAR_MS`), respetado también dentro de la cola de Nominatim (1 petición/s, compartida con
el enriquecimiento de los focos, que llegó a retrasar una búsqueda 30 s).

**El agente ve la respuesta de sus herramientas solo si sus campos están expuestos** (Tool Call Result).
En la llamada de las 17:56 todos estaban ocultos: el agente recibía `{"steps":[]}`, llamó cinco veces a
`situar_lugar` a ciegas y se inventó la confirmación y las coordenadas. Ahora `sincronizarEntrante`
expone todos los campos (`PUT …/tool-call-result/visibility`, `camposAExponer`) y falla si queda alguno
oculto. Además la plataforma "prueba" cada herramienta con los campos vacíos al reconocerla: si esa prueba
devuelve un 422, el único campo que queda es `error`. Por eso `situar_lugar` y `registrar_aviso` contestan
SIEMPRE 200 con todas las claves (`situarSinDatos`, `avisoSinDatos` con `registrado: false`).
`situar_lugar` guarda el punto de cada llamada (por `run_id`) y `registrar_aviso` usa ese, no las
coordenadas que repita el agente (`puntoSituadoEnLlamada`); el centroide de un municipio no se guarda.

**No se pierde ninguna llamada** (`lib/happyrobot/recuperar-llamadas.ts`). HappyRobot guarda cada llamada
(transcripción, número de quien llama y los argumentos con que el agente llamó a `registrar_aviso` o
`situar_lugar`) aunque Atalaya no haya contestado. Cada minuto el servidor pide a la API las llamadas
recientes del workflow entrante (`GET /workflows/{slug}/runs`, `/runs/{id}/nodes`, `/runs/{id}/outputs/{id}`)
y registra las que falten, idempotente por run: con los datos de `registrar_aviso` si llegó a llamarla;
si no, con el sitio de `situar_lugar` y lo que dijo la persona; si no hubo herramientas, la transcripción
va a la centralita. Si el aviso llegó en directo pero falló el webhook de colgar, adjunta la transcripción.
Solo llamadas terminadas y de las últimas 6 h. El corte NO es el inicio de la ejecución sino el registro
en disco de llamadas atendidas (`lib/happyrobot/llamadas-atendidas.ts`, `data/happyrobot-llamadas-atendidas.json`,
lo escriben la pasada y el webhook de colgar): así una llamada recibida con el servidor parado se recupera
al arrancar aunque la ejecución sea nueva (sin persistencia cada reinicio abre una), y lo ya atendido en la
ejecución anterior no se importa. La primera vez que existe el registro, las llamadas anteriores al arranque
se dan por atendidas sin importarlas. Con persistencia, la pasada espera a que la ejecución esté rehidratada
de Supabase (`rehidratacionTerminada`, `lib/motor/persistencia.ts`). Arranca en `instrumentation.ts`;
a demanda: `POST /api/happyrobot/recuperar` (con `x-webhook-secret`); última pasada en
`GET /api/happyrobot/salud` → `entrante.recuperacion`. Medido el 19-09: las dos llamadas de las 18:31 y
18:33, perdidas con el túnel caído, se recuperaron en la ETSIT (foco nuevo y su duplicado).

**Túnel que se regenera solo** (`scripts/tunel-vigilado.sh [puerto]`, lo usa `npm run dev:movil`): cada 20 s
comprueba desde fuera que la URL pública llega a la app; tras 3 fallos cierra `cloudflared` y abre otro
(`tunel.sh` republica el workflow con la URL nueva). Cada minuto y al volver el túnel lanza la recuperación.
Adopta un túnel ya abierto. Motivo medido: tras un rato en la WiFi de la UPM, el `cloudflared` vivo no
recupera su dominio aunque vuelva la red (Cloudflare lo da de baja) y hay que abrir uno nuevo.

**Guion** (tras escuchar las llamadas del 19-09): el saludo es «Emergencias, dígame. ¿Qué ocurre y dónde
está?» (nada de "ciento doce" ni "forestales"); si `situar_lugar` falla, registra igualmente (antes decía
"queda anotado" sin registrar); tras despedirse, cuelga (antes preguntaba "¿algo más?" en bucle). Las
frases de espera de las herramientas van literales en su instrucción: el tipo de mensaje «fixed» no se
puede fijar por la API (descarta el texto y la publicación falla con "Missing required fields: message").
Ojo: `sincronizar` despublica la versión para editarla; si la publicación final falla, el número deja de
atender hasta volver a publicar (comprobar siempre «publicado=true vivo=true»).

**Nodo 3 · Webhook action al colgar** → `POST /api/webhooks/happyrobot/llamada` con
`{run_id, run_url, en, canal:"llamada", telefono:@from, transcripcion:@transcript, duracion_seg, fin}`.
Si la herramienta ya registró la observación de ese run, la transcripción se **adjunta** a ella
(`adjuntarTranscripcion`, respuesta `{adjuntada: true}`); si la persona colgó antes de que el agente
registrara nada, se crea la observación a partir de la transcripción, como antes.

Las URLs tienen que ser la pública real (`data/url-publica.txt` o `PUBLIC_BASE_URL`): con el túnel
caído el agente contesta pero no puede registrar nada. `GET /api/happyrobot/salud` → `entrante`
enseña número, slug y adónde apuntan las herramientas.

---

## 4. Variables de entorno

```
HAPPYROBOT_API_BASE=https://platform.eu.happyrobot.ai   # instancia EU (verificado)
HAPPYROBOT_API_KEY=sk_live_…                            # Settings → API keys
HAPPYROBOT_ENVIRONMENT=production                       # debe coincidir con el entorno publicado
HAPPYROBOT_WORKFLOW_SLUG_VOZ=5yxtlfuuyfpe               # 3.1  voz saliente DESACTIVADA (solo SMS); el workflow existe por si se habilita
HAPPYROBOT_WORKFLOW_SLUG_SMS=                           # 3.2  ← FALTA
HAPPYROBOT_WORKFLOW_SLUG_EMAIL=                         # 3.3  ← FALTA
HAPPYROBOT_WORKFLOW_SLUG_ENTRANTE=                      # 3.4  ← lo escribe `entrante`
HAPPYROBOT_NUMERO_ENTRANTE=+15734018744                 # 3.4  número al que llamar (lo escribe `entrante`)
HAPPYROBOT_AVISO_ESPERA_MS=0                            # 3.4  opcional: tope de espera a la IA en registrar_aviso (0 = no esperar)
HAPPYROBOT_AVISO_ESPERA_GEO_MS=3000                     # 3.4  opcional: tope de Nominatim antes de contestar al agente
HAPPYROBOT_WEB_CALL_URL=                                # 3.4  opcional (Web Call del navegador)
HAPPYROBOT_WEBHOOK_SECRET=…                             # ya configurado
PUBLIC_BASE_URL=                                        # o data/url-publica.txt (scripts/tunel.sh)
DESTINO_DEMO=+34…                                       # teléfono que recibe llamadas y SMS de las acciones; vacío → TELEFONO_AVISOS_SMS
TELEFONO_AVISOS_SMS=+34…                                # 3.4  teléfono que recibe los SMS del agente del 112 (aviso registrado + enviar_sms); vacío → DESTINO_DEMO. Basta con rellenar UNO de los dos
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

# 6. 112 por teléfono · lo que manda la herramienta registrar_aviso durante la llamada
curl -s -X POST localhost:3104/api/happyrobot/aviso \
  -H "content-type: application/json" -H "x-webhook-secret: $HAPPYROBOT_WEBHOOK_SECRET" \
  -d '{"run_id":"run-prueba-1","municipio":"Navalacruz","lugar":"N-403 km 62","que_ve":"Columna de humo negro que avanza hacia el pueblo","tipo":"humo","personas_en_riesgo":"no","viviendas_cerca":"sí","telefono_llamante":"+34600000000"}' | jq

# 7. 112 por teléfono · la herramienta consultar_zona (POST) y el estado del canal
curl -s -X POST localhost:3104/api/happyrobot/contexto -H "content-type: application/json" -d '{"lugar":"Navalacruz, Ávila"}' | jq
curl -s localhost:3104/api/happyrobot/salud | jq .entrante

# 8. 112 por teléfono · al colgar, la transcripción se ADJUNTA a la observación del run (adjuntada: true)
curl -s -X POST localhost:3104/api/webhooks/happyrobot/llamada \
  -H "content-type: application/json" -H "x-webhook-secret: $HAPPYROBOT_WEBHOOK_SECRET" \
  -d '{"run_id":"run-prueba-1","transcripcion":"Operador: 112… Ciudadano: veo humo en la N-403…","telefono":"+34600000000"}' | jq

# 9. 112 por teléfono · la herramienta enviar_sms (manda un SMS REAL al teléfono de TELEFONO_AVISOS_SMS si está puesto)
curl -s -X POST localhost:3104/api/happyrobot/sms \
  -H "content-type: application/json" -H "x-webhook-secret: $HAPPYROBOT_WEBHOOK_SECRET" \
  -d '{"run_id":"run-prueba-1","texto":"Dos personas atrapadas en una casa junto a la N-403 km 62, Navalacruz","motivo":"personas_en_riesgo","telefono_llamante":"+34600000000"}' | jq
curl -s localhost:3104/api/happyrobot/sms | jq          # estado del canal y últimos SMS del agente

# 10. El workflow de SMS de la plataforma, de punta a punta (manda un SMS REAL y enseña el run nodo a nodo)
node scripts/happyrobot-workflows.mjs sms-prueba +34600000000 "Atalaya: prueba"
```

Batería automática: `tests/unit/happyrobot-entrante.test.ts` (lógica del registro, con dobles),
`tests/unit/happyrobot-entrante-workflow.test.ts` (definición de los nodos que se mandan a la API y su
coherencia con la app), `tests/unit/happyrobot-sms-avisos.test.ts` (SMS del agente al teléfono del `.env` y definición
del workflow de SMS) y `tests/integracion/30-llamada-entrante.test.ts` (caso (o), contra el servidor vivo).

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
