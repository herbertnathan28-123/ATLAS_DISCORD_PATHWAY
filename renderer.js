'use strict';
// ============================================================
// ATLAS FX RENDERER — native canvas (no Chart.js, no Puppeteer)
// Draws candlesticks directly via the Canvas 2D API.
// Only external rendering dep: `canvas` (node-canvas).
//
// Interface (unchanged):
//   module.exports = { renderAllPanels }
//   renderAllPanels(symbol) -> Promise<{
//     htfGrid:     Buffer (PNG),
//     ltfGrid:     Buffer (PNG),
//     htfGridName: string,
//     ltfGridName: string
//   }>
//
// Layout:
//   HTF panels: 1W / 1D / 4H / 1H   (2x2)
//   LTF panels: 30M / 15M / 5M / 1M (2x2)
//   Each panel: 1920 x 1080.  Full grid: 3840 x 2160.
//
// Visual (locked):
//   background   #131722
//   bull candle  #07f911
//   bear candle  #ff0015
//   grid         rgba(255,255,255,0.04)
//   axis labels  #9aa4ad
//   tf label     #666b6a  15px
//   price boxes  HIGH #FFD600/#000  CURRENT #00FF5A/#000
//                ENTRY #FF9100/#000  LOW     #00B0FF/#FFF
// ============================================================

const https = require('https');
const { createCanvas } = require('canvas');

// -----------------------------------------------------------------
// TwelveData fetch — copied verbatim from build spec.
// -----------------------------------------------------------------
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || '';
const TD_SYMBOL_MAP = { XAUUSD:'XAU/USD',XAGUSD:'XAG/USD',NAS100:'NDX',US500:'SPX',US30:'DIA',DJI:'DIA',GER40:'DAX',UK100:'UKX',EURUSD:'EUR/USD',GBPUSD:'GBP/USD',USDJPY:'USD/JPY',AUDUSD:'AUD/USD',NZDUSD:'NZD/USD',USDCAD:'USD/CAD',USDCHF:'USD/CHF',MICRON:'MU',AMD:'AMD',NVDA:'NVDA',ASML:'ASML' };
const TD_INTERVAL_MAP = { '1W':'1week','1D':'1day','240':'4h','60':'1h','30':'30min','15':'15min','5':'5min','1':'1min' };
function fetchOHLC(symbol, resolution, count=150) {
  return new Promise((resolve) => {
    const tdSym = encodeURIComponent(TD_SYMBOL_MAP[symbol]||symbol);
    const tdInt = TD_INTERVAL_MAP[resolution]||'1day';
    const path = `/time_series?symbol=${tdSym}&interval=${tdInt}&outputsize=${count}&apikey=${TWELVE_DATA_KEY}&format=JSON`;
    const req = https.request({hostname:'api.twelvedata.com',path,method:'GET',timeout:15000},r=>{
      let data=''; r.on('data',c=>data+=c);
      r.on('end',()=>{ try{ const p=JSON.parse(data); if(!p.values){resolve([]);return;} resolve(p.values.slice().reverse().map(v=>({time:Math.floor(new Date(v.datetime).getTime()/1000),open:parseFloat(v.open),high:parseFloat(v.high),low:parseFloat(v.low),close:parseFloat(v.close)}))); }catch(e){resolve([]);} });
    });
    req.on('error',()=>resolve([])); req.on('timeout',()=>{req.destroy();resolve([]);}); req.end();
  });
}

// -----------------------------------------------------------------
// Visual spec — locked.
// -----------------------------------------------------------------
const CELL_W      = 1920;
const CELL_H      = 1080;
const BG_COLOR    = '#131722';
const BULL_COLOR  = '#07f911';
const BEAR_COLOR  = '#ff0015';
const GRID_COLOR  = 'rgba(255,255,255,0.04)';
const AXIS_COLOR  = '#9aa4ad';
const LABEL_COLOR = '#666b6a';

const CHART_PAD_TOP    = 48;
const CHART_PAD_BOTTOM = 28;
const CHART_PAD_LEFT   = 16;
const CHART_PAD_RIGHT  = 160;  // axis labels + price boxes live here

const BOX_W     = 120;
const BOX_H     = 36;
const BOX_GAP   = 4;
const BOX_EDGE  = 10;

const PALETTE = {
  HIGH:    { bg: '#FFD600', fg: '#000000' },
  CURRENT: { bg: '#00FF5A', fg: '#000000' },
  ENTRY:   { bg: '#FF9100', fg: '#000000' },
  LOW:     { bg: '#00B0FF', fg: '#FFFFFF' }
};

const HTF = [
  { res: '1W',  label: '1W' },
  { res: '1D',  label: '1D' },
  { res: '240', label: '4H' },
  { res: '60',  label: '1H' }
];
const LTF = [
  { res: '30', label: '30M' },
  { res: '15', label: '15M' },
  { res: '5',  label: '5M'  },
  { res: '1',  label: '1M'  }
];

// -----------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------
function fmtPrice(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(2);
  if (a >= 100)  return v.toFixed(3);
  if (a >= 10)   return v.toFixed(4);
  return v.toFixed(5);
}

