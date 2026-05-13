'use strict';

// ============================================================
// DARK HORSE — FOH LIVE FORMATTER
//
// Operator directive 2026-05-13. Replaces the legacy "radar
// template" digest body. Wired into the live path from
// darkHorseRanking.buildRankedMovementDigestPayload, which now
// delegates here by default. The legacy renderer is preserved as
// a fallback only behind ATLAS_DARKHORSE_LEGACY=1.
//
// Strict scope (locked):
//   - This module is rendering / formatting only.
//   - Does NOT touch Corey, Jane, Spidey, Macro, ranking maths,
//     scoring, thresholds, scheduler cadence, webhook transport,
//     cooldown, the symbol universe, or candidate selection.
//   - Consumes the existing ranking record + opts shape; produces
//     { content, firstChunkPrefix, linkRoutingStatus, kind } so
//     darkHorseEngine.js / _dhChunkDigest keep their existing
//     contract.
//
// Voice rules:
//   - Plain-English operational translation, not trader shorthand.
//   - Each candidate card answers the 7 FOH questions: what
//     happened / where / why it matters / what changes on
//     acceptance / what becomes dangerous on rejection / what
//     invalidates / what to monitor next.
//   - Advisory wording only — never directives or promises
//     ("buy now", "must sell", "guaranteed"). The legacy banned
//     vocabulary ("permission", etc.) stays out of the live
//     surface too.
//   - Backward-looking references carry Universal Reference
//     Doctrine fields (timestamp / timeframe / location / study
//     guidance) OR an honest "unavailable in this scan packet"
//     note. Never invent levels.
//   - No trader shorthand as the primary explanation. The
//     legacy phrases ("body close", "break and hold", "Retest
//     holds", "read weakens", "confirmation, not exhaustion")
//     are absent from the user-facing surface.
// ============================================================

// Lazy require — darkHorseRanking.js delegates here from inside
// buildRankedMovementDigestPayload, so a top-level require could
// create an order-of-load race in the engine harness. Requiring
// inside the entry point sidesteps it cleanly.
function _rank() { return require('./darkHorseRanking'); }

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

// ── Atmosphere / volatility → plain operational sentence ─────
function atmosphereFor(volLevel) {
  const lvl = String(volLevel || '').toLowerCase();
  if (lvl === 'quiet') {
    return 'Market energy is subdued. Liquidity is thin and conviction is low, which means individual moves can feel larger than the catalyst behind them — chasing the first impulse is usually the wrong instinct in this regime.';
  }
  if (lvl === 'elevated') {
    return 'Market energy is elevated. There is genuine movement across the universe, but the strongest waves have not yet asked the market to prove acceptance — ATLAS is watching for the handoff from raw speed to clean structure.';
  }
  if (lvl === 'extreme') {
    return 'Market energy is at an extreme. Range is expanding faster than structure can settle; participation is broad but unstable, and late-stage reversals become more likely as the move runs out of fresh fuel.';
  }
  return 'Market energy reading is pending this cycle — the volatility gauge has not returned a clean read, so ATLAS is treating the regime as undefined until the next scan.';
}

// ── Phase / risk plain-English mapping ───────────────────────
function phasePhrase(phase) {
  switch (String(phase || '').toLowerCase()) {
    case 'early':      return 'just beginning — the move still has runway';
    case 'mid':        return 'mid-stage — the trend is established but not yet stretched';
    case 'late':       return 'late-stage — most of the easy distance has already been taken';
    case 'exhaustion': return 'exhausted — the move has overextended and is vulnerable to mean-reversion';
    default:           return 'phase reading pending';
  }
}
function lateRiskPhrase(risk) {
  const r = String(risk || '').toLowerCase();
  if (r.includes('low'))                       return 'Late-entry risk is low — entering at the next clean reference still has meaningful runway, provided that reference is accepted.';
  if (r.includes('elev') || r.includes('high')) return 'Late-entry risk is elevated — the easy distance has already been travelled and a fresh entry now is closer to chasing than positioning.';
  if (r.includes('mid'))                       return 'Late-entry risk sits in the middle — the move has worked, but the next phase still has structure to give.';
  return 'Late-entry risk reading pending.';
}

