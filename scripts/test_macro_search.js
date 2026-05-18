#!/usr/bin/env node
'use strict';

// ============================================================
// scripts/test_macro_search.js
//
// QA proof for the live Discord `!<symbol> macro`, `!<event>
// impact`, `!today's major events`, `!next 72 hours macro`
// command paths. Verifies macro/formatMacroSearchFoh.js renders
// the approved FOH / Market Intel visual format and that PR
// #155 (symbol-first routing) + PR #156 (Corey Clone cache
// bootstrap) regressions are not present.
//
// Default mode runs OFFLINE — feeds synthetic packets +
// fixtures into formatMacroSearchFoh() so the formatter is
// exercised without engines / network. Pass `--print` to dump
// rendered text. Pass `--live` to also run runMacroSearch
// against the live TradingView calendar.
// ============================================================

const assert = require('assert');
const { formatMacroSearchFoh } = require('../macro/formatMacroSearchFoh');
const searchMacro = require('../macro/searchMacro');
const { _private: smPrivate } = searchMacro;

// ============================================================
// FIXTURES
// ============================================================

function symbolFocus(symbol, overrides) {
  const base = smPrivate.buildSymbolFocus({ primaryEventFocus: {} }, {
    resolved_type: 'symbol', resolved_target: symbol, displayTarget: symbol,
  });
  return Object.assign({}, base, overrides || {});
}

function basePacket(focus, opts) {
  opts = opts || {};
  return {
    generatedAtUTC: '2026-05-18T23:30:00Z',
    primaryEventFocus: focus,
    riskState: opts.riskState || {
      label: 'MEDIUM', scoreOutOf5: 3,
      whyThisRating: 'broader market read; no symbol-specific catalyst in window.',
    },
    affectedMarketsExpanded: (focus.affectedMarkets || []).map(s => ({
      symbol: s,
      transmissionMechanism: s + ' is mapped through the primary macro driver and lead-market beta.',
      confirmationCondition: 'lead-market confirmation after first 15-minute close',
    })),
    macroTransmissionMap: [{
      driver: focus.title || 'live macro driver',
      mechanism: 'driver flows through US Dollar Strength (DXY), yields, and Market Volatility (VIX).',
      affectedSymbols: focus.affectedMarkets || [],
      whatStrengthensThis: 'lead market and live drivers agree after first confirmed 15-minute close.',
      whatWeakensThis: 'live drivers fade or structure rejects the first move.',
    }],
    todayAnnouncements: opts.todayAnnouncements || [
      { title: 'Japan GDP', currency: 'JPY', timeUTC: '23:50', expectedImpact: 'HIGH', affectedMarkets: ['USDJPY', 'JPN225'], briefUrl: 'Pending' },
    ],
    next72Hours: opts.next72Hours || [
      { title: 'US CPI', currency: 'USD', timeUTC: '12:30', expectedImpact: 'HIGH', affectedMarkets: ['DXY', 'NAS100', 'US500'], briefUrl: 'Pending' },
    ],
    eventClusters: [],
    dataFreshness: { calendar: { source: 'tradingview', mode: 'LIVE' } },
    sourceUsed: ['tradingview'],
    confidenceScore: 0.55,
    confidenceBasis: opts.confidenceBasis || 'synthetic macro-search fixture',
    degradedReason: null,
  };
}

function equityPacket(symbol) {
  const focus = symbolFocus(symbol, {
    title: symbol + ' macro exposure — symbol-first read',
    affectedMarkets: smPrivate.fallbackAffectedMarketsForSymbol(symbol),
    currency: 'USD',
    confidenceBasis: 'Selected by macro-search symbol resolver for ' + symbol + '; symbol-first routing overrides unrelated global calendar leaders.',
  });
  return basePacket(focus, { confidenceBasis: 'symbol-first macro-search synthetic fixture for ' + symbol });
}

function fxPacket(pair) {
  const focus = symbolFocus(pair, {
    title: pair + ' macro exposure — symbol-first read',
    affectedMarkets: smPrivate.fallbackAffectedMarketsForSymbol(pair),
    currency: 'multi',
  });
  return basePacket(focus, { confidenceBasis: 'symbol-first macro-search synthetic fixture for ' + pair });
}

