'use strict';

// ============================================================
// renderers/foh/marketIntelFohPacket.js
//
// Builds the FOH product-depth packet for Market Intel. Operator
// brief 2026-05-16: the current daily-bulletin live body is a
// thin status bulletin — it lacks the prototype-grade depth
// (event clusters with severity sections, expanded WHY per
// event, Historical Reaction, BEFORE/DURING/AFTER, scenario
// splits, weekend Monday-open mode, expanded provenance).
//
// This module assembles a structured packet with the locked
// schema. Every section carries either `available: true` with
// data, or `available: false` + a `reason` so the renderer
// prints a sourced-unavailable label rather than deleting the
// section silently.
//
// SCHEMA (locked):
//   {
//     mode: 'pre_event' | 'released' | 'daily' | 'weekend',
//     marketState:        { available, dxy, vix, yield, regime, geoLevel, reason? },
//     mondayOpenFocus:    { available, narrative, focusInstruments, reason? },  // weekend mode only
//     eventClusters: [
//       { available, currency, country?, severity, events: [
//         { time, title, impact, severity, forecast?, previous?, actual?,
//           driverLine, whyExpanded, marketImpact, historicalReaction,
//           confirmationPath, cancellationPath, operatorGuidance,
//           beforeDuringAfter: { before, during, after } } ] }
//     ],
//     historicalReaction: { available, rows, basis, sampleN, reason? },
//     marketImpact:       { available, narrative, reason? },
//     affectedMarkets:    { available, buckets, reason? },
//     confirmationPath:   { available, narrative, reason? },
//     cancellationPath:   { available, narrative, reason? },
//     operatorGuidance:   { available, confirms, cancels, reason? },
//     sourceNote:         { available, source, mode, probabilityBasis, macroProxies, reason? },
//     glossaryTerms:      { available, terms, glossaryUrl, reason? },
//     formats:            ['png', 'pdf'],
//     dashboardDownloadUrls?: { png, pdf },
//   }
//
// READ-ONLY of the calling code's state. Pure function — given
// the same snapshot/geoCtx/now/mode it returns the same packet.
// ============================================================

const fs = require('fs');
const path = require('path');

const depth = require('./marketIntelDepthContent');

function _unavail(reason) { return { available: false, reason: reason || 'no-source' }; }

function _marketStateFrom(liveCtx, geoCtx) {
  if (!liveCtx || !liveCtx.context) return _unavail('coreyLive context unavailable');
  const c = liveCtx.context;
  const dxy   = c.dxy   || {};
  const vix   = c.vix   || {};
  const yld   = c.yield_ || c.yield || {};
  const regime = dxy.bias && vix.level
    ? ((dxy.bias === 'Bullish' || dxy.bias === 'mild-bid') && /elev|high/i.test(vix.level || '') ? 'defensive'
       : (dxy.bias === 'Bearish' && /low|calm/i.test(vix.level || '') ? 'risk-on' : 'mixed'))
    : 'unknown';
  return {
    available: true,
    dxy:    { bias: dxy.bias || 'neutral', level: dxy.level == null ? 'pending' : dxy.level },
    vix:    { level: vix.level || 'pending', score: vix.score },
    yield:  { regime: yld.regime || 'pending', spread: yld.spread },
    regime,
    geoLevel: (geoCtx && geoCtx.level) || 'low',
  };
}

function _mondayOpenFocusFrom(eventClusters, mode) {
  if (mode !== 'weekend') return _unavail('not weekend mode');
  if (!eventClusters || !eventClusters.length) return _unavail('no clustered catalysts in the prep window');
  // Surface the top 1-2 events as Monday open focus.
  const focusEvents = [];
  for (const c of eventClusters) {
    for (const e of (c.events || []).slice(0, 1)) focusEvents.push(e.title + ' (' + c.currency + ')');
    if (focusEvents.length >= 3) break;
  }
  const narrative = focusEvents.length
    ? 'Three or more high-impact catalysts cluster early-week. Lead exposure: ' + focusEvents.slice(0, 3).join(' · ') + '. Live confirmation required after market reopen.'
    : 'Driver-led tape on Monday open — no clustered catalysts.';
  return {
    available: true,
    narrative,
    focusInstruments: focusEvents.slice(0, 3),
  };
}

