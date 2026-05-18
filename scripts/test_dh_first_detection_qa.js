#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_dh_first_detection_qa.js
//
// Focused QA harness for the salvaged in-memory first-detection
// tracker (darkHorseFirstDetection.js).
//
// This harness tests ONLY the tracker module. PR #64 originally
// bundled this with surfaces that have since been absorbed by
// other lanes (scan-boundary NEW badge + visual-learning links
// row are subsumed by PR #74 / ATL-6 territory). Per operator
// cleanup instruction, this salvage carries the tracker module +
// a fresh tracker-only harness, NOT the original combined harness.
//
// Coverage:
//   T1  empty state — getSnapshot returns null for untracked keys
//   T2  track() — first sighting initialises firstDetectedAt /
//       lastSeenAt / scanCycles = 1
//   T3  track() — subsequent sightings increment scanCycles and
//       refresh lastSeenAt; firstDetectedAt is preserved
//   T4  null / falsy guards — track() / getSnapshot() return null
//       on missing symbol or direction
//   T5  symbol+direction composite key — same symbol, different
//       directions track independently
//   T6  trackMany() — bulk tick across an array of records
//   T7  pruneStale() — keys older than staleMs are removed; fresh
//       keys are preserved
//   T8  formatFirstDetectionFragment() — singular vs plural cycle
//       word, elapsed-time scale (sec / min / hr / day)
//   T9  presentation state only — tracker mutation does NOT alter
//       the records passed to trackMany
// ============================================================

const path = require('path');
const fd = require(path.join(__dirname, '..', 'darkHorseFirstDetection.js'));

let passed = 0, failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label, info != null ? '\n     ' + JSON.stringify(info) : ''); }
}

// ─── T1 — empty state ───────────────────────────────────────
console.log('\n[T1] empty state — getSnapshot returns null for untracked keys');
fd._resetForTests();
ok('size() === 0 initially', fd.size() === 0);
ok('getSnapshot returns null when nothing tracked', fd.getSnapshot('EURUSD', 'Bullish') === null);

// ─── T2 — first sighting init ───────────────────────────────
console.log('\n[T2] track() — first sighting initialises tracker state');
fd._resetForTests();
const T2_NOW = Date.parse('2026-05-14T20:35:00Z');
const t2snap = fd.track('EURUSD', 'Bullish', T2_NOW);
ok('returned snapshot is an object', t2snap && typeof t2snap === 'object');
ok('firstDetectedAt === supplied now', t2snap.firstDetectedAt === T2_NOW);
ok('lastSeenAt === supplied now',      t2snap.lastSeenAt === T2_NOW);
ok('scanCycles === 1 on first sighting', t2snap.scanCycles === 1);
ok('getSnapshot returns the same shape', JSON.stringify(fd.getSnapshot('EURUSD', 'Bullish')) === JSON.stringify(t2snap));

// ─── T3 — subsequent sightings ──────────────────────────────
console.log('\n[T3] track() — subsequent sightings increment scanCycles + refresh lastSeenAt');
fd._resetForTests();
const T3_FIRST = Date.parse('2026-05-14T20:00:00Z');
const T3_LATER = Date.parse('2026-05-14T20:15:00Z');
fd.track('EURUSD', 'Bullish', T3_FIRST);
const t3snap = fd.track('EURUSD', 'Bullish', T3_LATER);
ok('firstDetectedAt is preserved across sightings', t3snap.firstDetectedAt === T3_FIRST);
ok('lastSeenAt refreshed to latest sighting',       t3snap.lastSeenAt === T3_LATER);
ok('scanCycles === 2 on second sighting',           t3snap.scanCycles === 2);
const t3third = fd.track('EURUSD', 'Bullish', T3_LATER + 60 * 1000);
ok('scanCycles === 3 on third sighting',            t3third.scanCycles === 3);

// ─── T4 — null / falsy guards ───────────────────────────────
console.log('\n[T4] null / falsy guards');
fd._resetForTests();
ok('track(null, null) returns null',           fd.track(null, null) === null);
ok('track(\'\', \'Bullish\') returns null',    fd.track('', 'Bullish') === null);
ok('track(\'EURUSD\', \'\') returns null',     fd.track('EURUSD', '') === null);
ok('getSnapshot(null, null) returns null',     fd.getSnapshot(null, null) === null);
ok('size() === 0 — no entries written',        fd.size() === 0);

// ─── T5 — composite key behaviour ───────────────────────────
console.log('\n[T5] symbol + direction composite key — bullish and bearish track independently');
fd._resetForTests();
const T5_NOW = Date.parse('2026-05-14T20:00:00Z');
fd.track('EURUSD', 'Bullish', T5_NOW);
fd.track('EURUSD', 'Bearish', T5_NOW + 60 * 1000);
const t5bull = fd.getSnapshot('EURUSD', 'Bullish');
const t5bear = fd.getSnapshot('EURUSD', 'Bearish');
ok('bullish entry exists',         t5bull && t5bull.scanCycles === 1);
ok('bearish entry exists separately', t5bear && t5bear.scanCycles === 1);
ok('two entries, two keys',        fd.size() === 2);
ok('bullish firstDetectedAt distinct from bearish firstDetectedAt',
   t5bull.firstDetectedAt !== t5bear.firstDetectedAt);

