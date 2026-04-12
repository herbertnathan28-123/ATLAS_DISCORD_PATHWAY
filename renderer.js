'use strict';
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const CELL_W = 960;
const CELL_H = 540;
const VIEWPORT = { width: CELL_W, height: CELL_H };
const CHART_LOAD_TIMEOUT = 15000;
const CANVAS_DRAWN_TIMEOUT = 15000;   // aggressive path: 8000 -> 15000
const SETTLE_FALLBACK_MS = 400;
const STAGGER_MS = 750;               // aggressive path: 250 -> 750
const UP_COLOR = '#00ff00';
const DOWN_COLOR = '#ff0015';
const BG_COLOR = '#131722';

// ── Symbol translation — mirrors index.js SYMBOL_OVERRIDES ──
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

function buildWidgetHtml(symbol, interval) {
  return '<html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:'+CELL_W+'px;height:'+CELL_H+'px;overflow:hidden;background:'+BG_COLOR+'}#tv{width:'+CELL_W+'px;height:'+CELL_H+'px}</style></head><body><div id="tv"></div><script src="https://s3.tradingview.com/tv.js"><\/script><script>new TradingView.widget({container_id:"tv",autosize:false,width:'+CELL_W+',height:'+CELL_H+',symbol:"'+symbol+'",interval:"'+interval+'",timezone:"exchange",theme:"dark",style:"1",locale:"en",toolbar_bg:"'+BG_COLOR+'",enable_publishing:false,hide_side_toolbar:true,hide_top_toolbar:true,hide_legend:false,save_image:false,allow_symbol_change:false,hotlist:false,calendar:false,show_popup_button:false,withdateranges:false,details:false,bar_spacing:8,studies:[],overrides:{"paneProperties.background":"'+BG_COLOR+'","paneProperties.backgroundType":"solid","mainSeriesProperties.candleStyle.upColor":"'+UP_COLOR+'","mainSeriesProperties.candleStyle.downColor":"'+DOWN_COLOR+'","mainSeriesProperties.candleStyle.borderUpColor":"'+UP_COLOR+'","mainSeriesProperties.candleStyle.borderDownColor":"'+DOWN_COLOR+'","mainSeriesProperties.candleStyle.wickUpColor":"'+UP_COLOR+'","mainSeriesProperties.candleStyle.wickDownColor":"'+DOWN_COLOR+'","mainSeriesProperties.candleStyle.drawBorder":true,"mainSeriesProperties.candleStyle.drawWick":true,"scalesProperties.backgroundColor":"'+BG_COLOR+'","scalesProperties.textColor":"#AAA","scalesProperties.fontSize":14}});<\/script></body></html>';
}

