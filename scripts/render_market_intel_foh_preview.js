#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/render_market_intel_foh_preview.js
//
// Market Intel FOH.1.0.1 — visual prototype v1.
//
// Parallel lane to the Dark Horse FOH prototype. Shares the same
// ATLAS FOH foundations (red NEW divider, gold section banners,
// teal Expanded Terminology Hyperlinks, state-coloured embeds,
// iPad-readable typography, visual cards) but expresses a
// different surface: macro / event intelligence + global risk
// state + execution-relevance for traders before/during/after
// events.
//
// Sections per the operator's build order:
//   1.  Global Market Mood / Risk State
//   2.  Major Events Coming Up
//   3.  Why These Events Matter
//   4.  Possible Market Reaction Paths
//   5.  What Traders Should Watch
//   6.  Risk Escalation / Caution Zones
//   7.  Expanded Terminology Hyperlinks
//   8.  Visual event/risk cards
//   9.  Beginner-readable explanations
//   10. NO backend engine wiring (prototype only)
//
// Hard boundary (Pack 8.10):
//   - Presentation/education only.
//   - No scoring / thresholds / scheduler / transport /
//     Corey / Jane / Spidey / macro engine / Market Intel
//     RUNTIME / dashboard / renderer / ranking changes.
//   - This script is a SELF-CONTAINED prototype — it does not
//     import any Market Intel engine code, does not call any
//     macro-engine surface, and does not register any QA
//     harness against the Market Intel runtime.
//
// Output:
//   docs/screenshots/market-intel-foh-v1.html / .png / .pdf
//   plus per-message + detail crops + gallery.
// ============================================================

const path = require('path');
const fohRenderer = require('./_foh_renderer.js');

// ── Style primitives ─────────────────────────────────────────
const ESC = '';
const STYLE = {
  GOLD: `${ESC}[33;1m`,
  CYAN: `${ESC}[36;1m`,
  GREEN: `${ESC}[32m`,
  RED: `${ESC}[31m`,
  RESET: `${ESC}[0m`,
};

// Red NEW divider for Market Intel scans — same primitive as Dark
// Horse but with a Market Intel-specific badge stamp so the reader
// can tell the surfaces apart at a glance in the same channel.
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

// ── Market Mood / Risk State — traffic-light + 5-rating ──────
// Same FOH primitive as Dark Horse Market Mood but tuned for
// Market Intel. The rating + operational meaning + behaviour
// guidance answers Nathan's "what does this mean / why does it
// matter / what does the trader do?" doctrine.
function globalMarketMoodSection() {
  return [
    goldSectionBox('🌐  GLOBAL MARKET MOOD  &  RISK STATE'),
    '',
    goldSubheading('Risk State  ·  CAUTION  🟠🟠🟠🟠  (4 / 5)'),
    '',
    '_What it means right now:_',
    '   Markets are sensitive. A mid-week US CPI print at 12:30 UTC',
    '   plus an ECB speaker at 14:00 UTC are converging into a',
    '   24-hour window where surprises can move dollar pairs,',
    '   gold, and US indices in a coordinated way.',
    '',
    '_What this means for trader behaviour:_',
    '   🟢 Pre-event: keep position sizes light. Big news = big swings.',
    '   🟡 During: do not chase the first 60 seconds of the print.',
    '   🟠 After: wait for the 5m close to confirm direction.',
    '   🛑 If both events surprise the same way: tactical stand-aside.',
    '',
    '_Why this rating, not lower or higher:_',
    '   Risk would be RED (5/5) if a central-bank decision were',
    '   landing this cycle — there isn\'t. Risk would be YELLOW (3/5)',
    '   if only one of these two events were on the calendar.',
  ].join('\n');
}

// ── Visual event / risk card (reusable) ──────────────────────
// Mirrors the Dark Horse candidate-embed pattern: state-coloured
// left bar, title + description, fields with operational data,
// multi-zone "What Traders Should Watch" block per event.
function eventCard({ symbol, name, when, impact, impactColor, summary, affected, beforeAction, duringAction, afterAction, escalationLevel }) {
  return {
    color: impactColor,
    title: `${symbol}  ·  ${name}  ·  ${impact}`,
    description: summary,
    fields: [
      { name: 'When',                  value: when,                                                inline: true },
      { name: 'Impact',                value: impact + ' · ' + escalationLevel,                    inline: true },
      { name: 'Affected Markets',      value: affected,                                            inline: true },
      // What Traders Should Watch — multi-line zone block.
      { name: 'What Traders Should Watch', value: [
        `🟢 BEFORE — ${beforeAction}`,
        `🟡 DURING — ${duringAction}`,
        `🟠 AFTER — ${afterAction}`,
      ].join('\n'), inline: false },
    ],
    footer: { text: 'Market Intel  ·  live briefing · ' + when + '  ·  monitor in #market-intel' },
  };
}

