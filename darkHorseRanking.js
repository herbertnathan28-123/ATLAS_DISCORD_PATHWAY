'use strict';
// ============================================================
// ATLAS FX — DARK HORSE v1.1 GLOBAL MOVER INTELLIGENCE
//
// Purpose:
//   Dark Horse v0.1 says "AMD is moving."
//   Dark Horse v1.1 says: why AMD made the list, which section it
//   belongs to, whether it leads that section, how strong/fast/old
//   the move is, what phase it is in, what confirms or invalidates
//   it, what would promote it to WATCH, and whether macro/event
//   context supports it.
//
//   This module is purely additive over darkHorseEngine.js. It
//   accepts the existing scoreInstrument result shape plus raw
//   HTF candles for move-age / move-speed / move-phase analysis,
//   classifies each candidate to a section, ranks globally with
//   section caps, and produces the v1.1 payload + structured logs.
//
//   No certainty wording. No hype. No permission/authorisation.
//   Sanitiser reuses the FOMO control banned-phrase gate.
// ============================================================

const fomo = require('./darkHorseFomoControl');

// ── SECTIONS ─────────────────────────────────────────────────
const SECTIONS = {
  FX_MAJORS:    'fx_majors',
  FX_CROSSES:   'fx_crosses',
  INDICES:      'indices',
  COMMODITIES:  'commodities',
  EQUITIES:     'equities',
  SAFE_HAVENS:  'safe_havens',
  OTHER:        'other',
};

const SECTION_LABEL = {
  [SECTIONS.FX_MAJORS]:   'FX Majors',
  [SECTIONS.FX_CROSSES]:  'FX Crosses / Risk Pairs',
  [SECTIONS.INDICES]:     'Global Indices',
  [SECTIONS.COMMODITIES]: 'Commodities / Inflation Hedge',
  [SECTIONS.EQUITIES]:    'Major Equities / Momentum',
  [SECTIONS.SAFE_HAVENS]: 'Safe-Haven / Defensive',
  [SECTIONS.OTHER]:       'Other',
};

const FX_MAJOR_SET   = new Set(['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD']);
const FX_CROSS_SET   = new Set([
  'EURGBP','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY','EURAUD','EURCAD',
  'GBPAUD','GBPCAD','GBPCHF','AUDCAD','AUDNZD','NZDCAD',
]);
const INDEX_SET      = new Set(['NAS100','US500','DJI','GER40','UK100','JPN225','HK50','SPX','NDX','IXIC','GSPC']);
const COMMODITY_SET  = new Set(['XAUUSD','XAGUSD','USOIL','WTI','XPTUSD','XPDUSD','BRENT','NATGAS']);
const EQUITY_SET     = new Set(['NVDA','AMD','ASML','AAPL','MSFT','META','GOOGL','AMZN','TSLA']);
// Safe-haven overlay: pairs that ALSO act as defensives in stress.
// Classification is exclusive — primary section wins; safe-haven is a
// metadata flag we add to the rank record so the bulletin can say
// "USDJPY (FX major · safe-haven flow active)".
const SAFE_HAVEN_OVERLAY = new Set(['USDJPY','USDCHF','XAUUSD']);

function classifyToSection(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (FX_MAJOR_SET.has(s))   return SECTIONS.FX_MAJORS;
  if (FX_CROSS_SET.has(s))   return SECTIONS.FX_CROSSES;
  if (INDEX_SET.has(s))      return SECTIONS.INDICES;
  if (COMMODITY_SET.has(s))  return SECTIONS.COMMODITIES;
  if (EQUITY_SET.has(s))     return SECTIONS.EQUITIES;
  return SECTIONS.OTHER;
}

function isSafeHavenOverlay(symbol) {
  return SAFE_HAVEN_OVERLAY.has(String(symbol || '').toUpperCase());
}

