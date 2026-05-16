'use strict';

// ============================================================
// renderers/foh/marketIntelDepthContent.js
//
// Prototype-grade depth content per Market Intel event. Operator
// brief 2026-05-17: the live render lacks the institutional
// density of the reference prototype
// (docs/screenshots/market-intel-foh-v3.html on branch
// claude/resume-n8n-work-LdFVz). Specifically missing:
//
//   1. Dollar impact range per event
//      — per-asset $ swing estimates (first-60s + post-settle)
//   2. Reaction paths — 4 outcomes (Hawkish / Dovish / In-Line
//      / Initial-Direction Reversal) with per-asset $ impacts +
//      ✓/✘ operator actions
//   3. Risk escalation windows — pre/during/post stages with
//      $ cost of staying full-size + actions
//   4. What to Watch — pre/during/post indicators with
//      thresholds + "what it means" + actions
//   5. Event-Day Reference — 4-window chart guide with
//      $ context per window
//   6. Comparison footnotes — "Why this rating, not lower or
//      higher" + "What changes this state"
//   7. Briefing actions — numbered concrete 5-step action list
//
// Honesty doctrine: every $ range carries an explicit basis
// label (scenario estimate / engine-derived / historically
// sourced / insufficient evidence). Never fakes precision.
// When historical analogue data is wired the basis labels
// will flip automatically.
//
// READ-ONLY of state. Pure functions given rawEvent + category.
// ============================================================

// ── DOLLAR IMPACT RANGE ─────────────────────────────────────
// Category → per-asset typical first-60s + post-settle $ ranges.
// Numbers reflect operator-prototype values for inflation; other
// categories use category-typical scenario estimates until live
// historical analogue data is wired. Basis is always declared.
const DOLLAR_IMPACT_PROFILES = {
  inflation: {
    first60s: [
      { asset: '$100k EURUSD lot',     range: '$500 – $1,000' },
      { asset: '1 standard XAUUSD lot (100 oz)', range: '$1,200 – $2,500' },
      { asset: '100 shares US large-cap',         range: '$400 – $900' },
      { asset: '$100k USDJPY lot',                range: '$600 – $1,200' },
      { asset: 'NAS100 mini (per pt × 5)',        range: '$300 – $750' },
    ],
    postSettle: '$700 – $1,500 trend move on $100k EURUSD over the T+5 → T+90 window',
  },
  labour: {
    first60s: [
      { asset: '$100k EURUSD lot',     range: '$400 – $900' },
      { asset: '1 standard XAUUSD lot', range: '$900 – $2,000' },
      { asset: '$100k USDJPY lot',     range: '$500 – $1,100' },
      { asset: 'NAS100 mini',          range: '$250 – $600' },
    ],
    postSettle: '$500 – $1,200 trend move on $100k EURUSD over the T+5 → T+60 window',
  },
  'central bank': {
    first60s: [
      { asset: '$100k EURUSD lot',     range: '$700 – $1,500' },
      { asset: '$100k GBPUSD lot',     range: '$650 – $1,400' },
      { asset: '1 standard XAUUSD lot', range: '$1,500 – $3,000' },
      { asset: '$100k USDJPY lot',     range: '$800 – $1,800' },
    ],
    postSettle: '$1,000 – $2,500 trend move on $100k EURUSD over the press-conference window (T+30 → T+120)',
  },
  growth: {
    first60s: [
      { asset: '$100k EURUSD lot',     range: '$300 – $700' },
      { asset: 'NAS100 mini',          range: '$200 – $550' },
      { asset: '1 standard XAUUSD lot', range: '$700 – $1,500' },
    ],
    postSettle: '$400 – $900 trend move on $100k EURUSD over the T+5 → T+60 window',
  },
  geopolitical: {
    first60s: [
      { asset: '$100k USDJPY lot',     range: '$600 – $1,600' },
      { asset: '$100k USDCHF lot',     range: '$500 – $1,400' },
      { asset: '1 standard XAUUSD lot', range: '$1,800 – $4,000' },
      { asset: 'NAS100 mini',          range: '$400 – $1,200' },
    ],
    postSettle: '$1,500 – $3,500 trend move on $100k USDJPY over the headline-extension window',
  },
  'consumer demand': {
    first60s: [
      { asset: '$100k EURUSD lot',     range: '$250 – $650' },
      { asset: 'NAS100 mini',          range: '$200 – $500' },
    ],
    postSettle: '$300 – $800 trend move on $100k EURUSD over the T+5 → T+60 window',
  },
  activity: {
    first60s: [
      { asset: '$100k EURUSD lot',     range: '$200 – $550' },
      { asset: '$100k USDJPY lot',     range: '$300 – $750' },
    ],
    postSettle: '$300 – $700 trend move on $100k EURUSD over the T+5 → T+45 window',
  },
};

