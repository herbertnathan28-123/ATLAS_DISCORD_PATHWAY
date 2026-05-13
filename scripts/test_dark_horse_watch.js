#!/usr/bin/env node
'use strict';
// scripts/test_dark_horse_watch.js
//
// QA harness for the Dark Horse WATCH cleanup (PR A):
//   - new payload shape (every section present, confirm/cancel carry
//     a price + timeframe when dataReliable=true)
//   - fallback shape when dataReliable=false
//   - banned-token sweep across both shapes
//   - per-symbol dedupe (identical_state, state-change repost,
//     6h hard floor)
//
// Pure unit test — no network, no scheduler, no Discord. Each
// scenario builds a synthetic enriched candidate, calls the payload
// builder and / or the dedupe decision function, then asserts.

const dh = require('../darkHorseEngine');

// ── locked banned-wording list per the Dark Horse rule ──────────
// `\btrigger\b` is on the broader CLAUDE.md user-surface ban list and
// MUST stay in this sweep. The DH digest builder used to leak it via
// "Promotion trigger:" / "Invalidation trigger:" row labels.
const BANNED = [
  /\bCorey(?:\s+Clone)?\b/,
  /\bSpidey\b/,
  /\bJane\b/,
  /\bconfirmation\s+path\b/i,
  /\btrade\s+alert\b/i,
  /\bconfirmed\s+structure\b(?!\s+(?:break\s+)?(?:above|below|at)\b)/i,
  /\btrigger\b/i,
  /\bauthori[sz]ed?\b/i,
  /\bpermitted\b/i,
  /\bblocked\b/i,
];

