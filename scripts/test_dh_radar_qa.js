#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Dark Horse section radar + gold-star standout QA.
 *
 * Pure unit test — no network, no real Discord. Drives
 * darkHorseRanking.buildRankedMovementDigestPayload with a
 * representative multi-section fixture and asserts every locked
 * acceptance rule from the section-radar lane:
 *
 *   T1.  Output includes the Dark Horse criteria paragraph.
 *   T2.  Output groups candidates by section, in canonical order.
 *   T3.  Max two candidates per section are shown.
 *   T4.  ⭐ marks exactly two overall standouts when ≥2 candidates.
 *   T5.  ⭐ selection follows score → phase → late-entry-risk →
 *        move-speed → structure → relative-strength tie-break.
 *   T6.  "Trend age:" appears for each shown candidate.
 *   T7.  "Trend phase:" appears for each shown candidate.
 *   T8.  "Continuation window:" appears for each shown candidate.
 *   T9.  "controlled pullback" does NOT appear bare anywhere in
 *        Dark Horse output (digest OR watch payload). The pattern
 *        glossary _Calm retest_ is the operator-facing replacement.
 *   T10. Banned trading-directive phrases are absent
 *        (enter now / buy now / sell now / do not enter / etc.).
 *   T11. Chunked delivery still works for the longer output:
 *        _dhChunkDigest returns N parts, every part ≤ 2000 chars,
 *        Part X/N labels sequential, candidate boundaries preserved.
 *
 * Wired as `npm run qa:dh-radar`.
 */

const path = require('path');
const rank   = require(path.join(__dirname, '..', 'darkHorseRanking.js'));
const engine = require(path.join(__dirname, '..', 'darkHorseEngine.js'));

let passed = 0, failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label, info != null ? '\n     ' + JSON.stringify(info) : ''); }
}

// ── Fixture builder ─────────────────────────────────────────────
// Build an enriched candidate that obeys the rank-record shape
// without going through scoreInstrument. This is presentation-
// layer testing — we feed in known field values and verify the
// output shape rather than re-validate enrichment logic.
function mkEnriched(over) {
  const base = {
    symbol: 'TEST',
    section: rank.SECTIONS.FX_MAJORS,
    sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.FX_MAJORS],
    safeHavenOverlay: false,
    direction: 'Bullish',
    score: 7,
    scoreBreakdown: ['composite criteria met'],
    moveStrength: 7,
    moveSpeed: 1.3,
    moveAge: 2,
    movePhase: 'mid',
    relativeStrength: 1.3,
    structureState: 'HH/HL sequence holding on 1D',
    confirmationRequirement: '5m/15m close above the recent intraday high, followed by a clean retest that holds.',
    invalidationTrigger: 'Reclaim of the prior session low on the same timeframe (5m/15m) — close below that level voids the setup.',
    promotionTrigger: 'A confirmed higher-timeframe close above the most recent significant high, with momentum NOT contracting on the close — promotes from monitoring to WATCH on the next scan.',
    continuationWindow: 'window open — trend developing, watch for first higher-timeframe confirmation',
    lateEntryRisk: 'low-to-moderate',
    whyFlagged: 'composite scoring threshold met',
    macroEventLink: 'unavailable — no anchor event mapped to this symbol',
    whyNotWatch: 'score 7/10 below WATCH threshold of 8/10 (gap 1); awaiting confirmation criteria',
    atlasState: 'Monitoring only — mid phase, watch for confirmation',
  };
  return Object.assign({}, base, over);
}

