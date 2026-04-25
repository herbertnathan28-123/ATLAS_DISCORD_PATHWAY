'use strict';
const puppeteer = require('puppeteer');
const sharp     = require('sharp');

const CHART_W = 1920;
const CHART_H = 1080;
const COLOR_UP = '#00ff00';
const COLOR_DN = '#ff0015';
const COLOR_BG = '#131722';

const HTF_INTERVALS = ['1W', '1D', '240', '60'];
const LTF_INTERVALS = ['30', '15', '5', '1'];

const TV_INTERVAL_MAP = {
  '1W': 'W', '1D': 'D', '240': '240', '60': '60',
  '30': '30', '15': '15', '5': '5', '1': '1'
};

const TF_LABELS = {
  '1W': 'Weekly', '1D': 'Daily', '240': '4H', '60': '1H',
  '30': '30M', '15': '15M', '5': '5M', '1': '1M'
};

const SYMBOL_OVERRIDES = {
  XAUUSD: 'OANDA:XAUUSD', XAGUSD: 'OANDA:XAGUSD',
  BCOUSD: 'OANDA:BCOUSD', USOIL:  'OANDA:BCOUSD',
  NAS100: 'OANDA:NAS100USD', US500: 'OANDA:SPX500USD',
  US30:   'OANDA:US30USD', GER40:  'OANDA:DE30EUR',
  UK100:  'OANDA:UK100GBP', NATGAS: 'NYMEX:NG1!',
  MICRON: 'NASDAQ:MU', AMD: 'NASDAQ:AMD',
  ASML:   'NASDAQ:ASML', NVDA: 'NASDAQ:NVDA',
  EURUSD: 'OANDA:EURUSD', GBPUSD: 'OANDA:GBPUSD',
  USDJPY: 'OANDA:USDJPY', AUDUSD: 'OANDA:AUDUSD',
  NZDUSD: 'OANDA:NZDUSD', USDCAD: 'OANDA:USDCAD',
  USDCHF: 'OANDA:USDCHF', AUDJPY: 'OANDA:AUDJPY',
  GBPJPY: 'OANDA:GBPJPY', EURGBP: 'OANDA:EURGBP',
  EURJPY: 'OANDA:EURJPY', CADJPY: 'OANDA:CADJPY',
};

function getTVSymbol(symbol) {
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return 'OANDA:' + symbol;
  return 'NASDAQ:' + symbol;
}

const SAMESITE_MAP = { strict: 'Strict', lax: 'Lax', none: 'None', no_restriction: 'None', unspecified: 'Lax' };
const ALLOWED_COOKIE_FIELDS = new Set(['name','value','domain','path','expires','httpOnly','secure','sameSite']);

function sanitiseCookies(raw) {
  return raw.map(function(c) {
    var out = {};
    for (var f of ALLOWED_COOKIE_FIELDS) { if (c[f] !== undefined) out[f] = c[f]; }
    out.sameSite = SAMESITE_MAP[String(c.sameSite || '').toLowerCase()] || 'Lax';
    if (!out.domain) out.domain = '.tradingview.com';
    if (!out.path)   out.path   = '/';
    if (!out.expires && c.expirationDate) out.expires = c.expirationDate;
    return out;
  }).filter(function(c) { return c.domain && c.domain.includes('tradingview'); });
}

var TV_COOKIES = null;
try {
  if (process.env.TV_COOKIES) {
    TV_COOKIES = sanitiseCookies(JSON.parse(process.env.TV_COOKIES));
    console.log('[RENDERER] TV_COOKIES: ' + TV_COOKIES.length + ' cookies loaded');
  }
} catch (e) {
  console.error('[RENDERER] TV_COOKIES parse error:', e.message);
}

