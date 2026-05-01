'use strict';
// ============================================================
// ATLAS FX — COREY PHASE 2: ECONOMIC CALENDAR ENGINE
// Two feeds: TradingView Economic Calendar + Forex Factory RSS
// Deduplicates, caches, provides bias/intelligence per symbol.
// No new dependencies — uses built-in https + manual XML parse.
// ============================================================

const https = require('https');

// ── CURRENCY → SYMBOL MAP ────────────────────────────────────
const CCY_MAP = {
  USD: ['EURUSD','GBPUSD','USDJPY','AUDUSD','NZDUSD','USDCAD','USDCHF','NAS100','US500','US30','XAUUSD','XAGUSD','DJI'],
  EUR: ['EURUSD','EURGBP','EURJPY','EURCHF','EURAUD','EURCAD'],
  GBP: ['GBPUSD','EURGBP','GBPJPY','GBPCHF','GBPAUD','GBPCAD'],
  JPY: ['USDJPY','EURJPY','GBPJPY','AUDJPY','CADJPY','NZDJPY'],
  AUD: ['AUDUSD','AUDCAD','AUDCHF','AUDNZD','AUDJPY'],
  NZD: ['NZDUSD','NZDCAD','NZDCHF','NZDJPY','AUDNZD'],
  CAD: ['USDCAD','AUDCAD','NZDCAD','CADJPY'],
  CHF: ['USDCHF','EURCHF','GBPCHF','AUDCHF','NZDCHF']
};
const SYM_CURRENCIES = {};
for (const [ccy, syms] of Object.entries(CCY_MAP)) {
  for (const s of syms) {
    if (!SYM_CURRENCIES[s]) SYM_CURRENCIES[s] = [];
    if (!SYM_CURRENCIES[s].includes(ccy)) SYM_CURRENCIES[s].push(ccy);
  }
}

// ── HISTORICAL REACTION DATABASE ─────────────────────────────
const REACTIONS = {
  CPI:           { above: { dir: 'rallies',  pct: 68 }, below: { dir: 'sells',   pct: 74 } },
  NFP:           { above: { dir: 'strong',   pct: 72 }, below: { dir: 'weak',    pct: 68 } },
  'Rate Decision': { hawkish: { dir: 'bullish', pct: 75 }, dovish: { dir: 'bearish', pct: 70 } },
  GDP:           { above: { dir: 'bullish',  pct: 61 }, below: { dir: 'bearish', pct: 65 } },
  PMI:           { above: { dir: 'bullish',  pct: 58 }, below: { dir: 'bearish', pct: 62 } }
};
const EXPECTED_PIPS = {
  CPI: [60, 90], NFP: [80, 120], 'Rate Decision': [50, 150],
  GDP: [30, 60], PMI: [20, 40], 'CB Speaker': [15, 40]
};

function matchEventType(title) {
  const t = (title || '').toUpperCase();
  if (t.includes('CPI') || t.includes('INFLATION')) return 'CPI';
  if (t.includes('NON-FARM') || t.includes('NFP') || t.includes('NONFARM')) return 'NFP';
  if (t.includes('RATE') && t.includes('DECISION') || t.includes('INTEREST RATE') || t.includes('MONETARY POLICY')) return 'Rate Decision';
  if (t.includes('GDP')) return 'GDP';
  if (t.includes('PMI') || t.includes('PURCHASING MANAGER')) return 'PMI';
  if (t.includes('SPEAK') || t.includes('PRESS CONFERENCE') || t.includes('TESTIMONY')) return 'CB Speaker';
  return null;
}

// ── HTTP HELPERS ─────────────────────────────────────────────

/* [COREY-CALENDAR] httpGet now captures status code + content-type so the
   caller can validate the response before attempting to parse. The previous
   shape ({ body }) silently fed HTML / 4xx text into JSON.parse and produced
   the "Unexpected token '<'" failure pattern observed in production logs. */
