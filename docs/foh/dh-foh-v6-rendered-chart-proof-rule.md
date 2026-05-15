# Dark Horse FOH v6 — Rendered Chart Proof Rule

Status: FOLLOW-UP ISSUE UPDATED WITH RENDERED CHART PROOF RULE

Every important structural statement in a Dark Horse card must be visually shown on the rendered chart-card image, not left as text-only explanation.

## Global rule

If the card says something happened, the chart must help the trader see it.

Required visual proof labels include, where applicable:

- DECISION LEVEL
- ENTRY ZONE
- WATCH LEVEL
- INVALIDATION
- BREAK BELOW / BREAK ABOVE
- RETEST HELD
- FAILED RECLAIM
- LOWER HIGH / HIGHER LOW
- SELLERS DEFENDING / BUYERS DEFENDING
- CONFIRMED CLOSE

## Applies globally

This rule applies to every Dark Horse rendered chart card:

- FRESH cards
- STILL ACTIVE cards
- FADING cards
- FX
- indices
- equities
- commodities
- BUILDING / reference examples

## Visual teaching goal

The rendered chart must answer, visually:

- What level matters?
- What already happened?
- Where is the entry zone?
- Where is the warning level?
- Where is invalidation?
- What confirms the idea?
- What cancels the idea?

Use short mobile-readable callouts. Do not add paragraph text or clutter.

## Implementation note

The live FOH chart-card renderer now adds annotation metadata to candidate and reference chart specs, then renders callouts directly into the PNG attachment. The chart remains the same Discord attachment lane; the change upgrades it from a decorative price-band image into proof-of-idea teaching visual.
