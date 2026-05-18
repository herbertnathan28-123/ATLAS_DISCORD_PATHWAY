# Macro Search Live Command Certificate

**Date / time (UTC):** 2026-05-18T08:18:00Z
**Repo SHA:** `4ae3739` + this PR's commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery (P2 — Macro search live command proof)

**Status:** Live Discord proof BLOCKED in sandbox (no bot token / no live webhook). Fixture-level proof is locked instead per the brief: *"If live Discord cannot be run: State exact blocker and provide fixture-path proof instead."*

---

## Blocker (exact)

The sandbox CI environment has no `DISCORD_BOT_TOKEN`, no `MARKET_INTEL_WEBHOOK`, no `DARK_HORSE_WEBHOOK`. Live `/macro <symbol>` command output cannot be driven from here. The next Render deploy will surface live Discord output that this cert can be re-issued against.

## Required live commands (per the brief)

| Command | Status (fixture-level) | Test reference |
|---|---|---|
| `EURUSD macro` | PASS (fixture) | `tests/fohLiveDispatchText.test.js` MI live-dispatch path; `npm run qa:market-intel` daily fixtures |
| `GBPUSD macro` | PASS (fixture) | same |
| `USDJPY macro` | PASS (fixture) | same |
| `AUDJPY macro` | PASS (fixture) | same |
| `DXY macro` | PASS (fixture) | macro search rendering exercises `_displayInstrument('DXY')` → `'US Dollar Strength (DXY)'`; `tests/fohTerminology.test.js` 11 PASS locks the substitution |
| `NFP impact` | PASS (fixture) | `scripts/test_macro_search.js` event fixture (live route fixture) |
| `CPI impact` | PASS (fixture) | same |
| `FOMC Minutes impact` | PASS (fixture) | same |
| `today's major events` | PASS (fixture) | `tests/marketIntelDailyRoadmap.test.js` T5 (Red/Amber filter); MI roadmap renders the calendar block |
| `next 72 hours macro` | PASS (fixture) | same — `next72Hours` packet drives the calendar |

## Acceptance per output (locked via test suite)

For every command above, the rendered output must show:

| Required field | Code site | Test cover |
|---|---|---|
| THE CALL first | `coreyMarketIntel.js buildDailyRoadmapMessages msg1` — boxed `🔥 THE CALL` is the first major section after the report heading + control strip | `tests/marketIntelDailyRoadmap.test.js` T2 lines 56-58 |
| Jane final state respected | `searchMacro.js:476-489` → `runJane()` is the last gate; `actionState` + `tradeViability` drive the output | `tests/janeEvidenceWeighting.test.js` 14 PASS (T1–T6) |
| Affected markets shown | `_miAffectedMarketCards` → boxed `🎯 AFFECTED MARKETS` card in MSG 2 | `tests/marketIntelDailyRoadmap.test.js` T3 |
| Full Brief / Brief Pending shown | `_miBriefRows` → `🔗 FULL BRIEF / BRIEF PENDING` boxed section in MSG 3 | T3 |
| Source / degradation note shown | `sourceNote` line at the bottom of every message | T2 (line 78) + T6 (last test) |
| No stale prototype content | `BANNED_TERMS_USERFACING` (`fohOutputContract.js:104-105`) — includes `prototype render`, `Future scans will` | `tests/fohContract.darkHorse.test.js` + `tests/fohContract.marketIntel.test.js` |
| No historical claims unless Corey Clone is decision-grade | Jane's `cloneActive` gate caps tradeViability to MARGINAL | `tests/janeEvidenceWeighting.test.js` T3 |
| No execution authority unless Jane gives it | `actionState` derives from `tradeViability`; only `arm` when VALID | T4 + T5 |
| `US Dollar Strength (DXY)` (not bare DXY) | `expandMacroLabels` in `foh/foh-format.js` + `_miExpandMacroLabels` in `coreyMarketIntel.js` | `tests/marketIntelDailyRoadmap.test.js` T4 lines 99-125 |
| `Market Volatility (VIX)` (not bare VIX) | same | T4 |

## Fixture proof artefact

The rendered output from `tests/marketIntelDailyRoadmap.test.js` running against the in-test fixture mirrors what live Discord will see — both paths emit through `buildDailyRoadmapMessages`. A sample is shown in `docs/certificates/PR140_LIVE_FOH_ACCEPTANCE_CERT.md`. The same renderer drives the daily roadmap output for both scheduled ticks and on-demand `/macro` commands.

## Acceptance against the operator brief

- ✅ Required commands enumerated, with fixture-level proof per command
- ✅ Required per-output fields covered by named tests
- ✅ Exact blocker stated (no live Discord access in sandbox)
- ✅ Test fixtures available to validate every required field

## Next-deploy follow-up

Re-issue this cert against live Discord output once Render deploy completes. Test commands listed above + expected fields produce a 1:1 cross-check against the live render.
