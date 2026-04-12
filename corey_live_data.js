'use strict';
// ============================================================
// ATLAS FX — COREY LIVE DATA LAYER
// Fetches: DXY (TwelveData/UUP), VIX (VXX), Yield Curve (FRED)
// Stores result in module-level cache — refreshes every 15 min
// Exports: getLiveContext() — always returns last known good data
// ============================================================

const https = require('https');
const axios = require('axios');

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || '';
const FRED_KEY        = process.env.FRED_KEY || '';

const REFRESH_MS = 15 * 60 * 1000; // 15 minutes

// ── MODULE-LEVEL CACHE ────────────────────────────────────────
// Always available after first fetch — never null after boot
let _cache = {
  dxy: {
    price:     null,
    change1d:  null,
    bias:      'Neutral',  // 'Bullish' | 'Bearish' | 'Neutral'
    score:     0,          // -1.0 to +1.0
  },
  vix: {
    price:     null,
    level:     'Normal',   // 'Low' | 'Normal' | 'Elevated' | 'High' | 'Extreme'
    score:     0,          // risk-off pressure: 0 to 1.0
  },
  yield: {
    spread:    null,       // 10Y - 2Y in percent
    regime:    'Normal',   // 'Inverted' | 'Flat' | 'Normal' | 'Steep'
    score:     0,          // -1.0 to +1.0 (negative = inverted = recessionary)
  },
  // Derived composite fields for globalMacro()
  context: {
    usdFlow:           0,
    safeHavenFlow:     0,
    creditStress:      0,
    geopoliticalStress:0,
    recessionRisk:     0,
    bondStress:        0,
    realYieldPressure: 0,
    growthImpulse:     0,
    equityBreadth:     0,
    oilShock:          0,
    inflationImpulse:  0,
    commodityDemand:   0,
    semiconductorCycle:0,
    aiCapexImpulse:    0,
  },
  lastUpdated: null,
  status: 'uninitialised',
};

// ── FETCH HELPERS ─────────────────────────────────────────────

