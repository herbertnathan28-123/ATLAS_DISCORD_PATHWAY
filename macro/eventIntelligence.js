'use strict';
// §5 Global / Event Intelligence Block.
// Primary content comes from corey_calendar.getEventIntelligence(symbol) which already supplies
// sentiment / headline / timestamp / expanded summary / AI commentary / mechanism chain / trader note.
// This module wraps it with the v3 sentiment header + mixed-direction arrows + FMP earnings context.

const { arrow } = require('./language');

function build(input) {
  const { calendar, fmp, symbol, ctx, tagsUsed } = input;
  if (tagsUsed) tagsUsed.push('event_risk', 'market_driver');

  const lines = ['## GLOBAL / EVENT INTELLIGENCE'];
  lines.push('');

  // Sentiment header — derived from coreyLive macro tilt.
  const macroTilt = (-(ctx?.dxy?.score ?? 0) * 0.5) + (-(ctx?.vix?.score ?? 0) * 0.3) + ((ctx?.yield?.score ?? 0) * 0.2);
  const sentiment = sentimentFromTilt(macroTilt);
  lines.push(`**Sentiment:** ${sentiment.label} ${sentiment.dotScale} ${arrow(macroTilt)}${sentiment.mixed ? ' (mixed components)' : ''}`);
  lines.push(`**Driver:** ${describeDriver(ctx)}`);
  lines.push('');

  // Calendar intel block (already richly formatted by corey_calendar).
  // When the upcoming-events list contains a same-currency inflation
  // cluster (≥ 2 inflation prints within 36 h), the per-event boilerplate
  // (WHAT HAPPENED / WHY MARKETS CARE / EXPECTED MOVE / TRADER ACTION /
  // WHEN THE IDEA IS INVALID) is suppressed here — the EVENTS / CATALYSTS
  // section emits one cluster row + one action rule instead. This is the
  // locked structure: events table → cluster summary → one action rule,
  // never repeated per-print boilerplate.
  const intel = calendar?.intel;
  if (intel) {
    if (hasInflationCluster(calendar)) {
      // Keep just the headline + sentiment context that intel may carry,
      // but drop the per-event blocks. Concretely: render a one-liner
      // pointer to the EVENTS / CATALYSTS section.
      lines.push('*High-impact inflation prints are clustered in this window — see EVENTS / CATALYSTS for the cluster summary and the single action rule.*');
    } else {
      lines.push(intel);
    }
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
    lines.push(`*Earnings context pending (${fmp.earnings.reason || 'feed not ready'}).*`);
  }

  // Advisory state from the calendar layer (clears / delays / pauses
  // trade readiness). Operator-facing — no permission/withhold language.
  lines.push('');
  lines.push(advisoryStateLine(calendar));
  return lines.join('\n');
}

// Sentiment scale — 5-disc traffic-light per operator doctrine
// (PR #74 v6 canon: same `🟢🟢🟢🟢⚫ 4/5 — Label` shape used on the
// Dark Horse Market Mood surface; ⚫ inactive disc, same-family
// active discs, never rainbow). Per CLAUDE.md §3 "Sentiment system:
// Dominant bias on 1–5 dot scale" — the dot scale stays 5-wide; only
// the glyph family changes.
function sentimentFromTilt(t) {
  const a = Math.abs(t);
  const scale = (filled, glyph) => glyph.repeat(filled) + '⚫'.repeat(5 - filled);
  if (a >= 0.45) return { label: t > 0 ? 'STRONG RISK-ON' : 'STRONG RISK-OFF', dotScale: scale(5, t > 0 ? '🟢' : '🔴'), mixed: false };
  if (a >= 0.30) return { label: t > 0 ? 'RISK-ON'        : 'RISK-OFF',        dotScale: scale(4, t > 0 ? '🟢' : '🔴'), mixed: false };
  if (a >= 0.15) return { label: t > 0 ? 'MILD RISK-ON'   : 'MILD RISK-OFF',   dotScale: scale(3, t > 0 ? '🟢' : '🟠'), mixed: false };
  if (a >= 0.05) return { label: 'MIXED', dotScale: scale(2, '🟡'), mixed: true };
  return { label: 'NEUTRAL', dotScale: scale(1, '🟡'), mixed: true };
}

function describeDriver(ctx) {
  const d = ctx?.dxy, v = ctx?.vix, y = ctx?.yield;
  const parts = [];
  if (d?.bias)        parts.push(`US Dollar Strength (DXY) ${d.bias.toLowerCase()}`);
  if (v?.level)       parts.push(`Market Volatility (VIX) ${v.level.toLowerCase()}`);
  if (y?.regime)      parts.push(`yield curve ${y.regime.toLowerCase()}`);
  return parts.length ? parts.join(' · ') : 'macro inputs initialising';
}

// Mirrors the cluster-detection rule in macro/catalysts.js so this
// module can decide whether per-event boilerplate is redundant.
const INFLATION_PATTERN = /\b(CPI|Core CPI|PPI|Core PPI|Inflation Rate|HICP|PCE)\b/i;
function hasInflationCluster(calendar) {
  const events = (calendar && calendar.snapshot && calendar.snapshot.events) || [];
  const upcoming = events.filter(e => e && e.scheduled_time && e.scheduled_time > Date.now());
  if (upcoming.length < 2) return false;
  for (let i = 0; i < upcoming.length; i++) {
    if (!INFLATION_PATTERN.test(upcoming[i].title || '')) continue;
    for (let j = i + 1; j < upcoming.length; j++) {
      if (!INFLATION_PATTERN.test(upcoming[j].title || '')) continue;
      if ((upcoming[j].currency || '') !== (upcoming[i].currency || '')) continue;
      if (Math.abs((upcoming[j].scheduled_time || 0) - (upcoming[i].scheduled_time || 0)) <= 36 * 3600 * 1000) {
        return true;
      }
    }
  }
  return false;
}

function advisoryStateLine(calendar) {
  const intel = calendar?.intel;
  if (!intel) return '*Advisory state:* OPEN — calendar shows no event hold on entry conditions.';
  if (/—\s*([\d.]+)h from now/.test(intel)) {
    const h = parseFloat(intel.match(/—\s*([\d.]+)h from now/)[1]);
    if (h <= 2) return '*Advisory state:* PAUSED — high-impact event inside 2h; entry conditions on hold.';
    if (h <= 24) return '*Advisory state:* DELAY — high-impact event inside 24h; reduce conviction.';
  }
  return '*Advisory state:* OPEN — calendar shows no near-term event hold.';
}

module.exports = { build };
