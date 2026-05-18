'use strict';

// ============================================================

const { buildPlanFromEvidence } = require('../../foh/darkHorsePricePoints');
// renderers/foh/darkHorseFohPacket.js
//
// Builds the FOH product-depth packet for Dark Horse — mirror
// of marketIntelFohPacket.js. Operator brief Lane 3 + 2026-05-16
// product-depth carry-over: each scan should surface the same
// section discipline as Market Intel — lifecycle treatment,
// first-detected timestamp, duration alive, near-miss watchlist,
// universe coverage, risk reminder, operator guidance, source
// note. Every section carries `available: boolean` + `reason`
// when unavailable so the renderer prints a sourced-unavailable
// label rather than deleting silently.
//
// SCHEMA (locked):
//   {
//     mode: 'live_scan' | 'monitoring',
//     scanState:        { available, scanTime, marketsScanned,
//                         severity, reason? },
//     marketState:      { available, dxy, vix, yield, regime, reason? },
//     marketMood:       { available, discs, label, severity, reason? },
//     standouts: [
//       { symbol, lifecycle: FRESH|STILL ACTIVE|FADING|EXHAUSTED,
//         direction, score, sectionLabel,
//         firstDetected, durationAlive,
//         decisionLevel, invalidation, dollarRisk, rewardR, sizeLabel,
//         continuationWindow, lateEntryRisk,
//         whyFlagged, structureState, confirmation, atlasState }
//     ],
//     nearMisses:       { available, count, candidates, reason? },
//     universeCoverage: { available, scanned, watch, internal,
//                         ignored, reason? },
//     riskReminder:     { available, narrative, reason? },
//     marketImpact:     { available, narrative, reason? },
//     operatorGuidance: { available, confirms, cancels, reason? },
//     sourceNote:       { available, source, mode, probabilityBasis,
//                         macroProxies },
//     glossaryTerms:    { available, terms, glossaryUrl },
//     formats:          ['png', 'pdf'],
//     dashboardDownloadUrls?: { png, pdf },
//   }
//
// READ-ONLY of the calling code's state. Pure function given
// the same ranking + volatility + liveCtx inputs.
// ============================================================

function _unavail(reason) { return { available: false, reason: reason || 'no-source' }; }

function _movePhaseToLifecycle(movePhase) {
  switch (String(movePhase || '').toLowerCase()) {
    case 'early':      return 'FRESH';
    case 'mid':        return 'STILL ACTIVE';
    case 'late':       return 'FADING';
    case 'exhaustion': return 'EXHAUSTED';
    default:           return 'STILL ACTIVE';
  }
}

function _humanDuration(moveAgeBars) {
  if (!Number.isFinite(moveAgeBars) || moveAgeBars < 0) return null;
  // moveAge is in 1D bars (candles). Convert to "Nd Nh" form.
  const days = Math.floor(moveAgeBars);
  if (days === 0) return 'first scan this window';
  if (days === 1) return '1 day';
  return days + ' days';
}

