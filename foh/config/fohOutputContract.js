'use strict';

// ============================================================
// foh/config/fohOutputContract.js
//
// Operator brief 2026-05-17 (assurance directive): single source
// of truth for everything the FOH pipeline must enforce. Used by
// foh/validate/validateFohOutput.js, the tests, and the dispatch
// controllers so all gates agree on the same rule book.
// ============================================================

// ============================================================
// MARKET INTEL CONTRACT — `meta.module = 'market_intel'`
// ============================================================
const MARKET_INTEL_REQUIRED_PACKET_FIELDS = Object.freeze([
  'meta', 'header', 'briefingSummary', 'eventDayReference',
  'fourWayOutcomes', 'marketImpact', 'riskEscalation', 'whatToDoNow',
  'confirmationCancellation', 'provenance',
  'theCall', 'rankedEventCalendar',
  // Master order — full-day coverage + intelligence expansion.
  'todaysAnnouncements', 'primaryEventFocus', 'next24To72Hours',
  'affectedMarketsExpanded', 'priceMap', 'operationalNarrative',
  // Corey Clone integration (post-deploy 2026-05-17).
  'historicalReaction', 'cloneStatus',
  // Spidey Phase D activation (2026-05-17).
  'structureSnapshot',
]);

const MARKET_INTEL_REQUIRED_VIEW_MODEL_ANCHORS = Object.freeze([
  'HEADER_TITLE', 'HEADER_SUBTITLE', 'RISK_STATE_DISC_SCALE',
  'THE_CALL', 'RANKED_EVENT_CALENDAR',
  'BRIEFING_SUMMARY', 'EVENT_DAY_REFERENCE',
  'FOUR_WAY_HIGHER', 'FOUR_WAY_LOWER', 'FOUR_WAY_INLINE', 'FOUR_WAY_REVERSAL',
  'MARKET_IMPACT',
  'RISK_ESCALATION_HEALTHY', 'RISK_ESCALATION_CAUTION', 'RISK_ESCALATION_DANGER', 'RISK_ESCALATION_INVALIDATION',
  'WHAT_TO_DO_NOW', 'CONFIRMS_WHEN', 'CANCELS_WHEN',
  'SOURCE_PROVENANCE', 'GENERATED_AT_UTC',
  'TODAYS_ANNOUNCEMENTS', 'PRIMARY_EVENT_FOCUS', 'NEXT_24_TO_72_HOURS',
  'AFFECTED_MARKETS_EXPANDED', 'PRICE_MAP', 'OPERATIONAL_NARRATIVE',
  'HISTORICAL_ANALOGUE', 'STRUCTURE_SNAPSHOT',
]);

const MARKET_INTEL_REQUIRED_ARRAYS = Object.freeze({
  todaysAnnouncements:     { minLength: 0, perItemFields: ['session','timeUTC','currency','title','severity','severityDiscs','whyItMatters','affectedInstruments'] },
  next24To72Hours:         { minLength: 0, perItemFields: ['timeUTC','currency','title','severity','severityDiscs','expectedSensitivity','preparationGuidance'] },
  affectedMarketsExpanded: { minLength: 1, perItemFields: ['instrument','howAffected','strongerResult','weakerResult','confirmation','invalidation','keyPriceLevels','riskNote'] },
  priceMap:                { minLength: 1, perItemFields: ['instrument','level','role','whyMatters','ifHolds','ifFails','confirmation','invalidation','dollarConsequence'] },
  whatToDoNow:             { minLength: 1, perItemFields: ['step','action','why','ifIgnored','confirmation','actionChangesWhen','dollarConsequence'] },
});

const MARKET_INTEL_MINIMUM_DEPTH_RULES = Object.freeze({
  BRIEFING_SUMMARY:        80,
  EVENT_DAY_REFERENCE:     80,
  PRIMARY_EVENT_FOCUS:    160,
  AFFECTED_MARKETS_EXPANDED: 200,
  PRICE_MAP:               200,
  OPERATIONAL_NARRATIVE:   160,
  WHAT_TO_DO_NOW:          200,
  MARKET_IMPACT:           160,
});

