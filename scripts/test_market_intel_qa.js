#!/usr/bin/env node
'use strict';
// scripts/test_market_intel_qa.js — MARKET_INTEL presentation QA.
//
// Renders coreyMarketIntel.buildPreEventAlertPayload +
// buildReleasedEventAlertPayload + buildGeopoliticalStatusPayload
// against synthetic events, then sweeps the output through the
// centralised banned-string fixture from scripts/qa_banned_strings.js.
//
// Covers the May 2026 hardening pass acceptance:
//   * no DXY: DXY duplication
//   * no [REDACTED-FOMO] (sanitiser silent-strip)
//   * no bare DXY / VIX / US10Y / US2Y / ETF-proxy (UUP / VXX) terms
//   * no Corey / Spidey / Jane / confirmation path / trade alert
//   * full-name-first macro labels present
//   * expanded liquidity / candle-close guidance present
//   * output still posts normally (non-empty content, banner present)

const mi   = require('../coreyMarketIntel');
const fixture = require('./qa_banned_strings');

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); return; }
  failed++;
  console.log(`  ✗ ${label}`);
  if (detail != null) console.log('    ' + String(detail).slice(0, 800));
}

function asContent(payload) {
  return (payload && payload.content) || '';
}

// ── Synthetic event fixtures ────────────────────────────────────
// Each fixture mirrors the live event shape coreyMarketIntel.analyseEvent
// is fed by the scheduler. Fields kept minimal — analyseEvent fills in
// defaults for missing optional fields.
function usdInflationEvent({ minutesOut = 60, withActual = false } = {}) {
  const base = {
    title: 'CPI YoY',
    country: 'US',
    currency: 'USD',
    impact: 'High',
    scheduled_time: Date.now() + minutesOut * 60 * 1000,
    forecast: '3.2',
    previous: '3.1',
  };
  if (withActual) base.actual = '3.4';
  return base;
}
function geopoliticalShockEvent() {
  return {
    title: 'Geopolitical tariff announcement',
    country: 'US',
    currency: 'USD',
    impact: 'High',
    scheduled_time: Date.now() + 30 * 60 * 1000,
  };
}

