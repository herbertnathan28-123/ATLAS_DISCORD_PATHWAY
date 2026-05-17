'use strict';

// ============================================================
// spidey_structure/displacement.js
//
// Detects displacement / impulse candles — fast directional
// expansion with body magnitude ≥ thresholdMultiplier × ATR(14)
// AND ≥ 70% of total candle range (body-dominant, not wick).
//
// Displacement is the signature of institutional intent and is
// the precursor to most BOS / CHoCH events. Weak / wicky breaks
// are explicitly REJECTED.
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

function detectDisplacement(candles, opts) {
  opts = opts || {};
  const thresholdAtr = Number.isFinite(opts.thresholdAtr) ? opts.thresholdAtr : 1.2;
  const minBodyRatio = Number.isFinite(opts.minBodyRatio) ? opts.minBodyRatio : 0.70;
  if (!Array.isArray(candles) || candles.length < 16) return [];
  const atr = _atr(candles, 14);
  if (atr <= 0) return [];
  const events = [];
  // Scan recent 50 candles for displacement.
  const start = Math.max(0, candles.length - 50);
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range <= 0) continue;
    const bodyRatio = body / range;
    const atrRatio = body / atr;
    if (atrRatio >= thresholdAtr && bodyRatio >= minBodyRatio) {
      events.push({
        index: i,
        time: c.time,
        direction: c.close > c.open ? 'BULLISH' : 'BEARISH',
        bodySize: body,
        atrRatio: +atrRatio.toFixed(3),
        bodyRatio: +bodyRatio.toFixed(3),
        velocity: atrRatio >= 2 ? 'EXPLOSIVE' : atrRatio >= 1.5 ? 'STRONG' : 'MODERATE',
        reasonAccepted: 'body ≥ ' + thresholdAtr + 'x ATR and ≥ ' + (minBodyRatio * 100) + '% of range — institutional intent',
      });
    }
  }
  return events;
}

module.exports = { detectDisplacement };
