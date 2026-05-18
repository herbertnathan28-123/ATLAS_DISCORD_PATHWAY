#!/usr/bin/env node
'use strict';

// ============================================================
// scripts/test_macro_search.js
//
// QA proof for the live Discord `!<symbol> macro` command path.
// Verifies macro/searchMacro.js renders the approved FOH /
// Market Intel visual format — boxed headers, control strip,
// THE CALL first, ranked calendar events, risk state, market
// impact, affected markets, confirmation / degradation, forward
// planning, source / provenance, Jane final-gate line — and
// preserves PR #155 symbol-first routing (`!AMD macro` stays
// AMD-anchored even when JPY GDP leads the global calendar).
//
// Default mode runs OFFLINE — feeds a synthetic packet + ctx
// into the exposed _private.formatSearchResponse seam so the
// formatter is exercised without engines / network.
//
// Pass `--print` to dump the rendered text. Pass `--live` to
// also run the runMacroSearch integration pass against the
// live TradingView calendar (requires network).
// ============================================================

const assert = require('assert');
const searchMacro = require('../macro/searchMacro');
const { _private } = searchMacro;

function symbolFocus(symbol, overrides) {
  const base = _private.buildSymbolFocus({ primaryEventFocus: {} }, {
    resolved_type: 'symbol', resolved_target: symbol, displayTarget: symbol,
  });
  return Object.assign({}, base, overrides || {});
}

function buildAmdPacket() {
  const focus = symbolFocus('AMD', {
    title: 'AMD macro exposure — symbol-first read',
    affectedMarkets: _private.fallbackAffectedMarketsForSymbol('AMD'),
    currency: 'USD',
    confidenceBasis: 'Selected by macro-search symbol resolver for AMD; symbol-first routing overrides unrelated global calendar leaders.',
  });
  return {
    generatedAtUTC: '2026-05-18T23:30:00Z',
    primaryEventFocus: focus,
    riskState: {
      label: 'MEDIUM',
      scoreOutOf5: 3,
      whyThisRating: 'AMD selected-symbol read; broader market calendar has no AMD-specific catalyst in window.',
    },
    affectedMarketsExpanded: focus.affectedMarkets.map(s => ({
      symbol: s,
      transmissionMechanism: s + ' is mapped through US growth / rate path and semis sector beta.',
      confirmationCondition: 'lead-market confirmation after first 15-minute close',
    })),
    macroTransmissionMap: [{
      driver: 'AMD selected-symbol macro context',
      mechanism: 'Semis sector beta + NAS100/US500 risk appetite + US Dollar Strength (DXY) / yields decide AMD path.',
      affectedSymbols: focus.affectedMarkets,
      whatStrengthensThis: 'NAS100 / US500 confirm, peers (NVDA, MU, ASML) confirm, DXY/VIX do not contradict.',
      whatWeakensThis: 'Yields / DXY tighten financial conditions or peers reject the move.',
    }],
    todayAnnouncements: [
      { title: 'Japan GDP', currency: 'JPY', timeUTC: '23:50', expectedImpact: 'HIGH', affectedMarkets: ['USDJPY', 'JPN225'], briefUrl: 'Brief Pending' },
    ],
    next72Hours: [
      { title: 'US CPI', currency: 'USD', timeUTC: '12:30', expectedImpact: 'HIGH', affectedMarkets: ['DXY', 'NAS100', 'US500', 'AMD'], briefUrl: 'Brief Pending' },
    ],
    eventClusters: [],
    dataFreshness: { calendar: { source: 'tradingview', mode: 'LIVE' } },
    sourceUsed: ['tradingview'],
    confidenceScore: 0.55,
    confidenceBasis: 'symbol-first macro-search synthetic fixture',
    degradedReason: null,
  };
}

function buildCtx(packet, resolution) {
  return {
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
}

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

  // Control strip (PNG / PDF / Calendar / Terminology / Full Brief).
  for (const part of [
    '🖼️ PNG: Brief Pending',
    '📄 PDF: Brief Pending',
    '📅 Full Calendar: Available',
    '📘 Terminology: Available',
    '🔗 Full Brief: Brief Pending',
  ]) assert(out.includes(part), '[' + label + '] control strip missing: ' + part);

  // Required section order — THE CALL first, then ranked events,
  // risk state, market impact, affected markets, confirmation /
  // degradation, forward planning, source / provenance.
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

  // Jane final-gate line must close the report.
  assert(out.includes('Jane remains final gate'), '[' + label + '] Jane final-gate line missing');

  // Old-wall layout must be gone.
  for (const banned of [
    '**ATLAS Macro Search',
    '**RISK STATE**',
    '**MARKET IMPACT**',
    '**Affected instruments**',
    '**Key events driving the read**',
    '**Source note**',
    '**Blocked / degraded**',
    '**What strengthens the read**',
    '**What weakens the read**',
  ]) assert(!out.includes(banned), '[' + label + '] old plain-text wall token still present: ' + banned);

  // No raw DXY / VIX leak at the start of user-facing lines.
  assert(!/(^|\n)\s*[-•]?\s*(DXY|VIX)\b/.test(out), '[' + label + '] raw DXY/VIX leaked at start of line');

  // No execution-authority wording.
  assert(!/\b(?:authorised|entry authorised|trade confirmed|trade permitted)\b/i.test(out), '[' + label + '] execution-authority wording leaked');
}

