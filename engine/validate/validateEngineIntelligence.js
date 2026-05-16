'use strict';

// ============================================================
// engine/validate/validateEngineIntelligence.js
//
// Operator brief 2026-05-17 (assurance directive): read-only
// validators over engine intelligence packets. These do NOT
// modify Corey / Corey Clone / Spidey / Jane — they consume
// the engine's output and return a status block:
//   { status: OK | PARTIAL | BLOCKED, confidenceScore,
//     confidenceBasis, missingInputs, staleInputs,
//     degradedReason, sourceUsed, generatedAtUTC }
//
// FOH packet builders consume these status blocks and surface
// degradation honestly.
// ============================================================

function _isNonEmptyString(s) { return typeof s === 'string' && s.trim().length > 0; }
function _isNonEmptyArray(a) { return Array.isArray(a) && a.length > 0; }

function _statusFor(missing, totalRequired) {
  if (missing.length === 0) return 'OK';
  if (missing.length >= totalRequired) return 'BLOCKED';
  return 'PARTIAL';
}

// ─── COREY (macro intelligence) ──────────────────────────────
const COREY_REQUIRED = [
  'regime', 'activeEvents', 'sessionContext',
  'affectedMarkets', 'dxyState', 'vixState', 'yieldState',
  'riskCondition', 'expectedSensitivity', 'sourceUsed',
  'confidenceBasis',
];
function validateCorey(coreyOutput) {
  const c = coreyOutput || {};
  const missing = [];
  for (const k of COREY_REQUIRED) {
    const v = c[k];
    if (v == null) missing.push(k);
    else if (typeof v === 'string' && !v.trim().length) missing.push(k);
    else if (Array.isArray(v) && !v.length) missing.push(k);
  }
  if (_isNonEmptyString(c.expectedSensitivity) && /^depends on surprise$/i.test(c.expectedSensitivity.trim())) {
    missing.push('expectedSensitivity:generic_only');
  }
  const status = _statusFor(missing, COREY_REQUIRED.length);
  return {
    engine: 'corey',
    status,
    confidenceScore: status === 'OK' ? 1 : status === 'PARTIAL' ? 0.5 : 0,
    confidenceBasis: c.confidenceBasis || 'engine-derived',
    missingInputs: missing,
    staleInputs: c.staleInputs || [],
    degradedReason: status === 'OK' ? null : ('missing_or_generic:' + missing.join(',')),
    sourceUsed: c.sourceUsed || null,
    generatedAtUTC: c.generatedAtUTC || null,
  };
}

// ─── COREY CLONE (historical analogue intelligence) ──────────
const COREY_CLONE_REQUIRED_PER_ANALOGUE = [
  'instrument', 'windowStartUTC', 'windowEndUTC',
  'matchTimeframe', 'cohortSampleSize', 'denominator',
  'matchingVariables', 'sourceDataset', 'outcomeLabel',
  'outcomeMeasurementWindow', 'confidenceScore',
];
function validateCoreyClone(cloneOutput) {
  const c = cloneOutput || {};
  const analogues = Array.isArray(c.analogues) ? c.analogues : [];
  const valid = [];
  const dropped = [];
  for (const a of analogues) {
    const missing = COREY_CLONE_REQUIRED_PER_ANALOGUE.filter(k => a == null || a[k] == null || (typeof a[k] === 'string' && !a[k].trim().length) || (Array.isArray(a[k]) && !a[k].length));
    if (missing.length === 0) valid.push(a);
    else dropped.push({ a, missing });
  }
  let status;
  if (valid.length === 0) status = 'BLOCKED';
  else if (dropped.length > 0) status = 'PARTIAL';
  else status = 'OK';
  return {
    engine: 'coreyClone',
    status,
    confidenceScore: valid.length ? Math.min(1, valid.length / 3) : 0,
    confidenceBasis: status === 'BLOCKED' ? 'no audit-grade analogues met matching variables' : 'audit-grade-' + valid.length + '-of-' + analogues.length,
    missingInputs: status === 'BLOCKED' ? ['no_audit_grade_analogues'] : [],
    droppedAnalogues: dropped.length,
    validAnalogues: valid.length,
    staleInputs: c.staleInputs || [],
    degradedReason: status === 'OK' ? null : 'dropped_' + dropped.length + '_of_' + analogues.length,
    sourceUsed: c.sourceUsed || null,
    generatedAtUTC: c.generatedAtUTC || null,
  };
}

