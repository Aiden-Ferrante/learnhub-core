#!/bin/bash
# Start Learn Hub: the full compose stack (app :3001, learn :8010, postgres :5432,
# ollama :11434 — reused untouched if already running).
#
#   ./start.sh                 start/refresh the stack
#   ./start.sh --dev-frontend  run only the frontend in dev mode on :3000 (no Docker)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/deploy/compose/docker-compose.yml"

if [ "${1:-}" = "--dev-frontend" ]; then
  cd "$SCRIPT_DIR/frontend" && exec pnpm dev
fi

echo "Starting Learn Hub (compose: $COMPOSE_FILE)…"
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "Learn Hub is running:"
echo "  • Web UI:  http://localhost:3001"
echo "  • Backend: http://localhost:8010 (health: /health)"
echo "  • Ollama:  http://localhost:11434 (shared with other apps)"
echo ""
echo "Stop (leaves Ollama running): ./stop.sh"
echo "Logs: docker compose -f $COMPOSE_FILE logs -f"
