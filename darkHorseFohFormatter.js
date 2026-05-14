'use strict';

// ============================================================
// DARK HORSE — FOH LIVE FORMATTER (v1.3 · operator surface)
//
// Operator directive 2026-05-13. Pure layout / assembly module.
// All user-facing narration is produced by
// darkHorseFohSemanticTranslator — this file never pastes raw
// engine fields directly into Discord.
//
// v1.3 changes (vs v1.2):
//   - Premium banner ("ATLAS · DARK HORSE — FOH OPERATOR
//     SURFACE") replaces the legacy "GLOBAL MOVER RADAR" feel
//     on the body. (The chunker's per-Part transport label
//     stays unchanged for backward compatibility.)
//   - Compact OPERATOR PANEL tag block immediately under the
//     banner so first-glance readability is < 2 seconds.
//   - 🔴 CURRENT LIVE READ separator near the top.
//   - Atmosphere block with substructure (pressure building /
//     why not promoting / trader mistake avoided / state
//     change conditions).
//   - 🟦 EXPANDED TERMINOLOGY row (renamed from Learning Links).
//   - Section radar with status tags (HEALTHY / BUILDING /
//     CAUTION / DANGER / CONTEXT) and upgrade/downgrade lines.
//   - Banner-separated candidate cards with the FOH 7 questions
//     visually distinct (status badge, path conditions,
//     forward read, replay reference).
//   - Avoided-risk attribution as a dedicated section.
//   - Universe coverage redesigned as a compact tag panel.
//   - Closing block with upgrade / downgrade pair.
//
// Strict scope (locked):
//   - Layout / assembly only. No change to Corey, Jane,
//     Spidey, Macro, ranking maths, scoring, thresholds,
//     scheduler cadence, webhook transport, cooldown, the
//     symbol universe, or candidate selection.
// ============================================================

function _rank() { return require('./darkHorseRanking'); }
function _foh()  { return require('./darkHorseFohSemanticTranslator'); }

// ── Timestamp helpers ────────────────────────────────────────
function _pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtUtcStamp(ms) {
  const d = new Date(ms);
  return (
    d.getUTCFullYear() + '-' + _pad2(d.getUTCMonth() + 1) + '-' + _pad2(d.getUTCDate())
    + ' ' + _pad2(d.getUTCHours()) + ':' + _pad2(d.getUTCMinutes()) + ' UTC'
  );
}
function fmtAwstStamp(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return (
    d.getUTCFullYear() + '-' + _pad2(d.getUTCMonth() + 1) + '-' + _pad2(d.getUTCDate())
    + ' ' + _pad2(d.getUTCHours()) + ':' + _pad2(d.getUTCMinutes()) + ' AWST'
  );
}

// ── Discord-safe separators ──────────────────────────────────
const HR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
const SUB = '━━━━━━━━━━';
function buildNewSeparator(label) {
  const safeLabel = label || 'CURRENT LIVE READ';
  return SUB + ' 🔴 ' + safeLabel + ' ' + SUB;
}
function buildSectionSeparator(label, glyph) {
  return SUB + ' ' + (glyph || '📡') + ' ' + label + ' ' + SUB;
}
function buildCardBanner(symbol, arrow, score, sectionLabel, isStandout) {
  const star = isStandout ? '⭐ ' : '';
  return '━━━━━━━━ ' + star + symbol + ' ' + arrow + ' · ' + score + '/10 · ' + (sectionLabel || 'Section pending') + ' ━━━━━━━━';
}

// ── Section status tag (HEALTHY / BUILDING / CAUTION / etc.) ─
function sectionStatusTag(avg, rows) {
  if (!rows || rows.length === 0) return { glyph: '⚪', tag: 'QUIET' };
  // Danger = at least one exhaustion-phase candidate in the section.
  for (const r of rows) {
    const ph = String(r && r.movePhase || '').toLowerCase();
    if (ph === 'exhaustion') return { glyph: '🔴', tag: 'DANGER' };
  }
  if (avg >= 8)    return { glyph: '🟢', tag: 'HEALTHY' };
  if (avg >= 6.5)  return { glyph: '🟡', tag: 'BUILDING' };
  if (avg >= 5)    return { glyph: '🟠', tag: 'CAUTION' };
  return { glyph: '🔵', tag: 'CONTEXT' };
}
function cardStatusTag(record) {
  const ph = String(record && record.movePhase || '').toLowerCase();
  const score = Number.isFinite(record && record.score) ? record.score : 0;
  if (ph === 'exhaustion') return { glyph: '🔴', tag: 'DANGER · stretched move' };
  if (ph === 'late')       return { glyph: '🟠', tag: 'CAUTION · late-stage move' };
  if (score >= 8)          return { glyph: '🟢', tag: 'HEALTHY · publication-grade attention' };
  if (score >= 6)          return { glyph: '🟡', tag: 'BUILDING · pressure visible' };
  return                     { glyph: '🔵', tag: 'CONTEXT · informational only' };
}

// ============================================================
// Visual primitives (v1.4 polish — A–G)
// Layout-only helpers. No engine fields read directly; price
// text comes from r.evidenceAnchors (already produced by the
// ranking pipeline and surfaced through the translator).
// ============================================================

// A. Market Mood disc scale — five discs + label, anchored to
//    ctx.volatility.level. Used in the atmosphere banner.
const _MOOD_DISC = {
  quiet:    { discs: '🟢🟢🟢⚪⚪', label: 'CALM' },
  elevated: { discs: '🟡🟡🟡🟡⚪', label: 'ACTIVE' },
  extreme:  { discs: '🔴🔴🔴🔴🔴', label: 'STORM' },
  pending:  { discs: '⚪⚪⚪⚪⚪', label: 'READING PENDING' },
};
function buildMarketMoodScale(volatility) {
  const lvl = String((volatility && volatility.level) || 'pending').toLowerCase();
  const mood = _MOOD_DISC[lvl] || _MOOD_DISC.pending;
  return mood.discs + ' · **' + mood.label + '**';
}

