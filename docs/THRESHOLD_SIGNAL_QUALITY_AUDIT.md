# ATLAS FX — Threshold / Signal Quality Audit

**Audit scope:** Pre-Monday review of Corey / Jane / Spidey / Dark Horse thresholds.  
**Mode:** AUDIT + RECOMMEND only. **NO production threshold changes applied in this branch.**

---

## 1. Current threshold landscape

### 1.1 Dark Horse — score gates (`darkHorseEngine.js:84-85`)

| Constant | Value | Meaning |
|---|---|---|
| `DH_SCORE_WATCH` | **8** | ≥8 → post to Discord + trigger live pipeline |
| `DH_SCORE_INTERNAL` | **5** | 5–7 → stored internally only (visible to Pre-Radar / near-miss surfaces, not posted as live Dark Horse) |

**Internal range 5-7** is the "near-miss" tier — these candidates aren't surfaced as Dark Horses but inform the weekend prep / Pre-Radar layer.

### 1.2 Jane — decision viability gates (`jane.js:91-101`)

| Tier | Conditions |
|---|---|
| **VALID** | `marketConfidence ≥ 0.65` AND `setupQuality ≥ 0.55` AND Spidey ACTIVE AND Corey ACTIVE |
| **MARGINAL** | `marketConfidence ≥ 0.4` |
| **INVALID** | otherwise (always when Spidey not ACTIVE) |

**Downgrade rule:** Corey Clone not ACTIVE → VALID downgrades to MARGINAL.

### 1.3 Corey — live-data score functions (`corey_live_data.js`)

| Function | Output range | Anchor |
|---|---|---|
| `scoreDXY(price, change1d)` | −1 to +1 | UUP ETF price + 1D change (recalibrated `89cf2c7`) |
| `scoreVIX(price)` | very low / low / moderate / elevated | VXX ETF price bands |
| `scoreYield(spread)` | inverted / flat / steep | FRED T10Y2Y spread bands |

### 1.4 Spidey (Phase B placeholder)

- Returns `score=0.5, confidence=0.5` in test-mode short-circuit.
- Phase D replaces with real structure analysis (HH/HL detection, structure breaks, pivot reclaim, liquidity alignment).
- **No tunable thresholds in Phase B.**

### 1.5 TrendSpider boost / exhaustion penalties

- TrendSpider webhook runs port 3001 (per CLAUDE.md "What Is Working — Do Not Break").
- No visible `TRENDSPIDER_BOOST_*` / `EXHAUSTION_PENALTY_*` constants in the codebase scan — these are encoded as inline weights in the scoring pipeline, not exported constants.
- **Audit recommendation:** lift these to named constants in a follow-up session so they're tunable + testable.

---

## 2. False-positive reduction analysis

### 2.1 Dark Horse `DH_SCORE_WATCH = 8`

