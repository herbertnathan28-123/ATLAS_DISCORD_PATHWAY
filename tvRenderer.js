'use strict';
// ============================================================
// tvRenderer.js — TradingView Chart Renderer (CommonJS)
//
// Deterministic, self-contained renderer for ATLAS FX.
// Puppeteer + TradingView Advanced Widget with custom candle colors.
//
// Output per invocation:
//   HTF 2x2 grid: 1W (TL) | 1D (TR) | 4H (BL) | 1H (BR)
//   LTF 2x2 grid: 30M (TL) | 15M (TR) | 5M (BL) | 1M (BR)
//
// Candle colors: up = #00ff00, down = #ff0015
// Background:    #131722
// ============================================================

const puppeteer = require('puppeteer');
const sharp = require('sharp');

const CELL_W = 960;
const CELL_H = 540;
const VIEWPORT = { width: CELL_W, height: CELL_H };
const CHART_LOAD_TIMEOUT = 30000;
const CANVAS_SETTLE_MS = 5000;

const HTF_TIMEFRAMES = ['W', 'D', '240', '60'];
const LTF_TIMEFRAMES = ['30', '15', '5', '1'];

const TF_LABELS = {
  W: '1W', D: '1D', '240': '4H', '60': '1H',
  '30': '30M', '15': '15M', '5': '5M', '1': '1M',
};

const UP_COLOR = '#00ff00';
const DOWN_COLOR = '#ff0015';
const BG_COLOR = '#131722';

function buildWidgetHtml(symbol, interval) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${CELL_W}px; height: ${CELL_H}px; overflow: hidden; background: ${BG_COLOR}; }
    #tv_chart { width: ${CELL_W}px; height: ${CELL_H}px; }
  </style>
</head>
<body>
  <div id="tv_chart"></div>
  <script src="https://s3.tradingview.com/tv.js"></script>
  <script>
    new TradingView.widget({
      container_id: "tv_chart",
      autosize: false,
      width: ${CELL_W},
      height: ${CELL_H},
      symbol: "${symbol}",
      interval: "${interval}",
      timezone: "exchange",
      theme: "dark",
      style: "1",
      locale: "en",
      toolbar_bg: "${BG_COLOR}",
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
      studies: [],
      overrides: {
        "paneProperties.background": "${BG_COLOR}",
        "paneProperties.backgroundType": "solid",
        "mainSeriesProperties.candleStyle.upColor": "${UP_COLOR}",
        "mainSeriesProperties.candleStyle.downColor": "${DOWN_COLOR}",
        "mainSeriesProperties.candleStyle.borderUpColor": "${UP_COLOR}",
        "mainSeriesProperties.candleStyle.borderDownColor": "${DOWN_COLOR}",
        "mainSeriesProperties.candleStyle.wickUpColor": "${UP_COLOR}",
        "mainSeriesProperties.candleStyle.wickDownColor": "${DOWN_COLOR}",
        "mainSeriesProperties.candleStyle.drawBorder": true,
        "mainSeriesProperties.candleStyle.drawWick": true,
        "mainSeriesProperties.candleStyle.barSpacing": 8,
        "scalesProperties.backgroundColor": "${BG_COLOR}",
        "scalesProperties.textColor": "#AAA",
        "scalesProperties.fontSize": 14
      }
    });
  </script>
</body>
</html>`;
}

async function placeholderPane() {
  return sharp({
    create: {
      width: CELL_W,
      height: CELL_H,
      channels: 3,
      background: { r: 19, g: 23, b: 34 },
    },
  }).png().toBuffer();
}

async function captureSingleChart(browser, symbol, timeframe) {
  const page = await browser.newPage();
  let screenshot = null;

  try {
    await page.setViewport(VIEWPORT);
    const html = buildWidgetHtml(symbol, timeframe);
    console.log(`  [CAPTURE] ${symbol} @ ${TF_LABELS[timeframe] || timeframe} loading...`);

    await page.setContent(html, { waitUntil: 'networkidle2', timeout: CHART_LOAD_TIMEOUT });

    const iframeHandle = await page.waitForSelector('#tv_chart iframe', { timeout: CHART_LOAD_TIMEOUT }).catch(() => null);
    if (iframeHandle) {
      const frame = await iframeHandle.contentFrame().catch(() => null);
      if (frame) {
        await frame.waitForSelector('canvas', { timeout: CHART_LOAD_TIMEOUT }).catch(() => {});
      }
    }

    await new Promise((r) => setTimeout(r, CANVAS_SETTLE_MS));
    screenshot = await page.screenshot({ type: 'png' });
    console.log(`  [CAPTURE] ${symbol} @ ${TF_LABELS[timeframe] || timeframe} done (${screenshot.length} bytes)`);
  } catch (err) {
    console.error(`  [CAPTURE] ${symbol} @ ${TF_LABELS[timeframe] || timeframe} FAILED: ${err.message}`);
    screenshot = await placeholderPane();
  } finally {
    try { await page.close(); } catch (_) {}
  }

  return screenshot;
}

async function buildTwoByTwoGrid(buffers) {
  const resized = await Promise.all(
    buffers.map((buf) => sharp(buf).resize(CELL_W, CELL_H, { fit: 'fill' }).toBuffer())
  );

  const gridW = CELL_W * 2;
  const gridH = CELL_H * 2;

  return sharp({
    create: {
      width: gridW,
      height: gridH,
      channels: 3,
      background: { r: 19, g: 23, b: 34 },
    },
  })
    .composite([
      { input: resized[0], left: 0, top: 0 },
      { input: resized[1], left: CELL_W, top: 0 },
      { input: resized[2], left: 0, top: CELL_H },
      { input: resized[3], left: CELL_W, top: CELL_H },
    ])
    .png()
    .toBuffer();
}

async function captureGroup(browser, symbol, timeframes) {
  const shots = [];
  for (const tf of timeframes) {
    shots.push(await captureSingleChart(browser, symbol, tf));
  }
  return shots;
}

async function renderAllPanels(symbol) {
  console.log(`[RENDERER] Starting render for ${symbol}`);
  const startTime = Date.now();

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
    });

    console.log(`[RENDERER] Capturing HTF...`);
    const htfShots = await captureGroup(browser, symbol, HTF_TIMEFRAMES);
    const htfGrid = await buildTwoByTwoGrid(htfShots);

    console.log(`[RENDERER] Capturing LTF...`);
    const ltfShots = await captureGroup(browser, symbol, LTF_TIMEFRAMES);
    const ltfGrid = await buildTwoByTwoGrid(ltfShots);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[RENDERER] Complete for ${symbol} in ${elapsed}s`);

    return {
      success: true,
      symbol,
      htfGrid,
      ltfGrid,
      htfGridName: `${symbol}_HTF.png`,
      ltfGridName: `${symbol}_LTF.png`,
    };
  } catch (err) {
    console.error(`[RENDERER] Fatal error for ${symbol}:`, err.message);
    throw err;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

module.exports = { renderAllPanels };
