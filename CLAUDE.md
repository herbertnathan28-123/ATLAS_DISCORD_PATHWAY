# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Identity & Scope
- Repo: `herbertnathan28-123/ATLAS_DISCORD_PATHWAY` (default branch: `main`)
- Runtime: Node.js 20.x — single-process Discord bot
- Deploy: Render (see `render.yaml`) — `npm install && npx puppeteer browsers install chrome` build, `node index.js` start, persistent disk mounted at `/opt/render/project/src/exports`
- Sister repo: `herbertnathan28-123/ATLAS_ASTRA_RELAY` (Astra AI bot). **Never touch it from this repo. Never import from it.**

## Working Standard
Production system. No guessing, no speculative refactors, no "improving" structure that wasn't asked for. If intent is unclear, stop and ask — do not infer.

---

## Commands

```bash
npm install            # install deps (discord.js, axios, express, sharp, @dsnp/parquetjs, dotenv)
npm start              # runs `node index.js` — the bot entrypoint

# Historical cache CLI (cacheUpdater.js — forward-append only)
node cacheUpdater.js                  # update all symbols in UNIVERSE
node cacheUpdater.js EURUSD           # update a single symbol
node cacheUpdater.js --status         # print cache status table
```

There is no test suite, no linter, and no build step. `npm start` is the only script defined in `package.json`. Don't invent CI steps.

---

## Required Environment Variables

Boot fails fast if the first three are missing:

- `DISCORD_BOT_TOKEN` — required
- `TWELVE_DATA_API_KEY` — required (note: `cacheUpdater.js` reads `TWELVEDATA_API_KEY` — this naming mismatch is real; preserve both unless consolidating intentionally)
- `SYSTEM_STATE` — required, must be exactly `BUILD_MODE` or `FULLY_OPERATIONAL`

Optional / feature-gated:

- `FRED_KEY` — FRED yield-curve feed (corey_live_data.js)
- `TRADING_ECONOMICS_KEY` — calendar fallback (corey_calendar.js)
- `ATLAS_INSTANCE_ID`, `ATLAS_SIGNING_SECRET`, `ATLAS_SIGNATURE_ENABLED`, `ATLAS_WATERMARK_ENABLED` — auth/signing. Without both ID+SECRET, `isTradePermitAllowed()` is permanently false
- `ROADMAP_URL`, `SHARED_MACROS_CHANNEL_ID`, `CHART_IMG_API_KEY`, `DARKHORSE_STOCK` (Dark Horse webhook URL)
- `TV_COOKIES` — JSON array of TradingView cookies, sanitised at boot
- `ENABLE_TRENDSPIDER` (default on), `TRENDSPIDER_PORT` (default 3001), `TRENDSPIDER_SIGNAL_TTL_MS`, `TRENDSPIDER_HISTORY_LIMIT`, `TRENDSPIDER_PERSIST_PATH`
- `CACHE_ROOT` — parquet storage root, default `/data/historical`

---

## Architecture — Big Picture

The bot is a single Node process (`index.js`) that boots five collaborating subsystems and a Discord client. There is no framework — flow is driven by module-level singletons and a 15-minute scan interval.

### Module map
- **`index.js`** — Discord client, macro engine, symbol taxonomy (FX / equity / commodity / index), central-bank stances, regime/vol/liquidity detectors, TrendSpider store, formatter (`formatMacro`), and a Puppeteer+TradingView-widget rendering path (`renderAllPanelsV3` / `buildGrid` / `overlayPriceBoxes`). This file is large (~85 KB) and intentionally monolithic.
- **`renderer.js`** — **currently a stub.** Returns a 67-byte transparent PNG for both `htfGrid` and `ltfGrid`. The real rendering layer lives inside `index.js` (`renderAllPanelsV3`) but is not wired through `messageCreate`. When rebuilding the renderer, preserve the export signature `{ renderAllPanels(symbol) -> { htfGrid, ltfGrid, htfGridName, ltfGridName } }` so `index.js` keeps booting.
- **`corey_live_data.js`** — live macro data layer. Fetches DXY (via UUP ETF proxy on TwelveData), VIX (via VXX ETF proxy), and yield curve (FRED T10Y2Y). Module-level cache refreshed every 15 min. `init()` is called at module load in `index.js`. Exports `getLiveContext()` / `getMarketContext()` — always returns last-known-good data, never null after boot.
- **`corey_calendar.js`** — economic calendar engine (Corey Phase 2). TradingView primary feed → Trading Economics fallback → degraded-mode static skeleton. Built-in XML parsing, currency→symbol map, historical reaction database (CPI/NFP/Rate Decision/GDP/PMI). `init()` called explicitly from `index.js` because `coreyLive.init()` is async-not-awaited and the original chained call could be silently orphaned.
- **`darkHorseEngine.js`** — trend-scan layer. `DH_UNIVERSE` covers FX majors/crosses, major indices, a curated equity list, and XAU/XAG. Crypto permanently banned (`CRYPTO_BANNED` set). Market-hours gated. Scores ≥8 post to Discord and trigger the macro pipeline; 5–7 stored internally only. No execution, no Jane bypass.
- **Cache layer**: `historicalCache.js` (one-shot 15-year backfill from TwelveData) → `cacheManager.js` (parquet I/O, fx/stocks/commodities split under `/data/historical/`) → `cacheReader.js` (only interface engines should use to read candles) → `cacheUpdater.js` (scheduled forward-append updates). **Engines must never read parquet directly** — go through `cacheReader`.

