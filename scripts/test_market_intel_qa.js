#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * MARKET_INTEL presentation QA.
 *
 * Builds every user-facing MARKET_INTEL payload (pre-event alert,
 * released-event alert, daily bulletin) against representative
 * fixtures and asserts the rendered text passes every locked locked
 * dashboard/macro wording rule PLUS the May 2026 MARKET_INTEL
 * presentation rules:
 *   - No bare DXY / VIX / US10Y / US2Y on the user surface — they
 *     must appear as the expanded label first, abbreviation in
 *     brackets ("US Dollar Index (DXY)" etc.).
 *   - No "DXY: DXY" redundant bucket rows.
 *   - No "[REDACTED-FOMO]" markers (FOMO sanitiser inserts this when
 *     a banned phrase is removed; coreyMarketIntel must scrub before
 *     emitting to Discord).
 *   - No "liquidity sweep + 5m/15m candle-close confirmation" — must
 *     be the plain-English version.
 *
 * Wired as `npm run qa:market-intel`.
 */

const path = require('path');
const mi   = require(path.join(__dirname, '..', 'coreyMarketIntel.js'));

// Banned tokens / patterns that must not appear in the rendered output.
// "Bare DXY/VIX/US10Y/US2Y" detection: any occurrence that is NOT
// immediately preceded by its expanded form ("US Dollar Index ("
// before "DXY)") and NOT inside the expansion itself (e.g. "(DXY)").
function findBareAbbrev(text, abbrev, expandedPrefix) {
  // Token-boundary occurrences of the abbreviation that are NOT part of
  // the expansion "<expandedPrefix>(ABBR)". We look at each match and
  // check the 30 chars of context before it.
  const re = new RegExp('\\b' + abbrev + '\\b', 'g');
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    // Allowed: "<expandedPrefix>(" immediately precedes (e.g.
    // "US Dollar Index (" before "DXY)"). The closing paren must
    // also follow the abbrev for it to be the expansion form.
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

const FIXED_BANNED = [
  /\[REDACTED-FOMO\]/i,
  /\bliquidity sweep \+ 5m\/15m candle-close confirmation\b/i,
  /\bCorey read\b/,                        // legacy heading; replaced by "Market read"
  /\bDXY:\s*DXY\b/i,                       // the headline regression Nathan caught
  /\bVIX:\s*VIX\b/i,
  // Narrative-correction regression guards (Lane A, May 2026):
  /\bMechanism Chain\b/,                   // user-facing label is "Market Impact"; internal sym may stay
  /\bBOS\b/,                               // structural break translates to user-friendly form, never raw "BOS"
  /\bCHoCH\b/,                             // change-of-character translates to user-friendly form
  /\bprints\b/,                            // banned verb per operator brief; use "readings" / "released"
  /\bTrigger Level\b/i,                    // banned phrase; use "confirmation" / "structure-break"
  /\bwill\s+(?:go\s+up|drop|fall|rise)\b/i // certainty language; use "expected pressure" / "favours"
];

// Structural required-token check: every Market Intel surface must
// carry the narrative-spine markers + provenance + probability basis.
const STRUCTURAL_REQUIRED = [
  /\bMARKET IMPACT\b/,
  /\bCROSS-ASSET CONSEQUENCES\b/,
  /\bOPERATOR GUIDANCE\b/,
  /\bBRIEFING SUMMARY\b/,
  /\bSource:\s/,
  /\bProbability basis:\s/
];

const ABBREV_RULES = [
  { abbrev: 'DXY',   expansion: 'US Dollar Index ' },
  { abbrev: 'VIX',   expansion: 'CBOE Volatility Index ' },
  { abbrev: 'US10Y', expansion: 'US 10-Year Treasury Yield ' },
  { abbrev: 'US2Y',  expansion: 'US 2-Year Treasury Yield ' }
];

// Walk a payload and concatenate every user-visible string surface.
// Handles both legacy content-only payloads and the v6 visual-shell
// shape `{ content, embeds: [{ title, description, fields: [{name,value}], footer }] }`.
function _miFlattenPayload(payload) {
  if (!payload) return '';
  const parts = [];
  if (typeof payload.content === 'string') parts.push(payload.content);
  if (Array.isArray(payload.embeds)) {
    for (const e of payload.embeds) {
      if (!e) continue;
      if (e.title) parts.push(String(e.title));
      if (e.description) parts.push(String(e.description));
      if (Array.isArray(e.fields)) {
        for (const f of e.fields) {
          if (f && f.name)  parts.push(String(f.name));
          if (f && f.value) parts.push(String(f.value));
        }
      }
      if (e.footer && e.footer.text) parts.push(String(e.footer.text));
    }
  }
  return parts.join('\n');
}

function audit(label, payload) {
  const content = _miFlattenPayload(payload);
  if (!content) {
    return { label, ok: false, errors: ['empty content'], chars: 0 };
  }
  const errors = [];
  for (const re of FIXED_BANNED) {
    const m = content.match(re);
    if (m) {
      const idx = content.indexOf(m[0]);
      errors.push({
        kind: 'banned',
        token: m[0],
        context: content.slice(Math.max(0, idx - 25), idx + m[0].length + 25).replace(/\s+/g, ' ').trim()
      });
    }
  }
  for (const r of ABBREV_RULES) {
    const hits = findBareAbbrev(content, r.abbrev, r.expansion);
    for (const h of hits) {
      errors.push({ kind: 'bare-abbrev', token: r.abbrev, context: h.context });
    }
  }
  for (const re of STRUCTURAL_REQUIRED) {
    if (!re.test(content)) {
      errors.push({ kind: 'missing-required', token: re.source, context: '(structural marker absent from rendered output)' });
    }
  }
  // Discord-limit guard — 2000 chars content, 6000 chars per embed total.
  const contentLen = typeof payload.content === 'string' ? payload.content.length : 0;
  if (contentLen > 2000) {
    errors.push({ kind: 'oversize-content', token: 'content', context: contentLen + ' > 2000' });
  }
  if (Array.isArray(payload.embeds)) {
    for (let i = 0; i < payload.embeds.length; i++) {
      const e = payload.embeds[i];
      let t = 0;
      if (e.title) t += String(e.title).length;
      if (e.description) t += String(e.description).length;
      if (Array.isArray(e.fields)) for (const f of e.fields) {
        if (f && f.name) t += String(f.name).length;
        if (f && f.value) t += String(f.value).length;
      }
      if (e.footer && e.footer.text) t += String(e.footer.text).length;
      if (t > 6000) errors.push({ kind: 'oversize-embed', token: 'embed-' + (i + 1), context: t + ' > 6000' });
    }
  }
  return { label, ok: errors.length === 0, errors, chars: content.length };
}

function header(s) { console.log('\n========== ' + s + ' =========='); }

// Fixtures — representative events covering the high-impact categories
// (inflation, labour, central-bank, geopolitical).
const NOW = Date.now();
const FIXTURES = [
  {
    label: 'pre-event T-1H · CPI USD',
    event: { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 60 * 60 * 1000, forecast: '3.2%', previous: '3.0%' },
    stage: 60
  },
  {
    label: 'pre-event T-15M · NFP USD',
    event: { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high', scheduled_time: NOW + 15 * 60 * 1000, forecast: '180k', previous: '160k' },
    stage: 15
  },
  {
    label: 'pre-event T-30M · ECB Rate Decision',
    event: { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', scheduled_time: NOW + 30 * 60 * 1000 },
    stage: 30
  },
  {
    label: 'pre-event T-RELEASE · Geopolitical shock',
    event: { title: 'Tariff Announcement (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 1 * 60 * 1000 },
    stage: 1
  }
];

let total = 0, fails = 0;
for (const f of FIXTURES) {
  const payload = mi.buildPreEventAlertPayload(f.event, f.stage);
  const result = audit(f.label, payload);
  total++;
  if (!result.ok) {
    fails++;
    header(result.label + '  — FAIL (' + result.errors.length + ')');
    for (const e of result.errors) {
      console.error('  - [' + e.kind + '] ' + (e.token || '') + '  ::  …' + (e.context || '') + '…');
    }
  } else {
    console.log('[MARKET-INTEL-QA] ' + result.label + ' — clean (' + result.chars + ' chars across content+embed)');
  }
}

// Released-event scenarios — exercise the post-release path too.
const RELEASED = [
  { label: 'released · CPI USD hot', event: { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW - 5*60*1000, actual: '3.5%', forecast: '3.2%', previous: '3.0%' } },
  { label: 'released · NFP USD soft', event: { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high', scheduled_time: NOW - 5*60*1000, actual: '90k', forecast: '180k', previous: '160k' } }
];
for (const f of RELEASED) {
  const payload = (typeof mi.buildReleasedEventAlertPayload === 'function')
    ? mi.buildReleasedEventAlertPayload(f.event)
    : null;
  if (!payload) {
    console.log('[MARKET-INTEL-QA] ' + f.label + ' — skipped (buildReleasedEventAlertPayload not exported)');
    continue;
  }
  const result = audit(f.label, payload);
  total++;
  if (!result.ok) {
    fails++;
    header(result.label + '  — FAIL (' + result.errors.length + ')');
    for (const e of result.errors) {
      console.error('  - [' + e.kind + '] ' + (e.token || '') + '  ::  …' + (e.context || '') + '…');
    }
  } else {
    console.log('[MARKET-INTEL-QA] ' + result.label + ' — clean (' + result.chars + ' chars across content+embed)');
  }
}

if (fails) {
  console.error('\n[MARKET-INTEL-QA] FAIL — ' + fails + '/' + total + ' fixtures had violations.');
  process.exit(1);
}
console.log('\n[MARKET-INTEL-QA] PASS — all ' + total + ' fixtures clean.');
process.exit(0);
