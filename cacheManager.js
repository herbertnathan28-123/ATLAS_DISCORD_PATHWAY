'use strict';

/**
 * ATLAS FX — Corey Cache Manager
 * Handles all disk I/O for the historical OHLCV parquet cache.
 *
 * Storage root: /data/historical/
 *   /data/historical/fx/
 *   /data/historical/stocks/
 *   /data/historical/commodities/
 *
 * Format: Apache Parquet (.parquet)
 * Schema: { time: INT64, open: DOUBLE, high: DOUBLE, low: DOUBLE, close: DOUBLE, volume: DOUBLE }
 */

const fs      = require('fs');
const fsp     = require('fs').promises;
const path    = require('path');
const parquet = require('@dsnp/parquetjs');

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_ROOT = process.env.CACHE_ROOT || '/data/historical';

const DIRS = {
  fx:          path.join(STORAGE_ROOT, 'fx'),
  stocks:      path.join(STORAGE_ROOT, 'stocks'),
  commodities: path.join(STORAGE_ROOT, 'commodities'),
};

// Parquet schema for OHLCV data
const SCHEMA = new parquet.ParquetSchema({
  time:   { type: 'INT64'  },   // Unix timestamp (seconds)
  open:   { type: 'DOUBLE' },
  high:   { type: 'DOUBLE' },
  low:    { type: 'DOUBLE' },
  close:  { type: 'DOUBLE' },
  volume: { type: 'DOUBLE' },
});

// ─── Disk Check ───────────────────────────────────────────────────────────────

/**
 * Verifies the storage root exists and is writable.
 * Returns true if ready, false if disk not mounted.
 */
async function checkDisk() {
  try {
    await fsp.access(STORAGE_ROOT, fs.constants.W_OK);
    console.log(`✓ Persistent disk accessible at ${STORAGE_ROOT}`);
    return true;
  } catch {
    // Try to create it — works in local dev, not on Render without disk
    try {
      await fsp.mkdir(STORAGE_ROOT, { recursive: true });
      await fsp.access(STORAGE_ROOT, fs.constants.W_OK);
      console.log(`✓ Created local cache directory at ${STORAGE_ROOT}`);
      return true;
    } catch {
      return false;
    }
  }
}

// ─── Directory Init ───────────────────────────────────────────────────────────

async function initDirectories() {
  for (const dir of Object.values(DIRS)) {
    await fsp.mkdir(dir, { recursive: true });
  }
  console.log(`✓ Cache directories initialised under ${STORAGE_ROOT}`);
}

// ─── File Path ────────────────────────────────────────────────────────────────

/**
 * Returns the full parquet file path for a given group + symbol.
 * e.g. getFilePath('fx', 'EURUSD') → '/data/historical/fx/EURUSD.parquet'
 */
function getFilePath(group, symbol) {
  const dir = DIRS[group];
  if (!dir) throw new Error(`Unknown cache group: ${group}`);
  return path.join(dir, `${symbol}.parquet`);
}

// ─── Existence Check ─────────────────────────────────────────────────────────

async function exists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ─── Write (full dataset) ────────────────────────────────────────────────────

/**
 * Writes a full candle array to parquet.
 * candles: [{ time, open, high, low, close, volume }]
 */
