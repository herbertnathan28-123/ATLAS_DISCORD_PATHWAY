'use strict';

/**
 * Operational macro interpreter for Market Intel / Jane / FOH.
 *
 * Turns raw TradingView calendar rows plus live macro state into a structured
 * macroIntelligencePacket. It does not issue trade advice; it classifies
 * catalysts, transmission channels, affected markets, risk state, confidence,
 * and degradation so Jane can synthesize and FOH can render.
 */

const MAJOR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];

const CURRENCY_MARKETS = Object.freeze({
  USD: ['DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US500', 'NAS100'],
  EUR: ['EURUSD', 'EURGBP', 'EURJPY', 'DAX40', 'STOXX50'],
  GBP: ['GBPUSD', 'EURGBP', 'GBPJPY', 'UK100'],
  JPY: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'JPN225'],
  AUD: ['AUDUSD', 'AUDJPY', 'AUDNZD', 'AU200'],
  CAD: ['USDCAD', 'CADJPY', 'USOIL'],
  CHF: ['USDCHF', 'EURCHF', 'CHFJPY', 'XAUUSD'],
  NZD: ['NZDUSD', 'AUDNZD', 'NZDJPY'],
});

const EVENT_TYPE_RULES = [
  { type: 'inflation', weight: 38, re: /\b(cpi|pce|inflation|ppi|consumer price|producer price|prices)\b/i },
  { type: 'rate_decision', weight: 42, re: /\b(rate decision|interest rate|policy rate|fed funds|deposit rate|cash rate)\b/i },
  { type: 'central_bank_speech', weight: 32, re: /\b(fed|fomc|ecb|boe|boj|rba|boc|snb|rbnz|powell|lagarde|bailey|ueda|minutes|press conference|speech|testimony)\b/i },
  { type: 'employment', weight: 36, re: /\b(nfp|nonfarm|payroll|employment|unemployment|jobless|jobs|wage|earnings)\b/i },
  { type: 'growth', weight: 30, re: /\b(gdp|gross domestic|growth)\b/i },
  { type: 'activity', weight: 26, re: /\b(pmi|ism|manufacturing|services|industrial production)\b/i },
  { type: 'consumer', weight: 24, re: /\b(retail sales|consumer confidence|consumer sentiment|spending)\b/i },
  { type: 'fiscal_geopolitical', weight: 34, re: /\b(budget|fiscal|tariff|sanction|war|attack|invasion|geopolitical|risk event)\b/i },
];

