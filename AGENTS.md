# AGENTS.md — ATLAS FX Repo Agent Brief

This file is read by Codex-style coding agents (and most repo-aware AI
agents) at session start. It pairs with [`CLAUDE.md`](CLAUDE.md), which
Claude Code reads.

---

## ⚠️ READ FIRST — Active Work Board

Before doing any ATLAS FX work, read:

[`docs/ATLAS_ACTIVE_WORK_BOARD.md`](docs/ATLAS_ACTIVE_WORK_BOARD.md)

This file is the current operational source of truth for:
- active lanes
- agent ownership
- production status
- non-negotiable targets
- acceptance criteria
- deferred / do-not-touch areas

Do not start new ATLAS FX work from memory or chat history alone. Check the work board first.

---

## Repo Identity

- Repo: `herbertnathan28-123/ATLAS_DISCORD_PATHWAY`
- Default branch: `main`
- Runtime: Node.js, Render Standard plan, Singapore region

## Where to look next

- [`CLAUDE.md`](CLAUDE.md) — full repo-wide ground rules, locked colour
  codes, do-not-touch list, macro-spec doctrine.
- [`README.md`](README.md) — repo overview + production-chain diagram.
- [`docs/ATLAS_ACTIVE_WORK_BOARD.md`](docs/ATLAS_ACTIVE_WORK_BOARD.md) —
  current work assignments and acceptance criteria (see READ FIRST above).

---

## Cursor Cloud specific instructions

### Node.js version

The project requires Node.js 20.x (`engines` field in `package.json`). The
Cloud VM ships with Node 22 by default; the update script installs and
activates Node 20 via nvm before running `npm install`.

### Package manager

npm (lockfile: `package-lock.json`). No other package manager is used.

### Build command

After `npm install`, Puppeteer's Chrome browser must also be installed:

```
npx puppeteer browsers install chrome
```

This matches the Render build command in `render.yaml`.

### Running the bot locally without Discord credentials

```bash
ATLAS_NO_LOGIN=1 DISCORD_BOT_TOKEN=qa-stub TWELVE_DATA_API_KEY=qa-stub \
  SYSTEM_STATE=BUILD_MODE node index.js
```

- `ATLAS_NO_LOGIN=1` suppresses the Discord login so the process stays alive.
- `SYSTEM_STATE=BUILD_MODE` is required (the process exits if this is missing
  or invalid; valid values: `BUILD_MODE`, `FULLY_OPERATIONAL`).
- The bot still fetches TradingView's economic calendar (no API key needed)
  and runs all internal schedulers (Dark Horse, Market Intel, Corey Live Data).
- Live market data from TwelveData, FMP, FRED, and EODHD will show as
  degraded/unavailable without real API keys — this is expected and non-fatal.

### Running tests

There is no test framework (jest/mocha). All tests are custom Node.js scripts.

- **Audit (lint equivalent):** `npm run audit`
- **Runtime doctrine test:** `npm run test:runtime`
- **QA suites:** `npm run qa:live-route`, `npm run qa:darkhorse`,
  `npm run qa:discord-batch`, `npm run qa:macro-operational`, etc. — see
  `package.json` scripts for the full list.
- **Unit-style tests in `tests/`:** Run all with
  `for f in tests/*.test.js; do node "$f"; done`

All QA scripts that need stubbed env vars already set them inline (e.g.
`qa:live-route` and `qa:discord-batch` inject `ATLAS_NO_LOGIN=1` etc.).

### Environment variables

Required for full operation (fatal on missing):

| Variable | Purpose |
|---|---|
| `DISCORD_BOT_TOKEN` | Discord bot auth |
| `TWELVE_DATA_API_KEY` | Market data (quotes, candles) |
| `SYSTEM_STATE` | Must be `BUILD_MODE` or `FULLY_OPERATIONAL` |

Optional but important for feature-complete testing:

| Variable | Purpose |
|---|---|
| `FMP_API_KEY` | OHLC enrichment + economic calendar |
| `FRED_KEY` | Yield curve (T10Y2Y) for Corey live data |
| `CHART_IMG_API_KEY` | Multi-timeframe chart rendering |
| `EODHD_API_KEY` | Equity realtime quotes / fundamentals |

### Gotchas

- The `prebuild` script in `package.json` runs `npm run doctrine:foundation`
  (audit + runtime test) automatically before builds. This will fail if the
  required env vars (`DISCORD_BOT_TOKEN`, `TWELVE_DATA_API_KEY`,
  `SYSTEM_STATE`) are not set. For a plain `npm install`, this is not
  triggered.
- Puppeteer requires system Chrome dependencies. On the Cloud VM these are
  already available; the `npx puppeteer browsers install chrome` step just
  downloads the matching Chromium binary.
- No ESLint or TypeScript — the codebase is vanilla JavaScript. The audit
  script (`npm run audit`) serves as the lint/drift check.
