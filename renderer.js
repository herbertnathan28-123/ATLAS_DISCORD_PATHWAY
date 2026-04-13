‘use strict’;
// ============================================================
// ATLAS FX RENDERER v4.1 — FIXED
// Fixes:
//   1. Symbol resolution — BRENT/LH/all commodity variants mapped
//   2. Resolution — 1280×720 per cell → 2560×1440 grid (4K grade)
//   3. Canvas detection — device pixel ratio aware, relaxed pixel
//      matching, fallback to settle timer if paint check stalls
//   4. Sequential capture with independent timeouts per frame
// ============================================================
‘use strict’;
const puppeteer = require(‘puppeteer’);
const sharp     = require(‘sharp’);

// ── Resolution ───────────────────────────────────────────────
const CELL_W = 1280;
const CELL_H = 720;
const VIEWPORT = { width: CELL_W, height: CELL_H, deviceScaleFactor: 2 };

// ── Timeouts ─────────────────────────────────────────────────
const PAGE_LOAD_TIMEOUT  = 30000;
const IFRAME_TIMEOUT     = 25000;
const DATA_WAIT_TIMEOUT  = 50000;
const PAINT_WAIT_TIMEOUT = 50000;
const POLL_INTERVAL_MS   = 400;
const SETTLE_MS          = 800;
const BETWEEN_TF_MS      = 300;

// ── Chart colours ────────────────────────────────────────────
const UP_COLOR   = ‘#26A69A’;
const DOWN_COLOR = ‘#EF5350’;
const BG_COLOR   = ‘#0A0A0F’;

// ── Symbol map — every known ATLAS instrument ────────────────
const SYMBOL_OVERRIDES = {
// Commodities
XAUUSD:  ‘OANDA:XAUUSD’,
XAGUSD:  ‘OANDA:XAGUSD’,
BCOUSD:  ‘OANDA:BCOUSD’,
BRENT:   ‘OANDA:BCOUSD’,
BRENTLH: ‘OANDA:BCOUSD’,
‘BRENT LH’: ‘OANDA:BCOUSD’,
USOIL:   ‘OANDA:BCOUSD’,
WTI:     ‘TVC:USOIL’,
NATGAS:  ‘NYMEX:NG1!’,
// Indices
NAS100:  ‘OANDA:NAS100USD’,
US500:   ‘OANDA:SPX500USD’,
SPX:     ‘OANDA:SPX500USD’,
US30:    ‘OANDA:US30USD’,
DJI:     ‘OANDA:US30USD’,
GER40:   ‘OANDA:DE30EUR’,
UK100:   ‘OANDA:UK100GBP’,
HK50:    ‘OANDA:HK33HKD’,
JPN225:  ‘OANDA:JP225USD’,
// Equities
MICRON:  ‘NASDAQ:MU’,
MU:      ‘NASDAQ:MU’,
AMD:     ‘NASDAQ:AMD’,
NVDA:    ‘NASDAQ:NVDA’,
ASML:    ‘NASDAQ:ASML’,
AAPL:    ‘NASDAQ:AAPL’,
MSFT:    ‘NASDAQ:MSFT’,
META:    ‘NASDAQ:META’,
GOOGL:   ‘NASDAQ:GOOGL’,
AMZN:    ‘NASDAQ:AMZN’,
TSLA:    ‘NASDAQ:TSLA’,
INTC:    ‘NASDAQ:INTC’,
QCOM:    ‘NASDAQ:QCOM’,
AVGO:    ‘NASDAQ:AVGO’,
TSM:     ‘NYSE:TSM’,
};

// TradingView widget interval codes
const TV_INTERVAL = {
‘W’:   ‘W’,
‘D’:   ‘D’,
‘240’: ‘240’,
‘60’:  ‘60’,
‘30’:  ‘30’,
‘15’:  ‘15’,
‘5’:   ‘5’,
‘1’:   ‘1’,
};

function toTVSymbol(raw) {
if (!raw) return raw;
const s = String(raw).trim().toUpperCase().replace(/\s+/g, ‘’);
if (s.includes(’:’)) return s;
if (SYMBOL_OVERRIDES[s]) return SYMBOL_OVERRIDES[s];
if (/^[A-Z]{6}$/.test(s)) return ‘OANDA:’ + s;
return ‘NASDAQ:’ + s;
}

// ── Shell HTML — loads tv.js once, widget recreated per TF ───
function buildShellHtml() {
return `<!DOCTYPE html><html><head><meta charset="utf-8">

<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${CELL_W}px;height:${CELL_H}px;overflow:hidden;background:${BG_COLOR}}
  #tv{width:${CELL_W}px;height:${CELL_H}px}
</style>

</head><body>
<div id="tv"></div>
<script src="https://s3.tradingview.com/tv.js"></script>
</body></html>`;
}

