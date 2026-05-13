#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/render_dh_foh_v4_preview.js
//
// Dark Horse FOH.1.0.1 — v4 visual + wording prototype.
//
// v4 extends the operator-approved v3 direction (red NEW
// divider, gold banners, teal terminology, state-coloured
// embeds, iPad-readable typography) with the build-order
// refinements:
//
//   - Wording doctrine lock — every important statement
//     answers "what does that mean / why does it matter /
//     what happens if it fails / how far is acceptable /
//     when does it become dangerous / what is the hard
//     invalidation / what should the trader do next?"
//   - "Where to Act" becomes EXACT — multi-zone disclosure:
//         🟢 ENTRY zone      (healthy area + action)
//         🟡 WATCH level     (caution trigger + action)
//         🟠 CAUTION zone    (danger sign + action)
//         🛑 INVALIDATION    (hard stop + action)
//         🔵 next review     (reassess pointer)
//   - Candidate lifecycle states — FRESH / STILL ACTIVE /
//     FADING — each with its own red NEW BADGE separator
//     header so the reader sees lifecycle at a glance.
//   - Market Mood section with traffic-light rating
//     ●●●●○ (4/5) ELEVATED + operational meaning + what
//     this means for trader behaviour.
//   - Quiet-scan path — when no candidate makes the bar:
//     "what was scanned / what nearly qualified / what
//     pressure is building / what would change the state /
//     when to reassess". No dead filler.
//   - No banned vague wording without explanation: "buyers
//     defend", "breakout level", "holds", "confirms",
//     "weakens", "buy the dip", "risk-off", "setup valid"
//     all replaced or contextualised.
//
// Hard boundary (Pack 8.10):
//   - Presentation/education only.
//   - No scoring / thresholds / scheduler / transport /
//     Corey / Jane / Spidey / macro engine / Market Intel
//     runtime / dashboard / renderer / ranking changes.
//
// Output:
//   docs/screenshots/dh-foh-v4.html / .png / .pdf
//   plus per-message + detail crops + gallery.
// ============================================================

const path = require('path');
const fohRenderer = require('./_foh_renderer.js');

// ── ESC byte + style primitives ─────────────────────────────
const ESC = '';
const STYLE = {
  GOLD: `${ESC}[33;1m`,
  CYAN: `${ESC}[36;1m`,
  GREEN: `${ESC}[32m`,
  RED: `${ESC}[31m`,
  RESET: `${ESC}[0m`,
};

// ── Helpers — same primitives as the live darkHorseFoh module ──
function redNewDividerTop(scanStamp, universeSize) {
  return [
    '```diff',
    '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '- ▼ ▼ ▼   N E W   D A R K   H O R S E   S C A N   ▼ ▼ ▼',
    '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `- 🆕   ${scanStamp} · ${universeSize} markets scanned   🆕`,
    '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '```',
  ].join('\n');
}
function newBadgeSeparator(label) {
  return ['```diff', `- 🆕  ${label}`, '```'].join('\n');
}
function goldSectionBox(headingText) {
  const inner = String(headingText).padEnd(46, ' ');
  return [
    '```ansi',
    `${STYLE.GOLD}╔══════════════════════════════════════════════════╗`,
    `${STYLE.GOLD}║   ${inner}║`,
    `${STYLE.GOLD}╚══════════════════════════════════════════════════╝${STYLE.RESET}`,
    '```',
  ].join('\n');
}
function goldSubheading(text) {
  return ['```ansi', `${STYLE.GOLD}▸  ${text}${STYLE.RESET}`, '```'].join('\n');
}
function tealTerminologyRow(terms) {
  const inner = terms.map(t => `${STYLE.CYAN}[${t}]${STYLE.RESET}`).join('  ');
  return ['```ansi', inner, '```'].join('\n');
}

// ── v4 — Market Mood traffic-light section ──────────────────
// Plain-English operational meaning, rating out of 5, and
// "what this means for trader behaviour" — every requirement
// from operator item 4.
function marketMoodSection() {
  // Active count 4 of 5 = "Elevated". Yellow/orange treatment.
  // Discord ANSI: 33 = gold/yellow for the rating dots inside an
  // ansi fence. The traffic-light glyph 🟡 lives in normal text.
  return [
    goldSubheading('Market Mood  ·  ELEVATED  🟡🟡🟡🟡  (4 / 5)'),
    '',
    '_What this means right now:_',
    '   The broader market is moving fast. Big swings either side are',
    '   more likely than usual. Trades that worked in calm conditions',
    '   are more likely to be whipped out before reaching their target.',
    '',
    '_What this means for your trading this cycle:_',
    '   🟢 Use 60–70% of your normal position size, not 100%.',
    '   🟡 Give risk-off levels more room — wider stops, not tighter.',
    '   🟠 Skip marginal setups. Only act on the cleanest reads below.',
    '   🛑 Do not chase already-extended moves. Wait for the next test.',
  ].join('\n');
}

