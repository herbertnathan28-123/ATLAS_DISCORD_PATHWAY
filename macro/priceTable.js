'use strict';
// §3 Price Table / Price Matrix. Cells use the locked colour codes from CLAUDE.md.
// Locked colours: HIGH=#FFD600 black · CURRENT=#00FF5A black · ENTRY=#FF9100 black · LOW=#00B0FF white.

function build(input) {
  const { structure, ctx, symbol } = input;
  const lastClose = ctx?.last?.close ?? structure?.currentPrice ?? null;
  const high = structure?.recentHigh ?? structure?.priceTable?.high ?? null;
  const low  = structure?.recentLow  ?? structure?.priceTable?.low  ?? null;
  const entry = structure?.entry ?? null;

  const lines = ['## Price Table'];
  lines.push('');
  lines.push(`| Cell | Level | Colour | Note |`);
  lines.push(`|---|---|---|---|`);
  lines.push(row('HIGH',    high,      '#FFD600', 'recent swing high'));
  lines.push(row('CURRENT', lastClose, '#00FF5A', 'last printed close'));
  lines.push(row('ENTRY',   entry,     '#FF9100', entry == null ? 'pending — no entry defined yet' : 'planned entry level'));
  lines.push(row('LOW',     low,       '#00B0FF', 'recent swing low'));
  lines.push('');
  if (high != null && low != null && lastClose != null) {
    const range = high - low;
    const pos = range > 0 ? ((lastClose - low) / range) * 100 : 50;
    lines.push(`*Range position: ${pos.toFixed(0)}% of recent high-low band for ${symbol || 'symbol'}.*`);
  } else {
    lines.push('*Range position unavailable — provide recentHigh / recentLow / lastClose.*');
  }
  return lines.join('\n');
}

function row(name, value, hex, note) {
  const v = value == null ? 'n/a' : (Number.isFinite(value) ? Number(value).toString() : value);
  return `| **${name}** | ${v} | \`${hex}\` | ${note} |`;
}

module.exports = { build };
