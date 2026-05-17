# ATLAS FX — Active Work Board

Last updated: 17 May 2026 AWST

## Current Production Position

Macro engine production chain is accepted through Cursor PR #126.

Confirmed live chain:

TradingView → Market Intel scheduler → Corey → Corey Clone → Spidey → Jane → FOH → Discord / PNG / PDF

Render live proof confirmed:

- TradingView calendar live
- normalized events received
- macro packet built
- Corey Clone receiving macro packet
- Corey Clone gating with usableForDecision
- Spidey running
- Jane receiving macro / clone / structure
- FOH rendering
- Discord / FOH send successful

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

## Lane 1 — Cursor: Live Market Intel + Macro Search

Priority: Critical

Cursor owns the live production path.

Required before Sydney open:

- calendar-first Discord Market Intel output
- working Full Brief hyperlinks per event
- macro searches operational and accurate
- no stale prototype CPI / ECB content
- no dead links
- Corey / Corey Clone / Spidey / Jane path remains intact
- Render deploy proof after changes
- one live Discord test

Acceptance:

- Market Intel calendar appears in Discord
- every listed event has a working Full Brief link or clear Brief Pending state
- macro searches return accurate operational results
- FOH renders validated engine / Jane output only

---

## Lane 2 — Codex: Glossary / Index Hyperlinks

Priority: High

Codex should handle this only in the correct glossary / dashboard repo.

Required:

- A–Z glossary / index usable
- Market Intel terms link to glossary entries
- Full Brief terms link to glossary entries
- glossary reachable from Discord calendar, Full Brief pages, dashboard/report pages
- no dead glossary hyperlinks
- missing entries show Glossary Pending or safely omit link

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
- DXY
- VIX
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

- event explanation
- Market Impact
- reaction paths
- affected markets
- risk windows
- terminology explanations
- capital/risk examples
- forward planning

Claude does not own live wiring unless explicitly working inside the production repo.

---

## Non-Negotiable Morning Target

Before Sydney open:

- macro search operational
- Market Intel calendar operational
- Full Brief hyperlinks working or Brief Pending
- glossary/index links usable
- Corey / Corey Clone / Spidey / Jane path intact
- Render live proof captured
- Discord output tested live

No further design drift until this is operational.

---

## Deferred / Do Not Reopen Unless Broken

- Do not reopen macro engine chain unless a live runtime failure appears.
- Do not let Codex continue macro production work from the wrong repo.
- Do not post long-form Market Intel briefings directly into Discord by default.
- Do not replace the approved calendar-first design without Nathan's approval.
