#!/usr/bin/env bash
# Túnel HTTPS para la demo (poc-07): cámara, GPS y micrófono del móvil exigen
# un contexto seguro. Abre un "quick tunnel" de Cloudflare (sin cuenta) hacia el
# dev server y deja la URL en data/url-publica.txt, que la app usa para el QR.
# Al cerrarse (Ctrl+C, cierre del terminal, caída de cloudflared) VACÍA ese
# archivo: el QR de la sala nunca debe apuntar a un túnel que ya no existe.
# Uso: scripts/tunel.sh [puerto]   (por defecto 3000)
# Compatible con el bash 3.2 de macOS.
set -euo pipefail
PUERTO="${1:-3000}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVO="$DIR/data/url-publica.txt"
PATRON="cloudflared tunnel --url http://localhost:$PUERTO( |\$)"
mkdir -p "$DIR/data"

command -v cloudflared >/dev/null || { echo "Falta cloudflared: brew install cloudflared"; exit 1; }

# Un solo túnel por puerto: otro pisaría la URL del primero.
OTRO="$(pgrep -f "$PATRON" || true)"
if [[ -n "$OTRO" ]]; then
  echo "Ya hay un túnel hacia :$PUERTO (pid $OTRO): $(cat "$ARCHIVO" 2>/dev/null || true)"
  echo "Para reabrirlo, ciérralo antes: kill $OTRO"
  exit 0
fi

# Comprobación previa: hay redes (p. ej. la WiFi de la UPM, con filtro DNS) que
# bloquean trycloudflare.com; cloudflared muere con "no such host".
resuelve() {
  if command -v dscacheutil >/dev/null; then dscacheutil -q host -a name "$1" | grep -q ip_address
  elif command -v getent >/dev/null; then getent hosts "$1" >/dev/null
  else return 0
  fi
}
if ! resuelve api.trycloudflare.com; then
  echo "Esta red no resuelve api.trycloudflare.com: bloquea los túneles de Cloudflare (pasa en la"
  echo "WiFi de la universidad, con filtro DNS), así que cloudflared no puede arrancar aquí."
  echo "Qué hacer: comparte los datos del móvil (hotspot), conecta el Mac a esa red y repite:"
  echo "  scripts/tunel.sh $PUERTO"
  echo "El móvil que hace de cámara usa su propia conexión de datos, así que a él no le afecta."
  exit 1
fi

limpiar() {
  : > "$ARCHIVO"
  pkill -f "$PATRON" 2>/dev/null || true
}
trap limpiar EXIT
trap 'limpiar; exit 130' INT TERM HUP

: > "$ARCHIVO"
echo "Abriendo túnel hacia http://localhost:$PUERTO …"
# La tubería va en segundo plano y el script espera con `wait`: bash aplaza los
# traps mientras hay una tubería en primer plano, así que una señal que llegara
# solo al script (kill, cierre de dev-movil.sh) dejaría cloudflared vivo y la
# URL escrita. Con `wait` la señal se atiende al momento y `limpiar` lo cierra.
(
  cloudflared tunnel --url "http://localhost:$PUERTO" --no-autoupdate 2>&1 | while IFS= read -r linea; do
    echo "$linea"
    if [[ -z "$(cat "$ARCHIVO")" ]] && [[ "$linea" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
      echo "${BASH_REMATCH[1]}" > "$ARCHIVO"
      echo
      echo "==> URL pública: ${BASH_REMATCH[1]}   (móvil: ${BASH_REMATCH[1]}/movil)"
      echo "    Deja este terminal abierto durante la demo: al cerrarlo la URL deja de existir."
      echo
    fi
    if [[ "$linea" == *"failed to request quick Tunnel"* ]] || [[ "$linea" == *"no such host"* ]]; then
      echo
      echo "==> Cloudflare no ha dado túnel. Si el error dice 'no such host', esta red bloquea"
      echo "    trycloudflare.com: conecta el Mac al hotspot del móvil y repite scripts/tunel.sh $PUERTO."
      echo
    fi
  done
) &
wait $! || true

echo "El túnel se ha cerrado: data/url-publica.txt queda vacío para que el QR de la sala no apunte a una URL muerta."
exit 1
