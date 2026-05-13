# `docs/foh/galleries/` — render / screenshot galleries

Drop the FOH render galleries here. Examples that have been
referenced outside this repository:

- `dh-foh-v5-gallery.md`
- `dh-foh-v6-gallery.md`
- `market-intel-foh-v2-gallery.md`
- `market-intel-foh-v3-gallery.md`

## What goes in a gallery file

A gallery is a Markdown file pairing rendered screenshots of the
prototype's planned Discord output (or extracted PDF page images)
with short callouts explaining what each section is meant to
communicate. The gallery is the visual companion to the locked-spec
PDF — the PDF defines the rules, the gallery shows the result.

## How galleries inform the live code

Layout reviews of the live formatter use the gallery as the side-
by-side reference. Where the live output and the gallery diverge,
the operator decides whether the live output catches up to the
gallery or the gallery is revised.

## Hard scope reminder

Galleries in this folder are not imported by the live path. They
are operator-facing planning artifacts only.
