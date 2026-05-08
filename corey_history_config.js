'use strict';

/**
 * ATLAS FX — Corey Clone Phase D historical-cache configuration.
 *
 * Resolves ATLAS_HISTORICAL_CACHE_DIR with documented defaults:
 *   - Render production:   /data/historical/
 *   - Local fallback:      ./data/historical/
 *
 * No path is hard-coded outside this module. All cache-aware code
 * (harvester, reader, matcher, validator, scripts) MUST resolve via
 * this module.
 */

const path = require('path');
const fs   = require('fs');

const RENDER_DEFAULT = '/data/historical';
const LOCAL_FALLBACK = path.resolve(process.cwd(), 'data', 'historical');

function resolveCacheDir() {
  const env = process.env.ATLAS_HISTORICAL_CACHE_DIR;
  if (env && typeof env === 'string' && env.trim().length) return env.trim();
  // Render's persistent disk is mounted at /data — present iff this is
  // a Render production instance with the disk attached. Fall back to
  // the local repo dir for dev / CI / sandbox.
  try {
    if (fs.existsSync('/data') && fs.statSync('/data').isDirectory()) return RENDER_DEFAULT;
  } catch (_e) { /* ignore */ }
  return LOCAL_FALLBACK;
}

const CACHE_DIR = resolveCacheDir();

const PROVIDER_ALLOWLIST = ['twelvedata'];

const TIMEFRAME = '1D';

// Freshness boundaries (days since last_verified_at). See Spec §STALE.
const FRESHNESS = Object.freeze({
  freshDays:               14,
  limitationFlagDays:      30,
  staleConfidenceFactor:   0.80,
  staleDays:               90,
  // > 90 days OR missing => severely stale → PARTIAL with reason
});

// Cohort thresholds — Spec §SIMILARITY METRIC + §REAL EVIDENCE
const COHORT = Object.freeze({
  matchSimilarityThreshold:  0.70,
  minCohortSize:             10,
  maxCohortSize:             50,
  cohortFactorFullCredit:    30,
});

// Confidence ACTIVE floor — Spec §ACTIVE floor
const ACTIVE_CONFIDENCE_FLOOR = 0.40;

// Outcome classifier — Spec §OUTCOME LABELS
const OUTCOME = Object.freeze({
  primaryHorizonDays:        5,
  sensitivityHorizonsDays:   [1, 3, 10],   // computed/stored, not fed to Jane in D
  thresholdAtrMultiple:      1.0,
  atrPeriod:                 14,
});

// Similarity metric — Spec §SIMILARITY METRIC soft variables
const SIMILARITY = Object.freeze({
  zScoreWindowBars: 252,
  variables: [
    { id: 'S1',  name: 'return_5',                weight: 0.18 },
    { id: 'S2',  name: 'return_10',               weight: 0.12 },
    { id: 'S3',  name: 'return_20',               weight: 0.08 },
    { id: 'S4',  name: 'atr_pct_of_price',        weight: 0.12 },
    { id: 'S5',  name: 'body_range_ratio_5',      weight: 0.08 },
    { id: 'S6',  name: 'wick_imbalance_5',        weight: 0.05 },
    { id: 'S7',  name: 'dist_from_high_20_atr',   weight: 0.08 },
    { id: 'S8',  name: 'dist_from_low_20_atr',    weight: 0.08 },
    { id: 'S9',  name: 'vol_regime_pct_252',      weight: 0.13 },
    { id: 'S10', name: 'trend_slope_20_atr',      weight: 0.08 },
  ],
});

// Allowed expected-calendar values — Spec §EXPECTED CALENDARS
const ALLOWED_CALENDARS = Object.freeze(['fx_5x24', 'equity_us', 'equity_lse', 'equity_eu']);