// ── v4 — Multi-zone "Where to Act" string builder ───────────
// Returns the multi-line string that goes into the "Where to
// Act" embed field. Discord renders \n as line breaks; each
// zone gets its own colour-banded line so the reader walks
// healthy → caution → danger → invalidation as visual gradient.
//
// The doctrine: every zone names a PRICE LEVEL, an
// OBSERVATION (what it means), and a TRADER ACTION (what
// you do if price reaches it).
function whereToActMultiZone({ direction, entryLow, entryHigh, watch, caution, invalidation, nextReviewStamp }) {
  const isShort = direction === 'Bearish';
  const buySell = isShort ? 'SELL' : 'BUY';
  const aboveBelow = isShort ? 'above' : 'below';
  const oppositeAboveBelow = isShort ? 'below' : 'above';
  const ceilingFloor = isShort ? 'floor' : 'ceiling';
  return [
    `🟢 ENTRY zone  ${entryLow} – ${entryHigh}`,
    `   Healthy area for the idea. If price pulls back into this band`,
    `   and pauses, that's where ${buySell.toLowerCase()}ers are expected to step in.`,
    `   Action: ${buySell} small size — scale in only as the level holds.`,
    ``,
    `🟡 WATCH level  ${watch}`,
    `   Caution. A close ${aboveBelow} this on the 1H means the move`,
    `   is losing initial momentum. Don't add. Reduce existing size.`,
    `   Action: hold what you have, do not chase further entries.`,
    ``,
    `🟠 CAUTION zone  ${watch} – ${caution}`,
    `   Sellers (or buyers, if short) gaining the upper hand.`,
    `   Action: scratch the trade for small loss. Stand aside`,
    `   until the next ATLAS scan reads the structure again.`,
    ``,
    `🛑 INVALIDATION  close ${aboveBelow} ${invalidation}`,
    `   Hard stop. The ${isShort ? 'bearish' : 'bullish'} idea is off entirely.`,
    `   Action: exit any remaining size. Do not re-enter`,
    `   until a fresh structure forms on a later scan.`,
    ``,
    `🔵 Next review  ${nextReviewStamp}`,
    `   ATLAS re-reads the structure at the next scan. Live levels`,
    `   above will update with what actually happened in price.`,
  ].join('\n');
}

// ── Visual reference card v4 — readable + scan-context tied ──
// Per operator item 6: reference cards should not feel like
// thumbnails. v4 ties the reference to the current scan
// context — the card names the SAME zones the standouts use
// (healthy / caution / danger / invalidation) so the trader
// sees the pattern they're being shown on EURUSD applied to a
// generic chart-reference layout.
function visualReferenceCard() {
  return [
    '```ansi',
    `${STYLE.GOLD}╔══════════════════════════════════════════════════╗`,
    `${STYLE.GOLD}║   📚  CHART REFERENCE — THE FOUR-ZONE READ        ║`,
    `${STYLE.GOLD}╚══════════════════════════════════════════════════╝${STYLE.RESET}`,
    '',
    `${STYLE.GREEN}   ▲ price                              ╭──── higher${STYLE.RESET}`,
    `${STYLE.GREEN}   │                            ╭──╮ ╱${STYLE.RESET}`,
    `${STYLE.GREEN}   │       🟢 ENTRY  ◄──── ●──╯  ●${STYLE.RESET}   ← buyers stepped in`,
    `${STYLE.GREEN}   │   ─────────────────────────────────${STYLE.RESET}   ← ceiling, now a floor`,
    `${STYLE.RED}   │       🟡 WATCH  ◄─── close below = caution${STYLE.RESET}`,
    `${STYLE.RED}   │       🟠 CAUTION  ◄── sellers winning${STYLE.RESET}`,
    `${STYLE.RED}   │   ─────────────────────────────────${STYLE.RESET}   ← invalidation level`,
    `${STYLE.RED}   │       🛑 INVALIDATION  ◄── idea is off${STYLE.RESET}`,
    `${STYLE.GREEN}   └────────────────────────────────────▶ time${STYLE.RESET}`,
    '',
    `${STYLE.CYAN}   ▸  How to read this${STYLE.RESET}`,
    '       Every Dark Horse candidate above is broken into the same',
    '       four zones. Walk top-down: ENTRY → WATCH → CAUTION →',
    '       INVALIDATION. You always know which zone price is in,',
    '       and what to do about it.',
    '',
    `${STYLE.CYAN}   ▸  How a trader uses this${STYLE.RESET}`,
    '       Match live price to the zone. Only act when price is in',
    '       the GREEN entry zone and conditions match the setup.',
    '       Anything below RED means stand aside or exit. No guessing.',
    '',
    `${STYLE.CYAN}   ▸  Rendered ATLAS charts coming next${STYLE.RESET}`,
    '       Future scans will replace this schematic with a rendered',
    '       ATLAS chart of the actual candidate, with the same four',
    '       zones drawn on the live price action.',
    '```',
  ].join('\n');
}

