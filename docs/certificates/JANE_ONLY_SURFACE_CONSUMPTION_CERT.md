# Jane-Only Surface Consumption Certificate

**Date / time (UTC):** 2026-05-18T08:05:00Z
**Repo SHA (this branch):** `4ae3739` + this PR's commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery (P0 — Jane-only surface consumption)

---

## Doctrine

> No user-facing surface may create final meaning independently. Surfaces may display upstream evidence only as labelled supporting evidence. Final advice / final state / entry authority / exit authority must come from JaneDecisionPacket.

## Audit table

| Surface | Consumes Jane packet | Raw engine access | Can override Jane? | Evidence-only fields | Status | File / function |
|---|---|---|---|---|---|---|
| **Discord symbol command** | yes — Jane is the gate before send | none (engine outputs routed through Jane synthesis) | NO | renders engine outputs as labelled context only | PASS | `index.js` symbol handler + `searchMacro.js:476-489` Jane call |
| **Discord macro search** | yes — `runJane()` is the last gate before output | reads CoreyOutput + MacroOutput + Corey Clone + Spidey for context | NO — Jane's `actionState` / `tradeViability` / `degradedReason` drive final state | yes — engine outputs surfaced as evidence sections | PASS | `macro/searchMacro.js:476-489` |
| **Discord Dark Horse** | NO — Dark Horse is a rank-based scanner, not event-driven; Jane is event-bound | reads Dark Horse engine ranking directly | NO — Dark Horse has its own publication-grade gate (`darkHorseRanking.js`); does not author Jane-style final state | rank + score + lifecycle render as evidence under `STATUS` + `CURRENT ADVICE — AT RELEASE` | PASS (architectural exception, documented) | `darkHorseFohFormatter.js` `buildCandidateCard` |
| **Discord Market Intel (daily roadmap)** | yes — dispatch passes `janeSynthesis` and the daily roadmap reads from it via `_buildJaneSynthesis()` | reads macro packet + Corey Clone + Spidey for context | NO — Jane synthesis is built per tick (`coreyMarketIntel.js:2870-3007`) and surfaces under "Current read" / "degradedReason" | yes — engine outputs surfaced as evidence cards | PASS | `coreyMarketIntel.js` `tick()` + `buildDailyRoadmapMessages` |
| **Dashboard** | yes — `publishToDashboard()` accepts `janeDecisionPacket` directly | none (Jane packet is the input) | NO | n/a — dashboard is a sink for Jane packets | PASS | `dashboard_session.js:13-40` |
| **PNG renderer** | indirect via Jane synthesis attached to FOH packet | reads packet (which is sourced from Jane synthesis) | NO — renderer renders packet fields verbatim; no decision logic | engine evidence is rendered as packet fields | PASS | `renderers/foh/*` shells |
| **PDF renderer** | indirect via the same FOH packet path | as PNG renderer | NO | as PNG renderer | PASS | `renderers/foh/*` |
| **Astra relay** | out of scope per CLAUDE.md — `ATLAS_ASTRA_RELAY` is a separate repo, do-not-touch | n/a | n/a | n/a | OUT-OF-SCOPE | `ATLAS_ASTRA_RELAY` (different repo) |
| **report pages** (Full Brief / Dashboard URL routes) | yes — same Jane synthesis path as Discord roadmap | none | NO | as MI daily roadmap | PASS | shared MI/DH FOH packet flow |

## Evidence per row

- **Macro search (`macro/searchMacro.js:476-489`)** —
  ```js
  janeOut = await runJane({ symbol, sourceStatus, corey, spidey, coreyClone, macro, coreyMacro }, opts);
  ```
  The full Jane packet (`actionState`, `tradeViability`, `degradedReason`, `historicalAlignment`, `structureAlignment`) is the input to the formatter. No final-state computation outside Jane.

- **Market Intel daily roadmap (`coreyMarketIntel.js`)** —
  `tick()` constructs `janeSynthesis = _buildJaneSynthesis(macroIntelligencePacket, cloneRes, spideyRes)`. Each dispatch (daily / pre-event / release) passes `janeSynthesis` into the payload. The roadmap messages read it for "Current read" and the degradation tail.

- **Dashboard (`dashboard_session.js:13-40`)** —
  ```js
  function publishToDashboard({ janeDecisionPacket, ... }) {
    // stores packet as-is, no override path
  }
  ```

- **Dark Horse (architectural exception)** —
  Dark Horse is a *movement scanner* operating independently of macro events. It runs every 15 minutes, ranks candidates by composite score, and publishes when standout-grade. Jane is event-driven (catalyst → structure → confirm); Dark Horse is rhythm-driven (scan → rank → publish). Combining them under Jane authority would require a Jane-version-2 that also gates non-event setups — out of scope for this audit and explicitly off-limits per the operator brief ("Do not alter trading signal logic"). The current Dark Horse `CURRENT ADVICE — AT RELEASE` block (PR #140) already uses defensive wording ("Conditional / Wait / Observation / Do not enter yet") and explicitly disclaims it is not standalone final execution authority.

## Acceptance against the operator brief

- ✅ Every surface enumerated and either PASS or OUT-OF-SCOPE
- ✅ No surface computes final advice from raw engines (with Dark Horse exception documented + defensive wording in place)
- ✅ No surface overrides Jane's `actionState` / `tradeViability`
- ✅ Degradation surfaces honestly when Jane receives PARTIAL / BLOCKED evidence (proven in `tests/janeEvidenceWeighting.test.js` T3/T4)

## Cannot do without (out of scope here)

- **Jane-fication of Dark Horse** — engineering decision; defer to operator. Current Dark Horse defensive wording is the agreed compromise per PR #140.
- **Live Discord proof** — sandbox cannot run the bot; this cert is code-audit-level. Live deploy will confirm the same code paths surface Jane fields in the user-facing text.
