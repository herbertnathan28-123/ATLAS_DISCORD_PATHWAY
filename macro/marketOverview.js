'use strict';
// §6 Market Overview. Dense; every paragraph closes with ⬆️ or ⬇️ arrow per spec.
// Prefers FMP quotes when available; falls back to coreyLive UUP/VXX scoring.

const { arrow } = require('./language');

function build(input) {
  const { ctx, fmp, tagsUsed } = input;
  if (tagsUsed) tagsUsed.push('regime', 'macro_driver', 'flow');

  const lines = ['## Market Overview'];
  lines.push('');

  // USD tilt paragraph
  const dxyScore = ctx?.dxy?.score ?? 0;
  const dxyBias  = ctx?.dxy?.bias  || 'Neutral';
  const fmpDxy   = fmp?.quotes?.dxy?.ok ? fmp.quotes.dxy.data?.[0] : null;
  const dxySource = fmpDxy ? 'fmp' : 'coreyLive';
  lines.push(`**USD tilt:** UUP proxy quote ${fmpDxy?.price != null ? '$' + fmpDxy.price : ctx?.dxy?.price != null ? '$' + ctx.dxy.price.toFixed(2) : 'n/a'}, score ${score(dxyScore)}, bias ${dxyBias}. The lower the USD pushes, the more upside fuel for non-USD majors and metals; the higher it pushes, the heavier the squeeze on EURUSD / GBPUSD and the bid in USDJPY. ${arrow(-dxyScore)} *(source: ${dxySource})*`);
  lines.push('');

  // Risk environment paragraph
  const vixScore = ctx?.vix?.score ?? 0;
  const vixLevel = ctx?.vix?.level || 'Normal';
  const fmpVix   = fmp?.quotes?.vix?.ok ? fmp.quotes.vix.data?.[0] : null;
  const vixSource = fmpVix ? 'fmp' : 'coreyLive';
  lines.push(`**Risk environment:** VXX proxy ${fmpVix?.price != null ? '$' + fmpVix.price : ctx?.vix?.price != null ? '$' + ctx.vix.price.toFixed(2) : 'n/a'}, regime ${vixLevel}. Elevated readings widen spreads, accelerate liquidity sweeps, and bias flow into safe havens (USD, JPY, gold). Compressed readings let trends carry without the safe-haven drag. ${arrow(-vixScore)} *(source: ${vixSource})*`);
  lines.push('');

  // Yield curve paragraph
  const yScore = ctx?.yield?.score ?? 0;
  const yReg   = ctx?.yield?.regime || 'Normal';
  const ySpr   = ctx?.yield?.spread;
  lines.push(`**Yield curve:** 10Y-2Y spread ${ySpr != null ? ySpr.toFixed(2) + ' pp' : 'unavailable'}, regime ${yReg}. An inverted or flattening curve telegraphs growth doubt, supports duration / safe havens, and historically precedes risk-off rotations. A steepening curve telegraphs reflation and supports risk assets and high-beta currencies. ${arrow(yScore)} *(source: coreyLive${ySpr == null ? ' — degraded, last known cache' : ''})*`);
  lines.push('');

  // Commodity / inflation paragraph (FMP-fed when available)
  const fmpOil = fmp?.quotes?.oil?.ok ? fmp.quotes.oil.data?.[0] : null;
  const fmpAu  = fmp?.quotes?.gold?.ok ? fmp.quotes.gold.data?.[0] : null;
  if (fmpOil || fmpAu) {
    lines.push(`**Commodities (FMP):** Crude ${fmpOil?.price != null ? '$' + fmpOil.price : 'n/a'}; gold ${fmpAu?.price != null ? '$' + fmpAu.price : 'n/a'}. Crude strength compounds inflation impulse and drags risk assets when sustained; gold strength typically rides USD weakness and rising real-yield concern. ${arrow(0.05)}⬇️ *(source: fmp)*`);
    lines.push('');
  }

  return lines.join('\n');
}

function score(s) {
  const n = s || 0;
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}

module.exports = { build };
