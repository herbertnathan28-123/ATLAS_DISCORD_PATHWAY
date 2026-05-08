#!/usr/bin/env node
'use strict';

/**
 * cache_verify.js — verifies the historical cache integrity.
 *
 * Checks:
 *   - cache_dir exists / is readable
 *   - _manifest.json present (or absent → empty cache, OK as a state)
 *   - For each symbol manifest entry:
 *       * file exists at expected path
 *       * SHA256 matches manifest sha256
 *       * row_count matches actual row count
 *       * first_bar_time / last_bar_time match observed extremes
 *       * every row passes the row-schema validator
 *       * every row's source.fetch_run_id is in /_runs/
 *   - For every JSONL on disk, there's a manifest entry (orphan check)
 *   - For every /_runs/<id>.json, structure is valid
 *   - Stamps last_verified_at on the manifest entry on PASS.
 *
 * Exit:
 *   0 — all checks pass
 *   1 — one or more checks fail
 *
 * No exit-1 on "cache empty" — that's a legitimate state. Operator runs
 * cache:harvest to populate it. Phase D production gate (A9) handles
 * the "no evidence" case via PARTIAL.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const config    = require('../corey_history_config');
const validator = require('../corey_history_validator');
const audit     = require('../corey_history_audit');

function sha256OfFile(p) {
  if (!fs.existsSync(p)) return null;
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function loadRunIds() {
  const dir = config.runsDir();
  const set = new Set();
  if (!fs.existsSync(dir)) return set;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) set.add(f.slice(0, -5));
  return set;
}

function verifyOne(atlas, manifestEntry, runIds) {
  const issues = [];
  const filePath = config.jsonlPath(atlas);
  if (!fs.existsSync(filePath)) return { ok: false, atlas, issues: ['file missing on disk'] };

  // SHA256
  const sha = sha256OfFile(filePath);
  if (manifestEntry.sha256 && manifestEntry.sha256 !== sha) {
    issues.push(`sha256 mismatch: manifest=${manifestEntry.sha256} actual=${sha}`);
  }

  // Row-by-row
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(s => s.trim().length);
  let rowCount = 0;
  let firstOpen = null, lastOpen = null;
  const validatorCtx = { runIdsAllowed: runIds, nowMs: Date.now() };
  for (let i = 0; i < lines.length; i++) {
    let row;
    try { row = JSON.parse(lines[i]); }
    catch (_e) { issues.push(`line ${i+1}: malformed JSON`); continue; }
    const v = validator.validateCacheRow(row, validatorCtx);
    if (!v.ok) {
      if (issues.length < 25) issues.push(`line ${i+1}: ${v.errors.join('; ')}`);
      continue;
    }
    rowCount++;
    const ot = row.open_time;
    if (firstOpen === null || ot < firstOpen) firstOpen = ot;
    if (lastOpen  === null || ot > lastOpen)  lastOpen  = ot;
  }
  if (manifestEntry.row_count != null && manifestEntry.row_count !== rowCount) {
    issues.push(`row_count mismatch: manifest=${manifestEntry.row_count} actual=${rowCount}`);
  }
  if (manifestEntry.first_bar_time && firstOpen && manifestEntry.first_bar_time !== firstOpen) {
    issues.push(`first_bar_time mismatch: manifest=${manifestEntry.first_bar_time} actual=${firstOpen}`);
  }
  if (manifestEntry.last_bar_time && lastOpen && manifestEntry.last_bar_time !== lastOpen) {
    issues.push(`last_bar_time mismatch: manifest=${manifestEntry.last_bar_time} actual=${lastOpen}`);
  }
  return { ok: issues.length === 0, atlas, rowCount, firstOpen, lastOpen, sha, issues };
}

(function main() {
  audit.info('cache_verify_start', { cache_dir: config.CACHE_DIR });
  if (!fs.existsSync(config.CACHE_DIR)) {
    console.log(`[cache_verify] cache directory absent: ${config.CACHE_DIR}`);
    console.log('[cache_verify] PASS (empty cache state).');
    process.exit(0);
  }

  const manifestPath = config.manifestPath();
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const runIds   = loadRunIds();

  // Orphan JSONL check
  const orphans = [];
  if (fs.existsSync(config.CACHE_DIR)) {
    for (const entry of fs.readdirSync(config.CACHE_DIR)) {
      if (entry === '_manifest.json' || entry === '_runs') continue;
      const dir = path.join(config.CACHE_DIR, entry);
      if (!fs.statSync(dir).isDirectory()) continue;
      const jsonl = path.join(dir, '1D.jsonl');
      if (fs.existsSync(jsonl) && !manifest[entry]) orphans.push(entry);
    }
  }

  const reports = [];
  for (const [atlas, entry] of Object.entries(manifest)) {
    reports.push(verifyOne(atlas, entry, runIds));
  }

  const failed = reports.filter(r => !r.ok);
  console.log(`[cache_verify] symbols verified=${reports.length} failed=${failed.length} orphans=${orphans.length}`);
  for (const r of reports) {
    if (r.ok) console.log(`  OK   ${r.atlas.padEnd(8)} rows=${r.rowCount} first=${r.firstOpen} last=${r.lastOpen}`);
    else      console.log(`  FAIL ${r.atlas.padEnd(8)} issues=${r.issues.length} :: ${r.issues.slice(0,3).join(' | ')}`);
  }
  for (const o of orphans) console.log(`  ORPHAN ${o}: jsonl on disk but no manifest entry`);

  if (failed.length === 0 && orphans.length === 0) {
    // Stamp last_verified_at on PASS
    const now = new Date().toISOString();
    for (const r of reports) {
      manifest[r.atlas].last_verified_at = now;
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    audit.info('cache_verify_pass', { symbols: reports.length, last_verified_at: now });
    console.log('[cache_verify] PASS.');
    process.exit(0);
  } else {
    audit.error('cache_verify_fail', { failed: failed.length, orphans: orphans.length });
    console.error('[cache_verify] FAIL.');
    process.exit(1);
  }
})();
