'use strict';
// scripts/test_dh_v11.js — acceptance harness for Dark Horse v1.1.
// Tests the new intelligence module + verifies the rendered movement
// digest + watch payload meet every clause of the v1.1 spec.

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const intel = require('../darkHorseIntelligence');

let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { console.log('✓ ' + name); pass++; }
  else      { console.log('✗ ' + name + (info ? ' :: ' + info : '')); fail++; }
}

// ─── Section classification ─────────────────────────────────────────────
ok('AMD → EQUITY',          intel.classifySection('AMD').key      === intel.SECTION_KEYS.EQUITY);
ok('NAS100 → INDEX',        intel.classifySection('NAS100').key   === intel.SECTION_KEYS.INDEX);
ok('JPN225 → INDEX',        intel.classifySection('JPN225').key   === intel.SECTION_KEYS.INDEX);
ok('AUS200 → INDEX',        intel.classifySection('AUS200').key   === intel.SECTION_KEYS.INDEX);
ok('XAUUSD → COMMODITY',    intel.classifySection('XAUUSD').key   === intel.SECTION_KEYS.COMMODITY);
ok('EURUSD → FX_MAJOR',     intel.classifySection('EURUSD').key   === intel.SECTION_KEYS.FX_MAJOR);
ok('AUDJPY → FX_CROSS',     intel.classifySection('AUDJPY').key   === intel.SECTION_KEYS.FX_CROSS);
ok('XAUUSD safe-haven',     intel.isSafeHaven('XAUUSD'));
ok('USDJPY safe-haven',     intel.isSafeHaven('USDJPY'));
ok('AMD not safe-haven',   !intel.isSafeHaven('AMD'));

// ─── Move tracking + age labels ─────────────────────────────────────────
intel._resetDirectionStore();
ok('moveAge unavailable on first scan',  intel.getMoveAgeMs('AMD', 'Bullish') === null);
intel.trackDirection('AMD', 'Bullish');
ok('moveAge tracked after first call',   intel.getMoveAgeMs('AMD', 'Bullish') !== null);
intel.trackDirection('AMD', 'Bearish');
ok('direction flip resets age',           intel.getMoveAgeMs('AMD', 'Bullish') === null);
ok('moveAgeLabel unavailable',            intel.moveAgeLabel(null) === 'unavailable');
ok('moveAgeLabel ~5m',                    intel.moveAgeLabel(5 * 60 * 1000) === '~5m');
ok('moveAgeLabel ~1h 30m',                intel.moveAgeLabel(90 * 60 * 1000) === '~1h 30m');
ok('moveAgeLabel ~3h',                    intel.moveAgeLabel(180 * 60 * 1000) === '~3h');

// ─── Phase classification ─────────────────────────────────────────────
ok('phase early < 30m',          intel.classifyMovePhase({ ageMs: 10 * 60 * 1000 }) === 'early');
ok('phase developing 60m',       intel.classifyMovePhase({ ageMs: 60 * 60 * 1000 }) === 'developing');
ok('phase mid_move 120m',        intel.classifyMovePhase({ ageMs: 120 * 60 * 1000 }) === 'mid_move');
ok('phase late 240m',            intel.classifyMovePhase({ ageMs: 240 * 60 * 1000 }) === 'late');
ok('phase fallback developing',  intel.classifyMovePhase({ ageMs: null, score: 5, struct: { score: 1 }, mom: { score: 2 }, cont: { score: 1 } }) === 'developing');

// ─── Late-entry risk + continuation ─────────────────────────────────────
ok('lateEntryRisk late=high',     intel.lateEntryRisk({ phase: 'late', score: 6, struct: { score: 2 } }) === 'high');
ok('lateEntryRisk mid_move=mod',  intel.lateEntryRisk({ phase: 'mid_move', score: 6, struct: { score: 2 } }) === 'moderate');
ok('lateEntryRisk early=low',     intel.lateEntryRisk({ phase: 'early', score: 4, struct: { score: 0 } }) === 'low');
ok('continuation high',           intel.continuationProbability({ phase: 'developing', score: 9, struct: { score: 2 }, cont: { score: 2 } }) === 'high');
ok('continuation low when late',  intel.continuationProbability({ phase: 'late', score: 8 }) === 'low');

// ─── Structure state ─────────────────────────────────────────────────
ok('struct confirmed',    intel.structureState({ struct: { score: 2 }, brk: { score: 2 }, score: 8 }) === 'confirmed');
ok('struct confirming',   intel.structureState({ struct: { score: 2 }, brk: { score: 1 }, score: 7 }) === 'confirming');
ok('struct building',     intel.structureState({ struct: { score: 1 }, brk: { score: 0 }, score: 4 }) === 'building');
ok('struct not_confirmed',intel.structureState({ struct: { score: 0 }, brk: { score: 0 }, score: 5 }) === 'not_confirmed');

