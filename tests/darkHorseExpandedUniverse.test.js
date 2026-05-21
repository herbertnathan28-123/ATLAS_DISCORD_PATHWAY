#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const universe = require(path.join(__dirname, '..', 'darkHorseUniverse'));
const engine = require(path.join(__dirname, '..', 'darkHorseEngine'));
const rank = require(path.join(__dirname, '..', 'darkHorseRanking'));

let passed = 0;
let failed = 0;
function ok(label, condition, info) {
  if (condition) {
    passed++;
    console.log('  OK ' + label);
  } else {
    failed++;
    console.error('  FAIL ' + label + (info ? ' :: ' + JSON.stringify(info).slice(0, 500) : ''));
  }
}

function candles(days, start, drift, lastJumpPct) {
  const out = [];
  let close = start;
  const base = Date.UTC(new Date().getUTCFullYear(), 0, 2) / 1000;
  for (let i = 0; i < days; i++) {
    const prev = close;
    close = close * (1 + drift);
    if (i === days - 1 && Number.isFinite(lastJumpPct)) close = prev * (1 + lastJumpPct / 100);
    out.push({
      time: base + i * 86400,
      open: prev,
      high: Math.max(prev, close) * 1.002,
      low: Math.min(prev, close) * 0.998,
      close,
      volume: 1000000 + i,
    });
  }
  return out;
}

function candidate(symbol, score, opts) {
  opts = opts || {};
  return {
    symbol,
    score,
    direction: opts.direction || 'Bullish',
    summary: opts.summary || 'fixture structure confirmed',
    reasons: opts.reasons || ['fixture momentum and structure'],
    boostMetrics: {
      percentMove: opts.percentMove == null ? 4.2 : opts.percentMove,
      atrRelativeMove: opts.atrRelativeMove == null ? 1.2 : opts.atrRelativeMove,
      volumeRelative: opts.volumeRelative == null ? 1.4 : opts.volumeRelative,
      speedOfMove: opts.speedOfMove == null ? 1.3 : opts.speedOfMove,
    },
    currentPrice: opts.currentPrice,
  };
}

(async () => {
  console.log('\nT1 - expanded universe registry is complete:');
  ok('30 approved symbols are registered', universe.DH_EXPANDED_UNIVERSE.length === 30, { count: universe.DH_EXPANDED_UNIVERSE.length });
  ok('15 approved categories are registered', universe.DH_CATEGORY_ORDER.length === 15, universe.DH_CATEGORY_ORDER);
  ok('each category has exactly two registered symbols', universe.DH_CATEGORY_ORDER.every(cat => universe.DH_EXPANDED_UNIVERSE.filter(r => r.category === cat).length === 2));
  ok('crypto remains absent', !universe.DH_EXPANDED_UNIVERSE.some(r => /BTC|ETH|CRYPTO/i.test(r.symbol + ' ' + r.name)));

  console.log('\nT2 - EODHD dotted tickers normalize to canonical scanner symbols:');
  ok('BHP.AU normalizes to BHP', engine.normaliseDHSymbol('BHP.AU') === 'BHP');
  ok('EURUSD.FOREX normalizes to EURUSD', engine.normaliseDHSymbol('EURUSD.FOREX') === 'EURUSD');
  ok('HG.COMM normalizes to COPPER', engine.normaliseDHSymbol('HG.COMM') === 'COPPER');
  ok('XPTUSD.FOREX normalizes to XPTUSD', engine.normaliseDHSymbol('XPTUSD.FOREX') === 'XPTUSD');
  ok('BRENT is not in the approved Dark Horse universe', !engine.DH_UNIVERSE.includes('BRENT'), engine.DH_UNIVERSE);

  console.log('\nT3 - context-only macro instruments cannot become tradeable calls:');
  const uupGate = engine.passesUniverseMetadataFilter('UUP', universe.getBySymbol('UUP'), { now: Date.parse('2026-05-21T15:00:00Z') });
  const vixyGate = engine.passesUniverseMetadataFilter('VIXY', universe.getBySymbol('VIXY'), { now: Date.parse('2026-05-21T15:00:00Z') });
  ok('UUP is rejected as context-only', !uupGate.ok && uupGate.reason === 'context_only_not_tradeable', uupGate);
  ok('VIXY is rejected as context-only', !vixyGate.ok && vixyGate.reason === 'context_only_not_tradeable', vixyGate);

  console.log('\nT4 - dynamic universe keeps metadata and canonical symbols:');
  const dynamic = await engine.buildDynamicDarkHorseUniverse({
    staticUniverse: ['NVDA.US', 'BHP.AU', 'HG.COMM', 'UUP.US'],
    enableLiveMovers: false,
  });
  ok('dynamic symbols are canonicalized', ['NVDA', 'BHP', 'COPPER', 'UUP'].every(s => dynamic.symbols.includes(s)), dynamic.symbols);
  ok('metadata includes EODHD tickers', dynamic.metadataBySymbol.BHP.eodhdTicker === 'BHP.AU' && dynamic.metadataBySymbol.COPPER.eodhdTicker === 'HG.COMM', dynamic.metadataBySymbol);
  ok('context symbols are tracked separately', dynamic.contextSymbols.includes('UUP'), dynamic.contextSymbols);

  console.log('\nT5 - ranking emits category top-two and temperature/growth metrics:');
  const candleMap = {
    NVDA: candles(80, 100, 0.001, 4.2),
    AAPL: candles(80, 180, 0.0008, 1.2),
    UCO: candles(80, 25, 0.0005, 1.5),
  };
  const ranking = await rank.buildRanking([
    candidate('NVDA', 9, { percentMove: 4.2 }),
    candidate('AAPL', 7, { percentMove: 1.2 }),
    candidate('UCO', 7, { percentMove: 1.5 }),
  ], async sym => candleMap[sym] || [], {
    topN: 10,
    sectionCap: 2,
    watchThreshold: 8,
    marketMoodLevel: 'quiet',
  });
  const nvda = ranking.top10.find(r => r.symbol === 'NVDA');
  const uco = ranking.top10.find(r => r.symbol === 'UCO');
  ok('NVDA is classified into US Large Cap', nvda && nvda.section === universe.DH_CATEGORY.US_LARGE_CAP, nvda);
  ok('US Large Cap category returns top two entries', (ranking.categoryTop2[universe.DH_CATEGORY.US_LARGE_CAP] || []).length === 2, ranking.categoryTop2);
  ok('NVDA receives ON FIRE marker with growth data', nvda && nvda.temperatureMarker.code === 'on_fire' && Number.isFinite(nvda.moveMetrics.growth30D), nvda);
  ok('UCO carries amplified instrument disclosure', uco && uco.amplifiedInstrument && /Amplified instrument/.test(uco.riskDisclosure), uco);

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) {
    console.error('[DARK-HORSE-EXPANDED-UNIVERSE] FAIL');
    process.exit(1);
  }
  console.log('[DARK-HORSE-EXPANDED-UNIVERSE] PASS');
})().catch(e => {
  console.error('FATAL ' + e.message);
  console.error(e.stack);
  process.exit(2);
});
