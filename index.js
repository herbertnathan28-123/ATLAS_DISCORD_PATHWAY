'use strict';
// ============================================================
// ATLAS FX DISCORD BOT — FULL INTELLIGENCE ENGINE v3.2
// HTF + LTF COMBINED MACRO — INSTITUTIONAL GRADE
// ============================================================

process.on('unhandledRejection', (r) => { console.error('[UNHANDLED]', r); });
process.on('uncaughtException',  (e) => { console.error('[CRASH]', e); });

// ── DEPENDENCIES ─────────────────────────────────────────────
const {
  Client, GatewayIntentBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} = require('discord.js');
const sharp        = require('sharp');
const path         = require('path');
const fs           = require('fs');
const https        = require('https');
const http         = require('http');
const { chromium } = require('playwright');

// ── ENVIRONMENT ──────────────────────────────────────────────
const TOKEN           = process.env.DISCORD_BOT_TOKEN;
const TV_LAYOUT       = process.env.TV_LAYOUT_ID || 'GmNAOGhI';
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || '';
if (!TOKEN)           { console.error('[FATAL] Missing DISCORD_BOT_TOKEN'); process.exit(1); }
if (!TWELVE_DATA_KEY) { console.error('[FATAL] Missing TWELVE_DATA_API_KEY'); process.exit(1); }

// ============================================================
// SYSTEM STATE — RENDER-CONTROLLED ENV VAR
// ============================================================
// Allowed values: BUILD_MODE | FULLY_OPERATIONAL
// No fallback. No default. No internal override.
// Set via Render environment variables panel.

const SYSTEM_STATE_ENUM = Object.freeze({
  BUILD_MODE:        'BUILD_MODE',
  FULLY_OPERATIONAL: 'FULLY_OPERATIONAL',
});

function getSystemState() {
  const raw = process.env.SYSTEM_STATE;
  if (!raw) {
    console.error('[FATAL] Missing SYSTEM_STATE environment variable. Must be BUILD_MODE or FULLY_OPERATIONAL.');
    process.exit(1);
  }
  if (!SYSTEM_STATE_ENUM[raw]) {
    console.error(`[FATAL] Invalid SYSTEM_STATE="${raw}". Must be BUILD_MODE or FULLY_OPERATIONAL.`);
    process.exit(1);
  }
  return raw;
}

const SYSTEM_STATE = getSystemState();
console.log(`[BOOT] SYSTEM_STATE: ${SYSTEM_STATE}`);

function isBuildMode()        { return SYSTEM_STATE === SYSTEM_STATE_ENUM.BUILD_MODE; }
function isFullyOperational() { return SYSTEM_STATE === SYSTEM_STATE_ENUM.FULLY_OPERATIONAL; }

// ── TRENDSPIDER CONFIG ───────────────────────────────────────
const TS_ENABLED       = process.env.ENABLE_TRENDSPIDER !== 'false';
const TS_PORT          = parseInt(process.env.TRENDSPIDER_PORT || '3001', 10);
const TS_TTL_MS        = parseInt(process.env.TRENDSPIDER_SIGNAL_TTL_MS || String(4 * 60 * 60 * 1000), 10);
const TS_HISTORY_LIMIT = parseInt(process.env.TRENDSPIDER_HISTORY_LIMIT || '10', 10);
const TS_PERSIST_PATH  = process.env.TRENDSPIDER_PERSIST_PATH || null;

// ── COOKIE SANITISATION ──────────────────────────────────────
const SAMESITE_MAP = {
  'strict': 'Strict', 'lax': 'Lax', 'none': 'None',
  'no_restriction': 'None', 'unspecified': 'Lax',
};
function sanitiseCookies(raw) {
  return raw
    .map((c) => {
      const out    = { ...c };
      const key    = String(out.sameSite || '').toLowerCase();
      out.sameSite = SAMESITE_MAP[key] || 'Lax';
      if (!out.domain) out.domain = '.tradingview.com';
      if (!out.path)   out.path   = '/';
      delete out.hostOnly; delete out.storeId; delete out.id;
      return out;
    })
    .filter((c) => c.domain && c.domain.includes('tradingview'));
}
let TV_COOKIES = null;
try {
  if (process.env.TV_COOKIES) {
    TV_COOKIES = sanitiseCookies(JSON.parse(process.env.TV_COOKIES));
    console.log(`[BOOT] TV_COOKIES: ${TV_COOKIES.length} cookies loaded`);
  }
} catch (e) { console.error('[BOOT] TV_COOKIES parse error:', e.message); }

console.log(`[BOOT] ATLAS FX v3.2 starting... auth:${TV_COOKIES ? 'COOKIE' : 'GUEST'} trendspider:${TS_ENABLED ? 'ENABLED' : 'DISABLED'}`);

// ── DISCORD CLIENT ───────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
client.once('clientReady', () => console.log(`[READY] ATLAS FX Bot online as ${client.user.tag}`));

// ── CONFIG ───────────────────────────────────────────────────
const EXPORT_DIR            = process.env.EXPORT_DIR || path.join(__dirname, 'exports');
const MAX_RETRIES           = 2;
const RENDER_TIMEOUT_MS     = 45000;
const MESSAGE_DEDUPE_TTL_MS = 30000;
const SHARED_MACROS_CHANNEL = process.env.SHARED_MACROS_CHANNEL_ID || '1434253776360968293';
const CACHE_TTL_MS          = 15 * 60 * 1000;
const PANEL_W               = 1280;
const PANEL_H               = 720;

// ============================================================
// CORE ENGINE v3.2 — CONSTANTS + HELPERS
// ============================================================

const EPSILON = 1e-9;

const BIAS        = Object.freeze({ BULLISH: 'Bullish', BEARISH: 'Bearish', NEUTRAL: 'Neutral' });
const RISK_ENV    = Object.freeze({ RISK_ON: 'RiskOn', RISK_OFF: 'RiskOff', NEUTRAL: 'Neutral' });
const REGIME      = Object.freeze({ EXPANSION: 'Expansion', GROWTH: 'Growth', TRANSITION: 'Transition', CONTRACTION: 'Contraction', CRISIS: 'Crisis', NEUTRAL: 'Neutral' });
const ASSET_CLASS = Object.freeze({ FX: 'FX', EQUITY: 'Equity', COMMODITY: 'Commodity', INDEX: 'Index', UNKNOWN: 'Unknown' });
const STANCE      = Object.freeze({ HAWKISH: 'Hawkish', DOVISH: 'Dovish', NEUTRAL: 'Neutral', N_A: 'N/A' });
const RATE_CYCLE  = Object.freeze({ HIKING: 'Hiking', CUTTING: 'Cutting', HOLDING: 'Holding', N_A: 'N/A' });
const GRADE       = Object.freeze({ A: 'A', B: 'B', C: 'C', D: 'D', NONE: 'NONE' });

const THRESHOLDS = Object.freeze({
  macroBullish: 0.15, macroBearish: -0.15,
  fxBullish: 0.20, fxBearish: -0.20,
  strongConfidence: 0.60, moderateConfidence: 0.30,
  tsStrong: 0.65, tsWeak: 0.25,
  tradeValidConfidence: 0.45,
});

const FX_QUOTES         = new Set(['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF','SEK','NOK','DKK','SGD','HKD','CNH','CNY']);
const EQUITY_SYMBOLS    = new Set(['AMD','MU','ASML','MICRON','NVDA','AVGO','TSM','QCOM','AAPL','MSFT','META','GOOGL','AMZN','TSLA','INTC']);
const COMMODITY_SYMBOLS = new Set(['XAUUSD','XAGUSD','XAUEUR','XAGEUR','USOIL','WTI','BRENT','BCOUSD','NATGAS']);
const INDEX_SYMBOLS     = new Set(['NAS100','US500','US30','GER40','UK100','HK50','JPN225','SPX','NDX','DJI']);
const SEMI_SYMBOLS      = new Set(['AMD','MU','ASML','MICRON','NVDA','AVGO','TSM','QCOM','INTC']);

const CURRENCY_COUNTRY = Object.freeze({
  USD: { country: 'United States',  weight: 1.00 },
  EUR: { country: 'Eurozone',       weight: 1.00 },
  GBP: { country: 'United Kingdom', weight: 0.90 },
  JPY: { country: 'Japan',          weight: 0.90 },
  AUD: { country: 'Australia',      weight: 0.85 },
  NZD: { country: 'New Zealand',    weight: 0.75 },
  CAD: { country: 'Canada',         weight: 0.85 },
  CHF: { country: 'Switzerland',    weight: 0.80 },
  SEK: { country: 'Sweden',         weight: 0.60 },
  NOK: { country: 'Norway',         weight: 0.60 },
  DKK: { country: 'Denmark',        weight: 0.55 },
  SGD: { country: 'Singapore',      weight: 0.65 },
  HKD: { country: 'Hong Kong',      weight: 0.55 },
  CNH: { country: 'China Offshore', weight: 0.80 },
  CNY: { country: 'China',          weight: 0.85 },
});

const CENTRAL_BANKS = Object.freeze({
  USD: { name: 'Federal Reserve',                  stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.90, growthSensitivity: 0.80 },
  EUR: { name: 'European Central Bank',            stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.85, growthSensitivity: 0.70 },
  GBP: { name: 'Bank of England',                 stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.90, growthSensitivity: 0.75 },
  JPY: { name: 'Bank of Japan',                   stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.65, growthSensitivity: 0.60 },
  AUD: { name: 'Reserve Bank of Australia',       stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.85, growthSensitivity: 0.80 },
  NZD: { name: 'Reserve Bank of New Zealand',     stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.85, growthSensitivity: 0.75 },
  CAD: { name: 'Bank of Canada',                  stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.85, growthSensitivity: 0.75 },
  CHF: { name: 'Swiss National Bank',             stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.75, growthSensitivity: 0.65 },
  SEK: { name: 'Riksbank',                        stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.75, growthSensitivity: 0.65 },
  NOK: { name: 'Norges Bank',                     stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.80, growthSensitivity: 0.70 },
  DKK: { name: 'Danmarks Nationalbank',           stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.70, growthSensitivity: 0.65 },
  SGD: { name: 'Monetary Authority of Singapore', stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.80, growthSensitivity: 0.75 },
  HKD: { name: 'Hong Kong Monetary Authority',   stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.70, growthSensitivity: 0.65 },
  CNH: { name: "People's Bank of China Offshore", stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.60, growthSensitivity: 0.85 },
  CNY: { name: "People's Bank of China",          stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.60, growthSensitivity: 0.85 },
});

const ECONOMIC_BASELINES = Object.freeze({
  USD: { gdpMomentum: 0.68, employment: 0.72, inflationControl: 0.55, fiscalPosition: 0.45, politicalStability: 0.55 },
  EUR: { gdpMomentum: 0.48, employment: 0.57, inflationControl: 0.60, fiscalPosition: 0.48, politicalStability: 0.55 },
  GBP: { gdpMomentum: 0.44, employment: 0.56, inflationControl: 0.52, fiscalPosition: 0.42, politicalStability: 0.50 },
  JPY: { gdpMomentum: 0.45, employment: 0.66, inflationControl: 0.58, fiscalPosition: 0.32, politicalStability: 0.72 },
  AUD: { gdpMomentum: 0.58, employment: 0.64, inflationControl: 0.52, fiscalPosition: 0.58, politicalStability: 0.72 },
  NZD: { gdpMomentum: 0.49, employment: 0.58, inflationControl: 0.50, fiscalPosition: 0.56, politicalStability: 0.76 },
  CAD: { gdpMomentum: 0.54, employment: 0.60, inflationControl: 0.54, fiscalPosition: 0.55, politicalStability: 0.72 },
  CHF: { gdpMomentum: 0.52, employment: 0.66, inflationControl: 0.72, fiscalPosition: 0.74, politicalStability: 0.86 },
  SEK: { gdpMomentum: 0.46, employment: 0.56, inflationControl: 0.62, fiscalPosition: 0.68, politicalStability: 0.80 },
  NOK: { gdpMomentum: 0.57, employment: 0.59, inflationControl: 0.65, fiscalPosition: 0.82, politicalStability: 0.84 },
  DKK: { gdpMomentum: 0.53, employment: 0.61, inflationControl: 0.67, fiscalPosition: 0.79, politicalStability: 0.85 },
  SGD: { gdpMomentum: 0.62, employment: 0.66, inflationControl: 0.63, fiscalPosition: 0.78, politicalStability: 0.88 },
  HKD: { gdpMomentum: 0.49, employment: 0.58, inflationControl: 0.60, fiscalPosition: 0.70, politicalStability: 0.64 },
  CNH: { gdpMomentum: 0.55, employment: 0.60, inflationControl: 0.58, fiscalPosition: 0.62, politicalStability: 0.48 },
  CNY: { gdpMomentum: 0.56, employment: 0.61, inflationControl: 0.59, fiscalPosition: 0.63, politicalStability: 0.48 },
});

const DEFAULT_MARKET_CONTEXT = Object.freeze({
  oilShock: 0, creditStress: 0, geopoliticalStress: 0, growthImpulse: 0,
  inflationImpulse: 0, usdFlow: 0, bondStress: 0, equityBreadth: 0,
  safeHavenFlow: 0, semiconductorCycle: 0, aiCapexImpulse: 0,
  commodityDemand: 0, realYieldPressure: 0, recessionRisk: 0,
});

// ── LOW LEVEL HELPERS ─────────────────────────────────────────
function clamp(v, min = -1, max = 1)  { return Number.isFinite(v) ? Math.min(Math.max(v, min), max) : 0; }
function clamp01(v)                    { return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0; }
function round2(v)                     { if (!Number.isFinite(v)) return 0; return Math.round((v + EPSILON) * 100) / 100; }
function average(arr)                  { const f = arr.filter(Number.isFinite); return f.length ? f.reduce((s, v) => s + v, 0) / f.length : 0; }
function weightedAvg(items) {
  let n = 0, d = 0;
  for (const { value, weight } of items) { if (!Number.isFinite(value) || !Number.isFinite(weight)) continue; n += value * weight; d += weight; }
  return d ? n / d : 0;
}
function deepClone(x) { return JSON.parse(JSON.stringify(x)); }
function scoreToBias(score, bull = THRESHOLDS.macroBullish, bear = THRESHOLDS.macroBearish) {
  return score > bull ? BIAS.BULLISH : score < bear ? BIAS.BEARISH : BIAS.NEUTRAL;
}
function confidenceTier(c) { return c >= THRESHOLDS.strongConfidence ? 'Strong' : c >= THRESHOLDS.moderateConfidence ? 'Moderate' : 'Weak'; }
function gradeFromConf(c)  { return c >= 0.80 ? GRADE.A : c >= 0.60 ? GRADE.B : c >= 0.30 ? GRADE.C : c > 0 ? GRADE.D : GRADE.NONE; }
function safeCountry(ccy)  { return CURRENCY_COUNTRY[ccy]?.country || ccy; }
function normalizeSymbolCore(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }
function isFxPair(s) { return s.length === 6 && FX_QUOTES.has(s.slice(0, 3)) && FX_QUOTES.has(s.slice(3, 6)); }
function inferAssetClass(s) {
  if (EQUITY_SYMBOLS.has(s))    return ASSET_CLASS.EQUITY;
  if (COMMODITY_SYMBOLS.has(s)) return ASSET_CLASS.COMMODITY;
  if (INDEX_SYMBOLS.has(s))     return ASSET_CLASS.INDEX;
  if (isFxPair(s))               return ASSET_CLASS.FX;
  if (/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s)) return ASSET_CLASS.COMMODITY;
  if (/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s)) return ASSET_CLASS.INDEX;
  if (/^[A-Z]{1,5}$/.test(s))   return ASSET_CLASS.EQUITY;
  return ASSET_CLASS.UNKNOWN;
}
function parsePairCore(symbol) {
  const s = normalizeSymbolCore(symbol);
  if (isFxPair(s)) return { symbol: s, base: s.slice(0, 3), quote: s.slice(3, 6), assetClass: ASSET_CLASS.FX };
  if (['XAUUSD','XAGUSD','BCOUSD'].includes(s)) return { symbol: s, base: s.slice(0, 3), quote: s.slice(3, 6), assetClass: inferAssetClass(s) };
  return { symbol: s, base: s, quote: 'USD', assetClass: inferAssetClass(s) };
}
function makeStubCB(label = 'Commodity') {
  return { name: label, stance: STANCE.N_A, direction: STANCE.N_A, rateCycle: RATE_CYCLE.N_A, terminalBias: 0, inflationSensitivity: 0.5, growthSensitivity: 0.5, score: 0, language: label };
}
function makeStubEcon() {
  return { gdpMomentum: 0.5, employment: 0.5, inflationControl: 0.5, fiscalPosition: 0.5, politicalStability: 0.5, composite: 0.5 };
}

// ============================================================
// PIP ENGINE — INSTRUMENT-AWARE SCALING
// ============================================================
// No hardcoded decimal bands. All pip sizes derived from instrument class.
// Rules:
//   FX standard pairs  → 1 pip = 0.0001, default band ±0.0002, max ±0.0004
//   JPY pairs          → 1 pip = 0.01,   default band ±0.02,   max ±0.04
//   XAUUSD             → 1 pip = 0.10,   default band ±0.20,   max ±0.40
//   XAGUSD             → 1 pip = 0.01,   default band ±0.02,   max ±0.04
//   Indices            → 1 pip = 1.0,    default band ±2.0,    max ±4.0
//   Oil/Brent          → 1 pip = 0.01,   default band ±0.02,   max ±0.04
//   Equities           → 1 pip = 0.01,   default band ±0.02,   max ±0.04

function getPipSize(symbol) {
  const s = normalizeSymbolCore(symbol);

  // JPY pairs
  if (s.includes('JPY')) return { pipSize: 0.01, dp: 3 };

  // Silver
  if (s === 'XAGUSD' || s === 'XAGEUR') return { pipSize: 0.01, dp: 3 };

  // Gold
  if (s === 'XAUUSD' || s === 'XAUEUR') return { pipSize: 0.10, dp: 2 };

  // Oil / Brent
  if (/BCOUSD|USOIL|WTI|BRENT/.test(s)) return { pipSize: 0.01, dp: 3 };

  // Natural Gas
  if (/NATGAS/.test(s)) return { pipSize: 0.001, dp: 4 };

  // Indices
  if (INDEX_SYMBOLS.has(s) || /NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s)) {
    return { pipSize: 1.0, dp: 1 };
  }

  // Equities
  if (EQUITY_SYMBOLS.has(s) || SEMI_SYMBOLS.has(s)) return { pipSize: 0.01, dp: 3 };

  // FX standard (default)
  if (isFxPair(s)) return { pipSize: 0.0001, dp: 5 };

  // Fallback — treat as standard FX
  return { pipSize: 0.0001, dp: 5 };
}

// Returns { low, high } band around a level using ±pips (default 2, fast market max 4)
// fastMarket: boolean — widens to 4 pip band
function getPipBand(symbol, level, fastMarket = false) {
  if (!level || !Number.isFinite(level)) return null;
  const { pipSize, dp } = getPipSize(symbol);
  const pips = fastMarket ? 4 : 2;
  const offset = pipSize * pips;
  return {
    low:  parseFloat((level - offset).toFixed(dp)),
    high: parseFloat((level + offset).toFixed(dp)),
    pipSize,
    pips,
    dp,
  };
}

// Format a pip band as a human-readable string
function formatPipBand(symbol, level, fastMarket = false) {
  const band = getPipBand(symbol, level, fastMarket);
  if (!band) return 'N/A';
  return `${band.low.toFixed(band.dp)} – ${band.high.toFixed(band.dp)}`;
}

// ── CENTRAL BANK ENGINE ───────────────────────────────────────
function cbDirectionScore(cb) {
  if (!cb) return 0;
  let s = 0;
  if (cb.direction === STANCE.HAWKISH) s += 0.20;
  if (cb.direction === STANCE.DOVISH)  s -= 0.20;
  if (cb.stance    === STANCE.HAWKISH) s += 0.10;
  if (cb.stance    === STANCE.DOVISH)  s -= 0.10;
  if (cb.rateCycle === RATE_CYCLE.HIKING)  s += 0.10;
  if (cb.rateCycle === RATE_CYCLE.CUTTING) s -= 0.10;
  s += clamp(cb.terminalBias || 0, -0.20, 0.20);
  return round2(clamp(s, -0.50, 0.50));
}
function assessCentralBankStance(currency) {
  const ccy = normalizeSymbolCore(currency);
  const bl  = CENTRAL_BANKS[ccy];
  if (!bl)  return makeStubCB('Unknown');
  const out = deepClone(bl);
  out.score = cbDirectionScore(out);
  return out;
}

// ── ECONOMIC STRENGTH ENGINE ──────────────────────────────────
function assessEconomicStrength(currency) {
  const ccy = normalizeSymbolCore(currency);
  const bl  = ECONOMIC_BASELINES[ccy] || makeStubEcon();
  const econ = {
    gdpMomentum:        clamp01(bl.gdpMomentum),
    employment:         clamp01(bl.employment),
    inflationControl:   clamp01(bl.inflationControl),
    fiscalPosition:     clamp01(bl.fiscalPosition),
    politicalStability: clamp01(bl.politicalStability),
  };
  econ.composite = round2(weightedAvg([
    { value: econ.gdpMomentum,        weight: 0.26 },
    { value: econ.employment,         weight: 0.22 },
    { value: econ.inflationControl,   weight: 0.20 },
    { value: econ.fiscalPosition,     weight: 0.14 },
    { value: econ.politicalStability, weight: 0.18 },
  ]));
  return econ;
}

// ── GLOBAL MACRO ENGINE ───────────────────────────────────────
async function assessGlobalMacro(ctx = {}) {
  const c = { ...DEFAULT_MARKET_CONTEXT, ...ctx };
  let dxyScore = 0;
  dxyScore += c.usdFlow * 0.40 + c.safeHavenFlow * 0.20 + c.creditStress * 0.18 + c.bondStress * 0.12 + c.realYieldPressure * 0.10;
  dxyScore -= c.growthImpulse * 0.14 + c.equityBreadth * 0.12;
  dxyScore = round2(clamp(dxyScore));
  let riskScore = 0;
  riskScore -= c.geopoliticalStress * 0.30 + c.creditStress * 0.22 + c.bondStress * 0.12 + c.oilShock * 0.12 + c.recessionRisk * 0.18 + c.safeHavenFlow * 0.20;
  riskScore += c.growthImpulse * 0.22 + c.equityBreadth * 0.22 + c.aiCapexImpulse * 0.08 + c.semiconductorCycle * 0.08;
  riskScore = round2(clamp(riskScore));
  return {
    dxyScore,
    dxyBias:    dxyScore > 0.10 ? BIAS.BULLISH : dxyScore < -0.10 ? BIAS.BEARISH : BIAS.NEUTRAL,
    riskScore,
    riskEnv:    riskScore > 0.12 ? RISK_ENV.RISK_ON : riskScore < -0.12 ? RISK_ENV.RISK_OFF : RISK_ENV.NEUTRAL,
    context:    c,
    confidence: round2(clamp01(average([Math.abs(dxyScore), Math.abs(riskScore)]))),
  };
}

