#!/usr/bin/env node
'use strict';

// ============================================================
// scripts/test_dark_horse_foh_terminology.js
//
// Issue #159 — Dark Horse FOH terminology cleanup proof.
// Builds a 0-standout Dark Horse FOH packet, runs it through
// the same viewModel + Discord-text builder used by the live
// dispatch path (renderers/foh/darkHorseV6Shell.js), and
// asserts that:
//   • the banned operator-rejected phrases are absent
//   • the new spec sections (SNAPSHOT / CONDITIONS / READ NOW)
//     are present with concrete what/why/evidence/changes-if
//     copy
//   • the source/provenance line uses trader-facing wording
//     (LAST UPDATED / READ AGE / STILL VALID / NEXT RE-CHECK)
//
// Also runs a 2-standout proof to confirm the non-zero path is
// not broken: standout cards still render, source line still
// uses the new wording, the banned phrases still absent.
//
// Wording-only QA — never touches scanner / scoring / ranking.
// ============================================================

const assert = require('assert');
const { buildDarkHorsePacket } = require('../foh/buildDarkHorsePacket');
const dhViewModel = require('../foh/adapters/darkHorseViewModel');
const { buildDarkHorseDiscordText } = require('../renderers/foh/darkHorseV6Shell');

const BANNED_PHRASES = Object.freeze([
  /🔥 \*\*THE CALL\*\*/,
  /\bTHE CALL\b/,
  /risk basis unavailable/i,
  /\bFRESH cards\b/,
  /freshness: LIVE/,
  /macro tape drives direction/i,
  /No execution priority this cycle/i,
]);

function makeRanking(scoredSymbols) {
  return {
    top10: scoredSymbols.map(s => ({
      symbol: s.symbol,
      score: s.score,
      direction: s.direction || 'long',
      section: s.section || 'EQUITY',
      movePhase: s.movePhase || 'mid',
      summary: s.summary || 'structural alignment with current macro tape',
      decisionLevel: s.decisionLevel || null,
      invalidation: s.invalidation || null,
    })),
    allCount: scoredSymbols.length,
    perSectionCount: {},
    sectionsScanned: ['EQUITY', 'FX'],
    sectionCapsApplied: [],
  };
}

function makeVolatility(level) { return { level: level || 'medium' }; }

function buildLiveViewModel(packet, ranking, opts) {
  // Mirrors the assembly in foh/dispatch/sendDarkHorseFoh.js
  // for fidelity with the live dispatch path.
  const vm = dhViewModel.toViewModel(packet);
  const internalArr = (opts && opts.internal) || [];
  const ignoredArr = (opts && opts.ignored) || [];
  return Object.assign({}, vm, {
    now: opts && opts.now,
    marketsScanned: opts && opts.universeSize != null
      ? opts.universeSize
      : (ranking && ranking.allCount != null ? ranking.allCount : 0),
    marketMood: {
      discs: packet && packet.header && packet.header.severityDiscs,
      label: packet && packet.header && packet.header.riskState,
    },
    standouts: (ranking && ranking.top10 || []).filter(c => c.score >= 7).map(c => ({
      symbol: c.symbol,
      lifecycle: c.movePhase === 'early' ? 'FRESH' : (c.movePhase === 'late' || c.movePhase === 'exhaustion') ? 'FADING' : 'STILL ACTIVE',
      direction: c.direction,
      score: c.score,
    })),
    internalCandidates: internalArr.slice(0, 6).map(c => ({ symbol: c.symbol, score: c.score, section: c.section })),
    internalCount: internalArr.length,
    ignoredCount: ignoredArr.length,
  });
}

function assertNoBanned(text, label) {
  for (const re of BANNED_PHRASES) {
    assert(!re.test(text), '[' + label + '] banned phrase leaked: ' + re);
  }
}

