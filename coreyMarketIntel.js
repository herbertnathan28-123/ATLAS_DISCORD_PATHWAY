'use strict';
// ============================================================
// ATLAS FX — COREY MARKET INTEL (operational)
//
// Doctrine:
//   The Market Intel / News & Events channel must NOT pump raw
//   news. Every posted item is first analysed by Corey:
//     ingest → relevance → affected → mechanism →
//     conditional bias → confidence → ATLAS interpretation →
//     gate → format → sanitise → post.
//
//   No raw firehose. No certainty. No invented values. No hype.
//   No permission/authorisation wording. No act-now language.
//   Bias remains conditional until price confirms through structure.
//
// Public API:
//   init({ webhookUrl?, calendarModule?, coreyLiveModule? })
//   start()  — start the 5-minute scheduler tick (idempotent)
//   stop()   — clear the scheduler
//   getCoreyMarketIntelContext() — returns the spec'd data object
//   analyseEvent / formatIntelPayload / sanitize           (analysis)
//   buildDailyBulletin / buildPreEventAlert /
//   buildReleasedEventAlert / buildGeopoliticalStatus      (builders)
//
// All deps are optional / lazy-required so the module never
// breaks the bot at boot.
// ============================================================

const https = require('https');
const fomo  = require('./darkHorseFomoControl'); // reuse banned-phrase sanitiser
const { interpretCalendarEvents, logMacroIntelligencePacket } = require('./macro/interpretCalendarEvents');

// ── ENUMS ────────────────────────────────────────────────────
const RELEVANCE = { HIGH: 'High', MODERATE: 'Moderate', LOW: 'Low' };
const BIAS_KIND = { BULLISH: 'Bullish', BEARISH: 'Bearish', MIXED: 'Mixed', NEUTRAL: 'Neutral', UNKNOWN: 'Unknown' };
const CONFIDENCE = { LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High' };
const ATLAS_STATE = {
  MONITORING:        'Monitoring only',
  DARK_HORSE_MONITOR:'Dark Horse should monitor',
  JANE_REQUIRED:     'Jane confirmation required',
  EVENT_RISK_HIGH:   'Event risk high',
};
const EVENT_RISK = { LOW: 'low', MODERATE: 'moderate', HIGH: 'high', EXTREME: 'extreme' };
const GEO_RISK   = { LOW: 'low', MODERATE: 'moderate', HIGH: 'high' };

// ── CURRENCY → AFFECTED SYMBOLS ──────────────────────────────
const CCY_TO_SYMBOLS = {
  USD: ['DXY','EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','AUDUSD','NZDUSD','XAUUSD','NAS100','US500','US30'],
  EUR: ['EURUSD','EURGBP','EURJPY','EURAUD','EURCAD','EURCHF','GER40'],
  GBP: ['GBPUSD','EURGBP','GBPJPY','GBPAUD','GBPCAD','GBPCHF','UK100'],
  JPY: ['USDJPY','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY','JPN225'],
  AUD: ['AUDUSD','EURAUD','GBPAUD','AUDJPY','AUDCAD','AUDNZD'],
  CAD: ['USDCAD','EURCAD','GBPCAD','CADJPY','AUDCAD','NZDCAD','USOIL','WTI'],
  CHF: ['USDCHF','EURCHF','GBPCHF','CHFJPY'],
  NZD: ['NZDUSD','AUDNZD','NZDCAD'],
  CNY: ['USDCNH','AUDUSD','NZDUSD','XAUUSD'],
};

// ── RELEVANCE PATTERNS ───────────────────────────────────────
const HIGH_RELEVANCE_PATTERNS = [
  /\bCPI\b/i, /\bPCE\b/i, /\bcore inflation\b/i, /\binflation rate\b/i,
  /\bnonfarm\b/i, /\bNFP\b/i, /\bunemployment\b/i, /\bjobs report\b/i, /\bemployment change\b/i,
  /\bfed (?:funds|rate|decision|chair|speak|FOMC)\b/i, /\bFOMC\b/i,
  /\bECB (?:rate|decision|press)\b/i, /\bBOE (?:rate|decision)\b/i,
  /\bBOJ (?:rate|decision|policy)\b/i, /\bRBA (?:rate|decision)\b/i, /\bBOC (?:rate|decision)\b/i,
  /\bGDP\b/i, /\bretail sales\b/i, /\bPMI\b/i, /\bISM\b/i,
  /\bpolicy decision\b/i, /\bpress conference\b/i,
  /\b(?:tariff|sanction|geopolit|war|invasion|attack)\b/i,
  /\brate decision\b/i,
];
const MODERATE_RELEVANCE_PATTERNS = [
  /\b(?:industrial production|consumer confidence|trade balance|housing starts|building permits|durable goods)\b/i,
];
const HIGH_INTEREST_PATTERNS = [
  /\b(?:speech|testimony|minutes|statement)\b/i,
];

// ── COOLDOWNS / WINDOWS ──────────────────────────────────────
const SCHEDULER_TICK_MS    = parseInt(process.env.MARKET_INTEL_TICK_MS || String(5 * 60 * 1000), 10);
const PRE_EVENT_WINDOWS_MIN = [240, 60, 30, 15];   // 4h, 1h, 30m, 15m
const RELEASE_GRACE_MIN     = 1;                   // fire at scheduled+1min
const DAILY_BULLETIN_UTC_HOUR = parseInt(process.env.MARKET_INTEL_DAILY_HOUR_UTC || '6', 10); // ~14:00 AWST default
const TRADER_NOTE_DEFAULT =
  'Do not chase the first spike. Watch for liquidity sweep, rejection, and candle-close confirmation before treating the move as continuation.';
const BIAS_CONDITIONAL_DISCLAIMER =
  'Bias remains conditional until price confirms through structure.';

// ============================================================
// STATE
// ============================================================
let _calendarModule = null;
let _coreyLiveModule = null;
let _webhookUrl = null;
let _webhookEnvKey = 'missing';
let _tickHandle = null;
let _initialised = false;

const _alertsSent = new Map();           // key=`${eventKey}:${stage}` → ts
const _releaseAlertsSent = new Set();    // eventKey
let _lastDailyBulletinUtcDay = null;     // 'YYYY-MM-DD'

// ============================================================
// LOGGING
// ============================================================
function ts() { return new Date().toISOString(); }
function log(line)  { console.log(`[${ts()}] ${line}`); }
function logErr(line){ console.error(`[${ts()}] ${line}`); }

// ============================================================
// LIVE MACRO INTELLIGENCE PACKET
// ============================================================
function _sourceAvailability() {
  let fmpData = { enabled: false, available: false, reason: 'FMP adapter not loaded' };
  let eodhdData = { enabled: false, available: false, reason: 'EODHD adapter not loaded' };
  try {
    const fmp = require('./macro/fmpAdapter');
    const enabled = !!(fmp && fmp.isEnabled && fmp.isEnabled());
    fmpData = { enabled, available: enabled, source: 'fmp' };
  } catch (e) {
    fmpData = { enabled: false, available: false, reason: 'FMP adapter error: ' + e.message };
  }
  try {
    const eodhd = require('./eodhdAdapter');
    const enabled = !!(eodhd && eodhd.isEnabled && eodhd.isEnabled());
    eodhdData = { enabled, available: enabled, source: 'eodhd' };
  } catch (e) {
    eodhdData = { enabled: false, available: false, reason: 'EODHD adapter error: ' + e.message };
  }
  return { fmpData, eodhdData };
}

function _buildMacroIntelligencePacket(snapshot, liveCtx, now, opts) {
  const health = (snapshot && snapshot.health) || { available: false, calendar_mode: 'UNAVAILABLE', source_used: null };
  const events = (snapshot && snapshot.events) || [];
  const src = _sourceAvailability();
  const packet = interpretCalendarEvents({
    events,
    health,
    coreyState: liveCtx,
    fmpData: src.fmpData,
    eodhdData: src.eodhdData,
    now: now || Date.now(),
  });
  if (!opts || opts.log !== false) {
    logMacroIntelligencePacket(packet, line => log(line));
  }
  return packet;
}

function _macroPayloadSeverity(label) {
  const v = String(label || '').toUpperCase();
  if (v === 'EXTREME') return 'STORM';
  if (v === 'ELEVATED') return 'ELEV';
  if (v === 'ACTIVE') return 'MED';
  return 'LOW';
}

function _macroDiscs(riskState) {
  const score = riskState && Number.isFinite(riskState.scoreOutOf5) ? Math.round(riskState.scoreOutOf5) : 2;
  const active = riskState && riskState.label === 'EXTREME' ? '🔴'
    : riskState && riskState.label === 'ELEVATED' ? '🟠'
    : riskState && riskState.label === 'ACTIVE' ? '🟡'
    : '🔵';
  return active.repeat(Math.max(1, score)) + '⚫'.repeat(Math.max(0, 5 - Math.max(1, score)));
}

function _transmissionSummary(packet) {
  const paths = packet && Array.isArray(packet.macroTransmissionMap) ? packet.macroTransmissionMap : [];
  if (!paths.length) return 'No transmission path available; read live US Dollar Strength (DXY), Market Volatility (VIX), and yields before weighting the calendar.';
  return paths.slice(0, 2).map(p =>
    p.driver + ' -> ' + p.firstOrderEffect + ' -> ' + p.secondOrderEffect +
    ' Confirms if: ' + p.whatStrengthensThis + ' Weakens if: ' + p.whatWeakensThis
  ).join('\n');
}

function _macroEventClustersForPayload(packet) {
  return (packet && Array.isArray(packet.eventClusters) ? packet.eventClusters : []).map(c => ({
    currency: c.currency,
    session: c.session,
    severity: c.clusterImpact,
    clusterImpact: c.clusterImpact,
    events: (c.events || []).map(e => ({
      title: e.title,
      currency: e.currency || c.currency,
      eventType: e.eventType,
      time: e.timeUTC || e.time || 'pending',
      timeUTC: e.timeUTC || e.time || 'pending',
      scheduledTimeUTC: e.scheduledTimeUTC,
      severity: e.severity || c.clusterImpact,
      whyMatters: e.whyMatters,
      affectedInstruments: e.affectedInstruments || c.affectedMarkets,
    })),
  }));
}

function _applyMacroPacketToImagePayload(base, macroPacket) {
  if (!base || !macroPacket) return base;
  const primary = macroPacket.primaryEventFocus || {};
  const risk = macroPacket.riskState || {};
  const symbols = (macroPacket.affectedMarketsExpanded || []).map(m => m.symbol);
  base.macroIntelligencePacket = macroPacket;
  base.eventClusters = _macroEventClustersForPayload(macroPacket);
  base.affectedMarkets = { symbols, expanded: macroPacket.affectedMarketsExpanded || [] };
  base.affectedMarketsExpanded = macroPacket.affectedMarketsExpanded || [];
  base.primaryEventFocus = primary;
  base.next24To72Hours = macroPacket.next72Hours || [];
  base.todaysAnnouncements = macroPacket.todayAnnouncements || [];
  base.macroTransmissionMap = macroPacket.macroTransmissionMap || [];
  base.currentRisk = (risk.label || 'UNKNOWN') + ' ' + (risk.scoreOutOf5 || '?') + '/5 — ' + (risk.whyThisRating || 'risk basis unavailable');
  base.whyThisMatters = primary.whyPrimary || base.whyThisMatters;
  base.marketImpact = _transmissionSummary(macroPacket);
  base.whatToWatch = primary.volatilityWindow || base.nextWatch || base.whatToWatch;
  base.nextWatch = primary.volatilityWindow || base.nextWatch;
  base.briefingSummary =
    (macroPacket.dominantMacroTheme || 'Macro theme pending') +
    '. Primary focus: ' + (primary.title || 'none') +
    '. Risk state: ' + (risk.label || 'UNKNOWN') +
    ' because ' + (risk.whyThisRating || 'risk basis unavailable') + '.';
  base.confirmationPath = { narrative: (primary.confidenceBasis || 'Macro confirmation pending') + ' Confirmation condition: ' + ((macroPacket.affectedMarketsExpanded && macroPacket.affectedMarketsExpanded[0] && macroPacket.affectedMarketsExpanded[0].confirmationCondition) || 'US Dollar Strength (DXY), yields, and Market Volatility (VIX) must confirm after the first 15-minute close.') };
  base.cancellationPath = { narrative: (primary.reversalRisk || 'Reversal risk unavailable') + ' Invalidation: ' + ((macroPacket.affectedMarketsExpanded && macroPacket.affectedMarketsExpanded[0] && macroPacket.affectedMarketsExpanded[0].invalidationCondition) || 'first move fades back inside the pre-event range.') };
  base.mood = Object.assign({}, base.mood || {}, {
    severity: _macroPayloadSeverity(risk.label),
    discs: _macroDiscs(risk),
    label: (risk.label || 'UNKNOWN') + ' — ' + (risk.whyThisRating || 'macro interpreter risk state'),
  });
  base.sourceNote = Object.assign({}, base.sourceNote || {}, {
    source: Array.isArray(macroPacket.sourceUsed) ? macroPacket.sourceUsed.join('+') : 'macro_interpreter',
    mode: macroPacket.dataFreshness && macroPacket.dataFreshness.calendar && macroPacket.dataFreshness.calendar.mode,
    probabilityBasis: macroPacket.confidenceBasis,
  });
  return base;
}

function _miSafeBriefStatus(e) {
  const raw = e && (e.fullBriefUrl || e.briefUrl || e.fullBrief || e.brief);
  if (typeof raw !== 'string' || !raw.trim()) return 'Brief Pending';
  const v = raw.trim();
  if (/notion\.(so|com|site)/i.test(v)) return 'Brief Pending';
  if (/^\/market-intel\/brief\/[A-Za-z0-9._~/-]+$/.test(v)) return v;
  if (/^https?:\/\/[A-Za-z0-9.-]+\/market-intel\/brief\/[A-Za-z0-9._~/?=&%-]+$/i.test(v)) return v;
  return 'Brief Pending';
}

function _miShort(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function _miMacroSourceLine(macroPacket, health) {
  const cal = macroPacket && macroPacket.dataFreshness && macroPacket.dataFreshness.calendar || {};
  const sourceRaw = cal.source || (health && health.source_used) || 'calendar_unknown';
  const source = /tradingview/i.test(sourceRaw) ? 'TradingView' : sourceRaw;
  const mode = cal.mode || (health && health.calendar_mode) || 'UNAVAILABLE';
  const degraded = macroPacket && macroPacket.degradedReason ? ' · degradation=' + macroPacket.degradedReason : '';
  return source + ' ' + mode + degraded;
}

function _miRankedEventRows(macroPacket, opts) {
  opts = opts || {};
  const rows = [];
  const seen = new Set();
  const now = opts.now || Date.now();
  const next24End = now + 24 * 60 * 60 * 1000;
  function add(e, fallback) {
    e = e || {};
    fallback = fallback || {};
    const title = e.title || fallback.title || 'Unnamed event';
    const key = [e.timeUTC || e.scheduledTimeUTC || 'pending', e.currency || fallback.currency || 'multi', title].join('|').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const markets = Array.isArray(e.affectedMarkets) ? e.affectedMarkets
      : Array.isArray(e.affectedInstruments) ? e.affectedInstruments
      : Array.isArray(fallback.affectedMarkets) ? fallback.affectedMarkets
      : [];
    rows.push({
      timeUTC: e.timeUTC || e.scheduledTimeUTC || fallback.timeUTC || 'pending',
      currency: e.currency || fallback.currency || 'multi',
      impact: String(e.impact || e.expectedImpact || e.severity || fallback.expectedImpact || fallback.severity || 'MED').toUpperCase(),
      title,
      affectedMarkets: markets,
      fullBrief: _miSafeBriefStatus(e),
      score: Number.isFinite(e.importanceScore) ? e.importanceScore : Number.isFinite(e.score) ? e.score : 0,
      sortMs: Number.isFinite(e.timeMs) ? e.timeMs : (e.scheduledTimeUTC ? Date.parse(e.scheduledTimeUTC) : Number.MAX_SAFE_INTEGER),
      isNext24h: Number.isFinite(e.timeMs)
        ? (e.timeMs > now && e.timeMs <= next24End)
        : (e.scheduledTimeUTC ? (Date.parse(e.scheduledTimeUTC) > now && Date.parse(e.scheduledTimeUTC) <= next24End) : false),
    });
  }
  const next24Aliases = ['next24Hours', 'next24h', 'next_24h', 'next24Events', 'rankedEvents'];
  for (const key of next24Aliases) {
    if (macroPacket && Array.isArray(macroPacket[key])) macroPacket[key].forEach(e => add(e, macroPacket.primaryEventFocus));
  }
  if (macroPacket && Array.isArray(macroPacket.next72Hours)) macroPacket.next72Hours.forEach(e => add(e, macroPacket.primaryEventFocus));
  if (macroPacket && Array.isArray(macroPacket.todayAnnouncements)) macroPacket.todayAnnouncements.forEach(e => add(e, macroPacket.primaryEventFocus));
  for (const c of (macroPacket && macroPacket.eventClusters || [])) {
    for (const e of (c.events || [])) add(e, { currency: c.currency, severity: c.clusterImpact, affectedMarkets: c.affectedMarkets });
  }
  const p = macroPacket && macroPacket.primaryEventFocus;
  if (!rows.length && p && p.title && p.title !== 'No major scheduled catalyst') {
    add({ title: p.title, currency: p.currency, timeUTC: p.timeUTC, expectedImpact: p.expectedImpact, affectedMarkets: p.affectedMarkets }, p);
  }
  return rows.sort((a, b) => {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff) return scoreDiff;
    return (a.sortMs || Number.MAX_SAFE_INTEGER) - (b.sortMs || Number.MAX_SAFE_INTEGER);
  }).slice(0, Number.isFinite(opts.limit) ? opts.limit : 5);
}

function _miRankedCalendarBlock(macroPacket, opts) {
  const rows = _miRankedEventRows(macroPacket, opts);
  if (!rows.length) return 'No selected-symbol release | multi | LOW | Broader market calendar pending | Affected markets pending | Brief Pending';
  return rows.map(r => {
    const markets = r.affectedMarkets && r.affectedMarkets.length
      ? r.affectedMarkets.slice(0, 4).map(symbolDisplay).join(', ')
      : 'Affected markets pending';
    return [
      _miShort(r.timeUTC || 'pending', 10),
      _miShort(r.currency || 'multi', 5),
      _miShort(r.impact || 'MED', 8),
      _miShort(humanizeTitle(r.title), 30),
      _miShort(markets, 54),
      _miShort(r.fullBrief || 'Brief Pending', 24),
    ].join(' | ');
  }).join('\n');
}

function _miAffectedSymbolsFrom(macroPacket, fallbackSymbols) {
  const out = new Set();
  if (Array.isArray(fallbackSymbols)) fallbackSymbols.forEach(s => { if (s) out.add(s); });
  const p = macroPacket && macroPacket.primaryEventFocus;
  if (p && Array.isArray(p.affectedMarkets)) p.affectedMarkets.forEach(s => { if (s) out.add(s); });
  if (macroPacket && Array.isArray(macroPacket.affectedMarketsExpanded)) {
    macroPacket.affectedMarketsExpanded.forEach(m => { if (m && (m.symbol || m.instrument)) out.add(m.symbol || m.instrument); });
  }
  _miRankedEventRows(macroPacket, { limit: 12 }).forEach(r => {
    (r.affectedMarkets || []).forEach(s => { if (s) out.add(s); });
  });
  return Array.from(out).slice(0, 16);
}

function _miRiskWindows(macroPacket) {
  const sessionRisk = macroPacket && macroPacket.sessionRisk;
  const windows = sessionRisk && Array.isArray(sessionRisk.namedWindows) ? sessionRisk.namedWindows.filter(Boolean) : [];
  if (windows.length) return windows.slice(0, 4).map(w => '• ' + w);
  const clusters = macroPacket && Array.isArray(macroPacket.eventClusters) ? macroPacket.eventClusters : [];
  const out = clusters.slice(0, 4).map(c => {
    const start = c.startUTC || c.startTimeUTC || c.windowStartUTC || (c.events && c.events[0] && (c.events[0].timeUTC || c.events[0].time));
    const end = c.endUTC || c.endTimeUTC || c.windowEndUTC || '';
    const label = [c.session, start && end ? (start + '-' + end + ' UTC') : start, c.currency, c.clusterImpact || c.severity].filter(Boolean).join(' · ');
    return '• ' + (label || 'Clustered calendar risk window');
  });
  if (out.length) return out;
  const rows = _miRankedEventRows(macroPacket, { limit: 3 });
  return rows.length
    ? rows.map(r => '• ' + (r.timeUTC || 'pending') + ' UTC · ' + (r.currency || 'multi') + ' · ' + humanizeTitle(r.title))
    : ['• No named release window; monitor live US Dollar Strength (DXY), Market Volatility (VIX), and yields.'];
}

function _miMarketImpactCards(macroPacket) {
  const paths = macroPacket && Array.isArray(macroPacket.macroTransmissionMap) ? macroPacket.macroTransmissionMap : [];
  if (!paths.length) {
    const p = macroPacket && macroPacket.primaryEventFocus || {};
    return ['• Market Impact card 1 — ' + (p.title || 'Broader market calendar') + ': transmission pending; confirm against live US Dollar Strength (DXY), Market Volatility (VIX), yields, and first 5M / 15M close.'];
  }
  return paths.slice(0, 3).map((p, idx) => {
    const affected = Array.isArray(p.affectedSymbols) && p.affectedSymbols.length
      ? p.affectedSymbols.slice(0, 5).map(symbolDisplay).join(', ')
      : 'affected markets pending';
    return '• Market Impact card ' + (idx + 1) + ' — ' + (p.driver || 'Macro driver') + ': ' +
      (p.mechanism || 'macro repricing') + ' Affected markets: ' + affected + '. ' +
      'Confirms if ' + (p.whatStrengthensThis || 'lead markets confirm') + '; degrades if ' + (p.whatWeakensThis || 'live drivers fade the first move') + '.';
  });
}

function _miAffectedMarketCards(macroPacket, fallbackSymbols) {
  const expanded = macroPacket && Array.isArray(macroPacket.affectedMarketsExpanded) ? macroPacket.affectedMarketsExpanded : [];
  if (expanded.length) {
    return expanded.slice(0, 6).map(m => {
      const symbol = symbolDisplay(m.symbol || m.instrument || 'Market');
      const how = m.transmissionMechanism || m.howAffected || 'affected through the primary macro driver';
      const confirm = m.confirmationCondition || m.confirmation || 'lead-market confirmation required';
      return '• ' + symbol + ' — ' + how + '; confirmation: ' + confirm + '.';
    });
  }
  return _miAffectedSymbolsFrom(macroPacket, fallbackSymbols).slice(0, 6)
    .map(s => '• ' + symbolDisplay(s) + ' — mapped from ranked calendar exposure; confirmation required after the release window.');
}

function _miBriefRows(macroPacket) {
  const rows = _miRankedEventRows(macroPacket, { limit: 8 });
  if (!rows.length) return ['• Broader market calendar — Brief Pending'];
  return rows.map(r => '• ' + (r.timeUTC || 'pending') + ' UTC · ' + (r.currency || 'multi') + ' · ' + humanizeTitle(r.title) + ' — ' + (r.fullBrief || 'Brief Pending'));
}

function buildDailyRoadmapMessages(snapshot, geoCtx, now, opts) {
  opts = opts || {};
  const NOW = now || Date.now();
  const macroPacket = opts.macroIntelligencePacket || {};
  const health = (snapshot && snapshot.health) || { available: false };
  const events = (snapshot && snapshot.events) || [];
  const next24End = NOW + 24 * 60 * 60 * 1000;
  const next24Count = events.filter(e => e.scheduled_time > NOW && e.scheduled_time <= next24End).length;
  const p = macroPacket.primaryEventFocus || {};
  const r = macroPacket.riskState || {};
  const affectedSymbols = _miAffectedSymbolsFrom(macroPacket, opts.affectedSymbols || []);
  const rankedRows = _miRankedEventRows(macroPacket, { now: NOW, limit: 8 });
  const sourceLine = _miMacroSourceLine(macroPacket, health);
  const sourceNote = 'Source note: ' + sourceLine + ' · calendar_raw_count=' + (macroPacket.calendarEventsRawCount != null ? macroPacket.calendarEventsRawCount : events.length) +
    ' · next_24h_count=' + next24Count +
    ' · next72_count=' + (Array.isArray(macroPacket.next72Hours) ? macroPacket.next72Hours.length : 0) +
    ' · clusters=' + (Array.isArray(macroPacket.eventClusters) ? macroPacket.eventClusters.length : 0);

  const msg1 = [
    '🔥 **THE CALL**',
    'Primary focus: ' + (p.title || 'Broader market calendar') + (p.currency ? ' / ' + p.currency : ''),
    'Risk state: ' + (r.label || 'UNKNOWN') + (r.scoreOutOf5 != null ? ' ' + r.scoreOutOf5 + '/5' : '') + ' — ' + (r.whyThisRating || 'risk basis unavailable'),
    'Current read: MONITORING — calendar risk leads until Jane / structure confirms a tradable path.',
    'Next confirmation point: ' + (p.volatilityWindow || p.confidenceBasis || 'next ranked release window and first confirmed 5M / 15M close.'),
    '',
    "**TODAY'S RANKED EVENT CALENDAR**",
    'TIME | CCY | IMPACT | EVENT | AFFECTED MARKETS | FULL BRIEF',
    _miRankedCalendarBlock(macroPacket, { now: NOW, limit: 6 }),
    '',
    '**KEY RISK WINDOWS**',
    _miRiskWindows(macroPacket).join('\n'),
    '',
    sourceNote,
  ].join('\n');

  const msg2 = [
    '**MARKET IMPACT**',
    _miMarketImpactCards(macroPacket).join('\n'),
    '',
    '**AFFECTED MARKETS**',
    _miAffectedMarketCards(macroPacket, affectedSymbols).join('\n'),
    '',
    '**CONFIRMATION / DEGRADATION**',
    'Confirmation: ' + (p.confidenceBasis || 'first 5M / 15M close agrees with the lead market and live macro drivers.'),
    'Degradation: ' + (macroPacket.degradedReason || 'none from calendar packet') + '. Downgrade if US Dollar Strength (DXY), Market Volatility (VIX), yields, Corey Clone, or Spidey contradict the primary path.',
    '',
    sourceNote,
  ].join('\n');

  const msg3 = [
    '**FORWARD PLANNING**',
    'Next 24h: ' + next24Count + ' scheduled event(s). Next 72h: ' + (Array.isArray(macroPacket.next72Hours) ? macroPacket.next72Hours.length : 0) + ' ranked relevant event(s).',
    'Primary event: ' + (p.title || 'none') + '. Prepare around named windows; outside them, read live US Dollar Strength (DXY), Market Volatility (VIX), yields, and liquidity.',
    'Ranked coverage: ' + (rankedRows.length ? rankedRows.map(e => humanizeTitle(e.title)).slice(0, 4).join(' | ') : 'Brief Pending until the next live packet resolves ranked events.'),
    '',
    '**FULL BRIEF LINKS / BRIEF PENDING**',
    _miBriefRows(macroPacket).join('\n'),
    '',
    sourceNote,
  ].join('\n');

  return [msg1, msg2, msg3].map((content, idx) => ({
    content,
    index: idx + 1,
    total: 3,
    rankedEventCount: rankedRows.length,
    affectedSymbols,
    sourceLine,
  }));
}

function _spideyStatusLabel(spideyRes) {
  const p = spideyRes && (spideyRes.packet || spideyRes);
  const status = p && p.status ? String(p.status).toUpperCase() : 'BLOCKED';
  if (status === 'ACTIVE' || status === 'OK') return 'ACTIVE';
  if (status === 'PARTIAL') return 'PARTIAL';
  return 'BLOCKED';
}

function _cloneDecisionGrade(cloneRes) {
  if (!cloneRes) return { status: 'BLOCKED', usableForDecision: false, degradedReason: 'Corey Clone not invoked' };
  if (cloneRes.decisionGrade) return cloneRes.decisionGrade;
  const validation = cloneRes.validation || {};
  return {
    status: validation.status || 'PARTIAL',
    usableForDecision: validation.usableForDecision === true,
    sampleSize: validation.sampleSize != null ? validation.sampleSize : validation.validAnalogues,
    denominator: validation.denominator,
    confidenceBasis: validation.confidenceBasis,
    degradedReason: validation.degradedReason,
  };
}

function _buildJaneSynthesis(macroPacket, cloneRes, spideyRes) {
  const clone = _cloneDecisionGrade(cloneRes);
  const spideyStatus = _spideyStatusLabel(spideyRes);
  const macroRisk = macroPacket && macroPacket.riskState ? macroPacket.riskState.label : 'UNKNOWN';
  const degraded = [];
  if (!macroPacket) degraded.push('macro packet unavailable');
  if (!clone.usableForDecision) degraded.push('historical analogue evidence unavailable or not decision-grade');
  if (spideyStatus !== 'ACTIVE') degraded.push('structure confirmation incomplete');
  const finalState = (macroRisk === 'EXTREME' || macroRisk === 'ELEVATED' || spideyStatus !== 'ACTIVE' || !clone.usableForDecision)
    ? 'MONITORING'
    : 'ACTIVE_MONITORING';
  return {
    janeInput: {
      coreyMacro: macroPacket,
      coreyClone: clone,
      spideyStructure: spideyRes && (spideyRes.packet || spideyRes),
      engineStatusSummary: {
        macro: macroPacket ? 'OK' : 'BLOCKED',
        coreyClone: clone.status,
        spidey: spideyStatus,
      },
    },
    macroAlignment: macroPacket ? (macroPacket.dominantMacroTheme || 'macro theme available') : 'macro unavailable',
    historicalAlignment: clone.usableForDecision ? ('decision-grade historical analogue: ' + (clone.dominantOutcome || 'mixed')) : 'historical analogue evidence unavailable or not decision-grade',
    structureAlignment: spideyStatus === 'ACTIVE' ? 'structure packet active' : 'structure confirmation incomplete; execution validity unsupported',
    conflictNotes: degraded,
    actionState: finalState,
    monitoringState: finalState,
    confidenceBasis: [
      macroPacket && macroPacket.confidenceBasis,
      clone.confidenceBasis,
      spideyStatus === 'ACTIVE' ? 'Spidey active' : 'Spidey ' + spideyStatus,
    ].filter(Boolean).join(' | '),
    degradedReason: degraded.length ? degraded.join('; ') : null,
    whatWouldUpgrade: 'Corey Clone usableForDecision=true, Spidey ACTIVE with LTF confirmation, and macro drivers confirming the primary path.',
    whatWouldDowngrade: 'Stale sources, Corey Clone PARTIAL/BLOCKED, Spidey PARTIAL/BLOCKED, or US Dollar Strength (DXY), Market Volatility (VIX), and yields contradicting the primary path.',
  };
}

// ============================================================
// ANALYSIS PRIMITIVES (per-event)
// ============================================================
function deriveRelevance(rawEvent) {
  const t = String(rawEvent.title || '');
  const impact = String(rawEvent.impact || rawEvent.importance || '').toLowerCase();
  if (HIGH_RELEVANCE_PATTERNS.some(re => re.test(t)) || impact === 'high') return RELEVANCE.HIGH;
  if (MODERATE_RELEVANCE_PATTERNS.some(re => re.test(t)) || impact === 'medium') return RELEVANCE.MODERATE;
  return RELEVANCE.LOW;
}

function isHighInterest(rawEvent) {
  const t = String(rawEvent.title || '');
  return HIGH_INTEREST_PATTERNS.some(re => re.test(t));
}

function affectedSymbols(rawEvent) {
  const ccy = rawEvent.currency || '';
  const fromCcy = CCY_TO_SYMBOLS[ccy] ? CCY_TO_SYMBOLS[ccy].slice() : [];
  if (rawEvent.ticker && !fromCcy.includes(rawEvent.ticker)) fromCcy.unshift(rawEvent.ticker);
  return fromCcy;
}

function mechanismTemplate(title) {
  const t = String(title || '').toLowerCase();
  if (/\b(cpi|pce|inflation)\b/.test(t))
    return 'Inflation surprise changes rate-path expectations, which flows into the home currency, yields, gold, and equity risk appetite.';
  if (/\b(nonfarm|nfp|unemployment|jobs|employment change)\b/.test(t))
    return 'Labour data drives central-bank reaction-function pricing; surprise in either direction repositions short-end rates and the home currency.';
  if (/\bgdp\b/.test(t))
    return 'Growth surprise repositions terminal-rate expectations and risk appetite; direction flows into the home currency and equity indices.';
  if (/\b(fed|fomc|ecb|boe|boj|rba|boc|policy decision|press conference|rate decision)\b/.test(t))
    return 'Central-bank communication repositions the rate path; tone vs market pricing drives the home currency and rate-sensitive assets.';
  if (/\bretail sales\b/.test(t))
    return 'Consumer-spending surprise repositions growth/rate expectations; direction flows into the home currency and consumer-cyclical equities.';
  if (/\b(pmi|ism)\b/.test(t))
    return 'Activity surprise repositions growth/rate expectations; sub-50 prints typically pressure the home currency and support defensives.';
  if (/\b(tariff|sanction|geopolit|war|invasion|attack)\b/.test(t))
    return 'Geopolitical shock triggers safe-haven rotation: US Dollar Strength (DXY) / CHF / JPY / XAU typically bid; equities and credit typically offered.';
  return 'Surprise vs forecast repositions short-term rate expectations and risk appetite; direction flows through the home currency and correlated risk assets.';
}

function buildCoreyView(rawEvent) {
  const ccy = rawEvent.currency || 'the home currency';
  const t   = String(rawEvent.title || '').toLowerCase();
  if (/\b(cpi|pce|inflation)\b/.test(t))
    return `This is a major ${ccy} and yield-sensitive release. A strong inflation print may support ${ccy} and yields while pressuring gold and US indices. A weaker print may pressure ${ccy} / yields and support gold / risk assets.`;
  if (/\b(nonfarm|nfp|unemployment|jobs|employment change)\b/.test(t))
    return `This is a major ${ccy} labour release. A strong print typically supports ${ccy} via repricing of the rate path. A weaker print typically pressures ${ccy} and supports rate-sensitive assets such as gold and equity indices.`;
  if (/\b(fed|fomc|ecb|boe|boj|rba|boc|policy decision|press conference|rate decision)\b/.test(t))
    return `This is a central-bank communication event. A hawkish lean supports ${ccy}; a dovish lean pressures ${ccy}. Tone versus current market pricing matters more than the headline decision itself.`;
  if (/\b(tariff|sanction|geopolit|war|invasion|attack)\b/.test(t))
    return `This is a geopolitical shock. Safe-haven rotation is the dominant mechanism: US Dollar Strength (DXY) / CHF / JPY / XAU typically bid, equities and credit typically offered.`;
  if (/\b(pmi|ism)\b/.test(t))
    return `This is a ${ccy} activity release. Sub-50 typically signals contraction and pressures ${ccy}; above-50 supports ${ccy} and risk indices.`;
  if (/\bretail sales\b/.test(t))
    return `This is a ${ccy} consumer-demand release. A strong print typically supports ${ccy} and consumer-cyclical equities; a weak print pressures both.`;
  return `This is a ${ccy} data release. Direction of surprise versus forecast typically flows through ${ccy} pairs and correlated risk assets.`;
}

function deriveBias(rawEvent) {
  const hasActual = rawEvent.actual != null && rawEvent.actual !== '';
  if (!hasActual) {
    return { label: 'Pre-release: Mixed / conditional / not confirmed', kind: BIAS_KIND.MIXED };
  }
  // Post-release: still conditional. Optionally compute a tilt from actual vs forecast,
  // but never present as certainty.
  const a = parseFloat(rawEvent.actual);
  const f = parseFloat(rawEvent.forecast != null ? rawEvent.forecast : rawEvent.expected);
  if (Number.isFinite(a) && Number.isFinite(f) && a !== f) {
    const direction = a > f ? 'above forecast' : 'below forecast';
    return { label: `Post-release (${direction}): conditional, depends on first structure confirmation`, kind: BIAS_KIND.MIXED };
  }
  return { label: 'Post-release: conditional — depends on actual vs forecast and first structure confirmation', kind: BIAS_KIND.MIXED };
}

function deriveConfidence(rawEvent) {
  const hasActual = rawEvent.actual != null && rawEvent.actual !== '';
  if (!hasActual) return { level: CONFIDENCE.MODERATE, note: 'Moderate before release; reassess after data prints.' };
  return { level: CONFIDENCE.MODERATE, note: 'Reassess after first structure confirmation.' };
}

function deriveAtlasState(relevance) {
  if (relevance === RELEVANCE.HIGH)
    return [ATLAS_STATE.EVENT_RISK_HIGH, ATLAS_STATE.DARK_HORSE_MONITOR, ATLAS_STATE.JANE_REQUIRED].join(' — ');
  if (relevance === RELEVANCE.MODERATE)
    return [ATLAS_STATE.MONITORING, ATLAS_STATE.JANE_REQUIRED].join(' — ');
  return ATLAS_STATE.MONITORING;
}

function analyseEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  return {
    title:           rawEvent.title || '(unnamed event)',
    scheduled_time:  rawEvent.scheduled_time || rawEvent.time || null,
    currency:        rawEvent.currency || null,
    actual:          rawEvent.actual,
    forecast:        rawEvent.forecast != null ? rawEvent.forecast : rawEvent.expected,
    previous:        rawEvent.previous,
    relevance:       deriveRelevance(rawEvent),
    affected:        affectedSymbols(rawEvent),
    coreyView:       buildCoreyView(rawEvent),
    mechanism:       mechanismTemplate(rawEvent.title),
    bias:            deriveBias(rawEvent),
    confidence:      deriveConfidence(rawEvent),
    traderNote:      TRADER_NOTE_DEFAULT,
    atlasState:      deriveAtlasState(deriveRelevance(rawEvent)),
  };
}