// ============================================================
// DARK HORSE CONTRACT — `meta.module = 'dark_horse'`
//
// Dark Horse is a movement-scanner output, not an economic-event
// calendar. The MI-specific packet fields (theCall, rankedEventCalendar,
// todaysAnnouncements, primaryEventFocus, next24To72Hours,
// affectedMarketsExpanded, priceMap, operationalNarrative,
// historicalReaction, cloneStatus, structureSnapshot) are MI domain
// concepts — they do not exist on the DH packet by design. Before
// the per-module scope was added, validateFohOutput rejected every
// DH packet at the contract gate with multiple `packet_missing_field:`
// failures and the dispatcher fell through to the text-only payload
// (see live runtime log: `[DH-FOH-IMAGE] image render path returned
// not-ok reason=foh_contract_validation_failed, falling through to
// text`). The DH lists below cover only the fields that
// buildDarkHorsePacket actually emits and the anchors the MI-shared
// view-model adapter can fill from those fields.
// ============================================================
const DARK_HORSE_REQUIRED_PACKET_FIELDS = Object.freeze([
  'meta', 'header', 'briefingSummary', 'eventDayReference',
  'fourWayOutcomes', 'marketImpact', 'riskEscalation', 'whatToDoNow',
  'confirmationCancellation', 'provenance',
]);

const DARK_HORSE_REQUIRED_VIEW_MODEL_ANCHORS = Object.freeze([
  'HEADER_TITLE', 'HEADER_SUBTITLE', 'RISK_STATE_DISC_SCALE',
  'BRIEFING_SUMMARY', 'EVENT_DAY_REFERENCE',
  'FOUR_WAY_HIGHER', 'FOUR_WAY_LOWER', 'FOUR_WAY_INLINE', 'FOUR_WAY_REVERSAL',
  'MARKET_IMPACT',
  'RISK_ESCALATION_HEALTHY', 'RISK_ESCALATION_CAUTION', 'RISK_ESCALATION_DANGER', 'RISK_ESCALATION_INVALIDATION',
  'WHAT_TO_DO_NOW', 'CONFIRMS_WHEN', 'CANCELS_WHEN',
  'SOURCE_PROVENANCE', 'GENERATED_AT_UTC',
]);

const DARK_HORSE_REQUIRED_ARRAYS = Object.freeze({
  whatToDoNow: { minLength: 1, perItemFields: ['step','action','why','ifIgnored','confirmation','actionChangesWhen','dollarConsequence'] },
});

const DARK_HORSE_MINIMUM_DEPTH_RULES = Object.freeze({
  BRIEFING_SUMMARY:    80,
  EVENT_DAY_REFERENCE: 80,
  MARKET_IMPACT:      160,
  WHAT_TO_DO_NOW:     200,
});

// ============================================================
// Backward-compat aliases — older callers that imported the
// REQUIRED_* names without a module hint get the MI semantics by
// default, matching the pre-scope behaviour.
// ============================================================
const REQUIRED_PACKET_FIELDS = MARKET_INTEL_REQUIRED_PACKET_FIELDS;
const REQUIRED_VIEW_MODEL_ANCHORS = MARKET_INTEL_REQUIRED_VIEW_MODEL_ANCHORS;
const REQUIRED_ARRAYS = MARKET_INTEL_REQUIRED_ARRAYS;
const MINIMUM_DEPTH_RULES = MARKET_INTEL_MINIMUM_DEPTH_RULES;

const BANNED_TERMS_USERFACING = Object.freeze([
  // Private backend / workspace exposure (operator 2026-05-17 part A).
  'notion.so', 'notion.com', 'notion.site', 'Notion',
  'view in Notion', 'go to Notion', 'open workspace',
  // Banned legacy terminology.
  'Mechanism Chain',
  // Lot terminology — replace with dollar exposure language.
  'standard lot',
  // Prototype / dev leakage.
  'prototype render', 'Future scans will', 'future scans will',
  // Engineering placeholders.
  '[object Object]',
  // Internal label that previously leaked into Dark Horse cards
  // (operator brief 2026-05-18) — user-facing copy must say
  // "Entry Validation" instead.
  'promotion_trigger',
  'Promotion criteria:',
]);

