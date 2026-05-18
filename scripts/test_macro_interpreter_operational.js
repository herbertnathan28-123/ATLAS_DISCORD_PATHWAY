#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { interpretCalendarEvents, logMacroIntelligencePacket } = require('../macro/interpretCalendarEvents');
const { buildMarketIntelPacket } = require('../foh/buildMarketIntelPacket');
const miViewModel = require('../foh/adapters/marketIntelViewModel');
const miShell = require('../renderers/foh/marketIntelV3Shell');

const now = Date.UTC(2026, 4, 17, 13, 10, 0);

function event(i, title, currency, impact, hoursOut) {
  return {
    id: 'ev-' + i,
    title,
    currency,
    impact,
    scheduled_time: now + hoursOut * 60 * 60 * 1000,
    source: 'tradingview',
  };
}

const events = [
  event(1, 'US CPI', 'USD', 'high', 2),
  event(2, 'Fed Chair Powell Speech', 'USD', 'high', 3),
  event(3, 'AUD Consumer Confidence', 'AUD', 'medium', 9),
  event(4, 'RBA Governor Bullock Speech', 'AUD', 'medium', 10),
  event(5, 'Japan GDP', 'JPY', 'high', 14),
  event(6, 'UK CPI', 'GBP', 'high', 26),
  event(7, 'ECB Lagarde Press Conference', 'EUR', 'high', 31),
];
for (let i = 8; i <= 86; i++) {
  const ccys = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
  events.push(event(i, 'Scheduled economic release ' + i, ccys[i % ccys.length], i % 3 === 0 ? 'medium' : 'low', (i % 70) + 1));
}

const packet = interpretCalendarEvents({
  now,
  events,
  health: { available: true, source_used: 'tradingview', calendar_mode: 'LIVE', eventCount: events.length, last_updated: new Date(now).toISOString() },
  coreyState: {
    status: 'ok',
    dxy: { bias: 'Bullish', price: 28.4 },
    vix: { level: 'Elevated', price: 24.5 },
    yield: { regime: 'Flat', spread: 0.05 },
    lastUpdated: new Date(now).toISOString(),
  },
  fmpData: { enabled: true, available: true, source: 'fmp' },
  eodhdData: { enabled: true, available: true, source: 'eodhd' },
});

logMacroIntelligencePacket(packet);

assert.strictEqual(packet.calendarEventsRawCount, 86, 'raw calendar count preserved');
assert(packet.todayAnnouncements.length > 0, 'today announcements are populated');
assert(packet.next72Hours.length > 0, 'next 72h overview is populated');
assert(packet.eventClusters.length > 0, 'clusters are built');
assert(packet.primaryEventFocus && packet.primaryEventFocus.title !== 'No major scheduled catalyst', 'primary focus selected');
assert(packet.affectedMarketsExpanded.length > 0, 'affected market expansion exists');
assert(packet.affectedMarketsExpanded.every(m => m.symbol && m.transmissionMechanism && m.confirmationCondition && m.invalidationCondition), 'affected markets are not naked symbol lists');
assert(packet.macroTransmissionMap.length >= 2, 'transmission paths built');
assert(['ACTIVE', 'ELEVATED', 'EXTREME'].includes(packet.riskState.label), 'risk state reflects dense event day');
assert(!/CPI \+ ECB cluster/.test(JSON.stringify(packet)), 'no stale prototype event text leaked');

const engine = {
  kind: 'daily',
  macroIntelligencePacket: packet,
  eventClusters: packet.eventClusters,
  affectedMarketsExpanded: packet.affectedMarketsExpanded,
  affectedMarkets: { symbols: packet.affectedMarketsExpanded.map(m => m.symbol) },
  primaryEventFocus: packet.primaryEventFocus,
  next24To72Hours: packet.next72Hours,
  briefingSummary: packet.dominantMacroTheme + '. Risk state: ' + packet.riskState.label + '.',
  whyThisMatters: packet.primaryEventFocus.whyPrimary,
  marketImpact: packet.macroTransmissionMap[0].mechanism,
  currentRisk: packet.riskState.whyThisRating,
  sourceNote: { source: packet.sourceUsed.join('+'), mode: 'LIVE', probabilityBasis: packet.confidenceBasis },
};
const fohPacket = buildMarketIntelPacket({ engine });
const vm = miViewModel.toViewModel(fohPacket);
const discord = miShell.buildDiscordTextSummary(vm, { surface: 'market_intel', maxDiscordChunkChars: 100000 });

assert(/Source:/.test(vm.SOURCE_PROVENANCE), 'source provenance rendered');
assert(/HOW:/.test(vm.AFFECTED_MARKETS_EXPANDED), 'affected market explanations rendered');
assert(!/affected_symbols=n\/a/.test(discord), 'no naked n/a affected-symbol output');
assert(!/next_major_event=none/.test(discord), 'no next_major_event=none output');

console.log('[MACRO-INTERPRETER-OPERATIONAL-QA] PASS');
