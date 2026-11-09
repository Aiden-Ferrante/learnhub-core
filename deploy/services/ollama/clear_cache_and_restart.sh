#!/bin/bash
# Clear buffer cache and restart Ollama to fix unified memory detection
# This script addresses the issue where Ollama can't see full GPU memory
# due to buffer cache not being reclaimable in unified memory systems
#

set -e

# Which compose file and service run Ollama. Defaults to this repo's stack
# (deploy/compose/docker-compose.yml, service `ollama`, container `ollama-compose`);
# override if your Ollama is managed elsewhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OLLAMA_COMPOSE_FILE="${OLLAMA_COMPOSE_FILE:-$SCRIPT_DIR/../../compose/docker-compose.yml}"
OLLAMA_SERVICE="${OLLAMA_SERVICE:-ollama}"
export OLLAMA_CONTAINER="${OLLAMA_CONTAINER:-ollama-compose}"  # exported: the wait loop runs in a child bash

echo "🧹 Clearing system buffer cache..."
echo "Current memory status:"
free -h

echo "Stopping Ollama container..."
docker compose -f "$OLLAMA_COMPOSE_FILE" stop "$OLLAMA_SERVICE"

echo "Clearing buffer cache..."
sudo sync
sudo sh -c 'echo 1 > /proc/sys/vm/drop_caches'

echo "Memory status after cache clear:"
free -h

echo "Restarting Ollama container..."
docker compose -f "$OLLAMA_COMPOSE_FILE" up -d "$OLLAMA_SERVICE"

echo "Waiting for Ollama to start..."
sleep 10

echo "Checking GPU memory detection..."
timeout 30 bash -c 'while ! docker logs "$OLLAMA_CONTAINER" 2>&1 | grep -q "inference compute"; do sleep 1; done'
docker logs "$OLLAMA_CONTAINER" 2>&1 | grep "inference compute" | tail -1

echo "✅ Ollama restarted with cleared cache"
