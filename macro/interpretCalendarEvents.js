'use strict';

// ============================================================
// ATLAS FX - live calendar macro interpreter
//
// Converts normalized TradingView/FMP calendar rows plus live Corey
// market state into an operational macroIntelligencePacket. This
// module is intentionally deterministic and side-effect free except
// for the optional proof logger.
// ============================================================

const MAJOR_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD']);

const CCY_TO_MARKETS = Object.freeze({
  USD: ['DXY', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'AUDUSD', 'NZDUSD', 'XAUUSD', 'US500', 'NAS100', 'US30'],
  EUR: ['EURUSD', 'EURGBP', 'EURJPY', 'EURAUD', 'EURCAD', 'EURCHF', 'GER40', 'STOXX50'],
  GBP: ['GBPUSD', 'EURGBP', 'GBPJPY', 'GBPAUD', 'GBPCAD', 'GBPCHF', 'UK100'],
  JPY: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'JPN225'],
  AUD: ['AUDUSD', 'AUDJPY', 'EURAUD', 'GBPAUD', 'AUDCAD', 'AUDNZD', 'XAUUSD'],
  CAD: ['USDCAD', 'CADJPY', 'EURCAD', 'GBPCAD', 'AUDCAD', 'NZDCAD', 'WTI', 'USOIL'],
  CHF: ['USDCHF', 'EURCHF', 'GBPCHF', 'CHFJPY', 'XAUUSD'],
  NZD: ['NZDUSD', 'AUDNZD', 'NZDCAD', 'NZDJPY'],
  CNY: ['USDCNH', 'AUDUSD', 'NZDUSD', 'XAUUSD', 'HK50'],
});

const MARKET_PROFILES = Object.freeze({
  DXY: {
    assetClass: 'FX index',
    mechanism: 'Direct read on USD repricing; it leads most dollar-pair reactions after US catalysts.',
    stronger: 'Stronger or more hawkish data supports DXY if yields confirm the move.',
    weaker: 'Weaker or more dovish data pressures DXY if the move holds beyond the first reaction candle.',
    confirmation: '15-minute close outside the pre-event range with US yields moving in the same direction.',
    invalidation: 'DXY fades back inside the pre-event range within 15 minutes.',
    levels: 'Pre-event range high/low; prior session high/low; first 15-minute close.',
    risk: 'DXY whipsaws can invalidate the first FX move; read it before weighting dollar pairs.',
  },
  EURUSD: {
    assetClass: 'FX pair',
    mechanism: 'Moves through the USD and EUR legs; relative rate expectations decide which side dominates.',
    stronger: 'Stronger USD-side data usually presses EURUSD lower; stronger EUR-side data usually supports EURUSD.',
    weaker: 'Weaker USD-side data usually lifts EURUSD; weaker EUR-side data usually pressures EURUSD.',
    confirmation: '5-minute close in the surprise direction plus DXY confirmation.',
    invalidation: 'Close back through the pre-event range or conflicting EUR cross flow.',
    levels: 'Pre-event range; prior session high/low; first 15-minute balance.',
    risk: 'Two-sided EUR and USD catalysts can create false breaks before the 15-minute close.',
  },
  GBPUSD: {
    assetClass: 'FX pair',
    mechanism: 'Carries USD repricing plus UK policy/growth sensitivity; often higher beta than EURUSD.',
    stronger: 'Stronger USD data presses GBPUSD lower; stronger UK data supports GBPUSD.',
    weaker: 'Weaker USD data lifts GBPUSD; weaker UK data pressures GBPUSD.',
    confirmation: '5-minute close with DXY or EURGBP agreeing.',
    invalidation: 'Close back inside the pre-event range or EURGBP moving against the read.',
    levels: 'Pre-event range; London high/low; first 15-minute balance.',
    risk: 'GBP liquidity thins around London/New York handoff windows.',
  },
  USDJPY: {
    assetClass: 'FX pair',
    mechanism: 'Moves through US yields, JPY safe-haven flow, and rate differentials.',
    stronger: 'Higher US yield impulse supports USDJPY unless risk-off JPY demand dominates.',
    weaker: 'Lower US yields or risk-off JPY demand pressures USDJPY.',
    confirmation: 'US 10Y direction agrees with the 5-minute USDJPY close.',
    invalidation: 'Yield move fades or JPY safe-haven flow overwhelms USD direction.',
    levels: 'Pre-event range; prior Tokyo high/low; first 15-minute balance.',
    risk: 'Policy/intervention headlines can override the calendar impulse.',
  },
  AUDJPY: {
    assetClass: 'FX cross',
    mechanism: 'Risk sentiment cross; combines AUD growth beta with JPY haven beta.',
    stronger: 'Risk-on or stronger AUD data lifts AUDJPY when equities confirm.',
    weaker: 'Risk-off or weaker AUD data pressures AUDJPY, especially with JPY haven demand.',
    confirmation: 'AUDUSD and equity indices confirm the direction while USDJPY does not contradict it.',
    invalidation: 'Equities reverse or JPY haven flow dominates.',
    levels: 'Asia range high/low; prior session high/low.',
    risk: 'Cross can reverse quickly if risk tone flips after the first macro impulse.',
  },
  XAUUSD: {
    assetClass: 'metal',
    mechanism: 'Moves through USD strength, real yields, and risk sentiment.',
    stronger: 'Hot or hawkish data pressures gold through stronger USD/real yields unless risk-off demand offsets.',
    weaker: 'Soft or dovish data supports gold through weaker USD/real yields.',
    confirmation: 'DXY and yields move opposite gold on the first 15-minute close.',
    invalidation: 'Gold re-enters the pre-event range while DXY/yields fail to confirm.',
    levels: 'Pre-event range; prior session high/low; first 1-hour close.',
    risk: 'Safe-haven demand can reverse a textbook USD/yield reaction.',
  },
  US500: {
    assetClass: 'US index',
    mechanism: 'Moves through rates, earnings/risk appetite, and liquidity expectations.',
    stronger: 'Hot or hawkish data usually pressures US500 if yields rise and VIX lifts.',
    weaker: 'Soft or dovish data usually supports US500 if yields ease and VIX fades.',
    confirmation: 'VIX and yields confirm the equity direction after the first 15-minute close.',
    invalidation: 'Index reclaims pre-event range while VIX/yields stop confirming.',
    levels: 'VWAP; prior session high/low; first 15-minute balance.',
    risk: 'Index reactions are vulnerable to reversal when the rates move fades.',
  },
  NAS100: {
    assetClass: 'US index',
    mechanism: 'Rate-sensitive growth index; long-end yields dominate the first-order reaction.',
    stronger: 'Higher yields after hot/hawkish data pressure NAS100.',
    weaker: 'Lower yields after soft/dovish data support NAS100.',
    confirmation: 'US 10Y moves opposite NAS100 with VIX agreeing.',
    invalidation: 'Long-end yield move fades or NAS100 reclaims the pre-event range.',
    levels: 'VWAP; prior session high/low; first 15-minute balance.',
    risk: 'High duration beta makes reversals sharper than broad US indices.',
  },
  GER40: {
    assetClass: 'European index',
    mechanism: 'Moves through EUR rates, regional growth expectations, and global risk sentiment.',
    stronger: 'Hawkish EUR data or rising yields can pressure GER40; stronger growth can support it if rates stay contained.',
    weaker: 'Dovish rate repricing supports GER40 unless it signals growth stress.',
    confirmation: 'EUR yields and EURUSD reaction agree with index direction.',
    invalidation: 'Index reverses back into pre-event range while EUR rates fade.',
    levels: 'European session range; prior session high/low; VWAP.',
    risk: 'ECB communication can flip equity/rate interpretation during the press window.',
  },
});

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1000000000) return n;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

