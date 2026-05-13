'use strict';

// ============================================================
// DARK HORSE — FOH LIVE FORMATTER (layout only)
//
// Operator directive 2026-05-13. The formatter is now strictly
// a layout / assembly module: it sequences the FOH digest
// blocks, applies the chunker contract, and returns the payload
// to darkHorseEngine. ALL user-facing narration sentences are
// produced by darkHorseFohSemanticTranslator — the formatter
// must not paste raw engine fields like `r.structureState`,
// `r.lateEntryRisk`, `r.whyNotWatch`, `r.promotionTrigger`,
// or `r.summary` directly into Discord. If a piece of text
// needs to be added, route it through the translator so the
// live surface speaks one voice.
//
// Strict scope (locked):
//   - Layout / formatting only.
//   - Does NOT touch Corey, Jane, Spidey, Macro, ranking maths,
//     scoring, thresholds, scheduler cadence, webhook transport,
//     cooldown, the symbol universe, or candidate selection.
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
function buildNewSeparator(label) {
  const safeLabel = label || 'CURRENT LIVE READ';
  return '━━━━━━━━━━ 🔴 ' + safeLabel + ' ━━━━━━━━━━';
}

// ── Atmosphere banner (header) ───────────────────────────────
function buildAtmosphereBanner(ctx) {
  const { nowMs, volatility, top10Count, internalCount, ignoredCount, universeSize } = ctx;
  const lvl = (volatility && volatility.level) || 'reading pending';
  const scanState = top10Count >= 1 ? 'Tracking developing standouts' : 'Monitoring only';
  const pubState = top10Count === 0
    ? 'Publication threshold not met this cycle'
    : (top10Count + ' developing standout' + (top10Count === 1 ? '' : 's') + ' surfaced — none confirmed');
  return [
    '🐎 **DARK HORSE — GLOBAL MOVER RADAR (v1.2 · FOH)**',
    '',
    '_Digest version:_ v1.2-foh',
    '_Timestamp:_ ' + fmtUtcStamp(nowMs) + ' / ' + fmtAwstStamp(nowMs),
    '_Market atmosphere:_ ' + lvl,
    '_Scan state:_ ' + scanState,
    '_Publication state:_ ' + pubState,
    '_Universe scanned:_ ' + universeSize + ' symbols · watch ≥ 8/10: ' + (ctx.atThresholdCount || 0)
      + ' · near-threshold 5–7: ' + internalCount
      + ' · below 5: ' + ignoredCount,
  ].join('\n');
}

// ── Global market read (delegated to translator) ─────────────
function buildGlobalRead(ctx) {
  const foh = _foh();
  return [
    '### 🌐 Global market read',
    '',
    foh.narrateGlobalMarketRead(ctx),
  ].join('\n');
}

// ── Section radar block (delegated to translator) ────────────
function buildSectionRadar(sectionKey, rows, sectionAvg) {
  const rank = _rank();
  const foh  = _foh();
  const label = rank.SECTION_LABEL[sectionKey] || sectionKey;
  const energy = foh.translateSectionEnergy(sectionAvg, rows.length);
  const sorted = rows.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const strongest = sorted[0] || null;
  const weakest   = sorted.length > 1 ? sorted[sorted.length - 1] : null;
  const lines = [
    '### ' + energy.glyph + ' ' + label,
    '',
    '_Section energy:_ ' + energy.text,
    '_Cycle average across active candidates:_ ' + sectionAvg.toFixed(1) + '/10 across ' + sorted.length + ' candidate' + (sorted.length === 1 ? '' : 's') + '.',
  ];
  if (strongest) {
    const ph = foh.translatePhase(strongest.movePhase);
    lines.push('_Strongest active:_ ' + strongest.symbol + ' — score ' + (strongest.score || 0) + '/10, sitting at ' + ph.terse + ' stage of the move.');
  }
  if (weakest && weakest !== strongest) {
    const ph = foh.translatePhase(weakest.movePhase);
    lines.push('_Weakest active:_ ' + weakest.symbol + ' — score ' + (weakest.score || 0) + '/10, ' + ph.terse + ' stage; surfaced for context, not promotion.');
  }
  if (sorted.length && sorted[0].score >= 8) {
    lines.push('_What this section is doing:_ at least one candidate is carrying both pace and structural weight in the same direction, which is what publication-grade attention looks like in practice.');
    lines.push('_Why it earned publication-grade attention:_ the section is moving with concentrated direction, not just isolated noise.');
  } else if (sorted.length) {
    lines.push('_What this section is doing:_ pressure is building toward the publication bar but the cleanest acceptance has not landed yet — the section is asking for proof rather than granting it.');
    lines.push('_Why it has not earned promotion:_ acceptance at the next reference area has not been tested yet, and ATLAS does not promote a move that has only travelled, not been respected.');
  } else {
    lines.push('_What this section is doing:_ no active candidate this cycle — the section is on the bench and surfaces here for completeness.');
  }
  return lines.join('\n');
}