// B. Lifecycle badge — single-glyph phase-of-move identity.
//    Sits at the top of every candidate card so the reader sees
//    where in the move's lifecycle the candidate is before any
//    narration lands.
function buildLifecycleBadge(movePhase) {
  switch (String(movePhase || '').toLowerCase()) {
    case 'early':       return '🌱 **EARLY** · move just forming';
    case 'mid':         return '🌿 **MID** · move established and carrying weight';
    case 'late':        return '🍂 **LATE** · move stretched, room thinning';
    case 'exhaustion':  return '💀 **EXHAUSTION** · move running out of fuel';
    default:            return '⚪ **UNCLASSIFIED** · phase reading still developing';
  }
}

// C. What-this-means wrapper — bolds a short label, then appends
//    an operator translation in one consistent sentence form so
//    every metric earns its space on the card. Optional glyph
//    preserves the visual identity of the row.
function buildWhatThisMeans(label, plain, glyph) {
  const prefix = glyph ? glyph + ' ' : '';
  return prefix + '**' + label + '** — what this means: ' + plain;
}

// D. Long / Short plain-English explanation — the read translated
//    into "who is in control" so the operator never has to map
//    direction to behaviour themselves.
function buildLongShortExplanation(direction) {
  const d = String(direction || '').toLowerCase();
  if (d === 'bullish') {
    return '**Long bias (↑)** — ATLAS reads the path of least resistance as UP. Buyers are setting the rhythm; sellers are reactive. The constructive read is to stay with the move while structure agrees, not to chase the most stretched bars.';
  }
  if (d === 'bearish') {
    return '**Short bias (↓)** — ATLAS reads the path of least resistance as DOWN. Sellers are setting the rhythm; buyers are reactive. The constructive read is to stay with the move while structure agrees, not to chase the most stretched bars.';
  }
  return '**No directional bias (→)** — ATLAS reads no committed leadership. Neither buyers nor sellers are setting the rhythm. The candidate is context, not a basis for participation.';
}

// E. Exact price-zone block — turns r.evidenceAnchors into a
//    four-band visual map (healthy / caution / danger / invalid)
//    with literal price text inline. Falls back to descriptive
//    placeholders when the anchors haven't landed yet.
function buildPriceZoneBlock(record) {
  const ev  = (record && record.evidenceAnchors) || null;
  const dir = String((record && record.direction) || '').toLowerCase();
  const hi  = ev && ev.recentHigh && ev.recentHigh.priceText;
  const lo  = ev && ev.recentLow  && ev.recentLow.priceText;
  const inv = ev && ev.invalidation && ev.invalidation.priceText;
  const hiTxt  = hi  || 'recent high (pending wiring)';
  const loTxt  = lo  || 'recent low (pending wiring)';
  const invTxt = inv || 'the structural invalidation level (pending wiring)';
  const lines = ['📍 **PRICE ZONES (live read)**'];
  if (dir === 'bullish') {
    lines.push('├─ 🟢 **HEALTHY** · holding above ' + hiTxt);
    lines.push('├─ 🟡 **CAUTION** · drifting back into the ' + loTxt + ' – ' + hiTxt + ' chop band');
    lines.push('├─ 🟠 **DANGER**  · slipping below ' + loTxt);
    lines.push('└─ ❌ **INVALID**  · full 1D close back through ' + invTxt);
  } else if (dir === 'bearish') {
    lines.push('├─ 🟢 **HEALTHY** · holding below ' + loTxt);
    lines.push('├─ 🟡 **CAUTION** · drifting back into the ' + loTxt + ' – ' + hiTxt + ' chop band');
    lines.push('├─ 🟠 **DANGER**  · lifting above ' + hiTxt);
    lines.push('└─ ❌ **INVALID**  · full 1D close back through ' + invTxt);
  } else {
    lines.push('├─ 🟢 **HEALTHY** · acceptance forming inside ' + loTxt + ' – ' + hiTxt);
    lines.push('├─ 🟡 **CAUTION** · range repeatedly tested without commitment');
    lines.push('├─ 🟠 **DANGER**  · expansion in either direction without structure agreement');
    lines.push('└─ ❌ **INVALID**  · price leaves the range and immediately reverses through ' + invTxt);
  }
  return lines.join('\n');
}

// F. How-a-trader-acts block — translates the price-zone map
//    into behavioural responses anchored to literal reference
//    area and invalidation prices when available. v2.0 sharpens
//    this with explicit price anchors so no actionable phrase
//    is left unexplained.
function buildHowTraderActsBlock(record) {
  const dir = String((record && record.direction) || '').toLowerCase();
  const ph  = String((record && record.movePhase) || '').toLowerCase();
  const ev  = (record && record.evidenceAnchors) || null;
  const refLevel = ev ? (dir === 'bearish' ? ev.recentLow : ev.recentHigh) : null;
  const refPrice = (refLevel && refLevel.priceText) || 'the reference area (pending wiring)';
  const inv = ev && ev.invalidation;
  const invPrice = (inv && inv.priceText) || 'the invalidation level (pending wiring)';
  const sideWord = dir === 'bullish' ? 'with buyers' : dir === 'bearish' ? 'with sellers' : 'with whichever side leads';
  const stretched = ph === 'late' || ph === 'exhaustion';
  const tail = stretched
    ? ' *(Phase is already ' + ph + ' — late-stage reversal risk is elevated; smaller hands and tighter rules win here.)*'
    : '';
  return [
    '🎯 **HOW A TRADER ACTS ON THIS** *(advisory only)*',
    '• **Reference area** → ' + refPrice + '. This is the level the read pivots on; ATLAS treats it as the structural anchor.',
    '• **Invalidation** → ' + invPrice + '. A full 1D close through this level means the read is no longer valid; the path resets.',
    '• **If price holds the healthy zone** → keep monitoring ' + sideWord + '; do not add risk into already-stretched bars.',
    '• **If price drifts into the caution band** → step back and wait for the next clean acceptance instead of chasing.',
    '• **If price slides into the danger zone** → the read has changed; standing aside costs nothing here.',
    '• **If invalidation prints** → the setup is dead, reset to zero, do not average into the failure.' + tail,
  ].join('\n');
}

