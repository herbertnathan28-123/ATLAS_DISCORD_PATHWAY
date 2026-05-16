#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const { validateJane } = require(path.join(__dirname, '..', 'engine', 'validate', 'validateEngineIntelligence'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

function fullJane(over) {
  return Object.assign({
    actionState: 'monitoring',
    setupQuality: 'high',
    macroAlignment: 'risk-off lean dominant',
    structureAlignment: 'EURUSD respecting 1.0928 reaction band',
    historicalAnalogueAlignment: 'three audit-grade analogues; weight 0.6',
    eventRisk: 'HIGH',
    conflictNotes: 'macro + structure aligned bearish on EURUSD; no conflict',
    reasonForDecision: 'macro + structure agreement, audit-grade history supportive',
    upgradeCondition: '5m close below 1.0928 + DXY making higher highs',
    downgradeCondition: 'EURUSD reclaims 1.0928 on 5m close',
    invalidation: 'EURUSD closes back above 1.0928',
    confidenceScore: 0.78,
    confidenceBasis: 'macro + structure aligned, audit-grade history supportive',
    generatedAtUTC: '2026-05-16 21:00 UTC',
  }, over || {});
}

console.log('\nT1 — Full Jane packet → OK:');
const r1 = validateJane(fullJane(), { corey: { status: 'OK', bias: 'BEARISH' }, spidey: { status: 'OK', bias: 'BEARISH' }, coreyClone: { status: 'OK' } });
if (r1.status === 'OK') ok('Full Jane → OK'); else fail('Full Jane', JSON.stringify(r1.missingInputs));

console.log('\nT2 — Empty Jane → BLOCKED:');
const r2 = validateJane({});
if (r2.status === 'BLOCKED') ok('Empty Jane → BLOCKED'); else fail('Empty Jane', r2.status);

console.log('\nT3 — Jane weights BLOCKED Corey Clone → flagged:');
const r3 = validateJane(Object.assign({}, fullJane(), { historicalAnalogueWeight: 0.6 }), { coreyClone: { status: 'BLOCKED' } });
if (r3.missingInputs.some(k => /weights_blocked_clone/.test(k))) ok('Weighting BLOCKED clone flagged'); else fail('clone-weight not flagged', JSON.stringify(r3.missingInputs));

console.log('\nT4 — Jane silent on Corey-Spidey conflict → flagged:');
const r4 = validateJane(Object.assign({}, fullJane(), { conflictNotes: '' }), { corey: { status: 'OK', bias: 'BEARISH' }, spidey: { status: 'OK', bias: 'BULLISH' } });
if (r4.missingInputs.some(k => /silent_on_corey_spidey_conflict/.test(k))) ok('Silent Jane on conflict flagged'); else fail('silent conflict not flagged', JSON.stringify(r4.missingInputs));

console.log('\nT5 — Jane without invalidation → PARTIAL:');
const r5 = validateJane(Object.assign({}, fullJane(), { invalidation: '' }));
if (r5.missingInputs.includes('invalidation')) ok('Missing invalidation flagged'); else fail('invalidation', JSON.stringify(r5.missingInputs));

console.log('\nT6 — Jane confidence without basis → flagged:');
const r6 = validateJane(Object.assign({}, fullJane(), { confidenceBasis: '' }));
if (r6.missingInputs.includes('confidenceBasis')) ok('Missing confidenceBasis flagged'); else fail('confidenceBasis', JSON.stringify(r6.missingInputs));

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[ENGINE-JANE-VALIDATION] FAIL'); process.exit(1); }
console.log('[ENGINE-JANE-VALIDATION] PASS');
process.exit(0);
