'use strict';
// Macro v3 acceptance harness. Runs offline (no network) when --offline is passed; otherwise
// pulls live coreyLive + coreyCalendar + FMP. Exits non-zero on any §18 acceptance violation.

const path = require('path');
const MACRO_DIR = path.join(__dirname, '..', 'macro');

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const lintOnly = args.includes('--lint');
  const symbols = args.filter(a => !a.startsWith('--'));
  if (!symbols.length) symbols.push('EURUSD');

  const { buildMacroV3, fmpAdapter } = require(MACRO_DIR);
  fmpAdapter.logBootStatus();

  let coreyLive = { getLiveContext: () => ({ status: 'offline-stub', dxy: { score: -0.05, bias: 'Neutral', price: 27.41 }, vix: { score: 0.12, level: 'Normal', price: 22.5 }, yield: { score: 0.20, regime: 'Normal', spread: 0.45 } }) };
  let coreyCalendar = { getCalendarSnapshot: () => ({ events: [], health: { available: false, source_used: null, calendar_mode: 'UNKNOWN' } }), getEventIntelligence: () => null };

  if (!offline) {
    coreyLive = require(path.join(__dirname, '..', 'corey_live_data'));
    coreyCalendar = require(path.join(__dirname, '..', 'corey_calendar'));
    await coreyLive.init();
  }

  for (const symbol of symbols) {
    const ctx = coreyLive.getLiveContext();
    const fmp = await fmpAdapter.enrich(symbol);
    const ac = inferClass(symbol);
    const m = mockStructure(symbol, ac);
    const text = await buildMacroV3({
      symbol,
      ctx,
      structure: m.structure,
      calendar:  { snapshot: coreyCalendar.getCalendarSnapshot(), intel: coreyCalendar.getEventIntelligence(symbol) },
      charts:    { htfGridName: symbol + '_HTF.png', ltfGridName: symbol + '_LTF.png' },
      fmp,
      history:   { recent20: synthRecent20(symbol, m.basePrice) },
      darkHorse: null
    });

    assertContains(text, ['Trade Status / Live Plan', 'Final Assessment', 'Forward Expectation', 'Trigger Map', 'Price Table', 'Roadmap', 'Event Intelligence', 'Market Overview', 'Events / Catalysts', 'Historical Context', 'Execution Logic', 'Validity']);
    assertNotContains(text, ['light participation only', 'WAIT / LIGHT PARTICIPATION ONLY', 'if confirmed', 'signal strength', 'distance context', 'broken level', 'broken support', 'broken resistance', 'Trade permit is available', 'execution conditions are normal', 'matches the macro direction', 'Abstain (0%)']);
    assertSectionOrder(text);
    assertFinalAssessmentInsideLivePlan(text);
    assertSourcesFooter(text);
    assertAssetClassLanguage(text, ac);

    if (!lintOnly) {
      console.log('========== ' + symbol + ' ==========');
      console.log(text);
      console.log('');
    }
  }
  console.log('OK — all acceptance gates passed for: ' + symbols.join(', '));
}

function inferClass(sym) {
  if (!sym) return 'unknown';
  const s = String(sym).toUpperCase();
  if (/^[A-Z]{6}$/.test(s)) return 'fx';
  if (/^(NAS100|US500|US30|DJI|GER40|UK100|SPX|NDX|HK50|JPN225)$/.test(s)) return 'index';
  if (/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s)) return 'commodity';
  if (/^[A-Z]{1,5}$/.test(s)) return 'equity';
  return 'unknown';
}

