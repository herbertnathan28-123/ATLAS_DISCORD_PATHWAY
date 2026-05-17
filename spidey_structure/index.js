'use strict';

// ============================================================
// spidey_structure/index.js
//
// Phase D Spidey orchestrator. Consumes OHLC candle arrays by
// timeframe and produces the full structure intelligence packet
// per operator brief 2026-05-17 (Spidey Phase D Activation Order).
//
// Input contract:
//   {
//     htf: { '1W': candles, '1D': candles, '4H': candles, '1H': candles },
//     ltf: { '15M': candles, '5M': candles, '1M': candles },
//     symbol, now, sessionHint? (override for tests)
//   }
//
// Each candles array is [{ time, open, high, low, close, volume? }]
// in chronological order (oldest first).
// ============================================================

const swing       = require('./swingPivots');
const bos         = require('./bos');
const choch       = require('./choch');
const liquidity   = require('./liquidity');
const displacement = require('./displacement');
const imbalance   = require('./imbalance');
const supplyDemand = require('./supplyDemand');
const keyLevels   = require('./keyLevels');
const session     = require('./session');
const confidence  = require('./confidence');

function _analyseFrame(candles) {
  if (!Array.isArray(candles) || candles.length < 12) {
    return { ok: false, reason: 'insufficient_candles', candleCount: Array.isArray(candles) ? candles.length : 0 };
  }
  const pivots = swing.detectPivots(candles, { left: 3, right: 3 });
  const seq = swing.labelSequence(pivots.highs, pivots.lows);
  const bias = swing.trendBiasFromSequence(seq);
  const bosRes = bos.detectBOS(candles, seq, {});
  const chochRes = choch.detectCHoCH(candles, seq, bosRes);
  const liqRes = liquidity.detectLiquidity(candles, seq);
  const disp = displacement.detectDisplacement(candles, {});
  const fvgs = imbalance.detectFVGs(candles);
  const zones = supplyDemand.detectSupplyDemand(candles, bosRes);
  return {
    ok: true,
    candleCount: candles.length,
    pivots,
    sequence: seq,
    bias,
    bos: bosRes,
    choch: chochRes,
    liquidity: liqRes,
    displacement: disp,
    fvgs,
    zones,
  };
}

function buildInvalidation(htfFrame, ltfFrame) {
  // The invalidation level for the current structural read is the
  // opposite-side protected pivot from the latest LTF BOS.
  const lt = ltfFrame && ltfFrame.ok ? ltfFrame : null;
  const ht = htfFrame && htfFrame.ok ? htfFrame : null;
  if (!lt && !ht) return null;
  const frame = lt || ht;
  if (frame.bos && frame.bos.bullishBOS) {
    // Bullish — invalidation is below the most recent HL.
    const lastHL = frame.sequence.slice().reverse().find(p => p.label === 'HL' || p.label === 'L1');
    if (lastHL) return { level: lastHL.price, side: 'below', reason: 'close below latest HL invalidates the bullish structural read', referencePivot: lastHL };
  }
  if (frame.bos && frame.bos.bearishBOS) {
    const lastLH = frame.sequence.slice().reverse().find(p => p.label === 'LH' || p.label === 'H1');
    if (lastLH) return { level: lastLH.price, side: 'above', reason: 'close above latest LH invalidates the bearish structural read', referencePivot: lastLH };
  }
  if (frame.bias === 'BULLISH') {
    const lastLow = frame.pivots.lows[frame.pivots.lows.length - 1];
    if (lastLow) return { level: lastLow.price, side: 'below', reason: 'close below latest swing low invalidates the bullish read', referencePivot: lastLow };
  }
  if (frame.bias === 'BEARISH') {
    const lastHigh = frame.pivots.highs[frame.pivots.highs.length - 1];
    if (lastHigh) return { level: lastHigh.price, side: 'above', reason: 'close above latest swing high invalidates the bearish read', referencePivot: lastHigh };
  }
  return null;
}

function buildExecutionTrigger(ltfFrame) {
  if (!ltfFrame || !ltfFrame.ok) return null;
  // Bullish trigger = body close above the LTF reaction band derived
  // from the most recent BULLISH_BOS protected level. If there's no
  // BOS yet, the trigger is the most recent LH price (for bullish
  // continuation watching a LH-break).
  if (ltfFrame.bos && ltfFrame.bos.bullishBOS) {
    return { direction: 'LONG', triggerLevel: ltfFrame.bos.bullishBOS.protectedLevel, confirmRule: 'body close above ' + ltfFrame.bos.bullishBOS.protectedLevel + ' on the trigger timeframe + next candle holds the level' };
  }
  if (ltfFrame.bos && ltfFrame.bos.bearishBOS) {
    return { direction: 'SHORT', triggerLevel: ltfFrame.bos.bearishBOS.protectedLevel, confirmRule: 'body close below ' + ltfFrame.bos.bearishBOS.protectedLevel + ' on the trigger timeframe + next candle holds the level' };
  }
  return null;
}