function httpGet(urlStr, timeout = 12000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const headers = Object.assign({ 'User-Agent': 'ATLAS-FX/4.0', 'Accept': 'application/json' }, extraHeaders);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', timeout, headers }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: (res.headers && res.headers['content-type']) || '',
        body: data
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

/* [COREY-CALENDAR] Per-source health surface (Phase 2 A2a reshape — no ff).
   Sources: tv (primary), te (env-gated middle tier), degraded (emergency
   internal fallback). Status values:
     'unknown'         — boot, never attempted
     'ok'              — fetch returned events > 0
     'nonproductive'   — fetch returned HTTP 200 JSON but events = 0 after
                         normalisation (per Nathan's health rule — a 200 with
                         zero events is NOT healthy for source_used purposes)
     'failed'          — fetch rejected by validation (non-2xx / non-JSON /
                         parse error / shape error / network error)
     'skipped'         — source gated off (te without FMP_API_KEY)
     'active'          — degraded-mode generator produced events */
const _sourceHealth = {
  tv:       { status: 'unknown', lastFetched: 0, lastCount: 0, rawCount: 0, lastError: null, lastStatusCode: null, lastContentType: null, lastUrl: null },
  te:       { status: 'unknown', lastFetched: 0, lastCount: 0, lastError: null, lastStatusCode: null, lastContentType: null },
  degraded: { status: 'unknown', lastFetched: 0, lastCount: 0, lastError: null }
};

function markSourceFailed(source, reason, statusCode, contentType) {
  _sourceHealth[source].status = 'failed';
  _sourceHealth[source].lastFetched = Date.now();
  _sourceHealth[source].lastCount = 0;
  _sourceHealth[source].lastError = reason;
  _sourceHealth[source].lastStatusCode = statusCode || null;
  _sourceHealth[source].lastContentType = contentType || null;
  console.error(`[COREY-CALENDAR] source=${source} status=FAILED http=${statusCode || 'n/a'} content-type=${contentType || 'n/a'} reason=${reason}`);
}

function markSourceOk(source, count, statusCode, contentType) {
  _sourceHealth[source].status = 'ok';
  _sourceHealth[source].lastFetched = Date.now();
  _sourceHealth[source].lastCount = count;
  _sourceHealth[source].lastError = null;
  _sourceHealth[source].lastStatusCode = statusCode || 200;
  _sourceHealth[source].lastContentType = contentType || null;
  console.log(`[COREY-CALENDAR] source=${source} status=${statusCode || 200} content-type=${contentType || 'n/a'} events=${count} health=ok`);
}

/* [COREY-CALENDAR] Phase 2 A2a — Nathan's health rule. A source that returns
   HTTP 200 JSON but produces zero events after normalisation is NOT healthy
   for source_used purposes. Distinguished from 'failed' so downstream can see
   that the upstream is reachable but not carrying events for the active
   window/countries — a data-quality signal, not a transport failure. */
function markSourceNonProductive(source, reason, statusCode, contentType, rawCount) {
  _sourceHealth[source].status = 'nonproductive';
  _sourceHealth[source].lastFetched = Date.now();
  _sourceHealth[source].lastCount = 0;
  if (_sourceHealth[source].rawCount !== undefined) _sourceHealth[source].rawCount = rawCount || 0;
  _sourceHealth[source].lastError = reason;
  _sourceHealth[source].lastStatusCode = statusCode || 200;
  _sourceHealth[source].lastContentType = contentType || null;
  console.warn(`[COREY-CALENDAR] source=${source} status=${statusCode || 200} content-type=${contentType || 'n/a'} events=0 raw=${rawCount || 0} health=nonproductive reason=${reason}`);
}

// ── FEED 1: TRADINGVIEW ECONOMIC CALENDAR ────────────────────

async function fetchTradingView() {
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const countries = 'US,EU,GB,JP,AU,CA,CH,NZ,CN';
  /* [COREY-CALENDAR] Phase 2 A1 — TradingView JSON endpoint is usable only
     when the Origin header is set to a TradingView sub-domain. Without it the
     endpoint serves the Cloudflare HTML block page, which was the root cause
     of the prior "Unexpected token '<'" parse failure. TV remains UNOFFICIAL —
     observed behaviour, not a public contract — so all the existing hard
     validation stays. */
  const url = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=${countries}`;
  _sourceHealth.tv.lastUrl = url;
  /* [COREY-CALENDAR] A2a — TV request diagnostic. Logs the exact URL + active
     params so post-mortem on a zero-count return can check whether the window
     or country filter is the cause. */
  console.log(`[COREY-CALENDAR] tv request url=${url} window=${from}..${to} countries=${countries}`);
  let status = null, contentType = null;
  try {
    const resp = await httpGet(url, 12000, { 'Origin': 'https://in.tradingview.com' });
    status = resp.status;
    contentType = resp.contentType;
    if (status < 200 || status >= 300) {
      markSourceFailed('tv', `non-2xx status: ${status}`, status, contentType);
      return [];
    }
    if (!/application\/json|text\/json/i.test(contentType || '')) {
      const preview = (resp.body || '').slice(0, 80).replace(/\s+/g, ' ');
      markSourceFailed('tv', `non-JSON content-type — body preview: ${preview}`, status, contentType);
      return [];
    }
    let raw;
    try { raw = JSON.parse(resp.body); }
    catch (parseErr) {
      const preview = (resp.body || '').slice(0, 80).replace(/\s+/g, ' ');
      markSourceFailed('tv', `JSON parse error: ${parseErr.message} — body preview: ${preview}`, status, contentType);
      return [];
    }
    const list = Array.isArray(raw.result || raw) ? (raw.result || raw) : null;
    if (!list) {
      markSourceFailed('tv', 'response shape unexpected — no array at .result or top level', status, contentType);
      return [];
    }
    /* [COREY-CALENDAR] A2a — zero-count diagnostic per Nathan's health rule.
       Log raw count (before any filter), the importance filter count, and the
       final normalised count. If the normalised count is zero, mark the source
       nonproductive — a 200 with zero events is NOT healthy. */
    const rawCount = list.length;
    if (list.length > 0) console.log(`[COREY-CALENDAR] tv sample importance=${list[0].importance} title="${list[0].title || list[0].indicator || 'n/a'}"`);
    const filteredByImportance = list.filter(e => Number.isFinite(e.importance) && e.importance >= 0);
    const postFilterCount = filteredByImportance.length;
    const events = filteredByImportance.map(e => normalizeEvent({
      source: 'tv',
      id: e.id != null ? `tv-${e.id}` : null,
      title: e.title || e.indicator || '',
      country: (e.country || '').toUpperCase(),
      currency: mapTVCountry(e.country),
      scheduled_time: new Date(e.date || e.time).getTime(),
      impact: e.importance >= 1 ? 'high' : e.importance === 0 ? 'medium' : 'low',
      expected: e.forecast != null ? String(e.forecast) : null,
      previous: e.previous != null ? String(e.previous) : null,
      actual:   e.actual   != null ? String(e.actual)   : null,
      ticker:   e.ticker || null,
      comment:  e.comment || null
    }));
    const normalizedCount = events.length;
    console.log(`[COREY-CALENDAR] tv diagnostic raw=${rawCount} after-importance-filter=${postFilterCount} normalized=${normalizedCount}`);
    if (normalizedCount === 0) {
      markSourceNonProductive('tv', `raw=${rawCount} postFilter=${postFilterCount} — endpoint reachable but zero events in active window/countries`, status, contentType, rawCount);
      return [];
    }
    markSourceOk('tv', normalizedCount, status, contentType);
    _sourceHealth.tv.rawCount = rawCount;
    return events;
  } catch (e) {
    markSourceFailed('tv', e.message || String(e), status, contentType);
    return [];
  }
}

function mapTVCountry(c) {
  const m = { US: 'USD', EU: 'EUR', GB: 'GBP', JP: 'JPY', AU: 'AUD', NZ: 'NZD', CA: 'CAD', CH: 'CHF' };
  return m[(c || '').toUpperCase()] || 'USD';
}

// ── FEED 2: FMP ECONOMIC CALENDAR (env-gated middle tier) ────
// Middle tier between TradingView (primary) and the degraded-mode
// internal cadence fallback. Activated only when process.env
// .FMP_API_KEY is set. Premium subscription required. When the key is
// unset, this path logs te:skipped and returns an empty array.
//
// Endpoint shape:
//   https://financialmodelingprep.com/api/v3/economic_calendar
//     ?from=YYYY-MM-DD&to=YYYY-MM-DD&apikey=<KEY>
// Response: top-level array of { date, country, currency, event,
//   estimate, previous, actual, impact, ... }
//
// Internal slot is still keyed 'te' for back-compat with the existing
// health surface and source_used logging path.

const FMP_COUNTRY_MAP = {
  US: 'US', EU: 'EU', GB: 'GB', JP: 'JP',
  AU: 'AU', CA: 'CA', CH: 'CH', NZ: 'NZ', CN: 'CN'
};
const FMP_CCY_MAP = {
  US: 'USD', EU: 'EUR', GB: 'GBP', JP: 'JPY',
  AU: 'AUD', CA: 'CAD', CH: 'CHF', NZ: 'NZD', CN: 'CNY'
};

async function fetchFMP() {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    _sourceHealth.te.status = 'skipped';
    _sourceHealth.te.lastFetched = Date.now();
    _sourceHealth.te.lastCount = 0;
    _sourceHealth.te.lastError = 'FMP_API_KEY not set';
    console.log('[COREY-CALENDAR] source=fmp status=skipped events=0 reason=FMP_API_KEY not set');
    return [];
  }
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${encodeURIComponent(key)}`;
  let status = null, contentType = null;
  try {
    const resp = await httpGet(url);
    status = resp.status; contentType = resp.contentType;
    if (status < 200 || status >= 300) {
      markSourceFailed('te', `non-2xx status: ${status}`, status, contentType);
      return [];
    }
    if (!/application\/json|text\/json/i.test(contentType || '')) {
      const preview = (resp.body || '').slice(0, 80).replace(/\s+/g, ' ');
      markSourceFailed('te', `non-JSON content-type — body preview: ${preview}`, status, contentType);
      return [];
    }
    let raw;
    try { raw = JSON.parse(resp.body); }
    catch (parseErr) {
      const preview = (resp.body || '').slice(0, 80).replace(/\s+/g, ' ');
      markSourceFailed('te', `JSON parse error: ${parseErr.message} — body preview: ${preview}`, status, contentType);
      return [];
    }
    if (!Array.isArray(raw)) {
      markSourceFailed('te', 'response shape unexpected — top level is not an array', status, contentType);
      return [];
    }
    const events = raw
      .filter(e => FMP_COUNTRY_MAP[e.country])
      .map(e => {
        const t = e.date ? Date.parse(e.date.includes('Z') ? e.date : e.date.replace(' ', 'T') + 'Z') : NaN;
        const impactRaw = String(e.impact || '').toLowerCase();
        const impact = impactRaw === 'high' ? 'high' : impactRaw === 'medium' ? 'medium' : 'low';
        return normalizeEvent({
          source: 'fmp',
          id: e.event ? `fmp-${e.country}-${e.event}-${t}` : null,
          title: e.event || '',
          country: e.country,
          currency: e.currency || FMP_CCY_MAP[e.country] || 'USD',
          scheduled_time: isFinite(t) ? t : null,
          impact,
          expected: e.estimate != null && e.estimate !== '' ? String(e.estimate) : null,
          previous: e.previous != null && e.previous !== '' ? String(e.previous) : null,
          actual:   e.actual   != null && e.actual   !== '' ? String(e.actual)   : null,
          ticker:   null,
          comment:  null
        });
      })
      .filter(e => e.scheduled_time != null && e.impact !== 'low');
    if (events.length === 0) {
      markSourceNonProductive('te', `raw=${raw.length} postFilter=0 — endpoint reachable but zero events in active window/countries`, status, contentType, raw.length);
      return [];
    }
    markSourceOk('te', events.length, status, contentType);
    return events;
  } catch (e) {
    markSourceFailed('te', e.message || String(e), status, contentType);
    return [];
  }
}

// ── NORMALIZED EVENT SHAPE (Phase 2.5) ───────────────────────
//
// Internal canonical shape for every event regardless of source:
//   { title, currency, impact, scheduled_time, expected, previous,
//     source, directional_bias_note, volatility_note }
//
// Back-compat aliases (time / importance / forecast / actual) are kept on the
// same object so existing consumers in corey_live_data.js (getCalendarBias,
// getUpcomingEvents) and any unmigrated callers continue to work without a
// parallel sweep.

function buildBiasNote(type, currency) {
  const r = type ? REACTIONS[type] : null;
  if (!r) return null;
  if (r.above && r.below) {
    return `${currency} ${r.above.dir} above-forecast ${r.above.pct}% / ${r.below.dir} below-forecast ${r.below.pct}%`;
  }
  if (r.hawkish && r.dovish) {
    return `${currency} ${r.hawkish.dir} on hawkish ${r.hawkish.pct}% / ${r.dovish.dir} on dovish ${r.dovish.pct}%`;
  }
  return null;
}

function buildVolNote(type, currency) {
  const p = type ? EXPECTED_PIPS[type] : null;
  if (!p) return null;
  return `expected ${p[0]}–${p[1]} pips on ${currency}`;
}

function normalizeEvent(e) {
  const type = matchEventType(e.title);
  const directional_bias_note = buildBiasNote(type, e.currency);
  const volatility_note = buildVolNote(type, e.currency);
  return {
    /* spec 2.5 canonical fields (revised Phase 2 — adds id/country/ticker/comment) */
    id: e.id != null ? e.id : null,
    title: e.title || '',
    country: e.country || null,
    currency: e.currency || 'USD',
    impact: e.impact,
    scheduled_time: e.scheduled_time,
    actual: e.actual != null ? e.actual : null,
    previous: e.previous != null ? e.previous : null,
    forecast: e.expected != null ? e.expected : null,
    source: e.source,
    ticker: e.ticker != null ? e.ticker : null,
    comment: e.comment != null ? e.comment : null,
    directional_bias_note,
    volatility_note,
    /* back-compat aliases (legacy field names used by getCalendarBias /
       getEventIntelligence / getUpcomingEvents before the shape revision) */
    time: e.scheduled_time,
    importance: e.impact,
    expected: e.expected != null ? e.expected : null
  };
}

// ── MERGE + DEDUP ────────────────────────────────────────────

function deduplicateEvents(a, b) {
  const merged = [...a];
  const WINDOW_MS = 60 * 60 * 1000;
  for (const ev of b) {
    const dup = merged.some(m =>
      m.currency === ev.currency &&
      normaliseTitle(m.title) === normaliseTitle(ev.title) &&
      Math.abs(m.scheduled_time - ev.scheduled_time) < WINDOW_MS
    );
    if (!dup) merged.push(ev);
  }
  merged.sort((x, y) => x.scheduled_time - y.scheduled_time);
  return merged;
}

function normaliseTitle(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
}

// ── CACHE + MODE STATE ───────────────────────────────────────

let _calendar = [];
let _lastRefresh = 0;
let _sourceUsed = null;             // 'tradingview' | 'trading_economics' | 'degraded' | null
let _calendarMode = 'UNKNOWN';      // 'LIVE' | 'FALLBACK' | 'DEGRADED' | 'UNKNOWN'
const CACHE_TTL_MS = 3600 * 1000;   // 1 hour serve-from-cache guard per spec 2.7

function isActiveSession() {
  const h = new Date().getUTCHours();
  return (h >= 8 && h < 17) || (h >= 13 && h < 22);
}

// ── DEGRADED-MODE CADENCE GENERATOR (Phase 2 A2b) ────────────
//
// Emergency fallback that produces non-zero events when TV and TE both
// fail to deliver. Computed from cadence rules, not a static date table:
//
//  Monthly (pure day-of-month rules — no anchor):
//    NFP        — first Friday of month, 12:30 UTC
//    RBA        — first Tuesday of month except January, 03:30 UTC
//    US CPI     — second Tuesday of month, 12:30 UTC
//    EU HICP    — 17th of month, 09:00 UTC (calendar-day approx)
//    UK CPI     — Wednesday on/after 17th, 06:00 UTC
//    JP CPI     — last Friday of month, 23:30 UTC
//
//  Central banks (interval-from-anchor — anchor needs annual update):
//    FOMC       — ~49-day cadence
//    ECB        — ~42-day cadence
//    BOE MPC    — ~49-day cadence
//    BOJ        — ~49-day cadence
//    Each anchor is one published meeting from the current cycle. The
//    projection rule is "anchor + N * intervalDays for N in [-10..+10]"
//    intersected with the [now, now+30d] window.
//
// All degraded events are marked source='degraded', impact='high',
// expected/previous/actual=null, comment notes the cadence-rule provenance.

const CB_ANCHORS = {
  FOMC: { title: 'FOMC Rate Decision',     currency: 'USD', country: 'US', anchor: '2026-04-29T18:00:00Z', intervalDays: 49 },
  ECB:  { title: 'ECB Rate Decision',      currency: 'EUR', country: 'EU', anchor: '2026-04-16T12:45:00Z', intervalDays: 42 },
  BOE:  { title: 'BOE MPC Rate Decision',  currency: 'GBP', country: 'GB', anchor: '2026-05-07T11:00:00Z', intervalDays: 49 },
  BOJ:  { title: 'BOJ Rate Decision',      currency: 'JPY', country: 'JP', anchor: '2026-04-28T03:00:00Z', intervalDays: 49 }
};

function nthWeekdayOfMonth(year, monthIdx, nth, weekday) {
  // weekday: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const first = new Date(Date.UTC(year, monthIdx, 1));
  const offset = ((weekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7;
  return new Date(Date.UTC(year, monthIdx, 1 + offset));
}

function lastWeekdayOfMonth(year, monthIdx, weekday) {
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0));
  const diff = (lastDay.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, monthIdx, lastDay.getUTCDate() - diff));
}

