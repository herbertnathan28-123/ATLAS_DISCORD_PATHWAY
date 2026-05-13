'use strict';

// ============================================================
// DARK HORSE — FOH SEMANTIC TRANSLATION LAYER
//
// Operator directive 2026-05-13. Sits between the raw candidate
// engine output (scoring + ranking maths, untouched) and the
// FOH live formatter (layout + section assembly). Converts
// engine telemetry into human operational narration so the live
// Discord digest stops sounding like trader shorthand.
//
// Strict scope (locked):
//   - Voice / narration only.
//   - Does NOT touch Corey, Jane, Spidey, Macro, scoring,
//     ranking maths, thresholds, scheduler cadence, webhook
//     transport, cooldown, the symbol universe, or candidate
//     selection.
//   - Does NOT fabricate replay metadata. Where backward-looking
//     anchors are unavailable, the Universal Reference Doctrine
//     fallback is used.
//
// Voice rules:
//   - Plain English. No "HH/HL", "5m/15m body close", "retest
//     holds", "confirmed higher-timeframe close", "promotion
//     trigger", "window narrowing", "late-entry risk
//     moderate-to-high", "awaiting confirmation criteria",
//     "structure 2/2", etc.
//   - Every major statement answers the FOH consequence trail:
//     what happened / why it matters / what changes next / what
//     becomes dangerous / what invalidates / what to monitor.
//   - Advisory wording only — never directive language, no
//     "buy now" / "must sell" / "guaranteed" phrasing, and the
//     legacy banned vocabulary ("permission" etc.) stays off
//     the live surface too.
//   - Behavioural narration is welcome ("this is the type of
//     environment where …"), but professional, not joke-style.
// ============================================================

// ── Direction / arrow / verb helpers ─────────────────────────
function arrowFor(direction) {
  const d = String(direction || '').toLowerCase();
  if (d === 'bullish') return '↑';
  if (d === 'bearish') return '↓';
  return '→';
}
function directionVerb(direction) {
  const d = String(direction || '').toLowerCase();
  if (d === 'bullish') return 'lifting';
  if (d === 'bearish') return 'sliding';
  return 'drifting';
}
function directionWord(direction) {
  const d = String(direction || '').toLowerCase();
  if (d === 'bullish') return 'higher';
  if (d === 'bearish') return 'lower';
  return 'sideways';
}

// ── Phase translation ────────────────────────────────────────
// Replaces "phase: mid-stage — the trend is established but
// not yet stretched" with an operational sentence focused on
// what that means for participation quality.
function translatePhase(phase) {
  switch (String(phase || '').toLowerCase()) {
    case 'early':
      return {
        plain: 'early — the move still has runway, and most of the safer participation has not yet been spent',
        risk: 'low',
        terse: 'early',
      };
    case 'mid':
      return {
        plain: 'mid — the move is established, working in the trader\'s favour, but not yet rich enough to attract late chasing',
        risk: 'moderate',
        terse: 'mid',
      };
    case 'late':
      return {
        plain: 'late — most of the easy distance is already in the price, and any new participation is buying lower-quality real estate',
        risk: 'elevated',
        terse: 'late',
      };
    case 'exhaustion':
      return {
        plain: 'exhausted — the move has stretched past its natural participation zone and is increasingly vulnerable to a sharp mean-reverting response',
        risk: 'high',
        terse: 'exhausted',
      };
    default:
      return {
        plain: 'phase reading still developing — ATLAS does not yet have enough rhythm to classify the move',
        risk: 'unknown',
        terse: 'pending',
      };
  }
}

