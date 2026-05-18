#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const path = require('path');

const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const { buildDarkHorsePacket } = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const { renderSurfaceOutput } = require(path.join(__dirname, '..', 'foh', 'surfaceRouter'));
const { validateSurfaceText } = require(path.join(__dirname, '..', 'foh', 'config', 'fohSurfaceContracts'));
const { runMacroSearch } = require(path.join(__dirname, '..', 'macro', 'searchMacro'));

function assertSurface(surface, text, label) {
  const res = validateSurfaceText(surface, text);
  assert(res.ok, label + ' failed surface contract: ' + res.failures.join(' | '));
}

function assertOrdered(text, labels) {
  let cursor = -1;
  for (const label of labels) {
    const idx = text.indexOf(label);
    assert(idx > cursor, 'expected section order: ' + label);
    cursor = idx;
  }
}

function marketIntelFixtureText() {
  const packet = buildMarketIntelPacket({
    engine: {
      kind: 'daily',
      mood: { severity: 'HIGH' },
      eventClusters: [{ currency: 'USD', events: [{ title: 'US CPI', time: '12:30 UTC', severity: 'HIGH', currency: 'USD' }] }],
      macroIntelligencePacket: {
        sourceUsed: ['TradingView calendar', 'corey_live'],
        dataFreshness: { calendar: { mode: 'LIVE', source: 'TradingView calendar', available: true } },
        next72Hours: [{ title: 'US CPI', currency: 'USD', timeUTC: '12:30', severity: 'HIGH', affectedMarkets: ['EURUSD', 'DXY'] }],
        eventClusters: [],
        primaryEventFocus: { title: 'US CPI', currency: 'USD', timeUTC: '12:30', affectedMarkets: ['EURUSD', 'DXY'], volatilityWindow: '12:30 UTC release window', whyPrimary: 'Tier-1 inflation event.' },
        riskState: { label: 'ACTIVE', scoreOutOf5: 3, whyThisRating: 'Inflation reprices the rate path.' },
        affectedMarketsExpanded: [{ symbol: 'EURUSD', transmissionMechanism: 'Dollar leg reprices EURUSD.' }],
        macroTransmissionMap: [{ driver: 'US CPI', mechanism: 'Inflation surprise reprices rates.', affectedSymbols: ['EURUSD', 'DXY'], whatStrengthensThis: 'Dollar and yields confirm.', whatWeakensThis: 'Dollar fades.' }],
      },
    },
    reportId: 'MI-surface-proof',
    now: Date.UTC(2026, 4, 18, 6, 0, 0),
  });
  return renderSurfaceOutput({
    surface: 'market_intel',
    packet: miViewModel.toViewModel(packet),
    opts: { reportId: 'MI-surface-proof', maxDiscordChunkChars: 100000 },
  });
}

function darkHorseFixtureText(ranking, reportId) {
  const packet = buildDarkHorsePacket({
    ranking,
    volatility: { level: 'ELEVATED', reason: 'fixture' },
    reportId,
    now: Date.UTC(2026, 4, 18, 6, 0, 0),
    universeSize: ranking.allCount,
  });
  return renderSurfaceOutput({
    surface: 'dark_horse',
    packet: dhViewModel.toViewModel(packet),
    opts: {
      reportId,
      standoutCount: Array.isArray(ranking.top10) ? ranking.top10.filter(c => Number.isFinite(c.score) && c.score >= 7).length : 0,
      maxDiscordChunkChars: 100000,
    },
  });
}

