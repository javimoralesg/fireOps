#!/usr/bin/env bash
# Demo desde el móvil en un solo comando: dev server + túnel HTTPS + webhook de
# Telegram apuntando al túnel nuevo. Ctrl+C cierra los tres.
# Uso: npm run dev:movil [-- puerto]   (por defecto 3000)
set -euo pipefail
PUERTO="${1:-3000}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

command -v cloudflared >/dev/null || { echo "Falta cloudflared: brew install cloudflared"; exit 1; }

trap 'kill 0' EXIT INT TERM

npx next dev --port "$PUERTO" &

# tunel.sh vacía data/url-publica.txt y la rellena en cuanto el túnel tiene URL.
scripts/tunel.sh "$PUERTO" &

echo "Esperando la URL del túnel…"
URL=""
for _ in $(seq 1 60); do
  URL="$(cat data/url-publica.txt 2>/dev/null || true)"
  [[ -n "$URL" ]] && break
  sleep 1
done
[[ -n "$URL" ]] || { echo "El túnel no dio URL en 60 s"; exit 1; }

echo "Esperando al dev server en :$PUERTO…"
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:$PUERTO/api/salud" && break
  sleep 1
done

echo "Registrando el webhook de Telegram en $URL …"
curl -s -X POST "http://localhost:$PUERTO/api/telegram/configurar" \
  -H "content-type: application/json" -d "{\"url\":\"$URL\"}" \
  | head -c 300 || true
echo

echo
echo "==> Móvil: $URL/movil"
echo
wait
