#!/usr/bin/env bash
# Túnel HTTPS que SE REGENERA SOLO (sesión fireops-82, 19-09-2026).
# Envuelve scripts/tunel.sh: cada 20 s comprueba desde FUERA que la URL pública
# llega a esta app (GET <url>/api/salud por Cloudflare). Tras 3 fallos seguidos
# (túnel caído, red que bloquea Cloudflare, dominio dado de baja tras una
# desconexión larga) cierra cloudflared y abre uno nuevo; tunel.sh republica solo
# el workflow «Atalaya · 112 entrante» de HappyRobot con la URL nueva.
# Además, cada minuto y cada vez que el túnel vuelve, pide a la app que recupere
# de HappyRobot las llamadas al 112 que no llegaron (POST /api/happyrobot/recuperar):
# lo que se dijo durante un corte no se pierde.
# Adopta un túnel que ya esté abierto y sano (no lo reabre).
# Si lo que no responde es la APP local (p. ej. se está reiniciando `npm run dev`), NO
# toca el túnel: espera a que la app vuelva (medido el 19-09: regenerar en ese caso mató
# un túnel sano). Variables siempre entre llaves: en bash 3.2, "$PUERTO…" con los puntos
# suspensivos se leía como la variable "PUERTO…" y el guardián moría (set -u).
# Uso: scripts/tunel-vigilado.sh [puerto]   (por defecto 3000). Ctrl+C cierra todo.
# Compatible con el bash 3.2 de macOS.
set -uo pipefail
PUERTO="${1:-3000}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVO="$DIR/data/url-publica.txt"
PATRON="cloudflared tunnel --url http://localhost:$PUERTO( |\$)"
CADA="${TUNEL_VIGILADO_CADA:-20}"
FALLOS_MAX="${TUNEL_VIGILADO_FALLOS:-3}"
SECRETO="$(grep -E '^HAPPYROBOT_WEBHOOK_SECRET=' "$DIR/.env.local" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g')"
PID_TUNEL=""

hora() { date +%H:%M:%S; }

cerrar_tunel() {
  [[ -n "$PID_TUNEL" ]] && kill "$PID_TUNEL" 2>/dev/null
  pkill -f "scripts/tunel.sh $PUERTO" 2>/dev/null || true
  pkill -f "$PATRON" 2>/dev/null || true
  PID_TUNEL=""
  sleep 2
}

abrir_tunel() {
  echo "[$(hora)] Abriendo túnel nuevo hacia :${PUERTO}..."
  "$DIR/scripts/tunel.sh" "$PUERTO" &
  PID_TUNEL=$!
  for _ in $(seq 1 45); do
    [[ -n "$(cat "$ARCHIVO" 2>/dev/null)" ]] && break
    kill -0 "$PID_TUNEL" 2>/dev/null || break
    sleep 1
  done
}

app_local_sana() {
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:${PUERTO}/api/salud" 2>/dev/null)" == "200" ]]
}

url_sana() {
  local url
  url="$(cat "$ARCHIVO" 2>/dev/null)"
  [[ -n "$url" ]] || return 1
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url/api/salud" 2>/dev/null)" == "200" ]]
}

recuperar() {
  [[ -n "$SECRETO" ]] || return 0
  local r
  r="$(curl -s --max-time 60 -X POST "http://localhost:$PUERTO/api/happyrobot/recuperar" -H "x-webhook-secret: $SECRETO" 2>/dev/null)"
  if [[ "$r" == *'"runId"'* ]]; then echo "[$(hora)] Llamadas recuperadas de HappyRobot: $r" | cut -c1-400; fi
}

trap 'echo; echo "[$(hora)] Cerrando el túnel vigilado."; cerrar_tunel; exit 0' INT TERM HUP

if pgrep -f "$PATRON" >/dev/null && url_sana; then
  echo "[$(hora)] Adopto el túnel que ya estaba abierto: $(cat "$ARCHIVO")"
else
  cerrar_tunel
  abrir_tunel
fi

fallos=0
vuelta=0
estaba_caido=0
while true; do
  sleep "$CADA"
  vuelta=$((vuelta + 1))
  if ! app_local_sana; then
    # La app no contesta: el túnel no es el problema. No se cuenta como fallo del túnel.
    echo "[$(hora)] La app local (:${PUERTO}) no responde: espero a que vuelva sin tocar el túnel."
    fallos=0
    estaba_caido=1
    continue
  fi
  if url_sana; then
    if [[ "$estaba_caido" == 1 ]]; then
      echo "[$(hora)] Túnel de nuevo operativo: $(cat "$ARCHIVO"). Recupero lo que se perdiera durante el corte."
      recuperar
      estaba_caido=0
    fi
    fallos=0
  else
    fallos=$((fallos + 1))
    estaba_caido=1
    echo "[$(hora)] La URL pública no responde desde fuera ($fallos/$FALLOS_MAX): $(cat "$ARCHIVO" 2>/dev/null)"
    if (( fallos >= FALLOS_MAX )); then
      echo "[$(hora)] Regenero el túnel (si la red bloquea Cloudflare, p. ej. la WiFi de la UPM, pasa al hotspot del móvil)."
      cerrar_tunel
      abrir_tunel
      fallos=0
    fi
  fi
  # Cada minuto, haya o no corte: la recuperación trabaja contra la API de HappyRobot, no contra el túnel.
  if (( vuelta % 3 == 0 )); then recuperar; fi
done