// ── REGIME / VOLATILITY / LIQUIDITY ──────────────────────────
function detectMarketRegime(global) {
  let regime = REGIME.NEUTRAL;
  if      (global.riskEnv === RISK_ENV.RISK_ON  && global.dxyBias === BIAS.BEARISH)  regime = REGIME.EXPANSION;
  else if (global.riskEnv === RISK_ENV.RISK_OFF && global.dxyBias === BIAS.BULLISH)  regime = REGIME.CRISIS;
  else if (global.riskEnv === RISK_ENV.RISK_ON)   regime = REGIME.GROWTH;
  else if (global.riskEnv === RISK_ENV.RISK_OFF)  regime = REGIME.CONTRACTION;
  else regime = REGIME.TRANSITION;
  return { regime, confidence: round2(clamp01(Math.abs(global.riskScore))) };
}
function computeVolatilityProfile(global) {
  const c = global.context;
  const vol = Math.abs(c.geopoliticalStress) * 0.35 + Math.abs(c.creditStress) * 0.22 + Math.abs(c.bondStress) * 0.18 + Math.abs(c.oilShock) * 0.12 + Math.abs(c.recessionRisk) * 0.13;
  return { volatilityScore: round2(vol), level: vol > 0.60 ? 'High' : vol > 0.30 ? 'Moderate' : 'Low' };
}
function assessLiquidity(global) {
  const c = global.context;
  let s = 0;
  s -= c.creditStress * 0.40 + c.bondStress * 0.28 + c.realYieldPressure * 0.12;
  s += c.growthImpulse * 0.20 + c.equityBreadth * 0.12;
  s = round2(clamp(s));
  return { liquidityScore: s, state: s > 0.20 ? 'Loose' : s < -0.20 ? 'Tight' : 'Neutral' };
}

// ── SECTOR / ASSET INTELLIGENCE ──────────────────────────────
function assessSectorStrength(symbol, global) {
  const s = normalizeSymbolCore(symbol);
  let sector = 'General', score = 0;
  const notes = [];
  if (SEMI_SYMBOLS.has(s)) {
    sector = 'Semiconductors';
    score += global.context.aiCapexImpulse * 0.40 + global.context.semiconductorCycle * 0.40;
    if (global.riskEnv === RISK_ENV.RISK_OFF) score -= 0.20;
    notes.push('AI capex + semiconductor cycle weighted');
  } else if (EQUITY_SYMBOLS.has(s)) {
    sector = 'Equity';
    if (global.riskEnv === RISK_ENV.RISK_ON)  score += 0.20;
    if (global.riskEnv === RISK_ENV.RISK_OFF) score -= 0.20;
    notes.push('General equity beta weighted');
  } else if (s === 'XAUUSD' || s === 'XAUEUR') {
    sector = 'Precious Metals';
    if (global.riskEnv === RISK_ENV.RISK_OFF) score += 0.30;
    if (global.dxyBias === BIAS.BULLISH)       score -= 0.18;
    if (global.dxyBias === BIAS.BEARISH)       score += 0.10;
    notes.push('Safe haven + USD interaction weighted');
  } else if (s === 'XAGUSD' || s === 'XAGEUR') {
    sector = 'Silver';
    if (global.dxyBias === BIAS.BEARISH) score += 0.10;
    if (global.dxyBias === BIAS.BULLISH) score -= 0.10;
    notes.push('Silver balanced between industrial and haven flows');
  } else if (/OIL|WTI|BRENT|BCOUSD|USOIL/.test(s)) {
    sector = 'Energy';
    score += global.context.oilShock * 0.26 + global.context.commodityDemand * 0.18;
    if (global.context.recessionRisk > 0) score -= global.context.recessionRisk * 0.14;
    notes.push('Oil shock + demand + recession drag weighted');
  } else if (/NATGAS/.test(s)) {
    sector = 'Gas';
    score += global.context.commodityDemand * 0.20 + global.context.oilShock * 0.05;
    notes.push('Gas demand + energy crossflow weighted');
  } else if (INDEX_SYMBOLS.has(s)) {
    sector = 'Index';
    if (global.riskEnv === RISK_ENV.RISK_ON)  score += 0.22;
    if (global.riskEnv === RISK_ENV.RISK_OFF) score -= 0.22;
    if (global.dxyBias === BIAS.BEARISH)       score += 0.06;
    if (global.dxyBias === BIAS.BULLISH)       score -= 0.06;
    notes.push('Index beta weighted');
  }
  return { sector, score: round2(clamp(score)), notes };
}

function getAssetSpecificAdjustments(symbol, global) {
  const s          = normalizeSymbolCore(symbol);
  const ac         = inferAssetClass(s);
  const sectorInfo = assessSectorStrength(s, global);
  let score        = sectorInfo.score;
  const notes      = [...sectorInfo.notes];
  if (ac === ASSET_CLASS.EQUITY) {
    if (global.riskEnv === RISK_ENV.RISK_ON)  { score += 0.25; notes.push('Risk-on supports equities'); }
    if (global.riskEnv === RISK_ENV.RISK_OFF) { score -= 0.25; notes.push('Risk-off pressures equities'); }
    if (global.dxyBias === BIAS.BEARISH) { score += 0.10; notes.push('Weak USD supports risk assets'); }
    if (global.dxyBias === BIAS.BULLISH) { score -= 0.10; notes.push('Strong USD pressures risk assets'); }
  }
  if (ac === ASSET_CLASS.COMMODITY && s === 'XAUUSD') {
    if (global.riskEnv === RISK_ENV.RISK_OFF) score += 0.24;
    if (global.dxyBias === BIAS.BULLISH)       score -= 0.12;
    if (global.dxyBias === BIAS.BEARISH)       score += 0.10;
  }
  if (ac === ASSET_CLASS.INDEX) {
    if (global.riskEnv === RISK_ENV.RISK_ON)  score += 0.22;
    if (global.riskEnv === RISK_ENV.RISK_OFF) score -= 0.22;
  }
  return { assetClass: ac, score: round2(clamp(score, -0.80, 0.80)), notes, sectorInfo };
}

function applyAdvancedAdjustments(baseScore, sector, volatility, liquidity, regime) {
  let adj = baseScore;
  if (volatility.level === 'High') adj *= 0.85;
  if (volatility.level === 'Low')  adj *= 1.05;
  if (liquidity.state === 'Loose') adj += 0.05;
  if (liquidity.state === 'Tight') adj -= 0.05;
  if (regime.regime === REGIME.CRISIS)    adj *= 0.85;
  if (regime.regime === REGIME.EXPANSION) adj *= 1.05;
  adj += sector.score * 0.20;
  return round2(clamp(adj));
}

// ── COREY MACRO ENGINE ────────────────────────────────────────
async function runCoreyMacro(symbol, marketContext = {}) {
  const parsed = parsePairCore(symbol);
  const { base, quote, assetClass } = parsed;
  const global     = await assessGlobalMacro(marketContext);
  const regime     = detectMarketRegime(global);
  const volatility = computeVolatilityProfile(global);
  const liquidity  = assessLiquidity(global);
  const isNonFx    = assetClass !== ASSET_CLASS.FX;
  if (isNonFx) {
    const assetAdj      = getAssetSpecificAdjustments(parsed.symbol, global);
    const baseCB        = makeStubCB(assetAdj.assetClass);
    const baseEcon      = makeStubEcon();
    const quoteCB       = assessCentralBankStance(quote);
    const quoteEcon     = assessEconomicStrength(quote);
    const adjustedScore = applyAdvancedAdjustments(assetAdj.score, assetAdj.sectorInfo, volatility, liquidity, regime);
    const macroBias     = scoreToBias(adjustedScore);
    const confidence    = round2(clamp01(Math.abs(adjustedScore)));
    return {
      symbol: parsed.symbol, assetClass: assetAdj.assetClass,
      base:  { currency: base,  country: base,               cb: baseCB,  econ: baseEcon,  weight: 0.50 },
      quote: { currency: quote, country: safeCountry(quote),  cb: quoteCB, econ: quoteEcon, weight: CURRENCY_COUNTRY[quote]?.weight || 0.50 },
      global, regime, volatility, liquidity,
      sector: assetAdj.sectorInfo,
      macroScore: adjustedScore, macroBias, confidence,
      reasoning: assetAdj.notes, parsed,
    };
  }
  const baseCB    = assessCentralBankStance(base);
  const quoteCB   = assessCentralBankStance(quote);
  const baseEcon  = assessEconomicStrength(base);
  const quoteEcon = assessEconomicStrength(quote);
  let macroScore  = 0;
  macroScore += (baseEcon.composite - quoteEcon.composite) * 0.80;
  macroScore += (baseCB.score - quoteCB.score) * 1.00;
  if (parsed.quote === 'USD') { if (global.dxyBias === BIAS.BULLISH) macroScore -= 0.15; if (global.dxyBias === BIAS.BEARISH) macroScore += 0.15; }
  if (parsed.base  === 'USD') { if (global.dxyBias === BIAS.BULLISH) macroScore += 0.15; if (global.dxyBias === BIAS.BEARISH) macroScore -= 0.15; }
  if (global.riskEnv === RISK_ENV.RISK_OFF) { if (['JPY','CHF','USD'].includes(base)) macroScore += 0.05; if (['JPY','CHF','USD'].includes(quote)) macroScore -= 0.05; }
  if (global.riskEnv === RISK_ENV.RISK_ON)  { if (['AUD','NZD','CAD'].includes(base)) macroScore += 0.05; if (['AUD','NZD','CAD'].includes(quote)) macroScore -= 0.05; }
  macroScore = round2(clamp(macroScore));
  const sectorStub    = { sector: 'FX', score: 0, notes: [] };
  const adjustedScore = applyAdvancedAdjustments(macroScore, sectorStub, volatility, liquidity, regime);
  const macroBias     = scoreToBias(adjustedScore, THRESHOLDS.fxBullish, THRESHOLDS.fxBearish);
  const confidence    = round2(clamp01(Math.abs(adjustedScore)));
  return {
    symbol: parsed.symbol, assetClass: ASSET_CLASS.FX,
    base:  { currency: base,  country: safeCountry(base),  cb: baseCB,  econ: baseEcon,  weight: CURRENCY_COUNTRY[base]?.weight  || 0.50 },
    quote: { currency: quote, country: safeCountry(quote), cb: quoteCB, econ: quoteEcon, weight: CURRENCY_COUNTRY[quote]?.weight || 0.50 },
    global, regime, volatility, liquidity,
    sector: sectorStub,
    macroScore: adjustedScore, macroBias, confidence,
    reasoning: [], parsed,
  };
}

// ── SYMBOL MAPS ───────────────────────────────────────────────
const ALIAS_MAP = {
  gold: 'XAUUSD', xau: 'XAUUSD', silver: 'XAGUSD', xag: 'XAGUSD',
  brent: 'BCOUSD', wti: 'USOIL', oil: 'USOIL',
  nas100: 'NAS100', nas: 'NAS100', nasdaq: 'NAS100',
  sp500: 'US500', spx: 'US500', us500: 'US500',
  dow: 'US30', dji: 'US30', us30: 'US30',
  dax: 'GER40', ger40: 'GER40', ftse: 'UK100', uk100: 'UK100',
  natgas: 'NATGAS', ng: 'NATGAS',
  micron: 'MICRON', mu: 'MICRON', amd: 'AMD', asml: 'ASML',
};

const SYMBOL_OVERRIDES = {
  XAUUSD: 'OANDA:XAUUSD',    XAGUSD: 'OANDA:XAGUSD',
  BCOUSD: 'OANDA:BCOUSD',    USOIL:  'OANDA:BCOUSD',
  NAS100: 'OANDA:NAS100USD', US500:  'OANDA:SPX500USD',
  US30:   'OANDA:US30USD',   GER40:  'OANDA:DE30EUR',
  UK100:  'OANDA:UK100GBP',  NATGAS: 'NYMEX:NG1!',
  MICRON: 'NASDAQ:MU',       AMD:    'NASDAQ:AMD',
  ASML:   'NASDAQ:ASML',
};

const TD_SYMBOL_MAP = {
  XAUUSD: 'XAU/USD', XAGUSD: 'XAG/USD', BCOUSD: 'BCO/USD', USOIL: 'WTI/USD',
  NAS100: 'NDX', US500: 'SPX', US30: 'DJI', GER40: 'DAX',
  UK100: 'UKX', NATGAS: 'NG/USD',
  EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY',
  AUDUSD: 'AUD/USD', NZDUSD: 'NZD/USD', USDCAD: 'USD/CAD',
  USDCHF: 'USD/CHF', EURGBP: 'EUR/GBP', EURJPY: 'EUR/JPY',
  GBPJPY: 'GBP/JPY', AUDJPY: 'AUD/JPY', CADJPY: 'CAD/JPY',
  NZDJPY: 'NZD/JPY', CHFJPY: 'CHF/JPY', EURCHF: 'EUR/CHF',
  EURAUD: 'EUR/AUD', EURCAD: 'EUR/CAD', GBPAUD: 'GBP/AUD',
  GBPCAD: 'GBP/CAD', GBPCHF: 'GBP/CHF', AUDCAD: 'AUD/CAD',
  AUDCHF: 'AUD/CHF', AUDNZD: 'AUD/NZD', CADCHF: 'CAD/CHF',
  NZDCAD: 'NZD/CAD', NZDCHF: 'NZD/CHF',
  MICRON: 'MU', AMD: 'AMD', ASML: 'ASML', NVDA: 'NVDA',
};

const TD_INTERVAL_MAP = {
  '1W': '1week', '1D': '1day', '240': '4h', '120': '2h',
  '60': '1h', '30': '30min', '15': '15min', '5': '5min',
  '3': '3min', '1': '1min',
};

const CORRELATION_MAP = {
  EURUSD: { positive: ['GBPUSD','AUDUSD','NZDUSD'], negative: ['USDCHF','USDJPY'] },
  GBPUSD: { positive: ['EURUSD','AUDUSD'],          negative: ['USDCHF','USDJPY'] },
  USDJPY: { positive: ['USDCHF','USDCAD'],          negative: ['EURUSD','GBPUSD','XAUUSD'] },
  AUDUSD: { positive: ['NZDUSD','EURUSD'],          negative: ['USDJPY','USDCAD'] },
  XAUUSD: { positive: ['XAGUSD','AUDUSD'],          negative: ['USDJPY'] },
  AUDJPY: { positive: ['NZDJPY','CADJPY'],          negative: ['XAUUSD'] },
};

function resolveSymbol(raw) { return ALIAS_MAP[raw.toLowerCase().trim()] || raw.toUpperCase(); }
function getTVSymbol(symbol) {
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;
  return `NASDAQ:${symbol}`;
}
function getFeedName(symbol) {
  const feed = getTVSymbol(symbol).split(':')[0];
  return { OANDA: 'OANDA', NASDAQ: 'NASDAQ', NYSE: 'NYSE', NYMEX: 'NYMEX', TVC: 'TVC' }[feed] || feed;
}

// ── TIMEFRAMES ────────────────────────────────────────────────
const TF_MAP = {
  '1w':'1W','w':'1W','weekly':'1W','1d':'1D','d':'1D','daily':'1D',
  '4h':'240','4':'240','4hr':'240','2h':'120','2':'120',
  '1h':'60','1':'60','1hr':'60','30m':'30','30':'30',
  '15m':'15','15':'15','5m':'5','5':'5','3m':'3','3':'3','1m':'1',
  '240':'240','120':'120','60':'60',
};

const HTF_INTERVALS = ['1W','1D','240','60'];
const LTF_INTERVALS = ['30','15','5','1'];
const DEFAULT_TIMEFRAMES = { H: HTF_INTERVALS, L: LTF_INTERVALS };

const TF_LABELS     = { '1W':'Weekly','1D':'Daily','240':'4H','120':'2H','60':'1H','30':'30M','15':'15M','5':'5M','3':'3M','1':'1M' };
const TF_RESOLUTION = { '1W':'W','1D':'D','240':'240','120':'120','60':'60','30':'30','15':'15','5':'5','3':'3','1':'1' };

function resolveTF(input) { return TF_MAP[input.toLowerCase().trim()] || null; }
function parseCustomTFs(s) { const p = s.split(',').map((x) => x.trim()); if (p.length !== 4) return null; const r = p.map(resolveTF); return r.includes(null) ? null : r; }
function tfLabel(iv) { return TF_LABELS[iv] || iv; }

// ── COMMAND PARSER ────────────────────────────────────────────
function parseCommand(content) {
  const trimmed = (content || '').trim();
  if (trimmed === '!ping') return { action: 'ping' };

  const macroMatch = trimmed.match(/^!([A-Z0-9]{2,12})\s+macro$/i);
  if (macroMatch) {
    const symbol = resolveSymbol(macroMatch[1]);
    return {
      action: 'chart', rawSymbol: macroMatch[1], symbol, mode: 'LH',
      htfIntervals: HTF_INTERVALS, ltfIntervals: LTF_INTERVALS,
      intervals: HTF_INTERVALS, combined: true, customTFs: false, parseError: null,
    };
  }

  const combinedMatch = trimmed.match(/^!([A-Z0-9]{2,12})\s+(L\/H|LH)$/i);
  if (combinedMatch) {
    const symbol = resolveSymbol(combinedMatch[1]);
    return {
      action: 'chart', rawSymbol: combinedMatch[1], symbol, mode: 'LH',
      htfIntervals: HTF_INTERVALS, ltfIntervals: LTF_INTERVALS,
      intervals: HTF_INTERVALS, combined: true, customTFs: false, parseError: null,
    };
  }

  const singleMatch = trimmed.match(/^!([A-Z0-9]{2,12})([LH])(?:\s+([^\s].*))?$/i);
  if (!singleMatch) return null;

  const rawSymbol = singleMatch[1], mode = singleMatch[2].toUpperCase(), tfString = singleMatch[3] ? singleMatch[3].trim() : null;
  const symbol    = resolveSymbol(rawSymbol);
  let intervals   = DEFAULT_TIMEFRAMES[mode], customTFs = false, parseError = null;
  if (tfString) {
    const parsed = parseCustomTFs(tfString);
    if (parsed) { intervals = parsed; customTFs = true; }
    else parseError = `Invalid timeframes: \`${tfString}\`\nFormat: 4 comma-separated values e.g. \`4,1,15,1\``;
  }
  return {
    action: 'chart', rawSymbol, symbol, mode,
    htfIntervals: mode === 'H' ? intervals : HTF_INTERVALS,
    ltfIntervals: mode === 'L' ? intervals : LTF_INTERVALS,
    intervals, combined: false, customTFs, parseError,
  };
}

function log(level, msg, ...args) { console.log(`[${new Date().toISOString()}] [${level}] ${msg}`, ...args); }

// ============================================================
// REQUEST AUDIT LOG
// ============================================================

const REQUEST_LOG = [];
const MAX_LOG_SIZE = 200;

const FLAGS  = Object.freeze({ CRYPTO_ATTEMPT: 'CRYPTO_ATTEMPT', INVALID_SYMBOL: 'INVALID_SYMBOL', UNKNOWN_COMMAND: 'UNKNOWN_COMMAND', RENDER_WARNING: 'RENDER_WARNING', PLACEHOLDER_USED: 'PLACEHOLDER_USED', SUCCESS: 'SUCCESS' });
const OUTCOME = Object.freeze({ BLOCKED: 'BLOCKED', FAILED: 'FAILED', PARTIAL: 'PARTIAL', SUCCESS: 'SUCCESS' });

function auditLog(entry) {
  REQUEST_LOG.unshift({ ...entry, time: new Date().toISOString() });
  if (REQUEST_LOG.length > MAX_LOG_SIZE) REQUEST_LOG.length = MAX_LOG_SIZE;
}
function auditUpdate(time, updates) {
  const e = REQUEST_LOG.find((r) => r.time === time);
  if (e) Object.assign(e, updates);
}

// ── CRYPTO BLOCKER ────────────────────────────────────────────
const CRYPTO_KEYWORDS = new Set(['BTC','ETH','XRP','SOL','DOGE','ADA','BNB','DOT','MATIC','AVAX','LINK','LTC','BCH','XLM','ALGO','ATOM','VET','ICP','BITCOIN','ETHEREUM','CRYPTO','USDT','USDC','SHIB','PEPE']);

function isCryptoAttempt(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  return CRYPTO_KEYWORDS.has(s) || s.endsWith('USDT') || s.endsWith('USDC') || s.endsWith('BTC') || s.startsWith('BTC');
}

// ── STATS TRACKER ─────────────────────────────────────────────
const STATS = { total: 0, crypto: 0, partial: 0, failed: 0, success: 0, symbols: {} };

function trackStats(symbol, outcome) {
  STATS.total++;
  if (outcome === OUTCOME.BLOCKED) STATS.crypto++;
  else if (outcome === OUTCOME.PARTIAL) STATS.partial++;
  else if (outcome === OUTCOME.FAILED) STATS.failed++;
  else if (outcome === OUTCOME.SUCCESS) STATS.success++;
  if (symbol) { STATS.symbols[symbol] = (STATS.symbols[symbol] || 0) + 1; }
}

// ============================================================
// TRENDSPIDER SIGNAL STORE
// ============================================================

const TS_STORE = new Map();

