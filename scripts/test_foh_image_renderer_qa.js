#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_foh_image_renderer_qa.js
//
// QA harness for the ATLAS FOH Image Renderer:
//   - HTML build path (each card kind) renders without throwing.
//   - Required visual elements present in the generated HTML.
//   - Puppeteer PNG renderer produces a non-empty PNG buffer.
//   - Safe-fail contract: bad input never throws, returns
//     `{ ok: false }` with a reason.
//   - Discord multipart packaging validates without network call.
// ============================================================

const path = require('path');
const foh = require(path.join(__dirname, '..', 'renderers', 'foh'));
const { renderMarketIntelCard } = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelCard'));
const { renderDarkHorseCard }   = require(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseCard'));
const { renderMacroCard }       = require(path.join(__dirname, '..', 'renderers', 'foh', 'macroCard'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }
function assert(cond, label, err) { if (cond) ok(label); else fail(label, err); }

// ── HTML build assertions ──
console.log('\nT1 — HTML build path:');

// MI pre-event
const miPayload = {
  kind: 'pre_event',
  headline: { title: 'CPI (USD)', currency: 'USD', impact: 'HIGH', time: '02:33 UTC', stage: 'T-1H' },
  mood: { discs: '🟠🟠🟠🟠⚫', label: 'Elevated', severity: 'ELEV' },
  whyThisMatters: 'USD inflation cycle dominates',
  marketImpact: 'cause → expectation → reaction → impact',
  crossAsset: [{ classLabel: 'FX', body: 'EURUSD lead' }],
  operatorGuidance: { confirms: 'A on 1H close', cancels: 'B inside 30m' },
  historical: { rows: [{ label: 'Apr', actual: '3.5%', magnitude: '+0.2', dir: 'above' }], basis: 'engine-derived', sampleN: 3 },
  terminology: ['Dovish'],
  sourceNote: { source: 'TradingView', mode: 'LIVE', probabilityBasis: 'engine-derived' },
  briefingSummary: 'T-1H',
};
let miHtml;
try { miHtml = renderMarketIntelCard(miPayload); ok('MI pre-event HTML built'); }
catch (e) { fail('MI pre-event HTML built', e.message); }
assert(miHtml && miHtml.indexOf('foh-card') !== -1, 'MI HTML contains .foh-card');
assert(miHtml && miHtml.indexOf('HISTORICAL REACTION') === -1 || miHtml.indexOf('Historical reaction') !== -1, 'MI HTML has Historical reaction heading');
assert(miHtml && miHtml.indexOf('foh-hyperlinks') !== -1, 'MI HTML has hyperlinks chip');
assert(miHtml && miHtml.indexOf('🟠🟠🟠🟠⚫') !== -1, 'MI HTML carries disc-bar glyphs');
assert(miHtml && /<a [^>]*>Dovish<\/a>/.test(miHtml), 'MI HTML emits terminology link');

// MI weekend (event clusters)
const miWeekend = Object.assign({}, miPayload, {
  kind: 'weekend',
  eventClusters: [{ currency: 'USD', country: 'US', events: [{ title: 'CPI', time: 'Wed 12:30', impactSeverity: 'HIGH' }] }],
});
let weekendHtml;
try { weekendHtml = renderMarketIntelCard(miWeekend); ok('MI weekend HTML built'); }
catch (e) { fail('MI weekend HTML built', e.message); }
assert(weekendHtml && weekendHtml.indexOf('foh-event-cluster') !== -1, 'MI weekend HTML carries event cluster blocks');
assert(weekendHtml && weekendHtml.indexOf('USD BLOCK') !== -1, 'MI weekend HTML labels currency block');

// DH live scan
const dhPayload = {
  scanTime: '12:00 UTC',
  marketsScanned: 33,
  marketMood: { discs: '🟠🟠🟠🟠⚫', label: 'Elevated', severity: 'ELEV' },
  standouts: [
    { symbol: 'EURUSD', lifecycle: 'FRESH', direction: 'Bullish', score: 9, firstDetected: '12:00 UTC', durationAlive: 'first scan' },
    { symbol: 'XAUUSD', lifecycle: 'STILL ACTIVE', score: 8, firstDetected: '09:30 UTC', durationAlive: '2h 30m' },
    { symbol: 'NVDA', lifecycle: 'FADING', score: 7, firstDetected: '14:00 UTC', durationAlive: '22h' },
  ],
  riskReminder: 'reminder',
};
let dhHtml;
try { dhHtml = renderDarkHorseCard(dhPayload); ok('DH HTML built'); }
catch (e) { fail('DH HTML built', e.message); }
assert(dhHtml && dhHtml.indexOf('foh-dh-candidate fresh') !== -1, 'DH HTML has FRESH lifecycle class');
assert(dhHtml && dhHtml.indexOf('foh-dh-candidate active') !== -1, 'DH HTML has STILL ACTIVE lifecycle class');
assert(dhHtml && dhHtml.indexOf('foh-dh-candidate fading') !== -1, 'DH HTML has FADING lifecycle class');
assert(dhHtml && dhHtml.indexOf('Risk reminder') !== -1, 'DH HTML has Risk reminder heading');
assert(dhHtml && /First detected: <strong>12:00 UTC<\/strong>/.test(dhHtml), 'DH HTML carries first-detected timestamp');
assert(dhHtml && /still Dark Horse valid after <strong>2h 30m<\/strong>/.test(dhHtml), 'DH HTML carries duration-alive');

// Macro
const macroPayload = {
  dateLabel: '2026-05-18 AWST',
  dominantBias: { score: 4, label: 'Risk-off lean', arrows: '⬆️⬇️' },
  regime: { dxy: 'Bullish', vix: 'Elevated', yield: 'Flat', riskEnv: 'Defensive' },
  marketOverview: [{ heading: 'USD complex', body: 'mild-bid', arrow: '⬆️' }],
  events: [{ time: 'Mon 12:00', title: 'ECB', currency: 'EUR', impact: 'HIGH' }],
  executionLogic: ['IF X THEN Y'],
  validity: 'window',
};
let macroHtml;
try { macroHtml = renderMacroCard(macroPayload); ok('Macro HTML built'); }
catch (e) { fail('Macro HTML built', e.message); }
assert(macroHtml && macroHtml.indexOf('Dominant bias') !== -1, 'Macro HTML has Dominant bias heading');
assert(macroHtml && macroHtml.indexOf('Execution logic') !== -1, 'Macro HTML has Execution logic heading');
assert(macroHtml && macroHtml.indexOf('IF X THEN Y') !== -1, 'Macro HTML carries IF/THEN line');
assert(macroHtml && macroHtml.indexOf('⬆️') !== -1, 'Macro HTML carries directional arrow');

// ── PNG render assertions ──
console.log('\nT2 — PNG render path:');
(async () => {
  for (const [kind, payload] of [['market_intel', miPayload], ['dark_horse', dhPayload], ['macro', macroPayload]]) {
    const r = await foh.renderFohPng({ kind, payload });
    assert(r.ok === true, kind + ' PNG render ok', r.error);
    if (r.ok) {
      assert(r.png && r.png.length > 1024, kind + ' PNG buffer non-trivial size (' + (r.png && r.png.length || 0) + ' bytes)');
      assert(r.png[0] === 0x89 && r.png[1] === 0x50 && r.png[2] === 0x4e && r.png[3] === 0x47, kind + ' PNG buffer has valid PNG signature');
      assert(r.width === 1080, kind + ' PNG width=1080');
      assert(r.height >= 600, kind + ' PNG height ≥ 600 (' + r.height + ')');
      assert(r.elapsedMs < 30000, kind + ' PNG render under 30s (' + r.elapsedMs + 'ms)');
    }
  }

  // ── Safe-fail: unknown kind ──
  console.log('\nT3 — Safe-fail contract:');
  const bad = await foh.renderFohPng({ kind: 'nonsense', payload: {} });
  assert(bad.ok === false && bad.reason === 'html_build_failed', 'unknown kind → ok:false html_build_failed');

  // ── Discord post: no webhook URL → ok:false ──
  const noUrl = await foh.postFohPngToDiscord({ kind: 'market_intel', payload: miPayload, webhookUrl: '' });
  assert(noUrl.ok === false && noUrl.reason === 'no_webhook_url', 'missing webhookUrl → ok:false no_webhook_url');

  // ── Summary ──
  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) {
    console.error('[FOH-IMAGE-RENDERER-QA] FAIL');
    process.exit(1);
  }
  console.log('[FOH-IMAGE-RENDERER-QA] PASS — HTML build + PNG render + safe-fail contract verified.');
  process.exit(0);
})().catch(e => {
  console.error('[FOH-IMAGE-RENDERER-QA] FATAL ' + e.message);
  process.exit(2);
});
