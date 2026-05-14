#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/staging_dh_foh_v6_post.js
//
// STAGING-ONLY visual-proof harness for Dark Horse FOH v6.
// Builds the canonical 3-candidate live-path payload via
// `darkHorseFoh.buildDarkHorseFohPayload` and either:
//   - dumps every Discord webhook body to stdout as JSON
//     (dry-run, no network), OR
//   - POSTs each message in order to the staging webhook
//     supplied via the `ATLAS_STAGING_WEBHOOK` env var
//     (requires --post AND --confirm-staging flags).
//
// HARD SAFETY RAILS
//   - Refuses to run when `WEEKLY_DARKHORSES` (production
//     preferred key) or `DARKHORSE_STOCK` (legacy production
//     key) is set in the ambient environment. Either key
//     would route the production Dark Horse channel and is
//     not allowed by this harness under any circumstance.
//   - POST mode requires BOTH `--post` AND `--confirm-staging`
//     on the command line. Either flag alone aborts.
//   - The staging webhook URL is logged only as the SHA-256
//     prefix of its bytes (`urlHash`). The full URL never
//     reaches stdout.
//   - Defaults to dry-run when no flags are supplied.
//
// Usage
//   # 1) Dry-run (safe by default, no network):
//   node scripts/staging_dh_foh_v6_post.js
//
//   # 2) Real POST to a staging webhook channel:
//   export ATLAS_STAGING_WEBHOOK="https://discord.com/api/webhooks/<id>/<token>"
//   unset WEEKLY_DARKHORSES
//   unset DARKHORSE_STOCK
//   node scripts/staging_dh_foh_v6_post.js --post --confirm-staging
//
// Output
//   Dry-run: prints `=== MESSAGE N/K ===` followed by the JSON
//   webhook body for each of the 6 messages.
//   POST mode: prints `[POST n/k] urlHash=… status=… ok=true`
//   for each message; aborts the chain on the first non-ok.
//
// Hard boundary preserved — this script only reads the public
// FOH builder + transport helpers. It does not alter the
// engine, ranking, scheduler, or any production config.
// ============================================================

const crypto = require('crypto');
const path   = require('path');
const rank   = require(path.join(__dirname, '..', 'darkHorseRanking.js'));
const foh    = require(path.join(__dirname, '..', 'darkHorseFoh.js'));

// ── ARG PARSING ─────────────────────────────────────────────
const args = process.argv.slice(2);
const POST_MODE = args.includes('--post');
const CONFIRM   = args.includes('--confirm-staging');
const FULL      = args.includes('--full');

// ── SAFETY RAIL 1: ambient production env keys must be unset ─
const PROD_KEYS = ['WEEKLY_DARKHORSES', 'DARKHORSE_STOCK'];
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
const STAGING_URL = process.env.ATLAS_STAGING_WEBHOOK || '';
if (POST_MODE) {
  if (!STAGING_URL) {
    console.error('[ABORT] --post requires ATLAS_STAGING_WEBHOOK env var to be set.');
    process.exit(2);
  }
  if (!/^https:\/\/(canary\.)?discord\.com\/api\/webhooks\//.test(STAGING_URL)) {
    console.error('[ABORT] ATLAS_STAGING_WEBHOOK must be a Discord webhook URL.');
    process.exit(2);
  }
}

function urlHash(u) {
  if (!u) return '(none)';
  return crypto.createHash('sha256').update(u).digest('hex').slice(0, 12);
}

