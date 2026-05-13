# Dark Horse FOH.1.0.1 — v4 Prototype Gallery

Interim Gate-1 proof for the v4 build-order refinements on [PR #65](https://github.com/herbertnathan28-123/ATLAS_DISCORD_PATHWAY/pull/65). Every artefact below is viewable inline on any device — no download required.

For a universally portable view, use the PDF: [`dh-foh-v4.pdf`](dh-foh-v4.pdf).

v4 carries forward the operator-approved v3 visual direction (red NEW divider, gold section banners, teal terminology, state-coloured embeds, iPad-readable typography) and adds the build-order refinements:

- **Multi-zone Where to Act** — every candidate breaks into ENTRY / WATCH / CAUTION / INVALIDATION / Next review, each naming the level + the observation + the trader action
- **Candidate lifecycle states** — FRESH / STILL ACTIVE / FADING, each with its own red NEW BADGE header and distinct visual treatment
- **Market Mood traffic-light** with 5-rating + operational meaning + behaviour guidance
- **Quiet-scan "what would change the state"** block
- **No banned vague wording without context** — every "buyers defend" or "level fails" carries an explained zone + consequence + action

---

## 1. Banner + Market Mood — top of every scan

![Banner detail](dh-foh-v4-detail-banner.png)

Red NEW DARK HORSE SCAN divider, gold banner, italic scan summary (1 fresh, 1 still active, 1 fading), teal Expanded Terminology Hyperlinks, then the **Market Mood ELEVATED 🟡🟡🟡🟡 (4/5)** traffic-light section with plain-English meaning and trader behaviour guidance.

---

## 2. FRESH STANDOUT — EURUSD just appeared

![Fresh candidate detail](dh-foh-v4-detail-fresh-candidate-embed.png)

🆕 FRESH header. State-coloured green left bar. Multi-zone Where to Act:

- 🟢 ENTRY zone 1.0920 – 1.0935 — Healthy area; action: scale in
- 🟡 WATCH level 1.0900 — Caution trigger; action: hold, don't add
- 🟠 CAUTION zone 1.0900 – 1.0880 — Sellers gaining; action: scratch
- 🛑 INVALIDATION close below 1.0875 — Hard stop; action: exit, don't re-enter
- 🔵 Next review 12:15 UTC

---

## 3. STILL ACTIVE STANDOUT — XAUUSD in cycle 2

![Still active detail](dh-foh-v4-detail-still-active-candidate-embed.png)

🔁 STILL ACTIVE header. Bearish red left bar. Multi-zone Where to Act mirrors the bullish side (SELL on bounce-and-stall, RISK-OFF if floor reclaims).

---

## 4. FADING STANDOUT — NVDA mature, reduced conviction

![Fading detail](dh-foh-v4-detail-fading-candidate-embed.png)

🌅 FADING header. Orange state colour for late-stage caution. Conviction reduced to 🟠🟠🟠 (3/5). Multi-zone Where to Act + ⚠️ late-stage caveat row pinned beneath.

---

## 5. BUILDING + chart reference + risk reminder

![Reference card detail](dh-foh-v4-detail-reference-card.png)

Pre-radar (markets warming up), teal chips, and the **four-zone schematic** that anchors every candidate above. The card explicitly explains how to read the zones and notes that **rendered ATLAS chart snapshots will replace this schematic in the next evolution** (TRC-20260513-006).

---

## 6. Full top-to-bottom

![Full v4 prototype](dh-foh-v4.png)

If the strip is too tall for your viewer, switch to the PDF.

---

## Gate status

| Gate | Status |
|---|---|
| 1 — local-rendered Discord-style preview | ✅ this gallery |
| 2 — live Discord screenshots from staging | held — needs engine wire-up of v4 changes (operator approval required first) |

## Wire-up scope (held)

The v3 wire-up at commit `672552b` is the current state of `darkHorseFoh.buildDarkHorseFohPayload`. v4 changes (multi-zone Where to Act + lifecycle states + Market Mood traffic-light + quiet-scan "what would change the state") are NOT yet wired. Wire-up will follow operator visual sign-off on this v4 prototype.

## Hard boundary preserved

No scoring / thresholds / scheduler / transport / Corey / Jane / Spidey / macro / Market Intel runtime / dashboard / renderer / ranking changes.

---

_Re-render with `node scripts/render_dh_foh_v4_preview.js` from the repo root after `npm install`._
