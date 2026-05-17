'use strict';

// ============================================================
// spidey_structure/bos.js
//
// Break-of-Structure detector. Per operator doctrine:
//   - Requires BODY CLOSE beyond the prior protected structure
//   - Wick-only breaches are INVALID
//   - Momentum weighting (body magnitude × ATR ratio) recorded
// ============================================================

function _atr(candles, period) {
  if (!Array.isArray(candles) || candles.length < 2) return null;
  const n = Math.min(period || 14, candles.length - 1);
  let sum = 0;
  for (let i = candles.length - n; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    sum += tr;
  }
  return sum / n;
}

// Identify BOS events by walking the chronological pivot sequence
// and looking for body closes beyond the most recent protected
// high (for bullish BOS) or low (for bearish BOS).
function detectBOS(candles, pivotSeq, opts) {
  opts = opts || {};
  const events = [];
  if (!Array.isArray(candles) || !Array.isArray(pivotSeq) || candles.length < 5) return events;
  const atr = _atr(candles, 14) || 0;

  for (let i = 1; i < pivotSeq.length; i++) {
    const protectedPivot = pivotSeq[i - 1];
    if (!protectedPivot) continue;
    // Walk candles after the protected pivot looking for body close beyond.
    for (let k = protectedPivot.index + 1; k < candles.length; k++) {
      const c = candles[k];
      const bodyHigh = Math.max(c.open, c.close);
      const bodyLow  = Math.min(c.open, c.close);
      const bodySize = Math.abs(c.close - c.open);
      const atrRatio = atr > 0 ? bodySize / atr : 0;

      if (protectedPivot.kind === 'high' && c.close > protectedPivot.price && bodyLow < protectedPivot.price && bodyHigh > protectedPivot.price) {
        // Body crosses + closes above prior high → bullish BOS.
        events.push({
          type: 'BULLISH_BOS',
          protectedLevel: protectedPivot.price,
          protectedPivotIndex: protectedPivot.index,
          confirmCandleIndex: k,
          confirmCloseTime: c.time,
          closeAbove: c.close,
          bodySize,
          atrRatio,
          momentum: atrRatio >= 1 ? 'STRONG' : atrRatio >= 0.6 ? 'MODERATE' : 'WEAK',
          wickOnlyRejected: false,
        });
        break;
      }
      if (protectedPivot.kind === 'low' && c.close < protectedPivot.price && bodyHigh > protectedPivot.price && bodyLow < protectedPivot.price) {
        events.push({
          type: 'BEARISH_BOS',
          protectedLevel: protectedPivot.price,
          protectedPivotIndex: protectedPivot.index,
          confirmCandleIndex: k,
          confirmCloseTime: c.time,
          closeBelow: c.close,
          bodySize,
          atrRatio,
          momentum: atrRatio >= 1 ? 'STRONG' : atrRatio >= 0.6 ? 'MODERATE' : 'WEAK',
          wickOnlyRejected: false,
        });
        break;
      }
      // Wick-only breach (high above pivot but close back below) is
      // explicitly rejected — record it for liquidity-sweep detection.
      if (protectedPivot.kind === 'high' && c.high > protectedPivot.price && c.close <= protectedPivot.price) {
        events.push({
          type: 'WICK_REJECTED_BULLISH',
          protectedLevel: protectedPivot.price,
          confirmCandleIndex: k,
          confirmCloseTime: c.time,
          wickOnlyRejected: true,
        });
      }
      if (protectedPivot.kind === 'low' && c.low < protectedPivot.price && c.close >= protectedPivot.price) {
        events.push({
          type: 'WICK_REJECTED_BEARISH',
          protectedLevel: protectedPivot.price,
          confirmCandleIndex: k,
          confirmCloseTime: c.time,
          wickOnlyRejected: true,
        });
      }
    }
  }
  // Deduplicate — keep only the most recent BULLISH_BOS + BEARISH_BOS
  // pair so downstream consumers see the active structural break.
  const lastBull = events.filter(e => e.type === 'BULLISH_BOS').pop() || null;
  const lastBear = events.filter(e => e.type === 'BEARISH_BOS').pop() || null;
  const wickRejects = events.filter(e => e.wickOnlyRejected);
  return { bullishBOS: lastBull, bearishBOS: lastBear, wickRejects, atr };
}

module.exports = { detectBOS };
