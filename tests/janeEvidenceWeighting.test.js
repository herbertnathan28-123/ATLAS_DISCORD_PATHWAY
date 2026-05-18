#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Locks the Jane evidence-weighting doctrine (operator brief
// 2026-05-18): no engine wins by volume. Source authority + role
// gating decide tradeViability / actionState, not the number of
// fields / paragraphs / macro-detail strings an engine emits.
//
// Reference: jane.js runJane(input, opts). The per-lane vote at
// jane.js:114-118 + the structure gate at jane.js:95-106 enforce
// authority-based weighting. The tests below prove the five
// fixture scenarios from the operator brief:
//   1. Corey verbose / Spidey weak → no execution authority
//   2. Spidey strong / Corey neutral → bias from Spidey, action respects gate
//   3. Corey Clone BLOCKED → no historical analogue claim; viability capped to MARGINAL
//   4. Spidey no candles → no execution-authorised final state
//   5. Conflicting engines → MONITORING / WAIT

const path = require('path');
const jane = require(path.join(__dirname, '..', 'jane.js'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + JSON.stringify(err).slice(0, 400) : '')); }

// Build a base input shape Jane accepts. testMode=true so the
// Phase-D structure-confidence + analogue-contract gates don't
// fire (those gates are tested separately in their own suites).
function mkInput(over) {
  return Object.assign({
    symbol: 'EURUSD',
    sourceStatus: { spidey: 'ACTIVE', corey: 'ACTIVE', coreyClone: 'ACTIVE', macro: 'ACTIVE' },
    spidey: { status: 'ACTIVE', score: 0.7, confidence: 0.7, structureConfidence: 0.75, structureBias: 'BULL', invalidation: { level: 1.08 }, evidence: [{ ts: 1, note: 'higher high' }] },
    corey:  { score: 0.7, confidence: 0.7, riskModifiers: [] },
    coreyClone: { score: 0.6, confidence: 0.6, validation: { usableForDecision: true } },
    macro:  { score: 0.6, confidence: 0.6, macroIntelligencePacket: { confidenceBasis: 'macro live', dominantMacroTheme: 'risk-on' } },
  }, over || {});
}

