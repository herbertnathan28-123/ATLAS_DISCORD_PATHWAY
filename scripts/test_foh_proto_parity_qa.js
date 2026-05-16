#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_foh_proto_parity_qa.js
//
// PHASE 1-4 PROOF GATE (operator directive 2026-05-17):
// Verifies the live-renderable FOH path consumes the prototype
// HTML artefacts as the visual + structural source of truth.
//
//   - dh-foh-v6.html and market-intel-foh-v3.html load from
//     docs/screenshots/ via protoShell.
//   - Adapter substitutes live values at named anchor points
//     while preserving every other byte of the prototype HTML.
//   - Output for both kinds renders to multi-card PNG split
//     through the renderFohSplit pipeline (operator PR #118
//     readability gate).
// ============================================================

const path = require('path');
const fs = require('fs');
const proto = require(path.join(__dirname, '..', 'renderers', 'foh', 'protoShell'));
const miAdapter = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Adapter'));
const dhAdapter = require(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseV6Adapter'));
const foh = require(path.join(__dirname, '..', 'renderers', 'foh'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }
function assert(cond, label, err) { if (cond) ok(label); else fail(label, err); }

// ── T1 — prototype artefacts loaded ─────────────────────────
console.log('\nT1 — Prototype artefacts loaded from docs/screenshots/:');
const miHtml = proto.getMarketIntelV3Html();
const dhHtml = proto.getDarkHorseV6Html();
assert(miHtml && miHtml.length > 30000, 'MI v3 prototype HTML loaded (' + (miHtml ? miHtml.length : 0) + ' bytes)');
assert(dhHtml && dhHtml.length > 40000, 'DH v6 prototype HTML loaded (' + (dhHtml ? dhHtml.length : 0) + ' bytes)');
assert(/dark-horse-radar/.test(dhHtml || ''), 'DH v6 carries the prototype channel name');
assert(/market-intel/.test(miHtml || ''), 'MI v3 carries the prototype channel name');
assert(/FOH\.1\.0\.1 prototype v6/.test(dhHtml || ''), 'DH v6 banner version stamp present');
assert(/FOH\.1\.0\.1 Market Intel prototype v3/.test(miHtml || ''), 'MI v3 banner version stamp present');

// ── T2 — prototype invariants (the lines that must NOT change) ──
console.log('\nT2 — Prototype invariants preserved by adapter:');
const dhAdapted = dhAdapter.adapt(dhHtml, {
  now: Date.parse('2026-05-16T12:00:00Z'),
  marketsScanned: 33,
  marketMood: { discs: '🟠🟠🟠🟠⚫', label: '4/5 — Elevated' },
  standouts: [
    { symbol: 'GBPUSD', lifecycle: 'FRESH', direction: 'Bullish' },
    { symbol: 'XAGUSD', lifecycle: 'STILL ACTIVE', direction: 'Bullish', durationAlive: '3d 2h' },
    { symbol: 'TSLA', lifecycle: 'FADING', direction: 'Bearish' },
  ],
});
// The doctrine prose blocks must persist byte-identical.
assert(/The broader market is moving fast/.test(dhAdapted), 'DH: "broader market is moving fast" prose preserved');
assert(/confirmed directional structure/.test(dhAdapted), 'DH: "confirmed directional structure" doctrine preserved');
assert(/Do NOT chase already-extended moves/.test(dhAdapted), 'DH: anti-chase doctrine preserved');
assert(/EXPANDED TERMINOLOGY HYPERLINKS/.test(dhAdapted), 'DH: glossary header preserved');
// Adapter substitutions
assert(/Saturday 16 May/.test(dhAdapted), 'DH: live timestamp injected');
assert(/STANDOUT #1 of 3  ·  GBPUSD just appeared/.test(dhAdapted), 'DH: standout 1 symbol injected (GBPUSD)');
assert(/STANDOUT #2 of 3  ·  XAGUSD/.test(dhAdapted), 'DH: standout 2 symbol injected (XAGUSD)');
assert(/STANDOUT #3 of 3  ·  TSLA/.test(dhAdapted), 'DH: standout 3 symbol injected (TSLA)');
assert(/🐎  GBPUSD  ·  STRONG BULLISH/.test(dhAdapted), 'DH: embed title (GBPUSD STRONG BULLISH) injected for FRESH slot');
assert(/🐎  XAGUSD  ·  STILL TRENDING/.test(dhAdapted), 'DH: embed title (XAGUSD STILL TRENDING) injected for STILL ACTIVE slot');
assert(/🐎  TSLA  ·  DEVELOPING WATCH/.test(dhAdapted), 'DH: embed title (TSLA DEVELOPING WATCH) injected for FADING slot');

const miAdapted = miAdapter.adapt(miHtml, {
  eventClusters: [
    { currency: 'USD', severity: 'HIGH', events: [
      { title: 'CPI (USD)', severity: 'HIGH', time: '12:30 AWST · 04:30 UTC', currency: 'USD' },
      { title: 'Non Farm Payrolls', severity: 'HIGH', time: '14:30 AWST · 06:30 UTC', currency: 'USD' },
    ]},
    { currency: 'EUR', severity: 'HIGH', events: [
      { title: 'ECB Rate Decision', severity: 'HIGH', time: '20:30 AWST · 12:30 UTC', currency: 'EUR' },
    ]},
  ],
  marketMood: { discs: '🟠🟠🟠🟠⚫', label: '4/5 — Elevated' },
});
// MI doctrine prose preserved
assert(/Markets are sensitive/.test(miAdapted), 'MI: "Markets are sensitive" prose preserved');
assert(/POSSIBLE MARKET REACTION PATHS/.test(miAdapted), 'MI: reaction-paths banner preserved');
assert(/RISK ESCALATION/.test(miAdapted), 'MI: risk-escalation banner preserved');
assert(/EVENT-DAY REFERENCE/.test(miAdapted), 'MI: event-day reference banner preserved');
// MI substitutions
assert(/3 major events landing in the next 6 hours/.test(miAdapted), 'MI: live event count narrative injected');
assert(/CPI \(USD\)/.test(miAdapted), 'MI: live primary event title injected');

// ── T3 — multi-card split via prototype shell ──────────────
console.log('\nT3 — Multi-card split via prototype shell:');
const miCards = proto.buildMarketIntelV3Cards(miAdapted);
const dhCards = proto.buildDarkHorseV6Cards(dhAdapted);
assert(miCards.length === 6, 'MI v3 → 6 cards');
assert(dhCards.length === 4, 'DH v6 → 4 cards');
const cardLabels = miCards.map(c => c.label).join(',');
assert(/card-1-mood-events-primary/.test(cardLabels), 'MI card-1 (mood + events + primary) present');
assert(/card-6-briefing-summary/.test(cardLabels), 'MI card-6 (briefing summary) present');
const dhLabels = dhCards.map(c => c.label).join(',');
assert(/card-1-banner-and-fresh/.test(dhLabels), 'DH card-1 (banner + fresh) present');
assert(/card-4-reference-and-footer/.test(dhLabels), 'DH card-4 (reference + footer) present');

// ── T4 — Round-trip render via renderFohSplit ──────────────
console.log('\nT4 — Round-trip render via renderFohSplit (Puppeteer end-to-end):');
(async () => {
  const dhPayload = {
    now: Date.parse('2026-05-16T12:00:00Z'),
    marketsScanned: 33,
    marketMood: { discs: '🟠🟠🟠🟠⚫', label: '4/5 — Elevated' },
    standouts: [
      { symbol: 'EURUSD', lifecycle: 'FRESH', direction: 'Bullish' },
      { symbol: 'XAUUSD', lifecycle: 'STILL ACTIVE', direction: 'Bullish', durationAlive: '2d' },
      { symbol: 'NVDA', lifecycle: 'FADING', direction: 'Bullish' },
    ],
  };
  const dhSplit = await foh.renderFohSplit({ kind: 'dark_horse', payload: dhPayload });
  assert(dhSplit.ok === true, 'DH renderFohSplit ok', dhSplit.error);
  if (dhSplit.ok) {
    assert(dhSplit.pngs.length === 4, 'DH renders 4 PNG cards');
    assert(dhSplit.pdf && dhSplit.pdfBytes > 1024, 'DH full-doc PDF generated');
    for (const p of dhSplit.pngs) {
      assert(p.png && p.bytes > 1024, p.label + ' has non-trivial PNG');
      assert(p.png && p.png[0] === 0x89 && p.png[1] === 0x50, p.label + ' has valid PNG signature');
    }
  }

  const miPayload = {
    eventClusters: [
      { currency: 'USD', severity: 'HIGH', events: [{ title: 'CPI (USD)', severity: 'HIGH', time: '12:30 AWST · 04:30 UTC', currency: 'USD' }]},
    ],
    marketMood: { discs: '🟠🟠🟠⚫⚫', label: '3/5 — Active' },
  };
  const miSplit = await foh.renderFohSplit({ kind: 'market_intel', payload: miPayload });
  assert(miSplit.ok === true, 'MI renderFohSplit ok', miSplit.error);
  if (miSplit.ok) {
    assert(miSplit.pngs.length === 6, 'MI renders 6 PNG cards');
    assert(miSplit.pdf && miSplit.pdfBytes > 1024, 'MI full-doc PDF generated');
    for (const p of miSplit.pngs) {
      assert(p.png && p.bytes > 1024, p.label + ' has non-trivial PNG');
    }
  }

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) { console.error('[FOH-PROTO-PARITY-QA] FAIL'); process.exit(1); }
  console.log('[FOH-PROTO-PARITY-QA] PASS — prototype shell + adapter end-to-end verified.');
  process.exit(0);
})().catch(e => { console.error('[FOH-PROTO-PARITY-QA] FATAL ' + e.message); process.exit(2); });