// ── Zone cues per FOH directive (healthy / caution / danger) ─
function zoneCueFor(record) {
  const score = Number.isFinite(record && record.score) ? record.score : 0;
  const phase = String(record && record.movePhase || '').toLowerCase();
  if (phase === 'exhaustion')   return { glyph: '🔴', label: 'Danger / invalidation risk' };
  if (phase === 'late')         return { glyph: '🟠', label: 'Late / reduced quality' };
  if (score >= 8)               return { glyph: '🟢', label: 'Healthy' };
  if (score >= 6)               return { glyph: '🟡', label: 'Building / caution' };
  return { glyph: '🔵', label: 'Context only' };
}
function sectionEnergy(avg) {
  if (avg >= 8)    return { glyph: '🟢', text: 'Section is healthy — multiple candidates carrying weight in the same direction.' };
  if (avg >= 6.5)  return { glyph: '🟡', text: 'Section is building — pressure is visible but acceptance has not landed yet.' };
  if (avg >= 5)    return { glyph: '🟠', text: 'Section is late or thinly supported — activity present, quality reduced.' };
  if (avg > 0)     return { glyph: '🔵', text: 'Section is context only — readings present but no candidate is asking for promotion.' };
  return             { glyph: '⚪', text: 'Section is quiet — no active candidates this cycle.' };
}