function _severityFromImpact(impact) {
  const v = String(impact || '').toLowerCase();
  if (v === 'high') return 'HIGH';
  if (v === 'medium' || v === 'med') return 'MEDIUM';
  return 'LOW';
}

// Build a single rich event entry — every field that the
// prototype-grade card expects. Unavailable values render as
// "sourced — unavailable" rather than being dropped.
function _buildEventEntry(rawEvent, helpers) {
  const ccy = rawEvent.currency || 'multi';
  const sev = _severityFromImpact(rawEvent.impact);
  const drvShort = helpers.classifyEventDriver(rawEvent.title);
  const driverShort = drvShort ? drvShort.short : 'macro';

  const driverLineMap = {
    'inflation':       'Inflation reading — rate-path lever for ' + ccy + ' and yields.',
    'labour':          'Labour reading — central-bank reaction-function lever.',
    'central bank':    'Central-bank tone — hawkish/dovish vs current pricing.',
    'growth':          'Growth surprise — terminal-rate + risk-appetite lever.',
    'consumer demand': 'Consumer-spend reading — growth + ' + ccy + ' lever.',
    'activity':        'Activity index — above-50 vs sub-50 directional lever.',
    'geopolitical':    'Geopolitical event — safe-haven rotation trigger.',
    'macro':           'Scheduled ' + ccy + ' release.',
  };

  const whyExpandedMap = {
    'inflation':       'Hotter-than-forecast readings historically tend to support ' + ccy + ' and yields (rates expected to stay higher for longer), pressuring gold and risk indices. Cooler readings favour the reverse rotation.',
    'labour':          'Stronger labour data favours ' + ccy + ' via tighter central-bank policy expectations; weaker data favours the reverse. First reaction historically sits in the short-end yield curve.',
    'central bank':    'Tone vs current market pricing is the lever. Hawkish lean supports ' + ccy + '; dovish lean pressures it. Surprises against current pricing historically produce outsized moves.',
    'growth':          'Stronger readings historically tend to lift risk and ' + ccy + ' jointly when growth-pricing dominates; weaker readings invert the relationship.',
    'consumer demand': 'Stronger consumer spending tends to support ' + ccy + ' through growth-pricing; weaker readings favour the reverse.',
    'activity':        'Readings above 50 favour expansion (supportive for ' + ccy + ' and risk); below 50 favour contraction.',
    'geopolitical':    'Safe-haven rotation: US Dollar Index, CHF, JPY, gold tend to bid while equities and credit fade.',
    'macro':           'Standard transmission: surprise → ' + ccy + ' repositions → correlated risk follows on first HTF close.',
  };

  const marketImpact = helpers.mechanismChainFor(rawEvent);

  const bda = helpers.fohBeforeDuringAfter(rawEvent);
  const confirms = helpers.fohWhatConfirms(rawEvent);
  const cancels  = helpers.fohWhatCancels(rawEvent);

  // Historical reaction — caller may supply rawEvent.history; if
  // absent we render the section with insufficient-evidence basis.
  const histRows = Array.isArray(rawEvent.history) && rawEvent.history.length
    ? rawEvent.history.slice(0, 3).map(h => ({
        label:     h.dateLabel || h.label || '—',
        actual:    h.actual || '—',
        magnitude: h.magnitude || '',
        dir:       h.surpriseDir || h.dir || 'in-line',
        reaction:  h.reaction || '',
      }))
    : null;
  const historicalReaction = histRows
    ? { available: true, rows: histRows, basis: histRows.length >= 3 ? 'engine-derived' : 'insufficient evidence', sampleN: histRows.length }
    : { available: false, reason: 'no historical sample sourced for ' + helpers.humanizeTitle(rawEvent.title), basis: 'insufficient evidence', sampleN: 0 };

  return {
    time:        rawEvent.scheduled_time ? helpers.fmtAwstShort(rawEvent.scheduled_time) + ' AWST · ' + helpers.fmtUtcShort(rawEvent.scheduled_time) + ' UTC' : 'unavailable',
    title:       helpers.humanizeTitle(rawEvent.title || 'untitled'),
    currency:    ccy,
    impact:      String(rawEvent.impact || 'high').toUpperCase(),
    severity:    sev,
    forecast:    rawEvent.forecast == null || rawEvent.forecast === '' ? null : String(rawEvent.forecast),
    previous:    rawEvent.previous == null || rawEvent.previous === '' ? null : String(rawEvent.previous),
    actual:      rawEvent.actual   == null || rawEvent.actual   === '' ? null : String(rawEvent.actual),
    driverLine:  driverLineMap[driverShort] || driverLineMap.macro,
    whyExpanded: whyExpandedMap[driverShort] || whyExpandedMap.macro,
    marketImpact,
    historicalReaction,
    confirmationPath: confirms,
    cancellationPath: cancels,
    operatorGuidance: confirms + ' Cancels if ' + cancels.replace(/^[A-Z]/, c => c.toLowerCase()),
    beforeDuringAfter: bda,
    // ── PROTOTYPE DEPTH CONTENT (operator brief 2026-05-17) ──
    // Each event carries the prototype-grade decision context so
    // the renderer can produce institutional-quality output.
    category:           driverShort,
    dollarImpactRange:  depth.buildDollarImpactRange(rawEvent, driverShort),
    reactionPaths:      depth.buildReactionPaths(rawEvent, driverShort),
    whatToWatch:        depth.buildWhatToWatch(rawEvent, driverShort),
  };
}