// G. Risk-off / invalidation explanation — explicit "when does
//    this read die, and what does that mean."
function buildInvalidationExplanation(record) {
  const ev  = (record && record.evidenceAnchors) || null;
  const inv = ev && ev.invalidation && ev.invalidation.priceText;
  const dir = String((record && record.direction) || '').toLowerCase();
  const side  = dir === 'bullish' ? 'below' : dir === 'bearish' ? 'above' : 'through';
  const what  = dir === 'bullish'
    ? 'the breakout area failed to hold'
    : dir === 'bearish'
      ? 'the breakdown area failed to hold'
      : 'the range boundary failed to hold';
  const level = inv || 'the invalidation level (pending wiring)';
  return '**Risk-off explanation** — this read dies if price closes ' + side + ' ' + level
    + ' on the 1D timeframe. That close means ' + what + ', the path resets to neutral, and any continuation thesis built on top of it is no longer valid until structure reforms.';
}

// Panel framer — wraps a titled sub-block in the sub-rule so
// related primitives read as a single panel rather than a list.
function buildPanelFramer(title, lines) {
  return [SUB + ' ' + title + ' ' + SUB, '', lines.join('\n')].join('\n');
}

// ============================================================
// V2.0 — OPERATOR PSYCHOLOGY + VISUAL HIERARCHY (additive)
//
// All v2.0 helpers are presentation-only and read engine state
// through fields the translator already produces (direction,
// movePhase, score, evidenceAnchors.{recentHigh,recentLow,
// invalidation}.priceText, sectionLabel). No new engine fields
// invented; no translator/ranking edits required.
// ============================================================

// ── Lifecycle profile (central lookup) ────────────────────────
// Maps the engine's r.movePhase into the v2.0 four-stage
// taxonomy that drives wording, warning glyphs, and execution
// posture across the whole card.
function _lifecycleProfile(movePhase) {
  switch (String(movePhase || '').toLowerCase()) {
    case 'early':
      return {
        stage: 1, label: 'FRESH EXPANSION', tone: 'EXPANDABLE',
        warning: '🟢', glyph: '🌱',
        cue: 'fresh expansion — room to develop, no need to chase',
        executionPosture: 'Stage 1 = fresh expansion; monitor for the first clean acceptance, do not force entry.',
      };
    case 'mid':
      return {
        stage: 2, label: 'DEVELOPING CONTINUATION', tone: 'CONTROLLED',
        warning: '🟡', glyph: '🌿',
        cue: 'developing continuation — structure intact, controlled rhythm',
        executionPosture: 'Stage 2 = developing; normal monitoring posture, no need to chase late entries.',
      };
    case 'late':
      return {
        stage: 3, label: 'EXTENDED WATCH', tone: 'CAUTION',
        warning: '🟠', glyph: '🍂',
        cue: 'extended watch — late-entry quality reduced, reaction risk rising',
        executionPosture: 'Stage 3 = late; entry quality reduced, smaller size / stricter rules / no chasing.',
      };
    case 'exhaustion':
      return {
        stage: 4, label: 'EXHAUSTION RISK', tone: 'DANGER',
        warning: '🔴', glyph: '💀',
        cue: 'exhaustion risk — reversal-prone, promotion withheld',
        executionPosture: 'Stage 4 = exhaustion; reversal-prone, standing aside costs nothing here.',
      };
    default:
      return {
        stage: 0, label: 'UNCLASSIFIED', tone: 'UNDETERMINED',
        warning: '⚪', glyph: '⚪',
        cue: 'phase reading still developing',
        executionPosture: 'Stage unclassified; informational only.',
      };
  }
}

// ── Mood profile (central lookup) ─────────────────────────────
// Maps ctx.volatility.level into a single tonal profile so the
// scan-board header and the action-state line stay aligned.
function _moodProfile(volatility) {
  switch (String((volatility && volatility.level) || 'pending').toLowerCase()) {
    case 'quiet':
      return { glyph: '🔵', label: 'CALM',     toneCue: 'restrained — thinner liquidity, conviction low, fewer warnings' };
    case 'elevated':
      return { glyph: '🟡', label: 'ACTIVE',   toneCue: 'caution-elevated — structure unsettled, ranges expanding' };
    case 'extreme':
      return { glyph: '🔴', label: 'STORM',    toneCue: 'danger-dominant — late-entry warnings prominent, smaller hands win' };
    default:
      return { glyph: '⚪', label: 'READING PENDING', toneCue: 'undetermined — regime unclassified this cycle' };
  }
}

// ── 1. Tactical scan separator (cinematic card divider) ──────
// Replaces the previous flat card banner. Carries scan position,
// lifecycle tone, and the standout marker so the eye can rank
// cards before any narration is read.
function buildTacticalSeparator(idx, total, record, isStandout) {
  const num  = String(((idx | 0) + 1)).padStart(2, '0');
  const tot  = String(((total | 0) || ((idx | 0) + 1))).padStart(2, '0');
  const life = _lifecycleProfile(record && record.movePhase);
  const standoutTag = isStandout ? ' · ⭐ STANDOUT' : '';
  return '━━━━━━━━ ' + life.warning + ' SCAN ' + num + ' / ' + tot
    + ' · ' + life.label + ' · ' + life.tone + standoutTag + ' ━━━━━━━━';
}

