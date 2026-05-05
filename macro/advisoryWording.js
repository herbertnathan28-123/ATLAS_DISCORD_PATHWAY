'use strict';
// macro/advisoryWording.js — central wording remapper.
//
// Banned: "authorised" / "authorise" / "permission" / "permit" /
// "trade permit" / "blocked" / "WAIT — NO TRADE" / "No entry authorised"
// / "live order permitted" / "entry can be authorised".
//
// Allowed: ENTRY NOT ADVISED / HOLD — BIAS STILL FORMING /
// MONITOR — CONDITIONS BUILDING / ENTRY CONDITIONS DEVELOPING /
// ENTRY CONDITIONS SUPPORTED / TRADE PROBABILITY HIGH /
// TRADE INVALIDATED / DECISION WITHHELD — SOURCE INCOMPLETE.
//
// Public API:
//   remapAdvisoryWording(s)        - replace banned tokens in a string
//   advisoryActionState(rawState)  - full state remap, returns canonical action label
//   classifyAdvisoryTone(state)    - returns 'green'|'gold'|'amber'|'red' for the action
//   advisoryTradeStatus(rawStatus) - replaces "No entry authorised" etc with advisory phrasing
//   marketConfidenceLabel(score)   - Low/Medium/High from 0..1 confidence
//   tradeProbability1to5(jane)     - integer 1..5 derived from jane.conviction/readiness
//   filterBannedFromText(text)     - belt-and-braces sweep across user-facing text
//
// Acceptance: every user-facing string emitted by the bot or stored on the
// Jane packet must pass `filterBannedFromText` without changes.

const BANNED_PATTERNS = [
  // [regex, replacement]
  // ORDER MATTERS — multi-word phrases must be checked BEFORE single-word
  // remaps so "ENTRY NOT AUTHORISED" doesn't get partially rewritten to
  // "ENTRY Not yet defined" by the generic "Not authorised" rule.
  [/(?:WAIT)\s*[—\-]\s*NO\s+TRADE/gi,           'HOLD — BIAS STILL FORMING'],
  [/ENTRY\s+NOT\s+AUTHORISED/gi,                'ENTRY NOT ADVISED'],
  [/No\s+entry\s+authorised/gi,                 'No active trade signal yet'],
  [/no\s+authorised\s+trade\s+conviction/gi,    'no decisive trade conviction yet'],
  [/Not\s+authorised/gi,                        'Not yet defined'],
  [/not\s+authorised/g,                         'not yet defined'],
  [/live\s+order\s+permitted/gi,          'live entry condition supported'],
  [/entry\s+can\s+be\s+authorised/gi,     'entry condition can develop'],
  [/Trade\s+permit\s+is\s+BLOCKED/gi,     'Trade is on HOLD'],
  [/Trade\s+permit\s+is\s+CONDITIONAL/gi, 'Trade is in MONITOR — CONDITIONS BUILDING'],
  [/Trade\s+permit\s+is\s+AVAILABLE/gi,   'Entry conditions are supported'],
  [/TRADE\s+PERMIT\s+BLOCKED/gi,          'TRADE ON HOLD'],
  [/TRADE\s+PERMIT\s+DISABLED/gi,         'TRADE ON HOLD — BUILD MODE'],
  [/TRADE\s+PERMIT\s+AVAILABLE/gi,        'ENTRY CONDITIONS SUPPORTED'],
  [/permit\s+available/gi,                'entry conditions supported'],
  [/PERMIT\s+BLOCKED/gi,                  'ON HOLD'],
  [/permitStatusLine/g,                   'permitStatusLine'], // function name — leave alone here
  [/entry\s+is\s+blocked/gi,              'entry is on HOLD'],
  [/execution\s+is\s+blocked/gi,          'execution is on HOLD'],
  [/decision\s+blocked/gi,                'decision withheld'],
  [/BLOCKED\s*[—\-]\s*no\s+entry\s+authorised/gi, 'ON HOLD — no active trade signal'],
  // Phrasal remaps before the single-word "authoris*" remapper, so
  // "no authorised entry" reads as "no active entry" rather than the
  // awkward "no developd entry".
  [/no\s+authorised\s+entry/gi,            'no active entry'],
  [/no\s+authorised\b/gi,                  'no active'],
  [/authorised\s+entry/gi,                 'active entry'],
  [/authorised\s+plan/gi,                  'active plan'],
  [/authorising\s+new\s+capital/gi,        'committing new capital'],
  [/authorising/gi,                        'committing'],
  [/path\s+is\s+authorised/gi,             'path is supported'],
  [/is\s+authorised\s+yet/gi,              'is supported yet'],
  [/ENTRY AUTHORISED/g,                    'ENTRY TRIGGERED'],
  [/AUTHORISED\b/g,                        'TRIGGERED'],
  [/authoris(?:e|ed|ing|ation)/gi,         m => {
    if (/^authorise$/i.test(m))    return 'support';
    if (/^authorised$/i.test(m))   return 'supported';
    if (/^authorising$/i.test(m))  return 'supporting';
    if (/^authorisation$/i.test(m))return 'support';
    return 'support';
  }],
  [/permission/gi,                         'status'],
];

