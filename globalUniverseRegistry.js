'use strict';

// ============================================================
// ATLAS FX — Global Universe Registry
//
// Central source of truth for the Dark Horse scan universe.
// Crypto is intentionally absent. Unsupported / partial markets
// are still listed so the scan can disclose what was intended but
// not actually scanned by the currently wired provider path.
// ============================================================

const PROVIDERS = Object.freeze({
  TWELVEDATA: 'twelvedata',
  FMP: 'fmp',
  EODHD: 'eodhd',
  YAHOO: 'yahoo',
  INTERNAL_STATIC: 'internal_static',
});

const COVERAGE_STATUS = Object.freeze({
  SUPPORTED: 'supported',
  PARTIAL: 'partial',
  UNSUPPORTED: 'unsupported',
});

const SCAN_MODE = Object.freeze({
  STATIC_CORE: 'static_core',
  PROVIDER_SUPPORTED: 'provider_supported',
  PROVIDER_PARTIAL: 'provider_partial',
  DYNAMIC_MOVER: 'dynamic_mover',
  UNSUPPORTED_DISCLOSURE: 'unsupported_disclosure',
});

const MARKET_GROUPS = Object.freeze({
  FX_MAJORS: 'FX_MAJORS',
  FX_CROSSES: 'FX_CROSSES',
  FX_EXOTICS_EM: 'FX_EXOTICS_EM',
  US_EQUITIES: 'US_EQUITIES',
  ASX_EQUITIES: 'ASX_EQUITIES',
  UK_LSE_EQUITIES: 'UK_LSE_EQUITIES',
  EU_EQUITIES: 'EU_EQUITIES',
  ASIAN_EQUITIES: 'ASIAN_EQUITIES',
  US_INDICES: 'US_INDICES',
  GLOBAL_INDICES: 'GLOBAL_INDICES',
  METALS: 'METALS',
  ENERGY: 'ENERGY',
  COMMODITIES: 'COMMODITIES',
  SAFE_HAVENS: 'SAFE_HAVENS',
  RATES_BONDS_ETFS: 'RATES_BONDS_ETFS',
});

const GROUP_LABELS = Object.freeze({
  [MARKET_GROUPS.FX_MAJORS]: 'FX Majors',
  [MARKET_GROUPS.FX_CROSSES]: 'FX Crosses',
  [MARKET_GROUPS.FX_EXOTICS_EM]: 'FX Exotics / Emerging',
  [MARKET_GROUPS.US_EQUITIES]: 'US Equities',
  [MARKET_GROUPS.ASX_EQUITIES]: 'ASX Equities',
  [MARKET_GROUPS.UK_LSE_EQUITIES]: 'UK / LSE Equities',
  [MARKET_GROUPS.EU_EQUITIES]: 'EU Equities',
  [MARKET_GROUPS.ASIAN_EQUITIES]: 'Asian Equities',
  [MARKET_GROUPS.US_INDICES]: 'US Indices',
  [MARKET_GROUPS.GLOBAL_INDICES]: 'Global Indices',
  [MARKET_GROUPS.METALS]: 'Metals',
  [MARKET_GROUPS.ENERGY]: 'Energy',
  [MARKET_GROUPS.COMMODITIES]: 'Commodities',
  [MARKET_GROUPS.SAFE_HAVENS]: 'Safe Havens',
  [MARKET_GROUPS.RATES_BONDS_ETFS]: 'Rates / Bonds / ETFs',
});

// The historical Annex A static core retained as fallback only.
// This is intentionally the legacy 37-symbol set documented in
// corey_history_config.js, not the full registry.
const STATIC_CORE_UNIVERSE = Object.freeze([
  'EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD',
  'EURGBP','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY','EURAUD',
  'EURCAD','GBPAUD','GBPCAD','GBPCHF','AUDCAD','AUDNZD','NZDCAD',
  'NAS100','US500','DJI','GER40','UK100',
  'NVDA','AMD','ASML','AAPL','MSFT','META','GOOGL','AMZN','TSLA',
  'XAUUSD','XAGUSD',
]);