function tsNormaliseDirection(raw) {
  if (!raw) return 'Neutral';
  const v = String(raw).toLowerCase();
  if (v.includes('bull') || v === 'up' || v === 'long' || v === 'buy') return 'Bullish';
  if (v.includes('bear') || v === 'down' || v === 'short' || v === 'sell') return 'Bearish';
  return 'Neutral';
}
function tsNormaliseSignalType(raw) {
  if (!raw) return 'Unknown';
  const v = String(raw).toLowerCase();
  if (v.includes('break'))   return 'Breakout';
  if (v.includes('revers'))  return 'Reversal';
  if (v.includes('continu')) return 'Continuation';
  if (v.includes('warn'))    return 'Warning';
  if (v.includes('pattern')) return 'Pattern';
  if (v.includes('scan'))    return 'Scanner';
  return 'Unknown';
}
function tsNormalisePayload(raw, receiveTime) {
  const symbol         = (raw.symbol || raw.ticker || raw.pair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const resolvedSymbol = resolveSymbol(symbol) || symbol;
  const direction      = tsNormaliseDirection(raw.direction || raw.trend || raw.signal || '');
  const signalType     = tsNormaliseSignalType(raw.signal_type || raw.signal || raw.strategy || raw.scanner || '');
  let strength   = parseFloat(raw.strength   || raw.confidence || 0.5);
  let confidence = parseFloat(raw.confidence || raw.strength   || 0.5);
  strength   = Math.max(0, Math.min(1, isNaN(strength)   ? 0.5 : strength));
  confidence = Math.max(0, Math.min(1, isNaN(confidence) ? 0.5 : confidence));
  const timestamp = raw.timestamp
    ? (typeof raw.timestamp === 'number' ? raw.timestamp * (raw.timestamp < 1e12 ? 1000 : 1) : Date.parse(raw.timestamp))
    : receiveTime;
  return { symbol: resolvedSymbol, timeframe: raw.timeframe || raw.interval || null, signalType, direction, pattern: raw.pattern || raw.strategy || null, strategy: raw.strategy || null, scanner: raw.scanner || null, strength, confidence, price: raw.price ? parseFloat(raw.price) : null, timestamp, notes: raw.notes || null, raw };
}
function tsGradeSignal(signal, now) {
  const ageMs = now - signal.timestamp;
  if (ageMs > TS_TTL_MS) return 'Stale';
  if (!signal.direction || signal.direction === 'Neutral') return 'Unusable';
  if (ageMs > TS_TTL_MS * 0.75) return 'FreshLow';
  if (signal.confidence >= 0.70 && ageMs < TS_TTL_MS * 0.25) return 'FreshHigh';
  if (signal.confidence >= 0.45) return 'FreshMedium';
  return 'FreshLow';
}
function tsStoreSignal(signal) {
  const sym = signal.symbol;
  if (!TS_STORE.has(sym)) TS_STORE.set(sym, { latest: null, history: [] });
  const entry = TS_STORE.get(sym);
  entry.latest = signal;
  entry.history.unshift(signal);
  if (entry.history.length > TS_HISTORY_LIMIT) entry.history.length = TS_HISTORY_LIMIT;
  if (TS_PERSIST_PATH) tsPersist();
  log('INFO', `[TS STORE] ${sym} ${signal.direction} ${signal.signalType} strength:${signal.strength.toFixed(2)}`);
}
function tsGetSignal(symbol) { const e = TS_STORE.get(symbol); return e ? e.latest : null; }
function tsPersist() {
  try {
    const obj = {};
    for (const [sym, entry] of TS_STORE.entries()) obj[sym] = entry;
    fs.writeFileSync(TS_PERSIST_PATH, JSON.stringify(obj), 'utf8');
  } catch (e) { log('WARN', `[TS PERSIST] ${e.message}`); }
}
function tsLoadPersisted() {
  if (!TS_PERSIST_PATH) return;
  try {
    if (!fs.existsSync(TS_PERSIST_PATH)) return;
    const data = JSON.parse(fs.readFileSync(TS_PERSIST_PATH, 'utf8'));
    const now = Date.now(); let loaded = 0;
    for (const [sym, entry] of Object.entries(data)) {
      if (entry.latest && (now - entry.latest.timestamp) < TS_TTL_MS) { TS_STORE.set(sym, entry); loaded++; }
    }
    log('INFO', `[TS LOAD] ${loaded} non-stale symbols loaded from disk`);
  } catch (e) { log('WARN', `[TS LOAD] ${e.message}`); }
}
setInterval(() => {
  const now = Date.now(); let removed = 0;
  for (const [sym, entry] of TS_STORE.entries()) {
    if (entry.latest && (now - entry.latest.timestamp) > TS_TTL_MS * 2) { TS_STORE.delete(sym); removed++; }
  }
  if (removed > 0) log('INFO', `[TS CLEANUP] Removed ${removed} expired signal(s)`);
}, 30 * 60 * 1000);

// ============================================================
// TRENDSPIDER WEBHOOK SERVER
// ============================================================

function startTSWebhookServer() {
  if (!TS_ENABLED) { log('INFO', '[TS SERVER] TrendSpider disabled — webhook server not started'); return; }
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'ATLAS FX TrendSpider Receiver', signals: TS_STORE.size }));
      return;
    }
    if (req.method === 'POST' && req.url === '/trendspider') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const receiveTime = Date.now();
        try {
          const raw    = JSON.parse(body);
          const rawSym = raw.symbol || raw.ticker || raw.pair || '';
          if (!rawSym) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Missing symbol/ticker/pair field' })); return; }
          const signal = tsNormalisePayload(raw, receiveTime);
          if (!signal.symbol) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Could not resolve symbol' })); return; }
          const grade = tsGradeSignal(signal, receiveTime);
          if (grade !== 'Unusable') tsStoreSignal(signal);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, symbol: signal.symbol, stored: grade !== 'Unusable', status: grade, direction: signal.direction, strength: signal.strength, timestamp: signal.timestamp }));
        } catch (e) {
          log('WARN', `[TS SERVER] Malformed payload: ${e.message}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }));
        }
      });
      req.on('error', () => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Request error' })); });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });
  server.on('error', (e) => { log('ERROR', `[TS SERVER] ${e.message}`); });
  server.listen(TS_PORT, () => {
    log('INFO', `[TS SERVER] TrendSpider webhook listening on port ${TS_PORT}`);
    log('INFO', `[TS SERVER] Endpoint: POST /trendspider | Health: GET /health`);
  });
}

// ============================================================
// OHLC DATA — TWELVEDATA
// ============================================================

function tdResolveSymbol(symbol) { return TD_SYMBOL_MAP[symbol] || symbol; }

function fetchOHLC(symbol, resolution, count = 200) {
  return new Promise((resolve, reject) => {
    const tdSym      = encodeURIComponent(tdResolveSymbol(symbol));
    const tdInterval = TD_INTERVAL_MAP[resolution] || '1day';
    const options    = {
      hostname: 'api.twelvedata.com',
      path:     `/time_series?symbol=${tdSym}&interval=${tdInterval}&outputsize=${count}&apikey=${TWELVE_DATA_KEY}&format=JSON`,
      method:   'GET',
      headers:  { 'User-Agent': 'ATLAS-FX/3.2' },
      timeout:  15000,
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; });
      r.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.status === 'error' || !p.values || !Array.isArray(p.values)) {
            reject(new Error(`TwelveData: ${p.message || p.code || 'unknown error'}`));
            return;
          }
          const candles = p.values.slice().reverse().map((v) => ({
            time:   Math.floor(new Date(v.datetime).getTime() / 1000),
            open:   parseFloat(v.open),
            high:   parseFloat(v.high),
            low:    parseFloat(v.low),
            close:  parseFloat(v.close),
            volume: v.volume ? parseFloat(v.volume) : 0,
          }));
          resolve(candles);
        } catch (e) { reject(new Error(`TwelveData parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('TwelveData timeout')));
    req.end();
  });
}

async function safeOHLC(symbol, resolution, count = 200) {
  try { return await fetchOHLC(symbol, resolution, count); }
  catch (e) { log('WARN', `[OHLC] ${symbol} ${resolution}: ${e.message}`); return null; }
}

// ============================================================
// SPIDEY — STRUCTURE INTELLIGENCE ENGINE
// ============================================================

function detectSwings(candles, lookback = 3) {
  const swingHighs = [], swingLows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]; let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low  <= c.low)  isLow  = false;
    }
    if (isHigh) swingHighs.push({ index: i, level: c.high, time: c.time });
    if (isLow)  swingLows.push( { index: i, level: c.low,  time: c.time });
  }
  return { swingHighs, swingLows };
}

function classifyStructure(swingHighs, swingLows, lookbackSwings = 4) {
  const rh = swingHighs.slice(-lookbackSwings), rl = swingLows.slice(-lookbackSwings);
  if (rh.length < 2 || rl.length < 2) return { bias: 'Neutral', structure: 'Insufficient data', conviction: 0.3, highPattern: [], lowPattern: [] };
  const hp = [], lp = [];
  for (let i = 1; i < rh.length; i++) hp.push(rh[i].level > rh[i-1].level ? 'HH' : 'LH');
  for (let i = 1; i < rl.length; i++) lp.push(rl[i].level > rl[i-1].level ? 'HL' : 'LL');
  const hhC = hp.filter((x) => x === 'HH').length, lhC = hp.filter((x) => x === 'LH').length;
  const hlC = lp.filter((x) => x === 'HL').length, llC = lp.filter((x) => x === 'LL').length;
  const total = hp.length + lp.length;
  const bull  = (hhC + hlC) / total, bear = (lhC + llC) / total;
  let bias, structure, conviction;
  if      (bull >= 0.75) { bias = 'Bullish'; structure = 'Trending';   conviction = bull; }
  else if (bear >= 0.75) { bias = 'Bearish'; structure = 'Trending';   conviction = bear; }
  else if (bull >= 0.55) { bias = 'Bullish'; structure = 'Transition'; conviction = bull * 0.8; }
  else if (bear >= 0.55) { bias = 'Bearish'; structure = 'Transition'; conviction = bear * 0.8; }
  else                   { bias = 'Neutral'; structure = 'Range';       conviction = 0.3; }
  return { bias, structure, conviction, highPattern: hp, lowPattern: lp };
}

function detectBreaks(candles, swingHighs, swingLows) {
  if (candles.length < 5 || !swingHighs.length || !swingLows.length) return { lastBreak: 'None', direction: null, breakLevel: null, isEngineered: false };
  const last   = candles[candles.length - 1];
  const prev20 = candles.slice(-20);
  const lastSH = swingHighs[swingHighs.length - 1], lastSL = swingLows[swingLows.length - 1];
  const prev5  = prev20.slice(-5);
  const rHigh  = Math.max(...prev5.map((c) => c.high)), rLow = Math.min(...prev5.map((c) => c.low));
  const bullBOS   = last.close > lastSH.level, bearBOS   = last.close < lastSL.level;
  const bullCHoCH = last.close > rHigh && !bullBOS, bearCHoCH = last.close < rLow && !bearBOS;
  const wickAbove  = prev20.some((c) => c.high > lastSH.level && c.close <= lastSH.level);
  const wickBelow  = prev20.some((c) => c.low  < lastSL.level && c.close >= lastSL.level);
  const isEngineered = wickAbove || wickBelow;
  if (bullBOS)   return { lastBreak: 'BOS',   direction: 'Bullish', breakLevel: lastSH.level, isEngineered: false };
  if (bearBOS)   return { lastBreak: 'BOS',   direction: 'Bearish', breakLevel: lastSL.level, isEngineered: false };
  if (bullCHoCH) return { lastBreak: 'CHoCH', direction: 'Bullish', breakLevel: rHigh, isEngineered };
  if (bearCHoCH) return { lastBreak: 'CHoCH', direction: 'Bearish', breakLevel: rLow,  isEngineered };
  return { lastBreak: 'None', direction: null, breakLevel: null, isEngineered: false };
}

function detectZones(candles) {
  const zones = { supply: [], demand: [] };
  if (candles.length < 10) return zones;
  const currentPrice = candles[candles.length - 1].close;
  for (let i = 3; i < candles.length - 3; i++) {
    const base    = candles[i];
    const impulse = candles.slice(i + 1, i + 4);
    const bearImpulse = impulse.every((c) => c.close < c.open) && impulse.reduce((s, c) => s + (c.open - c.close), 0) > (base.high - base.low) * 1.5;
    const bullImpulse = impulse.every((c) => c.close > c.open) && impulse.reduce((s, c) => s + (c.close - c.open), 0) > (base.high - base.low) * 1.5;
    if (bearImpulse && base.close > base.open) zones.supply.push({ high: base.high, low: Math.min(base.open, base.close), time: base.time });
    if (bullImpulse && base.close < base.open) zones.demand.push({ high: Math.max(base.open, base.close), low: base.low, time: base.time });
  }
  zones.supply = zones.supply.filter((z) => z.low > currentPrice).sort((a, b) => a.low - b.low).slice(0, 3);
  zones.demand = zones.demand.filter((z) => z.high < currentPrice).sort((a, b) => b.high - a.high).slice(0, 3);
  return zones;
}

function detectImbalances(candles) {
  const ims = [], cp = candles[candles.length - 1].close;
  for (let i = 0; i < candles.length - 2; i++) {
    const c1 = candles[i], c3 = candles[i + 2], c2 = candles[i + 1];
    if (c3.low  > c1.high) ims.push({ type: 'Bullish', high: c3.low,  low: c1.high, time: c2.time, filled: cp >= c1.high });
    if (c3.high < c1.low)  ims.push({ type: 'Bearish', high: c1.low,  low: c3.high, time: c2.time, filled: cp <= c1.low });
  }
  return ims.filter((im) => !im.filled).slice(-5);
}

function detectLiquidity(candles, tol = 0.0005) {
  const pools = [], seen = new Set(), cp = candles[candles.length - 1].close;
  for (let i = 0; i < candles.length - 1; i++) {
    for (const type of ['EQH','EQL']) {
      const val = type === 'EQH' ? candles[i].high : candles[i].low;
      const key = `${type}_${val.toFixed(5)}`;
      if (seen.has(key)) continue;
      const matches = candles.filter((c) => Math.abs((type === 'EQH' ? c.high : c.low) - val) / val < tol).length;
      if (matches >= 2) { seen.add(key); pools.push({ type, level: val, strength: matches, time: candles[i].time }); }
    }
  }
  return pools.sort((a, b) => b.strength - a.strength)
    .map((p) => ({ ...p, proximate: Math.abs(p.level - cp) / cp < 0.005 }))
    .slice(0, 6);
}

async function runSpideyHTF(symbol, intervals) {
  log('INFO', `[SPIDEY-HTF] ${symbol} [${intervals.join(',')}]`);
  const results   = {};
  const tfWeights = { '1W': 4, '1D': 3, '240': 2, '60': 1 };
  for (const iv of intervals) {
    const candles = await safeOHLC(symbol, iv, 200);
    if (!candles || candles.length < 20) {
      results[iv] = { bias: 'Neutral', structure: 'No data', conviction: 0, lastBreak: 'None', currentPrice: 0 };
      continue;
    }
    const { swingHighs, swingLows } = detectSwings(candles, 3);
    const structure  = classifyStructure(swingHighs, swingLows);
    const breaks     = detectBreaks(candles, swingHighs, swingLows);
    const zones      = detectZones(candles);
    const imbalances = detectImbalances(candles);
    const liquidity  = detectLiquidity(candles);
    results[iv] = {
      bias: structure.bias, structure: structure.structure, conviction: Math.round(structure.conviction * 100) / 100,
      lastBreak: breaks.lastBreak, breakDirection: breaks.direction, breakLevel: breaks.breakLevel, isEngineered: breaks.isEngineered,
      activeSupply: zones.supply[0] || null, activeDemand: zones.demand[0] || null,
      allSupply: zones.supply, allDemand: zones.demand,
      imbalances, liquidityPools: liquidity,
      swingHighs: swingHighs.slice(-3), swingLows: swingLows.slice(-3),
      currentPrice: candles[candles.length - 1].close,
    };
  }
  let wScore = 0, wTotal = 0;
  for (const [iv, r] of Object.entries(results)) {
    const w = tfWeights[iv] || 1, s = r.bias === 'Bullish' ? 1 : r.bias === 'Bearish' ? -1 : 0;
    wScore += s * w * r.conviction; wTotal += w;
  }
  const norm               = wTotal > 0 ? wScore / wTotal : 0;
  const dominantBias       = norm > 0.2 ? 'Bullish' : norm < -0.2 ? 'Bearish' : 'Neutral';
  const dominantConviction = Math.min(Math.abs(norm), 1);
  const allBreaks          = Object.entries(results)
    .filter(([, r]) => r.lastBreak !== 'None')
    .map(([iv, r]) => ({ ...r, timeframe: iv, weight: tfWeights[iv] || 1 }))
    .sort((a, b) => b.weight - a.weight);
  const significantBreak = allBreaks[0] || null;
  const currentPrice     = results[intervals[0]]?.currentPrice || 0;
  let nearestDraw = null;
  for (const [, r] of Object.entries(results)) { const liq = r.liquidityPools?.find((p) => p.proximate); if (liq) { nearestDraw = liq; break; } }
  const summary = buildSpideySummaryHTF(dominantBias, dominantConviction, significantBreak, intervals);
  log('INFO', `[SPIDEY-HTF] ${symbol} → ${dominantBias} (${dominantConviction.toFixed(2)})`);
  return { timeframes: results, dominantBias, dominantConviction, significantBreak, nearestDraw, currentPrice, summary };
}

async function runSpideyLTF(symbol, intervals) {
  log('INFO', `[SPIDEY-LTF] ${symbol} [${intervals.join(',')}]`);
  const results   = {};
  const tfWeights = { '30': 3, '15': 2, '5': 1, '1': 0.5 };
  for (const iv of intervals) {
    const candles = await safeOHLC(symbol, iv, 150);
    if (!candles || candles.length < 20) {
      results[iv] = { bias: 'Neutral', structure: 'No data', conviction: 0, lastBreak: 'None', currentPrice: 0 };
      continue;
    }
    const { swingHighs, swingLows } = detectSwings(candles, 2);
    const structure  = classifyStructure(swingHighs, swingLows);
    const breaks     = detectBreaks(candles, swingHighs, swingLows);
    const zones      = detectZones(candles);
    const imbalances = detectImbalances(candles);
    const liquidity  = detectLiquidity(candles);
    results[iv] = {
      bias: structure.bias, structure: structure.structure, conviction: Math.round(structure.conviction * 100) / 100,
      lastBreak: breaks.lastBreak, breakDirection: breaks.direction, breakLevel: breaks.breakLevel, isEngineered: breaks.isEngineered,
      activeSupply: zones.supply[0] || null, activeDemand: zones.demand[0] || null,
      allSupply: zones.supply, allDemand: zones.demand,
      imbalances, liquidityPools: liquidity,
      swingHighs: swingHighs.slice(-3), swingLows: swingLows.slice(-3),
      currentPrice: candles[candles.length - 1].close,
    };
  }
  let wScore = 0, wTotal = 0;
  for (const [iv, r] of Object.entries(results)) {
    const w = tfWeights[iv] || 1, s = r.bias === 'Bullish' ? 1 : r.bias === 'Bearish' ? -1 : 0;
    wScore += s * w * r.conviction; wTotal += w;
  }
  const norm          = wTotal > 0 ? wScore / wTotal : 0;
  const dominantBias  = norm > 0.15 ? 'Bullish' : norm < -0.15 ? 'Bearish' : 'Neutral';
  const dominantConviction = Math.min(Math.abs(norm), 1);
  const allBreaks     = Object.entries(results)
    .filter(([, r]) => r.lastBreak !== 'None')
    .map(([iv, r]) => ({ ...r, timeframe: iv, weight: tfWeights[iv] || 1 }))
    .sort((a, b) => b.weight - a.weight);
  const significantBreak = allBreaks[0] || null;
  const currentPrice  = results[intervals[0]]?.currentPrice || 0;
  let nearestDraw = null;
  for (const [, r] of Object.entries(results)) { const liq = r.liquidityPools?.find((p) => p.proximate); if (liq) { nearestDraw = liq; break; } }
  log('INFO', `[SPIDEY-LTF] ${symbol} → ${dominantBias} (${dominantConviction.toFixed(2)})`);
  return { timeframes: results, dominantBias, dominantConviction, significantBreak, nearestDraw, currentPrice };
}

async function runSpideyMicro(symbol, htfBias) {
  const m15 = await safeOHLC(symbol, '15', 100), m5 = await safeOHLC(symbol, '5', 100);
  if (!m15 || !m5) return { entryConfirmed: false, ltfBias: 'No data', sweepDetected: false, inInducement: false, ltfBreak: 'None', ltfBreakLevel: null, alignedWithHTF: false, summary: 'Insufficient LTF data' };
  const m15S = detectSwings(m15, 2), m15St = classifyStructure(m15S.swingHighs, m15S.swingLows), m15B = detectBreaks(m15, m15S.swingHighs, m15S.swingLows);
  const m5S  = detectSwings(m5,  2), m5B   = detectBreaks(m5, m5S.swingHighs, m5S.swingLows);
  const ltfSweep    = m15B.isEngineered || m5B.isEngineered;
  const rH15        = m15S.swingHighs.slice(-3);
  const inInducement = rH15.filter((h, i) => rH15.some((h2, j) => j !== i && Math.abs(h.level - h2.level) / h.level < 0.001)).length > 0;
  const alignedWithHTF = m15St.bias === htfBias;
  const entryConfirmed = alignedWithHTF && (m15B.lastBreak === 'BOS' || m15B.lastBreak === 'CHoCH') && !inInducement;
  return { entryConfirmed, ltfBias: m15St.bias, ltfConviction: m15St.conviction, sweepDetected: ltfSweep, inInducement, ltfBreak: m15B.lastBreak, ltfBreakLevel: m15B.breakLevel, alignedWithHTF, m5Break: m5B.lastBreak, summary: buildMicroSummary(entryConfirmed, m15St, m15B, ltfSweep, inInducement) };
}

function buildSpideySummaryHTF(bias, conviction, sig, intervals) {
  const tier = conviction > 0.7 ? 'Strong' : conviction > 0.4 ? 'Moderate' : 'Weak';
  const br   = sig ? `${sig.lastBreak}${sig.isEngineered ? ' (engineered)' : ''} on ${tfLabel(sig.timeframe)} at ${sig.breakLevel?.toFixed(5) || 'N/A'}` : 'No significant break';
  return `${tier} ${bias} across ${intervals.length} TFs. ${br}.`;
}
function buildMicroSummary(confirmed, st, br, sweep, ind) {
  if (ind)       return 'Caution: Inducement zone detected — potential trap. Wait for sweep + LTF BOS.';
  if (sweep)     return `Sweep detected. ${confirmed ? 'Entry conditions met.' : 'Wait for BOS.'}`;
  if (confirmed) return `LTF ${br.lastBreak} confirmed. Execution aligned with HTF.`;
  return `No LTF confirmation. ${st.bias} ${st.structure}.`;
}

// ============================================================
// COREY — MACRO + TRENDSPIDER INTELLIGENCE ENGINE
// ============================================================

async function runCoreyTrendSpider(symbol) {
  if (!TS_ENABLED) return { available: false, fresh: false, signalBias: 'Neutral', signalType: 'None', pattern: null, strategy: null, scanner: null, strength: 0, confidence: 0, ageMs: null, status: 'Unavailable', grade: 'Unusable', summary: 'TrendSpider disabled' };
  const signal = tsGetSignal(symbol);
  if (!signal)  return { available: false, fresh: false, signalBias: 'Neutral', signalType: 'None', pattern: null, strategy: null, scanner: null, strength: 0, confidence: 0, ageMs: null, status: 'Unavailable', grade: 'Unusable', summary: 'No TrendSpider signal available' };
  const now = Date.now(), grade = tsGradeSignal(signal, now), ageMs = now - signal.timestamp;
  const fresh = grade === 'FreshHigh' || grade === 'FreshMedium';
  if (!fresh) return { available: true, fresh: false, signalBias: signal.direction, signalType: signal.signalType, pattern: signal.pattern, strategy: signal.strategy, scanner: signal.scanner, strength: signal.strength, confidence: signal.confidence, ageMs, status: 'Stale', grade, summary: `Stale TrendSpider signal (${Math.round(ageMs / 60000)}m old) — ignored` };
  let directionMatchesPrice = null, priceDistanceFromSignal = null;
  const candles = await safeOHLC(symbol, '1D', 10);
  if (candles && candles.length >= 3 && signal.price) {
    const currentPrice      = candles[candles.length - 1].close;
    priceDistanceFromSignal = ((currentPrice - signal.price) / signal.price) * 100;
    const priceDir          = currentPrice > candles[0].close ? 'Bullish' : currentPrice < candles[0].close ? 'Bearish' : 'Neutral';
    directionMatchesPrice   = (signal.direction === priceDir) || (priceDir === 'Neutral');
  }
  const ageStr  = ageMs < 3600000 ? `${Math.round(ageMs / 60000)}m` : `${(ageMs / 3600000).toFixed(1)}h`;
  const summary = `${grade} ${signal.direction} ${signal.signalType}${signal.pattern ? ` — ${signal.pattern}` : ''} (${ageStr} old, strength ${(signal.strength * 100).toFixed(0)}%)`;
  log('INFO', `[COREY-TS] ${symbol} ${signal.direction} ${signal.signalType} grade:${grade}`);
  return { available: true, fresh, signalBias: signal.direction, signalType: signal.signalType, pattern: signal.pattern, strategy: signal.strategy, scanner: signal.scanner, strength: signal.strength, confidence: signal.confidence, ageMs, directionMatchesPrice, priceDistanceFromSignal, status: 'Active', grade, summary };
}