async function run() {
  console.log('\nT1 — Corey verbose / Spidey weak: Jane does not authorise execution based on macro density alone:');
  {
    // Verbose Corey carries massive narrative payload + strong score.
    // Spidey is weak (low confidence + no invalidation). Jane must
    // NOT mint VALID just because Corey has more text.
    const huge = 'macro narrative '.repeat(500);
    const input = mkInput({
      sourceStatus: { spidey: 'PARTIAL', corey: 'ACTIVE', coreyClone: 'ACTIVE', macro: 'ACTIVE' },
      spidey: { status: 'PARTIAL', score: 0.3, confidence: 0.2, structureConfidence: 0.20, structureBias: 'NEUTRAL', invalidation: null, evidence: [] },
      corey:  { score: 0.9, confidence: 0.9, riskModifiers: ['CPI', 'NFP', 'FOMC', 'GDP', 'PMI'], narrative: huge, mechanism: huge, why: huge },
    });
    const out = await jane.runJane(input);
    if (out.tradeViability !== 'VALID') ok('tradeViability != VALID despite verbose Corey (got: ' + out.tradeViability + ')');
    else fail('Jane authorised VALID purely from Corey verbosity', { tradeViability: out.tradeViability, marketConfidence: out.marketConfidence });
    if (out.actionState !== 'arm') ok('actionState != arm (got: ' + out.actionState + ')');
    else fail('Jane armed execution despite weak Spidey');
  }

  console.log('\nT2 — Spidey strong / Corey neutral: bias from Spidey, action respects authority gate:');
  {
    const input = mkInput({
      spidey: { status: 'ACTIVE', score: 0.85, confidence: 0.8, structureConfidence: 0.85, structureBias: 'BULL', invalidation: { level: 1.08 }, evidence: [{ ts: 1, note: 'displacement' }] },
      corey:  { score: 0.5, confidence: 0.5, riskModifiers: [] },
    });
    const out = await jane.runJane(input);
    if (out.finalBias === 'long') ok('finalBias is long when Spidey score > 0.55 (structure owns directional truth)');
    else fail('finalBias drift', { finalBias: out.finalBias, spideyScore: 0.85 });
    if (out.structureAlignment === 'Spidey active') ok('structureAlignment reads Spidey active');
    else fail('structureAlignment did not reflect Spidey ACTIVE', out.structureAlignment);
  }

  console.log('\nT3 — Corey Clone BLOCKED: no historical analogue claim, viability capped to MARGINAL:');
  {
    const input = mkInput({
      sourceStatus: { spidey: 'ACTIVE', corey: 'ACTIVE', coreyClone: 'BLOCKED', macro: 'ACTIVE' },
      coreyClone: { score: 0, confidence: 0, validation: { usableForDecision: false }, status: 'BLOCKED' },
    });
    const out = await jane.runJane(input);
    if (out.tradeViability !== 'VALID') ok('tradeViability capped (got: ' + out.tradeViability + ') when Corey Clone is BLOCKED');
    else fail('Jane minted VALID despite Clone BLOCKED');
    if (/not decision-grade|excluded|unavailable/.test(out.historicalAlignment || '')) ok('historicalAlignment honestly reports the historical lane is excluded');
    else fail('historicalAlignment did not flag clone exclusion', out.historicalAlignment);
    if ((out.degradedReason || '').indexOf('historical') !== -1) ok('degradedReason names the historical lane explicitly');
    else fail('degradedReason missing historical exclusion', out.degradedReason);
  }

  console.log('\nT4 — Spidey no candles (PARTIAL no_candles_supplied): no execution-authorised final state:');
  {
    const input = mkInput({
      sourceStatus: { spidey: 'PARTIAL', corey: 'ACTIVE', coreyClone: 'ACTIVE', macro: 'ACTIVE' },
      spidey: { status: 'PARTIAL', score: 0, confidence: 0, structureConfidence: 0, structureBias: 'NEUTRAL', invalidation: null, evidence: [], reason: 'no_candles_supplied' },
    });
    const out = await jane.runJane(input);
    if (out.tradeViability !== 'VALID') ok('tradeViability != VALID when Spidey is PARTIAL no_candles_supplied (got: ' + out.tradeViability + ')');
    else fail('Jane authorised VALID despite Spidey PARTIAL');
    if (out.actionState !== 'arm') ok('actionState != arm — execution authority withheld');
    else fail('Jane armed execution despite Spidey PARTIAL');
    if ((out.structureAlignment || '').indexOf('not active') !== -1 || (out.degradedReason || '').indexOf('structure') !== -1) ok('Jane explicitly reports structure-confirmation incomplete');
    else fail('Jane did not flag structure-confirmation gap', { structureAlignment: out.structureAlignment, degradedReason: out.degradedReason });
  }

  console.log('\nT5 — Conflicting engines: no execution authority unless doctrine resolves:');
  {
    // Spidey says BULL, Corey says BEAR (via opposing riskModifier).
    // Without doctrine-level resolution, Jane should not mint VALID.
    const input = mkInput({
      spidey: { status: 'ACTIVE', score: 0.7, confidence: 0.7, structureConfidence: 0.7, structureBias: 'BULL', invalidation: { level: 1.08 }, evidence: [{ ts: 1, note: 'higher high' }] },
      corey:  { score: 0.3, confidence: 0.7, riskModifiers: ['BEAR'] }, // bearish surprise + high confidence
      coreyClone: { score: 0.2, confidence: 0.7, validation: { usableForDecision: true } }, // historical disagrees
    });
    const out = await jane.runJane(input);
    if (out.tradeViability !== 'VALID') ok('tradeViability != VALID under engine disagreement (got: ' + out.tradeViability + ')');
    else fail('Jane minted VALID despite engine conflict', { setupQuality: out.setupQuality, marketConfidence: out.marketConfidence });
    if (out.conflictSummary) ok('conflictSummary is populated (' + String(out.conflictSummary).slice(0, 80) + '…)');
    else fail('conflictSummary not populated');
  }

  console.log('\nT6 — Source-authority weighting proof: each engine has ONE vote, regardless of payload size:');
  {
    // Two inputs with identical engine activity (3 ACTIVE lanes,
    // 1 PARTIAL) but Corey carries massively more text in one. The
    // aggregate marketConfidence must be identical because Jane
    // does not weight by text.
    const thin  = mkInput({
      sourceStatus: { spidey: 'PARTIAL', corey: 'ACTIVE', coreyClone: 'ACTIVE', macro: 'ACTIVE' },
      corey:  { score: 0.6, confidence: 0.6, riskModifiers: [] },
    });
    const fat = JSON.parse(JSON.stringify(thin));
    fat.corey.narrative = 'lorem '.repeat(2000);
    fat.corey.mechanism = 'lorem '.repeat(2000);
    fat.corey.evidence = Array.from({ length: 50 }, (_, i) => 'evidence-line-' + i);
    const a = await jane.runJane(thin);
    const b = await jane.runJane(fat);
    if (a.marketConfidence === b.marketConfidence && a.setupQuality === b.setupQuality) ok('marketConfidence + setupQuality are identical across thin vs fat Corey (text volume contributes zero weight)');
    else fail('Jane weighting drifted with text volume', { thin: { mc: a.marketConfidence, sq: a.setupQuality }, fat: { mc: b.marketConfidence, sq: b.setupQuality } });
    if (a.tradeViability === b.tradeViability) ok('tradeViability is identical across thin vs fat Corey (no volume override)');
    else fail('tradeViability differs under volume change', { thin: a.tradeViability, fat: b.tradeViability });
  }

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) { console.error('[JANE-EVIDENCE-WEIGHTING] FAIL'); process.exit(1); }
  console.log('[JANE-EVIDENCE-WEIGHTING] PASS');
}

run().catch(e => { console.error('[JANE-EVIDENCE-WEIGHTING] threw: ' + e.message); process.exit(1); });
