'use strict';
// ATLAS FX — EODHD enrichment adapter (read-only, env-gated).
//
// Provides realtime quotes, fundamentals, historical EOD, and an
// EODHD-ticker normaliser. Activated via process.env.EODHD_API_KEY.
// API key is never logged in plain text — only `key=present|missing`
// and the masked head/tail token form on boot.
//
// Boot probe: bootProbe() emits the required boot log lines:
//   [EODHD] enabled=<true|false> key=<present|missing>
//   [EODHD] token=<masked>
//   [EODHD] probe realtime AAPL.US status=<ok|error> price=<value>
//   [EODHD] probe realtime MU.US status=<ok|error> price=<value>
// The probe runs once at process start. It is non-fatal — any error
// is swallowed and logged; the bot continues to run with EODHD
// disabled if the probe fails.

const https = require('https');

function isEnabled() { return Boolean(process.env.EODHD_API_KEY); }

function maskToken() {
  const k = process.env.EODHD_API_KEY || '';
  if (!k) return 'absent';
  if (k.length <= 6) return 'masked';
  return 'masked (' + k.slice(0, 2) + '…' + k.slice(-2) + ')';
}

function _get(pathWithQuery, timeoutMs) {
  return new Promise((resolve) => {
    const key = process.env.EODHD_API_KEY;
    if (!key) return resolve({ ok: false, reason: 'EODHD_API_KEY not set' });
    const sep = pathWithQuery.includes('?') ? '&' : '?';
    const url = 'https://eodhd.com' + pathWithQuery + sep
              + 'api_token=' + encodeURIComponent(key) + '&fmt=json';
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, reason: 'invalid URL: ' + e.message }); }
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      timeout: timeoutMs || 8000,
      headers: { 'User-Agent': 'ATLAS-FX/4.0', 'Accept': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return resolve({ ok: false, reason: 'http ' + res.statusCode, statusCode: res.statusCode });
        }
        if (!/json/.test(ct)) {
          return resolve({ ok: false, reason: 'non-json content-type: ' + ct });
        }
        try { return resolve({ ok: true, data: JSON.parse(data), source: 'eodhd' }); }
        catch (e) { return resolve({ ok: false, reason: 'parse: ' + e.message }); }
      });
    });
    req.on('error', e => resolve({ ok: false, reason: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.end();
  });
}

// EODHD ticker convention: AAPL.US, MU.US, EURUSD.FOREX, GSPC.INDX, etc.
function eodhdTicker(symbol, assetClass) {
  if (!symbol) return null;
  const s = String(symbol).toUpperCase().trim();
  if (s.includes('.')) return s;
  const ac = String(assetClass || '').toLowerCase();
  if (ac === 'equity' || ac === 'stock') return s + '.US';
  if (ac === 'fx' || ac === 'forex' || ac === 'currency') {
    if (s.length === 6) return s + '.FOREX';
  }
  if (ac === 'index') return s + '.INDX';
  // default — assume US-listed equity.
  return s + '.US';
}

async function realtime(symbol, assetClass) {
  if (!isEnabled()) return { ok: false, reason: 'EODHD disabled (no key)' };
  const t = eodhdTicker(symbol, assetClass || 'equity');
  return await _get('/api/real-time/' + encodeURIComponent(t));
}

async function fundamentals(symbol, assetClass) {
  if (!isEnabled()) return { ok: false, reason: 'EODHD disabled (no key)' };
  const t = eodhdTicker(symbol, assetClass || 'equity');
  return await _get('/api/fundamentals/' + encodeURIComponent(t));
}

async function historical(symbol, assetClass, opts) {
  if (!isEnabled()) return { ok: false, reason: 'EODHD disabled (no key)' };
  opts = opts || {};
  const t = eodhdTicker(symbol, assetClass || 'equity');
  const period = opts.period || 'd';   // 'd' | 'w' | 'm'
  const from = opts.from ? '&from=' + encodeURIComponent(opts.from) : '';
  const to = opts.to ? '&to=' + encodeURIComponent(opts.to) : '';
  return await _get('/api/eod/' + encodeURIComponent(t) + '?period=' + period + from + to);
}

const EODHD_PERIOD_BY_RESOLUTION = Object.freeze({
  '1D': 'd',
  '1W': 'w',
});
const EODHD_INTRADAY_BY_RESOLUTION = Object.freeze({
  '60': '1h',
  '30': '30m',
  '15': '15m',
  '5': '5m',
  '1': '1m',
});

function _parseEodhdTime(row) {
  const raw = row && (row.datetime || row.date || row.timestamp);
  if (raw == null || raw === '') return null;
  if (Number.isFinite(raw)) return Number(raw) > 1000000000000 ? Math.floor(Number(raw) / 1000) : Number(raw);
  const s = String(raw);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? s + 'T00:00:00Z'
    : s.replace(' ', 'T') + (s.includes('T') || /Z$/.test(s) ? '' : 'Z');
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function _rowsToCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const time = _parseEodhdTime(row);
    const open = Number(row && row.open);
    const high = Number(row && row.high);
    const low = Number(row && row.low);
    const close = Number(row && row.close);
    const volume = row && row.volume != null ? Number(row.volume) : 0;
    return { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
  }).filter(c =>
    Number.isFinite(c.time) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close)
  ).sort((a, b) => a.time - b.time);
}

