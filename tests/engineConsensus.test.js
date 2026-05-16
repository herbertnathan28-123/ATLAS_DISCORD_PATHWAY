#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const { checkEngineConsensus } = require(path.join(__dirname, '..', 'engine', 'validate', 'checkEngineConsensus'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

console.log('\nT1 — All engines OK + same direction → ALIGNED:');
const aligned = checkEngineConsensus({ corey: { status:'OK', bias:'BEARISH' }, spidey: { status:'OK', bias:'BEARISH' }, jane: { status:'OK' }, coreyClone: { status:'OK' } });
if (aligned.state === 'ALIGNED') ok('Aligned consensus'); else fail('Expected ALIGNED', aligned.state);

console.log('\nT2 — Corey vs Spidey direction conflict → CONFLICTED:');
const conflicted = checkEngineConsensus({ corey: { status:'OK', bias:'BEARISH' }, spidey: { status:'OK', bias:'BULLISH' }, jane: { status:'OK' }, coreyClone: { status:'OK' } });
if (conflicted.state === 'CONFLICTED') ok('Conflict detected'); else fail('Expected CONFLICTED', conflicted.state);
if (/monitoring-only/.test(conflicted.narrative)) ok('Conflict narrative uses monitoring-only language'); else fail('narrative missing monitoring-only', conflicted.narrative);

console.log('\nT3 — Critical engine BLOCKED → BLOCKED:');
const blocked = checkEngineConsensus({ corey: { status:'OK', bias:'BEARISH' }, spidey: { status:'BLOCKED' }, jane: { status:'OK' }, coreyClone: { status:'OK' } });
if (blocked.state === 'BLOCKED') ok('Blocked consensus'); else fail('Expected BLOCKED', blocked.state);

console.log('\nT4 — Any PARTIAL without conflict → PARTIAL:');
const partial = checkEngineConsensus({ corey: { status:'PARTIAL', bias:'BEARISH' }, spidey: { status:'OK', bias:'BEARISH' }, jane: { status:'OK' }, coreyClone: { status:'OK' } });
if (partial.state === 'PARTIAL') ok('Partial consensus'); else fail('Expected PARTIAL', partial.state);

console.log('\nT5 — Direction agreement but event-risk mismatch → MIXED:');
const mixed = checkEngineConsensus({ corey: { status:'OK', bias:'BEARISH', eventRisk:'HIGH' }, spidey: { status:'OK', bias:'BEARISH' }, jane: { status:'OK', eventRisk:'MEDIUM' }, coreyClone: { status:'OK' } });
if (mixed.state === 'MIXED') ok('Mixed consensus'); else fail('Expected MIXED', mixed.state);

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[ENGINE-CONSENSUS] FAIL'); process.exit(1); }
console.log('[ENGINE-CONSENSUS] PASS');
process.exit(0);