// ═══════════════════════════════════════════════════════════════
// T1: PRE-EVENT alert — USD CPI, T-1H window
// ═══════════════════════════════════════════════════════════════
console.log('\n[T1] Pre-event alert — USD CPI (T-1H window)');
{
  const ev = usdInflationEvent({ minutesOut: 60 });
  const out = mi.buildPreEventAlertPayload(ev, 60);
  const sanitized = mi.sanitize(out);
  const c = asContent(sanitized);

  ok('non-empty payload', c.length > 100, `chars=${c.length}`);
  ok('banner present', /ATLAS MARKET INTEL — PRE-EVENT ALERT/.test(c));

  // The bucket key for the affected USD basket includes DXY. The old
  // renderer produced "• DXY: DXY". The new one must use the layman label.
  ok('no DXY: DXY double label',
     !/\bDXY\s*:\s*DXY\b/.test(c), c.match(/.{0,40}DXY.{0,40}/g)?.[0]);
  ok('US Dollar Index (DXY) layman label present',
     /US Dollar Index \(DXY\)/.test(c));

  // Engine-name header is renamed.
  ok('"Market read" header present', /\*\*Market read\*\*/.test(c));
  ok('no "Corey read" header', !/\*\*Corey read\*\*/.test(c));

  // No redaction marker can leak (sanitiser silent-strip).
  ok('no [REDACTED-FOMO] marker', !/\[REDACTED-FOMO\]/.test(c));

  // Expanded liquidity / candle-close guidance.
  ok('expanded liquidity wording present',
     /sweep a visible high or low.*close back in favour on the 5M or 15M chart/i.test(c));
  ok('legacy short "liquidity sweep + 5m/15m" wording absent',
     !/liquidity sweep \+ 5m\/15m candle-close confirmation/i.test(c));

  // Global banned-string sweep.
  try {
    fixture.assertClean(c, 'T1 pre-event sanitised content');
    ok('banned-token fixture sweep clean', true);
  } catch (e) {
    ok('banned-token fixture sweep clean', false, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// T2: PRE-EVENT alert — Geopolitical shock (T-RELEASE caution)
// ═══════════════════════════════════════════════════════════════
console.log('\n[T2] Pre-event alert — Geopolitical shock (T-30M window)');
{
  const ev = geopoliticalShockEvent();
  const out = mi.buildPreEventAlertPayload(ev, 30);
  const sanitized = mi.sanitize(out);
  const c = asContent(sanitized);

  ok('non-empty payload', c.length > 100);
  ok('mechanism chain layman-first DXY',
     /US Dollar Index \(DXY\)/.test(c));
  ok('mechanism chain layman-first VIX',
     /CBOE Volatility Index \(VIX\)/.test(c));
  ok('no bare DXY outside parens',
     !/(?<!\()\bDXY\b(?!\))/.test(c), c.match(/.{0,40}DXY.{0,40}/g)?.[0]);
  ok('no bare VIX outside parens',
     !/(?<!\()\bVIX\b(?!\))/.test(c));

  try {
    fixture.assertClean(c, 'T2 pre-event geopolitical sanitised content');
    ok('banned-token fixture sweep clean', true);
  } catch (e) {
    ok('banned-token fixture sweep clean', false, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// T3: RELEASED-event alert — USD CPI with actual print
// ═══════════════════════════════════════════════════════════════
console.log('\n[T3] Released-event alert — USD CPI with surprise');
{
  const ev = usdInflationEvent({ minutesOut: -5, withActual: true });
  const out = mi.buildReleasedEventAlertPayload(ev);
  const sanitized = mi.sanitize(out);
  const c = asContent(sanitized);

  ok('non-empty payload', c.length > 100);
  ok('released banner present', /ATLAS MARKET INTEL — RELEASED EVENT/.test(c));
  ok('"Market read" header present', /\*\*Market read\*\*/.test(c));
  ok('no "Corey read" header', !/\*\*Corey read\*\*/.test(c));
  ok('no DXY: DXY double label', !/\bDXY\s*:\s*DXY\b/.test(c));
  ok('layman DXY label present', /US Dollar Index \(DXY\)/.test(c));
  ok('surprise line present',
     /Print came in \*\*(above|below|in line with) forecast\*\*/.test(c));

  try {
    fixture.assertClean(c, 'T3 released-event sanitised content');
    ok('banned-token fixture sweep clean', true);
  } catch (e) {
    ok('banned-token fixture sweep clean', false, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// T4: Geopolitical status payload — driver row layman-first
// ═══════════════════════════════════════════════════════════════
console.log('\n[T4] Geopolitical status payload — layman-first driver rows');
{
  const geoCtx = {
    level: 'MODERATE',
    summary: 'CBOE Volatility Index (VIX) high',
    breakingNewsStatus: 'unavailable',
    drivers: { vixLevel: 'High', dxyBias: 'Bullish', yieldRegime: 'Normal' },
  };
  const out = mi.buildGeopoliticalStatusPayload(geoCtx);
  const sanitized = mi.sanitize(out);
  const c = asContent(sanitized);

  ok('non-empty payload', c.length > 50);
  ok('CBOE Volatility Index (VIX) layman label present',
     /CBOE Volatility Index \(VIX\) level/.test(c));
  ok('US Dollar Index (DXY) layman label present',
     /US Dollar Index \(DXY\) bias/.test(c));
  ok('no bare VIX outside parens',
     !/(?<!\()\bVIX\b(?!\))/.test(c));
  ok('no bare DXY outside parens',
     !/(?<!\()\bDXY\b(?!\))/.test(c));

  try {
    fixture.assertClean(c, 'T4 geopolitical status sanitised content');
    ok('banned-token fixture sweep clean', true);
  } catch (e) {
    ok('banned-token fixture sweep clean', false, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// T5: Sanitiser silent-strip — no marker on user surface
// ═══════════════════════════════════════════════════════════════
console.log('\n[T5] Sanitiser silent-strip — no [REDACTED-FOMO] leak');
{
  const dirty = { content: 'Full ATLAS confirmation path remains: Corey → Spidey → Jane. This is not a trade alert.' };
  const out = mi.sanitize(dirty);

  ok('sanitiser replaced=true', out.replaced === true);
  ok('content does NOT contain [REDACTED-FOMO]', !/\[REDACTED-FOMO\]/.test(out.content));
  ok('content does NOT contain [REDACTED-', !/\[REDACTED-/.test(out.content));
  ok('content does NOT contain bare Corey', !/\bCorey\b/.test(out.content));
  ok('content does NOT contain bare Spidey', !/\bSpidey\b/.test(out.content));
  ok('content does NOT contain bare Jane', !/\bJane\b/.test(out.content));
  // Whitespace must be collapsed sensibly — no double spaces, no
  // double-blank-line runs of 3+.
  ok('no double-space runs', !/  +/.test(out.content), JSON.stringify(out.content));
  ok('no triple-blank runs', !/\n\n\n/.test(out.content));
}

// ═══════════════════════════════════════════════════════════════
// T6: Bucket aliasing — DXY-only affected list collapses
// ═══════════════════════════════════════════════════════════════
console.log('\n[T6] Bucket aliasing — DXY-only affected list does not double-print');
{
  // Synth event whose affected list is exactly ['DXY']. The bucketing
  // rules map it to the layman-first key. The bucket renderer must
  // suppress the redundant ":DXY" suffix.
  const ev = {
    title: 'US Dollar Index move',
    country: 'US',
    currency: 'USD',
    impact: 'High',
    scheduled_time: Date.now() + 60 * 60 * 1000,
    // analyseEvent derives affected from currency; we go through the
    // pre-event builder which will populate buckets from that result.
  };
  const out = mi.buildPreEventAlertPayload(ev, 60);
  const c = asContent(mi.sanitize(out));
  ok('no DXY: DXY double label in USD-bucketed alert', !/\bDXY\s*:\s*DXY\b/.test(c));
}

// ═══════════════════════════════════════════════════════════════
console.log(`\n==========================`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) process.exit(1);
console.log('[MARKET-INTEL-QA] PASS — every assertion clean.');
