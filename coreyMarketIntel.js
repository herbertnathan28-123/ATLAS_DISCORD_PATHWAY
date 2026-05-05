'use strict';
// ============================================================
// ATLAS FX — COREY MARKET INTEL (analysed news only)
//
// Doctrine:
//   The Market Intel / News & Events channel must NOT pump
//   raw news. Every posted item must first be analysed by Corey:
//   relevance → affected → mechanism → conditional bias →
//   confidence → ATLAS interpretation.
//
//   Only relevant items are posted to Discord. Bias is conditional
//   until price confirms through structure. No certainty wording.
//   No invented values. No hype. No permission/authorisation
//   wording. No act-now language.
//
// Inputs: the canonical event shape from corey_calendar.js
//   normalizeEvent: { id, title, country, currency, impact,
//   scheduled_time, actual, previous, forecast, ... }
//
// Outputs: { content } payload ready for the Market Intel webhook.
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

// ── CURRENCY → AFFECTED SYMBOLS MAP ──────────────────────────
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

// ── TITLE PATTERNS — RELEVANCE HEURISTIC ─────────────────────
const HIGH_RELEVANCE_PATTERNS = [
  /\bCPI\b/i, /\bPCE\b/i, /\bcore inflation\b/i, /\binflation rate\b/i,
  /\bnonfarm\b/i, /\bNFP\b/i, /\bunemployment\b/i, /\bjobs report\b/i, /\bemployment change\b/i,
  /\bfed (?:funds|rate|decision|chair|speak|FOMC)\b/i, /\bFOMC\b/i,
  /\bECB (?:rate|decision|press)\b/i, /\bBOE (?:rate|decision)\b/i,
  /\bBOJ (?:rate|decision|policy)\b/i, /\bRBA (?:rate|decision)\b/i, /\bBOC (?:rate|decision)\b/i,
  /\bGDP\b/i, /\bretail sales\b/i, /\bPMI\b/i, /\bISM\b/i,
  /\bpolicy decision\b/i, /\bpress conference\b/i,
  /\b(?:tariff|sanction|geopolit|war|invasion|attack)\b/i,
];
const MODERATE_RELEVANCE_PATTERNS = [
  /\b(?:industrial production|consumer confidence|trade balance|housing starts|building permits|durable goods)\b/i,
];

// ============================================================
// ANALYSIS HELPERS
// ============================================================
function deriveRelevance(rawEvent) {
  const t = String(rawEvent.title || '');
  const impact = String(rawEvent.impact || rawEvent.importance || '').toLowerCase();
  if (HIGH_RELEVANCE_PATTERNS.some(re => re.test(t)) || impact === 'high') return RELEVANCE.HIGH;
  if (MODERATE_RELEVANCE_PATTERNS.some(re => re.test(t)) || impact === 'medium') return RELEVANCE.MODERATE;
  return RELEVANCE.LOW;
}

function affectedSymbols(rawEvent) {
  const ccy = rawEvent.currency || '';
  const fromCcy = CCY_TO_SYMBOLS[ccy] ? CCY_TO_SYMBOLS[ccy].slice() : [];
  // ticker hint from FMP/EODHD news items
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
  if (/\b(fed|fomc|ecb|boe|boj|rba|boc|policy decision|press conference)\b/.test(t))
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
  if (/\b(fed|fomc|ecb|boe|boj|rba|boc|policy decision|press conference)\b/.test(t))
    return `This is a central-bank communication event. A hawkish lean supports ${ccy}; a dovish lean pressures ${ccy}. Tone versus current market pricing matters more than the headline decision itself.`;
  if (/\b(tariff|sanction|geopolit|war|invasion|attack)\b/.test(t))
    return `This is a geopolitical shock. Safe-haven rotation is the dominant mechanism: DXY / CHF / JPY / XAU typically bid, equities and credit typically offered.`;
  if (/\b(pmi|ism)\b/.test(t))
    return `This is a ${ccy} activity release. Sub-50 typically signals contraction and pressures ${ccy}; above-50 supports ${ccy} and risk indices.`;
  if (/\bretail sales\b/.test(t))
    return `This is a ${ccy} consumer-demand release. A strong print typically supports ${ccy} and consumer-cyclical equities; a weak print pressures both.`;
  return `This is a ${ccy} data release. Direction of surprise versus forecast typically flows through ${ccy} pairs and correlated risk assets.`;
}

