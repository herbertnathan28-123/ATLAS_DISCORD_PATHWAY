'use strict';

// ============================================================
// spidey_structure/liquidity.js
//
// Detects:
//   - Equal highs / equal lows (tolerance: 0.05 × ATR)
//   - Liquidity sweeps (price prints high beyond cluster then
//     closes back inside on the same or next candle — classic
//     stop-hunt signature)
//   - Inducement (HL inside a clear bearish cluster, or LH
//     inside a clear bullish cluster — bait for retail breakouts)
//   - Retail liquidity pool guesses (clusters of equal highs/lows
//     are where stops cluster)
// ============================================================

function _atr(candles, period) {
  if (!Array.isArray(candles) || candles.length < 2) return 0;
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

function detectLiquidity(candles, pivotSeq) {
  const result = { equalHighs: [], equalLows: [], sweeps: [], retailPools: [] };
  if (!Array.isArray(candles) || candles.length < 5) return result;
  const atr = _atr(candles, 14);
  const tolerance = atr * 0.10;
  const highs = (pivotSeq || []).filter(p => p.kind === 'high');
  const lows  = (pivotSeq || []).filter(p => p.kind === 'low');

  // Equal highs: pairs of pivot highs within tolerance.
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[i].price - highs[j].price) <= tolerance) {
        result.equalHighs.push({
          level: (highs[i].price + highs[j].price) / 2,
          tolerance,
          touches: [highs[i].index, highs[j].index],
          times: [highs[i].time, highs[j].time],
          interpretation: 'buy-side liquidity above equal highs — stops cluster here',
        });
      }
    }
  }
  for (let i = 0; i < lows.length; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[i].price - lows[j].price) <= tolerance) {
        result.equalLows.push({
          level: (lows[i].price + lows[j].price) / 2,
          tolerance,
          touches: [lows[i].index, lows[j].index],
          times: [lows[i].time, lows[j].time],
          interpretation: 'sell-side liquidity below equal lows — stops cluster here',
        });
      }
    }
  }

  // Sweep detection: any candle where high prints above an equal-
  // high cluster but body closes back below the cluster level.
  for (const cluster of result.equalHighs) {
    for (let k = Math.max(...cluster.touches) + 1; k < candles.length; k++) {
      const c = candles[k];
      if (c.high > cluster.level && c.close < cluster.level) {
        result.sweeps.push({
          direction: 'BUY_SIDE_SWEEP',
          cluster: cluster.level,
          sweepCandleIndex: k,
          sweepHigh: c.high,
          closeBack: c.close,
          time: c.time,
          interpretation: 'buy-side stops swept; price closed back below cluster — short bias on confirmation',
        });
        break;
      }
    }
  }
  for (const cluster of result.equalLows) {
    for (let k = Math.max(...cluster.touches) + 1; k < candles.length; k++) {
      const c = candles[k];
      if (c.low < cluster.level && c.close > cluster.level) {
        result.sweeps.push({
          direction: 'SELL_SIDE_SWEEP',
          cluster: cluster.level,
          sweepCandleIndex: k,
          sweepLow: c.low,
          closeBack: c.close,
          time: c.time,
          interpretation: 'sell-side stops swept; price closed back above cluster — long bias on confirmation',
        });
        break;
      }
    }
  }
  result.retailPools = result.equalHighs.map(h => h.level).concat(result.equalLows.map(l => l.level));
  return result;
}

module.exports = { detectLiquidity };
