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

function httpGet(urlStr, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', timeout, headers: { 'User-Agent': 'ATLAS-FX/4.0' } }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── FEED 1: TRADINGVIEW ECONOMIC CALENDAR ────────────────────

async function fetchTradingView() {
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const url = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=US,EU,GB,JP,AU,NZ,CA,CH`;
  try {
    const { body } = await httpGet(url);
    const raw = JSON.parse(body);
    if (!Array.isArray(raw.result || raw)) return [];
    const events = (raw.result || raw);
    return events
      .filter(e => (e.importance || 0) >= 2)
      .map(e => ({
        source: 'tv',
        title: e.title || e.indicator || '',
        currency: mapTVCountry(e.country),
        time: new Date(e.date || e.time).getTime(),
        importance: e.importance >= 3 ? 'high' : 'medium',
        forecast: e.forecast != null ? String(e.forecast) : null,
        previous: e.previous != null ? String(e.previous) : null,
        actual: e.actual != null ? String(e.actual) : null,
      }));
  } catch (e) {
    console.error('[COREY-CALENDAR] TradingView fetch failed:', e.message);
    return [];
  }
}

function mapTVCountry(c) {
  const m = { US: 'USD', EU: 'EUR', GB: 'GBP', JP: 'JPY', AU: 'AUD', NZ: 'NZD', CA: 'CAD', CH: 'CHF' };
  return m[(c || '').toUpperCase()] || 'USD';
}

// ── FEED 2: FOREX FACTORY RSS ────────────────────────────────

async function fetchForexFactory() {
  try {
    const { body } = await httpGet('https://www.forexfactory.com/ff_calendar_thisweek.xml');
    return parseFFXml(body);
  } catch (e) {
    console.error('[COREY-CALENDAR] ForexFactory fetch failed:', e.message);
    return [];
  }
}

function parseFFXml(xml) {
  const events = [];
  const items = xml.split('<event>').slice(1);
  for (const item of items) {
    const tag = (name) => { const m = item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? m[1].trim() : ''; };
    const impact = tag('impact');
    if (impact !== 'High' && impact !== 'Medium') continue;
    const dateStr = tag('date') + ' ' + tag('time');
    let time = new Date(dateStr).getTime();
    if (isNaN(time)) time = Date.now();
    events.push({
      source: 'ff',
      title: tag('title'),
      currency: tag('country').toUpperCase() || 'USD',
      time,
      importance: impact === 'High' ? 'high' : 'medium',
      forecast: tag('forecast') || null,
      previous: tag('previous') || null,
      actual: null,
    });
  }
  return events;
}

// ── MERGE + DEDUP ────────────────────────────────────────────

function deduplicateEvents(a, b) {
  const merged = [...a];
  const WINDOW_MS = 60 * 60 * 1000;
  for (const ev of b) {
    const dup = merged.some(m =>
      m.currency === ev.currency &&
      normaliseTitle(m.title) === normaliseTitle(ev.title) &&
      Math.abs(m.time - ev.time) < WINDOW_MS
    );
    if (!dup) merged.push(ev);
  }
  merged.sort((x, y) => x.time - y.time);
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
    console.log(`[COREY-CALENDAR] Loaded ${_calendar.length} events | TV:${tv.length} FF:${ff.length}`);
  } catch (e) {
    console.error('[COREY-CALENDAR] Refresh error:', e.message);
  }
}

function startAutoRefresh() {
  const tick = async () => {
    const interval = isActiveSession() ? 15 * 60 * 1000 : 60 * 60 * 1000;
    await refreshCalendar();
    setTimeout(tick, interval);
  };
  tick();
}

// ── PUBLIC API ───────────────────────────────────────────────

function getUpcomingEvents(symbol) {
  const sym = (symbol || '').toUpperCase();
  const currencies = SYM_CURRENCIES[sym] || ['USD'];
  const now = Date.now();
  const cutoff = now + 48 * 60 * 60 * 1000;
  return _calendar.filter(e => currencies.includes(e.currency) && e.time > now && e.time <= cutoff);
}

function getCalendarBias(symbol) {
  const sym = (symbol || '').toUpperCase();
  const currencies = SYM_CURRENCIES[sym] || ['USD'];
  const now = Date.now();
  const sixHoursAgo = now - 6 * 60 * 60 * 1000;
  const recent = _calendar.filter(e =>
    currencies.includes(e.currency) && e.actual != null && e.time >= sixHoursAgo && e.time <= now
  );
  if (!recent.length) return { bias: 'neutral', adjustment: 0, events: [] };
  let score = 0;
  for (const ev of recent) {
    if (ev.forecast == null) continue;
    const act = parseFloat(ev.actual);
    const fc = parseFloat(ev.forecast);
    if (isNaN(act) || isNaN(fc)) continue;
    const beat = act > fc ? 1 : act < fc ? -1 : 0;
    score += ev.importance === 'high' ? beat * 2 : beat;
  }
  const bias = score > 0 ? 'hawkish' : score < 0 ? 'dovish' : 'neutral';
  return { bias, adjustment: Math.min(1, Math.max(-1, score * 0.15)), events: recent };
}

function getEventIntelligence(symbol) {
  const upcoming = getUpcomingEvents(symbol);
  const high = upcoming.filter(e => e.importance === 'high');
  if (!high.length) return null;
  const now = Date.now();
  const lines = ['**📅 ECONOMIC CALENDAR INTELLIGENCE**', ''];
  for (const ev of high.slice(0, 5)) {
    const type = matchEventType(ev.title);
    const reaction = type ? REACTIONS[type] : null;
    const pips = type ? EXPECTED_PIPS[type] : null;
    const hoursUntil = ((ev.time - now) / 3600000).toFixed(1);
    const fcStr = ev.forecast != null ? `Forecast: ${ev.forecast}` : 'Forecast: N/A';
    const prevStr = ev.previous != null ? `Previous: ${ev.previous}` : 'Previous: N/A';
    lines.push(`**${ev.title}** (${ev.currency})`);
    lines.push(`Time: ${new Date(ev.time).toISOString().replace('T', ' ').slice(0, 16)} UTC — ${hoursUntil}h from now`);
    lines.push(`${fcStr} | ${prevStr}`);
    if (reaction) {
      lines.push(`Historical: above forecast → ${ev.currency} ${reaction.above.dir} ${reaction.above.pct}% of the time | below → ${reaction.below.dir} ${reaction.below.pct}%`);
    }
    if (pips) {
      const pipVal = ev.currency === 'JPY' ? 8.0 : 10.0;
      lines.push(`Expected move: ${pips[0]}–${pips[1]} pips ($${(pips[0] * pipVal).toFixed(0)}–$${(pips[1] * pipVal).toFixed(0)} per standard lot)`);
    }
    lines.push(`Behaviour: price compression 2–4h before release, expansion on print, whipsaw risk first 5 minutes.`);
    lines.push(`Conclusion: ${ev.importance === 'high' ? 'Reduce size or stand aside until print clears. Do not enter new positions within 2 hours of release.' : 'Monitor but no action required.'}`);
    lines.push('');
  }
  return lines.join('\n');
}

function getNextHighImpact() {
  const now = Date.now();
  return _calendar.find(e => e.importance === 'high' && e.time > now) || null;
}

module.exports = {
  refreshCalendar,
  startAutoRefresh,
  getUpcomingEvents,
  getCalendarBias,
  getEventIntelligence,
  getNextHighImpact
};
