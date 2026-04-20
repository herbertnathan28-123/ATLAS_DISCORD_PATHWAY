‘use strict’;
// ============================================================
// ATLAS FX RENDERER — Puppeteer + TradingView Widget
// Architecture: destroy-and-recreate per timeframe (W/D/240/60/30/15/5/1)
// All 6 fixes from CLAUDE.md applied.
//
// Interface (unchanged):
//   module.exports = { renderAllPanels }
//   renderAllPanels(symbol) -> Promise<{
//     htfGrid:     Buffer (PNG),
//     ltfGrid:     Buffer (PNG),
//     htfGridName: string,
//     ltfGridName: string
//   }>
// ============================================================

const puppeteer = require(‘puppeteer’);
const sharp     = require(‘sharp’);

const CHART_W = 1920;
const CHART_H = 1080;

// Locked colour codes — CLAUDE.md / never change
const COLOR_UP = ‘#00ff00’;
const COLOR_DN = ‘#ff0015’;
const COLOR_BG = ‘#131722’;

const HTF_INTERVALS = [‘1W’, ‘1D’, ‘240’, ‘60’];
const LTF_INTERVALS = [‘30’, ‘15’, ‘5’, ‘1’];

// TradingView interval strings
const TV_INTERVAL_MAP = {
‘1W’: ‘W’, ‘1D’: ‘D’, ‘240’: ‘240’, ‘60’: ‘60’,
‘30’: ‘30’, ‘15’: ‘15’, ‘5’: ‘5’, ‘1’: ‘1’
};

const TF_LABELS = {
‘1W’: ‘Weekly’, ‘1D’: ‘Daily’, ‘240’: ‘4H’, ‘60’: ‘1H’,
‘30’: ‘30M’, ‘15’: ‘15M’, ‘5’: ‘5M’, ‘1’: ‘1M’
};

// TradingView symbol overrides — same set as index.js
const SYMBOL_OVERRIDES = {
XAUUSD: ‘OANDA:XAUUSD’,    XAGUSD: ‘OANDA:XAGUSD’,
BCOUSD: ‘OANDA:BCOUSD’,    USOIL:  ‘OANDA:BCOUSD’,
NAS100: ‘OANDA:NAS100USD’, US500:  ‘OANDA:SPX500USD’,
US30:   ‘OANDA:US30USD’,   GER40:  ‘OANDA:DE30EUR’,
UK100:  ‘OANDA:UK100GBP’,  NATGAS: ‘NYMEX:NG1!’,
MICRON: ‘NASDAQ:MU’,       AMD:    ‘NASDAQ:AMD’,
ASML:   ‘NASDAQ:ASML’,     NVDA:   ‘NASDAQ:NVDA’,
EURUSD: ‘OANDA:EURUSD’,    GBPUSD: ‘OANDA:GBPUSD’,
USDJPY: ‘OANDA:USDJPY’,    AUDUSD: ‘OANDA:AUDUSD’,
NZDUSD: ‘OANDA:NZDUSD’,    USDCAD: ‘OANDA:USDCAD’,
USDCHF: ‘OANDA:USDCHF’,    AUDJPY: ‘OANDA:AUDJPY’,
GBPJPY: ‘OANDA:GBPJPY’,    EURGBP: ‘OANDA:EURGBP’,
EURJPY: ‘OANDA:EURJPY’,    CADJPY: ‘OANDA:CADJPY’,
};

function getTVSymbol(symbol) {
if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];
if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;
return `NASDAQ:${symbol}`;
}

// ── Cookie loader ─────────────────────────────────────────────
// Mirrors sanitiseCookies from index.js so cookies work identically.
const SAMESITE_MAP = { strict: ‘Strict’, lax: ‘Lax’, none: ‘None’, no_restriction: ‘None’, unspecified: ‘Lax’ };
const ALLOWED_COOKIE_FIELDS = new Set([‘name’,‘value’,‘domain’,‘path’,‘expires’,‘httpOnly’,‘secure’,‘sameSite’]);
function sanitiseCookies(raw) {
return raw.map(c => {
const out = {};
for (const f of ALLOWED_COOKIE_FIELDS) { if (c[f] !== undefined) out[f] = c[f]; }
out.sameSite = SAMESITE_MAP[String(c.sameSite || ‘’).toLowerCase()] || ‘Lax’;
if (!out.domain) out.domain = ‘.tradingview.com’;
if (!out.path)   out.path   = ‘/’;
if (!out.expires && c.expirationDate) out.expires = c.expirationDate;
return out;
}).filter(c => c.domain && c.domain.includes(‘tradingview’));
}