async function main() {
  console.log('\nT1 — Dark Horse contamination test:');
  const dhText = darkHorseFixtureText({
    top10: [{ symbol: 'EURUSD', direction: 'Bullish', score: 8.8, movePhase: 'early', summary: 'clean continuation structure', evidenceAnchors: { recentHigh: { priceText: '1.0925' }, recentLow: { priceText: '1.0870' }, invalidation: { priceText: '1.0840' } } }],
    allCount: 33,
  }, 'DH-surface-proof');
  assertSurface('dark_horse', dhText, 'Dark Horse rendered text');
  console.log('  ✓ Dark Horse output contains no Market Intel-only language');

  console.log('\nT2 — Market Intel contamination test:');
  const miText = marketIntelFixtureText();
  assertSurface('market_intel', miText, 'Market Intel rendered text');
  console.log('  ✓ Market Intel output contains no Dark Horse-only language');

  console.log('\nT3 — Macro contamination test:');
  const now = Date.UTC(2026, 4, 18, 6, 0, 0);
  const macro = await runMacroSearch('EURUSD macro', {
    refreshCalendar: false,
    now,
    snapshot: {
      health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView calendar' },
      events: [{ title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', eventType: 'rate_decision', scheduled_time: now + 3 * 60 * 60 * 1000 }],
    },
  });
  assertSurface('macro_command', macro.content, 'Macro command output');
  assert(/Scenario paths:/.test(macro.content), 'Macro next72/symbol output carries scenario paths');
  assert(/Corey Clone status: (PARTIAL|BLOCKED|NOT_INVOKED)/.test(macro.content), 'Macro output surfaces degraded Corey Clone status');
  assert(/degraded historical read; not decision-grade/i.test(macro.content), 'Macro output warns degraded Corey Clone is not decision-grade');
  console.log('  ✓ Macro command avoids generic Market Intel/Dark Horse filler and carries scenario/source notes');

  console.log('\nT3b — Macro next72 fixture test:');
  const macroNext72 = await runMacroSearch('next 72 hours macro', {
    refreshCalendar: false,
    now,
    snapshot: {
      health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView calendar' },
      events: [
        { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', eventType: 'rate_decision', scheduled_time: now + 3 * 60 * 60 * 1000 },
        { title: 'US CPI', currency: 'USD', impact: 'high', eventType: 'inflation', scheduled_time: now + 6 * 60 * 60 * 1000 },
      ],
    },
  });
  assertSurface('macro_command', macroNext72.content, 'Macro next72 output');
  assert(/Scenario paths:/.test(macroNext72.content), 'Macro next72 includes scenario paths');
  assert(/SOURCE \/ DEGRADATION NOTE/.test(macroNext72.content), 'Macro next72 includes source/degradation note');
  assert(!/No Dark Horse entry priority|0 standouts|NEW DARK HORSE SCAN/.test(macroNext72.content), 'Macro next72 contains no Dark Horse filler');
  console.log('  ✓ next72 macro output stays macro-only and includes scenario paths');

  console.log('\nT4 — Dark Horse 0-standout fixture test:');
  const dhZero = darkHorseFixtureText({ top10: [], allCount: 33 }, 'DH-zero-proof');
  assertSurface('dark_horse', dhZero, 'Dark Horse zero-standout text');
  assert(/0 standouts · 33 markets scanned/.test(dhZero), '0-standout count line present');
  assertOrdered(dhZero, [
    'NEW DARK HORSE SCAN',
    '0 standouts · 33 markets scanned',
    'MARKET MOOD',
    'CURRENT ADVICE — AT RELEASE',
    'WHY NOTHING PROMOTED',
    'BUILDING / PRE-RADAR',
    'WHAT WOULD PROMOTE A CANDIDATE NEXT',
    'WHAT CANCELS THE WATCH',
    'NEXT REVIEW',
    'SOURCE / ENGINE STATUS',
    'END DARK HORSE SCAN',
  ]);
  console.log('  ✓ 0 standouts renders the required Dark Horse-only structure');

  console.log('\nT4b — Market Intel degraded/empty fixture test:');
  assert(/THE CALL/.test(miText), 'Market Intel includes THE CALL');
  assert(/MARKET IMPACT/.test(miText), 'Market Intel includes MARKET IMPACT');
  assert(/SOURCE NOTE/.test(miText), 'Market Intel includes SOURCE NOTE');
  assert(/END OF MARKET INTEL REPORT/.test(miText), 'Market Intel includes end boundary');
  console.log('  ✓ degraded/empty-compatible Market Intel anchors are present');

  console.log('\nT4c — Explicit surface router rejects missing/unknown surface:');
  assert.throws(() => renderSurfaceOutput({ surface: '', packet: {} }), /Unknown FOH surface/);
  assert.throws(() => renderSurfaceOutput({ surface: 'market_intel', packet: dhViewModel.toViewModel(buildDarkHorsePacket({ ranking: { top10: [], allCount: 1 } })) }), /foh_surface_contract_failed/);
  console.log('  ✓ router requires explicit surface and does not infer from packet shape');

  console.log('\nT5 — Production-route fixture proof:');
  assertSurface('dark_horse', dhZero, 'weekly_darkhorses');
  assertSurface('market_intel', miText, 'market_intel');
  assertSurface('macro_command', macro.content, 'macro command');
  console.log('weekly_darkhorses = Dark Horse only');
  console.log('market_intel = Market Intel only');
  console.log('macro command = Macro command only');
  console.log('[FOH-SURFACE-ROUTING-CONTRACTS] PASS');
}

main().catch(err => {
  console.error('[FOH-SURFACE-ROUTING-CONTRACTS] FAIL ' + err.message);
  if (err && err.stack) console.error(err.stack);
  process.exit(1);
}).then(() => process.exit(0));
