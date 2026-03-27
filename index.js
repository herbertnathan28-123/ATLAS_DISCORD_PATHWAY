'use strict';

/**
 * ============================================================
 * ATLAS FX — FULL INSTITUTIONAL CORE ENGINE
 * Final Complete Replacement Script
 * Version: 3.0.0
 * ============================================================
 *
 * PURPOSE
 * - One-file, full replacement script
 * - FX + equities + commodities + indices support
 * - Corey macro engine
 * - Spidey structure normalization
 * - TrendSpider signal normalization
 * - Jane decision engine
 * - Regime / volatility / liquidity / sector overlays
 * - Execution planning
 * - Position sizing
 * - Risk engine
 * - Scenario builder
 * - Render payload builder
 * - Discord / webhook-ready output helpers
 * - Validation + demo suite
 *
 * RULE
 * - Paste this as ONE COMPLETE FILE
 * - Do not merge parts
 * - Do not line hunt
 *
 * ============================================================
 */

// ============================================================
// SECTION 01 — ENGINE META / GLOBAL CONSTANTS
// ============================================================

const ENGINE_META = Object.freeze({
  name: 'ATLAS FX Institutional Core Engine',
  version: '3.0.0',
  build: 'final-complete-replacement',
  environment: 'standalone',
  updatedAt: new Date().toISOString(),
});

const EPSILON = 1e-9;

const BIAS = Object.freeze({
  BULLISH: 'Bullish',
  BEARISH: 'Bearish',
  NEUTRAL: 'Neutral',
});

const RISK_ENV = Object.freeze({
  RISK_ON: 'RiskOn',
  RISK_OFF: 'RiskOff',
  NEUTRAL: 'Neutral',
});

const REGIME = Object.freeze({
  EXPANSION: 'Expansion',
  GROWTH: 'Growth',
  TRANSITION: 'Transition',
  CONTRACTION: 'Contraction',
  CRISIS: 'Crisis',
  NEUTRAL: 'Neutral',
});

const DECISION = Object.freeze({
  TRADE_VALID: 'TRADE VALID',
  WATCHLIST: 'WATCHLIST',
  REDUCE_RISK: 'REDUCE RISK',
  DEFENSIVE: 'DEFENSIVE',
  DO_NOT_TRADE: 'DO NOT TRADE',
});

const VOLATILITY = Object.freeze({
  LOW: 'Low',
  MODERATE: 'Moderate',
  HIGH: 'High',
});

const LIQUIDITY_STATE = Object.freeze({
  LOOSE: 'Loose',
  NEUTRAL: 'Neutral',
  TIGHT: 'Tight',
});

const ASSET_CLASS = Object.freeze({
  FX: 'FX',
  EQUITY: 'Equity',
  COMMODITY: 'Commodity',
  INDEX: 'Index',
  UNKNOWN: 'Unknown',
});

const STANCE = Object.freeze({
  HAWKISH: 'Hawkish',
  DOVISH: 'Dovish',
  NEUTRAL: 'Neutral',
  N_A: 'N/A',
});

const RATE_CYCLE = Object.freeze({
  HIKING: 'Hiking',
  CUTTING: 'Cutting',
  HOLDING: 'Holding',
  N_A: 'N/A',
});

const GRADE = Object.freeze({
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  NONE: 'NONE',
});

const THRESHOLDS = Object.freeze({
  macroBullish: 0.15,
  macroBearish: -0.15,
  fxBullish: 0.20,
  fxBearish: -0.20,
  strongConfidence: 0.60,
  moderateConfidence: 0.30,
  tsStrong: 0.65,
  tsWeak: 0.25,
  tradeValidConfidence: 0.45,
});

const FX_QUOTES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF',
  'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'CNH', 'CNY',
]);

const EQUITY_SYMBOLS = new Set([
  'AMD', 'MU', 'ASML', 'MICRON', 'NVDA', 'AVGO', 'TSM', 'QCOM',
  'AAPL', 'MSFT', 'META', 'GOOGL', 'AMZN', 'TSLA', 'INTC',
]);

const COMMODITY_SYMBOLS = new Set([
  'XAUUSD', 'XAGUSD', 'XAUEUR', 'XAGEUR', 'USOIL', 'WTI', 'BRENT',
  'BCOUSD', 'NATGAS',
]);

const INDEX_SYMBOLS = new Set([
  'NAS100', 'US500', 'US30', 'GER40', 'UK100', 'HK50', 'JPN225',
  'SPX', 'NDX', 'DJI',
]);

const SEMI_SYMBOLS = new Set([
  'AMD', 'MU', 'ASML', 'MICRON', 'NVDA', 'AVGO', 'TSM', 'QCOM', 'INTC',
]);

const SAFE_HAVEN_SYMBOLS = new Set([
  'XAUUSD', 'XAGUSD', 'CHF', 'JPY', 'USD',
]);

const CURRENCY_COUNTRY = Object.freeze({
  USD: { country: 'United States', weight: 1.00, region: 'North America' },
  EUR: { country: 'Eurozone',      weight: 1.00, region: 'Europe' },
  GBP: { country: 'United Kingdom',weight: 0.90, region: 'Europe' },
  JPY: { country: 'Japan',         weight: 0.90, region: 'Asia' },
  AUD: { country: 'Australia',     weight: 0.85, region: 'Oceania' },
  NZD: { country: 'New Zealand',   weight: 0.75, region: 'Oceania' },
  CAD: { country: 'Canada',        weight: 0.85, region: 'North America' },
  CHF: { country: 'Switzerland',   weight: 0.80, region: 'Europe' },
  SEK: { country: 'Sweden',        weight: 0.60, region: 'Europe' },
  NOK: { country: 'Norway',        weight: 0.60, region: 'Europe' },
  DKK: { country: 'Denmark',       weight: 0.55, region: 'Europe' },
  SGD: { country: 'Singapore',     weight: 0.65, region: 'Asia' },
  HKD: { country: 'Hong Kong',     weight: 0.55, region: 'Asia' },
  CNH: { country: 'China Offshore',weight: 0.80, region: 'Asia' },
  CNY: { country: 'China',         weight: 0.85, region: 'Asia' },
});

const CENTRAL_BANKS = Object.freeze({
  USD: { name: 'Federal Reserve',               stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.90, growthSensitivity: 0.80 },
  EUR: { name: 'European Central Bank',         stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.85, growthSensitivity: 0.70 },
  GBP: { name: 'Bank of England',               stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.90, growthSensitivity: 0.75 },
  JPY: { name: 'Bank of Japan',                 stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.65, growthSensitivity: 0.60 },
  AUD: { name: 'Reserve Bank of Australia',     stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.85, growthSensitivity: 0.80 },
  NZD: { name: 'Reserve Bank of New Zealand',   stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.85, growthSensitivity: 0.75 },
  CAD: { name: 'Bank of Canada',                stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.85, growthSensitivity: 0.75 },
  CHF: { name: 'Swiss National Bank',           stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.75, growthSensitivity: 0.65 },
  SEK: { name: 'Riksbank',                      stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.75, growthSensitivity: 0.65 },
  NOK: { name: 'Norges Bank',                   stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.80, growthSensitivity: 0.70 },
  DKK: { name: 'Danmarks Nationalbank',         stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.70, growthSensitivity: 0.65 },
  SGD: { name: 'Monetary Authority of Singapore', stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.80, growthSensitivity: 0.75 },
  HKD: { name: 'Hong Kong Monetary Authority',  stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.70, growthSensitivity: 0.65 },
  CNH: { name: 'People’s Bank of China Offshore', stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.60, growthSensitivity: 0.85 },
  CNY: { name: 'People’s Bank of China',        stance: STANCE.NEUTRAL, direction: STANCE.NEUTRAL, rateCycle: RATE_CYCLE.HOLDING, terminalBias: 0.00, inflationSensitivity: 0.60, growthSensitivity: 0.85 },
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
  oilShock: 0.00,
  creditStress: 0.00,
  geopoliticalStress: 0.00,
  growthImpulse: 0.00,
  inflationImpulse: 0.00,
  usdFlow: 0.00,
  bondStress: 0.00,
  equityBreadth: 0.00,
  safeHavenFlow: 0.00,
  semiconductorCycle: 0.00,
  aiCapexImpulse: 0.00,
  commodityDemand: 0.00,
  realYieldPressure: 0.00,
  recessionRisk: 0.00,
});

