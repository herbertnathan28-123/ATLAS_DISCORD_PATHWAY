# Market Intel FOH.1.0.1 — v1 Prototype Gallery

Parallel-lane FOH prototype for [PR #65](https://github.com/herbertnathan28-123/ATLAS_DISCORD_PATHWAY/pull/65). Every artefact below is viewable inline on any device — no download required.

For a universally portable view, use the PDF: [`market-intel-foh-v1.pdf`](market-intel-foh-v1.pdf).

Market Intel shares the ATLAS FOH foundations with Dark Horse:

- Dark theme + orange/gold section hierarchy
- Teal/light-blue Expanded Terminology Hyperlinks row
- Red NEW separators
- Strong readability on iPad / mobile
- Visual cards
- Beginner-readable wording
- Exact operational-consequence wording (every statement carries level + observation + consequence + action)

But Market Intel is **not** a movement radar. It expresses macro / event intelligence, global risk state, event hierarchy, upcoming catalysts, reaction paths, execution relevance, risk escalation, and what traders should monitor before / during / after events.

---

## 1. Banner + Global Market Mood + Major Events

![Banner + mood detail](market-intel-foh-v1-detail-banner-and-mood.png)

Red NEW MARKET INTEL divider (📡 macro briefing badge instead of Dark Horse's 🆕 stamp so the two surfaces are distinguishable at a glance in the same channel), gold MARKET INTEL — LIVE MACRO BRIEFING banner, teal Expanded Terminology Hyperlinks (CPI / Central Bank / Hawkish / Dovish / Risk-On/Off / Yield Spread), then the **Global Market Mood & Risk State** traffic-light section with rating, operational meaning, and "why this rating, not lower or higher" justification.

Below that, the **Major Events · Next 24 Hours** chronological list with time + name + impact dots + impact level.

---

## 2. Visual event card — US CPI

![CPI event card detail](market-intel-foh-v1-detail-cpi-event-card.png)

The Market Intel equivalent of a Dark Horse candidate embed — state-coloured (red HIGH-impact) left bar, country flag + event name + impact, plain-English summary, fields for **When / Impact / Affected Markets / What Traders Should Watch** with multi-line BEFORE / DURING / AFTER zone breakdown.

---

## 3. Possible Market Reaction Paths — IF / THEN scenarios

![Reaction paths detail](market-intel-foh-v1-detail-reaction-paths.png)

Four bold-gold ▸ subheadings (Hawkish surprise / Dovish surprise / In-line print / Whipsaw), each spelling out the expected market direction across affected pairs + the **trader read** explaining what setups gain or lose weight as a result.

---

## 4. Risk Escalation — multi-zone caution → danger → stand aside

![Risk escalation detail](market-intel-foh-v1-detail-risk-escalation.png)

The same multi-zone discipline as Dark Horse v4's Where to Act, but applied to **event-driven risk windows**:

- 🟢 HEALTHY pre-print
- 🟡 CAUTION T-5
- 🟠 DANGER T-0 to T+5
- 🛑 STAND ASIDE if both events surprise hawkish
- 🟢 RE-ENTRY T+5 onwards

Each zone names the time window + what happens + the action.

---

## 5. What Traders Should Watch + Event-Day Reference + Briefing Summary

![Watch + reference detail](market-intel-foh-v1-detail-watch-and-reference.png)

Pre-event indicators / during the event / post-event reassessment — all in plain-English bullets with concrete reference levels (DXY above 105, 2Y yield above 4.85%, VIX cuts). Followed by the **Event-Day Reference** schematic (the 4 windows on an event timeline) and the briefing summary.

---

## 6. Full top-to-bottom

![Full Market Intel prototype](market-intel-foh-v1.png)

---

## Sections checklist (all 10 from the build order)

| # | Required section | Where it lives |
|---|---|---|
| 1 | Global Market Mood / Risk State | Banner section — traffic-light + 5-rating + operational meaning |
| 2 | Major Events Coming Up | Banner section — chronological list with impact dots |
| 3 | Why These Events Matter | Banner section — bold-gold ▸ subheading + prose |
| 4 | Possible Market Reaction Paths | Message 3 — IF / THEN scenarios across 4 outcomes |
| 5 | What Traders Should Watch | Message 5 — pre / during / post indicators |
| 6 | Risk Escalation / Caution Zones | Message 4 — multi-zone block with time windows |
| 7 | Expanded Terminology Hyperlinks | Banner — teal/cyan chip row |
| 8 | Visual event/risk cards | Message 2 — CPI event card with state-coloured embed |
| 9 | Beginner-readable explanations | Throughout — every term either explained inline or chipped |
| 10 | NO backend engine wiring | Confirmed — script is self-contained, no Market Intel runtime imports |

## Gate status

| Gate | Status |
|---|---|
| 1 — local-rendered Discord-style preview | ✅ this gallery |
| 2 — live Discord screenshots from staging | held — no backend runtime wiring will start until operator approves the prototype visually |

## Hard boundary preserved

No scoring / thresholds / scheduler / transport / Corey / Jane / Spidey / macro engine / Market Intel runtime / dashboard / renderer / ranking changes. This prototype script does NOT import any Market Intel engine code.

---

_Re-render with `node scripts/render_market_intel_foh_preview.js` from the repo root after `npm install`._
