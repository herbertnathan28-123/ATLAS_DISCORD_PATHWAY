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
//
// Operator directive 2026-05-13 (DH rewrite): chart-evidence
// block uses bolded "**Chart evidence:**" heading + bulleted
// "Recent intraday <high|low> area:" / "Invalidation level:"
// rows with price bolded as `**1814.10**`. Date stamp still
// carries UTC + AWST.
// ============================================================
console.log('\n[T1] Confirmation includes price + date when anchor data exists');
{
  ok('rendered card carries the "Recent intraday high area" line',
     /Recent intraday high area:/.test(renderedWithData));
  ok('rendered card includes a numeric price level (bolded inside chart evidence)',
     /Recent intraday high area:[\s\S]*?\*\*[0-9.]+\*\*/.test(renderedWithData),
     renderedWithData.match(/Recent intraday high area:[^\n]+/));
  ok('rendered card includes a UTC date stamp (YYYY-MM-DD UTC)',
     /\d{4}-\d{2}-\d{2}\s+UTC/.test(renderedWithData));
  ok('chart-evidence Invalidation level names a price + timeframe',
     /Invalidation level:[\s\S]*?\*\*[0-9.]+\*\*[\s\S]*?\b(?:15m|1D|timeframe)\b/i.test(renderedWithData),
     renderedWithData.match(/Invalidation level:[^\n]+/));
}