const RENDER_CONFIG = Object.freeze({
  profile: 'institutional',
  chartsPerSet: 4,
  timeframesHTF: ['1W', '1D', '4H', '1H'],
  timeframesLTF: ['4H', '1H', '15M', '1M'],
  useSingleChartPerCapture: true,
  allowMultiLayout: false,
  hideToolbar: true,
  hideHeader: true,
  hideSidePanel: true,
  viewportWidth: 1920,
  viewportHeight: 1080,
  antiDetectionMinDelayMs: 2500,
  antiDetectionMaxDelayMs: 4500,
  maxRequestsPerSymbolWindowSec: 60,
});

// ============================================================
// SECTION 02 — LOW LEVEL HELPERS
// ============================================================

function clamp(value, min = -1, max = 1) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, min), max);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function round(value, places = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round((value + EPSILON) * factor) / factor;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function weightedAverage(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  let numerator = 0;
  let denominator = 0;

  for (const item of items) {
    if (!item) continue;
    if (!Number.isFinite(item.value) || !Number.isFinite(item.weight)) continue;
    numerator += item.value * item.weight;
    denominator += item.weight;
  }

  if (denominator === 0) return 0;
  return numerator / denominator;
}

function normalizeSymbol(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

function bool(value) {
  return !!value;
}

function scoreToBias(score, bullish = THRESHOLDS.macroBullish, bearish = THRESHOLDS.macroBearish) {
  if (score > bullish) return BIAS.BULLISH;
  if (score < bearish) return BIAS.BEARISH;
  return BIAS.NEUTRAL;
}

function confidenceTier(confidence) {
  if (confidence >= THRESHOLDS.strongConfidence) return 'Strong';
  if (confidence >= THRESHOLDS.moderateConfidence) return 'Moderate';
  return 'Weak';
}

function gradeFromConfidence(confidence) {
  if (confidence >= 0.80) return GRADE.A;
  if (confidence >= 0.60) return GRADE.B;
  if (confidence >= 0.30) return GRADE.C;
  if (confidence > 0) return GRADE.D;
  return GRADE.NONE;
}

function safeCountry(currency) {
  return CURRENCY_COUNTRY[currency]?.country || currency;
}

function inferAssetClass(symbol) {
  const s = normalizeSymbol(symbol);

  if (EQUITY_SYMBOLS.has(s)) return ASSET_CLASS.EQUITY;
  if (COMMODITY_SYMBOLS.has(s)) return ASSET_CLASS.COMMODITY;
  if (INDEX_SYMBOLS.has(s)) return ASSET_CLASS.INDEX;
  if (isFxPair(s)) return ASSET_CLASS.FX;

  if (/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s)) return ASSET_CLASS.COMMODITY;
  if (/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s)) return ASSET_CLASS.INDEX;
  if (/^[A-Z]{1,5}$/.test(s)) return ASSET_CLASS.EQUITY;

  return ASSET_CLASS.UNKNOWN;
}

function isFxPair(symbol) {
  const s = normalizeSymbol(symbol);
  if (s.length !== 6) return false;
  const base = s.slice(0, 3);
  const quote = s.slice(3, 6);
  return FX_QUOTES.has(base) && FX_QUOTES.has(quote);
}

function parsePair(symbol) {
  const s = normalizeSymbol(symbol);

  if (isFxPair(s)) {
    return {
      symbol: s,
      base: s.slice(0, 3),
      quote: s.slice(3, 6),
      assetClass: ASSET_CLASS.FX,
    };
  }

  if (s === 'XAUUSD' || s === 'XAGUSD' || s === 'BCOUSD') {
    return {
      symbol: s,
      base: s.slice(0, 3),
      quote: s.slice(3, 6),
      assetClass: inferAssetClass(s),
    };
  }

  return {
    symbol: s,
    base: s,
    quote: 'USD',
    assetClass: inferAssetClass(s),
  };
}

function makeStubCB(label = 'Equity/Commodity') {
  return {
    name: label,
    stance: STANCE.N_A,
    direction: STANCE.N_A,
    rateCycle: RATE_CYCLE.N_A,
    terminalBias: 0,
    inflationSensitivity: 0.5,
    growthSensitivity: 0.5,
    score: 0,
    language: label,
  };
}

function makeStubEcon() {
  return {
    gdpMomentum: 0.5,
    employment: 0.5,
    inflationControl: 0.5,
    fiscalPosition: 0.5,
    politicalStability: 0.5,
    composite: 0.5,
  };
}

// ============================================================
// SECTION 03 — INPUT NORMALIZATION / PROVIDER ADAPTERS
// ============================================================

async function getMarketContext(overrides = {}) {
  const merged = { ...DEFAULT_MARKET_CONTEXT, ...(overrides || {}) };

  return {
    oilShock: clamp(merged.oilShock),
    creditStress: clamp(merged.creditStress),
    geopoliticalStress: clamp(merged.geopoliticalStress),
    growthImpulse: clamp(merged.growthImpulse),
    inflationImpulse: clamp(merged.inflationImpulse),
    usdFlow: clamp(merged.usdFlow),
    bondStress: clamp(merged.bondStress),
    equityBreadth: clamp(merged.equityBreadth),
    safeHavenFlow: clamp(merged.safeHavenFlow),
    semiconductorCycle: clamp(merged.semiconductorCycle),
    aiCapexImpulse: clamp(merged.aiCapexImpulse),
    commodityDemand: clamp(merged.commodityDemand),
    realYieldPressure: clamp(merged.realYieldPressure),
    recessionRisk: clamp(merged.recessionRisk),
  };
}

async function getManualOverrides(input = {}) {
  return {
    dxyBias: input.dxyBias || null,
    riskEnv: input.riskEnv || null,
    cbankOverrides: input.cbankOverrides || {},
    econOverrides: input.econOverrides || {},
    assetOverrides: input.assetOverrides || {},
  };
}

function normalizeTrendSpiderSignal(symbol, raw = {}) {
  const direction = [BIAS.BULLISH, BIAS.BEARISH, BIAS.NEUTRAL].includes(raw.direction)
    ? raw.direction
    : BIAS.NEUTRAL;

  const strength = clamp01(Math.abs(Number(raw.strength || 0)));

  return {
    symbol: normalizeSymbol(symbol),
    available: bool(raw.available),
    fresh: bool(raw.fresh),
    direction,
    strength: round(strength, 2),
    grade: raw.grade || gradeFromConfidence(strength),
    notes: raw.notes || '',
    provider: raw.provider || 'normalized',
  };
}

