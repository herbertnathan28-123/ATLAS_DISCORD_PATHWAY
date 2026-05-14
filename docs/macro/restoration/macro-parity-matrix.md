# Macro Parity Matrix — vs Locked Spec (Brief 2 / Tranche B)

**Locked spec source.** `CLAUDE.md` §3 "Locked Macro Spec Summary"
(institutional briefing standard) + the explicit Pack-3 / Pack-4 /
B12 doctrine the Dark Horse FOH v6 restoration (PR #74) confirmed
as canon (5-disc severity bars with `⚫` inactive disc, visible-
bracket `[[Label]](url)` Expanded Terminology Hyperlinks, no banned
wording on the surface).

**Live module set.** `/macro/*.js` Tier-1 + the supporting modules
listed in `macro-ownership-map.md` §A.

**Verdict legend.** PASS / PARTIAL / FAIL / UNRESOLVED / BLOCKED.
PARTIAL surfaces have the specific gap stated. BLOCKED items
require an operator decision before code lands.

---

## Section A — Locked output order parity (`LOCKED_ORDER` vs CLAUDE.md §3)

| # | Locked spec section            | LOCKED_ORDER slot | Live builder           | Verdict |
|---|---|---|---|---|
| 1 | Chart 2×2                      | (image attachment, not text) | `index.js` `deliverResult` (see CLAUDE.md "Do not touch in this session" entries) | **PASS** (out of macro/ text scope) |
| 2 | Trade Status / Final Assessment| `livePlan`        | `macro/livePlan.js`    | **PASS** |
| 3 | Price Table                    | `priceTable`      | `macro/priceTable.js`  | **PASS** |
| 4 | Roadmap Link                   | `roadmapLink`     | `macro/roadmapLink.js` | **PARTIAL** — link only; day-of-week depth NOT implemented (M4 below) |
| 5 | Global / Event Intelligence    | `eventIntel`      | `macro/eventIntelligence.js` (wraps Pipeline C) | **PARTIAL** — Sentiment scale glyphs wrong; 8-field requirement not broken out (see Section C) |
| 6 | Market Overview                | `marketOverview`  | `macro/marketOverview.js` | **PASS** |
| 7 | Events / Catalysts             | `catalysts`       | `macro/catalysts.js`   | **PASS** |
| 8 | Historical Context             | `historical`      | `macro/historicalContext.js` | **PASS** |
| 9 | Execution Logic                | `execution`       | `macro/executionLogic.js` | **PASS** for emitted text; glossary tag-set still references BOS / CHoCH (Pack-4 lane) |
| 10| Validity                       | `validity`        | `macro/validity.js`    | **PASS** |

**Net:** 7 / 10 PASS, 3 / 10 PARTIAL, 0 FAIL.

---

## Section B — Per-section field parity (CLAUDE.md spec items)

| # | Spec requirement | Live emission | Verdict |
|---|---|---|---|
| B1  | Output is institutional briefing standard; hard-fail on short summaries / missing sections / no directional arrows / single-direction bias only / retail formatting / thin content / removed explanations | All 9 sections build dense content; `language.scrub` enforces the wording ban list; failure modes are guarded by `contradictionCheck.js` | **PASS** |
| B2  | Locked output order: Chart 2×2 → Trade Status → Price Table → Roadmap Link → Global/Event Intelligence Block → Market Overview → Events/Catalysts → Historical Context → Execution Logic → Validity | `orderedSections.js::LOCKED_ORDER` matches | **PASS** |
| B3  | Sentiment system: Dominant bias on 1–5 dot scale; Mixed ⬆️⬇️ arrows MANDATORY under dominant score | `eventIntelligence.js::sentimentFromTilt` emits `●●●●○` 5-dot (correct scale, wrong glyphs vs PR #74's `🟢🟢🟢🟢⚫` traffic-light); `arrow()` helper emits ⬆️⬇️ for mixed components. **`livePlan.js` does NOT use the 1–5 dot scale** — emits `% reconciliation` + `/10 readiness` instead | **FAIL — dot scale missing on `livePlan.js`; sentiment glyphs do not match PR #74 canonical doctrine** |
| B4  | Event Intelligence Block must include: Sentiment header / Headline / Timestamp / Expanded summary / AI commentary / Mechanism chain / Trader note / Affected symbols | `eventIntelligence.js` emits Sentiment + Driver only as broken-out fields; Headline / Timestamp / Expanded summary / AI commentary / Mechanism chain / Trader note / Affected symbols are embedded inside the raw `calendar.intel` string (Pipeline C) and inserted at line 39 (`lines.push(intel)`). Whether Pipeline C content actually carries all 6 missing fields is **UNRESOLVED** until Pipeline-C text is diffed | **PARTIAL — UNRESOLVED on the 6 inner fields** |
| B5  | Execution Logic: Strict IF/THEN format only, no storytelling | `executionLogic.js` builds a markdown table with explicit `IF … | THEN …` rows; no storytelling copy emitted | **PASS** |
| B6  | Roadmap: Monday full depth (30–35 page equivalent), midweek remove outdated sections only with explanations intact, Friday execution-focused | `roadmapLink.js` (27 lines) emits a real link only. Day-of-week branching NOT implemented in this module | **FAIL** |
| B7  | Every paragraph in Market Overview and Historical Context must end with ⬆️ or ⬇️ | `marketOverview.js` — every paragraph closes with `arrow(±score)`; `historicalContext.js` — every paragraph closes with `arrow()` (or `⬆️⬇️` for the mixed-balance branch) | **PASS** |
| B8  | Source of truth: Notion → ATLAS FX — Macro + Roadmap Master Brief v2.0 (LOCKED) — 5 April 2026 | Notion source not opened from this analysis lane; the CLAUDE.md summary is the visible authority | **UNRESOLVED — Notion master brief not reviewed; CLAUDE.md summary used as the active spec for this matrix** |

---

## Section C — Event Intelligence Block — 8-field requirement (CLAUDE.md spec item #4)

The CLAUDE.md spec requires the §5 GLOBAL / EVENT INTELLIGENCE block to carry **eight** fields:

| Field           | Source today                                  | Verdict       |
|---|---|---|
| Sentiment header| `eventIntelligence.js::sentimentFromTilt` ✓   | **PASS-shape, FAIL-glyph** — present, but uses `●○` dot glyphs not the PR #74 v6 traffic-light scale (`🟢🟢🟢🟢⚫`) |
| Headline        | Inside raw `calendar.intel` payload (Pipeline C) | **UNRESOLVED** |
| Timestamp       | Inside raw `calendar.intel` payload (Pipeline C) | **UNRESOLVED** |
| Expanded summary| Inside raw `calendar.intel` payload (Pipeline C) | **UNRESOLVED** |
| AI commentary   | Inside raw `calendar.intel` payload (Pipeline C) | **UNRESOLVED** |
| Mechanism chain | Inside raw `calendar.intel` payload (Pipeline C) | **UNRESOLVED** |
| Trader note     | Inside raw `calendar.intel` payload (Pipeline C) | **UNRESOLVED** |
| Affected symbols| Inside raw `calendar.intel` payload (Pipeline C) | **UNRESOLVED** |

**BLOCKED-C1.** Pipeline C content text-diff against the 8-field requirement has not been executed in this tranche. The matrix records the status as UNRESOLVED rather than guess presence.

**BLOCKED-C2.** Pipeline-consolidation question (A + B + C consolidate to one source? if so which?) is the architectural recommendation in `architectural-recommendation.md`. The Brief 2 verified finding states "Pipeline C appears to be the richest content source and is the likely consolidation anchor."

---

## Section D — Pack-3 colour doctrine parity (PR #74 v6 canon)

| Doctrine item | Live state | Verdict |
|---|---|---|
| Sentiment scale uses `🟢/🟠/🔴` traffic-light glyphs with `⚫` inactive disc, `N/5` suffix, `— Label` tail | `eventIntelligence.js::sentimentFromTilt` uses `●○` (filled vs empty circle) — **wrong glyph family**, no traffic-light colour signal | **FAIL** |
| Embed colour stripe (Discord embed JSON, not raw markdown) | All macro builders emit markdown STRINGS, no Discord embed colour stripes | **FAIL — output is markdown; no embed colour stripe** |
| Inline coloured-price tokens (`{{entry/watch/caution/invalid/money}}`) | Not used in any macro module | **N/A — macro does not surface trade-execution prices the way Dark Horse FOH does. Tokens may be doctrine-locked to Dark Horse only; flag for operator decision** |

**BLOCKED-D1.** Whether Macro should migrate from markdown-string output to Discord-embed JSON (matching the Dark Horse v6 pattern) is the Pack-3 architectural decision. Both formats are Discord-renderable; embed format unlocks colour stripe + structured fields + image attachments, but requires a full rewrite of the assembly pipeline.

---

## Section E — Pack-4 Expanded Terminology Hyperlinks parity (PR #74 v6 canon)

| Doctrine item | Live state | Verdict |
|---|---|---|
| Visible-bracket `[[Label]](url)` form, no backslash escapes | NONE of the macro modules emit `[[Label]](url)` form. `glossary.js::footer` emits a short pointer line "Glossary available via the dashboard glossary tab or the terminology command" instead of inline hyperlinks | **FAIL** |
| `[Structure Break]`, `[Risk-Off]`, `[Trigger Level]` cyan bracket hyperlinks on the surface | Not present | **FAIL** |
| BOS surface-translation to `[Structure Break]` | `language.js` TRANSLATE rule does the OPPOSITE — rewrites `broken support/resistance` → `BOS confirmation level` | **FAIL — doctrine-contradicting** |

**BLOCKED-E1.** Pack-4 hyperlink rollout to Macro is the Expanded Terminology Hyperlinks lane (see Deliverable #3).

---

## Section F — BOS / CHoCH surface-leak (operator brief: "Keep BOS internal only unless translated to `[Structure Break]` on the surface")

| Leak | File:line | Verdict |
|---|---|---|
| `Last BOS level` / `Last CHoCH level` emitted to user | `macro/advisoryHeader.js:71` | **FAIL — direct surface leak** |
| `${htfBias.toLowerCase()} BOS on 15M / 30M` emitted to user | `macro/advisoryHeader.js:147` | **FAIL — direct surface leak** |
| TRANSLATE rule REWRITES `broken support`/`broken resistance` → `BOS confirmation level` (injects BOS) | `macro/language.js:101-102` | **FAIL — doctrine-contradicting translation; must flip to `[Structure Break]`** |
| `Bullish/Bearish BOS reference (TF): N.NN` | `macro/spideyStructure.js:130-131` | **FAIL — direct surface leak** |
| Glossary entry `BOS: 'Break of Structure — …'` (audit-expand mode only) | `macro/glossary.js:13` | **PARTIAL** — only surfaces under `ATLAS_DEBUG_AUX=1`; default mode is one-line pointer |
| `tagsUsed.push('BOS', 'CHoCH')` glossary-tag references | `macro/executionLogic.js:9`, `macro/triggerMap.js:9` | **PARTIAL** — only surfaces through glossary footer which is one-line pointer by default |
| Direct user-facing `BOS or CHoCH` emits in advisory copy | `index.js:609, 681-683, 751, 859-860, 1258-1259, 1648` | **FAIL — outside macro/ but inside the same user surface** |
| Visual pattern library entries naming `BOS`, `CHoCH`, `Break of Structure (BOS)` | `visualPatternLibrary.js:130, 144, 159, 173, 428, 454, 465-514, 703, 736` | **FAIL — educational surface; needs Pack-4 translation lane** |

---

## Section G — Banned wording (`macro/language.js::UNIVERSAL_BAN`) parity

The macro's own ban list (UNIVERSAL_BAN at `language.js:17-82`) currently bans:
trigger, authorised/authorized/permitted/permission, blocked, withheld, no clear edge, probability low, trade probability, trade range, execution map, not implemented, unavailable, incomplete, corey clone, corey, spidey, jane, FINAL VERDICT, FINAL DECISION, FINAL READ, WHAT CHANGES THE VIEW, WHAT KEEPS IT BLOCKED, HardConflict, PartialConflict, Market Readiness, macro engine, structure engine, historical engine.

`BOS` and `CHoCH` are **NOT** in `UNIVERSAL_BAN`. The macro scrub will not flag a surface BOS emit as a violation. The PR #74 Dark Horse FOH `BANNED_PATTERNS` (in `darkHorseFoh.js:55-65` at the PR-74 branch) DOES ban `BOS` and `CHoCH` — these doctrines are inconsistent across the two surfaces today.

**BLOCKED-G1.** Operator decision: should the Macro `UNIVERSAL_BAN` adopt the same `BOS` / `CHoCH` ban as the Dark Horse FOH, with companion `[Structure Break]` translations in TRANSLATE?

---

## Section H — Restoration lanes (proposed sequencing — analysis only)

After operator decisions on the BLOCKED items in Sections C, D, E, F, G land, implementation breaks into 7 lanes (matching matrix discipline from PR #73 / PR #74). Full sequencing in `deliverable-3-implementation-package.md`.

| Lane | Touch | Risk | Size |
|---|---|---|---|
| M1 — Sentiment 5-disc traffic-light migration | `macro/eventIntelligence.js`, `macro/livePlan.js` | low — additive | 1 session |
| M2 — Event Intelligence 8-field break-out | `macro/eventIntelligence.js` (consume Pipeline C structured) | medium — needs Pipeline C structural change | 1 session |
| M3 — Pipeline consolidation (A + B + C → C anchor) | `coreyMarketIntel.js`, `corey_calendar.js` | high — touches scheduler / live data | 2 sessions |
| M4 — Roadmap day-of-week depth differentiation | `macro/roadmapLink.js` | low | 1 session |
| M5 — Pack-3 markdown→embed migration (Macro side) | All `macro/*.js` builders, `index.js` deliverResult | very high — full output shape rewrite | 3 sessions |
| M6 — Pack-4 Expanded Terminology Hyperlinks rollout | `macro/glossary.js`, all macro builders (inline `[[Label]](url)`), `language.js` TRANSLATE flip | medium | 1 session |
| M7 — BOS → `[Structure Break]` surface translation | `macro/advisoryHeader.js`, `macro/language.js`, `macro/spideyStructure.js`, `index.js`, `visualPatternLibrary.js`, `macro/glossary.js` audit-expand mode | medium — wide touch surface | 1 session |

**Total** ~10 sessions of focused work. Each lane carries staged screenshot proofs before deploy approval.

---

## Section I — Hard rule honoured

> "Hard rule: If anything from the prototype cannot be implemented, list it as BLOCKED before coding. Do not silently substitute."

Every macro surface here is PASS / PARTIAL / FAIL / UNRESOLVED / BLOCKED. No silent substitutions are proposed. The TRANSLATE → BOS contradiction in `macro/language.js:101-102` is named explicitly as a doctrine-contradicting translation that must be flipped, not silently overwritten.

> "No live deploy until staging screenshot parity review exists."

Section H lanes are gated on per-lane staging screenshots. No lane proceeds to deploy without operator sign-off on the staged Discord output.
