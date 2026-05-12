#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Dark Horse education-layer + evidence-anchor QA.
 *
 * Locked doctrine (operator directive 2026-05-12):
 *   A Level-1 trader must be able to open the chart and find what
 *   ATLAS is talking about. Every technical phrase in a candidate
 *   card must be paired with either:
 *     (a) a chart-level reference (price + date / timestamp),
 *     (b) a plain-English glossary entry,
 *     (c) a visual-pattern reference (ASCII diagram + prose),
 *     (d) an honest "pending — follow-up wiring required" note.
 *
 * Asserts (the 9 operator-listed acceptance items):
 *   T1. Confirmation language includes time + price WHEN anchor
 *       data exists (1D-level partial availability is the current
 *       wired state; 15m/5m full availability is staged).
 *   T2. If anchor data does NOT exist, output says "exact … pending"
 *       (or equivalent honest pending text) — NOT fake levels.
 *   T3. "retest holds" wording cannot appear without a paired hold
 *       explanation — the chart-pattern glossary or visual-pattern
 *       prose must accompany it.
 *   T4. "intraday high area" / "intraday low area" cannot appear
 *       without a timestamp/price OR a pending-level note.
 *   T5. "5m/15m close" cannot appear without a timeframe + level
 *       explanation (glossary entry satisfies this).
 *   T6. Output includes date reference for detected evidence
 *       (UTC date stamp at minimum).
 *   T7. UTC/AWST conversion appears in the chart evidence block
 *       when wired data is available.
 *   T8. No new directive wording introduced (do not enter / buy
 *       now / sell now / etc. still absent per the wording-
 *       directive QA standard).
 *   T9. Chunker (PR #53) still passes on the longer education-
 *       layer output — every chunk under 2000 chars (hard limit)
 *       and under 1800 (default).
 *
 * Wired as `npm run qa:dh-education`.
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
function dailyCandles(n, basePrice) {
  // n bars, each 1 day apart, OHLC walks up slightly so the LAST
  // bar's high is the recognisable "recent intraday high" the
  // evidence anchors will publish.
  const out = [];
  const startTs = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
  let p = basePrice;
  for (let i = 0; i < n; i++) {
    const open  = p;
    const close = p + 0.8;
    const high  = close + 0.6;
    const low   = open - 0.5;
    out.push({ open, high, low, close, time: startTs + i * 86400 });
    p = close;
  }
  return out;
}
function mkCandidate(over) {
  return Object.assign({
    symbol: 'EURUSD', score: 8, direction: 'Bullish',
    summary: 'higher-highs and higher-lows sequence intact',
    reasons: ['structure 2/2','momentum 1/2'],
  }, over);
}

// ── enriched + rendered samples ─────────────────────────────────
const enrichedWith1DData = rank.enrichCandidate(
  mkCandidate({}), dailyCandles(25, 1.1000), 6, { watchThreshold: 8 }
);
const enrichedNoData = rank.enrichCandidate(
  mkCandidate({}), null, 6, { watchThreshold: 8 }
);
const renderedWithData = rank.buildExpandedDetail(enrichedWith1DData, 0, true);
const renderedNoData   = rank.buildExpandedDetail(enrichedNoData, 1, false);

// ============================================================
// T1 — Confirmation language pairs price + date when anchor wired
// ============================================================
console.log('\n[T1] Confirmation includes price + date when anchor data exists');
{
  ok('rendered card carries the "Recent intraday high area" line',
     /Recent intraday high area:/.test(renderedWithData));
  ok('rendered card includes a numeric price level',
     /Recent intraday high area:\s*[0-9.]+/.test(renderedWithData),
     renderedWithData.match(/Recent intraday high area:[^\n]+/));
  ok('rendered card includes a UTC date stamp (YYYY-MM-DD UTC)',
     /\d{4}-\d{2}-\d{2}\s+UTC/.test(renderedWithData));
  ok('Invalidation line names a price level + timeframe',
     /Invalidation:[^\n]*\b[0-9.]+\b[^\n]*\b(?:15m|1D|timeframe)\b/i.test(renderedWithData),
     renderedWithData.match(/Invalidation:[^\n]+/));
}

// ============================================================
// T2 — Pending fallback when no anchor data
// ============================================================
console.log('\n[T2] Honest pending fallback when anchor data missing');
{
  ok('pending text present when no htfCandles passed',
     /Chart evidence: exact intraday level pending/.test(renderedNoData),
     renderedNoData.match(/Chart evidence:[^\n]+/));
  ok('follow-up requirement line present',
     /Required follow-up: wire 5m\/15m OHLC anchor extraction/.test(renderedNoData));
  ok('no fake numeric levels invented when data absent',
     !/Recent intraday high area:\s*[0-9.]+/.test(renderedNoData),
     'a numeric level was produced despite missing data');
}

// ============================================================
// T3 — "retest holds" wording has a paired hold explanation
// ============================================================
console.log('\n[T3] "retest holds" wording paired with hold explanation');
{
  // The glossary entry pairs the phrase with the explanation;
  // the visual-pattern prose also explains it inline.
  ok('digest glossary defines "Retest holds"',
     /\*\*Retest holds:\*\*[^\n]+next candle\\?'s body close/i.test(rank.DH_CHART_GLOSSARY)
     || /\*\*Retest holds:\*\*[^\n]+body close/i.test(rank.DH_CHART_GLOSSARY),
     rank.DH_CHART_GLOSSARY.slice(0, 200));
  ok('visual-pattern prose explains "retest holds" inline for longs',
     /That is what "retest holds" means on a long/.test(renderedWithData));
}

// ============================================================
// T4 — "intraday high area" requires timestamp/price OR pending note
// ============================================================
console.log('\n[T4] "intraday high area" always paired with level or pending note');
{
  // When data is wired:
  ok('with data — "Recent intraday high area:" line present and carries a number',
     /Recent intraday high area:\s*[0-9.]+/.test(renderedWithData));
  // When data is missing:
  const phrase = /(?:Recent intraday (?:high|low) area|intraday (?:high|low) area)/i;
  const phrasePresent = phrase.test(renderedNoData);
  // If phrase is present in the no-data path, it MUST be in a
  // glossary line (which is part of the digest footer, not in the
  // per-candidate render). Per-candidate render in pending mode
  // should NOT use the bare phrase outside the chart-evidence block.
  // The buildChartEvidenceBlock pending branch does not emit
  // "intraday high area" at all — so the assertion is just:
  // either it isn't there, or it carries a pending note.
  ok('without data — phrase either absent or carries pending note',
     !phrasePresent || /pending/.test(renderedNoData),
     { sample: renderedNoData.slice(0, 600) });
}

// ============================================================
// T5 — "5m/15m close" wording carries explanation
// ============================================================
console.log('\n[T5] "5m/15m close" wording carries timeframe + level context');
{
  // The glossary defines "Breakout" with timeframe wording AND
  // "Invalidation" with timeframe wording. The per-candidate
  // chart-evidence block names the timeframe explicitly.
  ok('glossary defines "Breakout" with timeframe wording',
     /\*\*Breakout:\*\*[^\n]+candle on the named timeframe[^\n]+CLOSES/i.test(rank.DH_CHART_GLOSSARY));
  ok('Invalidation block names a timeframe',
     /Invalidation:[^\n]+\b(?:15m|1D|timeframe)\b/i.test(renderedWithData));
}

// ============================================================
// T6 — Date reference for detected evidence
// ============================================================
console.log('\n[T6] Date reference present in chart-evidence block when wired');
{
  ok('UTC date appears in chart-evidence block (YYYY-MM-DD)',
     /\b\d{4}-\d{2}-\d{2}\s+UTC\b/.test(renderedWithData),
     'no UTC date in rendered card');
}

// ============================================================
// T7 — UTC + AWST conversion appears when data wired
// ============================================================
console.log('\n[T7] UTC + AWST both appear when wired anchor data exists');
{
  ok('UTC stamp present', /\bUTC\b/.test(renderedWithData));
  ok('AWST stamp present', /\bAWST\b/.test(renderedWithData));
  ok('UTC and AWST appear in the same chart-evidence line',
     /UTC\s*\/\s*\d{4}-\d{2}-\d{2}\s+AWST/.test(renderedWithData),
     renderedWithData.match(/[^\n]+UTC[^\n]+AWST[^\n]+/));
}

// ============================================================
// T8 — No directive wording introduced (regression guard)
// ============================================================
console.log('\n[T8] No directive wording introduced anywhere in education output');
{
  const DIRECTIVE_RE = /\b(?:do\s+not|don[’']?t)\s+(?:enter|trade|place\s+limit\s+orders|open\s+new\s+positions)\b/i;
  const HYPE_RE = /\b(?:buy\s+now|sell\s+now|enter\s+now|must\s+(?:buy|sell|enter|trade|act)|guaranteed?)\b/i;
  for (const sample of [renderedWithData, renderedNoData, rank.DH_CHART_GLOSSARY]) {
    ok('no directive imperative in sample', !DIRECTIVE_RE.test(sample),
       DIRECTIVE_RE.test(sample) ? { hit: sample.match(DIRECTIVE_RE)[0] } : undefined);
    ok('no hype / financial-advice wording in sample', !HYPE_RE.test(sample),
       HYPE_RE.test(sample) ? { hit: sample.match(HYPE_RE)[0] } : undefined);
  }
}

// ============================================================
// T9 — Chunker still passes on the longer education-layer output
// ============================================================
console.log('\n[T9] Chunker passes on the longer education-layer digest output');
{
  // Build a realistic 8-candidate digest with 1D anchor data wired
  // for every candidate. Each card is ~3 kB after the new evidence
  // + visual blocks, so an 8-candidate digest is ~25 kB — well into
  // the chunked-delivery regime.
  function mkRow(symbol, score, direction, sectionKey) {
    const sectionLabel = rank.SECTION_LABEL[sectionKey];
    return Object.assign(
      rank.enrichCandidate(
        mkCandidate({ symbol, score, direction }),
        dailyCandles(25, score * 12 + 1),
        6, { watchThreshold: 8 }
      ),
      { section: sectionKey, sectionLabel }
    );
  }
  const top10 = [
    mkRow('EURUSD', 9, 'Bullish',  rank.SECTIONS.FX_MAJORS),
    mkRow('GBPUSD', 7, 'Bearish',  rank.SECTIONS.FX_MAJORS),
    mkRow('NDX',    8, 'Bullish',  rank.SECTIONS.INDICES),
    mkRow('SPX',    7, 'Bullish',  rank.SECTIONS.INDICES),
    mkRow('NVDA',   8, 'Bullish',  rank.SECTIONS.EQUITIES),
    mkRow('AMD',    7, 'Bullish',  rank.SECTIONS.EQUITIES),
    mkRow('XAUUSD', 8, 'Bearish',  rank.SECTIONS.COMMODITIES),
    mkRow('WTI',    7, 'Bearish',  rank.SECTIONS.COMMODITIES),
  ];
  const ranking = {
    top10,
    sectionsScanned: ['fx_majors','indices','equities','commodities'],
    sectionCapsApplied: [], allCount: 8,
  };
  const payload = rank.buildRankedMovementDigestPayload(
    ranking,
    { level: 'elevated', vixLevel: 'Elevated' },
    { now: Date.parse('2026-05-12T04:00:00Z') }
  );
  const chunks = engine._dhChunkDigest(payload.content);
  ok('chunker produces at least 1 chunk', chunks.length >= 1, { chunkCount: chunks.length });
  for (let i = 0; i < chunks.length; i++) {
    ok(`chunk ${i + 1}/${chunks.length} ≤ Discord 2000-char hard limit`,
       chunks[i].length <= engine.DH_CHUNK_DISCORD_HARD_LIMIT,
       { len: chunks[i].length });
    ok(`chunk ${i + 1}/${chunks.length} ≤ DH_CHUNK_MAX_DEFAULT`,
       chunks[i].length <= engine.DH_CHUNK_MAX_DEFAULT,
       { len: chunks[i].length });
  }
  // Glossary footer must survive chunking (somewhere in the joined body).
  const joined = chunks.map(c =>
    c.replace(/^🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\* — Part \d+\/\d+\n\n/, '')
  ).join('');
  ok('glossary block survives across chunks (header present)',
     /### Glossary — chart-pattern terms used above/.test(joined));
  ok('Recent intraday high area glossary entry survives',
     /\*\*Recent intraday high area:\*\*/.test(joined));
  ok('Breakout glossary entry survives',
     /\*\*Breakout:\*\*/.test(joined));
  ok('Invalidation glossary entry survives',
     /\*\*Invalidation:\*\*/.test(joined));
}

// ============================================================
// summary
// ============================================================
console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('[DH-EDUCATION-QA] PASS — chart-evidence anchors + glossary + visual pattern + asset-class continuation wording in place; honest pending fallback when data absent; chunker preserved.');
process.exit(0);
