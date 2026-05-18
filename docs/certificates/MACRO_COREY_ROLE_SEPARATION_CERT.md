# Macro Engine vs Corey Role Separation Certificate

**Date / time (UTC):** 2026-05-18T08:08:00Z
**Repo SHA (this branch):** `4ae3739` + this PR's commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery (P1 — Macro/Corey role separation)

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

## Acceptance against the operator brief

- ✅ `CoreyOutput` and `MacroOutput` are separate contracts (separate emitter files, separate Jane slots)
- ✅ Jane distinguishes them (different lane votes; different alignment fields in the packet)
- ✅ No double-counting of one event (Corey doesn't emit a macro packet; Macro emits exactly one)
- ✅ Role separation documented (this cert)

## Cannot do without

- None — separation is clean as-is. No code changes required.
