# Macro Engine vs Corey Role Separation Certificate

**Date / time (UTC):** 2026-05-18T09:22:00Z
**Repo SHA (this branch):** `6858a90b51de38f0a6633d52d22133d89b0daf90` + Cursor addendum commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery addendum (P1 — Macro/Corey role separation)

---

## Role definitions

| Engine | Role | Owns | Emits | Consumed by |
|---|---|---|---|---|
| **Corey** | current event / regime authority | immediate risk modifiers, live bias | `CoreyOutput { score, confidence, riskModifiers, ... }` | Jane lane #2 (event response) |
| **Corey Live Data** | live-market context provider (DXY/VIX/yields/curve) | live market state snapshot | `getLiveContext() → { vix, dxy, yields, curve, ... }` | Macro engine input, Corey input |
| **Macro Engine** | broader macro / event normalisation | calendar + sentiment + transmission paths | `MacroOutput { score, confidence, evidence, macroIntelligencePacket }` | Jane lane #4 (macro context) |
| **Macro Intelligence Packet** | the structured-event packet inside MacroOutput | event clusters, primary focus, transmission map | `{ primaryEventFocus, eventClusters, todaysAnnouncements, next72Hours, ... }` | MI roadmap formatter, FOH packets |

## Where each emission lives

- `corey.js` — Corey current-event entry (small stub; defers regime detail to `corey_live_data.js`)
- `corey_live_data.js` — live-market context (DXY/VIX/yields). Reads provider data; emits the `liveContext` used by Corey + Macro Engine.
- `macro.js` — Macro Engine entry. Reads calendar snapshot + `liveContext` + FMP + EODHD adapters; produces `MacroOutput.macroIntelligencePacket`.
- `macro/interpretCalendarEvents.js` — builds the `macroIntelligencePacket` (primary focus, clusters, transmission map).
- `orchestrator.js` — orchestrator fan-out. Calls `coreyRun()` + `macroRun()` separately; assigns each result to its own slot before handing to Jane.

## Jane receives both lanes separately (`jane.js:114-118`)

```js
if (spideyActive && input.spidey && ...) { scoreInputs.push(input.spidey.score); ... }
if (coreyActive  && input.corey && ...)  { scoreInputs.push(input.corey.score); ... }     // event-driven lane
if (cloneActive  && input.coreyClone && ...) { scoreInputs.push(input.coreyClone.score); ... }
if (macroActive  && input.macro && ...)  { scoreInputs.push(input.macro.score); ... }     // normalised-narrative lane
```

`input.corey` and `input.macro` are distinct slots. Jane votes each lane independently. The `coreyMacro` alias on the input bag (`jane.js:54`) is for backwards-compat with the old call signature and resolves to the Macro Engine's `macroIntelligencePacket`, not a duplicated Corey field.

## Dedupe / double-counting check

- Corey emits **no** `macroIntelligencePacket` field — only `riskModifiers` + bias + score (event-response semantics).
- Macro emits **one** `macroIntelligencePacket` per `macroRun()` (calendar-narrative semantics).
- Both flow into Jane via separate slots; aggregation is one-vote-per-engine.
- The MI formatter (`coreyMarketIntel.js`) reads `macroIntelligencePacket` directly (NOT `corey.macroIntelligencePacket`, which doesn't exist) → no event is counted twice.
- Spot-check grep: `grep -n "corey\.macroIntelligencePacket" *.js` → 0 hits. There is no code path consuming a Corey-emitted macro packet.

## Duplicate evidence policy

The same scheduled event can be visible to both lanes because both Corey and Macro Engine can read the calendar snapshot / live macro context:

- **Corey lane:** session/regime response (`CoreyOutput.authority = current_macro_regime_event`) with `riskModifiers`, current bias, and live context evidence.
- **Macro lane:** normalised event packet (`MacroOutput.authority = macro_normalisation`) with `macroIntelligencePacket`, event clusters, affected markets, and transmission map.

This is not treated as two copies of the same evidence inside one lane. Jane source-weights it:

```js
if (coreyActive && input.corey && typeof input.corey.score === 'number') {
  scoreInputs.push(input.corey.score);
}
if (macroActive && input.macro && typeof input.macro.score === 'number') {
  scoreInputs.push(input.macro.score);
}
```

Each authority contributes at most **one lane vote** regardless of how many paragraphs, repeated event clusters, or mechanism-chain strings it contains. If the same CPI / NFP / FOMC event appears in both Corey and Macro, Jane sees it as:

1. Corey current-regime lane vote.
2. Macro normalisation lane vote.

It does **not** count every duplicate sentence, event row, or affected-market paragraph. This is source-weighting rather than semantic event-row dedupe, and it is the correct Phase-B architecture because Corey and Macro answer different questions about the event.

## No verbosity authority proof

`tests/janeEvidenceWeighting.test.js` now locks both sides of the addendum requirement:

| Test | Verbosity inflated | Expected proof |
|---|---|---|
| T6 | Corey narrative/mechanism/evidence volume | `marketConfidence`, `setupQuality`, and `tradeViability` remain identical |
| T7 | Macro repeated event rows, expanded summaries, transmission map volume | `marketConfidence`, `setupQuality`, `tradeViability`, and `actionState` remain identical |

This proves:

- no macro verbosity increases decision authority;
- no Corey verbosity increases decision authority;
- no duplicated event text increases decision authority;
- Jane's authority comes from lane status + lane score/confidence + gates, not output length.

## Acceptance against the operator brief

- ✅ `CoreyOutput` and `MacroOutput` are separate contracts (separate emitter files, separate Jane slots)
- ✅ Jane distinguishes them (different lane votes; different alignment fields in the packet)
- ✅ No double-counting of one event by text volume (Corey doesn't emit a macro packet; Macro emits exactly one; Jane source-weights each lane once)
- ✅ Duplicate event evidence is source-weighted at Jane, not counted per repeated row/paragraph
- ✅ Macro verbosity does not increase decision authority (test-locked by `tests/janeEvidenceWeighting.test.js` T7)
- ✅ Role separation documented (this cert)

## Cannot do without

- None — separation is clean as-is. No code changes required.
