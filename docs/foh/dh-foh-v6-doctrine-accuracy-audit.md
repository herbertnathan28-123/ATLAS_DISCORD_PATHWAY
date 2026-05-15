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

## Minimum buffer price precision

Every price range must use the tightest structurally valid buffer, not a broad convenience zone. The FOH layer now derives an asset-aware precision profile for each card:

- FX non-JPY: 0.0001 tick, 2-pip base buffer.
- JPY FX: 0.01 tick, 2-pip base buffer.
- Gold: $0.10 tick, $1 base buffer.
- Silver: $0.01 tick, $0.03 base buffer.
- Indices: 0.25 tick, tick-aware 0.04% base buffer.
- Equities: $0.01 tick, tick-aware 0.05% base buffer.

Volatility may increase the minimum buffer, and when it does the card states why in `Source proof`.

Text levels, chart labels, dollar-risk, and reward-to-risk all use the same derived bands.

### Proof table

| Symbol | Direction | Decision Level | Entry Zone | Watch Level | Invalidation | Buffer Used | Why This Buffer | Dollar Risk | R:R | PASS/FAIL |
|---|---|---:|---|---:|---:|---:|---|---:|---:|---|
| GBPUSD | Bearish | 1.2759 | 1.2756-1.2762 | 1.2761 | 1.2767 | 0.0003 | FX: 2-pip minimum structural buffer x elevated volatility multiplier | $20 | 1.3R | PASS |
| GBPCAD | Bearish | 1.7459 | 1.7456-1.7462 | 1.7461 | 1.7467 | 0.0003 | FX: 2-pip minimum structural buffer x elevated volatility multiplier | $20 | 1.3R | PASS |
| US500 | Bullish | 5215.50 | 5213.00-5218.00 | 5214.25 | 5211.50 | 2.50 | Index: tick-aware 0.04% structural buffer x elevated volatility multiplier | $3 | 3.0R | PASS |
| GOOGL | Bullish | 190.56 | 190.44-190.68 | 190.00 | 188.68 | 0.12 | Equity: tick-aware 0.05% structural buffer x elevated volatility multiplier | $94 | 5.7R | PASS |

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

- `node scripts/test_dh_foh_qa.js` — doctrine and price precision gates
- `node scripts/preview_dh_foh_v6_live.js` — canonical v6 markers green
- `node scripts/test_dh_delivery_qa.js` — 36 passed / 0 failed
- Production-like GBPUSD/GBPCAD/US500/GOOGL audit — 0 banned hits, 0 Discord limit violations, authority fields present, FADING below-2R guard present, price-precision proof rows PASS
