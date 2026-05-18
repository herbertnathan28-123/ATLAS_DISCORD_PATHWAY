'use strict';

// ============================================================
// ATLAS FX - user macro search path
//
// Handles operator/user searches such as:
//   EURUSD macro, AMD macro, NFP impact, today's major events,
//   next 72 hours macro
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

// Operator fix 2026-05-19: macro search must be symbol-first. A query
// like `!AMD macro` must resolve AMD before global calendar ranking and
// must not be hijacked by an unrelated top-ranked JPY event.
const EQUITY_SYMBOLS = Object.freeze(new Set([
  'AMD','NVDA','MU','ASML','AAPL','MSFT','META','GOOGL','GOOG','AMZN','TSLA','NFLX','AVGO','INTC','SMCI','ORCL','CRM','QCOM','AMAT','TSM',
]));
const INDEX_SYMBOLS = Object.freeze(new Set(['NAS100','US500','US30','GER40','UK100','JPN225']));
const COMMODITY_SYMBOLS = Object.freeze(new Set(['XAUUSD','XAGUSD','USOIL','UKOIL','BCOUSD','WTI','BRENT']));
const SEMI_SYMBOLS = Object.freeze(new Set(['AMD','NVDA','MU','ASML','AVGO','INTC','SMCI','QCOM','AMAT','TSM']));

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

function isSupportedMacroSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (!s) return false;
  if (s === 'DXY') return true;
  if (/^[A-Z]{6}$/.test(s)) return true;
  if (INDEX_SYMBOLS.has(s) || COMMODITY_SYMBOLS.has(s) || EQUITY_SYMBOLS.has(s)) return true;
  return false;
}

function isEquitySymbol(symbol) { return EQUITY_SYMBOLS.has(String(symbol || '').toUpperCase()); }
function isIndexSymbol(symbol) { return INDEX_SYMBOLS.has(String(symbol || '').toUpperCase()); }
function isCommoditySymbol(symbol) { return COMMODITY_SYMBOLS.has(String(symbol || '').toUpperCase()); }

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
  if (isSupportedMacroSymbol(first)) {
    return { resolved_type: 'symbol', resolved_target: first, displayTarget: first };
  }
  return { resolved_type: 'unknown', resolved_target: raw || 'unknown', displayTarget: raw || 'unknown' };
}

function leadSymbolForTarget(target, type, focus) {
  const t = String(target || '').toUpperCase();
  if (type === 'symbol' && isSupportedMacroSymbol(t) && t !== 'DXY') return t;
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

function fallbackAffectedMarketsForSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (isEquitySymbol(s)) {
    const peers = SEMI_SYMBOLS.has(s) ? ['NVDA','MU','ASML'] : ['AAPL','MSFT','AMZN'];
    return Array.from(new Set([s, 'NAS100', 'US500', 'DXY', 'VIX'].concat(peers.filter(p => p !== s)))).slice(0, 9);
  }
  if (isIndexSymbol(s)) return [s, 'DXY', 'VIX', 'XAUUSD', 'USDJPY', 'NAS100', 'US500'].filter((v, i, a) => a.indexOf(v) === i);
  if (isCommoditySymbol(s)) return [s, 'DXY', 'VIX', 'US500', 'USDJPY'];
  if (/^[A-Z]{6}$/.test(s)) return [s, 'DXY', 'VIX', 'XAUUSD', 'US500'];
  if (s === 'DXY') return ['DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US500', 'NAS100'];
  return [s, 'DXY', 'VIX', 'US500', 'NAS100'].filter(Boolean);
}

function symbolAffectedByEvent(symbol, ev) {
  if (!symbol || !ev) return false;
  const s = String(symbol || '').toUpperCase();
  if (Array.isArray(ev.affectedMarkets) && ev.affectedMarkets.includes(s)) return true;
  if (Array.isArray(ev.affectedInstruments) && ev.affectedInstruments.includes(s)) return true;
  if (/^[A-Z]{6}$/.test(s)) {
    return s.slice(0, 3) === ev.currency || s.slice(3) === ev.currency || ev.currency === 'USD';
  }
  if (s === 'DXY') return ev.currency === 'USD' || /inflation|employment|central_bank|rate_decision|gdp/.test(ev.eventType || '');
  if (isEquitySymbol(s) || isIndexSymbol(s)) {
    if (ev.currency === 'USD') return true;
    const hay = [ev.title, ev.eventType, ev.currency].filter(Boolean).join(' ');
    return /fomc|fed|rate|yield|cpi|inflation|pce|nfp|payroll|jobs|retail|gdp|pmi|ism|tariff|sanction|geopolit|risk/i.test(hay);
  }
  if (isCommoditySymbol(s)) {
    const hay = [ev.title, ev.eventType, ev.currency].filter(Boolean).join(' ');
    return ev.currency === 'USD' || /inflation|rate|yield|gdp|pmi|geopolit|oil|inventory|risk/i.test(hay);
  }
  return false;
}

