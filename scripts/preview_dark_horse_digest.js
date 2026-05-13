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
  c.replace(/^🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\* — Part \d+\/\d+\n\n/, '')
).join('');

const idxNextReview = joined.lastIndexOf('⏭️ Next review:');
const tailStart = idxNextReview >= 0 ? Math.max(0, idxNextReview - 1200) : Math.max(0, joined.length - 1500);
const tail = joined.slice(tailStart);

const isLegacyRun = process.argv.includes('--legacy');
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
    ['FOH digest-version line present',
      /_Digest version:_\s*v1\.2-foh/.test(joined)],
    ['FOH _Market atmosphere:_ line present',
      /_Market atmosphere:_/.test(joined)],
    ['FOH _Publication state:_ line present',
      /_Publication state:_/.test(joined)],
    ['FOH 🔴 NEW separator present',
      /━━━━━━━━━━ 🔴/.test(joined)],
    ['FOH global market read section present',
      /### 🌐 Global market read/.test(joined)],
    ['FOH section radar uses color glyphs',
      /### [🟢🟡🟠🔴🔵⚪]\s+/u.test(joined)],
    ['FOH terminology row present',
      /🟦 _Expanded terminology:_/.test(joined)],
    ['FOH cards expose 🟢 Healthy zone cue',
      /🟢 _Healthy zone:_/.test(joined)],
    ['FOH cards expose 🟡 Caution zone cue',
      /🟡 _Caution zone:_/.test(joined)],
    ['FOH cards expose 🟠 Danger zone cue',
      /🟠 _Danger zone:_/.test(joined)],
    ['FOH cards expose 🔴 Invalidation cue',
      /🔴 _Invalidation:_/.test(joined)],
    ['FOH _What ATLAS needs next:_ block present',
      /_What ATLAS needs next:_/.test(joined)],
    ['FOH operator-note block present',
      /### 🎙️ Operator note/.test(joined)],
    ['FOH watch-explanation block present',
      /### ⏳ Why ATLAS is not promoting yet/.test(joined)],
    ['FOH universe-coverage block present',
      /### 📊 Universe coverage/.test(joined)],
    ['FOH closing block present',
      /### 🔚 Next review/.test(joined)],
    ['FOH advisory tail present',
      /⚠️ Advisory only/.test(joined)],
    ['No legacy "**Dark Horse criteria:**" paragraph',
      !/\*\*Dark Horse criteria:\*\*/.test(joined)],
    ['No legacy "**Displayed candidates:**" header',
      !/\*\*Displayed candidates:\*\*/.test(joined)],
    ['No legacy "Conditions are moving but entry quality is not confirmed." footer',
      !/Conditions are moving but entry quality is not confirmed/.test(joined)],
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
