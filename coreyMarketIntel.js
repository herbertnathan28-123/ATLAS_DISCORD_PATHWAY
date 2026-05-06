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

// ── DRIVER + RISK-TONE INFERENCE ─────────────────────────────
const DRIVER_PATTERNS = [
  { test: /\b(cpi|pce|inflation)\b/i,                                  label: 'inflation print',          short: 'inflation' },
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
    return 'No scheduled high-impact catalyst today. The tape is driver-led — direction will be set by the live VIX, DXY, and yields read rather than the calendar.';
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
    return `cause: ${ccy} inflation surprise vs forecast → expectation: rate-path repricing in the front end → market reaction: ${ccy} and yields move first → asset impact: DXY direction sets gold and US-index reaction`;
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
    return `cause: geopolitical shock event → expectation: safe-haven rotation → market reaction: DXY/CHF/JPY/XAU bid → asset impact: equities and credit offered, vol indices lift`;
  }
  return `cause: surprise vs forecast → expectation: short-term rate-path repricing → market reaction: ${ccy} moves first → asset impact: correlated risk follows on first HTF close`;
}

// ── PER-CURRENCY/ASSET NARRATIVES ────────────────────────────
const NARRATIVE_TEMPLATES = {
  USD: (drivers) => ({
    label: 'USD / DXY',
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
    body: 'Yen reacts to safe-haven flow and BOJ policy gap vs G10. Watching USDJPY vs DXY for confirmation of risk tone.',
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
      'Reassessment: read live VIX / DXY / yields; size only with confirmed structure.',
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
    return 'safe-haven rotation depth — DXY / CHF / JPY / XAU bid alongside equity offer';
  return 'the first higher-timeframe close after the print and whether structure forms either side';
}

// ============================================================
// PRE-EVENT ALERT — trader-grade rebuild
// ============================================================
// ── EVENT-CURRENCY-AWARE AFFECTED MARKETS ────────────────────
// When the event's home currency is X, the trader-facing post must
// label X-pairs correctly:
//   - "Primary" = the most-watched X pair (e.g. CAD event → USDCAD)
//   - "X crosses" = the cross-pairs that share X (e.g. EURCAD, CADJPY)
//   - "Related macro" = correlated assets (e.g. CAD → USOIL/WTI)
// This avoids the prior bug where a CAD event called USDCAD a "USD pair".
const EVENT_CCY_BUCKETS = {
  USD: {
    primary: 'DXY',
    crosses: ['EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','AUDUSD','NZDUSD'],
    related: ['XAUUSD','NAS100','US500','US30'],
    label:   'USD',
  },
  EUR: {
    primary: 'EURUSD',
    crosses: ['EURGBP','EURJPY','EURAUD','EURCAD','EURCHF'],
    related: ['GER40'],
    label:   'EUR',
  },
  GBP: {
    primary: 'GBPUSD',
    crosses: ['EURGBP','GBPJPY','GBPAUD','GBPCAD','GBPCHF'],
    related: ['UK100'],
    label:   'GBP',
  },
  JPY: {
    primary: 'USDJPY',
    crosses: ['EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY'],
    related: ['JPN225'],
    label:   'JPY',
  },
  AUD: {
    primary: 'AUDUSD',
    crosses: ['EURAUD','GBPAUD','AUDJPY','AUDCAD','AUDNZD'],
    related: ['XAUUSD'],
    label:   'AUD',
  },
  NZD: {
    primary: 'NZDUSD',
    crosses: ['AUDNZD','NZDCAD'],
    related: [],
    label:   'NZD',
  },
  CAD: {
    primary: 'USDCAD',
    crosses: ['EURCAD','GBPCAD','CADJPY','AUDCAD','NZDCAD'],
    related: ['USOIL','WTI'],
    label:   'CAD',
  },
  CHF: {
    primary: 'USDCHF',
    crosses: ['EURCHF','GBPCHF','CHFJPY'],
    related: ['XAUUSD'],
    label:   'CHF',
  },
};
function eventCurrencyBucketing(rawEvent) {
  const ccy = String(rawEvent.currency || '').toUpperCase();
  return EVENT_CCY_BUCKETS[ccy] || null;
}

// ── WHY THIS MATTERS (plain-English event explanation) ───────
function whyThisMatters(rawEvent) {
  const ccy = rawEvent.currency || 'the home currency';
  const t   = String(rawEvent.title || '').toLowerCase();
  if (/\b(cpi|pce|inflation)\b/.test(t)) {
    return `This is the headline inflation print for ${ccy}. ` +
           `Inflation drives the central-bank reaction function — a hotter print pushes rate-cut pricing further out and supports ${ccy}; a softer print pulls cuts forward and pressures ${ccy}. ` +
           `Volatility expands because every tick of surprise reprices the front end of the curve.`;
  }
  if (/\bivey pmi\b/.test(t)) {
    return `Ivey PMI is a Canadian purchasing-managers gauge that captures business activity, inventories, employment, and price pressure across the Canadian economy. ` +
           `${ccy} traders watch it because above-50 readings signal expansion (CAD-supportive); below-50 signal contraction (CAD-pressuring). ` +
           `It is a growth read, but it also feeds rate-path expectations at the BOC and tracks oil-sensitive sentiment via the Canadian energy complex.`;
  }
  if (/\bpmi\b/.test(t)) {
    return `This is a purchasing-managers activity print for ${ccy}. ` +
           `Above-50 means expansion, below-50 means contraction. ` +
           `${ccy} traders watch it because it gauges growth, feeds rate-path expectations, and influences risk-on/off rotation in the home indices.`;
  }
  if (/\bism\b/.test(t)) {
    return `ISM is a US activity gauge. Above-50 means expansion, below-50 means contraction. ` +
           `${ccy} traders watch it because it feeds Fed reaction-function pricing and influences risk indices.`;
  }
  if (/\b(nonfarm|nfp|unemployment|jobs|employment change|adp)\b/.test(t)) {
    return `This is a ${ccy} labour-market print. ` +
           `Strong labour data supports ${ccy} via repricing of the rate path; weak data pressures ${ccy} and supports rate-sensitive assets such as gold and equity indices. ` +
           `Volatility expands because labour data is the cleanest read on the central-bank reaction function.`;
  }
  if (/\bgdp\b/.test(t)) {
    return `This is the headline ${ccy} growth print. ` +
           `Stronger growth supports ${ccy} and risk indices via repricing of terminal-rate expectations; weaker growth pressures both. ` +
           `Volatility expands because growth surprises reset the macro framework.`;
  }
  if (/\b(retail sales)\b/.test(t)) {
    return `This is a ${ccy} consumer-demand print. ` +
           `Stronger demand supports ${ccy} and consumer-cyclical equities; weaker demand pressures both. ` +
           `Volatility expands because the print reprices growth/rate expectations.`;
  }
  if (/\b(fed|fomc|ecb|boe|boj|rba|boc|rbnz|snb|policy decision|press conference|rate decision)\b/.test(t)) {
    return `This is a central-bank communication event for ${ccy}. ` +
           `Tone vs current market pricing is the lever — hawkish lean supports ${ccy}, dovish lean pressures it. ` +
           `Volatility expands sharply on tone surprises, especially in the press-conference segment.`;
  }
  if (/\b(tariff|sanction|geopolit|war|invasion|attack)\b/.test(t)) {
    return `This is a geopolitical-shock event. ` +
           `Safe-haven rotation is the dominant mechanism: DXY / CHF / JPY / XAU bid; equities and credit offered. ` +
           `Volatility expands across the board; correlation patterns change rapidly.`;
  }
  return `This is a ${ccy} data release. ` +
         `Direction of surprise versus forecast typically flows through ${ccy} pairs and correlated risk assets. ` +
         `Volatility expands until first higher-timeframe close confirms structure either side.`;
}

// ── COREY MECHANISM CHAIN (long-form, multi-line for pre-event) ─
function mechanismChainLong(rawEvent) {
  const ccy = rawEvent.currency || 'the home currency';
  const t   = String(rawEvent.title || '').toLowerCase();
  const bk  = eventCurrencyBucketing(rawEvent);
  const primary = bk ? bk.primary : `${ccy} pairs`;
  const crossLabel = bk ? `${bk.label} crosses` : 'cross-pairs';
  const related = bk && bk.related.length ? ` → ${bk.related.slice(0, 2).join('/')} spillover` : '';

  if (/\bivey pmi\b/.test(t) || (/\bpmi\b/.test(t) && ccy === 'CAD')) {
    return `Event surprise → ${ccy} repricing → ${primary} reaction → ${crossLabel} response${related} → structure confirmation required on 5m/15m close`;
  }
  if (/\bpmi\b/.test(t) || /\bism\b/.test(t)) {
    return `Activity surprise → growth/rate-path repricing → ${primary} reaction → ${crossLabel} response${related} → structure confirmation required on 5m/15m close`;
  }
  if (/\b(cpi|pce|inflation)\b/.test(t)) {
    return `Inflation surprise → rate-path repricing in the front end → ${primary} reaction${related ? related : ' → gold reaction'} → ${crossLabel} response → structure confirmation required on 5m/15m close`;
  }
  if (/\b(nonfarm|nfp|unemployment|jobs|employment change|adp)\b/.test(t)) {
    return `Labour surprise → central-bank reaction-function pricing → ${primary} reaction${related ? related : ''} → ${crossLabel} response → structure confirmation required on 5m/15m close`;
  }
  if (/\b(fed|fomc|ecb|boe|boj|rba|boc|rbnz|snb|rate decision|policy decision|press conference)\b/.test(t)) {
    return `Tone vs market pricing → rate-path lean shifts → ${primary} reaction${related ? related : ''} → ${crossLabel} response → structure confirmation required on 5m/15m close`;
  }
  return `Event surprise → ${ccy} repricing → ${primary} reaction → ${crossLabel} response${related} → structure confirmation required on 5m/15m close`;
}

// ── SCENARIO MAP — bullish / bearish / neutral ───────────────
function scenarioMap(rawEvent) {
  const ccy = rawEvent.currency || 'the home currency';
  const bk  = eventCurrencyBucketing(rawEvent);
  const t   = String(rawEvent.title || '').toLowerCase();
  const primary = bk ? bk.primary : `${ccy} pairs`;
  const isInverse = bk && /^USD/.test(bk.primary || '');  // pair where ccy STRENGTH = USDCCY DOWN

  // Strength-direction labels (e.g. for CAD: USDCAD lower means CAD bid).
  const strongerCcy = isInverse
    ? `${primary} pressure lower if structure confirms`
    : `${primary} pressure higher if structure confirms`;
  const weakerCcy = isInverse
    ? `${primary} pressure higher if structure confirms`
    : `${primary} pressure lower if structure confirms`;

  // Class-aware "stronger reading" / "weaker reading" descriptors.
  let strongerDescr, weakerDescr;
  if (/\bpmi\b/.test(t) || /\bism\b/.test(t)) {
    strongerDescr = `Above-50 / stronger-than-expected reading supports ${ccy}`;
    weakerDescr   = `Sub-50 / weaker-than-expected reading pressures ${ccy}`;
  } else if (/\b(cpi|pce|inflation)\b/.test(t)) {
    strongerDescr = `Hotter-than-forecast print supports ${ccy} (rate-path stays higher for longer)`;
    weakerDescr   = `Softer-than-forecast print pressures ${ccy} (rate-cut pricing pulls forward)`;
  } else if (/\b(nonfarm|nfp|unemployment|jobs|employment change|adp)\b/.test(t)) {
    strongerDescr = `Stronger-than-forecast labour data supports ${ccy}`;
    weakerDescr   = `Weaker-than-forecast labour data pressures ${ccy}`;
  } else if (/\bgdp\b/.test(t)) {
    strongerDescr = `Stronger-than-forecast GDP supports ${ccy}`;
    weakerDescr   = `Weaker-than-forecast GDP pressures ${ccy}`;
  } else if (/\b(fed|fomc|ecb|boe|boj|rba|boc|rbnz|snb|rate decision|policy decision|press conference)\b/.test(t)) {
    strongerDescr = `Hawkish lean (firmer rate path / firmer guidance) supports ${ccy}`;
    weakerDescr   = `Dovish lean (softer rate path / softer guidance) pressures ${ccy}`;
  } else {
    strongerDescr = `Above-forecast / strong reading supports ${ccy}`;
    weakerDescr   = `Below-forecast / weak reading pressures ${ccy}`;
  }

  const crossNote = bk
    ? `${bk.label} crosses (${bk.crosses.slice(0, 4).join(', ')}) react in the same direction as the ${primary} move`
    : 'Cross-pair flow follows the dominant move';

  const relatedNote = bk && bk.related.length
    ? `${bk.related[0]} ${bk.related[0] === 'USOIL' || bk.related[0] === 'WTI' ? 'tracks the CAD-oil correlation' : 'reacts via the related-macro channel'}`
    : null;

  return {
    bullish: [
      `${strongerDescr}`,
      `${strongerCcy}`,
      crossNote,
      ...(relatedNote ? [relatedNote] : []),
    ],
    bearish: [
      `${weakerDescr}`,
      `${weakerCcy}`,
      crossNote,
      ...(relatedNote ? [relatedNote] : []),
    ],
    neutral: [
      `In-line print or whipsaw → no continuation assumed`,
      `Corey remains conditional until 5m/15m close confirms direction`,
      `Stand aside through the spike phase`,
    ],
  };
}

// ── COREY WATCH WINDOW (T-stage timeline) ───────────────────
function coreyWatchWindowLines() {
  return [
    'T-60 to T-15: conditions building / spreads may widen',
    'T-5 to release: no late entry advised',
    'T+0 to T+15: spike / liquidity phase',
    'T+15 to T+45: confirmation phase',
    'Reassess after first stable 15m close',
  ];
}

// ── FINAL ADVISORY STATE ────────────────────────────────────
const ADVISORY_STATE = {
  HOLD_FORMING:        'HOLD — BIAS STILL FORMING',
  MONITOR_BUILDING:    'MONITOR — CONDITIONS BUILDING',
  ENTRY_DEVELOPING:    'ENTRY CONDITIONS DEVELOPING',
  ENTRY_NOT_ADVISED:   'ENTRY NOT ADVISED',
  WITHHELD_INCOMPLETE: 'DECISION WITHHELD — SOURCE INCOMPLETE',
};
function finalAdvisoryStateForStage(stage, calendarMode) {
  if (calendarMode && /UNAVAILABLE|DEGRADED/i.test(calendarMode)) return ADVISORY_STATE.WITHHELD_INCOMPLETE;
  if (stage === 'T-RELEASE' || stage === 'T-15M') return ADVISORY_STATE.ENTRY_NOT_ADVISED;
  if (stage === 'T-30M') return ADVISORY_STATE.ENTRY_NOT_ADVISED;
  if (stage === 'T-1H')  return ADVISORY_STATE.MONITOR_BUILDING;
  if (stage === 'T-4H')  return ADVISORY_STATE.HOLD_FORMING;
  return ADVISORY_STATE.HOLD_FORMING;
}

// ── RISK / INTENSITY CUES (1..5 ratings) ────────────────────
function riskIntensityCues(stage, eventRisk) {
  // Event risk: from the calendar classification
  const eventRiskScore =
    eventRisk === EVENT_RISK.EXTREME  ? 5
    : eventRisk === EVENT_RISK.HIGH    ? 4
    : eventRisk === EVENT_RISK.MODERATE ? 3
    : 2;
  // Timing pressure: rises as we approach release
  const timingScore =
    stage === 'T-RELEASE' ? 5
    : stage === 'T-15M'   ? 5
    : stage === 'T-30M'   ? 4
    : stage === 'T-1H'    ? 3
    : 2;
  // Confirmation need is always high for high-impact pre-event
  const confirmScore = eventRiskScore >= 4 ? 5 : 4;
  // Volatility risk tracks event-risk + timing pressure
  const volScore = Math.min(5, Math.round((eventRiskScore + timingScore) / 2));
  return {
    eventRisk:        eventRiskScore,
    timingPressure:   timingScore,
    confirmationNeed: confirmScore,
    volatilityRisk:   volScore,
  };
}
function ratingBar(n) {
  return `${'⬛'.repeat(n)}${'⬜'.repeat(5 - n)} ${n}/5`;
}

// ── BUCKETED AFFECTED MARKETS — event-currency aware ────────
function bucketAffectedForEvent(rawEvent) {
  const bk = eventCurrencyBucketing(rawEvent);
  if (!bk) {
    // Fallback to the legacy bucketing
    const a = analyseEvent(rawEvent);
    return {
      hasEventBuckets: false,
      legacy: bucketAffected(a.affected || []),
    };
  }
  return {
    hasEventBuckets: true,
    primary: bk.primary,
    crosses: bk.crosses,
    related: bk.related,
    label:   bk.label,
  };
}

// ── COREY MODE — derived from corey_live status ─────────────
function coreyModeLabel() {
  if (!_coreyLiveModule || typeof _coreyLiveModule.getLiveContext !== 'function') return 'UNAVAILABLE';
  let ctx;
  try { ctx = _coreyLiveModule.getLiveContext(); }
  catch (_e) { return 'UNAVAILABLE'; }
  if (!ctx) return 'UNAVAILABLE';
  // Live cache layer reports status when available; fall back to LIVE.
  return (ctx.status && typeof ctx.status === 'string') ? String(ctx.status).toUpperCase() : 'LIVE';
}
function calendarSourceLabel() {
  try {
    const snap = _calendarModule && _calendarModule.getCalendarSnapshot && _calendarModule.getCalendarSnapshot();
    const src  = snap && snap.health && snap.health.source_used;
    if (src === 'tradingview')        return 'TradingView calendar';
    if (src === 'trading_economics')  return 'Trading Economics calendar';
    if (src === 'degraded')           return 'degraded fallback calendar';
    return 'unavailable';
  } catch (_e) { return 'unavailable'; }
}
function calendarModeLabel() {
  try {
    const snap = _calendarModule && _calendarModule.getCalendarSnapshot && _calendarModule.getCalendarSnapshot();
    return (snap && snap.health && snap.health.calendar_mode) || 'UNAVAILABLE';
  } catch (_e) { return 'UNAVAILABLE'; }
}

// ============================================================
// PRE-EVENT ALERT — ATLAS Event Intelligence quality
// 8-section structure per Nathan's Pre-Event Alert spec.
// ============================================================
function buildPreEventAlertPayload(rawEvent, minutesOut) {
  const a = analyseEvent(rawEvent);
  if (!a) return { content: '' };
  const stage    = preEventStageLabel(minutesOut);
  const cleanTitle = humanizeTitle(a.title);
  const cMode    = calendarModeLabel();
  const cSource  = calendarSourceLabel();
  const cMode2   = coreyModeLabel();
  const eventRisk = a.relevance === RELEVANCE.HIGH ? EVENT_RISK.HIGH
                  : a.relevance === RELEVANCE.MODERATE ? EVENT_RISK.MODERATE
                  : EVENT_RISK.LOW;
  const cues   = riskIntensityCues(stage, eventRisk);
  const finalState = finalAdvisoryStateForStage(stage, cMode);
  const bk     = bucketAffectedForEvent(rawEvent);
  const map    = scenarioMap(rawEvent);
  const why    = whyThisMatters(rawEvent);
  const chain  = mechanismChainLong(rawEvent);

  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`🟦 **ATLAS MARKET INTEL — PRE-EVENT ALERT**`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  // ── EVENT ──
  lines.push('**EVENT**');
  lines.push(`• Event: ${cleanTitle}`);
  lines.push(`• Currency: ${a.currency || 'unavailable'}${rawEvent.country ? ` (${rawEvent.country})` : ''}`);
  lines.push(`• Release time: ${fmtAwstShort(a.scheduled_time)} AWST / ${fmtUtcShort(a.scheduled_time)} UTC`);
  lines.push(`• Alert window: ${stage}`);
  lines.push(`• Impact: ${(rawEvent.impact || 'unavailable').toString().toUpperCase()}`);
  lines.push(`• Source: ${cSource}`);
  lines.push(`• Corey mode: ${cMode2}`);
  lines.push('');

  // ── WHY THIS MATTERS ──
  lines.push('**WHY THIS MATTERS**');
  lines.push(why);
  lines.push('');

  // ── COREY MECHANISM CHAIN ──
  lines.push('**COREY MECHANISM CHAIN**');
  lines.push(chain);
  lines.push('');

  // ── SCENARIO MAP ──
  lines.push('**SCENARIO MAP**');
  lines.push(`__Bullish ${a.currency || 'home'} scenario:__`);
  for (const l of map.bullish) lines.push(`• ${l}`);
  lines.push('');
  lines.push(`__Bearish ${a.currency || 'home'} scenario:__`);
  for (const l of map.bearish) lines.push(`• ${l}`);
  lines.push('');
  lines.push(`__Neutral / mixed scenario:__`);
  for (const l of map.neutral) lines.push(`• ${l}`);
  lines.push('');

  // ── AFFECTED MARKETS ──
  lines.push('**AFFECTED MARKETS**');
  if (bk.hasEventBuckets) {
    lines.push(`• Primary: ${bk.primary}`);
    lines.push(`• ${bk.label} crosses: ${bk.crosses.join(', ')}`);
    if (bk.related.length) {
      lines.push(`• Related macro: ${bk.related.join(' / ')} (where ${bk.label} sensitivity is relevant)`);
    }
  } else {
    // Fallback to legacy buckets if currency unknown
    const order = ['DXY','USD pairs','EUR pairs','GBP pairs','JPY crosses','AUD/NZD pairs','Metals','US indices','EU indices','Asia indices','Energy'];
    for (const k of order) {
      if (bk.legacy[k] && bk.legacy[k].length) lines.push(`• ${k}: ${bk.legacy[k].slice(0, 6).join(', ')}`);
    }
  }
  lines.push('');

  // ── TRADER OPERATING GUIDANCE ──
  lines.push('**TRADER OPERATING GUIDANCE**');
  lines.push('• No pre-release chase.');
  lines.push('• Entry conditions not developed until price confirms after release.');
  lines.push('• Wait for liquidity sweep + 5m/15m candle-close confirmation.');
  lines.push('• Reduce size or stand aside if spread/volatility expands.');
  lines.push('• First clean structure after the print is more important than the first spike.');
  lines.push('');

  // ── COREY WATCH WINDOW ──
  lines.push('**COREY WATCH WINDOW**');
  for (const l of coreyWatchWindowLines()) lines.push(`• ${l}`);
  lines.push('');

  // ── INTENSITY CUES ──
  lines.push('**INTENSITY**');
  lines.push(`• Event risk:        ${ratingBar(cues.eventRisk)}`);
  lines.push(`• Timing pressure:   ${ratingBar(cues.timingPressure)}`);
  lines.push(`• Confirmation need: ${ratingBar(cues.confirmationNeed)}`);
  lines.push(`• Volatility risk:   ${ratingBar(cues.volatilityRisk)}`);
  lines.push('');

  // ── FINAL ADVISORY STATE ──
  lines.push('**FINAL ADVISORY STATE**');
  lines.push(finalState);
  lines.push('');
  lines.push(`_${BIAS_CONDITIONAL_DISCLAIMER}_`);

  return { content: lines.join('\n'), stage };
}

// ============================================================
// RELEASED EVENT ALERT — trader-grade rebuild
// ============================================================
function buildReleasedEventAlertPayload(rawEvent) {
  const a = analyseEvent(rawEvent);
  if (!a) return { content: '' };
  const cleanTitle = humanizeTitle(a.title);
  const cMode    = calendarModeLabel();
  const cSource  = calendarSourceLabel();
  const cMode2   = coreyModeLabel();
  const bk       = bucketAffectedForEvent(rawEvent);
  const map      = scenarioMap(rawEvent);
  const why      = whyThisMatters(rawEvent);
  const chain    = mechanismChainLong(rawEvent);

  // Surprise narration — pure read of actual vs forecast (never certainty).
  let surpriseLine;
  const A = parseFloat(a.actual);
  const F = parseFloat(a.forecast);
  let surpriseSide = 'mixed';   // 'above' | 'below' | 'inline' | 'mixed'
  if (Number.isFinite(A) && Number.isFinite(F)) {
    if (A > F)      { surpriseLine = `Print came in **above forecast** (${a.actual} vs ${a.forecast}).`; surpriseSide = 'above'; }
    else if (A < F) { surpriseLine = `Print came in **below forecast** (${a.actual} vs ${a.forecast}).`; surpriseSide = 'below'; }
    else            { surpriseLine = `Print came in **in line with forecast** (${a.actual}).`;          surpriseSide = 'inline'; }
  } else {
    surpriseLine = `Values: actual ${fmtVal(a.actual)} · forecast ${fmtVal(a.forecast)} · previous ${fmtVal(a.previous)}.`;
  }

  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`🟧 **ATLAS MARKET INTEL — RELEASED EVENT**`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  // ── EVENT ──
  lines.push('**EVENT**');
  lines.push(`• Event: ${cleanTitle}`);
  lines.push(`• Currency: ${a.currency || 'unavailable'}${rawEvent.country ? ` (${rawEvent.country})` : ''}`);
  lines.push(`• Released: ${fmtAwstShort(a.scheduled_time)} AWST / ${fmtUtcShort(a.scheduled_time)} UTC`);
  lines.push(`• Impact: ${(rawEvent.impact || 'unavailable').toString().toUpperCase()}`);
  lines.push(`• Source: ${cSource}`);
  lines.push(`• Corey mode: ${cMode2}`);
  lines.push('');

  // ── RESULT ──
  lines.push('**RESULT**');
  lines.push(surpriseLine);
  if (a.previous != null && a.previous !== '') lines.push(`Previous: ${a.previous}`);
  lines.push('');

  // ── COREY READ ──
  lines.push('**COREY READ**');
  lines.push(why);
  lines.push('');

  // ── MECHANISM CHAIN ──
  lines.push('**COREY MECHANISM CHAIN**');
  lines.push(chain);
  lines.push('');

  // ── ACTIVE SCENARIO ──
  lines.push('**ACTIVE SCENARIO**');
  if (surpriseSide === 'above') {
    lines.push(`Bullish ${a.currency || 'home'} scenario is the active read post-print.`);
    for (const l of map.bullish) lines.push(`• ${l}`);
  } else if (surpriseSide === 'below') {
    lines.push(`Bearish ${a.currency || 'home'} scenario is the active read post-print.`);
    for (const l of map.bearish) lines.push(`• ${l}`);
  } else {
    lines.push('Neutral / mixed scenario — no continuation assumed.');
    for (const l of map.neutral) lines.push(`• ${l}`);
  }
  lines.push('');

  // ── AFFECTED MARKETS ──
  lines.push('**AFFECTED MARKETS**');
  if (bk.hasEventBuckets) {
    lines.push(`• Primary: ${bk.primary}`);
    lines.push(`• ${bk.label} crosses: ${bk.crosses.join(', ')}`);
    if (bk.related.length) {
      lines.push(`• Related macro: ${bk.related.join(' / ')}`);
    }
  } else {
    for (const k of BUCKET_ORDER) {
      if (bk.legacy[k] && bk.legacy[k].length) lines.push(`• ${k}: ${bk.legacy[k].slice(0, 6).join(', ')}`);
    }
  }
  lines.push('');

  // ── FIRST-REACTION CAUTION ──
  lines.push('**FIRST-REACTION CAUTION**');
  lines.push('• Immediate volatility is high — do not chase the first spike.');
  lines.push('• Wait for liquidity sweep, rejection, and a 5m/15m candle close before treating the move as continuation.');
  lines.push('• Reassess bias only after the first higher-timeframe close has formed.');
  lines.push('');

  // ── FINAL ADVISORY STATE ──
  lines.push('**FINAL ADVISORY STATE**');
  lines.push((cMode && /UNAVAILABLE|DEGRADED/i.test(cMode))
    ? ADVISORY_STATE.WITHHELD_INCOMPLETE
    : ADVISORY_STATE.ENTRY_DEVELOPING);
  lines.push('');
  lines.push(`_${BIAS_CONDITIONAL_DISCLAIMER}_`);

  return { content: lines.join('\n') };
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
// DAILY ROADMAP — 9-section ATLAS Event Intelligence + Daily
// Roadmap layer. Compressed Discord version of the locked
// "ATLAS FX — Macro + Roadmap Master Brief v2.0" doctrine.
//
// Sections (in order):
//   0. Header + Dominant Risk Score
//   1. THEME
//   2. HEADLINE RISK
//   3. EVENT INTELLIGENCE (full mechanism chain)
//   4. KEY EVENT WINDOWS — AWST
//   5. CURRENCY / ASSET NARRATIVES
//   6. CLASH & LIQUIDITY RISKS
//   7. ATLAS RESPONSE / TRADE WINDOWS
//   8. PRIORITY WATCHLIST (bucketed)
//   9. NEXT WATCH
// ============================================================
function buildDailyBulletinPayload(snapshot, geoCtx, now) {
  const NOW = now || Date.now();
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
  const riskTone     = inferRiskTone(eventRisk, geoLevel, driverLabels);
  const next         = nextMajor(today, next24.filter(e => !today.includes(e)), NOW);
  const riskScore    = riskScoreFromState(eventRisk, geoLevel);

  // Affected symbols across today's high-impact set
  const affected = new Set();
  for (const e of highToday) affectedSymbols(e).forEach(s => affected.add(s));
  const buckets = bucketAffected([...affected]);

  // Sort + format event windows in AWST chronological order
  const sortedHigh = highToday.slice().sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0));
  const sortedHighInterest = highInterestToday.slice().sort((a, b) => (a.scheduled_time || 0) - (b.scheduled_time || 0));

  // Pick headline event (highest impact, earliest in the day)
  const headline = sortedHigh[0] || null;

  // Primary affected bucket name for the THEME line
  // Build the THEME's "main volatility window for X, Y, Z" phrase from
  // whichever buckets actually have symbols today. Preserves bucket case.
  const themeAssets = [];
  if (buckets['DXY'] || buckets['USD pairs']) themeAssets.push('USD pairs');
  if (buckets['Metals']) themeAssets.push('gold');
  if (buckets['US indices']) themeAssets.push('US indices');
  if (!themeAssets.length) {
    if (buckets['EUR pairs']) themeAssets.push('EUR pairs');
    if (buckets['GBP pairs']) themeAssets.push('GBP pairs');
    if (buckets['JPY crosses']) themeAssets.push('JPY crosses');
  }
  const primaryAffectedPhrase = themeAssets.length ? themeAssets.slice(0, 3).join(', ') : null;

  const briefingDate = fmtAwstDate(NOW);
  const lines = [];

  // ── HEADER ──
  lines.push(`**ATLAS MARKET INTEL — DAILY ROADMAP**`);
  lines.push(`_${briefingDate} · AWST_`);
  // Risk-score header per ATLAS Roadmap spec:
  //   "🟥🟥🟥🟥/5 — Extreme scheduled event risk"
  const riskWord =
    eventRisk === EVENT_RISK.EXTREME    ? 'Extreme'
    : eventRisk === EVENT_RISK.HIGH     ? 'High'
    : eventRisk === EVENT_RISK.MODERATE ? 'Moderate'
    : 'Low';
  lines.push(`**Dominant Risk Score:** ${riskScoreEmoji(riskScore)} — ${riskWord} scheduled event risk`);
  lines.push(`Geopolitical: ${geoLevel}`);
  lines.push('');

  // ── 1. THEME ──
  lines.push(`**1. THEME**`);
  lines.push(buildDayTheme(highToday, driverLabels, primaryAffectedPhrase));
  lines.push('');

  // ── 2. HEADLINE RISK ──
  lines.push(`**2. HEADLINE RISK**`);
  if (headline) {
    const ht = humanizeTitle(headline.title);
    const c = classifyEventDriver(headline.title);
    const why = c
      ? (c.short === 'inflation' ? 'Inflation drives the Fed reaction function. A surprise in either direction repositions the rate path.'
        : c.short === 'labour'    ? 'Labour data sets the central-bank reaction function. Strong/weak surprise reprices the front end.'
        : c.short === 'central bank' ? 'Tone vs current market pricing is the lever. Hawkish/dovish lean reprices the rate path.'
        : c.short === 'growth'    ? 'Growth surprise resets terminal-rate expectations and risk appetite.'
        : c.short === 'consumer demand' ? 'Consumer-spending surprise reprices growth/rate expectations.'
        : c.short === 'activity'  ? 'Activity sub-50 vs above-50 is the directional lever for the home currency.'
        : c.short === 'geopolitical' ? 'Geopolitical shocks trigger fast safe-haven rotation across the major asset classes.'
        : 'Surprise vs forecast reprices the rate path and risk appetite.')
      : 'Surprise vs forecast reprices the rate path and risk appetite.';
    const reaction = c
      ? (c.short === 'inflation'  ? 'Hot print → USD/yields lift, gold + US indices pressured. Soft print → opposite.'
        : c.short === 'labour'    ? 'Strong print → USD bid via rate-path repricing. Weak print → USD pressured, gold/indices supported.'
        : c.short === 'central bank' ? 'Hawkish lean → home currency bid. Dovish lean → home currency pressured. Tone matters more than headline.'
        : c.short === 'growth'    ? 'Stronger reading → home currency + indices supported. Weaker → both pressured.'
        : c.short === 'consumer demand' ? 'Strong → home currency + consumer cyclicals supported. Weak → both pressured.'
        : c.short === 'activity'  ? 'Above 50 → home currency supported. Sub-50 → home currency pressured, defensives bid.'
        : c.short === 'geopolitical' ? 'DXY/CHF/JPY/XAU bid; equities and credit offered; vol indices lift.'
        : 'Direction depends on print vs forecast.')
      : 'Direction depends on print vs forecast.';
    lines.push(`• **Main event:** ${ht}`);
    lines.push(`• **Time:** ${fmtAwstShort(headline.scheduled_time)} AWST`);
    lines.push(`• **Why it matters:** ${why}`);
    lines.push(`• **Possible market behaviour:** ${reaction}`);
  } else {
    lines.push(`• No scheduled high-impact catalyst today.`);
    lines.push(`• Tape is driver-led — direction set by live VIX / DXY / yields.`);
  }
  lines.push('');

  // ── 3. EVENT INTELLIGENCE ──
  lines.push(`**3. EVENT INTELLIGENCE**`);
  if (headline) {
    const ht = humanizeTitle(headline.title);
    const ccy = headline.currency || 'unavailable';
    const summary = (function (e) {
      const c = classifyEventDriver(e.title);
      const ccyL = e.currency || 'home currency';
      if (!c) return `${ccyL} data release. Direction of surprise vs forecast typically flows through ${ccyL} pairs and correlated risk assets.`;
      if (c.short === 'inflation')  return `${ccyL} inflation print. Forecast ${fmtVal(e.forecast)}, previous ${fmtVal(e.previous)}. Hot/soft surprise reprices the front end of the curve.`;
      if (c.short === 'labour')     return `${ccyL} labour-market print. Forecast ${fmtVal(e.forecast)}, previous ${fmtVal(e.previous)}. Strong/weak surprise reprices the central-bank reaction function.`;
      if (c.short === 'central bank') return `${ccyL} central-bank decision. Tone vs current market pricing is the dominant lever. Surprises produce outsized moves.`;
      if (c.short === 'growth')     return `${ccyL} growth print. Forecast ${fmtVal(e.forecast)}, previous ${fmtVal(e.previous)}. Surprise resets terminal-rate expectations and risk appetite.`;
      if (c.short === 'consumer demand') return `${ccyL} consumer-demand print. Forecast ${fmtVal(e.forecast)}, previous ${fmtVal(e.previous)}.`;
      if (c.short === 'activity')   return `${ccyL} activity print. Forecast ${fmtVal(e.forecast)}, previous ${fmtVal(e.previous)}. Sub-50 typically signals contraction.`;
      if (c.short === 'geopolitical') return `Geopolitical event affecting ${ccyL} and global risk appetite.`;
      return `${ccyL} ${c.label}. Direction depends on print vs forecast.`;
    })(headline);
    const a = analyseEvent(headline);
    const buckets2 = bucketAffected(a.affected);
    const affectedShort = BUCKET_ORDER
      .filter(k => buckets2[k] && buckets2[k].length)
      .map(k => k)
      .slice(0, 5)
      .join(' · ');

    lines.push(`**Headline:** ${ht}`);
    lines.push(`**Time:** ${fmtAwstShort(headline.scheduled_time)} AWST (${fmtUtcShort(headline.scheduled_time)} UTC)`);
    lines.push(`**Summary:** ${summary}`);
    lines.push(`**Corey commentary:** ${a.coreyView}`);
    lines.push(`**Mechanism chain:** ${mechanismChainFor(headline)}`);
    lines.push(`**Trader note:** Stand down through the release. Re-engage only after liquidity sweep + 5m/15m confirmation. Sizing should be reduced into the print.`);
    lines.push(`**Affected:** ${affectedShort || 'unavailable'}`);
  } else {
    lines.push(`No scheduled headline event today. Watch live VIX / DXY / yields for regime change. Mechanism: driver moves first, calendar second.`);
  }
  lines.push('');

  // ── 4. KEY EVENT WINDOWS ──
  lines.push(`**4. KEY EVENT WINDOWS (AWST)**`);
  if (sortedHigh.length) {
    for (const e of sortedHigh.slice(0, 6)) {
      const t = humanizeTitle(e.title);
      const ccy = e.currency ? ` — ${e.currency}` : '';
      const imp = (e.impact || 'high').toString().toLowerCase() === 'high' ? 'High'
                : (e.impact || '').toString().toLowerCase() === 'medium' ? 'Medium' : 'Low';
      lines.push(`• ${fmtAwstShort(e.scheduled_time)} — ${t}${ccy} — ${imp}`);
    }
  } else {
    lines.push(`• No high-impact events scheduled today.`);
  }
  if (sortedHighInterest.length) {
    lines.push(`_Also of interest:_`);
    for (const e of sortedHighInterest.slice(0, 3)) {
      const t = humanizeTitle(e.title);
      const ccy = e.currency ? ` — ${e.currency}` : '';
      lines.push(`• ${fmtAwstShort(e.scheduled_time)} — ${t}${ccy} — Medium`);
    }
  }
  lines.push('');

  // ── 5. CURRENCY / ASSET NARRATIVES ──
  lines.push(`**5. CURRENCY / ASSET NARRATIVES**`);
  const narratives = buildCurrencyNarratives(highToday, buckets);
  if (narratives.length) {
    for (const n of narratives) {
      lines.push(`**${n.label}**`);
      lines.push(`• ${n.body}`);
    }
  } else {
    lines.push(`No specific currency/asset narratives — driver-led tape. Watch DXY, gold, and US indices vs live VIX/yields read.`);
  }
  lines.push('');

  // ── 6. CLASH & LIQUIDITY RISKS ──
  lines.push(`**6. CLASH & LIQUIDITY RISKS**`);
  for (const l of buildClashRisks(sortedHigh, NOW)) lines.push(`• ${l}`);
  lines.push('');

  // ── 7. ATLAS RESPONSE / TRADE WINDOWS ──
  lines.push(`**7. ATLAS RESPONSE / TRADE WINDOWS**`);
  for (const l of buildAtlasResponseWindows(sortedHigh)) lines.push(`• ${l}`);
  lines.push('');

  // ── 8. PRIORITY WATCHLIST ──
  lines.push(`**8. PRIORITY WATCHLIST**`);
  if (Object.keys(buckets).length) {
    for (const k of BUCKET_ORDER) {
      if (buckets[k] && buckets[k].length) lines.push(`**${k}:** ${buckets[k].slice(0, 8).join(', ')}`);
    }
  } else {
    lines.push(`_No specific priority watchlist — driver-led tape._`);
  }
  lines.push('');

  // ── 9. NEXT WATCH ──
  lines.push(`**9. NEXT WATCH**`);
  if (next) {
    lines.push(`• **Next major:** ${humanizeTitle(next.title)}${next.currency ? ` (${next.currency})` : ''}`);
    lines.push(`• **Time:** ${fmtAwstShort(next.scheduled_time)} AWST`);
    lines.push(`• **Watching for:** ${coreyWatchingFor(next)}`);
  } else {
    lines.push(`• No high-impact event scheduled in the next 48 hours.`);
    lines.push(`• Watching for: regime change in live drivers (VIX 20, DXY 100, 10y-2y zero).`);
  }
  lines.push('');
  lines.push(`_${BIAS_CONDITIONAL_DISCLAIMER}_`);

  return {
    content: lines.join('\n'),
    counts: {
      highImpactTodayCount: highToday.length,
      highInterestTodayCount: highInterestToday.length,
      next24hCount: next24.length,
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
// Market-Intel-specific banned wording (in addition to the FOMO control set).
// Per Nathan's Pre-Event Alert spec these advisory phrases are banned:
//   authorised / authorized / permitted / permission / blocked /
//   trade authorisation / no trade permitted
const MARKET_INTEL_BANNED = [
  { name: 'permitted',         pattern: /\bpermitted\b/i },
  { name: 'blocked',           pattern: /\bblocked\b/i },
  { name: 'no_trade_permitted',pattern: /\bno\s+trade\s+permitted\b/i },
  { name: 'trade_authorisation',pattern: /\btrade\s+authori[sz]ation\b/i },
];
function sanitize(payload) {
  let result = fomo.sanitize(payload);
  const extraFound = [];
  let content = result.content;
  for (const { name, pattern } of MARKET_INTEL_BANNED) {
    if (pattern.test(content)) {
      extraFound.push(name);
      const g = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
      content = content.replace(new RegExp(pattern.source, g), '[REDACTED-MI]');
    }
  }
  const allFound = [...(result.foundBanned || []), ...extraFound];
  if (allFound.length) {
    console.warn(`[${ts()}] [MARKET-INTEL-GUARD] banned phrases stripped: ${allFound.join(',')}`);
  }
  return Object.assign({}, result, { content, foundBanned: allFound, replaced: allFound.length > 0 });
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
