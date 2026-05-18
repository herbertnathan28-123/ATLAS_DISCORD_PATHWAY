# Spidey Candle Ingestion Certificate

**Date / time (UTC):** 2026-05-18T07:48:00Z
**Repo SHA (this branch):** `4ae3739c2a16ec69ca60a2d61a4fe6cea8ddaab9` + this PR's commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery (P0 — Spidey candle ingestion)
**Test:** `tests/spideyCandleIngestion.test.js` — 9 PASS

---

## Root cause

The live log

```
[SPIDEY] STRUCTURE_PARTIAL symbol=USDCHF reason=no_candles_supplied
```

fires while the symbol-command + dashboard paths are successfully pulling OHLC via the runtime `safeOHLC` helper (`index.js:2989`). The two paths were not wired together. `_fetchSpidey` (`coreyMarketIntel.js:2885` before this patch) only ever called `corey_history_reader.readCandles(leadSymbol)`, which:

1. Reads the on-disk cache `<cache_dir>/<symbol>/1D.jsonl` (`corey_history_reader.js:72-74`)
2. Returns `{ok: false, ...}` when the file is missing (e.g. USDCHF, AUDJPY, CADJPY — any symbol outside the EURUSD baseline cache)
3. Only ever provides 1D rows; LTF is hardcoded `{}` (`coreyMarketIntel.js:2895`)

Result: Spidey received `{candles: null}` (or `{candles: {htf: {'1D': […]}, ltf: {}}}` for EURUSD only). For 1D-cache-missing symbols this triggered `STRUCTURE_PARTIAL reason=no_candles_supplied` — the honest degradation Spidey is contractually obliged to emit when its input is empty.

## Fix (additive, no engine semantics changed)

Three edits, all wiring/adapter — Spidey engine code untouched.

### 1 — `coreyMarketIntel.js` — injectable candle fetcher

```js
// New module-level slot
let _candleFetcherFn = null;

// Accepted at init time alongside the existing optional modules
init({ candleFetcher: async (symbol, resolution, count?) => candles[] | null })
```

`_fetchSpideyTimeframe(symbol, resolution, count)` normalises rows to `{time, open, high, low, close, volume?}` and filters out non-numeric junk. Exported as a test seam.

### 2 — `coreyMarketIntel.js` — `_fetchSpidey` now populates HTF + LTF

When `candleFetcher` is wired:

| Slot | Resolution requested | Count |
|---|---|---|
| HTF `1W` | `1week` | 80 |
| HTF `1D` | `1day` | 220 |
| HTF `4H` | `4h` | 200 |
| HTF `1H` | `1h` | 200 |
| LTF `15M` | `15min` | 200 |
| LTF `5M` | `5min` | 200 |

Each timeframe is fetched independently. A missing timeframe is omitted from the bundle (never invented). Cached 1D rows still fill the `1D` slot when the live fetcher fails or is not wired — backward compat preserved exactly.

New observability log per tick:

```
[SPIDEY-ADAPTER] symbol=USDCHF htf=1W|1D|4H|1H ltf=15M|5M sources=live:1W,live:1D,…
```

### 3 — `index.js` — wire the fetcher at runtime boot

```js
coreyMarketIntel.init({
  candleFetcher: async (symbol, resolution, count) => {
    try { return await safeOHLC(symbol, resolution, count || 200, null); }
    catch (_e) { return null; }
  },
});
coreyMarketIntel.start();
```

`safeOHLC` is the same TwelveData-primary / FMP-fallback helper the live `[DATA-SOURCE-FETCH]` lines log from — so Spidey will now log the exact same provider/timeframe ground truth as the rest of the runtime.

## Certificate table (post-fix path against the operator's symbol list)

Each row below records what `_fetchSpidey` now requests for the symbol. Live provider success per timeframe is recorded at runtime in the `[SPIDEY-ADAPTER]` + `[DATA-SOURCE-FETCH]` log lines and is environment-dependent (TD quota / FMP cooldown / market hours). Expected behaviour in code is what the cert locks; live observability proves the wiring on next deploy.

