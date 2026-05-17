'use strict';

/**
 * Corey Clone live analogue adapter.
 *
 * This is the live Market Intel / macro-chain contract. It consumes Corey's
 * interpreted macro packet and normalises the underlying historical matcher
 * into a decision-safe status object for Jane and FOH.
 */

const { coreyCloneRun } = require('../corey_clone');
const validator = require('../corey_history_validator');

function nowIso() { return new Date().toISOString(); }

function asArray(v) { return Array.isArray(v) ? v : []; }

function safeString(v, fallback) {
  return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
}

function deriveSymbol(packet) {
  return safeString(
    packet && (packet.symbol || packet.instrument || packet.ticker),
    'UNKNOWN'
  ).toUpperCase();
}

function sourceBasisFromAnalogue(a, fallback) {
  const src = a && a.source;
  if (src && typeof src === 'object') {
    const bits = [];
    if (src.provider) bits.push(String(src.provider));
    if (src.plan) bits.push('plan=' + String(src.plan));
    if (src.fetch_run_id) bits.push('fetch_run_id=' + String(src.fetch_run_id));
    if (src.fetched_at) bits.push('fetched_at=' + String(src.fetched_at));
    if (bits.length) return bits.join(' · ');
  }
  return fallback || 'source basis unavailable';
}

function timestampWindowFromAnalogue(a) {
  if (!a || typeof a !== 'object') return null;
  const start = a.window_start_utc || a.windowStartUTC || null;
  const end = a.window_end_utc || a.windowEndUTC || null;
  if (!start || !end) return null;
  return { startUTC: start, endUTC: end, label: String(start) + ' → ' + String(end) };
}

function normaliseAnalogue(a) {
  const window = timestampWindowFromAnalogue(a);
  const sampleSize = a && (a.cohort_sample_size ?? a.cohortSampleSize);
  const denominator = a && (a.denominator_pre_filter ?? a.denominator);
  return {
    instrument: a.instrument_symbol || a.instrument || null,
    windowStartUTC: window && window.startUTC,
    windowEndUTC: window && window.endUTC,
    timestampWindow: window,
    matchTimeframe: a.timeframe || a.matchTimeframe || null,
    cohortSampleSize: Number.isFinite(sampleSize) ? sampleSize : null,
    denominator: Number.isFinite(denominator) ? denominator : null,
    matchingVariables: a.matching_variables || a.matchingVariables || null,
    tolerances: a.tolerances || null,
    sourceDataset: a.source || a.sourceDataset || null,
    sourceBasis: sourceBasisFromAnalogue(a),
    outcomeLabel: a.outcome_label || a.outcomeLabel || null,
    outcomeMeasurementWindow: Array.isArray(a.evidence_used && a.evidence_used.outcome_window_bar_open_times)
      ? a.evidence_used.outcome_window_bar_open_times.join(' → ')
      : (a.outcomeMeasurementWindow || null),
    outcomeMeasurement: a.outcome_measurement || a.outcomeMeasurement || null,
    confidenceScore: Number.isFinite(a.confidence) ? a.confidence : (Number.isFinite(a.confidenceScore) ? a.confidenceScore : null),
    matcherVersion: a.matcher_version || null,
    outcomeClassifierVersion: a.outcome_classifier_version || null,
    raw: a,
  };
}

function hasDecisionBasis(packet) {
  if (!packet || typeof packet !== 'object') return false;
  if (!Number.isFinite(packet.sampleSize) || packet.sampleSize <= 0) return false;
  if (!Number.isFinite(packet.denominator) || packet.denominator < packet.sampleSize) return false;
  if (!safeString(packet.confidenceBasis, '')) return false;
  if (!safeString(packet.sourceBasis, '')) return false;
  const windows = asArray(packet.timestampWindows);
  return windows.some(w => w && w.startUTC && w.endUTC);
}

function blocked(symbol, reason, generatedAtUTC, raw) {
  return {
    status: 'BLOCKED',
    usableForDecision: false,
    analogues: [],
    rejectedAnalogues: [],
    cohortSummary: 'No audit-grade historical analogue is available for this macro packet.',
    sampleSize: 0,
    denominator: 0,
    confidenceScore: 0,
    confidenceBasis: 'blocked: ' + (reason || 'no audit-grade analogue packet'),
    degradedReason: reason || 'no audit-grade analogue packet',
    generatedAtUTC,
    symbol,
    timestampWindows: [],
    sourceBasis: null,
    macroIntelligencePacket: raw && raw.macroIntelligencePacket ? raw.macroIntelligencePacket : null,
    rawCoreyClone: raw && raw.rawCoreyClone ? raw.rawCoreyClone : null,
  };
}

function partial(symbol, reason, generatedAtUTC, extra) {
  extra = extra || {};
  return Object.assign({
    status: 'PARTIAL',
    usableForDecision: false,
    analogues: [],
    rejectedAnalogues: [],
    cohortSummary: 'Historical analogue check ran but did not produce decision-grade support.',
    sampleSize: 0,
    denominator: 0,
    confidenceScore: 0,
    confidenceBasis: 'partial: ' + (reason || 'incomplete analogue evidence'),
    degradedReason: reason || 'incomplete analogue evidence',
    generatedAtUTC,
    symbol,
    timestampWindows: [],
    sourceBasis: null,
  }, extra);
}

