#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Hard acceptance tests derived from the uploaded
// "ATLAS FX — PROTOTYPE IMPLEMENTATION CONTRACTS" brief.
//
// These tests are intentionally local-only. They do not touch Render,
// deployment, Discord, or live external services.

const path = require('path');

const { buildDailyRoadmapMessages } = require(path.join(__dirname, '..', 'coreyMarketIntel'));
const { buildDarkHorsePacket } = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const { renderSurfaceOutput } = require(path.join(__dirname, '..', 'foh', 'surfaceRouter'));

let passed = 0;
let failed = 0;
const failures = [];

function pass(label) {
  passed++;
  console.log('  ✓ ' + label);
}

function fail(label, detail) {
  failed++;
  const suffix = detail ? ' :: ' + String(detail).slice(0, 260) : '';
  failures.push(label + suffix);
  console.error('  ✗ ' + label + suffix);
}

function check(condition, label, detail) {
  if (condition) pass(label);
  else fail(label, detail);
}

function indexOfAny(text, needles) {
  let out = -1;
  for (const n of needles) {
    const idx = text.indexOf(n);
    if (idx !== -1 && (out === -1 || idx < out)) out = idx;
  }
  return out;
}

function assertOrdered(text, labels, scope) {
  let cursor = -1;
  for (const label of labels) {
    const idx = text.indexOf(label);
    check(idx > cursor, scope + ' section order includes "' + label + '" after previous section', 'idx=' + idx + ' cursor=' + cursor);
    if (idx > cursor) cursor = idx;
  }
}

function countMatches(text, re) {
  return (String(text || '').match(re) || []).length;
}

function sectionSlice(text, startLabel, endLabels) {
  const start = text.indexOf(startLabel);
  if (start === -1) return '';
  const afterStart = start + startLabel.length;
  const relEnd = indexOfAny(text.slice(afterStart), endLabels || []);
  return relEnd === -1 ? text.slice(afterStart) : text.slice(afterStart, afterStart + relEnd);
}

function hasBoxDrawnHeading(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('╔[\\s\\S]{0,180}║[^\\n]*' + escaped + '[^\\n]*║[\\s\\S]{0,180}╚').test(text);
}

function buildDarkHorseText(ranking, reportId) {
  const packet = buildDarkHorsePacket({
    ranking,
    volatility: { level: 'ELEVATED', reason: 'prototype-contract-fixture' },
    reportId,
    now: Date.UTC(2026, 4, 18, 6, 0, 0),
    universeSize: ranking.allCount,
  });
  return renderSurfaceOutput({
    surface: 'dark_horse',
    packet: dhViewModel.toViewModel(packet),
    opts: {
      reportId,
      universeSize: ranking.allCount,
      standoutCount: Array.isArray(ranking.top10) ? ranking.top10.filter(c => Number(c.score) >= 7).length : 0,
      maxDiscordChunkChars: 100000,
    },
  });
}

