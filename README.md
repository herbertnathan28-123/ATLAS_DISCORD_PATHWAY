# ATLAS FX — Discord Pathway

ATLAS FX rendering + delivery layer for Market Intel, Dark Horse, and Macro
outputs into Discord. Production runtime on Render (Singapore), bot identity
`FX Bot#3867`.

## Current Active Work

The live ATLAS FX work board is maintained here:

[ATLAS Active Work Board](docs/ATLAS_ACTIVE_WORK_BOARD.md)

All AI agents should check this file before starting ATLAS FX work.

---

## Repo Identity

- Repo: `herbertnathan28-123/ATLAS_DISCORD_PATHWAY`
- Default branch: `main`
- Runtime: Node.js, Render Standard plan, Singapore region
- Sister repo (do not touch): `herbertnathan28-123/ATLAS_ASTRA_RELAY` —
  Astra AI bot.

Repo-wide ground rules live in [`CLAUDE.md`](CLAUDE.md). Read it before
any code change.

## Production Chain

```
TradingView
  → Market Intel scheduler (coreyMarketIntel.js)
    → Corey (macro / regime / event authority)
    → Corey Clone (historical analogue authority)
    → Spidey (Phase D structure authority)
    → Jane (decision / synthesis)
  → FOH packet + view model + prototype shell
  → Discord (PNG cards + PDF + expanded text body)
```
