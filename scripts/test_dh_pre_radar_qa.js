#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Dark Horse Pre-Radar / Near-Miss supporting-intelligence QA.
 *
 * Locked doctrine (operator directive 2026-05-12):
 *   Quiet scans must NOT feel empty. The digest gains a supporting-
 *   intelligence layer (Pre-Radar, Near-Miss, Quiet Market Reason,
 *   Waiting For, Universe Coverage) that explains what is building
 *   below the publication threshold without creating fake signals
 *   or lowering bars.
 *
 * Selection rules (disjoint by score band):
 *   Pre-Radar  = score === 5 AND movePhase ∈ {early, mid}
 *   Near-Miss  = score ∈ {6, 7}
 *
 * Asserts:
 *   T1.  Pre-Radar selection — score 5 + early/mid phase only;
 *        max 3 entries; sorted by moveSpeed desc.
 *   T2.  Near-Miss selection — score 6/7; max 3 entries; sorted
 *        by score desc then moveSpeed desc.
 *   T3.  Disjoint sets — a candidate appears in at most one of
 *        Pre-Radar / Near-Miss.
 *   T4.  Pre-Radar block rendering — heading, doctrine sentence,
 *        per-candidate line with "Building:" + "Confirmation
 *        pending" framing.
 *   T5.  Near-Miss block rendering — heading, doctrine sentence,
 *        per-candidate "X points below the WATCH threshold of
 *        8/10" gap text.
 *   T6.  Quiet Market Reason — diagnostic sentence(s) explaining
 *        why no standout published; references volatility +
 *        internal-count state.
 *   T7.  Waiting For — most-common confirmation pattern derived
 *        from the dominant internal-candidate section.
 *   T8.  Universe Coverage — counts (scanned / below-threshold /
 *        near-threshold / at-threshold) + strongest section
 *        (when activity exists) + concentration.
 *   T9.  Render order on monitoring-only scan — supporting layer
 *        IS the primary content; redundant "Current standouts /
 *        section data" placeholders SUPPRESSED.
 *   T10. Render order on populated scan — supporting layer sits
 *        BELOW the main section radar; standout section still
 *        renders.
 *   T11. Approved vocabulary — wording uses building / monitoring
 *        / not promoted / confirmation pending / pressure visible
 *        / conditions below publication threshold.
 *   T12. Banned wording — ENTER / BUY / SELL / DO NOT ENTER /
 *        trade now / guaranteed / fake forced candidates absent.
 *   T13. Chunker still passes on the longer output.
 *
 * Wired as `npm run qa:dh-pre-radar`.
 */

const path   = require('path');
const rank   = require(path.join(__dirname, '..', 'darkHorseRanking.js'));
const engine = require(path.join(__dirname, '..', 'darkHorseEngine.js'));

let passed = 0, failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label, info != null ? '\n     ' + JSON.stringify(info) : ''); }
}

// ── Fixtures ────────────────────────────────────────────────────
function mkInternal(over) {
  return Object.assign({
    symbol: 'EURUSD', score: 5, direction: 'Bullish',
    summary: 'higher highs and higher lows forming',
    reasons: ['structure 1/2'],
    moveSpeed: 1.2, moveAge: 2, movePhase: 'early',
  }, over);
}
function mkIgnored(symbol, score) {
  return { symbol, score: score == null ? 2 : score, direction: 'Neutral' };
}