const CRYPTO_TERMS = /\b(BTC|ETH|XRP|SOL|DOGE|ADA|BNB|DOT|MATIC|AVAX|LINK|LTC|BCH|XLM|ALGO|ATOM|USDT|USDC|SHIB|PEPE|BITCOIN|ETHEREUM|CRYPTO)\b/i;

function providerMap(symbols) {
  return Object.assign({
    [PROVIDERS.TWELVEDATA]: null,
    [PROVIDERS.FMP]: null,
    [PROVIDERS.EODHD]: null,
    [PROVIDERS.YAHOO]: null,
    [PROVIDERS.INTERNAL_STATIC]: null,
  }, symbols || {});
}

function entry(symbol, group, opts) {
  opts = opts || {};
  return Object.freeze({
    canonical_symbol: symbol,
    display_symbol: opts.display || symbol,
    asset_class: opts.assetClass || 'unknown',
    market_group: group,
    region: opts.region || 'GLOBAL',
    exchange: opts.exchange || null,
    provider_symbol_map: providerMap(opts.providers),
    provider_priority: Object.freeze((opts.providerPriority || [
      PROVIDERS.TWELVEDATA,
      PROVIDERS.FMP,
      PROVIDERS.EODHD,
      PROVIDERS.YAHOO,
      PROVIDERS.INTERNAL_STATIC,
    ]).slice()),
    enabled: opts.enabled !== false,
    scan_mode: opts.scanMode || SCAN_MODE.PROVIDER_SUPPORTED,
    coverage_status: opts.coverageStatus || COVERAGE_STATUS.SUPPORTED,
    notes: opts.notes || '',
  });
}

function tdFx(pair) { return pair.slice(0, 3) + '/' + pair.slice(3); }
function fmpFx(pair) { return pair; }

