# Dark Horse FOH.1.0.1 — v6 Prototype Gallery

Doctrine v6 — visual + translation + execution-clarity pass. All 10 operator-directed priorities applied.

📄 **PDF (recommended on iPad):** [`dh-foh-v6.pdf`](dh-foh-v6.pdf)
🖼️ **Full strip:** [`dh-foh-v6.png`](dh-foh-v6.png)

---

## 10 priorities — what changed vs v5

| # | Priority | v6 fix |
|---|---|---|
| 1 | 5-disc severity scale | Conviction now reads `🟢🟢🟢🟢⚫ 4/5 — High` with the inactive disc as `⚫` (never rainbow). Same scale on Market Mood: `🟠🟠🟠🟠⚫ 4/5 — Elevated`. Applied via `discScale(active, total, label, colour)` helper. |
| 2 | Abstract language removed | "half size" → "0.5 lot of your normal 1-lot trade"; "wider stops" → "give the trade more room — a tight exit-point is more likely to be hit before the move confirms direction"; "cleanest read" → "setups where price closes beyond the trigger level AND the next candle closes beyond it" |
| 3 | Dollar-first execution | Every action references dollar amounts first. "Reduce to 60%" now reads "If your normal risk is $500, reduce to ~$300". "Exit half" reads "Exit 0.25 lot of the original 0.5 (freeing ~$75)". |
| 4 | Colour-coded prices | `{{entry:1.0925}}` → green; `{{watch:1.0900}}` → yellow; `{{caution:1.0900 – 1.0880}}` → orange whole-sentence; `{{invalid:1.0875}}` → red; `{{money:$300}}` → gold. Applied inline throughout. |
| 5 | Terminology renames | `Horizon` → **Expected Duration** · `Whipsaw` → **Initial-direction reversal** · `Print` → **Announced result** · `Clean structure` → **Confirmed directional structure** |
| 6 | Consequence-based guidance | Every card now answers all 6 questions: What happened / Why it matters / What to do / Financial cost if wrong / What confirms the idea / What cancels the idea. |
| 7 | Tighter execution zones | Normal vol: 4-point band (1.0924–1.0928). Elevated vol: 15-point band kept. Conviction-aware band width. |
| 8 | Rendered chart cards | SVG ATLAS chart cards continued, using locked CLAUDE.md palette. |
| 9 | WHAT TO DO NOW | Every card carries a numbered ① ② ③ ④ ⑤ checklist with dollar amounts inline. |
| 10 | Hard boundary | No scoring / thresholds / scheduler / transport / Corey / Jane / Spidey / macro engine / Market Intel runtime / dashboard / renderer.js / ranking changes. |

---

## Direct answers to v5 screenshot annotations

| Operator note | v6 fix |
|---|---|
| "Include circles 🟠🟠🟠🟠" — Market Mood traffic-light + /5 | Market Mood now reads `🟠🟠🟠🟠⚫ 4/5 — Elevated` (4 active + 1 inactive disc). Conviction same scale with state colour. |
| "Position size — how much by in $$$ or what does it mean exactly" | Now reads: "If your normal risk per trade is $500 on a $10,000 account, reduce to ~$300 (60% of normal). On a $25,000 account, reduce from $1,250 to ~$750." |
| "Cleanest read, what does it mean exactly?" | Translated inline: "setups where price closes beyond the trigger level AND the next candle closes beyond it (the {{caution:confirmed directional structure}} test)" |
| "Do NOT chase already-extended moves. As in ?? Example?" | Example added inline: "NVDA at $940 after a $20 push from $920 is NOT a fresh entry. Wait for price to come back to a structural test (the floor that was the ceiling) — see the NVDA card below." |
| Horizon — "maybe rename predicted future" | Renamed to **Expected Duration** with `[Expected Duration](#term-expected-duration)` hyperlink |
| "Entry zone range way too large" | Tightened from `1.0920 – 1.0935` (15 points) to `1.0924 – 1.0928` (4 points) for normal-vol entry on the FRESH EURUSD candidate. Wider bands only when volatility justifies it. |
| "Make price same colour as watch level" | Watch level `1.0900` now renders YELLOW via `{{watch:1.0900}}` token in both the field value AND the chart card. |
| "Make whole caution zone sentence orange colour" | The entire CAUTION zone description sentence now wrapped in `{{caution:...}}` so it renders fully orange. |
| "Make invalidation 1.0875 red colour" | Invalidation price `1.0875` now renders RED via `{{invalid:1.0875}}` token throughout. |
| "Exit half ? Half what exactly?" | WHAT TO DO NOW step ④ now reads: "If 1.0900 closes below on 1H, exit half of your remaining position (0.25 lot of the original 0.5 — freeing ~$75) and hold the rest with the exit-point unchanged." |
| "Half sized what?" (XAUUSD) | Multi-zone "Action: SELL on that candle close — start with HALF your normal trade size" now translates: "if your normal trade is 1 lot, begin with 0.5 lot = ~$675 risk vs $1,350 normal" |
| "Explain the conviction" | Conviction field now carries: `🔴🔴🔴🔴⚫ 4/5 — High` followed by "_Why High: trigger level broke + sellers defended every retest across 2 cycles + momentum holding (3 of 4 criteria met)._" |
| "Predicted future not horizon" | Renamed Horizon to **Expected Duration** (operator alternative was "predicted future" — Expected Duration is the doctrine-locked replacement per Priority 5) |

---

## Per-section inline previews

### 1. Banner + Market Mood (5-disc) + ⭐ STANDOUTS + FRESH candidate

![Banner + fresh detail](dh-foh-v6-detail-banner.png)

### 2. FRESH candidate — EURUSD with all 10 priorities visible

![Fresh candidate detail](dh-foh-v6-detail-fresh-candidate-embed.png)

The doctrine-locked surface in full:
- `🟢🟢🟢🟢⚫ 4/5 — High` conviction with "Why High" explanation
- Trigger Level + Why it matters
- Expected Duration (renamed from Horizon)
- Multi-zone Where to Act with colour-coded prices
- 💲 Dollar risk this trade — half size for FRESH ($150 vs $300 normal)
- WHAT TO DO NOW — 5 numbered steps with dollar amounts
- What confirms the idea / What cancels the idea

### 3. STILL ACTIVE candidate — XAUUSD (cycle 2)

![Still active detail](dh-foh-v6-detail-still-active-candidate-embed.png)

Full size allowed for STILL ACTIVE (0.7 lot × Market Mood reduction = ~$945 risk). Conviction explanation: "trigger level broke + sellers defended every retest across 2 cycles + momentum holding."

### 4. FADING candidate — NVDA (quarter size)

![Fading detail](dh-foh-v6-detail-fading-candidate-embed.png)

Quarter size only (25 shares = ~$465 risk). Tight entry band 919–921. Late-stage caveat in caution-orange.

### 5. BUILDING + chart reference embed

![Reference card detail](dh-foh-v6-detail-reference-card-embed.png)

---

## Gate status

| Gate | Status |
|---|---|
| 1 — local-rendered Discord-style preview | ✅ this gallery |
| 2 — live Discord screenshots from staging | held — needs engine wire-up of v6 changes |

## Hard boundary preserved

No scoring / thresholds / scheduler / transport / Corey / Jane / Spidey / macro engine / Market Intel runtime / dashboard / renderer.js / ranking changes.

---

_Re-render with `node scripts/render_dh_foh_v6_preview.js`._