ok('confirmation tf — equity',  intel.confirmationTimeframe(intel.SECTION_KEYS.EQUITY)   === '5m/15m');
ok('confirmation tf — index',   intel.confirmationTimeframe(intel.SECTION_KEYS.INDEX)    === '5m/15m');
ok('confirmation tf — fx',      intel.confirmationTimeframe(intel.SECTION_KEYS.FX_MAJOR) === '15m/30m');

const conf = intel.confirmationRequirement({ direction: 'Bullish', sectionKey: intel.SECTION_KEYS.EQUITY, struct: { score: 1 }, brk: { score: 0 } });
ok('confirmation requirement detail', /candle close above .* hold\/retest/i.test(conf), conf);
const inv = intel.invalidationCondition({ direction: 'Bullish' });
ok('invalidation detail bullish',     /higher-low|sharp rejection/i.test(inv), inv);

// ─── Cause hypothesis ────────────────────────────────────────────────
const causeNoCorey = intel.buildCauseHypothesis({ symbol: 'AMD', sectionKey: intel.SECTION_KEYS.EQUITY, direction: 'Bullish', corey: null });
ok('cause no corey → unavailable', causeNoCorey.causeConfidence === 'unavailable');
ok('cause no corey is technical text', /technical\/flow-driven|no confirmed event link/i.test(causeNoCorey.cause));

const causeRiskOn = intel.buildCauseHypothesis({
  symbol: 'AMD', sectionKey: intel.SECTION_KEYS.EQUITY, direction: 'Bullish',
  corey: { internalMacro: { global: { riskEnv: 'RiskOn', live: { dxy: { price: 104.2 } } }, regime: { regime: 'Growth' } } }
});
ok('cause risk-on equity → moderate or higher', /moderate|high/.test(causeRiskOn.causeConfidence), causeRiskOn.causeConfidence);
ok('cause text mentions risk-on', /risk-?on/i.test(causeRiskOn.cause));

const causeXauRiskOff = intel.buildCauseHypothesis({
  symbol: 'XAUUSD', sectionKey: intel.SECTION_KEYS.COMMODITY, direction: 'Bullish',
  corey: { internalMacro: { global: { riskEnv: 'RiskOff' }, regime: { regime: 'Crisis' } } }
});
ok('cause XAU risk-off → moderate', causeXauRiskOff.causeConfidence === 'moderate', causeXauRiskOff.causeConfidence);
ok('cause XAU mentions safety', /safety|inflation/i.test(causeXauRiskOff.cause));

const causeCalendar = intel.buildCauseHypothesis({
  symbol: 'EURUSD', sectionKey: intel.SECTION_KEYS.FX_MAJOR, direction: 'Bearish',
  corey: { calendar: { intel: 'NFP — high impact — 1.5h from now' } }
});
ok('cause with calendar → high', causeCalendar.causeConfidence === 'high');
ok('cause includes calendar text', /Calendar event in window/i.test(causeCalendar.cause));

// ─── Score breakdown ────────────────────────────────────────────────
const sb = intel.buildScoreBreakdown({
  struct: { score: 2 }, mom: { score: 1 }, brk: { score: 0 }, clean: { score: 1 }, cont: { score: 1 },
  phase: 'mid_move', score: 5, lateRisk: 'high'
});
ok('breakdown momentum=5/10 (1×5)',         sb.momentum === 5);
ok('breakdown structure=10/10 (2×5)',       sb.structure === 10);
ok('breakdown lateEntryPenalty=-2 (high)',  sb.lateEntryPenalty === -2);

// ─── Enrich + rank with section caps ─────────────────────────────────
intel._resetDirectionStore();
function fakeOHLC(n, dir, body = 1) {
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p, c = dir === 'Bullish' ? p + body : p - body;
    out.push({ open: o, close: c, high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5 });
    p = c;
  }
  return out;
}
function fakeCandidate(sym, score, dir) {
  return {
    candidate: { symbol: sym, score, direction: dir },
    htf: fakeOHLC(50, dir, 2),
    ltf: fakeOHLC(50, dir, 1),
    components: { struct: { score: 2 }, mom: { score: 1 }, brk: { score: 0 }, clean: { score: 1 }, cont: { score: 1 } },
    corey: null,
    watchThreshold: 8
  };
}
const enriched = [
  fakeCandidate('AMD',    7, 'Bullish'),
  fakeCandidate('NVDA',   6, 'Bullish'),
  fakeCandidate('GOOGL',  6, 'Bullish'),
  fakeCandidate('AAPL',   5, 'Bullish'),  // 4th equity → should be capped
  fakeCandidate('NAS100', 6, 'Bullish'),
  fakeCandidate('US500',  5, 'Bullish'),
  fakeCandidate('XAUUSD', 6, 'Bullish'),
  fakeCandidate('EURUSD', 5, 'Bearish'),
  fakeCandidate('USDJPY', 4, 'Bullish'),
  fakeCandidate('AUDJPY', 4, 'Bullish'),
  fakeCandidate('GBPJPY', 3, 'Bullish')
].map(intel.enrichCandidate);