let TV_COOKIES = null;
try {
if (process.env.TV_COOKIES) {
TV_COOKIES = sanitiseCookies(JSON.parse(process.env.TV_COOKIES));
console.log(`[RENDERER] TV_COOKIES: ${TV_COOKIES.length} cookies loaded`);
}
} catch (e) {
console.error(’[RENDERER] TV_COOKIES parse error:’, e.message);
}

// ── HTML builder ──────────────────────────────────────────────
// One widget per page — destroy-and-recreate architecture.
// FIX 5 and FIX 6 overrides baked in.
function buildWidgetHTML(tvSymbol, tvInterval) {
return `<!DOCTYPE html>

<html>
<head>
<meta charset="utf-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:${CHART_W}px; height:${CHART_H}px; background:${COLOR_BG}; overflow:hidden; }
#tv_chart { width:${CHART_W}px; height:${CHART_H}px; }
</style>
<!-- FIX 3: Script in <head> so DOM is ready before widget init runs -->
<script src="https://s3.tradingview.com/tv.js"></script>
</head>
<body>
<div id="tv_chart"></div>
<script>
window.__ATLAS_ready = false;
window.__ATLAS_error = null;

// FIX 3: Poll until TradingView is defined before creating widget
(function tryInit() {
if (typeof TradingView === ‘undefined’) {
setTimeout(tryInit, 50);
return;
}
try {
new TradingView.widget({
autosize:          false,
width:             ${CHART_W},
height:            ${CHART_H},
symbol:            ‘${tvSymbol}’,
interval:          ‘${tvInterval}’,
timezone:          ‘Australia/Perth’,
theme:             ‘dark’,
style:             ‘1’,
locale:            ‘en’,
toolbar_bg:        ‘${COLOR_BG}’,
backgroundColor:   ‘${COLOR_BG}’,
// FIX 6: Hide all TradingView UI chrome
hide_side_toolbar: true,
hide_top_toolbar:  true,
withdateranges:    false,
details:           false,
calendar:          false,
hotlist:           false,
container_id:      ‘tv_chart’,
overrides: {
// Locked candle colours
‘mainSeriesProperties.candleStyle.upColor’:        ‘${COLOR_UP}’,
‘mainSeriesProperties.candleStyle.downColor’:      ‘${COLOR_DN}’,
‘mainSeriesProperties.candleStyle.borderUpColor’:  ‘${COLOR_UP}’,
‘mainSeriesProperties.candleStyle.borderDownColor’:’${COLOR_DN}’,
‘mainSeriesProperties.candleStyle.wickUpColor’:    ‘${COLOR_UP}’,
‘mainSeriesProperties.candleStyle.wickDownColor’:  ‘${COLOR_DN}’,
// FIX 5: Candle visibility
‘mainSeriesProperties.candleStyle.drawWick’:             true,
‘mainSeriesProperties.candleStyle.drawBorder’:           true,
‘mainSeriesProperties.candleStyle.barColorsOnPrevClose’: false,
// Background / grid
‘paneProperties.background’:                 ‘${COLOR_BG}’,
‘paneProperties.backgroundType’:             ‘solid’,
‘paneProperties.vertGridProperties.color’:   ‘rgba(255,255,255,0.04)’,
‘paneProperties.horzGridProperties.color’:   ‘rgba(255,255,255,0.04)’,
// FIX 5: Scale / spacing overrides
‘scalesProperties.backgroundColor’: ‘${COLOR_BG}’,
‘scalesProperties.textColor’:       ‘#9aa4ad’,
‘scalesProperties.lineColor’:       ‘rgba(255,255,255,0.15)’,
‘scalesProperties.fontSize’:         14,
‘barSpacing’:   8,
‘drawBorder’:   true,
‘drawWick’:     true,
}
});
window.__ATLAS_ready = true;
} catch (e) {
window.__ATLAS_error = e.message;
window.__ATLAS_ready = true; // signal done even on error
}
})();
</script>

</body>
</html>`;
}

