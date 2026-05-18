#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Locks the Spidey candle-ingestion adapter in coreyMarketIntel.js
// (operator brief 2026-05-18). Before this patch, `_fetchSpidey`
// only ever pulled cached 1D candles from corey_history_reader,
// so any symbol without a 1D cache file (USDCHF, AUDJPY, …) caused
// Spidey to return STRUCTURE_PARTIAL no_candles_supplied even
// while the runtime symbol-command + dashboard paths were
// successfully fetching live OHLC via safeOHLC.
//
// The fix is an additive injectable hook: coreyMarketIntel.init({
// candleFetcher }) accepts an async (symbol, resolution, count) →
// candles[] callback that wires into the same live fetch path. The
// adapter falls back to the cached 1D rows when the fetcher is not
// wired or a specific timeframe fails — never the whole bundle.

const path = require('path');
const Module = require('module');

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + JSON.stringify(err).slice(0, 240) : '')); }

// Re-load coreyMarketIntel with module require() hijacked so we
// can stub Spidey + history-reader per test.
const realRequire = Module.prototype.require;
const stubs = {};
Module.prototype.require = function (request) {
  if (request === './spidey' && stubs.spidey) return stubs.spidey;
  if (request === './corey_history_reader' && stubs.historyReader) return stubs.historyReader;
  return realRequire.apply(this, arguments);
};
function loadMI() {
  delete require.cache[require.resolve(path.join(__dirname, '..', 'coreyMarketIntel.js'))];
  return require(path.join(__dirname, '..', 'coreyMarketIntel.js'));
}

const sampleRow = (t, base) => ({ time: t, open: base, high: base + 1, low: base - 1, close: base + 0.5, volume: 1000 });