**Calibration evidence:** 8/10 is a high bar. Historically (per the merge stack — PR #74/79/82/85/86/87 polish + cooldowns), Dark Horse posts have low frequency (1-3 per scan window, 15-min cadence). Score ≥8 implies structure + momentum + driver + Corey alignment all agreeing.

**False positives:** primarily come from:
- Single-candle structure breaks (no follow-through) — mitigated by `[Confirmed candle close]` doctrine in PR #74-94
- Stale macro context — mitigated by `corey_live_data` cached-refresh + staleness detection
- Echo cooldown bypass — mitigated by `DH_WATCH_ECHO_TTL_MS = 7d`

**Recommendation:** **HOLD at 8.** Lowering to 7 would roughly double post frequency; raising to 9 would over-suppress. Sample size from current cadence is sufficient to keep the gate.

### 2.2 Jane `marketConfidence ≥ 0.65 / setupQuality ≥ 0.55`

**Doctrine context:** Per-lane MEAN of populated lanes (Phase B). This means a 2-lane setup (Spidey + Corey both at 0.65) just clears the bar; a 4-lane setup (all four authorities at 0.65) clears comfortably.

**False-positive risk:** Phase B's per-lane MEAN is the right shape (no single lane dominates), but it can let through cases where Spidey is borderline (0.55-0.65) while Corey is strong (0.85). Phase D's Astra authority scoring will fix this via lane-weight rather than mean.

**Recommendation:** **HOLD for Monday.** The Spidey-ACTIVE gate + Clone-ACTIVE downgrade already guards the worst false-positive paths. Tightening to 0.70/0.60 would over-suppress on the foundation phase.

### 2.3 Corey Clone — 11-field validation gate

**Strength:** ANY malformed analogue → entire lane → PARTIAL (Phase D §JANE TRUST RULE).

**Risk:** Strict. May produce more PARTIAL packets than ACTIVE in early Monday hours before the analogue cache fully warms.

**Recommendation:** **HOLD.** Strictness is the right default — false historical confidence is worse than missing historical confidence.

---

## 3. Trade-frequency impact estimates

| Threshold change | Expected effect | Recommend? |
|---|---|---|
| DH_SCORE_WATCH 8 → 7 | ~2x Dark Horse post frequency, increased false-positive rate | **NO** |
| DH_SCORE_WATCH 8 → 9 | ~0.4x post frequency; risk of missing legit setups | **NO** |
| Jane VALID confidence 0.65 → 0.70 | Fewer VALID packets, more MARGINAL | **NO (Phase B)** |
| Jane VALID confidence 0.65 → 0.60 | Looser gate; risk of Spidey-borderline pass-throughs | **NO** |
| Jane MARGINAL floor 0.40 → 0.50 | Fewer MARGINAL surfaces; risk of cleanly INVALID-classifying borderline-good setups | **NO** |
| Clone gating: cap at MARGINAL → cap at INVALID | Stricter; would block Phase B VALID setups when Clone is warming | **NO** |

---

## 4. Recommended audit-only changes

These are documentation / observability additions — no scoring constant changes:

1. **Lift TrendSpider boost / exhaustion penalty weights into named constants** in a follow-up session (`darkHorseEngine.js`). Currently they're inline numerics; lifting makes them tunable + testable + reviewable.

2. **Add per-lane confidence floor logging** to Jane (`jane.js`): emit `lane_floor_breach` log lines when a lane's confidence is below its calibrated floor, so operator can spot systematic lane drift.

3. **Add `marketConfidenceFloor` constants** to Jane: extract the `0.65` / `0.55` / `0.40` literals to named constants (`JANE_VALID_CONFIDENCE_FLOOR = 0.65`, etc.) for readability + future-tuning.

4. **Threshold-change simulation harness** — for any future tightening, add a backtest harness that re-scores N historical sessions against the new thresholds before deploying. Currently no such harness exists (tests are presence/banned-token only).

**None of these are Monday-blocking.** All are post-Monday cleanups.

---

## 5. Monday-deploy threshold verdict

| Gate | Current value | Recommend changing for Monday? |
|---|---|---|
| `DH_SCORE_WATCH` | 8 | **NO — HOLD** |
| `DH_SCORE_INTERNAL` | 5 | **NO — HOLD** |
| Jane VALID confidence floor | 0.65 | **NO — HOLD** |
| Jane VALID setup quality floor | 0.55 | **NO — HOLD** |
| Jane MARGINAL confidence floor | 0.40 | **NO — HOLD** |
| Clone-not-ACTIVE downgrade rule | Cap at MARGINAL | **NO — HOLD** |
| Spidey-not-ACTIVE rule | INVALID always | **NO — HOLD** |

**Overall:** **NO production threshold changes recommended pre-Monday.** Foundation gates are doctrine-correct; blast radius of any change pre-Monday is unacceptable.

---

## 6. Boundary discipline

This audit is read-only. No threshold constants modified. No scoring engine changes. CLAUDE.md "Do Not Touch — Ever" zones (`coreyLive.init`, `getLiveContext`, `getMarketContext`, `detectRegime`, `buildMacro` field maps) untouched.

Cursor's ATL-6 Dark Horse FOH lane untouched.