function dxyPacket() {
  const focus = symbolFocus('DXY', {
    title: 'DXY macro exposure — symbol-first read',
    affectedMarkets: smPrivate.fallbackAffectedMarketsForSymbol('DXY'),
    currency: 'USD',
  });
  return basePacket(focus, { confidenceBasis: 'symbol-first macro-search synthetic fixture for DXY' });
}

function eventPacket(eventName, eventCurrency, eventType) {
  // Event-resolution focus — mimics interpretCalendarEvents output
  // when a recognised event family matches a live calendar row.
  const focus = {
    title: eventName,
    currency: eventCurrency,
    eventType,
    affectedMarkets: ['DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US500', 'NAS100'],
    confidenceBasis: 'Selected by macro-search event resolver for ' + eventName,
    confidenceScore: 0.55,
    volatilityWindow: 'first 15-30 minutes after the release; then require first confirmed close.',
  };
  return basePacket(focus, {
    riskState: {
      label: eventName === 'NFP' || eventName === 'CPI' ? 'HIGH' : 'MEDIUM',
      scoreOutOf5: eventName === 'NFP' || eventName === 'CPI' ? 4 : 3,
      whyThisRating: eventName + ' window is active; rate path repricing risk is elevated.',
    },
    confidenceBasis: 'event-resolver macro-search synthetic fixture for ' + eventName,
  });
}

function calendarPacket(label) {
  const focus = {
    title: 'Broader market calendar',
    currency: 'multi',
    eventType: 'calendar',
    affectedMarkets: ['DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US500', 'NAS100', 'VIX'],
    confidenceBasis: 'Calendar-scope macro-search for ' + label,
    volatilityWindow: 'across multiple ranked release windows in the active calendar scope.',
  };
  return basePacket(focus, {
    riskState: {
      label: 'MEDIUM', scoreOutOf5: 3,
      whyThisRating: 'calendar-scope read; ranked windows are visible but no single window leads.',
    },
    confidenceBasis: 'calendar-scope macro-search synthetic fixture for ' + label,
  });
}

function buildCtx(packet, resolution) {
  const focus = packet.primaryEventFocus || {};
  const ctx = {
    query: resolution.displayTarget + ' macro',
    resolution,
    leadSymbol: resolution.resolved_target,
    macroPacket: packet,
    coreyStatus: 'ACTIVE',
    cloneSummary: { status: 'PARTIAL', usableForDecision: false, sampleSize: 0, denominator: 0, confidenceBasis: '', degradedReason: 'fixture' },
    spideyStatus: 'PARTIAL',
    janeFinalState: 'MONITORING',
    fohRendered: true,
    degradationReason: 'none',
  };
  ctx.events = smPrivate.eventRowsForResponse(packet, resolution, focus);
  return ctx;
}

// ============================================================
// ASSERTIONS
// ============================================================

function assertOrder(text, parts, label) {
  let pos = 0;
  for (const p of parts) {
    const i = text.indexOf(p, pos);
    assert(i >= 0, '[' + label + '] out-of-order or missing section: ' + p);
    pos = i;
  }
}

