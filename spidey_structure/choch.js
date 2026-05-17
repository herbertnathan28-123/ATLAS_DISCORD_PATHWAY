'use strict';

// ============================================================
// spidey_structure/choch.js
//
// Change-of-Character detector. CHoCH = trend transition. Per
// doctrine: requires a prior structure SEQUENCE FAILURE followed
// by a closure-confirmed counter-break.
//
// Example bullish→bearish CHoCH:
//   1. Trend was HH+HL (bullish)
//   2. Latest pivot fails the sequence: instead of new HH, price
//      prints a LOWER HIGH
//   3. Then price closes below the most recent HIGHER LOW
//      (counter-break with body close)
// ============================================================

function detectCHoCH(candles, pivotSeq, bosResult) {
  if (!Array.isArray(candles) || !Array.isArray(pivotSeq) || pivotSeq.length < 4) return null;

  // Walk pivots from oldest to newest; identify the last point
  // where the trend label flipped.
  let lastBullishCluster = false;
  let lastBearishCluster = false;
  let transitionAt = null;
  let transitionDirection = null;

  for (let i = 2; i < pivotSeq.length; i++) {
    const p2 = pivotSeq[i];
    const p1 = pivotSeq[i - 1];
    const p0 = pivotSeq[i - 2];
    // Bullish cluster signature: HH or HL recently.
    if ((p2.label === 'HH' || p2.label === 'HL') && (p1.label === 'HH' || p1.label === 'HL')) {
      if (lastBearishCluster) { transitionAt = p2; transitionDirection = 'BULLISH'; lastBearishCluster = false; }
      lastBullishCluster = true;
    }
    if ((p2.label === 'LL' || p2.label === 'LH') && (p1.label === 'LL' || p1.label === 'LH')) {
      if (lastBullishCluster) { transitionAt = p2; transitionDirection = 'BEARISH'; lastBullishCluster = false; }
      lastBearishCluster = true;
    }
  }
  if (!transitionAt) return null;

  // For confirmation: require a body close beyond the prior
  // structural pivot in the new direction within the last 20
  // candles after the transition.
  const startIdx = transitionAt.index;
  const lookahead = Math.min(candles.length, startIdx + 30);
  let confirmCandleIndex = null;
  let confirmClose = null;
  let confirmPrice = null;

  if (transitionDirection === 'BEARISH') {
    // Bearish CHoCH confirms when price closes below the most
    // recent HL prior to the transition.
    const lastHL = pivotSeq.slice(0, pivotSeq.indexOf(transitionAt)).reverse().find(p => p.label === 'HL' || p.label === 'L1');
    if (!lastHL) return null;
    for (let k = startIdx + 1; k < lookahead; k++) {
      const c = candles[k];
      if (c.close < lastHL.price) { confirmCandleIndex = k; confirmClose = c.close; confirmPrice = lastHL.price; break; }
    }
    if (confirmCandleIndex == null) return { type: 'BEARISH_CHoCH_PENDING', transitionPivot: transitionAt, awaitingCloseBelow: lastHL.price };
    return {
      type: 'BEARISH_CHoCH',
      transitionPivot: transitionAt,
      brokenLevel: confirmPrice,
      confirmCandleIndex,
      confirmClose,
      reason: 'sequence flipped from bullish HH/HL to bearish LH/LL; body close below prior HL confirms transition',
    };
  }
  if (transitionDirection === 'BULLISH') {
    const lastLH = pivotSeq.slice(0, pivotSeq.indexOf(transitionAt)).reverse().find(p => p.label === 'LH' || p.label === 'H1');
    if (!lastLH) return null;
    for (let k = startIdx + 1; k < lookahead; k++) {
      const c = candles[k];
      if (c.close > lastLH.price) { confirmCandleIndex = k; confirmClose = c.close; confirmPrice = lastLH.price; break; }
    }
    if (confirmCandleIndex == null) return { type: 'BULLISH_CHoCH_PENDING', transitionPivot: transitionAt, awaitingCloseAbove: lastLH.price };
    return {
      type: 'BULLISH_CHoCH',
      transitionPivot: transitionAt,
      brokenLevel: confirmPrice,
      confirmCandleIndex,
      confirmClose,
      reason: 'sequence flipped from bearish LH/LL to bullish HH/HL; body close above prior LH confirms transition',
    };
  }
  return null;
}

module.exports = { detectCHoCH };
