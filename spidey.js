'use strict';

/**
 * Spidey — structure authority evidence engine.
 * Owns: HH/HL detection, breaks, pivot reclaim, liquidity alignment, executable mechanism.
 *
 * Phase B: produces correctly-shaped SpideyOutput with placeholder scoring so
 * the foundation pipeline can flow. Phase D replaces the body with real
 * structure analysis driven by chart data.
 */

async function spideyRun(symbol, opts = {}) {
  const testMode = opts.testMode || process.env.ATLAS_TEST_MODE === '1';
  const timestamp = new Date().toISOString();

  if (testMode) {
    return {
      authority: 'structure',
      score: 0.5,
      confidence: 0.5,
      evidence: [{ type: 'test_mode_stub', symbol }],
      invalidation: null,
      timeframeRelevance: '15m',
      symbol,
      timestamp,
      _testModeShortCircuit: true,
    };
  }

  // Phase D: read live structure here. For Phase B, return a neutral packet.
  return {
    authority: 'structure',
    score: 0.5,
    confidence: 0.4,
    evidence: [{ type: 'phase_b_placeholder', note: 'real structure analysis pending Phase D' }],
    invalidation: null,
    timeframeRelevance: '15m',
    symbol,
    timestamp,
    _phase: 'B-foundation',
  };
}

module.exports = { spideyRun };
