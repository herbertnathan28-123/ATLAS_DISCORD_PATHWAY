# TRC- registry — Dark Horse FOH.1.0.1 rebuild

**Scope:** training-capture rows raised by the Dark Horse front-of-house
rebuild against FOH.1.0.1 (Pack 5 discipline — every new surface concept
flags at least one TRC- row).

**Status legend:** `flagged` · `drafted` · `built` · `approved`.

Rows are drafted in the schema specified by Pack 5.2. Routing to the
final store (Notion table, dashboard table, repo JSONL) is Astra's
responsibility per the handoff notes. Until then, this file is the
canonical artefact.

---

## TRC-20260513-001 — State-badge allow-list (Dark Horse FOH)

```json
{
  "id": "TRC-20260513-001",
  "topic": "Reading the Dark Horse state badge",
  "source_section": "Dark Horse · Candidate embed title",
  "why_it_matters": "The state badge is the five-second read on every candidate. STRONG BULLISH and BULLISH PRESSURE look similar but the difference between them is the difference between a high-conviction setup and an early-stage one — trade size and patience should change accordingly.",
  "trader_level": 1,
  "visual_needed": true,
  "example_chart_needed": true,
  "common_mistake": "Treating BULLISH PRESSURE the same as STRONG BULLISH and sizing in at full conviction before the structure is mature.",
  "suggested_module": "dark-horse-state-badge-101",
  "related_terminology": ["bias", "conviction", "trend", "breakout"],
  "status": "flagged",
  "created_at": "2026-05-13T03:22:00Z",
  "flagged_by": "cchat"
}
```

---

## TRC-20260513-002 — Structure break vs trend shift

```json
{
  "id": "TRC-20260513-002",
  "topic": "Structure break vs trend shift — what's actually different",
  "source_section": "Dark Horse · Move Type field + Pack 4 [Breakout] term",
  "why_it_matters": "A structure break confirms direction. A trend shift confirms that the OPPOSITE direction is now in play. Greenhorns conflate the two and end up shorting strength or buying weakness because the chart 'shifted' but they did not check which way.",
  "trader_level": 1,
  "visual_needed": true,
  "example_chart_needed": true,
  "common_mistake": "Reading a higher-low / higher-high sequence as a 'trend shift' when it's a continuation pattern — and entering against the trend.",
  "suggested_module": "structure-break-vs-trend-shift-101",
  "related_terminology": ["structure_break", "trend_shift", "trend", "continuation", "reversal"],
  "status": "flagged",
  "created_at": "2026-05-13T03:22:00Z",
  "flagged_by": "cchat"
}
```

---

## TRC-20260513-003 — Conviction colour-active-count scale

```json
{
  "id": "TRC-20260513-003",
  "topic": "Reading the conviction scale (🟢🟢🟢🟢 / 5)",
  "source_section": "Dark Horse · Conviction field + Pack §0.2",
  "why_it_matters": "The conviction value reads colour first, count second. A 🔴🔴🔴 / 5 line is a bearish conviction read — not a green-3 read with red filler. Reading the colour as decorative instead of meaningful is the most common interpretation mistake on the new format.",
  "trader_level": 1,
  "visual_needed": false,
  "example_chart_needed": false,
  "common_mistake": "Counting the dots and ignoring the colour. A 🔴🔴🔴🔴 / 5 read on a stop-loss surface means the bearish thesis is strong, not 'four green lights say go'.",
  "suggested_module": "conviction-scale-read-101",
  "related_terminology": ["conviction", "bias", "traffic_light_state"],
  "status": "flagged",
  "created_at": "2026-05-13T03:22:00Z",
  "flagged_by": "cchat"
}
```

---

## TRC-20260513-004 — Mover Stage 1 vs Stage 2 vs Stage 3

```json
{
  "id": "TRC-20260513-004",
  "topic": "Mover Stage 1 / 2 / 3 — where on the move are you?",
  "source_section": "Dark Horse · Move Type field (Stage 1|2|3)",
  "why_it_matters": "Mover Stage 1 carries the most reward and the most failure risk — the move is fresh. Stage 3 is mature; late-entry risk is high and the structural cycle is closer to a turn than a continuation. The stage is the trader's first cue on whether to size in or stand aside.",
  "trader_level": 1,
  "visual_needed": true,
  "example_chart_needed": true,
  "common_mistake": "Treating Stage 3 (late) as a continuation entry because the chart still 'looks bullish' — the move has already moved.",
  "suggested_module": "mover-stage-101",
  "related_terminology": ["mover_stage_1", "trend", "continuation", "reversal", "validity"],
  "status": "flagged",
  "created_at": "2026-05-13T03:22:00Z",
  "flagged_by": "cchat"
}
```

---

## TRC-20260513-005 — Where to Act — entry / stop colour-coded text matching

