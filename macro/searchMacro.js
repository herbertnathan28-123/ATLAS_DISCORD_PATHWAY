'use strict';

// ============================================================
// ATLAS FX - user macro search path
//
// Handles operator/user searches such as:
//   EURUSD macro, NFP impact, today's major events, next 72 hours macro
// and routes them through the live calendar interpreter plus Corey,
// Corey Clone, Spidey (where relevant), Jane, and FOH validation.
// ============================================================

const coreyCalendar = require('../corey_calendar');
const { coreyRun } = require('../corey');
const { coreyCloneRun } = require('../corey_clone');
const { spideyRun } = require('../spidey');
const { runJane } = require('../jane');
const { validatePacket, statusFromValidation } = require('../contracts');
const { validateCoreyClone } = require('../engine/validate/validateEngineIntelligence');
const { interpretCalendarEvents, _private: macroInterpreterPrivate } = require('./interpretCalendarEvents');
const { buildMarketIntelPacket } = require('../foh/buildMarketIntelPacket');
const miViewModel = require('../foh/adapters/marketIntelViewModel');
const miShell = require('../renderers/foh/marketIntelV3Shell');
const { validateFohOutput } = require('../foh/validate/validateFohOutput');

let coreyLive = null;
try { coreyLive = require('../corey_live_data'); } catch (_e) { coreyLive = null; }

const SYMBOL_ALIASES = Object.freeze({
  NASDAQ: 'NAS100',
  NDX: 'NAS100',
  SPX: 'US500',
  SP500: 'US500',
  DOW: 'US30',
  DJI: 'US30',
  GOLD: 'XAUUSD',
  XAU: 'XAUUSD',
  SILVER: 'XAGUSD',
  XAG: 'XAGUSD',
});

const EVENT_FAMILIES = Object.freeze([
  { target: 'NFP', eventType: 'employment', currency: 'USD', strictCurrency: true, patterns: [/\bnfp\b/i, /nonfarm/i, /payroll/i] },
  { target: 'CPI', eventType: 'inflation', currency: 'USD', patterns: [/\bcpi\b/i, /inflation/i, /\bpce\b/i] },
  { target: 'ECB', eventType: 'central_bank_speech', currency: 'EUR', patterns: [/\becb\b/i, /lagarde/i] },
  { target: 'FOMC Minutes', eventType: 'central_bank_minutes', currency: 'USD', patterns: [/\bfomc\b/i, /fed minutes/i, /federal reserve minutes/i] },
]);

function normaliseQuery(q) {
  return String(q || '')
    .replace(/^!+/, '')
    .replace(/[’‘]/g, "'")
    .trim()
    .replace(/\s+/g, ' ');
}

