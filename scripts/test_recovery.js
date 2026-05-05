'use strict';
// scripts/test_recovery.js — acceptance harness for the FULL RECOVERY
// BUILD ORDER pass. Tests the new modules in isolation and asserts:
//
//   A. Per-resolution TD index probe + [SYMBOL-MAP] candidate logging
//   B. FMP cooldown logic (402 + 429)
//   C. DATA-SOURCE per-resolution coverage rendering
//   D. Spidey OK / PARTIAL / UNAVAILABLE classification
//   E. Banned wording remap
//   F. Advisory header sections present + ordered
//   G. INCOREGO IN/CO/RE/GO + Corey impact + Clone explicit state
//   H. Spidey structure swings/BOS/pullback/invalidation + partial messaging

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const { createCoverage, formatOhlcCoverage, formatDataSourceLine } = require('../macro/dataCoverage');
const { buildIncorego, renderIncoregoForDiscord } = require('../macro/incorego');
const advisoryWording = require('../macro/advisoryWording');
const { buildAdvisoryHeader } = require('../macro/advisoryHeader');
const { buildSpideyStructure } = require('../macro/spideyStructure');

let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { console.log('✓ ' + name); pass++; }
  else      { console.log('✗ ' + name + (info ? ' :: ' + info : '')); fail++; }
}

// ─── (C) DATA-SOURCE coverage rendering ─────────────────────────────────
{
  const cov = createCoverage('US500');
  cov.record('1W', 'twelvedata',   100, null, 'SPY');
  cov.record('1D', 'twelvedata',   200, null, 'SPY');
  cov.record('240','none',           0, 'td=blank | fmp_status=in-cooldown-402');
  cov.record('60', 'fmp-fallback', 200, null);
  cov.record('30', 'none',           0, 'td=Data not found | fmp=premium 402');
  cov.record('15', 'none',           0, 'td=Data not found | fmp=premium 402');
  cov.record('5',  'fmp-fallback', 150, null);
  cov.record('1',  'twelvedata',   150, null, 'SPY');
  const summary = cov.summarise();
  ok('(C) coverage state == PARTIAL', summary.state === 'PARTIAL', JSON.stringify(summary));
  const ohlc = formatOhlcCoverage(cov);
  ok('(C) ohlc line tags PARTIAL', /^ohlc=PARTIAL/.test(ohlc), ohlc);
  ok('(C) ohlc line shows SPY candidate', /1W:twelvedata\(SPY\)/.test(ohlc), ohlc);
  ok('(C) ohlc line shows fmp-fallback', /60:fmp-fallback/.test(ohlc), ohlc);
  ok('(C) ohlc line shows none for 30/15/240', /30:none/.test(ohlc) && /15:none/.test(ohlc) && /240:none/.test(ohlc), ohlc);

  const line = formatDataSourceLine('US500', cov, {
    quote: 'twelvedata-quote', fundamentals: 'unavailable', calendar: 'tradingview',
    historical: '15Y-cache', corey: 'OK', coreyClone: 'unavailable: not implemented',
    spidey: 'PARTIAL:missing=240,30,15', jane: 'final'
  });
  ok('(C) DATA-SOURCE line is single-line', !line.includes('\n'));
  ok('(C) DATA-SOURCE line tags spidey=PARTIAL', /spidey=PARTIAL/.test(line), line);
  ok('(C) DATA-SOURCE line tags clone explicit', /coreyClone=unavailable: not implemented/.test(line), line);
}

// ─── (D) Spidey state from coverage ─────────────────────────────────────
{
  const covOk = createCoverage('AMD');
  for (const r of ['1W','1D','240','60','30','15','5','1']) covOk.record(r, 'twelvedata', 200, null, 'AMD');
  ok('(D) spideyState OK when all timeframes loaded', covOk.spideyState().state === 'OK');

  const covPartial = createCoverage('US500');
  for (const r of ['1W','1D','60'])     covPartial.record(r, 'twelvedata', 200, null, 'SPY');
  for (const r of ['240','30','15'])    covPartial.record(r, 'none',         0, 'td=blank');
  for (const r of ['5','1'])            covPartial.record(r, 'fmp-fallback',150, null);
  const sp = covPartial.spideyState();
  ok('(D) spideyState PARTIAL when timeframes missing', sp.state === 'PARTIAL', JSON.stringify(sp));
  ok('(D) spideyState reports missing timeframes',     sp.reason && sp.reason.includes('240'), JSON.stringify(sp));

  const covDead = createCoverage('FOO');
  for (const r of ['1W','1D','240','60','30','15','5','1']) covDead.record(r, 'none', 0, 'td=fail');
  ok('(D) spideyState UNAVAILABLE when nothing loads', covDead.spideyState().state === 'UNAVAILABLE');
}