```json
{
  "id": "TRC-20260513-005",
  "topic": "Where to Act — entry / stop colour-coded text",
  "source_section": "Dark Horse · Where to Act field + Pack §0.4",
  "why_it_matters": "The Where to Act line is the only field that names concrete price levels. The colour coding (🟢 ENTRY / 🛑 STOP) carries the action meaning. Reading the levels without reading the colour can lead to placing the stop above the entry or entering at the stop price.",
  "trader_level": 1,
  "visual_needed": false,
  "example_chart_needed": true,
  "common_mistake": "Glancing at the levels and skipping the colour codes — placing a stop-loss order at the entry price.",
  "suggested_module": "entry-stop-colour-coding-101",
  "related_terminology": ["entry_point", "stop_loss", "invalidation_level", "conviction"],
  "status": "flagged",
  "created_at": "2026-05-13T03:22:00Z",
  "flagged_by": "cchat"
}
```

---

## TRC-20260513-006 — Rendered ATLAS chart-reference cards (NEXT EVOLUTION)

```json
{
  "id": "TRC-20260513-006",
  "topic": "Rendered ATLAS chart-reference cards — next evolution after FOH v3 wire-up",
  "source_section": "Dark Horse · Visual reference card lane",
  "why_it_matters": "The FOH v3 wire-up keeps the simplified ASCII chart art for the BUILDING / reference-card lane. The operator has flagged the next required evolution: replace the ASCII art with rendered ATLAS chart-reference images (real chart snapshots styled in ATLAS colours, with the breakout / retest / hold annotated visually). The simplified card carries the wire-up; the rendered card carries the long-term standard.",
  "trader_level": 1,
  "visual_needed": true,
  "example_chart_needed": true,
  "common_mistake": "Treating the simplified ASCII reference as the final form. The FOH v3 wire-up explicitly accepts the simplified card as an interim placeholder; final acceptance requires rendered ATLAS chart-reference cards in their place.",
  "suggested_module": "rendered-chart-reference-cards-v1",
  "related_terminology": ["breakout", "retest", "invalidation_level", "mover_stage_1", "trend"],
  "status": "flagged",
  "created_at": "2026-05-13T12:30:00Z",
  "flagged_by": "operator-via-claude-code",
  "scope_notes": "Pack 7 (visual learning card copy) defines the multi-surface card structure. Rendered ATLAS chart-reference cards extend Pack 7 by adding real chart imagery on the hero zone, replacing the ASCII art placeholder. The renderer.js stack is OFF-LIMITS for FOH (Pack 8.10 hard rule); a separate FOH-side image producer (puppeteer + ATLAS-styled HTML or canvas) should be designed for the reference cards. This is the next evolution after FOH v3 ships, NOT part of v3 wire-up."
}
```

---

## TRC-20260513-007 — Multi-zone "Where to Act" disclosure (Dark Horse v4)

```json
{
  "id": "TRC-20260513-007",
  "topic": "Multi-zone Where to Act — Entry / Watch / Caution / Invalidation discipline",
  "source_section": "Dark Horse · Candidate embed · Where to Act field",
  "why_it_matters": "Traders need to know not just where to enter, but exactly when to start being cautious, when to stand aside, and when the idea is hard-invalidated. The single-line BUY / RISK-OFF format hid that progression. The multi-zone form makes it explicit: ENTRY zone (action: BUY small) → WATCH level (action: hold, do not add) → CAUTION zone (action: scratch) → INVALIDATION (action: exit and do not re-enter). Each zone names a price level, what it means, and what the trader does.",
  "trader_level": 1,
  "visual_needed": true,
  "example_chart_needed": true,
  "common_mistake": "Reading only the entry level and treating everything else as ambient noise. Without the explicit zones, a trader holds onto a long position past the caution zone, into the danger zone, and stops out at the invalidation level. The multi-zone disclosure tells them to scratch the trade BEFORE invalidation.",
  "suggested_module": "multi-zone-trade-management-101",
  "related_terminology": ["entry_point", "stop_loss", "invalidation_level", "risk_management"],
  "status": "flagged",
  "created_at": "2026-05-13T14:00:00Z",
  "flagged_by": "operator-via-claude-code"
}
```

---

## TRC-20260513-008 — Candidate lifecycle states (FRESH / STILL ACTIVE / FADING)

```json
{
  "id": "TRC-20260513-008",
  "topic": "Candidate lifecycle states — how to read a NEW candidate vs an active vs a fading one",
  "source_section": "Dark Horse · per-candidate red NEW BADGE separator",
  "why_it_matters": "A fresh candidate (cycle 1) carries the highest reward potential and the most uncertainty. A still-active candidate (cycle 2–3) has held its structure across multiple scans and reads more reliably. A fading candidate is a stale mover where the easy reward has been earned — late-entry risk is high. Traders need to act on these differently: full size on FRESH only after the WATCH zone holds; reduced size on STILL ACTIVE; SKIP or half-size only on FADING.",
  "trader_level": 1,
  "visual_needed": true,
  "example_chart_needed": false,
  "common_mistake": "Treating a fading candidate the same as a fresh one. Sizing in full on NVDA on its 4th cycle is how traders give back gains — the move has already moved.",
  "suggested_module": "candidate-lifecycle-states-101",
  "related_terminology": ["mover_stage_1", "trend", "conviction", "late_entry_risk"],
  "status": "flagged",
  "created_at": "2026-05-13T14:00:00Z",
  "flagged_by": "operator-via-claude-code"
}
```

