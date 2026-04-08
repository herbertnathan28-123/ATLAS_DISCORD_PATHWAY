'use strict';

// ============================================================
// COREY — LIVE DATA LAYER
// Fetches macro inputs for Corey scoring engine
// Does NOT change scoring logic
// ============================================================

const https = require('https');

// ── ENV ─────────────────────────────────────────────────────
const TWELVEDATA_KEY = process.env.TWELVEDATA_KEY;
const FRED_KEY       = process.env.FRED_KEY;

// ── FETCH HELPER ────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';

      res.on('data', chunk => data += chunk);

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });

    }).on('error', reject);
  });
}

// ── DXY ─────────────────────────────────────────────────────
async function fetchDXY() {
  const url =
    `https://api.twelvedata.com/quote?symbol=DXY&apikey=${TWELVEDATA_KEY}`;

  const data = await fetchJSON(url);

  return {
    price: parseFloat(data.close),
    changePct: parseFloat(data.percent_change),
    raw: data
  };
}

// ── VIX ─────────────────────────────────────────────────────
async function fetchVIX() {
  const url =
    `https://api.twelvedata.com/quote?symbol=VIX&apikey=${TWELVEDATA_KEY}`;

  const data = await fetchJSON(url);

  return {
    price: parseFloat(data.close),
    changePct: parseFloat(data.percent_change),
    raw: data
  };
}

// ── YIELD CURVE (10Y-2Y) ────────────────────────────────────
async function fetchYieldSpread() {
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=1`;

  const data = await fetchJSON(url);

  const value = parseFloat(data.observations[0].value);

  return {
    spread: value,
    raw: data
  };
}

// ── REGIME CLASSIFICATION ───────────────────────────────────
function classifyDXY(dxy) {
  if (dxy.changePct > 0.25) return "bullish";
  if (dxy.changePct < -0.25) return "bearish";
  return "neutral";
}

function classifyVIX(vix) {
  if (vix.price > 22) return "risk_off";
  if (vix.price < 16) return "risk_on";
  return "neutral";
}

function classifyYield(spread) {
  if (spread < 0) return "inverted";
  if (spread > 1) return "steep";
  return "normal";
}

// ── COREY INPUT OBJECT ──────────────────────────────────────
async function getCoreyLiveData() {

  const [dxy, vix, yieldSpread] = await Promise.all([
    fetchDXY(),
    fetchVIX(),
    fetchYieldSpread()
  ]);

  const coreyInputs = {

    timestamp: Date.now(),

    dxy: {
      price: dxy.price,
      changePct: dxy.changePct,
      regime: classifyDXY(dxy)
    },

    vix: {
      price: vix.price,
      changePct: vix.changePct,
      regime: classifyVIX(vix)
    },

    yieldCurve: {
      spread: yieldSpread.spread,
      regime: classifyYield(yieldSpread.spread)
    },

    centralBank: {
      fed: "manual",
      ecb: "manual",
      boe: "manual",
      rba: "manual"
    }

  };

  return coreyInputs;
}

module.exports = {
  getCoreyLiveData
};