const REGISTRY = Object.freeze([
  // FX majors — static core + provider-supported.
  ...['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD'].map(s =>
    entry(s, MARKET_GROUPS.FX_MAJORS, {
      assetClass: 'fx',
      region: 'GLOBAL',
      exchange: 'OTC',
      scanMode: SCAN_MODE.STATIC_CORE,
      providers: {
        [PROVIDERS.TWELVEDATA]: tdFx(s),
        [PROVIDERS.FMP]: fmpFx(s),
        [PROVIDERS.EODHD]: s,
        [PROVIDERS.INTERNAL_STATIC]: s,
      },
      notes: 'Legacy static core; still provider-scanned when OHLC is available.',
    })
  ),

  // FX crosses — static core + provider-supported.
  ...['EURGBP','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY','EURAUD','EURCAD','GBPAUD','GBPCAD','GBPCHF','AUDCAD','AUDNZD','NZDCAD'].map(s =>
    entry(s, MARKET_GROUPS.FX_CROSSES, {
      assetClass: 'fx',
      region: 'GLOBAL',
      exchange: 'OTC',
      scanMode: SCAN_MODE.STATIC_CORE,
      providers: {
        [PROVIDERS.TWELVEDATA]: tdFx(s),
        [PROVIDERS.FMP]: fmpFx(s),
        [PROVIDERS.EODHD]: s,
        [PROVIDERS.INTERNAL_STATIC]: s,
      },
      notes: 'Legacy static core; still provider-scanned when OHLC is available.',
    })
  ),

  // FX exotics / emerging — provider-supported where the live provider accepts the pair.
  ...['USDZAR','USDMXN','USDTRY','USDSEK','USDNOK','USDHKD','USDPLN','USDSGD'].map(s =>
    entry(s, MARKET_GROUPS.FX_EXOTICS_EM, {
      assetClass: 'fx',
      region: 'GLOBAL',
      exchange: 'OTC',
      scanMode: SCAN_MODE.PROVIDER_PARTIAL,
      coverageStatus: COVERAGE_STATUS.PARTIAL,
      providers: {
        [PROVIDERS.TWELVEDATA]: tdFx(s),
        [PROVIDERS.FMP]: fmpFx(s),
        [PROVIDERS.EODHD]: s,
      },
      notes: 'Emerging-market FX availability varies by provider plan and session liquidity.',
    })
  ),

  // US equities — static core plus high-turnover mover candidates.
  ...['NVDA','AMD','ASML','AAPL','MSFT','META','GOOGL','AMZN','TSLA'].map(s =>
    entry(s, MARKET_GROUPS.US_EQUITIES, {
      assetClass: 'equity',
      region: 'US',
      exchange: s === 'ASML' ? 'NASDAQ_ADR' : 'NASDAQ',
      scanMode: SCAN_MODE.STATIC_CORE,
      providers: {
        [PROVIDERS.TWELVEDATA]: s,
        [PROVIDERS.FMP]: s,
        [PROVIDERS.EODHD]: s + '.US',
        [PROVIDERS.YAHOO]: s,
        [PROVIDERS.INTERNAL_STATIC]: s,
      },
      notes: 'Legacy static core equity symbol.',
    })
  ),
  ...['UAL','SMCI','ARM','AVGO','NFLX','PLTR','MU','ORCL','CRM','SHOP','UBER','DIS'].map(s =>
    entry(s, MARKET_GROUPS.US_EQUITIES, {
      assetClass: 'equity',
      region: 'US',
      exchange: ['SHOP'].includes(s) ? 'NYSE' : 'NASDAQ/NYSE',
      scanMode: SCAN_MODE.PROVIDER_SUPPORTED,
      providers: {
        [PROVIDERS.TWELVEDATA]: s,
        [PROVIDERS.FMP]: s,
        [PROVIDERS.EODHD]: s + '.US',
        [PROVIDERS.YAHOO]: s,
      },
      notes: 'Provider-backed US mover universe; can also enter dynamically from FMP/EODHD mover feeds.',
    })
  ),

  // Regional equities — currently disclosed as partial/unsupported unless routed by provider-specific work.
  ...[
    ['BHP.AX','BHP.AX'], ['CBA.AX','CBA.AX'], ['RIO.AX','RIO.AX'], ['CSL.AX','CSL.AX'],
  ].map(([canonical, display]) =>
    entry(canonical, MARKET_GROUPS.ASX_EQUITIES, {
      display,
      assetClass: 'equity',
      region: 'AU',
      exchange: 'ASX',
      scanMode: SCAN_MODE.UNSUPPORTED_DISCLOSURE,
      coverageStatus: COVERAGE_STATUS.UNSUPPORTED,
      providers: {
        [PROVIDERS.EODHD]: display.replace('.AX', '.AU'),
        [PROVIDERS.YAHOO]: display,
      },
      notes: 'ASX symbols are listed for transparency; no safeOHLC ASX route is wired in this repo yet.',
    })
  ),
  ...[
    ['HSBA.L','HSBA.L'], ['SHEL.L','SHEL.L'], ['AZN.L','AZN.L'], ['BP.L','BP.L'],
  ].map(([canonical, display]) =>
    entry(canonical, MARKET_GROUPS.UK_LSE_EQUITIES, {
      display,
      assetClass: 'equity',
      region: 'UK',
      exchange: 'LSE',
      scanMode: SCAN_MODE.UNSUPPORTED_DISCLOSURE,
      coverageStatus: COVERAGE_STATUS.UNSUPPORTED,
      providers: {
        [PROVIDERS.EODHD]: display.replace('.L', '.LSE'),
        [PROVIDERS.YAHOO]: display,
      },
      notes: 'LSE equities require explicit exchange routing before Dark Horse can scan them.',
    })
  ),
  ...[
    ['SAP.DE','SAP.DE'], ['SIE.DE','SIE.DE'], ['MC.PA','MC.PA'], ['AIR.PA','AIR.PA'],
  ].map(([canonical, display]) =>
    entry(canonical, MARKET_GROUPS.EU_EQUITIES, {
      display,
      assetClass: 'equity',
      region: 'EU',
      exchange: display.endsWith('.DE') ? 'XETRA' : 'EURONEXT',
      scanMode: SCAN_MODE.UNSUPPORTED_DISCLOSURE,
      coverageStatus: COVERAGE_STATUS.UNSUPPORTED,
      providers: {
        [PROVIDERS.EODHD]: display,
        [PROVIDERS.YAHOO]: display,
      },
      notes: 'EU cash equities require explicit exchange routing before Dark Horse can scan them.',
    })
  ),
  ...[
    ['7203.T','7203.T'], ['9984.T','9984.T'], ['0700.HK','0700.HK'], ['9988.HK','9988.HK'],
  ].map(([canonical, display]) =>
    entry(canonical, MARKET_GROUPS.ASIAN_EQUITIES, {
      display,
      assetClass: 'equity',
      region: display.endsWith('.HK') ? 'HK' : 'JP',
      exchange: display.endsWith('.HK') ? 'HKEX' : 'TSE',
      scanMode: SCAN_MODE.UNSUPPORTED_DISCLOSURE,
      coverageStatus: COVERAGE_STATUS.UNSUPPORTED,
      providers: {
        [PROVIDERS.EODHD]: display,
        [PROVIDERS.YAHOO]: display,
      },
      notes: 'Asian cash equities require explicit exchange routing before Dark Horse can scan them.',
    })
  ),

  // Indices.
  entry('NAS100', MARKET_GROUPS.US_INDICES, {
    assetClass: 'index', region: 'US', exchange: 'NASDAQ',
    scanMode: SCAN_MODE.STATIC_CORE,
    providers: { [PROVIDERS.TWELVEDATA]: 'NDX', [PROVIDERS.FMP]: '^NDX', [PROVIDERS.INTERNAL_STATIC]: 'NAS100' },
    notes: 'Legacy static core; ETF/index probes are handled by safeOHLC.',
  }),
  entry('US500', MARKET_GROUPS.US_INDICES, {
    assetClass: 'index', region: 'US', exchange: 'CBOE',
    scanMode: SCAN_MODE.STATIC_CORE,
    providers: { [PROVIDERS.TWELVEDATA]: 'SPX', [PROVIDERS.FMP]: '^GSPC', [PROVIDERS.INTERNAL_STATIC]: 'US500' },
    notes: 'Legacy static core; ETF/index probes are handled by safeOHLC.',
  }),
  entry('DJI', MARKET_GROUPS.US_INDICES, {
    assetClass: 'index', region: 'US', exchange: 'DJI',
    scanMode: SCAN_MODE.STATIC_CORE,
    providers: { [PROVIDERS.TWELVEDATA]: 'DIA', [PROVIDERS.FMP]: '^DJI', [PROVIDERS.INTERNAL_STATIC]: 'DJI' },
    notes: 'Legacy static core; TwelveData uses DIA/^DJI probes in safeOHLC.',
  }),
  entry('GER40', MARKET_GROUPS.GLOBAL_INDICES, {
    assetClass: 'index', region: 'EU', exchange: 'XETRA',
    scanMode: SCAN_MODE.STATIC_CORE,
    providers: { [PROVIDERS.TWELVEDATA]: 'DAX', [PROVIDERS.FMP]: '^GDAXI', [PROVIDERS.INTERNAL_STATIC]: 'GER40' },
    notes: 'Legacy static core.',
  }),
  entry('UK100', MARKET_GROUPS.GLOBAL_INDICES, {
    assetClass: 'index', region: 'UK', exchange: 'FTSE',
    scanMode: SCAN_MODE.STATIC_CORE,
    providers: { [PROVIDERS.TWELVEDATA]: 'UKX', [PROVIDERS.FMP]: '^FTSE', [PROVIDERS.INTERNAL_STATIC]: 'UK100' },
    notes: 'Legacy static core.',
  }),
  ...[
    ['JPN225','JP','NIKKEI','NKX','^N225'],
    ['HK50','HK','HKEX','HSI','^HSI'],
    ['AUS200','AU','ASX','XJO','^AXJO'],
    ['FRA40','EU','EURONEXT','FCHI','^FCHI'],
    ['EU50','EU','STOXX','STOXX50E','^STOXX50E'],
  ].map(([symbol, region, exchange, td, fmp]) =>
    entry(symbol, MARKET_GROUPS.GLOBAL_INDICES, {
      assetClass: 'index',
      region,
      exchange,
      scanMode: SCAN_MODE.PROVIDER_PARTIAL,
      coverageStatus: COVERAGE_STATUS.PARTIAL,
      providers: { [PROVIDERS.TWELVEDATA]: td, [PROVIDERS.FMP]: fmp },
      notes: 'Global index support depends on the live provider plan and safeOHLC probe success.',
    })
  ),

  // Metals, energy, broad commodities.
  ...[
    ['XAUUSD','XAU/USD'], ['XAGUSD','XAG/USD'],
  ].map(([symbol, td]) =>
    entry(symbol, MARKET_GROUPS.METALS, {
      assetClass: 'commodity',
      region: 'GLOBAL',
      exchange: 'OTC',
      scanMode: SCAN_MODE.STATIC_CORE,
      providers: { [PROVIDERS.TWELVEDATA]: td, [PROVIDERS.FMP]: symbol, [PROVIDERS.INTERNAL_STATIC]: symbol },
      notes: 'Legacy static core metal.',
    })
  ),
  ...[
    ['XPTUSD','XPT/USD'], ['XPDUSD','XPD/USD'],
  ].map(([symbol, td]) =>
    entry(symbol, MARKET_GROUPS.METALS, {
      assetClass: 'commodity',
      region: 'GLOBAL',
      exchange: 'OTC',
      scanMode: SCAN_MODE.PROVIDER_PARTIAL,
      coverageStatus: COVERAGE_STATUS.PARTIAL,
      providers: { [PROVIDERS.TWELVEDATA]: td, [PROVIDERS.FMP]: symbol },
      notes: 'Precious-metal cross support varies by provider plan.',
    })
  ),
  entry('USOIL', MARKET_GROUPS.ENERGY, {
    assetClass: 'commodity', region: 'US', exchange: 'NYMEX',
    scanMode: SCAN_MODE.PROVIDER_SUPPORTED,
    providers: { [PROVIDERS.TWELVEDATA]: 'WTI/USD', [PROVIDERS.FMP]: 'CLUSD' },
    notes: 'WTI crude route. Brent/BRENT is intentionally not in the scan universe.',
  }),
  entry('BCOUSD', MARKET_GROUPS.ENERGY, {
    assetClass: 'commodity', region: 'GLOBAL', exchange: 'ICE',
    scanMode: SCAN_MODE.PROVIDER_PARTIAL,
    coverageStatus: COVERAGE_STATUS.PARTIAL,
    providers: { [PROVIDERS.TWELVEDATA]: 'BCO/USD', [PROVIDERS.FMP]: 'BZUSD' },
    notes: 'Brent-style symbol route only; raw BRENT remains excluded because it requires premium provider coverage.',
  }),
  entry('NATGAS', MARKET_GROUPS.ENERGY, {
    assetClass: 'commodity', region: 'US', exchange: 'NYMEX',
    scanMode: SCAN_MODE.PROVIDER_PARTIAL,
    coverageStatus: COVERAGE_STATUS.PARTIAL,
    providers: { [PROVIDERS.TWELVEDATA]: 'NG/USD', [PROVIDERS.FMP]: 'NGUSD' },
    notes: 'Natural gas support varies by provider plan.',
  }),
  ...['CORN','WHEAT','SOYB','COFFEE'].map(s =>
    entry(s, MARKET_GROUPS.COMMODITIES, {
      assetClass: 'commodity',
      region: 'GLOBAL',
      exchange: 'CBOT/ICE',
      scanMode: SCAN_MODE.UNSUPPORTED_DISCLOSURE,
      coverageStatus: COVERAGE_STATUS.UNSUPPORTED,
      providers: { [PROVIDERS.YAHOO]: s },
      notes: 'Agricultural commodity routing is not wired to safeOHLC in this repo.',
    })
  ),

  // Safe-haven overlays and rates/bond ETFs.
  entry('DXY', MARKET_GROUPS.SAFE_HAVENS, {
    assetClass: 'index',
    region: 'US',
    exchange: 'ICE',
    scanMode: SCAN_MODE.PROVIDER_PARTIAL,
    coverageStatus: COVERAGE_STATUS.PARTIAL,
    providers: { [PROVIDERS.TWELVEDATA]: 'UUP', [PROVIDERS.FMP]: 'UUP', [PROVIDERS.YAHOO]: 'DX-Y.NYB' },
    notes: 'DXY cash route is provider-sensitive; UUP proxy is available in the wider repo.',
  }),
  ...['TLT','IEF','SHY','HYG','LQD','UUP','VXX'].map(s =>
    entry(s, MARKET_GROUPS.RATES_BONDS_ETFS, {
      assetClass: 'etf',
      region: 'US',
      exchange: 'NASDAQ/NYSEARCA',
      scanMode: SCAN_MODE.PROVIDER_SUPPORTED,
      providers: { [PROVIDERS.TWELVEDATA]: s, [PROVIDERS.FMP]: s, [PROVIDERS.EODHD]: s + '.US', [PROVIDERS.YAHOO]: s },
      notes: 'US-listed ETF route for rates, credit, dollar, and volatility overlays.',
    })
  ),
]);

