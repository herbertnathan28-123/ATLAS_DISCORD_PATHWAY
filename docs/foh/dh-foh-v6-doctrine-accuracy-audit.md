# Dark Horse FOH v6 — Doctrine Accuracy Audit

Status: DARK HORSE DOCTRINE AUDIT PATCH READY FOR REVIEW

## Audit result

The Dark Horse FOH card surface now states ATLAS doctrine explicitly:

- Dark Horse identifies mover candidates only.
- Dark Horse is not standalone execution authority.
- Every card publishes an `ATLAS execution state`.
- Every card publishes an `ATLAS confirmation gate`.
- Every card publishes `Source proof` tying text levels and chart labels to the same evidence-derived payload.

## Execution authority states

Cards may show:

- `EXECUTION CANDIDATE`
- `WAIT FOR CONFIRMATION`
- `REDUCED SIZE ONLY / NOT PRIMARY`

FADING cards with model reward-to-risk below 2R are not presented as normal execution trades. They are labelled reduced-size / not-primary and explain that the model R:R is below both:

- the 2R minimum for normal execution, and
- the ATLAS preferred 1:3 standard.

## Required confirmation gate

Each card states that execution still requires:

- market context supporting the direction,
- Decision Level,
- Entry Zone,
- Invalidation,
- candle-close confirmation,
- reward-to-risk suitability.

## Dollar-risk doctrine

Dollar amounts are presented first and are labelled as model/example risk, not personalised advice.

## Chart/source proof

The card text and PNG chart attachment both use the same evidence-derived card payload:

- Decision Level
- Entry Zone
- Watch Level
- Invalidation

The rendered chart labels remain proof-of-idea visuals, not decorative images.

## Language audit

The Dark Horse FOH banned-wording sweep rejects rough/non-doctrine terms including:

- prints
- Trigger Level / trigger
- broken level
- floor / ceiling
- reclaim / reclaimed
- fighting structure
- cleaner/better setup without criteria
- give the trade more room
- either side
- marginal setup
- late-stage caveat
- path of least resistance
- confirmed directional structure
- structural anchors

## Verification

- `node scripts/test_dh_foh_qa.js` — 148 passed / 0 failed
- `node scripts/preview_dh_foh_v6_live.js` — 116/116 markers green
- `node scripts/test_dh_delivery_qa.js` — 36 passed / 0 failed
- Production-like GBPUSD/GBPCAD/US500/GOOGL audit — 0 banned hits, 0 Discord limit violations, authority fields present, FADING below-2R guard present
