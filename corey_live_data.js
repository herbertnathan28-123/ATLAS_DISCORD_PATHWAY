'use strict';

// ============================================================
// COREY — LIVE DATA LAYER
// Production-ready full replacement
// Purpose:
//   - Fetch live macro inputs for Corey scoring engine
//   - Preserve existing Render env naming
//   - Harden network/error handling
//   - Return stable structured data
//   - Do NOT change Corey scoring logic directly
// ============================================================

const https = require('https');

// ── ENV ─────────────────────────────────────────────────────
const TWELVEDATA_KEY =
  process.env.TWELVE_DATA_API_KEY || process.env.TWELVE_DATA_API_KEY || '';

const FRED_KEY = process.env.FRED_KEY || '';

const HTTP_TIMEOUT_MS = parseInt(process.env.COREY_HTTP_TIMEOUT_MS || '10000', 10);
const USER_AGENT = 'ATLAS-FX/COREY-LIVE-DATA/1.0';

// ── HELPERS ─────────────────────────────────────────────────
function nowIso() {
  return new Date().toISOString();
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function buildError(message, meta = {}) {
  const err = new Error(message);
  err.meta = meta;
  return err;
}

function logInfo(message, meta) {
  if (meta !== undefined) {
    console.log(`[COREY LIVE DATA] ${message}`, meta);
  } else {
    console.log(`[COREY LIVE DATA] ${message}`);
  }
}

function logWarn(message, meta) {
  if (meta !== undefined) {
    console.warn(`[COREY LIVE DATA] ${message}`, meta);
  } else {
    console.warn(`[COREY LIVE DATA] ${message}`);
  }
}

function logError(message, meta) {
  if (meta !== undefined) {
    console.error(`[COREY LIVE DATA] ${message}`, meta);
  } else {
    console.error(`[COREY LIVE DATA] ${message}`);
  }
}

// ── HTTP JSON FETCH ─────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json'
        }
      },
      (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(
                buildError(`HTTP ${res.statusCode}`, {
                  url,
                  statusCode: res.statusCode,
                  bodyPreview: data.slice(0, 300)
                })
              );
            }

            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (error) {
            reject(
              buildError(`JSON parse failed: ${error.message}`, {
                url,
                bodyPreview: data.slice(0, 300)
              })
            );
          }
        });
      }
    );

    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy(buildError('Request timeout', { url: url.replace(/api_key=[^&]+/, 'api_key=***'), timeoutMs: HTTP_TIMEOUT_MS }));
    });

    req.on('error', (error) => {
      reject(
        buildError(error.message || 'Network error', {
          url
        })
      );
    });
  });
}



// ── FETCH WITH RETRY ────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSONWithRetry(url, retries = 3, delayMs = 2000) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchJSON(url);
    } catch (err) {
      lastError = err;
      logWarn('Fetch attempt ' + attempt + '/' + retries + ' failed: ' + err.message);
      if (attempt < retries) {
        logWarn('Retrying in ' + (delayMs * attempt) + 'ms...');
        await sleep(delayMs * attempt);
      }
    }
  }
  throw lastError;
}

// ── RESULT WRAPPERS ─────────────────────────────────────────
function makeSuccess(source, value, raw, extra = {}) {
  return {
    ok: true,
    source,
    value,
    raw,
    error: null,
    ...extra
  };
}

function makeFailure(source, error, extra = {}) {
  return {
    ok: false,
    source,
    value: null,
    raw: null,
    error: {
      message: error?.message || 'Unknown error',
      meta: error?.meta || null
    },
    ...extra
  };
}

// ── TWELVEDATA QUOTE FETCH ──────────────────────────────────
async function fetchTwelveDataQuote(symbol) {
  if (!TWELVEDATA_KEY) {
    throw buildError('Missing TwelveData API key', {
      envExpected: ['TWELVE_DATA_API_KEY', 'TWELVE_DATA_API_KEY']
    });
  }

  const encodedSymbol = encodeURIComponent(symbol);
  const url = `https://api.twelvedata.com/quote?symbol=${encodedSymbol}&apikey=${TWELVEDATA_KEY}`;
  const data = await fetchJSONWithRetry(url, 3, 2000);

  if (data.status === 'error') {
    throw buildError(`TwelveData error: ${data.message || 'unknown'}`, {
      symbol,
      code: data.code || null,
      raw: data
    });
  }

  const price =
    toNumber(data.close) ??
    toNumber(data.price) ??
    toNumber(data.previous_close);

  const changePct =
    toNumber(data.percent_change) ??
    toNumber(data.change_percent) ??
    null;

  if (!isFiniteNumber(price)) {
    throw buildError('Invalid quote price returned', {
      symbol,
      raw: data
    });
  }

  return {
    symbol,
    price,
    changePct,
    raw: data
  };
}