async function getTrendSpiderSignal(symbol, providerResult = null) {
  if (providerResult && typeof providerResult === 'object') {
    return normalizeTrendSpiderSignal(symbol, providerResult);
  }

  return normalizeTrendSpiderSignal(symbol, {
    available: false,
    fresh: false,
    direction: BIAS.NEUTRAL,
    strength: 0,
    grade: GRADE.NONE,
    notes: 'No TrendSpider provider result',
    provider: 'stub',
  });
}

function normalizeSpideySignal(raw = {}) {
  const direction = [BIAS.BULLISH, BIAS.BEARISH, BIAS.NEUTRAL].includes(raw.direction)
    ? raw.direction
    : BIAS.NEUTRAL;

  const confidence = clamp01(Math.abs(Number(raw.confidence || 0)));

  return {
    available: bool(raw.available),
    fresh: raw.fresh !== false,
    direction,
    confidence: round(confidence, 2),
    bos: bool(raw.bos),
    choch: bool(raw.choch),
    liquidityDraw: raw.liquidityDraw || 'None',
    demandZoneValid: bool(raw.demandZoneValid),
    supplyZoneValid: bool(raw.supplyZoneValid),
    invalidationDefined: bool(raw.invalidationDefined),
    notes: raw.notes || '',
    provider: raw.provider || 'manual',
  };
}

// ============================================================
// SECTION 04 — CENTRAL BANK ENGINE
// ============================================================

function centralBankDirectionScore(cb) {
  if (!cb) return 0;
  let score = 0;

  if (cb.direction === STANCE.HAWKISH) score += 0.20;
  if (cb.direction === STANCE.DOVISH) score -= 0.20;

  if (cb.stance === STANCE.HAWKISH) score += 0.10;
  if (cb.stance === STANCE.DOVISH) score -= 0.10;

  if (cb.rateCycle === RATE_CYCLE.HIKING) score += 0.10;
  if (cb.rateCycle === RATE_CYCLE.CUTTING) score -= 0.10;

  score += clamp(cb.terminalBias || 0, -0.20, 0.20);
  return round(clamp(score, -0.50, 0.50), 2);
}

function assessCentralBankStance(currency, options = {}) {
  const ccy = normalizeSymbol(currency);
  const baseline = CENTRAL_BANKS[ccy];

  if (!baseline) {
    return makeStubCB('Unknown');
  }

  const out = deepClone(baseline);
  const override = options.override || {};

  if (override.stance) out.stance = override.stance;
  if (override.direction) out.direction = override.direction;
  if (override.rateCycle) out.rateCycle = override.rateCycle;
  if (Number.isFinite(override.terminalBias)) out.terminalBias = clamp(override.terminalBias);

  out.score = centralBankDirectionScore(out);
  return out;
}

// ============================================================
// SECTION 05 — ECONOMIC STRENGTH ENGINE
// ============================================================

function assessEconomicStrength(currency, options = {}) {
  const ccy = normalizeSymbol(currency);
  const baseline = ECONOMIC_BASELINES[ccy] || makeStubEcon();
  const override = options.override || {};

  const econ = {
    gdpMomentum: clamp01(Number.isFinite(override.gdpMomentum) ? override.gdpMomentum : baseline.gdpMomentum),
    employment: clamp01(Number.isFinite(override.employment) ? override.employment : baseline.employment),
    inflationControl: clamp01(Number.isFinite(override.inflationControl) ? override.inflationControl : baseline.inflationControl),
    fiscalPosition: clamp01(Number.isFinite(override.fiscalPosition) ? override.fiscalPosition : baseline.fiscalPosition),
    politicalStability: clamp01(Number.isFinite(override.politicalStability) ? override.politicalStability : baseline.politicalStability),
  };

  econ.composite = round(weightedAverage([
    { value: econ.gdpMomentum,       weight: 0.26 },
    { value: econ.employment,        weight: 0.22 },
    { value: econ.inflationControl,  weight: 0.20 },
    { value: econ.fiscalPosition,    weight: 0.14 },
    { value: econ.politicalStability,weight: 0.18 },
  ]), 2);

  return econ;
}

// ============================================================
// SECTION 06 — GLOBAL MACRO ENGINE
// ============================================================

async function assessGlobalMacro(input = {}) {
  const context = await getMarketContext(input.marketContext || {});
  const overrides = await getManualOverrides(input.overrides || {});

  let dxyScore = 0;
  dxyScore += context.usdFlow * 0.40;
  dxyScore += context.safeHavenFlow * 0.20;
  dxyScore += context.creditStress * 0.18;
  dxyScore += context.bondStress * 0.12;
  dxyScore += context.realYieldPressure * 0.10;
  dxyScore -= context.growthImpulse * 0.14;
  dxyScore -= context.equityBreadth * 0.12;

  if (overrides.dxyBias === BIAS.BULLISH) dxyScore = Math.max(dxyScore, 0.35);
  if (overrides.dxyBias === BIAS.BEARISH) dxyScore = Math.min(dxyScore, -0.35);

  dxyScore = round(clamp(dxyScore), 2);

  let riskScore = 0;
  riskScore -= context.geopoliticalStress * 0.30;
  riskScore -= context.creditStress * 0.22;
  riskScore -= context.bondStress * 0.12;
  riskScore -= context.oilShock * 0.12;
  riskScore -= context.recessionRisk * 0.18;
  riskScore += context.growthImpulse * 0.22;
  riskScore += context.equityBreadth * 0.22;
  riskScore += context.aiCapexImpulse * 0.08;
  riskScore += context.semiconductorCycle * 0.08;
  riskScore -= context.safeHavenFlow * 0.20;

  if (overrides.riskEnv === RISK_ENV.RISK_ON) riskScore = Math.max(riskScore, 0.35);
  if (overrides.riskEnv === RISK_ENV.RISK_OFF) riskScore = Math.min(riskScore, -0.35);

  riskScore = round(clamp(riskScore), 2);

  const dxyBias = dxyScore > 0.10 ? BIAS.BULLISH : dxyScore < -0.10 ? BIAS.BEARISH : BIAS.NEUTRAL;
  const riskEnv = riskScore > 0.12 ? RISK_ENV.RISK_ON : riskScore < -0.12 ? RISK_ENV.RISK_OFF : RISK_ENV.NEUTRAL;

  return {
    dxyScore,
    dxyBias,
    riskScore,
    riskEnv,
    context,
    confidence: round(clamp01(average([Math.abs(dxyScore), Math.abs(riskScore)])), 2),
  };
}

// ============================================================
// SECTION 07 — REGIME / VOLATILITY / LIQUIDITY ENGINES
// ============================================================

function detectMarketRegime(global) {
  let regime = REGIME.NEUTRAL;

  if (global.riskEnv === RISK_ENV.RISK_ON && global.dxyBias === BIAS.BEARISH) {
    regime = REGIME.EXPANSION;
  } else if (global.riskEnv === RISK_ENV.RISK_OFF && global.dxyBias === BIAS.BULLISH) {
    regime = REGIME.CRISIS;
  } else if (global.riskEnv === RISK_ENV.RISK_ON) {
    regime = REGIME.GROWTH;
  } else if (global.riskEnv === RISK_ENV.RISK_OFF) {
    regime = REGIME.CONTRACTION;
  } else {
    regime = REGIME.TRANSITION;
  }

  return {
    regime,
    confidence: round(clamp01(Math.abs(global.riskScore)), 2),
  };
}

