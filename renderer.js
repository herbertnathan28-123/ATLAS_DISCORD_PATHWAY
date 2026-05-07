'use strict';
const https = require('https');
const sharp = require('sharp');

const CHART_W = 1920;
const CHART_H = 1080;

const COLOR_UP = '#26A69A';
const COLOR_DN = '#EF5350';
const COLOR_BG = '#000000';

const HTF_INTERVALS = ['1W', '1D', '240', '60'];
const LTF_INTERVALS = ['30', '15', '5', '1'];

const TF_LABELS = {
  '1W': 'Weekly', '1D': 'Daily', '240': '4H', '60': '1H',
  '30': '30M', '15': '15M', '5': '5M', '1': '1M'
};

const CI_INTERVAL_MAP = {
  '1W': '1W', '1D': '1D', '240': '4h', '60': '1h',
  '30': '30m', '15': '15m', '5': '5m', '1': '1m'
};

const CHART_IMG_API_KEY = process.env.CHART_IMG_API_KEY || null;
// Controlled-concurrency for the 8 chart-img REST calls per analyse run.
// Live baseline (serial) is ~33s. With concurrency=4 we expect 2 batches of
// 4 calls (~8-12s total). Going higher than 4 risks tripping chart-img
// rate limits — failed panels would then fall back to placeholders, which
// looks like a regression even though it's a configuration issue. The env
// var is provided so an operator can tune downstream of the deploy
// without code changes.
const CHART_IMG_CONCURRENCY = (function(){
  const raw = parseInt(process.env.CHART_IMG_CONCURRENCY || '4', 10);
  if (!Number.isFinite(raw) || raw < 1) return 4;
  return Math.min(raw, 8);
})();