// ── Per-candidate operational sentences (the FOH 7 questions) ─
function _dirWord(r, bull, bear, neutral) {
  const dir = String(r && r.direction || '').toLowerCase();
  if (dir === 'bullish') return bull;
  if (dir === 'bearish') return bear;
  return neutral;
}
function whatHappenedSentence(r) {
  const sym = r.symbol;
  const speed = Number.isFinite(r.moveSpeed) ? r.moveSpeed : null;
  const paceClause = speed != null ? ' (' + speed + '× the prior-bar average)' : '';
  return _dirWord(r,
    sym + ' is pushing higher with above-average pace' + paceClause + '; the move is ' + phasePhrase(r.movePhase) + '.',
    sym + ' is sliding lower with above-average pace' + paceClause + '; the move is ' + phasePhrase(r.movePhase) + '.',
    sym + ' is moving with above-average pace but without a clear directional commitment yet; the move is ' + phasePhrase(r.movePhase) + '.'
  );
}
function whereItMattersSentence(r) {
  // Use partial 1D evidence anchors when available (the only level
  // wired through the ranking pipeline today); otherwise issue an
  // honest pending note. Never invent a number.
  const ev = r.evidenceAnchors || null;
  if (ev && ev.availability !== 'pending') {
    const dir = String(r.direction || '').toLowerCase();
    const ref = dir === 'bearish' ? ev.recentLow : ev.recentHigh;
    if (ref && ref.priceText) {
      const word = dir === 'bearish' ? 'low' : 'high';
      return 'The decision lives at the recent ' + (ev.timeframeAvailable || '1D')
        + ' ' + word + ' area near ' + ref.priceText
        + ' — that is the next reference area ATLAS is measuring acceptance against.';
    }
  }
  return 'The decision lives at the next active reference area on the same timeframe — the precise level for this cycle is pending intraday-anchor wiring; ATLAS will not invent a number it cannot point to.';
}
function whyItMattersSentence(r) {
  const sec = r.sectionLabel || 'this section';
  return _dirWord(r,
    'It matters because ' + sec + ' lifting with this much pace can pull related markets with it — and because the next real decision sits at the next reference area, not at the current candle.',
    'It matters because ' + sec + ' weakness moving at this pace can drag related markets along — and because the next real decision sits at the next reference area, not at the current candle.',
    'It matters because ' + sec + ' is moving with energy ahead of structure — the next real decision sits at the next reference area, not at the current candle.'
  );
}
function changesOnAcceptanceSentence(r) {
  return _dirWord(r,
    'If price reaches the next reference area and stays there without being immediately pushed back down, the read upgrades from raw movement to structural continuation — that is the moment quality improves.',
    'If price reaches the next reference area and stays there without being immediately lifted back up, the read upgrades from raw movement to structural continuation — that is the moment quality improves.',
    'If price reaches the next reference area and commits to one side without being immediately reversed, the read upgrades from raw movement to structural continuation.'
  );
}
function dangerOnRejectionSentence(r) {
  return _dirWord(r,
    'If price tags the area and is sharply rejected back down, this move becomes a late chase rather than a fresh upgrade — reversal risk rises quickly and the easy side flips.',
    'If price tags the area and is sharply rejected back up, this move becomes a late chase rather than a fresh downgrade — short-side reversal risk rises quickly and the easy side flips.',
    'If price tags the area and is sharply reversed, this move becomes a late chase rather than a structural read.'
  );
}
function invalidationSentence(r) {
  return _dirWord(r,
    'The bullish read is voided if price returns through the prior support area and stays below it on the same timeframe — that turns continuation into failure and the idea is off until a fresh structure forms.',
    'The bearish read is voided if price returns through the prior resistance area and stays above it on the same timeframe — that turns continuation into failure and the idea is off until a fresh structure forms.',
    'The read is voided if price returns through the recent reference area and remains on the opposite side on the same timeframe — the idea is off until a fresh structure forms.'
  );
}
function whatAtlasNeedsNextSentence(r) {
  return _dirWord(r,
    'ATLAS needs to see price reach the next reference area, pause there without an immediate sharp rejection, and then carry on higher with steady (not explosive) participation.',
    'ATLAS needs to see price reach the next reference area, pause there without an immediate sharp recovery, and then carry on lower with steady (not explosive) participation.',
    'ATLAS needs to see price reach the next reference area and commit to one side with steady participation before the read upgrades.'
  );
}
function traderGuidanceLines(r) {
  // Advisory wording only — no directive language.
  const lines = ['Monitor only — proof has not landed yet.'];
  const lr = String(r.lateEntryRisk || '').toLowerCase();
  if (lr.includes('elev') || lr.includes('high')) {
    lines.push('Do not chase the move while proof is missing; late entries here carry elevated reversal risk.');
  } else if (lr.includes('mid')) {
    lines.push('A cleaner opportunity forms only if price accepts the next area and does not immediately reverse.');
  } else {
    lines.push('A cleaner opportunity forms only if price accepts the next reference and behaviour remains steady, not frantic.');
  }
  return lines.map(s => '• ' + s);
}

// ── Universal Reference Doctrine — honest pending fallback ───
function universalReferenceLines(r) {
  // The ranking pipeline currently wires 1D-bar partial anchors
  // only. Intraday (1H / 15m / 5m) timestamp trail is staged
  // pending wiring. We surface what exists; otherwise issue the
  // doctrine-mandated unavailable note.
  const ev = r.evidenceAnchors || null;
  const lines = ['_Replay reference:_'];
  if (ev && ev.availability === 'partial') {
    lines.push(
      '• Timeframe wired: ' + (ev.timeframeAvailable || '1D')
      + ' bar context (intraday timestamp trail pending).'
    );
    lines.push('• Study guidance: open the ' + (ev.timeframeAvailable || '1D')
      + ' chart, locate the most recent reference area, and watch how the next candle behaves on the visit.');
  } else {
    lines.push('• Replay reference unavailable in this scan packet (1H / 15m / 5m anchor extraction pending wiring).');
    lines.push('• Study guidance: until intraday anchors land, treat the candidate card as an attention signal, not a level-by-level replay.');
  }
  return lines;
}

