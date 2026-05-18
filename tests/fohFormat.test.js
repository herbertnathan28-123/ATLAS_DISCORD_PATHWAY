#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Unit tests for the shared FOH format helpers (operator brief
// 2026-05-18) — dollars-first price-distance, account-relative
// risk panel, and macro-label expander.

const path = require('path');
const { expandMacroLabels, accountRiskPanel, formatPriceDistance } = require(path.join(__dirname, '..', 'foh', 'foh-format'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + JSON.stringify(err).slice(0, 200) : '')); }

console.log('\nT1 — expandMacroLabels scrubs bare DXY / VIX / US10Y / US2Y:');
if (expandMacroLabels('DXY is bullish').startsWith('US Dollar Strength (DXY) is bullish')) ok('bare DXY → US Dollar Strength (DXY)');
else fail('bare DXY not expanded');
if (expandMacroLabels('VIX elevated above 18').startsWith('Market Volatility (VIX) elevated')) ok('bare VIX → Market Volatility (VIX)');
else fail('bare VIX not expanded');
if (expandMacroLabels('US10Y leads').startsWith('US 10-Year Treasury Yield (US10Y) leads')) ok('bare US10Y → expanded');
else fail('US10Y not expanded');
if (expandMacroLabels('US Dollar Strength (DXY) is bullish').indexOf('US Dollar Strength (DXY) is bullish') === 0) ok('already-expanded copy is not re-wrapped');
else fail('already-expanded copy got re-wrapped');

console.log('\nT2 — accountRiskPanel emits the four scalable account rows:');
const panel = accountRiskPanel();
for (const acct of ['$1,000', '$2,500', '$5,000', '$10,000']) {
  if (panel.indexOf(acct + ' account') >= 0) ok('panel includes ' + acct + ' row');
  else fail('panel missing ' + acct + ' row');
}
if (/0\.25%\s*=\s*\$2\.50/.test(panel)) ok('panel maps 0.25% on $1,000 to $2.50');
else fail('panel 0.25%/$1k math drifted');
if (/1\.00%\s*=\s*\$100/.test(panel)) ok('panel maps 1.00% on $10,000 to $100');
else fail('panel 1.00%/$10k math drifted');

console.log('\nT3 — formatPriceDistance is dollars-first with instrument-aware brackets:');
if (formatPriceDistance(0.00665, 'EURUSD') === '$0.00665 (66.5 pips)') ok('FX major distance: $0.00665 (66.5 pips)');
else fail('FX-major format drifted', formatPriceDistance(0.00665, 'EURUSD'));
if (formatPriceDistance(0.665, 'USDJPY') === '$0.665 (66.5 JPY pips)') ok('JPY pair distance: $0.665 (66.5 JPY pips)');
else fail('JPY-pair format drifted', formatPriceDistance(0.665, 'USDJPY'));
if (formatPriceDistance(12.4, 'XAUUSD') === '$12.40 (124 gold points)') ok('gold distance: $12.40 (124 gold points)');
else fail('gold format drifted', formatPriceDistance(12.4, 'XAUUSD'));
if (formatPriceDistance(0.32, 'XAGUSD') === '$0.320 (32 silver cents)') ok('silver distance: $0.320 (32 silver cents)');
else fail('silver format drifted', formatPriceDistance(0.32, 'XAGUSD'));
if (formatPriceDistance(48, 'US500') === '$48.00 (48 index points)') ok('index distance: $48.00 (48 index points)');
else fail('index format drifted', formatPriceDistance(48, 'US500'));
if (formatPriceDistance(15.53, 'AAPL') === '$15.53 (1553 cents)') ok('equity distance: $15.53 (1553 cents)');
else fail('equity format drifted', formatPriceDistance(15.53, 'AAPL'));

console.log('\nT4 — formatPriceDistance falls back to "Pending" when no figure is supplied:');
if (formatPriceDistance(null, 'EURUSD') === 'Pending') ok('null distance → Pending');
else fail('null distance fallback drifted', formatPriceDistance(null, 'EURUSD'));
if (formatPriceDistance('', 'EURUSD') === 'Pending') ok('empty-string distance → Pending');
else fail('empty-string fallback drifted', formatPriceDistance('', 'EURUSD'));
if (formatPriceDistance('Pending', 'EURUSD') === 'Pending') ok('"Pending" passthrough preserved');
else fail('explicit "Pending" passthrough drifted');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[FOH-FORMAT] FAIL'); process.exit(1); }
console.log('[FOH-FORMAT] PASS');
