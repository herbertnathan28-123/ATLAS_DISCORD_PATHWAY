'use strict';

/**
 * ATLAS FX — Corey Historical Cache Harvester
 * Phase 1: 1D candles, 15-year backfill
 * Source: TradingView Ultimate (authenticated via TV_COOKIES)
 * Storage: Render persistent disk → /data/historical/
 *
 * Groups:
 *   FX         → /data/historical/fx/
 *   Stocks     → /data/historical/stocks/
 *   Commodities→ /data/historical/commodities/
 *
 * Run once to build. cacheUpdater.js handles all forward appends.
 */

const { chromium } = require('playwright');
const path          = require('path');
const cacheManager  = require('./cacheManager');

// ─── Symbol Universe ──────────────────────────────────────────────────────────

const UNIVERSE = {
  fx: [
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
    'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY',
  ],
  stocks: [
    'NVDA', 'AAPL', 'MSFT', 'AMD', 'TSLA',
    'GOOGL', 'META', 'ASML', 'AVGO', 'SMCI',
  ],
  commodities: [
    'XAUUSD', 'XAGUSD', 'USOIL', 'UKOIL',
  ],
};

// TradingView symbol overrides (TV uses different tickers for some)
const TV_SYMBOL_MAP = {
  USOIL:  'NYMEX:CL1!',
  UKOIL:  'ICEEUR:B1!',
  XAUUSD: 'OANDA:XAUUSD',
  XAGUSD: 'OANDA:XAGUSD',
  EURUSD: 'OANDA:EURUSD',
  GBPUSD: 'OANDA:GBPUSD',
  USDJPY: 'OANDA:USDJPY',
  AUDUSD: 'OANDA:AUDUSD',
  USDCAD: 'OANDA:USDCAD',
  USDCHF: 'OANDA:USDCHF',
  NZDUSD: 'OANDA:NZDUSD',
  EURGBP: 'OANDA:EURGBP',
  EURJPY: 'OANDA:EURJPY',
  GBPJPY: 'OANDA:GBPJPY',
};

const TIMEFRAME   = '1D';
const YEARS_BACK  = 15;
const CANDLE_LIMIT = YEARS_BACK * 365; // ~5475 for 1D

// ─── Cookie Helpers ───────────────────────────────────────────────────────────

function loadCookies() {
  const raw = process.env.TV_COOKIES;
  if (!raw) throw new Error('TV_COOKIES env var not set. Export JSON from Cookie-Editor.');
  let cookies;
  try {
    cookies = JSON.parse(raw);
  } catch {
    throw new Error('TV_COOKIES is not valid JSON.');
  }
  // Sanitise sameSite values for Playwright
  return cookies.map(c => ({
    ...c,
    sameSite: c.sameSite === 'unspecified' ? 'Lax'
            : c.sameSite === 'no_restriction' ? 'None'
            : c.sameSite || 'Lax',
  }));
}

// ─── TradingView Data Fetch ───────────────────────────────────────────────────

/**
 * Fetches historical OHLCV for one symbol via TradingView's internal REST API.
 * Uses an authenticated Playwright context so the Ultimate plan data is accessible.
 *
 * Returns array of { time, open, high, low, close, volume }
 */
async function fetchTVHistory(browser, rawSymbol) {
  const tvSymbol = TV_SYMBOL_MAP[rawSymbol] || rawSymbol;
  const context  = await browser.newContext();

  try {
    // Inject auth cookies
    await context.addCookies(loadCookies());

    const page = await context.newPage();

    // Intercept TradingView history API calls
    const candles = [];
    let   resolved = false;

    await page.route('**/history**', async route => {
      const url = route.request().url();
      if (!url.includes('symbol=')) return route.continue();

      const response = await route.fetch();
      try {
        const json = await response.json();
        if (json && json.s === 'ok' && Array.isArray(json.t)) {
          for (let i = 0; i < json.t.length; i++) {
            candles.push({
              time:   json.t[i],
              open:   json.o[i],
              high:   json.h[i],
              low:    json.l[i],
              close:  json.c[i],
              volume: json.v ? json.v[i] : 0,
            });
          }
          resolved = true;
        }
      } catch { /* non-JSON route, ignore */ }

      await route.fulfill({ response });
    });

    // Navigate to TradingView chart for this symbol + timeframe
    const encodedSymbol = encodeURIComponent(tvSymbol);
    const chartUrl = `https://www.tradingview.com/chart/?symbol=${encodedSymbol}&interval=${TIMEFRAME}`;
    await page.goto(chartUrl, { waitUntil: 'networkidle', timeout: 60_000 });

    // Allow up to 20s for history API response to be intercepted
    const deadline = Date.now() + 20_000;
    while (!resolved && Date.now() < deadline) {
      await page.waitForTimeout(500);
    }

    if (candles.length === 0) {
      // Fallback: try TradingView's undocumented REST endpoint directly
      const sessionCookies = await context.cookies('https://www.tradingview.com');
      const sessionId = sessionCookies.find(c => c.name === 'sessionid')?.value;
      if (sessionId) {
        const apiCandles = await fetchTVRestAPI(page, tvSymbol, sessionId);
        candles.push(...apiCandles);
      }
    }

    await page.close();
    return candles;

  } finally {
    await context.close();
  }
}