// Banned regex patterns for token-level checks (e.g. /\blot\b/).
const BANNED_PATTERNS_USERFACING = Object.freeze([
  /\blots?\b/,                    // CHUNK 1.2 — no "lot" or "lots"
  /#term-[a-z-]+/i,               // CHUNK 1.4 — no slug leakage in body text
  /\bundefined\b/,                // engineering placeholder
  /\bnull\b/,                     // engineering placeholder
  /\blook for (LONG|SHORT) [A-Z]{3,6} setups\b/,
  /\bsetups using the next (Dark Horse|ATLAS) scan as your guide\b/,
  /\bif direction holds\b/i,
]);

const APPROVED_TERMINOLOGY = Object.freeze([
  'Market Impact',           // user-facing label (Mechanism Chain banned)
  'dollar exposure',
  'dollar risk',
  'exposure scaling',
  'percentage allocation',
  'account impact',
  'reaction band',
  'liquidity zone',
  'trigger level',
  'invalidation level',
  'continuation gate',
  'confirmed directional structure',
]);

const SEVERITY_DISC_RULES = Object.freeze({
  EXTREME: { glyph: '🔴', count: 5, label: 'Extreme' },
  HIGH:    { glyph: '🔴', count: 4, label: 'High' },
  ELEV:    { glyph: '🟠', count: 4, label: 'Elevated' },
  MED:     { glyph: '🟠', count: 3, label: 'Medium' },
  LOW:     { glyph: '🔵', count: 2, label: 'Low' },
  CALM:    { glyph: '🔵', count: 1, label: 'Calm' },
});

const LINK_RULES = Object.freeze({
  allowedHostsInUserContent: [
    // Operator brief: no external workspace links surface to users.
    // Only allowed external hosts (if any) live here. Currently
    // none — Discord intelligence must carry the read directly.
  ],
  blockExternalLinksInContent: true,
  allowInlineTerminologyAnchors: false, // chips beside headers only
});

const PRICE_MAP_RULES = Object.freeze({
  requiredRoles: ['reaction_level', 'liquidity_pool', 'continuation_gate'],
  // At least one entry must use each of these roles for an MI packet.
  // The validator surfaces a warning rather than a hard fail if any
  // are missing — guards against thin priceMaps without being brittle.
});

const AFFECTED_MARKET_RULES = Object.freeze({
  // Operator brief: no naked symbol lists allowed. Every affected
  // market must carry the 7 per-market fields above.
  requireExplanationForEverySymbol: true,
});

const ACTION_BLOCK_RULES = Object.freeze({
  // Operator brief: ACTION / WHY / IF IGNORED / CONFIRMATION /
  // ACTION CHANGES WHEN / dollar consequence. Each action must carry
  // a price level when directional.
  required: ['action', 'why', 'ifIgnored', 'confirmation', 'actionChangesWhen', 'dollarConsequence'],
});

module.exports = {
  REQUIRED_PACKET_FIELDS,
  REQUIRED_VIEW_MODEL_ANCHORS,
  REQUIRED_ARRAYS,
  MINIMUM_DEPTH_RULES,
  MARKET_INTEL_REQUIRED_PACKET_FIELDS,
  MARKET_INTEL_REQUIRED_VIEW_MODEL_ANCHORS,
  MARKET_INTEL_REQUIRED_ARRAYS,
  MARKET_INTEL_MINIMUM_DEPTH_RULES,
  DARK_HORSE_REQUIRED_PACKET_FIELDS,
  DARK_HORSE_REQUIRED_VIEW_MODEL_ANCHORS,
  DARK_HORSE_REQUIRED_ARRAYS,
  DARK_HORSE_MINIMUM_DEPTH_RULES,
  BANNED_TERMS_USERFACING,
  BANNED_PATTERNS_USERFACING,
  APPROVED_TERMINOLOGY,
  SEVERITY_DISC_RULES,
  LINK_RULES,
  PRICE_MAP_RULES,
  AFFECTED_MARKET_RULES,
  ACTION_BLOCK_RULES,
};