// ── 2. Card identity header (symbol + direction + lifecycle) ─
function buildCardIdentityHeader(record, isStandout) {
  const foh = _foh();
  const arrow = foh.arrowFor(record && record.direction);
  const score = Number.isFinite(record && record.score) ? record.score.toFixed(1) : '?';
  const sym   = (record && record.symbol) || '???';
  const star  = isStandout ? '⭐ ' : '';
  const life  = _lifecycleProfile(record && record.movePhase);
  return '## ' + star + sym + ' ' + arrow + ' · ' + life.glyph + ' Stage ' + life.stage + ' · ' + life.label + ' · ' + score + '/10';
}

// ── 3. One-line immediate read ───────────────────────────────
function buildImmediateRead(record) {
  const dir = String((record && record.direction) || '').toLowerCase();
  const sec = (record && record.sectionLabel) || 'this section';
  const sym = (record && record.symbol) || 'the candidate';
  const life = _lifecycleProfile(record && record.movePhase);
  const lead = dir === 'bullish'
    ? 'buyers still controlling'
    : dir === 'bearish'
      ? 'sellers still controlling'
      : 'no committed leadership';
  return '> _Immediate read:_ **' + sym + '** — ' + lead + ' in ' + sec + '; ' + life.cue + '.';
}

// ── 6. Authoritative conviction tag ──────────────────────────
// Label + score + traffic light + plain-English consequence.
// Drives the operator's sense of weight before they read detail.
function buildConvictionTag(score) {
  const s = Number.isFinite(score) ? score : 0;
  if (s >= 8.5) return '🟢 **Conviction:** ' + s.toFixed(1) + '/10 · High — publication-grade, monitor closely.';
  if (s >= 7)   return '🟡 **Conviction:** ' + s.toFixed(1) + '/10 · Medium-high — pressure visible, not yet confirmed.';
  if (s >= 5)   return '🟡 **Conviction:** ' + s.toFixed(1) + '/10 · Medium — enough to monitor, not enough to chase.';
  if (s >= 3)   return '🔵 **Conviction:** ' + s.toFixed(1) + '/10 · Low — context only.';
  return        '⚪ **Conviction:** ' + s.toFixed(1) + '/10 · Quiet — informational.';
}

// ── 4. Lifecycle / Conviction / Risk / Mood strip ────────────
// Single dominant strip that answers, in four lines:
//   - where in the lifecycle is the move?
//   - how much conviction does ATLAS carry?
//   - what is the operator-facing risk cue?
//   - what is the market mood doing to the read?
function buildLifecycleConvictionStrip(record, ctx) {
  const life = _lifecycleProfile(record && record.movePhase);
  const conviction = buildConvictionTag(record && record.score);
  const mood = _moodProfile(ctx && ctx.volatility);
  const riskCue = life.stage >= 4
    ? '🔴 **Risk cue:** late-stage reversal risk dominant — promotion withheld'
    : life.stage === 3
      ? '🟠 **Risk cue:** late-entry quality reduced — smaller size, stricter rules'
      : life.stage === 2
        ? '🟡 **Risk cue:** monitor for the next clean acceptance candle'
        : life.stage === 1
          ? '🟢 **Risk cue:** room to develop, no need to chase'
          : '⚪ **Risk cue:** reading still forming';
  return [
    life.warning + ' **Lifecycle:** Stage ' + life.stage + ' · ' + life.label,
    conviction,
    riskCue,
    mood.glyph + ' **Mood overlay:** ' + mood.label + ' — ' + mood.toneCue,
  ].join('\n');
}

// ── 5. Operator Action Map (centre of gravity of the card) ───
// Bias / Reference / Continuation / Failure / Risk / Monitor.
// Pulls reference-area and invalidation prices straight from
// r.evidenceAnchors when available; otherwise prints honest
// "pending wiring" fallback text — never blanks.
function buildOperatorActionMap(record) {
  const dir = String((record && record.direction) || '').toLowerCase();
  const ev  = (record && record.evidenceAnchors) || null;
  const refLevel = ev ? (dir === 'bearish' ? ev.recentLow : ev.recentHigh) : null;
  const refPrice = (refLevel && refLevel.priceText) || 'pending wiring';
  const inv = ev && ev.invalidation;
  const invPrice = (inv && inv.priceText) || 'pending wiring';
  const life = _lifecycleProfile(record && record.movePhase);

  let biasState;
  let continuation;
  let failure;
  if (dir === 'bullish') {
    biasState    = 'Long bias only while price holds above ' + refPrice + '.';
    continuation = 'Continuation improves only if price returns to ' + refPrice + ' and buyers prevent a deeper rejection.';
    failure      = 'A full 1D close back below ' + invPrice + ' cancels the long idea — price would have accepted under the prior reference area.';
  } else if (dir === 'bearish') {
    biasState    = 'Short bias only while price holds below ' + refPrice + '.';
    continuation = 'Continuation improves only if price revisits ' + refPrice + ' and sellers prevent a deeper reclaim.';
    failure      = 'A full 1D close back above ' + invPrice + ' cancels the short idea — price would have accepted over the prior reference area.';
  } else {
    biasState    = 'No directional bias — neither buyers nor sellers have accepted control.';
    continuation = 'A clean acceptance outside the current range, in either direction, would change the read.';
    failure      = 'A reversal back through ' + invPrice + ' resets the range read to neutral.';
  }

  const monitor = life.stage >= 3
    ? 'Watch for a clean rejection at the next reference area, or a reclaim back through the structural midpoint that would force a downgrade.'
    : 'Watch for the next acceptance candle and whether ' + (dir === 'bullish' ? 'buyers' : dir === 'bearish' ? 'sellers' : 'either side') + ' holds the reference area on its first revisit.';

  return [
    '🎯 **OPERATOR ACTION MAP**',
    '├─ **Bias state**             · ' + biasState,
    '├─ **Reference area**         · ' + refPrice,
    '├─ **Continuation condition** · ' + continuation,
    '├─ **Failure condition**      · ' + failure,
    '├─ **Risk posture**           · ' + life.executionPosture,
    '└─ **What to monitor next**   · ' + monitor,
  ].join('\n');
}

