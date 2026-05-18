#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/cache_coverage_report.js
//
// Operator brief 2026-05-18 — emits a per-symbol Corey Clone
// cache coverage report so the team can see exactly which Annex A
// symbols have a usable historical cache and which are missing.
// Replaces the previous "we know EURUSD is fine, everything else
// is unverified" state.
//
// Usage:
//   node scripts/cache_coverage_report.js              # human table
//   node scripts/cache_coverage_report.js --json       # machine
//   node scripts/cache_coverage_report.js --markdown   # cert table
//
// Reads only — never writes to the cache. Safe to run in any
// environment. When run against an empty local checkout, every
// symbol reports MISSING; when run against the Render persistent
// disk it reports the live coverage.
// ============================================================

const fs = require('fs');
const path = require('path');
const config = require(path.join(__dirname, '..', 'corey_history_config'));

const MODE = process.argv.includes('--json') ? 'json'
           : process.argv.includes('--markdown') ? 'markdown'
           : 'human';

function loadManifest() {
  const p = config.manifestPath();
  if (!fs.existsSync(p)) return { ok: false, reason: 'manifest_missing', path: p, data: {} };
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    return { ok: true, path: p, data };
  } catch (e) {
    return { ok: false, reason: 'manifest_parse_error:' + e.message, path: p, data: {} };
  }
}

function inspectSymbol(entry, manifest) {
  const atlas = entry.atlas;
  const file = config.jsonlPath(atlas);
  const out = {
    rank: entry.rank,
    symbol: atlas,
    group: entry.group,
    calendar: entry.calendar,
    cachePath: file,
    fileExists: false,
    rowCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    lastVerifiedAt: null,
    ageDays: null,
    freshness: 'unknown',
    usableForDecision: false,
    status: 'BLOCKED',
    actionNeeded: 'Build cache via corey_history_harvester for ' + atlas + ' (file does not exist)',
  };

  if (!fs.existsSync(file)) {
    return out;
  }
  out.fileExists = true;
  // Read row count + first/last timestamp without loading the whole file.
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim().length);
    out.rowCount = lines.length;
    if (lines.length) {
      try { out.firstTimestamp = JSON.parse(lines[0]).open_time_ms || null; } catch (_e) { /* ignore */ }
      try { out.lastTimestamp = JSON.parse(lines[lines.length - 1]).open_time_ms || null; } catch (_e) { /* ignore */ }
    }
  } catch (e) {
    out.actionNeeded = 'Cache file present but unreadable: ' + e.message;
    return out;
  }

  const meta = manifest.data && manifest.data[atlas];
  if (meta && meta.last_verified_at) {
    out.lastVerifiedAt = meta.last_verified_at;
    const verifiedMs = Date.parse(meta.last_verified_at);
    if (Number.isFinite(verifiedMs)) {
      out.ageDays = Math.round((Date.now() - verifiedMs) / (24 * 60 * 60 * 1000));
    }
  }

  // Map freshness to the Spec §STALE CACHE RULE thresholds.
  if (out.ageDays == null) {
    out.freshness = 'manifest_meta_missing';
  } else if (out.ageDays <= config.FRESHNESS.freshDays) {
    out.freshness = 'fresh';
  } else if (out.ageDays <= config.FRESHNESS.limitationFlagDays) {
    out.freshness = 'limitation_flag';
  } else if (out.ageDays <= config.FRESHNESS.staleDays) {
    out.freshness = 'stale_factor_' + config.FRESHNESS.staleConfidenceFactor;
  } else {
    out.freshness = 'severely_stale';
  }

  // usableForDecision per the Corey Clone gate: cache present + not severely stale.
  if (out.rowCount === 0) {
    out.usableForDecision = false;
    out.status = 'BLOCKED';
    out.actionNeeded = 'Cache file empty — re-run harvester for ' + atlas;
  } else if (out.freshness === 'severely_stale') {
    out.usableForDecision = false;
    out.status = 'PARTIAL';
    out.actionNeeded = 'Cache > 90 days old; rerun harvester for ' + atlas + ' (last verified ' + out.lastVerifiedAt + ')';
  } else if (out.freshness === 'manifest_meta_missing') {
    out.usableForDecision = false;
    out.status = 'PARTIAL';
    out.actionNeeded = 'Manifest entry missing for ' + atlas + ' — add `last_verified_at` to ' + config.manifestPath();
  } else {
    out.usableForDecision = true;
    out.status = 'OK';
    out.actionNeeded = 'None — cache usable, freshness=' + out.freshness;
  }
  return out;
}

function emitHuman(rows, manifest) {
  console.log('ATLAS Corey Clone cache coverage');
  console.log('Cache dir:', config.CACHE_DIR);
  console.log('Manifest :', manifest.ok ? manifest.path : '(MISSING: ' + manifest.reason + ')');
  console.log('');
  const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log('Status counts:', JSON.stringify(counts));
  console.log('');
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(w('Sym', 8) + w('Group', 10) + w('Status', 9) + w('Rows', 7) + w('Fresh', 22) + w('Usable', 7) + 'Action');
  for (const r of rows) {
    console.log(w(r.symbol, 8) + w(r.group, 10) + w(r.status, 9) + w(r.rowCount, 7) + w(r.freshness, 22) + w(r.usableForDecision ? 'YES' : 'NO', 7) + r.actionNeeded);
  }
}

function emitJson(rows, manifest) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    cacheDir: config.CACHE_DIR,
    manifest: { ok: manifest.ok, path: manifest.path, reason: manifest.reason || null },
    rows,
  }, null, 2));
}

function emitMarkdown(rows, manifest) {
  console.log('| Rank | Symbol | Group | Cache Path | Rows | First Date | Last Date | Last Verified | Age (d) | Freshness | Usable | Status | Action Needed |');
  console.log('|---:|---|---|---|---:|---|---|---|---:|---|---|---|---|');
  for (const r of rows) {
    const first = r.firstTimestamp ? new Date(r.firstTimestamp).toISOString().slice(0, 10) : '—';
    const last  = r.lastTimestamp  ? new Date(r.lastTimestamp).toISOString().slice(0, 10)  : '—';
    const verified = r.lastVerifiedAt || '—';
    const age = r.ageDays != null ? r.ageDays : '—';
    console.log('| ' + r.rank + ' | `' + r.symbol + '` | ' + r.group + ' | `' + r.cachePath + '` | ' + r.rowCount + ' | ' + first + ' | ' + last + ' | ' + verified + ' | ' + age + ' | ' + r.freshness + ' | ' + (r.usableForDecision ? '✅' : '❌') + ' | ' + r.status + ' | ' + r.actionNeeded + ' |');
  }
}

function main() {
  const manifest = loadManifest();
  const rows = config.ANNEX_A.map(entry => inspectSymbol(entry, manifest));
  if (MODE === 'json') emitJson(rows, manifest);
  else if (MODE === 'markdown') emitMarkdown(rows, manifest);
  else emitHuman(rows, manifest);
}

main();
