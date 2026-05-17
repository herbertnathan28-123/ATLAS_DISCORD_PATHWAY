# ATLAS FX — Market Intel FOH Daily Roadmap Correction

Status: implementation work order
Date: 17 May 2026 AWST
Owner: Cursor / production Market Intel path

## Context

Live logs confirm the Market Intel engine path is operational. The remaining failure is the rendered Discord/FOH presentation.

Confirmed live path:

- TradingView calendar is LIVE
- `source_used=tradingview`
- `calendar_raw_count=86`
- `next72_count=43`
- `clusters=10`
- `primary_event=GDP Growth Rate QoQ Prel`
- `risk_state=EXTREME`
- Corey Clone ran but returned `BLOCKED / usableForDecision=false`
- Spidey returned `PARTIAL`
- Jane returned `MONITORING`
- FOH rendered
- Discord send succeeded
- `attachments=7`
- `report_id=mi-ffc3f5ab`

Engine chain is alive. Do not reopen Corey / Corey Clone / Spidey / Jane unless a runtime failure appears.

## Current FOH problem

The current Daily Roadmap output is technically functional but visually weak:

- It reads like a plain Discord paragraph dump.
- `THE CALL` is not visually dominant.
- The approved calendar-first design is not clearly visible near the top.
- Risk state is just text instead of a useful trader panel.
- Market Impact is dense paragraph text.
- Raw `DXY` / `VIX` wording is still visible in user-facing output.
- Full Brief links are not obvious enough.
- Thumbnail/image attachments feel secondary instead of integrated.

## Required correction

### 1. Keep engine path intact

Do not modify the engine chain for this FOH pass.

Allowed focus:

- FOH layout
- Discord text structure
- Market Intel Daily Roadmap rendering
- terminology display mapping
- Full Brief link visibility

Do not touch:

- Corey decision logic
- Corey Clone gating
- Spidey structure logic
- Jane synthesis logic
- scheduler routing
- provider adapters

### 2. `THE CALL` must lead visually

The first visible block must be the operational read.

Required structure:

```text
🔥 THE CALL
Primary focus:
Risk state:
Current read:
Best action:
Next confirmation point:
```

Because Jane returned `MONITORING`, the output must say:

```text
MONITORING — no confirmed execution read yet.
Wait for the first confirmed candle / event-window close before treating direction as reliable.
```

FOH must not upgrade `MONITORING` into execution authority.

### 3. Restore calendar-first layout

After `THE CALL`, show the ranked event calendar:

```text
TIME | CCY | IMPACT | EVENT | AFFECTED MARKETS | FULL BRIEF
```

This is the approved Discord control-surface model.

### 4. Replace paragraph walls with cards

Replace dense prose sections with short blocks:

- What is happening
- Why it matters
- What moves first
- What confirms it
- What weakens it

### 5. Apply terminology doctrine immediately

User-facing output must not lead with raw `DXY` or `VIX`.

Wrong:

```text
DXY directional bias Bullish.
VIX Elevated.
DXY/VIX confirm after first 15-minute close.
```

Correct:

```text
US Dollar Strength (DXY) is bullish.
Market Volatility (VIX) is elevated.
US Dollar Strength (DXY) and Market Volatility (VIX) confirm after the first 15-minute close.
```

Internal logs may keep `DXY` / `VIX`. User-facing FOH must use plain-English first.

### 6. Risk state needs a visual panel

Required pattern:

```text
RISK STATE
🔴🔴🔴🔴🔴 / 5 — EXTREME

Why:
Clustered release windows detected inside the Tokyo session.

What this means:
The first reaction can bleed into the next release. Direction is not reliable until confirmation.
```

### 7. Full Brief links must be obvious

Do not bury linked deep-dives below thumbnail attachments.

The Daily Roadmap should clearly show:

```text
Full Brief
```

next to each ranked event row.

### 8. Three-message model remains locked

Do not return to the old multi-message wall.

Daily Brief structure remains:

1. Message 1 — `THE CALL` + ranked calendar + key risk windows
2. Message 2 — Market Impact + affected markets + confirmation/degradation
3. Message 3 — Forward planning + Full Brief links

## Acceptance

Accepted when:

- Output feels like ATLAS, not a generic Discord dump.
- `THE CALL` leads visually.
- Ranked calendar appears near the top.
- Raw `DXY` / `VIX` is removed from user-facing text.
- Jane `MONITORING` state is respected.
- No hard historical/probability claim appears while Corey Clone is `BLOCKED`.
- No execution authority appears while Spidey is `PARTIAL` and Jane is `MONITORING`.
- Full Brief links are obvious.
- Discord send still succeeds.

## Prototype note

The uploaded HTML prototypes in `docs/prototypes/market-intel/` are reference surfaces only. They still require runtime wiring and terminology cleanup before production use.