// Conditional bias only — never certainty.
function deriveBias(rawEvent) {
  const hasActual = rawEvent.actual != null && rawEvent.actual !== '';
  if (!hasActual) {
    return { label: 'Pre-release: Mixed / not confirmed', kind: BIAS_KIND.MIXED };
  }
  return {
    label: 'Post-release: depends on actual vs forecast and first structure confirmation',
    kind: BIAS_KIND.MIXED,
  };
}

function deriveConfidence(rawEvent) {
  const hasActual = rawEvent.actual != null && rawEvent.actual !== '';
  if (!hasActual) {
    return { level: CONFIDENCE.MODERATE, note: 'Moderate before release; reassess after data prints.' };
  }
  return { level: CONFIDENCE.MODERATE, note: 'Reassess after first structure confirmation.' };
}

function deriveAtlasState(relevance) {
  if (relevance === RELEVANCE.HIGH)
    return [ATLAS_STATE.EVENT_RISK_HIGH, ATLAS_STATE.DARK_HORSE_MONITOR, ATLAS_STATE.JANE_REQUIRED].join(' — ');
  if (relevance === RELEVANCE.MODERATE)
    return [ATLAS_STATE.MONITORING, ATLAS_STATE.JANE_REQUIRED].join(' — ');
  return ATLAS_STATE.MONITORING;
}

const TRADER_NOTE_DEFAULT =
  'Do not chase the first spike. Watch for liquidity sweep, rejection, and candle-close confirmation before treating the move as continuation.';

// ============================================================
// MAIN ANALYSIS
// Input:  rawEvent (corey_calendar normalizeEvent shape)
// Output: structured analysis object
// ============================================================
function analyseEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const relevance = deriveRelevance(rawEvent);
  const affected  = affectedSymbols(rawEvent);
  const mechanism = mechanismTemplate(rawEvent.title);
  const bias      = deriveBias(rawEvent);
  const confidence = deriveConfidence(rawEvent);
  return {
    title:           rawEvent.title || '(unnamed event)',
    scheduled_time:  rawEvent.scheduled_time || rawEvent.time || null,
    currency:        rawEvent.currency || null,
    actual:          rawEvent.actual,
    forecast:        rawEvent.forecast != null ? rawEvent.forecast : rawEvent.expected,
    previous:        rawEvent.previous,
    relevance,
    affected,
    coreyView:       buildCoreyView(rawEvent),
    mechanism,
    bias,
    confidence,
    traderNote:      TRADER_NOTE_DEFAULT,
    atlasState:      deriveAtlasState(relevance),
  };
}

// ============================================================
// RELEVANCE GATE
// Low relevance → never posted to Discord (rule: do not post
// irrelevant low-value news).
// ============================================================
function shouldPostToDiscord(analysis) {
  if (!analysis || !analysis.title) return false;
  return analysis.relevance !== RELEVANCE.LOW;
}

// ============================================================
// FORMATTER — verbatim spec layout
// "ATLAS MARKET INTEL — COREY VIEW" with Event / Relevance /
// Affected / Corey view / Expected mechanism / Conditional bias /
// Confidence / Trader note / ATLAS state.
// ============================================================
function fmtVal(v) {
  if (v == null || v === '') return 'unavailable';
  return String(v);
}

function formatIntelPayload(analysis) {
  if (!analysis) return { content: '' };

  const affected = (analysis.affected && analysis.affected.length) ? analysis.affected.join(', ') : 'unavailable';
  const sched = analysis.scheduled_time
    ? new Date(analysis.scheduled_time).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
    : 'unavailable';

  // Values block — pass-through only; never invented.
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
    `**Conditional bias:**\n${analysis.bias.label}\n\n` +
    `**Confidence:**\n${analysis.confidence.level} — ${analysis.confidence.note}\n\n` +
    `**Trader note:**\n${analysis.traderNote}\n\n` +
    `**ATLAS state:**\n${analysis.atlasState}`;

  return { content };
}

