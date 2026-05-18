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
const { boxHeader: _atlasBoxHeader, controlStrip: _atlasControlStrip } = require('./foh/headerStrip');
const { accountRiskPanel: _atlasRiskPanel, expandMacroLabels: _atlasExpand, formatPriceDistance: _atlasFmtDistance } = require('./foh/foh-format');

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
//    into four behavioural responses so the operator surface is
//    self-contained.
function buildHowTraderActsBlock(record) {
  const dir = String((record && record.direction) || '').toLowerCase();
  const ph  = String((record && record.movePhase) || '').toLowerCase();
  const sideWord = dir === 'bullish' ? 'with buyers' : dir === 'bearish' ? 'with sellers' : 'with whichever side leads';
  const stretched = ph === 'late' || ph === 'exhaustion';
  const tail = stretched
    ? ' *(Phase is already ' + ph + ' — reaction risk is elevated; smaller hands and tighter rules win here.)*'
    : '';
  return [
    '🎯 **HOW A TRADER ACTS ON THIS** *(advisory only)*',
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
  // Download-control strip sits directly under the boxed report
  // heading. Dark Horse always emits PNG + PDF attachments through
  // the FOH dispatch path (foh/dispatch/sendDarkHorseFoh.js →
  // postFohDeliverable); Expanded Terminology is wired via
  // buildTerminologyRow below. The public dashboard route is not
  // yet exposed to users — shown as Brief Pending until it lands.
  const controlStrip = _atlasControlStrip({
    png: 'available',
    pdf: 'available',
    dashboard: 'pending',
    glossary: 'available',
  });
  return [
    _atlasBoxHeader('🐎 ATLAS · DARK HORSE · MOVEMENT DIGEST'),
    controlStrip,
    '',
    '🐎 **ATLAS · DARK HORSE · FOH OPERATOR SURFACE**',
    '*v1.3 — operator edition*',
    '',
    '📍 **Scan time:** ' + fmtUtcStamp(nowMs) + ' · ' + fmtAwstStamp(nowMs),
    '🌐 **Atmosphere:** ' + lvl,
    '🎚️ **Market mood:** ' + buildMarketMoodScale(volatility),
    '🎯 **Scan condition:** ' + scanCondition,
    '🔭 **Publication condition:** ' + pubCondition,
    '⭐ **Strongest live area:** ' + bestArea.text,
    '🛰️ **Near-threshold count:** ' + internalCount + ' of ' + universeSize + ' scanned',
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

// ── Candidate card (premium visual hierarchy) ────────────────
// CURRENT ADVICE — AT RELEASE (operator brief 2026-05-18).
// First actionable block on every Dark Horse standout — answers
// "what do I do with this right now?" before the trader reads
// any setup theory. Most price-level fields render 'Pending'
// today because the engine does not yet emit explicit entry /
// validation / target prices; the placeholder strings are the
// honest fallback per the operator spec ("If a field is not
// available, do not omit it silently"). When engine wiring lands
// these fields fill in without changing the block layout.
function _dhAdviceStateFor(status) {
  // status.tag comes from cardStatusTag and uses the v1.3 vocab:
  //   'DANGER · stretched move'           → REDUCED SIZE ONLY
  //   'CAUTION · late-stage move'         → REDUCED SIZE ONLY
  //   'HEALTHY · publication-grade …'     → CONDITIONAL WATCH
  //   'BUILDING · pressure visible'       → WAIT FOR VALIDATION
  //   'CONTEXT · informational only'      → OBSERVATION ONLY
  const t = String(status && status.tag || '').toUpperCase();
  if (/DANGER|EXHAUSTION|FADING|STRETCHED/.test(t)) return 'REDUCED SIZE ONLY';
  if (/CAUTION|LATE-STAGE/.test(t)) return 'REDUCED SIZE ONLY';
  if (/HEALTHY|PUBLICATION-GRADE|STANDOUT|STILL TRENDING/.test(t)) return 'CONDITIONAL WATCH';
  if (/BUILDING|DEVELOPING|FRESH/.test(t)) return 'WAIT FOR VALIDATION';
  return 'OBSERVATION ONLY';
}

function _dhRiskCapFor(phase) {
  const p = String(phase || '').toLowerCase();
  if (/late|exhaustion|fading/.test(p)) return '0.25% of account equity (late-stage card)';
  if (/developing|breakout|fresh/.test(p)) return '0.50% of account equity';
  return '0.25% of account equity';
}

function _dhDirectionLabel(dir) {
  const d = String(dir || '').toLowerCase();
  if (d === 'bullish') return 'Long';
  if (d === 'bearish') return 'Short';
  if (d === 'neutral') return 'Neutral';
  return 'Pending';
}

function buildCurrentAdviceBlock(record, ctx) {
  const status = cardStatusTag(record);
  const adviceState = _dhAdviceStateFor(status);
  const direction = _dhDirectionLabel(record && record.direction);
  const phase = String((record && record.movePhase) || '').toLowerCase();
  const stretched = /late|exhaustion|fading/.test(phase);

  const ev = (record && record.evidenceAnchors) || {};
  const hi = ev.recentHigh && ev.recentHigh.priceText;
  const lo = ev.recentLow  && ev.recentLow.priceText;
  const inv = ev.invalidation && ev.invalidation.priceText;

  const entryZone = (hi && lo) ? lo + ' – ' + hi : 'Pending — entry band not yet published';
  const stopPrice = inv || 'Pending — invalidation level not yet published';
  const extendedStop = stretched ? 'Not used — late-stage card (single-stop discipline)' : 'Pending';

  const nextReview = (ctx && ctx.nextReview) || 'Pending';
  const riskCap = _dhRiskCapFor(phase);
  const doNotEnter = inv
    ? 'Price closes ' + (String((record && record.direction) || '').toLowerCase() === 'bullish' ? 'below' : 'above') + ' ' + inv + ' on the 1D timeframe before entry validation.'
    : 'Invalidation level pending — do not enter until the structure level is published.';

  const instantAdvice = stretched
    ? 'Do not enter yet. This card is late-stage — wait for the listed validation rule and keep risk capped.'
    : direction === 'Pending'
    ? 'Observation only — direction is not yet resolved by the engine.'
    : 'Conditional ' + direction.toLowerCase() + ' only after the candle-close validation rule below. Risk remains capped until structure confirms.';

  return [
    _atlasBoxHeader('⚡ CURRENT ADVICE — AT RELEASE', { color: 'orange' }),
    '🟧 **Advice State:**',
    adviceState,
    '',
    '🟩 **Direction:**',
    direction,
    '',
    '🟩 **Entry Zone:**',
    entryZone,
    '',
    '🟨 **Entry Window:**',
    'Pending — recheck at next scan (' + nextReview + '). No entry until the validation rule below is met.',
    '',
    '🟨 **Entry Validation:**',
    'Pending — exact 5M / 15M candle-close requirement not yet emitted by the engine. Until then, treat as observation only.',
    '',
    '🟥 **Stop / Invalidation:**',
    stopPrice,
    '',
    '🟧 **Extended Stop:**',
    extendedStop,
    '',
    '🎯 **First Target:**',
    'Pending validation',
    '',
    '🟧 **Risk Cap:**',
    riskCap,
    '',
    _atlasRiskPanel(),
    '',
    '🟦 **Minimum ATLAS Buffer:**',
    'Pending — instrument-aware buffer wiring in progress (dollars first per FOH spec, technical unit in brackets).',
    '',
    '🟦 **Technical Distance:**',
    _atlasFmtDistance(null, record && record.symbol),
    '',
    '🟪 **Next Review:**',
    nextReview,
    '',
    '⛔ **Do Not Enter If:**',
    doNotEnter,
    '',
    '📷 **Visual Example:**',
    'See attached PNG card for entry-zone / invalidation visual.',
    '',
    '**INSTANT ADVICE:** ' + instantAdvice,
  ].join('\n');
}

function buildCandidateCard(r, idx, isStandout, ctx) {
  const foh = _foh();
  const arrow = foh.arrowFor(r.direction);
  const score = Number.isFinite(r.score) ? r.score : '?';
  const narration = foh.translateCandidate(r, ctx);
  const status = cardStatusTag(r);

  const banner = buildCardBanner(r.symbol, arrow, score, r.sectionLabel, isStandout);

  const lines = [
    banner,
    '',
    status.glyph + ' **STATUS** · ' + status.tag,
    buildLifecycleBadge(r.movePhase),
    '',
    buildCurrentAdviceBlock(r, ctx),
    '',
    buildLongShortExplanation(r.direction),
    '',
    '🧬 **Phase** · ' + narration.phase.plain,
    '⚡ **Movement quality** · ' + narration.speed + '; ' + narration.relativeStrength + '.',
    '',
    '📍 **WHAT HAPPENED**',
    _atlasExpand(narration.whatHappened),
    '',
    '🎯 **WHERE IT MATTERS**',
    narration.whereItMatters,
    '',
    '🧠 **WHY ATLAS IS WATCHING**',
    narration.whyAtlasCares,
    '',
    buildPanelFramer('Price zones', [buildPriceZoneBlock(r)]),
    '',
    SUB + ' Path conditions ' + SUB,
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
    '❌ **INVALIDATION**',
    narration.invalidation,
    '',
    buildInvalidationExplanation(r),
    '',
    buildHowTraderActsBlock(r),
    '',
    SUB + ' Forward read ' + SUB,
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
    '🗂️ **REPLAY REFERENCE**',
    narration.replayReference.slice(1).join('\n'), // drop the heading line — banner already labels it
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
};