function proofZeroStandout() {
  const label = '0-standout';
  const ranking = makeRanking([
    { symbol: 'EURJPY', score: 5, section: 'FX' },
    { symbol: 'GBPJPY', score: 5, section: 'FX' },
    { symbol: 'GOOGL',  score: 5, section: 'EQUITY' },
  ]);
  // Top10 contains only sub-7 entries, so standouts becomes 0.
  const internal = ranking.top10.slice(); // all watch-band
  const ignored = []; // none below 5 for this fixture
  const volatility = makeVolatility('medium');
  const packet = buildDarkHorsePacket({
    ranking,
    volatility,
    universeSize: 47,
    now: Date.parse('2026-05-19T13:30:00Z'),
  });
  const viewModel = buildLiveViewModel(packet, ranking, {
    universeSize: 47,
    now: Date.parse('2026-05-19T13:32:00Z'),
    internal,
    ignored,
  });
  const text = buildDarkHorseDiscordText(packet, viewModel, {
    now: Date.parse('2026-05-19T13:32:00Z'),
    volatility,
  });

  assertNoBanned(text, label);

  // Required new sections.
  for (const must of [
    '📊 **CURRENT MARKET SNAPSHOT**',
    '🌐 **CURRENT MARKET CONDITIONS**',
    '🎯 **MARKET READ NOW**',
    '🌍 **MARKET IMPACT**',
    '🔗 **SOURCE / PROVENANCE**',
  ]) assert(text.includes(must), '[' + label + '] missing required section header: ' + must);

  // Required trader-facing snapshot fields.
  for (const must of [
    'Dark Horse scan complete · 0 live standouts · 47 markets scanned',
    'LAST UPDATED:',
    'READ AGE:',
    'STILL VALID?:',
    'NEXT RE-CHECK:',
  ]) assert(text.includes(must), '[' + label + '] missing snapshot field: ' + must);

  // Required conditions evidence.
  assert(/Risk state:\s+/.test(text), '[' + label + '] missing Risk state line');
  assert(/Why:\s+/.test(text), '[' + label + '] missing Why line');
  assert(/Evidence: WATCH=0, INTERNAL=3, IGNORED=0/.test(text), '[' + label + '] missing WATCH/INTERNAL/IGNORED evidence');

  // Required read-now contract (what / why / evidence / changes-if).
  assert(/Action state: No live standout this cycle/.test(text), '[' + label + '] missing no-live-standout action state');
  assert(/Why: no symbol cleared the WATCH/.test(text), '[' + label + '] missing why-not-promoting reason');
  assert(/Evidence: .*EURJPY 5\/10.*GBPJPY 5\/10.*GOOGL 5\/10/.test(text), '[' + label + '] missing internal candidate evidence');
  assert(/Changes if: a candidate clears the WATCH threshold/.test(text), '[' + label + '] missing changes-if line');

  // Source / provenance must use trader-facing wording, not "freshness: LIVE".
  assert(/STILL VALID: until next 15-min Dark Horse scan/.test(text), '[' + label + '] source line missing STILL VALID wording');
  assert(/NEXT RE-CHECK: next Dark Horse scan/.test(text), '[' + label + '] source line missing NEXT RE-CHECK wording');
  assert(/source: ATLAS Dark Horse scanner/.test(text), '[' + label + '] source line missing scanner attribution');

  return text;
}

function proofTwoStandouts() {
  const label = '2-standout';
  const ranking = makeRanking([
    { symbol: 'NVDA', score: 9, section: 'EQUITY', direction: 'long',  movePhase: 'early', decisionLevel: '120.00', invalidation: '117.50' },
    { symbol: 'XAUUSD', score: 8, section: 'COMMODITY', direction: 'long', movePhase: 'mid', decisionLevel: '3250.0', invalidation: '3235.0' },
    { symbol: 'EURJPY', score: 5, section: 'FX' },
  ]);
  const internal = [ranking.top10[2]]; // EURJPY
  const ignored = [];
  const volatility = makeVolatility('elevated');
  const packet = buildDarkHorsePacket({
    ranking,
    volatility,
    universeSize: 47,
    now: Date.parse('2026-05-19T13:30:00Z'),
  });
  const viewModel = buildLiveViewModel(packet, ranking, {
    universeSize: 47,
    now: Date.parse('2026-05-19T13:33:00Z'),
    internal,
    ignored,
  });
  const text = buildDarkHorseDiscordText(packet, viewModel, {
    now: Date.parse('2026-05-19T13:33:00Z'),
    volatility,
  });

  assertNoBanned(text, label);

  // Standout cards present.
  assert(text.includes('⭐ **STANDOUTS**'), '[' + label + '] missing STANDOUTS section');
  assert(/NVDA · FRESH · long · score 9\/10/.test(text), '[' + label + '] missing NVDA standout card');
  assert(/XAUUSD · STILL ACTIVE · long · score 8\/10/.test(text), '[' + label + '] missing XAUUSD standout card');

  // Snapshot reflects standout count + WATCH evidence.
  assert(text.includes('2 live standouts · 47 markets scanned'), '[' + label + '] snapshot count wrong');
  assert(/Evidence: WATCH=2, INTERNAL=1, IGNORED=0/.test(text), '[' + label + '] WATCH/INTERNAL/IGNORED evidence wrong');

  // Read-now reflects live-standout state.
  assert(/Action state: 2 live standouts tracked/.test(text), '[' + label + '] action state wrong for 2-standout case');
  assert(/Changes if:/.test(text), '[' + label + '] missing changes-if line');

  return text;
}