// ── 9. Compressed metadata footer ────────────────────────────
// Pushes rank, horizon, section label, score, phase, and scan
// time into a single de-emphasized line so they no longer
// compete with the operator-action surface for attention.
function buildCompactMetadataFooter(record, idx, total, ctx) {
  const sec   = (record && record.sectionLabel) || '—';
  const rank  = ((idx | 0) + 1);
  const tot   = ((total | 0) || rank);
  const score = Number.isFinite(record && record.score) ? record.score.toFixed(1) : '?';
  const ph    = String((record && record.movePhase) || '').toLowerCase() || 'unclassified';
  const stamp = fmtUtcStamp((ctx && ctx.nowMs) || Date.now());
  return '_·_ rank ' + rank + '/' + tot + ' _·_ ' + sec + ' _·_ ' + score + '/10 _·_ phase: ' + ph + ' _·_ scan ' + stamp;
}

// ── Scan-board header line — operator action state ───────────
// Surfaces the single most important question on the digest:
// should the operator act, watch, or stand back?
function buildOperatorActionState(ctx) {
  const top  = (ctx && ctx.top10Count) | 0;
  const atTh = (ctx && ctx.atThresholdCount) | 0;
  const mood = _moodProfile(ctx && ctx.volatility);
  if (atTh > 0) {
    return '🟢 **Operator action state:** ACT — ' + atTh + ' publication-grade candidate'
      + (atTh === 1 ? '' : 's') + ' present; monitor closely, no chasing into stretched bars.';
  }
  if (top > 0) {
    return '🟡 **Operator action state:** WATCH — developing standouts surfaced but not confirmed; wait for the next clean acceptance.';
  }
  if (mood.label === 'STORM') {
    return '🔴 **Operator action state:** STAND BACK — storm mood with no publication-grade setup; smaller hands and tighter rules win.';
  }
  return '⚪ **Operator action state:** MONITOR ONLY — no actionable setup this cycle, scan continues.';
}

// ── Premium banner + headline read ───────────────────────────
function buildAtmosphereBanner(ctx) {
  const foh = _foh();
  const { nowMs, volatility, top10Count, internalCount, ignoredCount, universeSize } = ctx;
  const lvl = (volatility && volatility.level) || 'reading pending';
  const bestArea = foh.operatorBestAreaTag(ctx);
  const scanCondition = top10Count === 0
    ? 'Monitoring only · publication threshold not met'
    : (top10Count + ' developing standout' + (top10Count === 1 ? '' : 's') + ' surfaced · none confirmed');
  const pubCondition = (ctx.atThresholdCount | 0) > 0
    ? (ctx.atThresholdCount + ' at publication-grade')
    : 'Not promoted this cycle';
  return [
    HR,
    '🐎 **ATLAS · DARK HORSE · FOH OPERATOR SURFACE**',
    '*v1.3 — operator edition*',
    HR,
    '',
    '📍 **Scan time:** ' + fmtUtcStamp(nowMs) + ' · ' + fmtAwstStamp(nowMs),
    '🌐 **Atmosphere:** ' + lvl,
    '🎚️ **Market mood:** ' + buildMarketMoodScale(volatility),
    '🎯 **Scan condition:** ' + scanCondition,
    '🔭 **Publication condition:** ' + pubCondition,
    '⭐ **Strongest live area:** ' + bestArea.text,
    '🛰️ **Near-threshold count:** ' + internalCount + ' of ' + universeSize + ' scanned',
    '',
    buildOperatorActionState(ctx),
    '',
    '> _Immediate read:_ ' + foh.narrateImmediateRead(ctx),
  ].join('\n');
}

// ── Operator panel (fast-read tag list) ──────────────────────
function buildOperatorPanel(ctx) {
  const foh = _foh();
  const tags = foh.buildOperatorPanelTags(ctx);
  const lines = [
    SUB + ' ⚡ OPERATOR PANEL ' + SUB,
    '',
  ];
  for (const t of tags) {
    lines.push(t.glyph + ' **' + t.tag + '** · ' + t.text);
  }
  return lines.join('\n');
}

// ── Market atmosphere block (substructured) ──────────────────
function buildGlobalRead(ctx) {
  const foh = _foh();
  return [
    '### 🌐 Market atmosphere',
    '',
    foh.translateAtmosphere(String((ctx && ctx.volatility && ctx.volatility.level) || '').toLowerCase()),
    '',
    '🔭 **Where pressure is building:** ' + foh.narratePressureBuilding(ctx),
    '🤔 **Why ATLAS is not promoting yet:** ' + foh.narrateWhyNotPromoting(ctx),
    '🛡️ **Trader mistake ATLAS is refusing to make:** ' + foh.narrateAvoidedTraderMistake(ctx),
    '🔁 **What would change the state:** ' + foh.narrateStateChange(ctx),
  ].join('\n');
}

// ── Expanded terminology row ─────────────────────────────────
function buildTerminologyRow(learningLinks) {
  // When the URL map is wired, surface the Markdown-link form
  // from buildLearningLinksBlock so wired terms become real
  // hyperlinks — but always rebranded as "Expanded Terminology".
  if (learningLinks && learningLinks.linkRoutingStatus === 'partial' && typeof learningLinks.text === 'string') {
    // Replace the legacy "Learning links:" label with the FOH label.
    const tailIdx = learningLinks.text.indexOf(':');
    const tail = tailIdx >= 0 ? learningLinks.text.slice(tailIdx + 1).trim() : learningLinks.text;
    return '🟦 **Expanded Terminology** · ' + tail;
  }
  return '🟦 **Expanded Terminology** · structure acceptance · structure rejection · late-entry quality · continuation runway · reference area · monitoring vs publication-grade.';
}

