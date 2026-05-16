#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const { validateSpidey } = require(path.join(__dirname, '..', 'engine', 'validate', 'validateEngineIntelligence'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

const fullPriceMap = [
  { level: '1.0928', role: 'reaction_level', whyMatters: 'pre-event reaction band', confirmation: '5m close below', invalidation: 'body close back above' },
  { level: '1.0880', role: 'liquidity_pool', whyMatters: 'downside liquidity', confirmation: '1H close below', invalidation: '5m reclaim back above' },
];
function fullSpidey(over) {
  return Object.assign({
    currentPrice: '1.0935',
    activeStructure: 'rotating between 1.0928 and 1.0980',
    liquidityZones: ['1.0880','1.0980'],
    reactionLevels: ['1.0928'],
    supportZones: ['1.0880'],
    resistanceZones: ['1.0980'],
    invalidationLevels: ['1.1010'],
    targetZones: ['1.0880'],
    timeframe: '5M / 15M / 1H',
    confirmationCondition: '5m close beyond reaction band + next candle holds',
    cancellationCondition: 'body close back inside the band',
    priceMap: fullPriceMap,
    structureConfidence: 0.72,
    sourceUsed: 'TradingView 5M',
    generatedAtUTC: '2026-05-16 21:00 UTC',
  }, over || {});
}

console.log('\nT1 — Full Spidey packet → OK:');
const r1 = validateSpidey(fullSpidey());
if (r1.status === 'OK') ok('Full Spidey → OK'); else fail('Full Spidey', JSON.stringify(r1.missingInputs));

console.log('\nT2 — Empty Spidey → BLOCKED:');
const r2 = validateSpidey({});
if (r2.status === 'BLOCKED') ok('Empty Spidey → BLOCKED'); else fail('Empty Spidey', r2.status);

console.log('\nT3 — Missing invalidation → PARTIAL:');
const r3 = validateSpidey(fullSpidey({ invalidationLevels: [] }));
if (r3.status === 'PARTIAL' && r3.missingInputs.includes('invalidationLevels')) ok('Missing invalidation flagged'); else fail('invalidation', JSON.stringify(r3));

console.log('\nT4 — priceMap entry without whyMatters → flagged:');
const r4 = validateSpidey(fullSpidey({ priceMap: [{ level: '1.0928', role: 'reaction_level' }] }));
if (r4.status === 'PARTIAL' && r4.missingInputs.some(k => /priceMap\[0\]\.whyMatters/.test(k))) ok('Naked priceMap entry flagged'); else fail('naked level', JSON.stringify(r4));

console.log('\nT5 — Vague timeframe blank flagged:');
const r5 = validateSpidey(fullSpidey({ timeframe: '' }));
if (r5.status === 'PARTIAL' && r5.missingInputs.includes('timeframe')) ok('Missing timeframe flagged'); else fail('timeframe', JSON.stringify(r5));

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[ENGINE-SPIDEY-VALIDATION] FAIL'); process.exit(1); }
console.log('[ENGINE-SPIDEY-VALIDATION] PASS');
process.exit(0);