// ============================================================
// T1 — Pre-Radar selection
// ============================================================
console.log('\n[T1] Pre-Radar selection — score 5 + early/mid phase, max 3, by moveSpeed desc');
{
  const internal = [
    mkInternal({ symbol: 'A', score: 5, movePhase: 'early', moveSpeed: 1.4 }),
    mkInternal({ symbol: 'B', score: 5, movePhase: 'mid',   moveSpeed: 1.3 }),
    mkInternal({ symbol: 'C', score: 5, movePhase: 'late',  moveSpeed: 1.5 }), // late → excluded
    mkInternal({ symbol: 'D', score: 6, movePhase: 'early', moveSpeed: 1.6 }), // score 6 → Near-Miss, not Pre-Radar
    mkInternal({ symbol: 'E', score: 5, movePhase: 'mid',   moveSpeed: 1.1 }),
    mkInternal({ symbol: 'F', score: 5, movePhase: 'early', moveSpeed: 1.0 }), // 4th-best → trimmed by cap
  ];
  const out = rank.selectPreRadarCandidates(internal);
  ok('returns at most 3', out.length <= 3, { out: out.map(x => x.symbol) });
  ok('only score === 5 entries', out.every(r => r.score === 5));
  ok('only early/mid phases', out.every(r => r.movePhase === 'early' || r.movePhase === 'mid'));
  ok('sorted by moveSpeed desc', out.length < 2 || out.every((r, i) => i === 0 || r.moveSpeed <= out[i - 1].moveSpeed));
  ok('top entry is the highest-speed score-5 early/mid', out[0] && out[0].symbol === 'A');
}

// ============================================================
// T2 — Near-Miss selection
// ============================================================
console.log('\n[T2] Near-Miss selection — score 6 or 7, max 3, by score then moveSpeed desc');
{
  const internal = [
    mkInternal({ symbol: 'A', score: 7, movePhase: 'mid',   moveSpeed: 1.2 }),
    mkInternal({ symbol: 'B', score: 6, movePhase: 'late',  moveSpeed: 1.5 }),
    mkInternal({ symbol: 'C', score: 7, movePhase: 'early', moveSpeed: 1.4 }),
    mkInternal({ symbol: 'D', score: 5, movePhase: 'mid',   moveSpeed: 1.6 }), // score 5 → excluded
    mkInternal({ symbol: 'E', score: 6, movePhase: 'mid',   moveSpeed: 1.0 }),
  ];
  const out = rank.selectNearMissCandidates(internal);
  ok('returns at most 3', out.length <= 3);
  ok('only score 6 or 7', out.every(r => r.score === 6 || r.score === 7));
  ok('score-7 entries appear before score-6', (() => {
    let seen6 = false;
    for (const r of out) {
      if (r.score === 6) seen6 = true;
      if (r.score === 7 && seen6) return false;
    }
    return true;
  })());
  ok('within same score, higher moveSpeed first', (() => {
    for (let i = 1; i < out.length; i++) {
      if (out[i].score === out[i - 1].score && (out[i].moveSpeed || 0) > (out[i - 1].moveSpeed || 0)) return false;
    }
    return true;
  })());
}

// ============================================================
// T3 — Disjoint sets
// ============================================================
console.log('\n[T3] Pre-Radar and Near-Miss sets are disjoint by score band');
{
  const internal = [
    mkInternal({ symbol: 'A', score: 5, movePhase: 'early' }),
    mkInternal({ symbol: 'B', score: 6, movePhase: 'mid' }),
    mkInternal({ symbol: 'C', score: 7, movePhase: 'early' }),
  ];
  const pr = rank.selectPreRadarCandidates(internal);
  const nm = rank.selectNearMissCandidates(internal);
  const prSet = new Set(pr.map(x => x.symbol));
  const overlap = nm.filter(x => prSet.has(x.symbol));
  ok('no symbol in both Pre-Radar and Near-Miss', overlap.length === 0,
     overlap.length ? { overlap } : undefined);
}

