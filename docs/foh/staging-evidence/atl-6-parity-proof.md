# ATL-6 — Dark Horse FOH v6 prototype parity proof

**Endpoint:** PROTOTYPE PARITY PASS

Source of truth: `docs/screenshots/dh-foh-v6-*.png` generated from `scripts/render_dh_foh_v6_preview.js::SAMPLE_MESSAGES`.

Current staged output: `darkHorseFoh.buildDarkHorseFohPayload()` rendered through the live-path fixture and chart-card PNG attachment renderer.

## Side-by-side proof

| Surface | Prototype screenshot | Current staged Discord output | Verdict / delta |
|---|---|---|---|
| Banner + Market Mood | <img src="../../screenshots/dh-foh-v6-detail-banner.png" width="260" /> | <img src="dh-foh-v6-live-current-detail-banner.png" width="260" /> | PASS — hierarchy, market mood, terminology, dollars-first guidance present. Live path splits FRESH into M2 because M1 is 1916/2000 chars before adding a candidate separator. |
| FRESH card | <img src="../../screenshots/dh-foh-v6-detail-fresh-candidate-embed.png" width="260" /> | <img src="dh-foh-v6-live-current-detail-fresh-candidate-embed.png" width="260" /> | PASS — lifecycle, 5-disc conviction, dollar risk, What This Means, WHAT TO DO NOW, confirms/cancels present. |
| STILL ACTIVE card | <img src="../../screenshots/dh-foh-v6-detail-still-active-candidate-embed.png" width="260" /> | <img src="dh-foh-v6-live-current-detail-still-active-candidate-embed.png" width="260" /> | PASS — outlined active lifecycle, full-size/elevated-mood dollar language, confirmation/cancel story present. |
| FADING card | <img src="../../screenshots/dh-foh-v6-detail-fading-candidate-embed.png" width="260" /> | <img src="dh-foh-v6-live-current-detail-fading-candidate-embed.png" width="260" /> | PASS — late-stage lifecycle, quarter-size risk, caveat and skip language present. |
| BUILDING / Chart Reference | <img src="../../screenshots/dh-foh-v6-detail-reference-card-embed.png" width="260" /> | <img src="dh-foh-v6-live-current-detail-reference-card-embed.png" width="260" /> | PASS — BUILDING surface and chart reference embed present; chart is also delivered as PNG attachment, not text fallback. |

## Delta table

| Required surface / check | Status | Exact delta |
|---|---|---|
| Banner | PASS | Visual hierarchy preserved. Candidate starts in M2 to stay under Discord content cap. |
| FRESH card | PASS | Full v6 field set restored. |
| STILL ACTIVE card | PASS | Full v6 field set restored. |
| FADING card | PASS | Full v6 field set restored, including late-stage caveat. |
| BUILDING / Chart Reference | PASS | Reference surface restored with rendered chart-card PNG attachment. |
| Dollar Risk This Trade | PASS | Lifecycle-aware dollar-first sizing on every candidate. |
| What This Means | PASS | Present on every candidate. |
| WHAT TO DO NOW | PASS | Five-step checklist with dollar amounts on every candidate. |
| What Confirms / What Cancels | PASS | Present on every candidate. |
| Risk Reminder / Briefing Summary tail | PASS | Tail restored with next-scan summary. |
| Density matches prototype | PASS | Discord split is constrained by 2000-char content cap; no content surface removed. |
| Layout hierarchy matches prototype | PASS | Same order: banner, FRESH, STILL ACTIVE, FADING, BUILDING/chart reference, tail. |
| Dollar-first action language visible | PASS | Dollar amounts visible in Market Mood, Dollar Risk, Where to Act, and WHAT TO DO NOW. |
| Lifecycle storytelling visible | PASS | FRESH / STILL ACTIVE / FADING separators and card copy present. |
| 5-disc severity bars visible | PASS | Market Mood and Conviction use 5-disc bars with inactive `⚫`. |
| Colour hierarchy preserved as Discord allows | PASS | diff/ansi fences, embed colors, emoji zones, bold price tokens, and chart PNG colors preserve hierarchy. Inline text color remains a Discord platform limitation. |
| No placeholder chart fallback as standard | PASS | Live transport renders and posts PNG files via `attachment://...`; no pending/text chart substitute. |
| No text-mode chart substitution | PASS | Chart-card PNG files generated for 3 candidates + reference card. |
| No banned wording | PASS | FOH QA banned-word sweep is green. |

## Chart PNG attachment proof

- `dh-foh-01-eurusd-1h.png`
- `dh-foh-02-xauusd-1h.png`
- `dh-foh-03-nvda-1h.png`
- `dh-foh-04-reference-pattern.png`

## Generated artifacts

- `dh-foh-v6-live-current.html`
- `dh-foh-v6-live-current.png`
- `dh-foh-v6-live-current.pdf`
- `dh-foh-v6-live-current-section-1-banner.png`
- `dh-foh-v6-live-current-section-2-fresh.png`
- `dh-foh-v6-live-current-section-3-still-active.png`
- `dh-foh-v6-live-current-section-4-fading.png`
- `dh-foh-v6-live-current-section-5-reference-card.png`
- `dh-foh-v6-live-current-section-6-briefing-summary.png`
- `dh-foh-v6-live-current-detail-banner.png`
- `dh-foh-v6-live-current-detail-fresh-candidate-embed.png`
- `dh-foh-v6-live-current-detail-still-active-candidate-embed.png`
- `dh-foh-v6-live-current-detail-fading-candidate-embed.png`
- `dh-foh-v6-live-current-detail-reference-card-embed.png`
- `attachments/` chart-card PNG files

**Final verdict:** PROTOTYPE PARITY PASS
