'use strict';

// ============================================================
// spidey_structure/swingPivots.js
//
// Identifies swing highs and swing lows using a left/right
// confirmation rule. A pivot high at index i requires every
// candle's high within [i-L, i-1] AND [i+1, i+R] to be strictly
// lower than candles[i].high. Pivot lows symmetrical.
//
// Returns ordered pivot sequence with HH/HL/LH/LL labels relative
// to the prior same-side pivot.
// ============================================================

function detectPivots(candles, opts) {
  opts = opts || {};
  const L = Number.isFinite(opts.left)  ? opts.left  : 3;
  const R = Number.isFinite(opts.right) ? opts.right : 3;
  if (!Array.isArray(candles) || candles.length < L + R + 1) return { highs: [], lows: [] };
  const highs = [];
  const lows  = [];
  for (let i = L; i < candles.length - R; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow  = true;
    for (let j = i - L; j < i; j++) {
      if (candles[j].high >= c.high) { isHigh = false; }
      if (candles[j].low  <= c.low ) { isLow  = false; }
    }
    if (isHigh || isLow) {
      for (let j = i + 1; j <= i + R; j++) {
        if (candles[j].high >= c.high) { isHigh = false; }
        if (candles[j].low  <= c.low ) { isLow  = false; }
      }
    }
    if (isHigh) highs.push({ index: i, time: c.time, price: c.high, kind: 'high' });
    if (isLow)  lows .push({ index: i, time: c.time, price: c.low,  kind: 'low'  });
  }
  return { highs, lows };
}

function labelSequence(highs, lows) {
  // Walk the chronological merge of highs+lows; for each new high,
  // compare to the previous high; for each new low, compare to the
  // previous low. Label HH/LH on highs and HL/LL on lows.
  const merged = highs.concat(lows).sort((a, b) => a.index - b.index);
  let lastHigh = null;
  let lastLow  = null;
  return merged.map(p => {
    if (p.kind === 'high') {
      const label = !lastHigh ? 'H1'
        : (p.price > lastHigh.price ? 'HH' : 'LH');
      lastHigh = p;
      return Object.assign({}, p, { label });
    }
    const label = !lastLow ? 'L1'
      : (p.price < lastLow.price ? 'LL' : 'HL');
    lastLow = p;
    return Object.assign({}, p, { label });
  });
}

function trendBiasFromSequence(seq) {
  // Returns 'BULLISH' / 'BEARISH' / 'NEUTRAL' based on the last
  // 4-6 pivots. Bullish needs HH+HL agreement on the latest two
  // same-side pivots. Bearish needs LH+LL agreement. Anything
  // else is NEUTRAL.
  if (!Array.isArray(seq) || seq.length < 4) return 'NEUTRAL';
  const recent = seq.slice(-6);
  const lastHighs = recent.filter(p => p.kind === 'high').slice(-2);
  const lastLows  = recent.filter(p => p.kind === 'low').slice(-2);
  if (lastHighs.length === 2 && lastLows.length === 2) {
    const upH = lastHighs[1].price > lastHighs[0].price;
    const upL = lastLows[1].price  > lastLows[0].price;
    const dnH = lastHighs[1].price < lastHighs[0].price;
    const dnL = lastLows[1].price  < lastLows[0].price;
    if (upH && upL) return 'BULLISH';
    if (dnH && dnL) return 'BEARISH';
  }
  return 'NEUTRAL';
}

module.exports = { detectPivots, labelSequence, trendBiasFromSequence };