function _eventClustersFrom(events, helpers, opts) {
  if (!Array.isArray(events) || !events.length) return [];
  const NOW = (opts && opts.now) || Date.now();
  const windowMs = (opts && opts.windowMs) || 24 * 60 * 60 * 1000;
  const inWindow = events.filter(e =>
    Number.isFinite(e.scheduled_time) && e.scheduled_time >= NOW - 30 * 60 * 1000 && e.scheduled_time <= NOW + windowMs);
  if (!inWindow.length) return [];
  const byCcy = new Map();
  for (const e of inWindow) {
    const ccy = (e.currency || 'OTHER').toUpperCase();
    if (!byCcy.has(ccy)) byCcy.set(ccy, []);
    byCcy.get(ccy).push(e);
  }
  const clusters = [];
  for (const [ccy, evs] of byCcy.entries()) {
    // Sort events chronologically, cap at 5 per cluster.
    const sorted = evs.sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0)).slice(0, 5);
    const richEvents = sorted.map(e => _buildEventEntry(e, helpers));
    // Cluster severity = highest event severity inside.
    const sevs = richEvents.map(e => e.severity);
    const clusterSeverity = sevs.indexOf('HIGH') >= 0 ? 'HIGH' : sevs.indexOf('MEDIUM') >= 0 ? 'MEDIUM' : 'LOW';
    clusters.push({
      available: true,
      currency: ccy,
      country: helpers.countryForCurrency(ccy),
      severity: clusterSeverity,
      events: richEvents,
    });
  }
  // Sort clusters: HIGH severity first, then by earliest event time
  clusters.sort((a, b) => {
    const sevRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const ra = sevRank[a.severity] - sevRank[b.severity];
    if (ra !== 0) return ra;
    const ta = (a.events[0] && a.events[0].time) || '';
    const tb = (b.events[0] && b.events[0].time) || '';
    return ta.localeCompare(tb);
  });
  return clusters;
}

function _aggregateMarketImpact(clusters, helpers) {
  if (!clusters || !clusters.length) {
    return { available: false, reason: 'no clustered catalysts — driver-led tape', narrative: 'No clustered catalysts in the window. Read cross-asset from the live macro tape rather than from the calendar.' };
  }
  // First high-severity cluster's first event drives the macro narrative.
  const hi = clusters.find(c => c.severity === 'HIGH') || clusters[0];
  const headEvent = hi.events[0];
  const narrative = headEvent ? headEvent.marketImpact + ' Lead currency block: ' + hi.currency + '.' : 'No dominant transmission chain available.';
  return { available: true, narrative };
}

