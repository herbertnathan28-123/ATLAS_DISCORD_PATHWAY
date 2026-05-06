═══════════════════════════════════════════════════════════════════════════
BRIEF FOR CODEX — ATLAS contributions-calculator subsystem
═══════════════════════════════════════════════════════════════════════════

⚠️  CRITICAL — TARGET REPOSITORY
────────────────────────────────
THE ONLY REPOSITORY YOU MAY MODIFY FOR THIS TASK IS:

    herbertnathan28-123/ATLAS_DISCORD_PATHWAY

DO NOT TOUCH ANY OTHER REPO. Specifically NOT:
    - herbertnathan28-123/discord-relay     ← previous task error
    - herbertnathan28-123/ATLAS_ASTRA_RELAY ← never touch
    - herbertnathan28-123/echarts.min.js
    - herbertnathan28-123/atlas-fx-discord-bot-claude

If you find yourself working in any of those, STOP and re-read this brief.


CONTEXT
───────
You previously parked an unrelated discord-relay PR after working in the
wrong repo. Confirmed parked. This brief replaces that work.

You also continue monitoring ATLAS FX (feature/renderer-puppeteer). This
brief is ADDITIVE and does not pause that work.


SCOPE — WHAT YOU WILL DO
────────────────────────
1. Create a new branch: feature/contributions-calculator (from main)
2. Create the directory contributions-calculator/ at the repo root
3. Write 10 files into that directory verbatim from the FILE BUNDLE below
4. Add ONE line to existing index.js — see "ONE-LINE INTEGRATION" below
5. Add discord.js@14 to dependencies if not already present
6. Commit, push, open PR. DO NOT MERGE.


ABSOLUTE NON-TOUCH LIST (existing files you may NOT modify)
───────────────────────────────────────────────────────────
- renderer.js                 (existing chart renderer — DIFFERENT FILE)
- corey_calendar.js / corey_live_data.js
- darkHorseEngine.js / darkHorseFomoControl.js
- cacheManager.js / cacheReader.js / cacheUpdater.js
- historicalCache.js
- eodhdAdapter.js
- render.yaml
- .puppeteerrc.cjs
- CLAUDE.md
- macro/ scripts/ .github/workflows/

The ONLY existing file modification permitted is one line in index.js.


ONE-LINE INTEGRATION INTO index.js
──────────────────────────────────
Find the existing app.listen(...) call. Add EXACTLY this line immediately
above it:

    require('./contributions-calculator/bootstrap').attach(app);

Do not refactor surrounding code. Do not reorder requires. One line, that's it.


DEPENDENCIES
────────────
Inspect package.json for "discord.js":
- If absent, run: npm install discord.js@14
- If present at "^14.x.x" or higher, do nothing
- If present at "^13" or older, STOP and report. Do not auto-upgrade.

Do not install puppeteer, sharp, or express. Already in ATLAS.


COMMIT & PR
───────────
git checkout -b feature/contributions-calculator
git add contributions-calculator/
git add index.js
git add package.json package-lock.json   # only if discord.js was installed
git commit -m "feat: contributions calculator bot + renderer (A380 launch)"
git push origin feature/contributions-calculator

Open PR against main with this body:

    Adds isolated /contribution and /row Discord slash-command subsystem
    for the Beagle server's calc-1..4 channels. Single-line bootstrap
    into existing ATLAS Express app. No modifications to existing ATLAS
    code paths. Full design + smoke-test plan in
    contributions-calculator/CONTRIBUTIONS_CALCULATOR_DEPLOY.md.

    Post-merge: user sets CALC_AUDIT_CHANNEL_ID and ENABLE_CALC_BOT
    env vars in Render dashboard, runs register-commands.js once in
    Render Shell to register slash commands, drops a380.jpg into
    contributions-calculator/assets/ via GitHub web UI.

DO NOT MERGE the PR. User reviews and merges manually.


WHAT NOT TO DO
──────────────
- Do not register Discord slash commands programmatically
- Do not touch any file on the non-touch list
- Do not auto-upgrade dependencies beyond discord.js@14 install
- Do not place a380.jpg in assets/ (user does this manually post-merge)
- Do not set Render env vars (user does this manually post-merge)
- Do not pause or alter the renderer.js / feature/renderer-puppeteer work
- If you encounter ANY ambiguity, STOP and report. Do not improvise scope.


REPORT BACK
───────────
When the PR is open, return:
1. PR URL
2. Branch name
3. List of files created (10 expected under contributions-calculator/)
4. Line number in index.js where the bootstrap line was added
5. Whether discord.js needed install or was already present (and version)
6. Any deviation from this brief, with reason
7. Any blockers


═══════════════════════════════════════════════════════════════════════════
FILE BUNDLE — 10 files to create verbatim
═══════════════════════════════════════════════════════════════════════════

The 10 files below are delimited by:
    ===== FILE: <relative_path> =====
    <file contents>
    ===== END FILE =====

Split on those delimiters and write each file VERBATIM at the indicated
relative path under contributions-calculator/. Do not refactor, reformat,
"improve," or modernise the code. The implementation is locked.

Do NOT create assets/a380.jpg — the user places that manually. Just create
the directory contributions-calculator/assets/ as empty (or with a
.gitkeep file if needed for git to track it).


===== FILE: contributions-calculator/calc-engine.js =====
'use strict';

/**
 * Contributions Calculator — pure engine
 * ATLAS / Beagle server — Airline Manager
 *
 * Distance-driven coefficient (no strategy dropdown — auto from distance):
 *   ≤ 6,000 km          → 0.00444
 *   6,001 – 9,999 km    → DEAD ZONE (original game-design boundary by the developer;
 *                          no certified coefficient exists in this range. Players are
 *                          forced to commit to short-haul or long-haul strategy.)
 *   10,000 – 22,000 km  → 0.003530 - ((distance - 10000) / 9000) × 0.000030
 *                          Linear decline. Anchors: 10000=0.003530, 19000=0.003500,
 *                          22000=0.003490.
 *   > 22,000 km         → out of range
 *
 * Per-aircraft G3 derivation:
 *   Easy G3    = base_speed × 1.65   (= base × 1.10 × 1.50)
 *   Realism G3 = base_speed × 1.10
 *
 * Per-row formulas (when row is fillable):
 *   Cost Index    = 2000/7 × (Distance / (G3 × FlightTime)) - (600/6.9)
 *   Expected C/D  = ((1 + (200 - CostIndex) × 0.01) × (coefficient × Distance)) / 1.5
 *   Expected C/F  = Expected C/D × 2
 *   Default Flights in 48h = floor(48 / FlightTime)
 *   Total C/D 48h = Expected C/D × Flights
 */

const DEAD_ZONE_LO = 6001;
const DEAD_ZONE_HI = 9999;
const SHORT_HAUL_MAX = 6000;
const LONG_HAUL_MIN = 10000;
const LONG_HAUL_MAX = 22000;

const COEFF_SHORT = 0.0044;
const COEFF_LONG_HI = 0.003530; // at 10,000 km
const COEFF_LONG_LO = 0.003500; // at 19,000 km (anchor)
// slope: -0.000030 per 9,000 km past 10,000 → continues smoothly to 22,000

const DEAD_ZONE_LABEL = '☢️ Developer C/D Dead Zone ☣️';

/**
 * Coefficient for a given distance.
 * Returns either { ok:true, value } | { ok:false, reason: 'dead_zone'|'out_of_range', label? }
 */
function coefficientForDistance(distance) {
  if (!Number.isFinite(distance) || distance <= 0) {
    return { ok: false, reason: 'invalid_distance' };
  }
  if (distance <= SHORT_HAUL_MAX) {
    return { ok: true, value: COEFF_SHORT };
  }
  if (distance >= DEAD_ZONE_LO && distance <= DEAD_ZONE_HI) {
    return { ok: false, reason: 'dead_zone', label: DEAD_ZONE_LABEL };
  }
  if (distance >= LONG_HAUL_MIN && distance <= LONG_HAUL_MAX) {
    const slope = (COEFF_LONG_HI - COEFF_LONG_LO) / 9000; // 0.000030 / 9000 per km
    const value = COEFF_LONG_HI - (distance - LONG_HAUL_MIN) * slope;
    return { ok: true, value };
  }
  if (distance > LONG_HAUL_MAX) {
    return { ok: false, reason: 'out_of_range', max: LONG_HAUL_MAX };
  }
  // Should never reach here — defensive
  return { ok: false, reason: 'invalid_distance' };
}

