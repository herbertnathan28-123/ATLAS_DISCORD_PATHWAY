#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/fohLiveDispatchText.test.js
//
// Operator brief 2026-05-17 (post-deploy regression): the live
// Discord message body (the `content` field POSTed to the
// webhook) must carry the expanded FOH intelligence — not the
// legacy 1714-char thin wrapper. This guard catches any future
// regression where the runtime falls back to the legacy text
// path while FOH_IMAGE_RENDER_ENABLED=true.
// ============================================================

const path = require('path');
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const { buildDarkHorsePacket }   = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const { buildDiscordTextSummary } = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

const REQUIRED_SECTIONS_IN_DISCORD_TEXT = [
  /__Briefing Summary__/,
  /__Market Impact__/,
  /__Confirmation \/ Cancellation__/,
  /__Source \/ Provenance__/,
];

console.log('\nT1 — MI Discord text carries required section headers (high-impact day):');
const miHigh = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI (USD)', time: '12:30 UTC', severity: 'HIGH' }]}] } });
const miHighVM = miViewModel.toViewModel(miHigh);
const miHighText = buildDiscordTextSummary(miHighVM, {});
for (const re of REQUIRED_SECTIONS_IN_DISCORD_TEXT) {
  if (re.test(miHighText)) ok('MI HIGH text includes ' + re.toString());
  else fail('MI HIGH text missing section ' + re.toString(), 'len=' + miHighText.length);
}

console.log('\nT2 — MI Discord text is materially expanded vs legacy 1714-char wrapper:');
if (miHighText.length >= 1000) ok('MI HIGH text length ≥ 1000 chars (' + miHighText.length + ')');
else fail('MI HIGH text length below 1000', miHighText.length);
// Operator log line showed 1714 thin wrapper. Anything that looks
// like a 1700-char-range payload AND lacks expanded sections is
// a regression signal.
if (miHighText.length === 1714) fail('MI HIGH text is exactly the legacy 1714-char wrapper length');
else ok('MI HIGH text length is not the regression signature');

console.log('\nT3 — MI Discord text carries operationally-anchored doctrine markers:');
const DOCTRINE_MARKERS = [
  /Market impact/i,
  /Confirms?:/i,
  /Cancels?:/i,
  /Source:/i,
];
for (const re of DOCTRINE_MARKERS) {
  if (re.test(miHighText)) ok('MI text includes doctrine marker ' + re.toString());
  else fail('MI text missing doctrine marker ' + re.toString());
}

console.log('\nT4 — MI Discord text on empty calendar still uses expanded format:');
const miEmpty = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'LOW' }, eventClusters: [] } });
const miEmptyVM = miViewModel.toViewModel(miEmpty);
const miEmptyText = buildDiscordTextSummary(miEmptyVM, {});
if (miEmptyText.length >= 1000) ok('MI empty-calendar text ≥ 1000 chars (' + miEmptyText.length + ')');
else fail('MI empty-calendar text too thin', miEmptyText.length);
for (const re of REQUIRED_SECTIONS_IN_DISCORD_TEXT) {
  if (re.test(miEmptyText)) ok('MI empty text includes ' + re.toString());
  else fail('MI empty text missing section ' + re.toString());
}

