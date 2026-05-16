#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/engineCoreyValidation.test.js
//
// Operator brief 2026-05-17 (assurance directive). Validates that
// the engine intelligence validator correctly classifies Corey
// macro intelligence packets as OK / PARTIAL / BLOCKED based on
// the required field set.
// ============================================================

const path = require('path');
const { validateCorey } = require(path.join(__dirname, '..', 'engine', 'validate', 'validateEngineIntelligence'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

console.log('\nT1 — Full Corey packet → status OK:');
const fullCorey = {
  regime: 'risk-on',
  activeEvents: ['CPI (USD)'],
  sessionContext: 'NY morning',
  affectedMarkets: ['DXY','EURUSD','XAUUSD','US500'],
  dxyState: 'rising into the print',
  vixState: '14 — complacent',
  yieldState: 'curve flattening',
  riskCondition: 'risk-off lean',
  expectedSensitivity: 'HIGH — clustered catalyst window',
  sourceUsed: 'TradingView calendar + Corey live macro',
  confidenceBasis: 'engine-derived',
  generatedAtUTC: '2026-05-16 21:00 UTC',
};
const fullResult = validateCorey(fullCorey);
if (fullResult.status === 'OK') ok('Full Corey packet → OK'); else fail('Full Corey packet', JSON.stringify(fullResult));

console.log('\nT2 — Empty Corey packet → BLOCKED:');
const empty = validateCorey({});
if (empty.status === 'BLOCKED') ok('Empty Corey packet → BLOCKED'); else fail('Empty Corey packet', empty.status);

console.log('\nT3 — Partial Corey packet → PARTIAL:');
const partial = validateCorey({ regime: 'risk-on', activeEvents: ['CPI'], sessionContext: 'NY' });
if (partial.status === 'PARTIAL') ok('Partial Corey packet → PARTIAL'); else fail('Partial Corey packet', partial.status);

console.log('\nT4 — Generic "depends on surprise" sensitivity caught:');
const generic = validateCorey(Object.assign({}, fullCorey, { expectedSensitivity: 'depends on surprise' }));
if (generic.status !== 'OK' && generic.missingInputs.some(k => /generic_only/.test(k))) ok('Generic expectedSensitivity flagged'); else fail('Generic sensitivity not flagged', JSON.stringify(generic.missingInputs));

console.log('\nT5 — Missing sourceUsed flagged:');
const noSrc = validateCorey(Object.assign({}, fullCorey, { sourceUsed: '' }));
if (noSrc.status !== 'OK' && noSrc.missingInputs.includes('sourceUsed')) ok('Missing sourceUsed flagged'); else fail('sourceUsed missing not flagged', JSON.stringify(noSrc.missingInputs));

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[ENGINE-COREY-VALIDATION] FAIL'); process.exit(1); }
console.log('[ENGINE-COREY-VALIDATION] PASS');
process.exit(0);
