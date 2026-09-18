# Integración con HappyRobot (sesión poc-b5)

Cómo se conecta Atalaya con la plataforma HappyRobot del reto. Estado: **en montaje** (faltan API key, número y túnel). Túnel: `scripts/tunel.sh` (uno solo para toda la demo; deja la URL en `data/url-publica.txt`, que el conector lee antes que `PUBLIC_BASE_URL`). Lo que aquí se describe de la plataforma sale del tutorial público de HappyRobot; el detalle exacto de payloads se ajustará al ver la documentación con código de acceso.

## Qué hace nuestro lado

| Sentido | Quién llama | Endpoint | Cuándo |
|---|---|---|---|
| Atalaya → HappyRobot | `lib/server/conectores/happyrobot.ts` | POST a la URL del **Webhook trigger** del workflow (`HAPPYROBOT_TRIGGER_URL` o una por canal `_VOZ/_SMS/_EMAIL/_TICKET`) | Al aprobar una decisión (máx. 2 acciones externas) y al escalar por voz a un cargo |
| HappyRobot → Atalaya | Nodo **Webhook action** del workflow | `POST {PUBLIC_BASE_URL}/api/webhooks/happyrobot/resultado` | Al terminar la llamada/SMS lanzado |
| HappyRobot → Atalaya | Nodo **Webhook action** del workflow entrante | `POST {PUBLIC_BASE_URL}/api/webhooks/happyrobot/ingesta` | Al terminar una llamada ciudadana entrante |

Ambos webhooks exigen la cabecera `x-webhook-secret` con el valor de `HAPPYROBOT_WEBHOOK_SECRET` de `.env.local`.

### Payload que enviamos al trigger

```json
{
  "canal": "voz | sms | email | ticket",
  "destino": "+34…",                 // DESTINO_DEMO
  "decisionId": "dec-…",
  "accionId": "acc-…",
  "recurso": "Hospital Gregorio Marañón",
  "instruccion": "Confirmar cierre de urgencias…",
  "mensaje": "Texto de la alerta para leer/enviar",
  "resumenIncidente": "…",
  "callbackUrl": "https://…/api/webhooks/happyrobot/resultado",
  "secreto": "<HAPPYROBOT_WEBHOOK_SECRET>"
}
```

Cabeceras: `x-api-key: <HAPPYROBOT_API_KEY>` (solo necesaria si el trigger tiene *Enhanced Security*).

### Payload que esperamos de vuelta en `/resultado`

```json
{ "decisionId": "@decisionId", "accionId": "@accionId", "ref": "@call_id", "ok": true, "detalle": "@summary", "canal": "voz" }
```

Para el escalado por voz (`accionId` que empieza por `escalado-`) añadir `"veredicto": "aprobar" | "denegar"` y `"motivo": "…"`; el webhook llamará a `aprobar()`/`denegar()` del motor.

### Payload que esperamos en `/ingesta`

```json
{ "titulo": "@resumen", "detalle": "@transcript", "ubicacion": "@ubicacion", "confianza": 0.85, "pedirDecision": true, "foco": "evacuacion" }
```

## Workflows a crear en la plataforma (sidebar → Workflows → Create workflow, versión 3, From Scratch)

### 1. `Atalaya · Acción saliente (voz)`
1. **Trigger: Webhook.** En *Event Setup* añadir los *Params* del payload de arriba (`destino`, `decisionId`, `accionId`, `recurso`, `instruccion`, `mensaje`, `resumenIncidente`, `callbackUrl`, `secreto`). Copiar la URL de la pestaña del entorno que uses (Development/Staging) → `HAPPYROBOT_TRIGGER_URL_VOZ`. Si activas *Enhanced Security*, la API key va en `HAPPYROBOT_API_KEY`.
2. **AI Agent → Outbound Voice Agent.** *To number* = `@destino`. Número saliente asignado en **Telephony**. Voz en español. Prompt: "Eres el centro de mando de emergencias del Ayuntamiento de Madrid. Llamas a @recurso. Lee: @mensaje. Instrucción: @instruccion. Pide confirmación explícita y resume el resultado."
3. **Webhook action.** POST a `@callbackUrl`, cabecera `x-webhook-secret: @secreto`, cuerpo con el payload de `/resultado` (ref = id de la llamada, ok = true si contestaron, detalle = resumen del agente).

### 2. `Atalaya · Acción saliente (SMS)`
Igual que el 1 con un nodo SMS (requiere Twilio conectado en la plataforma). Su URL → `HAPPYROBOT_TRIGGER_URL_SMS`. Si no hay SMS disponible, deja `HAPPYROBOT_TRIGGER_URL` apuntando al de voz y todo sale por llamada.

### 3. `Atalaya · Escalado por voz al cargo`
Copia del 1; el agente lee `@resumenIncidente` y `@mensaje`, pregunta "¿Aprueba o deniega?" y el motivo, y el Webhook action envía además `veredicto` y `motivo`. Puede compartir trigger con el 1 y bifurcar según `@accionId` empiece por `escalado-`.

### 4. `Atalaya · Línea ciudadana`
1. **Trigger: Inbound call** sobre el número de **Telephony**.
2. **Inbound Voice Agent** que recoge: qué ocurre, dónde, y si hay personas en peligro. Extrae `resumen`, `transcript`, `ubicacion`.
3. **Webhook action** POST a `{PUBLIC_BASE_URL}/api/webhooks/happyrobot/ingesta` con cabecera `x-webhook-secret` y el payload de `/ingesta`.

## Variables en `.env.local`

```
HAPPYROBOT_TRIGGER_URL=            # o _VOZ/_SMS/_EMAIL/_TICKET
HAPPYROBOT_API_KEY=                # Settings > Profile > Generate API Key (solo con Enhanced Security)
HAPPYROBOT_WEBHOOK_SECRET=7a3243a265b7d71db41c51fe346e8d7e7861824ad99b945c
PUBLIC_BASE_URL=                   # Opcional: si hay túnel, se lee data/url-publica.txt (lo escribe scripts/tunel.sh, túnel único compartido con poc-07)
DESTINO_DEMO=                      # +34…
```

## Pruebas rápidas

```bash
# Simular el resultado de HappyRobot contra el backend local
curl -s -X POST http://localhost:3456/api/webhooks/happyrobot/resultado \
  -H "content-type: application/json" -H "x-webhook-secret: 7a3243a265b7d71db41c51fe346e8d7e7861824ad99b945c" \
  -d '{"decisionId":"<id>","accionId":"<id>","ref":"call-1","ok":true,"detalle":"Hospital confirma","canal":"voz"}'
```