async function fetchQuoteWithFallbacks(label, candidateSymbols) {
  const failures = [];

  for (const symbol of candidateSymbols) {
    try {
      const result = await fetchTwelveDataQuote(symbol);
      return makeSuccess('twelvedata', result, result.raw, {
        requestedLabel: label,
        resolvedSymbol: symbol
      });
    } catch (error) {
      failures.push({
        symbol,
        message: error.message,
        meta: error.meta || null
      });
    }
  }

  return makeFailure(
    'twelvedata',
    buildError(`All quote fallbacks failed for ${label}`, {
      label,
      failures
    }),
    {
      requestedLabel: label,
      attemptedSymbols: candidateSymbols
    }
  );
}

// ── FRED FETCH ──────────────────────────────────────────────
async function fetchFredLatestObservation(seriesId) {
  if (!FRED_KEY) {
    throw buildError('Missing FRED API key', {
      envExpected: ['FRED_KEY']
    });
  }

  const encodedSeriesId = encodeURIComponent(seriesId);
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${encodedSeriesId}` +
    `&api_key=${encodeURIComponent(FRED_KEY)}` +
    `&file_type=json&sort_order=desc&limit=5`;

  const data = await fetchJSON(url);

  if (!data || !Array.isArray(data.observations)) {
    throw buildError('Invalid FRED observations payload', {
      seriesId,
      raw: data
    });
  }

  const validObservation = data.observations.find((obs) => {
    const value = safeString(obs?.value, '.');
    return value !== '.' && Number.isFinite(parseFloat(value));
  });

  if (!validObservation) {
    throw buildError('No valid FRED observation found', {
      seriesId,
      raw: data
    });
  }

  const value = parseFloat(validObservation.value);

  return {
    seriesId,
    value,
    date: validObservation.date || null,
    raw: data
  };
}

// ── LIVE INPUT FETCHERS ─────────────────────────────────────
async function fetchDXY() {
  const result = await fetchQuoteWithFallbacks('DXY', [
    'DXY',
    'DXY:IND',
    'TVC:DXY',
    'UUP'
  ]);

  if (!result.ok) return result;

  return makeSuccess(
    result.source,
    {
      price: result.value.price,
      changePct: result.value.changePct,
      symbol: result.resolvedSymbol
    },
    result.raw,
    {
      requestedLabel: 'DXY',
      resolvedSymbol: result.resolvedSymbol
    }
  );
}

async function fetchVIX() {
  const result = await fetchQuoteWithFallbacks('VIX', [
    'VXX',
    'UVXY',
    'SVXY',
    'VIXY'
  ]);

  if (!result.ok) return result;

  return makeSuccess(
    result.source,
    {
      price: result.value.price,
      changePct: result.value.changePct,
      symbol: result.resolvedSymbol
    },
    result.raw,
    {
      requestedLabel: 'VIX',
      resolvedSymbol: result.resolvedSymbol
    }
  );
}

async function fetchYieldSpread() {
  try {
    // Primary: FRED 10Y-2Y spread
    const fred = await fetchFredLatestObservation('T10Y2Y');

    return makeSuccess(
      'fred',
      {
        spread: fred.value,
        date: fred.date,
        seriesId: fred.seriesId
      },
      fred.raw,
      {
        requestedLabel: '10Y-2Y'
      }
    );

  } catch (error) {

    // Fallback: calculate using TNX - IRX (TwelveData supported)
    try {
      const [tenY, twoY] = await Promise.all([
        fetchQuoteWithFallbacks('TNX', ['TNX']),
        fetchQuoteWithFallbacks('IRX', ['IRX'])
      ]);

      if (tenY.ok && twoY.ok) {
        const spread = tenY.value.price - twoY.value.price;

        return makeSuccess(
          'twelvedata',
          {
            spread: spread,
            date: new Date().toISOString(),
            seriesId: 'TLT-SHY-PROXY'
          },
          {
            longBond: longBond.raw, shortBond: shortBond.raw
          },
          {
            requestedLabel: '10Y-2Y'
          }
        );
      }

      return makeFailure('fred', error, {
        requestedLabel: '10Y-2Y'
      });

    } catch (fallbackError) {
      return makeFailure('fred', error, {
        requestedLabel: '10Y-2Y'
      });
    }
  }
}

// ── CLASSIFIERS ─────────────────────────────────────────────
function classifyDXY(changePct) {
  if (!isFiniteNumber(changePct)) return 'unknown';
  if (changePct > 0.25) return 'bullish';
  if (changePct < -0.25) return 'bearish';
  return 'neutral';
}

function classifyVIX(price) {
  if (!isFiniteNumber(price)) return 'unknown';
  if (price > 22) return 'risk_off';
  if (price < 16) return 'risk_on';
  return 'neutral';
}

function classifyYield(spread) {
  if (!isFiniteNumber(spread)) return 'unknown';
  if (spread < 0) return 'inverted';
  if (spread > 1) return 'steep';
  return 'normal';
}

// ── NORMALISERS / SCORING HELPERS ───────────────────────────
function normaliseDxyScore(changePct) {
  if (!isFiniteNumber(changePct)) return 0;
  return clamp(changePct / 1.0, -1, 1);
}

function normaliseVixScore(price) {
  if (!isFiniteNumber(price)) return 0;
  if (price >= 30) return -1;
  if (price <= 12) return 1;
  const mid = 21;
  const range = 9;
  return clamp((mid - price) / range, -1, 1);
}

function normaliseYieldScore(spread) {
  if (!isFiniteNumber(spread)) return 0;
  return clamp(spread / 2.0, -1, 1);
}

function buildHealthSummary(results) {
  const keys = Object.keys(results);
  const okCount = keys.filter((key) => results[key]?.ok).length;
  const total = keys.length;

  let status = 'degraded';
  if (okCount === total) status = 'ok';
  else if (okCount === 0) status = 'down';

  return {
    status,
    okCount,
    total,
    ratio: total > 0 ? okCount / total : 0
  };
}

// ── DEFAULT CENTRAL BANK PLACEHOLDER ────────────────────────
function buildCentralBankPlaceholder() {
  return {
    fed: 'manual',
    ecb: 'manual',
    boe: 'manual',
    boj: 'manual',
    rba: 'manual',
    rbnz: 'manual',
    boc: 'manual',
    snb: 'manual'
  };
}

// ── MAIN COREY INPUT OBJECT ─────────────────────────────────
async function getCoreyLiveData() {
  const startedAt = Date.now();

  const [dxyResult, vixResult, yieldResult] = await Promise.all([
    fetchDXY(),
    fetchVIX(),
    fetchYieldSpread()
  ]);

  const fetchResults = {
    dxy: dxyResult,
    vix: vixResult,
    yieldCurve: yieldResult
  };

  const health = buildHealthSummary(fetchResults);

  if (health.okCount === 0) {
    const error = buildError('All Corey live inputs failed', {
      fetchResults
    });
    logError('All Corey live inputs failed', error.meta);
    throw error;
  }

  const dxyPrice = dxyResult.ok ? dxyResult.value.price : null;
  const dxyChangePct = dxyResult.ok ? dxyResult.value.changePct : null;
  const dxyRegime = dxyResult.ok ? classifyDXY(dxyChangePct) : 'unknown';

  const vixPrice = vixResult.ok ? vixResult.value.price : null;
  const vixChangePct = vixResult.ok ? vixResult.value.changePct : null;
  const vixRegime = vixResult.ok ? classifyVIX(vixPrice) : 'unknown';

  const yieldSpread = yieldResult.ok ? yieldResult.value.spread : null;
  const yieldRegime = yieldResult.ok ? classifyYield(yieldSpread) : 'unknown';

  const dxyScore = normaliseDxyScore(dxyChangePct);
  const vixScore = normaliseVixScore(vixPrice);
  const yieldScore = normaliseYieldScore(yieldSpread);

  const compositeMacroPressure = clamp(
    (dxyScore * 0.40) + (vixScore * 0.35) + (yieldScore * 0.25),
    -1,
    1
  );

  const coreyInputs = {
    ok: health.okCount > 0,
    timestamp: Date.now(),
    asOf: nowIso(),
    latencyMs: Date.now() - startedAt,

    health,

    dxy: {
      ok: dxyResult.ok,
      symbol: dxyResult.ok ? dxyResult.value.symbol : null,
      price: dxyPrice,
      changePct: dxyChangePct,
      regime: dxyRegime,
      score: dxyScore,
      source: dxyResult.source,
      error: dxyResult.error
    },

    vix: {
      ok: vixResult.ok,
      symbol: vixResult.ok ? vixResult.value.symbol : null,
      price: vixPrice,
      changePct: vixChangePct,
      regime: vixRegime,
      score: vixScore,
      source: vixResult.source,
      error: vixResult.error
    },

    yieldCurve: {
      ok: yieldResult.ok,
      spread: yieldSpread,
      regime: yieldRegime,
      score: yieldScore,
      source: yieldResult.source,
      seriesId: yieldResult.ok ? yieldResult.value.seriesId : 'T10Y2Y',
      date: yieldResult.ok ? yieldResult.value.date : null,
      error: yieldResult.error
    },

    centralBank: buildCentralBankPlaceholder(),

    derived: {
      compositeMacroPressure,
      usdPressure:
        dxyRegime === 'bullish'
          ? 'stronger'
          : dxyRegime === 'bearish'
            ? 'weaker'
            : 'neutral',
      riskEnvironment:
        vixRegime === 'risk_off'
          ? 'defensive'
          : vixRegime === 'risk_on'
            ? 'supportive'
            : 'neutral',
      curveState: yieldRegime
    },

    debug: {
      env: {
        hasTwelveDataKey: !!process.env.TWELVE_DATA_API_KEY,
        hasTwelveDataKey: !!process.env.TWELVE_DATA_API_KEY,
        hasFredKey: !!process.env.FRED_KEY,
        usingTwelveDataEnv: process.env.TWELVE_DATA_API_KEY
          ? 'TWELVE_DATA_API_KEY'
          : process.env.TWELVE_DATA_API_KEY
            ? 'TWELVE_DATA_API_KEY'
            : null
      },
      rawSources: {
        dxy: dxyResult.raw || null,
        vix: vixResult.raw || null,
        yieldCurve: yieldResult.raw || null
      }
    }
  };

  logInfo(`Corey live data built — status: ${health.status}`, {
    latencyMs: coreyInputs.latencyMs,
    okCount: health.okCount,
    total: health.total
  });

  return coreyInputs;
}

// ── OPTIONAL SAFE WRAPPER ───────────────────────────────────
async function getCoreyLiveDataSafe() {
  try {
    return await getCoreyLiveData();
  } catch (error) {
    logError('getCoreyLiveDataSafe fallback triggered', {
      message: error.message,
      meta: error.meta || null
    });

    return {
      ok: false,
      timestamp: Date.now(),
      asOf: nowIso(),
      latencyMs: 0,
      health: {
        status: 'down',
        okCount: 0,
        total: 3,
        ratio: 0
      },
      dxy: {
        ok: false,
        symbol: null,
        price: null,
        changePct: null,
        regime: 'unknown',
        score: 0,
        source: null,
        error: { message: error.message, meta: error.meta || null }
      },
      vix: {
        ok: false,
        symbol: null,
        price: null,
        changePct: null,
        regime: 'unknown',
        score: 0,
        source: null,
        error: { message: error.message, meta: error.meta || null }
      },
      yieldCurve: {
        ok: false,
        spread: null,
        regime: 'unknown',
        score: 0,
        source: null,
        seriesId: 'T10Y2Y',
        date: null,
        error: { message: error.message, meta: error.meta || null }
      },
      centralBank: buildCentralBankPlaceholder(),
      derived: {
        compositeMacroPressure: 0,
        usdPressure: 'neutral',
        riskEnvironment: 'neutral',
        curveState: 'unknown'
      },
      debug: {
        env: {
          hasTwelveDataKey: !!process.env.TWELVE_DATA_API_KEY,
          hasTwelveDataKey: !!process.env.TWELVE_DATA_API_KEY,
          hasFredKey: !!process.env.FRED_KEY,
          usingTwelveDataEnv: process.env.TWELVE_DATA_API_KEY
            ? 'TWELVE_DATA_API_KEY'
            : process.env.TWELVE_DATA_API_KEY
              ? 'TWELVE_DATA_API_KEY'
              : null
        },
        rawSources: {
          dxy: null,
          vix: null,
          yieldCurve: null
        }
      }
    };
  }
}

module.exports = {
  getCoreyLiveData,
  getCoreyLiveDataSafe
};
