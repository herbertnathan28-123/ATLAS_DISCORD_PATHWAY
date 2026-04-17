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

/* [COREY-CALENDAR] Per-source health surface. Updated by every fetch attempt;
   read by getCalendarHealth() and the *available* flag on bias/intel returns.
   status: 'unknown' (boot) | 'ok' | 'failed'. */
const _sourceHealth = {
  tv: { status: 'unknown', lastFetched: 0, lastCount: 0, lastError: null, lastStatusCode: null, lastContentType: null },
  ff: { status: 'unknown', lastFetched: 0, lastCount: 0, lastError: null, lastStatusCode: null, lastContentType: null }
};

function markSourceFailed(source, reason, statusCode, contentType) {
  _sourceHealth[source].status = 'failed';
  _sourceHealth[source].lastFetched = Date.now();
  _sourceHealth[source].lastCount = 0;
  _sourceHealth[source].lastError = reason;
  _sourceHealth[source].lastStatusCode = statusCode || null;
  _sourceHealth[source].lastContentType = contentType || null;
  console.error(`[COREY-CALENDAR] source ${source} FAILED status:${statusCode || 'n/a'} content-type:${contentType || 'n/a'} reason:${reason}`);
}

function markSourceOk(source, count, statusCode, contentType) {
  _sourceHealth[source].status = 'ok';
  _sourceHealth[source].lastFetched = Date.now();
  _sourceHealth[source].lastCount = count;
  _sourceHealth[source].lastError = null;
  _sourceHealth[source].lastStatusCode = statusCode || 200;
  _sourceHealth[source].lastContentType = contentType || null;
  console.log(`[COREY-CALENDAR] source ${source} OK status:${statusCode} content-type:${contentType} count:${count}`);
}

// ── FEED 1: TRADINGVIEW ECONOMIC CALENDAR ────────────────────