// ── Section radar block (visual hierarchy) ───────────────────
function buildSectionRadar(sectionKey, rows, sectionAvg) {
  const rank = _rank();
  const foh  = _foh();
  const label = rank.SECTION_LABEL[sectionKey] || sectionKey;
  const status = sectionStatusTag(sectionAvg, rows);
  const energy = foh.translateSectionEnergy(sectionAvg, rows.length);
  const sorted = rows.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const strongest = sorted[0] || null;
  const lines = [
    '### ' + status.glyph + ' ' + label + ' · **' + status.tag + '**',
    '',
    '📊 **Average:** ' + sectionAvg.toFixed(1) + '/10 across ' + sorted.length + ' active candidate' + (sorted.length === 1 ? '' : 's'),
  ];
  if (strongest) {
    const ph = foh.translatePhase(strongest.movePhase);
    lines.push('⭐ **Strongest:** ' + strongest.symbol + ' — ' + (strongest.score || 0) + '/10 · ' + ph.terse + ' stage');
  }
  lines.push('🔥 **Energy read:** ' + energy.text);
  if (sorted.length && sorted[0].score >= 8) {
    lines.push('🧠 **Why it matters:** at least one candidate is carrying pace and direction together — the kind of read ATLAS surfaces for monitoring rather than narrative.');
  } else if (sorted.length) {
    lines.push('🧠 **Why it matters:** pressure is building toward the publication bar but the cleanest acceptance has not landed; the section is asking for proof, not granting it.');
  } else {
    lines.push('🧠 **Why it matters:** the section is quiet — useful as context but not as basis for action.');
  }
  lines.push('🟢 **What would upgrade it:** ' + foh.narrateSectionUpgrade(sectionKey, sectionAvg, rows));
  lines.push('🔴 **What would downgrade it:** ' + foh.narrateSectionDowngrade(sectionKey, sectionAvg, rows));
  return lines.join('\n');
}

// ── Candidate card (v2.0 operator-psychology hierarchy) ──────
// 9-section order per the v2.0 brief:
//   1. Tactical separator
//   2. Symbol + direction + lifecycle identity
//   3. One-line immediate read
//   4. Lifecycle / Conviction / Risk / Mood strip
//   5. Operator Action Map (centre of gravity)
//   6. "What this means" — narration body
//   7. Danger / Invalidation block
//   8. What to monitor next
//   9. Compressed metadata footer
//
// QA-pinned v1.3 / v1.4 surface strings (STATUS row, Phase row,
// Movement quality row, PATH conditions, REPLAY REFERENCE, etc.)
// are preserved inside the relevant v2.0 sections rather than
// removed, so the deeper read stays available beneath the
// dominant operator surface.
function buildCandidateCard(r, idx, isStandout, ctx) {
  const foh = _foh();
  const total = (ctx && ctx.totalCards) | 0;
  const arrow = foh.arrowFor(r.direction);
  const score = Number.isFinite(r.score) ? r.score : '?';
  const narration = foh.translateCandidate(r, ctx);
  const status = cardStatusTag(r);

  // The legacy v1.3 banner stays as the symbol identity line.
  // It is QA-pinned and serves the operator just as well as a
  // standalone identity header would — the v2.0 surface adds a
  // tactical scan separator above it for cinematic weight,
  // plus a lifecycle/score sub-line below.
  const identityBanner = buildCardBanner(r.symbol, arrow, score, r.sectionLabel, isStandout);

  const lines = [
    // [1] Tactical scan separator (v2.0)
    buildTacticalSeparator(idx, total, r, isStandout),
    // [2] Symbol + direction identity (legacy-compatible banner)
    identityBanner,
    // [2b] Lifecycle / stage sub-line (v2.0)
    buildCardIdentityHeader(r, isStandout),
    '',
    // [3] One-line immediate read
    buildImmediateRead(r),
    '',
    // [4] Lifecycle / Conviction / Risk / Mood strip
    buildLifecycleConvictionStrip(r, ctx),
    '',
    // [5] Operator Action Map — centre of gravity
    buildOperatorActionMap(r),
    '',
    // [6] What this means — narration body
    SUB + ' 📖 What this means ' + SUB,
    '',
    buildLongShortExplanation(r.direction),
    '',
    '📍 **WHAT HAPPENED**',
    narration.whatHappened,
    '',
    '🎯 **WHERE IT MATTERS**',
    narration.whereItMatters,
    '',
    '🧠 **WHY ATLAS IS WATCHING**',
    narration.whyAtlasCares,
    '',
    buildPanelFramer('Price zones', [buildPriceZoneBlock(r)]),
    '',
    // [7] Danger / Invalidation block
    SUB + ' ❌ Danger / Invalidation ' + SUB,
    '',
    '❌ **INVALIDATION**',
    narration.invalidation,
    '',
    buildInvalidationExplanation(r),
    '',
    '🟢 **HEALTHY PATH**',
    narration.healthyZone,
    '',
    (narration.lateEntry.glyph || '🟡') + ' **CAUTION PATH**',
    narration.cautionZone,
    '',
    '🟠 **DANGER PATH**',
    narration.dangerZone,
    '',
    buildHowTraderActsBlock(r),
    '',
    // [8] What to monitor next
    SUB + ' 📡 What to monitor next ' + SUB,
    '',
    '📡 **WHAT ATLAS NEEDS NEXT**',
    narration.whatNext,
    '',
    '🎙️ **OPERATOR NOTE**',
    narration.behaviouralNote,
    '',
    '_Trader guidance (advisory only):_',
    narration.traderGuidance.map(s => '• ' + s).join('\n'),
    '',
    narration.consequenceTrail,
    '',
    // Supporting detail — QA-pinned metrics + replay reference,
    // intentionally placed after the dominant operator surface.
    SUB + ' 📚 Supporting detail ' + SUB,
    '',
    status.glyph + ' **STATUS** · ' + status.tag,
    buildLifecycleBadge(r.movePhase),
    '🧬 **Phase** · ' + narration.phase.plain,
    '⚡ **Movement quality** · ' + narration.speed + '; ' + narration.relativeStrength + '.',
    '',
    '🗂️ **REPLAY REFERENCE**',
    narration.replayReference.slice(1).join('\n'),
    '',
    // [9] Compressed metadata footer
    buildCompactMetadataFooter(r, idx, total, ctx),
  ];
  return lines.join('\n');
}