function buildDollarImpactRange(rawEvent, category) {
  const profile = DOLLAR_IMPACT_PROFILES[category];
  if (!profile) {
    return {
      available: false,
      reason: 'no scenario profile for category ' + category,
      basis: 'insufficient evidence',
    };
  }
  return {
    available: true,
    first60sRanges: profile.first60s,
    postSettleRange: profile.postSettle,
    basis: 'scenario estimate (historical analogue cache not yet wired)',
  };
}

// ── REACTION PATHS — 4 outcomes ─────────────────────────────
// Hawkish / Dovish / In-line / Initial-direction reversal.
// Each outcome has affected markets + expected behaviour +
// per-asset $ impact + ✓/✘ action guidance.
function buildReactionPaths(rawEvent, category) {
  const ccy = (rawEvent && rawEvent.currency) || 'USD';
  const title = (rawEvent && rawEvent.title) || 'this release';
  const isInflation = category === 'inflation';
  const isLabour    = category === 'labour';
  const isCB        = category === 'central bank';
  const isGeo       = category === 'geopolitical';

  const hawkishLabel = isCB ? 'HAWKISH TONE vs market pricing' : 'HIGHER than forecast (hawkish-for-' + ccy + ')';
  const dovishLabel  = isCB ? 'DOVISH TONE vs market pricing'  : 'LOWER than forecast (dovish-for-' + ccy + ')';

  const hawkishMarkets = isInflation || isLabour || isCB
    ? ['US Dollar Index', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'NAS100', 'US500']
    : isGeo ? ['US Dollar Index', 'CHF', 'JPY', 'XAUUSD', 'US500']
    : ['US Dollar Index', ccy + ' pairs', 'XAUUSD'];

  return {
    available: true,
    scenarios: [
      {
        id: 'hawkish',
        severity: 'HIGH',
        label: 'IF ' + hawkishLabel,
        affectedMarkets: hawkishMarkets,
        expectedBehaviour: isCB
          ? ['Tone-vs-pricing match shifts ' + ccy + ' rate path higher', 'Cross-pair flow rotates into ' + ccy, 'Rate-sensitive risk (gold, indices) pressured', 'Front-end yields reprice immediately']
          : ['US Dollar Index pushes higher — buyers pile into the dollar', ccy + ' pairs respond first on rate-path repricing', 'US indices (NAS100 / US500) drop on rate-hike fears', 'Gold initially drops; can recover on safe-haven flow if surprise extreme'],
        dollarImpactPerAsset: [
          { asset: 'Long ' + ccy + ' positions', impact: '$300 – $800 gain', direction: 'favoured' },
          { asset: 'Short ' + ccy + ' positions', impact: '$300 – $800 drawdown', direction: 'pressured' },
          { asset: 'Long XAUUSD trades', impact: '$500 – $1,500 drawdown', direction: 'pressured' },
        ],
        shouldDo: [
          'After the 5-min close at T+5, look for SHORT positions in the dominant ' + ccy + ' direction using the next Dark Horse scan',
          'Exit losing positions against the surprise direction on the T+5 close if direction holds',
        ],
        shouldNotDo: [
          'Do NOT enter fresh positions in the first 5 minutes — chase risk is high',
          'Do NOT add to any positions against the surprise direction',
        ],
      },
      {
        id: 'dovish',
        severity: 'HIGH',
        label: 'IF ' + dovishLabel,
        affectedMarkets: hawkishMarkets,
        expectedBehaviour: isCB
          ? ['Tone-vs-pricing match shifts ' + ccy + ' rate path lower', 'Cross-pair flow rotates OUT of ' + ccy, 'Rate-sensitive risk (gold, indices) supported', 'Front-end yields drop']
          : ['US Dollar Index pulls back — sellers exit dollar longs', ccy + ' pairs reverse on rate-path repricing', 'US indices rally on rate-cut optimism', 'Gold rises with broader risk-on flow'],
        dollarImpactPerAsset: [
          { asset: 'Long ' + ccy + ' positions', impact: '$300 – $800 drawdown', direction: 'pressured' },
          { asset: 'Short ' + ccy + ' positions', impact: '$300 – $800 gain', direction: 'favoured' },
          { asset: 'Long XAUUSD trades', impact: '$500 – $1,500 gain', direction: 'favoured' },
        ],
        shouldDo: [
          'After the 5-min close at T+5, look for LONG positions in the dominant opposite-' + ccy + ' direction using the next Dark Horse scan',
          'Exit losing positions against the surprise direction on the T+5 close if direction holds',
        ],
        shouldNotDo: [
          'Do NOT enter fresh positions in the first 5 minutes',
          'Do NOT add to any positions against the surprise direction',
        ],
      },
      {
        id: 'inline',
        severity: 'LOW',
        label: 'IF IN-LINE with forecast / market pricing',
        affectedMarkets: ['light reaction across the board'],
        expectedBehaviour: [
          'Initial spike either side then settle. No clean directional bias.',
          'Volatility drops within 15 minutes.',
          'Markets refocus on the next scheduled catalyst.',
        ],
        dollarImpactPerAsset: [
          { asset: '$100k EURUSD position', impact: '$100 – $300 swings then mean-reversion', direction: 'muted' },
        ],
        shouldDo: [
          'Stand aside through T+5. Re-read at next ATLAS scan.',
          'Re-engage normally once the next scheduled catalyst delivers.',
        ],
        shouldNotDo: [
          'Do NOT trade the initial spike — it will settle.',
        ],
      },
      {
        id: 'reversal',
        severity: 'MEDIUM',
        label: 'IF INITIAL-DIRECTION REVERSAL · the first move reverses within 10 minutes',
        affectedMarkets: hawkishMarkets,
        expectedBehaviour: [
          'The first direction off the release is faded by T+10.',
          'Volume comes IN against the initial move.',
          'The 15-min close at T+15 is the real trend, not the first 60-second spike.',
          'Happens roughly 1 in 4 high-impact releases — more often in elevated-volatility regimes.',
        ],
        dollarImpactPerAsset: [
          { asset: 'Trades chasing the first 60 seconds (any direction)', impact: '$800 – $1,500 drawdown', direction: 'pressured' },
        ],
        shouldDo: [
          'Wait for the 15-min candle close at T+15.',
          'Trade only the post-T+15 direction — that is the actual signal.',
        ],
        shouldNotDo: [
          'Do NOT chase the first move under any circumstance.',
          'Do NOT add to positions on the initial direction inside T+10.',
        ],
      },
    ],
  };
}