// fmtVal — operator-facing data placeholder. Returns the value as a
// string, or '—' when missing. Per the locked dashboard/macro wording
// standard the default MUST NOT be the banned token "unavailable".
// Call sites that need richer per-field fallbacks should pass the field
// through fmtValOr(value, fallback) instead.
function fmtVal(v) { return v == null || v === '' ? '—' : String(v); }
function fmtValOr(v, fallback) { return v == null || v === '' ? fallback : String(v); }

function fmtUtcWithAwst(t) {
  if (!t) return 'unavailable';
  const d = new Date(t);
  const utc = d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  // AWST = UTC+8 (no DST)
  const awstMs = d.getTime() + 8 * 60 * 60 * 1000;
  const a = new Date(awstMs);
  const hh = String(a.getUTCHours()).padStart(2, '0');
  const mm = String(a.getUTCMinutes()).padStart(2, '0');
  return `${utc} (${hh}:${mm} AWST)`;
}

// ============================================================
// COREY VIEW PAYLOAD (per single event)
// ============================================================
function formatIntelPayload(analysis) {
  if (!analysis) return { content: '' };
  const affected = (analysis.affected && analysis.affected.length) ? analysis.affected.join(', ') : 'unavailable';
  const sched = fmtUtcWithAwst(analysis.scheduled_time);
  const hasAnyValue = (analysis.actual != null && analysis.actual !== '') ||
                      (analysis.forecast != null && analysis.forecast !== '') ||
                      (analysis.previous != null && analysis.previous !== '');
  const valuesLine = hasAnyValue
    ? `\nValues: actual=${fmtVal(analysis.actual)} · forecast=${fmtVal(analysis.forecast)} · previous=${fmtVal(analysis.previous)}`
    : `\nValues: unavailable until release`;

  const content =
    `**ATLAS MARKET INTEL — COREY VIEW**\n\n` +
    `**Event / News:**\n${analysis.title}\n` +
    `Scheduled: ${sched}${valuesLine}\n\n` +
    `**Relevance:**\n${analysis.relevance}\n\n` +
    `**Affected:**\n${affected}\n\n` +
    `**Corey view:**\n${analysis.coreyView}\n\n` +
    `**Expected mechanism:**\n${analysis.mechanism}\n\n` +
    `**Conditional bias:**\n${analysis.bias.label}\n` +
    `_${BIAS_CONDITIONAL_DISCLAIMER}_\n\n` +
    `**Confidence:**\n${analysis.confidence.level} — ${analysis.confidence.note}\n\n` +
    `**Trader note:**\n${analysis.traderNote}\n\n` +
    `**ATLAS state:**\n${analysis.atlasState}`;

  return { content };
}

// ============================================================
// PRE-EVENT ALERT
// ============================================================
function preEventStageLabel(minutesOut) {
  if (minutesOut >= 240) return 'T-4H';
  if (minutesOut >= 60)  return 'T-1H';
  if (minutesOut >= 30)  return 'T-30M';
  if (minutesOut >= 15)  return 'T-15M';
  return 'T-RELEASE';
}

