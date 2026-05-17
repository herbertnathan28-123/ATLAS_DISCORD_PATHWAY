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

// Operator brief 2026-05-17: colour-coded severity discs.
//   EXTREME / STORM = full red (5/5)
//   HIGH            = red (4/5 red)
//   MEDIUM          = orange / amber (3/5)
//   LOW             = blue / cyan (2/5)
//   CALM            = blue / cyan (1/5)
// Inactive disc always ⚫. Discord-rendered with native glyphs.
function _discScale(severity) {
  switch (String(severity || '').toUpperCase()) {
    case 'EXTREME':
    case 'STORM':    return '🔴🔴🔴🔴🔴 5/5 — Extreme';
    case 'HIGH':     return '🔴🔴🔴🔴⚫ 4/5 — High';
    case 'ELEV':
    case 'ELEVATED': return '🟠🟠🟠🟠⚫ 4/5 — Elevated';
    case 'CAUTION':  return '🟠🟠🟠⚫⚫ 3/5 — Caution';
    case 'MED':
    case 'MEDIUM':
    case 'WATCH':    return '🟠🟠🟠⚫⚫ 3/5 — Medium';
    case 'LOW':      return '🔵🔵⚫⚫⚫ 2/5 — Low';
    case 'CALM':     return '🔵⚫⚫⚫⚫ 1/5 — Calm';
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
        dollarImpact: 'Long EURUSD: ' + usdRange + ' gain on $100k notional. Short XAUUSD: ' + usdRange + ' drawdown on 100 oz notional exposure.',
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

// ─── CHUNK 3 — FULL-DAY MARKET INTEL COVERAGE ─────────────────
// Operator brief: TODAY'S RELEVANT ANNOUNCEMENTS / PRIMARY EVENT
// FOCUS / NEXT 24-72 HOURS. Each event carries session group,
// UTC stamp, currency, severity discs, why-it-matters, instruments.

function _sessionOf(timeStr) {
  // Map a UTC clock time to a trading session window.
  const m = /(\d{1,2}):(\d{2})/.exec(timeStr || '');
  if (!m) return 'unscheduled';
  const h = Number(m[1]);
  if (h >= 22 || h < 7) return 'Asia';
  if (h < 12)           return 'London';
  if (h < 21)           return 'New York';
  return 'late-NY';
}

function _todaysAnnouncementsFrom(clusters) {
  const out = [];
  for (const c of (clusters || [])) {
    for (const e of (c.events || [])) {
      const sev = String(e.severity || c.severity || 'MED').toUpperCase();
      out.push({
        session:        _sessionOf(e.time),
        timeUTC:        e.time || 'pending',
        currency:       e.currency || c.currency || 'multi',
        title:          e.title || 'unnamed event',
        severity:       sev,
        severityDiscs:  _discScale(sev),
        whyItMatters:   e.whyMatters || _whyMattersDefault(e.title, sev),
        affectedInstruments: e.affectedInstruments || _instrumentsForCcy(e.currency || c.currency),
      });
    }
  }
  return out;
}

function _whyMattersDefault(title, severity) {
  const t = String(title || '').toLowerCase();
  if (/cpi|inflation|ppi/.test(t)) return 'Inflation print directly repricing the rate-path. Surprise direction drives DXY and front-end yields, cascading through every dollar pair, gold, and US indices.';
  if (/nfp|payroll/.test(t))       return 'Labour print sets the Fed reaction function. Surprise direction repricing rate-path expectations through DXY and bonds; gold and indices follow.';
  if (/ecb|boe|fomc|rate decision/.test(t)) return 'Central-bank statement directly setting policy expectations. Forward guidance dominates the post-statement price action — the 15-min close after the press conference is the real trend.';
  if (/retail sales|consumer/.test(t)) return 'Consumer-demand readout into the next Fed meeting. Drives growth expectations, secondary impact on dollar via real-yield repricing.';
  if (/gdp|growth/.test(t))            return 'Activity print into the next central-bank meeting; surprise direction reprices the policy path with a 1–2 day lag.';
  if (/pmi|ism/.test(t))               return 'Activity proxy ahead of the official growth print; first-mover for cyclical rotation reads.';
  if (/lagarde|powell|fed.*speak/.test(t)) return 'Forward-guidance speech — tone matters more than content; market reprices the policy path in real time.';
  return (severity === 'HIGH' ? 'High-impact catalyst' : severity === 'ELEV' ? 'Elevated-impact catalyst' : 'Standard catalyst') + ' — reactivity elevated through the announcement window.';
}

function _instrumentsForCcy(ccy) {
  const c = String(ccy || '').toUpperCase();
  switch (c) {
    case 'USD':  return ['DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US500', 'NAS100'];
    case 'EUR':  return ['EURUSD', 'EURGBP', 'EURJPY', 'DAX40', 'STOXX50'];
    case 'GBP':  return ['GBPUSD', 'EURGBP', 'GBPJPY', 'UK100'];
    case 'JPY':  return ['USDJPY', 'EURJPY', 'GBPJPY', 'NIKKEI'];
    case 'AUD':  return ['AUDUSD', 'AUDJPY', 'AU200'];
    case 'CAD':  return ['USDCAD', 'CADJPY', 'WTI'];
    case 'CHF':  return ['USDCHF', 'EURCHF', 'XAUUSD'];
    default:     return ['DXY', 'EURUSD', 'XAUUSD', 'US500'];
  }
}

// ─── CHUNK 4 — AFFECTED MARKET EXPANSION ──────────────────────
// Operator brief: if MI says an announcement affects X, it must
// explain HOW. Per-market: howAffected, strongerResult, weakerResult,
// confirmation, invalidation, keyPriceLevels, riskNote.

const _MARKET_PROFILE = Object.freeze({
  EURUSD: { howAffected: 'Dollar leg of the EUR-USD pair; reacts to USD rate-path repricing first, EUR fundamentals second.',
            stronger:   'EURUSD drops on stronger USD print — first 30 min sees the cleanest move.',
            weaker:     'EURUSD rallies on softer USD print — EUR-side optimism amplifies the move.',
            confirmation: '5-min candle close in the surprise direction PLUS DXY making higher highs / lower lows in agreement.',
            invalidation: 'Body close back through the pre-event reaction band (≈1.0928) within 15 minutes.',
            levels:     'Reaction band 1.0928 · downside liquidity ≈1.0880 · upside liquidity ≈1.0980 · 30-day ATR ≈70 pips.',
            risk:       '$300–$800 swing on $100k notional in the first 30 minutes; up to $1,500 on a reversal chase.' },
  GBPUSD: { howAffected: 'USD-sensitive pair carrying additional UK-CPI / BOE-policy beta; whips wider than EURUSD on USD prints.',
            stronger:   'GBPUSD drops faster than EURUSD on a hawkish USD surprise — higher beta to dollar moves.',
            weaker:     'GBPUSD rallies on softer USD print; UK-side risk-on amplifies.',
            confirmation: '5-min close + DXY confirmation; cable typically leads EURUSD by 10–15 minutes.',
            invalidation: 'Body close back through the pre-event range within 15 minutes.',
            levels:     'Watch the 0.85 EUR/GBP cross — if cross moves against direction, the USD move is real.',
            risk:       '$400–$1,000 swing on £80k notional in the first 30 minutes; wider stops needed than EURUSD.' },
  USDJPY: { howAffected: 'Yield-driven pair; reacts to US-bond yields more than dollar index directly.',
            stronger:   'USDJPY rallies as front-end yields jump; safe-haven flow can cap the upside.',
            weaker:     'USDJPY drops on yield retracement; JPY-strength flows compound the move.',
            confirmation: '5-min close + US 10Y yield direction in agreement.',
            invalidation: 'BoJ intervention rhetoric or JPY-safe-haven flow flipping the move.',
            levels:     '~148.50 intervention watch zone; below 145 = sustained JPY strength.',
            risk:       '$500–$1,200 swing on $100k notional in the first 30 minutes.' },
  XAUUSD: { howAffected: 'Inverse to real-yields and USD; reacts secondary to USD prints, primary to risk-off flow.',
            stronger:   'XAUUSD drops intraday on a hawkish USD surprise; safe-haven flow can recover the move on a 1H close.',
            weaker:     'XAUUSD rallies on a dovish USD print; real-yield-fall amplifies.',
            confirmation: 'DXY direction in agreement + 1H close beyond the structural level.',
            invalidation: 'Body close back through the pre-event range; safe-haven flow flipping the move on the 1H.',
            levels:     'Structural support 2380 · structural resistance 2440 · 30-day ATR ≈$45.',
            risk:       '$500–$1,500 swing on 100 oz exposure in the first 30 minutes.' },
  US500:  { howAffected: 'Equity index repricing rate-path expectations; reacts to bond yields first, dollar second.',
            stronger:   'US500 drops on rate-hike fears after a hawkish USD print.',
            weaker:     'US500 rallies on rate-cut optimism after a dovish USD print.',
            confirmation: '5-min close + VIX direction (inverse) + yields in agreement.',
            invalidation: 'Body close back into the pre-event range OR VIX collapsing without index direction following.',
            levels:     'VWAP-driven; first 15-min VWAP becomes the intraday pivot.',
            risk:       '$400–$900 swing on 100-share exposure in the first 30 minutes.' },
  NAS100: { howAffected: 'Tech-heavy index, most rate-sensitive of the major US indices; biggest beta to long-end yields.',
            stronger:   'NAS100 drops sharper than US500 on hawkish USD prints — long-duration sensitivity.',
            weaker:     'NAS100 rallies harder than US500 on dovish prints.',
            confirmation: '5-min close + US 10Y yield direction (inverse) in agreement.',
            invalidation: 'Body close back into the pre-event range; long-end yield retracement.',
            levels:     'VWAP-driven; first 15-min VWAP is the intraday pivot.',
            risk:       '$500–$1,200 swing on 10-contract NQ exposure in the first 30 minutes.' },
  DXY:    { howAffected: 'Dollar-index basket; DIRECT primary indicator of USD repricing — leads every dollar pair.',
            stronger:   'DXY pushes to fresh 24-hour high on hawkish USD surprise; pairs follow.',
            weaker:     'DXY drops below pre-event range on dovish print; pairs rally in sympathy.',
            confirmation: '15-min close beyond the pre-event range.',
            invalidation: '15-min close back inside the pre-event range; whipsaw without follow-through.',
            levels:     'Pre-event range top/bottom is the directional gate. Above range = dollar real, below = dollar fade.',
            risk:       'Leads every dollar pair by 5–10 minutes — read DXY first, then act on the pair.' },
});

function _affectedMarketsExpandedFrom(keyMarkets) {
  return (keyMarkets || []).map(sym => {
    const p = _MARKET_PROFILE[sym] || null;
    if (!p) {
      return {
        instrument: sym,
        howAffected: 'Beta exposure to the announcement direction via cross-asset flow.',
        strongerResult: 'Moves in the same direction as the lead pair (' + (keyMarkets[1] || 'EURUSD') + ').',
        weakerResult: 'Mean-reverts back to pre-event range within 15 minutes.',
        confirmation: '5-min close + lead-pair confirmation.',
        invalidation: 'Body close back inside the pre-event range.',
        keyPriceLevels: 'Pre-event range top/bottom + 30-day ATR.',
        riskNote: 'Sized to the lead-pair envelope; check current spread before acting.',
      };
    }
    return {
      instrument: sym,
      howAffected: p.howAffected,
      strongerResult: p.stronger,
      weakerResult: p.weaker,
      confirmation: p.confirmation,
      invalidation: p.invalidation,
      keyPriceLevels: p.levels,
      riskNote: p.risk,
    };
  });
}

// ─── CHUNK 5 — PRICE MAP + OPERATIONAL LEVELS ─────────────────
// Operator brief: no naked price levels. Every important level
// explains why-matters, expected behaviour, what confirms, what
// invalidates, probable next path, dollar consequence.

function _priceMapFrom(keyMarkets, eventName) {
  const ev = eventName || 'the lead catalyst';
  const out = [];
  // EURUSD reaction band + adjacent liquidity zones (illustrative;
  // adapter substitutes live levels when wired).
  out.push({
    instrument: 'EURUSD',
    level: '1.0928',
    role: 'reaction_level',
    whyMatters: 'Post-event reaction band. ATLAS treats EURUSD direction as structurally real ONLY if price holds outside this band on the 5-min close.',
    ifHolds: 'Continuation in the breakout direction toward the adjacent liquidity zone (1.0880 downside or 1.0980 upside).',
    ifFails: 'Event fade — EURUSD returns into the pre-event range; trapped traders forced to cover.',
    confirmation: '5-min close beyond the band + next candle stays beyond.',
    invalidation: 'Body close back inside the band on the next candle.',
    dollarConsequence: 'Failed continuation can reverse $300–$800 per $100k EURUSD notional in the first 15 minutes after invalidation.',
  });
  out.push({
    instrument: 'EURUSD',
    level: '1.0880',
    role: 'liquidity_pool',
    whyMatters: 'Downside liquidity below the event low; absorbs continuation flow on a confirmed hawkish print.',
    ifHolds: 'Downside extension exhausts here; mean-reversion attempt toward 1.0928.',
    ifFails: 'Deeper continuation toward 1.0850; volatility stays elevated through the next macro window.',
    confirmation: '1H close below 1.0880 + DXY making higher highs.',
    invalidation: '5-min reclaim back above 1.0880 inside 15 minutes.',
    dollarConsequence: 'Holding through 1.0880 → 1.0850 adds $300–$500 per $100k notional.',
  });
  out.push({
    instrument: 'EURUSD',
    level: '1.0980',
    role: 'liquidity_pool',
    whyMatters: 'Upside liquidity above the event high; absorbs continuation flow on a confirmed dovish print.',
    ifHolds: 'Upside extension exhausts here; mean-reversion attempt back toward 1.0928.',
    ifFails: 'Deeper continuation toward 1.1010; risk-on flow stays in equities and gold.',
    confirmation: '1H close above 1.0980 + DXY making lower lows.',
    invalidation: '5-min retracement back below 1.0980 inside 15 minutes.',
    dollarConsequence: 'Holding through 1.0980 → 1.1010 adds $300–$500 per $100k notional.',
  });
  out.push({
    instrument: 'DXY',
    level: 'pre-event range',
    role: 'continuation_gate',
    whyMatters: 'Dollar-index gate. DXY closing through the pre-event range tells ATLAS the dollar move is real BEFORE any individual pair confirms.',
    ifHolds: 'Range respected → no directional dollar bias; pairs chop until the next catalyst.',
    ifFails: 'Range broken → dollar lead in agreement direction; every dollar pair confirms within 5–10 minutes.',
    confirmation: '15-min close beyond the range on broad-based dollar flow.',
    invalidation: '15-min close back inside the range within 30 minutes.',
    dollarConsequence: 'Reading DXY first protects $200–$500 per $100k notional vs. reading the pair direction in isolation.',
  });
  out.push({
    instrument: 'XAUUSD',
    level: '2380',
    role: 'support_zone',
    whyMatters: 'Structural support beneath current price. Gold below 2380 on a 1H close flips the macro bias bearish on the metal complex.',
    ifHolds: 'Mean-reversion back toward 2410; safe-haven flow returns if equity risk-off prints.',
    ifFails: 'Deeper liquidation toward 2350; correlation with real-yields tightens.',
    confirmation: '1H close above 2380 after testing it.',
    invalidation: '1H close below 2380.',
    dollarConsequence: 'Holding 100 oz exposure through a 2380 break: $300–$500 of unrealised loss before invalidation triggers.',
  });
  out.push({
    instrument: 'XAUUSD',
    level: '2440',
    role: 'resistance_zone',
    whyMatters: 'Structural resistance above current price. Gold above 2440 on a 1H close flips macro bias bullish on the metal complex.',
    ifHolds: 'Mean-reversion back toward 2410; consolidation continues.',
    ifFails: 'Breakout toward fresh highs; real-yields fall, dollar weakness compounds.',
    confirmation: '1H close above 2440 after testing it.',
    invalidation: '1H close back below 2440 inside 4 hours.',
    dollarConsequence: 'Riding 100 oz exposure through 2440: each $10 move = $1,000 of P/L.',
  });
  return out;
}

// ─── CHUNK 6 — ACTION BLOCK EXPANSION ─────────────────────────
// Every action carries: action, why, ifIgnored, confirmation,
// actionChangesWhen. The view-model formatter renders all 5 fields
// into the user-facing Discord block.

function _expandActions(severity) {
  const sev = String(severity || 'MED').toUpperCase();
  const sizeMultiplier = /HIGH|STORM/.test(sev) ? '50%' : /ELEV/.test(sev) ? '60%' : '80%';
  const dollarFigure = /HIGH|STORM/.test(sev) ? '~$250' : /ELEV/.test(sev) ? '~$300' : '~$400';
  return [
    {
      step: 1,
      action: 'Reduce dollar exposure to ' + sizeMultiplier + ' of normal risk for the next 6 hours.',
      why: 'Catalyst-driven sessions widen spreads and stop ranges. Smaller dollar exposure keeps planned-risk discipline through the volatility expansion.',
      ifIgnored: 'A normal-size position takes ~30–50% more drawdown through the announcement candle than the planned-risk model assumes — turning a designed $500 loss into a $650–$750 actual loss.',
      confirmation: 'Position-size calculator reflects the reduced dollar exposure before the event window opens. If normal risk per trade is $500 on a $10k account, the new ceiling is ' + dollarFigure + '.',
      actionChangesWhen: 'Market mood drops from ' + sev + ' back to LOW within the 6-hour window — at that point dollar exposure can scale back up gradually, ONE position at a time.',
      dollarConsequence: 'Reducing to ' + dollarFigure + ' per trade caps the announcement-window drawdown at the planned-risk line; oversized exposure regularly turns a $500 designed loss into $700–$1,000 of realised damage.',
    },
    {
      step: 2,
      action: 'Cancel marginal setups. Only act on triggers where the next candle closes BEYOND the level (confirmed directional structure test).',
      why: 'Sweeps and false breaks dominate the first 15 minutes after a high-impact print; trading on a wick alone is paying for false direction.',
      ifIgnored: 'Acting on the first 60 seconds typically catches the wick high or low; the $300–$800 drawdown band on $100k EURUSD is paid for the privilege.',
      confirmation: 'No new entries until the 5-minute candle CLOSES beyond the structural level AND the next candle holds the level as new support/resistance.',
      actionChangesWhen: 'Two consecutive 5-min closes confirm direction AND the lead pair shows momentum agreement on the trigger timeframe.',
      dollarConsequence: 'Avoids the $300–$800 drawdown band typical of chasing a first-move fake; the same setup post-confirmation pays $300–$800 in agreement direction.',
    },
    {
      step: 3,
      action: 'Widen exit-points by ~30% on existing positions; tight exits get hit before direction confirms.',
      why: 'Initial volatility expansion pushes price beyond historical 1-σ before the real direction prints — tight exits convert noise into realised loss.',
      ifIgnored: 'Tight exits get swept by the announcement-candle wick; the position is closed at a loss right before the structural direction confirms — the worst possible exit point.',
      confirmation: 'All open exits sit at least 1.3× the pre-event ATR distance away from current price by 5 minutes before the announcement.',
      actionChangesWhen: 'The 15-min candle close prints the real direction; tighter exits can be reapplied 30 minutes after confirmation if the move is mean-reverting.',
      dollarConsequence: 'Avoids being stopped on a wick that mean-reverts within 5 minutes — protects $150–$400 of carry on $100k notional through the event window.',
    },
  ];
}

// ─── CHUNK 7 — EVENT-DAY OPERATIONAL STORYTELLING ─────────────
// Phase + behaviour + danger + safety narrative.

function _operationalNarrativeFrom(severity, eventName, now) {
  const sev = String(severity || 'MED').toUpperCase();
  const ev = eventName || 'the lead catalyst';
  return {
    currentPhase: 'pre-event window (T-60 → T-0) into ' + ev,
    whatTheMarketIsDoing: 'Liquidity thinning; pre-event positioning visible in front-end yields and DXY; equity desks de-grossing before the announcement candle.',
    whyItIsDoingIt: 'Market participants reprice the rate-path BEFORE the catalyst lands; once the announcement prints, the move is the difference between consensus and actual.',
    whatChangesNext: 'At T-0 the announcement prints; the 5-min close at T+5 is the FIRST real read on direction; the 15-min close at T+15 is the REAL trend; the 1H close locks in the session bias.',
    whatTradersShouldAvoid: 'New entries inside the announcement candle, adding to losers in the pre-event window, chasing the first 60-second move, oversizing into thin liquidity.',
    whenConditionsBecomeSaferAgain: 'After the 15-min close at T+15 confirms direction AND the 1H close at T+60 locks in the trend. Position-sizing can return to normal ~6 hours after the catalyst if no follow-on event is on the calendar.',
    severity: sev,
    timestampUTC: _utcStamp(now),
  };
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
  const whatToDoNow = _expandActions(severity);
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

  // CHUNK 3 — full-day Market Intel coverage.
  const todaysAnnouncements = _todaysAnnouncementsFrom(engine.eventClusters);
  const primaryEvent = ev ? ev.e : null;
  const primaryEventFocus = {
    eventName,
    eventTimeUTC,
    severity,
    severityDiscs,
    volatilityWindow: _humanDuration(severity),
    affectedSymbols: keyMarkets,
    keyPriceZones: [
      'EURUSD reaction band ≈ 1.0928',
      'EURUSD downside liquidity ≈ 1.0880',
      'EURUSD upside liquidity ≈ 1.0980',
      'XAUUSD structural support ≈ 2380',
      'XAUUSD structural resistance ≈ 2440',
    ],
    likelyPaths: [
      'HIGHER surprise → USD bid, EURUSD breaks 1.0928 lower, XAUUSD pressured, US500 defensive.',
      'LOWER surprise → USD offered, EURUSD breaks 1.0928 upper, XAUUSD rallies, US500 bid.',
      'IN-LINE print → reaction band intact, mean-reversion inside the next 15 min.',
      'INITIAL-DIRECTION REVERSAL → first 60-second move faded; 15-min close prints the real trend.',
    ],
    confirmation: 'First 5-min close + DXY / lead pair confirmation in agreement.',
    cancellation: 'First 15-min close fails to follow through; geopolitical override hits the wire.',
  };
  const next24To72Hours = (opts.upcomingEvents && Array.isArray(opts.upcomingEvents) ? opts.upcomingEvents : []).map(e => ({
    timeUTC:      e.time || 'pending',
    currency:     e.currency || 'multi',
    title:        e.title || 'unnamed event',
    severity:     String(e.severity || 'MED').toUpperCase(),
    severityDiscs: _discScale(String(e.severity || 'MED').toUpperCase()),
    expectedSensitivity: e.expectedSensitivity || (String(e.severity || 'MED').toUpperCase() === 'HIGH' ? 'HIGH sensitivity — clustered-catalyst preparation required' : 'MODERATE sensitivity — monitor for cross-asset confirmation'),
    preparationGuidance: e.preparationGuidance || 'Pre-position size at 60% of normal in the 6 hours leading in; widen exits ~30% inside the announcement candle.',
  }));
  // Always carry at least the primary event in the upcoming list if
  // upstream didn't supply one, so the "NEXT 24–72 HOURS" section
  // never reads empty.
  if (!next24To72Hours.length && primaryEvent) {
    next24To72Hours.push({
      timeUTC: eventTimeUTC,
      currency: eventCcy,
      title: eventName,
      severity,
      severityDiscs,
      expectedSensitivity: 'Lead catalyst this cycle — directional gate for the next 6–24 hours.',
      preparationGuidance: 'Position size at 60% of normal in the 6 hours leading in; widen exits ~30% inside the announcement candle.',
    });
  }

  // CHUNK 4 — affected markets expanded.
  const affectedMarketsExpanded = _affectedMarketsExpandedFrom(keyMarkets);

  // CHUNK 5 — price map.
  const priceMap = _priceMapFrom(keyMarkets, eventName);

  // CHUNK 7 — event-day operational storytelling.
  const operationalNarrative = _operationalNarrativeFrom(severity, eventName, now);

  // Corey Clone — historical analogue base-rate authority (operator
  // brief 2026-05-17 post-deploy). Surfaces audit-grade analogues +
  // honest degradation in the FOH packet. cloneStatus carries the
  // engine-validator read so the view-model adapter can render
  // OK / PARTIAL / BLOCKED honestly in the Discord text.
  const cloneIn = opts.coreyClone || null;
  const clonePacket = cloneIn && cloneIn.packet ? cloneIn.packet : (cloneIn && (cloneIn.analogues || cloneIn.status) ? cloneIn : null);
  const cloneValidation = cloneIn && cloneIn.validation ? cloneIn.validation : null;
  const historicalReaction = clonePacket
    ? {
        available: true,
        symbol: clonePacket.symbol || (cloneIn && cloneIn.leadSymbol) || (keyMarkets[1] || 'EURUSD'),
        analogues: Array.isArray(clonePacket.analogues) ? clonePacket.analogues.slice(0, 5) : [],
        baseRates: clonePacket.baseRates || null,
        confidence: clonePacket.confidence != null ? clonePacket.confidence : null,
        warningFlags: clonePacket.warningFlags || [],
        timeframeRelevance: clonePacket.timeframeRelevance || null,
        cacheStatus: clonePacket.cacheStatus || null,
        denominatorPreFilter: clonePacket.denominator_pre_filter || null,
        matcherVersion: clonePacket.matcher_version || null,
        outcomeClassifierVersion: clonePacket.outcome_classifier_version || null,
      }
    : { available: false, reason: cloneIn === null ? 'engine_not_invoked_this_tick' : 'no_clone_packet_returned' };
  const cloneStatus = cloneValidation
    ? {
        status: cloneValidation.status || 'UNKNOWN',
        confidenceScore: cloneValidation.confidenceScore != null ? cloneValidation.confidenceScore : null,
        confidenceBasis: cloneValidation.confidenceBasis || null,
        validAnalogues: cloneValidation.validAnalogues != null ? cloneValidation.validAnalogues : null,
        droppedAnalogues: cloneValidation.droppedAnalogues != null ? cloneValidation.droppedAnalogues : null,
        degradedReason: cloneValidation.degradedReason || null,
      }
    : { status: 'NOT_INVOKED', confidenceBasis: 'Corey Clone not invoked this tick', validAnalogues: null };

  return {
    meta, header, briefingSummary, eventDayReference, fourWayOutcomes,
    marketImpact, riskEscalation, whatToDoNow, confirmationCancellation,
    provenance,
    todaysAnnouncements, primaryEventFocus, next24To72Hours,
    affectedMarketsExpanded, priceMap, operationalNarrative,
    historicalReaction, cloneStatus,
  };
}

module.exports = { buildMarketIntelPacket };