function isMacroSearchQuery(query) {
  const q = normaliseQuery(query).toLowerCase();
  if (!q) return false;
  if (/\bmacro\b/.test(q)) return true;
  if (/\bimpact\b/.test(q)) return true;
  if (/today'?s major events/.test(q)) return true;
  if (/next\s*72\s*(hours|hrs|h)?\s*macro/.test(q)) return true;
  return false;
}

function resolveSymbolToken(token) {
  const up = String(token || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return SYMBOL_ALIASES[up] || up;
}

function resolveMacroSearch(query) {
  const raw = normaliseQuery(query);
  const lower = raw.toLowerCase();
  if (/today'?s major events/.test(lower) || /^today\b/.test(lower)) {
    return { resolved_type: 'calendar', resolved_target: 'today_major_events', displayTarget: "today's major events" };
  }
  if (/next\s*72\s*(hours|hrs|h)?\s*macro/.test(lower) || /^next\s*72/.test(lower)) {
    return { resolved_type: 'calendar', resolved_target: 'next_72_hours_macro', displayTarget: 'next 72 hours macro' };
  }
  for (const family of EVENT_FAMILIES) {
    if (family.patterns.some(re => re.test(raw))) {
      return { resolved_type: 'event', resolved_target: family.target, displayTarget: family.target, eventType: family.eventType, currency: family.currency, strictCurrency: !!family.strictCurrency, patterns: family.patterns };
    }
  }
  const first = resolveSymbolToken(raw.split(/\s+/)[0]);
  if (/^(DXY|[A-Z]{6}|NAS100|US500|US30|GER40|UK100|JPN225|XAUUSD|XAGUSD)$/.test(first)) {
    return { resolved_type: 'symbol', resolved_target: first, displayTarget: first };
  }
  return { resolved_type: 'unknown', resolved_target: raw || 'unknown', displayTarget: raw || 'unknown' };
}

function leadSymbolForTarget(target, type, focus) {
  const t = String(target || '').toUpperCase();
  if (/^[A-Z]{6}$/.test(t)) return t;
  if (t === 'DXY') return 'EURUSD';
  const ccy = String((focus && focus.currency) || '').toUpperCase();
  switch (ccy) {
    case 'EUR': return 'EURUSD';
    case 'GBP': return 'GBPUSD';
    case 'JPY': return 'USDJPY';
    case 'AUD': return 'AUDJPY';
    case 'CAD': return 'USDCAD';
    case 'CHF': return 'USDCHF';
    case 'NZD': return 'NZDUSD';
    default: return 'EURUSD';
  }
}

function eventMatchesResolution(ev, resolution) {
  if (!ev) return false;
  if (resolution.resolved_type !== 'event') return false;
  if (resolution.strictCurrency && ev.currency !== resolution.currency) return false;
  const hay = [ev.title, ev.eventType, ev.currency].filter(Boolean).join(' ');
  return (resolution.patterns || []).some(re => re.test(hay));
}

function fallbackAffectedMarketsForEvent(resolution) {
  if (resolution.resolved_target === 'ECB') return ['EURUSD', 'EURGBP', 'EURJPY', 'GER40', 'STOXX50', 'DXY', 'XAUUSD'];
  return ['DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US500', 'NAS100'];
}

function symbolAffectedByEvent(symbol, ev) {
  if (!symbol || !ev) return false;
  if (Array.isArray(ev.affectedMarkets) && ev.affectedMarkets.includes(symbol)) return true;
  if (Array.isArray(ev.affectedInstruments) && ev.affectedInstruments.includes(symbol)) return true;
  if (/^[A-Z]{6}$/.test(symbol)) {
    return symbol.slice(0, 3) === ev.currency || symbol.slice(3) === ev.currency || ev.currency === 'USD';
  }
  if (symbol === 'DXY') return ev.currency === 'USD' || /inflation|employment|central_bank|rate_decision|gdp/.test(ev.eventType || '');
  return false;
}

function selectFocus(packet, resolution) {
  const allEvents = []
    .concat(packet.todayAnnouncements || [])
    .concat(packet.next72Hours || []);
  if (resolution.resolved_type === 'event') {
    const match = allEvents.find(e => eventMatchesResolution(e, resolution));
    if (match) return Object.assign({}, packet.primaryEventFocus, {
      title: match.title,
      currency: match.currency,
      eventType: match.eventType,
      timeUTC: match.scheduledTimeUTC || match.timeUTC,
      session: match.session,
      expectedImpact: match.severity,
      whyPrimary: match.expectedSensitivity || match.whyItMatters || packet.primaryEventFocus.whyPrimary,
      affectedMarkets: match.affectedMarkets || packet.primaryEventFocus.affectedMarkets,
      confidenceBasis: 'Selected by macro-search event resolver for ' + resolution.displayTarget,
    });
    return Object.assign({}, packet.primaryEventFocus, {
      title: resolution.displayTarget + ' impact — no matching live event in current calendar window',
      currency: resolution.currency || 'USD',
      eventType: resolution.eventType || 'scheduled_macro',
      timeUTC: null,
      session: 'not scheduled in current live window',
      expectedImpact: 'DEGRADED',
      whyPrimary: resolution.displayTarget + ' was requested, but TradingView has no matching live row in the current calendar window. The read is scenario-only until a live event appears.',
      affectedMarkets: fallbackAffectedMarketsForEvent(resolution),
      volatilityWindow: 'No named release window available from the live calendar.',
      strongerThanExpectedPath: 'Scenario path only: a stronger/hawkish result would support the home-currency/rate path if DXY/yields confirm.',
      weakerThanExpectedPath: 'Scenario path only: a weaker/dovish result would pressure the home-currency/rate path if DXY/yields confirm.',
      inLinePath: 'Scenario path only: in-line outcomes reduce directional conviction.',
      reversalRisk: 'High while no live scheduled event row exists.',
      confidenceBasis: 'No matching live event row; macro-search degraded to event-family scenario read.',
      noLiveMatch: true,
    });
  }
  if (resolution.resolved_type === 'symbol') {
    const match = allEvents.find(e => symbolAffectedByEvent(resolution.resolved_target, e));
    if (match) return Object.assign({}, packet.primaryEventFocus, {
      title: match.title,
      currency: match.currency,
      eventType: match.eventType,
      timeUTC: match.scheduledTimeUTC || match.timeUTC,
      session: match.session,
      expectedImpact: match.severity,
      whyPrimary: (resolution.resolved_target + ' is exposed to ' + match.title + ' through ' + (match.currency || 'macro') + ' transmission.'),
      affectedMarkets: match.affectedMarkets || packet.primaryEventFocus.affectedMarkets,
      confidenceBasis: 'Selected by macro-search symbol resolver for ' + resolution.resolved_target,
    });
  }
  return packet.primaryEventFocus;
}

function summariseClone(packet, validation) {
  const analogues = packet && Array.isArray(packet.analogues) ? packet.analogues : [];
  const status = validation && validation.status ? validation.status
    : packet && packet.status === 'ACTIVE' ? 'OK'
    : packet && packet.status === 'UNAVAILABLE' ? 'BLOCKED'
    : packet && packet.status === 'PARTIAL' ? 'PARTIAL'
    : 'BLOCKED';
  const explicitUsable = packet && Object.prototype.hasOwnProperty.call(packet, 'usableForDecision');
  const usableForDecision = explicitUsable ? packet.usableForDecision === true : (status === 'OK' && analogues.length >= 3);
  return {
    status,
    usableForDecision,
    sampleSize: packet && packet.sampleSize != null ? packet.sampleSize : (validation && validation.validAnalogues != null ? validation.validAnalogues : analogues.length),
    denominator: packet && packet.denominator != null ? packet.denominator : (packet && packet.denominator_pre_filter != null ? packet.denominator_pre_filter : analogues.length),
    confidenceBasis: packet && packet.confidenceBasis || validation && validation.confidenceBasis || 'Corey Clone validation basis unavailable',
    degradedReason: packet && packet.degradedReason || validation && validation.degradedReason || (usableForDecision ? null : 'not decision-grade'),
  };
}

function sourceStatusFrom(packet, contractName) {
  const v = packet ? validatePacket(packet, contractName) : null;
  return statusFromValidation(v);
}

function publicStatus(status) {
  if (status === 'ACTIVE') return 'ACTIVE';
  if (status === 'PARTIAL') return 'PARTIAL';
  return 'BLOCKED';
}

function spideyPublicStatus(spideyOut, applicable) {
  if (!applicable) return 'NOT_APPLICABLE';
  const st = spideyOut && spideyOut.status ? String(spideyOut.status).toUpperCase() : 'BLOCKED';
  if (st === 'ACTIVE' || st === 'OK') return 'ACTIVE';
  if (st === 'PARTIAL') return 'PARTIAL';
  return 'BLOCKED';
}

function eventRowsForResponse(packet, resolution, focus) {
  const rows = [];
  if (focus && focus.noLiveMatch) return rows;
  const allEvents = []
    .concat(packet.todayAnnouncements || [])
    .concat(packet.next72Hours || []);
  for (const e of allEvents) {
    if (rows.length >= 5) break;
    if (resolution.resolved_type === 'event' && !eventMatchesResolution(e, resolution)) continue;
    if (resolution.resolved_type === 'symbol' && !symbolAffectedByEvent(resolution.resolved_target, e)) continue;
    rows.push(e);
  }
  if (!rows.length && focus) rows.push(focus);
  return rows.slice(0, 5);
}

function displayInstrument(symbol) {
  const s = String(symbol || '');
  if (s === 'DXY') return 'US Dollar Strength (DXY)';
  if (s === 'VIX') return 'Market Volatility (VIX)';
  return s;
}

function userFacingText(text) {
  return String(text || '')
    .replace(/\bDXY\s*\/\s*VIX\b/g, 'US Dollar Strength (DXY) / Market Volatility (VIX)')
    .replace(/\bDXY\s+and\s+VIX\b/gi, 'US Dollar Strength (DXY) and Market Volatility (VIX)')
    .replace(/\bDXY\s*,\s*yields\s*,\s*VIX\b/gi, 'US Dollar Strength (DXY), yields, Market Volatility (VIX)')
    .replace(/(?<!\()DXY\b/g, 'US Dollar Strength (DXY)')
    .replace(/(?<!\()VIX\b/g, 'Market Volatility (VIX)')
    .replace(/US Dollar Strength \(DXY\)\s*\/\s*yields\s*\/\s*Market Volatility \(VIX\)/g, 'US Dollar Strength (DXY), yields, and Market Volatility (VIX)');
}

function riskDiscs(score) {
  const n = Math.max(1, Math.min(5, Math.round(Number(score) || 1)));
  const active = n >= 5 ? '🔴' : n >= 4 ? '🟠' : n >= 3 ? '🟡' : '🔵';
  return active.repeat(n) + '⚫'.repeat(Math.max(0, 5 - n));
}

function eventLine(e) {
  const markets = Array.isArray(e && e.affectedMarkets) ? e.affectedMarkets
    : Array.isArray(e && e.affectedInstruments) ? e.affectedInstruments
    : [];
  const affected = markets.length
    ? markets.slice(0, 4).map(displayInstrument).join(', ')
    : 'Affected markets pending';
  const brief = e && e.briefUrl ? ('Full Brief: ' + e.briefUrl) : 'Full Brief: Brief Pending';
  const parts = [
    e && e.title ? e.title : 'Unnamed event',
    e && e.currency ? '(' + e.currency + ')' : null,
    e && (e.timeUTC || e.scheduledTimeUTC) ? '@ ' + (e.timeUTC || e.scheduledTimeUTC) + ' UTC' : null,
    e && (e.expectedImpact || e.severity) ? '[' + (e.expectedImpact || e.severity) + ']' : null,
    'affected: ' + affected,
    brief,
  ].filter(Boolean);
  return '- ' + parts.join(' — ');
}

function deriveJaneFinalState(janeOut) {
  if (!janeOut || typeof janeOut !== 'object') return 'MONITORING';
  const trade = String(janeOut.tradeViability || '').toUpperCase();
  const action = String(janeOut.actionState || janeOut.monitoringState || '').toUpperCase();
  if (trade === 'VALID' || action === 'ARM') return 'ARMED';
  if (trade === 'INVALID' || action === 'STAND_DOWN') return 'STAND_DOWN';
  if (trade === 'WAITING_FOR_CONFIRMATION' || trade === 'PARTIAL' || trade === 'MARGINAL' || action === 'WAIT') return 'MONITORING';
  return action || trade || 'MONITORING';
}

function currentReadLine(state) {
  if (state === 'ARMED') return 'ARMED — Jane has a stronger validated state; follow the engine confirmation and degradation notes.';
  if (state === 'STAND_DOWN') return 'STAND_DOWN — Jane rejected a confirmed execution read for this search.';
  return 'MONITORING — no confirmed execution read yet.';
}

function buildEngineInput(macroPacket) {
  return {
    kind: 'daily',
    macroIntelligencePacket: macroPacket,
    eventClusters: macroPacket.eventClusters,
    affectedMarketsExpanded: macroPacket.affectedMarketsExpanded,
    affectedMarkets: { symbols: macroPacket.affectedMarketsExpanded.map(m => m.symbol) },
    primaryEventFocus: macroPacket.primaryEventFocus,
    next24To72Hours: macroPacket.next72Hours,
    briefingSummary: macroPacket.dominantMacroTheme + '. Risk state: ' + macroPacket.riskState.label + ' because ' + macroPacket.riskState.whyThisRating + '.',
    whyThisMatters: macroPacket.primaryEventFocus.whyPrimary,
    marketImpact: macroPacket.macroTransmissionMap[0] && macroPacket.macroTransmissionMap[0].mechanism,
    currentRisk: macroPacket.riskState.whyThisRating,
    sourceNote: {
      source: Array.isArray(macroPacket.sourceUsed) ? macroPacket.sourceUsed.join('+') : 'macro_search',
      mode: macroPacket.dataFreshness && macroPacket.dataFreshness.calendar && macroPacket.dataFreshness.calendar.mode,
      probabilityBasis: macroPacket.confidenceBasis,
    },
  };
}

const MACRO_HARD_BOUNDARY = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

function macroReportId(ctx) {
  const stamp = String((ctx.macroPacket && ctx.macroPacket.generatedAtUTC) || new Date().toISOString())
    .replace(/[^0-9]/g, '')
    .slice(0, 12);
  return 'MC-' + (stamp || Date.now().toString(36));
}

function generatedAt(packet) {
  return packet && packet.generatedAtUTC ? packet.generatedAtUTC : new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function marketList(items) {
  return items.map(m => displayInstrument(m && (m.symbol || m.instrument) || m)).filter(Boolean);
}

function macroAffectedBlock(affected) {
  const symbols = marketList(affected);
  return [
    'Primary: ' + (symbols.slice(0, 4).join(' · ') || 'Mapped markets pending'),
    'Secondary: ' + (symbols.slice(4, 6).join(' · ') || 'Full Brief'),
    'More: Full Brief / calendar details',
  ].join('\n');
}

function cloneStatusLine(summary) {
  if (summary && summary.usableForDecision) {
    return 'Historical comparison: decision-grade historical analogue evidence is available.';
  }
  return 'Historical comparison: unavailable for this symbol right now; Jane will not use analogue confidence.';
}

function structureStatusLine(status, spideyOut) {
  if (status === 'ACTIVE') return 'Structure: ACTIVE — Spidey has a usable structure packet.';
  if (status === 'NOT_APPLICABLE') return 'Structure: Not applicable to this calendar-wide query.';
  const reason = spideyOut && (spideyOut.degradedReason || spideyOut.reason);
  return 'Structure: ' + status + ' — missing live structure confirmation' + (reason ? ' (' + userFacingText(reason) + ')' : '') + '.';
}

function formatSearchResponse(ctx) {
  const packet = ctx.macroPacket;
  const focus = packet.primaryEventFocus;
  const risk = packet.riskState;
  const affected = (packet.affectedMarketsExpanded || []).slice(0, 10);
  const transmission = packet.macroTransmissionMap && packet.macroTransmissionMap[0] || {};
  const keyEvents = eventRowsForResponse(packet, ctx.resolution, focus);
  const source = packet.dataFreshness && packet.dataFreshness.calendar || {};
  const reportId = ctx.reportId || macroReportId(ctx);
  const lines = [];
  lines.push(MACRO_HARD_BOUNDARY);
  lines.push('🟦 NEW MACRO COMMAND REPORT');
  lines.push('Report ID: ' + reportId);
  lines.push('Query: ' + ctx.query);
  lines.push('Symbol / scope: ' + displayInstrument(ctx.resolution.resolved_target));
  lines.push('Generated: ' + generatedAt(packet));
  lines.push('Part: 1/1');
  lines.push(MACRO_HARD_BOUNDARY);
  lines.push('');
  lines.push('🧠 JANE STATE');
  lines.push('Jane state: ' + ctx.janeFinalState);
  lines.push('Final gate: Jane remains the final gate; this macro command is monitoring guidance, not a trade call.');
  lines.push('');
  lines.push('🔴 THE CALL');
  lines.push('Primary focus: ' + userFacingText(focus.title || ctx.resolution.displayTarget) + (focus.currency ? ' / ' + focus.currency : ''));
  lines.push('Risk state: ' + risk.label + ' — ' + userFacingText(risk.whyThisRating));
  lines.push('Current read: ' + currentReadLine(ctx.janeFinalState));
  lines.push('Best action: wait for confirmation before treating direction as reliable.');
  lines.push('Next confirmation point: ' + userFacingText(focus.volatilityWindow || 'first confirmed close after the live risk window.'));
  lines.push('');
  lines.push('🟡 MARKET CONTEXT');
  lines.push(riskDiscs(risk.scoreOutOf5) + ' / 5 — ' + risk.label);
  lines.push('Why: ' + userFacingText(risk.whyThisRating));
  lines.push('What this means: ' + userFacingText(focus.reversalRisk || 'Direction is not reliable until the first confirmed close agrees with live macro drivers.'));
  lines.push('');
  lines.push('🕷️ STRUCTURE STATUS');
  lines.push(structureStatusLine(ctx.spideyStatus, ctx.spidey));
  lines.push('');
  lines.push('🧬 COREY CLONE STATUS');
  lines.push('Corey Clone: ' + ctx.cloneSummary.status + ' · usableForDecision=' + (ctx.cloneSummary.usableForDecision ? 'true' : 'false'));
  lines.push(cloneStatusLine(ctx.cloneSummary));
  lines.push('');
  lines.push('🎯 AFFECTED MARKETS');
  lines.push(macroAffectedBlock(affected));
  lines.push('');
  lines.push('🔵 MARKET IMPACT');
  lines.push('What is happening: ' + userFacingText(transmission.driver || focus.title || 'Live macro driver state'));
  lines.push('Why it matters: ' + userFacingText(transmission.mechanism || focus.whyPrimary || 'Macro drivers are setting risk conditions.'));
  lines.push('What moves first: ' + (Array.isArray(transmission.affectedSymbols) ? transmission.affectedSymbols.slice(0, 5).map(displayInstrument).join(', ') : 'Lead FX and rate-sensitive markets.'));
  lines.push('What confirms it: ' + userFacingText(transmission.whatStrengthensThis || 'The lead market confirms after the first 15-minute close.'));
  lines.push('What weakens it: ' + userFacingText(transmission.whatWeakensThis || 'Live drivers fade or structure rejects the first move.'));
  lines.push('');
  lines.push('🧭 CURRENT ADVICE / MONITORING STATE');
  lines.push(currentReadLine(ctx.janeFinalState));
  lines.push('Strengthens if: ' + userFacingText(transmission.whatStrengthensThis || risk.whatWouldRaiseIt || 'US Dollar Strength (DXY), yields, Market Volatility (VIX), and the lead pair confirm after the first 15-minute close.'));
  lines.push('Weakens if: ' + userFacingText(transmission.whatWeakensThis || risk.whatWouldLowerIt || 'Live drivers fade or structure rejects the first macro impulse.'));
  lines.push('');
  lines.push('📅 KEY EVENTS');
  lines.push(keyEvents.length ? keyEvents.slice(0, 3).map(eventLine).join('\n') : '- No matching live scheduled event in the current calendar window.');
  lines.push('');
  lines.push('🔵 SOURCE / DEGRADATION NOTE');
  lines.push('Calendar source: ' + (source.source || 'none') + ' · mode: ' + (source.mode || 'none') + ' · confidence: ' + (packet.confidenceScore || 'pending'));
  lines.push(ctx.degradationReason === 'none' ? 'No degradation reported by the macro interpreter.' : userFacingText(ctx.degradationReason));
  lines.push('');
  lines.push(MACRO_HARD_BOUNDARY);
  lines.push('✅ END OF MACRO COMMAND REPORT');
  lines.push('Report ID: ' + reportId);
  lines.push(MACRO_HARD_BOUNDARY);
  return userFacingText(lines.join('\n'));
}

function logProof(ctx) {
  const logs = [];
  const packet = ctx.macroPacket;
  const calendarSource = packet.dataFreshness && packet.dataFreshness.calendar && packet.dataFreshness.calendar.source || 'none';
  const sourceUsed = Array.isArray(packet.sourceUsed) ? packet.sourceUsed.join('+') : packet.sourceUsed;
  logs.push('[MACRO-SEARCH] query=' + ctx.query);
  logs.push('[MACRO-SEARCH] resolved_type=' + ctx.resolution.resolved_type);
  logs.push('[MACRO-SEARCH] resolved_target=' + ctx.resolution.resolved_target);
  logs.push('[MACRO] calendar_source=' + calendarSource);
  logs.push('[MACRO] source_used=' + sourceUsed);
  logs.push('[COREY] status=' + ctx.coreyStatus);
  logs.push('[COREY-CLONE] status=' + ctx.cloneSummary.status + ' usableForDecision=' + ctx.cloneSummary.usableForDecision);
  logs.push('[SPIDEY] status=' + ctx.spideyStatus);
  logs.push('[JANE] final_state=' + ctx.janeFinalState);
  logs.push('[FOH] rendered=' + (ctx.fohRendered ? 'true' : 'false'));
  logs.push('[DEGRADATION] reason=' + ctx.degradationReason);
  for (const line of logs) console.log(line);
  return logs;
}

async function getSnapshot(opts) {
  if (opts && opts.snapshot) return opts.snapshot;
  if (!opts || opts.refreshCalendar !== false) {
    try { await coreyCalendar.refreshCalendar({ force: true }); } catch (_e) { /* health handles degradation */ }
  }
  return coreyCalendar.getCalendarSnapshot();
}

async function runMacroSearch(query, opts) {
  opts = opts || {};
  const cleanQuery = normaliseQuery(query);
  const resolution = resolveMacroSearch(cleanQuery);
  const snapshot = await getSnapshot(opts);
  let coreyOut = null, cloneOut = null, spideyOut = null, janeOut = null;
  let cloneValidation = null;
  let liveCtx = opts.liveCtx || null;
  try { if (!liveCtx && coreyLive && coreyLive.getLiveContext) liveCtx = coreyLive.getLiveContext(); } catch (_e) { liveCtx = null; }
  const macroPacket = interpretCalendarEvents({
    events: (snapshot && snapshot.events) || [],
    health: (snapshot && snapshot.health) || { available: false, calendar_mode: 'UNAVAILABLE', source_used: null },
    coreyState: liveCtx,
    fmpData: opts.fmpData || { enabled: !!process.env.FMP_API_KEY, available: !!process.env.FMP_API_KEY, source: 'fmp' },
    eodhdData: opts.eodhdData || { enabled: !!process.env.EODHD_API_KEY, available: !!process.env.EODHD_API_KEY, source: 'eodhd' },
    now: opts.now || Date.now(),
  });
  const focus = selectFocus(macroPacket, resolution);
  macroPacket.primaryEventFocus = focus;
  macroPacket.dominantMacroTheme = focus.title === 'No major scheduled catalyst'
    ? macroPacket.dominantMacroTheme
    : (focus.currency || 'multi') + ' ' + (focus.eventType || 'macro') + ' risk: ' + focus.title;
  if (macroInterpreterPrivate && typeof macroInterpreterPrivate.buildAffectedMarketsExpanded === 'function') {
    macroPacket.affectedMarketsExpanded = macroInterpreterPrivate.buildAffectedMarketsExpanded(focus.affectedMarkets || [], focus.title || resolution.displayTarget);
  }
  if (macroInterpreterPrivate && typeof macroInterpreterPrivate.buildTransmissionMap === 'function') {
    macroPacket.macroTransmissionMap = macroInterpreterPrivate.buildTransmissionMap(focus, macroPacket.eventClusters || [], liveCtx);
  }
  const leadSymbol = leadSymbolForTarget(resolution.resolved_target, resolution.resolved_type, focus);
  const spideyApplicable = resolution.resolved_type !== 'calendar' && resolution.resolved_target !== 'DXY';
  try { coreyOut = await coreyRun(leadSymbol, opts.engineOpts || {}); } catch (e) { coreyOut = { status: 'UNAVAILABLE', reason: e.message }; }
  try { cloneOut = await coreyCloneRun(leadSymbol, Object.assign({}, opts.engineOpts || {}, { macroIntelligencePacket: macroPacket })); }
  catch (e) { cloneOut = { status: 'UNAVAILABLE', reason: e.message, usableForDecision: false, symbol: leadSymbol }; }
  try { cloneValidation = validateCoreyClone(cloneOut); } catch (_e) { cloneValidation = { status: 'BLOCKED', validAnalogues: 0, degradedReason: 'clone validation failed' }; }
  if (spideyApplicable) {
    try { spideyOut = await spideyRun(leadSymbol, opts.spideyOpts || {}); }
    catch (e) { spideyOut = { status: 'UNAVAILABLE', reason: e.message, authority: 'structure', symbol: leadSymbol }; }
  }
  const macroOut = {
    authority: 'macro_normalisation',
    score: macroPacket.riskState && macroPacket.riskState.scoreOutOf5 ? macroPacket.riskState.scoreOutOf5 / 5 : 0.5,
    confidence: macroPacket.confidenceScore || 0.4,
    evidence: [{ type: 'macro_search_packet', query: cleanQuery, primaryEvent: focus.title }],
    macroIntelligencePacket: macroPacket,
    symbol: leadSymbol,
    timestamp: new Date().toISOString(),
  };
  const sourceStatus = {
    spidey: spideyApplicable ? sourceStatusFrom(spideyOut, 'SpideyOutput') : 'UNAVAILABLE',
    corey: sourceStatusFrom(coreyOut, 'CoreyOutput'),
    coreyClone: sourceStatusFrom(cloneOut, 'CoreyCloneOutput'),
    macro: sourceStatusFrom(macroOut, 'MacroOutput'),
  };
  try {
    janeOut = await runJane({
      symbol: leadSymbol,
      timestamp: new Date().toISOString(),
      spidey: spideyOut || { status: 'UNAVAILABLE', reason: 'structure_not_applicable', authority: 'structure' },
      corey: coreyOut || { status: 'UNAVAILABLE', reason: 'corey unavailable' },
      coreyClone: cloneOut || { status: 'UNAVAILABLE', reason: 'clone unavailable', usableForDecision: false },
      macro: macroOut,
      coreyMacro: macroPacket,
      sourceStatus,
    }, opts.janeOpts || {});
  } catch (e) {
    janeOut = { actionState: 'MONITORING', tradeViability: 'PARTIAL', degradedReason: e.message, sourceStatus };
  }
  const cloneSummary = summariseClone(cloneOut, cloneValidation);
  const engineInput = buildEngineInput(macroPacket);
  let fohRendered = false;
  let fohReason = null;
  try {
    const fohPacket = buildMarketIntelPacket({
      engine: engineInput,
      coreyClone: { packet: cloneOut, validation: Object.assign({}, cloneValidation || {}, cloneSummary) },
      spidey: spideyApplicable ? { packet: spideyOut, leadSymbol } : null,
      now: opts.now,
    });
    const viewModel = miViewModel.toViewModel(fohPacket);
    const discordText = miShell.buildDiscordTextSummary(viewModel, { maxDiscordChunkChars: 2600 });
    const validation = validateFohOutput({ packet: fohPacket, viewModel, discordText });
    fohRendered = !!validation.ok;
    if (!validation.ok) fohReason = validation.failures && validation.failures[0] || 'foh validation failed';
  } catch (e) {
    fohReason = e.message;
  }
  const degradation = [];
  if (macroPacket.degradedReason) degradation.push(macroPacket.degradedReason);
  if (focus && focus.noLiveMatch) degradation.push('No matching live TradingView event for ' + resolution.displayTarget + '; scenario read only');
  if (!cloneSummary.usableForDecision) degradation.push('Corey Clone ' + cloneSummary.status + ': ' + (cloneSummary.degradedReason || 'not decision-grade'));
  const spideyStatus = spideyPublicStatus(spideyOut, spideyApplicable);
  if (spideyStatus === 'PARTIAL' || spideyStatus === 'BLOCKED') degradation.push('Spidey ' + spideyStatus + (spideyOut && spideyOut.degradedReason ? ': ' + spideyOut.degradedReason : ''));
  if (!fohRendered) degradation.push('FOH validation/render: ' + (fohReason || 'not rendered'));
  if (resolution.resolved_type === 'unknown') degradation.push('query could not be resolved to a symbol, event, or calendar scope');
  const reportId = 'MC-' + Date.now().toString(36);
  const ctx = {
    reportId,
    query: cleanQuery,
    resolution,
    macroPacket,
    coreyStatus: publicStatus(sourceStatus.corey),
    cloneSummary,
    spidey: spideyOut,
    spideyStatus,
    janeFinalState: deriveJaneFinalState(janeOut),
    fohRendered,
    degradationReason: degradation.length ? degradation.join('; ') : 'none',
  };
  const proofLogs = logProof(ctx);
  proofLogs.push('[LIVE-OUTPUT] renderer_attempted=true renderer_result=' + (fohRendered ? 'ok' : 'failed') + ' fallback_used=' + (fohRendered ? 'false' : 'true') + ' fallback_reason=' + (fohRendered ? 'none' : (fohReason || 'foh_validation_failed')) + ' surface=macro_command report_id=' + reportId + ' part=1/1');
  console.log(proofLogs[proofLogs.length - 1]);
  return {
    ok: resolution.resolved_type !== 'unknown' && fohRendered,
    query: cleanQuery,
    resolution,
    leadSymbol,
    macroIntelligencePacket: macroPacket,
    corey: coreyOut,
    coreyClone: cloneOut,
    coreyCloneSummary: cloneSummary,
    spidey: spideyOut,
    jane: janeOut,
    fohRendered,
    degradationReason: ctx.degradationReason,
    proofLogs,
    content: formatSearchResponse(ctx),
  };
}

module.exports = {
  isMacroSearchQuery,
  resolveMacroSearch,
  runMacroSearch,
};