const NOW = Date.UTC(2026, 4, 18, 6, 0, 0);
const macroPacket = {
  generatedAtUTC: '2026-05-18 06:00 UTC',
  sourceUsed: ['TradingView calendar', 'corey_live'],
  dataFreshness: { calendar: { mode: 'LIVE', source: 'TradingView calendar', available: true } },
  calendarEventsRawCount: 86,
  todayAnnouncements: [],
  next72Hours: [
    {
      title: 'ECB Rate Decision',
      currency: 'EUR',
      timeUTC: '11:45',
      scheduledTimeUTC: '2026-05-18T11:45:00.000Z',
      severity: 'HIGH',
      importanceScore: 95,
      affectedMarkets: ['EURUSD', 'DXY', 'GER40'],
      fullBrief: '/market-intel/brief/ecb-rate-decision',
      forecast: '3.75%',
      previous: '4.00%',
    },
    {
      title: 'US CPI',
      currency: 'USD',
      timeUTC: '12:30',
      scheduledTimeUTC: '2026-05-18T12:30:00.000Z',
      severity: 'HIGH',
      importanceScore: 90,
      affectedMarkets: ['DXY', 'EURUSD', 'XAUUSD'],
      fullBrief: null,
      forecast: '0.3%',
      previous: '0.2%',
    },
  ],
  eventClusters: [],
  primaryEventFocus: {
    title: 'ECB Rate Decision',
    currency: 'EUR',
    eventType: 'rate_decision',
    timeUTC: '11:45',
    expectedImpact: 'HIGH',
    affectedMarkets: ['EURUSD', 'DXY', 'GER40'],
    volatilityWindow: '11:45 UTC release window',
    whyPrimary: 'Tier-1 central-bank event.',
    strongerThanExpectedPath: 'Hawkish surprise supports EUR if US Dollar Strength (DXY) confirms breadth.',
    weakerThanExpectedPath: 'Dovish surprise pressures EUR if US Dollar Strength (DXY) strengthens.',
    reversalRisk: 'First move can reverse if press-conference tone contradicts the decision.',
  },
  riskState: {
    label: 'ACTIVE',
    scoreOutOf5: 4,
    whyThisRating: 'ECB and US CPI are clustered; US Dollar Strength (DXY) and Market Volatility (VIX) must confirm after release.',
    whatWouldRaiseIt: 'US Dollar Strength (DXY), yields, and Market Volatility (VIX) confirm the move.',
    whatWouldLowerIt: 'Calendar reaction fades and volatility compresses.',
  },
  affectedMarketsExpanded: [
    {
      symbol: 'EURUSD',
      strongerThanExpectedPath: 'EUR supported if rate path reprices higher.',
      weakerThanExpectedPath: 'EUR pressured if the rate path reprices lower.',
      confirmationCondition: 'EURUSD closes outside the pre-event range.',
      invalidationCondition: 'First move fades back into the pre-event range.',
      transmissionMechanism: 'Rate-path repricing drives the EUR leg.',
    },
    {
      symbol: 'DXY',
      strongerThanExpectedPath: 'Dollar softens if EUR repricing dominates.',
      weakerThanExpectedPath: 'Dollar strengthens if dovish EUR tone leads.',
      confirmationCondition: 'US Dollar Strength (DXY) confirms the cross-market move.',
      invalidationCondition: 'US Dollar Strength (DXY) rejects the move.',
      transmissionMechanism: 'Dollar leg confirms breadth.',
    },
  ],
  macroTransmissionMap: [
    {
      driver: 'ECB Rate Decision',
      mechanism: 'Rate-path repricing changes EUR, dollar, yields, and index risk appetite.',
      affectedSymbols: ['EURUSD', 'DXY', 'GER40'],
      whatStrengthensThis: 'EURUSD and yields confirm after the first 15-minute close.',
      whatWeakensThis: 'US Dollar Strength (DXY) fades and EURUSD returns inside the pre-event range.',
    },
  ],
  confidenceBasis: 'TradingView calendar live feed and local fixture packet.',
};

function buildMarketIntelMessages() {
  const snapshot = {
    health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView calendar' },
    events: macroPacket.next72Hours.map((e, idx) => ({
      title: e.title,
      currency: e.currency,
      impact: 'high',
      scheduled_time: NOW + (idx + 1) * 60 * 60 * 1000,
    })),
  };
  return buildDailyRoadmapMessages(snapshot, { level: 'elevated' }, NOW, {
    macroIntelligencePacket: macroPacket,
    affectedSymbols: ['EURUSD', 'DXY', 'GER40', 'XAUUSD'],
    reportId: 'MI-prototype-contract',
  });
}

