# Surface BOS / CHoCH Audit (repo-wide)

**Operator brief.** *"Keep BOS internal only unless translated to
`[Structure Break]` on the surface."*

**Scope.** Every `.js` file under `ATLAS_DISCORD_PATHWAY` that
either emits `BOS` / `CHoCH` / `Break of Structure` / `Change of
Character` to a user-facing surface OR actively translates legacy
phrases *into* `BOS`. Internal-only references (variable names,
branch tags, validator regex) are listed for completeness but are
inside doctrine.

**Method.** Repo-wide grep + per-hit source review. No source
file was edited. This audit records findings and lists the
specific translation each leak requires.

---

## Severity legend

* **critical** — actively *injects* BOS / CHoCH into user surface (a TRANSLATE rule pointing the wrong way, or a default-rendered glossary entry).
* **high** — direct user-facing emit referencing BOS / CHoCH by name.
* **medium** — surfaces only under a debug flag or audit mode.
* **low** — internal-only reference (variable name, branch tag, validator regex); inside doctrine, no translation needed.

---

## A — Critical (translation rules pointing INTO BOS — must flip)

| File:line | Pattern | Required action |
|---|---|---|
| `macro/language.js:101` | `[/\bbroken support\b/gi, 'BOS confirmation level']` | Replace target with `'[Structure Break] confirmation level'` (visible-bracket form). |
| `macro/language.js:102` | `[/\bbroken resistance\b/gi, 'BOS confirmation level']` | Replace target with `'[Structure Break] confirmation level'`. |

These two lines are doctrine-contradicting: they rewrite legacy
wording (`broken support` / `broken resistance`) **into** the BOS
term that doctrine asks us to keep internal. They must be flipped
to emit `[Structure Break]` instead. This is a one-line-each
change but it is the highest-priority Pack-4 surface fix.

---

## B — High (direct user-surface emits)

### macro/

| File:line | Current emit | Required translation |
|---|---|---|
| `macro/advisoryHeader.js:71` | `Last BOS level` / `Last CHoCH level` | `Last [Structure Break] level` (per operator brief; CHoCH semantics handled in §D below). |
| `macro/advisoryHeader.js:147` | ``${htfBias.toLowerCase()} BOS on 15M / 30M with imbalance retained`` | ``${htfBias.toLowerCase()} [Structure Break] on 15M / 30M with imbalance retained`` |
| `macro/spideyStructure.js:130-131` | `Bullish BOS reference (1H): N.NN` / `Bearish BOS reference (1H): N.NN` | `Bullish [Structure Break] reference (1H): N.NN` / `Bearish [Structure Break] reference (1H): N.NN` |
| `macro/spideyStructure.js:119` | `No swing levels, no BOS reference, no pullback or invalidation level can be issued safely…` | `No swing levels, no [Structure Break] reference, no pullback or invalidation level can be issued safely…` |

### index.js

