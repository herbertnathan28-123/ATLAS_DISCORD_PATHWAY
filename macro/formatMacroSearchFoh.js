'use strict';

// ============================================================
// macro/formatMacroSearchFoh.js
//
// FOH / Market Intel formatter for the live Discord
// `!<symbol> macro` / `!<event> impact` / `!today's major events`
// command surface. Operator directive 2026-05-19 — the macro
// search result must render in the approved ATLAS Market Intel
// visual format, not the legacy plain-text wall.
//
// Pure presentation. Engines / routing / event filtering live
// in macro/searchMacro.js. This module receives a fully-built
// ctx and returns the user-facing string ready for Discord.
//
// ctx shape:
//   query                — operator query string (post-normalise)
//   resolution           — { resolved_type, resolved_target, displayTarget, ... }
//   leadSymbol           — string
//   macroPacket          — interpretCalendarEvents() output (primary
//                          input — riskState, primaryEventFocus,
//                          macroTransmissionMap, affectedMarketsExpanded,
//                          todayAnnouncements, next72Hours, etc.)
//   events               — array of pre-filtered ranked event rows
//                          (built by searchMacro.eventRowsForResponse)
//   coreyStatus          — 'ACTIVE' | 'PARTIAL' | 'BLOCKED'
//   cloneSummary         — { status, usableForDecision, ... }
//   spideyStatus         — 'ACTIVE' | 'PARTIAL' | 'BLOCKED' | 'NOT_APPLICABLE'
//   janeFinalState       — 'ARMED' | 'MONITORING' | 'STAND_DOWN' | …
//   fohRendered          — boolean
//   degradationReason    — 'none' | <reason string>
//
// Section order (operator-locked):
//   1. 📡 MARKET INTEL · MACRO SEARCH — <displayTarget>
//   2. Control strip (PNG · PDF · Calendar · Expanded
//      Terminology Hyperlinks · Full Brief)
//   3. 🔥 THE CALL
//   4. 📅 RANKED CALENDAR EVENTS
//   5. ⚠️ RISK STATE
//   6. 🌍 MARKET IMPACT
//   7. 🎯 AFFECTED MARKETS
//   8. ✅ CONFIRMATION / DEGRADATION
//   9. 🗓️ FORWARD PLANNING
//  10. 🔗 SOURCE / PROVENANCE
//  11. Jane remains final gate close line
//
// Terminology contract (operator-locked):
//   • "Market Impact"     not "Mechanism Chain"
//   • "Expanded Terminology Hyperlinks"   not "Learning Links"
//   • "US Dollar Strength (DXY)"          not bare DXY
//   • "Market Volatility (VIX)"           not bare VIX
//
// Honesty contract:
//   • Never invent PNG / PDF availability — both render as
//     "Pending" until the rendered-image pipeline is wired
//     to the macro search path.
//   • Never invent Corey Clone / Spidey confirmation — surface
//     the real engine status verbatim through CONFIRMATION /
//     DEGRADATION.
//   • Never claim Jane validated a stronger state than the
//     engine returned — currentReadLine() reflects the real
//     janeFinalState.
// ============================================================

const { boxHeader, controlStrip } = require('../foh/headerStrip');

// ============================================================
// USER-FACING TERMINOLOGY
// ============================================================

function displayInstrument(symbol) {
  const s = String(symbol || '');
  if (s === 'DXY') return 'US Dollar Strength (DXY)';
  if (s === 'VIX') return 'Market Volatility (VIX)';
  return s;
}

