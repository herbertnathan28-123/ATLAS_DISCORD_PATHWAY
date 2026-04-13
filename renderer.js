'use strict';
// ============================================================
// ATLAS FX RENDERER — Persistent Widget + Confirmed setResolution
// Root issue: fresh widgets per timeframe ignored the interval
// config (tv.js falls back to cached user preference). Persistent
// widget with setResolution + resolution-change confirmation is
// the correct path.
//
// Flow:
//   open widget on W
//   wait data + paint
//   capture W
//   setResolution D -> poll chart.resolution() === D -> wait data + paint -> capture
//   setResolution 240 -> ... -> capture
//   ... etc for all 8
// ============================================================
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const CELL_W = 960;
const CELL_H = 540;
const VIEWPORT = { width: CELL_W, height: CELL_H };
const PAGE_LOAD_TIMEOUT = 30000;
const DATA_WAIT_TIMEOUT = 20000;           // first load may be slow
const PAINT_WAIT_TIMEOUT = 15000;
const RESOLUTION_CHANGE_TIMEOUT = 10000;   // time for chart.resolution() to update
const SETTLE_MS = 500;
const UP_COLOR = '#00ff00';
const DOWN_COLOR = '#ff0015';
const BG_COLOR = '#131722';

const SYMBOL_OVERRIDES = {
  XAUUSD: 'OANDA:XAUUSD',
  XAGUSD: 'OANDA:XAGUSD',
  BCOUSD: 'OANDA:BCOUSD',
  USOIL:  'OANDA:BCOUSD',
  NAS100: 'OANDA:NAS100USD',
  US500:  'OANDA:SPX500USD',
  US30:   'OANDA:US30USD',
  GER40:  'OANDA:DE30EUR',
  UK100:  'OANDA:UK100GBP',
  NATGAS: 'NYMEX:NG1!',
  MICRON: 'NASDAQ:MU',
  AMD:    'NASDAQ:AMD',
  ASML:   'NASDAQ:ASML',
  NVDA:   'NASDAQ:NVDA'
};

function toTVSymbol(s) {
  if (!s) return s;
  const up = String(s).trim().toUpperCase();
  if (up.includes(':')) return up;
  if (SYMBOL_OVERRIDES[up]) return SYMBOL_OVERRIDES[up];
  if (/^[A-Z]{6}$/.test(up)) return 'OANDA:' + up;
  return 'NASDAQ:' + up;
}

function buildWidgetHtml(symbol, initialInterval) {
  return `<html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${CELL_W}px;height:${CELL_H}px;overflow:hidden;background:${BG_COLOR}}#tv{width:${CELL_W}px;height:${CELL_H}px}</style></head><body><div id="tv"></div><script src="https://s3.tradingview.com/tv.js"></script><script>
window.__tvWidget = new TradingView.widget({
  container_id:"tv",autosize:false,width:${CELL_W},height:${CELL_H},
  symbol:"${symbol}",interval:"${initialInterval}",
  timezone:"exchange",theme:"dark",style:"1",locale:"en",
  toolbar_bg:"${BG_COLOR}",enable_publishing:false,
  hide_side_toolbar:true,hide_top_toolbar:true,hide_legend:false,
  save_image:false,allow_symbol_change:false,hotlist:false,
  calendar:false,show_popup_button:false,withdateranges:false,details:false,
  bar_spacing:8,studies:[],
  overrides:{
    "paneProperties.background":"${BG_COLOR}",
    "paneProperties.backgroundType":"solid",
    "mainSeriesProperties.candleStyle.upColor":"${UP_COLOR}",
    "mainSeriesProperties.candleStyle.downColor":"${DOWN_COLOR}",
    "mainSeriesProperties.candleStyle.borderUpColor":"${UP_COLOR}",
    "mainSeriesProperties.candleStyle.borderDownColor":"${DOWN_COLOR}",
    "mainSeriesProperties.candleStyle.wickUpColor":"${UP_COLOR}",
    "mainSeriesProperties.candleStyle.wickDownColor":"${DOWN_COLOR}",
    "mainSeriesProperties.candleStyle.drawBorder":true,
    "mainSeriesProperties.candleStyle.drawWick":true,
    "scalesProperties.backgroundColor":"${BG_COLOR}",
    "scalesProperties.textColor":"#AAA",
    "scalesProperties.fontSize":14
  }
});
</script></body></html>`;
}