function remapAdvisoryWording(input) {
  if (input == null) return input;
  let s = String(input);
  for (const [rx, repl] of BANNED_PATTERNS) {
    s = s.replace(rx, repl);
  }
  return s;
}

// Action-state canonical mapping.
//   no-go (red)        -> ENTRY NOT ADVISED
//   waiting (amber)    -> HOLD — BIAS STILL FORMING
//                      -> MONITOR — CONDITIONS BUILDING
//                      -> ENTRY CONDITIONS DEVELOPING
//   armed (gold)       -> ARMED — WAITING FOR TRIGGER  (kept; not a permission word)
//   triggered (green)  -> ENTRY CONDITIONS SUPPORTED / ENTRY TRIGGERED
//   confirmed (green)  -> TRADE CONFIRMED
//   invalidated (red)  -> TRADE INVALIDATED
//   withheld (amber)   -> DECISION WITHHELD — SOURCE INCOMPLETE
function advisoryActionState(rawState) {
  if (!rawState) return 'HOLD — BIAS STILL FORMING';
  const s = String(rawState);
  // Direct remap first.
  const remapped = remapAdvisoryWording(s).toUpperCase();
  // Canonicalise to one of the allowed labels.
  if (/INVALIDATE/i.test(s))                        return 'TRADE INVALIDATED';
  if (/CONFIRMED/i.test(s))                         return 'TRADE CONFIRMED';
  if (/TRIGGER(?:ED)?/i.test(remapped) && !/WAITING/.test(remapped)) return 'ENTRY TRIGGERED';
  if (/SUPPORT(?:ED)?/i.test(remapped))             return 'ENTRY CONDITIONS SUPPORTED';
  if (/ARMED/i.test(s))                             return 'ARMED — WAITING FOR TRIGGER';
  if (/MONITOR|CONDITIONS\s+BUILDING/i.test(remapped)) return 'MONITOR — CONDITIONS BUILDING';
  if (/DEVELOPING|CONDITIONS\s+DEVELOPING/i.test(remapped)) return 'ENTRY CONDITIONS DEVELOPING';
  if (/WITHHELD|SOURCE\s+INCOMPLETE/i.test(remapped))      return 'DECISION WITHHELD — SOURCE INCOMPLETE';
  if (/HOLD\s*[—\-]/i.test(remapped))               return 'HOLD — BIAS STILL FORMING';
  if (/NO\s+ACTIVE\s+TRADE|NO\s+TRADE/i.test(remapped))   return 'HOLD — BIAS STILL FORMING';
  if (/NOT\s+ADVISED/i.test(remapped))              return 'ENTRY NOT ADVISED';
  if (/PENDING/i.test(remapped))                    return 'ATLAS ANALYSIS PENDING';
  // Default — remap and trim.
  return remapped.trim();
}

function classifyAdvisoryTone(state) {
  const s = String(state || '').toUpperCase();
  if (/CONFIRMED|TRIGGERED|SUPPORTED/.test(s))  return 'green';
  if (/ARMED/.test(s))                          return 'gold';
  if (/MONITOR|DEVELOPING|HOLD|PENDING|WITHHELD/.test(s)) return 'amber';
  if (/INVALIDATED|NOT\s+ADVISED/.test(s))      return 'red';
  return 'amber';
}

