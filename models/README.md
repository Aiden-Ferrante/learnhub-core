# Models

Where model calls go. The Learn Engine picks a model by name (`LEARN_*_MODEL` in
`deploy/compose/docker-compose.yml`):

- `ollama/`: the local model server image (compose service `ollama`, container `ollama-compose`,
  shared with other apps on this machine). Runs extraction, quiz authoring and, later, embeddings.
- `claude-bridge/`: a model named `claude:<model>` goes here instead. A small host service
  (systemd user unit `claude-bridge`, :8897) that runs it on the host's Claude Code login,
  because the engine's container has no CLI. It reuses the engine's `app.gateways.llm`, so it runs
  with the engine's venv: `engine/.venv/bin/python models/claude-bridge/claude_bridge.py`.
