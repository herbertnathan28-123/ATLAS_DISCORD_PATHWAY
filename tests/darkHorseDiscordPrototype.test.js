#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const foh = require(path.join(__dirname, '..', 'darkHorseFoh'));
const rank = require(path.join(__dirname, '..', 'darkHorseRanking'));

let passed = 0;
let failed = 0;
function ok(label, cond, info) {
  if (cond) {
    passed += 1;
    console.log('  ✓ ' + label);
  } else {
    failed += 1;
    console.error('  ✗ ' + label + (info ? ' :: ' + JSON.stringify(info).slice(0, 240) : ''));
  }
}

function row(symbol, score, direction, movePhase, prices, extra) {
  return Object.assign({
    symbol,
    score,
    direction,
    movePhase,
    section: rank.SECTIONS.FX_MAJORS,
    sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.FX_MAJORS],
    summary: 'prototype fixture',
    reasons: ['structure and momentum aligned'],
    evidenceAnchors: {
      availability: 'partial',
      recentHigh: { price: prices.high, priceText: String(prices.high) },
      recentLow: { price: prices.low, priceText: String(prices.low) },
      invalidation: { price: prices.invalidation, priceText: String(prices.invalidation) },
    },
  }, extra || {});
}

const now = Date.parse('2026-05-17T18:20:00Z');
const payload = foh.buildDarkHorseFohPayload({
  allCount: 37,
  top10: [
    row('EURUSD', 9, 'Bullish', 'early', { high: 1.1620, low: 1.1614, invalidation: 1.1577 }),
    row('GBPUSD', 8, 'Bearish', 'mid', { high: 1.2810, low: 1.2760, invalidation: 1.2845 }, {
      firstDetectedAt: '2026-05-15T14:00:00Z',
    }),
    row('NVDA', 7, 'Bullish', 'late', { high: 925, low: 919, invalidation: 902.5 }),
  ],
}, { level: 'elevated' }, { now, universeSize: 37 });

const messages = payload.messages || [];
const banner = messages[0] && messages[0].content || '';
const fresh = messages[1] && messages[1].content || '';
const active = messages[2] && messages[2].content || '';
const fading = messages[3] && messages[3].content || '';

console.log('\nT1 — prototype scan header:');
ok('header uses compact NEW DARK HORSE SCAN wording', /🆕 ❗❗ NEW DARK HORSE SCAN ❗❗ 🆕/.test(banner));
ok('header shows UTC, AWST, and scanned-market count on one line', /2026-05-17 18:20 UTC 02:20 AWST • 37 markets scanned/.test(banner));

console.log('\nT2 — lifecycle colour and validity treatment:');
ok('initial standout separator is yellow', /🟨🟨 INITIAL STANDOUT • STANDOUT #1 of 3/.test(fresh));
ok('initial standout states it first became active on this scan', /First active on this scan/.test(fresh));
ok('still-active separator is orange and ranked', /🟧🟧 STILL ACTIVE • STANDOUT #2 of 3/.test(active));
ok('still-active separator carries first logged / first active timestamp plus elapsed validity', /First logged: 15\/05\/26 14:00 UTC · First active: 15\/05\/26 14:00 UTC · Still Dark Horse worthy after 2d 4h 20m/.test(active));
ok('fading separator remains distinct from initial and still-active colours', /🟥🟧 FADING • STANDOUT #3 of 3/.test(fading));

console.log('\nT3 — supporting prototype sections remain visible:');
ok('banner keeps Expanded Terminology Hyperlinks visible', /EXPANDED TERMINOLOGY HYPERLINKS/.test(banner));
ok('banner keeps STANDOUTS strongest-movers section visible', /STANDOUTS/.test(banner) && /STRONGEST MOVERS/.test(banner));

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) {
  console.error('[DARK-HORSE-DISCORD-PROTOTYPE] FAIL');
  process.exit(1);
}
console.log('[DARK-HORSE-DISCORD-PROTOTYPE] PASS');
