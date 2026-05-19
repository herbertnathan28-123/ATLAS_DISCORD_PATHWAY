'use strict';

const assert = require('assert');
const glossary = require('../macro/glossary');
const probability = require('../macro/probabilityLabelling');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('glossary exposes the active macro API shape', () => {
  assert.ok(glossary.TERMS);
  assert.strictEqual(typeof glossary.lookup, 'function');
  assert.strictEqual(typeof glossary.footer, 'function');
  assert.strictEqual(typeof glossary.termLink, 'function');
});

test('BOS internal tag surfaces only as Structure Break', () => {
  assert.match(glossary.lookup('BOS'), /^\[Structure Break\]/);
  assert.doesNotMatch(glossary.lookup('BOS'), /^BOS\b/);
});

test('CHoCH internal tag surfaces as plain-English reversal wording', () => {
  assert.match(glossary.lookup('CHoCH'), /^\[Trend Shift\]/);
  assert.doesNotMatch(glossary.lookup('CHoCH'), /^CHoCH\b/);
});

test('verified two-way values keep explicit derivation labels', () => {
  const labelled = probability.labelFourWayProbabilities({
    probabilities: { above: 62, below: 38 },
    basis: { above: 'historical', below: 'engine-derived' }
  });

  assert.deepStrictEqual(labelled.above, { value: 62, label: 'historically sourced' });
  assert.deepStrictEqual(labelled.below, { value: 38, label: 'engine-derived' });
});

test('in-line and reversal stay pending without historical evidence', () => {
  const labelled = probability.labelFourWayProbabilities({
    probabilities: { above: 55, below: 45, inLine: 10, reversal: 20 },
    basis: { above: 'formula-derived', below: 'formula-derived', inLine: 'engine-derived', reversal: 'formula-derived' }
  });

  assert.deepStrictEqual(labelled.inLine, { value: null, label: 'pending historical validation' });
  assert.deepStrictEqual(labelled.reversal, { value: null, label: 'pending historical validation' });
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try {
    t.fn();
    passed += 1;
    console.log(`PASS ${t.name}`);
  } catch (err) {
    failures.push({ name: t.name, err });
    console.error(`FAIL ${t.name}: ${err.message}`);
  }
}

console.log('==========================');
console.log(`Passed: ${passed} Failed: ${failures.length}`);
console.log(failures.length ? '[MI-MACRO-PARITY-QA] FAIL' : '[MI-MACRO-PARITY-QA] PASS');
if (failures.length) process.exit(1);