function iso(ms) {
  const n = Number(ms);
  if (Number.isFinite(n)) return new Date(n).toISOString();
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function titleOf(e) {
  return String((e && (e.title || e.event || e.name || e.description)) || 'unnamed event').trim();
}

function currencyOf(e) {
  const raw = String((e && (e.currency || e.ccy || e.countryCurrency)) || '').toUpperCase();
  if (MAJOR_CURRENCIES.includes(raw)) return raw;
  const t = titleOf(e).toUpperCase();
  if (/^(US|U\.S\.|UNITED STATES)|\bUSD\b|\bFED\b|\bFOMC\b/.test(t)) return 'USD';
  if (/EURO|ECB|\bEUR\b/.test(t)) return 'EUR';
  if (/UK|BOE|\bGBP\b/.test(t)) return 'GBP';
  if (/JAPAN|BOJ|\bJPY\b/.test(t)) return 'JPY';
  if (/AUSTRALIA|RBA|\bAUD\b/.test(t)) return 'AUD';
  if (/CANADA|BOC|\bCAD\b/.test(t)) return 'CAD';
  if (/SWISS|SNB|\bCHF\b/.test(t)) return 'CHF';
  if (/NEW ZEALAND|RBNZ|\bNZD\b/.test(t)) return 'NZD';
  return raw || 'MULTI';
}

function timeMsOf(e) {
  const raw = e && (e.scheduled_time || e.time || e.timestamp || e.datetime || e.date);
  if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

function sessionOf(ms) {
  if (!Number.isFinite(ms)) return 'unscheduled';
  const h = new Date(ms).getUTCHours();
  if (h >= 22 || h < 7) return 'Sydney/Tokyo';
  if (h < 12) return 'London';
  if (h < 21) return 'New York';
  return 'late-New-York';
}

function openProximityScore(ms) {
  if (!Number.isFinite(ms)) return 0;
  const d = new Date(ms);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const opens = [
    22 * 60, // Sydney / FX week open region
    0,      // Tokyo
    7 * 60, // London
    12 * 60 + 30, // New York data / cash lead window
    14 * 60 + 30, // US cash open
  ];
  let best = 1440;
  for (const o of opens) {
    const diff = Math.min(Math.abs(minutes - o), 1440 - Math.abs(minutes - o));
    if (diff < best) best = diff;
  }
  if (best <= 30) return 10;
  if (best <= 60) return 7;
  if (best <= 120) return 4;
  return 0;
}

function eventTypeOf(title) {
  for (const r of EVENT_TYPE_RULES) if (r.re.test(title)) return { type: r.type, weight: r.weight };
  return { type: 'standard_macro', weight: 12 };
}

function importanceScore(e) {
  const raw = String((e && (e.importance || e.impact || e.severity || e.priority)) || '').toLowerCase();
  if (/high|3|red/.test(raw)) return 30;
  if (/medium|med|2|orange/.test(raw)) return 18;
  if (/low|1|yellow/.test(raw)) return 6;
  return 10;
}

function affectedMarketsFor(currency, eventType) {
  const out = new Set(CURRENCY_MARKETS[currency] || ['DXY', 'EURUSD', 'XAUUSD', 'US500']);
  if (eventType === 'inflation' || eventType === 'rate_decision' || eventType === 'central_bank_speech' || eventType === 'employment') {
    out.add('DXY'); out.add('US10Y'); out.add('XAUUSD'); out.add('US500'); out.add('NAS100');
  }
  if (currency === 'AUD' || currency === 'JPY') out.add('AUDJPY');
  return [...out];
}

function classifyAsset(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (/^[A-Z]{6}$/.test(s) || ['DXY', 'US10Y'].includes(s)) return 'FX/rates';
  if (/XAU|XAG|OIL|WTI|BRENT/.test(s)) return 'commodity';
  if (/US500|NAS100|US30|DAX|STOXX|UK100|JPN225|AU200/.test(s)) return 'index';
  return 'cross-asset';
}

function transmissionFor(symbol, driver, currency) {
  const s = String(symbol || '').toUpperCase();
  const ccy = currency || 'macro';
  if (s === 'DXY') return 'Dollar basket reprices as ' + ccy + ' rate expectations move.';
  if (s === 'US10Y') return 'Yields reprice the policy path and growth/inflation premium.';
  if (s === 'XAUUSD') return 'Gold moves through USD strength, real yields, and risk sentiment.';
  if (/US500|NAS100|US30/.test(s)) return 'US indices move through rates, liquidity expectations, and risk appetite.';
  if (/JPY/.test(s)) return 'JPY crosses move through yield differentials plus safe-haven flow.';
  if (/AUD|NZD/.test(s)) return 'High-beta FX moves through local macro plus global risk sentiment.';
  if (/USD/.test(s)) return 'USD leg and relative rate expectations drive the pair.';
  return 'Macro surprise flows through relative rates, risk appetite, and session liquidity.';
}

function normalizeEvent(e, now) {
  const title = titleOf(e);
  const ccy = currencyOf(e);
  const ms = timeMsOf(e);
  const et = eventTypeOf(title);
  const affected = affectedMarketsFor(ccy, et.type);
  const proximityHours = Number.isFinite(ms) ? Math.abs(ms - now) / 36e5 : 999;
  const timingScore = proximityHours <= 6 ? 12 : proximityHours <= 24 ? 8 : proximityHours <= 72 ? 4 : 0;
  const currencyScore = MAJOR_CURRENCIES.includes(ccy) ? 10 : 2;
  const score = importanceScore(e) + et.weight + currencyScore + timingScore + openProximityScore(ms);
  return {
    title,
    currency: ccy,
    eventType: et.type,
    scheduled_time: ms,
    timeUTC: iso(ms),
    session: sessionOf(ms),
    importance: e && (e.importance || e.impact || e.severity || null),
    impactScore: score,
    affectedMarkets: affected,
    reasonRanked: [
      'importance=' + importanceScore(e),
      'eventType=' + et.type,
      'typeWeight=' + et.weight,
      'currency=' + ccy,
      'session=' + sessionOf(ms),
    ].join(' · '),
    rawEvent: e,
  };
}

function clusterEvents(events) {
  const sorted = events.slice().sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0));
  const clusters = [];
  for (const ev of sorted) {
    const last = clusters[clusters.length - 1];
    const sameCurrency = last && last.currency === ev.currency;
    const closeTime = last && Number.isFinite(ev.scheduled_time) && Number.isFinite(last.endMs) && ev.scheduled_time - last.endMs <= 3 * 60 * 60 * 1000;
    const relatedType = last && (last.types.has(ev.eventType) || /central_bank|inflation|employment|growth|activity/.test(ev.eventType));
    if (last && sameCurrency && closeTime && relatedType) {
      last.events.push(ev);
      last.endMs = Math.max(last.endMs, ev.scheduled_time || last.endMs);
      last.types.add(ev.eventType);
      for (const s of ev.affectedMarkets) last.affectedSet.add(s);
      last.score += ev.impactScore;
    } else {
      clusters.push({
        currency: ev.currency,
        session: ev.session,
        startMs: ev.scheduled_time,
        endMs: ev.scheduled_time,
        events: [ev],
        types: new Set([ev.eventType]),
        affectedSet: new Set(ev.affectedMarkets),
        score: ev.impactScore,
      });
    }
  }
  return clusters.map((c, i) => {
    const impact = c.score >= 140 ? 'EXTREME' : c.score >= 90 ? 'ELEVATED' : c.score >= 55 ? 'ACTIVE' : 'QUIET';
    const affectedMarkets = [...c.affectedSet];
    const eventTitles = c.events.map(e => e.title).join(' + ');
    return {
      clusterId: c.currency + '-' + (i + 1),
      currency: c.currency,
      session: c.session,
      startUTC: iso(c.startMs),
      endUTC: iso(c.endMs),
      events: c.events,
      clusterImpact: impact,
      whyClusterMatters: c.events.length > 1
        ? c.events.length + ' related ' + c.currency + ' events compress into one risk window: ' + eventTitles + '.'
        : eventTitles + ' is the active ' + c.currency + ' macro window.',
      affectedMarkets,
      riskStateContribution: impact + ' contribution from score ' + Math.round(c.score) + ' and ' + c.events.length + ' event(s).',
      score: c.score,
    };
  });
}

