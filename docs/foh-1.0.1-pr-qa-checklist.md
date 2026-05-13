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
