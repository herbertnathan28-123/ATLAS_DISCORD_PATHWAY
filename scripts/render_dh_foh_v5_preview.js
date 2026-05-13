#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/render_dh_foh_v5_preview.js
//
// Dark Horse FOH.1.0.1 — v5 prototype.
// Operator doctrine-escalation pass: every major statement now
// answers "what does it mean / why does it matter / what should
// I do / what happens if it changes / dollars-first risk /
// healthy vs caution vs danger vs invalidation".
//
// New in v5 vs v4:
//   - Hyperlink stubs on every unexplained term (Long, Short,
//     Trigger Level, Risk-Off, Invalidation, Pullback, Resistance,
//     Support, Market Mood, Cycle Rank, Fresh/Active/Fading state).
//   - Trigger Level now explains WHY the level matters.
//   - Entry zone shows a price BAND + the price behaviour required.
//   - Watch / Caution / Danger / Invalidation each carry
//     observation + dollar-first drawdown + trader action.
//   - Per-card "What this means" + "What to do next" rows.
//   - Per-card "💲 Dollar risk this trade" row — concrete numbers,
//     pip context only as a footnote (operator doctrine: dollars
//     first, points secondary).
//   - NEW badge lifecycle (renderer-side filled vs outlined boxes)
//     via [[NEW_BADGE:label|state]] tokens.
//   - Rendered chart card per candidate — SVG inside the embed,
//     locked ATLAS colours from CLAUDE.md (#00ff00 / #ff0015 /
//     #131722 / HIGH yellow / CURRENT green / ENTRY orange / LOW
//     blue). Not a real chart render — prototype visual until the
//     real chart-render lane is approved separately.
//
// Hard boundary (Pack 8.10):
//   - Presentation/education only.
//   - No scoring / thresholds / scheduler / transport / Corey /
//     Jane / Spidey / macro engine / Market Intel runtime /
//     dashboard / renderer.js / ranking changes.
// ============================================================

const path = require('path');
const fohRenderer = require('./_foh_renderer.js');

const ESC = '';
const STYLE = {
  GOLD:    `${ESC}[33;1m`,
  CYAN:    `${ESC}[36;1m`,
  MAGENTA: `${ESC}[35;1m`,
  GREEN:   `${ESC}[32;1m`,
  RED:     `${ESC}[31;1m`,
  BLUE:    `${ESC}[34;1m`,
  RESET:   `${ESC}[0m`,
};

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
function sectionBanner(text, accent) {
  const style = STYLE[accent] || STYLE.GOLD;
  const inner = String(text).padEnd(46, ' ');
  return [
    '```ansi',
    `${style}╔══════════════════════════════════════════════════╗`,
    `${style}║   ${inner}║`,
    `${style}╚══════════════════════════════════════════════════╝${STYLE.RESET}`,
    '```',
  ].join('\n');
}
function subheading(text, accent) {
  const style = STYLE[accent] || STYLE.GOLD;
  return ['```ansi', `${style}▸  ${text}${STYLE.RESET}`, '```'].join('\n');
}
function termRow(terms) {
  const inner = terms.map(t => `${STYLE.CYAN}[${t}]${STYLE.RESET}`).join('  ');
  return ['```ansi', inner, '```'].join('\n');
}

// ── Hyperlink-stub registry ─────────────────────────────────
const TERM = {
  long:        '[Long ▲](#term-long)',
  short:       '[Short ▼](#term-short)',
  triggerLevel:'[Trigger Level](#term-trigger-level)',
  riskOff:     '[Risk-Off](#term-risk-off)',
  invalidation:'[Invalidation](#term-invalidation)',
  entryZone:   '[Entry Zone](#term-entry-zone)',
  watchLevel:  '[Watch Level](#term-watch-level)',
  cautionZone: '[Caution Zone](#term-caution-zone)',
  cycleRank:   '[Cycle Rank](#term-cycle-rank)',
  marketMood:  '[Market Mood](#term-market-mood)',
  breakout:    '[Breakout](#term-breakout)',
  pullback:    '[Pullback](#term-pullback)',
};

