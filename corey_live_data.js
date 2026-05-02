'use strict';
// ============================================================
// ATLAS FX — COREY LIVE DATA LAYER
//
// Sources:
//   DXY    — TwelveData UUP (proxy ETF, primary), DX-Y.NYB (direct, fallback)
//   VIX    — TwelveData VXX (proxy ETF)
//   Yield  — FRED T10Y2Y series (10Y minus 2Y treasury yield spread, %)
//
// Value labelling (Phase: Corey-Live data validation & logging):
//   UUP / VXX are *proxy ETFs*. Their close prices are NOT the DXY
//   index value or the VIX index value. The snapshot tags every field
//   with `value_type` ∈ { actual_price, proxy_etf_price, derived_score,
//   spread, cached_snapshot } so downstream consumers (Corey, Jane,
//   Discord embeds) cannot mistake a proxy-ETF price for the actual
//   market index, and cannot mistake a derived strength score for an
//   index price. Per-instrument `label` keys (UUP_PROXY_PRICE,
//   VXX_PROXY_PRICE, 10Y2Y_SPREAD, DXY_SCORE, USD_STRENGTH_SCORE)
//   replace the previous generic "DXY:" / "VIX:" / "Yield:" headers
//   that produced the misleading "DXY:27.41" log line.
//
// Validation:
//   Each fetched value is range-checked against bounds appropriate to
//   the symbol actually fetched (UUP vs DX-Y.NYB, VXX vs true VIX).
//   Spec-mandated index-level bounds — DXY 70-130, VIX 5-100 — apply
//   only when the index symbol is fetched directly. Out-of-bounds
//   reads fail the live snapshot for that instrument; the cached
//   last-known-good value is retained, the failure is recorded in
//   validation_errors[], and validation_status flips to 'failed'.
//   Override flags (COREY_DXY_BOUNDS_OVERRIDE=1, COREY_VIX_BOUNDS_OVERRIDE=1)
//   demote a hard fail to a warning.
//
// Market state:
//   Snapshot is tagged market_state in { OPEN, CLOSED_WEEKEND,
//   CLOSED_HOLIDAY, STALE, DEGRADED }. During CLOSED_WEEKEND the
//   refresh path logs a `cached_weekend` line instead of the normal
//   "Refreshing live data..." line, so the operator can see the
//   values are last-close, not active live data.
//
// Stores result in module-level cache — refreshes every 15 min.
// Exports: getLiveContext() — always returns last known good data.
// Chart rendering is NOT touched by this module.
// ============================================================

const https = require('https');
const axios = require('axios');
const calendar = require('./corey_calendar');

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || '';
const FRED_KEY        = process.env.FRED_KEY || '';

const REFRESH_MS     = 15 * 60 * 1000;     // 15 minutes
const STALE_AFTER_MS = 60 * 60 * 1000;     // 1h without successful fetch -> STALE

// -- VALIDATION BOUNDS ----------------------------------------
// Bounds are applied per source symbol. UUP/VXX are proxy ETFs so
// their plausible band differs from the underlying index. Spec
// "DXY 70-130" / "VIX 5-100" applies only when DX-Y.NYB / VIX are
// fetched directly.

const BOUNDS = {
  UUP:        { min: 18,  max: 50,  label: 'UUP ETF price (USD proxy)' },
  VXX:        { min: 5,   max: 300, label: 'VXX ETF price (volatility proxy)' },
  'DX-Y.NYB': { min: 70,  max: 130, label: 'DXY index (actual)' },
  VIX:        { min: 5,   max: 100, label: 'VIX index (actual)' },
  T10Y2Y:     { min: -5,  max: 5,   label: '10Y minus 2Y treasury spread (%)' },
};

const ALLOW_DXY_OVERRIDE = process.env.COREY_DXY_BOUNDS_OVERRIDE === '1';
const ALLOW_VIX_OVERRIDE = process.env.COREY_VIX_BOUNDS_OVERRIDE === '1';

