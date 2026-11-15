import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, baselineFor } from '../backend/db.mjs';
import { ANOMALY_THRESHOLD, evaluateModel, infer, modelStatus } from '../backend/ml.mjs';
import { retrieve } from '../backend/assistant.mjs';
import { MODULES } from '../frontend/modules/catalog.js';

test('seed data contains four fictional astronauts with plausible, individual references', () => {
  const astronauts = db.prepare('SELECT id FROM astronauts WHERE archived=0 ORDER BY id').all();
  assert.equal(astronauts.length, 4);
  const baseline = baselineFor('AST-001');
  assert.equal(baseline.spo2, 97);
  assert.equal(baseline.heart_rate, 72);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM health_readings WHERE source='SIMULATED • ASTRA seed dataset'").get().total, 144);
});

test('environment and equipment samples are preloaded, synthetic, and provenance separated', () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM environmental_sensors WHERE simulated=1 AND data_class='simulation'").get().total, 20);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM environmental_readings WHERE client_id LIKE 'env-seed-%' AND simulated=1 AND data_class='simulation'").get().total, 720);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM equipment WHERE simulated=1 AND data_class='simulation'").get().total, 8);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM equipment_readings WHERE client_id LIKE 'equipment-seed-%' AND simulated=1 AND data_class='simulation'").get().total, 576);
  assert.ok(db.prepare("SELECT COUNT(*) AS total FROM equipment WHERE astronaut_id='AST-001' AND category='wearable'").get().total > 0);
});

test('astronaut profile persistence follows the selected mission and creates its baseline', () => {
  const suffix = randomUUID().slice(0, 8), missionId = `M-${suffix}`, astronautId = `A-${suffix}`;
  db.exec('SAVEPOINT astronaut_create_test');
  try {
    db.prepare('INSERT INTO missions(id,designation,status,start_date,duration_days,created_at) VALUES(?,?,?,?,?,?)')
      .run(missionId, 'ORBITAL-TEST', 'planned', '2026-11-15', 240, new Date().toISOString());
    const mission = db.prepare('SELECT * FROM missions WHERE id=?').get(missionId);
    db.prepare(`INSERT INTO astronauts(id,name,mission_id,mission_designation,mission_start_date,mission_duration_days,medical_officer_id,monitoring_status,created_at)
      VALUES(?,?,?,?,?,?,?,'active',?)`).run(astronautId, 'Test Astronaut', mission.id, mission.designation, mission.start_date, mission.duration_days, null, new Date().toISOString());
    db.prepare('INSERT INTO health_baselines(astronaut_id,baseline_json,source,updated_at) VALUES(?,?,?,?)')
      .run(astronautId, JSON.stringify({ heart_rate: 70, spo2: 97 }), 'synthetic demonstration baseline', new Date().toISOString());
    const profile = db.prepare('SELECT * FROM astronauts WHERE id=?').get(astronautId);
    assert.equal(profile.mission_id, missionId);
    assert.equal(profile.mission_designation, 'ORBITAL-TEST');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM health_baselines WHERE astronaut_id=?').get(astronautId).total, 1);
  } finally {
    db.exec('ROLLBACK TO astronaut_create_test');
    db.exec('RELEASE astronaut_create_test');
  }
});

test('Isolation Forest scores a reference pattern as normal and corroborated deviations as unusual', () => {
  const baseline = baselineFor('AST-001');
  const time = new Date().toISOString();
  const normal = infer({ ...baseline, recorded_at: time }, baseline);
  const abnormal = infer({ ...baseline, heart_rate: 118, spo2: 88, respiratory_rate: 27, sleep_duration: 3, recorded_at: time }, baseline);
  assert.ok(normal.score >= 0 && normal.score <= 1);
  assert.equal(normal.riskCategory, 'NORMAL');
  assert.ok(abnormal.score >= ANOMALY_THRESHOLD);
  assert.equal(abnormal.anomaly, true);
  assert.ok(abnormal.deviations.length >= 3);
  assert.match(abnormal.explanation, /not medical probabilities/i);
});

test('incomplete measurements are explicitly marked low quality', () => {
  const result = infer({ heart_rate: 80 }, baselineFor('AST-001'));
  assert.equal(result.quality, 'incomplete');
  assert.equal(result.score, null);
  assert.equal(result.riskCategory, 'OBSERVATION');
});

test('model status and held-out synthetic evaluation are available and bounded', () => {
  const status = modelStatus();
  const evaluation = evaluateModel();
  assert.equal(status.modelKind, 'Isolation Forest');
  assert.equal(status.status, 'ready');
  assert.equal(status.trainingRows, 768);
  assert.equal(evaluation.heldOutRows, 480);
  assert.ok(evaluation.metrics.accuracy >= 0 && evaluation.metrics.accuracy <= 1);
  assert.ok(evaluation.metrics.precision >= 0 && evaluation.metrics.precision <= 1);
  assert.ok(evaluation.metrics.recall >= 0 && evaluation.metrics.recall <= 1);
  assert.match(evaluation.note, /not establish clinical validity/i);
});

test('local retrieval returns relevant approved NASA references with source URLs', () => {
  const results = retrieve('What kind of datasets are in NASA OSDR?', 3);
  assert.ok(results.length > 0);
  assert.match(results[0].title, /OSDR/i);
  assert.match(results[0].url, /^https:\/\/osdr\.nasa\.gov\//);
  assert.ok(results[0].excerpt.length > 0);
});

test('each mission health area has a separate module route and the unconnected domains are marked as scaffolds', () => {
  const ids = MODULES.map((module) => module.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const moduleId of ['cardiovascular','respiratory','sleep','activity','wellness','radiation','alerts','reports','simulation']) {
    assert.ok(ids.includes(moduleId), `missing independent module route: ${moduleId}`);
  }
  assert.equal(MODULES.find((module) => module.id === 'immune')?.state, 'scaffold');
  assert.equal(MODULES.find((module) => module.id === 'bone')?.state, 'scaffold');
});