// ── MOVE METRICS ─────────────────────────────────────────────
// All metrics are heuristic and explicit about uncertainty. We
// never claim a move WILL continue; we describe the state and
// surface what would confirm or invalidate it.
function computeMoveAge(candles, direction) {
  if (!Array.isArray(candles) || candles.length < 3 || !direction) return 0;
  let age = 0;
  // Walk back from the latest bar while the bar's close vs open
  // matches the dominant direction.
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (!c || c.close == null || c.open == null) break;
    const sameDir = (direction === 'Bullish' && c.close > c.open) ||
                    (direction === 'Bearish' && c.close < c.open);
    if (!sameDir) break;
    age++;
    if (age >= 30) break; // cap
  }
  return age;
}

function computeMoveSpeed(candles) {
  // Ratio of recent (last 3) average body size vs prior (last 4-10) baseline.
  if (!Array.isArray(candles) || candles.length < 10) return null;
  const body = c => Math.abs((c.close || 0) - (c.open || 0));
  const recent = candles.slice(-3);
  const prior  = candles.slice(-10, -3);
  const avg    = arr => arr.reduce((s, c) => s + body(c), 0) / arr.length;
  const r = avg(recent), p = avg(prior);
  if (p === 0) return null;
  return Number((r / p).toFixed(2));
}

function classifyMovePhase(age, speed, score) {
  // Early: just started. Mid: still expanding. Late: maturing. Exhaustion: over-extended.
  if (age <= 3 && speed != null && speed >= 1.2) return 'early';
  if (age <= 8 && (speed == null || speed >= 1.0)) return 'mid';
  if (age <= 15) return 'late';
  return 'exhaustion';
}

function lateEntryRiskFromPhase(phase) {
  if (phase === 'early')      return 'low';
  if (phase === 'mid')        return 'low-to-moderate';
  if (phase === 'late')       return 'moderate-to-high';
  if (phase === 'exhaustion') return 'high';
  return 'unknown';
}

function continuationWindowFromPhase(phase) {
  if (phase === 'early')      return 'window opening — early in trend, room to develop if structure holds';
  if (phase === 'mid')        return 'window open — trend developing, watch for first higher-timeframe confirmation';
  if (phase === 'late')       return 'window narrowing — risk of mean reversion rising; require structure confirmation';
  if (phase === 'exhaustion') return 'window closed — late-entry risk high; do not chase';
  return 'window unavailable';
}

// ── SECTION RELATIVE STRENGTH ────────────────────────────────
// rs = candidate.score / sectionAverageScore (capped 0.5..2.5)
function computeRelativeStrength(candidate, sectionAvgScore) {
  if (!sectionAvgScore || sectionAvgScore <= 0) return null;
  const v = candidate.score / sectionAvgScore;
  return Math.max(0.5, Math.min(2.5, Number(v.toFixed(2))));
}

// ── CONFIRMATION / INVALIDATION TEMPLATES ────────────────────
function structureConfirmTemplate(direction, section) {
  const dir = direction === 'Bullish' ? 'long' : 'short';
  const above = direction === 'Bullish' ? 'above' : 'below';
  const high  = direction === 'Bullish' ? 'high'  : 'low';

  if (section === SECTIONS.FX_MAJORS || section === SECTIONS.FX_CROSSES) {
    return `5m/15m close ${above} the recent intraday ${high}, followed by a clean retest that holds.`;
  }
  if (section === SECTIONS.INDICES) {
    return `15m/1H close ${above} the recent session ${high}, followed by retest that holds; volume not collapsing into the retest.`;
  }
  if (section === SECTIONS.COMMODITIES) {
    return `1H close ${above} the recent intraday ${high}; ATR-respecting retest that holds.`;
  }
  if (section === SECTIONS.EQUITIES) {
    return `5m/15m close ${above} the recent VWAP-anchored ${high}, with retest holding above the prior session VWAP.`;
  }
  return `Higher-timeframe close ${above} recent ${high} with retest that holds the level.`;
}

