# Dark Horse FOH — v6 Prototype Parity Matrix

**Restoration target:** `darkHorseFoh.js` (the live FOH embed path consumed when
`ATLAS_DH_FOH_LEGACY !== '1'`).

**Source of truth:** `/docs/screenshots/dh-foh-v6-*.png` (10 PNGs + the
gallery doc `dh-foh-v6-gallery.md` + the canonical prototype code at
`scripts/render_dh_foh_v6_preview.js`).

**Aliasing note (operator-confirmed):** the path
`/docs/prototypes/dark-horse-foh-v1/` is the intended archive folder but
is presently empty. For this restoration lane, `dh-foh-v6-*` is the
approved prototype set. Do not assume `dark-horse-foh-v1 == v6`
generally — only inside this lane.

---

## Headline

Commit `ea3d6ed darkhorse(foh-v6): port canonical v6 prototype into
production` was **a partial port**. The commit message labelled it "a
verbatim port of the Discord-renderable subset" but in practice it
shipped only the bare 6-field embed. Every rich surface from the
prototype — chart card, Market Mood, 5-disc Conviction, multi-zone
Where to Act, Dollar Risk, What This Means, WHAT TO DO NOW, What
Confirms / What Cancels, the reference card — was skipped.

This document is the audit before restoration code touches the
production embed builder.

---

## Section A — Message-level parity

| Prototype surface (per `render_dh_foh_v6_preview.js::SAMPLE_MESSAGES`) | Live `buildDarkHorseFohPayload()` today | Verdict |
|---|---|---|
| **M1** — Banner (red NEW divider, section banner, standout summary, Expanded Terminology Hyperlinks, Market Mood with 5-disc, dollars-first paragraph, STANDOUTS section banner, NEW BADGE for FRESH) + FRESH candidate embed | Banner content (`_bannerContent`) ships a short divider + minimal summary, no Market Mood block, no terminology row, no dollars-first paragraph. First candidate embed = simplified `_candidateEmbed`. | **FAIL** |
| **M2** — NEW BADGE `STILL ACTIVE  ·  STANDOUT #2 of 3` + still-active candidate embed | NEW BADGE present (`STANDOUT #N of M`) but missing the lifecycle label (`FRESH` / `STILL ACTIVE` / `FADING` / `BUILDING`). Embed = simplified `_candidateEmbed`. | **PARTIAL** |
| **M3** — NEW BADGE `FADING  ·  STANDOUT #3 of 3` + fading candidate embed | Same as M2. No lifecycle-aware badge. | **PARTIAL** |
| **M4** — BUILDING + chart-reference card embed (educational reference example with chart card, "The story", "How a trader acts (concrete, dollars-first)", "Rendered ATLAS chart cards — next evolution") | **Not emitted.** No reference-card message exists on the live path. | **FAIL** |
| **M5** — Briefing summary + risk reminder tail (sub-headings, per-standout summaries with dollar amounts and R multiples, next-scan stamp) | Tail content (`_tailContent`) ships a short risk-reminder paragraph only. No briefing summary, no per-standout dollar/R summaries. | **PARTIAL** |

**Net:** 0/5 messages at PASS parity. 2 PARTIAL, 2 FAIL, 1 FAIL.

---

## Section B — Per-candidate embed parity

Prototype shape, field by field, vs. live `_candidateEmbed(record, idx, total, isLast, opts)` at `darkHorseFoh.js:351`.

