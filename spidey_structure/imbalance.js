'use strict';

// ============================================================
// spidey_structure/imbalance.js
//
// Fair-Value-Gap / imbalance detector. A bullish FVG forms when
// 3 consecutive candles have candle[i-1].high < candle[i+1].low
// — i.e., a price range that was not traded by both directions.
// Symmetrical for bearish FVGs.
//
// Each FVG carries:
//   - top / bottom price
//   - source candle index
//   - mitigation state (untouched / partially_filled / mitigated)
// ============================================================

function detectFVGs(candles) {
  if (!Array.isArray(candles) || candles.length < 5) return [];
  const fvgs = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const cur  = candles[i];
    const next = candles[i + 1];
    // Bullish FVG: previous candle high is below next candle low.
    if (prev.high < next.low) {
      const top = next.low;
      const bottom = prev.high;
      // Walk subsequent candles to compute mitigation state.
      let mitigation = 'UNTOUCHED';
      for (let k = i + 2; k < candles.length; k++) {
        const c = candles[k];
        if (c.low <= bottom) { mitigation = 'MITIGATED'; break; }
        if (c.low < top) { mitigation = 'PARTIALLY_FILLED'; }
      }
      fvgs.push({
        type: 'BULLISH_FVG',
        sourceCandleIndex: i,
        top, bottom,
        timeFormed: cur.time,
        height: top - bottom,
        mitigation,
        interpretation: mitigation === 'UNTOUCHED' ? 'fresh imbalance — price often returns to fill before continuation' : mitigation,
      });
    }
    // Bearish FVG: previous candle low is above next candle high.
    if (prev.low > next.high) {
      const top = prev.low;
      const bottom = next.high;
      let mitigation = 'UNTOUCHED';
      for (let k = i + 2; k < candles.length; k++) {
        const c = candles[k];
        if (c.high >= top) { mitigation = 'MITIGATED'; break; }
        if (c.high > bottom) { mitigation = 'PARTIALLY_FILLED'; }
      }
      fvgs.push({
        type: 'BEARISH_FVG',
        sourceCandleIndex: i,
        top, bottom,
        timeFormed: cur.time,
        height: top - bottom,
        mitigation,
        interpretation: mitigation === 'UNTOUCHED' ? 'fresh imbalance — price often returns to fill before continuation' : mitigation,
      });
    }
  }
  // Return the most recent 8 (deepest evidence) for surface use.
  return fvgs.slice(-8);
}

module.exports = { detectFVGs };