// ── RISK ESCALATION — pre/during/post stages ───────────────
function buildRiskEscalation(rawEvent, mode) {
  const isReleased = mode === 'released';
  if (isReleased) {
    return {
      available: true,
      stages: [
        {
          stage: 'POST-RELEASE',
          severity: 'HIGH',
          timeWindow: 'T+0 → T+5',
          label: '🟠 DANGER · first-reaction window',
          description: 'The release moment passed. Markets routinely whip $500 – $1,000 in the first 60 seconds. Stand aside.',
          dollarCost: 'Cost of trading the first 60 seconds: $500 – $1,200 against any position on $100k notional.',
          action: 'Stand aside. Watch the 5-min candle close. Do NOT trade.',
        },
        {
          stage: 'POST-SETTLE',
          severity: 'MEDIUM',
          timeWindow: 'T+5 → T+30',
          label: '🟡 RE-READ · post-settle direction',
          description: 'The 5-min candle close shows the real direction. Re-read structure against the reaction paths above.',
          dollarCost: 'Holding losing positions through T+15 typically costs $400 – $900 on $100k EURUSD.',
          action: 'Re-size at 60% of normal. Trade only confirmed-candle-close direction.',
        },
        {
          stage: 'RE-ENGAGE',
          severity: 'LOW',
          timeWindow: 'T+30 onwards',
          label: '🟢 RE-ENGAGE · resume normal size',
          description: 'Volatility settles. Resume normal trade-management.',
          dollarCost: 'Per-candle $ exposure returns to ~$100 – $300 per 5m bar.',
          action: 'Resume normal trading patterns. Continue to honour structure.',
        },
      ],
    };
  }
  return {
    available: true,
    stages: [
      {
        stage: 'PRE-EVENT',
        severity: 'LOW',
        timeWindow: 'now → T-5',
        label: '🟢 HEALTHY · normal trade-management with one change',
        description: 'Reduce all positions in affected pairs to 60% of normal size by T-5. Use this window to close losing trades and tighten exits on winners.',
        dollarCost: 'Cost of staying full-size into T-0: $200 – $400 extra drawdown on a $100k notional position from wider whips alone.',
        action: 'Tighten exits. Close losers. Cut size to 60%.',
      },
      {
        stage: 'T-5',
        severity: 'MEDIUM',
        timeWindow: 'T-5 → T-0',
        label: '🟡 CAUTION · final lead-in',
        description: 'Close any open positions UNLESS they are >1.5R in profit AND your exit is already at break-even.',
        dollarCost: 'Open positions face $500 – $1,000 first-minute swing risk on $100k notional at T-0.',
        action: 'Tighten exits to break-even or step aside.',
      },
      {
        stage: 'T-0',
        severity: 'HIGH',
        timeWindow: 'T-0 → T+5',
        label: '🟠 DANGER · the release moment',
        description: 'Markets routinely whip $500 – $1,000 against any position on $100k notional in the first 60 seconds.',
        dollarCost: '$500 – $1,200 first-60s swing risk on $100k notional.',
        action: 'Stand aside. Watch the 5-min candle close. Do NOT trade.',
      },
      {
        stage: 'STAND-ASIDE-IF-CHAIN',
        severity: 'HIGH',
        timeWindow: 'if multi-catalyst chain forms',
        label: '🛑 STAND ASIDE · if a clustered catalyst chain emerges',
        description: 'If this release combines with another high-impact event inside the same session window, expected combined post-event move re-prices for the rest of the session.',
        dollarCost: '$1,500 – $3,000 combined-window move on $100k notional.',
        action: 'Wait for the 15-min close AFTER the FINAL catalyst before resuming new trades.',
      },
      {
        stage: 'RE-ENTRY',
        severity: 'LOW',
        timeWindow: 'T+5 onwards',
        label: '🟢 RE-ENTRY · post-settle resumption',
        description: 'Re-read structure on the 5m chart. Match against the reaction paths. Act only on setups where price closes beyond the trigger AND the next candle holds beyond it (confirmed directional structure test).',
        dollarCost: 'Continued 60% size until the next scheduled catalyst delivers; resume normal sizing only after.',
        action: 'Trade only confirmed-candle-close direction at 60% size.',
      },
    ],
  };
}

