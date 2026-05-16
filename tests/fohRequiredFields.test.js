#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// tests/fohRequiredFields.test.js
//
// Operator directive 2026-05-17 — Hard guard. Asserts that the
// fixed-contract FOH packets carry every required top-level
// field and that each section carries every required sub-field.
// ============================================================

const path = require('path');
const { buildMarketIntelPacket } = require(path.join(__dirname, '..', 'foh', 'buildMarketIntelPacket'));
const { buildDarkHorsePacket }   = require(path.join(__dirname, '..', 'foh', 'buildDarkHorsePacket'));

let passed = 0, failed = 0;
function ok(label) { passed++; console.log('  ✓ ' + label); }
function fail(label, err) { failed++; console.error('  ✗ ' + label + (err ? ' :: ' + err : '')); }

const REQUIRED_PACKET_FIELDS = ['meta','header','briefingSummary','eventDayReference','fourWayOutcomes','marketImpact','riskEscalation','whatToDoNow','confirmationCancellation','provenance'];
const REQUIRED_META   = ['module','reportId','generatedAtUTC','audience','source','noExternalWorkspaceLinks'];
const REQUIRED_HEADER = ['title','subtitle','riskState','severityDiscs','generatedAtUTC'];
const REQUIRED_BRIEF  = ['primaryRead','operationalMeaning','keyMarkets','currentRisk'];
const REQUIRED_EVENT  = ['eventName','eventTimeUTC','expectedDuration','whatToWatch','chartStudyTimeframe'];
const REQUIRED_OUTCOME = ['behaviour','affectedMarkets','traderAction','dollarImpact'];
// Operationally-anchored trader-action sub-fields (operator 2026-05-17).
const REQUIRED_TRADER_ACTION = ['instrument','priceLevel','behavioralExplanation','confirmsContinuation','invalidatesContinuation','probableNextPath','probableFailurePath'];
const REQUIRED_IMPACT = ['mechanism','priceReactionPath','liquidityEffect','volatilityEffect','traderConsequence'];
const REQUIRED_RISKESC = ['healthy','caution','danger','invalidation'];
const REQUIRED_STEP   = ['step','action','reason','dollarConsequence'];
const REQUIRED_CC     = ['confirmsWhen','cancelsWhen','dangerIf'];
const REQUIRED_PROV   = ['sources','dataFreshness','confidenceBasis'];

function assertHas(obj, keys, label) {
  if (!obj || typeof obj !== 'object') { fail(label, 'object missing'); return; }
  const missing = keys.filter(k => !(k in obj) || obj[k] == null || obj[k] === '');
  if (missing.length) fail(label, 'missing/empty: ' + missing.join(','));
  else ok(label);
}

function audit(packet, name) {
  console.log('\n' + name + ':');
  assertHas(packet, REQUIRED_PACKET_FIELDS, name + ' top-level');
  assertHas(packet.meta, REQUIRED_META, name + '.meta');
  assertHas(packet.header, REQUIRED_HEADER, name + '.header');
  assertHas(packet.briefingSummary, REQUIRED_BRIEF, name + '.briefingSummary');
  assertHas(packet.eventDayReference, REQUIRED_EVENT, name + '.eventDayReference');
  for (const k of ['higher','lower','inline','reversal']) {
    assertHas(packet.fourWayOutcomes && packet.fourWayOutcomes[k], REQUIRED_OUTCOME, name + '.fourWayOutcomes.' + k);
    const ta = packet.fourWayOutcomes && packet.fourWayOutcomes[k] && packet.fourWayOutcomes[k].traderAction;
    assertHas(ta, REQUIRED_TRADER_ACTION, name + '.fourWayOutcomes.' + k + '.traderAction (operationally anchored)');
  }
  assertHas(packet.marketImpact, REQUIRED_IMPACT, name + '.marketImpact');
  assertHas(packet.riskEscalation, REQUIRED_RISKESC, name + '.riskEscalation');
  if (!Array.isArray(packet.whatToDoNow) || !packet.whatToDoNow.length) fail(name + '.whatToDoNow non-empty array');
  else { ok(name + '.whatToDoNow non-empty'); packet.whatToDoNow.forEach((s, i) => assertHas(s, REQUIRED_STEP, name + '.whatToDoNow[' + i + ']')); }
  assertHas(packet.confirmationCancellation, REQUIRED_CC, name + '.confirmationCancellation');
  assertHas(packet.provenance, REQUIRED_PROV, name + '.provenance');
  if (packet.meta && packet.meta.noExternalWorkspaceLinks !== true) fail(name + '.meta.noExternalWorkspaceLinks must be true');
  else ok(name + '.meta.noExternalWorkspaceLinks=true');
}

const miPacket = buildMarketIntelPacket({ engine: { kind: 'daily', mood: { severity: 'ELEV' }, eventClusters: [{ currency: 'USD', events: [{ title: 'CPI', time: '12:30 UTC' }]}] } });
audit(miPacket, 'MI packet');

const dhPacket = buildDarkHorsePacket({ ranking: { top10: [{ symbol: 'EURUSD', movePhase: 'early', score: 9 }, { symbol: 'XAUUSD', movePhase: 'mid', score: 8 }], allCount: 33 }, volatility: { level: 'ELEV' } });
audit(dhPacket, 'DH packet');

const emptyMiPacket = buildMarketIntelPacket({ engine: {} });
audit(emptyMiPacket, 'MI packet (empty engine)');
const emptyDhPacket = buildDarkHorsePacket({ ranking: {}, volatility: {} });
audit(emptyDhPacket, 'DH packet (empty ranking)');

console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed) { console.error('[FOH-REQUIRED-FIELDS] FAIL'); process.exit(1); }
console.log('[FOH-REQUIRED-FIELDS] PASS');
process.exit(0);