function analyseStructure(input) {
  const out = {
    authority: 'structure',
    symbol: (input && input.symbol) || null,
    timestamp: new Date().toISOString(),
    _phase: 'D',
  };
  const now = (input && input.now) || Date.now();
  const sessionInfo = session.detectSession(now);

  const htf = (input && input.htf) || {};
  const ltf = (input && input.ltf) || {};

  const htfFrames = {};
  for (const tf of ['1W', '1D', '4H', '1H']) htfFrames[tf] = _analyseFrame(htf[tf]);
  const ltfFrames = {};
  for (const tf of ['15M', '5M', '1M']) ltfFrames[tf] = _analyseFrame(ltf[tf]);

  // Pick the senior usable HTF frame for directional read.
  const seniorHTF = ['1D', '4H', '1W', '1H'].map(k => htfFrames[k]).find(f => f && f.ok) || null;
  const seniorLTF = ['15M', '5M', '1M'].map(k => ltfFrames[k]).find(f => f && f.ok) || null;
  const htfBias = seniorHTF ? seniorHTF.bias : 'NEUTRAL';
  const ltfBias = seniorLTF ? seniorLTF.bias : 'NEUTRAL';

  // BOS bias = sign of the latest BOS event on the LTF frame.
  let bosBias = 'NEUTRAL';
  let activeBOS = null;
  if (seniorLTF && seniorLTF.bos) {
    if (seniorLTF.bos.bullishBOS) { bosBias = 'BULLISH'; activeBOS = seniorLTF.bos.bullishBOS; }
    if (seniorLTF.bos.bearishBOS) {
      // Most recent wins.
      if (!activeBOS || seniorLTF.bos.bearishBOS.confirmCandleIndex > activeBOS.confirmCandleIndex) {
        bosBias = 'BEARISH';
        activeBOS = seniorLTF.bos.bearishBOS;
      }
    }
  }
  const activeCHoCH = seniorLTF && seniorLTF.choch ? seniorLTF.choch : null;

  // Combined liquidity + displacement + FVG + zones from senior LTF.
  const sweeps = seniorLTF && seniorLTF.liquidity ? seniorLTF.liquidity.sweeps : [];
  const equalHighs = seniorLTF && seniorLTF.liquidity ? seniorLTF.liquidity.equalHighs : [];
  const equalLows  = seniorLTF && seniorLTF.liquidity ? seniorLTF.liquidity.equalLows  : [];
  const disp = seniorLTF ? seniorLTF.displacement : [];
  const fvgs = seniorLTF ? seniorLTF.fvgs : [];
  const zones = seniorLTF ? seniorLTF.zones : [];

  // Key levels from senior LTF closing price.
  const klevels = seniorLTF && seniorLTF.candleCount ? keyLevels.detectKeyLevels((input.ltf && (input.ltf['15M'] || input.ltf['5M'] || input.ltf['1M'])) || []) : [];

  // Confidence aggregate.
  const conf = confidence.computeConfidence({
    htfBias, ltfBias, bosBias,
    choch: activeCHoCH,
    sweeps, displacement: disp, fvgs, zones,
    session: sessionInfo,
  });

  // Invalidation + execution trigger.
  const invalidation = buildInvalidation(seniorHTF, seniorLTF);
  const executionTrigger = buildExecutionTrigger(seniorLTF);

  // Final structure read: combine HTF + LTF bias.
  let structureBias = 'NEUTRAL';
  if (htfBias === ltfBias && htfBias !== 'NEUTRAL') structureBias = htfBias;
  else if (htfBias !== 'NEUTRAL' && ltfBias === 'NEUTRAL') structureBias = htfBias;
  else if (htfBias === 'NEUTRAL' && ltfBias !== 'NEUTRAL') structureBias = ltfBias;

  // Did the LTF frame produce enough evidence?
  const enoughEvidence = !!(seniorHTF && seniorHTF.ok && seniorLTF && seniorLTF.ok);

  out.structureBias = structureBias;
  out.htf = {
    bias: htfBias,
    frames: Object.fromEntries(Object.entries(htfFrames).map(([k, f]) => [k, {
      ok: f.ok, candleCount: f.candleCount || 0, bias: f.ok ? f.bias : null,
      latestBOS: f.ok && f.bos ? (f.bos.bullishBOS || f.bos.bearishBOS || null) : null,
      latestCHoCH: f.ok ? f.choch : null,
    }])),
  };
  out.ltf = {
    bias: ltfBias,
    frames: Object.fromEntries(Object.entries(ltfFrames).map(([k, f]) => [k, {
      ok: f.ok, candleCount: f.candleCount || 0, bias: f.ok ? f.bias : null,
      latestBOS: f.ok && f.bos ? (f.bos.bullishBOS || f.bos.bearishBOS || null) : null,
      latestCHoCH: f.ok ? f.choch : null,
    }])),
  };
  out.activeBOS = activeBOS;
  out.activeCHoCH = activeCHoCH;
  out.liquidity = {
    sweeps, equalHighs, equalLows,
    retailPools: (sweeps && sweeps.length) ? sweeps.map(s => s.cluster) : [],
  };
  out.displacement = disp;
  out.fvgs = fvgs;
  out.supplyDemandZones = zones;
  out.keyLevels = klevels;
  out.session = sessionInfo;
  out.invalidation = invalidation;
  out.executionTrigger = executionTrigger;
  out.confidence = conf;
  out.structureConfidence = conf.score;
  out.score = conf.score;
  out.evidence = [
    { type: 'htf_bias',  data: htfBias  },
    { type: 'ltf_bias',  data: ltfBias  },
    { type: 'bos',       data: activeBOS },
    { type: 'choch',     data: activeCHoCH },
    { type: 'sweeps',    data: sweeps.length + ' detected' },
    { type: 'displacement', data: disp.length + ' candle(s)' },
    { type: 'fvgs',      data: fvgs.length + ' present' },
    { type: 'zones',     data: zones.length + ' identified' },
    { type: 'session',   data: sessionInfo.session },
  ];
  out.status = !enoughEvidence ? 'PARTIAL'
             : conf.score >= 0.50 ? 'ACTIVE'
             : conf.score >= 0.30 ? 'PARTIAL'
             : 'PARTIAL';
  out.timeframeRelevance = '15m';
  if (!enoughEvidence) {
    out.degradedReason = 'insufficient_candles_in_one_or_more_frames';
  }
  return out;
}

module.exports = { analyseStructure };