const REGISTRY_BY_SYMBOL = Object.freeze(REGISTRY.reduce((acc, row) => {
  acc[row.canonical_symbol] = row;
  return acc;
}, {}));

function isCryptoSymbol(symbol) {
  return CRYPTO_TERMS.test(String(symbol || '').toUpperCase());
}

function cloneRecord(row) {
  return Object.assign({}, row, {
    provider_symbol_map: Object.assign({}, row.provider_symbol_map),
    provider_priority: row.provider_priority.slice(),
  });
}

function getRegistry() {
  return REGISTRY.map(cloneRecord);
}

function getEnabledRegistry() {
  return REGISTRY.filter(r => r.enabled).map(cloneRecord);
}

function getStaticCoreSymbols() {
  return STATIC_CORE_UNIVERSE.slice();
}

function isStaticCoreSymbol(symbol) {
  return STATIC_CORE_UNIVERSE.includes(String(symbol || '').toUpperCase());
}

function getRegistryRecord(symbol) {
  const row = REGISTRY_BY_SYMBOL[String(symbol || '').toUpperCase()] || null;
  return row ? cloneRecord(row) : null;
}

function isProviderSupported(row) {
  if (!row || row.enabled === false) return false;
  if (row.coverage_status === COVERAGE_STATUS.UNSUPPORTED) return false;
  if (row.scan_mode === SCAN_MODE.UNSUPPORTED_DISCLOSURE) return false;
  return true;
}