function _affectedMarketsFrom(events, helpers) {
  const affected = new Set();
  for (const e of (events || [])) (helpers.affectedSymbols(e) || []).forEach(s => affected.add(s));
  if (!affected.size) {
    return { available: false, reason: 'no symbols mapped — driver-led exposure only', buckets: {} };
  }
  return { available: true, buckets: helpers.bucketAffected([...affected]) };
}

function _operatorGuidanceFrom(clusters) {
  if (!clusters || !clusters.length) {
    return { available: false, reason: 'no high-impact catalyst — driver-led only',
             confirms: 'A regime change in live drivers — DXY bias flip, VIX move >2 points, curve cross — confirms direction.',
             cancels: 'Drivers reverse inside the same session without a higher-timeframe close — the regime-change read is cancelled.' };
  }
  const hi = clusters.find(c => c.severity === 'HIGH') || clusters[0];
  const head = hi.events[0];
  if (!head) return { available: false, reason: 'no head event', confirms: '', cancels: '' };
  return { available: true, confirms: head.confirmationPath, cancels: head.cancellationPath };
}

function _historicalReactionAggregate(clusters) {
  if (!clusters || !clusters.length) return { available: false, reason: 'no events to surface history for', rows: [], basis: 'insufficient evidence' };
  // Pick the head event's history if available; otherwise mark unavailable.
  const hi = clusters.find(c => c.severity === 'HIGH') || clusters[0];
  const head = hi.events[0];
  if (head && head.historicalReaction && head.historicalReaction.available) {
    return Object.assign({}, head.historicalReaction, { eventLabel: head.title });
  }
  return { available: false, reason: 'no historical sample sourced for ' + (head ? head.title : 'lead event'), rows: [], basis: 'insufficient evidence' };
}

// ============================================================
// PUBLIC ENTRY POINTS
// ============================================================

// Build the daily / weekend FOH packet from a calendar snapshot
// + geo context + live macro context. `mode` is one of
// 'daily' | 'weekend' (caller decides based on day of week +
// market closure).
function buildDailyFohPacket(snapshot, geoCtx, liveCtx, helpers, mode, now) {
  const NOW = now || Date.now();
  const events = (snapshot && snapshot.events) || [];
  const health = (snapshot && snapshot.health) || { available: false, calendar_mode: 'UNAVAILABLE', source_used: null };
  // Daily mode: events today only. Weekend mode: next 4 days
  // (covers Sun reopen → Fri close so all clustered catalysts
  // for the week are visible).
  const windowMs = mode === 'weekend' ? 4 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const clusters = _eventClustersFrom(events, helpers, { now: NOW, windowMs });
  const marketState = _marketStateFrom(liveCtx, geoCtx);
  const mondayOpenFocus = _mondayOpenFocusFrom(clusters, mode);
  const marketImpact = _aggregateMarketImpact(clusters, helpers);
  const affectedMarkets = _affectedMarketsFrom(events, helpers);
  const operatorGuidance = _operatorGuidanceFrom(clusters);
  const historicalReaction = _historicalReactionAggregate(clusters);
  // Featured event — the first HIGH-severity event in the
  // earliest cluster gets the full prototype-grade deep dive;
  // others render as compact rows.
  const featuredCluster = clusters.find(c => c.severity === 'HIGH') || clusters[0];
  const featuredEvent = featuredCluster && featuredCluster.events && featuredCluster.events[0];
  const featuredEventKey = featuredEvent ? (featuredCluster.currency + '::' + featuredEvent.title + '::' + featuredEvent.time) : null;
  const packet = {
    mode: mode || 'daily',
    marketState,
    mondayOpenFocus,
    eventClusters: clusters,
    featuredEventKey,
    historicalReaction,
    marketImpact,
    affectedMarkets,
    confirmationPath: operatorGuidance.available
      ? { available: true, narrative: operatorGuidance.confirms }
      : _unavail(operatorGuidance.reason),
    cancellationPath: operatorGuidance.available
      ? { available: true, narrative: operatorGuidance.cancels }
      : _unavail(operatorGuidance.reason),
    operatorGuidance: operatorGuidance.available
      ? { available: true, confirms: operatorGuidance.confirms, cancels: operatorGuidance.cancels }
      : _unavail(operatorGuidance.reason),
    riskEscalation:    featuredEvent ? depth.buildRiskEscalation(featuredEvent, mode === 'released' ? 'released' : 'pre_event') : _unavail('no featured event'),
    eventDayReference: depth.buildEventDayReference(),
    sourceNote: {
      available: !!(health.source_used),
      source:    health.source_used   || 'unavailable',
      mode:      health.calendar_mode || 'UNAVAILABLE',
      probabilityBasis: clusters.length ? 'engine-derived' : 'insufficient evidence',
      macroProxies: 'US Dollar Strength (DXY), Market Volatility (VIX), yield curve via FRED T10Y2Y',
    },
    glossaryTerms: {
      available: true,
      terms: ['Dovish','Hawkish','Yield curve','Risk-off','Liquidity sweep','Confirmed candle close'],
    },
    formats: ['png', 'pdf'],
  };
  packet.comparisonNotes = depth.buildComparisonNotes(packet);
  packet.briefingActions = depth.buildBriefingActions(packet);
  return packet;
}

