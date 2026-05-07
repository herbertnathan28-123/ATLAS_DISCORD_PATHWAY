'use strict';

/**
 * Corey — current macro / regime / event authority.
 * Wraps existing corey_calendar.js and corey_live_data.js into the locked
 * CoreyOutput contract. Original files are NOT modified.
 */

let calendar = null;
let liveData = null;
try { calendar = require('./corey_calendar'); } catch (e) { /* loaded lazily; report in evidence */ }
try { liveData = require('./corey_live_data'); } catch (e) { /* same */ }

let initialised = false;

async function ensureInit(testMode) {
  if (initialised) return;
  if (testMode) { initialised = true; return; }
  try { if (calendar && typeof calendar.init === 'function') await calendar.init(); } catch (e) { /* defer to evidence */ }
  try { if (liveData && typeof liveData.init === 'function') await liveData.init(); } catch (e) { /* same */ }
  initialised = true;
}

async function coreyRun(symbol, opts = {}) {
  const testMode = opts.testMode || process.env.ATLAS_TEST_MODE === '1';
  const timestamp = new Date().toISOString();

  if (testMode) {
    return {
      authority: 'current_macro_regime_event',
      score: 0.5,
      confidence: 0.5,
      evidence: [{ type: 'test_mode_stub', symbol }],
      riskModifiers: [],
      timeframeRelevance: 'session',
      symbol,
      timestamp,
      _testModeShortCircuit: true,
    };
  }

  await ensureInit(false);

  // Defensive aggregation — every call wrapped, never throws upward
  let live = null, events = [], bias = null, intel = null, snapshot = null;
  try { if (liveData && liveData.getMarketContext) live = await liveData.getMarketContext(symbol); } catch (e) { /* swallow */ }
  if (!live) {
    try { if (liveData && liveData.getLiveContext) live = await liveData.getLiveContext(symbol); } catch (e) { /* swallow */ }
  }
  try { if (calendar && calendar.getUpcomingEvents) events = calendar.getUpcomingEvents(symbol) || []; } catch (e) { /* swallow */ }
  try { if (calendar && calendar.getCalendarBias) bias = calendar.getCalendarBias(symbol); } catch (e) { /* swallow */ }
  try { if (calendar && calendar.getEventIntelligence) intel = calendar.getEventIntelligence(symbol); } catch (e) { /* swallow */ }
  try { if (calendar && calendar.getCalendarSnapshot) snapshot = calendar.getCalendarSnapshot(symbol); } catch (e) { /* swallow */ }

  const evidence = [];
  if (live) evidence.push({ type: 'live_market_context', data: live });
  if (events && events.length) evidence.push({ type: 'upcoming_events', count: events.length, data: events });
  if (bias) evidence.push({ type: 'calendar_bias', data: bias });
  if (snapshot) evidence.push({ type: 'calendar_snapshot', data: snapshot });

  // Phase B confidence/score derivation — crude but defensible
  const haveLive = !!live;
  const haveCalendar = !!((events && events.length) || bias || snapshot);
  const confidence = (haveLive ? 0.4 : 0) + (haveCalendar ? 0.3 : 0);
  const score = haveLive ? 0.5 : 0.3;

  const riskModifiers = [];
  if (intel) {
    if (Array.isArray(intel.riskFlags)) riskModifiers.push(...intel.riskFlags);
    if (Array.isArray(intel.warnings)) riskModifiers.push(...intel.warnings);
  }

  return {
    authority: 'current_macro_regime_event',
    score,
    confidence,
    evidence,
    riskModifiers,
    timeframeRelevance: 'session',
    symbol,
    timestamp,
    _sources: { live: haveLive, events: (events && events.length) || 0, bias: !!bias, intel: !!intel, snapshot: !!snapshot },
    _phase: 'B-foundation',
  };
}

module.exports = { coreyRun };