// ── SAMPLE_MESSAGES — v4 ────────────────────────────────────
const SCAN_STAMP = 'Tuesday 13 May · 12:00 UTC';
const NEXT_REVIEW = '12:15 UTC';
const UNIVERSE_SIZE = 33;

const SAMPLE_MESSAGES = [
  // ── Message 1: banner + Market Mood + STANDOUTS + first embed (FRESH) ──
  {
    content: [
      redNewDividerTop(SCAN_STAMP, UNIVERSE_SIZE),
      '',
      goldSectionBox('🐎  DARK HORSE — GLOBAL MOVER RADAR'),
      '',
      '_3 standouts found this cycle._',
      '_1 fresh (new this scan)  ·  1 still active  ·  1 fading._',
      '',
      '📘 **EXPANDED TERMINOLOGY HYPERLINKS**',
      tealTerminologyRow(['Breakout', 'Retest', 'Pullback', 'Support / Resistance', 'Invalidation']),
      '',
      marketMoodSection(),
      '',
      goldSectionBox('⭐  STANDOUTS — TODAY\'S STRONGEST MOVERS'),
      '',
      newBadgeSeparator('FRESH STANDOUT #1 of 3  ·  EURUSD just appeared on the radar'),
    ].join('\n'),
    embeds: [{
      color: 0x2ECC71,
      title: '🐎  EURUSD  ·  STRONG BULLISH  ·  🆕 FRESH',
      description: 'Price pushed above 1.0950 — a level that had capped EURUSD for the last 3 weeks — and held the level cleanly on the 1H close. The move is new this scan.',
      fields: [
        { name: 'Move Type',      value: 'Breakout · early stage',                  inline: true },
        { name: 'Direction',      value: '▲ Long  (rising bias — price expected to keep moving up)', inline: true },
        { name: 'Conviction',     value: '🟢🟢🟢🟢 / 5 · High',                       inline: true },
        { name: 'Trigger Level',  value: '1.0950 — cleared cleanly on the 1H close', inline: true },
        { name: 'Horizon',        value: 'Swing — days, not minutes',                inline: true },
        { name: 'Today\'s Rank',  value: '1st of today\'s 3 standouts',              inline: true },
        { name: 'Where to Act',   value: whereToActMultiZone({
            direction: 'Bullish',
            entryLow: '1.0920', entryHigh: '1.0935',
            watch: '1.0900', caution: '1.0880',
            invalidation: '1.0875',
            nextReviewStamp: NEXT_REVIEW,
          }), inline: false },
      ],
      footer: { text: `ATLAS · Dark Horse · standout 1 of 3 · first detected at this scan (${SCAN_STAMP})` },
    }],
  },

  // ── Message 2: STILL ACTIVE candidate (XAUUSD, on its 2nd cycle) ──
  {
    content: newBadgeSeparator('STILL ACTIVE STANDOUT #2 of 3  ·  XAUUSD (now in cycle 2)'),
    embeds: [{
      color: 0xE74C3C,
      title: '🐎  XAUUSD  ·  STRONG BEARISH  ·  🔁 STILL ACTIVE',
      description: 'Gold broke below 2398 on the 1H close 2 cycles ago. Sellers are still in control of the structure and the level has held as a ceiling on the bounce.',
      fields: [
        { name: 'Move Type',      value: 'Breakdown · mid stage',                   inline: true },
        { name: 'Direction',      value: '▼ Short  (falling bias — price expected to keep moving down)', inline: true },
        { name: 'Conviction',     value: '🔴🔴🔴🔴 / 5 · High',                        inline: true },
        { name: 'Trigger Level',  value: '2398 — broken 2 cycles ago, ceiling holds', inline: true },
        { name: 'Horizon',        value: 'Swing — days, not minutes',                inline: true },
        { name: 'Today\'s Rank',  value: '2nd of today\'s 3 standouts',              inline: true },
        { name: 'Where to Act',   value: whereToActMultiZone({
            direction: 'Bearish',
            entryLow: '2398', entryHigh: '2402',
            watch: '2406', caution: '2412',
            invalidation: '2415',
            nextReviewStamp: NEXT_REVIEW,
          }), inline: false },
      ],
      footer: { text: `ATLAS · Dark Horse · standout 2 of 3 · first detected 11:30 UTC (cycle 2 of 3)` },
    }],
  },

  // ── Message 3: FADING candidate (NVDA, late stage) ──
  {
    content: newBadgeSeparator('FADING STANDOUT #3 of 3  ·  NVDA — older mover, late-stage caution'),
    embeds: [{
      color: 0xE67E22,
      title: '🐎  NVDA  ·  DEVELOPING WATCH  ·  🌅 FADING',
      description: 'NVIDIA\'s uptrend has been running for 4 cycles. The next push is getting smaller each scan — the move is mature. Wait for the next test, do not chase.',
      fields: [
        { name: 'Move Type',      value: 'Continuation · late stage',                inline: true },
        { name: 'Direction',      value: '▲ Long  (rising bias — but reward is shrinking)', inline: true },
        { name: 'Conviction',     value: '🟠🟠🟠 / 5 · Reduced',                       inline: true },
        { name: 'Trigger Level',  value: '925.40 — still the structural level, but stale', inline: true },
        { name: 'Horizon',        value: 'Intraday — hours, not days',               inline: true },
        { name: 'Today\'s Rank',  value: '3rd of today\'s 3 standouts',              inline: true },
        { name: 'Where to Act',   value: [
            whereToActMultiZone({
              direction: 'Bullish',
              entryLow: '918.00', entryHigh: '922.00',
              watch: '912.80', caution: '906.00',
              invalidation: '902.50',
              nextReviewStamp: NEXT_REVIEW,
            }),
            '',
            '⚠️  Late-stage caveat — the move is older than fresh ones. Half',
            '   normal position size at most. Skip if conditions look messy.',
          ].join('\n'), inline: false },
      ],
      footer: { text: `ATLAS · Dark Horse · standout 3 of 3 · first detected 09:45 UTC (cycle 4 of 4 — fading)` },
    }],
  },

  // ── Message 4: pre-radar + visual reference card + risk reminder ──
  {
    content: [
      newBadgeSeparator('BUILDING  &  CHART REFERENCE'),
      '',
      goldSectionBox('📡  BUILDING — WARMING UP BELOW STANDOUT GRADE'),
      '',
      tealTerminologyRow(['Pre-Radar', 'Momentum', 'Structure', 'Confirmation']),
      '',
      '_Two markets are close to the standout bar but not there yet._',
      '_GBPUSD needs a 1H close above 1.2600 to qualify._',
      '_EURJPY needs momentum to expand on its next push (currently flat)._',
      '_If structure firms by the next scan, they\'ll graduate into a standout._',
      '',
      visualReferenceCard(),
      '',
      goldSubheading('Risk reminder'),
      '_Even a strong standout is a plan, not a guarantee. Every zone above is what ATLAS sees right now — live price moves and the zones move with it. Cross-check the current price against the zone before acting. ATLAS reviews again at ' + NEXT_REVIEW + '._',
    ].join('\n'),
  },
];

