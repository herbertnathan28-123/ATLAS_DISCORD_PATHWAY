#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const assert = require('assert');
const path = require('path');

const rank = require(path.join(__dirname, '..', 'darkHorseRanking'));
const { buildDarkHorsePacket } = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const { renderDarkHorseSurface, renderDarkHorseZeroStandoutSurface } = require(path.join(__dirname, '..', 'foh', 'surfaces', 'darkHorseText'));

function dailyCandles(n, base) {
  const out = [];
  let p = base;
  const startTs = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
  const step = base >= 1000 ? 0.6 : base >= 100 ? 0.8 : base >= 10 ? 0.2 : 0.00025;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p + step;
    const h = c + step * 0.7;
    const l = o - step * 0.5;
    out.push({ open: o, high: h, low: l, close: c, time: startTs + i * 86400 });
    p = c;
  }
  return out;
}

function mk(symbol, score, direction, section, base, phase) {
  const enriched = rank.enrichCandidate(
    { symbol, score, direction, summary: 'higher highs and higher lows', reasons: ['structure 2/2', 'momentum 1/2'] },
    dailyCandles(25, base),
    6,
    { watchThreshold: 8 }
  );
  enriched.section = section;
  enriched.sectionLabel = rank.SECTION_LABEL[section];
  enriched.movePhase = phase;
  return enriched;
}

function buildViewModel(top10) {
  const packet = buildDarkHorsePacket({
    ranking: { top10, allCount: 33 },
    volatility: { level: 'elevated' },
    now: Date.parse('2026-05-18T17:28:00Z'),
    reportId: 'DH-PARITY-TEST',
  });
  return dhViewModel.toViewModel(packet);
}

const top10 = [
  mk('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early'),
  mk('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES, 2400, 'mid'),
  mk('NVDA', 7, 'Bullish', rank.SECTIONS.EQUITIES, 900, 'late'),
];

const viewModel = buildViewModel(top10);
const text = renderDarkHorseSurface(viewModel, {
  reportId: 'DH-PARITY-TEST',
  maxDiscordChunkChars: 5000,
  nextReviewUTC: '2026-05-18 17:43 UTC',
});

const requiredMarkers = [
  /🐎 NEW DARK HORSE SCAN/,
  /ATLAS · DARK HORSE · MOVEMENT DIGEST/,
  /MARKET MOOD/,
  /🟢 STANDOUTS/,
  /CURRENT ADVICE — AT RELEASE/,
  /CURRENT ADVICE \/ WHAT TO DO NOW:/,
  /🟠 ENTRY \/ WATCH ZONE/,
  /💵 DOLLAR RISK \/ RISK CAP/,
  /🔵 WHAT THIS MEANS/,
  /🔵 WHAT TO DO NOW/,
  /✅ WHAT CONFIRMS/,
  /🟨 WHAT WOULD PROMOTE A CANDIDATE NEXT/,
  /⛔ WHAT CANCELS/,
  /BUILDING \/ PRE-RADAR/,
  /CHART REFERENCE/,
  /🧾 BRIEFING SUMMARY/,
  /🟪 NEXT REVIEW/,
  /🔵 SOURCE \/ ENGINE STATUS/,
  /✅ END OF DARK HORSE SCAN/,
];

for (const re of requiredMarkers) {
  assert(re.test(text), 'Dark Horse visible surface missing marker ' + re);
}

assert(/Symbol: EURUSD/.test(text), 'lead standout symbol should be visible');
assert(/Direction: Long/.test(text), 'lead standout direction should be visible');
assert(/Score: publication-grade \(>=7\/10\)/.test(text), 'score row should be visible without inventing an exact score');
assert(!/__Market Impact__/.test(text), 'Dark Horse surface should not use shared MI markdown section wrappers');
assert(!/__Primary Event Focus__/.test(text), 'Dark Horse surface should not show Market Intel primary-event wrapper');
assert(!/TODAY'S RANKED EVENT CALENDAR/.test(text), 'Dark Horse surface should not show Market Intel calendar');

const zeroText = renderDarkHorseZeroStandoutSurface(buildViewModel([]), {
  reportId: 'DH-ZERO-TEST',
  universeSize: 33,
  maxDiscordChunkChars: 5000,
});
assert(/0 standouts · 33 markets scanned/.test(zeroText), 'zero-standout surface should publish visible scan state');
assert(/CURRENT ADVICE — AT RELEASE/.test(zeroText), 'zero-standout surface should carry advice block');
assert(/WHY NOTHING PROMOTED/.test(zeroText), 'zero-standout surface should explain no-promotion state');
assert(/SOURCE \/ ENGINE STATUS/.test(zeroText), 'zero-standout surface should preserve source status');

console.log('[DARK-HORSE-PROTOTYPE-PARITY] PASS');
