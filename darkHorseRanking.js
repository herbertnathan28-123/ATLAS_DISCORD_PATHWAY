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
  return 'window reading pending';
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
    return `5m/15m close ${above} the recent intraday ${high}, with the retest holding ${above} the prior-session reference level.`;
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
    structureState:  candidate.summary || 'reading pending',
    confirmationRequirement: structureConfirmTemplate(candidate.direction, section),
    invalidationTrigger:     invalidationTemplate(candidate.direction, section),
    promotionTrigger:        promotionTriggerTemplate(candidate.direction),
    continuationWindow:      continuationWindowFromPhase(movePhase),
    continuationSessionText: continuationWindowSessionsText(section),
    lateEntryRisk:           lateEntryRiskFromPhase(movePhase),
    whyFlagged:              candidate.summary || 'composite scoring threshold met',
    macroEventLink:          opts.macroEventLink || 'unavailable — no anchor event mapped to this symbol',
    whyNotWatch:             whyNotWatch(candidate.score, opts.watchThreshold || 8),
    atlasState:              atlasStateFromPhase(movePhase),
    // Education-layer evidence anchors. partial when only 1D data
    // is wired (current state); pending when no candles arrived.
    // Follow-up: wire 15m/5m OHLC into the ranking pipeline so the
    // breakout/retest/hold timestamps can be published.
    evidenceAnchors: buildEvidenceAnchors(candidate, htfCandles),
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