// ── Watch / Avoided-risk / Operator-note / Universe / Close ──
function buildWatchExplanation(ctx) {
  // Operator directive 2026-05-13 — keep the existing FOH watch
  // explanation block (it's already operational + consequence-
  // first under the translator). Promote the heading style so it
  // matches the v1.3 visual hierarchy.
  return _foh().narrateWatchExplanation(ctx);
}
function buildAvoidedRisk(ctx) {
  return [
    SUB + ' 🛡️ WHAT ATLAS REFUSED TO PROMOTE ' + SUB,
    '',
    _foh().narrateAvoidedRisk(ctx),
  ].join('\n');
}
function buildOperatorNote(ctx) {
  return [
    SUB + ' 🎙️ OPERATOR NOTE ' + SUB,
    '',
    _foh().narrateOperatorNote(ctx),
  ].join('\n');
}

// Redesigned universe coverage — compact tag block, not table.
function buildUniverseCoverage(ctx) {
  const rank = _rank();
  const ranking = (ctx && ctx.ranking) || {};
  const top10 = Array.isArray(ranking.top10) ? ranking.top10 : [];
  const sectionAvgs = (ctx && ctx.sectionAvgs) || {};
  const atThreshold = top10.filter(r => (r.score || 0) >= 8).length;
  const universe = (ctx && ctx.universeSize) | 0;
  const internal = (ctx && ctx.internalCount) | 0;
  const ignored = (ctx && ctx.ignoredCount) | 0;
  const entries = Object.entries(sectionAvgs).sort((a, b) => b[1] - a[1]);
  const sectionLabels = (ctx && ctx.sectionLabels) || {};
  const strongest = entries[0]
    ? (sectionLabels[entries[0][0]] || entries[0][0]) + ' (avg ' + entries[0][1].toFixed(1) + '/10)'
    : 'no active section this cycle';
  const weakest = entries.length > 1
    ? (sectionLabels[entries[entries.length - 1][0]] || entries[entries.length - 1][0]) + ' (avg ' + entries[entries.length - 1][1].toFixed(1) + '/10)'
    : 'no second active section this cycle';
  let concentration;
  if (entries.length === 0) {
    concentration = 'Quiet across sections';
  } else if (entries.length === 1) {
    concentration = 'Concentrated in ' + (sectionLabels[entries[0][0]] || entries[0][0]);
  } else {
    const spread = entries[0][1] - entries[entries.length - 1][1];
    concentration = spread > 2
      ? 'Concentrated in ' + (sectionLabels[entries[0][0]] || entries[0][0])
      : 'Broad across sections';
  }
  return [
    SUB + ' 📊 UNIVERSE COVERAGE ' + SUB,
    '',
    '🛰️ **Scanned this cycle** · ' + universe + ' symbols',
    '⚪ **Quiet / context only (< 5/10)** · ' + ignored,
    '🟡 **Building (5–7/10)** · ' + internal,
    '🟢 **Publication-grade (≥ 8/10)** · ' + atThreshold,
    '⭐ **Strongest active area** · ' + strongest,
    '🔵 **Weakest active area** · ' + weakest,
    '🌐 **Cross-section concentration** · ' + concentration,
  ].join('\n');
}

// Redesigned closing block — upgrade / downgrade pair.
function buildClosingBlock(ctx) {
  const foh = _foh();
  const top = (ctx && ctx.top10Count) | 0;
  const stateLine = top === 0
    ? 'Monitoring only — publication threshold not met this cycle'
    : 'Monitoring only — developing standouts surfaced, no confirmed publication-grade setup this cycle';
  return [
    SUB + ' 🔚 NEXT REVIEW ' + SUB,
    '',
    '⏳ **Next review (UTC)** · ' + (ctx && ctx.nextReview ? ctx.nextReview : 'pending'),
    '🎯 **Current operator state** · ' + stateLine,
    '🟢 **What could upgrade by next scan** · ' + foh.narrateClosingUpgrade(ctx),
    '🔴 **What could downgrade by next scan** · ' + foh.narrateClosingDowngrade(ctx),
    '🎙️ **Monitoring instruction** · ' + foh.narrateMonitoringInstruction(ctx),
  ].join('\n');
}