| File:line | Current emit (paraphrased) | Required translation |
|---|---|---|
| `index.js:609` | `Only once lower-timeframe structure confirms the direction shown above (BOS or CHoCH on at least the 1H), AND price is inside the planned entry zone.` | `Only once lower-timeframe structure confirms the direction shown above ([Structure Break] on at least the 1H), AND price is inside the planned entry zone.` |
| `index.js:681` | `The named conflict above to clear AND a fresh structural break (BOS or CHoCH) on at least the 1H AND…` | `The named conflict above to clear AND a fresh [Structure Break] on at least the 1H AND…` |
| `index.js:682` | `A confirmed bullish OR bearish break (BOS / CHoCH) on the 1H or higher with a candle close beyond the break level.` | `A confirmed bullish OR bearish [Structure Break] on the 1H or higher with a candle close beyond the break level.` |
| `index.js:683` | `A ${bias.toLowerCase()} BOS or CHoCH on at least the 1H (candle close beyond the break level)…` | `A ${bias.toLowerCase()} [Structure Break] on at least the 1H (candle close beyond the break level)…` |
| `index.js:751` | `Liquidity → structure break (BOS / CHoCH) → candle close → identify fresh supply/demand zone…` | `Liquidity → [Structure Break] → candle close → identify fresh supply/demand zone…` (already says "structure break"; just drop the parenthetical `(BOS / CHoCH)`). |
| `index.js:859-860` | `Last BOS: ${st.bos.tf} ${direction} ${kind} at price` / `Last BOS: none on the tracked timeframes — structure is not yet confirmed in either direction.` | `Last [Structure Break]: …` / `Last [Structure Break]: none on the tracked timeframes…` |
| `index.js:1258` | `…no directional execution path is authorised yet. A new plan only starts once price prints a confirmed bullish or bearish structure break (BOS or CHoCH) on at least the 1H…` | Drop the parenthetical `(BOS or CHoCH)`. Already says "structure break". |
| `index.js:1259` | `Wait for a fresh structural break in the ${bias} direction. Required: BOS or CHoCH on at least the 1H…` | `Wait for a fresh [Structure Break] in the ${bias} direction. Required: [Structure Break] on at least the 1H…` |
| `index.js:1648` | `whatTraderIsWaitingFor || 'A confirmed BOS / CHoCH on at least the 1H, candle-close beyond the break level…'` | `'A confirmed [Structure Break] on at least the 1H, candle-close beyond the break level…'` |

### visualPatternLibrary.js (educational surface)

| File:line | Current emit | Required translation |
|---|---|---|
| `visualPatternLibrary.js:130, 144` | ASCII pattern annotations `← BOS confirmed` | `← [Structure Break] confirmed` |
| `visualPatternLibrary.js:159, 173` | ASCII pattern annotations `⇒ CHoCH` | `⇒ [Initial-direction reversal]` (CHoCH semantics — see §D) |
| `visualPatternLibrary.js:428` | `…(continuation, calm retest, BOS)` | `…(continuation, calm retest, [Structure Break])` |
| `visualPatternLibrary.js:454` | `…(continuation lower, breakdown + retest, BOS down)` | `…(continuation lower, breakdown + retest, [Structure Break] down)` |
| `visualPatternLibrary.js:465` | `name: 'Break of Structure (BOS)'` | `name: '[Structure Break]'` (the parenthetical `(BOS)` drops on the user surface; the internal pattern tag stays as a code-level `termTags` reference) |
| `visualPatternLibrary.js:473` | `level3Stub: 'Live anchor pending — engine attaches the most recent BOS bar here.'` | `level3Stub: 'Live anchor pending — engine attaches the most recent [Structure Break] bar here.'` |
| `visualPatternLibrary.js:474-475` | `plainEnglish: 'A break of structure is the first candle that closes (full body) beyond a prior swing high (for a bullish BOS) or below a prior swing low (for a bearish BOS). It is the moment the structural read changes.'` + `whyItMatters: 'BOS is the first piece of evidence that a trend is extending…'` | Replace `BOS` references with `[Structure Break]`; semantically equivalent. |
| `visualPatternLibrary.js:479-483` | `commonMistakes`/`atlasInterpretation` lines naming `BOS` | Replace with `[Structure Break]`. |
| `visualPatternLibrary.js:485` | `termTags: ['BOS', 'break_of_structure', 'structure_break']` | Internal tag set — leave `'BOS'` IN the tag list (internal) but ensure no consumer renders the tag list raw. Verify by reviewing `scripts/test_visual_pattern_library_qa.js`. |
| `visualPatternLibrary.js:494` | `name: 'Change of Character (CHoCH)'` | `name: '[Initial-direction reversal]'` per the v6 doctrine rename (see §D) |
| `visualPatternLibrary.js:502-514` | Multiple `CHoCH` / `BOS` references | Translate per §D. |
| `visualPatternLibrary.js:703, 736` | `CHoCH / reversal` / `CHoCH / BOS in the new direction` | Translate per §D. |

---