// ── Late-entry risk translation ──────────────────────────────
// Replaces "moderate-to-high" / "low-to-moderate" with a
// consequence sentence about what entering now actually costs
// the participant in operational terms.
function translateLateEntryRisk(risk, phase) {
  const r = String(risk || '').toLowerCase();
  if (r.includes('high')) {
    return {
      plain: 'Entering now means buying the move after most of the visible expansion has already paid out. The next pullback area becomes the deciding moment — if buyers fail to defend it, reversal pressure can build quickly.',
      glyph: '🟠',
      tone: 'elevated',
    };
  }
  if (r.includes('moderate') && !r.includes('low')) {
    return {
      plain: 'Entering now is closer to chasing than positioning. The move has worked enough that fresh participation depends on the next reference area being respected — not on the current candle.',
      glyph: '🟠',
      tone: 'moderate-to-elevated',
    };
  }
  if (r.includes('low-to-moderate') || (r.includes('low') && r.includes('moderate'))) {
    return {
      plain: 'Entering at the next clean reference is still reasonable. The move has worked, but enough structure remains that participation does not yet feel like late chasing.',
      glyph: '🟡',
      tone: 'building',
    };
  }
  if (r.includes('low')) {
    return {
      plain: 'Entering at the next clean reference still has meaningful runway. The move has not yet asked late participants to pay a premium.',
      glyph: '🟢',
      tone: 'healthy',
    };
  }
  // Fallback / unknown
  if (String(phase || '').toLowerCase() === 'exhaustion') {
    return {
      plain: 'Entering now carries elevated reversal risk — the move has already stretched past its natural participation zone.',
      glyph: '🟠',
      tone: 'elevated',
    };
  }
  return {
    plain: 'Late-entry quality is still developing — ATLAS does not yet have a clean read on how much room is left in the move.',
    glyph: '🔵',
    tone: 'pending',
  };
}

// ── Move-speed translation ───────────────────────────────────
// Replaces "× baseline" / raw multipliers with a participation
// sentence focused on what that pace means at the desk.
function translateMoveSpeed(speed) {
  if (!Number.isFinite(speed)) {
    return 'pace reading still developing — ATLAS is waiting for enough bars to compute a clean comparison';
  }
  if (speed >= 1.8) {
    return 'pace is running well above the recent average; this kind of expansion attracts reactive participation but also magnifies the size of the next pullback';
  }
  if (speed >= 1.3) {
    return 'pace is meaningfully above the recent average — fast enough to read as conviction, not fast enough to feel parabolic';
  }
  if (speed >= 1.1) {
    return 'pace is modestly above the recent average — present but not aggressive';
  }
  return 'pace is broadly in line with the recent average — the move is working, but without obvious extra fuel';
}

// ── Relative strength translation ────────────────────────────
function translateRelativeStrength(rs, section) {
  if (!Number.isFinite(rs)) {
    return 'relative strength against the section is still developing — ATLAS does not yet have enough peer activity to compare cleanly';
  }
  if (rs >= 1.4) {
    return 'this name is meaningfully outpacing the rest of ' + (section || 'its section')
      + ' — when one symbol carries this much extra weight, it often telegraphs where conviction sits';
  }
  if (rs >= 1.1) {
    return 'this name is modestly outpacing ' + (section || 'its section') + ' — present leadership, not dominance';
  }
  if (rs >= 0.9) {
    return 'this name is moving roughly in line with ' + (section || 'its section') + ' — no obvious leadership advantage';
  }
  return 'this name is lagging ' + (section || 'its section') + ' — the broader peer group is doing more work';
}

// ── Section / atmosphere translation ─────────────────────────
function translateAtmosphere(volLevel) {
  const lvl = String(volLevel || '').toLowerCase();
  if (lvl === 'quiet') {
    return 'Market energy is subdued. Liquidity is thin and conviction is low, which means individual moves can feel larger than the catalyst behind them — chasing the first impulse is usually the wrong instinct in this regime.';
  }
  if (lvl === 'elevated') {
    return 'Market energy is elevated. Real movement is present across the universe, but the strongest waves have not yet asked the market to prove acceptance — the handoff from raw speed to clean structure is still pending.';
  }
  if (lvl === 'extreme') {
    return 'Market energy is at an extreme. Range is expanding faster than structure can settle; participation is broad but unstable, and late-stage reversals become more likely as the move runs out of fresh fuel.';
  }
  return 'Market energy reading is still developing this cycle — ATLAS is treating the regime as undefined until the next scan.';
}
function translateSectionEnergy(avg, count) {
  if (!Number.isFinite(avg) || count === 0) {
    return { glyph: '⚪', text: 'Section is quiet — no active candidates this cycle, which is itself information: this is not where the market is currently asking for attention.' };
  }
  if (avg >= 8) {
    return { glyph: '🟢', text: 'Section is healthy — multiple candidates are carrying weight in the same direction. When a section moves together, the read upgrades from individual story to thematic conviction.' };
  }
  if (avg >= 6.5) {
    return { glyph: '🟡', text: 'Section is building — pressure is visible but the cleanest acceptance has not landed yet. The section is asking for proof, not granting it.' };
  }
  if (avg >= 5) {
    return { glyph: '🟠', text: 'Section is late or thinly supported — activity is present, but the quality of that activity is reduced. Participation here costs more than it pays in most cycles.' };
  }
  return { glyph: '🔵', text: 'Section is context only — readings are present but no candidate is asking for promotion. Useful as background, not as the basis for action.' };
}

