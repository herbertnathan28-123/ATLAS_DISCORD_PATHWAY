global.archiveRender = async () => {};
'use strict';
// ============================================================
// ATLAS FX DISCORD BOT — FULL INTELLIGENCE ENGINE v3.1
// ============================================================
// v3.1 merges the ATLAS Core Engine v3.0 macro layer into the
// original working Discord bot. Chart rendering, Playwright,
// Discord client, message handler and pipeline are all restored.
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
const TOKEN     = process.env.DISCORD_BOT_TOKEN;
const TV_LAYOUT = process.env.TV_LAYOUT_ID || 'GmNAOGhI';
if (!TOKEN) { console.error('[FATAL] Missing DISCORD_BOT_TOKEN'); process.exit(1); }

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

console.log(`[BOOT] ATLAS FX v3.1 starting... auth:${TV_COOKIES ? 'COOKIE' : 'GUEST'} trendspider:${TS_ENABLED ? 'ENABLED' : 'DISABLED'}`);

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
// CORE ENGINE v3.0 — CONSTANTS + HELPERS
// ============================================================

const EPSILON = 1e-9;

const BIAS = Object.freeze({ BULLISH: 'Bullish', BEARISH: 'Bearish', NEUTRAL: 'Neutral' });
const RISK_ENV = Object.freeze({ RISK_ON: 'RiskOn', RISK_OFF: 'RiskOff', NEUTRAL: 'Neutral' });
const REGIME = Object.freeze({ EXPANSION: 'Expansion', GROWTH: 'Growth', TRANSITION: 'Transition', CONTRACTION: 'Contraction', CRISIS: 'Crisis', NEUTRAL: 'Neutral' });
const ASSET_CLASS = Object.freeze({ FX: 'FX', EQUITY: 'Equity', COMMODITY: 'Commodity', INDEX: 'Index', UNKNOWN: 'Unknown' });
const STANCE = Object.freeze({ HAWKISH: 'Hawkish', DOVISH: 'Dovish', NEUTRAL: 'Neutral', N_A: 'N/A' });
const RATE_CYCLE = Object.freeze({ HIKING: 'Hiking', CUTTING: 'Cutting', HOLDING: 'Holding', N_A: 'N/A' });
const GRADE = Object.freeze({ A: 'A', B: 'B', C: 'C', D: 'D', NONE: 'NONE' });

const THRESHOLDS = Object.freeze({
  macroBullish: 0.15, macroBearish: -0.15,
  fxBullish: 0.20, fxBearish: -0.20,
  strongConfidence: 0.60, moderateConfidence: 0.30,
  tsStrong: 0.65, tsWeak: 0.25,
  tradeValidConfidence: 0.45,
});

const FX_QUOTES = new Set(['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF','SEK','NOK','DKK','SGD','HKD','CNH','CNY']);
const EQUITY_SYMBOLS = new Set(['AMD','MU','ASML','MICRON','NVDA','AVGO','TSM','QCOM','AAPL','MSFT','META','GOOGL','AMZN','TSLA','INTC']);
const COMMODITY_SYMBOLS = new Set(['XAUUSD','XAGUSD','XAUEUR','XAGEUR','USOIL','WTI','BRENT','BCOUSD','NATGAS']);
const INDEX_SYMBOLS = new Set(['NAS100','US500','US30','GER40','UK100','HK50','JPN225','SPX','NDX','DJI']);
const SEMI_SYMBOLS = new Set(['AMD','MU','ASML','MICRON','NVDA','AVGO','TSM','QCOM','INTC']);

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
  USD: { name: 'Federal Reserve',                    stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.90, growthSensitivity: 0.80 },
  EUR: { name: 'European Central Bank',              stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.85, growthSensitivity: 0.70 },
  GBP: { name: 'Bank of England',                   stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.90, growthSensitivity: 0.75 },
  JPY: { name: 'Bank of Japan',                     stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.65, growthSensitivity: 0.60 },
  AUD: { name: 'Reserve Bank of Australia',         stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.85, growthSensitivity: 0.80 },
  NZD: { name: 'Reserve Bank of New Zealand',       stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.85, growthSensitivity: 0.75 },
  CAD: { name: 'Bank of Canada',                    stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.85, growthSensitivity: 0.75 },
  CHF: { name: 'Swiss National Bank',               stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.75, growthSensitivity: 0.65 },
  SEK: { name: 'Riksbank',                          stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.75, growthSensitivity: 0.65 },
  NOK: { name: 'Norges Bank',                       stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.80, growthSensitivity: 0.70 },
  DKK: { name: 'Danmarks Nationalbank',             stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.70, growthSensitivity: 0.65 },
  SGD: { name: 'Monetary Authority of Singapore',   stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.80, growthSensitivity: 0.75 },
  HKD: { name: 'Hong Kong Monetary Authority',      stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.70, growthSensitivity: 0.65 },
  CNH: { name: "People's Bank of China Offshore",   stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.60, growthSensitivity: 0.85 },
  CNY: { name: "People's Bank of China",            stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0, inflationSensitivity: 0.60, growthSensitivity: 0.85 },
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
function clamp(v, min = -1, max = 1) { return Number.isFinite(v) ? Math.min(Math.max(v, min), max) : 0; }
function clamp01(v) { return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0; }
function round2(v) { if (!Number.isFinite(v)) return 0; return Math.round((v + EPSILON) * 100) / 100; }
function average(arr) { const f = arr.filter(Number.isFinite); return f.length ? f.reduce((s, v) => s + v, 0) / f.length : 0; }
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
function gradeFromConf(c) { return c >= 0.80 ? GRADE.A : c >= 0.60 ? GRADE.B : c >= 0.30 ? GRADE.C : c > 0 ? GRADE.D : GRADE.NONE; }
function safeCountry(ccy) { return CURRENCY_COUNTRY[ccy]?.country || ccy; }

function normalizeSymbolCore(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }

function isFxPair(s) {
  if (s.length !== 6) return false;
  return FX_QUOTES.has(s.slice(0, 3)) && FX_QUOTES.has(s.slice(3, 6));
}

function inferAssetClass(s) {
  if (EQUITY_SYMBOLS.has(s)) return ASSET_CLASS.EQUITY;
  if (COMMODITY_SYMBOLS.has(s)) return ASSET_CLASS.COMMODITY;
  if (INDEX_SYMBOLS.has(s)) return ASSET_CLASS.INDEX;
  if (isFxPair(s)) return ASSET_CLASS.FX;
  if (/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s)) return ASSET_CLASS.COMMODITY;
  if (/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s)) return ASSET_CLASS.INDEX;
  if (/^[A-Z]{1,5}$/.test(s)) return ASSET_CLASS.EQUITY;
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
  const bl = CENTRAL_BANKS[ccy];
  if (!bl) return makeStubCB('Unknown');
  const out = deepClone(bl);
  out.score = cbDirectionScore(out);
  return out;
}

// ── ECONOMIC STRENGTH ENGINE ──────────────────────────────────
function assessEconomicStrength(currency) {
  const ccy = normalizeSymbolCore(currency);
  const bl = ECONOMIC_BASELINES[ccy] || makeStubEcon();
  const econ = {
    gdpMomentum:       clamp01(bl.gdpMomentum),
    employment:        clamp01(bl.employment),
    inflationControl:  clamp01(bl.inflationControl),
    fiscalPosition:    clamp01(bl.fiscalPosition),
    politicalStability:clamp01(bl.politicalStability),
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
    dxyBias: dxyScore > 0.10 ? BIAS.BULLISH : dxyScore < -0.10 ? BIAS.BEARISH : BIAS.NEUTRAL,
    riskScore,
    riskEnv: riskScore > 0.12 ? RISK_ENV.RISK_ON : riskScore < -0.12 ? RISK_ENV.RISK_OFF : RISK_ENV.NEUTRAL,
    context: c,
    confidence: round2(clamp01(average([Math.abs(dxyScore), Math.abs(riskScore)]))),
  };
}

