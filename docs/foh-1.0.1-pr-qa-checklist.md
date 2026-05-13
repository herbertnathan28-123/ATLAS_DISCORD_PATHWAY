# FOH.1.0.1 — Dark Horse front-of-house rebuild · PR QA checklist

**Binding contract:** ATLAS Front-of-House Presentation Contract FOH.1.0.1.
**Branch:** `claude/resume-n8n-work-LdFVz`.
**Surface scope:** Dark Horse only. Macro / Market Intel / dashboard /
renderer / Corey / Jane / Spidey / Astra / scoring / thresholds /
scheduler / transport (other than payload-shape adaptation) are NOT
touched in this PR.

This document is the checklist filed against this PR in the form
required by Pack 8.

---

## Pack 8.1 — Send order

- [x] Dark Horse digest delivers in sequential webhook POSTs (Pack 2 —
  one embed per promoted candidate). No interleaving with other
  surfaces.
- [x] No auxiliary content posted after the final candidate message
  beyond the footer `next review` stamp baked into the last embed.

## Pack 8.2 — Embed hygiene

- [x] Embed colour matches doctrine for current state. See
  `darkHorseFoh.badgeColour` — maps every allow-list state badge to a
  Pack §0.1 hex value.
- [x] Title format follows Pack 2.2 exactly — `🐎 {SYMBOL} ·
  {STATE_BADGE}` where state badge is from the Pack 2.3 allow-list.
  See `darkHorseFoh.STATE_BADGE_VALUES` for the locked set.
- [x] All required Pack 2.2 fields populated (Move Type, Direction,
  Conviction, Timeframe). Trigger + Where to Act emit only when
  evidence-anchor data exists (otherwise candidate filtered out per
  Pack 2 — "if a field has no value, the candidate doesn't promote").
- [x] Zero empty fields with `pending` / `pending confirmation` /
  `unavailable` / `N/A` / `not online` / `not yet ready` /
  `coming soon`. Approved replacements per Pack 2.7 used only where a
  real pre-trigger state exists. The `sweepBannedWording` helper fires
  before any send.
- [x] Intensity values use colour-active-count format
  (`🟢🟢🟢 / 5 · Medium`). No filler dots, no empty circles, no
  inactive black circles. Asserted by `qa:dh-foh` T5.
- [x] Colour-coded text matching applied (§0.4): `Where to Act`
  field renders `🟢 ENTRY POINT: <level> · 🛑 STOP LOSS: <level>` with
  uppercase labels and colour-coded glyphs. Asserted by T10.
- [x] Footer carries scan timestamp; last embed carries `next review`
  stamp.
- [x] No backend/system labels in any visible string. Pack 8.4 banned
  set swept on every send.

## Pack 8.3 — Continuation text

Pack 8.3 covers Macro / Market Intel. This PR does NOT touch those
surfaces. The relevant rules nevertheless apply to Dark Horse banner
content:

- [x] Expanded Terminology Hyperlinks row appears under the banner
  (`[Breakout] [Retest] [Continuation] [Mover Stage 1]`).
- [x] Plain English, Level-1 readable throughout.
- [x] No retail fluff (no rockets, no "absolute fire", no "huge").
- [x] Glossary footer dump fully removed. The Dark Horse digest carries
  no glossary block in any message.

## Pack 8.4 — Banned wording (zero hits)

- [x] `BOS` → `structure break`. Sweep enforced in
  `darkHorseFoh.FOH_BANNED_PATTERNS`.
- [x] `CHoCH` → `trend shift`. Sweep enforced.
- [x] `pending` / `pending confirmation` / `confirmation pending` /
  `trigger pending` → replaced by `awaiting trigger`, `setup
  developing`, `trigger not completed`, `confirmation not completed`
  per Pack 2.7. Sweep enforced.
- [x] `unavailable` / `not online` / `not yet ready` / `coming soon` /
  `N/A` — none. Empty fields suppress.
- [x] `provider` / `cache` / `harvester` / `manifest` / `TwelveData` /
  `matcher` / `classifier` / `z-score` / `ATR percentile` /
  `fetch_run_id` — none. Sweep enforced.
