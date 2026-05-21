'use strict';

// ATLAS FX - Dark Horse expanded universe registry.
// The scanner uses canonical ATLAS symbols internally, while provider
// adapters can read the EODHD ticker and routing metadata from here.

const DH_CATEGORY = Object.freeze({
  US_LARGE_CAP: 'us_large_cap',
  US_MID_GROWTH: 'us_mid_growth',
  US_TECH_MOMENTUM: 'us_tech_momentum',
  US_INDICES: 'us_indices',
  INTERNATIONAL_INDICES: 'international_indices',
  ASX_EQUITIES: 'asx_equities',
  FOREX_MAJORS: 'forex_majors',
  FOREX_MINORS: 'forex_minors',
  PRECIOUS_METALS: 'precious_metals',
  INDUSTRIAL_METALS: 'industrial_metals',
  ENERGY: 'energy',
  AGRICULTURAL: 'agricultural',
  SECTOR_ETFS: 'sector_etfs',
  BONDS_RATES: 'bonds_rates',
  VOLATILITY_MACRO: 'volatility_macro',
});

const DH_CATEGORY_LABEL = Object.freeze({
  [DH_CATEGORY.US_LARGE_CAP]: 'US Large Cap',
  [DH_CATEGORY.US_MID_GROWTH]: 'US Mid/Growth',
  [DH_CATEGORY.US_TECH_MOMENTUM]: 'US Tech/Momentum',
  [DH_CATEGORY.US_INDICES]: 'US Indices',
  [DH_CATEGORY.INTERNATIONAL_INDICES]: 'International Indices',
  [DH_CATEGORY.ASX_EQUITIES]: 'ASX Equities',
  [DH_CATEGORY.FOREX_MAJORS]: 'Forex Majors',
  [DH_CATEGORY.FOREX_MINORS]: 'Forex Minors',
  [DH_CATEGORY.PRECIOUS_METALS]: 'Precious Metals',
  [DH_CATEGORY.INDUSTRIAL_METALS]: 'Industrial Metals',
  [DH_CATEGORY.ENERGY]: 'Energy',
  [DH_CATEGORY.AGRICULTURAL]: 'Agricultural',
  [DH_CATEGORY.SECTOR_ETFS]: 'Sector ETFs',
  [DH_CATEGORY.BONDS_RATES]: 'Bonds/Rates',
  [DH_CATEGORY.VOLATILITY_MACRO]: 'Volatility/Macro Context',
});

const DH_CATEGORY_ORDER = Object.freeze([
  DH_CATEGORY.US_LARGE_CAP,
  DH_CATEGORY.US_MID_GROWTH,
  DH_CATEGORY.US_TECH_MOMENTUM,
  DH_CATEGORY.US_INDICES,
  DH_CATEGORY.INTERNATIONAL_INDICES,
  DH_CATEGORY.ASX_EQUITIES,
  DH_CATEGORY.FOREX_MAJORS,
  DH_CATEGORY.FOREX_MINORS,
  DH_CATEGORY.PRECIOUS_METALS,
  DH_CATEGORY.INDUSTRIAL_METALS,
  DH_CATEGORY.ENERGY,
  DH_CATEGORY.AGRICULTURAL,
  DH_CATEGORY.SECTOR_ETFS,
  DH_CATEGORY.BONDS_RATES,
  DH_CATEGORY.VOLATILITY_MACRO,
]);

const DH_ASSET_CLASS = Object.freeze({
  EQUITY: 'equity',
  ETF: 'etf',
  FX: 'fx',
  METAL: 'metal',
  COMMODITY: 'commodity',
  BOND: 'bond',
  MACRO_CONTEXT: 'macro_context',
});

function row(category, symbol, name, eodhdTicker, assetClass, opts) {
  return Object.freeze(Object.assign({
    category,
    categoryLabel: DH_CATEGORY_LABEL[category],
    symbol,
    displaySymbol: symbol,
    name,
    eodhdTicker,
    assetClass,
    exchange: eodhdTicker && eodhdTicker.includes('.') ? eodhdTicker.split('.').pop() : null,
    tradeable: true,
    contextOnly: false,
    eodhdPrimary: false,
    sessionRule: 'default',
    notes: [],
  }, opts || {}));
}