function computeVolatilityProfile(global) {
  let vol = 0;
  vol += Math.abs(global.context.geopoliticalStress) * 0.35;
  vol += Math.abs(global.context.creditStress) * 0.22;
  vol += Math.abs(global.context.bondStress) * 0.18;
  vol += Math.abs(global.context.oilShock) * 0.12;
  vol += Math.abs(global.context.recessionRisk) * 0.13;

  const level = vol > 0.60 ? VOLATILITY.HIGH : vol > 0.30 ? VOLATILITY.MODERATE : VOLATILITY.LOW;

  return {
    volatilityScore: round(vol, 2),
    level,
  };
}

function assessLiquidity(global) {
  let liquidityScore = 0;
  liquidityScore -= global.context.creditStress * 0.40;
  liquidityScore -= global.context.bondStress * 0.28;
  liquidityScore -= global.context.realYieldPressure * 0.12;
  liquidityScore += global.context.growthImpulse * 0.20;
  liquidityScore += global.context.equityBreadth * 0.12;

  const state = liquidityScore > 0.20
    ? LIQUIDITY_STATE.LOOSE
    : liquidityScore < -0.20
      ? LIQUIDITY_STATE.TIGHT
      : LIQUIDITY_STATE.NEUTRAL;

  return {
    liquidityScore: round(clamp(liquidityScore), 2),
    state,
  };
}

// ============================================================
// SECTION 08 — SECTOR / ASSET INTELLIGENCE
// ============================================================

function assessSectorStrength(symbol, global) {
  const s = normalizeSymbol(symbol);
  let sector = 'General';
  let score = 0;
  const notes = [];

  if (SEMI_SYMBOLS.has(s)) {
    sector = 'Semiconductors';
    score += global.context.aiCapexImpulse * 0.40;
    score += global.context.semiconductorCycle * 0.40;
    if (global.riskEnv === RISK_ENV.RISK_OFF) score -= 0.20;
    notes.push('AI capex + semiconductor cycle weighted');
  } else if (EQUITY_SYMBOLS.has(s)) {
    sector = 'Equity';
    if (global.riskEnv === RISK_ENV.RISK_ON) score += 0.20;
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
    if (global.riskEnv === RISK_ENV.RISK_OFF) score += 0.10;
    if (global.riskEnv === RISK_ENV.RISK_ON) score += 0.06;
    if (global.dxyBias === BIAS.BEARISH) score += 0.10;
    if (global.dxyBias === BIAS.BULLISH) score -= 0.10;
    notes.push('Silver balanced between industrial and haven flows');
  } else if (/OIL|WTI|BRENT|BCOUSD|USOIL/.test(s)) {
    sector = 'Energy';
    score += global.context.oilShock * 0.26;
    score += global.context.commodityDemand * 0.18;
    if (global.context.recessionRisk > 0) score -= global.context.recessionRisk * 0.14;
    notes.push('Oil shock + demand + recession drag weighted');
  } else if (/NATGAS/.test(s)) {
    sector = 'Gas';
    score += global.context.commodityDemand * 0.20;
    score += global.context.oilShock * 0.05;
    notes.push('Gas demand + energy crossflow weighted');
  } else if (INDEX_SYMBOLS.has(s)) {
    sector = 'Index';
    if (global.riskEnv === RISK_ENV.RISK_ON) score += 0.22;
    if (global.riskEnv === RISK_ENV.RISK_OFF) score -= 0.22;
    if (global.dxyBias === BIAS.BEARISH) score += 0.06;
    if (global.dxyBias === BIAS.BULLISH) score -= 0.06;
    notes.push('Index beta weighted');
  }

  return {
    sector,
    score: round(clamp(score), 2),
    notes,
  };
}

function getAssetSpecificAdjustments(symbol, global) {
  const s = normalizeSymbol(symbol);
  const assetClass = inferAssetClass(s);
  const sectorInfo = assessSectorStrength(s, global);

  let score = sectorInfo.score;
  const notes = [...sectorInfo.notes];

  if (assetClass === ASSET_CLASS.EQUITY) {
    if (global.riskEnv === RISK_ENV.RISK_ON) {
      score += 0.25;
      notes.push('Risk-on supports equities');
    }
    if (global.riskEnv === RISK_ENV.RISK_OFF) {
      score -= 0.25;
      notes.push('Risk-off pressures equities');
    }
    if (global.dxyBias === BIAS.BEARISH) {
      score += 0.10;
      notes.push('Weak USD supports risk assets');
    }
    if (global.dxyBias === BIAS.BULLISH) {
      score -= 0.10;
      notes.push('Strong USD pressures risk assets');
    }
  }

  if (assetClass === ASSET_CLASS.COMMODITY) {
    if (s === 'XAUUSD') {
      if (global.riskEnv === RISK_ENV.RISK_OFF) score += 0.24;
      if (global.dxyBias === BIAS.BULLISH) score -= 0.12;
      if (global.dxyBias === BIAS.BEARISH) score += 0.10;
    }
  }

  if (assetClass === ASSET_CLASS.INDEX) {
    if (global.riskEnv === RISK_ENV.RISK_ON) score += 0.22;
    if (global.riskEnv === RISK_ENV.RISK_OFF) score -= 0.22;
  }

  return {
    assetClass,
    score: round(clamp(score, -0.80, 0.80), 2),
    notes,
    sectorInfo,
  };
}

// ============================================================
// SECTION 09 — FX MACRO SCORING
// ============================================================

function computeFxMacroScore(baseCB, quoteCB, baseEcon, quoteEcon, global, parsed) {
  let macroScore = 0;

  macroScore += (baseEcon.composite - quoteEcon.composite) * 0.80;
  macroScore += (baseCB.score - quoteCB.score) * 1.00;

  if (parsed.quote === 'USD') {
    if (global.dxyBias === BIAS.BULLISH) macroScore -= 0.15;
    if (global.dxyBias === BIAS.BEARISH) macroScore += 0.15;
  }

  if (parsed.base === 'USD') {
    if (global.dxyBias === BIAS.BULLISH) macroScore += 0.15;
    if (global.dxyBias === BIAS.BEARISH) macroScore -= 0.15;
  }

  if (global.riskEnv === RISK_ENV.RISK_OFF) {
    if (['JPY', 'CHF', 'USD'].includes(parsed.base)) macroScore += 0.05;
    if (['JPY', 'CHF', 'USD'].includes(parsed.quote)) macroScore -= 0.05;
  }

  if (global.riskEnv === RISK_ENV.RISK_ON) {
    if (['AUD', 'NZD', 'CAD'].includes(parsed.base)) macroScore += 0.05;
    if (['AUD', 'NZD', 'CAD'].includes(parsed.quote)) macroScore -= 0.05;
  }

  return round(clamp(macroScore), 2);
}

// ============================================================
// SECTION 10 — ADVANCED SCORE ADJUSTMENTS
// ============================================================