- [x] Vague-action wording (`consider`, `watch for`, `monitor`, ...) is
  section-scoped per Pack §1.6 — does not apply to Dark Horse field
  values which use specific verbs (`Buy on retest of`, `Sell on retest
  of`).

## Pack 8.5 — Dark Horse specific

- [x] One embed per promoted candidate. Asserted by T3 + T4.
- [x] Embed colour matches candidate state. Asserted by T4 + classifier
  tests in T6.
- [x] `─── NEW ───` separator between candidates. Asserted by T3.
- [x] Chunking preserved — the FOH builder emits one Discord message
  per candidate; each message is independently size-guarded against
  Discord's 2000-char content / 6000-char embed limits.
- [x] Per-chunk footer label present (`{k}/{N} candidates` in each
  embed footer).
- [x] No glossary at end of digest. Banner has no `### Glossary`
  heading; per-candidate body has no glossary footer.
- [x] Sequential delivery: overall result `ok` only if every message
  posted. The engine fail-fast guard aborts the digest at the first
  non-ok send and does NOT arm cooldown.

## Pack 8.6 — Market Intel specific

Not applicable — Market Intel is out of scope for this PR.

## Pack 8.7 — Presenter QA fail-closed

- [x] `darkHorseFoh.sweepBannedWording` is the FOH-specific Presenter
  QA gate. On a banned-wording hit the engine logs
  `send_result=fail reason=banned_wording_sweep` and returns without
  arming cooldown. The fail-closed user-facing replacement string is
  the engine's existing behaviour (no message posted ⇒ next scan
  retries; no diagnostic strings reach the user channel).

## Pack 8.8 — Doctrine gates

Operator runs these on the same commit before merge. The engine path
preserves the cooldown contract (Pack 8.10 — no engine logic touched).

- [ ] `npm run doctrine:foundation`
- [ ] `npm run cache:verify`
- [ ] `npm run doctrine:production`
- [ ] `npm run qa:macro`
- [ ] `npm run qa:live-route`
- [ ] `npm run qa:discord-batch`
- [x] `npm run qa:darkhorse`
- [x] `npm run qa:dh-foh` — new harness (15 test groups).
- [ ] `npm run qa:market-intel` (N/A — Market Intel untouched)

## Pack 8.9 — Training capture hooks

- [x] New terminology surfaced via Pack 4 has Pack 4 entries
  approved style (Breakout, Retest, Continuation, Mover Stage 1 already
  exist in the approved set).
- [x] TRC- registry stub drafted for every new concept introduced
  by the FOH rebuild:
  - TRC-20260513-001 — State-badge allow-list
  - TRC-20260513-002 — Structure break vs trend shift
  - TRC-20260513-003 — Conviction colour-active-count scale
  - TRC-20260513-004 — Mover Stage 1 / 2 / 3
  - TRC-20260513-005 — Entry / stop colour-coded text matching
  See `docs/training-capture/TRC-foh-dark-horse.md`.