const SCAN_STAMP = 'Tuesday 13 May · 11:00 UTC';

const SAMPLE_MESSAGES = [
  // ── Message 1: banner + Global Market Mood + Major Events list + ▸ subheadings ──
  {
    content: [
      redNewDividerTop(SCAN_STAMP),
      '',
      goldSectionBox('📡  MARKET INTEL — LIVE MACRO BRIEFING'),
      '',
      '_2 major events landing in the next 6 hours._',
      '_Combined risk state: CAUTION — see operational read below._',
      '',
      '📘 **EXPANDED TERMINOLOGY HYPERLINKS**',
      tealTerminologyRow(['CPI', 'Central Bank', 'Hawkish', 'Dovish', 'Risk-On / Risk-Off', 'Yield Spread']),
      '',
      globalMarketMoodSection(),
      '',
      goldSectionBox('📅  MAJOR EVENTS  ·  NEXT 24 HOURS'),
      '',
      '```ansi',
      `${STYLE.RED}12:30 UTC   US CPI (inflation print)         🟠🟠🟠🟠  HIGH${STYLE.RESET}`,
      `${STYLE.CYAN}14:00 UTC   ECB Lagarde — scheduled speech    🟡🟡🟡    MEDIUM${STYLE.RESET}`,
      `${STYLE.CYAN}21:00 UTC   FOMC Daly — fireside chat          🟡🟡      LOW-MEDIUM${STYLE.RESET}`,
      '```',
      '',
      goldSubheading('Why these events matter'),
      '',
      '   CPI is the inflation print that decides whether the Fed stays',
      '   on its current path or tightens further. A hot print pushes',
      '   the dollar up and pressures equities and gold. A soft print',
      '   does the opposite. Lagarde\'s speech follows the print and',
      '   often re-prices the euro relative to dollar moves.',
      '',
    ].join('\n'),
  },

  // ── Message 2: CPI event card with reaction-path block ──
  {
    content: newBadgeSeparator('PRIMARY EVENT  ·  US CPI · 12:30 UTC'),
    embeds: [eventCard({
      symbol: '🇺🇸',
      name: 'US CPI · April release',
      when: 'Today  ·  12:30 UTC',
      impact: '🟠 HIGH',
      impactColor: 0xE74C3C,
      summary: 'US Consumer Price Index for April. Headline + Core readings determine whether the Fed leans hawkish or dovish at the next meeting. The print moves dollar pairs, gold, and US indices on release.',
      affected: 'DXY  ·  EURUSD  ·  GBPUSD  ·  USDJPY  ·  XAUUSD  ·  US500  ·  NDX',
      escalationLevel: 'tier-1 catalyst',
      beforeAction: 'Cut size to 30–50% of normal. Step away from open trades 5 minutes before 12:30. Cancel pending limit orders.',
      duringAction: 'Do not act on the first 60 seconds of the candle. The initial spike often reverses before settling.',
      afterAction: 'Wait for the 5-minute close after 12:30. Re-read structure once volatility settles. Only act on cleaned-up levels.',
    })],
  },

  // ── Message 3: Reaction-path scenarios (IF / THEN) ──
  {
    content: [
      newBadgeSeparator('REACTION PATHS  ·  WHAT HAPPENS IF…'),
      '',
      goldSectionBox('🎯  POSSIBLE MARKET REACTION PATHS'),
      '',
      tealTerminologyRow(['Hawkish Surprise', 'Dovish Surprise', 'In-Line Print', 'Whipsaw']),
      '',
      goldSubheading('IF  CPI prints HOTTER than expected (hawkish)'),
      '',
      '   • Dollar (DXY) pushes higher.',
      '   • EURUSD / GBPUSD pressured to the downside.',
      '   • US indices (US500 / NDX) drop on rate-hike fears.',
      '   • Gold (XAUUSD) initially drops, can recover on safe-haven flow.',
      '   _Trader read:_ short-dollar setups are at risk. Long dollar',
      '   setups gain weight, but wait for the 5m close.',
      '',
      goldSubheading('IF  CPI prints COOLER than expected (dovish)'),
      '',
      '   • Dollar (DXY) pulls back.',
      '   • EURUSD / GBPUSD push up.',
      '   • US indices rally on rate-cut optimism.',
      '   • Gold rises with the broader risk-on flow.',
      '   _Trader read:_ short-dollar setups gain weight. Long-dollar',
      '   setups should be exited or paused.',
      '',
      goldSubheading('IF  CPI prints IN-LINE with expectations'),
      '',
      '   • Initial spike then settle. No clean directional bias.',
      '   • Markets re-focus on Lagarde at 14:00 UTC.',
      '   _Trader read:_ stand aside through the spike. Wait for Lagarde.',
      '',
      goldSubheading('IF  the print sparks a WHIPSAW (both sides print quickly)'),
      '',
      '   • Initial direction reverses within 10 minutes.',
      '   • This happens 1 in 4 CPI prints, more in high-volatility regimes.',
      '   _Trader read:_ do not chase the first move. Wait for the 15m close.',
    ].join('\n'),
  },

  // ── Message 4: Risk-escalation multi-zone block ──
  {
    content: [
      newBadgeSeparator('RISK ESCALATION  ·  CAUTION ZONES'),
      '',
      goldSectionBox('⚠️  RISK ESCALATION  ·  CAUTION → DANGER → STAND ASIDE'),
      '',
      tealTerminologyRow(['Risk Escalation', 'Stand Aside', 'Position Sizing', 'Volatility Window']),
      '',
      '```ansi',
      `${STYLE.GREEN}🟢 HEALTHY  ·  Pre-print window (now → 12:25 UTC)${STYLE.RESET}`,
      '   Normal trade-management rules apply. Size light, set sensible',
      '   stops, do not enter fresh positions within 5 minutes of CPI.',
      '',
      `${STYLE.GOLD}🟡 CAUTION  ·  T-5 minutes (12:25 → 12:30 UTC)${STYLE.RESET}`,
      '   Close open positions in DXY / EURUSD / XAUUSD / US500',
      '   unless they are far in profit and have wide stops.',
      '   Action: tighten stops or step aside.',
      '',
      `${STYLE.RED}🟠 DANGER  ·  T-0 to T+5 (12:30 → 12:35 UTC)${STYLE.RESET}`,
      '   The print moment. Markets often whipsaw 50–100 pips on DXY',
      '   pairs in the first 60 seconds. Do not trade this window.',
      '   Action: stand aside. Watch only.',
      '',
      `${STYLE.RED}🛑 STAND ASIDE  ·  If both CPI and Lagarde surprise hawkish${STYLE.RESET}`,
      '   Combined surprise from both events would re-price the dollar',
      '   for the rest of the session. Wait for the 15-minute close',
      '   AFTER Lagarde finishes (~14:30 UTC) before resuming.',
      '',
      `${STYLE.GREEN}🟢 RE-ENTRY  ·  12:35 UTC onwards${STYLE.RESET}`,
      '   Re-read structure on the 5m chart. Match against the',
      '   reaction-path scenarios above. Act only on the cleanest',
      '   setups that match the actual direction the market chose.',
      '```',
      '',
      goldSubheading('What changes this risk state'),
      '',
      '   • If CPI cancels (rare): state drops to YELLOW.',
      '   • If a central-bank decision is added: state climbs to RED.',
      '   • If Lagarde\'s speech is cancelled: state drops to YELLOW.',
    ].join('\n'),
  },

  // ── Message 5: What traders should watch + visual reference card ──
  {
    content: [
      newBadgeSeparator('WHAT TRADERS SHOULD WATCH  ·  PRE / DURING / POST'),
      '',
      goldSectionBox('👀  WHAT TRADERS SHOULD WATCH'),
      '',
      tealTerminologyRow(['DXY', 'Yield Spread', 'VIX', 'Liquidity']),
      '',
      goldSubheading('Pre-event indicators (now → 12:25 UTC)'),
      '   • DXY trend: above 105 = market already pricing hawkish CPI.',
      '   • 2Y yield: above 4.85% = same signal.',
      '   • VIX above 18 = elevated nerves; below 14 = complacent.',
      '   • EURUSD position into the print = market lean.',
      '',
      goldSubheading('During the event (12:30 → 12:35 UTC)'),
      '   • Initial print reaction in the first 60 seconds is noise.',
      '   • Watch the 5m candle close at 12:35 UTC — that\'s the trend.',
      '   • Read DXY first, then look at EURUSD / XAUUSD response.',
      '',
      goldSubheading('Post-event reassessment (12:35 → 14:00 UTC)'),
      '   • Did the initial direction hold or whipsaw?',
      '   • Is volume confirming the move or fading?',
      '   • What did treasuries do? (Bonds confirm rate-path bets.)',
      '   • Wait for Lagarde 14:00 UTC before sizing into new trades.',
      '',
      '',
      '```ansi',
      `${STYLE.GOLD}╔══════════════════════════════════════════════════╗`,
      `${STYLE.GOLD}║   📚  EVENT-DAY REFERENCE  ·  THE 4 WINDOWS       ║`,
      `${STYLE.GOLD}╚══════════════════════════════════════════════════╝${STYLE.RESET}`,
      '',
      `${STYLE.GREEN}   ▲ activity${STYLE.RESET}`,
      `${STYLE.GREEN}   │                ╭──────────────╮${STYLE.RESET}`,
      `${STYLE.GREEN}   │   pre-event   ╱  T-0 print    ╲   post-settle${STYLE.RESET}`,
      `${STYLE.RED}   │     ✓        ╱     ⚠ chaos      ╲    ✓ trade${STYLE.RESET}`,
      `${STYLE.GREEN}   │   ─────────╱─────────────────────╲────────${STYLE.RESET}`,
      `${STYLE.GREEN}   │           ╱                       ╲${STYLE.RESET}`,
      `${STYLE.GREEN}   └────────────────────────────────────────▶ time${STYLE.RESET}`,
      `${STYLE.RED}        T-5      T+0     T+5      T+15      T+30${STYLE.RESET}`,
      '',
      `${STYLE.CYAN}   ▸  How to read this${STYLE.RESET}`,
      '       Every macro event has 4 windows. Pre-event = trade with',
      '       size light. T-0 = stand aside. Post-settle (T+5 to T+15)',
      '       = the real direction shows up. T+30+ = normal trading.',
      '',
      `${STYLE.CYAN}   ▸  How a trader uses this${STYLE.RESET}`,
      '       Look at the clock against the event time on the schedule',
      '       above. Match the window to the rule. Position sizing and',
      '       entry timing follow from the window, not the chart alone.',
      '',
      `${STYLE.CYAN}   ▸  Rendered ATLAS event cards coming next${STYLE.RESET}`,
      '       Future scans will replace this schematic with rendered',
      '       ATLAS event cards — actual price charts during real CPI',
      '       prints, with the four windows annotated on live data.',
      '```',
      '',
      goldSubheading('Briefing summary'),
      '',
      '_Two macro events land within 90 minutes today. Risk state is_',
      '_CAUTION (4 / 5) for the next 6 hours. Reduce position sizing,_',
      '_avoid the T-0 print windows, and re-read structure AFTER the_',
      '_5-minute close on each event. ATLAS Market Intel next updates_',
      '_at 13:30 UTC with the post-CPI read._',
    ].join('\n'),
  },
];