// ── Candidate card (delegated to translator) ─────────────────
function buildCandidateCard(r, idx, isStandout, ctx) {
  const foh = _foh();
  const star = isStandout ? '⭐ ' : '';
  const arrow = foh.arrowFor(r.direction);
  const narration = foh.translateCandidate(r, ctx);

  // Identity block — every line is translated. No raw engine
  // shorthand reaches the user surface.
  const identity = [
    '_Identity:_',
    '• Direction the move is asking the trader to consider: ' + (r.direction || 'undefined'),
    '• ATLAS score: ' + (Number.isFinite(r.score) ? r.score : '?') + '/10.',
    '• Move stage: ' + narration.phase.plain + '.',
    '• Late-entry assessment: ' + narration.lateEntry.plain,
    '• Pace: ' + narration.speed + '.',
    '• Position vs section peers: ' + narration.relativeStrength + '.',
    '• Publication state: ' + narration.publication,
  ].join('\n');

  // Zone glyphs sit on the same line as their narration so the
  // reader sees the cue + consequence together.
  const cautionGlyph = narration.lateEntry.glyph || '🟡';
  const header = '**' + star + '#' + (idx + 1) + ' — ' + r.symbol + ' ' + arrow + '**  ·  '
    + (r.sectionLabel || 'Section pending')
    + '  ·  ' + cautionGlyph + ' ' + (narration.lateEntry.tone || 'tone pending');

  const lines = [
    header,
    '',
    identity,
    '',
    '_What happened:_',
    narration.whatHappened,
    '',
    '_Where it matters:_',
    narration.whereItMatters,
    '',
    '_Why ATLAS is watching:_',
    narration.whyAtlasCares,
    '',
    '🟢 _Healthy zone:_ ' + narration.healthyZone,
    cautionGlyph + ' _Caution zone:_ ' + narration.cautionZone,
    '🟠 _Danger zone:_ ' + narration.dangerZone,
    '🔴 _Invalidation:_ ' + narration.invalidation,
    '',
    '_What ATLAS needs next:_',
    narration.whatNext,
    '',
    '_Trader guidance (advisory only):_',
    narration.traderGuidance.map(s => '• ' + s).join('\n'),
    '',
    '_Behavioural note:_',
    narration.behaviouralNote,
    '',
    narration.consequenceTrail,
    '',
    narration.replayReference.join('\n'),
  ];
  return lines.join('\n');
}

// ── Watch / Avoided-risk / Operator-note / Universe / Close ──
function buildWatchExplanation(ctx) { return _foh().narrateWatchExplanation(ctx); }
function buildAvoidedRisk(ctx) {
  return ['### 🛡️ What ATLAS avoided by not promoting', '', _foh().narrateAvoidedRisk(ctx)].join('\n');
}
function buildOperatorNote(ctx) {
  return ['### 🎙️ Operator note', '', _foh().narrateOperatorNote(ctx)].join('\n');
}
function buildUniverseCoverage(ctx) { return _foh().narrateUniverseCoverage(ctx); }
function buildClosingBlock(ctx)     { return _foh().narrateClosingBlock(ctx); }

// ── Terminology row (plain text default — no fake links) ─────
function buildTerminologyRow(learningLinks) {
  if (learningLinks && learningLinks.linkRoutingStatus === 'partial' && typeof learningLinks.text === 'string') {
    return learningLinks.text;
  }
  return '🟦 _Expanded terminology:_ structure acceptance · structure rejection · late-entry quality · continuation runway · reference area · monitoring vs publication-grade.';
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

  // Pre-Radar / Near-Miss — FOH-native renderers (no legacy
  // pass-through). The legacy buildPreRadarBlock /
  // buildNearMissBlock that used to render raw `summary`
  // strings are no longer called from the live path.
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
  blocks.push(buildAtmosphereBanner(ctx));
  blocks.push(buildNewSeparator('CURRENT LIVE READ'));
  blocks.push(buildGlobalRead(ctx));
  blocks.push(buildTerminologyRow(learningLinks));

  if (sectionBlocks.length) {
    blocks.push(buildNewSeparator('SECTION RADAR'));
    blocks.push(sectionBlocks.join('\n\n'));
  }

  if (cards.length) {
    blocks.push(buildNewSeparator('CANDIDATE CARDS'));
    blocks.push(cards.join('\n\n──\n\n'));
  }

  if (preRadarBlock || nearMissBlock) {
    blocks.push(buildNewSeparator('SUPPORTING INTELLIGENCE'));
    if (preRadarBlock) blocks.push(preRadarBlock);
    if (nearMissBlock) blocks.push(nearMissBlock);
  }

  blocks.push(buildWatchExplanation(ctx));
  if (ctx.atThresholdCount === 0) blocks.push(buildAvoidedRisk(ctx));
  blocks.push(buildOperatorNote(ctx));
  blocks.push(buildUniverseCoverage(ctx));
  blocks.push(buildClosingBlock(ctx));
  blocks.push(
    '⚠️ Advisory only — ATLAS surfaces conditions and reference areas; '
    + 'it does not issue trading directives. Late-entry quality varies '
    + 'by phase per candidate; reassess against the per-candidate criteria '
    + 'at the next scan.'
  );

  const content = blocks.join('\n\n');
  const firstChunkPrefix = rank.buildNewScanBoundary(opts.now);

  return {
    content,
    kind: 'movement_digest_v1_2_foh',
    linkRoutingStatus: learningLinks.linkRoutingStatus,
    firstChunkPrefix,
  };
}

module.exports = {
  buildFohMovementDigestPayload,
  // Helpers exported for the qa harness.
  buildAtmosphereBanner,
  buildNewSeparator,
  buildGlobalRead,
  buildSectionRadar,
  buildCandidateCard,
  buildWatchExplanation,
  buildAvoidedRisk,
  buildOperatorNote,
  buildTerminologyRow,
  buildUniverseCoverage,
  buildClosingBlock,
  fmtUtcStamp,
  fmtAwstStamp,
};