/**
 * Fallback: TradingView REST history endpoint
 * Requires valid sessionid cookie from authenticated session
 */
async function fetchTVRestAPI(page, tvSymbol, sessionId) {
  const to   = Math.floor(Date.now() / 1000);
  const from = to - (YEARS_BACK * 365 * 24 * 3600);

  const url = `https://symbol-history.tradingview.com/history` +
    `?symbol=${encodeURIComponent(tvSymbol)}` +
    `&resolution=D` +
    `&from=${from}` +
    `&to=${to}` +
    `&countback=${CANDLE_LIMIT}`;

  try {
    const result = await page.evaluate(async ({ url, sessionId }) => {
      const res = await fetch(url, {
        headers: {
          'Cookie': `sessionid=${sessionId}`,
          'Origin': 'https://www.tradingview.com',
          'Referer': 'https://www.tradingview.com/',
        },
        credentials: 'include',
      });
      return res.json();
    }, { url, sessionId });

    if (result && result.s === 'ok' && Array.isArray(result.t)) {
      const candles = [];
      for (let i = 0; i < result.t.length; i++) {
        candles.push({
          time:   result.t[i],
          open:   result.o[i],
          high:   result.h[i],
          low:    result.l[i],
          close:  result.c[i],
          volume: result.v ? result.v[i] : 0,
        });
      }
      return candles;
    }
  } catch (err) {
    console.warn(`  [REST fallback failed] ${tvSymbol}: ${err.message}`);
  }
  return [];
}

// ─── Main Harvester ───────────────────────────────────────────────────────────

async function harvest() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ATLAS FX — Corey Historical Cache Builder');
  console.log('  Phase 1: 1D × 15 years');
  console.log('═══════════════════════════════════════════════════════\n');

  // Ensure storage directories exist
  await cacheManager.initDirectories();

  // Disk check
  const diskOk = await cacheManager.checkDisk();
  if (!diskOk) {
    console.error('❌  /data/historical/ not accessible.');
    console.error('    → Provision Render persistent disk mounted at /data');
    console.error('    → Then re-run this harvester.');
    process.exit(1);
  }

  // Launch browser once, reuse across all symbols
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = { success: [], failed: [] };

  for (const [group, symbols] of Object.entries(UNIVERSE)) {
    console.log(`\n── Group: ${group.toUpperCase()} ─────────────────────────────`);

    for (const symbol of symbols) {
      const filePath = cacheManager.getFilePath(group, symbol);

      // Skip if already cached (resume-safe)
      if (await cacheManager.exists(filePath)) {
        const existing = await cacheManager.readParquet(filePath);
        console.log(`  ✓ ${symbol.padEnd(8)} already cached (${existing.length} candles) — skipping`);
        results.success.push(symbol);
        continue;
      }

      process.stdout.write(`  ↓ ${symbol.padEnd(8)} fetching...`);

      try {
        const candles = await fetchTVHistory(browser, symbol);

        if (candles.length === 0) {
          console.log(` ❌  no data returned`);
          results.failed.push({ symbol, reason: 'empty response' });
          continue;
        }

        // Sort ascending by time (TradingView may return mixed order)
        candles.sort((a, b) => a.time - b.time);

        await cacheManager.writeParquet(filePath, candles);
        console.log(` ✓  ${candles.length} candles → ${filePath}`);
        results.success.push(symbol);

      } catch (err) {
        console.log(` ❌  ${err.message}`);
        results.failed.push({ symbol, reason: err.message });
      }

      // Cooldown between symbols to avoid rate limiting
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  await browser.close();

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  HARVEST COMPLETE');
  console.log(`  ✓ Success : ${results.success.length}`);
  console.log(`  ❌ Failed  : ${results.failed.length}`);
  if (results.failed.length > 0) {
    console.log('\n  Failed symbols:');
    results.failed.forEach(f => console.log(`    - ${f.symbol}: ${f.reason}`));
  }
  console.log('═══════════════════════════════════════════════════════\n');

  return results;
}

module.exports = { harvest, fetchTVHistory, UNIVERSE };

// ─── Direct run ───────────────────────────────────────────────────────────────
if (require.main === module) {
  harvest().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