function getScannableRegistry() {
  return REGISTRY.filter(isProviderSupported).map(cloneRecord);
}

function providerCount(row) {
  if (!row || !row.provider_symbol_map) return 0;
  return Object.values(row.provider_symbol_map).filter(Boolean).length;
}

function buildCoverageSummary(records) {
  const rows = Array.isArray(records) ? records : REGISTRY;
  const groups = {};
  for (const row of rows) {
    if (!row || row.enabled === false) continue;
    const g = row.market_group || 'UNKNOWN';
    if (!groups[g]) {
      groups[g] = {
        market_group: g,
        label: GROUP_LABELS[g] || g,
        intended: 0,
        provider_supported: 0,
        unsupported: 0,
        partial: 0,
      };
    }
    groups[g].intended += 1;
    if (isProviderSupported(row)) groups[g].provider_supported += 1;
    if (row.coverage_status === COVERAGE_STATUS.UNSUPPORTED) groups[g].unsupported += 1;
    if (row.coverage_status === COVERAGE_STATUS.PARTIAL) groups[g].partial += 1;
  }
  return groups;
}

function inferDynamicMoverGroup(symbol, row) {
  const s = String(symbol || '').toUpperCase();
  const exchange = String((row && (row.exchange || row.ex || row.market || row.mic)) || '').toUpperCase();
  const raw = String((row && (row.symbol || row.ticker || row.code)) || symbol || '').toUpperCase();
  if (/\.(AX|AU)$/.test(raw) || exchange === 'ASX') return MARKET_GROUPS.ASX_EQUITIES;
  if (/\.(L|LSE)$/.test(raw) || exchange === 'LSE') return MARKET_GROUPS.UK_LSE_EQUITIES;
  if (/\.(DE|PA|AS|MI|MC|SW)$/.test(raw) || ['XETRA','EURONEXT','FWB'].includes(exchange)) return MARKET_GROUPS.EU_EQUITIES;
  if (/\.(T|HK)$/.test(raw) || ['TSE','HKEX'].includes(exchange)) return MARKET_GROUPS.ASIAN_EQUITIES;
  if (/^[A-Z]{6}$/.test(s)) return MARKET_GROUPS.FX_CROSSES;
  return MARKET_GROUPS.US_EQUITIES;
}

