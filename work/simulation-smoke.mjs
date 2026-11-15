import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dbPath = resolve(root, 'work/astra-simulation-smoke.sqlite');
const port = await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port: selected } = probe.address();
    probe.close((error) => error ? reject(error) : resolvePort(selected));
  });
});
const geminiAttempts=[];
const geminiMock=createHttpServer((req,res)=>{
  const authorization=req.headers.authorization;
  geminiAttempts.push(authorization==='Bearer smoke-primary'?'primary':authorization==='Bearer smoke-secondary'?'secondary':'unexpected');
  if(authorization==='Bearer smoke-primary'){res.writeHead(429,{'Content-Type':'application/json'});return res.end('{"error":"quota"}');}
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:'Gemini secondary-key fallback succeeded.'}}]}));
});
await new Promise((resolveListen,reject)=>{geminiMock.once('error',reject);geminiMock.listen(0,'127.0.0.1',resolveListen);});
const geminiPort=geminiMock.address().port;
const child = spawn(process.execPath, ['backend/server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', ASTRA_DB_PATH: dbPath, JWT_SECRET: randomBytes(48).toString('base64url'), ASTRA_GEMINI_API_KEY:'smoke-primary', ASTRA_GEMINI_API_KEY_2:'smoke-secondary', ASTRA_LLM_BASE_URL:`http://127.0.0.1:${geminiPort}/v1`, ASTRA_LLM_MODEL:'gemini-smoke-model' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverOutput = '';
child.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
const base = `http://127.0.0.1:${port}`;
let token;
async function request(path, { method = 'GET', body, dataMode = 'simulation' } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-ASTRA-DATA-MODE': dataMode, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path} returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
async function expectFailure(path, { method = 'POST', body, dataMode = 'simulation' } = {}, status) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-ASTRA-DATA-MODE': dataMode, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${path} expected ${status}, received ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
let session;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}`);
    try { if ((await fetch(`${base}/api/healthz`)).ok) { ready = true; break; } } catch {}
    await wait(200);
  }
  assert.ok(ready, `isolated server did not become ready: ${serverOutput}`);
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'admin@astra.local', password: 'Demo123!' } });
  token = login.accessToken;
  assert.ok(token, 'login did not return an access token');
  const assistant = await request('/api/assistant/chat', { method:'POST', body:{ astronautId:'AST-001', message:'What is my heart rate?' } });
  assert.equal(assistant.answer,'Gemini secondary-key fallback succeeded.','assistant should retry with the second server-side key after quota response');
  assert.deepEqual(geminiAttempts,['primary','secondary'],'Gemini key attempts should stay ordered and server-side');
  const assignedEquipment = await request('/api/equipment?astronautId=AST-001');
  const cycle = assignedEquipment.equipment.find((device) => device.id === 'EQ-AST-001-CYCLE');
  assert.deepEqual(cycle.signalProfile, ['heartRate','activityLevel'], 'exercise equipment exposes only its mapped health channels');
  const sample = await request('/api/health/readings', { method:'POST', body:{ astronautId:'AST-001', equipmentId:cycle.id, heartRate:112, activityLevel:.75, hrv:null, spo2:null, respiratoryRate:null, temperature:null, sleepDuration:null, allowSingle:true, recordedAt:'2026-11-15T17:00:00+05:30', source:'Equipment mapping smoke check', simulated:true, dataClass:'simulation' } });
  assert.equal(sample.reading.equipmentId, cycle.id, 'saved health sample keeps its assigned equipment ID');
  assert.equal(sample.reading.recordedAt, '2026-11-15T11:30:00.000Z', 'offset timestamp is normalized to UTC');
  const linkedEquipment = await request('/api/equipment?astronautId=AST-001');
  assert.ok(linkedEquipment.equipment.find((device) => device.id === cycle.id).healthReadings.some((row) => row.id === sample.reading.id), 'equipment detail returns its linked health sample');
  await expectFailure('/api/health/readings', { body:{ astronautId:'AST-001', equipmentId:cycle.id, heartRate:80, spo2:98, allowSingle:true, source:'Unsupported channel smoke check', simulated:true, recordedAt:'2026-11-15T17:00:00+05:30' } }, 422);
  await expectFailure('/api/health/readings', { body:{ astronautId:'AST-002', equipmentId:cycle.id, heartRate:80, allowSingle:true, source:'Assignment smoke check', simulated:true, recordedAt:'2026-11-15T17:00:00+05:30' } }, 422);
  await expectFailure('/api/health/readings', { body:{ astronautId:'AST-001', equipmentId:cycle.id, heartRate:80, allowSingle:true, source:'Timezone smoke check', simulated:true, recordedAt:'2026-11-15T17:00:00' } }, 422);
  const createdMission = await request('/api/admin/missions', { method:'POST', body:{ designation:'ASTRA QA Mission ' + Date.now(), startDate:new Date().toISOString().slice(0,10), durationDays:45, status:'planned' } });
  const missions = await request('/api/admin/missions');
  assert.ok(missions.some((mission)=>mission.id===createdMission.id),'new mission was not available to astronaut assignment options');
  const officers = (await request('/api/admin/users')).filter((user) => user.role === 'medical_officer' && user.active);
  assert.ok(missions.length && officers.length, 'astronaut form option data is missing');
  const astronaut = await request('/api/astronauts', { method: 'POST', body: { id: `AST-QA-${Date.now()}`, name: 'Smoke Test Astronaut', missionId: createdMission.id, medicalOfficerId: officers[0].id } });
  assert.equal(astronaut.missionId, createdMission.id);
  assert.equal(astronaut.medicalOfficerId, officers[0].id);
  const profile = await request(`/api/astronauts/${astronaut.id}`);
  assert.equal(profile.baselineSource, 'synthetic demonstration baseline');
  await request(`/api/astronauts/${astronaut.id}`, { method: 'PUT', body: { archive: true } });
  session = await request('/api/simulation/start', { method: 'POST', body: { astronautId: 'AST-001', intervalMs: 500, speed: 1 } });
  assert.equal(session.status, 'running');
  const cases = [
    ['normal', (row) => row.heartRate !== null && row.dataClass === 'simulation'],
    ['elevated_heart_rate', (row) => row.heartRate >= 117],
    ['reduced_spo2', (row) => row.spo2 >= 87 && row.spo2 <= 90],
    ['sleep_deprivation', (row) => row.sleepDuration >= 2 && row.sleepDuration <= 2.8],
    ['sensor_malfunction', (row) => row.dataQuality === 'faulty'],
    ['recovery', (row) => row.dataQuality === 'good'],
  ];
  for (const [scenario, validate] of cases) {
    session = await request('/api/simulation/scenario', { method: 'POST', body: { astronautId: 'AST-001', scenario, intervalMs: 500 } });
    await wait(700);
    const latest = await request('/api/health/AST-001');
    assert.equal(latest.reading?.simulated, true, `${scenario}: reading is not marked simulated`);
    assert.ok(validate(latest.reading), `${scenario}: expected telemetry not generated: ${JSON.stringify(latest.reading)}`);
  }
  for (const [scenario, metric, validate] of [
    ['environment_temperature_change', 'temperature', (value) => value > 26],
    ['environment_co2_change', 'co2_partial_pressure', (value) => value > 0.8],
  ]) {
    await request('/api/simulation/scenario', { method: 'POST', body: { astronautId: 'AST-001', scenario, intervalMs: 500 } });
    await wait(700);
    const environment = await request('/api/environment?astronautId=AST-001');
    const sensor = environment.sensors.find((item) => item.metric === metric);
    assert.ok(sensor?.history.at(-1)?.simulated, `${scenario}: environment sample is not labeled simulated`);
    assert.ok(validate(sensor.history.at(-1).value), `${scenario}: expected environment change not observed`);
  }
  const launchPhases = ['countdown','liftoff','ascent','stage-separation','orbit-insertion','on-orbit','entry','landing'];
  for (const phase of launchPhases) {
    const snapshot = await request('/api/simulation/launch-phase', { method:'POST', body:{ astronautId:'AST-001', phase } });
    assert.equal(snapshot.phase, phase, `${phase}: phase identifier was not preserved`);
    assert.equal(snapshot.readings.length, 12, `${phase}: expected all health/environment launch channels`);
    assert.ok(snapshot.readings.every((reading)=>Boolean(reading.simulated)&&reading.data_class==='simulation'), `${phase}: samples must stay labeled synthetic`);
  }
  const launchEnvironment = await request('/api/environment?astronautId=AST-001');
  for (const metric of ['acceleration_g','vibration_rms_g','vehicle_altitude_km','vehicle_velocity_km_s','suit_pressure','suit_temperature','radiation_dose_rate']) {
    const sensor = launchEnvironment.sensors.find((item)=>item.metric===metric);
    assert.ok(sensor?.history.at(-1)?.source.includes('launch rehearsal'), `${metric}: latest launch sample was not persisted`);
  }
  const offTopic = await request('/api/assistant/chat', { method:'POST', body:{ astronautId:'AST-001', message:'What is the capital of Mars?' } });
  assert.equal(offTopic.provider,'scope-guard','off-topic assistant question must be refused before provider use');
  const simulationGuard = await fetch(`${base}/api/simulation/launch-phase`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}`, 'X-ASTRA-DATA-MODE':'connected' }, body:JSON.stringify({astronautId:'AST-001',phase:'ascent'}) });
  assert.equal(simulationGuard.status,409,'launch rehearsal must not write synthetic samples into connected mode');
  await request('/api/simulation/scenario', { method: 'POST', body: { astronautId: 'AST-001', scenario: 'equipment_overheating', intervalMs: 500 } });
  await wait(700);
  const equipment = await request('/api/equipment?astronautId=AST-001');
  const wearable = equipment.equipment.find((item) => item.category === 'wearable');
  assert.ok(wearable?.readings.some((item) => item.metric === 'temperature' && item.value > 45 && item.simulated), 'overheating scenario did not persist synthetic wearable temperature');
  await request('/api/simulation/scenario', { method: 'POST', body: { astronautId: 'AST-001', scenario: 'wearable_disconnection', intervalMs: 500 } });
  await wait(700);
  const disconnected = await request('/api/equipment?astronautId=AST-001');
  assert.equal(disconnected.equipment.find((item) => item.category === 'wearable')?.status, 'disconnected');
  await request('/api/simulation/scenario', { method: 'POST', body: { astronautId: 'AST-001', scenario: 'normal', intervalMs: 500 } });
  await wait(700);
  const restored = await request('/api/equipment?astronautId=AST-001');
  assert.equal(restored.equipment.find((item) => item.category === 'wearable')?.status, 'operational');
  const pause = await request('/api/simulation/pause', { method: 'POST', body: { astronautId: 'AST-001' } });
  assert.equal(pause.status, 'paused');
  const resume = await request('/api/simulation/resume', { method: 'POST', body: { astronautId: 'AST-001' } });
  assert.equal(resume.status, 'running');
  console.log(`Simulation smoke passed: ${cases.length + 5} health/environment/equipment scenarios, ${launchPhases.length} launch phases, equipment-channel and astronaut assignment checks, timezone validation, off-topic AI guard and connected-mode guard; data persisted to isolated SQLite and remained labeled synthetic.`);
} finally {
  if (session && child.exitCode === null) {
    try { await request('/api/simulation/stop', { method: 'POST', body: { astronautId: 'AST-001' } }); } catch {}
  }
  if (child.exitCode === null) child.kill();
  geminiMock.close();
}