// Annex A — symbols + calendars + display + fetch-symbol routing.
// Symbols are transcribed VERBATIM in source order from
// darkHorseEngine.js DEFAULT_UNIVERSE/DH_UNIVERSE @ 99eb0f0.
const ANNEX_A = Object.freeze([
  // FX Majors (7) — fx_5x24
  { rank:  1, atlas: 'EURUSD', display: 'EURUSD', fetch: 'EUR/USD', calendar: 'fx_5x24',  group: 'fx_major'  },
  { rank:  2, atlas: 'GBPUSD', display: 'GBPUSD', fetch: 'GBP/USD', calendar: 'fx_5x24',  group: 'fx_major'  },
  { rank:  3, atlas: 'USDJPY', display: 'USDJPY', fetch: 'USD/JPY', calendar: 'fx_5x24',  group: 'fx_major'  },
  { rank:  4, atlas: 'AUDUSD', display: 'AUDUSD', fetch: 'AUD/USD', calendar: 'fx_5x24',  group: 'fx_major'  },
  { rank:  5, atlas: 'USDCAD', display: 'USDCAD', fetch: 'USD/CAD', calendar: 'fx_5x24',  group: 'fx_major'  },
  { rank:  6, atlas: 'USDCHF', display: 'USDCHF', fetch: 'USD/CHF', calendar: 'fx_5x24',  group: 'fx_major'  },
  { rank:  7, atlas: 'NZDUSD', display: 'NZDUSD', fetch: 'NZD/USD', calendar: 'fx_5x24',  group: 'fx_major'  },

  // FX Crosses (14) — fx_5x24
  { rank:  8, atlas: 'EURGBP', display: 'EURGBP', fetch: 'EUR/GBP', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank:  9, atlas: 'EURJPY', display: 'EURJPY', fetch: 'EUR/JPY', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 10, atlas: 'GBPJPY', display: 'GBPJPY', fetch: 'GBP/JPY', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 11, atlas: 'AUDJPY', display: 'AUDJPY', fetch: 'AUD/JPY', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 12, atlas: 'CADJPY', display: 'CADJPY', fetch: 'CAD/JPY', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 13, atlas: 'CHFJPY', display: 'CHFJPY', fetch: 'CHF/JPY', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 14, atlas: 'EURAUD', display: 'EURAUD', fetch: 'EUR/AUD', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 15, atlas: 'EURCAD', display: 'EURCAD', fetch: 'EUR/CAD', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 16, atlas: 'GBPAUD', display: 'GBPAUD', fetch: 'GBP/AUD', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 17, atlas: 'GBPCAD', display: 'GBPCAD', fetch: 'GBP/CAD', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 18, atlas: 'GBPCHF', display: 'GBPCHF', fetch: 'GBP/CHF', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 19, atlas: 'AUDCAD', display: 'AUDCAD', fetch: 'AUD/CAD', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 20, atlas: 'AUDNZD', display: 'AUDNZD', fetch: 'AUD/NZD', calendar: 'fx_5x24',  group: 'fx_cross'  },
  { rank: 21, atlas: 'NZDCAD', display: 'NZDCAD', fetch: 'NZD/CAD', calendar: 'fx_5x24',  group: 'fx_cross'  },

  // Indices (5)
  { rank: 22, atlas: 'NAS100', display: 'NAS100', fetch: 'NAS100', calendar: 'equity_us', group: 'index'    },
  { rank: 23, atlas: 'US500',  display: 'US500',  fetch: 'US500',  calendar: 'equity_us', group: 'index'    },
  { rank: 24, atlas: 'DJI',    display: 'DJI',    fetch: 'DJI',    calendar: 'equity_us', group: 'index'    },
  { rank: 25, atlas: 'GER40',  display: 'GER40',  fetch: 'GER40',  calendar: 'equity_eu', group: 'index'    },
  { rank: 26, atlas: 'UK100',  display: 'UK100',  fetch: 'UK100',  calendar: 'equity_lse',group: 'index'    },

  // Equities (9) — equity_us
  { rank: 27, atlas: 'NVDA',   display: 'NVDA',   fetch: 'NVDA',   calendar: 'equity_us', group: 'equity'   },
  { rank: 28, atlas: 'AMD',    display: 'AMD',    fetch: 'AMD',    calendar: 'equity_us', group: 'equity'   },
  { rank: 29, atlas: 'ASML',   display: 'ASML',   fetch: 'ASML',   calendar: 'equity_us', group: 'equity'   },
  { rank: 30, atlas: 'AAPL',   display: 'AAPL',   fetch: 'AAPL',   calendar: 'equity_us', group: 'equity'   },
  { rank: 31, atlas: 'MSFT',   display: 'MSFT',   fetch: 'MSFT',   calendar: 'equity_us', group: 'equity'   },
  { rank: 32, atlas: 'META',   display: 'META',   fetch: 'META',   calendar: 'equity_us', group: 'equity'   },
  { rank: 33, atlas: 'GOOGL',  display: 'GOOGL',  fetch: 'GOOGL',  calendar: 'equity_us', group: 'equity'   },
  { rank: 34, atlas: 'AMZN',   display: 'AMZN',   fetch: 'AMZN',   calendar: 'equity_us', group: 'equity'   },
  { rank: 35, atlas: 'TSLA',   display: 'TSLA',   fetch: 'TSLA',   calendar: 'equity_us', group: 'equity'   },

  // Commodities (2) — fx_5x24 per spec
  { rank: 36, atlas: 'XAUUSD', display: 'XAUUSD', fetch: 'XAU/USD', calendar: 'fx_5x24',  group: 'metal'    },
  { rank: 37, atlas: 'XAGUSD', display: 'XAGUSD', fetch: 'XAG/USD', calendar: 'fx_5x24',  group: 'metal'    },
]);

const ATLAS_INDEX = (() => {
  const m = new Map();
  for (const row of ANNEX_A) m.set(row.atlas, row);
  return m;
})();

function getSymbol(atlas) {
  const r = ATLAS_INDEX.get(atlas);
  return r ? Object.assign({}, r) : null;
}

// File-system layout per spec §CACHE STRUCTURE
function manifestPath()                  { return path.join(CACHE_DIR, '_manifest.json'); }
function runsDir()                       { return path.join(CACHE_DIR, '_runs'); }
function runFilePath(fetchRunId)         { return path.join(runsDir(), `${fetchRunId}.json`); }
function symbolDir(atlas)                { return path.join(CACHE_DIR, atlas); }
function jsonlPath(atlas, timeframe)     { return path.join(symbolDir(atlas), `${timeframe || TIMEFRAME}.jsonl`); }

module.exports = {
  CACHE_DIR,
  RENDER_DEFAULT,
  LOCAL_FALLBACK,
  PROVIDER_ALLOWLIST,
  TIMEFRAME,
  FRESHNESS,
  COHORT,
  ACTIVE_CONFIDENCE_FLOOR,
  OUTCOME,
  SIMILARITY,
  ALLOWED_CALENDARS,
  ANNEX_A,
  ATLAS_INDEX,
  getSymbol,
  manifestPath,
  runsDir,
  runFilePath,
  symbolDir,
  jsonlPath,
};