// ─── T6 — trackMany bulk tick ───────────────────────────────
console.log('\n[T6] trackMany() — bulk tick across an array of records');
fd._resetForTests();
const T6_NOW = Date.parse('2026-05-14T20:00:00Z');
const records = [
  { symbol: 'EURUSD', direction: 'Bullish' },
  { symbol: 'GBPUSD', direction: 'Bullish' },
  { symbol: 'XAUUSD', direction: 'Bearish' },
];
const snaps = fd.trackMany(records, T6_NOW);
ok('trackMany returns one snapshot per record', Array.isArray(snaps) && snaps.length === 3);
ok('size() === 3 after trackMany',              fd.size() === 3);
ok('every returned snapshot has scanCycles === 1',
   snaps.every(s => s && s.scanCycles === 1));
ok('trackMany of non-array returns empty array',
   Array.isArray(fd.trackMany(null)) && fd.trackMany(null).length === 0);

// ─── T7 — pruneStale ────────────────────────────────────────
console.log('\n[T7] pruneStale() — stale entries removed, fresh entries preserved');
fd._resetForTests();
fd._setStaleMsForTests(60 * 1000); // 60-second staleness window
const T7_FRESH = Date.parse('2026-05-14T20:00:00Z');
const T7_STALE = Date.parse('2026-05-14T19:30:00Z'); // 30 min before fresh
fd.track('EURUSD', 'Bullish', T7_FRESH);
fd.track('GBPUSD', 'Bullish', T7_STALE);
ok('two entries before prune', fd.size() === 2);
fd.pruneStale(T7_FRESH);
ok('one entry after prune',                      fd.size() === 1);
ok('fresh entry survives',                       fd.getSnapshot('EURUSD', 'Bullish') !== null);
ok('stale entry removed',                        fd.getSnapshot('GBPUSD', 'Bullish') === null);

// ─── T8 — formatFirstDetectionFragment ──────────────────────
console.log('\n[T8] formatFirstDetectionFragment() — elapsed scale + singular/plural cycle word');
ok('null snapshot returns null',
   fd.formatFirstDetectionFragment(null, Date.now()) === null);
ok('snapshot missing firstDetectedAt returns null',
   fd.formatFirstDetectionFragment({ lastSeenAt: 1, scanCycles: 1 }, Date.now()) === null);
const T8_BASE = Date.parse('2026-05-14T20:00:00Z');
const t8frag30s  = fd.formatFirstDetectionFragment({ firstDetectedAt: T8_BASE, scanCycles: 1 }, T8_BASE + 30 * 1000);
ok('30-second elapsed reads "30s ago"', /30s ago/.test(t8frag30s));
ok('scanCycles === 1 emits "scan cycle" (singular)', /scan cycle\)/.test(t8frag30s));
const t8frag5m   = fd.formatFirstDetectionFragment({ firstDetectedAt: T8_BASE, scanCycles: 5 }, T8_BASE + 5 * 60 * 1000);
ok('5-minute elapsed reads "5m ago"', /5m ago/.test(t8frag5m));
ok('scanCycles === 5 emits "scan cycles" (plural)', /scan cycles\)/.test(t8frag5m));
const t8frag3h   = fd.formatFirstDetectionFragment({ firstDetectedAt: T8_BASE, scanCycles: 25 }, T8_BASE + (3 * 60 + 15) * 60 * 1000);
ok('3h15m elapsed reads "3h 15m ago"', /3h 15m ago/.test(t8frag3h));
const t8frag2d   = fd.formatFirstDetectionFragment({ firstDetectedAt: T8_BASE, scanCycles: 100 }, T8_BASE + (2 * 24 + 3) * 60 * 60 * 1000);
ok('2d3h elapsed reads "2d 3h ago"', /2d 3h ago/.test(t8frag2d));
ok('UTC stamp format "YYYY-MM-DD HH:MM UTC"', /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(t8frag30s));

// ─── T9 — presentation state only ───────────────────────────
console.log('\n[T9] presentation state only — tracker does NOT mutate caller records');
fd._resetForTests();
const t9records = [
  { symbol: 'EURUSD', direction: 'Bullish', score: 9, movePhase: 'early' },
  { symbol: 'XAUUSD', direction: 'Bearish', score: 8, movePhase: 'mid' },
];
const beforeJson = JSON.stringify(t9records);
fd.trackMany(t9records, Date.now());
fd.trackMany(t9records, Date.now());
const afterJson = JSON.stringify(t9records);
ok('record set unchanged after trackMany (no score/movePhase mutation)', beforeJson === afterJson);

// ─── final ─────────────────────────────────────────────────
console.log('\n==========================');
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed) { console.log('[DH-FIRST-DETECTION-QA] FAIL'); process.exit(1); }
console.log('[DH-FIRST-DETECTION-QA] PASS — in-memory first-detection tracker module (size, key composition, prune, fragment formatting, no caller-record mutation) verified end-to-end.');
