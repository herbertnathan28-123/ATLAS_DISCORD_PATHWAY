#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/staging_dark_horse_weekend_prep.js
//
// STAGING-ONLY visual-proof harness for the Dark Horse Weekend /
// Monday Open Prep Briefing. Mirrors the safety rails of the
// Market Intel and FOH v6 staging harnesses.
//
// HARD SAFETY RAILS
//   - Refuses to run when production env keys are set:
//     WEEKLY_DARKHORSES / DARKHORSE_STOCK / DARK_HORSE_WEEKEND_PREP_WEBHOOK
//     (the production webhook key is intentionally treated as
//     ambient-production to keep staging isolated).
//   - POST mode requires BOTH `--post` AND `--confirm-staging`.
//   - Sources the staging URL from a SEPARATE env var:
//     ATLAS_STAGING_DH_WEEKEND_WEBHOOK
//   - Logs only the SHA-256 prefix of the staging URL.
//   - Dry-run is the default.
//
// Usage
//   # Dry-run (safe, no network):
//   node scripts/staging_dark_horse_weekend_prep.js
//
//   # Real POST to a staging webhook:
//   unset WEEKLY_DARKHORSES
//   unset DARKHORSE_STOCK
//   unset DARK_HORSE_WEEKEND_PREP_WEBHOOK
//   export ATLAS_STAGING_DH_WEEKEND_WEBHOOK="https://discord.com/api/webhooks/<id>/<token>"
//   node scripts/staging_dark_horse_weekend_prep.js --post --confirm-staging
// ============================================================

const crypto = require('crypto');
const path   = require('path');
const dh     = require(path.join(__dirname, '..', 'darkHorseWeekendPrep.js'));

const args = process.argv.slice(2);
const POST_MODE = args.includes('--post');
const CONFIRM   = args.includes('--confirm-staging');
const FULL      = args.includes('--full');

const PROD_KEYS = ['WEEKLY_DARKHORSES', 'DARKHORSE_STOCK', 'DARK_HORSE_WEEKEND_PREP_WEBHOOK'];
const ambientHits = PROD_KEYS.filter(k => process.env[k] && process.env[k].length > 0);
if (ambientHits.length > 0) {
  console.error('[ABORT] Production env keys present in ambient environment:');
  for (const k of ambientHits) console.error('         ' + k + '   (must be unset for staging harness)');
  console.error('Run `unset ' + ambientHits.join(' ') + '` and re-invoke.');
  process.exit(2);
}

if (POST_MODE && !CONFIRM) {
  console.error('[ABORT] --post requires --confirm-staging. Aborting.');
  process.exit(2);
}
if (!POST_MODE && CONFIRM) {
  console.error('[ABORT] --confirm-staging without --post is meaningless. Aborting.');
  process.exit(2);
}

const STAGING_URL = process.env.ATLAS_STAGING_DH_WEEKEND_WEBHOOK || '';
if (POST_MODE) {
  if (!STAGING_URL) {
    console.error('[ABORT] --post requires ATLAS_STAGING_DH_WEEKEND_WEBHOOK env var to be set.');
    process.exit(2);
  }
  if (!/^https:\/\/(canary\.)?discord\.com\/api\/webhooks\//.test(STAGING_URL)) {
    console.error('[ABORT] ATLAS_STAGING_DH_WEEKEND_WEBHOOK must be a Discord webhook URL.');
    process.exit(2);
  }
}

function urlHash(u) {
  if (!u) return '(none)';
  return crypto.createHash('sha256').update(u).digest('hex').slice(0, 12);
}

// ── FIXTURE — representative Monday-open prep scenario ──────
// Saturday 12:00 UTC of a CPI / NFP / ECB week with mid-VIX
// and DXY mild-bid. Exercises every section of the briefing.
const SAT_NOON_UTC = Date.parse('2026-05-16T12:00:00Z');
const fixtureEvents = [
  { title: 'CPI (USD)',           currency: 'USD', impact: 'high', scheduled_time: SAT_NOON_UTC + 3 * 24 * 3600 * 1000, forecast: '3.2%', previous: '3.0%' },
  { title: 'Non Farm Payrolls',   currency: 'USD', impact: 'high', scheduled_time: SAT_NOON_UTC + 4 * 24 * 3600 * 1000, forecast: '180k', previous: '160k' },
  { title: 'ECB Rate Decision',   currency: 'EUR', impact: 'high', scheduled_time: SAT_NOON_UTC + 2 * 24 * 3600 * 1000 },
];
const fixtureLive = {
  dxy: { level: 28.4, bias: 'mild-bid' },
  vix: { level: 18.2 },
  yield_: { regime: 'flat' },
};

