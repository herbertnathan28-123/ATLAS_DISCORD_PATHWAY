#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const fs = require('fs');
const { buildDailyBulletinPayload } = require(path.join(__dirname, '..', 'coreyMarketIntel'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

const now = Date.UTC(2026, 4, 17, 6, 0, 0);
const snapshot = {
  health: {
    available: true,
    calendar_mode: 'LIVE',
    source_used: 'TradingView calendar',
    eventCount: 86,
  },
  events: Array.from({ length: 10 }).map((_, idx) => ({
    title: 'Low impact calendar row ' + (idx + 1),
    currency: idx % 2 ? 'USD' : 'EUR',
    impact: 'low',
    scheduled_time: now + (idx + 1) * 60 * 60 * 1000,
  })),
};

const macroPacket = {
  sourceUsed: ['TradingView calendar', 'corey_live'],
  dataFreshness: { calendar: { mode: 'LIVE', source: 'TradingView calendar', available: true } },
  calendarEventsRawCount: 86,
  todayAnnouncements: [],
  next72Hours: [
    { title: 'GDP Growth Rate QoQ Prel', currency: 'EUR', timeUTC: '08:00', scheduledTimeUTC: '2026-05-18T08:00:00.000Z', severity: 'HIGH', importanceScore: 82, affectedMarkets: ['EURUSD', 'DXY', 'GER40'] },
    { title: 'FOMC Member Speech', currency: 'USD', timeUTC: '14:00', scheduledTimeUTC: '2026-05-18T14:00:00.000Z', severity: 'ELEV', importanceScore: 68, affectedMarkets: ['DXY', 'EURUSD', 'US500'] },
  ],
  eventClusters: [
    { session: 'London', currency: 'EUR', clusterImpact: 'HIGH', affectedMarkets: ['EURUSD', 'DXY'], events: [{ title: 'GDP Growth Rate QoQ Prel', currency: 'EUR', timeUTC: '08:00', severity: 'HIGH', affectedMarkets: ['EURUSD', 'DXY'] }] },
  ],
  primaryEventFocus: { title: 'GDP Growth Rate QoQ Prel', currency: 'EUR', timeUTC: '08:00', expectedImpact: 'HIGH', affectedMarkets: ['EURUSD', 'DXY', 'GER40'], volatilityWindow: '08:00 UTC release window', whyPrimary: 'Highest ranked next-72h event.', confidenceBasis: 'EURUSD and yields must confirm.' },
  riskState: { label: 'ACTIVE', scoreOutOf5: 3.1, whyThisRating: 'next72 ranked events available while today is empty' },
  affectedMarketsExpanded: [
    { symbol: 'EURUSD', transmissionMechanism: 'Growth path reprices EUR leg.', confirmationCondition: 'EURUSD close confirms.' },
    { symbol: 'DXY', transmissionMechanism: 'Dollar leg confirms whether EUR strength is broad or isolated.', confirmationCondition: 'US Dollar Strength (DXY) breaks the pre-event range.' },
  ],
  macroTransmissionMap: [
    { driver: 'GDP Growth Rate QoQ Prel', mechanism: 'Growth surprise reprices rate-path expectations.', firstOrderEffect: 'EUR rate expectations move first.', secondOrderEffect: 'Dollar pairs and EU indices follow after confirmation.', affectedSymbols: ['EURUSD', 'DXY', 'GER40'], whatStrengthensThis: 'EURUSD and yields confirm.', whatWeakensThis: 'US Dollar Strength (DXY) fades the move.' },
  ],
  sessionRisk: { namedWindows: ['London 08:00-09:00 UTC', 'New York 14:00-15:00 UTC'] },
};

console.log('\nT1 — daily_bulletin builds the approved 3-message Daily Brief model:');
const payload = buildDailyBulletinPayload(snapshot, { level: 'low' }, now, { macroIntelligencePacket: macroPacket });
const messages = payload.dailyRoadmapMessages || [];
if (messages.length === 3) ok('daily roadmap returns exactly 3 messages'); else fail('expected 3 daily roadmap messages', messages.length);
if (payload.counts.highImpactTodayCount === 0 && payload.counts.next24hCount === 10 && payload.counts.next72hCount === 2) ok('counts prove next24/next72 path is populated while high-impact today is zero'); else fail('unexpected counts', JSON.stringify(payload.counts));

const msg1 = messages[0] && messages[0].content || '';
const msg2 = messages[1] && messages[1].content || '';
const msg3 = messages[2] && messages[2].content || '';
const all = [msg1, msg2, msg3].join('\n---\n');

console.log('\nT2 — message 1 leads with THE CALL and ranked calendar:');
if (msg1.startsWith('🔥 **THE CALL**')) ok('message 1 starts with THE CALL'); else fail('message 1 does not lead with THE CALL');
if (/TODAY'S RANKED EVENT CALENDAR/.test(msg1) && /TIME \| CCY \| IMPACT \| EVENT \| AFFECTED MARKETS \| FULL BRIEF/.test(msg1)) ok('message 1 includes required release table header'); else fail('message 1 missing ranked table header');
if (/GDP Growth Rate QoQ Prel/.test(msg1) && /FOMC Member Speech/.test(msg1)) ok('ranked calendar includes next72 events despite high-impact today = 0'); else fail('ranked calendar missing next72 rows');
if (/Brief Pending/.test(msg1)) ok('Full Brief column shows Brief Pending fallback'); else fail('message 1 missing Brief Pending');
if (/Source note: TradingView LIVE/.test(msg1)) ok('message 1 source note shows TradingView LIVE'); else fail('message 1 missing TradingView LIVE source note');

console.log('\nT3 — messages 2/3 include approved blocks:');
if (/MARKET IMPACT/.test(msg2) && /Market Impact card 1/.test(msg2)) ok('message 2 includes Market Impact cards'); else fail('message 2 missing Market Impact cards');
if (/AFFECTED MARKETS/.test(msg2) && /CONFIRMATION \/ DEGRADATION/.test(msg2)) ok('message 2 includes affected markets and confirmation/degradation'); else fail('message 2 missing required blocks');
if (/FORWARD PLANNING/.test(msg3) && /FULL BRIEF LINKS \/ BRIEF PENDING/.test(msg3)) ok('message 3 includes forward planning and full brief block'); else fail('message 3 missing required blocks');

console.log('\nT4 — user-facing terminology is plain-English first:');
if (/US Dollar Strength \(DXY\)/.test(all)) ok('US Dollar Strength (DXY) appears'); else fail('US Dollar Strength (DXY) missing');
if (!/US Dollar Index \(DXY\)|CBOE Volatility Index \(VIX\)|DXY \(US Dollar Strength\)/.test(all)) ok('no stale DXY-first or index-first wording'); else fail('stale DXY/VIX terminology leaked');

console.log('\nT5 — live scheduler is wired to the 3-message renderer:');
const coreyMI = fs.readFileSync(path.join(__dirname, '..', 'coreyMarketIntel.js'), 'utf8');
if (/daily_roadmap_renderer=used model=3_message/.test(coreyMI)) ok('scheduler logs the new daily roadmap renderer'); else fail('scheduler missing daily roadmap renderer log');
if (/for \(const msg of roadmapMessages\)/.test(coreyMI) && /dispatch\('daily_brief'/.test(coreyMI)) ok('scheduler dispatches each Daily Brief message'); else fail('scheduler does not dispatch daily_brief loop');
if (!/dispatch\('daily', \{ content: bulletin\.content/.test(coreyMI)) ok('scheduler no longer sends the compressed legacy daily payload'); else fail('scheduler still sends compressed legacy daily payload');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[MARKET-INTEL-DAILY-ROADMAP] FAIL'); process.exit(1); }
console.log('[MARKET-INTEL-DAILY-ROADMAP] PASS');
