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

// HTF = Weekly / Daily / 4H / 1H
// LTF = 4H / 1H / 15M / 1M
const HTF_INTERVALS = ['1W','1D','240','60'];
const LTF_INTERVALS = ['30','15','5','1'];
const DEFAULT_TIMEFRAMES = { H: HTF_INTERVALS, L: LTF_INTERVALS };

const TF_LABELS     = { '1W':'Weekly','1D':'Daily','240':'4H','120':'2H','60':'1H','30':'30M','15':'15M','5':'5M','3':'3M','1':'1M' };
const TF_RESOLUTION = { '1W':'W','1D':'D','240':'240','120':'120','60':'60','30':'30','15':'15','5':'5','3':'3','1':'1' };

function resolveTF(input) { return TF_MAP[input.toLowerCase().trim()] || null; }
function parseCustomTFs(s) { const p = s.split(',').map((x) => x.trim()); if (p.length !== 4) return null; const r = p.map(resolveTF); return r.includes(null) ? null : r; }
function tfLabel(iv) { return TF_LABELS[iv] || iv; }

// ── COMMAND PARSER ────────────────────────────────────────────
// Supported patterns:
//   !SYMBOL H              → HTF chart + macro
//   !SYMBOL L              → LTF chart + macro
//   !SYMBOL LH or !SYMBOL L/H → Both HTF + LTF charts + combined macro
//   !SYMBOL macro          → Same as LH (locked: always both sets)
//   !SYMBOL H 1W,1D,4h,1h  → Custom TFs
//   !SYMBOL L 4h,1h,15,1   → Custom TFs
function parseCommand(content) {
  const trimmed = (content || '').trim();
  if (trimmed === '!ping') return { action: 'ping' };

  // ── MACRO command: !SYMBOL macro ──────────────────────────
  const macroMatch = trimmed.match(/^!([A-Z0-9]{2,12})\s+macro$/i);
  if (macroMatch) {
    const symbol = resolveSymbol(macroMatch[1]);
    return {
      action: 'chart',
      rawSymbol: macroMatch[1],
      symbol,
      mode: 'LH',
      htfIntervals: HTF_INTERVALS,
      ltfIntervals: LTF_INTERVALS,
      intervals: HTF_INTERVALS,          // primary set (used for Spidey HTF)
      combined: true,
      customTFs: false,
      parseError: null,
    };
  }

  // ── COMBINED L/H or LH command: !SYMBOL L/H or !SYMBOL LH ─
  const combinedMatch = trimmed.match(/^!([A-Z0-9]{2,12})\s+(L\/H|LH)$/i);
  if (combinedMatch) {
    const symbol = resolveSymbol(combinedMatch[1]);
    return {
      action: 'chart',
      rawSymbol: combinedMatch[1],
      symbol,
      mode: 'LH',
      htfIntervals: HTF_INTERVALS,
      ltfIntervals: LTF_INTERVALS,
      intervals: HTF_INTERVALS,
      combined: true,
      customTFs: false,
      parseError: null,
    };
  }

  // ── SINGLE mode: !SYMBOL H or !SYMBOL L (with optional custom TFs) ──
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
    action: 'chart',
    rawSymbol, symbol, mode,
    htfIntervals: mode === 'H' ? intervals : HTF_INTERVALS,
    ltfIntervals: mode === 'L' ? intervals : LTF_INTERVALS,
    intervals,
    combined: false,
    customTFs,
    parseError,
  };
}

function log(level, msg, ...args) { console.log(`[${new Date().toISOString()}] [${level}] ${msg}`, ...args); }

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

// ── SPIDEY LTF — dedicated lower timeframe structure run ──────
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

  // In combined mode, Jane weighs HTF for bias and LTF for execution confirmation
  const htfBias  = spideyHTF.dominantBias,  htfConv  = spideyHTF.dominantConviction;
  const ltfBias  = spideyLTF ? spideyLTF.dominantBias  : htfBias;
  const ltfConv  = spideyLTF ? spideyLTF.dominantConviction : htfConv;
  const coreyBias = coreyResult.combinedBias, coreyConf = coreyResult.confidence;
  const tsBias    = coreyResult.trendSpider.signalBias, tsGrade = coreyResult.trendSpider.grade;
  const tsFresh   = coreyResult.trendSpider.fresh, tsAvail = coreyResult.trendSpider.available;
  const biasS     = { Bullish: 1, Neutral: 0, Bearish: -1 };

  // Spidey score: HTF weighted more than LTF (60/40 split when both present)
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

  // LTF conflict penalty in combined mode
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

  // Apply LTF conflict penalty in combined mode
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
  // Use HTF for primary levels, LTF to refine entry zone if available
  const htfTFs = Object.entries(spideyHTF.timeframes);
  const htfData = htfTFs[0]?.[1] || null;
  const ltfData = spideyLTF ? Object.entries(spideyLTF.timeframes)[0]?.[1] || null : null;

  const cp  = htfData?.currentPrice || ltfData?.currentPrice || 0;
  const pip = cp > 10 ? 0.01 : cp > 1 ? 0.0001 : 0.01;

  let entryZone = null, invalidationLevel = null, targets = [];

  if (bias !== 'Neutral') {
    if (bias === 'Bullish') {
      // Prefer LTF demand zone for refined entry, fall back to HTF
      const dz = (ltfData?.activeDemand) || (htfData?.activeDemand);
      if (dz) { entryZone = { high: dz.high, low: dz.low }; invalidationLevel = dz.low - pip * 10; }
      else if (htfData?.swingLows?.length) { const sl = htfData.swingLows[htfData.swingLows.length - 1]; entryZone = { high: sl.level + pip * 5, low: sl.level - pip * 5 }; invalidationLevel = sl.level - pip * 15; }
      // Targets: HTF liquidity pools + imbalances above price
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
// CHART ENGINE — PLAYWRIGHT + SHARP (single instance)
// ============================================================

let browserInstance = null;

async function getBrowser() {
  if (browserInstance) {
    try { await browserInstance.version(); return browserInstance; } catch { browserInstance = null; }
  }
  browserInstance = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
  });
  return browserInstance;
}

function buildPanelUrl(symbol, interval) {
  const tvSym = encodeURIComponent(getTVSymbol(symbol));
  const iv    = encodeURIComponent(interval);
  // Use saved TradingView layout — loads your exact chart settings, theme, and style
  return `https://www.tradingview.com/chart/${TV_LAYOUT}/?symbol=${tvSym}&interval=${iv}`;
}

async function cleanUI(page) {
  await page.evaluate(() => {
    [
      '[data-name="header-toolbar"]','[data-name="right-toolbar"]','[data-name="left-toolbar"]',
      '.layout__area--right','.layout__area--left','.layout__area--top',
      '.tv-side-toolbar','.tv-control-bar','.tv-floating-toolbar',
      '.chart-controls-bar','.header-chart-panel','[data-name="legend"]',
      '.chart-toolbar','.topbar','.top-bar','.tv-watermark','#overlap-manager-root',
    ].forEach((sel) => document.querySelectorAll(sel).forEach((el) => el.remove()));
  }).catch(() => {});
}

async function closePopups(page) {
  for (const sel of ['button[aria-label="Close"]','button:has-text("Accept")','button:has-text("Got it")']) {
    try { const btn = page.locator(sel).first(); if (await btn.isVisible({ timeout: 500 })) await btn.click(); } catch {}
  }
}

