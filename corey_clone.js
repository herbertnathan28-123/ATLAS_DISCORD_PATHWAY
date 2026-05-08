'use strict';

/**
 * Corey Clone — historical analogue / base-rate authority.
 *
 * Doctrine (locked 2026-05-07): mandatory engine. Slot must always be
 * occupied. If real historical evidence cannot be produced, returns
 * status-only { status: 'PARTIAL'|'UNAVAILABLE', reason }.
 *
 * Phase D (locked 2026-05-08, spec D.1.0.3):
 *   - Test mode (ATLAS_TEST_MODE=1): preserved test-mode short-circuit.
 *     Foundation doctrine remains satisfied without live cache.
 *   - Production mode: read real candles via corey_history_reader,
 *     match cohort via corey_history_matcher, classify outcomes via
 *     corey_history_outcomes. Every emitted analogue carries the locked
 *     11-field audit-grade contract (§REAL EVIDENCE ACCEPTANCE).
 *
 * Hard rules:
 *   - No fake / synthetic production evidence.
 *   - No hard-coded analogues in production.
 *   - Zero analogues surviving filtering ⇒ PARTIAL with truthful reason.
 *   - Confidence below the ACTIVE floor ⇒ PARTIAL with truthful reason.
 *   - Severely stale cache ⇒ PARTIAL with truthful reason.
 */

const config       = require('./corey_history_config');
const versions     = require('./corey_history_versions');
const reader       = require('./corey_history_reader');
const matcher      = require('./corey_history_matcher');
const outcomes     = require('./corey_history_outcomes');
const validator    = require('./corey_history_validator');
const audit        = require('./corey_history_audit');

// Foundation-doctrine slot: kept for backwards compatibility with any
// caller that imports historicalCache via the old patterns.
let cache = null;
try { cache = require('./historicalCache'); } catch (_e) { /* not required in Phase D production path */ }

function nowIso() { return new Date().toISOString(); }

function partial(symbol, reason, extra) {
  return Object.assign({
    authority: 'historical_analogue_base_rate',
    status:    'PARTIAL',
    reason,
    symbol,
    timestamp: nowIso(),
    matcher_version:           versions.MATCHER_VERSION,
    outcome_classifier_version: versions.OUTCOME_CLASSIFIER_VERSION,
  }, extra || {});
}

function unavailable(symbol, reason, extra) {
  return Object.assign({
    authority: 'historical_analogue_base_rate',
    status:    'UNAVAILABLE',
    reason,
    symbol,
    timestamp: nowIso(),
    matcher_version:           versions.MATCHER_VERSION,
    outcome_classifier_version: versions.OUTCOME_CLASSIFIER_VERSION,
  }, extra || {});
}

/**
 * coreyCloneRun(symbol, opts) → CoreyCloneOutputD or status-only PARTIAL/UNAVAILABLE
 *
 * Test mode short-circuit returns the same Phase B shape so foundation
 * doctrine continues to pass. Production mode uses the real cache.
 */
