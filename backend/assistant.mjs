import { createHash } from 'node:crypto';
import { db, createId, nowIso } from './db.mjs';

const stop = new Set('a an the is are was were be been being of for to in on with and or my our your how what why explain summarize summary about does do has have from last recent current me it this that than over'.split(' '));
const terms = (value) => String(value || '').toLowerCase().match(/[a-z0-9-]{2,}/g)?.filter((word) => !stop.has(word)) || [];

const healthScope = /\b(health|medical|clinical|symptom|wellness|wellbeing|heart|cardio|pulse|hrv|spo2|oxygen|breath|respirat\w*|sleep|fatigue|stress|mood|bone|immune|radiation|dose|hydration|nutrition|exercise|activity|injury|medication|medicine|alert|anomal\w*|temperature|blood|pressure|cabin|humidity|atmospher\w*|acceleration|dynamic load|vibration|vehicle altitude|vehicle velocity|suit|telemetry|sensor|flight phase|mission health)\b/i;

export function isHealthRelated(query) {
  return healthScope.test(String(query || '').slice(0, 1500));
}

export function retrieve(query, limit = 3) {
  const queryTerms = [...new Set(terms(query))];
  if (!queryTerms.length) return [];
  const docs = db.prepare('SELECT id,title,source_url,category,content FROM knowledge_documents').all();
  const scored = docs.map((doc) => {
    const corpus = `${doc.title} ${doc.category} ${doc.content}`.toLowerCase();
    const counts = new Map();
    for (const token of terms(corpus)) counts.set(token, (counts.get(token) || 0) + 1);
    let score = 0;
    for (const token of queryTerms) {
      const count = counts.get(token) || 0;
      score += count ? (1 + Math.log(count)) * (1 + Math.log(1 + docs.length / (1 + docs.filter((d) => terms(`${d.title} ${d.content}`).includes(token)).length))) : 0;
    }
    return { id: doc.id, title: doc.title, url: doc.source_url, category: doc.category, excerpt: doc.content, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return scored;
}

function formatMeasurement(reading, baseline) {
  if (!reading) return 'No health readings are stored for this astronaut yet.';
  const parts = [
    `Heart rate ${reading.heart_rate} bpm (personal reference ${baseline.heart_rate} bpm)`,
    `HRV ${reading.hrv} ms (reference ${baseline.hrv} ms)`,
    `SpO₂ ${reading.spo2}% (reference ${baseline.spo2}%)`,
    `respiratory rate ${reading.respiratory_rate}/min (reference ${baseline.respiratory_rate}/min)`,
    `sleep ${reading.sleep_duration} h (reference ${baseline.sleep_duration} h)`,
  ];
  return `Most recent stored reading: ${parts.join('; ')}. Recorded ${reading.recorded_at}; source: ${reading.source}; quality: ${reading.data_quality}; ${reading.simulated ? 'synthetic demonstration data' : 'imported or sensor data'}.`;
}

export function localAnswer({ query, astronaut, latest, baseline, alerts, docs }) {
  const q = query.toLowerCase();
  if (/health status|current health|how.*doing|my health/.test(q)) {
    const open = alerts.filter((alert) => alert.status === 'open');
    return `${formatMeasurement(latest, baseline)} ${open.length ? `${open.length} open alert${open.length === 1 ? '' : 's'} need review.` : 'There are no open alerts for this astronaut.'} This summary reports stored measurements and is not a diagnosis.`;
  }
  if (/alert|anomal|prediction|review/.test(q) && alerts.length) {
    const recent = alerts.slice(0, 3).map((a) => `${a.severity} ${a.category}: ${a.title} (${a.status}, ${a.created_at})`).join(' • ');
    return `Recent stored alerts: ${recent}. The anomaly score is a model output, not a medical probability. A medical officer should review health alerts.`;
  }
  if (/heart rate|hrv|oxygen|spo2|sleep|measurement|last 24|seven day|7 day|trend|history/.test(q)) {
    if (!latest) return 'No health measurements are stored for this astronaut yet. Try the synthetic simulator or import a CSV/JSON dataset.';
    const related = alerts.filter((alert) => alert.created_at >= new Date(Date.now() - 7 * 86400000).toISOString()).length;
    return `${formatMeasurement(latest, baseline)} The local store has ${related} alert${related === 1 ? '' : 's'} in the last seven days. ${astronaut.name}'s baseline is a synthetic demonstration reference, not a clinical threshold. For detailed trend values, open Health trends.`;
  }
  if (!docs.length) return 'I could not find a relevant approved research reference in the local knowledge store. You can ask about stored health readings or use the linked NASA, ESA, and PhysioNet source catalogs. This assistant does not diagnose or prescribe.';
  const citations = docs.map((doc, index) => `[${index + 1}] ${doc.title}: ${doc.excerpt}`).join(' ');
  return `${citations} These are brief source-catalog summaries; follow the links to review the full research context and study limitations. General research is not an individualized medical assessment.`;
}

export function createConversation(userId, astronautId, title) {
  const id = createId('CONV'), time = nowIso();
  db.prepare('INSERT INTO assistant_conversations(id,user_id,astronaut_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(id, userId, astronautId, title.slice(0, 100), time, time);
  return id;
}

export function storeMessage(conversationId, role, content, sources = []) {
  db.prepare('INSERT INTO assistant_messages(conversation_id,role,content,sources_json,created_at) VALUES(?,?,?,?,?)')
    .run(conversationId, role, content, JSON.stringify(sources.map(({ title, url }) => ({ title, url }))), nowIso());
}

export function historyForUser(userId, conversationId) {
  const conversation = db.prepare('SELECT id,title,astronaut_id,created_at,updated_at FROM assistant_conversations WHERE id=? AND user_id=?').get(conversationId, userId);
  if (!conversation) return null;
  const messages = db.prepare('SELECT role,content,sources_json,created_at FROM assistant_messages WHERE conversation_id=? ORDER BY id').all(conversationId)
    .map((row) => ({ role: row.role, content: row.content, sources: JSON.parse(row.sources_json), createdAt: row.created_at }));
  return { ...conversation, messages };
}

export function contentHash(text) {
  return createHash('sha256').update(text).digest('hex');
}