function classify(raw, macroIntelligencePacket, generatedAtUTC) {
  const symbol = deriveSymbol(macroIntelligencePacket);
  if (!raw || typeof raw !== 'object') {
    return blocked(symbol, 'corey_clone returned no packet', generatedAtUTC, { macroIntelligencePacket });
  }

  const rawStatus = String(raw.status || '').toUpperCase();
  const rawReason = raw.reason || raw.degradedReason || null;
  const rawAnalogues = asArray(raw.analogues);
  const accepted = [];
  const rejected = [];

  for (let i = 0; i < rawAnalogues.length; i++) {
    const a = rawAnalogues[i];
    const v = validator.validateAnalogue(a);
    const n = normaliseAnalogue(a);
    if (v.ok) accepted.push(n);
    else rejected.push({ index: i, analogue: n, reason: v.errors.join('; ') });
  }

  const denominator = Number.isFinite(raw.denominator_pre_filter)
    ? raw.denominator_pre_filter
    : accepted.reduce((max, a) => Math.max(max, Number(a.denominator) || 0), 0);
  const sampleSize = Number.isFinite(raw.accepted_analogue_count)
    ? raw.accepted_analogue_count
    : accepted.length;
  const confidenceScore = Number.isFinite(raw.confidence)
    ? raw.confidence
    : (Number.isFinite(raw.score) ? raw.score : 0);
  const timestampWindows = accepted.map(a => a.timestampWindow).filter(Boolean);
  const firstSource = accepted[0] && accepted[0].sourceBasis;
  const sourceBasis = firstSource || (raw.auditTrail && raw.auditTrail.sourceDataset
    ? JSON.stringify(raw.auditTrail.sourceDataset)
    : null);
  const dominant = raw.baseRateStats
    ? Object.keys(raw.baseRateStats).sort((a, b) => raw.baseRateStats[b] - raw.baseRateStats[a])[0]
    : null;
  const confidenceBasis = [
    'sampleSize=' + sampleSize,
    'denominator=' + denominator,
    dominant ? 'dominantOutcome=' + dominant : null,
    Number.isFinite(confidenceScore) ? 'confidence=' + confidenceScore.toFixed(2) : null,
    raw.matcher_version ? 'matcher=' + raw.matcher_version : null,
  ].filter(Boolean).join(' · ');

  if (!accepted.length) {
    const reason = rawReason || (rawStatus === 'UNAVAILABLE' ? 'underlying analogue engine unavailable' : 'no audit-grade analogues survived validation');
    return rawStatus === 'PARTIAL'
      ? partial(symbol, reason, generatedAtUTC, {
          rejectedAnalogues: rejected,
          denominator: Number(raw.denominator_pre_filter) || 0,
          confidenceBasis: 'partial: ' + reason,
          rawCoreyClone: raw,
          macroIntelligencePacket,
        })
      : blocked(symbol, reason, generatedAtUTC, { rawCoreyClone: raw, macroIntelligencePacket });
  }

  const packet = {
    status: rejected.length || rawStatus === 'PARTIAL' ? 'PARTIAL' : 'OK',
    usableForDecision: false,
    analogues: accepted,
    rejectedAnalogues: rejected,
    cohortSummary: sampleSize + ' audit-grade analogue' + (sampleSize === 1 ? '' : 's') +
      ' accepted from denominator ' + denominator +
      (dominant ? '; dominant outcome ' + dominant : ''),
    sampleSize,
    denominator,
    confidenceScore: Math.max(0, Math.min(1, confidenceScore || 0)),
    confidenceBasis,
    degradedReason: rejected.length ? ('rejected_' + rejected.length + '_analogue' + (rejected.length === 1 ? '' : 's')) : (rawStatus === 'PARTIAL' ? rawReason : null),
    generatedAtUTC,
    symbol,
    timestampWindows,
    sourceBasis,
    outcomeDistribution: raw.outcomeDistribution || null,
    baseRateStats: raw.baseRateStats || null,
    limitations: asArray(raw.limitations),
    macroIntelligencePacket,
    rawCoreyClone: raw,
  };
  packet.usableForDecision = packet.status === 'OK' && hasDecisionBasis(packet);
  if (!packet.usableForDecision && packet.status === 'OK') {
    packet.status = 'PARTIAL';
    packet.degradedReason = 'missing decision basis: sample size, denominator, timestamp window, source basis, or confidence basis';
  }
  return packet;
}

async function findHistoricalAnalogues(macroIntelligencePacket, opts) {
  opts = opts || {};
  const generatedAtUTC = nowIso();
  const symbol = deriveSymbol(macroIntelligencePacket);
  if (!macroIntelligencePacket || typeof macroIntelligencePacket !== 'object') {
    return blocked(symbol, 'missing macroIntelligencePacket from Corey', generatedAtUTC, { macroIntelligencePacket: null });
  }
  try {
    const raw = await coreyCloneRun(symbol, Object.assign({}, opts, { macroIntelligencePacket }));
    return classify(raw, macroIntelligencePacket, generatedAtUTC);
  } catch (e) {
    return blocked(symbol, 'corey_clone exception: ' + (e && e.message ? e.message : String(e)), generatedAtUTC, { macroIntelligencePacket });
  }
}

module.exports = {
  findHistoricalAnalogues,
  hasDecisionBasis,
  _private: { classify, normaliseAnalogue, timestampWindowFromAnalogue },
};