function invalidationTemplate(direction, section) {
  const below = direction === 'Bullish' ? 'below' : 'above';
  const low   = direction === 'Bullish' ? 'low'   : 'high';
  return `Reclaim of the prior session ${low} on the same timeframe (${section === SECTIONS.INDICES ? '15m/1H' : '5m/15m'}) — close ${below} that level voids the setup.`;
}

function promotionTriggerTemplate(direction) {
  return direction === 'Bullish'
    ? 'A confirmed higher-timeframe close above the most recent significant high, with momentum NOT contracting on the close — promotes from monitoring to WATCH on the next scan.'
    : 'A confirmed higher-timeframe close below the most recent significant low, with momentum NOT contracting on the close — promotes from monitoring to WATCH on the next scan.';
}

// ── EXPANDED RANK RECORD ─────────────────────────────────────
// Input: existing scoreInstrument result + raw htf candles + sectionAvgScore
// Output: enriched rank record with all v1.1 fields.
function enrichCandidate(candidate, htfCandles, sectionAvgScore, opts) {
  opts = opts || {};
  const section = classifyToSection(candidate.symbol);
  const isSafeHaven = isSafeHavenOverlay(candidate.symbol);
  const moveAge = computeMoveAge(htfCandles, candidate.direction);
  const moveSpeed = computeMoveSpeed(htfCandles);
  const movePhase = classifyMovePhase(moveAge, moveSpeed, candidate.score);
  const relStr = computeRelativeStrength(candidate, sectionAvgScore);

  return {
    symbol: candidate.symbol,
    section,
    sectionLabel: SECTION_LABEL[section],
    safeHavenOverlay: isSafeHaven,
    direction: candidate.direction,
    score: candidate.score,
    scoreBreakdown: candidate.reasons || [],
    moveStrength:    candidate.score,                     // 0..10
    moveSpeed:       moveSpeed,                            // ratio or null
    moveAge:         moveAge,                              // bars, 0..30
    movePhase:       movePhase,                            // early|mid|late|exhaustion
    relativeStrength: relStr,                              // capped ratio or null
    structureState:  candidate.summary || 'unavailable',
    confirmationRequirement: structureConfirmTemplate(candidate.direction, section),
    invalidationTrigger:     invalidationTemplate(candidate.direction, section),
    promotionTrigger:        promotionTriggerTemplate(candidate.direction),
    continuationWindow:      continuationWindowFromPhase(movePhase),
    lateEntryRisk:           lateEntryRiskFromPhase(movePhase),
    whyFlagged:              candidate.summary || 'composite scoring threshold met',
    macroEventLink:          opts.macroEventLink || 'unavailable — no anchor event mapped to this symbol',
    whyNotWatch:             whyNotWatch(candidate.score, opts.watchThreshold || 8),
    atlasState:              atlasStateFromPhase(movePhase),
  };
}

function whyNotWatch(score, watchThreshold) {
  if (score >= watchThreshold) return 'crossed WATCH threshold';
  const gap = watchThreshold - score;
  return `score ${score}/10 below WATCH threshold of ${watchThreshold}/10 (gap ${gap}); awaiting confirmation criteria`;
}

function atlasStateFromPhase(phase) {
  if (phase === 'early') return 'Monitoring only — early phase';
  if (phase === 'mid')   return 'Monitoring only — mid phase, watch for confirmation';
  if (phase === 'late')  return 'Monitoring only — late phase, late-entry risk rising';
  if (phase === 'exhaustion') return 'Monitoring only — exhaustion phase, do not chase';
  return 'Monitoring only';
}

