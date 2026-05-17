'use strict';

// ============================================================
// foh/adapters/marketIntelViewModel.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// Maps a Market Intel FOH packet (foh/buildMarketIntelPacket.js
// output) into the prototype shell's named anchor points.
//
// Anchors (returned as a flat object the shell renderer can
// substitute directly into the prototype HTML or use as render
// context — every anchor present, never undefined):
//
//   HEADER_TITLE
//   HEADER_SUBTITLE
//   RISK_STATE_DISC_SCALE
//   BRIEFING_SUMMARY
//   EVENT_DAY_REFERENCE
//   FOUR_WAY_HIGHER
//   FOUR_WAY_LOWER
//   FOUR_WAY_INLINE
//   FOUR_WAY_REVERSAL
//   MARKET_IMPACT
//   RISK_ESCALATION_HEALTHY
//   RISK_ESCALATION_CAUTION
//   RISK_ESCALATION_DANGER
//   RISK_ESCALATION_INVALIDATION
//   WHAT_TO_DO_NOW
//   CONFIRMS_WHEN
//   CANCELS_WHEN
//   SOURCE_PROVENANCE
//   GENERATED_AT_UTC
//
// Hard parameters:
//   preservePrototypeLayout: true
//   allowLayoutMutation: false
//   allowExternalWorkspaceLinks: false
//   userFacingTerminologyOnly: true
//   labelMechanismAsMarketImpact: true
//   dollarFirst: true
//   timestampUTCRequired: true
//   sourceProvenanceRequired: true
// ============================================================

const HARD_PARAMETERS = Object.freeze({
  preservePrototypeLayout: true,
  allowLayoutMutation: false,
  allowExternalWorkspaceLinks: false,
  userFacingTerminologyOnly: true,
  labelMechanismAsMarketImpact: true,
  dollarFirst: true,
  timestampUTCRequired: true,
  sourceProvenanceRequired: true,
});

const REQUIRED_ANCHORS = Object.freeze([
  'HEADER_TITLE', 'HEADER_SUBTITLE', 'RISK_STATE_DISC_SCALE', 'BRIEFING_SUMMARY',
  'EVENT_DAY_REFERENCE', 'FOUR_WAY_HIGHER', 'FOUR_WAY_LOWER', 'FOUR_WAY_INLINE',
  'FOUR_WAY_REVERSAL', 'MARKET_IMPACT', 'RISK_ESCALATION_HEALTHY',
  'RISK_ESCALATION_CAUTION', 'RISK_ESCALATION_DANGER', 'RISK_ESCALATION_INVALIDATION',
  'WHAT_TO_DO_NOW', 'CONFIRMS_WHEN', 'CANCELS_WHEN', 'SOURCE_PROVENANCE',
  'GENERATED_AT_UTC',
  // Operator brief 2026-05-17 (master order):
  'TODAYS_ANNOUNCEMENTS', 'PRIMARY_EVENT_FOCUS', 'NEXT_24_TO_72_HOURS',
  'AFFECTED_MARKETS_EXPANDED', 'PRICE_MAP', 'OPERATIONAL_NARRATIVE',
  'HISTORICAL_ANALOGUE_STATUS',
]);

function _fmtTraderAction(ta) {
  // Backwards-compat: legacy string traderAction renders as-is.
  // Fixed-contract structured traderAction renders into the
  // operator's 6-element block layout (instrument · price level
  // · what this means · confirms · invalidates · next path ·
  // failure path).
  if (!ta) return 'Trader action: —';
  if (typeof ta === 'string') return 'Trader action: ' + ta;
  const lines = [];
  lines.push('Trader action — operationally anchored:');
  lines.push('  Instrument: ' + (ta.instrument || '—'));
  lines.push('  Price level: ' + (ta.priceLevel || '—'));
  lines.push('  What this means: ' + (ta.behavioralExplanation || '—'));
  lines.push('  What confirms continuation:');
  for (const c of (ta.confirmsContinuation || ['—'])) lines.push('    - ' + c);
  lines.push('  What invalidates the directional idea:');
  for (const i of (ta.invalidatesContinuation || ['—'])) lines.push('    - ' + i);
  lines.push('  Most probable next path if it confirms:');
  for (const p of (ta.probableNextPath || ['—'])) lines.push('    - ' + p);
  lines.push('  Most probable failure path:');
  for (const f of (ta.probableFailurePath || ['—'])) lines.push('    - ' + f);
  return lines.join('\n');
}