// ─── (E) Banned wording remap ───────────────────────────────────────────
{
  const cases = [
    ['WAIT — NO TRADE',                    'HOLD — BIAS STILL FORMING'],
    ['No entry authorised',                'No active trade signal yet'],
    ['Trade permit is BLOCKED',            'Trade is on HOLD'],
    ['Not authorised',                     'Not yet defined'],
    ['live order permitted',               'live entry condition supported'],
    ['entry can be authorised',            'entry condition can develop'],
    ['ENTRY AUTHORISED',                   'ENTRY TRIGGERED'],
    ['ENTRY NOT AUTHORISED',               'ENTRY NOT ADVISED'],
    ['Trade permit is AVAILABLE',          'Entry conditions are supported'],
  ];
  for (const [input, expected] of cases) {
    const out = advisoryWording.remapAdvisoryWording(input);
    ok(`(E) "${input}" -> "${expected}"`, out.includes(expected), `actual: ${out}`);
  }
  const banned = ['WAIT — NO TRADE', 'No entry authorised', 'authorised', 'permission'];
  for (const b of banned) {
    const remapped = advisoryWording.remapAdvisoryWording(b);
    const sweep = advisoryWording.filterBannedFromText(remapped);
    ok(`(E) banned text "${b}" cleared after remap`, sweep.ok, `hits: ${sweep.hits.join(', ')}`);
  }
  // Action-state mapping
  ok('(E) advisoryActionState WAIT->HOLD', advisoryWording.advisoryActionState('WAIT — NO TRADE') === 'HOLD — BIAS STILL FORMING');
  ok('(E) advisoryActionState ARMED preserved', advisoryWording.advisoryActionState('ARMED — WAITING FOR TRIGGER') === 'ARMED — WAITING FOR TRIGGER');
  ok('(E) advisoryActionState DECISION WITHHELD', advisoryWording.advisoryActionState('Withheld — source incomplete') === 'DECISION WITHHELD — SOURCE INCOMPLETE');
  // Trade probability scale
  ok('(E) tradeProbability(conviction=0.85)==5', advisoryWording.tradeProbability1to5({ conviction: 0.85 }) === 5);
  ok('(E) tradeProbability(conviction=0.45)==3', advisoryWording.tradeProbability1to5({ conviction: 0.45 }) === 3);
  ok('(E) tradeProbability(doNotTrade)==1',     advisoryWording.tradeProbability1to5({ doNotTrade: true, conviction: 0.85 }) === 1);
  // Confidence label
  ok('(E) marketConfidenceLabel(0.7)==High',     advisoryWording.marketConfidenceLabel(0.7) === 'High');
  ok('(E) marketConfidenceLabel(0.5)==Medium',   advisoryWording.marketConfidenceLabel(0.5) === 'Medium');
  ok('(E) marketConfidenceLabel(0.2)==Low',      advisoryWording.marketConfidenceLabel(0.2) === 'Low');
}