async function renderPanel(symbol, interval, tfKey) {
  const browser = await getBrowser();
  const url     = buildPanelUrl(symbol, interval);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let context;
    try {
      log('INFO', `[PANEL] ${symbol} ${tfKey} attempt ${attempt}`);
      context = await browser.newContext({
        viewport: { width: PANEL_W, height: PANEL_H },
        deviceScaleFactor: 2,
        locale: 'en-US',
        timezoneId: 'Australia/Perth',
      });
      if (TV_COOKIES) await context.addCookies(TV_COOKIES);
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(RENDER_TIMEOUT_MS);
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);
      await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch {} });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
      await page.waitForSelector('canvas', { timeout: 30000 });
      await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c && c.width > 300 && c.height > 150; }, { timeout: 30000 });
      await page.waitForTimeout(5000);
      await closePopups(page);
      await cleanUI(page);
      await page.waitForTimeout(1000);
      const buffer = await page.screenshot({ type: 'png', fullPage: false });
      await context.close();
      if (buffer.length < 80000) throw new Error(`Blank render (${buffer.length}B)`);
      log('INFO', `[OK] ${symbol} ${tfKey} ${(buffer.length / 1024).toFixed(0)}KB`);
      return buffer;
    } catch (err) {
      log('ERROR', `[FAIL] ${symbol} ${tfKey}: ${err.message}`);
      if (context) { try { await context.close(); } catch {} }
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function buildGrid(panels) {
  const resized = await Promise.all(
    panels.map((img) => sharp(img).resize(PANEL_W, PANEL_H, { fit: 'fill' }).png().toBuffer())
  );
  return await sharp({
    create: { width: PANEL_W * 2, height: PANEL_H * 2, channels: 4, background: { r: 11, g: 11, b: 11, alpha: 1 } },
  })
    .composite([
      { input: resized[0], left: 0,       top: 0       },
      { input: resized[1], left: PANEL_W,  top: 0       },
      { input: resized[2], left: 0,       top: PANEL_H  },
      { input: resized[3], left: PANEL_W,  top: PANEL_H  },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function makePlaceholderPanel() {
  return await sharp({
    create: { width: PANEL_W, height: PANEL_H, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } },
  }).jpeg({ quality: 60 }).toBuffer();
}

async function renderAll(symbol, intervals) {
  // Render all 4 panels in parallel — major speed gain over sequential
  const panels = await Promise.all(
    intervals.slice(0, 4).map(async (iv) => {
      try {
        return await renderPanel(symbol, iv, tfLabel(iv));
      } catch (err) {
        log('WARN', `[RENDER SKIP] ${symbol} ${tfLabel(iv)}: ${err.message} — placeholder used`);
        return await makePlaceholderPanel();
      }
    })
  );
  while (panels.length < 4) panels.push(await makePlaceholderPanel());
  return await buildGrid(panels.slice(0, 4));
}

// ============================================================
// runFullPipeline — MAIN ORCHESTRATOR
// ============================================================

async function runFullPipeline(symbol, mode, htfIntervals, ltfIntervals, combined, customTFs) {
  log('INFO', `[PIPELINE] ${symbol} mode:${mode} combined:${combined} htf:[${htfIntervals.join(',')}] ltf:[${ltfIntervals.join(',')}]`);

  // Run Corey and Spidey HTF in parallel
  const [coreyResult, spideyHTF] = await Promise.all([
    runCorey(symbol),
    runSpideyHTF(symbol, htfIntervals),
  ]);

  // Run LTF Spidey — always run for Micro confirmation, run full LTF set in combined mode
  const [spideyLTF, spideyMicro] = await Promise.all([
    combined ? runSpideyLTF(symbol, ltfIntervals) : Promise.resolve(null),
    runSpideyMicro(symbol, spideyHTF.dominantBias),
  ]);

  // Jane gets both HTF and LTF results in combined mode
  const jane = runJane(symbol, spideyHTF, spideyLTF, coreyResult, mode);

  // Render grids
  let htfGridBuf, ltfGridBuf;
  if (combined) {
    [htfGridBuf, ltfGridBuf] = await Promise.all([
      renderAll(symbol, htfIntervals),
      renderAll(symbol, ltfIntervals),
    ]);
  } else {
    htfGridBuf = await renderAll(symbol, mode === 'H' ? htfIntervals : ltfIntervals);
    ltfGridBuf = null;
  }

  const htfDisplay = htfIntervals.map(tfLabel).join(' · ');
  const ltfDisplay = ltfIntervals.map(tfLabel).join(' · ');
  const modeLabel  = combined ? 'HTF + LTF' : (mode === 'H' ? 'HTF' : 'LTF');
  const ts         = Date.now();
  const htfGridName = `ATLAS_${symbol}_HTF_${ts}.jpg`;
  const ltfGridName = `ATLAS_${symbol}_LTF_${ts}.jpg`;

  log('INFO', `[PIPELINE] ${symbol} complete — bias:${jane.finalBias} conviction:${jane.convictionLabel}`);

  return {
    symbol, mode, combined, modeLabel,
    htfIntervals, ltfIntervals, htfDisplay, ltfDisplay,
    spideyHTF, spideyLTF, spideyMicro, coreyResult, jane,
    htfGridBuf, ltfGridBuf, htfGridName, ltfGridName,
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
  const filled = Math.round(conviction * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${(conviction * 100).toFixed(0)}%`;
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
    // Single mode — show micro summary only
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

  // Micro execution layer
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

  // Macro bias output
  const macBiasEmoji = getBiasEmoji(coreyResult.macroBias);
  const combBiasEmoji = getBiasEmoji(coreyResult.combinedBias);
  lines.push(`${macBiasEmoji} **Internal Macro Bias:** ${coreyResult.macroBias}`);
  lines.push(`${combBiasEmoji} **Combined Bias (with TS):** ${coreyResult.combinedBias} · Confidence: ${getConvictionBar(coreyResult.confidence)}`);

  if (coreyResult.alignment)     lines.push(`✅ *TrendSpider signal aligns with macro bias — confidence reinforced*`);
  if (coreyResult.contradiction) lines.push(`❌ *TrendSpider conflicts with macro direction — apply caution*`);
  if (coreyResult.escalation === 'Warning') lines.push(`⚠️ *Strong TS signal contradicting macro — escalation warning active*`);

  // Correlation block
  if (coreyResult.correlation) {
    const corr = coreyResult.correlation;
    if (corr.divergent?.length > 0) {
      lines.push('');
      lines.push(`⚠️ **Correlation Divergence Detected:**`);
      for (const d of corr.divergent) {
        lines.push(`   ${d.pair}: expected ${d.expected}, showing ${d.actual} — *${d.significance}*`);
      }
    } else if (corr.positive?.length > 0) {
      const aligned = corr.positive.filter((p) => p.bias === coreyResult.macroBias);
      if (aligned.length) lines.push(`\n✅ **Correlated Pairs Aligned:** ${aligned.map((p) => p.pair).join(', ')}`);
    }
  }

  // Macro reasoning notes
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
    for (const t of jane.targets) {
      lines.push(`  ${t.label}: **${fmt(t.level)}**`);
    }
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

function formatEducationalBlock(jane, spideyHTF, spideyLTF, coreyResult, mode) {
  const lines = [];
  const bias = jane.finalBias;
  const ac   = coreyResult.internalMacro.assetClass;

  if (jane.doNotTrade) {
    lines.push(`**What less experienced traders often miss:**`);
    lines.push(`When signals are fragmented like this, the temptation is to pick a direction anyway and justify it post-hoc. This is confirmation bias — selecting data that supports what you want to see while ignoring contrary evidence. The ATLAS system is designed to prevent this by requiring all engines to align before declaring a bias. A clear "no trade" signal is one of the most valuable outputs the system can produce.`);
    lines.push('');
    lines.push(`**What to monitor:**`);
    lines.push(`Watch for a clean Break of Structure on the higher timeframe that resolves current ambiguity. When that occurs, run the analysis again. The market will eventually show its hand — patience is the edge.`);
    return lines.join('\n');
  }

  lines.push(`**What to look for:**`);
  if (bias === 'Bullish') {
    lines.push(`Price needs to pull back into the identified demand zone without closing below it. On the lower timeframes, you need to see a CHoCH (Change of Character) — where the local downswing fails to make a new low — followed by a BOS (Break of Structure) to the upside. That sequence is the entry confirmation.`);
  } else if (bias === 'Bearish') {
    lines.push(`Price needs to retrace into the supply zone without closing above it. On the lower timeframes, look for a CHoCH — where the local upswing fails to make a new high — followed by a BOS to the downside. That sequence confirms the distribution thesis.`);
  } else {
    lines.push(`Both directional setups remain possible. Monitor for a decisive structural break on the higher timeframe before committing to a directional position.`);
  }

  lines.push('');
  lines.push(`**Why it matters:**`);
  if (ac === ASSET_CLASS.EQUITY || SEMI_SYMBOLS.has(coreyResult.internalMacro.symbol)) {
    lines.push(`Equities are highly sensitive to macro risk appetite. In a risk-off environment, even technically bullish setups can fail because institutional flows override structure temporarily. This is why Corey's macro read is critical — it tells you whether the broader environment supports the move or is working against it.`);
  } else if (ac === ASSET_CLASS.FX) {
    lines.push(`FX movements are driven by relative economic strength and central bank divergence over the medium term. Short-term price action creates the entry opportunity, but if the macro environment is against you, those setups have lower probability. Spidey finds the setup; Corey confirms whether the wind is at your back.`);
  } else if (ac === ASSET_CLASS.COMMODITY) {
    lines.push(`Commodities are sensitive to DXY direction and risk appetite simultaneously. A bullish commodity setup in a strong USD, risk-off environment faces structural headwinds. The structure may be valid but the macro tailwind is absent — that changes position sizing and target expectations.`);
  } else {
    lines.push(`Index direction is closely tied to risk environment and liquidity conditions. A structural setup against the prevailing macro trend requires higher conviction and tighter risk management.`);
  }

  lines.push('');
  lines.push(`**What confirms the idea:**`);
  if (bias !== 'Neutral') {
    lines.push(`• Clean ${bias === 'Bullish' ? 'demand' : 'supply'} zone tap with no close through the zone`);
    lines.push(`• LTF CHoCH followed by BOS in the direction of the bias`);
    lines.push(`• Corey macro bias ${bias === 'Bullish' ? 'bullish or neutral' : 'bearish or neutral'} (not actively opposed)`);
    lines.push(`• TrendSpider signal ${bias === 'Bullish' ? 'bullish' : 'bearish'} or absent (absence is acceptable, conflict is not)`);
  }

  lines.push('');
  lines.push(`**What invalidates it:**`);
  lines.push(`A candle close beyond the stop loss level. Not a wick — a close. Wicks can be liquidity grabs. Closes through structure signal genuine breakdown. When that happens, exit cleanly without hesitation and wait for the market to show a new structural picture.`);

  lines.push('');
  lines.push(`**What less experienced traders often miss:**`);
  if (mode === 'LH') {
    lines.push(`The most common mistake is entering on HTF bias without waiting for LTF confirmation. The higher timeframe gives you the direction; the lower timeframe gives you the timing. Entering too early — before LTF structure confirms — exposes you to the full swing drawdown rather than a controlled entry with defined risk.`);
  } else {
    lines.push(`Acting on a single timeframe without understanding the broader context. A perfect setup on one timeframe can be structurally invalid if the higher timeframe is in a conflicting phase. Always know where you are in the larger structure before executing.`);
  }

  return lines.join('\n');
}

function formatDecisionFramework(jane) {
  const lines = [];
  if (jane.doNotTrade) {
    lines.push(`🔴 **Stand aside.** Current conditions do not meet the ATLAS minimum threshold for execution.`);
    return lines.join('\n');
  }

  const bias = jane.finalBias;
  lines.push(`**📋 Conditional Decision Framework:**`);
  lines.push('');

  if (bias === 'Bullish') {
    lines.push(`✅ **Bullish if:**`);
    lines.push(`   Price retests demand zone ${jane.entryZone ? `(${fmt(jane.entryZone.low)} – ${fmt(jane.entryZone.high)})` : '(see levels above)'},`);
    lines.push(`   LTF confirms with CHoCH → BOS, and structure holds above ${fmt(jane.invalidationLevel)}`);
    lines.push('');
    lines.push(`🔴 **Bearish / Reassess if:**`);
    lines.push(`   Price closes below ${fmt(jane.invalidationLevel)} — thesis invalidated`);
    lines.push('');
    lines.push(`⚪ **Stand aside if:**`);
    lines.push(`   No clean demand zone tap occurs, or LTF shows inducement without confirmation`);
  } else if (bias === 'Bearish') {
    lines.push(`✅ **Bearish if:**`);
    lines.push(`   Price retests supply zone ${jane.entryZone ? `(${fmt(jane.entryZone.low)} – ${fmt(jane.entryZone.high)})` : '(see levels above)'},`);
    lines.push(`   LTF confirms with CHoCH → BOS to the downside, and structure holds below ${fmt(jane.invalidationLevel)}`);
    lines.push('');
    lines.push(`🟢 **Bullish / Reassess if:**`);
    lines.push(`   Price closes above ${fmt(jane.invalidationLevel)} — thesis invalidated`);
    lines.push('');
    lines.push(`⚪ **Stand aside if:**`);
    lines.push(`   No clean supply zone tag, or LTF inducement detected without reversal confirmation`);
  } else {
    lines.push(`⚪ **Stand aside until:**`);
    lines.push(`   A clear structural bias emerges on the dominant timeframe.`);
    lines.push(`   Re-run analysis when price breaks a confirmed swing high or low.`);
  }

  return lines.join('\n');
}


// ============================================================
// ATLAS OUTPUT SYSTEM v3.2 — TRADE BLOCK + ANALYSIS BLOCK
// ============================================================

// ── POSITION STATE RESOLVER ───────────────────────────────────
function resolveAtlasPositionState(jane, levels) {
  if (jane.doNotTrade || jane.finalBias === 'Neutral') return { state: '⚪️ DORMANT', label: 'Dormant' };
  const cp = levels.currentPrice;
  if (!cp || !levels.entryZone) return { state: '⚪️ DORMANT', label: 'Dormant' };
  const ez = levels.entryZone;
  const inZone      = cp >= ez.low && cp <= ez.high;
  const approaching = jane.finalBias === 'Bullish' ? cp < ez.low && cp > ez.low * 0.995 : cp > ez.high && cp < ez.high * 1.005;
  const diverging   = jane.finalBias === 'Bullish' ? cp > ez.high * 1.005 : cp < ez.low * 0.995;
  if (inZone)      return { state: '🟢 ENTRY',             label: 'Entry' };
  if (approaching) return { state: '🟠⬆️ APPROACHING',     label: 'Approaching' };
  if (diverging)   return { state: '🟠⬇️ DIVERGING',       label: 'Diverging' };
  return             { state: '🟠⬆️ APPROACHING',           label: 'Approaching' };
}

// ── TRADE BLOCK FORMATTER ─────────────────────────────────────
function formatTradeBlock(result) {
  const { symbol, mode, combined, modeLabel, spideyHTF, spideyLTF, spideyMicro, coreyResult, jane, htfDisplay, ltfDisplay } = result;
  const macro   = coreyResult.internalMacro;
  const levels  = jane;
  const cp      = spideyHTF.currentPrice;
  const feed    = getFeedName(symbol);
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-AU', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Australia/Perth' });
  const timeStr = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Perth', timeZoneName: 'short' });
  const posState = resolveAtlasPositionState(jane, { currentPrice: cp, entryZone: jane.entryZone });
  const W  = '═'.repeat(32);
  const lines = [];

  // ── HEADER ──────────────────────────────────────────────────
  lines.push(`╔${W}╗`);
  lines.push(`  ⚡ **ATLAS FX — ${symbol}** · ${feed}`);
  lines.push(`  📅 ${dateStr} · ⏰ ${timeStr}`);
  lines.push(`  📊 ${modeLabel}${combined ? ` · HTF: ${htfDisplay} · LTF: ${ltfDisplay}` : ` · ${htfDisplay}`}`);
  lines.push(`╚${W}╝`);
  lines.push('');

  // ── ATLAS POSITION STATE ────────────────────────────────────
  lines.push(`**ATLAS POSITION STATE: ${posState.state}**`);
  if (cp) lines.push(`💰 **Current Price:** ${fmt(cp)}`);
  lines.push('');

  // ── BIAS & CONVICTION ───────────────────────────────────────
  const biasEmoji = getBiasEmoji(jane.finalBias);
  lines.push(`${biasEmoji} **Bias: ${jane.finalBias}** · Conviction: **${jane.convictionLabel}** · ${getConvictionBar(jane.conviction)}`);
  lines.push('');

  if (jane.doNotTrade) {
    // ── DO NOT TRADE STATE ─────────────────────────────────────
    lines.push(`⛔ **DO NOT TRADE**`);
    lines.push(`> ${jane.doNotTradeReason}`);
    lines.push('');
    lines.push(`🧭 **What We're Waiting For:**`);
    lines.push(`- Structural resolution on the dominant timeframe`);
    lines.push(`- Clean BOS or CHoCH that establishes unambiguous bias`);
    lines.push(`- All three engines (Spidey · Corey · Jane) in alignment`);
    lines.push('');
    lines.push(`⚪️ **Capital Status:** Dormant — no deployment justified`);
    lines.push(`📍 **Action:** Observe only. Re-run analysis when structure resolves.`);
  } else {
    // ── ENTRY ZONE ──────────────────────────────────────────────
    if (jane.entryZone) {
      lines.push(`🟢 **Entry Zone:**`);
      lines.push(`   ${fmt(jane.entryZone.low)} – ${fmt(jane.entryZone.high)}`);
      lines.push(`   *${posState.label === 'Entry' ? 'Price is inside the zone — confirmation rules apply before committing' : posState.label === 'Approaching' ? 'Price approaching — prepare for confirmation trigger' : 'Price has diverged — do not chase, wait for retrace'}`);
      lines.push('');
    }

    // ── STOP LOSS ────────────────────────────────────────────────
    if (jane.invalidationLevel) {
      lines.push(`🛑 **Set Stop Loss:**`);
      lines.push(`   ${fmt(jane.invalidationLevel)}`);
      lines.push(`   *Protective stop beyond structural invalidation — closure through this level cancels the thesis*`);
      lines.push('');
    }

    // ── TARGETS ──────────────────────────────────────────────────
    if (jane.targets && jane.targets.length > 0) {
      lines.push(`🎯 **Targets:**`);
      for (const t of jane.targets) lines.push(`   ${t.label}: **${fmt(t.level)}**`);
      lines.push(`   *Take partials at each target — never hold full size to final without structural confirmation*`);
      lines.push('');
    }

    // ── EXIT ─────────────────────────────────────────────────────
    lines.push(`🔴 **Exit:**`);
    if (jane.targets && jane.targets.length > 0) {
      lines.push(`   Staged exit at T1 → T2 → T3 cascade. Full close on target completion or structural failure.`);
    } else {
      lines.push(`   Close on structural reversal signal or invalidation breach. No defined target — manage dynamically.`);
    }
    lines.push('');

    // ── RISK PROFILE ─────────────────────────────────────────────
    lines.push(`📊 **Risk Profile:**`);
    if (jane.rrRatio) {
      lines.push(`   R:R ~${jane.rrRatio}:1 ${jane.rrRatio >= 3 ? '✅ Meets ATLAS minimum 1:3' : '⚠️ Below ATLAS 1:3 minimum — evaluate carefully'}`);
    } else {
      lines.push(`   R:R pending — confirm entry zone and stop level before sizing`);
    }
    lines.push('');

    // ── TIMING ───────────────────────────────────────────────────
    lines.push(`⏳ **Timing Expectation:**`);
    if (posState.label === 'Entry') {
      lines.push(`   Immediate — price is in zone. Confirmation trigger required before entry.`);
    } else if (posState.label === 'Approaching') {
      lines.push(`   Not yet active — higher probability if price reaches ${jane.entryZone ? fmt(jane.entryZone.low) : 'entry zone'}.`);
    } else {
      lines.push(`   Diverging — setup not valid at current price. Reassess on structural retrace.`);
    }
    lines.push('');

    // ── CURRENT POSITIONING ──────────────────────────────────────
    lines.push(`📍 **Current Positioning:**`);
    if (cp && jane.entryZone) {
      const distPct = Math.abs((cp - (jane.entryZone.low + jane.entryZone.high) / 2) / cp * 100).toFixed(2);
      lines.push(`   Price ${fmt(cp)} is ${distPct}% ${cp < jane.entryZone.low ? 'below' : cp > jane.entryZone.high ? 'above' : 'inside'} the entry zone.`);
    } else {
      lines.push(`   Current price relative to zone — see chart.`);
    }
    lines.push('');

    // ── WHAT WE'RE WAITING FOR ───────────────────────────────────
    lines.push(`🧭 **What We're Waiting For:**`);
    if (jane.finalBias === 'Bullish') {
      lines.push(`- Price retrace into demand zone without closing below it`);
      lines.push(`- LTF CHoCH confirming local downswing failure`);
      lines.push(`- LTF BOS to the upside completing the confirmation sequence`);
    } else {
      lines.push(`- Price retrace into supply zone without closing above it`);
      lines.push(`- LTF CHoCH confirming local upswing failure`);
      lines.push(`- LTF BOS to the downside completing the confirmation sequence`);
    }
    lines.push('');

    // ── ACTIVATION CONDITION ────────────────────────────────────
    lines.push(`⚠️ **Activation Condition:**`);
    lines.push(`   Candle **close** through the LTF BOS level — not a wick. Closure validates. Wicks are noise.`);
    lines.push('');

    // ── INVALIDATION ────────────────────────────────────────────
    lines.push(`🚫 **Invalidation:**`);
    lines.push(`   Close ${jane.finalBias === 'Bullish' ? 'below' : 'above'} ${fmt(jane.invalidationLevel)} — thesis cancelled. Exit immediately. No re-entry until structure resets.`);
    lines.push('');

    // ── ALTERNATE SCENARIO ──────────────────────────────────────
    lines.push(`🔁 **Alternate Scenario:**`);
    lines.push(`   ${jane.alternativeScenario || `${jane.finalBias === 'Bullish' ? 'Bearish' : 'Bullish'} path opens on invalidation breach — reassess full structure before considering counter-trade.`}`);
  }

  return lines.join('\n');
}

// ── ANALYSIS BLOCK FORMATTER ──────────────────────────────────
function formatAnalysisBlock(result) {
  const { symbol, mode, combined, modeLabel, spideyHTF, spideyLTF, spideyMicro, coreyResult, jane, htfDisplay, ltfDisplay } = result;
  const macro  = coreyResult.internalMacro;
  const global = macro.global;
  const regime = macro.regime;
  const vol    = macro.volatility;
  const liq    = macro.liquidity;
  const ac     = macro.assetClass;
  const cp     = spideyHTF.currentPrice;
  const Wt     = '─'.repeat(32);
  const sections = [];

  // ── HEADER ──────────────────────────────────────────────────
  sections.push([
    `📋 **ATLAS FX — INSTITUTIONAL ANALYSIS BRIEF**`,
    `**${symbol}** · ${modeLabel} · ${getFeedName(symbol)}`,
    Wt,
  ].join('\n'));

  // ── 1. SYSTEM STATE ──────────────────────────────────────────
  const riskLabel  = global.riskEnv === 'RiskOn' ? '🟢 Risk-On' : global.riskEnv === 'RiskOff' ? '🔴 Risk-Off' : '⚪️ Risk-Neutral';
  const regimeDesc = regime?.regime || 'Transition';
  const volDesc    = vol?.level || 'Moderate';
  const liqDesc    = liq?.state || 'Neutral';

  sections.push([
    `**① SYSTEM STATE**`,
    Wt,
    `**Risk Environment:** ${riskLabel}`,
    `**Market Regime:** ${regimeDesc} — ${
      regimeDesc === 'Expansion' ? 'broad risk appetite, equities and risk assets favoured, USD typically soft' :
      regimeDesc === 'Crisis'    ? 'capital flight to safety, USD and JPY bid, risk assets under severe pressure' :
      regimeDesc === 'Growth'    ? 'constructive environment, selective risk-taking, earnings and data dominant' :
      regimeDesc === 'Contraction' ? 'deteriorating conditions, defensive positioning, credit and liquidity tightening' :
      'regime ambiguous — market absorbing conflicting signals'
    }`,
    `**Volatility:** ${volDesc} — ${
      volDesc === 'High' ? 'elevated uncertainty, wider spreads expected, reduce position sizing accordingly' :
      volDesc === 'Low'  ? 'compressed volatility often precedes expansion — watch for breakout conditions' :
      'balanced risk environment, standard position sizing appropriate'
    }`,
    `**Liquidity:** ${liqDesc} — ${
      liqDesc === 'Tight'  ? 'credit and funding conditions are restrictive — institutional flows cautious' :
      liqDesc === 'Loose'  ? 'abundant liquidity supporting risk assets and carry trades' :
      'neutral liquidity — no extraordinary conditions present'
    }`,
    `**DXY Posture:** ${global.dxyBias} — ${
      global.dxyBias === 'Bullish' ? 'USD strength creating headwinds for risk assets, commodities, and non-USD pairs' :
      global.dxyBias === 'Bearish' ? 'USD weakness providing tailwind for risk assets, commodities, and EM currencies' :
      'USD in consolidation — no dominant directional pressure'
    }`,
  ].join('\n'));

  // ── 2. PRIMARY DRIVER ────────────────────────────────────────
  let primaryDriver = '';
  let driverDetail  = '';
  if (ac === 'Equity' || ac === 'Semiconductors') {
    primaryDriver = 'Risk Sentiment + Sector Rotation';
    driverDetail  = `${symbol} is an equity instrument — its price is primarily governed by the interplay between macro risk appetite and sector-specific capital flows. In the current ${global.riskEnv} environment, institutional money is ${global.riskEnv === 'RiskOn' ? 'rotating into growth and technology, providing a structural tailwind for equities. AI capex cycles and earnings expectations are the primary near-term catalysts.' : 'rotating defensively, reducing equity exposure and increasing cash or bond positioning. This is a headwind for growth equities regardless of technical setup quality.'}`;
    if (macro.sector?.sector === 'Semiconductors') {
      driverDetail += ` As a semiconductor-adjacent instrument, ${symbol} carries additional sensitivity to AI capital expenditure cycles, memory demand cycles, and geopolitical supply chain dynamics — all of which can override short-term technical signals.`;
    }
  } else if (ac === 'FX') {
    primaryDriver = 'Central Bank Divergence + Economic Differential';
    driverDetail  = `FX pairs are driven by relative economic strength and central bank policy divergence over the medium term. ${macro.base.currency} (${macro.base.cb.name}) is currently ${macro.base.cb.stance} with a ${macro.base.cb.rateCycle} rate cycle. ${macro.quote.currency} (${macro.quote.cb.name}) is ${macro.quote.cb.stance} with a ${macro.quote.cb.rateCycle} cycle. The differential between these two policy trajectories is the primary macro driver — the pair tends to trend in the direction of the currency with the more hawkish relative stance.`;
  } else if (ac === 'Commodity') {
    primaryDriver = 'USD Flow + Risk Sentiment + Supply Dynamics';
    driverDetail  = `Commodities are inversely correlated with USD strength over the medium term. With DXY ${global.dxyBias}, this creates a ${global.dxyBias === 'Bullish' ? 'headwind' : 'tailwind'} for ${symbol}. Risk environment (${global.riskEnv}) ${global.riskEnv === 'RiskOff' ? 'supports safe-haven commodity flows (gold, silver) but pressures industrial demand commodities' : 'supports industrial demand but may reduce safe-haven premium'}.`;
  } else if (ac === 'Index') {
    primaryDriver = 'Risk Appetite + Macro Momentum + Earnings Cycle';
    driverDetail  = `Index instruments aggregate equity market sentiment. In ${global.riskEnv} conditions, institutional flows are ${global.riskEnv === 'RiskOn' ? 'into equities, supporting index upside — breadth and momentum are the key internal confirmations' : 'away from equities — index downside risk elevated regardless of individual component performance'}. DXY ${global.dxyBias} ${global.dxyBias === 'Bullish' ? 'may dampen foreign institutional inflows into USD-denominated indices' : 'tends to attract foreign capital into USD-denominated markets'}.`;
  } else {
    primaryDriver = 'Macro Risk Environment';
    driverDetail  = `Primary driver is the prevailing ${global.riskEnv} macro environment combined with ${global.dxyBias} USD posture.`;
  }
  sections.push([`**② PRIMARY DRIVER**`, Wt, `**Driver:** ${primaryDriver}`, '', driverDetail].join('\n'));

  // ── 3. TRANSMISSION MECHANISM ────────────────────────────────
  let transmission = '';
  if (ac === 'Equity' || ac === 'Semiconductors') {
    transmission = `The mechanism runs as follows: macro risk environment → institutional fund flows → sector rotation decisions → individual equity price. When risk appetite expands, fund managers increase equity allocations, with growth and technology sectors receiving disproportionate inflows. This creates buying pressure at the index level first, then cascades into sector leaders. For ${symbol}, the specific transmission is: AI/semiconductor demand narrative → earnings expectation revision → institutional reweighting → price. The key insight is that price often moves ahead of fundamental confirmation — structure reflects the anticipation of the narrative, not the narrative itself.`;
  } else if (ac === 'FX') {
    transmission = `The transmission mechanism for FX runs through interest rate differentials → capital flows → spot price. When one central bank is hiking while the other is holding or cutting, international capital seeks the higher-yielding currency — this is carry trade mechanics. The flow of institutional money through forwards, swaps, and spot creates the directional pressure visible on HTF charts. Short-term deviations are noise within this longer-term current. The LTF execution opportunity exists when price retraces against the dominant flow, creating a better entry into the prevailing trend.`;
  } else if (ac === 'Commodity') {
    transmission = `The transmission for commodity pricing runs: USD direction → commodity denomination effect → demand expectations → futures pricing → spot. A stronger USD makes commodities more expensive for non-USD buyers, reducing demand — this is the direct mechanical relationship. Simultaneously, risk sentiment governs whether institutional money is flowing into commodities as an inflation hedge, safe-haven, or growth proxy. These two forces — USD direction and risk sentiment — occasionally conflict, creating the complex behaviour visible in commodity charts during regime transitions.`;
  } else {
    transmission = `Macro conditions translate into price through institutional flow — fund allocation decisions at the macro level eventually appear as structural moves on the HTF chart. LTF price action represents the distribution and accumulation within those larger moves.`;
  }
  sections.push([`**③ TRANSMISSION MECHANISM**`, Wt, transmission].join('\n'));

  // ── 4. HTF STRUCTURE MEANING ─────────────────────────────────
  const htfBias = spideyHTF.dominantBias;
  const htfConv = (spideyHTF.dominantConviction * 100).toFixed(0);
  const sig     = spideyHTF.significantBreak;
  const htfTFBreakdown = Object.entries(spideyHTF.timeframes)
    .map(([iv, r]) => `${tfLabel(iv)}: **${r.bias}** (${r.structure}, ${(r.conviction*100).toFixed(0)}%)`)
    .join(' · ');

  let htfMeaning = `The higher timeframe structure shows a **${htfBias}** dominant bias at **${htfConv}% conviction** across ${htfDisplay}.\n\n${htfTFBreakdown}\n\n`;

  if (sig && sig.lastBreak !== 'None') {
    htfMeaning += `The most significant structural event is a **${sig.lastBreak}** on the **${tfLabel(sig.timeframe)}**${sig.isEngineered ? ' — this break was engineered, meaning institutional liquidity was swept before the move. Engineered breaks often precede strong continuation moves as retail stops are cleared first.' : ' — this represents a genuine structural shift where price closed beyond a prior swing point, confirming the directional bias.'}`;
  } else {
    htfMeaning += `No confirmed BOS or CHoCH is present — price is in a ranging or accumulation phase. This often precedes a directional expansion once liquidity above or below range extremes is taken.`;
  }

  if (spideyHTF.nearestDraw) {
    htfMeaning += `\n\nThe nearest draw on liquidity is **${spideyHTF.nearestDraw.type} at ${fmt(spideyHTF.nearestDraw.level)}** with ${spideyHTF.nearestDraw.strength} touches. Price is magnetically drawn toward liquidity clusters — this level represents the most probable near-term destination before any significant reversal.`;
  }

  // Add supply/demand zone context from first HTF timeframe
  const primaryHTF = Object.values(spideyHTF.timeframes)[0];
  if (primaryHTF?.activeSupply) {
    htfMeaning += `\n\n**Active Supply Zone:** ${fmt(primaryHTF.activeSupply.low)} – ${fmt(primaryHTF.activeSupply.high)} — this is a distribution zone where institutional selling previously overwhelmed buying. Price reactions here carry high probability.`;
  }
  if (primaryHTF?.activeDemand) {
    htfMeaning += `\n\n**Active Demand Zone:** ${fmt(primaryHTF.activeDemand.low)} – ${fmt(primaryHTF.activeDemand.high)} — this is an accumulation zone where institutional buying previously overwhelmed selling. These zones act as high-probability reversal areas when price returns.`;
  }

  sections.push([`**④ HTF STRUCTURE MEANING**`, Wt, htfMeaning].join('\n'));

  // ── 5. LTF EXECUTION BEHAVIOUR ──────────────────────────────
  let ltfMeaning = '';
  if (spideyLTF) {
    const ltfBias = spideyLTF.dominantBias;
    const ltfConv = (spideyLTF.dominantConviction * 100).toFixed(0);
    const ltfSig  = spideyLTF.significantBreak;
    const ltfTFBreakdown = Object.entries(spideyLTF.timeframes)
      .map(([iv, r]) => `${tfLabel(iv)}: **${r.bias}** (${r.structure}, ${(r.conviction*100).toFixed(0)}%)`)
      .join(' · ');

    ltfMeaning = `Lower timeframe structure shows **${ltfBias}** bias at **${ltfConv}% conviction** across ${ltfDisplay}.\n\n${ltfTFBreakdown}\n\n`;

    if (ltfBias === htfBias) {
      ltfMeaning += `**HTF/LTF alignment confirmed** — both timeframe sets agree on direction. This is the highest-probability scenario: the higher timeframe provides the directional authority and the lower timeframe confirms that the immediate price action is moving in harmony with that bias. Entry timing improves significantly when both are aligned.`;
    } else if (ltfBias === 'Neutral') {
      ltfMeaning += `LTF is currently neutral — price is consolidating at the lower timeframe level. This is common before a directional move resolves. Watch for a LTF BOS in the direction of the HTF bias as the confirmation that the consolidation is complete and the move is resuming.`;
    } else {
      ltfMeaning += `**HTF/LTF conflict detected** — higher timeframe is ${htfBias} but lower timeframe is showing ${ltfBias} momentum. This is a retracement phase within the larger trend, not a reversal. The correct read is: the HTF bias remains intact, and the LTF is providing a better entry point by pulling price back toward a demand/supply zone before continuation.`;
    }

    if (ltfSig && ltfSig.lastBreak !== 'None') {
      ltfMeaning += `\n\nThe LTF shows a **${ltfSig.lastBreak}** on **${tfLabel(ltfSig.timeframe)}** at ${fmt(ltfSig.breakLevel)}. ${ltfSig.isEngineered ? 'The engineered nature of this break indicates a stop hunt — institutional actors cleared retail positions before the intended move. This is often a high-quality entry signal.' : 'This structural break confirms the current directional pressure at the execution level.'}`;
    }
  } else {
    // Single mode — use micro
    const micro = spideyMicro;
    ltfMeaning = `**Micro Execution Layer (15M/5M):**\n\n`;
    ltfMeaning += micro.entryConfirmed
      ? `✅ Entry conditions confirmed — LTF ${micro.ltfBreak} aligned with HTF bias. The lower timeframe has provided the structural signal required for execution timing.`
      : micro.inInducement
      ? `⚠️ Inducement zone active — retail stop clusters are positioned above/below current price. Institutional players are likely to sweep these first before the genuine move begins. Do not enter until the sweep completes and a BOS follows.`
      : micro.sweepDetected
      ? `🔄 Liquidity sweep detected on the micro timeframe — institutional grab of retail stops. This is typically the final phase before the directional move. Watch for immediate BOS confirmation.`
      : `⏳ No LTF confirmation yet — ${micro.ltfBias} structure at the micro level, ${micro.alignedWithHTF ? 'aligned with HTF' : 'not yet aligned with HTF'}. Wait for a CHoCH followed by BOS before entry consideration.`;
  }
  sections.push([`**⑤ LTF EXECUTION BEHAVIOUR**`, Wt, ltfMeaning].join('\n'));

  // ── 6. LIQUIDITY & IMBALANCE FLOW ────────────────────────────
  const allLiquidity = [];
  const allImbalances = [];
  for (const [iv, r] of Object.entries(spideyHTF.timeframes)) {
    for (const p of (r.liquidityPools || [])) allLiquidity.push({ ...p, tf: tfLabel(iv) });
    for (const im of (r.imbalances || [])) allImbalances.push({ ...im, tf: tfLabel(iv) });
  }

  let liqSection = `Price is always drawn toward liquidity. The market cannot move without a destination — that destination is almost always a cluster of resting orders, equal highs/lows, or an unfilled imbalance.\n\n`;

  const eqHighs = allLiquidity.filter(p => p.type === 'EQH').slice(0, 3);
  const eqLows  = allLiquidity.filter(p => p.type === 'EQL').slice(0, 3);

  if (eqHighs.length) {
    liqSection += `**Equal Highs (Buy-Side Liquidity):**\n`;
    for (const p of eqHighs) liqSection += `  ${p.tf}: ${fmt(p.level)} — ${p.strength} touches — ${p.proximate ? '⚡ PROXIMATE' : 'beyond current range'}\n`;
    liqSection += '\n';
  }
  if (eqLows.length) {
    liqSection += `**Equal Lows (Sell-Side Liquidity):**\n`;
    for (const p of eqLows) liqSection += `  ${p.tf}: ${fmt(p.level)} — ${p.strength} touches — ${p.proximate ? '⚡ PROXIMATE' : 'beyond current range'}\n`;
    liqSection += '\n';
  }

  const openImbs = allImbalances.slice(0, 4);
  if (openImbs.length) {
    liqSection += `**Open Imbalances (Price Inefficiencies):**\n`;
    for (const im of openImbs) liqSection += `  ${im.tf} ${im.type}: ${fmt(im.low)} – ${fmt(im.high)}\n`;
    liqSection += `\nImbalances represent price ranges where no two-sided trading occurred — the market will return to fill these gaps, usually before continuing the dominant trend. They act as magnets and as potential reversal zones when tagged.`;
  }

  if (!eqHighs.length && !eqLows.length && !openImbs.length) {
    liqSection += `No significant liquidity clusters or open imbalances detected at current analysis depth. Price may be in an area of efficient discovery — directional move may require more structure to develop before a high-probability level presents.`;
  }

  sections.push([`**⑥ LIQUIDITY & IMBALANCE FLOW**`, Wt, liqSection].join('\n'));

  // ── 7. ALIGNMENT VS CONFLICT ─────────────────────────────────
  const conflictState   = jane.conflictState;
  const tsEffect        = jane.trendSpiderEffect;
  const coreyAligned    = coreyResult.alignment;
  const coreyConflict   = coreyResult.contradiction;
  const htfLtfAligned   = !jane.ltfConflict;

  let alignSection = '';
  if (conflictState === 'Aligned') {
    alignSection = `**Full system alignment confirmed.** All three ATLAS engines are reading the same directional signal:\n\n- 🕷️ **Spidey (Structure):** ${spideyHTF.dominantBias} — structural bias confirmed across timeframes\n- 🌍 **Corey (Macro):** ${coreyResult.combinedBias} — macro environment supports the directional thesis\n- 👑 **Jane (Synthesis):** ${jane.finalBias} — final arbitration confirms bias with ${jane.convictionLabel} conviction\n\nWhen all three engines align, the probability of the setup following through is highest. This is the cleanest signal ATLAS produces. Respect it — but still apply the confirmation rules before entry.`;
  } else if (conflictState === 'PartialConflict') {
    alignSection = `**Partial conflict detected — qualified signal.** The engines show a mixed read:\n\n- 🕷️ **Spidey:** ${spideyHTF.dominantBias}\n- 🌍 **Corey:** ${coreyResult.combinedBias}\n- 🕸️ **TrendSpider:** ${coreyResult.trendSpider.signalBias} (${tsEffect})\n- 👑 **Jane:** ${jane.finalBias} at reduced conviction\n\nPartial conflict means the dominant signal is present but not universally confirmed. The operational consequence is reduced position sizing and heightened vigilance around the confirmation trigger. Do not enter at the first sign of the move — wait for the full confirmation sequence before committing capital.`;
  } else {
    alignSection = `**Hard conflict — engines divided.** The ATLAS system has detected a direct conflict between engines that prevents a clean directional call:\n\n- 🕷️ **Spidey:** ${spideyHTF.dominantBias}\n- 🌍 **Corey:** ${coreyResult.combinedBias}\n- 👑 **Jane:** Cannot resolve — DO NOT TRADE\n\nThis is not a system failure. This is the system's most important output — it is telling you that the evidence is genuinely ambiguous and that deploying capital into ambiguity is how losses are manufactured. The correct response is patience. The market will resolve. Wait for it.`;
  }

  if (combined) {
    alignSection += `\n\n**HTF/LTF Relationship:** ${htfLtfAligned ? `✅ Lower timeframe confirms higher timeframe direction — execution timing is valid.` : `⚠️ Lower timeframe is moving counter to the higher timeframe — this is a retracement, not a reversal. Do not trade against the HTF bias on the LTF signal alone.`}`;
  }

  sections.push([`**⑦ ALIGNMENT VS CONFLICT**`, Wt, alignSection].join('\n'));

  // ── 8. DECISION LOGIC ────────────────────────────────────────
  let decisionLogic = '';
  if (jane.doNotTrade) {
    decisionLogic = `The correct action is **stand aside**.\n\nThe evidence does not support capital deployment at this time. This is not a conservative or cautious call — it is the analytically correct position given the current state of the evidence. Trading into a conflicted or ambiguous environment is not aggressive trading, it is undisciplined trading.\n\nThe probability-adjusted expected value of a trade in this environment is negative when accounting for the uncertainty discount. Wait for the market to show its hand clearly.`;
  } else if (jane.finalBias === 'Bullish') {
    decisionLogic = `The correct action is **bias long — wait for confirmation before entry**.\n\nThe weight of evidence supports the bullish thesis. However, entering at current price without the confirmation sequence is premature — it accepts more risk than the setup justifies. The protocol is:\n\n1. Wait for price to reach the demand zone\n2. Observe LTF for CHoCH (first sign of bullish reclaim)\n3. Wait for LTF BOS confirming the reclaim is structural\n4. Enter with stop below invalidation level\n5. Target the identified liquidity pools in sequence\n\nThis sequence ensures you are entering on confirmation, not prediction. Prediction loses. Confirmation wins over time.`;
  } else if (jane.finalBias === 'Bearish') {
    decisionLogic = `The correct action is **bias short — wait for confirmation before entry**.\n\nThe weight of evidence supports the bearish thesis. However, entering at current price without the confirmation sequence is premature. The protocol is:\n\n1. Wait for price to reach the supply zone\n2. Observe LTF for CHoCH (first sign of bearish rejection)\n3. Wait for LTF BOS confirming the rejection is structural\n4. Enter with stop above invalidation level\n5. Target the identified liquidity pools in sequence\n\nSelling into supply after confirmation gives you the structure, the macro, and the execution timing in alignment. That is the institutional edge.`;
  } else {
    decisionLogic = `The correct action is **observe and wait**.\n\nNo directional bias has been established. Neutral market conditions require patience. Deploying capital without a clear directional read means accepting a coin-flip probability — that is not the ATLAS standard.`;
  }
  sections.push([`**⑧ DECISION LOGIC**`, Wt, decisionLogic].join('\n'));

  // ── 9. INVALIDATION LOGIC ────────────────────────────────────
  let invalidationText = '';
  if (jane.invalidationLevel) {
    invalidationText = `The thesis is invalidated by a candle **close** ${jane.finalBias === 'Bullish' ? 'below' : 'above'} **${fmt(jane.invalidationLevel)}**.\n\nThe distinction between a wick and a close is operationally critical:\n\n- A **wick** through the level is a liquidity grab — institutional actors sweeping retail stops. This can actually be a strong entry signal in the right context.\n- A **close** through the level means genuine auction acceptance at the other side of the level — price is being valued there. This is structural invalidation.\n\nWhen invalidation occurs, exit immediately. Do not average. Do not wait for a recovery. The market is telling you the thesis was wrong. Accept the information, protect the capital, and reset.`;
  } else {
    invalidationText = `No hard invalidation level identified at current analysis depth. Manage the position using the structural logic — if price begins making lower highs and lower lows in a bullish setup (or higher highs in a bearish setup), the thesis is deteriorating and risk should be reduced.`;
  }
  sections.push([`**⑨ INVALIDATION LOGIC**`, Wt, invalidationText].join('\n'));

  // ── 10. TACTICAL SUMMARY ─────────────────────────────────────
  let tacticalSummary = '';
  if (jane.doNotTrade) {
    tacticalSummary = `**What to do:** Observe only. Keep this instrument on your watchlist.\n\n**What not to do:** Do not force a trade because you want to be in the market. The best trade is sometimes no trade.\n\n**What must happen:** Structural resolution — a clean BOS or CHoCH that establishes unambiguous directional bias across the relevant timeframes. When that occurs, re-run the full ATLAS analysis chain and evaluate again.\n\n**Probability improves when:** Price reaches ${spideyHTF.nearestDraw ? `the ${spideyHTF.nearestDraw.type} at ${fmt(spideyHTF.nearestDraw.level)}` : 'a significant structural level'} and produces a clear reaction with LTF confirmation.`;
  } else {
    tacticalSummary = `**What to do:** Monitor for the confirmation trigger — CHoCH followed by BOS in the direction of the ${jane.finalBias} bias. Have your order levels defined before price reaches the zone so execution is mechanical, not emotional.\n\n**What not to do:** Do not enter before the confirmation sequence is complete. Do not move your stop loss further away if the trade initially moves against you. Do not hold through invalidation.\n\n**What must happen before capital is deployed:** Price must reach the entry zone (${jane.entryZone ? `${fmt(jane.entryZone.low)} – ${fmt(jane.entryZone.high)}` : 'TBC'}), produce a LTF structural confirmation, and close through the BOS level.\n\n**Probability improves when:** ${jane.finalBias === 'Bullish' ? `Price sweeps any equal lows below the entry zone (liquidity grab) before reversing — this is the highest-probability entry context. The sweep confirms institutional accumulation.` : `Price sweeps any equal highs above the entry zone before reversing — this is the highest-probability entry context. The sweep confirms institutional distribution.`}`;

    if (jane.branches && jane.branches.length > 0) {
      tacticalSummary += `\n\n**IF/THEN Decision Branches:**`;
      for (const b of jane.branches) tacticalSummary += `\n▸ ${b}`;
    }
  }

  sections.push([`**⑩ TACTICAL SUMMARY**`, Wt, tacticalSummary].join('\n'));

  // ── FOOTER ───────────────────────────────────────────────────
  sections.push([
    Wt,
    `⚡ **ATLAS FX v3.2** · 🕷️ Spidey · 🌍 Corey · 👑 Jane`,
    `*Analysis generated at ${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Perth', timeZoneName: 'short' })} — market conditions change. Re-run on major structural events.*`,
  ].join('\n'));

  return sections.join('\n\n');
}

// ── CHUNK FUNCTION — 1800 CHAR MAX ────────────────────────────
function chunkMessage(text, maxLen = 1800) {
  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > maxLen) {
    // Prefer splitting on double newline (section boundary)
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt < 600) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < 1)   splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining.length > 0) chunks.push(remaining.trim());
  return chunks;
}