const ranked = intel.rankWithSectionCaps(enriched, { max: 10, capPerSection: 3 });
ok('rank top10 size',                 ranked.top.length === 10);
ok('AMD ranked first',                ranked.top[0].symbol === 'AMD');
const equityCount = ranked.top.filter(c => c.sectionKey === intel.SECTION_KEYS.EQUITY).length;
ok('section cap ≤ 3 (equity)',        equityCount <= 3, `equityCount=${equityCount}`);
ok('section_caps_applied=true',       ranked.sectionCapsApplied === true);

// Each top-3 candidate must have whyFlagged + structure + confirmation
for (const c of ranked.top.slice(0, 3)) {
  ok(`${c.symbol} has whyFlagged`,            !!c.whyFlagged);
  ok(`${c.symbol} has structureStateLabel`,   !!c.structureStateLabel);
  ok(`${c.symbol} has confirmationRequirement`, !!c.confirmationRequirement);
  ok(`${c.symbol} has invalidationCondition`,  !!c.invalidationCondition);
  ok(`${c.symbol} has estimatedTriggerWindow`, !!c.estimatedTriggerWindow);
  ok(`${c.symbol} has movePhaseLabel`,         !!c.movePhaseLabel);
  ok(`${c.symbol} has lateEntryRisk`,          !!c.lateEntryRisk);
  ok(`${c.symbol} has whyNotWatch[]`,          Array.isArray(c.whyNotWatch) && c.whyNotWatch.length > 0);
  ok(`${c.symbol} has promotionTrigger`,       !!c.promotionTrigger);
  ok(`${c.symbol} has causeConfidence`,        ['low','moderate','high','unavailable'].includes(c.causeConfidence));
}

// ─── v1.1 movement digest payload ────────────────────────────────────
const digest = intel.buildMovementDigestV11({
  ranked,
  volatility: { level: 'elevated', internalCount: 5, watchCount: 0, vixLevel: 'Elevated' },
  corey: null,
  calendarHealth: { source_used: 'tradingview' }
});
ok('digest kind v1_1',                          digest.kind === 'movement_digest_v1_1');
ok('digest contains GLOBAL MOVEMENT ACTIVE',     /GLOBAL MOVEMENT ACTIVE/.test(digest.content));
ok('digest contains Top global movers',          /Top global movers/.test(digest.content));
ok('digest contains Market map',                 /Market map/.test(digest.content));
ok('digest contains regime line',                /Global regime/.test(digest.content));
ok('digest contains expanded #1 with structure', /1\. \*\*AMD\*\*/.test(digest.content) && /Structure:/.test(digest.content));
ok('digest contains compact line for #4..',      /^4\. \*\*/m.test(digest.content));
ok('digest contains causeConfidence',            /causeConfidence:/.test(digest.content));
ok('digest contains Confirmation: per top-3',    (digest.content.match(/Confirmation:/g) || []).length >= 3);
ok('digest contains "Wait for the listed structure confirmation"', /Wait for the listed structure confirmation/.test(digest.content));
ok('digest mentions Corey → Spidey → Jane',      /Corey → Spidey → Jane/.test(digest.content));
ok('digest no banned wording',                   !/authoris|permission|permitted/i.test(digest.content));

// ─── v1.1 WATCH payload ──────────────────────────────────────────────
const watch = intel.buildWatchV11({ candidate: ranked.top[0], ranked, corey: null });
ok('watch kind v1_1',                  watch.kind === 'watch_v1_1');
ok('watch contains DARK HORSE — WATCH', /DARK HORSE — WATCH/.test(watch.content));
ok('watch has Move age',                /Move age:/.test(watch.content));
ok('watch has Continuation window',     /Continuation window:/.test(watch.content));
ok('watch has Structure confirmation',  /Structure confirmation:/.test(watch.content));
ok('watch has Invalidation',            /Invalidation:/.test(watch.content));
ok('watch has Late-entry risk',         /Late-entry risk:/.test(watch.content));
ok('watch has Macro / Event context',   /Macro \/ Event context:/.test(watch.content));
ok('watch ATLAS state escalates',       /Escalate to Jane/.test(watch.content));
ok('watch is not an entry call',        /WATCH is not an entry call/.test(watch.content));
ok('watch no banned wording',           !/authoris|permission|permitted/i.test(watch.content));

// ─── Summary ────────────────────────────────────────────────────────
console.log('');
console.log('==========================');
console.log(`${pass}/${pass + fail} acceptance checks passed`);
process.exit(fail ? 1 : 0);