// Multi-section, top-2-per-section coverage. 10 candidates across
// five sections (Forex majors, Indices, Equities, Commodities,
// Safe-Havens). Symbol scores set so the tie-break test (T5) has
// a clean fixture.
function buildFixtureRanking() {
  const c = (over) => mkEnriched(over);

  // FX Majors — two candidates, EURUSD top.
  const eu = c({ symbol: 'EURUSD',  section: rank.SECTIONS.FX_MAJORS,  sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.FX_MAJORS], score: 9, direction: 'Bearish',  movePhase: 'early',  moveAge: 1, moveSpeed: 1.6, lateEntryRisk: 'low' });
  const gu = c({ symbol: 'GBPUSD',  section: rank.SECTIONS.FX_MAJORS,  sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.FX_MAJORS], score: 7, direction: 'Bearish',  movePhase: 'mid',    moveAge: 3, moveSpeed: 1.2, lateEntryRisk: 'low-to-moderate' });
  // Indices — three candidates feed in to verify the "max 2 per
  // section" cap. NDX is the standout-tie partner with EURUSD.
  const ndx  = c({ symbol: 'NDX', section: rank.SECTIONS.INDICES, sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.INDICES], score: 9, direction: 'Bullish',  movePhase: 'mid',    moveAge: 4, moveSpeed: 1.4, lateEntryRisk: 'low-to-moderate' });
  const spx  = c({ symbol: 'SPX', section: rank.SECTIONS.INDICES, sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.INDICES], score: 8, direction: 'Bullish',  movePhase: 'early',  moveAge: 1, moveSpeed: 1.5, lateEntryRisk: 'low' });
  const ger  = c({ symbol: 'GER40', section: rank.SECTIONS.INDICES, sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.INDICES], score: 7, direction: 'Bullish', movePhase: 'mid', moveAge: 3, moveSpeed: 1.2, lateEntryRisk: 'low-to-moderate' });
  // Equities — two candidates.
  const nvda = c({ symbol: 'NVDA', section: rank.SECTIONS.EQUITIES,    sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.EQUITIES],    score: 8, direction: 'Bullish',  movePhase: 'mid',    moveAge: 3, moveSpeed: 1.3, lateEntryRisk: 'low-to-moderate' });
  const amd  = c({ symbol: 'AMD',  section: rank.SECTIONS.EQUITIES,    sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.EQUITIES],    score: 7, direction: 'Bullish',  movePhase: 'late',   moveAge: 6, moveSpeed: 1.1, lateEntryRisk: 'moderate-to-high' });
  // Commodities — two candidates.
  const xau  = c({ symbol: 'XAUUSD', section: rank.SECTIONS.COMMODITIES, sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.COMMODITIES], score: 8, direction: 'Bearish',   movePhase: 'late',  moveAge: 5, moveSpeed: 1.1, lateEntryRisk: 'moderate-to-high', safeHavenOverlay: true });
  const wti  = c({ symbol: 'WTI',    section: rank.SECTIONS.COMMODITIES, sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.COMMODITIES], score: 7, direction: 'Bearish',   movePhase: 'mid',   moveAge: 2, moveSpeed: 1.2, lateEntryRisk: 'low-to-moderate' });
  // Safe-haven — one candidate.
  const usdjpy = c({ symbol: 'USDJPY', section: rank.SECTIONS.FX_MAJORS, sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.FX_MAJORS], score: 6, direction: 'Bullish', movePhase: 'mid', moveAge: 2, moveSpeed: 1.0, lateEntryRisk: 'low-to-moderate', safeHavenOverlay: true });

  // Three indices supplied; enforce sectionCap=2 by hand the same
  // way rankCandidates does. GER40 is trimmed.
  const top10 = [eu, ndx, spx, nvda, xau, gu, amd, wti, usdjpy].slice(0, 10);
  return {
    top10,
    perSectionCount: {
      fx_majors: 3, indices: 2, equities: 2, commodities: 2,
    },
    sectionsScanned: ['fx_majors', 'indices', 'equities', 'commodities'],
    sectionCapsApplied: ['indices'],
    allCount: 9,
  };
}

const ranking = buildFixtureRanking();
const volatility = { level: 'elevated', vixLevel: 'Elevated', watchCount: 0, internalCount: 3, avgInternalScore: 5.1, reason: '3 internal candidates' };
const payload = rank.buildRankedMovementDigestPayload(ranking, volatility, { now: Date.parse('2026-05-12T04:00:00Z') });
const content = payload.content;

// Count the candidates the digest actually rendered (after the
// builder's per-section ≤2 clip). The "**#N — SYMBOL" or
// "**⭐ #N — SYMBOL" card header is unique to expanded
// candidate cards and never appears in the standouts/footer.
const renderedCardRe = /\*\*[⭐\s]*#\d+ — [A-Z0-9]+/g;
const renderedCardCount = (content.match(renderedCardRe) || []).length;

// ============================================================
// T1 — criteria paragraph present
// ============================================================
console.log('\n[T1] Dark Horse criteria paragraph present');
{
  ok('digest carries **Dark Horse criteria:**',
     /\*\*Dark Horse criteria:\*\*/.test(content));
  ok('criteria paragraph mentions 15-minute scan cadence',
     /every 15 minutes/.test(content));
  ok('criteria paragraph explains ⭐ as standout marker',
     /⭐ marks the strongest standouts/.test(content));
}

// ============================================================
// T2 — candidates grouped by section in canonical order
// ============================================================
console.log('\n[T2] Section grouping in canonical order');
{
  const sections = [];
  for (const sec of rank.SECTION_DISPLAY_ORDER) {
    const lbl = rank.SECTION_LABEL[sec];
    if (content.includes(`### ${lbl}`)) sections.push(lbl);
  }
  ok('at least 4 sections rendered', sections.length >= 4, { sections });

  // Section headers must appear in canonical order in the body.
  let lastIdx = -1;
  for (const lbl of sections) {
    const idx = content.indexOf(`### ${lbl}`);
    ok(`section "${lbl}" appears after prior section`, idx > lastIdx, { lbl, idx, lastIdx });
    lastIdx = idx;
  }
}

