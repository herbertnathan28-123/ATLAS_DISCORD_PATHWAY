#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (info ? ' :: ' + info : '')); }
}

console.log('\n[T1] dashboard source audit consumes chart/price/OHLC state');
ok('postJanePacketToDashboard accepts renderMeta', /function postJanePacketToDashboard\(symbol, corey, spideyHTF, spideyLTF, jane, renderMeta = \{\}\)/.test(indexSrc));
ok('dashboard pass includes chart validation and coverage', /postJanePacketToDashboard\(symbol, corey, spideyHTF, spideyLTF, jane, \{ validation, coverage \}\)/.test(indexSrc));
ok('marketData source uses composed audit string', /marketData:\s+marketDataAudit/.test(indexSrc));
ok('source audit includes chart data key', /chartData:\s+`\$\{chartDataStatus\}: \$\{chartDataDetail\}`/.test(indexSrc));
ok('source audit includes quote key', /quote:\s+quoteStatus/.test(indexSrc));
ok('source audit includes OHLC key', /ohlc:\s+`\$\{ohlcStatus\}: \$\{ohlcAuditLine\}`/.test(indexSrc));
ok('sourceAudit object is emitted', /sourceAudit:\s*\{/.test(indexSrc));
ok('visible chart price source is named', /chart-img chart layer \(visible price from rendered chart\)/.test(indexSrc));
ok('OHLC audit uses formatOhlcCoverage', /formatOhlcCoverage\(dashboardCoverage\)/.test(indexSrc));

console.log('\n[T2] dashboard source audit labels are separated');
ok('macro context remains separate', /macroContext:\s+coreyStatus/.test(indexSrc));
ok('market structure remains separate', /marketStructure:\s+spideyStatus/.test(indexSrc));
ok('final assessment remains separate', /finalAssessment:\s+janeStatus/.test(indexSrc));
ok('historical reference remains separate', /historicalReference:\s+historicalStatus/.test(indexSrc));

console.log('\n[T3] user-facing labels corrected');
ok('Mechanism Chain heading removed from index.js', !/\*\*MECHANISM CHAIN/.test(indexSrc));
ok('Market Impact heading present', /\*\*MARKET IMPACT \(HOW THIS REACHES PRICE\)\*\*/.test(indexSrc));
ok('US Dollar Strength (DXY) terminology present', /US Dollar Strength \(DXY\)/.test(indexSrc));
ok('Market Volatility (VIX) terminology present', /Market Volatility \(VIX\)/.test(indexSrc));

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) process.exit(1);
console.log('[DASHBOARD-SOURCE-AUDIT] PASS');
