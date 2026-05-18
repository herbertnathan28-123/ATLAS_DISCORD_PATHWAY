#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/fohTerminology.test.js
//
// Operator directive 2026-05-17 — Hard guard. Asserts:
//   - "Market Impact" surfaces user-facing
//   - "Mechanism Chain" does NOT surface user-facing
//   - No legacy glossary wording leaks
//   - MI dollar-first guidance remains; DH uses account-percentage risk
// ============================================================

const path = require('path');
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const { buildDarkHorsePacket }   = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const miShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

const miPacket = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI (USD)', time: '12:30 UTC' }]}] } });
const dhPacket = buildDarkHorsePacket({ ranking: { top10: [{ symbol: 'EURUSD', movePhase: 'early', score: 9, direction: 'Bullish', rewardRLabel: '3R' }], allCount: 33 }, volatility: { level: 'ELEV' } });
const miVM = miViewModel.toViewModel(miPacket);
const dhVM = dhViewModel.toViewModel(dhPacket);
const miText = miShell.buildDiscordTextSummary(miVM, {});
const dhText = miShell.buildDiscordTextSummary(dhVM, {});

console.log('\nT1 — "Market Impact" surfaces user-facing:');
if (/Market Impact|Market impact/.test(miVM.MARKET_IMPACT)) ok('MI MARKET_IMPACT anchor uses "Market impact"'); else fail('MI MARKET_IMPACT anchor missing label');
if (/Market Impact|Market impact/.test(dhVM.MARKET_IMPACT)) ok('DH MARKET_IMPACT anchor uses "Market impact"'); else fail('DH MARKET_IMPACT anchor missing label');
if (/Market Impact|Market impact/.test(miText)) ok('MI Discord text says "Market impact"'); else fail('MI Discord text missing "Market impact"');
if (/Market Impact|Market impact/.test(dhText)) ok('DH Discord text says "Market impact"'); else fail('DH Discord text missing "Market impact"');

console.log('\nT2 — "Mechanism Chain" does NOT surface user-facing:');
if (!/Mechanism Chain/.test(miVM.MARKET_IMPACT)) ok('MI MARKET_IMPACT has no "Mechanism Chain"'); else fail('MI MARKET_IMPACT leaks "Mechanism Chain"');
if (!/Mechanism Chain/.test(dhVM.MARKET_IMPACT)) ok('DH MARKET_IMPACT has no "Mechanism Chain"'); else fail('DH MARKET_IMPACT leaks "Mechanism Chain"');
if (!/Mechanism Chain/.test(miText)) ok('MI Discord text has no "Mechanism Chain"'); else fail('MI Discord text leaks "Mechanism Chain"');
if (!/Mechanism Chain/.test(dhText)) ok('DH Discord text has no "Mechanism Chain"'); else fail('DH Discord text leaks "Mechanism Chain"');

console.log('\nT3 — Risk guidance present in WHAT_TO_DO_NOW:');
if (/\$/.test(miVM.WHAT_TO_DO_NOW)) ok('MI WHAT_TO_DO_NOW carries $ figures'); else fail('MI WHAT_TO_DO_NOW missing $ figures');
if (/account-percentage risk|account equity|Account-risk cap/i.test(dhVM.WHAT_TO_DO_NOW)) ok('DH WHAT_TO_DO_NOW carries account-percentage risk wording'); else fail('DH WHAT_TO_DO_NOW missing account-percentage risk wording');

console.log('\nT4 — No legacy glossary wording leaks:');
const LEGACY_BANNED = [/\bMechanism\s+Chain\b/i, /\bview\s+in\s+notion\b/i, /\bgo\s+to\s+notion\b/i, /\bopen\s+workspace\b/i];
const allText = [miVM.HEADER_TITLE, miVM.BRIEFING_SUMMARY, miVM.MARKET_IMPACT, miVM.WHAT_TO_DO_NOW, dhVM.BRIEFING_SUMMARY, dhVM.MARKET_IMPACT, dhVM.WHAT_TO_DO_NOW, miText, dhText].join('\n');
let legacyOk = true;
for (const re of LEGACY_BANNED) if (re.test(allText)) { fail('legacy wording leak: ' + re); legacyOk = false; }
if (legacyOk) ok('No legacy banned wording in user-facing surface');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[FOH-TERMINOLOGY] FAIL'); process.exit(1); }
console.log('[FOH-TERMINOLOGY] PASS');
process.exit(0);
