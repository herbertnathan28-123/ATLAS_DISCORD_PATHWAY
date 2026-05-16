'use strict';

// ============================================================
// foh/buildMarketIntelPacket.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// Converts upstream engine intelligence (calendar snapshot, geo
// context, live macro context) into a stable FOH packet shape
// that downstream view-model adapters can rely on.
//
// Contract (every field present, fallback-safe):
//   meta:                  { module, reportId, generatedAtUTC, audience,
//                            source, noExternalWorkspaceLinks }
//   header:                { title, subtitle, riskState, severityDiscs,
//                            generatedAtUTC }
//   briefingSummary:       { primaryRead, operationalMeaning,
//                            keyMarkets, currentRisk }
//   eventDayReference:     { eventName, eventTimeUTC, expectedDuration,
//                            whatToWatch, chartStudyTimeframe }
//   fourWayOutcomes:       { higher, lower, inline, reversal }
//                          each: { behaviour, affectedMarkets,
//                                  traderAction, dollarImpact }
//   marketImpact:          { mechanism, priceReactionPath,
//                            liquidityEffect, volatilityEffect,
//                            traderConsequence }
//   riskEscalation:        { healthy, caution, danger, invalidation }
//   whatToDoNow:           [ { step, action, reason, dollarConsequence } ]
//   confirmationCancellation: { confirmsWhen, cancelsWhen, dangerIf }
//   provenance:            { sources, dataFreshness, confidenceBasis }
//
// Hard rule: if a required field is missing in upstream data, the
// builder fills a safe plain-English fallback INSIDE ATLAS output.
// It must NEVER route the user to an external workspace.
// ============================================================

function _crypto() {
  try { return require('crypto'); } catch (_) { return null; }
}
function _reportId(prefix) {
  const c = _crypto();
  if (c && c.randomBytes) return prefix + '-' + c.randomBytes(4).toString('hex');
  return prefix + '-' + Math.random().toString(16).slice(2, 10);
}

