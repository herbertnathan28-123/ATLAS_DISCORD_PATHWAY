#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Locks the FOH download-control strip at the top of the Dark Horse
// Movement Digest text body. The control strip sits directly under
// the boxed ATLAS report heading so the user sees the PNG / PDF /
// dashboard / glossary state before scrolling past attachments.

const path = require('path');
const rank = require(path.join(__dirname, '..', 'darkHorseRanking'));
const { boxHeader, controlStrip } = require(path.join(__dirname, '..', 'foh', 'headerStrip'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + JSON.stringify(err) : '')); }

function mkRow(symbol, score, bias, section) {
  return {
    symbol, score, bias, section,
    sectionLabel: rank.SECTION_LABEL[section] || section,
    arrow: bias === 'Bullish' ? '⬆️' : '⬇️',
    metrics: { atrPct: 1.2 },
    scoreComponents: { momentum: 3, location: 2, structure: 2 },
  };
}

const ranking = {
  top10: [
    mkRow('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS),
    mkRow('NDX',    8, 'Bullish', rank.SECTIONS.INDICES),
  ],
  sectionsScanned: ['fx_majors', 'indices'],
  sectionCapsApplied: [],
  allCount: 2,
};

console.log('\nT1 — shared headerStrip helpers produce the spec format:');
const sample = boxHeader('🐎 ATLAS · DARK HORSE · MOVEMENT DIGEST');
if (/^╔═{44}╗\n║ 🐎 ATLAS · DARK HORSE · MOVEMENT DIGEST\s+║\n╚═{44}╝$/.test(sample)) ok('boxHeader emits the 44-char ATLAS box treatment with VS16-aware padding');
else fail('boxHeader output drifted', sample);

const strip = controlStrip({ png: 'available', pdf: 'available', dashboard: 'pending', glossary: 'available' });
if (/🖼️ Download PNG: Available\n📄 Download PDF: Available\n🔗 Open Dashboard: Brief Pending\n📘 Expanded Terminology: Available/.test(strip)) ok('controlStrip renders the four-line download control block');
else fail('controlStrip output drifted', strip);

const stripSkipped = controlStrip({ png: 'available', pdf: 'skipped', dashboard: 'pending', glossary: 'available' });
if (/📄 Download PDF: Not generated for this report/.test(stripSkipped)) ok("controlStrip honours 'skipped' → 'Not generated for this report'");
else fail("controlStrip did not emit 'Not generated for this report' for skipped PDF");

console.log('\nT2 — DH Movement Digest leads with the boxed report heading + control strip:');
const payload = rank.buildRankedMovementDigestPayload(ranking, { level: 'elevated', vixLevel: 'Elevated' }, { now: Date.parse('2026-05-18T05:00:00Z') });
const content = payload && payload.content || '';

if (/^╔═+╗\n║ 🐎 ATLAS · DARK HORSE · MOVEMENT DIGEST\s+║\n╚═+╝/.test(content)) ok('content opens with the boxed ATLAS DARK HORSE MOVEMENT DIGEST heading');
else fail('content does not open with the boxed report heading', content.slice(0, 200));

const dhStrip = content.match(/🖼️ Download PNG: ([^\n]+)\n📄 Download PDF: ([^\n]+)\n🔗 Open Dashboard: ([^\n]+)\n📘 Expanded Terminology: ([^\n]+)/);
if (dhStrip) ok('content includes the four-line download control strip directly under the report heading');
else fail('content missing the download control strip', content.slice(0, 400));

if (dhStrip && /Available/.test(dhStrip[1])) ok('PNG strip line declares Available — FOH dispatch always attaches PNGs');
else fail('PNG strip line not Available');
if (dhStrip && /Available/.test(dhStrip[2])) ok('PDF strip line declares Available — FOH dispatch always attaches PDF');
else fail('PDF strip line not Available');
if (dhStrip && /Brief Pending/.test(dhStrip[3])) ok('Open Dashboard strip line is honestly Brief Pending until the public route lands');
else fail('Open Dashboard strip line not Brief Pending');
if (dhStrip && /Available/.test(dhStrip[4])) ok('Expanded Terminology strip line declares Available');
else fail('Expanded Terminology strip line not Available');

const boxIdx = content.indexOf('║ 🐎 ATLAS · DARK HORSE · MOVEMENT DIGEST');
const stripIdx = content.indexOf('🖼️ Download PNG:');
const surfaceIdx = content.indexOf('🐎 **ATLAS · DARK HORSE · FOH OPERATOR SURFACE**');
if (boxIdx >= 0 && stripIdx > boxIdx && surfaceIdx > stripIdx) ok('order: boxed report heading → control strip → existing OPERATOR SURFACE banner');
else fail('top-of-report ordering drifted', { boxIdx, stripIdx, surfaceIdx });

if (/🐎 \*\*ATLAS · DARK HORSE · FOH OPERATOR SURFACE\*\*/.test(content)) ok('legacy OPERATOR SURFACE banner preserved for downstream regressions');
else fail('OPERATOR SURFACE banner removed — would break chunker / education QA');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[DARK-HORSE-HEADER-CONTROLS] FAIL'); process.exit(1); }
console.log('[DARK-HORSE-HEADER-CONTROLS] PASS');
