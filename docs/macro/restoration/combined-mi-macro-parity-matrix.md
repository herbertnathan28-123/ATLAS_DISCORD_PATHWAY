# Combined MI + Macro Parity Matrix — Deliverable #2 (Brief 2)

**Scope.** A single matrix spanning the Market Intel surface
(`coreyMarketIntel.js`, `corey_calendar.js`) plus the Macro v3
surface (`macro/*.js`). Brief 2 explicitly defers the markdown-vs-
embed migration decision until this combined matrix exists, because
both surfaces share the same Discord render path and the Pack-3
colour doctrine must apply consistently.

**Inputs.**
* `macro-ownership-map.md` (Macro Tier-1 module emit shapes).
* `macro-parity-matrix.md` (Macro vs locked CLAUDE.md §3 spec).
* `surface-bos-audit.md` (repo-wide BOS / CHoCH leak inventory).
* Brief 2 verified findings on MI (the original handoff): 19 Tier-1
  source files captured in Notion; MI 01-07 read and verified;
  three overlapping event-intelligence pipelines.

**Acceptance gate.** No matrix row claims "close" — every row is
PASS / PARTIAL / FAIL / UNRESOLVED / BLOCKED. The combined matrix
is the artifact that unlocks the **architectural recommendation**
(separate doc); no implementation lane proceeds until the
operator approves the combined recommendation.

---

## Section A — Surface inventory

| Surface | Module | Lines | Emit format | Pack-3 colour | Pack-4 hyperlinks | BOS surface leak |
|---|---|---:|---|---|---|---|
| Market Intel — pre-event alert (Pipeline A) | `coreyMarketIntel.buildPreEventAlertPayload` | 1592 | plain markdown `{ content }` payload | not applied (`●○` style — needs verify) | not applied | not observed in sampled snippets |
| Market Intel — released-event alert (Pipeline B) | `coreyMarketIntel.buildReleasedEventAlertPayload` | (same file) | plain markdown `{ content }` payload | not applied | not applied | not observed in sampled snippets |
| Market Intel — analyse-time intel (Pipeline C) | `corey_calendar.getEventIntelligence` | 876 | string content folded into `calendar.intel` upstream | not applied — text content carries `Sentiment / Headline / Timestamp / Expanded summary / AI commentary / Mechanism chain / Trader note / Affected symbols` (the 8 CLAUDE.md fields), assumed structurally present per matrix Brief 2 — verification pending | not applied | not observed in sampled snippets |
| Macro v3 — Trade Status (livePlan) | `macro/livePlan.js` | 301 | markdown | not applied (% + /10, not 5-dot or 5-disc) | not applied | none direct |
| Macro v3 — Price Table | `macro/priceTable.js` | 77 | markdown table | not applied | not applied | none |
| Macro v3 — Roadmap Link | `macro/roadmapLink.js` | 27 | markdown link only | not applied | not applied | none |
| Macro v3 — Global / Event Intelligence | `macro/eventIntelligence.js` | 112 | markdown wrapping Pipeline C | partial (`●○`, not v6 traffic-light) | not applied | none direct |
| Macro v3 — Market Overview | `macro/marketOverview.js` | 58 | markdown | n/a (arrow doctrine PASS) | not applied | none |
| Macro v3 — Events / Catalysts | `macro/catalysts.js` | 98 | markdown table | not applied | not applied | none |
| Macro v3 — Historical Context | `macro/historicalContext.js` | 85 | markdown with `tag()` colour stamps + arrows | partial (colour stamps in surface text, not embed stripe) | not applied | none |
| Macro v3 — Execution Logic | `macro/executionLogic.js` | 79 | markdown table (IF/THEN) | not applied | not applied | glossary-tag only (medium severity) |
| Macro v3 — Validity | `macro/validity.js` | 65 | markdown | not applied | not applied | none |
| Macro advisory — Advisory Header | `macro/advisoryHeader.js` | 252 | markdown | partial (`Trade Probability N/5`, `Market Confidence Low/Medium/High`) | not applied | **HIGH — `Last BOS level`, `BOS on 15M/30M`** |
| Macro language — translator/scrubber | `macro/language.js` | 226 | scrubber only | n/a | n/a (controls Pack-4 enforcement) | **CRITICAL — TRANSLATE rules 101-102 inject BOS** |
| Macro support — Spidey Structure | `macro/spideyStructure.js` | 150 | markdown | not applied | not applied | **HIGH — `Bullish/Bearish BOS reference`** |
| Educational — Visual Pattern Library | `visualPatternLibrary.js` | (top-level) | markdown blocks | not applied | not applied | **HIGH — multiple `BOS`/`CHoCH`/`Break of Structure`** |
| Advisory caller — `index.js` advisory text | `index.js` (lines 609, 681-683, 751, 859-860, 1258-1259, 1648) | (within 2000+ line file) | markdown | not applied | not applied | **HIGH — multiple `BOS or CHoCH` direct emits** |

