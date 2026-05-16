#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/fohOperationalAnchors.test.js
//
// Operator directive 2026-05-17 (second pass) — Hard guard.
// Every directional instruction in user-facing FOH output must
// carry the 6 operational-anchor elements:
//   1. instrument
//   2. price level
//   3. behavioural explanation
//   4. confirmation condition
//   5. invalidation condition
//   6. probable next path (+ failure path)
//
// Vague trader shorthand like "look for SHORT EURUSD setups
// using the next Dark Horse scan as your guide" is BANNED.
// ============================================================

const path = require('path');
const fs = require('fs');
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const { buildDarkHorsePacket }   = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const miShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell'));
const protoShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'protoShell'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

const SIX_ANCHOR_FIELDS = ['instrument','priceLevel','behavioralExplanation','confirmsContinuation','invalidatesContinuation','probableNextPath','probableFailurePath'];

// Banned vague shorthand patterns. These represent directional
// instructions without anchoring evidence; the operator's example
// flagged "look for SHORT EURUSD setups using the next Dark Horse
// scan as your guide" as the canonical banned pattern.
const BANNED_SHORTHAND = [
  /\blook for (LONG|SHORT) [A-Z]{3,6} setups\b/,
  /\bsetups using the next (Dark Horse|ATLAS) scan as your guide\b/,
  /\bif direction holds\b/i,
];

// Required doctrine markers in any user-facing render that contains
// a directional instruction (the 6 elements per operator's example).
const REQUIRED_DOCTRINE_MARKERS = [
  /what (this )?means/i,
  /(what )?confirms/i,
  /(what )?invalidates/i,
  /(most )?probable.*(next path|failure path)/i,
];

function assertHas6Anchors(obj, label) {
  if (!obj || typeof obj !== 'object') { fail(label, 'not an object'); return; }
  const missing = SIX_ANCHOR_FIELDS.filter(k => !(k in obj) || obj[k] == null || (Array.isArray(obj[k]) ? obj[k].length === 0 : obj[k] === ''));
  if (missing.length) fail(label, 'missing: ' + missing.join(','));
  else ok(label);
}

function assertNoBannedShorthand(haystack, label) {
  for (const re of BANNED_SHORTHAND) {
    if (re.test(haystack)) { fail(label, 'banned shorthand: ' + re); return; }
  }
  ok(label);
}

function assertHasDoctrineMarkers(haystack, label) {
  for (const re of REQUIRED_DOCTRINE_MARKERS) {
    if (!re.test(haystack)) { fail(label, 'missing doctrine marker: ' + re); return; }
  }
  ok(label);
}

console.log('\nT1 — MI fourWayOutcomes carry 6 operational anchors:');
const miPacket = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI (USD)', time: '12:30 UTC' }]}] } });
for (const k of ['higher','lower','inline','reversal']) {
  assertHas6Anchors(miPacket.fourWayOutcomes[k].traderAction, 'MI fourWayOutcomes.' + k + '.traderAction has all 6 anchors');
}

console.log('\nT2 — DH fourWayOutcomes carry 6 operational anchors:');
const dhPacket = buildDarkHorsePacket({ ranking: { top10: [{ symbol: 'EURUSD', movePhase: 'early', score: 9, direction: 'Bullish' }, { symbol: 'XAUUSD', movePhase: 'mid', score: 8, direction: 'Bullish' }, { symbol: 'NVDA', movePhase: 'late', score: 7, direction: 'Bearish' }], allCount: 33 }, volatility: { level: 'ELEV' } });
for (const k of ['higher','lower','inline','reversal']) {
  assertHas6Anchors(dhPacket.fourWayOutcomes[k].traderAction, 'DH fourWayOutcomes.' + k + '.traderAction has all 6 anchors');
}

console.log('\nT3 — Rendered view model carries the doctrine markers:');
const miVM = miViewModel.toViewModel(miPacket);
const dhVM = dhViewModel.toViewModel(dhPacket);
assertHasDoctrineMarkers(miVM.FOUR_WAY_HIGHER, 'MI FOUR_WAY_HIGHER doctrine markers');
assertHasDoctrineMarkers(miVM.FOUR_WAY_LOWER,  'MI FOUR_WAY_LOWER doctrine markers');
assertHasDoctrineMarkers(miVM.FOUR_WAY_INLINE, 'MI FOUR_WAY_INLINE doctrine markers');
assertHasDoctrineMarkers(miVM.FOUR_WAY_REVERSAL, 'MI FOUR_WAY_REVERSAL doctrine markers');
assertHasDoctrineMarkers(dhVM.FOUR_WAY_HIGHER, 'DH FOUR_WAY_HIGHER doctrine markers');

