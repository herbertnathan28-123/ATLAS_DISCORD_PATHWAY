'use strict';

/**
 * ATLAS packet contracts — locked 2026-05-07 (Astra doctrine).
 * Used by orchestrator, output surfaces, and any code path that needs to
 * validate it's holding a doctrine-shaped packet.
 *
 * Mirrored intentionally inside scripts/atlas_runtime_test.js for resilience.
 * If they diverge, the doctrine harness will fail — that IS the drift signal.
 */

const PACKET_CONTRACTS = {
  SpideyOutput: {
    required: {
      authority: 'structure',
      score: 'number',
      confidence: 'number',
      evidence: 'any',
      invalidation: 'any',
      timeframeRelevance: 'any',
    },
  },
  CoreyOutput: {
    required: {
      authority: 'current_macro_regime_event',
      score: 'number',
      confidence: 'number',
      evidence: 'any',
      timeframeRelevance: 'any',
    },
  },
  CoreyCloneOutput: {
    required: {
      authority: 'historical_analogue_base_rate',
      score: 'number',
      confidence: 'number',
    },
    statusOnlyAcceptable: ['PARTIAL', 'UNAVAILABLE'],
  },
  // Phase D extended contract (D.1.0.3). STRICT SUPERSET of CoreyCloneOutput.
  // Old fields preserved. Status-only PARTIAL/UNAVAILABLE remains acceptable.
  CoreyCloneOutputD: {
    required: {
      authority: 'historical_analogue_base_rate',
    },
    statusOnlyAcceptable: ['PARTIAL', 'UNAVAILABLE'],
    activeRequired: {
      score:                       'number',
      confidence:                  'number',
      symbol:                      'string',
      timestamp:                   'any',
      matcher_version:             'string',
      outcome_classifier_version:  'string',
      cacheStatus:                 'object',
      denominator_pre_filter:      'number',
      rejected_analogue_count:     'number',
      accepted_analogue_count:     'number',
      matching_variables:          'object',
      tolerances:                  'object',
      weights:                     'array',
      analogues:                   'array',
      outcomeDistribution:         'object',
      baseRateStats:               'object',
      limitations:                 'array',
      warningFlags:                'array',
      timeframeRelevance:          'any',
      auditTrail:                  'object',
    },
    partialFields: ['reason', 'denominator_pre_filter', 'rejected_analogue_count', 'rejection_reasons', 'cacheStatus', 'auditTrail'],
  },
  MacroOutput: {
    required: {
      authority: 'macro_normalisation',
      score: 'number',
      confidence: 'number',
      evidence: 'any',
    },
  },
  JaneInputPacket: {
    required: {
      symbol: 'string',
      spidey: 'object',
      corey: 'object',
      coreyClone: 'object',
      macro: 'object',
      sourceStatus: 'object',
    },
    sourceStatusRequired: ['spidey', 'corey', 'coreyClone', 'macro'],
    sourceStatusValues: ['ACTIVE', 'PARTIAL', 'UNAVAILABLE'],
  },
  JaneDecisionPacket: {
    required: {
      symbol: 'string',
      tradeViability: ['VALID', 'MARGINAL', 'INVALID'],
      finalBias: 'any',
      sourceStatus: 'object',
    },
  },
};

const SOURCE_STATUS_VALUES = ['ACTIVE', 'PARTIAL', 'UNAVAILABLE'];

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function validateField(value, expected) {
  if (expected === 'any') return value !== undefined ? null : 'missing';
  if (Array.isArray(expected)) {
    return expected.includes(value) ? null : `expected one of [${expected.join(', ')}], got ${JSON.stringify(value)}`;
  }
  if (['string', 'number', 'boolean', 'object', 'array', 'function'].includes(expected)) {
    const t = typeOf(value);
    return t === expected ? null : `expected ${expected}, got ${t}`;
  }
  return value === expected ? null : `expected literal '${expected}', got ${JSON.stringify(value)}`;
}

function validatePacket(packet, contractName) {
  const contract = PACKET_CONTRACTS[contractName];
  const result = { contract: contractName, valid: true, errors: [], statusOnly: false };
  if (!contract) { result.valid = false; result.errors.push(`Unknown contract: ${contractName}`); return result; }
  if (packet === null || packet === undefined) { result.valid = false; result.errors.push('Packet is null/undefined'); return result; }
  if (typeof packet !== 'object' || Array.isArray(packet)) { result.valid = false; result.errors.push(`Packet is ${typeOf(packet)}, expected object`); return result; }

  if (contractName === 'CoreyCloneOutput' && contract.statusOnlyAcceptable && packet.status && contract.statusOnlyAcceptable.includes(packet.status)) {
    result.statusOnly = true;
    result.statusValue = packet.status;
    return result;
  }

  for (const [field, expected] of Object.entries(contract.required)) {
    if (!(field in packet)) { result.valid = false; result.errors.push(`Missing required field: ${field}`); continue; }
    const err = validateField(packet[field], expected);
    if (err) { result.valid = false; result.errors.push(`${field}: ${err}`); }
  }

  if (contractName === 'JaneInputPacket' && packet.sourceStatus && typeof packet.sourceStatus === 'object') {
    for (const k of contract.sourceStatusRequired) {
      if (!(k in packet.sourceStatus)) { result.valid = false; result.errors.push(`sourceStatus.${k} missing`); }
      else if (!contract.sourceStatusValues.includes(packet.sourceStatus[k])) {
        result.valid = false;
        result.errors.push(`sourceStatus.${k}=${packet.sourceStatus[k]}, expected one of ${contract.sourceStatusValues.join('/')}`);
      }
    }
  }

  return result;
}

function statusFromValidation(v) {
  if (!v) return 'UNAVAILABLE';
  if (v.statusOnly) return v.statusValue;
  if (v.valid) return 'ACTIVE';
  return 'PARTIAL';
}

module.exports = {
  PACKET_CONTRACTS,
  SOURCE_STATUS_VALUES,
  validatePacket,
  validateField,
  statusFromValidation,
};