async function runCoreyCorrelation(symbol) {
  const corrs = CORRELATION_MAP[symbol];
  if (!corrs)   return { positive: [], negative: [], divergent: [], symbolBias: 'Neutral', summary: `No correlation map for ${symbol}` };
  const symCandles = await safeOHLC(symbol, '1D', 30);
  let symbolBias   = 'Neutral';
  if (symCandles?.length >= 10) { const sw = detectSwings(symCandles, 3); symbolBias = classifyStructure(sw.swingHighs, sw.swingLows).bias; }
  const results = { positive: [], negative: [], divergent: [] };
  for (const pair of (corrs.positive || []).slice(0, 3)) {
    const c = await safeOHLC(pair, '1D', 30);
    if (!c || c.length < 10) continue;
    const sw = detectSwings(c, 3), st = classifyStructure(sw.swingHighs, sw.swingLows);
    results.positive.push({ pair, bias: st.bias, conviction: st.conviction });
  }
  for (const pair of (corrs.negative || []).slice(0, 3)) {
    const c = await safeOHLC(pair, '1D', 30);
    if (!c || c.length < 10) continue;
    const sw = detectSwings(c, 3), st = classifyStructure(sw.swingHighs, sw.swingLows);
    results.negative.push({ pair, bias: st.bias, conviction: st.conviction });
  }
  for (const pos of results.positive) { if (pos.bias !== 'Neutral' && pos.bias !== symbolBias && pos.conviction > 0.5) results.divergent.push({ pair: pos.pair, expected: symbolBias, actual: pos.bias, significance: 'Positive-correlated pair diverging' }); }
  const summary = results.divergent.length > 0 ? `Divergence: ${results.divergent[0].pair} moving contrary to ${symbol}` : `${results.positive.filter((p) => p.bias === symbolBias).length} correlated pair(s) aligned`;
  return { ...results, symbolBias, summary };
}

async function runCorey(symbol) {
  log('INFO', `[COREY] ${symbol}`);
  const [coreyMacroResult, tsResult, corrResult] = await Promise.all([
    runCoreyMacro(symbol),
    runCoreyTrendSpider(symbol),
    runCoreyCorrelation(symbol),
  ]);
  const { macroBias, confidence, global, regime, volatility, liquidity, sector, base, quote } = coreyMacroResult;
  const biasScores    = { Bullish: 1, Neutral: 0, Bearish: -1 };
  const internalScore = biasScores[macroBias] * confidence;
  let tsScore = 0, tsEffect = 'Unavailable';
  if (tsResult.available && tsResult.fresh && (tsResult.grade === 'FreshHigh' || tsResult.grade === 'FreshMedium')) {
    tsScore  = biasScores[tsResult.signalBias] * tsResult.confidence;
    tsEffect = tsResult.signalBias === macroBias ? 'ConfidenceBoost' : 'ConfidenceReduction';
  } else if (tsResult.grade === 'Stale') {
    tsScore = 0; tsEffect = 'Ignored';
  }
  const coreyCombinedScore = (internalScore * 0.75) + (tsScore * 0.25);
  const combinedBias       = coreyCombinedScore > 0.15 ? 'Bullish' : coreyCombinedScore < -0.15 ? 'Bearish' : 'Neutral';
  const combinedConf       = Math.min(Math.abs(coreyCombinedScore), 1);
  const alignment          = tsResult.available && tsResult.fresh && tsResult.signalBias === macroBias;
  const contradiction      = tsResult.available && tsResult.fresh && tsResult.signalBias !== 'Neutral' && tsResult.signalBias !== macroBias && macroBias !== 'Neutral';
  let escalation = 'None';
  if (tsEffect === 'ConfidenceBoost' && tsResult.grade === 'FreshHigh') escalation = 'ConfidenceBoost';
  else if (contradiction && tsResult.grade === 'FreshHigh') escalation = 'Warning';
  else if (contradiction) escalation = 'ConfidenceReduction';
  const summary = buildCoreySummaryFull(coreyMacroResult, tsResult, combinedBias, combinedConf, alignment, contradiction);
  log('INFO', `[COREY] ${symbol} → internal:${macroBias} TS:${tsResult.signalBias} combined:${combinedBias}`);
  return {
    internalMacro: coreyMacroResult,
    trendSpider:   tsResult,
    correlation:   corrResult,
    macroBias, combinedBias,
    confidence: Math.round(combinedConf * 100) / 100,
    combinedScore: Math.round(coreyCombinedScore * 100) / 100,
    alignment, contradiction, escalation, tsEffect, summary,
  };
}

function buildCoreySummaryFull(macro, ts, combinedBias, conf, aligned, conflict) {
  const tier    = confidenceTier(conf);
  const tsStr   = ts.available && ts.fresh
    ? (aligned ? `TS ${ts.grade} confirms ${combinedBias}.` : `TS ${ts.grade} ${conflict ? 'conflicts with' : 'diverges from'} macro.`)
    : 'No TS signal.';
  const baseDesc = macro.base.cb.stance === STANCE.N_A
    ? `${macro.base.currency}: ${macro.assetClass}`
    : `${macro.base.currency}:${macro.base.cb.stance} ${macro.base.econ.composite > 0.6 ? 'strong' : 'weak'}`;
  return `${tier} ${combinedBias} macro. ${baseDesc}. ${macro.quote.currency}:${macro.quote.cb.stance}. DXY:${macro.global.dxyBias} Risk:${macro.global.riskEnv}. ${tsStr}`;
}

// ============================================================
// JANE — FINAL ARBITRATION ENGINE (10-CASE CONFLICT MATRIX)
// ============================================================

function runJane(symbol, spideyHTF, spideyLTF, coreyResult, mode) {
  log('INFO', `[JANE] Synthesising ${symbol} mode:${mode}`);

  const htfBias  = spideyHTF.dominantBias,  htfConv  = spideyHTF.dominantConviction;
  const ltfBias  = spideyLTF ? spideyLTF.dominantBias  : htfBias;
  const ltfConv  = spideyLTF ? spideyLTF.dominantConviction : htfConv;
  const coreyBias = coreyResult.combinedBias, coreyConf = coreyResult.confidence;
  const tsBias    = coreyResult.trendSpider.signalBias, tsGrade = coreyResult.trendSpider.grade;
  const tsFresh   = coreyResult.trendSpider.fresh, tsAvail = coreyResult.trendSpider.available;
  const biasS     = { Bullish: 1, Neutral: 0, Bearish: -1 };

  const spideyScore = mode === 'LH'
    ? (biasS[htfBias] * htfConv * 0.60) + (biasS[ltfBias] * ltfConv * 0.40)
    : biasS[htfBias] * htfConv;

  const coreyScore = biasS[coreyBias] * coreyConf;

  let tsAdj = 0, trendSpiderEffect = 'Unavailable';
  if (tsAvail && tsFresh && (tsGrade === 'FreshHigh' || tsGrade === 'FreshMedium')) {
    const tsScore  = biasS[tsBias] * coreyResult.trendSpider.confidence;
    const agree    = tsBias === htfBias && tsBias === coreyBias;
    const conflict = tsBias !== 'Neutral' && (tsBias !== htfBias || tsBias !== coreyBias);
    if (agree)         { tsAdj = tsScore > 0 ? 0.08 : -0.08; trendSpiderEffect = 'Boosted'; }
    else if (conflict) { tsAdj = tsScore > 0 ? -0.06 : 0.06;  trendSpiderEffect = 'Reduced'; }
    else               { tsAdj = 0; trendSpiderEffect = 'Neutral'; }
  } else { trendSpiderEffect = tsAvail ? 'Ignored' : 'Unavailable'; }

  const composite = (spideyScore * 0.40) + (coreyScore * 0.30) + tsAdj;

  let finalBias, conviction, convictionLabel, doNotTrade = false, doNotTradeReason = null, conflictState;
  const spideyN = htfBias === 'Neutral', coreyN = coreyBias === 'Neutral', tsN = tsBias === 'Neutral' || !tsAvail || !tsFresh;
  const ltfAligned = ltfBias === htfBias || ltfBias === 'Neutral';
  const ltfConflict = mode === 'LH' && ltfBias !== 'Neutral' && ltfBias !== htfBias;

  const spideyAgreeCorey    = !spideyN && !coreyN && htfBias === coreyBias;
  const spideyConflictCorey = !spideyN && !coreyN && htfBias !== coreyBias;
  const tsConflictSpidey    = !tsN && tsBias !== htfBias;
  const tsConflictCorey     = !tsN && tsBias !== coreyBias;

  if      (htfBias === 'Bullish' && coreyBias === 'Bullish' && (!tsAvail || !tsFresh || tsBias === 'Bullish')) { finalBias = 'Bullish'; conviction = Math.min(composite + 0.1, 1); conflictState = 'Aligned'; }
  else if (htfBias === 'Bearish' && coreyBias === 'Bearish' && (!tsAvail || !tsFresh || tsBias === 'Bearish')) { finalBias = 'Bearish'; conviction = Math.min(Math.abs(composite) + 0.1, 1); conflictState = 'Aligned'; }
  else if (spideyAgreeCorey && tsN)  { finalBias = htfBias; conviction = Math.abs(composite); conflictState = 'Aligned'; }
  else if (spideyAgreeCorey && tsConflictSpidey && tsGrade === 'FreshLow')  { finalBias = htfBias; conviction = Math.abs(composite) * 0.85; conflictState = 'PartialConflict'; }
  else if (spideyAgreeCorey && tsConflictSpidey && tsGrade === 'FreshHigh') {
    if (htfConv > 0.65 && coreyConf > 0.55) { finalBias = htfBias; conviction = Math.abs(composite) * 0.70; conflictState = 'PartialConflict'; }
    else { finalBias = 'Neutral'; conviction = 0.2; conflictState = 'HardConflict'; doNotTrade = true; doNotTradeReason = `${htfBias} structure + macro, but strong TrendSpider ${tsBias} conflict.`; }
  }
  else if (spideyConflictCorey && !tsN && tsBias === htfBias) { finalBias = htfBias; conviction = Math.abs(composite) * 0.60; conflictState = 'PartialConflict'; if (htfConv < 0.55) { doNotTrade = true; doNotTradeReason = `Structure (${htfBias}) vs macro (${coreyBias}) conflict. Insufficient conviction.`; } }
  else if (spideyConflictCorey && !tsN && tsBias === coreyBias)  { finalBias = 'Neutral'; conviction = 0.2; conflictState = 'HardConflict'; doNotTrade = true; doNotTradeReason = `Structure (${htfBias}) and macro+TS (${coreyBias}) in direct conflict.`; }
  else if (spideyN && !coreyN && !tsN && coreyBias === tsBias)   { finalBias = coreyBias; conviction = Math.abs(composite) * 0.55; conflictState = 'PartialConflict'; if (conviction < 0.35) { doNotTrade = true; doNotTradeReason = 'Structure neutral. Macro+TS aligned but insufficient structural confirmation.'; } }
  else if (!spideyN && coreyN && !tsN && tsBias === htfBias)  { finalBias = htfBias; conviction = Math.abs(composite) * 0.65; conflictState = 'PartialConflict'; }
  else { finalBias = 'Neutral'; conviction = 0; conflictState = 'HardConflict'; doNotTrade = true; doNotTradeReason = 'Evidence fragmented across all three engines. No clean bias — wait for alignment.'; }

  if (ltfConflict && !doNotTrade) {
    conviction *= 0.80;
    conflictState = conflictState === 'Aligned' ? 'PartialConflict' : conflictState;
  }

  if (conviction < 0.25 && !doNotTrade) { doNotTrade = true; doNotTradeReason = `Conviction ${(conviction * 100).toFixed(0)}% — below minimum threshold.`; }
  if (coreyResult.correlation?.divergent?.length > 0 && !doNotTrade) {
    conviction *= 0.80;
    if (conviction < 0.30) { doNotTrade = true; doNotTradeReason = `${doNotTradeReason || ''} Correlation divergence: ${coreyResult.correlation.divergent[0].pair} misaligned.`.trim(); }
  }

  conviction      = Math.round(Math.min(conviction, 1) * 100) / 100;
  convictionLabel = conviction >= 0.65 ? 'High' : conviction >= 0.40 ? 'Medium' : conviction >= 0.20 ? 'Low' : 'Abstain';
  if (doNotTrade) convictionLabel = conviction < 0.10 ? 'Abstain' : convictionLabel;

  const levels   = buildJaneLevels(spideyHTF, spideyLTF, coreyResult, finalBias, mode);
  const branches = buildJaneBranches(spideyHTF, finalBias, levels);
  const primary  = buildPrimaryScenario(finalBias, spideyHTF, coreyResult, levels, mode);
  const alt      = buildAlternativeScenario(finalBias, spideyHTF, levels);
  const summary  = buildJaneSummaryFull(symbol, finalBias, convictionLabel, conviction, doNotTrade, doNotTradeReason, levels, trendSpiderEffect, conflictState);

  log('INFO', `[JANE] ${symbol} → ${finalBias} | ${convictionLabel} | conflict:${conflictState} | TS:${trendSpiderEffect} | DNT:${doNotTrade}`);
  return {
    finalBias, conviction, convictionLabel,
    compositeScore: Math.round(composite * 100) / 100,
    doNotTrade, doNotTradeReason,
    trendSpiderEffect, conflictState,
    ltfAligned, ltfConflict,
    entryZone:          levels.entryZone,
    invalidationLevel:  levels.invalidationLevel,
    targets:            levels.targets,
    rrRatio:            levels.rrRatio,
    branches, primaryScenario: primary, alternativeScenario: alt, summary,
  };
}

function fmt(n, dp = 5) { return n != null ? Number(n).toFixed(dp) : 'N/A'; }

function buildJaneLevels(spideyHTF, spideyLTF, coreyResult, bias, mode) {
  const htfTFs = Object.entries(spideyHTF.timeframes);
  const htfData = htfTFs[0]?.[1] || null;
  const ltfData = spideyLTF ? Object.entries(spideyLTF.timeframes)[0]?.[1] || null : null;

  const cp  = htfData?.currentPrice || ltfData?.currentPrice || 0;
  const pip = cp > 10 ? 0.01 : cp > 1 ? 0.0001 : 0.01;

  let entryZone = null, invalidationLevel = null, targets = [];

  if (bias !== 'Neutral') {
    if (bias === 'Bullish') {
      const dz = (ltfData?.activeDemand) || (htfData?.activeDemand);
      if (dz) { entryZone = { high: dz.high, low: dz.low }; invalidationLevel = dz.low - pip * 10; }
      else if (htfData?.swingLows?.length) { const sl = htfData.swingLows[htfData.swingLows.length - 1]; entryZone = { high: sl.level + pip * 5, low: sl.level - pip * 5 }; invalidationLevel = sl.level - pip * 15; }
      const htfPools = (htfData?.liquidityPools || []).filter((p) => p.level > cp);
      const htfImbs  = (htfData?.imbalances    || []).filter((im) => im.type === 'Bearish' && im.low > cp);
      const ltfPools = (ltfData?.liquidityPools || []).filter((p) => p.level > cp);
      targets = [...htfPools.map((p) => ({ level: p.level, label: `${p.type} HTF liquidity` })),
                 ...ltfPools.map((p) => ({ level: p.level, label: `${p.type} LTF liquidity` })),
                 ...htfImbs.map((im) => ({ level: im.high, label: 'HTF imbalance' }))]
        .sort((a, b) => a.level - b.level).slice(0, 3).map((t, i) => ({ ...t, label: `T${i+1} — ${t.label}` }));
    } else {
      const sz = (ltfData?.activeSupply) || (htfData?.activeSupply);
      if (sz) { entryZone = { high: sz.high, low: sz.low }; invalidationLevel = sz.high + pip * 10; }
      else if (htfData?.swingHighs?.length) { const sh = htfData.swingHighs[htfData.swingHighs.length - 1]; entryZone = { high: sh.level + pip * 5, low: sh.level - pip * 5 }; invalidationLevel = sh.level + pip * 15; }
      const htfPools = (htfData?.liquidityPools || []).filter((p) => p.level < cp);
      const htfImbs  = (htfData?.imbalances    || []).filter((im) => im.type === 'Bullish' && im.high < cp);
      const ltfPools = (ltfData?.liquidityPools || []).filter((p) => p.level < cp);
      targets = [...htfPools.map((p) => ({ level: p.level, label: `${p.type} HTF liquidity` })),
                 ...ltfPools.map((p) => ({ level: p.level, label: `${p.type} LTF liquidity` })),
                 ...htfImbs.map((im) => ({ level: im.low, label: 'HTF imbalance' }))]
        .sort((a, b) => b.level - a.level).slice(0, 3).map((t, i) => ({ ...t, label: `T${i+1} — ${t.label}` }));
    }
  }

  let rrRatio = null;
  if (entryZone && invalidationLevel && targets.length > 0) {
    const mid = (entryZone.high + entryZone.low) / 2, sd = Math.abs(mid - invalidationLevel), td = Math.abs(targets[0].level - mid);
    rrRatio = sd > 0 ? Math.round((td / sd) * 10) / 10 : null;
  }
  return { entryZone, invalidationLevel, targets, rrRatio, currentPrice: cp };
}

function buildJaneBranches(spideyHTF, bias, levels) {
  const branches = [], sig = spideyHTF.significantBreak;
  if (bias === 'Bullish') {
    if (levels.targets[0])        branches.push(`IF close above ${levels.targets[0].level?.toFixed(5)} → bias confirmed, scale T2`);
    if (levels.invalidationLevel) branches.push(`IF close below ${levels.invalidationLevel?.toFixed(5)} → thesis invalidated, reassess`);
    if (sig?.breakLevel)          branches.push(`IF return to ${sig.breakLevel?.toFixed(5)} BOS → high probability demand reaction`);
  } else if (bias === 'Bearish') {
    if (levels.targets[0])        branches.push(`IF close below ${levels.targets[0].level?.toFixed(5)} → bias confirmed, scale T2`);
    if (levels.invalidationLevel) branches.push(`IF close above ${levels.invalidationLevel?.toFixed(5)} → thesis invalidated, reassess`);
    if (sig?.breakLevel)          branches.push(`IF return to ${sig.breakLevel?.toFixed(5)} BOS → high probability supply reaction`);
  } else {
    branches.push('No active branches — engines conflicted or neutral. Wait for structural resolution before entry.');
  }
  return branches;
}

function buildPrimaryScenario(bias, spideyHTF, coreyResult, levels, mode) {
  if (bias === 'Neutral') return 'No primary scenario. Conflicting or neutral signals across engines.';
  const br = spideyHTF.significantBreak;
  const modeStr = mode === 'LH' ? ' HTF context confirmed. LTF execution structure feeding entry refinement.' : '';
  return `${bias} continuation.${modeStr} Structure confirmed ${br?.lastBreak || 'structurally'} on ${br ? tfLabel(br.timeframe) : 'HTF'}. Macro ${coreyResult.combinedBias} aligned.${levels.entryZone ? ` Entry: ${levels.entryZone.low?.toFixed(5)}–${levels.entryZone.high?.toFixed(5)}.` : ''}${levels.rrRatio ? ` R:R ~${levels.rrRatio}:1.` : ''}`;
}

function buildAlternativeScenario(bias, spideyHTF, levels) {
  const opp = bias === 'Bullish' ? 'Bearish' : bias === 'Bearish' ? 'Bullish' : 'directional';
  return `${opp} scenario if price closes ${bias === 'Bullish' ? 'below' : 'above'} invalidation ${levels.invalidationLevel?.toFixed(5) || 'N/A'}. Indicates structural breakdown — reassess all timeframes.`;
}

function buildJaneSummaryFull(symbol, bias, convLabel, conviction, dnt, dntReason, levels, tsEffect, conflictState) {
  if (dnt) return `⛔ DO NOT TRADE — ${dntReason}`;
  const rr = levels.rrRatio ? ` R:R ~${levels.rrRatio}:1` : '';
  return `${bias} — ${convLabel} conviction (${(conviction * 100).toFixed(0)}%)${rr}. TS: ${tsEffect}. Conflict: ${conflictState}. Entry: ${levels.entryZone ? `${levels.entryZone.low?.toFixed(5)}–${levels.entryZone.high?.toFixed(5)}` : 'TBC'}. Inv: ${levels.invalidationLevel?.toFixed(5) || 'TBC'}.`;
}

// ============================================================
// CHART ENGINE v4.0 — DETERMINISTIC INSTITUTIONAL RENDERER
// ============================================================

const CHART_W = 1920;
const CHART_H = 1080;
const ABORT_THRESHOLD = 0.25;
const MIN_CANVAS_AREA = 150000;
const MIN_BUFFER_BYTES = 5000;

let browserInstance = null;

async function getBrowser() {
  if (browserInstance) {
    try { await browserInstance.version(); return browserInstance; } catch { browserInstance = null; }
  }
  log('INFO', '[BROWSER] Launching Chromium');
  browserInstance = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  return browserInstance;
}

function buildPanelUrl(symbol, interval) {
  const tvSym = encodeURIComponent(getTVSymbol(symbol));
  const iv    = encodeURIComponent(interval);
  return `https://www.tradingview.com/chart/?symbol=${tvSym}&interval=${iv}&theme=dark&style=1&hide_top_toolbar=1&hide_side_toolbar=1&hide_legend=1&save_image=false&backgroundColor=%23000000&upColor=%2326a69a&downColor=%23ef5350&borderUpColor=%2326a69a&borderDownColor=%23ef5350&wickUpColor=%2326a69a&wickDownColor=%23ef5350`;
}

async function closePopups(page) {
  for (const sel of ['button[aria-label="Close"]', 'button:has-text("Accept")', 'button:has-text("Got it")']) {
    try { const btn = page.locator(sel).first(); if (await btn.isVisible({ timeout: 500 })) await btn.click(); } catch {}
  }
}

async function cleanUI(page) {
  await page.evaluate(() => {
    [
      '[data-name="header-toolbar"]', '[data-name="right-toolbar"]', '[data-name="left-toolbar"]',
      '.layout__area--right', '.layout__area--left', '.layout__area--top',
      '.tv-side-toolbar', '.tv-control-bar', '.tv-floating-toolbar',
      '.chart-controls-bar', '.header-chart-panel', '[data-name="legend"]',
      '.chart-toolbar', '.topbar', '.top-bar', '.tv-watermark', '#overlap-manager-root',
    ].forEach((sel) => document.querySelectorAll(sel).forEach((el) => el.remove()));
  }).catch(() => {});
}

