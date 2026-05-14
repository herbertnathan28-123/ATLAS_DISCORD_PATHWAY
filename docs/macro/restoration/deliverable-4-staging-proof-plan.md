# Deliverable #4 — Staging Proof / Acceptance Plan (Brief 2)

**Doctrine.** No production deploy until a staging-channel
screenshot review of the new shape exists. Mirrors PR #74 / PR
#73 discipline.

**Inputs.** `deliverable-3-implementation-package.md` lane
sequencing. Each lane below has its own staging-proof block.

**Staging webhook safety.** Reuse the harness pattern from PR #74:
`scripts/staging_dh_foh_v6_post.js` enforces five hard rails
(production env keys must be unset; explicit `--post --confirm-
staging` flags; `ATLAS_STAGING_WEBHOOK` env var validated as
discord.com webhook URL; URL logged only as SHA-256 prefix; engine
oversize guard mirrored). The macro lanes get equivalent harnesses
under `scripts/staging_macro_*.js`.

---

## Common safety checklist (every lane)

Before any `--post` to a staging webhook, the operator confirms:

1. `git rev-parse HEAD` matches the lane's PR head commit SHA.
2. `echo "WEEKLY_DARKHORSES=${WEEKLY_DARKHORSES:-<unset>}"` shows `<unset>`.
3. `echo "DARKHORSE_STOCK=${DARKHORSE_STOCK:-<unset>}"` shows `<unset>`.
4. `ATLAS_STAGING_WEBHOOK` env var points to a private staging channel webhook (`https://discord.com/api/webhooks/<id>/<token>`).
5. The staging channel is a NEW or DEDICATED staging channel — not the production `#weekly_darkhorses` or `#movement-digest` channel.
6. Per-lane staging harness dry-run executes first (`node scripts/staging_macro_*.js`); only after dry-run passes does the operator run `--post --confirm-staging`.
7. Screenshots captured for every message landed; URL hash logged for audit.
8. `unset ATLAS_STAGING_WEBHOOK` after run completes.

---

## Lane M7-critical — `macro/language.js:101-102` flip

**Proof needed.**
* Pre-flip behavioural snapshot — run the macro QA suite, capture the existing surface text of any test fixture that contains `broken support` / `broken resistance`. Confirm the current output emits `BOS confirmation level`.
* Post-flip behavioural snapshot — same fixture, after edit, confirm the output emits `[Structure Break] confirmation level`.
* No banned-wording regression — `scripts/test_macro_qa.js` and `scripts/test_discord_batch_qa.js` pass green.

**Staging deploy.** Not required — this is a translator-rule edit that does not change any user-visible flow other than the targeted phrase. PR diff review + QA pass is the gate.

**Acceptance.** PR review + green CI. Operator confirms via PR comment. Merge to main.

---

## Lane M1 — Sentiment 5-disc migration

**Proof needed.**
* `scripts/staging_macro_event_intel.js --post --confirm-staging` posts the Macro §5 GLOBAL / EVENT INTELLIGENCE block to the staging channel with the new 5-disc traffic-light scale.
* Operator screenshots the staging channel and compares the Sentiment header against the canonical `🟢🟢🟢🟢⚫ 4/5 — RISK-ON` shape from PR #74's `dh-foh-v6.pdf` reference. Glyph colour matches the bias state per `architectural-recommendation.md` §3.
* Same harness exercises Macro §2 Trade Status / Live Plan and verifies the new 1-5 dot scale appears under Read Maturity.

**Acceptance.** Operator visual sign-off. Both surfaces match the locked spec.

---

## Lane M2 — Event Intelligence 8-field break-out

**Proof needed.**
* `scripts/staging_macro_event_intel.js --post --confirm-staging` (extended) posts the full §5 block to the staging channel.
* The 8 CLAUDE.md fields render as broken-out markdown lines (or embed fields if Lane M5-h has shipped):
  * `**Sentiment:** …`
  * `**Headline:** …`
  * `**Timestamp:** …`
  * `**Expanded summary:** …`
  * `**AI commentary:** …`
  * `**Mechanism chain:** …`
  * `**Trader note:** …`
  * `**Affected symbols:** …`
* Operator screenshots and compares against the CLAUDE.md §3 spec.

**Acceptance.** Operator visual sign-off on the 8 fields appearing as labelled lines. Pipeline C structural object exposes the 8 fields. Pipeline A and Pipeline B alerts unchanged (regression check via separate staging post for the scheduler-driven A / B paths).

---

## Lane M3 — Pipeline consolidation

