const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const phases = [
  ['countdown','Countdown'],['liftoff','Liftoff'],['ascent','Ascent'],['stage-separation','Stage separation'],
  ['orbit-insertion','Orbit insertion'],['on-orbit','On orbit'],['entry','Entry'],['landing','Landing']
];
const fmt = (value, digits = 2) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined,{maximumFractionDigits:digits});
const age = (time) => {
  if (!time) return 'No timestamp';
  const parsed = new Date(time).getTime();
  if (!Number.isFinite(parsed)) return 'Unknown timestamp';
  const minutes = Math.max(0,Math.round((Date.now()-parsed)/60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes/60)} h ago` : `${Math.floor(minutes/1440)} d ago`;
};
const freshness = (time) => {
  if (!time) return 'NO DATA';
  const parsed = new Date(time).getTime();
  return !Number.isFinite(parsed) ? 'UNKNOWN' : Date.now()-parsed>15*60_000 ? 'STALE' : 'FRESH';
};

export function drawMissionAccess({ missions = [], crew = [], isAdmin = false, missionDay }) {
  const items = missions.map((mission) => ({
    id: mission.id,
    designation: mission.designation,
    status: mission.status,
    start: mission.start || mission.start_date,
    duration: mission.duration ?? mission.duration_days,
    crew: crew.filter((person) => person.missionId === mission.id),
  }));
  const actions = isAdmin ? '<button class="btn" data-action="create-mission">＋ Add mission</button><button class="btn primary" data-action="create-astronaut">＋ Add astronaut</button>' : '';
  return `<div class="page-head"><div><div class="eyebrow">MISSION ACCESS</div><h1>Select a mission</h1><p>Choose an authorised mission workspace. Astronaut access remains limited to assigned records.</p></div><div class="head-actions">${actions}</div></div>
    <div class="grid mission-grid">${items.map((mission) => `<article class="card mission-card"><div class="eyebrow">${esc(mission.id)}</div><h2>${esc(mission.designation)}</h2><div class="checklist"><div class="check-item"><span>Status</span><b>${esc(mission.status||'planned')}</b></div><div class="check-item"><span>Mission day</span><b>${esc(missionDay(mission.crew[0]||{missionStartDate:mission.start,missionDesignation:mission.designation}))}</b></div><div class="check-item"><span>Start date</span><b>${esc(mission.start||'—')}</b></div><div class="check-item"><span>Planned duration</span><b>${esc(mission.duration??'—')} days</b></div><div class="check-item"><span>Authorised crew profiles</span><b>${mission.crew.length}</b></div></div><div class="form-actions"><button class="btn primary" data-action="mission-select" data-id="${esc(mission.id)}">Open mission crew →</button></div></article>`).join('')||'<div class="empty">No missions are assigned to this account.</div>'}</div>
    <div class="notice" data-u="u2">Flight day is calculated from the mission start date. The prototype does not infer mission phases or issue launch clearance.</div>`;
}

export function drawLaunch({ crew, environmental = {}, alerts = [], phase = '', role = '', mode = 'simulation', feedStatus = 'disconnected', missionDay }) {
  if (!crew) return '<div class="empty">No astronaut profile is available in this account scope.</div>';
  const sensors = Array.isArray(environmental.sensors) ? environmental.sensors : [];
  const records = sensors.map((sensor) => ({ sensor, reading: Array.isArray(sensor.history) ? sensor.history[sensor.history.length - 1] : undefined }));
  const latestPhaseSample = records.map(({reading})=>reading).filter(Boolean).sort((a,b)=>String(b.recordedAt).localeCompare(String(a.recordedAt)))[0];
  const sourcePhase = latestPhaseSample?.source?.match(/launch rehearsal · ([^·]+)/i)?.[1]?.trim().toLowerCase();
  const activePhase = phase || (phases.some(([id])=>id===sourcePhase) ? sourcePhase : '');
  const selectedPhaseLabel = phases.find(([id])=>id===activePhase)?.[1] || 'Awaiting phase event';
  const getSensor = (metric) => records.find((item)=>item.sensor.metric===metric) || {};
  const sensorCard = (label, metric, precision = 2) => {
    const {sensor,reading} = getSensor(metric);
    const state = freshness(reading?.recordedAt);
    const history = Array.isArray(sensor?.history) ? sensor.history : [];
    return `<article class="card launch-metric"><div class="launch-metric-top"><span class="stat-label">${esc(label)}</span><span class="source-chip"><i class="status-dot ${state==='STALE'?'amber':''}"></i>${state}</span></div><div class="metric-row"><span class="metric-big">${fmt(reading?.value,precision)}</span><span class="metric-unit">${esc(sensor?.unit||'')}</span></div><div class="baseline-note">${esc(sensor?.name||'No source registered')} · ${esc(age(reading?.recordedAt))}</div><div class="baseline-note">${esc(reading?.source||sensor?.source||'No telemetry received')}${reading?.simulated?' · SIMULATED':''}</div>${history.length ? `<details class="launch-history"><summary>Inspect ${history.length} stored samples</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>Recorded</th><th>Value</th><th>Quality</th><th>Source</th></tr></thead><tbody>${history.slice(-8).reverse().map((row)=>`<tr><td>${esc(new Date(row.recordedAt).toLocaleString())}</td><td>${fmt(row.value,precision)} ${esc(row.unit)}</td><td>${esc(row.dataQuality||'not supplied')}</td><td>${esc(row.source)}${row.simulated?' · SIM':''}</td></tr>`).join('')}</tbody></table></div></details>` : ''}</article>`;
  };
  const healthItems = [
    ['HEART RATE',crew.latest?.heartRate,'bpm'],['HEART RATE VARIABILITY',crew.latest?.hrv,'ms'],
    ['OXYGEN SATURATION',crew.latest?.spo2,'%'],['RESPIRATORY RATE',crew.latest?.respiratoryRate,'/min'],
    ['BODY TEMPERATURE',crew.latest?.temperature,'°C'],['SLEEP DURATION',crew.latest?.sleepDuration,'h']
  ];
  const healthCards = healthItems.map(([label,value,unit])=>`<article class="card launch-metric"><div class="launch-metric-top"><span class="stat-label">${label}</span><span class="source-chip"><i class="status-dot ${crew.stale?'amber':''}"></i>${crew.stale?'STALE':'FRESH'}</span></div><div class="metric-row"><span class="metric-big">${fmt(value,1)}</span><span class="metric-unit">${unit}</span></div><div class="baseline-note">${esc(crew.latest?.source||'No health feed connected')} · ${esc(age(crew.latest?.recordedAt))}${crew.latest?.simulated?' · SIMULATED':''}</div></article>`).join('');
  const envItems = [
    ['CABIN PRESSURE','cabin_pressure'],['CABIN TEMPERATURE','temperature'],['RELATIVE HUMIDITY','relative_humidity'],
    ['OXYGEN PARTIAL PRESSURE','oxygen_partial_pressure'],['CO₂ PARTIAL PRESSURE','co2_partial_pressure'],
    ['ACCELERATION','acceleration_g'],['VIBRATION RMS','vibration_rms_g'],['VEHICLE ALTITUDE','vehicle_altitude_km'],
    ['VEHICLE VELOCITY','vehicle_velocity_km_s'],['SUIT PRESSURE','suit_pressure'],['SUIT TEMPERATURE','suit_temperature'],
    ['RADIATION DOSE RATE','radiation_dose_rate']
  ];
  const openCount = alerts.filter((item)=>item.status==='open').length;
  const controls = ['admin','medical_officer'].includes(role)
    ? `<section class="card launch-controls"><div class="card-title-row"><div><h2 class="card-title">Phase snapshots</h2><div class="card-kicker">Each action writes a labeled synthetic telemetry sample through ASTRA's live feed.</div></div><div class="head-actions"><button class="btn primary" data-action="launch-sequence" ${mode!=='simulation'?'disabled title="Switch to Simulation mode first"':''}>▶ Run launch rehearsal</button><button class="btn ghost" data-action="launch-stop">Stop</button></div></div><div class="launch-phases">${phases.map(([id,label])=>`<button class="launch-phase ${id===activePhase?'active':''}" data-action="launch-phase" data-phase="${id}" ${mode!=='simulation'?'disabled title="Switch to Simulation mode first"':''}>${esc(label)}</button>`).join('')}</div><p class="footer-note">Demo envelope only. Values are synthetic and do not represent a vehicle-specific flight profile, validated limits, or launch clearance.${mode!=='simulation'?' Select Simulated Mission Mode to record rehearsal samples.':''}</p></section>`
    : '<section class="card launch-controls"><h2 class="card-title">Launch rehearsal is read-only</h2><p class="card-kicker">A mission administrator or medical officer can run labeled demonstration phases. No real vehicle controls are exposed.</p></section>';
  const liveLink = `/?view=live&astronaut=${encodeURIComponent(crew.id)}`;
  return `<div class="page-head"><div><div class="eyebrow">FLIGHT PHASE MONITORING</div><h1>Launch & ascent</h1><p>${esc(crew.name)} · ${esc(crew.missionDesignation)} · ${esc(missionDay(crew))} · phase: ${esc(selectedPhaseLabel)}</p></div><div class="head-actions"><a class="btn" href="${liveLink}" target="_blank" rel="noopener">Open live health monitor ↗</a></div></div>
    <div class="grid stats-grid">${[
      ['CREW DATA',freshness(crew.latest?.recordedAt),crew.latest?.source||'No health measurement received'],
      ['ENVIRONMENT SENSORS',String(sensors.length),`${records.filter(({reading})=>reading&&freshness(reading.recordedAt)==='FRESH').length} with fresh samples`],
      ['OPEN REVIEW ITEMS',String(openCount),'Review in Alert management'],
      ['LIVE FEED',feedStatus.toUpperCase(),mode==='simulation'?'Simulation data view':`${mode} data view`]
    ].map(([label,value,note])=>`<div class="card"><div class="stat-label">${esc(label)}</div><div class="metric-row"><span class="metric-big launch-stat-value">${esc(value)}</span></div><div class="baseline-note">${esc(note)}</div></div>`).join('')}</div>
    ${controls}
    <section class="card"><div class="card-title-row"><div><h2 class="card-title">Crew health measurements</h2><div class="card-kicker">Most recent authorized values; detail and trend history are available in the separate live monitor.</div></div><a class="link-button" href="${liveLink}" target="_blank" rel="noopener">Open full health record ↗</a></div><div class="grid launch-data-grid">${healthCards}</div></section>
    <section class="card"><div class="card-title-row"><div><h2 class="card-title">Vehicle, cabin & suit telemetry</h2><div class="card-kicker">NASA human-system guidance covers trendable environmental and suit data. No universal launch thresholds are assumed here.</div></div><a href="https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2/" target="_blank" rel="noopener">NASA reference ↗</a></div><div class="grid launch-data-grid">${envItems.map(([label,metric])=>sensorCard(label,metric,metric.includes('pressure')||metric==='temperature'?2:3)).join('')}</div>${sensors.length?'':'<div class="empty">No cabin or suit telemetry has been received for this astronaut in the selected data view.</div>'}</section>
    <section class="card"><h2 class="card-title">Data-readiness checks</h2><div class="checklist"><div class="check-item"><span>Health feed freshness</span><b>${freshness(crew.latest?.recordedAt)} · ${esc(age(crew.latest?.recordedAt))}</b></div><div class="check-item"><span>Environmental timestamps</span><b>${records.filter(({reading})=>reading&&freshness(reading.recordedAt)==='FRESH').length} fresh · ${records.filter(({reading})=>!reading).length} without samples</b></div><div class="check-item"><span>Alert review queue</span><b>${openCount} open item${openCount===1?'':'s'}</b></div><div class="check-item"><span>Telemetry classification</span><b>${mode==='simulation'?'Synthetic demo view':esc(mode)} · inspect source per reading</b></div></div><p class="footer-note">These checks describe data availability only. ASTRA does not issue a flight-ready or no-go decision.</p></section>`;
}