function getCISymbol(symbol) {
  const overrides = {
    XAUUSD: 'OANDA:XAUUSD', XAGUSD: 'OANDA:XAGUSD',
    BCOUSD: 'OANDA:BCOUSD', USOIL:  'OANDA:BCOUSD',
    NAS100: 'OANDA:NAS100USD', US500: 'OANDA:SPX500USD',
    US30:   'OANDA:US30USD',
    EURUSD: 'OANDA:EURUSD', GBPUSD: 'OANDA:GBPUSD',
    USDJPY: 'OANDA:USDJPY', AUDUSD: 'OANDA:AUDUSD',
    AUDJPY: 'OANDA:AUDJPY', GBPJPY: 'OANDA:GBPJPY',
    USDCAD: 'OANDA:USDCAD', USDCHF: 'OANDA:USDCHF',
    NZDUSD: 'OANDA:NZDUSD',
    MICRON: 'NASDAQ:MU', AMD: 'NASDAQ:AMD',
    NVDA:   'NASDAQ:NVDA', ASML: 'NASDAQ:ASML'
  };
  if (overrides[symbol]) return overrides[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;
  return `NASDAQ:${symbol}`;
}

async function fetchChartImage(symbol, iv) {
  if (!CHART_IMG_API_KEY) throw new Error('CHART_IMG_API_KEY not set');
  const ciSym = getCISymbol(symbol);
  console.log(`[SYMBOL-TRACE] providerSymbol input=${symbol} interval=${iv} mapped=${ciSym}`);
  const ciInt = CI_INTERVAL_MAP[iv] || '1D';
  const payload = JSON.stringify({
    symbol: ciSym, interval: ciInt, theme: 'dark', style: 'candle',
    width: CHART_W, height: CHART_H, timezone: 'Australia/Perth',
    backgroundColor: COLOR_BG, hideControls: true, zoom: 2.2, padding: 0,
    overrides: {
      'paneProperties.background': COLOR_BG,
      'paneProperties.backgroundType': 'solid',
      'paneProperties.vertGridProperties.color': 'rgba(255,255,255,0.02)',
      'paneProperties.horzGridProperties.color': 'rgba(255,255,255,0.02)',
      'paneProperties.legendProperties.showSeriesTitle': true,
      'paneProperties.legendProperties.showSeriesOHLC': true,
      'paneProperties.legendProperties.showLegend': true,
      'scalesProperties.backgroundColor': COLOR_BG,
      'scalesProperties.textColor': '#9aa4ad',
      'scalesProperties.lineColor': 'rgba(255,255,255,0.15)',
      'scalesProperties.fontSize': 12,
      'symbolWatermarkProperties.transparency': 100,
      'mainSeriesProperties.candleStyle.upColor': COLOR_UP,
      'mainSeriesProperties.candleStyle.downColor': COLOR_DN,
      'mainSeriesProperties.candleStyle.borderUpColor': COLOR_UP,
      'mainSeriesProperties.candleStyle.borderDownColor': COLOR_DN,
      'mainSeriesProperties.candleStyle.wickUpColor': COLOR_UP,
      'mainSeriesProperties.candleStyle.wickDownColor': COLOR_DN,
      'mainSeriesProperties.candleStyle.drawWick': true,
      'mainSeriesProperties.candleStyle.drawBorder': true,
      'mainSeriesProperties.showPriceLine': false
    },
    studies: []
  });
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.chart-img.com',
      path: '/v2/tradingview/advanced-chart',
      method: 'POST',
      headers: {
        'x-api-key': CHART_IMG_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'ATLAS-FX/4.3.0'
      },
      timeout: 60000
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const body = Buffer.concat(chunks).toString();
          reject(new Error(`chart-img ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('chart-img timeout')));
    req.write(payload);
    req.end();
  });
}

async function makePlaceholder(sym, tfKey, reason) {
  const r2 = (reason || 'NO DATA').slice(0, 60);
  const svg = `<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${CHART_W}" height="${CHART_H}" fill="${COLOR_BG}"/>`
    + `<text x="${CHART_W/2}" y="${CHART_H/2-30}" font-family="monospace" font-size="48" fill="#222222" text-anchor="middle">${sym} ${tfKey}</text>`
    + `<text x="${CHART_W/2}" y="${CHART_H/2+30}" font-family="monospace" font-size="28" fill="#181818" text-anchor="middle">${r2}</text>`
    + `</svg>`;
  return sharp(Buffer.from(svg)).resize(CHART_W, CHART_H).png().toBuffer();
}

async function buildGrid(panels, tfKeys) {
  const resized = await Promise.all(panels.map(async (img, i) => {
    const base = await sharp(img).resize(CHART_W, CHART_H, { fit: 'fill' }).png().toBuffer();
    const key = tfKeys && tfKeys[i] ? tfKeys[i] : '';
    const label = key ? (TF_LABELS[key] || key) : '';
    if (!label) return base;
    const lw = label.length * 12 + 20;
    const labelSvg = `<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg">`
      + `<rect x="8" y="8" width="${lw}" height="26" fill="${COLOR_BG}"/>`
      + `<text x="18" y="27" font-family="monospace" font-size="15" font-weight="bold" fill="#888888">${label}</text>`
      + `</svg>`;
    return sharp(base).composite([{ input: Buffer.from(labelSvg), top: 0, left: 0 }]).png().toBuffer();
  }));
  const gw = CHART_W * 2, gh = CHART_H * 2;
  const divSvg = `<svg width="${gw}" height="${gh}" xmlns="http://www.w3.org/2000/svg">`
    + `<line x1="${CHART_W}" y1="0" x2="${CHART_W}" y2="${gh}" stroke="#1A1A1A" stroke-width="2"/>`
    + `<line x1="0" y1="${CHART_H}" x2="${gw}" y2="${CHART_H}" stroke="#1A1A1A" stroke-width="2"/>`
    + `</svg>`;
  return sharp({ create: { width: gw, height: gh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([
      { input: resized[0], left: 0,       top: 0       },
      { input: resized[1], left: CHART_W, top: 0       },
      { input: resized[2], left: 0,       top: CHART_H },
      { input: resized[3], left: CHART_W,  top: CHART_H },
      { input: Buffer.from(divSvg), left: 0, top: 0 }
    ])
    .png({ compressionLevel: 6 })
    .toBuffer();
}

async function validateCapture(buf) {
  if (!buf || !buf.length) return { ok: false, reason: 'no_buffer' };
  if (buf.length < 5 * 1024) return { ok: false, reason: 'buffer_too_small_' + buf.length + 'B' };
  try {
    const scanH = Math.max(1, Math.round(CHART_H * 0.4));
    const px = await sharp(buf)
      .extract({ left: 0, top: 0, width: CHART_W, height: scanH })
      .raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const data = px.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      if ((g > 100 && r < 150 && b < 150) || (r > 100 && g < 150 && b < 150)) {
        return { ok: true };
      }
    }
    return { ok: false, reason: 'no_candle_pixels' };
  } catch (e) {
    return { ok: false, reason: 'pixel_scan_error:' + e.message };
  }
}

async function renderOneChart(symbol, interval) {
  const tfKey = TF_LABELS[interval] || interval;
  try {
    const buf = await fetchChartImage(symbol, interval);
    const v = await validateCapture(buf);
    if (!v.ok) {
      console.log(`[CHART] ${symbol} ${interval} validation=fail reason=${v.reason}`);
      return { buffer: await makePlaceholder(symbol, tfKey, v.reason), valid: false, reason: v.reason };
    }
    console.log(`[CHART] ${symbol} ${interval} validation=pass`);
    return { buffer: buf, valid: true };
  } catch (e) {
    const reason = (e && e.message) ? e.message : 'unknown_error';
    console.log(`[CHART] ${symbol} ${interval} validation=fail reason=${reason}`);
    return { buffer: await makePlaceholder(symbol, tfKey, reason), valid: false, reason };
  }
}

// Run `fn(item, idx)` over `items` with at most `concurrency` jobs in flight
// at any time. Order of `results` matches input order (not completion order).
// Each worker pulls the next index off a shared counter — simple & robust.
//
// We use this instead of a flat `Promise.all(items.map(fn))` so we can cap
// the number of concurrent chart-img REST requests. Going fully parallel
// risks tripping chart-img rate limits, which would degrade panels to
// placeholders and look like a regression. Default cap is 4 (see
// CHART_IMG_CONCURRENCY); operator-tunable via env without code changes.
async function withConcurrency(items, fn, concurrency) {
  const n = items.length;
  const results = new Array(n);
  const workers = Math.max(1, Math.min(Number(concurrency) || 1, n));
  let next = 0;
  async function pull() {
    while (true) {
      const idx = next++;
      if (idx >= n) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const tasks = [];
  for (let i = 0; i < workers; i++) tasks.push(pull());
  await Promise.all(tasks);
  return results;
}

async function renderAllPanels(symbol) {
  const sym = String(symbol || 'UNKNOWN').toUpperCase();
  const allIntervals = HTF_INTERVALS.concat(LTF_INTERVALS);
  const t0 = Date.now();
  console.log(`[RENDERER] ${sym} render_start path=chart-img concurrency=${CHART_IMG_CONCURRENCY} panels=${allIntervals.length}`);

  // Parallelised per-timeframe fetch — controlled concurrency. Each worker
  // logs timeframe_start / timeframe_complete with ms timing so the live
  // log gives ground-truth per-pane evidence (not just total elapsed).
  const allPanels = await withConcurrency(allIntervals, async function(iv, idx) {
    const tfT0 = Date.now();
    console.log(`[RENDERER] ${sym} timeframe_start tf=${iv} idx=${idx + 1}/${allIntervals.length}`);
    const result = await renderOneChart(sym, iv);
    const tfElapsed = Date.now() - tfT0;
    console.log(`[RENDERER] ${sym} timeframe_complete tf=${iv} idx=${idx + 1}/${allIntervals.length} elapsed_ms=${tfElapsed} valid=${result.valid}${result.valid ? '' : ' reason=' + (result.reason || 'unknown')}`);
    return result;
  }, CHART_IMG_CONCURRENCY);

  const htfPanels = allPanels.slice(0, 4);
  const ltfPanels = allPanels.slice(4, 8);

  const tCompose = Date.now();
  console.log(`[RENDERER] ${sym} grid_compose_start`);
  const grids = await Promise.all([
    buildGrid(htfPanels.map(p => p.buffer), HTF_INTERVALS),
    buildGrid(ltfPanels.map(p => p.buffer), LTF_INTERVALS)
  ]);
  console.log(`[RENDERER] ${sym} grid_compose_complete elapsed_ms=${Date.now() - tCompose}`);

  const validation = allPanels.map((p, idx) => ({
    interval: allIntervals[idx],
    label: TF_LABELS[allIntervals[idx]] || allIntervals[idx],
    ok: !!p.valid,
    reason: p.valid ? null : (p.reason || 'unknown')
  }));
  const okCount = validation.filter(v => v.ok).length;
  const failedTfs = validation.filter(v => !v.ok).map(v => `${v.interval}(${v.reason})`);

  const elapsedMs = Date.now() - t0;
  const elapsedS  = Math.round(elapsedMs / 1000);
  // Truthful partial reporting — explicit valid/total + per-tf failure list.
  console.log(`[RENDERER] ${sym} render_complete_total elapsed_s=${elapsedS} elapsed_ms=${elapsedMs} valid=${okCount}/${allIntervals.length}${failedTfs.length ? ' failed=' + failedTfs.join(',') : ''} concurrency=${CHART_IMG_CONCURRENCY}`);
  console.log(`[RENDERER] ${sym} - complete in ${elapsedS}s`); // legacy line preserved for downstream parsers
  console.log(`[SYMBOL-TRACE] renderReturnSymbol=${sym} htfGridName=${sym}_HTF.png ltfGridName=${sym}_LTF.png`);
  return {
    htfGrid:     grids[0],
    ltfGrid:     grids[1],
    htfGridName: sym + '_HTF.png',
    ltfGridName: sym + '_LTF.png',
    validation
  };
}

/**
 * runRenderer — artefact provider entry point for the doctrine pipeline.
 * Returns rendererArtefacts shape consumed by JaneInputPacket.
 * In test mode: short-circuit, no Puppeteer launch.
 */
async function runRenderer(symbol, opts = {}) {
  const testMode = opts.testMode || process.env.ATLAS_TEST_MODE === '1';
  const timestamp = new Date().toISOString();

  if (testMode) {
    return {
      chartRefs: [],
      timeframeCoverage: [],
      captureStatus: 'SKIPPED_TEST_MODE',
      renderValidity: true,
      symbolIntegrity: 'OK',
      symbol,
      timestamp,
    };
  }

  try {
    // Phase B: invoke existing renderAllPanels and shape its output.
    // Phase D: tighten chartRefs format, integrate symbol mapping, status flags.
    const result = await renderAllPanels(symbol);
    return {
      chartRefs: Array.isArray(result && result.charts) ? result.charts : (Array.isArray(result) ? result : []),
      timeframeCoverage: (result && result.timeframes) || ['W', 'D', '240', '60', '30', '15', '5', '1'],
      captureStatus: result ? 'OK' : 'PARTIAL',
      renderValidity: !!result,
      symbolIntegrity: 'OK',
      symbol,
      timestamp,
    };
  } catch (err) {
    return {
      chartRefs: [],
      timeframeCoverage: [],
      captureStatus: 'FAILED',
      renderValidity: false,
      symbolIntegrity: 'OK',
      error: err.message,
      symbol,
      timestamp,
    };
  }
}

module.exports = { renderAllPanels, runRenderer };
