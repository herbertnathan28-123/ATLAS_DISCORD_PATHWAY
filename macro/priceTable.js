'use strict';
// §3 Price Table / Price Matrix. Cells use the locked colour codes from CLAUDE.md.
// Locked colours: HIGH=#FFD600 black · CURRENT=#00FF5A black · ENTRY=#FF9100 black · LOW=#00B0FF white.

function build(input) {
  const { structure, ctx, symbol } = input;
  const lastClose = ctx?.last?.close ?? structure?.currentPrice ?? null;
  const high = structure?.recentHigh ?? structure?.priceTable?.high ?? null;
  const low  = structure?.recentLow  ?? structure?.priceTable?.low  ?? null;
  const entry = structure?.entry ?? null;
  const stopLoss = structure?.stopLoss ?? null;
  const target = (structure?.targets && structure.targets[0]) ?? null;

  const lines = ['## Price Table / Execution Map'];
  lines.push('');
  lines.push('| Cell | Level | Colour | Note |');
  lines.push('|---|---|---|---|');
  lines.push(row('HIGH',    high,      '#FFD600', 'recent swing high'));
  lines.push(row('CURRENT', lastClose, '#00FF5A', 'last printed close'));
  if (entry == null) {
    lines.push('| **ENTRY** | Pending | `#FF9100` | no authorised entry |');
    lines.push('| **STOP LOSS** | Not authorised | `#ff0015` | undefined until entry structure forms |');
    lines.push('| **TARGET** | Not authorised | `#00b450` | undefined until entry structure forms |');
    lines.push('| **INVALIDATION** | Not defined until entry structure forms | `—` | — |');
  } else {
    lines.push(row('ENTRY',      entry,    '#FF9100', 'planned entry level'));
    lines.push(row('STOP LOSS',  stopLoss, '#ff0015', stopLoss == null ? 'Not authorised' : 'invalidates the trade idea'));
    lines.push(row('TARGET',     target,   '#00b450', target == null ? 'Not authorised' : 'first target — partial / scale'));
  }
  lines.push(row('LOW',     low,       '#00B0FF', 'recent swing low'));
  lines.push('');

  // No fake precision — never compute risk/reward when no authorised entry exists.
  if (entry == null || stopLoss == null) {
    lines.push('*Risk plan unavailable because no authorised entry or invalidation exists.*');
  } else if (target != null) {
    // Show distance only — explicitly skip R:R per spec.
    lines.push('*Entry to stop and entry to target shown above for distance reference. R:R / RR intentionally omitted on this surface.*');
  }

  if (high != null && low != null && lastClose != null) {
    const range = high - low;
    const pos = range > 0 ? ((lastClose - low) / range) * 100 : 50;
    lines.push('*Range position: ' + pos.toFixed(0) + '% of recent high-low band for ' + (symbol || 'symbol') + '.*');
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