// ── DELIVER RESULT — IMAGES → TRADE BLOCK → ANALYSIS CHUNKS ──
async function deliverResult(msg, result) {
  const { symbol, htfGridBuf, ltfGridBuf, htfGridName, ltfGridName, combined, htfDisplay, ltfDisplay } = result;
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

  // 3. Trade Block — single message, execution-first
  const tradeBlock = formatTradeBlock(result);
  const tradeChunks = chunkMessage(tradeBlock);
  for (const chunk of tradeChunks) {
    await msg.channel.send({ content: chunk });
  }

  // 4. Analysis Block — deep walkthrough, chunked at 1800 chars
  const analysisBlock = formatAnalysisBlock(result);
  const analysisChunks = chunkMessage(analysisBlock);
  for (let i = 0; i < analysisChunks.length; i++) {
    const isLast    = i === analysisChunks.length - 1;
    const payload   = { content: analysisChunks[i] };
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
const RUNNING = new Set();
function isLocked(s) { return RUNNING.has(s); }
function lock(s)     { RUNNING.add(s); }
function unlock(s)   { RUNNING.delete(s); }

const queue = []; let queueRunning = false;
function enqueue(job) { queue.push(job); void runQueue(); }
async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (queue.length > 0) { const job = queue.shift(); try { await job(); } catch (e) { log('ERROR', '[QUEUE]', e.message); } }
  queueRunning = false;
}

// ============================================================
// DISCORD DELIVERY
// ============================================================

const SHARE_CACHE = new Map();
function cacheForShare(k, d) { SHARE_CACHE.set(k, { ...d, expiresAt: Date.now() + CACHE_TTL_MS }); }
setInterval(() => { const n = Date.now(); for (const [k, v] of SHARE_CACHE.entries()) { if (v.expiresAt < n) SHARE_CACHE.delete(k); } }, 60000);

async function safeReply(msg, payload) { try { return await msg.reply(payload); } catch (e) { log('ERROR', '[REPLY]', e.message); return null; } }
async function safeEdit(msg, payload)  { try { return await msg.edit(payload);  } catch (e) { log('ERROR', '[EDIT]',  e.message); return null; } }

// Split a long string into chunks that respect Discord's 4000-char limit
// Splits on double-newline boundaries where possible
function chunkMessage(text, maxLen = 3900) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt < 1000) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < 1) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining.length > 0) chunks.push(remaining.trim());
  return chunks;
}