function applyAdvancedAdjustments(baseScore, sector, volatility, liquidity, regime) {
  let adjusted = baseScore;

  if (volatility.level === VOLATILITY.HIGH) adjusted *= 0.85;
  if (volatility.level === VOLATILITY.LOW) adjusted *= 1.05;

  if (liquidity.state === LIQUIDITY_STATE.LOOSE) adjusted += 0.05;
  if (liquidity.state === LIQUIDITY_STATE.TIGHT) adjusted -= 0.05;

  if (regime.regime === REGIME.CRISIS) adjusted *= 0.85;
  if (regime.regime === REGIME.EXPANSION) adjusted *= 1.05;

  adjusted += sector.score * 0.20;

  return round(clamp(adjusted), 2);
}

// ============================================================
// SECTION 11 — COREY MACRO ENGINE
// ============================================================

async function runCoreyMacro(symbol, input = {}) {
  const parsed = parsePair(symbol);
  const { base, quote, assetClass } = parsed;
  const global = await assessGlobalMacro(input);

  const isNonFx =
    assetClass !== ASSET_CLASS.FX ||
    EQUITY_SYMBOLS.has(parsed.symbol) ||
    COMMODITY_SYMBOLS.has(parsed.symbol) ||
    INDEX_SYMBOLS.has(parsed.symbol) ||
    !/^[A-Z]{3}$/.test(base);

  const regime = detectMarketRegime(global);
  const volatility = computeVolatilityProfile(global);
  const liquidity = assessLiquidity(global);

  if (isNonFx) {
    const assetAdj = getAssetSpecificAdjustments(parsed.symbol, global);

    const baseCB = makeStubCB(assetAdj.assetClass);
    const baseEcon = makeStubEcon();

    const quoteCB = assessCentralBankStance(
      quote,
      { override: input.overrides?.cbankOverrides?.[quote] || null }
    );
    const quoteEcon = assessEconomicStrength(
      quote,
      { override: input.overrides?.econOverrides?.[quote] || null }
    );

    let macroScore = assetAdj.score;

    if (quote === 'USD') {
      if (global.dxyBias === BIAS.BEARISH && assetAdj.assetClass !== ASSET_CLASS.COMMODITY) macroScore += 0.05;
      if (global.dxyBias === BIAS.BULLISH && assetAdj.assetClass !== ASSET_CLASS.COMMODITY) macroScore -= 0.05;
    }

    const adjustedScore = applyAdvancedAdjustments(
      macroScore,
      assetAdj.sectorInfo,
      volatility,
      liquidity,
      regime
    );

    const macroBias = scoreToBias(adjustedScore);
    const confidence = round(clamp01(Math.abs(adjustedScore)), 2);

    return {
      engine: 'corey',
      symbol: parsed.symbol,
      assetClass: assetAdj.assetClass,
      base: {
        currency: base,
        country: base,
        cb: baseCB,
        econ: baseEcon,
        weight: 0.50,
      },
      quote: {
        currency: quote,
        country: safeCountry(quote),
        cb: quoteCB,
        econ: quoteEcon,
        weight: CURRENCY_COUNTRY[quote]?.weight || 0.50,
      },
      global,
      regime,
      volatility,
      liquidity,
      sector: assetAdj.sectorInfo,
      rawMacroScore: round(macroScore, 2),
      macroScore: adjustedScore,
      macroBias,
      confidence,
      reasoning: assetAdj.notes,
      parsed,
    };
  }

  const baseCB = assessCentralBankStance(
    base,
    { override: input.overrides?.cbankOverrides?.[base] || null }
  );
  const quoteCB = assessCentralBankStance(
    quote,
    { override: input.overrides?.cbankOverrides?.[quote] || null }
  );

  const baseEcon = assessEconomicStrength(
    base,
    { override: input.overrides?.econOverrides?.[base] || null }
  );
  const quoteEcon = assessEconomicStrength(
    quote,
    { override: input.overrides?.econOverrides?.[quote] || null }
  );

  const rawMacroScore = computeFxMacroScore(baseCB, quoteCB, baseEcon, quoteEcon, global, parsed);

  const sectorStub = { sector: 'FX', score: 0, notes: [] };
  const adjustedScore = applyAdvancedAdjustments(
    rawMacroScore,
    sectorStub,
    volatility,
    liquidity,
    regime
  );

  const macroBias = scoreToBias(adjustedScore, THRESHOLDS.fxBullish, THRESHOLDS.fxBearish);
  const confidence = round(clamp01(Math.abs(adjustedScore)), 2);

  return {
    engine: 'corey',
    symbol: parsed.symbol,
    assetClass: ASSET_CLASS.FX,
    base: {
      currency: base,
      country: safeCountry(base),
      cb: baseCB,
      econ: baseEcon,
      weight: CURRENCY_COUNTRY[base]?.weight || 0.50,
    },
    quote: {
      currency: quote,
      country: safeCountry(quote),
      cb: quoteCB,
      econ: quoteEcon,
      weight: CURRENCY_COUNTRY[quote]?.weight || 0.50,
    },
    global,
    regime,
    volatility,
    liquidity,
    sector: sectorStub,
    rawMacroScore,
    macroScore: adjustedScore,
    macroBias,
    confidence,
    reasoning: [],
    parsed,
  };
}

// ============================================================
// SECTION 12 — ENGINE MERGE LOGIC
// ============================================================

function compareBias(a, b) {
  if (a === BIAS.NEUTRAL || b === BIAS.NEUTRAL) return 'diverge';
  if (a === b) return 'align';
  return 'conflict';
}

function combineMacroAndTrendSpider(macro, ts) {
  const tsAvailable = ts.available && ts.fresh;
  const relation = tsAvailable ? compareBias(macro.macroBias, ts.direction) : 'none';

  let combinedScore = macro.macroScore;
  let combinedBias = macro.macroBias;
  let aligned = false;
  let conflict = false;

  if (tsAvailable) {
    if (relation === 'align') {
      aligned = true;
      if (ts.direction === BIAS.BULLISH) combinedScore += ts.strength * 0.22;
      if (ts.direction === BIAS.BEARISH) combinedScore -= ts.strength * 0.22;
    } else if (relation === 'conflict') {
      conflict = true;
      if (ts.direction === BIAS.BULLISH) combinedScore += ts.strength * 0.20;
      if (ts.direction === BIAS.BEARISH) combinedScore -= ts.strength * 0.20;
    } else if (relation === 'diverge') {
      if (ts.direction === BIAS.BULLISH) combinedScore += ts.strength * 0.08;
      if (ts.direction === BIAS.BEARISH) combinedScore -= ts.strength * 0.08;
    }
  }

  combinedScore = round(clamp(combinedScore), 2);
  combinedBias = scoreToBias(combinedScore, 0.16, -0.16);

  return {
    combinedBias,
    combinedScore,
    confidence: round(clamp01(average([macro.confidence, tsAvailable ? ts.strength : 0])), 2),
    aligned,
    conflict,
    relation,
  };
}

