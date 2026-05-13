#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Preview the live Dark Horse digest output AFTER the FOH-native
 * live formatter is wired (operator directive 2026-05-13).
 *
 * Live path exercised:
 *   buildRankedMovementDigestPayload (now delegates to FOH)
 *     → _dhChunkDigest (Discord chunk transport)
 *
 * The preview confirms:
 *   - The legacy chart-pattern glossary block / banned tail wording
 *     is absent from the chunked digest.
 *   - The FOH layout pieces (atmosphere banner, NEW separators,
 *     section radar with zone glyphs, candidate cards with the 7
 *     FOH questions, terminology row, operator note, avoided-risk
 *     attribution, universe coverage, closing block, advisory tail)
 *     are present.
 *   - Discord chunk-size limits are respected.
 *
 * Use --legacy to render through the legacy fallback for a
 * before/after comparison (sets ATLAS_DARKHORSE_LEGACY=1 for the
 * duration of the run only).
 *
 * Usage:
 *   node scripts/preview_dark_horse_digest.js          # summary
 *   node scripts/preview_dark_horse_digest.js --full   # dump every chunk
 *   node scripts/preview_dark_horse_digest.js --legacy # legacy fallback (before)
 */
if (process.argv.includes('--legacy')) {
  process.env.ATLAS_DARKHORSE_LEGACY = '1';
}

const rank   = require('../darkHorseRanking');
const engine = require('../darkHorseEngine');

function dailyCandles(n, base) {
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
  sectionsScanned: ['fx_majors', 'indices', 'equities', 'commodities'],
  sectionCapsApplied: [],
  allCount: 8,
};

const payload = rank.buildRankedMovementDigestPayload(
  ranking,
  { level: 'elevated', vixLevel: 'Elevated' },
  { now: Date.parse('2026-05-13T04:00:00Z') }
);

const chunks = engine._dhChunkDigest(payload.content, {
  firstChunkPrefix: payload.firstChunkPrefix,
});

const joined = chunks.map(c =>
  c.replace(/^\*\*🐎 ATLAS · DARK HORSE FOH\*\* — Part \d+\/\d+\n\n/, '')
).join('');

const idxNextReview = joined.lastIndexOf('⏭️ Next review:');
const tailStart = idxNextReview >= 0 ? Math.max(0, idxNextReview - 1200) : Math.max(0, joined.length - 1500);
const tail = joined.slice(tailStart);

