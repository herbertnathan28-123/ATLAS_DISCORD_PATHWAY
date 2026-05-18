# Macro Search Live Command Certificate

**Date / time (UTC):** 2026-05-18T09:30:00Z
**Repo SHA:** `6858a90b51de38f0a6633d52d22133d89b0daf90` + Cursor addendum commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery addendum (P1 — Macro search live command proof)

**Status:** Macro-search command renderer proof PASS against live TradingView calendar data. Live Discord send proof remains BLOCKED in sandbox (no bot token / no live webhook). Fixture-path proof is locked per the brief: *"If live Discord cannot be run: State exact blocker and provide fixture-path proof instead."*

---

## Blocker (exact)

The sandbox CI environment has no `DISCORD_BOT_TOKEN`, no `MARKET_INTEL_WEBHOOK`, and no `DARK_HORSE_WEBHOOK`. Therefore the final Discord POST cannot be executed from this workspace. The macro-search command path itself was run locally against live TradingView calendar data using:

```bash
node scripts/test_macro_search.js
```

Live data proof from the run:

```text
[COREY-CALENDAR] source=tv status=200 content-type=application/json events=86 health=ok
[COREY-CALENDAR] refresh summary tv=86(ok) ... source_used=tradingview mode=LIVE available=true
[MACRO-SEARCH-QA] calendar_source=tradingview mode=LIVE events=86
```

The final Discord send remains a deploy/webhook proof item, not a renderer/command correctness blocker.

## Required live commands (per the brief)

| Command | Status | Live/fixture result |
|---|---|---|
| `EURUSD macro` | PASS | resolved `symbol:EURUSD`; Jane final `STAND_DOWN`; FOH rendered true; degradation: Corey Clone BLOCKED (`EURUSD/1D.jsonl` missing), Spidey PARTIAL (`no_candles_supplied`) |
| `GBPUSD macro` | PASS | resolved `symbol:GBPUSD`; Jane final `STAND_DOWN`; FOH rendered true; degradation: Corey Clone BLOCKED (`GBPUSD/1D.jsonl` missing), Spidey PARTIAL |
| `USDJPY macro` | PASS | resolved `symbol:USDJPY`; Jane final `STAND_DOWN`; FOH rendered true; degradation: Corey Clone BLOCKED (`USDJPY/1D.jsonl` missing), Spidey PARTIAL |
| `AUDJPY macro` | PASS | resolved `symbol:AUDJPY`; Jane final `STAND_DOWN`; FOH rendered true; degradation: Corey Clone BLOCKED (`AUDJPY/1D.jsonl` missing), Spidey PARTIAL |
| `DXY macro` | PASS | resolved `symbol:DXY`; lead symbol `EURUSD`; Jane final `STAND_DOWN`; FOH rendered true; DXY rendered as `US Dollar Strength (DXY)` |
| `NFP impact` | PASS | resolved `event:NFP`; no matching live row in current window, so scenario read only; Jane final `STAND_DOWN`; FOH rendered true |
| `CPI impact` | PASS | resolved `event:CPI`; matched `Inflation Rate YoY`; Jane final `STAND_DOWN`; FOH rendered true |
| `FOMC Minutes impact` | PASS | resolved `event:FOMC Minutes`; matched `FOMC Minutes`; Jane final `STAND_DOWN`; FOH rendered true |
| `today's major events` | PASS | resolved `calendar:today_major_events`; Jane final `STAND_DOWN`; FOH rendered true |
| `next 72 hours macro` | PASS | resolved `calendar:next_72_hours_macro`; Jane final `STAND_DOWN`; FOH rendered true |

## Acceptance per output (locked via test suite)

For every command above, the rendered output must show:

| Required field | Code site | Test cover |
|---|---|---|
| THE CALL first | `macro/searchMacro.js renderMacroSearchContent()` starts `result.content` with `🔥 **THE CALL**` | `scripts/test_macro_search.js` asserts `result.content.startsWith('🔥 **THE CALL**')` for all 10 commands |
| Jane final state respected | `searchMacro.js:476-489` → `runJane()` is the last gate; `deriveJaneFinalState()` drives the output | `scripts/test_macro_search.js` proof logs assert `[JANE] final_state=...` for every command |
| Affected markets shown | `renderEventRows()` / affected-instrument section | `scripts/test_macro_search.js` asserts `**Affected instruments**` and event-row `affected:` where live event rows exist |
| Full Brief / Brief Pending shown | `renderEventRows()` emits `Full Brief: <url>` or `Full Brief: Brief Pending` | `scripts/test_macro_search.js` asserts `Full Brief: (Brief Pending|https?://|/market-intel/brief/)` |
| Source / degradation note shown | `**Source note**` and `**Blocked / degraded**` sections | `scripts/test_macro_search.js` asserts both sections for every command |
| No stale prototype content | `BANNED_TERMS_USERFACING` (`fohOutputContract.js:104-105`) — includes `prototype render`, `Future scans will` | `tests/fohContract.darkHorse.test.js` + `tests/fohContract.marketIntel.test.js` |
| No historical claims unless Corey Clone is decision-grade | Jane's `cloneActive` gate caps tradeViability to MARGINAL; macro search reports `Corey Clone BLOCKED usableForDecision=false` in this run | `tests/janeEvidenceWeighting.test.js` T3 + macro-search proof logs |
| No execution authority unless Jane gives it | `actionState` derives from `tradeViability`; macro-search content includes `Jane remains final gate` | `scripts/test_macro_search.js` asserts no `authorised/entry authorised/trade confirmed/trade permitted` wording |
| `US Dollar Strength (DXY)` (not bare DXY) | `displayInstrument()` + `userFacingText()` in `macro/searchMacro.js` | `scripts/test_macro_search.js` asserts no user-facing line leads with raw `DXY/VIX` |
| `Market Volatility (VIX)` (not bare VIX) | same | same |

## Fixture / renderer proof artefact

The strongest local proof for this addendum is `scripts/test_macro_search.js` because it runs the actual `runMacroSearch(query, { snapshot, refreshCalendar:false })` function for all required commands after pulling a live TradingView snapshot. It does not POST to Discord, but it proves the exact content payload that would be sent through the Discord command surface.

## Acceptance against the operator brief

- ✅ Required commands enumerated, with live TradingView calendar + renderer proof per command
- ✅ Required per-output fields covered by named tests
- ✅ Exact blocker stated (no live Discord access in sandbox)
- ✅ Exact live-data proof recorded: TradingView `events=86`, mode `LIVE`, all 10 macro-search commands PASS

## Next-deploy follow-up

Re-issue this cert against live Discord output once Render deploy completes and webhook/bot credentials are available. The command list above + expected fields produce a 1:1 cross-check against the live render.
