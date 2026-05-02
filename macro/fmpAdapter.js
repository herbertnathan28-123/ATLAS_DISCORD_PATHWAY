'use strict';
// FMP enrichment layer. Read-only. Env-gated by FMP_API_KEY (never logged, never hardcoded).
// Calendar middle-tier already lives in corey_calendar.js (source slot 'te'). This adapter only
// supplies quote + earnings enrichment for the macro pipeline; calendar is reused as-is.

const https = require('https');

function isEnabled() { return Boolean(process.env.FMP_API_KEY); }

function logBootStatus() {
  console.log(`[FMP] ${isEnabled() ? 'ENABLED' : 'DISABLED / missing'}`);
}

function get(pathWithQuery, timeout) {
  return new Promise((resolve) => {
    const key = process.env.FMP_API_KEY;
    if (!key) return resolve({ ok: false, reason: 'FMP_API_KEY not set' });
    const sep = pathWithQuery.includes('?') ? '&' : '?';
    const u = new URL(`https://financialmodelingprep.com${pathWithQuery}${sep}apikey=${encodeURIComponent(key)}`);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      timeout: timeout || 8000,
      headers: { 'User-Agent': 'ATLAS-FX/4.4', 'Accept': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (res.statusCode < 200 || res.statusCode >= 300) return resolve({ ok: false, reason: `http ${res.statusCode}` });
        if (!/json/.test(ct))                              return resolve({ ok: false, reason: `non-json ${ct}` });
        try { resolve({ ok: true, data: JSON.parse(data), source: 'fmp' }); }
        catch (e) { resolve({ ok: false, reason: 'parse: ' + e.message }); }
      });
    });
    req.on('error', e => resolve({ ok: false, reason: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.end();
  });
}

async function enrich(symbol) {
  if (!isEnabled()) {
    return { source_used: null, available: false, fallback_note: 'FMP disabled (no key)', quotes: {}, earnings: { ok: false, reason: 'disabled' } };
  }
  const [dxy, vix, oil, gold] = await Promise.all([
    get('/stable/quote?symbol=UUP'),
    get('/stable/quote?symbol=VXX'),
    get('/stable/quote?symbol=USOIL'),
    get('/stable/quote?symbol=XAUUSD')
  ]);
  const isEquity = /^[A-Z]{1,5}$/.test(symbol || '');
  const earnings = isEquity
    ? await get(`/stable/earnings-calendar?symbol=${encodeURIComponent(symbol)}`)
    : { ok: false, reason: 'n/a — fx/index symbol' };
  const anyQuote = dxy.ok || vix.ok || oil.ok || gold.ok;
  return {
    source_used: anyQuote ? 'fmp' : null,
    available: anyQuote,
    quotes: { dxy, vix, oil, gold },
    earnings,
    fallback_note: anyQuote ? null : 'FMP quotes degraded; falling back to coreyLive UUP/VXX scoring'
  };
}

module.exports = { isEnabled, logBootStatus, enrich };
