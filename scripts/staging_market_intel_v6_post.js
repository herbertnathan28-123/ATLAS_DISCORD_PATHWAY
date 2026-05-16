#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/staging_market_intel_v6_post.js
//
// STAGING-ONLY visual-proof harness for Market Intel v6 visual
// shell (PR #100). Builds every user-facing MARKET_INTEL payload
// (pre-event + released-event) against representative fixtures
// and either:
//   - dumps every Discord webhook body to stdout as JSON
//     (dry-run, no network), OR
//   - POSTs each message in order to the staging webhook
//     supplied via the `ATLAS_STAGING_MI_WEBHOOK` env var
//     (requires --post AND --confirm-staging flags).
//
// HARD SAFETY RAILS
//   - Refuses to run when `MARKET_INTEL_WEBHOOK` (production
//     key) is set in the ambient environment. That key would
//     route the production Market Intel channel and is not
//     allowed by this harness under any circumstance.
//   - POST mode requires BOTH `--post` AND `--confirm-staging`
//     on the command line. Either flag alone aborts.
//   - The staging webhook URL is sourced from a DIFFERENT env
//     var (`ATLAS_STAGING_MI_WEBHOOK`) than production, so the
//     harness cannot accidentally inherit production config.
//   - The staging webhook URL is logged only as the SHA-256
//     prefix of its bytes (`urlHash`). The full URL never
//     reaches stdout.
//   - Defaults to dry-run when no flags are supplied.
//
// Usage
//   # 1) Dry-run (safe by default, no network):
//   node scripts/staging_market_intel_v6_post.js
//
//   # 2) Real POST to a staging webhook channel:
//   unset MARKET_INTEL_WEBHOOK
//   export ATLAS_STAGING_MI_WEBHOOK="https://discord.com/api/webhooks/<id>/<token>"
//   node scripts/staging_market_intel_v6_post.js --post --confirm-staging
//
// Output
//   Dry-run: prints `=== WEBHOOK BODY N/K ===` followed by the
//   rendered text faithfully (content + embed surfaces) for
//   each fixture's payload.
//   POST mode: prints `[POST n/k] urlHash=… status=… ok=true`
//   for each fixture; aborts the chain on the first non-ok.
//
// Hard boundary preserved — this script only reads the public
// MI builder + transport helpers. It does not alter the
// engine, scheduler, or any production config.
// ============================================================

const crypto = require('crypto');
const path   = require('path');
const mi     = require(path.join(__dirname, '..', 'coreyMarketIntel.js'));

// ── ARG PARSING ─────────────────────────────────────────────
const args = process.argv.slice(2);
const POST_MODE = args.includes('--post');
const CONFIRM   = args.includes('--confirm-staging');
const FULL      = args.includes('--full');

// ── SAFETY RAIL 1: production env key must be unset ─────────
const PROD_KEYS = ['MARKET_INTEL_WEBHOOK'];
const ambientHits = PROD_KEYS.filter(k => process.env[k] && process.env[k].length > 0);
if (ambientHits.length > 0) {
  console.error('[ABORT] Production env keys present in ambient environment:');
  for (const k of ambientHits) console.error('         ' + k + '   (must be unset for staging harness)');
  console.error('Run `unset ' + ambientHits.join(' ') + '` and re-invoke.');
  process.exit(2);
}

// ── SAFETY RAIL 2: POST mode requires both flags ─────────────
if (POST_MODE && !CONFIRM) {
  console.error('[ABORT] --post requires --confirm-staging. Aborting.');
  process.exit(2);
}
if (!POST_MODE && CONFIRM) {
  console.error('[ABORT] --confirm-staging without --post is meaningless. Aborting.');
  process.exit(2);
}

// ── SAFETY RAIL 3: POST mode requires an explicit staging URL ─
const STAGING_URL = process.env.ATLAS_STAGING_MI_WEBHOOK || '';
if (POST_MODE) {
  if (!STAGING_URL) {
    console.error('[ABORT] --post requires ATLAS_STAGING_MI_WEBHOOK env var to be set.');
    process.exit(2);
  }
  if (!/^https:\/\/(canary\.)?discord\.com\/api\/webhooks\//.test(STAGING_URL)) {
    console.error('[ABORT] ATLAS_STAGING_MI_WEBHOOK must be a Discord webhook URL.');
    process.exit(2);
  }
}

