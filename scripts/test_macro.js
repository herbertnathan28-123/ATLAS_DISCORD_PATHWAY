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
    const text = await buildMacroV3({
      symbol,
      ctx,
      structure: { score: 0.25, bias: 'bullish', conviction: 0.5, trigger: '15m close above session high', entry: 1.0850, entryExtended: 1.0855, stopLoss: 1.0810, targets: [1.0900, 1.0950], flow: 'toward upper liquidity', validityWindow: 'next London session', cancellation: ['15m close below 1.0800'], recentHigh: 1.0900, recentLow: 1.0750 },
      calendar:  { snapshot: coreyCalendar.getCalendarSnapshot(), intel: coreyCalendar.getEventIntelligence(symbol) },
      charts:    { htfGridName: symbol + '_HTF.png', ltfGridName: symbol + '_LTF.png' },
      fmp,
      history:   { recent20: synthRecent20(symbol) },
      darkHorse: null
    });

    assertContains(text, ['Trade Status / Live Plan', 'Final Assessment', 'Price Table', 'Roadmap', 'Event Intelligence', 'Market Overview', 'Events / Catalysts', 'Historical Context', 'Execution Logic', 'Validity']);
    assertNotContains(text, ['light participation only', 'WAIT / LIGHT PARTICIPATION ONLY', 'if confirmed', 'signal strength']);
    assertSectionOrder(text);
    assertFinalAssessmentInsideLivePlan(text);
    assertSourcesFooter(text);

    if (!lintOnly) {
      console.log('========== ' + symbol + ' ==========');
      console.log(text);
      console.log('');
    }
  }
  console.log('OK — all acceptance gates passed for: ' + symbols.join(', '));
}

function synthRecent20(symbol) {
  const out = [];
  let p = 1.0800;
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 20; i++) {
    const open = p;
    const close = p + (Math.sin(i / 2) * 0.0010) + 0.0005;
    const high = Math.max(open, close) + 0.0008;
    const low = Math.min(open, close) - 0.0008;
    out.push({ time: now - (20 - i) * 86400, open, high, low, close, volume: 0 });
    p = close;
  }
  return out;
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