function marketMoodSection() {
  return [
    subheading('Market Mood  ·  ELEVATED  🟡🟡🟡🟡  (4 / 5)', 'GOLD'),
    '',
    `_What ${TERM.marketMood} means right now:_`,
    '   The broader market is moving fast. Bigger swings either side are',
    '   more likely than usual. Trades that worked in calm conditions are',
    '   more likely to be whipped out before reaching their target.',
    '',
    '_What this means for your trading today (dollars-first):_',
    '   🟢 Position size — cut from your normal 100% down to 60–70%.',
    '       On a $10,000 account that means $300–$420 risk per trade',
    '       instead of $500.  Why: bigger swings = wider stops = more',
    '       dollars at risk per setup.',
    '   🟡 Risk-off levels — widen them, do NOT tighten. Give the',
    '       trade room to breathe.',
    '   🟠 Marginal setups — skip them. Only act on the cleanest reads.',
    '   🛑 Do NOT chase already-extended moves. Wait for the next',
    '       structural test instead.',
  ].join('\n');
}

// Multi-zone Where to Act builder — dollars-first, doctrine-locked.
function whereToActZones({ direction, entryLow, entryHigh, watch, caution, invalidation, dollarRiskPerLot, lotEquivalent, nextReviewStamp }) {
  const isShort = direction === 'Bearish';
  const buySell = isShort ? 'SELL' : 'BUY';
  const direction2 = isShort ? 'sellers' : 'buyers';
  const reachDir = isShort ? 'above' : 'below';
  return [
    `🟢 ENTRY zone  ${entryLow} – ${entryHigh}`,
    `   What this means: price has pulled back into the band where`,
    `   ${direction2} stepped in the last time the level was tested.`,
    `   Required price behaviour: a 5-minute candle that opens inside`,
    `   the band and closes ${isShort ? 'below the band high' : 'above the band low'}.`,
    `   Action: ${buySell} on that candle close. Start with HALF size.`,
    ``,
    `🟡 WATCH level  ${watch}`,
    `   What this means: ${direction2} are losing initial control. The`,
    `   first warning sign that the read is weakening.`,
    `   💲 If price closes ${reachDir} ${watch} on the 1H, open positions`,
    `   are typically down 30–50% of planned risk (~ $${Math.round(dollarRiskPerLot * 0.4)} on ${lotEquivalent}).`,
    `   Action: hold what you have, do NOT add more.`,
    ``,
    `🟠 CAUTION zone  ${watch} – ${caution}`,
    `   What this means: the other side is in control inside this band.`,
    `   Holding from here is fighting the structure.`,
    `   💲 Position drawdown 50–80% of planned risk.`,
    `   Action: scratch the trade for a small loss. Re-read at next scan.`,
    ``,
    `🛑 ${TERM.invalidation}  ${invalidation}`,
    `   What this means: the ${isShort ? 'bearish' : 'bullish'} idea is OFF entirely.`,
    `   💲 Full planned risk taken: $${dollarRiskPerLot} on ${lotEquivalent}.`,
    `   Action: exit any remaining size NOW. Do NOT re-enter — wait`,
    `   for a fresh structure on a later scan.`,
    ``,
    `🔵 Next review  ${nextReviewStamp}`,
    `   ATLAS re-reads every zone at the next scan.`,
  ].join('\n');
}

const SCAN_STAMP = 'Tuesday 13 May · 12:00 UTC';
const NEXT_REVIEW = '12:15 UTC';
const UNIVERSE_SIZE = 33;

