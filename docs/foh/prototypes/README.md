# `docs/foh/prototypes/` — locked-spec PDFs

Drop the canonical FOH prototype PDFs here. Examples that have been
referenced outside this repository:

- `dh-foh-v5.pdf` — Dark Horse FOH v5 locked spec
- `dh-foh-v6.pdf` — Dark Horse FOH v6 locked spec (current target)
- `market-intel-foh-v2.pdf` — Market Intel FOH v2 locked spec
- `market-intel-foh-v3.pdf` — Market Intel FOH v3 locked spec
  (current target)

## How these inform the live code

The live formatter and semantic translator are reviewed against
whichever PDF the operator has marked as canonical for the
current cycle. A diff between the prototype's wireframes / wording
and the live preview produced by
`scripts/preview_dark_horse_digest.js` is the acceptance gate
for any FOH PR.

## Hard scope reminder

PDFs in this folder are not imported by the live path. They are
operator-facing planning artifacts only.
