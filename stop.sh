#!/bin/bash
# Stop Learn Hub — every service EXCEPT ollama. Ollama is a shared LLM other apps
# depend on and is managed independently (Mission Control's `ollama` service).
# Use `rm -sf` (stop+remove) rather than `down`: `down` removes the compose
# network, which would detach the still-running ollama container.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/deploy/compose/docker-compose.yml"

echo "Stopping Learn Hub services (leaving the shared Ollama running)…"
SERVICES="$(docker compose -f "$COMPOSE_FILE" config --services | grep -vx ollama | tr '\n' ' ')"
docker compose -f "$COMPOSE_FILE" rm -sf $SERVICES

echo ""
echo "Stopped; Ollama left running for other apps."
echo "Start again: ./start.sh"
echo "Stop Ollama too: docker compose -f $COMPOSE_FILE stop ollama"