// ── HUMANISE TRADINGVIEW ECONOMICS:* CODES ──────────────────
const TITLE_CODE_MAP = {
  USCPI: 'US CPI', USPCE: 'US PCE', USNFP: 'US Nonfarm Payrolls',
  USINTR: 'US Fed Funds Rate Decision', USFOMC: 'FOMC Decision',
  USECC: 'US Economic Conditions', USCC: 'US Consumer Confidence',
  USEC:  'US Employment Cost Index', USECI: 'US Employment Cost Index',
  USRSL: 'US Retail Sales', USRS: 'US Retail Sales',
  USPMI: 'US PMI', USISM: 'US ISM',
  USGDP: 'US GDP', USIR: 'US Interest Rate', USIPR: 'US Industrial Production',
  USADP: 'US ADP Employment Change', USJOB: 'US Jobless Claims',
  USURATE: 'US Unemployment Rate',
  EUCPI: 'Eurozone CPI', EUINTR: 'ECB Interest Rate Decision',
  EUGDP: 'Eurozone GDP', EUPMI: 'Eurozone PMI', EUUR: 'Eurozone Unemployment Rate',
  GBCPI: 'UK CPI', GBINTR: 'BOE Interest Rate Decision',
  GBGDP: 'UK GDP', GBPMI: 'UK PMI', GBUR: 'UK Unemployment Rate',
  JPINTR: 'BOJ Interest Rate Decision', JPCPI: 'Japan CPI', JPGDP: 'Japan GDP',
  AUINTR: 'RBA Interest Rate Decision', AUCPI: 'Australia CPI', AUGDP: 'Australia GDP',
  CAINTR: 'BOC Interest Rate Decision', CACPI: 'Canada CPI', CAGDP: 'Canada GDP',
  NZINTR: 'RBNZ Interest Rate Decision', NZCPI: 'New Zealand CPI', NZGDP: 'New Zealand GDP',
  CHINTR: 'SNB Interest Rate Decision', CHCPI: 'Swiss CPI',
};
// Currency-prefix fallback — when an unknown all-caps code appears, decode
// the leading 2-letter country prefix into a readable currency so the
// trader-facing post never shows raw codes like "USEC" or "ECONOMICS:NZINTR".
const CCY_PREFIX_MAP = {
  US: 'US', EU: 'Eurozone', GB: 'UK', JP: 'Japan', AU: 'Australia',
  CA: 'Canada', NZ: 'New Zealand', CH: 'Switzerland', CN: 'China',
};
function humanizeTitle(raw) {
  if (!raw) return '(unnamed event)';
  let t = String(raw).trim();
  // strip "ECONOMICS:" / "FRED:" / "FX:" / similar prefixes
  t = t.replace(/^[A-Z]{2,12}:/, '');
  if (TITLE_CODE_MAP[t]) return TITLE_CODE_MAP[t];
  // Looks like a raw all-caps code (e.g. "USEC", "NZRATE") — render as a
  // readable currency-prefixed label rather than exposing the raw code.
  if (/^[A-Z0-9]{3,12}$/.test(t)) {
    const prefix = t.slice(0, 2);
    const country = CCY_PREFIX_MAP[prefix];
    if (country) return `${country} scheduled economic release`;
    return 'Scheduled economic release';
  }
  return t;
}

// ── AFFECTED-MARKET BUCKETING ────────────────────────────────
const SYM_BUCKET_RULES = [
  { key: 'DXY',          match: s => s === 'DXY' },
  { key: 'USD pairs',    match: s => /^USD|USD$/.test(s) && !/^XAU|^XAG|^DXY$/.test(s) },
  { key: 'EUR pairs',    match: s => /^EUR/.test(s) },
  { key: 'GBP pairs',    match: s => /^GBP/.test(s) },
  { key: 'JPY crosses',  match: s => /JPY$/.test(s) },
  { key: 'AUD/NZD pairs',match: s => /^AUD|^NZD/.test(s) },
  { key: 'Metals',       match: s => /^XAU|^XAG/.test(s) },
  { key: 'US indices',   match: s => /^(NAS100|US500|US30|SPX|NDX|IXIC|GSPC|DJI)$/.test(s) },
  { key: 'EU indices',   match: s => /^(GER40|UK100)$/.test(s) },
  { key: 'Asia indices', match: s => /^(JPN225|HK50)$/.test(s) },
  { key: 'Energy',       match: s => /^(USOIL|WTI|BRENT|NATGAS)$/.test(s) },
];
function bucketAffected(symbols) {
  const out = {};
  if (!symbols || !symbols.length) return out;
  for (const s of symbols) {
    for (const rule of SYM_BUCKET_RULES) {
      if (rule.match(s)) {
        if (!out[rule.key]) out[rule.key] = [];
        if (!out[rule.key].includes(s)) out[rule.key].push(s);
        break;
      }
    }
  }
  return out;
}
const BUCKET_ORDER = ['DXY','USD pairs','EUR pairs','GBP pairs','JPY crosses','AUD/NZD pairs','Metals','US indices','EU indices','Asia indices','Energy'];

// ── MACRO ABBREVIATION DISPLAY MAP ──────────────────────────
// User-facing market-intel text must NEVER surface a bare abbreviation
// (DXY / VIX / US10Y / US2Y) without its expanded name. The rule is:
// expanded name first, abbreviation in brackets, e.g.
//     US Dollar Strength (DXY)
//     Market Volatility (VIX)
//     US 10-Year Treasury Yield (US10Y)
//     US 2-Year Treasury Yield (US2Y)
// macroLabel(abbrev) returns the expanded form for any registered key;
// it returns the input untouched for tickers that are already full
// instrument names (EURUSD, USDJPY, NAS100, XAUUSD, etc.).
const MACRO_LABELS = Object.freeze({
  DXY:   'US Dollar Strength (DXY)',
  VIX:   'Market Volatility (VIX)',
  US10Y: 'US 10-Year Treasury Yield (US10Y)',
  US2Y:  'US 2-Year Treasury Yield (US2Y)',
});
function macroLabel(abbrev) {
  if (!abbrev) return abbrev;
  const key = String(abbrev).toUpperCase();
  return MACRO_LABELS[key] || abbrev;
}
// Bucket-header display map. The bucket KEYS (BUCKET_ORDER) are
// internal grouping handles; the bucket DISPLAY LABEL is what reaches
// the user surface. "DXY" alone is a banned bare abbreviation, so the
// DXY bucket renders its header as the expanded macro label instead.
function bucketHeaderLabel(bucketKey) {
  if (bucketKey === 'DXY') return MACRO_LABELS.DXY;
  return bucketKey;
}
// Symbol-cell display map. Same rule for the comma-joined symbol list
// inside each bucket row: bare DXY in the list becomes the expanded
// label, others are left as-is (they are full instrument names like
// EURUSD / USDJPY / NAS100).
function symbolDisplay(sym) {
  return macroLabel(sym);
}

// ── DRIVER + RISK-TONE INFERENCE ─────────────────────────────
const DRIVER_PATTERNS = [
  { test: /\b(cpi|pce|inflation)\b/i,                                  label: 'inflation data',           short: 'inflation' },
  { test: /\b(nonfarm|nfp|unemployment|jobs|employment change|adp)\b/i, label: 'labour data',              short: 'labour' },
  { test: /\b(fed|fomc|ecb|boe|boj|rba|boc|rbnz|snb|rate decision|policy decision|press conference)\b/i, label: 'central-bank policy event', short: 'central bank' },
  { test: /\bgdp\b/i,                                                   label: 'growth data',              short: 'growth' },
  { test: /\b(retail sales)\b/i,                                        label: 'consumer-demand data',     short: 'consumer demand' },
  { test: /\b(pmi|ism)\b/i,                                             label: 'activity data',            short: 'activity' },
  { test: /\b(tariff|sanction|geopolit|war|invasion|attack)\b/i,        label: 'geopolitical shock',       short: 'geopolitical' },
];
function classifyEventDriver(title) {
  const t = String(title || '');
  for (const p of DRIVER_PATTERNS) if (p.test.test(t)) return p;
  return null;
}
function inferDriverLabels(highEvents) {
  const labels = new Set();
  for (const e of highEvents) {
    const c = classifyEventDriver(e.title);
    if (c) labels.add(c.label);
  }
  return labels.size ? [...labels].slice(0, 3) : [];
}
function inferDriverShorts(highEvents) {
  const shorts = new Set();
  for (const e of highEvents) {
    const c = classifyEventDriver(e.title);
    if (c) shorts.add(c.short);
  }
  return [...shorts];
}
function inferRiskTone(eventRisk, geoLevel, driverLabels) {
  if (eventRisk === EVENT_RISK.EXTREME)
    return 'Defensive — multiple high-impact catalysts; expect choppy, fade-prone tape';
  if (geoLevel === GEO_RISK.HIGH)
    return 'Cautious — geopolitical stress in driver mix; safe-haven flow likely';
  if (eventRisk === EVENT_RISK.HIGH)
    return 'Cautious — defensive flow possible into release windows';
  if (eventRisk === EVENT_RISK.MODERATE)
    return 'Selective — single high-impact catalyst; trade window-aware';
  if (driverLabels.some(l => /central-bank/.test(l)))
    return 'Sensitive — policy tone risk; small surprises produce outsized moves';
  return 'Calm — no scheduled high-impact catalyst; tape is driver-led';
}

// ── DOMINANT RISK SCORE (1..5 emoji bar) ─────────────────────
function riskScoreFromState(eventRisk, geoLevel) {
  let score = 1;
  if (eventRisk === EVENT_RISK.MODERATE) score = 2;
  else if (eventRisk === EVENT_RISK.HIGH) score = 4;
  else if (eventRisk === EVENT_RISK.EXTREME) score = 5;
  if (geoLevel === GEO_RISK.MODERATE && score < 4) score += 1;
  if (geoLevel === GEO_RISK.HIGH && score < 5) score += 1;
  if (score > 5) score = 5;
  return score;
}
function riskScoreEmoji(score) {
  // 1=green, 2=yellow, 3=orange, 4-5=red
  const colour = score === 1 ? '🟩' : score === 2 ? '🟨' : score === 3 ? '🟧' : '🟥';
  return `${colour.repeat(score)}/5`;
}

// ── DAY THEME ────────────────────────────────────────────────
function buildDayTheme(highEvents, driverLabels, primaryAffected) {
  if (!highEvents.length) {
    return 'No scheduled high-impact catalyst today. The tape is driver-led — direction will be set by the live Market Volatility (VIX), US Dollar Strength (DXY), and yields read rather than the calendar.';
  }
  // Find the dominant currency by frequency
  const ccyCounts = {};
  for (const e of highEvents) {
    const c = (e.currency || '').toUpperCase();
    if (c) ccyCounts[c] = (ccyCounts[c] || 0) + 1;
  }
  const dominantCcy = Object.keys(ccyCounts).sort((a, b) => ccyCounts[b] - ccyCounts[a])[0] || 'USD';
  const driverPhrase = driverLabels.length ? driverLabels.join(' + ') : 'scheduled catalyst risk';
  const affectedPhrase = primaryAffected || `${dominantCcy} pairs`;
  return `${dominantCcy} ${driverPhrase} dominates today, with ${humanizeTitle(highEvents[0].title)} creating the main volatility window for ${affectedPhrase}.`;
}

// ── MECHANISM CHAIN (cause → expectation → reaction → impact) ─
function mechanismChainFor(rawEvent) {
  const c = classifyEventDriver(rawEvent.title);
  const ccy = rawEvent.currency || 'home currency';
  if (!c) {
    return [
      `cause: surprise vs forecast`,
      `expectation: short-term rate-path repricing`,
      `market reaction: ${ccy} repositions in the front end`,
      `asset impact: ${ccy} pairs and correlated risk respond on the first close`,
    ].join(' → ');
  }
  if (c.short === 'inflation') {
    return `cause: ${ccy} inflation surprise vs forecast → expectation: rate-path repricing in the front end → market reaction: ${ccy} and yields move first → asset impact: US Dollar Strength (DXY) direction sets gold and US-index reaction`;
  }
  if (c.short === 'labour') {
    return `cause: ${ccy} labour surprise vs forecast → expectation: central-bank reaction-function pricing → market reaction: short-end rates and ${ccy} reposition → asset impact: rate-sensitive assets (gold, indices) follow on first HTF close`;
  }
  if (c.short === 'central bank') {
    return `cause: tone vs current market pricing → expectation: rate-path lean shifts → market reaction: ${ccy} repositions on tone, not headline → asset impact: cross-pair flow and rate-sensitive assets follow`;
  }
  if (c.short === 'growth') {
    return `cause: growth surprise vs forecast → expectation: terminal-rate expectations reset → market reaction: ${ccy} and equity indices respond → asset impact: risk appetite shifts on the first HTF close`;
  }
  if (c.short === 'consumer demand') {
    return `cause: consumer-spending surprise → expectation: growth/rate path repricing → market reaction: ${ccy} repositions → asset impact: consumer-cyclical equities and ${ccy} pairs follow`;
  }
  if (c.short === 'activity') {
    return `cause: activity reading vs 50 expansion line → expectation: growth/rate path repricing → market reaction: ${ccy} responds on directional surprise → asset impact: defensive vs cyclical rotation in equities`;
  }
  if (c.short === 'geopolitical') {
    return `cause: geopolitical shock event → expectation: safe-haven rotation → market reaction: US Dollar Strength (DXY)/CHF/JPY/XAU bid → asset impact: equities and credit offered, vol indices lift`;
  }
  return `cause: surprise vs forecast → expectation: short-term rate-path repricing → market reaction: ${ccy} moves first → asset impact: correlated risk follows on first HTF close`;
}

// ── PER-CURRENCY/ASSET NARRATIVES ────────────────────────────
const NARRATIVE_TEMPLATES = {
  USD: (drivers) => ({
    label: 'USD / US Dollar Strength (DXY)',
    body: drivers.includes('inflation')
      ? 'Hot CPI lifts USD via rate-path repricing; soft CPI eases it. Watching first close above/below the pre-print VWAP.'
      : drivers.includes('labour')
      ? 'Strong labour data supports USD; weak data pressures it. Watching the front-end yield reaction on the first 5m/15m close.'
      : drivers.includes('central bank')
      ? 'Tone vs market pricing is the lever. Hawkish lean supports USD; dovish lean pressures it. Surprises produce outsized moves.'
      : 'USD direction depends on print vs forecast and first structure confirmation.',
  }),
  EUR: () => ({
    label: 'EUR',
    body: 'ECB tone is the lever — hawkish lean supports EUR; dovish lean pressures. Watching cross-pair flow vs USD and EURGBP for relative strength.',
  }),
  GBP: () => ({
    label: 'GBP',
    body: 'BOE pricing and UK growth surprises drive GBP. Watching GBPUSD vs EURGBP for relative strength once data prints.',
  }),
  JPY: () => ({
    label: 'JPY',
    body: 'Yen reacts to safe-haven flow and BOJ policy gap vs G10. Watching USDJPY vs US Dollar Strength (DXY) for confirmation of risk tone.',
  }),
  AUD: () => ({
    label: 'AUD / NZD',
    body: 'Risk-sensitive currencies. Reaction to global risk tone and any RBA/RBNZ commentary. Watching AUDUSD vs equity indices for risk-on/off confirmation.',
  }),
  CAD: () => ({
    label: 'CAD',
    body: 'Tied to oil and BOC pricing. Watching USOIL alongside USDCAD for the dominant driver of the day.',
  }),
  GOLD: (drivers) => ({
    label: 'Gold (XAUUSD)',
    body: drivers.includes('inflation') || drivers.includes('central bank')
      ? 'Inverse to USD/yields. Watching rejection or reclaim of pre-print high after the release.'
      : 'Driven by USD/yields and risk-off flow. Watching for breakdown vs prior session high/low after data.',
  }),
  INDICES: (drivers) => ({
    label: 'US Indices (NAS100 / US500 / US30)',
    body: drivers.includes('inflation') || drivers.includes('labour') || drivers.includes('central bank')
      ? 'Risk asset, sensitive to rate-path repricing. Watching held vs lost VWAP after each release.'
      : 'Risk-on/off driven. Watching VWAP and prior-session levels for first directional bias.',
  }),
};
function buildCurrencyNarratives(highEvents, affectedBuckets) {
  const ccyHits = new Set();
  for (const e of highEvents) {
    const c = (e.currency || '').toUpperCase();
    if (c) ccyHits.add(c);
  }
  const drivers = inferDriverShorts(highEvents);
  const narratives = [];
  if (ccyHits.has('USD') || affectedBuckets['DXY'] || affectedBuckets['USD pairs']) {
    narratives.push(NARRATIVE_TEMPLATES.USD(drivers));
  }
  if (ccyHits.has('EUR') || affectedBuckets['EUR pairs']) narratives.push(NARRATIVE_TEMPLATES.EUR());
  if (ccyHits.has('GBP') || affectedBuckets['GBP pairs']) narratives.push(NARRATIVE_TEMPLATES.GBP());
  if (ccyHits.has('JPY') || affectedBuckets['JPY crosses']) narratives.push(NARRATIVE_TEMPLATES.JPY());
  if (ccyHits.has('AUD') || ccyHits.has('NZD') || affectedBuckets['AUD/NZD pairs']) narratives.push(NARRATIVE_TEMPLATES.AUD());
  if (ccyHits.has('CAD'))                                 narratives.push(NARRATIVE_TEMPLATES.CAD());
  if (affectedBuckets['Metals'] || drivers.includes('inflation') || drivers.includes('central bank')) {
    narratives.push(NARRATIVE_TEMPLATES.GOLD(drivers));
  }
  if (affectedBuckets['US indices'] || ccyHits.has('USD')) {
    narratives.push(NARRATIVE_TEMPLATES.INDICES(drivers));
  }
  return narratives;
}

// ── CLASH & LIQUIDITY RISKS ──────────────────────────────────
function buildClashRisks(highEvents, NOW) {
  if (!highEvents.length) {
    return ['No scheduled high-impact prints — release-window clash risk is low. Watch the tape for driver-led moves.'];
  }
  const sorted = highEvents.slice().sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0));
  const lines = [];

  // Cluster detection — events within 4h
  const clusters = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].scheduled_time || 0) - (sorted[i-1].scheduled_time || 0);
    if (gap <= 4 * 60 * 60 * 1000) cur.push(sorted[i]);
    else { clusters.push(cur); cur = [sorted[i]]; }
  }
  clusters.push(cur);

  const clusterCount = clusters.filter(c => c.length >= 2).length;
  if (clusterCount > 0) {
    const biggestCluster = clusters.sort((a, b) => b.length - a.length)[0];
    const startT = fmtAwstShort(biggestCluster[0].scheduled_time);
    const endT   = fmtAwstShort(biggestCluster[biggestCluster.length - 1].scheduled_time);
    lines.push(`**Event clustering:** ${biggestCluster.length} high-impact prints between ${startT} and ${endT} AWST. Cumulative spike risk; vol carries between releases.`);
  } else if (sorted.length === 1) {
    lines.push(`**Single window:** one high-impact print at ${fmtAwstShort(sorted[0].scheduled_time)} AWST. Concentrated risk in that 30-minute envelope.`);
  } else {
    lines.push(`**Spread windows:** ${sorted.length} high-impact prints distributed across the day; vol resets between each.`);
  }

  lines.push(`**Release-window spike risk:** spreads widen, liquidity thins, fakeouts likely in the first 60–90 seconds of each print.`);
  lines.push(`**Stop-sweep risk:** tight stops above/below recent highs/lows are liable to be cleared into the release. Avoid stops in obvious sweep zones.`);
  if (sorted.length >= 2) {
    lines.push(`**Timing conflict:** flow from one release can bleed into the next — especially when both touch the same currency. Read the second release in the context of the first.`);
  }
  lines.push(`**Why structure matters:** only post-release HTF closes are tradable signal. The first wick is rarely the move.`);
  return lines;
}

// ── ATLAS RESPONSE / TRADE WINDOWS ───────────────────────────
function buildAtlasResponseWindows(highEvents) {
  if (!highEvents.length) {
    return [
      'No scheduled no-trade windows today.',
      'Reassessment: read live Market Volatility (VIX) / US Dollar Strength (DXY) / yields; size only with confirmed structure.',
      'Wait for liquidity sweep + 5m/15m close before treating any directional move as continuation.',
      'Pre-position only with confirmed structure already live; no blind directional bets.',
    ];
  }
  const sorted = highEvents.slice().sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0));
  const windows = sorted.slice(0, 4).map(e => `${fmtAwstShort(e.scheduled_time)} AWST (${humanizeTitle(e.title)})`);
  return [
    `**No-trade window:** 15 minutes before and 30 minutes after each of: ${windows.join(' · ')}.`,
    `**Reassessment:** after the first 5m/15m candle close post-release.`,
    `**Pre-positioning:** allowed only with confirmed structure already live before the no-trade window opens.`,
    `**Trigger rule:** wait for liquidity sweep + reclaim before treating the move as continuation.`,
    `**No direct buy/sell calls** — Corey's job is mechanism + window discipline, not signal generation.`,
  ];
}