// ─── SPIDEY (structure / price intelligence) ─────────────────
const SPIDEY_REQUIRED = [
  'currentPrice', 'activeStructure', 'liquidityZones',
  'reactionLevels', 'supportZones', 'resistanceZones',
  'invalidationLevels', 'targetZones', 'timeframe',
  'confirmationCondition', 'cancellationCondition',
  'priceMap', 'structureConfidence',
];
function validateSpidey(spideyOutput) {
  const s = spideyOutput || {};
  const missing = [];
  for (const k of SPIDEY_REQUIRED) {
    const v = s[k];
    if (v == null) missing.push(k);
    else if (typeof v === 'string' && !v.trim().length) missing.push(k);
    else if (Array.isArray(v) && !v.length) missing.push(k);
  }
  // priceMap entries must each carry whyMatters / confirmation /
  // invalidation. Naked price levels are a hard fail.
  if (_isNonEmptyArray(s.priceMap)) {
    for (let i = 0; i < s.priceMap.length; i++) {
      const p = s.priceMap[i];
      if (!p || !_isNonEmptyString(p.whyMatters)) missing.push('priceMap[' + i + '].whyMatters');
      if (!p || !_isNonEmptyString(p.confirmation)) missing.push('priceMap[' + i + '].confirmation');
      if (!p || !_isNonEmptyString(p.invalidation)) missing.push('priceMap[' + i + '].invalidation');
    }
  }
  const status = _statusFor(missing, SPIDEY_REQUIRED.length);
  return {
    engine: 'spidey',
    status,
    confidenceScore: status === 'OK' ? 1 : status === 'PARTIAL' ? 0.5 : 0,
    confidenceBasis: s.confidenceBasis || (s.structureConfidence != null ? 'structure-confidence-' + s.structureConfidence : 'engine-derived'),
    missingInputs: missing,
    staleInputs: s.staleInputs || [],
    degradedReason: status === 'OK' ? null : ('missing:' + missing.join(',')),
    sourceUsed: s.sourceUsed || null,
    generatedAtUTC: s.generatedAtUTC || null,
  };
}

// ─── JANE (decision / synthesis intelligence) ────────────────
const JANE_REQUIRED = [
  'actionState', 'setupQuality', 'macroAlignment',
  'structureAlignment', 'historicalAnalogueAlignment',
  'eventRisk', 'conflictNotes', 'reasonForDecision',
  'upgradeCondition', 'downgradeCondition', 'invalidation',
  'confidenceScore', 'confidenceBasis',
];
function validateJane(janeOutput, upstreamStatuses) {
  const j = janeOutput || {};
  const missing = [];
  for (const k of JANE_REQUIRED) {
    const v = j[k];
    if (v == null) missing.push(k);
    else if (typeof v === 'string' && !v.trim().length) missing.push(k);
  }
  // Jane must not weight Corey Clone if the analogue packet is BLOCKED.
  const cloneStatus = (upstreamStatuses && upstreamStatuses.coreyClone && upstreamStatuses.coreyClone.status) || null;
  if (cloneStatus === 'BLOCKED' && j.historicalAnalogueWeight && Number(j.historicalAnalogueWeight) > 0) {
    missing.push('jane_weights_blocked_clone');
  }
  // Jane must surface conflict when Corey + Spidey disagree.
  if (upstreamStatuses && upstreamStatuses.corey && upstreamStatuses.spidey) {
    const cBias = String((upstreamStatuses.corey && upstreamStatuses.corey.bias) || '').toUpperCase();
    const sBias = String((upstreamStatuses.spidey && upstreamStatuses.spidey.bias) || '').toUpperCase();
    if (cBias && sBias && cBias !== sBias && !_isNonEmptyString(j.conflictNotes)) {
      missing.push('jane_silent_on_corey_spidey_conflict');
    }
  }
  const status = _statusFor(missing, JANE_REQUIRED.length);
  return {
    engine: 'jane',
    status,
    confidenceScore: status === 'OK' ? (Number(j.confidenceScore) || 1) : status === 'PARTIAL' ? 0.5 : 0,
    confidenceBasis: j.confidenceBasis || 'engine-derived',
    missingInputs: missing,
    staleInputs: j.staleInputs || [],
    degradedReason: status === 'OK' ? null : ('missing_or_unjustified:' + missing.join(',')),
    sourceUsed: j.sourceUsed || null,
    generatedAtUTC: j.generatedAtUTC || null,
  };
}

module.exports = {
  validateCorey,
  validateCoreyClone,
  validateSpidey,
  validateJane,
  COREY_REQUIRED,
  COREY_CLONE_REQUIRED_PER_ANALOGUE,
  SPIDEY_REQUIRED,
  JANE_REQUIRED,
};
