'use strict';

// ============================================================
// foh/foh-format.js
//
// Shared FOH user-facing formatters that need to be consistent
// between Market Intel and Dark Horse output:
//
//   • expandMacroLabels(text) — last-line-of-defence expander
//     for free-form narrative copy that arrives from upstream
//     packets. Mirrors the MACRO_LABELS table in
//     coreyMarketIntel.js so Dark Horse can call the same
//     scrubber without a circular dependency.
//
//   • accountRiskPanel() — the operator-brief 2026-05-18
//     account-relative risk lookup. Replaces the legacy
//     "$72,125 model risk" oversized figures with a scalable
//     table the trader can map to their own account.
//
//   • formatPriceDistance(distance, symbol) — dollars-first
//     technical-distance formatter. Returns the canonical
//     "$<price-distance> (<pip/point/tick equivalent>)" string
//     when both pieces are known, falls back to the dollar
//     figure alone when the unit conversion isn't available,
//     and to 'Pending' when no figure is supplied. Instrument
//     handling per the operator brief:
//       FX major (USDxxx / EURxxx etc) — pips
//       JPY pair                       — JPY pips
//       XAUUSD                          — gold points
//       XAGUSD                          — silver cents
//       indices (US500 / NAS100 / …)    — index points
//       equities (AAPL / TSLA / …)      — cents
// ============================================================

const MACRO_LABELS = Object.freeze({
  DXY:   'US Dollar Strength (DXY)',
  VIX:   'Market Volatility (VIX)',
  US10Y: 'US 10-Year Treasury Yield (US10Y)',
  US2Y:  'US 2-Year Treasury Yield (US2Y)',
});

function expandMacroLabels(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const abbr of Object.keys(MACRO_LABELS)) {
    const expanded = MACRO_LABELS[abbr];
    const re = new RegExp('(^|[^A-Za-z0-9(])' + abbr + '(?![A-Za-z0-9)])', 'g');
    out = out.replace(re, (_m, lead) => lead + expanded);
  }
  return out;
}

const ACCOUNT_RISK_PANEL = [
  'Suggested account-based risk (dollars first; choose the line that matches your account):',
  '$1,000 account:  0.25% = $2.50   · 0.50% = $5     · 1.00% = $10',
  '$2,500 account:  0.25% = $6.25   · 0.50% = $12.50 · 1.00% = $25',
  '$5,000 account:  0.25% = $12.50  · 0.50% = $25    · 1.00% = $50',
  '$10,000 account: 0.25% = $25     · 0.50% = $50    · 1.00% = $100',
].join('\n');

function accountRiskPanel() {
  return ACCOUNT_RISK_PANEL;
}

// Map symbol → instrument-aware unit + scale factor so we can
// convert a raw price-distance into the appropriate technical
// unit count for the bracketed suffix. Scale is "1 unit per
// scale of price". E.g. FX major pip = 0.0001, JPY pip = 0.01,
// silver cent = 0.01, gold point = 0.1, index point = 1.
function _instrumentProfile(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (!s) return null;
  if (/^XAUUSD|^GOLD/.test(s))                  return { unit: 'gold points', scale: 0.1,    decimals: 2 };
  if (/^XAGUSD|^SILVER/.test(s))                return { unit: 'silver cents', scale: 0.01,  decimals: 3 };
  if (/JPY$/.test(s) && /^[A-Z]{6}$/.test(s))   return { unit: 'JPY pips', scale: 0.01,      decimals: 3 };
  if (/^[A-Z]{6}$/.test(s))                     return { unit: 'pips', scale: 0.0001,        decimals: 5 };
  if (/^(NAS100|US500|US30|GER40|UK100|JP225|HK50|AUS200|EU50)$/.test(s)) return { unit: 'index points', scale: 1, decimals: 2 };
  // Equity ticker — treat as dollars + cents.
  if (/^[A-Z]{1,5}$/.test(s))                   return { unit: 'cents', scale: 0.01, decimals: 2 };
  return null;
}

function formatPriceDistance(distance, symbol) {
  if (distance == null || distance === '' || distance === 'Pending') return 'Pending';
  const num = typeof distance === 'number' ? distance : parseFloat(distance);
  if (!Number.isFinite(num)) return String(distance);
  const profile = _instrumentProfile(symbol);
  const absDist = Math.abs(num);
  // JPY pair / gold / silver use the local currency dollar sign
  // pre-formatted ('¥', '$' etc) where the caller wants it; the
  // helper returns the bare dollar figure with the instrument
  // bracket and lets the caller prefix '¥' for JPY pairs if they
  // want. Default prefix is '$' (matches FX-major / index /
  // equity / metal price quoting).
  const dollarStr = '$' + absDist.toFixed(profile ? profile.decimals : 5);
  if (!profile) return dollarStr;
  const unitCount = absDist / profile.scale;
  const rounded = Math.round(unitCount);
  const isInt = Math.abs(unitCount - rounded) < 1e-6;
  const unitStr = (isInt              ? rounded.toFixed(0)
                 : unitCount >= 100   ? unitCount.toFixed(0)
                 : unitCount >= 10    ? unitCount.toFixed(1)
                 :                      unitCount.toFixed(2))
    + ' ' + profile.unit;
  return dollarStr + ' (' + unitStr + ')';
}

module.exports = { expandMacroLabels, accountRiskPanel, formatPriceDistance, MACRO_LABELS };