// ─── (G) INCOREGO + Corey impact + Clone state ──────────────────────────
{
  const corey = {
    combinedBias: 'Bullish', combinedScore: 0.42, confidence: 0.55,
    internalMacro: {
      assetClass: 'index',
      regime: { regime: 'GROWTH' },
      global: { dxyBias: 'Bullish', dxyScore: 0.21, riskEnv: 'RISK_ON', riskScore: 0.28, live: { dxy: { price: 104.2 }, vix: { price: 17.2 }, yield: { spread: -22 } } },
      sector: { sector: 'Index', score: 0.18 }
    },
    live: { dxy: { price: 104.2 }, vix: { price: 17.2 }, yield: { spread: -22 } },
    sector: { sector: 'Index', score: 0.18 }
  };
  const jane = { finalBias: 'Bullish', conviction: 0.55, tradeProbability: 4 };

  const block = buildIncorego({ symbol: 'US500', corey, jane });
  ok('(G) INCOREGO has IN/CO/RE/GO buckets', block.incorego.IN && block.incorego.CO && block.incorego.RE && block.incorego.GO, JSON.stringify(block.incorego));
  ok('(G) coreyStatus is OK or PARTIAL when corey present', block.coreyStatus !== 'UNAVAILABLE', block.coreyStatus);
  ok('(G) coreyEffectOnJaneProbability is supports/weakens/caps/neutral', /^(supports|weakens|caps|neutral)$/.test(block.coreyEffectOnJaneProbability));
  ok('(G) coreyClone defaults to UNAVAILABLE / not implemented', block.coreyClone.status === 'UNAVAILABLE' && /not implemented/i.test(block.coreyClone.note));

  const text = renderIncoregoForDiscord({ symbol: 'US500', incoregoBlock: block, jane, tradeProbability: 4 });
  ok('(G) INCOREGO render contains COREY READ heading',  /COREY READ — US500/.test(text), text.slice(0,160));
  ok('(G) INCOREGO render contains COREY IMPACT ON JANE', /COREY IMPACT ON JANE/.test(text));
  ok('(G) INCOREGO render contains COREY CLONE',          /COREY CLONE/.test(text));
  ok('(G) INCOREGO render mentions IN/CO/RE/GO',          /\*\*IN\*\*/.test(text) && /\*\*CO\*\*/.test(text) && /\*\*RE\*\*/.test(text) && /\*\*GO\*\*/.test(text));
  ok('(G) INCOREGO render contains "no contribution implied"', /no contribution implied/i.test(text), text);

  // Cosmetic-OK guard: corey present but no contribution / no macro fields
  const block2 = buildIncorego({ symbol: 'NVDA', corey: { combinedBias: 'Bullish' }, jane: { finalBias: 'Bullish', conviction: 0.5 } });
  ok('(G) cosmetic-OK guard: PARTIAL when contribution thin', block2.coreyStatus === 'PARTIAL', block2.coreyStatus);

  // No corey at all -> UNAVAILABLE
  const block3 = buildIncorego({ symbol: 'NVDA', corey: null, jane: { finalBias: 'Neutral' } });
  ok('(G) no Corey -> UNAVAILABLE', block3.coreyStatus === 'UNAVAILABLE');

  // Clone explicit ACTIVE w/ contribution
  const block4 = buildIncorego({ symbol: 'AMD', corey: {
    combinedBias: 'Neutral',
    internalMacro: { assetClass: 'equity', global: { dxyBias: 'Neutral', riskEnv: 'NEUTRAL', live: { dxy: { price: 100 }, vix: { price: 14 } } } },
    clone: { source: 'live', contribution: { summary: 'Clone confirms Corey read.', contradictions: 'none', missingDrivers: 'none', eventRisk: 'none', analogue: 'n=8 cycles 2024', sourceConfidence: 'high' } }
  }, jane: {} });
  ok('(G) Clone ACTIVE w/ contribution', block4.coreyClone.status === 'OK' && block4.coreyClone.contribution && /confirms/i.test(block4.coreyClone.contribution.summary || ''));
}

