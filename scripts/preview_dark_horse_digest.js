#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Preview the live Dark Horse digest output AFTER the legacy
 * chart-pattern glossary suppression (operator directive 2026-05-13).
 *
 * Goes through the live formatter path:
 *   buildRankedMovementDigestPayload  →  _dhChunkDigest
 *
 * Then asserts that the resulting chunks no longer contain any of
 * the operator-flagged legacy phrases ANYWHERE in the digest tail
 * (the region where the old glossary used to sit), nor the legacy
 * "### Glossary — chart-pattern terms used above" header anywhere.
 *
 * Usage:
 *   node scripts/preview_dark_horse_digest.js          # summary
 *   node scripts/preview_dark_horse_digest.js --full   # dump every chunk
 */

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

const checks = [
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

console.log('');
console.log(allPass
  ? '[PREVIEW RESULT] PASS — live formatter no longer emits the legacy glossary block or banned tail wording.'
  : '[PREVIEW RESULT] FAIL — at least one legacy phrase still reaches the digest.');

process.exit(allPass ? 0 : 1);
