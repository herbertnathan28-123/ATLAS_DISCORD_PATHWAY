# ATLAS FX — Active Work Board

Last updated: 17 May 2026 AWST

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

- **17 May 2026** — Macro search output tightened for Sydney open blocker (PR #132) — THE CALL leads; MONITORING wording; live event resolver; US Dollar Strength (DXY) / Market Volatility (VIX) user-facing terminology; Brief Pending fallback.
- **17 May 2026** — Wire AI agents to check Active Work Board at session start (PR #128) — CLAUDE.md + AGENTS.md READ FIRST blocks.
- **17 May 2026** — Add README + ATLAS Active Work Board (PR #127) — work board introduced at repo root.
- **17 May 2026** — Spidey Phase D activation + Corey Clone wired into MI scheduler (PR #125) — structure engine live (HTF daily candles; LTF pending); Jane structureConfidence gate active; Corey Clone runs per MI tick.
- **17 May 2026** — Wire live MI + DH dispatch through fixed-contract FOH pipeline (PR #123) — closed 1714-char thin-wrapper regression; expanded Discord text body live.
- **17 May 2026** — FOH master order: full-day coverage + contract assurance + engine validators (PR #122) — 6 new packet fields, pre-send validator, engine consensus checker.
- **17 May 2026** — FOH operationally-anchored directional doctrine (PR #121) — 6-element instructions across the pipeline.
- **17 May 2026** — FOH fixed-contract pipeline + scrub all Notion URLs (PR #120) — Notion exposure removed user-side; fixed-contract chain landed.
- **16 May 2026** — FOH end-to-end prototype parity Phase 1+2+3 (PR #119) — prototype shell loader + adapters + multi-card split.
- **Macro chain accepted** — Cursor PR #126 (production macro chain end-to-end through Corey / Corey Clone / Spidey / Jane / FOH / Discord).
