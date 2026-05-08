'use strict';

/**
 * ATLAS FX — Corey Clone Phase D row + analogue validator.
 *
 * Spec authority: D.1.0.3 §HISTORICAL CACHE ROW SCHEMA + §REAL EVIDENCE
 * ACCEPTANCE.
 *
 * Two surfaces:
 *   - validateCacheRow(row, ctx)        → { ok, errors, normalised }
 *   - validateAnalogue(an, ctx)         → { ok, errors }
 *
 * No row that fails this validator may be written to disk or read into
 * memory. No analogue that fails this validator may reach Jane.
 */

const config = require('./corey_history_config');

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
function isISODate(v)      { return typeof v === 'string' && ISO_RE.test(v); }
function isUUID(v)         { return typeof v === 'string' && UUID_RE.test(v); }
function isAllowedProvider(v) { return typeof v === 'string' && config.PROVIDER_ALLOWLIST.includes(v); }

function ohlcIntegrityFails(row) {
  // Per locked rule: high >= max(open, close, low) and low <= min(open, close, high).
  if (row.high < row.low) return 'high < low';
  if (row.high < row.open) return 'high < open';
  if (row.high < row.close) return 'high < close';
  if (row.low > row.open) return 'low > open';
  if (row.low > row.close) return 'low > close';
  return null;
}

/**
 * Validate a JSONL cache row against §HISTORICAL CACHE ROW SCHEMA.
 * ctx: { runIdsAllowed?: Set<string>, nowMs?: number }
 */
