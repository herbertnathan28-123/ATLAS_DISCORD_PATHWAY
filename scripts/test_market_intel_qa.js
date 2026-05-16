#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * MARKET_INTEL presentation QA.
 *
 * Builds every user-facing MARKET_INTEL payload (pre-event alert,
 * released-event alert, daily bulletin) against representative
 * fixtures and asserts every locked locked dashboard/macro wording
 * rule PLUS the FOH v6 Market Intel doctrine (operator directive
 * 2026-05-15):
 *
 *   Wording bans (must NOT appear on the user surface):
 *     - bare DXY / VIX / US10Y / US2Y (must use expanded form)
 *     - [REDACTED-FOMO] markers
 *     - raw BOS / CHoCH (must use bracketed structure language)
 *     - "prints" / "print" verb forms (no "the print", no
 *       "inflation print")
 *     - "Trigger Level" (decision-level wording only when an
 *       actual level is relevant)
 *     - "liquidity sweep + 5m/15m candle-close confirmation"
 *       legacy boilerplate
 *     - "Corey read" / "DXY: DXY" / "VIX: VIX" legacy regressions
 *
 *   Presence checks (FOH v6 doctrine — must appear):
 *     - SOURCE NOTE provenance line ("calendar=… · macro=ATLAS · probability=…")
 *     - Lifecycle badge (NEW WATCH / STILL ACTIVE / ESCALATING /
 *       RELEASE WINDOW / RESULT IN / COOLING / INVALIDATED)
 *     - Probability label declared on every output (one of the
 *       four basis tags)
 *     - BEFORE / DURING / AFTER framework on pre-event surfaces
 *     - Discord embed-safe: every payload <= 1900 chars (the
 *       validateMarketIntelPayload safe cap)
 *
 * Wired as `npm run qa:market-intel`.
 */

const path = require('path');
const mi   = require(path.join(__dirname, '..', 'coreyMarketIntel.js'));

const SAFE_CAP = 1900;
const NEAR_CAP_WARN = 500;

// ── Bare-abbreviation guard ─────────────────────────────────
// Token-boundary occurrences of the abbreviation that are NOT
// part of the expansion `<expandedPrefix>(ABBR)`.
function findBareAbbrev(text, abbrev, expandedPrefix) {
  const re = new RegExp('\\b' + abbrev + '\\b', 'g');
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    const after = text.slice(m.index + abbrev.length, m.index + abbrev.length + 1);
    const isInExpansion = before.endsWith(expandedPrefix + '(') && after === ')';
    if (!isInExpansion) {
      hits.push({
        abbrev,
        context: text.slice(Math.max(0, m.index - 40), m.index + abbrev.length + 40).replace(/\s+/g, ' ').trim()
      });
    }
  }
  return hits;
}

// Fixed banned-token regex set. Each entry MUST stay absent
// from the user-facing Market Intel payload.
const FIXED_BANNED = [
  { name: 'redacted_fomo',         re: /\[REDACTED-FOMO\]/i },
  { name: 'legacy_lq_sweep_boilerplate', re: /\bliquidity sweep \+ 5m\/15m candle-close confirmation\b/i },
  { name: 'legacy_corey_read',     re: /\bCorey read\b/ },
  { name: 'redundant_dxy_row',     re: /\bDXY:\s*DXY\b/i },
  { name: 'redundant_vix_row',     re: /\bVIX:\s*VIX\b/i },
  { name: 'raw_BOS',               re: /\bBOS\b/ },
  { name: 'raw_CHoCH',             re: /\bCHoCH\b/ },
  { name: 'prints_verb',           re: /\bprints?\b/i },
  { name: 'trigger_level',         re: /\bTrigger Level\b/i },
];

const ABBREV_RULES = [
  { abbrev: 'DXY',   expansion: 'US Dollar Index ' },
  { abbrev: 'VIX',   expansion: 'CBOE Volatility Index ' },
  { abbrev: 'US10Y', expansion: 'US 10-Year Treasury Yield ' },
  { abbrev: 'US2Y',  expansion: 'US 2-Year Treasury Yield ' },
];

