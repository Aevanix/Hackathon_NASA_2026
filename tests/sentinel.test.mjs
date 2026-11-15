import test from 'node:test';
import assert from 'node:assert/strict';
import { startSentinelService } from '../backend/sentinel.mjs';

test('SENTINEL checks connected and simulated health, environment, and equipment without an LLM', () => {
  const oldTime = new Date(Date.now() - 60 * 60_000).toISOString();
  const fakeDb = {
    prepare(sql) {
      return { all(...params) {
        if (sql.includes('FROM astronauts')) return [{
          id: 'AST-X', mission_id: 'MISSION-X', mission_designation: 'DEMO-X', mission_start_date: '2026-01-01',
          latest_at: oldTime, latest_source: `${params[1]} telemetry`,
        }];
        if (sql.includes('FROM environmental_sensors')) return [{
          id: `${params[1]}-ENV`, mission_id: 'MISSION-X', astronaut_id: 'AST-X', name: 'Cabin sensor',
          metric: 'temperature', unit: '°C', source: `${params[1]} source`, last_activity: oldTime,
        }];
        if (sql.includes('FROM equipment')) return [{
          id: `${params[1]}-EQ`, mission_id: 'MISSION-X', astronaut_id: 'AST-X', name: 'Crew wearable',
          category: 'wearable', source: `${params[1]} source`, last_seen_at: oldTime, last_activity: oldTime, status: 'operational',
        }];
        return [];
      } };
    },
  };
  const observations = [];
  const monitor = startSentinelService({ db: fakeDb, recordObservation: (item) => observations.push(item), intervalMs: 60_000 });
  const status = monitor.status();
  monitor.stop();

  assert.equal(status.running, true);
  assert.equal(status.ticks, 1);
  assert.equal(status.lastError, null);
  assert.equal(observations.length, 6);
  assert.deepEqual(new Set(observations.map((item) => item.dataClass)), new Set(['simulation', 'connected']));
  assert.ok(observations.some((item) => item.subjectType === 'health_feed'));
  assert.ok(observations.some((item) => item.subjectType === 'environment_sensor'));
  assert.ok(observations.some((item) => item.subjectType === 'equipment'));
  assert.ok(observations.every((item) => item.detectionMethod === 'periodic stale-stream monitor'));
});