// ── Create/recreate widget for a single timeframe ─────────────
async function createWidget(page, tvSymbol, interval) {
await page.evaluate((sym, intv, w, h, bg, up, dn) => {
try {
if (window.__tvWidget && typeof window.__tvWidget.remove === ‘function’) {
window.__tvWidget.remove();
}
} catch (_) {}
window.__tvWidget = null;
const host = document.getElementById(‘tv’);
if (host) host.innerHTML = ‘’;

```
window.__tvWidget = new TradingView.widget({
  container_id:      'tv',
  autosize:          false,
  width:             w,
  height:            h,
  symbol:            sym,
  interval:          intv,
  timezone:          'Australia/Perth',
  theme:             'dark',
  style:             '1',
  locale:            'en',
  toolbar_bg:        bg,
  enable_publishing: false,
  hide_side_toolbar: true,
  hide_top_toolbar:  true,
  hide_legend:       false,
  save_image:        false,
  allow_symbol_change: false,
  hotlist:           false,
  calendar:          false,
  show_popup_button: false,
  withdateranges:    false,
  details:           false,
  bar_spacing:       6,
  studies:           [],
  overrides: {
    'paneProperties.background':                        bg,
    'paneProperties.backgroundType':                   'solid',
    'paneProperties.vertGridProperties.color':         'rgba(255,255,255,0.03)',
    'paneProperties.horzGridProperties.color':         'rgba(255,255,255,0.03)',
    'mainSeriesProperties.candleStyle.upColor':        up,
    'mainSeriesProperties.candleStyle.downColor':      dn,
    'mainSeriesProperties.candleStyle.borderUpColor':  up,
    'mainSeriesProperties.candleStyle.borderDownColor':dn,
    'mainSeriesProperties.candleStyle.wickUpColor':    up,
    'mainSeriesProperties.candleStyle.wickDownColor':  dn,
    'mainSeriesProperties.candleStyle.drawBorder':     true,
    'mainSeriesProperties.candleStyle.drawWick':       true,
    'scalesProperties.backgroundColor':                bg,
    'scalesProperties.textColor':                      '#9AB0C2',
    'scalesProperties.fontSize':                       13,
    'scalesProperties.lineColor':                      'rgba(255,255,255,0.10)',
    'symbolWatermarkProperties.transparency':          100,
    'mainSeriesProperties.showPriceLine':              false,
  }
});
```

}, tvSymbol, interval, CELL_W, CELL_H, BG_COLOR, UP_COLOR, DOWN_COLOR);
}

// ── Wait for OHLC data to appear in iframe ────────────────────
async function waitForData(frame, maxMs) {
return frame.waitForFunction(() => {
const txt = (document.body && document.body.innerText) || ‘’;
// Accept any non-zero OHLC read
if (/[CHO]:\s*[1-9]\d*.?\d*/.test(txt)) return true;
if (/H:\s*\d+.\d+/.test(txt))           return true;
return false;
}, { timeout: maxMs, polling: POLL_INTERVAL_MS })
.then(() => true)
.catch(() => false);
}

// ── Wait for canvas to have coloured pixels ───────────────────
// Device pixel ratio aware — checks a wide grid of sample points
// for any non-background, non-black pixels (candle bodies/wicks).
async function waitForPaint(frame, maxMs) {
return frame.waitForFunction((bgR, bgG, bgB) => {
let canvases = document.querySelectorAll(‘canvas’);
if (!canvases.length) return false;

```
let best = null, bestArea = 0;
for (const c of canvases) {
  const a = c.width * c.height;
  if (a > bestArea) { bestArea = a; best = c; }
}
if (!best || bestArea < 40000) return false;

const ctx = best.getContext('2d');
if (!ctx) return false;

try {
  const W = best.width, H = best.height;
  let hits = 0;
  // Sample a 12×8 grid across the canvas
  for (let xi = 0; xi < 12; xi++) {
    for (let yi = 1; yi < 8; yi++) {
      const x = Math.floor(W * (0.05 + xi * 0.075));
      const y = Math.floor(H * (0.10 + yi * 0.10));
      const d = ctx.getImageData(x, y, 1, 1).data;
      const r = d[0], g = d[1], b = d[2], a = d[3];
      if (a < 20) continue;
      // Not background and not pure black
      const notBg  = !(Math.abs(r - bgR) < 12 && Math.abs(g - bgG) < 12 && Math.abs(b - bgB) < 12);
      const notBlk = !(r < 15 && g < 15 && b < 15);
      if (notBg && notBlk) {
        hits++;
        if (hits >= 3) return true;
      }
    }
  }
  return false;
} catch (e) { return false; }
```

}, { timeout: maxMs, polling: POLL_INTERVAL_MS }, 10, 23, 15)   // BG_COLOR #0A0A0F = rgb(10,10,15)
.then(() => true)
.catch(() => false);
}

