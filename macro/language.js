'use strict';
// Ban-list + plain-English translator + dollars-first formatter.
// scrub() throws on ban violation so CI / tests catch regressions.
// scrubSoft() returns redacted text instead of throwing — for legacy fallback.
//
// 2026-05-03 — asset-class-aware ban for "WHAT THIS MEANS FOR THE PAIR".
// FX symbols are allowed to keep the phrase; equity / index / commodity
// symbols must use a class-appropriate header (the calendar emitter
// generates "WHAT THIS MEANS FOR THE STOCK" / "INDEX" / "INSTRUMENT" in
// non-FX cases). Old call signature `scrub(text)` is preserved for
// back-compat — if no opts are provided the strict pre-2026-05-03
// behaviour applies (ban fires for everything).

// Patterns banned for ALL asset classes.
const UNIVERSAL_BAN = [
  /\bWAIT\s*\/\s*LIGHT PARTICIPATION ONLY\b/g,
  /\blight participation only\b/gi,
  /\bif confirmed\b/gi,
  /\bsignal strength\b/gi,
  /\bTrade permit is available\.\s*Execution is unlocked\b/gi,
  /\bTRADE BLOCKED\s*[—-]\s*REASON\b/gi,
  /\bdistance context:\s*[≈~]?\s*\d+\s*pips\b/gi,
  /\bexecution conditions are normal\b/gi,
  /\bfresh structural break that matches the macro direction\b/gi,
  /\bbroken level\b/gi,
  /\bbroken support\b/gi,
  /\bbroken resistance\b/gi,
  /\bhold above broken level\b/gi,
  /\bmatches the macro direction\s*\(Neutral\)/gi,
  /\bAbstain \(0%\)/gi
];

// Patterns banned only for non-FX asset classes. The FX path is permitted to
// retain "WHAT THIS MEANS FOR THE PAIR" because it is asset-class-correct.
const NON_FX_ONLY_BAN = [
  /\bWHAT THIS MEANS FOR THE PAIR\b/g
];

// Back-compat — kept for any external consumer that imports BAN_PATTERNS.
const BAN_PATTERNS = UNIVERSAL_BAN.concat(NON_FX_ONLY_BAN);

const TRANSLATE = [
  [/\bUSD short\b/g,
   'The model expects the US dollar to weaken, which supports upside pressure on EURUSD / GBPUSD and downside pressure on USDJPY, depending on structure.'],
  [/(^|[^A-Za-z])SL([^A-Za-z]|$)/g, '$1Stop Loss$2'],
  [/\bbroken level\b/gi, 'confirmed structure point'],
  [/\bbroken support\b/gi, 'BOS confirmation level'],
  [/\bbroken resistance\b/gi, 'BOS confirmation level'],
  [/\bhold above broken level\b/gi, 'hold above the confirmed structure point'],
  [/\bAbstain \(0%\)/gi, 'No authorised trade conviction']
];

// Normalise an asset-class hint to one of: 'fx' | 'equity' | 'index' | 'commodity' | 'unknown'.
function normaliseClass(ac) {
  if (!ac) return 'unknown';
  const s = String(ac).toLowerCase();
  if (s === 'fx' || s === 'forex' || s === 'currency') return 'fx';
  if (s === 'equity' || s === 'stock') return 'equity';
  if (s === 'index') return 'index';
  if (s === 'commodity' || s === 'metal' || s === 'energy') return 'commodity';
  return 'unknown';
}

function buildBanListForClass(ac) {
  const klass = normaliseClass(ac);
  // FX is allowed to keep the PAIR header; everyone else must use the
  // class-specific phrasing emitted by corey_calendar.getEventIntelligence.
  if (klass === 'fx') return UNIVERSAL_BAN.slice();
  return UNIVERSAL_BAN.concat(NON_FX_ONLY_BAN);
}

function scrub(text, opts) {
  let t = text;
  for (const [re, rep] of TRANSLATE) t = t.replace(re, rep);
  const bans = buildBanListForClass(opts && opts.assetClass);
  for (const re of bans) {
    if (re.test(t)) throw new Error('MACRO_BAN_VIOLATION: ' + re);
  }
  return t;
}

// Soft scrub — replaces banned tokens with a redaction marker instead of throwing.
// Use only on legacy fallback path so the bot never silently posts banned strings
// even when v3 has thrown. Asset-class-aware: keeps "WHAT THIS MEANS FOR THE
// PAIR" intact for FX symbols.
function scrubSoft(text, opts) {
  let t = text;
  for (const [re, rep] of TRANSLATE) t = t.replace(re, rep);
  const bans = buildBanListForClass(opts && opts.assetClass);
  for (const re of bans) {
    t = t.replace(re, '[redacted-banned-phrase]');
  }
  return t;
}

function dollars(usd, pips) {
  if (usd == null || !Number.isFinite(usd)) return 'n/a';
  const head = '$' + Math.round(usd).toLocaleString();
  return pips != null && Number.isFinite(pips) ? head + ' (' + pips + ' pips)' : head;
}

function arrow(score) {
  if (score == null || !Number.isFinite(score)) return '';
  if (score > 0.05) return '⬆️';
  if (score < -0.05) return '⬇️';
  return '⬆️⬇️';
}

// Asset-class language gate. Returns true if the text is safe for the given class.
function assetClassSafe(text, assetClass) {
  if (assetClass !== 'equity' && assetClass !== 'index' && assetClass !== 'commodity') return true;
  // For non-FX symbols, FX-only language is unsafe.
  return !/(\bpip\b|\bpips\b|\bstandard lot\b|\bbase currency\b|\bquote currency\b|\bpip distance\b|\bnon-USD trade\b)/i.test(text);
}

module.exports = { scrub, scrubSoft, dollars, arrow, assetClassSafe, BAN_PATTERNS, UNIVERSAL_BAN, NON_FX_ONLY_BAN };
