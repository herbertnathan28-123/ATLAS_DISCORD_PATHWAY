'use strict';

/**
 * Macro Engine — broader macro / event normalisation authority.
 * Distinct from Corey: Corey is *current* regime/event; Macro is the
 * normalised broader macro narrative (CPI, FOMC schedule, regional bias).
 *
 * Phase B: minimal valid packet. Phase D wires real macro feeds.
 */

async function macroRun(symbol, opts = {}) {
  const testMode = opts.testMode || process.env.ATLAS_TEST_MODE === '1';
  const timestamp = new Date().toISOString();

  if (testMode) {
    return {
      authority: 'macro_normalisation',
      score: 0.5,
      confidence: 0.5,
      evidence: [{ type: 'test_mode_stub', symbol }],
      events: [],
      timeframeRelevance: 'weekly',
      symbol,
      timestamp,
      _testModeShortCircuit: true,
    };
  }

  return {
    authority: 'macro_normalisation',
    score: 0.5,
    confidence: 0.4,
    evidence: [{ type: 'phase_b_placeholder', note: 'real macro normalisation pending Phase D' }],
    events: [],
    timeframeRelevance: 'weekly',
    symbol,
    timestamp,
    _phase: 'B-foundation',
  };
}

module.exports = { macroRun };