function runAmdMacroProof() {
  const packet = buildAmdPacket();
  const resolution = { resolved_type: 'symbol', resolved_target: 'AMD', displayTarget: 'AMD' };
  const ctx = buildCtx(packet, resolution);
  const out = _private.formatSearchResponse(ctx);

  assertFohFormat(out, 'AMD');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — AMD'), '[AMD] top heading title');

  // AMD must remain the primary focus — JPY GDP must not hijack.
  assert(/Primary focus: AMD macro exposure/.test(out), '[AMD] primary focus must be AMD-anchored');
  assert(!/Primary focus:\s*Japan GDP/i.test(out), '[AMD] JPY GDP must not hijack primary focus');
  assert(!/Primary focus:[^\n]*\/\s*JPY/.test(out), '[AMD] primary focus must not carry / JPY');

  // Affected markets row must include AMD + peers + indices + macro
  // context (NAS100, US500, DXY/VIX expanded labels, NVDA, MU, ASML).
  for (const sym of ['AMD', 'NAS100', 'US500', 'NVDA', 'MU', 'ASML']) {
    assert(out.includes(sym), '[AMD] affected markets must include ' + sym);
  }
  assert(out.includes('US Dollar Strength (DXY)'), '[AMD] DXY must render expanded');
  assert(out.includes('Market Volatility (VIX)'), '[AMD] VIX must render expanded');

  return out;
}

function runTodaysEventsProof() {
  const packet = buildAmdPacket();
  const resolution = { resolved_type: 'calendar', resolved_target: 'today_major_events', displayTarget: "today's major events" };
  const ctx = buildCtx(packet, resolution);
  const out = _private.formatSearchResponse(ctx);
  assertFohFormat(out, 'today');
  assert(out.includes("📡 MARKET INTEL · MACRO SEARCH — today's major events"), '[today] top heading title');
  return out;
}

function runCpiImpactProof() {
  const packet = buildAmdPacket();
  // Override focus to mimic an event-resolution result.
  packet.primaryEventFocus = Object.assign({}, packet.primaryEventFocus, {
    title: 'US CPI',
    currency: 'USD',
    eventType: 'inflation',
    affectedMarkets: ['DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US500', 'NAS100'],
    confidenceBasis: 'Selected by macro-search event resolver for CPI',
  });
  const resolution = { resolved_type: 'event', resolved_target: 'CPI', displayTarget: 'CPI' };
  const ctx = buildCtx(packet, resolution);
  const out = _private.formatSearchResponse(ctx);
  assertFohFormat(out, 'CPI');
  assert(out.includes('📡 MARKET INTEL · MACRO SEARCH — CPI'), '[CPI] top heading title');
  return out;
}

async function runLiveIntegration() {
  // Live integration assertions — requires network. Validates
  // proofLogs schema, no PR #155 symbol-first regressions, and
  // that the FOH format applies to the real engine output too.
  const coreyCalendar = require('../corey_calendar');
  await coreyCalendar.refreshCalendar({ force: true });
  const snapshot = coreyCalendar.getCalendarSnapshot();
  assert((snapshot.events || []).length > 0, 'calendar returned events');

  const queries = ['EURUSD macro', 'AMD macro', "today's major events"];
  for (const query of queries) {
    const result = await searchMacro.runMacroSearch(query, { snapshot, refreshCalendar: false });
    assert(result.ok, query + ' returned ok');
    assertFohFormat(result.content, 'live:' + query);
    assert(result.proofLogs.some(l => l === '[MACRO-SEARCH] query=' + query), query + ' proof log includes query');
    assert(result.proofLogs.some(l => /^\[FOH\] rendered=true$/.test(l)), query + ' proof log includes FOH rendered=true');
    if (query === 'AMD macro') {
      assert.strictEqual(result.resolution.resolved_target, 'AMD', 'AMD macro lead remains AMD');
      assert.strictEqual(result.leadSymbol, 'AMD', 'AMD macro lead symbol remains AMD');
      assert(/Primary focus: AMD macro exposure/.test(result.content), 'AMD macro primary focus is AMD-anchored');
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const print = args.includes('--print');
  const live = args.includes('--live');

  const amd = runAmdMacroProof();
  const today = runTodaysEventsProof();
  const cpi = runCpiImpactProof();

  if (print) {
    console.log('========== !AMD macro ==========');
    console.log(amd);
    console.log('');
    console.log("========== !today's major events ==========");
    console.log(today);
    console.log('');
    console.log('========== !CPI impact ==========');
    console.log(cpi);
    console.log('');
  }

  if (live) {
    console.log('[MACRO-SEARCH-QA] running live integration pass…');
    await runLiveIntegration();
    console.log('[MACRO-SEARCH-QA] live integration ok');
  }

  console.log('OK — macro-search FOH/Market Intel format proven (!AMD macro · !today\'s major events · !CPI impact)' + (live ? ' + live' : ''));
}

if (require.main === module) {
  main().catch(err => {
    console.error('[MACRO-SEARCH-QA] FAIL ' + err.message);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { runAmdMacroProof, runTodaysEventsProof, runCpiImpactProof };
