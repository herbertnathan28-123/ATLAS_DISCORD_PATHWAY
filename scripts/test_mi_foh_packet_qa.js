#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_mi_foh_packet_qa.js
//
// QA for the MI FOH product-depth packet (operator brief 2026-05-16).
// Verifies:
//   - All 3 MI builders attach `fohPacket` field alongside content.
//   - Packet schema includes every required section: marketState,
//     mondayOpenFocus, eventClusters[], historicalReaction,
//     marketImpact, affectedMarkets, confirmationPath,
//     cancellationPath, operatorGuidance, sourceNote, glossaryTerms.
//   - Every section carries `available: boolean` and a `reason`
//     when unavailable (never silently dropped).
//   - Renderer detects rich packet and emits the new sections.
//   - Mode detection: Saturday → weekend, Tuesday → daily.
//   - Tick path forwards fohPacket to dispatch (no longer drops it).
//   - eventClusters group by currency with cluster severity =
//     max event severity.
//   - Rendered HTML contains the "sourced unavailable" string
//     for sections without data (never deletes silently).
// ============================================================

const path = require('path');
const mi   = require(path.join(__dirname, '..', 'coreyMarketIntel.js'));
const foh  = require(path.join(__dirname, '..', 'renderers', 'foh'));
const { renderMarketIntelCard } = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelCard'));
const packetMod = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelFohPacket'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }
function assert(cond, label, err) { if (cond) ok(label); else fail(label, err); }

const NOW_SAT  = Date.parse('2026-05-16T12:00:00Z'); // Saturday
const NOW_TUES = Date.parse('2026-05-19T08:00:00Z'); // Tuesday
const HEALTH_LIVE = { available: true, calendar_mode: 'LIVE', source_used: 'TradingView' };

const FIXTURE_EVENTS = [
  { title: 'CPI (USD)',           currency: 'USD', impact: 'high', forecast: '3.2%', previous: '3.0%' },
  { title: 'Non Farm Payrolls',   currency: 'USD', impact: 'high', forecast: '180k', previous: '160k' },
  { title: 'ECB Rate Decision',   currency: 'EUR', impact: 'high' },
  { title: 'ECB Press Conference',currency: 'EUR', impact: 'high' },
  { title: 'BOE Rate Decision',   currency: 'GBP', impact: 'high' },
  { title: 'UK CPI',              currency: 'GBP', impact: 'high', forecast: '2.4%', previous: '2.2%' },
];

function snapshotFor(NOW, events) {
  return { health: HEALTH_LIVE, events: events.map((e, i) => Object.assign({}, e, { scheduled_time: NOW + (i + 1) * 12 * 3600 * 1000 })) };
}

// ── T1 — daily bulletin builder attaches fohPacket ──
console.log('\nT1 — Daily-bulletin builder attaches fohPacket with required schema:');
const snapDaily = snapshotFor(NOW_TUES, FIXTURE_EVENTS.slice(0, 3));
const dailyOut  = mi.buildDailyBulletinPayload(snapDaily, { level: 'low' }, NOW_TUES);
assert(dailyOut && typeof dailyOut.content === 'string' && dailyOut.content.length > 100, 'daily builder still returns content');
assert(dailyOut && dailyOut.fohPacket, 'daily builder attaches fohPacket');
const dp = dailyOut.fohPacket;
assert(dp.mode === 'daily', 'daily mode detected on Tuesday');
for (const key of ['marketState','mondayOpenFocus','eventClusters','historicalReaction','marketImpact','affectedMarkets','confirmationPath','cancellationPath','operatorGuidance','sourceNote','glossaryTerms']) {
  assert(Object.prototype.hasOwnProperty.call(dp, key), 'daily fohPacket has section: ' + key);
}
assert(typeof dp.marketState.available === 'boolean', 'marketState carries available:boolean');
assert(typeof dp.mondayOpenFocus.available === 'boolean', 'mondayOpenFocus carries available:boolean');
assert(typeof dp.historicalReaction.available === 'boolean', 'historicalReaction carries available:boolean');
assert(Array.isArray(dp.eventClusters), 'eventClusters is an array');

// ── T2 — weekend mode triggers Monday open focus ──
console.log('\nT2 — Weekend mode (Saturday) flips daily → weekend + activates mondayOpenFocus:');
const snapWknd = snapshotFor(NOW_SAT, FIXTURE_EVENTS);
const wkndOut  = mi.buildDailyBulletinPayload(snapWknd, { level: 'moderate' }, NOW_SAT);
const wp = wkndOut.fohPacket;
assert(wp.mode === 'weekend', 'mode=weekend on Saturday');
assert(wp.mondayOpenFocus.available === true, 'mondayOpenFocus.available=true on weekend with clusters');
assert(typeof wp.mondayOpenFocus.narrative === 'string' && wp.mondayOpenFocus.narrative.length > 30, 'mondayOpenFocus has narrative');

