'use strict';

/**
 * ATLAS FX — Corey Historical Cache Harvester
 * Phase 1: 1D candles, 15-year backfill
 * Source: TwelveData API (Grow 377 plan)
 * Storage: Render persistent disk → /data/historical/
 *
 * No Playwright. No browser. Pure HTTPS.
 * One API call per symbol. 24 symbols total.
 * Resume-safe: skips already-cached symbols.
 */

const https        = require('https');
const cacheManager = require('./cacheManager');

const UNIVERSE = {
  fx: [
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD',
    'USD/CHF', 'NZD/USD', 'EUR/GBP', 'EUR/JPY', 'GBP/JPY',
  ],
  stocks: [
    'NVDA', 'AAPL', 'MSFT', 'AMD', 'TSLA',
    'GOOGL', 'META', 'ASML', 'AVGO', 'SMCI',
  ],
  commodities: [
    'XAU/USD', 'XAG/USD', 'CL', 'BZ',
  ],
};

const FILE_NAME_MAP = {
  'EUR/USD': 'EURUSD', 'GBP/USD': 'GBPUSD', 'USD/JPY': 'USDJPY',
  'AUD/USD': 'AUDUSD', 'USD/CAD': 'USDCAD', 'USD/CHF': 'USDCHF',
  'NZD/USD': 'NZDUSD', 'EUR/GBP': 'EURGBP', 'EUR/JPY': 'EURJPY',
  'GBP/JPY': 'GBPJPY', 'XAU/USD': 'XAUUSD', 'XAG/USD': 'XAGUSD',
  'CL': 'USOIL', 'BZ': 'UKOIL',
};

function getFileName(symbol) {
  return FILE_NAME_MAP[symbol] || symbol.replace('/', '');
}

const TWELVEDATA_KEY = process.env.TWELVE_DATA_API_KEY;
const TIMEFRAME      = '1day';
const OUTPUTSIZE     = 5000;
const DELAY_MS       = 200;

function fetchHistory(symbol) {
  return new Promise((resolve, reject) => {
    if (!TWELVEDATA_KEY) {
      reject(new Error('TWELVE_DATA_API_KEY env var not set'));
      return;
    }

    const params = new URLSearchParams({
      symbol:     symbol,
      interval:   TIMEFRAME,
      outputsize: String(OUTPUTSIZE),
      apikey:     TWELVE_DATA_API_KEY,
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
          if (json.status === 'error' || json.code) {
            reject(new Error(json.message || `API error code ${json.code}`));
            return;
          }
          if (!Array.isArray(json.values) || json.values.length === 0) {
            reject(new Error('Empty or missing values array'));
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

async function harvest() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ATLAS FX — Corey Historical Cache Builder');
  console.log('  Phase 1: 1D x 15 years via TwelveData');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (!TWELVEDATA_KEY) {
    console.error('TWELVE_DATA_API_KEY not set. Aborting.');
    process.exit(1);
  }

  await cacheManager.initDirectories();
  const diskOk = await cacheManager.checkDisk();
  if (!diskOk) {
    console.error('  /data/historical/ not accessible.');
    console.error('  Confirm Render persistent disk is mounted at /data');
    process.exit(1);
  }

  const results = { success: [], failed: [] };

  for (const [group, symbols] of Object.entries(UNIVERSE)) {
    console.log(`\n-- Group: ${group.toUpperCase()} --`);

    for (const symbol of symbols) {
      const fileName = getFileName(symbol);
      const filePath = cacheManager.getFilePath(group, fileName);

      if (await cacheManager.exists(filePath)) {
        const existing = await cacheManager.readParquet(filePath);
        console.log(`  SKIP ${fileName.padEnd(8)} already cached (${existing.length} candles)`);
        results.success.push(fileName);
        continue;
      }

      process.stdout.write(`  FETCH ${fileName.padEnd(8)} ...`);

      try {
        const candles = await fetchHistory(symbol);
        candles.sort((a, b) => a.time - b.time);
        await cacheManager.writeParquet(filePath, candles);
        const from = new Date(candles[0].time * 1000).toISOString().split('T')[0];
        const to   = new Date(candles[candles.length - 1].time * 1000).toISOString().split('T')[0];
        console.log(` OK  ${candles.length} candles  ${from} to ${to}`);
        results.success.push(fileName);
      } catch (err) {
        console.log(` FAIL  ${err.message}`);
        results.failed.push({ symbol: fileName, reason: err.message });
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  HARVEST COMPLETE');
  console.log(`  Success : ${results.success.length}`);
  console.log(`  Failed  : ${results.failed.length}`);
  if (results.failed.length > 0) {
    results.failed.forEach(f => console.log(`    FAIL ${f.symbol}: ${f.reason}`));
  }
  console.log('═══════════════════════════════════════════════════════\n');

  return results;
}

module.exports = { harvest, fetchHistory, UNIVERSE, FILE_NAME_MAP };

if (require.main === module) {
  harvest().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