function urlHash(u) {
  if (!u) return '(none)';
  return crypto.createHash('sha256').update(u).digest('hex').slice(0, 12);
}

// ── FIXTURES — representative MI events ─────────────────────
// Covers high-impact categories (inflation, labour, central-bank,
// geopolitical) for both pre-event and released-event paths,
// matching the fixture set in `scripts/test_market_intel_qa.js`.
const NOW = Date.now();
const PRE_EVENT_FIXTURES = [
  { label: 'pre-event T-1H · CPI USD',
    event: { title: 'CPI (USD)', currency: 'USD', impact: 'high',
             scheduled_time: NOW + 60 * 60 * 1000,
             forecast: '3.2%', previous: '3.0%' },
    stage: 60 },
  { label: 'pre-event T-15M · NFP USD',
    event: { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high',
             scheduled_time: NOW + 15 * 60 * 1000,
             forecast: '180k', previous: '160k' },
    stage: 15 },
  { label: 'pre-event T-30M · ECB Rate Decision',
    event: { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high',
             scheduled_time: NOW + 30 * 60 * 1000 },
    stage: 30 },
  { label: 'pre-event T-RELEASE · Geopolitical shock',
    event: { title: 'Tariff Announcement (USD)', currency: 'USD', impact: 'high',
             scheduled_time: NOW + 1 * 60 * 1000 },
    stage: 1 }
];
const RELEASED_FIXTURES = [
  { label: 'released · CPI USD hot',
    event: { title: 'CPI (USD)', currency: 'USD', impact: 'high',
             scheduled_time: NOW - 5 * 60 * 1000,
             actual: '3.5%', forecast: '3.2%', previous: '3.0%' } },
  { label: 'released · NFP USD soft',
    event: { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high',
             scheduled_time: NOW - 5 * 60 * 1000,
             actual: '90k', forecast: '180k', previous: '160k' } }
];

function buildFixture(f) {
  if (f.stage !== undefined) return mi.buildPreEventAlertPayload(f.event, f.stage);
  return mi.buildReleasedEventAlertPayload(f.event);
}