function buildAffectedMarketsExpanded(markets, primary) {
  return markets.map(symbol => {
    const mechanism = transmissionFor(symbol, primary && primary.eventType, primary && primary.currency);
    return {
      symbol,
      instrument: symbol, // FOH compatibility
      assetClass: classifyAsset(symbol),
      affectedBy: primary ? primary.title : 'live macro drivers',
      transmissionMechanism: mechanism,
      howAffected: mechanism,
      strongerThanExpectedPath: 'Stronger/hawkish outcome lifts the policy-rate or risk-premium side first; confirm with DXY/yields and the first candle close.',
      strongerResult: 'Stronger/hawkish outcome pushes the instrument through its macro-sensitive leg if live structure agrees.',
      weakerThanExpectedPath: 'Weaker/dovish outcome lowers the rate or growth impulse; confirm by failure of the initial opposite-side move.',
      weakerResult: 'Weaker/dovish outcome favours the reverse rotation if the first 5m/15m close confirms.',
      confirmationCondition: 'DXY/yields/lead pair move in agreement and the next 5m/15m candle holds outside the reaction band.',
      confirmation: 'DXY/yields/lead pair agreement plus confirmed 5m/15m candle close.',
      invalidationCondition: 'Initial impulse fades back inside the pre-event range or cross-market driver diverges.',
      invalidation: 'Impulse fades back inside the pre-event range or the macro driver diverges.',
      keyPriceLevels: 'Use live Spidey/price map levels; if unavailable, use pre-event high/low, VWAP, and prior session range.',
      riskNote: 'Release windows widen spreads and can fake the first move; no execution validity without structure confirmation.',
      confidence: primary ? Math.max(0.25, Math.min(0.95, primary.impactScore / 100)) : 0.35,
    };
  });
}