async function writeParquet(filePath, candles) {
  const writer = await parquet.ParquetWriter.openFile(SCHEMA, filePath);
  for (const c of candles) {
    await writer.appendRow({
      time:   BigInt(c.time),
      open:   c.open,
      high:   c.high,
      low:    c.low,
      close:  c.close,
      volume: c.volume ?? 0,
    });
  }
  await writer.close();
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Reads all candles from a parquet file.
 * Returns [{ time, open, high, low, close, volume }]
 */
async function readParquet(filePath) {
  const reader = await parquet.ParquetReader.openFile(filePath);
  const cursor = reader.getCursor();
  const rows   = [];
  let row;
  while ((row = await cursor.next()) !== null) {
    rows.push({
      time:   Number(row.time),
      open:   row.open,
      high:   row.high,
      low:    row.low,
      close:  row.close,
      volume: row.volume,
    });
  }
  await reader.close();
  return rows;
}

// ─── Append (forward update) ──────────────────────────────────────────────────

/**
 * Appends new candles to an existing parquet file.
 * Only appends candles with time > last cached candle time.
 * Called by cacheUpdater.js — never rewrites full history.
 *
 * newCandles: [{ time, open, high, low, close, volume }]
 * Returns: number of candles actually appended
 */
async function appendParquet(filePath, newCandles) {
  if (!(await exists(filePath))) {
    // First write — shouldn't happen in normal flow but handle gracefully
    await writeParquet(filePath, newCandles);
    return newCandles.length;
  }

  // Get the last cached timestamp
  const existing  = await readParquet(filePath);
  const lastTime  = existing.length > 0 ? existing[existing.length - 1].time : 0;

  // Filter to only genuinely new candles
  const toAppend = newCandles
    .filter(c => c.time > lastTime)
    .sort((a, b) => a.time - b.time);

  if (toAppend.length === 0) return 0;

  // Read existing + merge + rewrite (parquet doesn't support true append natively)
  // For daily candles this is fast — max ~5500 rows per symbol
  const merged = [...existing, ...toAppend];
  await writeParquet(filePath, merged);

  return toAppend.length;
}

// ─── Cache Info ───────────────────────────────────────────────────────────────

/**
 * Returns metadata about a cached symbol without reading all candles.
 */
async function getCacheInfo(filePath) {
  if (!(await exists(filePath))) return null;

  const candles = await readParquet(filePath);
  if (candles.length === 0) return { count: 0, from: null, to: null };

  return {
    count: candles.length,
    from:  new Date(candles[0].time * 1000).toISOString().split('T')[0],
    to:    new Date(candles[candles.length - 1].time * 1000).toISOString().split('T')[0],
  };
}

/**
 * Returns last cached timestamp (unix seconds) for a symbol.
 * Returns 0 if not cached.
 */
async function getLastCachedTime(filePath) {
  if (!(await exists(filePath))) return 0;
  const candles = await readParquet(filePath);
  if (candles.length === 0) return 0;
  return candles[candles.length - 1].time;
}

// ─── Cache Status Report ─────────────────────────────────────────────────────

/**
 * Prints a status table for all symbols in the universe.
 */
async function printCacheStatus(universe) {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         ATLAS FX — Historical Cache Status               ║');
  console.log('╠══════════╦════════╦══════════════╦══════════════╦════════╣');
  console.log('║ Symbol   ║ Group  ║ From         ║ To           ║ Candles║');
  console.log('╠══════════╬════════╬══════════════╬══════════════╬════════╣');

  for (const [group, symbols] of Object.entries(universe)) {
    for (const symbol of symbols) {
      const fp   = getFilePath(group, symbol);
      const info = await getCacheInfo(fp);
      const sym  = symbol.padEnd(8);
      const grp  = group.padEnd(6);
      if (!info) {
        console.log(`║ ${sym} ║ ${grp} ║ NOT CACHED   ║              ║        ║`);
      } else {
        const from = (info.from || 'N/A').padEnd(12);
        const to   = (info.to   || 'N/A').padEnd(12);
        const cnt  = String(info.count).padStart(6);
        console.log(`║ ${sym} ║ ${grp} ║ ${from} ║ ${to} ║ ${cnt} ║`);
      }
    }
  }

  console.log('╚══════════╩════════╩══════════════╩══════════════╩════════╝\n');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  STORAGE_ROOT,
  DIRS,
  SCHEMA,
  checkDisk,
  initDirectories,
  getFilePath,
  exists,
  writeParquet,
  readParquet,
  appendParquet,
  getCacheInfo,
  getLastCachedTime,
  printCacheStatus,
};
