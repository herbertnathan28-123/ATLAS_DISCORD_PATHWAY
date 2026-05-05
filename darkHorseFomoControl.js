'use strict';
// ============================================================
// ATLAS FX — DARK HORSE FOMO CONTROL LAYER (add-on)
// Doctrine:
//   Movement      ≠ Trade opportunity ≠ Confirmed WATCH candidate.
//   Movement alone is awareness only.
//   WATCH itself is advisory only — Jane retains final authority.
//
// This module is presentation-only. It does NOT change scoring,
// thresholds, or pipeline triggering. It governs what Dark Horse
// is allowed to SAY, and adds a movement digest for the case
// where conditions are moving but no WATCH candidate exists.
// ============================================================

// ── ALLOWED CONTROLLED PHRASES (reference only) ─────────────
const ALLOWED_PHRASES = [
  'GLOBAL MOVEMENT ACTIVE',
  'MONITORING ONLY',
  'NO CONFIRMED DARK HORSE WATCH CANDIDATE',
  'INTERNAL WATCHLIST ONLY',
  'VOLATILITY ELEVATED — TRADE CONFIRMATION NOT PRESENT',
  'CONDITIONS MOVING, BUT ENTRY QUALITY NOT CONFIRMED',
  'DO NOT CHASE THE MOVE',
  'LATE ENTRY RISK HIGH',
  'WAIT FOR STRUCTURE CONFIRMATION',
  'No trade alert / monitoring only',
];