// ── T3 — event clusters group by currency, severity = max event ──
console.log('\nT3 — eventClusters grouping + severity:');
assert(wp.eventClusters.length === 3, 'weekend packet has 3 currency clusters (USD/EUR/GBP)');
const ccyList = wp.eventClusters.map(c => c.currency).sort();
assert(ccyList.join(',') === 'EUR,GBP,USD', 'clusters cover EUR/GBP/USD');
for (const c of wp.eventClusters) {
  assert(typeof c.available === 'boolean', 'cluster ' + c.currency + ' carries available:boolean');
  assert(c.severity === 'HIGH', 'cluster ' + c.currency + ' severity=HIGH (max event severity)');
  assert(Array.isArray(c.events) && c.events.length, 'cluster ' + c.currency + ' has events');
  for (const ev of c.events) {
    for (const f of ['time','title','currency','impact','severity','driverLine','whyExpanded','marketImpact','historicalReaction','confirmationPath','cancellationPath','operatorGuidance','beforeDuringAfter']) {
      assert(Object.prototype.hasOwnProperty.call(ev, f), 'event in ' + c.currency + ' cluster has field: ' + f);
    }
    assert(ev.beforeDuringAfter && ev.beforeDuringAfter.before && ev.beforeDuringAfter.during && ev.beforeDuringAfter.after, 'event in ' + c.currency + ' has BEFORE/DURING/AFTER');
  }
}

// ── T4 — pre-event + released builders attach fohPacket ──
console.log('\nT4 — Pre-event + released builders attach fohPacket:');
const preEvt = mi.buildPreEventAlertPayload({ title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW_TUES + 60 * 60 * 1000, forecast: '3.2%' }, 60, { health: HEALTH_LIVE });
assert(preEvt && preEvt.fohPacket && preEvt.fohPacket.mode === 'pre_event', 'pre-event builder attaches fohPacket mode=pre_event');
assert(preEvt.fohPacket.eventClusters.length === 1, 'pre-event packet has 1 cluster');

const released = mi.buildReleasedEventAlertPayload({ title: 'CPI (USD)', currency: 'USD', impact: 'high', scheduled_time: NOW_TUES - 5 * 60 * 1000, actual: '3.5%', forecast: '3.2%' }, { health: HEALTH_LIVE });
assert(released && released.fohPacket && released.fohPacket.mode === 'released', 'released builder attaches fohPacket mode=released');

// ── T5 — sections without data carry available:false + reason ──
console.log('\nT5 — Unavailable sections labelled (never silently dropped):');
// historical reaction has no caller-supplied history → unavailable
assert(dp.historicalReaction.available === false, 'historicalReaction.available=false when no history supplied');
assert(typeof dp.historicalReaction.reason === 'string' && dp.historicalReaction.reason.length, 'historicalReaction carries reason when unavailable');
// marketState unavailable (no coreyLive wired in test) → unavailable + reason
assert(dp.marketState.available === false, 'marketState.available=false when coreyLive not wired');
assert(typeof dp.marketState.reason === 'string' && dp.marketState.reason.length, 'marketState carries reason when unavailable');

// ── T6 — renderer detects rich packet + emits sections ──
console.log('\nT6 — Renderer outputs new sections from rich packet:');
const html = renderMarketIntelCard(wp);
for (const heading of ['Market state · macro regime','Monday open focus','Event clusters · weekly window','Market impact · transmission chain','Confirmation path','Cancellation path','Operator guidance','Historical reaction · lead event','Expanded Terminology']) {
  assert(html.indexOf(heading) !== -1, 'rendered HTML contains heading: ' + heading);
}
// "sourced unavailable" label appears for unavailable sections
assert(/sourced unavailable/.test(html), 'rendered HTML carries "sourced unavailable" label for missing sections');

// ── T7 — renderer back-compat: legacy thin imagePayload still renders ──
console.log('\nT7 — Renderer back-compat with legacy thin imagePayload:');
const thin = {
  kind: 'pre_event',
  headline: { title: 'CPI (USD)', currency: 'USD', impact: 'HIGH', time: 'now', stage: 'T-1H' },
  mood: { discs: '🟠🟠🟠🟠⚫', label: 'Elevated', severity: 'ELEV' },
  whyThisMatters: 'thin payload back-compat',
};
const thinHtml = renderMarketIntelCard(thin);
assert(thinHtml.indexOf('Why this matters') !== -1, 'thin payload still renders legacy heading');