async function waitForDataPresent(frame, maxMs) {
  return frame.waitForFunction(() => {
    const text = (document.body && document.body.innerText) || '';
    if (/\bH:\s*0\b[\s\S]{0,6}L:\s*0\b[\s\S]{0,6}C:\s*0\b/.test(text)) return false;
    if (/\bO:\s*0(?:\.0+)?\b[\s\S]{0,40}C:\s*0(?:\.0+)?\b/.test(text)) return false;
    return /\bH:\s*\d+\.\d+/.test(text) || /\bC:\s*\d+\.\d+/.test(text);
  }, { timeout: maxMs, polling: 200 }).then(() => true).catch(() => false);
}

async function waitForCanvasDrawn(frame, maxMs) {
  return frame.waitForFunction(() => {
    let canvases = document.querySelectorAll('.tv-lightweight-charts canvas');
    if (!canvases.length) canvases = document.querySelectorAll('canvas');
    if (!canvases.length) return false;
    let best = null, bestArea = 0;
    for (const c of canvases) {
      const a = c.width * c.height;
      if (a > bestArea) { bestArea = a; best = c; }
    }
    if (!best || best.width <= 0 || best.height <= 0 || bestArea < 50000) return false;
    const ctx = best.getContext('2d');
    if (!ctx) return false;
    try {
      const W = best.width, H = best.height;
      let hits = 0;
      for (let xi = 0; xi < 10; xi++) {
        for (let yi = 0; yi < 6; yi++) {
          const x = Math.floor(W * (0.1 + xi * 0.08));
          const y = Math.floor(H * (0.1 + yi * 0.13));
          const d = ctx.getImageData(x, y, 1, 1).data;
          const isUp = d[1] > 180 && d[0] < 80 && d[2] < 80;
          const isDn = d[0] > 180 && d[1] < 80 && d[2] < 80;
          if (isUp || isDn) { hits++; if (hits >= 2) return true; }
        }
      }
      return false;
    } catch (e) { return false; }
  }, { timeout: maxMs, polling: 200 }).then(() => true).catch(() => false);
}

// Get chart's current resolution via widget API (returns null on error)
async function getCurrentResolution(page) {
  return page.evaluate(() => {
    try {
      const chart = window.__tvWidget && window.__tvWidget.chart && window.__tvWidget.chart();
      if (!chart) return null;
      return (typeof chart.resolution === 'function') ? chart.resolution() : null;
    } catch (e) { return null; }
  });
}

// Switch the widget's resolution AND wait until chart.resolution() actually
// reports the new value (not just the callback). This confirms the widget
// has internally applied the new interval, before we wait for data.
async function switchResolutionAndConfirm(page, tf) {
  // Kick off the setResolution call
  await page.evaluate((newTf) => {
    return new Promise((resolve) => {
      if (!window.__tvWidget) { resolve(); return; }
      try {
        const chart = window.__tvWidget.chart();
        chart.setResolution(newTf, () => resolve());
        setTimeout(resolve, 8000); // callback safety
      } catch (e) {
        resolve();
      }
    });
  }, tf);

  // Poll: wait until chart.resolution() reports the new TF
  const confirmed = await page.waitForFunction(
    (expected) => {
      try {
        const chart = window.__tvWidget && window.__tvWidget.chart && window.__tvWidget.chart();
        if (!chart || typeof chart.resolution !== 'function') return false;
        return chart.resolution() === expected;
      } catch (e) { return false; }
    },
    { timeout: RESOLUTION_CHANGE_TIMEOUT, polling: 200 },
    tf
  ).then(() => true).catch(() => false);

  return confirmed;
}

async function captureCurrentState(page, frame, symbol, tf, switched) {
  const t0 = Date.now();
  const diag = {
    canvasFound: false,
    dataPresent: false,
    painted: false,
    switched: switched,
    reportedRes: null,
    timeoutReason: null,
    bytes: 0,
    elapsedMs: 0,
  };

  try {
    await frame.waitForSelector('canvas', { timeout: DATA_WAIT_TIMEOUT });
    diag.canvasFound = true;
  } catch (e) {
    diag.timeoutReason = 'canvas';
  }

  diag.dataPresent = await waitForDataPresent(frame, DATA_WAIT_TIMEOUT);
  if (!diag.dataPresent) diag.timeoutReason = diag.timeoutReason || 'data';

  diag.painted = await waitForCanvasDrawn(frame, PAINT_WAIT_TIMEOUT);
  if (!diag.painted) diag.timeoutReason = diag.timeoutReason || 'paint';

  await new Promise(r => setTimeout(r, SETTLE_MS));

  // Read what resolution chart ACTUALLY reports at screenshot time
  diag.reportedRes = await getCurrentResolution(page);

  const shot = await page.screenshot({ type: 'png' });
  diag.bytes = shot.length;
  diag.elapsedMs = Date.now() - t0;

  const ok = diag.canvasFound && diag.dataPresent && diag.painted;
  const resMatch = diag.reportedRes === tf ? 'yes' : 'MISMATCH(' + diag.reportedRes + ')';
  console.log(
    '  [CAPTURE] ' + symbol + ' @ ' + tf +
    ' switched:' + (switched === null ? 'n/a' : (switched ? 'yes' : 'no')) +
    ' res:' + resMatch +
    ' canvas:' + (diag.canvasFound ? 'yes' : 'no') +
    ' data:'   + (diag.dataPresent ? 'yes' : 'no') +
    ' painted:'+ (diag.painted ? 'yes' : 'no') +
    (ok ? ' OK' : ' timeout:' + (diag.timeoutReason || 'unknown')) +
    ' bytes:' + diag.bytes +
    ' ' + diag.elapsedMs + 'ms'
  );

  return shot;
}