// -----------------------------------------------------------------
// Single panel render — assumes ctx origin is at panel top-left.
// Caller passes panel dimensions W x H.
// -----------------------------------------------------------------
function drawPanel(ctx, W, H, candles, label) {
  // Panel background (defensive; grid canvas also fills bg).
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);

  // Timeframe label top-left.
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = '600 15px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, 20, 18);

  // No-data fallback.
  if (!candles || !candles.length) {
    ctx.fillStyle = AXIS_COLOR;
    ctx.font = '28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NO DATA', W / 2, H / 2);
    return;
  }

  // Chart plot area.
  const plotX = CHART_PAD_LEFT;
  const plotY = CHART_PAD_TOP;
  const plotW = W - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const plotH = H - CHART_PAD_TOP - CHART_PAD_BOTTOM;

  // Price range with small padding so extremes don't clip.
  let pmin = Infinity, pmax = -Infinity;
  for (const c of candles) {
    if (c.low  < pmin) pmin = c.low;
    if (c.high > pmax) pmax = c.high;
  }
  if (!isFinite(pmin) || !isFinite(pmax) || pmin === pmax) {
    pmax = (pmax || 1) + 1;
    pmin = (pmin || 0) - 1;
  }
  const pad = (pmax - pmin) * 0.05;
  pmin -= pad;
  pmax += pad;
  const pspan = pmax - pmin;
  const priceToY = (p) => plotY + plotH * (1 - (p - pmin) / pspan);

  // Horizontal gridlines + right-axis price labels.
  const GRID_LINES = 6;
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.fillStyle = AXIS_COLOR;
  ctx.font = '14px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= GRID_LINES; i++) {
    const y = plotY + (plotH * i) / GRID_LINES;
    ctx.beginPath();
    ctx.moveTo(plotX, Math.round(y) + 0.5);
    ctx.lineTo(plotX + plotW, Math.round(y) + 0.5);
    ctx.stroke();
    const price = pmax - (pspan * i) / GRID_LINES;
    ctx.fillText(fmtPrice(price), plotX + plotW + 6, y);
  }

  // Candlesticks.
  const N = candles.length;
  const slotW = plotW / N;
  const candleW = Math.max(2, Math.floor(slotW * 0.7));
  for (let i = 0; i < N; i++) {
    const c = candles[i];
    const cx = plotX + i * slotW + slotW / 2;
    const yOpen  = priceToY(c.open);
    const yClose = priceToY(c.close);
    const yHigh  = priceToY(c.high);
    const yLow   = priceToY(c.low);
    const isUp = c.close >= c.open;
    const col = isUp ? BULL_COLOR : BEAR_COLOR;

    // Wick.
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, yHigh);
    ctx.lineTo(Math.round(cx) + 0.5, yLow);
    ctx.stroke();

    // Body.
    ctx.fillStyle = col;
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH   = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillRect(Math.round(cx - candleW / 2), bodyTop, candleW, bodyH);
  }

  // Price boxes, right edge, vertically centred.
  const highs = candles.map(c => c.high);
  const lows  = candles.map(c => c.low);
  const last  = candles[candles.length - 1];
  drawPriceBoxes(ctx, W, H, {
    high:    Math.max(...highs),
    current: last.close,
    entry:   last.open,
    low:     Math.min(...lows)
  });
}

function drawPriceBoxes(ctx, W, H, prices) {
  const rows = [
    { key: 'HIGH',    val: prices.high    },
    { key: 'CURRENT', val: prices.current },
    { key: 'ENTRY',   val: prices.entry   },
    { key: 'LOW',     val: prices.low     }
  ];
  const totalH  = BOX_H * rows.length + BOX_GAP * (rows.length - 1);
  const startY  = Math.floor((H - totalH) / 2);
  const boxX    = W - BOX_W - BOX_EDGE;

  rows.forEach((r, i) => {
    const y   = startY + i * (BOX_H + BOX_GAP);
    const pal = PALETTE[r.key];

    ctx.fillStyle = pal.bg;
    ctx.fillRect(boxX, y, BOX_W, BOX_H);

    ctx.fillStyle = pal.fg;
    ctx.font = '700 10px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(r.key, boxX + 8, y + 4);

    ctx.font = '700 14px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmtPrice(r.val), boxX + BOX_W - 8, y + BOX_H - 4);
  });
}

// -----------------------------------------------------------------
// One 2x2 grid: fetch 4 timeframes in parallel, draw each panel
// into its quadrant of a single 3840x2160 canvas, encode once.
// -----------------------------------------------------------------
async function buildGrid(symbol, timeframes) {
  const GRID_W = CELL_W * 2;
  const GRID_H = CELL_H * 2;
  const gridCanvas = createCanvas(GRID_W, GRID_H);
  const ctx = gridCanvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, GRID_W, GRID_H);

  const datasets = await Promise.all(
    timeframes.map(tf => fetchOHLC(symbol, tf.res, 150).catch(() => []))
  );

  const positions = [
    { x: 0,       y: 0       },
    { x: CELL_W,  y: 0       },
    { x: 0,       y: CELL_H  },
    { x: CELL_W,  y: CELL_H  }
  ];

  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(positions[i].x, positions[i].y);
    ctx.beginPath();
    ctx.rect(0, 0, CELL_W, CELL_H);
    ctx.clip();
    drawPanel(ctx, CELL_W, CELL_H, datasets[i], timeframes[i].label);
    ctx.restore();
  }

  return gridCanvas.toBuffer('image/png');
}

// -----------------------------------------------------------------
// Public entry point. Returns the same shape as the previous
// Puppeteer / chartjs-node-canvas implementations.
// -----------------------------------------------------------------
async function renderAllPanels(symbol) {
  const t0 = Date.now();
  console.log('[RENDERER] Start ' + symbol);

  const [htfGrid, ltfGrid] = await Promise.all([
    buildGrid(symbol, HTF),
    buildGrid(symbol, LTF)
  ]);

  console.log('[RENDERER] Done ' + symbol + ' in ' + ((Date.now() - t0) / 1000).toFixed(2) + 's');

  return {
    htfGrid,
    ltfGrid,
    htfGridName: symbol + '_HTF.png',
    ltfGridName: symbol + '_LTF.png'
  };
}

module.exports = { renderAllPanels };
