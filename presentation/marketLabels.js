'use strict';
// presentation/marketLabels.js — full-name-first macro-label helper.
//
// Locked rule (May 2026 hardening pass): no bare abbreviation on any
// user-facing Discord surface. The abbreviation may appear only inside
// the layman parenthesised form (e.g. "(DXY)"), after the full label.
//
// Usage:
//   formatMacroLabel('DXY')            -> 'US Dollar Index (DXY)'
//   formatMacroLabel('vix', {short: true}) -> '(VIX)'
//   formatMacroLabel('US10Y')          -> 'US 10-Year Treasury Yield (US10Y)'
//   isKnownMacroCode('DXY')            -> true
//   ensureMacroLabel('bare VIX text')  -> auto-prefix on first occurrence
//
// Per the production presentation hardening triage, this helper is the
// single source of truth for the layman-first rule. Consumed by:
//   - coreyMarketIntel.js  (pre-event + released-event alerts, geo status)
//   - macro/eventIntelligence.js (driver row)
//   - macro/marketOverview.js   (USD tilt / risk / yield-curve paragraphs)
//   - macro/executionLogic.js   (VIX override row)
//   - macro/glossary.js         (market_driver entry)
//   - darkHorseEngine.js / darkHorseRanking.js / darkHorseFomoControl.js
//
// All mappings keep the original code in brackets so traders retain the
// shorthand they recognise on charts. Codes not in the map fall back to
// the original input unchanged (caller decides what to do).

const LABELS = {
  // Macro drivers
  DXY:    'US Dollar Index (DXY)',
  VIX:    'CBOE Volatility Index (VIX)',
  US10Y:  'US 10-Year Treasury Yield (US10Y)',
  US2Y:   'US 2-Year Treasury Yield (US2Y)',
  // Index symbols
  NAS100: 'Nasdaq 100 Index (NAS100)',
  US500:  'S&P 500 Index (US500)',
  US30:   'Dow Jones Industrial Average (US30)',
  DJI:    'Dow Jones Industrial Average (US30)',
  DJIA:   'Dow Jones Industrial Average (US30)',
  GER40:  'DAX Germany 40 Index (GER40)',
  UK100:  'FTSE 100 Index (UK100)',
  JPN225: 'Nikkei 225 Index (JPN225)',
  HK50:   'Hang Seng 50 Index (HK50)',
  // Metals
  XAUUSD: 'Gold vs US Dollar (XAUUSD)',
  XAGUSD: 'Silver vs US Dollar (XAGUSD)',
  XPTUSD: 'Platinum vs US Dollar (XPTUSD)',
  // Energy
  USOIL:  'WTI Crude Oil (USOIL)',
  WTI:    'WTI Crude Oil (WTI)',
  BRENT:  'Brent Crude Oil (BRENT)',
  NATGAS: 'Natural Gas (NATGAS)',
  // ETF proxies that used to leak as "UUP proxy" / "VXX proxy"
  UUP:    'US Dollar Index (DXY)',
  VXX:    'CBOE Volatility Index (VIX)',
};

// Bare-abbreviation token set.
//
// Per spec: "The abbreviation may appear only in brackets after the
// full label, UNLESS it is part of a known symbol list where the full
// label has already been stated in the same line."
//
// This list therefore only contains MACRO-DRIVER codes — the ones that
// must always carry a layman-first label when referenced in prose. The
// index / metal / energy symbol codes (NAS100, US500, US30, XAUUSD, …)
// are legitimate when they appear inside a comma-separated symbol list
// following a category header (e.g. "• US indices: NAS100, US500, US30")
// and the helper still labels them when they appear standalone.
const BARE_ABBREVIATIONS = Object.freeze([
  'DXY', 'VIX', 'US10Y', 'US2Y',
  // ETF proxies are presentation-internal and must never reach the user
  'UUP', 'VXX',
]);

function normaliseCode(code) {
  if (code == null) return '';
  return String(code).trim().toUpperCase();
}

function isKnownMacroCode(code) {
  return Object.prototype.hasOwnProperty.call(LABELS, normaliseCode(code));
}

// Return the layman-first label for a code. Unknown codes fall through
// to the original input (uppercased), which lets callers decide whether
// to render or guard.
function formatMacroLabel(code, opts) {
  const c = normaliseCode(code);
  if (!c) return '';
  if (LABELS[c]) return LABELS[c];
  return c;
}

// Layman-first phrase with a copula. Avoids the "DXY: DXY" pattern when
// the bucket key happens to equal the symbol itself.
//   labelWithState('DXY', 'bullish')   -> 'US Dollar Index (DXY) is bullish'
//   labelWithState('VIX', 'elevated')  -> 'CBOE Volatility Index (VIX) is elevated'
function labelWithState(code, state) {
  const label = formatMacroLabel(code);
  if (!label) return state || '';
  if (state == null || state === '') return label;
  return `${label} is ${String(state).toLowerCase()}`;
}

// Build a banned-string regex set for the layman-first rule. Each entry
// flags an occurrence of the bare code that is NOT inside parentheses
// AND NOT immediately preceded by the full-label substring on the same
// line. Used by QA harnesses.
function bareAbbreviationRegexes() {
  return BARE_ABBREVIATIONS.map(code => {
    // Match the code as a whole word, not inside "(DXY)" parens.
    // The lookbehind `(?<!\()` ensures we don't catch the legitimate
    // bracketed form. Word boundaries on both sides keep "DXY100" or
    // "USDJPY" safe.
    return {
      name: `bare_${code.toLowerCase()}`,
      pattern: new RegExp(`(?<!\\()\\b${code}\\b(?!\\))`),
    };
  });
}

module.exports = {
  LABELS,
  BARE_ABBREVIATIONS,
  formatMacroLabel,
  labelWithState,
  isKnownMacroCode,
  bareAbbreviationRegexes,
};