function advisoryTradeStatus(raw) {
  const s = remapAdvisoryWording(raw || '');
  if (!s || /^—?$/.test(s)) return 'No active trade signal yet';
  return s;
}

function marketConfidenceLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'Pending';
  if (n >= 0.65) return 'High';
  if (n >= 0.40) return 'Medium';
  return 'Low';
}

// Trade probability 1..5 derived from Jane's conviction or readiness.
//   conviction 0..1 -> 1..5 by tier
//   readiness 0..10 -> 1..5 by tier
function tradeProbability1to5(jane) {
  if (!jane) return 1;
  // Explicit override always wins.
  if (Number.isFinite(jane.tradeProbability)) return Math.max(1, Math.min(5, Math.round(jane.tradeProbability)));
  if (jane.doNotTrade)     return 1;
  if (jane.invalidated)    return 1;
  // Conviction primary.
  const c = Number(jane.conviction);
  if (Number.isFinite(c)) {
    if (c >= 0.80) return 5;
    if (c >= 0.60) return 4;
    if (c >= 0.40) return 3;
    if (c >= 0.20) return 2;
    return 1;
  }
  const r = Number(jane.readiness);
  if (Number.isFinite(r)) {
    if (r >= 8) return 5;
    if (r >= 6) return 4;
    if (r >= 4) return 3;
    if (r >= 2) return 2;
    return 1;
  }
  return 1;
}

// Belt-and-braces sweep — log diagnostic for any banned token still present
// after remap. Used by the presenter QA to fail fast on regressions.
function filterBannedFromText(text) {
  if (!text) return { ok: true, hits: [] };
  const hits = [];
  const checks = [
    [/authoris(?:e|ed|ing|ation)/i, 'authoris*'],
    [/permission/i,                  'permission'],
    [/\btrade permit\b/i,            'trade permit'],
    [/WAIT\s*[—\-]\s*NO\s+TRADE/i,   'WAIT — NO TRADE'],
    [/No entry authorised/i,         'No entry authorised'],
    [/live order permitted/i,        'live order permitted'],
    [/entry can be authorised/i,     'entry can be authorised'],
  ];
  for (const [rx, label] of checks) if (rx.test(text)) hits.push(label);
  return { ok: hits.length === 0, hits };
}

// Remap object KEY names — ensures JSON.stringify never emits a banned
// token in a key (the value-only deep remap can't touch keys). Used by
// the recursive packet remap in index.js. Known keys map to advisory
// equivalents; unknown keys with banned tokens are renamed generically.
//
// Acceptance: any field name carrying "permission" / "permit" / "authoris*"
// gets renamed before the packet is JSON.stringify'd, so the post-remap
// banned-token sweep returns clean.
const KEY_REMAP = {
  tradePermission:    'tradeStatus',
  permission:         'advisoryState',
  permitLabel:        'advisoryStateLabel',
  permit:             'advisoryState',
  permitStatus:       'advisoryStatus',
  permitPlain:        'advisoryStatePlain',
  authorisation:      'support',
  authorisationLevel: 'supportLevel'
};
function remapKeyName(key) {
  if (!key || typeof key !== 'string') return key;
  if (Object.prototype.hasOwnProperty.call(KEY_REMAP, key)) return KEY_REMAP[key];
  // Generic fallback for ad-hoc keys.
  if (/permission/.test(key)) return key.replace(/permission/g, 'advisoryState').replace(/Permission/g, 'AdvisoryState');
  if (/permit/.test(key))     return key.replace(/permit/g, 'advisoryState').replace(/Permit/g, 'AdvisoryState');
  if (/authoris/i.test(key))  return key.replace(/[Aa]uthoris(?:ed|ing|ation|e)?/g, m => /^A/.test(m) ? 'Supported' : 'supported');
  return key;
}

module.exports = {
  remapAdvisoryWording,
  advisoryActionState,
  classifyAdvisoryTone,
  advisoryTradeStatus,
  marketConfidenceLabel,
  tradeProbability1to5,
  filterBannedFromText,
  remapKeyName,
  KEY_REMAP,
  BANNED_PATTERNS
};