function generateDegradedEvents() {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86400000);
  const buf = [];

  // Iterate over each calendar month touched by the [now, now+30d] window
  const monthKeys = new Set();
  for (let t = now.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    monthKeys.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
  }
  for (const key of monthKeys) {
    const [year, monthIdx] = key.split('-').map(Number);

    // NFP — first Friday, 12:30 UTC
    const nfp = nthWeekdayOfMonth(year, monthIdx, 1, 5);
    nfp.setUTCHours(12, 30, 0, 0);
    buf.push({ title: 'US Non-Farm Payrolls',          currency: 'USD', country: 'US', t: nfp.getTime() });

    // RBA — first Tuesday, except January, 03:30 UTC
    if (monthIdx !== 0) {
      const rba = nthWeekdayOfMonth(year, monthIdx, 1, 2);
      rba.setUTCHours(3, 30, 0, 0);
      buf.push({ title: 'RBA Cash Rate Decision',      currency: 'AUD', country: 'AU', t: rba.getTime() });
    }

    // US CPI — second Tuesday, 12:30 UTC
    const uscpi = nthWeekdayOfMonth(year, monthIdx, 2, 2);
    uscpi.setUTCHours(12, 30, 0, 0);
    buf.push({ title: 'US Consumer Price Index',       currency: 'USD', country: 'US', t: uscpi.getTime() });

    // EU HICP — 17th of month, 09:00 UTC (Eurostat publishes ~mid-month)
    const eu = new Date(Date.UTC(year, monthIdx, 17, 9, 0, 0));
    buf.push({ title: 'Euro Area HICP',                currency: 'EUR', country: 'EU', t: eu.getTime() });

    // UK CPI — Wednesday on/after 17th, 06:00 UTC
    const baseline = new Date(Date.UTC(year, monthIdx, 17));
    const wedDelta = (3 - baseline.getUTCDay() + 7) % 7;
    const uk = new Date(Date.UTC(year, monthIdx, 17 + wedDelta, 6, 0, 0));
    buf.push({ title: 'UK Consumer Price Index',       currency: 'GBP', country: 'GB', t: uk.getTime() });

    // JP CPI — last Friday, 23:30 UTC
    const jp = lastWeekdayOfMonth(year, monthIdx, 5);
    jp.setUTCHours(23, 30, 0, 0);
    buf.push({ title: 'Japan Consumer Price Index',    currency: 'JPY', country: 'JP', t: jp.getTime() });
  }

  // Central banks — interval-from-anchor projection
  for (const spec of Object.values(CB_ANCHORS)) {
    const anchor = Date.parse(spec.anchor);
    const intervalMs = spec.intervalDays * 86400000;
    for (let i = -10; i <= 10; i++) {
      const t = anchor + i * intervalMs;
      if (t >= now.getTime() && t <= end.getTime()) {
        buf.push({ title: spec.title, currency: spec.currency, country: spec.country, t });
      }
    }
  }

  // Window filter + normalize
  const result = buf
    .filter(e => e.t >= now.getTime() && e.t <= end.getTime())
    .sort((a, b) => a.t - b.t)
    .map((e, i) => normalizeEvent({
      source: 'degraded',
      id: `degraded-${e.currency}-${new Date(e.t).toISOString().slice(0, 10)}-${i}`,
      title: e.title,
      country: e.country,
      currency: e.currency,
      scheduled_time: e.t,
      impact: 'high',
      expected: null,
      previous: null,
      actual:   null,
      ticker:   null,
      comment:  'degraded mode — scheduled from cadence rules, not live data'
    }));

  // Update health surface
  _sourceHealth.degraded.lastFetched = Date.now();
  _sourceHealth.degraded.lastCount = result.length;
  if (result.length > 0) {
    _sourceHealth.degraded.status = 'active';
    _sourceHealth.degraded.lastError = null;
  } else {
    _sourceHealth.degraded.status = 'failed';
    _sourceHealth.degraded.lastError = 'cadence generator produced zero events for the active window';
  }
  return result;
}

