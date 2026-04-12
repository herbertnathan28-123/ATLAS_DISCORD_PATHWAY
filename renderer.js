'use strict';
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const CELL_W = 960;
const CELL_H = 540;
const VIEWPORT = { width: CELL_W, height: CELL_H };
const CHART_LOAD_TIMEOUT = 15000;
const CANVAS_DRAWN_TIMEOUT = 8000;
const SETTLE_FALLBACK_MS = 400;
const STAGGER_MS = 250;             // FIX 2 — delay between parallel widget creations
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

// FIX 5 — added bar_spacing:8, drawWick:true (drawBorder already present),
//         scalesProperties.fontSize:14
// FIX 6 — hide_top_toolbar:true (was false), rest already hidden
function buildWidgetHtml(symbol, interval) {
  return '<html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:'+CELL_W+'px;height:'+CELL_H+'px;overflow:hidden;background:'+BG_COLOR+'}#tv{width:'+CELL_W+'px;height:'+CELL_H+'px}</style></head><body><div id="tv"></div><script src="https://s3.tradingview.com/tv.js"><\/script><script>new TradingView.widget({container_id:"tv",autosize:false,width:'+CELL_W+',height:'+CELL_H+',symbol:"'+symbol+'",interval:"'+interval+'",timezone:"exchange",theme:"dark",style:"1",locale:"en",toolbar_bg:"'+BG_COLOR+'",enable_publishing:false,hide_side_toolbar:true,hide_top_toolbar:true,hide_legend:false,save_image:false,allow_symbol_change:false,hotlist:false,calendar:false,show_popup_button:false,withdateranges:false,details:false,bar_spacing:8,studies:[],overrides:{"paneProperties.background":"'+BG_COLOR+'","paneProperties.backgroundType":"solid","mainSeriesProperties.candleStyle.upColor":"'+UP_COLOR+'","mainSeriesProperties.candleStyle.downColor":"'+DOWN_COLOR+'","mainSeriesProperties.candleStyle.borderUpColor":"'+UP_COLOR+'","mainSeriesProperties.candleStyle.borderDownColor":"'+DOWN_COLOR+'","mainSeriesProperties.candleStyle.wickUpColor":"'+UP_COLOR+'","mainSeriesProperties.candleStyle.wickDownColor":"'+DOWN_COLOR+'","mainSeriesProperties.candleStyle.drawBorder":true,"mainSeriesProperties.candleStyle.drawWick":true,"scalesProperties.backgroundColor":"'+BG_COLOR+'","scalesProperties.textColor":"#AAA","scalesProperties.fontSize":14}});<\/script></body></html>';
}

// FIX 1 — range-based candle detection, rename isGreen/isRed -> isUp/isDn
//         with R/G/B thresholds per spec: isUp g>180 r<80 b<80, isDn r>180 g<80 b<80
// FIX 4 — scope canvas query to .tv-lightweight-charts
async function waitForCanvasDrawn(frame, maxMs) {
  return frame.waitForFunction(() => {
    const canvases = document.querySelectorAll('.tv-lightweight-charts canvas');
    if (!canvases.length) return false;
    let best = null, bestArea = 0;
    for (const c of canvases) {
      const a = c.width * c.height;
      if (a > bestArea) { bestArea = a; best = c; }
    }
    if (!best || bestArea < 50000) return false;
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
  }, { timeout: maxMs, polling: 150 }).then(() => true).catch(() => false);
}

async function captureSingleChart(browser, symbol, timeframe) {
  const page = await browser.newPage();
  let screenshot = null;
  const t0 = Date.now();
  try {
    await page.setViewport(VIEWPORT);
    await page.setContent(buildWidgetHtml(symbol, timeframe), { waitUntil: 'domcontentloaded', timeout: CHART_LOAD_TIMEOUT });
    // FIX 3 — wait for TradingView global to be defined before looking for widget
    await page.waitForFunction(() => typeof TradingView !== 'undefined', { timeout: 15000 }).catch(() => {});
    const iframeHandle = await page.waitForSelector('#tv iframe', { timeout: CHART_LOAD_TIMEOUT }).catch(() => null);
    let drawn = false;
    if (iframeHandle) {
      const f = await iframeHandle.contentFrame();
      if (f) {
        await f.waitForSelector('canvas', { timeout: CHART_LOAD_TIMEOUT }).catch(() => {});
        drawn = await waitForCanvasDrawn(f, CANVAS_DRAWN_TIMEOUT);
      }
    }
    await new Promise(r => setTimeout(r, SETTLE_FALLBACK_MS));
    screenshot = await page.screenshot({ type: 'png' });
    console.log('  [CAPTURE] ' + symbol + ' @ ' + timeframe + ' ' + (drawn ? 'OK' : 'NO-DRAW') + ' (' + screenshot.length + ' bytes, ' + (Date.now() - t0) + 'ms)');
  } catch (err) {
    console.error('  [CAPTURE] ' + symbol + ' @ ' + timeframe + ' FAILED: ' + err.message);
    screenshot = await sharp({
      create: { width: CELL_W, height: CELL_H, channels: 3, background: { r: 19, g: 23, b: 34 } }
    }).png().toBuffer();
  } finally {
    await page.close();
  }
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

// FIX 2 — stagger each parallel capture by STAGGER_MS so tv.js widget creations
//         don't pile up simultaneously (previously caused the "first 2 of each
//         wave blank" pattern under resource contention)
async function renderAllPanels(symbol) {
  const tvSymbol = toTVSymbol(symbol);
  console.log('[RENDERER] Starting render for ' + symbol + (tvSymbol !== symbol ? ' (TV: ' + tvSymbol + ')' : ''));
  const t = Date.now();
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote']
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
  } catch (err) {
    console.error('[RENDERER] Fatal: ' + err.message);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { renderAllPanels, captureSingleChart, buildTwoByTwoGrid, toTVSymbol };
