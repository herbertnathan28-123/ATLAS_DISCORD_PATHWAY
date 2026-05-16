#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const { validateCoreyClone } = require(path.join(__dirname, '..', 'engine', 'validate', 'validateEngineIntelligence'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

function fullAnalogue(over) {
  return Object.assign({
    instrument: 'EURUSD',
    windowStartUTC: '2024-05-15 12:30 UTC',
    windowEndUTC: '2024-05-15 14:00 UTC',
    matchTimeframe: '5M',
    cohortSampleSize: 12,
    denominator: 156,
    matchingVariables: ['DXY direction', 'CPI surprise direction'],
    sourceDataset: 'tv-history-v2.1',
    outcomeLabel: 'USD bid sustained 1H+',
    outcomeMeasurementWindow: '12:35 → 13:30 UTC',
    confidenceScore: 0.72,
    reasonSelected: 'tightest macro+structure match',
  }, over || {});
}

console.log('\nT1 — Three valid audit-grade analogues → OK:');
const okPacket = validateCoreyClone({ analogues: [fullAnalogue(), fullAnalogue({ confidenceScore: 0.65 }), fullAnalogue({ confidenceScore: 0.81 })] });
if (okPacket.status === 'OK' && okPacket.validAnalogues === 3) ok('OK status with 3 valid analogues'); else fail('Expected OK 3 valid', JSON.stringify(okPacket));

console.log('\nT2 — Zero analogues → BLOCKED:');
const blocked = validateCoreyClone({ analogues: [] });
if (blocked.status === 'BLOCKED') ok('Zero analogues → BLOCKED'); else fail('Expected BLOCKED', blocked.status);

console.log('\nT3 — Mixed valid + invalid → PARTIAL:');
const mixed = validateCoreyClone({ analogues: [fullAnalogue(), fullAnalogue({ cohortSampleSize: null })] });
if (mixed.status === 'PARTIAL' && mixed.validAnalogues === 1 && mixed.droppedAnalogues === 1) ok('Mixed → PARTIAL with 1 valid'); else fail('Mixed expected PARTIAL 1 valid 1 dropped', JSON.stringify(mixed));

console.log('\nT4 — Missing denominator → analogue dropped:');
const noDenom = validateCoreyClone({ analogues: [fullAnalogue({ denominator: null })] });
if (noDenom.status === 'BLOCKED' && noDenom.validAnalogues === 0) ok('Missing denominator analogue dropped to BLOCKED'); else fail('Denominator drop expected', JSON.stringify(noDenom));

console.log('\nT5 — Missing outcomeMeasurementWindow → analogue dropped:');
const noOmw = validateCoreyClone({ analogues: [fullAnalogue({ outcomeMeasurementWindow: '' })] });
if (noOmw.status === 'BLOCKED') ok('Missing outcomeMeasurementWindow drops to BLOCKED'); else fail('omw drop', JSON.stringify(noOmw));

console.log('\nT6 — BLOCKED status carries "no audit-grade analogues" basis:');
if (/no audit-grade analogues/.test(blocked.confidenceBasis)) ok('BLOCKED basis is correctly worded'); else fail('BLOCKED basis wording', blocked.confidenceBasis);

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[ENGINE-COREYCLONE-VALIDATION] FAIL'); process.exit(1); }
console.log('[ENGINE-COREYCLONE-VALIDATION] PASS');
process.exit(0);