// ── COMPACT TIME FORMATTERS ──────────────────────────────────
function fmtAwstShort(t) {
  if (!t) return '—';
  const awst = new Date(new Date(t).getTime() + 8 * 60 * 60 * 1000);
  return `${String(awst.getUTCHours()).padStart(2, '0')}:${String(awst.getUTCMinutes()).padStart(2, '0')}`;
}
function fmtUtcShort(t) {
  if (!t) return '—';
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function fmtAwstDate(t) {
  if (!t) return 'unavailable';
  const awst = new Date(new Date(t).getTime() + 8 * 60 * 60 * 1000);
  return awst.toISOString().slice(0, 10);
}

// ── EVENT-RISK LABEL ─────────────────────────────────────────
function eventRiskLabel(r) { return (r || 'low').toString().toUpperCase(); }

// ── "WHAT COREY IS WAITING TO SEE AFTER" ─────────────────────
function coreyWatchingFor(rawEvent) {
  const t = String(rawEvent.title || '').toLowerCase();
  if (/\b(cpi|pce|inflation)\b/.test(t))
    return 'directional flow into the print, then the first reclaim or rejection on 5m/15m post-release';
  if (/\b(nonfarm|nfp|unemployment|jobs|employment change|adp)\b/.test(t))
    return 'rate-path repricing in the front end and whether USD respects/loses prior session levels';
  if (/\b(fed|fomc|ecb|boe|boj|rba|boc|rate decision|policy decision|press conference)\b/.test(t))
    return 'tone vs current market pricing — hawkish vs dovish lean is the lever, not the headline';
  if (/\b(gdp|retail sales|pmi|ism)\b/.test(t))
    return 'whether the surprise reprices the rate path and how risk indices respond on the first close';
  if (/\b(tariff|sanction|geopolit|war|invasion|attack)\b/.test(t))
    return 'safe-haven rotation depth — US Dollar Strength (DXY) / CHF / JPY / XAU bid alongside equity offer';
  return 'the first higher-timeframe close after the print and whether structure forms either side';
}

// ============================================================
// FOH v6 — MARKET INTEL VISUAL LANGUAGE (operator directive 2026-05-15)
//
// Dark Horse v6 / ATL-6 presentation standard ported onto the
// Market Intel surface. Strict FOH presentation layer — no
// scoring, threshold, scheduler, or webhook changes. Market
// Intel stays distinct from Dark Horse: macro / event /
// catalyst intelligence, not trade setups.
//
// Doctrine enforced here (also asserted in scripts/test_market_intel_qa.js):
//   - No raw BOS / CHoCH / "prints" / "Trigger Level" / bare "trigger"
//   - Bracketed structure language: [Structure Break],
//     [Confirmed candle close], [Shift in market control],
//     [Failed recovery], [Retest held]
//   - Every probability-style statement labels its evidence
//     basis (historically sourced / engine-derived / scenario
//     estimate / insufficient evidence)
//   - Lifecycle states: NEW WATCH / STILL ACTIVE / ESCALATING /
//     RELEASE WINDOW / RESULT IN / COOLING / INVALIDATED
//   - SOURCE NOTE provenance line on every output
//   - Output stays embed-safe (Discord 2000-char hard limit,
//     1900 safe cap — validateMarketIntelPayload below truncates)
// ============================================================

const FOH_HR  = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
const FOH_SUB = '━━━━━━━━━━';

function fohBox(label, glyph, accent) {
  const marker = accent === 'cyan' ? '🟦'
               : accent === 'magenta' ? '🟧'
               : accent === 'red' ? '🟥'
               : accent === 'green' ? '🟩'
               : '🟨';
  // Lane 2 render-fix (operator brief 2026-05-16): replace Unicode
  // box-drawing brackets (▛ ▜) — which rendered as inline text glyphs
  // on Discord rather than as a true box — with native Discord
  // `## H2` heading markdown. Renders as large, bold, visually
  // hierarchical text across all Discord clients (desktop, mobile,
  // web) and saves ~5 chars per heading vs the bracketed form,
  // freeing 1900-char cap headroom.
  const text = (marker + ' ' + (glyph ? glyph + ' ' : '') + label).trim();
  return '## ' + text;
}

function fohBanner(label, subtitle) {
  // Banner uses native Discord `# H1` (biggest heading) so the
  // top-of-message branding is unambiguously the highest in the
  // visual hierarchy. Sections beneath use H2 via fohBox.
  return [
    '# 🟨 📰 ' + label,
    subtitle ? '*' + subtitle + '*' : null,
  ].filter(Boolean).join('\n');
}

// ── Section heading (yellow-gold doctrine — PR #101 live standard) ──
// Heading marker maps to the same colour vocabulary as Dark Horse
// FOH v6 (_sectionBanner / _subheading in darkHorseFoh.js):
//   gold    → 🟨🟨  primary section heading (default)
//   cyan    → 🟦🟦  info / context surface (SOURCE NOTE, BRIEFING SUMMARY, NEXT REVIEW)
//   magenta → 🟧🟧  caution / elevated-risk surface (WHAT CANCELS, FIRST-REACTION CAUTION)
// Orange (🟧) is reserved for caution/elevated only — per
// operator directive 2026-05-15. The legacy SUB-wrapped header
// (`━━━━━━━━━━ glyph label ━━━━━━━━━━`) is replaced with the
// Discord-native bold-emoji form so hierarchy survives across
// mobile + desktop clients.
function fohSection(label, glyph, accent) {
  const sectionAccent = /CANCEL|CAUTION/i.test(label) ? 'magenta'
    : /SOURCE|PROVENANCE|NEXT REVIEW/i.test(label) ? 'cyan'
    : /CONFIRMS/i.test(label) ? 'green'
    : accent;
  return fohBox(label, glyph, sectionAccent);
}

function fohLifecycleSeparator(label) {
  const tag = String(label || 'NEW UPDATE').toUpperCase();
  const accent = /INVALID/.test(tag) ? 'red'
    : /ESCALATING|RELEASE/.test(tag) ? 'magenta'
    : /RESULT|COOLING|STILL ACTIVE/.test(tag) ? 'cyan'
    : 'gold';
  return fohBox(tag, '🔴', accent);
}

// ── Market mood (5-disc traffic-light, FOH v6 doctrine) ─────────
// Same shape as the Dark Horse FOH v6 mood scale: same-family
// active discs + ⚫ inactive disc. Anchored to event risk + the
// inferred geopolitical risk level. Market-Intel-distinct copy —
// no movement / trade-card language.
function fohMarketMoodScale(eventRisk, geoLevel) {
  const filled = (active, glyph) => glyph.repeat(active) + '⚫'.repeat(5 - active);
  if (eventRisk === EVENT_RISK.EXTREME)    return filled(5, '🔴') + ' · **STORM** — multiple high-impact catalysts converging';
  if (geoLevel === GEO_RISK.HIGH)          return filled(5, '🔴') + ' · **STORM** — geopolitical stress dominant';
  if (eventRisk === EVENT_RISK.HIGH)       return filled(4, '🟠') + ' · **ELEVATED** — defensive flow likely into release windows';
  if (geoLevel === GEO_RISK.MODERATE)      return filled(3, '🟠') + ' · **CAUTION** — geopolitical drift in driver mix';
  if (eventRisk === EVENT_RISK.MODERATE)   return filled(3, '🟡') + ' · **WATCH** — single high-impact catalyst forming';
  return filled(2, '🟢') + ' · **CALM** — no scheduled high-impact catalyst';
}

// Dominant risk score header (5-disc, eventRisk-anchored). Mirrors
// the Dark Horse FOH `🟥🟥🟥🟥⚫ 4/5 — High` shape so both surfaces
// read in the same dialect.
function fohDominantRiskBar(eventRisk, geoLevel) {
  const score = riskScoreFromState(eventRisk, geoLevel);
  const glyph = score === 1 ? '🟢' : score === 2 ? '🟡' : score === 3 ? '🟠' : '🔴';
  const word  = eventRisk === EVENT_RISK.EXTREME ? 'Extreme'
              : eventRisk === EVENT_RISK.HIGH    ? 'High'
              : eventRisk === EVENT_RISK.MODERATE ? 'Moderate'
              : 'Low';
  return glyph.repeat(score) + '⚫'.repeat(5 - score) + ' · ' + score + '/5 — ' + word + ' scheduled event risk';
}

// ── Lifecycle (deterministic from stage / role) ────────────────
// NEW WATCH → STILL ACTIVE → ESCALATING → RELEASE WINDOW → RESULT
// IN → COOLING. INVALIDATED is reserved for cancelled / dropped
// events. The scheduler already fires once per stage, so this
// mapping is stateless — no extra cooldown bookkeeping.
function fohLifecycleForStage(stage) {
  switch (String(stage || '').toUpperCase()) {
    case 'T-4H':       return { tag: 'NEW WATCH',      glyph: '🌱', note: 'first appearance in this scan window' };
    case 'T-1H':       return { tag: 'STILL ACTIVE',   glyph: '🌿', note: 'event approaching, window narrowing' };
    case 'T-30M':      return { tag: 'ESCALATING',     glyph: '🔥', note: 'final lead-in — liquidity thinning' };
    case 'T-15M':      return { tag: 'ESCALATING',     glyph: '🚨', note: 'imminent release — stand-down zone' };
    case 'T-RELEASE':  return { tag: 'RELEASE WINDOW', glyph: '🟥', note: 'first reaction live — wait for HTF close' };
    default:           return { tag: 'NEW WATCH',      glyph: '🌱', note: 'event surfaced this scan' };
  }
}
function fohLifecycleReleased()    { return { tag: 'RESULT IN',     glyph: '📊', note: 'data is live — read the reaction, not the headline' }; }
function fohLifecycleForBulletinEvent(evt, now) {
  const t = evt && evt.scheduled_time;
  if (!Number.isFinite(t)) return { tag: 'NEW WATCH', glyph: '🌱' };
  const minsOut = (t - now) / 60000;
  if (minsOut < 0)     return { tag: 'RESULT IN',     glyph: '📊' };
  if (minsOut <= 30)   return { tag: 'ESCALATING',    glyph: '🚨' };
  if (minsOut <= 240)  return { tag: 'STILL ACTIVE',  glyph: '🌿' };
  return                       { tag: 'NEW WATCH',    glyph: '🌱' };
}

// ── Impact tag glyph (red / orange / blue traffic-light) ───────
function fohImpactTag(impact) {
  const i = String(impact || '').toLowerCase();
  if (i === 'high')   return '🟥 HIGH';
  if (i === 'medium') return '🟧 MEDIUM';
  return '🟦 LOW';
}

// ── Plain-English market-impact narration ──────────────────────
// Driver-aware "why this matters" copy. No "prints" / "trigger" /
// "Trigger Level" — uses bracketed structure language where
// shorthand would otherwise leak. Compressed to keep stress-day
// daily bulletin under the 1900-char Discord safe cap.
function fohWhyThisMatters(rawEvent) {
  const c = classifyEventDriver(rawEvent && rawEvent.title);
  const ccy = (rawEvent && rawEvent.currency) || 'home currency';
  const forecast = fmtVal(rawEvent && rawEvent.forecast);
  if (!c) return `Surprise vs forecast ${forecast} reprices short-term rate expectations and correlated risk in ${ccy} pairs.`;
  if (c.short === 'inflation')      return `Inflation surprise vs forecast ${forecast} reprices the front-end ${ccy} rate path; gold + US indices respond inverse to yields.`;
  if (c.short === 'labour')         return `Labour surprise vs forecast ${forecast} resets the central-bank reaction function; front-end yields and ${ccy} move first.`;
  if (c.short === 'central bank')   return `Tone vs the existing rate-path is the lever, not the headline. Hawkish lean supports ${ccy}; dovish lean pressures it; surprises produce outsized moves.`;
  if (c.short === 'growth')         return `Growth surprise vs forecast ${forecast} resets terminal-rate expectations and risk appetite; ${ccy} + equity indices respond together.`;
  if (c.short === 'consumer demand')return `Consumer-spending surprise vs forecast ${forecast} reprices growth + rate expectations; ${ccy} + cyclicals follow.`;
  if (c.short === 'activity')       return `Above-50 vs sub-50 is the directional lever for ${ccy}; defensives + cyclicals rotate on the first 1H close.`;
  if (c.short === 'geopolitical')   return `Geopolitical shock triggers safe-haven rotation — US Dollar Strength (DXY) / CHF / JPY / XAU bid, equities + credit offered.`;
  return `Surprise vs forecast ${forecast} reprices short-term rate expectations and ${ccy} pairs.`;
}

// ── BEFORE / DURING / AFTER framework for event intelligence ──
function fohBeforeDuringAfter(rawEvent) {
  const c = classifyEventDriver(rawEvent && rawEvent.title);
  const ccy = (rawEvent && rawEvent.currency) || 'home currency';
  const forecast = fmtVal(rawEvent && rawEvent.forecast);
  const before = c && c.short === 'central bank'
    ? `Market is pricing the existing rate-path; positioning is light into the decision.`
    : c && c.short === 'geopolitical'
    ? `Safe-haven assets carry a small risk premium into the headline; equities trade light.`
    : `Market is positioning around the ${forecast} consensus; ${ccy} pairs and yields are most sensitive.`;
  const during = c && c.short === 'central bank'
    ? `Hawkish lean supports ${ccy}; dovish lean pressures it. The first 60–90s wick is rarely the move — wait for the next HTF close.`
    : c && c.short === 'geopolitical'
    ? `Safe-haven flow lifts US Dollar Strength (DXY) / CHF / JPY / XAU; equities + credit offered. The first move often overshoots.`
    : `First reaction may be a liquidity sweep. Above forecast supports ${ccy} / yields; below forecast pressures both.`;
  const after = c && c.short === 'central bank'
    ? `Press-conference colour confirms or cancels the tone read. A [Confirmed candle close] on 15M / 1H in tone direction validates continuation.`
    : c && c.short === 'geopolitical'
    ? `Durable safe-haven rotation shows up on the 1H / 4H close, not the headline wick. Reassess only after the close has formed.`
    : `A 5M / 15M [Confirmed candle close] in surprise direction validates continuation. Reassess only after that close.`;
  return { before, during, after };
}

// ── WHAT CONFIRMS / WHAT CANCELS (event-impact framing) ───────
// Renamed from the spec's "CONFIRMATION PATH / CANCELLATION PATH"
// because /\bconfirmation\s+path\b/i is banned by the FOMO
// sanitiser (see darkHorseFomoControl.BANNED_PATTERNS). Same
// semantic content — what proves the read, what kills it.
function fohWhatConfirms(rawEvent) {
  const c = classifyEventDriver(rawEvent && rawEvent.title);
  if (!c) return 'A [Confirmed candle close] on 5M / 15M in surprise direction validates continuation.';
  if (c.short === 'inflation')      return 'US Dollar Strength (DXY) / yields lead; a [Confirmed candle close] on 5M / 15M in surprise direction validates.';
  if (c.short === 'labour')         return 'Front-end yields reprice first; a [Confirmed candle close] on 5M / 15M in surprise direction confirms.';
  if (c.short === 'central bank')   return 'Tone-vs-pricing match shows up in cross-pair flow; a [Confirmed candle close] on 15M / 1H in tone direction validates.';
  if (c.short === 'growth')         return 'Risk indices respond on the first higher-timeframe close after the release.';
  if (c.short === 'activity')       return 'Above-50 vs sub-50 confirms the directional lever; the first 1H close decides.';
  if (c.short === 'consumer demand')return 'Consumer-cyclical leadership confirms; first 1H close in surprise direction validates.';
  if (c.short === 'geopolitical')   return 'Durable safe-haven rotation across US Dollar Strength (DXY) / CHF / JPY / XAU — visible on the 1H / 4H, not the headline wick.';
  return 'A [Confirmed candle close] on 5M / 15M in surprise direction validates continuation.';
}
function fohWhatCancels(rawEvent) {
  const c = classifyEventDriver(rawEvent && rawEvent.title);
  if (c && c.short === 'central bank') return 'Press conference contradicts the headline tone — read flips on the back half of the window.';
  if (c && c.short === 'geopolitical') return 'Headline walked back inside the same session; safe-haven bid fades on the next 1H close ([Failed recovery] cancels the read).';
  return 'First reaction reverses inside 30M; pre-release reference area lost; directional read cancelled.';
}

// ── Probability provenance label (per-event basis) ─────────────
// Market Intel doesn't surface bare %s — but every probabilistic
// statement (bias / scenario / mood) must declare its evidence
// basis. Hooks into macro/probabilityLabelling vocabulary.
function fohProbabilityBasis(rawEvent, hasHistoricalAnchor) {
  if (hasHistoricalAnchor) return 'historically sourced';
  const hasActual = rawEvent && rawEvent.actual != null && rawEvent.actual !== '';
  if (hasActual) return 'engine-derived';
  const c = classifyEventDriver(rawEvent && rawEvent.title);
  if (c && (c.short === 'central bank' || c.short === 'geopolitical')) return 'scenario estimate';
  if (!c) return 'insufficient evidence';
  return 'engine-derived';
}

// ── Source / provenance line ───────────────────────────────────
// Always emit a compact `calendar=… · macro=… · probability=…`
// row so operators can grep provenance from any Market Intel
// post. `health` defaults to the legacy calendar mode strings.
function fohSourceNote(health, probabilityBasis, quoteSource) {
  const cal     = (health && health.source_used)    || 'Fallback';
  const calMode = (health && health.calendar_mode)  || 'UNAVAILABLE';
  const calTag  = calMode === 'LIVE' ? cal : (cal + '/' + calMode);
  const probTag = probabilityBasis || 'engine-derived';
  const parts   = [];
  if (quoteSource) parts.push('quote=' + quoteSource);
  parts.push('calendar=' + calTag);
  parts.push('macro=ATLAS');
  parts.push('probability=' + probTag);
  return parts.join(' · ');
}

// ── Affected-markets compact block ─────────────────────────────
// Embed-safe cap: 5 bucket rows × up to 5 symbols each. Anything
// beyond is summarised as a "…+N more buckets" tail row so the
// Discord cap (1900 chars) is preserved under stress windows.
function fohAffectedBlock(buckets, opts) {
  const maxRows = (opts && Number.isFinite(opts.maxRows)) ? opts.maxRows : 5;
  const maxSymbols = (opts && Number.isFinite(opts.maxSymbols)) ? opts.maxSymbols : 5;
  const rows = [];
  let extraBuckets = 0;
  for (const k of BUCKET_ORDER) {
    if (buckets[k] && buckets[k].length) {
      if (rows.length >= maxRows) { extraBuckets++; continue; }
      const header = bucketHeaderLabel(k);
      const cells = buckets[k].slice(0, maxSymbols).map(symbolDisplay).join(', ');
      rows.push((cells === header) ? '• ' + header : '• ' + header + ' · ' + cells);
    }
  }
  if (!rows.length) {
    rows.push('**AFFECTED MARKETS — driver-led exposure map**');
    rows.push('• USD pairs · EURUSD, GBPUSD, USDJPY, USDCAD, USDCHF');
    rows.push('• US indices · NAS100, US500, US30 · Metals XAUUSD/XAGUSD');
    rows.push('• Yield-sensitive equities + risk FX · mega-cap tech, semis, AUD/NZD/JPY crosses');
  }
  if (extraBuckets > 0) rows.push('• …+' + extraBuckets + ' more sector' + (extraBuckets === 1 ? '' : 's') + ' affected');
  return rows.join('\n');
}

// ── Briefing summary (one-line digest) ─────────────────────────
function fohBriefingSummary(eventRisk, driverLabels, headlineTitle) {
  const riskWord = eventRisk === EVENT_RISK.EXTREME  ? 'Extreme'
                 : eventRisk === EVENT_RISK.HIGH     ? 'High'
                 : eventRisk === EVENT_RISK.MODERATE ? 'Moderate' : 'Low';
  const quietPhrases = [
    'live-driver session',
    'macro-driver day',
    'flow-led session',
    'no scheduled catalyst, so US Dollar Strength (DXY), Market Volatility (VIX), and yields carry the read',
  ];
  const driver = driverLabels && driverLabels.length ? driverLabels.join(' + ') : quietPhrases[0];
  const focus = headlineTitle ? ' anchored by ' + humanizeTitle(headlineTitle) : '';
  return riskWord + ' scheduled event risk · ' + driver + focus + '.';
}

// ── Numeric surprise wording (no "print" verb) ─────────────────
// Released-event surprise tag — uses "above / below / in line"
// language without invoking the banned "prints" / "print" verb.
function fohSurpriseLine(rawEvent) {
  const a = parseFloat(rawEvent && rawEvent.actual);
  const f = parseFloat(rawEvent && rawEvent.forecast);
  if (Number.isFinite(a) && Number.isFinite(f)) {
    if (a > f)      return `Result · **above forecast** (${rawEvent.actual} vs ${rawEvent.forecast}).`;
    if (a < f)      return `Result · **below forecast** (${rawEvent.actual} vs ${rawEvent.forecast}).`;
    return                 `Result · **in line with forecast** (${rawEvent.actual}).`;
  }
  return `Result · actual ${fmtVal(rawEvent && rawEvent.actual)} · forecast ${fmtVal(rawEvent && rawEvent.forecast)} · previous ${fmtVal(rawEvent && rawEvent.previous)}.`;
}

// ── Expanded Terminology row (FOH v6 doctrine) ─────────────────
// Doctrine: renamed from legacy "Learning Links". Same hyperlink
// chip pattern as Dark Horse FOH (visible `[[Label]](url)` form)
// but Market-Intel-flavoured terms so the surface reads in the
// shared FOH v6 dialect.
//
// Lane-1 hardening (operator brief 2026-05-17):
//   - Glossary chip is now a plain styled vocabulary marker —
//     the intelligence is embedded directly in the briefing
//     surface. No external workspace links surface user-side.
//   - Includes the operator-requested macro vocabulary: Dovish /
//     Hawkish / Yield curve / Risk-off / Liquidity sweep, plus
//     the structure-vocabulary anchors (Confirmed close /
//     Structure break) for cross-doctrine continuity.
function fohGlossaryChip() {
  return '📘 [[Glossary]] · Dovish · Hawkish · Yield curve · Risk-off · Liquidity sweep';
}

// ── Historical reaction context (operator brief 2026-05-16) ─────
// Opts-driven section. Renders ONLY when caller supplies a
// `history` array shaped:
//   [{ dateLabel, actual, magnitude, surpriseDir, reaction }, …]
// Never fabricates precision: if the history array is empty /
// missing the section is omitted entirely. When data is present
// the line surfaces the last N analogues compactly so a senior
// operator can read priors at a glance.
//
// Historical credibility doctrine: the helper labels its basis
// transparently. Sample sizes are stated; insufficient samples
// degrade the basis label rather than being silently inflated.
function fohHistoricalContext(history) {
  if (!Array.isArray(history) || !history.length) return null;
  const top = history.slice(0, 3).map(h => {
    const dir = h.surpriseDir || 'in-line';
    const mag = (h.magnitude == null || h.magnitude === '')
      ? ''
      : (typeof h.magnitude === 'number' && h.magnitude > 0 ? '+' + h.magnitude : h.magnitude);
    const magPart = mag ? ' ' + mag : '';
    return (h.dateLabel || '—') + ' ' + (h.actual || '—') + magPart + ' (' + dir + ')';
  }).join(' · ');
  const basis = history.length >= 3 ? 'engine-derived' : 'insufficient evidence';
  return '📅 *Prior ' + Math.min(3, history.length) + ':* ' + top + '. n=' + history.length + ' · basis: ' + basis + '.';
}

// ── Data transparency tail (operator brief 2026-05-16) ──────────
// Surfaces macro proxy provenance + freshness ONLY when calendar
// source is degraded. When LIVE we suppress the tail to keep the
// surface compact; when DEGRADED or FALLBACK we emit a one-line
// transparency warning so the operator sees the fallback path.
//
// This is the "stale-source transparency" mechanism: silent on
// healthy days, vocal on degraded ones. Production-safe under
// the 1900-char cap because the tail is conditional.
function fohSourceTransparencyTail(health, opts) {
  const calMode = (health && health.calendar_mode) || 'UNAVAILABLE';
  if (calMode === 'LIVE') return null;
  const cbAnchor = (opts && opts.cbAnchor) ? ' · cb-anchor=' + opts.cbAnchor : '';
  // Compact one-liner. Uses fully expanded names (US Dollar Index /
  // CBOE Volatility Index) so the bare-abbreviation guard in the
  // QA harness stays clean.
  return '⚠️ *Macro proxies:* US Dollar Index via UUP · CBOE Volatility Index via VXX · yield curve via FRED T10Y2Y' + cbAnchor + '.';
}

const FOH_TERMINOLOGY_LINE =
  '🟦 **Expanded Terminology** · ' +
  '[Structure Break] · [Initial-direction reversal] · [Confirmed candle close] · ' +
  '[Retest held] · [Failed recovery] · [Shift in market control].';

const FOH_BIAS_DISCLAIMER = '_' + BIAS_CONDITIONAL_DISCLAIMER + '_';

// ── FOH packet helpers wiring (operator brief 2026-05-16) ────
// The richer FOH product-depth packet is assembled here and
// attached to every builder's return as `fohPacket`. The text
// payload stays unchanged; the renderer consumes fohPacket
// directly so the live image surface gets prototype-grade depth
// without affecting the text fallback.
function _COUNTRY_FOR_CCY(ccy) {
  const map = { USD: 'US', EUR: 'EU', GBP: 'UK', JPY: 'JP', CAD: 'CA', AUD: 'AU', NZD: 'NZ', CHF: 'CH', CNY: 'CN' };
  return map[String(ccy || '').toUpperCase()] || null;
}

function _miFohPacketHelpers() {
  return {
    classifyEventDriver,
    mechanismChainFor,
    fohBeforeDuringAfter,
    fohWhatConfirms,
    fohWhatCancels,
    humanizeTitle,
    fmtAwstShort,
    fmtUtcShort,
    affectedSymbols,
    bucketAffected,
    countryForCurrency: _COUNTRY_FOR_CCY,
  };
}

function _miBuildEventFohPacket(rawEvent, opts) {
  let pkt;
  try {
    const packetMod = require('./renderers/foh/marketIntelFohPacket');
    let liveCtx = null;
    try { liveCtx = _coreyLiveModule && _coreyLiveModule.getLiveContext && _coreyLiveModule.getLiveContext(); }
    catch (_e) { liveCtx = null; }
    const geoCtx = inferGeopoliticalContext(liveCtx);
    pkt = packetMod.buildEventFohPacket(rawEvent, geoCtx, liveCtx, _miFohPacketHelpers(),
      (opts && opts.released) ? 'released' : 'pre_event',
      Object.assign({ now: Date.now() }, opts || {}));
  } catch (_e) { pkt = null; }
  return pkt;
}

function _miBuildDailyFohPacket(snapshot, geoCtx, now, mode) {
  let pkt;
  try {
    const packetMod = require('./renderers/foh/marketIntelFohPacket');
    let liveCtx = null;
    try { liveCtx = _coreyLiveModule && _coreyLiveModule.getLiveContext && _coreyLiveModule.getLiveContext(); }
    catch (_e) { liveCtx = null; }
    pkt = packetMod.buildDailyFohPacket(snapshot, geoCtx, liveCtx, _miFohPacketHelpers(), mode || 'daily', now);
  } catch (_e) { pkt = null; }
  return pkt;
}

// Mode detector — Saturday or Sunday-pre-FX-open ⇒ weekend
// mode (Monday open prep briefing). Friday post-close also
// flips to weekend mode to start the prep cycle.
function _miInferMiMode(nowMs) {
  const d = new Date(nowMs || Date.now());
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  if (day === 6) return 'weekend';                // Saturday
  if (day === 0 && hour < 22) return 'weekend';   // Sunday pre-FX-open
  if (day === 5 && hour >= 21) return 'weekend';  // Friday post-close
  return 'daily';
}

// ============================================================
// IMAGE-PAYLOAD HELPERS (FOH_IMAGE_RENDER_ENABLED wire-in)
// ============================================================
// When `FOH_IMAGE_RENDER_ENABLED=true`, dispatch() prefers the
// PNG+PDF renderer (renderers/foh) over the text webhook send.
// Each MI builder attaches a structured `imagePayload` object
// alongside the text `content` so the renderer can produce the
// premium card without re-deriving the data from text. If the
// renderer fails or the flag is unset, the text send remains
// the fallback path (operator brief 2026-05-16).
function _miImpactSeverity(impact) {
  const v = String(impact || '').toLowerCase();
  if (v === 'high') return 'HIGH';
  if (v === 'medium') return 'MEDIUM';
  return 'LOW';
}

function _miBuildHistoricalRows(history) {
  if (!Array.isArray(history) || !history.length) return null;
  return {
    rows: history.slice(0, 3).map(h => ({
      label:        h.dateLabel || h.label || '—',
      actual:       h.actual    || '—',
      magnitude:    h.magnitude || '',
      dir:          h.surpriseDir || h.dir || 'in-line',
      reaction:     h.reaction  || '',
    })),
    basis:    history.length >= 3 ? 'engine-derived' : 'insufficient evidence',
    sampleN:  history.length,
  };
}

function _miBuildCrossAsset(buckets) {
  const out = [];
  const fxParts = [];
  if (buckets['DXY'] && buckets['DXY'].length) fxParts.push('US Dollar Strength (DXY)');
  if (buckets['USD pairs']) fxParts.push('USD pairs (' + buckets['USD pairs'].slice(0,4).map(symbolDisplay).join(', ') + ')');
  if (buckets['EUR pairs']) fxParts.push('EUR pairs (' + buckets['EUR pairs'].slice(0,3).map(symbolDisplay).join(', ') + ')');
  if (buckets['GBP pairs']) fxParts.push('GBP pairs (' + buckets['GBP pairs'].slice(0,3).map(symbolDisplay).join(', ') + ')');
  if (buckets['JPY crosses']) fxParts.push('JPY crosses (' + buckets['JPY crosses'].slice(0,3).map(symbolDisplay).join(', ') + ')');
  if (buckets['AUD/NZD pairs']) fxParts.push('AUD / NZD pairs');
  if (fxParts.length) out.push({ classLabel: 'FX', body: fxParts.join(' · ') + ' — direction historically tracks the rate-path repricing first.' });
  const ix = [];
  if (buckets['US indices']) ix.push('US (' + buckets['US indices'].slice(0,3).map(symbolDisplay).join(', ') + ')');
  if (buckets['EU indices']) ix.push('EU (' + buckets['EU indices'].slice(0,2).map(symbolDisplay).join(', ') + ')');
  if (buckets['Asia indices']) ix.push('Asia (' + buckets['Asia indices'].slice(0,2).map(symbolDisplay).join(', ') + ')');
  if (ix.length) out.push({ classLabel: 'Indices', body: ix.join(' · ') + ' — rate-sensitivity favours the inverse of the yield reaction.' });
  const cm = [];
  if (buckets['Metals']) cm.push('Metals (' + buckets['Metals'].slice(0,2).map(symbolDisplay).join(', ') + ')');
  if (buckets['Energy']) cm.push('Energy (' + buckets['Energy'].slice(0,2).map(symbolDisplay).join(', ') + ')');
  if (cm.length) out.push({ classLabel: 'Commodities', body: cm.join(' · ') + ' — historically inverse to USD / yields.' });
  return out;
}

// Build the structured image payload for a single pre-event /
// released-event surface. Mirrors the text builder's data so
// `renderers/foh.marketIntelCard` can produce the premium PNG
// without re-deriving event mechanics.
function _buildMarketIntelImagePayload(rawEvent, a, opts) {
  const isReleased = !!(opts && opts.released);
  const stage = (opts && opts.stage) || (isReleased ? 'RELEASED' : 'PRE-EVENT');
  const lifecycle = isReleased ? fohLifecycleReleased() : fohLifecycleForStage(stage);
  const buckets = bucketAffected(a.affected);
  const eventRiskAtStage = (stage === 'T-RELEASE' || stage === 'T-15M' || stage === 'T-30M')
    ? EVENT_RISK.HIGH : EVENT_RISK.MODERATE;
  const geoLevel = (opts && opts.geoLevel) || GEO_RISK.LOW;
  const moodText = fohMarketMoodScale(eventRiskAtStage, geoLevel);
  // Parse mood text "🟠🟠🟠🟠⚫ · **ELEVATED** — defensive flow..."
  // into discs + label + severity for the structured payload.
  const moodMatch = /^(\S+)\s*·\s*\*\*([A-Z]+)\*\*\s*—\s*(.+)$/.exec(moodText) || [];
  const discs = moodMatch[1] || '⚫⚫⚫⚫⚫';
  const moodWord = moodMatch[2] || 'WATCH';
  const moodTail = moodMatch[3] || '';
  const severityMap = { STORM: 'HIGH', ELEVATED: 'ELEV', CAUTION: 'ELEV', WATCH: 'MED', CALM: 'LOW' };
  const moodSeverity = severityMap[moodWord] || 'MED';

  const probabilityBasis = fohProbabilityBasis(rawEvent);
  const health = (opts && opts.health) || null;
  const calMode = (health && health.calendar_mode) || 'UNAVAILABLE';
  const calSrc  = (health && health.source_used)    || 'unavailable';

  // Operator guidance — re-use the existing copy generators.
  const confirms = fohWhatConfirms(rawEvent);
  const cancels  = fohWhatCancels(rawEvent);

  const payload = {
    kind: isReleased ? 'released' : 'pre_event',
    headline: {
      title:     humanizeTitle(a.title),
      currency:  a.currency || 'pending',
      country:   rawEvent && rawEvent.country,
      impact:    fohImpactTag(rawEvent && rawEvent.impact || 'high'),
      time:      fmtAwstShort(a.scheduled_time) + ' AWST · ' + fmtUtcShort(a.scheduled_time) + ' UTC',
      stage:     stage,
      lifecycle: lifecycle.tag,
    },
    mood: { discs, label: moodWord + ' — ' + moodTail, severity: moodSeverity },
    whyThisMatters: fohWhyThisMatters(rawEvent),
    marketImpact:   mechanismChainFor(rawEvent),
    crossAsset:     _miBuildCrossAsset(buckets),
    operatorGuidance: { confirms, cancels },
    nextWatch: isReleased
      ? 'Reassess on first 5M / 15M close; escalate to 1H / 4H if confirmed candle close in surprise direction.'
      : ('Event time: ' + fmtUtcShort(a.scheduled_time) + ' UTC. First reaction 0–15 min. Reassess on first 1H close.'),
    historical: _miBuildHistoricalRows(opts && opts.history),
    terminology: ['Dovish', 'Hawkish', 'Yield curve', 'Risk-off', 'Liquidity sweep'],
    sourceNote:  { source: calSrc, mode: calMode, probabilityBasis },
    briefingSummary: stage + ' alert · ' + humanizeTitle(a.title) + ' · ' + (a.currency || 'multi-ccy') + '. Bias remains conditional until price confirms through structure.',
  };
  return _applyMacroPacketToImagePayload(payload, opts && opts.macroIntelligencePacket);
}

// Build the daily-bulletin image payload from a calendar
// snapshot + geo context. Currency-grouped event clusters.
function _buildDailyBulletinImagePayload(snapshot, geoCtx, now, macroIntelligencePacket) {
  const NOW = now || Date.now();
  const events = (snapshot && snapshot.events) || [];
  const health = (snapshot && snapshot.health) || { calendar_mode: 'UNAVAILABLE', source_used: 'unavailable' };
  const dayStart = new Date(NOW); dayStart.setUTCHours(0,0,0,0);
  const dayEnd   = new Date(NOW); dayEnd.setUTCHours(23,59,59,999);
  const today = events.filter(e => e.scheduled_time >= dayStart.getTime() && e.scheduled_time <= dayEnd.getTime());
  const highToday = today.filter(e => deriveRelevance(e) === RELEVANCE.HIGH);
  const eventRisk = classifyEventRisk(highToday.length, (geoCtx && geoCtx.level) || GEO_RISK.LOW);
  const geoLevel  = (geoCtx && geoCtx.level) || GEO_RISK.LOW;
  const moodText  = fohMarketMoodScale(eventRisk, geoLevel);
  const moodMatch = /^(\S+)\s*·\s*\*\*([A-Z]+)\*\*\s*—\s*(.+)$/.exec(moodText) || [];
  const discs = moodMatch[1] || '⚫⚫⚫⚫⚫';
  const moodWord = moodMatch[2] || 'WATCH';
  const moodTail = moodMatch[3] || '';
  const severityMap = { STORM: 'HIGH', ELEVATED: 'ELEV', CAUTION: 'ELEV', WATCH: 'MED', CALM: 'LOW' };
  // Group today's high-impact events by currency for the
  // event-cluster cards on the weekend / daily surface.
  const byCcy = new Map();
  for (const ev of highToday) {
    const ccy = ev.currency || 'OTHER';
    if (!byCcy.has(ccy)) byCcy.set(ccy, []);
    byCcy.get(ccy).push({
      title: humanizeTitle(ev.title),
      time:  fmtAwstShort(ev.scheduled_time) + ' AWST',
      impactSeverity: _miImpactSeverity(ev.impact),
    });
  }
  const eventClusters = [...byCcy.entries()].map(([ccy, evs]) => ({ currency: ccy, events: evs }));

  // Affected symbols + cross-asset narrative.
  const affected = new Set();
  for (const e of highToday) affectedSymbols(e).forEach(s => affected.add(s));
  if (macroIntelligencePacket && Array.isArray(macroIntelligencePacket.affectedMarketsExpanded)) {
    macroIntelligencePacket.affectedMarketsExpanded.forEach(m => { if (m && m.symbol) affected.add(m.symbol); });
  }
  const buckets = bucketAffected([...affected]);

  const payload = {
    kind: 'daily',
    headline: {
      title:     'Daily Roadmap',
      currency:  'multi',
      time:      fmtAwstDate(NOW) + ' AWST',
      stage:     'DAILY',
      lifecycle: 'NEW WATCH',
    },
    mood: { discs, label: moodWord + ' — ' + moodTail, severity: severityMap[moodWord] || 'MED' },
    whyThisMatters: highToday.length
      ? (highToday.length + ' high-impact catalyst' + (highToday.length === 1 ? '' : 's') + ' today. Rate-path repricing + cross-asset flow dominate the session.')
      : 'Flow-led session — US Dollar Strength (DXY), Market Volatility (VIX), and yields set direction. No scheduled high-impact rate-path repricing today.',
    marketImpact: highToday[0]
      ? mechanismChainFor(highToday[0])
      : 'No dominant catalyst — driver-led tape; read cross-asset from the live macro state rather than from the calendar.',
    crossAsset: _miBuildCrossAsset(buckets),
    eventClusters,
    nextWatch: 'Stand down ±15/30M each release; reassess on first close.',
    terminology: ['Dovish', 'Hawkish', 'Yield curve', 'Risk-off', 'Liquidity sweep'],
    sourceNote: {
      source: health.source_used || 'unavailable',
      mode:   health.calendar_mode || 'UNAVAILABLE',
      probabilityBasis: highToday.length ? fohProbabilityBasis(highToday[0]) : 'insufficient evidence',
    },
    briefingSummary: highToday.length
      ? (eventRisk + ' scheduled event risk · ' + highToday.length + ' high-impact catalyst' + (highToday.length === 1 ? '' : 's') + '.')
      : 'Calm session · no scheduled high-impact catalyst.',
  };
  return _applyMacroPacketToImagePayload(payload, macroIntelligencePacket);
}

// ============================================================
// PRE-EVENT ALERT — FOH v6 (presentation rebuild)
// ============================================================
function buildPreEventAlertPayload(rawEvent, minutesOut, opts) {
  const a = analyseEvent(rawEvent);
  if (!a) return { content: '' };
  const stage = preEventStageLabel(minutesOut);
  const lifecycle = fohLifecycleForStage(stage);
  const cleanTitle = humanizeTitle(a.title);
  const buckets = bucketAffected(a.affected);
  const bda = fohBeforeDuringAfter(rawEvent);
  const eventRiskAtStage = (stage === 'T-RELEASE' || stage === 'T-15M' || stage === 'T-30M')
    ? EVENT_RISK.HIGH : EVENT_RISK.MODERATE;
  const geoLevel = (opts && opts.geoLevel) || GEO_RISK.LOW;
  const mood = fohMarketMoodScale(eventRiskAtStage, geoLevel);
  const probBasis = fohProbabilityBasis(rawEvent);
  const health = (opts && opts.health) || null;
  const sourceNote = fohSourceNote(health, probBasis);

  const nextReviewByStage = {
    'T-4H':       'T-1H, T-30M, T-15M; final reassessment after the first 5M / 15M close post-release.',
    'T-1H':       'T-30M and T-15M; final reassessment after the first 5M / 15M close post-release.',
    'T-30M':      'T-15M; reassess after the first 5M / 15M close post-release.',
    'T-15M':      'Stand down through the release; reassess on first 5M / 15M close after the release.',
    'T-RELEASE':  'Reassess on the first 5M / 15M close once the wick has formed.',
  };

  const lines = [];
  lines.push(fohBanner('ATLAS · MARKET INTEL — EVENT WATCH', 'v6 · pre-event surface · ' + stage));
  lines.push('');
  lines.push(fohLifecycleSeparator(lifecycle.tag));
  lines.push('');
  lines.push('📍 **Event** · ' + cleanTitle);
  lines.push('🌍 **Currency** · ' + (a.currency || 'pending') + (rawEvent.country ? ' (' + rawEvent.country + ')' : ''));
  lines.push('⏰ **Time** · ' + fmtAwstShort(a.scheduled_time) + ' AWST · ' + fmtUtcShort(a.scheduled_time) + ' UTC');
  lines.push('🎚️ **Impact** · ' + fohImpactTag(rawEvent.impact || 'high'));
  lines.push('🧭 **Lifecycle** · ' + lifecycle.glyph + ' **' + lifecycle.tag + '** — ' + lifecycle.note);
  lines.push('');
  lines.push(fohSection('MARKET MOOD', '🎚️'));
  lines.push('');
  lines.push(mood);
  lines.push('');
  lines.push(fohSection('WHY THIS MATTERS', '🧠'));
  lines.push('');
  lines.push(fohWhyThisMatters(rawEvent));
  lines.push('');
  lines.push(fohSection('BEFORE / DURING / AFTER', '🧭'));
  lines.push('');
  lines.push('🔵 **BEFORE** — ' + bda.before);
  lines.push('🟡 **DURING** — ' + bda.during);
  lines.push('🟢 **AFTER** — ' + bda.after);
  lines.push('');
  lines.push(fohSection('WHAT CONFIRMS', '✅'));
  lines.push('');
  lines.push(fohWhatConfirms(rawEvent));
  lines.push('');
  lines.push(fohSection('WHAT CANCELS', '❌', 'magenta'));
  lines.push('');
  lines.push(fohWhatCancels(rawEvent));
  lines.push('');
  lines.push(fohSection('AFFECTED MARKETS', '🎯'));
  lines.push('');
  lines.push(fohAffectedBlock(buckets));
  lines.push('');
  lines.push(fohSection('NEXT REVIEW', '🔚', 'cyan'));
  lines.push('');
  lines.push('⏳ ' + (nextReviewByStage[stage] || nextReviewByStage['T-1H']));
  lines.push('');
  // ── HISTORICAL CONTEXT (operator brief 2026-05-16) ──
  // Opts-driven. Renders only when caller supplies opts.history.
  // Inline (no section box) to keep the 1900-char cap discipline
  // intact on stress-day pre-event surfaces.
  const histLine = fohHistoricalContext(opts && opts.history);
  if (histLine) {
    lines.push(histLine);
    lines.push('');
  }
  if (opts && opts.macroIntelligencePacket) {
    const mp = opts.macroIntelligencePacket;
    const p = mp.primaryEventFocus || {};
    const r = mp.riskState || {};
    lines.push(fohSection('COREY MACRO INTERPRETATION', '🧠'));
    lines.push('');
    lines.push('Primary: ' + (p.title || cleanTitle) + ' — ' + (p.whyPrimary || 'macro interpreter selected this as the live focus.'));
    lines.push('Risk: ' + (r.label || 'UNKNOWN') + ' ' + (r.scoreOutOf5 || '?') + '/5 — ' + (r.whyThisRating || 'risk basis unavailable.'));
    lines.push('Transmission: ' + _transmissionSummary(mp).split('\n')[0]);
    lines.push('');
  }
  lines.push(fohSection('SOURCE NOTE', '📚', 'cyan'));
  lines.push('');
  lines.push(sourceNote);
  const transparencyTail = fohSourceTransparencyTail(health, opts);
  if (transparencyTail) lines.push(transparencyTail);
  lines.push('');
  lines.push(fohGlossaryChip());
  lines.push('');
  lines.push(FOH_BIAS_DISCLAIMER);

  const imagePayload = _buildMarketIntelImagePayload(rawEvent, a, Object.assign({}, opts || {}, { released: false, stage, history: opts && opts.history }));
  const fohPacket = _miBuildEventFohPacket(rawEvent, Object.assign({}, opts || {}, { released: false, now: Date.now() }));
  return { content: lines.join('\n'), stage, imagePayload, fohPacket };
}

// ============================================================
// RELEASED EVENT ALERT — FOH v6 (presentation rebuild)
// ============================================================
function buildReleasedEventAlertPayload(rawEvent, opts) {
  const a = analyseEvent(rawEvent);
  if (!a) return { content: '' };
  const cleanTitle = humanizeTitle(a.title);
  const buckets = bucketAffected(a.affected);
  const lifecycle = fohLifecycleReleased();
  const geoLevel = (opts && opts.geoLevel) || GEO_RISK.LOW;
  const mood = fohMarketMoodScale(EVENT_RISK.HIGH, geoLevel);
  const probBasis = fohProbabilityBasis(rawEvent);
  const health = (opts && opts.health) || null;
  const sourceNote = fohSourceNote(health, probBasis);

  const lines = [];
  lines.push(fohBanner('ATLAS · MARKET INTEL — RELEASED EVENT', 'v6 · post-release surface'));
  lines.push('');
  lines.push(fohLifecycleSeparator(lifecycle.tag));
  lines.push('');
  lines.push('📍 **Event** · ' + cleanTitle);
  lines.push('🌍 **Currency** · ' + (a.currency || 'pending'));
  lines.push('⏰ **Released** · ' + fmtAwstShort(a.scheduled_time) + ' AWST · ' + fmtUtcShort(a.scheduled_time) + ' UTC');
  lines.push('🧭 **Lifecycle** · ' + lifecycle.glyph + ' **' + lifecycle.tag + '** — ' + lifecycle.note);
  lines.push('');
  lines.push(fohSection('MARKET MOOD', '🎚️'));
  lines.push('');
  lines.push(mood);
  lines.push('');
  lines.push(fohSection('WHAT CHANGED', '📊'));
  lines.push('');
  lines.push(fohSurpriseLine(rawEvent));
  lines.push('');
  lines.push(fohSection('WHY THIS MATTERS', '🧠'));
  lines.push('');
  lines.push(fohWhyThisMatters(rawEvent));
  lines.push('');
  lines.push(fohSection('WHAT CONFIRMS', '✅'));
  lines.push('');
  lines.push(fohWhatConfirms(rawEvent));
  lines.push('');
  lines.push(fohSection('WHAT CANCELS', '❌', 'magenta'));
  lines.push('');
  lines.push(fohWhatCancels(rawEvent));
  lines.push('');
  lines.push(fohSection('AFFECTED MARKETS', '🎯'));
  lines.push('');
  lines.push(fohAffectedBlock(buckets));
  lines.push('');
  lines.push(fohSection('FIRST-REACTION CAUTION', '🚦', 'magenta'));
  lines.push('');
  lines.push('🟡 The first 60–90s wick is rarely the move. Stand down through the immediate release window; reassess only after the first higher-timeframe close.');
  lines.push('');
  lines.push(fohSection('NEXT REVIEW', '🔚', 'cyan'));
  lines.push('');
  lines.push('⏳ Reassess on the first 5M / 15M close; escalate to 1H / 4H if a [Confirmed candle close] forms in surprise direction.');
  lines.push('');
  // ── HISTORICAL CONTEXT (post-release) ──
  // Same opts-driven contract as the pre-event surface. Inline to
  // preserve 1900-char cap discipline.
  const histLineReleased = fohHistoricalContext(opts && opts.history);
  if (histLineReleased) {
    lines.push(histLineReleased);
    lines.push('');
  }
  if (opts && opts.macroIntelligencePacket) {
    const mp = opts.macroIntelligencePacket;
    const p = mp.primaryEventFocus || {};
    const r = mp.riskState || {};
    lines.push(fohSection('COREY MACRO INTERPRETATION', '🧠'));
    lines.push('');
    lines.push('Primary: ' + (p.title || cleanTitle) + ' — ' + (p.whyPrimary || 'macro interpreter selected this as the live focus.'));
    lines.push('Risk: ' + (r.label || 'UNKNOWN') + ' ' + (r.scoreOutOf5 || '?') + '/5 — ' + (r.whyThisRating || 'risk basis unavailable.'));
    lines.push('Transmission: ' + _transmissionSummary(mp).split('\n')[0]);
    lines.push('');
  }
  lines.push(fohSection('SOURCE NOTE', '📚', 'cyan'));
  lines.push('');
  lines.push(sourceNote);
  const transparencyTailReleased = fohSourceTransparencyTail(health, opts);
  if (transparencyTailReleased) lines.push(transparencyTailReleased);
  lines.push('');
  lines.push(fohGlossaryChip());
  lines.push('');
  lines.push(FOH_BIAS_DISCLAIMER);

  const imagePayload = _buildMarketIntelImagePayload(rawEvent, a, Object.assign({}, opts || {}, { released: true }));
  const fohPacket = _miBuildEventFohPacket(rawEvent, Object.assign({}, opts || {}, { released: true, now: Date.now() }));
  return { content: lines.join('\n'), imagePayload, fohPacket };
}

// ============================================================
// DAILY BULLETIN
// ============================================================
function classifyEventRisk(highImpactCount, geoRisk) {
  if (geoRisk === GEO_RISK.HIGH || highImpactCount >= 4) return EVENT_RISK.EXTREME;
  if (highImpactCount >= 2 || geoRisk === GEO_RISK.MODERATE) return EVENT_RISK.HIGH;
  if (highImpactCount >= 1) return EVENT_RISK.MODERATE;
  return EVENT_RISK.LOW;
}

function nextMajor(eventsToday, eventsTomorrow, now) {
  const NOW = now || Date.now();
  const all = [...(eventsToday || []), ...(eventsTomorrow || [])];
  const high = all
    .filter(e => deriveRelevance(e) === RELEVANCE.HIGH && (e.scheduled_time || 0) > NOW)
    .sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0));
  return high[0] || null;
}