function _firstDetectedLabel(moveAgeBars, nowMs) {
  if (!Number.isFinite(moveAgeBars) || moveAgeBars < 0) return null;
  const ms = (nowMs || Date.now()) - moveAgeBars * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  const pad = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

function _volSeverity(level) {
  const v = String(level || '').toLowerCase();
  if (/extreme|storm/.test(v)) return 'HIGH';
  if (/elev|high/.test(v)) return 'ELEV';
  if (/mod/.test(v)) return 'MED';
  return 'LOW';
}

function _discsForSeverity(sev) {
  switch (sev) {
    case 'HIGH': return '🔴🔴🔴🔴🔴';
    case 'ELEV': return '🟠🟠🟠🟠⚫';
    case 'MED':  return '🟡🟡🟡⚫⚫';
    default:     return '🟢🟢⚫⚫⚫';
  }
}

function _marketStateFrom(liveCtx) {
  if (!liveCtx || !liveCtx.context) return _unavail('coreyLive context unavailable');
  const c = liveCtx.context;
  const dxy = c.dxy || {};
  const vix = c.vix || {};
  const yld = c.yield_ || c.yield || {};
  const regime = dxy.bias && vix.level
    ? ((dxy.bias === 'Bullish' || dxy.bias === 'mild-bid') && /elev|high/i.test(vix.level || '') ? 'defensive'
       : (dxy.bias === 'Bearish' && /low|calm/i.test(vix.level || '') ? 'risk-on' : 'mixed'))
    : 'unknown';
  return {
    available: true,
    dxy:    { bias: dxy.bias || 'neutral', level: dxy.level == null ? 'pending' : dxy.level },
    vix:    { level: vix.level || 'pending' },
    yield:  { regime: yld.regime || 'pending', spread: yld.spread },
    regime,
  };
}

function _enrichStandout(c, nowMs) {
  const lifecycle = _movePhaseToLifecycle(c.movePhase);
  const moveAge = Number.isFinite(c.moveAge) ? c.moveAge : null;
  const pricePointPlan = buildPlanFromEvidence(c, null, { stage: lifecycle });
  return {
    symbol:        c.symbol,
    lifecycle,
    direction:     c.direction || 'unspecified',
    score:         c.score,
    sectionLabel:  c.sectionLabel || 'Other',
    firstDetected: _firstDetectedLabel(moveAge, nowMs),
    durationAlive: _humanDuration(moveAge),
    decisionLevel: pricePointPlan ? pricePointPlan.entryReferencePrice : (c.promotionTrigger || null),
    invalidation:  pricePointPlan ? pricePointPlan.invalidationExitPrice : (c.invalidationTrigger || null),
    dollarRisk:    c.dollarRiskLabel || null,
    rewardR:       c.rewardRLabel || null,
    sizeLabel:     c.sizeLabel || null,
    continuationWindow: c.continuationWindow || null,
    lateEntryRisk:      c.lateEntryRisk || null,
    whyFlagged:    c.whyFlagged || c.summary || null,
    structureState: c.structureState || null,
    confirmation:  c.confirmationRequirement || null,
    atlasState:    c.atlasState || null,
    pricePointPlan,
    reasons:       Array.isArray(c.scoreBreakdown) ? c.scoreBreakdown : (Array.isArray(c.reasons) ? c.reasons : []),
  };
}

function _nearMissesFrom(internal) {
  if (!Array.isArray(internal) || !internal.length) {
    return { available: false, reason: 'no symbols in the 5-7 internal band', count: 0, candidates: [] };
  }
  const top = internal
    .filter(c => Number.isFinite(c && c.score) && c.score >= 5 && c.score < 8)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 8)
    .map(c => ({
      symbol:    c.symbol,
      score:     c.score,
      direction: c.direction || 'unspecified',
      section:   c.sectionLabel || c.section || 'Other',
    }));
  return { available: top.length > 0, count: top.length, candidates: top, reason: top.length ? null : 'no near-miss candidates' };
}

function _universeCoverageFrom(opts) {
  if (!opts) return _unavail('no universe context');
  const scanned = Number.isFinite(opts.universeSize) ? opts.universeSize : 0;
  const watch = Array.isArray(opts.watch) ? opts.watch.length : 0;
  const internal = Array.isArray(opts.internal) ? opts.internal.length : 0;
  const ignored = Array.isArray(opts.ignored) ? opts.ignored.length : 0;
  if (!scanned) return { available: false, reason: 'no universe size provided', scanned: 0, watch, internal, ignored };
  return { available: true, scanned, watch, internal, ignored };
}

function _riskReminderFrom(severity) {
  return {
    available: true,
    narrative: 'Every zone above is what ATLAS sees right now. Live price moves, the zones move with it. Cross-check current price against the zone before acting.' +
               (severity === 'HIGH' ? ' Market mood is HIGH — expect wider stops + sharper reversals.' :
                severity === 'ELEV' ? ' Market mood is elevated — larger pullbacks more likely.' : ''),
  };
}

