# Corey Clone Cache Coverage Certificate

**Date / time (UTC):** 2026-05-18T07:55:00Z
**Repo SHA (this branch):** `4ae3739` + this PR's commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery (P0 — Corey Clone cache coverage)
**Tool:** `node scripts/cache_coverage_report.js [--json|--markdown]` (new in this PR)

---

## Where the cache lives

| Layer | Path (per `corey_history_config.js`) |
|---|---|
| Render persistent disk (production) | `/data/historical/` |
| Local / CI fallback | `<repo>/data/historical/` |
| Override env | `ATLAS_HISTORICAL_CACHE_DIR` |
| Manifest | `<cache_dir>/_manifest.json` |
| Per-symbol file | `<cache_dir>/<ATLAS_SYMBOL>/1D.jsonl` |

## Coverage matrix (Annex A, 37 priority symbols)

Run the new reporter on Render to populate live coverage:

```bash
node scripts/cache_coverage_report.js              # human table
node scripts/cache_coverage_report.js --markdown   # paste into this cert
node scripts/cache_coverage_report.js --json       # machine-readable
```

When run against the **sandbox checkout** (this PR's CI environment with no historical cache files), the reporter emits a fully-`BLOCKED` table:

```
ATLAS Corey Clone cache coverage
Cache dir: /home/user/ATLAS_DISCORD_PATHWAY/data/historical
Manifest : (MISSING: manifest_missing)

Status counts: {"BLOCKED":37}
```

| Rank | Symbol | Group | Cache Path | Rows | First Date | Last Date | Last Verified | Age (d) | Freshness | Usable | Status | Action Needed |
|---:|---|---|---|---:|---|---|---|---:|---|---|---|---|
| 1 | `EURUSD` | fx_major | `data/historical/EURUSD/1D.jsonl` | 0 | — | — | — | — | unknown | ❌ | BLOCKED | Build cache via corey_history_harvester for EURUSD |
| 2 | `GBPUSD` | fx_major | (same pattern) | 0 | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |
| 3 | `USDJPY` | fx_major | (same pattern) | 0 | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |
| 4 | `AUDUSD` | fx_major | (same pattern) | 0 | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |
| 5 | `USDCAD` | fx_major | (same pattern) | 0 | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |
| 6 | `USDCHF` | fx_major | (same pattern) | 0 | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |
| 7 | `NZDUSD` | fx_major | (same pattern) | 0 | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |
| 8–21 | FX crosses (EURGBP / EURJPY / GBPJPY / AUDJPY / CADJPY / CHFJPY / EURAUD / EURCAD / GBPAUD / GBPCAD / GBPCHF / AUDCAD / AUDNZD / NZDCAD) | fx_cross | per-symbol | 0 each | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |
| 22–26 | Indices (NAS100 / US500 / DJI / GER40 / UK100) | index | per-symbol | 0 each | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |
| 27–35 | Equities (NVDA / AMD / ASML / AAPL / MSFT / META / GOOGL / AMZN / TSLA) | equity | per-symbol | 0 each | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |
| 36–37 | Metals (XAUUSD / XAGUSD) | metal | per-symbol | 0 each | — | — | — | — | unknown | ❌ | BLOCKED | Build cache |

**On Render production** the rows will differ — the reporter inspects the live disk and the live `_manifest.json`. The operator runs the reporter post-deploy and pastes the markdown output back into this cert to lock the production coverage state.

## Required production behaviour (per the brief)

The Corey Clone gate logic in `corey_clone.js:365-377` already honours the cert's required behaviour without code changes:

| Cache state | Behaviour | File:line |
|---|---|---|
| `cache_file_missing` | returns `status: BLOCKED`, `usableForDecision: false`, reason: "cache file missing" | `corey_history_reader.js:72-74` |
| `severely_stale` (> 90 days) | returns `status: PARTIAL`, factor 0.80, reason: "stale > 90d" | `corey_history_config.js:43,45` |
| `limitation_flag` (14–30 days) | returns `status: OK`, reason flagged | per `FRESHNESS.limitationFlagDays` |
| `fresh` (≤ 14 days) | returns `status: OK`, full confidence | per `FRESHNESS.freshDays` |
| Unknown symbol | returns `status: UNAVAILABLE` | per Annex A lookup |
| Decision-grade gate | `confidence ≥ ACTIVE_CONFIDENCE_FLOOR (0.40)` | `corey_history_config.js:57` |

When any of those states fires, Jane's synthesis suppresses historical analogue claims via the `cloneActive` check at `jane.js:138-141`:

```js
if (!cloneActive && tradeViability === 'VALID') {
  tradeViability = 'MARGINAL';  // cap when historical lane unavailable
}
```

## Acceptance against the operator brief

- ✅ Cache directory + manifest location confirmed (`corey_history_config.js:18-19, 151, 155`)
- ✅ Annex A symbol list enumerated and is the reporter's input (37 symbols, full operator-spec coverage: FX majors, crosses, metals, indices, equities)
- ✅ Coverage reporter built and runnable: `node scripts/cache_coverage_report.js`
- ✅ Reports per-symbol cache path, row count, freshness, usable-for-decision, status, action needed (markdown, JSON, human formats)
- ✅ "If cache missing → return BLOCKED, suppress historical analogue claims, report exact path, add to cache build manifest" — already enforced by `corey_history_reader.js:72-74` + `jane.js:138-141`
- ✅ EURUSD is **not** privileged in this audit — every Annex A symbol gets the same treatment
- ✅ Historical analogue claim cannot appear unless Corey Clone is decision-grade (Jane gate confirms)

## Cannot do without (out of scope here)

- **Building the actual cache files for non-EURUSD symbols** — requires:
  - TwelveData / FMP credentials (production secrets)
  - The `corey_history_harvester.js` to run against each Annex A symbol
  - Render persistent disk write access (`/data/historical/`)

  All of these are operational runtime tasks, not code changes. The exact command per operator brief 2026-05-18:

  ```bash
  # On Render shell (or local with credentials + ATLAS_HISTORICAL_CACHE_DIR set)
  node scripts/cache_harvest.js --refresh   # rebuild all Annex A symbols
  ```

  The harvester is already wired via `package.json` (`"cache:harvest": "node scripts/cache_harvest.js"`, `"cache:refresh": "node scripts/cache_harvest.js --refresh"`).

- **Live manifest content from production disk** — once the harvester runs, re-run `node scripts/cache_coverage_report.js --markdown > docs/certificates/COREY_CLONE_CACHE_COVERAGE_CERT_LIVE.md` and commit that file as the production-state cert.

## Follow-up

Add the live-coverage cert to the work board's "Recently Completed" entry once production cache build is run. The reporter is deterministic — re-running it after every harvester run gives a fresh truth-of-the-cache snapshot.
