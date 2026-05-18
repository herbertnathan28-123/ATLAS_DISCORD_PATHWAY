'use strict';

/**
 * ATLAS FX — Corey Clone Phase D historical reader.
 *
 * Reads <cache_dir>/<SYMBOL>/1D.jsonl + manifest. Validates every row
 * against the cache schema BEFORE returning to caller. Returns chronologically
 * ordered candles with `open_time_ms` materialised for fast time arithmetic.
 *
 * Manifest is read once per call and used to gate freshness per
 * §STALE CACHE RULE.
 */

const fs   = require('fs');
const path = require('path');
const childProcess = require('child_process');
const config    = require('./corey_history_config');
const validator = require('./corey_history_validator');
const audit     = require('./corey_history_audit');

const ONE_DAY_MS = 86_400_000;

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { audit.warn('json_read_failed', { path: p, error: audit.sanitiseError(e) }); return null; }
}

function loadRunIdAllowSet() {
  const dir = config.runsDir();
  const set = new Set();
  if (!fs.existsSync(dir)) return set;
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_e) { return set; }
  for (const f of entries) {
    if (f.endsWith('.json')) set.add(f.slice(0, -5));
  }
  return set;
}

function readManifest() {
  const m = readJsonSafe(config.manifestPath());
  return m && typeof m === 'object' ? m : null;
}

function freshnessFromVerifiedAt(lastVerifiedAt) {
  if (!lastVerifiedAt || typeof lastVerifiedAt !== 'string') {
    return { ok: false, severity: 'severe', ageDays: null, reason: 'last_verified_at missing' };
  }
  const t = Date.parse(lastVerifiedAt);
  if (!Number.isFinite(t)) {
    return { ok: false, severity: 'severe', ageDays: null, reason: 'last_verified_at not parseable' };
  }
  const ageDays = (Date.now() - t) / ONE_DAY_MS;
  const F = config.FRESHNESS;
  if (ageDays <= F.freshDays)               return { ok: true,  severity: 'fresh',     ageDays };
  if (ageDays <= F.limitationFlagDays)      return { ok: true,  severity: 'limitation',ageDays };
  if (ageDays <= F.staleDays)               return { ok: true,  severity: 'stale',     ageDays, confidenceFactor: F.staleConfidenceFactor };
  return { ok: false, severity: 'severe', ageDays, reason: 'cache verification severely stale (>90 days); cache:verify/cache:refresh required before evidence trusted' };
}

function autoBootstrapEnabled(opts) {
  if (opts && opts.autoBootstrap === false) return false;
  if (process.env.COREY_CLONE_AUTO_BOOTSTRAP === 'false') return false;
  return true;
}

function tryBootstrapMissingCache(atlasSymbol, jsonl, opts) {
  if (!autoBootstrapEnabled(opts)) return { attempted: false, reason: 'auto_bootstrap_disabled' };
  if (fs.existsSync(jsonl)) return { attempted: false, reason: 'cache_present' };
  const script = path.join(__dirname, 'scripts', 'cache_harvest.js');
  if (!fs.existsSync(script)) return { attempted: false, reason: 'cache_harvest_script_missing' };

  audit.info('corey_clone_cache_bootstrap_start', {
    symbol: atlasSymbol,
    cacheDir: config.CACHE_DIR,
    jsonlPath: jsonl,
    mode: 'reader_sync_harvest',
  });

  let result;
  try {
    result = childProcess.spawnSync(process.execPath, [script, '--symbol', atlasSymbol], {
      env: process.env,
      encoding: 'utf8',
      timeout: Number(process.env.COREY_CLONE_BOOTSTRAP_TIMEOUT_MS || 180000),
      maxBuffer: 1024 * 1024,
    });
  } catch (e) {
    const err = audit.sanitiseError ? audit.sanitiseError(e) : (e && e.message) || 'spawn failed';
    audit.error('corey_clone_cache_bootstrap_spawn_failed', { symbol: atlasSymbol, error: err });
    return { attempted: true, ok: false, reason: 'spawn_failed', error: err };
  }

  const ok = result && result.status === 0 && fs.existsSync(jsonl);
  const stdoutTail = result && result.stdout ? result.stdout.slice(-1000) : '';
  const stderrTail = result && result.stderr ? result.stderr.slice(-1000) : '';
  const payload = {
    symbol: atlasSymbol,
    ok,
    status: result && result.status,
    signal: result && result.signal,
    jsonlExists: fs.existsSync(jsonl),
    stdoutTail,
    stderrTail,
  };
  if (ok) audit.info('corey_clone_cache_bootstrap_complete', payload);
  else audit.warn('corey_clone_cache_bootstrap_failed', payload);
  return Object.assign({ attempted: true, reason: ok ? 'harvest_ok' : 'harvest_failed' }, payload);
}