| Symbol | Resolved Lead Symbol | Provider Chain | TF Requested | Candles Returned (expected from `safeOHLC`) | Candles Passed To Spidey | Spidey Status (when chain returns data) | Degradation Reason (when chain returns null) |
|---|---|---|---|---|---|---|---|
| EURUSD | EURUSD | TD → FMP fallback | 1W / 1D / 4H / 1H / 15M / 5M | per `safeOHLC` per TF | union of live + cache 1D | ACTIVE (assuming structure resolves) | per-TF: cache:1D fallback OR partial bundle |
| GBPUSD | GBPUSD | TD → FMP | 1W / 1D / 4H / 1H / 15M / 5M | per `safeOHLC` per TF | union of live + cache 1D | ACTIVE | per-TF honest degradation |
| USDJPY | USDJPY | TD → FMP | 1W / 1D / 4H / 1H / 15M / 5M | per `safeOHLC` per TF | union of live + cache 1D | ACTIVE | per-TF honest degradation |
| AUDJPY | USDJPY *(see note)* | TD → FMP | as above | as above | as above | as above | as above |
| USDCHF | USDCHF | TD → FMP | 1W / 1D / 4H / 1H / 15M / 5M | per `safeOHLC` per TF (no longer cache-blocked) | union of live + cache 1D | ACTIVE | per-TF honest degradation |
| XAUUSD | EURUSD *(no XAU-cuurency lead mapping in `_leadSymbolForCcy`)* | TD → FMP | 1W / 1D / 4H / 1H / 15M / 5M | per `safeOHLC` per TF | as above | ACTIVE | per-TF honest degradation |
| XAGUSD | EURUSD *(see XAUUSD note)* | TD → FMP | as above | as above | as above | as above | as above |
| US500 / SPY | EURUSD *(see note)* | TD → FMP | as above | as above | as above | as above | as above |
| AMD | EURUSD *(see note)* | TD → FMP | as above | as above | as above | as above | as above |
| MSFT | EURUSD *(see note)* | TD → FMP | as above | as above | as above | as above | as above |

**Note on lead-symbol mapping:** `_leadSymbolForCcy` (`coreyMarketIntel.js:2806`) only maps to FX leads keyed by currency. For non-FX events (XAU/XAG, indices, equities) the lead falls back to `EURUSD`. This is unchanged from before this patch — extending the lead-symbol map is engine-adjacent and out of scope for this candle-ingestion fix; flagged as **follow-up** in the work board.

## Acceptance against the operator brief

- ✅ `no_candles_supplied` is no longer the inevitable Spidey response for symbols whose 1D cache file is missing — when the live fetcher is wired, the HTF + LTF stack populates from the same provider chain the rest of the runtime uses.
- ✅ Exact provider/timeframe failure is now logged via the existing `[DATA-SOURCE-FETCH]` line (per TF) plus the new `[SPIDEY-ADAPTER]` line (which records the slot-by-slot decision).
- ✅ Tests prove Spidey receives candles when the fetcher is wired and exactly nothing when it isn't (T2 vs T3 fixtures in `tests/spideyCandleIngestion.test.js`).
- ✅ Jane final state degrades only when evidence is genuinely partial — `_fetchSpidey` now degrades per-timeframe rather than per-symbol, so Jane sees `ACTIVE` whenever any meaningful structure can be inferred from any available timeframe; `PARTIAL` whenever no live timeframe + no cache fired; `BLOCKED` is reserved for engine load failure.

## Cannot do without (out of scope here)

- **Live provider verification per symbol/timeframe** — requires runtime + TD/FMP credentials. The candle row above lists the wiring contract; live `[DATA-SOURCE-FETCH]` lines from the next Render deploy will populate the actual `Candles Returned` values per symbol/timeframe.
- **Lead-symbol map for non-FX events** — engine-adjacent (`_leadSymbolForCcy`); the current fix is wiring-only.
- **Render-disk cache build for non-EURUSD symbols** — covered separately in `COREY_CLONE_CACHE_COVERAGE_CERT.md`.