async function refreshCalendar(opts) {
  opts = opts || {};
  /* [COREY-CALENDAR] A2b — 3600s serve-from-cache guard per spec 2.7. If the
     cache is younger than CACHE_TTL_MS, skip all external fetches and reuse
     the in-memory snapshot. Callers that need a forced re-fetch pass
     { force:true } — auto-refresh tick does not force, so hourly cadence is
     preserved and the external rate-limit surface is minimised. */
  const now = Date.now();
  if (!opts.force && _lastRefresh > 0 && (now - _lastRefresh) < CACHE_TTL_MS) {
    const ageMin = ((now - _lastRefresh) / 60000).toFixed(1);
    const ttlMin = (CACHE_TTL_MS / 60000).toFixed(0);
    console.log(`[COREY-CALENDAR] cache hit age=${ageMin}min ttl=${ttlMin}min events=${_calendar.length} source_used=${_sourceUsed} mode=${_calendarMode}`);
    return;
  }

  console.log('[COREY-CALENDAR] Refreshing...');
  try {
    const [tv, te] = await Promise.all([fetchTradingView(), fetchFMP()]);

    /* [COREY-CALENDAR] A2b — TV → TE → degraded fall-through per spec.
       A source counts as productive iff it returned events.length > 0 AND
       its health status is 'ok'. tv='nonproductive' (200 with zero events)
       triggers TE, which on zero triggers degraded. */
    let events, source_used, calendar_mode;
    if (tv.length > 0 && _sourceHealth.tv.status === 'ok') {
      events = tv;
      source_used = 'tradingview';
      calendar_mode = 'LIVE';
      _sourceHealth.degraded.status = 'standby';
      _sourceHealth.degraded.lastError = null;
    } else if (te.length > 0 && _sourceHealth.te.status === 'ok') {
      events = te;
      source_used = 'trading_economics';
      calendar_mode = 'FALLBACK';
      _sourceHealth.degraded.status = 'standby';
      _sourceHealth.degraded.lastError = null;
    } else {
      events = generateDegradedEvents();
      source_used = 'degraded';
      calendar_mode = 'DEGRADED';
      /* degraded.status is set by the generator to 'active' or 'failed' */
      console.log(`[COREY-CALENDAR] all sources exhausted → mode=DEGRADED events=${events.length}`);
    }

    _calendar = events;
    _sourceUsed = source_used;
    _calendarMode = calendar_mode;
    _lastRefresh = Date.now();

    const tvH = _sourceHealth.tv, teH = _sourceHealth.te, dgH = _sourceHealth.degraded;
    const available = getCalendarHealth().available;
    console.log(`[COREY-CALENDAR] refresh summary tv=${tv.length}(${tvH.status}) te=${te.length}(${teH.status}) degraded=${dgH.lastCount || 0}(${dgH.status}) merged=${_calendar.length} source_used=${source_used} mode=${calendar_mode} available=${available}`);
  } catch (e) {
    console.error('[COREY-CALENDAR] Refresh error:', e.message);
  }
}

