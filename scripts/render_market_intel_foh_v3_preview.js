#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/render_market_intel_foh_v3_preview.js
//
// Market Intel FOH.1.0.1 — v3 prototype.
// Applies the doctrine v6 priorities that map to Market Intel:
//
//   Priority 1 — 5-disc severity on Risk State, Volatility,
//                Event Intensity.
//   Priority 2 — Abstract analyst language removed/translated.
//   Priority 3 — Dollars-first execution maintained.
//   Priority 4 — Colour-coded prices (entry green / watch yellow /
//                caution orange / invalidation red) on every level
//                reference.
//   Priority 5 — Terminology renames:
//                  "print" → "announced result"
//                  "whipsaw" → "Initial-direction reversal"
//                  "horizon" → "Expected Duration"
//                  "clean structure" → "confirmed directional structure"
//   Priority 6 — Six-question consequence guidance maintained.
//   Priority 7 — Tighter execution wording.
//   Priority 8 — Rendered chart cards continued.
//   Priority 9 — Action translation layer (numbered steps with $$$).
//   Priority 10 — Hard boundary preserved.
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

function redNewDividerTop(scanStamp) {
  return [
    '```diff',
    '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '- ▼ ▼ ▼   N E W   M A R K E T   I N T E L   ▼ ▼ ▼',
    '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `- 📡   ${scanStamp} · macro briefing · live intel   📡`,
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
  cpi:        '[CPI](#term-cpi)',
  hawkish:    '[hawkish](#term-hawkish)',
  dovish:     '[dovish](#term-dovish)',
  riskOn:     '[risk-on](#term-risk-on)',
  riskOff:    '[risk-off](#term-risk-off)',
  yieldSpread:'[yield spread](#term-yield-spread)',
  vix:        '[VIX](#term-vix)',
  dxy:        '[DXY](#term-dxy)',
  frontEnd:   '[front-end yields](#term-front-end)',
  reversal:   '[Initial-direction reversal](#term-initial-direction-reversal)',
  marketMood: '[Market Mood](#term-market-mood)',
  expectedDur:'[Expected Duration](#term-expected-duration)',
  announcedResult: '[announced result](#term-announced-result)',
  confirmedDirStr: '[confirmed directional structure](#term-confirmed-directional-structure)',
};

function globalRiskStateSection() {
  return [
    sectionBanner('🌐  GLOBAL MARKET MOOD  &  RISK STATE', 'GOLD'),
    '',
    subheading(`Risk State  ·  ${discScale(4, 5, 'Elevated', '🟠')}`, 'GOLD'),
    '',
    `_What ${TERM.marketMood} means right now:_`,
    `   Markets are sensitive. A US ${TERM.cpi} inflation reading at 12:30 UTC`,
    `   plus an ECB Lagarde speech at 14:00 UTC create a 90-minute window`,
    `   where surprises can move dollar pairs, gold, and US equities`,
    `   in a coordinated way.`,
    '',
    '_What this means for trader behaviour today (dollars-first):_',
    `   🟢 Pre-event window — If your normal risk per trade is $500 on a`,
    `       $10,000 account, reduce to ~$300 (60% of normal) for the`,
    `       next 6 hours. Why: bigger market swings mean wider exit-points`,
    `       are needed, which means more $$$ at risk per setup.`,
    `   🟡 During CPI (12:30 → 12:35 UTC) — do NOT trade. Do NOT add`,
    `       to open positions. The first 60 seconds after the {{watch:announced}}`,
    `       {{watch:result}} routinely moves $500–$1,000 against any position`,
    `       on a standard $100k EURUSD lot.`,
    `   🟠 After CPI (12:35 → 14:00 UTC) — wait for the 5-min candle close`,
    `       at 12:35 to read direction. Then re-size, still at 60% of`,
    `       normal until Lagarde finishes.`,
    `   🛑 If BOTH CPI and Lagarde surprise on the ${TERM.hawkish} side:`,
    `       stand aside entirely for the rest of the session.`,
    '',
    '_Why this rating, not lower or higher:_',
    '   Risk would be 🔴🔴🔴🔴🔴 5/5 — Extreme if a central-bank rate decision',
    '   were landing this cycle — there isn\'t. Risk would be 🟠🟠🟠⚫⚫ 3/5 —',
    '   Active if only ONE of these two events were on the calendar today.',
  ].join('\n');
}

function eventCard({ symbol, name, when, impact, impactColor, summary, affected, beforeAction, duringAction, afterAction, dollarImpact, escalationLevel, chartCard, intensityDiscs, intensityLabel }) {
  return {
    color: impactColor,
    title: `${symbol}  ·  ${name}  ·  ${impact}`,
    description: summary,
    chartCard,
    fields: [
      { name: 'When',                  value: when, inline: true },
      { name: 'Event Intensity',       value: discScale(intensityDiscs, 5, intensityLabel, '🔴'), inline: true },
      { name: 'Expected Duration',     value: `${TERM.expectedDur}: Intraday (next 6 hours)`, inline: true },
      { name: 'Affected Markets',      value: affected, inline: false },
      { name: '💲 Dollar impact range', value: dollarImpact, inline: false },
      { name: 'What Traders Should Watch  ·  Pre / During / Post', value: [
        `🟢 BEFORE — ${beforeAction}`,
        `🟡 DURING — ${duringAction}`,
        `🟠 AFTER — ${afterAction}`,
      ].join('\n'), inline: false },
    ],
    footer: { text: 'ATLAS · Market Intel · ' + when + '  ·  monitor in #market-intel' },
  };
}

const SCAN_STAMP = 'Tuesday 13 May · 11:00 UTC';

const chartEventDay = {
  symbol: 'EURUSD · 5m · CPI window',
  currentPrice: 1.0930, highPrice: 1.0985, lowPrice: 1.0890,
  entryHigh: 1.0935, entryLow: 1.0920, watch: 1.0900, invalidation: 1.0875,
  direction: 'Bullish',
  caption: 'ATLAS chart card · EURUSD 5m · pre-event calm → T-0 chaos → post-settle direction',
  candles: [
    { o: 1.092, h: 1.0925, l: 1.0915, c: 1.0922 },
    { o: 1.0922, h: 1.0928, l: 1.0918, c: 1.0925 },
    { o: 1.0925, h: 1.094, l: 1.090, c: 1.091 },
    { o: 1.091, h: 1.0955, l: 1.0895, c: 1.0942 },
    { o: 1.0942, h: 1.0955, l: 1.0935, c: 1.0950 },
    { o: 1.0950, h: 1.0970, l: 1.0945, c: 1.0965 },
  ],
};

const SAMPLE_MESSAGES = [
  // ── Message 1: banner + Global Risk State (5-disc) + Major Events ──
  {
    content: [
      redNewDividerTop(SCAN_STAMP),
      '',
      sectionBanner('📡  MARKET INTEL — LIVE MACRO BRIEFING', 'GOLD'),
      '',
      '_2 major events landing in the next 6 hours._',
      `_Combined risk state: 🟠🟠🟠🟠⚫ 4/5 — Elevated. See operational read below._`,
      '',
      '📘 **EXPANDED TERMINOLOGY HYPERLINKS**',
      termRow(['CPI', 'Hawkish', 'Dovish', 'Risk-On / Risk-Off', 'Yield Spread', 'VIX', 'Expected Duration']),
      '',
      globalRiskStateSection(),
      '',
      sectionBanner('📅  MAJOR EVENTS  ·  NEXT 24 HOURS', 'BLUE'),
      '',
      '```ansi',
      `${STYLE.RED}12:30 UTC   US CPI (inflation announcement)   🟠🟠🟠🟠⚫ 4/5 — HIGH${STYLE.RESET}`,
      `${STYLE.CYAN}14:00 UTC   ECB Lagarde — scheduled speech    🟠🟠🟠⚫⚫ 3/5 — MEDIUM${STYLE.RESET}`,
      `${STYLE.CYAN}21:00 UTC   FOMC Daly — fireside chat          🟡🟡⚫⚫⚫ 2/5 — LOW-MEDIUM${STYLE.RESET}`,
      '```',
      '',
      subheading('Why these events matter (plain English)', 'GOLD'),
      '',
      `   ${TERM.cpi} is the monthly inflation reading that decides whether`,
      '   the Fed will keep tightening or hold steady at its next meeting.',
      `   When ${TERM.cpi} is ${TERM.announcedResult} HIGHER than expected, that\'s ${TERM.hawkish} —`,
      `   it pushes the US dollar up and pressures equities and gold.`,
      `   When it is ${TERM.announcedResult} LOWER, that\'s ${TERM.dovish} — the opposite happens.`,
      '   Lagarde\'s speech follows ~90 minutes later and often re-prices',
      '   the euro relative to whatever direction CPI took.',
    ].join('\n'),
  },

  // ── Message 2: CPI event card with embedded chart + dollar impact ──
  {
    content: '```diff' + '\n' + '- 🆕  PRIMARY EVENT  ·  US CPI · 12:30 UTC' + '\n' + '```',
    embeds: [eventCard({
      symbol: '🇺🇸',
      name: 'US CPI · April release',
      when: 'Today  ·  12:30 UTC',
      impact: '🟠 HIGH',
      impactColor: 0xE74C3C,
      intensityDiscs: 4,
      intensityLabel: 'High',
      summary: 'US Consumer Price Index (the monthly inflation reading). It is the single biggest catalyst for the dollar this week. The reading decides whether the Fed leans hawkish or dovish at its next meeting.',
      affected: 'DXY  ·  EURUSD  ·  GBPUSD  ·  USDJPY  ·  XAUUSD  ·  US500  ·  NDX',
      escalationLevel: 'tier-1 catalyst',
      dollarImpact: [
        '💲 Typical first-60-second swing range (historical CPI announcements, last 12 releases):',
        '💲   $500 – $1,000 against any position on a standard $100k EURUSD lot.',
        '💲   $1,200 – $2,500 on 1 standard lot XAUUSD (100 oz).',
        '💲   $400 – $900 on 100 shares of a US large-cap during initial reaction.',
        '💲 Median post-settle (12:35 → 14:00) trend move: $700 – $1,400 on $100k EURUSD.',
      ].join('\n'),
      beforeAction: 'Cut all dollar-pair positions to 60% of your normal trade size by 12:25 UTC. If your normal trade is 1 lot, begin at 0.6 lot (~{{money:$300 risk}} instead of $500). Why: pre-announcement volatility makes wider exit-points necessary, which means more $$$ at risk per trade.',
      duringAction: 'Do NOT trade between 12:30 and 12:35 UTC. Do NOT add to open positions. The first 60 seconds is noise — the 12:35 candle close shows the real direction.',
      afterAction: 'Wait for the 12:35 UTC 5-min candle close. Identify direction. Only re-enter on setups where price closes beyond the trigger level AND the next candle holds beyond it (the {{caution:confirmed directional structure}} test). Still at 60% size until Lagarde finishes at ~14:30 UTC.',
      chartCard: chartEventDay,
    })],
  },

  // ── Message 3: 4 reaction paths (HIGHER / LOWER / IN-LINE / REVERSAL) ──
  {
    content: [
      '```diff',
      '- 🆕  REACTION PATHS  ·  WHAT THE 4 OUTCOMES MEAN FOR YOU',
      '```',
      '',
      sectionBanner('🎯  POSSIBLE MARKET REACTION PATHS', 'BLUE'),
      '',
      termRow(['Hawkish', 'Dovish', 'In-Line', 'Initial-Direction Reversal']),
      '',
      subheading(`IF  CPI ${TERM.announcedResult} HIGHER than forecast  ·  ${TERM.hawkish}`, 'RED'),
      '',
      `   Affected markets:  ${TERM.dxy}  ·  EURUSD  ·  GBPUSD  ·  USDJPY  ·  XAUUSD  ·  US500`,
      '',
      '   Expected behaviour:',
      `   • ${TERM.dxy} pushes higher — buyers pile into the dollar`,
      '   • EURUSD / GBPUSD drop on dollar strength',
      '   • US indices (US500 / NDX) drop on rate-hike fears',
      '   • Gold (XAUUSD) initially drops; can recover on safe-haven flow',
      '',
      '   💲 Dollar impact (first 30 minutes after the announcement):',
      '   • Long EURUSD trades: {{caution:$300 – $800 drawdown}} on $100k notional',
      '   • Short EURUSD trades: {{entry:$300 – $800 gain}} on $100k notional',
      '   • Long XAUUSD trades: {{caution:$500 – $1,500 drawdown}} on 1 lot',
      '',
      '   What you should do:',
      '   ✘  Do NOT enter new long-dollar positions in the first 5 minutes —',
      '       chase risk is high.',
      '   ✘  Do NOT add to any short-dollar positions.',
      '   ✓  Exit short-dollar positions on the 5-min close at 12:35 UTC if',
      '       direction holds.',
      '   ✓  After 12:35 UTC, look for SHORT EURUSD setups using the next',
      '       Dark Horse scan as your guide.',
      '',
      subheading(`IF  CPI ${TERM.announcedResult} LOWER than forecast  ·  ${TERM.dovish}`, 'GREEN'),
      '',
      `   Affected markets:  ${TERM.dxy}  ·  EURUSD  ·  GBPUSD  ·  US500  ·  XAUUSD`,
      '',
      '   Expected behaviour:',
      `   • ${TERM.dxy} pulls back — sellers exit dollar longs`,
      '   • EURUSD / GBPUSD rally on dollar weakness',
      '   • US indices rally on rate-cut optimism',
      '   • Gold rises with the broader risk-on flow',
      '',
      '   💲 Dollar impact (first 30 minutes after the announcement):',
      '   • Long EURUSD trades: {{entry:$300 – $800 gain}} on $100k notional',
      '   • Short EURUSD trades: {{caution:$300 – $800 drawdown}} on $100k notional',
      '   • Long XAUUSD trades: {{entry:$500 – $1,500 gain}} on 1 lot',
      '',
      '   What you should do:',
      '   ✘  Do NOT enter new short-dollar positions in the first 5 minutes.',
      '   ✘  Do NOT add to any long-dollar positions.',
      '   ✓  Exit long-dollar positions on the 5-min close at 12:35 UTC.',
      '   ✓  After 12:35 UTC, look for LONG EURUSD / LONG XAUUSD setups',
      '       using the next Dark Horse scan as your guide.',
      '',
      subheading(`IF  CPI ${TERM.announcedResult} IN-LINE with forecast`, 'CYAN'),
      '',
      '   Affected markets:  light reaction across the board',
      '',
      '   Expected behaviour:',
      '   • Initial spike either side then settle. No clean directional bias.',
      '   • Markets re-focus on Lagarde at 14:00 UTC.',
      '   • Volatility drops within 15 minutes.',
      '',
      '   💲 Dollar impact: small. $100 – $300 swings on $100k EURUSD,',
      '       then mean-reversion back toward pre-event level.',
      '',
      '   What you should do:',
      '   ✘  Do NOT trade the initial spike — it will settle.',
      '   ✓  Stand aside through 12:35 UTC. Re-read at next ATLAS scan.',
      '   ✓  Re-engage normally once Lagarde delivers at 14:00 UTC.',
      '',
      subheading(`IF  ${TERM.reversal}  ·  the first move reverses within 10 minutes`, 'MAGENTA'),
      '',
      '   _Plain-English: the initial direction off the announcement is faded._',
      '   _Volume comes IN against the first move. The 15-min close at 12:45_',
      '   _UTC is the real trend, not the first 60-second spike._',
      '',
      '   This happens roughly 1 in 4 CPI announcements — more often in',
      '   high-volatility regimes like this one.',
      '',
      '   Expected behaviour:',
      '   • The first direction off the announcement is faded by 12:40 UTC.',
      '   • Volume comes IN against the initial move.',
      '   • The 15-min close at 12:45 UTC is the real trend.',
      '',
      '   💲 Dollar impact (a particularly punishing window):',
      '   • Traders who chase the first 60 seconds: {{caution:$800 – $1,500 drawdown}}',
      '       on $100k EURUSD before the reversal completes.',
      '',
      '   What you should do:',
      '   ✘  Do NOT chase the first move under any circumstance.',
      '   ✘  Do NOT add to positions on the initial direction.',
      '   ✓  Wait for the 15-min candle close at 12:45 UTC.',
      '   ✓  Trade only the post-12:45 direction — that\'s the actual signal.',
    ].join('\n'),
  },

  // ── Message 4: Risk escalation (multi-zone, dollar-first) ──
  {
    content: [
      '```diff',
      '- 🆕  RISK ESCALATION  ·  PRE / DURING / POST CPI',
      '```',
      '',
      sectionBanner('⚠️  RISK ESCALATION  ·  TIME-WINDOWED BEHAVIOUR', 'RED'),
      '',
      termRow(['Risk Escalation', 'Stand Aside', 'Position Sizing', 'Volatility Window']),
      '',
      '```ansi',
      `${STYLE.GREEN}🟢 HEALTHY  ·  Pre-announcement window (now → 12:25 UTC)${STYLE.RESET}`,
      '   Normal trade-management rules apply, with one change:',
      '   reduce all dollar-pair positions to 60% of your normal size',
      '   by 12:25. Use this window to close losing trades and tighten',
      '   exit-points on winners.',
      '   💲 Cost of staying full size into 12:30: $200 – $400 extra',
      '   drawdown on a $100k EURUSD position from wider whips alone.',
      '',
      `${STYLE.GOLD}🟡 CAUTION  ·  T-5 minutes (12:25 → 12:30 UTC)${STYLE.RESET}`,
      '   Close any open dollar-pair / gold / US-index positions UNLESS',
      '   they are >1.5R in profit and your exit is already at break-even.',
      '   💲 Why: at T-0, those positions face $500 – $1,000 first-minute',
      '   swing risk on $100k notional EURUSD.',
      '   Action: tighten exits to break-even or step aside.',
      '',
      `${STYLE.RED}🟠 DANGER  ·  T-0 to T+5 (12:30 → 12:35 UTC)${STYLE.RESET}`,
      '   The announcement moment. Markets routinely whip $500 – $1,000',
      '   against any position on $100k EURUSD in the first 60 seconds.',
      '   Action: stand aside. Watch the 5-min candle form. Do NOT trade.',
      '',
      `${STYLE.RED}🛑 STAND ASIDE  ·  If both CPI and Lagarde surprise hawkish${STYLE.RESET}`,
      '   Combined surprise from both events would re-price the dollar',
      '   for the rest of the session.',
      '   💲 Expected combined post-event move: $1,500 – $3,000 on $100k',
      '   EURUSD over the 2-hour window after Lagarde.',
      '   Action: wait for the 15-min close AFTER Lagarde finishes',
      '   (~14:30 UTC) before resuming any new trades.',
      '',
      `${STYLE.GREEN}🟢 RE-ENTRY  ·  12:35 UTC onwards${STYLE.RESET}`,
      '   Re-read structure on the 5m chart. Match against the four',
      '   reaction paths above. Act only on the setups where price closes',
      '   beyond the trigger AND the next candle holds beyond it (the',
      '   confirmed directional structure test).',
      '   💲 Continue at 60% size until Lagarde finishes; return to normal',
      '   sizing only after the 14:30 UTC re-read at the next ATLAS scan.',
      '```',
      '',
      subheading('What changes this risk state', 'GOLD'),
      '',
      '   • If CPI cancels (rare): state drops to 🟠🟠🟠⚫⚫ 3/5 — Active.',
      '   • If a central-bank rate decision is added: state climbs to 🔴🔴🔴🔴🔴 5/5 — Extreme.',
      '   • If Lagarde\'s speech is cancelled: state drops to 🟠🟠🟠⚫⚫ 3/5 — Active.',
    ].join('\n'),
  },

  // ── Message 5: What traders should watch ──
  {
    content: [
      '```diff',
      '- 🆕  WHAT TO WATCH  ·  PRE / DURING / POST CPI',
      '```',
      '',
      sectionBanner('👀  WHAT TRADERS SHOULD WATCH (each row carries action)', 'GOLD'),
      '',
      termRow(['DXY', 'Yield Spread', 'VIX', 'Liquidity', 'Hawkish', 'Front-End Yields']),
      '',
      subheading('Pre-event indicators (now → 12:25 UTC)', 'GOLD'),
      '',
      `   ${TERM.dxy} above {{watch:105}} — what it means: the dollar has ALREADY moved`,
      `   up in anticipation of a ${TERM.hawkish} CPI. Action: do NOT bet on`,
      '   further dollar strength unless CPI surprises EVEN HOTTER than',
      '   expected. The easy long-dollar trade is already priced in.',
      '',
      `   ${TERM.frontEnd} above {{watch:4.85%}} — what it means: the bond market is`,
      `   also already positioned for a ${TERM.hawkish} reading. Action: same`,
      `   as ${TERM.dxy} above — be cautious of fresh long-dollar entries.`,
      '',
      `   ${TERM.vix} above {{watch:18}} — what it means: traders are nervous about`,
      `   the announcement. Equity downside risk is elevated. Action: do NOT`,
      '   take fresh long-equity positions before 12:30 UTC.',
      `   ${TERM.vix} below {{entry:14}} — what it means: traders are complacent. A`,
      '   surprise reading will hit harder. Action: avoid new positions in',
      '   any market until 12:35 UTC.',
      '',
      '   EURUSD position into the announcement — what it means: where the market',
      '   thinks the dollar is heading. If EURUSD is at the high of its',
      '   24-hour range entering the announcement, the market is leaning DOVISH.',
      '   Action: a HAWKISH surprise from a dovishly-positioned market',
      '   causes the BIGGEST whips. Cut size further if EURUSD is at the',
      '   day\'s high entering 12:30 UTC.',
      '',
      subheading('During the event (12:30 → 12:35 UTC)', 'RED'),
      '',
      '   • The first 60 seconds of price action is NOISE. Do not act on it.',
      '   • Watch the 5m candle CLOSE at 12:35 UTC — that prints the real direction.',
      `   • Read ${TERM.dxy} first, THEN look at EURUSD / XAUUSD response.`,
      '       Why: DXY is the leading indicator for dollar-pair direction.',
      '   • Action: stand aside the whole 5-minute window.',
      '',
      subheading('Post-event reassessment (12:35 → 14:00 UTC)', 'GREEN'),
      '',
      '   • Did the initial direction HOLD or REVERSE inside 10 minutes?',
      '       If reversed: trade only the post-12:45 direction. The initial',
      '       move was wrong.',
      '   • Is volume CONFIRMING the move or FADING?',
      '       Confirming = sustained large candle bodies in the direction.',
      '       Fading = candle bodies shrinking — direction is exhausting.',
      '       Action: only enter trades when volume is confirming.',
      '   • What did treasuries do?',
      '       Bonds move opposite to yields. If yields jumped, bonds fell',
      '       — that confirms a HAWKISH read. Action: trade in line with',
      '       bonds for the cleanest signal.',
      '   • Wait for Lagarde 14:00 UTC before sizing INTO new trades.',
      '       Action: small size or stand aside in the window 13:00 → 14:00.',
    ].join('\n'),
  },

  // ── Message 6: Event-day reference + briefing summary ──
  {
    content: [
      '```diff',
      '- 🆕  EVENT-DAY REFERENCE  ·  THE 4 WINDOWS',
      '```',
      '',
      sectionBanner('📚  EVENT-DAY REFERENCE  ·  THE 4 WINDOWS', 'CYAN'),
    ].join('\n'),
    embeds: [{
      color: 0x5BC0DE,
      title: '📚  How to read an event-day chart',
      description: 'Every macro event has 4 windows on the chart. Pre-event is your trading window with size reduced. T-0 is the chaos window — stand aside. Post-settle is when the real direction appears. T+30 onwards is when normal trading resumes.',
      chartCard: chartEventDay,
      fields: [
        { name: 'The story', value: 'Before CPI, candles are small and quiet (pre-event window). At 12:30 UTC the candle range explodes — that\'s the chaos window. By 12:35 UTC the noise settles and a clear direction emerges. From 12:40 onwards, the candles return to normal size and the trend is tradable.', inline: false },
        { name: 'How a trader uses this (concrete, dollars-first)', value: [
            '🟢 Pre-event (T-5 to T-0): size at 60% of normal. Tighten exits.',
            '🛑 T-0 (12:30 to 12:35 UTC): stand aside. Do NOT trade.',
            '🟢 Post-settle (T+5 to T+15): re-read direction on the 12:35 close. Trade only that direction.',
            '🟢 T+30 onwards: resume normal trading patterns.',
          ].join('\n'), inline: false },
        { name: '💲 Dollar context for each window', value: [
            '💲 Pre-event: $100 – $300 whips per 5m candle on $100k EURUSD.',
            '💲 T-0 to T+5: $500 – $1,000 swings in 60 seconds.',
            '💲 Post-settle (T+5 to T+15): $200 – $400 per 5m candle (settling).',
            '💲 T+30+: back to $50 – $150 per 5m candle (normal).',
          ].join('\n'), inline: false },
        { name: 'Rendered ATLAS event cards — next evolution', value: 'Future scans will replace the prototype chart with live ATLAS chart snapshots taken during real CPI announcements, with all four windows annotated on the actual price action.', inline: false },
      ],
      footer: { text: 'ATLAS · Market Intel · event-day reference · prototype render' },
    }],
  },

  // ── Message 7: briefing summary ──
  {
    content: [
      subheading('Briefing summary', 'GOLD'),
      '',
      '_Two macro events land within 90 minutes today. Risk state is_',
      '_🟠🟠🟠🟠⚫ 4/5 — Elevated for the next 6 hours._',
      '',
      '_Concrete action:_',
      '_① Cut all dollar-pair positions to 60% of normal size by 12:25 UTC._',
      '_② Stand aside from 12:30 to 12:35 UTC (the T-0 window)._',
      '_③ Re-read direction on the 12:35 UTC 5-minute candle close._',
      '_④ Trade only the post-settle direction at 60% size until Lagarde finishes._',
      '_⑤ ATLAS Market Intel next updates at 13:30 UTC with the post-CPI read._',
    ].join('\n'),
  },
];

async function main() {
  const written = await fohRenderer.renderAll(SAMPLE_MESSAGES, {
    outDir: path.join(__dirname, '..', 'docs', 'screenshots'),
    version: 'market-intel-foh-v3',
    channelName: 'market-intel',
    displayName: 'ATLAS  ·  Market Intel',
    subtitle: 'FOH.1.0.1 Market Intel prototype v3 · 5-disc severity · announced-result rename · Expected Duration · colour-coded levels',
    title: 'FOH.1.0.1 Market Intel — v3 prototype',
    sectionNames: ['banner-and-mood', 'cpi-event-card', 'reaction-paths', 'risk-escalation', 'what-to-watch', 'reference-card', 'briefing-summary'],
    detailSpecs: [
      { messageIdx: 0, selector: '.message-content', label: 'banner-and-mood' },
      { messageIdx: 1, selector: '.embed',           label: 'cpi-event-card' },
      { messageIdx: 2, selector: '.message-content', label: 'reaction-paths' },
      { messageIdx: 3, selector: '.message-content', label: 'risk-escalation' },
      { messageIdx: 4, selector: '.message-content', label: 'what-to-watch' },
      { messageIdx: 5, selector: '.embed',           label: 'reference-card-embed' },
    ],
  });
  console.log('Wrote ' + written.length + ' MI v3 artefacts:');
  for (const p of written) console.log('  · ' + p);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SAMPLE_MESSAGES };
