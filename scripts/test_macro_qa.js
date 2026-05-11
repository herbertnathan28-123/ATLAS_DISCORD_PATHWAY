#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Macro banned-string QA harness.
 *
 * Builds the macro v3 brief against a set of representative ctx /
 * structure / calendar fixtures and asserts that the rendered output
 * carries NONE of the locked banned terms.
 *
 * Pass scenarios:
 *   - "no_packet"  — no structure, no calendar; the brief should still
 *                    render with operator-facing fallbacks.
 *   - "active"     — full structure with entry/stop/targets present.
 *   - "stand_down" — structure present but Jane verdict BLOCK.
 *   - "event_2h"   — high-impact event inside 2h.
 *
 * Exits 0 when all scenarios pass, 1 when any banned term is detected
 * or any scenario throws.
 */

const path = require('path');
// `./macro` resolves to ./macro.js (the Phase-D Macro Engine) before the
// `macro/` directory. Require the v3 builder by its explicit path.
const macroMod = require(path.join(__dirname, '..', 'macro', 'index.js'));
const buildMacroV3 = macroMod && macroMod.buildMacroV3;
if (typeof buildMacroV3 !== 'function'){
  console.error('[MACRO-QA] FATAL — macro module did not export buildMacroV3.');
  process.exit(2);
}

// Centralised banned fixture from scripts/qa_banned_strings.js (G1).
const sharedFixture = require('./qa_banned_strings');
const BANNED = [
  /\btrigger\b/i,
  /\bauthoris(?:ed|e)\b/i,
  /\bauthoriz(?:ed|e)\b/i,
  /\bpermitted\b/i,
  /\bpermission\b/i,
  /\bblocked\b/i,
  /\bwithheld\b/i,
  /\bno clear edge\b/i,
  /\bprobability low\b/i,
  /\btrade probability\b/i,
  /\btrade range\b/i,
  /\bexecution map\b/i,
  /\bnot implemented\b/i,
  /\bunavailable\b/i,
  /\bincomplete\b/i,
  /\bcorey clone\b/i,
  /(?<![a-z])corey(?![a-z])/i,
  /(?<![a-z])spidey(?![a-z])/i,
  /(?<![a-z])jane(?![a-z])/i,
  // May 2026 hardening additions
  /\[REDACTED-FOMO\]/,
  /\[REDACTED-[A-Z-]*\]/,
  /\[object Object\]/,
  /\bDXY\s*:\s*DXY\b/,
  /\bVIX\s*:\s*VIX\b/,
  /\bDark Horse flag:/,
  /\bHH\/HL\b/,
  /\bUUP proxy\b/i,
  /\bVXX proxy\b/i,
  /\b10Y-2Y\b/,
  /\bdirectionanjhl\b/i,
  // Bare macro-driver abbreviations outside the layman parenthesised form.
  /(?<!\()\bDXY\b(?!\))/,
  /(?<!\()\bVIX\b(?!\))/,
  /(?<!\()\bUS10Y\b(?!\))/,
  /(?<!\()\bUS2Y\b(?!\))/,
  /(?<!\()\bUUP\b(?!\))/,
  /(?<!\()\bVXX\b(?!\))/,
];