async function run() {
  console.log('\nT1 — _fetchSpideyTimeframe normalises rows from the injected fetcher:');
  {
    stubs.spidey = { spideyRun: async () => ({ status: 'OK', structureConfidence: 0.8, structureBias: 'BULL' }) };
    stubs.historyReader = { readCandles: () => ({ ok: false, rows: [], errors: ['n/a'] }) };
    const mi = loadMI();
    mi.init({ candleFetcher: async () => [sampleRow(1, 100), sampleRow(2, 101), { open: 'bad' /* dropped */ }] });
    const rows = await mi._fetchSpideyTimeframe('USDCHF', '1day', 5);
    if (Array.isArray(rows) && rows.length === 2 && rows[0].open === 100 && rows[1].close === 101.5) ok('rows are normalised to {time,open,high,low,close,volume}; non-numeric rows dropped');
    else fail('normaliser drift', rows);
  }

  console.log('\nT2 — fetcher absent + cache absent → Spidey called with no candles bundle (honest PARTIAL):');
  {
    const spideyCalls = [];
    stubs.spidey = { spideyRun: async (symbol, opts) => {
      spideyCalls.push({ symbol, opts });
      return { status: 'PARTIAL', reason: 'no_candles_supplied', structureConfidence: 0, structureBias: 'NEUTRAL' };
    } };
    stubs.historyReader = { readCandles: () => ({ ok: false, rows: [], errors: ['cache file missing'], freshness: null }) };
    const mi = loadMI();
    mi.init({}); // no candleFetcher
    const res = await mi._fetchSpidey({ currency: 'CHF' });
    if (res && res.leadSymbol === 'USDCHF') ok('USDCHF resolved from CHF currency lookup (sanity check on _leadSymbolForCcy)');
    else if (res && res.leadSymbol) ok('lead symbol resolved (' + res.leadSymbol + ')');
    else fail('lead symbol lookup failed', res);
    if (spideyCalls.length === 1 && spideyCalls[0].opts.candles == null) ok('Spidey is called with candles=null when both fetcher and cache are absent (preserves honest PARTIAL)');
    else fail('Spidey candle-bundle delivery drifted', { count: spideyCalls.length, candles: spideyCalls[0] && spideyCalls[0].opts.candles });
  }

  console.log('\nT3 — fetcher wired + cache absent → Spidey gets HTF + LTF from the fetcher:');
  {
    const fetcherCalls = [];
    const spideyCalls = [];
    stubs.spidey = { spideyRun: async (symbol, opts) => {
      spideyCalls.push({ symbol, opts });
      return { status: 'ACTIVE', structureConfidence: 0.7, structureBias: 'BULL' };
    } };
    stubs.historyReader = { readCandles: () => ({ ok: false, rows: [], errors: ['cache file missing'] }) };
    const mi = loadMI();
    mi.init({
      candleFetcher: async (symbol, resolution, count) => {
        fetcherCalls.push({ symbol, resolution, count });
        return [sampleRow(1, 100), sampleRow(2, 101), sampleRow(3, 102)];
      },
    });
    await mi._fetchSpidey({ currency: 'CHF' });
    const tfs = fetcherCalls.map(c => c.resolution);
    const expected = ['1week', '1day', '4h', '1h', '15min', '5min'];
    if (expected.every(t => tfs.indexOf(t) !== -1)) ok('fetcher called for every HTF + LTF timeframe (1week / 1day / 4h / 1h / 15min / 5min)');
    else fail('fetcher timeframe coverage drifted', tfs);
    const candles = spideyCalls[0] && spideyCalls[0].opts && spideyCalls[0].opts.candles;
    if (candles && candles.htf && candles.htf['1W'] && candles.htf['1D'] && candles.htf['4H'] && candles.htf['1H']) ok('Spidey received the full HTF stack (1W / 1D / 4H / 1H) from the live fetcher');
    else fail('Spidey did not receive a full HTF stack', candles && candles.htf);
    if (candles && candles.ltf && candles.ltf['15M'] && candles.ltf['5M']) ok('Spidey received the LTF stack (15M / 5M) from the live fetcher');
    else fail('Spidey did not receive an LTF stack', candles && candles.ltf);
  }

  console.log('\nT4 — fetcher absent + cache present → cache 1D rows still surface (backward compat preserved):');
  {
    const spideyCalls = [];
    stubs.spidey = { spideyRun: async (symbol, opts) => {
      spideyCalls.push({ symbol, opts });
      return { status: 'ACTIVE', structureConfidence: 0.6, structureBias: 'BULL' };
    } };
    stubs.historyReader = { readCandles: () => ({ ok: true, rows: [
      { open_time_ms: 1000, open: 1.085, high: 1.090, low: 1.080, close: 1.088, volume: 0 },
      { open_time_ms: 2000, open: 1.088, high: 1.092, low: 1.084, close: 1.090, volume: 0 },
    ], errors: [], freshness: { ok: true } }) };
    const mi = loadMI();
    mi.init({});
    await mi._fetchSpidey({ currency: 'EUR' });
    const candles = spideyCalls[0] && spideyCalls[0].opts && spideyCalls[0].opts.candles;
    if (candles && candles.htf && Array.isArray(candles.htf['1D']) && candles.htf['1D'].length === 2) ok('cached 1D rows still reach Spidey when fetcher not wired (backward compat preserved)');
    else fail('cache fallback path broken', candles && candles.htf);
  }

  console.log('\nT5 — fetcher partially fails → Spidey gets what is available, degrades honestly per-timeframe:');
  {
    const spideyCalls = [];
    stubs.spidey = { spideyRun: async (symbol, opts) => {
      spideyCalls.push({ symbol, opts });
      return { status: 'PARTIAL', structureConfidence: 0.4, structureBias: 'BULL', degradedReason: 'partial_htf_coverage' };
    } };
    stubs.historyReader = { readCandles: () => ({ ok: false, rows: [], errors: ['n/a'] }) };
    const mi = loadMI();
    mi.init({
      candleFetcher: async (symbol, resolution) => {
        // Simulate: only 1day + 1h available, the rest fail.
        if (resolution === '1day' || resolution === '1h') return [sampleRow(1, 100), sampleRow(2, 101)];
        return null;
      },
    });
    await mi._fetchSpidey({ currency: 'CHF' });
    const candles = spideyCalls[0] && spideyCalls[0].opts && spideyCalls[0].opts.candles;
    if (candles && candles.htf && candles.htf['1D'] && candles.htf['1H'] && !candles.htf['1W'] && !candles.htf['4H']) ok('Spidey gets the available timeframes (1D + 1H); missing timeframes are omitted from the bundle (no fake rows)');
    else fail('partial-coverage bundle drift', candles && candles.htf);
    if (candles && candles.ltf && Object.keys(candles.ltf).length === 0) ok('LTF bundle is empty when the fetcher returns null for both LTF timeframes');
    else fail('LTF bundle drift', candles && candles.ltf);
  }

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) { console.error('[SPIDEY-CANDLE-INGESTION] FAIL'); process.exit(1); }
  console.log('[SPIDEY-CANDLE-INGESTION] PASS');
}

run().catch(e => { console.error('[SPIDEY-CANDLE-INGESTION] threw: ' + e.message); process.exit(1); });
