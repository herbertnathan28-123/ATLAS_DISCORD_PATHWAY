# Dark Horse FOH Image Contract Certificate

**Date / time (UTC):** 2026-05-18T08:10:00Z
**Repo SHA (this branch):** `4ae3739c2a16ec69ca60a2d61a4fe6cea8ddaab9` (HEAD of PR #141)
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery (P1 — Dark Horse FOH image contract failure)
**Tests:** `tests/fohContract.darkHorse.test.js` — 25 PASS
**Companion:** see PR #141 description for the full diff.

---

## Live evidence

```
[DH-WARN] [DH-FOH-IMAGE] image render path returned not-ok
 reason=foh_contract_validation_failed, falling through to text
…
send_result=ok mode=text_only
```

## Root cause

`foh/validate/validateFohOutput.js` ran a single Market-Intel-shaped `REQUIRED_PACKET_FIELDS` list against every packet — including the Dark Horse packet, which legitimately doesn't carry MI domain fields. Every DH cycle surfaced 11+ false `packet_missing_field:` failures:

| Field flagged on DH packet (every cycle) | Owner domain |
|---|---|
| `packet_missing_field:theCall` | MI primary call narrative |
| `packet_missing_field:rankedEventCalendar` | MI event calendar |
| `packet_missing_field:todaysAnnouncements` | MI event calendar |
| `packet_missing_field:primaryEventFocus` | MI primary catalyst |
| `packet_missing_field:next24To72Hours` | MI event horizon |
| `packet_missing_field:affectedMarketsExpanded` | MI per-event impact |
| `packet_missing_field:priceMap` | MI per-event price levels |
| `packet_missing_field:operationalNarrative` | MI event-day storytelling |
| `packet_missing_field:historicalReaction` | MI Corey Clone analogue |
| `packet_missing_field:cloneStatus` | MI Corey Clone status |
| `packet_missing_field:structureSnapshot` | MI Spidey structure |

`sendDarkHorseFoh.js` caught `ok: false` and fell through to text. Text fallback worked correctly — that's why nothing user-facing broke, but image render hasn't fired in production for some time.

## Fix shipped on this branch (PR #141, commit `4ae3739`)

- **`foh/config/fohOutputContract.js`** — split the global `REQUIRED_*` tables into MI-scoped and DH-scoped twins. DH list contains only the 10 fields `buildDarkHorsePacket` actually emits + the view-model anchors the MI-shared adapter can fill. Backward-compat aliases preserved (`REQUIRED_PACKET_FIELDS` still resolves to MI for callers that import by the legacy name).

- **`foh/validate/validateFohOutput.js`** — reads `packet.meta.module` (default `market_intel`) and selects the right contract set. Reports the active `moduleId` on the result envelope so the next deploy's `[DH-FOH-IMAGE]` log line surfaces which contract path ran.

- **`foh/buildDarkHorsePacket.js`** — DH `whatToDoNow` items now emit the full 7-field shape (`step` / `action` / `why` / `ifIgnored` / `confirmation` / `actionChangesWhen` / `dollarConsequence`) so the action-block validation passes. Honest "pending" content surfaces where price-point planning has not emitted the anchored level; no field is omitted silently.

- **`darkHorseRanking.js`** — user-facing `"Promotion criteria:"` label renamed to `"Entry Validation:"` per operator brief 2026-05-18; `_translateChartJargon` exported so the FOH packet builder can scrub `HH/HL` / `LH/LL` chart shorthand out of user-facing copy at the boundary.

- **`foh/buildDarkHorsePacket.js`** — three boundary sites that embedded `s.reason` / `c.reasons.join(' · ')` now route through `_scrubJargon` → `_translateChartJargon` before reaching the user surface. Engine scoring code untouched — logs keep the raw labels.

- **`foh/config/fohOutputContract.js BANNED_TERMS_USERFACING`** — `promotion_trigger` + `Promotion criteria:` added so the validator catches any future regression at the contract gate.

- **Text fallback preserved** — dispatcher's fall-through branch is unchanged.

## Test surface

`tests/fohContract.darkHorse.test.js` — 25 PASS — locks:

- DH packet passes `validateFohOutput` end-to-end (T1)
- 11 stale `packet_missing_field:` failures gone (T2)
- MI contract still enforced when `meta.module=market_intel` (T3)
- Packet without `meta.module` defaults to MI (backward compat, T4)
- Empty DH packet still rejected (contract scoped, not disabled, T5)
- HH/HL / LH/LL scrubbed from `fourWayOutcomes.behaviour`; plain-English translation present (T6)

## Acceptance against the operator brief

- ✅ Image renderer no longer fails with `foh_contract_validation_failed` on the Dark Horse path
- ✅ If image render fails for another reason, the validator result envelope reports `failures: [...]` + `moduleId` so the log identifies the exact contract path that ran
- ✅ Fallback still posts — `sendDarkHorseFoh.js` fall-through branch is preserved
- ✅ No Discord 400 regression (text-only path uses the same `postFohDeliverable`)
- ✅ No scoring / scheduler / cooldown changes
- ✅ No raw `HH/HL` / `LH/LL` / `promotion_trigger` / truncated validation wording reaches user-facing output (banned-terms + test-guarded)

## Cannot do without (out of scope here)

- **Live deploy proof** — sandbox cannot drive a live Dark Horse cycle. Next Render deploy will surface `[DH-FOH-IMAGE] image render path completed` (success) + `kind=movement_digest_foh_v1_X fileCount=N/N across parts` (file attachments present), confirming the contract gate no longer rejects.
