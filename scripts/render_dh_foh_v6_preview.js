#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/render_dh_foh_v6_preview.js
//
// Dark Horse FOH.1.0.1 — v6 prototype.
// Operator doctrine v6 — visual + translation + execution-clarity
// pass. Applies all 10 priorities from the 2026-05-13 evening
// build order. Hard boundary preserved.
//
// What's new in v6 vs v5:
//   Priority 1 — 5-disc severity scale on Conviction + Market Mood
//                (🟢🟢🟢🟢⚫ 4/5 — High; 🟠🟠🟠🟠⚫ 4/5 — Elevated;
//                inactive disc is ⚫, never rainbow).
//   Priority 2 — Abstract analyst language removed or translated.
//                "Half size" / "wider stops" / "weak structure" /
//                "aggressive move" all replaced with operational
//                consequences.
//   Priority 3 — Account-risk execution everywhere. Fixed-dollar
//                examples are removed; each card shows entry reference,
//                confirmation, invalidation / exit, and percentage risk cap.
//   Priority 4 — Colour doctrine on prices. Watch level YELLOW,
//                Caution zone ORANGE, Invalidation RED, Entry GREEN.
//                Applied inline via {{watch:X}} {{caution:X}}
//                {{invalid:X}} {{entry:X}} tokens.
//   Priority 5 — Terminology renames: Horizon → Expected Duration;
//                Whipsaw → Initial-direction reversal; Print →
//                Announced result; Clean structure → confirmed
//                directional structure.
//   Priority 6 — Consequence-based guidance per card answers all
//                6 questions: What happened / Why it matters /
//                What to do / Financial cost if wrong / What
//                confirms / What cancels.
//   Priority 7 — Tighter execution zones. Normal vol: 4-point
//                band (1.0924–1.0928). Elevated vol: 15-point band.
//                Conviction-aware band width.
//   Priority 8 — Continued rendered chart card (SVG, locked
//                ATLAS palette).
//   Priority 9 — Explicit "WHAT TO DO NOW" numbered checklist
//                including dollar amounts on every card.
//   Priority 10 — Hard boundary preserved. No engine touch.
// ============================================================

const path = require('path');
const fohRenderer = require('./_foh_renderer.js');
const { discScale } = fohRenderer;

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

const TERM = {
  long:           '[Long ▲](#term-long)',
  short:          '[Short ▼](#term-short)',
  triggerLevel:   '[Trigger Level](#term-trigger-level)',
  invalidation:   '[Invalidation](#term-invalidation)',
  entryZone:      '[Entry Zone](#term-entry-zone)',
  watchLevel:     '[Watch Level](#term-watch-level)',
  cautionZone:    '[Caution Zone](#term-caution-zone)',
  cycleRank:      '[Cycle Rank](#term-cycle-rank)',
  marketMood:     '[Market Mood](#term-market-mood)',
  breakout:       '[Breakout](#term-breakout)',
  pullback:       '[Pullback](#term-pullback)',
  expectedDur:    '[Expected Duration](#term-expected-duration)',
  initRev:        '[Initial-direction reversal](#term-initial-direction-reversal)',
  confirmedDir:   '[confirmed directional structure](#term-confirmed-directional-structure)',
};

// ── Market Mood — v6 with 5-disc + account-risk behaviour ─
function marketMoodSection() {
  const moodLine = discScale(4, 5, 'Elevated', '🟠');
  return [
    subheading(`Market Mood  ·  ${moodLine}`, 'GOLD'),
    '',
    `_What ${TERM.marketMood} means right now:_`,
    '   The broader market is moving fast. Bigger swings either side are',
    '   more likely than usual. Trades that worked in calm conditions are',
    '   more likely to be stopped out before reaching their target.',
    '',
    '_What this means for your trading today (account-percentage based):_',
    '   🟢 Position size — cap risk as a percentage of account equity,',
    '       then reduce it by lifecycle and current Market Mood.',
    '   🟡 Exit-points — use the published invalidation / exit price from',
    '       the card. Tight exits get hit before confirmation completes.',
    '   🟠 Marginal setups — skip them unless entry reference, confirmation,',
    '       invalidation / exit, and Minimum ATLAS Buffer are all visible.',
    '   🛑 Do NOT chase already-extended moves. Example: NVDA at $940',
    '       after a $20 push from $920 is NOT a fresh entry. Wait for',
    '       price to come back to a structural test (the floor that',
    '       was the ceiling) — see the NVDA card below.',
  ].join('\n');
}

