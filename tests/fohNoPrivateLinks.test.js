#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/fohNoPrivateLinks.test.js
//
// Operator directive 2026-05-17 — Hard guard. Fails the build
// if any user-facing FOH output (HTML, rendered cards, Discord
// message body, PDF surface) contains private-backend material:
//   notion.so / Notion / "go to" / "view in Notion" /
//   "open workspace" / raw backend URLs / undefined / null /
//   [object Object] / lorem ipsum / Mechanism Chain (user-facing)
// ============================================================

const path = require('path');
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const { buildDarkHorsePacket }   = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const dhViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'darkHorseViewModel'));
const miShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell'));
const dhShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseV6Shell'));
const protoShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'protoShell'));
const miV3Adapter = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Adapter'));
const dhV6Adapter = require(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseV6Adapter'));
const { containsPrivateBackendUrl } = require(path.join(__dirname, '..', 'foh', 'dispatch', '_discordPost'));

const BANNED_SUBSTRINGS = [
  'notion.so',
  'notion.com',
  'notion.site',
  'Mechanism Chain',
  'go to Notion',
  'view in Notion',
  'open workspace',
  'lorem ipsum',
  '[object Object]',
];

const BANNED_PATTERNS_USERFACING = [
  /\bundefined\b/,
  /\bnull\b/,
];

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }
function assertNoBanned(haystack, label) {
  if (typeof haystack !== 'string') { fail(label, 'not a string'); return; }
  for (const sub of BANNED_SUBSTRINGS) {
    if (haystack.indexOf(sub) !== -1) { fail(label, 'contains banned substring: ' + sub); return; }
  }
  // The userFacing-specific patterns only apply to the Discord
  // text body, not to HTML/CSS which legitimately can contain
  // "null" inside selectors/attribute values. Caller decides.
  ok(label);
}
function assertNoBannedUserFacing(haystack, label) {
  if (typeof haystack !== 'string') { fail(label, 'not a string'); return; }
  for (const sub of BANNED_SUBSTRINGS) {
    if (haystack.indexOf(sub) !== -1) { fail(label, 'contains banned substring: ' + sub); return; }
  }
  for (const re of BANNED_PATTERNS_USERFACING) {
    if (re.test(haystack)) { fail(label, 'matches banned pattern: ' + re); return; }
  }
  ok(label);
}

