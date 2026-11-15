import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID, scryptSync } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = resolve(root, 'data');
mkdirSync(dataDir, { recursive: true });

function readEnvFile() {
  try {
    for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
}
readEnvFile();
export const dbPath = resolve(root, process.env.ASTRA_DB_PATH || './data/astra.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec(readFileSync(resolve(root, 'backend/schema.sql'), 'utf8'));
// Add provenance flags to databases created by earlier prototype versions.
for (const [table, column, definition] of [
  ['anomaly_predictions', 'simulated', 'INTEGER NOT NULL DEFAULT 1'],
  ['anomaly_predictions', 'data_class', "TEXT NOT NULL DEFAULT 'connected'"],
  ['health_alerts', 'simulated', 'INTEGER NOT NULL DEFAULT 0'],
  ['health_alerts', 'data_class', "TEXT NOT NULL DEFAULT 'connected'"],
  ['health_readings', 'data_class', "TEXT NOT NULL DEFAULT 'connected'"],
  ['radiation_readings', 'data_class', "TEXT NOT NULL DEFAULT 'connected'"],
  ['wellness_assessments', 'simulated', 'INTEGER NOT NULL DEFAULT 0'],
  ['wellness_assessments', 'data_class', "TEXT NOT NULL DEFAULT 'self_report'"],
  ['environmental_sensors', 'created_at', "TEXT NOT NULL DEFAULT ''"],
  ['equipment', 'created_at', "TEXT NOT NULL DEFAULT ''"],
]) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
db.exec(`UPDATE environmental_sensors SET created_at=COALESCE(NULLIF(created_at,''),last_seen_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE created_at='';
  UPDATE equipment SET created_at=COALESCE(NULLIF(created_at,''),last_seen_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE created_at='';`);
db.exec(`UPDATE anomaly_predictions SET simulated=1 WHERE features_json LIKE '%"simulated":true%' OR features_json LIKE '%"simulated":1%';
  UPDATE health_alerts SET simulated=1 WHERE measurement_json LIKE '%"simulated":true%' OR measurement_json LIKE '%"simulated":1%';`);
for (const table of ['health_readings','radiation_readings','health_alerts','anomaly_predictions']) {
  db.exec(`UPDATE ${table} SET data_class='simulation' WHERE simulated=1 AND data_class='connected'`);
}
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000;');

export const nowIso = () => new Date().toISOString();
export const publicAstronaut = (row) => row && ({
  id: row.id, name: row.name, missionId: row.mission_id,
  missionDesignation: row.mission_designation, missionStartDate: row.mission_start_date,
  missionDurationDays: row.mission_duration_days, medicalOfficerId: row.medical_officer_id,
  monitoringStatus: row.monitoring_status, archived: Boolean(row.archived), createdAt: row.created_at,
});

const roles = ['astronaut', 'medical_officer', 'admin'];
for (const role of roles) db.prepare('INSERT OR IGNORE INTO roles(name) VALUES (?)').run(role);

function passHash(password) {
  const salt = 'astra-demo-salt-v1';
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const timestamp = nowIso();
db.prepare(`INSERT OR IGNORE INTO missions(id,designation,status,start_date,duration_days,created_at)
  VALUES(?,?,?,?,?,?)`).run('MISSION-01', 'ORBITAL-7', 'active', timestamp.slice(0, 10), 180, timestamp);

const astronauts = [
  ['AST-001', 'Maya Chen', 'ORBITAL-7', 72, 63, 97, 16, 36.7, 6.8],
  ['AST-002', 'Jonah Reyes', 'ORBITAL-7', 66, 48, 97, 14, 36.6, 7.4],
  ['AST-003', 'Amara Okafor', 'ORBITAL-7', 74, 58, 98, 17, 36.8, 7.0],
  ['AST-004', 'Luca Moretti', 'ORBITAL-7', 69, 52, 97, 15, 36.5, 7.2],
];

const officerId = 'USER-MEDICAL-01';
db.prepare(`INSERT OR IGNORE INTO users(id,email,full_name,password_hash,role_id,astronaut_id,active,created_at)
  VALUES(?,?,?,?,(SELECT id FROM roles WHERE name=?),?,?,?)`).run('USER-ADMIN-01', 'admin@astra.local', 'Mission Administrator', passHash('Demo123!'), 'admin', null, 1, timestamp);
db.prepare(`INSERT OR IGNORE INTO users(id,email,full_name,password_hash,role_id,astronaut_id,active,created_at)
  VALUES(?,?,?,?,(SELECT id FROM roles WHERE name=?),?,?,?)`).run(officerId, 'medical@astra.local', 'Dr. Samira Patel', passHash('Demo123!'), 'medical_officer', null, 1, timestamp);

const insertAstronaut = db.prepare(`INSERT OR IGNORE INTO astronauts
  (id,name,mission_id,mission_designation,mission_start_date,mission_duration_days,medical_officer_id,monitoring_status,created_at)
  VALUES(?,?,'MISSION-01',?,?,?,?, 'active',?)`);
const insertUser = db.prepare(`INSERT OR IGNORE INTO users(id,email,full_name,password_hash,role_id,astronaut_id,active,created_at)
  VALUES(?,?,?,?,(SELECT id FROM roles WHERE name='astronaut'),?,1,?)`);
const insertBase = db.prepare('INSERT OR IGNORE INTO health_baselines(astronaut_id,baseline_json,source,updated_at) VALUES(?,?,?,?)');
const insertReading = db.prepare(`INSERT OR IGNORE INTO health_readings
  (client_id,astronaut_id,heart_rate,hrv,spo2,respiratory_rate,temperature,activity_level,sleep_duration,recorded_at,source,data_quality,simulated,data_class)
  VALUES(?,?,?,?,?,?,?,?,?,?,'SIMULATED • ASTRA seed dataset','good',1,'simulation')`);
const insertSleep = db.prepare('INSERT INTO sleep_records(astronaut_id,duration_hours,quality_score,recorded_at,source,simulated) VALUES(?,?,?,?,?,1)');
const insertActivity = db.prepare('INSERT INTO activity_records(astronaut_id,active_minutes,activity_level,recorded_at,source,simulated) VALUES(?,?,?,?,?,1)');
const insertRadiation = db.prepare("INSERT INTO radiation_readings(astronaut_id,value,unit,cumulative,recorded_at,source,simulated,data_class) VALUES(?,?,?,?,?,?,1,'simulation')");
const hasSeededReadings = Boolean(db.prepare("SELECT 1 FROM health_readings WHERE source='SIMULATED • ASTRA seed dataset' LIMIT 1").get());
const seedEnvironment = !db.prepare('SELECT 1 FROM environmental_readings LIMIT 1').get();
const seedEquipment = !db.prepare('SELECT 1 FROM equipment_readings LIMIT 1').get();
const insertSensor = db.prepare(`INSERT OR IGNORE INTO environmental_sensors(id,mission_id,astronaut_id,name,metric,location,unit,status,source,simulated,data_class,last_seen_at)
  VALUES(?,'MISSION-01',?,?,?,?,?,'active','SIMULATED • ASTRA cabin model',1,'simulation',?)`);
const insertEnvReading = db.prepare(`INSERT OR IGNORE INTO environmental_readings(client_id,sensor_id,mission_id,astronaut_id,metric,value,unit,recorded_at,source,data_quality,simulated,data_class)
  VALUES(?,?,'MISSION-01',?,?,?,?,?,'SIMULATED • ASTRA cabin model','good',1,'simulation')`);
const insertEquipment = db.prepare(`INSERT OR IGNORE INTO equipment(id,mission_id,astronaut_id,name,category,serial_number,status,battery_percent,temperature_c,source,simulated,data_class,last_seen_at,maintenance_note)
  VALUES(?,'MISSION-01',?,?,?,?,?,?,?,?,1,'simulation',?,?)`);
const insertEquipmentReading = db.prepare(`INSERT OR IGNORE INTO equipment_readings(client_id,equipment_id,metric,value,unit,recorded_at,source,data_quality,simulated,data_class)
  VALUES(?,?,?,?,?,?,'SIMULATED • ASTRA equipment model','good',1,'simulation')`);

for (const [id, name, mission, hr, hrv, spo2, rr, temp, sleep] of astronauts) {
  insertAstronaut.run(id, name, mission, timestamp.slice(0, 10), 180, officerId, timestamp);
  insertUser.run(`USER-${id}`, `${id.toLowerCase()}@astra.local`, name, passHash('Demo123!'), id, timestamp);
  const baseline = { heart_rate: hr, hrv, spo2, respiratory_rate: rr, temperature: temp, activity_level: 0.62, sleep_duration: sleep };
  insertBase.run(id, JSON.stringify(baseline), 'synthetic demonstration baseline', timestamp);
  const seed = createHash('sha256').update(id).digest().readUInt32BE(0);
  if (!hasSeededReadings) for (let i = 35; i >= 0; i--) {
    const wobble = (field, scale) => Math.sin((i + seed % 17) * (field + 1) * 0.29) * scale + Math.cos((i + field) * 0.11) * scale * 0.4;
    const recordedAt = new Date(Date.now() - i * 60 * 60 * 1000).toISOString();
    const values = [
      +(hr + wobble(0, 2.5)).toFixed(1), +(hrv + wobble(1, 3)).toFixed(1),
      +(spo2 + wobble(2, 0.7)).toFixed(1), +(rr + wobble(3, 1.2)).toFixed(1),
      +(temp + wobble(4, 0.15)).toFixed(2), +(0.55 + wobble(5, 0.12)).toFixed(2),
      +(sleep + wobble(6, 0.35)).toFixed(1), recordedAt,
    ];
    insertReading.run(`seed-${id}-${i}`, id, ...values);
    if (i % 12 === 0) {
      insertSleep.run(id, values[6], Math.max(1, Math.min(5, +(3.7 + wobble(2, 0.7)).toFixed(1))), recordedAt, 'SIMULATED • ASTRA seed dataset');
      insertActivity.run(id, +(32 + wobble(3, 12)).toFixed(1), values[5], recordedAt, 'SIMULATED • ASTRA seed dataset');
      const radiation = +(0.018 + Math.abs(wobble(5, 0.006))).toFixed(4);
      const cumulative = +(0.24 + (35 - i) * 0.018 + seed % 10 / 1000).toFixed(3);
      insertRadiation.run(id, radiation, 'mSv/day', cumulative, recordedAt, 'SIMULATED • ASTRA seed dataset');
    }
  }
  if (seedEnvironment) {
    const metrics = [
      ['temperature','Cabin temperature','habitat cabin','°C',22.0,.35],
      ['relative_humidity','Cabin relative humidity','habitat cabin','% RH',45,1.8],
      ['cabin_pressure','Cabin pressure','habitat cabin','kPa',101.3,.25],
      ['oxygen_partial_pressure','Oxygen partial pressure','habitat cabin','kPa',21.2,.18],
      ['co2_partial_pressure','Carbon dioxide partial pressure','habitat cabin','kPa',.40,.035],
    ];
    for (const [metric,name,location,unit,center,spread] of metrics) {
      const sensorId=`ENV-${id}-${metric.toUpperCase()}`;
      insertSensor.run(sensorId,id,name,metric,location,unit,timestamp);
      for (let i=35;i>=0;i--) {
        const recordedAt=new Date(Date.now()-i*60*60*1000).toISOString();
        const value=+(center+Math.sin((i+seed%9)*.43)*spread+Math.cos((i+3)*.19)*spread*.35).toFixed(3);
        insertEnvReading.run(`env-seed-${id}-${metric}-${i}`,sensorId,id,metric,value,unit,recordedAt);
      }
    }
  }
  if (seedEquipment) {
    const devices=[
      [`EQ-${id}-WEARABLE`,'Crew health wearable','wearable',`WEAR-${id}`,86,31.5],
      [`EQ-${id}-CYCLE`,'Exercise cycle ergometer','exercise equipment',`CYCLE-${id}`,100,34.0],
    ];
    for (const [equipmentId,name,category,serial,battery,temperature] of devices) {
      insertEquipment.run(equipmentId,id,name,category,serial,'operational',battery,temperature,'SIMULATED • ASTRA equipment model',timestamp,'Demonstration device; operating limits are not mission-qualified.');
      for (let i=35;i>=0;i--) {
        const recordedAt=new Date(Date.now()-i*60*60*1000).toISOString();
        const batteryValue=+(battery-(35-i)*.035+Math.sin(i*.4)*.4).toFixed(1);
        const tempValue=+(temperature+Math.sin((i+seed%7)*.37)*.7+Math.cos(i*.13)*.25).toFixed(2);
        insertEquipmentReading.run(`equipment-seed-${equipmentId}-${i}-battery`,equipmentId,'battery_percent',batteryValue,'% battery',recordedAt);
        insertEquipmentReading.run(`equipment-seed-${equipmentId}-${i}-temperature`,equipmentId,'temperature',tempValue,'°C',recordedAt);
      }
    }
  }
}

const sourceInsert = db.prepare('INSERT OR IGNORE INTO data_sources(id,name,source_type,description,created_at) VALUES(?,?,?,?,?)');
sourceInsert.run(1, 'Astra local simulator', 'synthetic', 'Timestamped demo telemetry generated on this server.', timestamp);
sourceInsert.run(2, 'NASA Open Science Data Repository', 'research', 'External reference catalog; live import requires network access.', timestamp);
sourceInsert.run(3, 'PhysioNet MIT-BIH Arrhythmia Database', 'research', 'Terrestrial clinical ECG dataset; not astronaut-specific.', timestamp);
sourceInsert.run(4, 'NASA Human Research Program risk catalog', 'research', 'Official context for human-spaceflight health research areas; not individual measurements.', timestamp);

const knowledge = [
  ['NASA HRP: Human Research Program', 'https://www.nasa.gov/hrp/', 'spaceflight health', 'NASA Human Research Program describes research aimed at protecting crew health and performance during spaceflight. The program organizes risks and evidence to inform exploration missions. This local reference is a short catalog summary; consult the linked NASA page for current material.'],
  ['NASA Spaceflight Standard Measures', 'https://www.nasa.gov/humans-in-space/spaceflight-standard-measures-characterizing-how-humans-adapt-in-space/', 'human research measures', 'NASA Standard Measures support longitudinal research across analog and flight studies. Depending on the protocol, measures can include actigraphy and light exposure, sleep, cognition, selected blood or saliva immune and biochemical assays, microbiome, carotid imaging and sensorimotor testing. This is a study-measurement catalog, not a live personal health feed; instruments, units and schedules vary by study.'],
  ['NASA-STD-3001 Volume 2', 'https://standards.nasa.gov/node/237', 'human-system standards', 'NASA-STD-3001 Volume 2 contains human-system standards, including requirements related to environmental context. Operational interpretation depends on the current revision and mission configuration. ASTRA does not turn this standard into universal monitoring thresholds or spacecraft controls.'],
  ['NASA ECLSS', 'https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss/', 'environmental systems', 'NASA ECLSS describes spacecraft systems for pressure, fire detection, oxygen, ventilation, water and waste; air revitalization includes carbon-dioxide removal. This engineering overview does not provide ASTRA with live sensor values or device access.'],
  ['NASA HRP: Spaceflight risk catalog', 'https://www.nasa.gov/hrp/risks/', 'spaceflight health risks', 'NASA HRP groups identified spaceflight health risks across physiological, behavioral-performance, and radiation areas. Its current risk catalog includes cardiovascular adaptations, reduced cardiorespiratory and musculoskeletal fitness, spaceflight-induced bone changes, behavioral-health concerns, inadequate sleep and irregular schedules, and radiation-related risks. ASTRA uses these topics to organize separate monitoring and research modules; the page provides research context, not individual astronaut measurements or universal thresholds. Consult the source page for current risk descriptions.'],
  ['NASA OSDR: Open Science Data Repository', 'https://osdr.nasa.gov/', 'research data', 'NASA Open Science Data Repository provides access to biological and biomedical research data associated with spaceflight and analog studies. Dataset variables, methods, and limitations differ; inspect each study record before reuse.'],
  ['NASA GeneLab', 'https://genelab.nasa.gov/', 'space biology', 'NASA GeneLab supports analysis of space biology data and related omics datasets. These data are research observations and do not directly provide individual clinical assessments.'],
  ['ESA: Human and Robotic Exploration', 'https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration', 'spaceflight health', 'ESA human and robotic exploration materials cover exploration programs and research relevant to human spaceflight. This application does not treat general research summaries as individualized medical advice.'],
  ['PhysioNet: MIT-BIH Arrhythmia Database', 'https://physionet.org/content/mitdb/', 'ECG dataset', 'MIT-BIH Arrhythmia Database contains annotated ambulatory ECG recordings from a clinical population. It is terrestrial data and not astronaut-specific; differences in cohort and acquisition context limit direct transfer.'],
];
const docInsert = db.prepare(`INSERT OR IGNORE INTO knowledge_documents(id,title,source_url,category,content,ingested_at,source_type)
  VALUES(?,?,?,?,?,?,?)`);
for (const [title, url, category, content] of knowledge) {
  const id = `DOC-${createHash('sha1').update(url).digest('hex').slice(0, 12)}`;
  docInsert.run(id, title, url, category, content, timestamp, 'curated local reference');
}

export function audit(userId, action, entityType = null, entityId = null, metadata = {}) {
  db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)')
    .run(userId || null, action, entityType, entityId, JSON.stringify(metadata), nowIso());
}

export function baselineFor(astronautId) {
  const row = db.prepare('SELECT baseline_json FROM health_baselines WHERE astronaut_id=?').get(astronautId);
  return row ? JSON.parse(row.baseline_json) : null;
}

export function createId(prefix = 'ID') { return `${prefix}-${randomUUID()}`; }