async function coreyCloneRun(symbol, opts) {
  opts = opts || {};
  const testMode = opts.testMode || process.env.ATLAS_TEST_MODE === '1';
  const timestamp = nowIso();

  if (testMode) {
    return {
      authority: 'historical_analogue_base_rate',
      score: 0.5,
      confidence: 0.5,
      analogues: [{ date: '2024-09-05', similarity: 0.78, outcome: 'follow_through' }],
      baseRates: { followThrough: 0.6, reversal: 0.25, range: 0.15 },
      warningFlags: [],
      timeframeRelevance: 'daily',
      symbol,
      timestamp,
      _testModeShortCircuit: true,
      matcher_version:           versions.MATCHER_VERSION,
      outcome_classifier_version: versions.OUTCOME_CLASSIFIER_VERSION,
    };
  }

  // Surface the cache directory once per production-mode run so the operator
  // can confirm Render's persistent disk is actually being read.
  audit.info('corey_clone_production_run', {
    symbol,
    cacheDir: config.CACHE_DIR,
    jsonlPath: config.jsonlPath(symbol),
  });

  // Symbol must be in Annex A.
  const sym = config.getSymbol(symbol);
  if (!sym) {
    audit.warn('corey_clone_unknown_symbol', { symbol });
    return unavailable(symbol, `symbol not in Annex A: ${symbol}`);
  }

  // Read cache.
  const read = reader.readCandles(symbol);
  if (!read.ok) {
    audit.warn('corey_clone_partial_cache_unreadable', {
      symbol,
      cacheDir: config.CACHE_DIR,
      jsonlPath: config.jsonlPath(symbol),
      rowCount: read.rows ? read.rows.length : 0,
      badCount: read.badCount || 0,
      errorCount: read.errors ? read.errors.length : 0,
      firstErrors: read.errors ? read.errors.slice(0, 3) : [],
      freshnessSeverity: read.freshness && read.freshness.severity,
    });
    return partial(symbol, read.errors && read.errors[0] ? read.errors[0] : 'cache unavailable', {
      cacheStatus: read.freshness || { ok: false, severity: 'severe', reason: 'cache unavailable' },
      denominator_pre_filter: 0,
      rejected_analogue_count: 0,
      rejection_reasons:       {},
    });
  }

  // Freshness gating.
  const freshness = read.freshness;
  if (freshness && freshness.severity === 'severe') {
    audit.warn('corey_clone_partial_cache_severely_stale', {
      symbol,
      ageDays: freshness.ageDays,
      reason: freshness.reason,
      lastVerifiedAt: read.manifest && read.manifest.last_verified_at,
    });
    return partial(symbol, freshness.reason || 'cache verification severely stale (>90 days); cache:verify/cache:refresh required before evidence trusted', {
      cacheStatus: freshness,
      denominator_pre_filter: 0,
      rejected_analogue_count: 0,
      rejection_reasons:       {},
    });
  }

  // Use the LATEST bar in the cache as the query anchor — i.e. the
  // most recent observation we hold. We do NOT fabricate a "current"
  // snapshot from outside the cache. If the most recent bar's window
  // also has 5D forward bars, it can serve as a query anchor (no — for
  // a query we need NO forward bars in the cache; we care about the
  // current state). For Phase D we use the absolute last cache bar as
  // the query. The OUTCOME windows are computed for CANDIDATE bars
  // (i.e. earlier in the series).
  const rows = read.rows;
  audit.info('corey_clone_cache_loaded', {
    symbol,
    rowCount: rows.length,
    firstOpen: rows.length ? rows[0].open_time : null,
    lastOpen:  rows.length ? rows[rows.length - 1].open_time : null,
    freshnessSeverity: freshness && freshness.severity,
    freshnessAgeDays:  freshness && freshness.ageDays,
  });
  if (rows.length < config.SIMILARITY.zScoreWindowBars + 21) {
    audit.warn('corey_clone_partial_insufficient_history', {
      symbol,
      rowCount: rows.length,
      required: config.SIMILARITY.zScoreWindowBars + 21,
    });
    return partial(symbol, 'insufficient cache history for matcher (need ≥ 252 + 20 bars)', {
      cacheStatus: freshness,
      denominator_pre_filter: 0,
      rejected_analogue_count: 0,
      rejection_reasons:       { insufficient_history: 1 },
    });
  }
  const queryIdx = rows.length - 1;

  // Run matcher.
  let match;
  const tMatch0 = Date.now();
  try {
    match = matcher.matchAnalogues(rows, queryIdx);
  } catch (e) {
    audit.error('corey_clone_matcher_threw', { symbol, error: audit.sanitiseError(e) });
    return partial(symbol, `matcher error: ${e.message}`, {
      cacheStatus: freshness,
      denominator_pre_filter: 0,
      rejected_analogue_count: 0,
      rejection_reasons:       { matcher_error: 1 },
    });
  }
  audit.info('corey_clone_matcher_done', {
    symbol,
    durationMs:             Date.now() - tMatch0,
    ok:                     match.ok,
    cohortSize:             match.cohort ? match.cohort.length : 0,
    denominator_pre_filter: match.denominator_pre_filter,
    rejected_count:         match.rejected_count,
    rejection_reasons:      match.rejection_reasons,
    similarity_threshold:   match.similarity_threshold,
    topSimilarities:        match.cohort ? match.cohort.slice(0, 5).map(c => +c.similarity.toFixed(4)) : [],
    query_active_vars:      match.query_active_vars  || null,
    query_dropped_vars:     match.query_dropped_vars || null,
  });
  if (!match.ok) {
    audit.warn('corey_clone_partial_matcher_not_ok', {
      symbol,
      reason:             match.reason,
      query_active_vars:  match.query_active_vars  || null,
      query_dropped_vars: match.query_dropped_vars || null,
    });
    return partial(symbol, match.reason || 'matcher returned not-ok', {
      cacheStatus: freshness,
      denominator_pre_filter: 0,
      rejected_analogue_count: 0,
      rejection_reasons:       {},
    });
  }

  // Build per-cohort-member analogue with full outcome + audit fields.
  const fetchRunId = (read.manifest && read.manifest.last_fetch_run_id) || null;
  const fetchedAt  = (read.manifest && read.manifest.last_fetched_at)   || null;
  const datasetSrc = {
    provider:      'twelvedata',
    plan:          (process.env.TWELVEDATA_PLAN || 'unspecified'),
    fetch_run_id:  fetchRunId,
    fetched_at:    fetchedAt,
  };
  const tolerances = { similarity_threshold: match.similarity_threshold };
  const matchingVariables = (() => {
    const m = {};
    for (const v of match.weights) m[v.name] = { weight: v.weight, query_z: match.query_z[v.name] };
    return m;
  })();

  const accepted = [];
  let droppedCohort = 0;
  const dropReasons = {};
  const inc = (k) => { dropReasons[k] = (dropReasons[k] || 0) + 1; };

  for (const c of match.cohort) {
    const oc = outcomes.classifyOutcome(rows, c.index, {
      horizonDays: config.OUTCOME.primaryHorizonDays,
      atrPeriod:   config.OUTCOME.atrPeriod,
      thresholdAtrMultiple: config.OUTCOME.thresholdAtrMultiple,
    });
    if (!oc.ok) { droppedCohort++; inc(oc.reason || 'outcome_unavailable'); continue; }

    const anchorBar  = rows[c.index];
    const featureWindowOpens = (() => {
      // Feature window = trailing 252 bars ending at anchor (inclusive of anchor)
      const arr = [];
      for (let k = c.index - (config.SIMILARITY.zScoreWindowBars - 1); k <= c.index; k++) {
        arr.push(rows[k].open_time);
      }
      return arr;
    })();

    const analogue = {
      instrument_symbol:        sym.atlas,
      window_start_utc:         featureWindowOpens[0],
      window_end_utc:           anchorBar.open_time,
      timeframe:                '1D',
      cohort_sample_size:       0,           // populated post-loop
      denominator_pre_filter:   match.denominator_pre_filter,
      matching_variables:       matchingVariables,
      tolerances,
      source:                   datasetSrc,
      outcome_label:            oc.label,
      outcome_window_days:      oc.horizon_days,
      outcome_measurement: {
        close_at_window_start:  oc.close_at_window_start,
        close_at_window_end:    oc.close_at_window_end,
        atr_at_window_start:    oc.atr_at_window_start,
        delta_in_atr:           oc.delta_in_atr,
        direction:              oc.direction === 'up' ? 'up' : oc.direction === 'down' ? 'down' : 'flat',
      },
      confidence:               c.similarity,                // per-analogue confidence = similarity
      matcher_version:          versions.MATCHER_VERSION,
      outcome_classifier_version: versions.OUTCOME_CLASSIFIER_VERSION,
      evidence_used: {
        feature_window_bar_open_times: featureWindowOpens,
        outcome_window_bar_open_times: oc.outcome_window_bar_open_times,
      },
    };
    accepted.push(analogue);
  }

  // Apply min-cohort gate AFTER outcome filtering (zero-survivor rule).
  if (accepted.length < config.COHORT.minCohortSize) {
    audit.info('corey_clone_partial_zero_survivors', { symbol, accepted: accepted.length, droppedCohort, denominator: match.denominator_pre_filter });
    return partial(sym.atlas, 'no analogues met audit-grade matching variables', {
      cacheStatus: freshness,
      denominator_pre_filter: match.denominator_pre_filter,
      rejected_analogue_count: match.rejected_count + droppedCohort,
      rejection_reasons: Object.assign({}, match.rejection_reasons, dropReasons),
    });
  }

  // Stamp cohort_sample_size on every analogue post-finalisation.
  for (const a of accepted) a.cohort_sample_size = accepted.length;

  // Outcome distribution + base-rate stats.
  const dist = { follow_through: 0, reversal: 0, range: 0 };
  for (const a of accepted) dist[a.outcome_label]++;
  const N = accepted.length;
  const outcomeDistribution = {
    follow_through: dist.follow_through,
    reversal:       dist.reversal,
    range:          dist.range,
  };
  const baseRateStats = {
    follow_through: dist.follow_through / N,
    reversal:       dist.reversal       / N,
    range:          dist.range          / N,
  };
  const labels = Object.keys(baseRateStats);
  let dominantLabel = labels[0];
  for (const k of labels) if (baseRateStats[k] > baseRateStats[dominantLabel]) dominantLabel = k;
  const p_max = baseRateStats[dominantLabel];

  // Confidence — Spec §SIMILARITY METRIC + §STALE CACHE RULE
  const cohortFactor   = Math.min(1.0, N / config.COHORT.cohortFactorFullCredit);
  const stalenessFactor= (freshness && freshness.severity === 'stale')
    ? config.FRESHNESS.staleConfidenceFactor
    : 1.0;
  const confidence     = p_max * cohortFactor * stalenessFactor;

  // Limitation flags
  const limitations = [];
  if (freshness && freshness.severity === 'limitation') limitations.push(`cache verification ${Math.round(freshness.ageDays)} days old (over freshness window)`);
  if (freshness && freshness.severity === 'stale')      limitations.push(`cache verification ${Math.round(freshness.ageDays)} days old; confidence factor ${stalenessFactor} applied`);

  // ACTIVE floor
  if (confidence < config.ACTIVE_CONFIDENCE_FLOOR) {
    audit.warn('corey_clone_partial_below_active_floor', {
      symbol: sym.atlas,
      confidence,
      activeFloor:    config.ACTIVE_CONFIDENCE_FLOOR,
      p_max,
      cohortFactor,
      stalenessFactor,
      cohortSize:     N,
      dominantLabel,
      outcomeDistribution,
    });
    return partial(sym.atlas, 'computed cohort confidence below ACTIVE threshold', {
      cacheStatus: freshness,
      denominator_pre_filter: match.denominator_pre_filter,
      rejected_analogue_count: match.rejected_count + droppedCohort,
      rejection_reasons: Object.assign({}, match.rejection_reasons, dropReasons),
      accepted_analogue_count: N,
      outcomeDistribution,
      baseRateStats,
      limitations,
    });
  }

  // Validate every analogue against the locked contract — drop any that fail.
  const finalAnalogues = [];
  const finalDropReasons = {};
  let postValidateDropped = 0;
  for (const a of accepted) {
    const v = validator.validateAnalogue(a);
    if (v.ok) finalAnalogues.push(a);
    else {
      postValidateDropped++;
      const k = (v.errors && v.errors[0]) || 'analogue_validation_failed';
      finalDropReasons[k] = (finalDropReasons[k] || 0) + 1;
    }
  }
  if (finalAnalogues.length < config.COHORT.minCohortSize) {
    audit.warn('corey_clone_partial_post_validate_below_min', {
      symbol: sym.atlas,
      finalCount:        finalAnalogues.length,
      minRequired:       config.COHORT.minCohortSize,
      postValidateDropped,
      finalDropReasons,
    });
    return partial(sym.atlas, 'no analogues met audit-grade matching variables', {
      cacheStatus: freshness,
      denominator_pre_filter: match.denominator_pre_filter,
      rejected_analogue_count: match.rejected_count + droppedCohort + postValidateDropped,
      rejection_reasons: Object.assign({}, match.rejection_reasons, dropReasons, finalDropReasons),
    });
  }
  // Re-stamp cohort_sample_size to reflect the post-validate cohort.
  for (const a of finalAnalogues) a.cohort_sample_size = finalAnalogues.length;

  audit.info('corey_clone_active', { symbol: sym.atlas, accepted: finalAnalogues.length, dominant: dominantLabel, p_max, confidence });

  return {
    authority:                  'historical_analogue_base_rate',
    status:                     'ACTIVE',
    score:                      Math.max(0, Math.min(1, confidence)),
    confidence:                 confidence,
    symbol:                     sym.atlas,
    timestamp,
    matcher_version:            versions.MATCHER_VERSION,
    outcome_classifier_version: versions.OUTCOME_CLASSIFIER_VERSION,
    cacheStatus:                freshness,
    denominator_pre_filter:     match.denominator_pre_filter,
    rejected_analogue_count:    match.rejected_count + droppedCohort + postValidateDropped,
    rejection_reasons:          Object.assign({}, match.rejection_reasons, dropReasons, finalDropReasons),
    accepted_analogue_count:    finalAnalogues.length,
    matching_variables:         matchingVariables,
    tolerances,
    weights:                    match.weights,
    analogues:                  finalAnalogues,
    outcomeDistribution,
    baseRateStats,
    limitations,
    warningFlags:               [],
    timeframeRelevance:         'daily',
    auditTrail: {
      sourceDataset: { identifier: 'historicalCache.jsonl', version: 'v1.0', lastUpdatedUtc: fetchedAt },
      cohortSampleSize:        finalAnalogues.length,
      cohortDenominatorPreFilter: match.denominator_pre_filter,
      similarityThreshold:     match.similarity_threshold,
      ATR_PERIOD:              config.OUTCOME.atrPeriod,
      OUTCOME_HORIZON_DAYS:    config.OUTCOME.primaryHorizonDays,
    },
    // Foundation-doctrine fields preserved from Phase B for backward compat
    // with the existing CoreyCloneOutput contract.
    analogues_summary: finalAnalogues.slice(0, 5).map(a => ({
      date: a.window_end_utc, similarity: a.confidence, outcome: a.outcome_label,
    })),
    baseRates: {
      followThrough: baseRateStats.follow_through,
      reversal:      baseRateStats.reversal,
      range:         baseRateStats.range,
    },
  };
}

module.exports = { coreyCloneRun };