let _autoRefreshStarted = false;
function startAutoRefresh() {
  /* [COREY-CALENDAR] A1.1 — idempotency guard. The registration chain now has
     two callers: corey_live_data.js:338 (legacy) and index.js (new, via
     coreyCalendar.init()). Without this guard, both callers would schedule
     independent tick timers and the refresh would double-fire. */
  if (_autoRefreshStarted) {
    console.log('[COREY-CALENDAR] startAutoRefresh skipped — already running');
    return;
  }
  _autoRefreshStarted = true;
  console.log('[COREY-CALENDAR] startAutoRefresh registered');
  const tick = async () => {
    const interval = isActiveSession() ? 15 * 60 * 1000 : 60 * 60 * 1000;
    await refreshCalendar();
    setTimeout(tick, interval);
  };
  tick();
}

/* [COREY-CALENDAR] A1.1 — explicit init() export so index.js can register the
   refresh loop directly, without depending on coreyLive.init() reaching its
   own calendar.startAutoRefresh() line. Belt-and-suspenders: if the async
   coreyLive init path rejects before reaching the calendar, this path still
   fires. Idempotent via the guard inside startAutoRefresh(). */
function init() {
  startAutoRefresh();
}

// ── PUBLIC API ───────────────────────────────────────────────

function getUpcomingEvents(symbol) {
  const sym = (symbol || '').toUpperCase();
  const currencies = SYM_CURRENCIES[sym] || ['USD'];
  const now = Date.now();
  const cutoff = now + 48 * 60 * 60 * 1000;
  return _calendar.filter(e => currencies.includes(e.currency) && e.scheduled_time > now && e.scheduled_time <= cutoff);
}

