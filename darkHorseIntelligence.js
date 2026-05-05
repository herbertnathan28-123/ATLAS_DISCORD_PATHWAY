'use strict';
// ============================================================
// ATLAS FX — DARK HORSE v1.1 GLOBAL MOVER INTELLIGENCE
// ============================================================
// Pure-function analytical layer that converts raw scoreInstrument
// output into a global-mover intelligence ranking. Adds:
//
//   - Section classification (FX major / cross / index / commodity /
//     equity / safe-haven).
//   - Move age, phase, strength, speed, late-entry risk,
//     continuation window estimates.
//   - Structure state + confirmation / invalidation / window detail
//     (timeframe-aware).
//   - Cause hypothesis with explicit `causeConfidence` (low /
//     moderate / high / unavailable). Never invents a headline; if
//     no live news/event signal exists it says so.
//   - Relative strength inside a section (leader / above_avg /
//     in_line / below_avg).
//   - Score breakdown + late-entry penalty + FOMO penalty.
//   - Section-capped top-10 ranker.
//   - whyFlagged / whyWatch / whyNotWatch / promotionTrigger /
//     invalidation per candidate.
//   - v1.1 movement digest formatter (regime header + market map +
//     top 3 expanded + 4-10 compact).
//   - v1.1 WATCH payload formatter (full intelligence block).
//
// Doctrine:
//   - Dark Horse is the global movement radar, NOT Jane and NOT an
//     entry engine.
//   - Movement alone is awareness only. Structure detail, cause
//     confidence, late-entry risk and continuation window are
//     mandatory on every expanded candidate.
//   - No banned wording (authorised / permitted / etc.) — handled
//     here at source AND filtered again by darkHorseFomoControl
//     before send.
// ============================================================

// ── SECTIONS ──────────────────────────────────────────────────
// Single source of truth for section assignment. Order matters
// because some symbols match multiple regexes (e.g. AAPL is both
// equity and US bloc).
const SECTIONS = Object.freeze({
  FX_MAJOR:   'FX Major',
  FX_CROSS:   'FX Cross',
  INDEX:      'Index',
  COMMODITY:  'Commodity',
  EQUITY:     'Equity',
  SAFE_HAVEN: 'Safe Haven'
});
const SECTION_KEYS = Object.freeze({
  FX_MAJOR:   'FX_MAJOR',
  FX_CROSS:   'FX_CROSS',
  INDEX:      'INDEX',
  COMMODITY:  'COMMODITY',
  EQUITY:     'EQUITY',
  SAFE_HAVEN: 'SAFE_HAVEN'
});

const FX_MAJORS = new Set([
  'EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD'
]);
const FX_CROSSES = new Set([
  'EURGBP','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY','NZDJPY',
  'EURAUD','EURCAD','EURCHF','GBPAUD','GBPCAD','GBPCHF',
  'AUDCAD','AUDCHF','AUDNZD','CADCHF','NZDCAD','NZDCHF'
]);
const INDICES = new Set([
  'NAS100','US500','US30','DJI','SPX','NDX',
  'GER40','UK100','HK50','JPN225','AUS200'
]);
const COMMODITIES = new Set([
  'XAUUSD','XAGUSD','XAUEUR','XAGEUR','USOIL','WTI','BRENT','BCOUSD','NATGAS'
]);
const EQUITIES = new Set([
  'AMD','NVDA','AAPL','MSFT','META','GOOGL','AMZN','TSLA','ASML','MICRON','MU',
  'AVGO','TSM','QCOM','INTC','SMCI'
]);
// Safe-haven ASSETS (a subset overlaps with commodities/FX). When a
// symbol is also a major/cross/commodity, the asset-class section
// wins — safe-haven is reported as a SECONDARY tag, not a primary
// classification.
const SAFE_HAVEN_TAG = new Set([
  'XAUUSD','XAGUSD','USDJPY','USDCHF','EURCHF','CHFJPY'
]);

