# Deploy / Render Proof Certificate

**Date / time (UTC):** 2026-05-18T09:50:00Z  
**Repo SHA:** `6858a90b51de38f0a6633d52d22133d89b0daf90` + Cursor addendum commits  
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery addendum (Deploy / Render proof)

---

## Status

**BLOCKED — Render workspace access is not available in this Cursor Cloud environment.**

This certificate records the exact access checks performed and what remains unproven until a Render workspace/API context is selected.

## Access checks performed

| Check | Result |
|---|---|
| Render MCP server status | `ready` |
| `Render.get_selected_workspace` | blocked: `no workspace set. Prompt the user to select a workspace. Do NOT try to select a workspace for them, as it may be destructive` |
| `Render.list_services` | blocked: `no workspace set` |
| `Render.list_workspaces` | blocked: `unauthorized` |
| Render CLI | unavailable: `render: command not found` |

## Required deploy proof items

| Required item | Status | Reason |
|---|---|---|
| Render deploy ID | BLOCKED | no selected workspace / unauthorized workspace list |
| Boot log proof | BLOCKED | service/log APIs inaccessible without workspace |
| Market Intel scheduler proof | BLOCKED | Render logs inaccessible |
| Dark Horse scheduler proof | BLOCKED | Render logs inaccessible |
| Discord send proof | BLOCKED | Render logs/webhook proof inaccessible; sandbox has no Discord webhook secrets |
| no new 400s | BLOCKED | Render logs inaccessible |
| no image contract regression | FIXTURE-PROVEN / LIVE-DEPLOY BLOCKED | `tests/fohContract.darkHorse.test.js`, `tests/fohLiveDispatchText.test.js`, and DH image-contract cert pass locally; Render log proof pending workspace |
| Jane final-state proof | FIXTURE-PROVEN / LIVE-DEPLOY BLOCKED | `tests/janeEvidenceWeighting.test.js` and macro-search proof logs pass locally; Render log proof pending workspace |

## What is safe to claim now

- The recovery branch has local fixture/test proof for:
  - Spidey candle ingestion adapter wiring.
  - Jane source-authority weighting.
  - Corey Clone cache manifest tooling.
  - Dark Horse image contract scoping.
  - Macro search command rendering against live TradingView calendar data.
  - PR #140 FOH formatter acceptance.
- A Render deploy / live Discord send cannot be certified from this environment.

## Required follow-up

Ask an operator with Render access to select the correct Render workspace in Cursor or run the following in a Render-authenticated environment:

1. Confirm latest deploy ID for the ATLAS Discord bot service.
2. Capture boot logs showing:
   - `[BOOT] ... spidey candle fetcher wired via safeOHLC`
   - Market Intel scheduler registration / tick.
   - Dark Horse scheduler registration / tick.
3. Capture scheduler/send logs showing:
   - Market Intel Discord send success.
   - Dark Horse Discord send success.
   - no HTTP 400s.
   - no `foh_contract_validation_failed` on Dark Horse image path.
4. Capture Jane final-state log lines:
   - `[JANE] final_state=...`
   - `[JANE] TRADE_VALIDITY_GATE=...`

## Acceptance

- ❌ Deploy proof is **not complete**.
- ✅ Exact access blocker is recorded.
- ✅ No fake deploy ID or invented Render log proof is included.