function validateCacheRow(row, ctx) {
  ctx = ctx || {};
  const errors = [];
  if (!row || typeof row !== 'object') return { ok: false, errors: ['row not an object'] };

  // Required scalars
  if (typeof row.symbol !== 'string' || !row.symbol)               errors.push('symbol missing/empty');
  if (typeof row.display_symbol !== 'string' || !row.display_symbol) errors.push('display_symbol missing/empty');
  if (typeof row.fetch_symbol !== 'string' || !row.fetch_symbol)   errors.push('fetch_symbol missing/empty');
  if (row.timeframe !== '1D')                                      errors.push('timeframe must be "1D"');

  if (!isISODate(row.open_time))                                   errors.push('open_time not ISO UTC');
  if (!isISODate(row.close_time))                                  errors.push('close_time not ISO UTC');
  if (isISODate(row.open_time) && isISODate(row.close_time)) {
    const ot = Date.parse(row.open_time);
    const ct = Date.parse(row.close_time);
    if (!(ot < ct)) errors.push('open_time must be < close_time');
  }

  for (const f of ['open', 'high', 'low', 'close']) {
    if (!isFiniteNumber(row[f])) errors.push(`${f} not finite number`);
  }
  if (errors.length === 0) {
    const ohlcErr = ohlcIntegrityFails(row);
    if (ohlcErr) errors.push(`OHLC integrity: ${ohlcErr}`);
  }

  // volume can be number or null — but if present must be finite (or null)
  if (row.volume !== null && row.volume !== undefined && !isFiniteNumber(row.volume)) {
    errors.push('volume must be finite number or null');
  }

  // Source provenance
  const src = row.source;
  if (!src || typeof src !== 'object')                              errors.push('source missing');
  else {
    if (!isAllowedProvider(src.provider))                            errors.push(`source.provider not allow-listed (got "${src.provider}")`);
    if (typeof src.plan !== 'string' || !src.plan)                   errors.push('source.plan missing/empty');
    if (typeof src.endpoint !== 'string' || !src.endpoint)           errors.push('source.endpoint missing/empty');
    if (!isISODate(src.fetched_at))                                  errors.push('source.fetched_at not ISO UTC');
    if (isISODate(src.fetched_at)) {
      const ft = Date.parse(src.fetched_at);
      const now = ctx.nowMs || Date.now();
      if (ft > now + 60_000) errors.push('source.fetched_at is in the future');
    }
    if (!isUUID(src.fetch_run_id))                                   errors.push('source.fetch_run_id not a UUID');
    if (isUUID(src.fetch_run_id) && ctx.runIdsAllowed instanceof Set && !ctx.runIdsAllowed.has(src.fetch_run_id)) {
      errors.push(`source.fetch_run_id not linked to a known _runs record (${src.fetch_run_id})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a Corey Clone Phase D analogue against §REAL EVIDENCE ACCEPTANCE.
 * Required fields:
 *   instrument_symbol, window_start_utc, window_end_utc, timeframe="1D",
 *   cohort_sample_size>=10, denominator_pre_filter>=cohort_sample_size,
 *   matching_variables, tolerances, source.{provider,plan,fetch_run_id,fetched_at},
 *   outcome_label, outcome_window_days,
 *   outcome_measurement.{close_at_window_start,close_at_window_end,
 *                        atr_at_window_start,delta_in_atr,direction},
 *   confidence, matcher_version, outcome_classifier_version,
 *   evidence_used.{feature_window_bar_open_times,outcome_window_bar_open_times}
 */
function validateAnalogue(an, ctx) {
  ctx = ctx || {};
  const errors = [];
  if (!an || typeof an !== 'object') return { ok: false, errors: ['analogue not an object'] };

  if (typeof an.instrument_symbol !== 'string' || !an.instrument_symbol)
    errors.push('instrument_symbol missing/empty');
  if (!isISODate(an.window_start_utc)) errors.push('window_start_utc not ISO UTC');
  if (!isISODate(an.window_end_utc))   errors.push('window_end_utc not ISO UTC');
  if (an.timeframe !== '1D')           errors.push('timeframe must be "1D"');
  if (!Number.isInteger(an.cohort_sample_size) || an.cohort_sample_size < 10)
    errors.push('cohort_sample_size must be integer >= 10');
  if (!Number.isInteger(an.denominator_pre_filter) || an.denominator_pre_filter < (an.cohort_sample_size || 0))
    errors.push('denominator_pre_filter must be integer >= cohort_sample_size');
  if (!an.matching_variables || typeof an.matching_variables !== 'object')
    errors.push('matching_variables missing');
  if (!an.tolerances || typeof an.tolerances !== 'object')
    errors.push('tolerances missing');

  const src = an.source;
  if (!src || typeof src !== 'object')                              errors.push('source missing');
  else {
    if (!isAllowedProvider(src.provider))                            errors.push(`source.provider not allow-listed`);
    if (typeof src.plan !== 'string' || !src.plan)                   errors.push('source.plan missing/empty');
    if (!isUUID(src.fetch_run_id))                                   errors.push('source.fetch_run_id not a UUID');
    if (!isISODate(src.fetched_at))                                  errors.push('source.fetched_at not ISO UTC');
  }

  if (!['follow_through', 'reversal', 'range'].includes(an.outcome_label))
    errors.push(`outcome_label must be one of follow_through/reversal/range (got ${JSON.stringify(an.outcome_label)})`);
  if (!Number.isFinite(an.outcome_window_days) || an.outcome_window_days <= 0)
    errors.push('outcome_window_days must be positive number');

  const om = an.outcome_measurement;
  if (!om || typeof om !== 'object') errors.push('outcome_measurement missing');
  else {
    if (!isFiniteNumber(om.close_at_window_start)) errors.push('outcome_measurement.close_at_window_start not finite');
    if (!isFiniteNumber(om.close_at_window_end))   errors.push('outcome_measurement.close_at_window_end not finite');
    if (!isFiniteNumber(om.atr_at_window_start) || om.atr_at_window_start <= 0)
      errors.push('outcome_measurement.atr_at_window_start not finite-positive');
    if (!isFiniteNumber(om.delta_in_atr))          errors.push('outcome_measurement.delta_in_atr not finite');
    if (!['up','down','flat'].includes(om.direction))
      errors.push(`outcome_measurement.direction must be up/down/flat (got ${JSON.stringify(om.direction)})`);
  }

  if (!isFiniteNumber(an.confidence) || an.confidence < 0 || an.confidence > 1)
    errors.push('confidence must be finite number in [0,1]');
  if (typeof an.matcher_version !== 'string' || !an.matcher_version)
    errors.push('matcher_version missing/empty');
  if (typeof an.outcome_classifier_version !== 'string' || !an.outcome_classifier_version)
    errors.push('outcome_classifier_version missing/empty');

  const ev = an.evidence_used;
  if (!ev || typeof ev !== 'object') errors.push('evidence_used missing');
  else {
    if (!Array.isArray(ev.feature_window_bar_open_times) || ev.feature_window_bar_open_times.length === 0)
      errors.push('evidence_used.feature_window_bar_open_times missing or empty');
    if (!Array.isArray(ev.outcome_window_bar_open_times) || ev.outcome_window_bar_open_times.length === 0)
      errors.push('evidence_used.outcome_window_bar_open_times missing or empty');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate the full set of analogues attached to a Corey Clone packet.
 * Per spec, ANY malformed analogue voids the entire packet's trust.
 */
function validateAnalogueSet(analogues, ctx) {
  if (!Array.isArray(analogues)) return { ok: false, errors: ['analogues not an array'], perAnalogueErrors: [] };
  const perAnalogueErrors = [];
  let allOk = true;
  for (let i = 0; i < analogues.length; i++) {
    const r = validateAnalogue(analogues[i], ctx);
    if (!r.ok) {
      allOk = false;
      perAnalogueErrors.push({ index: i, errors: r.errors });
    }
  }
  return { ok: allOk, errors: allOk ? [] : ['one or more analogues failed validation'], perAnalogueErrors };
}

module.exports = {
  validateCacheRow,
  validateAnalogue,
  validateAnalogueSet,
  // exported for tests
  isFiniteNumber, isISODate, isUUID, isAllowedProvider,
};
