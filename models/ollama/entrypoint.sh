#!/bin/bash
set -e

# Start Ollama server in the background
echo "Starting Ollama server..."
/bin/ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "Waiting for Ollama to be ready..."
max_attempts=120
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if /bin/ollama list > /dev/null 2>&1; then
        echo "Ollama is ready!"
        break
    fi
    attempt=$((attempt + 1))
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo "ERROR: Ollama failed to start within the timeout period"
    exit 1
fi

# Check if any models are present
echo "Checking for existing models..."

if ! /bin/ollama list | grep -q llama3.1:8b; then
    echo "No models found. Pulling llama3.1:8b..."
    /bin/ollama pull llama3.1:8b
    echo "Successfully pulled llama3.1:8b"
else
    echo "Models already exist, skipping pull."
fi

# Keep the container running
echo "Setup complete. Ollama is running."
wait $OLLAMA_PID