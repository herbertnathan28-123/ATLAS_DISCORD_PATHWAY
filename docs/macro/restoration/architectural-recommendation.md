# Architectural Recommendation — Brief 2 Macro + MI Restoration

**Inputs.** `macro-ownership-map.md`, `macro-parity-matrix.md`,
`combined-mi-macro-parity-matrix.md`, `surface-bos-audit.md`.

**Hard boundary.** This is a recommendation. No code touches
production until the operator confirms each numbered decision
below. No silent substitution. Every "default" recommendation
is explicitly labelled so the operator can over-ride.

**Companion docs.**
* `deliverable-3-implementation-package.md` — lane sequencing if
  this recommendation is approved.
* `deliverable-4-staging-proof-plan.md` — staging proof gate for
  each lane.

---

## Decision 1 — Three-pipeline consolidation (event-intelligence)

**Choices** (from `combined-mi-macro-parity-matrix.md` §C):
* **C-cons-a.** Consolidate A + B + C → Pipeline C as the single anchor.
* **C-cons-b.** Keep A + B + C separate; share a common embed-build helper for the 8 required fields.
* **C-cons-c.** Keep status quo (3 independent pipelines).

**Recommendation: C-cons-a (Pipeline C anchor).**

Reasoning. Brief 2's verified finding states Pipeline C is the richest content source (it produces the 8-field block per CLAUDE.md spec; Pipelines A + B are scheduler-driven slim alerts). Consolidation aligns all three event-surfaces on one source-of-truth content builder, which:
* eliminates the three-way drift risk;
* lets Pack-3 colour and Pack-4 hyperlink doctrines apply once and propagate;
* matches the matrix-recommended consolidation anchor;
* keeps the scheduler-driven A + B pipelines lighter by delegating content composition to C.

Risk: high — touches scheduler (`coreyMarketIntel.js`) and live data path (`corey_calendar.js`). Required: per-lane staging proof + 24h cooldown before next-cycle deploy. Lane M3.

---

## Decision 2 — Markdown vs Discord embed migration (Pack-3 colour doctrine)

**Choices** (from `combined-mi-macro-parity-matrix.md` §D):
* **D-md.** Keep all macro/MI output as markdown strings (status quo).
* **D-embed.** Migrate everything to Discord embed JSON.
* **D-hybrid.** Markdown for body, embeds for Sentiment + Chart 2×2 + Chart Reference + any sentiment-stripe-bearing surface.

**Recommendation: D-hybrid.**

Reasoning. PR #74 confirmed embed JSON for the Dark Horse FOH path delivers Pack-3 colour stripes, structured fields, and clean image attachments. The Macro surface is far larger (9 LOCKED_ORDER sections + advisory header + Live Plan field set). A full embed rewrite is a 3-session lift with high regression risk against the `language.scrub` ban list, `contradictionCheck.js` post-assembly validator, and the existing chunker contract. The hybrid path applies embeds where the colour stripe matters most (Sentiment header on Macro §5, Chart 2×2 attachment that already ships separately, Chart Reference card if/when Dark Horse L5 lands a shared helper) and leaves the body sections as markdown. Cost: ~1-2 sessions. Risk: medium.

Defer **D-embed** (full migration) to a follow-up master lane if hybrid does not deliver enough Pack-3 colour on operator review.

---

## Decision 3 — Pack-3 colour glyph doctrine

**Current state.** `macro/eventIntelligence.js::sentimentFromTilt` emits `●○` (filled / empty circle, 5-dot). PR #74's Dark Horse FOH v6 uses `🟢🟢🟢🟢⚫` (5-disc traffic-light with `⚫` inactive disc).

**Recommendation: migrate the Macro sentiment scale to the v6 traffic-light form.**

