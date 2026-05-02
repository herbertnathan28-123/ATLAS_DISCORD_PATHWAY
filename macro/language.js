'use strict';
// §5 ban-list + §6 plain-English translator + dollars-first formatter. Throws on ban violation so CI / tests catch regressions.

const BAN_PATTERNS = [
  /\bWAIT\s*\/\s*LIGHT PARTICIPATION ONLY\b/g,
  /\blight participation only\b/gi,
  /\bif confirmed\b/gi,
  /\bsignal strength\b/gi
];

const TRANSLATE = [
  [/\bUSD short\b/g,
   'The model expects the US dollar to weaken, which supports upside pressure on EURUSD / GBPUSD and downside pressure on USDJPY, depending on structure.'],
  [/(^|[^A-Za-z])SL([^A-Za-z]|$)/g, '$1Stop Loss$2']
];

function scrub(text) {
  let t = text;
  for (const [re, rep] of TRANSLATE) t = t.replace(re, rep);
  for (const re of BAN_PATTERNS) {
    if (re.test(t)) throw new Error(`MACRO_BAN_VIOLATION: ${re}`);
  }
  return t;
}

function dollars(usd, pips) {
  if (usd == null || !Number.isFinite(usd)) return 'n/a';
  const head = `$${Math.round(usd).toLocaleString()}`;
  return pips != null && Number.isFinite(pips) ? `${head} (${pips} pips)` : head;
}

function arrow(score) {
  if (score == null || !Number.isFinite(score)) return '';
  if (score > 0.05) return '⬆️';
  if (score < -0.05) return '⬇️';
  return '⬆️⬇️';
}

module.exports = { scrub, dollars, arrow };