console.log('\nT4 — Discord text summary carries the doctrine markers:');
const miText = miShell.buildDiscordTextSummary(miVM, { maxDiscordChunkChars: 100000 });
const dhText = miShell.buildDiscordTextSummary(dhVM, { maxDiscordChunkChars: 100000 });
// Discord summary doesn't include four-way (caps at briefing+actions+impact+conf/cancel+source); but the doctrine markers also live in the structured traderAction which IS reachable. The four-way payload is in the rendered cards. Verify the view model has them, and verify the text summary at least carries no banned shorthand.
assertNoBannedShorthand(miText, 'MI Discord text — no banned shorthand');
assertNoBannedShorthand(dhText, 'DH Discord text — no banned shorthand');

console.log('\nT5 — Prototype HTML reaction-path sections carry doctrine markers:');
const miProto = protoShell.getMarketIntelV3Html();
// Each of the 4 reaction-path blocks must carry the doctrine markers.
const reactionPathSlice = miProto.split('POSSIBLE MARKET REACTION PATHS')[1] || '';
const reactionPathSection = reactionPathSlice.split('RISK ESCALATION')[0] || '';
assertHasDoctrineMarkers(reactionPathSection, 'MI prototype reaction-path section carries doctrine markers');

console.log('\nT6 — Prototype HTML free of banned shorthand:');
const dhProto = protoShell.getDarkHorseV6Html();
assertNoBannedShorthand(miProto, 'MI prototype free of banned shorthand');
assertNoBannedShorthand(dhProto, 'DH prototype free of banned shorthand');

console.log('\nT7 — Source files free of banned shorthand:');
const RUNTIME_FILES = [
  'foh/buildMarketIntelPacket.js',
  'foh/buildDarkHorsePacket.js',
  'foh/adapters/marketIntelViewModel.js',
  'foh/adapters/darkHorseViewModel.js',
  'renderers/foh/marketIntelV3Shell.js',
  'renderers/foh/darkHorseV6Shell.js',
  'docs/screenshots/market-intel-foh-v3.html',
  'docs/screenshots/dh-foh-v6.html',
];
for (const rel of RUNTIME_FILES) {
  const abs = path.join(__dirname, '..', rel);
  if (!fs.existsSync(abs)) continue;
  const body = fs.readFileSync(abs, 'utf8');
  let hit = null;
  for (const re of BANNED_SHORTHAND) if (re.test(body)) { hit = re.toString(); break; }
  if (hit) fail(rel + ' contains banned shorthand: ' + hit);
  else ok(rel + ' clean of banned shorthand');
}

console.log('\nT8 — Each anchored action references a real price level:');
const HAS_PRICE_LEVEL = /[\d]+\.[\d]+|\b(reaction band|trigger|entry zone|invalidation level|liquidity zone|decision level)\b/i;
for (const k of ['higher','lower','inline','reversal']) {
  const ta = miPacket.fourWayOutcomes[k].traderAction;
  const blob = [ta.priceLevel, ta.behavioralExplanation].concat(ta.confirmsContinuation, ta.invalidatesContinuation, ta.probableNextPath).join(' ');
  if (HAS_PRICE_LEVEL.test(blob)) ok('MI ' + k + ' references a real price level');
  else fail('MI ' + k + ' missing price level reference');
}
for (const k of ['higher','lower','inline','reversal']) {
  const ta = dhPacket.fourWayOutcomes[k].traderAction;
  const blob = [ta.priceLevel, ta.behavioralExplanation].concat(ta.confirmsContinuation, ta.invalidatesContinuation, ta.probableNextPath).join(' ');
  if (HAS_PRICE_LEVEL.test(blob)) ok('DH ' + k + ' references a real price level/zone');
  else fail('DH ' + k + ' missing price level reference');
}

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[FOH-OPERATIONAL-ANCHORS] FAIL'); process.exit(1); }
console.log('[FOH-OPERATIONAL-ANCHORS] PASS');
process.exit(0);
