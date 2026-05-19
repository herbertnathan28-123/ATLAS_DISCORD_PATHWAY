#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const fs = require('fs');
process.env.ATLAS_FULL_BRIEF_BASE_URL = 'https://atlas-fx-dashboard.onrender.com';
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
  generatedAtUTC: '2026-05-17T06:00:00.000Z',
  todayAnnouncements: [],
  next72Hours: [
    { title: 'ECB Rate Decision', currency: 'EUR', timeUTC: '11:45', scheduledTimeUTC: '2026-05-18T11:45:00.000Z', severity: 'HIGH', importanceScore: 95, forecast: '2.00%', previous: '2.25%', affectedMarkets: ['EURUSD', 'DXY', 'GER40'] },
    { title: 'GDP Growth Rate QoQ Prel', currency: 'EUR', timeUTC: '08:00', scheduledTimeUTC: '2026-05-18T08:00:00.000Z', severity: 'HIGH', importanceScore: 82, forecast: '0.3%', previous: '0.2%', affectedMarkets: ['EURUSD', 'DXY', 'GER40'] },
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

console.log('\nT1 — daily_bulletin builds the approved 3-message Daily Brief model:');
const payload = buildDailyBulletinPayload(snapshot, { level: 'low' }, now, { macroIntelligencePacket: macroPacket });
const messages = payload.dailyRoadmapMessages || [];
if (messages.length === 3) ok('daily roadmap returns exactly 3 messages'); else fail('expected 3 daily roadmap messages', messages.length);
if (payload.counts.highImpactTodayCount === 0 && payload.counts.next24hCount === 10 && payload.counts.next72hCount === 3) ok('counts prove next24/next72 path is populated while high-impact today is zero'); else fail('unexpected counts', JSON.stringify(payload.counts));

const msg1 = messages[0] && messages[0].content || '';
const msg2 = messages[1] && messages[1].content || '';
const msg3 = messages[2] && messages[2].content || '';
const all = [msg1, msg2, msg3].join('\n---\n');

// Box-header helper — boxes now wrap in a Discord ANSI code fence
// for section colour. The ANSI escapes ([...m) live between
// the fence and the box-drawing chars, so the regex tolerates a
// non-greedy chunk of fence + escape prefix before each ║ line.
function _boxRegex(label, escapedLabel) {
  const lit = escapedLabel || label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('```ansi\\n[^\\n]*╔═+╗[^\\n]*\\n[^\\n]*║\\s+' + lit + '\\s+║[^\\n]*\\n[^\\n]*╚═+╝[^\\n]*\\n```');
}

console.log('\nT2 — message 1 leads with boxed report heading + control strip:');
if (_boxRegex('📡 MARKET INTEL · DAILY ROADMAP').test(msg1) && msg1.startsWith('```ansi\n')) ok('message 1 opens with the ANSI-coloured boxed MARKET INTEL · DAILY ROADMAP report heading'); else fail('message 1 missing coloured boxed MARKET INTEL · DAILY ROADMAP heading');
const stripMatch = msg1.match(/🖼️ PNG: ([^\n]+)\n📄 PDF: ([^\n]+)\n📅 Full Calendar: ([^\n]+)\n📘 Terminology: ([^\n]+)\n🔗 Full Briefs: ([^\n]+)/);
if (stripMatch) ok('message 1 includes the five-line control strip (PNG / PDF / Full Calendar / Terminology / Full Briefs)'); else fail('message 1 missing the five-line control strip');
if (stripMatch && /Brief Pending/.test(stripMatch[1])) ok('PNG strip line declares Brief Pending until daily_brief carries the imagePayload'); else fail('PNG strip line not Brief Pending');
if (stripMatch && /Brief Pending|Not generated/.test(stripMatch[2])) ok('PDF strip line declares Brief Pending / Not generated honestly'); else fail('PDF strip line not Brief Pending / Not generated');
if (stripMatch && /Available/.test(stripMatch[3])) ok('Full Calendar strip line declares Available (TradingView feed is live)'); else fail('Full Calendar strip line not Available');
if (stripMatch && /Available/.test(stripMatch[4])) ok('Terminology strip line declares Available'); else fail('Terminology strip line not Available');
if (msg1.indexOf('📡 MARKET INTEL · DAILY ROADMAP') < msg1.indexOf('🖼️ PNG') && msg1.indexOf('🖼️ PNG') < msg1.indexOf('🔥 CURRENT MARKET READ')) ok('control strip sits between the report heading and CURRENT MARKET READ block'); else fail('control strip not positioned between report heading and CURRENT MARKET READ');

if (_boxRegex('🔥 CURRENT MARKET READ').test(msg1) && msg1.indexOf('🔥 CURRENT MARKET READ') < msg1.indexOf('HIGH-IMPACT CALENDAR EVENTS')) ok('message 1 includes coloured boxed 🔥 CURRENT MARKET READ header'); else fail('message 1 missing boxed CURRENT MARKET READ header');
if (_boxRegex('📅 HIGH-IMPACT CALENDAR EVENTS').test(msg1)) ok('message 1 includes coloured boxed HIGH-IMPACT CALENDAR EVENTS header (renamed from TODAY\'S RANKED EVENT CALENDAR)'); else fail('message 1 missing boxed HIGH-IMPACT CALENDAR EVENTS header');
if (_boxRegex('⚠️ RISK STATE').test(msg1)) ok('message 1 includes coloured boxed RISK STATE block'); else fail('message 1 missing boxed RISK STATE block');
// Importance-based header colour doctrine 2026-05-18 — Tier-1
// (ECB Rate Decision) in scope means CURRENT MARKET READ + CALENDAR headers
// must render red ([1;31m). The cyan top-of-report heading
// is unaffected because it tracks report identity, not impact.
const callBoxIdx = msg1.indexOf('🔥 CURRENT MARKET READ');
const calBoxIdx = msg1.indexOf('📅 HIGH-IMPACT CALENDAR EVENTS');
const callPrefix = msg1.slice(Math.max(0, callBoxIdx - 30), callBoxIdx);
const calPrefix = msg1.slice(Math.max(0, calBoxIdx - 30), calBoxIdx);
if (/\[1;31m/.test(callPrefix)) ok('CURRENT MARKET READ box renders red because primary focus is a Tier-1 ECB Rate Decision'); else fail('CURRENT MARKET READ box not red despite Tier-1 primary focus', callPrefix);
if (/\[1;31m/.test(calPrefix)) ok('HIGH-IMPACT CALENDAR EVENTS box renders red because a Tier-1 row is in scope'); else fail('CALENDAR box not red despite Tier-1 row', calPrefix);
if (/GDP Growth Rate QoQ Prel/.test(msg1) && /ECB Rate Decision/.test(msg1)) ok('ranked calendar surfaces Red + Amber rows from the next72 packet'); else fail('ranked calendar missing red/amber rows');
if (!/FULL BRIEF \/ BRIEF PENDING/.test(all) && !/Full Brief: Brief Pending/.test(all) && !/— Brief Pending/.test(all)) ok('Daily Roadmap does not render generic Full Brief pending filler'); else fail('generic Full Brief pending filler leaked');
if (/Full Brief: https:\/\/atlas-fx-dashboard\.onrender\.com\/brief\?eventId=2026-05-18-1145-eur-ecb-rate-decision/.test(msg1)) ok('ECB row carries deterministic generated Full Brief link'); else fail('ECB row missing deterministic Full Brief link');
if (/Full Brief blocked: missing forecast\/previous/.test(msg1)) ok('FOMC row carries specific Full Brief blocker'); else fail('blocked row missing specific forecast/previous reason');
if (/Event ID: 2026-05-18-1145-eur-ecb-rate-decision/.test(msg1)) ok('ranked event carries deterministic event ID'); else fail('ECB deterministic event ID missing');
if (/11:45 UTC \/ 19:45 AWST/.test(msg1) && /08:00 UTC \/ 16:00 AWST/.test(msg1)) ok('ranked rows show UTC and AWST together'); else fail('UTC/AWST pair missing');
if (/Source note: TradingView LIVE/.test(msg1)) ok('message 1 source note shows TradingView LIVE'); else fail('message 1 missing TradingView LIVE source note');
// Event names render bracketed (cyan hyperlinks when the Full
// Brief route is real; bracketed plain text when Brief Pending).
// Row format dropped the middle `| HIGH |` column per the
// operator brief 2026-05-18 — the impact glyph already conveys
// impact, so each row leads `glyph time CCY · [Event Name]`.
if (/11:45 UTC \/ 19:45 AWST · EUR · HIGH · \[ECB Rate Decision\]\(https:\/\/atlas-fx-dashboard\.onrender\.com\/brief\?eventId=2026-05-18-1145-eur-ecb-rate-decision\)/.test(msg1)) ok('ECB Rate Decision row carries Tier-1 glyph + UTC/AWST + clickable Full Brief link'); else fail('ECB Rate Decision row missing link/glyph/time format');
if (/08:00 UTC \/ 16:00 AWST · EUR · HIGH · \[GDP Growth Rate QoQ Prel\]\(https:\/\/atlas-fx-dashboard\.onrender\.com\/brief\?eventId=2026-05-18-0800-eur-gdp-growth-rate-qoq-prel\)/.test(msg1)) ok('GDP Growth Rate row carries HIGH glyph + clickable Full Brief link'); else fail('GDP Growth Rate row missing link/glyph/time format');
if (/14:00 UTC \/ 22:00 AWST · USD · ELEV · \[FOMC Member Speech\]/.test(msg1)) ok('FOMC Member Speech row carries HIGH glyph + blocker format'); else fail('FOMC Member Speech row missing glyph or stale format');
if (/Affected: [^\n]+\nFull Brief: /.test(msg1) && /Affected: [^\n]+\nFull Brief blocked: /.test(msg1)) ok('calendar rows render Affected + Full Brief link/blocker on dedicated lines'); else fail('calendar rows missing Affected/Full Brief link/blocker lines');

console.log('\nT3 — messages 2/3 include coloured boxed sections:');
if (_boxRegex('🌍 MARKET IMPACT').test(msg2)) ok('message 2 leads with coloured boxed 🌍 MARKET IMPACT header'); else fail('message 2 missing boxed MARKET IMPACT header');
const cardOrder = ['🟦 What is happening', '🟨 Why this matters', '🟧 What moves first', '🟩 What confirms it', '🟥 What weakens it'];
let lastIdx = -1, cardsOk = true;
for (const c of cardOrder) {
  const idx = msg2.indexOf(c);
  if (idx === -1 || idx <= lastIdx) { cardsOk = false; break; }
  lastIdx = idx;
}
if (cardsOk) ok('message 2 emits all five coloured Market Impact cards in order'); else fail('message 2 missing or mis-ordered coloured Market Impact cards');
if (_boxRegex('🎯 AFFECTED MARKETS').test(msg2) && _boxRegex('✅ CONFIRMATION / DEGRADATION', '✅ CONFIRMATION \\/ DEGRADATION').test(msg2)) ok('message 2 includes coloured boxed AFFECTED MARKETS and CONFIRMATION/DEGRADATION'); else fail('message 2 missing boxed AFFECTED MARKETS or CONFIRMATION/DEGRADATION');
if (_boxRegex('🗓️ FORWARD PLANNING').test(msg3) && _boxRegex('🔗 FULL BRIEFS').test(msg3)) ok('message 3 includes coloured boxed FORWARD PLANNING and FULL BRIEFS headers'); else fail('message 3 missing boxed FORWARD PLANNING or FULL BRIEFS headers');

console.log('\nT4 — user-facing terminology is plain-English first:');
if (/US Dollar Strength \(DXY\)/.test(all)) ok('US Dollar Strength (DXY) appears'); else fail('US Dollar Strength (DXY) missing');
if (!/US Dollar Index \(DXY\)|CBOE Volatility Index \(VIX\)|DXY \(US Dollar Strength\)/.test(all)) ok('no stale DXY-first or index-first wording'); else fail('stale DXY/VIX terminology leaked');
// Guard against bare DXY / VIX leaking into user-facing copy. The
// only legal occurrences are inside the bracketed expansion
// "(DXY)" / "(VIX)" or via the symbolDisplay row for the DXY
// affected market (which is itself rewritten via macroLabel).
const bareDxy = all.match(/(?<!\()DXY(?!\))/g) || [];
if (!bareDxy.length) ok('no bare DXY token leaks into the daily roadmap surface'); else fail('bare DXY leaked', bareDxy.length + 'x');
const bareVix = all.match(/(?<!\()VIX(?!\))/g) || [];
if (!bareVix.length) ok('no bare VIX token leaks into the daily roadmap surface'); else fail('bare VIX leaked', bareVix.length + 'x');

// Narrative-text expander — a fixture that arrives with bare
// "DXY directional bias Bullish" upstream must surface to the
// user with the plain-English expansion in place.
const narrativePacket = Object.assign({}, macroPacket, {
  riskState: { label: 'ACTIVE', scoreOutOf5: 3.1, whyThisRating: 'DXY rising and VIX elevated; yields supportive' },
  primaryEventFocus: Object.assign({}, macroPacket.primaryEventFocus, {
    confidenceBasis: 'DXY directional bias confirms the path',
  }),
});
const narrativePayload = buildDailyBulletinPayload(snapshot, { level: 'low' }, now, { macroIntelligencePacket: narrativePacket });
const narrativeAll = narrativePayload.dailyRoadmapMessages.map(m => m.content).join('\n---\n');
if (!/(?<!\()DXY(?!\))/.test(narrativeAll) && !/(?<!\()VIX(?!\))/.test(narrativeAll)) ok('upstream narrative bare DXY / VIX are expanded to plain-English first via _miExpandMacroLabels');
else fail('upstream narrative bare DXY / VIX leaked through to the user surface');

console.log('\nT5 — Red/Amber-only default filter (Medium only when no Red/Amber in next 24h):');
// Fixture A: Red + Amber + a sea of Medium in next 24h → Medium suppressed.
const filterPacketA = Object.assign({}, macroPacket, {
  next72Hours: [
    { title: 'ECB Rate Decision',           currency: 'EUR', timeUTC: '11:45', scheduledTimeUTC: '2026-05-18T11:45:00.000Z', severity: 'HIGH', importanceScore: 95, affectedMarkets: ['EURUSD'], timeMs: now + 6 * 60 * 60 * 1000 },
    { title: 'GDP Growth Rate QoQ Prel',    currency: 'EUR', timeUTC: '08:00', scheduledTimeUTC: '2026-05-18T08:00:00.000Z', severity: 'HIGH', importanceScore: 82, affectedMarkets: ['EURUSD'], timeMs: now + 3 * 60 * 60 * 1000 },
    { title: 'Manufacturing PMI Flash',     currency: 'USD', timeUTC: '13:30', scheduledTimeUTC: '2026-05-18T13:30:00.000Z', severity: 'MED',  importanceScore: 45, affectedMarkets: ['DXY'],    timeMs: now + 8 * 60 * 60 * 1000 },
    { title: 'Services PMI Flash',          currency: 'EUR', timeUTC: '09:00', scheduledTimeUTC: '2026-05-18T09:00:00.000Z', severity: 'MED',  importanceScore: 42, affectedMarkets: ['EURUSD'], timeMs: now + 4 * 60 * 60 * 1000 },
    { title: 'Existing Home Sales',         currency: 'USD', timeUTC: '15:00', scheduledTimeUTC: '2026-05-18T15:00:00.000Z', severity: 'MED',  importanceScore: 38, affectedMarkets: ['DXY'],    timeMs: now + 10 * 60 * 60 * 1000 },
  ],
});
const filterPayloadA = buildDailyBulletinPayload(snapshot, { level: 'low' }, now, { macroIntelligencePacket: filterPacketA });
const filterMsg1A = filterPayloadA.dailyRoadmapMessages[0].content;
if (/ECB Rate Decision/.test(filterMsg1A) && /GDP Growth Rate QoQ Prel/.test(filterMsg1A)) ok('default filter surfaces the Red + Amber rows in next 24h');
else fail('default filter dropped expected Red/Amber rows');
if (!/Manufacturing PMI Flash/.test(filterMsg1A) && !/Services PMI Flash/.test(filterMsg1A) && !/Existing Home Sales/.test(filterMsg1A)) ok('Medium rows suppressed when Red/Amber events exist in the next 24h');
else fail('Medium rows leaked into the default Discord surface despite Red/Amber being present');

// Fixture B: no Red/Amber in next 24h → Medium rows fall back in.
const filterPacketB = Object.assign({}, macroPacket, {
  next72Hours: [
    { title: 'Manufacturing PMI Flash',     currency: 'USD', timeUTC: '13:30', scheduledTimeUTC: '2026-05-18T13:30:00.000Z', severity: 'MED',  importanceScore: 45, affectedMarkets: ['DXY'],    timeMs: now + 8 * 60 * 60 * 1000 },
    { title: 'Services PMI Flash',          currency: 'EUR', timeUTC: '09:00', scheduledTimeUTC: '2026-05-18T09:00:00.000Z', severity: 'MED',  importanceScore: 42, affectedMarkets: ['EURUSD'], timeMs: now + 4 * 60 * 60 * 1000 },
  ],
  primaryEventFocus: { title: 'Manufacturing PMI Flash', currency: 'USD', timeUTC: '13:30', expectedImpact: 'MED', affectedMarkets: ['DXY'] },
});
const filterPayloadB = buildDailyBulletinPayload(snapshot, { level: 'low' }, now, { macroIntelligencePacket: filterPacketB });
const filterMsg1B = filterPayloadB.dailyRoadmapMessages[0].content;
if (/Manufacturing PMI Flash/.test(filterMsg1B) || /Services PMI Flash/.test(filterMsg1B)) ok('Medium rows fall back in when no Red/Amber events exist in the next 24h');
else fail('Medium fallback did not surface when no Red/Amber events were available');

console.log('\nT6 — live scheduler is wired to the 3-message renderer:');
const coreyMI = fs.readFileSync(path.join(__dirname, '..', 'coreyMarketIntel.js'), 'utf8');
if (/daily_roadmap_renderer=used model=3_message/.test(coreyMI)) ok('scheduler logs the new daily roadmap renderer'); else fail('scheduler missing daily roadmap renderer log');
if (/for \(const msg of roadmapMessages\)/.test(coreyMI) && /dispatch\('daily_brief'/.test(coreyMI)) ok('scheduler dispatches each Daily Brief message'); else fail('scheduler does not dispatch daily_brief loop');
if (!/dispatch\('daily', \{ content: bulletin\.content/.test(coreyMI)) ok('scheduler no longer sends the compressed legacy daily payload'); else fail('scheduler still sends compressed legacy daily payload');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[MARKET-INTEL-DAILY-ROADMAP] FAIL'); process.exit(1); }
console.log('[MARKET-INTEL-DAILY-ROADMAP] PASS');
