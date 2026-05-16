#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_dh_weekend_prep_qa.js
//
// QA harness for Dark Horse Weekend / Monday Open Prep Briefing.
// Verifies:
//   - No banned tokens (BOS / CHoCH / prints / Trigger Level /
//     Mechanism Chain / Entry Zone / "buy/sell this Monday" /
//     "will go up/drop").
//   - Required narrative structure (event explanation, scenario
//     split, transmission chain labelled MARKET IMPACT, promotion
//     rule, source/confidence note, move-range basis label).
//   - Embed-safe size per Discord limits.
//   - Output never claims execution authority — preparation
//     intelligence only.
// ============================================================

const path = require('path');
const dh   = require(path.join(__dirname, '..', 'darkHorseWeekendPrep.js'));

const BANNED = [
  /\bBOS\b/,
  /\bCHoCH\b/,
  /\bprints\b/,
  /\bTrigger Level\b/i,
  /\bMechanism Chain\b/,
  /\bEntry Zone\b/i,
  /\bbuy this Monday\b/i,
  /\bsell this Monday\b/i,
  /\bwill\s+(?:go\s+up|drop|fall|rise)\b/i,
];

const REQUIRED = [
  // Event-level requirements
  /\bMARKET IMPACT\b/,              // user-facing transmission label
  /Scenario split/i,                // every major event must have a scenario split (no \b — markdown _ wraps trip word boundaries)
  /Promotion rule/i,                // promotion rule mandatory
  /Preparation intelligence only/i, // preparation-only doctrine
  // Structural requirements
  /\bEVENT-EXPOSED WATCHLIST\b/,
  /\bWEEKEND MARKET STATE\b/,
  /\bCOREY MACRO STATE\b/,
  /\bMONDAY CONTINUATION CANDIDATES\b/,
  /\bMONDAY REVERSAL \/ GAP-FADE CANDIDATES\b/,
  /\bHIGH-BETA REOPEN WATCH\b/,
  /\bCONFIRMATION NEEDED AFTER REOPEN\b/,
  /\bWHAT CANCELS THE WATCH\b/,
  /\bFIRST LIVE SCAN WINDOW\b/,
  /\bSOURCE \/ CONFIDENCE NOTE\b/,
  // Basis labelling
  /\bbasis: (scenario estimate|ATR-adjusted|historically sourced|event-class historical|insufficient evidence)\b/,
  // Hedged probability language must appear
  /\b(?:historically tend|favours|expected pressure|Corey leans)\b/i,
];

function flatten(payload) {
  if (!payload) return '';
  const parts = [];
  if (payload.content) parts.push(String(payload.content));
  if (Array.isArray(payload.embeds)) for (const e of payload.embeds) {
    if (!e) continue;
    if (e.title) parts.push(String(e.title));
    if (e.description) parts.push(String(e.description));
    if (Array.isArray(e.fields)) for (const f of e.fields) {
      if (f && f.name) parts.push(String(f.name));
      if (f && f.value) parts.push(String(f.value));
    }
    if (e.footer && e.footer.text) parts.push(String(e.footer.text));
  }
  return parts.join('\n');
}

