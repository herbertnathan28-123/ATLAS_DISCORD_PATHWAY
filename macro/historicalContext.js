'use strict';
// §8 Historical Context. Trade-linked, audited, colour-stamped.
// Consumes input.history.recent20 (preferred) or falls back to a degraded note.

const { COLOUR, tag } = require('./colours');
const { arrow } = require('./language');

function build(input) {
  const { history, symbol, structure, tagsUsed } = input;
  const clone = input.coreyClone || null;
  if (tagsUsed) tagsUsed.push('regime', 'liquidity_sweep', 'imbalance');

  const lines = ['## Historical Context'];
  lines.push('');
  lines.push('### Historical Analogue Status');
  lines.push(renderCloneStatus(clone));
  lines.push('');

  if (!history || !Array.isArray(history.recent20) || !history.recent20.length) {
    // Operator-facing fallback only. Internal diagnostic detail
    // (recent20 hint) goes to console logs.
    console.log(`[HISTORICAL-CTX] history.recent20 not present for ${symbol || 'symbol'}; emitting calm placeholder.`);
    lines.push('Recent comparison data is not ready for this symbol yet. Use the live charts and Trade Status / Final Assessment as the active guide.');
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
    lines.push(`${tag(COLOUR.GREEN, 'Trend cleanliness — high.')} Twenty-bar move travelled ${directionWord} with limited path overhead. ${historicalClaim(clone, 'Corey Clone may be used as the base-rate check only under the audit details above.', 'No historical continuation claim is made because Corey Clone is not decision-usable on this run.')} ${dirArrow}`);
  } else if (efficiency >= 0.30) {
    lines.push(`${tag(COLOUR.AMBER, 'Trend cleanliness — moderate.')} The window has direction but enough chop that pullbacks are likely; size accordingly. ${dirArrow}`);
  } else {
    lines.push(`${tag(COLOUR.RED, 'Trend cleanliness — poor.')} Path-to-displacement ratio is low; this is range behaviour, not trend. ${historicalClaim(clone, 'Base-rate read must be checked against the Corey Clone cohort before treating continuation as supported or rejected.', 'No historical underperformance claim is made because Corey Clone is not decision-usable on this run.')} ${dirArrow}`);
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
      lines.push(`${tag(COLOUR.GREEN, 'Trade linkage — supportive.')} The recent window agrees with the proposed ${structure.bias} setup. ${historicalClaim(clone, 'Audit-grade Corey Clone support is available above; use that cohort, not a generic memory claim.', 'No generic historical support is claimed without a decision-usable Corey Clone cohort.')} ${dirArrow}`);
    } else {
      lines.push(`${tag(COLOUR.RED, 'Trade linkage — adverse.')} The recent window disagrees with the proposed ${structure.bias || 'undefined'} setup; the trade asks the market to break its current rhythm. ${arrow(-netMove)}`);
    }
  } else {
    lines.push(`${tag(COLOUR.WHITE, 'Trade linkage — n/a.')} Structure or proposed bias not yet defined; recent window stands on its own.`);
  }

  return lines.join('\n');
}

function cloneHasAuditBasis(clone) {
  if (!clone || clone.usableForDecision !== true) return false;
  if (!Number.isFinite(clone.sampleSize) || clone.sampleSize <= 0) return false;
  if (!Number.isFinite(clone.denominator) || clone.denominator < clone.sampleSize) return false;
  if (!clone.confidenceBasis || !clone.sourceBasis) return false;
  return Array.isArray(clone.timestampWindows) && clone.timestampWindows.some(w => w && w.startUTC && w.endUTC);
}

function historicalClaim(clone, validText, invalidText) {
  return cloneHasAuditBasis(clone) ? validText : invalidText;
}

function renderCloneStatus(clone) {
  if (!clone) {
    return [
      '**Status:** BLOCKED',
      '**Decision use:** no',
      '**Reason:** Corey Clone did not provide a packet, so Jane cannot use historical analogues.',
    ].join('\n');
  }
  const usable = cloneHasAuditBasis(clone);
  const status = clone.status || (usable ? 'OK' : 'BLOCKED');
  const lines = [];
  lines.push(`**Status:** ${status}`);
  lines.push(`**Decision use:** ${usable ? 'yes' : 'no'}${clone.usableForDecision && !usable ? ' (basis incomplete)' : ''}`);
  lines.push(`**Sample / denominator:** ${Number.isFinite(clone.sampleSize) ? clone.sampleSize : 0} / ${Number.isFinite(clone.denominator) ? clone.denominator : 0}`);
  lines.push(`**Timestamp window:** ${clone.timestampWindows && clone.timestampWindows[0] ? clone.timestampWindows[0].label : 'not available'}`);
  lines.push(`**Source basis:** ${clone.sourceBasis || 'not available'}`);
  lines.push(`**Confidence basis:** ${clone.confidenceBasis || 'not available'}`);
  if (usable) lines.push(`**Cohort summary:** ${clone.cohortSummary || 'audit-grade analogue cohort accepted.'}`);
  else lines.push(`**Downgrade:** ${clone.degradedReason || clone.cohortSummary || 'No valid analogue exists for this macro read.'}`);
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