function getCalendarBias(symbol) {
  const sym = (symbol || '').toUpperCase();
  const currencies = SYM_CURRENCIES[sym] || ['USD'];
  const now = Date.now();
  const sixHoursAgo = now - 6 * 60 * 60 * 1000;
  const health = getCalendarHealth();
  /* [COREY-CALENDAR] Phase 2.7 — distinguish feeds-dead from no-recent-events.
     `available:false` tells downstream (Jane validity / Dark Horse) to reduce
     confidence rather than treat the absence of recent prints as calm. */
  if (!health.available) {
    return { bias: 'unavailable', adjustment: 0, events: [], available: false, reason: 'all calendar feeds failed' };
  }
  const recent = _calendar.filter(e =>
    currencies.includes(e.currency) && e.actual != null && e.scheduled_time >= sixHoursAgo && e.scheduled_time <= now
  );
  if (!recent.length) return { bias: 'neutral', adjustment: 0, events: [], available: true };
  let score = 0;
  for (const ev of recent) {
    if (ev.expected == null) continue;
    const act = parseFloat(ev.actual);
    const fc = parseFloat(ev.expected);
    if (isNaN(act) || isNaN(fc)) continue;
    const beat = act > fc ? 1 : act < fc ? -1 : 0;
    score += ev.impact === 'high' ? beat * 2 : beat;
  }
  const bias = score > 0 ? 'hawkish' : score < 0 ? 'dovish' : 'neutral';
  return { bias, adjustment: Math.min(1, Math.max(-1, score * 0.15)), events: recent, available: true };
}

