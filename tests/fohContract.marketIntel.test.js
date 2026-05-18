#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/fohContract.marketIntel.test.js
//
// Operator brief 2026-05-17 (assurance directive). Validates
// Market Intel against the central FOH contract (foh/config/
// fohOutputContract.js) using the pre-send validator.
// ============================================================

const path = require('path');
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const miViewModel = require(path.join(__dirname, '..', 'foh', 'adapters', 'marketIntelViewModel'));
const miShell = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell'));
const { validateFohOutput } = require(path.join(__dirname, '..', 'foh', 'validate', 'validateFohOutput'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

function buildAndValidate(engineInput, label) {
  const packet = buildMarketIntelPacket({ engine: engineInput });
  const vm = miViewModel.toViewModel(packet);
  const text = miShell.buildDiscordTextSummary(vm, { surface: 'market_intel', maxDiscordChunkChars: 100000 });
  const v = validateFohOutput({ packet, viewModel: vm, discordText: text });
  if (v.ok) ok(label + ' → contract OK');
  else fail(label + ' → contract failed', v.failures.slice(0, 5).join(' | '));
  return { packet, vm, text, v };
}

console.log('\nT1 — High-impact CPI day passes the contract:');
buildAndValidate({
  kind: 'daily',
  mood: { severity: 'HIGH', label: 'High — clustered catalyst exposure', discs: '🔴🔴🔴🔴⚫' },
  eventClusters: [
    { currency: 'USD', severity: 'HIGH', events: [{ title: 'CPI (USD)', severity: 'HIGH', time: '12:30 UTC', currency: 'USD' }]},
    { currency: 'EUR', severity: 'HIGH', events: [{ title: 'ECB Lagarde Speech', severity: 'HIGH', time: '14:00 UTC', currency: 'EUR' }]},
  ],
}, 'CPI + ECB cluster');

console.log('\nT2 — Quiet calendar passes the contract:');
buildAndValidate({
  kind: 'daily',
  mood: { severity: 'LOW', label: 'Low — driver-led tape', discs: '🔵🔵⚫⚫⚫' },
  eventClusters: [],
}, 'Quiet calendar');

console.log('\nT3 — Mixed-currency cluster day passes the contract:');
buildAndValidate({
  kind: 'daily',
  mood: { severity: 'ELEV', label: 'Elevated — multi-currency cluster', discs: '🟠🟠🟠🟠⚫' },
  eventClusters: [
    { currency: 'USD', severity: 'HIGH', events: [{ title: 'Non Farm Payrolls', severity: 'HIGH', time: '12:30 UTC', currency: 'USD' }]},
    { currency: 'GBP', severity: 'HIGH', events: [{ title: 'BOE Rate Decision', severity: 'HIGH', time: '11:00 UTC', currency: 'GBP' }]},
    { currency: 'JPY', severity: 'MEDIUM', events: [{ title: 'Tokyo CPI', severity: 'MEDIUM', time: '23:30 UTC', currency: 'JPY' }]},
  ],
}, 'Mixed cluster');

console.log('\nT4 — Central bank speech day passes the contract:');
buildAndValidate({
  kind: 'pre_event',
  mood: { severity: 'HIGH' },
  eventClusters: [{ currency: 'USD', severity: 'HIGH', events: [{ title: 'Powell speech at Jackson Hole', severity: 'HIGH', time: '14:00 UTC', currency: 'USD' }]}],
}, 'Powell speech');

console.log('\nT5 — GDP day passes the contract:');
buildAndValidate({
  kind: 'released',
  mood: { severity: 'ELEV' },
  eventClusters: [{ currency: 'USD', severity: 'HIGH', events: [{ title: 'US GDP Q1 Advance Release', severity: 'HIGH', time: '12:30 UTC', currency: 'USD' }]}],
}, 'GDP release');

console.log('\nT6 — Employment day passes the contract:');
buildAndValidate({
  kind: 'daily',
  mood: { severity: 'HIGH' },
  eventClusters: [{ currency: 'USD', severity: 'HIGH', events: [{ title: 'Non Farm Payrolls', severity: 'HIGH', time: '12:30 UTC', currency: 'USD' }]}],
}, 'NFP day');

console.log('\nT7 — Contract REJECTS a packet with thin briefing summary:');
const { packet } = (function () {
  return { packet: buildMarketIntelPacket({ engine: { kind:'daily', mood:{ severity:'HIGH' }, eventClusters:[{currency:'USD',events:[{title:'CPI',time:'12:30',severity:'HIGH'}]}] } }) };
})();
// Mutate briefingSummary to be thin.
packet.briefingSummary = { primaryRead: 'x', operationalMeaning: 'y', keyMarkets: ['DXY'], currentRisk: 'z' };
const vm7 = miViewModel.toViewModel(packet);
const text7 = miShell.buildDiscordTextSummary(vm7, { surface: 'market_intel', maxDiscordChunkChars: 100000 });
const v7 = validateFohOutput({ packet, viewModel: vm7, discordText: text7 });
if (!v7.ok && v7.failures.some(f => /too_thin:BRIEFING_SUMMARY/.test(f))) ok('Thin briefing summary rejected'); else fail('Thin briefing summary should reject', JSON.stringify(v7.failures.slice(0, 5)));

console.log('\nT8 — Contract REJECTS a packet with banned "lot" content:');
const packet8 = buildMarketIntelPacket({ engine: { kind:'daily', mood:{severity:'HIGH'}, eventClusters:[{currency:'USD',events:[{title:'CPI',time:'12:30',severity:'HIGH'}]}] } });
packet8.affectedMarketsExpanded[0].riskNote = 'Standard 1 lot EURUSD exposure carries $300–$800 swing';
const vm8 = miViewModel.toViewModel(packet8);
const text8 = miShell.buildDiscordTextSummary(vm8, { surface: 'market_intel', maxDiscordChunkChars: 100000 });
const v8 = validateFohOutput({ packet: packet8, viewModel: vm8, discordText: text8 });
if (!v8.ok && v8.failures.some(f => /banned_pattern.*lots?/.test(f))) ok('Banned "lot" content rejected'); else fail('Banned lot content should reject', JSON.stringify(v8.failures.slice(0, 5)));

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[FOH-CONTRACT-MI] FAIL'); process.exit(1); }
console.log('[FOH-CONTRACT-MI] PASS');
process.exit(0);