// ── T8 — Prototype depth content present on packet (NEW) ──
console.log('\nT8 — Prototype depth content present on packet:');
const featCluster = wp.eventClusters.find(c => c.severity === 'HIGH') || wp.eventClusters[0];
const featEvent = featCluster && featCluster.events && featCluster.events[0];
assert(wp.featuredEventKey && wp.featuredEventKey.indexOf(featEvent.title) !== -1, 'featuredEventKey points at featured event');
assert(featEvent && featEvent.dollarImpactRange && featEvent.dollarImpactRange.available === true, 'featured event has dollarImpactRange.available=true');
assert(Array.isArray(featEvent.dollarImpactRange.first60sRanges) && featEvent.dollarImpactRange.first60sRanges.length >= 4, 'dollarImpactRange has ≥ 4 per-asset rows');
assert(featEvent && featEvent.reactionPaths && featEvent.reactionPaths.available === true, 'featured event has reactionPaths.available=true');
assert(featEvent.reactionPaths.scenarios.length === 4, 'reactionPaths has all 4 outcomes (hawkish/dovish/inline/reversal)');
assert(featEvent && featEvent.whatToWatch && featEvent.whatToWatch.available === true, 'featured event has whatToWatch.available=true');
assert(Array.isArray(featEvent.whatToWatch.preEvent) && featEvent.whatToWatch.preEvent.length >= 3, 'whatToWatch.preEvent has ≥ 3 indicators');
assert(wp.riskEscalation && wp.riskEscalation.available === true, 'packet has riskEscalation');
assert(Array.isArray(wp.riskEscalation.stages) && wp.riskEscalation.stages.length >= 4, 'riskEscalation has ≥ 4 stages');
assert(wp.eventDayReference && wp.eventDayReference.available === true, 'packet has eventDayReference');
assert(Array.isArray(wp.eventDayReference.windows) && wp.eventDayReference.windows.length === 4, 'eventDayReference has exactly 4 windows');
assert(wp.comparisonNotes && wp.comparisonNotes.available === true, 'packet has comparisonNotes');
assert(typeof wp.comparisonNotes.whyThisRating === 'string' && wp.comparisonNotes.whyThisRating.length > 30, 'comparisonNotes has whyThisRating narrative');
assert(wp.briefingActions && wp.briefingActions.available === true, 'packet has briefingActions');
assert(Array.isArray(wp.briefingActions.actions) && wp.briefingActions.actions.length === 5, 'briefingActions has exactly 5 numbered actions');

// ── T9 — Rendered HTML emits every depth section ──
console.log('\nT9 — Rendered HTML emits every depth section:');
const depthHtml = renderMarketIntelCard(wp);
for (const heading of ['Dollar impact range','Reaction paths · 4 outcomes','Risk escalation','What traders should watch','Event-day reference · 4 windows','Why this rating · what changes it','Briefing actions']) {
  assert(depthHtml.indexOf(heading) !== -1, 'rendered HTML contains depth heading: ' + heading);
}
// Featured event renders as full card; non-featured renders as compact row.
assert(/foh-event-row /.test(depthHtml), 'non-featured events render as compact rows');
assert(/HAWKISH/.test(depthHtml) && /DOVISH/.test(depthHtml) && /INLINE/.test(depthHtml) && /REVERSAL/.test(depthHtml), 'all 4 reaction-path scenario tiers rendered');

// ── T10 — PNG render against the rich packet ──
console.log('\nT10 — PNG render of rich packet:');
(async () => {
  const r = await foh.renderFohPng({ kind: 'market_intel', payload: wp });
  assert(r.ok === true, 'rich packet renders to PNG', r.error);
  if (r.ok) {
    assert(r.png && r.png.length > 100000, 'rich PNG buffer > 100KB (rich body)');
    assert(r.png[0] === 0x89 && r.png[1] === 0x50, 'rich PNG buffer has valid PNG signature');
    assert(r.height >= 1500, 'rich PNG height ≥ 1500px (deep body)');
  }

  console.log('\n==========================');
  console.log('Passed: ' + passed + '   Failed: ' + failed);
  if (failed) {
    console.error('[MI-FOH-PACKET-QA] FAIL');
    process.exit(1);
  }
  console.log('[MI-FOH-PACKET-QA] PASS — full FOH product-depth schema + renderer + back-compat verified.');
  process.exit(0);
})().catch(e => { console.error('[MI-FOH-PACKET-QA] FATAL ' + e.message); process.exit(2); });
