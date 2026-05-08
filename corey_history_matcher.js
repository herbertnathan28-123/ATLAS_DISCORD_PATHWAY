'use strict';

/**
 * ATLAS FX — Corey Clone Phase D similarity matcher.
 *
 * Spec authority: D.1.0.3 §SIMILARITY METRIC.
 *
 * Hard filters: same instrument only, timeframe '1D' only.
 * Z-score normalisation: query q is normalised against q's own trailing
 *   252-bar window; candidate i is normalised against i's own trailing
 *   252-bar window. If either side lacks usable trailing observations
 *   (or the std is zero) for a soft variable, that variable is excluded
 *   from THIS run and the remaining weights are renormalised. The run
 *   is only abandoned if fewer than MIN_ACTIVE_SOFT_VARS variables
 *   remain active for the query — this preserves audit-grade matching
 *   while making a single degenerate variable (e.g. a flat-range bar in
 *   the trailing window) survivable instead of fatal.
 * Distance: d(q,i) = sqrt( Σ w_v * (z_v(q) - z_v(i))² ) over active vars
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

// Resilience constants — degenerate-variable handling.
// MIN_ACTIVE_SOFT_VARS: out of 10 soft variables, require at least this
// many to remain non-degenerate for the query before computing distance.
// MIN_TRAILING_OBS: of the 252 trailing bars, require at least this many
// non-null observations per variable before its std is trusted.
const MIN_ACTIVE_SOFT_VARS = 6;
const MIN_TRAILING_OBS     = 200;

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
 * computeFeatureValues(rows, idx) → null only when the bar lacks the
 * minimum hard preconditions (idx<252, ATR(14) unavailable, close<=0).
 *
 * Otherwise returns an object with one key per soft variable. INDIVIDUAL
 * values are null when that specific variable is unavailable for this bar
 * (e.g. body_range_ratio_5 when one of the last 5 bars has range==0).
 * Per-variable null is preferred to whole-bar null so that one bad bar
 * in a 252-bar trailing window does not invalidate the entire query.
 */
