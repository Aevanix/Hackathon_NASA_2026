import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dataDir, nowIso } from './db.mjs';

export const MODEL_VERSION = 'astra-iforest-0.1.0';
export const ANOMALY_THRESHOLD = 0.55;
export const FEATURE_NAMES = ['heart_rate', 'hrv', 'spo2', 'respiratory_rate', 'temperature', 'activity_level', 'sleep_duration'];
const SCALE = { heart_rate: 8, hrv: 9, spo2: 2, respiratory_rate: 3, temperature: 0.55, activity_level: 0.28, sleep_duration: 1.6 };
const MODEL_PATH = resolve(dataDir, 'isolation-forest.json');
export let model = null;

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussian = (rng) => {
  const u = Math.max(rng(), 1e-12), v = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export function baselineVector(baseline) {
  return Object.fromEntries(FEATURE_NAMES.map((key) => [key, Number(baseline?.[key] ?? 0)]));
}

export function featureVector(reading, baseline) {
  return FEATURE_NAMES.map((key) => {
    const current = Number(reading?.[key]);
    const center = Number(baseline?.[key]);
    if (!Number.isFinite(current) || !Number.isFinite(center)) return NaN;
    return (current - center) / SCALE[key];
  });
}

function expectedPath(length) {
  if (length <= 1) return 0;
  if (length === 2) return 1;
  const harmonicApprox = Math.log(length - 1) + 0.5772156649;
  return 2 * harmonicApprox - 2 * (length - 1) / length;
}

function buildTree(points, depth, limit, rng) {
  if (points.length <= 1 || depth >= limit) return { size: points.length };
  const dimensions = points[0].length;
  const candidates = Array.from({ length: dimensions }, (_, i) => i).filter((j) => {
    const values = points.map((p) => p[j]);
    return Math.min(...values) < Math.max(...values);
  });
  if (!candidates.length) return { size: points.length };
  const feature = candidates[Math.floor(rng() * candidates.length)];
  const values = points.map((p) => p[feature]);
  const min = Math.min(...values), max = Math.max(...values);
  const split = min + rng() * (max - min);
  const left = [], right = [];
  for (const point of points) (point[feature] < split ? left : right).push(point);
  if (!left.length || !right.length) return { size: points.length };
  return { feature, split, left: buildTree(left, depth + 1, limit, rng), right: buildTree(right, depth + 1, limit, rng) };
}

function pathLength(vector, node, depth = 0) {
  if (node.size !== undefined) return depth + expectedPath(node.size);
  return pathLength(vector, vector[node.feature] < node.split ? node.left : node.right, depth + 1);
}

function fit(normal, options = {}) {
  const rng = random(options.seed ?? 481516);
  const treeCount = options.treeCount ?? 96;
  const sampleSize = Math.min(options.sampleSize ?? 128, normal.length);
  const maxDepth = Math.ceil(Math.log2(sampleSize));
  const trees = [];
  for (let i = 0; i < treeCount; i++) {
    const indexes = Array.from({ length: normal.length }, (_, index) => index);
    for (let j = indexes.length - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1)); [indexes[j], indexes[k]] = [indexes[k], indexes[j]];
    }
    trees.push(buildTree(indexes.slice(0, sampleSize).map((index) => normal[index]), 0, maxDepth, rng));
  }
  return { version: MODEL_VERSION, createdAt: nowIso(), featureNames: FEATURE_NAMES, treeCount, sampleSize, trainingRows: normal.length, trees };
}

function normalReferenceRows(count, seed = 91731) {
  const rng = random(seed);
  return Array.from({ length: count }, () => FEATURE_NAMES.map(() => gaussian(rng)));
}

export function trainAndSaveModel() {
  const trained = fit(normalReferenceRows(768), { treeCount: 96, sampleSize: 128, seed: 481516 });
  writeFileSync(MODEL_PATH, JSON.stringify(trained));
  model = trained;
  return trained;
}

function loadModel() {
  try {
    const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8'));
    if (model.version === MODEL_VERSION && Array.isArray(model.trees) && model.trees.length) return model;
  } catch {}
  return trainAndSaveModel();
}

