#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const path = require('path');
const { buildDailyBulletinPayload } = require(path.join(__dirname, '..', 'coreyMarketIntel'));
const { buildDarkHorseDegradedSummary } = require(path.join(__dirname, '..', 'darkHorseEngine'));
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const { buildDarkHorsePacket } = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const { buildDiscordTextSummary } = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell'));

const now = Date.UTC(2026, 4, 18, 6, 0, 0);
const macroPacket = {
  generatedAtUTC: '2026-05-18 06:00 UTC',
  sourceUsed: ['TradingView calendar', 'corey_live'],
  dataFreshness: { calendar: { mode: 'LIVE', source: 'TradingView calendar', available: true } },
  next72Hours: [
    { title: 'ECB Rate Decision', currency: 'EUR', timeUTC: '11:45', severity: 'HIGH', importanceScore: 95, affectedMarkets: ['EURUSD', 'DXY'] },
  ],
  eventClusters: [],
  primaryEventFocus: { title: 'ECB Rate Decision', currency: 'EUR', timeUTC: '11:45', affectedMarkets: ['EURUSD', 'DXY'], volatilityWindow: '11:45 UTC release window', whyPrimary: 'Tier-1 central-bank event.' },
  riskState: { label: 'ACTIVE', scoreOutOf5: 3, whyThisRating: 'DXY and VIX must confirm after release.' },
  affectedMarketsExpanded: [
    { symbol: 'EURUSD', transmissionMechanism: 'EUR reprices through rate expectations.' },
    { symbol: 'DXY', transmissionMechanism: 'Dollar leg confirms breadth.' },
  ],
  macroTransmissionMap: [
    { driver: 'ECB Rate Decision', mechanism: 'Rate-path repricing.', affectedSymbols: ['EURUSD', 'DXY'], whatStrengthensThis: 'EURUSD and DXY confirm.', whatWeakensThis: 'DXY fades.' },
  ],
};

const miPayload = buildDailyBulletinPayload(
  { health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView calendar' }, events: [] },
  { level: 'low' },
  now,
  { macroIntelligencePacket: macroPacket }
);
const miText = miPayload.dailyRoadmapMessages[0].content;
assert(miText.startsWith('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🟨 NEW MARKET INTEL REPORT'), 'Market Intel has hard start boundary');
assert(/END OF MARKET INTEL REPORT/.test(miText), 'Market Intel has hard end boundary');
assert(/Part: 1\/1/.test(miText), 'Market Intel shows part count');
assert(!/^.*PNG: Brief Pending/m.test(miText), 'PNG/PDF pending does not dominate first screen');
assert(/US Dollar Strength \(DXY\)/.test(miText), 'DXY is plain-English first');
assert(!/(?<!\()DXY(?!\))/.test(miText), 'No bare DXY leak');

const miPacket = buildMarketIntelPacket({
  engine: { kind: 'daily', macroIntelligencePacket: macroPacket, eventClusters: [], affectedMarketsExpanded: macroPacket.affectedMarketsExpanded },
  reportId: 'MI-proof',
  now,
});
const miRenderedText = buildDiscordTextSummary(miViewModel.toViewModel(miPacket), { reportId: 'MI-proof', maxDiscordChunkChars: 4000 });
assert(/Report ID: MI-proof/.test(miRenderedText), 'Rendered MI text carries report ID');
assert(/Controls:/.test(miRenderedText), 'Rendered MI text carries controls');
assert(/END OF MARKET INTEL REPORT/.test(miRenderedText), 'Rendered MI text carries end boundary');
assert(/ROADMAP INTEL — NEXT 24–72H SEQUENCE/.test(miRenderedText), 'Rendered MI text carries 24-72h roadmap sequence');
assert(/SUPPORT \/ PRESSURE GUIDE/.test(miRenderedText), 'Rendered MI text carries support/pressure affected-market guidance');

const dhRanking = {
  top10: [
    { symbol: 'EURUSD', direction: 'Bullish', score: 8.7, entryZone: '1.0920-1.0940', invalidation: 'Below 1.0880', dollarRiskLabel: '$100 max' },
  ],
  allCount: 20,
};
const dhDegraded = buildDarkHorseDegradedSummary(dhRanking, { level: 'ELEVATED', reason: 'test volatility' }, 'foh_contract_validation_failed:WHAT_TO_DO_NOW', { reportId: 'DH-proof', now });
assert(dhDegraded.startsWith('⚠️ DARK HORSE RENDER DEGRADED'), 'Dark Horse degraded notice leads fallback');
assert(/Reason: foh_contract_validation_failed:WHAT_TO_DO_NOW/.test(dhDegraded), 'Dark Horse degraded notice includes exact reason');
assert(/CURRENT ADVICE \/ WHAT TO DO NOW/.test(dhDegraded), 'Dark Horse compact summary includes current advice');
assert(/entry\/watch 1\.0920-1\.0940/.test(dhDegraded), 'Dark Horse compact summary includes entry zone');
assert(/invalidation Below 1\.0880/.test(dhDegraded), 'Dark Horse compact summary includes stop/invalidation');
assert(/END OF DARK HORSE SCAN/.test(dhDegraded), 'Dark Horse compact summary has hard end boundary');

const dhPacket = buildDarkHorsePacket({ ranking: dhRanking, volatility: { level: 'ELEVATED' }, reportId: 'DH-rendered', now });
const dhRenderedText = buildDiscordTextSummary(dhViewModel.toViewModel(dhPacket), { reportId: 'DH-rendered', surface: 'dark_horse', maxDiscordChunkChars: 4000 });
assert(/NEW DARK HORSE SCAN/.test(dhRenderedText), 'Rendered DH text has hard start');
assert(/Report ID: DH-rendered/.test(dhRenderedText), 'Rendered DH text carries report ID');
assert(/LIFECYCLE SUMMARY/.test(dhRenderedText), 'Rendered DH text carries lifecycle summary');
assert(/WHERE TO ACT/.test(dhRenderedText), 'Rendered DH text carries where-to-act guidance');
assert(/DOLLAR RISK \/ RISK CAP/.test(dhRenderedText), 'Rendered DH text carries dollar risk guidance');
assert(/CURRENT ADVICE \/ WHAT TO DO NOW/.test(dhRenderedText), 'Rendered DH text carries current advice');
assert(/END OF DARK HORSE SCAN/.test(dhRenderedText), 'Rendered DH text has hard end');

console.log('[ISSUE-144-LIVE-OUTPUT-LOCKDOWN] PASS');