// ── Main ────────────────────────────────────────────────────
async function main() {
  const written = await fohRenderer.renderAll(SAMPLE_MESSAGES, {
    outDir: path.join(__dirname, '..', 'docs', 'screenshots'),
    version: 'dh-foh-v4',
    channelName: 'dark-horse-radar',
    displayName: 'ATLAS  ·  Dark Horse Radar',
    subtitle: 'FOH.1.0.1 prototype v4 · multi-zone Where to Act · candidate lifecycle · Market Mood traffic-light',
    title: 'FOH.1.0.1 Dark Horse — v4 prototype',
    sectionNames: ['banner-and-fresh', 'still-active', 'fading', 'reference-card'],
    detailSpecs: [
      { messageIdx: 0, selector: '.message-content', label: 'banner' },
      { messageIdx: 0, selector: '.embed',           label: 'fresh-candidate-embed' },
      { messageIdx: 1, selector: '.embed',           label: 'still-active-candidate-embed' },
      { messageIdx: 2, selector: '.embed',           label: 'fading-candidate-embed' },
      { messageIdx: 3, selector: '.message-content', label: 'reference-card' },
    ],
  });
  console.log('Wrote ' + written.length + ' artefacts:');
  for (const p of written) console.log('  · ' + p);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SAMPLE_MESSAGES };