export function drawLiveTelemetry({ environmental = {}, equipment = {}, radiation = [] } = {}) {
  const sensors = Array.isArray(environmental.sensors) ? environmental.sensors : [];
  const devices = Array.isArray(equipment.equipment) ? equipment.equipment : [];
  const radiationRows = Array.isArray(radiation) ? radiation.slice(0, 12) : [];
  const recordClass = (record, fallback = '') => record?.simulated ? 'SIMULATED' : record?.dataClass || fallback || 'SOURCE NOT SPECIFIED';
  const sensorRows = sensors.map((sensor) => {
    const samples = Array.isArray(sensor.history) ? sensor.history : [];
    const latest = samples[samples.length - 1];
    const reading = latest ? `${fmt(latest.value,3)} ${esc(latest.unit || sensor.unit || '')}` : 'No sample received';
    const latestTime = latest?.recordedAt || sensor.lastSeenAt;
    return `<tr><td>${esc(sensor.name)}<br><span class="muted">${esc(sensor.metric)} · ${esc(sensor.location || 'location not supplied')}</span></td><td>${reading}</td><td>${esc(freshness(latestTime))} · ${esc(age(latestTime))}</td><td>${esc(latest?.dataQuality || 'not supplied')}</td><td>${esc(latest?.source || sensor.source || 'Not supplied')} · ${esc(recordClass(latest, sensor.dataClass))}</td><td>${samples.length} stored</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No environmental sensors or samples are available in this astronaut’s selected data view.</td></tr>';
  const deviceRows = devices.map((device) => {
    const samples = Array.isArray(device.readings) ? device.readings : [];
    const latest = samples[samples.length - 1];
    const lastSeen = latest?.recordedAt || device.lastSeenAt;
    const latestReading = latest
      ? `${esc(latest.metric)}: ${fmt(latest.value,2)} ${esc(latest.unit || '')}`
      : device.batteryPercent != null || device.temperature != null
        ? `Battery ${fmt(device.batteryPercent,1)}% · Device temperature ${fmt(device.temperature,1)} °C`
        : 'No sample received';
    return `<tr><td>${esc(device.name)}</td><td>${esc(device.category || 'Equipment')}</td><td>${esc(device.status || 'unknown')}</td><td>${latestReading}</td><td>${esc(freshness(lastSeen))} · ${esc(age(lastSeen))}</td><td>${esc(latest?.dataQuality || 'not supplied')} · ${esc(latest?.source || device.source || 'Not supplied')} · ${esc(recordClass(latest, device.dataClass))}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No equipment records are available in this astronaut’s selected data view.</td></tr>';
  const radiationMarkup = radiationRows.map((row) => {
    const recordedAt = row.recorded_at || row.recordedAt;
    return `<tr><td>${esc(recordedAt ? new Date(recordedAt).toLocaleString() : 'No timestamp')}</td><td>${fmt(row.value,5)} ${esc(row.unit || '')}</td><td>${fmt(row.cumulative,4)} mSv</td><td>${esc(age(recordedAt))}</td><td>${esc(row.source || 'Not supplied')} · ${esc(recordClass(row, row.data_class || row.dataClass))}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">No dosimeter readings are available in this astronaut’s selected data view.</td></tr>';
  return `<section class="card live-streams"><div class="card-title-row"><div><h2 class="card-title">Live environment, equipment and radiation streams</h2><div class="card-kicker">Latest received values, timestamps, quality and source labels. Missing values remain visible as missing.</div></div></div>
    <h3 class="live-stream-title">Environmental sensors</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Sensor / channel</th><th>Latest reading</th><th>Freshness</th><th>Quality</th><th>Source / data class</th><th>History</th></tr></thead><tbody>${sensorRows}</tbody></table></div>
    <h3 class="live-stream-title">Equipment and wearables</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Device</th><th>Category</th><th>Status</th><th>Latest reading</th><th>Freshness</th><th>Quality / source / class</th></tr></thead><tbody>${deviceRows}</tbody></table></div>
    <h3 class="live-stream-title">Dosimeter history</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Recorded</th><th>Dose rate</th><th>Cumulative dose</th><th>Age</th><th>Source / data class</th></tr></thead><tbody>${radiationMarkup}</tbody></table></div>
    <p class="footer-note">This view reports stored source records; it does not invent telemetry. Values may be missing, stale, synthetic, or research-classified. Check units and source details before interpreting measurements.</p></section>`;
}
