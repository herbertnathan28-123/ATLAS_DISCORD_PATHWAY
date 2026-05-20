#!/usr/bin/env node
'use strict';

const assert = require('assert');

process.env.ATLAS_FULL_BRIEF_BASE_URL = 'https://atlas-fx-dashboard.onrender.com';

const { buildDailyBulletinPayload } = require('../coreyMarketIntel');
const { buildMarketIntelPacket } = require('../foh/buildMarketIntelPacket');
const miViewModel = require('../foh/adapters/marketIntelViewModel');

const now = Date.UTC(2026, 4, 20, 0, 0, 0);
const macroPacket = {
  generatedAtUTC: '2026-05-20T00:00:00.000Z',
  sourceUsed: ['TradingView calendar', 'corey_live'],
  dataFreshness: { calendar: { mode: 'LIVE', source: 'TradingView calendar', available: true } },
  calendarEventsRawCount: 2,
  next72Hours: [
    {
      title: 'Inflation Rate YoY',
      currency: 'CAD',
      country: 'Canada',
      timeUTC: '12:30',
      scheduledTimeUTC: '2026-05-20T12:30:00.000Z',
      severity: 'HIGH',
      importanceScore: 95,
      forecast: '2.2%',
      previous: '2.3%',
      affectedMarkets: ['USDCAD', 'DXY']
    },
    {
      title: 'Unemployment Rate',
      currency: 'GBP',
      country: 'United Kingdom',
      timeUTC: '06:00',
      scheduledTimeUTC: '2026-05-20T06:00:00.000Z',
      severity: 'HIGH',
      importanceScore: 88,
      affectedMarkets: ['GBPUSD', 'DXY']
    }
  ],
  todayAnnouncements: [],
  eventClusters: [],
  primaryEventFocus: {
    title: 'Inflation Rate YoY',
    currency: 'CAD',
    timeUTC: '12:30',
    scheduledTimeUTC: '2026-05-20T12:30:00.000Z',
    expectedImpact: 'HIGH',
    forecast: '2.2%',
    previous: '2.3%',
    affectedMarkets: ['USDCAD', 'DXY'],
    volatilityWindow: '12:30 UTC release window'
  },
  riskState: { label: 'ACTIVE', scoreOutOf5: 4, whyThisRating: 'ranked inflation event in scope' },
  affectedMarketsExpanded: [],
  macroTransmissionMap: []
};

const snapshot = {
  health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView calendar', eventCount: 2 },
  events: []
};

const daily = buildDailyBulletinPayload(snapshot, { level: 'low' }, now, { macroIntelligencePacket: macroPacket });
const text = daily.dailyRoadmapMessages.map(m => m.content).join('\n');

assert.match(text, /2026-05-20-1230-cad-inflation-rate-yoy-canada/, 'deterministic event ID includes date/time/currency/title/country');
assert.match(text, /12:30 UTC \/ 20:30 AWST · CAD · HIGH · \[Inflation Rate YoY\]\(https:\/\/atlas-fx-dashboard\.onrender\.com\/brief\?eventId=2026-05-20-1230-cad-inflation-rate-yoy-canada\)/, 'complete event receives generated dashboard Full Brief link');
assert.match(text, /06:00 UTC \/ 14:00 AWST · GBP · HIGH · \[Unemployment Rate\]/, 'blocked event still renders mobile event bullet with UTC/AWST');
assert.match(text, /Full Brief blocked: missing forecast\/previous/, 'blocked event states exact missing fields');
assert.doesNotMatch(text, /FULL BRIEF \/ BRIEF PENDING|Full Brief: Brief Pending|— Brief Pending/, 'generic Brief Pending filler must not render');
assert.doesNotMatch(text, /Brief Pending/, 'Market Intel output must not render generic Brief Pending filler');
assert.doesNotMatch(text, /\|---|\| CCY \| IMPACT|TIME \|/, 'Discord output must avoid pipe tables');

const packet = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH' }, macroIntelligencePacket: macroPacket, eventClusters: [] } });
assert(packet.rankedEventCalendar[0].eventId, 'FOH packet ranked event includes eventId');
assert(packet.rankedEventCalendar[0].fullBriefProvenance, 'FOH packet ranked event includes Full Brief provenance');
assert.deepStrictEqual(packet.rankedEventCalendar[0].fullBriefProvenance.missingFields, [], 'complete event has no missing Full Brief fields');
assert(packet.rankedEventCalendar.some(r => /missing forecast\/previous/.test(r.fullBriefBlockedReason || '')), 'blocked packet row carries specific missing-field reason');

const anchors = miViewModel.toViewModel(packet);
assert.doesNotMatch(anchors.RANKED_EVENT_CALENDAR, /\|---|\| CCY \| IMPACT|Brief Pending/, 'view-model ranked calendar avoids tables and generic pending');
assert.match(anchors.RANKED_EVENT_CALENDAR, /Full Brief: https:\/\/atlas-fx-dashboard\.onrender\.com\/brief\?eventId=/, 'view-model carries clickable Full Brief link');
assert.match(anchors.RANKED_EVENT_CALENDAR, /Full Brief blocked: missing forecast\/previous/, 'view-model carries specific blocked reason');

console.log('[MARKET-INTEL-FULL-BRIEF-LINKS] PASS');