// ============================================================
// DAILY ROADMAP — FOH v6 (presentation rebuild)
//
// Same doctrine surface as the legacy 9-section bulletin —
// MARKET MOOD, EVENT/CATALYST WATCH, WHY THIS MATTERS, WHAT
// CHANGED, WHAT CONFIRMS, WHAT CANCELS, AFFECTED MARKETS,
// NEXT REVIEW, BRIEFING SUMMARY — but compressed into the
// 1900-char Discord safe cap (validateMarketIntelPayload).
// The legacy version produced ~3.8k chars and was being
// silently truncated by the dispatch validator. This rebuild
// keeps every doctrine field but compresses repeated prose
// into labelled rows.
// ============================================================
function buildDailyBulletinPayload(snapshot, geoCtx, now, opts) {
  opts = opts || {};
  const NOW = now || Date.now();
  const macroIntelligencePacket = opts.macroIntelligencePacket || null;
  const events = (snapshot && snapshot.events) || [];
  const health = (snapshot && snapshot.health) || { available: false };
  const dayStart = new Date(NOW); dayStart.setUTCHours(0,0,0,0);
  const dayEnd   = new Date(NOW); dayEnd.setUTCHours(23,59,59,999);
  const next24End = NOW + 24 * 60 * 60 * 1000;

  const today  = events.filter(e => e.scheduled_time >= dayStart.getTime() && e.scheduled_time <= dayEnd.getTime());
  const next24 = events.filter(e => e.scheduled_time > NOW && e.scheduled_time <= next24End);

  const highToday         = today.filter(e => deriveRelevance(e) === RELEVANCE.HIGH);
  const highInterestToday = today.filter(e => isHighInterest(e) && deriveRelevance(e) !== RELEVANCE.HIGH);

  const eventRisk    = classifyEventRisk(highToday.length, (geoCtx && geoCtx.level) || GEO_RISK.LOW);
  const geoLevel     = (geoCtx && geoCtx.level) || GEO_RISK.LOW;
  const driverLabels = inferDriverLabels(highToday);
  const next         = nextMajor(today, next24.filter(e => !today.includes(e)), NOW);
  const riskScore    = riskScoreFromState(eventRisk, geoLevel);

  // Affected symbols across today's high-impact set
  const affected = new Set();
  for (const e of highToday) affectedSymbols(e).forEach(s => affected.add(s));
  if (macroIntelligencePacket && Array.isArray(macroIntelligencePacket.affectedMarketsExpanded)) {
    macroIntelligencePacket.affectedMarketsExpanded.forEach(m => { if (m && m.symbol) affected.add(m.symbol); });
  }
  const buckets = bucketAffected([...affected]);

  // Chronological catalysts (high-impact then high-interest)
  const sortedHigh         = highToday.slice().sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0));
  const sortedHighInterest = highInterestToday.slice().sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0));
  const headline           = sortedHigh[0] || null;

  // ── WHAT CHANGED ──
  // Lead-line summary of the day's change in event risk:
  // cluster vs single-window vs quiet.
  let whatChanged;
  if (sortedHigh.length >= 2) {
    const startT = fmtAwstShort(sortedHigh[0].scheduled_time);
    const endT   = fmtAwstShort(sortedHigh[sortedHigh.length - 1].scheduled_time);
    whatChanged = sortedHigh.length + ' high-impact catalysts cluster between ' + startT + '–' + endT + ' AWST. Cumulative spike risk; vol carries between releases.';
  } else if (sortedHigh.length === 1) {
    whatChanged = 'Single high-impact catalyst at ' + fmtAwstShort(sortedHigh[0].scheduled_time) + ' AWST — concentrated 30-minute risk envelope.';
  } else {
    whatChanged = 'No scheduled high-impact catalysts. This is a macro-driver day — direction set by live US Dollar Strength (DXY), Market Volatility (VIX), and yields.';
  }

  // ── WHY THIS MATTERS ──
  // Anchored on the headline; fall back to a driver-led read.
  const whyThisMatters = headline
    ? fohWhyThisMatters(headline)
    : 'Flow-led session — US Dollar Strength (DXY), Market Volatility (VIX), and yields set direction. No scheduled rate-path repricing today.';

  // ── WHAT CONFIRMS / WHAT CANCELS (anchored on headline) ──
  const whatConfirms = headline
    ? fohWhatConfirms(headline)
    : 'A regime change in live drivers — US Dollar Strength (DXY) bias flip, Market Volatility (VIX) move > 2 points, 10y-2y curve cross — confirms direction.';
  const whatCancels = headline
    ? fohWhatCancels(headline)
    : 'Drivers reverse inside the same session without a higher-timeframe close — the regime-change read is cancelled.';

  // ── NEXT REVIEW ──
  // Don't double-stamp the currency if humanizeTitle already
  // surfaced it (e.g. "CPI (USD)" + currency=USD would render
  // "CPI (USD) (USD)").
  const _nextTitle = next ? humanizeTitle(next.title) : null;
  const _nextCcy   = next && next.currency && _nextTitle && _nextTitle.indexOf('(' + next.currency + ')') === -1 ? ' (' + next.currency + ')' : '';
  const nextReview = next
    ? _nextTitle + _nextCcy + ' · ' + fmtAwstShort(next.scheduled_time) + ' AWST'
    : 'No high-impact event scheduled in the next 48 hours — review on regime change in live drivers.';

  // ── SOURCE NOTE ──
  const probBasis = headline ? fohProbabilityBasis(headline) : 'insufficient evidence';
  const sourceNote = fohSourceNote(health, probBasis);

  // ── BRIEFING SUMMARY ──
  const briefingSummary = fohBriefingSummary(eventRisk, driverLabels, headline ? headline.title : null);

  const briefingDate = fmtAwstDate(NOW);
  const lines = [];

  if (macroIntelligencePacket) {
    const p = macroIntelligencePacket.primaryEventFocus || {};
    const r = macroIntelligencePacket.riskState || {};
    lines.push('🔥 **THE CALL**');
    lines.push('Primary focus: ' + (p.title || 'Broader market calendar') + (p.currency ? ' / ' + p.currency : ''));
    lines.push('Risk state: ' + (r.label || 'UNKNOWN') + (r.scoreOutOf5 != null ? ' ' + r.scoreOutOf5 + '/5' : '') + ' — ' + (r.whyThisRating || 'risk basis unavailable'));
    lines.push('Current read: MONITORING — no confirmed execution read yet; calendar risk leads until structure confirms.');
    lines.push('Next confirmation point: ' + (p.volatilityWindow || p.confidenceBasis || 'next ranked release window and first confirmed 5M / 15M close.'));
    lines.push('Source/degradation: ' + _miMacroSourceLine(macroIntelligencePacket, health));
    lines.push('');
    lines.push("**TODAY'S RANKED EVENT CALENDAR**");
    lines.push('TIME | CCY | IMPACT | EVENT | AFFECTED MARKETS | FULL BRIEF');
    lines.push(_miRankedCalendarBlock(macroIntelligencePacket));
    lines.push('');
  }

  // ── BANNER + MARKET MOOD ──
  // The mood disc-scale row encodes risk level + geopolitical
  // tone in one line — the inline "dominant risk" / "geopolitical"
  // headers are redundant and would crowd the embed cap on
  // stress days.
  lines.push(fohBanner('ATLAS · MARKET INTEL — DAILY ROADMAP', 'v6 · daily surface · ' + briefingDate + ' AWST'));
  lines.push('');
  lines.push(fohSection('MARKET MOOD', '🎚️'));
  lines.push('');
  lines.push(fohMarketMoodScale(eventRisk, geoLevel));
  lines.push('');

  // ── EVENT / CATALYST WATCH ──
  // Tight row format: `• HH:MM 🟥 EVENT (CCY) · 🌿 STATE` — impact
  // glyph already encodes impact word; lifecycle glyph + tag tail.
  // Capped at 4 high + 2 medium to keep Discord embed-safe in
  // stress windows.
  lines.push(fohSection('EVENT / CATALYST WATCH', '📅'));
  lines.push('');
  function _eventRow(e, impact) {
    const lc = fohLifecycleForBulletinEvent(e, NOW);
    const impGlyph = impact === 'medium' ? '🟧' : '🟥';
    const _title = humanizeTitle(e.title);
    // Don't double-stamp the currency suffix if humanizeTitle
    // already includes it (e.g. "CPI (USD)" + currency=USD).
    const ccy = (e.currency && _title.indexOf('(' + e.currency + ')') === -1) ? ' (' + e.currency + ')' : '';
    return '• ' + fmtAwstShort(e.scheduled_time) + ' ' + impGlyph + ' ' + _title + ccy + ' · ' + lc.glyph + ' ' + lc.tag;
  }
  if (sortedHigh.length) {
    for (const e of sortedHigh.slice(0, 4)) lines.push(_eventRow(e, 'high'));
    if (sortedHigh.length > 4) lines.push('• …+' + (sortedHigh.length - 4) + ' more high-impact (see calendar)');
  } else {
    // Quiet-day lifecycle — surface the COOLING / driver-led
    // state so the doctrine lifecycle field is always present.
    lines.push('• No high-impact catalysts scheduled — 🍂 COOLING / live-driver session.');
  }
  for (const e of sortedHighInterest.slice(0, 1)) lines.push(_eventRow(e, 'medium'));
  lines.push('');

  // ── WHY THIS MATTERS ──
  lines.push(fohSection('WHY THIS MATTERS', '🧠'));
  lines.push('');
  lines.push(whyThisMatters);
  lines.push('');

  // ── WHAT CHANGED ──
  lines.push(fohSection('WHAT CHANGED', '📊'));
  lines.push('');
  lines.push(whatChanged);
  lines.push('');

  // ── WHAT CONFIRMS ──
  lines.push(fohSection('WHAT CONFIRMS', '✅'));
  lines.push('');
  lines.push(whatConfirms);
  lines.push('');

  // ── WHAT CANCELS ──
  lines.push(fohSection('WHAT CANCELS', '❌', 'magenta'));
  lines.push('');
  lines.push(whatCancels);
  lines.push('');

  // ── AFFECTED MARKETS ──
  // Stress windows (4+ high-impact catalysts) tighten the
  // sector-row cap so the embed stays under 1900 chars.
  const _affectedOpts = sortedHigh.length >= 4
    ? { maxRows: 4, maxSymbols: 4 }
    : { maxRows: 5, maxSymbols: 5 };
  lines.push(fohSection('AFFECTED MARKETS', '🎯'));
  lines.push('');
  lines.push(fohAffectedBlock(buckets, _affectedOpts));
  lines.push('');

  // ── NEXT REVIEW ──
  lines.push(fohSection('NEXT REVIEW', '🔚', 'cyan'));
  lines.push('');
  lines.push('⏳ Next major · ' + nextReview);
  lines.push('🛡️ Stand down ±15/30M each release; reassess on first close.');
  lines.push('');

  // ── BRIEFING SUMMARY ──
  lines.push(fohSection('BRIEFING SUMMARY', '📚', 'cyan'));
  lines.push('');
  lines.push(briefingSummary);
  lines.push('');
  if (macroIntelligencePacket) {
    const p = macroIntelligencePacket.primaryEventFocus || {};
    const r = macroIntelligencePacket.riskState || {};
    const mkts = (macroIntelligencePacket.affectedMarketsExpanded || []).slice(0, 6)
      .map(m => m.symbol + ' via ' + m.transmissionMechanism)
      .join(' | ');
    lines.push(fohSection('COREY MACRO INTERPRETATION', '🧠'));
    lines.push('');
    lines.push('Primary: ' + (p.title || 'none') + ' — ' + (p.whyPrimary || 'driver-led macro read.'));
    lines.push('Risk: ' + (r.label || 'UNKNOWN') + ' ' + (r.scoreOutOf5 || '?') + '/5 — ' + (r.whyThisRating || 'risk basis unavailable.'));
    lines.push('Affected: ' + (mkts || 'No affected-market mapping available.'));
    lines.push('Transmission: ' + _transmissionSummary(macroIntelligencePacket).split('\n')[0]);
    lines.push('');
  }

  // ── SOURCE NOTE ──
  lines.push(fohSection('SOURCE NOTE', '📚', 'cyan'));
  lines.push('');
  lines.push(sourceNote);
  const dailyTransparency = fohSourceTransparencyTail(health);
  if (dailyTransparency) lines.push(dailyTransparency);
  lines.push('');
  lines.push(fohGlossaryChip());
  lines.push('');
  lines.push(FOH_BIAS_DISCLAIMER);

  const imagePayload = _buildDailyBulletinImagePayload(snapshot, geoCtx, NOW, macroIntelligencePacket);
  const fohPacket = _miBuildDailyFohPacket(snapshot, geoCtx, NOW, _miInferMiMode(NOW));
  const dailyRoadmapMessages = buildDailyRoadmapMessages(snapshot, geoCtx, NOW, {
    macroIntelligencePacket,
    affectedSymbols: [...affected].slice(0, 16),
  });
  return {
    content: lines.join('\n'),
    dailyRoadmapMessages,
    imagePayload,
    fohPacket,
    macroIntelligencePacket,
    counts: {
      highImpactTodayCount: highToday.length,
      highInterestTodayCount: highInterestToday.length,
      next24hCount: next24.length,
      next72hCount: macroIntelligencePacket && Array.isArray(macroIntelligencePacket.next72Hours) ? macroIntelligencePacket.next72Hours.length : 0,
      rankedEventCount: dailyRoadmapMessages[0] ? dailyRoadmapMessages[0].rankedEventCount : 0,
    },
    nextMajorEvent: next,
    eventRisk,
    riskScore,
    driver: driverLabels.join(' + '),
    affectedSymbols: [...affected].slice(0, 16),
    calendarMode: health.calendar_mode || 'UNAVAILABLE',
    calendarSource: health.source_used || 'unavailable',
  };
}