(async () => {
  console.log('\nT1 — Source files free of notion URLs:');
  const fs = require('fs');
  // EXEMPT — these modules' JOB is to detect/strip private-backend
  // URLs in upstream output. They legitimately contain the patterns
  // they reject; they never EMIT them user-facing.
  const SCRUBBER_EXEMPT = new Set([
    'foh/dispatch/_discordPost.js',
    'foh/adapters/marketIntelViewModel.js',
    'foh/adapters/darkHorseViewModel.js',
    'renderers/foh/marketIntelV3Shell.js',
    'renderers/foh/darkHorseV6Shell.js',
    'tests/fohNoPrivateLinks.test.js',
  ]);
  const RUNTIME_FILES = [
    'coreyMarketIntel.js',
    'darkHorseFoh.js',
    'darkHorseImageDispatch.js',
    'macro/glossary.js',
    'macro/roadmapLink.js',
    'renderers/foh/darkHorseCard.js',
    'renderers/foh/darkHorseFohPacket.js',
    'renderers/foh/darkHorseV6Adapter.js',
    'renderers/foh/index.js',
    'renderers/foh/marketIntelCard.js',
    'renderers/foh/marketIntelFohPacket.js',
    'renderers/foh/marketIntelPrototypeCard.js',
    'renderers/foh/marketIntelV3Adapter.js',
    'renderers/foh/macroCard.js',
    'renderers/foh/protoShell.js',
    'foh/buildMarketIntelPacket.js',
    'foh/buildDarkHorsePacket.js',
    'foh/adapters/marketIntelViewModel.js',
    'foh/adapters/darkHorseViewModel.js',
    'foh/dispatch/sendMarketIntelFoh.js',
    'foh/dispatch/sendDarkHorseFoh.js',
    'foh/dispatch/_discordPost.js',
    'renderers/foh/marketIntelV3Shell.js',
    'renderers/foh/darkHorseV6Shell.js',
  ];
  for (const rel of RUNTIME_FILES) {
    const abs = path.join(__dirname, '..', rel);
    if (!fs.existsSync(abs)) continue;
    if (SCRUBBER_EXEMPT.has(rel)) { ok(rel + ' (scrubber — exempt)'); continue; }
    const body = fs.readFileSync(abs, 'utf8');
    if (/notion\.(so|com|site)/i.test(body)) fail(rel + ' contains notion URL');
    else ok(rel + ' clean');
  }

  console.log('\nT2 — Prototype HTML free of notion URLs:');
  const miProto = protoShell.getMarketIntelV3Html() || '';
  const dhProto = protoShell.getDarkHorseV6Html() || '';
  assertNoBanned(miProto, 'MI prototype HTML free of notion');
  assertNoBanned(dhProto, 'DH prototype HTML free of notion');

  console.log('\nT3 — Adapted HTML free of notion URLs:');
  const miAdapted = miV3Adapter.adapt(miProto, {
    eventClusters: [{ currency: 'USD', severity: 'HIGH', events: [{ title: 'CPI (USD)', severity: 'HIGH', time: '12:30 AWST · 04:30 UTC', currency: 'USD' }]}],
    marketMood: { discs: '🟠🟠🟠🟠⚫', label: '4/5 — Elevated' },
  });
  const dhAdapted = dhV6Adapter.adapt(dhProto, {
    now: Date.now(), marketsScanned: 33,
    standouts: [{ symbol: 'EURUSD', lifecycle: 'FRESH', direction: 'Bullish' }],
  });
  assertNoBanned(miAdapted, 'MI adapted HTML free of notion');
  assertNoBanned(dhAdapted, 'DH adapted HTML free of notion');

  console.log('\nT4 — Fixed-contract packet free of notion URLs:');
  const miPacket = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'HIGH', label: 'High' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI', time: '12:30 UTC' }]}] } });
  const dhPacket = buildDarkHorsePacket({ ranking: { top10: [{ symbol: 'EURUSD', movePhase: 'early', score: 9, direction: 'Bullish' }], allCount: 33 }, volatility: { level: 'ELEV' } });
  assertNoBanned(JSON.stringify(miPacket), 'MI fixed-contract packet free of notion');
  assertNoBanned(JSON.stringify(dhPacket), 'DH fixed-contract packet free of notion');

  console.log('\nT5 — Discord text summary free of notion + bad placeholders:');
  const miVM = miViewModel.toViewModel(miPacket);
  const dhVM = dhViewModel.toViewModel(dhPacket);
  const miText = miShell.buildDiscordTextSummary(miVM, {});
  const dhText = miShell.buildDiscordTextSummary(dhVM, {});
  assertNoBannedUserFacing(miText, 'MI Discord text summary clean');
  assertNoBannedUserFacing(dhText, 'DH Discord text summary clean');

  console.log('\nT6 — _discordPost guard rejects notion URL in content:');
  if (containsPrivateBackendUrl('hello notion.so/abc world')) ok('_discordPost detects notion.so'); else fail('_discordPost missed notion.so');
  if (!containsPrivateBackendUrl('hello world no leak')) ok('_discordPost passes clean text'); else fail('_discordPost false positive');

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) { console.error('[FOH-NO-PRIVATE-LINKS] FAIL'); process.exit(1); }
  console.log('[FOH-NO-PRIVATE-LINKS] PASS');
  process.exit(0);
})().catch(e => { console.error('[FOH-NO-PRIVATE-LINKS] FATAL ' + e.message); process.exit(2); });