// ── Score → publication-state narration ──────────────────────
function translatePublicationState(score, watchThreshold) {
  const th = Number.isFinite(watchThreshold) ? watchThreshold : 8;
  if (!Number.isFinite(score)) {
    return 'Publication state is still developing — ATLAS does not yet have a confident read on whether this should be surfaced.';
  }
  if (score >= th) {
    return 'This candidate has cleared ATLAS\'s publication bar this cycle. That does not mean act now — it means the read is strong enough to be surfaced to the operator surface for monitoring.';
  }
  const gap = th - score;
  if (gap === 1) {
    return 'This candidate is one quality step below publication-grade. Momentum is active enough to keep the symbol on ATLAS\'s internal radar, but not strong enough yet to justify publication-grade attention.';
  }
  return 'This candidate is well below publication-grade. It is on the internal radar so the surrounding read can be tracked, but it is not asking for closer attention this cycle.';
}

// ── Per-card FOH narration (the 7 questions) ─────────────────
// These produce the actual sentences the formatter renders. The
// formatter must NOT paste raw engine fields like
// `r.structureState` or `r.lateEntryRisk` directly — it must go
// through the helpers below so the live surface speaks one voice.
function narrateWhatHappened(r) {
  const verb = directionVerb(r.direction);
  const dirWord = directionWord(r.direction);
  const sym = r.symbol;
  const pace = translateMoveSpeed(r.moveSpeed);
  const phase = translatePhase(r.movePhase).plain;
  return (
    sym + ' continues to push ' + dirWord + '. '
    + sym + ' is ' + verb + ' — ' + pace + '. '
    + 'In phase terms, the move is ' + phase + '.'
  );
}
function narrateWhereItMatters(r) {
  // Use partial 1D evidence anchors when available; never invent.
  const ev = r.evidenceAnchors || null;
  if (ev && ev.availability !== 'pending') {
    const dir = String(r.direction || '').toLowerCase();
    const ref = dir === 'bearish' ? ev.recentLow : ev.recentHigh;
    if (ref && ref.priceText) {
      const word = dir === 'bearish' ? 'low' : 'high';
      const tfLine = ev.timeframeAvailable || '1D';
      return (
        'The decision lives at the recent ' + tfLine + ' ' + word + ' area near ' + ref.priceText + '. '
        + 'That is the area the market will use to decide whether this is the start of a new structural leg or the last candle before participants give back what they made.'
      );
    }
  }
  return 'The decision lives at the next active reference area on the same timeframe. The precise level for this cycle is still being wired from the intraday anchors — ATLAS will not invent a number it cannot point to.';
}
function narrateWhyAtlasCares(r, ctx) {
  const sec = r.sectionLabel || 'this section';
  const dirNote = String(r.direction || '').toLowerCase() === 'bearish'
    ? 'weakness moving at this pace through ' + sec + ' can drag related markets along'
    : String(r.direction || '').toLowerCase() === 'bullish'
      ? 'strength moving at this pace through ' + sec + ' can lift related markets with it'
      : 'energy moving through ' + sec + ' without a clear directional commitment shows up first as instability';
  const pubState = translatePublicationState(r.score, ctx && ctx.watchThreshold);
  return dirNote + '. ' + pubState;
}
function narrateHealthyZone(r) {
  const dir = String(r.direction || '').toLowerCase();
  if (dir === 'bullish') {
    return 'If price reaches the next reference area and stays there without being immediately rejected lower, the read upgrades from raw movement to structural continuation. That is the moment quality improves and chasing becomes positioning.';
  }
  if (dir === 'bearish') {
    return 'If price reaches the next reference area and stays there without being immediately rejected higher, the read upgrades from raw movement to structural continuation. That is the moment quality improves and chasing becomes positioning.';
  }
  return 'If price reaches the next reference area and commits to one side without an immediate reversal, the read upgrades from raw movement to structural continuation.';
}
function narrateCautionZone(r) {
  const late = translateLateEntryRisk(r.lateEntryRisk, r.movePhase);
  return late.plain;
}
function narrateDangerZone(r) {
  const dir = String(r.direction || '').toLowerCase();
  if (dir === 'bullish') {
    return 'If price tags the next area and is sharply rejected back down, this move becomes a late chase rather than a fresh upgrade. The easy side flips quickly, and reversal pressure tends to build on the same bar that just rejected.';
  }
  if (dir === 'bearish') {
    return 'If price tags the next area and is sharply rejected back up, this move becomes a late chase rather than a fresh downgrade. The easy side flips quickly, and short-side reversal pressure tends to build on the same bar that just rejected.';
  }
  return 'If price tags the next area and is sharply reversed, this move stops being a structural read and starts being a late chase.';
}
function narrateInvalidation(r) {
  const dir = String(r.direction || '').toLowerCase();
  if (dir === 'bullish') {
    return 'The bullish read is voided if price returns through the prior support area and remains below it on the same timeframe. That turns continuation into failure, and the idea is off until a fresh structure forms — ATLAS will not chase a broken read back into the trade.';
  }
  if (dir === 'bearish') {
    return 'The bearish read is voided if price returns through the prior resistance area and remains above it on the same timeframe. That turns continuation into failure, and the idea is off until a fresh structure forms — ATLAS will not chase a broken read back into the trade.';
  }
  return 'The read is voided if price returns through the recent reference area and remains on the opposite side on the same timeframe. The idea is off until a fresh structure forms.';
}
function narrateWhatAtlasNeedsNext(r) {
  const dir = String(r.direction || '').toLowerCase();
  if (dir === 'bullish') {
    return 'ATLAS still needs to see whether this movement can survive contact with the next decision area without immediately collapsing back into the prior range. The way the first candle behaves on the visit is the read, not the visit itself.';
  }
  if (dir === 'bearish') {
    return 'ATLAS still needs to see whether this movement can survive contact with the next decision area without immediately recovering back into the prior range. The way the first candle behaves on the visit is the read, not the visit itself.';
  }
  return 'ATLAS still needs to see whether this movement can survive contact with the next decision area and commit to one side. The way price behaves on the visit is the read, not the visit itself.';
}
function narrateTraderGuidance(r) {
  const lines = ['Monitor only — the read has not yet been proven by the market.'];
  const late = translateLateEntryRisk(r.lateEntryRisk, r.movePhase);
  if (late.tone === 'elevated' || late.tone === 'moderate-to-elevated' || late.tone === 'high') {
    lines.push('Avoid adding risk into the current candle while proof is still pending; late entries here pay a premium and absorb the early reversal.');
  } else if (late.tone === 'building') {
    lines.push('A higher-quality opportunity forms only if price accepts the next reference and does not immediately reverse. Until then this is information, not action.');
  } else {
    lines.push('A clean opportunity forms only at the next reference area, and only if behaviour remains steady rather than frantic on the visit.');
  }
  lines.push('No directive is embedded in this card — ATLAS surfaces conditions, the operator decides participation.');
  return lines;
}
function narrateBehaviouralNote(r, ctx) {
  const phase = String(r.movePhase || '').toLowerCase();
  if (phase === 'exhaustion') {
    return 'This is the type of environment where late momentum often attracts reactive participation just before exhaustion appears. The bar that finally rejects is usually the one that drew the most fresh interest in.';
  }
  if (phase === 'late') {
    return 'Late-stage moves still trend, but they trend through a tougher participation environment — the last leg pays less per unit of risk than the first.';
  }
  if (phase === 'early') {
    return 'Early-stage moves often look unconvincing precisely because the easy distance has not yet appeared. The market has not yet given participants a reason to argue with it.';
  }
  if (phase === 'mid') {
    return 'Mid-stage moves are the cleanest part of the cycle — established enough to read, not stretched enough to chase.';
  }
  return 'The move is not yet rhythmic enough to read confidently. That, in itself, is a behavioural signal.';
}
function narrateConsequenceTrail(r) {
  // One-paragraph summary of the consequence chain — what
  // happened / why / what changes next / what becomes dangerous /
  // what invalidates / what to monitor. Compact paragraph for the
  // reader who only scans the card.
  const dir = String(r.direction || '').toLowerCase();
  const article = dir === 'bearish' ? 'a downward' : dir === 'bullish' ? 'an upward' : 'a directional';
  return (
    '_Consequence trail:_ ' + article + ' move is in progress, the next reference area is where the market will decide whether to upgrade it to a structural leg, '
    + 'a sharp rejection on contact turns this into a late chase, a return through the prior reference voids the idea entirely, '
    + 'and the only thing worth monitoring before the next scan is how the very first candle behaves on the visit.'
  );
}
function narrateReplayReference(r) {
  // Universal Reference Doctrine — never invent metadata.
  const ev = r.evidenceAnchors || null;
  const lines = ['_Replay reference (Universal Reference Doctrine):_'];
  if (!ev || ev.availability === 'pending') {
    lines.push('• Replay reference unavailable in this scan packet.');
    lines.push('• Until intraday anchors are wired, treat the card as an attention signal — not a level-by-level replay.');
    return lines;
  }
  lines.push('• Timeframe wired this cycle: ' + (ev.timeframeAvailable || '1D') + ' bar context.');
  // Try to surface a UTC stamp from the partial anchor if available.
  const ref = String(r.direction || '').toLowerCase() === 'bearish' ? ev.recentLow : ev.recentHigh;
  if (ref && ref.dateUtc) {
    lines.push('• Replay anchor (UTC): ' + ref.dateUtc + (ref.dateAwst ? ' / ' + ref.dateAwst + ' AWST' : ''));
  } else {
    lines.push('• Replay anchor: timestamp pending intraday wiring.');
  }
  lines.push('• Study guidance: open the ' + (ev.timeframeAvailable || '1D')
    + ' chart, locate the most recent reference area, and observe how the first candle on the revisit behaves.');
  return lines;
}