// ============================================================
// GEOPOLITICAL STATUS (inferred from market drivers)
// ============================================================
function inferGeopoliticalContext(coreyLiveCtx) {
  if (!coreyLiveCtx) return { level: GEO_RISK.LOW, summary: 'Corey live context unavailable; risk inferred as LOW by default.', breakingNewsStatus: 'unavailable', drivers: {} };
  const vix = coreyLiveCtx.vix || {};
  const dxy = coreyLiveCtx.dxy || {};
  const yld = coreyLiveCtx.yield_ || coreyLiveCtx.yield || {};

  const vixLevel = vix.level || 'Normal';
  const dxyBias  = dxy.bias  || 'Neutral';
  const yieldRegime = yld.regime || 'Normal';

  let level = GEO_RISK.LOW;
  const reasons = [];
  if (/^(High|Elevated|Extreme)$/i.test(vixLevel)) {
    level = GEO_RISK.MODERATE;
    reasons.push(`Market Volatility (VIX) ${vixLevel}`);
  }
  if (/^(High|Extreme)$/i.test(vixLevel) && /Inverted|Stress/i.test(yieldRegime)) {
    level = GEO_RISK.HIGH;
    reasons.push(`yield regime ${yieldRegime}`);
  }
  if (/Bullish/i.test(dxyBias) && /^(High|Elevated|Extreme)$/i.test(vixLevel)) {
    if (level !== GEO_RISK.HIGH) level = GEO_RISK.MODERATE;
    reasons.push('safe-haven US Dollar Strength (DXY) bid alongside elevated Market Volatility (VIX)');
  }
  return {
    level,
    summary: reasons.length ? reasons.join(' · ') : 'live drivers within calm bounds',
    breakingNewsStatus: 'unavailable',
    drivers: { vixLevel, dxyBias, yieldRegime },
  };
}

