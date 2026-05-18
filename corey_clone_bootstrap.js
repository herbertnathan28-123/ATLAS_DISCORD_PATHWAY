'use strict';

const config = require('./corey_history_config');
const reader = require('./corey_history_reader');
const audit = require('./corey_history_audit');
let harvester = null;
try { harvester = require('./corey_history_harvester'); } catch (_e) {}

function isEnabled(opts) {
  if (opts && opts.autoBootstrap === false) return false;
  return process.env.COREY_CLONE_AUTO_BOOTSTRAP !== 'false';
}

function missingCache(read) {
  const first = read && read.errors && read.errors[0] ? String(read.errors[0]) : '';
  return /cache file missing/i.test(first);
}

async function readCandles(symbol, opts) {
  const initial = reader.readCandles(symbol);
  if (initial.ok) return { read: initial, bootstrap: { attempted: false, reason: 'cache_present' } };
  if (!isEnabled(opts)) return { read: initial, bootstrap: { attempted: false, reason: 'auto_bootstrap_disabled' } };
  if (!missingCache(initial)) return { read: initial, bootstrap: { attempted: false, reason: 'read_failed_not_missing_cache' } };
  if (!harvester || typeof harvester.harvestSymbol !== 'function') return { read: initial, bootstrap: { attempted: false, reason: 'harvester_unavailable' } };

  audit.info('corey_clone_cache_bootstrap_start', { symbol, cacheDir: config.CACHE_DIR, jsonlPath: config.jsonlPath(symbol), provider: 'twelvedata' });
  let harvest;
  try {
    harvest = await harvester.harvestSymbol(symbol, { refresh: false, purpose: 'corey_clone_auto_bootstrap' });
  } catch (e) {
    const err = audit.sanitiseError ? audit.sanitiseError(e) : ((e && e.message) || 'bootstrap threw');
    audit.error('corey_clone_cache_bootstrap_threw', { symbol, error: err });
    return { read: initial, bootstrap: { attempted: true, ok: false, reason: 'harvest_threw', error: err } };
  }

  if (!harvest || !harvest.ok) {
    audit.warn('corey_clone_cache_bootstrap_failed', {
      symbol,
      provider: 'twelvedata',
      reason: harvest && harvest.error ? harvest.error : 'harvest failed',
      fetch_run_id: harvest && harvest.fetch_run_id,
    });
    return { read: initial, bootstrap: { attempted: true, ok: false, reason: harvest && harvest.error ? harvest.error : 'harvest failed', harvest } };
  }

  const reread = reader.readCandles(symbol);
  audit.info('corey_clone_cache_bootstrap_complete', {
    symbol,
    provider: 'twelvedata',
    fetch_run_id: harvest.fetch_run_id,
    written: harvest.written,
    rejected: harvest.rejected,
    reread_ok: reread.ok,
    reread_rows: reread.rows ? reread.rows.length : 0,
    reread_errors: reread.errors ? reread.errors.slice(0, 3) : [],
  });
  return { read: reread, bootstrap: { attempted: true, ok: reread.ok, harvest } };
}

module.exports = { readCandles };
