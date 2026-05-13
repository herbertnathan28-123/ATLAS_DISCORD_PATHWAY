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