function _fmtOutcome(label, outcome) {
  if (!outcome) return label + ': no read.';
  const markets = (outcome.affectedMarkets || []).join(' · ');
  return [
    label,
    'Behaviour: ' + (outcome.behaviour || '—'),
    'Affected markets: ' + (markets || '—'),
    _fmtTraderAction(outcome.traderAction),
    'Dollar impact: ' + (outcome.dollarImpact || '—'),
  ].join('\n');
}

function _fmtBriefingSummary(bs) {
  if (!bs) return 'Inline intelligence — see briefing surface.';
  const markets = Array.isArray(bs.keyMarkets) ? bs.keyMarkets.join(' · ') : '';
  return [
    'Primary read: ' + (bs.primaryRead || '—'),
    'Operational meaning: ' + (bs.operationalMeaning || '—'),
    'Key markets: ' + (markets || '—'),
    'Current risk: ' + (bs.currentRisk || '—'),
  ].join('\n');
}

function _fmtEventDay(e) {
  if (!e) return 'No event-day focus this cycle.';
  return [
    'Event: ' + (e.eventName || '—'),
    'Time (UTC): ' + (e.eventTimeUTC || '—'),
    'Expected duration: ' + (e.expectedDuration || '—'),
    'What to watch: ' + (e.whatToWatch || '—'),
    'Chart study: ' + (e.chartStudyTimeframe || '—'),
  ].join('\n');
}

function _fmtWhatToDoNow(steps) {
  if (!Array.isArray(steps) || !steps.length) return 'No actions priced in this cycle — stand aside.';
  // Operator brief 2026-05-17: every action carries ACTION · WHY ·
  // IF IGNORED · CONFIRMATION · ACTION CHANGES WHEN · $$.
  return steps.map(s => {
    const lines = [];
    lines.push(s.step + '. ' + (s.action || '—'));
    lines.push('   WHY: ' + (s.why || s.reason || '—'));
    lines.push('   IF IGNORED: ' + (s.ifIgnored || 'Position takes wider drawdown than the planned-risk model assumes.'));
    lines.push('   CONFIRMATION: ' + (s.confirmation || 'Action lands on the next ATLAS scan with the parameter applied.'));
    lines.push('   ACTION CHANGES WHEN: ' + (s.actionChangesWhen || 'Market mood drops back to LOW or the catalyst window closes.'));
    lines.push('   $$: ' + (s.dollarConsequence || '—'));
    return lines.join('\n');
  }).join('\n');
}

// CHUNK 3 — full-day Market Intel coverage.
function _fmtTodaysAnnouncements(rows) {
  if (!Array.isArray(rows) || !rows.length) return 'No high-impact events on the calendar today — driver-led tape.';
  // Group by session for the operator's required layout.
  const bySession = {};
  for (const r of rows) {
    const s = r.session || 'unscheduled';
    if (!bySession[s]) bySession[s] = [];
    bySession[s].push(r);
  }
  const order = ['Asia', 'London', 'New York', 'late-NY', 'unscheduled'];
  const lines = [];
  for (const s of order) {
    if (!bySession[s]) continue;
    lines.push(s + ' session:');
    for (const r of bySession[s]) {
      lines.push('  ' + (r.timeUTC || '—') + ' UTC · ' + (r.currency || 'multi') + ' · ' + (r.title || '—') + ' · ' + (r.severityDiscs || r.severity || '—'));
      lines.push('    why: ' + (r.whyItMatters || '—'));
      lines.push('    affected: ' + (Array.isArray(r.affectedInstruments) ? r.affectedInstruments.join(' · ') : (r.affectedInstruments || '—')));
    }
  }
  return lines.join('\n');
}

function _fmtPrimaryEventFocus(p) {
  if (!p) return 'No primary event this cycle.';
  return [
    'Event: ' + (p.eventName || '—'),
    'Time (UTC): ' + (p.eventTimeUTC || '—'),
    'Severity: ' + (p.severityDiscs || p.severity || '—'),
    'Volatility window: ' + (p.volatilityWindow || '—'),
    'Affected symbols: ' + (Array.isArray(p.affectedSymbols) ? p.affectedSymbols.join(' · ') : (p.affectedSymbols || '—')),
    'Key price zones:',
    ...(Array.isArray(p.keyPriceZones) ? p.keyPriceZones.map(z => '  - ' + z) : []),
    'Likely paths:',
    ...(Array.isArray(p.likelyPaths) ? p.likelyPaths.map(z => '  - ' + z) : []),
    'Confirmation: ' + (p.confirmation || '—'),
    'Cancellation: ' + (p.cancellation || '—'),
  ].join('\n');
}

