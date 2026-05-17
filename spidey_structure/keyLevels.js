'use strict';

// ============================================================
// spidey_structure/keyLevels.js
//
// Round-number key levels (00, 25, 50, 75) — stop-cluster zones
// that act as magnets and rejection levels. The exact level
// depends on the instrument scale.
//
// For FX major pairs trading near 1.0928, the 25-cent grid is
// 1.0900 / 1.0925 / 1.0950 / 1.0975 / 1.1000. For gold near
// 2410 it's 2400 / 2425 / 2450 / 2475. Scale auto-detected
// from the candle range.
// ============================================================

function detectKeyLevels(candles) {
  if (!Array.isArray(candles) || candles.length < 5) return [];
  const lastClose = candles[candles.length - 1].close;
  // Heuristic scale: order-of-magnitude grid spacing.
  let gridStep;
  if (lastClose < 5) gridStep = 0.0025;       // FX major (1.0925 grid)
  else if (lastClose < 50) gridStep = 0.25;   // crypto-mid, low equities
  else if (lastClose < 500) gridStep = 2.5;   // gold-class
  else if (lastClose < 5000) gridStep = 25;   // indices
  else gridStep = 250;
  const levels = [];
  const minScan = lastClose - gridStep * 6;
  const maxScan = lastClose + gridStep * 6;
  const first = Math.ceil(minScan / gridStep) * gridStep;
  for (let lvl = first; lvl <= maxScan; lvl += gridStep) {
    const distancePct = Math.abs(lvl - lastClose) / lastClose;
    const cents = ((lvl / gridStep) % 4 + 4) % 4; // 0=00, 1=25, 2=50, 3=75
    const role = cents === 0 ? 'round_00' : cents === 2 ? 'round_50' : (cents === 1 ? 'round_25' : 'round_75');
    levels.push({
      level: +lvl.toFixed(5),
      role,
      distancePct: +distancePct.toFixed(4),
      magnetReason: role === 'round_00' || role === 'round_50' ? 'major round — strong stop-cluster + algo trigger' : 'minor round — secondary stop-cluster',
    });
  }
  return levels.sort((a, b) => a.distancePct - b.distancePct).slice(0, 8);
}

module.exports = { detectKeyLevels };
