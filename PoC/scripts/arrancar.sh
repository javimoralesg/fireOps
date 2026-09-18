#!/usr/bin/env bash
# Arranque de toda la plataforma en local (sin modo simulado, ver docs/servicios-locales.md).
# Levanta solo lo que no esté ya en marcha y comprueba que cada pieza responde:
#   Ollama :11434 (gemma3:4b + all-minilm) · ArangoDB :8529 (Docker) · Next :3456 · túnel HTTPS opcional
#
# Uso:
#   scripts/arrancar.sh            arranca todo y muestra el estado
#   scripts/arrancar.sh --tunel    además abre el túnel HTTPS (móvil como periférico / HappyRobot)
#   scripts/arrancar.sh estado     solo muestra el estado
#   scripts/arrancar.sh parar      para el dev server y el túnel que arrancó este script
#                                  (Ollama y Arango se quedan: los usan otras sesiones)
# Logs en data/logs/.
set -uo pipefail

PUERTO=3456
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$DIR/data/logs"
mkdir -p "$LOGS"
cd "$DIR"

ok()   { printf "  \033[32m✔\033[0m %s\n" "$*"; }
mal()  { printf "  \033[31m✘\033[0m %s\n" "$*"; }
info() { printf "  · %s\n" "$*"; }
escucha() { lsof -iTCP:"$1" -sTCP:LISTEN -nP >/dev/null 2>&1; }
esperar() { # esperar <segundos> <comando...>
  local t="$1"; shift
  for _ in $(seq "$t"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

estado() {
  echo "Estado:"
  if curl -sf http://127.0.0.1:11434/api/tags >/dev/null; then ok "Ollama        http://127.0.0.1:11434"; else mal "Ollama        caído"; fi
  if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8529/_api/version | grep -qE '200|401'; then ok "ArangoDB      http://localhost:8529  (root / atalaya)"; else mal "ArangoDB      caído (la app usa el grafo en memoria)"; fi
  local c; c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "http://localhost:$PUERTO/api/estado")
  if [[ "$c" == 200 ]]; then ok "Plataforma    http://localhost:$PUERTO"; else mal "Plataforma    /api/estado → ${c:-sin respuesta} (log: data/logs/next.log)"; fi
  local url; url=$(cat data/url-publica.txt 2>/dev/null)
  if [[ -n "$url" ]] && pgrep -f "cloudflared tunnel --url http://localhost:$PUERTO" >/dev/null; then ok "Túnel         $url  (móvil: $url/periferico)"; else info "Túnel         cerrado (scripts/arrancar.sh --tunel)"; fi
  echo
  echo "Superficies: /  ·  /acceso  ·  /ciudadano  ·  /auditoria  ·  /politica  ·  /perifericos  ·  /periferico (móvil)"
}

parar() {
  if [[ -f "$LOGS/next.pid" ]] && kill "$(cat "$LOGS/next.pid")" 2>/dev/null; then ok "dev server parado"; else info "el dev server no lo arrancó este script; no lo toco"; fi
  pkill -f "cloudflared tunnel --url http://localhost:$PUERTO" && ok "túnel cerrado" || info "no había túnel"
  rm -f "$LOGS/next.pid"
}

case "${1:-}" in
  estado) estado; exit 0 ;;
  parar)  parar;  exit 0 ;;
esac
TUNEL=0; [[ "${1:-}" == "--tunel" ]] && TUNEL=1

echo "Requisitos:"
for b in node npm ollama docker ffmpeg say; do
  command -v "$b" >/dev/null && ok "$b" || mal "falta $b"
done
[[ -f .env.local ]] && ok ".env.local" || mal "falta .env.local (copia .env.example)"
if [[ ! -d node_modules ]]; then info "instalando dependencias…"; npm install >"$LOGS/npm-install.log" 2>&1 && ok "npm install" || { mal "npm install falló (data/logs/npm-install.log)"; exit 1; }; fi