async function makePlaceholderPanel(symbol, tfKey, reason) {
  const label  = `${symbol} ${tfKey}`;
  const reason2 = (reason || 'RENDER FAILED').slice(0, 60);
  const svg = Buffer.from(`<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${CHART_W}" height="${CHART_H}" fill="#0d0d0d"/>
    <text x="${CHART_W/2}" y="${CHART_H/2 - 30}" font-family="monospace" font-size="48" fill="#444" text-anchor="middle">${label}</text>
    <text x="${CHART_W/2}" y="${CHART_H/2 + 30}" font-family="monospace" font-size="28" fill="#333" text-anchor="middle">${reason2}</text>
    <text x="${CHART_W/2}" y="${CHART_H/2 + 80}" font-family="monospace" font-size="22" fill="#222" text-anchor="middle">PLACEHOLDER — DATA UNAVAILABLE</text>
  </svg>`);
  return await sharp(svg).resize(CHART_W, CHART_H).jpeg({ quality: 60 }).toBuffer();
}

async function capturePanel(symbol, tf, tfKey) {
  const browser = await getBrowser();
  const url     = buildPanelUrl(symbol, tf);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let page;
    try {
      log('INFO', `[PANEL START] ${symbol} ${tfKey} attempt ${attempt}`);
      page = await browser.newPage();
      await page.setViewportSize({ width: CHART_W, height: CHART_H });
      if (TV_COOKIES) await page.context().addCookies(TV_COOKIES);
      page.setDefaultNavigationTimeout(RENDER_TIMEOUT_MS);
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);
      await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch {} });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (/symbol.{0,30}(doesn't|does not|not found|invalid)/i.test(bodyText)) {
        throw new Error(`Symbol not found: ${symbol}`);
      }
      await page.waitForSelector('canvas', { timeout: 15000 });
      await page.waitForFunction((threshold) => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        if (!canvases.length) return false;
        const largest = canvases.reduce((best, c) => (c.width * c.height > best.width * best.height ? c : best), canvases[0]);
        return largest.width * largest.height >= threshold;
      }, MIN_CANVAS_AREA, { timeout: 20000 });
      await page.waitForFunction(() => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        if (!canvases.length) return false;
        const largest = canvases.reduce((best, c) => (c.width * c.height > best.width * best.height ? c : best), canvases[0]);
        try {
          const ctx  = largest.getContext('2d');
          if (!ctx) return false;
          const w = largest.width, h = largest.height;
          const data = ctx.getImageData(w * 0.1, h * 0.3, w * 0.8, h * 0.4);
          let nonBlack = 0;
          for (let i = 0; i < data.data.length; i += 16) {
            const r = data.data[i], g = data.data[i+1], b = data.data[i+2];
            if (r > 20 || g > 20 || b > 20) nonBlack++;
          }
          return nonBlack > 50;
        } catch { return false; }
      }, { timeout: 15000 });
      await page.evaluate(() => {
        document.querySelectorAll('.loading, .spinner, [class*="loading"], [class*="spinner"]').forEach(el => el.remove());
      }).catch(() => {});
      await page.waitForTimeout(2500);
      await closePopups(page);
      await cleanUI(page);
      await page.evaluate((w, h) => {
        document.querySelectorAll(
          '.chart-container, .layout__area--center, [class*="chart-markup-table"], .pane-html'
        ).forEach(el => {
          el.style.width  = w + 'px';
          el.style.height = h + 'px';
        });
        window.dispatchEvent(new Event('resize'));
      }, CHART_W, CHART_H).catch(() => {});
      await page.waitForTimeout(1500);
      const buffer = await page.screenshot({
        type: 'png', fullPage: false,
        clip: { x: 0, y: 0, width: CHART_W, height: CHART_H },
      });
      await page.close().catch(() => {});
      if (!buffer || buffer.length < 80000) {
        throw new Error(`Weak/blank render — buffer ${buffer?.length || 0}B (minimum 80KB required)`);
      }
      log('INFO', `[OK] ${symbol} ${tfKey} ${(buffer.length / 1024).toFixed(0)}KB`);
      return buffer;
    } catch (err) {
      log('ERROR', `[FAIL] ${symbol} ${tfKey}: ${err.message}`);
      if (page) { try { await page.close(); } catch {} }
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function buildGrid(panels) {
  const resized = await Promise.all(
    panels.map((img) => sharp(img)
      .resize(CHART_W, CHART_H, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer()
    )
  );
  return await sharp({
    create: {
      width:    CHART_W * 2,
      height:   CHART_H * 2,
      channels: 4,
      background: { r: 10, g: 10, b: 10, alpha: 1 },
    },
  })
    .composite([
      { input: resized[0], left: 0,       top: 0       },
      { input: resized[1], left: CHART_W, top: 0       },
      { input: resized[2], left: 0,       top: CHART_H },
      { input: resized[3], left: CHART_W, top: CHART_H },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function renderAll(symbol, intervals) {
  const targets = intervals.slice(0, 4);
  let failCount = 0;
  const panels = [];
  for (const iv of targets) {
    const key = tfLabel(iv);
    let buf;
    try {
      buf = await capturePanel(symbol, iv, key);
    } catch (err) {
      failCount++;
      log('WARN', `[RENDER SKIP] ${symbol} ${key}: ${err.message} — placeholder used`);
      log('INFO', `[PLACEHOLDER] ${symbol} ${key}`);
      buf = await makePlaceholderPanel(symbol, key, err.message);
    }
    panels.push(buf);
  }
  while (panels.length < 4) {
    failCount++;
    panels.push(await makePlaceholderPanel(symbol, 'N/A', 'missing'));
  }
  const failRatio = failCount / targets.length;
  if (failRatio > ABORT_THRESHOLD) {
    log('ERROR', `[ABORT] ${symbol} — fail ratio ${(failRatio * 100).toFixed(0)}% exceeds 25% threshold`);
    throw new Error(`[ABORT] ${symbol} render integrity failed — ${failCount}/${targets.length} panels failed`);
  }
  const grid = await buildGrid(panels.slice(0, 4));
  if (!grid || grid.length < MIN_BUFFER_BYTES) {
    throw new Error(`[ABORT] ${symbol} grid buffer invalid — ${grid?.length || 0}B`);
  }
  const partial = failCount > 0;
  if (partial) log('WARN', `[GRID] ${symbol} — ${failCount} placeholder(s) used (PARTIAL)`);
  else log('INFO', `[GRID] ${symbol} — all panels OK`);
  return { grid, placeholderCount: failCount, partial };
}

// ============================================================
// runFullPipeline — MAIN ORCHESTRATOR
// ============================================================

async function runFullPipeline(symbol, mode, htfIntervals, ltfIntervals, combined, customTFs) {
  log('INFO', `[PIPELINE] ${symbol} mode:${mode} combined:${combined} htf:[${htfIntervals.join(',')}] ltf:[${ltfIntervals.join(',')}]`);

  const [coreyResult, spideyHTF] = await Promise.all([
    runCorey(symbol),
    runSpideyHTF(symbol, htfIntervals),
  ]);

  const [spideyLTF, spideyMicro] = await Promise.all([
    combined ? runSpideyLTF(symbol, ltfIntervals) : Promise.resolve(null),
    runSpideyMicro(symbol, spideyHTF.dominantBias),
  ]);

  const jane = runJane(symbol, spideyHTF, spideyLTF, coreyResult, mode);

  let htfGridBuf, ltfGridBuf, htfPlaceholders = 0, ltfPlaceholders = 0;
  if (combined) {
    const htfResult = await renderAll(symbol, htfIntervals);
    htfGridBuf      = htfResult.grid;
    htfPlaceholders = htfResult.placeholderCount;
    const ltfResult = await renderAll(symbol, ltfIntervals);
    ltfGridBuf      = ltfResult.grid;
    ltfPlaceholders = ltfResult.placeholderCount;
  } else {
    const result    = await renderAll(symbol, mode === 'H' ? htfIntervals : ltfIntervals);
    htfGridBuf      = result.grid;
    ltfGridBuf      = null;
    htfPlaceholders = result.placeholderCount;
  }

  const htfDisplay = htfIntervals.map(tfLabel).join(' · ');
  const ltfDisplay = ltfIntervals.map(tfLabel).join(' · ');
  const modeLabel  = combined ? 'HTF + LTF' : (mode === 'H' ? 'HTF' : 'LTF');
  const ts         = Date.now();
  const htfGridName = `ATLAS_${symbol}_HTF_${ts}.jpg`;
  const ltfGridName = `ATLAS_${symbol}_LTF_${ts}.jpg`;

  log('INFO', `[PIPELINE] ${symbol} complete — bias:${jane.finalBias} conviction:${jane.convictionLabel}`);

  const outcome = (htfPlaceholders + ltfPlaceholders) > 0 ? OUTCOME.PARTIAL : OUTCOME.SUCCESS;
  log('INFO', `[PIPELINE] ${symbol} outcome:${outcome} htfPlaceholders:${htfPlaceholders} ltfPlaceholders:${ltfPlaceholders}`);

  return {
    symbol, mode, combined, modeLabel,
    htfIntervals, ltfIntervals, htfDisplay, ltfDisplay,
    spideyHTF, spideyLTF, spideyMicro, coreyResult, jane,
    htfGridBuf, ltfGridBuf, htfGridName, ltfGridName,
    htfPlaceholders, ltfPlaceholders, outcome,
    customTFs,
  };
}

// ============================================================
// DISCORD OUTPUT FORMATTER — INSTITUTIONAL MACRO BRIEF
// ============================================================

function getBiasEmoji(bias) {
  if (bias === 'Bullish') return '🟢';
  if (bias === 'Bearish') return '🔴';
  return '⚪';
}

function getConvictionBar(conviction) {
  if (!conviction || conviction <= 0) return '`──────────`  0%';
  const filled = Math.round(conviction * 10);
  const pct    = (conviction * 100).toFixed(0);
  return '`' + '█'.repeat(filled) + '─'.repeat(10 - filled) + '`' + `  ${pct}%`;
}

function formatAssetContext(symbol, macro) {
  const ac = macro.assetClass;
  if (ac === ASSET_CLASS.EQUITY || SEMI_SYMBOLS.has(symbol)) {
    return [
      `📈 **Asset Class:** ${ac} — ${macro.sector?.sector || 'Equity'}`,
      `💵 **Pricing Currency:** ${macro.quote?.currency || 'USD'} | ${macro.quote?.cb?.name || 'Federal Reserve'}`,
      `🏦 **CB Stance:** ${macro.quote?.cb?.stance || 'N/A'} · Cycle: ${macro.quote?.cb?.rateCycle || 'N/A'}`,
      `💪 **Economic Strength:** ${(macro.quote?.econ?.composite * 100 || 50).toFixed(0)}% composite score`,
      `⚡ **Risk Environment:** ${macro.global?.riskEnv} · **DXY Bias:** ${macro.global?.dxyBias}`,
      `📊 **Market Regime:** ${macro.regime?.regime} · **Volatility:** ${macro.volatility?.level}`,
      `💧 **Liquidity:** ${macro.liquidity?.state}`,
    ].join('\n');
  }
  if (ac === ASSET_CLASS.FX) {
    return [
      `🌐 **Asset Class:** FX Pair`,
      `🏦 **${macro.base?.currency} — ${macro.base?.cb?.name}:** ${macro.base?.cb?.stance} · ${macro.base?.cb?.direction} · Cycle: ${macro.base?.cb?.rateCycle}`,
      `   Econ Strength: ${(macro.base?.econ?.composite * 100 || 50).toFixed(0)}% · GDP: ${(macro.base?.econ?.gdpMomentum * 100 || 50).toFixed(0)}% · Employment: ${(macro.base?.econ?.employment * 100 || 50).toFixed(0)}%`,
      `🏦 **${macro.quote?.currency} — ${macro.quote?.cb?.name}:** ${macro.quote?.cb?.stance} · ${macro.quote?.cb?.direction} · Cycle: ${macro.quote?.cb?.rateCycle}`,
      `   Econ Strength: ${(macro.quote?.econ?.composite * 100 || 50).toFixed(0)}% · GDP: ${(macro.quote?.econ?.gdpMomentum * 100 || 50).toFixed(0)}% · Employment: ${(macro.quote?.econ?.employment * 100 || 50).toFixed(0)}%`,
      `⚡ **Risk Environment:** ${macro.global?.riskEnv} · **DXY Bias:** ${macro.global?.dxyBias}`,
      `📊 **Market Regime:** ${macro.regime?.regime} · **Volatility:** ${macro.volatility?.level}`,
      `💧 **Liquidity:** ${macro.liquidity?.state}`,
    ].join('\n');
  }
  if (ac === ASSET_CLASS.COMMODITY) {
    return [
      `🛢️ **Asset Class:** ${ac} — ${macro.sector?.sector || 'Commodity'}`,
      `💵 **Priced in USD** | Federal Reserve: ${macro.quote?.cb?.stance} · ${macro.quote?.cb?.rateCycle}`,
      `⚡ **Risk Environment:** ${macro.global?.riskEnv} · **DXY Bias:** ${macro.global?.dxyBias}`,
      `📊 **Market Regime:** ${macro.regime?.regime} · **Volatility:** ${macro.volatility?.level}`,
      `💧 **Liquidity:** ${macro.liquidity?.state}`,
    ].join('\n');
  }
  if (ac === ASSET_CLASS.INDEX) {
    return [
      `📊 **Asset Class:** ${ac} — ${macro.sector?.sector || 'Index'}`,
      `🏦 **Pricing CB:** ${macro.quote?.cb?.name || 'Federal Reserve'} | ${macro.quote?.cb?.stance} · ${macro.quote?.cb?.rateCycle}`,
      `⚡ **Risk Environment:** ${macro.global?.riskEnv} · **DXY Bias:** ${macro.global?.dxyBias}`,
      `📊 **Market Regime:** ${macro.regime?.regime} · **Volatility:** ${macro.volatility?.level}`,
      `💧 **Liquidity:** ${macro.liquidity?.state}`,
    ].join('\n');
  }
  return `⚡ **Risk Environment:** ${macro.global?.riskEnv} · **DXY Bias:** ${macro.global?.dxyBias}\n📊 **Regime:** ${macro.regime?.regime} · **Vol:** ${macro.volatility?.level}`;
}

function formatHTFStructureBlock(spideyHTF, symbol) {
  const { timeframes, dominantBias, dominantConviction, significantBreak, nearestDraw } = spideyHTF;
  const biasEmoji = getBiasEmoji(dominantBias);
  const lines = [`${biasEmoji} **Dominant HTF Bias: ${dominantBias}** · Conviction: ${getConvictionBar(dominantConviction)}`,''];

  for (const [iv, r] of Object.entries(timeframes)) {
    const bEmoji = getBiasEmoji(r.bias);
    const brStr  = r.lastBreak !== 'None'
      ? ` | ${r.lastBreak}${r.isEngineered ? ' ⚠️' : ''} @ ${fmt(r.breakLevel)}`
      : '';
    lines.push(`  ${bEmoji} **${tfLabel(iv)}:** ${r.bias} · ${r.structure} (${(r.conviction * 100).toFixed(0)}%)${brStr}`);
    if (r.activeSupply) lines.push(`      ↑ Supply Zone: ${fmt(r.activeSupply.low)} – ${fmt(r.activeSupply.high)}`);
    if (r.activeDemand) lines.push(`      ↓ Demand Zone: ${fmt(r.activeDemand.low)} – ${fmt(r.activeDemand.high)}`);
    const proxLiq = (r.liquidityPools || []).filter((p) => p.proximate);
    if (proxLiq.length) lines.push(`      💧 Proximate Liquidity: ${proxLiq.map((p) => `${p.type} @ ${fmt(p.level)}`).join(' | ')}`);
    const openImbs = (r.imbalances || []).slice(0, 2);
    if (openImbs.length) lines.push(`      ⚡ Open Imbalances: ${openImbs.map((im) => `${im.type} ${fmt(im.low)}–${fmt(im.high)}`).join(' | ')}`);
  }

  lines.push('');
  if (significantBreak && significantBreak.lastBreak !== 'None') {
    lines.push(`🔔 **Significant Break:** ${significantBreak.lastBreak}${significantBreak.isEngineered ? ' ⚠️ Engineered' : ''} on **${tfLabel(significantBreak.timeframe)}** @ ${fmt(significantBreak.breakLevel)}`);
    if (significantBreak.isEngineered) lines.push(`   ⚠️ *Engineered breaks indicate institutional liquidity sweeps — caution on immediate continuation entries*`);
  } else {
    lines.push(`🔔 **Structural Break:** No confirmed BOS or CHoCH — market in range or accumulation phase`);
  }
  if (nearestDraw) {
    lines.push(`🎯 **Draw on Liquidity:** ${nearestDraw.type} @ ${fmt(nearestDraw.level)} (strength: ${nearestDraw.strength} touches)`);
    lines.push(`   *Price is drawn toward liquidity like a magnet — this is the most likely near-term target*`);
  } else {
    lines.push(`🎯 **Draw on Liquidity:** No proximate draw — price may be seeking range extremes`);
  }
  return lines.join('\n');
}

function formatLTFStructureBlock(spideyLTF, spideyMicro) {
  if (!spideyLTF) {
    const microEmoji = spideyMicro.entryConfirmed ? '✅' : spideyMicro.inInducement ? '⚠️' : spideyMicro.sweepDetected ? '🔄' : '⏳';
    return [
      `${microEmoji} **Micro Execution (15M/5M):** ${spideyMicro.summary}`,
      `   LTF Bias: ${spideyMicro.ltfBias} · Break: ${spideyMicro.ltfBreak} · HTF Aligned: ${spideyMicro.alignedWithHTF ? 'Yes ✅' : 'No ❌'}`,
      spideyMicro.sweepDetected ? `   🔄 *Sweep detected — institutional liquidity grab. High probability reversal zone if BOS follows*` : '',
      spideyMicro.inInducement  ? `   ⚠️ *Inducement zone — retail stop clusters likely above/below. Wait for sweep before entry*` : '',
    ].filter(Boolean).join('\n');
  }

  const { timeframes, dominantBias, dominantConviction, significantBreak, nearestDraw } = spideyLTF;
  const biasEmoji = getBiasEmoji(dominantBias);
  const lines = [`${biasEmoji} **Dominant LTF Bias: ${dominantBias}** · Conviction: ${getConvictionBar(dominantConviction)}`,''];

  for (const [iv, r] of Object.entries(timeframes)) {
    const bEmoji = getBiasEmoji(r.bias);
    const brStr  = r.lastBreak !== 'None'
      ? ` | ${r.lastBreak}${r.isEngineered ? ' ⚠️' : ''} @ ${fmt(r.breakLevel)}`
      : '';
    lines.push(`  ${bEmoji} **${tfLabel(iv)}:** ${r.bias} · ${r.structure} (${(r.conviction * 100).toFixed(0)}%)${brStr}`);
    if (r.activeDemand) lines.push(`      ↓ Demand Zone: ${fmt(r.activeDemand.low)} – ${fmt(r.activeDemand.high)}`);
    if (r.activeSupply) lines.push(`      ↑ Supply Zone: ${fmt(r.activeSupply.low)} – ${fmt(r.activeSupply.high)}`);
  }

  lines.push('');
  if (significantBreak && significantBreak.lastBreak !== 'None') {
    lines.push(`🔔 **LTF Break:** ${significantBreak.lastBreak}${significantBreak.isEngineered ? ' ⚠️' : ''} on **${tfLabel(significantBreak.timeframe)}** @ ${fmt(significantBreak.breakLevel)}`);
  }

  const microEmoji = spideyMicro.entryConfirmed ? '✅' : spideyMicro.inInducement ? '⚠️' : spideyMicro.sweepDetected ? '🔄' : '⏳';
  lines.push('');
  lines.push(`**⚡ Micro Execution (15M/5M):**`);
  lines.push(`${microEmoji} ${spideyMicro.summary}`);
  lines.push(`   LTF Bias: ${spideyMicro.ltfBias} · Break: ${spideyMicro.ltfBreak} · HTF Aligned: ${spideyMicro.alignedWithHTF ? 'Yes ✅' : 'No ❌'}`);
  if (spideyMicro.sweepDetected) lines.push(`   🔄 *Liquidity sweep on micro — watch for immediate BOS confirmation before entry*`);
  if (spideyMicro.inInducement)  lines.push(`   ⚠️ *Inducement active — do not chase. Let price sweep and reverse*`);

  return lines.join('\n');
}

function formatCoreyBlock(coreyResult, symbol) {
  const macro = coreyResult.internalMacro;
  const lines = [];
  lines.push(formatAssetContext(symbol, macro));
  lines.push('');
  const macBiasEmoji = getBiasEmoji(coreyResult.macroBias);
  const combBiasEmoji = getBiasEmoji(coreyResult.combinedBias);
  lines.push(`${macBiasEmoji} **Internal Macro Bias:** ${coreyResult.macroBias}`);
  lines.push(`${combBiasEmoji} **Combined Bias (with TS):** ${coreyResult.combinedBias} · Confidence: ${getConvictionBar(coreyResult.confidence)}`);
  if (coreyResult.alignment)     lines.push(`✅ *TrendSpider signal aligns with macro bias — confidence reinforced*`);
  if (coreyResult.contradiction) lines.push(`❌ *TrendSpider conflicts with macro direction — apply caution*`);
  if (coreyResult.escalation === 'Warning') lines.push(`⚠️ *Strong TS signal contradicting macro — escalation warning active*`);
  if (coreyResult.correlation) {
    const corr = coreyResult.correlation;
    if (corr.divergent?.length > 0) {
      lines.push('');
      lines.push(`⚠️ **Correlation Divergence Detected:**`);
      for (const d of corr.divergent) lines.push(`   ${d.pair}: expected ${d.expected}, showing ${d.actual} — *${d.significance}*`);
    } else if (corr.positive?.length > 0) {
      const aligned = corr.positive.filter((p) => p.bias === coreyResult.macroBias);
      if (aligned.length) lines.push(`\n✅ **Correlated Pairs Aligned:** ${aligned.map((p) => p.pair).join(', ')}`);
    }
  }
  if (macro.reasoning?.length > 0) {
    lines.push('');
    lines.push(`📝 **Macro Engine Notes:**`);
    for (const note of macro.reasoning) lines.push(`   • ${note}`);
  }
  return lines.join('\n');
}

function formatTSBlock(coreyResult, jane) {
  const ts = coreyResult.trendSpider;
  if (!TS_ENABLED) return `Status: Disabled`;
  if (!ts.available) return `Status: No signal received\nJane Effect: Not applied`;
  const lines = [];
  lines.push(`Status: **${ts.status}** · Grade: **${ts.grade}**`);
  if (ts.fresh) {
    lines.push(`Signal: **${ts.signalBias}** ${ts.signalType}`);
    if (ts.pattern)  lines.push(`Pattern: ${ts.pattern}`);
    if (ts.strategy) lines.push(`Strategy: ${ts.strategy}`);
    if (ts.scanner)  lines.push(`Scanner: ${ts.scanner}`);
    lines.push(`Strength: ${(ts.strength * 100).toFixed(0)}% · Confidence: ${(ts.confidence * 100).toFixed(0)}%`);
    lines.push(`Freshness: ${ts.grade} · Age: ${ts.ageMs ? `${Math.round(ts.ageMs / 60000)}m ago` : 'N/A'}`);
    lines.push(`Macro Alignment: ${coreyResult.alignment ? '✅ Confirmed' : coreyResult.contradiction ? '❌ Conflict' : '⚪ Neutral'}`);
    lines.push(`Jane Effect: **${jane.trendSpiderEffect}**`);
  } else {
    lines.push(`Signal: ${ts.signalBias} (${ts.grade} — not applied to analysis)`);
  }
  return lines.join('\n');
}

function formatJaneBlock(jane, symbol, mode) {
  const lines = [];
  if (jane.doNotTrade) {
    lines.push(`⛔ **FINAL DECISION: DO NOT TRADE**`);
    lines.push('');
    lines.push(`**Reason:** ${jane.doNotTradeReason}`);
    lines.push(`**Conflict State:** ${jane.conflictState}`);
    lines.push(`**Composite Score:** ${jane.compositeScore}`);
    lines.push('');
    lines.push(`**What this means:** The three intelligence engines are not in sufficient agreement to justify a position. This is not a failure — it is the system working correctly. Forcing a trade into a conflicted environment is how accounts are damaged. Stand aside and wait for structural resolution.`);
    return lines.join('\n');
  }
  const biasEmoji = getBiasEmoji(jane.finalBias);
  lines.push(`${biasEmoji} **Final Bias: ${jane.finalBias}**`);
  lines.push(`📊 **Conviction: ${jane.convictionLabel}** · ${getConvictionBar(jane.conviction)}`);
  lines.push(`⚖️ **Conflict State:** ${jane.conflictState} · **TS Effect:** ${jane.trendSpiderEffect}`);
  lines.push(`🔢 **Composite Score:** ${jane.compositeScore}`);
  if (mode === 'LH') {
    lines.push(`🔗 **HTF/LTF Alignment:** ${jane.ltfConflict ? '⚠️ LTF conflicts with HTF — reduced conviction applied' : jane.ltfAligned ? '✅ LTF aligned with HTF bias' : '⚪ LTF neutral'}`);
  }
  lines.push('');
  lines.push(`**📍 Price Framework:**`);
  if (jane.entryZone) {
    lines.push(`  🎯 **Entry Zone:** ${fmt(jane.entryZone.low)} – ${fmt(jane.entryZone.high)}`);
    lines.push(`     *${jane.finalBias === 'Bullish' ? 'This is the optimal zone to look for bullish confirmation before committing. Wait for price to reach this area, then watch for LTF BOS or CHoCH before entry.' : 'This is the distribution or reversal zone. Do not short into open air — wait for this zone to be tagged with rejection evidence before committing a position.'}`);
  }
  if (jane.invalidationLevel) {
    lines.push(`  🛑 **Stop Loss:** ${fmt(jane.invalidationLevel)}`);
    lines.push(`     *A close beyond this level structurally invalidates the thesis. Do not hold through invalidation — the market is telling you the read was wrong.*`);
  }
  if (jane.rrRatio) {
    lines.push(`  📐 **Risk:Reward Ratio:** ~${jane.rrRatio}:1 ${jane.rrRatio >= 3 ? '✅ Meets ATLAS minimum (1:3)' : '⚠️ Below ATLAS minimum 1:3 threshold — evaluate carefully'}`);
  }
  if (jane.targets.length > 0) {
    lines.push('');
    lines.push(`**🎯 Target Cascade:**`);
    for (const t of jane.targets) lines.push(`  ${t.label}: **${fmt(t.level)}**`);
    lines.push(`  *Partial profits should be taken at each target. Do not hold full size to final target without structural confirmation.*`);
  }
  lines.push('');
  lines.push(`**📖 Scenario Map:**`);
  lines.push(`  ▸ **Primary:** ${jane.primaryScenario}`);
  lines.push(`  ▸ **Alternative:** ${jane.alternativeScenario}`);
  if (jane.branches.length > 0) {
    lines.push('');
    lines.push(`**🌿 IF/THEN Decision Branches:**`);
    for (const b of jane.branches) lines.push(`  ▸ ${b}`);
  }
  return lines.join('\n');
}

// ============================================================
// ATLAS EXECUTION PANEL — LOCKED OUTPUT LAYER
// ============================================================
// Wording, icons, and row labels are FIXED per build spec.
// No deviation permitted. SYSTEM_STATE gates execution output.
// ============================================================

// ── SYSTEM STATE HEADER — appears on EVERY output ────────────
function formatSystemStateHeader() {
  if (isBuildMode()) {
    return [
      `**SYSTEM STATE:**`,
      `⚠️ BUILD MODE`,
      ``,
      `**TRADING PERMISSION:**`,
      `❌ DISABLED (BUILD MODE)`,
      ``,
      `**RULE: IF NOT FULLY OPERATIONAL → DO NOT TRADE**`,
    ].join('\n');
  }
  return [
    `**SYSTEM STATE:**`,
    `✅ FULLY OPERATIONAL`,
    ``,
    `**TRADING PERMISSION:**`,
    `🟢 ENABLED (FULLY OPERATIONAL ONLY)`,
    ``,
    `**RULE: IF NOT FULLY OPERATIONAL → DO NOT TRADE**`,
  ].join('\n');
}

// ── RENDER INTEGRITY GATE ─────────────────────────────────────
// Returns null if integrity passes, or an abort message string if blocked.
// Called in deliverResult before any output is produced.
function checkRenderIntegrity(htfPlaceholders, ltfPlaceholders, combined) {
  const totalPanels    = combined ? 8 : 4;
  const failedPanels   = htfPlaceholders + ltfPlaceholders;
  const successPanels  = totalPanels - failedPanels;
  // Require exactly 4 successful renders per grid (combined = 2 grids of 4)
  // A placeholder count > 0 means at least one panel failed
  // Any failure in a 4-panel grid = integrity fail
  const htfIntact = htfPlaceholders === 0;
  const ltfIntact = !combined || ltfPlaceholders === 0;
  if (!htfIntact || !ltfIntact) {
    log('ERROR', `[RENDER INTEGRITY] FAILED — htfFail:${htfPlaceholders} ltfFail:${ltfPlaceholders}`);
    return `❌ ANALYSIS BLOCKED — INSUFFICIENT CHART DATA (4/4 REQUIRED)`;
  }
  return null; // integrity passed
}

// ── PRICE FORMATTER — instrument-aware decimal places ─────────
function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return 'N/A';
  if (n > 100)  return Number(n).toFixed(2);
  if (n > 1)    return Number(n).toFixed(4);
  return Number(n).toFixed(5);
}

// ── TREND ROW LOGIC ───────────────────────────────────────────
// Returns exactly one of two locked strings.
function resolveTrendRow(symbol, jane, currentPrice) {
  if (!jane.entryZone || !currentPrice || jane.doNotTrade) return '🟠 TREND | ⚪ WAIT — NOTHING HAPPENING';
  const ez  = jane.entryZone;
  const mid = (ez.low + ez.high) / 2;
  // MOVING TOWARD = price is converging on the entry zone
  // MOVING AWAY   = price is diverging from the entry zone
  const movingToward = jane.finalBias === 'Bullish'
    ? currentPrice < mid   // price below entry, approaching from below
    : currentPrice > mid;  // price above entry, approaching from above
  return movingToward
    ? `🟠 TREND | ⬆ MOVING TOWARD`
    : `🟠 TREND | ⬇ MOVING AWAY`;
}

// ── ENTER NOW LOGIC ───────────────────────────────────────────
// ENTER NOW is appended to ENTRY ZONE only when:
//   1. System is FULLY_OPERATIONAL
//   2. Jane has a non-neutral, non-doNotTrade bias
//   3. Current price is inside the entry zone
//   4. Stop loss is defined (gate: missing SL = block)
function resolveEntryRow(symbol, jane, currentPrice) {
  if (!jane.entryZone) return `🟢 ENTRY ZONE | N/A`;
  const { dp } = getPipSize(symbol);
  const ezLow  = jane.entryZone.low.toFixed(dp);
  const ezHigh = jane.entryZone.high.toFixed(dp);
  const range  = `${ezLow} – ${ezHigh}`;

  // Gate: BUILD MODE never shows ENTER NOW
  if (isBuildMode()) return `🟢 ENTRY ZONE | ${range}`;

  // Gate: no valid bias
  if (jane.doNotTrade || jane.finalBias === 'Neutral') return `🟢 ENTRY ZONE | ${range}`;

  // Gate: missing stop loss
  if (!jane.invalidationLevel) return `🟢 ENTRY ZONE | ${range}`;

  // Gate: price must be inside zone
  if (!currentPrice) return `🟢 ENTRY ZONE | ${range}`;
  const inZone = currentPrice >= jane.entryZone.low && currentPrice <= jane.entryZone.high;
  if (!inZone) return `🟢 ENTRY ZONE | ${range}`;

  return `🟢 ENTRY ZONE | ${range} (ENTER NOW)`;
}

// ── MAIN EXECUTION PANEL FORMATTER ───────────────────────────
function formatAtlasExecutionPanel(result) {
  const { symbol, spideyHTF, spideyLTF, jane } = result;
  const cp     = spideyHTF.currentPrice;
  const { dp } = getPipSize(symbol);

  const lines = [];

  // ── SYSTEM STATE HEADER (mandatory, every output) ──────────
  lines.push(formatSystemStateHeader());
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('**ATLAS EXECUTION PANEL**');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  // ── DO NOT TRADE gate — no execution table shown ───────────
  if (jane.doNotTrade || jane.finalBias === 'Neutral') {
    lines.push(`⚪ WAIT | NOTHING HAPPENING`);
    lines.push('');
    lines.push(`*Engines conflicted or neutral — no execution output produced.*`);
    return lines.join('\n');
  }

  // ── BUILD MODE gate — panel shown but flagged ──────────────
  if (isBuildMode()) {
    lines.push(`⚠️ *Execution panel shown in BUILD MODE — for testing only. ENTER NOW logic disabled.*`);
    lines.push('');
  }

  // ── STOP LOSS GATE — block if missing ─────────────────────
  if (!jane.invalidationLevel) {
    lines.push(`❌ EXECUTION BLOCKED — STOP LOSS LEVEL UNDEFINED`);
    lines.push(`*Every trade must have a stop loss. Refusing to output execution table.*`);
    return lines.join('\n');
  }

  // ── ENTRY ZONE row ─────────────────────────────────────────
  lines.push(resolveEntryRow(symbol, jane, cp));

  // ── TREND row ──────────────────────────────────────────────
  lines.push(resolveTrendRow(symbol, jane, cp));

  // ── WAIT row (always present) ──────────────────────────────
  lines.push(`⚪ WAIT | NOTHING HAPPENING`);

  // ── EXIT ZONE row ──────────────────────────────────────────
  if (jane.targets && jane.targets.length > 0) {
    const t1 = jane.targets[0];
    lines.push(`🔴 EXIT ZONE | ${Number(t1.level).toFixed(dp)} (TAKE PROFIT)`);
  } else {
    lines.push(`🔴 EXIT ZONE | N/A`);
  }

  // ── STOP LOSS row ──────────────────────────────────────────
  lines.push(`🛑 STOP LOSS SET | ${Number(jane.invalidationLevel).toFixed(dp)} (IF REACHED → EXIT TRADE)`);

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── MASTER RULE footer ─────────────────────────────────────
  lines.push(`*If it does not say ENTER NOW, the user waits.*`);

  return lines.join('\n');
}

// ── HELPER: extract key HTF structural levels ─────────────────
function extractKeyLevels(spideyHTF) {
  const tfs     = Object.values(spideyHTF.timeframes);
  const cp      = spideyHTF.currentPrice;
  let nearSupply = null, nearDemand = null, nearLiq = null;
  for (const tf of tfs) {
    if (!nearDemand && tf.activeDemand) nearDemand = tf.activeDemand;
    if (!nearSupply && tf.activeSupply) nearSupply = tf.activeSupply;
    if (!nearLiq && tf.liquidityPools?.length) {
      nearLiq = tf.liquidityPools.find(p => p.proximate) || tf.liquidityPools[0];
    }
  }
  const recentSH = tfs.flatMap(tf => tf.swingHighs || []).sort((a,b) => b.level - a.level)[0];
  const recentSL = tfs.flatMap(tf => tf.swingLows  || []).sort((a,b) => a.level - b.level)[0];
  return { cp, nearSupply, nearDemand, nearLiq, recentSH, recentSL };
}

// ── POSITION STATE RESOLVER ───────────────────────────────────
function resolveAtlasPositionState(jane, levels) {
  if (jane.doNotTrade || jane.finalBias === 'Neutral') return { state: '⚪️ DORMANT', label: 'Dormant' };
  const cp = levels.currentPrice;
  if (!cp || !levels.entryZone) return { state: '⚪️ DORMANT', label: 'Dormant' };
  const ez = levels.entryZone;
  const inZone      = cp >= ez.low && cp <= ez.high;
  const approaching = jane.finalBias === 'Bullish'
    ? (cp < ez.low  && cp > ez.low  * 0.995)
    : (cp > ez.high && cp < ez.high * 1.005);
  const diverging = jane.finalBias === 'Bullish' ? cp > ez.high * 1.005 : cp < ez.low * 0.995;
  if (inZone)      return { state: '🟢 ENTRY',         label: 'Entry' };
  if (approaching) return { state: '🟠⬆️ APPROACHING', label: 'Approaching' };
  if (diverging)   return { state: '🟠⬇️ DIVERGING',   label: 'Diverging' };
  return               { state: '🟠⬆️ APPROACHING',    label: 'Approaching' };
}

// ============================================================
// TRADE BLOCK + ANALYSIS BLOCK FORMATTERS
// ============================================================

function formatTradeBlock(result) {
  const { symbol, mode, combined, modeLabel, spideyHTF, spideyLTF, spideyMicro, coreyResult, jane, htfDisplay, ltfDisplay } = result;
  const macro   = coreyResult.internalMacro;
  const cp      = spideyHTF.currentPrice;
  const feed    = getFeedName(symbol);
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-AU', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Australia/Perth' });
  const timeStr = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Perth', timeZoneName: 'short' });
  const posState = resolveAtlasPositionState(jane, { currentPrice: cp, entryZone: jane.entryZone });
  const levels   = extractKeyLevels(spideyHTF);
  const W = '═'.repeat(32);
  const lines = [];

  // ── HEADER ──────────────────────────────────────────────────
  lines.push(`╔${W}╗`);
  lines.push(`  ⚡ **ATLAS FX — ${symbol}** · ${feed}`);
  lines.push(`  📅 ${dateStr} · ⏰ ${timeStr}`);
  lines.push(`  ${modeLabel}${combined ? ` · HTF: ${htfDisplay} · LTF: ${ltfDisplay}` : ` · ${htfDisplay}`}`);
  lines.push(`╚${W}╝`);
  lines.push('');

  // ── POSITION STATE ──────────────────────────────────────────
  lines.push(`**ATLAS POSITION STATE: ${posState.state}**`);
  if (cp) lines.push(`💰 **Current Price:** ${fmtPrice(cp)}`);
  lines.push('');

  // ── BIAS & CONVICTION ───────────────────────────────────────
  const biasEmoji = getBiasEmoji(jane.finalBias);
  lines.push(`${biasEmoji} **Bias: ${jane.finalBias}** · Conviction: **${jane.convictionLabel}** · ${getConvictionBar(jane.conviction)}`);
  lines.push('');

  if (jane.doNotTrade) {
    lines.push(`⛔ **DO NOT TRADE — ${jane.doNotTradeReason || 'Evidence fragmented across engines'}**`);
    lines.push('');
    lines.push(`🟢 **Entry Zone:**`);
    if (levels.nearDemand) {
      lines.push(`   Bullish opportunity would form at demand zone: **${fmtPrice(levels.nearDemand.low)} – ${fmtPrice(levels.nearDemand.high)}**`);
    } else if (levels.recentSL) {
      lines.push(`   Potential bullish zone near structural low: **${fmtPrice(levels.recentSL.level)}**`);
    } else {
      lines.push(`   No valid demand zone identified at current depth — requires structural BOS first`);
    }
    if (levels.nearSupply) {
      lines.push(`   Bearish opportunity would form at supply zone: **${fmtPrice(levels.nearSupply.low)} – ${fmtPrice(levels.nearSupply.high)}**`);
    }
    lines.push('');
    lines.push(`🛑 **Set Stop Loss:**`);
    lines.push(`   To be defined upon setup formation — placed beyond the activation zone once BOS is confirmed`);
    lines.push('');
    lines.push(`🎯 **Targets:**`);
    if (levels.nearLiq) {
      lines.push(`   T1: ${fmtPrice(levels.nearLiq.level)} — proximate liquidity draw (${levels.nearLiq.type})`);
    } else if (levels.recentSH) {
      lines.push(`   T1: ${fmtPrice(levels.recentSH.level)} — prior swing high (sell-side liquidity)`);
    } else {
      lines.push(`   T1: To be defined on next analysis run once bias resolves`);
    }
    lines.push(`   T2: Beyond T1 — next structural draw on liquidity`);
    lines.push(`   T3: Major HTF level — scale exit as structure confirms`);
    lines.push('');
    lines.push(`🔴 **Exit:**`);
    lines.push(`   N/A — no active position. Exit protocol activates on setup formation.`);
    lines.push('');
    lines.push(`📊 **Risk Profile:**`);
    lines.push(`   Minimum ATLAS standard 1:3 R:R required before entry is justified. Confirm upon setup activation.`);
    lines.push('');
    lines.push(`⏳ **Timing Expectation:**`);
    if (levels.nearDemand && cp) {
      const dist = Math.abs(cp - levels.nearDemand.high);
      const distPct = ((dist / cp) * 100).toFixed(1);
      lines.push(`   Not yet — probability improves if price reaches **${fmtPrice(levels.nearDemand.low)} – ${fmtPrice(levels.nearDemand.high)}** (${distPct}% from current price)`);
    } else {
      lines.push(`   Not yet — wait for structural BOS on the dominant HTF to establish a clean bias`);
    }
    lines.push('');
    lines.push(`📍 **Current Positioning:**`);
    if (cp && levels.nearDemand && levels.nearSupply) {
      lines.push(`   Price ${fmtPrice(cp)} is between demand (${fmtPrice(levels.nearDemand.high)}) and supply (${fmtPrice(levels.nearSupply.low)}) — in a compression/ranging zone`);
    } else if (cp) {
      lines.push(`   Price ${fmtPrice(cp)} — no confirmed directional structure at current depth`);
    }
    lines.push('');
    lines.push(`🧭 **What We're Waiting For:**`);
    lines.push(`• Clean BOS on the ${spideyHTF.dominantBias === 'Neutral' ? 'Weekly or Daily' : 'dominant'} timeframe establishing unambiguous direction`);
    lines.push(`• Price reaching a defined supply or demand zone listed above`);
    lines.push(`• LTF CHoCH + BOS sequence confirming institutional entry intent`);
    lines.push(`• All three engines (Spidey · Corey · Jane) aligned in the same direction`);
    lines.push('');
    lines.push(`⚠️ **Activation Condition:**`);
    lines.push(`   Candle **close** through the most recent swing structure (BOS) on the 4H or Daily — not a wick. Wicks are liquidity grabs. Closes are structural shifts.`);
    lines.push('');
    lines.push(`🚫 **Invalidation:**`);
    if (levels.recentSL && levels.recentSH) {
      lines.push(`   Bullish thesis invalidated by close below **${fmtPrice(levels.recentSL.level)}**`);
      lines.push(`   Bearish thesis invalidated by close above **${fmtPrice(levels.recentSH.level)}**`);
    } else {
      lines.push(`   Any trade thesis invalidated by close through the confirmation BOS level in the opposite direction`);
    }
    lines.push('');
    lines.push(`🔁 **Alternate Scenario:**`);
    lines.push(`   If price sweeps the ${levels.recentSL ? `structural low at ${fmtPrice(levels.recentSL.level)}` : 'nearest equal lows'} and immediately reverses with a LTF BOS — this is a high-probability bullish reversal context. Reassess immediately if this occurs.`);
  } else {
    if (jane.entryZone) {
      lines.push(`🟢 **Entry Zone:**`);
      lines.push(`   **${fmtPrice(jane.entryZone.low)} – ${fmtPrice(jane.entryZone.high)}**`);
      const posLabel = posState.label;
      lines.push(`   *${posLabel === 'Entry' ? 'Price is inside the zone — confirmation trigger required before committing capital' : posLabel === 'Approaching' ? 'Price is approaching — prepare confirmation sequence now' : 'Price has diverged from zone — do not chase, wait for structural retrace'}*`);
      lines.push('');
    } else {
      lines.push(`🟢 **Entry Zone:** To be confirmed on next structural development`);
      lines.push('');
    }
    if (jane.invalidationLevel) {
      lines.push(`🛑 **Set Stop Loss:**`);
      lines.push(`   **${fmtPrice(jane.invalidationLevel)}**`);
      lines.push(`   *Beyond structural invalidation — a candle close through this level cancels the entire thesis*`);
      lines.push('');
    }
    if (jane.targets && jane.targets.length > 0) {
      lines.push(`🎯 **Targets:**`);
      for (const t of jane.targets) lines.push(`   ${t.label}: **${fmtPrice(t.level)}**`);
      lines.push(`   *Scale out at each level — never hold full size to T3 without structural confirmation at T1 and T2*`);
      lines.push('');
    } else {
      lines.push(`🎯 **Targets:** Defined by next liquidity draw — monitor structure`);
      lines.push('');
    }
    lines.push(`🔴 **Exit:**`);
    lines.push(jane.targets?.length
      ? `   Staged: T1 partial → T2 partial → T3 full close. Emergency exit on close through stop loss.`
      : `   Close on structural reversal signal or invalidation breach. Manage dynamically.`);
    lines.push('');
    lines.push(`📊 **Risk Profile:**`);
    if (jane.rrRatio) {
      lines.push(`   R:R ~**${jane.rrRatio}:1** ${jane.rrRatio >= 3 ? '✅ Meets ATLAS minimum 1:3' : '⚠️ Below ATLAS 1:3 minimum — reduce size or pass'}`);
    } else {
      lines.push(`   R:R pending entry confirmation — verify before sizing`);
    }
    lines.push('');
    lines.push(`⏳ **Timing Expectation:**`);
    if (posState.label === 'Entry') {
      lines.push(`   **Immediate** — price is in zone. Confirmation trigger required NOW before committing.`);
    } else if (posState.label === 'Approaching') {
      lines.push(`   Not yet active — higher probability when price reaches **${jane.entryZone ? fmtPrice(jane.entryZone.low) : 'entry zone'}**`);
    } else {
      lines.push(`   Diverging — setup not valid at current price ${fmtPrice(cp)}. Reassess on structural retrace to zone.`);
    }
    lines.push('');
    lines.push(`📍 **Current Positioning:**`);
    if (cp && jane.entryZone) {
      const mid = (jane.entryZone.low + jane.entryZone.high) / 2;
      const distPct = Math.abs((cp - mid) / cp * 100).toFixed(2);
      const rel = cp < jane.entryZone.low ? 'below' : cp > jane.entryZone.high ? 'above' : 'inside';
      lines.push(`   Price **${fmtPrice(cp)}** is ${distPct}% ${rel} the entry zone`);
    } else {
      lines.push(`   Price **${fmtPrice(cp)}** — entry zone pending structural confirmation`);
    }
    lines.push('');
    lines.push(`🧭 **What We're Waiting For:**`);
    if (jane.finalBias === 'Bullish') {
      lines.push(`• Price retraces into demand zone **${jane.entryZone ? fmtPrice(jane.entryZone.low) + ' – ' + fmtPrice(jane.entryZone.high) : 'TBC'}** without a close below`);
      lines.push(`• LTF CHoCH — local downswing fails to make a new low (shift of character)`);
      lines.push(`• LTF BOS to the upside — confirms institutional buying intent`);
    } else {
      lines.push(`• Price retraces into supply zone **${jane.entryZone ? fmtPrice(jane.entryZone.low) + ' – ' + fmtPrice(jane.entryZone.high) : 'TBC'}** without a close above`);
      lines.push(`• LTF CHoCH — local upswing fails to make a new high (shift of character)`);
      lines.push(`• LTF BOS to the downside — confirms institutional selling intent`);
    }
    lines.push('');
    lines.push(`⚠️ **Activation Condition:**`);
    lines.push(`   Candle **close** through the LTF BOS level in the direction of bias — not a wick. Wicks are liquidity grabs, not structural confirmation.`);
    lines.push('');
    lines.push(`🚫 **Invalidation:**`);
    lines.push(`   Close **${jane.finalBias === 'Bullish' ? 'below' : 'above'} ${fmtPrice(jane.invalidationLevel)}** — thesis cancelled entirely. Exit without hesitation. No re-entry until full structural reset.`);
    lines.push('');
    lines.push(`🔁 **Alternate Scenario:**`);
    lines.push(`   ${jane.alternativeScenario || (jane.finalBias === 'Bullish'
      ? `Bearish path activates on close below ${fmtPrice(jane.invalidationLevel)} — do not counter-trade without full reassessment`
      : `Bullish path activates on close above ${fmtPrice(jane.invalidationLevel)} — do not counter-trade without full reassessment`)}`);
  }

  // ── ATLAS EXECUTION PANEL (appended after trade block) ──────
  lines.push('');
  lines.push(formatAtlasExecutionPanel(result));

  return lines.join('\n');
}

function formatAnalysisBlock(result) {
  const { symbol, mode, combined, modeLabel, spideyHTF, spideyLTF, spideyMicro, coreyResult, jane, htfDisplay, ltfDisplay } = result;
  const macro  = coreyResult.internalMacro;
  const global = macro.global;
  const regime = macro.regime;
  const vol    = macro.volatility;
  const liq    = macro.liquidity;
  const ac     = macro.assetClass;
  const cp     = spideyHTF.currentPrice;
  const levels = extractKeyLevels(spideyHTF);
  const Wt     = '─'.repeat(32);
  const sections = [];

  sections.push(`📋 **ATLAS INSTITUTIONAL ANALYSIS — ${symbol}**\n${modeLabel} · ${getFeedName(symbol)} · ${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Perth', timeZoneName: 'short' })}`);

  const riskLabel  = global.riskEnv === 'RiskOn' ? '🟢 Risk-On' : global.riskEnv === 'RiskOff' ? '🔴 Risk-Off' : '⚪️ Risk-Neutral';
  const regimeDesc = regime?.regime || 'Transition';
  const volDesc    = vol?.level     || 'Moderate';
  const liqDesc    = liq?.state     || 'Neutral';

  const regimeExplain = {
    Expansion:   'broad liquidity expansion — risk assets favoured, capital rotating into growth and equities, USD typically softening',
    Crisis:      'acute risk aversion — capital fleeing to safety (USD, JPY, CHF, Treasuries), risk assets under severe institutional selling pressure',
    Growth:      'constructive but selective — institutional money deploying into quality growth names, data and earnings are the dominant catalysts',
    Contraction: 'deteriorating macro — defensive rotation underway, credit conditions tightening, institutional risk appetite withdrawing',
    Transition:  'regime ambiguity — markets absorbing conflicting macro signals, no dominant directional force, compression typical before expansion',
    Neutral:     'balanced environment — no extraordinary macro pressure in either direction',
  }[regimeDesc] || 'undefined regime';

  const volExplain = volDesc === 'High'
    ? 'elevated uncertainty is compressing institutional positioning — wider bid/ask spreads expected, reduce position sizing accordingly, avoid overleveraged entries'
    : volDesc === 'Low'
    ? 'compressed volatility typically precedes expansion — the market is coiling. Watch for a catalyst that breaks the range with conviction'
    : 'balanced volatility — standard position sizing appropriate, no extraordinary risk adjustments required';

  const liqExplain = liqDesc === 'Tight'
    ? 'credit and funding conditions are restrictive — institutional capital is cautious, flows are reduced, spreads are wider'
    : liqDesc === 'Loose'
    ? 'abundant liquidity is supporting risk assets and carry trades — institutional money has room to deploy'
    : 'neutral liquidity environment — no extraordinary funding conditions present';

  sections.push([
    `**① SYSTEM STATE**`,
    Wt,
    `**Risk Environment:** ${riskLabel}`,
    `**WHY:** ${regimeDesc} regime — ${regimeExplain}`,
    ``,
    `**Volatility:** ${volDesc} — ${volExplain}`,
    `**Liquidity:** ${liqDesc} — ${liqExplain}`,
    `**DXY Posture:** ${global.dxyBias} — ${global.dxyBias === 'Bullish'
      ? 'USD strength creates headwinds for risk assets, commodities, and non-USD denominated instruments. Capital is flowing INTO the dollar, which structurally pressures anything priced against it.'
      : global.dxyBias === 'Bearish'
      ? 'USD weakness is a tailwind for risk assets, commodities, and emerging market flows. Capital is moving OUT of the dollar, which structurally supports anything priced against it.'
      : 'USD is in consolidation — no dominant directional pressure. Range-bound DXY typically means FX pairs and risk assets find their own individual catalysts.'}`,
  ].join('\n'));

  let driver = '', driverHow = '';
  if (ac === 'Equity' || ac === 'Semiconductors' || ac === 'Unknown') {
    driver = 'Risk Sentiment + Sector Capital Flows';
    driverHow = global.riskEnv === 'RiskOn'
      ? `Institutional money is actively rotating INTO growth and technology equities. Fund managers are increasing equity allocation, with growth sectors receiving disproportionate inflows relative to defensives. This creates systematic buying pressure that shows up first on the daily and weekly charts as higher highs — the very structure Spidey is reading.`
      : `Institutional money is actively rotating OUT of growth equities. Risk-off conditions drive fund managers to reduce equity exposure, increase cash and bond positioning, and hedge existing longs. This creates systematic selling pressure across the equity complex regardless of individual name fundamentals.`;
    if (ac === 'Semiconductors') {
      driverHow += ` For ${symbol} specifically, the semiconductor cycle adds a second layer: AI infrastructure capital expenditure cycles, memory demand cycles (DRAM/NAND pricing), and geopolitical supply chain risk (Taiwan, export controls) can all override or amplify the broader equity sentiment signal.`;
    }
  } else if (ac === 'FX') {
    driver = 'Central Bank Policy Divergence + Economic Differential';
    driverHow = `The ${macro.base?.currency}/${macro.quote?.currency} rate is primarily driven by the policy divergence between ${macro.base?.cb?.name || macro.base?.currency} (${macro.base?.cb?.stance}, ${macro.base?.cb?.rateCycle}) and ${macro.quote?.cb?.name || macro.quote?.currency} (${macro.quote?.cb?.stance}, ${macro.quote?.cb?.rateCycle}). International capital systematically flows toward the higher-yielding, more hawkish currency — this is carry mechanics operating at the institutional scale. The economic strength differential (${macro.base?.currency}: ${((macro.base?.econ?.composite || 0.5) * 100).toFixed(0)}% vs ${macro.quote?.currency}: ${((macro.quote?.econ?.composite || 0.5) * 100).toFixed(0)}%) reinforces or counteracts this flow depending on relative momentum.`;
  } else if (ac === 'Commodity') {
    driver = 'USD Direction + Risk Appetite + Commodity-Specific Supply/Demand';
    driverHow = `Commodities have a mechanical inverse relationship with USD over the medium term — a stronger USD makes commodities more expensive for non-USD buyers, reducing global demand. With DXY ${global.dxyBias}, this creates a ${global.dxyBias === 'Bullish' ? 'structural headwind' : 'structural tailwind'} for ${symbol}. Simultaneously, the ${global.riskEnv} environment ${global.riskEnv === 'RiskOff' ? 'supports safe-haven commodity flows (gold, silver) but pressures industrial demand commodities (oil, base metals)' : 'supports industrial demand but may reduce safe-haven premium for precious metals'}.`;
  } else if (ac === 'Index') {
    driver = 'Risk Appetite + Monetary Conditions + Earnings Cycle';
    driverHow = `Index movements aggregate the combined institutional sentiment across all constituent equities. In ${global.riskEnv} conditions, fund flows are ${global.riskEnv === 'RiskOn' ? 'into equities — index upside is structurally supported. Internal breadth and momentum are the confirmation signals to watch' : 'away from equities — index downside risk is elevated even if individual components show resilience'}. DXY ${global.dxyBias} ${global.dxyBias === 'Bullish' ? 'can dampen foreign institutional inflows into USD-denominated indices, reducing upside momentum' : 'tends to attract foreign capital into USD-denominated indices, amplifying domestic buying'}.`;
  } else {
    driver = 'Macro Risk Environment';
    driverHow = `The prevailing ${global.riskEnv} macro environment combined with ${global.dxyBias} USD posture is the dominant force shaping price behavior.`;
  }
  sections.push([`**② PRIMARY DRIVER**`, Wt, `**Driver:** ${driver}`, ``, `**HOW it influences ${symbol}:**`, driverHow].join('\n'));

  let transmission = '';
  if (ac === 'Equity' || ac === 'Semiconductors') {
    transmission = `The transmission chain runs:\n\n**Macro regime** (${regimeDesc}) → **institutional fund allocation** (risk ${global.riskEnv === 'RiskOn' ? 'appetite expanding' : 'appetite contracting'}) → **sector rotation decisions** (${global.riskEnv === 'RiskOn' ? 'growth overweight, defensives underweight' : 'defensives overweight, growth underweight'}) → **equity order flow** → **price structure**\n\nThe critical insight: price on the chart reflects institutional ORDER FLOW decisions made at the macro level. The weekly and daily candles Spidey is reading are the footprint of those allocation decisions. Lower timeframe price action is the distribution or accumulation that occurs WITHIN those larger moves — institutions don't buy all at once, they build positions over multiple sessions, which creates the zones and imbalances visible on the HTF chart.`;
  } else if (ac === 'FX') {
    transmission = `The transmission chain runs:\n\n**Central bank policy divergence** → **interest rate differential** → **carry trade flows** (institutions borrow low-yielding currency, buy high-yielding) → **net capital flows into higher-yielding currency** → **spot price direction**\n\nOver the short term (LTF), speculative positioning and technical levels dominate. Over the medium term (HTF), the interest rate differential and economic strength differential are the gravitational forces that determine the dominant trend direction. Short-term LTF moves against the trend are retracements within this larger macro current — they create the entry opportunities Spidey identifies.`;
  } else if (ac === 'Commodity') {
    transmission = `The transmission chain runs:\n\n**USD direction** (${global.dxyBias}) → **commodity denomination effect** (stronger USD = more expensive for non-USD buyers) → **demand adjustment** → **futures pricing** → **spot price**\n\nSimultaneously: **Risk sentiment** (${global.riskEnv}) → **industrial demand expectations** OR **safe-haven flows** → **futures positioning** → **spot price**\n\nThese two forces sometimes reinforce each other and sometimes conflict — which is what creates the complex behaviour visible during macro regime transitions. The key: when both USD and risk sentiment align in the same direction for ${symbol}, the move tends to have stronger follow-through.`;
  } else {
    transmission = `**Macro conditions** → **institutional fund flows** → **systematic order flow** → **structural moves on HTF chart** → **LTF distribution/accumulation**\n\nThe LTF provides the timing entry within the larger HTF move — not a separate thesis, but a precision layer within the dominant narrative.`;
  }
  sections.push([`**③ TRANSMISSION MECHANISM**`, Wt, transmission].join('\n'));

  const htfBias = spideyHTF.dominantBias;
  const htfConv = (spideyHTF.dominantConviction * 100).toFixed(0);
  const sig     = spideyHTF.significantBreak;

  const tfBreakdown = Object.entries(spideyHTF.timeframes)
    .map(([iv, r]) => {
      const bE = getBiasEmoji(r.bias);
      let line = `  ${bE} **${tfLabel(iv)}:** ${r.bias} · ${r.structure} (${(r.conviction*100).toFixed(0)}% conviction)`;
      if (r.lastBreak !== 'None') line += ` | ${r.lastBreak}${r.isEngineered ? ' ⚠️ engineered' : ''} @ ${fmtPrice(r.breakLevel)}`;
      if (r.activeSupply) line += `\n     ↑ Supply: ${fmtPrice(r.activeSupply.low)} – ${fmtPrice(r.activeSupply.high)}`;
      if (r.activeDemand) line += `\n     ↓ Demand: ${fmtPrice(r.activeDemand.low)} – ${fmtPrice(r.activeDemand.high)}`;
      return line;
    }).join('\n');

  let htfMeaning = `${getBiasEmoji(htfBias)} **Dominant HTF Bias: ${htfBias}** at **${htfConv}% conviction** across ${htfDisplay}\n\n${tfBreakdown}\n\n`;
  htfMeaning += `**WHY this structure exists under current macro conditions:**\n`;
  if (htfBias === 'Bullish') {
    htfMeaning += `The bullish HTF structure is consistent with a ${regimeDesc} macro environment. Institutional money has been buying dips and making higher highs — the classic footprint of accumulation. Each demand zone Spidey has identified marks a point where institutions stepped in aggressively enough to reverse price. These are not random reversals — they are areas where the order flow imbalance was heavily skewed to the buy side.`;
  } else if (htfBias === 'Bearish') {
    htfMeaning += `The bearish HTF structure is consistent with the current ${regimeDesc} macro environment. Institutional selling has been creating lower highs — the classic footprint of distribution. Each supply zone marks a point where institutions sold aggressively enough to reverse price. These are not random tops — they are areas where the order flow imbalance was heavily skewed to the sell side.`;
  } else {
    htfMeaning += `The neutral HTF structure reflects genuine macro ambiguity. Markets are absorbing conflicting signals and have not yet established a dominant directional narrative. This is a compression phase — price is coiling between supply and demand, building energy for a directional expansion once a catalyst resolves the ambiguity.`;
  }
  if (sig && sig.lastBreak !== 'None') {
    htfMeaning += `\n\n**Significant break:** ${sig.lastBreak}${sig.isEngineered ? ' (engineered)' : ''} on **${tfLabel(sig.timeframe)}** at **${fmtPrice(sig.breakLevel)}**\n`;
    htfMeaning += sig.isEngineered
      ? `The engineered nature of this break is important — it means price was pushed through a key level to collect retail stop orders BEFORE the genuine move began. Engineered breaks (wick through, close back above/below) are often the highest-probability entry contexts because they confirm institutional intent.`
      : `This genuine BOS confirms that the directional bias has structural backing — price has been accepted on the other side of a prior swing point, which shifts the market narrative.`;
  }
  if (spideyHTF.nearestDraw) {
    htfMeaning += `\n\n**Draw on Liquidity:** ${spideyHTF.nearestDraw.type} at **${fmtPrice(spideyHTF.nearestDraw.level)}** (${spideyHTF.nearestDraw.strength} touches)\nPrice gravitates toward liquidity like a magnet — this is the most probable near-term destination before any significant reversal. The more touches a level has, the more stop orders are clustered there, the more attractive it is to institutional order flow.`;
  }
  sections.push([`**④ HTF STRUCTURE MEANING**`, Wt, htfMeaning].join('\n'));

  let ltfSection = '';
  if (spideyLTF) {
    const ltfBias = spideyLTF.dominantBias;
    const ltfConv = (spideyLTF.dominantConviction * 100).toFixed(0);
    const ltfSig  = spideyLTF.significantBreak;
    const ltfBreakdown = Object.entries(spideyLTF.timeframes)
      .map(([iv, r]) => {
        const bE = getBiasEmoji(r.bias);
        let line = `  ${bE} **${tfLabel(iv)}:** ${r.bias} · ${r.structure} (${(r.conviction*100).toFixed(0)}%)`;
        if (r.lastBreak !== 'None') line += ` | ${r.lastBreak} @ ${fmtPrice(r.breakLevel)}`;
        if (r.activeDemand) line += `\n     ↓ Demand: ${fmtPrice(r.activeDemand.low)} – ${fmtPrice(r.activeDemand.high)}`;
        if (r.activeSupply) line += `\n     ↑ Supply: ${fmtPrice(r.activeSupply.low)} – ${fmtPrice(r.activeSupply.high)}`;
        return line;
      }).join('\n');
    ltfSection = `${getBiasEmoji(ltfBias)} **LTF Dominant Bias: ${ltfBias}** at **${ltfConv}% conviction** across ${ltfDisplay}\n\n${ltfBreakdown}\n\n`;
    if (ltfBias === htfBias) {
      ltfSection += `**HOW LTF interacts with HTF:** Full alignment — both timeframe sets are reading the same directional narrative. This is the highest-probability configuration ATLAS can produce. The HTF defines the dominant current; the LTF is showing continuation within that current rather than a counter-move. Entry timing is valid — the confirmation sequence (CHoCH + BOS) is the final gate.`;
    } else if (ltfBias === 'Neutral') {
      ltfSection += `**HOW LTF interacts with HTF:** LTF is currently in compression — price is consolidating at the lower timeframe level. This is a common pre-move condition. The market is absorbing the last of the counter-move before resuming the HTF trend. Watch for a LTF BOS in the direction of the ${htfBias} HTF bias as confirmation that the compression is complete.`;
    } else {
      ltfSection += `**HOW LTF interacts with HTF:** LTF is showing a counter-move against the HTF bias. This is a RETRACEMENT within the larger trend — not a reversal. The correct interpretation: the HTF ${htfBias} bias remains intact; the LTF ${ltfBias} move is pulling price back toward a demand/supply zone to create the entry opportunity. This is the system working as designed. Do not trade the LTF counter-move — wait for it to complete and the HTF trend to resume.`;
    }
    if (ltfSig && ltfSig.lastBreak !== 'None') {
      ltfSection += `\n\n**LTF structural event:** ${ltfSig.lastBreak}${ltfSig.isEngineered ? ' (engineered — high-probability reversal context)' : ''} on **${tfLabel(ltfSig.timeframe)}** at **${fmtPrice(ltfSig.breakLevel)}**`;
    }
  } else {
    const micro = spideyMicro;
    ltfSection = `**Micro Execution Layer (15M/5M):**\n\n`;
    ltfSection += micro.entryConfirmed
      ? `✅ **Entry conditions confirmed** — LTF ${micro.ltfBreak} is aligned with the HTF bias. The micro structure has completed the CHoCH → BOS sequence. Entry timing is valid subject to position sizing rules.`
      : micro.inInducement
      ? `⚠️ **Inducement zone active** — retail stop clusters sit above/below current price. HOW this works: institutions intentionally push price to sweep these stops before the genuine move begins. The stops that get hit become the liquidity that funds the institutional position in the other direction. Wait for the sweep to complete, then look for the immediate reversal BOS.`
      : micro.sweepDetected
      ? `🔄 **Liquidity sweep detected** on micro — HOW to interpret: a sweep without an immediate BOS is a warning, not a signal. A sweep FOLLOWED by a BOS is the highest-probability entry context in the entire ATLAS system. Watch the next 2-3 candles for a structural break in the direction of the HTF bias.`
      : `⏳ **No LTF confirmation yet** — ${micro.ltfBias} structure at the micro level, ${micro.alignedWithHTF ? 'aligned with HTF direction' : 'not yet aligned with HTF direction'}. The confirmation sequence (CHoCH → BOS) has not completed. Patience is the correct position.`;
  }
  sections.push([`**⑤ LTF EXECUTION BEHAVIOR**`, Wt, ltfSection].join('\n'));

  const allPools = Object.entries(spideyHTF.timeframes)
    .flatMap(([iv, r]) => (r.liquidityPools || []).map(p => ({ ...p, tf: tfLabel(iv) })));
  const allImbs  = Object.entries(spideyHTF.timeframes)
    .flatMap(([iv, r]) => (r.imbalances || []).map(im => ({ ...im, tf: tfLabel(iv) })));

  let liqSection = `Price is always drawn toward liquidity. Understanding WHERE the liquidity sits is what separates reactive trading from anticipatory trading.\n\n`;
  const eqH = allPools.filter(p => p.type === 'EQH').slice(0, 3);
  const eqL = allPools.filter(p => p.type === 'EQL').slice(0, 3);
  if (eqH.length) {
    liqSection += `**Buy-Side Liquidity (Equal Highs — above current price):**\n`;
    for (const p of eqH) liqSection += `  ${p.tf}: **${fmtPrice(p.level)}** — ${p.strength} touches${p.proximate ? ' ⚡ PROXIMATE' : ''}\n`;
    liqSection += `WHY this matters: every swing high above price has stop orders clustered just above it (retail longs stopped out, breakout buyers triggered). Institutions use these clusters as targets — they push price UP to collect this liquidity before potentially reversing.\n\n`;
  }
  if (eqL.length) {
    liqSection += `**Sell-Side Liquidity (Equal Lows — below current price):**\n`;
    for (const p of eqL) liqSection += `  ${p.tf}: **${fmtPrice(p.level)}** — ${p.strength} touches${p.proximate ? ' ⚡ PROXIMATE' : ''}\n`;
    liqSection += `WHY this matters: every swing low below price has stop orders clustered just below it (retail shorts stopped out, breakdown sellers triggered). Institutions use these clusters as accumulation targets — they push price DOWN to collect sell-side liquidity before potentially reversing upward.\n\n`;
  }
  const openImbs = allImbs.slice(0, 4);
  if (openImbs.length) {
    liqSection += `**Open Imbalances (Price Inefficiencies):**\n`;
    for (const im of openImbs) liqSection += `  ${im.tf} ${im.type}: **${fmtPrice(im.low)} – ${fmtPrice(im.high)}**\n`;
    liqSection += `WHY this matters: imbalances are price ranges where no two-sided auction occurred — one side overwhelmed the other so completely that the gap was never filled. Markets have a strong tendency to revisit and fill these inefficiencies. They act as magnets pulling price back, and as potential reversal zones when tagged.`;
  }
  if (!eqH.length && !eqL.length && !openImbs.length) {
    liqSection += `No significant liquidity clusters or open imbalances identified at current analysis depth. Price may be in an area of price discovery — directional move may need more structural development before a high-probability level emerges.`;
  }
  sections.push([`**⑥ LIQUIDITY & IMBALANCE FLOW**`, Wt, liqSection].join('\n'));

  const conflictState = jane.conflictState;
  const htfLtfAligned = !jane.ltfConflict;
  let alignSection = '';
  if (conflictState === 'Aligned') {
    alignSection = `✅ **Full system alignment** — all three ATLAS engines reading the same directional signal:\n\n🕷️ **Spidey (Structure):** ${spideyHTF.dominantBias} — structural bias confirmed\n🌍 **Corey (Macro):** ${coreyResult.combinedBias} — macro environment supports the thesis\n👑 **Jane (Synthesis):** ${jane.finalBias} — final arbitration confirmed at ${jane.convictionLabel} conviction\n\n**WHAT full alignment means operationally:** This is the cleanest signal ATLAS produces. All three independent evidence streams are pointing in the same direction. The probability of follow-through is highest in this configuration. This does not eliminate risk — but it means the weight of evidence is clearly on one side. Respect it, but still apply the confirmation rules.`;
  } else if (conflictState === 'PartialConflict') {
    alignSection = `⚠️ **Partial conflict** — mixed reads across the system:\n\n🕷️ **Spidey:** ${spideyHTF.dominantBias}\n🌍 **Corey:** ${coreyResult.combinedBias}\n🕸️ **TrendSpider:** ${coreyResult.trendSpider.signalBias} (${jane.trendSpiderEffect})\n👑 **Jane:** ${jane.finalBias} at reduced conviction\n\n**WHAT partial conflict means operationally:** The dominant signal is present but not universally confirmed. The correct response is NOT to avoid the trade entirely — it is to reduce position size (quarter to half normal) and heighten the confirmation requirement. Do not enter on the first indication. Wait for the full CHoCH + BOS sequence before committing.`;
  } else {
    alignSection = `❌ **Hard conflict** — engines are divided, no clean directional call possible:\n\n🕷️ **Spidey:** ${spideyHTF.dominantBias}\n🌍 **Corey:** ${coreyResult.combinedBias}\n👑 **Jane:** Cannot resolve — DO NOT TRADE\n\n**WHAT hard conflict means operationally:** Deploying capital when the evidence is split is not aggressive trading — it is undisciplined trading. The probability-adjusted expected value of a trade in this environment is negative when you account for the uncertainty discount. The correct action is complete capital preservation until the conflict resolves. The market will show its hand. Wait for it.`;
  }
  if (combined) {
    alignSection += `\n\n**HTF/LTF Relationship:** ${htfLtfAligned
      ? `✅ Lower timeframe is confirming the higher timeframe direction. The execution layer is aligned with the context layer — this is optimal. Entry timing is valid.`
      : `⚠️ Lower timeframe is moving counter to the higher timeframe. This is a retracement phase — the HTF bias remains intact. Do not trade the LTF counter-move. Wait for the LTF to exhaust and the HTF trend to resume.`}`;
  }
  sections.push([`**⑦ ALIGNMENT VS CONFLICT**`, Wt, alignSection].join('\n'));

  let decisionLogic = '';
  if (jane.doNotTrade) {
    decisionLogic = `**Correct action: STAND ASIDE**\n\nThis is not a cautious or conservative call — it is the analytically correct position given the current state of the evidence. The three ATLAS engines are not in sufficient agreement to justify capital deployment.\n\n**WHY standing aside is the right trade:**\nTrading into ambiguity is how accounts are damaged. Every time you force a trade without evidence alignment, you are accepting odds that are worse than the market offers. The ATLAS system is designed to identify when NOT to trade with the same rigor it applies to identifying when TO trade. A clear DO NOT TRADE output is not a system failure — it is the system doing exactly what it was built to do.\n\n**Probability improves when:** ${levels.nearDemand
      ? `Price reaches the identified demand zone at **${fmtPrice(levels.nearDemand.low)} – ${fmtPrice(levels.nearDemand.high)}** and produces a LTF structural reaction. At that point, re-run the analysis.`
      : levels.recentSL
      ? `Price approaches the structural low at **${fmtPrice(levels.recentSL.level)}** and produces a LTF reversal signal.`
      : `A clean BOS on the weekly or daily establishes an unambiguous directional bias. Re-run analysis at that point.`}`;
  } else if (jane.finalBias === 'Bullish') {
    decisionLogic = `**Correct action: BIAS LONG — wait for confirmation**\n\nThe weight of evidence supports the bullish thesis. However, entering at current price without the full confirmation sequence is premature — it accepts more risk than the setup justifies.\n\n**WHY waiting for confirmation is correct:**\nEntering on bias alone (without LTF CHoCH + BOS) means you are predicting the move rather than confirming it. Prediction loses over time. Confirmation wins. The difference in entry price is typically small. The difference in stop placement and R:R is significant.\n\n**The protocol:**\n1. Wait for price to reach demand zone ${jane.entryZone ? `(**${fmtPrice(jane.entryZone.low)} – ${fmtPrice(jane.entryZone.high)}**)` : ''}\n2. Observe LTF for CHoCH (downswing fails to make a new low)\n3. Wait for LTF BOS above the CHoCH swing high\n4. Enter with stop at **${fmtPrice(jane.invalidationLevel)}**\n5. Target T1 → T2 → T3 in sequence`;
  } else if (jane.finalBias === 'Bearish') {
    decisionLogic = `**Correct action: BIAS SHORT — wait for confirmation**\n\nThe weight of evidence supports the bearish thesis. Entering without confirmation is prediction, not trading.\n\n**The protocol:**\n1. Wait for price to reach supply zone ${jane.entryZone ? `(**${fmtPrice(jane.entryZone.low)} – ${fmtPrice(jane.entryZone.high)}**)` : ''}\n2. Observe LTF for CHoCH (upswing fails to make a new high)\n3. Wait for LTF BOS below the CHoCH swing low\n4. Enter with stop at **${fmtPrice(jane.invalidationLevel)}**\n5. Target T1 → T2 → T3 in sequence`;
  } else {
    decisionLogic = `**Correct action: OBSERVE AND WAIT**\n\nNo directional bias has been established with sufficient evidence. Deploying capital without a clear read means accepting coin-flip odds — that is not the ATLAS standard.`;
  }
  sections.push([`**⑧ DECISION LOGIC**`, Wt, decisionLogic].join('\n'));

  let invalidation = '';
  if (jane.invalidationLevel) {
    invalidation = `**Thesis invalidated by:** Candle close **${jane.finalBias === 'Bullish' ? 'below' : 'above'} ${fmtPrice(jane.invalidationLevel)}**\n\n**WHY the close distinction matters:**\nA wick through the invalidation level is a liquidity grab — institutions clearing stops before the intended move. This can actually STRENGTHEN the setup. A CLOSE through the level means the market is being valued there — genuine structural invalidation.\n\n**WHAT to do on invalidation:**\nExit immediately. No averaging down. No waiting for a recovery. The market has provided new structural information that your original read was incorrect. Accept it, protect the capital, and reset. The next opportunity will come.\n\n**Structural context:** Invalidation at **${fmtPrice(jane.invalidationLevel)}** would push price ${jane.finalBias === 'Bullish' ? `below the demand zone — structural breakdown confirmed` : `above the supply zone — structural breakout confirmed in the opposite direction`}. At that point, reassess the full picture — the ${jane.finalBias === 'Bullish' ? 'bearish' : 'bullish'} thesis becomes valid.`;
  } else {
    invalidation = `No hard invalidation level identified at current analysis depth. Manage using structural logic: if the thesis is bullish and price begins making lower highs and lower lows on the HTF, the thesis is deteriorating — reduce risk progressively rather than waiting for a single level to fail.\n\nRe-run analysis on the next significant structural event to establish a defined invalidation reference.`;
  }
  sections.push([`**⑨ INVALIDATION LOGIC**`, Wt, invalidation].join('\n'));

  let tactical = '';
  if (jane.doNotTrade) {
    tactical = `**WHAT TO DO:**\nObserve only. Keep ${symbol} on active watchlist. Monitor for structural resolution.\n\n**WHAT NOT TO DO:**\nDo not force a trade because you feel the need to be in the market. The best trade right now is no trade. Patience is a position.\n\n**WHAT MUST HAPPEN NEXT:**\nA clean BOS on the dominant timeframe that establishes unambiguous directional bias. When that occurs — re-run the full ATLAS chain immediately.\n\n**WHERE probability improves:**\n${levels.nearDemand
      ? `If price reaches **${fmtPrice(levels.nearDemand.low)} – ${fmtPrice(levels.nearDemand.high)}** and produces a LTF reaction — bullish setup activates`
      : levels.recentSL
      ? `If price approaches **${fmtPrice(levels.recentSL.level)}** and produces a reversal signal — potential bullish setup`
      : `When a BOS resolves current structural ambiguity — direction TBC`}\n${levels.nearSupply
      ? `If price reaches **${fmtPrice(levels.nearSupply.low)} – ${fmtPrice(levels.nearSupply.high)}** and produces a LTF reaction — bearish setup activates`
      : ''}`;
  } else {
    tactical = `**WHAT TO DO:**\nMonitor for the confirmation trigger — CHoCH followed by BOS in the **${jane.finalBias}** direction. Define your order levels in advance so execution is mechanical, not emotional.\n\n**WHAT NOT TO DO:**\n- Do not enter before the CHoCH + BOS sequence completes\n- Do not move your stop loss further away if price initially moves against you\n- Do not hold through invalidation at **${fmtPrice(jane.invalidationLevel)}**\n- Do not scale up size on a partial conflict signal\n\n**WHAT MUST HAPPEN before capital is deployed:**\nPrice must reach the entry zone **${jane.entryZone ? fmtPrice(jane.entryZone.low) + ' – ' + fmtPrice(jane.entryZone.high) : 'TBC'}**, produce a LTF CHoCH, then a LTF BOS in the direction of bias. All three conditions. In sequence.\n\n**WHERE probability is highest:**\n${jane.finalBias === 'Bullish'
      ? `If price sweeps any equal lows BELOW the entry zone before reversing — this is the sweep + reversal pattern (institutional accumulation sweep). It is the highest-probability entry context in the ATLAS system.`
      : `If price sweeps any equal highs ABOVE the entry zone before reversing — this is the sweep + reversal pattern (institutional distribution sweep). It is the highest-probability entry context in the ATLAS system.`}${jane.branches?.length ? '\n\n**IF/THEN Branches:**\n' + jane.branches.map(b => `▸ ${b}`).join('\n') : ''}`;
  }
  sections.push([`**⑩ TACTICAL SUMMARY**`, Wt, tactical].join('\n'));

  sections.push(`${Wt}\n⚡ ATLAS FX v3.3 · 🕷️ Spidey · 🌍 Corey · 👑 Jane\n*Re-run on major structural events. Analysis reflects conditions at time of generation.*`);

  return sections.join('\n\n');
}

// ── CHUNK FUNCTION ────────────────────────────────────────────
function chunkMessage(text, maxLen = 1900) {
  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt < 600) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < 1)   splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining.length > 0) chunks.push(remaining.trim());
  return chunks;
}