/**
 * Calculate one row's outputs.
 *
 * @param {Object} input
 * @param {number} input.flightTime  hours (e.g. 12.5)
 * @param {number} input.distance    km (e.g. 13500)
 * @param {number} input.cruiseSpeed kph (displayed as input only — does not feed the math; G3 carries the speed factor)
 * @param {number} input.G3          aircraft × mode constant
 * @param {string} input.mode        'easy' | 'realism'  — Realism omits the /1.5 divisor in C/D
 * @param {number} [input.flights]   optional override; if absent uses floor(48 / flightTime)
 *
 * @returns {Object} {
 *   ok: boolean,
 *   reason?: 'dead_zone' | 'out_of_range' | 'invalid_input',
 *   label?: string,                    // dead-zone display label
 *   costIndex?: number,
 *   expectedCD?: number,
 *   expectedCF?: number,
 *   coefficient?: number,
 *   flights?: number,
 *   totalCD48h?: number,
 *   flightsWasDefaulted?: boolean
 * }
 */
function calculateRow({ flightTime, distance, cruiseSpeed, G3, mode, flights }) {
  if (!Number.isFinite(flightTime) || flightTime <= 0) {
    return { ok: false, reason: 'invalid_input', detail: 'flightTime' };
  }
  if (!Number.isFinite(distance) || distance <= 0) {
    return { ok: false, reason: 'invalid_input', detail: 'distance' };
  }
  if (!Number.isFinite(G3) || G3 <= 0) {
    return { ok: false, reason: 'invalid_input', detail: 'G3' };
  }
  if (mode !== 'easy' && mode !== 'realism') {
    return { ok: false, reason: 'invalid_input', detail: 'mode' };
  }

  // Distance gate first — dead zone and out-of-range short-circuit before math
  const coeff = coefficientForDistance(distance);
  if (!coeff.ok) {
    return {
      ok: false,
      reason: coeff.reason,
      label: coeff.label,
      max: coeff.max,
    };
  }

  const costIndex = (2000 / 7) * (distance / (G3 * flightTime)) - (600 / 6.9);

  // Mode-aware C/D divisor:
  //   Easy mode flights are 1.5× speed-modded → divide raw C/D by 1.5
  //   Realism flights have no speed boost     → no divisor
  const modeDivisor = (mode === 'easy') ? 1.5 : 1.0;
  const expectedCD = ((1 + (200 - costIndex) * 0.01) * (coeff.value * distance)) / modeDivisor;
  const expectedCF = expectedCD * 2;

  let flightsResolved = flights;
  let flightsWasDefaulted = false;
  if (!Number.isFinite(flightsResolved) || flightsResolved <= 0) {
    flightsResolved = Math.floor(48 / flightTime);
    if (flightsResolved < 1) flightsResolved = 1;
    flightsWasDefaulted = true;
  }
  const totalCD48h = expectedCD * flightsResolved;

  return {
    ok: true,
    coefficient: coeff.value,
    costIndex,
    expectedCD,
    expectedCF,
    flights: flightsResolved,
    flightsWasDefaulted,
    totalCD48h,
  };
}

/**
 * Format a number for display in the card.
 * Cost Index → 2dp. Contributions → 2dp. Coefficient (debug) → 6dp.
 */