function _marketImpactFrom(ranking, severity) {
  if (!ranking || !Array.isArray(ranking.top10) || !ranking.top10.length) {
    return _unavail('no candidates on this scan');
  }
  const lead = ranking.top10[0];
  return {
    available: true,
    narrative: 'Lead candidate ' + (lead && lead.symbol) + ' (' + (lead && lead.direction) + ', score ' + (lead && lead.score) + '/10) carries the dominant signal this scan. ' +
               'Market mood severity: ' + severity + '. ' +
               (lead && lead.movePhase ? 'Move phase: ' + lead.movePhase + ' → lifecycle ' + _movePhaseToLifecycle(lead.movePhase) + '.' : ''),
  };
}

function _operatorGuidanceFrom(ranking) {
  const lead = ranking && Array.isArray(ranking.top10) && ranking.top10[0];
  if (!lead) {
    return { available: false, reason: 'no lead candidate', confirms: '', cancels: '' };
  }
  return {
    available: true,
    confirms: lead.confirmationRequirement || lead.promotionTrigger || 'Live price confirms above decision level on the next higher-timeframe close.',
    cancels:  lead.invalidationTrigger || 'Below invalidation level voids the setup; first-reaction reverses inside 30M cancel the read.',
  };
}

function buildDarkHorseFohPacket(ranking, volatility, liveCtx, opts) {
  opts = opts || {};
  const nowMs = opts.now || Date.now();
  const top = Array.isArray(ranking && ranking.top10) ? ranking.top10 : [];
  const standouts = top
    .filter(c => Number.isFinite(c && c.score) && c.score >= (opts.standoutMinScore || 7))
    .slice(0, opts.standoutCap || 5)
    .map(c => _enrichStandout(c, nowMs));
  const severity = _volSeverity(volatility && volatility.level);
  const scanState = {
    available: true,
    scanTime: opts.scanTimeLabel || new Date(nowMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    marketsScanned: Number.isFinite(opts.universeSize) ? opts.universeSize : (Number.isFinite(ranking && ranking.allCount) ? ranking.allCount : 0),
    severity,
  };
  const marketState = _marketStateFrom(liveCtx);
  const marketMood = {
    available: !!(volatility && volatility.level),
    discs:    _discsForSeverity(severity),
    label:    volatility ? ('volatility ' + (volatility.level || 'unknown')) : 'unknown',
    severity,
    reason:   volatility && volatility.level ? null : 'no volatility reading',
  };
  const nearMisses = _nearMissesFrom(opts.internal);
  const universeCoverage = _universeCoverageFrom(opts);
  const riskReminder = _riskReminderFrom(severity);
  const marketImpact = _marketImpactFrom(ranking, severity);
  const operatorGuidance = _operatorGuidanceFrom(ranking);

  return {
    mode: 'live_scan',
    scanState,
    marketState,
    marketMood,
    standouts,
    nearMisses,
    universeCoverage,
    riskReminder,
    marketImpact,
    operatorGuidance,
    sourceNote: {
      available: true,
      source: opts.source || 'TradingView',
      mode:   opts.calendarMode || 'LIVE',
      probabilityBasis: 'engine-derived',
      macroProxies: 'DXY=UUP-proxy · VIX=VXX-proxy · curve=FRED T10Y2Y',
    },
    glossaryTerms: {
      available: true,
      terms: ['Decision Level','Entry Zone','Watch Level','Caution Zone','Invalidation','Confirmed Candle Close','Account Risk','Reward-to-Risk','Fresh Setup','Still Active Setup','Fading Setup','Late-Stage Move'],
    },
    formats: ['png', 'pdf'],
  };
}

module.exports = { buildDarkHorseFohPacket };
