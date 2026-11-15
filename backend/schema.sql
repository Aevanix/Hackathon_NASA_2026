PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role_id INTEGER NOT NULL REFERENCES roles(id),
  astronaut_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), refresh_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions(user_id, expires_at);
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY, designation TEXT NOT NULL, status TEXT NOT NULL,
  start_date TEXT NOT NULL, duration_days INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS astronauts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mission_id TEXT REFERENCES missions(id),
  mission_designation TEXT NOT NULL, mission_start_date TEXT NOT NULL,
  mission_duration_days INTEGER NOT NULL, medical_officer_id TEXT,
  monitoring_status TEXT NOT NULL DEFAULT 'active', archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS health_baselines (
  astronaut_id TEXT PRIMARY KEY REFERENCES astronauts(id), baseline_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'synthetic demonstration baseline', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS data_sources (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, source_type TEXT NOT NULL,
  description TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS health_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT UNIQUE, astronaut_id TEXT NOT NULL REFERENCES astronauts(id),
  heart_rate REAL, hrv REAL, spo2 REAL, respiratory_rate REAL, temperature REAL,
  activity_level REAL, sleep_duration REAL, parameter TEXT, value REAL, unit TEXT,
  recorded_at TEXT NOT NULL, source TEXT NOT NULL, data_quality TEXT NOT NULL DEFAULT 'good',
  simulated INTEGER NOT NULL DEFAULT 1, synced_at TEXT, data_class TEXT NOT NULL DEFAULT 'connected'
);
CREATE INDEX IF NOT EXISTS idx_health_astronaut_time ON health_readings(astronaut_id, recorded_at DESC);
CREATE TABLE IF NOT EXISTS sleep_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, astronaut_id TEXT NOT NULL REFERENCES astronauts(id),
  duration_hours REAL NOT NULL, quality_score REAL, recorded_at TEXT NOT NULL, source TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS activity_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, astronaut_id TEXT NOT NULL REFERENCES astronauts(id),
  active_minutes REAL NOT NULL, activity_level REAL NOT NULL, recorded_at TEXT NOT NULL, source TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS wellness_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, astronaut_id TEXT NOT NULL REFERENCES astronauts(id),
  mood INTEGER NOT NULL, stress INTEGER NOT NULL, fatigue INTEGER NOT NULL, sleep_satisfaction INTEGER NOT NULL,
  notes TEXT, recorded_at TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 0,
  data_class TEXT NOT NULL DEFAULT 'self_report'
);
CREATE TABLE IF NOT EXISTS radiation_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, astronaut_id TEXT NOT NULL REFERENCES astronauts(id),
  value REAL NOT NULL, unit TEXT NOT NULL, cumulative REAL NOT NULL, recorded_at TEXT NOT NULL,
  source TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1, data_class TEXT NOT NULL DEFAULT 'connected'
);
CREATE TABLE IF NOT EXISTS anomaly_predictions (
  id TEXT PRIMARY KEY, astronaut_id TEXT NOT NULL REFERENCES astronauts(id), anomaly INTEGER NOT NULL,
  score REAL NOT NULL, risk_category TEXT NOT NULL, model_version TEXT NOT NULL,
  explanation TEXT NOT NULL, quality TEXT NOT NULL, recorded_at TEXT NOT NULL, features_json TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 1, data_class TEXT NOT NULL DEFAULT 'connected'
);
CREATE TABLE IF NOT EXISTS health_alerts (
  id TEXT PRIMARY KEY, astronaut_id TEXT NOT NULL REFERENCES astronauts(id), severity TEXT NOT NULL,
  category TEXT NOT NULL, title TEXT NOT NULL, explanation TEXT NOT NULL,
  measurement_json TEXT NOT NULL, created_at TEXT NOT NULL,
  acknowledged_by TEXT, acknowledged_at TEXT, resolved_by TEXT, resolved_at TEXT,
  status TEXT NOT NULL DEFAULT 'open', dedupe_key TEXT, simulated INTEGER NOT NULL DEFAULT 0,
  data_class TEXT NOT NULL DEFAULT 'connected'
);
CREATE INDEX IF NOT EXISTS idx_alerts_status_time ON health_alerts(status, created_at DESC);
CREATE TABLE IF NOT EXISTS environmental_sensors (
  id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), astronaut_id TEXT REFERENCES astronauts(id),
  name TEXT NOT NULL, metric TEXT NOT NULL, location TEXT NOT NULL, unit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1,
  data_class TEXT NOT NULL DEFAULT 'connected', last_seen_at TEXT, created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS environmental_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sensor_id TEXT NOT NULL REFERENCES environmental_sensors(id),
  mission_id TEXT NOT NULL REFERENCES missions(id), astronaut_id TEXT REFERENCES astronauts(id),
  metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, recorded_at TEXT NOT NULL,
  source TEXT NOT NULL, data_quality TEXT NOT NULL DEFAULT 'good', simulated INTEGER NOT NULL DEFAULT 1,
  data_class TEXT NOT NULL DEFAULT 'connected', client_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_environment_sensor_time ON environmental_readings(sensor_id, recorded_at DESC);
CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), astronaut_id TEXT REFERENCES astronauts(id),
  name TEXT NOT NULL, category TEXT NOT NULL, serial_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'operational', battery_percent REAL, temperature_c REAL,
  source TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1, data_class TEXT NOT NULL DEFAULT 'connected',
  last_seen_at TEXT, maintenance_note TEXT, created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS equipment_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id TEXT NOT NULL REFERENCES equipment(id),
  metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, recorded_at TEXT NOT NULL,
  source TEXT NOT NULL, data_quality TEXT NOT NULL DEFAULT 'good', simulated INTEGER NOT NULL DEFAULT 1,
  data_class TEXT NOT NULL DEFAULT 'connected', client_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_equipment_reading_time ON equipment_readings(equipment_id, recorded_at DESC);
CREATE TABLE IF NOT EXISTS equipment_maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id TEXT NOT NULL REFERENCES equipment(id),
  performed_by TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sentinel_observations (
  id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id), astronaut_id TEXT REFERENCES astronauts(id),
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL,
  title TEXT NOT NULL, explanation TEXT NOT NULL, source TEXT NOT NULL, data_quality TEXT NOT NULL,
  measurement_json TEXT NOT NULL, baseline_json TEXT NOT NULL, mission_context_json TEXT NOT NULL,
  detection_method TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  dedupe_key TEXT, simulated INTEGER NOT NULL DEFAULT 1, data_class TEXT NOT NULL DEFAULT 'connected',
  acknowledged_by TEXT, acknowledged_at TEXT, resolved_by TEXT, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sentinel_status_time ON sentinel_observations(status, created_at DESC);
CREATE TABLE IF NOT EXISTS sentinel_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, observation_id TEXT NOT NULL REFERENCES sentinel_observations(id),
  user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT NOT NULL REFERENCES health_alerts(id),
  user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), astronaut_id TEXT,
  title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id),
  role TEXT NOT NULL, content TEXT NOT NULL, sources_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, source_url TEXT NOT NULL, category TEXT NOT NULL,
  content TEXT NOT NULL, ingested_at TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT 'curated local reference'
);
CREATE TABLE IF NOT EXISTS simulation_sessions (
  id TEXT PRIMARY KEY, astronaut_id TEXT NOT NULL REFERENCES astronauts(id), scenario TEXT NOT NULL,
  status TEXT NOT NULL, interval_ms INTEGER NOT NULL DEFAULT 2500, speed REAL NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT UNIQUE NOT NULL, entity_type TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL, synced_at TEXT, status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT NOT NULL,
  entity_type TEXT, entity_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
