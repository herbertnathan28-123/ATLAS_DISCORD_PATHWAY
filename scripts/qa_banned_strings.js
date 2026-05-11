'use strict';
// scripts/qa_banned_strings.js — single source of truth for the
// banned-on-user-surface fixture used by all presentation harnesses.
//
// Consumers:
//   - scripts/test_discord_batch_qa.js    (macro v3 batch + Presenter-QA)
//   - scripts/test_dark_horse_watch.js    (Dark Horse WATCH + movement digest)
//   - scripts/test_market_intel_qa.js     (MARKET_INTEL pre/post-event alerts)
//   - scripts/test_macro_qa.js            (macro v3 scenarios)
//
// Each entry returns an object so harnesses can label the offending
// pattern when a hit fires. Patterns are case-sensitive unless flagged.

const { bareAbbreviationRegexes } = require('../presentation/marketLabels');

// Group 1 — redaction-marker shapes. None of these are allowed on the
// user surface. Any leak indicates either a regression in the sanitiser
// or a builder emitting dev-shaped markers.
const REDACTION_MARKERS = [
  { name: 'redacted_fomo',        pattern: /\[REDACTED-FOMO\]/ },
  { name: 'redacted_any_bracket', pattern: /\[REDACTED-[A-Z-]*\]/ },
];

// Group 2 — internal engine names + locked banned wording.
const ENGINE_NAMES_AND_INTERNAL = [
  { name: 'internal_corey',                pattern: /\bCorey(?:\s+Clone)?\b/ },
  { name: 'internal_spidey',               pattern: /\bSpidey\b/ },
  { name: 'internal_jane',                 pattern: /\bJane\b/ },
  { name: 'confirmation_path',             pattern: /\bconfirmation\s+path\b/i },
  { name: 'trade_alert',                   pattern: /\btrade\s+alert\b/i },
  // "confirmed structure" only allowed with explicit level direction
  { name: 'confirmed_structure_bare',      pattern: /\bconfirmed\s+structure\b(?!\s+(?:break\s+)?(?:above|below|at)\b)/i },
  { name: 'wait_for_structure_vague',      pattern: /\bwait\s+for\s+structure\b(?!\s+confirmation\s+at\b)/i },
  { name: 'trigger_token',                 pattern: /\btrigger\b/i },
  { name: 'authorised',                    pattern: /\bauthori[sz]ed?\b/i },
  { name: 'permitted',                     pattern: /\bpermitted\b/i },
  { name: 'permission',                    pattern: /\bpermission\b/i },
  { name: 'blocked_user_surface',          pattern: /\bblocked\b/i },
];