// Plain-English describer for each tracked event type.
const EVENT_MEANING = {
  CPI: {
    whatIs: 'inflation data',
    whyMatters: 'Inflation prints move central bank expectations. A hot print delays rate cuts and supports the currency; a soft print does the opposite.',
    aboveMeaning: 'Inflation came in hotter than expected. This typically supports the currency by pushing rate-cut expectations out.',
    belowMeaning: 'Inflation came in cooler than expected. This typically weakens the currency by pulling rate-cut expectations forward.'
  },
  NFP: {
    whatIs: 'US labour-market data',
    whyMatters: 'Payrolls set the Fed\'s read on labour strength. Strong payrolls support the dollar; weak payrolls weaken it.',
    aboveMeaning: 'Jobs growth came in stronger than expected. This typically strengthens the dollar and pressures rate-cut hopes.',
    belowMeaning: 'Jobs growth came in weaker than expected. This typically weakens the dollar and revives rate-cut hopes.'
  },
  'Rate Decision': {
    whatIs: 'a central bank rate decision',
    whyMatters: 'Rate decisions set the entire policy path. The actual number matters; the forward guidance matters more.',
    aboveMeaning: 'A hawkish outcome (hike or tighter guidance) typically supports the currency.',
    belowMeaning: 'A dovish outcome (cut or easier guidance) typically weakens the currency.'
  },
  GDP: {
    whatIs: 'growth data',
    whyMatters: 'GDP anchors the growth outlook. Strong prints support growth-sensitive assets; weak prints support safe havens.',
    aboveMeaning: 'Growth came in stronger than expected. This typically supports the currency and growth-sensitive assets.',
    belowMeaning: 'Growth came in weaker than expected. This typically weakens the currency and supports safe havens.'
  },
  PMI: {
    whatIs: 'business-activity data',
    whyMatters: 'PMI is a leading indicator for growth. Readings above 50 suggest expansion; below 50, contraction.',
    aboveMeaning: 'Business activity came in stronger than expected. This typically supports the currency.',
    belowMeaning: 'Business activity came in weaker than expected. This typically weakens the currency.'
  },
  'CB Speaker': {
    whatIs: 'central bank commentary',
    whyMatters: 'Unscripted comments can shift the policy path by a single sentence. Risk is high and short-lived.',
    aboveMeaning: 'Hawkish commentary typically supports the currency on the margin.',
    belowMeaning: 'Dovish commentary typically weakens the currency on the margin.'
  }
};

function pipValueForCurrency(ccy) {
  if (ccy === 'JPY') return 8.0;
  return 10.0;
}

