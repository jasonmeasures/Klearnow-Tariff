#!/usr/bin/env bash
# Local WordPress + Duty stack embed dev.
# Requires: Docker (or Colima), Node 20+, npm in backend/ and frontend/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_ENV="$ROOT/backend/.env"
TARIFF_PORT="${TARIFF_PORT:-3000}"
WP_PORT="${WP_PORT:-8081}"
TEST_PORT="${TEST_PORT:-8082}"

frame_ancestors() {
  cat <<EOF
'self' \
http://localhost:${WP_PORT} \
http://127.0.0.1:${WP_PORT} \
http://localhost:${TEST_PORT} \
http://127.0.0.1:${TEST_PORT} \
https://klearnow.ai \
https://www.klearnow.ai \
https://klearnow.ai.com \
https://www.klearnow.ai.com \
https://*.klearnow.com \
https://klearnow.com
EOF
}

ensure_backend_env() {
  if [[ ! -f "$BACKEND_ENV" ]]; then
    cp "$ROOT/backend/.env.example" "$BACKEND_ENV"
  fi
  local fa
  fa="$(frame_ancestors | tr '\n' ' ' | sed 's/  */ /g')"
  if grep -q '^FRAME_ANCESTORS=' "$BACKEND_ENV"; then
    sed -i '' "s|^FRAME_ANCESTORS=.*|FRAME_ANCESTORS=${fa}|" "$BACKEND_ENV"
  else
    printf '\nFRAME_ANCESTORS=%s\n' "$fa" >> "$BACKEND_ENV"
  fi
  if grep -q '^ALLOW_GUEST=' "$BACKEND_ENV"; then
    sed -i '' 's|^ALLOW_GUEST=.*|ALLOW_GUEST=true|' "$BACKEND_ENV"
  else
    echo 'ALLOW_GUEST=true' >> "$BACKEND_ENV"
  fi
  echo "Updated $BACKEND_ENV (FRAME_ANCESTORS + ALLOW_GUEST)"
}

docker_cmd() {
  if command -v docker-compose >/dev/null 2>&1; then
    echo docker-compose
  elif docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v podman-compose >/dev/null 2>&1; then
    echo podman-compose
  else
    return 1
  fi
}

start_wordpress() {
  local dc
  dc="$(docker_cmd)" || {
    echo "Docker not found. Install Docker Desktop or: brew install colima docker docker-compose && colima start"
    echo "Or use the embed test page only (no full WP): $0 --test-only"
    exit 1
  }
  (cd "$WP_DIR" && $dc up -d)
  echo ""
  echo "WordPress: http://localhost:${WP_PORT}"
  echo "  1. Complete install wizard (any site title; admin user you choose)"
  echo "  2. Plugins → activate KlearNow Duty Stack"
  echo "  3. Settings → KlearNow Duty Stack → embed URL:"
  echo "     http://localhost:${TARIFF_PORT}/?embed=1&surface=external"
  echo "  4. Add page with shortcode: [klearnow_duty_stack height=\"900\"]"
}

start_tariff() {
  ensure_backend_env
  if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Backend already listening on :8080"
  else
    echo "Starting backend on :8080..."
    (cd "$ROOT/backend" && npm run dev) &
  fi
  if lsof -nP -iTCP:"$TARIFF_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Frontend already listening on :${TARIFF_PORT}"
  else
    echo "Starting frontend on :${TARIFF_PORT}..."
    (cd "$ROOT/frontend" && npm run dev -- --port "$TARIFF_PORT") &
  fi
  sleep 2
  echo "Tariff SPA: http://localhost:${TARIFF_PORT}/?embed=1&surface=external"
}

start_test_page() {
  echo "Embed test page (WP simulator): http://localhost:${TEST_PORT}/test-embed.html"
  echo "  (parent origin http://localhost:${TEST_PORT} must be in FRAME_ANCESTORS)"
  (cd "$WP_DIR" && python3 -m http.server "$TEST_PORT") &
}

case "${1:-all}" in
  --test-only)
    start_tariff
    start_test_page
    ;;
  --wp-only)
    start_wordpress
    ;;
  *)
    start_tariff
    start_wordpress
    start_test_page
    ;;
esac

echo ""
echo "Press Ctrl+C to stop foreground servers; WordPress container keeps running (docker compose down in wordpress/)"
wait