async function deliverResult(msg, result) {
  const { htfGridBuf, ltfGridBuf, htfGridName, ltfGridName, combined } = result;
  const fullText = formatDiscordMessage(result);
  const cacheKey = `${msg.id}_${Date.now()}`;
  cacheForShare(cacheKey, result);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`share_${cacheKey}`).setLabel('Share to #shared-macros').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noshare_${cacheKey}`).setLabel('Keep private').setStyle(ButtonStyle.Secondary),
  );

  // Send HTF grid first
  const htfFiles = [new AttachmentBuilder(htfGridBuf, { name: htfGridName })];
  await msg.channel.send({ content: `📡 **${result.symbol} — HTF** \u200b*(Weekly · Daily · 4H · 1H)*`, files: htfFiles });

  // Send LTF grid if combined
  if (combined && ltfGridBuf) {
    const ltfFiles = [new AttachmentBuilder(ltfGridBuf, { name: ltfGridName })];
    await msg.channel.send({ content: `🔬 **${result.symbol} — LTF** \u200b*(30M · 15M · 5M · 1M)*`, files: ltfFiles });
  }

  // Chunk and send the macro text
  const chunks = chunkMessage(fullText);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const payload = { content: chunks[i] };
    if (isLast) payload.components = [row];
    await msg.channel.send(payload);
  }
}

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

  const group = CHANNEL_GROUP_MAP[msg.channel.id];
  if (!group) return;

  const parsed = parseCommand(raw);
  if (!parsed || parsed.action !== 'chart') return;
  if (parsed.parseError) { await safeReply(msg, `⚠️ ${parsed.parseError}`); return; }

  const { symbol, mode, htfIntervals, ltfIntervals, combined, customTFs } = parsed;
  if (isLocked(symbol)) { await safeReply(msg, `⚠️ **${symbol}** is already generating — please wait.`); return; }
  lock(symbol);

  enqueue(async () => {
    const modeLabel = combined ? 'HTF + LTF' : (mode === 'H' ? 'HTF' : 'LTF');
    const htfDisplay = htfIntervals.map(tfLabel).join(' · ');
    const ltfDisplay = ltfIntervals.map(tfLabel).join(' · ');

    log('INFO', `[CMD] ${msg.author.username} / ${group} → ${symbol} ${modeLabel}`);

    const progressLines = [
      `⏳ **${symbol}** ${modeLabel} — full institutional analysis running...`,
      combined
        ? `📡 HTF: ${htfDisplay}\n🔬 LTF: ${ltfDisplay}`
        : `⏱ ${htfDisplay}`,
      `🕷️ Spidey (HTF${combined ? ' + LTF' : ''}) · 🌍 Corey · 🕸️ TrendSpider · 👑 Jane`,
      `📊 Generating full institutional macro brief...`,
    ];
    const progress = await safeReply(msg, progressLines.join('\n'));

    try {
      const result = await runFullPipeline(symbol, mode, htfIntervals, ltfIntervals, combined, customTFs);
      if (progress) { try { await progress.delete(); } catch (_) {} }
      await deliverResult(msg, result);
    } catch (err) {
      log('ERROR', `[CMD FAIL] ${symbol}:`, err.message);
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