function makeDynamicMoverRecord(symbol, source, row) {
  const group = inferDynamicMoverGroup(symbol, row);
  const exchange = row && (row.exchange || row.ex || row.market || row.mic) || (group === MARKET_GROUPS.US_EQUITIES ? 'NASDAQ/NYSE' : null);
  const supported = group === MARKET_GROUPS.US_EQUITIES;
  return entry(symbol, group, {
    assetClass: /^[A-Z]{6}$/.test(symbol) ? 'fx' : 'equity',
    region: group === MARKET_GROUPS.US_EQUITIES ? 'US' : 'NON_US',
    exchange,
    scanMode: supported ? SCAN_MODE.DYNAMIC_MOVER : SCAN_MODE.UNSUPPORTED_DISCLOSURE,
    coverageStatus: supported ? COVERAGE_STATUS.SUPPORTED : COVERAGE_STATUS.UNSUPPORTED,
    providerPriority: [source || PROVIDERS.FMP, PROVIDERS.FMP, PROVIDERS.EODHD, PROVIDERS.YAHOO],
    providers: {
      [source || PROVIDERS.FMP]: symbol,
      [PROVIDERS.FMP]: symbol,
      [PROVIDERS.EODHD]: group === MARKET_GROUPS.US_EQUITIES ? symbol + '.US' : null,
      [PROVIDERS.YAHOO]: symbol,
    },
    notes: supported
      ? 'Dynamic live mover from provider feed; not part of the legacy static core.'
      : 'Dynamic mover belongs to a market group without safeOHLC exchange routing in this repo.',
  });
}

module.exports = {
  PROVIDERS,
  COVERAGE_STATUS,
  SCAN_MODE,
  MARKET_GROUPS,
  GROUP_LABELS,
  STATIC_CORE_UNIVERSE,
  REGISTRY,
  getRegistry,
  getEnabledRegistry,
  getStaticCoreSymbols,
  isStaticCoreSymbol,
  getRegistryRecord,
  getScannableRegistry,
  isProviderSupported,
  providerCount,
  buildCoverageSummary,
  inferDynamicMoverGroup,
  makeDynamicMoverRecord,
  isCryptoSymbol,
};
