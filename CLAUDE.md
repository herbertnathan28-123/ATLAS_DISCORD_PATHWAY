# ⚡ CLAUDE.md — ATLAS FX Repo Context File (13 April 2026)

**Drop this file in the root of `ATLAS_DISCORD_PATHWAY` repo. Claude Code reads it automatically at session start.**

---

## Identity
- Repo: `herbertnathan28-123/ATLAS_DISCORD_PATHWAY` (branch: `main`)
- Runtime: Node.js, Render Standard plan, Singapore region
- Bot: FX Bot#3867
- Second repo: `herbertnathan28-123/ATLAS_ASTRA_RELAY` — Astra AI bot. **DO NOT TOUCH UNDER ANY CIRCUMSTANCE.**

---

## Working Standard
This is a production system. Not a hobby project. Every change must be executable and reliable. No guessing. No improvising structure. If unclear, stop and ask. Never infer intent.

---

## What Is Working — Do Not Break
- Corey live data layer — DXY via UUP ETF, VIX via VXX ETF, yield curve via FRED T10Y2Y
- `globalMacro()` wired to live data — no longer hardcoded zeros
- Central bank stances updated to April 2026
- Dark Horse Engine v2.0 — scanning every 15 minutes
- TrendSpider webhook — port 3001
- Astra bot — live on `ATLAS_ASTRA_RELAY`

## Do Not Touch — Ever
- `astra.js` in `ATLAS_ASTRA_RELAY`
- `coreyLive.init()` call at module load in `index.js`
- `getMarketContext()` and `getLiveContext()` in `corey_live_data.js`
- `detectRegime` function in `index.js`
- `buildMacro` field mappings: `corey.combinedBias`, `corey.internalMacro.regime.regime`, `g.riskEnv`, `g.live.vix.level`

---

## Locked Colour Codes — Never Change

| Element | Hex | Text |
|---|---|---|
| Up candles | #00ff00 | — |
| Down candles | #ff0015 | — |
| Background | #131722 | — |
| Price box HIGH | #FFD600 | Black |
| Price box CURRENT | #00FF5A | Black |
| Price box ENTRY | #FF9100 | Black |
| Price box LOW | #00B0FF | White |

---

## CRITICAL 1 — Renderer Fix (renderer.js ONLY)
Architecture is correct. Do not redesign. Apply these 6 fixes only.

The renderer uses Puppeteer + TradingView lightweight-charts widget embeds in a vertical stack.
- HTF strip: 1W / 1D / 4H / 1H stacked vertically
- LTF strip: 30M / 15M / 5M / 1M stacked vertically
- Problem: First pane in each strip renders blank. Canvas detection failing. All panes rendering identical data.

### FIX 1 — Range-based candle detection (anti-aliasing fix)
Replace exact RGB match with range-based detection:
```javascript
const isUp = d[1] > 180 && d[0] < 80 && d[2] < 80;
const isDn = d[0] > 180 && d[1] < 80 && d[2] < 80;
```

### FIX 2 — Sequential widget loading
Do NOT create all widgets simultaneously. Add 250ms delay between each widget creation.

### FIX 3 — Wait for TradingView script
After `page.setContent()`, add `waitForFunction` check that `typeof TradingView !== 'undefined'` before creating widgets. Timeout: 15000ms.

### FIX 4 — Scope canvas detection
Replace:
```javascript
document.querySelectorAll('canvas')
```
With:
```javascript
document.querySelectorAll('.tv-lightweight-charts canvas')
```

### FIX 5 — Candle visibility overrides
Add to overrides object:
```javascript
barSpacing: 8,
drawBorder: true,
drawWick: true,
scalesProperties: { fontSize: 14 }
```

### FIX 6 — Hide TradingView UI chrome
Set in widget config:
```javascript
hide_side_toolbar: true,
hide_top_toolbar: true,
withdateranges: false,
details: false,
calendar: false,
hotlist: false
```

### Render Time Target
Current render time is ~7 minutes. This is unacceptable. After applying fixes, sequential capture with 250ms delays between widget creation should bring total render time under 60 seconds. If still above 2 minutes after fixes, investigate Puppeteer timeout values and reduce where safe.

---

## CRITICAL 2 — Symbol Fixes (same session as renderer)

### DJI — index.js
DJI is an invalid TwelveData symbol. Add correct mapping to `TD_SYMBOL_MAP` in `index.js`.
TwelveData accepts `DJI` as `^DJI` or map to the correct index symbol per TwelveData docs.

### BRENT — darkHorseEngine.js
BRENT requires TwelveData Pro plan. Remove `BRENT` from `DH_UNIVERSE` array in `darkHorseEngine.js`.

---

## CRITICAL 3 — Macro Output Rebuild (SEPARATE SESSION)
Do not touch `formatMacro()` or `deliverResult()` in this session. Macro rebuild is a standalone dedicated session against the locked spec below.

### Locked Macro Spec Summary
Output must be institutional briefing standard. Hard fail conditions:
- Short summaries
- Missing sections
- No directional arrows
- Single-direction bias only
- Retail-style formatting
- Thin content
- Removed explanations

**Locked output order:** Chart 2×2 → Trade Status → Price Table → Roadmap Link → Global/Event Intelligence Block → Market Overview → Events/Catalysts → Historical Context → Execution Logic → Validity.

**Sentiment system:** Dominant bias on 1–5 dot scale. Mixed ⬆️⬇️ arrows MANDATORY under dominant score.

**Event Intelligence Block must include:** Sentiment header, Headline, Timestamp, Expanded summary, AI commentary, Mechanism chain, Trader note, Affected symbols.

**Execution Logic:** Strict IF/THEN format only. No storytelling.

**Roadmap:** Monday = full depth (30–35 page equivalent). Midweek = remove outdated sections only, explanations intact. Friday = execution-focused.

**Every paragraph in Market Overview and Historical Context must end with ⬆️ or ⬇️.**

**Full locked spec:** See Notion → ATLAS FX — Macro + Roadmap Master Brief v2.0 (LOCKED) — 5 April 2026.

---

## Current Commit Stack (main)
```
89cf2c7 — Recalibrate scoreDXY + scoreVIX for ETF proxy scales
79522e9 — Fix blank panes: require candle-color pixels
fa22090 — Restore index.js + detectRegime + buildMacro fix
7e97df4 — Replace corey_live_data.js with cached-refresh module
f1c327f — Symbol translation fix in renderer
```

---

## Session Priority Order
1. Apply all 6 renderer fixes to `renderer.js` — all 8 panes rendering, distinct timeframes, render time under 2 minutes
2. DJI symbol fix in `index.js`
3. BRENT removal from `darkHorseEngine.js`
4. Commit and push — confirm deploy on Render
5. Macro rebuild — separate dedicated session
6. Corey Phase 2 economic calendar engine — future session