// Build the pre-event / released-event FOH packet for a single
// catalyst. The packet is the same shape as the daily packet
// but with `eventClusters` containing exactly one cluster
// holding the focal event.
function buildEventFohPacket(rawEvent, geoCtx, liveCtx, helpers, mode, opts) {
  opts = opts || {};
  const events = [rawEvent];
  const clusters = _eventClustersFrom(events, helpers, { now: opts.now || Date.now(), windowMs: 7 * 24 * 60 * 60 * 1000 });
  const marketState = _marketStateFrom(liveCtx, geoCtx);
  const marketImpact = _aggregateMarketImpact(clusters, helpers);
  const affectedMarkets = _affectedMarketsFrom(events, helpers);
  const operatorGuidance = _operatorGuidanceFrom(clusters);
  const historicalReaction = _historicalReactionAggregate(clusters);
  const health = opts.health || { source_used: null, calendar_mode: 'UNAVAILABLE' };
  // Single-event surface: this IS the featured event.
  const featuredCluster = clusters[0];
  const featuredEvent = featuredCluster && featuredCluster.events && featuredCluster.events[0];
  const featuredEventKey = featuredEvent ? (featuredCluster.currency + '::' + featuredEvent.title + '::' + featuredEvent.time) : null;
  const packet = {
    mode: mode || 'pre_event',
    marketState,
    mondayOpenFocus: _unavail('not weekend mode'),
    eventClusters: clusters,
    featuredEventKey,
    historicalReaction,
    marketImpact,
    affectedMarkets,
    confirmationPath: operatorGuidance.available
      ? { available: true, narrative: operatorGuidance.confirms }
      : _unavail(operatorGuidance.reason),
    cancellationPath: operatorGuidance.available
      ? { available: true, narrative: operatorGuidance.cancels }
      : _unavail(operatorGuidance.reason),
    operatorGuidance: operatorGuidance.available
      ? { available: true, confirms: operatorGuidance.confirms, cancels: operatorGuidance.cancels }
      : _unavail(operatorGuidance.reason),
    riskEscalation:    featuredEvent ? depth.buildRiskEscalation(featuredEvent, mode === 'released' ? 'released' : 'pre_event') : _unavail('no featured event'),
    eventDayReference: depth.buildEventDayReference(),
    sourceNote: {
      available: !!(health.source_used),
      source:    health.source_used   || 'unavailable',
      mode:      health.calendar_mode || 'UNAVAILABLE',
      probabilityBasis: 'engine-derived',
      macroProxies: 'US Dollar Strength (DXY), Market Volatility (VIX), yield curve via FRED T10Y2Y',
    },
    glossaryTerms: {
      available: true,
      terms: ['Dovish','Hawkish','Yield curve','Risk-off','Liquidity sweep','Confirmed candle close'],
    },
    formats: ['png', 'pdf'],
  };
  packet.comparisonNotes = depth.buildComparisonNotes(packet);
  packet.briefingActions = depth.buildBriefingActions(packet);
  return packet;
}

module.exports = { buildDailyFohPacket, buildEventFohPacket };