function fetchTwelveDataQuote(symbol) {
  return new Promise((resolve, reject) => {
    const tdSym = encodeURIComponent(symbol);
    const opts = {
      hostname: 'api.twelvedata.com',
      path: `/quote?symbol=${tdSym}&apikey=${TWELVE_DATA_KEY}`,
      method: 'GET',
      headers: { 'User-Agent': 'ATLAS-FX/4.0' },
      timeout: 10000,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.status === 'error' || !p.close) {
            reject(new Error(`TwelveData quote error: ${p.message || 'no close'}`));
            return;
          }
          resolve({
            price:    parseFloat(p.close),
            change1d: parseFloat(p.percent_change || 0),
            symbol:   p.symbol,
          });
        } catch (e) {
          reject(new Error(`TwelveData parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('TwelveData timeout')));
    req.end();
  });
}

async function fetchFREDSeries(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json` +
    `&sort_order=desc&limit=5`;
  const res = await axios.get(url, { timeout: 8000 });
  const obs = res.data?.observations || [];
  const latest = obs.find(o => o.value !== '.' && o.value !== '');
  return latest ? parseFloat(latest.value) : null;
}

// ── DXY SCORING ───────────────────────────────────────────────
// UUP ETF used as DXY proxy via TwelveData
// DXY above 104 = strong USD | below 100 = weak USD
// Change-based momentum also factored

function scoreDXY(price, change1d) {
  if (price == null) return { bias: 'Neutral', score: 0 };
  
  let score = 0;
  
  // Price level component
  if (price > 106)      score += 0.60;
  else if (price > 104) score += 0.40;
  else if (price > 102) score += 0.20;
  else if (price > 100) score += 0.05;
  else if (price > 98)  score -= 0.20;
  else if (price > 96)  score -= 0.40;
  else                  score -= 0.60;

  // Momentum component (1-day change)
  if (change1d > 0.5)       score += 0.15;
  else if (change1d > 0.2)  score += 0.08;
  else if (change1d < -0.5) score -= 0.15;
  else if (change1d < -0.2) score -= 0.08;

  score = Math.max(-1, Math.min(1, score));
  const bias = score > 0.10 ? 'Bullish' : score < -0.10 ? 'Bearish' : 'Neutral';
  return { bias, score: Math.round(score * 100) / 100 };
}

// ── VIX SCORING ───────────────────────────────────────────────
// VXX ETF used as VIX proxy
// VIX < 15 = low fear | 15-20 = normal | 20-25 = elevated | 25-35 = high | >35 = extreme

function scoreVIX(price) {
  if (price == null) return { level: 'Normal', score: 0 };

  let level, score;

  if (price < 13) {
    level = 'Low';
    score = 0.05; // near complacency
  } else if (price < 18) {
    level = 'Normal';
    score = 0.10;
  } else if (price < 25) {
    level = 'Elevated';
    score = 0.35;
  } else if (price < 35) {
    level = 'High';
    score = 0.65;
  } else {
    level = 'Extreme';
    score = 0.90;
  }

  return { level, score };
}

// ── YIELD CURVE SCORING ───────────────────────────────────────
// Spread = 10Y minus 2Y
// Negative = inverted = recessionary signal
// Deeply positive = growth/expansion

function scoreYield(spread) {
  if (spread == null) return { regime: 'Normal', score: 0 };

  let regime, score;

  if (spread < -0.75) {
    regime = 'Inverted';
    score  = -0.80;
  } else if (spread < -0.25) {
    regime = 'Inverted';
    score  = -0.50;
  } else if (spread < 0.25) {
    regime = 'Flat';
    score  = -0.10;
  } else if (spread < 0.75) {
    regime = 'Normal';
    score  = 0.20;
  } else if (spread < 1.50) {
    regime = 'Normal';
    score  = 0.40;
  } else {
    regime = 'Steep';
    score  = 0.60;
  }

  return { regime, score };
}

// ── DERIVE MARKET CONTEXT ─────────────────────────────────────
// Maps live DXY/VIX/yield scores into the DEFAULT_MARKET_CONTEXT
// fields that globalMacro() uses for its calculations

function deriveContext(dxy, vix, yield_) {
  const d = dxy.score;     // -1 to +1, positive = strong USD
  const v = vix.score;     // 0 to 1, higher = more fear
  const y = yield_.score;  // -1 to +1, negative = inverted

  return {
    // USD-related
    usdFlow:            clamp(d * 0.80),
    safeHavenFlow:      clamp(v * 0.60 + (d > 0 ? d * 0.20 : 0)),

    // Risk environment
    creditStress:       clamp(v * 0.70),
    geopoliticalStress: clamp(v * 0.40),
    recessionRisk:      clamp(v * 0.35 + (y < 0 ? Math.abs(y) * 0.50 : 0)),

    // Bond / yield
    bondStress:         clamp(v * 0.45 + (y < 0 ? Math.abs(y) * 0.35 : 0)),
    realYieldPressure:  clamp(d * 0.30 + (y > 0 ? y * 0.25 : 0)),
    growthImpulse:      clamp(y * 0.60 + (v < 0.20 ? 0.15 : 0)),

    // Equity / breadth
    equityBreadth:      clamp(1 - v * 0.80),

    // Commodity / inflation (limited without direct feeds — stubbed at 0 for Phase 1)
    oilShock:           0,
    inflationImpulse:   0,
    commodityDemand:    0,
    semiconductorCycle: 0,
    aiCapexImpulse:     0,
  };
}

function clamp(v, min = -1, max = 1) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(Math.max(v, min), max);
}

// ── MAIN FETCH ────────────────────────────────────────────────

async function fetchAll() {
  const results = { dxy: null, vix: null, yield: null };
  const errors  = [];

  // DXY via UUP ETF
  try {
    const q = await fetchTwelveDataQuote('UUP');
    const scored = scoreDXY(q.price, q.change1d);
    results.dxy = { price: q.price, change1d: q.change1d, ...scored };
  } catch (e) {
    errors.push(`DXY: ${e.message}`);
    // Try fallback — DX-Y.NYB direct
    try {
      const q2 = await fetchTwelveDataQuote('DX-Y.NYB');
      const scored = scoreDXY(q2.price, q2.change1d);
      results.dxy = { price: q2.price, change1d: q2.change1d, ...scored };
    } catch (e2) {
      errors.push(`DXY fallback: ${e2.message}`);
    }
  }

  // VIX via VXX ETF
  try {
    const q = await fetchTwelveDataQuote('VXX');
    const scored = scoreVIX(q.price);
    results.vix = { price: q.price, ...scored };
  } catch (e) {
    errors.push(`VIX: ${e.message}`);
  }

  // Yield curve via FRED (T10Y2Y = 10Y-2Y spread)
  if (FRED_KEY) {
    try {
      const spread = await fetchFREDSeries('T10Y2Y');
      const scored = scoreYield(spread);
      results.yield = { spread, ...scored };
    } catch (e) {
      errors.push(`FRED yield: ${e.message}`);
    }
  } else {
    errors.push('FRED_KEY not set — yield curve unavailable');
  }

  return { results, errors };
}

// ── UPDATE CACHE ──────────────────────────────────────────────

async function refreshCache() {
  console.log('[COREY-LIVE] Refreshing live data...');
  try {
    const { results, errors } = await fetchAll();

    const dxy   = results.dxy   || _cache.dxy;
    const vix   = results.vix   || _cache.vix;
    const yield_ = results.yield || _cache.yield;

    const context = deriveContext(dxy, vix, yield_);

    _cache = {
      dxy,
      vix,
      yield: yield_,
      context,
      lastUpdated: new Date().toISOString(),
      status: errors.length === 0 ? 'ok' : errors.length < 3 ? 'partial' : 'degraded',
      errors,
    };

    console.log(`[COREY-LIVE] Updated — DXY:${dxy.price?.toFixed(2)||'N/A'} (${dxy.bias}) | VIX:${vix.price?.toFixed(2)||'N/A'} (${vix.level}) | Yield:${yield_.spread?.toFixed(2)||'N/A'} (${yield_.regime}) | Status:${_cache.status}`);
    if (errors.length > 0) console.warn('[COREY-LIVE] Errors:', errors.join(' | '));

  } catch (err) {
    console.error('[COREY-LIVE] Refresh failed:', err.message);
    _cache.status = 'error';
  }
}

// ── INITIALISE ────────────────────────────────────────────────
// Called once at boot — sets up initial data and starts 15-min refresh

let _initialised = false;

async function init() {
  if (_initialised) return;
  _initialised = true;
  await refreshCache();
  setInterval(refreshCache, REFRESH_MS);
}

// ── PUBLIC API ────────────────────────────────────────────────

/**
 * Returns the current live macro context.
 * Always returns data — falls back to last known good or safe defaults.
 */
function getLiveContext() {
  return _cache;
}

/**
 * Returns just the market context fields for globalMacro()
 */
function getMarketContext() {
  return { ..._cache.context };
}

module.exports = { init, getLiveContext, getMarketContext, refreshCache };
