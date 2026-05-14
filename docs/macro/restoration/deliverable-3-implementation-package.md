# Deliverable #3 — Combined Implementation Package (Brief 2)

**Status.** Recommendation only. No code lands until the operator
confirms the lane sequencing below. Each lane is gated on the
acceptance criteria in `deliverable-4-staging-proof-plan.md`. Per
PR #74 / PR #73 discipline, each lane gets its own draft PR with
staged Discord-channel screenshots before merge.

**Dependency.** This package implements the architectural choices in
`architectural-recommendation.md`. If the operator over-rides any
default decision, the affected lane(s) regenerate with the new
choice.

---

## Lane M7-critical — `macro/language.js:101-102` doctrine flip (HIGHEST PRIORITY)

**Scope.** Two-line edit. Flip the TRANSLATE rule that REWRITES
`broken support` / `broken resistance` *into* `BOS confirmation
level`. New target: `[Structure Break] confirmation level`.

**Files touched.** `macro/language.js` (lines 101-102 only).

**Why isolate this as a micro-PR.** It is the highest-priority
single fix in the entire restoration. It is doctrine-contradicting
behaviour active in production today. The edit is two lines. The
risk is near zero. Shipping it first stops the BOS injection
without waiting for any larger lane.

**Acceptance.** No surface emit of `BOS confirmation level` after
the edit; macro QA scripts pass (`scripts/test_macro_qa.js`,
`scripts/test_discord_batch_qa.js`); language scrub still accepts
the rewritten surface text without throwing.

**Risk.** Very low. Edit confined to a translator rule.

**Effort.** ~0.1 sessions (~10 minutes including QA run + commit).

---

## Lane M1 — Sentiment 5-disc traffic-light migration

**Scope.** Replace `macro/eventIntelligence.js::sentimentFromTilt`'s
`●○` 5-dot output with PR #74's `discScale()` helper output:
`🟢🟢🟢🟢⚫ 4/5 — Label`. Glyph per state per
`architectural-recommendation.md` §3. Add a parallel 1-5 dot scale
to `macro/livePlan.js` per CLAUDE.md §3 spec, replacing the
existing `% reconciliation + /10 readiness` pair.

**Files touched.**
* `macro/eventIntelligence.js` (`sentimentFromTilt` body).
* `macro/livePlan.js` (Read Maturity / verdict-strip block).
* `scripts/test_macro_qa.js` (assertion realignment).

