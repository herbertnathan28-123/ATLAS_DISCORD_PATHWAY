#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Locks the CURRENT ADVICE — AT RELEASE block on every Dark Horse
// standout card (operator brief 2026-05-18). The block must sit
// directly under the boxed candidate header so the trader sees
// the actionable answer before any setup theory.

const path = require('path');
const rank = require(path.join(__dirname, '..', 'darkHorseRanking'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + JSON.stringify(err).slice(0, 240) : '')); }

function mkRow(symbol, score, bias, section, opts) {
  opts = opts || {};
  return {
    symbol, score, bias, section, direction: bias,
    sectionLabel: rank.SECTION_LABEL[section] || section,
    arrow: bias === 'Bullish' ? '⬆️' : '⬇️',
    metrics: { atrPct: 1.2 },
    scoreComponents: { momentum: 3, location: 2, structure: 2 },
    movePhase: opts.phase || 'developing',
    evidenceAnchors: opts.anchors || null,
  };
}

console.log('\nT1 — every standout card carries a CURRENT ADVICE — AT RELEASE block right under the header:');
const ranking = {
  top10: [
    mkRow('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, {
      phase: 'developing',
      anchors: {
        recentHigh:   { priceText: '1.0925' },
        recentLow:    { priceText: '1.0870' },
        invalidation: { priceText: '1.0840' },
      },
    }),
    mkRow('USDJPY', 8, 'Bearish', rank.SECTIONS.FX_MAJORS, {
      phase: 'late',
      anchors: {
        recentHigh:   { priceText: '155.20' },
        recentLow:    { priceText: '154.10' },
        invalidation: { priceText: '155.85' },
      },
    }),
  ],
  sectionsScanned: ['fx_majors'],
  sectionCapsApplied: [],
  allCount: 2,
};

const payload = rank.buildRankedMovementDigestPayload(ranking, { level: 'elevated', vixLevel: 'Elevated' }, { now: Date.parse('2026-05-18T12:00:00Z') });
const content = payload && payload.content || '';

// Block must appear once per candidate card.
const adviceBoxes = content.match(/⚡ CURRENT ADVICE — AT RELEASE/g) || [];
if (adviceBoxes.length === 2) ok('CURRENT ADVICE — AT RELEASE block appears once per candidate card');
else fail('expected 2 CURRENT ADVICE blocks (one per card), got ' + adviceBoxes.length);

// Block must sit before the WHAT HAPPENED section on each card.
const adviceIdx = content.indexOf('⚡ CURRENT ADVICE — AT RELEASE');
const whatHappenedIdx = content.indexOf('📍 **WHAT HAPPENED**');
if (adviceIdx >= 0 && adviceIdx < whatHappenedIdx) ok('CURRENT ADVICE block sits BEFORE the WHAT HAPPENED section (action-first ordering)');
else fail('CURRENT ADVICE block did not lead the card body', { adviceIdx, whatHappenedIdx });

console.log('\nT2 — all 15 required fields are emitted on every card:');
const REQUIRED_FIELDS = [
  '🟧 **Advice State:**',
  '🟩 **Direction:**',
  '🟩 **Entry Zone:**',
  '🟨 **Entry Window:**',
  '🟨 **Entry Validation:**',
  '🟥 **Stop / Invalidation:**',
  '🟧 **Extended Stop:**',
  '🎯 **First Target:**',
  '🟧 **Risk Cap:**',
  '🟦 **Minimum ATLAS Buffer:**',
  '🟦 **Technical Distance:**',
  '🟪 **Next Review:**',
  '⛔ **Do Not Enter If:**',
  '📷 **Visual Example:**',
  '**INSTANT ADVICE:**',
];
for (const field of REQUIRED_FIELDS) {
  const hits = content.split(field).length - 1;
  if (hits === 2) ok('field present on both cards: ' + field);
  else fail('field count drift: ' + field, hits);
}