function buildWidgetHTML(tvSymbol, tvInterval) {
  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8">',
    '<style>',
    '* { margin:0; padding:0; box-sizing:border-box; }',
    'html, body { width:' + CHART_W + 'px; height:' + CHART_H + 'px; background:' + COLOR_BG + '; overflow:hidden; }',
    '#tv_chart { width:' + CHART_W + 'px; height:' + CHART_H + 'px; }',
    '</style>',
    '<script src="https://s3.tradingview.com/tv.js"></script>',
    '</head><body>',
    '<div id="tv_chart"></div>',
    '<script>',
    'window.__ATLAS_ready = false;',
    'window.__ATLAS_error = null;',
    '(function tryInit() {',
    '  if (typeof TradingView === "undefined") { setTimeout(tryInit, 50); return; }',
    '  try {',
    '    new TradingView.widget({',
    '      autosize: false,',
    '      width: ' + CHART_W + ',',
    '      height: ' + CHART_H + ',',
    '      symbol: "' + tvSymbol + '",',
    '      interval: "' + tvInterval + '",',
    '      timezone: "Australia/Perth",',
    '      theme: "dark",',
    '      style: "1",',
    '      locale: "en",',
    '      toolbar_bg: "' + COLOR_BG + '",',
    '      backgroundColor: "' + COLOR_BG + '",',
    '      hide_side_toolbar: true,',
    '      hide_top_toolbar: true,',
    '      withdateranges: false,',
    '      details: false,',
    '      calendar: false,',
    '      hotlist: false,',
    '      container_id: "tv_chart",',
    '      overrides: {',
    '        "mainSeriesProperties.candleStyle.upColor": "' + COLOR_UP + '",',
    '        "mainSeriesProperties.candleStyle.downColor": "' + COLOR_DN + '",',
    '        "mainSeriesProperties.candleStyle.borderUpColor": "' + COLOR_UP + '",',
    '        "mainSeriesProperties.candleStyle.borderDownColor": "' + COLOR_DN + '",',
    '        "mainSeriesProperties.candleStyle.wickUpColor": "' + COLOR_UP + '",',
    '        "mainSeriesProperties.candleStyle.wickDownColor": "' + COLOR_DN + '",',
    '        "mainSeriesProperties.candleStyle.drawWick": true,',
    '        "mainSeriesProperties.candleStyle.drawBorder": true,',
    '        "mainSeriesProperties.candleStyle.barColorsOnPrevClose": false,',
    '        "paneProperties.background": "' + COLOR_BG + '",',
    '        "paneProperties.backgroundType": "solid",',
    '        "paneProperties.vertGridProperties.color": "rgba(255,255,255,0.04)",',
    '        "paneProperties.horzGridProperties.color": "rgba(255,255,255,0.04)",',
    '        "scalesProperties.backgroundColor": "' + COLOR_BG + '",',
    '        "scalesProperties.textColor": "#9aa4ad",',
    '        "scalesProperties.lineColor": "rgba(255,255,255,0.15)",',
    '        "scalesProperties.fontSize": 14,',
    '        "barSpacing": 8,',
    '        "drawBorder": true,',
    '        "drawWick": true',
    '      }',
    '    });',
    '    window.__ATLAS_ready = true;',
    '  } catch(e) {',
    '    window.__ATLAS_error = e.message;',
    '    window.__ATLAS_ready = true;',
    '  }',
    '})();',
    '</script>',
    '</body></html>'
  ].join('\n');
}

async function waitForCandles(page, timeoutMs) {
  timeoutMs = timeoutMs || 25000;
  var deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    var found = await page.evaluate(function() {
      var canvases = Array.from(document.querySelectorAll('.tv-lightweight-charts canvas'));
      if (canvases.length === 0) {
        try {
          for (var frame of document.querySelectorAll('iframe')) {
            try {
              var fd = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
              if (fd) canvases = canvases.concat(Array.from(fd.querySelectorAll('.tv-lightweight-charts canvas')));
            } catch(e) {}
          }
        } catch(e) {}
      }
      if (canvases.length === 0) canvases = Array.from(document.querySelectorAll('canvas'));
      for (var canvas of canvases) {
        try {
          var w = canvas.width, h = canvas.height;
          if (w < 100 || h < 100) continue;
          var ctx = canvas.getContext('2d');
          if (!ctx) continue;
          var scanH = Math.min(h, Math.round(h * 0.4));
          var data = ctx.getImageData(0, 0, w, scanH).data;
          for (var i = 0; i < data.length; i += 4) {
            var r = data[i], g = data[i+1], b = data[i+2];
            if ((g > 180 && r < 80 && b < 80) || (r > 180 && g < 80 && b < 80)) return true;
          }
        } catch(e) {}
      }
      return false;
    });
    if (found) return true;
    await new Promise(function(r) { setTimeout(r, 400); });
  }
  return false;
}

async function makePlaceholder(symbol, tfLabel) {
  var svg = '<svg width="' + CHART_W + '" height="' + CHART_H + '" xmlns="http://www.w3.org/2000/svg">'
    + '<rect width="' + CHART_W + '" height="' + CHART_H + '" fill="' + COLOR_BG + '"/>'
    + '<text x="' + (CHART_W/2) + '" y="' + (CHART_H/2 - 24) + '" font-family="monospace" font-size="52" fill="#2a2a2a" text-anchor="middle">' + symbol + '</text>'
    + '<text x="' + (CHART_W/2) + '" y="' + (CHART_H/2 + 40) + '" font-family="monospace" font-size="32" fill="#1e1e1e" text-anchor="middle">' + tfLabel + ' - NO DATA</text>'
    + '</svg>';
  return sharp(Buffer.from(svg)).resize(CHART_W, CHART_H).png().toBuffer();
}