const DH_EXPANDED_UNIVERSE = Object.freeze([
  row(DH_CATEGORY.US_LARGE_CAP, 'NVDA', 'NVIDIA', 'NVDA.US', DH_ASSET_CLASS.EQUITY),
  row(DH_CATEGORY.US_LARGE_CAP, 'AAPL', 'Apple', 'AAPL.US', DH_ASSET_CLASS.EQUITY),

  row(DH_CATEGORY.US_MID_GROWTH, 'AMD', 'Advanced Micro Devices', 'AMD.US', DH_ASSET_CLASS.EQUITY),
  row(DH_CATEGORY.US_MID_GROWTH, 'MU', 'Micron Technology', 'MU.US', DH_ASSET_CLASS.EQUITY),

  row(DH_CATEGORY.US_TECH_MOMENTUM, 'MSFT', 'Microsoft', 'MSFT.US', DH_ASSET_CLASS.EQUITY),
  row(DH_CATEGORY.US_TECH_MOMENTUM, 'META', 'Meta Platforms', 'META.US', DH_ASSET_CLASS.EQUITY),

  row(DH_CATEGORY.US_INDICES, 'SPY', 'S&P 500 ETF', 'SPY.US', DH_ASSET_CLASS.ETF),
  row(DH_CATEGORY.US_INDICES, 'QQQ', 'NASDAQ 100 ETF', 'QQQ.US', DH_ASSET_CLASS.ETF),

  row(DH_CATEGORY.INTERNATIONAL_INDICES, 'EWJ', 'Japan (Nikkei proxy ETF)', 'EWJ.US', DH_ASSET_CLASS.ETF),
  row(DH_CATEGORY.INTERNATIONAL_INDICES, 'EWG', 'Germany (DAX proxy ETF)', 'EWG.US', DH_ASSET_CLASS.ETF),

  row(DH_CATEGORY.ASX_EQUITIES, 'BHP', 'BHP Group', 'BHP.AU', DH_ASSET_CLASS.EQUITY, {
    eodhdPrimary: true,
    sessionRule: 'asx_market_hours',
    notes: ['ASX exchange routing required'],
  }),
  row(DH_CATEGORY.ASX_EQUITIES, 'CBA', 'Commonwealth Bank', 'CBA.AU', DH_ASSET_CLASS.EQUITY, {
    eodhdPrimary: true,
    sessionRule: 'asx_market_hours',
    notes: ['ASX exchange routing required'],
  }),

  row(DH_CATEGORY.FOREX_MAJORS, 'EURUSD', 'Euro / US Dollar', 'EURUSD.FOREX', DH_ASSET_CLASS.FX),
  row(DH_CATEGORY.FOREX_MAJORS, 'GBPUSD', 'British Pound / US Dollar', 'GBPUSD.FOREX', DH_ASSET_CLASS.FX),

  row(DH_CATEGORY.FOREX_MINORS, 'USDJPY', 'US Dollar / Japanese Yen', 'USDJPY.FOREX', DH_ASSET_CLASS.FX),
  row(DH_CATEGORY.FOREX_MINORS, 'AUDUSD', 'Australian Dollar / US Dollar', 'AUDUSD.FOREX', DH_ASSET_CLASS.FX),

  row(DH_CATEGORY.PRECIOUS_METALS, 'XAUUSD', 'Gold / US Dollar', 'XAUUSD.FOREX', DH_ASSET_CLASS.METAL),
  row(DH_CATEGORY.PRECIOUS_METALS, 'XAGUSD', 'Silver / US Dollar', 'XAGUSD.FOREX', DH_ASSET_CLASS.METAL),

  row(DH_CATEGORY.INDUSTRIAL_METALS, 'COPPER', 'Copper Futures', 'HG.COMM', DH_ASSET_CLASS.COMMODITY, {
    displaySymbol: 'COPPER',
    eodhdPrimary: true,
    notes: ['EODHD Ultimate availability should be probed on deploy'],
  }),
  row(DH_CATEGORY.INDUSTRIAL_METALS, 'XPTUSD', 'Platinum / US Dollar', 'XPTUSD.FOREX', DH_ASSET_CLASS.METAL, {
    eodhdPrimary: true,
    notes: ['EODHD Ultimate availability should be probed on deploy'],
  }),

  row(DH_CATEGORY.ENERGY, 'UCO', 'WTI Crude Oil (2x ETF proxy)', 'UCO.US', DH_ASSET_CLASS.ETF, {
    amplifiedInstrument: true,
    riskDisclosure: 'Amplified instrument: 2x WTI ETF proxy; position sizing should be reduced versus unlevered ETFs.',
  }),
  row(DH_CATEGORY.ENERGY, 'UNG', 'Natural Gas ETF', 'UNG.US', DH_ASSET_CLASS.ETF),

  row(DH_CATEGORY.AGRICULTURAL, 'CORN', 'Corn ETF', 'CORN.US', DH_ASSET_CLASS.ETF, {
    sessionRule: 'us_market_hours_only',
    notes: ['Lower-liquidity window; scan during US market hours only'],
  }),
  row(DH_CATEGORY.AGRICULTURAL, 'WEAT', 'Wheat ETF', 'WEAT.US', DH_ASSET_CLASS.ETF, {
    sessionRule: 'us_market_hours_only',
    notes: ['Lower-liquidity window; scan during US market hours only'],
  }),

  row(DH_CATEGORY.SECTOR_ETFS, 'XLE', 'Energy Select Sector ETF', 'XLE.US', DH_ASSET_CLASS.ETF),
  row(DH_CATEGORY.SECTOR_ETFS, 'XLF', 'Financial Select Sector ETF', 'XLF.US', DH_ASSET_CLASS.ETF),

  row(DH_CATEGORY.BONDS_RATES, 'TLT', '20+ Year Treasury Bond ETF', 'TLT.US', DH_ASSET_CLASS.BOND),
  row(DH_CATEGORY.BONDS_RATES, 'HYG', 'High Yield Corporate Bond ETF', 'HYG.US', DH_ASSET_CLASS.BOND),

  row(DH_CATEGORY.VOLATILITY_MACRO, 'VIXY', 'VIX Short-Term Futures ETF', 'VIXY.US', DH_ASSET_CLASS.MACRO_CONTEXT, {
    tradeable: false,
    contextOnly: true,
    notes: ['Macro context only; never publish as a tradeable Dark Horse call'],
  }),
  row(DH_CATEGORY.VOLATILITY_MACRO, 'UUP', 'US Dollar Index ETF (DXY proxy)', 'UUP.US', DH_ASSET_CLASS.MACRO_CONTEXT, {
    tradeable: false,
    contextOnly: true,
    notes: ['Macro context only; never publish as a tradeable Dark Horse call'],
  }),
]);