let passed = 0;
let failed = 0;
function ok(label, cond, ...rest) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`, ...rest);
  }
}
function bannedSweep(label, text) {
  for (const re of BANNED) {
    if (re.test(text)) {
      ok(`${label} — banned token ${re}`, false, '\n--- offending text ---\n' + text);
      return false;
    }
  }
  ok(`${label} — banned-token sweep clean`, true);
  return true;
}

// ── Synthetic candle generator ─────────────────────────────────
// Builds a 3-up / 1-deep-pullback rhythm so the pullback bar dips
// BELOW the prior bar's low — that's what creates a 3-bar fractal
// swing low. Net per 4-bar cycle is +2.0 (still bullish), so the
// chain of swing lows is monotonically higher → confirmed HL series.
function makeBullishHtf(n = 40, base = 100) {
  const candles = [];
  let p = base;
  const startTs = 1700000000;
  for (let i = 0; i < n; i++) {
    const phase = i % 4;
    let open = p, close;
    if (phase < 3) {
      close = p + 1.5;   // 3 up bars
    } else {
      close = p - 2.5;   // deep pullback dips below prior bar's low
    }
    const high = Math.max(open, close) + 0.3;
    const low  = Math.min(open, close) - 0.3;
    candles.push({ open, high, low, close, time: startTs + i * 86400 });
    p = close;
  }
  return candles;
}
// Mirror image for bearish: 3 down + 1 deep rally that prints a
// fractal swing high. Successive rally peaks are lower → LH chain.
function makeBearishHtf(n = 40, base = 100) {
  const candles = [];
  let p = base;
  const startTs = 1700000000;
  for (let i = 0; i < n; i++) {
    const phase = i % 4;
    let open = p, close;
    if (phase < 3) {
      close = p - 1.5;   // 3 down bars
    } else {
      close = p + 2.5;   // deep rally pokes above prior bar's high
    }
    const high = Math.max(open, close) + 0.3;
    const low  = Math.min(open, close) - 0.3;
    candles.push({ open, high, low, close, time: startTs + i * 86400 });
    p = close;
  }
  return candles;
}
function makeFlatHtf(n = 10) {
  // < 30 candles → enrichWatchCandidate returns dataReliable=false.
  const candles = [];
  for (let i = 0; i < n; i++) {
    candles.push({ open: 100, high: 100.5, low: 99.5, close: 100, time: 1700000000 + i * 86400 });
  }
  return candles;
}

// ============================================================
// T1: Full payload shape — dataReliable=true (bullish AMD)
// ============================================================
console.log('\n[T1] Full payload shape — bullish AMD, dataReliable=true');
{
  const htf = makeBullishHtf(40, 150);
  const ltf = makeBullishHtf(50, 150);
  const base = {
    symbol: 'AMD', score: 8, direction: 'Bullish',
    summary: 'Strong trend acceleration with sustained higher highs',
    reasons: ['HH/HL structure confirmed', 'Momentum expanding'],
    currentPrice: htf[htf.length - 1].close,
  };
  const enriched = dh.enrichWatchCandidate(base, htf, ltf);
  ok('dataReliable=true', enriched.dataReliable === true, enriched);
  ok('trendAgeCandles > 0', enriched.trendAgeCandles > 0);
  ok('lastSwingTimestamp present', enriched.lastSwingTimestamp != null);
  ok('confirmationLevel finite', Number.isFinite(enriched.confirmationLevel));
  ok('cancellationLevel finite', Number.isFinite(enriched.cancellationLevel));
  ok('trendPhase set', typeof enriched.trendPhase === 'string' && enriched.trendPhase.length > 0);
  ok('transitionRisk set', ['Low', 'Moderate', 'Rising'].includes(enriched.transitionRisk));

  const payload = dh.buildDHPayload(enriched, { now: Date.parse('2026-05-11T13:30:00Z') });
  const c = payload.content;
  ok('kind=watch', payload.kind === 'watch');
  ok('header "DARK HORSE WATCH — AMD"', /DARK HORSE WATCH\s+—\s+AMD/.test(c));
  ok('Status row present', /\*\*Status:\*\*\s+Watch candidate only/.test(c));
  ok('Move Quality row present', /\*\*Move Quality:\*\*/.test(c));
  ok('Confidence row present', /\*\*Confidence:\*\*\s+8\/10/.test(c));
  ok('Trend age section present', /\*\*Trend age:\*\*/.test(c));
  ok('Trend phase section present', /\*\*Trend phase:\*\*/.test(c));
  ok('Continuation window section present', /\*\*Expected continuation window:\*\*/.test(c));
  ok('Bearish-transition risk section present', /\*\*Bearish-transition risk:\*\*/.test(c));
  ok('Why it is flagged section present', /\*\*Why it is flagged:\*\*/.test(c));
  ok('Trader action section present', /\*\*Trader action:\*\*/.test(c));
  ok('What would confirm section present', /\*\*What would confirm the watch:\*\*/.test(c));
  ok('What cancels section present', /\*\*What cancels the watch:\*\*/.test(c));
  ok('Next review section present', /\*\*Next review:\*\*/.test(c));
  ok('Next review carries UTC + AWST', /\d{2}:\d{2}\s+UTC\s+\/\s+\d{2}:\d{2}\s+AWST/.test(c));
  bannedSweep('T1 payload', c);
}

// ============================================================
// T2: Confirm + cancel carry price + timeframe
// ============================================================
console.log('\n[T2] Confirm + cancel carry explicit price + timeframe');
{
  const htf = makeBullishHtf(40, 180);
  const ltf = makeBullishHtf(50, 180);
  const enriched = dh.enrichWatchCandidate(
    { symbol: 'NVDA', score: 9, direction: 'Bullish', summary: 'x', reasons: [] },
    htf, ltf
  );
  const payload = dh.buildDHPayload(enriched);
  const c = payload.content;
  // Match "A full candle body close above <number> on 1D"
  ok('confirm line carries price + 1D timeframe',
     /full candle body close above \d+(?:\.\d+)?\s+on\s+1D/i.test(c), c);
  ok('cancel line carries price + 1D timeframe',
     /full candle body close below \d+(?:\.\d+)?\s+on\s+1D/i.test(c), c);
}

// ============================================================
// T3: Fallback shape when dataReliable=false
// ============================================================
console.log('\n[T3] Fallback payload — dataReliable=false');
{
  const htf = makeFlatHtf(10); // too short → dataReliable=false
  const enriched = dh.enrichWatchCandidate(
    { symbol: 'TSLA', score: 8, direction: 'Bullish', summary: 'x', reasons: [] },
    htf, []
  );
  ok('dataReliable=false', enriched.dataReliable === false, enriched);

  const payload = dh.buildDHPayload(enriched);
  const c = payload.content;
  ok('kind=watch_fallback', payload.kind === 'watch_fallback');
  ok('contains "Trend duration not reliable enough"',
     /Trend duration not reliable enough to publish yet/.test(c));
  ok('contains "No reliable confirmation level"',
     /No reliable confirmation level is available yet/.test(c));
  ok('still has Why flagged + Trader action',
     /\*\*Why it is flagged:\*\*/.test(c) && /\*\*Trader action:\*\*/.test(c));
  ok('still has Next review with UTC + AWST',
     /\d{2}:\d{2}\s+UTC\s+\/\s+\d{2}:\d{2}\s+AWST/.test(c));
  ok('fallback does NOT contain "Trend age:"', !/\*\*Trend age:\*\*/.test(c));
  ok('fallback does NOT contain "What would confirm"', !/\*\*What would confirm/.test(c));
  bannedSweep('T3 fallback', c);
}

// ============================================================
// T4: Bearish candidate — payload structure mirrors bullish
// ============================================================
console.log('\n[T4] Bearish candidate — payload + banned sweep');
{
  const htf = makeBearishHtf(40, 200);
  const ltf = makeBearishHtf(50, 200);
  const enriched = dh.enrichWatchCandidate(
    { symbol: 'XAUUSD', score: 8, direction: 'Bearish', summary: 'x', reasons: [] },
    htf, ltf
  );
  ok('bearish dataReliable=true', enriched.dataReliable === true, enriched);

  const payload = dh.buildDHPayload(enriched);
  const c = payload.content;
  // Bearish risk section flips to "Bullish-transition risk:"
  ok('Bullish-transition risk header present',
     /\*\*Bullish-transition risk:\*\*/.test(c), c);
  // confirm line uses "close below" (continuation in bearish direction)
  ok('confirm line uses "close below <price> on 1D"',
     /close below \d+(?:\.\d+)?\s+on\s+1D/i.test(c), c);
  // cancel line uses "close above" (cancellation of bearish thesis)
  ok('cancel line uses "close above <price> on 1D"',
     /close above \d+(?:\.\d+)?\s+on\s+1D/i.test(c), c);
  bannedSweep('T4 bearish payload', c);
}

// ============================================================
// T5: Dedupe — identical state suppressed
// ============================================================
console.log('\n[T5] Dedupe — identical state suppression');
{
  dh.__resetWatchEchoForTests();
  const state = new Map();
  const candidate = {
    symbol: 'AMD', score: 8, direction: 'Bullish',
    trendPhase: 'Mid-trend continuation', transitionRisk: 'Moderate',
    confirmationLevel: 184.20,
  };
  const t0 = 1_000_000_000_000;
  // First post — allowed.
  const d1 = dh.evaluateWatchPostDecision(candidate, state, { now: t0 });
  ok('first post allowed', d1.post === true, d1);
  ok('first reason=new_or_state_change', d1.reason === 'new_or_state_change');
  state.set('AMD', { stateHash: d1.stateHash, postedAt: t0 });
  // Second post inside hard-floor with identical state — must skip.
  const d2 = dh.evaluateWatchPostDecision(candidate, state, { now: t0 + 30 * 60 * 1000 });
  ok('second post inside hard-floor suppressed', d2.post === false);
  ok('skip reason is cooldown_hard_floor or identical_state',
     d2.reason === 'cooldown_hard_floor' || d2.reason === 'identical_state', d2);

  // With hardFloorMs=0 the identical_state branch is reachable.
  const d3 = dh.evaluateWatchPostDecision(candidate, state, {
    now: t0 + 30 * 60 * 1000, hardFloorMs: 0
  });
  ok('identical_state explicitly raised when hard floor is lifted',
     d3.post === false && d3.reason === 'identical_state', d3);
  ok('stateHash stable across calls', d1.stateHash === d3.stateHash);
}

// ============================================================
// T6: Real state change CAN repost (clock past hard floor)
// ============================================================
console.log('\n[T6] State change reposts after hard-floor window');
{
  const state = new Map();
  const t0 = 1_000_000_000_000;
  const a = {
    symbol: 'AMD', score: 8, direction: 'Bullish',
    trendPhase: 'Mid-trend continuation', transitionRisk: 'Moderate',
    confirmationLevel: 184.20,
  };
  const d1 = dh.evaluateWatchPostDecision(a, state, { now: t0 });
  state.set('AMD', { stateHash: d1.stateHash, postedAt: t0 });

  // Same candidate state, 7h later (past 6h hard floor) → identical
  // state but window elapsed: still suppressed because state matches
  // and minInterval has NOT elapsed (we keep min=6h, hard=6h → both
  // elapsed at 7h, so it would actually re-post). Verify:
  const d2 = dh.evaluateWatchPostDecision(a, state, { now: t0 + 7 * 60 * 60 * 1000 });
  ok('identical state past both windows re-posts', d2.post === true, d2);

  // Now alter the trend phase — state change inside the window
  // should be allowed only if the window has elapsed. Verify state
  // change past hard floor re-posts.
  const b = Object.assign({}, a, { trendPhase: 'Mature trend', transitionRisk: 'Rising' });
  const d3 = dh.evaluateWatchPostDecision(b, state, { now: t0 + 7 * 60 * 60 * 1000 });
  ok('state change past hard floor re-posts', d3.post === true, d3);
  ok('new stateHash differs from prior',
     d3.stateHash !== d1.stateHash, { d1: d1.stateHash, d3: d3.stateHash });
}

// ============================================================
// T7: Hard 6h floor enforced — state change inside 6h still skips
// ============================================================
console.log('\n[T7] Hard 6h floor enforced — state change inside window');
{
  const state = new Map();
  const t0 = 1_000_000_000_000;
  const a = {
    symbol: 'AMD', score: 8, direction: 'Bullish',
    trendPhase: 'Mid-trend continuation', transitionRisk: 'Moderate',
    confirmationLevel: 184.20,
  };
  const d1 = dh.evaluateWatchPostDecision(a, state, { now: t0 });
  state.set('AMD', { stateHash: d1.stateHash, postedAt: t0 });

  // Genuine state change at 5h (inside 6h hard floor).
  const b = Object.assign({}, a, { trendPhase: 'Late-stage / exhaustion risk building', transitionRisk: 'Rising' });
  const d2 = dh.evaluateWatchPostDecision(b, state, { now: t0 + 5 * 60 * 60 * 1000 });
  ok('state change inside 6h is suppressed', d2.post === false, d2);
  ok('skip reason=cooldown_hard_floor', d2.reason === 'cooldown_hard_floor', d2);
  ok('nextEligibleAt = t0 + 6h',
     d2.nextEligibleAt === t0 + 6 * 60 * 60 * 1000, d2);

  // Same state change at 6h + 1ms — must repost (floor cleared).
  const d3 = dh.evaluateWatchPostDecision(b, state, { now: t0 + 6 * 60 * 60 * 1000 + 1 });
  ok('state change just past 6h posts', d3.post === true, d3);
}

// ============================================================
// T8: Stale-entry prune
// ============================================================
console.log('\n[T8] Watch-echo prune drops entries older than TTL');
{
  const state = new Map();
  const tNow = Date.now();
  state.set('OLD', { stateHash: 'x', postedAt: tNow - (dh.DH_WATCH_ECHO_TTL_MS + 1000) });
  state.set('NEW', { stateHash: 'y', postedAt: tNow });
  const removed = dh.pruneWatchEcho(state, tNow);
  ok('one stale entry removed', removed === 1, removed);
  ok('OLD pruned', !state.has('OLD'));
  ok('NEW retained', state.has('NEW'));
}

// ============================================================
// T9: Banned-token sweep across BOTH payload shapes plus the
// FOMO sanitiser (defence in depth — even if a template drifts
// and includes a banned token, the sanitiser strips it).
// ============================================================
console.log('\n[T9] FOMO sanitiser strips banned tokens injected into a payload');
{
  const fomo = require('../darkHorseFomoControl');
  const dirty = { content: 'Wait for confirmed structure. Full ATLAS confirmation path remains: Corey → Spidey → Jane. This is not a trade alert.' };
  const cleaned = fomo.sanitize(dirty);
  ok('replaced=true', cleaned.replaced === true);
  ok('Corey stripped', !/\bCorey\b/.test(cleaned.content));
  ok('Spidey stripped', !/\bSpidey\b/.test(cleaned.content));
  ok('Jane stripped', !/\bJane\b/.test(cleaned.content));
  ok('confirmation path stripped', !/\bconfirmation\s+path\b/i.test(cleaned.content));
  ok('trade alert stripped', !/\btrade\s+alert\b/i.test(cleaned.content));
  ok('bare confirmed structure stripped',
     !/\bconfirmed\s+structure\b(?!\s+(?:break\s+)?(?:above|below|at)\b)/i.test(cleaned.content));
  // A level-aware "confirmed structure break above X" must survive.
  const allowed = fomo.sanitize({ content: 'Look for a confirmed structure break above 184.20 on 1D.' });
  ok('"confirmed structure break above N" preserved',
     !allowed.replaced && /confirmed structure break above 184\.20/.test(allowed.content), allowed);
}

// ============================================================
// T10: Movement digest v1.1 reproduction — banned-token sweep
// (incl. \btrigger\b), label rename, level-availability rule,
// single-tail advisory.
// ============================================================
console.log('\n[T10] Movement digest v1.1 — label rename + tail consolidation');
{
  const rank = require('../darkHorseRanking');
  const fomo = require('../darkHorseFomoControl');

  const candidates = [
    { symbol: 'AMD',    score: 5, direction: 'Bullish',
      summary: 'Strong bullish structure with HH/HL sequence confirmed',
      reasons: ['HH/HL structure confirmed (60% bullish bars)'] },
    { symbol: 'GOOGL',  score: 5, direction: 'Bullish',
      summary: 'Strong bullish structure with HH/HL sequence confirmed',
      reasons: ['HH/HL structure confirmed (60% bullish bars)'] },
    { symbol: 'XAGUSD', score: 5, direction: 'Bullish',
      summary: 'Strong trend acceleration with sustained higher highs',
      reasons: ['Strong trend acceleration with sustained higher highs'] },
  ];
  function bullCandles(n, base) {
    const out = []; let p = base;
    for (let i = 0; i < n; i++) {
      const open = p, close = p + 1.0;
      out.push({ open, high: close + 0.2, low: open - 0.2, close, time: 1700000000 + i * 86400 });
      p = close;
    }
    return out;
  }
  const candles = { AMD: bullCandles(20, 180), GOOGL: bullCandles(20, 150), XAGUSD: bullCandles(20, 35) };

  (async () => {
    const ranking = await rank.buildRanking(candidates, async sym => candles[sym] || null, {
      topN: 10, sectionCap: 2, sectionCapMax: 3, watchThreshold: 8,
    });
    const payload = fomo.sanitize(rank.buildRankedMovementDigestPayload(ranking, {
      level: 'elevated', vixLevel: 'Elevated', watchCount: 0, internalCount: 3,
      avgInternalScore: 5.0, reason: '3 internal candidates',
    }));
    const c = payload.content;

    bannedSweep('T10 v1.1 digest', c);

    // FOH layout (operator directive 2026-05-13) — the legacy
    // "Promotion criteria:" / "Invalidation condition:" per-card
    // rows are retired. FOH cards expose the same intent under the
    // 🟢/🟡/🟠/🔴 zone cues + "What ATLAS needs next" block. The
    // protective negative checks (no legacy "Promotion trigger:" /
    // "Invalidation trigger:" leakage) stay in place.
    ok('FOH invalidation cue (🔴 _Invalidation:_) appears on every top-3 card',
       (c.match(/🔴 _Invalidation:_/g) || []).length >= 3,
       { count: (c.match(/🔴 _Invalidation:_/g) || []).length });
    ok('FOH "What ATLAS needs next:" block appears on every top-3 card',
       (c.match(/_What ATLAS needs next:_/g) || []).length >= 3,
       { count: (c.match(/_What ATLAS needs next:_/g) || []).length });
    ok('legacy row label "Promotion trigger:" REMOVED',
       !/\bPromotion trigger:/.test(c));
    ok('legacy row label "Invalidation trigger:" REMOVED',
       !/\bInvalidation trigger:/.test(c));
    ok('legacy row label "Promotion criteria:" NOT emitted under FOH',
       !/\bPromotion criteria:\s/.test(c));
    ok('legacy row label "Invalidation condition:" NOT emitted under FOH',
       !/\bInvalidation condition:/.test(c));

    const refCount  = (c.match(/Reference level not published in this digest yet\./g) || []).length;
    const lvlCount  = (c.match(/Invalidation level:/g) || []).length;
    // Operator directive 2026-05-12 — the "Reference level not
    // published in this digest yet." sub-row is now SUPPRESSED.
    // The Chart evidence block above already publishes a
    // price-stamped invalidation level (or an honest pending
    // note), so the duplicate placeholder is dropped from the
    // user-facing surface.
    ok('Reference level not published — SUPPRESSED per education-layer doctrine',
       refCount === 0, { refCount });
    ok('Invalidation level: NOT used when no numeric price in source',
       lvlCount === 0, { lvlCount });

    // No doubled tail: the digest must end with a single advisory
    // line. The old FOMO_CAUTION trailer must not be appended.
    ok('digest does NOT contain the old FOMO_CAUTION trailer',
       !c.includes(fomo.FOMO_CAUTION),
       'FOMO_CAUTION found at digest tail');
    // Operator directive 2026-05-12 — footer rewritten to ask the
    // reader to reassess at the next review window rather than the
    // older "wait … before acting" wording.
    // FOH closing tail (operator directive 2026-05-13): replaces
    // the legacy "Conditions are moving … Reassess at next review"
    // line with the advisory FOH closing sentence + the explicit
    // "⚠️ Advisory only" footer.
    ok('FOH advisory tail present',
       /ATLAS remains in monitoring mode/.test(c)
       && /⚠️ Advisory only/.test(c), c);

    // Numeric-level branch: feed a synthetic invalidation text that
    // includes a price. The renderer must switch to "Invalidation level:"
    // and OMIT the "Reference level not published" helper.
    const withLevel = rank.buildExpandedDetail({
      symbol: 'TEST', section: 'equities', sectionLabel: 'Major Equities / Momentum',
      safeHavenOverlay: false, direction: 'Bullish', score: 8,
      scoreBreakdown: ['mock'], moveStrength: 8, moveSpeed: 1.4, moveAge: 4,
      movePhase: 'mid', relativeStrength: 1.2,
      structureState: 'ok', confirmationRequirement: 'mock',
      promotionTrigger: 'mock', invalidationTrigger: 'Close below 178.40 on 1D voids the setup.',
      continuationWindow: 'mock', lateEntryRisk: 'low',
      whyFlagged: 'mock', macroEventLink: 'mock',
      whyNotWatch: 'mock', atlasState: 'mock',
    }, 0);
    ok('numeric-bearing invalidation switches to "Invalidation level:"',
       /Invalidation level:\s+Close below 178\.40/.test(withLevel), withLevel);
    ok('numeric-bearing invalidation OMITS "Reference level not published"',
       !/Reference level not published/.test(withLevel));

    // Sweep rendered prose for any rogue "trigger" word leftover.
    ok('no bare "trigger" anywhere in digest text',
       !/\btrigger\b/i.test(c), c);

    // QA-closure additions (2026-05-12) — make the two checklist items
    // previously verified by manual rendered-body inspection enforceable
    // by the harness itself. Both assertions run against the rendered
    // digest body `c`, NOT against internal log keys.

    // 1. No bare VIX / DXY. Allowed only when wrapped as the locked
    //    expanded form, e.g. "market fear / volatility gauge (VIX)" or
    //    "(DXY)" inside the parenthesised abbreviation slot. Any other
    //    occurrence is a bare-abbreviation leak.
    function bareAbbrevHits(text, abbrev) {
      const re = new RegExp('\\b' + abbrev + '\\b', 'g');
      const hits = [];
      let m;
      while ((m = re.exec(text)) !== null) {
        const before = text.charAt(m.index - 1);
        const after  = text.charAt(m.index + abbrev.length);
        // Allowed iff "<...>(<ABBR>)" — i.e. immediately wrapped in parens.
        if (before === '(' && after === ')') continue;
        const ctx = text.slice(Math.max(0, m.index - 35), m.index + abbrev.length + 35).replace(/\s+/g, ' ').trim();
        hits.push({ abbrev, context: ctx });
      }
      return hits;
    }
    const vixBareHits = bareAbbrevHits(c, 'VIX');
    const dxyBareHits = bareAbbrevHits(c, 'DXY');
    ok('no bare VIX in digest body (must be wrapped, e.g. "… (VIX)")',
       vixBareHits.length === 0,
       vixBareHits.map(h => '"' + h.abbrev + '" near …' + h.context + '…').join(' | '));
    ok('no bare DXY in digest body (must be wrapped, e.g. "… (DXY)")',
       dxyBareHits.length === 0,
       dxyBareHits.map(h => '"' + h.abbrev + '" near …' + h.context + '…').join(' | '));

    // 2. No vague "wait for structure" wording. The advisory tail must
    //    reference the per-candidate confirmation criteria (timeframe +
    //    level) explicitly, never an undefined "wait for structure".
    ok('no vague "wait for structure" wording in digest body',
       !/\bwait for structure\b/i.test(c), c);

    console.log(`\n==========================`);
    console.log(`Passed: ${passed}   Failed: ${failed}`);
    if (failed > 0) process.exit(1);
    console.log('[DH-WATCH-QA] PASS — Dark Horse cleanup acceptance suite green.');
  })();
}