async function addTfLabel(imgBuf, tfLabel) {
  var lw = tfLabel.length * 13 + 24;
  var svg = '<svg width="' + CHART_W + '" height="' + CHART_H + '" xmlns="http://www.w3.org/2000/svg">'
    + '<rect x="8" y="8" width="' + lw + '" height="30" fill="rgba(0,0,0,0.70)" rx="2"/>'
    + '<text x="20" y="29" font-family="monospace" font-size="16" font-weight="bold" fill="#9aa4ad">' + tfLabel + '</text>'
    + '</svg>';
  return sharp(imgBuf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

async function buildGrid(panels, intervals) {
  var labelled = await Promise.all(panels.map(async function(img, i) {
    var base = await sharp(img).resize(CHART_W, CHART_H, { fit: 'fill' }).png().toBuffer();
    return addTfLabel(base, TF_LABELS[intervals[i]] || intervals[i]);
  }));
  var gw = CHART_W * 2;
  var gh = CHART_H * 2;
  var divSvg = '<svg width="' + gw + '" height="' + gh + '" xmlns="http://www.w3.org/2000/svg">'
    + '<line x1="' + CHART_W + '" y1="0" x2="' + CHART_W + '" y2="' + gh + '" stroke="#1A1A1A" stroke-width="2"/>'
    + '<line x1="0" y1="' + CHART_H + '" x2="' + gw + '" y2="' + CHART_H + '" stroke="#1A1A1A" stroke-width="2"/>'
    + '</svg>';
  return sharp({ create: { width: gw, height: gh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([
      { input: labelled[0], left: 0,       top: 0       },
      { input: labelled[1], left: CHART_W, top: 0       },
      { input: labelled[2], left: 0,       top: CHART_H },
      { input: labelled[3], left: CHART_W, top: CHART_H },
      { input: Buffer.from(divSvg), left: 0, top: 0     },
    ])
    .png({ compressionLevel: 6 })
    .toBuffer();
}

async function renderOneChart(browser, symbol, interval) {
  var tvSymbol   = getTVSymbol(symbol);
  var tvInterval = TV_INTERVAL_MAP[interval] || interval;
  var tfLabel    = TF_LABELS[interval] || interval;
  var page = await browser.newPage();
  try {
    await page.setViewport({ width: CHART_W, height: CHART_H });
    if (TV_COOKIES && TV_COOKIES.length > 0) {
      await page.setCookie.apply(page, TV_COOKIES);
    }
    var html = buildWidgetHTML(tvSymbol, tvInterval);
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(
      'typeof TradingView !== "undefined"',
      { timeout: 15000 }
    ).catch(function() {
      throw new Error('TradingView script timeout - ' + symbol + ' ' + interval);
    });
    var candlesReady = await waitForCandles(page, 25000);
    if (!candlesReady) {
      console.warn('[RENDERER] ' + symbol + ' ' + interval + ' - candles not detected; using placeholder');
      return makePlaceholder(symbol, tfLabel);
    }
    await new Promise(function(r) { setTimeout(r, 300); });
    var shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: CHART_W, height: CHART_H } });
    console.log('[RENDERER] ' + symbol + ' ' + interval + ' - captured');
    return shot;
  } catch (e) {
    console.error('[RENDERER] ' + symbol + ' ' + interval + ' - error: ' + e.message);
    return makePlaceholder(symbol, tfLabel);
  } finally {
    try { await page.close(); } catch(e) {}
  }
}

async function renderAllPanels(symbol) {
  var sym = String(symbol || 'UNKNOWN').toUpperCase();
  console.log('[RENDERER] ' + sym + ' - render start');
  var t0 = Date.now();
  var browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    var allIntervals = HTF_INTERVALS.concat(LTF_INTERVALS);
    var allPanels = [];
    for (var i = 0; i < allIntervals.length; i++) {
      var panel = await renderOneChart(browser, sym, allIntervals[i]);
      allPanels.push(panel);
      if (i < allIntervals.length - 1) {
        await new Promise(function(r) { setTimeout(r, 250); });
      }
    }
    var htfPanels = allPanels.slice(0, 4);
    var ltfPanels = allPanels.slice(4, 8);
    var grids = await Promise.all([
      buildGrid(htfPanels, HTF_INTERVALS),
      buildGrid(ltfPanels, LTF_INTERVALS)
    ]);
    var elapsed = Math.round((Date.now() - t0) / 1000);
    console.log('[RENDERER] ' + sym + ' - complete in ' + elapsed + 's');
    return {
      htfGrid:     grids[0],
      ltfGrid:     grids[1],
      htfGridName: sym + '_HTF.png',
      ltfGridName: sym + '_LTF.png'
    };
  } catch (e) {
    console.error('[RENDERER] ' + sym + ' - fatal: ' + e.message);
    throw e;
  } finally {
    if (browser) { try { await browser.close(); } catch(e) {} }
  }
}

module.exports = { renderAllPanels };
