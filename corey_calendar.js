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
     'skipped'         — source gated off (te without TRADING_ECONOMICS_KEY)
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
    const filteredByImportance = list.filter(e => (e.importance || 0) >= 2);
    const postFilterCount = filteredByImportance.length;
    const events = filteredByImportance.map(e => normalizeEvent({
      source: 'tv',
      id: e.id != null ? `tv-${e.id}` : null,
      title: e.title || e.indicator || '',
      country: (e.country || '').toUpperCase(),
      currency: mapTVCountry(e.country),
      scheduled_time: new Date(e.date || e.time).getTime(),
      impact: e.importance >= 3 ? 'high' : 'medium',
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

// ── FEED 2: TRADING ECONOMICS (env-gated, optional fallback) ─
// Middle tier between TradingView (primary) and the degraded-mode
// internal cadence fallback. Activated only when process.env
// .TRADING_ECONOMICS_KEY is set. Free tier is email-only signup; no
// card required. When the key is unset, this path logs te:skipped
// and returns an empty array. Future env add activates the path
// with zero code change.
//
// Endpoint shape (per TE docs):
//   https://api.tradingeconomics.com/calendar?c=<KEY>
//     &country=united states,euro area,united kingdom,japan,...
//     &importance=2,3&format=json
// Response: top-level array of { Date, Country, Currency, Event,
//   Reference, Source, Actual, Previous, Forecast, Importance, ... }

const TE_COUNTRY_MAP = {
  US: 'united states', EU: 'euro area',     GB: 'united kingdom',
  JP: 'japan',         AU: 'australia',     CA: 'canada',
  CH: 'switzerland',   NZ: 'new zealand',   CN: 'china'
};
const TE_CCY_MAP = {
  'united states':   'USD', 'euro area':      'EUR',
  'united kingdom':  'GBP', 'japan':          'JPY',
  'australia':       'AUD', 'canada':         'CAD',
  'switzerland':     'CHF', 'new zealand':    'NZD',
  'china':           'CNY'
};

async function fetchTradingEconomics() {
  const key = process.env.TRADING_ECONOMICS_KEY;
  if (!key) {
    /* [COREY-CALENDAR] te skipped — no TRADING_ECONOMICS_KEY env var.
       The path is wired and validated; set the env var on Render to
       activate without any code change. */
    _sourceHealth.te.status = 'skipped';
    _sourceHealth.te.lastFetched = Date.now();
    _sourceHealth.te.lastCount = 0;
    _sourceHealth.te.lastError = 'TRADING_ECONOMICS_KEY not set';
    console.log('[COREY-CALENDAR] source=te status=skipped events=0 reason=TRADING_ECONOMICS_KEY not set');
    return [];
  }

  const countries = Object.values(TE_COUNTRY_MAP).join(',');
  const url = `https://api.tradingeconomics.com/calendar?c=${encodeURIComponent(key)}&country=${encodeURIComponent(countries)}&importance=2,3&format=json`;
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
      .map(e => {
        const t = e.Date ? Date.parse(e.Date) : NaN;
        const importance = Number(e.Importance || 0);
        const country = (e.Country || '').toLowerCase();
        const currency = e.Currency || TE_CCY_MAP[country] || 'USD';
        return normalizeEvent({
          source: 'te',
          id: e.CalendarId != null ? `te-${e.CalendarId}` : null,
          title: e.Event || '',
          country,
          currency,
          scheduled_time: isFinite(t) ? t : null,
          impact: importance >= 3 ? 'high' : importance >= 2 ? 'medium' : 'low',
          expected: e.Forecast != null && e.Forecast !== '' ? String(e.Forecast) : null,
          previous: e.Previous != null && e.Previous !== '' ? String(e.Previous) : null,
          actual:   e.Actual   != null && e.Actual   !== '' ? String(e.Actual)   : null,
          ticker:   e.Ticker || null,
          comment:  e.Reference || null
        });
      })
      .filter(e => e.scheduled_time != null && e.impact !== 'low');
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

// ── CACHE ────────────────────────────────────────────────────

let _calendar = [];
let _lastRefresh = 0;

function isActiveSession() {
  const h = new Date().getUTCHours();
  return (h >= 8 && h < 17) || (h >= 13 && h < 22);
}

async function refreshCalendar() {
  console.log('[COREY-CALENDAR] Refreshing...');
  try {
    /* [COREY-CALENDAR] A2a — FF dropped entirely. Primary = TV, middle tier =
       TE (env-gated; returns [] and logs 'te:skipped' when key unset). The
       degraded-mode fallback + source_used/calendar_mode logic lands in A2b —
       until then the refresh merges whichever of TV / TE produced events,
       and available is true iff either source is 'ok'. With the revised
       health rule, TV health='nonproductive' (200 JSON but 0 events) does
       NOT count as ok — so available will be false if TV returns 0 and TE
       is skipped, which is the honest state until A2b's degraded-mode
       generator lands. */
    const [tv, te] = await Promise.all([fetchTradingView(), fetchTradingEconomics()]);
    _calendar = deduplicateEvents(tv, te);
    _lastRefresh = Date.now();
    const tvH = _sourceHealth.tv, teH = _sourceHealth.te;
    console.log(`[COREY-CALENDAR] refresh summary tv=${tv.length}(${tvH.status}) te=${te.length}(${teH.status}) merged=${_calendar.length} available=${getCalendarHealth().available}`);
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
      `TradingView:       ${tv.status} (http:${tv.lastStatusCode || 'n/a'} content-type:${tv.lastContentType || 'n/a'}) — ${tv.lastError || 'unknown'}`,
      `Trading Economics: ${te.status} (http:${te.lastStatusCode || 'n/a'} content-type:${te.lastContentType || 'n/a'}) — ${te.lastError || 'unknown'}`,
      `Degraded fallback: ${degraded.status} (events:${degraded.lastCount || 0}) — ${degraded.lastError || (degraded.status === 'unknown' ? 'not yet fired' : 'n/a')}`,
      '',
      'Event intelligence cannot be computed for this window. Treat the absence of catalysts as unknown, not as a calm period — reduce conviction accordingly.'
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
    const hoursUntil = ((ev.scheduled_time - now) / 3600000).toFixed(1);
    const fcStr = ev.expected != null ? `Forecast: ${ev.expected}` : 'Forecast: N/A';
    const prevStr = ev.previous != null ? `Previous: ${ev.previous}` : 'Previous: N/A';
    lines.push(`**${ev.title}** (${ev.currency})`);
    lines.push(`Time: ${new Date(ev.scheduled_time).toISOString().replace('T', ' ').slice(0, 16)} UTC — ${hoursUntil}h from now`);
    lines.push(`${fcStr} | ${prevStr}`);
    if (reaction && reaction.above && reaction.below) {
      lines.push(`Historical: above forecast → ${ev.currency} ${reaction.above.dir} ${reaction.above.pct}% of the time | below → ${reaction.below.dir} ${reaction.below.pct}%`);
    }
    if (pips) {
      const pipVal = ev.currency === 'JPY' ? 8.0 : 10.0;
      lines.push(`Expected move: ${pips[0]}–${pips[1]} pips ($${(pips[0] * pipVal).toFixed(0)}–$${(pips[1] * pipVal).toFixed(0)} per standard lot)`);
    }
    lines.push(`Behaviour: price compression 2–4h before release, expansion on print, whipsaw risk first 5 minutes.`);
    lines.push(`Conclusion: ${ev.impact === 'high' ? 'Reduce size or stand aside until print clears. Do not enter new positions within 2 hours of release.' : 'Monitor but no action required.'}`);
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
  const available = isProductive(tv) || isProductive(te) || isProductive(degraded);
  return {
    available,
    lastUpdated: _lastRefresh,
    eventCount: _calendar.length,
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