function mockStructure(symbol, assetClass) {
  if (assetClass === 'fx') {
    return {
      basePrice: 1.0800,
      structure: { assetClass, score: 0.25, bias: 'bullish', conviction: 0.5, trigger: '15M body close above session high with retained demand', entry: 1.0850, entryExtended: 1.0855, stopLoss: 1.0810, targets: [1.0900, 1.0950], flow: 'toward upper liquidity', validityWindow: 'next London session', cancellation: ['15M close below 1.0800'], recentHigh: 1.0900, recentLow: 1.0750, currentPrice: 1.0820, atrPips: 65, movementSeenPips: 22, triggers: { bullish: { tf: '15M', level: '1.07900', close: '15M body close above 1.07900', supply: 'fresh demand zone retained', catalyst: 'no high-impact event inside next 2h', invalidation: '15M close back below 1.07780 within 2 candles' }, bearish: { tf: '15M', level: '1.07550', close: '15M body close below 1.07550', supply: 'fresh supply zone retained', catalyst: 'no high-impact event inside next 2h', invalidation: '15M close back above 1.07700 within 2 candles' }, noTrade: 'Inside 1.07550–1.07900 with no fresh impulse', timeframeNote: '15M aggressive · 1H cleaner' } }
    };
  }
  if (assetClass === 'equity') {
    return {
      basePrice: 92.40,
      structure: { assetClass, score: 0, bias: 'neutral', conviction: 0, trigger: null, entry: null, stopLoss: null, targets: [], flow: 'building toward $94', validityWindow: 'until next 15M close', cancellation: ['15M close > $94.10 reauthorises bullish review'], recentHigh: 94.10, recentLow: 90.20, currentPrice: 92.40, atrDollars: 2.30, movementSeenDollars: 1.60, triggers: { bullish: { tf: '15M', level: '$94.10', close: '15M body close above $94.10', supply: 'fresh demand zone left behind', catalyst: 'no high-impact event inside next 2h', invalidation: '15M close back below $93.20 within 2 candles' }, bearish: { tf: '15M', level: '$90.20', close: '15M body close below $90.20', supply: 'fresh supply zone left behind', catalyst: 'no high-impact event inside next 2h', invalidation: '15M close back above $91.20 within 2 candles' }, noTrade: 'Inside $90.20–$94.10 with no clean displacement', timeframeNote: '15M aggressive · 1H cleaner' } }
    };
  }
  if (assetClass === 'index') {
    return {
      basePrice: 21420,
      structure: { assetClass, score: 0.10, bias: 'neutral', conviction: 0.2, trigger: '1H body close above session high', entry: null, stopLoss: null, targets: [], flow: 'sideways inside range', validityWindow: 'until NY open', cancellation: ['1H close < 21200 reauthorises bearish review'], recentHigh: 21640, recentLow: 21200, currentPrice: 21420, atrDollars: 240, movementSeenDollars: 90, triggers: { bullish: { tf: '1H', level: '21640', close: '1H body close above 21640', supply: 'fresh demand zone retained', catalyst: 'no high-impact event inside next 2h', invalidation: '1H close back below 21520' }, bearish: { tf: '1H', level: '21200', close: '1H body close below 21200', supply: 'fresh supply zone retained', catalyst: 'no high-impact event inside next 2h', invalidation: '1H close back above 21320' }, noTrade: 'Inside 21200–21640 range', timeframeNote: '1H index confirmation' } }
    };
  }
  // commodity
  return {
    basePrice: 1980,
    structure: { assetClass, score: 0.15, bias: 'bullish', conviction: 0.4, trigger: '1H body close above 2000', entry: null, stopLoss: null, targets: [], flow: 'toward upper liquidity', validityWindow: 'until next 1H close', cancellation: ['1H close < 1965'], recentHigh: 2010, recentLow: 1955, currentPrice: 1980, atrDollars: 28, movementSeenDollars: 10, triggers: { bullish: { tf: '1H', level: '2000', close: '1H body close above 2000', supply: 'fresh demand zone retained', catalyst: 'no high-impact event inside next 2h', invalidation: '1H close back below 1985' }, bearish: { tf: '1H', level: '1965', close: '1H body close below 1965', supply: 'fresh supply zone retained', catalyst: 'no high-impact event inside next 2h', invalidation: '1H close back above 1980' }, noTrade: 'Inside 1965–2000 range', timeframeNote: '1H commodity confirmation' } }
  };
}

function synthRecent20(symbol, base) {
  const out = [];
  let p = base != null ? base : 1.0800;
  const step = p > 100 ? p * 0.005 : p > 1 ? p * 0.005 : 0.001;
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 20; i++) {
    const open = p;
    const close = p + (Math.sin(i / 2) * step) + (step * 0.5);
    const high = Math.max(open, close) + step * 0.8;
    const low = Math.min(open, close) - step * 0.8;
    out.push({ time: now - (20 - i) * 86400, open, high, low, close, volume: 0 });
    p = close;
  }
  return out;
}

function assertAssetClassLanguage(t, assetClass) {
  if (assetClass === 'equity' || assetClass === 'index' || assetClass === 'commodity') {
    if (/(\bpip\b|\bpips\b|\bstandard lot\b|\bbase currency\b|\bquote currency\b)/i.test(t)) {
      throw new Error('asset-class language leak: FX-only term in ' + assetClass + ' output');
    }
  }
}

function assertContains(t, parts) {
  for (const p of parts) if (!t.includes(p)) throw new Error('missing section: ' + p);
}
function assertNotContains(t, parts) {
  for (const p of parts) if (t.includes(p)) throw new Error('banned phrase present: ' + p);
}
function assertSectionOrder(t) {
  const order = ['Trade Status / Live Plan', 'Price Table', 'Roadmap', 'Event Intelligence', 'Market Overview', 'Events / Catalysts', 'Historical Context', 'Execution Logic', 'Validity'];
  let pos = 0;
  for (const s of order) {
    const i = t.indexOf(s, pos);
    if (i < 0) throw new Error('out-of-order or missing: ' + s);
    pos = i;
  }
}
function assertFinalAssessmentInsideLivePlan(t) {
  const lp = t.indexOf('Trade Status / Live Plan');
  const fa = t.indexOf('Final Assessment');
  const next = t.indexOf('Price Table');
  if (fa < 0 || fa < lp || fa > next) throw new Error('Final Assessment must live inside Live Plan/Trade Status block');
}
function assertSourcesFooter(t) {
  if (!/\*sources:.*coreyLive=/.test(t)) throw new Error('sources footer missing or malformed');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
