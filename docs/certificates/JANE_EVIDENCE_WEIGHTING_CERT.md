# Jane Evidence Weighting Certificate

**Date / time (UTC):** 2026-05-18T08:00:00Z
**Repo SHA (this branch):** `4ae3739` + this PR's commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery (P0 — Jane evidence weighting / source authority)
**Test:** `tests/janeEvidenceWeighting.test.js` — 14 PASS

---

## Engine inputs Jane receives

| Engine | Decision role | Code site | Authority |
|---|---|---|---|
| **Spidey** | structure authority (directional truth + invalidation level) | `jane.js:88-106` (Phase D gate) + `jane.js:115` (vote) + `jane.js:148-152` (final bias) | owns final bias direction; veto on tradeViability=VALID |
| **Corey** | current event / regime authority (riskModifiers, immediate bias) | `jane.js:116` (vote) | required ACTIVE for tradeViability=VALID (line 130) |
| **Corey Clone** | historical analogue authority (base rates) | `jane.js:75-81` (Phase D analogue contract gate) + `jane.js:85` (active check) + `jane.js:117` (vote) + `jane.js:139-141` (cap) | when not decision-grade, tradeViability is capped to MARGINAL |
| **Macro Engine** | normalised broader macro context | `jane.js:118` (vote) + `jane.js:178` (alignment text) | one vote among the four lanes |

## Weighting mechanism (per-lane vote)

`jane.js:114-121`:

```js
const scoreInputs = [], confInputs = [];
if (spideyActive && ...) { scoreInputs.push(input.spidey.score);     confInputs.push(input.spidey.confidence); }
if (coreyActive  && ...) { scoreInputs.push(input.corey.score);      confInputs.push(input.corey.confidence); }
if (cloneActive  && ...) { scoreInputs.push(input.coreyClone.score); confInputs.push(input.coreyClone.confidence); }
if (macroActive  && ...) { scoreInputs.push(input.macro.score);      confInputs.push(input.macro.confidence); }
const setupQuality     = scoreInputs.length ? scoreInputs.reduce((a, b) => a + b, 0) / scoreInputs.length : 0;
const marketConfidence = confInputs.length  ? confInputs.reduce((a, b) => a + b, 0) / confInputs.length  : 0;
```

Each engine contributes exactly **one** entry to the score and confidence arrays. Text volume / paragraph count / number of fields / macro verbosity contribute zero weight by construction — the test suite locks this.

## Gate stack (authority decides, not aggregation)

| Layer | Rule | Effect when violated |
|---|---|---|
| Spidey Phase D structure gate (`jane.js:95-106`) | `spideyActive && structureConfidence ≥ 0.50 && hasInvalidation && hasTimestampedEvidence` | `tradeViability ∈ {INVALID, WAITING_FOR_CONFIRMATION}`; aggregate score irrelevant |
| Corey ACTIVE gate (`jane.js:130`) | `marketConfidence ≥ 0.65 && setupQuality ≥ 0.55 && coreyActive` | falls through to MARGINAL / INVALID |
| Clone active gate (`jane.js:139-141`) | if `!cloneActive && tradeViability === 'VALID'` → cap to MARGINAL | historical lane absent → no execution authority |
| Clone analogue contract (`jane.js:75-81`) | if `coreyClone.analogues` set is malformed → demote clone lane to PARTIAL, weight 0 | prevents Jane minting historical confidence from bad packets |

## Test-locked behaviour (`tests/janeEvidenceWeighting.test.js`)

| Test | Scenario | Outcome locked |
|---|---|---|
| T1 | Verbose Corey + weak Spidey | `tradeViability ≠ VALID`; `actionState ≠ arm` |
| T2 | Strong Spidey + neutral Corey | `finalBias = long`; structure-alignment text reads ACTIVE |
| T3 | Clone BLOCKED | `tradeViability ≠ VALID`; historicalAlignment reads excluded; degradedReason names historical |
| T4 | Spidey PARTIAL (no_candles_supplied) | `tradeViability ≠ VALID`; `actionState ≠ arm`; structure-confirmation gap surfaced |
| T5 | Conflicting engines (Spidey BULL, Corey BEAR, Clone disagrees) | `tradeViability = MARGINAL`; `conflictSummary` populated |
| T6 | Thin vs fat Corey (same activity, 4000+ extra words on the fat path) | `marketConfidence + setupQuality + tradeViability` identical across both runs |

T6 is the operator-brief headline: **text volume contributes zero weight**.

## Acceptance against the operator brief

- ✅ Source-authority weighting is implemented (per-lane vote, not text-volume aggregation)
- ✅ Spidey weakness blocks execution authority (T4)
- ✅ Corey Clone BLOCKED suppresses historical claims and caps tradeViability (T3)
- ✅ Conflicting engines degrade final state without doctrine resolution (T5)
- ✅ Test fixtures prove evidence volume does not dominate (T6)
- ✅ Jane remains the sole final decision layer (final_state log line proves the gate ran)

## Cannot do without (out of scope here)

- **Engine weight reweighting** — the brief approves the implicit per-lane vote model as authority-correct; if the operator later wants explicit per-engine multipliers (e.g. Spidey weight = 1.5×), that's an engine-doctrine change outside this audit.

## Follow-up

- The Spidey Phase D structure gate runs only when `!testMode`. `tests/janeEvidenceWeighting.test.js` calls `runJane(input)` without test-mode and the gate fires correctly. Production runs should not pass `testMode: true` unless explicitly required by a foundation-compatibility harness.
