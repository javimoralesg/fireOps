# Telegram en Atalaya (canal ciudadano bidireccional)

DUEÑO: constructor D. API: [Telegram Bot API](https://core.telegram.org/bots/api).
Se eligió Telegram porque el jurado lo valora igual que WhatsApp y **no exige Meta Business**:
un bot se crea en dos minutos, es gratis y funciona en móvil y escritorio.

Qué permite:

- El vecino escribe al bot, **comparte su ubicación** o manda una **foto**: entra como
  `Observacion` por la centralita (constructor B), igual que una llamada al 112.
- El bot le contesta al momento con acuse y **consejo real** (qué incendios hay cerca de donde
  está y qué debe hacer), calculado con el estado vivo, no con una plantilla.
- Los agentes mandan avisos a los pueblos (`enviar_telegram`, autónoma, riesgo 15) y difunden
  los comunicados oficiales por el mismo canal.

---

## 1. Crear el bot (5 minutos)

1. En Telegram, habla con **[@BotFather](https://t.me/BotFather)**.
2. `/newbot` → nombre visible (p. ej. `Atalaya Incendios`) → usuario, que debe acabar en `bot`
   (p. ej. `atalaya_incendios_bot`).
3. BotFather devuelve el **token**: `123456789:AAH…`. Va en `TELEGRAM_BOT_TOKEN`.
4. Opcional pero recomendable, con BotFather:
   - `/setdescription` → "Avisa de incendios forestales y recibe información oficial."
   - `/setcommands` → `start - Cómo dar un aviso`
   - `/setprivacy` → **Disable** solo si vas a usarlo en grupos y quieres que lea todo.

## 2. Obtener el chat id de la demo

`TELEGRAM_CHAT_ID_DEMO` es el chat que recibe los avisos y comunicados durante la demostración
(tu chat personal con el bot, o un grupo/canal donde esté el bot como administrador).

```bash
# 1. Escríbele algo al bot desde Telegram (por ejemplo, /start).
# 2. Lee los updates pendientes:
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates" | jq '.result[].message.chat'
# → { "id": 123456789, "first_name": "Javi", "type": "private" }
```

Ese `id` (con el signo menos delante si es un grupo: `-100…`) es `TELEGRAM_CHAT_ID_DEMO`.

> `getUpdates` y el webhook son **excluyentes**: si ya has registrado el webhook, `getUpdates`
> devuelve un error. Haz este paso antes del siguiente, o borra el webhook temporalmente con
> `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"`.

## 3. Registrar el webhook

Telegram **exige HTTPS**, así que en local hace falta el túnel
(`scripts/tunel.sh`, que deja la URL pública en `data/url-publica.txt`).

```bash
# Desde la propia app (usa urlPublica() del núcleo):
curl -s -X POST localhost:3104/api/telegram/configurar | jq

# O a mano:
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  -d "{\"url\":\"$PUBLIC_BASE_URL/api/webhooks/telegram\",\"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET\",\"allowed_updates\":[\"message\",\"edited_message\"]}"

# Comprobar cómo ha quedado:
curl -s localhost:3104/api/telegram/configurar | jq
```

`secret_token` hace que Telegram mande la cabecera `X-Telegram-Bot-Api-Secret-Token` en cada
update; `POST /api/webhooks/telegram` la verifica y devuelve `401` si no cuadra.

## 4. Variables de entorno

```
TELEGRAM_BOT_TOKEN=          # de @BotFather                        ← FALTA
TELEGRAM_CHAT_ID_DEMO=       # chat que recibe avisos y comunicados ← FALTA
TELEGRAM_WEBHOOK_SECRET=     # cadena larga a tu gusto              ← FALTA
PUBLIC_BASE_URL=             # o data/url-publica.txt (túnel)
```

Sin `TELEGRAM_BOT_TOKEN`, la acción `enviar_telegram` queda **fallida** con el texto
`Falta TELEGRAM_BOT_TOKEN` y la barra de servicios lo enseña en rojo. Nunca se finge un envío.

## 5. Qué hace el bot con cada mensaje

| Lo que manda el ciudadano | Qué hace Atalaya |
|---|---|
| `/start`, `/ayuda` | Explica qué mandar y recuerda el 112 |
| Texto | `procesarEntrada({canal:"telegram", texto, remitente: chat.id, referenciaExterna: message_id})` |
| Ubicación (clip 📎 → Ubicación) | Lo mismo, con `punto: {lat, lon}`: el foco queda situado al metro |
| Foto (con o sin pie) | Se descarga con `getFile` y se anota el tamaño en el texto de la observación; el análisis de imagen lo hace el vigía (constructor B) |
| Cualquier otra cosa | Se reconoce el update (200) para que Telegram no reintente en bucle |

Siempre se responde con acuse + `contextoParaVoz(punto ?? texto)`: los incendios activos a
menos de 50 km y el consejo que toca. Si no compartió ubicación, se le pide.

## 6. Pruebas

```bash
# Simular un update (hace falta el secreto):
curl -s -X POST localhost:3104/api/webhooks/telegram \
  -H "content-type: application/json" \
  -H "x-telegram-bot-api-secret-token: $TELEGRAM_WEBHOOK_SECRET" \
  -d '{"message":{"message_id":1,"chat":{"id":123456789},"text":"Hay humo en la N-403 km 62, cerca de Navalacruz","location":null}}'

# Sin la cabecera → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3104/api/webhooks/telegram \
  -H "content-type: application/json" -d '{}'
```

## 7. Límites de la Bot API que conviene saber

- 30 mensajes por segundo en total; 20 por minuto al mismo grupo.
- Los mensajes de texto se cortan a 4096 caracteres (el cliente los recorta a 4000).
- `getFile` solo sirve para archivos de hasta 20 MB.
- Un bot **no puede escribir el primero** a alguien que no le haya hablado antes: para la demo,
  escribe tú al bot desde el chat que uses como `TELEGRAM_CHAT_ID_DEMO`.
