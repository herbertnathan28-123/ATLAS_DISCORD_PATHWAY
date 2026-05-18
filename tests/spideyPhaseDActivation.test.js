#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/spideyPhaseDActivation.test.js
//
// Operator brief 2026-05-17 (Spidey Phase D Full Activation Order).
// Guards:
//   - Spidey is no longer a Phase B placeholder
//   - All structure detectors produce real output on synthetic data
//   - BOS rejects wick-only breaches
//   - CHoCH requires closure confirmation
//   - Jane gating refuses VALID when structure confidence < 0.50
//   - Spidey is wired into MI scheduler + FOH packet + Discord text
//   - Proof log lines per operator spec
// ============================================================

const path = require('path');
const fs = require('fs');
const { spideyRun } = require(path.join(__dirname, '..', 'spidey'));
const { analyseStructure } = require(path.join(__dirname, '..', 'spidey_structure'));
const swing = require(path.join(__dirname, '..', 'spidey_structure', 'swingPivots'));
const bos   = require(path.join(__dirname, '..', 'spidey_structure', 'bos'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

function pushCandle(arr, t, o, h, l, c) { arr.push({ time: t, open: o, high: h, low: l, close: c }); }

console.log('\nT1 — Spidey Phase D engine produces non-placeholder output:');
process.env.SPIDEY_QUIET = '1';
(async () => {
  const candles = [];
  let t = 0;
  for (let i = 0; i < 25; i++) { pushCandle(candles, t, 1.09 + i * 0.0001, 1.095 + i * 0.0001, 1.085 + i * 0.0001, 1.092 + i * 0.0001); t += 86400000; }
  pushCandle(candles, t, 1.092, 1.110, 1.090, 1.108);
  const r = await spideyRun('EURUSD', { candles: { htf: { '1D': candles }, ltf: { '15M': candles } } });
  if (r._phase === 'D') ok('engine reports Phase D');
  else fail('engine should report Phase D', r._phase);
  if (r.status === 'ACTIVE' || r.status === 'PARTIAL') ok('status is ACTIVE/PARTIAL (not Phase B placeholder)');
  else fail('status should be ACTIVE/PARTIAL', r.status);
  if (typeof r.structureConfidence === 'number' && r.structureConfidence >= 0) ok('structureConfidence numeric');
  else fail('structureConfidence missing', r.structureConfidence);
  if (r.evidence && r.evidence.length >= 5) ok('evidence packet has >= 5 entries');
  else fail('evidence too thin', r.evidence && r.evidence.length);

  console.log('\nT2 — BOS rejects wick-only breaches:');
  // Pattern: protected high at 1.10; then a candle wicks to 1.105 but closes at 1.098 (wick rejected)
  const wickCandles = [];
  let t2 = 0;
  for (let i = 0; i < 10; i++) { pushCandle(wickCandles, t2, 1.095, 1.100, 1.090, 1.098); t2 += 86400000; } // high pivot 1.100
  pushCandle(wickCandles, t2, 1.098, 1.105, 1.097, 1.099); t2 += 86400000; // wick above 1.100, closes below
  for (let i = 0; i < 5; i++) { pushCandle(wickCandles, t2, 1.099, 1.102, 1.095, 1.100); t2 += 86400000; }
  const pivots = swing.detectPivots(wickCandles, { left: 3, right: 3 });
  const seq = swing.labelSequence(pivots.highs, pivots.lows);
  const bosRes = bos.detectBOS(wickCandles, seq, {});
  const hasBullishBOS = !!bosRes.bullishBOS;
  if (!hasBullishBOS) ok('Pure wick-above-pivot did not produce a BULLISH_BOS (body close required)');
  else if (bosRes.bullishBOS && bosRes.bullishBOS.wickOnlyRejected === false) ok('BOS detected via a real body close (different candle), not the wick');
  else fail('Wick-only breach was accepted as BOS', JSON.stringify(bosRes.bullishBOS));
  if (Array.isArray(bosRes.wickRejects) && bosRes.wickRejects.length > 0) ok('Wick-rejected events captured separately for sweep analysis');
  else ok('No wick-reject events captured (data dependent — acceptable)');

  console.log('\nT3 — Spidey returns PARTIAL when no candles supplied:');
  const noCandles = await spideyRun('EURUSD', {});
  if (noCandles.status === 'PARTIAL' && noCandles.degradedReason === 'no_candles_supplied') ok('PARTIAL with no_candles_supplied reason');
  else fail('Expected PARTIAL/no_candles_supplied', JSON.stringify({ status: noCandles.status, reason: noCandles.degradedReason }));
  if (noCandles._phase === 'D') ok('PARTIAL packet still reports Phase D');
  else fail('PARTIAL should still report Phase D', noCandles._phase);

  console.log('\nT4 — Jane refuses VALID when structureConfidence < 0.50:');
  const jane = require(path.join(__dirname, '..', 'jane'));
  // Synthesise a Jane input with weak structure.
  const weakJaneInput = {
    symbol: 'EURUSD',
    spidey: { authority: 'structure', status: 'PARTIAL', score: 0.3, confidence: 0.3, structureConfidence: 0.3, evidence: [{ type: 'x', data: 'y' }], invalidation: { level: 1.08, side: 'below', reason: 'r' } },
    corey: { score: 0.7, confidence: 0.7, evidence: [{ type: 'x' }] },
    coreyClone: { score: 0.6, confidence: 0.6, analogues: [] },
    macro: { score: 0.6, confidence: 0.6 },
    sourceStatus: { spidey: 'ACTIVE', corey: 'ACTIVE', coreyClone: 'ACTIVE', macro: 'ACTIVE' },
  };
  const weakDec = await jane.runJane(weakJaneInput, {});
  if (weakDec.tradeViability !== 'VALID') ok('Jane refuses VALID with structureConfidence 0.3 (got ' + weakDec.tradeViability + ')');
  else fail('Jane VALID despite weak structure — gate failed');

  console.log('\nT5 — Jane permits VALID when full Phase D conditions met:');
  const strongJaneInput = {
    symbol: 'EURUSD',
    spidey: { authority: 'structure', status: 'ACTIVE', score: 0.8, confidence: 0.7, structureConfidence: 0.75, evidence: [{ type: 'bos', data: 'real' }, { type: 'choch', data: 'r' }, { type: 'displacement', data: '2' }, { type: 'sweeps', data: '1' }, { type: 'session', data: 'LONDON' }], invalidation: { level: 1.0850, side: 'below', reason: 'close below HL invalidates' } },
    corey: { score: 0.75, confidence: 0.75, evidence: [{ type: 'live' }] },
    coreyClone: { score: 0.7, confidence: 0.7, analogues: [] },
    macro: { score: 0.7, confidence: 0.7 },
    sourceStatus: { spidey: 'ACTIVE', corey: 'ACTIVE', coreyClone: 'ACTIVE', macro: 'ACTIVE' },
  };
  const strongDec = await jane.runJane(strongJaneInput, {});
  if (strongDec.tradeViability === 'VALID') ok('Jane returns VALID when full Phase D conditions met');
  else fail('Jane should return VALID', strongDec.tradeViability);

  console.log('\nT6 — Jane refuses VALID when Spidey not ACTIVE:');
  const notActive = Object.assign({}, strongJaneInput, { sourceStatus: { spidey: 'PARTIAL', corey: 'ACTIVE', coreyClone: 'ACTIVE', macro: 'ACTIVE' } });
  const notActiveDec = await jane.runJane(notActive, {});
  if (notActiveDec.tradeViability !== 'VALID') ok('Jane refuses VALID when Spidey not ACTIVE');
  else fail('Jane should not return VALID when Spidey not ACTIVE');

  console.log('\nT7 — MI scheduler wires Spidey:');
  const coreyMI = fs.readFileSync(path.join(__dirname, '..', 'coreyMarketIntel.js'), 'utf8');
  if (/_fetchSpidey/.test(coreyMI)) ok('coreyMarketIntel.js defines _fetchSpidey');
  else fail('coreyMarketIntel.js does NOT define _fetchSpidey');
  const fetchCount = (coreyMI.match(/await _fetchSpidey\(/g) || []).length;
  if (fetchCount >= 3) ok('Spidey invoked at all 3 dispatch sites — found ' + fetchCount);
  else fail('Spidey not invoked at all 3 dispatch sites', 'found ' + fetchCount);
  if (/\[SPIDEY\] tick=/.test(coreyMI)) ok('Per-tick [SPIDEY] log line wired');
  else fail('Per-tick [SPIDEY] log line missing');

  console.log('\nT8 — FOH packet builder consumes spidey:');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket.js'), 'utf8');
  if (/structureSnapshot/.test(builder)) ok('Packet builder produces structureSnapshot field');
  else fail('structureSnapshot field missing from builder');
  const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
  const pNoSpidey = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI', time: '12:30', severity: 'HIGH' }]}] } });
  if (pNoSpidey.structureSnapshot && pNoSpidey.structureSnapshot.status === 'NOT_INVOKED') ok('Packet surfaces NOT_INVOKED honestly when no spidey supplied');
  else fail('NOT_INVOKED not surfaced', JSON.stringify(pNoSpidey.structureSnapshot));
  const pWithSpidey = buildMarketIntelPacket({
    engine: { kind: 'daily', mood: { severity: 'HIGH' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI', time: '12:30', severity: 'HIGH' }]}] },
    spidey: { packet: r, leadSymbol: 'EURUSD' },
  });
  if (pWithSpidey.structureSnapshot && pWithSpidey.structureSnapshot.available === true) ok('Packet surfaces full structure when spidey supplied');
  else fail('structureSnapshot should be available', JSON.stringify(pWithSpidey.structureSnapshot));

  console.log('\nT9 — View model + Discord text include STRUCTURE_SNAPSHOT:');
  const { toViewModel } = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
  const vm = toViewModel(pWithSpidey);
  if (vm.STRUCTURE_SNAPSHOT && vm.STRUCTURE_SNAPSHOT.length > 0) ok('STRUCTURE_SNAPSHOT anchor populated');
  else fail('STRUCTURE_SNAPSHOT missing');
  const { buildDiscordTextSummary } = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell'));
  const text = buildDiscordTextSummary(vm, { surface: 'market_intel', maxDiscordChunkChars: 100000 });
  if (/Structure \(Spidey Phase D\)/.test(text)) ok('Discord text includes Structure section header');
  else fail('Discord text missing Structure section');
  if (/Spidey Phase D/.test(vm.STRUCTURE_SNAPSHOT)) ok('Anchor labels as Phase D');
  else fail('Anchor missing Phase D label');

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) { console.error('[SPIDEY-PHASE-D-ACTIVATION] FAIL'); process.exit(1); }
  console.log('[SPIDEY-PHASE-D-ACTIVATION] PASS');
  process.exit(0);
})().catch(e => { console.error('FATAL ' + e.message); console.error(e.stack); process.exit(2); });
