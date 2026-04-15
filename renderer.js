'use strict';
// ============================================================
// ATLAS FX RENDERER — chartjs-node-canvas + chartjs-chart-financial
// Replaces Puppeteer + TradingView embed pipeline.
// Target: < 10s total for 8 panels delivered as 2 2x2 PNG grids.
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
// HTF panels: 1W / 1D / 4H / 1H   (2x2 grid)
// LTF panels: 30M / 15M / 5M / 1M (2x2 grid)
// Each panel: 1920 x 1080.  Full grid: 3840 x 2160.
// ============================================================

const https = require('https');
const sharp = require('sharp');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// -----------------------------------------------------------------
// Chart.js registration — defensive CJS resolve.
// chart.js@3.9.1's CJS main (`dist/chart.js`) exports the Chart class
// AS module.exports (a function) and does NOT expose `registerables` —
// instead it auto-registers all built-in controllers/scales/elements.
// chartjs-chart-financial@0.1.1 exports nothing via CJS; it
// auto-registers candlestick + ohlc by side-effect on require.
// Resolve both paths safely: use named exports if present, otherwise
// rely on the auto-registration side-effects already in effect.
// -----------------------------------------------------------------
const ChartJS = require('chart.js');
const Chart = ChartJS.Chart || ChartJS.default || ChartJS;
const registerables = ChartJS.registerables || Chart.registerables;
if (registerables) Chart.register(...registerables);
const financial = require('chartjs-chart-financial');
const CandlestickController = financial.CandlestickController;
const CandlestickElement = financial.CandlestickElement;
const OhlcController = financial.OhlcController;
const OhlcElement = financial.OhlcElement;
if (CandlestickController) Chart.register(CandlestickController, CandlestickElement, OhlcController, OhlcElement);

// -----------------------------------------------------------------
// TwelveData fetch — copied verbatim from build spec. Do not import.
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
// Visual spec — locked colours / geometry.
// -----------------------------------------------------------------
const CELL_W      = 1920;
const CELL_H      = 1080;
const BG_COLOR    = '#131722';
const BULL_COLOR  = '#07f911';
const BEAR_COLOR  = '#ff0015';
const GRID_COLOR  = 'rgba(255,255,255,0.04)';
const AXIS_COLOR  = '#9aa4ad';
const LABEL_COLOR = '#666b6a';

const BOX_W  = 120;
const BOX_H  = 36;
const BOX_RIGHT_PAD = 10;
const BOX_GAP       = 4;

const PALETTE = {
  HIGH:    { bg: '#FFD600', fg: '#000000' },
  CURRENT: { bg: '#00FF5A', fg: '#000000' },
  ENTRY:   { bg: '#FF9100', fg: '#000000' },
  LOW:     { bg: '#00B0FF', fg: '#FFFFFF' }
};

const UNIT_MS = {
  millisecond: 1,
  second:      1000,
  minute:      60 * 1000,
  hour:        60 * 60 * 1000,
  day:         24 * 60 * 60 * 1000,
  week:        7 * 24 * 60 * 60 * 1000,
  month:       30 * 24 * 60 * 60 * 1000,
  quarter:     91 * 24 * 60 * 60 * 1000,
  year:        365 * 24 * 60 * 60 * 1000
};

// -----------------------------------------------------------------
// Chart.js canvas renderer — single instance, reused.
// Candlestick controller/elements are already registered at module
// top. chartCallback only installs an inline date adapter so we
// don't need chartjs-adapter-* as a dependency.
// -----------------------------------------------------------------
const canvasRenderer = new ChartJSNodeCanvas({
  width: CELL_W,
  height: CELL_H,
  backgroundColour: BG_COLOR,
  chartCallback: (ChartJS) => {
    ChartJS._adapters._date.override({
      _id: 'atlas-date',
      formats: () => ({
        datetime:    'yyyy-MM-dd HH:mm',
        millisecond: 'HH:mm:ss.SSS',
        second:      'HH:mm:ss',
        minute:      'HH:mm',
        hour:        'HH:mm',
        day:         'MMM d',
        week:        'MMM d',
        month:       'MMM yyyy',
        quarter:     'qqq yyyy',
        year:        'yyyy'
      }),
      parse:  (v) => typeof v === 'number' ? v : new Date(v).getTime(),
      format: (v) => new Date(v).toISOString(),
      add:    (v, amount, unit) => v + amount * (UNIT_MS[unit] || 0),
      diff:   (a, b, unit)      => (a - b) / (UNIT_MS[unit] || 1),
      startOf: (v) => v,
      endOf:   (v) => v
    });
  }
});

// -----------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------
function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;','\'':'&apos;'
  }[c]));
}

function fmtPrice(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(2);
  if (a >= 100)  return v.toFixed(3);
  if (a >= 10)   return v.toFixed(4);
  return v.toFixed(5);
}

