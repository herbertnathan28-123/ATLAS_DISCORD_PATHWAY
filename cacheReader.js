'use strict';

/**
 * ATLAS FX — Cache Reader
 * Public interface for Corey and Dark Horse to consume historical data.
 * All disk access goes through here — engines never read parquet directly.
 *
 * Usage:
 *   const cache = require('./cacheReader');
 *   const candles = await cache.getCandles('EURUSD');
 *   const last    = await cache.getLatestCandle('NVDA');
 *   const range   = await cache.getCandleRange('XAUUSD', fromTs, toTs);
 */

const cacheManager = require('./cacheManager');
const { UNIVERSE } = require('./historicalCache');

// ─── Symbol → Group lookup ────────────────────────────────────────────────────

const SYMBOL_GROUP_MAP = {};
for (const [group, symbols] of Object.entries(UNIVERSE)) {
  for (const symbol of symbols) {
    SYMBOL_GROUP_MAP[symbol] = group;
  }
}

function resolveGroup(symbol) {
  const group = SYMBOL_GROUP_MAP[symbol.toUpperCase()];
  if (!group) throw new Error(`Symbol ${symbol} not in ATLAS FX universe`);
  return group;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns all cached candles for a symbol.
 * Sorted ascending by time.
 */
async function getCandles(symbol) {
  const sym      = symbol.toUpperCase();
  const group    = resolveGroup(sym);
  const filePath = cacheManager.getFilePath(group, sym);

  if (!(await cacheManager.exists(filePath))) {
    throw new Error(`No cache found for ${sym}. Run historicalCache.js first.`);
  }

  return cacheManager.readParquet(filePath);
}

/**
 * Returns candles within a Unix timestamp range [fromTs, toTs].
 */
async function getCandleRange(symbol, fromTs, toTs) {
  const candles = await getCandles(symbol);
  return candles.filter(c => c.time >= fromTs && c.time <= toTs);
}

/**
 * Returns the most recent N candles for a symbol.
 */
async function getRecentCandles(symbol, count = 200) {
  const candles = await getCandles(symbol);
  return candles.slice(-count);
}

/**
 * Returns just the latest candle for a symbol.
 */
async function getLatestCandle(symbol) {
  const candles = await getCandles(symbol);
  return candles.length > 0 ? candles[candles.length - 1] : null;
}

/**
 * Returns cache metadata for a symbol without loading all candles.
 */
async function getCacheInfo(symbol) {
  const sym      = symbol.toUpperCase();
  const group    = resolveGroup(sym);
  const filePath = cacheManager.getFilePath(group, sym);
  return cacheManager.getCacheInfo(filePath);
}

/**
 * Returns true if a symbol is cached and has data.
 */
async function isCached(symbol) {
  try {
    const info = await getCacheInfo(symbol);
    return info !== null && info.count > 0;
  } catch {
    return false;
  }
}

/**
 * Checks all universe symbols and returns which are cached vs missing.
 */
async function getUniverseStatus() {
  const status = { cached: [], missing: [] };
  for (const symbols of Object.values(UNIVERSE)) {
    for (const symbol of symbols) {
      const cached = await isCached(symbol);
      if (cached) status.cached.push(symbol);
      else         status.missing.push(symbol);
    }
  }
  return status;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getCandles,
  getCandleRange,
  getRecentCandles,
  getLatestCandle,
  getCacheInfo,
  isCached,
  getUniverseStatus,
  SYMBOL_GROUP_MAP,
};