function mergeWithSpidey(coreyTsMerged, spidey) {
  const relation = compareBias(coreyTsMerged.combinedBias, spidey.direction);
  let score = coreyTsMerged.combinedScore;
  const notes = [];

  if (spidey.available && spidey.fresh) {
    if (relation === 'align') {
      notes.push('Spidey aligns with Corey/TS');
      if (spidey.direction === BIAS.BULLISH) score += spidey.confidence * 0.25;
      if (spidey.direction === BIAS.BEARISH) score -= spidey.confidence * 0.25;
    } else if (relation === 'conflict') {
      notes.push('Spidey conflicts with Corey/TS');
      if (spidey.direction === BIAS.BULLISH) score += spidey.confidence * 0.22;
      if (spidey.direction === BIAS.BEARISH) score -= spidey.confidence * 0.22;
    } else {
      notes.push('Spidey diverges from Corey/TS');
      if (spidey.direction === BIAS.BULLISH) score += spidey.confidence * 0.08;
      if (spidey.direction === BIAS.BEARISH) score -= spidey.confidence * 0.08;
    }
  }

  score = round(clamp(score), 2);

  return {
    combinedBias: scoreToBias(score, 0.16, -0.16),
    combinedScore: score,
    confidence: round(clamp01(average([coreyTsMerged.confidence, spidey.confidence || 0])), 2),
    relation,
    notes,
  };
}

// ============================================================
// SECTION 13 — JANE DECISION ENGINE
// ============================================================

function runJaneDecision({ corey, spidey, ts, merged }) {
  const evidenceCount =
    (corey.macroBias !== BIAS.NEUTRAL ? 1 : 0) +
    (spidey.available && spidey.direction !== BIAS.NEUTRAL ? 1 : 0) +
    (ts.available && ts.direction !== BIAS.NEUTRAL ? 1 : 0);

  let decision = DECISION.DO_NOT_TRADE;
  let reason = 'Evidence fragmented across engines';

  const tsConfirming =
    ts.available &&
    ts.fresh &&
    ts.direction === merged.combinedBias &&
    merged.combinedBias !== BIAS.NEUTRAL;

  const spideyConfirming =
    spidey.available &&
    spidey.fresh &&
    spidey.direction === merged.combinedBias &&
    merged.combinedBias !== BIAS.NEUTRAL;

  const coreyStrong =
    corey.confidence >= THRESHOLDS.tradeValidConfidence &&
    corey.macroBias !== BIAS.NEUTRAL;

  const mergedStrong =
    merged.confidence >= THRESHOLDS.tradeValidConfidence &&
    merged.combinedBias !== BIAS.NEUTRAL;

  const structureReady =
    spidey.available
      ? (spidey.bos || spidey.choch) && spidey.invalidationDefined
      : false;

  if (corey.volatility.level === VOLATILITY.HIGH) {
    decision = DECISION.REDUCE_RISK;
    reason = 'High volatility override';
  }

  if (corey.regime.regime === REGIME.CRISIS) {
    decision = DECISION.DEFENSIVE;
    reason = 'Crisis regime detected';
  }

  if (
    mergedStrong &&
    coreyStrong &&
    (tsConfirming || spideyConfirming) &&
    structureReady
  ) {
    decision = DECISION.TRADE_VALID;
    reason = 'Macro + confirming engine alignment + structure ready';
  } else if (
    merged.combinedBias !== BIAS.NEUTRAL &&
    evidenceCount >= 2
  ) {
    decision = DECISION.WATCHLIST;
    reason = 'Directional evidence present but incomplete';
  }

  return {
    decision,
    reason,
    evidenceCount,
    tsConfirming,
    spideyConfirming,
    mergedStrong,
    structureReady,
    grade: gradeFromConfidence(merged.confidence),
  };
}

// ============================================================
// SECTION 14 — EXECUTION ENGINE
// ============================================================

function deriveExecutionBias(pipeline) {
  return pipeline.merged.combinedBias;
}

function deriveEntryType(pipeline) {
  const { spidey, jane } = pipeline;

  if (jane.decision !== DECISION.TRADE_VALID) return 'No Trade';
  if (spidey.bos || spidey.choch) return 'Confirmation Entry';
  return 'Risk Entry';
}

function buildExecutionChecklist(pipeline) {
  const { corey, spidey, trendSpider, jane, merged } = pipeline;
  const bias = merged.combinedBias;

  return {
    bias,
    macroAligned: corey.macroBias === bias && bias !== BIAS.NEUTRAL,
    tsAligned: trendSpider.available ? trendSpider.direction === bias : false,
    spideyAligned: spidey.available ? spidey.direction === bias : false,
    structurePresent: spidey.bos || spidey.choch,
    invalidationDefined: spidey.invalidationDefined,
    zoneValid:
      bias === BIAS.BULLISH
        ? spidey.demandZoneValid
        : bias === BIAS.BEARISH
          ? spidey.supplyZoneValid
          : false,
    decision: jane.decision,
  };
}

function buildExecutionPlan(pipeline, market = {}) {
  const bias = deriveExecutionBias(pipeline);
  const entryType = deriveEntryType(pipeline);
  const checklist = buildExecutionChecklist(pipeline);

  const entry = Number.isFinite(market.entry) ? market.entry : null;
  const stop = Number.isFinite(market.stop) ? market.stop : null;
  const target1 = Number.isFinite(market.target1) ? market.target1 : null;
  const target2 = Number.isFinite(market.target2) ? market.target2 : null;

  let rr1 = null;
  let rr2 = null;

  if (entry !== null && stop !== null && target1 !== null) {
    const risk = Math.abs(entry - stop);
    const reward1 = Math.abs(target1 - entry);
    rr1 = risk > 0 ? round(reward1 / risk, 2) : null;
  }

  if (entry !== null && stop !== null && target2 !== null) {
    const risk = Math.abs(entry - stop);
    const reward2 = Math.abs(target2 - entry);
    rr2 = risk > 0 ? round(reward2 / risk, 2) : null;
  }

  let validity = 'Invalid';
  if (
    pipeline.jane.decision === DECISION.TRADE_VALID &&
    checklist.macroAligned &&
    checklist.structurePresent &&
    checklist.invalidationDefined &&
    checklist.zoneValid
  ) {
    validity = 'Valid';
  } else if (pipeline.jane.decision === DECISION.WATCHLIST) {
    validity = 'Developing';
  }

  return {
    validity,
    bias,
    entryType,
    entry,
    stop,
    target1,
    target2,
    rr1,
    rr2,
    checklist,
    notes: [
      'Require setup-timeframe closure',
      'Do not enter on wick-only breach',
      'Prefer pullback into zone that caused BOS/CHOCH',
      'Maintain R:R >= 1:3 where structure allows',
    ],
  };
}

// ============================================================
// SECTION 15 — POSITION SIZING / RISK ENGINE
// ============================================================

function calculatePositionSize({
  accountEquity,
  riskPct,
  entry,
  stop,
  pointValue = 1,
}) {
  if (![accountEquity, riskPct, entry, stop, pointValue].every(Number.isFinite)) {
    return {
      valid: false,
      units: null,
      dollarRisk: null,
      reason: 'Missing numeric sizing inputs',
    };
  }

  const dollarRisk = accountEquity * (riskPct / 100);
  const stopDistance = Math.abs(entry - stop);

  if (stopDistance <= 0) {
    return {
      valid: false,
      units: null,
      dollarRisk: round(dollarRisk, 2),
      reason: 'Stop distance must be > 0',
    };
  }

  const units = dollarRisk / (stopDistance * pointValue);

  return {
    valid: true,
    units: Math.floor(units),
    dollarRisk: round(dollarRisk, 2),
    stopDistance: round(stopDistance, 5),
  };
}