// ── ATLAS-styled chart card specs ───────────────────────────
const chartEURUSD = {
  symbol: 'EURUSD · 1H',
  currentPrice: 1.0942, highPrice: 1.0985, lowPrice: 1.0890,
  entryHigh: 1.0935, entryLow: 1.0920, watch: 1.0900, invalidation: 1.0875,
  direction: 'Bullish',
  caption: 'ATLAS chart card preview · EURUSD 1H · ENTRY zone (green) · INVALIDATION (red dashed)',
  candles: [
    { o: 1.087, h: 1.089, l: 1.086, c: 1.088 },
    { o: 1.088, h: 1.091, l: 1.087, c: 1.090 },
    { o: 1.090, h: 1.094, l: 1.089, c: 1.092 },
    { o: 1.092, h: 1.096, l: 1.091, c: 1.0955 },
    { o: 1.0955, h: 1.097, l: 1.094, c: 1.0942 },
  ],
};
const chartXAUUSD = {
  symbol: 'XAUUSD · 1H',
  currentPrice: 2405, highPrice: 2418, lowPrice: 2393,
  entryHigh: 2402, entryLow: 2398, watch: 2406, invalidation: 2415,
  direction: 'Bearish',
  caption: 'ATLAS chart card preview · XAUUSD 1H · short on rally into 2398–2402 · INVALIDATION (red dashed)',
  candles: [
    { o: 2415, h: 2418, l: 2410, c: 2412 },
    { o: 2412, h: 2414, l: 2398, c: 2399 },
    { o: 2399, h: 2403, l: 2393, c: 2396 },
    { o: 2396, h: 2401, l: 2394, c: 2400 },
    { o: 2400, h: 2407, l: 2398, c: 2405 },
  ],
};
const chartNVDA = {
  symbol: 'NVDA · 1H',
  currentPrice: 922, highPrice: 940, lowPrice: 908,
  entryHigh: 922, entryLow: 918, watch: 912.80, invalidation: 902.50,
  direction: 'Bullish',
  caption: 'ATLAS chart card preview · NVDA 1H · late-stage band · INVALIDATION (red dashed)',
  candles: [
    { o: 918, h: 925, l: 916, c: 924 },
    { o: 924, h: 932, l: 922, c: 930 },
    { o: 930, h: 938, l: 928, c: 935 },
    { o: 935, h: 940, l: 921, c: 924 },
    { o: 924, h: 928, l: 918, c: 922 },
  ],
};

