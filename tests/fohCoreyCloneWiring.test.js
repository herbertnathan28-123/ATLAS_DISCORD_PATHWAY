#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/fohCoreyCloneWiring.test.js
//
// Operator post-deploy correction 2026-05-17: Corey Clone must be
// wired into the MI scheduler tick, the FOH packet, the view model,
// and the Discord text body — and degradation (PARTIAL / BLOCKED /
// NOT_INVOKED) must surface honestly rather than hide.
// ============================================================

const path = require('path');
const fs = require('fs');
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const { buildDiscordTextSummary } = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell'));
const { validateFohOutput } = require(path.join(__dirname, '..', 'foh', 'validate', 'validateFohOutput'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

console.log('\nT1 — MI scheduler invokes Corey Clone per dispatch:');
const coreyMI = fs.readFileSync(path.join(__dirname, '..', 'coreyMarketIntel.js'), 'utf8');
if (/_fetchCoreyClone/.test(coreyMI)) ok('coreyMarketIntel.js defines _fetchCoreyClone');
else fail('coreyMarketIntel.js does NOT define _fetchCoreyClone');
const fetchCount = (coreyMI.match(/await _fetchCoreyClone\(/g) || []).length;
if (fetchCount >= 3) ok('Corey Clone invoked at all 3 dispatch sites (daily / pre_event / release) — found ' + fetchCount);
else fail('Corey Clone not invoked at all dispatch sites', 'found ' + fetchCount);
if (/\[COREY-CLONE\] tick=/.test(coreyMI)) ok('Per-tick [COREY-CLONE] log line wired');
else fail('No [COREY-CLONE] log line — operator cannot see clone activity');

console.log('\nT2 — Dispatch threads coreyClone into sendMarketIntelFoh:');
if (/coreyClone: payloadObj\.coreyClone/.test(coreyMI)) ok('dispatch() passes coreyClone to sendMarketIntelFoh');
else fail('dispatch() does NOT pass coreyClone — clone packet lost in transit');

const sendMI = fs.readFileSync(path.join(__dirname, '..', 'foh', 'dispatch', 'sendMarketIntelFoh.js'), 'utf8');
if (/coreyClone[\s,}]/.test(sendMI)) ok('sendMarketIntelFoh signature accepts coreyClone');
else fail('sendMarketIntelFoh does NOT accept coreyClone parameter');
if (/coreyClone:/.test(sendMI)) ok('sendMarketIntelFoh passes coreyClone to buildMarketIntelPacket');
else fail('sendMarketIntelFoh does NOT pass coreyClone to packet builder');

console.log('\nT3 — Packet builder populates historicalReaction + cloneStatus:');
const cloneRes = {
  packet: {
    symbol: 'EURUSD', score: 0.62, confidence: 0.68,
    analogues: [{ date: '2024-09-05', similarity: 0.78, outcome: 'follow_through' }],
    baseRates: { followThrough: 0.6 }, warningFlags: [], timeframeRelevance: 'daily',
  },
  validation: { status: 'OK', validAnalogues: 1, droppedAnalogues: 0, confidenceBasis: 'audit-grade-1-of-1' },
};
const pOK = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI', time: '12:30 UTC', severity: 'HIGH' }]}] }, coreyClone: cloneRes });
if (pOK.historicalReaction && pOK.historicalReaction.available) ok('historicalReaction available when packet supplied');
else fail('historicalReaction missing when packet supplied', JSON.stringify(pOK.historicalReaction));
if (pOK.cloneStatus && pOK.cloneStatus.status === 'OK') ok('cloneStatus reflects OK status');
else fail('cloneStatus does not reflect OK', JSON.stringify(pOK.cloneStatus));

console.log('\nT4 — Packet builder surfaces PARTIAL honestly:');
const cloneRes2 = {
  packet: { symbol: 'EURUSD', status: 'PARTIAL', analogues: [], warningFlags: ['cache_partial'], cacheStatus: { ok: false, severity: 'moderate' } },
  validation: { status: 'PARTIAL', validAnalogues: 0, droppedAnalogues: 2, confidenceBasis: 'dropped_2_of_2', degradedReason: 'dropped_2_of_2' },
};
const pPartial = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI', time: '12:30 UTC', severity: 'HIGH' }]}] }, coreyClone: cloneRes2 });
if (pPartial.cloneStatus.status === 'PARTIAL') ok('PARTIAL surfaced in cloneStatus');
else fail('PARTIAL not surfaced', JSON.stringify(pPartial.cloneStatus));

console.log('\nT5 — Packet builder surfaces NOT_INVOKED honestly when no clone packet:');
const pNone = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI', time: '12:30 UTC', severity: 'HIGH' }]}] } });
if (pNone.cloneStatus.status === 'NOT_INVOKED') ok('NOT_INVOKED surfaced when no clone supplied');
else fail('NOT_INVOKED not surfaced', JSON.stringify(pNone.cloneStatus));
if (pNone.historicalReaction && pNone.historicalReaction.available === false) ok('historicalReaction.available=false when no clone supplied');
else fail('historicalReaction.available should be false', JSON.stringify(pNone.historicalReaction));

console.log('\nT6 — View model surfaces HISTORICAL_ANALOGUE anchor:');
const vmOK = miViewModel.toViewModel(pOK);
if (miViewModel.REQUIRED_ANCHORS.includes('HISTORICAL_ANALOGUE')) ok('HISTORICAL_ANALOGUE is a REQUIRED anchor');
else fail('HISTORICAL_ANALOGUE missing from REQUIRED_ANCHORS');
const v = miViewModel.validate(vmOK);
if (v.ok) ok('view model validation passes with Corey Clone anchor');
else fail('view model validation failed', v.missing.join(','));
if (/Corey Clone status:/.test(vmOK.HISTORICAL_ANALOGUE)) ok('HISTORICAL_ANALOGUE carries "Corey Clone status:" label');
else fail('HISTORICAL_ANALOGUE missing label');

console.log('\nT7 — Discord text body carries Corey Clone section:');
const textOK = buildDiscordTextSummary(vmOK, { maxDiscordChunkChars: 10000 });
if (/Historical Analogue \(Corey Clone\)/.test(textOK)) ok('Discord text includes "Historical Analogue (Corey Clone)" header');
else fail('Discord text missing Corey Clone header');
if (/Corey Clone status:/.test(textOK)) ok('Discord text surfaces clone status');
else fail('Discord text does not surface clone status');

console.log('\nT8 — Discord text on PARTIAL clone shows degradation:');
const vmPartial = miViewModel.toViewModel(pPartial);
const textPartial = buildDiscordTextSummary(vmPartial, { maxDiscordChunkChars: 10000 });
if (/PARTIAL/.test(textPartial)) ok('Discord text shows PARTIAL when clone degraded');
else fail('PARTIAL not surfaced in Discord text');
if (/degraded|warning/i.test(textPartial)) ok('Discord text indicates degraded read');
else fail('Discord text does not flag degradation');

console.log('\nT9 — Discord text on NOT_INVOKED is still honest:');
const vmNone = miViewModel.toViewModel(pNone);
const textNone = buildDiscordTextSummary(vmNone, { maxDiscordChunkChars: 10000 });
if (/NOT_INVOKED/.test(textNone)) ok('Discord text shows NOT_INVOKED when clone absent');
else fail('NOT_INVOKED not surfaced');

console.log('\nT10 — Pre-send validator accepts the Corey Clone-bearing packet:');
const v3 = validateFohOutput({ packet: pOK, viewModel: vmOK, discordText: textOK });
if (v3.ok) ok('Pre-send validator passes OK packet');
else fail('Pre-send validator rejected OK packet', JSON.stringify(v3.failures.slice(0, 3)));
const v4 = validateFohOutput({ packet: pPartial, viewModel: vmPartial, discordText: textPartial });
if (v4.ok) ok('Pre-send validator passes PARTIAL packet (degradation surfaced, not blocked)');
else fail('Pre-send validator rejected PARTIAL packet — should accept since degradation is surfaced honestly', JSON.stringify(v4.failures.slice(0, 3)));

console.log('\nT11 — index.js no longer hard-codes "not active in this release":');
const indexJs = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const hardCodeCount = (indexJs.match(/'not active in this release'/g) || []).length;
if (hardCodeCount === 0) ok('No "not active in this release" hard-codes remain');
else fail('"not active in this release" still hard-coded in ' + hardCodeCount + ' place(s)');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[FOH-COREY-CLONE-WIRING] FAIL'); process.exit(1); }
console.log('[FOH-COREY-CLONE-WIRING] PASS');
process.exit(0);