// ── Pre-Radar / Near-Miss narration (FOH-native) ─────────────
// These replace the legacy buildPreRadarBlock / buildNearMissBlock
// renderers that surfaced raw `summary` strings and trader
// shorthand. The FOH versions speak the same voice as the cards.
function narratePreRadarRecord(record) {
  const sym = record && record.symbol;
  const dir = arrowFor(record && record.direction);
  const sec = (record && record.sectionLabel) || 'this section';
  const phase = translatePhase(record && record.movePhase);
  const pace = translateMoveSpeed(record && record.moveSpeed);
  const score = Number.isFinite(record && record.score) ? record.score : '?';
  const headLine = '- **' + sym + '** ' + dir + '  ·  ' + sec + '  ·  score ' + score + '/10  ·  ' + phase.terse + ' stage';
  const body = (
    '  ' + sym + ' is showing ' + pace + ', which is enough to keep it on the internal radar this cycle. '
    + 'The next observable proof will be whether price can hold the closest reference area '
    + 'long enough for ATLAS to upgrade the read — until then the symbol is informational only.'
  );
  return [headLine, body].join('\n');
}
function narrateNearMissRecord(record, watchThreshold) {
  const sym = record && record.symbol;
  const dir = arrowFor(record && record.direction);
  const sec = (record && record.sectionLabel) || 'this section';
  const score = Number.isFinite(record && record.score) ? record.score : '?';
  const th = Number.isFinite(watchThreshold) ? watchThreshold : 8;
  const gap = Math.max(0, th - (Number.isFinite(record && record.score) ? record.score : 0));
  const gapText = gap === 1 ? 'one quality step' : (gap + ' quality steps');
  const phase = translatePhase(record && record.movePhase);
  const pace = translateMoveSpeed(record && record.moveSpeed);
  const headLine = '- **' + sym + '** ' + dir + '  ·  ' + sec + '  ·  score ' + score + '/10 (' + gapText + ' below the publication bar)';
  const body = (
    '  ' + sym + ' is ' + pace + ' and the move sits at ' + phase.plain + '. '
    + 'It is close to the bar that would justify publication-grade attention, '
    + 'but the next reference area still has to be tested and respected — not just tagged.'
  );
  return [headLine, body].join('\n');
}