| Prototype field | Live emits today | Data needed | On record today? | Verdict |
|---|---|---|---|---|
| **Title** — `🐎  EURUSD  ·  STRONG BULLISH` | ✅ `🐎  ' + symbol + ' · ' + stateBadge` | symbol + stateBadge | Yes | **PASS** |
| **Color stripe** — green/red/orange/blue per state | ✅ `_badgeToColor` | stateBadge | Yes | **PASS** |
| **Description** — narrative sentence ("Price pushed above 1.0950 — a level that had capped EURUSD for the last 3 weeks — and held the level cleanly on the 1H close…") | Partial — `_description` exists but is generic, not narrative | Structural context: prior-cap duration, breakout timeframe close, time-since-break | Partial — `evidenceAnchors.recentHigh` gives `dateUtc` + price; not the prior-cap duration narrative | **PARTIAL** |
| **`chartCard`** — full rendered SVG/PNG of price action with HIGH/CURRENT/ENTRY/LOW labels + entry band + watch + invalidation overlays | **Not emitted.** Hook unconsumed. SVG renderer exists in `scripts/_foh_renderer.js::renderChartCardSvg` but is preview-only. | candles[], currentPrice, highPrice, lowPrice, entryHigh/entryLow, watch, invalidation, direction, caption | Candles: **No** (stripped after ranking — `candleProvider` discards). High/low: derivable from `evidenceAnchors.recentHigh/recentLow`. Entry/watch/caution: **No.** Invalidation: yes (`evidenceAnchors.invalidation.price`). | **FAIL — BLOCKED on B8** |
| **Move Type** (inline) — `Breakout · early stage` | ✅ `moveType(record) + ' · Mover Stage ' + moverStage(record)` | moveType + movePhase | Yes (`record.movePhase`) | **PASS** |
| **Direction** (inline) — `[Long ▲](#term-long) — expecting price to keep moving up` | Partial — `directionField` returns `Long ▲` / `Short ▼` but no terminology link, no narrative tail | direction + terminology link map + per-direction narrative | direction: yes. Link map: routed via `opts.terminologyUrls` (currently null). Narrative tail: derivable. | **PARTIAL** |
| **Conviction** (full width) — `🟢🟢🟢🟢⚫ 4/5 — High\n_Why High: trigger level broke + momentum increased + retest held + the broken level is now defended by buyers (all 4 criteria met)._` | Partial — `convictionScale(record.score, stateBadge)` exists, emits glyph but uses old syntax not 5-disc. Inline, not full-width. No "Why High" reasoning. | active/5 (computed from score), state-coloured disc glyph, "Why" reasoning (the 4 scoring criteria broken out) | score: yes. disc syntax: needs `discScale()` helper from `_foh_renderer.js`. Why-reasoning: partially `record.scoreBreakdown` (currently `candidate.reasons` array — but format unknown). | **PARTIAL — BLOCKED on B9** |
| **Trigger Level** (inline) — `[Trigger Level](#term-trigger-level): **1.0950**\n_Why it matters: 1.0950 capped every push for 3 weeks._\n_It has flipped from ceiling into floor — price now treats it as Support._` | Partial — `_triggerLevelValue(record)` emits the price text only | trigger price + "Why it matters" structural narrative + ceiling-floor flip line | Price: `evidenceAnchors.recentHigh.price` (long) or `recentLow.price` (short). Narrative: **No.** | **PARTIAL — BLOCKED on B10** |
| **Expected Duration** (inline) — `[Expected Duration](#term-expected-duration): Swing — days, not minutes` (renamed from Horizon) | Live emits "Horizon" not "Expected Duration". Section-conditional ternary `Hours, not days` vs `Days, not minutes` is roughly the same logic. | Renamed field + terminology link | Section: yes. Rename: trivial. Link: needs URL map. | **PARTIAL** |
| **Today's Rank** (inline) — `[Cycle Rank](#term-cycle-rank): 1st of today's 3 standouts` | Live emits ordinal but no terminology link | idx + total + ordinal helper + link map | Yes | **PARTIAL** |
| **Where to Act** (full width, multi-zone) — 4 zones × 6 lines each: 🟢 ENTRY band + behaviour + required price action + dollar-stamped action; 🟡 WATCH + drawdown estimate + action; 🟠 CAUTION + position cost + action; 🔴 Invalidation + full-risk-taken stamp + exit instruction; + 🔵 Next review timestamp | Live `_whereToActValue(record)` emits a single text blob, no zones, no dollar stamps. | entryLow, entryHigh, watch, caution, invalidation, dollarRiskPerLot, lotEquivalent, lotReduced, dollarReduced, plannedDollarRisk, nextReviewStamp, direction | Invalidation: yes. Entry/watch/caution: **No.** Dollar amounts: **No.** Lot/contract size: **No.** | **FAIL — BLOCKED on B8 + B11** |
| **💲 Dollar risk this trade** (full width) — multi-line, FRESH/STILL ACTIVE/FADING variants × lifecycle × Market Mood reduction with concrete dollar amounts and reward-target line | **Not emitted.** Field does not exist on live path. | entry_price, exit_price, contract_size, position_size, market_mood_multiplier, reward_target | Entry/exit prices: **No.** Contract size: **No** (needs a per-symbol `CONTRACT_SIZE` map per Nathan's formula). Mood multiplier: **No** (needs `volatility`-based derivation). | **FAIL — BLOCKED on B8 + B11** |
| **What this means** (full width) — 1-sentence directional thesis with embedded colour tokens | **Not emitted.** | Direction + invalidation + entry-band reference | Derivable from existing data | **FAIL** |
| **WHAT TO DO NOW** (full width) — ① to ⑤ numbered steps with inline dollar amounts | **Not emitted.** | All Where-to-Act data + position-size doctrine + invalidation price | Same as Where to Act + Dollar Risk dependencies | **FAIL — BLOCKED on B8 + B11** |
| **What confirms the idea** (full width) — narrative confirming the directional structure test | **Not emitted.** | Direction + entry-band high/low | Same as entry/watch | **FAIL — BLOCKED on B8** |
| **What cancels the idea** (full width) — narrative invalidation behaviour | **Not emitted.** | Invalidation price + direction | Yes | **FAIL** |
| **⚠️ Late-stage caveat** (full width, FADING only) — quarter-size reminder | **Not emitted.** | movePhase === 'late' / 'exhaustion' | Yes (`record.movePhase`) | **FAIL** |
| **Footer** — `ATLAS · Dark Horse · standout 1 of 3 · first detected at this scan (Tuesday 13 May · 12:00 UTC)` | Live emits `next review HH:MM UTC` only on the last embed. No "standout N of M" line, no "first detected at this scan" line. | idx, total, scan stamp, lifecycle | Yes | **PARTIAL** |

**Net:** 2/17 fields at PASS, 7 PARTIAL, 8 FAIL.

---

## Section C — Reference-card embed (M4)

| Prototype field | Live emits | Verdict |
|---|---|---|
| Title `📚  Clean Bullish Breakout — Reference` | Not emitted | **FAIL** |
| Description sentence | Not emitted | **FAIL** |
| `chartCard` (reference pattern, not a live symbol) | Not emitted | **FAIL** |
| `The story` field | Not emitted | **FAIL** |
| `How a trader acts (concrete, dollars-first)` field | Not emitted | **FAIL** |
| `Rendered ATLAS chart cards — next evolution` field | Not emitted | **FAIL** |

**Net:** entire reference message missing. 0/6.

---

## Section D — Token rendering (colour doctrine)

The prototype emits inline tokens that the renderer turns into coloured
spans. Tokens used in `SAMPLE_MESSAGES`:

| Token | Colour | Live path supports? |
|---|---|---|
| `{{entry:...}}` | green (#00FF5A on chart card, themed in body) | **No** — tokens would render as literal `{{entry:1.0925}}` in Discord |
| `{{watch:...}}` | yellow (#FFD600) | **No** |
| `{{caution:...}}` | orange (#FF9100) | **No** |
| `{{invalid:...}}` | red (#FF0015) | **No** |
| `{{money:...}}` | gold | **No** |

Discord embeds do not support arbitrary inline colouring inside field
values — only the embed's outer colour stripe is themed. The prototype
gets colour by rendering the message through `scripts/_foh_renderer.js`
into an HTML/PNG (Discord-style preview). In production Discord, the
tokens need to be **stripped or translated** before send.

Options for production token handling:
- **D1.** Strip tokens to plain text (`{{entry:1.0925}}` → `1.0925`).
  Loses colour, keeps content. Simplest.
- **D2.** Translate tokens to Discord-renderable markdown
  (`{{watch:1.0900}}` → `**1.0900**` for emphasis; emojis for state
  prefixes). Partial colour analogue.
- **D3.** Render the entire card to a PNG image (chartCard already does
  this) and attach. Skips the embed entirely for the visual portion.

**Recommendation:** D1 for body text + D3 for the chart card image.
The outer embed colour stripe + per-section emoji prefixes
(🟢/🟡/🟠/🔴/💲) already carry the colour semantics for the body.

---

## Section E — BLOCKED list (need Nathan's call before code)

### B8 — Entry / Watch / Caution band derivation

The prototype hard-codes tight entry zones, watch levels, and caution
bands per candidate (EURUSD: entry 1.0924–1.0928, watch 1.0900, caution
1.0890–1.0880, invalidation 1.0875). These do **not** exist on the live
`record` flowing into FOH today. Hard-boundary constraint says no
ranking changes.

Choose:
- **B8.a — Derive in FOH.** Inside `darkHorseFoh.js`, compute
  `entry = trigger ± entryHalfBand` where `entryHalfBand` is
  conviction-aware (4 pts normal, 15 pts elevated per Priority 7). Watch
  = invalidation + watchOffset. Caution band = midpoint
  between watch and invalidation. No ranking touch. **Risk:** derived
  levels may not match operator intent on edge cases (asymmetric
  ranges, gapped levels).
- **B8.b — Extend `buildEvidenceAnchors`** in `darkHorseRanking.js` to
  emit `entryZone`, `watchLevel`, `cautionZone` alongside the existing
  `recentHigh / recentLow / invalidation`. Cleaner architecture, but
  technically a ranking-layer change.
- **B8.c — Static per-symbol rules in FOH.**
  `BAND_RULES[symbol] = { entryHalfBand: ..., watchOffset: ..., cautionOffset: ... }`.
  Brittle but explicit.

### B9 — Conviction "Why High" reasoning

The prototype shows 4 criteria spelled out:
"trigger level broke + momentum increased + retest held + the broken
level is now defended by buyers (all 4 criteria met)." The live record
has `scoreBreakdown` = `candidate.reasons` (array, format unknown).

Choose:
- **B9.a** — Use `record.scoreBreakdown` directly if it's already a
  per-criterion array.
- **B9.b** — Translate `record.scoreBreakdown` into the doctrine's
  4-criterion shape via a translation map in FOH.
- **B9.c** — Static template based on `record.movePhase` only (loses
  per-trade specificity).

### B10 — Trigger Level "Why it matters" narrative

Prototype: "1.0950 capped every push for 3 weeks. It has flipped from
ceiling into floor — price now treats it as Support." Requires knowing
how long the level capped/floored price. The live `evidenceAnchors`
only has the current 1D extreme — no multi-week structural lookback.

Choose:
- **B10.a** — Honest static narrative ("the most recent significant
  level the move broke through"); loses the "3 weeks" specificity.
- **B10.b** — Add a lookback-period field in ranking
  (`record.priorCapDuration` = bars between current trigger and the
  previous opposite-side touch). Small ranking touch.
- **B10.c** — Drop the "Why it matters" line until the lookback is
  wired (parity gap accepted).

### B11 — Contract size + position size doctrine map

Per Nathan's formula: FX standard lot = 100,000; XAUUSD = 100 oz; US
equities = number of shares; unknown → "Dollar risk unavailable — contract
size not mapped." This needs a new static map in FOH:

```javascript
const CONTRACT_SIZE = {
  // FX majors / crosses: 100,000 base-currency units per standard lot
  EURUSD: { unit: 'lot', size: 100000, pipValueUsd: 10 /* @ 1.0 quote */ },
  // XAUUSD: 100 oz per standard lot, $/oz
  XAUUSD: { unit: 'lot', size: 100, pipValueUsd: 1   /* $1 / $0.01 move */ },
  // US equities: per-share, sized in shares
  NVDA:   { unit: 'shares', size: 1, perSharePoint: 1 },
  // … to be extended to the full DH_UNIVERSE
};
```

Choose:
- **B11.a** — Hard-code the full `DH_UNIVERSE` map (32 symbols) in FOH
  with Nathan's doctrine values. Easy to extend later.
- **B11.b** — Punt and emit "Dollar risk unavailable — contract size
  not mapped" for every symbol until the map is curated. Compliant
  with directive but loses the field for v0 ship.
- **B11.c** — Hybrid: ship `EURUSD`, `XAUUSD`, `NVDA` (prototype trio)
  initially and grow the map per-cycle.

### B12 — Position size doctrine

Per the gallery + prototype:
- FRESH = 0.5 × standard size
- STILL ACTIVE = full size × Market Mood multiplier
- FADING = 0.25 × standard size
- Market Mood: Elevated × 0.30, High/Extreme × 0.20

Two questions inside this:
- **B12.a** — Confirm the FRESH / STILL ACTIVE / FADING lifecycle
  classification source. The live record has `record.movePhase` (early/
  mid/late/exhaustion) but no FRESH/STILL ACTIVE/FADING field. Need to
  map phase → lifecycle OR add the field.
- **B12.b** — Confirm Market Mood reading source. Today the FOH path
  receives `volatility` from the engine — is `volatility.regime`
  (Calm / Elevated / High / Extreme) sufficient, or do we need a
  separate mood map?

### B13 — Image transport mechanics

Nathan-confirmed: multipart attachment to the Discord webhook, mirroring
the existing macro grid path in `index.js`. This needs:

- **B13.a** — Renderer module: graduate `scripts/_foh_renderer.js::renderChartCardSvg`
  into a production helper at `dhChartCard.js` (or similar) that returns
  PNG bytes via `sharp(svgString).png().toBuffer()`. The macro grid
  uses puppeteer; SVG → sharp is simpler and faster.
- **B13.b** — Send-loop: today `darkHorseEngine.js` posts the FOH
  payload via the standard Discord posting helper. That helper needs to
  accept an `attachments` array. Either pass through `discord_output.js`
  or replicate the multipart-form-data pattern from `index.js`.
- **B13.c** — Fallback: if the renderer throws or returns null, the
  embed should ship **without** the chart card (graceful degrade), not
  with a placeholder image.

### B14 — PR #71 (v1.4) and PR #72 (v2.0) status

- **PR #71** (`darkhorse(foh-v1.4): visual primitives`) was merged into
  this branch at `c5fd41c`. It edits `darkHorseFohFormatter.js` —
  the legacy fallback path (`ATLAS_DH_FOH_LEGACY=1`). It is inert on
  the live path. **Recommend: leave merged.** It's harmless.
- **PR #72** (v2.0 operator psychology) edits the same legacy path with
  the compact-footer / supporting-detail compression. The brief
  explicitly rejects "compressed-card reinterpretation." **Recommend:
  close PR #72 without merge** since v2.0 work is on the wrong file
  and the wrong design direction.

Choose:
- **B14.a** — Leave PR #71 merged + close PR #72.
- **B14.b** — Revert PR #71 + close PR #72 (clean slate on the legacy
  path).
- **B14.c** — Leave PR #71 merged + keep PR #72 draft for later (in
  case the legacy path needs polish someday).

---

## Section F — Restoration lanes (proposed sequencing)

After Nathan answers Section E, implementation breaks into 6 lanes.
Each lane is one PR; each PR carries staged screenshot proofs before
deploy approval.

| Lane | Files | Risk | Estimated session count |
|---|---|---|---|
| **L1 — Data plumbing** | depends on B8: `darkHorseFoh.js` only (B8.a / B8.c) or `darkHorseRanking.js::buildEvidenceAnchors` (B8.b). Also: contract-size map (B11), lifecycle map (B12.a). | Low — additive only | 1 |
| **L2 — Chart-card renderer** | `dhChartCard.js` new module (lift `renderChartCardSvg` + `sharp` PNG output). Standalone helper. | Low — pure function | 1 |
| **L3 — Embed builder rewrite** | `darkHorseFoh.js` — rewrite `_candidateEmbed` to emit the full v6 field set; rewrite `_bannerContent` for Market Mood block; add `_referenceCardEmbed` for M4; rewrite `_tailContent` for the briefing summary. | Medium — visual + content + size guards | 2 |
| **L4 — Token translation** | `darkHorseFoh.js` — token stripper / translator (decision D in Section D). | Low | 0.5 |
| **L5 — Transport wire-up** | `discord_output.js` + `darkHorseEngine.js` — multipart attachment for chart-card PNG. Mirror `index.js` macro-grid pattern. | Medium — touches live send path | 1 |
| **L6 — QA + staging proofs** | `scripts/test_dh_foh_qa.js` — promote to pipeline; new staging script that posts to a private test channel; pin v6 expected field set in tests. | Low | 1 |

**Total:** ~6.5 sessions of focused work. Each lane gets its own draft
PR with staging proofs before merge.

---

## Section G — Hard rule honoured

> "Hard rule: If anything from the prototype cannot be implemented,
> list it as BLOCKED before coding. Do not silently substitute."

Every prototype surface is either PASS, PARTIAL with the gap stated, or
FAIL with the BLOCKED reason in Section E. No silent substitutions are
proposed in this matrix.

> "No live deploy until Nathan / Astra approve visual parity."

Section F is gated on per-lane staging screenshots. No lane proceeds to
deploy without Nathan's sign-off on the staged PNG.

---

## Section H — Awaiting checkpoint

This matrix is the artifact for Nathan to review before any production
code touches `darkHorseFoh.js`. Specifically requesting decisions on:

- **B8** (entry/watch/caution derivation strategy)
- **B9** (Conviction "Why High" source)
- **B10** (Trigger "Why it matters" narrative)
- **B11** (contract-size map scope)
- **B12** (lifecycle + Market Mood mapping)
- **B13** (transport mechanics, mostly confirmed — needs renderer-module
  approval)
- **B14** (PR #71 / #72 disposition)
- **D** (token rendering strategy — D1 strip / D2 translate / D3 PNG)

Once these land, L1 starts. Not before.
