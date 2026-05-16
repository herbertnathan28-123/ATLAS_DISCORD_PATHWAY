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
  return steps.map(s => `${s.step}. ${s.action}\n   why: ${s.reason}\n   $$: ${s.dollarConsequence}`).join('\n');
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
  };
  return _scrubAll(anchors);
}

function validate(viewModel) {
  const missing = [];
  for (const k of REQUIRED_ANCHORS) if (typeof viewModel[k] !== 'string' || !viewModel[k].length) missing.push(k);
  return { ok: missing.length === 0, missing };
}

module.exports = { toViewModel, validate, REQUIRED_ANCHORS, HARD_PARAMETERS };
