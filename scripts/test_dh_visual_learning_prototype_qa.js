'use strict';
// QA harness — Dark Horse Visual Learning Prototype (Lane 2)
//
// Covers the three operator-directed surfaces:
//   (A) Top-of-output "Learn:" links row routed into the deep
//       glossary via the Lane 1 Visual Pattern Library — fires only
//       when the digest carries a Bearish candidate (LH/LL route).
//   (B) First-detection trend-age scaffolding — when moveAge=0/null,
//       plainTrendAge appends "first detected <UTC> (<elapsed>,
//       tracked across N scan cycles)" using a presentation-only
//       in-memory tracker.
//   (C) Stronger 🔴 red-bordered scan boundary with a 🆕 NEW badge,
//       replacing the v1.1 thin double-line boundary.
//
// Hard boundaries verified:
//   - The tracker is presentation-only; ranking score / direction /
//     phase / moveSpeed / moveAge inputs are NOT touched.
//   - Bullish-only and monitoring-only digests DO NOT carry the
//     bearish-route learning row.
//   - Chunker still places the entire boundary + learning row on
//     Part 1 only.

const path = require('path');
const rank   = require(path.join('..', 'darkHorseRanking'));
const engine = require(path.join('..', 'darkHorseEngine'));
const fd     = require(path.join('..', 'darkHorseFirstDetection'));
const vpl    = require(path.join('..', 'visualPatternLibrary'));

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else {
    failed++; failures.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? '  → ' + JSON.stringify(detail) : ''}`);
  }
}

function section(t) { console.log(`\n[${t}]`); }

// ----------------------------------------------------------------
// Fixture builders
// ----------------------------------------------------------------

function daily(n, base) {
  const out = [];
  let p = base;
  const t0 = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
  for (let i = 0; i < n; i++) {
    const o = p, c = p + 0.6, h = c + 0.4, l = o - 0.3;
    out.push({ open: o, high: h, low: l, close: c, time: t0 + i * 86400 });
    p = c;
  }
  return out;
}

function mkRow(symbol, score, dir, sec) {
  return Object.assign(
    rank.enrichCandidate(
      { symbol, score, direction: dir, summary: 'higher highs and higher lows', reasons: ['structure 2/2'] },
      daily(25, score * 4 + 1),
      6, { watchThreshold: 8 }
    ),
    { section: sec, sectionLabel: rank.SECTION_LABEL[sec] }
  );
}

const NOW = Date.parse('2026-05-12T18:01:00Z');

// ----------------------------------------------------------------
// T1 — Stronger scan boundary (visual + content)
// ----------------------------------------------------------------
section('T1 — Scan boundary (Lane 2 redesign)');

const boundary = rank.buildNewScanBoundary(NOW);
ok('boundary uses 🔴 red-bordered separator (top + bottom)', (boundary.match(/🔴━+🔴/g) || []).length === 2);
ok('boundary still embeds ━ horizontal-bar string (chunker compat)', /━━━━━━━━━━━━━━━━━━━━/.test(boundary));
ok('boundary header carries 🆕 NEW badge', /🆕 /.test(boundary));
ok('boundary header still contains "NEW DARK HORSE SCAN"', /🐎 \*\*NEW DARK HORSE SCAN\*\*/.test(boundary));
ok('boundary header has 🆕 immediately before 🐎', /🆕 🐎 \*\*NEW DARK HORSE SCAN\*\*/.test(boundary));
ok('boundary carries UTC + AWST scan-time line', /Scan time: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC \/ \d{4}-\d{2}-\d{2} \d{2}:\d{2} AWST/.test(boundary));
ok('boundary is exactly 4 lines', boundary.split('\n').length === 4);

// ----------------------------------------------------------------
// T2 — Bearish-route learning links row
// ----------------------------------------------------------------
section('T2 — Visual-learning links row (bearish LH/LL route)');

const bearishRanking = {
  top10: [
    mkRow('EURUSD', 8, 'Bearish', rank.SECTIONS.FX_MAJORS),
    mkRow('XAUUSD', 7, 'Bearish', rank.SECTIONS.COMMODITIES),
  ],
  sectionsScanned: ['fx_majors', 'commodities'],
  sectionCapsApplied: [], allCount: 2,
};
const bearishOpts = { internal: [], ignored: [], universeSize: 33, now: NOW };

const bearishRow = rank.buildVisualLearningLinksRow(bearishRanking, bearishOpts);
ok('bearish present — row is non-empty', typeof bearishRow === 'string' && bearishRow.length > 0);
ok('row begins with 📘 Learn: prefix', /^📘 Learn: /.test(bearishRow));
ok('row links to Lower High / Lower Low', /\[Lower High \/ Lower Low\]\(#lh-ll\)/.test(bearishRow));
ok('row links to BOS', /\[Break of Structure\]\(#bos\)/.test(bearishRow));
ok('row links to Liquidity Sweep', /\[Liquidity Sweep\]\(#liquidity-sweep\)/.test(bearishRow));
ok('row links to Failed Retest', /\[Failed Retest\]\(#failed-retest\)/.test(bearishRow));
ok('row is single-line (no newlines)', !bearishRow.includes('\n'));
ok('row uses Lane 1 default anchor-slug form (#<slug>)', /\(#[a-z-]+\)/.test(bearishRow));

// Bearish in internal pool ONLY (not in top10) still triggers the row —
// supports the "developing standout" case where bearish has not yet
// crossed into top10.
const bearishOnlyInInternal = {
  top10: [],
  sectionsScanned: [], sectionCapsApplied: [], allCount: 0,
};
const bearishInInternalOpts = {
  internal: [mkRow('AUDUSD', 6, 'Bearish', rank.SECTIONS.FX_MAJORS)],
  ignored: [], universeSize: 33, now: NOW,
};
ok('row fires when bearish is only in the internal pool',
   rank.buildVisualLearningLinksRow(bearishOnlyInInternal, bearishInInternalOpts).length > 0);

// ----------------------------------------------------------------
// T3 — Bullish-only and monitoring-only do NOT trigger the row
// ----------------------------------------------------------------
section('T3 — Bullish-only / monitoring-only suppression');

const bullishOnly = {
  top10: [
    mkRow('NDX',  8, 'Bullish', rank.SECTIONS.INDICES),
    mkRow('NVDA', 8, 'Bullish', rank.SECTIONS.EQUITIES),
  ],
  sectionsScanned: ['indices', 'equities'], sectionCapsApplied: [], allCount: 2,
};
ok('bullish-only top10 → no learning row',
   rank.buildVisualLearningLinksRow(bullishOnly, { internal: [], ignored: [], universeSize: 33, now: NOW }) === '');

const monitoringOnly = {
  top10: [], sectionsScanned: [], sectionCapsApplied: [], allCount: 0,
};
ok('monitoring-only (no candidates) → no learning row',
   rank.buildVisualLearningLinksRow(monitoringOnly, { internal: [], ignored: [], universeSize: 33, now: NOW }) === '');

// Predicate guards
ok('_digestHasBearish detects top10 bearish', rank._digestHasBearish(bearishRanking, bearishOpts) === true);
ok('_digestHasBearish rejects bullish-only top10', rank._digestHasBearish(bullishOnly, { internal: [], ignored: [], universeSize: 33, now: NOW }) === false);
ok('_digestHasBullish detects top10 bullish', rank._digestHasBullish(bullishOnly, { internal: [], ignored: [], universeSize: 33, now: NOW }) === true);

// ----------------------------------------------------------------
// T4 — firstChunkPrefix wiring (boundary + learning row together)
// ----------------------------------------------------------------
section('T4 — firstChunkPrefix wiring (Part 1 only)');

const bearishPayload = rank.buildRankedMovementDigestPayload(
  bearishRanking, { level: 'elevated', vixLevel: 'Elevated' },
  bearishOpts
);

ok('payload.firstChunkPrefix is non-empty', typeof bearishPayload.firstChunkPrefix === 'string' && bearishPayload.firstChunkPrefix.length > 0);
ok('firstChunkPrefix carries the 🔴 separator', /🔴━+🔴/.test(bearishPayload.firstChunkPrefix));
ok('firstChunkPrefix carries the 🆕 NEW badge', /🆕 🐎 \*\*NEW DARK HORSE SCAN\*\*/.test(bearishPayload.firstChunkPrefix));
ok('firstChunkPrefix carries the 📘 Learn row', /📘 Learn: /.test(bearishPayload.firstChunkPrefix));
ok('firstChunkPrefix carries the LH/LL link', /\[Lower High \/ Lower Low\]\(#lh-ll\)/.test(bearishPayload.firstChunkPrefix));

const bullishPayload = rank.buildRankedMovementDigestPayload(
  bullishOnly, { level: 'elevated', vixLevel: 'Elevated' },
  { internal: [], ignored: [], universeSize: 33, now: NOW }
);
ok('bullish-only payload firstChunkPrefix carries boundary', /🔴━+🔴/.test(bullishPayload.firstChunkPrefix));
ok('bullish-only payload firstChunkPrefix DOES NOT carry 📘 Learn row', !/📘 Learn: /.test(bullishPayload.firstChunkPrefix));

// Chunker pass-through verifies the boundary + learning row sit on
// Part 1 only and never repeat on Parts 2..N.
const bearishChunks = engine._dhChunkDigest(bearishPayload.content, {
  max: engine.DH_CHUNK_MAX_DEFAULT,
  firstChunkPrefix: bearishPayload.firstChunkPrefix,
});
ok('chunker produces at least 1 chunk', bearishChunks.length >= 1);
ok('Part 1 starts with the 🔴 boundary block',
   bearishChunks[0].startsWith('🔴━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🔴\n🆕 🐎 **NEW DARK HORSE SCAN**'));
ok('Part 1 carries the 📘 Learn row', /📘 Learn: /.test(bearishChunks[0]));
for (let i = 1; i < bearishChunks.length; i++) {
  ok(`Part ${i + 1}/${bearishChunks.length} does NOT carry the boundary`,
     !/NEW DARK HORSE SCAN/.test(bearishChunks[i]));
  ok(`Part ${i + 1}/${bearishChunks.length} does NOT carry the 📘 Learn row`,
     !/📘 Learn: /.test(bearishChunks[i]));
}

// ----------------------------------------------------------------
// T5 — First-detection tracker
// ----------------------------------------------------------------
section('T5 — First-detection tracker (presentation state)');

fd._resetForTests();
ok('tracker starts empty', fd.size() === 0);
ok('getSnapshot of unknown returns null', fd.getSnapshot('EURUSD', 'Bearish') === null);

const snap1 = fd.track('EURUSD', 'Bearish', NOW);
ok('track initialises firstDetectedAt + lastSeenAt + scanCycles=1',
   snap1 && snap1.firstDetectedAt === NOW && snap1.lastSeenAt === NOW && snap1.scanCycles === 1);
ok('tracker size grew to 1', fd.size() === 1);

const NOW_LATER = NOW + 15 * 60 * 1000; // 15 minutes later
const snap2 = fd.track('EURUSD', 'Bearish', NOW_LATER);
ok('subsequent track keeps firstDetectedAt, refreshes lastSeenAt, increments scanCycles',
   snap2 && snap2.firstDetectedAt === NOW && snap2.lastSeenAt === NOW_LATER && snap2.scanCycles === 2);

// Different direction → distinct key.
const snap3 = fd.track('EURUSD', 'Bullish', NOW);
ok('direction is part of the key (Bullish ≠ Bearish)',
   snap3 && snap3.scanCycles === 1 && fd.getSnapshot('EURUSD', 'Bullish') !== null);

ok('null symbol returns null', fd.track(null, 'Bearish', NOW) === null);
ok('null direction returns null', fd.track('EURUSD', null, NOW) === null);

// trackMany batches
fd._resetForTests();
const tickResult = fd.trackMany([
  { symbol: 'EURUSD', direction: 'Bearish' },
  { symbol: 'XAUUSD', direction: 'Bearish' },
  { symbol: null,     direction: 'Bearish' }, // skipped
], NOW);
ok('trackMany returns an array (with nulls for skipped)', Array.isArray(tickResult) && tickResult.length === 3);
ok('trackMany populated the 2 valid keys', fd.size() === 2);

// Format helper
fd._resetForTests();
const fmtSnap = fd.track('XAUUSD', 'Bearish', NOW);
const fmt = fd.formatFirstDetectionFragment(fmtSnap, NOW + 12 * 60 * 1000);
ok('formatFirstDetectionFragment carries "first detected"', /first detected /.test(fmt));
ok('formatFirstDetectionFragment carries UTC timestamp', /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(fmt));
ok('formatFirstDetectionFragment reports "12m ago" elapsed', /12m ago/.test(fmt));
ok('formatFirstDetectionFragment carries "tracked across 1 scan cycle"', /tracked across 1 scan cycle/.test(fmt));

// Many cycles → plural
fd._resetForTests();
const multiSnap = fd.track('XAUUSD', 'Bearish', NOW);
for (let i = 1; i < 5; i++) fd.track('XAUUSD', 'Bearish', NOW + i * 1000);
const multiFmt = fd.formatFirstDetectionFragment(fd.getSnapshot('XAUUSD', 'Bearish'), NOW + 3600 * 1000);
ok('formatFirstDetectionFragment pluralises "scan cycles" when N > 1', /tracked across 5 scan cycles/.test(multiFmt));

// Stale-prune
fd._resetForTests();
fd._setStaleMsForTests(60 * 60 * 1000); // 1h stale
fd.track('OLD', 'Bearish', NOW - 2 * 60 * 60 * 1000); // 2h ago
fd.track('NEW', 'Bearish', NOW);
fd.pruneStale(NOW);
ok('pruneStale removes entries older than staleMs', fd.getSnapshot('OLD', 'Bearish') === null);
ok('pruneStale preserves fresh entries', fd.getSnapshot('NEW', 'Bearish') !== null);

// ----------------------------------------------------------------
// T6 — plainTrendAge integration with firstDetectionSnapshot
// ----------------------------------------------------------------
section('T6 — plainTrendAge first-detection scaffolding');

fd._resetForTests();
const snap = fd.track('XAUUSD', 'Bearish', NOW);

// moveAge=0 fallback WITH snapshot → scaffolded fragment appended
const ageWithSnap = rank.plainTrendAge(0, 'Bearish', {
  firstDetectionSnapshot: snap,
  now: NOW + 12 * 60 * 1000,
});
ok('moveAge=0 + snapshot → carries "no confirmed higher-timeframe bearish bar yet"',
   /no confirmed higher-timeframe bearish bar yet/.test(ageWithSnap));
ok('moveAge=0 + snapshot → carries " · " separator', / · /.test(ageWithSnap));
ok('moveAge=0 + snapshot → carries "first detected"',
   /first detected /.test(ageWithSnap));
ok('moveAge=0 + snapshot → carries "tracked across N scan cycle"',
   /tracked across 1 scan cycle/.test(ageWithSnap));

// moveAge=0 fallback WITHOUT snapshot → legacy fallback preserved
const ageNoSnap = rank.plainTrendAge(0, 'Bearish');
ok('moveAge=0 + no snapshot → bare fallback (no " · " separator)',
   ageNoSnap === 'no confirmed higher-timeframe bearish bar yet');

// moveAge=4 ignores snapshot — confirmed sequence already exists
const ageReal = rank.plainTrendAge(4, 'Bearish', {
  firstDetectionSnapshot: snap,
  now: NOW + 12 * 60 * 1000,
});
ok('moveAge=4 + snapshot → uses real mature-move phrasing (snapshot is ignored)',
   /mature move/.test(ageReal) && !/first detected/.test(ageReal));

// ----------------------------------------------------------------
// T7 — Backwards compatibility / no regression on legacy callers
// ----------------------------------------------------------------
section('T7 — Backwards compatibility');

// plainTrendAge with no opts arg behaves exactly as before
ok('plainTrendAge(0, Bullish) — Lane 3 wording intact',
   rank.plainTrendAge(0, 'Bullish') === 'no confirmed higher-timeframe bullish bar yet');
ok('plainTrendAge(1, Bullish) unchanged',
   rank.plainTrendAge(1, 'Bullish') === 'early move — first confirmed higher-timeframe bullish bar');
ok('plainTrendAge(7, Bearish) unchanged — late-stage extended-move wording',
   /extended move/.test(rank.plainTrendAge(7, 'Bearish')));

// Existing learning links block (body) still emits correctly. Lane 2
// adds a SEPARATE top-of-output row; the existing in-body row is
// untouched per the operator brief.
const llBlock = rank.buildLearningLinksBlock({});
ok('legacy buildLearningLinksBlock still emits "**Learning links:**" prefix',
   /\*\*Learning links:\*\*/.test(llBlock.text));
ok('legacy learning links block does NOT carry the 📘 emoji (different surface)',
   !/📘/.test(llBlock.text));

// ----------------------------------------------------------------
// T8 — Hard-boundary regressions
// ----------------------------------------------------------------
section('T8 — Hard-boundary regressions');

// Ranking is NOT modified by the first-detection tracker. We tick
// once, then re-tick — the rank record's score / direction /
// movePhase / moveSpeed must stay identical.
fd._resetForTests();
const rk = mkRow('XAUUSD', 7, 'Bearish', rank.SECTIONS.COMMODITIES);
const scoreBefore = rk.score;
const dirBefore = rk.direction;
const phaseBefore = rk.movePhase;
const moveSpeedBefore = rk.moveSpeed;
fd.track(rk.symbol, rk.direction, NOW);
fd.track(rk.symbol, rk.direction, NOW + 1000);
ok('tracker does NOT mutate rank.score', rk.score === scoreBefore);
ok('tracker does NOT mutate rank.direction', rk.direction === dirBefore);
ok('tracker does NOT mutate rank.movePhase', rk.movePhase === phaseBefore);
ok('tracker does NOT mutate rank.moveSpeed', rk.moveSpeed === moveSpeedBefore);

// Visual learning row pulls only from the Lane 1 catalogue. Confirm
// every referenced id resolves.
['lh_ll', 'bos', 'liquidity_sweep', 'failed_retest'].forEach((id) => {
  ok(`Lane 1 catalogue still resolves "${id}"`, !!vpl.getPattern(id));
});

// Per-call linkBuilder override flows from row construction. Confirm
// renderLearningLinksRow respects per-call builder so future
// dashboard wiring works without a global setDeepLinkBuilder.
const customRow = vpl.renderLearningLinksRow(['lh_ll', 'bos'], {
  linkBuilder: (slug) => `https://atlas.test/glossary/${slug}`,
});
ok('per-call linkBuilder produces full URL form',
   /\(https:\/\/atlas\.test\/glossary\/lh-hl?\)/.test(customRow) ||
   /\(https:\/\/atlas\.test\/glossary\/lh-ll\)/.test(customRow));

// ----------------------------------------------------------------
console.log('\n==========================');
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed === 0) {
  console.log('[DH-VISUAL-LEARNING-PROTOTYPE-QA] PASS — Lane 2 surfaces verified: 🔴 boundary + 🆕 NEW badge, 📘 learning links row on bearish routes (suppressed on bullish-only / monitoring-only), first-detection tracker + plainTrendAge scaffolding, full backwards compatibility, hard-boundary integrity.');
  process.exit(0);
} else {
  console.log('[DH-VISUAL-LEARNING-PROTOTYPE-QA] FAIL — see failures above.');
  process.exit(1);
}