// ============================================================
// SANITISER — reuse FOMO banned-phrase gate.
// Strips any hype / permission / act-now wording and logs
// [MARKET-INTEL-GUARD] (mirrors [FOMO-GUARD] semantics).
// ============================================================
function sanitize(payload) {
  const result = fomo.sanitize(payload);
  if (result.replaced) {
    console.warn(`[${new Date().toISOString()}] [MARKET-INTEL-GUARD] banned phrases stripped: ${result.foundBanned.join(',')}`);
  }
  return result;
}

// ============================================================
// WEBHOOK DELIVERY
// Uses MARKET_INTEL_WEBHOOK env var. Mirrors dhSendWebhook
// shape from darkHorseEngine.js. If env var is unset, the
// payload is logged but not posted.
// ============================================================
function sendIntelWebhook(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    if (!webhookUrl) { resolve(null); return; }
    const body = JSON.stringify(payload);
    const url  = new URL(webhookUrl);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'ATLAS-FX-MarketIntel/0.1' },
      timeout:  10000,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error',   reject);
    req.on('timeout', () => reject(new Error('Webhook timeout')));
    req.write(body);
    req.end();
  });
}

// ============================================================
// END-TO-END: analyse → gate → format → sanitise → post
// Returns { posted: bool, reason?, analysis, payload? }
// ============================================================
async function analyseAndPost(rawEvent, opts) {
  opts = opts || {};
  const webhookUrl = opts.webhookUrl || process.env.MARKET_INTEL_WEBHOOK || null;
  const analysis = analyseEvent(rawEvent);
  if (!analysis) {
    console.log(`[${new Date().toISOString()}] [MARKET-INTEL] skip reason=invalid_event`);
    return { posted: false, reason: 'invalid_event', analysis: null };
  }
  if (!shouldPostToDiscord(analysis)) {
    console.log(`[${new Date().toISOString()}] [MARKET-INTEL] skip title="${analysis.title}" relevance=${analysis.relevance} reason=below_relevance_threshold`);
    return { posted: false, reason: 'below_relevance_threshold', analysis };
  }
  const payload = sanitize(formatIntelPayload(analysis));

  if (!webhookUrl) {
    console.log(`[${new Date().toISOString()}] [MARKET-INTEL] webhook not configured (MARKET_INTEL_WEBHOOK unset) — analysis recorded but not posted; title="${analysis.title}" relevance=${analysis.relevance}`);
    return { posted: false, reason: 'webhook_not_configured', analysis, payload };
  }

  try {
    const res = await sendIntelWebhook(webhookUrl, { content: payload.content });
    console.log(`[${new Date().toISOString()}] [MARKET-INTEL] posted title="${analysis.title}" relevance=${analysis.relevance} affected=${(analysis.affected || []).length} status=${res ? res.status : 'n/a'}` +
                (payload.replaced ? ' (sanitized)' : ''));
    return { posted: true, analysis, payload, response: res };
  } catch (e) {
    console.error(`[${new Date().toISOString()}] [MARKET-INTEL] post failed title="${analysis.title}" error=${e.message}`);
    return { posted: false, reason: 'webhook_error', error: e.message, analysis, payload };
  }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  RELEVANCE, BIAS_KIND, CONFIDENCE, ATLAS_STATE,
  CCY_TO_SYMBOLS, HIGH_RELEVANCE_PATTERNS, MODERATE_RELEVANCE_PATTERNS,
  TRADER_NOTE_DEFAULT,

  analyseEvent,
  shouldPostToDiscord,
  formatIntelPayload,
  sanitize,
  sendIntelWebhook,
  analyseAndPost,

  // helpers exposed for tests / external composition
  deriveRelevance,
  affectedSymbols,
  mechanismTemplate,
  buildCoreyView,
  deriveBias,
  deriveConfidence,
  deriveAtlasState,
};