// ── Candidate card (FOH) ─────────────────────────────────────
function buildCandidateCard(r, idx, isStandout) {
  const star = isStandout ? '⭐ ' : '';
  const zone = zoneCueFor(r);
  const arrow = String(r.direction || '').toLowerCase() === 'bullish' ? '↑'
              : String(r.direction || '').toLowerCase() === 'bearish' ? '↓'
              : '→';

  const header = '**' + star + '#' + (idx + 1) + ' — ' + r.symbol + ' ' + arrow + '**  ·  '
    + (r.sectionLabel || 'Section pending')
    + '  ·  ' + zone.glyph + ' ' + zone.label;

  const identity = [
    '_Identity:_',
    '• Direction: ' + (r.direction || 'neutral'),
    '• Score: ' + (Number.isFinite(r.score) ? r.score : '?') + '/10',
    '• Move phase: ' + phasePhrase(r.movePhase),
    '• Late-entry risk: ' + (r.lateEntryRisk || 'reading pending'),
    '• Move speed: ' + (Number.isFinite(r.moveSpeed) ? r.moveSpeed + '× the prior-bar average' : 'speed reading pending'),
    '• Relative strength vs section: ' + (r.relativeStrength != null ? r.relativeStrength + '× section average' : 'reading pending'),
  ].join('\n');

  const lines = [
    header,
    '',
    identity,
    '',
    '_What happened:_',
    whatHappenedSentence(r),
    '',
    '_Where it matters:_',
    whereItMattersSentence(r),
    '',
    '_Why ATLAS is watching:_',
    whyItMattersSentence(r),
    '',
    '🟢 _Healthy zone:_ ' + changesOnAcceptanceSentence(r),
    '🟡 _Caution zone:_ ' + lateRiskPhrase(r.lateEntryRisk),
    '🟠 _Danger zone:_ ' + dangerOnRejectionSentence(r),
    '🔴 _Invalidation:_ ' + invalidationSentence(r),
    '',
    '_What ATLAS needs next:_',
    whatAtlasNeedsNextSentence(r),
    '',
    '_Trader guidance (advisory only):_',
    traderGuidanceLines(r).join('\n'),
    '',
    universalReferenceLines(r).join('\n'),
  ];
  return lines.join('\n');
}

// ── Section radar block (FOH) ────────────────────────────────
function buildSectionRadar(sectionKey, rows, sectionAvg) {
  const r = _rank();
  const label = r.SECTION_LABEL[sectionKey] || sectionKey;
  const energy = sectionEnergy(sectionAvg);
  const sorted = rows.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const strongest = sorted[0] || null;
  const weakest   = sorted.length > 1 ? sorted[sorted.length - 1] : null;
  const intent = sorted.length === 0
    ? 'No active candidates — this section is on the bench this cycle.'
    : (sorted[0].score >= 8
        ? 'The section is trying to make the handoff from movement to structure — at least one candidate is at the publication threshold.'
        : 'The section is trying to build pressure toward the publication threshold — candidates are visible but none have earned promotion yet.');
  const lines = [
    '### ' + energy.glyph + ' ' + label,
    '',
    '_Section energy:_ ' + energy.text,
    '_Average score in this section:_ ' + sectionAvg.toFixed(1) + '/10 across ' + sorted.length + ' candidate' + (sorted.length === 1 ? '' : 's') + '.',
  ];
  if (strongest) {
    lines.push('_Strongest active:_ ' + strongest.symbol + ' (' + (strongest.score || 0) + '/10, ' + phasePhrase(strongest.movePhase) + ').');
  }
  if (weakest && weakest !== strongest) {
    lines.push('_Weakest active:_ ' + weakest.symbol + ' (' + (weakest.score || 0) + '/10, ' + phasePhrase(weakest.movePhase) + ').');
  }
  lines.push('_What this section is trying to do:_ ' + intent);
  if (sorted.length && sorted[0].score < 8) {
    lines.push('_Why it has not earned promotion:_ acceptance at the next reference area has not landed yet — the section is asking for proof, not awarding it.');
  } else if (sorted.length && sorted[0].score >= 8) {
    lines.push('_Why this section earned a publication-grade reading:_ at least one candidate is carrying both pace and structural weight in the same direction.');
  }
  return lines.join('\n');
}