function buildGeopoliticalStatusPayload(geoCtx) {
  const drivers = (geoCtx && geoCtx.drivers) || {};
  const content =
    `**ATLAS MARKET INTEL — GEOPOLITICAL STATUS**\n\n` +
    `**Breaking headline feed:** ${(geoCtx && geoCtx.breakingNewsStatus) || 'unavailable'}\n` +
    `Geopolitical risk inferred from market drivers only — no live headline monitoring is connected to ATLAS.\n\n` +
    `**Inferred drivers:**\n` +
    `• Market Volatility (VIX) level: ${drivers.vixLevel || 'unavailable'}\n` +
    `• US Dollar Strength (DXY) bias: ${drivers.dxyBias || 'unavailable'}\n` +
    `• Yield regime: ${drivers.yieldRegime || 'unavailable'}\n\n` +
    `**Inferred risk level:** ${(geoCtx && geoCtx.level) || GEO_RISK.LOW}\n` +
    `**Reasoning:** ${(geoCtx && geoCtx.summary) || 'unavailable'}\n\n` +
    `_${BIAS_CONDITIONAL_DISCLAIMER}_`;
  return { content };
}

// ============================================================
// COREY MARKET INTEL CONTEXT — exposed for other consumers
// (Dark Horse / Jane / dashboard). Read-only snapshot.
// ============================================================
function getCoreyMarketIntelContext() {
  let snapshot = null;
  try { snapshot = _calendarModule && _calendarModule.getCalendarSnapshot && _calendarModule.getCalendarSnapshot(); }
  catch (_e) { snapshot = null; }
  let liveCtx = null;
  try { liveCtx = _coreyLiveModule && _coreyLiveModule.getLiveContext && _coreyLiveModule.getLiveContext(); }
  catch (_e) { liveCtx = null; }

  const NOW = Date.now();
  const events = (snapshot && snapshot.events) || [];
  const health = (snapshot && snapshot.health) || { available: false, calendar_mode: 'UNAVAILABLE', source_used: null };

  const dayStart = new Date(NOW); dayStart.setUTCHours(0,0,0,0);
  const dayEnd   = new Date(NOW); dayEnd.setUTCHours(23,59,59,999);
  const next24End = NOW + 24 * 60 * 60 * 1000;

  const today = events.filter(e => e.scheduled_time >= dayStart.getTime() && e.scheduled_time <= dayEnd.getTime());
  const next24 = events.filter(e => e.scheduled_time > NOW && e.scheduled_time <= next24End);

  const highImpactToday   = today.filter(e => deriveRelevance(e) === RELEVANCE.HIGH);
  const highInterestToday = today.filter(e => isHighInterest(e) && deriveRelevance(e) !== RELEVANCE.HIGH);
  const nextMajorEvent    = nextMajor(today, next24.filter(e => !today.includes(e)), NOW);
  const latestRelease     = events
    .filter(e => e.actual != null && e.actual !== '' && e.scheduled_time <= NOW)
    .sort((a, b) => b.scheduled_time - a.scheduled_time)[0] || null;
  const geoCtx = inferGeopoliticalContext(liveCtx);
  const macroIntelligencePacket = _buildMacroIntelligencePacket(snapshot, liveCtx, NOW, { log: false });

  const affectedSet = new Set();
  highImpactToday.forEach(e => affectedSymbols(e).forEach(s => affectedSet.add(s)));
  if (macroIntelligencePacket && Array.isArray(macroIntelligencePacket.affectedMarketsExpanded)) {
    macroIntelligencePacket.affectedMarketsExpanded.forEach(m => { if (m && m.symbol) affectedSet.add(m.symbol); });
  }

  const eventRisk = classifyEventRisk(highImpactToday.length, geoCtx.level);

  // Conditional bias / mechanism / confidence — anchor on the next major event
  // (or the latest release if nothing upcoming). Always conditional, never certainty.
  const anchor = nextMajorEvent || latestRelease;
  const expectedBias = anchor ? deriveBias(anchor).label : 'No anchor event — bias unavailable';
  const confidenceLevel = anchor ? deriveConfidence(anchor).level : CONFIDENCE.LOW;
  const mechanism = anchor ? mechanismTemplate(anchor.title) : 'No anchor event — mechanism unavailable';

  return {
    status:                  health.available ? 'ok' : 'unavailable',
    calendarMode:            health.calendar_mode || 'UNAVAILABLE',
    calendarSource:          health.source_used  || 'unavailable',
    highImpactTodayCount:    highImpactToday.length,
    highInterestTodayCount:  highInterestToday.length,
    nextMajorEvent:          macroIntelligencePacket && macroIntelligencePacket.primaryEventFocus ? macroIntelligencePacket.primaryEventFocus.title : (nextMajorEvent ? nextMajorEvent.title : null),
    nextMajorEventTime:      macroIntelligencePacket && macroIntelligencePacket.primaryEventFocus ? macroIntelligencePacket.primaryEventFocus.timeUTC : (nextMajorEvent ? nextMajorEvent.scheduled_time : null),
    next24hCount:            next24.length,
    latestRelease:           latestRelease ? { title: latestRelease.title, actual: latestRelease.actual, forecast: latestRelease.forecast, scheduled_time: latestRelease.scheduled_time } : null,
    eventRisk,
    geopoliticalRisk:        geoCtx.level,
    breakingNewsStatus:      geoCtx.breakingNewsStatus,
    affectedSymbols:         [...affectedSet],
    expectedBias,
    confidence:              confidenceLevel,
    mechanism,
    traderNote:              TRADER_NOTE_DEFAULT,
    sourceStatus:            health.available ? 'live' : 'unavailable',
    macroIntelligencePacket,
    macroInterpreterDegradedReason: macroIntelligencePacket && macroIntelligencePacket.degradedReason,
  };
}

// ============================================================
// SANITISER + WEBHOOK DELIVERY
// ============================================================
function sanitize(payload) {
  const result = fomo.sanitize(payload);
  if (result.replaced) {
    console.warn(`[${ts()}] [MARKET-INTEL-GUARD] banned phrases stripped: ${result.foundBanned.join(',')}`);
  }
  // Defensive: the upstream FOMO sanitiser inserts "[REDACTED-FOMO]"
  // where it removes a banned phrase. That marker MUST NOT reach the
  // Discord user surface for MARKET_INTEL output. Replace any
  // remaining occurrences with a clean operator-facing fallback
  // ("Market read pending") and log a warning so ops can grep the
  // root-cause banned phrase from the log line above.
  if (result.content && /\[REDACTED-FOMO\]/.test(result.content)) {
    const count = (result.content.match(/\[REDACTED-FOMO\]/g) || []).length;
    console.warn(`[${ts()}] [MARKET-INTEL-GUARD] stripped ${count} [REDACTED-FOMO] marker(s) from user surface — root cause banned phrase logged above`);
    result.content = result.content.replace(/\s*\[REDACTED-FOMO\]\s*/g, ' Market read pending. ');
  }
  return result;
}

// ============================================================
// FINAL OUTBOUND PAYLOAD VALIDATOR (operator directive 2026-05-12 — Lane 3)
//
// Runs AFTER sanitise() / redaction has finished and BEFORE the
// Discord webhook send. Catches the failure mode that produced the
// observed `webhook_status_400` regression: sanitiser-driven content
// collapse, post-redaction whitespace artefacts, oversize content,
// empty embed fields, malformed markdown, orphan separators.
//
// Returns { ok, payload, diagnostics, failureReason? }.
//   diagnostics carries the structured counters operators grep on:
//     original_len           — content length before sanitise()
//     sanitized_len          — content length after sanitise()
//     final_payload_len      — content length after this validator's
//                              cleanup pass (post-truncation if needed)
//     embed_field_count      — number of embed fields (0 for plain
//                              content-only payloads, which is the
//                              shape Market Intel uses today)
//     final_send_allowed     — true / false
//     failure_reason         — concise tag when final_send_allowed
//                              is false; absent on success
//
// Discord webhook content hard limit: 2000 chars. The validator
// truncates to a safe cap of 1900 chars (100-char headroom) when
// possible, then appends "…" to signal truncation rather than
// returning a 400 from Discord. If the post-redaction content
// collapses to fewer than 40 chars OR is empty / whitespace-only,
// the send is blocked.
// ============================================================
const MARKET_INTEL_DISCORD_HARD_LIMIT = 2000;
const MARKET_INTEL_SAFE_CAP           = 1900;
const MARKET_INTEL_MIN_LEN            = 40;

function validateMarketIntelPayload(sanitizedPayload, originalContent) {
  // Coerce inputs defensively — never throw out of the validator.
  const originalLen = (typeof originalContent === 'string') ? originalContent.length : 0;
  const sanitizedContent = (sanitizedPayload && typeof sanitizedPayload.content === 'string')
    ? sanitizedPayload.content
    : '';
  const sanitizedLen = sanitizedContent.length;

  // Post-redaction cleanup — same family of fixes used in the Dark
  // Horse post-sanitise polish, applied here to catch any remaining
  // sanitisation artefacts before the wire.
  let cleaned = sanitizedContent
    // Stray marker — should already be stripped by sanitize() but
    // double-check belt-and-braces.
    .replace(/\[REDACTED-FOMO\]/g, '')
    // Collapse triple+ blank lines.
    .replace(/\n{3,}/g, '\n\n')
    // Strip orphan trailing commas at end-of-line.
    .replace(/,(\s*\n)/g, '$1')
    // Tidy "word  word" double spaces (newlines untouched).
    .replace(/[ \t]{2,}/g, ' ')
    // Tidy " ." / " ," / " ;" leftovers.
    .replace(/\s+([.,;:])/g, '$1')
    // Collapse orphan separators like " · · " or " - - " left by
    // mid-sentence redaction.
    .replace(/(·|-|\|)\s*\1+/g, '$1')
    // Tidy any trailing spaces left dangling at end-of-line by
    // the previous passes (e.g. after a comma got stripped).
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  // Embed-field count — for content-only payloads (Market Intel's
  // current shape) this is always 0. The diagnostic is surfaced for
  // future-proofing in case embed payloads land here later.
  let embedFieldCount = 0;
  if (sanitizedPayload && Array.isArray(sanitizedPayload.embeds)) {
    for (const embed of sanitizedPayload.embeds) {
      if (embed && Array.isArray(embed.fields)) embedFieldCount += embed.fields.length;
    }
  }

  // Truncation: if cleaned content exceeds the safe cap, truncate
  // to the cap minus the ellipsis room and append "…".
  if (cleaned.length > MARKET_INTEL_SAFE_CAP) {
    cleaned = cleaned.slice(0, MARKET_INTEL_SAFE_CAP - 1).replace(/\s+\S*$/, '') + '…';
  }

  const finalLen = cleaned.length;
  const diagnostics = {
    original_len:        originalLen,
    sanitized_len:       sanitizedLen,
    final_payload_len:   finalLen,
    embed_field_count:   embedFieldCount,
    final_send_allowed:  true,
  };

  // Block cases — set final_send_allowed=false + failure_reason.
  let failureReason = null;
  if (finalLen === 0) {
    failureReason = 'empty_after_redaction';
  } else if (finalLen < MARKET_INTEL_MIN_LEN && originalLen >= MARKET_INTEL_MIN_LEN) {
    // Content collapsed below a meaningful read-length AFTER
    // sanitisation removed most of it — likely cascade-redaction.
    failureReason = 'content_collapsed_after_redaction';
  } else if (finalLen > MARKET_INTEL_DISCORD_HARD_LIMIT) {
    // Truncation above should prevent this, but guard explicitly.
    failureReason = 'exceeds_discord_hard_limit';
  }

  if (failureReason) {
    diagnostics.final_send_allowed = false;
    diagnostics.failure_reason     = failureReason;
  }

  // Single structured log line — operators grep this.
  console.log(
    `[${ts()}] [MARKET-INTEL-VALIDATE] ` +
    `original_len=${diagnostics.original_len} ` +
    `sanitized_len=${diagnostics.sanitized_len} ` +
    `final_payload_len=${diagnostics.final_payload_len} ` +
    `embed_field_count=${diagnostics.embed_field_count} ` +
    `final_send_allowed=${diagnostics.final_send_allowed}` +
    (diagnostics.failure_reason ? ` failure_reason=${diagnostics.failure_reason}` : '')
  );

  // Return a new payload object so callers can ship it directly.
  const validatedPayload = Object.assign({}, sanitizedPayload, { content: cleaned });
  return { ok: diagnostics.final_send_allowed, payload: validatedPayload, diagnostics, failureReason };
}

function sendWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    if (!url) { resolve({ skipped: true, reason: 'webhook_missing' }); return; }
    const body = JSON.stringify(payload);
    let parsed;
    try { parsed = new URL(url); }
    catch (e) { reject(new Error(`invalid webhook URL: ${e.message}`)); return; }
    const opts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'ATLAS-FX-MarketIntel/1.0' },
      timeout:  10000,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end',  () => resolve({ status: res.statusCode, body: data.slice(0, 200) }));
    });
    req.on('error',   reject);
    req.on('timeout', () => reject(new Error('Webhook timeout')));
    req.write(body); req.end();
  });
}

// ============================================================
// DISPATCH WRAPPERS — log + safe-fail webhook delivery
// ============================================================
async function dispatch(messageType, payloadObj, extra) {
  extra = extra || {};
  const webhookConfig = _webhookUrl ? 'present' : 'missing';
  // Capture original content length BEFORE sanitise() runs so the
  // validator can report the original→sanitised→final size trail.
  const originalContent = (payloadObj && typeof payloadObj.content === 'string') ? payloadObj.content : '';
  const sanitized = sanitize(payloadObj);
  // Final outbound validator (Lane 3): catches the regression where
  // sanitisation/redaction changes the payload AFTER earlier sizing
  // checks and Discord returns webhook_status_400. Validator emits
  // a [MARKET-INTEL-VALIDATE] log line and either returns the
  // cleaned payload or blocks the send with a structured reason.
  const validation = validateMarketIntelPayload(sanitized, originalContent);
  const validated = validation.payload;
  const eventLabel = extra.event || messageType;
  const affectedLabel = (extra.affected_symbols && extra.affected_symbols.length)
    ? extra.affected_symbols.join('|') : 'n/a';

  log(`[COREY-MARKET-INTEL] message_type=${messageType}`);
  log(`[COREY-MARKET-INTEL] event=${eventLabel}`);
  if (extra.high_impact_today != null) log(`[COREY-MARKET-INTEL] high_impact_today=${extra.high_impact_today}`);
  if (extra.next_major_event)          log(`[COREY-MARKET-INTEL] next_major_event=${extra.next_major_event}`);
  if (extra.next_24h_count != null)    log(`[COREY-MARKET-INTEL] next_24h_count=${extra.next_24h_count}`);
  if (extra.next72_count != null)      log(`[COREY-MARKET-INTEL] next72_count=${extra.next72_count}`);
  if (extra.ranked_event_count != null) log(`[COREY-MARKET-INTEL] ranked_event_count=${extra.ranked_event_count}`);
  if (extra.daily_roadmap_renderer)    log(`[COREY-MARKET-INTEL] daily_roadmap_renderer=${extra.daily_roadmap_renderer}`);
  if (extra.daily_brief_message)       log(`[COREY-MARKET-INTEL] daily_brief_message=${extra.daily_brief_message}`);
  log(`[COREY-MARKET-INTEL] affected_symbols=${affectedLabel}`);
  if (extra.expected_bias)             log(`[COREY-MARKET-INTEL] expected_bias=${extra.expected_bias}`);
  if (extra.confidence)                log(`[COREY-MARKET-INTEL] confidence=${extra.confidence}`);
  log(`[COREY-MARKET-INTEL] webhook_config=${webhookConfig}`);
  if (payloadObj && payloadObj.macroIntelligencePacket) {
    log(`[JANE] macro_packet_received=true`);
    log(`[JANE] corey_clone_received=${payloadObj.coreyClone ? 'true' : 'false'}`);
    log(`[JANE] spidey_status=${_spideyStatusLabel(payloadObj.spidey)}`);
    log(`[JANE] final_state=${payloadObj.janeSynthesis && payloadObj.janeSynthesis.actionState ? payloadObj.janeSynthesis.actionState : 'UNKNOWN'}`);
  }

  if (webhookConfig === 'missing') {
    log(`[COREY-MARKET-INTEL] send_result=skipped`);
    log(`[COREY-MARKET-INTEL] skipped_reason=webhook_missing`);
    return { sent: false, reason: 'webhook_missing', payload: validated, diagnostics: validation.diagnostics };
  }
  if (!validation.ok) {
    // Validator blocked the send — surface the structured reason
    // so the next-scan retry has actionable diagnostics. NOT a
    // Discord call, so no 400 from upstream.
    log(`[COREY-MARKET-INTEL] send_result=blocked`);
    log(`[COREY-MARKET-INTEL] skipped_reason=validator_${validation.failureReason}`);
    return { sent: false, reason: `validator_${validation.failureReason}`, payload: validated, diagnostics: validation.diagnostics };
  }
  // ── FOH_IMAGE_RENDER_ENABLED — opt-in image path ──
  // When the env flag is set AND the builder attached an
  // imagePayload field AND `foh/dispatch/sendMarketIntelFoh.js`
  // loads cleanly, render the premium PNG+PDF cards AND build the
  // expanded fixed-contract Discord message body (operator brief
  // 2026-05-17: Discord-native text must be useful BEFORE opening
  // attachments). Failure falls through to the existing text send.
  if (process.env.FOH_IMAGE_RENDER_ENABLED === 'true' && payloadObj && (payloadObj.fohPacket || payloadObj.imagePayload)) {
    try {
      const { sendMarketIntelFoh } = require('./foh/dispatch/sendMarketIntelFoh');
      // Engine input for the fixed-contract pipeline. The legacy
      // imagePayload (kind / mood / eventClusters / headline / ...)
      // is shape-compatible with the new buildMarketIntelPacket
      // engine input. legacyPacket is the same object — used by the
      // prototype-shell renderer for surgical adapter substitution.
      const engineInput = payloadObj.imagePayload || payloadObj.fohPacket;
      const legacyPacket = payloadObj.fohPacket || payloadObj.imagePayload;
      if (engineInput && payloadObj.janeSynthesis) engineInput.janeSynthesis = payloadObj.janeSynthesis;
      const fixedRes = await sendMarketIntelFoh({
        engine: engineInput,
        legacyPacket,
        coreyClone: payloadObj.coreyClone || null,
        spidey: payloadObj.spidey || null,
        webhookUrl: _webhookUrl,
        opts: {},
      });
      if (fixedRes && fixedRes.ok) {
        log(`[COREY-MARKET-INTEL] send_result=ok image_render=true mode=fixed_contract status=${fixedRes.status} attachments=${(fixedRes.attachments || []).length} pdf_skipped=${fixedRes.pdfSkipped ? 'true' : 'false'} report_id=${fixedRes.reportId || 'n/a'}`);
        return { sent: true, status: fixedRes.status, mode: 'image_fixed_contract', payload: validated, attachments: fixedRes.attachments, pdfSkipped: fixedRes.pdfSkipped, reportId: fixedRes.reportId, diagnostics: validation.diagnostics };
      }
      log(`[COREY-MARKET-INTEL] image_render=fail reason=${fixedRes && (fixedRes.reason || (fixedRes.failures && fixedRes.failures[0]))} fallback=expanded_text_only`);
      // EXPANDED-TEXT FALLBACK — operator brief: Discord-native
      // text must carry the FOH intelligence even when image render
      // fails. The new dispatcher exposes `discordText` on the
      // failure result so we can ship the expanded body without
      // attachments rather than collapse back to the legacy
      // 1714-char wrapper.
      if (fixedRes && fixedRes.discordText && fixedRes.discordText.length > 0) {
        try {
          const textRes = await sendWebhook(_webhookUrl, { content: fixedRes.discordText });
          if (textRes && textRes.status >= 200 && textRes.status < 300) {
            log(`[COREY-MARKET-INTEL] send_result=ok image_render=false mode=fixed_contract_text_only status=${textRes.status} content_len=${fixedRes.discordText.length}`);
            return { sent: true, status: textRes.status, mode: 'fixed_contract_text_only', payload: validated, content_len: fixedRes.discordText.length, diagnostics: validation.diagnostics };
          }
          log(`[COREY-MARKET-INTEL] expanded_text_fallback=fail status=${textRes && textRes.status}`);
        } catch (e2) {
          log(`[COREY-MARKET-INTEL] expanded_text_fallback=exception ${e2.message}`);
        }
      }
    } catch (e) {
      log(`[COREY-MARKET-INTEL] image_render=fail reason=exception:${e.message} fallback=text`);
    }
    // Fall through to existing text send.
  }

  try {
    const res = await sendWebhook(_webhookUrl, { content: validated.content });
    if (res && res.status >= 200 && res.status < 300) {
      log(`[COREY-MARKET-INTEL] send_result=ok`);
      return { sent: true, status: res.status, payload: validated, diagnostics: validation.diagnostics };
    }
    log(`[COREY-MARKET-INTEL] send_result=fail`);
    log(`[COREY-MARKET-INTEL] skipped_reason=webhook_status_${res ? res.status : 'unknown'}`);
    return { sent: false, reason: `webhook_status_${res ? res.status : 'unknown'}`, payload: validated, diagnostics: validation.diagnostics };
  } catch (e) {
    logErr(`[COREY-MARKET-INTEL] send_result=fail`);
    logErr(`[COREY-MARKET-INTEL] skipped_reason=webhook_error:${e.message}`);
    return { sent: false, reason: `webhook_error:${e.message}`, payload: validated, diagnostics: validation.diagnostics };
  }
}