echo; echo "Servicios:"

# 1. Ollama (LLM local, visión y embeddings del RAG)
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null; then
  info "arrancando ollama serve…"
  nohup ollama serve >"$LOGS/ollama.log" 2>&1 &
  esperar 20 curl -sf http://127.0.0.1:11434/api/tags && ok "Ollama arrancado" || mal "Ollama no responde (data/logs/ollama.log)"
else ok "Ollama ya estaba en marcha"; fi
MODELO=$(grep -E '^OLLAMA_MODEL=' .env.local 2>/dev/null | cut -d= -f2); MODELO=${MODELO:-gemma3:4b}
for m in "$MODELO" all-minilm:l6-v2; do
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$m"; then ok "modelo $m"; else info "descargando $m…"; ollama pull "$m" && ok "modelo $m" || mal "no se pudo descargar $m"; fi
done
# Precarga en segundo plano para que la primera decisión no espere la carga del modelo
curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$MODELO\",\"keep_alive\":\"30m\"}" >/dev/null 2>&1 &

# 2. ArangoDB en Docker (grafo y efecto dominó)
if ! docker info >/dev/null 2>&1; then
  info "abriendo Docker Desktop…"
  open -ga Docker 2>/dev/null
  esperar 60 docker info || mal "Docker no arranca: la app seguirá con el grafo en memoria"
fi
if docker info >/dev/null 2>&1; then
  if [[ "$(docker inspect -f '{{.State.Running}}' atalaya-arango 2>/dev/null)" == true ]]; then ok "ArangoDB ya estaba en marcha"
  elif docker start atalaya-arango >/dev/null 2>&1 || docker compose up -d arango >/dev/null 2>&1; then
    esperar 30 sh -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8529/_api/version | grep -qE '200|401'" && ok "ArangoDB arrancado" || mal "ArangoDB no responde"
  else mal "no se pudo arrancar ArangoDB"; fi
fi

# 3. Índice del RAG de normativa (se genera una vez)
if [[ -f data/protocolos/indice.json ]]; then ok "índice RAG de normativa"
elif [[ -f data/protocolos/construir.mjs ]]; then info "construyendo índice RAG…"; node data/protocolos/construir.mjs >"$LOGS/rag.log" 2>&1 && ok "índice RAG" || mal "índice RAG falló (data/logs/rag.log)"
else info "sin corpus RAG en data/protocolos (normativa sin cita)"; fi

# 4. Plataforma (Next) en :3456 — si ya hay uno (lo arranca otra sesión), no se relanza
if escucha "$PUERTO"; then ok "dev server ya en marcha en :$PUERTO"
else
  info "arrancando next dev en :$PUERTO…"
  nohup npx next dev -p "$PUERTO" >"$LOGS/next.log" 2>&1 &
  echo $! >"$LOGS/next.pid"
  esperar 60 escucha "$PUERTO" && ok "dev server arrancado" || { mal "next no arranca (data/logs/next.log)"; tail -20 "$LOGS/next.log"; exit 1; }
fi
info "compilando y cargando el estado inicial (la primera vez tarda)…"
esperar 90 curl -sf --max-time 60 "http://localhost:$PUERTO/api/estado" >/dev/null

# 5. Túnel HTTPS (cámara/GPS del móvil y webhooks de HappyRobot)
if [[ $TUNEL == 1 ]]; then
  if pgrep -f "cloudflared tunnel --url http://localhost:$PUERTO" >/dev/null; then ok "túnel ya abierto"
  else
    nohup "$DIR/scripts/tunel.sh" "$PUERTO" >"$LOGS/tunel.log" 2>&1 &
    esperar 30 test -s data/url-publica.txt && ok "túnel abierto" || mal "el túnel no da URL (data/logs/tunel.log)"
  fi
fi

echo; estado
[[ -z "${NO_ABRIR:-}" ]] && open "http://localhost:$PUERTO" 2>/dev/null || true
