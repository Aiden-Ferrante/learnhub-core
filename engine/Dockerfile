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
# --timeout/--retries: the heavy wheels (torch via docling) are large; tolerate a slow/flaky
# network so a single dropped download doesn't fail the whole build.
RUN pip install --no-cache-dir --timeout=1000 --retries=10 -r requirements.txt

# Bake BOTH of Kokoro's runtime downloads into the image: misaki's spaCy G2P model, and
# the Kokoro weights + the default voice from the HF hub. Without this a fresh container
# reaches the network mid-narration — a runtime dependency in a system whose whole point is
# running keyless and local, and measured at ~12s of the first render's wall time.
# Build has no GPU, so this loads on CPU; only the download side effect matters here.
RUN python -m spacy download en_core_web_sm \
    && python -c "\
from kokoro import KPipeline; \
p = KPipeline(lang_code='a', device='cpu'); \
p.load_voice('af_bella')"

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