---

## TRC-20260513-009 — Market Mood traffic-light + 5-rating system

```json
{
  "id": "TRC-20260513-009",
  "topic": "Market Mood traffic-light — what 🟡🟡🟡🟡 (4/5) ELEVATED actually means for your trading",
  "source_section": "Dark Horse · Banner ▸ Market Mood subheading",
  "why_it_matters": "Volatility regimes change which trading style works. Calm markets reward tight stops and bigger size. Elevated/extreme markets punish tight stops and reward smaller size with wider stops. The 5-rating + operational meaning + behaviour-change block tells the trader in plain English what to do RIGHT NOW about position sizing, stop placement, and which setups to skip.",
  "trader_level": 1,
  "visual_needed": false,
  "example_chart_needed": false,
  "common_mistake": "Using the same position sizing and stop distance in elevated-vol conditions as in calm conditions. The trade idea was fine — the size and stop were not.",
  "suggested_module": "market-mood-trading-101",
  "related_terminology": ["volatility", "atr", "risk_management", "traffic_light_state"],
  "status": "flagged",
  "created_at": "2026-05-13T14:00:00Z",
  "flagged_by": "operator-via-claude-code"
}
```

---

## TRC-20260513-010 — Market Intel FOH foundations

```json
{
  "id": "TRC-20260513-010",
  "topic": "Market Intel FOH foundations — events / reaction paths / risk escalation",
  "source_section": "Market Intel · FOH prototype v1",
  "why_it_matters": "Market Intel is the second FOH lane (parallel to Dark Horse). It surfaces macro/event intelligence in a beginner-readable, operational form — what's coming, why it matters, what could happen, what to watch, and when to stand aside. Traders need ALL of these answered before a CPI print or central-bank decision so they don't trade into the chaos window blind.",
  "trader_level": 1,
  "visual_needed": true,
  "example_chart_needed": true,
  "common_mistake": "Trading through the T-0 print window because the chart 'looks good'. The print moment is where 50-100 pip whipsaws happen on dollar pairs. The chart that looked good at T-5 is meaningless at T-0.",
  "suggested_module": "macro-event-trading-windows-101",
  "related_terminology": ["central_bank", "hawkish", "dovish", "volatility", "yield_spread", "risk_on_off"],
  "status": "flagged",
  "created_at": "2026-05-13T14:00:00Z",
  "flagged_by": "operator-via-claude-code"
}
```

---

## TRC-20260513-011 — Wording doctrine lock (every important statement must answer)

```json
{
  "id": "TRC-20260513-011",
  "topic": "ATLAS wording doctrine — every important statement must answer 7 questions",
  "source_section": "Dark Horse + Market Intel · wording layer",
  "why_it_matters": "ATLAS communication standard: every statement must answer (a) what does that mean (b) why does it matter (c) what happens if it fails (d) how far is acceptable (e) when does it become dangerous (f) what is the hard invalidation (g) what should the trader do next. No more vague 'buyers defend' / 'breakout level' / 'holds' / 'confirms' without explained level + consequence + action. The doctrine is enforced by the multi-zone disclosure pattern across both Dark Horse v4 and Market Intel — every zone names a level, an observation, and an action.",
  "trader_level": 1,
  "visual_needed": false,
  "example_chart_needed": false,
  "common_mistake": "Writing 'bullish setup weakens' without telling the trader at what price level, what that means for their position, or what they should do about it. The reader is left guessing.",
  "suggested_module": "atlas-wording-doctrine-101",
  "related_terminology": ["invalidation_level", "structure_break", "risk_management"],
  "status": "flagged",
  "created_at": "2026-05-13T14:00:00Z",
  "flagged_by": "operator-via-claude-code"
}
```

---

## Suppression / promotion discipline (operator-side reference)

These rows are not in the per-row JSON registry but apply to every
trader-facing Dark Horse surface:

- **Empty fields suppress, never display.** Where a field would carry
  `pending`, `unavailable`, `N/A`, or `coming soon`, the field is dropped
  from the embed entirely. Pack 2.7 lists the approved replacements where
  a real pre-trigger state exists (`awaiting trigger`, `setup developing`,
  `trigger not completed`, `confirmation not completed`).
- **No glossary footer.** Pack 2.6 — glossary footer is banned from
  every Dark Horse surface. Definitions live in the Pack 4 terminology
  hyperlink rows under section headings, and in TRC-routed training
  modules.
- **No backend wording.** Pack 2.6 + Pack 8.4 — `BOS`, `CHoCH`,
  `provider`, `cache`, `harvester`, `manifest`, `TwelveData`, `matcher`,
  `classifier`, `z-score`, `ATR percentile`, `fetch_run_id` are all
  banned from user-facing strings. The `darkHorseFoh.sweepBannedWording`
  helper is the final guard; if it fires, the digest is aborted and
  cooldown is NOT armed.

---

_File maintained by Claude Code · created during the FOH.1.0.1 Dark
Horse rebuild on branch `claude/resume-n8n-work-LdFVz`._