**Proof needed.**
* Three staging posts in sequence — Pipeline A pre-event alert, Pipeline B released-event alert, Pipeline C analyse-time intel. All three share the same 8-field shape (Pipeline A / B may carry a subset relevant to their lead-time window, but the 8 fields are sourced from the same underlying composer).
* Per-field text-diff comparing the 8 fields across A vs C and B vs C; the named fields must be identical (sentiment / headline / mechanism chain) where the underlying event is the same.
* 24h staging cooldown — after the initial post, the operator waits for the natural scheduler-driven A and B alerts to fire on the staging webhook. Compare them against the manually-posted versions.

**Acceptance.** Operator visual sign-off across all three pipelines. No drift between A / B / C content for the same underlying event.

---

## Lane M4 — Roadmap weekday depth

**Proof needed.**
* `node scripts/staging_macro_roadmap.js --post --confirm-staging --weekday=Mon` / `--weekday=Wed` / `--weekday=Fri` posts the Macro §4 Roadmap Link section once per weekday variant to the staging channel.
* Operator screenshots all three and confirms the depth differentiation matches CLAUDE.md §3 spec (full depth Monday, trimmed midweek, execution-focused Friday).

**Acceptance.** Operator visual sign-off.

---

## Lane M5-h — Hybrid embed migration

**Proof needed.**
* `scripts/staging_macro_full.js --post --confirm-staging` posts the full Macro briefing (all 9 LOCKED_ORDER sections + advisory header) to the staging channel.
* Macro §5 Sentiment header renders as a Discord embed with:
  * Coloured left stripe matching the bias direction.
  * Embed title carrying the sentiment label.
  * Embed fields carrying the 8 broken-out CLAUDE.md fields.
* All other macro sections render as markdown (unchanged from current).
* Operator screenshots the full briefing.

**Acceptance.** Operator visual sign-off on the hybrid surface. No banned-wording leaks (full QA + macro scrub passes).

---

## Lane M6 — Pack-4 hyperlinks

**Proof needed.**
* Full Macro briefing staging post (re-use the M5-h harness).
* Every `[[Label]](url)` site listed in `combined-mi-macro-parity-matrix.md` §E renders as a clickable cyan-bracket hyperlink in Discord.
* Click each hyperlink — destination URL matches the slug in `macro/glossary.js::TERMS` (per the operator-confirmed `terminologyUrls` map).
* No `\[Label\]` backslash-escaped form anywhere.

**Acceptance.** Operator visual sign-off on hyperlink rendering + clickability.

---

## Lane M7 — Full BOS / CHoCH surface translation

**Proof needed.**
* `scripts/staging_macro_full.js --post --confirm-staging` posts the full Macro briefing to the staging channel.
* Operator visually inspects every user-facing emit and confirms no `BOS` / `CHoCH` / `Break of Structure` / `Change of Character` string is visible in any of the 9 LOCKED_ORDER sections + advisory header + visual pattern library entries.
* Repo-wide grep `grep -rnE '\bBOS\b|\bCHoCH\b' --include="*.js" --exclude-dir=node_modules` returns hits only from the internal-only sites listed in `surface-bos-audit.md` §E.
* QA realignment commits land in lockstep — `scripts/test_visual_pattern_library_qa.js`, `scripts/test_recovery.js`, `scripts/test_discord_batch_qa.js` pass green.

**Acceptance.** Operator visual sign-off + full QA suite green + grep proof.

---

## Combined go-live gate

Before any lane's PR merges into `main`:

* CI must be green (every QA harness pass).
* Staging Discord screenshots captured.
* Operator visual sign-off recorded in the PR review.
* Banned-wording sweep returns zero hits across the staging output.
* Discord message-size guards hold (every message ≤ 2000 content chars, every embed ≤ 6000 chars).
* No production env key was touched during staging.

After merge into `main`:

* Render deploys automatically per the existing CI pipeline.
* Operator monitors the first production scheduler-driven cycle (15-minute cadence for Dark Horse path; per-symbol for Macro path).
* If any regression is observed, `ATLAS_DH_FOH_LEGACY=1` env-gate at the engine call site (`darkHorseEngine.js:1359`) is the rollback lever for the Dark Horse FOH path. For the Macro path, the rollback lever is a `git revert` on the affected lane's merge commit.

---

## Hard rule honoured

No production deploy without staging proof per lane. No silent
substitution — every PR reviews against the screenshots taken
during the staging post. Operator's go / no-go on each lane stays
the gate. No lane sequence may skip the staging post.
