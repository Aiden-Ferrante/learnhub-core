#!/bin/bash
# Setup script for Learn Hub project

# Parse command line arguments
DEV_FRONTEND=false
USE_VECTOR_SEARCH=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --dev-frontend)
      DEV_FRONTEND=true
      shift
      ;;
    --vector-search)
      USE_VECTOR_SEARCH=true
      shift
      ;;
    --help|-h)
      echo "Usage: ./start.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --dev-frontend    Run frontend in development mode (without Docker)"
      echo "  --vector-search   Enable vector search services (Qdrant + Sentence Transformers)"
      echo "  --help, -h        Show this help message"
      echo ""
      echo "Default: Starts ArangoDB + Ollama"
      echo ""
      echo "Examples:"
      echo "  ./start.sh                       # Default: ArangoDB + Ollama"
      echo "  ./start.sh --vector-search       # Add Qdrant + Sentence Transformers"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run './start.sh --help' for usage information"
      exit 1
      ;;
  esac
done

if [ "$DEV_FRONTEND" = true ]; then
  echo "Starting frontend in development mode..."
  cd frontend
  if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed. Install it with: npm install -g pnpm"
    exit 1
  fi
  pnpm run dev
  exit 0
fi

# Check for GPU support
echo "Checking for GPU support..."
if command -v nvidia-smi &> /dev/null; then
  if nvidia-smi &> /dev/null; then
    echo "✓ NVIDIA GPU detected"
    GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -n1)
    echo "  GPU: $GPU_INFO"
  else
    echo "⚠ NVIDIA GPU not accessible. Services will run in CPU mode (slower)."
  fi
else
  echo "⚠ nvidia-smi not found. Services will run in CPU mode (slower)."
fi

# Check which Docker Compose version is available
DOCKER_COMPOSE_CMD=""
if docker compose version &> /dev/null; then
  DOCKER_COMPOSE_CMD="docker compose"
  echo "Using Docker Compose V2"
elif command -v docker-compose &> /dev/null; then
  DOCKER_COMPOSE_CMD="docker-compose"
  echo "Using Docker Compose V1 (deprecated - consider upgrading)"
else
  echo "Error: Neither 'docker compose' nor 'docker-compose' is available"
  echo "Please install Docker Compose: https://docs.docker.com/compose/install/"
  exit 1
fi

# Check Docker daemon permissions
echo "Checking Docker permissions..."
if ! docker info &> /dev/null; then
  echo ""
  echo "=========================================="
  echo "ERROR: Docker Permission Denied"
  echo "=========================================="
  echo ""
  echo "You don't have permission to connect to the Docker daemon."
  echo ""
  echo "To fix this, run one of the following:"
  echo ""
  echo "Option 1 (Recommended): Add your user to the docker group"
  echo "  sudo usermod -aG docker \$USER"
  echo "  newgrp docker"
  echo ""
  echo "Option 2: Run this script with sudo (not recommended)"
  echo "  sudo ./start.sh"
  echo ""
  echo "After adding yourself to the docker group, you may need to log out"
  echo "and log back in for the changes to take effect."
  echo ""
  exit 1
fi
echo "✓ Docker permissions OK"

# Compose paths must follow this script, not the caller's cwd (pwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Select compose file and build command
COMPOSE_DIR="$SCRIPT_DIR/deploy/compose"
PROFILES=""

COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
echo "Using ArangoDB + Ollama configuration..."

CMD="$DOCKER_COMPOSE_CMD -f $COMPOSE_FILE"

if [ "$USE_VECTOR_SEARCH" = true ]; then
  PROFILES="--profile vector-search"
  echo "Enabling vector search (Qdrant + Sentence Transformers)..."
fi

# Execute the command
echo ""
echo "Starting services..."
echo "Running: $CMD $PROFILES up -d"
echo "Note: First-time builds pull large images (ollama/ollama base can take several minutes)."
cd "$SCRIPT_DIR"
eval "$CMD $PROFILES up -d"

echo ""
echo "=========================================="
echo "Learn Hub is now running!"
echo "=========================================="
echo ""
echo "Core Services:"
echo "  • Web UI: http://localhost:3001"
echo "  • ArangoDB: http://localhost:8529"
echo "  • Ollama API: http://localhost:11434"
echo "  • Learning app (Python): http://localhost:8010 — study + PDF→Markdown for upload"
echo ""

if [ "$USE_VECTOR_SEARCH" = true ]; then
  echo "Vector Search Services:"
  echo "  • Qdrant: http://localhost:6333"
  echo "  • Sentence Transformers: http://localhost:8000"
  echo ""
fi

echo "Next steps:"
echo "  1. Pull an Ollama model (if not already done):"
echo "     docker exec ollama-compose ollama pull llama3.1:8b"
echo ""
echo "  2. Open http://localhost:3001 in your browser"
echo "  3. Upload documents and start studying!"
echo ""
echo "Other options:"
echo "  • Stop services: ./stop.sh"
echo "  • Run frontend in dev mode: ./start.sh --dev-frontend"
echo "  • Add vector search: ./start.sh --vector-search"
echo "  • View logs: docker compose logs -f"
echo ""
