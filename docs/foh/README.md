# `docs/foh/` — Dark Horse FOH prototype reference root

This folder is the reference home for the planned ATLAS Dark Horse
**FOH operator surface** prototype assets. The folder structure is
created so the prototype materials currently held outside this
repository (Notion / other agents / shared drive) have an obvious
landing zone the next time they need to be brought in.

Until the prototype materials are added, this folder is intentionally
empty except for placeholder `README.md` files that describe what
each subfolder is expected to hold and which live-path file the
asset informs.

## Folder map

```
docs/foh/
├── README.md                — this file
├── prototypes/              — locked-spec PDFs (e.g. dh-foh-v6.pdf,
│                              market-intel-foh-v3.pdf)
├── galleries/               — *-gallery.md screenshot/render galleries
│                              (e.g. dh-foh-v6-gallery.md,
│                              market-intel-foh-v3-gallery.md)
└── checklists/              — Pack checklists and TRC- row sheets
                              (e.g. pack-5.md, pack-8.md, TRC-012.md)
```

## Why this folder exists

The live FOH formatter (`darkHorseFohFormatter.js`) and semantic
translator (`darkHorseFohSemanticTranslator.js`) were built from the
operator directives in the chat thread that produced PR #66 and
PR #67. Several prototype artifacts ("dh-foh-v5.pdf",
"dh-foh-v6.pdf", "_foh_renderer.js", "Pack 5 / Pack 8 checklist",
"TRC- rows 012–018") were referenced in operator screenshots but
were never available inside this repository. That gap caused a
mismatch between the planned surface and the implemented surface.

Going forward:

- Prototype PDFs go in `prototypes/`.
- Screenshot/render galleries go in `galleries/`.
- Pack checklists and TRC- row sheets go in `checklists/`.
- The live formatter changes are reviewed against whichever asset
  in this folder the operator has locked as canonical for the
  current cycle.

## Hard scope reminder

These folders are reference-only. The live path remains:

```
candidate engine
  → darkHorseFohSemanticTranslator   (voice)
  → darkHorseFohFormatter            (layout)
  → darkHorseEngine._dhChunkDigest   (transport)
  → webhook                          (Discord)
```

Files inside `docs/foh/` are never imported by the live code path.
They are operator-facing planning artifacts only.