const bySymbol = new Map();
const byTicker = new Map();
for (const item of DH_EXPANDED_UNIVERSE) {
  bySymbol.set(item.symbol, item);
  byTicker.set(item.eodhdTicker, item);
}

function canonicalFromInput(input) {
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) return null;
  if (bySymbol.has(raw)) return raw;
  if (byTicker.has(raw)) return byTicker.get(raw).symbol;
  const withoutSuffix = raw.replace(/\.(US|AU|FOREX|COMM|NASDAQ|NYSE|NYSEARCA|AMEX|INDX)$/i, '');
  if (bySymbol.has(withoutSuffix)) return withoutSuffix;
  return null;
}

function getBySymbol(symbol) {
  const canonical = canonicalFromInput(symbol) || String(symbol || '').trim().toUpperCase();
  return bySymbol.get(canonical) || null;
}

function getByEodhdTicker(ticker) {
  return byTicker.get(String(ticker || '').trim().toUpperCase()) || null;
}

function symbols(opts) {
  opts = opts || {};
  return DH_EXPANDED_UNIVERSE
    .filter(row => opts.includeContextOnly !== false || !row.contextOnly)
    .map(row => row.symbol);
}

function categoryFor(symbol) {
  const meta = getBySymbol(symbol);
  return meta ? meta.category : null;
}

module.exports = {
  DH_CATEGORY,
  DH_CATEGORY_LABEL,
  DH_CATEGORY_ORDER,
  DH_ASSET_CLASS,
  DH_EXPANDED_UNIVERSE,
  canonicalFromInput,
  getBySymbol,
  getByEodhdTicker,
  symbols,
  categoryFor,
};