function buildRiskProfile(pipeline, position = {}) {
  const execution = buildExecutionPlan(pipeline, position.market || {});
  const sizing = calculatePositionSize({
    accountEquity: position.accountEquity,
    riskPct: position.riskPct,
    entry: execution.entry,
    stop: execution.stop,
    pointValue: position.pointValue || 1,
  });

  let riskStatus = 'Uncontrolled';

  if (
    execution.validity === 'Valid' &&
    execution.rr1 !== null &&
    execution.rr1 >= 3 &&
    sizing.valid
  ) {
    riskStatus = 'Controlled';
  } else if (execution.validity === 'Developing') {
    riskStatus = 'Watch';
  }

  return {
    execution,
    sizing,
    riskStatus,
    maxLoss: sizing.dollarRisk,
  };
}

// ============================================================
// SECTION 16 — SCENARIO ENGINE
// ============================================================

function buildScenarioTable(pipeline) {
  const bias = pipeline.merged.combinedBias;
  const scenarios = [];

  if (bias === BIAS.BULLISH) {
    scenarios.push({
      label: 'Bull Continuation',
      trigger: 'Bullish close above local structure and hold on pullback',
      action: 'Look for confirmation entry at demand',
    });
    scenarios.push({
      label: 'Bull Failure',
      trigger: 'Failed reclaim and close back below demand',
      action: 'Invalidate long thesis and stand aside',
    });
  } else if (bias === BIAS.BEARISH) {
    scenarios.push({
      label: 'Bear Continuation',
      trigger: 'Bearish close below local structure and hold on retest',
      action: 'Look for confirmation entry at supply',
    });
    scenarios.push({
      label: 'Bear Failure',
      trigger: 'Failed breakdown and close back above supply',
      action: 'Invalidate short thesis and stand aside',
    });
  } else {
    scenarios.push({
      label: 'Neutral',
      trigger: 'No clean directional alignment',
      action: 'Do not trade',
    });
  }

  return scenarios;
}

// ============================================================
// SECTION 17 — SUMMARY BUILDERS
// ============================================================

function buildCoreySummary(macro, ts, combinedBias, conf, aligned, conflict) {
  const tier = confidenceTier(conf);

  const tsStr = ts.available && ts.fresh
    ? (aligned
      ? `TS ${ts.grade} confirms ${combinedBias}.`
      : `TS ${ts.grade} ${conflict ? 'conflicts with' : 'diverges from'} macro.`)
    : 'No TS signal.';

  const baseDesc = macro.base.cb.stance === STANCE.N_A
    ? `${macro.base.currency}: ${macro.assetClass}`
    : `${macro.base.currency}:${macro.base.cb.stance} ${macro.base.econ.composite > 0.6 ? 'strong' : 'weak'}`;

  return `${tier} ${combinedBias} macro. ${baseDesc}. ${macro.quote.currency}:${macro.quote.cb.stance}. DXY:${macro.global.dxyBias} Risk:${macro.global.riskEnv}. Regime:${macro.regime.regime}. Vol:${macro.volatility.level}. ${tsStr}`;
}

function buildSpideySummary(spidey) {
  if (!spidey.available) return 'No Spidey signal.';
  return `Spidey ${spidey.direction} (${spidey.confidence}) | BOS:${spidey.bos ? 'Y' : 'N'} CHOCH:${spidey.choch ? 'Y' : 'N'} Liquidity:${spidey.liquidityDraw} Zone:${spidey.demandZoneValid || spidey.supplyZoneValid ? 'Valid' : 'NotValid'} Invalidation:${spidey.invalidationDefined ? 'Yes' : 'No'}.`;
}

function buildJaneSummary(payload) {
  const { jane, corey, spidey, ts, merged } = payload;
  return [
    `JANE ${jane.decision}`,
    `Bias:${merged.combinedBias}`,
    `Confidence:${merged.confidence}`,
    `Corey:${corey.macroBias}/${corey.confidence}`,
    `Spidey:${spidey.available ? `${spidey.direction}/${spidey.confidence}` : 'N/A'}`,
    `TS:${ts.available ? `${ts.direction}/${ts.grade}` : 'N/A'}`,
    `Reason:${jane.reason}`,
  ].join(' | ');
}

// ============================================================
// SECTION 18 — RENDER / OUTPUT BUILDERS
// ============================================================

function buildRenderPayload(symbol, mode = 'roadmap') {
  const parsed = parsePair(symbol);
  const timeframes = mode === 'macro' ? RENDER_CONFIG.timeframesHTF : RENDER_CONFIG.timeframesLTF;

  return {
    symbol: parsed.symbol,
    mode,
    chartCount: RENDER_CONFIG.chartsPerSet,
    singleChartPerCapture: RENDER_CONFIG.useSingleChartPerCapture,
    hideToolbar: RENDER_CONFIG.hideToolbar,
    hideHeader: RENDER_CONFIG.hideHeader,
    hideSidePanel: RENDER_CONFIG.hideSidePanel,
    viewport: {
      width: RENDER_CONFIG.viewportWidth,
      height: RENDER_CONFIG.viewportHeight,
    },
    antiDetection: {
      minDelayMs: RENDER_CONFIG.antiDetectionMinDelayMs,
      maxDelayMs: RENDER_CONFIG.antiDetectionMaxDelayMs,
      maxRequestsPerSymbolWindowSec: RENDER_CONFIG.maxRequestsPerSymbolWindowSec,
    },
    timeframes,
  };
}

function formatDecisionCard(result) {
  return {
    symbol: result.symbol,
    assetClass: result.corey.assetClass,
    decision: result.jane.decision,
    bias: result.merged.combinedBias,
    confidence: result.merged.confidence,
    macro: result.corey.macroBias,
    structure: result.spidey.available ? result.spidey.direction : 'N/A',
    ts: result.trendSpider.available ? result.trendSpider.direction : 'N/A',
    regime: result.corey.regime.regime,
    volatility: result.corey.volatility.level,
    liquidity: result.corey.liquidity.state,
    reason: result.jane.reason,
  };
}

function formatDiscordBlock(result) {
  const card = formatDecisionCard(result);
  return [
    `**${card.symbol}**`,
    `Decision: **${card.decision}**`,
    `Bias: ${card.bias}`,
    `Confidence: ${card.confidence}`,
    `Macro: ${card.macro}`,
    `Structure: ${card.structure}`,
    `TrendSpider: ${card.ts}`,
    `Regime: ${card.regime}`,
    `Volatility: ${card.volatility}`,
    `Liquidity: ${card.liquidity}`,
    `Reason: ${card.reason}`,
  ].join('\n');
}

function formatConsoleReport(result) {
  return [
    `=== ${result.symbol} ===`,
    `Asset Class: ${result.corey.assetClass}`,
    `Macro Bias: ${result.corey.macroBias}`,
    `Macro Score: ${result.corey.macroScore}`,
    `Confidence: ${result.corey.confidence}`,
    `DXY: ${result.corey.global.dxyBias}`,
    `Risk Env: ${result.corey.global.riskEnv}`,
    `Regime: ${result.corey.regime.regime}`,
    `Volatility: ${result.corey.volatility.level}`,
    `Liquidity: ${result.corey.liquidity.state}`,
    `Sector: ${result.corey.sector.sector || 'N/A'}`,
    `Jane: ${result.jane.decision}`,
    `Summary: ${result.summaries.corey}`,
  ].join('\n');
}