Concrete: replace `sentimentFromTilt` 5-dot generator with a call to a shared `discScale(active, total, label, glyph)` helper (the same helper PR #74 added to `darkHorseFoh.js`). Glyph per state:
* STRONG RISK-ON / RISK-ON → `🟢`
* MILD RISK-ON → `🟡`
* MIXED → `🟡` (with `(mixed components)` suffix preserved)
* MILD RISK-OFF → `🟠`
* RISK-OFF / STRONG RISK-OFF → `🔴`

Output: `🟢🟢🟢🟢⚫ 4/5 — RISK-ON`, parallel to the Dark Horse Market Mood block. Lane M1. Cost: ~0.5 sessions.

Apply the same migration to `macro/livePlan.js`'s Read Maturity surface — replace the `% reconciliation + /10 readiness` pair with a 1-5 dot scale per CLAUDE.md §3 spec. Lane M1 same.

---

## Decision 4 — Event Intelligence 8-field break-out

**Choices.**
* **EI-a.** Continue inserting raw `calendar.intel` text from Pipeline C (status quo); operator visually verifies the 8 fields appear inside the wall of text.
* **EI-b.** Refactor Pipeline C to return a structured object `{ sentiment, headline, timestamp, expandedSummary, aiCommentary, mechanismChain, traderNote, affectedSymbols }`; `macro/eventIntelligence.js` consumes the structured object and renders each field as a labelled markdown line / embed field.

**Recommendation: EI-b.**

Reasoning. The CLAUDE.md spec explicitly enumerates 8 fields. Today the labels are not visually identifiable inside the wall-of-text Pipeline C output. EI-b makes the field break-out testable, makes per-field Pack-3 / Pack-4 doctrine application possible, and is the prerequisite for Lane M2.

Risk: medium — touches Pipeline C internals. Required: per-field text-diff against pre/post snapshots before deploy. Lane M2.

---

## Decision 5 — Roadmap day-of-week depth differentiation

**Current state.** `macro/roadmapLink.js` (27 lines) emits a real link only.

**CLAUDE.md spec.** Monday = full depth (30–35 page equivalent). Midweek = remove outdated sections only, explanations intact. Friday = execution-focused.

**Recommendation: implement weekday branching inside `roadmapLink.js`.**

Concrete options:
* **R-link.** Roadmap link rotates between 3 different URLs (Monday-full / Midweek-trimmed / Friday-execution). Lowest cost; depends on operator maintaining 3 link targets. Cost: ~0.25 sessions.
* **R-content.** `roadmapLink.js` switches what it embeds based on `new Date().getUTCDay()` — Monday emits the full content block, midweek emits a trimmed block, Friday emits an execution-focused block. Cost: ~1 session (requires populating the per-day content).

Recommend **R-link** as the default since the operator already maintains a real link; multi-link rotation is the lowest-risk first step. **R-content** is the follow-up if operator wants the depth differentiation inside the bot output rather than at the link destination. Lane M4.

---

## Decision 6 — Pack-4 Expanded Terminology Hyperlinks rollout

**Recommendation: roll out `[[Label]](url)` visible-bracket hyperlinks across Macro + MI surfaces, using `macro/glossary.js::TERMS` as the slug source.**

Concrete: each macro builder emits inline `[[Market Mood]](url)`, `[[Execution Confidence]](url)`, `[[Setup Quality]](url)`, etc. (full list in `combined-mi-macro-parity-matrix.md` §E). `glossary.js::footer` retires to operator-only audit mode; the inline hyperlinks become the primary terminology surface.

Risk: low — additive copy edits across multiple files. The hyperlink renderer is already proven on the Dark Horse FOH v6 path. Cost: ~1 session. Lane M6.

---

## Decision 7 — BOS / CHoCH surface translation

**Recommendation: execute Lane M7 (full surface translation per `surface-bos-audit.md` §G).**

Critical: **flip `macro/language.js:101-102` first.** The TRANSLATE rule currently REWRITES `broken support` / `broken resistance` *into* `BOS confirmation level`. This is doctrine-contradicting. The two-line flip to `[Structure Break] confirmation level` is the highest-priority single fix in this entire restoration.

After the flip: add `/\bBOS\b/`, `/\bCHoCH\b/` to `macro/language.js::UNIVERSAL_BAN` so the scrub throws on future regressions (matching the Dark Horse FOH `BANNED_PATTERNS` discipline).

Then: translate the 22+ surface emits across `macro/advisoryHeader.js`, `macro/spideyStructure.js`, `index.js` advisory text, `visualPatternLibrary.js`. Each translation is a one-file edit; test fixtures (`scripts/test_visual_pattern_library_qa.js`, `scripts/test_recovery.js`, `scripts/test_discord_batch_qa.js`) must be realigned in lockstep — matching PR #74's discipline of updating QA assertions to the new surface.

CHoCH semantics: recommended translation slug is `[Initial-direction reversal]` (reuses the existing terminology slug from PR #74 v6's TERMINOLOGY map). Operator may override.

Risk: medium — wide-touch but each edit is small. Cost: ~1 session for code, ~0.5 sessions for QA realignment. Lane M7.

---

## Decision 8 — Glossary defect handling

**Status update.** Brief 2's verified finding said `macro/glossary.js` was capture-defective. The file is now present at 51 lines and exports `TERMS`, `lookup`, `footer`. Operator brief in the most-recent message confirms: "Continue from recaptured `macro/glossary.js`. Treat source as present."

**Recommendation: no action required.**

Use the existing `TERMS` dictionary as the slug source for Lane M6 (Pack-4 hyperlinks). When Lane M7 lands, rewrite the BOS/CHoCH entries in `TERMS` so the human-readable definitions lead with `[Structure Break]` and `[Initial-direction reversal]` (per `surface-bos-audit.md` §C option C-b).

---

## Decision 9 — Banned-wording (UNIVERSAL_BAN) alignment

**Current state.** `macro/language.js::UNIVERSAL_BAN` (lines 17-82) does NOT include `/\bBOS\b/` or `/\bCHoCH\b/`. The Dark Horse FOH `BANNED_PATTERNS` (PR #74 branch) DOES include them. The two surfaces are inconsistent.

**Recommendation: align UNIVERSAL_BAN to the Dark Horse FOH ban list.**

Concrete: add `/\bBOS\b/`, `/\bCHoCH\b/`, `/\b── NEW ──\b/`, `/\bLearning Links?\b/i` to `macro/language.js::UNIVERSAL_BAN`. Run the macro test suite (`scripts/test_macro_qa.js`, `scripts/test_discord_batch_qa.js`) — expect failures wherever surface emits leak; fix in lockstep with Lane M7.

Cost: ~0.25 sessions for the ban list. Failures fold into Lane M7 fix-up.

---

## Decision 10 — Staging proof plan (every lane)

**Recommendation: per-lane staging Discord posts + screenshot diff vs `docs/screenshots/dh-foh-v6.pdf` reference for surfaces that have prototype screenshots; per-section unit-test markers for the rest.**

Each lane gets its own draft PR. CI must stay green. Operator review accepts / rejects each lane before merge. No production deploy without staging proof. Mirrors PR #74's discipline. Full plan in `deliverable-4-staging-proof-plan.md`.

---

## Summary table — decisions + lanes

| Decision | Default recommendation | Lane | Effort |
|---|---|---|---|
| 1 — Pipeline consolidation | C-cons-a (Pipeline C anchor) | M3 | 2 sessions |
| 2 — Markdown vs embed | D-hybrid | M5-h | 1-2 sessions |
| 3 — Sentiment glyph migration | v6 traffic-light + 5-dot on livePlan | M1 | 0.5 sessions |
| 4 — Event Intelligence 8-field break-out | EI-b (structured object) | M2 | 1 session |
| 5 — Roadmap weekday depth | R-link (3-URL rotation) | M4 | 0.25 sessions |
| 6 — Pack-4 hyperlinks | full rollout via `TERMS` slugs | M6 | 1 session |
| 7 — BOS / CHoCH translation | full Lane M7, **language.js:101-102 flip first** | M7 | 1.5 sessions |
| 8 — Glossary defect | no action — file is present | n/a | 0 |
| 9 — UNIVERSAL_BAN alignment | add BOS / CHoCH / dashed-NEW / Learning Links | M7-pre | 0.25 sessions |
| 10 — Staging proof | per-lane Discord post + screenshot diff | (per-lane) | ~0.25 sessions per lane |

**Total recommended effort:** ~8 focused sessions across 7 lanes.

The single highest-priority sub-task: **flip `macro/language.js:101-102`** (Decision 7 first step). Two-line edit. Stops the doctrine-contradicting BOS injection immediately. Recommend shipping this sub-task as its own micro-PR before any larger lane is queued.

---

## Hard rule honoured

Each decision lists the alternatives, the recommended default, and the reasoning. No silent substitution. Operator may over-ride any default. No code lands until the operator confirms.