console.log('\nT4b — MI Discord text populates ranked next-72h calendar when today is empty:');
const next72MacroPacket = {
  sourceUsed: ['TradingView calendar', 'corey_live'],
  dataFreshness: { calendar: { mode: 'LIVE', source: 'TradingView', available: true } },
  todayAnnouncements: [],
  next72Hours: [
    { title: 'GDP Growth Rate QoQ Prel', currency: 'EUR', timeUTC: '08:00', scheduledTimeUTC: '2026-05-18T08:00:00.000Z', severity: 'HIGH', importanceScore: 82, affectedMarkets: ['EURUSD', 'DXY', 'GER40'], expectedSensitivity: 'Growth print sets the next risk window.' },
    { title: 'FOMC Member Speech', currency: 'USD', timeUTC: '14:00', scheduledTimeUTC: '2026-05-18T14:00:00.000Z', severity: 'ELEV', importanceScore: 68, affectedMarkets: ['DXY', 'EURUSD', 'US500'], expectedSensitivity: 'Fed guidance can shift the rate path.' },
  ],
  eventClusters: [],
  primaryEventFocus: { title: 'GDP Growth Rate QoQ Prel', currency: 'EUR', timeUTC: '08:00', expectedImpact: 'HIGH', affectedMarkets: ['EURUSD', 'DXY', 'GER40'], volatilityWindow: '08:00 UTC release window', whyPrimary: 'Highest ranked next-72h event.' },
  riskState: { label: 'ACTIVE', scoreOutOf5: 3.1, whyThisRating: 'next72 ranked events available while today is empty' },
  affectedMarketsExpanded: [{ symbol: 'EURUSD', transmissionMechanism: 'Growth path reprices EUR leg.', strongerThanExpectedPath: 'EUR supported.', weakerThanExpectedPath: 'EUR pressured.', confirmationCondition: 'EURUSD close confirms.', invalidationCondition: 'Close rejects.', keyPriceLevels: 'Pre-event range.', riskNote: 'Confirm with dollar leg.' }],
  macroTransmissionMap: [{ driver: 'GDP Growth Rate QoQ Prel', mechanism: 'Growth surprise reprices rate-path expectations.', firstOrderEffect: 'EUR rate expectations move first.', secondOrderEffect: 'Dollar pairs and EU indices follow after confirmation.', affectedSymbols: ['EURUSD', 'DXY', 'GER40'], whatStrengthensThis: 'EURUSD and yields confirm.', whatWeakensThis: 'US Dollar Strength fades the move.' }],
  confidenceBasis: 'ranked 86 calendar rows into 43 next-72h relevant rows; calendar source=TradingView/LIVE',
};
const miNext72 = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'MED' }, eventClusters: [], macroIntelligencePacket: next72MacroPacket } });
const miNext72Text = buildDiscordTextSummary(miViewModel.toViewModel(miNext72), { maxDiscordChunkChars: 100000 });
if (/^🔥 \*\*THE CALL\*\*/.test(miNext72Text)) ok('MI next72 text leads with THE CALL'); else fail('MI next72 text does not lead with THE CALL');
if (/TODAY'S RANKED EVENT CALENDAR/.test(miNext72Text) && /TIME \| CCY \| IMPACT \| EVENT \| AFFECTED MARKETS \| FULL BRIEF/.test(miNext72Text)) ok('MI next72 text includes ranked calendar table header'); else fail('MI next72 text missing ranked calendar header');
if (/GDP Growth Rate QoQ Prel/.test(miNext72Text) && /FOMC Member Speech/.test(miNext72Text)) ok('MI next72 text includes next72 events'); else fail('MI next72 text missing next72 event rows');
if (/Brief Pending/.test(miNext72Text)) ok('MI next72 text shows Brief Pending fallback'); else fail('MI next72 text missing Brief Pending');
if (/Source: TradingView calendar .* freshness: LIVE/.test(miNext72Text)) ok('MI next72 text shows TradingView LIVE source'); else fail('MI next72 text missing TradingView LIVE source');
if (/Market impact: GDP Growth Rate QoQ Prel/.test(miNext72Text)) ok('MI next72 text populates Market Impact from macro transmission path'); else fail('MI next72 text missing macro transmission Market Impact');

console.log('\nT5 — DH Discord text carries the same expanded structure:');
const dh = buildDarkHorsePacket({ ranking: { top10: [{ symbol: 'EURUSD', movePhase: 'early', score: 9, direction: 'Bullish' }], allCount: 33 }, volatility: { level: 'ELEV' } });
const dhVM = dhViewModel.toViewModel(dh);
const dhText = buildDiscordTextSummary(dhVM, {});
if (dhText.length >= 1000) ok('DH text length ≥ 1000 chars (' + dhText.length + ')');
else fail('DH text too thin', dhText.length);
for (const re of REQUIRED_SECTIONS_IN_DISCORD_TEXT) {
  if (re.test(dhText)) ok('DH text includes ' + re.toString());
  else fail('DH text missing section ' + re.toString());
}

console.log('\nT6 — Runtime dispatch path resolves to sendMarketIntelFoh:');
// Verify the runtime dispatch path imports the new dispatcher.
const fs = require('fs');
const coreyMI = fs.readFileSync(path.join(__dirname, '..', 'coreyMarketIntel.js'), 'utf8');
if (/require\('\.\/foh\/dispatch\/sendMarketIntelFoh'\)/.test(coreyMI)) ok('coreyMarketIntel.js wires sendMarketIntelFoh');
else fail('coreyMarketIntel.js does NOT wire sendMarketIntelFoh — live dispatch regression');
if (/sendMarketIntelFoh\(/.test(coreyMI)) ok('coreyMarketIntel.js invokes sendMarketIntelFoh');
else fail('coreyMarketIntel.js does NOT invoke sendMarketIntelFoh');

console.log('\nT7 — Runtime DH dispatch path resolves to sendDarkHorseFoh:');
const dhDispatch = fs.readFileSync(path.join(__dirname, '..', 'darkHorseImageDispatch.js'), 'utf8');
if (/require\('\.\/foh\/dispatch\/sendDarkHorseFoh'\)/.test(dhDispatch)) ok('darkHorseImageDispatch.js wires sendDarkHorseFoh');
else fail('darkHorseImageDispatch.js does NOT wire sendDarkHorseFoh');

console.log('\nT8 — Legacy postFohSplitToDiscord no longer the primary runtime path:');
// The legacy caption-only path is fine for ad-hoc tooling but
// must NOT be the primary live-dispatch path. Verify the runtime
// uses the new dispatchers as the live path.
if (!/foh\.postFohSplitToDiscord\(/.test(coreyMI) || /sendMarketIntelFoh\(/.test(coreyMI)) ok('MI runtime does not depend solely on postFohSplitToDiscord');
else fail('MI runtime still depends on postFohSplitToDiscord');
if (!/foh\.postFohSplitToDiscord\(/.test(dhDispatch) || /sendDarkHorseFoh\(/.test(dhDispatch)) ok('DH runtime does not depend solely on postFohSplitToDiscord');
else fail('DH runtime still depends on postFohSplitToDiscord');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[FOH-LIVE-DISPATCH-TEXT] FAIL'); process.exit(1); }
console.log('[FOH-LIVE-DISPATCH-TEXT] PASS');
process.exit(0);