function buildFohPreRadarBlock(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const lines = ['### 🛰️ Pre-Radar — Building pressure'];
  lines.push('');
  lines.push('_Below the publication bar but showing early developmental signals. These are tracked for behavioural context, not promoted._');
  lines.push('');
  for (const r of records) lines.push(narratePreRadarRecord(r));
  return lines.join('\n');
}
function buildFohNearMissBlock(records, watchThreshold) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const lines = ['### 🎯 Near-Miss — sitting just below the publication bar'];
  lines.push('');
  lines.push('_Worth monitoring. Not promoted yet. ATLAS is waiting for the next reference area to test these reads before any upgrade is justified._');
  lines.push('');
  for (const r of records) lines.push(narrateNearMissRecord(r, watchThreshold));
  return lines.join('\n');
}

// ── Avoided-risk + Operator behavioural notes ────────────────
function narrateAvoidedRisk(ctx) {
  const lvl = String((ctx && ctx.volatility && ctx.volatility.level) || '').toLowerCase();
  let envSentence;
  if (lvl === 'quiet') {
    envSentence = 'in quiet regimes the temptation is to overreact to small moves, which is exactly when small moves are most often noise';
  } else if (lvl === 'elevated') {
    envSentence = 'in elevated regimes the temptation is to mistake speed for direction, which is exactly when speed most often runs out of fuel before structure agrees';
  } else if (lvl === 'extreme') {
    envSentence = 'in extreme regimes the temptation is to chase the loudest bar, which is exactly when the loudest bar most often marks the end of the move';
  } else {
    envSentence = 'in undefined regimes the temptation is to act on the first read available, which is exactly when the first read available is least likely to be the right one';
  }
  return (
    'By staying in monitoring mode this cycle, ATLAS avoided promoting late momentum into mixed structure. '
    + 'That matters because ' + envSentence + '. '
    + 'The cost of patience here is small. The cost of impatience is the standard late-entry reversal.'
  );
}
function narrateOperatorNote(ctx) {
  const top = (ctx && ctx.top10Count) | 0;
  const internal = (ctx && ctx.internalCount) | 0;
  if (top === 0 && internal === 0) {
    return 'Operator note: this is a wait-and-watch market, not a chase market. Quiet conditions reward patience, and the next useful read arrives at the next scan rather than in the current candle.';
  }
  if (top === 0) {
    return 'Operator note: this is a watchful market, not a chase market. Energy is present, but the clean handoff from movement to structure has not completed. That, by itself, is the read.';
  }
  return 'Operator note: developing standouts are visible, but they are still asking the market for proof. Treat them as attention signals rather than setups — the next decision lives at the next reference area, not at the current candle.';
}