function assertFohFormat(out, label) {
  // Boxed top heading wrapped in an ansi colour block.
  assert(out.includes('```ansi'), '[' + label + '] expected ansi box-header colour block');
  assert(out.includes('╔════════════════════════════════════════════╗'), '[' + label + '] expected ╔══╗ box top edge');
  assert(out.includes('╚════════════════════════════════════════════╝'), '[' + label + '] expected ╚══╝ box bottom edge');

  // Control strip — PNG / PDF / Calendar / Expanded Terminology
  // Hyperlinks / Full Brief. PNG / PDF render as 'Pending'.
  for (const part of [
    '🖼️ PNG: Pending',
    '📄 PDF: Pending',
    '📅 Full Calendar: Available',
    '📘 Expanded Terminology Hyperlinks: Available',
    '🔗 Full Brief: Pending',
  ]) assert(out.includes(part), '[' + label + '] control strip missing: ' + part);

  // Required section order — THE CALL first.
  assertOrder(out, [
    '🔥 THE CALL',
    '📅 RANKED CALENDAR EVENTS',
    '⚠️ RISK STATE',
    '🌍 MARKET IMPACT',
    '🎯 AFFECTED MARKETS',
    '✅ CONFIRMATION / DEGRADATION',
    '🗓️ FORWARD PLANNING',
    '🔗 SOURCE / PROVENANCE',
  ], label + '/section-order');

  // Jane final-gate line closes the report.
  assert(out.includes('Jane remains final gate'), '[' + label + '] Jane final-gate line missing');

  // Operator terminology bans (work-order 2026-05-19).
  for (const banned of [
    'Mechanism Chain',
    'Learning Links',
    '**ATLAS Macro Search',
    '**RISK STATE**',
    '**MARKET IMPACT**',
    '**Affected instruments**',
    '**Key events driving the read**',
    '**Source note**',
    '**Blocked / degraded**',
    '**What strengthens the read**',
    '**What weakens the read**',
  ]) assert(!out.includes(banned), '[' + label + '] banned token still present: ' + banned);

  // Annotation bans from the Notion macro-photos pack (MU Execution
  // Desk screenshot — "no authorised entry omg cmon" / "Sideways is
  // not a term that is commonly used"). The formatter scrubs these
  // before emit; if they still leak, fail.
  assert(!/\bauthoris(?:ed|e)\b/i.test(out), '[' + label + '] banned wording "authorised" leaked');
  assert(!/\bauthoriz(?:ed|e)\b/i.test(out), '[' + label + '] banned wording "authorized" leaked');
  assert(!/\bsideways\b/i.test(out), '[' + label + '] banned wording "Sideways" leaked');

  // No raw DXY / VIX leak at the start of a user-facing line.
  assert(!/(^|\n)\s*[-•]?\s*(DXY|VIX)\b/.test(out), '[' + label + '] raw DXY/VIX leaked at start of line');

  // No execution-permission wording from older builds.
  assert(!/\b(?:entry authorised|trade confirmed|trade permitted|permission granted|permission withheld)\b/i.test(out),
    '[' + label + '] execution-permission wording leaked');
}

function assertEquitySymbolFocus(out, symbol, requiredPeers) {
  // Symbol must remain the primary focus — JPY GDP must not hijack.
  assert(new RegExp('Primary focus: ' + symbol + ' macro exposure').test(out),
    '[' + symbol + '] primary focus must be ' + symbol + '-anchored');
  assert(!/Primary focus:\s*Japan GDP/i.test(out), '[' + symbol + '] JPY GDP must not hijack primary focus');
  assert(!/Primary focus:[^\n]*\/\s*JPY/.test(out), '[' + symbol + '] primary focus must not carry / JPY');

  // Affected markets must include the symbol, NAS100/US500, expanded
  // DXY/VIX labels, and the required peers.
  for (const sym of [symbol, 'NAS100', 'US500'].concat(requiredPeers)) {
    assert(out.includes(sym), '[' + symbol + '] affected markets must include ' + sym);
  }
  assert(out.includes('US Dollar Strength (DXY)'), '[' + symbol + '] DXY must render expanded');
  assert(out.includes('Market Volatility (VIX)'), '[' + symbol + '] VIX must render expanded');
}

// ============================================================
// COMMAND PROOFS
// ============================================================

function proofAmdMacro() {
  const packet = equityPacket('AMD');
  const resolution = { resolved_type: 'symbol', resolved_target: 'AMD', displayTarget: 'AMD' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'AMD macro');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — AMD'), '[AMD] top heading title');
  assertEquitySymbolFocus(out, 'AMD', ['NVDA', 'MU', 'ASML']);
  return out;
}

function proofNvdaMacro() {
  const packet = equityPacket('NVDA');
  const resolution = { resolved_type: 'symbol', resolved_target: 'NVDA', displayTarget: 'NVDA' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'NVDA macro');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — NVDA'), '[NVDA] top heading title');
  assertEquitySymbolFocus(out, 'NVDA', ['AMD', 'MU', 'ASML']);
  return out;
}