// FOH v6 lifecycle labels — at least one must appear.
const LIFECYCLE_TAGS = ['NEW WATCH', 'STILL ACTIVE', 'ESCALATING', 'RELEASE WINDOW', 'RESULT IN', 'COOLING', 'INVALIDATED'];

// Probability provenance labels (macro/probabilityLabelling parity).
const PROBABILITY_BASES = ['historically sourced', 'engine-derived', 'scenario estimate', 'insufficient evidence'];

function auditPresence(content) {
  const errors = [];
  function hasBoxed(label) {
    return new RegExp('▛[^\\n]*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*▜').test(content);
  }
  // SOURCE NOTE provenance row.
  if (!/calendar=\S+\s*·\s*macro=ATLAS\s*·\s*probability=/.test(content)) {
    errors.push({ kind: 'missing-presence', token: 'SOURCE NOTE', context: 'calendar=… · macro=ATLAS · probability=… line absent' });
  }
  // Lifecycle badge — at least one canonical lifecycle tag.
  if (!LIFECYCLE_TAGS.some(t => new RegExp('\\b' + t.replace(/ /g, '\\s+') + '\\b').test(content))) {
    errors.push({ kind: 'missing-presence', token: 'LIFECYCLE', context: 'no canonical lifecycle tag (NEW WATCH / STILL ACTIVE / …)' });
  }
  // Probability provenance — at least one valid basis.
  if (!PROBABILITY_BASES.some(b => content.indexOf(b) !== -1)) {
    errors.push({ kind: 'missing-presence', token: 'PROBABILITY BASIS', context: 'no probability basis label found in SOURCE NOTE' });
  }
  // MARKET MOOD section.
  if (!hasBoxed('MARKET MOOD')) {
    errors.push({ kind: 'missing-presence', token: 'MARKET MOOD', context: 'boxed MARKET MOOD section absent' });
  }
  // WHY THIS MATTERS section.
  if (!hasBoxed('WHY THIS MATTERS')) {
    errors.push({ kind: 'missing-presence', token: 'WHY THIS MATTERS', context: 'boxed WHY THIS MATTERS section absent' });
  }
  // WHAT CONFIRMS section (renamed from CONFIRMATION PATH due to fomo ban).
  if (!hasBoxed('WHAT CONFIRMS')) {
    errors.push({ kind: 'missing-presence', token: 'WHAT CONFIRMS', context: 'boxed WHAT CONFIRMS section absent' });
  }
  // WHAT CANCELS section.
  if (!hasBoxed('WHAT CANCELS')) {
    errors.push({ kind: 'missing-presence', token: 'WHAT CANCELS', context: 'boxed WHAT CANCELS section absent' });
  }
  // AFFECTED MARKETS section.
  if (!hasBoxed('AFFECTED MARKETS')) {
    errors.push({ kind: 'missing-presence', token: 'AFFECTED MARKETS', context: 'boxed AFFECTED MARKETS section absent' });
  }
  // NEXT REVIEW section.
  if (!hasBoxed('NEXT REVIEW')) {
    errors.push({ kind: 'missing-presence', token: 'NEXT REVIEW', context: 'boxed NEXT REVIEW section absent' });
  }
  // SOURCE NOTE section.
  if (!hasBoxed('SOURCE NOTE')) {
    errors.push({ kind: 'missing-presence', token: 'SOURCE NOTE BOX', context: 'boxed SOURCE NOTE section absent' });
  }
  // Conditional-bias disclaimer footer.
  if (!/Bias remains conditional/.test(content)) {
    errors.push({ kind: 'missing-presence', token: 'BIAS_DISCLAIMER', context: 'conditional-bias disclaimer absent' });
  }
  // Lane 1 doctrine (operator brief 2026-05-16): glossary chip required.
  if (!/📘\s*\[\[Glossary/.test(content)) {
    errors.push({ kind: 'missing-presence', token: 'GLOSSARY_CHIP', context: 'macro glossary hyperlink chip absent' });
  }
  return errors;
}

function audit(label, content, opts) {
  opts = opts || {};
  if (!content || typeof content !== 'string') {
    return { label, ok: false, errors: [{ kind: 'empty-content', token: 'content', context: 'payload had no content' }], size: 0 };
  }
  const errors = [];
  // 1. Wording bans
  for (const r of FIXED_BANNED) {
    const m = content.match(r.re);
    if (m) {
      const idx = content.indexOf(m[0]);
      errors.push({
        kind: 'banned',
        token: r.name + '(' + m[0] + ')',
        context: content.slice(Math.max(0, idx - 25), idx + m[0].length + 25).replace(/\s+/g, ' ').trim()
      });
    }
  }
  // 2. Bare-abbreviation rule
  for (const r of ABBREV_RULES) {
    const hits = findBareAbbrev(content, r.abbrev, r.expansion);
    for (const h of hits) {
      errors.push({ kind: 'bare-abbrev', token: r.abbrev, context: h.context });
    }
  }
  // 3. Presence checks (FOH v6 doctrine fields).
  errors.push(...auditPresence(content));
  // 4. BEFORE / DURING / AFTER for pre-event surfaces only.
  if (opts.requireBDA) {
    if (!/\bBEFORE\b/.test(content) || !/\bDURING\b/.test(content) || !/\bAFTER\b/.test(content)) {
      errors.push({ kind: 'missing-presence', token: 'BEFORE/DURING/AFTER', context: 'pre-event payload missing BEFORE / DURING / AFTER framework' });
    }
  }
  // 5. Discord embed cap.
  if (content.length > SAFE_CAP) {
    errors.push({ kind: 'over-cap', token: 'safe-cap', context: 'payload ' + content.length + ' chars (cap ' + SAFE_CAP + ')' });
  }
  return { label, ok: errors.length === 0, errors, size: content.length };
}

function header(s) { console.log('\n========== ' + s + ' =========='); }

const NOW = Date.now();

// ── PRE-EVENT FIXTURES ──────────────────────────────────────
const PRE_EVENT_FIXTURES = [
  { label: 'pre-event T-1H · CPI USD',
    event: { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 60 * 60 * 1000, forecast: '3.2%', previous: '3.0%' },
    stage: 60 },
  { label: 'pre-event T-15M · NFP USD',
    event: { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high', scheduled_time: NOW + 15 * 60 * 1000, forecast: '180k', previous: '160k' },
    stage: 15 },
  { label: 'pre-event T-30M · ECB Rate Decision',
    event: { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', scheduled_time: NOW + 30 * 60 * 1000 },
    stage: 30 },
  { label: 'pre-event T-RELEASE · Geopolitical shock',
    event: { title: 'Tariff Announcement (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 1 * 60 * 1000 },
    stage: 1 },
];

// ── RELEASED-EVENT FIXTURES ─────────────────────────────────
const RELEASED_FIXTURES = [
  { label: 'released · CPI USD hot',
    event: { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW - 5*60*1000, actual: '3.5%', forecast: '3.2%', previous: '3.0%' } },
  { label: 'released · NFP USD soft',
    event: { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high', scheduled_time: NOW - 5*60*1000, actual: '90k', forecast: '180k', previous: '160k' } },
];

// ── DAILY-BULLETIN FIXTURES ─────────────────────────────────
const DAILY_FIXTURES = [
  { label: 'daily · quiet day',
    snapshot: { health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' }, events: [] },
    geoCtx: { level: 'low' } },
  { label: 'daily · normal (3 high + 1 med)',
    snapshot: {
      health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' },
      events: [
        { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 3*60*60*1000, forecast: '3.2%' },
        { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high', scheduled_time: NOW + 8*60*60*1000 },
        { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', scheduled_time: NOW + 12*60*60*1000 },
        { title: 'FOMC Press Conference', currency: 'USD', impact: 'medium', scheduled_time: NOW + 5*60*60*1000 }
      ]
    },
    geoCtx: { level: 'moderate' } },
  { label: 'daily · stress (6 high + 2 med)',
    snapshot: {
      health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' },
      events: [
        { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 1*60*60*1000, forecast: '3.2%' },
        { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high', scheduled_time: NOW + 3*60*60*1000 },
        { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', scheduled_time: NOW + 5*60*60*1000 },
        { title: 'BOE Rate Decision', currency: 'GBP', impact: 'high', scheduled_time: NOW + 7*60*60*1000 },
        { title: 'BOJ Policy Decision', currency: 'JPY', impact: 'high', scheduled_time: NOW + 9*60*60*1000 },
        { title: 'Tariff Announcement', currency: 'USD', impact: 'high', scheduled_time: NOW + 11*60*60*1000 },
        { title: 'Fed Chair Speech', currency: 'USD', impact: 'medium', scheduled_time: NOW + 2*60*60*1000 },
        { title: 'BOJ Minutes', currency: 'JPY', impact: 'medium', scheduled_time: NOW + 4*60*60*1000 }
      ]
    },
    geoCtx: { level: 'high' } },
];

let total = 0, fails = 0, maxLen = 0;
const sizes = [];

function runFixture(label, content, opts) {
  total++;
  const result = audit(label, content, opts);
  if (result.size > maxLen) maxLen = result.size;
  sizes.push({ label, size: result.size });
  if (!result.ok) {
    fails++;
    header(label + '  — FAIL (' + result.errors.length + ' issue' + (result.errors.length === 1 ? '' : 's') + ' · ' + result.size + ' chars)');
    for (const e of result.errors) {
      console.error('  - [' + e.kind + '] ' + (e.token || '') + '  ::  …' + (e.context || '') + '…');
    }
  } else {
    const headroom = SAFE_CAP - result.size;
    const flag = headroom < NEAR_CAP_WARN ? ' [near-cap]' : '';
    console.log('[MARKET-INTEL-QA] ' + label + ' — clean (' + result.size + ' chars · headroom ' + headroom + ')' + flag);
  }
}

// Default health envelope — mirrors production LIVE state so QA
// fixtures measure the happy-path cap impact, not the degraded
// transparency-tail surface (that is exercised separately below).
const HEALTH_LIVE = { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' };

for (const f of PRE_EVENT_FIXTURES) {
  const opts = { health: HEALTH_LIVE };
  const p = mi.buildPreEventAlertPayload(f.event, f.stage, opts);
  runFixture(f.label, p && p.content, { requireBDA: true });
}
for (const f of RELEASED_FIXTURES) {
  const opts = { health: HEALTH_LIVE };
  const p = mi.buildReleasedEventAlertPayload(f.event, opts);
  runFixture(f.label, p && p.content, { requireBDA: false });
}

// ── LANE 1 (2026-05-16): historical context + degraded transparency
const HISTORY_CPI = [
  { dateLabel: 'Apr 2026', actual: '3.5%', magnitude: '+0.2%', surpriseDir: 'above',  reaction: 'US Dollar Index supported, gold pressured' },
  { dateLabel: 'Mar 2026', actual: '3.0%', magnitude: '0',     surpriseDir: 'in-line',reaction: 'mixed, no directional persistence' },
  { dateLabel: 'Feb 2026', actual: '3.4%', magnitude: '+0.1%', surpriseDir: 'above',  reaction: 'US Dollar Index supported intraday' },
];
const HEALTH_DEGRADED = { available: false, calendar_mode: 'DEGRADED', source_used: 'TradingEconomics' };

(function laneOneFixtures() {
  // Historical context — pre-event surface with caller-supplied history.
  const histEvent = { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 60 * 60 * 1000, forecast: '3.2%', previous: '3.0%' };
  const histPayload = mi.buildPreEventAlertPayload(histEvent, 60, { health: HEALTH_LIVE, history: HISTORY_CPI });
  total++;
  const histResult = audit('pre-event · CPI USD · with HISTORICAL CONTEXT', histPayload && histPayload.content, { requireBDA: true });
  if (histResult.size > maxLen) maxLen = histResult.size;
  sizes.push({ label: histResult.label, size: histResult.size });
  // Additional presence check — HISTORICAL CONTEXT section must surface.
  if (histResult.ok && !/📅 \*Prior \d:/.test(histPayload.content || '')) {
    histResult.ok = false;
    histResult.errors.push({ kind: 'missing-presence', token: 'HISTORICAL_CONTEXT', context: 'inline 📅 *Prior N:* line absent despite history opts supplied' });
  }
  if (!histResult.ok) {
    fails++;
    header(histResult.label + '  — FAIL (' + histResult.errors.length + ' issue' + (histResult.errors.length === 1 ? '' : 's') + ' · ' + histResult.size + ' chars)');
    for (const e of histResult.errors) console.error('  - [' + e.kind + '] ' + (e.token || '') + '  ::  …' + (e.context || '') + '…');
  } else {
    const headroom = SAFE_CAP - histResult.size;
    const flag = headroom < NEAR_CAP_WARN ? ' [near-cap]' : '';
    console.log('[MARKET-INTEL-QA] ' + histResult.label + ' — clean (' + histResult.size + ' chars · headroom ' + headroom + ')' + flag);
  }

  // Degraded health — pre-event surface must emit the transparency tail.
  const degradedEvent = { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 60 * 60 * 1000, forecast: '3.2%', previous: '3.0%' };
  const degradedPayload = mi.buildPreEventAlertPayload(degradedEvent, 60, { health: HEALTH_DEGRADED });
  total++;
  const degradedResult = audit('pre-event · CPI USD · degraded source transparency', degradedPayload && degradedPayload.content, { requireBDA: true });
  if (degradedResult.size > maxLen) maxLen = degradedResult.size;
  sizes.push({ label: degradedResult.label, size: degradedResult.size });
  if (degradedResult.ok && !/Macro proxies:/.test(degradedPayload.content || '')) {
    degradedResult.ok = false;
    degradedResult.errors.push({ kind: 'missing-presence', token: 'TRANSPARENCY_TAIL', context: 'degraded health did not emit macro-proxy transparency tail' });
  }
  if (!degradedResult.ok) {
    fails++;
    header(degradedResult.label + '  — FAIL (' + degradedResult.errors.length + ' issue' + (degradedResult.errors.length === 1 ? '' : 's') + ' · ' + degradedResult.size + ' chars)');
    for (const e of degradedResult.errors) console.error('  - [' + e.kind + '] ' + (e.token || '') + '  ::  …' + (e.context || '') + '…');
  } else {
    const headroom = SAFE_CAP - degradedResult.size;
    const flag = headroom < NEAR_CAP_WARN ? ' [near-cap]' : '';
    console.log('[MARKET-INTEL-QA] ' + degradedResult.label + ' — clean (' + degradedResult.size + ' chars · headroom ' + headroom + ')' + flag);
  }
})();
for (const f of DAILY_FIXTURES) {
  const p = mi.buildDailyBulletinPayload(f.snapshot, f.geoCtx, NOW);
  runFixture(f.label, p && p.content, { requireBDA: false });
  if (f.label.indexOf('quiet day') >= 0) {
    total++;
    const c = p && p.content || '';
    const ok = /AFFECTED MARKETS — driver-led exposure map/.test(c) && !/No mapped affected markets/.test(c);
    if (!ok) {
      fails++;
      header(f.label + ' driver-led affected map — FAIL');
      console.error('  - [missing-presence] AFFECTED MARKETS driver-led exposure map absent or legacy fallback present');
    } else {
      console.log('[MARKET-INTEL-QA] ' + f.label + ' driver-led affected map — clean');
    }
  }
}

console.log('\n[MARKET-INTEL-QA] size report:');
for (const s of sizes) {
  console.log('  ' + (s.size <= SAFE_CAP ? 'OK ' : 'FAIL') + '  ' + String(s.size).padStart(4, ' ') + '  ' + s.label);
}
console.log('[MARKET-INTEL-QA] max payload size: ' + maxLen + ' chars (cap ' + SAFE_CAP + ')');

if (fails) {
  console.error('\n[MARKET-INTEL-QA] FAIL — ' + fails + '/' + total + ' fixtures had violations.');
  process.exit(1);
}
console.log('\n[MARKET-INTEL-QA] PASS — all ' + total + ' fixtures clean.');
process.exit(0);