// ── Global market read ───────────────────────────────────────
function narrateGlobalMarketRead(ctx) {
  const lvl = String((ctx && ctx.volatility && ctx.volatility.level) || '').toLowerCase();
  const top = (ctx && ctx.top10Count) | 0;
  const internal = (ctx && ctx.internalCount) | 0;
  const ignored = (ctx && ctx.ignoredCount) | 0;
  const universeSize = (ctx && ctx.universeSize) | 0;
  const lines = [translateAtmosphere(lvl)];

  if (top >= 1) {
    lines.push('Activity is concentrated where the section radar below is lit. Those are the only areas currently asking for closer attention; the rest of the universe is context.');
  } else if (internal > 0) {
    lines.push('Activity is scattered. Candidates are visible across the near-threshold band, but none are concentrated in a single section yet — that is itself a regime read.');
  } else {
    lines.push('Activity is sparse. The universe is moving without obvious concentration in any one section, which keeps the read informational only.');
  }

  if (top === 0) {
    lines.push('ATLAS is not promoting candidates this cycle because the move-to-structure handoff has not completed. Speed is present in places, but no candidate has yet been tested at its next reference area and held there.');
  } else {
    lines.push('ATLAS is tracking ' + top + ' developing standout' + (top === 1 ? '' : 's') + ' below. None have produced confirmed acceptance, so they are surfaced as monitoring candidates only — not setups.');
  }

  lines.push('What needs to change before the next scan: at least one candidate must reach its next reference area, pause there without an immediate sharp reversal, and continue with steady participation rather than impulsive expansion.');
  lines.push('What traders should not do prematurely: chase the current candle, treat raw speed as acceptance, or assume the next reference area will be respected before it has even been tested.');
  lines.push('Universe scanned this cycle: ' + universeSize + ' symbols — ' + internal + ' near-threshold, ' + ignored + ' below near-threshold.');
  return lines.join('\n');
}