// ============================================================
// T3 — max two candidates per section
// ============================================================
console.log('\n[T3] Max two candidates per section');
{
  // Each rendered candidate begins with "**…#N — SYMBOL …**" — count
  // those between consecutive "### " section markers.
  const SECTION_RE = /### (?!⭐)([^\n]+)\n\n/g;
  const headerMatches = [...content.matchAll(SECTION_RE)];
  for (let i = 0; i < headerMatches.length; i++) {
    const start = headerMatches[i].index + headerMatches[i][0].length;
    const end   = (i + 1 < headerMatches.length) ? headerMatches[i + 1].index : content.length;
    const segment = content.slice(start, end);
    const candidateCount = (segment.match(/\*\*[⭐\s]*#\d+ — /g) || []).length;
    ok(`section "${headerMatches[i][1].trim()}" has ≤ 2 candidates (saw ${candidateCount})`,
       candidateCount <= 2, { section: headerMatches[i][1].trim(), candidateCount });
  }
}

// ============================================================
// T4 — ⭐ on exactly two overall standouts
// ============================================================
console.log('\n[T4] ⭐ standouts');
{
  // The standouts block lists "⭐ #1 …" and "⭐ #2 …" lines.
  const ranked = (content.match(/^- ⭐ #\d+ /gm) || []);
  ok('standouts block lists exactly 2 ⭐ entries', ranked.length === 2, { ranked });

  // Each section block also marks the standout's expanded card
  // with the ⭐ marker. Count expanded cards carrying ⭐.
  const starredCards = (content.match(/\*\*⭐ #\d+ — /g) || []);
  ok('section blocks carry exactly 2 ⭐-marked expanded cards',
     starredCards.length === 2, { starredCards });
}

// ============================================================
// T5 — standout tie-break rules
// ============================================================
console.log('\n[T5] Standout tie-break — early > mid > late, lower late-entry-risk wins on score tie');
{
  // EURUSD (score 9, early) and NDX (score 9, mid) tie on score.
  // Selection must prefer EURUSD (early > mid).
  const standouts = rank.selectStandouts(ranking.top10, 2);
  ok('EURUSD is #1 standout (early beats mid on tied score)',
     standouts[0] && standouts[0].symbol === 'EURUSD',
     standouts.map(s => `${s.symbol}(${s.score},${s.movePhase})`));
  ok('NDX is #2 standout',
     standouts[1] && standouts[1].symbol === 'NDX',
     standouts.map(s => `${s.symbol}(${s.score},${s.movePhase})`));

  // Tertiary: at the same score AND same phase, lower late-entry-
  // risk should win. Build a 2-candidate fixture to verify.
  const a = mkEnriched({ symbol: 'AAA', score: 8, movePhase: 'mid', lateEntryRisk: 'low' });
  const b = mkEnriched({ symbol: 'BBB', score: 8, movePhase: 'mid', lateEntryRisk: 'moderate-to-high' });
  const tiePick = rank.selectStandouts([b, a], 1);
  ok('on phase tie, lower late-entry-risk wins',
     tiePick[0] && tiePick[0].symbol === 'AAA', tiePick[0]);

  // Quaternary: at same score, phase, and risk, higher moveSpeed wins.
  const sa = mkEnriched({ symbol: 'AAA', score: 8, movePhase: 'mid', lateEntryRisk: 'low', moveSpeed: 1.2 });
  const sb = mkEnriched({ symbol: 'BBB', score: 8, movePhase: 'mid', lateEntryRisk: 'low', moveSpeed: 1.7 });
  const speedPick = rank.selectStandouts([sa, sb], 1);
  ok('on risk tie, higher move speed wins',
     speedPick[0] && speedPick[0].symbol === 'BBB', speedPick[0]);
}

// ============================================================
// T6 — Trend age per shown candidate
// ============================================================
console.log('\n[T6] Trend age appears for each shown candidate');
{
  const ageLines = (content.match(/^Trend age:/gm) || []).length;
  ok(`Trend age: appears once per shown candidate (${renderedCardCount} cards, ${ageLines} lines)`,
     ageLines === renderedCardCount, { ageLines, cards: renderedCardCount });
}

// ============================================================
// T7 — Trend phase per shown candidate
// ============================================================
console.log('\n[T7] Trend phase appears for each shown candidate');
{
  const phaseLines = (content.match(/^Trend phase:/gm) || []).length;
  ok(`Trend phase: appears once per shown candidate (${phaseLines} lines)`,
     phaseLines === renderedCardCount, { phaseLines, cards: renderedCardCount });
}

// ============================================================
// T8 — Continuation window per shown candidate
// ============================================================
console.log('\n[T8] Continuation window appears for each shown candidate');
{
  const continLines = (content.match(/^Continuation window:/gm) || []).length;
  ok(`Continuation window: appears once per shown candidate (${continLines} lines)`,
     continLines === renderedCardCount, { continLines, cards: renderedCardCount });
}

// ============================================================
// T9 — "controlled pullback" never bare in Dark Horse output
// ============================================================
console.log('\n[T9] "controlled pullback" does not appear bare anywhere');
{
  ok('digest contains no bare "controlled pullback"',
     !/\bcontrolled pullback\b/i.test(content), { sample: content.slice(0, 200) });
  ok('digest carries the _Calm retest_ glossary explanation',
     /_Calm retest_:/.test(content));
  // Also sweep the watch payload via buildDHPayload — the only
  // other Dark Horse output surface.
  const watchPayload = engine.buildDHPayload({
    symbol: 'EURUSD', score: 8, direction: 'Bullish',
    trendPhase: 'early', trendAge: 1, confirmationLevel: '178.40',
    transitionRisk: 'low', cancellationLevel: '178.00',
    bias: 'Bullish', summary: 'mid-stage continuation',
  });
  const watchContent = (watchPayload && watchPayload.content) || '';
  ok('watch payload contains no bare "controlled pullback"',
     !/\bcontrolled pullback\b/i.test(watchContent), { sample: watchContent.slice(0, 200) });
}

// ============================================================
// T10 — banned trading-directive phrases absent
// ============================================================
console.log('\n[T10] Banned trading-directive phrases are absent');
{
  const BANNED = [
    /\benter\s+now\b/i,
    /\bbuy\s+now\b/i,
    /\bsell\s+now\b/i,
    /\bdo\s+not\s+enter\b/i,
    /\bdoes\s+not\s+mean\s+enter\s+now\b/i,
    /\bpermission\b/i,
    /\bauthori[sz]ed?\b/i,
    /\bauthori[sz]ation\b/i,
    /\bmust\s+(?:buy|sell|enter|trade|act|take)\b/i,
    /\bguarante(?:e|ed|es|eing)\b/i,
    /\brocket(?:s|ed|ing)?\b/i,
    /\bmoonshot\b/i,
  ];
  for (const re of BANNED) {
    ok(`banned phrase absent: ${re}`,
       !re.test(content),
       re.test(content) ? { match: content.match(re) } : undefined);
  }
}

// ============================================================
// T11 — chunked delivery still works for the longer output
// ============================================================
console.log('\n[T11] Chunked delivery still works for the longer output');
{
  const chunks = engine._dhChunkDigest(content, { max: engine.DH_CHUNK_MAX_DEFAULT });
  ok('chunker produces at least 1 chunk', chunks.length >= 1, { chunkCount: chunks.length });
  for (let i = 0; i < chunks.length; i++) {
    ok(`chunk ${i + 1}/${chunks.length} ≤ DH_CHUNK_MAX_DEFAULT (${engine.DH_CHUNK_MAX_DEFAULT})`,
       chunks[i].length <= engine.DH_CHUNK_MAX_DEFAULT,
       { i, len: chunks[i].length });
    ok(`chunk ${i + 1}/${chunks.length} ≤ Discord 2000-char hard limit`,
       chunks[i].length <= engine.DH_CHUNK_DISCORD_HARD_LIMIT,
       { i, len: chunks[i].length });
  }
  // Part labels sequential.
  for (let i = 0; i < chunks.length; i++) {
    const expect = new RegExp(`^🐎 \\*\\*DARK HORSE — GLOBAL MOVER RADAR \\(v1\\.1\\)\\*\\* — Part ${i + 1}\\/${chunks.length}\\n\\n`);
    ok(`chunk ${i + 1} carries Part ${i + 1}/${chunks.length} label`,
       expect.test(chunks[i]),
       { i, head: chunks[i].slice(0, 80) });
  }
  // Every "**#N — SYMBOL" or "**⭐ #N — SYMBOL" candidate header
  // in the source must still appear in the joined chunk bodies.
  // We don't anchor on `^` because the chunker strips leading /
  // trailing newlines per body — line-start boundaries are not
  // preserved across joined bodies. The card-header pattern is
  // unique enough to count without the anchor.
  const joined = chunks.map(c => c.replace(/^🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\* — Part \d+\/\d+\n\n/, '')).join('');
  const sourceHeaderCount = (content.match(/\*\*[⭐\s]*#\d+ — [A-Z0-9]+/g) || []).length;
  const joinedHeaderCount = (joined.match(/\*\*[⭐\s]*#\d+ — [A-Z0-9]+/g) || []).length;
  ok('every candidate header preserved across chunks',
     joinedHeaderCount === sourceHeaderCount,
     { sourceHeaderCount, joinedHeaderCount });
}

// ============================================================
// summary
// ============================================================
console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('[DH-RADAR-QA] PASS — section radar + ⭐ standouts + plain-English wording verified.');
process.exit(0);