// Canvas painted check — scoped selector with fallback, strict success conditions:
//   canvas exists, width>0, height>0, >=2 candle-colored pixels in 60-sample grid.
async function waitForCanvasDrawn(frame, maxMs) {
  return frame.waitForFunction(() => {
    // Primary: .tv-lightweight-charts canvas. Fallback: plain canvas.
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

// Data-present check — waits until iframe body text shows non-zero OHLC.
// Stalled widget prints "○ 0 H:0 L:0 C:0"; loaded widget prints real numbers.
async function waitForDataPresent(frame, maxMs) {
  return frame.waitForFunction(() => {
    const text = document.body && document.body.innerText || '';
    // All-zero stub patterns
    if (/\bH:\s*0\b[\s\S]{0,6}L:\s*0\b[\s\S]{0,6}C:\s*0\b/.test(text)) return false;
    if (/\bO:\s*0(?:\.0+)?\b[\s\S]{0,40}C:\s*0(?:\.0+)?\b/.test(text)) return false;
    // Real OHLC: H: followed by decimal number
    return /\bH:\s*\d+\.\d+/.test(text) || /\bC:\s*\d+\.\d+/.test(text);
  }, { timeout: maxMs, polling: 200 }).then(() => true).catch(() => false);
}

async function captureSingleChart(browser, symbol, timeframe) {
  const page = await browser.newPage();
  let screenshot = null;
  const t0 = Date.now();
  const diag = {
    booted: false,
    dataPresent: false,
    canvasFound: false,
    painted: false,
    timeoutReason: null,
    bytes: 0,
    elapsedMs: 0,
  };
  try {
    await page.setViewport(VIEWPORT);
    await page.setContent(buildWidgetHtml(symbol, timeframe), { waitUntil: 'domcontentloaded', timeout: CHART_LOAD_TIMEOUT });

    // Step 1: wait for tv.js to register TradingView global
    try {
      await page.waitForFunction(() => typeof TradingView !== 'undefined', { timeout: 15000 });
      diag.booted = true;
    } catch (e) {
      diag.timeoutReason = 'boot';
    }

    // Step 2: wait for widget's iframe
    const iframeHandle = await page.waitForSelector('#tv iframe', { timeout: CHART_LOAD_TIMEOUT }).catch(() => null);
    if (iframeHandle) {
      const f = await iframeHandle.contentFrame();
      if (f) {
        // Step 3: canvas element appears
        try {
          await f.waitForSelector('canvas', { timeout: CHART_LOAD_TIMEOUT });
          diag.canvasFound = true;
        } catch (e) {
          diag.timeoutReason = diag.timeoutReason || 'canvas';
        }

        // Step 4: OHLC data text present (not zero-stub)
        diag.dataPresent = await waitForDataPresent(f, CANVAS_DRAWN_TIMEOUT);
        if (!diag.dataPresent) diag.timeoutReason = diag.timeoutReason || 'data';

        // Step 5: candle-colored pixels actually painted
        diag.painted = await waitForCanvasDrawn(f, CANVAS_DRAWN_TIMEOUT);
        if (!diag.painted) diag.timeoutReason = diag.timeoutReason || 'paint';
      } else {
        diag.timeoutReason = diag.timeoutReason || 'contentFrame';
      }
    } else {
      diag.timeoutReason = diag.timeoutReason || 'iframe';
    }

    await new Promise(r => setTimeout(r, SETTLE_FALLBACK_MS));
    screenshot = await page.screenshot({ type: 'png' });
    diag.bytes = screenshot.length;
  } catch (err) {
    const msg = err && err.message || String(err);
    console.error('  [CAPTURE] ' + symbol + ' @ ' + timeframe + ' FAILED: ' + msg);
    if (/out of memory|oom|killed|ENOMEM|Target closed|crash/i.test(msg)) {
      console.error('[RENDERER] OOM suspected after removing --single-process');
    }
    screenshot = await sharp({
      create: { width: CELL_W, height: CELL_H, channels: 3, background: { r: 19, g: 23, b: 34 } }
    }).png().toBuffer();
    diag.bytes = screenshot.length;
    diag.timeoutReason = diag.timeoutReason || ('error:' + msg.slice(0, 48));
  } finally {
    try { await page.close(); } catch (_) {}
    diag.elapsedMs = Date.now() - t0;
  }

  const ok = diag.canvasFound && diag.dataPresent && diag.painted;
  console.log(
    '  [CAPTURE] ' + symbol + ' @ ' + timeframe +
    ' canvas:' + (diag.canvasFound ? 'yes' : 'no') +
    ' data:'   + (diag.dataPresent ? 'yes' : 'no') +
    ' painted:'+ (diag.painted ? 'yes' : 'no') +
    (ok ? ' OK' : ' timeout:' + (diag.timeoutReason || 'unknown')) +
    ' bytes:' + diag.bytes +
    ' ' + diag.elapsedMs + 'ms'
  );

  return screenshot;
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

// Core render flow — aggressive launch (no --single-process, no --no-zygote).
async function renderAllPanelsInternal(symbol) {
  const tvSymbol = toTVSymbol(symbol);
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

    const HTF_TFS = ['W', 'D', '240', '60'];
    const LTF_TFS = ['30', '15', '5', '1'];

    const htfShots = await Promise.all(HTF_TFS.map((tf, i) =>
      new Promise(r => setTimeout(r, i * STAGGER_MS)).then(() => captureSingleChart(browser, tvSymbol, tf))
    ));
    const ltfShots = await Promise.all(LTF_TFS.map((tf, i) =>
      new Promise(r => setTimeout(r, i * STAGGER_MS)).then(() => captureSingleChart(browser, tvSymbol, tf))
    ));

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

// One-retry OOM safeguard. No endless relaunch loop.
async function renderAllPanels(symbol) {
  try {
    return await renderAllPanelsInternal(symbol);
  } catch (err) {
    const msg = err && err.message || String(err);
    console.error('[RENDERER] First attempt failed: ' + msg);
    if (/out of memory|oom|killed|ENOMEM|Target closed|crash/i.test(msg)) {
      console.error('[RENDERER] OOM suspected after removing --single-process');
    }
    console.log('[RENDERER] Attempting one retry...');
    await new Promise(r => setTimeout(r, 1500));
    try {
      return await renderAllPanelsInternal(symbol);
    } catch (err2) {
      const msg2 = err2 && err2.message || String(err2);
      console.error('[RENDERER] Retry also failed: ' + msg2);
      if (/out of memory|oom|killed|ENOMEM|Target closed|crash/i.test(msg2)) {
        console.error('[RENDERER] OOM suspected after removing --single-process');
      }
      throw err2;
    }
  }
}

module.exports = { renderAllPanels, captureSingleChart, buildTwoByTwoGrid, toTVSymbol };
