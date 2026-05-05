'use strict';
// macro/dataCoverage.js — per-symbol, per-resolution OHLC provider coverage.
//
// Replaces the broad "[DATA-SOURCE] ohlc=fmp+twelvedata" line with a
// truthful, resolution-level summary the user can reason about.
//
// Public API:
//   const cov = createCoverage(symbol);
//   cov.record(resolution, provider, candleCount, errorReason?)
//   cov.summarise()              -> { state, perResolution, line }
//   cov.spideyState({htfRequired,ltfRequired,desired}) -> 'OK'|'PARTIAL'|'UNAVAILABLE'
//   formatDataSourceLine(symbol, cov, extraSources)    -> the [DATA-SOURCE] line
//
// Provider tags used by the recorder:
//   'twelvedata' — TD primary
//   'twelvedata-probe:<sym>' — TD via index probe list, with the candidate
//   'fmp-fallback'           — FMP last-resort fallback
//   'none'                   — both providers failed for this resolution

const KNOWN_PROVIDERS = new Set(['twelvedata', 'fmp-fallback', 'none']);

function createCoverage(symbol) {
  const perResolution = Object.create(null); // res -> { provider, candidate?, candles, error? }
  return {
    symbol,
    record(resolution, provider, candleCount = 0, errorReason = null, candidate = null) {
      const p = (provider || 'none').split(':')[0];
      perResolution[resolution] = {
        provider: p === 'twelvedata-probe' ? 'twelvedata' : p,
        candidate: candidate || (provider && provider.includes(':') ? provider.split(':').slice(1).join(':') : null),
        candles: candleCount,
        error: errorReason || null
      };
    },
    perResolution,
    // Aggregate state — OK, PARTIAL, UNAVAILABLE.
    summarise() {
      const entries = Object.entries(perResolution);
      const ok   = entries.filter(([, v]) => v.provider !== 'none' && v.candles > 0);
      const fail = entries.filter(([, v]) => v.provider === 'none' || v.candles === 0);
      const total = entries.length;
      let state = 'UNAVAILABLE';
      if (total > 0 && ok.length === total) state = 'OK';
      else if (ok.length > 0)               state = 'PARTIAL';
      return {
        state,
        total,
        okCount: ok.length,
        failedCount: fail.length,
        perResolution
      };
    },
    // Spidey state from coverage. htfRequired/ltfRequired = arrays of resolutions
    // that MUST be present for Spidey to declare OK. Anything missing in those
    // arrays demotes Spidey to PARTIAL or UNAVAILABLE.
    spideyState({ htfRequired = ['1W', '1D', '240', '60'], ltfRequired = ['30', '15', '5', '1'] } = {}) {
      const present = (res) => {
        const v = perResolution[res];
        return v && v.provider !== 'none' && v.candles > 0;
      };
      const htfPresent = htfRequired.filter(present);
      const ltfPresent = ltfRequired.filter(present);
      const htfMissing = htfRequired.filter(r => !present(r));
      const ltfMissing = ltfRequired.filter(r => !present(r));

      let state = 'OK';
      let reason = null;
      // Required HTF/LTF missing -> UNAVAILABLE (no structure read).
      if (htfPresent.length === 0 && ltfPresent.length === 0) {
        state = 'UNAVAILABLE';
        reason = 'no_structural_timeframes_available';
      } else if (htfPresent.length === 0) {
        state = 'UNAVAILABLE';
        reason = 'all_htf_missing';
      } else if (ltfPresent.length === 0) {
        state = 'PARTIAL';
        reason = 'all_ltf_missing_only_htf_available';
      } else if (htfMissing.length > 0 || ltfMissing.length > 0) {
        state = 'PARTIAL';
        reason = `missing=${[...htfMissing, ...ltfMissing].join(',')}`;
      }
      return { state, reason, htfPresent, htfMissing, ltfPresent, ltfMissing };
    }
  };
}

// Build the truthful resolution-level [DATA-SOURCE] line.
//   ohlc=PARTIAL 1D:twelvedata 60:twelvedata 30:fmp-fallback 15:none 5:fmp-fallback 1:twelvedata
function formatOhlcCoverage(cov) {
  const summary = cov.summarise();
  if (summary.total === 0) return 'ohlc=none';
  const order = ['1W','1D','240','60','30','15','5','1'];
  const sorted = order.filter(r => cov.perResolution[r] != null);
  // Plus any resolutions outside the canonical list (defensive).
  for (const r of Object.keys(cov.perResolution)) if (!sorted.includes(r)) sorted.push(r);
  const parts = sorted.map(r => {
    const v = cov.perResolution[r];
    const tag = (v.provider === 'none')
      ? 'none'
      : (v.candidate && v.provider === 'twelvedata' ? `twelvedata(${v.candidate})` : v.provider);
    return `${r}:${tag}`;
  });
  return `ohlc=${summary.state} ${parts.join(' ')}`;
}

function formatDataSourceLine(symbol, cov, extra = {}) {
  const ohlcLine = formatOhlcCoverage(cov);
  const fields = [
    `symbol=${symbol}`,
    `quote=${extra.quote || 'unavailable'}`,
    ohlcLine,
    `fundamentals=${extra.fundamentals || 'unavailable'}`,
    `calendar=${extra.calendar || 'unavailable'}`,
    `historical=${extra.historical || 'unavailable'}`,
    `corey=${extra.corey || 'unavailable'}`,
    `coreyClone=${extra.coreyClone || 'unavailable: not implemented'}`,
    `spidey=${extra.spidey || 'unavailable'}`,
    `jane=${extra.jane || 'unavailable'}`
  ];
  return `[DATA-SOURCE] ${fields.join(' ')}`;
}

module.exports = { createCoverage, formatDataSourceLine, formatOhlcCoverage, KNOWN_PROVIDERS };