- [x] No new visual cards in this PR — the visual learning prototype
  was a separate lane (PR #64). Visual-card production routes through
  TRC- rows above.

## Pack 8.10 — Hard rules

- [x] No engine logic touched: `darkHorseRanking.js` enrichment +
  ranking surfaces are read-only consumers. Scoring, thresholds,
  scheduler, transport, cooldown, sanitiser hooks all preserved.
- [x] No doctrine bypass added.
- [x] No QA assertion weakened. `qa:darkhorse`, `qa:dh-radar`,
  `qa:dh-pre-radar`, `qa:dh-education` all still test the legacy
  `buildRankedMovementDigestPayload` text-shape path — that path is
  preserved as an exported function for unit tests even though the
  engine no longer routes through it for digest delivery.
- [x] No webhook URL or secret in any log line. Engine continues to
  route every webhook-bearing log through `_dhRedactWebhook`.
- [ ] PR description includes screenshots of:
  - Discord output (banner + per-candidate embeds)
  - Each state-badge example: STRONG BULLISH (green), STRONG BEARISH
    (red), DEVELOPING WATCH (yellow), MARGINAL · REDUCED CONVICTION
    (orange).

  _Operator-side: screenshots cannot be produced from this CLI
  environment. They will be attached when the operator triggers the
  digest path against the staging webhook._

## v4 build-order refinements (2026-05-13)

### Wording doctrine lock

- [x] Every important statement answers: what does that mean / why does it matter / what happens if it fails / how far is acceptable / when does it become dangerous / what is the hard invalidation / what should the trader do next.
- [x] No banned vague wording without explanation: `buyers defend`, `breakout level`, `holds`, `confirms`, `weakens`, `buy the dip`, `risk-off`, `setup valid`, `standing`, `read weakens`, `continuation window` — all paired with level + observation + action when used.

### Multi-zone Where to Act (Dark Horse v4)

- [x] Every candidate embed's `Where to Act` field is a multi-line value containing all of:
  - `🟢 ENTRY zone` — healthy area + trader action
  - `🟡 WATCH level` — caution trigger + trader action
  - `🟠 CAUTION zone` — danger sign + trader action
  - `🛑 INVALIDATION` — hard stop + trader action
  - `🔵 Next review` — reassess pointer

### Candidate lifecycle states

- [x] Each candidate carries a lifecycle state visible in its red NEW BADGE separator and embed title:
  - `🆕 FRESH` — first appearance
  - `🔁 STILL ACTIVE` — continuing from prior scan
  - `🌅 FADING` — older / late-stage, reduced conviction

### Market Mood traffic-light

- [x] Banner content carries a `▸ Market Mood` subheading with a traffic-light glyph + count-of-5 rating (e.g. `🟡🟡🟡🟡 (4/5) ELEVATED`).
- [x] Section includes "what it means right now" + "what this means for trader behaviour" + "why this rating, not lower or higher" blocks.

### Quiet-scan path

- [x] When no candidate makes the standout bar, the banner reads "Quiet cycle" + the pre-radar section names: what was scanned, what nearly qualified, what pressure is building, what would change the state, when to reassess.

### Market Intel FOH foundations (parallel lane)

- [x] Market Intel prototype script exists at `scripts/render_market_intel_foh_preview.js`.
- [x] Prototype renders 10 required sections:
  - Global Market Mood / Risk State (traffic-light)
  - Major Events Coming Up
  - Why These Events Matter
  - Possible Market Reaction Paths (IF/THEN)
  - What Traders Should Watch (pre / during / post)
  - Risk Escalation / Caution Zones (multi-zone)
  - Expanded Terminology Hyperlinks
  - Visual event/risk cards
  - Beginner-readable explanations
  - NO backend engine wiring (confirmed: no import of any Market Intel runtime)

### Acceptance artefacts (Gate 1)

- [x] Dark Horse v4: `docs/screenshots/dh-foh-v4.{png,pdf,html}` + per-section + detail crops + inline gallery `dh-foh-v4-gallery.md`.
- [x] Market Intel: `docs/screenshots/market-intel-foh-v1.{png,pdf,html}` + per-section + detail crops + inline gallery `market-intel-foh-v1-gallery.md`.

### Wire-up status (HELD)

- v3 wire-up of `darkHorseFoh.buildDarkHorseFohPayload` is on the branch (commit `672552b`).
- v4 changes are NOT yet wired. Wire-up requires operator visual sign-off on the v4 prototype.
- Market Intel runtime is NOT touched. Wire-up requires operator visual sign-off on the Market Intel prototype.

---

## v5 / MI v2 doctrine-escalation pass (2026-05-13 evening)

### Doctrine lock — six questions, every statement

- [x] Every major statement on every card / section answers all six:
  1. What does this mean?
  2. Why does it matter?
  3. What should I do?
  4. What happens if it changes?
  5. Risk in DOLLARS first, points second?
  6. Healthy vs Caution vs Danger vs Invalidation explicit?

### Dollar-first risk language

- [x] Every Dark Horse v5 candidate carries a `💲 Dollar risk this trade` field.
- [x] Every Market Intel v2 reaction path carries dollar-impact ranges (no pips-first).
- [x] Risk escalation zones carry dollar drawdown per zone.
- [x] Pip / point references appear ONLY as parenthetical context, never as the lead.

### Hyperlink stubs on unexplained terms

- [x] Dark Horse v5 hyperlinks: `Long ▲`, `Short ▼`, `Trigger Level`, `Risk-Off`, `Invalidation`, `Entry Zone`, `Watch Level`, `Caution Zone`, `Cycle Rank`, `Market Mood`, `Breakout`, `Pullback`.
- [x] Market Intel v2 hyperlinks: `CPI`, `hawkish`, `dovish`, `risk-on`, `risk-off`, `yield spread`, `VIX`, `DXY`, `front-end yields`, `initial-direction reversal`, `Market Mood`.
- [x] Anchor-slug form (`#term-slug`) until the glossary site is wired — Discord renders Markdown links in its native cyan link colour either way.

### NEW badge lifecycle (Dark Horse v5)

- [x] **FRESH** = solid red filled with white text (first-appearance this scan).
- [x] **STILL ACTIVE** = outlined red (1+ day, still trending).
- [x] **FADING** = outlined orange (late-stage / mature).
- [x] Renderer-side CSS (`.new-badge.badge-fresh / .badge-active / .badge-fading`). Discord-native text cannot fill backgrounds; full Discord delivery requires the rendered-card-image surface lane (TRC-20260513-006 family).

### Rendered ATLAS chart-card primitive

- [x] `scripts/_foh_renderer.js` exposes `renderChartCardSvg(spec)` that emits an SVG using the CLAUDE.md locked colour palette: `#00ff00` up candles, `#ff0015` down candles, `#131722` background, `#FFD600` HIGH (black text), `#00FF5A` CURRENT (black), `#FF9100` ENTRY (black), `#00B0FF` LOW (white).
- [x] Every Dark Horse v5 candidate embed carries a `chartCard` field (rendered inline above the field grid).
- [x] Market Intel v2 event card + event-day reference carry chart cards.
- [x] Prototype-only — real chart-snapshot wiring captured as TRC-20260513-006.

### Multi-colour FOH section hierarchy

- [x] 6-colour ANSI palette: GOLD (primary banners), CYAN (subheadings/references), MAGENTA (educational callouts), GREEN (healthy/valid), RED (danger/invalidation), BLUE (info/event context).
- [x] Section banners pick accent by purpose (BUILDING uses MAGENTA, RISK ESCALATION uses RED, reference cards use CYAN, MAJOR EVENTS uses BLUE, etc.) — not uniform gold.

### Market Intel v2 wording overhaul

- [x] "CPI prints" replaced with "CPI announced HIGHER / LOWER / IN-LINE with forecast" across every reaction path.
- [x] "Whipsaw" replaced with "Initial-direction reversal" + inline definition.
- [x] Reaction paths follow 4-outcome doctrine: HIGHER / LOWER / IN-LINE / CONFLICTING.
- [x] Every reaction path lists: affected markets · expected behaviour · dollar impact · what you should do (✘ + ✓ items).
- [x] "Cut size" guidance explains WHICH position, BY HOW MUCH, WHY (dollar-quantified).
- [x] "What Traders Should Watch" — every indicator row ends with concrete `Action:` instruction.

### Acceptance artefacts (Gate 1)

- [x] Dark Horse v5: `docs/screenshots/dh-foh-v5.{png,pdf,html}` + per-section + detail crops + inline gallery `dh-foh-v5-gallery.md` (13 artefacts).
- [x] Market Intel v2: `docs/screenshots/market-intel-foh-v2.{png,pdf,html}` + per-section + detail crops + inline gallery `market-intel-foh-v2-gallery.md` (16 artefacts).

### Wire-up status (HELD)

- v3 wire-up of `darkHorseFoh.buildDarkHorseFohPayload` is current on the branch.
- v4 + v5 changes are NOT yet wired. Wire-up requires operator visual sign-off on the v5 prototype.
- Market Intel runtime is NOT touched. Wire-up requires operator visual sign-off on the v2 prototype.

---

## v6 / MI v3 doctrine-v6 execution-clarity pass (2026-05-13 evening 2)

### 10 priorities applied across both lanes

- [x] **Priority 1 — 5-disc severity scale** on Conviction (DH) + Market Mood + Risk State + Event Intensity. Format: `🟢🟢🟢🟢⚫ 4/5 — High` / `🟠🟠🟠🟠⚫ 4/5 — Elevated` / `🔴🔴🔴🔴🔴 5/5 — Extreme`. Inactive disc always `⚫`. No rainbow inactive.
- [x] **Priority 2 — Abstract analyst language removed/translated.** "Half size" → "0.5 lot of your normal 1-lot trade". "Cleanest read" → "setups where price closes beyond the trigger level AND the next candle closes beyond it". "Wider stops" → "give the trade more room — a tight exit-point is more likely to be hit before the move confirms direction".
- [x] **Priority 3 — Dollar-first execution** on every Where to Act / risk-escalation / What to Do Now field. "$300 risk on $100k notional EURUSD" first, "30-point distance" only as parenthetical context.
- [x] **Priority 4 — Colour-coded prices** via `{{entry:X}}` `{{watch:X}}` `{{caution:X}}` `{{invalid:X}}` `{{money:X}}` tokens. CSS classes `.px-entry / .px-watch / .px-caution / .px-invalid / .px-money` on both field values and message content.
- [x] **Priority 5 — Terminology renames.** `Horizon` → `Expected Duration`. `Whipsaw` → `Initial-direction reversal`. `Print` → `Announced result`. `Clean structure` → `Confirmed directional structure`. Each carries a hyperlink stub.
- [x] **Priority 6 — Consequence-based guidance.** Every Dark Horse v6 candidate embed answers all 6 questions explicitly (What happened / Why it matters / What to do / Financial cost if wrong / What confirms / What cancels).
- [x] **Priority 7 — Tighter execution zones.** v6 EURUSD entry band 1.0924–1.0928 (4 points, normal vol). Expansion documented only for elevated vol.
- [x] **Priority 8 — Rendered chart cards** continued. SVG using locked CLAUDE.md palette on every candidate and the event-day reference.
- [x] **Priority 9 — Action translation layer.** Every Dark Horse v6 card carries a `WHAT TO DO NOW` field with ① ② ③ ④ ⑤ numbered steps, dollar amounts inline.
- [x] **Priority 10 — Hard boundary.** No engine touch. Both prototype scripts import only `_foh_renderer.js`.

### Acceptance artefacts (Gate 1)

- [x] Dark Horse v6: `docs/screenshots/dh-foh-v6.{png,pdf,html}` + 5 per-section + 5 detail crops + inline gallery `dh-foh-v6-gallery.md`.
- [x] Market Intel v3: `docs/screenshots/market-intel-foh-v3.{png,pdf,html}` + 7 per-section + 6 detail crops + inline gallery `market-intel-foh-v3-gallery.md`.

### Wire-up status (still HELD)

- v3 wire-up of `darkHorseFoh.buildDarkHorseFohPayload` is current on the branch.
- v4 + v5 + v6 changes are NOT yet wired. Wire-up requires operator visual sign-off on v6 prototype.
- Market Intel runtime is NOT touched. Wire-up requires operator visual sign-off on the MI v3 prototype.

---

## Pack 8.11 — Acceptance language (verbatim)

> Front-of-house presentation PR reviewed against FOH.1.0.1. Merge
> approval depends on screenshots, QA checklist completion, and zero
> engine-scope drift.

This PR does NOT reference the Phase D / Corey Clone / A9
production-complete acceptance line, does NOT imply doctrine-production
completion, does NOT introduce a parallel "presentation-complete" line,
and does NOT modify the doctrine gate.

---

_Drafted during the FOH.1.0.1 Dark Horse rebuild on branch
`claude/resume-n8n-work-LdFVz` against ATLAS Front-of-House
Presentation Contract FOH.1.0.1._
