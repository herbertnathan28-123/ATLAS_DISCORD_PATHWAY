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
assert(miHtml && (/<a [^>]*>Dovish<\/a>/.test(miHtml) || /<span class="foh-term-chip">Dovish<\/span>/.test(miHtml)), 'MI HTML emits terminology chip/link');

// Download-format badges (operator brief 2026-05-16): both badges
// render by default, far-right of the banner subtitle.
assert(miHtml && /foh-format-badge png/.test(miHtml), 'MI HTML emits ↓ PNG badge in banner');
assert(miHtml && /foh-format-badge pdf/.test(miHtml), 'MI HTML emits ↓ PDF badge in banner');
const miLinked = renderMarketIntelCard(Object.assign({}, miPayload, { dashboardDownloadUrls: { png: 'https://atlas.fx/dl/x.png', pdf: 'https://atlas.fx/dl/x.pdf' } }));
assert(/href="https:\/\/atlas\.fx\/dl\/x\.png"/.test(miLinked), 'MI badge wraps to clickable <a> when dashboardDownloadUrls.png supplied');
assert(/href="https:\/\/atlas\.fx\/dl\/x\.pdf"/.test(miLinked), 'MI badge wraps to clickable <a> when dashboardDownloadUrls.pdf supplied');

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
assert(dhHtml && /First logged: <strong>12:00 UTC<\/strong>/.test(dhHtml), 'DH HTML carries first-logged timestamp');
assert(dhHtml && /Still Dark Horse worthy after <strong>2h 30m<\/strong>/.test(dhHtml), 'DH HTML carries duration-alive');
assert(dhHtml && /foh-format-badge png/.test(dhHtml), 'DH HTML emits ↓ PNG badge');
assert(dhHtml && /foh-format-badge pdf/.test(dhHtml), 'DH HTML emits ↓ PDF badge');

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
assert(macroHtml && /foh-format-badge png/.test(macroHtml), 'Macro HTML emits ↓ PNG badge');
assert(macroHtml && /foh-format-badge pdf/.test(macroHtml), 'Macro HTML emits ↓ PDF badge');

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

  // ── PDF render assertions ──
  console.log('\nT3 — PDF render path:');
  for (const [kind, payload] of [['market_intel', miPayload], ['dark_horse', dhPayload], ['macro', macroPayload]]) {
    const r = await foh.renderFohPdf({ kind, payload });
    assert(r.ok === true, kind + ' PDF render ok', r.error);
    if (r.ok) {
      assert(r.pdf && r.pdf.length > 1024, kind + ' PDF buffer non-trivial size (' + (r.pdf && r.pdf.length || 0) + ' bytes)');
      // PDF magic header: %PDF (0x25 0x50 0x44 0x46)
      assert(r.pdf[0] === 0x25 && r.pdf[1] === 0x50 && r.pdf[2] === 0x44 && r.pdf[3] === 0x46, kind + ' PDF buffer has valid %PDF signature');
      assert(r.elapsedMs < 30000, kind + ' PDF render under 30s (' + r.elapsedMs + 'ms)');
    }
  }

  // ── Combined PNG + PDF export ──
  console.log('\nT4 — Combined PNG + PDF export (single Puppeteer launch):');
  const exp = await foh.renderFohExport({ kind: 'market_intel', payload: miPayload });
  assert(exp.ok === true, 'combined export ok', exp.error);
  if (exp.ok) {
    assert(exp.png && exp.png.length > 1024, 'combined export PNG present');
    assert(exp.pdf && exp.pdf.length > 1024, 'combined export PDF present');
    assert(exp.png[0] === 0x89 && exp.png[1] === 0x50, 'combined export PNG has PNG signature');
    assert(exp.pdf[0] === 0x25 && exp.pdf[1] === 0x50, 'combined export PDF has %PDF signature');
    assert(typeof exp.pngBytes === 'number' && exp.pngBytes > 0, 'combined export reports pngBytes');
    assert(typeof exp.pdfBytes === 'number' && exp.pdfBytes > 0, 'combined export reports pdfBytes');
  }

  // ── Safe-fail: unknown kind ──
  console.log('\nT5 — Safe-fail contract:');
  const bad = await foh.renderFohPng({ kind: 'nonsense', payload: {} });
  assert(bad.ok === false && bad.reason === 'html_build_failed', 'unknown kind → ok:false html_build_failed');

  const badPdf = await foh.renderFohPdf({ kind: 'nonsense', payload: {} });
  assert(badPdf.ok === false && badPdf.reason === 'html_build_failed', 'unknown kind PDF → ok:false html_build_failed');

  const badExport = await foh.renderFohExport({ kind: 'nonsense', payload: {} });
  assert(badExport.ok === false && badExport.reason === 'html_build_failed', 'unknown kind export → ok:false html_build_failed');

  // ── Discord post: no webhook URL → ok:false ──
  const noUrl = await foh.postFohPngToDiscord({ kind: 'market_intel', payload: miPayload, webhookUrl: '' });
  assert(noUrl.ok === false && noUrl.reason === 'no_webhook_url', 'missing webhookUrl → ok:false no_webhook_url');

  const noUrlExport = await foh.postFohExportToDiscord({ kind: 'market_intel', payload: miPayload, webhookUrl: '' });
  assert(noUrlExport.ok === false && noUrlExport.reason === 'no_webhook_url', 'missing webhookUrl on export post → ok:false no_webhook_url');

  // ── PDF-skipped path: tiny cap forces PNG-only attachment ──
  // We monkey-patch fetch to capture the multipart attachments so
  // we can verify only PNG was attached when PDF exceeds the cap.
  console.log('\nT6 — PDF-skipped path when over cap:');
  const origFetch = global.fetch;
  let capturedAttachments = null;
  global.fetch = async (_url, init) => {
    // Parse multipart body to find attachment filenames.
    const body = init.body instanceof Buffer ? init.body.toString('binary') : String(init.body || '');
    const names = [...body.matchAll(/filename="([^"]+)"/g)].map(m => m[1]);
    capturedAttachments = names;
    return { ok: true, status: 200 };
  };
  const FAKE_URL = 'https://discord.com/api/webhooks/123/abc';
  const skipResult = await foh.postFohExportToDiscord({
    kind: 'market_intel', payload: miPayload, webhookUrl: FAKE_URL,
    caption: 'qa', maxAttachmentBytes: 1024,  // tiny cap forces PDF skip
  });
  global.fetch = origFetch;
  assert(skipResult.ok === true, 'tiny-cap post still ok with PNG only');
  assert(skipResult.pdfSkipped === true, 'tiny-cap post flags pdfSkipped=true');
  assert(/pdf_exceeds_cap/.test(skipResult.pdfSkipReason || ''), 'tiny-cap post records pdf_exceeds_cap reason');
  assert(capturedAttachments && capturedAttachments.length === 1, 'tiny-cap post attached only 1 file (PNG)');
  assert(capturedAttachments && /\.png$/.test(capturedAttachments[0] || ''), 'tiny-cap post attachment is PNG');

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
