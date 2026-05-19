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
// FRESHNESS + STATE GLYPHS (operator directive 2026-05-19 —
// every time-sensitive field shows a colour dot reflecting how
// fresh / how committed the engine read is).
// ============================================================

function freshnessFromMs(generatedMs, nowMs) {
  if (!Number.isFinite(generatedMs) || !Number.isFinite(nowMs) || generatedMs <= 0) {
    return { ageMin: null, glyph: '⚪', label: 'freshness unknown' };
  }
  const ageMin = Math.max(0, Math.round((nowMs - generatedMs) / 60000));
  if (ageMin <= 1)  return { ageMin, glyph: '🟢', label: ageMin + 'm old · live' };
  if (ageMin <= 5)  return { ageMin, glyph: '🟡', label: ageMin + 'm old · usable' };
  if (ageMin <= 15) return { ageMin, glyph: '🟠', label: ageMin + 'm old · ageing' };
  return { ageMin, glyph: '🔴', label: ageMin + 'm old · stale' };
}

function biasGlyph(direction) {
  const d = String(direction || '').toLowerCase();
  if (/long|bull|up/.test(d)) return '🟢';
  if (/short|bear|down/.test(d)) return '🔴';
  if (/neutral|range|balanced/.test(d)) return '⚪';
  return '⚪';
}

function actionStateGlyph(state) {
  const s = String(state || '').toUpperCase();
  if (s === 'ARMED' || s === 'VALID') return '🟢';
  if (s === 'MONITORING' || s === 'PARTIAL' || s === 'WAITING_FOR_CONFIRMATION') return '🟡';
  if (s === 'STAND_DOWN' || s === 'INVALID') return '🔴';
  return '⚪';
}

function viabilityGlyph(label) {
  const s = String(label || '').toUpperCase();
  if (s === 'VALID') return '🟢';
  if (s === 'PARTIAL' || s === 'MARGINAL' || s === 'WAITING_FOR_CONFIRMATION') return '🟡';
  if (s === 'INVALID') return '🔴';
  return '⚪';
}

function eventRiskGlyph(minutesUntil) {
  if (!Number.isFinite(minutesUntil)) return '⚪';
  if (minutesUntil <= 30) return '🔴';
  if (minutesUntil <= 120) return '🟠';
  if (minutesUntil <= 24 * 60) return '🟡';
  return '🟢';
}