console.log('\nT3 — Entry Zone + Stop pull from evidenceAnchors when published:');
if (/🟩 \*\*Entry Zone:\*\*\n1\.0870 – 1\.0925/.test(content)) ok('EURUSD entry zone reads its evidenceAnchors band');
else fail('EURUSD entry zone did not source from evidenceAnchors');
if (/🟥 \*\*Stop \/ Invalidation:\*\*\n1\.0840/.test(content)) ok('EURUSD stop / invalidation reads its evidenceAnchors level');
else fail('EURUSD stop did not source from evidenceAnchors');

console.log('\nT4 — Direction maps Bullish→Long / Bearish→Short:');
if (/🟩 \*\*Direction:\*\*\nLong/.test(content)) ok('Bullish row renders as Direction: Long');
else fail('Bullish row direction mapping drifted');
if (/🟩 \*\*Direction:\*\*\nShort/.test(content)) ok('Bearish row renders as Direction: Short');
else fail('Bearish row direction mapping drifted');

console.log('\nT5 — Risk Cap is account-percentage based (no dollar figures from hidden contracts):');
if (/🟧 \*\*Risk Cap:\*\*\n0\.50% of account equity/.test(content)) ok('developing-phase risk cap = 0.50% of account equity');
else fail('developing-phase risk cap mapping drifted');
if (/🟧 \*\*Risk Cap:\*\*\n0\.25% of account equity \(late-stage card\)/.test(content)) ok('late-phase risk cap = 0.25% of account equity (late-stage card)');
else fail('late-phase risk cap mapping drifted');
if (/Suggested account-based risk \(dollars first/.test(content)) ok('account-relative risk panel is emitted (replaces legacy $72,125 figures)');
else fail('account-relative risk panel missing');
if (/\$1,000 account:\s+0\.25% = \$2\.50/.test(content)) ok('risk panel includes $1,000 account row');
else fail('risk panel $1,000 account row missing');

console.log('\nT6 — Late-stage card uses single-stop discipline (Extended Stop = Not used):');
if (/🟧 \*\*Extended Stop:\*\*\nNot used — late-stage card/.test(content)) ok('late-stage Extended Stop = Not used');
else fail('late-stage Extended Stop did not honour single-stop discipline');

console.log('\nT7 — INSTANT ADVICE softens BUY/SELL command wording:');
const instantAdviceLines = content.match(/\*\*INSTANT ADVICE:\*\* [^\n]+/g) || [];
if (instantAdviceLines.length === 2) ok('two INSTANT ADVICE lines (one per card)');
else fail('INSTANT ADVICE line count drift', instantAdviceLines.length);
const adviceJoined = instantAdviceLines.join(' | ');
if (!/\b(buy now|sell now|enter now|full size)\b/i.test(adviceJoined)) ok('INSTANT ADVICE contains no command-style "buy now / sell now / enter now / full size" wording');
else fail('INSTANT ADVICE leaked command-style wording', adviceJoined);
if (/Conditional|Wait|Observation|Do not enter yet/.test(adviceJoined)) ok('INSTANT ADVICE uses approved defensive wording (Conditional / Wait / Observation / Do not enter yet)');
else fail('INSTANT ADVICE missing the approved defensive wording family');

console.log('\nT8 — Box header is amber-coloured per the operator heading doctrine:');
const ansiAdviceIdx = content.indexOf('```ansi');
const adviceColorChunk = content.slice(0, adviceIdx);
if (/\[1;33m[^\n]*╔[^\n]*\n[^\n]*║ ⚡ CURRENT ADVICE — AT RELEASE/.test(content)) ok('CURRENT ADVICE box renders amber (ANSI 33 / yellow-bright family per the operator spec)');
else fail('CURRENT ADVICE box header colour did not render amber');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[DARK-HORSE-CURRENT-ADVICE] FAIL'); process.exit(1); }
console.log('[DARK-HORSE-CURRENT-ADVICE] PASS');