// ── Watch / near-threshold explanation (FOH) ─────────────────
function narrateWatchExplanation(ctx) {
  const top = (ctx && ctx.top10Count) | 0;
  const internal = (ctx && ctx.internalCount) | 0;
  const lines = ['### ⏳ Why ATLAS is not promoting yet'];
  lines.push('');
  if (top === 0 && internal === 0) {
    lines.push('The current universe is too quiet to support promotion. Without pressure, ATLAS has nothing to fail or pass — the next useful read arrives at the next scan, not in the current candle.');
  } else if (top === 0) {
    lines.push('Candidates are visible in the near-threshold band, but none have cleared the publication bar. The missing piece is acceptance — price has moved, but it has not yet been tested at the next reference area and held there.');
  } else {
    lines.push('Developing standouts are surfaced below, but they are monitoring candidates only. The missing piece is acceptance — each candidate is asking for its next reference area to be tested and respected, and that test has not yet happened.');
  }
  lines.push('What price must prove: that the next reference area is more than a passing tag — that it can be reached, paused at, and walked through with steady participation rather than rejected on contact.');
  lines.push('What failure looks like: a sharp rejection on the first visit, an immediate return through the prior reference, or expansion that decays into directionless noise before structure has time to settle.');
  lines.push('What a safer participant should wait to see: acceptance first, then continuation in a normal-paced second leg — not the first impulsive bar after the visit.');
  lines.push('Why chasing now is lower quality: most of the easy distance is already in the price, and the next move depends on a test that has not yet happened. Entering ahead of that test trades the assumption, not the evidence.');
  return lines.join('\n');
}

// ── Universe coverage narration ──────────────────────────────
function narrateUniverseCoverage(ctx) {
  const ranking = (ctx && ctx.ranking) || {};
  const top10 = Array.isArray(ranking.top10) ? ranking.top10 : [];
  const sectionAvgs = (ctx && ctx.sectionAvgs) || {};
  const atThreshold = top10.filter(r => (r.score || 0) >= 8).length;
  const universe = (ctx && ctx.universeSize) | 0;
  const internal = (ctx && ctx.internalCount) | 0;
  const ignored = (ctx && ctx.ignoredCount) | 0;
  const entries = Object.entries(sectionAvgs);
  entries.sort((a, b) => b[1] - a[1]);
  const sectionLabelMap = (ctx && ctx.sectionLabels) || {};
  const strongest = entries[0]
    ? (sectionLabelMap[entries[0][0]] || entries[0][0]) + ' (average ' + entries[0][1].toFixed(1) + '/10 across active candidates)'
    : 'no active section this cycle';
  const weakest = entries.length > 1
    ? (sectionLabelMap[entries[entries.length - 1][0]] || entries[entries.length - 1][0]) + ' (average ' + entries[entries.length - 1][1].toFixed(1) + '/10 across active candidates)'
    : 'no second active section this cycle';
  let concentration;
  if (entries.length === 0) {
    concentration = 'quiet across sections — no obvious concentration to report';
  } else if (entries.length === 1) {
    concentration = 'concentrated in ' + (sectionLabelMap[entries[0][0]] || entries[0][0])
      + ' — the only section currently doing measurable work';
  } else {
    const spread = entries[0][1] - entries[entries.length - 1][1];
    concentration = spread > 2
      ? 'concentrated in ' + (sectionLabelMap[entries[0][0]] || entries[0][0])
        + ' — meaningful gap between the strongest and weakest active sections this cycle'
      : 'broad across sections — no single section is dominating the read';
  }
  return [
    '### 📊 Universe coverage',
    '',
    '_Universe scanned this cycle:_ ' + universe + ' symbols. ATLAS sweeps the full set every cycle so a quiet section is informative, not absent.',
    '_Below the near-threshold band (< 5/10):_ ' + ignored + ' — these are surfaced as context only and do not influence the read.',
    '_Near-threshold band (5–7/10):_ ' + internal + ' — building pressure, not yet asking for publication-grade attention.',
    '_Publication-grade (≥ 8/10):_ ' + atThreshold + ' — the candidates the operator surface should monitor most closely.',
    '_Strongest active section:_ ' + strongest + '.',
    '_Weakest active section:_ ' + weakest + '.',
    '_Cross-section concentration:_ ' + concentration + '.',
  ].join('\n');
}

