#!/usr/bin/env bash
# Túnel HTTPS para la demo (poc-07): cámara, GPS y micrófono del móvil exigen
# un contexto seguro. Abre un "quick tunnel" de Cloudflare (sin cuenta) hacia el
# dev server y deja la URL en data/url-publica.txt, que la app usa para el QR.
# Uso: scripts/tunel.sh [puerto]   (por defecto 3456)
set -euo pipefail
PUERTO="${1:-3456}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$DIR/data"
: > "$DIR/data/url-publica.txt"
command -v cloudflared >/dev/null || { echo "Falta cloudflared: brew install cloudflared"; exit 1; }
echo "Abriendo túnel hacia http://localhost:$PUERTO …"
cloudflared tunnel --url "http://localhost:$PUERTO" --no-autoupdate 2>&1 | while IFS= read -r linea; do
  echo "$linea"
  if [[ -z "$(cat "$DIR/data/url-publica.txt")" ]] && [[ "$linea" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    echo "${BASH_REMATCH[1]}" > "$DIR/data/url-publica.txt"
    echo
    echo "==> URL pública: ${BASH_REMATCH[1]}   (móvil: ${BASH_REMATCH[1]}/periferico)"
    echo
  fi
done