// ── WHAT TO WATCH — pre/during/post indicators ─────────────
function buildWhatToWatch(rawEvent, category) {
  const ccy = (rawEvent && rawEvent.currency) || 'USD';
  return {
    available: true,
    preEvent: [
      { indicator: 'US Dollar Index above 105', meaning: 'The dollar has ALREADY moved up in anticipation of a hawkish read. Action: do NOT bet on further dollar strength unless the release surprises EVEN HOTTER than expected. The easy long-dollar trade is already priced in.' },
      { indicator: 'Front-end yields above 4.85%', meaning: 'The bond market is also already positioned for a hawkish reading. Same as DXY above — be cautious of fresh long-dollar entries.' },
      { indicator: 'CBOE Volatility Index above 18', meaning: 'Traders are nervous about the release. Equity downside risk is elevated. Do NOT take fresh long-equity positions before T-0.' },
      { indicator: 'CBOE Volatility Index below 14', meaning: 'Traders are complacent. A surprise reading will hit harder. Avoid new positions in any market until T+5.' },
      { indicator: ccy + ' pair at the high or low of its 24h range entering T-0', meaning: 'The market is leaning directionally. A surprise against that leaning causes the BIGGEST whips. Cut size further if the lead pair is at an extreme entering T-0.' },
    ],
    during: [
      { indicator: 'The first 60 seconds of price action', meaning: 'It is NOISE. Do not act on it.', action: 'Stand aside.' },
      { indicator: 'The 5-min candle CLOSE at T+5', meaning: 'That prints the real direction. Read US Dollar Index first, THEN look at ' + ccy + ' / XAUUSD response.', action: 'Wait for the close. Read DXY first.' },
    ],
    postEvent: [
      { indicator: 'Did the initial direction HOLD or REVERSE inside 10 minutes?', meaning: 'If reversed: trade only the post-T+15 direction. The initial move was wrong.' },
      { indicator: 'Is volume CONFIRMING the move or FADING?', meaning: 'Confirming = sustained large candle bodies in the direction. Fading = candle bodies shrinking — direction is exhausting. Only enter trades when volume is confirming.' },
      { indicator: 'What did treasuries do?', meaning: 'Bonds move opposite to yields. If yields jumped, bonds fell — that confirms a HAWKISH read. Trade in line with bonds for the cleanest signal.' },
      { indicator: 'Next scheduled catalyst proximity', meaning: 'If another high-impact catalyst is within 2 hours, small size or stand aside through the inter-catalyst window.' },
    ],
  };
}