const SAMPLE_MESSAGES = [
  // ── Message 1: banner + Market Mood + STANDOUTS + first embed (FRESH) ──
  {
    content: [
      redNewDividerTop(SCAN_STAMP, UNIVERSE_SIZE),
      '',
      sectionBanner('🐎  DARK HORSE — GLOBAL MOVER RADAR', 'GOLD'),
      '',
      '_3 standouts found this cycle._',
      '_1 fresh (new this scan)  ·  1 still active  ·  1 fading._',
      '',
      '📘 **EXPANDED TERMINOLOGY HYPERLINKS**',
      termRow(['Breakout', 'Pullback', 'Support / Resistance', 'Invalidation', 'Risk-Off', 'Market Mood']),
      '',
      marketMoodSection(),
      '',
      sectionBanner('⭐  STANDOUTS — TODAY\'S STRONGEST MOVERS', 'GOLD'),
      '',
      `[[NEW_BADGE:FRESH|fresh]]  ·  STANDOUT #1 of 3  ·  EURUSD just appeared on this scan`,
    ].join('\n'),
    embeds: [{
      color: 0x2ECC71,
      title: '🐎  EURUSD  ·  STRONG BULLISH',
      description: 'Price pushed above 1.0950 — a level that had capped EURUSD for the last 3 weeks — and held the level cleanly on the 1H close. The move is new this scan.',
      chartCard: chartEURUSD,
      fields: [
        { name: 'Move Type',     value: 'Breakout · early stage', inline: true },
        { name: 'Direction',     value: `${TERM.long} — expecting price to keep moving up`, inline: true },
        { name: 'Conviction',    value: '🟢🟢🟢🟢 / 5 · High', inline: true },
        { name: 'Trigger Level', value: [
            `${TERM.triggerLevel}: **1.0950**`,
            '_Why it matters: 1.0950 capped every push for 3 weeks._',
            '_It has flipped from ceiling into floor — price now treats it as Support._',
          ].join('\n'), inline: true },
        { name: 'Horizon',       value: 'Swing — days, not minutes', inline: true },
        { name: 'Today\'s Rank', value: `${TERM.cycleRank}: 1st of today's 3 standouts`, inline: true },
        { name: 'Where to Act',  value: whereToActZones({
            direction: 'Bullish',
            entryLow: '1.0920', entryHigh: '1.0935',
            watch: '1.0900', caution: '1.0880',
            invalidation: '1.0875',
            dollarRiskPerLot: 300, lotEquivalent: '$100k notional EURUSD',
            nextReviewStamp: NEXT_REVIEW,
          }), inline: false },
        { name: '💲 Dollar risk this trade', value: [
            '💲 Standard plan: **$300 risk on $100k notional EURUSD** (entry 1.0925, stop 1.0895, 30-point distance).',
            '💲 At 30% reduced size (per Market Mood ELEVATED): **$90 risk on $30k notional**.',
            '💲 Reward target if EURUSD reaches 1.1010 first: **~$510** on reduced size · **5.7R**.',
          ].join('\n'), inline: false },
        { name: 'What this means', value: 'The path of least resistance is up while 1.0875 holds. Buying the dip into the green entry band is the trade ATLAS would take.', inline: false },
        { name: 'What to do next', value: '① Wait for a 5-min candle to open inside 1.0920–1.0935. ② Buy that candle\'s close. ③ Place the risk-off at 1.0895. ④ If 1.0900 closes below on 1H, exit half and stand aside until the next scan.', inline: false },
      ],
      footer: { text: `ATLAS · Dark Horse · standout 1 of 3 · first detected at this scan (${SCAN_STAMP})` },
    }],
  },

  // ── Message 2: STILL ACTIVE candidate (XAUUSD) ──
  {
    content: `[[NEW_BADGE:STILL ACTIVE|active]]  ·  STANDOUT #2 of 3  ·  XAUUSD (cycle 2 — trending 1+ day)`,
    embeds: [{
      color: 0xE74C3C,
      title: '🐎  XAUUSD  ·  STRONG BEARISH',
      description: 'Gold broke below 2398 on the 1H close 2 cycles ago. Sellers are still in control and the broken level has held as a ceiling on every bounce since.',
      chartCard: chartXAUUSD,
      fields: [
        { name: 'Move Type',     value: 'Breakdown · mid stage', inline: true },
        { name: 'Direction',     value: `${TERM.short} — expecting price to keep moving down`, inline: true },
        { name: 'Conviction',    value: '🔴🔴🔴🔴 / 5 · High', inline: true },
        { name: 'Trigger Level', value: [
            `${TERM.triggerLevel}: **2398**`,
            '_Why it matters: 2398 was the floor that held for 4 weeks._',
            '_It broke 2 cycles ago — now flipped into a ceiling. Sellers defend every bounce._',
          ].join('\n'), inline: true },
        { name: 'Horizon',       value: 'Swing — days, not minutes', inline: true },
        { name: 'Today\'s Rank', value: `${TERM.cycleRank}: 2nd of today's 3 standouts`, inline: true },
        { name: 'Where to Act',  value: whereToActZones({
            direction: 'Bearish',
            entryLow: '2398', entryHigh: '2402',
            watch: '2406', caution: '2412',
            invalidation: '2415',
            dollarRiskPerLot: 1350, lotEquivalent: '1 lot XAUUSD (100 oz)',
            nextReviewStamp: NEXT_REVIEW,
          }), inline: false },
        { name: '💲 Dollar risk this trade', value: [
            '💲 Standard plan: **$1,350 risk on 1 lot XAUUSD** (entry 2401.50, stop 2415.00, $13.50/oz × 100 oz).',
            '💲 At 30% reduced size (per Market Mood ELEVATED): **$405 risk on 0.3 lot**.',
            '💲 Reward target if XAUUSD reaches 2360 first: **~$1,245** on reduced size · **3.1R**.',
          ].join('\n'), inline: false },
        { name: 'What this means', value: 'The path of least resistance is down while 2415 holds. Selling rallies into the green entry band is the trade.', inline: false },
        { name: 'What to do next', value: '① Wait for price to rally into 2398–2402. ② Watch for a stalling candle (small range body, no close above 2402). ③ Sell that stall. ④ Stop at 2415. ⑤ If 2406 closes above on 1H, exit half.', inline: false },
      ],
      footer: { text: `ATLAS · Dark Horse · standout 2 of 3 · first detected 11:30 UTC · still trending in cycle 2 of 3` },
    }],
  },

  // ── Message 3: FADING candidate (NVDA) ──
  {
    content: `[[NEW_BADGE:FADING|fading]]  ·  STANDOUT #3 of 3  ·  NVDA — older mover, late-stage caution`,
    embeds: [{
      color: 0xE67E22,
      title: '🐎  NVDA  ·  DEVELOPING WATCH',
      description: 'NVIDIA\'s uptrend has been running for 4 cycles. Each new high is smaller than the last. The move is mature — wait for the next test, do not chase.',
      chartCard: chartNVDA,
      fields: [
        { name: 'Move Type',     value: 'Continuation · late stage', inline: true },
        { name: 'Direction',     value: `${TERM.long} — but reward is shrinking`, inline: true },
        { name: 'Conviction',    value: '🟠🟠🟠 / 5 · Reduced', inline: true },
        { name: 'Trigger Level', value: [
            `${TERM.triggerLevel}: **925.40**`,
            '_Why it matters: 925.40 is the structural level the uptrend rotates around._',
            '_Still valid — but each push above it is smaller than the last. Reward is fading._',
          ].join('\n'), inline: true },
        { name: 'Horizon',       value: 'Intraday — hours, not days', inline: true },
        { name: 'Today\'s Rank', value: `${TERM.cycleRank}: 3rd of today's 3 standouts`, inline: true },
        { name: 'Where to Act',  value: whereToActZones({
            direction: 'Bullish',
            entryLow: '918.00', entryHigh: '922.00',
            watch: '912.80', caution: '906.00',
            invalidation: '902.50',
            dollarRiskPerLot: 1860, lotEquivalent: '100 shares NVDA',
            nextReviewStamp: NEXT_REVIEW,
          }), inline: false },
        { name: '💲 Dollar risk this trade', value: [
            '💲 Standard plan: **$1,860 risk on 100 shares NVDA** (entry $921.10, stop $902.50, $18.60/share × 100).',
            '💲 At HALF size (FADING discipline — late-stage cards): **$930 risk on 50 shares**.',
            '💲 Reward target if NVDA reaches $945 first: **~$1,195** on 50 shares · **1.3R**.',
            '⚠️  Reward-to-risk is below 2R — only take this if other cards are not available.',
          ].join('\n'), inline: false },
        { name: 'What this means', value: 'The trend still exists, but the easy reward has already been earned. Late buyers get whipped out the most often.', inline: false },
        { name: 'What to do next', value: '① Half size at most — this is not a primary entry. ② Only buy a clean pullback into 918–922 that prints a strong defensive 5-min close. ③ If 912.80 closes below on 1H, exit the trade.', inline: false },
        { name: '⚠️  Late-stage caveat', value: 'Size small — the move is late. Skip this card if the FRESH or STILL ACTIVE standouts above offer a cleaner setup today.', inline: false },
      ],
      footer: { text: `ATLAS · Dark Horse · standout 3 of 3 · first detected 09:45 UTC · cycle 4 of 4 — fading` },
    }],
  },

  // ── Message 4: BUILDING + chart-reference embed ──
  {
    content: [
      `[[NEW_BADGE:BUILDING|active]]  ·  CHART REFERENCE`,
      '',
      sectionBanner('📡  BUILDING — WARMING UP BELOW STANDOUT GRADE', 'MAGENTA'),
      '',
      termRow(['Pre-Radar', 'Pullback', 'Resistance', 'Support']),
      '',
      '_Two markets are close to the standout bar but not there yet._',
      '_GBPUSD needs a 1H close above 1.2600 to qualify._',
      '_EURJPY needs momentum to expand on its next push (currently flat)._',
      '_If either firms up by the next scan, they\'ll graduate into a standout._',
      '',
      sectionBanner('📚  CHART REFERENCE — HOW TO READ THE FOUR ZONES', 'CYAN'),
    ].join('\n'),
    embeds: [{
      color: 0x5BC0DE,
      title: '📚  Clean Bullish Breakout — Reference',
      description: 'Every Dark Horse candidate above is the same pattern in different markets. This is what it looks like on the chart, and what a trader actually does at each zone.',
      chartCard: {
        symbol: 'REFERENCE · pattern',
        currentPrice: 100, highPrice: 110, lowPrice: 88,
        entryHigh: 100, entryLow: 96, watch: 92, invalidation: 88,
        direction: 'Bullish',
        caption: 'ATLAS chart-card preview · reference pattern (not a live symbol)',
        candles: [
          { o: 90, h: 94, l: 88, c: 91 },
          { o: 91, h: 96, l: 90, c: 92 },
          { o: 92, h: 100, l: 91, c: 99 },
          { o: 99, h: 105, l: 95, c: 96 },
          { o: 96, h: 108, l: 96, c: 107 },
        ],
      },
      fields: [
        { name: 'The story', value: 'Price pushed through a level that had capped it for weeks (the old high). It came back to test the same level. Buyers stepped in to defend it. The ceiling has flipped into a floor.', inline: false },
        { name: 'How a trader acts (concrete)', value: [
            '🟢 BUY the pullback into the green ENTRY band — ONLY if the next 5-min candle opens inside the band AND closes above the band low.',
            '🛑 Place the risk-off just below the dashed red INVALIDATION line. If price closes below it on the 1H, exit immediately.',
            '💲 Dollar risk = (entry price − stop price) × position size × $/point. Size the trade so this number ≤ 1% of your account.',
          ].join('\n'), inline: false },
        { name: 'Rendered ATLAS chart cards — next evolution', value: 'Future scans will replace this prototype with a snapshot of the actual candidate, with the four zones drawn on live price action. Captured as TRC-20260513-006.', inline: false },
      ],
      footer: { text: 'ATLAS · Chart reference · prototype render — to be replaced with live-snapshot chart cards' },
    }],
  },

  // ── Message 5: briefing summary + risk reminder ──
  {
    content: [
      subheading('Risk reminder', 'GOLD'),
      '_Every zone above is what ATLAS sees right now. Live price moves, the zones move with it. Cross-check the current price against the zone before acting. ATLAS reviews again at ' + NEXT_REVIEW + '._',
      '',
      subheading('Briefing summary', 'CYAN'),
      '_3 standouts today (1 FRESH, 1 STILL ACTIVE, 1 FADING). Market Mood ELEVATED (4/5) — cut position sizing by 30%. The FRESH EURUSD card carries the cleanest reward-to-risk (5.7R on reduced size). The STILL ACTIVE XAUUSD short is in cycle 2 and the structure is holding (3.1R). The FADING NVDA card is a HALF-SIZE scalp only (1.3R) — skip if better setups exist. Next scan ' + NEXT_REVIEW + '._',
    ].join('\n'),
  },
];

