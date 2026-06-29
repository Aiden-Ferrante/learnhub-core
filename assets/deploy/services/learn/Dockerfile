FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# System libs for Docling's stack:
#   libgomp1            -> torch/onnxruntime
#   libgl1, libglib2.0-0, libxcb1, libxrender1, libsm6, libxext6 -> opencv (cv2),
#       pulled in by docling-ibm-models' table-structure model.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 \
        libgl1 \
        libglib2.0-0 \
        libxcb1 \
        libxrender1 \
        libsm6 \
        libxext6 \
        ffmpeg \
        libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY templates ./templates

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
