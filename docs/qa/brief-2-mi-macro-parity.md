# Brief 2 MI + Macro parity QA

Date: 2026-05-15
Branch: `feature/brief-2-mi-macro-parity` -> `main`

## Implementation path

Manual patch application was abandoned. The work was recreated directly in the correct GitHub repository on a clean branch from current `main`.

## Files changed

- `macro/probabilityLabelling.js` adds explicit probability provenance labels.
- `scripts/test_macro_parity.js` adds parity QA for glossary labels and probability labelling.
- `package.json` adds `qa:mi-macro-parity` without replacing existing doctrine scripts.
- `docs/qa/brief-2-mi-macro-parity.md` records this evidence.

## Glossary status

`macro/glossary.js` already exists on current `main` and is richer than the old recovery patch. It exposes `TERMS`, `lookup(tag)`, `footer(tagsUsed)`, and `termLink(label, opts)`.

Current user-facing mappings:

- `BOS` surfaces as `[Structure Break]`.
- `CHoCH` surfaces as `[Initial-direction reversal]`.

This branch does not downgrade the existing glossary.

## Probability labelling treatment

- `historically sourced` is reserved for real historical samples.
- `engine-derived` and `formula-derived` label current model or formula logic.
- `pending historical validation` is used where no verified historical source exists.
- Four-way probability splits are not fabricated.
- In-line and reversal values remain pending unless historically sourced.

## Check commands

Recommended checks before merge:

- `npm run qa:mi-macro-parity`
- `npm run doctrine:foundation`
- `git diff --check`

## Gate status

- H2 glossary defect: ready to pass.
- H3 probability labelling: ready pending PR checks.
- H4 orphan caller status: ready pending grep evidence if required.
- H5 staging proof: remains separate from this PR.

Merge recommendation: hold unless checks pass and lane policy is satisfied.