function _utcStamp(ms) {
  const d = new Date(ms || Date.now());
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function _discScale(severity) {
  switch (String(severity || '').toUpperCase()) {
    case 'STORM':
    case 'HIGH':     return '🔴🔴🔴🔴🔴 5/5 — Storm';
    case 'ELEV':
    case 'ELEVATED': return '🟠🟠🟠🟠⚫ 4/5 — Elevated';
    case 'CAUTION':  return '🟡🟡🟡🟡⚫ 4/5 — Caution';
    case 'MED':
    case 'WATCH':    return '🟡🟡🟡⚫⚫ 3/5 — Watch';
    case 'LOW':
    case 'CALM':     return '🟢🟢⚫⚫⚫ 2/5 — Calm';
    default:         return '⚪⚪⚫⚫⚫ 2/5 — Indeterminate';
  }
}

function _humanDuration(severity) {
  const sev = String(severity || '').toUpperCase();
  if (/HIGH|STORM/.test(sev)) return '60–120 minutes of high reactivity, then mean-reversion through next session';
  if (/ELEV/.test(sev))       return '30–60 minutes of elevated reactivity, settling into next session';
  if (/MED|WATCH/.test(sev))  return '15–30 minutes of initial reaction, mean-reversion thereafter';
  return '5–15 minutes initial reaction window';
}

// Operationally-anchored directional doctrine (operator 2026-05-17).
// Every directional instruction carries 6 elements: instrument,
// priceLevel, behavioralExplanation, confirmsContinuation,
// invalidatesContinuation, probableNextPath, probableFailurePath.
// The view-model adapter renders this object into the operator-
// specified block layout. Vague trader shorthand is banned —
// the fohOperationalAnchors guard rejects any rendered output
// that lacks the 6 elements or contains generic "find a setup"
// phrasing without anchoring evidence.
function _anchoredAction(opts) {
  return {
    instrument:              opts.instrument               || '—',
    priceLevel:              opts.priceLevel               || '—',
    behavioralExplanation:   opts.behavioralExplanation    || '—',
    confirmsContinuation:    Array.isArray(opts.confirmsContinuation)    && opts.confirmsContinuation.length    ? opts.confirmsContinuation    : ['—'],
    invalidatesContinuation: Array.isArray(opts.invalidatesContinuation) && opts.invalidatesContinuation.length ? opts.invalidatesContinuation : ['—'],
    probableNextPath:        Array.isArray(opts.probableNextPath)        && opts.probableNextPath.length        ? opts.probableNextPath        : ['—'],
    probableFailurePath:     Array.isArray(opts.probableFailurePath)     && opts.probableFailurePath.length     ? opts.probableFailurePath     : ['—'],
  };
}

function _outcomeStub(direction, eventName, severity) {
  const tail = ' (event: ' + (eventName || 'lead catalyst') + ')';
  const sev = String(severity || 'MED').toUpperCase();
  const usdRange = /HIGH|STORM/.test(sev) ? '$500 – $1,500' : /ELEV/.test(sev) ? '$300 – $800' : '$100 – $300';
  // Reaction-band reference is the pre-event consolidation midpoint.
  // The adapter substitutes live values at render time; the doctrine
  // STRUCTURE is what the contract guarantees.
  const ref = '1.0928'; // illustrative; live adapter substitutes per pair
  const ev = eventName || 'lead catalyst';
  switch (direction) {
    case 'higher':
      return {
        behaviour: 'USD bid, indices defensive, gold pressured intraday — first 30 min sees the cleanest directional move' + tail,
        affectedMarkets: ['DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US500', 'NAS100'],
        traderAction: _anchoredAction({
          instrument: 'EURUSD',
          priceLevel: 'pre-event reaction band around ' + ref + ' (lower side)',
          behavioralExplanation: 'After ' + ev + ', only consider downside EURUSD continuation IF price fails to reclaim the pre-event reaction band around ' + ref + '. If EURUSD closes below ' + ref + ' and the next candle stays below it, the dollar-strength move is structurally real rather than a 60-second sweep.',
          confirmsContinuation: [
            '5-minute candle closes below ' + ref,
            'next 5-minute candle fails to recover back above ' + ref,
            'DXY continues making higher highs through the same window',
          ],
          invalidatesContinuation: [
            'EURUSD closes back above ' + ref,
            'candle bodies start shrinking — momentum exhausting',
            'DXY loses momentum immediately after the announcement spike',
          ],
          probableNextPath: [
            'price rotates toward the next liquidity zone beneath the event low (illustrative ~1.0880)',
            'volatility stays elevated through the next macro catalyst window',
          ],
          probableFailurePath: [
            'event spike fades inside the first 10 minutes',
            'EURUSD snaps back into the pre-event range',
            'trapped short sellers forced to cover',
          ],
        }),
        dollarImpact: 'Long EURUSD: ' + usdRange + ' drawdown on $100k notional. Short EURUSD: ' + usdRange + ' gain on $100k.',
      };
    case 'lower':
      return {
        behaviour: 'USD offered, indices bid, gold rallies on softening rate-path expectations — risk-on rotation' + tail,
        affectedMarkets: ['DXY', 'EURUSD', 'GBPUSD', 'US500', 'NAS100', 'XAUUSD'],
        traderAction: _anchoredAction({
          instrument: 'EURUSD',
          priceLevel: 'pre-event reaction band around ' + ref + ' (upper side)',
          behavioralExplanation: 'After ' + ev + ', only consider upside EURUSD continuation IF price holds above the pre-event reaction band around ' + ref + '. If EURUSD closes above ' + ref + ' and the next candle stays above it, the dollar-weakness move is structurally real rather than a 60-second sweep.',
          confirmsContinuation: [
            '5-minute candle closes above ' + ref,
            'next 5-minute candle holds above ' + ref + ' without retracing back inside',
            'DXY continues making lower lows through the same window',
          ],
          invalidatesContinuation: [
            'EURUSD closes back below ' + ref,
            'candle bodies start shrinking — momentum exhausting',
            'DXY loses downside momentum immediately after the announcement spike',
          ],
          probableNextPath: [
            'price rotates toward the next liquidity zone above the event high (illustrative ~1.0980)',
            'gold (XAUUSD) rallies in sympathy through the same window',
          ],
          probableFailurePath: [
            'dovish spike fades inside the first 10 minutes',
            'EURUSD snaps back into the pre-event range',
            'trapped long buyers forced to liquidate',
          ],
        }),
        dollarImpact: 'Long EURUSD: ' + usdRange + ' gain on $100k notional. Short XAUUSD: ' + usdRange + ' drawdown on 1 lot.',
      };
    case 'inline':
      return {
        behaviour: 'Light reaction across the board; initial spike either side then settle. Volatility drops within 15 minutes' + tail,
        affectedMarkets: ['DXY', 'EURUSD', 'XAUUSD', 'US500'],
        traderAction: _anchoredAction({
          instrument: 'EURUSD',
          priceLevel: 'pre-event reaction band around ' + ref + ' (range intact)',
          behavioralExplanation: 'An in-line print leaves the pre-event reaction band intact. Price will chop around ' + ref + ' but no side has structural control until a 15-min close breaks the band.',
          confirmsContinuation: [
            'both 5-min candles after the print stay between roughly 1.0915 and 1.0940',
            'DXY mean-reverts back toward pre-event level inside 15 minutes',
            'volatility (VIX-proxy) drops back to pre-event readings',
          ],
          invalidatesContinuation: [
            'a 5-min candle closes outside the 1.0915–1.0940 reaction band',
            'DXY pushes to a fresh 15-min extreme in either direction',
            'volume comes IN on a directional candle instead of fading',
          ],
          probableNextPath: [
            'range-bound chop through the next half-hour into the following catalyst',
            'the real directional bias prints from the next catalyst, not from ' + ev,
          ],
          probableFailurePath: [
            'the in-line print masks a delayed reaction — the real direction prints 10–15 minutes after the announcement on a sweep through ' + ref,
            'traders standing aside catch the move on the next ATLAS scan',
          ],
        }),
        dollarImpact: 'Small swings $100 – $300 on $100k EURUSD, then mean-reversion back toward pre-event level.',
      };
    case 'reversal':
      return {
        behaviour: 'First move off the announcement is faded inside 10 minutes; the 15-min close is the real trend' + tail,
        affectedMarkets: ['DXY', 'EURUSD', 'XAUUSD'],
        traderAction: _anchoredAction({
          instrument: 'EURUSD',
          priceLevel: 'pre-event reaction band ' + ref + ' (15-min close direction is the real trend)',
          behavioralExplanation: 'The first move off the announcement is being faded by larger volume on the other side. Trade only the post-15-min direction IF the 15-min candle closes through ' + ref + ' in the OPPOSITE direction of the initial spike.',
          confirmsContinuation: [
            '15-min candle closes opposite to the first 5-min move',
            'volume IN-flow visible against the initial direction',
            'DXY mirrors the reversal on the same 15-min close',
          ],
          invalidatesContinuation: [
            'the 15-min close confirms the initial direction (no reversal)',
            'candle body of the 15-min close is small relative to its wick',
            'DXY continues in the initial-spike direction without retracing',
          ],
          probableNextPath: [
            'price extends in the post-15-min direction toward the opposite-side liquidity zone (~1.0880 for a hawkish-reversal, ~1.0980 for a dovish-reversal)',
            'volatility stays elevated through the next macro catalyst window',
          ],
          probableFailurePath: [
            'the reversal candle itself gets faded inside the next 15 minutes',
            'price returns to the pre-event range',
            'trapped reversal traders forced to exit on the next ATLAS scan',
          ],
        }),
        dollarImpact: 'Traders who chase the first 60 seconds: $800 – $1,500 drawdown on $100k EURUSD before the reversal completes.',
      };
  }
  return { behaviour: '', affectedMarkets: [], traderAction: _anchoredAction({}), dollarImpact: '' };
}

function _riskEscalationStubs(eventName) {
  const ev = eventName || 'the lead catalyst';
  return {
    healthy:      'PRE-EVENT (T-60 → T-15): normal flow, positions sized to current mood. Optional pre-position only if structure already validated by Dark Horse scan.',
    caution:      'T-15 → T-0: tighten stops on existing exposure; do not add new direction trades. Sit on hands for the announcement.',
    danger:       'T+0 → T+5: first-candle spike. Do not enter inside this window — chase risk is at session peak. Watch only.',
    invalidation: 'STAND-ASIDE: if the first 5-min close is opposite to your existing position direction, exit immediately at next 1-min close. RE-ENTRY: only after a confirmed 15-min close in the structural direction following ' + ev + '.',
  };
}

function _whatToDoNowStubs(severity) {
  const sev = String(severity || 'MED').toUpperCase();
  const sizeMultiplier = /HIGH|STORM/.test(sev) ? '50%' : /ELEV/.test(sev) ? '60%' : '80%';
  return [
    { step: 1, action: 'Reduce position size to ' + sizeMultiplier + ' of normal risk for the next 6 hours.',
      reason: 'Catalyst-driven sessions widen spreads and stop ranges. Smaller size keeps planned-risk discipline.',
      dollarConsequence: 'If normal risk is $500 on a $10k account, reduce to ~$' + (Number(sizeMultiplier.replace('%','')) * 5) + ' per trade for the window.' },
    { step: 2, action: 'Cancel marginal setups. Only act on triggers where the next candle closes BEYOND the level (confirmed directional structure test).',
      reason: 'Sweeps and false breaks dominate the first 15 minutes after a high-impact print.',
      dollarConsequence: 'Avoids the $300 – $800 drawdown band typical of chasing a first-move fake.' },
    { step: 3, action: 'Widen exit-points by ~30% on existing positions; tight exits get hit before direction confirms.',
      reason: 'Initial volatility expansion pushes price beyond historical 1-σ before the real direction prints.',
      dollarConsequence: 'Avoids being stopped on a wick that mean-reverts within 5 minutes — protects $150 – $400 of carry on $100k notional.' },
  ];
}

function _safe(text, fallback) {
  if (typeof text === 'string' && text.trim().length) return text;
  return fallback || 'inline intelligence — see briefing surface';
}

function _firstEvent(packetIn) {
  const clusters = (packetIn && packetIn.eventClusters) || [];
  for (const c of clusters) for (const e of (c.events || [])) if (e) return { e, c };
  return null;
}

function buildMarketIntelPacket(opts) {
  opts = opts || {};
  const engine = opts.engine || {};                // upstream MI packet (legacy shape)
  const liveCtx = opts.liveCtx || null;
  const now = opts.now || Date.now();

  // Risk state + severity discs.
  const rawMood = engine.mood || engine.marketMood || {};
  const severity = String(rawMood.severity || engine.severity || 'MED').toUpperCase();
  const moodLabel = rawMood.label || ({ HIGH: 'High — clustered catalyst exposure', ELEV: 'Elevated — high-impact catalyst window', MED: 'Active — moderate catalyst sensitivity', LOW: 'Calm — driver-led session', STORM: 'Storm — peak event-day reactivity' }[severity] || 'Active');
  const severityDiscs = rawMood.discs ? (rawMood.discs + ' ' + (rawMood.label || moodLabel)) : _discScale(severity);

  // Featured event.
  const ev = _firstEvent(engine);
  const eventName = (ev && ev.e && ev.e.title) || (engine.headline && engine.headline.title) || 'no scheduled high-impact catalyst';
  const eventTimeUTC = (ev && ev.e && ev.e.time) || (engine.headline && engine.headline.time) || _utcStamp(now);
  const eventCcy = (ev && (ev.e.currency || ev.c.currency)) || (engine.headline && engine.headline.currency) || 'multi';

  // Affected markets — combine engine-derived + outcome-stub fallback.
  const fromEngine = Array.isArray(engine.affectedMarkets && engine.affectedMarkets.symbols)
    ? engine.affectedMarkets.symbols
    : Array.isArray(engine.affectedMarkets) ? engine.affectedMarkets : [];
  const keyMarkets = fromEngine.length ? fromEngine : ['DXY', 'EURUSD', 'XAUUSD', 'US500'];

  // Build the contract packet.
  const meta = {
    module: 'market_intel',
    reportId: opts.reportId || _reportId('mi'),
    generatedAtUTC: _utcStamp(now),
    audience: 'front_of_house',
    source: 'atlas_runtime',
    noExternalWorkspaceLinks: true,
  };
  const header = {
    title:          'ATLAS · Market Intel',
    subtitle:       (engine.kind === 'weekend' ? 'Weekend / Monday Open Prep' : engine.kind === 'released' ? 'Released Event' : engine.kind === 'pre_event' ? 'Event Watch' : 'Daily Roadmap'),
    riskState:      moodLabel,
    severityDiscs,
    generatedAtUTC: _utcStamp(now),
  };
  const briefingSummary = {
    primaryRead:         _safe(engine.briefingSummary, eventName + ' at ' + eventTimeUTC + '. Risk state: ' + moodLabel + '.'),
    operationalMeaning:  _safe(engine.whyThisMatters, 'Position size at ' + (/HIGH|STORM/.test(severity) ? '50%' : /ELEV/.test(severity) ? '60%' : '80%') + ' of normal risk for the catalyst window; widen exits ~30%; cancel marginal setups.'),
    keyMarkets,
    currentRisk:         _safe(engine.currentRisk, severityDiscs + ' — reactivity elevated through the catalyst window; mean-reversion expected thereafter.'),
  };
  const eventDayReference = {
    eventName,
    eventTimeUTC,
    expectedDuration:    _humanDuration(severity),
    whatToWatch:         _safe(engine.whatToWatch, 'First 5-min close in the surprise direction; then 15-min close as the real trend signal. Cross-confirm against DXY and the lead pair (' + (keyMarkets[1] || 'EURUSD') + ').'),
    chartStudyTimeframe: '1H structure + 5M / 15M execution',
  };
  const fourWayOutcomes = {
    higher:   _outcomeStub('higher',   eventName, severity),
    lower:    _outcomeStub('lower',    eventName, severity),
    inline:   _outcomeStub('inline',   eventName, severity),
    reversal: _outcomeStub('reversal', eventName, severity),
  };
  const marketImpact = {
    mechanism:           _safe(engine.marketImpact, 'cause: ' + eventName + ' → expectation: front-end rate-path repricing → market reaction: USD lead, cross-asset cascade through ' + keyMarkets.join(', ')),
    priceReactionPath:   'Initial impulse (0–60s) → first 5-min close confirms direction → 15-min close gives the real trend → 1H close locks in the bias for the rest of the session.',
    liquidityEffect:     'Spreads widen 2–4× across the announcement candle; market-depth thins through T+5; normalises by T+15.',
    volatilityEffect:    /HIGH|STORM/.test(severity) ? 'ATR doubles on the announcement candle; expect overshoot beyond historical 1-σ' : /ELEV/.test(severity) ? 'ATR ~1.5× on the announcement; 1-σ overshoot likely' : 'ATR moderate expansion; range-bound after the first 15-min close',
    traderConsequence:   'Chasing the first 60 seconds creates the $800–$1,500 drawdown band; waiting for the 5-min close and trading the next pullback flips the same setup into a clean $300–$800 gain on $100k EURUSD.',
  };
  const riskEscalation = _riskEscalationStubs(eventName);
  const whatToDoNow = _whatToDoNowStubs(severity);
  const confirmationCancellation = {
    confirmsWhen: _safe(engine.confirmationPath && engine.confirmationPath.narrative, 'First 5-min close in the surprise direction PLUS confirming structure on DXY / lead pair.'),
    cancelsWhen:  _safe(engine.cancellationPath && engine.cancellationPath.narrative, 'First 15-min close fails to follow through OR geopolitical override hits the wire inside the window.'),
    dangerIf:     'Position is opposite the 5-min close direction by T+5 — exit immediately at next 1-min close. No averaging into a fresh catalyst-led move.',
  };
  const provenance = {
    sources:          [(engine.sourceNote && engine.sourceNote.source) || 'TradingView calendar', 'ATLAS macro (DXY=UUP-proxy · VIX=VXX-proxy · curve=FRED T10Y2Y)'],
    dataFreshness:    (engine.sourceNote && engine.sourceNote.mode) || (liveCtx ? 'LIVE' : 'UNAVAILABLE'),
    confidenceBasis:  (engine.sourceNote && engine.sourceNote.probabilityBasis) || 'engine-derived',
  };

  return { meta, header, briefingSummary, eventDayReference, fourWayOutcomes, marketImpact, riskEscalation, whatToDoNow, confirmationCancellation, provenance };
}

module.exports = { buildMarketIntelPacket };