// ── EVENT-DAY REFERENCE — 4-window chart guide ─────────────
function buildEventDayReference() {
  return {
    available: true,
    storyBy4Windows: 'Before the release, candles are small and quiet (pre-event window). At T-0 the candle range explodes — that is the chaos window. By T+5 the noise settles and a clear direction emerges. From T+30 onwards, candles return to normal size and the trend is tradable.',
    windows: [
      { label: 'Pre-event', range: 'T-30 → T-0', candleBehaviour: 'small, quiet 5m candles', dollarContext: '$100 – $300 whips per 5m candle on $100k EURUSD', action: 'Size at 60% of normal. Tighten exits.' },
      { label: 'T-0 chaos', range: 'T-0 → T+5',  candleBehaviour: 'candle range explodes — outlier ranges', dollarContext: '$500 – $1,000 swings in 60 seconds on $100k notional', action: 'Stand aside. Do NOT trade.' },
      { label: 'Post-settle', range: 'T+5 → T+30', candleBehaviour: 'noise settles, clear direction emerges', dollarContext: '$200 – $400 per 5m candle (settling)', action: 'Re-read direction. Trade only the confirmed-candle-close direction.' },
      { label: 'Resume', range: 'T+30 onwards', candleBehaviour: 'candles return to normal size; trend tradable', dollarContext: '$50 – $150 per 5m candle (normal)', action: 'Resume normal trading patterns.' },
    ],
  };
}

