# ATLAS FX — Monday Readiness Audit

**Audit date:** 2026-05-16 (Saturday)  
**Target:** Monday open operational credibility  
**Auditor lane:** Macro / Market Intel (Cursor owns Dark Horse FOH ATL-6 lane)

---

## 1. Live data layer — Corey

| Item | Status | Source / Proxy | Notes |
|---|---|---|---|
| US Dollar Index (DXY) bias | **PASS** | UUP ETF proxy (cached-refresh) | Range-scored 1D change · scoreDXY recalibrated per commit `89cf2c7` |
| CBOE Volatility Index (VIX) level | **PASS** | VXX ETF proxy | scoreVIX recalibrated for ETF scale; levels: very low / low / moderate / elevated |
| Yield curve regime | **PASS** | FRED T10Y2Y | Inverted / flat / steep classification |
| Central-bank stance anchors | **PASS** | Apr 2026 hard-coded | All G10 CBs updated |
| Live context module | **PASS** | `corey_live_data.js:getLiveContext()` | Cached-refresh, safe-fail; CLAUDE.md "Do Not Touch — Ever" guard intact |

**Verdict: PASS.** No staleness flags raised in last 24h.

---

## 2. Calendar / event intelligence

| Item | Status | Notes |
|---|---|---|
| Primary source | **PASS** | TradingView calendar (ops report: 86 events, healthy) |
| Secondary source | **PARTIAL** | TradingEconomics (402 acceptable / degraded secondary while TV live) |
| `corey_calendar.getEventIntelligence(symbol)` | **PASS** | High-impact event blocks render WHAT HAPPENED / WHY / EXPECTED MOVE / TRADER ACTION / WHEN INVALID |
| `getUpcomingEvents` / `getNextHighImpact` | **PASS** | 24/48h window filters working |
| Calendar mode flag | **PASS** | `LIVE` / `DEGRADED` / `UNAVAILABLE` propagated to MI source-note line |

**Verdict: PASS.** Degraded secondary is acceptable while primary is LIVE.

---

## 3. Market Intel (PR #106 boxed doctrine + Lane 1 additions on this branch)

| Item | Status | Notes |
|---|---|---|
| Boxed sections (▛ ▜) | **PASS (with caveat — see §7)** | MARKET MOOD · WHY THIS MATTERS · BEFORE/DURING/AFTER · WHAT CONFIRMS · WHAT CANCELS · AFFECTED MARKETS · NEXT REVIEW · SOURCE NOTE |
| Lifecycle tags | **PASS** | NEW WATCH → STILL ACTIVE → ESCALATING → RELEASE WINDOW → RESULT IN → COOLING / INVALIDATED |
| Probability basis label | **PASS** | One of: `historically sourced` / `engine-derived` / `scenario estimate` / `insufficient evidence` |
| Source-note provenance | **PASS** | `calendar=<src>/<mode> · macro=ATLAS · probability=<basis>` |
| Banned-token guards | **PASS** | BOS / CHoCH / prints / Trigger Level / "Corey read" / bare DXY-VIX-US10Y-US2Y |
| Embed safe cap | **PASS** | All 12 fixtures ≤ 1898 / 1900 chars |
| **Lane 1 additions (this branch):** | | |
| Macro glossary chip (CYAN hyperlink) | **PASS** | `📘 [[Glossary · Dovish · Hawkish · Yield curve · Risk-off · Liquidity sweep]](url)` on every payload |
| Historical context (opts-driven) | **PASS** | Inline `📅 *Prior N:* …` line only when `opts.history` supplied — never fabricates priors |
| Source-degraded transparency tail | **PASS** | `⚠️ *Macro proxies:* US Dollar Index via UUP · CBOE Volatility Index via VXX · yield curve via FRED T10Y2Y` (only fires when `calendar_mode !== 'LIVE'`) |

**Verdict: PASS.** Lane 1 additions are additive and live behind the existing presence/banned-token QA.

---

## 4. Dark Horse (Cursor's ATL-6 lane)

