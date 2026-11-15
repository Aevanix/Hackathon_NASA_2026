import http from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dbPath, audit, baselineFor, nowIso, publicAstronaut, createId } from './db.mjs';
import { evaluateModel, infer, modelStatus, trainAndSaveModel } from './ml.mjs';
import { createConversation, historyForUser, isHealthRelated, localAnswer, retrieve, storeMessage } from './assistant.mjs';
import { startSentinelService } from './sentinel.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = resolve(ROOT, 'frontend');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : randomBytes(48).toString('base64url'));
if (Buffer.byteLength(JWT_SECRET) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes; generate a unique secret before starting ASTRA in production.');
const ACCESS_SECONDS = 15 * 60;
const REFRESH_DAYS = 7;
const sockets = new Set();
const simulations = new Map();
const authAttempts = new Map();
const streamTickets = new Map();
let sentinelService = null;
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
const fail = (status, message, code = 'request_error') => Object.assign(new Error(message), { status, code });
const iso = (value = Date.now()) => new Date(value).toISOString();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const str = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const dataMode = (req) => {
  const requested = req.headers['x-astra-data-mode'];
  if (requested === 'mission') return 'connected';
  return ['connected','simulation','research'].includes(requested) ? requested : 'simulation';
};
const simulatedFlag = (mode) => mode === 'simulation' ? 1 : 0;
function dataPredicate(mode, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (mode === 'simulation') return `${prefix}simulated=1`;
  const sourceClass = mode === 'research' ? 'research' : 'connected';
  return `${prefix}simulated=0 AND ${prefix}data_class='${sourceClass}'`;
}

function tokenPart(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function signAccess(user, sessionId) {
  const now = Math.floor(Date.now() / 1000);
  const header = tokenPart({ alg: 'HS256', typ: 'JWT' });
  const payload = tokenPart({ sub: user.id, role: user.role, sid: sessionId, iat: now, exp: now + ACCESS_SECONDS });
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
function verifyAccess(token) {
  try {
    const [header, payload, signature] = token.split('.');
    const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!body.sub || body.exp < Date.now() / 1000) return null;
    return body;
  } catch { return null; }
}
function getUser(row) {
  return row && { id: row.id, email: row.email, name: row.full_name, role: row.role, astronautId: row.astronaut_id || null };
}
function loadUser(id) {
  return getUser(db.prepare(`SELECT u.id,u.email,u.full_name,u.astronaut_id,r.name AS role
    FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1`).get(id));
}
function auth(req) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const claims = bearer && verifyAccess(bearer);
  const session = claims?.sid && db.prepare('SELECT id FROM auth_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?').get(claims.sid, claims.sub, nowIso());
  const user = session && loadUser(claims.sub);
  if (!user) throw fail(401, 'Sign in is required or your session has expired.', 'unauthorized');
  return user;
}
const isStaff = (user) => user.role === 'admin' || user.role === 'medical_officer';
function requireRole(user, roles) { if (!roles.includes(user.role)) throw fail(403, 'Your role cannot perform this action.', 'forbidden'); }
function astronautRow(id) { return db.prepare('SELECT * FROM astronauts WHERE id=? AND archived=0').get(id); }
function baselineSourceFor(id) { return db.prepare('SELECT source FROM health_baselines WHERE astronaut_id=?').get(id)?.source || 'not available'; }
function baselineForMode(id, mode) {
  const source = baselineSourceFor(id);
  return mode !== 'simulation' && (mode === 'research' || /synthetic|demo|seed/i.test(source)) ? null : baselineFor(id);
}
function canReadAstronaut(user, id) {
  const record = astronautRow(id);
  if (!record) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'medical_officer') return record.medical_officer_id === user.id;
  return user.astronautId === id;
}
function requireAstronaut(user, id) {
  if (!canReadAstronaut(user, id)) throw fail(403, 'You are not authorised to access this astronaut record.', 'forbidden');
  const row = astronautRow(id);
  if (!row) throw fail(404, 'Astronaut not found.', 'not_found');
  return row;
}
async function bodyJson(req, maxBytes = 2_000_000) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw fail(413, 'Request body is too large.', 'payload_too_large');
    chunks.push(chunk);
  }
  if (!length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, 'Request body must be valid JSON.', 'invalid_json'); }
}
function validateMeasurement(input) {
  const body = input.reading && typeof input.reading === 'object' ? input.reading : input;
  const pick = (snake, camel = snake) => body[snake] ?? body[camel];
  const result = {
    heart_rate: pick('heart_rate', 'heartRate'), hrv: pick('hrv'), spo2: pick('spo2'),
    respiratory_rate: pick('respiratory_rate', 'respiratoryRate'), temperature: pick('temperature'),
    activity_level: pick('activity_level', 'activityLevel'), sleep_duration: pick('sleep_duration', 'sleepDuration'),
  };
  const limits = {
    heart_rate: [20, 240], hrv: [0, 300], spo2: [40, 100], respiratory_rate: [3, 80],
    temperature: [30, 43], activity_level: [0, 1], sleep_duration: [0, 24],
  };
  for (const [key, value] of Object.entries(result)) {
    if (value === undefined || value === null || value === '') { result[key] = null; continue; }
    result[key] = Number(value);
    if (!Number.isFinite(result[key]) || result[key] < limits[key][0] || result[key] > limits[key][1]) throw fail(422, `Measurement ${key} is outside the accepted range.`, 'validation_error');
  }
  if (Object.values(result).filter((value) => value !== null).length < 2) throw fail(422, 'At least two health measurements are required.', 'validation_error');
  const recordedAt = new Date(input.recordedAt || body.recorded_at || body.recordedAt || Date.now());
  if (!Number.isFinite(recordedAt.getTime()) || recordedAt.getTime() > Date.now() + 5 * 60_000) throw fail(422, 'Measurement timestamp is invalid or in the future.', 'validation_error');
  const simulated = input.simulated === false || body.simulated === false ? 0 : 1;
  const requestedClass = str(input.dataClass || body.data_class || body.dataClass || 'connected', 24).toLowerCase();
  const sourceClass = simulated ? 'simulation' : (requestedClass === 'research' ? 'research' : 'connected');
  return { ...result, recorded_at: recordedAt.toISOString(), source: str(input.source || body.source || 'local import', 120), data_quality: str(input.dataQuality || body.data_quality || body.dataQuality || 'good', 32), simulated, data_class: sourceClass, client_id: str(input.clientId || body.client_id || body.clientId || '', 120) || null };
}