function classifySection(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (FX_MAJORS.has(s))  return { key: SECTION_KEYS.FX_MAJOR,  label: SECTIONS.FX_MAJOR };
  if (FX_CROSSES.has(s)) return { key: SECTION_KEYS.FX_CROSS,  label: SECTIONS.FX_CROSS };
  if (INDICES.has(s))    return { key: SECTION_KEYS.INDEX,     label: SECTIONS.INDEX };
  if (COMMODITIES.has(s))return { key: SECTION_KEYS.COMMODITY, label: SECTIONS.COMMODITY };
  if (EQUITIES.has(s))   return { key: SECTION_KEYS.EQUITY,    label: SECTIONS.EQUITY };
  // Generic FX detection (6 letters, all alpha)
  if (/^[A-Z]{6}$/.test(s)) return { key: SECTION_KEYS.FX_CROSS, label: SECTIONS.FX_CROSS };
  // Generic equity (1-5 letters)
  if (/^[A-Z]{1,5}$/.test(s)) return { key: SECTION_KEYS.EQUITY, label: SECTIONS.EQUITY };
  return { key: 'UNKNOWN', label: 'Unknown' };
}
function isSafeHaven(symbol) { return SAFE_HAVEN_TAG.has(String(symbol || '').toUpperCase()); }

// ── DIRECTION TRACKING (for move age) ────────────────────────
// Per-symbol record of when the current direction was first seen.
// Resets on direction flip. Memory-only — survives only within a
// single bot process; sufficient for radar scanning over a few
// hours. If no record exists for a symbol, moveAge is reported as
// 'unavailable' rather than fabricated.
const _DIRECTION_STORE = new Map(); // symbol -> { direction, firstSeenAt }
function trackDirection(symbol, direction) {
  if (!symbol || !direction) return;
  const prev = _DIRECTION_STORE.get(symbol);
  if (!prev || prev.direction !== direction) {
    _DIRECTION_STORE.set(symbol, { direction, firstSeenAt: Date.now() });
  }
}
function getMoveAgeMs(symbol, direction) {
  if (!symbol || !direction) return null;
  const rec = _DIRECTION_STORE.get(symbol);
  if (!rec || rec.direction !== direction) return null;
  return Date.now() - rec.firstSeenAt;
}
function _resetDirectionStore() { _DIRECTION_STORE.clear(); } // exported for tests

// ── MOVE STRENGTH (vs typical bar size) ──────────────────────
function avgRange(candles) {
  if (!candles || !candles.length) return 0;
  let sum = 0;
  for (const c of candles) sum += Math.abs(c.high - c.low);
  return sum / candles.length;
}
function avgBody(candles) {
  if (!candles || !candles.length) return 0;
  let sum = 0;
  for (const c of candles) sum += Math.abs(c.close - c.open);
  return sum / candles.length;
}
function moveStrength(htf) {
  // Compare last 5 bars body size to last 20 bars baseline. Uses HTF
  // (1D) where supplied. "Above normal" requires body-expansion.
  if (!htf || htf.length < 25) return 'unavailable';
  const recent5  = htf.slice(-5);
  const baseline = htf.slice(-25, -5);
  const r5 = avgBody(recent5);
  const b5 = avgBody(baseline);
  if (b5 <= 0) return 'unavailable';
  const ratio = r5 / b5;
  if (ratio >= 1.5) return 'above_normal';
  if (ratio >= 1.1) return 'normal';
  return 'weak';
}
function moveSpeed(ltf) {
  // LTF (1H) bar deltas — fast = avg(|close - open|) on last 5 bars
  // is greater than 1.3× the LTF baseline body size.
  if (!ltf || ltf.length < 25) return 'unavailable';
  const recent5  = ltf.slice(-5);
  const baseline = ltf.slice(-25, -5);
  const r5 = avgBody(recent5);
  const b5 = avgBody(baseline);
  if (b5 <= 0) return 'unavailable';
  const ratio = r5 / b5;
  if (ratio >= 1.5) return 'fast';
  if (ratio >= 1.1) return 'steady';
  return 'slow';
}