async function main() {
  const written = await fohRenderer.renderAll(SAMPLE_MESSAGES, {
    outDir: path.join(__dirname, '..', 'docs', 'screenshots'),
    version: 'dh-foh-v5',
    channelName: 'dark-horse-radar',
    displayName: 'ATLAS  ·  Dark Horse Radar',
    subtitle: 'FOH.1.0.1 prototype v5 · doctrine lock · hyperlinks · dollars-first · rendered chart cards',
    title: 'FOH.1.0.1 Dark Horse — v5 prototype',
    sectionNames: ['banner-and-fresh', 'still-active', 'fading', 'reference-card', 'briefing-summary'],
    detailSpecs: [
      { messageIdx: 0, selector: '.message-content', label: 'banner' },
      { messageIdx: 0, selector: '.embed',           label: 'fresh-candidate-embed' },
      { messageIdx: 1, selector: '.embed',           label: 'still-active-candidate-embed' },
      { messageIdx: 2, selector: '.embed',           label: 'fading-candidate-embed' },
      { messageIdx: 3, selector: '.embed',           label: 'reference-card-embed' },
    ],
  });
  console.log('Wrote ' + written.length + ' v5 artefacts:');
  for (const p of written) console.log('  · ' + p);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SAMPLE_MESSAGES };
