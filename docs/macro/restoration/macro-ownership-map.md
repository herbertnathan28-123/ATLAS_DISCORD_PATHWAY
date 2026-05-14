# Macro Ownership Map — Tier-1 Module Findings (Brief 2 / Tranche B)

**Scope.** Module-by-module inventory of every Tier-1 macro file plus
the two upstream Market Intel sources (`coreyMarketIntel.js`,
`corey_calendar.js`). Each row records the module's emit surface,
its position in the locked output, whether it leaks banned
terminology (BOS / CHoCH) to the user, and whether it complies with
the CLAUDE.md-locked Macro spec (sentiment 1–5 scale, mandatory
⬆️/⬇️ arrows at the end of every Market Overview / Historical
Context paragraph, Event Intelligence required fields, IF/THEN
Execution Logic).

**Source of truth.** `CLAUDE.md` §3 ("Locked Macro Spec Summary"),
`macro/orderedSections.js::LOCKED_ORDER`, the file headers of each
module, and PR #74's parity-matrix discipline (BLOCKED / PARTIAL /
PASS / FAIL).

**Hard boundary preserved.** This document records findings only.
No `macro/*.js` file was edited. No `coreyMarketIntel.js` or
`corey_calendar.js` edits. No ranking / scheduler / transport
edits. No production code change.

---

## A — Macro Tier-1 modules (`/macro/*.js`)

