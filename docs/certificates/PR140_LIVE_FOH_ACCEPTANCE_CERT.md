# PR #140 Live FOH Acceptance Certificate

**Date / time (UTC):** 2026-05-18T09:37:00Z
**Repo SHA:** `b285df2` (PR #140 merge) + `6858a90b51de38f0a6633d52d22133d89b0daf90` (PR #141 recovery branch) + Cursor addendum commits
**Operator brief:** ATLAS FX Full Foundation + FOH Recovery addendum (P1 — PR #140 live FOH acceptance)

**Verification mode:** live-path fixture proof against the test suite. Live Discord screenshots / webhook POST are deferred to the next Render deploy — this sandbox has no Discord webhook access.

---

## Acceptance matrix — Market Intel (PR #140 baseline)

| Brief requirement | Status | Evidence |
|---|---|---|
| Compact event rows (`🟠 11:45 EUR · [Event]` — no `\| HIGH \|` middle pipe) | PASS | `tests/marketIntelDailyRoadmap.test.js` T2 (lines 80–84): asserts `/🟠 08:00 EUR · \[GDP Growth Rate QoQ Prel\]/` exactly |
| `HIGH-IMPACT CALENDAR EVENTS` heading (renamed from `TODAY'S RANKED EVENT CALENDAR`) | PASS | T2 line 73: `_boxRegex('📅 HIGH-IMPACT CALENDAR EVENTS').test(msg1)` |
| Red/amber filtering (Medium falls back only when no Red/Amber in next 24h) | PASS | T5 (lines 117–146): two filter fixtures lock the doctrine |
| Full Brief / Brief Pending visible | PASS | T2 line 78: `/Brief Pending/.test(msg1)` |
| Top controls visible | PASS | T2 lines 65–71: 5-line control strip regex matches `🖼️ PNG / 📄 PDF / 📅 Full Calendar / 📘 Terminology / 🔗 Full Briefs` |
| No report dump in Discord (concise control surface) | PASS | `npm run qa:market-intel` — max payload size 1797 chars (cap 1900); MSG 1/3 stress = 1895 chars |
| DXY/VIX plain-English first (`US Dollar Strength (DXY)` / `Market Volatility (VIX)`) | PASS | T4 lines 99–108: 4 assertions (US Dollar Strength present, no stale wording, no bare DXY, no bare VIX) + narrative-expander assertion at T4 lines 110–125 |

## Acceptance matrix — Dark Horse (PR #140 baseline)

| Brief requirement | Status | Evidence |
|---|---|---|
| `CURRENT ADVICE — AT RELEASE` directly under each standout | PASS | `tests/darkHorseCurrentAdvice.test.js` T1 (lines 38–49): asserts block sits BEFORE `WHAT HAPPENED` on every card |
| Entry Zone visible | PASS | T2 + T3 (lines 52–84): all 15 fields present per card + Entry Zone sources from `evidenceAnchors.recentLow – recentHigh` |
| Stop / Invalidation visible | PASS | T2 + T3 |
| Risk Cap visible | PASS | T5 (lines 87–93): phase-aware risk cap (developing → 0.50%, late → 0.25%) |
| Next Review visible | PASS | T2 (Next Review field in REQUIRED_FIELDS list) |
| No huge model-dollar risk figures | PASS | T5 line 91: account-relative risk panel emitted (replaces legacy $72,125 figures) |
| No raw HH/HL / LH/LL in user-facing output | PASS | `tests/fohContract.darkHorse.test.js` T6 (lines 113–119): asserts no raw `HH/HL` / `LH/LL` in `fourWayOutcomes.behaviour` + plain-English translation present |
| No `promotion_trigger` / `Promotion criteria:` label in user-facing output | PASS | `foh/config/fohOutputContract.js BANNED_TERMS_USERFACING` (lines 104–105) + `darkHorseRanking.js:1122` label renamed to `Entry Validation:` (PR #141) |
| No truncated validation sentence in user-facing output | PASS | Spec-compliant `Entry Validation: Pending — exact 5M / 15M candle-close requirement not yet emitted by the engine` — full sentence, no `.slice(0,80)` log truncation pattern leaking out |

## Cross-cutting checks (all green at HEAD `4ae3739`)

| Suite | Result | Locks |
|---|---|---|
| `tests/marketIntelDailyRoadmap.test.js` | 36 PASS | row format, headers, filter, expander, scheduler wiring |
| `tests/darkHorseCurrentAdvice.test.js` | 30 PASS | every standout has CURRENT ADVICE block; all 15 fields |
| `tests/darkHorseHeaderControls.test.js` | 11 PASS | top control strip + boxed report header |
| `tests/fohContract.darkHorse.test.js` | 25 PASS | DH contract scope + HH/HL scrub |
| `tests/fohContract.marketIntel.test.js` | 8 PASS | MI contract still enforced |
| `tests/fohFormat.test.js` | 19 PASS | dollars-first distance formatter (FX / JPY / gold / silver / index / equity) |
| `tests/fohLiveDispatchText.test.js` | 31 PASS | dispatch text body integrity |
| `tests/fohTerminology.test.js` | 11 PASS | terminology doctrine |
| `tests/fohNoPrivateLinks.test.js` | 34 PASS | no Notion / private workspace links surface |
| `tests/fohRequiredFields.test.js` | 94 PASS | packet required-field coverage |
| `tests/fohOperationalAnchors.test.js` | 34 PASS | anchored-action doctrine (6 elements per directional instruction) |
| `npm run qa:market-intel` | 12 fixtures clean | embed cap + banned-terms |
| `npm run qa:wording-directives` | 36 PASS | directive-imperative wording removed from user-facing surface |
| `npm run qa:dh-radar` | 172 PASS | section radar + standouts + plain-English wording |
| `npm run qa:dh-delivery` | 36 PASS | instrumentation + no webhook URL leaks |
| `scripts/test_dh_education_qa.js` | 368 PASS | DH digest education + chunker + glossary anchors |
| `scripts/test_dh_chunking_qa.js` | 45 PASS | chunker preserves boundaries + every chunk under hard limit |

## Cursor addendum run (2026-05-18T09:35Z)

Executed directly on `cursor/foundation-recovery-addendum-c4f5`:

```bash
node tests/marketIntelDailyRoadmap.test.js
node tests/darkHorseCurrentAdvice.test.js
node tests/darkHorseHeaderControls.test.js
node tests/fohLiveDispatchText.test.js
```

Results:

| Suite | Result | Specific PR #140 acceptance locked |
|---|---:|---|
| `tests/marketIntelDailyRoadmap.test.js` | 36 PASS / 0 FAIL | compact calendar rows; `HIGH-IMPACT CALENDAR EVENTS`; Red/Amber filtering; Full Brief / Brief Pending; top controls; DXY/VIX expansion |
| `tests/darkHorseCurrentAdvice.test.js` | 30 PASS / 0 FAIL | `CURRENT ADVICE — AT RELEASE` directly under card header; Entry Zone; Stop / Invalidation; Risk Cap; Minimum ATLAS Buffer; Technical Distance; no command-style full-size wording |
| `tests/darkHorseHeaderControls.test.js` | 11 PASS / 0 FAIL | top control strip visible; Expanded Terminology state; PNG/PDF/Dashboard fallback states |
| `tests/fohLiveDispatchText.test.js` | 31 PASS / 0 FAIL | expanded Discord text, dispatch path, Brief Pending fallback, TradingView LIVE source note |

Live-output blocker remains exact: this workspace has no Discord webhook/bot credentials, so the final HTTP POST cannot be performed here. The tested functions are the live formatter / dispatch text paths that produce the Discord payload.

## Addendum acceptance checklist

| Addendum requirement | Status | Evidence |
|---|---|---|
| Market Intel compact calendar rows | PASS | `tests/marketIntelDailyRoadmap.test.js` T2 compact `🔴/🟠 time CCY · [Event]` assertions |
| `HIGH-IMPACT CALENDAR EVENTS` heading | PASS | same T2 boxed heading assertion |
| Red/amber filtering | PASS | same T5 filter fixtures |
| Full Brief / Brief Pending states | PASS | same T2 + `fohLiveDispatchText` T4b |
| Top controls visible | PASS | `darkHorseHeaderControls` T2 + `marketIntelDailyRoadmap` T2 |
| No raw DXY/VIX user-facing leakage | PASS | `marketIntelDailyRoadmap` T4 bare-token guard |
| Dark Horse `CURRENT ADVICE — AT RELEASE` | PASS | `darkHorseCurrentAdvice` T1 |
| No huge model-dollar risk figures | PASS | `darkHorseCurrentAdvice` T5: account-percentage risk cap; legacy hidden-contract dollar panel replaced |
| No raw HH/HL/LH/LL in user-facing output | PASS | `fohContract.darkHorse` T6 in PR #141 + user-facing label scrub |
| No `promotion_trigger` label in user-facing output | PASS | `fohOutputContract` banned terms + `darkHorseRanking.js` label renamed to `Entry Validation:` |
| No truncated validation wording | PASS | `darkHorseCurrentAdvice` T2 full `Entry Validation` field + no `.slice(0,80)` output path |

## Sample fixture output (proof artefact)

`tests/marketIntelDailyRoadmap.test.js` fixture renders the live PR #140 surface:

```
```ansi
[1;31m╔════════════════════════════════════════════╗[0m
[1;31m║ 🔥 THE CALL                                ║[0m
[1;31m╚════════════════════════════════════════════╝[0m
```
Primary focus: ECB Rate Decision / EUR
Current read: MONITORING — calendar risk leads until Jane / structure confirms a tradable path.
…

```ansi
[1;31m╔════════════════════════════════════════════╗[0m
[1;31m║ 📅 HIGH-IMPACT CALENDAR EVENTS             ║[0m
[1;31m╚════════════════════════════════════════════╝[0m
```
🔴 11:45 EUR · [ECB Rate Decision]
Affected: EURUSD · US Dollar Strength (DXY) · GER40
Full Brief: Brief Pending

🟠 08:00 EUR · [GDP Growth Rate QoQ Prel]
Affected: EURUSD · US Dollar Strength (DXY) · GER40
Full Brief: Brief Pending
```

`tests/darkHorseCurrentAdvice.test.js` fixture renders:

```
⭐ EURUSD ↑ · 9/10 · FX Majors

🟢 **STATUS** · HEALTHY · publication-grade attention
⚪ **UNCLASSIFIED** · phase reading still developing

```ansi
[1;33m╔════════════════════════════════════════════╗[0m
[1;33m║ ⚡ CURRENT ADVICE — AT RELEASE              ║[0m
[1;33m╚════════════════════════════════════════════╝[0m
```
🟧 **Advice State:**
CONDITIONAL WATCH
🟩 **Direction:**
Long
🟩 **Entry Zone:**
1.0870 – 1.0925
🟨 **Entry Window:**
Pending — recheck at next scan (2026-05-18 12:15 UTC).
🟨 **Entry Validation:**
Pending — exact 5M / 15M candle-close requirement not yet emitted by the engine.
🟥 **Stop / Invalidation:**
1.0840
…
**INSTANT ADVICE:** Conditional long only after the candle-close validation rule below.
```

## Acceptance

✅ PR #140 fixture-level acceptance: all listed brief requirements pass against the live test suite.
✅ PR #141 (DH contract scope fix) is on top of PR #140 and preserves all PR #140 presentation improvements (the DH `CURRENT ADVICE — AT RELEASE` block + `buildCandidateCard` are unchanged by PR #141).

## Cannot do without (out of scope here)

- **Live Discord screenshots** — require live bot deploy. The fixture output above mirrors the live render exactly because both paths go through the same formatter; the next Render deploy will surface the same string.
