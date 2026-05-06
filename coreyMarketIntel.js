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
    return 'Geopolitical shock triggers safe-haven rotation: DXY / CHF / JPY / XAU typically bid; equities and credit typically offered.';
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
    return `This is a geopolitical shock. Safe-haven rotation is the dominant mechanism: DXY / CHF / JPY / XAU typically bid, equities and credit typically offered.`;
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

function fmtVal(v) { return v == null || v === '' ? 'unavailable' : String(v); }

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

function buildPreEventAlertPayload(rawEvent, minutesOut) {
  const a = analyseEvent(rawEvent);
  if (!a) return { content: '' };
  const stage = preEventStageLabel(minutesOut);
  const affected = (a.affected || []).length ? a.affected.join(', ') : 'unavailable';
  const sched = fmtUtcWithAwst(a.scheduled_time);
  const cautionByStage = {
    'T-4H':  'Setup window — confirm bias before any pre-positioning.',
    'T-1H':  'Approach window — execution becomes time-sensitive. Avoid late entries.',
    'T-30M': 'Final lead-in — liquidity thins; spreads widen; do not chase.',
    'T-15M': 'Imminent — stand down unless a confirmed pre-event setup is already live.',
    'T-RELEASE': 'Release window — first move is rarely the move. Wait for liquidity sweep + reclaim.',
  };
  const possibleMechanism =
    `${a.coreyView}\n\nMechanism: ${a.mechanism}`;

  const content =
    `**ATLAS MARKET INTEL — HIGH-IMPACT PRE-EVENT ALERT (${stage})**\n\n` +
    `**Event:** ${a.title}\n` +
    `**Country / Currency:** ${rawEvent.country || 'unavailable'} / ${a.currency || 'unavailable'}\n` +
    `**Scheduled:** ${sched}\n` +
    `**Impact level:** ${(rawEvent.impact || 'unavailable').toString().toUpperCase()}\n` +
    `**Affected symbols:** ${affected}\n` +
    `**Expected volatility risk:** elevated until first close after release\n\n` +
    `**Possible mechanisms (conditional):**\n${possibleMechanism}\n\n` +
    `**Conditional bias:** ${a.bias.label}\n` +
    `_${BIAS_CONDITIONAL_DISCLAIMER}_\n\n` +
    `**Caution:** ${cautionByStage[stage] || cautionByStage['T-1H']}`;

  return { content, stage };
}

