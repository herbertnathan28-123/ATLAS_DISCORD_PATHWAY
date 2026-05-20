#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const path = require('path');
const fs = require('fs');
const engine = require(path.join(__dirname, '..', 'darkHorseEngine'));
const rank = require(path.join(__dirname, '..', 'darkHorseRanking'));
const macroInterpreter = require(path.join(__dirname, '..', 'macro', 'interpretCalendarEvents'))._private;

let passed = 0, failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (info ? ' :: ' + JSON.stringify(info).slice(0, 300) : '')); }
}

function mkCandidate(symbol, score, opts) {
  opts = opts || {};
  return {
    symbol,
    score,
    technicalScore: opts.technicalScore == null ? score : opts.technicalScore,
    boostScore: opts.boostScore == null ? score : opts.boostScore,
    direction: opts.direction || 'Bullish',
    summary: opts.summary || 'fixture pressure building',
    reasons: opts.reasons || ['structure and momentum developing'],
    boostMetrics: {
      percentMove: opts.percentMove == null ? 4.2 : opts.percentMove,
      atrRelativeMove: opts.atrRelativeMove == null ? 1.1 : opts.atrRelativeMove,
      volumeRelative: opts.volumeRelative == null ? 1.8 : opts.volumeRelative,
      speedOfMove: opts.speedOfMove == null ? 1.4 : opts.speedOfMove,
    },
    status: score >= 8 ? 'WATCH' : score >= 5 ? 'INTERNAL' : 'IGNORED',
  };
}

