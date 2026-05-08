'use strict';

/**
 * ATLAS FX — Corey Clone Phase D historical-cache harvester.
 *
 * Spec authority: D.1.0.3 §HARVEST + §HISTORICAL CACHE ROW SCHEMA + §CACHE
 * STRUCTURE.
 *
 * Pure HTTPS. No browser. One symbol at a time. Retry 3× per symbol with
 * 429 backoff. No secret logging.
 *
 * Hard rule: every row written includes full provenance and is linked to
 * an /_runs/<fetch_run_id>.json record created BEFORE the rows are written.
 * The validator's fetch_run_id allow-list is satisfied via that record.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const config    = require('./corey_history_config');
const validator = require('./corey_history_validator');
const audit     = require('./corey_history_audit');

const TWELVEDATA_HOST     = 'api.twelvedata.com';
const TWELVEDATA_ENDPOINT = '/time_series';
const TWELVEDATA_PLAN     = process.env.TWELVEDATA_PLAN || 'unspecified';
const OUTPUTSIZE          = 5000;
const MAX_RETRIES         = 3;
const BACKOFF_BASE_MS     = 1000;
const REQUEST_TIMEOUT_MS  = 30_000;

function uuid() {
  // RFC 4122 v4
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const buf = crypto.randomBytes(16);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const h = buf.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256OfFile(p) {
  if (!fs.existsSync(p)) return null;
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function loadManifest() {
  const p = config.manifestPath();
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_e) { return {}; }
}

function saveManifest(m) {
  ensureDirSync(config.CACHE_DIR);
  fs.writeFileSync(config.manifestPath(), JSON.stringify(m, null, 2), 'utf8');
}

function writeRunRecord(record) {
  ensureDirSync(config.runsDir());
  fs.writeFileSync(config.runFilePath(record.fetch_run_id), JSON.stringify(record, null, 2), 'utf8');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * fetchSeries — one HTTP call. Returns { ok, status, json, error }.
 * No URL or apikey is logged; only the status code + sanitised endpoint.
 */
function fetchSeries(symbolFetch, apiKey) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      symbol:     symbolFetch,
      interval:   '1day',
      outputsize: String(OUTPUTSIZE),
      apikey:     apiKey,
      format:     'JSON',
      order:      'ASC',
    });
    const opts = {
      hostname: TWELVEDATA_HOST,
      path:     `${TWELVEDATA_ENDPOINT}?${params.toString()}`,
      method:   'GET',
      headers:  { 'User-Agent': 'ATLAS-FX-CoreyClone/D' },
      timeout:  REQUEST_TIMEOUT_MS,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json });
        } catch (e) { resolve({ ok: false, status: res.statusCode, json: null, error: 'parse_error' }); }
      });
    });
    req.on('error',   (e) => resolve({ ok: false, status: 0, json: null, error: audit.sanitiseError(e) }));
    req.on('timeout', ()  => { req.destroy(); resolve({ ok: false, status: 0, json: null, error: 'timeout' }); });
    req.end();
  });
}

async function fetchWithRetry(symbolFetch, apiKey) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const r = await fetchSeries(symbolFetch, apiKey);
    if (r.ok && r.json && Array.isArray(r.json.values) && r.json.values.length > 0) return r;
    // 429 backoff
    if (r.status === 429) {
      const wait = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      audit.warn('twelvedata_429_backoff', { attempt, wait_ms: wait });
      await sleep(wait);
      continue;
    }
    // Other failures — short retry
    if (attempt < MAX_RETRIES) {
      audit.warn('twelvedata_retry', { attempt, status: r.status, reason: r.error || (r.json && r.json.message) || 'unknown' });
      await sleep(BACKOFF_BASE_MS);
      continue;
    }
    return r;
  }
}

function valueToRow(v, sym, runRecord) {
  // datetime is provider's bar-open time, e.g. "2024-09-05" for daily bars.
  // Treat it as midnight UTC; close_time is +1 day UTC.
  const ot = `${v.datetime}T00:00:00Z`;
  const otMs = Date.parse(ot);
  if (!Number.isFinite(otMs)) return null;
  const ct = new Date(otMs + 86_400_000).toISOString();
  const open  = parseFloat(v.open);
  const high  = parseFloat(v.high);
  const low   = parseFloat(v.low);
  const close = parseFloat(v.close);
  const vol   = (v.volume === '' || v.volume == null) ? null : parseFloat(v.volume);
  return {
    symbol:         sym.atlas,
    display_symbol: sym.display,
    fetch_symbol:   sym.fetch,
    timeframe:      '1D',
    open_time:      ot,
    close_time:     ct,
    open, high, low, close,
    volume:         vol == null || Number.isNaN(vol) ? null : vol,
    source: {
      provider:     'twelvedata',
      plan:         TWELVEDATA_PLAN,
      endpoint:     `${TWELVEDATA_HOST}${TWELVEDATA_ENDPOINT}`,
      fetched_at:   runRecord.started_at,
      fetch_run_id: runRecord.fetch_run_id,
    },
  };
}

/**
 * harvestSymbol — fetch one symbol from TwelveData and write JSONL.
 * Returns { ok, atlas, fetched, written, rejected, error?, fetch_run_id }.
 */
