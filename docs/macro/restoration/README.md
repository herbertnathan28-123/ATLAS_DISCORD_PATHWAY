# Macro Restoration — Analysis Tranche B (Brief 2)

**Purpose.** Analysis-only checkpoint for the Macro + Market Intel
restoration. Mirrors PR #73's parity-matrix discipline. No code
under `/macro/*.js`, `/coreyMarketIntel.js`, `/corey_calendar.js`
or `/index.js` is modified by this tranche. Every finding is
PASS / PARTIAL / FAIL / UNRESOLVED / BLOCKED.

**Branch.** `claude/macro-restoration-analysis-tranche-b` (this
analysis).

**Related work.** PR #74 (Dark Horse FOH v6 parity restoration) is
the active surface restoration; PR #73 (Dark Horse v6 prototype
parity matrix) is the doctrine checkpoint for the Dark Horse side.
The matrices and decisions here apply the same discipline to
Macro + MI.

---

## Documents in this tranche

| # | Document | What it captures |
|---|---|---|
| 1 | [`macro-ownership-map.md`](./macro-ownership-map.md) | Module-by-module inventory of every Tier-1 macro file plus the two upstream Market Intel sources. Emit shape, Pack-3 compliance, BOS surface leaks, doctrine state. |
| 2 | [`macro-parity-matrix.md`](./macro-parity-matrix.md) | Per-section parity vs the CLAUDE.md §3 locked Macro spec + PR #74 v6 canon. PASS / PARTIAL / FAIL / UNRESOLVED / BLOCKED verdict per surface. |
| 3 | [`combined-mi-macro-parity-matrix.md`](./combined-mi-macro-parity-matrix.md) | Single matrix spanning MI + Macro, including the three-pipeline overlap. The matrix that gates the markdown-vs-embed decision deferred from PR #74. |
| 4 | [`surface-bos-audit.md`](./surface-bos-audit.md) | Repo-wide BOS / CHoCH surface-leak inventory. Names every site, severity-classed (critical / high / medium / low), with the specific translation each leak requires. |
| 5 | [`architectural-recommendation.md`](./architectural-recommendation.md) | Ten numbered decisions covering pipeline consolidation, markdown vs embed migration, Pack-3 colour glyph migration, Event Intelligence 8-field break-out, Roadmap weekday depth, Pack-4 hyperlinks, BOS translation, glossary defect handling (resolved — file present), UNIVERSAL_BAN alignment, staging proof plan. Default recommendation per decision; operator over-ride at each. |
| 6 | [`deliverable-3-implementation-package.md`](./deliverable-3-implementation-package.md) | Lane sequencing if the recommendation is approved. Seven lanes (M1–M7) plus M7-critical (the two-line `language.js:101-102` doctrine flip). Per-lane scope, dependencies, acceptance criteria, risk level, effort estimate. |
| 7 | [`deliverable-4-staging-proof-plan.md`](./deliverable-4-staging-proof-plan.md) | Staging proof gate per lane. Hard safety rails. Common checklist. Combined go-live gate. Reuses PR #74's `scripts/staging_dh_foh_v6_post.js` safety pattern. |

---

## Highest-priority finding

**`macro/language.js:101-102` REWRITES `broken support` / `broken
resistance` *into* `BOS confirmation level`.** This TRANSLATE rule
actively *injects* BOS into the user surface — direct
contradiction of the operator brief "Keep BOS internal only unless
translated to `[Structure Break]` on the surface."

Two-line fix. Recommended as a stand-alone micro-PR (Lane
M7-critical) ahead of any larger restoration work.

---

## Hard boundary preserved

* No `/macro/*.js` file edited.
* No `coreyMarketIntel.js` or `corey_calendar.js` file edited.
* No `index.js`, `visualPatternLibrary.js`, or scheduler edits.
* No production code change.
* No ranking / transport / scheduler / Render config touched.

This tranche is read + document + recommend. Implementation lanes
are sequenced for operator approval; no lane proceeds without an
explicit operator go.

---

## Status legend (used throughout the tranche)

* **PASS** — verified compliant with spec.
* **PARTIAL** — partial compliance; gap stated explicitly.
* **FAIL** — required surface absent or doctrine-contradicting behaviour.
* **UNRESOLVED** — gap-state needs deeper inspection.
* **BLOCKED** — operator decision required before code lands.
* **MISSING from active flow** — module exists but is not consumed.
* **DEFERRED** — out of Tranche B scope; flagged for follow-up.
