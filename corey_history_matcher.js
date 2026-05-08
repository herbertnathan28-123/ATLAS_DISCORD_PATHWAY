'use strict';

/**
 * ATLAS FX — Corey Clone Phase D similarity matcher.
 *
 * Spec authority: D.1.0.3 §SIMILARITY METRIC.
 *
 * Hard filters: same instrument only, timeframe '1D' only.
 * Z-score normalisation: query q is normalised against q's own trailing
 *   252-bar window; candidate i is normalised against i's own trailing
 *   252-bar window. If either side lacks 252 prior bars, exclude.
 * Distance: d(q,i) = sqrt( Σ w_v * (z_v(q) - z_v(i))² )
 * Similarity: 1 / (1 + d)
 * Cohort: similarity >= 0.70, min size 10, max size 50 (top-similarity).
 */

const config   = require('./corey_history_config');
const versions = require('./corey_history_versions');

const Z_WINDOW = config.SIMILARITY.zScoreWindowBars;     // 252
const VARS     = config.SIMILARITY.variables;
const SIM_THR  = config.COHORT.matchSimilarityThreshold; // 0.70
const MIN_COH  = config.COHORT.minCohortSize;            // 10
const MAX_COH  = config.COHORT.maxCohortSize;            // 50

/**
 * computeFeatureValues(rows, idx) → null if not enough history.
 *
 * Anchor bar is rows[idx]. Features are computed at the close of the
 * anchor bar. They are RAW (un-z-scored) here. Z-scoring is applied
 * separately in featuresZ() against rows[idx-Z_WINDOW .. idx-1] (the
 * TRAILING window, NOT including the anchor itself).
 */
function computeFeatureValues(rows, idx) {
  if (!rows || idx < 0 || idx >= rows.length) return null;
  // We need at least 20 prior bars for return_20 / dist_from_X_20 / trend_slope_20.
  if (idx < 20) return null;

  const bar = rows[idx];
  const close   = bar.close;
  const back  = (k) => rows[idx - k];

  const ret = (k) => {
    const b = back(k);
    return (b && Number.isFinite(b.close) && b.close > 0) ? (close / b.close - 1) : null;
  };

  const ret5  = ret(5);
  const ret10 = ret(10);
  const ret20 = ret(20);

  // ATR(14) at idx — Wilder mean form, same as outcomes module.
  const atr14 = computeATR(rows, idx, 14);
  if (atr14 == null || close <= 0) return null;
  const atrPctOfPrice = atr14 / close;

  // body/range ratio over last 5 bars
  let bodySum = 0, rangeSum = 0;
  for (let k = 0; k < 5; k++) {
    const b = back(k);
    if (!b) return null;
    const body  = Math.abs(b.close - b.open);
    const range = b.high - b.low;
    if (!Number.isFinite(body) || !Number.isFinite(range) || range <= 0) return null;
    bodySum  += body;
    rangeSum += range;
  }
  const bodyRangeRatio5 = rangeSum > 0 ? bodySum / rangeSum : null;

  // wick imbalance over last 5 bars: (upper_wick - lower_wick) / range
  let imb = 0, imbN = 0;
  for (let k = 0; k < 5; k++) {
    const b = back(k);
    const range = b.high - b.low;
    if (range <= 0) continue;
    const upper = b.high - Math.max(b.open, b.close);
    const lower = Math.min(b.open, b.close) - b.low;
    imb += (upper - lower) / range;
    imbN += 1;
  }
  const wickImbalance5 = imbN > 0 ? imb / imbN : null;

  // dist from rolling 20 high/low (excluding anchor) in ATR units
  let high20 = -Infinity, low20 = Infinity;
  for (let k = 1; k <= 20; k++) {
    const b = back(k);
    if (b.high > high20) high20 = b.high;
    if (b.low  < low20)  low20  = b.low;
  }
  const distFromHigh20Atr = (high20 - close) / atr14;
  const distFromLow20Atr  = (close  - low20)  / atr14;

  // vol regime percentile of ATR over trailing 252 bars (excluding anchor)
  // Rank of current ATR within the distribution of ATR(14) values over
  // the trailing window. Compute ATR at each prior bar and percentile-rank.
  const need = 252;
  if (idx < need) return null;
  const atrSeries = new Array(need);
  for (let k = 0; k < need; k++) {
    const at = computeATR(rows, idx - 1 - k, 14);
    if (at == null) return null;
    atrSeries[k] = at;
  }
  // Percentile of atr14 against atrSeries
  let lt = 0;
  for (let k = 0; k < need; k++) if (atrSeries[k] < atr14) lt++;
  const volRegimePct252 = lt / need;

  // Trend slope: linear regression slope of close over last 20 bars,
  // expressed in ATR units per bar.
  // x = 0..19 (oldest to most recent), y = close
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let k = 19; k >= 0; k--) {
    const x = 19 - k;
    const y = back(k).close;
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
  }
  const n = 20;
  const denom = (n * sumXX - sumX * sumX);
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const trendSlope20Atr = slope / atr14;

  if (![ret5, ret10, ret20, atrPctOfPrice, bodyRangeRatio5, wickImbalance5,
        distFromHigh20Atr, distFromLow20Atr, volRegimePct252, trendSlope20Atr].every(Number.isFinite)) {
    return null;
  }

  return {
    return_5:               ret5,
    return_10:              ret10,
    return_20:              ret20,
    atr_pct_of_price:       atrPctOfPrice,
    body_range_ratio_5:     bodyRangeRatio5,
    wick_imbalance_5:       wickImbalance5,
    dist_from_high_20_atr:  distFromHigh20Atr,
    dist_from_low_20_atr:   distFromLow20Atr,
    vol_regime_pct_252:     volRegimePct252,
    trend_slope_20_atr:     trendSlope20Atr,
  };
}