function proofScoreSevenIsInternal() {
  // Codex review P1 on PR #160 — when the movement digest has no
  // score-≥8 candidates but a score-7 entry rides through on the
  // viewModel.standouts list (because _liveStandoutsFromRanking
  // widens to score ≥ 7 for the prototype shell card preview), the
  // Discord builder MUST still render the scan as 0-standout /
  // WATCH=0 / NOT promoted. The score-7 candidate belongs in the
  // INTERNAL evidence line.
  const label = 'score-7 internal';
  const ranking = makeRanking([
    { symbol: 'EURJPY', score: 7, section: 'FX', direction: 'long' },
  ]);
  const internal = []; // engine hasn't wired internal[] in this fixture
  const ignored = [];
  const volatility = makeVolatility('medium');
  const packet = buildDarkHorsePacket({
    ranking,
    volatility,
    universeSize: 47,
    now: Date.parse('2026-05-19T13:30:00Z'),
  });
  const viewModel = buildLiveViewModel(packet, ranking, {
    universeSize: 47,
    now: Date.parse('2026-05-19T13:32:00Z'),
    internal,
    ignored,
  });
  // Sanity check the fixture: this is exactly the shape Codex
  // flagged — viewModel.standouts has the score-7 entry, but it is
  // NOT a WATCH-grade candidate.
  assert.strictEqual(viewModel.standouts.length, 1, '[' + label + '] fixture sanity: viewModel.standouts carries the score-7 entry');
  assert.strictEqual(viewModel.standouts[0].score, 7, '[' + label + '] fixture sanity: that entry is score 7');
  const text = buildDarkHorseDiscordText(packet, viewModel, {
    now: Date.parse('2026-05-19T13:32:00Z'),
    volatility,
  });
  assertNoBanned(text, label);
  // 1. Snapshot must read 0 live standouts.
  assert(text.includes('Dark Horse scan complete · 0 live standouts · 47 markets scanned'), '[' + label + '] score-7 entry mis-rendered as live standout in SNAPSHOT');
  // 2. Conditions evidence must read WATCH=0 with the score-7 entry under INTERNAL.
  assert(/Evidence: WATCH=0, INTERNAL=1, IGNORED=0/.test(text), '[' + label + '] WATCH/INTERNAL/IGNORED mis-counted; expected WATCH=0, INTERNAL=1');
  // 3. Read-now must be the no-live-standout block (not the live-tracked block).
  assert(/Action state: No live standout this cycle/.test(text), '[' + label + '] expected "No live standout this cycle" action state for score-7-only scan');
  // 4. Evidence line under MARKET READ NOW must surface the score-7 symbol.
  assert(/Evidence: EURJPY 7\/10/.test(text), '[' + label + '] score-7 EURJPY missing from internal-candidate evidence');
  // 5. No STANDOUTS section — that block only renders when standouts.length > 0.
  assert(!text.includes('⭐ **STANDOUTS**'), '[' + label + '] STANDOUTS section emitted for non-WATCH-grade candidate');
  // 6. Top subtitle must agree with the SNAPSHOT — must NOT say "1 standout".
  assert(/ATLAS · Dark Horse · 0 standouts on this scan/.test(text), '[' + label + '] top subtitle drifted from publication-grade SNAPSHOT');
  // 7. MARKET IMPACT must use the no-live-standout mechanism copy,
  // not the score-≥7 "Standout setups derive from..." string.
  assert(/MARKET IMPACT\*\*\nNo live standout cleared the publication threshold this cycle\./.test(text), '[' + label + '] MARKET IMPACT must show the no-live-standout mechanism for WATCH=0');
  return text;
}

function main() {
  const args = process.argv.slice(2);
  const print = args.includes('--print');
  const zero = proofZeroStandout();
  const two = proofTwoStandouts();
  const seven = proofScoreSevenIsInternal();
  if (print) {
    console.log('========== 0-standout ==========');
    console.log(zero);
    console.log('\n========== 2-standout ==========');
    console.log(two);
    console.log('\n========== score-7 internal ==========');
    console.log(seven);
  }
  console.log('OK — Dark Horse FOH terminology cleanup proven for 0-standout + 2-standout + score-7-internal cases');
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('FAIL ' + e.message); if (e.stack) console.error(e.stack); process.exit(1); }
}

module.exports = { proofZeroStandout, proofTwoStandouts, proofScoreSevenIsInternal, BANNED_PHRASES };