const isLegacyRun = process.argv.includes('--legacy');
const ctx_atThreshold = ranking.top10.filter(r => (r.score || 0) >= 8).length;
const checks = [
  // Legacy-suppression guards — operator directive 2026-05-13.
  ['DH_CHART_GLOSSARY constant is empty',
    rank.DH_CHART_GLOSSARY === ''],
  ['legacy glossary heading absent in joined digest',
    !/### Glossary — chart-pattern terms used above/.test(joined)],
  ['legacy "Recent intraday high area:" entry absent',
    !/\*\*Recent intraday high area:\*\*/.test(joined)],
  ['legacy "Breakout:" entry absent',
    !/\*\*Breakout:\*\*/.test(joined)],
  ['legacy "Calm retest:" entry absent',
    !/\*\*Calm retest:\*\*/.test(joined)],
  ['legacy "Retest holds:" entry absent',
    !/\*\*Retest holds:\*\*/.test(joined)],
  ['legacy "Invalidation:" entry absent',
    !/\*\*Invalidation:\*\*/.test(joined)],
  ['legacy "Continuation window:" entry absent',
    !/\*\*Continuation window:\*\*/.test(joined)],
  ['"break and hold" absent in digest tail',
    !/\bbreak\s+and\s+hold\b/i.test(tail)],
  ['"body close" absent in digest tail',
    !/\bbody\s+close\b/i.test(tail)],
  ['"wick alone" absent in digest tail',
    !/\bwick\s+alone\b/i.test(tail)],
  ['"Retest holds" absent in digest tail',
    !/\bRetest\s+holds\b/i.test(tail)],
  ['"read weakens" absent in digest tail',
    !/\bread\s+weakens\b/i.test(tail)],
];

// FOH-presence checks — only meaningful on the live (FOH) run.
// Under --legacy these are skipped because the legacy radar
// template does not emit them.
if (!isLegacyRun) {
  checks.push(
    ['v1.3 premium banner present (ATLAS · DARK HORSE · FOH OPERATOR SURFACE)',
      /🐎 \*\*ATLAS · DARK HORSE · FOH OPERATOR SURFACE\*\*/.test(joined)],
    ['v1.3 banner version line ("v1.3 — operator edition")',
      /v1\.3 — operator edition/.test(joined)],
    ['v1.3 banner Scan-time line',
      /📍 \*\*Scan time:\*\*/.test(joined)],
    ['v1.3 banner Atmosphere line',
      /🌐 \*\*Atmosphere:\*\*/.test(joined)],
    ['v1.3 banner Publication-condition line',
      /🔭 \*\*Publication condition:\*\*/.test(joined)],
    ['v1.3 banner Strongest-live-area line',
      /⭐ \*\*Strongest live area:\*\*/.test(joined)],
    ['v1.3 banner Immediate-read sentence',
      /_Immediate read:_/.test(joined)],
    ['v1.3 OPERATOR PANEL block present',
      /⚡ OPERATOR PANEL/.test(joined)],
    ['operator panel STATE tag present',
      /\*\*STATE\*\* ·/.test(joined)],
    ['operator panel ENERGY tag present',
      /\*\*ENERGY\*\* ·/.test(joined)],
    ['operator panel BEST AREA tag present',
      /\*\*BEST AREA\*\* ·/.test(joined)],
    ['operator panel RISK TONE tag present',
      /\*\*RISK TONE\*\* ·/.test(joined)],
    ['operator panel PUBLICATION tag present',
      /\*\*PUBLICATION\*\* ·/.test(joined)],
    ['operator panel NEXT REVIEW tag present',
      /\*\*NEXT REVIEW\*\* ·/.test(joined)],
    ['🔴 CURRENT LIVE READ separator present',
      /🔴 CURRENT LIVE READ/.test(joined)],
    ['Market atmosphere section heading present',
      /### 🌐 Market atmosphere/.test(joined)],
    ['atmosphere substructure — Where pressure is building',
      /🔭 \*\*Where pressure is building:\*\*/.test(joined)],
    ['atmosphere substructure — Why ATLAS is not promoting yet',
      /🤔 \*\*Why ATLAS is not promoting yet:\*\*/.test(joined)],
    ['atmosphere substructure — Trader mistake refused',
      /🛡️ \*\*Trader mistake ATLAS is refusing to make:\*\*/.test(joined)],
    ['atmosphere substructure — What would change the state',
      /🔁 \*\*What would change the state:\*\*/.test(joined)],
    ['EXPANDED TERMINOLOGY row present (rebranded from Learning Links)',
      /🟦 \*\*Expanded Terminology\*\* ·/.test(joined)],
    ['Section radar uses color glyphs AND status tags',
      /### [🟢🟡🟠🔴🔵⚪]\s+[^\n]+·\s+\*\*(?:HEALTHY|BUILDING|CAUTION|DANGER|CONTEXT|QUIET)\*\*/u.test(joined)],
    ['Section radar — Upgrade / Downgrade lines',
      /🟢 \*\*What would upgrade it:\*\*/.test(joined)
      && /🔴 \*\*What would downgrade it:\*\*/.test(joined)],
    ['Candidate cards use banner separator ("━━━ SYM ↑ · N/10 ━━━")',
      /━━━━━━━━ [⭐\s]*[A-Z0-9]+ [↑↓→] · \d+\/\d+ ·/.test(joined)],
    ['Card carries STATUS / Phase / Movement-quality identity rows',
      /\*\*STATUS\*\* ·/.test(joined)
      && /🧬 \*\*Phase\*\* ·/.test(joined)
      && /⚡ \*\*Movement quality\*\* ·/.test(joined)],
    ['Card carries WHAT HAPPENED / WHERE IT MATTERS / WHY ATLAS IS WATCHING headings',
      /📍 \*\*WHAT HAPPENED\*\*/.test(joined)
      && /🎯 \*\*WHERE IT MATTERS\*\*/.test(joined)
      && /🧠 \*\*WHY ATLAS IS WATCHING\*\*/.test(joined)],
    ['Card path conditions block (HEALTHY / CAUTION / DANGER / INVALIDATION)',
      /🟢 \*\*HEALTHY PATH\*\*/.test(joined)
      && /\*\*CAUTION PATH\*\*/.test(joined)
      && /🟠 \*\*DANGER PATH\*\*/.test(joined)
      && /❌ \*\*INVALIDATION\*\*/.test(joined)],
    ['Card forward-read block (WHAT ATLAS NEEDS NEXT / OPERATOR NOTE / REPLAY)',
      /📡 \*\*WHAT ATLAS NEEDS NEXT\*\*/.test(joined)
      && /🎙️ \*\*OPERATOR NOTE\*\*/.test(joined)
      && /🗂️ \*\*REPLAY REFERENCE\*\*/.test(joined)],
    ['Watch explanation block present (FOH operational)',
      /### ⏳ Why ATLAS is not promoting yet/.test(joined)],
    ['Avoided-risk block present when no publication-grade promotion',
      ctx_atThreshold === 0
        ? /🛡️ WHAT ATLAS REFUSED TO PROMOTE/.test(joined)
        : true],
    ['Operator-note block present',
      /🎙️ OPERATOR NOTE/.test(joined)],
    ['Universe coverage block present',
      /📊 UNIVERSE COVERAGE/.test(joined)],
    ['Closing block — Next-review + upgrade + downgrade present',
      /🔚 NEXT REVIEW/.test(joined)
      && /🟢 \*\*What could upgrade by next scan\*\*/.test(joined)
      && /🔴 \*\*What could downgrade by next scan\*\*/.test(joined)],
    ['FOH advisory tail present',
      /⚠️ Advisory only/.test(joined)],
    ['No legacy "**Dark Horse criteria:**" paragraph',
      !/\*\*Dark Horse criteria:\*\*/.test(joined)],
    ['No legacy "**Displayed candidates:**" header',
      !/\*\*Displayed candidates:\*\*/.test(joined)],
    ['No legacy "Conditions are moving …" footer',
      !/Conditions are moving but entry quality is not confirmed/.test(joined)],
    ['No legacy "Learning links:" label (replaced by Expanded Terminology)',
      !/\*\*Learning links:\*\*/.test(joined)],
    ['No legacy "GLOBAL MOVER RADAR" wording in the digest BODY (chunk Part labels do not count)',
      !/GLOBAL MOVER RADAR/.test(joined)],
    ['Every chunk ≤ Discord 2000-char hard limit',
      chunks.every(c => c.length <= 2000)],
  );
}

console.log('=== DARK HORSE PREVIEW — legacy glossary suppression ===');
console.log(`Chunks produced: ${chunks.length}`);
console.log(`Total digest length: ${joined.length} chars`);
console.log(`Tail region inspected: ${tail.length} chars (anchored on "⏭️ Next review:")`);
console.log('');

let allPass = true;
for (const [label, pass] of checks) {
  const tag = pass ? 'PASS' : 'FAIL';
  if (!pass) allPass = false;
  console.log(`[${tag}] ${label}`);
}

console.log('');
console.log('--- DIGEST TAIL (last region, where the legacy glossary used to sit) ---');
console.log(tail);
console.log('--- END TAIL ---');

if (process.argv.includes('--full')) {
  for (let i = 0; i < chunks.length; i++) {
    console.log('');
    console.log(`========== CHUNK ${i + 1}/${chunks.length} (len=${chunks[i].length}) ==========`);
    console.log(chunks[i]);
  }
}

// ────────────────────────────────────────────────────────────
// Semantic-translator grep proof — count occurrences of the
// legacy trader-shorthand phrases across the joined digest.
// The FOH path should show zero (or vastly reduced) hits versus
// the legacy fallback. Phrases tracked:
//   - "moderate-to-high" / "low-to-moderate" raw risk labels
//   - "HH/HL" / "LH/LL" raw structure shorthand
//   - "× baseline" raw speed multiplier
//   - "Confirmation pending" / "Awaiting confirmation"
//   - "structure 2/2" / "promotion trigger" / "window narrowing"
//   - "higher-timeframe close" / "confirmed structure"
// ────────────────────────────────────────────────────────────
console.log('');
console.log('--- SEMANTIC GREP — legacy trader-shorthand occurrence counts ---');
const GREP_TERMS = [
  ['moderate-to-high',         /\bmoderate-to-high\b/gi],
  ['low-to-moderate',          /\blow-to-moderate\b/gi],
  ['HH/HL',                    /\bHH\/HL\b/g],
  ['LH/LL',                    /\bLH\/LL\b/g],
  ['× baseline',               /×\s*baseline\b/gi],
  ['Confirmation pending',     /\bConfirmation pending\b/gi],
  ['Awaiting confirmation',    /\bAwaiting confirmation\b/gi],
  ['structure 2/2',            /\bstructure 2\/2\b/gi],
  ['promotion trigger',        /\bpromotion trigger\b/gi],
  ['window narrowing',         /\bwindow narrowing\b/gi],
  ['higher-timeframe close',   /\bhigher-timeframe close\b/gi],
  ['confirmed structure',      /\bconfirmed structure\b/gi],
  ['confirmed higher-timeframe close', /\bconfirmed higher-timeframe close\b/gi],
];
let grepPass = true;
for (const [label, re] of GREP_TERMS) {
  const hits = (joined.match(re) || []).length;
  const tag = hits === 0 ? 'PASS' : 'FAIL';
  if (hits !== 0) grepPass = false;
  console.log(`[${tag}] "${label}" — ${hits} occurrences on the live FOH surface`);
}

console.log('');
console.log(allPass && grepPass
  ? '[PREVIEW RESULT] PASS — FOH semantic translator strips legacy trader shorthand from the live surface.'
  : '[PREVIEW RESULT] FAIL — at least one legacy phrase still reaches the digest.');

process.exit(allPass && grepPass ? 0 : 1);
