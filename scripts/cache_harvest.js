#!/usr/bin/env node
'use strict';

/**
 * cache_harvest.js — CLI wrapper around corey_history_harvester.
 *
 * Usage:
 *   node scripts/cache_harvest.js                       # harvest missing only
 *   node scripts/cache_harvest.js --refresh             # refresh all
 *   node scripts/cache_harvest.js --symbol EURUSD       # one symbol
 *
 * Hard-stop: TWELVEDATA_API_KEY (or TWELVE_DATA_API_KEY) must be set.
 * Otherwise the harvester returns ok:false; this script exits 1.
 */

const harvester = require('../corey_history_harvester');
const config    = require('../corey_history_config');
const audit     = require('../corey_history_audit');

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : null;
}

(async () => {
  const refresh = process.argv.includes('--refresh');
  const sym     = argOf('--symbol');
  const apiKey  = process.env.TWELVEDATA_API_KEY || process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    console.error('[cache_harvest] HARD-STOP: TWELVEDATA_API_KEY (or TWELVE_DATA_API_KEY) absent');
    process.exit(1);
  }
  audit.info('cache_harvest_invoked', { refresh, symbol: sym || 'all', cache_dir: config.CACHE_DIR });

  const start = Date.now();
  let results;
  if (sym) {
    const r = await harvester.harvestSymbol(sym, { refresh, purpose: refresh ? 'refresh' : 'harvest' });
    results = [r];
  } else {
    results = await harvester.harvestAll({ refresh, purpose: refresh ? 'refresh' : 'harvest' });
  }

  const ok       = results.filter(r => r.ok).length;
  const failed   = results.filter(r => !r.ok);
  const skipped  = results.filter(r => r.skipped).length;
  const elapsedS = Math.round((Date.now() - start) / 1000);

  audit.info('cache_harvest_complete', { ok, failed: failed.length, skipped, elapsed_s: elapsedS });
  console.log(`\n[cache_harvest] ok=${ok} failed=${failed.length} skipped=${skipped} elapsed=${elapsedS}s`);
  for (const f of failed) console.log(`  FAIL ${f.atlas}: ${f.error}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(err => {
  console.error('[cache_harvest] fatal:', audit.sanitiseError(err));
  process.exit(1);
});