// ── EVIDENCE ANCHORS (price + timestamp + timeframe) ─────────
// Doctrine: a Level-1 trader must be able to open the chart and
// find what ATLAS is talking about. Every technical phrase
// (recent intraday high, breakout, calm retest, hold, invalidation)
// must be paired with either (a) an actual price + timestamp +
// timeframe trio OR (b) an honest "pending — follow-up wiring
// required" note. Never invent levels.
//
// Current OHLC data availability in the Dark Horse ranking
// pipeline:
//   1D HTF  — passed via candleProvider; we can extract the
//             daily-bar extreme + date stamp.
//   1H LTF  — fetched only on the WATCH path, not the ranking
//             enrichment, so unavailable here.
//   15m/5m  — NOT wired into the ranking pipeline. Required for
//             the user-preferred breakout / retest / hold
//             timestamp trail. Staged as a follow-up requirement.
//
// _formatPrice handles instrument-class precision; AWST = UTC+8.
function _fmtPriceForLevel(v) {
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) >= 1000) return v.toFixed(2);
  if (Math.abs(v) >= 10)   return v.toFixed(2);
  if (Math.abs(v) >= 1)    return v.toFixed(4);
  return v.toFixed(5);
}
function _fmtUtcDate(unixSec) {
  if (!Number.isFinite(unixSec)) return null;
  const d = new Date(unixSec * 1000);
  const pad = n => (n < 10 ? '0' : '') + n;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function _fmtAwstDate(unixSec) {
  if (!Number.isFinite(unixSec)) return null;
  // AWST = UTC+8, fixed offset (no DST).
  const d = new Date(unixSec * 1000 + 8 * 3600 * 1000);
  const pad = n => (n < 10 ? '0' : '') + n;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// buildEvidenceAnchors(candidate, htfCandles)
// Returns a structured anchor record with explicit availability flags.
// availability='partial' when only daily-level data is wired (current
// state); 'pending' when no candles at all; 'full' when intraday
// timestamp/price trail can be published (NOT yet — requires 15m/5m
// wiring as a follow-up lane).
function buildEvidenceAnchors(candidate, htfCandles) {
  const direction = candidate && candidate.direction;
  const out = {
    availability: 'pending',
    timeframeAvailable: null,
    followUp: '15m/5m OHLC anchor extraction not yet wired into the ranking pipeline. ' +
              'Once wired, the recent-high, breakout-close, retest-touch, hold-close, ' +
              'and invalidation timestamps will be published here per the education-layer doctrine.',
    recentHigh:     null,
    recentLow:      null,
    breakoutClose:  null,
    retest:         null,
    holdClose:      null,
    invalidation:   null,
  };
  if (!Array.isArray(htfCandles) || htfCandles.length === 0) return out;
  const last = htfCandles[htfCandles.length - 1];
  if (!last) return out;
  const high = Number.isFinite(last.high) ? last.high : null;
  const low  = Number.isFinite(last.low)  ? last.low  : null;
  const t    = Number.isFinite(last.time) ? last.time : null;
  if (high == null || low == null || t == null) return out;
  out.availability = 'partial';
  out.timeframeAvailable = '1D';

  // Daily-level recent extremes — honest about the source
  // (the high/low printed somewhere during the current 1D bar;
  // exact intraday time of the print is NOT available without
  // 15m/5m data, which is the follow-up requirement above).
  out.recentHigh = {
    price: high,
    priceText: _fmtPriceForLevel(high),
    dateUtc: _fmtUtcDate(t),
    dateAwst: _fmtAwstDate(t),
    source: 'current 1D candle extreme',
    note: 'exact intraday timestamp pending 15m/5m anchor wiring',
  };
  out.recentLow = {
    price: low,
    priceText: _fmtPriceForLevel(low),
    dateUtc: _fmtUtcDate(t),
    dateAwst: _fmtAwstDate(t),
    source: 'current 1D candle extreme',
    note: 'exact intraday timestamp pending 15m/5m anchor wiring',
  };
  // Invalidation level — for longs, a close back below the daily high
  // (the breakout area) weakens the read. For shorts, mirror.
  const invLevel = direction === 'Bearish' ? high : low;
  out.invalidation = {
    price: invLevel,
    priceText: _fmtPriceForLevel(invLevel),
    timeframe: '15m (pending wiring) / 1D (current)',
    rule: direction === 'Bearish'
      ? 'A full 15m or 1D candle close back ABOVE this level weakens the read because price would have failed back over the prior session ' + (direction === 'Bearish' ? 'high' : 'low') + ' area.'
      : 'A full 15m or 1D candle close back BELOW this level weakens the read because price would have failed back under the prior session ' + (direction === 'Bearish' ? 'high' : 'low') + ' area.',
  };
  return out;
}

// ── CONTINUATION WINDOW — asset-class-aware session phrasing ──
// Equities: New York trading session days. FX / metals / commodities:
// Sydney / Tokyo / London / New York session cycles. Indices: tracks
// regional exchange hours when possible; defaults to the symbol's
// listing region's session.
function continuationWindowSessionsText(section) {
  if (section === SECTIONS.EQUITIES) {
    return 'New York equity-session days (the next regular US cash-equity trading sessions).';
  }
  if (section === SECTIONS.FX_MAJORS || section === SECTIONS.FX_CROSSES) {
    return 'major FX session cycles (Sydney / Tokyo / London / New York rolling 24-hour sequence).';
  }
  if (section === SECTIONS.COMMODITIES) {
    return 'major commodity sessions (London PM fix / New York Globex cycle).';
  }
  if (section === SECTIONS.INDICES) {
    return 'regional exchange sessions covering the index (e.g. NY for US500/NAS100, Frankfurt for GER40, London for UK100).';
  }
  return 'rolling 24-hour FX-style session sequence.';
}

// ── PAYLOAD BUILDERS ─────────────────────────────────────────
function arrowFor(direction) {
  if (direction === 'Bullish') return '↑';
  if (direction === 'Bearish') return '↓';
  return '→';
}

// ── STANDOUT SELECTION ───────────────────────────────────────
// Picks the top N overall standouts from the ranking. Score is
// the primary key; ties broken by phase priority (early > mid >
// late > exhaustion), then lateEntryRisk (lower better), then
// moveSpeed (higher better), then structureState completeness,
// then relativeStrength (higher better). PRESENTATION LAYER ONLY
// — does not touch underlying score values.
const _PHASE_RANK = { early: 4, mid: 3, late: 2, exhaustion: 1 };
const _LATE_RISK_RANK = {
  'low': 5,
  'low-to-moderate': 4,
  'moderate': 3,
  'moderate-to-high': 2,
  'high': 1,
  'unknown': 0,
};

function _compareForStandout(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const pa = _PHASE_RANK[a.movePhase] || 0;
  const pb = _PHASE_RANK[b.movePhase] || 0;
  if (pb !== pa) return pb - pa;
  const ra = _LATE_RISK_RANK[a.lateEntryRisk] || 0;
  const rb = _LATE_RISK_RANK[b.lateEntryRisk] || 0;
  if (rb !== ra) return rb - ra;
  const sa = a.moveSpeed || 0;
  const sb = b.moveSpeed || 0;
  if (sb !== sa) return sb - sa;
  const ca = (a.structureState || '').length;
  const cb = (b.structureState || '').length;
  if (cb !== ca) return cb - ca;
  const ya = a.relativeStrength || 0;
  const yb = b.relativeStrength || 0;
  return yb - ya;
}

function selectStandouts(candidates, n) {
  const limit = Number.isFinite(n) && n > 0 ? n : 2;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  return candidates.slice().sort(_compareForStandout).slice(0, limit);
}

// ── PLAIN-ENGLISH TREND DESCRIPTIONS ─────────────────────────
function plainTrendAge(moveAge, direction) {
  const dir = direction === 'Bullish' ? 'bullish' :
              direction === 'Bearish' ? 'bearish' : 'directional';
  if (!Number.isFinite(moveAge) || moveAge <= 0) {
    return 'no confirmed same-direction higher-timeframe bar yet';
  }
  if (moveAge === 1) return `early move — first confirmed same-direction ${dir} higher-timeframe bar`;
  if (moveAge <= 3)  return `${dir} sequence active for ${moveAge} candles`;
  if (moveAge <= 6)  return `mature move — ${dir} sequence active for ${moveAge} candles`;
  return `extended move — ${dir} sequence active for ${moveAge} candles (late-stage)`;
}

function plainTrendPhase(phase) {
  if (phase === 'early')      return 'early stage — move just confirmed, room to develop';
  if (phase === 'mid')        return 'mid stage — trend developing, confirmation still required';
  if (phase === 'late')       return 'late stage — extension efficiency dropping, pullback risk rising';
  if (phase === 'exhaustion') return 'exhaustion stage — already overextended, late-entry risk high';
  return 'phase reading pending';
}

function plainContinuationWindow(phase) {
  if (phase === 'early')      return 'early-stage move; conditions may continue developing over the next 1–3 sessions if structure holds';
  if (phase === 'mid')        return 'mid-stage move; follow-through still possible, but confirmation is required before confidence improves';
  if (phase === 'late')       return 'late-stage move; upside/downside extension is becoming less efficient and pullback risk is rising';
  if (phase === 'exhaustion') return 'window closed — late-entry risk high; price is already extended versus the prior structure';
  return 'window reading pending';
}

function patternReferenceFor(rank) {
  const phase = rank && rank.movePhase;
  if (phase === 'early') {
    return 'breakout → calm retest → hold → continuation';
  }
  if (phase === 'mid') {
    return rank.direction === 'Bullish'
      ? 'higher high → shallow pullback → higher low → next push'
      : 'lower low → shallow bounce → lower high → next push down';
  }
  if (phase === 'late') {
    return 'extension → narrow consolidation → final push (low-quality entry zone)';
  }
  if (phase === 'exhaustion') {
    return 'late extension → mean-reversion risk → fresh structure cycle required';
  }
  return 'pattern reference pending';
}

// ── CHART-JARGON TRANSLATOR ─────────────────────────────────
// Doctrine (operator directive 2026-05-12): the user-facing body
// must NOT carry raw chart-analyst abbreviations. Engine-produced
// reasons can name HH/HL, HTF/LTF, VWAP etc. (they're internally
// useful); we translate them at presentation time so a Level-1
// reader sees plain English. Internal logs / engine state stay
// untouched.
function _translateChartJargon(input) {
  if (input == null) return input;
  let s = String(input);
  // Multi-word and abbreviation expansions. Order matters: longer
  // patterns first so "HH/HL" is caught before isolated "HL".
  s = s.replace(/\bHH\/HL\b/g, 'higher highs and higher lows');
  s = s.replace(/\bLH\/LL\b/g, 'lower highs and lower lows');
  s = s.replace(/\bHTF\b/g,    'higher timeframe');
  s = s.replace(/\bLTF\b/g,    'lower timeframe');
  s = s.replace(/\bVWAP\b/g,   'session volume-weighted average price (VWAP)');
  s = s.replace(/×\s*baseline\b/g, '× the prior-bar average');
  s = s.replace(/\bsection\s+avg\b/gi, 'section average');
  s = s.replace(/\bsame[-\s]direction\s+higher[-\s]timeframe\s+bar\s+yet\b/gi,
                'confirmed bar in that direction on the higher timeframe yet');
  return s;
}

// Standout reason — operator directive 2026-05-12: enrich with
// actual evidence, not "early stage · score · bullish". Anchor
// to the structure read + move age + speed + recent level when
// available so a Level-1 reader can see WHY this candidate stood
// out, not just a generic phase label.
function _standoutReason(s) {
  const phaseHead = plainTrendPhase(s.movePhase).split(' — ')[0];
  const dir = s.direction ? s.direction.toLowerCase() : 'neutral';
  const structureTxt = _translateChartJargon(s.structureState || '').trim();
  const ageTxt = (s.moveAge && s.moveAge > 0)
    ? `${dir} sequence active for ${s.moveAge} ${s.moveAge === 1 ? 'candle' : 'candles'}`
    : `${dir} move just confirming`;
  const speedTxt = (s.moveSpeed != null && Number.isFinite(s.moveSpeed))
    ? `momentum ${s.moveSpeed}× the prior-bar average`
    : null;
  const evidenceParts = [
    `${phaseHead}, score ${s.score}/10`,
    structureTxt && structureTxt.length ? `structure read: ${structureTxt}` : null,
    ageTxt,
    speedTxt,
    `section: ${s.sectionLabel}`,
  ].filter(Boolean);
  // Anchor level (if the partial-availability 1D extreme is wired)
  // gives the reader a concrete number to look up on the chart.
  const ev = s.evidenceAnchors;
  if (ev && ev.availability !== 'pending') {
    const anchor = s.direction === 'Bearish' ? ev.recentLow : ev.recentHigh;
    if (anchor && anchor.priceText) {
      evidenceParts.push(`recent ${s.direction === 'Bearish' ? 'low' : 'high'} reference ${anchor.priceText}`);
    }
  }
  return evidenceParts.join('; ');
}

// Format the next-review timestamp. Default cadence is 15 minutes,
// matching the Dark Horse scheduler.
function nextReviewLine(nowMs, intervalMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const interval = Number.isFinite(intervalMs) ? intervalMs : 15 * 60 * 1000;
  const nextAt = new Date(now + interval);
  const iso = nextAt.toISOString().replace('T', ' ');
  return iso.slice(0, 16) + ' UTC';
}

// User-facing constants. Reused by the digest builder + harness.
const DH_CRITERIA_PARAGRAPH =
  '**Dark Horse criteria:** ATLAS FX regularly scans the global markets every 15 minutes to identify markets and instruments showing unusually strong or improving movement, clean structure, strong momentum, or early signs of a developing trend. The list highlights candidates worth closer review at that scan time. ⭐ marks the strongest standouts from the current group.';

// ── NEW-SCAN BOUNDARY ─────────────────────────────────────────
// Operator directive 2026-05-12. A 4-line boundary block sits at
// the very top of every new digest so the Discord channel reader
// can clearly see where the previous scan ends and the next scan
// begins. Renders on Part 1 only; the chunker's per-chunk Part
// header (🐎 … — Part X/N) sits BELOW this boundary on Part 1
// and replaces it on Parts 2..N.
function _fmtScanTimeBoundary(nowMs) {
  const t = Number.isFinite(nowMs) ? nowMs : Date.now();
  const pad = n => (n < 10 ? '0' : '') + n;
  const utc = new Date(t);
  const utcText  = `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())} UTC`;
  // AWST = UTC+8, fixed offset, no DST.
  const awst = new Date(t + 8 * 3600 * 1000);
  const awstText = `${awst.getUTCFullYear()}-${pad(awst.getUTCMonth() + 1)}-${pad(awst.getUTCDate())} ${pad(awst.getUTCHours())}:${pad(awst.getUTCMinutes())} AWST`;
  return { utc: utcText, awst: awstText };
}
function buildNewScanBoundary(nowMs) {
  const t = _fmtScanTimeBoundary(nowMs);
  return [
    '━━━━━━━━━━━━━━━━━━━━',
    '🐎 **NEW DARK HORSE SCAN**',
    `Scan time: ${t.utc} / ${t.awst}`,
    '━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');
}

// Full chart-pattern glossary (ATLAS education-layer doctrine
// 2026-05-12). Every technical phrase used in a candidate card
// must appear in this glossary OR be paired with an inline
// chart-level + visual reference per the doctrine. Footer-rendered
// once per digest; chunker preserves it intact.
const DH_CHART_GLOSSARY = [
  '### Glossary — chart-pattern terms used above',
  '',
  '**Recent intraday high area:** the highest price reached earlier in the current session before price pulled back. For longs, this is the level price must break and hold above.',
  '**Recent intraday low area:** the lowest price reached earlier in the current session before price bounced. For shorts, this is the level price must break and hold below.',
  '**Breakout:** a candle on the named timeframe (e.g. 15m) CLOSES on the directional side of the level — body close, not just a wick. A wick alone does not count.',
  '**Calm retest:** price comes back toward the breakout level without sharp opposite-direction pressure and without a full body close back through the level.',
  '**Retest holds:** price stays on the breakout side and the next candle\'s body close confirms it.',
  '**Invalidation:** a full candle body close back through the breakout / retest area on the named timeframe — the read weakens, not "stops out".',
  '**Continuation window:** the typical number of sessions during which the read can develop, given the move phase. The session definition is asset-class-specific (NY equity days for stocks; Sydney/Tokyo/London/NY for FX/metals).',
].join('\n');

// ── PRE-RADAR / NEAR-MISS / SUPPORTING INTELLIGENCE ──────────
// Doctrine (operator directive 2026-05-12): quiet scans should
// not feel empty. Below the main section radar we render five
// supporting-intelligence blocks: Pre-Radar (early/mid-phase
// developmental signals), Near-Miss (score 6–7 close to WATCH),
// Quiet Market Reason, What ATLAS Is Waiting For, Universe
// Coverage Summary. PRESENTATION LAYER ONLY — does NOT alter
// scoring, thresholds, scheduler, transport, cooldown, or the
// ranking foundation. No forced candidates; no lowered bars.
//
// Selection rules (disjoint by score band):
//   Pre-Radar  = score === 5 AND movePhase ∈ {early, mid}
//   Near-Miss  = score ∈ {6, 7}
// A candidate appears in at most one section.
//
// Sort + cap:
//   Pre-Radar — sorted by moveSpeed desc (most-developing first);
//                cap 3.
//   Near-Miss — sorted by score desc, then moveSpeed desc; cap 3.

function _shapeInternalRecord(c) {
  // Internal candidates arrive from runDarkHorseScan as raw scan
  // results: { symbol, score, direction, status, summary, reasons,
  //   moveSpeed?, moveAge?, movePhase? }. We project a tiny
  //   presentation record so the section builders don't reach into
  //   engine-shape details.
  return {
    symbol: c && c.symbol,
    score:  Number.isFinite(c && c.score) ? c.score : 0,
    direction: (c && c.direction) || 'neutral',
    sectionLabel: SECTION_LABEL[classifyToSection(c && c.symbol)] || 'Other',
    section: classifyToSection(c && c.symbol),
    summary: (c && c.summary) || '',
    reasons: (c && c.reasons) || [],
    moveSpeed: Number.isFinite(c && c.moveSpeed) ? c.moveSpeed : null,
    moveAge:   Number.isFinite(c && c.moveAge) ? c.moveAge : null,
    movePhase: (c && c.movePhase) || null,
  };
}

function selectPreRadarCandidates(internalArr) {
  // Pre-Radar = score 5 AND phase early/mid. Disjoint from Near-Miss.
  if (!Array.isArray(internalArr)) return [];
  const filtered = internalArr
    .map(_shapeInternalRecord)
    .filter(r => r.score === 5);
  // If movePhase was enriched (1D candles available during ranking),
  // restrict to early/mid. If movePhase wasn't computed for the
  // raw internal records (engine sometimes hasn't enriched yet at
  // this layer), keep them all — score === 5 is sufficient floor.
  const phaseFiltered = filtered.filter(r =>
    r.movePhase == null
    || r.movePhase === 'early'
    || r.movePhase === 'mid'
  );
  return phaseFiltered
    .sort((a, b) => (b.moveSpeed || 0) - (a.moveSpeed || 0))
    .slice(0, 3);
}

function selectNearMissCandidates(internalArr) {
  // Near-Miss = score 6 or 7. Disjoint from Pre-Radar.
  if (!Array.isArray(internalArr)) return [];
  return internalArr
    .map(_shapeInternalRecord)
    .filter(r => r.score === 6 || r.score === 7)
    .sort((a, b) => (b.score - a.score) || ((b.moveSpeed || 0) - (a.moveSpeed || 0)))
    .slice(0, 3);
}

function buildPreRadarBlock(preRadar) {
  if (!preRadar || preRadar.length === 0) return null;
  const lines = ['### 🛰️ Pre-Radar / Building pressure'];
  lines.push('');
  lines.push('_Below the publication threshold but showing early developmental signals. Not promoted — pressure visible but incomplete._');
  lines.push('');
  for (const r of preRadar) {
    const speed = r.moveSpeed != null ? `${r.moveSpeed}× the prior-bar average` : 'speed pending';
    const dir   = r.direction === 'Bullish' ? '↑' : r.direction === 'Bearish' ? '↓' : '→';
    const phase = r.movePhase || 'phase pending';
    const why   = _translateChartJargon((r.summary || 'composite criteria met').toString());
    lines.push(`- **${r.symbol}** ${dir}  ·  ${r.sectionLabel}  ·  score ${r.score}/10  ·  phase ${phase}  ·  momentum ${speed}`);
    lines.push(`  Building: ${why}. Confirmation pending — one structure step away from promotion.`);
  }
  return lines.join('\n');
}

function buildNearMissBlock(nearMiss) {
  if (!nearMiss || nearMiss.length === 0) return null;
  const lines = ['### 🎯 Near-Miss — below WATCH threshold'];
  lines.push('');
  lines.push('_Worth monitoring. Not promoted yet. Awaiting confirmation._');
  lines.push('');
  for (const r of nearMiss) {
    const dir = r.direction === 'Bullish' ? '↑' : r.direction === 'Bearish' ? '↓' : '→';
    const why = _translateChartJargon((r.summary || 'composite criteria met').toString());
    const gap = 8 - r.score; // WATCH threshold = 8
    const gapText = gap === 1 ? 'one point' : `${gap} points`;
    lines.push(`- **${r.symbol}** ${dir}  ·  ${r.sectionLabel}  ·  score ${r.score}/10 (${gapText} below the WATCH threshold of 8/10)`);
    lines.push(`  Reading: ${why}. Confirmation pending before promotion.`);
  }
  return lines.join('\n');
}

function buildQuietMarketReason(volatility, internalArr, ignoredArr) {
  // Synthesize a 1–2 sentence diagnostic explaining WHY no
  // standout published. Uses only existing engine data — no
  // scoring change, no threshold change.
  const internalCount = Array.isArray(internalArr) ? internalArr.length : 0;
  const ignoredCount  = Array.isArray(ignoredArr)  ? ignoredArr.length  : 0;
  const volLevel = (volatility && volatility.level) || 'quiet';
  const reasons = [];
  if (volLevel === 'quiet')   reasons.push('volatility is quiet across the universe');
  if (volLevel === 'elevated') reasons.push('volatility is elevated but structure has not aligned');
  if (volLevel === 'extreme')  reasons.push('volatility is extreme — structure expanding too fast for clean confirmation');
  if (internalCount === 0 && ignoredCount > 0) {
    reasons.push('no candidate cleared the near-threshold score (5/10)');
  } else if (internalCount > 0 && internalCount < 3) {
    reasons.push(`${internalCount} ${internalCount === 1 ? 'candidate is' : 'candidates are'} building near the threshold but none have confirmed clean structure`);
  } else if (internalCount >= 3) {
    reasons.push(`${internalCount} candidates are building near the threshold but momentum/structure alignment is mixed`);
  }
  if (ignoredCount > 0 && internalCount === 0) {
    reasons.push('the rest of the universe is showing weak or contracting movement');
  }
  if (reasons.length === 0) {
    reasons.push('conditions remain below the publication threshold this cycle');
  }
  const lines = ['### 🤫 Why no standout published'];
  lines.push('');
  lines.push(reasons.map(r => '_' + r.charAt(0).toUpperCase() + r.slice(1) + '._').join(' '));
  return lines.join('\n');
}

function buildWaitingForBlock(internalArr) {
  // What ATLAS is waiting for — synthesize the single most-common
  // required confirmation pattern across the internal universe.
  const lines = ['### ⏳ What ATLAS is waiting for'];
  lines.push('');
  if (!Array.isArray(internalArr) || internalArr.length === 0) {
    lines.push('_Awaiting a candidate that crosses the near-threshold score (5/10) with clean directional structure._');
    return lines.join('\n');
  }
  // Asset-class concentration tells us which timeframe matters
  // most. Count internals per section, pick the dominant section,
  // surface its confirmation timeframe.
  const sectionCounts = {};
  for (const c of internalArr) {
    const sec = classifyToSection(c.symbol);
    sectionCounts[sec] = (sectionCounts[sec] || 0) + 1;
  }
  const dominant = Object.entries(sectionCounts)
    .sort((a, b) => b[1] - a[1])[0];
  const domSec = dominant ? dominant[0] : null;
  const conditions = [];
  if (domSec === SECTIONS.FX_MAJORS || domSec === SECTIONS.FX_CROSSES) {
    conditions.push('A clean 5m or 15m body close above the recent intraday high (longs) or below the intraday low (shorts), followed by a calm retest that holds.');
  } else if (domSec === SECTIONS.INDICES) {
    conditions.push('A 15m or 1H body close above the recent session high (longs) or below the session low (shorts), with the retest holding and volume not collapsing.');
  } else if (domSec === SECTIONS.COMMODITIES) {
    conditions.push('A 1H body close above the recent intraday high (longs) or below the intraday low (shorts), with an ATR-respecting retest that holds.');
  } else if (domSec === SECTIONS.EQUITIES) {
    conditions.push('A 5m or 15m body close above the recent intraday high (longs) or below the intraday low (shorts), with the retest holding above (or below) the prior-session reference level.');
  } else {
    conditions.push('A higher-timeframe body close above the recent significant high (longs) or below the significant low (shorts), with a retest that holds.');
  }
  conditions.push('Higher-timeframe and lower-timeframe direction should agree before any near-threshold candidate is promoted.');
  conditions.push('Momentum should expand (rather than contract) into the breakout candle — confirmation, not exhaustion.');
  for (const c of conditions) lines.push('- ' + c);
  return lines.join('\n');
}

function buildUniverseCoverageBlock(opts, ranking) {
  // Universe Coverage Summary. Counts only — no scoring, no
  // threshold change. opts carries internal + ignored + universeSize
  // from the engine via the digest call site.
  const internalArr = (opts && Array.isArray(opts.internal)) ? opts.internal : [];
  const ignoredArr  = (opts && Array.isArray(opts.ignored))  ? opts.ignored  : [];
  const universeSize = Number.isFinite(opts && opts.universeSize)
    ? opts.universeSize
    : (internalArr.length + ignoredArr.length);
  const top = Array.isArray(ranking && ranking.top10) ? ranking.top10 : [];

  // Per-section health from the top10 (already enriched). For the
  // ignored / internal arrays we use lighter section classification.
  const sectionAvg = {};
  function bump(sec, score) {
    if (!sectionAvg[sec]) sectionAvg[sec] = { sum: 0, n: 0 };
    sectionAvg[sec].sum += score;
    sectionAvg[sec].n += 1;
  }
  for (const r of top) bump(r.section, r.score);
  for (const c of internalArr) bump(classifyToSection(c.symbol), c.score);
  // Find strongest + weakest section (only among sections that
  // had at least one candidate ≥ 5/10).
  const sectionsRanked = Object.entries(sectionAvg)
    .filter(([, v]) => v.n > 0)
    .map(([sec, v]) => ({ section: sec, avg: v.sum / v.n, count: v.n }))
    .sort((a, b) => b.avg - a.avg);
  const strongest = sectionsRanked[0] || null;
  const weakest   = sectionsRanked.length > 1 ? sectionsRanked[sectionsRanked.length - 1] : null;

  // Concentration: if a single section accounts for ≥60% of
  // internal+top10 candidates, it's concentrated; otherwise broad.
  const totalActive = top.length + internalArr.length;
  let concentration = 'broad across sections';
  if (strongest && totalActive >= 3) {
    const dominantShare = strongest.count / totalActive;
    if (dominantShare >= 0.6) {
      concentration = `concentrated in ${SECTION_LABEL[strongest.section] || strongest.section} (${Math.round(dominantShare * 100)}% of active candidates)`;
    }
  }

  const lines = ['### 📊 Universe coverage'];
  lines.push('');
  lines.push(`- **Symbols scanned:** ${universeSize}`);
  lines.push(`- **Below near-threshold (score < 5/10):** ${ignoredArr.length}`);
  lines.push(`- **Near-threshold (score 5–7/10):** ${internalArr.length}`);
  lines.push(`- **At publication threshold (score ≥ 8/10):** ${top.filter(r => r.score >= 8).length}`);
  if (strongest) {
    lines.push(`- **Strongest section:** ${SECTION_LABEL[strongest.section] || strongest.section} (avg score ${strongest.avg.toFixed(1)}/10 across ${strongest.count} candidate${strongest.count === 1 ? '' : 's'})`);
  } else {
    lines.push('- **Strongest section:** none currently meet near-threshold criteria');
  }
  if (weakest && weakest.section !== (strongest && strongest.section)) {
    lines.push(`- **Weakest section with activity:** ${SECTION_LABEL[weakest.section] || weakest.section} (avg score ${weakest.avg.toFixed(1)}/10)`);
  }
  lines.push(`- **Volatility concentration:** ${concentration}`);
  return lines.join('\n');
}

// ── LEARNING LINKS — top-of-digest terminology row ────────────
// Doctrine (operator directive 2026-05-12): a single compact
// Learning Links row sits IMMEDIATELY below the digest heading,
// before the criteria paragraph. Body text stays clean — NO inline
// hyperlinks are scattered through paragraphs. When URLs are
// eventually wired, they replace the plain-term entries in this
// row only; the body never carries inline links.
//
// Plain-term form is the current default since per-term URL
// routing is not yet wired (operator rule 5: do not invent fake
// URLs). When URLs land, pass a urlMap = { 'Calm retest': 'https://…' }
// to buildLearningLinksBlock(urlMap) and the row renders as Markdown
// links automatically.
const DH_LEARNING_LINKS_TERMS = [
  'Dark Horse candidate',
  'WATCH candidate',
  'Higher high / higher low',
  'Breakout',
  'Calm retest',
  'Invalidation',
  'Continuation window',
  'Session',
  'Relative strength',
];

function buildLearningLinksBlock(urlMap) {
  // urlMap: optional { term: 'https://…' } map. When absent or
  // empty, every term renders plain (rule 5). When present, terms
  // with a wired URL render as Markdown links; terms without stay
  // plain (rule 6 — never invent a URL).
  const map = urlMap && typeof urlMap === 'object' ? urlMap : {};
  const rendered = DH_LEARNING_LINKS_TERMS.map(term => {
    const url = map[term];
    return (typeof url === 'string' && /^https?:\/\//.test(url))
      ? `[${term}](${url})`
      : term;
  }).join(' · ');
  const anyWired = DH_LEARNING_LINKS_TERMS.some(t => {
    const u = map[t];
    return typeof u === 'string' && /^https?:\/\//.test(u);
  });
  // Internal pending note when no URLs are wired — operator-only,
  // not shown to users. The visible row is just "Learning links: …"
  // with the term list. Definitions live in the footer glossary
  // (and behind URLs once wired).
  return {
    text: `**Learning links:** ${rendered}`,
    linkRoutingStatus: anyWired ? 'partial' : 'pending',
  };
}

// Backwards-compat alias retained so existing test fixtures and
// downstream consumers that pulled DH_PATTERN_GLOSSARY still resolve.
const DH_PATTERN_GLOSSARY = DH_CHART_GLOSSARY;

// Compact visual diagram (ASCII inside a code fence) — one per
// candidate, keyed to direction. The diagram shows the 5-event
// breakout / retest sequence the user must look for on the chart.
function compactVisualDiagram(direction) {
  if (direction === 'Bearish') {
    return [
      '```',
      'Old low:        ─────────────',
      'Breakout candle: body CLOSES below the old low',
      'Retest:          price rallies back to the old low',
      'Hold:            next candle body stays BELOW the old low',
      'Failure:         a candle body CLOSES back ABOVE the old low',
      '```',
    ].join('\n');
  }
  return [
    '```',
    'Old high:        ─────────────',
    'Breakout candle: body CLOSES above the old high',
    'Retest:          price pulls back to the old high',
    'Hold:            next candle body stays ABOVE the old high',
    'Failure:         a candle body CLOSES back BELOW the old high',
    '```',
  ].join('\n');
}

// Build the per-candidate Chart evidence block. Uses real levels
// + dates when evidenceAnchors.availability is 'partial' or 'full';
// honest "pending" + follow-up note otherwise.
function buildChartEvidenceBlock(rank) {
  const ev = rank && rank.evidenceAnchors;
  if (!ev || ev.availability === 'pending') {
    return [
      'Chart evidence: exact intraday level pending — the current data packet does not include enough 5m/15m anchor detail to publish a timestamped level.',
      'Required follow-up: wire 5m/15m OHLC anchor extraction for recent high, breakout close, retest touch, hold close, and invalidation level.',
    ];
  }
  const isShort = rank.direction === 'Bearish';
  const anchor  = isShort ? ev.recentLow : ev.recentHigh;
  const inv     = ev.invalidation;
  const lines = [];
  lines.push('Chart evidence:');
  if (anchor && anchor.priceText) {
    lines.push(
      `- Recent intraday ${isShort ? 'low' : 'high'} area: ${anchor.priceText} ` +
      `(${anchor.source}; ` +
      `date ${anchor.dateUtc} UTC / ${anchor.dateAwst} AWST).`
    );
    lines.push(`  Note: ${anchor.note}.`);
  }
  // Breakout / retest / hold timestamps require 15m/5m data — staged.
  lines.push(
    '- Breakout evidence: 15m/5m intraday close timestamp pending — anchor wiring required ' +
    'before a candle-close time can be published. Chart confirmation remains pending ' +
    'until 15m/5m anchor wiring is added.'
  );
  lines.push(
    '- Retest evidence: 15m/5m retest-touch timestamp pending — anchor wiring required ' +
    'before the retest hold can be confirmed by the system.'
  );
  lines.push(
    '- Hold evidence: 15m/5m hold-close timestamp pending — anchor wiring required ' +
    'before the system can confirm a body-close hold.'
  );
  if (inv && inv.priceText) {
    lines.push(
      `- Invalidation: a candle body close back ${isShort ? 'above' : 'below'} ` +
      `${inv.priceText} on the ${inv.timeframe} weakens the read.`
    );
    lines.push(`  Rule: ${inv.rule}`);
  }
  return lines;
}

// Visual-pattern prose paired with the ASCII diagram. Keyed to
// direction so the wording mirrors what the operator must see.
function visualPatternProse(direction) {
  if (direction === 'Bearish') {
    return [
      'Visual pattern: intraday low → candle close below low → calm rally back to the level → ' +
      'body stays below → continuation attempt.',
      'Meaning: price breaks below a prior low, returns to check that area, then sellers defend it. ' +
      'That is what "retest holds" means on a short.',
    ];
  }
  return [
    'Visual pattern: intraday high → candle close above high → calm pullback to the level → ' +
    'body stays above → continuation attempt.',
    'Meaning: price breaks above a prior high, returns to check that area, then buyers defend it. ' +
    'That is what "retest holds" means on a long.',
  ];
}

// Canonical display order — kept stable across scans so the
// reader's eye lands on the same section position each cycle.
const SECTION_DISPLAY_ORDER = [
  SECTIONS.FX_MAJORS,
  SECTIONS.FX_CROSSES,
  SECTIONS.INDICES,
  SECTIONS.EQUITIES,
  SECTIONS.COMMODITIES,
  SECTIONS.SAFE_HAVENS,
  SECTIONS.OTHER,
];

function buildExpandedDetail(rank, idx, isStandout) {
  const r = rank;
  const star = isStandout ? '⭐ ' : '';
  // Translate raw chart-analyst abbreviations / jargon at the
  // presentation layer (HH/HL → plain English, × baseline → "× the
  // prior-bar average", section avg → "section average", etc.) so
  // the user surface stays beginner-readable while internal engine
  // outputs keep their concise form.
  const speedStr = r.moveSpeed != null
    ? _translateChartJargon(`${r.moveSpeed}× baseline`)
    : 'speed reading pending';
  const rsStr = r.relativeStrength != null
    ? _translateChartJargon(`${r.relativeStrength}× section avg`)
    : 'relative strength reading pending';
  const breakdownLine = r.scoreBreakdown && r.scoreBreakdown.length
    ? r.scoreBreakdown.map(x => `   • ${_translateChartJargon(x)}`).join('\n')
    : '   • composite criteria met';

  // Continuation window — combine the phase-derived plain-English
  // sentence with the asset-class-specific session text so the user
  // knows what "the next 1-3 sessions" actually means for THIS
  // section. continuationSessionText defaults if the field wasn't
  // set on the rank record (older fixtures).
  const sessionText = r.continuationSessionText || continuationWindowSessionsText(r.section);
  const continuationLine = `Continuation window: ${plainContinuationWindow(r.movePhase)} (sessions = ${sessionText})`;

  // Conditional rows — suppress "Macro / event link: unavailable"
  // (operator directive 2026-05-12 — useless line, just noise).
  // Surface it ONLY when a real link is wired.
  const macroEventLine = (r.macroEventLink
    && !/^unavailable\b/i.test(r.macroEventLink)
    && r.macroEventLink !== '')
    ? `Macro / event link: ${r.macroEventLink}`
    : null;

  const lines = [
    `**${star}#${idx + 1} — ${r.symbol} ${arrowFor(r.direction)}**  ·  Section: ${r.sectionLabel}${r.safeHavenOverlay ? ' · safe-haven overlay' : ''}`,
    `Direction: ${r.direction || 'neutral'}  ·  Score: ${r.score}/10`,
    `Score breakdown:\n${breakdownLine}`,
    `Move strength: ${r.moveStrength}/10  ·  Move speed: ${speedStr}`,
    `Trend age: ${_translateChartJargon(plainTrendAge(r.moveAge, r.direction))}`,
    `Trend phase: ${plainTrendPhase(r.movePhase)}`,
    continuationLine,
    `Late-entry risk: ${r.lateEntryRisk}`,
    `Relative strength vs section: ${rsStr}`,
    `Why flagged: ${_translateChartJargon(r.whyFlagged)}`,
    macroEventLine,
    `Structure state: ${_translateChartJargon(r.structureState)}`,
    `Confirmation requirement: ${_translateChartJargon(r.confirmationRequirement)}`,
    // Chart evidence block — per-candidate price + date stamp where
    // data is wired, honest "pending" + follow-up note otherwise.
    ...buildChartEvidenceBlock(r),
    // Visual pattern — abstract pattern reference, then prose, then
    // ASCII diagram. Three forms so a beginner reader has both the
    // shape (diagram) and the meaning (prose).
    `Pattern reference: ${patternReferenceFor(r)}`,
    ...visualPatternProse(r.direction),
    compactVisualDiagram(r.direction),
    `Why not WATCH: ${r.whyNotWatch}`,
    `Promotion criteria: ${_translateChartJargon(r.promotionTrigger)}`,
    ...renderInvalidationRow(r.invalidationTrigger),
    `ATLAS state: ${r.atlasState}`,
  ];
  return lines.filter(l => l != null).join('\n');
}

// "Invalidation level:" when the source text carries a numeric price,
// "Invalidation condition:" + a "Reference level not published in this
// digest yet." sub-row otherwise. The v1.1 digest currently emits prose
// templates without numeric levels, so the condition branch is the
// expected path; do NOT invent or paraphrase a number when none exists.
function renderInvalidationRow(invalidationText) {
  const text = _translateChartJargon(String(invalidationText || '').trim());
  // Detect a price-like number that is not a parenthesised timeframe
  // such as "(5m/15m)" or "0.6%".
  const priceLikeRe = /(?<![\d.\/(])\b\d{1,7}(?:\.\d{1,8})\b(?![%\dm\)])/;
  const hasNumericLevel = priceLikeRe.test(text);
  if (hasNumericLevel) {
    return [`Invalidation level: ${text}`];
  }
  // No numeric level in the source template. Operator directive
  // 2026-05-12: suppress the "Reference level not published"
  // sub-row entirely — the Chart evidence block above already
  // surfaces a price-stamped invalidation level (or an honest
  // "pending" note) so a duplicate placeholder is just noise.
  return [
    `Invalidation condition: ${text}`,
  ];
}

function buildCompactDetail(rank, idx) {
  return `${idx + 1}. **${rank.symbol}** ${arrowFor(rank.direction)} — ${rank.sectionLabel} · ${rank.score}/10 · ${rank.whyFlagged} · ${rank.whyNotWatch}`;
}

function buildRankedMovementDigestPayload(ranking, volatility, opts) {
  opts = opts || {};
  const top = Array.isArray(ranking && ranking.top10) ? ranking.top10 : [];

  // ── Standouts (top 2 overall) ──
  // Selection uses _compareForStandout: score primary, then phase
  // (early > mid > late > exhaustion), then late-entry risk, then
  // move speed, then structure-state completeness, then relative
  // strength. PRESENTATION LAYER ONLY — does not touch scores.
  const standouts = selectStandouts(top, 2);
  const standoutSet = new Set(standouts.map(s => s.symbol));
  const standoutLines = standouts.length
    ? standouts.map((s, i) => {
        const rank = i === 0 ? 'strongest' : i === 1 ? 'second strongest' : `#${i + 1}`;
        return `- ⭐ #${i + 1} ${s.symbol} — ${rank} current Dark Horse reading because ${_standoutReason(s)}`;
      }).join('\n')
    : '_No qualifying standouts this scan._';

  // ── Section grouping (up to 2 per section) ──
  // rankCandidates already enforces sectionCap: 2 by default. We
  // re-clip here defensively so any future sectionCapMax override
  // cannot bleed into the digest display.
  const bySection = {};
  for (const r of top) {
    if (!bySection[r.section]) bySection[r.section] = [];
    bySection[r.section].push(r);
  }
  for (const sec of Object.keys(bySection)) {
    bySection[sec] = bySection[sec].slice(0, 2);
  }

  const sectionBlocks = [];
  let displayIdx = 0;
  for (const sec of SECTION_DISPLAY_ORDER) {
    const rows = bySection[sec] || [];
    if (!rows.length) continue;
    const rendered = rows.map(r => {
      const idx = displayIdx++;
      return buildExpandedDetail(r, idx, standoutSet.has(r.symbol));
    }).join('\n\n──\n\n');
    sectionBlocks.push(`### ${SECTION_LABEL[sec]}\n\n${rendered}`);
  }

  // ── Header / state / footer ──
  // Operator directive 2026-05-12 (live-evidence iteration): when
  // no sections meet publication thresholds, SUPPRESS the
  // "Sections scanned:" line entirely (no "unavailable" filler).
  // The Universe Coverage block below carries the per-section
  // accounting in that case.
  const sectionsLine = ranking.sectionsScanned && ranking.sectionsScanned.length
    ? ranking.sectionsScanned.map(s => SECTION_LABEL[s] || s).join(' · ')
    : null;

  // Layman-first VIX wording. Operator directive 2026-05-12:
  // bare "unavailable" is banned from the user-facing surface —
  // use "reading pending" so the absence reads as intentional.
  const vixLine = volatility && volatility.vixLevel
    ? `market fear / volatility gauge (VIX) is ${String(volatility.vixLevel).toLowerCase()}`
    : 'market fear / volatility gauge (VIX) reading pending';

  const capsApplied = (ranking && ranking.sectionCapsApplied && ranking.sectionCapsApplied.length)
    ? ranking.sectionCapsApplied.join(',')
    : null;
  // "Displayed candidates:" header — operator directive 2026-05-12.
  // Replaces "Top movers: X (section caps: none)". The section-caps
  // suffix is OMITTED entirely when no cap fired (no 'section caps:
  // none' filler). When a cap did fire, the suffix surfaces it
  // because that's actually informative.
  const displayedCandidatesLine = capsApplied
    ? `**Displayed candidates:** ${top.length} (section caps applied to: ${capsApplied})`
    : `**Displayed candidates:** ${top.length}`;

  const nextReview = nextReviewLine(opts.now, opts.intervalMs);

  const sectionsBody = sectionBlocks.length
    ? sectionBlocks.join('\n\n') + '\n\n'
    : '_No section data this scan._\n\n';

  // Learning Links row — operator directive 2026-05-12: sits
  // IMMEDIATELY under the heading, before the criteria paragraph.
  // Plain terms until per-term URLs are wired (rule 5). Pass
  // opts.learningLinkUrls = { 'Calm retest': 'https://…' } to enable
  // Markdown links for specific terms. Body text MUST stay clean —
  // no inline hyperlinks scattered through paragraphs.
  const learningLinks = buildLearningLinksBlock(opts.learningLinkUrls);

  // ── Pre-Radar / Near-Miss supporting-intelligence layer ─────
  // Operator directive 2026-05-12. Renders below the main section
  // radar when standouts exist; becomes the primary useful content
  // when monitoring-only (no top10). Uses ONLY data that already
  // exists in the engine scan output (`opts.internal`, `opts.ignored`,
  // `opts.universeSize`). No threshold / scoring / cooldown change.
  const internalArr = (opts && Array.isArray(opts.internal)) ? opts.internal : [];
  const ignoredArr  = (opts && Array.isArray(opts.ignored))  ? opts.ignored  : [];
  const preRadar  = selectPreRadarCandidates(internalArr);
  const nearMiss  = selectNearMissCandidates(internalArr);
  const supportingBlocks = [
    buildPreRadarBlock(preRadar),
    buildNearMissBlock(nearMiss),
    buildQuietMarketReason(volatility, internalArr, ignoredArr),
    buildWaitingForBlock(internalArr),
    buildUniverseCoverageBlock(opts, ranking),
  ].filter(b => b != null && b !== '');
  const supportingBody = supportingBlocks.length
    ? supportingBlocks.join('\n\n') + '\n\n'
    : '';

  // Monitoring-only mode (top10 empty): the supporting-intelligence
  // layer IS the primary useful content per the operator directive
  // ("If no standouts exist, make Pre-Radar/Near-Miss the main
  // useful content."). We suppress the empty Current-standouts /
  // section-data placeholders so the digest reads as intentional
  // institutional behaviour, not a wall of "_No X this scan._"
  // filler. The supporting blocks still render in their natural
  // position below the state header.
  const isMonitoringOnly = top.length === 0;
  const renderedStandoutsBlock = isMonitoringOnly && supportingBlocks.length > 0
    ? ''
    : `### ⭐ Current standouts\n${standoutLines}\n\n`;
  const renderedSectionsBody = isMonitoringOnly && supportingBlocks.length > 0
    ? ''
    : sectionsBody;

  // Operator directive 2026-05-12 (live-evidence iteration): the
  // 4-line "NEW DARK HORSE SCAN" boundary must render ABOVE the
  // per-chunk Part X/Y header on Part 1 only. We emit it as a
  // separate `firstChunkPrefix` field so the chunker can splice
  // it in front of chunk 0's Part label. Keeping it OUT of the
  // body means the chunker's existing header strip + Part-label
  // injection logic stays clean.
  const firstChunkPrefix = buildNewScanBoundary(opts.now);

  // Volatility level fallback — "unavailable" is banned from
  // user-facing output. Use "reading pending" instead so the
  // missing reading reads as intentional.
  const volatilityLevel = (volatility && volatility.level)
    ? volatility.level
    : 'reading pending';

  // Conditionally render the Sections-scanned line — suppress
  // entirely when sectionsLine is null per the operator directive.
  const sectionsLineRendered = sectionsLine
    ? `**Sections scanned:** ${sectionsLine}\n`
    : '';

  const content =
    `🐎 **DARK HORSE — GLOBAL MOVER RADAR (v1.1)**\n\n` +
    `${learningLinks.text}\n\n` +
    `${DH_CRITERIA_PARAGRAPH}\n\n` +
    `**State:** Monitoring only · no confirmed watch candidate this cycle.\n` +
    `**Volatility:** ${volatilityLevel} · ${vixLine}\n` +
    sectionsLineRendered +
    `${displayedCandidatesLine}\n\n` +
    renderedStandoutsBlock +
    renderedSectionsBody +
    supportingBody +
    `${DH_PATTERN_GLOSSARY}\n\n` +
    `⏭️ Next review: ${nextReview}.\n` +
    `⚠️ Conditions are moving but entry quality is not confirmed. Late-entry risk varies by phase per candidate. Reassess against the per-candidate confirmation criteria at the next review.`;

  return {
    content,
    kind: 'movement_digest_v1_1',
    linkRoutingStatus: learningLinks.linkRoutingStatus,
    firstChunkPrefix,  // rendered before the Part 1/N label on Part 1 only
  };
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

  // Section radar + standouts surface — exported for the
  // qa:dh-radar harness. selectStandouts and plain* helpers are
  // pure functions over a rank record; they can be unit-tested
  // without driving a full scan. SECTION_DISPLAY_ORDER is the
  // canonical render order used by the digest builder.
  selectStandouts, _compareForStandout,
  plainTrendAge, plainTrendPhase, plainContinuationWindow,
  patternReferenceFor, nextReviewLine,
  DH_CRITERIA_PARAGRAPH, DH_PATTERN_GLOSSARY,
  // Education layer + evidence anchors (2026-05-12) — exported for
  // the qa:dh-education harness. buildEvidenceAnchors is the
  // partial-availability extractor over 1D HTF candles; the
  // remaining helpers render the per-candidate visual + glossary
  // surface.
  buildEvidenceAnchors,
  continuationWindowSessionsText,
  compactVisualDiagram,
  buildChartEvidenceBlock,
  visualPatternProse,
  DH_CHART_GLOSSARY,
  // Learning Links row — doctrine correction 2026-05-12. Plain
  // terms now; per-term URL wiring follows. Exported for the
  // qa:dh-education harness assertions on position + content.
  DH_LEARNING_LINKS_TERMS,
  buildLearningLinksBlock,
  // Pre-Radar / Near-Miss supporting-intelligence layer
  // (operator directive 2026-05-12). Exported for the
  // qa:dh-pre-radar harness.
  selectPreRadarCandidates,
  selectNearMissCandidates,
  buildPreRadarBlock,
  buildNearMissBlock,
  buildQuietMarketReason,
  buildWaitingForBlock,
  buildUniverseCoverageBlock,
  SECTION_DISPLAY_ORDER,
};