| File | Lines | Position in `LOCKED_ORDER` | Emit shape | Required surfaces present | Sentiment scale | ⬆️/⬇️ arrow doctrine | BOS surface leak | Status |
|---|---:|---|---|---|---|---|---|---|
| `index.js`            |  104 | (entry — assembles all sections) | markdown string (concatenated) | n/a — orchestrator | n/a | n/a | none in this file | **PASS** as orchestrator |
| `orderedSections.js`  |   38 | (defines `LOCKED_ORDER`)         | n/a (constant) | 9 of 9 locked sections present (Chart 2×2 ships as image attachment from `index.js` per spec) | n/a | n/a | none | **PASS** |
| `livePlan.js`         |  301 | §2 Trade Status / Final Assessment (merged) | markdown | ATLAS VERDICT, Plain English, Why, Read Maturity /10, verdict strip (Target Status / Buyer-Seller Control / Setup Quality / Execution Confidence / Next Review), Most Likely Behaviour (continuation/range/reversal %), Live Plan block, Final Assessment | uses %-based readiness (0–100) AND a separate readiness /10 — **NOT 1–5 dot scale** per CLAUDE.md spec | n/a (Live Plan does not require trailing arrows) | none in this file (Spidey detail is referenced via `structureBundle`, not emitted) | **PARTIAL — Sentiment 1–5 dot scale missing on Live Plan; everything else PASS** |
| `priceTable.js`       |   77 | §3 PRICE TABLE — ANALYSED TARGETS | markdown table | hero "NO VALID BUY OR SELL TARGET" state, 8 row labels (ENTRY POINT / ENTRY EXTENDED / EXIT POINT / TREND / NEUTRAL MARKET / SET STOP LOSS / EXTENDED STOP LOSS / SELECT ONE STOP LOSS ONLY), reference levels (HIGH/CURRENT/LOW), range-position note | n/a | n/a | none | **PASS** |
| `roadmapLink.js`      |   27 | §4 Roadmap Link | markdown link only | Real link present | n/a | n/a | none | **PARTIAL — Monday full-depth / Wed midweek / Fri execution-focused depth differentiation NOT IMPLEMENTED in this module. Real link only.** |
| `eventIntelligence.js`|  112 | §5 GLOBAL / EVENT INTELLIGENCE   | markdown | Sentiment header (with dot scale), Driver, raw `calendar.intel` payload (when not clustered), FMP earnings context, Advisory state (OPEN/DELAY/PAUSED) | uses `●` filled + `○` empty 5-dot scale — **NOT the v6 traffic-light `🟢🟢🟢🟢⚫ 4/5 — Label` form** that PR #74's Dark Horse uses | n/a | none in this file directly; calendar `intel` payload (pipeline C from `corey_calendar.js::getEventIntelligence`) is inserted RAW — leak risk lives in pipeline C content | **PARTIAL — Sentiment scale glyphs do not match locked v6 traffic-light doctrine; CLAUDE.md required fields (Headline / Timestamp / Expanded summary / AI commentary / Mechanism chain / Trader note / Affected symbols) are NOT broken out — they remain embedded inside the raw `intel` string from Pipeline C and must be verified** |
| `marketOverview.js`   |   58 | §6 Market Overview | markdown | USD tilt paragraph, Risk environment paragraph, Yield curve paragraph, Commodities paragraph | n/a | **PASS** — every paragraph closes with `arrow(score)` → ⬆️ / ⬇️ / ⬆️⬇️ | none | **PASS** |
| `catalysts.js`        |   98 | §7 Events / Catalysts | markdown table + per-event commentary | Events table (When/Currency/Event/Impact/Forecast/Previous), inflation-cluster aggregation, ONE action rule per cluster (not per-event boilerplate) | n/a | n/a | none | **PASS** |
| `historicalContext.js`|   85 | §8 Historical Context | markdown | recent-20-bar net move + efficiency, trend-cleanliness colour stamp, bar-balance paragraph, trade-linkage paragraph | n/a | **PASS** — every paragraph closes with `arrow()` (or `⬆️⬇️` for the mixed-balance case explicitly handled) | none | **PASS** |
| `executionLogic.js`   |   79 | §9 Execution Logic   | markdown table | IF/THEN rows for buyer confirmation, seller confirmation, price confirmation, confirmed buyer/seller control, stop loss, targets, event override, VIX regime, DXY bias | n/a | n/a | line 9 pushes `'BOS', 'CHoCH'` into `tagsUsed` (glossary surface only — not user-facing in this module's emitted text) | **PASS for emitted text. Tag-set referenced in glossary footer must drop BOS / CHoCH per operator brief — flagged as Pack-4 lane** |
| `validity.js`         |   65 | §10 Validity         | markdown | exact UTC + AWST expiry line, next high-impact catalyst line, re-read reminder | n/a | n/a | none | **PASS** |

### Macro **supporting** modules (not direct `LOCKED_ORDER` slots)

| File | Lines | Role | Emit shape | BOS surface leak | Status |
|---|---:|---|---|---|---|
| `advisoryHeader.js`   |  252 | Leading advisory header (12 numbered sections — Action State / Current Price / Bias Direction / Bias Momentum / Trade Probability /5 / Market Confidence / Key Reference Levels / Market Read / Forward Watch / Improves / Cancels / Next Reassessment). Reused by the advisory layer, **NOT inside `LOCKED_ORDER`'s 9 sections.** | markdown | **LEAK** — line 71 emits `Last BOS level` / `Last CHoCH level` to user; line 147 emits `${htfBias} BOS on 15M / 30M` to user. | **PARTIAL — emits required surfaces (Trade Probability /5 etc.) but leaks BOS terms to user** |
| `advisoryWording.js`  |  241 | Wording remappers (action state, trade-status, market-confidence, trade-probability 1–5 helpers used by `advisoryHeader.js`). | n/a (helpers) | n/a | **PASS** as helper; confirms 1–5 trade-probability scale exists for the advisory header (but not propagated into `livePlan.js`'s verdict strip) |
| `language.js`         |  226 | scrub() / scrubSoft() ban list + TRANSLATE map. Applied as the final pass over the assembled macro string in `macro/index.js:63`. | n/a (scrubber) | **DOCTRINE CONTRADICTION** — TRANSLATE lines 101-102 actively REWRITE `broken support` / `broken resistance` *into* `BOS confirmation level`, INJECTING BOS into the user surface. Direct conflict with the operator brief "Keep BOS internal only unless translated to `[Structure Break]` on the surface." | **FAIL — translates legacy phrases INTO BOS rather than away from it. Pack-4 lane MUST flip this translation to `[Structure Break]`** |
| `glossary.js`         |   51 | Term dictionary + footer. Default footer is a single short reference line; `ATLAS_DEBUG_AUX=1` expands the full term list. | markdown footer | line 13 — `BOS: 'Break of Structure — …'` is a glossary ENTRY (defining the term, not emitting it). The footer is bypass by default, so BOS does not reach the user unless `ATLAS_DEBUG_AUX=1` is set. | **PASS in default mode**; under audit-expand mode, surfaces a definition line referencing BOS — must be translated to `[Structure Break]` even in audit mode per operator brief |
| `colours.js`          |   20 | `COLOUR` constants + `tag()` helper (used by `historicalContext.js`). | n/a (helpers) | n/a | **PASS** |
| `contradictionCheck.js`|   57 | Post-assembly contradiction validator. Output is `{ok, reason}` consumed by `index.js:70-89` — logged to console only, never appended to user text. Line 48 uses `BOS|CHoCH|candle close|body close|primary timeframe` as a "defined-term" sanity check for "confirmation" use. | console only | INTERNAL only — does not emit | **PASS** |
| `decisionWeighting.js`|   22 | Reconciles corey / spidey / event-override scores into Jane's composite. Used by `livePlan.js`. | n/a (computation) | none | **PASS** |
| `actionStates.js`     |   30 | Allow-listed ATLAS verdict states (STAND DOWN / HOLD — NO ACTIVE TRADE / ENTRY NOT AVAILABLE / CONDITIONS BUILDING / CONFIRMATION APPROACHING / ARMED / ENTRY CONFIRMED / TRADE CONFIRMED / TRADE INVALID). Used by `livePlan.js`. | n/a (constants + resolver) | none | **PASS** |
| `forwardExpectation.js`|  147 | Per the LOCKED_ORDER comment in `orderedSections.js` lines 6-8, this module is **DELETED as a standalone section**; its logic is folded into Trade Status + Market Overview + Validity. The file still exports `build` but is not called from `macro/index.js`. | dead-code-style fallback | unknown — file not consumed | **MISSING from active flow** — confirm whether the file should be archived or whether some other consumer still calls it |
| `triggerMap.js`       |   48 | Per the LOCKED_ORDER comment, **DELETED as a standalone section** — logic folded into Execution Logic. Still exports `build` but not called from `macro/index.js`. Line 9 pushes `'BOS', 'CHoCH', 'imbalance', 'supply', 'demand', 'trigger'` into `tagsUsed` (glossary tags). | dead-code-style fallback | not consumed → no surface effect | **MISSING from active flow** — confirm archive vs retain |
| `incorego.js`         |  324 | Internal / Country / Regional / Global macro context bundler. Consumed by `advisoryHeader.js`. | markdown sub-blocks | unknown — needs deeper read | **DEFERRED** — out of Tranche B scope, flagged for Tranche C |
| `spideyStructure.js`  |  150 | Spidey structure context block for the advisory layer. | markdown | **LEAK** — lines 130-131 emit `Bullish BOS reference (1H): …` / `Bearish BOS reference (1H): …` to user surface. Line 119 emits `No swing levels, no BOS reference, no pullback or invalidation level can be issued safely…` to user. | **PARTIAL — emits BOS terms to user surface; must translate to `[Structure Break]`** |
| `dataCoverage.js`     |  123 | OHLC + data-source coverage helpers, used by the advisory header tail. | markdown | none | **PASS** |
| `fmpAdapter.js`       |   67 | FMP REST enrichment (earnings + quotes). | data only | n/a | **PASS** |

---

## B — Market Intel side (upstream of Macro)

| File | Lines | Role | Emit shape | Pipeline | BOS surface leak | Status |
|---|---:|---|---|---|---|---|
| `coreyMarketIntel.js`   | 1592 | (a) Pre-event alert payload builder (`buildPreEventAlertPayload` line 677), (b) released-event alert payload builder (`buildReleasedEventAlertPayload` line 731), plus day-theme / currency-narrative / clash-risk / Atlas-response-window / daily-bulletin / geopolitical-status payloads. | plain markdown `{content}` payloads (NOT Discord embed JSON per Pack-3 spec) | **Pipelines A + B** | needs full text scan — top-of-file currency narratives use plain `${ccy}` language, no BOS observed in the snippets read | **PARTIAL — markdown payloads, not embed JSON. Pack-3 question gated on combined parity verdict** |
| `corey_calendar.js`     |  876 | `getEventIntelligence(symbol, opts)` (line 732) — the analyse-command-time intel builder; consumed by `index.js:949`, `index.js:1493`, `macro/eventIntelligence.js:31`, and `corey.js:52`. | string content (markdown) folded into `calendar.intel` upstream of the macro builder | **Pipeline C** | needs full text scan — pipeline C is the matrix-recommended consolidation anchor per Brief 2 | **PARTIAL — richness vs Pipelines A/B not yet diffed; consolidation lane gated on architectural recommendation** |

---

## C — Pipeline overlap (the three event-intelligence sources)

`getEventIntelligence` from `corey_calendar.js` is consumed from FOUR places:

1. `corey.js:52` — `try { if (calendar && calendar.getEventIntelligence) intel = calendar.getEventIntelligence(symbol); } catch (e) { /* swallow */ }` — error swallowed silently. (Operator-flag: silent swallow is a doctrine risk.)
2. `index.js:949` — analyse-command flow, called with `{ assetClass: ac }`.
3. `index.js:1493` — separate analyse-command branch, called with `{ assetClass: calendarAssetClass }`.
4. `macro/eventIntelligence.js:31` — Macro §5 GLOBAL / EVENT INTELLIGENCE consumes `calendar?.intel` (the result of getEventIntelligence supplied to it by the caller).

Pipelines A (pre-event) and B (released-event) in `coreyMarketIntel.js` are scheduler-driven webhook payloads — they DO NOT feed into the Macro v3 pipeline. They are independent Discord posts.

**Pipeline C is the matrix-recommended consolidation anchor** per Brief 2's MI verified findings: "Pipeline C appears to be the richest content source and is the likely consolidation anchor."

---

## D — Locked-spec compliance summary (CLAUDE.md §3)

| Locked-spec requirement | Compliance |
|---|---|
| Locked output order: Chart 2×2 → Trade Status → Price Table → Roadmap Link → Global/Event Intelligence Block → Market Overview → Events/Catalysts → Historical Context → Execution Logic → Validity | **PASS** — `LOCKED_ORDER` matches (Chart 2×2 is image-attachment-only per spec, ships from `index.js`) |
| Sentiment system: Dominant bias on 1–5 dot scale; Mixed ⬆️⬇️ arrows MANDATORY under dominant score | **FAIL** — `eventIntelligence.js` uses `●○` 5-dot but NOT v6 traffic-light. `livePlan.js` uses %-based + /10 readiness; **no 1–5 dot scale on Trade Status**. Arrow `arrow()` helper is present in `language.js` but only used in `marketOverview.js` + `historicalContext.js` |
| Event Intelligence Block fields: Sentiment header / Headline / Timestamp / Expanded summary / AI commentary / Mechanism chain / Trader note / Affected symbols | **UNRESOLVED** — `macro/eventIntelligence.js` only emits Sentiment + Driver + raw `calendar.intel` + FMP earnings + Advisory state. The 6 explicit-field requirements (Headline / Timestamp / Expanded summary / AI commentary / Mechanism chain / Trader note / Affected symbols) are embedded inside the raw `intel` string from Pipeline C and not broken out. Pipeline-C text content must be inspected to confirm presence |
| Execution Logic: Strict IF/THEN format only, no storytelling | **PASS** — `executionLogic.js` emits markdown table rows in `Condition / Action` form with IF/THEN copy |
| Every paragraph in Market Overview and Historical Context must end with ⬆️ or ⬇️ | **PASS** — `marketOverview.js` paragraphs close with `arrow(±score)`; `historicalContext.js` paragraphs close with `arrow()` or explicit `⬆️⬇️` |
| Roadmap: Monday full depth (30–35 page equivalent), midweek remove outdated only, Friday execution-focused | **FAIL** — `roadmapLink.js` is 27 lines and emits a real link only. Day-of-week depth differentiation NOT implemented |

---

## E — BOS surface-leak inventory (cross-file)

Captured here in summary; full audit in `surface-bos-audit.md`.

| File | Line(s) | User-surface emit | Severity |
|---|---|---|---|
| `macro/advisoryHeader.js`   | 71      | `Last BOS level` / `Last CHoCH level` | high |
| `macro/advisoryHeader.js`   | 147     | `${htfBias.toLowerCase()} BOS on 15M / 30M` | high |
| `macro/language.js`         | 101-102 | TRANSLATE rule REWRITES `broken support`/`broken resistance` → `BOS confirmation level` (doctrine-contradicting) | **critical — translation INJECTS BOS into the surface** |
| `macro/spideyStructure.js`  | 119, 130-131 | `Bullish/Bearish BOS reference (TF): N.NN`, `no BOS reference can be issued safely` | high |
| `macro/glossary.js`         | 13      | Glossary entry — `BOS: 'Break of Structure — …'` (only surfaces under `ATLAS_DEBUG_AUX=1`) | low |
| `macro/executionLogic.js`   | 9       | `tagsUsed.push('confirmation', 'stop_loss', 'BOS', 'CHoCH')` — glossary footer reference only, default footer is one-line pointer to dashboard glossary tab | low |
| `index.js`                  | 609, 681-683, 751, 859-860, 1258-1259, 1648 | Multiple direct user-facing emits referencing `BOS or CHoCH` | high |
| `visualPatternLibrary.js`   | 130, 144, 159, 173, 428, 454, 465-485, 504-514, 703, 736 | Educational pattern entries with `BOS confirmed`, `Break of Structure (BOS)`, `bullish BOS`, etc. | high |

---

## F — Status legend

* **PASS** — verified compliant with spec.
* **PARTIAL** — partial compliance; gap stated explicitly.
* **FAIL** — required surface absent or doctrine-contradicting behaviour.
* **UNRESOLVED** — gap-state needs deeper inspection (pipeline-C text content not yet diffed).
* **MISSING from active flow** — module exists, exports a builder, but is not called from the current entry point.
* **DEFERRED** — out of Tranche B scope, flagged for follow-up.

---

## G — Hard rule honoured

Per Brief 2 Lane 2 doctrine: **no implementation, no production code changes, no rewriting.** This file records findings only. Every gap above is labelled PASS / PARTIAL / FAIL / UNRESOLVED / MISSING / DEFERRED. No silent substitutions are proposed in this document.

The implementation lanes are sequenced in `deliverable-3-implementation-package.md`. The acceptance gate is sequenced in `deliverable-4-staging-proof-plan.md`. Both are recommendations awaiting operator approval before any code lands.