// ── MOVE AGE → human label ────────────────────────────────────
function moveAgeLabel(ageMs) {
  if (ageMs == null) return 'unavailable';
  const min = Math.round(ageMs / 60000);
  if (min < 1)  return '< 1m';
  if (min < 60) return `~${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m === 0 ? `~${h}h` : `~${h}h ${m}m`;
  return `~${Math.floor(h / 24)}d`;
}
// Phase classification — ages map to early / developing / mid / late /
// exhaustion. Without a known move age we degrade to structural
// inference from score breakdown (see classifyMovePhase below).
function classifyMovePhase({ ageMs, score, struct, mom, cont }) {
  if (ageMs != null) {
    const min = ageMs / 60000;
    if (min < 30)  return 'early';
    if (min < 90)  return 'developing';
    if (min < 180) return 'mid_move';
    return 'late';
  }
  // Structural fallback when ageMs is unavailable.
  // Strong structure + strong continuation → mid_move.
  // Strong momentum + weak structure → developing.
  // Otherwise → developing (safest assumption).
  const s = (struct && struct.score) || 0;
  const m = (mom   && mom.score)   || 0;
  const c = (cont  && cont.score)  || 0;
  if (s >= 2 && c >= 2) return 'mid_move';
  if (m >= 2 && s <= 1) return 'developing';
  return 'developing';
}
const PHASE_LABEL = {
  early: 'Early', developing: 'Developing', mid_move: 'Mid-move',
  late: 'Late', exhaustion: 'Exhaustion risk'
};

// ── LATE-ENTRY RISK ───────────────────────────────────────────
function lateEntryRisk({ phase, score, struct }) {
  const s = (struct && struct.score) || 0;
  if (phase === 'late' || phase === 'exhaustion') return 'high';
  if (phase === 'mid_move' && s < 2)              return 'moderate_high';
  if (phase === 'mid_move')                       return 'moderate';
  if (phase === 'developing' && score >= 6)       return 'moderate';
  if (phase === 'early')                          return 'low';
  return 'moderate';
}

// ── CONTINUATION PROBABILITY ─────────────────────────────────
function continuationProbability({ phase, score, struct, cont }) {
  const sc = score || 0;
  const c  = (cont && cont.score) || 0;
  const s  = (struct && struct.score) || 0;
  if (phase === 'late' || phase === 'exhaustion') return 'low';
  if (sc >= 8 && c >= 2 && s >= 2)                return 'high';
  if (sc >= 6 && c >= 1)                           return 'moderate';
  return 'low';
}

// ── STRUCTURE STATE ───────────────────────────────────────────
// Maps the existing scoreStructure / scoreBreakout outputs into a
// human label + the spec's confirmation/invalidation/window block.
function structureState({ struct, brk, score }) {
  const sScore = (struct && struct.score) || 0;
  const bScore = (brk    && brk.score)    || 0;
  if (sScore >= 2 && bScore >= 2) return 'confirmed';
  if (sScore >= 2 && bScore >= 1) return 'confirming';
  if (sScore >= 1 || bScore >= 1) return 'building';
  if (score < 3)                  return 'failed';
  return 'not_confirmed';
}
const STRUCTURE_LABEL = {
  not_confirmed: 'Not confirmed',
  building:      'Building',
  confirming:    'Confirming',
  confirmed:     'Confirmed',
  failed:        'Failed'
};
// Confirmation timeframe — picks the smaller of the two key
// timeframes the spec allows: 5m, 15m, 30m, 1H. Equity / index get
// faster confirmation timeframes; FX commonly waits for 15m/30m.
function confirmationTimeframe(sectionKey) {
  switch (sectionKey) {
    case SECTION_KEYS.EQUITY:    return '5m/15m';
    case SECTION_KEYS.INDEX:     return '5m/15m';
    case SECTION_KEYS.COMMODITY: return '15m/30m';
    case SECTION_KEYS.FX_MAJOR:  return '15m/30m';
    case SECTION_KEYS.FX_CROSS:  return '15m/30m';
    default:                     return '15m';
  }
}
function confirmationRequirement({ direction, sectionKey, struct, brk }) {
  const dir = direction === 'Bullish' ? 'above' : direction === 'Bearish' ? 'below' : 'beyond';
  const tf  = confirmationTimeframe(sectionKey);
  const refLevel = (brk && brk.score >= 1 && brk.level)
    ? `the breakout reference (${brk.level})`
    : (struct && struct.score >= 1 && struct.level)
      ? `the recent ${direction === 'Bullish' ? 'high' : 'low'} (${struct.level})`
      : `the recent ${direction === 'Bullish' ? 'high' : 'low'}`;
  return `${tf} candle close ${dir} ${refLevel}, then hold/retest the broken level.`;
}
function invalidationCondition({ direction, struct, brk }) {
  if (direction === 'Bullish') {
    return 'Sharp rejection from the breakout area, OR a candle close back below the prior higher-low pivot.';
  }
  if (direction === 'Bearish') {
    return 'Sharp rejection from the breakout area, OR a candle close back above the prior lower-high pivot.';
  }
  return 'Two-way spike or directional flip on the next confirmation timeframe.';
}
function estimatedTriggerWindow({ phase, structureStateKey }) {
  if (structureStateKey === 'failed')     return 'reassess after next candle close';
  if (structureStateKey === 'confirmed')  return 'next 5–15m';
  if (structureStateKey === 'confirming') return 'next 15–45m';
  if (structureStateKey === 'building')   return 'next 30–90m';
  if (phase === 'late' || phase === 'exhaustion') return 'reassess after next candle close';
  return 'unavailable';
}

// ── CAUSE HYPOTHESIS ─────────────────────────────────────────
// Builds a why-flagged + whyMatters narrative WITHOUT inventing
// news. Confidence label is mandatory:
//   high      — explicit Corey calendar event linked to symbol/section
//   moderate  — Corey live regime supports the move (e.g. RISK_ON +
//               equity/index move)
//   low       — technical/flow inference only
//   unavailable — no Corey signal in the input
function buildCauseHypothesis({ symbol, sectionKey, direction, corey }) {
  const live   = (corey && (corey.live || corey.internalMacro?.global?.live)) || {};
  const regime = corey?.internalMacro?.regime?.regime || corey?.regime?.regime || null;
  const risk   = corey?.internalMacro?.global?.riskEnv || null;
  const calEvent = corey?.calendar?.intel || corey?.activeCatalystWindow || null;

  let confidence = 'unavailable';
  let cause = 'Movement appears technical/flow-driven; no confirmed event link.';
  let bits = [];

  if (calEvent && typeof calEvent === 'string' && calEvent.length) {
    confidence = 'high';
    bits.push(`Calendar event in window: ${calEvent.slice(0, 140)}`);
  }
  if (risk) {
    if (sectionKey === SECTION_KEYS.EQUITY || sectionKey === SECTION_KEYS.INDEX) {
      if ((risk === 'RiskOn' || risk === 'RISK_ON') && direction === 'Bullish') {
        bits.push('Risk-on equity / index momentum supports the bullish move.');
        if (confidence === 'unavailable') confidence = 'moderate';
      } else if ((risk === 'RiskOff' || risk === 'RISK_OFF') && direction === 'Bearish') {
        bits.push('Risk-off pressure on equities / indices supports the bearish move.');
        if (confidence === 'unavailable') confidence = 'moderate';
      }
    }
    if (sectionKey === SECTION_KEYS.COMMODITY && /XAU|XAG/.test(symbol)) {
      if ((risk === 'RiskOff' || risk === 'RISK_OFF') && direction === 'Bullish') {
        bits.push('Safety / inflation flow likely supportive (Risk-Off regime).');
        if (confidence === 'unavailable') confidence = 'moderate';
      }
    }
    if (sectionKey === SECTION_KEYS.SAFE_HAVEN || isSafeHaven(symbol)) {
      bits.push(`Safe-haven asset; risk environment ${risk} relevant.`);
      if (confidence === 'unavailable') confidence = 'moderate';
    }
  }
  if (regime) {
    bits.push(`Regime ${regime}.`);
    if (confidence === 'unavailable') confidence = 'low';
  }
  if (Number.isFinite(live?.dxy?.price)) {
    bits.push(`DXY ${Number(live.dxy.price).toFixed(2)} relevant for FX / commodity legs.`);
    if (confidence === 'unavailable') confidence = 'low';
  }
  if (bits.length) cause = bits.join(' ');
  return { causeConfidence: confidence, cause };
}

// ── WHY FLAGGED / WHY (NOT) WATCH / PROMOTION TRIGGER ────────
function whyFlagged({ symbol, score, sectionPeers }) {
  const peers = (sectionPeers || []).filter(p => p.symbol !== symbol);
  if (!peers.length) return `Strongest mover scanned in this section.`;
  const above = peers.filter(p => p.score < score).length;
  if (above >= peers.length * 0.66) return `Stronger directional pressure than most scanned peers in section.`;
  return `Top-tier mover in its section — score ${score}/10 above the section median.`;
}
function whyNotWatch({ score, structureStateKey, lateRisk, phase, watchThreshold }) {
  const reasons = [];
  if (score < watchThreshold) reasons.push(`score ${score}/10 below WATCH threshold (${watchThreshold})`);
  if (structureStateKey !== 'confirmed' && structureStateKey !== 'confirming') reasons.push('structure confirmation incomplete');
  if (lateRisk === 'high' || lateRisk === 'moderate_high') reasons.push('late-entry risk rising');
  if (phase === 'late' || phase === 'exhaustion')          reasons.push('move already extended');
  if (!reasons.length) reasons.push('not yet at WATCH quality');
  return reasons;
}
function whyWatch({ score, structureStateKey, sectionLeader }) {
  const reasons = [];
  if (score >= 8) reasons.push(`score ${score}/10 at or above WATCH threshold`);
  if (structureStateKey === 'confirming' || structureStateKey === 'confirmed') reasons.push('structure approaching / at confirmation');
  if (sectionLeader) reasons.push('leading its market section');
  return reasons;
}
function promotionTrigger({ direction, sectionKey, structureStateKey }) {
  const tf = confirmationTimeframe(sectionKey);
  if (structureStateKey === 'confirmed') return `Sustained continuation + improved ATLAS alignment (Corey + Spidey) → escalate to Jane.`;
  return `Clean ${tf} continuation close ${direction === 'Bullish' ? 'above' : 'below'} the listed structure level + retest hold.`;
}

// ── RELATIVE STRENGTH (in section) ───────────────────────────
function relativeStrength(candidate, peersInSection) {
  if (!peersInSection || peersInSection.length <= 1) return 'leader';
  const sorted = peersInSection.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const idx = sorted.findIndex(p => p.symbol === candidate.symbol);
  if (idx === 0) return 'leader';
  const pos = idx / (sorted.length - 1); // 0 = top, 1 = bottom
  if (pos < 0.34) return 'above_avg';
  if (pos < 0.67) return 'in_line';
  return 'below_avg';
}

// ── SCORE BREAKDOWN ──────────────────────────────────────────
// Maps the 5 raw 0-2 scoring criteria into 0-10 component scores
// for the Discord output. Adds late-entry penalty + FOMO penalty
// hooks (penalties are subtracted on display, NOT on the source
// `score` field — so the engine's WATCH / INTERNAL gating stays
// stable).
function buildScoreBreakdown({ struct, mom, brk, clean, cont, phase, score, lateRisk }) {
  const x10 = (s) => Math.max(0, Math.min(10, Math.round(((s && s.score) || 0) * 5)));
  const lateEntryPenalty = lateRisk === 'high' ? -2 : lateRisk === 'moderate_high' ? -1 : 0;
  const fomoPenalty       = phase === 'exhaustion' ? -1 : 0;
  return {
    momentum:           x10(mom),
    relativeStrength:   null,        // filled later from section peer data
    structure:          x10(struct),
    breakout:           x10(brk),
    cleanliness:        x10(clean),
    continuation:       x10(cont),
    lateEntryPenalty,
    fomoPenalty,
    composite:          score
  };
}

// ── ENRICH ONE CANDIDATE ─────────────────────────────────────
// Takes the existing scoreInstrument output and produces the v1.1
// intelligence record. Pure function — no I/O.
function enrichCandidate({ candidate, htf, ltf, components, corey, watchThreshold }) {
  const symbol = candidate.symbol;
  const direction = candidate.direction;
  trackDirection(symbol, direction);

  const sec = classifySection(symbol);
  const ageMs = getMoveAgeMs(symbol, direction);
  const phase = classifyMovePhase({
    ageMs,
    score: candidate.score,
    struct: components.struct,
    mom:    components.mom,
    cont:   components.cont
  });
  const lateRisk = lateEntryRisk({ phase, score: candidate.score, struct: components.struct });
  const structKey = structureState({ struct: components.struct, brk: components.brk, score: candidate.score });
  const triggerWindow = estimatedTriggerWindow({ phase, structureStateKey: structKey });
  const cont = continuationProbability({ phase, score: candidate.score, struct: components.struct, cont: components.cont });
  const cause = buildCauseHypothesis({ symbol, sectionKey: sec.key, direction, corey });

  return {
    symbol, score: candidate.score, direction,
    section:  sec.label,
    sectionKey: sec.key,
    safeHaven: isSafeHaven(symbol),
    moveStrength: moveStrength(htf),
    moveSpeed:    moveSpeed(ltf),
    moveAgeMs:    ageMs,
    moveAgeLabel: moveAgeLabel(ageMs),
    movePhase:    phase,
    movePhaseLabel: PHASE_LABEL[phase] || phase,
    lateEntryRisk: lateRisk,
    continuationProbability: cont,
    structureState: structKey,
    structureStateLabel: STRUCTURE_LABEL[structKey] || structKey,
    confirmationTimeframe: confirmationTimeframe(sec.key),
    confirmationRequirement: confirmationRequirement({ direction, sectionKey: sec.key, struct: components.struct, brk: components.brk }),
    invalidationCondition:    invalidationCondition({ direction, struct: components.struct, brk: components.brk }),
    estimatedTriggerWindow:   triggerWindow,
    causeConfidence: cause.causeConfidence,
    cause:           cause.cause,
    scoreBreakdown:  buildScoreBreakdown({ ...components, phase, score: candidate.score, lateRisk }),
    promotionTrigger: promotionTrigger({ direction, sectionKey: sec.key, structureStateKey: structKey }),
    whyNotWatch:     whyNotWatch({ score: candidate.score, structureStateKey: structKey, lateRisk, phase, watchThreshold }),
    whyWatch:        whyWatch({ score: candidate.score, structureStateKey: structKey, sectionLeader: false }) // patched after section ranking
  };
}

// ── RANKING + SECTION CAPS ───────────────────────────────────
// Top N global movers with at most `capPerSection` from any one
// section. Returns a ranked array (top of array = strongest). Adds
// `relativeStrength` per enriched candidate based on its section
// peers.
function rankWithSectionCaps(enriched, opts) {
  const o = opts || {};
  const max = Number.isFinite(o.max) ? o.max : 10;
  const cap = Number.isFinite(o.capPerSection) ? o.capPerSection : 3;

  // First — group by section to compute relative strength.
  const bySection = {};
  for (const e of enriched) {
    if (!bySection[e.sectionKey]) bySection[e.sectionKey] = [];
    bySection[e.sectionKey].push(e);
  }
  for (const key of Object.keys(bySection)) {
    const peers = bySection[key];
    for (const e of peers) e.relativeStrength = relativeStrength(e, peers);
  }

  // Score-sort all candidates.
  const sorted = enriched.slice().sort((a, b) => (b.score || 0) - (a.score || 0));

  // Apply section cap when filling the top-N list.
  const counts = {};
  const top = [];
  for (const e of sorted) {
    if (top.length >= max) break;
    const key = e.sectionKey || 'UNKNOWN';
    counts[key] = counts[key] || 0;
    if (counts[key] >= cap) continue;
    counts[key]++;
    top.push(e);
  }

  // If section caps starved the list (rare), fill remainder with
  // overflow candidates so we always show the user the strongest
  // available — and flag that section caps were lifted.
  let sectionCapsApplied = true;
  if (top.length < max) {
    const remainder = sorted.filter(s => !top.includes(s));
    while (top.length < max && remainder.length) top.push(remainder.shift());
    if (top.length > max) top.length = max;
    sectionCapsApplied = false;
  }

  // Section leader flag — top-of-section gets `whyWatch` enrichment.
  for (const e of top) {
    const peers = bySection[e.sectionKey] || [];
    const leader = peers.length && peers[0].symbol === e.symbol;
    if (leader) e.whyWatch = whyWatch({ score: e.score, structureStateKey: e.structureState, sectionLeader: true });
  }

  // Top-1 in section gets `whyFlagged` peer-aware text.
  for (const e of top) {
    const peers = bySection[e.sectionKey] || [];
    e.whyFlagged = whyFlagged({ symbol: e.symbol, score: e.score, sectionPeers: peers });
  }

  return { top, sectionCapsApplied, bySection };
}

// ── DISCORD FORMATTERS ──────────────────────────────────────
const DIR_ARROW = (d) => d === 'Bullish' ? '↑' : d === 'Bearish' ? '↓' : '→';

function _expanded(rank, c) {
  // Top-3 expanded format. Mandatory fields per spec: why flagged,
  // structure detail, confirmation requirement, window, late-entry
  // risk, invalidation.
  const macro = c.cause || 'Movement appears technical/flow-driven; no confirmed event link.';
  return [
    `${rank}. **${c.symbol}** — ${c.section} — ${c.direction || 'Neutral'} ${DIR_ARROW(c.direction)} — **${c.score}/10**`,
    `   Why flagged: ${c.whyFlagged}`,
    `   Structure: ${c.structureStateLabel}.`,
    `   Confirmation: ${c.confirmationRequirement}`,
    `   Window: ${c.estimatedTriggerWindow}.`,
    `   Move age: ${c.moveAgeLabel} · Phase: ${c.movePhaseLabel} · Strength: ${c.moveStrength.replace('_',' ')} · Speed: ${c.moveSpeed.replace('_',' ')}.`,
    `   Relative strength: ${(c.relativeStrength || '').replace('_',' ') || 'unavailable'}.`,
    `   Late-entry risk: ${c.lateEntryRisk.replace('_',' ')}.`,
    `   Invalidation: ${c.invalidationCondition}`,
    `   Macro / event: ${macro} _(causeConfidence: ${c.causeConfidence})_`,
    `   Why not WATCH: ${c.whyNotWatch.join('; ')}.`,
    `   Promotion trigger: ${c.promotionTrigger}`,
    `   ATLAS state: Internal watchlist only — Jane confirmation not yet triggered.`
  ].join('\n');
}
function _compact(rank, c) {
  const tail = (c.whyNotWatch && c.whyNotWatch[0]) || 'below WATCH threshold';
  return `${rank}. **${c.symbol}** — ${c.section} — ${c.direction || 'Neutral'} ${DIR_ARROW(c.direction)} — ${c.score}/10 — ${tail}.`;
}

function _marketMap(top) {
  const sectionsSeen = new Set(top.map(c => c.section));
  const tag = (label) => sectionsSeen.has(label) ? 'active' : 'quiet';
  return [
    `FX: ${tag(SECTIONS.FX_MAJOR) === 'active' || tag(SECTIONS.FX_CROSS) === 'active' ? 'active' : 'quiet'}`,
    `Indices: ${tag(SECTIONS.INDEX)}`,
    `Commodities: ${tag(SECTIONS.COMMODITY)}`,
    `Equities: ${tag(SECTIONS.EQUITY)}`,
    `Safe havens: ${top.some(c => c.safeHaven) ? 'active' : 'quiet'}`
  ].join(' · ');
}
function _regimeBlock({ corey, vixLevel, calendarHealth }) {
  const live = (corey && (corey.live || corey.internalMacro?.global?.live)) || {};
  const dxy   = Number.isFinite(live?.dxy?.price)        ? Number(live.dxy.price).toFixed(2) : 'unavailable';
  const vix   = vixLevel || (Number.isFinite(live?.vix?.price) ? Number(live.vix.price).toFixed(2) : null) || 'unavailable';
  const yld   = Number.isFinite(live?.yield?.spread)     ? `${Number(live.yield.spread).toFixed(2)}bp` : 'unavailable';
  const cal   = calendarHealth?.source_used === 'tradingview' ? 'LIVE via TradingView'
              : calendarHealth?.source_used                     || 'unavailable';
  return [
    `VIX: ${vix}`,
    `DXY: ${dxy}`,
    `Yields: ${yld}`,
    `Calendar: ${cal}`,
    `Breaking news feed: unavailable unless implemented`
  ].join(' · ');
}

// v1.1 movement digest payload — replaces the basic
// fomo.buildMovementDigestPayload output with the global radar
// format from the spec.
function buildMovementDigestV11({ ranked, volatility, corey, calendarHealth }) {
  const topAll = ranked.top.slice(0, 10);
  const expandedTop = topAll.slice(0, 3);
  const compactTail = topAll.slice(3, 10);
  const marketMap = _marketMap(topAll);
  const regime    = _regimeBlock({ corey, vixLevel: volatility && volatility.vixLevel, calendarHealth });

  const expandedBlock = expandedTop.length
    ? expandedTop.map((c, i) => _expanded(i + 1, c)).join('\n\n')
    : '_No expanded candidates this cycle._';
  const compactBlock = compactTail.length
    ? compactTail.map((c, i) => _compact(i + 4, c)).join('\n')
    : '_No additional candidates this cycle._';

  const content =
    `🐎 **DARK HORSE — GLOBAL MOVEMENT ACTIVE**\n\n` +
    `**State:** Monitoring only. No confirmed Dark Horse WATCH candidate yet.\n\n` +
    `**Global regime:** ${regime}\n` +
    `**Market map:** ${marketMap}\n\n` +
    `**Top global movers:**\n` +
    `${expandedBlock}\n\n` +
    (compactTail.length ? `${compactBlock}\n\n` : '') +
    `**Caution:** Movement is active, but this is not a trade alert. Do not chase late moves. Wait for the listed structure confirmation.\n\n` +
    `Full ATLAS confirmation path remains: Corey → Spidey → Jane.`;
  return { content, kind: 'movement_digest_v1_1' };
}

// v1.1 WATCH payload — full intelligence block per spec.
function buildWatchV11({ candidate, ranked, corey }) {
  const c = candidate;
  const sectionPeers = (ranked && ranked.bySection && ranked.bySection[c.sectionKey]) || [];
  const sectionLeader = sectionPeers.length && sectionPeers[0].symbol === c.symbol;
  const why = (c.whyWatch && c.whyWatch.length) ? c.whyWatch : ['score above WATCH threshold', 'directional pressure leading section'];
  const macro = c.cause || 'Movement appears technical/flow-driven; no confirmed event link.';

  const content =
    `🐎 **DARK HORSE — WATCH (advisory only)**\n\n` +
    `**Symbol:** ${c.symbol}\n` +
    `**Section:** ${c.section}${c.safeHaven ? ' / Safe Haven' : ''}\n` +
    `**Direction:** ${c.direction || 'Neutral'} ${DIR_ARROW(c.direction)}\n` +
    `**Score:** ${c.score}/10\n\n` +
    `**Why WATCH:** ${why.join('; ')}.\n` +
    `**Move age:** ${c.moveAgeLabel}\n` +
    `**Move phase:** ${c.movePhaseLabel}\n` +
    `**Move strength:** ${c.moveStrength.replace('_',' ')} · **Speed:** ${c.moveSpeed.replace('_',' ')}\n` +
    `**Continuation window:** ${c.estimatedTriggerWindow}.\n` +
    `**Continuation probability:** ${c.continuationProbability}.\n` +
    `**Structure:** ${c.structureStateLabel}\n` +
    `**Structure confirmation:** ${c.confirmationRequirement}\n` +
    `**Invalidation:** ${c.invalidationCondition}\n` +
    `**Relative strength:** ${(c.relativeStrength || 'unavailable').replace('_',' ')}${sectionLeader ? ' (section leader)' : ''}\n` +
    `**Macro / Event context:** ${macro} _(causeConfidence: ${c.causeConfidence})_\n` +
    `**Late-entry risk:** ${c.lateEntryRisk.replace('_',' ')}\n\n` +
    `**ATLAS state:** Escalate to Jane for final advisory synthesis.\n\n` +
    `_WATCH is not an entry call._`;
  return { content, kind: 'watch_v1_1' };
}

// ── COMPACT PER-CANDIDATE LOG LINE ───────────────────────────
// Exposes a single object the engine can fan out into multiple
// [DH-CANDIDATE] log lines without inventing fields.
function buildCandidateLogFields(c) {
  return {
    symbol:               c.symbol,
    section:              c.sectionKey,
    score:                c.score,
    direction:            c.direction || 'Neutral',
    move_strength:        c.moveStrength,
    move_speed:           c.moveSpeed,
    move_age:             c.moveAgeLabel,
    move_phase:           c.movePhase,
    relative_strength:    c.relativeStrength || 'unavailable',
    structure_state:      c.structureState,
    continuation_window:  c.estimatedTriggerWindow,
    late_entry_risk:      c.lateEntryRisk,
    why_not_watch:        (c.whyNotWatch || []).join('|'),
    promotion_trigger:    c.promotionTrigger
  };
}

module.exports = {
  // Section helpers
  SECTIONS, SECTION_KEYS, classifySection, isSafeHaven,
  // Move analytics
  trackDirection, getMoveAgeMs, _resetDirectionStore,
  moveStrength, moveSpeed, moveAgeLabel, classifyMovePhase, PHASE_LABEL,
  lateEntryRisk, continuationProbability,
  // Structure
  structureState, STRUCTURE_LABEL, confirmationTimeframe,
  confirmationRequirement, invalidationCondition, estimatedTriggerWindow,
  // Cause + reasons
  buildCauseHypothesis, whyFlagged, whyNotWatch, whyWatch, promotionTrigger,
  relativeStrength, buildScoreBreakdown,
  // Pipeline
  enrichCandidate, rankWithSectionCaps,
  // Output
  buildMovementDigestV11, buildWatchV11, buildCandidateLogFields,
  // Constants
  DIR_ARROW
};