function loadMacroSearchWithEngineMocks() {
  const moduleIds = [
    '../macro/searchMacro',
    '../corey',
    '../corey_clone',
    '../spidey',
    '../jane',
  ];
  for (const id of moduleIds) {
    try { delete require.cache[require.resolve(path.join(__dirname, '..', id.replace(/^\.\.\//, '')))]; }
    catch (_e) { /* ignore */ }
  }

  const coreyPath = require.resolve(path.join(__dirname, '..', 'corey'));
  const clonePath = require.resolve(path.join(__dirname, '..', 'corey_clone'));
  const spideyPath = require.resolve(path.join(__dirname, '..', 'spidey'));
  const janePath = require.resolve(path.join(__dirname, '..', 'jane'));

  require.cache[coreyPath] = {
    id: coreyPath,
    filename: coreyPath,
    loaded: true,
    exports: {
      coreyRun: async () => ({
        authority: 'macro_context',
        status: 'ACTIVE',
        score: 0.72,
        confidence: 0.68,
        evidence: [{ type: 'fixture' }],
        symbol: 'EURUSD',
        timestamp: new Date(NOW).toISOString(),
      }),
    },
  };
  require.cache[clonePath] = {
    id: clonePath,
    filename: clonePath,
    loaded: true,
    exports: {
      coreyCloneRun: async () => ({
        status: 'PARTIAL',
        usableForDecision: false,
        sampleSize: 1,
        denominator: 9,
        analogues: [{ event: 'prior ECB', outcome: 'mixed' }],
        degradedReason: 'sample size below decision-grade threshold',
        confidenceBasis: 'fixture degraded historical read',
      }),
    },
  };
  require.cache[spideyPath] = {
    id: spideyPath,
    filename: spideyPath,
    loaded: true,
    exports: {
      spideyRun: async () => ({
        status: 'PARTIAL',
        authority: 'structure',
        symbol: 'EURUSD',
        degradedReason: 'lower-timeframe candle confirmation incomplete',
        timestamp: new Date(NOW).toISOString(),
      }),
    },
  };
  require.cache[janePath] = {
    id: janePath,
    filename: janePath,
    loaded: true,
    exports: {
      runJane: async () => ({
        actionState: 'MONITORING',
        tradeViability: 'PARTIAL',
        degradedReason: 'fixture monitoring state',
      }),
    },
  };

  return require(path.join(__dirname, '..', 'macro', 'searchMacro'));
}

function textSet() {
  const dhStandout = buildDarkHorseText({
    top10: [
      {
        symbol: 'EURUSD',
        direction: 'Bullish',
        bias: 'Bullish',
        score: 8.8,
        movePhase: 'early',
        summary: 'clean continuation structure',
        reasons: ['trend structure confirmed by fixture'],
        evidenceAnchors: {
          recentHigh: { priceText: '1.0925' },
          recentLow: { priceText: '1.0870' },
          invalidation: { priceText: '1.0840' },
        },
      },
    ],
    allCount: 33,
  }, 'DH-prototype-contract');
  const dhZero = buildDarkHorseText({ top10: [], allCount: 33 }, 'DH-zero-prototype-contract');
  const miMessages = buildMarketIntelMessages();
  const miText = miMessages.map(m => m.content || '').join('\n\n---MESSAGE---\n\n');
  return { dhStandout, dhZero, miMessages, miText };
}

function runDarkHorseContracts(dhStandout, dhZero) {
  console.log('\nT1 — Dark Horse prototype implementation contract:');
  const requiredOrder = [
    'NEW DARK HORSE SCAN',
    'MARKET MOOD',
    'STANDOUTS',
    'CURRENT ADVICE — AT RELEASE',
    'WHERE TO ACT',
    'DOLLAR RISK',
    'BUILDING',
    'CHART REFERENCE',
    'SOURCE',
    'END',
  ];
  assertOrdered(dhStandout, requiredOrder, 'Dark Horse standout');
  assertOrdered(dhZero, [
    'NEW DARK HORSE SCAN',
    'MARKET MOOD',
    'CURRENT ADVICE — AT RELEASE',
    'BUILDING',
    'CHART REFERENCE',
    'SOURCE',
    'END',
  ], 'Dark Horse zero-standout');

  for (const label of ['ATLAS · DARK HORSE', 'MARKET MOOD', 'CURRENT ADVICE — AT RELEASE', 'BUILDING', 'CHART REFERENCE']) {
    check(hasBoxDrawnHeading(dhStandout, label), 'Dark Horse section heading is box-drawn: ' + label);
  }

  check(/\bMARKET MOOD\b/i.test(dhStandout), 'Dark Horse has Market Mood block');
  check(/\bSTANDOUTS\b/i.test(dhStandout), 'Dark Horse has Standouts block');
  check(/\bBUILDING\b/i.test(dhStandout) && /\bBUILDING\b/i.test(dhZero), 'Dark Horse Building block is always present');
  check(/\bCHART REFERENCE\b/i.test(dhStandout) && /\bCHART REFERENCE\b/i.test(dhZero), 'Dark Horse Chart Reference block is always present');

  const cardFields = [
    /\bSymbol:\s*EURUSD\b/i,
    /\bDirection:\s*(Long|Short|Bullish|Bearish)\b/i,
    /\bScore:\s*\d/i,
    /\bMove phase:\s*\w+/i,
    /\bEntry \/ Watch Zone\b/i,
    /\bEntry Validation\b/i,
    /\bStop|Invalidation\b/i,
    /\bRisk Cap\b/i,
    /\bCurrent Advice\b/i,
  ];
  for (const re of cardFields) {
    check(re.test(dhStandout), 'Dark Horse standout card carries required field ' + re);
  }

  const whereToAct = sectionSlice(dhStandout, 'WHERE TO ACT', ['DOLLAR RISK', 'WHAT THIS MEANS', 'BUILDING', 'SOURCE']);
  for (const zone of ['ENTRY:', 'WATCH:', 'CAUTION:', 'INVALIDATION:']) {
    check(whereToAct.includes(zone), 'Dark Horse WHERE TO ACT has four-zone field ' + zone);
  }
  check(/DOLLAR RISK \/ RISK CAP|DOLLAR RISK/i.test(dhStandout), 'Dark Horse has Dollar Risk sidebar');
  check(/CURRENT ADVICE — AT RELEASE/.test(dhStandout), 'Dark Horse has Current Advice — At Release block');
  check(!/\bTHE CALL\b|HIGH-IMPACT CALENDAR EVENTS|FULL BRIEF|Brief Pending|MARKET INTEL/i.test(dhStandout), 'Dark Horse has no banned Market Intel contamination');
}

function runMarketIntelContracts(miMessages, miText) {
  console.log('\nT2 — Market Intel prototype implementation contract:');
  check(miMessages.length === 7, 'Market Intel emits exactly 7 Discord messages', 'actual=' + miMessages.length);
  const sequence = [
    'NEW MARKET INTEL REPORT',
    'HIGH-IMPACT CALENDAR EVENTS',
    'MARKET IMPACT',
    'AFFECTED MARKETS',
    'FULL BRIEF',
    'SOURCE / DEGRADATION',
    'BRIEFING SUMMARY',
  ];
  assertOrdered(miText, sequence, 'Market Intel fixed message sequence');

  const calendarIdx = miText.indexOf('HIGH-IMPACT CALENDAR EVENTS');
  const impactIdx = miText.indexOf('MARKET IMPACT');
  check(calendarIdx !== -1 && impactIdx !== -1 && calendarIdx < impactIdx, 'Market Intel uses calendar-first layout');
  check(/(?:11:45|12:30)\s+(?:EUR|USD)\s+·\s+\[[^\]]+\]/.test(miText), 'Market Intel has event rows with time, currency, and event name');
  check(/Affected:\s+[^\n]+/.test(miText), 'Market Intel event rows include affected markets');
  check(/Forecast:\s*[^\n]+|Previous:\s*[^\n]+/.test(miText), 'Market Intel event rows include forecast/previous data when provided');
  check(/Full Brief:\s+(?:Brief Pending|\/market-intel\/brief\/[a-z0-9-]+)/i.test(miText), 'Market Intel Full Brief / Brief Pending logic is explicit');
  check(/\bMarket Impact\b/i.test(miText) && !/\bMechanism Chain\b/i.test(miText), 'Market Intel uses Market Impact wording');
  check(/\bSource\b/i.test(miText) && /\bDegradation\b/i.test(miText), 'Market Intel source/degradation wording is explicit');

  const trimmed = miText.trim();
  const briefingIdx = trimmed.lastIndexOf('BRIEFING SUMMARY');
  check(briefingIdx !== -1 && !/END OF MARKET INTEL REPORT|SOURCE NOTE|MARKET IMPACT/i.test(trimmed.slice(briefingIdx + 'BRIEFING SUMMARY'.length)), 'Market Intel hard-ends at Briefing Summary');
  check(!/NEW DARK HORSE SCAN|standouts?|pre-radar|WHERE TO ACT|DOLLAR RISK|CURRENT ADVICE — AT RELEASE/i.test(miText), 'Market Intel has no banned Dark Horse contamination');
}

async function runMacroContracts() {
  console.log('\nT3 — Macro command prototype implementation contract:');
  const { runMacroSearch } = loadMacroSearchWithEngineMocks();
  const result = await runMacroSearch('EURUSD macro', {
    refreshCalendar: false,
    now: NOW,
    snapshot: {
      health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView calendar' },
      events: [
        {
          title: 'ECB Rate Decision',
          currency: 'EUR',
          impact: 'high',
          eventType: 'rate_decision',
          scheduled_time: NOW + 3 * 60 * 60 * 1000,
          affectedMarkets: ['EURUSD', 'DXY', 'GER40'],
        },
      ],
    },
  });
  const text = result.content;
  const firstKnownSection = [
    ['THE CALL', text.indexOf('THE CALL')],
    ['JANE STATE', text.indexOf('JANE STATE')],
    ['MARKET CONTEXT', text.indexOf('MARKET CONTEXT')],
    ['STRUCTURE STATUS', text.indexOf('STRUCTURE STATUS')],
  ].filter(([, idx]) => idx !== -1).sort((a, b) => a[1] - b[1])[0];
  check(firstKnownSection && firstKnownSection[0] === 'THE CALL', 'Macro command puts THE CALL first', firstKnownSection && firstKnownSection.join('@'));

  assertOrdered(text, [
    'THE CALL',
    'MARKET CONTEXT',
    'BEFORE',
    'DURING',
    'AFTER',
    'COREY CLONE',
    'STRUCTURE',
    'MARKET IMPACT',
    'SOURCE / DEGRADATION',
    'VALIDITY',
  ], 'Macro command locked section order');

  check(/\bBEFORE\b[\s\S]*\bDURING\b[\s\S]*\bAFTER\b/i.test(text), 'Macro command has BEFORE / DURING / AFTER structure');
  check(/Corey Clone:[^\n]*(PARTIAL|BLOCKED)[\s\S]{0,240}not decision-grade/i.test(text), 'Macro command gates Corey Clone historical claims when not decision-grade');
  check(/Spidey[\s\S]{0,120}PARTIAL[\s\S]{0,180}(degraded|incomplete|wait for confirmed structure)/i.test(text), 'Macro command has Spidey partial degradation wording');
  check(/Source:\s*[^\n]+/i.test(text) && /Degradation:\s*[^\n]+/i.test(text), 'Macro command has explicit source/degradation fields');
  check(/VALIDITY/i.test(text) && text.lastIndexOf('VALIDITY') > text.lastIndexOf('SOURCE / DEGRADATION'), 'Macro command ends with Validity last');
  check(!/NEW DARK HORSE SCAN|DOLLAR RISK|HIGH-IMPACT CALENDAR EVENTS|FULL BRIEF|Brief Pending/i.test(text), 'Macro command has no Dark Horse / Market Intel filler');
  return text;
}

function runGlobalContaminationContracts(outputs) {
  console.log('\nT4 — Global contamination contract:');
  const all = outputs.join('\n\n---OUTPUT---\n\n');
  check(!/(^|\n)\s*(DXY|VIX)\b/.test(all), 'No user-facing line leads with raw DXY / VIX');
  check(!/\bBOS\b|\bCHoCH\b/i.test(all), 'No BOS / CHoCH leaks into user-facing text');
  check(!/https?:\/\/(?:example\.com|localhost|127\.0\.0\.1|notion\.so|cursor\.com\/agents)|View in Notion|Open workspace/i.test(all), 'No dead/private links surface');
  check(!/\bpromotion_trigger\b/i.test(all), 'No promotion_trigger leaks');
  check(!/\b(?:foh_|surface=|webhook|Puppeteer|Render MCP|MCP workspace|sourceStatus|usableForDecision|raw packet)\b/i.test(all), 'No internal infrastructure terms leak');

  const monitoringSlices = all.split(/(?=Jane state: MONITORING|Current read: MONITORING)/i).slice(1);
  const monitoringHasAuthority = monitoringSlices.some(s => /\b(?:entry authorised|authorized|trade confirmed|trade permitted|buy now|sell now|enter now|full size)\b/i.test(s.slice(0, 800)));
  check(!monitoringHasAuthority, 'No execution authority when Jane is MONITORING');

  const notDecisionGradeSlices = all.split(/not decision-grade/i).slice(1);
  const hasUnsupportedHistoricalClaim = notDecisionGradeSlices.some(s => /\b(?:historical analogue confirms|historical pattern confirms|decision-grade historical analogue evidence is available)\b/i.test(s.slice(0, 500)));
  check(!hasUnsupportedHistoricalClaim, 'No historical claims when Corey Clone is not decision-grade');
  check(!/\b(?:probability|odds|chance|win rate)\s*[:=]?\s*\d{1,3}%|\b\d{1,3}%\s+(?:probability|odds|chance|win rate|likely)\b/i.test(all), 'No fabricated probabilities surface');
}

async function main() {
  const { dhStandout, dhZero, miMessages, miText } = textSet();
  runDarkHorseContracts(dhStandout, dhZero);
  runMarketIntelContracts(miMessages, miText);
  const macroText = await runMacroContracts();
  runGlobalContaminationContracts([dhStandout, dhZero, miText, macroText]);

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) {
    console.error('[PROTOTYPE-IMPLEMENTATION-CONTRACTS] FAIL');
    failures.forEach((f, idx) => console.error('  ' + (idx + 1) + '. ' + f));
    process.exit(1);
  }
  console.log('[PROTOTYPE-IMPLEMENTATION-CONTRACTS] PASS');
}

main().catch(err => {
  console.error('[PROTOTYPE-IMPLEMENTATION-CONTRACTS] ERROR ' + err.message);
  if (err && err.stack) console.error(err.stack);
  process.exit(1);
});
