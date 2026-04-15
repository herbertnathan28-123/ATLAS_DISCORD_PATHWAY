'use strict';
// ============================================================
// ATLAS FX RENDERER — Fresh widget per timeframe
// TradingView widget interval is set at init only. setResolution
// does not reliably change the embedded chart. Correct architecture:
// destroy and recreate widget per timeframe in sequence.
//
// Flow (per timeframe W,D,240,60,30,15,5,1):
//   clear container -> create widget with interval at init
//   wait for iframe -> wait data -> wait paint -> capture
//
// Each pane's wait budget is INDEPENDENT. DATA_WAIT_TIMEOUT and
// PAINT_WAIT_TIMEOUT apply per-capture. There is no global budget
// spanning all 8 captures — if pane W takes 40s, pane D still gets
// a full timeout afresh for its own wait. This is by design.
// ============================================================
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const CELL_W = 960;
const CELL_H = 540;
const VIEWPORT = { width: CELL_W, height: CELL_H };
const PAGE_LOAD_TIMEOUT = 30000;
const DATA_WAIT_TIMEOUT = 45000;
const PAINT_WAIT_TIMEOUT = 45000;
const IFRAME_TIMEOUT = 20000;
const POLL_INTERVAL_MS = 500;
const SETTLE_MS = 500;
const BETWEEN_TF_MS = 250;
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

function buildShellHtml() {
  return `<html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${CELL_W}px;height:${CELL_H}px;overflow:hidden;background:${BG_COLOR}}#tv{width:${CELL_W}px;height:${CELL_H}px}</style></head><body><div id="tv"></div><script src="https://s3.tradingview.com/tv.js"></script></body></html>`;
}

async function createWidget(page, symbol, interval) {
  await page.evaluate((sym, intv, cellW, cellH, bg, up, dn) => {
    try {
      if (window.__tvWidget && typeof window.__tvWidget.remove === 'function') {
        window.__tvWidget.remove();
      }
    } catch (_) {}
    window.__tvWidget = null;
    const host = document.getElementById('tv');
    if (host) host.innerHTML = '';

    window.__tvWidget = new TradingView.widget({
      container_id: 'tv',
      autosize: false,
      width: cellW,
      height: cellH,
      symbol: sym,
      interval: intv,
      timezone: 'exchange',
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: bg,
      enable_publishing: false,
      hide_side_toolbar: true,
      hide_top_toolbar: true,
      hide_legend: false,
      save_image: false,
      allow_symbol_change: false,
      hotlist: false,
      calendar: false,
      show_popup_button: false,
      withdateranges: false,
      details: false,
      bar_spacing: 8,
      studies: [],
      overrides: {
        'paneProperties.background': bg,
        'paneProperties.backgroundType': 'solid',
        'mainSeriesProperties.candleStyle.upColor': up,
        'mainSeriesProperties.candleStyle.downColor': dn,
        'mainSeriesProperties.candleStyle.borderUpColor': up,
        'mainSeriesProperties.candleStyle.borderDownColor': dn,
        'mainSeriesProperties.candleStyle.wickUpColor': up,
        'mainSeriesProperties.candleStyle.wickDownColor': dn,
        'mainSeriesProperties.candleStyle.drawBorder': true,
        'mainSeriesProperties.candleStyle.drawWick': true,
        'mainSeriesProperties.candleStyle.barSpacing': 8,
        'scalesProperties.backgroundColor': bg,
        'scalesProperties.textColor': '#AAA',
        'scalesProperties.fontSize': 14
      }
    });
  }, symbol, interval, CELL_W, CELL_H, BG_COLOR, UP_COLOR, DOWN_COLOR);
}

// Independent timeout per caller — not shared across captures.
async function waitForDataPresent(frame, maxMs) {
  return frame.waitForFunction(() => {
    const text = (document.body && document.body.innerText) || '';
    if (/\bH:\s*0\b[\s\S]{0,6}L:\s*0\b[\s\S]{0,6}C:\s*0\b/.test(text)) return false;
    if (/\bO:\s*0(?:\.0+)?\b[\s\S]{0,40}C:\s*0(?:\.0+)?\b/.test(text)) return false;
    return /\bH:\s*\d+\.\d+/.test(text) || /\bC:\s*\d+\.\d+/.test(text);
  }, { timeout: maxMs, polling: POLL_INTERVAL_MS }).then(() => true).catch(() => false);
}

// Polls canvas pixels until candle-colored pixels are detected on the
// largest canvas. Actual pixel data on canvas before capture.
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
  }, { timeout: maxMs, polling: POLL_INTERVAL_MS }).then(() => true).catch(() => false);
}

async function captureTimeframe(page, symbol, tf) {
  const t0 = Date.now();
  const diag = { canvasFound: false, dataPresent: false, painted: false, bytes: 0, elapsedMs: 0, timeoutReason: null };

  await createWidget(page, symbol, tf);

  await page.waitForSelector('#tv iframe', { timeout: IFRAME_TIMEOUT });
  const iframeHandle = await page.$('#tv iframe');
  if (!iframeHandle) throw new Error('TradingView iframe not found for ' + tf);
  const frame = await iframeHandle.contentFrame();
  if (!frame) throw new Error('Could not attach to iframe contentFrame for ' + tf);

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

  const shot = await page.screenshot({ type: 'png' });
  diag.bytes = shot.length;
  diag.elapsedMs = Date.now() - t0;

  const ok = diag.canvasFound && diag.dataPresent && diag.painted;
  console.log(
    '  [CAPTURE] ' + symbol + ' @ ' + tf +
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

    await page.setContent(buildShellHtml(), { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    await page.waitForFunction(() => typeof TradingView !== 'undefined', { timeout: 15000 });

    console.log('[RENDERER] Shell loaded — starting sequential per-timeframe captures');

    const shots = [];
    for (let i = 0; i < timeframes.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, BETWEEN_TF_MS));
      shots.push(await captureTimeframe(page, tvSymbol, timeframes[i]));
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
