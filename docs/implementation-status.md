# ASTRA implementation status

**Review date:** 2026-11-15  
**Build:** Node.js 24, built-in SQLite, browser JavaScript and CSS

## Working in the local prototype

- Login with role-scoped mission access, per-astronaut workspaces, and administrator-managed accounts. An astronaut account request form uses the existing opt-in registration endpoint; public registration is disabled unless `ASTRA_ALLOW_REGISTRATION=true` and an administrator still needs to link the account to a crew profile.
- Separate Simulation, Connected and Research data views. Health records keep their source, timestamp, units, quality and data class. CSV/JSON health imports are labeled and stored with their selected class.
- Four fictional astronaut profiles with seeded synthetic health history, plus synthetic environment and equipment histories. The seed database contains 144 health readings, 20 environmental sensors with 720 readings, and 8 equipment records with 576 readings.
- Health-domain pages, interactive history charts and measurement details, date filters, CSV export, reports, environment and equipment registries, manual sample capture, status review and maintenance history.
- Simulation controls for starting, pausing, resuming, stopping, resetting, selecting a scenario and changing the sample rate. Simulation output is persisted and labeled synthetic.
- ASTRA SENTINEL runs as a separate backend monitor while the server is running. Deterministic source-freshness and source-local deviation checks store explainable observations with evidence; authorized staff can acknowledge or resolve them. SENTINEL does not require ASTRA ASSIST or an external language model.
- ASTRA ASSIST uses local retrieval over the curated research catalog and authorized application context, and can optionally call an OpenAI-compatible service configured on the server. Retrieved research is presented with source links.
- OpenAPI JSON at `/api/openapi.json`, a local API reference page, role and astronaut authorization checks, hashed demo passwords, signed access sessions, SQLite persistence, offline browser caching and a queued health/wellness sync path.

## Verification performed

- `node --check` passed for the frontend, service worker and backend JavaScript modules.
- `node --test` passed **9 of 9** automated tests in three consecutive runs. Coverage includes seeded data separation, astronaut creation with mission association and baseline, model behavior and bounded synthetic evaluation, research retrieval, module routing, and SENTINEL checks for connected and simulated health, environment and equipment streams without an LLM.
- A fresh SQLite initialization succeeded on Node.js 24.22.1 and produced the seed counts listed above.

The automated suite is a core test suite, not a complete end-to-end acceptance suite. A browser/API walk-through could not be completed in this workspace because browser and shell requests to the local test server timed out or were blocked. Docker deployment was not run. The app's server startup and seed initialization are implemented, but those limits mean this report does not claim that every interaction has been browser-verified.

## Data and integration boundaries

- Seeded telemetry and model training/evaluation rows are synthetic. No real astronaut medical records, live spacecraft feeds or connected wearable devices are bundled.
- NASA OSDR, GeneLab, NASA HRP and environmental references are cataloged as research resources. ASTRA does not download OSDR or GeneLab data automatically. Study data must be acquired under their terms and imported with study metadata, units, source and limitations.
- Apple HealthKit, Android Health Connect, Garmin, Fitbit, Oura, Samsung Health and WHOOP are documented as possible authorized integration paths. No OAuth clients, native companion apps or provider credentials are configured.
- Environmental sensors and equipment can be registered and sampled manually. They are not connected to spacecraft hardware.
- Immune and bone-health pages are research scaffolds. ASTRA has no connected immune assays, bone scans, radiation dosimeter, ECG waveform or sleep-stage feed.
- The Isolation Forest implementation is JavaScript and is trained on synthetic demonstration records. It is not clinically validated and its score is not a medical risk probability. Python and scikit-learn were unavailable in the development environment, so the requested Python/scikit-learn stack was not added or verified.
- The local assistant works without external AI credentials; its optional remote LLM path was not integration-tested here. Assistant output is informational, not diagnosis or treatment.

## Demo credentials

All seeded local accounts use `Demo123!`:

| Role | Email |
| --- | --- |
| Mission administrator | `admin@astra.local` |
| Medical officer | `medical@astra.local` |
| Astronaut | `ast-001@astra.local` |

Use these accounts only for the local demonstration. Set a unique `JWT_SECRET` before exposing a deployment beyond the local machine.
