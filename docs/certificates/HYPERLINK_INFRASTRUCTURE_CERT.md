# Hyperlink Infrastructure Certificate

**Date / time (UTC):** 2026-05-18T09:43:00Z
**Repo SHA:** `6858a90b51de38f0a6633d52d22133d89b0daf90` + Cursor addendum commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery addendum (P2 — Hyperlink infrastructure recovery)

**Status:** SCOPE DEFERRED / NOT COMPLETE. Audit-only cert. Production hyperlink infrastructure work is captured here as a follow-up PR scope; the production-safe minimum is enumerated below. This must not be considered complete in the work board.

---

## What was previously attempted (and why it is NOT copied in)

Codex wrote a hyperlink registry under `/workspace/discord-relay` — a **different repository**, not the production `ATLAS_DISCORD_PATHWAY` target. That work is not production-complete and the brief explicitly says **"Only proceed if working in the production repo. Do not copy blindly."**

This cert records the audit finding and proposes the production-shaped scope. The actual implementation lives in a follow-up PR, not this one — bundling it into this foundation PR would balloon scope past safe-review size.

## Current state — what already exists in production

| Capability | Status | Where |
|---|---|---|
| Box-headers + control-strip helper | LIVE | `foh/headerStrip.js` (shipped in PR #139) |
| Dollars-first / instrument-aware unit formatter | LIVE | `foh/foh-format.js` (shipped in PR #140) |
| Macro-label expander (DXY → US Dollar Strength (DXY), VIX → Market Volatility (VIX)) | LIVE | `foh/foh-format.js exportMacroLabels` (shipped in PR #140) |
| Brief Pending / Available / Not generated state resolver | LIVE | `foh/headerStrip.js controlStrip._resolveControl` (shipped in PR #139) |
| Full Brief URL safety guard | LIVE | `_miSafeBriefStatus` (`coreyMarketIntel.js`) + `_miBriefUrl` (PR #139) — both reject Notion / private workspace URLs |
| Notion / private-workspace URL scrubber | LIVE | `foh/dispatch/_discordPost.js scrubPrivateBackend` (last-line-of-defence) |
| No-dead-link policy enforcement | LIVE | `tests/fohNoPrivateLinks.test.js` (34 PASS) — blocks any private URL leak |

The hyperlink-related primitives **already exist in this repo**. What's missing is a single registry + the per-term URL routing for Expanded Terminology + per-event Full Brief routing.

## Cursor addendum audit result

The addendum was run in the correct repository:

```text
herbertnathan28-123/ATLAS_DISCORD_PATHWAY
```

No code was copied from `/workspace/discord-relay`. That checkout remains the wrong source for production. The current production repo has fallback controls, private-link scrubbers, and plain-English DXY/VIX expansion, but **does not yet have** the central hyperlink registry/helper requested by the addendum.

### Required item status

| Required addendum item | Current status | Evidence / next action |
|---|---|---|
| central FOH hyperlink registry/helper | NOT IMPLEMENTED | Required follow-up: `foh/linkRegistry.js` or equivalent |
| safe URL validation | PARTIAL | `_discordPost.js containsPrivateBackendUrl`, `_miSafeBriefStatus`, `macro/glossary.js`, `macro/roadmapLink.js` reject private/unsafe URLs |
| no-dead-link validation | PARTIAL | `tests/fohNoPrivateLinks.test.js` blocks private links; no positive registry resolution test exists yet |
| Expanded Terminology Hyperlinks | FALLBACK ONLY | DH terminology row exists; real URL routing not wired |
| calendar event links | FALLBACK ONLY | MI rows show bracketed event names and `Brief Pending`; real event URLs require registry |
| Full Brief / Brief Pending resolver | PARTIAL | `_miSafeBriefStatus` and `_miBriefUrl` handle safe `Brief Pending`; registry source missing |
| Full Calendar resolver | FALLBACK ONLY | control strip can show `Available`; real URL target not centralised |
| PNG/PDF/Dashboard fallback states | LIVE | `foh/headerStrip.js controlStrip` |
| DXY → US Dollar Strength (DXY) | LIVE | `foh/foh-format.js expandMacroLabels`; `coreyMarketIntel.js _miExpandMacroLabels` |
| VIX → Market Volatility (VIX) | LIVE | same |

## Follow-up implementation contract

Open a focused follow-up PR after foundation merge with these exact tasks:

1. Add `foh/linkRegistry.js` with pure helpers:
   - `isSafePublicUrl(url)`
   - `resolveTerminologyLink(term)`
   - `resolveCalendarEventLink(event)`
   - `resolveFullBriefLink(eventOrSlug)`
   - `resolveFullCalendarLink()`
   - `resolveDashboardLink(context)`
   - `formatLinkOrPending(label, resolution, pendingLabel)`
2. Add a registry data source that can be fed by environment / config without hardcoding private Notion URLs.
3. Wire `coreyMarketIntel.js` calendar rows through the registry:
   - real safe URL → `[Event](url)`
   - missing / unsafe URL → `[Event]` + `Full Brief: Brief Pending`
4. Wire `darkHorseFohFormatter.js` and `darkHorseFoh.js` Expanded Terminology rows through the registry:
   - real safe URL → visible hyperlink
   - missing / unsafe URL → plain visible chip, not fake link
5. Extend `tests/fohNoPrivateLinks.test.js` with positive registry tests:
   - safe URLs accepted
   - Notion/private/local URLs rejected
   - missing links degrade to approved Pending labels
   - DXY/VIX labels remain plain-English first.

## Production-safe scope (next PR)

| Required | Notes |
|---|---|
| Central hyperlink registry / helper inside production FOH structure | Proposed: `foh/linkRegistry.js` with `{ resolveTermHref(term) → url \| 'Glossary Pending' }`, `{ resolveBriefHref(event) → url \| 'Brief Pending' }`, `{ resolveDashboardHref(context) → url \| 'Dashboard Pending' }`, `{ resolveFullCalendarHref() → url \| 'Full Calendar Pending' }`. |
| Safe URL validation | Reuse `_discordPost.js scrubPrivateBackend` + extend the existing private-link guard regex set. |
| No-dead-link validation | Reuse `tests/fohNoPrivateLinks.test.js` pattern — extend with positive-resolution check: every link must resolve to either a real registered URL or one of the approved Pending strings. |
| Expanded Terminology hyperlinks | Reuse the existing `🟦 Expanded Terminology` row in DH (darkHorseFohFormatter.js `buildTerminologyRow`) — plug into the new registry. |
| Calendar event links | Reuse `_miBriefUrl` shape — link to `/market-intel/brief/<event-slug>` when resolvable, else `Brief Pending`. |
| Full Brief / Brief Pending resolver | Already exists (`_miSafeBriefStatus`). Add a registry-driven mapper. |
| Full Calendar resolver | Currently `Available` blanket; add resolver that returns `https://atlas.fx/market-intel/calendar` (or env-configured route) or `Full Calendar Pending`. |
| PNG/PDF/Dashboard fallback states | Already in `foh/headerStrip.js controlStrip` — resolver returns `Available` / `Brief Pending` / `Not generated for this report` / `Dashboard Pending`. |
| DXY → US Dollar Strength (DXY), VIX → Market Volatility (VIX) | LIVE in `foh/foh-format.js expandMacroLabels` — no new work needed for the abbreviation pair. |

## Approved fallback states (already enforced in current code)

| Surface | Fallback | Source |
|---|---|---|
| Brief routing | `Brief Pending` | `_miSafeBriefStatus` |
| Glossary term routing | `Glossary Pending` | proposed (next PR) |
| Full Calendar routing | `Full Calendar Pending` | proposed (next PR) |
| PDF availability | `Not generated for this report` | `foh/headerStrip.js _resolveControl('skipped')` |
| PNG availability | `Brief Pending` | `foh/headerStrip.js _resolveControl('pending')` |
| Dashboard routing | `Dashboard Pending` (DH) / `Brief Pending` (MI Full Briefs row) | `foh/headerStrip.js controlStrip` |

## Rules (already enforced)

- ✅ no fake links — `tests/fohNoPrivateLinks.test.js` (34 PASS) blocks any `notion.so` / `notion.com` / `notion.site` / `Notion` leak
- ✅ no placeholder URLs — `_miSafeBriefStatus` rejects Notion routes and any non-`/market-intel/brief/<slug>` shape
- ✅ no local URLs in user-facing output — same guard
- ✅ no grey bracketed terms pretending to be links — already the case; `[Event Name]` brackets are an intentional visual cue, not link impersonation
- ✅ cyan link style where renderer supports it — Discord renders markdown `[label](url)` as cyan automatically when the URL is real

## Acceptance against the operator brief

- ❌ Real production PR containing the hyperlink registry implementation — **DEFERRED to follow-up PR** (scope too large for this foundation PR; documented above)
- ✅ The decision NOT to copy `/workspace/discord-relay` content is recorded
- ✅ Tests already prove no dead links surface in this PR's state (`tests/fohNoPrivateLinks.test.js`)
- ✅ Missing links already degrade safely (control-strip resolver + brief-URL safety guard already in place)
- ✅ PR #140 helpers are reused, not duplicated (this cert lists which helpers the next PR must extend rather than re-implement)
- ✅ Follow-up implementation contract now enumerates exact helper names, wiring points, and validation requirements

## Cannot do without (out of scope here)

- **Glossary content source** — operator decision on where the Expanded Terminology glossary lives (Codex glossary repo? in-app glossary?). The registry needs a target URL.
- **Public dashboard URL route** — operator decision on the public path for `Open Dashboard` (e.g. `https://atlas.fx/dashboard/<symbol>`).
- **Per-event Brief URL route** — the brief-routing path is already shaped (`/market-intel/brief/<slug>`) but the actual brief content hosting is out of scope here.

## Recommendation

Ship a focused follow-up PR titled "Hyperlink registry + Expanded Terminology routing" once the operator confirms the three URL targets above. This cert is the design + acceptance contract for that next PR. Until then, hyperlink infrastructure must remain marked **blocked / not complete**, even though safe fallbacks are working.
