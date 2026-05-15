#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// MARKET_INTEL FOH v6 PREVIEW
//
// Renders every Market Intel surface against representative
// fixtures so reviewers can eyeball the FOH v6 dialect without
// firing live webhooks. Prints the rendered content blocks, the
// per-payload size, and the headroom against the Discord 1900-
// char safe cap.
//
//   node scripts/preview_market_intel_foh_v6.js
//
// Not wired into npm scripts — preview is on-demand.
// ============================================================

const path = require('path');
const mi   = require(path.join(__dirname, '..', 'coreyMarketIntel.js'));

const SAFE_CAP = 1900;
const NOW = Date.now();

function banner(label) {
  const line = '═'.repeat(72);
  console.log('\n' + line);
  console.log('  ' + label);
  console.log(line);
}

function preview(label, content) {
  banner(label + '  ·  ' + content.length + ' chars  ·  headroom ' + (SAFE_CAP - content.length));
  console.log(content);
}

// ── PRE-EVENT FIXTURES ──
preview(
  'PRE-EVENT · T-1H · CPI (USD)',
  mi.buildPreEventAlertPayload(
    { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 60 * 60 * 1000, forecast: '3.2%', previous: '3.0%' },
    60,
    { health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' }, geoLevel: 'moderate' }
  ).content
);

preview(
  'PRE-EVENT · T-30M · ECB Rate Decision',
  mi.buildPreEventAlertPayload(
    { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', scheduled_time: NOW + 30 * 60 * 1000 },
    30,
    { health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' }, geoLevel: 'low' }
  ).content
);

preview(
  'PRE-EVENT · T-RELEASE · Geopolitical shock',
  mi.buildPreEventAlertPayload(
    { title: 'Tariff Announcement (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 1 * 60 * 1000 },
    1,
    { health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' }, geoLevel: 'high' }
  ).content
);

// ── RELEASED-EVENT FIXTURES ──
preview(
  'RELEASED · CPI (USD) — hot print',
  mi.buildReleasedEventAlertPayload(
    { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW - 5 * 60 * 1000, actual: '3.5%', forecast: '3.2%', previous: '3.0%' },
    { health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' }, geoLevel: 'moderate' }
  ).content
);

preview(
  'RELEASED · NFP — soft print',
  mi.buildReleasedEventAlertPayload(
    { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high', scheduled_time: NOW - 5 * 60 * 1000, actual: '90k', forecast: '180k', previous: '160k' },
    { health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' }, geoLevel: 'low' }
  ).content
);

// ── DAILY BULLETIN FIXTURES ──
preview(
  'DAILY · quiet day (no scheduled high-impact)',
  mi.buildDailyBulletinPayload(
    { health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' }, events: [] },
    { level: 'low' },
    NOW
  ).content
);

preview(
  'DAILY · normal (3 high + 1 medium)',
  mi.buildDailyBulletinPayload(
    {
      health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' },
      events: [
        { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 3*60*60*1000, forecast: '3.2%' },
        { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high', scheduled_time: NOW + 8*60*60*1000 },
        { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', scheduled_time: NOW + 12*60*60*1000 },
        { title: 'FOMC Press Conference', currency: 'USD', impact: 'medium', scheduled_time: NOW + 5*60*60*1000 }
      ]
    },
    { level: 'moderate' },
    NOW
  ).content
);

preview(
  'DAILY · stress (6 high + 2 medium across multiple currencies)',
  mi.buildDailyBulletinPayload(
    {
      health: { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' },
      events: [
        { title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW + 1*60*60*1000, forecast: '3.2%' },
        { title: 'Non Farm Payrolls', currency: 'USD', impact: 'high', scheduled_time: NOW + 3*60*60*1000 },
        { title: 'ECB Rate Decision', currency: 'EUR', impact: 'high', scheduled_time: NOW + 5*60*60*1000 },
        { title: 'BOE Rate Decision', currency: 'GBP', impact: 'high', scheduled_time: NOW + 7*60*60*1000 },
        { title: 'BOJ Policy Decision', currency: 'JPY', impact: 'high', scheduled_time: NOW + 9*60*60*1000 },
        { title: 'Tariff Announcement', currency: 'USD', impact: 'high', scheduled_time: NOW + 11*60*60*1000 },
        { title: 'Fed Chair Speech', currency: 'USD', impact: 'medium', scheduled_time: NOW + 2*60*60*1000 },
        { title: 'BOJ Minutes', currency: 'JPY', impact: 'medium', scheduled_time: NOW + 4*60*60*1000 }
      ]
    },
    { level: 'high' },
    NOW
  ).content
);

console.log('\n' + '═'.repeat(72));
console.log('  Discord safe cap: ' + SAFE_CAP + ' chars (validateMarketIntelPayload)');
console.log('═'.repeat(72) + '\n');
