'use strict';
// §6 Market Overview. Dense; every paragraph closes with ⬆️ or ⬇️ arrow per spec.
// Operator-facing copy only — no source/provenance tags on the user
// surface. Provenance details go to console logs / audit collapsibles.

const { arrow } = require('./language');

function build(input) {
  const { ctx, fmp, tagsUsed } = input;
  if (tagsUsed) tagsUsed.push('regime', 'market_driver', 'flow');

  const lines = ['## Market Overview'];
  lines.push('');

  // USD tilt paragraph
  const dxyScore = ctx?.dxy?.score ?? 0;
  const dxyBias  = ctx?.dxy?.bias  || 'Neutral';
  const fmpDxy   = fmp?.quotes?.dxy?.ok ? fmp.quotes.dxy.data?.[0] : null;
  lines.push(`**USD tilt:** UUP proxy quote ${fmpDxy?.price != null ? '$' + fmpDxy.price : ctx?.dxy?.price != null ? '$' + ctx.dxy.price.toFixed(2) : 'n/a'}, score ${score(dxyScore)}, bias ${dxyBias}. The lower the USD pushes, the more upside fuel for non-USD majors and metals; the higher it pushes, the heavier the squeeze on EURUSD / GBPUSD and the bid in USDJPY. ${arrow(-dxyScore)}`);
  lines.push('');

  // Risk environment paragraph
  const vixScore = ctx?.vix?.score ?? 0;
  const vixLevel = ctx?.vix?.level || 'Normal';
  const fmpVix   = fmp?.quotes?.vix?.ok ? fmp.quotes.vix.data?.[0] : null;
  lines.push(`**Risk environment:** VXX proxy ${fmpVix?.price != null ? '$' + fmpVix.price : ctx?.vix?.price != null ? '$' + ctx.vix.price.toFixed(2) : 'n/a'}, regime ${vixLevel}. Elevated readings widen spreads, accelerate liquidity sweeps, and bias flow into safe havens (USD, JPY, gold). Compressed readings let trends carry without the safe-haven drag. ${arrow(-vixScore)}`);
  lines.push('');

  // Yield curve paragraph
  const yScore = ctx?.yield?.score ?? 0;
  const yReg   = ctx?.yield?.regime || 'Normal';
  const ySpr   = ctx?.yield?.spread;
  const ySpread = ySpr != null ? ySpr.toFixed(2) + ' pp' : 'pending';
  lines.push(`**Yield curve:** 10Y-2Y spread ${ySpread}, regime ${yReg}. An inverted or flattening curve telegraphs growth doubt and supports duration / safe havens; a steepening curve telegraphs reflation and supports risk assets and high-beta currencies. Historical rotation claims are left to Corey Clone when an audit-grade cohort is available. ${arrow(yScore)}`);
  lines.push('');

  // Commodity / inflation paragraph (FMP-fed when available)
  const fmpOil = fmp?.quotes?.oil?.ok ? fmp.quotes.oil.data?.[0] : null;
  const fmpAu  = fmp?.quotes?.gold?.ok ? fmp.quotes.gold.data?.[0] : null;
  if (fmpOil || fmpAu) {
    // Commodity directional bias derived from the inverse of USD strength:
    // crude / gold tend to rise when the dollar eases and fall when it
    // firms. dxyScore is already computed for the USD tilt paragraph; we
    // reuse it here so the arrow tracks live data instead of the previous
    // hard-coded `arrow(0.05)⬇️` that always rendered ⬆️⬇️.
    lines.push(`**Commodities:** Crude ${fmpOil?.price != null ? '$' + fmpOil.price : 'n/a'}; gold ${fmpAu?.price != null ? '$' + fmpAu.price : 'n/a'}. Crude strength compounds inflation impulse and drags risk assets when sustained; gold strength typically rides USD weakness and rising real-yield concern. ${arrow(-dxyScore)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function score(s) {
  const n = s || 0;
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}

module.exports = { build };
