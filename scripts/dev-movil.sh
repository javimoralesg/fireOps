#!/usr/bin/env bash
# Demo desde el móvil en un solo comando: dev server + túnel HTTPS + webhook de
# Telegram apuntando al túnel nuevo. Ctrl+C cierra los tres.
# Uso: npm run dev:movil [-- puerto]   (por defecto 3000)
set -euo pipefail
PUERTO="${1:-3000}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

command -v cloudflared >/dev/null || { echo "Falta cloudflared: brew install cloudflared"; exit 1; }

# Al salir se cierran SOLO los procesos que este script ha lanzado (y sus hijos). Antes era
# `kill 0`, que mata al grupo de procesos entero: desde un terminal interactivo el grupo es
# solo este script, pero lanzado sin control de trabajos (una tarea del IDE, la herramienta
# Bash de una sesión de Claude) el grupo es el del propio IDE y se cerraba la ventana entera
# con "killed, code 15" (19-09).
matar_arbol() {
  local hijo
  for hijo in $(pgrep -P "$1" 2>/dev/null); do matar_arbol "$hijo"; done
  kill "$1" 2>/dev/null || true
}
cerrar_todo() {
  local trabajo
  for trabajo in $(jobs -p); do matar_arbol "$trabajo"; done
}
trap cerrar_todo EXIT INT TERM

npx next dev --port "$PUERTO" &

# tunel.sh vacía data/url-publica.txt y la rellena en cuanto el túnel tiene URL. Va dentro de
# tunel-vigilado.sh, que lo regenera solo si se cae y recupera las llamadas al 112 perdidas.
scripts/tunel-vigilado.sh "$PUERTO" &

echo "Esperando la URL del túnel…"
URL=""
for _ in $(seq 1 60); do
  URL="$(cat data/url-publica.txt 2>/dev/null || true)"
  [[ -n "$URL" ]] && break
  sleep 1
done
[[ -n "$URL" ]] || { echo "El túnel no dio URL en 60 s"; exit 1; }

echo "Esperando al dev server en :${PUERTO}..."
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:$PUERTO/api/salud" && break
  sleep 1
done

echo "Registrando el webhook de Telegram en $URL …"
curl -s -X POST "http://localhost:$PUERTO/api/telegram/configurar" \
  -H "content-type: application/json" -d "{\"url\":\"$URL\"}" \
  | head -c 300 || true
echo

# El 112 por teléfono (HappyRobot) lo resincroniza scripts/tunel.sh en cuanto tiene la URL.

echo
echo "==> Móvil: $URL/movil"
echo
wait