// -----------------------------------------------------------------
// Single panel: fetch data, render chart, composite label + boxes.
// -----------------------------------------------------------------
async function renderPanel(symbol, resolution, label) {
  const candles = await fetchOHLC(symbol, resolution, 150);
  if (!candles.length) return renderEmptyPanel(label);

  const data = candles.map(c => ({
    x: c.time * 1000,
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close
  }));

  const config = {
    type: 'candlestick',
    data: {
      datasets: [{
        data,
        borderColor: {
          up:        BULL_COLOR,
          down:      BEAR_COLOR,
          unchanged: BULL_COLOR
        },
        color: {
          up:        BULL_COLOR,
          down:      BEAR_COLOR,
          unchanged: BULL_COLOR
        }
      }]
    },
    options: {
      responsive: false,
      animation: false,
      parsing: false,
      plugins: {
        legend:  { display: false },
        title:   { display: false },
        tooltip: { enabled: false }
      },
      layout: {
        padding: { top: 48, bottom: 8, left: 16, right: BOX_W + BOX_RIGHT_PAD + 8 }
      },
      scales: {
        x: {
          type: 'timeseries',
          offset: true,
          grid:   { color: GRID_COLOR, tickColor: GRID_COLOR, drawBorder: false },
          border: { color: GRID_COLOR },
          ticks:  { color: AXIS_COLOR, maxRotation: 0, font: { size: 14 } }
        },
        y: {
          position: 'right',
          grid:   { color: GRID_COLOR, tickColor: GRID_COLOR, drawBorder: false },
          border: { color: GRID_COLOR },
          ticks:  { color: AXIS_COLOR, font: { size: 14 } }
        }
      }
    }
  };

  const chartBuf = await canvasRenderer.renderToBuffer(config, 'image/png');

  const highs = candles.map(c => c.high);
  const lows  = candles.map(c => c.low);
  const last  = candles[candles.length - 1];
  return overlayChrome(chartBuf, label, {
    high:    Math.max(...highs),
    low:     Math.min(...lows),
    current: last.close,
    entry:   last.open
  });
}

// -----------------------------------------------------------------
// Sharp SVG composite: top-left timeframe label + right-edge price
// boxes (HIGH / CURRENT / ENTRY / LOW), each 120 x 36.
// -----------------------------------------------------------------
async function overlayChrome(chartBuf, label, prices) {
  const boxX       = CELL_W - BOX_W - BOX_RIGHT_PAD;
  const totalBoxH  = BOX_H * 4 + BOX_GAP * 3;
  const boxStartY  = Math.floor((CELL_H - totalBoxH) / 2);

  const rows = [
    { key: 'HIGH',    val: fmtPrice(prices.high) },
    { key: 'CURRENT', val: fmtPrice(prices.current) },
    { key: 'ENTRY',   val: fmtPrice(prices.entry) },
    { key: 'LOW',     val: fmtPrice(prices.low) }
  ];

  const boxMarkup = rows.map((r, i) => {
    const y  = boxStartY + i * (BOX_H + BOX_GAP);
    const pal = PALETTE[r.key];
    return `
      <rect x="${boxX}" y="${y}" width="${BOX_W}" height="${BOX_H}" fill="${pal.bg}"/>
      <text x="${boxX + 8}"  y="${y + 13}" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="700" fill="${pal.fg}">${r.key}</text>
      <text x="${boxX + BOX_W - 8}" y="${y + 29}" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" fill="${pal.fg}" text-anchor="end">${escapeXml(r.val)}</text>
    `;
  }).join('');

  const overlaySvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL_W}" height="${CELL_H}">
      <text x="20" y="30" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="600" fill="${LABEL_COLOR}">${escapeXml(label)}</text>
      ${boxMarkup}
    </svg>`
  );

  return sharp(chartBuf)
    .composite([{ input: overlaySvg, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

// -----------------------------------------------------------------
// Blank fallback when TwelveData returns nothing.
// -----------------------------------------------------------------
async function renderEmptyPanel(label) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL_W}" height="${CELL_H}">
      <rect width="${CELL_W}" height="${CELL_H}" fill="${BG_COLOR}"/>
      <text x="20" y="30" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="600" fill="${LABEL_COLOR}">${escapeXml(label)}</text>
      <text x="${CELL_W / 2}" y="${CELL_H / 2}" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="${AXIS_COLOR}" text-anchor="middle">NO DATA</text>
    </svg>`
  );
  return sharp(svg).png().toBuffer();
}

// -----------------------------------------------------------------
// Compose 4 panels into a 2x2 grid.
// -----------------------------------------------------------------
async function buildTwoByTwoGrid(panels) {
  const W = CELL_W * 2;
  const H = CELL_H * 2;
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 19, g: 23, b: 34 } }
  }).composite([
    { input: panels[0], left: 0,      top: 0      },
    { input: panels[1], left: CELL_W, top: 0      },
    { input: panels[2], left: 0,      top: CELL_H },
    { input: panels[3], left: CELL_W, top: CELL_H }
  ]).png().toBuffer();
}

// -----------------------------------------------------------------
// Public entry point.
// -----------------------------------------------------------------
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

async function renderAllPanels(symbol) {
  const t0 = Date.now();
  console.log('[RENDERER] Start ' + symbol);

  const all = [...HTF, ...LTF];
  const panels = await Promise.all(
    all.map(tf => renderPanel(symbol, tf.res, tf.label).catch(e => {
      console.error('[RENDERER] Panel failed ' + symbol + ' ' + tf.label + ': ' + (e && e.message || e));
      return renderEmptyPanel(tf.label);
    }))
  );

  const [htfGrid, ltfGrid] = await Promise.all([
    buildTwoByTwoGrid(panels.slice(0, 4)),
    buildTwoByTwoGrid(panels.slice(4, 8))
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