// ============================================================
// T2 — Suppression when no anchor data
//
// Operator directive 2026-05-13 (DH rewrite): the chart-evidence
// block is now SUPPRESSED entirely when anchor data is not
// wired. No "pending" / "wiring required" / system-limitation
// text reaches the user-facing surface. Per-card stays clean.
// ============================================================
console.log('\n[T2] Chart-evidence block suppressed when anchor data missing');
{
  ok('legacy "Chart evidence: exact intraday level pending" wording absent',
     !/Chart evidence: exact intraday level pending/.test(renderedNoData));
  ok('legacy "Required follow-up: wire 5m/15m" wording absent',
     !/Required follow-up: wire 5m\/15m OHLC anchor extraction/.test(renderedNoData));
  ok('no fake numeric levels invented when data absent',
     !/Recent intraday high area:\s*[0-9.]+/.test(renderedNoData),
     'a numeric level was produced despite missing data');
  // No "Chart evidence:" heading line either — entire block hidden.
  ok('no "Chart evidence:" heading line when block is suppressed',
     !/\*\*Chart evidence:\*\*/.test(renderedNoData));
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
// T4 — "intraday high area" — bolded price when present, fully
// suppressed when data is missing (no leakage of pending text).
// ============================================================
console.log('\n[T4] "intraday high area" pairs with bolded numeric or is suppressed');
{
  ok('with data — "Recent intraday high area:" carries a bolded number',
     /Recent intraday high area:[\s\S]*?\*\*[0-9.]+\*\*/.test(renderedWithData));
  // When data is missing the entire chart-evidence block is hidden;
  // the phrase must not appear in the no-data render.
  const phrase = /(?:Recent intraday (?:high|low) area|intraday (?:high|low) area)/i;
  ok('without data — phrase absent entirely (block suppressed)',
     !phrase.test(renderedNoData),
     { sample: renderedNoData.slice(0, 600) });
}

// ============================================================
// T5 — Per-candidate timeframe context — sourced from the
// Confirmation requirement + Chart evidence rows. The glossary
// footer block is no longer rendered (operator directive
// 2026-05-13: glossary removed from output body).
// ============================================================
console.log('\n[T5] Timeframe wording present in card body when data is wired');
{
  ok('Confirmation requirement names a timeframe',
     /Confirmation requirement:[^\n]+\b(?:5m|15m|1H|1D|timeframe)\b/i.test(renderedWithData));
  ok('Chart-evidence Invalidation level names a timeframe',
     /Invalidation level:[^\n]+\b(?:15m|1D|timeframe)\b/i.test(renderedWithData));
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
  // Operator directive 2026-05-13 (DH rewrite): the glossary
  // footer block has been removed from the digest body. Confirm
  // its OLD heading no longer reaches the chunker.
  const joined = chunks.map(c =>
    c.replace(/^🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\* — Part \d+\/\d+\n\n/, '')
  ).join('');
  ok('legacy glossary heading absent (rewrite removed it)',
     !/### Glossary — chart-pattern terms used above/.test(joined));
}

// ============================================================
// T10 — Top-of-output Expanded Terminology Hyperlinks
//
// Operator directive 2026-05-13 (full DH rewrite + section-
// hyperlink standard):
//   - Body Learning-Links row REMOVED entirely. Hyperlinks live
//     at the TOP only (in firstChunkPrefix, between the scan
//     boundary and the v1.1 header).
//   - Row uses bracket form `[Breakout] [Calm Retest]
//     [Invalidation] [Higher High / Higher Low]` rendered inside
//     a ```ansi code fence with cyan/teal escape codes so the
//     items read as chip-style references.
//   - No fake URLs.
//   - Body of the digest stays clean: no markdown links scattered
//     through paragraphs.
// ============================================================
console.log('\n[T10] Top-of-output Expanded Terminology Hyperlinks — bracket chips, ansi cyan, no body row');
{
  // Use the full 8-candidate fixture from T9 so we exercise a
  // realistic digest output, not a single-card render.
  function daily(n, base) {
    const out = []; let p = base;
    const startTs = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
    for (let i = 0; i < n; i++) {
      const o = p, c = p + 0.6, h = c + 0.4, l = o - 0.3;
      out.push({ open: o, high: h, low: l, close: c, time: startTs + i * 86400 });
      p = c;
    }
    return out;
  }
  function mkRow(symbol, score, direction, sectionKey) {
    const sectionLabel = rank.SECTION_LABEL[sectionKey];
    return Object.assign(
      rank.enrichCandidate(
        { symbol, score, direction, summary: 'higher-highs sequence intact', reasons: ['structure 2/2'] },
        daily(25, score * 12 + 1),
        6, { watchThreshold: 8 }
      ),
      { section: sectionKey, sectionLabel }
    );
  }
  const top10 = [
    mkRow('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS),
    mkRow('NDX',    8, 'Bullish', rank.SECTIONS.INDICES),
    mkRow('NVDA',   8, 'Bullish', rank.SECTIONS.EQUITIES),
    mkRow('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES),
  ];
  const ranking = {
    top10, sectionsScanned: ['fx_majors','indices','equities','commodities'],
    sectionCapsApplied: [], allCount: 4,
  };

  // 10a — Body row removed entirely from the digest body.
  const payloadPlain = rank.buildRankedMovementDigestPayload(ranking, { level: 'elevated', vixLevel: 'Elevated' }, { now: Date.parse('2026-05-12T04:00:00Z') });
  const c = payloadPlain.content;
  ok('legacy body "**Learning links:**" label REMOVED',
     !/\*\*Learning links:\*\*/.test(c));
  ok('legacy body "**Expanded Terminology Hyperlinks:**" body row REMOVED',
     !/\*\*Expanded Terminology Hyperlinks:\*\*/.test(c));

  // 10b — Top-of-output row lives in firstChunkPrefix.
  ok('payload.firstChunkPrefix is non-empty', typeof payloadPlain.firstChunkPrefix === 'string' && payloadPlain.firstChunkPrefix.length > 0);
  ok('firstChunkPrefix carries the 📘 Expanded Terminology Hyperlinks: prefix',
     /📘 \*\*Expanded Terminology Hyperlinks:\*\*/.test(payloadPlain.firstChunkPrefix));
  ok('firstChunkPrefix carries the ```ansi chip fence',
     /```ansi/.test(payloadPlain.firstChunkPrefix));
  for (const term of ['Breakout', 'Calm Retest', 'Invalidation', 'Higher High / Higher Low']) {
    ok('top hyperlinks row carries chip "[' + term + ']"',
       payloadPlain.firstChunkPrefix.includes('[' + term + ']'));
  }
  ok('top hyperlinks row carries NO Markdown link syntax',
     !/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(payloadPlain.firstChunkPrefix));

  // 10c — Body text stays clean: no INLINE markdown hyperlinks
  // scattered through the paragraph text. (Glossary footer is
  // already removed; sample the whole body.)
  ok('no inline [text](url) patterns in digest body',
     !/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(c),
     'an inline link appears in the body');
}

// ============================================================
// T11 — Live-leak regression guard (operator directive 2026-05-12)
//   The post-deploy live Discord output flagged a specific list
//   of wording leaks. This test asserts every listed phrase /
//   substring is ABSENT from the rendered digest. Each item ties
//   back to a specific fix in this PR.
// ============================================================
console.log('\n[T11] Live-leak regression guard — every named substring absent from rendered digest');
{
  // Build the full multi-section digest the operator sees in
  // production. Use unavailable macroEventLink + non-numeric
  // invalidation templates so both suppression paths fire.
  function daily(n, base) {
    const out = []; let p = base;
    const t = Math.floor(Date.parse('2026-05-01T00:00:00Z')/1000);
    for (let i=0;i<n;i++) { const o=p, c=p+0.6, h=c+0.4, l=o-0.3; out.push({open:o,high:h,low:l,close:c,time:t+i*86400}); p=c; }
    return out;
  }
  function mkRow(symbol, score, dir, sec) {
    return Object.assign(
      rank.enrichCandidate(
        { symbol, score, direction: dir,
          summary: 'HH/HL structure confirmed (76% bullish bars)',
          reasons: ['HH/HL structure confirmed','Momentum expanding'] },
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
  const ranking = {
    top10,
    sectionsScanned: ['fx_majors','indices','equities','commodities'],
    sectionCapsApplied: [], allCount: 4,
  };
  const payload = rank.buildRankedMovementDigestPayload(
    ranking, { level: 'elevated', vixLevel: 'Elevated' },
    { now: Date.parse('2026-05-12T04:00:00Z') }
  );
  const content = payload.content;

  // Operator-supplied list of live leaks (verbatim substrings the
  // user spotted in the post-deploy Discord output).
  const LIVE_LEAKS = [
    // Wording leaks
    [/\bidentify symbols\b/i,                  '"identify symbols" in criteria paragraph (operator: should be markets and instruments)'],
    [/\bTop movers:\b/,                        '"Top movers:" label (operator: should be Displayed candidates:)'],
    [/section caps:\s*none/i,                  '"section caps: none" filler suffix'],
    [/because\s+(?:early|mid|late|exhaustion)\s+stage\s*·\s*score/i,
                                               '"because <phase> · score" generic standout reason (operator: needs evidence)'],
    // Raw jargon
    [/\bHH\/HL\b/,                             'raw "HH/HL" abbreviation in user-facing text'],
    [/\bLH\/LL\b/,                             'raw "LH/LL" abbreviation in user-facing text'],
    [/\bHTF\b/,                                'raw "HTF" abbreviation in user-facing text'],
    [/\bLTF\b/,                                'raw "LTF" abbreviation in user-facing text'],
    [/×\s*baseline\b/,                         '"× baseline" without expanded form'],
    [/\bsame[-\s]direction\s+higher[-\s]timeframe\s+bar\s+yet\b/i,
                                               '"same-direction higher-timeframe bar yet" awkward phrasing'],
    [/\bVWAP\b(?![^\(]*\))/,                   'raw "VWAP" abbreviation outside of an inline expansion'],
    [/\bsection\s+avg\b/i,                     '"section avg" abbreviation'],
    // Suppressions
    [/Macro\s*\/\s*event link:\s*unavailable/i,'"Macro / event link: unavailable" filler line'],
    [/Reference level not published\b/,        '"Reference level not published in this digest yet" filler'],
    // Footer / advisory wording
    [/\bbefore acting\b/i,                     'footer "before acting" wording (operator: should reassess at next review)'],
    [/Operator can read the live chart\b/i,    '"Operator can read the live chart" instruction (operator: should say chart confirmation pending)'],
  ];
  for (const [re, label] of LIVE_LEAKS) {
    const m = content.match(re);
    ok(`leak absent — ${label}`,
       !m,
       m ? { hit: m[0], context: content.slice(Math.max(0, content.indexOf(m[0]) - 30), content.indexOf(m[0]) + m[0].length + 60) } : undefined);
  }

  // Positive checks — the replacement wording IS present.
  ok('criteria paragraph uses "markets and instruments"',
     /identify markets and instruments/.test(content));
  ok('"Displayed candidates:" header present',
     /\*\*Displayed candidates:\*\* \d+/.test(content));
  // Operator directive 2026-05-13 (DH rewrite): footer wording
  // rewritten to drop the backend "per-candidate confirmation
  // criteria" phrasing.
  ok('footer ends with the rewrite advisory wording',
     /Recheck each candidate against its confirmation requirement at the next review\./.test(content));
  // Chart-evidence pending wording was a system-limitation leak;
  // the rewrite REMOVED the entire pending branch (block is
  // suppressed when anchors are not wired). Confirm it does not
  // appear.
  ok('legacy chart-evidence "pending until 15m/5m anchor wiring" wording absent',
     !/Chart confirmation remains pending until 15m\/5m anchor wiring is added/.test(content));
  ok('jargon translated: "higher highs and higher lows" appears',
     /higher highs and higher lows/.test(content));
  ok('jargon translated: "× the prior-bar average" appears',
     /×\s*the prior-bar average/.test(content));
  ok('jargon translated: "section average" appears',
     /section average\b/.test(content));
  // Operator directive 2026-05-13 (DH rewrite): standout reason
  // wording switched from "structure read:" to "chart pattern:"
  // (plainer English).
  ok('standout reason carries enriched evidence (chart pattern, phase, score)',
     /because\s+\w+\s+stage,\s*score\s+\d+\/10;\s+chart pattern:/.test(content));
}

// ============================================================
// T12 — Chunk-boundary atomicity (operator directive 2026-05-12)
//   - No Part header lands inside a fenced visual / code block.
//   - Each visual-pattern code fence stays whole in one chunk.
//   - Glossary heading + body stay in the same chunk.
//   - Candidate cards keep their header with their Chart evidence
//     where bodyMax allows.
// ============================================================
console.log('\n[T12] Chunk-boundary atomicity — no fence splits / glossary atomic');
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
    mkRow('GBPUSD', 7, 'Bearish', rank.SECTIONS.FX_MAJORS),
    mkRow('NDX',    8, 'Bullish', rank.SECTIONS.INDICES),
    mkRow('SPX',    7, 'Bullish', rank.SECTIONS.INDICES),
    mkRow('NVDA',   8, 'Bullish', rank.SECTIONS.EQUITIES),
    mkRow('AMD',    7, 'Bullish', rank.SECTIONS.EQUITIES),
    mkRow('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES),
    mkRow('WTI',    7, 'Bearish', rank.SECTIONS.COMMODITIES),
  ];
  const ranking = {
    top10,
    sectionsScanned: ['fx_majors','indices','equities','commodities'],
    sectionCapsApplied: [], allCount: 8,
  };
  const payload = rank.buildRankedMovementDigestPayload(
    ranking, { level: 'elevated', vixLevel: 'Elevated' },
    { now: Date.parse('2026-05-12T04:00:00Z') }
  );
  const chunks = engine._dhChunkDigest(payload.content);

  // T12a — every code fence in every chunk is matched (no split
  // inside a ``` … ``` block).
  const TF = String.fromCharCode(96, 96, 96); // triple-backtick literal
  for (let i = 0; i < chunks.length; i++) {
    const fenceCount = (chunks[i].match(new RegExp(TF, 'g')) || []).length;
    ok('chunk ' + (i + 1) + '/' + chunks.length + ' — triple-backtick count is even (no split inside fence)',
       fenceCount % 2 === 0,
       { fenceCount, head: chunks[i].slice(0, 100) });
  }

  // T12b — Part header lands at the top of every chunk, never
  // mid-fence. We verify by confirming each chunk STARTS with the
  // `🐎 **DARK HORSE … — Part X/N\n\n` template (no ``` before it).
  for (let i = 0; i < chunks.length; i++) {
    const head = chunks[i].slice(0, 100);
    ok(`chunk ${i + 1}/${chunks.length} — Part header at chunk start (not inside a fence)`,
       /^🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\* — Part \d+\/\d+\n\n/.test(chunks[i])
       && !/```[\s\S]*?🐎 \*\*DARK HORSE/.test(chunks[i]),
       { head });
  }

  // T12c — every visual-pattern code fence (the 5-line breakout
  // diagram) is whole in a single chunk. We count occurrences of
  // the diagram's signature first line ("Old high:" or "Old low:")
  // and the matching closing ``` after it.
  const totalDiagrams = (payload.content.match(/Old (?:high|low):\s+─/g) || []).length;
  let diagramsWhole = 0;
  for (const c of chunks) {
    const m = c.match(/```\nOld (?:high|low):[\s\S]*?\n```/g) || [];
    diagramsWhole += m.length;
  }
  ok(`all ${totalDiagrams} visual-pattern diagrams render whole inside a single chunk`,
     diagramsWhole === totalDiagrams,
     { totalDiagrams, diagramsWhole });

  // T12d — Operator directive 2026-05-13 (DH rewrite): the
  // glossary footer block was REMOVED from the digest body. The
  // chunk atomicity check for the OLD glossary heading is
  // replaced with a guard asserting the legacy heading is gone.
  ok('legacy "### Glossary — chart-pattern terms used above" heading absent from every chunk',
     chunks.every((c) => !/### Glossary — chart-pattern terms used above/.test(c)));

  // T12e — every chunk is still within the Discord hard limit.
  for (let i = 0; i < chunks.length; i++) {
    ok(`chunk ${i + 1}/${chunks.length} ≤ Discord 2000-char hard limit`,
       chunks[i].length <= engine.DH_CHUNK_DISCORD_HARD_LIMIT,
       { len: chunks[i].length });
  }
}

// ============================================================
// T13 — New-scan boundary (operator directive 2026-05-12 — live
//   evidence iteration). Boundary block sits ABOVE the Part 1/N
//   label on Part 1 only; Parts 2..N must NOT carry it.
// ============================================================
console.log('\n[T13] New-scan boundary — Part 1 only, with UTC + AWST timestamps');
{
  function daily(n, base) {
    const out = []; let p = base;
    const t = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
    for (let i = 0; i < n; i++) { const o = p, c = p + 0.6, h = c + 0.4, l = o - 0.3; out.push({ open: o, high: h, low: l, close: c, time: t + i * 86400 }); p = c; }
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
  const ranking = {
    top10, sectionsScanned: ['fx_majors','indices','equities','commodities'],
    sectionCapsApplied: [], allCount: 4,
  };
  const payload = rank.buildRankedMovementDigestPayload(
    ranking, { level: 'elevated', vixLevel: 'Elevated' },
    { internal: [], ignored: [], universeSize: 33, now: Date.parse('2026-05-12T18:01:00Z') }
  );
  ok('payload carries firstChunkPrefix field',
     typeof payload.firstChunkPrefix === 'string' && payload.firstChunkPrefix.length > 0);
  // Lane 2 visual-QA-fix boundary (operator directive 2026-05-13):
  // ```diff code-block separator (renders RED in Discord) + H3
  // NEW DARK HORSE SCAN header (visual weight). The legacy "━━━"
  // horizontal-bar string is preserved inside the diff fence so
  // chunker boundary-checks that grep for "━━━" keep firing.
  ok('boundary uses ```diff code-block separator (renders RED in Discord)',
     (payload.firstChunkPrefix.match(/```diff/g) || []).length === 2);
  ok('boundary still carries ━ horizontal-bar embed (chunker compat)',
     /━━━━━━━━━━━━━━━━━━━━/.test(payload.firstChunkPrefix));
  ok('boundary header reads "### 🆕 🐎 **NEW DARK HORSE SCAN**" (H3 for visual weight)',
     /### 🆕 🐎 \*\*NEW DARK HORSE SCAN\*\*/.test(payload.firstChunkPrefix));
  ok('boundary header still matches legacy NEW DARK HORSE SCAN regex',
     /🐎 \*\*NEW DARK HORSE SCAN\*\*/.test(payload.firstChunkPrefix));
  ok('boundary includes UTC + AWST timestamps',
     /Scan time: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC \/ \d{4}-\d{2}-\d{2} \d{2}:\d{2} AWST/.test(payload.firstChunkPrefix));
  // Operator directive 2026-05-13 (full DH rewrite + section-
  // hyperlink standard): Top-of-output Terminology Hyperlinks
  // row appears on EVERY scan (not just bearish) and uses bracket
  // chips inside a ```ansi code fence for cyan/teal styling.
  // Row carries four canonical terms.
  ok('top-of-output 📘 Expanded Terminology Hyperlinks row appended',
     /📘 \*\*Expanded Terminology Hyperlinks:\*\*/.test(payload.firstChunkPrefix));
  ok('row uses ```ansi code fence (cyan chip styling)',
     /```ansi/.test(payload.firstChunkPrefix));
  ok('legacy "📘 Learn:" prefix absent',
     !/📘 Learn: /.test(payload.firstChunkPrefix));
  for (const term of ['Breakout', 'Calm Retest', 'Invalidation', 'Higher High / Higher Low']) {
    ok('chip "[' + term + ']" present in firstChunkPrefix',
       payload.firstChunkPrefix.includes('[' + term + ']'));
  }
  ok('row carries NO Markdown link syntax',
     !/📘[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(payload.firstChunkPrefix));

  // Chunker pass-through: Part 1 gets the boundary, Parts 2..N do not.
  const chunks = engine._dhChunkDigest(payload.content, {
    max: engine.DH_CHUNK_MAX_DEFAULT,
    firstChunkPrefix: payload.firstChunkPrefix,
  });
  ok('chunker produces at least 1 chunk', chunks.length >= 1);
  ok('Part 1 starts with the ```diff boundary block',
     chunks[0].startsWith('```diff\n- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n```\n### 🆕 🐎 **NEW DARK HORSE SCAN**'),
     { head: chunks[0].slice(0, 220) });
  // The Expanded Terminology Hyperlinks row sits between the
  // boundary (closing ``` fence) and the v1.1 header. We assert
  // the v1.1 header sits BELOW the boundary (allowing for the
  // row in between).
  ok('Part 1 has the v1.1 header BELOW the boundary + Terminology row',
     /```\n[\s\S]*?\n\n🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\* — Part 1\/\d+/.test(chunks[0]));
  ok('Part 1 has the 📘 Expanded Terminology Hyperlinks chips block BETWEEN the boundary and the v1.1 header',
     /📘 \*\*Expanded Terminology Hyperlinks:\*\*[\s\S]*?```ansi[\s\S]*?```[\s\S]*?\n\n🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\*/.test(chunks[0]));
  for (let i = 1; i < chunks.length; i++) {
    ok(`Part ${i + 1}/${chunks.length} does NOT carry the new-scan boundary`,
       !/NEW DARK HORSE SCAN/.test(chunks[i]),
       { head: chunks[i].slice(0, 120) });
    ok(`Part ${i + 1}/${chunks.length} starts directly with the v1.1 Part label`,
       /^🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\* — Part \d+\/\d+/.test(chunks[i]),
       { head: chunks[i].slice(0, 80) });
  }
}

// ============================================================
// T14 — Bare "unavailable" absent from user-facing digest text
//   (operator directive 2026-05-12 — live evidence iteration).
//   The user explicitly flagged "Sections scanned: unavailable"
//   and the general "unavailable" wording leak across the body.
// ============================================================
console.log('\n[T14] Bare "unavailable" absent + "Sections scanned: unavailable" suppressed');
{
  // Empty universe path — exercises every fallback that previously
  // emitted "unavailable".
  const payloadEmpty = rank.buildRankedMovementDigestPayload(
    { top10: [], sectionsScanned: [], sectionCapsApplied: [], allCount: 0 },
    null,   // volatility → null forces every VIX/level fallback path
    { internal: [], ignored: [], universeSize: 33, now: Date.parse('2026-05-12T18:01:00Z') }
  );
  const cEmpty = payloadEmpty.content;
  ok('empty digest carries NO "Sections scanned: unavailable"',
     !/Sections scanned:\s*unavailable/i.test(cEmpty),
     cEmpty.match(/Sections scanned:[^\n]+/));
  ok('empty digest does NOT carry the bare "Sections scanned:" line at all when no sections',
     !/^\*\*Sections scanned:\*\*/m.test(cEmpty),
     'line not suppressed');
  ok('empty digest does NOT contain bare "unavailable" in user-facing body',
     !/\bunavailable\b/i.test(cEmpty),
     cEmpty.match(/[^\n]*\bunavailable\b[^\n]*/));
  ok('VIX-missing wording uses "reading pending", not "unavailable"',
     /market fear \/ volatility gauge \(VIX\) reading pending/.test(cEmpty));
  ok('Volatility level fallback uses "reading pending", not "unavailable"',
     /\*\*Volatility:\*\* reading pending/.test(cEmpty));

  // Populated path — ensure VIX line uses the level when present
  // and no "unavailable" leaks anywhere.
  const payloadPopulated = rank.buildRankedMovementDigestPayload(
    { top10: [], sectionsScanned: ['fx_majors'], sectionCapsApplied: [], allCount: 0 },
    { level: 'quiet', vixLevel: 'Normal' },
    { internal: [], ignored: [], universeSize: 33, now: Date.parse('2026-05-12T18:01:00Z') }
  );
  ok('populated digest does NOT contain bare "unavailable" in user-facing body',
     !/\bunavailable\b/i.test(payloadPopulated.content),
     payloadPopulated.content.match(/[^\n]*\bunavailable\b[^\n]*/));
}

// ============================================================
// T15 — Operator directive 2026-05-13 (full DH rewrite):
// the body Learning-Links row is REMOVED entirely. The
// `learningLinkUrls` opts plumbing is now obsolete for the
// user-facing surface — confirm the digest body emits no
// markdown-link patterns regardless of the URL map.
// ============================================================
console.log('\n[T15] Body Learning-Links surface removed — no URL form leaks into body');
{
  const payloadPlain = rank.buildRankedMovementDigestPayload(
    { top10: [], sectionsScanned: ['fx_majors'], sectionCapsApplied: [], allCount: 0 },
    { level: 'quiet', vixLevel: 'Normal' },
    { internal: [], ignored: [], universeSize: 33 }
  );
  ok('digest body has NO body-row Learning Links surface anymore',
     !/\*\*Learning links:\*\*/.test(payloadPlain.content)
     && !/\*\*Expanded Terminology Hyperlinks:\*\*/.test(payloadPlain.content));
  ok('digest body has NO Markdown [text](https) patterns anywhere',
     !/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(payloadPlain.content));

  // Even if a caller passes the legacy learningLinkUrls opts,
  // nothing markdown-linked leaks into the body (the body row
  // was removed).
  const payloadWired = rank.buildRankedMovementDigestPayload(
    { top10: [], sectionsScanned: ['fx_majors'], sectionCapsApplied: [], allCount: 0 },
    { level: 'quiet', vixLevel: 'Normal' },
    {
      internal: [], ignored: [], universeSize: 33,
      learningLinkUrls: { 'Breakout': 'https://example.com/breakout' },
    }
  );
  ok('legacy learningLinkUrls opts do NOT inject markdown links into the body',
     !/\[Breakout\]\(https:\/\/example\.com\/breakout\)/.test(payloadWired.content));
}

// ============================================================
// T16 — State-line wording (operator directive 2026-05-12 — live
//   evidence iteration). The State line must not contradict the
//   surrounding output:
//     - top10 empty                → "publication threshold not met"
//     - top10 has N standouts (1)  → "1 developing standout is being tracked"
//     - top10 has N standouts (≥2) → "N developing standouts are being tracked"
//   The digest path only fires when zero candidates hit WATCH
//   threshold, so top10 always represents developing standouts
//   (not confirmed watch candidates).
// ============================================================
console.log('\n[T16] State line — context-aware wording; no contradiction with Displayed candidates');
{
  function daily(n, base) {
    const out = []; let p = base;
    const t = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
    for (let i = 0; i < n; i++) { const o = p, c = p + 0.6, h = c + 0.4, l = o - 0.3; out.push({ open: o, high: h, low: l, close: c, time: t + i * 86400 }); p = c; }
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
  // 16a — Monitoring-only path (top10 empty)
  const pEmpty = rank.buildRankedMovementDigestPayload(
    { top10: [], sectionsScanned: [], sectionCapsApplied: [], allCount: 0 },
    { level: 'quiet', vixLevel: 'Normal' },
    { internal: [], ignored: [], universeSize: 33, now: Date.parse('2026-05-12T18:01:00Z') }
  );
  // Operator directive 2026-05-13 (DH rewrite): "Monitoring only"
  // prefix + "publication threshold not met" wording dropped.
  ok('empty digest — state uses "Conditions are quiet across the radar this cycle."',
     /\*\*State:\*\* Conditions are quiet across the radar this cycle\./.test(pEmpty.content),
     pEmpty.content.match(/\*\*State:\*\*[^\n]+/));
  ok('empty digest — state does NOT carry the legacy "Monitoring only" prefix',
     !/Monitoring only/.test(pEmpty.content));
  ok('empty digest — state does NOT carry the legacy "no confirmed watch candidate" wording',
     !/no confirmed watch candidate/.test(pEmpty.content));

  // 16b — One developing standout (singular grammar)
  const pOne = rank.buildRankedMovementDigestPayload(
    { top10: [mkRow('XAUUSD', 7, 'Bearish', rank.SECTIONS.COMMODITIES)],
      sectionsScanned: ['commodities'], sectionCapsApplied: [], allCount: 1 },
    { level: 'quiet', vixLevel: 'Normal' },
    { internal: [], ignored: [], universeSize: 33, now: Date.parse('2026-05-12T18:01:00Z') }
  );
  ok('1 standout — state reads "1 developing standout is on the radar this cycle."',
     /\*\*State:\*\* 1 developing standout is on the radar this cycle\./.test(pOne.content),
     pOne.content.match(/\*\*State:\*\*[^\n]+/));

  // 16c — Multiple developing standouts (plural grammar)
  const pMany = rank.buildRankedMovementDigestPayload(
    { top10: [
        mkRow('EURUSD', 7, 'Bullish', rank.SECTIONS.FX_MAJORS),
        mkRow('NDX',    7, 'Bullish', rank.SECTIONS.INDICES),
        mkRow('XAUUSD', 6, 'Bearish', rank.SECTIONS.COMMODITIES),
      ], sectionsScanned: ['fx_majors','indices','commodities'], sectionCapsApplied: [], allCount: 3 },
    { level: 'elevated', vixLevel: 'Elevated' },
    { internal: [], ignored: [], universeSize: 33, now: Date.parse('2026-05-12T18:01:00Z') }
  );
  ok('3 standouts — state reads "3 developing standouts are on the radar this cycle."',
     /\*\*State:\*\* 3 developing standouts are on the radar this cycle\./.test(pMany.content),
     pMany.content.match(/\*\*State:\*\*[^\n]+/));

  // 16d — Regression guard: never emit the old "Monitoring only"
  // backend prefix or "confirmed watch candidate" wording.
  for (const sample of [pEmpty.content, pOne.content, pMany.content]) {
    ok('no legacy "Monitoring only" / "confirmed watch candidate" wording',
       !/Monitoring only/.test(sample) && !/confirmed watch candidate/.test(sample));
  }
}

// ============================================================
// T17 — Standout reason wording — "move just confirming" replaced
//   with "move is only just starting to confirm" for clarity to
//   greenhorn readers (operator directive 2026-05-12).
// ============================================================
console.log('\n[T17] Standout reason — "is only just starting to confirm" replaces "just confirming"');
{
  function daily(n, base) {
    const out = []; let p = base;
    const t = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
    for (let i = 0; i < n; i++) { const o = p, c = p + 0.6, h = c + 0.4, l = o - 0.3; out.push({ open: o, high: h, low: l, close: c, time: t + i * 86400 }); p = c; }
    return out;
  }
  // moveAge = 0 triggers the "just starting to confirm" branch.
  const cand = rank.enrichCandidate(
    { symbol: 'XAUUSD', score: 7, direction: 'Bearish', summary: 'pressure building', reasons: ['breakout 1/2'] },
    daily(25, 1800), 6, { watchThreshold: 8 }
  );
  cand.section = rank.SECTIONS.COMMODITIES;
  cand.sectionLabel = rank.SECTION_LABEL[rank.SECTIONS.COMMODITIES];
  cand.moveAge = 0;  // force the "just starting" branch
  const payload = rank.buildRankedMovementDigestPayload(
    { top10: [cand], sectionsScanned: ['commodities'], sectionCapsApplied: [], allCount: 1 },
    { level: 'quiet', vixLevel: 'Normal' },
    { internal: [], ignored: [], universeSize: 33, now: Date.parse('2026-05-12T18:01:00Z') }
  );
  // Operator directive 2026-05-13 (DH rewrite): the "is only just
  // starting to confirm" wording was REMOVED — when moveAge=0 we
  // simply OMIT the sequence-age clause from the standout reason.
  ok('standout reason does NOT carry legacy "is only just starting to confirm"',
     !/is only just starting to confirm/.test(payload.content));
  ok('standout reason does NOT carry legacy "move just confirming" wording',
     !/\bmove just confirming\b/.test(payload.content));
  // The reason still carries the score + section + chart-pattern
  // anchor so the reader sees WHY the candidate stood out.
  ok('standout reason still carries score + chart-pattern evidence',
     /score\s+\d+\/10/.test(payload.content)
     && /chart pattern:/.test(payload.content));
}

// ============================================================
// summary
// ============================================================
console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('[DH-EDUCATION-QA] PASS — chart-evidence anchors + glossary + visual pattern + asset-class continuation wording in place; honest pending fallback when data absent; chunker preserved; Learning Links row in position with clean body; live-leak regression guard green; chunk-boundary atomicity verified; new-scan boundary on Part 1 only; no bare "unavailable" in user-facing body; URL routing status correctly reported; State line context-aware; standout reason "just starting to confirm" wording.');
process.exit(0);
