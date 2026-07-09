# OpenWiki QuickStart (Extended)

Welcome to **NVIDIA Text-to-Knowledge (txt2kg)** repository. This platform builds an AI‑driven learning ecosystem that transforms textual content into structured knowledge graphs, study pathways, and interactive learning experiences.

---

## Table of Contents
1. [Core Purpose](#core-purpose)  
2. [Repository Structure Overview](#repository-structure-overview)  
3. [Key Technical Domains](#key-technical-domains)  
4. [Getting Started](#getting-started)  
5. [Exploring Core APIs](#exploring-core-apis)  
6. [Architecture Overview](#architecture-overview)  
7. [Contribution Guide](#contribution-guide)  
8. [License & Acknowledgements](#license--acknowledgements)

---

## Core Purpose
- **Convert** raw documents (books, articles, PDFs) into enriched, searchable representations.  
- **Generate** personalized learning paths, concept maps, and practice exercises.  
- **Serve** these assets through a modular backend and modern front‑end UI for seamless education workflows.

---

## Repository Structure Overview
```
/assets
 ├─ deploy/               # Deployment manifests (Dockerfiles, K8s configs)
 └─ frontend/             # React/TSX UI components for learning surfaces

/docs
 ├─ design-cross-book-concepts.md
 └─ design-vault-bridge.md

/openwiki/
 # Documentation lives here under openwiki/

```
- The `/openwiki/` directory is the central hub for all generated documentation.  
- All Markdown files in this folder are rendered automatically by the platform’s navigation sidebar.

---

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
   - *Backend*: `docker compose up services/learn` (starts API, DB, and queue workers).  
   - *Frontend*: `npm start --prefix assets/frontend`.

3. **Environment Configuration**  
   Copy `.env.example` to `.env` and fill in required keys (e.g., `DB_HOST`, `TTS_API_KEY`).  

4. **Verify Installation**  
   ```bash
   curl http://localhost:8000/health
   # Expected response: {"status":"ok"}
   ```

5. **Access UI**  
   Open `http://localhost:3000` in your browser to view the Learning Surface.

---

## Exploring Core APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/learn/concepts` | GET | Fetch concept outlines for a given document. |
| `/api/learn/course-status` | GET | Query published course status and progress. |
| `/api/learn/pdf/route` | GET | Serve PDF reading anchors and metadata. |
| `/api/learn/audiobook` | POST | Trigger audiobook generation for selected chapters. |

Example request:  
```bash
curl -X GET "http://localhost:8000/api/learn/concepts?doc_id=123"
```

---

## Architecture Overview
For a quick visual map of how everything fits together, see `/openwiki/architecture/system-overview.md`.

Key components include:
- **Ingestion Service** – parses raw files and creates repository entries.  
- **Processing Workers** – run NLP pipelines to extract concepts and relationships.  
- **Storage Layer** – ArangoDB for graph data; vector store for embeddings.  
- **Orchestration Engine** – `plan.py` schedules jobs, monitors health, and retries failed tasks.

---

## Contribution Guide
1. **Fork** the repository on GitHub.  
2. Create a feature branch (`git checkout -b feat/your-feature`).  
3. Follow the existing **coding style** (PEP8 for Python, AirBnb for JS).  
4. Write unit tests covering ≥ 80 % of new code. Run `pytest` and `npm test`.  
5. Submit a Pull Request with a concise description of changes and rationale.  

Please refer to the [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed processes.

---

## License & Acknowledgements
- **License**: This project is licensed under the MIT License – see the `LICENSE` file for details.  
- **Acknowledgements**: Special thanks to the open‑source communities behind Docker, React, ArangoDB, and the Text‑to‑Speech libraries used in this repository.

--- 

*End of document*