(async function main() {
  const payloads = [];
  for (const f of PRE_EVENT_FIXTURES) payloads.push({ label: f.label, payload: buildFixture(f) });
  for (const f of RELEASED_FIXTURES)  payloads.push({ label: f.label, payload: buildFixture(f) });

  // ── Discord-size guard (mirrors coreyMarketIntel.dispatch validation) ─
  let oversize = -1;
  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i].payload || {};
    const contentLen = (p.content || '').length;
    if (contentLen > 2000) { oversize = i; break; }
    const embeds = Array.isArray(p.embeds) ? p.embeds : [];
    let embedTotal = 0;
    for (const e of embeds) {
      if (e.title) embedTotal += String(e.title).length;
      if (e.description) embedTotal += String(e.description).length;
      if (Array.isArray(e.fields)) for (const f of e.fields) {
        if (f && f.name) embedTotal += String(f.name).length;
        if (f && f.value) embedTotal += String(f.value).length;
      }
      if (e.footer && e.footer.text) embedTotal += String(e.footer.text).length;
    }
    if (embedTotal > 6000) { oversize = i; break; }
  }
  if (oversize >= 0) {
    console.error('[ABORT] Fixture ' + (oversize + 1) + ' exceeds Discord limits — dispatcher would refuse to send. Aborting.');
    process.exit(3);
  }

  console.log('=== STAGING HARNESS — MARKET INTEL FOH v6 ===');
  console.log('mode:            ' + (POST_MODE ? 'POST (staging)' : 'DRY-RUN (no network)'));
  console.log('staging urlHash: ' + urlHash(STAGING_URL));
  console.log('fixtures built:  ' + payloads.length);
  console.log('');

  // ── Per-fixture size report ────────────────────────────────
  console.log('size report:');
  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i].payload || {};
    const contentLen = (p.content || '').length;
    const embeds = Array.isArray(p.embeds) ? p.embeds : [];
    const embedTotals = embeds.map(e => {
      let t = 0;
      if (e.title) t += String(e.title).length;
      if (e.description) t += String(e.description).length;
      if (Array.isArray(e.fields)) for (const f of e.fields) {
        if (f && f.name) t += String(f.name).length;
        if (f && f.value) t += String(f.value).length;
      }
      if (e.footer && e.footer.text) t += String(e.footer.text).length;
      return t;
    });
    console.log('  F' + (i + 1) + ' [' + payloads[i].label + ']:  content=' + contentLen + ' / 2000   embeds=' + (embedTotals.join(', ') || '(none)') + ' (≤ 6000 each)');
  }
  console.log('');

  // ── DRY-RUN: print every webhook body ───────────────────────
  if (!POST_MODE) {
    for (let i = 0; i < payloads.length; i++) {
      const p = payloads[i].payload || {};
      const body = { content: p.content || '' };
      if (Array.isArray(p.embeds) && p.embeds.length) body.embeds = p.embeds;
      console.log('=== WEBHOOK BODY ' + (i + 1) + ' / ' + payloads.length + ' — ' + payloads[i].label + ' ===');
      if (FULL) {
        console.log(JSON.stringify(body, null, 2));
      } else {
        if (body.content) {
          console.log('-- content (' + body.content.length + ' chars) --');
          console.log(body.content);
        }
        if (body.embeds) {
          for (let j = 0; j < body.embeds.length; j++) {
            const e = body.embeds[j];
            const colorHex = typeof e.color === 'number' ? '0x' + e.color.toString(16) : '(none)';
            console.log('-- embed ' + (j + 1) + ' (color=' + colorHex + ') --');
            if (e.title) console.log('title:       ' + e.title);
            if (e.description) console.log('description: ' + e.description);
            for (const f of (e.fields || [])) {
              console.log('  [' + f.name + ']' + (f.inline ? ' (inline)' : ''));
              console.log('    ' + (f.value || '').replace(/\n/g, '\n    '));
            }
            if (e.footer) console.log('footer:      ' + e.footer.text);
          }
        }
      }
      console.log('');
    }
    console.log('[DRY-RUN] No network calls were made. Re-run with --post --confirm-staging to deliver to the staging webhook.');
    process.exit(0);
  }

  // ── POST mode — sequential delivery via MI helper ───────────
  // Reuses the same `sendWebhook` helper the production scheduler
  // uses, so transport behaviour (timeout, redaction) is
  // identical to the live path.
  let aborted = false, failedAt = -1;
  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i].payload || {};
    const body = { content: p.content || '' };
    if (Array.isArray(p.embeds) && p.embeds.length) body.embeds = p.embeds;
    const partLabel = (i + 1) + '/' + payloads.length;
    try {
      const res = await mi.sendWebhook(STAGING_URL, body);
      const ok = res && (res.ok === true || (res.status >= 200 && res.status < 300));
      if (ok) {
        console.log('[POST ' + partLabel + '] urlHash=' + urlHash(STAGING_URL) + ' status=' + (res.status || 'n/a') + ' label="' + payloads[i].label + '"');
      } else {
        failedAt = i; aborted = true;
        console.error('[POST ' + partLabel + ' FAIL] urlHash=' + urlHash(STAGING_URL) + ' status=' + (res && res.status) + ' label="' + payloads[i].label + '"');
        break;
      }
    } catch (e) {
      failedAt = i; aborted = true;
      console.error('[POST ' + partLabel + ' ERROR] ' + e.message);
      break;
    }
  }
  if (aborted) {
    console.error('\n[STAGING RESULT] FAIL — chain aborted at fixture ' + (failedAt + 1) + '/' + payloads.length + '. Staging channel may show a partial batch. Investigate before retry.');
    process.exit(4);
  }
  console.log('\n[STAGING RESULT] PASS — all ' + payloads.length + ' fixtures delivered to staging channel (urlHash=' + urlHash(STAGING_URL) + '). Capture screenshots and verify against the v6 visual checklist.');
})().catch(e => {
  console.error('[STAGING ERROR] ' + e.message);
  process.exit(5);
});