// ── Global market read (operational replacement) ─────────────
function buildGlobalRead(ctx) {
  const { volatility, internalCount, ignoredCount, universeSize, top10Count } = ctx;
  const lvl = String((volatility && volatility.level) || '').toLowerCase();
  const lines = [
    '### 🌐 Global market read',
    '',
    atmosphereFor(lvl),
  ];
  // Concentration sentence
  if (top10Count >= 1) {
    lines.push('Activity is concentrated where the section radar below is lit — those are the only areas currently asking for closer attention.');
  } else if (internalCount > 0) {
    lines.push('Activity is scattered — candidates are visible across the near-threshold band but none are concentrated in a single section yet.');
  } else {
    lines.push('Activity is sparse — the universe is moving without obvious concentration in any one section.');
  }
  // Why not promoting yet
  if (top10Count === 0) {
    lines.push('ATLAS is not promoting candidates yet because the move-to-structure handoff has not completed: speed is present, but the next reference area has not been tested and accepted.');
  } else {
    lines.push('ATLAS is tracking ' + top10Count + ' developing standout' + (top10Count === 1 ? '' : 's') + ' below — none have produced confirmed acceptance, so they are surfaced as monitoring candidates only.');
  }
  // What needs to change
  lines.push('What needs to change before the next scan: at least one candidate must reach the next reference area, pause there without being immediately reversed, and continue with steady participation.');
  // What traders should not do prematurely
  lines.push('What traders should not do prematurely: chase the current candle, treat raw speed as acceptance, or assume the next reference will be respected before it is even tested.');
  // Coverage counts
  lines.push('Universe scanned this cycle: ' + universeSize + ' symbols · near-threshold (5–7): ' + internalCount + ' · below near-threshold: ' + ignoredCount + '.');
  return lines.join('\n');
}

// ── Watch / near-threshold explanation (FOH) ─────────────────
function buildWatchExplanation(ctx) {
  const { top10Count, internalCount } = ctx;
  const lines = ['### ⏳ Why ATLAS is not promoting yet'];
  lines.push('');
  if (top10Count === 0 && internalCount === 0) {
    lines.push('The current universe is too quiet to support promotion. Without pressure, ATLAS has nothing to fail or pass — the next useful read is at the next scan.');
  } else if (top10Count === 0) {
    lines.push('Candidates are visible in the near-threshold band, but none have cleared the publication bar. The missing piece is acceptance: price has moved, but it has not yet been tested at the next reference area and held there.');
  } else {
    lines.push('Developing standouts are surfaced below, but they are monitoring candidates — not confirmed setups. The missing piece is acceptance: each candidate is asking for the next reference area to be tested and held, and that test has not yet happened.');
  }
  lines.push('What price must prove: that the next reference area is more than a passing tag — it must be reached, paused at, and walked through with steady participation rather than reversed on contact.');
  lines.push('What failure looks like: a sharp rejection on contact, an immediate return through the prior reference, or expansion that decays into noise.');
  lines.push('What a safer trader should wait to see: acceptance first, then continuation in a normal-paced second leg — not the first impulsive bar.');
  lines.push('Why chasing now is lower quality: most of the easy distance is already in the price, and the next move depends on a test that has not occurred yet — entering ahead of that test means trading the assumption, not the evidence.');
  return lines.join('\n');
}

