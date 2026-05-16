#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_dh_foh_packet_qa.js
//
// QA for the Dark Horse FOH product-depth packet — mirror of
// the MI packet QA. Verifies:
//   - buildDarkHorseFohPacket emits the full locked schema.
//   - Every section carries `available: boolean` + `reason` on
//     unavailable.
//   - movePhase → lifecycle mapping (early→FRESH, mid→STILL
//     ACTIVE, late→FADING, exhaustion→EXHAUSTED).
//   - moveAge → durationAlive + firstDetected derivation.
//   - Renderer detects rich packet + emits new sections.
//   - "sourced unavailable" label appears for unavailable.
//   - Back-compat: legacy thin payload still renders.
//   - Env-flag dispatch path picks up rich packet.
// ============================================================

const path = require('path');
const pkt   = require(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseFohPacket'));
const foh   = require(path.join(__dirname, '..', 'renderers', 'foh'));
const dh    = require(path.join(__dirname, '..', 'darkHorseImageDispatch.js'));
const { renderDarkHorseCard } = require(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseCard'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }
function assert(cond, label, err) { if (cond) ok(label); else fail(label, err); }

const ranking = { allCount: 33, top10: [
  { symbol: 'EURUSD', score: 9, direction: 'Bullish', movePhase: 'early',      moveAge: 2,  sectionLabel: 'FX Majors',     whyFlagged: 'fresh', structureState: 'HH/HL', promotionTrigger: 'Above 1.09', invalidationTrigger: 'Below 1.085', continuationWindow: 'window opening', lateEntryRisk: 'low', atlasState: 'WATCH', confirmationRequirement: 'A confirmed 4H close' },
  { symbol: 'XAUUSD', score: 8, direction: 'Bullish', movePhase: 'mid',        moveAge: 7,  sectionLabel: 'Commodities',   whyFlagged: 'continuation', structureState: '1H close', promotionTrigger: 'Above 2425',  invalidationTrigger: 'Below 2408',  continuationWindow: 'window open', lateEntryRisk: 'low-to-moderate', atlasState: 'STILL ACTIVE' },
  { symbol: 'NVDA',   score: 7, direction: 'Bullish', movePhase: 'late',       moveAge: 14, sectionLabel: 'Major Equities',whyFlagged: 'late-stage', structureState: 'cooling', promotionTrigger: 'Above 980',   invalidationTrigger: 'Below 965',   continuationWindow: 'window narrowing', lateEntryRisk: 'moderate-to-high', atlasState: 'FADING' },
  { symbol: 'TSLA',   score: 7, direction: 'Bearish', movePhase: 'exhaustion', moveAge: 22, sectionLabel: 'Major Equities',whyFlagged: 'exhausted', structureState: 'over-extended', promotionTrigger: 'Below 220', invalidationTrigger: 'Above 245', continuationWindow: 'window closing', lateEntryRisk: 'high', atlasState: 'EXHAUSTED' },
]};
const volatility = { level: 'elevated' };
const internal = [
  { symbol: 'GBPUSD', score: 7, direction: 'Bullish', sectionLabel: 'FX Majors' },
  { symbol: 'USDJPY', score: 6, direction: 'Bearish', sectionLabel: 'FX Majors' },
];

// ── T1 — schema completeness ──
console.log('\nT1 — Schema completeness:');
const p = pkt.buildDarkHorseFohPacket(ranking, volatility, null, { universeSize: 33, watch: [], internal, ignored: [] });
for (const key of ['scanState','marketState','marketMood','standouts','nearMisses','universeCoverage','riskReminder','marketImpact','operatorGuidance','sourceNote','glossaryTerms','formats']) {
  assert(Object.prototype.hasOwnProperty.call(p, key), 'packet has section: ' + key);
}
assert(typeof p.marketState.available === 'boolean', 'marketState.available is boolean');
assert(typeof p.nearMisses.available  === 'boolean', 'nearMisses.available is boolean');
assert(typeof p.universeCoverage.available === 'boolean', 'universeCoverage.available is boolean');

// ── T2 — movePhase → lifecycle mapping ──
console.log('\nT2 — movePhase → lifecycle:');
assert(p.standouts[0].lifecycle === 'FRESH',        'movePhase=early → FRESH');
assert(p.standouts[1].lifecycle === 'STILL ACTIVE', 'movePhase=mid → STILL ACTIVE');
assert(p.standouts[2].lifecycle === 'FADING',       'movePhase=late → FADING');
assert(p.standouts[3].lifecycle === 'EXHAUSTED',    'movePhase=exhaustion → EXHAUSTED');

// ── T3 — moveAge → human duration + first detected ──
console.log('\nT3 — moveAge → human duration + first detected:');
assert(p.standouts[0].durationAlive === '2 days', 'moveAge=2 → "2 days"');
assert(p.standouts[1].durationAlive === '7 days', 'moveAge=7 → "7 days"');
assert(typeof p.standouts[0].firstDetected === 'string' && /\d{4}-\d{2}-\d{2}/.test(p.standouts[0].firstDetected), 'firstDetected formatted as YYYY-MM-DD HH:MM UTC');

// ── T4 — universe coverage available with all 4 counts ──
console.log('\nT4 — universe coverage:');
assert(p.universeCoverage.available === true, 'universeCoverage available when universeSize > 0');
assert(p.universeCoverage.scanned === 33, 'universeCoverage.scanned = 33');
assert(p.universeCoverage.internal === 2, 'universeCoverage.internal counts 2 near-miss candidates');

// ── T5 — near misses listed when internal supplied ──
console.log('\nT5 — near misses:');
assert(p.nearMisses.available === true, 'nearMisses available when internal supplied');
assert(p.nearMisses.count === 2, 'nearMisses.count = 2');
assert(p.nearMisses.candidates[0].symbol === 'GBPUSD', 'top near-miss = GBPUSD');

// ── T6 — sourced-unavailable when no liveCtx ──
console.log('\nT6 — Unavailable sections labelled (never silently dropped):');
assert(p.marketState.available === false, 'marketState.available=false when no liveCtx');
assert(typeof p.marketState.reason === 'string' && p.marketState.reason.length, 'marketState carries reason when unavailable');

// ── T7 — empty internal → nearMisses unavailable ──
const pEmpty = pkt.buildDarkHorseFohPacket(ranking, volatility, null, { universeSize: 33 });
assert(pEmpty.nearMisses.available === false, 'nearMisses unavailable when internal empty');
assert(typeof pEmpty.nearMisses.reason === 'string', 'nearMisses carries reason when unavailable');

// ── T8 — renderer detects rich packet + emits new sections ──
console.log('\nT8 — Renderer outputs new sections from rich packet:');
const html = renderDarkHorseCard(p);
for (const heading of ['Market state · macro regime','Standouts','Near-miss watchlist','Universe coverage','Risk reminder','Market impact','Operator guidance']) {
  assert(html.indexOf(heading) !== -1, 'rendered HTML contains heading: ' + heading);
}
assert(/sourced unavailable/.test(html), 'rendered HTML carries "sourced unavailable" for missing sections');
assert(/STANDOUT #1 of 4/.test(html), 'standout numbering present');
assert(/foh-pill fresh/.test(html), 'FRESH lifecycle pill present');
assert(/foh-pill fading/.test(html), 'FADING lifecycle pill present');

// ── T9 — back-compat with legacy thin payload ──
console.log('\nT9 — Renderer back-compat with legacy thin payload:');
const thin = {
  scanTime: '12:00 UTC', marketsScanned: 33,
  marketMood: { discs: '🟠🟠🟠🟠⚫', label: 'Elevated', severity: 'ELEV' },
  standouts: [{ symbol: 'EURUSD', lifecycle: 'FRESH', direction: 'Bullish', score: 9 }],
};
const thinHtml = renderDarkHorseCard(thin);
assert(thinHtml.indexOf('Dark Horse — Live Scan') !== -1, 'legacy thin payload still renders banner');
assert(thinHtml.indexOf('STANDOUT #1') !== -1, 'legacy thin payload renders standout');

// ── T10 — DH image dispatch env-flag gate ──
console.log('\nT10 — DH image dispatch env-flag gate:');
delete process.env.FOH_IMAGE_RENDER_ENABLED;
(async () => {
  const flagOff = await dh.tryPostDarkHorseAsImage('https://discord.com/api/webhooks/x/y', ranking, volatility, {});
  assert(flagOff.ok === false && flagOff.reason === 'env_flag_disabled', 'env-flag unset → ok:false env_flag_disabled');

  // ── T11 — render rich packet to PNG ──
  console.log('\nT11 — Rich packet renders to PNG:');
  const r = await foh.renderFohPng({ kind: 'dark_horse', payload: p });
  assert(r.ok === true, 'rich packet renders to PNG', r.error);
  if (r.ok) {
    assert(r.png && r.png.length > 100000, 'rich PNG > 100KB');
    assert(r.height >= 1500, 'rich PNG height ≥ 1500px (deep body)');
  }

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) { console.error('[DH-FOH-PACKET-QA] FAIL'); process.exit(1); }
  console.log('[DH-FOH-PACKET-QA] PASS — full DH FOH product-depth + renderer + back-compat verified.');
  process.exit(0);
})().catch(e => { console.error('[DH-FOH-PACKET-QA] FATAL ' + e.message); process.exit(2); });
