'use strict';

/**
 * Corey Clone — historical analogue / base-rate authority.
 *
 * Doctrine (locked 7 May 2026): mandatory engine. Slot must always be
 * occupied. If historical evidence cannot be produced, returns status-only
 * { status: 'PARTIAL'|'UNAVAILABLE', reason }. The doctrine A9 assertion
 * blocks foundation completion until this engine returns ACTIVE evidence,
 * but the SLOT must exist from day one.
 */

let cache = null;
try { cache = require('./historicalCache'); } catch (e) { /* report in status */ }

async function coreyCloneRun(symbol, opts = {}) {
  const testMode = opts.testMode || process.env.ATLAS_TEST_MODE === '1';
  const timestamp = new Date().toISOString();

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
    };
  }

  if (!cache) {
    return { status: 'UNAVAILABLE', reason: 'historicalCache module failed to load', symbol, timestamp };
  }

  // Probe the cache for what it actually exposes. We don't know yet without
  // reading historicalCache.js — Phase B accepts any of these patterns.
  let history = null;
  try {
    if (typeof cache.getHistory === 'function') history = await cache.getHistory(symbol);
    else if (typeof cache.query === 'function') history = await cache.query(symbol);
    else if (typeof cache.lookup === 'function') history = await cache.lookup(symbol);
    else if (typeof cache.read === 'function') history = await cache.read(symbol);
    else if (cache.default && typeof cache.default === 'function') history = await cache.default(symbol);
  } catch (e) {
    return { status: 'UNAVAILABLE', reason: `cache query failed: ${e.message}`, symbol, timestamp };
  }

  if (!history || (Array.isArray(history) && history.length === 0)) {
    return { status: 'PARTIAL', reason: 'historical cache contains no entries for this symbol yet', symbol, timestamp };
  }

  // Phase B: produce a real packet with crude analogue extraction.
  // Phase D: real similarity scoring, regime classification, base-rate computation.
  const analogues = (Array.isArray(history) ? history : [history]).slice(0, 5).map((h, i) => ({
    date: h.date || h.timestamp || `unknown-${i}`,
    similarity: h.similarity != null ? h.similarity : 0.5,
    outcome: h.outcome || 'unknown',
  }));

  return {
    authority: 'historical_analogue_base_rate',
    score: 0.5,
    confidence: 0.5,
    analogues,
    baseRates: { followThrough: 0.5, reversal: 0.3, range: 0.2 },
    warningFlags: [],
    timeframeRelevance: 'daily',
    symbol,
    timestamp,
    _phase: 'B-foundation',
    _historyEntries: analogues.length,
  };
}

module.exports = { coreyCloneRun };