// ── Closing narration ────────────────────────────────────────
function narrateClosingBlock(ctx) {
  const top = (ctx && ctx.top10Count) | 0;
  const stateLine = top === 0
    ? 'Monitoring only — publication threshold not met this cycle.'
    : 'Monitoring only — developing standouts surfaced, but no confirmed publication-grade setup this cycle.';
  return [
    '### 🔚 Next review',
    '',
    '_Next review:_ ' + (ctx && ctx.nextReview ? ctx.nextReview : 'pending') + '.',
    '_Current action state:_ ' + stateLine,
    '_What could change by the next scan:_ a candidate could reach its next reference area, hold there without an immediate reversal, and continue with steady participation. That is the upgrade path.',
    '_One-sentence monitoring guidance:_ ATLAS remains in monitoring mode; the next upgrade requires price to accept the active reference area without an immediate rejection, otherwise the move stays vulnerable to a late-stage reversal.',
  ].join('\n');
}

// ── Public entry: translate a candidate into a narration bag ─
function translateCandidate(r, ctx) {
  return {
    arrow: arrowFor(r && r.direction),
    phase: translatePhase(r && r.movePhase),
    lateEntry: translateLateEntryRisk(r && r.lateEntryRisk, r && r.movePhase),
    speed: translateMoveSpeed(r && r.moveSpeed),
    relativeStrength: translateRelativeStrength(r && r.relativeStrength, r && r.sectionLabel),
    publication: translatePublicationState(r && r.score, ctx && ctx.watchThreshold),
    whatHappened: narrateWhatHappened(r),
    whereItMatters: narrateWhereItMatters(r),
    whyAtlasCares: narrateWhyAtlasCares(r, ctx),
    healthyZone: narrateHealthyZone(r),
    cautionZone: narrateCautionZone(r),
    dangerZone: narrateDangerZone(r),
    invalidation: narrateInvalidation(r),
    whatNext: narrateWhatAtlasNeedsNext(r),
    traderGuidance: narrateTraderGuidance(r),
    behaviouralNote: narrateBehaviouralNote(r, ctx),
    consequenceTrail: narrateConsequenceTrail(r),
    replayReference: narrateReplayReference(r),
  };
}

module.exports = {
  // Per-field translators
  arrowFor,
  directionVerb,
  directionWord,
  translatePhase,
  translateLateEntryRisk,
  translateMoveSpeed,
  translateRelativeStrength,
  translateAtmosphere,
  translateSectionEnergy,
  translatePublicationState,

  // Per-card narration
  translateCandidate,
  narrateWhatHappened,
  narrateWhereItMatters,
  narrateWhyAtlasCares,
  narrateHealthyZone,
  narrateCautionZone,
  narrateDangerZone,
  narrateInvalidation,
  narrateWhatAtlasNeedsNext,
  narrateTraderGuidance,
  narrateBehaviouralNote,
  narrateConsequenceTrail,
  narrateReplayReference,

  // Section / scan-level narration
  narrateGlobalMarketRead,
  narrateWatchExplanation,
  narrateAvoidedRisk,
  narrateOperatorNote,
  narrateUniverseCoverage,
  narrateClosingBlock,

  // FOH-native Pre-Radar / Near-Miss (replace legacy renderers)
  narratePreRadarRecord,
  narrateNearMissRecord,
  buildFohPreRadarBlock,
  buildFohNearMissBlock,
};