// ── v6 Where to Act zones — tighter bands + coloured prices ─
function whereToActZonesV6({ direction, entryLow, entryHigh, watch, caution, invalidation, nextReviewStamp }) {
  const isShort = direction === 'Bearish';
  const direction2 = isShort ? 'sellers' : 'buyers';
  const reachDir = isShort ? 'above' : 'below';
  const confirmEdge = isShort ? entryHigh : entryLow;
  return [
    `🟢 ENTRY zone  {{entry:${entryLow} – ${entryHigh}}}`,
    `   What this means: price has pulled back into the tight band where`,
    `   ${direction2} stepped in the last time the level was tested.`,
    `   Required price behaviour: a 5-minute candle that opens inside the`,
    `   band AND closes ${isShort ? 'below the band high' : 'above the band low'} (this is the {{entry:confirmed`,
    `   directional structure}} test).`,
    `   Entry reference price: **${entryLow} – ${entryHigh}**.`,
    `   Confirmation condition: 5-minute candle opens inside the band AND`,
    `   closes ${isShort ? 'below' : 'above'} ${confirmEdge}; next candle must hold.`,
    ``,
    `🟡 WATCH level  {{watch:${watch}}}`,
    `   What this means: ${direction2} are losing initial control. The`,
    `   first warning sign that the move is weakening.`,
    `   If price closes ${reachDir} {{watch:${watch}}} on the 1H, reduce exposure`,
    `   or stand aside; do NOT add more.`,
    ``,
    `🟠 CAUTION zone  {{caution:${watch} – ${caution}}}`,
    `   {{caution:What this means: the other side is in control inside this band.}}`,
    `   {{caution:Holding from here means fighting the structure — exit risk}}`,
    `   {{caution:is now real, not theoretical.}}`,
    `   Technical distance is nearly spent. Re-read at next scan.`,
    ``,
    `🔴 ${TERM.invalidation}  {{invalid:${invalidation}}}`,
    `   What this means: the ${isShort ? 'bearish' : 'bullish'} idea is OFF entirely.`,
    `   Invalidation / exit price: **${invalidation}**.`,
    `   Re-entry only after a fresh structure appears on a later scan.`,
    ``,
    `🔵 Next review  ${nextReviewStamp}`,
    `   ATLAS re-reads every zone at the next scan.`,
  ].join('\n');
}

const SCAN_STAMP = 'Tuesday 13 May · 12:00 UTC';
const NEXT_REVIEW = '12:15 UTC';
const UNIVERSE_SIZE = 33;

// Chart cards — tighter zones, same locked palette ─────────
const chartEURUSD = {
  symbol: 'EURUSD · 1H',
  currentPrice: 1.0942, highPrice: 1.0975, lowPrice: 1.0890,
  entryHigh: 1.0928, entryLow: 1.0924, watch: 1.0900, invalidation: 1.0875,
  direction: 'Bullish',
  caption: 'ATLAS chart card · EURUSD 1H · entry band 1.0924–1.0928 · watch 1.0900 · invalidation 1.0875',
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
  entryHigh: 2401, entryLow: 2398, watch: 2406, invalidation: 2415,
  direction: 'Bearish',
  caption: 'ATLAS chart card · XAUUSD 1H · short on rally into 2398–2401 · invalidation 2415 (red dashed)',
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
  entryHigh: 921, entryLow: 919, watch: 912.80, invalidation: 902.50,
  direction: 'Bullish',
  caption: 'ATLAS chart card · NVDA 1H · late-stage band 919–921 (tight) · invalidation 902.50',
  candles: [
    { o: 918, h: 925, l: 916, c: 924 },
    { o: 924, h: 932, l: 922, c: 930 },
    { o: 930, h: 938, l: 928, c: 935 },
    { o: 935, h: 940, l: 921, c: 924 },
    { o: 924, h: 928, l: 918, c: 922 },
  ],
};