function iso(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

function utcClock(ms) {
  if (!ms) return 'pending';
  const d = new Date(ms);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

function sessionForMs(ms) {
  if (!ms) return 'unscheduled';
  const h = new Date(ms).getUTCHours();
  if (h >= 21 && h < 23) return 'Sydney';
  if (h >= 23 || h < 7) return 'Tokyo';
  if (h >= 7 && h < 12) return 'London';
  if (h >= 12 && h < 21) return 'New York';
  return 'late-New-York';
}

function openProximity(ms) {
  if (!ms) return { score: 0, label: 'not time-stamped' };
  const d = new Date(ms);
  const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  const opens = [
    { label: 'Sydney open', minute: 21 * 60 },
    { label: 'Tokyo open', minute: 23 * 60 },
    { label: 'London open', minute: 7 * 60 },
    { label: 'New York open', minute: 12 * 60 + 30 },
  ];
  let best = { label: 'between opens', dist: 1440 };
  for (const o of opens) {
    const direct = Math.abs(minuteOfDay - o.minute);
    const dist = Math.min(direct, 1440 - direct);
    if (dist < best.dist) best = { label: o.label, dist };
  }
  if (best.dist <= 30) return { score: 6, label: 'inside 30 minutes of ' + best.label };
  if (best.dist <= 60) return { score: 4, label: 'inside 60 minutes of ' + best.label };
  if (best.dist <= 120) return { score: 2, label: 'within two hours of ' + best.label };
  return { score: 0, label: 'away from major opens' };
}

function classifyEventType(title) {
  const t = String(title || '').toLowerCase();
  const rules = [
    { type: 'inflation', score: 34, pattern: /\b(cpi|pce|inflation|hicp)\b/ },
    { type: 'ppi', score: 26, pattern: /\bppi|producer price/ },
    { type: 'rate_decision', score: 36, pattern: /\b(rate decision|interest rate|fed funds|policy decision|fomc decision|ecb decision|boe decision|boj decision|rba decision|boc decision|rbnz decision|snb decision)\b/ },
    { type: 'central_bank_speech', score: 30, pattern: /\b(powell|lagarde|ueda|bailey|bullock|macklem|fed speak|fomc member|ecb speech|boe speech|boj speech|central bank|speech|testimony|press conference)\b/ },
    { type: 'central_bank_minutes', score: 28, pattern: /\b(minutes|meeting accounts|monetary policy statement)\b/ },
    { type: 'employment', score: 33, pattern: /\b(nonfarm|nfp|payroll|unemployment|employment change|jobs|jobless|wages|earnings)\b/ },
    { type: 'gdp', score: 28, pattern: /\bgdp|gross domestic product/ },
    { type: 'pmi', score: 24, pattern: /\b(pmi|ism|services|manufacturing)\b/ },
    { type: 'retail_sales', score: 24, pattern: /\bretail sales|consumer spending/ },
    { type: 'consumer_confidence', score: 22, pattern: /\bconsumer confidence|sentiment|confidence\b/ },
    { type: 'fiscal_budget', score: 26, pattern: /\b(budget|fiscal|debt ceiling|treasury refunding|tariff|sanction)\b/ },
    { type: 'geopolitical_risk', score: 30, pattern: /\b(geopolit|war|invasion|attack|missile|ceasefire|election shock)\b/ },
  ];
  for (const r of rules) if (r.pattern.test(t)) return { eventType: r.type, sensitivityScore: r.score };
  return { eventType: 'scheduled_macro', sensitivityScore: 8 };
}

function impactScore(impact) {
  const i = String(impact || '').toLowerCase();
  if (i === 'high' || i === '3') return 35;
  if (i === 'medium' || i === 'moderate' || i === '2') return 18;
  if (i === 'low' || i === '1') return 5;
  return 8;
}

function severityFromScore(score) {
  if (score >= 78) return 'HIGH';
  if (score >= 58) return 'ELEV';
  if (score >= 38) return 'MED';
  return 'LOW';
}

function affectedMarketsFor(currency, eventType) {
  const ccy = String(currency || 'USD').toUpperCase();
  const out = new Set(CCY_TO_MARKETS[ccy] || []);
  if (/inflation|ppi|employment|rate_decision|central_bank|gdp/.test(eventType)) {
    ['DXY', 'XAUUSD', 'US500', 'NAS100'].forEach(s => out.add(s));
  }
  if (/geopolitical|fiscal/.test(eventType)) {
    ['DXY', 'USDJPY', 'USDCHF', 'XAUUSD', 'US500', 'NAS100'].forEach(s => out.add(s));
  }
  if (ccy === 'AUD' || ccy === 'NZD') out.add('AUDJPY');
  return Array.from(out);
}

function whyEventMatters(eventType, currency, title) {
  const ccy = String(currency || 'USD').toUpperCase();
  if (eventType === 'inflation' || eventType === 'ppi') return ccy + ' inflation data reprices rate expectations, then transmits through ' + ccy + ' pairs, yields, gold, and equity risk appetite.';
  if (eventType === 'rate_decision' || eventType === 'central_bank_speech' || eventType === 'central_bank_minutes') return ccy + ' central-bank communication changes the expected rate path; tone versus market pricing matters more than the headline.';
  if (eventType === 'employment') return ccy + ' labour data changes central-bank reaction-function pricing and moves the home currency plus rate-sensitive assets.';
  if (eventType === 'gdp') return ccy + ' growth data changes terminal-rate and risk-appetite assumptions.';
  if (eventType === 'pmi' || eventType === 'retail_sales' || eventType === 'consumer_confidence') return ccy + ' activity data gives a live growth impulse that can move cyclical FX and indices.';
  if (eventType === 'geopolitical_risk' || eventType === 'fiscal_budget') return 'Policy or geopolitical shock can override scheduled macro and force safe-haven/risk-off repricing.';
  return (title || 'Scheduled event') + ' can move the home currency if the result surprises against consensus.';
}

function rankEvent(raw, now) {
  const scheduled = toMs(raw.scheduled_time || raw.time);
  const currency = String(raw.currency || 'USD').toUpperCase();
  const type = classifyEventType(raw.title);
  const impact = raw.impact || raw.importance;
  const proximity = openProximity(scheduled);
  const distance = scheduled == null ? null : scheduled - now;
  const isToday = scheduled != null && new Date(scheduled).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
  const inNext72 = distance != null && distance > -3 * 60 * 60 * 1000 && distance <= 72 * 60 * 60 * 1000;
  const currencyScore = MAJOR_CURRENCIES.has(currency) ? 10 : currency === 'CNY' ? 8 : 4;
  let score = impactScore(impact) + type.sensitivityScore + currencyScore + proximity.score;
  if (isToday) score += 6;
  if (inNext72) score += 8;
  if (raw.actual != null && raw.actual !== '') score += 4;
  score = clamp(Math.round(score), 0, 100);
  const affectedMarkets = affectedMarketsFor(currency, type.eventType);
  return {
    id: raw.id || [currency, raw.title, scheduled].join(':'),
    title: raw.title || '(unnamed event)',
    rawTitle: raw.title || '(unnamed event)',
    currency,
    country: raw.country || null,
    eventType: type.eventType,
    impact: String(impact || 'unknown').toLowerCase(),
    scheduledTimeUTC: iso(scheduled),
    timeUTC: utcClock(scheduled),
    timeMs: scheduled,
    session: sessionForMs(scheduled),
    actual: raw.actual,
    forecast: raw.forecast != null ? raw.forecast : raw.expected,
    previous: raw.previous,
    source: raw.source || 'calendar',
    importanceScore: score,
    severity: severityFromScore(score),
    proximityToOpen: proximity.label,
    whyItMatters: whyEventMatters(type.eventType, currency, raw.title),
    affectedMarkets,
    affectedInstruments: affectedMarkets,
    rankBasis: {
      tradingViewImportance: impact || 'unknown',
      currencyRelevance: MAJOR_CURRENCIES.has(currency) ? 'major' : 'secondary',
      historicalMarketSensitivity: type.sensitivityScore,
      sessionTiming: sessionForMs(scheduled),
      marketOpenProximity: proximity.label,
      next72h: !!inNext72,
    },
  };
}

function relevantEvents(ranked) {
  return ranked.filter(e =>
    e.importanceScore >= 25 ||
    e.impact === 'high' ||
    MAJOR_CURRENCIES.has(e.currency) ||
    /inflation|employment|rate_decision|central_bank|gdp|pmi|retail_sales|consumer_confidence|ppi|fiscal|geopolitical/.test(e.eventType)
  );
}

function clusterEvents(events) {
  const sorted = events.filter(e => e.timeMs != null).slice().sort((a, b) => a.timeMs - b.timeMs);
  const clusters = [];
  for (const e of sorted) {
    let c = clusters[clusters.length - 1];
    const canJoin = c &&
      (c.currency === e.currency || c.session === e.session || c.events.some(x => x.currency === e.currency)) &&
      e.timeMs - c.endMs <= 4 * 60 * 60 * 1000;
    if (!canJoin) {
      c = {
        clusterId: '',
        currency: e.currency,
        session: e.session,
        startMs: e.timeMs,
        endMs: e.timeMs,
        events: [],
      };
      clusters.push(c);
    }
    c.events.push(e);
    c.endMs = Math.max(c.endMs, e.timeMs);
    if (c.currency !== e.currency) c.currency = 'multi';
  }

  return clusters.map((c, idx) => {
    const maxScore = Math.max.apply(null, c.events.map(e => e.importanceScore));
    const avgScore = c.events.reduce((a, e) => a + e.importanceScore, 0) / c.events.length;
    const clusterScore = clamp(Math.round(maxScore + Math.min(18, (c.events.length - 1) * 6) + (avgScore >= 55 ? 4 : 0)), 0, 100);
    const affected = Array.from(new Set(c.events.flatMap(e => e.affectedMarkets))).slice(0, 14);
    const currencyLabel = c.currency || 'multi';
    return {
      clusterId: currencyLabel + '-' + c.session + '-' + new Date(c.startMs).toISOString().replace(/[-:]/g, '').slice(0, 13) + '-' + idx,
      currency: currencyLabel,
      session: c.session,
      startUTC: iso(c.startMs),
      endUTC: iso(c.endMs),
      startMs: c.startMs,
      endMs: c.endMs,
      events: c.events.map(e => ({
        title: e.title,
        currency: e.currency,
        eventType: e.eventType,
        time: e.timeUTC,
        timeUTC: e.timeUTC,
        scheduledTimeUTC: e.scheduledTimeUTC,
        severity: e.severity,
        impactSeverity: e.severity,
        score: e.importanceScore,
        whyMatters: e.whyItMatters,
        affectedInstruments: e.affectedMarkets,
      })),
      clusterImpact: severityFromScore(clusterScore),
      clusterScore,
      whyClusterMatters: c.events.length > 1
        ? c.events.length + ' related releases land inside the same ' + c.session + ' risk window; the first reaction can bleed into the next release.'
        : 'Single-event cluster; this is still the top scheduled macro window for its currency/session.',
      affectedMarkets: affected,
      riskStateContribution: clusterScore >= 78 ? 'raises risk state sharply' : clusterScore >= 58 ? 'keeps session risk elevated' : clusterScore >= 38 ? 'adds active monitoring risk' : 'low contribution',
    };
  });
}

function profileFor(symbol) {
  if (MARKET_PROFILES[symbol]) return MARKET_PROFILES[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) {
    return {
      assetClass: 'FX pair',
      mechanism: 'Moves through relative rate expectations and the home-currency surprise path.',
      stronger: 'Stronger home-currency data supports the home side if broader USD/risk drivers do not contradict.',
      weaker: 'Weaker home-currency data pressures the home side if the first structure close confirms.',
      confirmation: '5-minute close in surprise direction plus lead currency confirmation.',
      invalidation: 'Close back inside the pre-event range or opposing cross-currency flow.',
      levels: 'Pre-event range; prior session high/low; first 15-minute balance.',
      risk: 'Cross-currency flow can override the headline data reaction.',
    };
  }
  if (/40|50|100|500|225|30|NAS/.test(symbol)) {
    return {
      assetClass: 'index',
      mechanism: 'Moves through rates, risk appetite, and liquidity expectations.',
      stronger: 'Hawkish/rate-up impulse pressures the index unless growth optimism dominates.',
      weaker: 'Dovish/rate-down impulse supports the index unless growth fear dominates.',
      confirmation: 'Index close agrees with VIX and yield direction.',
      invalidation: 'Index re-enters the pre-event range while volatility/yields stop confirming.',
      levels: 'VWAP; prior session high/low; first 15-minute balance.',
      risk: 'Equity response can reverse if the rates impulse fades.',
    };
  }
  return {
    assetClass: 'cross-asset',
    mechanism: 'Affected through correlated macro flow from the primary currency/catalyst.',
    stronger: 'Moves with the stronger-than-expected macro impulse if the lead market confirms.',
    weaker: 'Fades or reverses when the weaker-than-expected path dominates.',
    confirmation: 'Lead currency/asset confirms after first 15-minute close.',
    invalidation: 'Lead market rejects the macro impulse.',
    levels: 'Pre-event range; prior session high/low.',
    risk: 'Secondary-market confirmation is required before weighting this symbol.',
  };
}

function buildAffectedMarketsExpanded(symbols, affectedBy) {
  return Array.from(new Set(symbols || [])).slice(0, 16).map(symbol => {
    const p = profileFor(symbol);
    return {
      symbol,
      assetClass: p.assetClass,
      affectedBy,
      transmissionMechanism: p.mechanism,
      strongerThanExpectedPath: p.stronger,
      weakerThanExpectedPath: p.weaker,
      confirmationCondition: p.confirmation,
      invalidationCondition: p.invalidation,
      keyPriceLevels: p.levels,
      riskNote: p.risk,
      confidence: MARKET_PROFILES[symbol] ? 'medium-high' : 'medium',
    };
  });
}

function buildTransmissionMap(primary, clusters, coreyState) {
  const focus = primary || {};
  const ccy = focus.currency || 'USD';
  const title = focus.title || 'No scheduled high-impact catalyst';
  const type = focus.eventType || 'driver-led';
  const affected = focus.affectedMarkets || (clusters[0] && clusters[0].affectedMarkets) || ['DXY', 'EURUSD', 'XAUUSD', 'US500'];
  const rows = [];
  rows.push({
    driver: title,
    mechanism: whyEventMatters(type, ccy, title),
    firstOrderEffect: ccy + ' rate expectations and the lead FX leg reprice first.',
    secondOrderEffect: 'Gold, indices, and high-beta crosses follow only if DXY/yields/VIX confirm after the first 15-minute close.',
    affectedSymbols: affected.slice(0, 10),
    whatStrengthensThis: 'Actual/statement surprises in the same direction as the first DXY/yield move.',
    whatWeakensThis: 'DXY/yields fade after release or structure rejects the first move.',
    evidenceSources: ['TradingView/FMP calendar', 'Corey live DXY/VIX/yields'],
  });
  const liveDrivers = [];
  const dxy = coreyState && coreyState.dxy;
  const vix = coreyState && coreyState.vix;
  const y = coreyState && (coreyState.yield || coreyState.yield_);
  if (dxy && dxy.bias) liveDrivers.push('DXY ' + dxy.bias);
  if (vix && vix.level) liveDrivers.push('VIX ' + vix.level);
  if (y && y.regime) liveDrivers.push('yield curve ' + y.regime);
  rows.push({
    driver: liveDrivers.length ? liveDrivers.join(' + ') : 'Live cross-market drivers',
    mechanism: 'Live DXY, VIX, and yields decide whether calendar risk is amplified or faded.',
    firstOrderEffect: 'Risk-on/risk-off tone changes position sizing and reaction-window reliability.',
    secondOrderEffect: 'FX pairs and indices either follow the scheduled catalyst or mean-revert when live drivers contradict it.',
    affectedSymbols: ['DXY', 'USDJPY', 'XAUUSD', 'US500', 'NAS100'],
    whatStrengthensThis: 'DXY, VIX, and yields all move in the same macro direction for at least one 15-minute close.',
    whatWeakensThis: 'One or more live drivers reverses before the first higher-timeframe close.',
    evidenceSources: ['Corey live state', 'FMP/EODHD availability where enabled'],
  });
  return rows;
}

function riskStateFrom(relevantToday, next72, clusters, coreyState, health) {
  const maxEvent = Math.max(0, ...next72.map(e => e.importanceScore), ...relevantToday.map(e => e.importanceScore));
  const clusterBoost = clusters.length ? Math.min(1.1, clusters.reduce((a, c) => a + (c.events.length > 1 ? 0.35 : 0.15), 0)) : 0;
  let score = 1 + (maxEvent / 100) * 2.4 + clusterBoost + Math.min(0.8, relevantToday.length * 0.12);
  const vixLevel = String(coreyState && coreyState.vix && coreyState.vix.level || '').toLowerCase();
  const dxyBias = String(coreyState && coreyState.dxy && coreyState.dxy.bias || '').toLowerCase();
  const y = coreyState && (coreyState.yield || coreyState.yield_);
  const yRegime = String(y && y.regime || '').toLowerCase();
  const reasons = [];
  if (relevantToday.length) reasons.push(relevantToday.length + ' relevant announcement(s) today');
  if (clusters.filter(c => c.events.length > 1).length) reasons.push('clustered release windows detected');
  if (/elevated|high|extreme/.test(vixLevel)) { score += /extreme|high/.test(vixLevel) ? 0.8 : 0.45; reasons.push('VIX ' + (coreyState.vix.level || 'elevated')); }
  if (/bullish|bearish/.test(dxyBias)) { score += 0.25; reasons.push('DXY directional bias ' + (coreyState.dxy.bias || 'active')); }
  if (/inverted|flat|stress/.test(yRegime)) { score += 0.35; reasons.push('yield regime ' + (y && y.regime)); }
  if (!health || !health.available || /DEGRADED|UNAVAILABLE/.test(String(health.calendar_mode || ''))) { score += 0.3; reasons.push('source degradation raises uncertainty'); }
  score = clamp(score, 1, 5);
  const rounded = Math.round(score * 10) / 10;
  let label = 'QUIET';
  let colour = 'green';
  if (rounded >= 4.4) { label = 'EXTREME'; colour = 'red'; }
  else if (rounded >= 3.5) { label = 'ELEVATED'; colour = 'orange'; }
  else if (rounded >= 2.2) { label = 'ACTIVE'; colour = 'yellow'; }
  return {
    label,
    scoreOutOf5: rounded,
    severityColour: colour,
    whyThisRating: reasons.length ? reasons.join('; ') : 'No high-severity scheduled catalyst and live drivers are not amplifying risk.',
    whatWouldRaiseIt: 'More high-impact events clustering inside one session, VIX lifting, DXY/yields confirming a one-way move, or stale/missing sources.',
    whatWouldLowerIt: 'Clean source freshness, no clustered releases, VIX normalising, and DXY/yields fading back to neutral.',
    sessionWindow: clusters[0] ? clusters[0].session + ' ' + clusters[0].startUTC + ' to ' + clusters[0].endUTC : sessionForMs(Date.now()) + ' driver-led window',
  };
}

function primaryFocus(topEvent, topCluster, riskState) {
  if (!topEvent && !topCluster) {
    return {
      title: 'No major scheduled catalyst',
      currency: 'multi',
      eventType: 'driver-led',
      timeUTC: null,
      session: riskState.sessionWindow,
      expectedImpact: 'Driver-led macro risk',
      whyPrimary: 'No decision-grade scheduled release is present; session risk is driven by DXY/VIX/yields, liquidity, and source freshness.',
      affectedMarkets: ['DXY', 'EURUSD', 'USDJPY', 'XAUUSD', 'US500'],
      volatilityWindow: 'No named release window; monitor session opens and live-driver regime shifts.',
      strongerThanExpectedPath: 'If DXY/yields rise and VIX firms, expect USD support, gold pressure, and defensive equity flow.',
      weakerThanExpectedPath: 'If DXY/yields fade and VIX falls, expect USD pressure, gold support, and risk appetite recovery.',
      inLinePath: 'If live drivers stay neutral, expect range trade and lower conviction.',
      reversalRisk: 'High if DXY/VIX/yields disagree or reverse inside the first 15-minute close.',
      confidenceBasis: 'Calendar has no dominant release; confidence comes from live Corey driver state.',
    };
  }
  const event = topCluster && topCluster.clusterScore >= (topEvent ? topEvent.importanceScore + 5 : 0)
    ? topCluster.events.slice().sort((a, b) => b.score - a.score)[0]
    : topEvent;
  const affected = topCluster && topCluster.clusterScore >= (topEvent ? topEvent.importanceScore + 5 : 0)
    ? topCluster.affectedMarkets
    : event.affectedMarkets;
  const currency = event.currency || (topCluster && topCluster.currency) || 'multi';
  return {
    title: event.title,
    currency,
    eventType: event.eventType,
    timeUTC: event.scheduledTimeUTC || event.timeUTC,
    session: event.session || (topCluster && topCluster.session) || 'unscheduled',
    expectedImpact: event.severity,
    whyPrimary: topCluster && topCluster.events.length > 1
      ? topCluster.whyClusterMatters + ' Lead event: ' + event.title + '.'
      : event.whyItMatters,
    affectedMarkets: affected,
    volatilityWindow: 'Primary reactivity is T-15 to T+30 minutes; keep monitoring through the first 1-hour close if DXY/yields/VIX confirm.',
    strongerThanExpectedPath: 'Stronger or more hawkish outcome supports the home currency/yields first; risk assets react through rates and liquidity.',
    weakerThanExpectedPath: 'Weaker or more dovish outcome pressures the home currency/yields first; gold and rate-sensitive indices can recover if risk tone agrees.',
    inLinePath: 'In-line outcome lowers directional conviction; expect mean reversion unless guidance or components surprise.',
    reversalRisk: 'Elevated during the first 60-90 seconds and whenever DXY/yields/VIX do not confirm the first candle.',
    confidenceBasis: 'Selected by event score, source importance, currency relevance, session timing, and clustering.',
  };
}

function deriveDataFreshness(health, coreyState, fmpData, eodhdData) {
  return {
    calendar: {
      mode: health && health.calendar_mode || 'UNAVAILABLE',
      source: health && health.source_used || 'unknown',
      available: !!(health && health.available),
      lastUpdatedUTC: health && (health.last_updated || (health.lastUpdated ? iso(health.lastUpdated) : null)),
      eventCount: health && health.eventCount,
    },
    coreyLive: {
      status: coreyState && coreyState.status || 'unknown',
      lastUpdatedUTC: coreyState && coreyState.lastUpdated || null,
    },
    fmp: {
      available: !!(fmpData && (fmpData.available || fmpData.enabled)),
      sourceUsed: fmpData && (fmpData.source_used || fmpData.source || (fmpData.enabled ? 'fmp' : null)),
      note: fmpData && (fmpData.fallback_note || fmpData.reason) || null,
    },
    eodhd: {
      available: !!(eodhdData && (eodhdData.available || eodhdData.enabled || eodhdData.ok)),
      sourceUsed: eodhdData && (eodhdData.source_used || eodhdData.source || (eodhdData.enabled ? 'eodhd' : null)),
      note: eodhdData && (eodhdData.reason || eodhdData.note) || null,
    },
  };
}

function confidenceBasis(packet, health, coreyState) {
  const parts = [];
  parts.push('ranked ' + packet.calendarEventsRawCount + ' calendar rows into ' + packet.next72Hours.length + ' next-72h relevant rows');
  parts.push(packet.eventClusters.length + ' cluster(s)');
  parts.push('primary focus: ' + (packet.primaryEventFocus.title || 'none'));
  parts.push('calendar source=' + (health && health.source_used || 'unknown') + '/' + (health && health.calendar_mode || 'unknown'));
  parts.push('corey live=' + (coreyState && coreyState.status || 'unknown'));
  return parts.join('; ');
}

function sourceUsed(health, fmpData, eodhdData) {
  const sources = [];
  sources.push((health && health.source_used) || 'calendar_unknown');
  if (fmpData && (fmpData.available || fmpData.enabled)) sources.push('fmp');
  if (eodhdData && (eodhdData.available || eodhdData.enabled || eodhdData.ok)) sources.push('eodhd');
  sources.push('corey_live');
  return Array.from(new Set(sources));
}

function interpretCalendarEvents(input) {
  input = input || {};
  const now = input.now || Date.now();
  const events = Array.isArray(input.events) ? input.events : [];
  const health = input.health || {};
  const coreyState = input.coreyState || input.coreyLive || {};
  const rankedAll = events.map(e => rankEvent(e, now)).sort((a, b) => b.importanceScore - a.importanceScore);
  const relevant = relevantEvents(rankedAll);
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setUTCHours(23, 59, 59, 999);
  const next72End = now + 72 * 60 * 60 * 1000;
  const todayRelevant = relevant
    .filter(e => e.timeMs != null && e.timeMs >= dayStart.getTime() && e.timeMs <= dayEnd.getTime())
    .sort((a, b) => a.timeMs - b.timeMs);
  const next72 = relevant
    .filter(e => e.timeMs != null && e.timeMs > now - 3 * 60 * 60 * 1000 && e.timeMs <= next72End)
    .sort((a, b) => a.timeMs - b.timeMs);
  const clusterSource = next72.length ? next72 : todayRelevant;
  const clusters = clusterEvents(clusterSource).sort((a, b) => b.clusterScore - a.clusterScore);
  const topEvent = (next72[0] ? next72.slice().sort((a, b) => b.importanceScore - a.importanceScore)[0] : rankedAll[0]) || null;
  const topCluster = clusters[0] || null;
  const riskState = riskStateFrom(todayRelevant, next72, clusters, coreyState, health);
  const primaryEventFocus = primaryFocus(topEvent, topCluster, riskState);
  const affectedSymbols = primaryEventFocus.affectedMarkets && primaryEventFocus.affectedMarkets.length
    ? primaryEventFocus.affectedMarkets
    : (topEvent && topEvent.affectedMarkets) || ['DXY', 'EURUSD', 'XAUUSD', 'US500'];
  const affectedBy = primaryEventFocus.title || 'live macro driver state';
  const packet = {
    generatedAtUTC: new Date(now).toISOString(),
    sourceUsed: sourceUsed(health, input.fmpData, input.eodhdData),
    dataFreshness: deriveDataFreshness(health, coreyState, input.fmpData, input.eodhdData),
    calendarEventsRawCount: events.length,
    todayAnnouncements: todayRelevant.map(e => ({
      title: e.title,
      currency: e.currency,
      eventType: e.eventType,
      timeUTC: e.timeUTC,
      scheduledTimeUTC: e.scheduledTimeUTC,
      session: e.session,
      severity: e.severity,
      importanceScore: e.importanceScore,
      whyItMatters: e.whyItMatters,
      affectedMarkets: e.affectedMarkets,
      rankBasis: e.rankBasis,
    })),
    next72Hours: next72.map(e => ({
      title: e.title,
      currency: e.currency,
      eventType: e.eventType,
      timeUTC: e.timeUTC,
      scheduledTimeUTC: e.scheduledTimeUTC,
      session: e.session,
      severity: e.severity,
      importanceScore: e.importanceScore,
      expectedSensitivity: e.whyItMatters,
      affectedMarkets: e.affectedMarkets,
    })),
    primaryEventFocus,
    eventClusters: clusters.map(c => {
      const copy = Object.assign({}, c);
      delete copy.startMs;
      delete copy.endMs;
      return copy;
    }),
    affectedMarketsExpanded: buildAffectedMarketsExpanded(affectedSymbols, affectedBy),
    macroTransmissionMap: buildTransmissionMap(primaryEventFocus, clusters, coreyState),
    riskState,
    sessionRisk: {
      session: primaryEventFocus.session || sessionForMs(now),
      label: riskState.label,
      namedWindows: clusters.slice(0, 3).map(c => c.session + ' ' + utcClock(c.startMs) + '-' + utcClock(c.endMs) + ' UTC'),
      note: clusters.length ? 'Risk is elevated around named release windows only; outside them read DXY/VIX/yields.' : 'No named release window; read live drivers and market-open liquidity.',
    },
    dominantMacroTheme: primaryEventFocus.title === 'No major scheduled catalyst'
      ? 'Driver-led session: DXY/VIX/yields and liquidity set the macro tape.'
      : primaryEventFocus.currency + ' ' + primaryEventFocus.eventType + ' risk: ' + primaryEventFocus.title,
    conflictNotes: [],
    degradedReason: null,
    confidenceScore: 0,
    confidenceBasis: '',
  };
  if (events.length > 0 && !next72.length && !todayRelevant.length) {
    packet.conflictNotes.push('Calendar returned rows, but all ranked as outside today/next-72h or below relevance threshold.');
  }
  if (!health || !health.available) packet.degradedReason = 'calendar source unavailable or degraded; packet uses available cached/calendar rows plus Corey live state';
  const baseConfidence = 0.35 + (health && health.available ? 0.2 : 0) + (next72.length ? 0.15 : 0) + (clusters.length ? 0.1 : 0) + (coreyState && coreyState.status === 'ok' ? 0.1 : 0);
  packet.confidenceScore = Math.round(clamp(baseConfidence, 0.15, 0.92) * 100) / 100;
  packet.confidenceBasis = confidenceBasis(packet, health, coreyState);
  return packet;
}

function logMacroIntelligencePacket(packet, logger) {
  const out = typeof logger === 'function' ? logger : console.log;
  const affected = Array.isArray(packet && packet.affectedMarketsExpanded)
    ? packet.affectedMarketsExpanded.map(m => m.symbol).join('|')
    : '';
  out('[MACRO] calendar_raw_count=' + (packet && packet.calendarEventsRawCount != null ? packet.calendarEventsRawCount : 0));
  out('[MACRO] today_relevant_count=' + (packet && packet.todayAnnouncements ? packet.todayAnnouncements.length : 0));
  out('[MACRO] next72_count=' + (packet && packet.next72Hours ? packet.next72Hours.length : 0));
  out('[MACRO] clusters=' + (packet && packet.eventClusters ? packet.eventClusters.length : 0));
  out('[MACRO] primary_event=' + ((packet && packet.primaryEventFocus && packet.primaryEventFocus.title) || 'none'));
  out('[MACRO] risk_state=' + ((packet && packet.riskState && packet.riskState.label) || 'UNKNOWN'));
  out('[MACRO] affected_markets=' + (affected || 'none'));
  out('[MACRO] transmission_paths=' + (packet && packet.macroTransmissionMap ? packet.macroTransmissionMap.length : 0));
}

module.exports = {
  interpretCalendarEvents,
  logMacroIntelligencePacket,
  _private: {
    rankEvent,
    clusterEvents,
    riskStateFrom,
    buildAffectedMarketsExpanded,
  },
};
