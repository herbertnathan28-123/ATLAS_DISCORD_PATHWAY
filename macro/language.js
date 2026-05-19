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
// Locked dashboard/macro wording standard — these terms must never
// reach a user-facing surface.
const UNIVERSAL_BAN = [
  // Existing locked phrases (kept).
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
  /\bAbstain \(0%\)/gi,
  // Newly locked banned terms (May 2026 wording standard).
  /\bstand\s+aside\b/gi,
  /\bstand\s+down\b/gi,
  /\bsideways\b/gi,
  /\bNO\s+new\s+entries\b/gi,
  /\bNo\s+entry\s+authorised\b/gi,
  /\btrigger\b/gi,                        // use "confirmation" instead
  /\bauthoris(?:ed|e)\b/gi,
  /\bauthoriz(?:ed|e)\b/gi,
  /\bpermitted\b/gi,
  /\bpermission\b/gi,
  /\bblocked\b/gi,
  /\bwithheld\b/gi,
  /\bno clear edge\b/gi,
  /\bprobability low\b/gi,
  /\btrade probability\b/gi,
  /\btrade range\b/gi,
  /\bexecution map\b/gi,
  /\bnot implemented\b/gi,
  /\bunavailable\b/gi,
  /\bincomplete\b/gi,
  // Engine names — banned on the user-facing surface. Internal
  // logs/audit/Source-Status text must use these via the sanitiser
  // that bypasses scrub (call sites pass { internal: true }).
  /\bcorey clone\b/gi,
  /\bcorey\b/gi,
  /\bspidey\b/gi,
  /\bjane\b/gi,
  // Legacy FINAL VERDICT presenter strings (May 2026 live-output
  // regression). These appeared in production because the legacy
  // formatMacro fell through when the macro v3 require shadow bug
  // returned undefined for buildMacroV3. Ban them on the user surface
  // unconditionally so they cannot resurface even if v3 throws.
  /\bFINAL VERDICT\b/gi,
  /\bFINAL DECISION\b/gi,
  /\bFINAL READ\b/gi,
  /\bWHAT CHANGES THE VIEW\b/gi,
  /\bWHAT KEEPS IT (?:BLOCKED|paused)\b/gi,
  // Note: "Validity window" (lowercase narrative) is allowed inside the
  // VALIDITY section; only the legacy uppercase heading versions above
  // are banned. CATALYST WINDOW likewise allowed as a body phrase.
  // Internal enum / state-machine literals.
  /\bHardConflict\b/g,
  /\bPartialConflict\b/g,
  /\bMarket Readiness\b/g,
  // Operator-paraphrased engine references that survived the
  // engine-name TRANSLATE pass (e.g. "macro engine's composite",
  // "structure engine packet").
  /\bmacro engine'?s?\s+composite\b/gi,
  /\bstructure engine'?s?\s+packet\b/gi,
  /\bmacro engine\b/gi,
  /\bstructure engine\b/gi,
  /\bhistorical engine\b/gi,
  // Doctrine: keep BOS / CHoCH internal-only. Surface emits must read
  // `[Structure Break]` and `[Initial-direction reversal]`. PRs #76,
  // #77, #78, #79, #80, #82 translated every macro-side user-facing
  // emit; this regression-guard ban catches any future leak through
  // macro/index.js::buildMacroV3's strict scrub path. Note: `index.js`
  // does NOT call macro/language.scrub, so the buildForwardBlock
  // fallback at index.js:1648 (covered by separate PR #81) is not
  // affected by this ban — it lives outside the macro v3 scrub path.
  /\bBOS\b/,
  /\bCHoCH\b/
];

// Patterns banned only for non-FX asset classes. The FX path is permitted to
// retain "WHAT THIS MEANS FOR THE PAIR" because it is asset-class-correct.
const NON_FX_ONLY_BAN = [
  /\bWHAT THIS MEANS FOR THE PAIR\b/g
];

// Back-compat — kept for any external consumer that imports BAN_PATTERNS.
const BAN_PATTERNS = UNIVERSAL_BAN.concat(NON_FX_ONLY_BAN);