function buildWebhookPayload(result) {
  return {
    engine: ENGINE_META.name,
    version: ENGINE_META.version,
    symbol: result.symbol,
    timestamp: new Date().toISOString(),
    decision: result.jane.decision,
    bias: result.merged.combinedBias,
    confidence: result.merged.confidence,
    macro: result.corey,
    trendSpider: result.trendSpider,
    spidey: result.spidey,
    summaries: result.summaries,
    render: buildRenderPayload(result.symbol, 'roadmap'),
  };
}

// ============================================================
// SECTION 19 — MASTER PIPELINE
// ============================================================

async function runAtlasCore(symbol, input = {}) {
  const normalized = normalizeSymbol(symbol);

  const corey = await runCoreyMacro(normalized, input);
  const trendSpider = await getTrendSpiderSignal(normalized, input.tsProviderResult || null);
  const spidey = normalizeSpideySignal(input.spidey || {});

  const coreyTsMerged = combineMacroAndTrendSpider(corey, trendSpider);
  const merged = mergeWithSpidey(coreyTsMerged, spidey);
  const jane = runJaneDecision({ corey, spidey, ts: trendSpider, merged });

  const summaries = {
    corey: buildCoreySummary(
      corey,
      trendSpider,
      coreyTsMerged.combinedBias,
      coreyTsMerged.confidence,
      coreyTsMerged.aligned,
      coreyTsMerged.conflict
    ),
    spidey: buildSpideySummary(spidey),
    jane: buildJaneSummary({ jane, corey, spidey, ts: trendSpider, merged }),
  };

  const scenarios = buildScenarioTable({ merged });

  return {
    meta: ENGINE_META,
    symbol: normalized,
    parsed: corey.parsed,
    corey,
    trendSpider,
    spidey,
    merged,
    jane,
    scenarios,
    summaries,
    render: buildRenderPayload(normalized, 'roadmap'),
  };
}

// ============================================================
// SECTION 20 — VALIDATION
// ============================================================

function validateMacroResult(corey) {
  const errors = [];

  if (!corey || typeof corey !== 'object') errors.push('Corey output missing');
  if (!corey.symbol) errors.push('Symbol missing');
  if (!corey.macroBias) errors.push('Macro bias missing');
  if (!Number.isFinite(corey.macroScore)) errors.push('Macro score invalid');
  if (!Number.isFinite(corey.confidence)) errors.push('Confidence invalid');
  if (!corey.base || !corey.quote) errors.push('Base/quote block missing');
  if (!corey.global) errors.push('Global block missing');
  if (!corey.regime) errors.push('Regime block missing');
  if (!corey.volatility) errors.push('Volatility block missing');
  if (!corey.liquidity) errors.push('Liquidity block missing');

  return {
    ok: errors.length === 0,
    errors,
  };
}

function validatePipelineResult(result) {
  const errors = [];
  const macroValidation = validateMacroResult(result.corey);

  if (!macroValidation.ok) errors.push(...macroValidation.errors);
  if (!result.jane?.decision) errors.push('Jane decision missing');
  if (!result.merged?.combinedBias) errors.push('Merged bias missing');
  if (!result.summaries?.corey) errors.push('Corey summary missing');
  if (!result.render?.timeframes) errors.push('Render payload missing');

  return {
    ok: errors.length === 0,
    errors,
  };
}

// ============================================================
// SECTION 21 — DEMO SUITE
// ============================================================

async function runDemoSuite() {
  const tests = [
    {
      symbol: 'EURUSD',
      input: {
        marketContext: {
          usdFlow: 0.20,
          growthImpulse: -0.10,
          safeHavenFlow: 0.10,
          geopoliticalStress: 0.10,
        },
        tsProviderResult: {
          available: true,
          fresh: true,
          direction: BIAS.BEARISH,
          strength: 0.45,
          grade: GRADE.B,
        },
        spidey: {
          available: true,
          fresh: true,
          direction: BIAS.BEARISH,
          confidence: 0.50,
          bos: true,
          choch: false,
          liquidityDraw: 'Downside',
          supplyZoneValid: true,
          invalidationDefined: true,
        },
      },
    },
    {
      symbol: 'AMD',
      input: {
        marketContext: {
          growthImpulse: 0.40,
          equityBreadth: 0.50,
          aiCapexImpulse: 0.60,
          semiconductorCycle: 0.30,
          usdFlow: -0.10,
        },
        overrides: {
          riskEnv: RISK_ENV.RISK_ON,
          dxyBias: BIAS.BEARISH,
        },
        tsProviderResult: {
          available: true,
          fresh: true,
          direction: BIAS.BULLISH,
          strength: 0.55,
          grade: GRADE.B,
        },
        spidey: {
          available: true,
          fresh: true,
          direction: BIAS.BULLISH,
          confidence: 0.52,
          bos: true,
          choch: true,
          liquidityDraw: 'Upside',
          demandZoneValid: true,
          invalidationDefined: true,
        },
      },
    },
    {
      symbol: 'XAUUSD',
      input: {
        marketContext: {
          geopoliticalStress: 0.70,
          safeHavenFlow: 0.60,
          usdFlow: 0.20,
          equityBreadth: -0.40,
          realYieldPressure: 0.10,
        },
        tsProviderResult: {
          available: true,
          fresh: true,
          direction: BIAS.BULLISH,
          strength: 0.40,
          grade: GRADE.C,
        },
        spidey: {
          available: false,
        },
      },
    },
  ];

  const out = [];

  for (const test of tests) {
    const result = await runAtlasCore(test.symbol, test.input);
    out.push({
      symbol: test.symbol,
      result,
      validation: validatePipelineResult(result),
    });
  }

  return out;
}

// ============================================================
// SECTION 22 — PUBLIC API
// ============================================================

module.exports = {
  ENGINE_META,
  RENDER_CONFIG,
  normalizeSymbol,
  parsePair,
  isFxPair,
  inferAssetClass,
  assessCentralBankStance,
  assessEconomicStrength,
  assessGlobalMacro,
  detectMarketRegime,
  computeVolatilityProfile,
  assessLiquidity,
  assessSectorStrength,
  getAssetSpecificAdjustments,
  runCoreyMacro,
  normalizeTrendSpiderSignal,
  getTrendSpiderSignal,
  normalizeSpideySignal,
  combineMacroAndTrendSpider,
  mergeWithSpidey,
  runJaneDecision,
  deriveExecutionBias,
  deriveEntryType,
  buildExecutionChecklist,
  buildExecutionPlan,
  calculatePositionSize,
  buildRiskProfile,
  buildScenarioTable,
  buildCoreySummary,
  buildSpideySummary,
  buildJaneSummary,
  buildRenderPayload,
  formatDecisionCard,
  formatDiscordBlock,
  formatConsoleReport,
  buildWebhookPayload,
  runAtlasCore,
  validateMacroResult,
  validatePipelineResult,
  runDemoSuite,
};

// ============================================================
// SECTION 23 — DIRECT RUN MODE
// ============================================================

if (require.main === module) {
  (async () => {
    const outputs = await runDemoSuite();

    for (const item of outputs) {
      console.log(formatConsoleReport(item.result));
      console.log(formatDiscordBlock(item.result));
      console.log('Validation:', item.validation);
      console.log('Webhook Preview:', JSON.stringify(buildWebhookPayload(item.result), null, 2));
      console.log('--------------------------------------------------');
    }
  })().catch(err => {
    console.error('ATLAS FX Core Engine failed:', err);
    process.exit(1);
  });
}
