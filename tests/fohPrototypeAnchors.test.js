#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/fohPrototypeAnchors.test.js
//
// Operator directive 2026-05-17 — Hard guard. Asserts that
// every required prototype view-model anchor is present and
// non-empty for both MI and DH renderers, AND that the
// prototype shell parity is intact (6 MI cards + 4 DH cards).
// ============================================================

const path = require('path');
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const { buildDarkHorsePacket }   = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const protoShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'protoShell'));
const miV3Adapter = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Adapter'));
const dhV6Adapter = require(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseV6Adapter'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

console.log('\nT1 — Required anchors present in MI view model:');
const miPacket = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI (USD)', time: '12:30 UTC' }]}] } });
const miVM = miViewModel.toViewModel(miPacket);
const miCheck = miViewModel.validate(miVM);
if (miCheck.ok) ok('MI view model has all ' + miViewModel.REQUIRED_ANCHORS.length + ' anchors');
else fail('MI view model missing anchors', miCheck.missing.join(','));

console.log('\nT2 — Required anchors present in DH view model:');
const dhPacket = buildDarkHorsePacket({ ranking: { top10: [{ symbol: 'EURUSD', movePhase: 'early', score: 9, direction: 'Bullish' }], allCount: 33 }, volatility: { level: 'ELEV' } });
const dhVM = dhViewModel.toViewModel(dhPacket);
const dhCheck = dhViewModel.validate(dhVM);
if (dhCheck.ok) ok('DH view model has all ' + dhViewModel.REQUIRED_ANCHORS.length + ' anchors');
else fail('DH view model missing anchors', dhCheck.missing.join(','));

console.log('\nT3 — Prototype shell parity intact:');
const miProto = protoShell.getMarketIntelV3Html();
const dhProto = protoShell.getDarkHorseV6Html();
const miCards = protoShell.buildMarketIntelV3Cards(miProto);
const dhCards = protoShell.buildDarkHorseV6Cards(dhProto);
if (miCards.length === 6) ok('MI prototype splits to 6 cards'); else fail('MI cards count', miCards.length + ' != 6');
if (dhCards.length === 4) ok('DH prototype splits to 4 cards'); else fail('DH cards count', dhCards.length + ' != 4');

console.log('\nT4 — Prototype invariants preserved after adapter:');
const miAdapted = miV3Adapter.adapt(miProto, { eventClusters: [{ currency: 'USD', events: [{ title: 'CPI', time: '12:30 UTC', severity: 'HIGH' }]}], marketMood: { discs: '🟠🟠🟠🟠⚫', label: '4/5 — Elevated' } });
const dhAdapted = dhV6Adapter.adapt(dhProto, { now: Date.now(), standouts: [{ symbol: 'EURUSD', lifecycle: 'FRESH', direction: 'Bullish' }] });
if (/Markets are sensitive/.test(miAdapted)) ok('MI doctrine prose "Markets are sensitive" survives'); else fail('MI doctrine prose lost');
if (/POSSIBLE MARKET REACTION PATHS/.test(miAdapted)) ok('MI reaction-paths banner survives'); else fail('MI reaction-paths banner lost');
if (/broader market is moving fast/.test(dhAdapted)) ok('DH doctrine prose "broader market" survives'); else fail('DH doctrine prose lost');
if (/EXPANDED TERMINOLOGY HYPERLINKS/.test(dhAdapted)) ok('DH glossary header survives'); else fail('DH glossary header lost');

console.log('\nT5 — Required anchors when engine is empty (safe fallbacks):');
const emptyVM = miViewModel.toViewModel(buildMarketIntelPacket({ engine: {} }));
const emptyCheck = miViewModel.validate(emptyVM);
if (emptyCheck.ok) ok('Empty-engine MI view model still has all anchors');
else fail('Empty-engine MI view model missing anchors', emptyCheck.missing.join(','));

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[FOH-PROTOTYPE-ANCHORS] FAIL'); process.exit(1); }
console.log('[FOH-PROTOTYPE-ANCHORS] PASS');
process.exit(0);