function buildSymbolFocus(packet, resolution) {
  const symbol = resolution.resolved_target;
  const allEvents = []
    .concat(packet.todayAnnouncements || [])
    .concat(packet.next72Hours || []);
  const match = allEvents.find(e => symbolAffectedByEvent(symbol, e));
  const affected = fallbackAffectedMarketsForSymbol(symbol);
  if (match) return Object.assign({}, packet.primaryEventFocus, {
    title: symbol + ' macro exposure — ' + match.title,
    currency: isEquitySymbol(symbol) || isIndexSymbol(symbol) ? 'USD' : (match.currency || 'multi'),
    eventType: 'selected_symbol_macro',
    timeUTC: match.scheduledTimeUTC || match.timeUTC,
    session: match.session,
    expectedImpact: match.severity,
    whyPrimary: symbol + ' was selected first. This read prioritises ' + symbol + ' exposure, then maps the relevant live catalyst through USD, yields, equity risk appetite, volatility, and peer/sector beta.',
    affectedMarkets: affected,
    volatilityWindow: match.volatilityWindow || 'Read first reaction from T-15 to T+30 minutes, then require the first confirmed close before treating direction as reliable.',
    strongerThanExpectedPath: symbol + ' strengthens only if the catalyst improves risk appetite / sector beta and US Dollar Strength (DXY), yields, and Market Volatility (VIX) do not contradict the move.',
    weakerThanExpectedPath: symbol + ' weakens if the catalyst tightens financial conditions, lifts yields/DXY against equities, or volatility confirms risk-off flow.',
    inLinePath: 'In-line result keeps ' + symbol + ' dependent on live price structure, NAS100/US500 flow, and sector confirmation.',
    reversalRisk: 'Equity-symbol macro reads are fragile until NAS100/US500, US Dollar Strength (DXY), yields, and Market Volatility (VIX) confirm the first move.',
    confidenceBasis: 'Selected by macro-search symbol resolver for ' + symbol + '; symbol-first routing overrides unrelated global calendar leaders.',
  });
  return Object.assign({}, packet.primaryEventFocus, {
    title: symbol + ' macro exposure — symbol-first read',
    currency: isEquitySymbol(symbol) || isIndexSymbol(symbol) ? 'USD' : 'multi',
    eventType: 'selected_symbol_macro',
    timeUTC: null,
    session: 'symbol-first live context',
    expectedImpact: 'SYMBOL_CONTEXT',
    whyPrimary: symbol + ' was requested directly. No matching high-confidence live event row was found, so ATLAS keeps the read anchored to ' + symbol + ' and maps broader cross-asset drivers as context only.',
    affectedMarkets: affected,
    volatilityWindow: 'No selected-symbol release window. Read live price structure, NAS100/US500, US Dollar Strength (DXY), yields, and Market Volatility (VIX).',
    strongerThanExpectedPath: symbol + ' strengthens if price structure confirms while NAS100/US500 and sector peers support the move.',
    weakerThanExpectedPath: symbol + ' weakens if yields/DXY/volatility reject equity risk or price fails the first confirmed close.',
    inLinePath: 'No direct catalyst means direction remains structure-led.',
    reversalRisk: 'High until live structure confirms because no selected-symbol catalyst is active.',
    confidenceBasis: 'Symbol-first macro-search degraded to selected-symbol context; no unrelated calendar event may become primary focus.',
    noLiveMatch: true,
  });
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
    return buildSymbolFocus(packet, resolution);
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

function formatSearchResponse(ctx) {
  const packet = ctx.macroPacket;
  const focus = packet.primaryEventFocus;
  const risk = packet.riskState;
  const affected = (packet.affectedMarketsExpanded || []).slice(0, 10);
  const transmission = packet.macroTransmissionMap && packet.macroTransmissionMap[0] || {};
  const transmission2 = packet.macroTransmissionMap && packet.macroTransmissionMap[1] || null;
  const keyEvents = eventRowsForResponse(packet, ctx.resolution, focus);
  const source = packet.dataFreshness && packet.dataFreshness.calendar || {};
  const lines = [];
  lines.push('🔥 **THE CALL**');
  lines.push('Primary focus: ' + userFacingText(focus.title || ctx.resolution.displayTarget) + (focus.currency ? ' / ' + focus.currency : ''));
  lines.push('Risk state: ' + risk.label + ' — ' + userFacingText(risk.whyThisRating));
  lines.push('Current read: ' + currentReadLine(ctx.janeFinalState));
  lines.push('Best action: wait for confirmation before treating direction as reliable.');
  lines.push('Next confirmation point: ' + userFacingText(focus.volatilityWindow || 'first confirmed close after the live risk window.'));
  lines.push('');
  lines.push('**ATLAS Macro Search — ' + ctx.resolution.displayTarget + '**');
  lines.push('Generated: ' + packet.generatedAtUTC);
  lines.push('');
  lines.push('**RISK STATE**');
  lines.push(riskDiscs(risk.scoreOutOf5) + ' / 5 — ' + risk.label);
  lines.push('');
  lines.push('Why:');
  lines.push(userFacingText(risk.whyThisRating));
  lines.push('');
  lines.push('What this means:');
  lines.push(userFacingText(focus.reversalRisk || 'Direction is not reliable until the first confirmed close agrees with live macro drivers.'));
  lines.push('');
  lines.push('Affected:');
  lines.push(affected.length ? affected.slice(0, 6).map(m => displayInstrument(m.symbol)).join(', ') : 'None mapped by the live interpreter.');
  lines.push('');
  lines.push('**Affected instruments**');
  lines.push(affected.length ? affected.map(m => '- ' + displayInstrument(m.symbol) + ' — ' + userFacingText(m.transmissionMechanism)).join('\n') : '- None mapped by the live interpreter.');
  lines.push('');
  lines.push('**Key events driving the read**');
  lines.push(keyEvents.length ? keyEvents.map(eventLine).join('\n') : '- No matching live scheduled event in the current calendar window.');
  lines.push('');
  lines.push('**MARKET IMPACT**');
  lines.push('Card 1:');
  lines.push('What is happening: ' + userFacingText(transmission.driver || focus.title || 'Live macro driver state'));
  lines.push('Why it matters: ' + userFacingText(transmission.mechanism || focus.whyPrimary || 'Macro drivers are setting risk conditions.'));
  lines.push('What moves first: ' + (Array.isArray(transmission.affectedSymbols) ? transmission.affectedSymbols.slice(0, 5).map(displayInstrument).join(', ') : 'Lead FX and rate-sensitive markets.'));
  lines.push('What confirms it: ' + userFacingText(transmission.whatStrengthensThis || 'The lead market confirms after the first 15-minute close.'));
  lines.push('What weakens it: ' + userFacingText(transmission.whatWeakensThis || 'Live drivers fade or structure rejects the first move.'));
  if (transmission2) {
    lines.push('');
    lines.push('Card 2:');
    lines.push('What is happening: ' + userFacingText(transmission2.driver || 'Live cross-market drivers'));
    lines.push('Why it matters: ' + userFacingText(transmission2.mechanism || 'Live drivers decide whether the calendar impulse is amplified or faded.'));
    lines.push('What moves first: ' + (Array.isArray(transmission2.affectedSymbols) ? transmission2.affectedSymbols.slice(0, 5).map(displayInstrument).join(', ') : 'US Dollar Strength (DXY), yields, and Market Volatility (VIX).'));
    lines.push('What confirms it: ' + userFacingText(transmission2.whatStrengthensThis || 'US Dollar Strength (DXY), yields, and Market Volatility (VIX) agree.'));
    lines.push('What weakens it: ' + userFacingText(transmission2.whatWeakensThis || 'One or more live drivers reverses.'));
  }
  lines.push('');
  lines.push('**What strengthens the read**');
  lines.push(userFacingText(transmission.whatStrengthensThis || risk.whatWouldRaiseIt || 'US Dollar Strength (DXY), yields, Market Volatility (VIX), and the lead pair confirm the macro path after the first 15-minute close.'));
  lines.push('');
  lines.push('**What weakens the read**');
  lines.push(userFacingText(transmission.whatWeakensThis || risk.whatWouldLowerIt || 'Live drivers fade or structure rejects the first macro impulse.'));
  lines.push('');
  lines.push('**Blocked / degraded**');
  lines.push(ctx.degradationReason === 'none' ? 'None from the macro interpreter. Engine gates: Corey=' + ctx.coreyStatus + ', Corey Clone=' + ctx.cloneSummary.status + ' usableForDecision=' + ctx.cloneSummary.usableForDecision + ', Spidey=' + ctx.spideyStatus + '.' : userFacingText(ctx.degradationReason));
  if (!ctx.cloneSummary.usableForDecision) {
    lines.push('Historical reference: Not decision-grade yet. Current read is based on live macro / calendar / structure only.');
  }
  if (ctx.spideyStatus === 'PARTIAL' || ctx.spideyStatus === 'BLOCKED') {
    lines.push('Structure: confirmation pending. No active execution zone is confirmed by this macro search.');
  }
  lines.push('');
  lines.push('**Source note**');
  lines.push('calendar_source=' + (source.source || 'none') + ' · mode=' + (source.mode || 'none') + ' · source_used=' + (Array.isArray(packet.sourceUsed) ? packet.sourceUsed.join('+') : packet.sourceUsed) + ' · confidence=' + packet.confidenceScore + ' · basis=' + packet.confidenceBasis);
  lines.push('');
  lines.push('_Jane remains final gate. FOH renders engine output only; no trade call is created from macro search alone._');
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
  logs.push('[MACRO-SEARCH] lead_symbol=' + ctx.leadSymbol);
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
  const ctx = {
    query: cleanQuery,
    resolution,
    leadSymbol,
    macroPacket,
    coreyStatus: publicStatus(sourceStatus.corey),
    cloneSummary,
    spideyStatus,
    janeFinalState: deriveJaneFinalState(janeOut),
    fohRendered,
    degradationReason: degradation.length ? degradation.join('; ') : 'none',
  };
  const proofLogs = logProof(ctx);
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
