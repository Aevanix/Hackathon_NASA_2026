# ASTRA research and data-source map

This catalogue separates published research context, study datasets, environmental standards, and wearable-provider integrations. A link in ASTRA means the source is discoverable; it does not mean that ASTRA is connected to it or that data are bundled. Research measurements are not real-time astronaut telemetry and are not automatically calibrated for medical decisions.

## Spaceflight and human-health sources

| Source | Measurements or topics | Access and units | Limits in ASTRA |
| --- | --- | --- | --- |
| [NASA Spaceflight Standard Measures](https://www.nasa.gov/humans-in-space/spaceflight-standard-measures-characterizing-how-humans-adapt-in-space/) | Longitudinal measures can include actigraphy and light exposure, cognition, selected blood and saliva biochemical or immune assays, microbiome, carotid imaging, sensorimotor testing, sleep and team questionnaires. | Research protocols use instrument- and study-specific units, schedules and methods. Availability varies by mission and study. | Not a live personal feed. These protocol measures do not create universal astronaut decision thresholds. |
| [NASA Open Science Data Repository (OSDR)](https://osdr.nasa.gov/) and its [public API](https://www.nasa.gov/osdr-api/) | Searchable study metadata and biological or biomedical files from spaceflight and analog research. Each study exposes its own variables and file formats. | Public catalog/API and downloadable study files; inspect each study's metadata, data dictionary, terms and access status. | No individual real-time health stream. Study cohorts, collection protocols, units and processing differ. ASTRA does not currently download OSDR files automatically. |
| [NASA GeneLab](https://genelab.nasa.gov/) | Space-biology and omics studies, with methods and measurements that depend on the experiment. | Public study and analysis resources; access and reuse details are study-specific. | Molecular data are research evidence, not wearable vital signs or individual clinical assessments. No GeneLab data are bundled. |
| [NASA Human Research Program](https://www.nasa.gov/hrp/) and its [risk catalog](https://www.nasa.gov/hrp/risks/) | Research context for cardiovascular adaptation, sleep, behavioral health, immune changes, radiation, bone and musculoskeletal changes, among other human-spaceflight risks. | Public program and evidence summaries; not a measurement feed. | Topics help organize ASTRA pages but do not establish diagnosis, an individual baseline or a sensor limit. |
| [NASA-STD-3001 Volume 2](https://standards.nasa.gov/node/237) and [NASA environmental-system reference](https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2/) | Human-system and environmental requirements include context for temperature, humidity, cabin pressure, ventilation, oxygen and carbon dioxide partial pressures, particulates and contaminants. | Standards and reference material are publicly available; an operational limit depends on the active mission configuration and approved policy. | ASTRA does not encode standards as generic alert thresholds or control spacecraft systems. The environmental module displays source values and source-local statistical shifts. |
| [NASA Environmental Control and Life Support Systems (ECLSS)](https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss/) | System context for cabin pressure, fire detection, oxygen, ventilation, water and waste; air revitalization includes carbon-dioxide removal. | Public engineering overview; not a sensor dataset. | Does not provide ASTRA with live environmental values or device interfaces. |

## Non-astronaut clinical comparison data

| Source | Measurements | Access and units | Limits |
| --- | --- | --- | --- |
| [PhysioNet MIT-BIH Arrhythmia Database](https://physionet.org/content/mitdb/) | Annotated ambulatory electrocardiogram waveform records and beat annotations. | Research files are distributed by PhysioNet; consult its current terms and record documentation for sampling and units. | Terrestrial clinical recordings, not astronaut-specific. Not bundled with ASTRA and not used to claim spaceflight physiology. |

## Potential health-app integrations

| Provider | Current integration path | Permission and implementation boundary |
| --- | --- | --- |
| [Apple HealthKit](https://developer.apple.com/documentation/Xcode/configuring-healthkit-access) | Requires an iOS companion app with HealthKit capability. | Users grant access by data type; the browser-only ASTRA app cannot read HealthKit directly. |
| [Android Health Connect](https://developer.android.com/health-and-fitness/health-connect) | Requires an Android companion app and Health Connect permissions. | Records include time, time zone, units and source metadata; this repository has no Android connector. |
| [Garmin Health API](https://developer.garmin.com/gc-developer-program/health-api/) | Provider program for authorized health data. | Developer/partner enrollment and user authorization are required. No credentials or connector are configured. |
| [Fitbit Web API](https://dev.fitbit.com/build/reference/web-api/) | Authorized per-user API access to activity, heart-rate and related tracker records. | OAuth access and the provider's current API scopes/terms are required. No OAuth client is configured. |
| [Oura API v2](https://cloud.ouraring.com/v2/docs) | OAuth scopes expose heart-rate time series and daily sleep, activity and readiness summaries. | Register an API application and request consent/scopes. Personal access tokens were deprecated; no Oura integration is configured. |
| [Samsung Health Data SDK](https://developer.samsung.com/health/data/guide/introduction.html) | Native Android SDK can read selected records such as heart rate, activity and sleep from Samsung Health. | Requires a native Android app, supported devices/app version and user permission; distribution and some operations have provider-specific partner requirements. No browser connector is present. |
| [WHOOP API](https://developer.whoop.com/api/) | OAuth scopes include recovery (HRV and resting heart rate), sleep, cycle and workout summaries. | A provider API application, OAuth consent and selected scopes are required. No credentials or connector are configured. |

## ASTRA's current data contract

- **Simulation:** four fictional crew profiles with generated health, radiation, environment and equipment values, marked `SIMULATED` and stored separately.
- **Connected:** manually imported health readings and authorized records, labeled with a source, timestamp and quality. Apple HealthKit, Android Health Connect, Garmin, Fitbit, Oura, Samsung Health and WHOOP require their provider-approved native app, OAuth or partner paths; none are active in this web-only build.
- **Research:** imported health-shaped CSV/JSON rows kept apart from simulation and connected rows. The importer does not infer missing values, convert unknown units or establish a study-specific calibration.
- **Environment/equipment:** the backend accepts registered sources and timestamped readings. Seed data are synthetic; the UI's registration/sample controls are manual records, not hardware links.
- **Health module coverage:** heart rate, HRV, SpO₂, respiratory rate, temperature, activity index and sleep duration are the current health schema. Immune assays, bone-density scans, ECG waveforms, sleep stages, radiation dosimeters and mission hardware streams are unavailable unless a permitted source is supplied through an explicitly supported workflow.

Before reusing a study, preserve the study identifier, population, method, source units, time zone, data dictionary, access terms and limitations. Do not compare measurements from incompatible devices or protocols without an approved conversion and validation process.
