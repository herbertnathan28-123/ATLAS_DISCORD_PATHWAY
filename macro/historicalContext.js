'use strict';
// §8 Historical Context. Trade-linked, audited, colour-stamped.
// Consumes input.history.recent20 (preferred) or falls back to a degraded note.

const { COLOUR, tag } = require('./colours');
const { arrow } = require('./language');

function build(input) {
  const { history, symbol, structure, tagsUsed } = input;
  if (tagsUsed) tagsUsed.push('regime', 'liquidity_sweep', 'imbalance');

  const lines = ['## Historical Context'];
  lines.push('');

  if (!history || !Array.isArray(history.recent20) || !history.recent20.length) {
    lines.push(`*Historical OHLCV cache not loaded for ${symbol || 'symbol'} — pass input.history.recent20 from cacheReader.getRecentCandles(symbol, 20) before relying on this section.*`);
    return lines.join('\n');
  }

  const rows = history.recent20;
  const first = rows[0], last = rows[rows.length - 1];
  const netMove = last.close - first.close;
  const totalRange = rows.reduce((s, r) => s + (r.high - r.low), 0);
  const efficiency = totalRange > 0 ? Math.abs(netMove) / totalRange : 0;
  const upCount = rows.filter(r => r.close > r.open).length;
  const downCount = rows.length - upCount;
  const directionWord = netMove > 0 ? 'higher' : netMove < 0 ? 'lower' : 'flat';
  const dirArrow = arrow(netMove);

  // Stamped paragraphs — green/red/amber per outcome.
  lines.push(`**Recent 20-bar window:** ${first.time && last.time ? `${dateOnly(first.time)} → ${dateOnly(last.time)}` : 'time fields missing'}. Net close move ${netMove >= 0 ? '+' : ''}${netMove.toFixed(formatDigits(symbol))}, efficiency ${(efficiency * 100).toFixed(0)}% (path-vs-displacement). ${dirArrow}`);
  lines.push('');

  if (efficiency >= 0.45) {
    lines.push(`${tag(COLOUR.GREEN, 'Trend cleanliness — high.')} Twenty-bar move travelled ${directionWord} with limited path overhead, which historically supports continuation when structure agrees. ${dirArrow}`);
  } else if (efficiency >= 0.30) {
    lines.push(`${tag(COLOUR.AMBER, 'Trend cleanliness — moderate.')} The window has direction but enough chop that pullbacks are likely; size accordingly. ${dirArrow}`);
  } else {
    lines.push(`${tag(COLOUR.RED, 'Trend cleanliness — poor.')} Path-to-displacement ratio is low; this is range behaviour, not trend. Pulling continuation trades here historically underperforms. ${dirArrow}`);
  }
  lines.push('');

  // Bar-balance paragraph
  if (Math.abs(upCount - downCount) <= 2) {
    lines.push(`${tag(COLOUR.AMBER, 'Bar balance — mixed.')} ${upCount} up vs ${downCount} down inside the window. Mixed balance reduces confidence in any single-direction read. ⬆️⬇️`);
  } else {
    const c = upCount > downCount ? COLOUR.GREEN : COLOUR.RED;
    lines.push(`${tag(c, 'Bar balance — directional.')} ${upCount} up vs ${downCount} down — sustained pressure ${upCount > downCount ? 'bid' : 'offered'} across the window. ${arrow(upCount - downCount)}`);
  }
  lines.push('');

  // Trade linkage paragraph (only when structure is present)
  if (structure && (structure.entry != null || structure.bias)) {
    const aligned = structure.bias && (
      (structure.bias.toLowerCase().startsWith('bull') && netMove > 0) ||
      (structure.bias.toLowerCase().startsWith('bear') && netMove < 0)
    );
    if (aligned) {
      lines.push(`${tag(COLOUR.GREEN, 'Trade linkage — supportive.')} The recent window agrees with the proposed ${structure.bias} setup; history supports the read. ${dirArrow}`);
    } else {
      lines.push(`${tag(COLOUR.RED, 'Trade linkage — adverse.')} The recent window disagrees with the proposed ${structure.bias || 'undefined'} setup; the trade asks the market to break its current rhythm. ${arrow(-netMove)}`);
    }
  } else {
    lines.push(`${tag(COLOUR.WHITE, 'Trade linkage — n/a.')} Structure or proposed bias not yet defined; recent window stands on its own.`);
  }

  return lines.join('\n');
}

function dateOnly(t) {
  const ms = (typeof t === 'number' && t < 1e12) ? t * 1000 : t;
  return new Date(ms).toISOString().slice(0, 10);
}
function formatDigits(symbol) {
  if (!symbol) return 4;
  const s = symbol.toUpperCase();
  if (s.includes('JPY')) return 2;
  if (/^(NAS100|US500|US30|DJI|GER40|UK100)$/.test(s)) return 1;
  return 4;
}

module.exports = { build };