// ============================================================
// SCHEDULER
// ============================================================
function utcDayKey(t) {
  const d = new Date(t);
  d.setUTCHours(0,0,0,0);
  return d.toISOString().slice(0, 10);
}

// ── Corey Clone integration (operator brief 2026-05-17 post-deploy).
// MI scheduler runs the historical-analogue authority for the featured
// event's primary affected symbol so the FOH packet's historicalReaction
// field carries audit-grade analogues. Engine validator surfaces
// OK / PARTIAL / BLOCKED honestly in the Discord output.
let _coreyCloneRunFn = null;
let _validateCoreyCloneFn = null;
function _coreyCloneLazy() {
  if (_coreyCloneRunFn !== null) return _coreyCloneRunFn;
  try { _coreyCloneRunFn = require('./corey_clone').coreyCloneRun || null; }
  catch (_e) { _coreyCloneRunFn = false; }
  return _coreyCloneRunFn;
}
function _validateCoreyCloneLazy() {
  if (_validateCoreyCloneFn !== null) return _validateCoreyCloneFn;
  try { _validateCoreyCloneFn = require('./engine/validate/validateEngineIntelligence').validateCoreyClone || null; }
  catch (_e) { _validateCoreyCloneFn = false; }
  return _validateCoreyCloneFn;
}

// Map an event's currency to a lead symbol the cohort matcher knows.
function _leadSymbolForCcy(ccy) {
  switch (String(ccy || '').toUpperCase()) {
    case 'USD': return 'EURUSD';
    case 'EUR': return 'EURUSD';
    case 'GBP': return 'GBPUSD';
    case 'JPY': return 'USDJPY';
    case 'AUD': return 'AUDUSD';
    case 'CAD': return 'USDCAD';
    case 'CHF': return 'USDCHF';
    case 'NZD': return 'NZDUSD';
    default:    return 'EURUSD';
  }
}

// Per-tick Spidey fetch. Reads daily candles from the historical
// cache for the featured event's lead symbol and runs the Phase D
// structure engine. Returns { packet, leadSymbol } or null on
// failure. NEVER throws.
let _spideyRunFn = null;
let _historyReaderFn = null;
function _spideyLazy() {
  if (_spideyRunFn !== null) return _spideyRunFn;
  try { _spideyRunFn = require('./spidey').spideyRun || null; }
  catch (_e) { _spideyRunFn = false; }
  return _spideyRunFn;
}
function _historyReaderLazy() {
  if (_historyReaderFn !== null) return _historyReaderFn;
  try { _historyReaderFn = require('./corey_history_reader').readCandles || null; }
  catch (_e) { _historyReaderFn = false; }
  return _historyReaderFn;
}

async function _fetchSpidey(featuredEvent) {
  const spideyFn = _spideyLazy();
  if (!spideyFn) { log('[SPIDEY] tick=skipped reason=engine_unavailable'); return null; }
  const leadSymbol = _leadSymbolForCcy(featuredEvent && featuredEvent.currency);
  const readerFn = _historyReaderLazy();
  let candles = null;
  if (readerFn) {
    try {
      const read = readerFn(leadSymbol);
      if (read && read.ok && Array.isArray(read.rows)) {
        candles = { htf: { '1D': read.rows.map(r => ({ time: r.open_time_ms, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })) }, ltf: {} };
      }
    } catch (_e) { /* swallow */ }
  }
  try {
    const packet = await spideyFn(leadSymbol, { candles });
    log(`[SPIDEY] tick=ok symbol=${leadSymbol} status=${packet.status} structureConfidence=${packet.structureConfidence} bias=${packet.structureBias}${packet.degradedReason ? ` degraded=${packet.degradedReason}` : ''}`);
    return { packet, leadSymbol };
  } catch (e) {
    log(`[SPIDEY] tick=fail symbol=${leadSymbol} error=${e.message}`);
    return null;
  }
}

// Per-tick Corey Clone fetch. Returns { packet, validation, leadSymbol }
// or null when the engine is unavailable. NEVER throws — safe-fail so
// MI dispatch is not blocked by Corey Clone failure.
function _summariseCoreyCloneDecision(packet, validation, macroPacket) {
  const analogues = packet && Array.isArray(packet.analogues) ? packet.analogues : [];
  const denominator = packet && (packet.denominator_pre_filter != null ? packet.denominator_pre_filter
    : packet.accepted_analogue_count != null ? packet.accepted_analogue_count
    : analogues.length);
  const sampleSize = validation && validation.validAnalogues != null ? validation.validAnalogues : analogues.length;
  const statusRaw = validation && validation.status ? validation.status : (packet && packet.status) || 'PARTIAL';
  const status = statusRaw === 'OK' ? 'OK' : statusRaw === 'ACTIVE' ? 'OK' : statusRaw === 'BLOCKED' ? 'BLOCKED' : 'PARTIAL';
  const usableForDecision = status === 'OK' && sampleSize >= 3 && !((validation && validation.degradedReason) || (packet && packet.reason));
  const windows = analogues.map(a => a.window_start_utc || a.windowStartUTC || a.date || a.timestamp).filter(Boolean).sort();
  const outcomeCounts = {};
  for (const a of analogues) {
    const o = a.outcome || a.outcome_label || a.outcomeLabel || 'unknown';
    outcomeCounts[o] = (outcomeCounts[o] || 0) + 1;
  }
  const dominantOutcome = Object.keys(outcomeCounts).sort((a, b) => outcomeCounts[b] - outcomeCounts[a])[0] || null;
  return {
    status,
    usableForDecision,
    sampleSize,
    denominator,
    timestampWindows: windows.length ? { startUTC: windows[0], endUTC: windows[windows.length - 1] } : null,
    sourceBasis: 'Corey Clone historical cache for ' + ((packet && packet.symbol) || 'lead symbol') + (macroPacket && macroPacket.primaryEventFocus ? ' conditioned on macro focus: ' + macroPacket.primaryEventFocus.title : ''),
    confidenceBasis: usableForDecision
      ? 'Decision-grade: validation OK with sample size ' + sampleSize + ' / denominator ' + denominator
      : 'Not decision-grade: ' + ((validation && validation.degradedReason) || (packet && packet.reason) || ('sample size ' + sampleSize + ' below decision threshold')),
    dominantOutcome: usableForDecision ? dominantOutcome : null,
    degradedReason: usableForDecision ? null : ((validation && validation.degradedReason) || (packet && packet.reason) || 'insufficient decision-grade analogues'),
  };
}

async function _fetchCoreyClone(featuredEvent, macroIntelligencePacket) {
  const fn = _coreyCloneLazy();
  if (!fn) {
    log(`[COREY-CLONE] tick=skipped reason=engine_unavailable`);
    return null;
  }
  const leadSymbol = _leadSymbolForCcy(featuredEvent && featuredEvent.currency);
  try {
    const packet = await fn(leadSymbol, { macroIntelligencePacket });
    const validateFn = _validateCoreyCloneLazy();
    const validation = (validateFn && typeof validateFn === 'function')
      ? validateFn(packet)
      : { status: 'OK', validAnalogues: (packet && Array.isArray(packet.analogues)) ? packet.analogues.length : 0 };
    const decisionGrade = _summariseCoreyCloneDecision(packet, validation, macroIntelligencePacket);
    const enrichedValidation = Object.assign({}, validation, decisionGrade);
    log(`[COREY-CLONE] tick=ok symbol=${leadSymbol} status=${validation.status} analogues=${validation.validAnalogues != null ? validation.validAnalogues : 'n/a'}${validation.degradedReason ? ` degraded=${validation.degradedReason}` : ''}`);
    log(`[COREY-CLONE] status=${decisionGrade.status} usableForDecision=${decisionGrade.usableForDecision}`);
    return { packet, validation: enrichedValidation, decisionGrade, leadSymbol };
  } catch (e) {
    log(`[COREY-CLONE] tick=fail symbol=${leadSymbol} error=${e.message}`);
    return null;
  }
}

async function tick(NOW) {
  NOW = NOW || Date.now();

  // 0. Always log status
  let snapshot = null;
  try { snapshot = _calendarModule && _calendarModule.getCalendarSnapshot && _calendarModule.getCalendarSnapshot(); }
  catch (_e) { snapshot = null; }
  let liveCtx = null;
  try { liveCtx = _coreyLiveModule && _coreyLiveModule.getLiveContext && _coreyLiveModule.getLiveContext(); }
  catch (_e) { liveCtx = null; }

  const health = (snapshot && snapshot.health) || { available: false, calendar_mode: 'UNAVAILABLE', source_used: null };
  const events = (snapshot && snapshot.events) || [];

  log(`[COREY-MARKET-INTEL] status=${health.available ? 'ok' : 'unavailable'}`);
  log(`[COREY-MARKET-INTEL] calendar_mode=${health.calendar_mode || 'UNAVAILABLE'}`);
  log(`[COREY-MARKET-INTEL] source_used=${health.source_used || 'unavailable'}`);

  const geoCtx = inferGeopoliticalContext(liveCtx);
  const macroIntelligencePacket = _buildMacroIntelligencePacket(snapshot, liveCtx, NOW);

  // 1. DAILY BULLETIN — once per UTC day, at or after DAILY_BULLETIN_UTC_HOUR
  const todayKey = utcDayKey(NOW);
  const utcHour  = new Date(NOW).getUTCHours();
  if (_lastDailyBulletinUtcDay !== todayKey && utcHour >= DAILY_BULLETIN_UTC_HOUR) {
    const bulletin = buildDailyBulletinPayload(snapshot, geoCtx, NOW, { macroIntelligencePacket });
    const featuredForClone = (bulletin.nextMajorEvent || (macroIntelligencePacket && macroIntelligencePacket.primaryEventFocus) || (events.find(e => deriveRelevance(e) === RELEVANCE.HIGH) || null));
    const cloneRes = await _fetchCoreyClone(featuredForClone, macroIntelligencePacket);
    const spideyRes = await _fetchSpidey(featuredForClone);
    const janeSynthesis = _buildJaneSynthesis(macroIntelligencePacket, cloneRes, spideyRes);
    const roadmapMessages = Array.isArray(bulletin.dailyRoadmapMessages) && bulletin.dailyRoadmapMessages.length === 3
      ? bulletin.dailyRoadmapMessages
      : buildDailyRoadmapMessages(snapshot, geoCtx, NOW, { macroIntelligencePacket, affectedSymbols: bulletin.affectedSymbols });
    log(`[COREY-MARKET-INTEL] daily_roadmap_renderer=used model=3_message prototype=false messages=${roadmapMessages.length} high_impact_today=${bulletin.counts.highImpactTodayCount} next_24h_count=${bulletin.counts.next24hCount} next72_count=${bulletin.counts.next72hCount} ranked_event_count=${bulletin.counts.rankedEventCount} source=${roadmapMessages[0] && roadmapMessages[0].sourceLine || 'unknown'}`);
    for (const msg of roadmapMessages) {
      await dispatch('daily_brief', { content: msg.content, coreyClone: cloneRes, spidey: spideyRes, macroIntelligencePacket, janeSynthesis }, {
        event: 'daily_bulletin',
        affected_symbols: msg.affectedSymbols && msg.affectedSymbols.length ? msg.affectedSymbols : bulletin.affectedSymbols,
        high_impact_today: bulletin.counts.highImpactTodayCount,
        next_major_event: macroIntelligencePacket && macroIntelligencePacket.primaryEventFocus ? macroIntelligencePacket.primaryEventFocus.title : (bulletin.nextMajorEvent ? bulletin.nextMajorEvent.title : 'none'),
        next_24h_count: bulletin.counts.next24hCount,
        next72_count: bulletin.counts.next72hCount,
        ranked_event_count: msg.rankedEventCount,
        daily_roadmap_renderer: 'used',
        daily_brief_message: msg.index + '/' + msg.total,
        expected_bias: 'mixed_conditional',
        confidence: CONFIDENCE.MODERATE,
      });
    }
    _lastDailyBulletinUtcDay = todayKey;
  }

  // 2. PRE-EVENT ALERTS — for each high-relevance upcoming event in the
  //    next 5 hours, fire any due stage that hasn't already fired.
  const fiveHours = 5 * 60 * 60 * 1000;
  const upcoming = events.filter(e =>
    deriveRelevance(e) === RELEVANCE.HIGH &&
    e.scheduled_time > NOW &&
    e.scheduled_time <= NOW + fiveHours);

  for (const e of upcoming) {
    const minsOut = Math.round((e.scheduled_time - NOW) / 60000);
    for (const win of PRE_EVENT_WINDOWS_MIN) {
      // Fire when within +/- half a tick of the window
      const half = Math.ceil(SCHEDULER_TICK_MS / 60000 / 2);
      if (Math.abs(minsOut - win) <= half) {
        const key = `${e.id || e.title || ''}:${e.scheduled_time}:T-${win}`;
        if (_alertsSent.has(key)) continue;
        const payload = buildPreEventAlertPayload(e, win, { health, geoLevel: geoCtx.level, macroIntelligencePacket });
        const a = analyseEvent(e);
        const cloneRes = await _fetchCoreyClone(e, macroIntelligencePacket);
        const spideyRes = await _fetchSpidey(e);
        const janeSynthesis = _buildJaneSynthesis(macroIntelligencePacket, cloneRes, spideyRes);
        await dispatch('pre_event', { content: payload.content, imagePayload: payload.imagePayload, fohPacket: payload.fohPacket, coreyClone: cloneRes, spidey: spideyRes, macroIntelligencePacket, janeSynthesis }, {
          event: e.title || 'pre_event',
          affected_symbols: a.affected,
          expected_bias: a.bias.label.split(':')[0],
          confidence: a.confidence.level,
        });
        _alertsSent.set(key, NOW);
      }
    }
  }

  // 3. RELEASED EVENT ALERTS — for events whose scheduled_time has just
  //    passed (within last 30 min), fire once with whatever values exist.
  const thirty = 30 * 60 * 1000;
  const justReleased = events.filter(e =>
    deriveRelevance(e) === RELEVANCE.HIGH &&
    e.scheduled_time <= NOW - RELEASE_GRACE_MIN * 60 * 1000 &&
    e.scheduled_time > NOW - thirty);

  for (const e of justReleased) {
    const key = `${e.id || e.title || ''}:${e.scheduled_time}`;
    if (_releaseAlertsSent.has(key)) continue;
    const payload = buildReleasedEventAlertPayload(e, { health, geoLevel: geoCtx.level, macroIntelligencePacket });
    const a = analyseEvent(e);
    const cloneRes = await _fetchCoreyClone(e, macroIntelligencePacket);
    const spideyRes = await _fetchSpidey(e);
    const janeSynthesis = _buildJaneSynthesis(macroIntelligencePacket, cloneRes, spideyRes);
    await dispatch('release', { content: payload.content, imagePayload: payload.imagePayload, fohPacket: payload.fohPacket, coreyClone: cloneRes, spidey: spideyRes, macroIntelligencePacket, janeSynthesis }, {
      event: e.title || 'release',
      affected_symbols: a.affected,
      expected_bias: a.bias.label.split(':')[0],
      confidence: a.confidence.level,
    });
    _releaseAlertsSent.add(key);
  }

  // 4. If nothing else fired this tick AND status is unavailable, log skip.
  // (Intentionally do NOT spam quiet ticks; only emit a status heartbeat.)
}

// ============================================================
// PUBLIC API
// ============================================================
function init(opts) {
  opts = opts || {};
  if (_initialised) return;
  _initialised = true;

  // Webhook resolution — preferred env: MARKET_INTEL_WEBHOOK
  _webhookUrl = opts.webhookUrl || process.env.MARKET_INTEL_WEBHOOK || null;
  _webhookEnvKey = process.env.MARKET_INTEL_WEBHOOK ? 'MARKET_INTEL_WEBHOOK'
                  : opts.webhookUrl ? 'opts.webhookUrl'
                  : 'missing';

  // Calendar module — defensive optional require
  if (opts.calendarModule) {
    _calendarModule = opts.calendarModule;
  } else {
    try { _calendarModule = require('./corey_calendar'); }
    catch (e) { logErr(`[COREY-MARKET-INTEL] calendar_require_failed reason=${e.message}`); _calendarModule = null; }
  }

  // Corey live module — defensive optional require
  if (opts.coreyLiveModule) {
    _coreyLiveModule = opts.coreyLiveModule;
  } else {
    try { _coreyLiveModule = require('./corey_live_data'); }
    catch (e) { logErr(`[COREY-MARKET-INTEL] corey_live_require_failed reason=${e.message}`); _coreyLiveModule = null; }
  }

  log(`[COREY-MARKET-INTEL] init webhook_config=${_webhookUrl ? 'present' : 'missing'} env_key=${_webhookEnvKey} ` +
      `calendar=${_calendarModule ? 'wired' : 'unavailable'} corey_live=${_coreyLiveModule ? 'wired' : 'unavailable'}`);
}

function start() {
  if (!_initialised) init();
  if (_tickHandle) return;
  log(`[COREY-MARKET-INTEL] scheduler_start tick_ms=${SCHEDULER_TICK_MS}`);
  // First tick a bit after boot to let calendar finish initial refresh
  setTimeout(() => { tick().catch(e => logErr(`[COREY-MARKET-INTEL] tick_error ${e.message}`)); }, 30 * 1000);
  _tickHandle = setInterval(() => {
    tick().catch(e => logErr(`[COREY-MARKET-INTEL] tick_error ${e.message}`));
  }, SCHEDULER_TICK_MS);
}

function stop() {
  if (_tickHandle) { clearInterval(_tickHandle); _tickHandle = null; }
}

// Test hooks (not meant for production callers)
function _resetForTests() {
  _alertsSent.clear();
  _releaseAlertsSent.clear();
  _lastDailyBulletinUtcDay = null;
  _calendarModule = null;
  _coreyLiveModule = null;
  _webhookUrl = null;
  _webhookEnvKey = 'missing';
  _initialised = false;
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  // enums
  RELEVANCE, BIAS_KIND, CONFIDENCE, ATLAS_STATE, EVENT_RISK, GEO_RISK,
  CCY_TO_SYMBOLS, HIGH_RELEVANCE_PATTERNS,
  TRADER_NOTE_DEFAULT, BIAS_CONDITIONAL_DISCLAIMER,
  SCHEDULER_TICK_MS, PRE_EVENT_WINDOWS_MIN, DAILY_BULLETIN_UTC_HOUR,

  // analysis
  analyseEvent,
  deriveRelevance, isHighInterest, affectedSymbols,
  mechanismTemplate, buildCoreyView,
  deriveBias, deriveConfidence, deriveAtlasState,
  classifyEventRisk, inferGeopoliticalContext,

  // payload builders
  formatIntelPayload,
  buildDailyBulletinPayload,
  buildDailyRoadmapMessages,
  buildPreEventAlertPayload,
  buildReleasedEventAlertPayload,
  buildGeopoliticalStatusPayload,

  // sanitiser + delivery
  sanitize,
  validateMarketIntelPayload,
  sendWebhook,
  dispatch,
  MARKET_INTEL_DISCORD_HARD_LIMIT,
  MARKET_INTEL_SAFE_CAP,
  MARKET_INTEL_MIN_LEN,

  // scheduler + context
  init, start, stop, tick,
  getCoreyMarketIntelContext,

  // test helpers
  _resetForTests,
};
