# 0.31.2+: required for GLM-4.7-Flash agentic use — tool-call parser and
# repetition fixes landed in the 0.30–0.31 series (0.24 garbles tool calls).
FROM ollama/ollama:0.31.2

# Copy the entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set the entrypoint
ENTRYPOINT ["/entrypoint.sh"]