function buildTransmissionMap(primary, affectedMarkets, liveState) {
  if (!primary) {
    return [{
      driver: 'Driver-led session',
      mechanism: 'No dominant scheduled catalyst; DXY, VIX, yields, and session liquidity set direction.',
      firstOrderEffect: 'Macro drivers lead price rather than calendar surprise.',
      secondOrderEffect: 'Affected symbols react only after cross-market confirmation.',
      affectedSymbols: affectedMarkets,
      whatStrengthensThis: 'DXY/VIX/yields move together through the active session window.',
      whatWeakensThis: 'Drivers diverge or mean-revert before structure confirms.',
      evidenceSources: ['Corey live state', 'TradingView calendar'],
    }];
  }
  const hot = primary.eventType === 'inflation' ? 'Hot inflation' :
    primary.eventType === 'employment' ? 'Strong labour data' :
    primary.eventType === 'rate_decision' || primary.eventType === 'central_bank_speech' ? 'Hawkish central-bank repricing' :
    primary.eventType === 'growth' ? 'Growth surprise' :
    primary.title;
  return [{
    driver: hot + ' - ' + primary.currency,
    mechanism: 'Surprise versus forecast changes rate-path, growth, or risk-premium expectations.',
    firstOrderEffect: primary.currency + ' and yields reprice first.',
    secondOrderEffect: affectedMarkets.join(', ') + ' respond through USD, rates, gold, and index-risk channels.',
    affectedSymbols: affectedMarkets,
    whatStrengthensThis: 'DXY/yields/lead pair hold the surprise direction beyond the first 5m/15m close.',
    whatWeakensThis: 'DXY fades, yields fail to hold, or price closes back inside the pre-event range.',
    evidenceSources: ['TradingView calendar', 'Corey live state', liveState ? 'live macro drivers' : 'live macro unavailable'],
  }];
}

function riskStateFrom(events, clusters, liveState, now) {
  const eventScore = events.slice(0, 8).reduce((s, e) => s + e.impactScore, 0) / 25;
  const clusterScore = clusters.filter(c => c.events.length > 1).length * 0.8;
  const vixRaw = liveState && (liveState.vix && (liveState.vix.price || liveState.vix.level || liveState.vix.value));
  const vixNum = Number(vixRaw);
  const vixScore = Number.isFinite(vixNum) ? (vixNum >= 25 ? 1.2 : vixNum >= 18 ? 0.6 : 0.1) : 0.3;
  const missingPenalty = liveState ? 0 : 0.5;
  const score = Math.max(1, Math.min(5, Math.round(eventScore + clusterScore + vixScore + missingPenalty)));
  const label = score >= 5 ? 'EXTREME' : score >= 4 ? 'ELEVATED' : score >= 2 ? 'ACTIVE' : 'QUIET';
  const sessionWindow = sessionOf(now);
  return {
    label,
    scoreOutOf5: score,
    severityColour: label === 'EXTREME' ? 'red' : label === 'ELEVATED' ? 'orange' : label === 'ACTIVE' ? 'amber' : 'blue',
    whyThisRating: events.length
      ? events.length + ' relevant event(s), ' + clusters.length + ' cluster(s), live VIX input ' + (vixRaw == null ? 'missing' : String(vixRaw)) + ', active session ' + sessionWindow + '.'
      : 'No major scheduled catalyst; rating is driven by live DXY/VIX/yields and session positioning.',
    whatWouldRaiseIt: 'Additional high-impact cluster, VIX lift, DXY/yield breakout, or event inside an open/liquidity window.',
    whatWouldLowerIt: 'No nearby catalyst, VIX compression, DXY/yield mean reversion, or events passing without follow-through.',
    sessionWindow,
  };
}