### Runtime flow
1. Boot: validates env → loads TV cookies → registers `coreyLive.init()` and `coreyCalendar.init()` → creates Discord client.
2. `clientReady`: calls `dhInit(safeOHLC)`, sets the DH pipeline trigger, starts a 15-min Dark Horse scan interval.
3. `messageCreate`: current handler (index.js:475) validates `!SYMBOL`, resolves aliases, infers the user via `USER_BY_ID` → `USER_BY_CHANNEL` fallback, and replies with a dashboard URL of the form `https://atlas-fx-dashboard.onrender.com?symbol=…&user=…`. **It does not currently invoke `runMacroPipeline` or the chart renderer.** The full macro+chart delivery path exists in `index.js` but is dormant.
4. Dark Horse scan: `runDarkHorseScan()` every 15 min (market hours only) → on trigger score, calls `runMacroPipeline(symbol)` → `buildMacro` → Corey live + internal macro composite.
5. Optional TrendSpider webhook on `TRENDSPIDER_PORT` (default 3001), signal TTL default 4h.

### Macro composite contract (do not break field names)
`buildMacro(symbol)` returns `{ symbol, bias, confidence, structure, regime, risk, htf, ltf, timestamp }` sourced from:
- `corey.combinedBias`
- `corey.internalMacro.regime.regime`
- `corey.internalMacro.global.riskEnv`
- `corey.internalMacro.global.live.vix.level`

These field paths are consumed by `formatMacro` and the downstream pipeline. Changing them silently breaks output.

---

## Do Not Touch — Ever
- `astra.js` in `ATLAS_ASTRA_RELAY` (different repo)
- `coreyLive.init()` call at module load in `index.js`
- `coreyCalendar.init()` explicit registration in `index.js` (exists because `coreyLive.init()` is not awaited — removing it orphans the refresh loop)
- `getMarketContext()` / `getLiveContext()` exports in `corey_live_data.js`
- `detectRegime()` in `index.js`
- `buildMacro` field mappings listed above

## Locked Colour Codes — Never Change

| Element | Hex | Text colour |
|---|---|---|
| Up candles | `#00ff00` | — |
| Down candles | `#ff0015` | — |
| Background | `#131722` | — |
| Price box HIGH | `#FFD600` | Black |
| Price box CURRENT | `#00FF5A` | Black |
| Price box ENTRY | `#FF9100` | Black |
| Price box LOW | `#00B0FF | White |

---

## Known Gotchas
- **Renderer is stubbed.** Do not assume `renderer.js` produces real charts. The v3 rendering code inside `index.js` (Puppeteer + TradingView widget + `sharp` overlays, HTF `1W/1D/4H/1H`, LTF `30M/15M/5M/1M`, 1920×1080) is the intended target but is not reached from `messageCreate`.
- **API key env-var drift.** `index.js` + `corey_live_data.js` + `historicalCache.js` use `TWELVE_DATA_API_KEY`; `cacheUpdater.js` uses `TWELVEDATA_API_KEY`. Match whichever the module reads.
- **DJI symbol.** `DJI` is invalid on TwelveData. If re-wiring TD quote calls, map through a `TD_SYMBOL_MAP` to the correct index symbol. Pattern exists in `cacheUpdater.js` (`USOIL→CL`, `UKOIL→BZ`, `XAUUSD→XAU/USD`).
- **BRENT needs TwelveData Pro.** Do not add `BRENT` to `DH_UNIVERSE` without the plan upgrade; use `BZ` through the cache layer instead.
- **Crypto is permanently excluded** from `DH_UNIVERSE` via `CRYPTO_BANNED`. Do not add exceptions.
- **`deliverResult` / `formatMacro` are governed by a locked institutional spec** (see below). Output changes belong in a dedicated session, not incidental edits.

---

## Macro Output — Locked Spec (reference before editing `formatMacro` / `deliverResult`)

Institutional briefing standard. Hard-fail conditions: short summaries, missing sections, no directional arrows, single-direction bias only, retail-style formatting, thin content, removed explanations.

**Output order:** Chart 2×2 → Trade Status → Price Table → Roadmap Link → Global/Event Intelligence Block → Market Overview → Events/Catalysts → Historical Context → Execution Logic → Validity.

- Sentiment: dominant bias on 1–5 dot scale; mixed ⬆️⬇️ arrows MANDATORY under the dominant score (`mixedArrows` in index.js).
- Event Intelligence Block: Sentiment header · Headline · Timestamp · Expanded summary · AI commentary · Mechanism chain · Trader note · Affected symbols.
- Execution Logic: strict IF/THEN only, no storytelling.
- Roadmap cadence: Monday = full depth (30–35 page equivalent), midweek = remove outdated sections only (keep explanations), Friday = execution-focused. Implemented in `dayMode()`.
- Every paragraph in Market Overview and Historical Context must end with ⬆️ or ⬇️.

Full spec lives in Notion — *ATLAS FX — Macro + Roadmap Master Brief v2.0 (LOCKED) — 5 April 2026*.