// ── BANNED HYPE / IMMEDIATE-ACTION / PERMISSION WORDING ─────
// Word boundaries used so technical Corey/Spidey vocabulary
// elsewhere in the codebase is not affected — this sanitizer
// only runs on Dark Horse payloads.
const BANNED_PATTERNS = [
  { name: 'buy_now',           pattern: /\bbuy\s+now\b/i },
  { name: 'sell_now',          pattern: /\bsell\s+now\b/i },
  { name: 'urgent_entry',      pattern: /\burgent\s+entry\b/i },
  { name: 'get_in',            pattern: /\bget\s+in\b/i },
  { name: 'dont_miss',         pattern: /\b(?:do\s+not|don[’']?t)\s+miss\b/i },
  { name: 'rocket',            pattern: /\brocket(?:s|ed|ing)?\b/i },
  { name: 'moon',              pattern: /\bmoon(?:shot|ing)?\b/i },
  { name: 'crash',             pattern: /\bcrash(?:ing|ed|es)?\b/i },
  { name: 'guaranteed',        pattern: /\bguarante(?:e|ed|es|eing)\b/i },
  { name: 'authorised',        pattern: /\bauthori[sz]ed?\b/i },
  { name: 'authorisation',     pattern: /\bauthori[sz]ation\b/i },
  { name: 'permission',        pattern: /\bpermissions?\b/i },
  { name: 'must_act',          pattern: /\bmust\s+(?:buy|sell|enter|act|trade|take)\b/i },
  { name: 'act_now',           pattern: /\bact\s+now\b/i },
  { name: 'dont_wait',         pattern: /\b(?:do\s+not|don[’']?t)\s+wait\b/i },
  { name: 'now_or_never',      pattern: /\bnow\s+or\s+never\b/i },
  { name: 'send_it',           pattern: /\bsend\s+it\b/i },
  { name: 'go_go_go',          pattern: /\bgo\s+go\s+go\b/i },
  { name: 'last_chance',       pattern: /\blast\s+chance\b/i },
];

// ── EXACT CAUTION LINE (verbatim per spec) ──────────────────
const FOMO_CAUTION =
  '⚠️ Movement is active, but this is not a trade alert. Do not chase late moves. Wait for confirmed structure.';

// ── ADVISORY TRAILER (used on WATCH payloads) ───────────────
const WATCH_ADVISORY_TRAILER =
  'Advisory only — wait for structure confirmation. Movement is not entry. Jane retains final authority.';

// ── VOLATILITY THRESHOLDS (derived from scan + optional VIX) ─
const VOL_INTERNAL_ELEVATED = 3;   // ≥3 INTERNAL candidates → elevated
const VOL_INTERNAL_EXTREME  = 6;   // ≥6 INTERNAL candidates → extreme
const VOL_AVG_ELEVATED      = 6;   // avg internal score ≥6 → elevated
const VIX_LEVEL_ELEVATED    = new Set(['High', 'Elevated', 'Extreme']);

// ── DIGEST COOLDOWN (rate-limit anti-spam) ──────────────────
const MOVEMENT_DIGEST_COOLDOWN_MS = 60 * 60 * 1000; // 60 min

// ============================================================
// VOLATILITY ASSESSMENT
// Inputs:
//   results = scan results (array of { symbol, score, direction, status })
//   externalVixLevel = optional 'Normal' | 'Elevated' | 'High' from corey
// Output:
//   { level: 'quiet' | 'elevated' | 'extreme',
//     internalCount, watchCount, avgInternalScore, vixLevel, reason }
// ============================================================
function assessVolatility(results, externalVixLevel) {
  const arr = Array.isArray(results) ? results : [];
  const watch    = arr.filter(r => r && r.status === 'WATCH');
  const internal = arr.filter(r => r && r.status === 'INTERNAL');

  const avgInternalScore = internal.length
    ? internal.reduce((s, r) => s + (r.score || 0), 0) / internal.length
    : 0;

  const vixLevel = externalVixLevel || null;
  const vixHigh = vixLevel ? VIX_LEVEL_ELEVATED.has(vixLevel) : false;

  let level = 'quiet';
  const reasons = [];

  if (internal.length >= VOL_INTERNAL_EXTREME) {
    level = 'extreme';
    reasons.push(`${internal.length} internal candidates`);
  } else if (
    internal.length >= VOL_INTERNAL_ELEVATED ||
    (internal.length >= 1 && avgInternalScore >= VOL_AVG_ELEVATED) ||
    vixHigh
  ) {
    level = 'elevated';
    if (internal.length >= VOL_INTERNAL_ELEVATED) reasons.push(`${internal.length} internal candidates`);
    if (avgInternalScore >= VOL_AVG_ELEVATED)     reasons.push(`avg internal score ${avgInternalScore.toFixed(1)}/10`);
    if (vixHigh)                                   reasons.push(`VIX ${vixLevel}`);
  }

  return {
    level,
    watchCount:       watch.length,
    internalCount:    internal.length,
    avgInternalScore: Number(avgInternalScore.toFixed(2)),
    vixLevel,
    reason:           reasons.join(' · ') || 'within quiet bounds',
  };
}

// ============================================================
// SHOULD POST MOVEMENT DIGEST?
// Fires only when:
//   1. WATCH:0
//   2. Volatility level >= 'elevated'
//   3. Cooldown elapsed since last digest
// ============================================================
function shouldPostMovementDigest(volatility, lastDigestAt) {
  if (!volatility) return false;
  if (volatility.watchCount > 0) return false;            // WATCH alert takes precedence
  if (volatility.level === 'quiet') return false;         // nothing to report
  if (volatility.internalCount === 0 && !volatility.vixLevel) return false; // nothing to monitor
  const last = Number(lastDigestAt || 0);
  if (last && Date.now() - last < MOVEMENT_DIGEST_COOLDOWN_MS) return false;
  return true;
}

// ============================================================
// BUILD MOVEMENT DIGEST PAYLOAD
// Awareness-only. Internal candidates listed as monitoring only.
// No direction-as-trade-call wording.
// ============================================================
function buildMovementDigestPayload(volatility, internalResults) {
  const internal = Array.isArray(internalResults) ? internalResults.slice() : [];
  internal.sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = internal.slice(0, 5);

  const moversBlock = top.length
    ? top.map(r => {
        const arrow = r.direction === 'Bullish' ? '↑' : r.direction === 'Bearish' ? '↓' : '→';
        return `• **${r.symbol}** ${arrow} — directional movement observed (internal watchlist · monitoring only)`;
      }).join('\n')
    : '_No specific instruments cleared the internal threshold this cycle._';

  const vixSuffix = volatility.vixLevel ? ` (VIX ${volatility.vixLevel})` : '';
  const volLine = `**VOLATILITY ELEVATED — TRADE CONFIRMATION NOT PRESENT**${vixSuffix}`;

  const content =
    `🐎 **DARK HORSE — GLOBAL MOVEMENT ACTIVE**\n\n` +
    `**State:** MONITORING ONLY · NO CONFIRMED DARK HORSE WATCH CANDIDATE\n` +
    `${volLine}\n` +
    `**Internal watchlist:** ${volatility.internalCount} instrument${volatility.internalCount === 1 ? '' : 's'} ` +
      `(${volatility.reason})\n\n` +
    `**Top movers (internal watchlist · monitoring only):**\n${moversBlock}\n\n` +
    `CONDITIONS MOVING, BUT ENTRY QUALITY NOT CONFIRMED.\n` +
    `LATE ENTRY RISK HIGH. DO NOT CHASE THE MOVE. WAIT FOR STRUCTURE CONFIRMATION.\n\n` +
    `${FOMO_CAUTION}\n\n` +
    `Pipeline retains final authority: Corey → Spidey → Jane.`;

  return { content, kind: 'movement_digest' };
}

// ============================================================
// SANITIZE — defensive last-mile gate.
// Replaces any banned phrase with [REDACTED-FOMO] and logs.
// Returns { content, foundBanned: [string], replaced: bool }.
// ============================================================
function sanitize(payload) {
  const original = (payload && payload.content) || '';
  let content = original;
  const foundBanned = [];

  for (const { name, pattern } of BANNED_PATTERNS) {
    if (pattern.test(content)) {
      foundBanned.push(name);
      content = content.replace(new RegExp(pattern.source, pattern.flags + (pattern.flags.includes('g') ? '' : 'g')), '[REDACTED-FOMO]');
    }
  }

  if (foundBanned.length) {
    const ts = new Date().toISOString();
    console.warn(`[${ts}] [FOMO-GUARD] banned phrases stripped: ${foundBanned.join(',')}`);
  }

  return Object.assign({}, payload, { content, foundBanned, replaced: foundBanned.length > 0 });
}

// ============================================================
// WITH FOMO CAUTION — appends the caution line if absent.
// Idempotent. Used on WATCH payloads (the digest already
// contains it).
// ============================================================
function withFomoCaution(payload) {
  const content = (payload && payload.content) || '';
  if (content.includes(FOMO_CAUTION)) return payload;
  return Object.assign({}, payload, {
    content: content.replace(/\s*$/, '') + `\n\n${FOMO_CAUTION}\n${WATCH_ADVISORY_TRAILER}`,
  });
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  ALLOWED_PHRASES,
  BANNED_PATTERNS,
  FOMO_CAUTION,
  WATCH_ADVISORY_TRAILER,
  MOVEMENT_DIGEST_COOLDOWN_MS,
  assessVolatility,
  shouldPostMovementDigest,
  buildMovementDigestPayload,
  sanitize,
  withFomoCaution,
};
