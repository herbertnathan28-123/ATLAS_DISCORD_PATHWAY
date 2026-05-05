#!/usr/bin/env node
'use strict';
// ============================================================
// ATLAS FX — DARK HORSE WEBHOOK PROBE
// One-shot diagnostic. Does NOT depend on the bot client,
// the messageCreate handler, the scheduler, or live volatility.
// Reads DARKHORSE_STOCK from env, builds a clearly-marked
// PROBE payload through the same FOMO sanitiser used by the
// live engine, POSTs once, and prints the HTTP outcome.
//
// Usage (from the Render shell on the bot service):
//   node scripts/dh_webhook_probe.js
// ============================================================

const https = require('https');
const path  = require('path');

const fomo = require(path.resolve(__dirname, '..', 'darkHorseFomoControl'));

const URL_VAL = process.env.DARKHORSE_STOCK || null;

if (!URL_VAL) {
  console.error('[DH-PROBE] reason=DARKHORSE_STOCK_missing');
  console.error('[DH-PROBE] outcome=cannot_post');
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(URL_VAL);
} catch (e) {
  console.error(`[DH-PROBE] reason=DARKHORSE_STOCK_unparseable detail="${e.message}"`);
  console.error('[DH-PROBE] outcome=cannot_post');
  process.exit(3);
}

if (!/^discord(?:app)?\.com$/i.test(parsed.hostname) || !/\/api\/webhooks\//.test(parsed.pathname)) {
  console.error(`[DH-PROBE] reason=DARKHORSE_STOCK_not_a_discord_webhook host=${parsed.hostname} path=${parsed.pathname}`);
  console.error('[DH-PROBE] outcome=cannot_post');
  process.exit(4);
}

const probePayload = fomo.sanitize({
  content:
    '🐎 **DARK HORSE — WEBHOOK PROBE**\n\n' +
    'This is a one-shot diagnostic post. Not a market signal.\n' +
    'Purpose: confirm DARKHORSE_STOCK webhook routing and channel binding.\n' +
    'No movement, no candidate, no entry implied.\n\n' +
    'Full ATLAS confirmation path remains: Corey → Spidey → Jane.\n' +
    `Probe ID: ${new Date().toISOString()}`,
});

const body = JSON.stringify({ content: probePayload.content });
const opts = {
  hostname: parsed.hostname,
  path:     parsed.pathname + parsed.search,
  method:   'POST',
  headers:  {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent':     'ATLAS-FX-DarkHorse-Probe/0.1',
  },
  timeout:  10000,
};

const req = https.request(opts, (res) => {
  let data = '';
  res.on('data', (c) => { data += c; });
  res.on('end', () => {
    const status = res.statusCode;
    if (status >= 200 && status < 300) {
      console.log(`[DH-PROBE] status=${status} outcome=delivered_to_webhook`);
      console.log(`[DH-PROBE] note=visible in channel bound to DARKHORSE_STOCK`);
      process.exit(0);
    }
    if (status === 401 || status === 403) {
      console.error(`[DH-PROBE] status=${status} outcome=webhook_rejected reason=auth_or_revoked body=${data.slice(0, 300)}`);
      process.exit(5);
    }
    if (status === 404) {
      console.error(`[DH-PROBE] status=${status} outcome=webhook_rejected reason=webhook_not_found_or_deleted body=${data.slice(0, 300)}`);
      process.exit(6);
    }
    if (status === 429) {
      console.error(`[DH-PROBE] status=${status} outcome=webhook_rejected reason=rate_limited body=${data.slice(0, 300)}`);
      process.exit(7);
    }
    console.error(`[DH-PROBE] status=${status} outcome=webhook_rejected reason=unexpected_status body=${data.slice(0, 300)}`);
    process.exit(8);
  });
});
req.on('error',   (e) => { console.error(`[DH-PROBE] outcome=network_error reason="${e.message}"`); process.exit(9); });
req.on('timeout', ()  => { console.error('[DH-PROBE] outcome=network_error reason=timeout'); process.exit(10); });
req.write(body);
req.end();
