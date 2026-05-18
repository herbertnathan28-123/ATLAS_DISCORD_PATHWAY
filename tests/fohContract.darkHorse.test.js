#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Locks the per-module FOH contract scoping in
// foh/validate/validateFohOutput.js (operator brief 2026-05-18).
//
// Before this scope was added the validator ran the Market Intel
// field list against every Dark Horse packet, producing 11+ false
// `packet_missing_field:` failures (`theCall`, `rankedEventCalendar`,
// `todaysAnnouncements`, `primaryEventFocus`, `next24To72Hours`,
// `affectedMarketsExpanded`, `priceMap`, `operationalNarrative`,
// `historicalReaction`, `cloneStatus`, `structureSnapshot`). The
// dispatcher then surfaced
//   `[DH-FOH-IMAGE] image render path returned not-ok
//    reason=foh_contract_validation_failed, falling through to text`
// and Dark Horse went out as text-only on every cycle.

const path = require('path');
const { validateFohOutput } = require(path.join(__dirname, '..', 'foh', 'validate', 'validateFohOutput'));
const { buildDarkHorsePacket } = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + JSON.stringify(err).slice(0, 300) : '')); }

function mkRanking() {
  return {
    top10: [
      { symbol: 'EURUSD', score: 9, direction: 'Bullish', sectionLabel: 'FX Majors', summary: 'composite score breakout · trend confirmed', reasons: ['HH/HL structure confirmed (72% bullish bars)'], evidenceAnchors: { recentHigh: { priceText: '1.0925' }, recentLow: { priceText: '1.0870' }, invalidation: { priceText: '1.0840' } }, movePhase: 'developing' },
      { symbol: 'USDJPY', score: 8, direction: 'Bearish', sectionLabel: 'FX Majors', summary: 'LH/LL structure confirmed', reasons: ['LH/LL structure confirmed (68% bearish bars)'], evidenceAnchors: { recentHigh: { priceText: '155.20' }, recentLow: { priceText: '154.10' }, invalidation: { priceText: '155.85' } }, movePhase: 'late' },
    ],
  };
}

console.log('\nT1 — Dark Horse packet passes validateFohOutput (per-module scope):');
const dhPacket = buildDarkHorsePacket({ ranking: mkRanking(), volatility: { level: 'elevated' }, now: Date.parse('2026-05-18T12:00:00Z'), universeSize: 33 });
const dhVm = dhViewModel.toViewModel(dhPacket);
const dhRes = validateFohOutput({ packet: dhPacket, viewModel: dhVm, discordText: '(rendered Dark Horse text body for QA)' });
if (dhRes.moduleId === 'dark_horse') ok('validator detected meta.module=dark_horse and applied the DH contract');
else fail('validator did not detect dark_horse module', dhRes);
if (dhRes.ok) ok('Dark Horse packet + view-model passes the per-module contract gate (no false packet_missing_field: failures)');
else fail('Dark Horse packet still rejected by validator', dhRes);

console.log('\nT2 — false MI-specific failures no longer fire on the DH packet:');
const MI_ONLY_FIELDS = ['theCall', 'rankedEventCalendar', 'todaysAnnouncements', 'primaryEventFocus', 'next24To72Hours', 'affectedMarketsExpanded', 'priceMap', 'operationalNarrative', 'historicalReaction', 'cloneStatus', 'structureSnapshot'];
for (const field of MI_ONLY_FIELDS) {
  const stale = dhRes.failures.find(f => f === 'packet_missing_field:' + field);
  if (!stale) ok('no stale `packet_missing_field:' + field + '` on the DH packet');
  else fail('DH packet still trips MI-only `packet_missing_field:' + field + '`');
}

console.log('\nT3 — Market Intel contract still enforced when packet declares meta.module=market_intel:');
const miPacket = { meta: { module: 'market_intel' } };
const miRes = validateFohOutput({ packet: miPacket, viewModel: null, discordText: '' });
if (miRes.moduleId === 'market_intel') ok('validator detected meta.module=market_intel');
else fail('validator did not detect market_intel module');
const expectedMiMisses = ['packet_missing_field:theCall', 'packet_missing_field:rankedEventCalendar', 'packet_missing_field:primaryEventFocus'];
for (const f of expectedMiMisses) {
  if (miRes.failures.indexOf(f) !== -1) ok('MI contract still surfaces ' + f + ' on an empty MI packet');
  else fail('MI contract no longer surfaces ' + f);
}

console.log('\nT4 — packet with no meta.module defaults to MI semantics (backward compat):');
const noModulePacket = {};
const noModuleRes = validateFohOutput({ packet: noModulePacket, viewModel: null, discordText: '' });
if (noModuleRes.moduleId === 'market_intel') ok('packet without meta.module defaults to market_intel contract');
else fail('packet without meta.module did not default to market_intel');
if (noModuleRes.failures.indexOf('packet_missing_field:theCall') !== -1) ok('default-MI contract still flags missing theCall (backward compat preserved)');
else fail('default-MI contract no longer flags missing theCall');

console.log('\nT5 — Dark Horse packet still rejected if the few DH-required fields are missing:');
const dhMissing = { meta: { module: 'dark_horse' } };
const dhMissingRes = validateFohOutput({ packet: dhMissing, viewModel: null, discordText: '' });
if (!dhMissingRes.ok) ok('empty DH packet is still rejected (contract is scoped, not disabled)');
else fail('empty DH packet wrongly accepted');
const expectedDhMisses = ['packet_missing_field:header', 'packet_missing_field:briefingSummary', 'packet_missing_field:whatToDoNow'];
for (const f of expectedDhMisses) {
  if (dhMissingRes.failures.indexOf(f) !== -1) ok('DH contract surfaces ' + f + ' on an empty DH packet');
  else fail('DH contract no longer surfaces ' + f);
}

console.log('\nT6 — HH/HL / LH/LL chart shorthand is scrubbed from the DH packet behaviour text:');
const fourWay = dhPacket.fourWayOutcomes || {};
const behaviourText = JSON.stringify([fourWay.higher, fourWay.lower, fourWay.inline, fourWay.reversal]);
if (!/\bHH\/HL\b|\bLH\/LL\b/.test(behaviourText)) ok('no raw HH/HL or LH/LL in fourWayOutcomes.behaviour');
else fail('raw HH/HL / LH/LL leaked into fourWayOutcomes.behaviour', behaviourText.slice(0, 300));
if (/higher highs and higher lows|lower highs and lower lows/.test(behaviourText)) ok('plain-English translation of HH/HL surfaces (translator scrubber is wired)');
else fail('plain-English HH/HL translation missing', behaviourText.slice(0, 300));

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[FOH-CONTRACT-DARK-HORSE] FAIL'); process.exit(1); }
console.log('[FOH-CONTRACT-DARK-HORSE] PASS');