/**
 * readCandles(atlasSymbol, opts?) → { ok, rows, manifest, freshness, errors }
 */
function readCandles(atlasSymbol, opts) {
  opts = opts || {};
  const errors = [];
  const sym = config.getSymbol(atlasSymbol);
  if (!sym) return { ok: false, rows: [], errors: [`unknown symbol: ${atlasSymbol}`], manifest: null, freshness: null };

  const jsonl = config.jsonlPath(atlasSymbol);
  let bootstrap = null;
  if (!fs.existsSync(jsonl)) {
    bootstrap = tryBootstrapMissingCache(atlasSymbol, jsonl, opts);
  }
  if (!fs.existsSync(jsonl)) {
    return { ok: false, rows: [], errors: [`cache file missing: ${atlasSymbol}/1D.jsonl`], manifest: null, freshness: { ok: false, severity: 'severe', ageDays: null, reason: 'cache file missing' }, bootstrap };
  }

  const manifestAll = readManifest();
  const symManifest = manifestAll && manifestAll[atlasSymbol] ? manifestAll[atlasSymbol] : null;

  // Build allow-list of run IDs from /_runs/
  const runIds = loadRunIdAllowSet();
  const validatorCtx = { runIdsAllowed: runIds, nowMs: Date.now() };

  const lines = fs.readFileSync(jsonl, 'utf8').split('\n');
  const rows = [];
  const dupKey = new Set();
  let badCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    let row;
    try { row = JSON.parse(ln); }
    catch (e) {
      badCount++;
      if (errors.length < 25) errors.push(`line ${i+1}: malformed JSON`);
      continue;
    }
    const v = validator.validateCacheRow(row, validatorCtx);
    if (!v.ok) {
      badCount++;
      if (errors.length < 25) errors.push(`line ${i+1}: ${v.errors.join('; ')}`);
      continue;
    }
    const k = `${row.symbol}|${row.open_time}|${row.close_time}`;
    if (dupKey.has(k)) {
      badCount++;
      if (errors.length < 25) errors.push(`line ${i+1}: duplicate symbol/open_time/close_time`);
      continue;
    }
    dupKey.add(k);
    row.open_time_ms  = Date.parse(row.open_time);
    row.close_time_ms = Date.parse(row.close_time);
    rows.push(row);
  }

  rows.sort((a, b) => a.open_time_ms - b.open_time_ms);

  const freshness = symManifest
    ? freshnessFromVerifiedAt(symManifest.last_verified_at)
    : { ok: false, severity: 'severe', ageDays: null, reason: 'manifest entry missing' };

  if (badCount > 0) audit.warn('cache_rows_rejected', { symbol: atlasSymbol, badCount });

  return {
    ok: rows.length > 0 && errors.length === 0,
    rows,
    badCount,
    errors,
    manifest: symManifest,
    freshness,
    bootstrap,
  };
}

/**
 * findBarByOpenTime(rows, isoString) → row | null
 */
function findBarByOpenTime(rows, iso) {
  if (!rows || !rows.length) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  // Binary search by open_time_ms
  let lo = 0, hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = rows[mid].open_time_ms;
    if (v === t) return rows[mid];
    if (v < t) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

/**
 * indexOfBarByOpenTime(rows, iso) → integer index or -1
 */
function indexOfBarByOpenTime(rows, iso) {
  if (!rows || !rows.length) return -1;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return -1;
  let lo = 0, hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = rows[mid].open_time_ms;
    if (v === t) return mid;
    if (v < t) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

module.exports = {
  readCandles,
  readManifest,
  loadRunIdAllowSet,
  freshnessFromVerifiedAt,
  findBarByOpenTime,
  indexOfBarByOpenTime,
};