async function fetchTradingView() {
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  /* [COREY-CALENDAR] Phase 2 A1 — TradingView JSON endpoint is usable only
     when the Origin header is set to a TradingView sub-domain. Without it the
     endpoint serves the Cloudflare HTML block page, which was the root cause
     of the prior "Unexpected token '<'" parse failure. CN added to the country
     set per revised source order. TV remains UNOFFICIAL — observed behaviour,
     not a public contract — so all the existing hard validation stays. */
  const url = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=US,EU,GB,JP,AU,CA,CH,NZ,CN`;
  let status = null, contentType = null;
  try {
    const resp = await httpGet(url, 12000, { 'Origin': 'https://in.tradingview.com' });
    status = resp.status;
    contentType = resp.contentType;
    /* [COREY-CALENDAR] hard response-type validation per Phase 2.2 / 2.3.
       Refuse to parse anything that is not a 2xx JSON response. The previous
       code blindly fed HTML / 4xx text into JSON.parse. */
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
    const events = list
      .filter(e => (e.importance || 0) >= 2)
      .map(e => normalizeEvent({
        source: 'tv',
        title: e.title || e.indicator || '',
        currency: mapTVCountry(e.country),
        scheduled_time: new Date(e.date || e.time).getTime(),
        impact: e.importance >= 3 ? 'high' : 'medium',
        expected: e.forecast != null ? String(e.forecast) : null,
        previous: e.previous != null ? String(e.previous) : null,
        actual:   e.actual   != null ? String(e.actual)   : null
      }));
    markSourceOk('tv', events.length, status, contentType);
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

// ── FEED 2: FOREX FACTORY (JSON via faireconomy.media) ───────
// The legacy ff_calendar_thisweek.xml endpoint at forexfactory.com is defunct
// (returned 0 events for weeks per production logs). The JSON feed at
// nfs.faireconomy.media/ff_calendar_thisweek.json is the canonical free
// retail FF calendar feed and is the same one the dashboard frontend
// (echarts.min.js/data-feed.js) already consumes successfully.

async function fetchForexFactory() {
  const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  let status = null, contentType = null;
  try {
    const resp = await httpGet(url);
    status = resp.status;
    contentType = resp.contentType;
    if (status < 200 || status >= 300) {
      markSourceFailed('ff', `non-2xx status: ${status}`, status, contentType);
      return [];
    }
    /* [COREY-CALENDAR] FF JSON feed sometimes serves application/octet-stream
       or text/plain depending on edge cache. Accept any of those if the body
       parses as a JSON array — but reject HTML outright. */
    if (/text\/html/i.test(contentType || '')) {
      const preview = (resp.body || '').slice(0, 80).replace(/\s+/g, ' ');
      markSourceFailed('ff', `HTML content-type — body preview: ${preview}`, status, contentType);
      return [];
    }
    let raw;
    try { raw = JSON.parse(resp.body); }
    catch (parseErr) {
      const preview = (resp.body || '').slice(0, 80).replace(/\s+/g, ' ');
      markSourceFailed('ff', `JSON parse error: ${parseErr.message} — body preview: ${preview}`, status, contentType);
      return [];
    }
    if (!Array.isArray(raw)) {
      markSourceFailed('ff', 'response shape unexpected — top level is not an array', status, contentType);
      return [];
    }
    const events = raw
      .filter(e => e && (e.impact === 'High' || e.impact === 'Medium'))
      .map(e => {
        const t = e.date ? Date.parse(e.date) : NaN;
        return normalizeEvent({
          source: 'ff',
          title: e.title || '',
          currency: (e.country || 'USD').toUpperCase(),
          scheduled_time: isFinite(t) ? t : null,
          impact: e.impact === 'High' ? 'high' : 'medium',
          expected: (e.forecast != null && e.forecast !== '') ? String(e.forecast) : null,
          previous: (e.previous != null && e.previous !== '') ? String(e.previous) : null,
          actual:   null
        });
      })
      .filter(e => e.scheduled_time != null);
    markSourceOk('ff', events.length, status, contentType);
    return events;
  } catch (e) {
    markSourceFailed('ff', e.message || String(e), status, contentType);
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
    /* spec 2.5 canonical fields */
    title: e.title || '',
    currency: e.currency || 'USD',
    impact: e.impact,
    scheduled_time: e.scheduled_time,
    expected: e.expected != null ? e.expected : null,
    previous: e.previous != null ? e.previous : null,
    source: e.source,
    directional_bias_note,
    volatility_note,
    /* operational field — kept outside the spec list because consumers need it */
    actual: e.actual != null ? e.actual : null,
    /* back-compat aliases (legacy field names used by getCalendarBias et al) */
    time: e.scheduled_time,
    importance: e.impact,
    forecast: e.expected != null ? e.expected : null
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
    const [tv, ff] = await Promise.all([fetchTradingView(), fetchForexFactory()]);
    _calendar = deduplicateEvents(tv, ff);
    _lastRefresh = Date.now();
    /* [COREY-CALENDAR] Phase 2.6 — explicit per-source health line so the
       refresh log distinguishes "feed dead" from "feed alive but quiet". */
    const tvH = _sourceHealth.tv, ffH = _sourceHealth.ff;
    console.log(`[COREY-CALENDAR] Loaded ${_calendar.length} events | TV:${tv.length}(${tvH.status}) FF:${ff.length}(${ffH.status}) | available:${getCalendarHealth().available}`);
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
    const tv = _sourceHealth.tv, ff = _sourceHealth.ff;
    return [
      '**📅 ECONOMIC CALENDAR — FEEDS UNAVAILABLE**',
      '',
      `TradingView: ${tv.status} (status:${tv.lastStatusCode || 'n/a'} content-type:${tv.lastContentType || 'n/a'}) — ${tv.lastError || 'unknown'}`,
      `ForexFactory: ${ff.status} (status:${ff.lastStatusCode || 'n/a'} content-type:${ff.lastContentType || 'n/a'}) — ${ff.lastError || 'unknown'}`,
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

/* [COREY-CALENDAR] Phase 2.6 / 2.7 — public health surface. `available` is
   true iff at least one source has an `ok` status from its last fetch. The
   shape mirrors the spec: events[] (full current cache), source health, last
   updated timestamp. Downstream consumers (Jane validity, Dark Horse) check
   `available` and `sources` to gate their own outputs. */
function getCalendarHealth() {
  const tv = _sourceHealth.tv, ff = _sourceHealth.ff;
  const available = tv.status === 'ok' || ff.status === 'ok';
  return {
    available,
    lastUpdated: _lastRefresh,
    eventCount: _calendar.length,
    sources: {
      tv: { ...tv },
      ff: { ...ff }
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
