# ATLAS LIVE OUTPUT PATH LOCKDOWN CERT

Issue: GitHub #144 - P0 Live Output Lockdown - FOH Renderer + Macro Command Recovery

Owner: Cursor

Scope: Market Intel scheduled output, macro command output, and Dark Horse digest output only. Corey, Spidey, Jane scoring, Corey Clone, scheduler cadence, data providers, and symbol mapping were not rewritten.

## A. Market Intel scheduled Discord post

- Scheduler entry: `coreyMarketIntel.js` -> `start()` arms the timer, `tick(NOW)` performs the scheduled work.
- Daily bulletin builder: `coreyMarketIntel.js` -> `buildDailyBulletinPayload(...)`.
- Control-surface formatter: `coreyMarketIntel.js` -> `buildDailyRoadmapMessages(...)`.
- Renderer dispatch entry: `coreyMarketIntel.js` -> `dispatch(messageType, payloadObj, extra)`.
- FOH renderer controller: `foh/dispatch/sendMarketIntelFoh.js` -> `sendMarketIntelFoh(...)`.
- FOH packet builder: `foh/buildMarketIntelPacket.js` -> `buildMarketIntelPacket(...)`.
- FOH view model: `foh/adapters/marketIntelViewModel.js` -> `toViewModel(...)`.
- Discord text / PNG / PDF shell: `renderers/foh/marketIntelV3Shell.js` -> `buildDiscordTextSummary(...)`, `render(...)`.
- PNG/PDF generator: `renderers/foh/pngRenderer.js` -> `renderHtmlsToPngs(...)`, `renderHtmlToPdf(...)`.
- Discord send: `foh/dispatch/_discordPost.js` -> `postFohDeliverable(...)` for multipart FOH; `coreyMarketIntel.js` -> `sendWebhook(...)` for controlled degraded fallback.
- Old fallback condition: daily scheduled output built `imagePayload` / `fohPacket` but sent only `content` for each `dailyRoadmapMessages` item, so FOH was optional and PNG/PDF controls were forced to `Brief Pending`.
- New condition: daily scheduled output passes `bulletin.imagePayload` and `bulletin.fohPacket` into `dispatch('daily_brief', ...)`, making the FOH renderer the primary path when `FOH_IMAGE_RENDER_ENABLED=true`.
- Controlled degraded condition: renderer disabled, missing render payload, renderer exception, validator failure, or multipart failure produces a short `MARKET INTEL RENDER DEGRADED` notice plus compact summary. The old long report is not silently posted after renderer failure.

## B. Macro command Discord response

- Command entry: `index.js` -> `client.on('messageCreate', ...)`.
- Macro command route: `index.js` -> `macroSearch.isMacroSearchQuery(userInput)` then `macroSearch.runMacroSearch(userInput)`.
- Macro packet builder: `macro/searchMacro.js` -> `runMacroSearch(...)` calls `interpretCalendarEvents(...)`.
- Jane gate / decision packet: `macro/searchMacro.js` -> `runJane(...)` from `jane.js`.
- Corey / Corey Clone / Spidey inputs: `macro/searchMacro.js` -> `coreyRun(...)`, `coreyCloneRun(...)`, `spideyRun(...)`.
- Formatter: `macro/searchMacro.js` -> `formatSearchResponse(ctx)`.
- Discord send: `index.js` -> `chunkMessage(searchResult.content, DISCORD_MAX)` then `msg.channel.send(...)`.
- Old fallback condition: macro search returned a long text body and the command handler sent a separate "Running macro search" message before the real output.
- New condition: the first user-visible macro command content starts with the hard macro boundary and includes report ID, query, generated timestamp, Jane state, market context, structure status, Corey Clone status, affected markets, current advice, source/degradation note, and hard end boundary.
- Historical analogue control: when Corey Clone is not `usableForDecision=true`, the output states historical comparison is unavailable and does not claim analogue confidence.

## C. Dark Horse digest Discord post

