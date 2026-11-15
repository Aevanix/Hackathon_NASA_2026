const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const phases = [
  ['countdown','Countdown'],['liftoff','Liftoff'],['ascent','Ascent'],['stage-separation','Stage separation'],
  ['orbit-insertion','Orbit insertion'],['on-orbit','On orbit'],['entry','Entry'],['landing','Landing']
];
const fmt = (value, digits = 2) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined,{maximumFractionDigits:digits});
const age = (time) => {
  if (!time) return 'No timestamp';
  const minutes = Math.max(0,Math.round((Date.now()-new Date(time).getTime())/60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes/60)} h ago`;
};
const freshness = (time) => !time ? 'NO DATA' : Date.now()-new Date(time).getTime()>15*60_000 ? 'STALE' : 'FRESH';

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
  const sensors = environmental.sensors || [];
  const records = sensors.map((sensor) => ({ sensor, reading: sensor.history?.at(-1) }));
  const latestPhaseSample = records.map(({reading})=>reading).filter(Boolean).sort((a,b)=>String(b.recordedAt).localeCompare(String(a.recordedAt)))[0];
  const sourcePhase = latestPhaseSample?.source?.match(/launch rehearsal · ([^·]+)/i)?.[1]?.trim().toLowerCase();
  const activePhase = phase || (phases.some(([id])=>id===sourcePhase) ? sourcePhase : '');
  const selectedPhaseLabel = phases.find(([id])=>id===activePhase)?.[1] || 'Awaiting phase event';
  const getSensor = (metric) => records.find((item)=>item.sensor.metric===metric) || {};
  const sensorCard = (label, metric, precision = 2) => {
    const {sensor,reading} = getSensor(metric);
    const state = freshness(reading?.recordedAt);
    const history = sensor?.history || [];
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

export function drawLiveTelemetry({ environmental = {}, equipment = {}, radiation = [] }) {
  const sensors = environmental.sensors || [];
  const sensorRows = sensors.map((sensor) => {
    const latest = sensor.history?.at(-1);
    const samples = sensor.history || [];
    return `<tr><td>${esc(sensor.name)}<br><span class="muted">${esc(sensor.metric)}</span></td><td>${fmt(latest?.value,3)} ${esc(latest?.unit||sensor.unit)}</td><td>${esc(age(latest?.recordedAt))}</td><td>${esc(latest?.source||sensor.source)}${latest?.simulated?' · SIMULATED':''}</td><td>${samples.length} stored</td></tr>`;
  }).join('');
  const devices = equipment.equipment || [];
  const deviceRows = devices.map((device)=>`<tr><td>${esc(device.name)}</td><td>${esc(device.status)}</td><td>${fmt(device.batteryPercent,1)}%</td><td>${fmt(device.temperatureC,1)} °C</td><td>${esc(age(device.lastSeenAt))}</td><td>${esc(device.source)}${device.simulated?' · SIMULATED':''}</td></tr>`).join('');
  const latestRadiation = radiation[0];
  return `<section class="card live-streams"><div class="card-title-row"><div><h2 class="card-title">Other incoming telemetry</h2><div class="card-kicker">Environmental, equipment and dosimeter feeds refresh with the health stream.</div></div></div>
    <h3 class="live-stream-title">Cabin and suit sensors</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Source</th><th>Latest reading</th><th>Freshness</th><th>Provenance</th><th>History</th></tr></thead><tbody>${sensorRows||'<tr><td colspan="5" class="muted">No environmental feed is available for this astronaut in the selected data view.</td></tr>'}</tbody></table></div>
    <h3 class="live-stream-title">Wearables and equipment</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Device</th><th>Status</th><th>Battery</th><th>Temperature</th><th>Freshness</th><th>Source</th></tr></thead><tbody>${deviceRows||'<tr><td colspan="6" class="muted">No equipment feed is available in this data view.</td></tr>'}</tbody></table></div>
    <h3 class="live-stream-title">Radiation dosimeter</h3><div class="checklist"><div class="check-item"><span>Latest dose rate</span><b>${latestRadiation?fmt(latestRadiation.value,5)+' '+esc(latestRadiation.unit):'No dosimeter reading'}</b></div><div class="check-item"><span>Cumulative dose</span><b>${latestRadiation?fmt(latestRadiation.cumulative,4)+' mSv':'—'}</b></div><div class="check-item"><span>Timestamp / source</span><b>${latestRadiation?esc(age(latestRadiation.recorded_at))+' · '+esc(latestRadiation.source)+(latestRadiation.simulated?' · SIMULATED':''):'No source data'}</b></div></div>
    <p class="footer-note">Only imported or connected source records are operational telemetry. Demo records are explicitly labeled simulated; values may be stale or absent.</p></section>`;
}
