# ASTRA module skeleton

ASTRA is organized as separate pages and API/data workflows so each area can be demonstrated and developed independently. The sidebar is driven by `frontend/modules/catalog.js`; route-specific views are selected in `frontend/app.js`. The API and persistence layer is in `backend/server.mjs` and `backend/schema.sql`.

## Module status

| Module | Current workflow | Data and service boundary | Status |
| --- | --- | --- | --- |
| Mission overview | Crew cards, active alerts, data freshness, mission systems | `/api/dashboard`, WebSocket | Working |
| Mission and astronaut selection | Role-scoped mission roster, then astronaut workspace selection | `/api/dashboard`, `/api/astronauts` | Working |
| Crew roster | View profiles; admin can create and edit profiles | `/api/astronauts`, `astronauts`, `missions` | Working |
| Health monitor | Latest reading, quality, source, personal reference, recent history | `/api/health/{id}`, `/history`, health readings | Working |
| Cardiovascular | Heart rate and HRV with personal references | Health readings and baseline | Working; no ECG waveform |
| Respiratory | SpO₂ and respiratory rate with personal references | Health readings and baseline | Working; no CO₂ feed |
| Sleep & fatigue | Sleep duration and trend | Health readings, sleep records | Working; no sleep stages or validated fatigue model |
| Activity | Activity-level trend | Health readings, activity records | Working; no movement hardware or exercise test |
| Immune research | Separate evidence/context page and future-data integration checklist | NASA HRP source catalog | Scaffold; no immune assay feed |
| Bone health | Separate evidence/context page and future-data integration checklist | NASA HRP source catalog | Scaffold; no bone-density feed |
| Behavioral wellness | Voluntary mood, stress, fatigue, and sleep-satisfaction assessment | `/api/wellness`, `wellness_assessments` | Working; not a psychiatric diagnosis |
| Radiation | Dose-rate and cumulative exposure readings with source labels | `/api/radiation`, `radiation_readings` | Working; simulated by default |
| Environment | Source registry, channel history, source-local deviation and quality observations | `/api/environment/*`, `environmental_sensors`, `environmental_readings` | Working for stored/manual or simulated data; no spacecraft hardware |
| Equipment and wearables | Device registry, recent readings, status, maintenance log | `/api/equipment*`, `equipment`, `equipment_readings`, `equipment_maintenance` | Working for stored/manual or simulated data; no provider connector |
| Alert review | Filter, acknowledge, resolve, incident history | `/api/alerts`, `health_alerts`, acknowledgement log | Working |
| ASTRA SENTINEL | Background observation queue, evidence details, filters, acknowledgement and resolution | `/api/sentinel`, `sentinel.mjs`, `sentinel_observations`, `sentinel_actions` | Working deterministic monitor; independent of LLM |
| Health trends | Daily aggregation against a personal synthetic reference | `/api/health/{id}/trends` | Working |
| Health assistant | Local retrieval, authorised record context, sources, history | `/api/assistant/*`, `knowledge_documents`, conversation tables | Working local fallback; LLM optional |
| Simulation lab | Start, pause, resume, stop, reset, scenario and interval controls | `/api/simulation/*`, `simulation_sessions` | Working; synthetic only |
| Dataset import and research catalog | CSV/JSON mapping, validation, rejection reporting, source provenance and study metadata links | `/api/data/import`, `docs/research-data-map.md` | Working; health-shaped manual import; units preserved as supplied |
| Reports | Role-scoped PDF and CSV downloads | `/api/reports` | Working; compact report scope |
| Administration | User creation, missions, model status, evaluation, audit log | `/api/admin/*` | Working core controls |
| Offline and sync | Cached reads, queued writes, reconnect sync | Service worker, IndexedDB, `/api/sync` | Working local prototype; browser cache is not encrypted |

## User paths

### Astronaut

Sign in → review personal overview → inspect individual health modules → enter voluntary wellness assessment → ask the assistant about personal measurements or research → review personal alerts → download a report.

An astronaut's API scope is restricted to the account's linked astronaut ID.

### Medical officer

Sign in → monitor assigned crew → open a health domain or trend → review alert context → acknowledge or resolve an incident → generate an authorised report.

Medical officers only see astronauts assigned to their account.

### Mission administrator

Sign in → inspect mission dashboard → manage crew and users → run a synthetic scenario → review model/evaluation status and audit log → prepare mission reports.

## Shared interface layer

`frontend/modules/polish.js` adds a keyboard-accessible module palette (`Ctrl/Cmd+K` or `/`), a UTC clock, reduced-motion-aware page transitions, and a low-density starfield that pauses while the tab is hidden. `frontend/modules/upgrade.js` adds role-aware mobile shortcuts, persistent accent themes, keyboard-sortable tables, table search that survives live redraws, and sparklines built only from values already rendered by the selected data view. The companion styles live in `frontend/polish.css` and `frontend/upgrade.css`, and the service worker precaches those assets for offline use.

The extra visual effects are optional decoration; core navigation and data controls remain ordinary buttons and links. Data tables continue to show source, quality, freshness, and simulation or research classification where the API supplies them.

## Module contract for future work

Each module should own a focused page, a documented API path, persistence/provenance fields, role rules, empty/error/offline behavior, and a test. Do not mark a research scaffold as a working sensor feed until a real approved data source is connected and validated. New medical indicators should record unit, time, source, quality, simulation flag, and subject-specific reference where suitable.
