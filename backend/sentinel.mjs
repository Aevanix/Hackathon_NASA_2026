const STALE_AFTER_MS = 15 * 60_000;

function stale(age) { return age > STALE_AFTER_MS; }
function elapsedMinutes(timestamp) { return Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60_000)); }

/** In-process LLM-independent monitor for missing or stale health, environment, and equipment streams. */
export function startSentinelService({ db, recordObservation, intervalMs = 15_000, onTick = () => {} }) {
  let timer = null;
  let busy = false;
  let ticks = 0;
  let lastRunAt = null;
  let lastError = null;

  const inspect = () => {
    if (busy) return;
    busy = true;
    lastRunAt = new Date().toISOString();
    try {
      for (const [dataClass, simulated] of [['simulation', 1], ['connected', 0]]) {
        const astronauts = db.prepare(`SELECT a.id,a.mission_id,a.mission_designation,a.mission_start_date,
          (SELECT r.recorded_at FROM health_readings r WHERE r.astronaut_id=a.id AND r.simulated=? AND r.data_class=? ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1) AS latest_at,
          (SELECT r.source FROM health_readings r WHERE r.astronaut_id=a.id AND r.simulated=? AND r.data_class=? ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1) AS latest_source
          FROM astronauts a WHERE a.archived=0`).all(simulated, dataClass, simulated, dataClass);
        for (const astronaut of astronauts) {
          if (!astronaut.latest_at) continue;
          const ageMs = Date.now() - new Date(astronaut.latest_at).getTime();
          if (!stale(ageMs)) continue;
          const minutes = elapsedMinutes(astronaut.latest_at);
          recordObservation({
            astronautId: astronaut.id, missionId: astronaut.mission_id, subjectType: 'health_feed',
            subjectId: `health:${astronaut.id}`, category: 'data_quality', severity: 'OBSERVATION',
            title: `${dataClass === 'simulation' ? 'Simulated' : 'Connected'} health telemetry is stale`,
            explanation: `No ${dataClass} health reading has arrived for ${minutes} minutes. The last recorded point remains visible with its timestamp; check the source status before interpreting the current record.`,
            source: astronaut.latest_source || `${dataClass} health stream`, dataQuality: 'stale',
            measurement: { lastRecordedAt: astronaut.latest_at, ageMinutes: minutes },
            baseline: {}, missionContext: { mission: astronaut.mission_designation, missionStartDate: astronaut.mission_start_date },
            detectionMethod: 'periodic stale-stream monitor', dedupeKey: `health-stream-stale:${dataClass}`, simulated: Boolean(simulated), dataClass,
          });
        }

        const staleSensors = db.prepare(`SELECT id,mission_id,astronaut_id,name,metric,unit,source,
          COALESCE(NULLIF(last_seen_at,''),NULLIF(created_at,'')) AS last_activity
          FROM environmental_sensors WHERE simulated=? AND data_class=? AND status='active'`).all(simulated, dataClass);
        for (const sensor of staleSensors) {
          if (!sensor.last_activity) continue;
          const ageMs = Date.now() - new Date(sensor.last_activity).getTime();
          if (!stale(ageMs)) continue;
          const minutes = elapsedMinutes(sensor.last_activity);
          recordObservation({
            missionId: sensor.mission_id, astronautId: sensor.astronaut_id, subjectType: 'environment_sensor', subjectId: sensor.id,
            category: 'environment', severity: 'WARNING', title: 'Environmental sensor stream is stale',
            explanation: `${sensor.name} has not produced a new value for ${minutes} minutes. Confirm sensor availability before using the last sample.`,
            source: sensor.source, dataQuality: 'stale', measurement: { metric: sensor.metric, unit: sensor.unit, lastSeenAt: sensor.last_activity, ageMinutes: minutes },
            baseline: {}, missionContext: {}, detectionMethod: 'periodic stale-stream monitor', dedupeKey: `environment-stream-stale:${dataClass}`, simulated: Boolean(simulated), dataClass,
          });
        }

        const staleEquipment = db.prepare(`SELECT id,mission_id,astronaut_id,name,category,source,last_seen_at,status,
          COALESCE(NULLIF(last_seen_at,''),NULLIF(created_at,'')) AS last_activity
          FROM equipment WHERE simulated=? AND data_class=? AND status!='retired'`).all(simulated, dataClass);
        for (const device of staleEquipment) {
          if (!device.last_activity) continue;
          const ageMs = Date.now() - new Date(device.last_activity).getTime();
          if (!stale(ageMs)) continue;
          const minutes = elapsedMinutes(device.last_activity);
          recordObservation({
            missionId: device.mission_id, astronautId: device.astronaut_id, subjectType: 'equipment', subjectId: device.id,
            category: 'equipment', severity: 'WARNING', title: 'Equipment telemetry is stale',
            explanation: `${device.name} has not reported status for ${minutes} minutes. The last status is ${device.status}.`,
            source: device.source, dataQuality: 'stale', measurement: { category: device.category, lastSeenAt: device.last_activity, status: device.status, ageMinutes: minutes },
            baseline: {}, missionContext: {}, detectionMethod: 'periodic stale-stream monitor', dedupeKey: `equipment-stream-stale:${dataClass}`, simulated: Boolean(simulated), dataClass,
          });
        }
      }
      ticks += 1;
      lastError = null;
      onTick({ ticks, lastRunAt });
    } catch (error) {
      lastError = error.message;
    } finally {
      busy = false;
    }
  };

  timer = setInterval(inspect, intervalMs);
  timer.unref?.();
  inspect();

  return {
    status: () => ({ running: Boolean(timer), intervalMs, ticks, lastRunAt, lastError, engine: 'deterministic background monitor; independent of conversational AI' }),
    stop: () => { if (timer) clearInterval(timer); timer = null; },
  };
}