async function intraday(symbol, assetClass, opts) {
  if (!isEnabled()) return { ok: false, reason: 'EODHD disabled (no key)' };
  opts = opts || {};
  const t = opts.ticker || eodhdTicker(symbol, assetClass || 'equity');
  const interval = opts.interval || '1h';
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = opts.fromSec || (nowSec - 60 * 60 * 24 * 30);
  const toSec = opts.toSec || nowSec;
  return await _get(
    '/api/intraday/' + encodeURIComponent(t)
    + '?interval=' + encodeURIComponent(interval)
    + '&from=' + encodeURIComponent(String(fromSec))
    + '&to=' + encodeURIComponent(String(toSec))
  );
}

async function ohlc(symbol, assetClass, opts) {
  if (!isEnabled()) return { ok: false, reason: 'EODHD disabled (no key)' };
  opts = opts || {};
  const resolution = opts.resolution || '1D';
  const count = Number.isFinite(opts.count) ? opts.count : 200;
  const ticker = opts.ticker || eodhdTicker(symbol, assetClass || 'equity');
  let res;
  if (EODHD_PERIOD_BY_RESOLUTION[resolution]) {
    res = await historical(ticker, assetClass, {
      period: EODHD_PERIOD_BY_RESOLUTION[resolution],
      from: opts.from,
      to: opts.to,
    });
  } else if (EODHD_INTRADAY_BY_RESOLUTION[resolution]) {
    const secondsByResolution = {
      '60': 60 * 60,
      '30': 30 * 60,
      '15': 15 * 60,
      '5': 5 * 60,
      '1': 60,
    };
    const span = (secondsByResolution[resolution] || 60 * 60) * Math.max(count + 10, 60);
    const nowSec = Math.floor(Date.now() / 1000);
    res = await intraday(ticker, assetClass, {
      ticker,
      interval: EODHD_INTRADAY_BY_RESOLUTION[resolution],
      fromSec: opts.fromSec || (nowSec - span),
      toSec: opts.toSec || nowSec,
    });
  } else {
    return { ok: false, reason: 'EODHD unsupported resolution: ' + resolution };
  }
  if (!res || !res.ok) return res || { ok: false, reason: 'EODHD request failed' };
  const rows = Array.isArray(res.data) ? res.data
    : Array.isArray(res.data && res.data.data) ? res.data.data
    : [];
  const candles = _rowsToCandles(rows).slice(-count);
  if (!candles.length) return { ok: false, reason: 'EODHD no parseable candles', source: 'eodhd', ticker };
  return { ok: true, data: candles, source: 'eodhd', ticker };
}

// Single boot-time probe. Logs status for AAPL.US and MU.US — these are
// the symbols specified by the runtime spec. Failures do not throw.
async function bootProbe() {
  const enabled = isEnabled();
  console.log('[EODHD] enabled=' + (enabled ? 'true' : 'false') + ' key=' + (enabled ? 'present' : 'missing'));
  if (!enabled) {
    console.log('[EODHD] probe skipped — EODHD_API_KEY not set');
    return { enabled: false };
  }
  console.log('[EODHD] token=' + maskToken());
  const targets = [
    { sym: 'AAPL', ac: 'equity', label: 'AAPL.US' },
    { sym: 'MU',   ac: 'equity', label: 'MU.US' }
  ];
  const out = { enabled: true, probes: {} };
  for (const t of targets) {
    let r;
    try { r = await realtime(t.sym, t.ac); }
    catch (e) { r = { ok: false, reason: 'exception: ' + (e && e.message) }; }
    if (r && r.ok && r.data) {
      const price = r.data.close != null ? r.data.close
                  : r.data.last  != null ? r.data.last
                  : r.data.price != null ? r.data.price
                  : null;
      if (price != null) {
        console.log('[EODHD] probe realtime ' + t.label + ' status=ok price=' + price);
        out.probes[t.label] = { status: 'ok', price };
      } else {
        console.log('[EODHD] probe realtime ' + t.label + ' status=error reason=no_price_in_response');
        out.probes[t.label] = { status: 'error', reason: 'no_price_in_response' };
      }
    } else {
      const reason = (r && r.reason) || 'unknown';
      console.log('[EODHD] probe realtime ' + t.label + ' status=error reason=' + reason);
      out.probes[t.label] = { status: 'error', reason };
    }
  }
  return out;
}

module.exports = {
  isEnabled,
  eodhdTicker,
  realtime,
  fundamentals,
  historical,
  intraday,
  ohlc,
  bootProbe
};
