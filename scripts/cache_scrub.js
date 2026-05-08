#!/usr/bin/env node
'use strict';

/**
 * cache_scrub.js — scrub cache JSONL files of rows that fail the row-schema
 * validator, regenerate manifests, and exit cleanly.
 *
 * Usage:
 *   node scripts/cache_scrub.js                  # scrub all symbols
 *   node scripts/cache_scrub.js --symbol EURUSD  # one symbol
 *   node scripts/cache_scrub.js --dry            # report only, do not write
 *
 * Behaviour:
 *   - For each <SYMBOL>/1D.jsonl: parse rows, drop any that fail the
 *     validator, dedupe by (symbol, open_time, close_time), sort by open_time.
 *   - Write back atomically via .tmp + rename.
 *   - Update manifest sha256 / row_count / first_bar_time / last_bar_time.
 *   - Do NOT update last_verified_at (that's for cache:verify only).
 *   - Do NOT touch /_runs/ records.
 */

const fs    = require('fs');
const crypto = require('crypto');
const config    = require('../corey_history_config');
const validator = require('../corey_history_validator');
const audit     = require('../corey_history_audit');

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : null;
}
const dry = process.argv.includes('--dry');
const onlySym = argOf('--symbol');

function loadRunIds() {
  const dir = config.runsDir();
  const set = new Set();
  if (!fs.existsSync(dir)) return set;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) set.add(f.slice(0, -5));
  return set;
}

function sha256OfBuf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

(function main() {
  audit.info('cache_scrub_start', { cache_dir: config.CACHE_DIR, dry });
  if (!fs.existsSync(config.CACHE_DIR)) {
    console.log('[cache_scrub] cache directory absent — nothing to scrub.');
    process.exit(0);
  }

  const manifestPath = config.manifestPath();
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const runIds   = loadRunIds();
  const validatorCtx = { runIdsAllowed: runIds, nowMs: Date.now() };

  const symbols = onlySym ? [onlySym] : Object.keys(manifest);
  let totalDropped = 0, totalKept = 0;

  for (const atlas of symbols) {
    const filePath = config.jsonlPath(atlas);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP ${atlas}: file missing`);
      continue;
    }
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(s => s.trim().length);
    const seen = new Set();
    const kept = [];
    let dropped = 0;
    for (const ln of lines) {
      let row;
      try { row = JSON.parse(ln); } catch (_e) { dropped++; continue; }
      const v = validator.validateCacheRow(row, validatorCtx);
      if (!v.ok) { dropped++; continue; }
      const k = `${row.symbol}|${row.open_time}|${row.close_time}`;
      if (seen.has(k)) { dropped++; continue; }
      seen.add(k);
      kept.push(row);
    }
    kept.sort((a, b) => Date.parse(a.open_time) - Date.parse(b.open_time));
    const buf = Buffer.from(kept.map(r => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
    const newSha = sha256OfBuf(buf);
    const firstOpen = kept.length ? kept[0].open_time : null;
    const lastOpen  = kept.length ? kept[kept.length - 1].open_time : null;

    if (!dry) {
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, filePath);
      manifest[atlas] = Object.assign({}, manifest[atlas], {
        sha256:         newSha,
        row_count:      kept.length,
        first_bar_time: firstOpen,
        last_bar_time:  lastOpen,
      });
    }

    totalKept    += kept.length;
    totalDropped += dropped;
    console.log(`  ${dry ? 'DRY ' : '    '}${atlas.padEnd(8)} kept=${kept.length} dropped=${dropped} sha=${newSha.slice(0,12)}...`);
  }

  if (!dry) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  audit.info('cache_scrub_complete', { dry, totalKept, totalDropped });
  console.log(`[cache_scrub] ${dry ? 'DRY ' : ''}kept=${totalKept} dropped=${totalDropped}`);
  process.exit(0);
})();