// ── RANKING ──────────────────────────────────────────────────
// Input: array of enriched candidates
// Returns: { top10, perSectionAvg, sectionsScanned, sectionCapsApplied }
function rankCandidates(enriched, opts) {
  opts = opts || {};
  const sectionCap = opts.sectionCap || 2;          // default 2 per section
  const sectionCapMax = opts.sectionCapMax || 3;    // up to 3 if dominant
  const topN = opts.topN || 10;

  // Sort all by score desc.
  const sorted = enriched.slice().sort((a, b) => (b.score - a.score) || (b.moveStrength - a.moveStrength));

  // Bucket by section.
  const bySection = {};
  for (const r of sorted) {
    if (!bySection[r.section]) bySection[r.section] = [];
    bySection[r.section].push(r);
  }

  // First pass: take up to `sectionCap` per section in score order.
  const out = [];
  const counts = {};
  for (const r of sorted) {
    if ((counts[r.section] || 0) >= sectionCap) continue;
    counts[r.section] = (counts[r.section] || 0) + 1;
    out.push(r);
    if (out.length >= topN) break;
  }

  // Section caps applied — record which sections hit the cap.
  const sectionCapsApplied = Object.entries(counts)
    .filter(([sec, n]) => n >= sectionCap && (bySection[sec] || []).length > sectionCap)
    .map(([sec]) => sec);

  // Second pass: if a single section dominates AND we still have room,
  // raise its cap to sectionCapMax. (Only if already top in score.)
  if (out.length < topN) {
    const topSection = out[0] ? out[0].section : null;
    if (topSection && (counts[topSection] || 0) === sectionCap) {
      for (const r of (bySection[topSection] || [])) {
        if (out.includes(r)) continue;
        if ((counts[topSection] || 0) >= sectionCapMax) break;
        out.push(r);
        counts[topSection] = (counts[topSection] || 0) + 1;
        if (out.length >= topN) break;
      }
    }
  }

  // Third pass: fill remaining slots from any section in score order,
  // but never exceed sectionCapMax per section. This guarantees the
  // "max 2-3 per section" rule even when there are far more eligible
  // candidates than sections.
  if (out.length < topN) {
    for (const r of sorted) {
      if (out.includes(r)) continue;
      if ((counts[r.section] || 0) >= sectionCapMax) continue;
      out.push(r);
      counts[r.section] = (counts[r.section] || 0) + 1;
      if (out.length >= topN) break;
    }
  }

  return {
    top10: out.slice(0, topN),
    perSectionCount: counts,
    sectionsScanned: Object.keys(bySection),
    sectionCapsApplied,
  };
}

// ── PER-SECTION AVG SCORE ────────────────────────────────────
function perSectionAvgScores(candidates) {
  const buckets = {};
  for (const c of candidates) {
    const sec = classifyToSection(c.symbol);
    if (!buckets[sec]) buckets[sec] = { total: 0, count: 0 };
    buckets[sec].total += c.score;
    buckets[sec].count += 1;
  }
  const out = {};
  for (const [sec, b] of Object.entries(buckets)) {
    out[sec] = b.count ? b.total / b.count : 0;
  }
  return out;
}

// ── PAYLOAD BUILDERS ─────────────────────────────────────────
function arrowFor(direction) {
  if (direction === 'Bullish') return '↑';
  if (direction === 'Bearish') return '↓';
  return '→';
}

