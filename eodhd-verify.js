'use strict';
// ATLAS FX — EODHD verification harness.
//
// Drives eodhdAdapter.js end-to-end: ticker normalisation, boot probe,
// realtime, fundamentals, and historical EOD. Prints a pass/fail
// summary and exits with code 0 on success, 1 on any failure.
//
// Usage:
//   EODHD_API_KEY=<key> node eodhd-verify.js
//
// Without EODHD_API_KEY the script still runs — it exercises the
// "disabled" code path and verifies graceful degradation, but skips
// the live HTTP probes.

const eodhd = require('./eodhdAdapter');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log('[verify] ' + tag + ' — ' + name + (detail ? ' :: ' + detail : ''));
}

function assertEq(name, actual, expected) {
  const ok = actual === expected;
  record(name, ok, ok ? String(actual) : 'expected=' + expected + ' actual=' + actual);
}

function checkTicker() {
  assertEq('ticker AAPL/equity → AAPL.US', eodhd.eodhdTicker('AAPL', 'equity'), 'AAPL.US');
  assertEq('ticker mu/stock → MU.US (uppercased)', eodhd.eodhdTicker('mu', 'stock'), 'MU.US');
  assertEq('ticker EURUSD/fx → EURUSD.FOREX', eodhd.eodhdTicker('EURUSD', 'fx'), 'EURUSD.FOREX');
  assertEq('ticker GSPC/index → GSPC.INDX', eodhd.eodhdTicker('GSPC', 'index'), 'GSPC.INDX');
  assertEq('ticker AAPL.US passthrough', eodhd.eodhdTicker('AAPL.US', 'equity'), 'AAPL.US');
  assertEq('ticker null → null', eodhd.eodhdTicker(null, 'equity'), null);
  assertEq('ticker bare symbol default → .US', eodhd.eodhdTicker('TSLA'), 'TSLA.US');
}

function describeResponse(r) {
  if (!r) return 'no response';
  if (r.ok) return 'ok';
  return 'reason=' + (r.reason || 'unknown');
}

function priceFrom(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.close != null) return data.close;
  if (data.last  != null) return data.last;
  if (data.price != null) return data.price;
  return null;
}

async function runLive() {
  const probe = await eodhd.bootProbe();
  record('bootProbe returned object', probe && typeof probe === 'object',
         probe && probe.enabled ? 'enabled' : 'disabled');

  const rt = await eodhd.realtime('AAPL', 'equity');
  if (rt && rt.ok) {
    const p = priceFrom(rt.data);
    record('realtime AAPL.US ok + price', p != null,
           p != null ? 'price=' + p : 'no price field in payload');
  } else {
    record('realtime AAPL.US ok', false, describeResponse(rt));
  }

  const rt2 = await eodhd.realtime('MU', 'equity');
  if (rt2 && rt2.ok) {
    const p = priceFrom(rt2.data);
    record('realtime MU.US ok + price', p != null,
           p != null ? 'price=' + p : 'no price field in payload');
  } else {
    record('realtime MU.US ok', false, describeResponse(rt2));
  }

  const fx = await eodhd.realtime('EURUSD', 'fx');
  record('realtime EURUSD.FOREX ok', fx && fx.ok, describeResponse(fx));

  const fund = await eodhd.fundamentals('AAPL', 'equity');
  if (fund && fund.ok) {
    const d = fund.data || {};
    const hasGeneral = d.General && typeof d.General === 'object';
    record('fundamentals AAPL.US has General block', hasGeneral,
           hasGeneral ? ('code=' + (d.General.Code || '?')) : 'missing General');
  } else {
    record('fundamentals AAPL.US ok', false, describeResponse(fund));
  }

  const today = new Date();
  const from = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const hist = await eodhd.historical('AAPL', 'equity', { from: fmt(from), to: fmt(today) });
  if (hist && hist.ok) {
    const arr = Array.isArray(hist.data) ? hist.data : [];
    record('historical AAPL.US returns rows', arr.length > 0,
           'rows=' + arr.length);
  } else {
    record('historical AAPL.US ok', false, describeResponse(hist));
  }
}

async function runDisabled() {
  console.log('[verify] EODHD_API_KEY not set — running disabled-path checks only');
  const rt = await eodhd.realtime('AAPL', 'equity');
  record('disabled realtime returns ok=false', rt && rt.ok === false, describeResponse(rt));
  const fund = await eodhd.fundamentals('AAPL', 'equity');
  record('disabled fundamentals returns ok=false', fund && fund.ok === false, describeResponse(fund));
  const hist = await eodhd.historical('AAPL', 'equity');
  record('disabled historical returns ok=false', hist && hist.ok === false, describeResponse(hist));
  const probe = await eodhd.bootProbe();
  record('disabled bootProbe returns {enabled:false}', probe && probe.enabled === false,
         'enabled=' + (probe && probe.enabled));
}

(async () => {
  console.log('[verify] EODHD adapter verification — ' + new Date().toISOString());
  console.log('[verify] enabled=' + eodhd.isEnabled());

  checkTicker();

  if (eodhd.isEnabled()) {
    await runLive();
  } else {
    await runDisabled();
  }

  const failed = results.filter(r => !r.ok);
  const passed = results.length - failed.length;
  console.log('');
  console.log('[verify] ──────────────────────────────────────');
  console.log('[verify] total=' + results.length + ' pass=' + passed + ' fail=' + failed.length);
  if (failed.length) {
    for (const f of failed) console.log('[verify]   FAIL — ' + f.name + (f.detail ? ' :: ' + f.detail : ''));
  }
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('[verify] FATAL — ' + (e && e.stack || e));
  process.exit(2);
});