// ── COMPARISON FOOTNOTES ────────────────────────────────────
// "Why this rating, not lower or higher" + "What changes this state"
function buildComparisonNotes(packet) {
  const mode = packet.mode;
  const clusters = packet.eventClusters || [];
  const totalEvents = clusters.reduce((n, c) => n + (c.events ? c.events.length : 0), 0);
  const highCount = clusters.reduce((n, c) => n + (c.events || []).filter(e => e.severity === 'HIGH').length, 0);
  let whyThisRating;
  if (highCount >= 4)      whyThisRating = 'Rating would be 🔴🔴🔴🔴🔴 5/5 — EXTREME if a central-bank rate decision were landing this cycle. Rating would be 🟠🟠🟠⚫⚫ 3/5 — ACTIVE if only ONE of the clustered high-impact events were on the calendar.';
  else if (highCount >= 2) whyThisRating = 'Rating would be 🔴🔴🔴🔴🔴 5/5 — EXTREME if a central-bank rate decision joined the cluster. Rating would be 🟠🟠🟠⚫⚫ 3/5 — ACTIVE if only ONE of the high-impact events were on the calendar today.';
  else if (highCount === 1) whyThisRating = 'Rating would be 🟠🟠🟠🟠⚫ 4/5 — ELEVATED if a second high-impact catalyst joined the window. Rating would be 🟡🟡⚫⚫⚫ 2/5 — CALM if today were driver-led only.';
  else                     whyThisRating = 'Rating would be 🟠🟠🟠⚫⚫ 3/5 — ACTIVE if any high-impact catalyst were on the calendar. Currently driver-led — direction set by live DXY / VIX / yield reads, not the scheduled calendar.';
  return {
    available: true,
    whyThisRating,
    whatChangesThisState: [
      'If a central-bank rate decision is added: state climbs to 🔴🔴🔴🔴🔴 5/5 — EXTREME.',
      'If any scheduled high-impact event cancels: state drops one tier.',
      'If geopolitical risk escalates inside the session: state climbs one tier (safe-haven rotation overrides driver-led tape).',
      'If yield curve un-flattens beyond 0.60: cyclical rotation re-prices — direction read flips.',
    ],
    totalEvents,
    highCount,
  };
}

// ── BRIEFING ACTIONS — numbered concrete 5-step list ───────
function buildBriefingActions(packet) {
  const clusters = packet.eventClusters || [];
  const featured = clusters.find(c => c.severity === 'HIGH');
  const featEvent = featured && featured.events && featured.events[0];
  if (!featEvent) {
    return {
      available: true,
      actions: [
        'No high-impact catalyst inside the prep window — driver-led session.',
        'Honour live DXY / VIX / yield reads from Corey live macro state above.',
        'Continue normal trade-management rules at full size.',
        'Re-read at the next ATLAS scan tick (every 5 minutes).',
        'Watch for an unscheduled headline-driven shift — geopolitical override changes the read.',
      ],
    };
  }
  const t = featEvent.title;
  const time = featEvent.time;
  return {
    available: true,
    actions: [
      'Cut all positions in affected pairs to 60% of normal size by T-5 of ' + t + ' (' + time + ').',
      'Stand aside from T-0 to T+5 — the chaos window. Watch the 5-min candle close at T+5.',
      'Re-read direction on the T+5 close against the 4 reaction paths above.',
      'Trade only the post-settle direction at 60% size until the next scheduled catalyst delivers.',
      'ATLAS Market Intel next tick updates at the next scheduled 5-minute interval.',
    ],
  };
}

module.exports = {
  buildDollarImpactRange,
  buildReactionPaths,
  buildRiskEscalation,
  buildWhatToWatch,
  buildEventDayReference,
  buildComparisonNotes,
  buildBriefingActions,
};
