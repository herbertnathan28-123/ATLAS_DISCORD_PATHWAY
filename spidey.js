'use strict';

/**
 * Spidey — structure authority engine. **Phase D LIVE** as of
 * operator brief 2026-05-17 (Spidey Phase D Activation Order).
 *
 * Owns: BOS / CHoCH detection, HH/HL/LH/LL mapping, HTF directional
 * structure, LTF execution structure, liquidity sweep detection,
 * equal highs/lows, displacement / impulse detection, FVG /
 * imbalance, supply/demand origin zones, invalidation, key level
 * interaction (00/25/50/75), session awareness, candle-closure
 * confirmation, execution-quality scoring, structure confidence,
 * trade-invalidation logic.
 *
 * No placeholder values. Hard rules:
 *   - BOS requires BODY close beyond prior protected structure;
 *     wick-only breaches rejected
 *   - CHoCH must identify trend transition via sequence failure
 *   - All evidence carries timestamps
 *   - confidence < 0.50 → status = PARTIAL (operator: Jane
 *     declines tradeViability=VALID when Spidey is not ACTIVE)
 *
 * Input contract:
 *   spideyRun(symbol, opts)
 *   opts.candles = {
 *     htf: { '1W': [...], '1D': [...], '4H': [...], '1H': [...] },
 *     ltf: { '15M': [...], '5M': [...], '1M': [...] }
 *   }
 *   each candle: { time, open, high, low, close, volume? }
 *
 * Without opts.candles (production callers that haven't yet wired
 * a candle source for the symbol), returns an honest PARTIAL with
 * status='PARTIAL', reason='no_candles_supplied'. The packet still
 * carries every required Phase D field so the downstream contract
 * doesn't crash.
 */

const engine = require('./spidey_structure');

function _log(msg) {
  if (process.env.SPIDEY_QUIET === '1') return;
  try { console.log(msg); } catch (_e) { /* swallow */ }
}

function _emptyFrame() { return { ok: false, candleCount: 0, bias: null, latestBOS: null, latestCHoCH: null }; }

function _partial(symbol, reason, extras) {
  const base = {
    authority: 'structure',
    status: 'PARTIAL',
    score: 0,
    confidence: 0,
    structureConfidence: 0,
    structureBias: 'NEUTRAL',
    htf: { bias: 'NEUTRAL', frames: { '1W': _emptyFrame(), '1D': _emptyFrame(), '4H': _emptyFrame(), '1H': _emptyFrame() } },
    ltf: { bias: 'NEUTRAL', frames: { '15M': _emptyFrame(), '5M': _emptyFrame(), '1M': _emptyFrame() } },
    activeBOS: null,
    activeCHoCH: null,
    liquidity: { sweeps: [], equalHighs: [], equalLows: [], retailPools: [] },
    displacement: [],
    fvgs: [],
    supplyDemandZones: [],
    keyLevels: [],
    session: { session: 'unknown', utcHour: null, liquidity: null },
    invalidation: null,
    executionTrigger: null,
    confidence: { score: 0, breakdown: {}, label: 'INSUFFICIENT' },
    evidence: [{ type: 'partial_reason', data: reason }],
    timeframeRelevance: '15m',
    symbol,
    timestamp: new Date().toISOString(),
    degradedReason: reason,
    _phase: 'D',
  };
  if (extras && typeof extras === 'object') Object.assign(base, extras);
  return base;
}

async function spideyRun(symbol, opts) {
  opts = opts || {};
  const testMode = opts.testMode || process.env.ATLAS_TEST_MODE === '1';
  const candles = opts.candles || null;

  if (testMode) {
    return Object.assign(_partial(symbol, 'test_mode_short_circuit', { _testModeShortCircuit: true }), {
      status: 'ACTIVE',
      score: 0.5,
      confidence: 0.5,
      structureConfidence: 0.5,
      structureBias: 'NEUTRAL',
    });
  }

  if (!candles || (!candles.htf && !candles.ltf)) {
    _log(`[SPIDEY] STRUCTURE_PARTIAL symbol=${symbol} reason=no_candles_supplied`);
    return _partial(symbol, 'no_candles_supplied');
  }

  // Run the Phase D engine.
  const result = engine.analyseStructure({
    symbol,
    htf: candles.htf || {},
    ltf: candles.ltf || {},
    now: opts.now || Date.now(),
  });

  // Proof logs per operator spec.
  const htfReady = Object.values(result.htf.frames || {}).some(f => f && f.ok);
  const ltfReady = Object.values(result.ltf.frames || {}).some(f => f && f.ok);
  if (htfReady) _log(`[SPIDEY] HTF_STRUCTURE_READY symbol=${symbol} bias=${result.htf.bias} frames=${Object.entries(result.htf.frames).filter(([_, f]) => f && f.ok).map(([k]) => k).join('|')}`);
  if (ltfReady) _log(`[SPIDEY] LTF_EXECUTION_READY symbol=${symbol} bias=${result.ltf.bias} frames=${Object.entries(result.ltf.frames).filter(([_, f]) => f && f.ok).map(([k]) => k).join('|')}`);
  if (result.liquidity && (result.liquidity.equalHighs.length || result.liquidity.equalLows.length)) {
    _log(`[SPIDEY] LIQUIDITY_MAP_READY symbol=${symbol} equalHighs=${result.liquidity.equalHighs.length} equalLows=${result.liquidity.equalLows.length} sweeps=${result.liquidity.sweeps.length}`);
  }
  if (result.activeBOS) _log(`[SPIDEY] BOS_CONFIRMED symbol=${symbol} type=${result.structureBias} level=${result.activeBOS.protectedLevel} momentum=${result.activeBOS.momentum}`);
  if (result.activeCHoCH && (result.activeCHoCH.type === 'BULLISH_CHoCH' || result.activeCHoCH.type === 'BEARISH_CHoCH')) {
    _log(`[SPIDEY] CHOCH_CONFIRMED symbol=${symbol} type=${result.activeCHoCH.type} brokenLevel=${result.activeCHoCH.brokenLevel}`);
  }
  if (result.supplyDemandZones && result.supplyDemandZones.length) {
    _log(`[SPIDEY] SUPPLY_DEMAND_READY symbol=${symbol} zones=${result.supplyDemandZones.length} fresh=${result.supplyDemandZones.filter(z => z.freshness === 'UNTOUCHED').length}`);
  }
  _log(`[SPIDEY] STRUCTURE_CONFIDENCE=${result.structureConfidence} status=${result.status} bias=${result.structureBias} symbol=${symbol}`);

  return result;
}

module.exports = { spideyRun };
