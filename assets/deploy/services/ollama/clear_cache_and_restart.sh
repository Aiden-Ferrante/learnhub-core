#!/bin/bash
# Clear buffer cache and restart Ollama to fix unified memory detection
# This script addresses the issue where Ollama can't see full GPU memory
# due to buffer cache not being reclaimable in unified memory systems
#

set -e

echo "🧹 Clearing system buffer cache..."
echo "Current memory status:"
free -h

echo "Stopping Ollama container..."
docker compose -f /home/nvidia/learnhub/deploy/services/ollama/docker-compose.yml down

echo "Clearing buffer cache..."
sudo sync
sudo sh -c 'echo 1 > /proc/sys/vm/drop_caches'

echo "Memory status after cache clear:"
free -h

echo "Restarting Ollama container..."
docker compose -f /home/nvidia/learnhub/deploy/services/ollama/docker-compose.yml up -d

echo "Waiting for Ollama to start..."
sleep 10

echo "Checking GPU memory detection..."
timeout 30 bash -c 'while ! docker logs ollama-server 2>&1 | grep -q "inference compute"; do sleep 1; done'
docker logs ollama-server 2>&1 | grep "inference compute" | tail -1

echo "✅ Ollama restarted with cleared cache"