- Scan/ranking entry: `darkHorseEngine.js` -> `runDarkHorseScan(...)`; ranking via `darkHorseRanking.js` -> `buildRanking(...)`.
- Image path entry: `darkHorseEngine.js` -> `darkHorseImageDispatch.tryPostDarkHorseAsImage(...)`.
- FOH packet builder: `foh/buildDarkHorsePacket.js` -> `buildDarkHorsePacket(...)`.
- FOH view model: `foh/adapters/darkHorseViewModel.js` -> `toViewModel(...)`.
- Renderer: `foh/dispatch/sendDarkHorseFoh.js` -> `sendDarkHorseFoh(...)`; `renderers/foh/darkHorseV6Shell.js` -> `render(...)`.
- Image contract validator: `foh/validate/validateFohOutput.js` -> `validateFohOutput(...)`, scoped by `packet.meta.module === 'dark_horse'`.
- Discord send: `foh/dispatch/_discordPost.js` -> `postFohDeliverable(...)` for multipart FOH; `darkHorseEngine.js` -> `dhSendWebhook(...)` for controlled degraded fallback.
- Text digest path: `darkHorseFoh.js` -> `buildDarkHorseFohPayload(...)` remains the non-image FOH path, but after an attempted image render failure the engine now posts a degraded marker instead of silently falling through.
- `foh_contract_validation_failed` can still occur only for real Dark Horse contract failures: missing fixed-contract fields, missing/too-thin view-model anchors, invalid `whatToDoNow` item shape, banned user-facing terms, or action block shape failures.
- New condition: any image-path not-ok/exception posts `DARK HORSE RENDER DEGRADED` with exact reason and compact current-advice summary, then returns from the movement digest branch.

## Required runtime logs

The implementation emits Issue #144 status logs in this shape:

```text
renderer_attempted=true|false
renderer_result=ok|failed
fallback_used=true|false
fallback_reason=<exact reason or none>
surface=market_intel|macro_command|dark_horse
report_id=<id>
part=1/1
```

Market Intel logs from `coreyMarketIntel.js` use `[LIVE-OUTPUT] ... surface=market_intel`.

Macro command logs from `macro/searchMacro.js` use `[LIVE-OUTPUT] ... surface=macro_command`.

Dark Horse logs from `darkHorseEngine.js` use `[LIVE-OUTPUT] ... surface=dark_horse`.

## Proof commands

Targeted tests/proof:

```text
node tests/marketIntelDailyRoadmap.test.js — PASS
node tests/issue144LiveOutputLockdown.test.js — PASS
node tests/fohLiveDispatchText.test.js — PASS
node scripts/test_macro_search.js — PASS (10/10 required Issue #144 commands)
node scripts/issue144_production_route_proof.js — PASS
```

`scripts/issue144_production_route_proof.js` monkeypatches `https.request` and uses the production send helpers to capture Discord-bound payloads without requiring live webhook credentials. This is the fixture-equivalent proof path when live Discord access is blocked in the agent environment.

Proof run: 2026-05-18 11:28 UTC.

Production-route fixture output:

```text
Market Intel proof: sent=true marker=MARKET_INTEL_RENDER_DEGRADED report_id=MI-proof hard_start=true hard_end=true
Macro command proof: query="EURUSD macro" jane_state=stand_down hard_start=true hard_end=true dxy_label=true
Dark Horse proof: sent=true marker=DARK_HORSE_RENDER_DEGRADED report_id=DH-proof hard_start=true hard_end=true
Renderer status:
market_intel renderer_attempted=false renderer_result=failed fallback_used=true fallback_reason=env_flag_disabled
macro_command renderer_attempted=true renderer_result=ok fallback_used=false
dark_horse renderer_attempted=true renderer_result=failed fallback_used=true fallback_reason=foh_contract_validation_failed:WHAT_TO_DO_NOW
```

## Live-output gate status

- Market Intel scheduled output: primary FOH payload is now wired; controlled degraded fallback proven by production-route fixture.
- Macro command output: Jane-gated control-surface output proven by required query set / fixture route.
- Dark Horse output: image failure no longer silently falls through; controlled degraded fallback proven by production webhook helper fixture.
- Live Discord webhook proof: pending unless the agent environment exposes valid Discord webhook credentials; fixture-equivalent proof uses the same production send functions and records the payload that would reach Discord.