function buildExpandedDetail(rank, idx) {
  const r = rank;
  const speedStr = r.moveSpeed != null ? `${r.moveSpeed}× baseline` : 'speed unavailable';
  const rsStr = r.relativeStrength != null ? `${r.relativeStrength}× section avg` : 'relative strength unavailable';
  const breakdownLine = r.scoreBreakdown && r.scoreBreakdown.length
    ? r.scoreBreakdown.map(x => `   • ${x}`).join('\n')
    : '   • composite criteria met';

  return [
    `**#${idx + 1} — ${r.symbol} ${arrowFor(r.direction)}**  ·  Section: ${r.sectionLabel}${r.safeHavenOverlay ? ' · safe-haven overlay' : ''}`,
    `Direction: ${r.direction || 'neutral'}  ·  Score: ${r.score}/10`,
    `Score breakdown:\n${breakdownLine}`,
    `Move strength: ${r.moveStrength}/10  ·  Move speed: ${speedStr}`,
    `Move age: ${r.moveAge} bar(s) (HTF, same-direction)  ·  Move phase: ${r.movePhase}`,
    `Relative strength vs section: ${rsStr}`,
    `Why flagged: ${r.whyFlagged}`,
    `Macro / event link: ${r.macroEventLink}`,
    `Structure state: ${r.structureState}`,
    `Confirmation requirement: ${r.confirmationRequirement}`,
    `Continuation window: ${r.continuationWindow}`,
    `Late-entry risk: ${r.lateEntryRisk}`,
    `Why not WATCH: ${r.whyNotWatch}`,
    `Promotion trigger: ${r.promotionTrigger}`,
    `Invalidation trigger: ${r.invalidationTrigger}`,
    `ATLAS state: ${r.atlasState}`,
  ].join('\n');
}

function buildCompactDetail(rank, idx) {
  return `${idx + 1}. **${rank.symbol}** ${arrowFor(rank.direction)} — ${rank.sectionLabel} · ${rank.score}/10 · ${rank.whyFlagged} · ${rank.whyNotWatch}`;
}

function buildRankedMovementDigestPayload(ranking, volatility) {
  const top3 = ranking.top10.slice(0, 3);
  const rest = ranking.top10.slice(3);

  const expandedBlock = top3.length
    ? top3.map((r, i) => buildExpandedDetail(r, i)).join('\n\n──\n\n')
    : '_No qualifying candidates this scan._';

  const restBlock = rest.length
    ? rest.map((r, i) => buildCompactDetail(r, i + 3)).join('\n')
    : '_No additional candidates._';

  const sectionsLine = ranking.sectionsScanned.length
    ? ranking.sectionsScanned.map(s => SECTION_LABEL[s] || s).join(' · ')
    : 'unavailable';

  const vixLine = volatility && volatility.vixLevel
    ? `VIX ${volatility.vixLevel}`
    : 'VIX unavailable';

  const content =
    `🐎 **DARK HORSE — GLOBAL MOVER RADAR (v1.1)**\n\n` +
    `**State:** MONITORING ONLY · NO CONFIRMED DARK HORSE WATCH CANDIDATE\n` +
    `**Volatility:** ${volatility ? volatility.level : 'unavailable'} · ${vixLine}\n` +
    `**Sections scanned:** ${sectionsLine}\n` +
    `**Top movers:** ${ranking.top10.length} (section caps: ${ranking.sectionCapsApplied.length ? ranking.sectionCapsApplied.join(',') : 'none'})\n\n` +
    `### Top 3 — expanded reasoning\n\n${expandedBlock}\n\n` +
    `### Candidates 4–10\n${restBlock}\n\n` +
    `CONDITIONS MOVING, BUT ENTRY QUALITY NOT CONFIRMED.\n` +
    `LATE ENTRY RISK varies by phase per candidate. DO NOT CHASE THE MOVE.\n` +
    `Per-candidate confirmation requirements (specific timeframe, what confirms, what invalidates) are listed under each candidate above.\n\n` +
    `${fomo.FOMO_CAUTION}\n\n` +
    `Full ATLAS confirmation path remains: Corey → Spidey → Jane.`;

  return { content, kind: 'movement_digest_v1_1' };
}