// ── REGIME / VOLATILITY / LIQUIDITY ──────────────────────────
function detectMarketRegime(global) {
  let regime = REGIME.NEUTRAL;
  if      (global.riskEnv === RISK_ENV.RISK_ON  && global.dxyBias === BIAS.BEARISH)  regime = REGIME.EXPANSION;
  else if (global.riskEnv === RISK_ENV.RISK_OFF && global.dxyBias === BIAS.BULLISH)  regime = REGIME.CRISIS;
  else if (global.riskEnv === RISK_ENV.RISK_ON)  regime = REGIME.GROWTH;
  else if (global.riskEnv === RISK_ENV.RISK_OFF) regime = REGIME.CONTRACTION;
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
    if (global.dxyBias === BIAS.BULLISH) score -= 0.18;
    if (global.dxyBias === BIAS.BEARISH) score += 0.10;
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
    if (global.dxyBias === BIAS.BEARISH) score += 0.06;
    if (global.dxyBias === BIAS.BULLISH) score -= 0.06;
    notes.push('Index beta weighted');
  }
  return { sector, score: round2(clamp(score)), notes };
}

function getAssetSpecificAdjustments(symbol, global) {
  const s = normalizeSymbolCore(symbol);
  const ac = inferAssetClass(s);
  const sectorInfo = assessSectorStrength(s, global);
  let score = sectorInfo.score;
  const notes = [...sectorInfo.notes];

  if (ac === ASSET_CLASS.EQUITY) {
    if (global.riskEnv === RISK_ENV.RISK_ON)  { score += 0.25; notes.push('Risk-on supports equities'); }
    if (global.riskEnv === RISK_ENV.RISK_OFF) { score -= 0.25; notes.push('Risk-off pressures equities'); }
    if (global.dxyBias === BIAS.BEARISH) { score += 0.10; notes.push('Weak USD supports risk assets'); }
    if (global.dxyBias === BIAS.BULLISH) { score -= 0.10; notes.push('Strong USD pressures risk assets'); }
  }
  if (ac === ASSET_CLASS.COMMODITY && s === 'XAUUSD') {
    if (global.riskEnv === RISK_ENV.RISK_OFF) score += 0.24;
    if (global.dxyBias === BIAS.BULLISH) score -= 0.12;
    if (global.dxyBias === BIAS.BEARISH) score += 0.10;
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
  if (regime.regime === REGIME.CRISIS)     adj *= 0.85;
  if (regime.regime === REGIME.EXPANSION)  adj *= 1.05;
  adj += sector.score * 0.20;
  return round2(clamp(adj));
}

// ── COREY MACRO ENGINE (v3.0) ─────────────────────────────────
async function runCoreyMacro(symbol, marketContext = {}) {
  const parsed = parsePairCore(symbol);
  const { base, quote, assetClass } = parsed;
  const global = await assessGlobalMacro(marketContext);
  const regime = detectMarketRegime(global);
  const volatility = computeVolatilityProfile(global);
  const liquidity = assessLiquidity(global);

  const isNonFx = assetClass !== ASSET_CLASS.FX;

  if (isNonFx) {
    const assetAdj = getAssetSpecificAdjustments(parsed.symbol, global);
    const baseCB   = makeStubCB(assetAdj.assetClass);
    const baseEcon = makeStubEcon();
    const quoteCB  = assessCentralBankStance(quote);
    const quoteEcon = assessEconomicStrength(quote);

    let macroScore = assetAdj.score;
    const adjustedScore = applyAdvancedAdjustments(macroScore, assetAdj.sectorInfo, volatility, liquidity, regime);
    const macroBias  = scoreToBias(adjustedScore);
    const confidence = round2(clamp01(Math.abs(adjustedScore)));

    return {
      symbol: parsed.symbol, assetClass: assetAdj.assetClass,
      base:  { currency: base,  country: base,  cb: baseCB,  econ: baseEcon,  weight: 0.50 },
      quote: { currency: quote, country: safeCountry(quote), cb: quoteCB, econ: quoteEcon, weight: CURRENCY_COUNTRY[quote]?.weight || 0.50 },
      global, regime, volatility, liquidity,
      sector: assetAdj.sectorInfo,
      macroScore: adjustedScore, macroBias, confidence,
      reasoning: assetAdj.notes, parsed,
    };
  }

  // FX path
  const baseCB    = assessCentralBankStance(base);
  const quoteCB   = assessCentralBankStance(quote);
  const baseEcon  = assessEconomicStrength(base);
  const quoteEcon = assessEconomicStrength(quote);

  let macroScore = 0;
  macroScore += (baseEcon.composite - quoteEcon.composite) * 0.80;
  macroScore += (baseCB.score - quoteCB.score) * 1.00;
  if (parsed.quote === 'USD') { if (global.dxyBias === BIAS.BULLISH) macroScore -= 0.15; if (global.dxyBias === BIAS.BEARISH) macroScore += 0.15; }
  if (parsed.base  === 'USD') { if (global.dxyBias === BIAS.BULLISH) macroScore += 0.15; if (global.dxyBias === BIAS.BEARISH) macroScore -= 0.15; }
  if (global.riskEnv === RISK_ENV.RISK_OFF) { if (['JPY','CHF','USD'].includes(base)) macroScore += 0.05; if (['JPY','CHF','USD'].includes(quote)) macroScore -= 0.05; }
  if (global.riskEnv === RISK_ENV.RISK_ON)  { if (['AUD','NZD','CAD'].includes(base)) macroScore += 0.05; if (['AUD','NZD','CAD'].includes(quote)) macroScore -= 0.05; }
  macroScore = round2(clamp(macroScore));

  const sectorStub = { sector: 'FX', score: 0, notes: [] };
  const adjustedScore = applyAdvancedAdjustments(macroScore, sectorStub, volatility, liquidity, regime);
  const macroBias  = scoreToBias(adjustedScore, THRESHOLDS.fxBullish, THRESHOLDS.fxBearish);
  const confidence = round2(clamp01(Math.abs(adjustedScore)));

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

// ── SYMBOL MAPS (chart engine) ────────────────────────────────
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
  XAUUSD: 'OANDA:XAUUSD',   XAGUSD: 'OANDA:XAGUSD',
  BCOUSD: 'OANDA:BCOUSD',   USOIL:  'OANDA:BCOUSD',
  NAS100: 'OANDA:NAS100USD', US500:  'OANDA:SPX500USD',
  US30:   'OANDA:US30USD',   GER40:  'OANDA:DE30EUR',
  UK100:  'OANDA:UK100GBP',  NATGAS: 'NYMEX:NG1!',
  MICRON: 'NASDAQ:MU',       AMD:    'NASDAQ:AMD',
  ASML:   'NASDAQ:ASML',
};
const CORRELATION_MAP = {
  EURUSD: { positive: ['GBPUSD','AUDUSD','NZDUSD'], negative: ['USDCHF','USDJPY','DXY'] },
  GBPUSD: { positive: ['EURUSD','AUDUSD'],          negative: ['USDCHF','USDJPY'] },
  USDJPY: { positive: ['USDCHF','USDCAD'],          negative: ['EURUSD','GBPUSD','XAUUSD'] },
  AUDUSD: { positive: ['NZDUSD','EURUSD'],          negative: ['USDJPY','USDCAD'] },
  XAUUSD: { positive: ['XAGUSD','AUDUSD'],          negative: ['USDJPY','DXY'] },
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
const DEFAULT_TIMEFRAMES = { H: ['1W','1D','240','60'], L: ['240','60','15','1'] };
const TF_LABELS = { '1W':'Weekly','1D':'Daily','240':'4H','120':'2H','60':'1H','30':'30M','15':'15M','5':'5M','3':'3M','1':'1M' };
const TF_RESOLUTION = { '1W':'W','1D':'D','240':'240','120':'120','60':'60','30':'30','15':'15','5':'5','3':'3','1':'1' };
function resolveTF(input) { return TF_MAP[input.toLowerCase().trim()] || null; }
function parseCustomTFs(s) { const p = s.split(',').map((x) => x.trim()); if (p.length !== 4) return null; const r = p.map(resolveTF); return r.includes(null) ? null : r; }
function tfLabel(iv) { return TF_LABELS[iv] || iv; }

// ── COMMAND PARSER ────────────────────────────────────────────
function parseCommand(content) {
  const trimmed = (content || '').trim();
  if (trimmed === '!ping') return { action: 'ping' };
  const m = trimmed.match(/^!([A-Z0-9]{2,12})([LH])(?:\s+([^\s].*))?$/i);
  if (!m) return null;
  const rawSymbol = m[1], mode = m[2].toUpperCase(), tfString = m[3] ? m[3].trim() : null;
  const symbol = resolveSymbol(rawSymbol);
  let intervals = DEFAULT_TIMEFRAMES[mode], customTFs = false, parseError = null;
  if (tfString) {
    const parsed = parseCustomTFs(tfString);
    if (parsed) { intervals = parsed; customTFs = true; }
    else parseError = `Invalid timeframes: \`${tfString}\`\nFormat: 4 comma-separated values e.g. \`4,1,15,1\``;
  }
  return { action: 'chart', rawSymbol, symbol, mode, intervals, customTFs, parseError };
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
  if (v.includes('break'))  return 'Breakout';
  if (v.includes('revers')) return 'Reversal';
  if (v.includes('continu')) return 'Continuation';
  if (v.includes('warn'))   return 'Warning';
  if (v.includes('pattern')) return 'Pattern';
  if (v.includes('scan'))   return 'Scanner';
  return 'Unknown';
}

function tsNormalisePayload(raw, receiveTime) {
  const symbol = (raw.symbol || raw.ticker || raw.pair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const resolvedSymbol = resolveSymbol(symbol) || symbol;
  const direction  = tsNormaliseDirection(raw.direction || raw.trend || raw.signal || '');
  const signalType = tsNormaliseSignalType(raw.signal_type || raw.signal || raw.strategy || raw.scanner || '');
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
          const raw = JSON.parse(body);
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
// OHLC DATA FETCHER
// ============================================================

function fetchOHLC(symbol, resolution, count = 200) {
  return new Promise((resolve, reject) => {
    const tvSym = encodeURIComponent(getTVSymbol(symbol));
    const res   = TF_RESOLUTION[resolution] || resolution;
    const to    = Math.floor(Date.now() / 1000);
    const from  = to - (count * 14 * 24 * 3600);
    const options = {
      hostname: 'history.tradingview.com',
      path:     `/history?symbol=${tvSym}&resolution=${res}&from=${from}&to=${to}&countback=${count}`,
      method:   'GET',
      headers:  { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Origin': 'https://www.tradingview.com', 'Referer': 'https://www.tradingview.com/' },
      timeout:  15000,
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; });
      r.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (!p.t || p.s !== 'ok') { reject(new Error(`TV API: ${p.s || 'unknown'}`)); return; }
          resolve(p.t.map((time, i) => ({ time, open: p.o[i], high: p.h[i], low: p.l[i], close: p.c[i], volume: p.v ? p.v[i] : 0 })));
        } catch (e) { reject(new Error(`TV API parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('TV API timeout')));
    req.end();
  });
}

async function safeOHLC(symbol, resolution, count = 200) {
  try { return await fetchOHLC(symbol, resolution, count); }
  catch (e) { log('WARN', `[OHLC] ${symbol} ${resolution}: ${e.message}`); return null; }
}

// ============================================================
// 🕷️ SPIDEY — STRUCTURE INTELLIGENCE ENGINE
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
    if (isLow)  swingLows.push({ index: i, level: c.low,  time: c.time });
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
  const bull = (hhC + hlC) / total, bear = (lhC + llC) / total;
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
  const last = candles[candles.length - 1], prev20 = candles.slice(-20);
  const lastSH = swingHighs[swingHighs.length - 1], lastSL = swingLows[swingLows.length - 1];
  const prev5 = prev20.slice(-5), rHigh = Math.max(...prev5.map((c) => c.high)), rLow = Math.min(...prev5.map((c) => c.low));
  const bullBOS = last.close > lastSH.level, bearBOS = last.close < lastSL.level;
  const bullCHoCH = last.close > rHigh && !bullBOS, bearCHoCH = last.close < rLow && !bearBOS;
  const wickAbove = prev20.some((c) => c.high > lastSH.level && c.close <= lastSH.level);
  const wickBelow = prev20.some((c) => c.low < lastSL.level  && c.close >= lastSL.level);
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
    const base = candles[i], impulse = candles.slice(i + 1, i + 4);
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
  return pools.sort((a, b) => b.strength - a.strength).map((p) => ({ ...p, proximate: Math.abs(p.level - cp) / cp < 0.005 })).slice(0, 6);
}

async function runSpideyHTF(symbol, intervals) {
  log('INFO', `[SPIDEY-HTF] ${symbol} [${intervals.join(',')}]`);
  const results = {};
  const tfWeights = { '1W': 4, '1D': 3, '240': 2, '60': 1 };
  for (const iv of intervals) {
    const candles = await safeOHLC(symbol, iv, 200);
    if (!candles || candles.length < 20) { results[iv] = { bias: 'Neutral', structure: 'No data', conviction: 0, lastBreak: 'None', currentPrice: 0 }; continue; }
    const { swingHighs, swingLows } = detectSwings(candles, 3);
    const structure  = classifyStructure(swingHighs, swingLows);
    const breaks     = detectBreaks(candles, swingHighs, swingLows);
    const zones      = detectZones(candles);
    const imbalances = detectImbalances(candles);
    const liquidity  = detectLiquidity(candles);
    results[iv] = { bias: structure.bias, structure: structure.structure, conviction: Math.round(structure.conviction * 100) / 100, lastBreak: breaks.lastBreak, breakDirection: breaks.direction, breakLevel: breaks.breakLevel, isEngineered: breaks.isEngineered, activeSupply: zones.supply[0] || null, activeDemand: zones.demand[0] || null, imbalances, liquidityPools: liquidity, swingHighs: swingHighs.slice(-3), swingLows: swingLows.slice(-3), currentPrice: candles[candles.length - 1].close };
  }
  let wScore = 0, wTotal = 0;
  for (const [iv, r] of Object.entries(results)) {
    const w = tfWeights[iv] || 1, s = r.bias === 'Bullish' ? 1 : r.bias === 'Bearish' ? -1 : 0;
    wScore += s * w * r.conviction; wTotal += w;
  }
  const norm = wTotal > 0 ? wScore / wTotal : 0;
  const dominantBias = norm > 0.2 ? 'Bullish' : norm < -0.2 ? 'Bearish' : 'Neutral';
  const dominantConviction = Math.min(Math.abs(norm), 1);
  const allBreaks = Object.entries(results).filter(([, r]) => r.lastBreak !== 'None').map(([iv, r]) => ({ ...r, timeframe: iv, weight: tfWeights[iv] || 1 })).sort((a, b) => b.weight - a.weight);
  const significantBreak = allBreaks[0] || null;
  const currentPrice = results[intervals[0]]?.currentPrice || 0;
  let nearestDraw = null;
  for (const [, r] of Object.entries(results)) { const liq = r.liquidityPools?.find((p) => p.proximate); if (liq) { nearestDraw = liq; break; } }
  const summary = buildSpideySummaryHTF(dominantBias, dominantConviction, significantBreak, intervals);
  log('INFO', `[SPIDEY-HTF] ${symbol} → ${dominantBias} (${dominantConviction.toFixed(2)})`);
  return { timeframes: results, dominantBias, dominantConviction, significantBreak, nearestDraw, currentPrice, summary };
}

async function runSpideyMicro(symbol, htfBias) {
  const m15 = await safeOHLC(symbol, '15', 100), m5 = await safeOHLC(symbol, '5', 100);
  if (!m15 || !m5) return { entryConfirmed: false, ltfBias: 'No data', sweepDetected: false, inInducement: false, ltfBreak: 'None', ltfBreakLevel: null, alignedWithHTF: false, summary: 'Insufficient LTF data' };
  const m15S = detectSwings(m15, 2), m15St = classifyStructure(m15S.swingHighs, m15S.swingLows), m15B = detectBreaks(m15, m15S.swingHighs, m15S.swingLows);
  const m5S  = detectSwings(m5,  2), m5B  = detectBreaks(m5,  m5S.swingHighs,  m5S.swingLows);
  const ltfSweep = m15B.isEngineered || m5B.isEngineered;
  const rH15 = m15S.swingHighs.slice(-3);
  const inInducement = rH15.filter((h, i) => rH15.some((h2, j) => j !== i && Math.abs(h.level - h2.level) / h.level < 0.001)).length > 0;
  const alignedWithHTF = m15St.bias === htfBias;
  const entryConfirmed = alignedWithHTF && (m15B.lastBreak === 'BOS' || m15B.lastBreak === 'CHoCH') && !inInducement;
  return { entryConfirmed, ltfBias: m15St.bias, ltfConviction: m15St.conviction, sweepDetected: ltfSweep, inInducement, ltfBreak: m15B.lastBreak, ltfBreakLevel: m15B.breakLevel, alignedWithHTF, m5Break: m5B.lastBreak, summary: buildMicroSummary(entryConfirmed, m15St, m15B, ltfSweep, inInducement) };
}

function buildSpideySummaryHTF(bias, conviction, sig, intervals) {
  const tier = conviction > 0.7 ? 'Strong' : conviction > 0.4 ? 'Moderate' : 'Weak';
  const br = sig ? `${sig.lastBreak}${sig.isEngineered ? ' (engineered)' : ''} on ${tfLabel(sig.timeframe)} at ${sig.breakLevel?.toFixed(5) || 'N/A'}` : 'No significant break';
  return `${tier} ${bias} across ${intervals.length} TFs. ${br}.`;
}
function buildMicroSummary(confirmed, st, br, sweep, ind) {
  if (ind)       return 'Caution: Inducement zone detected — potential trap. Wait for sweep + LTF BOS.';
  if (sweep)     return `Sweep detected. ${confirmed ? 'Entry conditions met.' : 'Wait for BOS.'}`;
  if (confirmed) return `LTF ${br.lastBreak} confirmed. Execution aligned with HTF.`;
  return `No LTF confirmation. ${st.bias} ${st.structure}.`;
}

// ============================================================
// 🌍 COREY — MACRO + TRENDSPIDER INTELLIGENCE ENGINE
// ============================================================

async function runCoreyTrendSpider(symbol) {
  if (!TS_ENABLED) return { available: false, fresh: false, signalBias: 'Neutral', signalType: 'None', pattern: null, strategy: null, scanner: null, strength: 0, confidence: 0, ageMs: null, status: 'Unavailable', grade: 'Unusable', summary: 'TrendSpider disabled' };
  const signal = tsGetSignal(symbol);
  if (!signal) return { available: false, fresh: false, signalBias: 'Neutral', signalType: 'None', pattern: null, strategy: null, scanner: null, strength: 0, confidence: 0, ageMs: null, status: 'Unavailable', grade: 'Unusable', summary: 'No TrendSpider signal available' };
  const now = Date.now(), grade = tsGradeSignal(signal, now), ageMs = now - signal.timestamp, fresh = grade === 'FreshHigh' || grade === 'FreshMedium';
  if (!fresh) return { available: true, fresh: false, signalBias: signal.direction, signalType: signal.signalType, pattern: signal.pattern, strategy: signal.strategy, scanner: signal.scanner, strength: signal.strength, confidence: signal.confidence, ageMs, status: 'Stale', grade, summary: `Stale TrendSpider signal (${Math.round(ageMs / 60000)}m old) — ignored` };
  let directionMatchesPrice = null, priceDistanceFromSignal = null;
  const candles = await safeOHLC(symbol, '1D', 10);
  if (candles && candles.length >= 3 && signal.price) {
    const currentPrice = candles[candles.length - 1].close;
    priceDistanceFromSignal = ((currentPrice - signal.price) / signal.price) * 100;
    const priceDir = currentPrice > candles[0].close ? 'Bullish' : currentPrice < candles[0].close ? 'Bearish' : 'Neutral';
    directionMatchesPrice = (signal.direction === priceDir) || (priceDir === 'Neutral');
  }
  const status = (grade === 'FreshHigh' || grade === 'FreshMedium') ? 'Active' : 'WeakSignal';
  const ageStr = ageMs < 3600000 ? `${Math.round(ageMs / 60000)}m` : `${(ageMs / 3600000).toFixed(1)}h`;
  const summary = `${grade} ${signal.direction} ${signal.signalType}${signal.pattern ? ` — ${signal.pattern}` : ''} (${ageStr} old, strength ${(signal.strength * 100).toFixed(0)}%)`;
  log('INFO', `[COREY-TS] ${symbol} ${signal.direction} ${signal.signalType} grade:${grade}`);
  return { available: true, fresh, signalBias: signal.direction, signalType: signal.signalType, pattern: signal.pattern, strategy: signal.strategy, scanner: signal.scanner, strength: signal.strength, confidence: signal.confidence, ageMs, directionMatchesPrice, priceDistanceFromSignal, status, grade, summary };
}

async function runCoreyCorrelation(symbol) {
  const corrs = CORRELATION_MAP[symbol];
  if (!corrs) return { positive: [], negative: [], divergent: [], symbolBias: 'Neutral', summary: `No correlation map for ${symbol}` };
  const symCandles = await safeOHLC(symbol, '1D', 30);
  let symbolBias = 'Neutral';
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

  const biasScores = { Bullish: 1, Neutral: 0, Bearish: -1 };
  const internalScore = biasScores[macroBias] * confidence;
  let tsScore = 0, tsEffect = 'Unavailable';
  if (tsResult.available && tsResult.fresh && (tsResult.grade === 'FreshHigh' || tsResult.grade === 'FreshMedium')) {
    tsScore = biasScores[tsResult.signalBias] * tsResult.confidence;
    tsEffect = tsResult.signalBias === macroBias ? 'ConfidenceBoost' : 'ConfidenceReduction';
  } else if (tsResult.grade === 'Stale') {
    tsScore = 0; tsEffect = 'Ignored';
  }

  const coreyCombinedScore = (internalScore * 0.75) + (tsScore * 0.25);
  const combinedBias = coreyCombinedScore > 0.15 ? 'Bullish' : coreyCombinedScore < -0.15 ? 'Bearish' : 'Neutral';
  const combinedConf = Math.min(Math.abs(coreyCombinedScore), 1);
  const alignment     = tsResult.available && tsResult.fresh && tsResult.signalBias === macroBias;
  const contradiction = tsResult.available && tsResult.fresh && tsResult.signalBias !== 'Neutral' && tsResult.signalBias !== macroBias && macroBias !== 'Neutral';

  let escalation = 'None';
  if (tsEffect === 'ConfidenceBoost' && tsResult.grade === 'FreshHigh') escalation = 'ConfidenceBoost';
  else if (contradiction && tsResult.grade === 'FreshHigh') escalation = 'Warning';
  else if (contradiction) escalation = 'ConfidenceReduction';

  const summary = buildCoreySummaryFull(coreyMacroResult, tsResult, combinedBias, combinedConf, alignment, contradiction);
  log('INFO', `[COREY] ${symbol} → internal:${macroBias} TS:${tsResult.signalBias} combined:${combinedBias}`);

  return {
    internalMacro: coreyMacroResult,
    trendSpider: tsResult,
    correlation: corrResult,
    macroBias,
    combinedBias,
    confidence: Math.round(combinedConf * 100) / 100,
    combinedScore: Math.round(coreyCombinedScore * 100) / 100,
    alignment,
    contradiction,
    escalation,
    tsEffect,
    summary,
  };
}

function buildCoreySummaryFull(macro, ts, combinedBias, conf, aligned, conflict) {
  const tier = confidenceTier(conf);
  const tsStr = ts.available && ts.fresh
    ? (aligned ? `TS ${ts.grade} confirms ${combinedBias}.` : `TS ${ts.grade} ${conflict ? 'conflicts with' : 'diverges from'} macro.`)
    : 'No TS signal.';
  const baseDesc = macro.base.cb.stance === STANCE.N_A
    ? `${macro.base.currency}: ${macro.assetClass}`
    : `${macro.base.currency}:${macro.base.cb.stance} ${macro.base.econ.composite > 0.6 ? 'strong' : 'weak'}`;
  return `${tier} ${combinedBias} macro. ${baseDesc}. ${macro.quote.currency}:${macro.quote.cb.stance}. DXY:${macro.global.dxyBias} Risk:${macro.global.riskEnv}. ${tsStr}`;
}

// ============================================================
// 👑 JANE — FINAL ARBITRATION ENGINE (10-CASE CONFLICT MATRIX)
// ============================================================

function runJane(symbol, spideyResult, coreyResult, mode) {
  log('INFO', `[JANE] Synthesising ${symbol}`);
  const spideyBias = spideyResult.dominantBias, spideyConv = spideyResult.dominantConviction;
  const coreyBias  = coreyResult.combinedBias,  coreyConf  = coreyResult.confidence;
  const tsBias     = coreyResult.trendSpider.signalBias, tsGrade = coreyResult.trendSpider.grade;
  const tsFresh    = coreyResult.trendSpider.fresh, tsAvail = coreyResult.trendSpider.available;
  const biasS      = { Bullish: 1, Neutral: 0, Bearish: -1 };
  const spideyScore = biasS[spideyBias] * spideyConv, coreyScore = biasS[coreyBias] * coreyConf;

  let tsAdj = 0, trendSpiderEffect = 'Unavailable';
  if (tsAvail && tsFresh && (tsGrade === 'FreshHigh' || tsGrade === 'FreshMedium')) {
    const tsScore = biasS[tsBias] * coreyResult.trendSpider.confidence;
    const agree   = tsBias === spideyBias && tsBias === coreyBias;
    const conflict = tsBias !== 'Neutral' && (tsBias !== spideyBias || tsBias !== coreyBias);
    if (agree)         { tsAdj = tsScore > 0 ? 0.08 : -0.08; trendSpiderEffect = 'Boosted'; }
    else if (conflict) { tsAdj = tsScore > 0 ? -0.06 : 0.06; trendSpiderEffect = 'Reduced'; }
    else               { tsAdj = 0; trendSpiderEffect = 'Neutral'; }
  } else { trendSpiderEffect = tsAvail ? 'Ignored' : 'Unavailable'; }

  const composite = (spideyScore * 0.40) + (coreyScore * 0.30) + tsAdj;

  let finalBias, conviction, convictionLabel, doNotTrade = false, doNotTradeReason = null, conflictState;
  const spideyN = spideyBias === 'Neutral', coreyN = coreyBias === 'Neutral', tsN = tsBias === 'Neutral' || !tsAvail || !tsFresh;
  const spideyC = spideyBias, coreyC = coreyBias, tsC = tsBias;
  const spideyAgreeCorey    = !spideyN && !coreyN && spideyC === coreyC;
  const spideyConflictCorey = !spideyN && !coreyN && spideyC !== coreyC;
  const tsConflictSpidey    = !tsN && tsC !== spideyC;
  const tsConflictCorey     = !tsN && tsC !== coreyC;

  if      (spideyC === 'Bullish' && coreyC === 'Bullish' && (!tsAvail || !tsFresh || tsC === 'Bullish')) { finalBias = 'Bullish'; conviction = Math.min(composite + 0.1, 1); conflictState = 'Aligned'; }
  else if (spideyC === 'Bearish' && coreyC === 'Bearish' && (!tsAvail || !tsFresh || tsC === 'Bearish')) { finalBias = 'Bearish'; conviction = Math.min(Math.abs(composite) + 0.1, 1); conflictState = 'Aligned'; }
  else if (spideyAgreeCorey && tsN)  { finalBias = spideyC; conviction = Math.abs(composite); conflictState = 'Aligned'; }
  else if (spideyAgreeCorey && tsConflictSpidey && tsGrade === 'FreshLow')  { finalBias = spideyC; conviction = Math.abs(composite) * 0.85; conflictState = 'PartialConflict'; }
  else if (spideyAgreeCorey && tsConflictSpidey && tsGrade === 'FreshHigh') {
    if (spideyConv > 0.65 && coreyConf > 0.55) { finalBias = spideyC; conviction = Math.abs(composite) * 0.70; conflictState = 'PartialConflict'; }
    else { finalBias = 'Neutral'; conviction = 0.2; conflictState = 'HardConflict'; doNotTrade = true; doNotTradeReason = `${spideyC} structure + macro, but strong TrendSpider ${tsC} conflict.`; }
  }
  else if (spideyConflictCorey && !tsN && tsC === spideyC) { finalBias = spideyC; conviction = Math.abs(composite) * 0.60; conflictState = 'PartialConflict'; if (spideyConv < 0.55) { doNotTrade = true; doNotTradeReason = `Structure (${spideyC}) vs macro (${coreyC}) conflict. Insufficient conviction.`; } }
  else if (spideyConflictCorey && !tsN && tsC === coreyC)  { finalBias = 'Neutral'; conviction = 0.2; conflictState = 'HardConflict'; doNotTrade = true; doNotTradeReason = `Structure (${spideyC}) and macro+TS (${coreyC}) in direct conflict.`; }
  else if (spideyN && !coreyN && !tsN && coreyC === tsC)   { finalBias = coreyC; conviction = Math.abs(composite) * 0.55; conflictState = 'PartialConflict'; if (conviction < 0.35) { doNotTrade = true; doNotTradeReason = 'Structure neutral. Macro+TS aligned but insufficient structural confirmation.'; } }
  else if (!spideyN && coreyN && !tsN && tsC === spideyC)  { finalBias = spideyC; conviction = Math.abs(composite) * 0.65; conflictState = 'PartialConflict'; }
  else { finalBias = 'Neutral'; conviction = 0; conflictState = 'HardConflict'; doNotTrade = true; doNotTradeReason = 'Evidence fragmented across all three engines. No clean bias — wait for alignment.'; }

  if (conviction < 0.25 && !doNotTrade) { doNotTrade = true; doNotTradeReason = `Conviction ${(conviction * 100).toFixed(0)}% — below minimum threshold.`; }
  if (coreyResult.correlation?.divergent?.length > 0 && !doNotTrade) {
    conviction *= 0.80;
    if (conviction < 0.30) { doNotTrade = true; doNotTradeReason = `${doNotTradeReason || ''} Correlation divergence: ${coreyResult.correlation.divergent[0].pair} misaligned.`.trim(); }
  }

  conviction = Math.round(Math.min(conviction, 1) * 100) / 100;
  convictionLabel = conviction >= 0.65 ? 'High' : conviction >= 0.40 ? 'Medium' : conviction >= 0.20 ? 'Low' : 'Abstain';
  if (doNotTrade) convictionLabel = conviction < 0.10 ? 'Abstain' : convictionLabel;

  const levels   = buildJaneLevels(spideyResult, coreyResult, finalBias);
  const branches = buildJaneBranches(spideyResult, finalBias, levels);
  const primary  = buildPrimaryScenario(finalBias, spideyResult, coreyResult, levels);
  const alt      = buildAlternativeScenario(finalBias, spideyResult, levels);
  const summary  = buildJaneSummaryFull(symbol, finalBias, convictionLabel, conviction, doNotTrade, doNotTradeReason, levels, trendSpiderEffect, conflictState);

  log('INFO', `[JANE] ${symbol} → ${finalBias} | ${convictionLabel} | conflict:${conflictState} | TS:${trendSpiderEffect} | DNT:${doNotTrade}`);
  return { finalBias, conviction, convictionLabel, compositeScore: Math.round(composite * 100) / 100, doNotTrade, doNotTradeReason, trendSpiderEffect, conflictState, entryZone: levels.entryZone, invalidationLevel: levels.invalidation, targets: levels.targets, rrRatio: levels.rrRatio, branches, primaryScenario: primary, alternativeScenario: alt, summary };
}

function fmt(n, dp = 5) { return n != null ? Number(n).toFixed(dp) : 'N/A'; }

function buildJaneLevels(spideyResult, coreyResult, bias) {
  const htfTFs = Object.entries(spideyResult.timeframes);
  const data = htfTFs[0]?.[1] || null;
  const cp = data?.currentPrice || 0;
  const pip = cp > 10 ? 0.01 : cp > 1 ? 0.0001 : 0.01;
  let entryZone = null, invalidation = null, targets = [];
  if (data && bias !== 'Neutral') {
    if (bias === 'Bullish') {
      const dz = data.activeDemand;
      if (dz) { entryZone = { high: dz.high, low: dz.low }; invalidation = dz.low - pip * 10; }
      else if (data.swingLows?.length) { const sl = data.swingLows[data.swingLows.length - 1]; entryZone = { high: sl.level + pip * 5, low: sl.level - pip * 5 }; invalidation = sl.level - pip * 15; }
      const pools = (data.liquidityPools || []).filter((p) => p.level > cp);
      const imbs  = (data.imbalances    || []).filter((im) => im.type === 'Bearish' && im.low > cp);
      targets = [...pools.map((p) => ({ level: p.level, label: `${p.type} liquidity` })), ...imbs.map((im) => ({ level: im.high, label: 'Imbalance' }))].sort((a, b) => a.level - b.level).slice(0, 3).map((t, i) => ({ ...t, label: `T${i+1} — ${t.label}` }));
    } else {
      const sz = data.activeSupply;
      if (sz) { entryZone = { high: sz.high, low: sz.low }; invalidation = sz.high + pip * 10; }
      else if (data.swingHighs?.length) { const sh = data.swingHighs[data.swingHighs.length - 1]; entryZone = { high: sh.level + pip * 5, low: sh.level - pip * 5 }; invalidation = sh.level + pip * 15; }
      const pools = (data.liquidityPools || []).filter((p) => p.level < cp);
      const imbs  = (data.imbalances    || []).filter((im) => im.type === 'Bullish' && im.high < cp);
      targets = [...pools.map((p) => ({ level: p.level, label: `${p.type} liquidity` })), ...imbs.map((im) => ({ level: im.low, label: 'Imbalance' }))].sort((a, b) => b.level - a.level).slice(0, 3).map((t, i) => ({ ...t, label: `T${i+1} — ${t.label}` }));
    }
  }
  let rrRatio = null;
  if (entryZone && invalidation && targets.length > 0) {
    const mid = (entryZone.high + entryZone.low) / 2, sd = Math.abs(mid - invalidation), td = Math.abs(targets[0].level - mid);
    rrRatio = sd > 0 ? Math.round((td / sd) * 10) / 10 : null;
  }
  return { entryZone, invalidation, targets, rrRatio, currentPrice: cp };
}

function buildJaneBranches(spideyResult, bias, levels) {
  const branches = [], sig = spideyResult.significantBreak;
  if (bias === 'Bullish') {
    if (levels.targets[0])  branches.push(`IF close above ${levels.targets[0].level?.toFixed(5)} → bias confirmed, scale T2`);
    if (levels.invalidation) branches.push(`IF close below ${levels.invalidation?.toFixed(5)} → thesis invalidated, reassess`);
    if (sig?.breakLevel)    branches.push(`IF return to ${sig.breakLevel?.toFixed(5)} BOS → high probability demand reaction`);
  } else if (bias === 'Bearish') {
    if (levels.targets[0])  branches.push(`IF close below ${levels.targets[0].level?.toFixed(5)} → bias confirmed, scale T2`);
    if (levels.invalidation) branches.push(`IF close above ${levels.invalidation?.toFixed(5)} → thesis invalidated, reassess`);
    if (sig?.breakLevel)    branches.push(`IF return to ${sig.breakLevel?.toFixed(5)} BOS → high probability supply reaction`);
  } else {
    branches.push('No active branches — engines conflicted or neutral. Wait for structural resolution before entry.');
  }
  return branches;
}

function buildPrimaryScenario(bias, spideyResult, coreyResult, levels) {
  if (bias === 'Neutral') return 'No primary scenario. Conflicting or neutral signals across engines.';
  const br = spideyResult.significantBreak;
  return `${bias} continuation. Structure confirmed ${br?.lastBreak || 'structurally'} on ${br ? tfLabel(br.timeframe) : 'HTF'}. Macro ${coreyResult.combinedBias} aligned.${levels.entryZone ? ` Entry: ${levels.entryZone.low?.toFixed(5)}–${levels.entryZone.high?.toFixed(5)}.` : ''}${levels.rrRatio ? ` R:R ~${levels.rrRatio}:1.` : ''}`;
}

function buildAlternativeScenario(bias, spideyResult, levels) {
  const opp = bias === 'Bullish' ? 'Bearish' : bias === 'Bearish' ? 'Bullish' : 'directional';
  return `${opp} scenario if price closes ${bias === 'Bullish' ? 'below' : 'above'} invalidation ${levels.invalidation?.toFixed(5) || 'N/A'}. Indicates structural breakdown — reassess all timeframes.`;
}

function buildJaneSummaryFull(symbol, bias, convLabel, conviction, dnt, dntReason, levels, tsEffect, conflictState) {
  if (dnt) return `⛔ DO NOT TRADE — ${dntReason}`;
  const rr = levels.rrRatio ? ` R:R ~${levels.rrRatio}:1` : '';
  return `${bias} — ${convLabel} conviction (${(conviction * 100).toFixed(0)}%)${rr}. TS: ${tsEffect}. Conflict: ${conflictState}. Entry: ${levels.entryZone ? `${levels.entryZone.low?.toFixed(5)}–${levels.entryZone.high?.toFixed(5)}` : 'TBC'}. Inv: ${levels.invalidation?.toFixed(5) || 'TBC'}.`;
}

// ============================================================
// ATLAS FX — CHART ENGINE v2.0 (FULL REPLACEMENT)
// ============================================================

const { chromium } = require('playwright');
const sharp = require('sharp');

const PANEL_W = 960;
const PANEL_H = 540;
const MAX_RETRIES = 2;
const RENDER_TIMEOUT_MS = 120000;

let browserInstance = null;

// ============================================================
// 🔥 SINGLE BROWSER INSTANCE (CRITICAL FIX)
// ============================================================

async function getBrowser() {
  if (browserInstance) return browserInstance;

  browserInstance = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process'
    ]
  });

  return browserInstance;
}

// ============================================================
// URL BUILDER
// ============================================================

function buildPanelUrl(symbol, interval) {
  const tvSym = encodeURIComponent(getTVSymbol(symbol));
  const iv    = encodeURIComponent(interval);

  return `https://www.tradingview.com/chart/?symbol=${tvSym}&interval=${iv}&theme=dark&style=1&hideideas=1&hide_side_toolbar=1&hide_top_toolbar=1&hide_legend=1`;
}

// ============================================================
// UI CLEANER
// ============================================================

async function cleanUI(page) {
  await page.evaluate(() => {
    [
      '[data-name="header-toolbar"]',
      '[data-name="right-toolbar"]',
      '[data-name="left-toolbar"]',
      '.layout__area--right',
      '.layout__area--left',
      '.layout__area--top',
      '.tv-side-toolbar',
      '.tv-control-bar',
      '.tv-floating-toolbar',
      '.chart-controls-bar',
      '.header-chart-panel',
      '[data-name="legend"]',
      '.chart-toolbar',
      '.topbar',
      '.top-bar',
      '.tv-watermark',
      '#overlap-manager-root'
    ].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.remove());
    });
  }).catch(() => {});
}

// ============================================================
// POPUP HANDLER
// ============================================================

async function closePopups(page) {
  const selectors = [
    'button[aria-label="Close"]',
    'button:has-text("Accept")',
    'button:has-text("Got it")'
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
      }
    } catch {}
  }
}

// ============================================================
// PANEL RENDER
// ============================================================

async function renderPanel(symbol, interval, tfKey) {
  const browser = await getBrowser();
  const url = buildPanelUrl(symbol, interval);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let context;

    try {
      log('INFO', `[PANEL] ${symbol} ${tfKey} attempt ${attempt}`);

      context = await browser.newContext({
        viewport: { width: PANEL_W, height: PANEL_H },
        deviceScaleFactor: 2,
        locale: 'en-US',
        timezoneId: 'Australia/Perth'
      });

      const page = await context.newPage();

      page.setDefaultNavigationTimeout(60000);
      page.setDefaultTimeout(60000);

      await page.addInitScript(() => {
        try { localStorage.setItem('theme', 'dark'); } catch {}
      });

      // 🔥 LOAD PAGE
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      // 🔥 WAIT FOR CHART ENGINE
      await page.waitForSelector('canvas', { timeout: 30000 });

      await page.waitForFunction(() => {
        const c = document.querySelector('canvas');
        return c && c.width > 300 && c.height > 150;
      }, { timeout: 30000 });

      // 🔥 STABILIZE RENDER
      await page.waitForTimeout(5000);

      await closePopups(page);
      await cleanUI(page);

      await page.waitForTimeout(1000);

      const buffer = await page.screenshot({
        type: 'png',
        fullPage: false
      });

      await context.close();

      // 🔥 VALIDATION
      if (buffer.length < 80000) {
        throw new Error(`Blank render (${buffer.length}B)`);
      }

      log('INFO', `[OK] ${symbol} ${tfKey} ${(buffer.length/1024).toFixed(0)}KB`);

      return buffer;

    } catch (err) {
      log('ERROR', `[FAIL] ${symbol} ${tfKey}: ${err.message}`);

      if (context) {
        try { await context.close(); } catch {}
      }

      if (attempt === MAX_RETRIES) throw err;

      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ============================================================
// GRID BUILDER (2x2)
// ============================================================

async function buildGrid(panels) {
  const W = PANEL_W;
  const H = PANEL_H;

  const resized = await Promise.all(
    panels.map(img =>
      sharp(img)
        .resize(W, H, { fit: 'fill' })
        .png()
        .toBuffer()
    )
  );

  return await sharp({
    create: {
      width: W * 2,
      height: H * 2,
      channels: 4,
      background: { r: 11, g: 11, b: 11, alpha: 1 }
    }
  })
    .composite([
      { input: resized[0], left: 0, top: 0 },
      { input: resized[1], left: W, top: 0 },
      { input: resized[2], left: 0, top: H },
      { input: resized[3], left: W, top: H }
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ============================================================
// MAIN EXECUTION (CALL THIS)
// ============================================================

async function renderAll(symbol, timeframes) {
  const panels = [];

  for (const tf of timeframes) {
    const buf = await renderPanel(symbol, tf.interval, tf.key);
    panels.push(buf);
  }

  return await buildGrid(panels);
}
// ============================================================
// DISCORD OUTPUT FORMATTER
// ============================================================

function formatDiscordMessage(result) {
  const { symbol, label, tfDisplay, spideyHTF, spideyMicro, coreyResult, jane } = result;
  const feed = getFeedName(symbol);
  const sep  = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const macro = coreyResult.internalMacro;

  const sig     = spideyHTF.significantBreak;
  const tfBiases = Object.entries(spideyHTF.timeframes).map(([iv, r]) => `${tfLabel(iv)}:${r.bias[0]}`).join(' ');
  const brStr   = sig && sig.lastBreak !== 'None'
    ? `${sig.lastBreak}${sig.isEngineered ? ' ⚠️ Engineered' : ''} · ${tfLabel(sig.timeframe)} · ${fmt(sig.breakLevel)}`
    : 'None detected';
  const drawStr = spideyHTF.nearestDraw ? `${spideyHTF.nearestDraw.type} @ ${fmt(spideyHTF.nearestDraw.level)}` : 'No proximate draw';
  const microStr = spideyMicro.entryConfirmed ? `✅ LTF ${spideyMicro.ltfBreak} confirmed`
    : spideyMicro.inInducement ? `⚠️ Inducement — wait for sweep + BOS`
    : spideyMicro.sweepDetected ? `🔄 Sweep detected — watch for BOS`
    : `⏳ No LTF confirmation yet`;

  const spideyBlock =
    `🕷️ **SPIDEY**\n` +
    `Bias: **${spideyHTF.dominantBias}** · Conviction: ${(spideyHTF.dominantConviction * 100).toFixed(0)}%\n` +
    `Structure: ${tfBiases}\n` +
    `Last Break: ${brStr}\n` +
    `Draw on Liquidity: ${drawStr}\n` +
    `Execution: ${microStr}`;

  // Corey block — handles both FX and non-FX asset classes
  const baseDesc = macro.base.cb.stance === STANCE.N_A
    ? `${macro.base.currency}: ${macro.assetClass}`
    : `${macro.base.currency}: ${macro.base.cb.stance} · ${macro.base.cb.direction} · Strength ${(macro.base.econ.composite * 100).toFixed(0)}%`;

  const coreyBlock =
    `🌍 **COREY**\n` +
    `${baseDesc}\n` +
    `${macro.quote.currency}: ${macro.quote.cb.stance} · ${macro.quote.cb.direction} · Strength ${(macro.quote.econ.composite * 100).toFixed(0)}%\n` +
    `Global: ${macro.global.riskEnv} · DXY ${macro.global.dxyBias}` +
    (macro.regime ? ` · Regime ${macro.regime.regime}` : '') +
    (macro.volatility ? ` · Vol ${macro.volatility.level}` : '') + '\n' +
    `Macro Bias: **${coreyResult.macroBias}** · Combined: **${coreyResult.combinedBias}** · Conf: ${(coreyResult.confidence * 100).toFixed(0)}%\n` +
    (coreyResult.contradiction ? `⚠️ TS Contradiction detected\n` : coreyResult.alignment ? `✅ TS Aligned\n` : '') +
    (coreyResult.correlation?.divergent?.length ? `⚠️ Correl divergence: ${coreyResult.correlation.divergent[0].pair}\n` : '');

  const ts = coreyResult.trendSpider;
  const tsBlock = !TS_ENABLED
    ? `🕸️ **TRENDSPIDER**\nStatus: Disabled\n`
    : ts.available && ts.fresh
    ? `🕸️ **TRENDSPIDER**\n` +
      `Status: ${ts.status} · Grade: ${ts.grade}\n` +
      `Signal: **${ts.signalBias}** ${ts.signalType}\n` +
      (ts.pattern  ? `Pattern: ${ts.pattern}\n`  : '') +
      (ts.strategy ? `Strategy: ${ts.strategy}\n` : '') +
      (ts.scanner  ? `Scanner: ${ts.scanner}\n`  : '') +
      `Strength: ${(ts.strength * 100).toFixed(0)}% · Confidence: ${(ts.confidence * 100).toFixed(0)}%\n` +
      `Freshness: ${ts.grade} (${ts.ageMs ? `${Math.round(ts.ageMs / 60000)}m ago` : 'N/A'})\n` +
      `Alignment: ${coreyResult.alignment ? '✅ Aligned with Corey' : coreyResult.contradiction ? '❌ Conflicts with Corey' : '⚪ Neutral'}\n` +
      `Jane Effect: ${jane.trendSpiderEffect}\n`
    : `🕸️ **TRENDSPIDER**\nStatus: ${ts.available ? ts.grade : 'No signal received'}\nJane Effect: Not applied\n`;

  const targetsStr = jane.targets.length
    ? jane.targets.map((t) => `  ${t.label}: ${fmt(t.level)}`).join('\n')
    : '  Levels being computed from structure data';

  const janeBlock = jane.doNotTrade
    ? `👑 **JANE**\n⛔ **DO NOT TRADE**\n${jane.doNotTradeReason}\nConflict State: ${jane.conflictState}\n`
    : `👑 **JANE**\n` +
      `Final Bias: **${jane.finalBias}** · Conviction: **${jane.convictionLabel}** (${(jane.conviction * 100).toFixed(0)}%)\n` +
      `Conflict State: ${jane.conflictState}\n` +
      `TrendSpider Effect: ${jane.trendSpiderEffect}\n` +
      (jane.entryZone ? `Entry Zone: ${fmt(jane.entryZone.low)} – ${fmt(jane.entryZone.high)}\n` : '') +
      (jane.invalidationLevel ? `Invalidation: ${fmt(jane.invalidationLevel)}\n` : '') +
      (jane.rrRatio ? `R:R: ~${jane.rrRatio}:1 (minimum ATLAS 1:3 required)\n` : '') +
      `\n**Targets:**\n${targetsStr}\n\n` +
      `**Scenarios:**\n` +
      `▸ Primary: ${jane.primaryScenario}\n` +
      `▸ Alternative: ${jane.alternativeScenario}\n\n` +
      jane.branches.map((b) => `▸ ${b}`).join('\n');

  return (
    `📊 **${symbol}** · ${label} · ${feed}\n⏱ ${tfDisplay}\n\n` +
    `${sep}\n${spideyBlock}\n` +
    `${sep}\n${coreyBlock}` +
    `${sep}\n${tsBlock}` +
    `${sep}\n${janeBlock}\n${sep}`
  );
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
const RUNNING = {};
function isLocked(s) { return !!RUNNING[s]; }
function lock(s)     { RUNNING[s] = true; }
function unlock(s)   { RUNNING[s] = false; }
const queue = []; let queueRunning = false;
function enqueue(job) { queue.push(job); void runQueue(); }
async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (queue.length > 0) { const job = queue.shift(); try { await job(); } catch (e) { log('ERROR', '[QUEUE]', e.message); } }
  queueRunning = false;
}

// ============================================================
// DISCORD DELIVERY + SHARE
// ============================================================

const SHARE_CACHE = new Map();
function cacheForShare(k, d) { SHARE_CACHE.set(k, { ...d, expiresAt: Date.now() + CACHE_TTL_MS }); }
setInterval(() => { const n = Date.now(); for (const [k, v] of SHARE_CACHE.entries()) { if (v.expiresAt < n) SHARE_CACHE.delete(k); } }, 60000);

async function safeReply(msg, payload) { try { return await msg.reply(payload); } catch (e) { log('ERROR', '[REPLY]', e.message); return null; } }
async function safeEdit(msg, payload)  { try { return await msg.edit(payload);  } catch (e) { log('ERROR', '[EDIT]',  e.message); return null; } }

async function deliverResult(msg, result) {
  const { gridBuf, gridName } = result;
  const content  = formatDiscordMessage(result);
  const cacheKey = `${msg.id}_${Date.now()}`;
  cacheForShare(cacheKey, result);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`share_${cacheKey}`).setLabel('Share').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noshare_${cacheKey}`).setLabel('No thanks').setStyle(ButtonStyle.Secondary)
  );
  return await msg.channel.send({ content, files: [new AttachmentBuilder(gridBuf, { name: gridName })], components: [row] });
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
      await channel.send({ content: `📤 **${cached.symbol}** shared by **${interaction.user.username}**\n${formatDiscordMessage(cached)}`, files: [new AttachmentBuilder(cached.gridBuf, { name: cached.gridName })] });
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

  const { symbol, mode, intervals, customTFs } = parsed;
  if (isLocked(symbol)) { await safeReply(msg, `⚠️ **${symbol}** is already generating — please wait.`); return; }
  lock(symbol);

  enqueue(async () => {
    const tfDisplay = intervals.map(tfLabel).join(' · ');
    const label     = customTFs ? tfDisplay : (mode === 'H' ? 'HTF' : 'LTF');
    log('INFO', `[CMD] ${msg.author.username} / ${group} → ${symbol} ${label}`);
    const progress = await safeReply(msg, `⏳ **${symbol}** ${label} — full analysis running...\n⏱ ${tfDisplay}\n🕷️ Spidey · 🌍 Corey · 🕸️ TrendSpider · 👑 Jane`);
    try {
      const result = await runFullPipeline(symbol, mode, intervals, customTFs);
      if (progress) { try { await progress.delete(); } catch (_) {} }
      await deliverResult(msg, result);
    } catch (err) {
      log('ERROR', `[CMD FAIL] ${symbol}:`, err.message);
      if (progress) await safeEdit(progress, `❌ **${symbol}** analysis failed — retry`);
    } finally { unlock(symbol); }
  });
});

// ── SHARD + KEEP ALIVE ────────────────────────────────────────
client.on('shardDisconnect',   (e, id) => log('WARN', `[SHARD] ${id} disconnected. Code: ${e.code}`));
client.on('shardReconnecting', (id)    => log('INFO', `[SHARD] ${id} reconnecting...`));
client.on('shardResume',       (id, n) => log('INFO', `[SHARD] ${id} resumed. Replayed ${n} events.`));
setInterval(() => { log('INFO', '[KEEP-ALIVE]'); }, 5 * 60 * 1000);

// ── STARTUP ──────────────────────────────────────────────────
tsLoadPersisted();
startTSWebhookServer();
client.login(TOKEN);