function validateBound(symbol, value) {
  const b = BOUNDS[symbol];
  if (!b) return { ok: true, errors: [], warnings: [] };
  if (value == null || !Number.isFinite(value)) {
    return { ok: false, errors: [`${symbol}: value missing or non-finite`], warnings: [] };
  }
  if (value < b.min || value > b.max) {
    const isDxy = symbol === 'UUP' || symbol === 'DX-Y.NYB';
    const isVix = symbol === 'VXX' || symbol === 'VIX';
    if (isDxy && ALLOW_DXY_OVERRIDE) {
      return { ok: true, errors: [], warnings: [`${symbol}=${value} outside ${b.min}..${b.max} — DXY override active`] };
    }
    if (isVix && ALLOW_VIX_OVERRIDE) {
      return { ok: true, errors: [], warnings: [`${symbol}=${value} outside ${b.min}..${b.max} — VIX override active`] };
    }
    return {
      ok: false,
      errors: [`${symbol}=${value} outside plausible range ${b.min}..${b.max} (${b.label})`],
      warnings: [],
    };
  }
  return { ok: true, errors: [], warnings: [] };
}

// -- MODULE-LEVEL CACHE ---------------------------------------
// Always available after first fetch — never null after boot.

let _cache = {
  dxy: {
    price:             null,
    change1d:          null,
    bias:              'Neutral',
    score:             0,
    source_used:       null,
    value_type:        null,                 // proxy_etf_price | actual_price | cached_snapshot
    proxy_symbol:      null,
    tracks:            'DXY',
    label:             'DXY_PROXY_PRICE',
    validation_status: 'unvalidated',
    validation_errors: [],
  },
  vix: {
    price:             null,
    level:             'Normal',
    score:             0,
    source_used:       null,
    value_type:        null,
    proxy_symbol:      null,
    tracks:            'VIX',
    label:             'VIX_PROXY_PRICE',
    validation_status: 'unvalidated',
    validation_errors: [],
  },
  yield: {
    spread:            null,
    regime:            'Normal',
    score:             0,
    source_used:       null,
    value_type:        'spread',
    series_id:         'T10Y2Y',
    label:             '10Y2Y_SPREAD',
    validation_status: 'unvalidated',
    validation_errors: [],
  },
  // Derived scores — explicitly tagged so a score is never confused
  // with an actual market price.
  scores: {
    dxy_score:          0,
    usd_strength_score: 0,
    vix_score:          0,
    yield_score:        0,
    value_type:         'derived_score',
    label:              'DERIVED_SCORES',
    range:              '-1..+1 (vix: 0..1)',
  },
  // Composite context fields consumed by globalMacro()
  context: {
    usdFlow:            0,
    safeHavenFlow:      0,
    creditStress:       0,
    geopoliticalStress: 0,
    recessionRisk:      0,
    bondStress:         0,
    realYieldPressure:  0,
    growthImpulse:      0,
    equityBreadth:      0,
    oilShock:           0,
    inflationImpulse:   0,
    commodityDemand:    0,
    semiconductorCycle: 0,
    aiCapexImpulse:     0,
  },
  market_state:               'UNKNOWN',
  last_successful_fetch_time: null,
  snapshot_age_minutes:       null,
  lastUpdated:                null,
  status:                     'uninitialised',
  validation_status:          'unvalidated',
  validation_errors:          [],
};

// -- MARKET-STATE DETERMINATION -------------------------------
// Forex weekend window: Fri 21:00 UTC -> Sun 21:00 UTC.
// Any one of UUP / VXX / FRED being closed makes the composite
// snapshot stale, so we use the wider Forex window.
//
// CLOSED_HOLIDAY hook: process.env.COREY_HOLIDAY_DATES is a
// comma-separated list of YYYY-MM-DD strings. Today's UTC date in
// that list -> CLOSED_HOLIDAY (overrides OPEN, not weekend).