// ── FIXTURE — canonical 3-candidate (FRESH / STILL ACTIVE / FADING) ─
// Matches the v6 prototype's symbol trio (EURUSD / XAUUSD / NVDA)
// so the staging output diffs visibly against `dh-foh-v6.pdf`.
function dailyCandles(n, base) {
  const out = []; let p = base;
  const t = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
  for (let i = 0; i < n; i++) {
    const o = p, c = p + 0.6, h = c + 0.4, l = o - 0.3;
    out.push({ open: o, high: h, low: l, close: c, time: t + i * 86400 });
    p = c;
  }
  return out;
}
function mk(sym, score, dir, sec, base, phase) {
  const e = rank.enrichCandidate(
    { symbol: sym, score, direction: dir, summary: 'higher highs and higher lows', reasons: ['structure 2/2', 'momentum 1/2'] },
    dailyCandles(25, base), 6, { watchThreshold: 8 }
  );
  e.section = sec;
  e.sectionLabel = rank.SECTION_LABEL[sec];
  if (phase) e.movePhase = phase;
  return e;
}
const top10 = [
  mk('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,    1.10,  'early'),
  mk('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES,  2400,  'mid'),
  mk('NVDA',   7, 'Bullish', rank.SECTIONS.EQUITIES,     900,   'late'),
];
const payload = foh.buildDarkHorseFohPayload(
  { top10, allCount: 33 },
  { level: 'elevated' },
  { now: Date.parse('2026-05-13T12:00:00Z') }
);

// Sanitiser walk (identity for staging — proves the walker preserves shape).
const sanitised = foh.sanitiseFohMessages(payload.messages, ({ content }) => ({ content, replaced: false }));
const messages = sanitised.messages;

// Discord-size oversize guard (mirrors `darkHorseEngine.js:1389-1394`).
let oversize = -1;
for (let i = 0; i < messages.length; i++) {
  const meas = foh.measureMessage(messages[i]);
  if (meas.contentLen > foh.DISCORD_CONTENT_LIMIT) { oversize = i; break; }
  if (meas.embedTotals.some(t => t > foh.DISCORD_EMBED_TOTAL_LIMIT)) { oversize = i; break; }
}
if (oversize >= 0) {
  console.error('[ABORT] Message ' + (oversize + 1) + ' exceeds Discord limits — engine would refuse to send. Aborting.');
  process.exit(3);
}

console.log('=== STAGING HARNESS — DARK HORSE FOH v6 ===');
console.log('mode:            ' + (POST_MODE ? 'POST (staging)' : 'DRY-RUN (no network)'));
console.log('staging urlHash: ' + urlHash(STAGING_URL));
console.log('messages built:  ' + messages.length);
console.log('candidateCount:  ' + payload.candidateCount);
console.log('payload.kind:    ' + payload.kind);
console.log('');

// ── Per-message size report ─────────────────────────────────
console.log('size report:');
for (let i = 0; i < messages.length; i++) {
  const meas = foh.measureMessage(messages[i]);
  console.log('  M' + (i + 1) + ':  content=' + meas.contentLen + ' / 2000   embeds=' + (meas.embedTotals.join(', ') || '(none)') + ' (≤ 6000 each)');
}
console.log('');

// ── DRY-RUN: print every webhook body ────────────────────────
if (!POST_MODE) {
  for (let i = 0; i < messages.length; i++) {
    const body = { content: messages[i].content || '' };
    if (Array.isArray(messages[i].embeds) && messages[i].embeds.length) body.embeds = messages[i].embeds;
    console.log('=== WEBHOOK BODY ' + (i + 1) + ' / ' + messages.length + ' ===');
    if (FULL) {
      console.log(JSON.stringify(body, null, 2));
    } else {
      // Default: show the rendered text faithfully (what Discord
      // receives), without the raw JSON envelope noise.
      if (body.content) {
        console.log('-- content (' + body.content.length + ' chars) --');
        console.log(body.content);
      }
      if (body.embeds) {
        for (let j = 0; j < body.embeds.length; j++) {
          const e = body.embeds[j];
          console.log('-- embed ' + (j + 1) + ' (color=0x' + e.color.toString(16) + ') --');
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

// ── POST mode — sequential delivery via engine helper ────────
// Reuses the same `dhSendWebhook` helper the production engine
// uses, so transport behaviour (timeout, retry, redaction) is
// identical to the live path.
const engine = require(path.join(__dirname, '..', 'darkHorseEngine.js'));

(async function postChain() {
  let aborted = false, failedAt = -1;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const body = { content: m.content || '' };
    if (Array.isArray(m.embeds) && m.embeds.length) body.embeds = m.embeds;
    const partLabel = (i + 1) + '/' + messages.length;
    const send = await engine.dhSendWebhook(STAGING_URL, body, { wait: true });
    if (send && send.ok) {
      console.log('[POST ' + partLabel + '] urlHash=' + urlHash(STAGING_URL) + ' status=' + send.status + ' bodyLen=' + send.bodyLen + ' durationMs=' + send.durationMs + ' discord_msg_id=' + (send.messageId || 'n/a'));
    } else {
      failedAt = i; aborted = true;
      console.error('[POST ' + partLabel + ' FAIL] urlHash=' + urlHash(STAGING_URL) + ' ' + engine._dhExcerptResponse(send));
      break;
    }
  }
  if (aborted) {
    console.error('\n[STAGING RESULT] FAIL — chain aborted at message ' + (failedAt + 1) + '/' + messages.length + '. Staging channel may show a partial digest. Investigate before retry.');
    process.exit(4);
  }
  console.log('\n[STAGING RESULT] PASS — all ' + messages.length + ' messages delivered to staging channel (urlHash=' + urlHash(STAGING_URL) + '). Capture screenshots and compare against docs/screenshots/dh-foh-v6.pdf.');
})().catch(e => {
  console.error('[STAGING ERROR] ' + e.message);
  process.exit(5);
});