## C — Medium (surfaces only under debug / audit flag)

| File:line | Surface | Severity |
|---|---|---|
| `macro/glossary.js:13` | Glossary entry `BOS: 'Break of Structure — …'` — surfaces only under `ATLAS_DEBUG_AUX=1` (audit-expand mode) | medium |
| `macro/glossary.js:14` | Glossary entry `CHoCH: 'Change of Character — …'` — same audit mode | medium |
| `macro/executionLogic.js:9` | `tagsUsed.push('confirmation', 'stop_loss', 'BOS', 'CHoCH')` — only surfaces if `glossary.footer` is in audit mode | medium |
| `macro/triggerMap.js:9` | `tagsUsed.push('BOS', 'CHoCH', 'imbalance', 'supply', 'demand', 'trigger')` — same audit mode; also this module is **dead-code per the LOCKED_ORDER comment** (deleted as standalone section) | medium |

**Required action for audit-mode glossary.** Even under `ATLAS_DEBUG_AUX=1`, the rendered glossary should refer to `[Structure Break]` rather than `BOS`. Internal `TERMS` keys can stay (they are dictionary lookups, not user-facing labels). Two options:

* **C-a.** Rename `TERMS.BOS` → `TERMS.structure_break` and update all `tagsUsed.push('BOS', …)` references to `'structure_break'`. Cleaner but touches every macro module's `tagsUsed.push` call.
* **C-b.** Keep `TERMS.BOS` as the dictionary key but rewrite the human-readable definition to lead with `[Structure Break]` (the BOS name only appears as a parenthetical for trader recognition). One-line change.

Recommend **C-b** for the audit-expand surface; C-a is a deeper refactor reserved for Lane M7.

---

## D — CHoCH translation policy (operator decision required)

The operator brief explicitly names `BOS → [Structure Break]`.
CHoCH is not named. Three possible policies:

* **D-1.** Treat CHoCH the same as BOS — translate every surface emit to `[Structure Break]`. Loses the directional-flip nuance (CHoCH is specifically the first counter-trend break; BOS is any structural close beyond a swing).
* **D-2.** Translate CHoCH to a distinct doctrine label such as `[Initial-direction reversal]` (the gallery already uses this label for "whipsaw" — semantic overlap is imperfect but operator-supplied). PR #74's terminology table already maps `Whipsaw → Initial-direction reversal`; CHoCH could reuse the same label.
* **D-3.** Translate CHoCH to a new label such as `[Trend reversal break]` or `[First counter-trend break]`.

