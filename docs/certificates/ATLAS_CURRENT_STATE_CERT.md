# ATLAS Current State Certificate

## Addendum current-state update (Cursor)

**Date / time (UTC):** 2026-05-18T09:10:00Z  
**Generated for:** Cursor addendum to Foundation Recovery Order  
**Purpose:** prevent addendum work from proceeding on stale assumptions before any implementation edits on this branch.

### Current git / PR state

| Field | Value |
|---|---|
| Current branch | `cursor/foundation-recovery-addendum-c4f5` |
| Branch base | `origin/claude/atlas-implementation-support-RCXhO` (draft PR #141 recovery branch) |
| Current branch HEAD | `6858a90b51de38f0a6633d52d22133d89b0daf90` before this addendum edit |
| Latest `origin/main` SHA | `b285df2c02ced19da8bbf8ec9673eac4345eee13` |
| PR #140 merge status | MERGED at 2026-05-18T07:08:49Z; merge commit `b285df2c02ced19da8bbf8ec9673eac4345eee13`; title: `FOH refinement: MI control surface + Dark Horse CURRENT ADVICE — AT RELEASE` |
| Recovery PR detected | PR #141 open/draft: `Foundation + FOH recovery: Spidey adapter + DH contract scope + 10 certs`; head `claude/atlas-implementation-support-RCXhO`; base `main` |
| Reason for branch selection | The user described this as an addendum to the same large recovery push. Work is therefore based on PR #141 rather than the older Dark Horse-only Cursor branch. |

### Current open PRs reviewed

| PR | Branch | Draft | Title |
|---|---|---:|---|
| #141 | `claude/atlas-implementation-support-RCXhO` | yes | Foundation + FOH recovery: Spidey adapter + DH contract scope + 10 certs |
| #124 | `cursor/wire-corey-clone-fa48` | no | Wire Corey Clone into live macro chain |
| #104 | `cursor/darkhorse-standout-validity-b981` | yes | Add Dark Horse standout validity tracking |
| #100 | `claude/market-intel-foh-v6-visual-shell` | yes | marketIntel(foh-v6): adopt Dark Horse v6 visual shell + MI-specific content |
| #90 | `claude/salvage-dh-first-detection-tracker` | no | darkHorseFirstDetection: salvage in-memory first-detection tracker from #64 (closed) |
| #88 | `cursor/add-agents-md-16ca` | yes | Add AGENTS.md for Cursor Cloud development environment |
| #74 | `claude/dark-horse-foh-restoration-v6-parity` | no | darkhorse(foh-v6): restore canonical v6 prototype parity in live path |
| #49 | `feat/production-presentation-hardening` | no | feat(presentation): production hardening pass — full-name-first labels, silent sanitiser, neutral collapse, market-intel QA |
| #37 | `claude/corey-market-intel-pre-event-rebuild` | no | fix(corey-market-intel): pre-event + released-event ATLAS-grade rebuild |
| #1 | `claude/remove-polling-retry-Bx25M` | no | Remove all polling/retry logic from rendering pipeline |

### Files inspected before addendum edits

- `docs/ATLAS_ACTIVE_WORK_BOARD.md`
- `docs/certificates/ATLAS_CURRENT_STATE_CERT.md`
- `docs/certificates/MACRO_COREY_ROLE_SEPARATION_CERT.md`
- `docs/certificates/MACRO_SEARCH_LIVE_COMMAND_CERT.md`
- `docs/certificates/PR140_LIVE_FOH_ACCEPTANCE_CERT.md`
- `docs/certificates/HYPERLINK_INFRASTRUCTURE_CERT.md`
- GitHub PR metadata for #140 and #141 via read-only `gh pr view`
- GitHub open-PR list via read-only `gh pr list`
- repo-wide JS file inventory for active Spidey / Corey Clone / Jane / FOH paths

### Active Spidey files

| Role | Files |
|---|---|
| Structure entry / contract | `spidey.js` |
| Runtime adapter / candle ingestion | `coreyMarketIntel.js`, `index.js`, `tests/spideyCandleIngestion.test.js` |
| Structure modules | `spidey_structure/index.js`, `swingPivots.js`, `supplyDemand.js`, `bos.js`, `choch.js`, `liquidity.js`, `keyLevels.js`, `displacement.js`, `imbalance.js`, `session.js`, `confidence.js` |
| Macro presentation bridge | `macro/spideyStructure.js` |

### Active Corey Clone files

| Role | Files |
|---|---|
| Clone engine | `corey_clone.js` |
| Historical cache / config | `corey_history_config.js`, `corey_history_reader.js`, `corey_history_harvester.js`, `corey_history_matcher.js`, `corey_history_outcomes.js`, `corey_history_versions.js`, `corey_history_validator.js`, `corey_history_audit.js` |
| Cache tooling | `scripts/cache_coverage_report.js`, `scripts/cache_harvest.js`, `scripts/cache_verify.js`, `scripts/cache_scrub.js` |
| Tests / wiring | `tests/fohCoreyCloneWiring.test.js`, `tests/janeEvidenceWeighting.test.js` |

### Active Jane files

| Role | Files |
|---|---|
| Final synthesis / gate | `jane.js` |
| Decision weighting support | `macro/decisionWeighting.js`, `macro/livePlan.js` |
| Consensus / validation | `engine/validate/checkEngineConsensus.js`, `engine/validate/validateEngineIntelligence.js`, `tests/engineJaneValidation.test.js`, `tests/janeEvidenceWeighting.test.js` |

### Active FOH / renderer files

| Surface | Files |
|---|---|
| FOH contracts / validation | `foh/config/fohOutputContract.js`, `foh/validate/validateFohOutput.js`, `foh/buildMarketIntelPacket.js`, `foh/buildDarkHorsePacket.js` |
| View-model adapters | `foh/adapters/marketIntelViewModel.js`, `foh/adapters/darkHorseViewModel.js` |
| Dispatch | `foh/dispatch/sendMarketIntelFoh.js`, `foh/dispatch/sendDarkHorseFoh.js`, `foh/dispatch/_discordPost.js` |
| Shared FOH display helpers | `foh/headerStrip.js`, `foh/foh-format.js` |
| Market Intel renderer | `renderers/foh/marketIntelV3Shell.js`, `renderers/foh/marketIntelV3Adapter.js`, `renderers/foh/marketIntelCard.js`, `renderers/foh/marketIntelFohPacket.js`, `renderers/foh/marketIntelDepthContent.js` |
| Dark Horse renderer | `darkHorseFoh.js`, `darkHorseFohFormatter.js`, `darkHorseFohSemanticTranslator.js`, `renderers/foh/darkHorseCard.js`, `renderers/foh/darkHorseFohPacket.js`, `renderers/foh/darkHorseV6Shell.js`, `renderers/foh/darkHorseV6Adapter.js` |
| PNG/PDF / shared renderer | `renderers/foh/pngRenderer.js`, `renderers/foh/shared.css`, `scripts/_foh_renderer.js`, `renderer.js` |

### Known live defects reviewed before addendum edits

| Defect / required proof | Current finding before addendum edits |
|---|---|
| Spidey candle ingestion | PR #141 branch includes additive `candleFetcher` wiring and `tests/spideyCandleIngestion.test.js`; live Render proof still pending deploy. |
| Jane evidence weighting | PR #141 branch includes `tests/janeEvidenceWeighting.test.js`; cert proves text volume does not increase authority. |
| Jane-only surface consumption | PR #141 branch includes cert; Dark Horse exception remains documented because DH is a scanner surface, not a Jane trade-decision surface. |
| Corey Clone cache coverage / manifest | PR #141 branch includes `scripts/cache_coverage_report.js` and cert; live Render cache report still pending provider-backed environment. |
| Dark Horse image contract failure | PR #141 branch scopes FOH contract by `packet.meta.module`; DH image render validation no longer uses MI-only required fields. |
| Macro/Corey role separation | Cert exists but addendum requires strengthening with duplicate-evidence / source-weight detail. |
| Macro search live proof | Cert exists; live Discord blocked in sandbox due missing bot/webhook secrets; fixture proof required/available. |
| PR #140 live FOH acceptance | Cert exists; proof is fixture-level because live Discord proof requires deploy/webhook access. |
| Hyperlink infrastructure | Cert currently defers implementation; addendum asks not to chase before foundation and to document follow-up if too large. |
| Deploy / Render proof | Not yet proven from this branch; must be attempted via Render access check or blocker recorded. |

**Addendum gate outcome:** Current state is now documented on the PR #141 recovery base. Implementation/cert updates may proceed after this certificate update.

---

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