// ── Main ────────────────────────────────────────────────────
async function main() {
  const written = await fohRenderer.renderAll(SAMPLE_MESSAGES, {
    outDir: path.join(__dirname, '..', 'docs', 'screenshots'),
    version: 'market-intel-foh-v1',
    channelName: 'market-intel',
    displayName: 'ATLAS  ·  Market Intel',
    subtitle: 'FOH.1.0.1 Market Intel prototype v1 · macro / event briefing · prototype-only',
    title: 'FOH.1.0.1 Market Intel — v1 prototype',
    sectionNames: ['banner-and-mood', 'cpi-event-card', 'reaction-paths', 'risk-escalation', 'watch-and-reference'],
    detailSpecs: [
      { messageIdx: 0, selector: '.message-content', label: 'banner-and-mood' },
      { messageIdx: 1, selector: '.embed',           label: 'cpi-event-card' },
      { messageIdx: 2, selector: '.message-content', label: 'reaction-paths' },
      { messageIdx: 3, selector: '.message-content', label: 'risk-escalation' },
      { messageIdx: 4, selector: '.message-content', label: 'watch-and-reference' },
    ],
  });
  console.log('Wrote ' + written.length + ' Market Intel artefacts:');
  for (const p of written) console.log('  · ' + p);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SAMPLE_MESSAGES };