// Translations are applied BEFORE the ban scan, so they normalise legacy
// wording into the locked operator copy. Order matters — multi-word
// patterns first.
const TRANSLATE = [
  [/\bUSD short\b/g,
   'The model expects the US dollar to weaken, which supports upside pressure on EURUSD / GBPUSD and downside pressure on USDJPY, depending on structure.'],
  [/(^|[^A-Za-z])SL([^A-Za-z]|$)/g, '$1Stop Loss$2'],
  [/\bbroken level\b/gi, 'confirmed structure point'],
  [/\bbroken support\b/gi, '[Structure Break] confirmation level'],
  [/\bbroken resistance\b/gi, '[Structure Break] confirmation level'],
  [/\bhold above broken level\b/gi, 'hold above the confirmed structure point'],
  [/\bAbstain \(0%\)/gi, 'No active read'],
  [/\bstand\s+aside\b/gi, 'entry conditions not met — monitor for confirmation'],
  [/\bstand\s+down\b/gi, 'entry conditions not met — monitor for confirmation'],
  [/\bsideways\b/gi, 'inside the current price band'],
  [/\bNO\s+new\s+entries\b/gi, 'Entry not probable for this validity window'],
  [/\bNo\s+entry\s+authorised\b/gi, 'Entry not probable for this validity window'],
  [/\bEQUITY\b/g, 'Equity — US-listed stock'],
  [/\bBOS\b/g, '[Structure Break]'],
  [/\bCHoCH\b/g, '[Trend Shift]'],
  [/\bUUP proxy quote\s+(\$[0-9]+(?:\.[0-9]+)?)/gi, 'US Dollar Strength (DXY) — tracked via UUP ETF — $1'],
  [/\bVXX proxy\s+(\$[0-9]+(?:\.[0-9]+)?)/gi, 'Market Volatility (VIX) — tracked via VXX ETF — $1'],
  [/\bDXY\s*\/\s*VIX\b/g, 'US Dollar Strength (DXY) / Market Volatility (VIX)'],
  [/\bDXY\s+and\s+VIX\b/gi, 'US Dollar Strength (DXY) and Market Volatility (VIX)'],
  [/(?<!\()DXY\b/g, 'US Dollar Strength (DXY)'],
  [/(?<!\()VIX\b/g, 'Market Volatility (VIX)'],
  [/\bpp\b/g, 'percentage points'],
  // Hard-coded retranslation of legacy wording so old packets, log lines,
  // and seed text still produce locked-spec output even before the
  // ban scan runs.
  [/\bENTRY AUTHORISED\b/gi, 'ENTRY CONFIRMED'],
  [/\bENTRY NOT AUTHORISED\b/gi, 'ENTRY NOT AVAILABLE'],
  [/\bENTRY AUTHORIZED\b/gi, 'ENTRY CONFIRMED'],
  [/\bENTRY NOT AUTHORIZED\b/gi, 'ENTRY NOT AVAILABLE'],
  [/\bDO NOT TRADE\b/g, 'STAND DOWN — NO ACTIVE TRADE'],
  [/\bWAIT\s*[—-]\s*NO TRADE\b/g, 'HOLD — NO ACTIVE TRADE'],
  [/\bWAITING FOR TRIGGER\b/gi, 'WAITING FOR CONFIRMATION'],
  [/\bTRIGGER APPROACHING\b/gi, 'CONFIRMATION APPROACHING'],
  [/\bTRIGGER MAP\b/gi, 'CONFIRMATION POINTS'],
  [/\bTrade Permit is BLOCKED\b/gi, 'Trade entry not available'],
  [/\bTrade Permit MUST be BLOCKED\b/gi, 'Trade entry not available'],
  [/\bTrade Permit\b/gi, 'Trade Status'],
  [/\bTRADE PERMIT\b/gi, 'TRADE STATUS'],
  [/\bWITHHELD\b/g, 'PAUSED'],
  [/\bWithheld\b/g, 'Paused'],
  [/\bwithheld\b/gi, 'paused'],
  [/\bAUTHORISATION\b/gi, 'CONFIRMATION'],
  [/\bAUTHORIZATION\b/gi, 'CONFIRMATION'],
  [/\bauthoris(ed|e)\b/gi, 'confirmed'],
  [/\bauthoriz(ed|e)\b/gi, 'confirmed'],
  [/\bnot authorised\b/gi, 'not available'],
  [/\bnot authorized\b/gi, 'not available'],
  [/\bpermitted\b/gi, 'available'],
  [/\bpermission\b/gi, 'status'],
  [/\bnot implemented\b/gi, 'pending'],
  [/\b(?:is\s+)?unavailable\b/gi, 'pending'],
  [/\bincomplete\b/gi, 'pending'],
  [/\btrigger map\b/gi, 'confirmation points'],
  [/\bentry trigger\b/gi, 'entry confirmation'],
  [/(?<=^|[^A-Za-z])triggers?(?=[^A-Za-z]|$)/gi, 'confirmation'],
  [/\btrigger\b/gi, 'confirmation'],
  [/\bblocked\b/gi, 'paused'],
  [/\btrade probability\b/gi, 'target status'],
  [/\bno clear edge\b/gi, 'no leading path'],
  [/\bprobability low\b/gi, 'setup quality low'],
  [/\btrade range\b/gi, 'price band'],
  [/\bexecution map\b/gi, 'analysed targets'],
  [/\bEXECUTION MAP\b/g, 'ANALYSED TARGETS'],
  // Engine-name scrub — only on user-facing text. Internal log paths
  // bypass scrub by passing { internal: true }. Approved public labels
  // (2026-05-12 dashboard surface separation lane):
  //   Corey       → Macro context
  //   Corey Clone → Secondary macro model
  //   Spidey      → Market structure
  //   Jane        → Final assessment
  [/\bCorey Clone\b/g, 'Secondary macro model'],
  [/\bcorey clone\b/gi, 'secondary macro model'],
  [/\bCorey\b/g, 'Macro context'],
  [/\bcorey\b/gi, 'macro context'],
  [/\bSpidey\b/g, 'Market structure'],
  [/\bspidey\b/gi, 'market structure'],
  [/\bJane\b/g, 'Final assessment'],
  [/\bjane\b/gi, 'final assessment']
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