function proofMuMacro() {
  const packet = equityPacket('MU');
  const resolution = { resolved_type: 'symbol', resolved_target: 'MU', displayTarget: 'MU' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'MU macro');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — MU'), '[MU] top heading title');
  assertEquitySymbolFocus(out, 'MU', ['AMD', 'NVDA', 'ASML']);
  return out;
}

function proofEurusdMacro() {
  const packet = fxPacket('EURUSD');
  const resolution = { resolved_type: 'symbol', resolved_target: 'EURUSD', displayTarget: 'EURUSD' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'EURUSD macro');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — EURUSD'), '[EURUSD] top heading title');
  assert(/Primary focus: EURUSD macro exposure/.test(out), '[EURUSD] primary focus must be EURUSD-anchored');
  return out;
}

function proofUsdjpyMacro() {
  const packet = fxPacket('USDJPY');
  const resolution = { resolved_type: 'symbol', resolved_target: 'USDJPY', displayTarget: 'USDJPY' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'USDJPY macro');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — USDJPY'), '[USDJPY] top heading title');
  assert(/Primary focus: USDJPY macro exposure/.test(out), '[USDJPY] primary focus must be USDJPY-anchored');
  return out;
}

function proofDxyMacro() {
  const packet = dxyPacket();
  const resolution = { resolved_type: 'symbol', resolved_target: 'DXY', displayTarget: 'DXY' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'DXY macro');
  // DXY is expanded by the terminology contract — the title surfaces
  // as "US Dollar Strength (DXY)" not bare "DXY".
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — US Dollar Strength (DXY)'), '[DXY] top heading title (expanded)');
  return out;
}

function proofNfpImpact() {
  const packet = eventPacket('NFP', 'USD', 'employment');
  const resolution = { resolved_type: 'event', resolved_target: 'NFP', displayTarget: 'NFP' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'NFP impact');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — NFP'), '[NFP] top heading title');
  assert(/Primary focus:[^\n]*NFP/.test(out), '[NFP] primary focus must be NFP-anchored');
  return out;
}

function proofCpiImpact() {
  const packet = eventPacket('CPI', 'USD', 'inflation');
  const resolution = { resolved_type: 'event', resolved_target: 'CPI', displayTarget: 'CPI' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'CPI impact');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — CPI'), '[CPI] top heading title');
  assert(/Primary focus:[^\n]*CPI/.test(out), '[CPI] primary focus must be CPI-anchored');
  return out;
}

function proofFomcMinutesImpact() {
  const packet = eventPacket('FOMC Minutes', 'USD', 'central_bank_minutes');
  const resolution = { resolved_type: 'event', resolved_target: 'FOMC Minutes', displayTarget: 'FOMC Minutes' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'FOMC Minutes impact');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — FOMC Minutes'), '[FOMC] top heading title');
  assert(/Primary focus:[^\n]*FOMC Minutes/.test(out), '[FOMC] primary focus must be FOMC-anchored');
  return out;
}

function proofTodaysMajorEvents() {
  const packet = calendarPacket("today's major events");
  const resolution = { resolved_type: 'calendar', resolved_target: 'today_major_events', displayTarget: "today's major events" };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, "today's major events");
  assert(out.includes("📡 MARKET INTEL · MACRO SEARCH — today's major events"), '[today] top heading title');
  return out;
}

function proofNext72HoursMacro() {
  const packet = calendarPacket('next 72 hours macro');
  const resolution = { resolved_type: 'calendar', resolved_target: 'next_72_hours_macro', displayTarget: 'next 72 hours macro' };
  const ctx = buildCtx(packet, resolution);
  const out = formatMacroSearchFoh(ctx);
  assertFohFormat(out, 'next 72 hours macro');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — next 72 hours macro'), '[next72] top heading title');
  return out;
}

// ============================================================
// LIVE INTEGRATION (optional, --live flag)
// ============================================================

