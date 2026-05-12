#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Dark Horse delivery-verification QA.
 *
 * Pure unit test — no real network, no real Discord. Stubs
 * https.request to simulate the four states the Discord webhook
 * endpoint can return for a movement_digest_v1_1 / watch send:
 *
 *   1. 200 + JSON body with {"id":"…"}   — success WITH message ID
 *   2. 204 No Content                    — success without ID
 *      (only path when wait=true is NOT used)
 *   3. 400 + JSON body with discord error  — payload rejected
 *      (the live regression — payload > 2000 chars)
 *   4. 401 + JSON body                   — webhook invalidated
 *
 * Asserts:
 *   - dhSendWebhook resolves the structured { ok, status, body,
 *     bodyLen, messageId, durationMs } shape
 *   - ok=true only on 2xx
 *   - messageId is parsed out of a 200 JSON body but null on 204
 *   - opts.wait=true correctly appends &wait=true / ?wait=true
 *   - _dhRedactWebhook scrubs full Discord webhook URLs + bare
 *     "/webhooks/<id>/<token>" path fragments to placeholder text
 *   - _dhExcerptResponse compresses 400/401 Discord error bodies
 *     to status= + discord_code= + discord_msg= fields, never
 *     reproducing the webhook URL
 *
 * Wired as `npm run qa:dh-delivery`.
 */

const Module = require('module');
const path = require('path');
const EventEmitter = require('events');

// ── https stub ──────────────────────────────────────────────────
// Each test sets _stubResponse before calling dhSendWebhook. The
// stub records every request seen so we can assert on the path
// (i.e. that wait=true was appended). The recorded paths NEVER
// include the token — only path + search query.
let _stubResponse = null;
let _recordedRequests = [];

function makeFakeResponse(status, body) {
  const res = new EventEmitter();
  res.statusCode = status;
  setImmediate(() => {
    if (body) res.emit('data', Buffer.from(body, 'utf8'));
    res.emit('end');
  });
  return res;
}

const httpsStub = {
  request: function (opts, cb) {
    _recordedRequests.push({ hostname: opts.hostname, path: opts.path, method: opts.method });
    const req = new EventEmitter();
    req.write = function () {};
    req.end   = function () {
      const r = _stubResponse || { status: 200, body: '{"id":"123"}' };
      cb(makeFakeResponse(r.status, r.body));
    };
    req.destroy = function () {};
    return req;
  }
};

// Hook require so darkHorseEngine pulls the stubbed https module
// before it ever touches the network.
const realRequire = Module.prototype.require;
Module.prototype.require = function (req) {
  if (req === 'https') return httpsStub;
  return realRequire.call(this, req);
};

// Load engine after stub is in place.
const dh = require(path.join(__dirname, '..', 'darkHorseEngine.js'));

let passed = 0, failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label, info != null ? '\n     ' + JSON.stringify(info) : ''); }
}

const FAKE_URL = 'https://discord.com/api/webhooks/123456789012345678/abcdef-token-xyz';

// ============================================================
// T1: 200 + JSON body returns ok + messageId
// ============================================================
console.log('\n[T1] 200 with JSON body and message ID');
{
  _recordedRequests = [];
  _stubResponse = { status: 200, body: '{"id":"9988776655","type":0,"content":"hi","channel_id":"111"}' };
  return (async () => {
    const r = await dh.dhSendWebhook(FAKE_URL, { content: 'hi' }, { wait: true });
    ok('resolved (not rejected)', !!r);
    ok('ok=true on 200',           r && r.ok === true);
    ok('status=200',               r && r.status === 200);
    ok('messageId captured',       r && r.messageId === '9988776655');
    ok('bodyLen > 0',              r && r.bodyLen > 0);
    ok('durationMs finite',        r && Number.isFinite(r.durationMs));
    ok('wait=true appended to URL', _recordedRequests.length === 1 && /[?&]wait=true(?:$|&)/.test(_recordedRequests[0].path),
       { recorded: _recordedRequests[0] && _recordedRequests[0].path });
    return runT2();
  })();
}

async function runT2() {
  // ============================================================
  // T2: 204 No Content (wait NOT set) — ok=true but no messageId
  // ============================================================
  console.log('\n[T2] 204 No Content without wait — ok=true, messageId=null');
  _recordedRequests = [];
  _stubResponse = { status: 204, body: '' };
  const r = await dh.dhSendWebhook(FAKE_URL, { content: 'hi' });
  ok('ok=true on 204',              r && r.ok === true);
  ok('status=204',                  r && r.status === 204);
  ok('messageId=null on empty body', r && r.messageId === null);
  ok('bodyLen=0',                   r && r.bodyLen === 0);
  ok('wait NOT appended without opts', _recordedRequests.length === 1 && !/wait=true/.test(_recordedRequests[0].path),
     { recorded: _recordedRequests[0] && _recordedRequests[0].path });
  return runT3();
}