// ============================================================
// RELEASED EVENT ALERT
// ============================================================
function buildReleasedEventAlertPayload(rawEvent) {
  const a = analyseEvent(rawEvent);
  if (!a) return { content: '' };
  const affected = (a.affected || []).length ? a.affected.join(', ') : 'unavailable';
  const content =
    `**ATLAS MARKET INTEL — RELEASED EVENT**\n\n` +
    `**Event:** ${a.title}\n` +
    `**Released at:** ${fmtUtcWithAwst(a.scheduled_time)}\n` +
    `**Values:** actual=${fmtVal(a.actual)} · forecast=${fmtVal(a.forecast)} · previous=${fmtVal(a.previous)}\n` +
    `**Likely affected symbols:** ${affected}\n\n` +
    `**Corey view:** ${a.coreyView}\n\n` +
    `**Conditional bias:** ${a.bias.label}\n` +
    `_${BIAS_CONDITIONAL_DISCLAIMER}_\n\n` +
    `**First-reaction caution:** Immediate volatility is high. Do not chase the first spike. ` +
    `Wait for liquidity sweep, rejection, and a candle-close confirmation on 5m/15m before treating the move as continuation.`;
  return { content };
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

function buildDailyBulletinPayload(snapshot, geoCtx, now) {
  const NOW = now || Date.now();
  const events = (snapshot && snapshot.events) || [];
  const health = (snapshot && snapshot.health) || { available: false };
  const dayStart = new Date(NOW); dayStart.setUTCHours(0,0,0,0);
  const dayEnd   = new Date(NOW); dayEnd.setUTCHours(23,59,59,999);
  const next24End = NOW + 24 * 60 * 60 * 1000;

  const today = events.filter(e => e.scheduled_time >= dayStart.getTime() && e.scheduled_time <= dayEnd.getTime());
  const next24 = events.filter(e => e.scheduled_time > NOW && e.scheduled_time <= next24End);

  const highToday = today.filter(e => deriveRelevance(e) === RELEVANCE.HIGH);
  const highInterestToday = today.filter(e => isHighInterest(e) && deriveRelevance(e) !== RELEVANCE.HIGH);

  const calendarMode   = health.calendar_mode || 'UNAVAILABLE';
  const calendarSource = health.source_used || 'unavailable';
  const eventRisk      = classifyEventRisk(highToday.length, (geoCtx && geoCtx.level) || GEO_RISK.LOW);
  const next = nextMajor(today, next24.filter(e => !today.includes(e)), NOW);

  // Affected symbols across today's high-impact set
  const affected = new Set();
  for (const e of highToday) affectedSymbols(e).forEach(s => affected.add(s));
  const affectedList = [...affected].slice(0, 16);

  // Top high-impact list (max 6 to keep message concise)
  const highBlock = highToday.length
    ? highToday.slice(0, 6).map(e => `• **${e.title}** — ${e.currency || '??'} · ${fmtUtcWithAwst(e.scheduled_time)} · impact ${e.impact || 'high'}`).join('\n')
    : '_None scheduled today._';

  const highInterestBlock = highInterestToday.length
    ? highInterestToday.slice(0, 4).map(e => `• ${e.title} — ${e.currency || '??'} · ${fmtUtcWithAwst(e.scheduled_time)}`).join('\n')
    : '_None scheduled today._';

  const nextLine = next
    ? `${next.title} — ${next.currency || '??'} · ${fmtUtcWithAwst(next.scheduled_time)}`
    : 'No high-impact event scheduled in the next 48 hours.';

  const traderNote =
    'Pre-position only with confirmed structure. Sit out the release window. ' +
    'Re-enter only after liquidity sweep + candle-close confirmation on 5m/15m.';

  const utcDay = dayStart.toISOString().slice(0, 10);
  const content =
    `**ATLAS MARKET INTEL — DAILY EVENT BULLETIN**\n\n` +
    `**Date / Timezone:** ${utcDay} (UTC) — AWST is UTC+8\n` +
    `**Calendar mode:** ${calendarMode}\n` +
    `**Calendar source:** ${calendarSource}\n` +
    `**High-impact events today:** ${highToday.length}\n${highBlock}\n\n` +
    `**High-interest events today:** ${highInterestToday.length}\n${highInterestBlock}\n\n` +
    `**Next major event:** ${nextLine}\n` +
    `**Next 24h event count:** ${next24.length}\n\n` +
    `**Affected currencies / assets / symbols:**\n${affectedList.length ? affectedList.join(', ') : 'unavailable'}\n\n` +
    `**Event risk:** ${eventRisk}\n` +
    `**Geopolitical risk:** ${(geoCtx && geoCtx.level) || GEO_RISK.LOW} — ${(geoCtx && geoCtx.summary) || 'inferred from market drivers'}\n\n` +
    `**Corey view / why it matters:**\n${highToday.length
      ? 'Today carries scheduled risk events that can reprice rate paths and risk appetite. Trade smaller into release windows; reassess after first structure confirmation.'
      : 'No scheduled high-impact prints today. Macro tape is driver-led; watch the live VIX / DXY / yields read for regime change.'}\n\n` +
    `**Trader note:** ${traderNote}\n` +
    `_${BIAS_CONDITIONAL_DISCLAIMER}_`;

  return {
    content,
    counts: {
      highImpactTodayCount: highToday.length,
      highInterestTodayCount: highInterestToday.length,
      next24hCount: next24.length,
    },
    nextMajorEvent: next,
    eventRisk,
    affectedSymbols: affectedList,
    calendarMode, calendarSource,
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
    reasons.push(`VIX ${vixLevel}`);
  }
  if (/^(High|Extreme)$/i.test(vixLevel) && /Inverted|Stress/i.test(yieldRegime)) {
    level = GEO_RISK.HIGH;
    reasons.push(`yield regime ${yieldRegime}`);
  }
  if (/Bullish/i.test(dxyBias) && /^(High|Elevated|Extreme)$/i.test(vixLevel)) {
    if (level !== GEO_RISK.HIGH) level = GEO_RISK.MODERATE;
    reasons.push('safe-haven DXY bid alongside elevated VIX');
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
    `• VIX level: ${drivers.vixLevel || 'unavailable'}\n` +
    `• DXY bias: ${drivers.dxyBias || 'unavailable'}\n` +
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

  const affectedSet = new Set();
  highImpactToday.forEach(e => affectedSymbols(e).forEach(s => affectedSet.add(s)));

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
    nextMajorEvent:          nextMajorEvent ? nextMajorEvent.title : null,
    nextMajorEventTime:      nextMajorEvent ? nextMajorEvent.scheduled_time : null,
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
  return result;
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
  const sanitized = sanitize(payloadObj);
  const eventLabel = extra.event || messageType;
  const affectedLabel = (extra.affected_symbols && extra.affected_symbols.length)
    ? extra.affected_symbols.join('|') : 'n/a';

  log(`[COREY-MARKET-INTEL] message_type=${messageType}`);
  log(`[COREY-MARKET-INTEL] event=${eventLabel}`);
  if (extra.high_impact_today != null) log(`[COREY-MARKET-INTEL] high_impact_today=${extra.high_impact_today}`);
  if (extra.next_major_event)          log(`[COREY-MARKET-INTEL] next_major_event=${extra.next_major_event}`);
  if (extra.next_24h_count != null)    log(`[COREY-MARKET-INTEL] next_24h_count=${extra.next_24h_count}`);
  log(`[COREY-MARKET-INTEL] affected_symbols=${affectedLabel}`);
  if (extra.expected_bias)             log(`[COREY-MARKET-INTEL] expected_bias=${extra.expected_bias}`);
  if (extra.confidence)                log(`[COREY-MARKET-INTEL] confidence=${extra.confidence}`);
  log(`[COREY-MARKET-INTEL] webhook_config=${webhookConfig}`);

  if (webhookConfig === 'missing') {
    log(`[COREY-MARKET-INTEL] send_result=skipped`);
    log(`[COREY-MARKET-INTEL] skipped_reason=webhook_missing`);
    return { sent: false, reason: 'webhook_missing', payload: sanitized };
  }
  try {
    const res = await sendWebhook(_webhookUrl, { content: sanitized.content });
    if (res && res.status >= 200 && res.status < 300) {
      log(`[COREY-MARKET-INTEL] send_result=ok`);
      return { sent: true, status: res.status, payload: sanitized };
    }
    log(`[COREY-MARKET-INTEL] send_result=fail`);
    log(`[COREY-MARKET-INTEL] skipped_reason=webhook_status_${res ? res.status : 'unknown'}`);
    return { sent: false, reason: `webhook_status_${res ? res.status : 'unknown'}`, payload: sanitized };
  } catch (e) {
    logErr(`[COREY-MARKET-INTEL] send_result=fail`);
    logErr(`[COREY-MARKET-INTEL] skipped_reason=webhook_error:${e.message}`);
    return { sent: false, reason: `webhook_error:${e.message}`, payload: sanitized };
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

  // 1. DAILY BULLETIN — once per UTC day, at or after DAILY_BULLETIN_UTC_HOUR
  const todayKey = utcDayKey(NOW);
  const utcHour  = new Date(NOW).getUTCHours();
  if (_lastDailyBulletinUtcDay !== todayKey && utcHour >= DAILY_BULLETIN_UTC_HOUR) {
    const bulletin = buildDailyBulletinPayload(snapshot, geoCtx, NOW);
    await dispatch('daily', { content: bulletin.content }, {
      event: 'daily_bulletin',
      affected_symbols: bulletin.affectedSymbols,
      high_impact_today: bulletin.counts.highImpactTodayCount,
      next_major_event: bulletin.nextMajorEvent ? bulletin.nextMajorEvent.title : 'none',
      next_24h_count: bulletin.counts.next24hCount,
      expected_bias: 'mixed_conditional',
      confidence: CONFIDENCE.MODERATE,
    });
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
        const payload = buildPreEventAlertPayload(e, win);
        const a = analyseEvent(e);
        await dispatch('pre_event', { content: payload.content }, {
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
    const payload = buildReleasedEventAlertPayload(e);
    const a = analyseEvent(e);
    await dispatch('release', { content: payload.content }, {
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
  buildPreEventAlertPayload,
  buildReleasedEventAlertPayload,
  buildGeopoliticalStatusPayload,

  // sanitiser + delivery
  sanitize,
  sendWebhook,
  dispatch,

  // scheduler + context
  init, start, stop, tick,
  getCoreyMarketIntelContext,

  // test helpers
  _resetForTests,
};