**BLOCKED-D-CHoCH.** Pending operator decision. Audit recommendation: **D-2**, reusing the existing `[Initial-direction reversal]` slug because it is already in the doctrine terminology table (PR #74's `darkHorseFoh.js` v6 has `'Initial-direction reversal': 'term-initial-direction-reversal'` in the TERMINOLOGY map). Reuse keeps the glossary slim; semantic accuracy is good-enough (CHoCH IS the first counter-trend break, which is one of the canonical initial-direction-reversal forms). Operator may override.

---

## E — Low (internal-only — no translation needed)

| File:line | Reference | Why it is internal |
|---|---|---|
| `index.js:472` | Comment `// Structure timeline — BOS / zone origin / setup age` | Code comment; never emitted to user. |
| `index.js:2913` | `function detectBreaks()` — assigns `lastBreak: 'BOS'` / `lastBreak: 'CHoCH'` to internal records | Internal enum-style return field; never directly rendered (consumers translate via the leak sites in §B). |
| `index.js:2920` | `runSpideyMicro` — `m15B.lastBreak === 'BOS' || m15B.lastBreak === 'CHoCH'` | Internal logic guard. |
| `index.js:3081` | Comment `// Spidey structured output — swings, BOS, body-close rule…` | Code comment. |
| `index.js:810` | `if (/\bconfirmation\b/i.test(allText) && !/(BOS|CHoCH|candle close|structure break)/i.test(allText)) return r('confirmation_used_without_definition');` | Internal validator — guards against using "confirmation" without a defining word. **OK if BOS stays banned on surface** because the validator accepts `structure break` as an alternative definer; the `BOS` / `CHoCH` regex alternates can be DROPPED from this validator once the surface is fully translated (Lane M7 follow-up). |
| `macro/contradictionCheck.js:48` | `if (/\bconfirmation\b/i.test(t) && !/(BOS|CHoCH|candle close|body close|primary timeframe)/i.test(t)) return fail('confirmation_used_without_definition');` | Internal validator — same shape as `index.js:810`. Same follow-up note. |
| `scripts/test_visual_pattern_library_qa.js:162-163, 213, 229, 299-301` | Test assertions referencing `'BOS'` / `'CHoCH'` / `'/learn/bos'` | Internal test artefacts. **NEED REVIEW** under Lane M7 — when the visual pattern library is translated, the test assertions must be updated in lockstep (matching PR #74's discipline of realigning QA assertions to match the new surface). |
| `scripts/test_recovery.js:12, 164-165, 191` | Test fixture data with `lastBreak: 'BOS'` etc. | Internal enum field; fixture-only. Test assertion at line 191 references "BOS reference" in render output — will need updating under Lane M7 once `macro/spideyStructure.js` is translated. |
| `scripts/test_discord_batch_qa.js:106` | `/\bconfirmed BOS \/ CHoCH\b/i` regex | Internal QA assertion — appears to test that the LEGACY phrase still appears (likely BAN-style). Needs review under Lane M7. |
| `scripts/preview_dh_foh_v6_live.js:236` (and on PR #74's branch `scripts/test_dh_foh_qa.js`) | Banned-wording sweep regex `/\bBOS\b/`, `/\bCHoCH\b/` | This is the **CORRECT** behaviour — the Dark Horse FOH banned-wording sweep refuses to emit BOS to the surface. Treat as the reference template for Macro's UNIVERSAL_BAN extension (Lane M7). |

---

## F — Summary tally

| Severity | Count of surface lines |
|---|---:|
| critical (translation pointing INTO BOS) | 2 |
| high (direct user-surface emits) | 22+ |
| medium (debug/audit-only) | 4 |
| low (internal-only, no translation needed) | 11+ |

---

## G — Recommended remediation order (Lane M7)

1. **First — flip the translation.** Edit `macro/language.js:101-102` to replace `'BOS confirmation level'` → `'[Structure Break] confirmation level'`. Two-line change. Stops the doctrine-contradicting injection immediately.
2. **Second — UNIVERSAL_BAN extension.** Add `/\bBOS\b/`, `/\bCHoCH\b/` to `macro/language.js::UNIVERSAL_BAN`. Macro `scrub()` will now throw on surface emits, mirroring the Dark Horse FOH guard.
3. **Third — translate the macro surface emits** in `macro/advisoryHeader.js:71, 147`, `macro/spideyStructure.js:119, 130-131`.
4. **Fourth — translate the `index.js` advisory emits** at the 7 line groups listed in §B.
5. **Fifth — translate `visualPatternLibrary.js`** entries + update `scripts/test_visual_pattern_library_qa.js` assertions in lockstep.
6. **Sixth — audit-expand glossary** rewrite per option C-b.
7. **Seventh — update test fixtures** (`scripts/test_recovery.js`, `scripts/test_discord_batch_qa.js`) and run the full QA suite; expect realignment failures in scripts whose markers were specifically asserting the old wording.

Each step in isolation is a one-file change. Total Lane M7 effort: ~1 focused session, then 1 QA-fix pass. Step 1 alone is a critical fix that should ship even if the rest of Lane M7 is queued.

---

## H — Hard rule honoured

This audit names every surface leak explicitly. No silent
substitution proposed. CHoCH's translation slug is BLOCKED on
operator decision (D-1 / D-2 / D-3). Lane M7 is gated on per-file
staging screenshot proof before deploy — matrix discipline.
