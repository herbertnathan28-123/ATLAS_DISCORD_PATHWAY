'use strict';

/**
 * Macro Engine — broader macro / event normalisation authority.
 * Distinct from Corey: Corey is *current* regime/event; Macro is the
 * normalised broader macro narrative (CPI, FOMC schedule, regional bias).
 *
 * Phase B: minimal valid packet. Phase D wires real macro feeds.
 */

const { interpretCalendarEvents } = require('./macro/interpretCalendarEvents');

async function macroRun(symbol, opts = {}) {
  const testMode = opts.testMode || process.env.ATLAS_TEST_MODE === '1';
  const timestamp = new Date().toISOString();

  if (testMode) {
    return {
      authority: 'macro_normalisation',
      score: 0.5,
      confidence: 0.5,
      evidence: [{ type: 'test_mode_stub', symbol }],
      events: [],
      macroIntelligencePacket: null,
      timeframeRelevance: 'weekly',
      symbol,
      timestamp,
      _testModeShortCircuit: true,
    };
  }

  let snapshot = null;
  let liveCtx = null;
  let fmpData = null;
  let eodhdData = null;
  try {
    const calendar = opts.calendarModule || require('./corey_calendar');
    snapshot = calendar && calendar.getCalendarSnapshot ? calendar.getCalendarSnapshot() : null;
  } catch (_e) { snapshot = null; }
  try {
    const coreyLive = opts.coreyLiveModule || require('./corey_live_data');
    liveCtx = coreyLive && coreyLive.getLiveContext ? coreyLive.getLiveContext() : null;
  } catch (_e) { liveCtx = null; }
  try {
    const fmpAdapter = require('./macro/fmpAdapter');
    if (fmpAdapter && fmpAdapter.isEnabled && fmpAdapter.isEnabled()) {
      fmpData = await fmpAdapter.enrich(symbol);
    } else {
      fmpData = { enabled: false, available: false, reason: 'FMP_API_KEY not set' };
    }
  } catch (e) {
    fmpData = { enabled: false, available: false, reason: 'FMP adapter error: ' + e.message };
  }
  try {
    const eodhd = require('./eodhdAdapter');
    eodhdData = { enabled: !!(eodhd && eodhd.isEnabled && eodhd.isEnabled()), available: !!(eodhd && eodhd.isEnabled && eodhd.isEnabled()), source: 'eodhd' };
  } catch (e) {
    eodhdData = { enabled: false, available: false, reason: 'EODHD adapter error: ' + e.message };
  }

  const macroIntelligencePacket = interpretCalendarEvents({
    events: (snapshot && snapshot.events) || [],
    health: (snapshot && snapshot.health) || { available: false, calendar_mode: 'UNAVAILABLE', source_used: null },
    coreyState: liveCtx,
    fmpData,
    eodhdData,
    now: opts.now || Date.now(),
  });
  const confidence = macroIntelligencePacket.confidenceScore || 0.4;
  const riskScore = macroIntelligencePacket.riskState && macroIntelligencePacket.riskState.scoreOutOf5
    ? macroIntelligencePacket.riskState.scoreOutOf5 / 5
    : 0.5;
  return {
    authority: 'macro_normalisation',
    score: riskScore,
    confidence,
    evidence: [{
      type: 'macro_intelligence_packet',
      primaryEvent: macroIntelligencePacket.primaryEventFocus && macroIntelligencePacket.primaryEventFocus.title,
      riskState: macroIntelligencePacket.riskState && macroIntelligencePacket.riskState.label,
      confidenceBasis: macroIntelligencePacket.confidenceBasis,
    }],
    events: macroIntelligencePacket.next72Hours || [],
    macroIntelligencePacket,
    timeframeRelevance: 'weekly',
    symbol,
    timestamp,
    _phase: 'operational-macro-interpreter',
  };
}

module.exports = { macroRun };