function _fmtNext24To72Hours(rows) {
  if (!Array.isArray(rows) || !rows.length) return 'No upcoming high-impact events in the next 24–72 hours — monitor cross-asset only.';
  return rows.map(r => [
    (r.timeUTC || '—') + ' UTC · ' + (r.currency || 'multi') + ' · ' + (r.title || '—') + ' · ' + (r.severityDiscs || r.severity || '—'),
    '  expected sensitivity: ' + (r.expectedSensitivity || '—'),
    '  prep: ' + (r.preparationGuidance || '—'),
  ].join('\n')).join('\n');
}

// CHUNK 4 — affected markets expanded.
function _fmtAffectedMarketsExpanded(rows) {
  if (!Array.isArray(rows) || !rows.length) return 'No affected markets identified this cycle.';
  return rows.map(r => [
    r.instrument || '—',
    '  HOW: ' + (r.howAffected || '—'),
    '  STRONGER-THAN-EXPECTED: ' + (r.strongerResult || '—'),
    '  WEAKER-THAN-EXPECTED: ' + (r.weakerResult || '—'),
    '  CONFIRMATION: ' + (r.confirmation || '—'),
    '  INVALIDATION: ' + (r.invalidation || '—'),
    '  KEY PRICE LEVELS: ' + (r.keyPriceLevels || '—'),
    '  RISK NOTE: ' + (r.riskNote || '—'),
  ].join('\n')).join('\n\n');
}

// CHUNK 5 — price map.
function _fmtPriceMap(rows) {
  if (!Array.isArray(rows) || !rows.length) return 'No operational price levels mapped this cycle.';
  return rows.map(r => [
    (r.instrument || '—') + ' — ' + (r.level || '—') + ' (' + (r.role || 'level') + ')',
    '  WHY MATTERS: ' + (r.whyMatters || '—'),
    '  IF IT HOLDS: ' + (r.ifHolds || '—'),
    '  IF IT FAILS: ' + (r.ifFails || '—'),
    '  CONFIRMATION: ' + (r.confirmation || '—'),
    '  INVALIDATION: ' + (r.invalidation || '—'),
    '  $$ CONSEQUENCE: ' + (r.dollarConsequence || '—'),
  ].join('\n')).join('\n\n');
}

// CHUNK 7 — operational narrative.
function _fmtOperationalNarrative(n) {
  if (!n) return 'No operational read this cycle.';
  return [
    'Current phase: ' + (n.currentPhase || '—'),
    'What the market is doing: ' + (n.whatTheMarketIsDoing || '—'),
    'Why it is doing it: ' + (n.whyItIsDoingIt || '—'),
    'What changes next: ' + (n.whatChangesNext || '—'),
    'What traders should avoid: ' + (n.whatTradersShouldAvoid || '—'),
    'When conditions become safer again: ' + (n.whenConditionsBecomeSaferAgain || '—'),
  ].join('\n');
}

function _fmtHistoricalAnalogueStatus(h) {
  if (!h) return 'Status: BLOCKED\nDecision use: no\nDowngrade: Corey Clone did not provide an analogue packet.';
  const lines = [];
  lines.push('Status: ' + (h.status || 'BLOCKED'));
  lines.push('Decision use: ' + (h.usableForDecision ? 'yes' : 'no'));
  lines.push('Summary: ' + (h.summary || '—'));
  if (h.auditSupport) {
    lines.push('Audit support:');
    lines.push('  sample / denominator: ' + h.auditSupport.sampleSize + ' / ' + h.auditSupport.denominator);
    lines.push('  timestamp window: ' + (h.auditSupport.timestampWindow || '—'));
    lines.push('  source basis: ' + (h.auditSupport.sourceBasis || '—'));
    lines.push('  confidence basis: ' + (h.auditSupport.confidenceBasis || '—'));
    lines.push('  cohort: ' + (h.auditSupport.cohortSummary || '—'));
  } else {
    lines.push('Downgrade: ' + (h.downgrade || 'No valid analogue exists; no generic historical claims used.'));
  }
  return lines.join('\n');
}

function _fmtProvenance(p) {
  if (!p) return 'Source: ATLAS runtime · freshness: LIVE · confidence: engine-derived';
  const srcs = Array.isArray(p.sources) ? p.sources.join(' · ') : (p.sources || '—');
  return 'Source: ' + srcs + ' · freshness: ' + (p.dataFreshness || '—') + ' · confidence: ' + (p.confidenceBasis || '—');
}