function getHolidayDates() {
  const raw = process.env.COREY_HOLIDAY_DATES || '';
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

function isWeekendNow() {
  const d = new Date();
  const dow = d.getUTCDay();
  const h   = d.getUTCHours();
  return dow === 6 || (dow === 5 && h >= 21) || (dow === 0 && h < 21);
}

function isHolidayNow() {
  const today = new Date().toISOString().slice(0, 10);
  return getHolidayDates().has(today);
}

function getMarketState({ ageMs, status } = {}) {
  if (status === 'error' || status === 'degraded') return 'DEGRADED';
  if (isWeekendNow()) return 'CLOSED_WEEKEND';
  if (isHolidayNow()) return 'CLOSED_HOLIDAY';
  if (Number.isFinite(ageMs) && ageMs > STALE_AFTER_MS) return 'STALE';
  return 'OPEN';
}

// -- FETCH HELPERS --------------------------------------------

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
            symbol:   p.symbol || symbol,
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

// -- DXY SCORING ----------------------------------------------
// Scorer dispatches by source symbol. UUP price band differs from
// the actual DXY index price band, so the same `bias`/`score` cannot
// be produced from both with one ladder.

function scoreDXY(price, change1d, symbol) {
  if (price == null) return { bias: 'Neutral', score: 0 };
  let score = 0;

  if (symbol === 'DX-Y.NYB') {
    // True DXY index ladder
    if (price > 110)      score += 0.60;
    else if (price > 105) score += 0.35;
    else if (price > 100) score += 0.15;
    else if (price > 95)  score -= 0.05;
    else if (price > 90)  score -= 0.30;
    else if (price > 85)  score -= 0.50;
    else                  score -= 0.70;
  } else {
    // UUP proxy ETF ladder (default)
    if (price > 29.5)      score += 0.60;
    else if (price > 28.5) score += 0.35;
    else if (price > 27.5) score += 0.15;
    else if (price > 26.5) score -= 0.05;
    else if (price > 25.5) score -= 0.30;
    else if (price > 24.5) score -= 0.50;
    else                   score -= 0.70;
  }

  if (change1d > 0.5)        score += 0.15;
  else if (change1d > 0.2)   score += 0.08;
  else if (change1d < -0.5)  score -= 0.15;
  else if (change1d < -0.2)  score -= 0.08;

  score = Math.max(-1, Math.min(1, score));
  const bias = score > 0.10 ? 'Bullish' : score < -0.10 ? 'Bearish' : 'Neutral';
  return { bias, score: Math.round(score * 100) / 100 };
}

// -- VIX SCORING ----------------------------------------------
// VXX ETF reference (NOT true VIX index). VXX decays via roll cost,
// so periodic recalibration vs the true VIX scale may be needed.

function scoreVIX(price) {
  if (price == null) return { level: 'Normal', score: 0 };
  let level, score;
  if (price < 18)      { level = 'Low';      score = 0.05; }
  else if (price < 25) { level = 'Normal';   score = 0.12; }
  else if (price < 33) { level = 'Elevated'; score = 0.38; }
  else if (price < 45) { level = 'High';     score = 0.65; }
  else                 { level = 'Extreme';  score = 0.88; }
  return { level, score };
}

// -- YIELD CURVE SCORING --------------------------------------
// Spread = 10Y minus 2Y. Negative = inverted = recessionary.

function scoreYield(spread) {
  if (spread == null) return { regime: 'Normal', score: 0 };
  let regime, score;
  if (spread < -0.75)      { regime = 'Inverted'; score = -0.80; }
  else if (spread < -0.25) { regime = 'Inverted'; score = -0.50; }
  else if (spread < 0.25)  { regime = 'Flat';     score = -0.10; }
  else if (spread < 0.75)  { regime = 'Normal';   score =  0.20; }
  else if (spread < 1.50)  { regime = 'Normal';   score =  0.40; }
  else                     { regime = 'Steep';    score =  0.60; }
  return { regime, score };
}

// -- DERIVE MARKET CONTEXT ------------------------------------

function deriveContext(dxy, vix, yield_) {
  const d = dxy.score;     // -1..+1
  const v = vix.score;     //  0..1
  const y = yield_.score;  // -1..+1
  return {
    usdFlow:            clamp(d * 0.80),
    safeHavenFlow:      clamp(v * 0.60 + (d > 0 ? d * 0.20 : 0)),
    creditStress:       clamp(v * 0.70),
    geopoliticalStress: clamp(v * 0.40),
    recessionRisk:      clamp(v * 0.35 + (y < 0 ? Math.abs(y) * 0.50 : 0)),
    bondStress:         clamp(v * 0.45 + (y < 0 ? Math.abs(y) * 0.35 : 0)),
    realYieldPressure:  clamp(d * 0.30 + (y > 0 ? y * 0.25 : 0)),
    growthImpulse:      clamp(y * 0.60 + (v < 0.20 ? 0.15 : 0)),
    equityBreadth:      clamp(1 - v * 0.80),
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

// -- MAIN FETCH -----------------------------------------------

async function fetchAll() {
  const results = { dxy: null, vix: null, yield: null };
  const errors  = [];
  const validationErrors = [];
  const validationWarnings = [];

  // DXY — UUP (primary), DX-Y.NYB (fallback)
  try {
    const q = await fetchTwelveDataQuote('UUP');
    const v = validateBound('UUP', q.price);
    if (!v.ok) {
      validationErrors.push(...v.errors);
      throw new Error(v.errors.join('; '));
    }
    if (v.warnings.length) validationWarnings.push(...v.warnings);
    const scored = scoreDXY(q.price, q.change1d, 'UUP');
    results.dxy = {
      price: q.price, change1d: q.change1d, ...scored,
      source_used:       'twelvedata:UUP',
      value_type:        'proxy_etf_price',
      proxy_symbol:      'UUP',
      tracks:            'DXY',
      label:             'UUP_PROXY_PRICE',
      validation_status: 'valid',
      validation_errors: [],
    };
  } catch (e) {
    errors.push(`DXY (UUP): ${e.message}`);
    try {
      const q2 = await fetchTwelveDataQuote('DX-Y.NYB');
      const v2 = validateBound('DX-Y.NYB', q2.price);
      if (!v2.ok) {
        validationErrors.push(...v2.errors);
        throw new Error(v2.errors.join('; '));
      }
      if (v2.warnings.length) validationWarnings.push(...v2.warnings);
      const scored = scoreDXY(q2.price, q2.change1d, 'DX-Y.NYB');
      results.dxy = {
        price: q2.price, change1d: q2.change1d, ...scored,
        source_used:       'twelvedata:DX-Y.NYB',
        value_type:        'actual_price',
        proxy_symbol:      null,
        tracks:            'DXY',
        label:             'DXY_INDEX_PRICE',
        validation_status: 'valid',
        validation_errors: [],
      };
    } catch (e2) {
      errors.push(`DXY fallback (DX-Y.NYB): ${e2.message}`);
    }
  }

  // VIX — VXX
  try {
    const q = await fetchTwelveDataQuote('VXX');
    const v = validateBound('VXX', q.price);
    if (!v.ok) {
      validationErrors.push(...v.errors);
      throw new Error(v.errors.join('; '));
    }
    if (v.warnings.length) validationWarnings.push(...v.warnings);
    const scored = scoreVIX(q.price);
    results.vix = {
      price: q.price, ...scored,
      source_used:       'twelvedata:VXX',
      value_type:        'proxy_etf_price',
      proxy_symbol:      'VXX',
      tracks:            'VIX',
      label:             'VXX_PROXY_PRICE',
      validation_status: 'valid',
      validation_errors: [],
    };
  } catch (e) {
    errors.push(`VIX: ${e.message}`);
  }

  // Yield curve — FRED T10Y2Y
  if (FRED_KEY) {
    try {
      const spread = await fetchFREDSeries('T10Y2Y');
      const v = validateBound('T10Y2Y', spread);
      if (!v.ok) {
        validationErrors.push(...v.errors);
        throw new Error(v.errors.join('; '));
      }
      const scored = scoreYield(spread);
      results.yield = {
        spread, ...scored,
        source_used:       'fred:T10Y2Y',
        value_type:        'spread',
        series_id:         'T10Y2Y',
        label:             '10Y2Y_SPREAD',
        validation_status: 'valid',
        validation_errors: [],
      };
    } catch (e) {
      errors.push(`FRED yield: ${e.message}`);
    }
  } else {
    errors.push('FRED_KEY not set — yield curve unavailable');
  }

  return { results, errors, validationErrors, validationWarnings };
}

// -- UPDATE CACHE ---------------------------------------------

async function refreshCache() {
  const weekend  = isWeekendNow();
  const holiday  = isHolidayNow();
  const closed   = weekend || holiday;
  const closedTag = weekend ? 'CLOSED_WEEKEND' : 'CLOSED_HOLIDAY';
  const closedStatus = weekend ? 'cached_weekend' : 'cached_holiday';

  const lastSuccessIso = _cache.last_successful_fetch_time;
  const lastSuccessMs  = lastSuccessIso ? Date.parse(lastSuccessIso) : null;

  // Closed-market path: do not imply active live refresh. If we
  // already hold a snapshot, retain and retag. If this is a cold
  // boot during closure, fetch once (UUP/VXX/FRED return last close)
  // but tag every value_type as cached_snapshot so consumers cannot
  // mistake a frozen Friday-close value for a fresh live tick.
  if (closed && lastSuccessMs) {
    const ageMs  = Date.now() - lastSuccessMs;
    const ageMin = Math.round(ageMs / 60000);

    _cache.market_state         = closedTag;
    _cache.snapshot_age_minutes = ageMin;
    _cache.status               = closedStatus;
    if (_cache.dxy)   _cache.dxy.value_type   = 'cached_snapshot';
    if (_cache.vix)   _cache.vix.value_type   = 'cached_snapshot';
    if (_cache.yield) _cache.yield.value_type = 'cached_snapshot';

    console.log(`[COREY-LIVE] ${weekend ? 'Weekend' : 'Holiday'} mode — retaining last available macro snapshot`);
    console.log(
      `[COREY-LIVE] Snapshot — ${labelOf(_cache.dxy, 'DXY_PROXY_PRICE')}:${fmt(_cache.dxy?.price)} | ` +
      `${labelOf(_cache.vix, 'VIX_PROXY_PRICE')}:${fmt(_cache.vix?.price)} | ` +
      `${labelOf(_cache.yield, '10Y2Y_SPREAD')}:${fmt(_cache.yield?.spread)} | ` +
      `market_state:${closedTag} | age:${ageMin}m | status:${closedStatus}`
    );
    return;
  }

  if (closed) {
    console.log(`[COREY-LIVE] ${weekend ? 'Weekend' : 'Holiday'} cold-boot — fetching last-close snapshot...`);
  } else {
    console.log('[COREY-LIVE] Refreshing live data...');
  }

  try {
    const { results, errors, validationErrors, validationWarnings } = await fetchAll();

    const dxy    = results.dxy   || _cache.dxy;
    const vix    = results.vix   || _cache.vix;
    const yield_ = results.yield || _cache.yield;
    const context = deriveContext(dxy, vix, yield_);

    const anySuccess = Boolean(results.dxy || results.vix || results.yield);
    const status =
      validationErrors.length > 0 && !anySuccess ? 'error' :
      errors.length === 0 ? 'ok' :
      errors.length < 3   ? 'partial' :
                            'degraded';

    const lastSuccessful = anySuccess
      ? new Date().toISOString()
      : _cache.last_successful_fetch_time;

    const ageMs = lastSuccessful ? Date.now() - Date.parse(lastSuccessful) : null;

    // On a cold-boot during a closed market, we still mark the
    // snapshot as CLOSED_* so the value_type on each instrument is
    // forced to cached_snapshot — last-close, not active live.
    let market_state;
    if (closed) {
      market_state = closedTag;
      if (results.dxy)   results.dxy.value_type   = 'cached_snapshot';
      if (results.vix)   results.vix.value_type   = 'cached_snapshot';
      if (results.yield) results.yield.value_type = 'cached_snapshot';
    } else {
      market_state = getMarketState({ ageMs, status });
    }

    const snapshotErrors = [...errors, ...validationErrors];
    const validation_status =
      validationErrors.length > 0 ? 'failed' :
      anySuccess                  ? 'valid' :
                                    'unvalidated';

    _cache = {
      dxy,
      vix,
      yield: yield_,
      scores: {
        dxy_score:          dxy?.score ?? 0,
        usd_strength_score: dxy?.score ?? 0,
        vix_score:          vix?.score ?? 0,
        yield_score:        yield_?.score ?? 0,
        value_type:         'derived_score',
        label:              'DERIVED_SCORES',
        range:              '-1..+1 (vix: 0..1)',
      },
      context,
      market_state,
      last_successful_fetch_time: lastSuccessful,
      snapshot_age_minutes:       ageMs != null ? Math.round(ageMs / 60000) : null,
      lastUpdated:                new Date().toISOString(),
      status: closed ? closedStatus : status,
      validation_status,
      validation_errors:          snapshotErrors,
    };

    // Per-instrument labels in the update line. The previous "DXY:27.41"
    // log implied the value was the actual DXY index — it was UUP. The
    // declared `label` makes the value_type explicit at the log level.
    const dxyLabel = labelOf(dxy, 'DXY_PROXY_PRICE');
    const vixLabel = labelOf(vix, 'VIX_PROXY_PRICE');
    const yldLabel = labelOf(yield_, '10Y2Y_SPREAD');
    console.log(
      `[COREY-LIVE] Updated — ${dxyLabel}:${fmt(dxy?.price)} (${dxy?.bias}) | ` +
      `${vixLabel}:${fmt(vix?.price)} (${vix?.level}) | ` +
      `${yldLabel}:${fmt(yield_?.spread)} (${yield_?.regime}) | ` +
      `DXY_SCORE:${fmtScore(dxy?.score)} VIX_SCORE:${fmtScore(vix?.score)} YIELD_SCORE:${fmtScore(yield_?.score)} | ` +
      `market_state:${market_state} | status:${_cache.status} | validation:${validation_status}`
    );
    if (errors.length > 0)              console.warn('[COREY-LIVE] Errors:', errors.join(' | '));
    if (validationErrors.length > 0)    console.warn('[COREY-LIVE] Validation errors:', validationErrors.join(' | '));
    if (validationWarnings.length > 0)  console.warn('[COREY-LIVE] Validation warnings:', validationWarnings.join(' | '));

  } catch (err) {
    console.error('[COREY-LIVE] Refresh failed:', err.message);
    _cache.status            = 'error';
    _cache.market_state      = getMarketState({ status: 'error' });
    _cache.validation_status = 'failed';
    _cache.validation_errors = [err.message];
  }
}

function fmt(n) {
  return Number.isFinite(n) ? n.toFixed(2) : 'N/A';
}

function fmtScore(n) {
  return Number.isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(2) : 'N/A';
}

function labelOf(slot, fallback) {
  if (slot && typeof slot.label === 'string' && slot.label) return slot.label;
  return fallback;
}

// -- INITIALISE -----------------------------------------------

let _initialised = false;

async function init() {
  if (_initialised) return;
  _initialised = true;
  await refreshCache();
  setInterval(refreshCache, REFRESH_MS);
  calendar.startAutoRefresh();
}

// -- PUBLIC API -----------------------------------------------

/**
 * Returns the current live macro context.
 * Always returns data — falls back to last known good or safe defaults.
 *
 * `snapshot_age_minutes` and `market_state` are recomputed on read so
 * a long-lived process always reports an accurate age and state even
 * between 15-min refresh ticks.
 */
function getLiveContext() {
  const lastSuccess = _cache.last_successful_fetch_time
    ? Date.parse(_cache.last_successful_fetch_time)
    : null;
  const ageMs = lastSuccess ? Date.now() - lastSuccess : null;
  return {
    ..._cache,
    snapshot_age_minutes: ageMs != null ? Math.round(ageMs / 60000) : null,
    market_state:         getMarketState({ ageMs, status: _cache.status }),
  };
}

/**
 * Returns just the market context fields for globalMacro()
 */
function getMarketContext(symbol) {
  const ctx = { ..._cache.context };
  if (symbol) {
    ctx.calendar = {
      bias: calendar.getCalendarBias(symbol),
      upcoming: calendar.getUpcomingEvents(symbol).slice(0, 3)
    };
  }
  return ctx;
}

module.exports = {
  init,
  getLiveContext,
  getMarketContext,
  refreshCache,
  // Exposed for tests / introspection
  getMarketState,
  validateBound,
  BOUNDS,
};