// ============================================================
// DELIVER RESULT — RENDER INTEGRITY GATE FIRST
// ============================================================

async function deliverResult(msg, result) {
  const { symbol, htfGridBuf, ltfGridBuf, htfGridName, ltfGridName, combined, htfDisplay, ltfDisplay, htfPlaceholders, ltfPlaceholders } = result;

  // ── OUTPUT VALIDATION ─────────────────────────────────────────
  if (!htfGridBuf) {
    log('ERROR', `[VALIDATE] ${symbol} htfGridBuf missing — aborting delivery`);
    await msg.channel.send({ content: `⚠️ **${symbol}** — Chart render failed. Try again.` });
    return;
  }

  // ── RENDER INTEGRITY GATE ────────────────────────────────────
  // Must be checked BEFORE any analysis output is produced.
  // 4/4 panels required. Any failure = abort all analysis.
  const integrityBlock = checkRenderIntegrity(htfPlaceholders, ltfPlaceholders, combined);
  if (integrityBlock) {
    // Post system state header + abort message ONLY
    // No execution table, no macro, no trade validation, no praise
    const abortLines = [
      formatSystemStateHeader(),
      '',
      integrityBlock,
    ].join('\n');

    // Still post the chart so the failure is visible
    await msg.channel.send({
      content: `📡 **${symbol} — Chart (PARTIAL/FAILED)**`,
      files: [new AttachmentBuilder(htfGridBuf, { name: htfGridName })],
    });
    await msg.channel.send({ content: abortLines });
    log('ERROR', `[DELIVER] ${symbol} aborted — render integrity failed`);
    return;
  }

  const cacheKey = `${msg.id}_${Date.now()}`;
  cacheForShare(cacheKey, result);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`share_${cacheKey}`).setLabel('Share to #shared-macros').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noshare_${cacheKey}`).setLabel('Keep private').setStyle(ButtonStyle.Secondary),
  );

  // 1. HTF chart grid
  await msg.channel.send({
    content: `📡 **${symbol} — HTF** · Weekly · Daily · 4H · 1H`,
    files: [new AttachmentBuilder(htfGridBuf, { name: htfGridName })],
  });

  // 2. LTF chart grid (combined mode only)
  if (combined && ltfGridBuf) {
    await msg.channel.send({
      content: `🔬 **${symbol} — LTF** · 30M · 15M · 5M · 1M`,
      files: [new AttachmentBuilder(ltfGridBuf, { name: ltfGridName })],
    });
  }

  // 3. Trade Block (execution panel appended inside formatTradeBlock)
  const tradeBlock = formatTradeBlock(result);
  const tradeChunks = chunkMessage(tradeBlock);
  for (const chunk of tradeChunks) {
    await msg.channel.send({ content: chunk });
  }

  // 4. Analysis Block separator
  await msg.channel.send({ content: `📋 **ATLAS ANALYSIS — ${symbol}** · Full institutional walkthrough below ↓` });

  // 5. Analysis Block
  const analysisBlock = formatAnalysisBlock(result);
  const analysisChunks = chunkMessage(analysisBlock);
  for (let i = 0; i < analysisChunks.length; i++) {
    const isLast  = i === analysisChunks.length - 1;
    const payload = { content: analysisChunks[i] };
    if (isLast) payload.components = [row];
    await msg.channel.send(payload);
  }
}

// ============================================================
// CHANNEL MAP + QUEUE
// ============================================================

const CHANNEL_GROUP_MAP = {
  '1432642672287547453': 'AT', '1432643496375881748': 'SK',
  '1432644116868501595': 'NM', '1482450651765149816': 'BR',
  '1432080184458350672': 'AT', '1430950313484878014': 'SK',
  '1431192381029482556': 'NM', '1482451091630194868': 'BR',
};
const RUNNING  = new Set();
const COOLDOWN = new Map();
const COOLDOWN_MS = 5000;

function isLocked(s) {
  if (RUNNING.has(s)) return true;
  const lastUnlock = COOLDOWN.get(s);
  if (lastUnlock && (Date.now() - lastUnlock) < COOLDOWN_MS) return true;
  return false;
}
function lock(s)   { RUNNING.add(s); COOLDOWN.delete(s); }
function unlock(s) { RUNNING.delete(s); COOLDOWN.set(s, Date.now()); }

const queue = []; let queueRunning = false;
function enqueue(job) { queue.push(job); void runQueue(); }
async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (queue.length > 0) { const job = queue.shift(); try { await job(); } catch (e) { log('ERROR', '[QUEUE]', e.message); } }
  queueRunning = false;
}

// ============================================================
// DISCORD DELIVERY — SHARE/CACHE
// ============================================================

const SHARE_CACHE = new Map();
function cacheForShare(k, d) { SHARE_CACHE.set(k, { ...d, expiresAt: Date.now() + CACHE_TTL_MS }); }
setInterval(() => { const n = Date.now(); for (const [k, v] of SHARE_CACHE.entries()) { if (v.expiresAt < n) SHARE_CACHE.delete(k); } }, 60000);

async function safeReply(msg, payload) { try { return await msg.reply(payload); } catch (e) { log('ERROR', '[REPLY]', e.message); return null; } }
async function safeEdit(msg, payload)  { try { return await msg.edit(payload);  } catch (e) { log('ERROR', '[EDIT]',  e.message); return null; } }

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('noshare_')) { try { await interaction.update({ content: 'Kept private.', components: [] }); } catch (_) {} return; }
  if (interaction.customId.startsWith('share_')) {
    try { await interaction.deferUpdate(); } catch (e) { log('ERROR', '[DEFER]', e.message); return; }
    const cached = SHARE_CACHE.get(interaction.customId.replace('share_', ''));
    if (!cached) { await interaction.editReply({ content: 'Share expired — run command again.', components: [] }); return; }
    try {
      const channel = await client.channels.fetch(SHARED_MACROS_CHANNEL).catch(() => null);
      if (!channel?.isTextBased()) { await interaction.editReply({ content: 'Channel not found.', components: [] }); return; }
      const shareFiles = [new AttachmentBuilder(cached.htfGridBuf, { name: cached.htfGridName })];
      if (cached.combined && cached.ltfGridBuf) shareFiles.push(new AttachmentBuilder(cached.ltfGridBuf, { name: cached.ltfGridName }));
      const shareHeader = `📤 **${cached.symbol}** shared by **${interaction.user.username}**`;
      await channel.send({ content: shareHeader, files: shareFiles });
      const shareTradeChunks = chunkMessage(formatTradeBlock(cached));
      for (const chunk of shareTradeChunks) await channel.send({ content: chunk });
      const shareAnalysisChunks = chunkMessage(formatAnalysisBlock(cached));
      for (const chunk of shareAnalysisChunks) await channel.send({ content: chunk });
      await interaction.editReply({ content: '✅ Shared in #shared-macros', components: [] });
    } catch (e) { log('ERROR', '[SHARE]', e.message); try { await interaction.editReply({ content: 'Share failed.', components: [] }); } catch (_) {} }
  }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

const PROCESSED = new Set();
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (PROCESSED.has(msg.id)) return;
  PROCESSED.add(msg.id);
  setTimeout(() => PROCESSED.delete(msg.id), MESSAGE_DEDUPE_TTL_MS);

  const raw = (msg.content || '').trim();
  if (!raw) return;

  if (raw === '!ping') { await safeReply(msg, 'pong'); return; }

  if (raw === '!stats') {
    const topSymbols = Object.entries(STATS.symbols).sort((a,b) => b[1]-a[1]).slice(0,5).map(([s,c]) => `${s}:${c}`).join(' · ') || 'none';
    await safeReply(msg, [
      `📊 **ATLAS FX — Request Stats**`,
      `Total: **${STATS.total}** · Success: **${STATS.success}** · Partial: **${STATS.partial}** · Failed: **${STATS.failed}** · Blocked: **${STATS.crypto}**`,
      `Top symbols: ${topSymbols}`,
    ].join('\n'));
    return;
  }

  if (raw === '!errors') {
    const recent = REQUEST_LOG.filter(r => r.outcome === OUTCOME.FAILED || r.outcome === OUTCOME.PARTIAL).slice(0, 5);
    if (!recent.length) { await safeReply(msg, '✅ No recent errors or partial renders.'); return; }
    const lines = recent.map(r => `\`${r.time.slice(11,19)}\` ${r.symbol || '?'} ${r.mode || '?'} — **${r.outcome}** ${(r.flags||[]).join(' ')}`);
    await safeReply(msg, `⚠️ **Recent Issues:**\n${lines.join('\n')}`);
    return;
  }

  // ── !sysstate — show current system state ──────────────────
  if (raw === '!sysstate') {
    await safeReply(msg, formatSystemStateHeader());
    return;
  }

  const group = CHANNEL_GROUP_MAP[msg.channel.id];
  if (!group) return;

  const parsed = parseCommand(raw);
  if (!parsed || parsed.action !== 'chart') return;
  if (parsed.parseError) { await safeReply(msg, `⚠️ ${parsed.parseError}`); return; }

  const { symbol, mode, htfIntervals, ltfIntervals, combined, customTFs } = parsed;
  const auditEntry = { user: msg.author.username, channel: msg.channel.name || msg.channel.id, raw, symbol, mode, flags: [], outcome: null };
  auditLog(auditEntry);
  log('INFO', `[REQ] ${msg.author.username} → ${symbol} ${mode}`);

  if (isCryptoAttempt(symbol)) {
    auditEntry.flags.push(FLAGS.CRYPTO_ATTEMPT);
    auditEntry.outcome = OUTCOME.BLOCKED;
    trackStats(symbol, OUTCOME.BLOCKED);
    log('WARN', `[BLOCKED] Crypto attempt: ${symbol} by ${msg.author.username}`);
    await safeReply(msg, `🚫 **${symbol}** — ATLAS FX does not support cryptocurrency instruments. Supported: FX pairs, equities, indices, commodities.`);
    return;
  }

  if (isLocked(symbol)) { await safeReply(msg, `⚠️ **${symbol}** is already generating — please wait.`); return; }
  lock(symbol);

  enqueue(async () => {
    const modeLabel  = combined ? 'HTF + LTF' : (mode === 'H' ? 'HTF' : 'LTF');
    const htfDisplay = htfIntervals.map(tfLabel).join(' · ');
    const ltfDisplay = ltfIntervals.map(tfLabel).join(' · ');

    log('INFO', `[CMD] ${msg.author.username} / ${group} → ${symbol} ${modeLabel}`);

    const progressLines = [
      `⏳ **${symbol}** ${modeLabel} — full institutional analysis running...`,
      combined ? `📡 HTF: ${htfDisplay}\n🔬 LTF: ${ltfDisplay}` : `⏱ ${htfDisplay}`,
      `🕷️ Spidey (HTF${combined ? ' + LTF' : ''}) · 🌍 Corey · 🕸️ TrendSpider · 👑 Jane`,
      `📊 Generating full institutional macro brief...`,
    ];
    const progress = await safeReply(msg, progressLines.join('\n'));

    try {
      const result = await runFullPipeline(symbol, mode, htfIntervals, ltfIntervals, combined, customTFs);
      if (progress) { try { await progress.delete(); } catch (_) {} }
      if ((result.htfPlaceholders + result.ltfPlaceholders) > 0) auditEntry.flags.push(FLAGS.PLACEHOLDER_USED);
      auditEntry.outcome = result.outcome;
      trackStats(symbol, result.outcome);
      auditEntry.flags.push(result.outcome === OUTCOME.SUCCESS ? FLAGS.SUCCESS : FLAGS.RENDER_WARNING);
      log('INFO', `[OUTCOME] ${symbol} ${result.outcome}`);
      await deliverResult(msg, result);
    } catch (err) {
      log('ERROR', `[CMD FAIL] ${symbol}:`, err.message);
      auditEntry.outcome = OUTCOME.FAILED;
      trackStats(symbol, OUTCOME.FAILED);
      if (progress) await safeEdit(progress, `❌ **${symbol}** analysis failed — retry\n\`${err.message}\``);
    } finally { unlock(symbol); }
  });
});

// ── SHARD + KEEP ALIVE ────────────────────────────────────────
client.on('shardDisconnect',   (e, id) => log('WARN', `[SHARD] ${id} disconnected. Code: ${e.code}`));
client.on('shardReconnecting', (id)    => log('INFO', `[SHARD] ${id} reconnecting...`));
client.on('shardResume',       (id, n) => log('INFO', `[SHARD] ${id} resumed. Replayed ${n} events.`));
setInterval(() => { log('INFO', '[KEEP-ALIVE]'); }, 5 * 60 * 1000);

// ── STARTUP ───────────────────────────────────────────────────
tsLoadPersisted();
startTSWebhookServer();
client.login(TOKEN);
