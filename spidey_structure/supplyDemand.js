'use strict';

// ============================================================
// spidey_structure/supplyDemand.js
//
// Identifies the origin candle / block that caused a BOS.
// Demand zone: the down/neutral candle immediately preceding
// a bullish displacement that broke a prior pivot.
// Supply zone: symmetrical for bearish.
//
// Each zone carries:
//   - top / bottom price (defined by the origin candle high/low)
//   - freshness: untouched / partially_tested / mitigated
//   - efficiency: how much imbalance the displacement created
//     (proxy = displacement body / origin candle range)
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

function detectSupplyDemand(candles, bosResult) {
  const zones = [];
  if (!Array.isArray(candles) || candles.length < 5) return zones;
  const atr = _atr(candles, 14);

  function _classifyMitigation(zoneTop, zoneBottom, fromIdx, direction) {
    let mitigation = 'UNTOUCHED';
    for (let k = fromIdx + 1; k < candles.length; k++) {
      const c = candles[k];
      if (direction === 'DEMAND') {
        if (c.low < zoneBottom) { mitigation = 'MITIGATED'; break; }
        if (c.low <= zoneTop)    { mitigation = 'PARTIALLY_TESTED'; }
      } else { // SUPPLY
        if (c.high > zoneTop)    { mitigation = 'MITIGATED'; break; }
        if (c.high >= zoneBottom){ mitigation = 'PARTIALLY_TESTED'; }
      }
    }
    return mitigation;
  }

  if (bosResult && bosResult.bullishBOS) {
    const idx = bosResult.bullishBOS.confirmCandleIndex;
    // Walk backward to find the last non-bullish candle (the demand
    // origin: a down or neutral candle that gave way to the impulse).
    let originIdx = idx - 1;
    while (originIdx > 0 && candles[originIdx] && candles[originIdx].close > candles[originIdx].open) originIdx--;
    if (originIdx >= 0) {
      const o = candles[originIdx];
      const zoneTop = Math.max(o.open, o.close);
      const zoneBottom = o.low;
      const efficiency = atr > 0 ? bosResult.bullishBOS.bodySize / Math.max(o.high - o.low, atr) : null;
      zones.push({
        type: 'DEMAND_ZONE',
        originCandleIndex: originIdx,
        originTime: o.time,
        top: zoneTop, bottom: zoneBottom,
        freshness: _classifyMitigation(zoneTop, zoneBottom, idx, 'DEMAND'),
        efficiency: efficiency != null ? +efficiency.toFixed(3) : null,
        reason: 'origin candle preceding bullish BOS — institutional demand established here',
      });
    }
  }
  if (bosResult && bosResult.bearishBOS) {
    const idx = bosResult.bearishBOS.confirmCandleIndex;
    let originIdx = idx - 1;
    while (originIdx > 0 && candles[originIdx] && candles[originIdx].close < candles[originIdx].open) originIdx--;
    if (originIdx >= 0) {
      const o = candles[originIdx];
      const zoneTop = o.high;
      const zoneBottom = Math.min(o.open, o.close);
      const efficiency = atr > 0 ? bosResult.bearishBOS.bodySize / Math.max(o.high - o.low, atr) : null;
      zones.push({
        type: 'SUPPLY_ZONE',
        originCandleIndex: originIdx,
        originTime: o.time,
        top: zoneTop, bottom: zoneBottom,
        freshness: _classifyMitigation(zoneTop, zoneBottom, idx, 'SUPPLY'),
        efficiency: efficiency != null ? +efficiency.toFixed(3) : null,
        reason: 'origin candle preceding bearish BOS — institutional supply established here',
      });
    }
  }
  return zones;
}

module.exports = { detectSupplyDemand };
