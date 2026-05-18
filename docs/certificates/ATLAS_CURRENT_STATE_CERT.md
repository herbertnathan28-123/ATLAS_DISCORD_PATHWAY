# ATLAS Current State Certificate

**Date / time (UTC):** 2026-05-18T07:43:00Z
**Generated for:** ATLAS FX Full Foundation + FOH Recovery Brief
**Audience:** Pre-edit audit — proves the repo state was checked before any code changed.

---

## Repository identity

| Field | Value |
|---|---|
| Repo | `herbertnathan28-123/ATLAS_DISCORD_PATHWAY` |
| Branch under work | `claude/atlas-implementation-support-RCXhO` |
| HEAD SHA (this branch) | `4ae3739c2a16ec69ca60a2d61a4fe6cea8ddaab9` |
| Latest main SHA | `b285df2c02ced19da8bbf8ec9673eac4345eee13` (PR #140 merge) |
| Divergence | 1 commit ahead of main (`4ae3739` = PR #141 contract scope fix, open as draft) |

## Recent merged PRs (FOH lineage)

| PR | SHA | Title | Status |
|---|---|---|---|
| #136 | `3a81158` | Wire daily roadmap into market intel bulletin | merged |
| #137 | `08f2176` | Dark Horse visual-buffer / preview alignment (Cursor) | merged |
| #138 | `46c6bea` | MI box headers / impact colours / 5-card MARKET IMPACT | merged |
| #139 | `4fa91b7` | FOH download-control strip + MI colour-link refinement | merged |
| #140 | `b285df2` | MI control surface + Dark Horse CURRENT ADVICE — AT RELEASE | merged |
| #141 | `4ae3739` | FOH contract scope by `meta.module` (DH image-render fix) | **open, draft** |

PR #141 is the head commit of this branch. The current PR is being extended with this foundation audit + the certs below.

## Engine files located

| Role | File | Notes |
|---|---|---|
| Spidey (structure authority) | `spidey.js` | accepts `{ candles: { htf, ltf } }` |
| Spidey runtime entry | `spidey_structure/` directory | analysis engine |
| Corey (current event / regime) | `corey.js`, `corey_live_data.js` | live macro state |
| Corey Clone (historical authority) | `corey_clone.js`, `corey_history_*.js` | cache-backed analogues |
| Macro engine (normalised macro) | `macro.js`, `macro/` directory | calendar + indices |
| Jane (decision + compression) | `jane.js` | sole final-state authority |
| Orchestrator | `orchestrator.js` | engine fan-out |

## FOH files located

| Role | File |
|---|---|
| Market Intel packet builder | `foh/buildMarketIntelPacket.js` |
| Dark Horse packet builder | `foh/buildDarkHorsePacket.js` |
| MI view-model adapter | `foh/adapters/marketIntelViewModel.js` |
| DH view-model adapter | `foh/adapters/darkHorseViewModel.js` (delegates to MI) |
| MI dispatcher | `foh/dispatch/sendMarketIntelFoh.js` |
| DH dispatcher | `foh/dispatch/sendDarkHorseFoh.js` |
| Discord webhook post | `foh/dispatch/_discordPost.js` |
| FOH contract | `foh/config/fohOutputContract.js` (per-module scoped — PR #141) |
| FOH validator | `foh/validate/validateFohOutput.js` |
| Shared FOH helpers | `foh/headerStrip.js`, `foh/foh-format.js` |
| MI roadmap text body | `coreyMarketIntel.js` `buildDailyRoadmapMessages` |
| DH movement-digest body | `darkHorseFohFormatter.js` |

## Active packet contracts

| Contract | Location | Per-module scope |
|---|---|---|
| `REQUIRED_PACKET_FIELDS` (legacy alias → MI) | `foh/config/fohOutputContract.js:104` | yes (PR #141) |
| `MARKET_INTEL_REQUIRED_PACKET_FIELDS` | same file | yes |
| `DARK_HORSE_REQUIRED_PACKET_FIELDS` | same file | yes |
| `REQUIRED_VIEW_MODEL_ANCHORS` | same file | yes |
| `REQUIRED_ARRAYS` | same file | yes |
| `MINIMUM_DEPTH_RULES` | same file | yes |
| `BANNED_TERMS_USERFACING` | same file | shared |
| `JaneDecisionPacket` | `jane.js:156–195` (synthesis shape) | n/a |
| `MacroIntelligencePacket` | `macro/interpretCalendarEvents.js` | n/a |
| Spidey output packet | `spidey.js:28–96` | n/a |

## Known failing live logs (per the operator brief)

| Issue | Log snippet | Root-cause finding (this audit) |
|---|---|---|
| **Spidey no_candles_supplied** | `[SPIDEY] STRUCTURE_PARTIAL symbol=USDCHF reason=no_candles_supplied` | `_fetchSpidey` (coreyMarketIntel.js:2885) calls `corey_history_reader.readCandles(leadSymbol)` which reads cached 1D rows only. For symbols without a 1D cache file (USDCHF, AUDJPY, …) `candles` stays null and Spidey honestly degrades. Patched in this PR via an injectable candle-fetcher hook. |
| **Corey Clone missing cache outside EURUSD** | `cache file missing: USDCHF/1D.jsonl` | Cache directory is `data/historical/` (corey_history_config.js:18). 37 priority symbols listed in Annex A; live `/data/historical/` on Render is sparsely populated. Patched via cache-coverage reporter script + honest manifest cert. |
| **Dark Horse foh_contract_validation_failed** | `[DH-FOH-IMAGE] image render path returned not-ok reason=foh_contract_validation_failed, falling through to text` | Pre-existing architectural mismatch — single MI-shaped required-field list ran against every packet. **Fixed in PR #141** on this branch (`4ae3739`). Per-module scope splits MI/DH contracts. |
| **Market Intel DXY/VIX raw wording risk** | n/a (presentation risk) | `_miExpandMacroLabels` (coreyMarketIntel.js:282) + new `foh/foh-format.js expandMacroLabels` scrub bare DXY/VIX/US10Y/US2Y from narrative. Test-guarded in `tests/marketIntelDailyRoadmap.test.js` T4. |
| **Hyperlink lane blocked in wrong checkout** | Codex wrote to `/workspace/discord-relay` (wrong repo) | Documented in `HYPERLINK_INFRASTRUCTURE_CERT.md` — production target is `ATLAS_DISCORD_PATHWAY` (this repo). Wrong-repo work is NOT copied. Production hyperlink infrastructure deferred to follow-up PR (scope too large for this PR). |

## Tests catalogued (`tests/` + `scripts/`)

Active suites passing on `4ae3739` (sweep run before this audit):

- tests/fohContract.marketIntel.test.js — 8 PASS
- tests/fohContract.darkHorse.test.js — 25 PASS (new in PR #141)
- tests/fohCoreyCloneWiring.test.js — 22 PASS
- tests/fohRequiredFields.test.js — 94 PASS
- tests/fohOperationalAnchors.test.js — 34 PASS
- tests/fohLiveDispatchText.test.js — 31 PASS
- tests/fohNoPrivateLinks.test.js — 34 PASS
- tests/fohPrototypeAnchors.test.js — 9 PASS
- tests/fohTerminology.test.js — 11 PASS
- tests/fohFormat.test.js — 19 PASS
- tests/marketIntelDailyRoadmap.test.js — 36 PASS
- tests/darkHorseHeaderControls.test.js — 11 PASS
- tests/darkHorseCurrentAdvice.test.js — 30 PASS
- tests/dashboardSourceAudit.test.js — 17 PASS
- scripts/test_dh_education_qa.js — 368 PASS
- scripts/test_dh_chunking_qa.js — 45 PASS
- npm run qa:dh-radar — 172 PASS
- npm run qa:dh-delivery — 36 PASS
- npm run qa:dh-cooldown — 31 PASS
- npm run qa:dh-polish-mi-validator — 38 PASS
- npm run qa:market-intel — 12 fixtures clean
- npm run qa:wording-directives — 36 PASS

## Edit-blockers checked off

- Repo access ✓ (push + PR open confirmed via PR #141)
- No merge conflict against `origin/main` (fast-forward path)
- No production-breaking risk identified before edits started
- Branch ownership clear: `claude/atlas-implementation-support-RCXhO` is the designated branch
- Engine-touch flag set on: Spidey candle adapter (additive injectable hook only; no engine semantics changed)
- Engine-touch flag set on: Jane weighting (documentation + fixture tests; no weight changes in this PR)

## Outcome

✅ Audit complete. Edits may proceed. Each subsequent cert in `docs/certificates/` records the specific change.