const SAT_NOON_UTC = Date.parse('2026-05-16T12:00:00Z');
const fixtureEvents = [
  { title: 'CPI (USD)',           currency: 'USD', impact: 'high', scheduled_time: SAT_NOON_UTC + 3 * 24 * 3600 * 1000, forecast: '3.2%', previous: '3.0%' },
  { title: 'Non Farm Payrolls',   currency: 'USD', impact: 'high', scheduled_time: SAT_NOON_UTC + 4 * 24 * 3600 * 1000, forecast: '180k', previous: '160k' },
  { title: 'ECB Rate Decision',   currency: 'EUR', impact: 'high', scheduled_time: SAT_NOON_UTC + 2 * 24 * 3600 * 1000 },
];
const fixtureLive = { dxy: { level: 28.4, bias: 'mild-bid' }, vix: { level: 18.2 }, yield_: { regime: 'flat' } };
const fixtureCandidates = new Map();
fixtureCandidates.set('NVDA',   { symbol: 'NVDA',   score: 8, direction: 'Bullish' });
fixtureCandidates.set('XAUUSD', { symbol: 'XAUUSD', score: 7, direction: 'Bullish' });
fixtureCandidates.set('EURUSD', { symbol: 'EURUSD', score: 7, direction: 'Bullish' });
fixtureCandidates.set('NAS100', { symbol: 'NAS100', score: 6, direction: 'Bullish' });
fixtureCandidates.set('USDJPY', { symbol: 'USDJPY', score: 6, direction: 'Bearish' });

dh.init({
  darkHorseEngineModule: { getDHInternalStore: () => fixtureCandidates },
});

function runFixture(label, opts) {
  const payload = dh.buildDarkHorseWeekendPrepPayload(opts);
  const text = flatten(payload);
  const meas = dh.measurePayload(payload);
  const errs = [];

  for (const re of BANNED) {
    const m = text.match(re);
    if (m) {
      const idx = text.indexOf(m[0]);
      errs.push({ kind: 'banned', token: m[0], context: text.slice(Math.max(0, idx - 30), idx + m[0].length + 30).replace(/\s+/g, ' ').trim() });
    }
  }
  for (const re of REQUIRED) {
    if (!re.test(text)) errs.push({ kind: 'missing-required', token: re.source });
  }

  // Discord size guard
  if (meas.contentLen > dh.DH_PREP_DISCORD_CONTENT_LIMIT) errs.push({ kind: 'oversize-content', token: 'content', context: meas.contentLen + ' > ' + dh.DH_PREP_DISCORD_CONTENT_LIMIT });
  for (let i = 0; i < meas.embedTotals.length; i++) {
    if (meas.embedTotals[i] > dh.DH_PREP_DISCORD_EMBED_TOTAL_LIMIT) errs.push({ kind: 'oversize-embed', token: 'embed-' + (i + 1), context: meas.embedTotals[i] + ' > ' + dh.DH_PREP_DISCORD_EMBED_TOTAL_LIMIT });
  }

  return { label, ok: errs.length === 0, errors: errs, contentLen: meas.contentLen, embedTotals: meas.embedTotals };
}

const fixtures = [
  { label: 'full prep · CPI + NFP + ECB · Saturday noon · live macro', opts: { now: SAT_NOON_UTC, upcomingEvents: fixtureEvents, liveContext: fixtureLive } },
  { label: 'no upcoming events · driver-led tape',                       opts: { now: SAT_NOON_UTC, upcomingEvents: [], liveContext: fixtureLive } },
  { label: 'no live macro · scenario estimate basis only',               opts: { now: SAT_NOON_UTC, upcomingEvents: fixtureEvents, liveContext: null } },
];

let total = 0, fails = 0;
for (const f of fixtures) {
  total++;
  const r = runFixture(f.label, f.opts);
  if (r.ok) {
    console.log('[DH-WEEKEND-QA] ' + r.label + ' — clean (content=' + r.contentLen + ', embeds=' + r.embedTotals.join('/') + ')');
  } else {
    fails++;
    console.error('\n========== ' + r.label + '  — FAIL (' + r.errors.length + ') ==========');
    for (const e of r.errors) {
      console.error('  - [' + e.kind + '] ' + (e.token || '') + (e.context ? '  ::  …' + e.context + '…' : ''));
    }
  }
}

if (fails) {
  console.error('\n[DH-WEEKEND-QA] FAIL — ' + fails + '/' + total + ' fixtures had violations.');
  process.exit(1);
}
console.log('\n[DH-WEEKEND-QA] PASS — all ' + total + ' fixtures clean.');
process.exit(0);
