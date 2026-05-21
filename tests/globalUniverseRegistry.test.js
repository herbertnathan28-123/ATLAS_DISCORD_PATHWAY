#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const registry = require(path.join(__dirname, '..', 'globalUniverseRegistry'));
const engine = require(path.join(__dirname, '..', 'darkHorseEngine'));
const ranking = require(path.join(__dirname, '..', 'darkHorseRanking'));
const foh = require(path.join(__dirname, '..', 'darkHorseFohFormatter'));
const fohV6 = require(path.join(__dirname, '..', 'darkHorseFoh'));

let passed = 0;
let failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (info ? ' :: ' + JSON.stringify(info).slice(0, 500) : '')); }
}

function mkCandidate(symbol, score, marketGroup) {
  return {
    symbol,
    score,
    direction: 'Bullish',
    summary: 'fixture movement building',
    reasons: ['fixture structure aligned'],
    marketGroup,
    marketGroupLabel: registry.GROUP_LABELS[marketGroup] || marketGroup,
  };
}

(async () => {
  console.log('\nT1 - registry loads and crypto remains excluded');
  const rows = registry.getRegistry();
  ok('registry has enabled entries', rows.length > 50, { count: rows.length });
  ok('registry records carry required provider maps', rows.every(r => r.canonical_symbol && r.display_symbol && r.asset_class && r.market_group && r.region && r.provider_symbol_map && r.provider_priority && r.scan_mode && r.coverage_status), rows[0]);
  ok('provider map supports TwelveData/FMP/EODHD/Yahoo/internal static', rows.some(r => r.provider_symbol_map.twelvedata !== undefined && r.provider_symbol_map.fmp !== undefined && r.provider_symbol_map.eodhd !== undefined && r.provider_symbol_map.yahoo !== undefined && r.provider_symbol_map.internal_static !== undefined));
  ok('crypto symbols are not in registry', !rows.some(r => /BTC|ETH|SOL|DOGE|CRYPTO/.test(r.canonical_symbol)), rows.filter(r => /BTC|ETH/.test(r.canonical_symbol)));

  console.log('\nT2 - old 37-symbol universe remains static fallback only');
  const staticCore = registry.getStaticCoreSymbols();
  ok('static core has 37 symbols', staticCore.length === 37, staticCore.length);
  ok('DH_UNIVERSE exports the same static fallback core', JSON.stringify(engine.DH_UNIVERSE) === JSON.stringify(staticCore));
  const fullUniverse = await engine.buildDynamicDarkHorseUniverse({ enableLiveMovers: false });
  ok('registry-backed default scan is larger than static fallback', fullUniverse.symbols.length > staticCore.length, { total: fullUniverse.symbols.length, static: staticCore.length });
  ok('static fallback is labelled static_core, not full universe', staticCore.every(s => {
    const rec = registry.getRegistryRecord(s);
    return rec && rec.scan_mode === registry.SCAN_MODE.STATIC_CORE;
  }));

  console.log('\nT3 - dynamic US movers enter through provider feed');
  const movers = await engine.buildDynamicDarkHorseUniverse({
    staticUniverse: ['EURUSD'],
    liveMovers: [
      { symbol: 'UAL', changesPercentage: 12.1, volume: 4500000 },
      { symbol: 'SMCI', changesPercentage: 10.2, volume: 5200000 },
      { symbol: 'ARM', changesPercentage: 8.4, volume: 3900000 },
    ],
    enableLiveMovers: false,
  });
  ok('UAL/SMCI/ARM were added from dynamic feed', ['UAL','SMCI','ARM'].every(s => movers.symbols.includes(s)), movers.symbols);
  ok('dynamic movers are tagged as US equities', ['UAL','SMCI','ARM'].every(s => movers.symbolMetaBySymbol[s].marketGroup === registry.MARKET_GROUPS.US_EQUITIES), movers.symbolMetaBySymbol);

  console.log('\nT4 - ASX movers are honestly unsupported until routing is wired');
  const asx = await engine.buildDynamicDarkHorseUniverse({
    staticUniverse: ['EURUSD'],
    liveMovers: [{ symbol: 'BHP.AX', exchange: 'ASX', changesPercentage: 5.8, volume: 5000000 }],
    enableLiveMovers: false,
  });
  ok('ASX dynamic symbol is not silently converted into a US ticker', !asx.symbols.includes('BHPAX'), asx.symbols);
  ok('ASX unsupported is disclosed', asx.unsupported.some(u => u.marketGroup === registry.MARKET_GROUPS.ASX_EQUITIES), asx.unsupported);

  console.log('\nT5 - duplicates are removed');
  const dupes = await engine.buildDynamicDarkHorseUniverse({
    staticUniverse: ['EURUSD'],
    liveMovers: [{ symbol: 'EURUSD', changesPercentage: 4.4, volume: 1000000 }],
    enableLiveMovers: false,
  });
  ok('duplicate static/dynamic symbol appears once', dupes.symbols.filter(s => s === 'EURUSD').length === 1, dupes.symbols);
  ok('duplicate removal count is visible', dupes.duplicatesRemoved >= 1, dupes.duplicatesRemoved);

  console.log('\nT6 - category caps enforce best two per market group');
  const ranked = await ranking.buildRanking([
    mkCandidate('UAL', 9, registry.MARKET_GROUPS.US_EQUITIES),
    mkCandidate('SMCI', 8, registry.MARKET_GROUPS.US_EQUITIES),
    mkCandidate('ARM', 7, registry.MARKET_GROUPS.US_EQUITIES),
    mkCandidate('EURUSD', 8, registry.MARKET_GROUPS.FX_MAJORS),
  ], async () => [], { topN: 10, sectionCap: 2, sectionCapMax: 3, watchThreshold: 8 });
  const usCount = ranked.top10.filter(r => r.marketGroup === registry.MARKET_GROUPS.US_EQUITIES).length;
  ok('only two US_EQUITIES candidates display', usCount === 2, ranked.top10.map(r => r.symbol + ':' + r.marketGroup));

  console.log('\nT7 - provider failure does not crash universe assembly');
  const failedProvider = await engine.buildDynamicDarkHorseUniverse({
    staticUniverse: ['EURUSD'],
    liveMoversProvider: async () => { throw new Error('fixture provider down'); },
  });
  ok('failed provider is recorded, scan universe still exists', failedProvider.symbols.includes('EURUSD') && failedProvider.sourceProvenance.some(p => p.provider === 'custom' && p.status === 'failed'), failedProvider.sourceProvenance);

  console.log('\nT8 - scan transparency logs expose intended/scanned/failed/unsupported');
  const funnel = engine.buildScanFunnel(
    ['EURUSD', 'UAL', 'FAIL'],
    [mkCandidate('EURUSD', 4, registry.MARKET_GROUPS.FX_MAJORS), mkCandidate('UAL', 5, registry.MARKET_GROUPS.US_EQUITIES)],
    [{ symbol: 'FAIL', reason: 'source_failure', marketGroup: registry.MARKET_GROUPS.ASX_EQUITIES }],
    [],
    [mkCandidate('UAL', 5, registry.MARKET_GROUPS.US_EQUITIES)],
    [mkCandidate('EURUSD', 4, registry.MARKET_GROUPS.FX_MAJORS)],
    movers
  );
  const universeLine = engine.formatUniverseLogLine(movers);
  const coverageLines = engine.formatCoverageLogLines(funnel.categoryCounts);
  const funnelLine = engine.formatFunnelLogLine(funnel);
  ok('DH-UNIVERSE log has intended/enabled/supported/static/movers/total/duplicates', /\[DH-UNIVERSE\] intended=\d+ enabled=\d+ supported=\d+ static=\d+ movers=\d+ total=\d+ duplicates_removed=\d+/.test(universeLine), universeLine);
  ok('DH-COVERAGE log has group intended scanned failed unsupported', coverageLines.some(l => /\[DH-COVERAGE\] group=ASX_EQUITIES intended=\d+ scanned=\d+ failed=\d+ unsupported=\d+/.test(l)), coverageLines);
  ok('DH-FUNNEL log has considered/fetched/source_failed/unsupported/internal/watch', /\[DH-FUNNEL\] considered=\d+ fetched=\d+ source_failed=\d+ unsupported=\d+ .* internal=\d+ watch=\d+/.test(funnelLine), funnelLine);

  console.log('\nT9 - Dark Horse output avoids global/full coverage claims when partial');
  const payload = foh.buildFohMovementDigestPayload(
    Object.assign(ranked, { funnel, sourceProvenance: movers.sourceProvenance, scanTransparency: funnel.scanTransparency }),
    { level: 'elevated', vixLevel: 'Elevated' },
    {
      now: Date.parse('2026-05-21T10:07:00Z'),
      universeSize: funnel.totalConsidered,
      internal: [mkCandidate('UAL', 5, registry.MARKET_GROUPS.US_EQUITIES)],
      ignored: [mkCandidate('EURUSD', 4, registry.MARKET_GROUPS.FX_MAJORS)],
      funnel,
      sourceProvenance: movers.sourceProvenance,
      scanTransparency: funnel.scanTransparency,
    }
  );
  const content = payload.content || '';
  ok('scan transparency section renders', content.includes('SCAN TRANSPARENCY') && content.includes('Coverage state:'));
  ok('partial coverage is not described as global/full coverage', !/global coverage|full coverage/i.test(content), content.match(/coverage[^\n]+/ig));
  const v6Payload = fohV6.buildDarkHorseFohPayload(
    Object.assign(ranked, { scanTransparency: funnel.scanTransparency }),
    { level: 'elevated', vixLevel: 'Elevated' },
    { now: Date.parse('2026-05-21T10:07:00Z'), universeSize: funnel.totalConsidered, scanTransparency: funnel.scanTransparency }
  );
  const joinedV6 = v6Payload.messages.map(m => m.content || '').join('\n');
  ok('live FOH v6 switches away from global banner when coverage is partial', /REGISTRY MOVER RADAR/.test(joinedV6) && !/GLOBAL MOVER RADAR/.test(joinedV6), joinedV6.slice(0, 500));
  ok('live FOH v6 carries scan transparency tail', /Scan transparency/.test(joinedV6) && /Coverage state:/.test(joinedV6), joinedV6.slice(-800));

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) { console.error('[GLOBAL-UNIVERSE-REGISTRY] FAIL'); process.exit(1); }
  console.log('[GLOBAL-UNIVERSE-REGISTRY] PASS');
})().catch(e => {
  console.error('FATAL ' + e.message);
  console.error(e.stack);
  process.exit(2);
});
