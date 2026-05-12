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
// T10 — Learning Links doctrine (operator directive 2026-05-12)
//   Row sits IMMEDIATELY under heading, BEFORE criteria paragraph.
//   Plain-term form when URL map absent (rule 5). No fake URLs
//   (rule 6). Body text MUST stay clean — no inline hyperlinks
//   scattered through paragraphs (rule 1, 2, 3).
// ============================================================
console.log('\n[T10] Learning Links row — position, content, plain-term default, clean body');
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

  // 10a — Plain-term default (URL map not provided)
  const payloadPlain = rank.buildRankedMovementDigestPayload(ranking, { level: 'elevated', vixLevel: 'Elevated' }, { now: Date.parse('2026-05-12T04:00:00Z') });
  const c = payloadPlain.content;
  ok('Learning Links row present', /\*\*Learning links:\*\*/.test(c), c.slice(0, 400));
  // Position check: between the 🐎 header and the criteria paragraph.
  const idxHeader   = c.indexOf('🐎 **DARK HORSE — GLOBAL MOVER RADAR (v1.1)**');
  const idxLinks    = c.indexOf('**Learning links:**');
  const idxCriteria = c.indexOf('**Dark Horse criteria:**');
  ok('header found',   idxHeader   >= 0);
  ok('links found',    idxLinks    >  0);
  ok('criteria found', idxCriteria >  0);
  ok('Learning Links sits BETWEEN header and criteria paragraph',
     idxHeader < idxLinks && idxLinks < idxCriteria,
     { idxHeader, idxLinks, idxCriteria });
  // Content: all 9 user-specified terms present in the row.
  for (const term of rank.DH_LEARNING_LINKS_TERMS) {
    ok('learning row carries term "' + term + '"',
       c.includes(term),
       { sample: c.slice(idxLinks, idxLinks + 400) });
  }
  ok('plain-term default — no Markdown link syntax in the row when URL map absent',
     !/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(c.slice(idxLinks, idxLinks + 400)),
     'a [text](url) pattern appears in the Learning Links row');
  ok('linkRoutingStatus reported as pending',
     payloadPlain.linkRoutingStatus === 'pending');

  // 10b — Body text stays clean: no INLINE markdown hyperlinks
  // scattered through the paragraph text below the Learning Links
  // row. We sample everything between the criteria paragraph and
  // the footer glossary and assert zero [text](http…) patterns.
  const idxGlossary = c.indexOf('### Glossary');
  ok('glossary anchor found',  idxGlossary > idxCriteria);
  const body = c.slice(idxCriteria, idxGlossary);
  ok('no inline [text](url) patterns in body paragraphs',
     !/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(body),
     'an inline link appears in the body');

  // 10c — partial-URL form: rule 4 says use Markdown links only when
  // URLs exist; rule 6 says do not invent fakes. Pass a partial
  // urlMap and confirm only the keyed terms get linkified.
  const payloadPartial = rank.buildRankedMovementDigestPayload(
    ranking,
    { level: 'elevated', vixLevel: 'Elevated' },
    {
      now: Date.parse('2026-05-12T04:00:00Z'),
      learningLinkUrls: { 'Calm retest': 'https://example.com/calm-retest' },
    }
  );
  ok('partial-URL form linkifies only the wired term',
     /\[Calm retest\]\(https:\/\/example\.com\/calm-retest\)/.test(payloadPartial.content),
     payloadPartial.content.slice(payloadPartial.content.indexOf('**Learning links:**'), payloadPartial.content.indexOf('**Learning links:**') + 400));
  ok('partial-URL form leaves un-wired terms plain (no fake URLs)',
     // "Breakout" is in the term list but no URL was provided →
     // must render as plain text, not "[Breakout](…)".
     /·\s*Breakout\s*·/.test(payloadPartial.content)
     && !/\[Breakout\]\(https?/.test(payloadPartial.content),
     'Breakout was either linkified with a fake URL or stripped');
  ok('partial-URL form reports linkRoutingStatus = partial',
     payloadPartial.linkRoutingStatus === 'partial');

  // 10d — buildLearningLinksBlock unit checks (URL routing edge cases)
  const blockEmpty = rank.buildLearningLinksBlock();
  ok('empty call returns plain-term row',
     /\*\*Learning links:\*\* Dark Horse candidate · WATCH candidate · /.test(blockEmpty.text));
  const blockFake = rank.buildLearningLinksBlock({ 'Calm retest': 'not-a-real-url' });
  ok('non-https URL is rejected (term stays plain)',
     /·\s*Calm retest\s*·/.test(blockFake.text)
     && !/\[Calm retest\]\(not-a-real-url\)/.test(blockFake.text),
     'a non-https url was accepted');
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
  ok('footer ends with "Reassess against the per-candidate confirmation criteria at the next review."',
     /Reassess against the per-candidate confirmation criteria at the next review\./.test(content));
  ok('chart-evidence pending note uses "Chart confirmation remains pending until 15m/5m anchor wiring is added"',
     /Chart confirmation remains pending until 15m\/5m anchor wiring is added/.test(content));
  ok('jargon translated: "higher highs and higher lows" appears',
     /higher highs and higher lows/.test(content));
  ok('jargon translated: "× the prior-bar average" appears',
     /×\s*the prior-bar average/.test(content));
  ok('jargon translated: "section average" appears',
     /section average\b/.test(content));
  // Standout reason now includes structure read + sequence detail.
  ok('standout reason carries enriched evidence, not generic phase line',
     /because\s+\w+\s+stage,\s*score\s+\d+\/10;\s+structure read:/.test(content));
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

  // T12d — glossary section stays whole: the heading and all 7
  // entries appear in the same chunk.
  const glossaryChunkIdx = chunks.findIndex(c => /### Glossary — chart-pattern terms used above/.test(c));
  ok('glossary heading lives in exactly one chunk', glossaryChunkIdx >= 0);
  if (glossaryChunkIdx >= 0) {
    const c = chunks[glossaryChunkIdx];
    for (const entry of [
      '**Recent intraday high area:**',
      '**Recent intraday low area:**',
      '**Breakout:**',
      '**Calm retest:**',
      '**Retest holds:**',
      '**Invalidation:**',
      '**Continuation window:**',
    ]) {
      ok(`glossary entry "${entry}" stays in the same chunk as the heading`,
         c.includes(entry),
         { glossaryChunk: glossaryChunkIdx, sample: c.slice(0, 200) });
    }
  }

  // T12e — every chunk is still within the Discord hard limit.
  for (let i = 0; i < chunks.length; i++) {
    ok(`chunk ${i + 1}/${chunks.length} ≤ Discord 2000-char hard limit`,
       chunks[i].length <= engine.DH_CHUNK_DISCORD_HARD_LIMIT,
       { len: chunks[i].length });
  }
}

// ============================================================
// summary
// ============================================================
console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('[DH-EDUCATION-QA] PASS — chart-evidence anchors + glossary + visual pattern + asset-class continuation wording in place; honest pending fallback when data absent; chunker preserved; Learning Links row in position with clean body; live-leak regression guard green; chunk-boundary atomicity verified.');
process.exit(0);