// ── Avoided-risk attribution ─────────────────────────────────
function buildAvoidedRisk(ctx) {
  const lines = ['### 🛡️ What ATLAS avoided by not promoting'];
  lines.push('');
  lines.push('ATLAS held back from promoting late momentum into mixed structure. That matters because these are exactly the conditions where traders often add risk into the final candle of an impulse and then absorb the mean-reversion that follows.');
  lines.push('By staying in monitoring mode, ATLAS leaves the next decision to fresh evidence at the next reference area — the cost of patience here is small, and the cost of impatience is the standard late-entry reversal.');
  return lines.join('\n');
}

// ── Operator note (behavioural) ──────────────────────────────
function buildOperatorNote(ctx) {
  const { top10Count, internalCount } = ctx;
  const lines = ['### 🎙️ Operator note'];
  lines.push('');
  if (top10Count === 0 && internalCount === 0) {
    lines.push('Operator note: this is a wait-and-watch market, not a chase market. Quiet conditions reward patience; the next useful read arrives at the next scan, not in the current candle.');
  } else if (top10Count === 0) {
    lines.push('Operator note: this is a watchful market, not a chase market. Energy is present, but the clean handoff from movement to structure has not completed — that is the read.');
  } else {
    lines.push('Operator note: developing standouts are visible, but they are still asking for proof. Treat them as attention signals, not setups — the next decision lives at the next reference area, not at the current candle.');
  }
  return lines.join('\n');
}

// ── Terminology row (plain text — no fake links) ─────────────
function buildTerminologyRow(learningLinks) {
  // If darkHorseRanking's learning-links wiring has real URLs
  // (status === 'partial' on existing wiring), use the rendered
  // row as-is — it already gates Markdown links to keyed terms.
  // Otherwise fall back to a single plain teal-style row with no
  // hyperlinks so we never publish a dead/fake URL.
  if (learningLinks && learningLinks.linkRoutingStatus === 'partial' && typeof learningLinks.text === 'string') {
    return learningLinks.text;
  }
  return '🟦 _Expanded terminology:_ structure acceptance · structure rejection · late-entry risk · continuation window · reference area · monitoring vs publication-grade.';
}

// ── Universe coverage (FOH-styled) ───────────────────────────
function buildUniverseCoverage(ctx) {
  const { ranking, universeSize, internalCount, ignoredCount, sectionAvgs } = ctx;
  const top10 = (ranking && ranking.top10) || [];
  const atThreshold = top10.filter(r => (r.score || 0) >= 8).length;
  // Strongest / weakest sections by avg
  const entries = Object.entries(sectionAvgs || {});
  entries.sort((a, b) => b[1] - a[1]);
  const r = _rank();
  const strongest = entries[0] ? r.SECTION_LABEL[entries[0][0]] + ' (avg ' + entries[0][1].toFixed(1) + '/10)' : 'pending';
  const weakest   = entries.length > 1 ? r.SECTION_LABEL[entries[entries.length - 1][0]] + ' (avg ' + entries[entries.length - 1][1].toFixed(1) + '/10)' : 'pending';
  const volConcentration = entries.length === 0 ? 'quiet across sections'
    : (entries[0][1] - (entries[entries.length - 1][1] || 0)) > 2
      ? 'concentrated in ' + r.SECTION_LABEL[entries[0][0]]
      : 'broad across sections';
  const lines = [
    '### 📊 Universe coverage',
    '',
    '_Scanned this cycle:_ ' + universeSize + ' symbols.',
    '_Below near-threshold (score < 5/10):_ ' + ignoredCount + '.',
    '_Near-threshold (score 5–7/10):_ ' + internalCount + '.',
    '_At publication threshold (score ≥ 8/10):_ ' + atThreshold + '.',
    '_Strongest section:_ ' + strongest + '.',
    '_Weakest active section:_ ' + weakest + '.',
    '_Volatility concentration:_ ' + volConcentration + '.',
  ];
  return lines.join('\n');
}

