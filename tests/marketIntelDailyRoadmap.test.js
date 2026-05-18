#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const fs = require('fs');
const { buildDailyBulletinPayload } = require(path.join(__dirname, '..', 'coreyMarketIntel'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  OK ' + label); }
function fail(label, err) { failed++; console.error('  FAIL ' + label + (err ? ' :: ' + err : '')); }
function check(condition, label, err) { condition ? ok(label) : fail(label, err); }

const now = Date.UTC(2026, 4, 18, 6, 0, 0);
const snapshot = {
  health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView calendar', eventCount: 86 },
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
    { title: 'ECB Rate Decision', currency: 'EUR', timeUTC: '11:45', scheduledTimeUTC: '2026-05-18T11:45:00.000Z', severity: 'HIGH', importanceScore: 95, affectedMarkets: ['EURUSD', 'DXY', 'GER40'] },
    { title: 'GDP Growth Rate QoQ Prel', currency: 'EUR', timeUTC: '08:00', scheduledTimeUTC: '2026-05-18T08:00:00.000Z', severity: 'HIGH', importanceScore: 82, affectedMarkets: ['EURUSD', 'DXY', 'GER40'] },
    { title: 'FOMC Member Speech', currency: 'USD', timeUTC: '14:00', scheduledTimeUTC: '2026-05-18T14:00:00.000Z', severity: 'ELEV', importanceScore: 68, affectedMarkets: ['DXY', 'EURUSD', 'US500'] },
  ],
  eventClusters: [
    { session: 'London', currency: 'EUR', clusterImpact: 'HIGH', affectedMarkets: ['EURUSD', 'DXY'], events: [{ title: 'GDP Growth Rate QoQ Prel', currency: 'EUR', timeUTC: '08:00', severity: 'HIGH', affectedMarkets: ['EURUSD', 'DXY'] }] },
  ],
  primaryEventFocus: { title: 'GDP Growth Rate QoQ Prel', currency: 'EUR', timeUTC: '08:00', expectedImpact: 'HIGH', affectedMarkets: ['EURUSD', 'DXY', 'GER40'], volatilityWindow: '08:00 UTC release window', whyPrimary: 'Highest ranked next-72h event.', confidenceBasis: 'EURUSD and yields must confirm.' },
  riskState: { label: 'ACTIVE', scoreOutOf5: 3.1, whyThisRating: 'next72 ranked events available while today is empty' },
  affectedMarketsExpanded: [
    { symbol: 'EURUSD', transmissionMechanism: 'Growth path reprices EUR leg.', confirmationCondition: 'EURUSD close confirms.', invalidationCondition: 'first move fades back inside the pre-release range.' },
    { symbol: 'DXY', transmissionMechanism: 'Dollar leg confirms whether EUR strength is broad or isolated.', confirmationCondition: 'US Dollar Strength (DXY) breaks the pre-event range.' },
  ],
  macroTransmissionMap: [
    { driver: 'GDP Growth Rate QoQ Prel', mechanism: 'Growth surprise reprices rate-path expectations.', firstOrderEffect: 'EUR rate expectations move first.', secondOrderEffect: 'Dollar pairs and EU indices follow after confirmation.', affectedSymbols: ['EURUSD', 'DXY', 'GER40'], whatStrengthensThis: 'EURUSD and yields confirm.', whatWeakensThis: 'US Dollar Strength (DXY) fades the move.' },
  ],
  sessionRisk: { namedWindows: ['London 08:00-09:00 UTC', 'New York 14:00-15:00 UTC'] },
};

console.log('\nT1 - Issue #144 daily Market Intel builds a control-surface report:');
const payload = buildDailyBulletinPayload(snapshot, { level: 'low' }, now, { macroIntelligencePacket: macroPacket });
const messages = payload.dailyRoadmapMessages || [];
check(messages.length === 1, 'daily roadmap returns one compact control-surface message', messages.length);
check(payload.imagePayload && payload.fohPacket, 'daily bulletin carries imagePayload + fohPacket for primary renderer path');
check(payload.counts.highImpactTodayCount === 0 && payload.counts.next24hCount === 10 && payload.counts.next72hCount === 3, 'counts prove next24/next72 path is populated');

const msg = messages[0] && messages[0].content || '';

console.log('\nT2 - hard report boundaries, report ID, and part count are visible:');
check(/^.{10,}\n.*NEW MARKET INTEL REPORT/.test(msg), 'message opens with hard start boundary');
check(/Report ID: MI-/.test(msg), 'message contains MI report ID');
check(/Part: 1\/1/.test(msg), 'message contains part count');
check(/END OF MARKET INTEL REPORT/.test(msg), 'message contains hard end boundary');
check(/Next scheduled refresh: \d\d:\d\d UTC/.test(msg), 'message contains next scheduled refresh');

console.log('\nT3 - pending exports no longer dominate the first screen:');
check(/Controls:\n.*Full Calendar: Available\n.*Terms: Available\n.*Full Briefs: Brief Pending\n\nExports:\nPNG\/PDF pending this cycle\./.test(msg), 'controls show calendar/terms first and exports pending separately');
check(!/^.*PNG: Brief Pending/m.test(msg) && !/^.*PDF: Brief Pending/m.test(msg), 'message does not lead with broken PNG/PDF Brief Pending controls');
check(msg.indexOf('Controls:') < msg.indexOf('THE CALL'), 'controls appear before THE CALL without broken export lead');

console.log('\nT4 - required control-surface sections are present and compressed:');
for (const label of ['THE CALL', 'HIGH-IMPACT CALENDAR EVENTS', 'RISK STATE', 'MARKET IMPACT SUMMARY', 'AFFECTED MARKETS', 'FULL BRIEF / BRIEF PENDING']) {
  check(msg.includes(label), 'message includes ' + label);
}
check(/Primary: [^\n]+/.test(msg) && /Secondary:/.test(msg) && /More: Full Brief/.test(msg), 'affected markets are compressed into primary/secondary/more rows');
check(!/confirmation: .*\n.*confirmation:/s.test(msg), 'message does not dump long affected-market paragraphs');

console.log('\nT5 - user-facing terminology is plain-English first:');
check(/US Dollar Strength \(DXY\)/.test(msg), 'US Dollar Strength (DXY) appears');
check(!/US Dollar Index \(DXY\)|CBOE Volatility Index \(VIX\)|DXY \(US Dollar Strength\)/.test(msg), 'no stale DXY/VIX terminology leaked');
check(!/(?<!\()DXY(?!\))/.test(msg), 'no bare DXY token leaks into daily roadmap surface');
check(!/(?<!\()VIX(?!\))/.test(msg), 'no bare VIX token leaks into daily roadmap surface');

console.log('\nT6 - live scheduler is wired to the primary renderer payload:');
const coreyMI = fs.readFileSync(path.join(__dirname, '..', 'coreyMarketIntel.js'), 'utf8');
check(/daily_roadmap_renderer=used model=foh_primary_control_surface/.test(coreyMI), 'scheduler logs primary control-surface renderer model');
check(/imagePayload: bulletin\.imagePayload/.test(coreyMI) && /fohPacket: bulletin\.fohPacket/.test(coreyMI), 'scheduler passes daily imagePayload + fohPacket into dispatch');
check(/controlled_degraded_summary/.test(coreyMI), 'dispatch has controlled degraded fallback instead of silent legacy fallthrough');
check(!/fallback=expanded_text_only/.test(coreyMI), 'old expanded-text-only fallback label removed');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[MARKET-INTEL-DAILY-ROADMAP] FAIL'); process.exit(1); }
console.log('[MARKET-INTEL-DAILY-ROADMAP] PASS');