const SAMPLE_MESSAGES = [
  // ── Message 1: banner + Market Mood (5-disc) + STANDOUTS + FRESH ──
  {
    content: [
      redNewDividerTop(SCAN_STAMP, UNIVERSE_SIZE),
      '',
      sectionBanner('🐎  DARK HORSE — GLOBAL MOVER RADAR', 'GOLD'),
      '',
      '_3 standouts found this cycle._',
      '_1 fresh (new this scan)  ·  1 still active (1+ day)  ·  1 fading._',
      '',
      '📘 **EXPANDED TERMINOLOGY HYPERLINKS**',
      termRow(['Breakout', 'Pullback', 'Support / Resistance', 'Invalidation', 'Expected Duration', 'Market Mood']),
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
        { name: 'Move Type',         value: 'Breakout · early stage', inline: true },
        { name: 'Direction',         value: `${TERM.long} — expecting price to keep moving up`, inline: true },
        { name: 'Conviction',        value: `${discScale(4, 5, 'High', '🟢')}\n_Why High: trigger level broke + momentum increased + retest held + the broken level is now defended by buyers (all 4 criteria met)._`, inline: false },
        { name: 'Trigger Level',     value: [
            `${TERM.triggerLevel}: **1.0950**`,
            '_Why it matters: 1.0950 capped every push for 3 weeks._',
            '_It has flipped from ceiling into floor — price now treats it as Support._',
          ].join('\n'), inline: true },
        { name: 'Expected Duration', value: `${TERM.expectedDur}: Swing — days, not minutes`, inline: true },
        { name: 'Today\'s Rank',     value: `${TERM.cycleRank}: 1st of today's 3 standouts`, inline: true },
        { name: 'Where to Act',      value: whereToActZonesV6({
            direction: 'Bullish',
            entryLow: '1.0924', entryHigh: '1.0928',
            watch: '1.0900', caution: '1.0880',
            invalidation: '1.0875',
            nextReviewStamp: NEXT_REVIEW,
          }), inline: false },
        { name: '💲 Account risk this card — fresh-card cap', value: [
            `💲 Risk basis: account percentage, not fixed-dollar examples.`,
            `💲 Entry reference: {{entry:1.0924 – 1.0928}} · invalidation / exit: {{invalid:1.0875}}.`,
            `💲 Maximum planned loss: **0.50% account equity** until a later scan confirms the structure is still holding.`,
            `💲 Minimum ATLAS Buffer: **2.0 pips / 20 pipettes** · technical distance shown separately from risk size.`,
          ].join('\n'), inline: false },
        { name: 'What this means', value: 'The bullish idea is valid only while {{invalid:1.0875}} holds. Entry is referenced inside {{entry:1.0924 – 1.0928}} only after the confirmation condition is met.', inline: false },
        { name: 'WHAT TO DO NOW', value: [
            '① Entry reference price: {{entry:1.0924 – 1.0928}}.',
            '② Confirmation condition: 5m candle opens inside the band and closes above 1.0924; next candle must hold above 1.0950.',
            '③ Risk basis: cap planned loss at **0.50% account equity**.',
            '④ If {{watch:1.0900}} closes below on 1H, reduce exposure or stand aside; do not add risk.',
            '⑤ Invalidation / exit price: {{invalid:1.0875}} — a 1H close below that level turns the bullish idea off.',
          ].join('\n'), inline: false },
        { name: 'What confirms the idea', value: 'A 5m close above {{entry:1.0928}} after pulling back into the entry band — the {{caution:confirmed directional structure}} test (price closes past the trigger AND the next candle holds beyond it).', inline: false },
        { name: 'What cancels the idea', value: 'A 1H close below {{invalid:1.0875}}. At that point the ceiling-to-floor flip has failed and the move is invalidated.', inline: false },
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
        { name: 'Move Type',         value: 'Breakdown · mid stage', inline: true },
        { name: 'Direction',         value: `${TERM.short} — expecting price to keep moving down`, inline: true },
        { name: 'Conviction',        value: `${discScale(4, 5, 'High', '🔴')}\n_Why High: trigger level broke + sellers defended every retest across 2 cycles + momentum holding (3 of 4 criteria met)._`, inline: false },
        { name: 'Trigger Level',     value: [
            `${TERM.triggerLevel}: **2398**`,
            '_Why it matters: 2398 was the floor that held for 4 weeks._',
            '_It broke 2 cycles ago — now flipped into a ceiling. Sellers defend every bounce._',
          ].join('\n'), inline: true },
        { name: 'Expected Duration', value: `${TERM.expectedDur}: Swing — days, not minutes`, inline: true },
        { name: 'Today\'s Rank',     value: `${TERM.cycleRank}: 2nd of today's 3 standouts`, inline: true },
        { name: 'Where to Act',      value: whereToActZonesV6({
            direction: 'Bearish',
            entryLow: '2398', entryHigh: '2401',
            watch: '2406', caution: '2412',
            invalidation: '2415',
            nextReviewStamp: NEXT_REVIEW,
          }), inline: false },
        { name: '💲 Account risk this card — standard cap (STILL ACTIVE)', value: [
            `💲 Risk basis: account percentage, not fixed-dollar examples.`,
            `💲 Entry reference: {{entry:2398 – 2401}} · invalidation / exit: {{invalid:2415}}.`,
            `💲 Maximum planned loss: **0.70% account equity** after elevated-mood reduction.`,
            `💲 Minimum ATLAS Buffer: **1.25 metal points / 13 ticks** · technical distance shown separately from risk size.`,
          ].join('\n'), inline: false },
        { name: 'What this means', value: 'The bearish idea is valid only while {{invalid:2415}} holds. Entry is referenced inside {{entry:2398 – 2401}} only after the confirmation condition is met.', inline: false },
        { name: 'WHAT TO DO NOW', value: [
            '① Entry reference price: {{entry:2398 – 2401}}.',
            '② Confirmation condition: 5m candle opens inside the band and closes below 2401; next candle must hold below 2398.',
            '③ Risk basis: cap planned loss at **0.70% account equity**.',
            '④ If {{watch:2406}} closes above on 1H, reduce exposure or stand aside; do not add risk.',
            '⑤ Invalidation / exit price: {{invalid:2415}} — a 1H close above that level turns the bearish idea off.',
          ].join('\n'), inline: false },
        { name: 'What confirms the idea', value: 'A 5m close below {{entry:2398}} after rallying into the entry band, with the next candle holding below.', inline: false },
        { name: 'What cancels the idea', value: 'A 1H close above {{invalid:2415}}. At that point the broken floor has been reclaimed and the bearish idea is OFF.', inline: false },
      ],
      footer: { text: `ATLAS · Dark Horse · standout 2 of 3 · first detected 11:30 UTC · still trending in cycle 2 of 3` },
    }],
  },

  // ── Message 3: FADING candidate (NVDA, late stage) ──
  {
    content: `[[NEW_BADGE:FADING|fading]]  ·  STANDOUT #3 of 3  ·  NVDA — older mover, late-stage caution`,
    embeds: [{
      color: 0xE67E22,
      title: '🐎  NVDA  ·  DEVELOPING WATCH',
      description: 'NVIDIA\'s uptrend has been running for 4 cycles. Each new high is smaller than the last. The move is mature — wait for a structural test, do not chase from $940.',
      chartCard: chartNVDA,
      fields: [
        { name: 'Move Type',         value: 'Continuation · late stage', inline: true },
        { name: 'Direction',         value: `${TERM.long} — but reward is shrinking`, inline: true },
        { name: 'Conviction',        value: `${discScale(3, 5, 'Reduced', '🟠')}\n_Why Reduced: trigger level still valid + buyers still defending — BUT each new high is smaller than the last, and the move is now 4 cycles old (2 of 4 criteria met, 2 weakening)._`, inline: false },
        { name: 'Trigger Level',     value: [
            `${TERM.triggerLevel}: **925.40**`,
            '_Why it matters: 925.40 is the structural level the uptrend rotates around._',
            '_Still valid — but each push above it is smaller than the last. Reward is fading._',
          ].join('\n'), inline: true },
        { name: 'Expected Duration', value: `${TERM.expectedDur}: Intraday — hours, not days`, inline: true },
        { name: 'Today\'s Rank',     value: `${TERM.cycleRank}: 3rd of today's 3 standouts`, inline: true },
        { name: 'Where to Act',      value: whereToActZonesV6({
            direction: 'Bullish',
            entryLow: '919.00', entryHigh: '921.00',
            watch: '912.80', caution: '906.00',
            invalidation: '902.50',
            nextReviewStamp: NEXT_REVIEW,
          }), inline: false },
        { name: '💲 Account risk this card — late-stage cap', value: [
            `💲 Risk basis: account percentage, not fixed-dollar examples.`,
            `💲 Entry reference: {{entry:919.00 – 921.00}} · invalidation / exit: {{invalid:902.50}}.`,
            `💲 Maximum planned loss: **0.25% account equity** because this is late-stage.`,
            `💲 Minimum ATLAS Buffer: **$0.45 / 45 cents** · technical distance shown separately from risk size.`,
            `⚠️  Reward-to-risk is below 2R — only take this if no other cards are available.`,
          ].join('\n'), inline: false },
        { name: 'What this means', value: 'The trend still exists, but the easy reward has already been earned. Late buyers get stopped out the most often.', inline: false },
        { name: 'WHAT TO DO NOW', value: [
            '① Late-stage card: cap planned loss at **0.25% account equity**.',
            '② Entry reference price: {{entry:919 – 921}}.',
            '③ Confirmation condition: 5m candle opens inside the band and closes above 919; next candle must hold above 925.40.',
            '④ Invalidation / exit price: {{invalid:902.50}}; if 1H closes below it, the bullish idea is off.',
            '⑤ Skip this card entirely if the FRESH or STILL ACTIVE standouts above offer a cleaner setup today.',
          ].join('\n'), inline: false },
        { name: 'What confirms the idea', value: 'A 5m close above {{entry:921}} after pulling back, with strong defensive volume on the bounce.', inline: false },
        { name: 'What cancels the idea', value: 'A 1H close below {{watch:912.80}} OR any close below {{invalid:902.50}}. The mature uptrend has rolled over.', inline: false },
        { name: '⚠️  Late-stage caveat', value: 'Size {{caution:quarter}} — the move is late. The reward is small. Skip if better setups exist.', inline: false },
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
        caption: 'ATLAS chart-card · reference pattern (not a live symbol)',
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
        { name: 'How a trader acts (concrete, account-risk based)', value: [
            '🟢 Entry reference lives inside the {{entry:green ENTRY band}} — ONLY if the next 5-min candle opens inside the band AND closes above the band low.',
            '🔴 Invalidation / exit lives at the {{invalid:dashed red INVALIDATION line}}. If price closes below it on the 1H, the idea is off.',
            '💲 Account risk = entry-to-exit distance × position size × native point value. Size the trade so planned loss is capped at the card percentage of account equity.',
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
      '_3 standouts today (1 FRESH, 1 STILL ACTIVE, 1 FADING). Market Mood 🟠🟠🟠🟠⚫ 4/5 — Elevated. Risk is capped by account percentage per card._',
      '_The FRESH EURUSD card is the cleanest reward-to-risk: **0.50% account-equity cap**, target model **5.7R**._',
      '_The STILL ACTIVE XAUUSD short uses a **0.70% account-equity cap** after elevated-mood reduction._',
      '_The FADING NVDA card uses a **0.25% account-equity cap** only — skip if better setups exist._',
      '_Next scan ' + NEXT_REVIEW + '._',
    ].join('\n'),
  },
];

async function main() {
  const written = await fohRenderer.renderAll(SAMPLE_MESSAGES, {
    outDir: path.join(__dirname, '..', 'docs', 'screenshots'),
    version: 'dh-foh-v6',
    channelName: 'dark-horse-radar',
    displayName: 'ATLAS  ·  Dark Horse Radar',
    subtitle: 'FOH.1.0.1 prototype v6 · 5-disc severity · tighter execution zones · colour-coded prices · action translation layer',
    title: 'FOH.1.0.1 Dark Horse — v6 prototype',
    sectionNames: ['banner-and-fresh', 'still-active', 'fading', 'reference-card', 'briefing-summary'],
    detailSpecs: [
      { messageIdx: 0, selector: '.message-content', label: 'banner' },
      { messageIdx: 0, selector: '.embed',           label: 'fresh-candidate-embed' },
      { messageIdx: 1, selector: '.embed',           label: 'still-active-candidate-embed' },
      { messageIdx: 2, selector: '.embed',           label: 'fading-candidate-embed' },
      { messageIdx: 3, selector: '.embed',           label: 'reference-card-embed' },
    ],
  });
  console.log('Wrote ' + written.length + ' v6 artefacts:');
  for (const p of written) console.log('  · ' + p);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SAMPLE_MESSAGES };
