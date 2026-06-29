# NGC PyTorch ships a CUDA-enabled torch built for aarch64 / GB10 (Blackwell),
# matching how the other GPU services in this repo are based (nvcr.io/nvidia/pyg,
# nvcr.io/nvidia/vllm). The previous python:3.9-slim base pip-installed the
# CPU-only torch wheel, so embeddings ran on CPU regardless of GPU access.
FROM nvcr.io/nvidia/pytorch:25.11-py3

WORKDIR /app

# Install only the serving deps on top of the base. requirements.txt deliberately
# does NOT pin torch — reinstalling it would clobber the CUDA build with a CPU wheel.
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py /app/

# Set default model name. HF_HOME replaces the deprecated TRANSFORMERS_CACHE.
ENV MODEL_NAME="all-MiniLM-L6-v2"
ENV HF_HOME="/app/.cache"

# Pre-download the model during build for faster startup
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${MODEL_NAME}')"

# Expose the port
EXPOSE 80

# Use Gunicorn for better performance
CMD ["gunicorn", "--bind", "0.0.0.0:80", "--workers", "1", "--threads", "8", "app:app"]