function getEventIntelligence(symbol) {
  /* [COREY-CALENDAR] Phase 2.7 — when both feeds are dead, return an explicit
     unavailable banner (truthy) rather than null. Returning null would let the
     index.js consumer fall through to the synthesised macro intel block,
     which silently presents calm conditions despite the feed outage. */
  const health = getCalendarHealth();
  if (!health.available) {
    const tv = _sourceHealth.tv, te = _sourceHealth.te, degraded = _sourceHealth.degraded;
    return [
      '**📅 ECONOMIC CALENDAR — FEEDS UNAVAILABLE**',
      '',
      '**WHAT IS HAPPENING**',
      'The economic calendar feeds are not responding right now. ATLAS cannot list scheduled catalysts for this window.',
      '',
      '**WHY IT MATTERS**',
      'Unknown catalysts are not the same as a calm session. An event you cannot see can still wipe out a trade that would otherwise work.',
      '',
      '**WHAT TO DO**',
      'Reduce conviction. Prefer smaller exposure or stand aside until the feeds recover.',
      '',
      '**WHEN THE IDEA IS INVALID**',
      'This warning clears once at least one feed returns healthy data. Re-read Event Intelligence before any new entry.',
      '',
      '**FEED HEALTH (diagnostics)**',
      `TradingView:       ${tv.status} (http:${tv.lastStatusCode || 'n/a'} content-type:${tv.lastContentType || 'n/a'}) — ${tv.lastError || 'unknown'}`,
      `Trading Economics: ${te.status} (http:${te.lastStatusCode || 'n/a'} content-type:${te.lastContentType || 'n/a'}) — ${te.lastError || 'unknown'}`,
      `Degraded fallback: ${degraded.status} (events:${degraded.lastCount || 0}) — ${degraded.lastError || (degraded.status === 'unknown' ? 'not yet fired' : 'n/a')}`
    ].join('\n');
  }
  const upcoming = getUpcomingEvents(symbol);
  const high = upcoming.filter(e => e.impact === 'high');
  if (!high.length) return null;
  const now = Date.now();
  const lines = ['**📅 ECONOMIC CALENDAR INTELLIGENCE**', ''];
  for (const ev of high.slice(0, 5)) {
    const type = matchEventType(ev.title);
    const reaction = type ? REACTIONS[type] : null;
    const pips = type ? EXPECTED_PIPS[type] : null;
    const meaning = type ? EVENT_MEANING[type] : null;
    const hoursUntil = ((ev.scheduled_time - now) / 3600000).toFixed(1);
    const fcStr = ev.expected != null ? `Forecast ${ev.expected}` : 'Forecast N/A';
    const prevStr = ev.previous != null ? `previous ${ev.previous}` : 'previous N/A';

    lines.push(`**EVENT — ${ev.title} (${ev.currency})**`);
    lines.push(`Time: ${new Date(ev.scheduled_time).toISOString().replace('T', ' ').slice(0, 16)} UTC — ${hoursUntil}h from now.`);
    lines.push(`${fcStr}, ${prevStr}.`);
    lines.push('');

    lines.push('**WHAT HAPPENED / WILL HAPPEN**');
    lines.push(meaning ? `${ev.currency} ${meaning.whatIs} is released.` : `A high-impact ${ev.currency} event is released.`);
    lines.push('');

    lines.push('**WHY MARKETS CARE**');
    lines.push(meaning ? meaning.whyMatters : 'High-impact events move cross-asset positioning and can override short-term structure in minutes.');
    lines.push('');

    if (reaction && reaction.above && reaction.below && meaning) {
      lines.push('**WHAT THIS MEANS FOR THE PAIR**');
      lines.push(`If the print beats expectations: ${meaning.aboveMeaning} Historically, ${ev.currency} moved in that direction ${reaction.above.pct}% of the time on a beat.`);
      lines.push(`If the print misses: ${meaning.belowMeaning} Historically, ${ev.currency} moved in the opposite direction ${reaction.below.pct}% of the time on a miss.`);
      lines.push('');
    } else if (reaction && reaction.hawkish && reaction.dovish) {
      lines.push('**WHAT THIS MEANS FOR THE PAIR**');
      lines.push(`Hawkish outcome: ${ev.currency} typically ${reaction.hawkish.dir} (${reaction.hawkish.pct}% historical).`);
      lines.push(`Dovish outcome: ${ev.currency} typically ${reaction.dovish.dir} (${reaction.dovish.pct}% historical).`);
      lines.push('');
    }

    if (pips) {
      const pipVal = pipValueForCurrency(ev.currency);
      const lowDollars = Math.round(pips[0] * pipVal);
      const highDollars = Math.round(pips[1] * pipVal);
      lines.push('**EXPECTED MOVE (dollar-first, per standard lot)**');
      lines.push(`Max impact: roughly $${lowDollars}–$${highDollars} per standard lot (distance context: ≈ ${pips[0]}–${pips[1]} pips).`);
      lines.push('Bracketed values show approximate distance context for reference only.');
      lines.push('');
    }

    lines.push('**TRADER ACTION — BEFORE / DURING / AFTER**');
    lines.push('Before: do not open new positions inside the 2 hours ahead of the release. Trail or reduce on existing setups.');
    lines.push('During: do not trade inside the first 5 minutes. Fills are poor, spreads widen, and the first move often reverses.');
    lines.push('After: wait for lower-timeframe structure to reform. Enter only when a fresh structural break confirms the post-release direction.');
    lines.push('');

    lines.push('**WHEN THE IDEA IS INVALID**');
    lines.push(`This read stops applying if the event is rescheduled, if the pair breaks structure before the print, or if any other Events & Catalysts threshold crosses first. Re-read Trade Status before the next entry.`);
    lines.push('');
  }
  return lines.join('\n');
}

function getNextHighImpact() {
  const now = Date.now();
  return _calendar.find(e => e.impact === 'high' && e.scheduled_time > now) || null;
}

/* [COREY-CALENDAR] Phase 2 A2a — public health surface. `available` is true
   iff at least one of tv / te / degraded reached status 'ok' or 'active'.
   Per Nathan's health rule, tv='nonproductive' (200 JSON with 0 events)
   does NOT count as available. No ff key in the surface — FF is gone. The
   'degraded' source is reserved for A2b's emergency fallback generator;
   until A2b lands its status stays 'unknown' and does not contribute. */
function getCalendarHealth() {
  const tv = _sourceHealth.tv, te = _sourceHealth.te, degraded = _sourceHealth.degraded;
  const isProductive = s => s.status === 'ok' || s.status === 'active';
  const available = _calendar.length > 0 && (
    (_sourceUsed === 'tradingview'       && isProductive(tv)) ||
    (_sourceUsed === 'trading_economics' && isProductive(te)) ||
    (_sourceUsed === 'degraded'          && isProductive(degraded))
  );
  return {
    available,
    source_used:   _sourceUsed,
    calendar_mode: _calendarMode,
    last_updated:  _lastRefresh ? new Date(_lastRefresh).toISOString() : null,
    lastUpdated:   _lastRefresh,                  // back-compat for existing consumers
    eventCount:    _calendar.length,
    source_health: {
      tv:       { ...tv },
      te:       { ...te },
      degraded: { ...degraded }
    }
  };
}

function getCalendarSnapshot() {
  return {
    events: _calendar.slice(),
    health: getCalendarHealth(),
    lastUpdated: _lastRefresh
  };
}

module.exports = {
  init,
  refreshCalendar,
  startAutoRefresh,
  getUpcomingEvents,
  getCalendarBias,
  getEventIntelligence,
  getNextHighImpact,
  getCalendarHealth,
  getCalendarSnapshot
};