// Fixture Friday-survivor candidates for the candidates embed.
// Mirrors the shape `darkHorseEngine.getDHInternalStore()` would
// return (Map values). Internal scores 6–8, structurally valid.
const fixtureCandidates = new Map();
fixtureCandidates.set('NVDA',   { symbol: 'NVDA',   score: 8, direction: 'Bullish' });
fixtureCandidates.set('XAUUSD', { symbol: 'XAUUSD', score: 7, direction: 'Bullish' });
fixtureCandidates.set('EURUSD', { symbol: 'EURUSD', score: 7, direction: 'Bullish' });
fixtureCandidates.set('NAS100', { symbol: 'NAS100', score: 6, direction: 'Bullish' });
fixtureCandidates.set('USDJPY', { symbol: 'USDJPY', score: 6, direction: 'Bearish' });

dh.init({
  darkHorseEngineModule: {
    getDHInternalStore: () => fixtureCandidates,
  },
});

const payload = dh.buildDarkHorseWeekendPrepPayload({
  now: SAT_NOON_UTC,
  upcomingEvents: fixtureEvents,
  liveContext: fixtureLive,
});

// ── Discord-size guard ──────────────────────────────────────
const meas = dh.measurePayload(payload);
if (meas.contentLen > dh.DH_PREP_DISCORD_CONTENT_LIMIT) {
  console.error('[ABORT] Banner content exceeds Discord limit (' + meas.contentLen + ' / ' + dh.DH_PREP_DISCORD_CONTENT_LIMIT + ').');
  process.exit(3);
}
for (let i = 0; i < meas.embedTotals.length; i++) {
  if (meas.embedTotals[i] > dh.DH_PREP_DISCORD_EMBED_TOTAL_LIMIT) {
    console.error('[ABORT] Embed ' + (i + 1) + ' exceeds Discord limit (' + meas.embedTotals[i] + ' / ' + dh.DH_PREP_DISCORD_EMBED_TOTAL_LIMIT + ').');
    process.exit(3);
  }
}

console.log('=== STAGING HARNESS — DARK HORSE WEEKEND PREP ===');
console.log('mode:            ' + (POST_MODE ? 'POST (staging)' : 'DRY-RUN (no network)'));
console.log('staging urlHash: ' + urlHash(STAGING_URL));
console.log('payload.kind:    ' + payload.kind);
console.log('content size:    ' + meas.contentLen + ' / ' + dh.DH_PREP_DISCORD_CONTENT_LIMIT);
console.log('embed sizes:     ' + meas.embedTotals.join(', ') + ' (≤ ' + dh.DH_PREP_DISCORD_EMBED_TOTAL_LIMIT + ' each)');
console.log('');

if (!POST_MODE) {
  console.log('=== WEBHOOK BODY ===');
  if (FULL) {
    console.log(JSON.stringify({ content: payload.content, embeds: payload.embeds }, null, 2));
  } else {
    console.log('-- content (' + payload.content.length + ' chars) --');
    console.log(payload.content);
    console.log('');
    for (let i = 0; i < payload.embeds.length; i++) {
      const e = payload.embeds[i];
      const colorHex = typeof e.color === 'number' ? '0x' + e.color.toString(16) : '(none)';
      console.log('-- embed ' + (i + 1) + ' (color=' + colorHex + ') --');
      if (e.title) console.log('title:       ' + e.title);
      if (e.description) console.log('description: ' + e.description);
      for (const f of (e.fields || [])) {
        console.log('  [' + f.name + ']' + (f.inline ? ' (inline)' : ''));
        console.log('    ' + (f.value || '').replace(/\n/g, '\n    '));
      }
      if (e.footer) console.log('footer:      ' + e.footer.text);
      console.log('');
    }
  }
  console.log('[DRY-RUN] No network calls were made. Re-run with --post --confirm-staging to deliver to the staging webhook.');
  process.exit(0);
}

(async function postOnce() {
  const send = await dh.sendWebhook(STAGING_URL, payload);
  if (send && send.ok) {
    console.log('[POST 1/1] urlHash=' + urlHash(STAGING_URL) + ' status=' + send.status);
    console.log('\n[STAGING RESULT] PASS — Dark Horse Weekend Prep delivered to staging channel (urlHash=' + urlHash(STAGING_URL) + ').');
    process.exit(0);
  }
  console.error('[POST 1/1 FAIL] urlHash=' + urlHash(STAGING_URL) + ' status=' + (send && send.status));
  process.exit(4);
})().catch(e => {
  console.error('[STAGING ERROR] ' + e.message);
  process.exit(5);
});
