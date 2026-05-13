# `docs/foh/checklists/` — Pack checklists and TRC- row sheets

Drop the FOH Pack checklists and TRC- row sheets here. Examples
that have been referenced outside this repository:

- `pack-5.md`
- `pack-8.md`
- `TRC-012.md` … `TRC-018.md`
- Or any combined "doctrine-lock / dollar-first / hyperlink /
  NEW-badge / chart-card / multi-colour / MI-v2-wording" item
  sheet.

## What goes in a checklist file

A checklist file lists the acceptance items the operator wants
ticked off before a given FOH surface counts as delivered. Each
item should be specific enough that a reviewer can grep the live
preview for evidence the item has been satisfied (or honestly
mark it pending).

Example item form:

```
- [ ] doctrine-lock  — premium banner block emits "v1.3 — operator edition"
- [ ] dollar-first   — Operator Panel ENERGY tag uses "Elevated" wording
- [ ] hyperlink      — Expanded Terminology row renders Markdown links when urlMap is wired
- [ ] NEW-badge      — 🔴 CURRENT LIVE READ separator emits above the atmosphere block
- [ ] chart-card     — candidate card uses the ━━━━━━━━ SYM ↑ · N/10 · Section ━━━━━━━━ banner
- [ ] multi-colour   — section radar uses 🟢/🟡/🟠/🔴/🔵/⚪ status glyphs
- [ ] MI-v2-wording  — Market Intel wording aligns with market-intel-foh-v3.pdf
```

## How checklists inform the live code

Each FOH PR's description links the checklist items it satisfies.
Items still pending are surfaced as follow-up tasks in the PR
body so the operator can see at a glance what has not been
delivered yet.

## Hard scope reminder

Checklists in this folder are not imported by the live path. They
are operator-facing planning artifacts only.