async function runT3() {
  // ============================================================
  // T3: 400 + Discord form-body error — the live regression
  // ============================================================
  console.log('\n[T3] 400 Bad Request (payload > 2000 chars) — ok=false, structured excerpt');
  _recordedRequests = [];
  _stubResponse = { status: 400, body: '{"code":50035,"errors":{"content":{"_errors":[{"code":"BASE_TYPE_BAD_LENGTH","message":"Must be 2000 or fewer in length."}]}},"message":"Invalid Form Body"}' };
  const r = await dh.dhSendWebhook(FAKE_URL, { content: 'x'.repeat(3000) }, { wait: true });
  ok('ok=false on 400',                r && r.ok === false);
  ok('status=400',                     r && r.status === 400);
  ok('messageId=null on error',        r && r.messageId === null);
  ok('bodyLen > 0 (error body kept)',  r && r.bodyLen > 0);
  const excerpt = dh._dhExcerptResponse(r);
  ok('excerpt has status=400',         /status=400/.test(excerpt), excerpt);
  ok('excerpt has discord_code=50035', /discord_code=50035/.test(excerpt), excerpt);
  ok('excerpt has discord_msg=…',      /discord_msg="Invalid Form Body"/.test(excerpt), excerpt);
  ok('excerpt contains NO webhook URL',!excerpt.includes(FAKE_URL) && !excerpt.includes('abcdef-token-xyz'), excerpt);
  return runT4();
}

async function runT4() {
  // ============================================================
  // T4: 401 Unauthorized
  // ============================================================
  console.log('\n[T4] 401 Unauthorized — ok=false');
  _stubResponse = { status: 401, body: '{"message":"Invalid Webhook Token","code":50027}' };
  const r = await dh.dhSendWebhook(FAKE_URL, { content: 'hi' }, { wait: true });
  ok('ok=false on 401',           r && r.ok === false);
  ok('status=401',                r && r.status === 401);
  ok('messageId=null on error',   r && r.messageId === null);
  const excerpt = dh._dhExcerptResponse(r);
  ok('excerpt has status=401',    /status=401/.test(excerpt), excerpt);
  ok('excerpt has discord_code=50027', /discord_code=50027/.test(excerpt), excerpt);
  ok('401 excerpt has no URL',    !excerpt.includes(FAKE_URL), excerpt);
  return runT5();
}

async function runT5() {
  // ============================================================
  // T5: _dhRedactWebhook scrubs full URLs + bare path fragments
  // ============================================================
  console.log('\n[T5] _dhRedactWebhook scrubs URLs + bare path fragments');
  const fullUrlMsg   = 'POST ' + FAKE_URL + ' failed: ECONNRESET';
  const pathOnlyMsg  = 'request to webhooks/123456789012345678/abcdef-token-xyz timed out';
  const cleanFullUrl = dh._dhRedactWebhook(fullUrlMsg);
  const cleanPath    = dh._dhRedactWebhook(pathOnlyMsg);
  ok('full URL replaced with placeholder',
     /<webhook-url-redacted>/.test(cleanFullUrl) && !cleanFullUrl.includes('abcdef-token-xyz'),
     cleanFullUrl);
  ok('bare path replaced with placeholder',
     /webhooks\/<id>\/<token-redacted>/.test(cleanPath) && !cleanPath.includes('abcdef-token-xyz'),
     cleanPath);
  return runT6();
}

async function runT6() {
  // ============================================================
  // T6: opts.wait=true appended correctly when URL already has query
  // ============================================================
  console.log('\n[T6] wait=true appends correctly when URL already has a query string');
  _recordedRequests = [];
  _stubResponse = { status: 200, body: '{"id":"1"}' };
  const urlWithQuery = FAKE_URL + '?thread_id=999';
  await dh.dhSendWebhook(urlWithQuery, { content: 'hi' }, { wait: true });
  ok('thread_id preserved + wait=true appended with &',
     _recordedRequests.length === 1 && /thread_id=999&wait=true$/.test(_recordedRequests[0].path),
     { recorded: _recordedRequests[0] && _recordedRequests[0].path });
  return runT7();
}

async function runT7() {
  // ============================================================
  // T7: null webhook URL resolves to null (gracefully no-op)
  // ============================================================
  console.log('\n[T7] null webhook URL — resolves to null');
  const r = await dh.dhSendWebhook(null, { content: 'hi' });
  ok('null webhook resolves null', r === null);
  return summary();
}

function summary() {
  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed > 0) process.exit(1);
  console.log('[DH-DELIVERY-QA] PASS — instrumentation surface verified, zero webhook URL leaks.');
  process.exit(0);
}