function rrGlyph(rr) {
  if (!Number.isFinite(rr)) return '⚪';
  if (rr >= 2) return '🟢';
  if (rr >= 1) return '🟡';
  return '🔴';
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
// SECTION 1 — CURRENT MARKET SNAPSHOT
// What the symbol / event looks like right now: target, asset
// class, last price, intraday delta, generation timestamp,
// freshness dot.
// ============================================================

function inferAssetClass(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (!s || s === 'TODAY_MAJOR_EVENTS' || s === 'NEXT_72_HOURS_MACRO') return 'calendar';
  if (s === 'DXY') return 'index';
  if (/^(NFP|CPI|ECB|FOMC)/i.test(s) || /Minutes$/.test(symbol || '')) return 'event';
  if (/^[A-Z]{6}$/.test(s)) return 'fx';
  if (/^(NAS100|US500|US30|GER40|UK100|JPN225)$/.test(s)) return 'index';
  if (/^(XAUUSD|XAGUSD|USOIL|UKOIL|BCOUSD|WTI|BRENT)$/.test(s)) return 'commodity';
  return 'equity';
}

function formatPriceLine(price, deltaPct) {
  if (!Number.isFinite(price)) return 'Last price: pending';
  const deltaTxt = Number.isFinite(deltaPct)
    ? ' (' + (deltaPct >= 0 ? '+' : '') + deltaPct.toFixed(2) + '%)'
    : '';
  return 'Last price: ' + price + deltaTxt;
}

function snapshotBlock(ctx, packet, resolution) {
  const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
  const generatedMs = packet.generatedAtUTC ? Date.parse(packet.generatedAtUTC) : null;
  const freshness = freshnessFromMs(generatedMs, nowMs);
  const sym = resolution.resolved_target || resolution.displayTarget || 'unknown';
  const assetClass = resolution.assetClass || inferAssetClass(sym);
  const nowIso = new Date(nowMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return [
    'Target: ' + (resolution.displayTarget || sym) + ' · Asset class: ' + assetClass,
    'Clock: ' + nowIso + '  ' + freshness.glyph + ' ' + freshness.label,
    formatPriceLine(ctx.currentPrice, ctx.currentDeltaPct),
    'Generated: ' + (packet.generatedAtUTC || '—'),
  ].join('\n');
}

// ============================================================
// SECTION 2 — CURRENT MARKET CONDITIONS
// Risk state, regime, session, live macro drivers (DXY / VIX
// / yields). Engine-fed from macroPacket.riskState + liveCtx.
// ============================================================

function conditionsBlock(packet, liveCtx) {
  const risk = packet.riskState || {};
  const session = (packet.sessionRisk && packet.sessionRisk.session)
    || (packet.primaryEventFocus && packet.primaryEventFocus.session)
    || 'session pending';
  const regimeRaw = liveCtx && (liveCtx.regime || (liveCtx.internalMacro && liveCtx.internalMacro.regime && liveCtx.internalMacro.regime.regime));
  const regime = regimeRaw ? String(regimeRaw) : 'regime pending';
  const dxyState = liveCtx && liveCtx.dxy ? (liveCtx.dxy.bias || liveCtx.dxy.regime || 'neutral') : 'pending';
  const vixState = liveCtx && liveCtx.vix ? (liveCtx.vix.level || liveCtx.vix.regime || 'normal') : 'pending';
  const yldState = liveCtx && liveCtx.yield ? (liveCtx.yield.regime || 'normal') : 'pending';
  const driversLine = 'US Dollar Strength (DXY): ' + dxyState
    + ' · Market Volatility (VIX): ' + vixState
    + ' · yields: ' + yldState;
  return [
    'Risk: ' + (risk.label || 'UNKNOWN') + (risk.scoreOutOf5 != null ? ' ' + risk.scoreOutOf5 + '/5' : '')
      + ' · ' + riskDiscs(risk.scoreOutOf5) + ' — ' + userFacingText(risk.whyThisRating || 'risk basis pending'),
    'Regime: ' + regime + ' · Session: ' + session,
    'Live drivers: ' + driversLine,
  ].join('\n');
}

// ============================================================
// SECTION 3 — MARKET READ NOW
// Engine alignment header + ON FIRE gate verdict + concrete
// one-liner read for this symbol/event right now.
// ============================================================

function onFireGate(ctx) {
  const state = String(ctx.janeFinalState || '').toUpperCase();
  return state === 'ARMED' || state === 'VALID';
}

function readNowBlock(ctx, packet, resolution) {
  const onFire = onFireGate(ctx);
  const verdict = onFire
    ? '🔥 ON FIRE — Jane has validated a stronger state; execution read below is live.'
    : '🧊 NOT A LIVE CANDIDATE — Jane has not validated a tradable read; execution fields below render honest pending values.';
  const focus = packet.primaryEventFocus || {};
  const align = [
    'Corey=' + (ctx.coreyStatus || 'UNKNOWN'),
    'Corey Clone=' + (ctx.cloneSummary && ctx.cloneSummary.status || 'UNKNOWN') + ' (usable=' + !!(ctx.cloneSummary && ctx.cloneSummary.usableForDecision) + ')',
    'Spidey=' + (ctx.spideyStatus || 'UNKNOWN'),
    'Jane=' + (ctx.janeFinalState || 'UNKNOWN'),
  ].join(' · ');
  return [
    verdict,
    'Engine alignment: ' + align,
    'Primary focus: ' + userFacingText((focus.title || resolution.displayTarget) + (focus.currency ? ' / ' + focus.currency : '')),
    'Read: ' + userFacingText(focus.confidenceBasis || focus.whyPrimary || 'no concrete read until live drivers commit'),
  ].join('\n');
}

// ============================================================
// SECTION 4 — EXECUTION READ (16 time-sensitive fields)
// ON FIRE: pulls live values from janeOut / spideyOut.
// NOT A LIVE CANDIDATE: each field renders an honest pending /
// not-built value with a grey dot so the trader sees the
// missing pieces explicitly.
// ============================================================

function _v(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  return value;
}

function executionReadBlock(ctx) {
  const onFire = onFireGate(ctx);
  const j = ctx.janeOut || {};
  const sp = ctx.spideyOut || {};
  const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
  const generatedMs = j.timestamp ? Date.parse(j.timestamp) : (sp.timestamp ? Date.parse(sp.timestamp) : nowMs);
  const freshness = freshnessFromMs(generatedMs, nowMs);

  const actionState = onFire ? (ctx.janeFinalState || 'ARMED') : 'NOT A LIVE CANDIDATE';
  const biasDir = _v(sp.bias || j.bias || sp.structureBias, onFire ? 'neutral' : 'no committed direction');
  const biasTf = _v(sp.biasTimeframe || sp.timeframe || (sp.htfBias && sp.ltfBias ? 'HTF/LTF' : null), onFire ? '15M / 1H' : 'no committed bias timeframe');
  const validUntil = _v(j.validityWindow || j.validityCondition || (j.validUntilUTC ? j.validUntilUTC + ' UTC' : null), onFire ? 'next 15M close' : 'no validity window — no live trigger');
  const holding = _v(j.holdingWindow || sp.holdingWindow, onFire ? '15M – 1H if confirmed' : 'no holding window proposed');
  const entry = onFire ? _v(j.entry || sp.entry || (sp.executionTrigger && sp.executionTrigger.confirmRule), 'pending — trigger forming') : 'no entry — not a live candidate';
  const currentPrice = Number.isFinite(ctx.currentPrice) ? ctx.currentPrice : null;
  const entryPrice = Number.isFinite(j.entryPrice) ? j.entryPrice : (Number.isFinite(sp.entryPrice) ? sp.entryPrice : null);
  const vsTrigger = (currentPrice != null && entryPrice != null)
    ? (currentPrice - entryPrice >= 0 ? '+' : '') + (currentPrice - entryPrice).toFixed(4) + ' from trigger'
    : (onFire ? 'price vs trigger pending' : 'no trigger to compare against');
  const stop = onFire ? _v(j.stopLoss || sp.invalidation || (sp.invalidation && sp.invalidation.level), 'invalidation pending') : 'no invalidation level — not a live candidate';
  const target = onFire ? _v(j.target || sp.target || (Array.isArray(sp.targets) && sp.targets[0]), 'target not built') : 'no target proposed — not a live candidate';
  const rr = Number.isFinite(j.rr) ? j.rr : (Number.isFinite(sp.rr) ? sp.rr : null);
  const rrTxt = rr != null ? rr.toFixed(2) + ' : 1' : (onFire ? 'R:R pending' : 'no R:R until trigger and stop exist');
  const viability = _v(j.tradeViability || j.actionState, onFire ? 'VALID' : 'no committed viability');
  const eventRiskMin = Number.isFinite(j.nextEventMinutes) ? j.nextEventMinutes : (Number.isFinite(ctx.nextEventMinutes) ? ctx.nextEventMinutes : null);
  const eventRiskTxt = _v(j.eventRisk, eventRiskMin != null ? eventRiskMin + ' min to next named release' : 'no named release inside the active window');
  const spreadLiq = _v(j.spreadLiquidity || (sp.liquidity && sp.liquidity.label), onFire ? 'normal' : 'spread / liquidity not assessed for non-candidate read');
  const decisionRule = _v(j.decisionRule || (sp.executionTrigger && sp.executionTrigger.confirmRule), onFire ? 'first confirmed 15M close inside the trigger zone' : 'no decision rule — not a live candidate');
  const cancelsIf = _v(j.cancelsIf || j.cancellationTrigger || (sp.invalidation && sp.invalidation.reason), onFire ? 'invalidation level breached' : 'no cancellation rule — not a live candidate');

  const rows = [
    ['Action state',          actionState,                    actionStateGlyph(actionState)],
    ['Freshness',             freshness.label,                freshness.glyph],
    ['Bias',                  biasDir,                        biasGlyph(biasDir)],
    ['Bias timeframe',        biasTf,                         onFire ? '🟢' : '⚪'],
    ['Valid until',           validUntil,                     onFire ? '🟢' : '⚪'],
    ['Holding window',        holding,                        onFire ? '🟢' : '⚪'],
    ['Entry / trigger',       entry,                          onFire ? '🟢' : '⚪'],
    ['Current vs trigger',    vsTrigger,                      onFire ? '🟡' : '⚪'],
    ['Invalidation / stop',   stop,                           onFire ? '🟢' : '🔴'],
    ['Target / next draw',    target,                         onFire ? '🟢' : '⚪'],
    ['R:R now',               rrTxt,                          rrGlyph(rr)],
    ['Viability',             viability,                      viabilityGlyph(viability)],
    ['Event risk',            eventRiskTxt,                   eventRiskGlyph(eventRiskMin)],
    ['Spread / liquidity',    spreadLiq,                      onFire ? '🟢' : '⚪'],
    ['Decision rule',         decisionRule,                   onFire ? '🟢' : '⚪'],
    ['Cancels if',            cancelsIf,                      onFire ? '🟢' : '⚪'],
  ];
  return rows.map(([label, value, glyph]) => glyph + ' ' + label + ': ' + userFacingText(String(value))).join('\n');
}

// ============================================================
// NO-GENERIC-ADVICE SCRUB
// (a) Replace specific generic copy with honest concrete
//     alternatives. (b) The QA suite asserts the banned
//     phrases never reach the user surface.
// ============================================================

const GENERIC_BANLIST = Object.freeze([
  /wait for confirmation before treating direction as reliable\.?/gi,
  /monitor live drivers\.?/gi,
  /structure-led\b/gi,
  /see the briefing surface\b/gi,
  /broader macro driver\b/gi,
]);

function scrubGenericAdvice(text) {
  let out = String(text || '');
  for (const re of GENERIC_BANLIST) {
    out = out.replace(re, 'no concrete read in this cycle');
  }
  return out;
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
  const liveCtx = ctx.liveCtx || null;
  const onFire = onFireGate(ctx);

  // Heading colour doctrine — READ NOW adopts the worst of
  // (risk-state tier, calendar tier). Calendar header adopts
  // calendar tier. Risk header adopts the risk-label tier.
  // EXECUTION READ goes green when ON FIRE, grey otherwise.
  const calendarTier = topImpactTier(events);
  const riskLabelRaw = String(risk.label || '').toUpperCase();
  const readTier = /EXTREME/.test(riskLabelRaw) || calendarTier === 'extreme'
    ? 'extreme'
    : calendarTier === 'high' || /HIGH|ELEV|ACTIVE|STRESS/.test(riskLabelRaw)
    ? 'high'
    : calendarTier === 'medium' || /MED|MODERATE/.test(riskLabelRaw)
    ? 'medium'
    : 'low';

  const readColor = headerColorForTier(readTier);
  const calendarColor = headerColorForTier(calendarTier);
  const riskColor = riskColorForLabel(risk.label);
  const executionColor = onFire ? 'green' : 'grey';

  const nextConfirmation = userFacingText(focus.volatilityWindow || 'first concrete read pending until drivers commit.');
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
    '',
    boxHeader('📊 CURRENT MARKET SNAPSHOT', { color: 'cyan' }),
    snapshotBlock(ctx, packet, resolution),
    '',
    boxHeader('🌐 CURRENT MARKET CONDITIONS', { color: riskColor }),
    conditionsBlock(packet, liveCtx),
    '',
    boxHeader('🎯 MARKET READ NOW', { color: readColor }),
    readNowBlock(ctx, packet, resolution),
    'Next confirmation point: ' + nextConfirmation,
    '',
    boxHeader('⚡ EXECUTION READ — ' + (onFire ? 'ON FIRE' : 'NOT A LIVE CANDIDATE'), { color: executionColor }),
    executionReadBlock(ctx),
    '',
    boxHeader('📅 RANKED CALENDAR EVENTS', { color: calendarColor }),
    rankedEventBlock(events),
    '',
    boxHeader('⚠️ RISK STATE', { color: riskColor }),
    riskDiscs(risk.scoreOutOf5) + ' — ' + (risk.label || 'UNKNOWN'),
    'Why: ' + userFacingText(risk.whyThisRating || 'risk basis pending.'),
    'What this means: ' + userFacingText(focus.reversalRisk || 'no concrete read in this cycle'),
    '',
    boxHeader('🌍 MARKET IMPACT', { color: 'blue' }),
    marketImpactCards(packet, focus),
    '',
    boxHeader('🧭 AFFECTED MARKETS', { color: 'cyan' }),
    affectedMarketCards(packet, focus),
    '',
    boxHeader('✅ CONFIRMATION / DEGRADATION', { color: 'green' }),
    'Confirmation: ' + userFacingText(focus.confidenceBasis || 'no concrete read in this cycle'),
    degradationLine,
    cloneNote,
    spideyNote,
    '',
    boxHeader('🗓️ FORWARD PLANNING', { color: 'yellow' }),
    'Next 24h: ' + next24Count + ' scheduled event(s). Next 72h: ' + next72Count + ' ranked relevant event(s).',
    'Primary event: ' + userFacingText(focus.title || 'none') + '. Prepare around named windows; outside them, read live US Dollar Strength (DXY), Market Volatility (VIX), yields, and liquidity.',
    'Ranked coverage: ' + (events.length ? events.slice(0, 4).map(e => userFacingText(e.title || 'event')).join(' | ') : 'Pending until the next live packet resolves ranked events.'),
    '',
    boxHeader('🔗 SOURCE / PROVENANCE', { color: 'cyan' }),
    sourceProvenanceLine(packet),
    '',
    '_Jane remains final gate. FOH renders engine output only; no trade call is created from macro search alone._',
  ].filter(l => l != null);

  return scrubGenericAdvice(userFacingText(lines.join('\n')));
}

module.exports = {
  formatMacroSearchFoh,
  GENERIC_BANLIST,
  _private: {
    displayInstrument,
    userFacingText,
    impactGlyph,
    topImpactTier,
    headerColorForTier,
    riskColorForLabel,
    riskDiscs,
    onFireGate,
    snapshotBlock,
    conditionsBlock,
    readNowBlock,
    executionReadBlock,
    scrubGenericAdvice,
    inferAssetClass,
    freshnessFromMs,
    currentReadLine,
    buildControlStrip,
    rankedEventBlock,
    marketImpactCards,
    affectedMarketCards,
    sourceProvenanceLine,
  },
};