function userFacingText(text) {
  // Operator annotation bans (2026-05-19, Notion macro-photos pack):
  //   • "authorised" / "authorized" — Nathan's annotations on the MU
  //     Execution Desk reject the word as bureaucratic and unclear.
  //     Translate to plain-English "probable for validity period"
  //     and "clear" / "valid" wording where applicable.
  //   • "Sideways" — Nathan flagged this as not a commonly-used term;
  //     replace with "rangebound" + explanation.
  return String(text || '')
    .replace(/\bDXY\s*\/\s*VIX\b/g, 'US Dollar Strength (DXY) / Market Volatility (VIX)')
    .replace(/\bDXY\s+and\s+VIX\b/gi, 'US Dollar Strength (DXY) and Market Volatility (VIX)')
    .replace(/\bDXY\s*,\s*yields\s*,\s*VIX\b/gi, 'US Dollar Strength (DXY), yields, Market Volatility (VIX)')
    .replace(/(?<!\()DXY\b/g, 'US Dollar Strength (DXY)')
    .replace(/(?<!\()VIX\b/g, 'Market Volatility (VIX)')
    .replace(/US Dollar Strength \(DXY\)\s*\/\s*yields\s*\/\s*Market Volatility \(VIX\)/g, 'US Dollar Strength (DXY), yields, and Market Volatility (VIX)')
    // Annotation bans — never expose "authorised" / "authorized" /
    // "Sideways" wording on the user surface.
    .replace(/\bnot\s+authoris(?:ed|e)\b/gi, 'not probable for the validity period')
    .replace(/\bnot\s+authoriz(?:ed|e)\b/gi, 'not probable for the validity period')
    .replace(/\bauthoris(?:ed|e)\b/gi, 'probable')
    .replace(/\bauthoriz(?:ed|e)\b/gi, 'probable')
    .replace(/\bsideways\b/gi, 'rangebound');
}

// ============================================================
// COLOUR + IMPACT HELPERS
// ============================================================

const IMPACT_TIER1_TITLE_RE = /(rate decision|policy decision|interest rate decision|press conference|cpi\b|inflation rate|non[- ]?farm|nfp\b)/i;
const IMPACT_HIGH_TITLE_RE = /(gdp|retail sales|unemployment|inflation|minutes|speech|payrolls)/i;

function impactGlyph(row) {
  const impact = String(row && (row.impact || row.expectedImpact || row.severity) || '').toUpperCase();
  const title = String(row && row.title || '');
  if (/EXTREME|TIER\s*1/.test(impact) || IMPACT_TIER1_TITLE_RE.test(title)) return '🔴';
  if (/HIGH|ELEV/.test(impact)) return '🟠';
  if (IMPACT_HIGH_TITLE_RE.test(title)) return '🟠';
  if (/MED|MEDIUM/.test(impact)) return '🟡';
  if (/LOW/.test(impact)) return '⚪';
  return '🟡';
}

function topImpactTier(rows) {
  let tier = 'low';
  for (const r of (rows || [])) {
    const g = impactGlyph(r);
    if (g === '🔴') return 'extreme';
    if (g === '🟠') tier = 'high';
    else if (g === '🟡' && tier === 'low') tier = 'medium';
  }
  return tier;
}

function headerColorForTier(tier) {
  return tier === 'extreme' ? 'red'
    : tier === 'high' ? 'orange'
    : tier === 'medium' ? 'yellow'
    : 'grey';
}

function riskColorForLabel(label) {
  const u = String(label || '').toUpperCase();
  if (/EXTREME/.test(u)) return 'red';
  if (/HIGH|ACTIVE|STRESS|ELEVATED/.test(u)) return 'orange';
  if (/MED|MODERATE/.test(u)) return 'yellow';
  return 'grey';
}

function riskDiscs(score) {
  const n = Math.max(1, Math.min(5, Math.round(Number(score) || 1)));
  const active = n >= 5 ? '🔴' : n >= 4 ? '🟠' : n >= 3 ? '🟡' : '🔵';
  return active.repeat(n) + '⚫'.repeat(Math.max(0, 5 - n));
}

function currentReadLine(state) {
  if (state === 'ARMED') return 'ARMED — Jane has a stronger validated state; follow the engine confirmation and degradation notes.';
  if (state === 'STAND_DOWN') return 'STAND_DOWN — Jane rejected a confirmed execution read for this search.';
  return 'MONITORING — no confirmed execution read yet.';
}

// ============================================================
// SECTION BUILDERS
// ============================================================

function buildControlStrip() {
  // Operator directive 2026-05-19 — PNG / PDF render as 'Pending'
  // until the macro-search image pipeline is wired. Calendar and
  // Expanded Terminology Hyperlinks are real surfaces today.
  // Full Brief defers until the live-brief routing returns a URL
  // for the selected target.
  return controlStrip({
    png: 'Pending',
    pdf: 'Pending',
    calendar: 'available',
    glossary: 'available',
    dashboard: 'Pending',
    rows: ['png', 'pdf', 'calendar', 'glossary', 'dashboard'],
    labels: {
      png:       '🖼️ PNG',
      pdf:       '📄 PDF',
      calendar:  '📅 Full Calendar',
      glossary:  '📘 Expanded Terminology Hyperlinks',
      dashboard: '🔗 Full Brief',
    },
  });
}

function rankedEventBlock(events) {
  if (!Array.isArray(events) || !events.length) {
    return [
      '⚪ pending · multi · [No matching live scheduled event in the current calendar window]',
      'Affected: Affected markets pending',
      'Full Brief: Pending',
    ].join('\n');
  }
  return events.slice(0, 5).map(e => {
    const glyph = impactGlyph(e);
    const time = e.timeUTC || e.scheduledTimeUTC || 'pending';
    const ccy = e.currency || 'multi';
    const title = e.title || 'Unnamed event';
    const markets = Array.isArray(e.affectedMarkets) ? e.affectedMarkets
      : Array.isArray(e.affectedInstruments) ? e.affectedInstruments
      : [];
    const marketsTxt = markets.length
      ? markets.slice(0, 4).map(displayInstrument).join(' · ')
      : 'Affected markets pending';
    const brief = e.briefUrl && !/notion\.(so|com|site)/i.test(String(e.briefUrl)) ? e.briefUrl : 'Pending';
    return [
      glyph + ' ' + time + ' ' + ccy + ' · [' + title + ']',
      'Affected: ' + marketsTxt,
      'Full Brief: ' + brief,
    ].join('\n');
  }).join('\n\n');
}

function marketImpactCards(packet, focus) {
  const paths = Array.isArray(packet.macroTransmissionMap) ? packet.macroTransmissionMap : [];
  const t = paths[0] || {};
  const happening = userFacingText(focus.title || t.driver || 'Live macro driver state');
  const why = userFacingText(t.mechanism || focus.whyPrimary || 'Macro drivers are setting risk conditions.');
  const moverSyms = Array.isArray(t.affectedSymbols) && t.affectedSymbols.length
    ? t.affectedSymbols
    : (Array.isArray(focus.affectedMarkets) ? focus.affectedMarkets : []);
  const movers = moverSyms.length
    ? moverSyms.slice(0, 6).map(displayInstrument).join(', ') + '.'
    : 'US Dollar Strength (DXY), yields, and Market Volatility (VIX).';
  const confirms = userFacingText(t.whatStrengthensThis || focus.confidenceBasis || 'First confirmed 15-minute close agrees with the lead market and live macro drivers.');
  const weakens = userFacingText(t.whatWeakensThis || focus.reversalRisk || 'Lead market fades back inside the pre-release range or live drivers reject the first move.');
  return [
    '🟦 What is happening',
    happening,
    '',
    '🟨 Why this matters',
    why,
    '',
    '🟧 What moves first',
    movers,
    '',
    '🟩 What confirms it',
    confirms,
    '',
    '🟥 What weakens it',
    weakens,
  ].join('\n');
}

function affectedMarketCards(packet, focus) {
  const expanded = Array.isArray(packet.affectedMarketsExpanded) ? packet.affectedMarketsExpanded : [];
  if (expanded.length) {
    return expanded.slice(0, 8).map(m => {
      const sym = displayInstrument(m.symbol || m.instrument || 'Market');
      const how = userFacingText(m.transmissionMechanism || m.howAffected || 'affected through the primary macro driver');
      const confirm = userFacingText(m.confirmationCondition || m.confirmation || 'lead-market confirmation required');
      return '• ' + sym + ' — ' + how + '; confirmation: ' + confirm + '.';
    }).join('\n');
  }
  const fallback = Array.isArray(focus.affectedMarkets) ? focus.affectedMarkets : [];
  if (!fallback.length) return '• No affected markets mapped by the live interpreter.';
  return fallback.slice(0, 8).map(s => '• ' + displayInstrument(s) + ' — mapped from selected-symbol macro exposure; confirmation required after live drivers align.').join('\n');
}

function sourceProvenanceLine(packet) {
  const cal = (packet.dataFreshness && packet.dataFreshness.calendar) || {};
  const sourceRaw = cal.source || 'calendar_unknown';
  const source = /tradingview/i.test(sourceRaw) ? 'TradingView' : sourceRaw;
  const mode = cal.mode || 'UNAVAILABLE';
  const sourceUsed = Array.isArray(packet.sourceUsed) ? packet.sourceUsed.join('+') : (packet.sourceUsed || 'none');
  const conf = packet.confidenceScore != null ? packet.confidenceScore : 'engine-derived';
  return 'Source: ' + source + ' ' + mode + ' · source_used=' + sourceUsed + ' · confidence=' + conf + ' · basis=' + (packet.confidenceBasis || '—');
}

// ============================================================
// PUBLIC ENTRY POINT
// ============================================================

function formatMacroSearchFoh(ctx) {
  ctx = ctx || {};
  const packet = ctx.macroPacket || {};
  const focus = packet.primaryEventFocus || {};
  const risk = packet.riskState || {};
  const events = Array.isArray(ctx.events) ? ctx.events : [];
  const resolution = ctx.resolution || { displayTarget: 'macro search' };

  // Heading colour doctrine — THE CALL adopts the worst of
  // (risk-state tier, calendar tier). Calendar header adopts
  // calendar tier. Risk header adopts the risk-label tier.
  const calendarTier = topImpactTier(events);
  const riskLabelRaw = String(risk.label || '').toUpperCase();
  const callTier = /EXTREME/.test(riskLabelRaw) || calendarTier === 'extreme'
    ? 'extreme'
    : calendarTier === 'high' || /HIGH|ELEV|ACTIVE|STRESS/.test(riskLabelRaw)
    ? 'high'
    : calendarTier === 'medium' || /MED|MODERATE/.test(riskLabelRaw)
    ? 'medium'
    : 'low';

  const callColor = headerColorForTier(callTier);
  const calendarColor = headerColorForTier(calendarTier);
  const riskColor = riskColorForLabel(risk.label);

  const primaryFocusLine = userFacingText((focus.title || resolution.displayTarget) + (focus.currency ? ' / ' + focus.currency : ''));
  const nextConfirmation = userFacingText(focus.volatilityWindow || 'first confirmed close after the live risk window.');
  const next72Count = Array.isArray(packet.next72Hours) ? packet.next72Hours.length : 0;
  const next24Count = Array.isArray(packet.todayAnnouncements) ? packet.todayAnnouncements.length : 0;

  // Honest engine state — never invent confirmation.
  const degradationLine = ctx.degradationReason === 'none'
    ? 'Degradation: None from macro search. Engine gates: Corey=' + ctx.coreyStatus + ', Corey Clone=' + ctx.cloneSummary.status + ' (usableForDecision=' + ctx.cloneSummary.usableForDecision + '), Spidey=' + ctx.spideyStatus + '.'
    : 'Degradation: ' + userFacingText(ctx.degradationReason);

  const cloneNote = !ctx.cloneSummary.usableForDecision
    ? 'Historical reference: Not decision-grade yet. Current read is based on live macro / calendar / structure only.'
    : null;
  const spideyNote = (ctx.spideyStatus === 'PARTIAL' || ctx.spideyStatus === 'BLOCKED')
    ? 'Structure: confirmation pending. No active execution zone is confirmed by this macro search.'
    : null;

  const lines = [
    boxHeader('📡 MARKET INTEL · MACRO SEARCH — ' + resolution.displayTarget, { color: 'cyan' }),
    buildControlStrip(),
    'Generated: ' + (packet.generatedAtUTC || '—'),
    '',
    boxHeader('🔥 THE CALL', { color: callColor }),
    'Primary focus: ' + primaryFocusLine,
    'Risk state: ' + (risk.label || 'UNKNOWN') + (risk.scoreOutOf5 != null ? ' ' + risk.scoreOutOf5 + '/5' : '') + ' — ' + userFacingText(risk.whyThisRating || 'risk basis unavailable'),
    'Current read: ' + currentReadLine(ctx.janeFinalState),
    'Next confirmation point: ' + nextConfirmation,
    '',
    boxHeader('📅 RANKED CALENDAR EVENTS', { color: calendarColor }),
    rankedEventBlock(events),
    '',
    boxHeader('⚠️ RISK STATE', { color: riskColor }),
    riskDiscs(risk.scoreOutOf5) + ' — ' + (risk.label || 'UNKNOWN'),
    'Why: ' + userFacingText(risk.whyThisRating || 'risk basis unavailable.'),
    'What this means: ' + userFacingText(focus.reversalRisk || 'Direction is not reliable until the first confirmed close agrees with live macro drivers.'),
    '',
    boxHeader('🌍 MARKET IMPACT', { color: 'blue' }),
    marketImpactCards(packet, focus),
    '',
    boxHeader('🎯 AFFECTED MARKETS', { color: 'cyan' }),
    affectedMarketCards(packet, focus),
    '',
    boxHeader('✅ CONFIRMATION / DEGRADATION', { color: 'green' }),
    'Confirmation: ' + userFacingText(focus.confidenceBasis || 'First confirmed close agrees with the lead market and live macro drivers.'),
    degradationLine,
    cloneNote,
    spideyNote,
    '',
    boxHeader('🗓️ FORWARD PLANNING', { color: 'yellow' }),
    'Next 24h: ' + next24Count + ' scheduled event(s). Next 72h: ' + next72Count + ' ranked relevant event(s).',
    'Primary event: ' + userFacingText(focus.title || 'none') + '. Prepare around named windows; outside them, read live US Dollar Strength (DXY), Market Volatility (VIX), yields, and liquidity.',
    'Ranked coverage: ' + (events.length ? events.slice(0, 4).map(e => userFacingText(e.title || 'event')).join(' | ') : 'Brief Pending until the next live packet resolves ranked events.'),
    '',
    boxHeader('🔗 SOURCE / PROVENANCE', { color: 'cyan' }),
    sourceProvenanceLine(packet),
    '',
    '_Jane remains final gate. FOH renders engine output only; no trade call is created from macro search alone._',
  ].filter(l => l != null);

  return userFacingText(lines.join('\n'));
}

module.exports = {
  formatMacroSearchFoh,
  _private: {
    displayInstrument,
    userFacingText,
    impactGlyph,
    topImpactTier,
    headerColorForTier,
    riskColorForLabel,
    riskDiscs,
    currentReadLine,
    buildControlStrip,
    rankedEventBlock,
    marketImpactCards,
    affectedMarketCards,
    sourceProvenanceLine,
  },
};