function formatReading(row) {
  if (!row) return null;
  return {
    id: row.id, astronautId: row.astronaut_id, heartRate: row.heart_rate, hrv: row.hrv, spo2: row.spo2,
    respiratoryRate: row.respiratory_rate, temperature: row.temperature, activityLevel: row.activity_level,
    sleepDuration: row.sleep_duration, recordedAt: row.recorded_at, source: row.source,
    dataQuality: row.data_quality, simulated: Boolean(row.simulated), dataClass: row.data_class || (row.simulated ? 'simulation' : 'connected'),
  };
}
function formatAlert(row) {
  return { id: row.id, astronautId: row.astronaut_id, astronautName: row.astronaut_name || null,
    severity: row.severity, category: row.category, title: row.title, explanation: row.explanation,
    measurement: JSON.parse(row.measurement_json), createdAt: row.created_at, status: row.status,
    simulated: Boolean(row.simulated), dataClass: row.data_class || (row.simulated ? 'simulation' : 'connected'),
    acknowledgedBy: row.acknowledged_by, acknowledgedAt: row.acknowledged_at,
    resolvedBy: row.resolved_by, resolvedAt: row.resolved_at };
}
function formatObservation(row) {
  return { id:row.id,missionId:row.mission_id,astronautId:row.astronaut_id,subjectType:row.subject_type,subjectId:row.subject_id,
    category:row.category,severity:row.severity,title:row.title,explanation:row.explanation,source:row.source,dataQuality:row.data_quality,
    measurement:JSON.parse(row.measurement_json),baseline:JSON.parse(row.baseline_json),missio