// Group 3 — developer/internal/QA/cache/provider leaks.
const DEV_INTERNAL_LEAKS = [
  { name: 'presenter_qa_flagged',          pattern: /Presenter QA flagged/i },
  { name: 'presenter_qa_bracket',          pattern: /\[PRESENTER-QA\]/ },
  { name: 'confirmation_reason_underscore',pattern: /confirmation_used_without_definition/ },
  { name: 'fetch_run_id',                  pattern: /\bfetch_run_id\b/i },
  { name: 'manifest_token',                pattern: /\bmanifest\b/i },
  { name: 'degraded_token',                pattern: /\bdegraded\b/i },
  { name: 'debug_token',                   pattern: /\bdebug\b/i },
  { name: 'cache_token',                   pattern: /\bcache\b/i },
  { name: 'data_historical_path',          pattern: /\/data\/historical/ },
  { name: 'runs_path',                     pattern: /_runs\// },
  { name: 'coreyLive_token',               pattern: /\bcoreyLive\b/ },
  // "source: " prefix is dev-shaped (e.g. "source: tradingview"). We do
  // NOT ban the word "source" alone — it appears in legitimate copy.
  { name: 'source_prefix',                 pattern: /\bsource\s*:\s*[a-z_]/i },
  // "provider" by itself is operator vocabulary on the user surface.
  { name: 'provider_token',                pattern: /\bprovider\b/i },
];

// Group 4 — corruption / typo signatures.
const CORRUPTION_SIGNATURES = [
  { name: 'directionanjhl',                pattern: /\bdirectionanjhl\b/i },
  { name: 'anjhl_fragment',                pattern: /\banjhl\b/i },
  { name: 'object_object_literal',         pattern: /\[object Object\]/ },
  { name: 'dxy_dxy_double',                pattern: /\bDXY\s*:\s*DXY\b/ },
  { name: 'vix_vix_double',                pattern: /\bVIX\s*:\s*VIX\b/ },
  // Mid-word capitalisation mash-ups (catches "structureNCloseN" style)
  // — only flag long enough patterns to avoid catching legitimate
  // headings like "USDJPY".
  { name: 'midword_caps_mashup',           pattern: /\b[a-z]{4,}[A-Z]{2,}[a-z]{2,}\b/ },
];

// Group 5 — Dark Horse / Market Intel-specific banned wording (post PR #47).
const DARK_HORSE_INTEL_SPECIFIC = [
  { name: 'promotion_trigger_label',       pattern: /\bPromotion trigger:/ },
  { name: 'invalidation_trigger_label',    pattern: /\bInvalidation trigger:/ },
  { name: 'fomo_caution_old',              pattern: /this is not a trade alert/i },
  { name: 'dark_horse_flag_label',         pattern: /\bDark Horse flag:/ },
  { name: 'hh_hl_shorthand_unexpanded',    pattern: /\bHH\/HL\b/ },
  { name: 'uup_proxy',                     pattern: /\bUUP proxy\b/i },
  { name: 'vxx_proxy',                     pattern: /\bVXX proxy\b/i },
  { name: 'tenY_2y_bare',                  pattern: /\b10Y-2Y\b/ },
];

// Group 6 — bare abbreviation rule. Bare DXY / VIX / etc. outside the
// "(DXY)" parenthesised form. Sourced from the shared marketLabels
// helper so the list cannot drift.
const BARE_ABBREVIATIONS = bareAbbreviationRegexes();

const ALL_BANNED = []
  .concat(REDACTION_MARKERS)
  .concat(ENGINE_NAMES_AND_INTERNAL)
  .concat(DEV_INTERNAL_LEAKS)
  .concat(CORRUPTION_SIGNATURES)
  .concat(DARK_HORSE_INTEL_SPECIFIC)
  .concat(BARE_ABBREVIATIONS);

// Scan a text body. Returns array of { name, pattern, match } for every
// hit. Empty array means clean.
function scan(text, opts) {
  const skip = (opts && opts.skip) || [];
  const skipSet = new Set(skip);
  const out = [];
  const t = String(text || '');
  for (const entry of ALL_BANNED) {
    if (skipSet.has(entry.name)) continue;
    const m = t.match(entry.pattern);
    if (m) out.push({ name: entry.name, pattern: entry.pattern, match: m[0] });
  }
  return out;
}

// Convenience: assert clean. Throws with a labelled error on hit.
function assertClean(text, label, opts) {
  const hits = scan(text, opts);
  if (hits.length === 0) return;
  const head = `[QA-BANNED] ${label || 'unlabelled'} — ${hits.length} hit${hits.length > 1 ? 's' : ''}`;
  const detail = hits.map(h => `  • ${h.name}: ${JSON.stringify(h.match)}`).join('\n');
  throw new Error(head + '\n' + detail);
}

module.exports = {
  REDACTION_MARKERS,
  ENGINE_NAMES_AND_INTERNAL,
  DEV_INTERNAL_LEAKS,
  CORRUPTION_SIGNATURES,
  DARK_HORSE_INTEL_SPECIFIC,
  BARE_ABBREVIATIONS,
  ALL_BANNED,
  scan,
  assertClean,
};