function fmt(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtInt(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-AU');
}

module.exports = {
  calculateRow,
  coefficientForDistance,
  fmt,
  fmtInt,
  DEAD_ZONE_LABEL,
  // ranges exported for validation in the bot layer
  SHORT_HAUL_MAX,
  DEAD_ZONE_LO,
  DEAD_ZONE_HI,
  LONG_HAUL_MIN,
  LONG_HAUL_MAX,
};

===== END FILE =====

===== FILE: contributions-calculator/aircraft-constants.js =====
'use strict';

/**
 * Aircraft constants — Contributions Calculator
 *
 * Source: 🥇CONT CALC MASTER NOV 25 master spreadsheet.
 *
 * For each aircraft, the only authored number is the BASE cruise speed.
 *   Easy G3    = base × 1.65   (= base × 1.10 speed-mod × 1.50 easy-mode)
 *   Realism G3 = base × 1.10   (speed-mod only)
 *
 * To enable an aircraft for the bot:
 *   1. Uncomment its entry in AIRCRAFT below
 *   2. Add its name to ACTIVE_AIRCRAFT
 *   3. Redeploy and re-run register-commands.js so the slash command
 *      autocomplete picks up the new option
 */

const RAW = {
  // ---- ACTIVE AT LAUNCH ----
  'A380': {
    base: 1049,
    label: 'A380-800',
    spec: '14,500 km / 945 kph / 600 pax / 21 lbs per km',
    image: 'a380.jpg',
  },

  // ---- SCAFFOLDED — UNCOMMENT WHEN READY TO ENABLE ----
  // 'MC21-400':       { base: 1096,    label: 'MC21-400',        spec: '' },
  // 'B787-10':        { base: 945,     label: 'B787-10',         spec: '' },
  // 'B787-8/9':       { base: 813,     label: 'B787-8/9',        spec: '' },
  // 'B737-MAX-10':    { base: 881,     label: 'B737-MAX 10',     spec: '' },
  // 'A350-ULR':       { base: 848,     label: 'A350-ULR',        spec: '' },
  // 'B747-8':         { base: 1097,    label: 'B747-8',          spec: '' },
  // 'B747SP':         { base: 1000,    label: 'B747SP',          spec: '' },
  // 'B747-8F':        { base: 988,     label: 'B747-8F',         spec: '' },
  // 'A380F':          { base: 945,     label: 'A380F',           spec: '' },
  // 'A330-Variants':  { base: 880,     label: 'A330 Variants',   spec: '' },
  // 'A330-CHTR':      { base: 881,     label: 'A330 Charter',    spec: '' },
  // 'DC10-Variants':  { base: 908,     label: 'DC10 Variants',   spec: '' },
  // 'Falcon-2000LX':  { base: 1092,    label: 'Falcon 2000LX',   spec: '' },
  // 'Spacejet':       { base: 1123,    label: 'Spacejet',        spec: '' },
  // 'Concordes':      { base: 1933,    label: 'Concordes',       spec: '' },
};

const ACTIVE_AIRCRAFT = ['A380'];

const MODES = ['easy', 'realism'];

const MODE_MULTIPLIER = {
  easy: 1.65,    // 1.10 × 1.50
  realism: 1.10, // 1.10 only
};

/**
 * Resolve aircraft + mode → { G3, label, spec, mode }
 * Returns null if the aircraft is not active or mode is unknown.
 */
function resolve(aircraft, mode) {
  if (!ACTIVE_AIRCRAFT.includes(aircraft)) return null;
  if (!MODES.includes(mode)) return null;
  const cfg = RAW[aircraft];
  if (!cfg) return null;
  const mult = MODE_MULTIPLIER[mode];
  return {
    aircraft,
    mode,
    label: cfg.label,
    spec: cfg.spec,
    image: cfg.image || null,
    base: cfg.base,
    G3: Math.round(cfg.base * mult * 100) / 100, // 2dp tolerance, matches sheet rounding
  };
}

/**
 * Discord slash-command choice list. Only ACTIVE aircraft surface to players.
 * Discord allows up to 25 choices per parameter — we have headroom for all 16.
 */
function aircraftChoices() {
  return ACTIVE_AIRCRAFT.map(name => ({
    name: RAW[name]?.label || name,
    value: name,
  }));
}

function modeChoices() {
  return [
    { name: 'Easy',    value: 'easy' },
    { name: 'Realism', value: 'realism' },
  ];
}

module.exports = {
  resolve,
  aircraftChoices,
  modeChoices,
  ACTIVE_AIRCRAFT,
  MODES,
  RAW,
};

===== END FILE =====

===== FILE: contributions-calculator/card-template.html =====
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Contribution Calculator</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1200px;
    background: #ffffff;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #222;
    -webkit-font-smoothing: antialiased;
  }

  /* Header bar — gold for Easy, green for Realism */
  .header {
    background: {{HEADER_BG}};
    color: #ffffff;
    text-align: center;
    padding: 22px 0;
    font-size: 28px;
    font-weight: 800;
    letter-spacing: 1.5px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.25);
    border-bottom: 3px solid rgba(0,0,0,0.15);
  }

  /* Aircraft spec strip */
  .spec-strip {
    display: flex;
    align-items: center;
    background: linear-gradient(180deg, #f7f7f7 0%, #ececec 100%);
    border-bottom: 1px solid #d6d6d6;
    padding: 18px 24px;
    gap: 24px;
    min-height: 130px;
  }
  .spec-strip .photo {
    width: 280px;
    height: 130px;
    flex-shrink: 0;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  }
  .spec-strip .photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .spec-strip .text {
    flex-grow: 1;
  }
  .spec-strip .label {
    font-size: 24px;
    font-weight: 700;
    color: #333;
    letter-spacing: 0.5px;
  }
  .spec-strip .specs {
    font-size: 14px;
    color: #666;
    margin-top: 4px;
  }
  .spec-strip .g3 {
    text-align: right;
    flex-shrink: 0;
    color: #2a6; /* green G3 readout */
  }
  .spec-strip .g3 .label-small {
    font-size: 12px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .spec-strip .g3 .value {
    font-size: 26px;
    font-weight: 700;
  }

  /* Section heading bar */
  .section-title {
    background: #2a3f6e;
    color: #ffffff;
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  /* Generic table */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 16px;
  }
  thead th {
    background: #f0f3fa;
    color: #333;
    font-weight: 700;
    padding: 12px 14px;
    border: 1px solid #c8d0e0;
    text-align: center;
  }
  tbody td {
    padding: 12px 14px;
    border: 1px solid #d4d4d4;
    text-align: center;
    background: #ffffff;
  }
  tbody tr td:first-child {
    background: #f8f8f8;
    font-weight: 700;
    color: #555;
    width: 50px;
  }

  /* Input cells (red text) */
  .input-cell { color: #c8102e; font-weight: 600; }
  /* Output cells (green text) */
  .output-cell { color: #2a8c4a; font-weight: 600; }
  /* Dead zone marker */
  .dead-zone {
    background: #2b2b2b !important;
    color: #ffd000 !important;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.5px;
  }
  /* Empty placeholder in unfilled rows */
  .empty { color: #ccc; font-weight: 400; }
  /* Default (auto-filled) flights count — visually distinct so player knows it's a default */
  .defaulted {
    color: #2a8c4a;
    font-style: italic;
    font-weight: 500;
  }
  .defaulted::after {
    content: ' *';
    color: #888;
  }

  .footer-note {
    padding: 10px 20px;
    font-size: 12px;
    color: #888;
    background: #fafafa;
    border-top: 1px solid #eee;
    text-align: right;
  }

  /* Rank badge — appears next to row number in the output grid */
  .rank-badge {
    display: inline-block;
    min-width: 22px;
    height: 22px;
    line-height: 22px;
    text-align: center;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    margin-left: 4px;
    vertical-align: middle;
  }
  .rank-badge:empty { display: none; }
  .rank-1 { background: #D4AF37; }       /* gold     — best */
  .rank-2 { background: #B0B0B0; }       /* silver   — 2nd */
  .rank-3 { background: #CD7F32; }       /* bronze   — 3rd */
  .rank-4 { background: #888;    }       /* grey     — 4th */
  .rank-  { display: none; }              /* unranked / empty */
</style>
</head>
<body>

<div class="header">{{HEADER_TEXT}}</div>

<div class="spec-strip">
  <div class="photo">
    <img src="{{AIRCRAFT_IMAGE}}" alt="{{AIRCRAFT_LABEL}}" />
  </div>
  <div class="text">
    <div class="label">{{AIRCRAFT_LABEL}}</div>
    <div class="specs">{{AIRCRAFT_SPEC}}</div>
  </div>
  <div class="g3">
    <div class="label-small">G3 Speed Constant</div>
    <div class="value">{{G3_VALUE}}</div>
  </div>
</div>

<!-- Top grid: inputs (Flight time, Distance, Cruise Speed) → Cost Index -->
<div class="section-title">FLIGHT INPUTS</div>
<table>
  <thead>
    <tr>
      <th style="width:50px;"></th>
      <th>Flight time (hrs)</th>
      <th>Distance (km)</th>
      <th>Cruise Speed (kph)</th>
      <th>Cost Index</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>1</td><td class="{{R1_FT_CLASS}}">{{R1_FT}}</td><td class="{{R1_D_CLASS}}">{{R1_D}}</td><td class="{{R1_CS_CLASS}}">{{R1_CS}}</td><td class="{{R1_CI_CLASS}}" {{R1_CI_ATTR}}>{{R1_CI}}</td></tr>
    <tr><td>2</td><td class="{{R2_FT_CLASS}}">{{R2_FT}}</td><td class="{{R2_D_CLASS}}">{{R2_D}}</td><td class="{{R2_CS_CLASS}}">{{R2_CS}}</td><td class="{{R2_CI_CLASS}}" {{R2_CI_ATTR}}>{{R2_CI}}</td></tr>
    <tr><td>3</td><td class="{{R3_FT_CLASS}}">{{R3_FT}}</td><td class="{{R3_D_CLASS}}">{{R3_D}}</td><td class="{{R3_CS_CLASS}}">{{R3_CS}}</td><td class="{{R3_CI_CLASS}}" {{R3_CI_ATTR}}>{{R3_CI}}</td></tr>
    <tr><td>4</td><td class="{{R4_FT_CLASS}}">{{R4_FT}}</td><td class="{{R4_D_CLASS}}">{{R4_D}}</td><td class="{{R4_CS_CLASS}}">{{R4_CS}}</td><td class="{{R4_CI_CLASS}}" {{R4_CI_ATTR}}>{{R4_CI}}</td></tr>
  </tbody>
</table>

<!-- Bottom grid: Expected Contributions -->
<div class="section-title">EXPECTED CONTRIBUTIONS — RANKED BY 48-HOUR TOTAL</div>
<table>
  <thead>
    <tr>
      <th style="width:60px;">Row<br/><span style="font-weight:400;font-size:11px;color:#666;">(rank)</span></th>
      <th>Cost Index</th>
      <th>Distance (km)</th>
      <th>Expected C/D</th>
      <th>Expected C/F</th>
      <th>Flights / 48h</th>
      <th>Total C/D 48h</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>1 <span class="rank-badge rank-{{O1_RANK}}">{{O1_RANK}}</span></td><td class="{{O1_CI_CLASS}}" {{O1_CI_ATTR}}>{{O1_CI}}</td><td class="{{O1_D_CLASS}}">{{O1_D}}</td><td class="{{O1_CD_CLASS}}">{{O1_CD}}</td><td class="{{O1_CF_CLASS}}">{{O1_CF}}</td><td class="{{O1_FL_CLASS}}">{{O1_FL}}</td><td class="{{O1_TOT_CLASS}}">{{O1_TOT}}</td></tr>
    <tr><td>2 <span class="rank-badge rank-{{O2_RANK}}">{{O2_RANK}}</span></td><td class="{{O2_CI_CLASS}}" {{O2_CI_ATTR}}>{{O2_CI}}</td><td class="{{O2_D_CLASS}}">{{O2_D}}</td><td class="{{O2_CD_CLASS}}">{{O2_CD}}</td><td class="{{O2_CF_CLASS}}">{{O2_CF}}</td><td class="{{O2_FL_CLASS}}">{{O2_FL}}</td><td class="{{O2_TOT_CLASS}}">{{O2_TOT}}</td></tr>
    <tr><td>3 <span class="rank-badge rank-{{O3_RANK}}">{{O3_RANK}}</span></td><td class="{{O3_CI_CLASS}}" {{O3_CI_ATTR}}>{{O3_CI}}</td><td class="{{O3_D_CLASS}}">{{O3_D}}</td><td class="{{O3_CD_CLASS}}">{{O3_CD}}</td><td class="{{O3_CF_CLASS}}">{{O3_CF}}</td><td class="{{O3_FL_CLASS}}">{{O3_FL}}</td><td class="{{O3_TOT_CLASS}}">{{O3_TOT}}</td></tr>
    <tr><td>4 <span class="rank-badge rank-{{O4_RANK}}">{{O4_RANK}}</span></td><td class="{{O4_CI_CLASS}}" {{O4_CI_ATTR}}>{{O4_CI}}</td><td class="{{O4_D_CLASS}}">{{O4_D}}</td><td class="{{O4_CD_CLASS}}">{{O4_CD}}</td><td class="{{O4_CF_CLASS}}">{{O4_CF}}</td><td class="{{O4_FL_CLASS}}">{{O4_FL}}</td><td class="{{O4_TOT_CLASS}}">{{O4_TOT}}</td></tr>
  </tbody>
</table>

<div class="footer-note">* Flights value auto-calculated from flight time. Override with the <code>flights</code> parameter on /row.</div>

</body>
</html>

===== END FILE =====

===== FILE: contributions-calculator/renderer-route.js =====
'use strict';

/**
 * Renderer route — Contributions Calculator card
 *
 * Mounts on the existing ATLAS Express service at:
 *   POST /calc/render  → returns image/png
 *
 * Reuses the ATLAS Puppeteer instance. If your ATLAS service already exports
 * `getBrowser()` from a shared puppeteer module, point the require below at it.
 * Otherwise a fallback launcher is provided.
 *
 * Input JSON shape:
 *   {
 *     aircraft: 'A380',
 *     mode:     'easy' | 'realism',
 *     rows: [
 *       { ft: 12, d: 13500, cs: 750, flights: 4 },   // any/all fields optional per row
 *       null,                                          // null/undefined = empty row
 *       { ft: 8.9, d: 14500, cs: 1086 },               // flights omitted → defaults
 *       null,
 *     ]
 *   }
 *
 * Output: PNG buffer (image/png)
 */

const fs = require('fs');
const path = require('path');
const { calculateRow, fmt, fmtInt, DEAD_ZONE_LABEL } = require('./calc-engine');
const { resolve } = require('./aircraft-constants');

const ASSETS_DIR = path.join(__dirname, 'assets');

// In-memory cache of base64-embedded images so Puppeteer doesn't have to fetch from disk per render
const _imageCache = new Map();
function imageDataURL(filename) {
  if (!filename) return '';
  if (_imageCache.has(filename)) return _imageCache.get(filename);
  const filepath = path.join(ASSETS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn('[CALC-RENDER] image not found:', filename);
    return '';
  }
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'png' ? 'image/png' : 'application/octet-stream');
  const b64 = fs.readFileSync(filepath).toString('base64');
  const url = `data:${mime};base64,${b64}`;
  _imageCache.set(filename, url);
  return url;
}

// Try to use ATLAS's shared Puppeteer; fall back to local launch if not available.
let getBrowser;
try {
  ({ getBrowser } = require('./puppeteer-shared'));
} catch (_) {
  const puppeteer = require('puppeteer');
  let _browser = null;
  getBrowser = async () => {
    if (_browser && _browser.isConnected()) return _browser;
    _browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    return _browser;
  };
}

const TEMPLATE_PATH = path.join(__dirname, 'card-template.html');
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// Header colours
const HEADER_BG = {
  easy: '#D4AF37',    // warm metallic gold
  realism: '#1E7A3C', // deep saturated green
};

/**
 * Build the placeholder map for the template.
 */
function buildPlaceholders(state) {
  const cfg = resolve(state.aircraft, state.mode);
  if (!cfg) {
    throw new Error(`unknown_aircraft_or_mode:${state.aircraft}/${state.mode}`);
  }

  const headerText = `${cfg.label.toUpperCase()} ${cfg.mode === 'easy' ? 'EASY' : 'REALISM'} MODE CONTRIBUTIONS CALCULATOR`;

  const ph = {
    HEADER_BG: HEADER_BG[cfg.mode],
    HEADER_TEXT: headerText,
    AIRCRAFT_LABEL: cfg.label,
    AIRCRAFT_SPEC: cfg.spec || '',
    AIRCRAFT_IMAGE: imageDataURL(cfg.image),
    G3_VALUE: fmt(cfg.G3, 0),
  };

  const rows = (state.rows && Array.isArray(state.rows)) ? state.rows : [null, null, null, null];

  for (let i = 0; i < 4; i++) {
    const r = i + 1;
    const row = rows[i];
    if (!row || row.ft === undefined || row.d === undefined || row.cs === undefined) {
      // Empty row — all cells blank
      ph[`R${r}_FT`]  = '';   ph[`R${r}_FT_CLASS`]  = 'empty';
      ph[`R${r}_D`]   = '';   ph[`R${r}_D_CLASS`]   = 'empty';
      ph[`R${r}_CS`]  = '';   ph[`R${r}_CS_CLASS`]  = 'empty';
      ph[`R${r}_CI`]  = '';   ph[`R${r}_CI_CLASS`]  = 'empty';
      ph[`R${r}_CI_ATTR`] = '';
      ph[`O${r}_CI`]  = '';   ph[`O${r}_CI_CLASS`]  = 'empty';
      ph[`O${r}_CI_ATTR`] = '';
      ph[`O${r}_D`]   = '';   ph[`O${r}_D_CLASS`]   = 'empty';
      ph[`O${r}_CD`]  = '';   ph[`O${r}_CD_CLASS`]  = 'empty';
      ph[`O${r}_CF`]  = '';   ph[`O${r}_CF_CLASS`]  = 'empty';
      ph[`O${r}_FL`]  = '';   ph[`O${r}_FL_CLASS`]  = 'empty';
      ph[`O${r}_TOT`] = '';   ph[`O${r}_TOT_CLASS`] = 'empty';
      continue;
    }

    const calc = calculateRow({
      flightTime: Number(row.ft),
      distance:   Number(row.d),
      cruiseSpeed: Number(row.cs),
      G3: cfg.G3,
      mode: cfg.mode,
      flights: row.flights,
    });

    // Inputs (always show what the player typed)
    ph[`R${r}_FT`] = fmt(Number(row.ft), 1);    ph[`R${r}_FT_CLASS`] = 'input-cell';
    ph[`R${r}_D`]  = fmtInt(Number(row.d));     ph[`R${r}_D_CLASS`]  = 'input-cell';
    ph[`R${r}_CS`] = fmtInt(Number(row.cs));    ph[`R${r}_CS_CLASS`] = 'input-cell';

    if (!calc.ok && calc.reason === 'dead_zone') {
      // Dead zone — top grid CI cell shows the marker; bottom row entirely dead-zoned
      ph[`R${r}_CI`] = DEAD_ZONE_LABEL;
      ph[`R${r}_CI_CLASS`] = 'dead-zone';
      ph[`R${r}_CI_ATTR`] = `colspan="1"`;

      ph[`O${r}_CI`]  = DEAD_ZONE_LABEL; ph[`O${r}_CI_CLASS`] = 'dead-zone';
      ph[`O${r}_CI_ATTR`] = `colspan="6"`; // span the rest of the row
      // Other cells in this output row will be hidden by the colspan above —
      // but since our template renders them as separate <td>, we emit blanks
      // and rely on the visual that the dead-zone cell visually dominates.
      // Simpler: don't use colspan, just mark all output cells as dead-zone styled.
      ph[`O${r}_CI_ATTR`] = '';
      ph[`O${r}_D`]   = fmtInt(Number(row.d)); ph[`O${r}_D_CLASS`]   = 'dead-zone';
      ph[`O${r}_CD`]  = '—';                    ph[`O${r}_CD_CLASS`]  = 'dead-zone';
      ph[`O${r}_CF`]  = '—';                    ph[`O${r}_CF_CLASS`]  = 'dead-zone';
      ph[`O${r}_FL`]  = '—';                    ph[`O${r}_FL_CLASS`]  = 'dead-zone';
      ph[`O${r}_TOT`] = '—';                    ph[`O${r}_TOT_CLASS`] = 'dead-zone';
      continue;
    }

    if (!calc.ok && calc.reason === 'out_of_range') {
      ph[`R${r}_CI`] = `> ${fmtInt(calc.max)} km`;
      ph[`R${r}_CI_CLASS`] = 'dead-zone';
      ph[`R${r}_CI_ATTR`] = '';
      ph[`O${r}_CI`]  = 'OUT OF RANGE'; ph[`O${r}_CI_CLASS`] = 'dead-zone';
      ph[`O${r}_CI_ATTR`] = '';
      ph[`O${r}_D`]   = fmtInt(Number(row.d)); ph[`O${r}_D_CLASS`] = 'dead-zone';
      ph[`O${r}_CD`]  = '—'; ph[`O${r}_CD_CLASS`] = 'dead-zone';
      ph[`O${r}_CF`]  = '—'; ph[`O${r}_CF_CLASS`] = 'dead-zone';
      ph[`O${r}_FL`]  = '—'; ph[`O${r}_FL_CLASS`] = 'dead-zone';
      ph[`O${r}_TOT`] = '—'; ph[`O${r}_TOT_CLASS`] = 'dead-zone';
      continue;
    }

    if (!calc.ok) {
      // Generic invalid — show the reason rather than fake numbers
      ph[`R${r}_CI`] = 'INVALID';
      ph[`R${r}_CI_CLASS`] = 'dead-zone';
      ph[`R${r}_CI_ATTR`] = '';
      ph[`O${r}_CI`]  = 'INVALID'; ph[`O${r}_CI_CLASS`] = 'dead-zone';
      ph[`O${r}_CI_ATTR`] = '';
      ph[`O${r}_D`]   = fmtInt(Number(row.d)); ph[`O${r}_D_CLASS`] = 'dead-zone';
      ph[`O${r}_CD`]  = '—'; ph[`O${r}_CD_CLASS`] = 'dead-zone';
      ph[`O${r}_CF`]  = '—'; ph[`O${r}_CF_CLASS`] = 'dead-zone';
      ph[`O${r}_FL`]  = '—'; ph[`O${r}_FL_CLASS`] = 'dead-zone';
      ph[`O${r}_TOT`] = '—'; ph[`O${r}_TOT_CLASS`] = 'dead-zone';
      continue;
    }

    // OK row — populate everything
    ph[`R${r}_CI`] = fmt(calc.costIndex, 2);
    ph[`R${r}_CI_CLASS`] = 'output-cell';
    ph[`R${r}_CI_ATTR`] = '';

    ph[`O${r}_CI`]  = fmt(calc.costIndex, 2);    ph[`O${r}_CI_CLASS`]  = 'output-cell';
    ph[`O${r}_CI_ATTR`] = '';
    ph[`O${r}_D`]   = fmtInt(Number(row.d));     ph[`O${r}_D_CLASS`]   = 'input-cell';
    ph[`O${r}_CD`]  = fmt(calc.expectedCD, 2);   ph[`O${r}_CD_CLASS`]  = 'output-cell';
    ph[`O${r}_CF`]  = fmt(calc.expectedCF, 2);   ph[`O${r}_CF_CLASS`]  = 'output-cell';
    ph[`O${r}_FL`]  = fmtInt(calc.flights);
    ph[`O${r}_FL_CLASS`] = calc.flightsWasDefaulted ? 'defaulted' : 'output-cell';
    ph[`O${r}_TOT`] = fmt(calc.totalCD48h, 2);   ph[`O${r}_TOT_CLASS`] = 'output-cell';

    // Stash the rankable value for the second pass below
    ph[`__RANK_VAL_${r}`] = calc.totalCD48h;
  }

  // -- Second pass: rank by Total C/D 48h --------------------------------
  // Only rows with a finite numeric totalCD48h participate in ranking.
  // Dead-zone, out-of-range, invalid, and empty rows are unranked (badge = '').
  const rankable = [];
  for (let r = 1; r <= 4; r++) {
    const v = ph[`__RANK_VAL_${r}`];
    if (Number.isFinite(v)) rankable.push({ row: r, val: v });
  }
  rankable.sort((a, b) => b.val - a.val); // descending — biggest contributions first

  // Default all four output-row badges to empty
  for (let r = 1; r <= 4; r++) {
    ph[`O${r}_RANK`] = '';
  }
  // Stamp rank badges on the rows that placed
  for (let i = 0; i < rankable.length; i++) {
    const rankNum = i + 1; // 1 = best, 4 = worst
    ph[`O${rankable[i].row}_RANK`] = String(rankNum);
  }
  // Clean up internal stash keys (don't leak into placeholder substitution)
  for (let r = 1; r <= 4; r++) delete ph[`__RANK_VAL_${r}`];

  return ph;
}

function fillTemplate(html, ph) {
  return html.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const v = ph[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * Public render function — returns a PNG Buffer.
 */
async function renderCard(state) {
  const ph = buildPlaceholders(state);
  const html = fillTemplate(TEMPLATE, ph);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
    // Auto-fit screenshot to body height
    const body = await page.$('body');
    const png = await body.screenshot({ type: 'png', omitBackground: false });
    return png;
  } finally {
    await page.close();
  }
}

/**
 * Express route handler. Mount with:
 *   const calcRender = require('./renderer-route');
 *   app.post('/calc/render', calcRender.handler);
 */
async function handler(req, res) {
  try {
    const state = req.body || {};
    if (!state.aircraft || !state.mode) {
      return res.status(400).json({ ok: false, error: 'missing_aircraft_or_mode' });
    }
    const png = await renderCard(state);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    return res.send(png);
  } catch (err) {
    console.error('[CALC-RENDER]', err.message);
    return res.status(500).json({ ok: false, error: 'render_failed' });
  }
}

module.exports = { renderCard, handler };

===== END FILE =====

===== FILE: contributions-calculator/state-store.js =====
'use strict';

/**
 * Per-channel state store — Contributions Calculator
 *
 * Tracks which Discord message in each channel is the "live" calculator card,
 * and the four rows of input state behind it. Survives bot restarts.
 *
 * Storage: single JSON file at STATE_PATH (default: /tmp/calc-state.json).
 * Override with CALC_STATE_PATH env var for persistent disk on Render
 * (e.g. /var/data/calc-state.json if you have a persistent disk mounted).
 *
 * Concurrency: in-process Map is the source of truth; writes to disk are
 * debounced 1s and atomic (write-rename). Multi-instance not supported —
 * acceptable for single-Render-service deployment.
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = process.env.CALC_STATE_PATH || '/tmp/calc-state.json';
const WRITE_DEBOUNCE_MS = 1000;

let _state = new Map(); // channelId -> { aircraft, mode, rows, messageId, updatedAt }
let _writeTimer = null;
let _loaded = false;

function load() {
  if (_loaded) return;
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = fs.readFileSync(STATE_PATH, 'utf8');
      const obj = JSON.parse(raw);
      _state = new Map(Object.entries(obj));
      console.log(`[CALC-STATE] loaded ${_state.size} channel entries from ${STATE_PATH}`);
    } else {
      console.log(`[CALC-STATE] no existing state file at ${STATE_PATH} — starting empty`);
    }
  } catch (err) {
    console.error(`[CALC-STATE] load failed (${err.message}) — starting empty`);
    _state = new Map();
  }
  _loaded = true;
}

function flush() {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = Object.fromEntries(_state);
    const tmp = STATE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, STATE_PATH);
  } catch (err) {
    console.error(`[CALC-STATE] flush failed: ${err.message}`);
  }
}

function scheduleFlush() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    flush();
  }, WRITE_DEBOUNCE_MS);
}

function getChannel(channelId) {
  load();
  return _state.get(channelId) || null;
}

function newCard(channelId, { aircraft, mode, messageId }) {
  load();
  const entry = {
    aircraft,
    mode,
    rows: [null, null, null, null],
    messageId: messageId || null,
    updatedAt: new Date().toISOString(),
  };
  _state.set(channelId, entry);
  scheduleFlush();
  return entry;
}

function setMessageId(channelId, messageId) {
  load();
  const entry = _state.get(channelId);
  if (!entry) return null;
  entry.messageId = messageId;
  entry.updatedAt = new Date().toISOString();
  _state.set(channelId, entry);
  scheduleFlush();
  return entry;
}

/**
 * Update one row (n: 1..4) with provided values.
 * Returns the updated channel entry, or null if no card exists for this channel.
 */
function setRow(channelId, n, { ft, d, cs, flights }) {
  load();
  const entry = _state.get(channelId);
  if (!entry) return null;
  if (n < 1 || n > 4) return null;
  entry.rows[n - 1] = { ft, d, cs, flights: flights ?? null };
  entry.updatedAt = new Date().toISOString();
  _state.set(channelId, entry);
  scheduleFlush();
  return entry;
}

function clearChannel(channelId) {
  load();
  _state.delete(channelId);
  scheduleFlush();
}

function dump() {
  load();
  return Object.fromEntries(_state);
}

// Flush on process exit
process.on('SIGTERM', () => { if (_writeTimer) { clearTimeout(_writeTimer); flush(); } });
process.on('SIGINT',  () => { if (_writeTimer) { clearTimeout(_writeTimer); flush(); } });

module.exports = {
  getChannel,
  newCard,
  setMessageId,
  setRow,
  clearChannel,
  dump,
  STATE_PATH,
};

===== END FILE =====

===== FILE: contributions-calculator/audit-log.js =====
'use strict';

/**
 * Audit log — Contributions Calculator
 *
 * Posts a per-command audit entry to the dedicated admin channel
 * (ad-cd-cc, ID 1501294484326191205 by default).
 *
 * Soft-fail: if the audit channel can't be reached, logs to console and
 * returns. The player's command must NEVER fail because audit failed.
 *
 * Override channel via env var: CALC_AUDIT_CHANNEL_ID
 */

const AUDIT_CHANNEL_ID = process.env.CALC_AUDIT_CHANNEL_ID || '1501294484326191205';

const CHANNEL_NAMES = {
  '1500865887539040283': 'calc-1',
  '1500865953767096391': 'calc-2',
  '1500866010314707104': 'calc-3',
  '1500866070519746682': 'calc-4',
};

function nameForChannel(id) {
  return CHANNEL_NAMES[id] || `#${id}`;
}

/**
 * Format a /contribution audit entry.
 */
function formatContribution({ user, channelId, aircraft, mode, ts }) {
  return [
    `🟢 \`/contribution\``,
    `> **user**   ${user.username} (\`${user.id}\`)`,
    `> **channel** ${nameForChannel(channelId)}`,
    `> **params**  aircraft=\`${aircraft}\` mode=\`${mode}\``,
    `> **at**      ${ts}`,
  ].join('\n');
}

/**
 * Format a /row audit entry. Includes computed outputs when available.
 */
function formatRow({ user, channelId, aircraft, mode, n, ft, d, cs, flights, calc, ts }) {
  const lines = [
    `🔵 \`/row\``,
    `> **user**   ${user.username} (\`${user.id}\`)`,
    `> **channel** ${nameForChannel(channelId)}`,
    `> **aircraft/mode** \`${aircraft}\` / \`${mode}\``,
    `> **row ${n}**  ft=\`${ft}\` d=\`${d}\` cs=\`${cs}\` flights=\`${flights ?? 'auto'}\``,
  ];
  if (calc) {
    if (calc.ok) {
      lines.push(`> **outputs**  CI=\`${num(calc.costIndex)}\` C/D=\`${num(calc.expectedCD)}\` C/F=\`${num(calc.expectedCF)}\` flights=\`${calc.flights}\` total=\`${num(calc.totalCD48h)}\``);
    } else {
      lines.push(`> **outcome**  \`${calc.reason}\`${calc.label ? ' — ' + calc.label : ''}`);
    }
  }
  lines.push(`> **at**      ${ts}`);
  return lines.join('\n');
}

/**
 * Format a /reset or other utility audit entry.
 */
function formatReset({ user, channelId, ts }) {
  return [
    `⚪ \`/reset\``,
    `> **user**   ${user.username} (\`${user.id}\`)`,
    `> **channel** ${nameForChannel(channelId)}`,
    `> **at**      ${ts}`,
  ].join('\n');
}

function num(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function tsNow() {
  // ISO with offset; readable in any timezone
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/**
 * Post an audit entry to the admin channel. Never throws.
 *
 * @param {Client} client     discord.js client
 * @param {string} content    pre-formatted audit message
 */
async function send(client, content) {
  try {
    if (!client || !client.isReady?.()) return;
    const channel = await client.channels.fetch(AUDIT_CHANNEL_ID).catch(() => null);
    if (!channel) {
      console.warn('[CALC-AUDIT] audit channel not reachable — skipping log');
      return;
    }
    await channel.send({ content }).catch(err => {
      console.warn('[CALC-AUDIT] send failed:', err.message);
    });
  } catch (err) {
    console.warn('[CALC-AUDIT] unexpected error:', err.message);
  }
}

module.exports = {
  AUDIT_CHANNEL_ID,
  formatContribution,
  formatRow,
  formatReset,
  send,
  tsNow,
};

===== END FILE =====

===== FILE: contributions-calculator/bot.js =====
'use strict';

/**
 * Contributions Calculator Bot — ATLAS / Beagle server
 *
 * Token contract:
 *   process.env.CONTRIBUTIONS_CALCULATOR_BOT  (Render env)
 *   Throws CALC_BOT_TOKEN_MISSING at startup if absent.
 *   Never logged, never returned, never embedded in error messages.
 *
 * Commands (slash):
 *   /contribution aircraft:<choice> mode:<easy|realism>
 *     → posts blank calculator card in current channel
 *     → only allowed in ALLOWED_CHANNELS
 *
 *   /row n:<1-4> ft:<num> d:<num> cs:<num> [flights:<1-60>]
 *     → fills row n of the channel's existing card
 *     → edits the card image in place
 *
 * Channel scoping: ALLOWED_CHANNELS is hard-coded for the four calc channels
 * in the Beagle server. Commands run elsewhere are politely refused.
 */

const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  REST,
  Routes,
} = require('discord.js');

const { renderCard } = require('./renderer-route');
const { resolve, aircraftChoices, modeChoices } = require('./aircraft-constants');
const state = require('./state-store');
const audit = require('./audit-log');
const { calculateRow } = require('./calc-engine');

// -- Config -----------------------------------------------------------

const CALC_BOT_TOKEN = process.env.CONTRIBUTIONS_CALCULATOR_BOT;
if (!CALC_BOT_TOKEN) {
  throw new Error('CALC_BOT_TOKEN_MISSING');
}

const APP_ID = process.env.CALC_BOT_APP_ID || '1501277882641678436';
const GUILD_ID = process.env.CALC_BOT_GUILD_ID || '1146523033650090106';

const ALLOWED_CHANNELS = new Set([
  process.env.CALC_CHANNEL_1 || '1500865887539040283', // calc-1
  process.env.CALC_CHANNEL_2 || '1500865953767096391', // calc-2
  process.env.CALC_CHANNEL_3 || '1500866010314707104', // calc-3
  process.env.CALC_CHANNEL_4 || '1500866070519746682', // calc-4
]);

// -- Client -----------------------------------------------------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', () => {
  console.log(`[CALC-BOT] online as ${client.user.tag} (id=${client.user.id})`);
  console.log(`[CALC-BOT] guild=${GUILD_ID} allowed_channels=${ALLOWED_CHANNELS.size}`);
});

client.on('error', (err) => {
  console.error('[CALC-BOT] client error:', err.message);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Channel scope check
  if (!ALLOWED_CHANNELS.has(interaction.channelId)) {
    return interaction.reply({
      content: 'This calculator only runs in the dedicated calc channels.',
      ephemeral: true,
    });
  }

  try {
    if (interaction.commandName === 'contribution') {
      await handleContribution(interaction);
    } else if (interaction.commandName === 'row') {
      await handleRow(interaction);
    } else if (interaction.commandName === 'reset') {
      await handleReset(interaction);
    }
  } catch (err) {
    console.error(`[CALC-BOT] handler error (${interaction.commandName}):`, err.message);
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'Something went wrong rendering the card.', ephemeral: true });
      } catch (_) { /* ignore */ }
    }
  }
});

// -- /contribution ----------------------------------------------------

async function handleContribution(interaction) {
  const aircraft = interaction.options.getString('aircraft', true);
  const mode = interaction.options.getString('mode', true);

  const cfg = resolve(aircraft, mode);
  if (!cfg) {
    return interaction.reply({
      content: `Aircraft "${aircraft}" not active or mode "${mode}" unknown.`,
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  // Reset state for this channel — new card
  state.newCard(interaction.channelId, { aircraft, mode, messageId: null });
  const png = await renderCard({ aircraft, mode, rows: [null, null, null, null] });
  const file = new AttachmentBuilder(png, { name: `${aircraft}_${mode}.png` });

  const sent = await interaction.editReply({ files: [file] });
  state.setMessageId(interaction.channelId, sent.id);

  // Audit (soft-fail, never blocks player)
  audit.send(client, audit.formatContribution({
    user: interaction.user,
    channelId: interaction.channelId,
    aircraft, mode,
    ts: audit.tsNow(),
  }));
}

// -- /row -------------------------------------------------------------

async function handleRow(interaction) {
  const channelId = interaction.channelId;
  const entry = state.getChannel(channelId);

  if (!entry) {
    return interaction.reply({
      content: 'No calculator card in this channel yet. Run `/contribution` first.',
      ephemeral: true,
    });
  }

  const n = interaction.options.getInteger('n', true);
  const ft = interaction.options.getNumber('ft', true);
  const d  = interaction.options.getNumber('d', true);
  const cs = interaction.options.getNumber('cs', true);
  const flights = interaction.options.getInteger('flights', false);

  // Light validation — heavy validation happens in calc-engine
  if (ft <= 0 || ft > 48) {
    return interaction.reply({ content: `Flight time ${ft}h is out of range (0–48).`, ephemeral: true });
  }
  if (d <= 0 || d > 22000) {
    return interaction.reply({ content: `Distance ${d} km is out of range (0–22,000).`, ephemeral: true });
  }
  if (cs <= 0 || cs > 5000) {
    return interaction.reply({ content: `Cruise speed ${cs} kph is out of range.`, ephemeral: true });
  }
  if (flights !== null && flights !== undefined && (flights < 1 || flights > 60)) {
    return interaction.reply({ content: `Flights ${flights} is out of range (1–60).`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  state.setRow(channelId, n, { ft, d, cs, flights: flights ?? null });
  const updated = state.getChannel(channelId);

  // Compute calc once for the audit log (renderer will compute its own copy)
  const cfg = resolve(updated.aircraft, updated.mode);
  const auditCalc = cfg ? calculateRow({
    flightTime: ft, distance: d, cruiseSpeed: cs, G3: cfg.G3, mode: cfg.mode,
    flights: flights ?? undefined,
  }) : null;

  const png = await renderCard({
    aircraft: updated.aircraft,
    mode: updated.mode,
    rows: updated.rows,
  });
  const file = new AttachmentBuilder(png, { name: `${updated.aircraft}_${updated.mode}.png` });

  // Edit the existing card message in-place
  let posted = false;
  if (updated.messageId) {
    try {
      const channel = await client.channels.fetch(channelId);
      const msg = await channel.messages.fetch(updated.messageId);
      await msg.edit({ files: [file], attachments: [] });
      await interaction.editReply({ content: `Row ${n} updated.` });
      posted = true;
    } catch (err) {
      console.error('[CALC-BOT] edit failed, posting fresh:', err.message);
    }
  }

  if (!posted) {
    // Fall back to posting a new card if the prior message can't be edited
    const channel = await client.channels.fetch(channelId);
    const sent = await channel.send({ files: [file] });
    state.setMessageId(channelId, sent.id);
    await interaction.editReply({ content: `Row ${n} updated (new card posted).` });
  }

  // Audit (soft-fail, never blocks player)
  audit.send(client, audit.formatRow({
    user: interaction.user,
    channelId,
    aircraft: updated.aircraft,
    mode: updated.mode,
    n, ft, d, cs, flights,
    calc: auditCalc,
    ts: audit.tsNow(),
  }));
}

// -- /reset (utility) -------------------------------------------------

async function handleReset(interaction) {
  state.clearChannel(interaction.channelId);
  audit.send(client, audit.formatReset({
    user: interaction.user,
    channelId: interaction.channelId,
    ts: audit.tsNow(),
  }));
  return interaction.reply({
    content: 'Calculator state cleared for this channel. Run `/contribution` to start a fresh card.',
    ephemeral: true,
  });
}

// -- Start ------------------------------------------------------------

function start() {
  client.login(CALC_BOT_TOKEN).catch(err => {
    // Mask any token-like fragment from error message
    const msg = String(err.message || err).replace(/[A-Za-z0-9._-]{40,}/g, '***');
    console.error('[CALC-BOT] login failed:', msg);
    process.exit(1);
  });
}

module.exports = { start, client, ALLOWED_CHANNELS };

// Allow running as a standalone process: `node bot.js`
if (require.main === module) {
  start();
}

===== END FILE =====

===== FILE: contributions-calculator/register-commands.js =====
'use strict';

/**
 * Slash command registration — Contributions Calculator
 *
 * Run once after deploy, then re-run only when command structure changes:
 *   node register-commands.js
 *
 * Registers commands to the Beagle guild ONLY (not global).
 * Guild-scoped commands appear within seconds; global commands take up to 1 hour.
 *
 * Token: process.env.CONTRIBUTIONS_CALCULATOR_BOT — never logged.
 */

const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { aircraftChoices, modeChoices } = require('./aircraft-constants');

const TOKEN = process.env.CONTRIBUTIONS_CALCULATOR_BOT;
if (!TOKEN) {
  throw new Error('CALC_BOT_TOKEN_MISSING');
}

const APP_ID = process.env.CALC_BOT_APP_ID || '1501277882641678436';
const GUILD_ID = process.env.CALC_BOT_GUILD_ID || '1146523033650090106';

const commands = [
  new SlashCommandBuilder()
    .setName('contribution')
    .setDescription('Post a fresh calculator card in this channel')
    .addStringOption(opt =>
      opt.setName('aircraft')
        .setDescription('Aircraft type')
        .setRequired(true)
        .addChoices(...aircraftChoices()))
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Easy mode (gold) or Realism (green)')
        .setRequired(true)
        .addChoices(...modeChoices())),

  new SlashCommandBuilder()
    .setName('row')
    .setDescription('Fill a row of the active calculator card in this channel')
    .addIntegerOption(opt =>
      opt.setName('n')
        .setDescription('Row number (1–4)')
        .setRequired(true)
        .setMinValue(1).setMaxValue(4))
    .addNumberOption(opt =>
      opt.setName('ft')
        .setDescription('Flight time in hours (e.g. 12 or 8.6)')
        .setRequired(true)
        .setMinValue(0.1).setMaxValue(48))
    .addNumberOption(opt =>
      opt.setName('d')
        .setDescription('Distance in km')
        .setRequired(true)
        .setMinValue(1).setMaxValue(22000))
    .addNumberOption(opt =>
      opt.setName('cs')
        .setDescription('Cruise speed in kph')
        .setRequired(true)
        .setMinValue(1).setMaxValue(5000))
    .addIntegerOption(opt =>
      opt.setName('flights')
        .setDescription('Optional: flights in 48h (1–60). If omitted, defaults to floor(48/ft).')
        .setRequired(false)
        .setMinValue(1).setMaxValue(60)),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Clear this channel\'s calculator state'),
].map(cmd => cmd.toJSON());

(async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log(`[REGISTER] uploading ${commands.length} commands to guild ${GUILD_ID}...`);
    const data = await rest.put(
      Routes.applicationGuildCommands(APP_ID, GUILD_ID),
      { body: commands },
    );
    console.log(`[REGISTER] success — ${data.length} commands registered:`);
    for (const c of data) {
      console.log(`  /${c.name}  (id=${c.id})`);
    }
  } catch (err) {
    const msg = String(err.message || err).replace(/[A-Za-z0-9._-]{40,}/g, '***');
    console.error('[REGISTER] failed:', msg);
    process.exit(1);
  }
})();

===== END FILE =====

===== FILE: contributions-calculator/bootstrap.js =====
'use strict';

/**
 * Bootstrap — Contributions Calculator
 *
 * Single entry point ATLAS imports to start the calculator subsystem
 * inside the existing Render service.
 *
 * Usage in ATLAS's main server file (e.g. server.js):
 *
 *   const calcBootstrap = require('./contributions-calculator/bootstrap');
 *   calcBootstrap.attach(app);   // mounts /calc/render route on Express app
 *
 * Kill switch:
 *   ENABLE_CALC_BOT=false in Render env  → bot does not connect to Discord;
 *                                          render route stays mounted (harmless).
 *   Bot exits cleanly. ATLAS chart pipeline unaffected.
 */

const renderer = require('./renderer-route');
const bot = require('./bot');

function attach(app) {
  if (!app || typeof app.post !== 'function') {
    throw new Error('CALC_BOOTSTRAP_invalid_app');
  }

  // Mount the renderer route — used by the bot in-process via direct require,
  // also exposed at /calc/render for any external testing.
  app.post('/calc/render', require('express').json({ limit: '128kb' }), renderer.handler);
  console.log('[CALC-BOOT] /calc/render route mounted');

  // Start the bot unless explicitly disabled
  if (process.env.ENABLE_CALC_BOT === 'false') {
    console.log('[CALC-BOOT] ENABLE_CALC_BOT=false — bot NOT started');
    return;
  }

  if (!process.env.CONTRIBUTIONS_CALCULATOR_BOT) {
    console.warn('[CALC-BOOT] CONTRIBUTIONS_CALCULATOR_BOT env var missing — bot NOT started');
    return;
  }

  bot.start();
  console.log('[CALC-BOOT] bot started');
}

module.exports = { attach };

===== END FILE =====

===== FILE: contributions-calculator/CONTRIBUTIONS_CALCULATOR_DEPLOY.md =====
# Contributions Calculator — Deploy & Rollback

## What this is

A Discord bot + card renderer for the Beagle server's `calc-1` to `calc-4` channels. Players run `/contribution` and `/row` slash commands to build a four-row contribution comparison card, rendered by Puppeteer to PNG. A380 active at launch (Easy + Realism modes). Other 15 aircraft scaffolded.

## Files in this drop

```
contributions-calculator/
├── calc-engine.js          # Pure formulas, distance-driven coefficient, dead-zone, mode-aware /1.5
├── aircraft-constants.js   # Base speeds + G3 derivation per aircraft+mode
├── card-template.html      # HTML/CSS template, gold/green headers, A380 photo, ranked output grid
├── renderer-route.js       # Puppeteer → PNG, base64-embedded image, rank-by-Total computation
├── state-store.js          # Per-channel state, JSON file persistence
├── audit-log.js            # Posts /contribution, /row, /reset events to ad-cd-cc admin channel
├── bot.js                  # Discord bot, slash command handlers, audit calls
├── register-commands.js    # One-shot command registration to Beagle guild
├── bootstrap.js            # Single entry point ATLAS imports
├── assets/
│   └── a380.jpg            # A380-800 photo for the spec strip
└── CONTRIBUTIONS_CALCULATOR_DEPLOY.md  # this file
```

## Integration into ATLAS (one-time)

1. **Drop the folder into the ATLAS repo:**
   ```
   C:\Users\herbe\Projects\ATLAS_DISCORD_PATHWAY\contributions-calculator\
   ```

2. **Install dependencies** (if discord.js isn't already in ATLAS's package.json):
   ```bash
   cd C:\Users\herbe\Projects\ATLAS_DISCORD_PATHWAY
   npm install discord.js@14
   ```
   (ATLAS already has puppeteer, express, sharp.)

3. **Wire the bootstrap into ATLAS's main server file**, alongside your existing routes:
   ```js
   // In ATLAS server.js (or wherever Express is configured)
   const app = express();
   // ... existing ATLAS routes ...

   const calcBootstrap = require('./contributions-calculator/bootstrap');
   calcBootstrap.attach(app);
   ```

4. **Set Render env vars** (Render dashboard → ATLAS service → Environment):
   ```
   CONTRIBUTIONS_CALCULATOR_BOT = <bot token from Discord developer portal>
   ```
   Optional overrides (defaults are hard-coded for Beagle / calc-1..4):
   ```
   CALC_BOT_APP_ID    = 1501277882641678436
   CALC_BOT_GUILD_ID  = 1146523033650090106
   CALC_CHANNEL_1     = 1500865887539040283
   CALC_CHANNEL_2     = 1500865953767096391
   CALC_CHANNEL_3     = 1500866010314707104
   CALC_CHANNEL_4         = 1500866070519746682
   CALC_AUDIT_CHANNEL_ID  = 1501294484326191205   # ad-cd-cc admin channel
   ENABLE_CALC_BOT        = true
   CALC_STATE_PATH        = /var/data/calc-state.json   # if you have a Render persistent disk
   ```

5. **Commit and push** — Render auto-deploys.

6. **After first deploy succeeds, register slash commands** (one-shot):
   ```bash
   # In Render Shell
   node contributions-calculator/register-commands.js
   ```
   Expected output:
   ```
   [REGISTER] uploading 3 commands to guild 1146523033650090106...
   [REGISTER] success — 3 commands registered:
     /contribution  (id=...)
     /row           (id=...)
     /reset         (id=...)
   ```
   Re-run this only when command structure changes (e.g. adding aircraft to the dropdown).

## Smoke test plan

In Discord, in `calc-1`. Engine-verified expected values (these supersede the master sheet's frozen values for rows 3 and 4 — see "Math notes" below).

### A380 Easy (gold header, G3 = 1731)

1. `/contribution aircraft:A380 mode:easy` → blank gold-headed card with A380 photo, 4 empty rows
2. `/row n:1 ft:12 d:13500 cs:750`
   - CI ≈ 98.75, C/D ≈ 63.73, C/F ≈ 127.45, Flights = 4 (default), Total 48h ≈ 254.90
3. `/row n:2 ft:8.6 d:540 cs:42`
   - CI ≈ -76.59, C/D ≈ 5.97, C/F ≈ 11.93, Flights = 5 (default), Total 48h ≈ 29.83
4. `/row n:3 ft:8.9 d:14500 cs:1086`
   - CI ≈ 181.98, C/D ≈ 40.10, C/F ≈ 80.20, Flights = 5 (default), Total 48h ≈ 200.51
5. `/row n:4 ft:9.1 d:14500 cs:1062`
   - CI ≈ 176.07, C/D ≈ 42.11, C/F ≈ 84.22, Flights = 5 (default), Total 48h ≈ 210.55
6. **Verify rank badges:** Row 1 should be ranked 🥇 (gold, 254.90 highest), Row 4 🥈, Row 3 🥉, Row 2 grey 4th

### A380 Realism (green header, G3 = 1154, no /1.5 divisor)

7. `/contribution aircraft:A380 mode:realism` → fresh green-headed card; G3 readout shows 1154
8. `/row n:1 ft:21 d:16500 cs:786`
   - CI ≈ 107.59, C/D ≈ 111.38, C/F ≈ 222.76, Flights = 2, Total 48h ≈ 222.76
9. `/row n:2 ft:11.5 d:13000 cs:1130`
   - CI ≈ 192.95, C/D ≈ 48.99, C/F ≈ 97.97, Flights = 4, Total 48h ≈ 195.95

### Edge cases

10. Dead zone: `/row n:3 ft:10 d:7500 cs:600` → row 3 shows ☢️ Developer C/D Dead Zone ☣️ across the output cells
11. Out-of-range: `/row n:4 ft:12 d:25000 cs:800` → row 4 shows "OUT OF RANGE"
12. Boundary 6000: `/row n:1 ft:6 d:6000 cs:1000` → uses short-haul coefficient 0.0044, populates normally
13. Boundary 10000: `/row n:1 ft:6 d:10000 cs:1666` → uses long-haul coefficient 0.00353, populates normally
14. `/reset` → channel state cleared, audit log fires

### Audit channel verification

After running the above in `calc-1`, check `#ad-cd-cc`. You should see entries like:

```
🟢 /contribution
> user    atlas.4693 (1234567890)
> channel calc-1
> params  aircraft=A380 mode=easy
> at      2026-05-06 02:48 UTC

🔵 /row
> user    atlas.4693 (1234567890)
> channel calc-1
> aircraft/mode A380 / easy
> row 1   ft=12 d=13500 cs=750 flights=auto
> outputs CI=98.75 C/D=63.73 C/F=127.45 flights=4 total=254.90
> at      2026-05-06 02:48 UTC
```

If audit lines don't appear: bot lacks Send Messages permission in `#ad-cd-cc`. Audit failures are silent and don't block the player's command — by design.

### Multi-channel test

15. Have a second player run commands in `calc-2` simultaneously while you're in `calc-1` → confirm channel isolation (each channel has its own card and its own state).

## Math notes

- Engine's expected values match Nathan's stated coefficient regime (0.0044 short-haul, 0.00353 long-haul declining linearly to 0.0035 at 19,000 km, 0.00349 at 22,000 km).
- For some rows the engine's outputs differ from the master sheet's published values — specifically A380 Easy rows 3 and 4 (sheet shows 50.21 / 52.72 vs engine 40.10 / 42.11). The master sheet's values for those rows are stale, computed when the strategy dropdown was set wrong. Engine values are the game-truth.
- A380 Realism mode applies no /1.5 divisor (Easy applies it).

## Rollback

### Soft rollback — bot off, ATLAS unaffected (no redeploy)

In Render env:
```
ENABLE_CALC_BOT = false
```
Save → service restarts → bot doesn't connect to Discord → /calc/render route stays mounted but unused → ATLAS chart pipeline 100% unaffected.

### Hard rollback — full revert

```bash
git revert <calc-bootstrap-merge-commit>
git push origin main
# Render auto-deploys
# Bot disappears, /calc/render route disappears
# Slash commands remain registered in Discord but return errors —
# unregister them with:
node -e "
const { REST, Routes } = require('discord.js');
const rest = new REST({version:'10'}).setToken(process.env.CONTRIBUTIONS_CALCULATOR_BOT);
rest.put(Routes.applicationGuildCommands('1501277882641678436','1146523033650090106'),{body:[]})
  .then(()=>console.log('cleared'))
"
```

### Cancel the bot entirely

1. Discord developer portal → Contributions Calculator app → delete (or just leave it inactive)
2. Remove `CONTRIBUTIONS_CALCULATOR_BOT` env var from Render
3. Revert as above

## Adding a new aircraft (post-launch)

1. In `aircraft-constants.js`, uncomment the aircraft's entry under `RAW`
2. Add its key to `ACTIVE_AIRCRAFT`
3. Update the aircraft's image in `card-template.html` if you want a non-A380 silhouette (or leave the A380 SVG as a generic "aircraft" graphic)
4. Commit, push, redeploy
5. Re-run `node contributions-calculator/register-commands.js` so the new aircraft appears in the dropdown

That's the entire process per aircraft. ~5 minutes each.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/contribution` doesn't appear in autocomplete | Commands not registered | Run `register-commands.js` |
| Bot logs "CALC_BOT_TOKEN_MISSING" | Env var not set | Set `CONTRIBUTIONS_CALCULATOR_BOT` in Render |
| Bot logs "login failed" with `***` masked | Token wrong, expired, or bot revoked | Reset token in Discord developer portal, update Render env |
| Card image shows blank G3 readout | `aircraft-constants.js` not deployed or wrong | Check the file made it into the build |
| Render times out on `/contribution` | Puppeteer can't launch | Check Puppeteer Chrome install in Render build command (same fix as ATLAS chart cards) |
| Player runs `/contribution` outside calc channels | Channel scope blocks it | Expected — bot tells them politely |
| Bot edits message but image doesn't change | Discord client cache | Player refreshes Discord; new card always edits cleanly server-side |

## Security posture

- Bot token only in Render env, never logged, never embedded in error messages
- Token-shaped strings in any error log are masked with `***`
- Channel scope is enforced server-side — players can't run commands outside `calc-1..4` even if they know the command name
- No webhooks used — all interactions go through Discord's signed gateway
- No persistent player data stored — state-store only tracks the current card per channel

## What this does NOT do

- Does not replace ATLAS chart cards (different bot, different commands, different channels)
- Does not access the Google Sheets master — formulas are baked into `calc-engine.js`
- Does not expose the master spreadsheet to any player
- Does not support webhooks for input (slash commands only — interactive Discord requires a bot)
- Does not handle the four reverse-calculation tables from the master sheet (Speed for C/I, Distance for C/I) — out of scope for this build per the locked spec

===== END FILE =====


═══════════════════════════════════════════════════════════════════════════
END OF BRIEF
═══════════════════════════════════════════════════════════════════════════