async function runLiveIntegration() {
  const coreyCalendar = require('../corey_calendar');
  await coreyCalendar.refreshCalendar({ force: true });
  const snapshot = coreyCalendar.getCalendarSnapshot();
  assert((snapshot.events || []).length > 0, 'calendar returned events');

  const queries = ['EURUSD macro', 'AMD macro', 'CPI impact', "today's major events", 'next 72 hours macro'];
  for (const query of queries) {
    const result = await searchMacro.runMacroSearch(query, { snapshot, refreshCalendar: false });
    assert(result.ok, query + ' returned ok');
    assertFohFormat(result.content, 'live:' + query);
    // Required proof logs per work-order acceptance gate.
    assert(result.proofLogs.some(l => l === '[MACRO-SEARCH] query=' + query), query + ' proof log: query');
    assert(result.proofLogs.some(l => /^\[MACRO-SEARCH\] resolved_type=/.test(l)), query + ' proof log: resolved_type');
    assert(result.proofLogs.some(l => /^\[MACRO-SEARCH\] resolved_target=/.test(l)), query + ' proof log: resolved_target');
    assert(result.proofLogs.some(l => /^\[MACRO-SEARCH\] lead_symbol=/.test(l)), query + ' proof log: lead_symbol');
    assert(result.proofLogs.some(l => /^\[COREY-CLONE\] status=/.test(l)), query + ' proof log: COREY-CLONE');
    assert(result.proofLogs.some(l => /^\[SPIDEY\] status=/.test(l)), query + ' proof log: SPIDEY');
    assert(result.proofLogs.some(l => /^\[JANE\] final_state=/.test(l)), query + ' proof log: JANE');
    assert(result.proofLogs.some(l => /^\[FOH\] rendered=true$/.test(l)), query + ' proof log: FOH rendered=true');
    if (query === 'AMD macro') {
      assert.strictEqual(result.resolution.resolved_target, 'AMD', 'AMD macro lead remains AMD');
      assert.strictEqual(result.leadSymbol, 'AMD', 'AMD macro lead symbol remains AMD');
      assert(/Primary focus: AMD macro exposure/.test(result.content), 'AMD macro primary focus is AMD-anchored');
      assert(!/Corey Clone [^\n]*USDJPY\/1D\.jsonl/i.test(result.content), 'AMD macro does not surface USDJPY Corey Clone cache path');
    }
  }
}

// ============================================================
// MAIN
// ============================================================

const PROOFS = [
  ['AMD macro',             proofAmdMacro],
  ['NVDA macro',            proofNvdaMacro],
  ['MU macro',              proofMuMacro],
  ['EURUSD macro',          proofEurusdMacro],
  ['USDJPY macro',          proofUsdjpyMacro],
  ['DXY macro',             proofDxyMacro],
  ['NFP impact',            proofNfpImpact],
  ['CPI impact',            proofCpiImpact],
  ['FOMC Minutes impact',   proofFomcMinutesImpact],
  ["today's major events",  proofTodaysMajorEvents],
  ['next 72 hours macro',   proofNext72HoursMacro],
];

async function main() {
  const args = process.argv.slice(2);
  const print = args.includes('--print');
  const live = args.includes('--live');

  const outputs = [];
  for (const [name, proof] of PROOFS) {
    const out = proof();
    outputs.push([name, out]);
  }

  if (print) {
    for (const [name, out] of outputs) {
      console.log('========== !' + name + ' ==========');
      console.log(out);
      console.log('');
    }
  }

  if (live) {
    console.log('[MACRO-SEARCH-QA] running live integration pass…');
    await runLiveIntegration();
    console.log('[MACRO-SEARCH-QA] live integration ok');
  }

  console.log('OK — macro-search FOH/Market Intel format proven for ' + PROOFS.length + ' commands' + (live ? ' + live' : ''));
}

if (require.main === module) {
  main().catch(err => {
    console.error('[MACRO-SEARCH-QA] FAIL ' + err.message);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = {
  proofAmdMacro, proofNvdaMacro, proofMuMacro,
  proofEurusdMacro, proofUsdjpyMacro, proofDxyMacro,
  proofNfpImpact, proofCpiImpact, proofFomcMinutesImpact,
  proofTodaysMajorEvents, proofNext72HoursMacro,
};