async function harvestSymbol(atlasSymbol, opts) {
  opts = opts || {};
  const apiKey = process.env.TWELVEDATA_API_KEY || process.env.TWELVE_DATA_API_KEY || '';
  if (!apiKey) {
    return { ok: false, atlas: atlasSymbol, error: 'TWELVEDATA_API_KEY (or TWELVE_DATA_API_KEY) absent' };
  }
  const sym = config.getSymbol(atlasSymbol);
  if (!sym) return { ok: false, atlas: atlasSymbol, error: `symbol not in Annex A: ${atlasSymbol}` };

  const fetch_run_id = uuid();
  const started_at   = new Date().toISOString();
  const runRecord = {
    fetch_run_id,
    provider:    'twelvedata',
    plan:        TWELVEDATA_PLAN,
    endpoint:    `${TWELVEDATA_HOST}${TWELVEDATA_ENDPOINT}`,
    started_at,
    symbol:      sym.atlas,
    fetch_symbol:sym.fetch,
    timeframe:   '1D',
    outputsize:  OUTPUTSIZE,
    purpose:     opts.purpose || (opts.refresh ? 'refresh' : 'harvest'),
  };
  // Write the run record FIRST so the row validator's allow-list is satisfied.
  writeRunRecord(runRecord);

  audit.info('harvest_start', { symbol: sym.atlas, fetch: sym.fetch, fetch_run_id });

  const r = await fetchWithRetry(sym.fetch, apiKey);
  if (!r.ok || !r.json || !Array.isArray(r.json.values) || r.json.values.length === 0) {
    const reason = (r && r.error) || (r && r.json && r.json.message) || 'fetch failed';
    runRecord.completed_at  = new Date().toISOString();
    runRecord.status        = 'fail';
    runRecord.fetched_count = 0;
    runRecord.error         = reason;
    writeRunRecord(runRecord);
    audit.error('harvest_failed', { symbol: sym.atlas, reason });
    return { ok: false, atlas: sym.atlas, error: reason, fetch_run_id };
  }

  const rows = [];
  for (const v of r.json.values) {
    const row = valueToRow(v, sym, runRecord);
    if (!row) continue;
    rows.push(row);
  }
  rows.sort((a, b) => Date.parse(a.open_time) - Date.parse(b.open_time));

  // Validate every row. Use the just-written run record as the only allowed run id.
  const runIdSet = new Set([fetch_run_id]);
  // Also add any pre-existing run ids so prior rows don't fail in case we ever
  // re-validate post-merge.
  const runsDir = config.runsDir();
  if (fs.existsSync(runsDir)) {
    for (const f of fs.readdirSync(runsDir)) {
      if (f.endsWith('.json')) runIdSet.add(f.slice(0, -5));
    }
  }
  const rejected = [];
  const accepted = [];
  for (const row of rows) {
    const v = validator.validateCacheRow(row, { runIdsAllowed: runIdSet, nowMs: Date.now() });
    if (v.ok) accepted.push(row);
    else rejected.push({ open_time: row.open_time, errors: v.errors });
  }

  // Write JSONL atomically: write to .tmp, then rename.
  ensureDirSync(config.symbolDir(sym.atlas));
  const out = config.jsonlPath(sym.atlas);
  const tmp = `${out}.tmp`;
  fs.writeFileSync(tmp, accepted.map(r => JSON.stringify(r)).join('\n') + (accepted.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, out);

  // Manifest update
  const manifest = loadManifest();
  const completed_at = new Date().toISOString();
  manifest[sym.atlas] = Object.assign({}, manifest[sym.atlas], {
    symbol:                       sym.atlas,
    display_symbol:               sym.display,
    fetch_symbol:                 sym.fetch,
    timeframe:                    '1D',
    first_bar_time:               accepted.length ? accepted[0].open_time  : null,
    last_bar_time:                accepted.length ? accepted[accepted.length-1].open_time : null,
    row_count:                    accepted.length,
    sha256:                       sha256OfFile(out),
    last_fetched_at:              completed_at,
    last_fetch_run_id:            fetch_run_id,
    last_fetch_status:            'ok',
    last_error:                   null,
    last_verified_at:             completed_at,            // post-write the file is verified-by-construction
    last_refresh_at:              completed_at,
    last_successful_refresh_run_id: fetch_run_id,
    last_full_harvest_at:         (manifest[sym.atlas] && manifest[sym.atlas].last_full_harvest_at) || completed_at,
  });
  saveManifest(manifest);

  // Final run-record update
  runRecord.completed_at  = completed_at;
  runRecord.status        = 'ok';
  runRecord.fetched_count = rows.length;
  runRecord.written_count = accepted.length;
  runRecord.rejected_count= rejected.length;
  if (rejected.length) runRecord.rejected_sample = rejected.slice(0, 5);
  writeRunRecord(runRecord);

  audit.info('harvest_complete', {
    symbol: sym.atlas, written: accepted.length, rejected: rejected.length, fetch_run_id,
  });
  return { ok: true, atlas: sym.atlas, fetched: rows.length, written: accepted.length, rejected: rejected.length, fetch_run_id };
}

/**
 * harvestAll — sequentially harvest every Annex A symbol that lacks a cache
 * file (or all of them if opts.refresh).
 */
async function harvestAll(opts) {
  opts = opts || {};
  const results = [];
  for (const sym of config.ANNEX_A) {
    const out = config.jsonlPath(sym.atlas);
    if (!opts.refresh && fs.existsSync(out)) {
      results.push({ ok: true, atlas: sym.atlas, skipped: true, reason: 'already cached' });
      continue;
    }
    const r = await harvestSymbol(sym.atlas, opts);
    results.push(r);
    if (!r.ok) audit.warn('harvest_skip_remaining_check', { symbol: sym.atlas, error: r.error });
    // Inter-symbol courtesy delay
    await sleep(200);
  }
  return results;
}

module.exports = {
  harvestSymbol,
  harvestAll,
};
