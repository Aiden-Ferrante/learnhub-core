# OpenWiki QuickStart

Welcome to **NVIDIA Text-to-Knowledge (txt2kg)** repository. This platform builds an AI‑driven learning ecosystem that transforms textual content into structured knowledge graphs, study pathways, and interactive learning experiences.

## Core Purpose
- **Convert** raw documents (books, articles, PDFs) into enriched, searchable representations.
- **Generate** personalized learning paths, concept maps, and practice exercises.
- **Serve** these assets through a modular backend and modern front‑end UI for seamless education workflows.

---

## Repository Structure Overview
```
/assets
   ├─ deploy/            # Deployment manifests (Dockerfiles, K8s configs)
   └─ frontend/          # React/TSX UI components for learning surfaces
/docs
   ├─ design‑cross‑book-concepts.md
   └─ design‑vault‑bridge.md
/openwiki/
   # Documentation lives here under openwiki/
```

## Key Technical Domains

| Domain | Description |
|--------|-------------|
| **Learning Pipeline** | Orchestrates ingestion, processing, concept extraction, and publishing of educational content. Includes services like `build_queue`, `concept_study_routes`, `audiobook` pipelines, etc. |
| **Frontend Learning Surface** | React components (`course-home`, `deep-chapter`, `concepts-view`, `process-dashboard`) that render interactive study interfaces. |
| **Audio & TTS Services** | Convert text to speech, generate narration checkpoints, and serve audiobook highlights. |
| **Knowledge Graph Layer** | Uses ArangoDB/Vector stores for concept graphs, synergy between chapters, and vault‑bridge metadata. |
| **Deployment Infrastructure** | Dockerfiles (e.g., `ollama/Dockerfile`), service routes, and system orchestration scripts (`build_queue.py`, `plan.py`). |

---

## Getting Started

1. **Clone & Install**  
   ```bash
   git clone <repo-url>
   cd txt2kg
   ./scripts/setup.sh          # installs backend deps & frontend npm packages
   ```

2. **Run Local Services**  
   - Backend: `docker compose up services/learn` (starts API, DB, and queue workers).  
   - Frontend: `npm start --prefix assets/frontend`.

3. **Explore Core APIs**  
   - `/api/learn/concepts` – fetch concept outlines.  
   - `/api/learn/course-status` – query published course status.  
   - `/api/learn/pdf/route` – serve PDF reading anchors.

4. **Dive Deeper** (see the left‑hand sidebar for detailed sections):
   - Architecture & System Design
   - Processing Pipelines
   - Frontend Component Reference
   - Testing Strategy
   - Deployment & Operations

--- 

*For a quick visual map of how everything fits together, see `/openwiki/architecture/system-overview.md`.

## Contributing
We welcome community contributions. Contributions can be submitted via pull request and should follow the [Contribution Guidelines](https://github.com/nvidia/txt2kg/CONTRIBUTING.md).

## Roadmap
- **Phase 1**: Enhance PDF parsing pipelines for richer extract.
- **Phase 2**: Add interactive concept‑map visualizations within the learning surface.
- **Phase 3**: Integrate with NVIDIA AI services to auto‑generate personalized learning paths. 