const SCENARIOS = {
  no_packet: {
    symbol: 'EURUSD',
    ctx: {
      status: 'live',
      dxy:    { score: 0,    bias: 'Neutral' },
      vix:    { score: 0,    level: 'Calm' },
      yield:  { score: 0,    regime: 'Normal' }
    },
    structure: null,
    calendar: { snapshot: { events: [] }, intel: null },
    fmp: { available: false }
  },
  active: {
    symbol: 'EURUSD',
    ctx: {
      status: 'live',
      dxy:    { score: -0.30, bias: 'Bearish' },
      vix:    { score: -0.10, level: 'Calm' },
      yield:  { score:  0.10, regime: 'Normal' }
    },
    structure: {
      score: 0.45,
      bias: 'bullish',
      conviction: 0.65,
      currentPrice: 1.07820,
      recentHigh:   1.08000,
      recentLow:    1.07550,
      entry:        1.07900,
      entryExtended: 1.07800,
      stopLoss:     1.07550,
      stopLossExtended: 1.07350,
      targets:      [1.08600],
      trend:        'Bullish on the primary timeframe',
      buyerConfirm: 1.07900,
      sellerConfirm: 1.07550,
      confirmTimeframe: '15M',
      flow: 'Buyers gaining control on the primary timeframe',
      validityWindow: 'until London close or first event-window boundary',
      cancellation: ['15M close back below 1.07780 within 2 candles'],
      readiness: 7
    },
    calendar: { snapshot: { events: [] }, intel: null },
    fmp: { available: false }
  },
  stand_down: {
    symbol: 'EURUSD',
    ctx: {
      status: 'live',
      dxy:    { score:  0.40, bias: 'Bullish' },
      vix:    { score:  0.30, level: 'High' },
      yield:  { score: -0.20, regime: 'Inverted' }
    },
    structure: { score: -0.10, bias: 'mixed', conviction: 0.10 },
    calendar: { snapshot: { events: [] }, intel: null },
    fmp: { available: false }
  },
  event_2h: {
    symbol: 'EURUSD',
    ctx: {
      status: 'live',
      dxy:    { score: 0,    bias: 'Neutral' },
      vix:    { score: 0,    level: 'Calm' },
      yield:  { score: 0,    regime: 'Normal' }
    },
    structure: { score: 0.20, bias: 'bullish', conviction: 0.30 },
    calendar: {
      snapshot: { events: [{ scheduled_time: Date.now() + 90 * 60_000, title: 'US NFP', currency: 'USD', impact: 'high' }] },
      intel: 'EVENT — high impact — 1.5h from now'
    },
    fmp: { available: false }
  },
  // May 2026 hardening — Dark Horse signal must NOT leak its engine
  // shorthand into the macro v3 body. Verifies the livePlan.js B5 fix
  // (Dark Horse flag → plain English translation) plus neutral-state
  // collapse (no >1 "Not identified yet" rows).
  dark_horse_active_neutral: {
    symbol: 'EURUSD',
    ctx: {
      status: 'live',
      dxy:    { score: 0,    bias: 'Neutral' },
      vix:    { score: 0,    level: 'Calm' },
      yield:  { score: 0,    regime: 'Normal' }
    },
    structure: null,
    calendar: { snapshot: { events: [] }, intel: null },
    fmp: { available: false },
    darkHorse: { symbol: 'EURUSD', score: 8, direction: 'Bullish', summary: 'Strong bullish structure with HH/HL sequence confirmed' }
  }
};

(async function main(){
  let totalHits = 0;
  for (const [name, fixture] of Object.entries(SCENARIOS)){
    let text;
    try {
      text = await buildMacroV3(fixture);
    } catch (e) {
      console.error('[MACRO-QA] scenario=' + name + ' BUILD ERROR — ' + e.message);
      totalHits++;
      continue;
    }
    const hits = [];
    for (const re of BANNED){
      const m = text.match(re);
      if (m){
        const idx = text.indexOf(m[0]);
        const ctxStart = Math.max(0, idx - 30);
        const ctxEnd   = Math.min(text.length, idx + m[0].length + 30);
        hits.push({ term: m[0], context: text.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim() });
      }
    }
    if (hits.length){
      console.error('[MACRO-QA] scenario=' + name + ' HITS=' + hits.length);
      for (const h of hits.slice(0, 8)){
        console.error('  - "' + h.term + '" :: …' + h.context + '…');
      }
      totalHits += hits.length;
    } else {
      console.log('[MACRO-QA] scenario=' + name + ' clean — ' + text.length + ' chars');
    }

    // Centralised G1 fixture (defence in depth — keeps the source of
    // truth in one place even as the inline BANNED list grows).
    const sharedHits = sharedFixture.scan(text);
    if (sharedHits.length){
      console.error('[MACRO-QA] scenario=' + name + ' SHARED-FIXTURE HITS=' + sharedHits.length);
      for (const h of sharedHits.slice(0, 8)){
        console.error('  - "' + h.match + '" (rule: ' + h.name + ')');
      }
      totalHits += sharedHits.length;
    }

    // Neutral-state collapse — at most one "Not identified yet" row.
    const notIdentifiedCount = (text.match(/Not identified yet/g) || []).length;
    if (notIdentifiedCount > 1){
      console.error('[MACRO-QA] scenario=' + name + ' NEUTRAL-STATE FAIL — found ' + notIdentifiedCount + ' "Not identified yet" rows; expected ≤ 1.');
      totalHits++;
    }
  }
  if (totalHits){
    console.error('[MACRO-QA] FAIL — ' + totalHits + ' total banned-term hits across scenarios.');
    process.exit(1);
  }
  console.log('[MACRO-QA] PASS — every scenario clean.');
})();
