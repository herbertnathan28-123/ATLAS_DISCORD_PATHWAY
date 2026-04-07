'use strict';

/**
 * ATLAS FX — Corey Cache Updater
 * Forward-append only. Runs on a schedule to keep cache current.
 *
 * Source: TwelveData (live/recent candles only)
 * Never touches TradingView after initial historicalCache.js build.
 *
 * Rule: Only appends candles with time > last cached candle.
 *       Zero full rebuilds. Zero duplicate downloads.
 *
 * Usage:
 *   node cacheUpdater.js              → update all symbols
 *   node cacheUpdater.js EURUSD       → update single symbol
 *   node cacheUpdater.js --status     → print cache status table
 */

const https        = require('https');
const cacheManager = require('./cacheManager');
const { UNIVERSE } = require('./historicalCache');

// ─── Config ───────────────────────────────────────────────────────────────────

const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY;
const TIMEFRAME      = '1day';
const BATCH_DELAY_MS = 1200; // TwelveData rate limit buffer (free: 8 req/min)

// TwelveData symbol overrides where needed
const TD_SYMBOL_MAP = {
  USOIL:  'CL',      // Crude Light
  UKOIL:  'BZ',      // Brent
  XAUUSD: 'XAU/USD',
  XAGUSD: 'XAG/USD',
};

// ─── TwelveData Fetch ─────────────────────────────────────────────────────────

/**
 * Fetches recent 1D candles from TwelveData for a single symbol.
 * Only requests candles newer than lastCachedTime.
 *
 * Returns [{ time, open, high, low, close, volume }]
 */
function fetchTwelveData(symbol, outputsize = 30) {
  return new Promise((resolve, reject) => {
    if (!TWELVEDATA_KEY) {
      reject(new Error('TWELVEDATA_API_KEY env var not set'));
      return;
    }

    const tdSymbol = TD_SYMBOL_MAP[symbol] || symbol;
    const params   = new URLSearchParams({
      symbol:     tdSymbol,
      interval:   TIMEFRAME,
      outputsize: String(outputsize),
      apikey:     TWELVEDATA_KEY,
      format:     'JSON',
      order:      'ASC',
    });

    const url = `https://api.twelvedata.com/time_series?${params}`;

    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'error') {
            reject(new Error(json.message || 'TwelveData error'));
            return;
          }
          if (!Array.isArray(json.values)) {
            reject(new Error('No values array in TwelveData response'));
            return;
          }
          const candles = json.values.map(v => ({
            time:   Math.floor(new Date(v.datetime).getTime() / 1000),
            open:   parseFloat(v.open),
            high:   parseFloat(v.high),
            low:    parseFloat(v.low),
            close:  parseFloat(v.close),
            volume: v.volume ? parseFloat(v.volume) : 0,
          }));
          resolve(candles);
        } catch (err) {
          reject(new Error(`Parse error: ${err.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Update Single Symbol ─────────────────────────────────────────────────────

async function updateSymbol(group, symbol) {
  const filePath      = cacheManager.getFilePath(group, symbol);
  const lastCachedTs  = await cacheManager.getLastCachedTime(filePath);

  // Request enough candles to cover gap — max 5000 (TwelveData limit)
  // For daily updates this will typically be 1-5 candles
  const daysSinceLast = lastCachedTs
    ? Math.ceil((Date.now() / 1000 - lastCachedTs) / 86400) + 2
    : 30;
  const outputsize = Math.min(Math.max(daysSinceLast, 5), 5000);

  let newCandles;
  try {
    newCandles = await fetchTwelveData(symbol, outputsize);
  } catch (err) {
    return { symbol, status: 'error', reason: err.message };
  }

  if (newCandles.length === 0) {
    return { symbol, status: 'skipped', reason: 'no data returned' };
  }

  const appended = await cacheManager.appendParquet(filePath, newCandles);

  return {
    symbol,
    status:   appended > 0 ? 'updated' : 'current',
    appended,
  };
}

// ─── Update All ───────────────────────────────────────────────────────────────

async function updateAll() {
  console.log('══════════════════════════════════════════════════');
  console.log('  ATLAS FX — Cache Updater (TwelveData forward)');
  console.log(`  ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════\n');

  const diskOk = await cacheManager.checkDisk();
  if (!diskOk) {
    console.error('❌  Persistent disk not accessible. Aborting update.');
    process.exit(1);
  }

  const results = { updated: [], current: [], errors: [] };

  for (const [group, symbols] of Object.entries(UNIVERSE)) {
    console.log(`\n── ${group.toUpperCase()} ────────────────────────────────────`);

    for (const symbol of symbols) {
      process.stdout.write(`  ${symbol.padEnd(8)} `);
      const result = await updateSymbol(group, symbol);

      if (result.status === 'updated') {
        console.log(`✓ +${result.appended} candles`);
        results.updated.push(symbol);
      } else if (result.status === 'current') {
        console.log(`= already current`);
        results.current.push(symbol);
      } else {
        console.log(`❌ ${result.reason}`);
        results.errors.push(result);
      }

      // Rate limit buffer
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Updated : ${results.updated.length}`);
  console.log(`  Current : ${results.current.length}`);
  console.log(`  Errors  : ${results.errors.length}`);
  if (results.errors.length > 0) {
    results.errors.forEach(e => console.log(`    ❌ ${e.symbol}: ${e.reason}`));
  }
  console.log('══════════════════════════════════════════════════\n');

  return results;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];

  if (arg === '--status') {
    await cacheManager.checkDisk();
    await cacheManager.printCacheStatus(UNIVERSE);
    return;
  }

  if (arg) {
    // Single symbol update
    const symbol = arg.toUpperCase();
    const group  = Object.entries(UNIVERSE).find(([, syms]) => syms.includes(symbol))?.[0];
    if (!group) {
      console.error(`Symbol ${symbol} not found in ATLAS FX universe.`);
      process.exit(1);
    }
    console.log(`Updating ${symbol} (${group})...`);
    const result = await updateSymbol(group, symbol);
    console.log(result);
    return;
  }

  // Default: update all
  await updateAll();
}

module.exports = { updateAll, updateSymbol };

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