(async () => {
  console.log('\nT1 - dynamic mover candidates enter the Dark Horse universe:');
  const universe = await engine.buildDynamicDarkHorseUniverse({
    staticUniverse: ['EURUSD', 'GOOGL'],
    liveMovers: [
      { symbol: 'ALAB', source: 'fmp', listType: 'top_gainers', changesPercentage: 13.3, volume: 9000000 },
      { symbol: 'CLSK', source: 'fmp', listType: 'unusual_volume', changesPercentage: 9.3, volume: 12000000 },
      { symbol: 'BTCUSD', source: 'fmp', listType: 'top_gainers', changesPercentage: 20 },
    ],
    enableLiveMovers: false,
  });
  ok('static ATLAS symbols are retained', universe.symbols.includes('EURUSD') && universe.symbols.includes('GOOGL'), universe.symbols);
  ok('live mover symbols are added', universe.symbols.includes('ALAB') && universe.symbols.includes('CLSK'), universe.symbols);
  ok('crypto movers are rejected before universe assembly', !universe.symbols.includes('BTCUSD'), universe.symbols);
  ok('source/provenance exposes provider status', /injected:ok/.test(universe.sourceProvenance.map(s => s.provider + ':' + s.status).join('|')), universe.sourceProvenance);

  console.log('\nT2 - top movers are not discarded before ranking:');
  const watch = [];
  const internal = [mkCandidate('GOOGL', 5, { percentMove: 2.4 })];
  const ignored = [
    mkCandidate('ALAB', 4, { boostScore: 8, percentMove: 13.3, status: 'IGNORED' }),
    mkCandidate('SLOW', 2, { boostScore: 1, percentMove: 0.2, status: 'IGNORED' }),
  ];
  const rankable = engine.rankableScanCandidates(watch, internal, ignored);
  ok('high-momentum ignored mover remains rankable/building', rankable.some(c => c.symbol === 'ALAB'), rankable.map(c => c.symbol));
  ok('low movement ignored candidate stays out of ranker', !rankable.some(c => c.symbol === 'SLOW'), rankable.map(c => c.symbol));
  const ranking = await rank.buildRanking(rankable, async () => [], { topN: 10, watchThreshold: 8 });
  ok('ranker allCount reflects true funnel survivors', ranking.allCount === 2, ranking);
  const logLines = [];
  rank.emitRankingLogs(ranking, line => logLines.push(line));
  ok('DH-RANKING universe_size reports funnel survivors, not full scan size', logLines.some(l => /\[DH-RANKING\] universe_size=2/.test(l)), logLines);
  const oneRanking = await rank.buildRanking([internal[0]], async () => [], { topN: 10, watchThreshold: 8 });
  const oneLogs = [];
  rank.emitRankingLogs(oneRanking, line => oneLogs.push(line));
  ok('universe_size=1 only when exactly one candidate passed the funnel', oneLogs.some(l => /universe_size=1/.test(l)), oneLogs);

  console.log('\nT3 - funnel counts reconcile visibly:');
  const funnel = engine.buildScanFunnel(
    ['GOOGL', 'ALAB', 'SLOW', 'FAIL'],
    [internal[0], ignored[0], ignored[1]],
    [{ symbol: 'FAIL', reason: 'source_failure' }],
    watch,
    internal,
    ignored,
    universe
  );
  ok('WATCH + INTERNAL + IGNORED + failed equals total considered', funnel.reconcile.ok && funnel.reconcile.total === funnel.reconcile.expected, funnel.reconcile);
  ok('rejected-by-reason summary includes movement threshold and source failure', funnel.rejectedSummary.movement_threshold === 2 && funnel.rejectedSummary.source_failure === 1, funnel.rejectedSummary);
  ok('top rejected-but-building candidates are exposed', funnel.topRejectedBuilding.some(c => c.symbol === 'ALAB'), funnel.topRejectedBuilding);

  console.log('\nT4 - WATCH 0 output renders required quiet intelligence sections:');
  const payload = rank.buildRankedMovementDigestPayload(
    Object.assign(ranking, { funnel, sourceProvenance: universe.sourceProvenance }),
    { level: 'elevated', vixLevel: 'Elevated' },
    {
      now: Date.parse('2026-05-20T05:07:00Z'),
      universeSize: funnel.totalConsidered,
      internal,
      ignored,
      funnel,
      sourceProvenance: universe.sourceProvenance,
    }
  );
  const content = payload.content || '';
  [
    'CURRENT MARKET SNAPSHOT',
    'MARKET CONDITIONS',
    'MARKET READ NOW',
    'PRE-RADAR / BUILDING',
    'WHY NO FULL STANDOUT',
    'PROMOTION TRIGGERS',
    'REJECTED/FUNNEL SUMMARY',
    'SOURCE / PROVENANCE',
  ].forEach(section => ok('quiet output includes ' + section, content.includes(section)));
  ok('quiet output explains why no full standout instead of generic zero line', /No candidate cleared WATCH threshold|top candidates require structure/.test(content), content.slice(0, 600));
  ok('source/provenance is shown', /Source: .*injected:ok/.test(content), content.match(/Source:[^\n]+/));
  ok('FOH output does not leak raw ETF proxy labels', !/DXY=UUP-proxy|VIX=VXX-proxy/.test(content), content.match(/proxy/g));

  console.log('\nT5 - Spidey observability logs are wired at route level:');
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  ok('boot loaded log exists', /\[SPIDEY\] boot=loaded/.test(indexSource));
  ok('analyse route invocation log exists', /route=analyse symbol=\$\{symbol\} invoked=true source=OHLC/.test(indexSource));
  ok('HTF/LTF/final marketStructureStatus logs exist', /HTF result=.*marketStructureStatus/.test(indexSource) && /LTF result=.*final marketStructureStatus/.test(indexSource));
  ok('skipped reason log exists', /skipped reason=insufficient_ohlc/.test(indexSource));

  console.log('\nT6 - affected-market explanations are symbol-specific, not repeated boilerplate:');
  const affected = macroInterpreter.buildAffectedMarketsExpanded(['USDCAD', 'CADJPY', 'EURCAD', 'GBPCAD', 'AUDCAD', 'NZDCAD'], 'Canada CPI');
  const mechanisms = affected.map(x => x.transmissionMechanism);
  ok('all CAD-cross mechanisms are unique', new Set(mechanisms).size === mechanisms.length, mechanisms);
  ok('generic relative-rate boilerplate is absent for CAD crosses', !mechanisms.some(m => /^Moves through relative rate expectations/.test(m)), mechanisms);

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) { console.error('[DARK-HORSE-MARKET-MOVERS-BOOST-DETECTOR] FAIL'); process.exit(1); }
  console.log('[DARK-HORSE-MARKET-MOVERS-BOOST-DETECTOR] PASS');
})().catch(e => {
  console.error('FATAL ' + e.message);
  console.error(e.stack);
  process.exit(2);
});