// ── Closing block (next-review + monitoring guidance) ────────
function buildClosingBlock(ctx) {
  const { nextReview, top10Count } = ctx;
  const lines = [
    '### 🔚 Next review',
    '',
    '_Next review:_ ' + nextReview + '.',
    '_Current action state:_ ' + (top10Count === 0
      ? 'Monitoring only — publication threshold not met this cycle.'
      : 'Monitoring only — developing standouts surfaced, but no confirmed publication-grade setup yet.'),
    '_What could change by the next scan:_ a candidate could reach its next reference area, hold there without immediate reversal, and continue with steady participation — that is the upgrade path.',
    '_Single monitoring sentence:_ ATLAS remains in monitoring mode; the next upgrade requires price to accept the active reference area without immediate rejection, otherwise the move stays vulnerable to late-stage reversal.',
  ];
  return lines.join('\n');
}

// ── Atmosphere / header banner ───────────────────────────────
function buildAtmosphereBanner(ctx) {
  const { nowMs, volatility, top10Count, internalCount, ignoredCount, universeSize } = ctx;
  const lvl = ((volatility && volatility.level) || 'reading pending');
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

// ── NEW / CURRENT separator (Discord-safe) ───────────────────
function buildNewSeparator(label) {
  const safeLabel = label || 'CURRENT LIVE READ';
  return '━━━━━━━━━━ 🔴 ' + safeLabel + ' ━━━━━━━━━━';
}

// ============================================================
// MAIN ENTRY — buildFohMovementDigestPayload
//
// Contract matches the legacy buildRankedMovementDigestPayload:
//   in:  (ranking, volatility, opts)
//   out: { content, kind, linkRoutingStatus, firstChunkPrefix }
//
// `ranking` shape:
//   { top10: [enriched candidate], sectionsScanned: [section keys],
//     sectionCapsApplied: [...], allCount: number }
// `opts` shape (passed through from the engine):
//   { internal, ignored, universeSize, now, intervalMs,
//     learningLinkUrls }
// ============================================================
function buildFohMovementDigestPayload(ranking, volatility, opts) {
  opts = opts || {};
  const r = _rank();
  const top = Array.isArray(ranking && ranking.top10) ? ranking.top10 : [];
  const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
  const internalArr = Array.isArray(opts.internal) ? opts.internal : [];
  const ignoredArr  = Array.isArray(opts.ignored)  ? opts.ignored  : [];
  const universeSize = Number.isFinite(opts.universeSize) ? opts.universeSize : (top.length + internalArr.length + ignoredArr.length);

  // Standouts — keep the existing comparator so the visible ⭐
  // surface matches the legacy promotion logic exactly.
  const standoutSet = new Set(r.selectStandouts(top, 2).map(s => s.symbol));

  // Group top10 by section, capped at 2 per section.
  const bySection = {};
  for (const row of top) {
    if (!bySection[row.section]) bySection[row.section] = [];
    bySection[row.section].push(row);
  }
  for (const sec of Object.keys(bySection)) bySection[sec] = bySection[sec].slice(0, 2);

  // Per-section averages from the FULL ranking universe (top10 +
  // near-threshold internal). This is presentation-only — no
  // scoring change.
  const sectionAvgs = r.perSectionAvgScores([...top, ...internalArr]);

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
    nextReview: r.nextReviewLine(opts.now, opts.intervalMs),
  };

  // Learning-link routing — preserved from legacy so callers that
  // pass opts.learningLinkUrls still get partial Markdown wiring.
  const learningLinks = r.buildLearningLinksBlock(opts.learningLinkUrls);

  // Section blocks in canonical order.
  const sectionBlocks = [];
  for (const sec of r.SECTION_DISPLAY_ORDER) {
    const rows = bySection[sec] || [];
    if (!rows.length) continue;
    const avg = Number.isFinite(sectionAvgs[sec]) ? sectionAvgs[sec] : 0;
    sectionBlocks.push(buildSectionRadar(sec, rows, avg));
  }

  // Candidate cards in canonical section order.
  let displayIdx = 0;
  const cards = [];
  for (const sec of r.SECTION_DISPLAY_ORDER) {
    const rows = bySection[sec] || [];
    for (const row of rows) {
      const isStandout = standoutSet.has(row.symbol);
      cards.push(buildCandidateCard(row, displayIdx, isStandout));
      displayIdx += 1;
    }
  }

  // Pre-Radar / Near-Miss / Universe-coverage helpers — the
  // existing selectors are reused unchanged. Presentation only.
  const preRadar  = r.selectPreRadarCandidates(internalArr);
  const nearMiss  = r.selectNearMissCandidates(internalArr);

  const blocks = [];

  // 1 — Atmosphere banner
  blocks.push(buildAtmosphereBanner(ctx));

  // 2 — Red NEW / CURRENT separator (state tracking unavailable;
  // safe fallback per directive § 2).
  blocks.push(buildNewSeparator('CURRENT LIVE READ'));

  // 3 — Global market read
  blocks.push(buildGlobalRead(ctx));

  // Terminology row (operator directive § 10 — plain text only
  // when URL map is absent; rendered before sections so the row
  // sits near the top per Discord scroll-readability).
  blocks.push(buildTerminologyRow(learningLinks));

  // 4 — Section radar blocks (only when at least one section is
  // active; otherwise skip and rely on supporting blocks)
  if (sectionBlocks.length) {
    blocks.push(buildNewSeparator('SECTION RADAR'));
    blocks.push(sectionBlocks.join('\n\n'));
  }

  // 5 — Candidate cards
  if (cards.length) {
    blocks.push(buildNewSeparator('CANDIDATE CARDS'));
    blocks.push(cards.join('\n\n──\n\n'));
  }

  // Pre-Radar / Near-Miss in operational FOH wording — reuse the
  // existing block builders (presentation already operational).
  const preRadarBlock = r.buildPreRadarBlock(preRadar);
  const nearMissBlock = r.buildNearMissBlock(nearMiss);
  if (preRadarBlock || nearMissBlock) {
    blocks.push(buildNewSeparator('SUPPORTING INTELLIGENCE'));
    if (preRadarBlock) blocks.push(preRadarBlock);
    if (nearMissBlock) blocks.push(nearMissBlock);
  }

  // 6 — Watch / near-threshold explanation (FOH)
  blocks.push(buildWatchExplanation(ctx));

  // 7 — Avoided-risk attribution (always present when no
  // publication-grade promotion fired)
  if (ctx.atThresholdCount === 0) {
    blocks.push(buildAvoidedRisk(ctx));
  }

  // 8 — Operator note
  blocks.push(buildOperatorNote(ctx));

  // 11 — Universe coverage
  blocks.push(buildUniverseCoverage(ctx));

  // 12 — Closing block (next review / current action state)
  blocks.push(buildClosingBlock(ctx));

  // Final disclaimer — advisory wording only.
  blocks.push(
    '⚠️ Advisory only — ATLAS surfaces conditions and reference areas; '
    + 'it does not issue trading directives. Late-entry risk varies '
    + 'by phase per candidate; reassess against the per-candidate criteria '
    + 'at the next scan.'
  );

  const content = blocks.join('\n\n');

  // First-chunk prefix — preserved from the legacy renderer so the
  // 4-line NEW SCAN boundary still sits above Part 1's label only.
  const firstChunkPrefix = r.buildNewScanBoundary(opts.now);

  return {
    content,
    kind: 'movement_digest_v1_2_foh',
    linkRoutingStatus: learningLinks.linkRoutingStatus,
    firstChunkPrefix,
  };
}

module.exports = {
  buildFohMovementDigestPayload,
  // Helpers exported for the qa harness so individual sections can
  // be unit-tested without driving the full digest path.
  atmosphereFor,
  phasePhrase,
  lateRiskPhrase,
  zoneCueFor,
  sectionEnergy,
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
  universalReferenceLines,
  fmtUtcStamp,
  fmtAwstStamp,
};