// ── LOG EMITTERS ─────────────────────────────────────────────
function emitRankingLogs(ranking, log) {
  const _log = log || (line => console.log(`[${new Date().toISOString()}] [DH-${line.startsWith('[') ? 'INFO' : 'INFO'}] ${line}`));
  _log(`[DH-RANKING] universe_size=${(ranking.allCount != null) ? ranking.allCount : ranking.top10.length}`);
  _log(`[DH-RANKING] sections_scanned=${ranking.sectionsScanned.join('|') || 'none'}`);
  _log(`[DH-RANKING] top10=${ranking.top10.map(r => r.symbol).join(',')}`);
  _log(`[DH-RANKING] section_caps_applied=${ranking.sectionCapsApplied.join(',') || 'none'}`);
  for (const r of ranking.top10) {
    _log(`[DH-CANDIDATE] symbol=${r.symbol}`);
    _log(`[DH-CANDIDATE] section=${r.section}`);
    _log(`[DH-CANDIDATE] score=${r.score}`);
    _log(`[DH-CANDIDATE] direction=${r.direction || 'neutral'}`);
    _log(`[DH-CANDIDATE] move_strength=${r.moveStrength}`);
    _log(`[DH-CANDIDATE] move_speed=${r.moveSpeed != null ? r.moveSpeed : 'unavailable'}`);
    _log(`[DH-CANDIDATE] move_age=${r.moveAge}`);
    _log(`[DH-CANDIDATE] move_phase=${r.movePhase}`);
    _log(`[DH-CANDIDATE] relative_strength=${r.relativeStrength != null ? r.relativeStrength : 'unavailable'}`);
    _log(`[DH-CANDIDATE] structure_state=${(r.structureState || 'unavailable').slice(0, 80)}`);
    _log(`[DH-CANDIDATE] continuation_window=${r.continuationWindow}`);
    _log(`[DH-CANDIDATE] late_entry_risk=${r.lateEntryRisk}`);
    _log(`[DH-CANDIDATE] why_not_watch=${r.whyNotWatch}`);
    _log(`[DH-CANDIDATE] promotion_trigger=${r.promotionTrigger.slice(0, 80)}`);
  }
}

// ── PUBLIC: BUILD FULL RANKING FROM CANDIDATES + CANDLES ─────
// Input:
//   candidates: array of { symbol, score, direction, summary, reasons, ... }
//                 (the existing scoreInstrument result shape)
//   candleProvider: async (symbol) => htfCandles | null
//   opts: { topN?, sectionCap?, sectionCapMax?, watchThreshold?, macroEventLinks? }
// Output: { ranking, payload, logs }
async function buildRanking(candidates, candleProvider, opts) {
  opts = opts || {};
  const sectionAvgs = perSectionAvgScores(candidates);
  const enriched = [];
  for (const c of candidates) {
    let candles = null;
    if (typeof candleProvider === 'function') {
      try { candles = await candleProvider(c.symbol); } catch (_e) { candles = null; }
    }
    const sec = classifyToSection(c.symbol);
    const sectionAvg = sectionAvgs[sec] || 0;
    const macroLink = (opts.macroEventLinks && opts.macroEventLinks[c.symbol]) || null;
    enriched.push(enrichCandidate(c, candles, sectionAvg, {
      watchThreshold: opts.watchThreshold,
      macroEventLink: macroLink,
    }));
  }
  const ranking = rankCandidates(enriched, opts);
  ranking.allCount = candidates.length;
  return ranking;
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  SECTIONS, SECTION_LABEL,
  FX_MAJOR_SET, FX_CROSS_SET, INDEX_SET, COMMODITY_SET, EQUITY_SET, SAFE_HAVEN_OVERLAY,
  classifyToSection, isSafeHavenOverlay,

  computeMoveAge, computeMoveSpeed, classifyMovePhase,
  lateEntryRiskFromPhase, continuationWindowFromPhase,
  computeRelativeStrength, perSectionAvgScores,

  structureConfirmTemplate, invalidationTemplate, promotionTriggerTemplate,
  whyNotWatch, atlasStateFromPhase,

  enrichCandidate, rankCandidates, buildRanking,
  buildExpandedDetail, buildCompactDetail, buildRankedMovementDigestPayload,
  emitRankingLogs,
};