function computeFeatureValues(rows, idx) {
  if (!rows || idx < 0 || idx >= rows.length) return null;
  // Hard preconditions (cannot recover):
  if (idx < 20)  return null;     // need 20 prior bars for return_20 / dist_*_20 / trend_slope_20
  if (idx < 252) return null;     // need 252 prior bars for vol_regime_pct_252
  const bar = rows[idx];
  const close = bar.close;
  if (!Number.isFinite(close) || close <= 0) return null;
  const atr14 = computeATR(rows, idx, 14);
  if (atr14 == null) return null; // hard precondition: ATR(14) anchors all atr-scaled features

  const back = (k) => rows[idx - k];

  const ret = (k) => {
    const b = back(k);
    return (b && Number.isFinite(b.close) && b.close > 0) ? (close / b.close - 1) : null;
  };
  const ret5  = ret(5);
  const ret10 = ret(10);
  const ret20 = ret(20);

  const atrPctOfPrice = atr14 / close;

  // body / range ratio over last 5 bars
  let bodyRangeRatio5 = null;
  {
    let bodySum = 0, rangeSum = 0, ok = true;
    for (let k = 0; k < 5; k++) {
      const b = back(k);
      if (!b) { ok = false; break; }
      const body  = Math.abs(b.close - b.open);
      const range = b.high - b.low;
      if (!Number.isFinite(body) || !Number.isFinite(range) || range <= 0) { ok = false; break; }
      bodySum  += body;
      rangeSum += range;
    }
    if (ok && rangeSum > 0) bodyRangeRatio5 = bodySum / rangeSum;
  }

  // wick imbalance over last 5 bars
  let wickImbalance5 = null;
  {
    let imb = 0, imbN = 0;
    for (let k = 0; k < 5; k++) {
      const b = back(k);
      if (!b) continue;
      const range = b.high - b.low;
      if (!(range > 0)) continue;
      const upper = b.high - Math.max(b.open, b.close);
      const lower = Math.min(b.open, b.close) - b.low;
      const v = (upper - lower) / range;
      if (Number.isFinite(v)) { imb += v; imbN += 1; }
    }
    if (imbN > 0) wickImbalance5 = imb / imbN;
  }

  // dist from rolling 20 high/low (excluding anchor) in ATR units
  let distFromHigh20Atr = null, distFromLow20Atr = null;
  {
    let high20 = -Infinity, low20 = Infinity, ok = true;
    for (let k = 1; k <= 20; k++) {
      const b = back(k);
      if (!b) { ok = false; break; }
      if (Number.isFinite(b.high) && b.high > high20) high20 = b.high;
      if (Number.isFinite(b.low)  && b.low  < low20)  low20  = b.low;
    }
    if (ok && Number.isFinite(high20) && Number.isFinite(low20) && atr14 > 0) {
      distFromHigh20Atr = (high20 - close) / atr14;
      distFromLow20Atr  = (close  - low20)  / atr14;
    }
  }

  // vol regime percentile of ATR(14) over trailing 252 bars (excluding anchor)
  let volRegimePct252 = null;
  {
    const need = 252;
    const atrSeries = new Array(need);
    let ok = true;
    for (let k = 0; k < need; k++) {
      const at = computeATR(rows, idx - 1 - k, 14);
      if (at == null) { ok = false; break; }
      atrSeries[k] = at;
    }
    if (ok) {
      let lt = 0;
      for (let k = 0; k < need; k++) if (atrSeries[k] < atr14) lt++;
      volRegimePct252 = lt / need;
    }
  }

  // trend slope over last 20 bars in ATR units per bar
  let trendSlope20Atr = null;
  {
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, ok = true;
    for (let k = 19; k >= 0; k--) {
      const b = back(k);
      if (!b || !Number.isFinite(b.close)) { ok = false; break; }
      const x = 19 - k;
      const y = b.close;
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    if (ok && atr14 > 0) {
      const n = 20;
      const denom = (n * sumXX - sumX * sumX);
      const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
      const v = slope / atr14;
      if (Number.isFinite(v)) trendSlope20Atr = v;
    }
  }

  return {
    return_5:               Number.isFinite(ret5)            ? ret5            : null,
    return_10:              Number.isFinite(ret10)           ? ret10           : null,
    return_20:              Number.isFinite(ret20)           ? ret20           : null,
    atr_pct_of_price:       Number.isFinite(atrPctOfPrice)   ? atrPctOfPrice   : null,
    body_range_ratio_5:     bodyRangeRatio5,
    wick_imbalance_5:       wickImbalance5,
    dist_from_high_20_atr:  Number.isFinite(distFromHigh20Atr) ? distFromHigh20Atr : null,
    dist_from_low_20_atr:   Number.isFinite(distFromLow20Atr)  ? distFromLow20Atr  : null,
    vol_regime_pct_252:     Number.isFinite(volRegimePct252)   ? volRegimePct252   : null,
    trend_slope_20_atr:     Number.isFinite(trendSlope20Atr)   ? trendSlope20Atr   : null,
  };
}

/**
 * trailingWindowFeatures(rows, anchorIdx) → null only if anchorIdx itself
 * lacks the 252-bar prefix. Otherwise returns one array per soft variable
 * containing the non-null observations from bars [anchorIdx-252 .. anchorIdx-1].
 * Bars where computeFeatureValues returns null contribute nothing; bars
 * where only some variables are null contribute to the variables they have.
 */
function trailingWindowFeatures(rows, anchorIdx) {
  if (anchorIdx < Z_WINDOW) return null;
  const series = {};
  for (const v of VARS) series[v.name] = [];
  for (let k = 0; k < Z_WINDOW; k++) {
    const i = anchorIdx - Z_WINDOW + k;
    const f = computeFeatureValues(rows, i);
    if (!f) continue;
    for (const v of VARS) {
      const val = f[v.name];
      if (Number.isFinite(val)) series[v.name].push(val);
    }
  }
  return series;
}

function meanStd(arr) {
  if (!arr || !arr.length) return { mean: NaN, std: NaN };
  let s = 0; for (const v of arr) s += v;
  const m = s / arr.length;
  let v = 0;
  for (const x of arr) v += (x - m) * (x - m);
  const std = Math.sqrt(v / arr.length);
  return { mean: m, std };
}

/**
 * featuresZ(rows, anchorIdx, raw?, ctxOut?) — returns a result object:
 *   { z: { name: zValue }, activeVars: [{id,name,weight}], dropped: [{name,reason}] }
 * or null if fewer than MIN_ACTIVE_SOFT_VARS variables remain active.
 *
 * Dropped variables include reasons: anchor_value_unavailable,
 * trailing_obs_below_min, std_zero. Weights in activeVars are RENORMALISED
 * to sum to 1.0 across the surviving variables.
 */
function featuresZ(rows, anchorIdx, raw, ctxOut) {
  const window = trailingWindowFeatures(rows, anchorIdx);
  if (!window) return null;
  const r = raw || computeFeatureValues(rows, anchorIdx);
  if (!r) return null;

  const z = {};
  const active = [];
  const dropped = [];
  for (const v of VARS) {
    const arr = window[v.name];
    if (!arr || arr.length < MIN_TRAILING_OBS) {
      dropped.push({ name: v.name, reason: `trailing_obs=${arr ? arr.length : 0}<${MIN_TRAILING_OBS}` });
      continue;
    }
    if (!Number.isFinite(r[v.name])) {
      dropped.push({ name: v.name, reason: 'anchor_value_unavailable' });
      continue;
    }
    const ms = meanStd(arr);
    if (!Number.isFinite(ms.std) || ms.std === 0) {
      dropped.push({ name: v.name, reason: 'std=0' });
      continue;
    }
    z[v.name] = (r[v.name] - ms.mean) / ms.std;
    active.push(v);
  }

  if (ctxOut) { ctxOut.active = active; ctxOut.dropped = dropped; }
  if (active.length < MIN_ACTIVE_SOFT_VARS) return null;

  // Renormalise weights across the active set so distance remains comparable.
  let totalW = 0;
  for (const v of active) totalW += v.weight;
  const renormed = totalW > 0
    ? active.map(v => ({ id: v.id, name: v.name, weight: v.weight / totalW }))
    : active.map(v => ({ id: v.id, name: v.name, weight: 1 / active.length }));

  return { z, activeVars: renormed, dropped };
}

/**
 * matchAnalogues(rows, queryIdx) →
 *   { ok, cohort: [{ index, similarity, distance, z }],
 *     denominator_pre_filter, rejected_count, rejection_reasons,
 *     query_z, raw_query, weights, query_active_vars, query_dropped_vars,
 *     version, similarity_threshold, min_cohort_size, max_cohort_size }
 *
 * Hard filters (preserved from spec): same-instrument matching is enforced
 * by the caller (one symbol per row set); timeframe '1D' is enforced by
 * the cache validator. Cohort threshold = 0.70, min cohort = 10, max = 50.
 */
function matchAnalogues(rows, queryIdx) {
  const reasonCounts = {};
  const inc = (r) => { reasonCounts[r] = (reasonCounts[r] || 0) + 1; };

  const rawQ = computeFeatureValues(rows, queryIdx);
  if (!rawQ) {
    return {
      ok:     false,
      reason: 'query features unavailable (insufficient history)',
      query_active_vars:  [],
      query_dropped_vars: [],
    };
  }
  const qCtx = {};
  const qZRes = featuresZ(rows, queryIdx, rawQ, qCtx);
  if (!qZRes) {
    return {
      ok:     false,
      reason: `query z-score window degenerate or insufficient (active=${qCtx.active ? qCtx.active.length : 0}/${VARS.length}, MIN=${MIN_ACTIVE_SOFT_VARS})`,
      query_active_vars:  (qCtx.active || []).map(v => v.name),
      query_dropped_vars: qCtx.dropped || [],
    };
  }

  const qZ          = qZRes.z;
  const activeVars  = qZRes.activeVars;       // already weight-renormalised
  const activeNames = activeVars.map(v => v.name);

  const horizon = config.OUTCOME.primaryHorizonDays;
  let denomPreFilter = 0;
  const candidates = [];

  for (let i = Z_WINDOW; i < rows.length - horizon; i++) {
    if (Math.abs(i - queryIdx) <= 20) { inc('within_20_of_query'); continue; }
    denomPreFilter++;
    const rawI = computeFeatureValues(rows, i);
    if (!rawI) { inc('candidate_features_unavailable'); continue; }
    const iCtx = {};
    const zIRes = featuresZ(rows, i, rawI, iCtx);
    if (!zIRes) { inc('candidate_z_window_degenerate'); continue; }

    // Candidate must have non-degenerate z-values for EVERY variable that
    // is active on the query side. Otherwise the comparison is incomplete.
    let missing = false;
    for (const name of activeNames) {
      if (!Number.isFinite(zIRes.z[name])) { missing = true; break; }
    }
    if (missing) { inc('candidate_missing_active_variable'); continue; }

    let d2 = 0;
    for (const v of activeVars) {
      const dz = (qZ[v.name] - zIRes.z[v.name]);
      d2 += v.weight * dz * dz;
    }
    const d   = Math.sqrt(d2);
    const sim = 1 / (1 + d);
    candidates.push({ index: i, similarity: sim, distance: d, z: zIRes.z, raw: rawI });
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
    weights:                  activeVars,
    query_active_vars:        activeNames,
    query_dropped_vars:       qCtx.dropped || [],
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
  MIN_ACTIVE_SOFT_VARS,
  MIN_TRAILING_OBS,
};
