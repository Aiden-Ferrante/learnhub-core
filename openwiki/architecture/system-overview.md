# System Overview

This document provides a high‑level view of the NVIDIA Text‑to‑Knowledge (txt2kg) architecture, illustrating how data flows from raw source material to interactive learning experiences.

## 1. Core Layers

| Layer | Responsibility | Key Services / Components |
|-------|-----------------|---------------------------|
| **Ingestion & Storage** | Capture raw documents (PDFs, markdown, JSON) and store in a durable repository. | `ingest_routes`, ArangoDB collections for raw assets. |
| **Processing Pipeline** | Transform text into structured representations: tokenization → embedding → concept extraction → graph construction. | `build_queue.py`, `concept_extract.py`, `audiobook.py`, LLM services, vector stores. |
| **Knowledge Graph Layer** | Maintain cross‑chapter concept graphs, vault‑bridge metadata, and semantic relationships. | ArangoDB graph models, `arango_content.py`, `arango_tree.py`. |
| **Orchestration & Queue Management** | Schedule and dispatch jobs, monitor progress, enforce quotas and back‑pressure. | `build_queue.py`, `plan.py`, `learning_path_routes.py`. |
| **Frontend Learning Surface** | Render interactive study interfaces: reading surfaces, concept maps, drill exercises, dashboards. | React components under `/assets/frontend/app/learn/*` (e.g., `deep-chapter.tsx`, `course-home.tsx`, `process-dashboard.tsx`). |
| **Audio & TTS Services** | Generate spoken narration, checkpoint audiobook highlights, and serve multimodal playback. | `audiobook.py`, TTS micro‑services, `read-along.ts`. |
| **Deployment Infrastructure** | Containerize services, define network routes, manage system configuration (Dockerfiles, K8s manifests). | Dockerfiles (`ollama/Dockerfile`), service route definitions, `system_routes.py`. |

## 2. Data Flow Diagram

```mermaid
graph LR
    A[Raw Documents] -->|Ingest| B(ArangoDB Raw Store)
    B -->|Processing| C[Concept Extraction Service]
    C --> D[Knowledge Graph (ArangoDB)]
    D --> E[Learning Path Generator]
    E --> F[Frontend UI Services]
    subgraph Audio
        G[Audiobook Pipeline] --> H[Narration Service]
        H --> F
    end
    I[Deployment Orchestrator] -->|Docker/K8s| A
    I -->|Queue Manager| C
    J[Monitoring & Metrics] --> B
    J --> D
    J --> F
```

- **Arrows** denote data movement; **services** in parentheses are the responsible components.
- The diagram emphasizes that **all pathways converge on the knowledge graph**, which powers both backend analytics and frontend interaction.

## 3. Key Interfaces

| Interface | Purpose |
|-----------|---------|
| `/api/learn/concepts` | Retrieve concept outlines for a given document. |
| `/api/learn/course-status` | Query published status of learning courses. |
| `/api/learn/pdf/route` | Serve PDF reading anchors (trust‑base PDFs). |
| `/api/learn/audiobook/timeline/route` | Provide timeline data for audiobook highlights. |
| WebSocket / SSE endpoints | Push real‑time updates to the front‑end dashboard. |

## 4. Runtime Stack

- **Backend**: Python 3.10+, FastAPI, ArangoDB, Docker Compose.
- **Frontend**: React 18 + TypeScript + Tailwind CSS, served via Vite.
- **Audio/TT S**: NVIDIA TTS models, GPU‑accelerated inference.
- **Orchestration**: Kubernetes (future), currently `docker compose` for local dev.

---

*Refer to the following pages for deeper dives into each domain:*
- `/openwiki/pipelines/learning-pipeline.md`
- `/openwiki/frontend/component-reference.md`
- `/openwiki/audio-tts/overview.md`
- `/openwiki/knowledge-graph/graph-layer.md`
- `/openwiki/deployment/infrastructure.md`
- `/openwiki/testing/test-strategy.md`