**Dependency.** None upstream. May reuse `discScale()` by lifting
it from `darkHorseFoh.js` (PR #74 branch) into a shared
`scripts/_severity_scale.js` helper, or copying it verbatim into
`macro/language.js` to keep `macro/` self-contained.

**Acceptance.** `eventIntelligence.js` emits `🟢🟢🟢🟢⚫ 4/5 — RISK-ON`
shape. `livePlan.js` emits `🟢🟢🟢🟢⚫ 4/5 — actionable with
discipline` shape on the Read Maturity surface. QA test assertions
realigned. No banned-wording regressions.

**Risk.** Low — additive copy edits + helper import.

**Effort.** ~0.5 sessions.

---

## Lane M2 — Event Intelligence 8-field break-out

**Scope.** Refactor `corey_calendar.getEventIntelligence` to return
a structured `{ sentiment, headline, timestamp, expandedSummary,
aiCommentary, mechanismChain, traderNote, affectedSymbols }`
object (alongside the existing string form for back-compat).
`macro/eventIntelligence.js` consumes the structured form and
renders each field as a labelled markdown line (or embed field if
Lane M5-h has shipped first).

**Files touched.**
* `corey_calendar.js` — `getEventIntelligence` return shape.
* `macro/eventIntelligence.js` — consume the structured object;
  fall back to legacy string form if structured object is missing
  (back-compat).
* `corey.js:52` — silent-swallow `try/catch` upgraded to log the
  swallow reason (operator-flag from
  `macro-ownership-map.md` §C).
* `index.js:949, 1493` — consumer sites updated to consume the
  structured form (still markdown-render via the macro builder).

**Dependency.** None upstream. Consolidates well WITH Lane M3
(pipeline consolidation) — preferred to ship M2 first so the field
shape is stable before the A/B alerts get repointed to Pipeline C.

**Acceptance.** Per-field text-diff PR shows the 8 named fields
appearing as broken-out markdown lines in `macro/eventIntelligence.js`
output. Pipeline A / Pipeline B alerts unchanged. `corey.js:52`
log line surfaces in console on swallow.

**Risk.** Medium — touches `corey_calendar.js` (live data path)
and three consumer sites.

**Effort.** ~1 session.

---

## Lane M3 — Three-pipeline consolidation (A + B + C → C anchor)

**Scope.** Pipelines A (`buildPreEventAlertPayload`) and B
(`buildReleasedEventAlertPayload`) in `coreyMarketIntel.js`
delegate their event-intel content composition to a shared helper
backed by Pipeline C's structured output (Lane M2). The
scheduler-driven webhook payloads of A + B keep their slim shape
but draw their content from the same source-of-truth as Pipeline C.

**Files touched.**
* `coreyMarketIntel.js` (Pipelines A + B builders rewritten to
  consume Pipeline C output).
* `corey_calendar.js` (exposed `getEventIntelligence` helper used
  by A + B + C).
* `scripts/test_market_intel_qa.js` (assertion realignment).

**Dependency.** Lane M2 must ship first (structured Pipeline C
output is the input to A + B). Otherwise A + B would consume the
legacy string form and lose the field-shape parity.

**Acceptance.** A pre-event scheduler webhook and a released-event
scheduler webhook fired in staging both reference the same 8-field
shape that Pipeline C produces, with timestamp / lead-time /
mechanism chain identical across the three surfaces.

**Risk.** High — touches the live scheduler. Required: 24h staging
cooldown between scheduler-driven cycles to verify the alert text
is consistent across both A and B trigger points. Required: per-
PR staging webhook (per `scripts/staging_dh_foh_v6_post.js`
pattern from PR #74) to fire A + B + C against a private channel
before merge.

**Effort.** ~2 sessions.

---

## Lane M4 — Roadmap day-of-week depth differentiation

**Scope.** `macro/roadmapLink.js` returns a different link target
(or content block) per UTC weekday.

**Files touched.**
* `macro/roadmapLink.js` (weekday branching).

**Dependency.** None.

**Acceptance.** Monday output shows the full-depth link / content;
midweek shows the trimmed link / content; Friday shows the
execution-focused link / content. Operator-provided link targets
required for **R-link** option; operator-approved content blocks
required for **R-content** option.

**Risk.** Low.

**Effort.** ~0.25 sessions for R-link; ~1 session for R-content.

---

## Lane M5-h — Pack-3 hybrid embed migration

**Scope.** Migrate the highest-value Pack-3 surfaces to Discord
embed JSON. Hybrid scope = Sentiment header (Macro §5) + Chart 2×2
attachment (already separate) + Chart Reference card (when Dark
Horse FOH L5 lands a shared helper). All other macro sections stay
as markdown.

**Files touched.**
* `macro/eventIntelligence.js` (emit `{ content, embeds }` shape
  for the Sentiment header section; markdown body sections unchanged).
* `macro/index.js` (return shape changes from string to `{
  content, embeds }`).
* `index.js` `deliverResult` (consumer-side change to handle the
  hybrid return shape).
* `scripts/test_macro_qa.js`, `scripts/test_live_route_qa.js`
  (assertion realignment).

**Dependency.** Lane M1 (sentiment glyph migration) must ship
first so the embed Sentiment field already carries the v6
traffic-light scale before the embed migration.

**Acceptance.** Sentiment header renders as a Discord embed with
colour stripe matching the bias direction (green/yellow/red);
embed field set carries the 8 Event Intelligence fields broken out
per Lane M2; rest of macro body renders unchanged as markdown.

**Risk.** Medium — affects the `index.js` consumer interface.

**Effort.** ~1-2 sessions.

---

## Lane M6 — Pack-4 Expanded Terminology Hyperlinks rollout

**Scope.** Add `[[Label]](url)` visible-bracket hyperlinks across
Macro builders using `macro/glossary.js::TERMS` as the slug source.
Full hyperlink site list in `combined-mi-macro-parity-matrix.md` §E.

**Files touched.**
* `macro/livePlan.js` (verdict-strip field labels).
* `macro/priceTable.js` (row headers).
* `macro/eventIntelligence.js` (Sentiment + Driver field labels).
* `macro/catalysts.js` (Event Risk references).
* `macro/validity.js` (Validity Window references).
* `macro/executionLogic.js` (Confirmation + Stop Loss + Trigger
  Level references).
* `macro/advisoryHeader.js` (Bias Direction + Trade Probability +
  Market Confidence references).

**Dependency.** None. Can ship in parallel with any other lane.
Safest order: ship after Lane M7-critical so the BOS / CHoCH terms
in `TERMS` have already been corrected.

**Acceptance.** Every term-bearing surface emits `[[Term]](url)`
form. No backslash-escaped `\[Term\]` form anywhere in the macro
output. Visual smoke-test in staging confirms the hyperlinks
render as clickable cyan brackets in Discord.

**Risk.** Low — additive copy edits.

**Effort.** ~1 session.

---

## Lane M7 — BOS / CHoCH surface translation (full)

**Scope.** Translate every BOS / CHoCH surface emit to `[Structure
Break]` / `[Initial-direction reversal]` per `surface-bos-audit.md`
§G. Lane M7-critical (the `macro/language.js:101-102` flip) is the
first sub-task and may ship as its own micro-PR.

**Files touched.**
* `macro/language.js` (UNIVERSAL_BAN extension + TRANSLATE flip —
  if not already shipped via M7-critical).
* `macro/advisoryHeader.js` (lines 71, 147).
* `macro/spideyStructure.js` (lines 119, 130-131).
* `index.js` (lines 609, 681-683, 751, 859-860, 1258-1259, 1648).
* `visualPatternLibrary.js` (lines 130, 144, 159, 173, 428, 454,
  465-485, 504-514, 703, 736).
* `macro/glossary.js` (rewrite `TERMS.BOS` / `TERMS.CHoCH`
  definitions per `surface-bos-audit.md` §C option C-b).
* `scripts/test_visual_pattern_library_qa.js` (assertion realignment).
* `scripts/test_recovery.js` (fixture + assertion realignment).
* `scripts/test_discord_batch_qa.js` (assertion realignment).

**Dependency.** Lane M7-critical (the two-line flip) may ship
independently. Full Lane M7 requires the UNIVERSAL_BAN extension
to be the first commit in the lane PR so the QA suite catches
remaining leaks during the translation work.

**Acceptance.** Repo-wide grep for `\bBOS\b` and `\bCHoCH\b` returns
zero hits inside user-facing emit strings (internal validators,
variable names, branch tags allowed per `surface-bos-audit.md` §E).
QA tests realigned.

**Risk.** Medium — wide touch surface. Required: full QA suite
pass + staging Discord post + screenshot diff against a `BOS`-
free reference output.

**Effort.** ~1.5 sessions (1 for code + 0.5 for QA realignment).

---

## Suggested ship order

1. **M7-critical** (two-line flip). Ships immediately.
2. **M1** (sentiment 5-disc traffic-light migration). Foundation
   for M5-h. Ships in parallel with M2.
3. **M2** (Event Intelligence 8-field break-out). Foundation for
   M3 and M5-h. Ships in parallel with M1.
4. **M7** (full BOS / CHoCH translation). Independent. May ship
   in parallel with M1 + M2.
5. **M5-h** (hybrid embed migration). Depends on M1 (glyph) +
   M2 (structured object).
6. **M6** (Pack-4 hyperlinks). Depends on M7 (clean TERMS).
7. **M3** (pipeline consolidation). Depends on M2 (structured Pipeline C).
8. **M4** (Roadmap weekday depth). Independent. Can ship anywhere.

Estimated total elapsed wall time (sequential): ~8 sessions.
Estimated parallelised: ~5 sessions (M1 + M2 + M7 in parallel,
then M5-h + M6 + M3 sequenced).

---

## Out-of-scope for this package

* Notion source-of-truth review (the "ATLAS FX — Macro + Roadmap
  Master Brief v2.0 (LOCKED) — 5 April 2026" Notion page).
  CLAUDE.md §3 summary is the visible authority used by this
  analysis. If the Notion source carries additional requirements
  not in CLAUDE.md, the lane sequencing above may need extension.
* `macro/incorego.js` deep-read (deferred to Tranche C per
  `macro-ownership-map.md`).
* `macro/forwardExpectation.js` and `macro/triggerMap.js` archive
  decision (both files exist but are not consumed from
  `macro/index.js`).
* Chart 2×2 image-attachment rebuild (CLAUDE.md "CRITICAL 1 —
  Renderer Fix" — explicit "Do not touch in this session"
  constraint, separate session per CLAUDE.md "Session Priority
  Order" item 1).

---

## Hard rule honoured

No code touched by this document. Every lane lists its files,
dependencies, acceptance criteria, risk level, and effort estimate.
Operator approves each lane before its draft PR opens. No
production deploy without staging proof per Deliverable #4.
