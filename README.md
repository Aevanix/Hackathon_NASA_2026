# ASTRA

**Autonomous Spaceflight Health Monitoring & Intelligence System**

*Intelligent Health. Autonomous Missions. Safer Space Exploration.*

ASTRA is a local-first research prototype for astronaut self-monitoring and mission medical review. Its modules organize timestamped health indicators, compare them with individual demonstration baselines, flag unusual patterns for review, and preserve a local workflow when internet access is limited.

> **Research prototype:** ASTRA is not a certified medical device or a flight-qualified onboard system. It does not diagnose, prescribe, or replace medical personnel. Seed readings and the ML training set are synthetic. No spacecraft or wearable hardware is connected.

## Start locally

Requirements: Node.js 24 or later. The app uses Node's built-in SQLite, HTTP, WebSocket, crypto, and file APIs, so no npm package installation is needed.

```powershell
node backend/server.mjs
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). On Linux or macOS, run the same command from the project directory. The database is created at `data/astra.sqlite` the first time the server starts. Stop the server with Ctrl+C.

For development, use `node --watch backend/server.mjs`. Train and persist a fresh Isolation Forest with `node backend/train.mjs`. Run the automated core checks with `node --test`.

### Local demonstration accounts

All seeded accounts use the local-only password `Demo123!`:

| Role | Email |
| --- | --- |
| Mission administrator | `admin@astra.local` |
| Medical officer | `medical@astra.local` |
| Astronaut | `ast-001@astra.local` |

Change seeded passwords and set a long random `JWT_SECRET` before exposing the app beyond a local demo. Public registration and development password reset are disabled by default. Account creation and password reset do not send email in this prototype.

## What is implemented

- Separate application modules for mission overview, crew, cardiovascular monitoring, respiratory monitoring, sleep, activity, wellness, radiation, alerts, trends, reports, simulation, dataset import, AI assistant, and administration.
- Mission selection followed by astronaut selection, with authorized per-astronaut workspaces and three separated data views: Connected, Simulation, and Research.
- ASTRA SENTINEL runs as an independent background service; it records source-local health, environment and equipment observations and stale-stream events without relying on the assistant.
- Environmental sensor and equipment registries with source labels, quality, histories, registration, manual sample capture, status review and maintenance records.
- Backend-enforced roles for astronauts, assigned medical officers, and administrators.
- SQLite persistence, validated health readings, per-astronaut baselines, audit records, hashed passwords, short-lived signed access tokens, rotating refresh tokens, and session revocation on logout.
- Timestamped synthetic health, environmental and equipment telemetry for four fictional astronauts; simulation supports normal, adaptation, exercise, sleep, respiratory, environment, wearable, equipment and recovery scenarios.
- A trained Isolation Forest implementation with model persistence, inference, anomaly scores, risk review categories, and evaluation against held-out synthetic data.
- Alert creation, duplicate grouping for repeat non-critical rules, acknowledgement, and resolution.
- Local retrieval over a small source catalog, permission-aware health context, citations, conversation history, and an optional OpenAI-compatible LLM provider configured only on the server.
- IndexedDB response cache and offline write queue, service-worker shell cache, reconnect sync endpoint, CSV/JSON import, and PDF/CSV report downloads.
- Dedicated immune and bone-health research scaffolds. These explicitly show that no validated immune assay or bone measurement feed is connected.

## NASA challenge resources

The research assistant catalog links to NASA's [Human Research Program](https://www.nasa.gov/hrp/), its [spaceflight risk catalog](https://www.nasa.gov/hrp/risks/), [Open Science Data Repository](https://osdr.nasa.gov/), and [GeneLab](https://genelab.nasa.gov/). ASTRA includes a locally authored summary of the NASA risk catalog as research context. It does **not** bundle NASA astronaut telemetry or perform a live OSDR download. Staff can manually import permitted CSV or JSON research data; each imported row keeps its source label, timestamp, quality status, and supplied units.

For data provenance, note that the [MIT-BIH Arrhythmia Database](https://physionet.org/content/mitdb/) is terrestrial clinical ECG data, not astronaut-specific data. No NASA, ESA, or PhysioNet data are presented as live astronaut readings.

## Architecture and module guide

- [Module map](docs/modules.md)
- [Architecture and data flows](docs/architecture.md)
- [Research and data-source map](docs/research-data-map.md)
- [Implementation status and verification report](docs/implementation-status.md)
- [Hackathon submission notes](docs/hackathon-submission.md)
- [AI-use and data provenance](docs/ai-use.md)

The in-app research catalog and source map describe NASA Standard Measures, OSDR, GeneLab, NASA Human Research Program, environmental standards, ECLSS and the terrestrial MIT-BIH dataset. HealthKit, Health Connect and Garmin are documented as possible provider pathways, but no device-service credentials or live connectors are configured.

## Environment and containers

Copy `.env.example` to `.env` and set a unique `JWT_SECRET`. Optional LLM variables are `ASTRA_LLM_API_KEY`, `ASTRA_LLM_BASE_URL`, and `ASTRA_LLM_MODEL`. The fallback assistant and all monitoring functions work without them.

Docker and Docker Compose files are included for environments with Docker. Docker was unavailable in the build environment, so that deployment path has not been run here. The local verified run uses SQLite; PostgreSQL, Alembic, React, FastAPI, vector embeddings, and live external data connectors are not part of this dependency-free build.

## Scope and known limits

- This is a hackathon prototype and not validated for clinical decisions.
- The Isolation Forest trains on generated reference telemetry; evaluation metrics use generated held-out examples and do not establish clinical performance.
- Some data are simulated; some reference text is a curated local summary. Only the original linked source can establish current research claims.
- Offline browser data are cached in IndexedDB and are not encrypted by this prototype. Offline inference works only while the local backend and its model remain available.
- The browser-side sync queue supports health readings and wellness assessments. It does not implement multi-device conflict resolution, encryption at rest, or flight hardware synchronization.
- Immune assays, bone scans or biomarkers, ECG waveforms, sleep stages, and wearable hardware are not connected. Their modules are marked as research scaffolds or unavailable measurements.
- The compact PDF report includes astronaut and mission details, measurement rows, alerts, provenance, and limitations. It does not include a generated clinical summary.

## Safety and AI-use note

ASTRA's source code and interface copy were developed with AI assistance. All seeded telemetry, reference baselines, and model training/evaluation examples are synthetic and are labeled as such in the interface and data provenance file. No AI-generated NASA logos, mission insignia, photos, video, or audio are included.