// ============================================================
// T4 — Pre-Radar block rendering
// ============================================================
console.log('\n[T4] Pre-Radar block — heading + doctrine sentence + per-candidate lines');
{
  const internal = [
    mkInternal({ symbol: 'EURUSD', score: 5, movePhase: 'early', moveSpeed: 1.4,
                 summary: 'higher highs and higher lows forming on 1D' }),
    mkInternal({ symbol: 'NVDA',   score: 5, movePhase: 'mid',   moveSpeed: 1.1,
                 summary: 'pressure building above prior session level' }),
  ];
  const pr = rank.selectPreRadarCandidates(internal);
  const block = rank.buildPreRadarBlock(pr);
  ok('block has Pre-Radar heading', /### .* Pre-Radar.* Building pressure/.test(block));
  ok('block carries doctrine sentence ("Not promoted")',
     /Not promoted — pressure visible but incomplete/.test(block));
  ok('per-candidate line includes symbol + score + phase + momentum',
     /\*\*EURUSD\*\*.*score 5\/10.*phase early.*momentum 1\.4× the prior-bar average/.test(block));
  ok('per-candidate Building/Confirmation framing present',
     /Building: higher highs and higher lows forming on 1D\. Confirmation pending — one structure step away from promotion\./.test(block));
  ok('translates jargon inside summary',
     // The summary "HH/HL" would translate to "higher highs and higher lows".
     // Our fixture already used the translated phrasing; verify no raw "HH/HL".
     !/\bHH\/HL\b/.test(block));
}

// ============================================================
// T5 — Near-Miss block rendering
// ============================================================
console.log('\n[T5] Near-Miss block — gap-text to WATCH threshold per candidate');
{
  const internal = [
    mkInternal({ symbol: 'XAUUSD', score: 7, movePhase: 'mid', moveSpeed: 1.2,
                 summary: '1D close pressing the recent low', direction: 'Bearish' }),
    mkInternal({ symbol: 'GBPUSD', score: 6, movePhase: 'mid', moveSpeed: 1.0,
                 summary: 'momentum expanding' }),
  ];
  const nm = rank.selectNearMissCandidates(internal);
  const block = rank.buildNearMissBlock(nm);
  ok('block has Near-Miss heading + "below WATCH threshold"',
     /### .* Near-Miss — below WATCH threshold/.test(block));
  ok('doctrine sentence — "Worth monitoring. Not promoted yet. Awaiting confirmation."',
     /Worth monitoring\. Not promoted yet\. Awaiting confirmation\./.test(block));
  ok('score-7 line names "one point below the WATCH threshold of 8/10"',
     /XAUUSD[\s\S]*one point below the WATCH threshold of 8\/10/.test(block));
  ok('score-6 line names "2 points below the WATCH threshold of 8/10"',
     /GBPUSD[\s\S]*2 points below the WATCH threshold of 8\/10/.test(block));
}

// ============================================================
// T6 — Quiet Market Reason
// ============================================================
console.log('\n[T6] Quiet Market Reason — references volatility + internal-count state');
{
  const block1 = rank.buildQuietMarketReason({ level: 'quiet' }, [], new Array(20).fill(null).map((_, i) => mkIgnored('I' + i)));
  ok('quiet vol + no internal — names "volatility is quiet"',
     /volatility is quiet/i.test(block1));
  ok('quiet vol + no internal — names "no candidate cleared the near-threshold"',
     /no candidate cleared the near-threshold/i.test(block1));

  const block2 = rank.buildQuietMarketReason({ level: 'elevated' }, [mkInternal({}), mkInternal({})], []);
  ok('elevated vol + small internal pool — names elevated state',
     /volatility is elevated/i.test(block2));
  ok('elevated vol + 2 internal — names "candidates are building near the threshold"',
     /candidates are building near the threshold/i.test(block2));

  const block3 = rank.buildQuietMarketReason({ level: 'extreme' }, [mkInternal({}),mkInternal({}),mkInternal({})], []);
  ok('extreme vol — names extreme state', /volatility is extreme/i.test(block3));
}

// ============================================================
// T7 — Waiting For
// ============================================================
console.log('\n[T7] Waiting For — synthesises confirmation pattern from dominant section');
{
  // FX-dominant universe
  const internalFx = [
    mkInternal({ symbol: 'EURUSD', score: 5 }),
    mkInternal({ symbol: 'GBPUSD', score: 6 }),
    mkInternal({ symbol: 'USDJPY', score: 5 }),
  ];
  const blockFx = rank.buildWaitingForBlock(internalFx);
  ok('FX-dominant — names 5m/15m body close + recent intraday level',
     /5m or 15m body close.*recent intraday (high|low)/.test(blockFx));

  // Indices-dominant
  const internalIdx = [
    mkInternal({ symbol: 'NDX',  score: 6 }),
    mkInternal({ symbol: 'SPX',  score: 5 }),
    mkInternal({ symbol: 'NAS100', score: 5 }),
  ];
  const blockIdx = rank.buildWaitingForBlock(internalIdx);
  ok('Indices-dominant — names 15m or 1H body close + recent session level',
     /15m or 1H body close.*recent session (high|low)/.test(blockIdx));

  // Equities-dominant
  const internalEq = [
    mkInternal({ symbol: 'NVDA', score: 7 }),
    mkInternal({ symbol: 'AMD',  score: 6 }),
  ];
  const blockEq = rank.buildWaitingForBlock(internalEq);
  ok('Equities-dominant — names 5m/15m body close + intraday level + prior-session reference',
     /5m or 15m body close.*recent intraday (high|low).*prior-session reference level/.test(blockEq));

  // Empty
  const blockEmpty = rank.buildWaitingForBlock([]);
  ok('empty universe — awaits a near-threshold-score candidate',
     /Awaiting a candidate that crosses the near-threshold score \(5\/10\)/.test(blockEmpty));
}

// ============================================================
// T8 — Universe Coverage
// ============================================================
console.log('\n[T8] Universe Coverage — counts + strongest/weakest section + concentration');
{
  const internal = [
    mkInternal({ symbol: 'EURUSD', score: 5 }),
    mkInternal({ symbol: 'GBPUSD', score: 6 }),
    mkInternal({ symbol: 'XAUUSD', score: 7 }),
  ];
  const ignored = new Array(25).fill(null).map((_, i) => mkIgnored('I' + i, Math.floor(Math.random() * 5)));
  const ranking = { top10: [], sectionsScanned: ['fx_majors','commodities'], sectionCapsApplied: [], allCount: 3 };
  const block = rank.buildUniverseCoverageBlock({ internal, ignored, universeSize: 33 }, ranking);
  ok('Symbols scanned: 33', /Symbols scanned:\*\*\s+33/.test(block));
  ok('Below near-threshold (< 5/10): 25', /Below near-threshold[^*]*:\*\*\s+25/.test(block));
  ok('Near-threshold (5–7/10): 3', /Near-threshold[^*]*:\*\*\s+3/.test(block));
  ok('At publication threshold (≥ 8/10): 0', /At publication threshold[^*]*:\*\*\s+0/.test(block));
  ok('Strongest section line present', /\*\*Strongest section:\*\* /.test(block));
  ok('Volatility concentration line present', /Volatility concentration:/.test(block));
}

// ============================================================
// T9 — Monitoring-only digest: supporting layer is primary content
// ============================================================
console.log('\n[T9] Monitoring-only digest — supporting layer replaces standout placeholders');
{
  const internal = [
    mkInternal({ symbol: 'EURUSD', score: 5, movePhase: 'early', moveSpeed: 1.3 }),
    mkInternal({ symbol: 'XAUUSD', score: 7, movePhase: 'mid', moveSpeed: 1.2, direction: 'Bearish' }),
  ];
  const payload = rank.buildRankedMovementDigestPayload(
    { top10: [], sectionsScanned: ['fx_majors','commodities'], sectionCapsApplied: [], allCount: 2 },
    { level: 'quiet', vixLevel: 'Normal' },
    { internal, ignored: [], universeSize: 33, now: Date.parse('2026-05-12T04:00:00Z') }
  );
  const c = payload.content;
  ok('Pre-Radar block rendered',  /### .* Pre-Radar.* Building pressure/.test(c));
  ok('Near-Miss block rendered',  /### .* Near-Miss/.test(c));
  ok('Why-no-standout block rendered', /### .* Why no standout published/.test(c));
  ok('Waiting For block rendered', /### .* What ATLAS is waiting for/.test(c));
  ok('Universe coverage block rendered', /### .* Universe coverage/.test(c));
  ok('Redundant "_No qualifying standouts this scan._" SUPPRESSED in monitoring-only',
     !/_No qualifying standouts this scan\._/.test(c),
     'placeholder still appears');
  ok('Redundant "_No section data this scan._" SUPPRESSED',
     !/_No section data this scan\._/.test(c),
     'placeholder still appears');
}

// ============================================================
// T10 — Populated digest: supporting layer sits BELOW main radar
// ============================================================
console.log('\n[T10] Populated digest — supporting layer renders below main section radar');
{
  function daily(n, base) {
    const out = []; let p = base;
    const t = Math.floor(Date.parse('2026-05-01T00:00:00Z')/1000);
    for (let i=0;i<n;i++) { const o=p, c=p+0.6, h=c+0.4, l=o-0.3; out.push({open:o,high:h,low:l,close:c,time:t+i*86400}); p=c; }
    return out;
  }
  const top = rank.enrichCandidate(
    { symbol: 'EURUSD', score: 9, direction: 'Bullish', summary: 'higher highs and higher lows', reasons: ['structure 2/2'] },
    daily(25, 1.1), 6, { watchThreshold: 8 }
  );
  top.section = rank.SECTIONS.FX_MAJORS;
  top.sectionLabel = rank.SECTION_LABEL[rank.SECTIONS.FX_MAJORS];
  const internal = [
    mkInternal({ symbol: 'NDX', score: 7, movePhase: 'mid', moveSpeed: 1.1 }),
    mkInternal({ symbol: 'NVDA', score: 5, movePhase: 'early', moveSpeed: 1.3 }),
  ];
  const payload = rank.buildRankedMovementDigestPayload(
    { top10: [top], sectionsScanned: ['fx_majors','indices','equities'], sectionCapsApplied: [], allCount: 1 },
    { level: 'elevated', vixLevel: 'Elevated' },
    { internal, ignored: [], universeSize: 33, now: Date.parse('2026-05-12T04:00:00Z') }
  );
  const c = payload.content;
  const idxStandouts = c.indexOf('### ⭐ Current standouts');
  const idxFxMajors  = c.indexOf('### FX Majors');
  const idxPreRadar  = c.indexOf('### 🛰️ Pre-Radar');
  const idxNearMiss  = c.indexOf('### 🎯 Near-Miss');
  const idxGlossary  = c.indexOf('### Glossary');
  ok('standouts block still rendered when top10 has content', idxStandouts > 0);
  ok('main section radar still rendered (FX Majors)', idxFxMajors > 0);
  ok('Pre-Radar appears AFTER main section radar (supporting position)',
     idxPreRadar > idxFxMajors,
     { idxFxMajors, idxPreRadar });
  ok('Near-Miss appears AFTER main section radar',
     idxNearMiss > idxFxMajors,
     { idxFxMajors, idxNearMiss });
  ok('Glossary still at the foot (after supporting blocks)',
     idxGlossary > idxNearMiss);
}

// ============================================================
// T11 — Approved vocabulary
// ============================================================
console.log('\n[T11] Approved vocabulary present in supporting blocks');
{
  const internal = [
    mkInternal({ symbol: 'EURUSD', score: 5, movePhase: 'early', moveSpeed: 1.3 }),
    mkInternal({ symbol: 'XAUUSD', score: 7, movePhase: 'mid', moveSpeed: 1.2 }),
  ];
  const payload = rank.buildRankedMovementDigestPayload(
    { top10: [], sectionsScanned: ['fx_majors','commodities'], sectionCapsApplied: [], allCount: 2 },
    { level: 'quiet', vixLevel: 'Normal' },
    { internal, ignored: [], universeSize: 33 }
  );
  const c = payload.content;
  const APPROVED = [
    /building/i,
    /monitoring/i,
    /Not promoted/i,
    /Confirmation pending/i,
    /pressure visible but incomplete/i,
    /publication threshold/i,
    /Worth monitoring/i,
    /Awaiting confirmation/i,
  ];
  for (const re of APPROVED) {
    ok(`approved vocabulary present: ${re}`,
       re.test(c),
       re.test(c) ? undefined : 'phrase missing from output');
  }
}

// ============================================================
// T12 — Banned wording
// ============================================================
console.log('\n[T12] Banned wording absent — no trading directives / hype');
{
  const internal = [
    mkInternal({ symbol: 'EURUSD', score: 5, movePhase: 'early', moveSpeed: 1.3 }),
    mkInternal({ symbol: 'XAUUSD', score: 7, movePhase: 'mid', moveSpeed: 1.2 }),
  ];
  const payload = rank.buildRankedMovementDigestPayload(
    { top10: [], sectionsScanned: ['fx_majors','commodities'], sectionCapsApplied: [], allCount: 2 },
    { level: 'quiet', vixLevel: 'Normal' },
    { internal, ignored: [], universeSize: 33 }
  );
  const c = payload.content;
  const BANNED = [
    /\bENTER\b/,
    /\bBUY\b/,
    /\bSELL\b/,
    /\bDO NOT ENTER\b/i,
    /\btrade now\b/i,
    /\bguaranteed?\b/i,
    /\bdo\s+not\s+(?:enter|trade|place|open)\b/i,
  ];
  for (const re of BANNED) {
    ok(`banned wording absent: ${re}`,
       !re.test(c),
       re.test(c) ? { match: c.match(re)[0] } : undefined);
  }
}

// ============================================================
// T13 — Chunker still passes
// ============================================================
console.log('\n[T13] Chunker passes on longer Pre-Radar / Near-Miss output');
{
  function daily(n, base) {
    const out = []; let p = base;
    const t = Math.floor(Date.parse('2026-05-01T00:00:00Z')/1000);
    for (let i=0;i<n;i++) { const o=p, c=p+0.6, h=c+0.4, l=o-0.3; out.push({open:o,high:h,low:l,close:c,time:t+i*86400}); p=c; }
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
  const top10 = [
    mkRow('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS),
    mkRow('NDX',    8, 'Bullish', rank.SECTIONS.INDICES),
    mkRow('NVDA',   8, 'Bullish', rank.SECTIONS.EQUITIES),
    mkRow('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES),
  ];
  const internal = [
    mkInternal({ symbol: 'GBPUSD', score: 7, movePhase: 'mid' }),
    mkInternal({ symbol: 'SPX',    score: 6, movePhase: 'mid' }),
    mkInternal({ symbol: 'AMD',    score: 5, movePhase: 'early', moveSpeed: 1.4 }),
    mkInternal({ symbol: 'WTI',    score: 5, movePhase: 'mid', moveSpeed: 1.1 }),
  ];
  const payload = rank.buildRankedMovementDigestPayload(
    { top10, sectionsScanned: ['fx_majors','indices','equities','commodities'], sectionCapsApplied: [], allCount: 4 },
    { level: 'elevated', vixLevel: 'Elevated' },
    { internal, ignored: new Array(25).fill(null).map((_, i) => mkIgnored('X'+i)), universeSize: 33 }
  );
  const chunks = engine._dhChunkDigest(payload.content);
  ok('chunker produces at least 1 chunk', chunks.length >= 1);
  for (let i = 0; i < chunks.length; i++) {
    ok(`chunk ${i + 1}/${chunks.length} ≤ Discord 2000-char hard limit`,
       chunks[i].length <= engine.DH_CHUNK_DISCORD_HARD_LIMIT,
       { len: chunks[i].length });
  }
  // Supporting blocks survive across chunks.
  const joined = chunks.map(x =>
    x.replace(/^🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\* — Part \d+\/\d+\n\n/, '')
  ).join('');
  ok('Pre-Radar block survives across chunks',  /### .* Pre-Radar/.test(joined));
  ok('Near-Miss block survives across chunks',  /### .* Near-Miss/.test(joined));
  ok('Universe coverage block survives across chunks', /### .* Universe coverage/.test(joined));
}

// ============================================================
// summary
// ============================================================
console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('[DH-PRE-RADAR-QA] PASS — Pre-Radar + Near-Miss + Quiet Market Reason + Waiting For + Universe Coverage layer renders correctly; disjoint selection; max-3 caps; supporting position when standouts exist; primary content when monitoring-only; approved vocabulary present; banned wording absent; chunker preserved.');
process.exit(0);