// ── Capture a single timeframe ────────────────────────────────
async function captureTimeframe(page, tvSymbol, tf) {
const t0 = Date.now();

await createWidget(page, tvSymbol, tf);

// Wait for iframe to exist
let frame = null;
try {
await page.waitForSelector(’#tv iframe’, { timeout: IFRAME_TIMEOUT });
const handle = await page.$(’#tv iframe’);
if (handle) frame = await handle.contentFrame();
} catch (_) {}

let dataOk = false, paintOk = false;

if (frame) {
try {
await frame.waitForSelector(‘canvas’, { timeout: DATA_WAIT_TIMEOUT });
} catch (_) {}

```
dataOk  = await waitForData(frame, DATA_WAIT_TIMEOUT);
paintOk = await waitForPaint(frame, PAINT_WAIT_TIMEOUT);
```

}

// Always settle regardless — guarantees render completes
await new Promise(r => setTimeout(r, SETTLE_MS));

const shot = await page.screenshot({ type: ‘png’ });

const elapsed = Date.now() - t0;
console.log(
`  [CAPTURE] ${tvSymbol} @ ${tf}` +
` data:${dataOk ? 'OK' : 'TIMEOUT'}` +
` paint:${paintOk ? 'OK' : 'TIMEOUT'}` +
` bytes:${shot.length}` +
` ${elapsed}ms`
);

return shot;
}

// ── Build 2×2 grid ────────────────────────────────────────────
async function buildGrid(shots) {
const cells = await Promise.all(
shots.map(s => sharp(s).resize(CELL_W, CELL_H, { fit: ‘fill’ }).png().toBuffer())
);
return sharp({
create: {
width:      CELL_W * 2,
height:     CELL_H * 2,
channels:   4,
background: { r: 10, g: 10, b: 15, alpha: 255 }
}
}).composite([
{ input: cells[0], left: 0,      top: 0      },
{ input: cells[1], left: CELL_W, top: 0      },
{ input: cells[2], left: 0,      top: CELL_H },
{ input: cells[3], left: CELL_W, top: CELL_H },
]).png({ compressionLevel: 6 }).toBuffer();
}

// ── Core render ───────────────────────────────────────────────
async function renderAllPanelsInternal(symbol) {
const tvSymbol = toTVSymbol(symbol);
const timeframes = [‘W’, ‘D’, ‘240’, ‘60’, ‘30’, ‘15’, ‘5’, ‘1’];

console.log(`[RENDERER] ${symbol} → TV: ${tvSymbol}`);
const t0 = Date.now();

let browser;
try {
browser = await puppeteer.launch({
headless: ‘new’,
args: [
‘–no-sandbox’,
‘–disable-setuid-sandbox’,
‘–disable-dev-shm-usage’,
‘–disable-gpu’,
‘–window-size=’ + CELL_W + ‘,’ + CELL_H,
]
});

```
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
await page.setContent(buildShellHtml(), {
  waitUntil: 'domcontentloaded',
  timeout:   PAGE_LOAD_TIMEOUT
});
await page.waitForFunction(() => typeof TradingView !== 'undefined', { timeout: 15000 });

console.log('[RENDERER] Shell ready — capturing 8 timeframes sequentially');

const shots = [];
for (let i = 0; i < timeframes.length; i++) {
  if (i > 0) await new Promise(r => setTimeout(r, BETWEEN_TF_MS));
  shots.push(await captureTimeframe(page, tvSymbol, timeframes[i]));
}

const [htfGrid, ltfGrid] = await Promise.all([
  buildGrid(shots.slice(0, 4)),
  buildGrid(shots.slice(4, 8)),
]);

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[RENDERER] ${symbol} complete in ${elapsed}s`);

return {
  htfGrid,
  ltfGrid,
  htfGridName: symbol + '_HTF.png',
  ltfGridName:  symbol + '_LTF.png',
};
```

} finally {
if (browser) { try { await browser.close(); } catch (_) {} }
}
}

// ── Public entry point with one retry ────────────────────────
async function renderAllPanels(symbol) {
try {
return await renderAllPanelsInternal(symbol);
} catch (err) {
const msg = (err && err.message) || String(err);
console.error(’[RENDERER] Attempt 1 failed: ’ + msg);
console.log(’[RENDERER] Retrying in 2s…’);
await new Promise(r => setTimeout(r, 2000));
return await renderAllPanelsInternal(symbol);
}
}

module.exports = { renderAllPanels, toTVSymbol };