// ============================================================
// MAIN ENTRY — buildFohMovementDigestPayload
// ============================================================
function buildFohMovementDigestPayload(ranking, volatility, opts) {
  opts = opts || {};
  const rank = _rank();
  const foh  = _foh();
  const top = Array.isArray(ranking && ranking.top10) ? ranking.top10 : [];
  const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
  const internalArr = Array.isArray(opts.internal) ? opts.internal : [];
  const ignoredArr  = Array.isArray(opts.ignored)  ? opts.ignored  : [];
  const universeSize = Number.isFinite(opts.universeSize) ? opts.universeSize : (top.length + internalArr.length + ignoredArr.length);

  const standoutSet = new Set(rank.selectStandouts(top, 2).map(s => s.symbol));

  const bySection = {};
  for (const row of top) {
    if (!bySection[row.section]) bySection[row.section] = [];
    bySection[row.section].push(row);
  }
  for (const sec of Object.keys(bySection)) bySection[sec] = bySection[sec].slice(0, 2);

  const sectionAvgs = rank.perSectionAvgScores([...top, ...internalArr]);
  const sectionLabels = {};
  for (const sec of Object.keys(sectionAvgs)) sectionLabels[sec] = rank.SECTION_LABEL[sec] || sec;

  // totalCards is derived after the bySection walk below so the
  // v2.0 tactical separator can carry an honest "SCAN N / TOTAL"
  // label without invoking the legacy "top.length" assumption.
  let totalCards = 0;
  for (const sec of rank.SECTION_DISPLAY_ORDER) {
    const rows = bySection[sec] || [];
    totalCards += rows.length;
  }

  const ctx = {
    nowMs,
    volatility,
    ranking,
    top10Count: top.length,
    atThresholdCount: top.filter(x => (x.score || 0) >= 8).length,
    internalCount: internalArr.length,
    ignoredCount: ignoredArr.length,
    universeSize,
    sectionAvgs,
    sectionLabels,
    watchThreshold: 8,
    nextReview: rank.nextReviewLine(opts.now, opts.intervalMs),
    totalCards,
  };

  const learningLinks = rank.buildLearningLinksBlock(opts.learningLinkUrls);

  const preRadarRecords = rank.selectPreRadarCandidates(internalArr);
  const nearMissRecords = rank.selectNearMissCandidates(internalArr);
  const preRadarBlock = foh.buildFohPreRadarBlock(preRadarRecords);
  const nearMissBlock = foh.buildFohNearMissBlock(nearMissRecords, ctx.watchThreshold);

  const sectionBlocks = [];
  for (const sec of rank.SECTION_DISPLAY_ORDER) {
    const rows = bySection[sec] || [];
    if (!rows.length) continue;
    const avg = Number.isFinite(sectionAvgs[sec]) ? sectionAvgs[sec] : 0;
    sectionBlocks.push(buildSectionRadar(sec, rows, avg));
  }

  let displayIdx = 0;
  const cards = [];
  for (const sec of rank.SECTION_DISPLAY_ORDER) {
    const rows = bySection[sec] || [];
    for (const row of rows) {
      const isStandout = standoutSet.has(row.symbol);
      cards.push(buildCandidateCard(row, displayIdx, isStandout, ctx));
      displayIdx += 1;
    }
  }

  const blocks = [];

  // 1. Premium banner + immediate read
  blocks.push(buildAtmosphereBanner(ctx));

  // 2. Operator panel (fast-read tag list)
  blocks.push(buildOperatorPanel(ctx));

  // 3. 🔴 CURRENT LIVE READ separator
  blocks.push(buildNewSeparator('CURRENT LIVE READ'));

  // 4. Market atmosphere with substructure
  blocks.push(buildGlobalRead(ctx));

  // 5. Expanded terminology row (placed early so the reader has
  //    vocabulary before the section radar / cards land).
  blocks.push(buildTerminologyRow(learningLinks));

  // 6. Section radar
  if (sectionBlocks.length) {
    blocks.push(buildSectionSeparator('SECTION RADAR', '📡'));
    blocks.push(sectionBlocks.join('\n\n'));
  }

  // 7. Candidate cards (banner-separated, premium hierarchy)
  if (cards.length) {
    blocks.push(buildSectionSeparator('CANDIDATE CARDS', '🎴'));
    blocks.push(cards.join('\n\n'));
  }

  // 8. Supporting intelligence (FOH-native Pre-Radar / Near-Miss)
  if (preRadarBlock || nearMissBlock) {
    blocks.push(buildSectionSeparator('SUPPORTING INTELLIGENCE', '🛰️'));
    if (preRadarBlock) blocks.push(preRadarBlock);
    if (nearMissBlock) blocks.push(nearMissBlock);
  }

  // 9. Why ATLAS is not promoting yet (operational, not checklist)
  blocks.push(buildWatchExplanation(ctx));

  // 10. Avoided-risk attribution — present when no
  //     publication-grade promotion fired this cycle.
  if (ctx.atThresholdCount === 0) blocks.push(buildAvoidedRisk(ctx));

  // 11. Operator behavioural note
  blocks.push(buildOperatorNote(ctx));

  // 12. Universe coverage (visual tag panel)
  blocks.push(buildUniverseCoverage(ctx));

  // 13. Closing block — next review + upgrade / downgrade pair
  blocks.push(buildClosingBlock(ctx));

  // 14. Advisory tail (no permission / directive wording)
  blocks.push(
    '⚠️ Advisory only — ATLAS surfaces conditions and reference areas; '
    + 'it does not issue trading directives. Late-entry quality varies '
    + 'by phase per candidate.'
  );

  const content = blocks.join('\n\n');
  // firstChunkPrefix retired in v1.3 — the FOH OPERATOR SURFACE
  // banner block at the top of `content` carries the scan-time
  // identity directly on Part 1. The chunker still strips the
  // legacy v1.1 banner if present, so legacy fallback content
  // continues to work unchanged.
  return {
    content,
    kind: 'movement_digest_v1_3_foh',
    linkRoutingStatus: learningLinks.linkRoutingStatus,
    firstChunkPrefix: null,
  };
}

module.exports = {
  buildFohMovementDigestPayload,
  // Helpers exported for QA / preview harnesses.
  buildAtmosphereBanner,
  buildOperatorPanel,
  buildNewSeparator,
  buildSectionSeparator,
  buildCardBanner,
  buildGlobalRead,
  buildSectionRadar,
  buildCandidateCard,
  buildWatchExplanation,
  buildAvoidedRisk,
  buildOperatorNote,
  buildTerminologyRow,
  buildUniverseCoverage,
  buildClosingBlock,
  sectionStatusTag,
  cardStatusTag,
  fmtUtcStamp,
  fmtAwstStamp,
  // v1.4 visual primitives (A–G)
  buildMarketMoodScale,
  buildLifecycleBadge,
  buildWhatThisMeans,
  buildLongShortExplanation,
  buildPriceZoneBlock,
  buildHowTraderActsBlock,
  buildInvalidationExplanation,
  buildPanelFramer,
  // v2.0 operator-psychology primitives
  buildTacticalSeparator,
  buildCardIdentityHeader,
  buildImmediateRead,
  buildConvictionTag,
  buildLifecycleConvictionStrip,
  buildOperatorActionMap,
  buildCompactMetadataFooter,
  buildOperatorActionState,
};