| Item | Status | Notes |
|---|---|---|
| Engine scoring | **PASS** | DH_SCORE_WATCH=8 / DH_SCORE_INTERNAL=5 (PR #74-94 stable) |
| 15-min scheduler | **PASS** | `runDarkHorseScan()` wired at module load in `index.js` |
| First-detection tracker | **PASS** | `darkHorseFirstDetection.js` merged via PR #90 — tracks first-seen + duration + persistence |
| FOH v6 visual shell | **PASS** | Cursor PRs #74-99-103-106 stable |
| Lifecycle rendering (FRESH / STILL ACTIVE / FADING boxes) | **HOLD** | Cursor's ATL-6 lane — see §6 |

**Verdict: PARTIAL.** Live execution scanning is solid; lifecycle box doctrine is Cursor-owned and not in this audit's scope.

---

## 5. Decision engine — Spidey / Corey / Corey Clone / Jane

| Module | Authority | Status | Notes |
|---|---|---|---|
| Spidey | structure (HH/HL, breaks, pivots) | **PARTIAL (Phase B)** | Foundation shape correct; Phase D replaces body with real structure analysis |
| Corey | current macro / regime / event | **PASS** | Live data layer wired |
| Corey Clone | historical / base-rate analogues | **PASS** | Phase D contract enforced — 11-field validation, ANY malformed analogue voids the lane |
| Macro Engine | normalised macro context | **PASS** | `formatMacro` / `deliverResult` CLAUDE.md-protected; rebuild scheduled for separate session |
| Jane | only decision voice | **PASS** | Doctrine-correct lane gating; Spidey UNAVAILABLE → INVALID; Clone not ACTIVE → cap at MARGINAL |

**Threshold gates (jane.js:91-101):**
- VALID: marketConfidence ≥ 0.65 · setupQuality ≥ 0.55 · Spidey ACTIVE · Corey ACTIVE
- MARGINAL: marketConfidence ≥ 0.4
- INVALID: otherwise (always when Spidey not ACTIVE)
- Downgrade: Clone not ACTIVE → cap at MARGINAL

**Inter-module sync:** All four authorities feed Jane via the locked `JaneInput → JaneDecisionPacket` contract (validated at emit). Jane never manufactures historical confidence, never reuses old packets, never computes analogues itself.

**Verdict: PASS for Monday foundation.** Phase B is doctrine-correct; Phase D upgrade is a future session.

---

## 6. Webhook / payload safety

| Item | Status | Notes |
|---|---|---|
| `MARKET_INTEL_WEBHOOK` | **PASS** | Configured; payload validator (`validateMarketIntelPayload`) blocks empty / over-cap / banned-token emits |
| `WEEKLY_DARKHORSES` / `DARKHORSE_STOCK` | **PASS** | Dark Horse engine emits with FOMO sanitiser + chunker |
| TrendSpider webhook (port 3001) | **PASS** | Per CLAUDE.md "What Is Working" |
| Payload validators | **PASS** | `validateMarketIntelPayload` blocks empty-after-redaction; chunker preserves boundaries |
| Webhook redaction on logs | **PASS** | `dhSendWebhook` redacts URL secrets in error excerpts |
| Discord chunk-safe rendering | **PASS** | All `test_dh_chunking_qa` boundaries verified |

**Verdict: PASS.**

---

## 7. Render hazards (Lane 2 audit)

**Finding — boxed-heading rendering caveat:**

Cursor's PR #106 `fohBox()` produces:
```
'▛ 🟨 📰 LABEL 🟨 ▜'
```

The `▛` and `▜` characters are Unicode box-drawing brackets, rendered as **plain text glyphs in Discord's body font** — NOT as a true monospace box. On most Discord clients the result is a single-line bracketed chip rather than a multi-line container. Visual effect: section labels stand out via the colour-square emoji + bold name, but there is no actual containing border.

**Operator complaint context:** "live production screenshots still show rendering mismatch" — almost certainly this. The QA presence regex `/▛[^\n]*LABEL[^\n]*▜/` passes because the characters are present; the visual mismatch is that they don't render as a box.

**Two fix paths (NOT applied here — needs operator/Cursor sign-off):**

1. **Code-block monospace boxes** — wrap each section heading in a ```` ```ansi ```` block with a true box-drawing border. Adds ~80 chars per section (× ~8 sections = ~640 chars). Would blow the 1900-char cap.

2. **Native Discord heading markdown** — replace `▛ ... ▜` with `## label` (Discord H2). Renders as bold/large text with separator; no box but clear hierarchy. Cap impact: NEUTRAL (probably saves chars). Compatible across all clients.

**Recommendation:** option 2 — native heading markdown — but this overlaps with Cursor's ATL-6 lane (PR #106 owner). Document and surface for operator/Cursor decision.

**Other render hazards investigated — NO ISSUES:**

| Hazard | Verdict |
|---|---|
| Unicode emoji width on mobile vs desktop | OK — emoji set already mobile-tested via PR #97 polish |
| Markdown `**bold**` collapse | OK — no nested `*` / `**` traps detected in MI payloads |
| Code-block escape (` ``` `) | OK — only used in DH FOH chart card attachments |
| Embed-vs-content boundary | OK — MI uses CONTENT-only delivery (no embed footers truncated) |
| Newline interactions | OK — `\n` consistently emitted before/after sections |
| Hyperlink rendering | OK — `[[label]](url)` form passes Discord masked-link parser |

---

## 8. Doctrine compliance

| Banned token / phrase | Guard | Verdict |
|---|---|---|
| BOS / CHoCH (raw) | QA regex `\bBOS\b` / `\bCHoCH\b` | PASS — translated to bracketed forms |
| prints (verb) | QA regex `\bprints?\b` | PASS — replaced with `readings` / `releases` |
| Trigger Level | QA regex | PASS |
| `[REDACTED-FOMO]` | FOMO sanitiser + scrub | PASS |
| "Corey read" legacy heading | QA regex | PASS |
| Bare `DXY` / `VIX` / `US10Y` / `US2Y` | Bare-abbrev guard requires expanded prefix | PASS |
| "will go up / drop / fall / rise" certainty language | Recommend adding to QA (TODO) | not yet enforced — see §10 |

---

## 9. Render / deploy / scheduler

| Item | Status | Notes |
|---|---|---|
| Render Standard plan (Singapore) | **PASS** | Service live; SYSTEM_STATE FULLY_OPERATIONAL (operator report 2026-05-16) |
| Bot online | **PASS** | FX Bot#3867 |
| MI scheduler | **PASS** | `coreyMarketIntel.start()` wired at boot |
| DH scheduler | **PASS** | 15-min scan loop |
| TradingView calendar health | **PASS** | 86 events, source_used=tradingview |
| TradingEconomics fallback | **PARTIAL/acceptable** | 402 degraded; secondary only while TV primary is live |

---

## 10. Outstanding risks / blockers

| Risk | Severity | Plan |
|---|---|---|
| Boxed heading render mismatch | **MEDIUM** | Lane 2 §7 — operator/Cursor decision needed |
| "will go up / down" certainty language not yet QA-banned | **LOW** | Add `/will\s+(?:go\s+up\|drop\|fall\|rise)/i` to FIXED_BANNED in test_market_intel_qa.js |
| Pre-event T-RELEASE Geopolitical fixture near cap (51 char headroom) | **LOW** | Live ECB Press Conference outputs may push over; monitor first Wed |
| Dark Horse lifecycle box rendering (FRESH/STILL/FADING) | **HOLD** | Cursor's ATL-6 lane — operator brief sent |
| Phase D Spidey upgrade | **MEDIUM (not Monday-blocking)** | Separate session per CLAUDE.md doctrine |
| Phase D Astra authority scoring | **MEDIUM (not Monday-blocking)** | Separate session |

---

## 11. Monday readiness verdict

| Lane | Verdict |
|---|---|
| Macro engine credibility | **PASS** |
| Market Intel doctrine (boxed + Lane 1 additions) | **PASS** |
| Calendar / data sources | **PASS** |
| Decision engine (Spidey → Corey → Clone → Jane) | **PASS (Phase B foundation)** |
| Dark Horse live execution scanning | **PASS** |
| Dark Horse lifecycle box rendering | **HOLD (Cursor lane)** |
| Webhook / payload safety | **PASS** |
| Render / deploy / scheduler | **PASS** |
| Render hazard — boxed headings | **PARTIAL (cosmetic, not functional)** |

**OVERALL: SAFE FOR MONDAY OPEN.**

Functional behaviour, data flow, decision authority, payload safety, and credibility surfaces are all green. The single MEDIUM-severity item (boxed-heading render appearance) is cosmetic — does not affect data correctness, decision quality, or operator transparency. Operator may choose to defer until Cursor's next pass.

---

## 12. Recommended next actions (post-Monday)

1. **Cursor / operator decision on heading-render fix** — either accept the current bracketed-character rendering or move to native Discord H2 (`## label`) for true visual hierarchy.
2. **Add `will go up/drop/fall/rise` to FIXED_BANNED** — small QA hardening.
3. **Phase D Spidey + Astra authority** — separate dedicated sessions per CLAUDE.md.
4. **PR #105 close-out** — superseded by Cursor's PR #106 boxed doctrine; can be closed.
5. **Wire `darkHorseFirstDetection.js` into Cursor's `darkHorseFoh.js`** — adds first-seen timestamp + duration-alive to Dark Horse rendering (operator brief Lane 3).