function interpretCalendarEvents(input) {
  input = input || {};
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const rawEvents = Array.isArray(input.events) ? input.events : [];
  const sourceHealth = input.sourceHealth || input.health || {};
  const liveState = input.liveState || input.liveCtx || null;
  const rankedAll = rawEvents.map(e => normalizeEvent(e, now)).sort((a, b) => b.impactScore - a.impactScore);
  const next72 = rankedAll.filter(e => Number.isFinite(e.scheduled_time) && e.scheduled_time >= now - 30 * 60 * 1000 && e.scheduled_time <= now + 72 * 60 * 60 * 1000);
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setUTCHours(23, 59, 59, 999);
  const today = rankedAll.filter(e => Number.isFinite(e.scheduled_time) && e.scheduled_time >= dayStart.getTime() && e.scheduled_time <= dayEnd.getTime());
  const relevant = rankedAll.filter(e => e.impactScore >= 38);
  const todayRelevant = today.filter(e => e.impactScore >= 38).slice(0, 12);
  const next72Relevant = next72.filter(e => e.impactScore >= 38).slice(0, 24);
  const clusters = clusterEvents(next72Relevant.length ? next72Relevant : relevant.slice(0, 12));
  const primaryCluster = clusters.slice().sort((a, b) => b.score - a.score)[0] || null;
  const primaryEvent = primaryCluster ? primaryCluster.events.slice().sort((a, b) => b.impactScore - a.impactScore)[0] : (next72Relevant[0] || relevant[0] || null);
  const affectedSymbols = primaryCluster ? primaryCluster.affectedMarkets : (primaryEvent ? primaryEvent.affectedMarkets : ['DXY', 'EURUSD', 'XAUUSD', 'US500']);
  const affectedMarketsExpanded = buildAffectedMarketsExpanded(affectedSymbols, primaryEvent);
  const riskState = riskStateFrom(next72Relevant, clusters, liveState, now);
  const macroTransmissionMap = buildTransmissionMap(primaryEvent, affectedSymbols, liveState);
  const degraded = [];
  if (!rawEvents.length) degraded.push('calendar returned zero events');
  if (rawEvents.length && !relevant.length) degraded.push('all calendar events downgraded: low importance, unsupported currency, distant timing, or unclassified event type');
  if (!liveState) degraded.push('live Corey state missing or stale');

  const primaryEventFocus = primaryEvent ? {
    title: primaryCluster && primaryCluster.events.length > 1 ? primaryCluster.events.map(e => e.title).join(' + ') : primaryEvent.title,
    currency: primaryEvent.currency,
    eventType: primaryEvent.eventType,
    timeUTC: primaryCluster ? primaryCluster.startUTC : primaryEvent.timeUTC,
    session: primaryEvent.session,
    expectedImpact: primaryCluster ? primaryCluster.clusterImpact : (primaryEvent.impactScore >= 80 ? 'ELEVATED' : 'ACTIVE'),
    whyPrimary: primaryCluster ? primaryCluster.whyClusterMatters : primaryEvent.reasonRanked,
    affectedMarkets: affectedSymbols,
    volatilityWindow: 'T-30m through T+60m; reassess on first 5m/15m close and then 1H close.',
    strongerThanExpectedPath: 'Stronger/hawkish result lifts the relevant currency/rates first, then pressures inverse USD/rate-sensitive assets if structure confirms.',
    weakerThanExpectedPath: 'Weaker/dovish result pressures the relevant currency/rates first, then supports inverse USD/rate-sensitive assets if structure confirms.',
    inLinePath: 'In-line result usually shifts attention to positioning, DXY/yields, and the next cluster.',
    reversalRisk: 'First impulse can reverse if DXY/yields fail to hold or the 15m close fades the release candle.',
    confidenceBasis: primaryEvent.reasonRanked,
    rawEvent: primaryEvent.rawEvent,
  } : {
    title: 'No major scheduled catalyst',
    currency: 'MULTI',
    eventType: 'driver_led_session',
    timeUTC: null,
    session: sessionOf(now),
    expectedImpact: riskState.label,
    whyPrimary: 'No relevant scheduled catalyst met the ranking threshold; session risk is driven by DXY/VIX/yields and liquidity windows.',
    affectedMarkets: affectedSymbols,
    volatilityWindow: 'Session dependent; reassess on DXY/VIX/yield regime change.',
    strongerThanExpectedPath: 'Driver-led: DXY/yields strengthen together and pressure non-USD/risk assets.',
    weakerThanExpectedPath: 'Driver-led: DXY/yields fade and support non-USD/risk assets.',
    inLinePath: 'No catalyst path; wait for live driver confirmation.',
    reversalRisk: 'High if drivers diverge or liquidity is thin.',
    confidenceBasis: degraded.join('; ') || 'calendar had no dominant high-impact event',
  };

  const dominantMacroTheme = primaryEvent
    ? primaryEvent.currency + ' ' + primaryEvent.eventType + ' risk through ' + primaryEvent.session + ' session.'
    : 'Driver-led macro session: DXY/VIX/yields set the read until a catalyst ranks higher.';
  const confidenceScore = Math.max(0.15, Math.min(0.95, (primaryEvent ? primaryEvent.impactScore / 100 : 0.35) - degraded.length * 0.1));

  return {
    symbol: affectedSymbols[0] || 'DXY',
    generatedAtUTC: new Date(now).toISOString(),
    sourceUsed: {
      calendar: sourceHealth.source_used || sourceHealth.source || 'TradingView calendar',
      fmp: input.fmp ? 'available' : 'not supplied',
      eodhd: input.eodhd ? 'available' : 'not supplied',
      coreyLive: liveState ? 'available' : 'missing',
    },
    dataFreshness: sourceHealth.calendar_mode || sourceHealth.mode || (sourceHealth.available ? 'LIVE' : 'UNKNOWN'),
    calendarEventsRawCount: rawEvents.length,
    todayAnnouncements: todayRelevant,
    next72Hours: next72Relevant,
    primaryEventFocus,
    eventClusters: clusters,
    affectedMarketsExpanded,
    macroTransmissionMap,
    riskState,
    sessionRisk: riskState.sessionWindow + ' / ' + riskState.label,
    dominantMacroTheme,
    combinedBias: dominantMacroTheme,
    confidence: Math.round(confidenceScore * 100) + '%',
    conflictNotes: degraded.length ? degraded : [],
    degradedReason: degraded.length ? degraded.join('; ') : null,
    confidenceScore,
    confidenceBasis: [
      'rankedEvents=' + relevant.length,
      'clusters=' + clusters.length,
      'primary=' + primaryEventFocus.title,
      'riskState=' + riskState.label,
    ].join(' · '),
  };
}

module.exports = {
  interpretCalendarEvents,
  _private: {
    normalizeEvent,
    clusterEvents,
    eventTypeOf,
    affectedMarketsFor,
    buildAffectedMarketsExpanded,
    riskStateFrom,
  },
};
