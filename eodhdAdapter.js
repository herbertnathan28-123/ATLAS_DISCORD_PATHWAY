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
  bootProbe
};
