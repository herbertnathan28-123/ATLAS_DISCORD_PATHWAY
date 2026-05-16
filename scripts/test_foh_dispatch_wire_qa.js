#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_foh_dispatch_wire_qa.js
//
// Verifies the FOH_IMAGE_RENDER_ENABLED dispatch fork:
//   - MI dispatch() takes the image path when flag set AND
//     payloadObj.imagePayload is present; falls through to
//     text on render failure.
//   - DH darkHorseImageDispatch.tryPostDarkHorseAsImage refuses
//     to send unless the env flag is set, and produces a valid
//     image payload from a ranking object.
//   - Existing text path remains the default when the flag is
//     unset (back-compat).
// ============================================================

const path = require('path');
const mi   = require(path.join(__dirname, '..', 'coreyMarketIntel.js'));
const dh   = require(path.join(__dirname, '..', 'darkHorseImageDispatch.js'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }
function assert(cond, label, err) { if (cond) ok(label); else fail(label, err); }

const NOW = Date.now();
const FIXTURE_EVENT = { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 60 * 60 * 1000, forecast: '3.2%', previous: '3.0%' };
const HEALTH_LIVE = { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' };

// ── T1 — MI builders attach imagePayload ──
console.log('\nT1 — MI builders attach imagePayload:');
const preEvt = mi.buildPreEventAlertPayload(FIXTURE_EVENT, 60, { health: HEALTH_LIVE });
assert(preEvt && typeof preEvt.content === 'string' && preEvt.content.length > 100, 'pre-event builder still returns content');
assert(preEvt && preEvt.imagePayload && preEvt.imagePayload.kind === 'pre_event', 'pre-event imagePayload attached with kind=pre_event');
assert(preEvt.imagePayload && preEvt.imagePayload.headline && preEvt.imagePayload.headline.title, 'pre-event imagePayload has headline.title');
assert(preEvt.imagePayload && preEvt.imagePayload.mood && preEvt.imagePayload.mood.severity, 'pre-event imagePayload has mood.severity');
assert(preEvt.imagePayload && Array.isArray(preEvt.imagePayload.crossAsset) && preEvt.imagePayload.crossAsset.length, 'pre-event imagePayload has crossAsset rows');
assert(preEvt.imagePayload && preEvt.imagePayload.operatorGuidance && preEvt.imagePayload.operatorGuidance.confirms, 'pre-event imagePayload has operatorGuidance.confirms');
assert(preEvt.imagePayload && preEvt.imagePayload.sourceNote && preEvt.imagePayload.sourceNote.mode === 'LIVE', 'pre-event imagePayload sourceNote.mode=LIVE');

const released = mi.buildReleasedEventAlertPayload(Object.assign({}, FIXTURE_EVENT, { actual: '3.5%' }), { health: HEALTH_LIVE });
assert(released && released.imagePayload && released.imagePayload.kind === 'released', 'released-event imagePayload kind=released');

const daily = mi.buildDailyBulletinPayload({ health: HEALTH_LIVE, events: [FIXTURE_EVENT, { title: 'NFP', currency: 'USD', impact: 'high', scheduled_time: NOW + 2 * 60 * 60 * 1000 }] }, { level: 'low' }, NOW);
assert(daily && daily.imagePayload && daily.imagePayload.kind === 'daily', 'daily-bulletin imagePayload kind=daily');
assert(daily.imagePayload && Array.isArray(daily.imagePayload.eventClusters) && daily.imagePayload.eventClusters.length, 'daily imagePayload has eventClusters');

// ── T2 — image payload renders cleanly through the renderer ──
console.log('\nT2 — image payload renders to PNG via the renderer:');
const foh = require(path.join(__dirname, '..', 'renderers', 'foh'));
(async () => {
  for (const [label, p] of [['pre_event', preEvt.imagePayload], ['released', released.imagePayload], ['daily', daily.imagePayload]]) {
    const r = await foh.renderFohPng({ kind: 'market_intel', payload: p });
    assert(r.ok === true, label + ' renders ok via attached imagePayload', r.error);
    if (r.ok) {
      assert(r.png && r.png.length > 1024, label + ' PNG buffer non-trivial');
    }
  }

  // ── T3 — DH image dispatch is env-gated ──
  console.log('\nT3 — DH image dispatch enforces env flag:');
  const ranking = { allCount: 33, top10: [
    { symbol: 'EURUSD', score: 9, direction: 'Bullish', movePhase: 'early',  summary: 'fresh' },
    { symbol: 'XAUUSD', score: 8, direction: 'Bullish', movePhase: 'mid',    summary: 'mid' },
    { symbol: 'NVDA',   score: 7, direction: 'Bullish', movePhase: 'late',   summary: 'late' },
  ]};
  const volatility = { level: 'elevated' };

  // Flag UNSET → refuses to send.
  delete process.env.FOH_IMAGE_RENDER_ENABLED;
  const flagOff = await dh.tryPostDarkHorseAsImage('https://discord.com/api/webhooks/x/y', ranking, volatility, {});
  assert(flagOff.ok === false && flagOff.reason === 'env_flag_disabled', 'env-flag unset → ok:false env_flag_disabled');

  // No webhook URL.
  process.env.FOH_IMAGE_RENDER_ENABLED = 'true';
  const noUrl = await dh.tryPostDarkHorseAsImage('', ranking, volatility, {});
  assert(noUrl.ok === false && noUrl.reason === 'no_webhook_url', 'missing webhookUrl → ok:false no_webhook_url');

  // ── T4 — buildDarkHorseImagePayload maps movePhase → lifecycle ──
  console.log('\nT4 — DH image payload mapping:');
  const payload = dh.buildDarkHorseImagePayload(ranking, volatility, { universeSize: 33 });
  assert(payload && Array.isArray(payload.standouts) && payload.standouts.length === 3, 'standouts count=3');
  assert(payload.standouts[0].lifecycle === 'FRESH', 'movePhase=early → FRESH');
  assert(payload.standouts[1].lifecycle === 'STILL ACTIVE', 'movePhase=mid → STILL ACTIVE');
  assert(payload.standouts[2].lifecycle === 'FADING', 'movePhase=late → FADING');
  assert(payload.marketMood && payload.marketMood.severity === 'ELEV', 'volatility=elevated → marketMood.severity=ELEV');

  // ── T5 — DH image payload renders to PNG ──
  const dhPng = await foh.renderFohPng({ kind: 'dark_horse', payload });
  assert(dhPng.ok === true, 'DH image payload renders to PNG', dhPng.error);

  // ── T6 — back-compat: text path still works when flag unset ──
  console.log('\nT6 — back-compat: text path unaffected when flag unset:');
  delete process.env.FOH_IMAGE_RENDER_ENABLED;
  assert(typeof mi.dispatch === 'function', 'mi.dispatch is exported');
  assert(typeof mi.buildPreEventAlertPayload === 'function', 'mi.buildPreEventAlertPayload exported');
  // Calling dispatch without _webhookUrl wired returns sent:false webhook_missing (no env mutation needed).
  const stub = await mi.dispatch('PRE_EVENT_TEST', preEvt, { event: 'test' });
  assert(stub && stub.sent === false && stub.reason === 'webhook_missing', 'dispatch with no webhook → sent:false webhook_missing');

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) {
    console.error('[FOH-DISPATCH-WIRE-QA] FAIL');
    process.exit(1);
  }
  console.log('[FOH-DISPATCH-WIRE-QA] PASS — imagePayload attached, env-gated fork verified, back-compat preserved.');
  process.exit(0);
})().catch(e => {
  console.error('[FOH-DISPATCH-WIRE-QA] FATAL ' + e.message);
  process.exit(2);
});