// Hard rejector — strip any external workspace URL that may have
// leaked through upstream. Defence-in-depth alongside the source
// scrub: even if a string slips through with a notion.so link, the
// adapter neutralises it before it reaches the shell renderer.
function _stripExternalLinks(text) {
  if (typeof text !== 'string' || !text.length) return text;
  return text
    .replace(/https?:\/\/(www\.)?notion\.(so|com|site)\/[^\s)"'\]]*/gi, '[private backend reference]')
    .replace(/\bNotion\b/g, 'private backend');
}
function _scrubAll(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') return _stripExternalLinks(obj);
  if (Array.isArray(obj)) return obj.map(_scrubAll);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = _scrubAll(obj[k]);
    return out;
  }
  return obj;
}

function toViewModel(packet) {
  packet = packet || {};
  const header = packet.header || {};
  const bs = packet.briefingSummary || {};
  const ed = packet.eventDayReference || {};
  const fw = packet.fourWayOutcomes || {};
  const mi = packet.marketImpact || {};
  const re = packet.riskEscalation || {};
  const cc = packet.confirmationCancellation || {};
  const prov = packet.provenance || {};

  const anchors = {
    HEADER_TITLE:                  header.title || 'ATLAS · Market Intel',
    HEADER_SUBTITLE:               header.subtitle || '—',
    RISK_STATE_DISC_SCALE:         header.severityDiscs || (header.riskState || 'risk state pending'),
    BRIEFING_SUMMARY:              _fmtBriefingSummary(bs),
    EVENT_DAY_REFERENCE:           _fmtEventDay(ed),
    FOUR_WAY_HIGHER:               _fmtOutcome('IF surprise HIGHER', fw.higher),
    FOUR_WAY_LOWER:                _fmtOutcome('IF surprise LOWER', fw.lower),
    FOUR_WAY_INLINE:               _fmtOutcome('IF in-line', fw.inline),
    FOUR_WAY_REVERSAL:             _fmtOutcome('IF initial-direction reversal', fw.reversal),
    MARKET_IMPACT:                 [
                                     'Market impact: ' + (mi.mechanism || '—'),
                                     'Price reaction path: ' + (mi.priceReactionPath || '—'),
                                     'Liquidity effect: ' + (mi.liquidityEffect || '—'),
                                     'Volatility effect: ' + (mi.volatilityEffect || '—'),
                                     'Trader consequence: ' + (mi.traderConsequence || '—'),
                                   ].join('\n'),
    RISK_ESCALATION_HEALTHY:       re.healthy || '—',
    RISK_ESCALATION_CAUTION:       re.caution || '—',
    RISK_ESCALATION_DANGER:        re.danger || '—',
    RISK_ESCALATION_INVALIDATION:  re.invalidation || '—',
    WHAT_TO_DO_NOW:                _fmtWhatToDoNow(packet.whatToDoNow),
    CONFIRMS_WHEN:                 cc.confirmsWhen || '—',
    CANCELS_WHEN:                  cc.cancelsWhen || '—',
    SOURCE_PROVENANCE:             _fmtProvenance(prov),
    GENERATED_AT_UTC:              (packet.meta && packet.meta.generatedAtUTC) || header.generatedAtUTC || '—',
    // CHUNK 3 — full-day coverage anchors.
    TODAYS_ANNOUNCEMENTS:          _fmtTodaysAnnouncements(packet.todaysAnnouncements),
    PRIMARY_EVENT_FOCUS:           _fmtPrimaryEventFocus(packet.primaryEventFocus),
    NEXT_24_TO_72_HOURS:           _fmtNext24To72Hours(packet.next24To72Hours),
    // CHUNK 4 — affected markets expanded.
    AFFECTED_MARKETS_EXPANDED:     _fmtAffectedMarketsExpanded(packet.affectedMarketsExpanded),
    // CHUNK 5 — price map.
    PRICE_MAP:                     _fmtPriceMap(packet.priceMap),
    // CHUNK 7 — event-day operational storytelling.
    OPERATIONAL_NARRATIVE:         _fmtOperationalNarrative(packet.operationalNarrative),
    HISTORICAL_ANALOGUE_STATUS:    _fmtHistoricalAnalogueStatus(packet.historicalAnalogueStatus),
  };
  return _scrubAll(anchors);
}

function validate(viewModel) {
  const missing = [];
  for (const k of REQUIRED_ANCHORS) if (typeof viewModel[k] !== 'string' || !viewModel[k].length) missing.push(k);
  return { ok: missing.length === 0, missing };
}

module.exports = { toViewModel, validate, REQUIRED_ANCHORS, HARD_PARAMETERS };