// ─── (H) Spidey structured output + partial messaging ───────────────────
{
  const htf = {
    dominantBias: 'Bullish', dominantConviction: 0.55,
    timeframes: {
      '1W': { structure: 'Trending', bias: 'Bullish', swingHighs: [{ level: 100, time: 1700000000 }], swingLows: [{ level: 80, time: 1690000000 }], lastBreak: 'BOS', breakDirection: 'Bullish', breakLevel: 99 },
      '1D': { structure: 'Trending', bias: 'Bullish', swingHighs: [{ level: 95, time: 1715000000 }], swingLows: [{ level: 85, time: 1700000000 }], lastBreak: 'BOS', breakDirection: 'Bullish', breakLevel: 94 },
      '60': { structure: 'Transition', bias: 'Bullish', swingHighs: [{ level: 92, time: 1717000000 }], swingLows: [{ level: 88, time: 1716000000 }], lastBreak: 'None' }
    }
  };
  const ltf = {
    dominantBias: 'Bullish', dominantConviction: 0.50,
    timeframes: {
      '15': { structure: 'Range', bias: 'Bullish', swingHighs: [{ level: 91, time: 1717010000 }], swingLows: [{ level: 89, time: 1717005000 }], lastBreak: 'None', activeDemand: { high: 88.5, low: 87.5, time: 1717004000 } }
    }
  };
  const cov = createCoverage('AMD');
  for (const r of ['1W','1D','60','15']) cov.record(r, 'twelvedata', 200, null, 'AMD');
  for (const r of ['240','30','5','1']) cov.record(r, 'none', 0, 'td=Data not found');
  const sp = buildSpideyStructure({ symbol: 'AMD', htf, ltf, coverage: cov });
  ok('(H) Spidey state PARTIAL with missing timeframes', sp.state === 'PARTIAL', sp.state + ' / ' + sp.reason);
  ok('(H) Spidey gives prevSwingHigh',  !!sp.prevSwingHigh && sp.prevSwingHigh.price === 92);
  ok('(H) Spidey gives bullishBOS',     !!sp.bullishBOS && sp.bullishBOS.price);
  ok('(H) Spidey gives bodyCloseRequirement', /body close/i.test(sp.bodyCloseRequirement));
  ok('(H) Spidey gives wickNotEnough',  /wick/i.test(sp.wickNotEnough));
  ok('(H) Spidey gives pullbackLevel',  !!sp.pullbackLevel);
  ok('(H) Spidey gives invalidationReference', !!sp.invalidationReference);

  const text = sp.renderForDiscord();
  ok('(H) Spidey renderForDiscord shows state line',                /state: PARTIAL/.test(text), text.slice(0,200));
  ok('(H) Spidey render shows STRUCTURE READ PARTIAL banner',       /STRUCTURE READ PARTIAL/.test(text));
  ok('(H) Spidey render shows previous swing HIGH/LOW lines',       /Previous swing HIGH/.test(text) && /Previous swing LOW/.test(text));
  ok('(H) Spidey render shows BOS reference',                       /BOS reference/.test(text));
  ok('(H) Spidey render shows body-close + wick-not-enough rules',  /Body-close rule/.test(text) && /Wick-not-enough/.test(text));

  // UNAVAILABLE case
  const covDead = createCoverage('FOO');
  for (const r of ['1W','1D','240','60','30','15','5','1']) covDead.record(r, 'none', 0, 'td=fail');
  const sp2 = buildSpideyStructure({ symbol: 'FOO', htf: { timeframes: {} }, ltf: { timeframes: {} }, coverage: covDead });
  ok('(H) Spidey UNAVAILABLE -> structured banner',                 /STRUCTURE READ UNAVAILABLE/.test(sp2.renderForDiscord()));
}

// ─── (F) Advisory header section order ──────────────────────────────────
{
  const cov = createCoverage('AMD');
  for (const r of ['1W','1D','240','60','30','15','5','1']) cov.record(r, 'twelvedata', 200, null, 'AMD');
  const corey = { combinedBias: 'Bullish', combinedScore: 0.4, confidence: 0.55, internalMacro: { regime: { regime: 'GROWTH' }, global: { dxyBias: 'Bullish', riskEnv: 'RISK_ON', live: {} } } };
  const jane = { finalBias: 'Bullish', conviction: 0.55, tradeProbability: 4, biasMomentum: 'Building', actionState: 'ARMED — WAITING FOR TRIGGER' };
  const incoregoBlock = buildIncorego({ symbol: 'AMD', corey, jane });
  const header = buildAdvisoryHeader({ symbol: 'AMD', jane, corey, htf: { dominantBias: 'Bullish', dominantConviction: 0.6, timeframes: { '60': { swingHighs: [{ level: 100 }], swingLows: [{ level: 80 }] } } }, ltf: { dominantBias: 'Bullish', dominantConviction: 0.5, timeframes: {} }, candlesByTf: { '60': [{ close: 92.4 }] }, incoregoBlock, dataCoverage: cov });
  // Ordered sections 1..12 must appear in order.
  const order = ['1. Current Price', '2. Time', '3. Bias Direction', '4. Bias Momentum', '5. Trade Probability', '6. Market Confidence', '7. Key Reference Levels', '8. Market Read', '9. Forward Watch', '10. What Improves Probability', '11. What Weakens', '12. Next Reassessment'];
  let lastIdx = -1;
  for (const tag of order) {
    const idx = header.indexOf(tag);
    ok(`(F) advisory header contains "${tag}"`, idx > -1);
    if (idx > -1) {
      ok(`(F) "${tag}" appears in correct order`, idx > lastIdx, `lastIdx=${lastIdx} idx=${idx}`);
      lastIdx = idx;
    }
  }
  ok('(F) header carries banned-wording-free copy', advisoryWording.filterBannedFromText(header).ok);
}

