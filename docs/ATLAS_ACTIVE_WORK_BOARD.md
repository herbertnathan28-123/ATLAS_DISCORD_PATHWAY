# ATLAS FX — Active Work Board

Last updated: 18 May 2026 UTC

---

## Status legend

Every required item carries one inline marker:

- `[ ]` — pending
- `[~]` — in-progress
- `[x]` — done (include the PR # / date in the line, e.g. `(PR #126, 17 May)`)
- `[!]` — blocked (include the blocker in one line)

**Update rule** — whoever closes work updates this board *in the same PR* that closes it. The board can't drift from reality if status moves with the code.

---

## Current Production Position

Macro engine production chain is accepted through Cursor PR #126.

Foundation recovery addendum status (Cursor stack PR #142 on top of draft PR #141):

- [x] Current-state certificate updated before addendum edits (`docs/certificates/ATLAS_CURRENT_STATE_CERT.md`, PR #142, 18 May)
- [x] Macro/Corey role separation strengthened with source-weight proof and macro-verbosity test (`MACRO_COREY_ROLE_SEPARATION_CERT.md`, `tests/janeEvidenceWeighting.test.js`, PR #142, 18 May)
- [x] Macro search command proof run against live TradingView calendar data (`node scripts/test_macro_search.js`, 10/10 required commands PASS, PR #142, 18 May)
- [x] PR #140 FOH acceptance re-verified by live-path fixtures (`marketIntelDailyRoadmap`, `darkHorseCurrentAdvice`, `darkHorseHeaderControls`, `fohLiveDispatchText`, PR #142, 18 May)
- [!] Hyperlink infrastructure remains **not complete** — safe fallbacks exist, but central registry/helper and public URL targets are deferred to a focused follow-up (`HYPERLINK_INFRASTRUCTURE_CERT.md`, PR #142, 18 May)
- [!] Render/deploy proof remains **blocked** — Render MCP has no selected workspace, `list_workspaces` is unauthorized, and Render CLI is unavailable (`DEPLOY_RENDER_PROOF_CERT.md`, PR #142, 18 May)

Safe-to-merge scope:

- [x] PR #141/#142 foundation cert/test additions are safe to review/merge as a controlled recovery stack once regression tests pass.

Must **not** be considered complete:

- [!] Live Render deploy proof / live Discord send proof
- [!] Hyperlink registry / Expanded Terminology URL routing / event-link routing
- [!] Provider-backed Corey Clone cache population on Render

Confirmed live chain:

TradingView → Market Intel scheduler → Corey → Corey Clone → Spidey → Jane → FOH → Discord / PNG / PDF

Render live proof confirmed:

- [x] TradingView calendar live
- [x] normalized events received
- [x] macro packet built
- [x] Corey Clone receiving macro packet  (PR #125, 17 May)
- [x] Corey Clone gating with usableForDecision
- [x] Spidey running  (PR #125, 17 May — Phase D activation; LTF candles still pending)
- [x] Jane receiving macro / clone / structure
- [x] FOH rendering  (PR #119/#120/#122)
- [x] Discord / FOH send successful  (PR #123 — expanded Discord text body wired)

Codex production macro lane is closed.
Codex local macro implementation is accepted as local proof only and superseded by Cursor PR #126.

---

## Approved Market Intel Product Direction

Main Discord Market Intel surface is now calendar-first.

The main Discord channel should show:

- event time
- currency / region
- impact rating
- event name
- forecast / previous where available
- affected markets
- basic risk window
- hyperlink to Full Brief

The full Claude / Market Intel deep-dive content sits behind event links.

Main Discord = control surface.
Full Brief links = deep intelligence.

Do not post multi-page Market Intel briefings directly into Discord by default.

---

## User-Facing Terminology Display Doctrine

Apply across:

- Macro output
- Macro search
- Dark Horse
- Market Intel
- Full Brief pages
- Daily Brief
- Weekend Brief
- Dashboard cards
- Discord FOH
- Glossary hyperlinks

Rule:

Do not lead user-facing text with raw market codes such as DXY or VIX.

Use the plain-English name first, with the code in brackets.

Correct:

- US Dollar Strength (DXY)
- Market Volatility (VIX)

Not:

- DXY (US Dollar Strength)
- VIX (Market Volatility)
- DXY
- VIX

Required examples:

Wrong:
DXY is rising.

Correct:
US Dollar Strength (DXY) is rising.

Wrong:
VIX is elevated.

Correct:
Market Volatility (VIX) is elevated.

Wrong:
DXY confirms the EURUSD path.

Correct:
US Dollar Strength (DXY) confirms the EURUSD path.

Wrong:
VIX above 18 increases risk.

Correct:
Market Volatility (VIX) above 18 increases risk.

Reason:

ATLAS output must remain beginner-readable. The trader should understand what the data means before seeing the market shorthand.

Implementation:

Update all FOH terminology maps, glossary labels, dashboard labels, Discord labels, Market Intel labels, Dark Horse references, and macro search responses so the display name is plain-English first and ticker/code is bracketed second.

Acceptance:

A repo-wide search should not show user-facing lines that lead with:

- DXY
- VIX

unless they are inside technical code, internal variable names, source mappings, or glossary aliases.

User-facing wording must display:

- US Dollar Strength (DXY)
- Market Volatility (VIX)

---

## Lane 1 — Cursor: Live Market Intel + Macro Search

Priority: Critical

Cursor owns the live production path.

Required before Sydney open:

- [x] calendar-first Discord Market Intel output  (Cursor PR #126, 17 May)
- [ ] working Full Brief hyperlinks per event
- [x] macro searches operational and accurate  (Cursor PR #132, 17 May — required query set passes live TradingView calendar)
- [x] no stale prototype CPI / ECB content in macro search output  (Cursor PR #132, 17 May)
- [!] no dead links  (depends on Lane 2 glossary readiness)
- [x] Corey / Corey Clone / Spidey / Jane path remains intact  (PR #125, 17 May)
- [ ] Render deploy proof after changes
- [ ] one live Discord test

Acceptance:

- [ ] Market Intel calendar appears in Discord
- [ ] every listed event has a working Full Brief link or clear Brief Pending state
- [x] macro searches return accurate operational results  (Cursor PR #132, 17 May)
- [x] FOH renders validated engine / Jane output only  (PR #122 pre-send validator)

---

## Lane 2 — Codex: Glossary / Index Hyperlinks

Priority: High

Codex should handle this only in the correct glossary / dashboard repo.

Required:

- [ ] A–Z glossary / index usable
- [ ] Market Intel terms link to glossary entries
- [ ] Full Brief terms link to glossary entries
- [ ] glossary reachable from Discord calendar, Full Brief pages, dashboard/report pages
- [ ] no dead glossary hyperlinks
- [ ] missing entries show Glossary Pending or safely omit link

Required glossary terms include:

- ECB Rate Decision
- Interest Rate
- Basis Point
- Hawkish
- Dovish
- In-Line
- Rate Cut
- Rate Hold
- Structure Break
- Candle Close
- Risk State
- No-Trade Window
- Post-Presser
- Displacement
- Confirmation
- US Dollar Strength (DXY)
- Market Volatility (VIX)
- Yield Spread
- EUR OIS
- Bund Yields
- Invalidation
- Liquidity
- Market Pricing
- NFP
- CPI
- GDP
- PMI
- Retail Sales
- Central Bank Minutes

---

## Lane 3 — Claude: Full Brief Content

Priority: Support lane

Claude owns content/design refinement only.

Claude should produce or refine:

- [ ] event explanation
- [ ] Market Impact
- [ ] reaction paths
- [ ] affected markets
- [ ] risk windows
- [ ] terminology explanations
- [ ] capital/risk examples
- [ ] forward planning

Claude does not own live wiring unless explicitly working inside the production repo.

---

## Non-Negotiable Morning Target

Before Sydney open:

- [x] macro search operational  (Cursor PR #132, 17 May)
- [ ] Market Intel calendar operational
- [~] Full Brief hyperlinks working or Brief Pending  (PR #132 macro search shows Brief Pending; Market Intel event routes still pending)
- [ ] glossary/index links usable
- [x] Corey / Corey Clone / Spidey / Jane path intact  (PR #125, 17 May)
- [ ] Render live proof captured
- [ ] Discord output tested live

No further design drift until this is operational.

---

## Deferred / Do Not Reopen Unless Broken

- Do not reopen macro engine chain unless a live runtime failure appears.
- Do not let Codex continue macro production work from the wrong repo.
- Do not post long-form Market Intel briefings directly into Discord by default.
- Do not replace the approved calendar-first design without Nathan's approval.

---

## Recently Completed

Short log of finished work so historical context isn't lost when items move from `[ ]` to `[x]` above. Most recent first.

- **21 May 2026** — Global Universe Registry for Dark Horse (branch `cursor/global-universe-registry-705b`) — central `globalUniverseRegistry.js` added with canonical symbol metadata, provider symbol maps (TwelveData / FMP / EODHD / Yahoo / internal static), market groups, regions, exchanges, scan modes, coverage status, and unsupported-market disclosure. Dark Horse now assembles its default scan universe from registry-supported records plus dynamic mover feeds, while the legacy 37-symbol Annex A core remains exported as static fallback only. New funnel/transparency accounting logs intended/enabled/provider-supported/static/dynamic/failed/unsupported/duplicates, per-market-group coverage, provider provenance, and PARTIAL/DEGRADED/STATIC-FALLBACK coverage state. FOH v1.3 and live FOH v6 surfaces now include scan transparency and avoid "global" banner wording when coverage is partial/degraded.
- **18 May 2026** — ATLAS FX Full Foundation + FOH Recovery (P0/P1/P2) (branch `claude/atlas-implementation-support-RCXhO`) — additive Spidey candle-ingestion fix (`coreyMarketIntel.init({ candleFetcher })` accepts async OHLC fetcher; `_fetchSpidey` now populates HTF 1W/1D/4H/1H + LTF 15M/5M from the live provider chain via `index.js safeOHLC`; cached 1D rows still fill the 1D slot when live fetch fails — no engine semantics changed); Corey Clone cache-coverage reporter (`node scripts/cache_coverage_report.js [--json|--markdown]`) enumerates Annex A 37 priority symbols (FX majors / crosses / metals / indices / equities), reports per-symbol cache path / rows / first+last timestamp / freshness / usable-for-decision / status / action needed; Jane evidence-weighting authority audit + fixture-locked proof (`tests/janeEvidenceWeighting.test.js` 14 PASS — verbose Corey + weak Spidey ≠ VALID; Spidey owns final bias; Clone BLOCKED caps to MARGINAL; Spidey PARTIAL withholds execution authority; conflicting engines degrade; text volume contributes zero weight). 10 certificates added under `docs/certificates/` (ATLAS_CURRENT_STATE / SPIDEY_CANDLE_INGESTION / COREY_CLONE_CACHE_COVERAGE / JANE_EVIDENCE_WEIGHTING / JANE_ONLY_SURFACE_CONSUMPTION / MACRO_COREY_ROLE_SEPARATION / DARK_HORSE_IMAGE_CONTRACT / PR140_LIVE_FOH_ACCEPTANCE / HYPERLINK_INFRASTRUCTURE / MACRO_SEARCH_LIVE_COMMAND). Live Discord proof + hyperlink registry implementation deferred to follow-up PR with exact blockers stated. 22 test suites green.
- **18 May 2026** — Dark Horse FOH image render contract fix (branch `claude/atlas-implementation-support-RCXhO`) — scope the FOH contract by `meta.module` so the Dark Horse packet stops failing `foh_contract_validation_failed` against the Market-Intel-shaped required-field list. New `DARK_HORSE_REQUIRED_PACKET_FIELDS` / `DARK_HORSE_REQUIRED_VIEW_MODEL_ANCHORS` / `DARK_HORSE_REQUIRED_ARRAYS` / `DARK_HORSE_MINIMUM_DEPTH_RULES` cover only the 10 fields buildDarkHorsePacket actually emits + the anchors the MI-shared view-model adapter can fill from those fields. Backward compat preserved (callers without `meta.module` default to MI semantics). DH `whatToDoNow` items now emit the full 7-field shape (step / action / why / ifIgnored / confirmation / actionChangesWhen / dollarConsequence) so action-block validation passes. User-facing leaks scrubbed at the FOH output boundary: `Promotion criteria:` label renamed to `Entry Validation:` (darkHorseRanking.js:1122), HH/HL and LH/LL chart shorthand translated to plain English via the now-exported `_translateChartJargon` helper called from `foh/buildDarkHorsePacket.js`. Banned-terms list now flags `promotion_trigger` + `Promotion criteria:` so future regressions are caught at the contract gate.
- **18 May 2026** — FOH refinement (Market Intel polish + Dark Horse CURRENT ADVICE — AT RELEASE) (branch `claude/atlas-implementation-support-RCXhO`) — Market Intel ranked-calendar row format collapsed from `🟠 11:45 | EUR | HIGH | [Event]` to `🟠 11:45 EUR · [Event]` (drop redundant impact column — glyph carries it); Red/Amber-only default filter, Medium rows fall back in only when no Red/Amber in next 24h; heading rename TODAY'S RANKED EVENT CALENDAR → HIGH-IMPACT CALENDAR EVENTS; importance-based box-header colour doctrine — THE CALL + CALENDAR boxes go red when a Tier-1 row is in scope, amber when HIGH, yellow on a standard day, grey on a quiet one; new shared `foh/foh-format.js` (`expandMacroLabels` + `accountRiskPanel` + dollars-first `formatPriceDistance` with instrument-aware brackets covering FX major / JPY pair / gold / silver / index / equity). Dark Horse now opens every standout card with a 15-field boxed CURRENT ADVICE — AT RELEASE block (Advice State / Direction / Entry Zone / Entry Window / Entry Validation / Stop / Extended Stop / First Target / Risk Cap / Minimum ATLAS Buffer / Technical Distance / Next Review / Do Not Enter If / Visual Example / Instant Advice), pulling Entry Zone and Stop from evidenceAnchors when published and emitting honest `Pending` placeholders otherwise; account-relative risk panel replaces legacy oversized $72,125 figures; INSTANT ADVICE softens BUY/SELL command wording (Conditional / Wait / Observation / Do not enter yet). DH radar QA banned-phrase list trimmed so the approved defensive `Do not enter yet` / `Do Not Enter If:` wording from the operator brief no longer trips the older signal-service guard.
- **18 May 2026** — Market Intel FOH colour + link refinement pass (branch `claude/atlas-implementation-support-RCXhO`) — boxed section headers now wrap in Discord `ansi` code blocks for per-section colour (THE CALL = red, calendar / forward planning = yellow, MARKET INTEL · DAILY ROADMAP / AFFECTED MARKETS / FULL BRIEF = cyan, MARKET IMPACT = blue, CONFIRMATION = green, RISK STATE = red/orange/yellow/grey by label); event names render as bracketed cyan hyperlinks (`[Event Name](brief-url)` when the Full Brief route is real, `[Event Name]` when Brief Pending); control strip refreshed to PNG / PDF / Full Calendar / Terminology / Full Briefs (Full Calendar = Available — TradingView feed is live); narrative-text expander (`_miExpandMacroLabels`) scrubs bare DXY / VIX leaks from upstream packet fields (mechanism / whyThisRating / confirmation / invalidation); box padding switched to NBSP (U+00A0) so the dispatch sanitiser's `[ \t]{2,}` space-collapser doesn't crush the box right edge; ranked rows trimmed to 4 + 4-symbol affected lists + 3 risk windows so stress fixtures stay under the 1900-char Discord safe cap.
- **18 May 2026** — FOH download-control strip at top of Dark Horse + Market Intel (branch `claude/atlas-implementation-support-RCXhO`) — new shared `foh/headerStrip.js` (`boxHeader` + `controlStrip`); Dark Horse Movement Digest now opens with boxed `🐎 ATLAS · DARK HORSE · MOVEMENT DIGEST` heading + `🖼️ Download PNG / 📄 Download PDF / 🔗 Open Dashboard / 📘 Expanded Terminology` strip; Market Intel Daily Roadmap msg 1 opens with boxed `📡 MARKET INTEL · DAILY ROADMAP` heading + same strip (Full Briefs label, PNG/PDF honestly Brief Pending until daily_brief threads imagePayload); legacy `FOH OPERATOR SURFACE` subtitle preserved for chunker/education-QA backward compat.
- **18 May 2026** — Market Intel Daily Roadmap FOH visual upgrade (branch `claude/atlas-implementation-support-RCXhO`) — boxed ATLAS headers (`╔══╗ ║ … ║ ╚══╝`) on THE CALL, TODAY'S RANKED EVENT CALENDAR, RISK STATE, MARKET IMPACT, AFFECTED MARKETS, CONFIRMATION / DEGRADATION, FORWARD PLANNING, FULL BRIEF / BRIEF PENDING; impact-coloured calendar rows (🔴 Tier 1 / 🟠 HIGH / 🟡 MED / ⚪ LOW); five-card MARKET IMPACT layout (🟦 What is happening · 🟨 Why this matters · 🟧 What moves first · 🟩 What confirms it · 🟥 What weakens it); bare DXY/VIX leak guard on the daily roadmap surface. All three Daily Brief messages stay under the 2000-char Discord cap.
- **17 May 2026** — Macro search output tightened for Sydney open blocker (PR #132) — THE CALL leads; MONITORING wording; live event resolver; US Dollar Strength (DXY) / Market Volatility (VIX) user-facing terminology; Brief Pending fallback.
- **17 May 2026** — Dashboard Source Status / Audit reconciled with chart, price, and OHLC data layers (PR #134) — market-data LIVE no longer collapses macro/Jane pending states; Mechanism Chain label replaced with Market Impact.
- **17 May 2026** — Wire AI agents to check Active Work Board at session start (PR #128) — CLAUDE.md + AGENTS.md READ FIRST blocks.
- **17 May 2026** — Add README + ATLAS Active Work Board (PR #127) — work board introduced at repo root.
- **17 May 2026** — Spidey Phase D activation + Corey Clone wired into MI scheduler (PR #125) — structure engine live (HTF daily candles; LTF pending); Jane structureConfidence gate active; Corey Clone runs per MI tick.
- **17 May 2026** — Wire live MI + DH dispatch through fixed-contract FOH pipeline (PR #123) — closed 1714-char thin-wrapper regression; expanded Discord text body live.
- **17 May 2026** — FOH master order: full-day coverage + contract assurance + engine validators (PR #122) — 6 new packet fields, pre-send validator, engine consensus checker.
- **17 May 2026** — FOH operationally-anchored directional doctrine (PR #121) — 6-element instructions across the pipeline.
- **17 May 2026** — FOH fixed-contract pipeline + scrub all Notion URLs (PR #120) — Notion exposure removed user-side; fixed-contract chain landed.
- **16 May 2026** — FOH end-to-end prototype parity Phase 1+2+3 (PR #119) — prototype shell loader + adapters + multi-card split.
- **Macro chain accepted** — Cursor PR #126 (production macro chain end-to-end through Corey / Corey Clone / Spidey / Jane / FOH / Discord).