// ── Canvas detection ──────────────────────────────────────────
// Polls until candle-coloured pixels are found or timeout expires.
// FIX 1: Range-based RGB detection (anti-aliasing safe)
// FIX 4: Scoped to .tv-lightweight-charts canvas
async function waitForCandles(page, timeoutMs = 25000) {
const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
const found = await page.evaluate(() => {
// FIX 4: Target scoped canvas; fall back to any canvas if not present yet
let canvases = Array.from(document.querySelectorAll(’.tv-lightweight-charts canvas’));
if (canvases.length === 0) {
// Also check inside iframes if same-origin (–disable-web-security)
try {
for (const frame of document.querySelectorAll(‘iframe’)) {
try {
const fd = frame.contentDocument || frame.contentWindow?.document;
if (fd) canvases = canvases.concat(Array.from(fd.querySelectorAll(’.tv-lightweight-charts canvas’)));
} catch (*) {}
}
} catch (*) {}
}
if (canvases.length === 0) canvases = Array.from(document.querySelectorAll(‘canvas’));

```
  for (const canvas of canvases) {
    try {
      const w = canvas.width, h = canvas.height;
      if (w < 100 || h < 100) continue;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      // Sample the upper 40% of canvas where candles appear
      const scanH = Math.min(h, Math.round(h * 0.4));
      const data  = ctx.getImageData(0, 0, w, scanH).data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // FIX 1: Range-based detection — tolerates anti-aliasing
        const isUp = g > 180 && r < 80  && b < 80;   // green candle
        const isDn = r > 180 && g < 80  && b < 80;   // red candle
        if (isUp || isDn) return true;
      }
    } catch (_) {}
  }
  return false;
});

if (found) return true;
await new Promise(r => setTimeout(r, 400));
```

}
return false;
}

// ── Placeholder ───────────────────────────────────────────────
async function makePlaceholder(symbol, tfLabel) {
const svg = `<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg"> <rect width="${CHART_W}" height="${CHART_H}" fill="${COLOR_BG}"/> <text x="${CHART_W / 2}" y="${CHART_H / 2 - 24}" font-family="monospace" font-size="52" fill="#2a2a2a" text-anchor="middle">${symbol}</text> <text x="${CHART_W / 2}" y="${CHART_H / 2 + 40}" font-family="monospace" font-size="32" fill="#1e1e1e" text-anchor="middle">${tfLabel} — NO DATA</text> </svg>`;
return sharp(Buffer.from(svg)).resize(CHART_W, CHART_H).png().toBuffer();
}

// ── TF label overlay ─────────────────────────────────────────
async function addTfLabel(imgBuf, tfLabel) {
const lw = tfLabel.length * 13 + 24;
const svg = `<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg"> <rect x="8" y="8" width="${lw}" height="30" fill="rgba(0,0,0,0.70)" rx="2"/> <text x="20" y="29" font-family="monospace" font-size="16" font-weight="bold" fill="#9aa4ad">${tfLabel}</text> </svg>`;
return sharp(imgBuf)
.composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
.png()
.toBuffer();
}

// ── Grid assembler ────────────────────────────────────────────
async function buildGrid(panels, intervals) {
const labelled = await Promise.all(panels.map(async (img, i) => {
const base = await sharp(img).resize(CHART_W, CHART_H, { fit: ‘fill’ }).png().toBuffer();
return addTfLabel(base, TF_LABELS[intervals[i]] || intervals[i]);
}));

const gw = CHART_W * 2;
const gh = CHART_H * 2;

const divSvg = `<svg width="${gw}" height="${gh}" xmlns="http://www.w3.org/2000/svg"> <line x1="${CHART_W}" y1="0"       x2="${CHART_W}" y2="${gh}"    stroke="#1A1A1A" stroke-width="2"/> <line x1="0"          y1="${CHART_H}" x2="${gw}" y2="${CHART_H}" stroke="#1A1A1A" stroke-width="2"/> </svg>`;

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

// ── Single-chart renderer ─────────────────────────────────────
// Opens one page, creates one widget, screenshots, closes page.
// Destroy-and-recreate: no widget survives past its own capture.
async function renderOneChart(browser, symbol, interval) {
const tvSymbol  = getTVSymbol(symbol);
const tvInterval = TV_INTERVAL_MAP[interval] || interval;
const tfLabel   = TF_LABELS[interval] || interval;

const page = await browser.newPage();
try {
await page.setViewport({ width: CHART_W, height: CHART_H });

```
// Inject cookies for authenticated TradingView access
if (TV_COOKIES && TV_COOKIES.length > 0) {
  await page.setCookie(...TV_COOKIES);
}

const html = buildWidgetHTML(tvSymbol, tvInterval);
// waitUntil: domcontentloaded — faster than networkidle; tv.js loads async anyway
await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });

// FIX 3: Explicit gate — don't create widget until TradingView is available
await page.waitForFunction(
  () => typeof TradingView !== 'undefined',
  { timeout: 15000 }
).catch(() => {
  throw new Error(`TradingView script timeout — ${symbol} ${interval}`);
});

// Wait for candle pixels (FIX 1 + FIX 4 applied inside waitForCandles)
const candlesReady = await waitForCandles(page, 25000);

if (!candlesReady) {
  console.warn(`[RENDERER] ${symbol} ${interval} — candles not detected; using placeholder`);
  return makePlaceholder(symbol, tfLabel);
}

// Short settle after detection to let the final frame paint
await new Promise(r => setTimeout(r, 300));

const shot = await page.screenshot({
  type: 'png',
  clip: { x: 0, y: 0, width: CHART_W, height: CHART_H }
});
console.log(`[RENDERER] ${symbol} ${interval} — captured`);
return shot;
```

} catch (e) {
console.error(`[RENDERER] ${symbol} ${interval} — error: ${e.message}`);
return makePlaceholder(symbol, tfLabel);
} finally {
try { await page.close(); } catch (_) {}
}
}

// ── Main export ───────────────────────────────────────────────
async function renderAllPanels(symbol) {
const sym = String(symbol || ‘UNKNOWN’).toUpperCase();
console.log(`[RENDERER] ${sym} — render start`);
const t0 = Date.now();

let browser;
try {
browser = await puppeteer.launch({
headless: ‘new’,
args: [
‘-–no-sandbox’,
‘–-disable-setuid-sandbox’,
‘–-disable-dev-shm-usage’,
‘–-disable-gpu’,
‘–-no-first-run’,
‘–-no-zygote’,
‘–-single-process’,
‘–-disable-web-security’,                    // required for cross-origin iframe canvas access (FIX 4)
‘–-disable-features=IsolateOrigins,site-per-process’,
]
});

```
const allIntervals = [...HTF_INTERVALS, ...LTF_INTERVALS]; // W D 240 60 30 15 5 1

const allPanels = [];
// FIX 2: Sequential widget creation, 250ms delay between each
for (let i = 0; i < allIntervals.length; i++) {
  const panel = await renderOneChart(browser, sym, allIntervals[i]);
  allPanels.push(panel);
  if (i < allIntervals.length - 1) {
    await new Promise(r => setTimeout(r, 250)); // FIX 2: 250ms inter-widget delay
  }
}

const htfPanels = allPanels.slice(0, 4); // W D 240 60
const ltfPanels = allPanels.slice(4, 8); // 30 15 5 1

const [htfGrid, ltfGrid] = await Promise.all([
  buildGrid(htfPanels, HTF_INTERVALS),
  buildGrid(ltfPanels, LTF_INTERVALS),
]);

const elapsed = Math.round((Date.now() - t0) / 1000);
console.log(`[RENDERER] ${sym} — complete in ${elapsed}s`);

return {
  htfGrid,
  ltfGrid,
  htfGridName: `${sym}_HTF.png`,
  ltfGridName: `${sym}_LTF.png`,
};
```

} catch (e) {
console.error(`[RENDERER] ${sym} — fatal: ${e.message}`);
throw e;
} finally {
if (browser) {
try { await browser.close(); } catch (_) {}
}
}
}

module.exports = { renderAllPanels };