// ─── (E2) Key-name remap — packet keys cannot leak banned tokens ───────
{
  // Simulate the packet structure that previously leaked "permission" via
  // the `tradePermission` key.
  const sim = {
    actionState: 'HOLD — BIAS STILL FORMING',
    tradeStatus: 'No active trade signal yet',
    tradePermission: 'No active trade signal yet',     // legacy key — must be renamed
    decisionFields: {
      tradePermission: 'No active trade signal yet',   // nested legacy key
      permission: 'OPEN',                              // ad-hoc banned key
      permitLabel: 'No active trade signal yet'        // banned key
    }
  };
  function deepRemap(node) {
    if (typeof node === 'string') return advisoryWording.remapAdvisoryWording(node);
    if (Array.isArray(node))      return node.map(deepRemap);
    if (node && typeof node === 'object') {
      const out = {};
      for (const k of Object.keys(node)) out[advisoryWording.remapKeyName(k)] = deepRemap(node[k]);
      return out;
    }
    return node;
  }
  const remapped = deepRemap(sim);
  const sweep = advisoryWording.filterBannedFromText(JSON.stringify(remapped));
  ok('(E2) packet-key remap produces banned-token-free JSON', sweep.ok, `hits: ${sweep.hits.join(', ')}`);
  ok('(E2) tradePermission key renamed to tradeStatus',         remapped.tradeStatus && !('tradePermission' in remapped));
  ok('(E2) nested decisionFields.tradePermission renamed',      remapped.decisionFields.tradeStatus && !('tradePermission' in remapped.decisionFields));
  ok('(E2) ad-hoc decisionFields.permission renamed',           remapped.decisionFields.advisoryState != null && !('permission' in remapped.decisionFields));
  ok('(E2) decisionFields.permitLabel renamed',                 remapped.decisionFields.advisoryStateLabel != null && !('permitLabel' in remapped.decisionFields));
}

// ─── (E3) Source-text scrub — eventIntelligence + glossary + triggerMap ─
{
  // The three known string-literal sources that previously emitted
  // "permission" / "Permission verdict" must produce banned-token-free output.
  const ei  = require('../macro/eventIntelligence');
  const gl  = require('../macro/glossary');
  const tm  = require('../macro/triggerMap');
  const sweep = advisoryWording.filterBannedFromText.bind(advisoryWording);

  const eiOut = ei.build({ calendar: { intel: 'NFP — 1.5h from now' }, ctx: { dxy:{score:0,bias:'Neutral'}, vix:{score:0,level:'Normal'}, yield:{score:0,regime:'Normal'} }, fmp: null, symbol: 'AMD', tagsUsed: [] });
  ok('(E3) eventIntelligence output banned-token-free', sweep(eiOut).ok, `hits: ${sweep(eiOut).hits.join(', ')}`);
  ok('(E3) eventIntelligence emits "Advisory state:" (no longer "Permission verdict:")', /Advisory state:/.test(eiOut) && !/Permission verdict/i.test(eiOut));

  const trigText = gl.TERMS.trigger;
  ok('(E3) glossary trigger entry banned-token-free', sweep(trigText).ok, `text: ${trigText}`);
  ok('(E3) glossary trigger says "activates entry conditions"', /activates entry conditions/.test(trigText));

  const tmOut = tm.build({ jane: { triggerMap: { bullish: { tf: '15M', level: '94.10', close: '15M close > 94.10', invalidation: '15M close < 93.20' }, bearish: { tf: '15M', level: '90.20', close: '15M close < 90.20', invalidation: '15M close > 91.20' } } } });
  ok('(E3) triggerMap output banned-token-free', sweep(tmOut).ok, `hits: ${sweep(tmOut).hits.join(', ')}`);
}

// ─── Summary ────────────────────────────────────────────────────────────
console.log('');
console.log('==========================');
console.log(`${pass}/${pass+fail} acceptance checks passed`);
process.exit(fail ? 1 : 0);