async function buildTwoByTwoGrid(buffers) {
  const r = await Promise.all(buffers.map(b => sharp(b).resize(CELL_W, CELL_H, { fit: 'fill' }).toBuffer()));
  return sharp({
    create: { width: CELL_W * 2, height: CELL_H * 2, channels: 3, background: { r: 19, g: 23, b: 34 } }
  }).composite([
    { input: r[0], left: 0, top: 0 },
    { input: r[1], left: CELL_W, top: 0 },
    { input: r[2], left: 0, top: CELL_H },
    { input: r[3], left: CELL_W, top: CELL_H }
  ]).png().toBuffer();
}

async function renderAllPanelsInternal(symbol) {
  const tvSymbol = toTVSymbol(symbol);
  const timeframes = ['W', 'D', '240', '60', '30', '15', '5', '1'];
  console.log('[RENDERER] Starting render for ' + symbol + (tvSymbol !== symbol ? ' (TV: ' + tvSymbol + ')' : ''));
  const t = Date.now();
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ]
    });

    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    // Load widget ONCE with W as starting timeframe
    await page.setContent(buildWidgetHtml(tvSymbol, timeframes[0]), { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    await page.waitForFunction(() => typeof TradingView !== 'undefined', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('#tv iframe', { timeout: PAGE_LOAD_TIMEOUT });

    const iframeHandle = await page.$('#tv iframe');
    if (!iframeHandle) throw new Error('TradingView iframe not found after widget load');
    const frame = await iframeHandle.contentFrame();
    if (!frame) throw new Error('Could not attach to TradingView iframe contentFrame');

    console.log('[RENDERER] Widget loaded — starting sequential captures');

    const shots = [];

    // First capture: widget already on W, no switch needed
    shots.push(await captureCurrentState(page, frame, tvSymbol, timeframes[0], null));

    // Remaining 7: setResolution + confirm + wait + capture
    // 250ms stagger between timeframe switches (FIX 2)
    for (let i = 1; i < timeframes.length; i++) {
      const tf = timeframes[i];
      await new Promise(r => setTimeout(r, 250));
      const switched = await switchResolutionAndConfirm(page, tf);
      shots.push(await captureCurrentState(page, frame, tvSymbol, tf, switched));
    }

    const htfShots = shots.slice(0, 4);
    const ltfShots = shots.slice(4, 8);

    const [htfGrid, ltfGrid] = await Promise.all([
      buildTwoByTwoGrid(htfShots),
      buildTwoByTwoGrid(ltfShots)
    ]);

    console.log('[RENDERER] Complete for ' + symbol + ' in ' + ((Date.now() - t) / 1000).toFixed(1) + 's');
    return { htfGrid, ltfGrid, htfGridName: symbol + '_HTF.png', ltfGridName: symbol + '_LTF.png' };
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}

async function renderAllPanels(symbol) {
  try {
    return await renderAllPanelsInternal(symbol);
  } catch (err) {
    const msg = err && err.message || String(err);
    console.error('[RENDERER] First attempt failed: ' + msg);
    if (/out of memory|oom|killed|ENOMEM|Target closed|crash/i.test(msg)) {
      console.error('[RENDERER] OOM suspected');
    }
    console.log('[RENDERER] Attempting one retry...');
    await new Promise(r => setTimeout(r, 1500));
    try {
      return await renderAllPanelsInternal(symbol);
    } catch (err2) {
      console.error('[RENDERER] Retry also failed: ' + (err2 && err2.message || err2));
      throw err2;
    }
  }
}

module.exports = { renderAllPanels, toTVSymbol };