// Wilder-mean ATR matching the outcomes module's convention.
function computeATR(rows, idx, period) {
  if (idx < period) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const bar = rows[i], prev = rows[i - 1];
    if (!bar || !prev) return null;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prev.close),
      Math.abs(bar.low  - prev.close),
    );
    if (!Number.isFinite(tr) || tr < 0) return null;
    sum += tr;
  }
  const atr = sum / period;
  return Number.isFinite(atr) && atr > 0 ? atr : null;
}

/**
 * trailingWindowFeatures(rows, anchorIdx) → null if any bar in
 * [anchorIdx-Z_WINDOW .. anchorIdx-1] cannot produce features.
 *
 * Returns a parallel object: { return_5: [..252..], return_10: [..], ... }
 */
function trailingWindowFeatures(rows, anchorIdx) {
  if (anchorIdx < Z_WINDOW) return null;
  const series = {};
  for (const v of VARS) series[v.name] = new Array(Z_WINDOW);
  for (let k = 0; k < Z_WINDOW; k++) {
    const i = anchorIdx - Z_WINDOW + k;
    const f = computeFeatureValues(rows, i);
    if (!f) return null;
    for (const v of VARS) series[v.name][k] = f[v.name];
  }
  return series;
}

function meanStd(arr) {
  let s = 0; for (const v of arr) s += v;
  const m = s / arr.length;
  let v = 0;
  for (const x of arr) v += (x - m) * (x - m);
  const std = Math.sqrt(v / arr.length);
  return { mean: m, std };
}

/**
 * featuresZ(rows, anchorIdx, raw?) — returns the z-scored feature vector
 * at anchorIdx, normalised against the trailing 252-bar window. Optional
 * `raw` parameter avoids recomputing the anchor's raw features.
 */
function featuresZ(rows, anchorIdx, raw) {
  const window = trailingWindowFeatures(rows, anchorIdx);
  if (!window) return null;
  const r = raw || computeFeatureValues(rows, anchorIdx);
  if (!r) return null;
  const z = {};
  for (const v of VARS) {
    const ms = meanStd(window[v.name]);
    if (!Number.isFinite(ms.std) || ms.std === 0) {
      // Degenerate window — exclude (rule: if either side lacks usable
      // trailing window, exclude candidate).
      return null;
    }
    z[v.name] = (r[v.name] - ms.mean) / ms.std;
  }
  return z;
}

/**
 * matchAnalogues(rows, queryIdx) →
 *   { ok, cohort: [{ index, similarity, distance, z }],
 *     denominator_pre_filter, rejected_count, rejection_reasons,
 *     query_z, raw_query, weights, version }
 *
 * cohort is sorted similarity desc, capped to MAX_COH.
 */
function matchAnalogues(rows, queryIdx) {
  const reasonCounts = {};
  const inc = (r) => { reasonCounts[r] = (reasonCounts[r] || 0) + 1; };

  // Compute query features + z
  const rawQ = computeFeatureValues(rows, queryIdx);
  if (!rawQ) return { ok: false, reason: 'query features unavailable (insufficient history)' };
  const qZ = featuresZ(rows, queryIdx, rawQ);
  if (!qZ) return { ok: false, reason: 'query z-score window degenerate or insufficient' };

  const candidates = [];

  // Candidate domain: every bar i where the OUTCOME window is also
  // computable, i.e. i + horizon < rows.length, AND i has its own 252-bar
  // trailing z-score window. Exclude bars within ±20 bars of the query
  // to avoid trivial self-overlap on the feature window.
  const horizon = config.OUTCOME.primaryHorizonDays;
  let denomPreFilter = 0;

  for (let i = Z_WINDOW; i < rows.length - horizon; i++) {
    if (Math.abs(i - queryIdx) <= 20) { inc('within_20_of_query'); continue; }
    denomPreFilter++;
    const rawI = computeFeatureValues(rows, i);
    if (!rawI) { inc('candidate_features_unavailable'); continue; }
    const zI   = featuresZ(rows, i, rawI);
    if (!zI)   { inc('candidate_z_window_degenerate'); continue; }

    let d2 = 0;
    for (const v of VARS) {
      const dz = (qZ[v.name] - zI[v.name]);
      d2 += v.weight * dz * dz;
    }
    const d   = Math.sqrt(d2);
    const sim = 1 / (1 + d);
    candidates.push({ index: i, similarity: sim, distance: d, z: zI, raw: rawI });
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  const passed = [];
  for (const c of candidates) {
    if (c.similarity >= SIM_THR) passed.push(c);
    else inc('similarity_below_threshold');
    if (passed.length >= MAX_COH) break;
  }

  return {
    ok:                       true,
    cohort:                   passed,
    denominator_pre_filter:   denomPreFilter,
    rejected_count:           denomPreFilter - passed.length,
    rejection_reasons:        reasonCounts,
    query_z:                  qZ,
    raw_query:                rawQ,
    weights:                  VARS.map(v => ({ id: v.id, name: v.name, weight: v.weight })),
    version:                  versions.MATCHER_VERSION,
    similarity_threshold:     SIM_THR,
    min_cohort_size:          MIN_COH,
    max_cohort_size:          MAX_COH,
  };
}

module.exports = {
  computeFeatureValues,
  computeATR,
  featuresZ,
  trailingWindowFeatures,
  matchAnalogues,
  meanStd,
};