model = loadModel();

export function scoreVector(vector) {
  if (!Array.isArray(vector) || vector.length !== FEATURE_NAMES.length || !vector.every(Number.isFinite)) {
    return { score: null, anomaly: false, quality: 'incomplete' };
  }
  const meanPath = model.trees.reduce((sum, tree) => sum + pathLength(vector, tree), 0) / model.trees.length;
  const score = 2 ** (-meanPath / expectedPath(model.sampleSize));
  return { score: +score.toFixed(4), anomaly: score >= ANOMALY_THRESHOLD, quality: 'good', meanPath: +meanPath.toFixed(3) };
}

export function infer(reading, baseline) {
  const vector = featureVector(reading, baseline);
  const result = scoreVector(vector);
  const deviation = FEATURE_NAMES.reduce((items, name, index) => {
    if (!Number.isFinite(vector[index])) return items;
    const limit = name === 'spo2' ? 2 : name === 'temperature' ? 2.5 : 2.4;
    if (Math.abs(vector[index]) >= limit) items.push({ parameter: name, zScore: +vector[index].toFixed(2), direction: vector[index] > 0 ? 'above' : 'below' });
    return items;
  }, []);
  let riskCategory = 'NORMAL';
  if (result.quality !== 'good') riskCategory = 'OBSERVATION';
  else if (result.score >= 0.72 && deviation.length >= 2) riskCategory = 'CRITICAL REVIEW';
  else if (result.score >= 0.62 && deviation.length >= 2) riskCategory = 'WARNING';
  else if (result.score >= ANOMALY_THRESHOLD || deviation.length) riskCategory = 'OBSERVATION';
  const explanation = result.quality !== 'good'
    ? 'The model needs a complete set of measurements; this result is marked low quality.'
    : deviation.length
      ? `Isolation Forest found an unusual multi-measurement pattern (score ${result.score}; scores are not medical probabilities). ${deviation.map((d) => `${d.parameter} ${d.direction} its personal reference`).join(', ')}.`
      : `The measured pattern is near this astronaut's reference range (Isolation Forest anomaly score ${result.score}; this is not a diagnosis).`;
  return { ...result, riskCategory, explanation, deviations: deviation, vector };
}

export function evaluateModel() {
  const rng = random(1234567);
  const positives = Array.from({ length: 240 }, () => {
    const row = FEATURE_NAMES.map(() => gaussian(rng));
    const pick = rng() < 0.55 ? [0, 2] : [1, 6];
    for (const i of pick) row[i] += (rng() < 0.5 ? -1 : 1) * (3.2 + rng() * 1.2);
    return { row, label: 1 };
  });
  const negatives = normalReferenceRows(240, 83217).map((row) => ({ row, label: 0 }));
  const heldOut = [...positives, ...negatives];
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const item of heldOut) {
    const predicted = scoreVector(item.row).score >= ANOMALY_THRESHOLD ? 1 : 0;
    if (predicted && item.label) tp++;
    else if (predicted) fp++;
    else if (item.label) fn++;
    else tn++;
  }
  const total = tp + fp + tn + fn;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return {
    version: MODEL_VERSION, trainingRows: model.trainingRows, heldOutRows: total,
    metrics: {
      accuracy: +(tp + tn) / total,
      precision: +precision.toFixed(4), recall: +recall.toFixed(4),
      f1: +(precision + recall ? 2 * precision * recall / (precision + recall) : 0).toFixed(4),
      falsePositiveRate: +(fp / (fp + tn || 1)).toFixed(4),
      confusionMatrix: { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn },
    },
    note: 'Held-out synthetic reference data only. These metrics do not establish clinical validity.',
  };
}

export function modelStatus() {
  return { version: model.version, trainedAt: model.createdAt, trainingRows: model.trainingRows, trees: model.treeCount,
    features: FEATURE_NAMES, modelKind: 'Isolation Forest', threshold: ANOMALY_THRESHOLD, status: 'ready',
    trainingData: 'Synthetic reference telemetry; research prototype, not clinically validated.' };
}