---

## Section B — Combined doctrine compliance (CLAUDE.md + PR #74 v6 canon)

| Doctrine item | Source | MI compliance | Macro compliance | Combined verdict |
|---|---|---|---|---|
| Locked output order (CLAUDE.md §3) | CLAUDE.md | n/a (MI is a scheduler webhook, not a slot in the macro briefing) | **PASS** — `LOCKED_ORDER` matches | **PASS** |
| Sentiment 1–5 dot scale (CLAUDE.md §3) | CLAUDE.md | unknown — needs Pipeline A/B text verification | **PARTIAL** — `eventIntelligence.js` emits 5-dot (`●○`), `livePlan.js` does NOT use 1–5 dot scale | **PARTIAL** — needs MI verification + livePlan fix |
| Pack-3 traffic-light glyphs (`🟢🟢🟢🟢⚫ 4/5 — Label`) | PR #74 v6 canon | **FAIL** — `●○` (filled / empty circle), not traffic-light | **FAIL** — `●○` used; livePlan uses % + /10 | **FAIL** |
| Mixed ⬆️⬇️ arrow under dominant score (CLAUDE.md §3) | CLAUDE.md | unknown — needs Pipeline A/B/C text verification | **PASS** — `language.js::arrow()` returns `⬆️⬇️` for neutral / mixed; used in marketOverview / historicalContext | **PARTIAL** — pending MI verification |
| Event Intelligence 8-field break-out (CLAUDE.md §3) | CLAUDE.md | Pipeline C carries the 8 fields embedded in raw text — needs structural extraction for downstream consumption | **PARTIAL** — `macro/eventIntelligence.js` only breaks out Sentiment + Driver; the rest is embedded in raw `calendar.intel` from Pipeline C | **PARTIAL — UNRESOLVED on the 6 inner fields until Pipeline C content is text-diffed** |
| Strict IF/THEN Execution Logic (CLAUDE.md §3) | CLAUDE.md | n/a | **PASS** — `executionLogic.js` emits `IF … | THEN …` rows | **PASS** |
| Every paragraph in Market Overview / Historical Context ends with ⬆️ or ⬇️ (CLAUDE.md §3) | CLAUDE.md | n/a | **PASS** — `arrow()` closes every paragraph in both | **PASS** |
| Roadmap day-of-week depth (CLAUDE.md §3) | CLAUDE.md | n/a | **FAIL** — `roadmapLink.js` emits link only | **FAIL** |
| Visible-bracket `[[Label]](url)` Expanded Terminology Hyperlinks (PR #74 v6 canon) | PR #74 | not applied | **FAIL** — none of the macro builders emit `[[Label]](url)`; `glossary.js::footer` is a pointer line | **FAIL** |
| Visible-bracket `[Structure Break]`, `[Risk-Off]`, `[Trigger Level]` cyan hyperlinks (operator brief) | Operator | not applied | **FAIL** — no visible-bracket terms on macro surface | **FAIL** |
| BOS surface-translation to `[Structure Break]` (operator brief) | Operator | not observed in sampled snippets (needs full text scan) | **FAIL** — high-severity leaks in advisoryHeader, spideyStructure, advisoryHeader, language.js TRANSLATE rules INJECT BOS; index.js advisory layer has 7+ direct emits | **FAIL — critical** |
| Output format: markdown vs Discord embed JSON | Combined Pack-3 doctrine | markdown payloads (`{ content }`) | markdown strings concatenated by `assemble()` | **BLOCKED** — operator decision required (deferred from PR #74 work, gated on this matrix) |

---

## Section C — Three-pipeline overlap (matrix-critical)

| Pipeline | Where it lives | Emit shape | Required fields | Verdict |
|---|---|---|---|---|
| **A** — scheduler pre-event alert | `coreyMarketIntel.buildPreEventAlertPayload` line 677 | plain markdown `{ content }` Discord webhook payload | Sentiment / Driver / pre-event timing (T-4H / T-1H / T-30M / T-15M) / affected-market bucketing | **PARTIAL — markdown only, not embed JSON; needs Pack-3 verification** |
| **B** — scheduler released-event alert | `coreyMarketIntel.buildReleasedEventAlertPayload` line 731 | plain markdown `{ content }` Discord webhook payload | Released-event sentiment / mechanism chain / actual vs forecast / first-structure-confirmation reset | **PARTIAL — markdown only, not embed JSON** |
| **C** — analyse-command intel | `corey_calendar.getEventIntelligence` line 732 | string content, folded into `calendar.intel`; consumed by `index.js:949`, `index.js:1493`, `macro/eventIntelligence.js:31`, `corey.js:52` | Sentiment header / Headline / Timestamp / Expanded summary / AI commentary / Mechanism chain / Trader note / Affected symbols (CLAUDE.md required 8 fields) | **PARTIAL — text-content text-diff against the 8 fields not yet executed; matrix Brief 2 verified finding states "Pipeline C appears to be the richest content source and is the likely consolidation anchor"** |

**Consolidation BLOCKED-C-cons.** Operator decision required:
* **C-cons-a.** Consolidate A + B + C to a single source (Pipeline C as anchor). All three would emit through one shared content builder.
* **C-cons-b.** Keep A + B + C separate but share a common embed-build helper for the 8 required fields, ensuring identical surface even when source differs.
* **C-cons-c.** Keep A + B + C separate AND independent (status quo).

Matrix Brief 2 verified finding (the original handoff) states Pipeline C is the likely consolidation anchor. The architectural recommendation defaults to **C-cons-a** pending operator confirmation.

---

## Section D — Markdown vs Discord embed migration (Pack-3 decision)

The defer-question from PR #74 is whether to migrate the entire Macro + MI surface from markdown-string output to Discord-embed-JSON output. PR #74 confirmed that the Dark Horse FOH path benefits from embed JSON (left colour stripe + structured fields + image attachments + image dot scales). Macro + MI today emit markdown only.

| Option | Description | Pros | Cons |
|---|---|---|---|
| **D-md.** Keep markdown | Status quo — all macro/MI output as markdown strings, posted via `{ content }` Discord webhook body | Zero rewrite cost; existing language scrub still applies; chunker is already wired (`darkHorseEngine.js::_dhChunkDigest`) | No coloured embed stripe; no inline image attachments (Chart 2×2 already attached separately so this is partial); Pack-3 colour doctrine only achievable through ANSI fences inside ```ansi blocks |
| **D-embed.** Migrate to embeds | Each section becomes a Discord embed with title / description / fields / footer + colour stripe; markdown chunker retired for these surfaces | Pack-3 colour stripe per section; inline images become trivially attachable (chart cards, sentiment dot scales as PNGs); aligns with PR #74 Dark Horse FOH pattern | Full assembly-pipeline rewrite (`macro/index.js` becomes an embed-builder, not a string concatenator); chunking semantics change (10-embed Discord limit per message); existing `language.scrub` must be applied per-field; `contradictionCheck.js` must be applied across the embed set |
| **D-hybrid.** Keep markdown for body, embed for sentiment + header | Trade Status / Live Plan / Validity stay markdown; Sentiment header + Chart 2×2 + Chart Reference become embeds | Lowest-risk path to coloured stripes where they matter most; minimal disruption to the rest of the pipeline | Mixed surface — operators see embed islands inside markdown blocks; visually inconsistent |

**BLOCKED-D.** Operator decision required. Architectural recommendation defaults to **D-hybrid** as the lowest-risk path to apply Pack-3 colour doctrine to the highest-value surfaces (Sentiment, Chart 2×2) without rewriting the entire macro pipeline.

---

## Section E — Pack-4 Expanded Terminology Hyperlinks rollout

PR #74 confirmed the visible-bracket `[[Label]](url)` form as the canonical doctrine. Today, MI + Macro **do not use it**. The `macro/glossary.js::footer` instead emits a pointer line ("Glossary available via the dashboard glossary tab or the terminology command").

| Surface | Hyperlink opportunity |
|---|---|
| Sentiment header (Macro §5) | `[[Market Mood]](url)` |
| Trade Status verdict strip (Macro §2) | `[[Execution Confidence]](url)`, `[[Setup Quality]](url)`, `[[Target Status]](url)` |
| Price Table (Macro §3) | `[[Entry Zone]](url)`, `[[Invalidation]](url)` |
| Events / Catalysts (Macro §7) | `[[Event Risk]](url)` |
| Validity (Macro §10) | `[[Validity Window]](url)` |
| Execution Logic (Macro §9) | `[[Confirmation]](url)`, `[[Stop Loss]](url)`, `[[Trigger Level]](url)` |
| Advisory Header (Macro advisory) | `[[Bias Direction]](url)`, `[[Trade Probability]](url)`, `[[Market Confidence]](url)` |

Pack-4 rollout is Lane M6 in the Macro parity matrix. Effort: ~1 session.

---

## Section F — Glossary defect handling

Brief 2 verified finding: "`06 — macro/glossary.js` is capture-defective / unresolved." Operator decision was Op-1: treat as capture-defective; do not recreate.

**STATUS UPDATE (this tranche):** `/macro/glossary.js` is now present at 51 lines, exports `TERMS`, `lookup`, `footer`. The file is REAL CODE (not the empty PDF capture the Brief 2 audit found). Operator brief in the most-recent message confirms: "Continue from recaptured `macro/glossary.js`. Treat source as present."

The glossary is therefore PRESENT and IN USE. No recreation needed. The Lane M6 Pack-4 hyperlink rollout uses the existing `TERMS` dictionary as the slug source.

---

## Section G — Combined verdict

| Layer | Verdict |
|---|---|
| Locked output order | **PASS** |
| Sentiment scale + arrow doctrine | **PARTIAL** (glyph migration needed) |
| Event Intelligence 8-field break-out | **PARTIAL — UNRESOLVED** (Pipeline C text-diff needed) |
| IF/THEN Execution Logic | **PASS** |
| Market Overview / Historical Context arrow doctrine | **PASS** |
| Roadmap day-of-week depth | **FAIL** |
| Pack-3 colour doctrine (embed stripe) | **FAIL — BLOCKED on operator decision D-md vs D-embed vs D-hybrid** |
| Pack-4 Expanded Terminology Hyperlinks | **FAIL — Lane M6 lift** |
| BOS surface translation | **FAIL — critical (language.js TRANSLATE rules INJECT BOS); Lane M7 lift** |
| Three-pipeline consolidation | **BLOCKED — operator decision C-cons-a/b/c required** |
| Glossary defect | **PASS — file is present** |

---

## Section H — Hard rule honoured

Every row above is PASS / PARTIAL / FAIL / UNRESOLVED / BLOCKED. No silent substitutions. The matrix is the artifact that gates the architectural recommendation; no implementation lane proceeds until the operator confirms the recommendation in `architectural-recommendation.md`.
