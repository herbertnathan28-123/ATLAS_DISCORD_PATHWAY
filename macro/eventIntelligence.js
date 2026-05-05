'use strict';
// §5 Global / Event Intelligence Block.
// Primary content comes from corey_calendar.getEventIntelligence(symbol) which already supplies
// sentiment / headline / timestamp / expanded summary / AI commentary / mechanism chain / trader note.
// This module wraps it with the v3 sentiment header + mixed-direction arrows + FMP earnings context.

const { arrow } = require('./language');

function build(input) {
  const { calendar, fmp, symbol, ctx, tagsUsed } = input;
  if (tagsUsed) tagsUsed.push('event_risk', 'macro_driver');

  const lines = ['## Event Intelligence'];
  lines.push('');

  // Sentiment header — derived from coreyLive macro tilt.
  const macroTilt = (-(ctx?.dxy?.score ?? 0) * 0.5) + (-(ctx?.vix?.score ?? 0) * 0.3) + ((ctx?.yield?.score ?? 0) * 0.2);
  const sentiment = sentimentFromTilt(macroTilt);
  lines.push(`**Sentiment:** ${sentiment.label} ${sentiment.dotScale} ${arrow(macroTilt)}${sentiment.mixed ? ' (mixed components)' : ''}`);
  lines.push(`**Driver:** ${describeDriver(ctx)}`);
  lines.push('');

  // Calendar intel block (already richly formatted by corey_calendar).
  const intel = calendar?.intel;
  if (intel) {
    lines.push(intel);
  } else {
    lines.push('*No high-impact catalysts in the active window. Re-check before any new entry.*');
  }

  // FMP earnings context for single-name equities.
  if (fmp && fmp.earnings && fmp.earnings.ok && Array.isArray(fmp.earnings.data) && fmp.earnings.data.length) {
    const next = fmp.earnings.data[0];
    lines.push('');
    lines.push(`**Earnings (FMP):** ${symbol} next report ${next.date || 'date n/a'} — fiscal ${next.fiscalDateEnding || 'n/a'}.`);
  } else if (fmp && fmp.earnings && !fmp.earnings.ok && /^[A-Z]{1,5}$/.test(symbol || '')) {
    lines.push('');
    lines.push(`*Earnings context unavailable (${fmp.earnings.reason}).*`);
  }

  // Advisory state from the calendar layer (clears / delays / withholds
  // trade readiness). Renamed from "Permission verdict:" — the calendar
  // does not grant or revoke an execution permission; it shapes the
  // advisory state.
  lines.push('');
  lines.push(advisoryStateLine(calendar));
  return lines.join('\n');
}

function sentimentFromTilt(t) {
  const a = Math.abs(t);
  const dots = (filled) => '●'.repeat(filled) + '○'.repeat(5 - filled);
  if (a >= 0.45) return { label: t > 0 ? 'STRONG RISK-ON' : 'STRONG RISK-OFF', dotScale: dots(5), mixed: false };
  if (a >= 0.30) return { label: t > 0 ? 'RISK-ON'        : 'RISK-OFF',        dotScale: dots(4), mixed: false };
  if (a >= 0.15) return { label: t > 0 ? 'MILD RISK-ON'   : 'MILD RISK-OFF',   dotScale: dots(3), mixed: false };
  if (a >= 0.05) return { label: 'MIXED', dotScale: dots(2), mixed: true };
  return { label: 'NEUTRAL', dotScale: dots(1), mixed: true };
}

function describeDriver(ctx) {
  const d = ctx?.dxy, v = ctx?.vix, y = ctx?.yield;
  const parts = [];
  if (d?.bias)        parts.push(`USD ${d.bias.toLowerCase()}`);
  if (v?.level)       parts.push(`VIX ${v.level.toLowerCase()}`);
  if (y?.regime)      parts.push(`yield curve ${y.regime.toLowerCase()}`);
  return parts.length ? parts.join(' · ') : 'macro inputs initialising';
}

function advisoryStateLine(calendar) {
  const intel = calendar?.intel;
  if (!intel) return '*Advisory state:* OPEN — no calendar block on entry conditions.';
  if (/—\s*([\d.]+)h from now/.test(intel)) {
    const h = parseFloat(intel.match(/—\s*([\d.]+)h from now/)[1]);
    if (h <= 2) return '*Advisory state:* WITHHELD — high-impact event inside 2h; entry conditions on hold.';
    if (h <= 24) return '*Advisory state:* DELAY — high-impact event inside 24h; reduce conviction.';
  }
  return '*Advisory state:* OPEN — calendar carries no near-term block.';
}

module.exports = { build };
