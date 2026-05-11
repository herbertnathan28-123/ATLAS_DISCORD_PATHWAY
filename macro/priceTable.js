'use strict';
// §3 PRICE TABLE — ANALYSED TARGETS. Two-column institutional table
// per the locked dashboard/macro wording standard. Row labels:
//   ENTRY POINT · ENTRY EXTENDED · EXIT POINT · TREND · NEUTRAL MARKET
//   · SET STOP LOSS · EXTENDED STOP LOSS · SELECT ONE STOP LOSS ONLY.
// Hero state when no valid setup: NO VALID BUY OR SELL TARGET IDENTIFIED.

function build(input) {
  const { structure, ctx, symbol } = input;
  const lastClose = ctx?.last?.close ?? structure?.currentPrice ?? null;
  const high = structure?.recentHigh ?? structure?.priceTable?.high ?? null;
  const low  = structure?.recentLow  ?? structure?.priceTable?.low  ?? null;
  const entry = structure?.entry ?? null;
  const entryExt = structure?.entryExtended ?? null;
  const stopLoss = structure?.stopLoss ?? null;
  const stopLossExt = structure?.stopLossExtended ?? null;
  const target = (structure?.targets && structure.targets[0]) ?? null;
  const trend = structure?.trend || structure?.bias || null;

  const lines = ['## PRICE TABLE — ANALYSED TARGETS — ' + (symbol || '')];
  lines.push('');

  // Neutral state — collapse the seven "Not identified yet" rows into a
  // single hero block per the May 2026 hardening spec. Repetition was
  // burying the actual read in placeholder noise. Reference levels
  // remain so traders still see the orientation band.
  if (entry == null) {
    lines.push('**NO VALID BUY OR SELL TARGET IDENTIFIED**');
    lines.push('');
    lines.push('Stand aside. ' + (symbol || 'This instrument') + ' does not currently have a reliable buy or sell setup. ATLAS needs a clean body close beyond a meaningful structure level, or a pullback into a control area followed by a clean reaction candle, before publishing entry, exit, and stop-loss levels.');
    lines.push('');
  } else {
    lines.push('| Row | Level | Note |');
    lines.push('|---|---|---|');
    lines.push(row('ENTRY POINT',           entry,       'primary entry — execute on confirmation here'));
    lines.push(row('ENTRY EXTENDED',        entryExt,    entryExt == null ? 'wider primary-zone fill if price retraces deeper' : 'wider entry zone for deeper retraces'));
    lines.push(row('EXIT POINT',            target,      target == null ? 'Not identified yet' : 'where the primary plan books the read'));
    lines.push(row('TREND',                 trend,       trend == null ? 'No directional read yet' : 'current trend frame on the primary timeframe'));
    lines.push(row('SET STOP LOSS',         stopLoss,    stopLoss == null ? 'Not identified yet' : 'primary protection — closes here on the primary TF invalidate the read'));
    lines.push(row('EXTENDED STOP LOSS',    stopLossExt, stopLossExt == null ? (stopLoss == null ? 'Not identified yet' : 'wider alternative protection for higher-noise sessions') : 'wider alternative protection'));
    lines.push('| **SELECT ONE STOP LOSS ONLY** | — | use ONE stop, not both. Holding both at once is conflicting risk and will be rejected. |');
    lines.push('');
  }

  // Reference rows (HIGH / CURRENT / LOW for orientation; NEVER labelled
  // "ENTRY" — entry only appears in the rows above).
  lines.push('### Reference levels');
  lines.push('| Level | Value |');
  lines.push('|---|---|');
  lines.push(refRow('HIGH',     high));
  lines.push(refRow('CURRENT',  lastClose));
  lines.push(refRow('LOW',      low));
  lines.push('');

  if (entry == null || stopLoss == null) {
    lines.push('*Risk plan not ready — entry and stop-loss are not identified yet.*');
  } else if (target != null) {
    lines.push('*Entry-to-stop and entry-to-exit shown above for distance reference. R:R / RR intentionally omitted on this surface.*');
  }

  if (high != null && low != null && lastClose != null) {
    const range = high - low;
    const pos = range > 0 ? ((lastClose - low) / range) * 100 : 50;
    lines.push('*Range position: ' + pos.toFixed(0) + '% of recent high-low band for ' + (symbol || 'symbol') + '.*');
  }
  return lines.join('\n');
}

function row(name, value, note) {
  const v = value == null ? 'Not identified yet' : (Number.isFinite(value) ? Number(value).toString() : value);
  return `| **${name}** | ${v} | ${note} |`;
}
function refRow(name, value) {
  const v = value == null ? '—' : (Number.isFinite(value) ? Number(value).toString() : value);
  return `| **${name}** | ${v} |`;
}

module.exports = { build };
