'use strict';
// ATLAS Visual Pattern Library v1 — foundation module.
//
// Purpose
// -------
// A single reusable spine of chart-pattern schematics + plain-English
// explanations, callable from any engine (Dark Horse, Macro,
// dashboard, education layer). v1 ships the Discord-safe layer only:
// ASCII/Unicode schematics inside fenced code blocks. SVG/PNG metadata
// slots are present so the dashboard pipeline can attach later
// without changing the public API.
//
// Hard boundaries
// ---------------
//   - No engine integration in this file. Lane 2 wires this into
//     Dark Horse; this file is foundation only.
//   - No scoring / threshold / ranking / scheduler / transport /
//     macro logic. Pure presentation primitives.
//   - No external runtime dependencies. Self-contained.
//
// Doctrine — three rendering levels
// ---------------------------------
//   Level 1 — schematic           ASCII/Unicode diagram + meaning.
//   Level 2 — historical anchor   "When this last fired in <symbol>,
//                                 the outcome was X." Wired by
//                                 Corey Clone replay (stub here).
//   Level 3 — live anchor         "Right now in <symbol>, the move
//                                 looks like this." Wired by the
//                                 calling engine (stub here).
//
// Public API
// ----------
//   PATTERNS                          frozen catalogue (14 entries)
//   PATTERN_IDS                       enumerated ids
//   TERM_TO_PATTERN_ID                glossary term → pattern id
//   getPattern(id)                    lookup by id
//   findPatternForTerm(term)          lookup by term
//   renderPattern(id, opts)           render at chosen level
//   renderSchematicBlock(id)          Discord-safe fenced block
//   listAll()                         enumerate patterns
//
// Theme slots (SVG/PNG dashboard layer — not used by Discord)
// -----------------------------------------------------------
//   ATLAS_THEME.background  '#0B0B0B'   black canvas
//   ATLAS_THEME.accent      '#D4AF37'   gold accent
//   ATLAS_THEME.bullish     '#00FF5A'   up structure
//   ATLAS_THEME.bearish     '#FF3B30'   down structure
//   ATLAS_THEME.neutral     '#9AA0A6'   inert / pending

const LEVELS = Object.freeze({
  SCHEMATIC: 'level1_schematic',
  HISTORICAL: 'level2_historical',
  LIVE: 'level3_live',
});

const ATLAS_THEME = Object.freeze({
  background: '#0B0B0B',
  accent: '#D4AF37',
  bullish: '#00FF5A',
  bearish: '#FF3B30',
  neutral: '#9AA0A6',
});

// Direction tags reused across patterns. Some patterns have a single
// direction (HH/HL is inherently bullish); others are bidirectional
// (BOS, CHoCH, breakout, etc.) and the renderer picks the variant.
const DIR = Object.freeze({
  BULLISH: 'Bullish',
  BEARISH: 'Bearish',
  EITHER: 'Either',
});

// -----------------------------------------------------------------
//  Schematics
//
//  All schematics are designed to render cleanly inside a Discord
//  monospace code block (```...```). Width capped at ~46 chars so
//  they survive mobile viewports without horizontal scroll.
// -----------------------------------------------------------------

const SCHEMATIC_HH_HL = [
  '                                    HH ●',
  '                                  ╱',
  '                          HH ●  ╱',
  '                        ╱      HL',
  '                HH ●  ╱',
  '              ╱      HL',
  '      HH ●  ╱',
  '    ╱      HL',
  '●  ╱',
  '   HL',
  '',
  'Each new high prints above the last;',
  'each pullback (HL) stays above the prior low.',
].join('\n');

const SCHEMATIC_LH_LL = [
  '●  ╲',
  '    LH',
  '      ●  ╲',
  '          LH',
  '            ●  ╲',
  '                LH',
  '                  ●  ╲',
  '                      LH',
  '                        ●  ╲',
  '                          LL',
  '',
  'Each new high prints below the last;',
  'each push down (LL) extends below the prior low.',
].join('\n');

const SCHEMATIC_BOS_BULL = [
  '              ╭── close above prior high',
  '              ▼',
  '          ┌─ ● ─┐  ← BOS confirmed',
  '          │     │',
  '────●─────┤     │  prior swing high',
  '    ╲    ╱      │',
  '     ╲  ╱       │',
  '      ●         │',
  '                ▼',
  '         continuation attempt',
].join('\n');

const SCHEMATIC_BOS_BEAR = [
  '         close below prior low',
  '                 │',
  '                 ▼',
  '     ●          ┌─ ● ─┐ ← BOS confirmed',
  '    ╱ ╲         │     │',
  '   ╱   ╲   ╱────┤     │ prior swing low',
  '──●     ●─╱     │     │',
  '                │     │',
  '                ▼     ▼',
  '         continuation attempt',
].join('\n');

const SCHEMATIC_CHOCH_BULL = [
  'prior trend: lower highs / lower lows',
  '',
  '●╲',
  '  LH',
  '    ●╲',
  '      LL ●─── first higher high ⇒ CHoCH',
  '         ╲   ╱',
  '          ● ╱',
  '           ●',
  '',
  'character flips from bearish to bullish.',
].join('\n');

const SCHEMATIC_CHOCH_BEAR = [
  'prior trend: higher highs / higher lows',
  '',
  '            HH ●',
  '          ╱',
  '   HL ●─╱',
  '       ●  ← first lower low ⇒ CHoCH',
  '        ╲',
  '         ●',
  '          ╲',
  '           ●',
  '',
  'character flips from bullish to bearish.',
].join('\n');

const SCHEMATIC_BREAKOUT = [
  '              ┌─── close beyond level',
  '              ▼',
  '────●────●────●────●────── breakout level',
  '    range  range  range',
  '',
  '   ──→ price exits the range with a full',
  '       candle body close beyond the level.',
].join('\n');

const SCHEMATIC_CALM_RETEST = [
  '       ●── breakout candle',
  '      ╱',
  '─────●─────────────── breakout level',
  '      ╲   ╭── small, calm pullback',
  '       ╲ ╱     wicks the level, body holds',
  '        ●',
  '         ╲',
  '          ● ← continuation',
].join('\n');

const SCHEMATIC_FAILED_RETEST = [
  '       ●── breakout candle',
  '      ╱',
  '─────●───────────── breakout level',
  '      ╲',
  '       ╲',
  '        ●── full body close BACK through',
  '       ╱     the level (retest fails)',
  '      ●',
  '     ╱',
  '    ● ← move reverses, false break',
].join('\n');

const SCHEMATIC_LIQUIDITY_SWEEP = [
  '          ╱│ wick takes out the prior',
  '         ╱ │ swing high (stops hit)',
  '────────●  │',
  '────────●──┤───────── stop cluster',
  '         ╲ │',
  '          ╲│ body closes BACK below',
  '           ● ← reversal candle',
  '            ╲',
  '             ● ← move runs the other way',
].join('\n');

const SCHEMATIC_COMPRESSION = [
  '●╲',
  '  ╲',
  '   ╲     ●',
  '    ╲   ╱ ╲',
  '     ╲ ╱   ╲   ●',
  '      ●     ╲ ╱ ╲',
  '             ●   ╲   ●',
  '                  ╲ ╱',
  '                   ●  ← range tightens,',
  '                      volatility drops',
].join('\n');

const SCHEMATIC_EXPANSION = [
  '         ●',
  '        ╱',
  '       ╱           ●',
  '      ╱           ╱',
  '     ●          ╱',
  '      ╲       ╱',
  '       ●    ╱',
  '        ╲  ╱',
  '         ●   ← range widens sharply,',
  '             candles grow in size',
].join('\n');

const SCHEMATIC_CONTINUATION = [
  'trend already in force —',
  '',
  '            ●',
  '          ╱',
  '   ●    ╱',
  '  ╱ ╲  ╱   ← shallow pullback',
  ' ╱   ●╱       inside trend',
  '●',
  '             ●',
  '            ╱',
  '           ●  ← trend resumes',
].join('\n');

const SCHEMATIC_EXHAUSTION = [
  '       ●  ← climax candle, large body',
  '      ╱      and/or long wick',
  '     ╱',
  '   ●╱',
  '   ╱',
  '  ●     ← upside follow-through fails',
  ' ╱       (lower close after climax)',
  '●',
  '',
  'momentum drops; trend at risk of flip.',
].join('\n');

const SCHEMATIC_INDUCEMENT = [
  '            ●╲',
  '              ╲  ← obvious "easy" break',
  '   ───●───────●────  bait level',
  '       ╲       ╲',
  '        ╲       ● ← price returns and',
  '         ╲       ╲   collects late entries',
  '          ●       ╲',
  '                   ● ← real move runs',
  '                       the other way',
].join('\n');

const SCHEMATIC_ACCUM_DISTR = [
  '         range floor / ceiling',
  '   ┌───────────────────────────────┐',
  '   │   ●   ●    ●     ●    ●       │',
  '   │  ╱ ╲ ╱ ╲  ╱ ╲   ╱ ╲  ╱ ╲      │  ← price',
  '   │ ●   ●   ●●   ● ●   ●●   ●     │    cycles',
  '   │  ╲ ╱     ╲ ╱   ╲ ╱     ╲ ╱    │    inside',
  '   │   ●       ●     ●       ●     │    range',
  '   └───────────────────────────────┘',
  '',
  'eventual exit reveals direction —',
  'up = accumulation, down = distribution.',
].join('\n');

// -----------------------------------------------------------------
//  Pattern catalogue (14 entries)
// -----------------------------------------------------------------

const PATTERNS = Object.freeze({
  hh_hl: {
    id: 'hh_hl',
    name: 'Higher High / Higher Low (bullish trend structure)',
    family: 'trend_structure',
    direction: DIR.BULLISH,
    level1Schematic: SCHEMATIC_HH_HL,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches current swing reads here.',
    plainEnglish: 'Each new high prints above the prior high, and each pullback stops above the prior low. That stacking is the textbook signature of a healthy uptrend.',
    whyItMatters: 'It tells the operator the trend is intact and pullbacks are buyable in principle — the structure has not flipped.',
    whatConfirms: 'A fresh high prints, and the next pullback bottoms ABOVE the prior pullback low. Both legs must be visible.',
    whatInvalidates: 'A pullback breaks below the prior higher low (HL). At that point the bull structure is at risk; a confirmed lower low (LL) flips the read.',
    termTags: ['HH', 'HL', 'bullish_trend', 'uptrend'],
    svgPath: null,
    pngPath: null,
  },

  lh_ll: {
    id: 'lh_ll',
    name: 'Lower High / Lower Low (bearish trend structure)',
    family: 'trend_structure',
    direction: DIR.BEARISH,
    level1Schematic: SCHEMATIC_LH_LL,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches current swing reads here.',
    plainEnglish: 'Each new high prints below the prior high, and each push down extends below the prior low. That cascade is the textbook signature of a downtrend.',
    whyItMatters: 'It tells the operator the trend is bearish in principle — rallies are sellable, dips are not buyable until the structure flips.',
    whatConfirms: 'A fresh lower high prints, and the next leg down closes below the prior swing low. Both legs must be visible.',
    whatInvalidates: 'A rally breaks above the prior lower high (LH). At that point the bear structure is at risk; a confirmed higher high (HH) flips the read.',
    termTags: ['LH', 'LL', 'bearish_trend', 'downtrend'],
    svgPath: null,
    pngPath: null,
  },

  bos: {
    id: 'bos',
    name: 'Break of Structure (BOS)',
    family: 'structural_event',
    direction: DIR.EITHER,
    level1Schematic: {
      [DIR.BULLISH]: SCHEMATIC_BOS_BULL,
      [DIR.BEARISH]: SCHEMATIC_BOS_BEAR,
    },
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the most recent BOS bar here.',
    plainEnglish: 'A break of structure is the first candle that closes (full body) beyond a prior swing high (for a bullish BOS) or below a prior swing low (for a bearish BOS). It is the moment the structural read changes.',
    whyItMatters: 'BOS is the first piece of evidence that a trend is extending — without a confirmed BOS the move is still inside the prior range.',
    whatConfirms: 'A full candle BODY closes beyond the prior swing level on the primary timeframe — not just a wick.',
    whatInvalidates: 'Price closes back inside the prior range on the same timeframe. A wick-only break never counts.',
    termTags: ['BOS', 'break_of_structure', 'structure_break'],
    svgPath: null,
    pngPath: null,
  },

  choch: {
    id: 'choch',
    name: 'Change of Character (CHoCH)',
    family: 'structural_event',
    direction: DIR.EITHER,
    level1Schematic: {
      [DIR.BULLISH]: SCHEMATIC_CHOCH_BULL,
      [DIR.BEARISH]: SCHEMATIC_CHOCH_BEAR,
    },
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the CHoCH bar here.',
    plainEnglish: 'CHoCH is the first counter-trend break: an uptrend printing its first lower low, or a downtrend printing its first higher high. It is the earliest sign of a flip.',
    whyItMatters: 'CHoCH signals that the prior trend has lost grip — the next BOS in the new direction tends to follow.',
    whatConfirms: 'A full candle body close beyond the most recent counter-trend swing, on the primary timeframe.',
    whatInvalidates: 'Price immediately reverses and resumes the prior trend with a fresh trend-direction BOS.',
    termTags: ['CHoCH', 'change_of_character', 'character_flip'],
    svgPath: null,
    pngPath: null,
  },

  breakout: {
    id: 'breakout',
    name: 'Breakout',
    family: 'range_event',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_BREAKOUT,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the breakout bar here.',
    plainEnglish: 'A breakout is a full-body close beyond a defined range edge after a period of compression. The level must have been respected at least twice to count as a range edge.',
    whyItMatters: 'Breakouts are where range-bound markets become trending markets. The first clean break sets the direction of the next leg.',
    whatConfirms: 'Full candle body closes beyond the level on the primary timeframe; volume / participation expands on the break.',
    whatInvalidates: 'Wick-only break with body back inside the range, or a fast reclaim of the level on the next bar.',
    termTags: ['breakout', 'range_break', 'range_exit'],
    svgPath: null,
    pngPath: null,
  },

  calm_retest: {
    id: 'calm_retest',
    name: 'Calm Retest',
    family: 'continuation_event',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_CALM_RETEST,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the retest bar here.',
    plainEnglish: 'After a breakout, price drifts back to the broken level with small, low-energy candles — wicks may touch the level but the bodies hold the new side. That is the calm-retest signature.',
    whyItMatters: 'A calm retest is the cleanest continuation signal because it shows the new side is being defended without panic.',
    whatConfirms: 'Body close holds the new side on retest; pullback uses 30–60% of the breakout-candle range, no more.',
    whatInvalidates: 'A full body close BACK through the level — that becomes a failed retest, not a calm retest.',
    termTags: ['calm_retest', 'pullback_continuation', 'breakout_retest'],
    svgPath: null,
    pngPath: null,
  },

  failed_retest: {
    id: 'failed_retest',
    name: 'Failed Retest',
    family: 'invalidation_event',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_FAILED_RETEST,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the failed-retest bar here.',
    plainEnglish: 'After a breakout, price returns to the broken level and closes a full body BACK through it. The break did not hold; the breakout has failed.',
    whyItMatters: 'A failed retest converts a continuation read into a reversal read. Existing breakout plans should stand down.',
    whatConfirms: 'Full candle body close BACK through the broken level on the primary timeframe.',
    whatInvalidates: 'Price re-reclaims the level with another full body close on the breakout side. That converts back to a (later, weaker) continuation.',
    termTags: ['failed_retest', 'false_break', 'breakout_failure'],
    svgPath: null,
    pngPath: null,
  },

  liquidity_sweep: {
    id: 'liquidity_sweep',
    name: 'Liquidity Sweep',
    family: 'reversal_event',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_LIQUIDITY_SWEEP,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the sweep bar here.',
    plainEnglish: 'A wick takes out a known cluster of stops sitting above a swing high (or below a swing low), and the candle BODY closes BACK on the original side. The stops were taken; the move was not.',
    whyItMatters: 'A liquidity sweep is one of the strongest reversal tells — it shows the level was raided for liquidity, not broken with intent.',
    whatConfirms: 'Long wick beyond the prior swing high/low + same-bar body close back on the original side, ideally with the next bar following through.',
    whatInvalidates: 'A subsequent full body close beyond the swept level. Then it was a real break, not a sweep.',
    termTags: ['liquidity_sweep', 'stop_run', 'wick_reversal', 'sweep'],
    svgPath: null,
    pngPath: null,
  },

  compression: {
    id: 'compression',
    name: 'Compression',
    family: 'volatility_state',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_COMPRESSION,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the compression window here.',
    plainEnglish: 'Successive candles get smaller and the high/low range tightens — buyers and sellers are absorbing each other. Volatility drops; the chart looks "quiet".',
    whyItMatters: 'Compression precedes expansion. The longer the squeeze, the larger the subsequent move tends to be.',
    whatConfirms: 'Multiple consecutive bars with shrinking high-to-low range AND shrinking body size on the primary timeframe.',
    whatInvalidates: 'A sudden expansion bar — compression has resolved, the pattern is no longer current.',
    termTags: ['compression', 'squeeze', 'volatility_contraction', 'tight_range'],
    svgPath: null,
    pngPath: null,
  },

  expansion: {
    id: 'expansion',
    name: 'Expansion',
    family: 'volatility_state',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_EXPANSION,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the expansion window here.',
    plainEnglish: 'Candle ranges grow sharply, bodies are larger than the prior baseline, and the chart "opens up". Volatility is rising.',
    whyItMatters: 'Expansion is where directional moves run; in expansion, structural plays travel faster and stop placement must respect the new range.',
    whatConfirms: 'Average true range expanding for multiple consecutive bars; bodies materially larger than the recent average.',
    whatInvalidates: 'Range collapses back to the prior baseline — expansion has ended; the market is back in compression.',
    termTags: ['expansion', 'volatility_expansion', 'range_expansion', 'wide_range'],
    svgPath: null,
    pngPath: null,
  },

  continuation: {
    id: 'continuation',
    name: 'Continuation',
    family: 'trend_event',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_CONTINUATION,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the continuation leg here.',
    plainEnglish: 'Inside an existing trend, a shallow pullback ends and the trend resumes in the prior direction. No structure flip; the pullback was just a pause.',
    whyItMatters: 'Continuation is the highest-base-rate trade family — playing with the trend after a shallow pullback.',
    whatConfirms: 'Pullback respects the prior trend-direction swing point AND the next leg prints a fresh trend-direction extreme (HH for bullish, LL for bearish).',
    whatInvalidates: 'Pullback breaks the prior trend-direction swing point — read switches to potential CHoCH / reversal.',
    termTags: ['continuation', 'trend_continuation', 'pullback'],
    svgPath: null,
    pngPath: null,
  },

  exhaustion: {
    id: 'exhaustion',
    name: 'Exhaustion',
    family: 'reversal_event',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_EXHAUSTION,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the climax bar here.',
    plainEnglish: 'A large-body climax candle prints in the trend direction, but the next bar fails to extend — closing below the prior close (or above, in a downtrend). The fuel is gone.',
    whyItMatters: 'Exhaustion warns that trend-direction trades are no longer favoured. It is a stand-down tell more than an entry tell.',
    whatConfirms: 'Climax candle with body materially larger than recent average AND immediate failure to follow through on the next bar.',
    whatInvalidates: 'The next bar extends in the trend direction — trend is still in force, the climax was just another impulse.',
    termTags: ['exhaustion', 'climax', 'blow_off', 'trend_fatigue'],
    svgPath: null,
    pngPath: null,
  },

  inducement: {
    id: 'inducement',
    name: 'Inducement',
    family: 'trap_event',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_INDUCEMENT,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the inducement leg here.',
    plainEnglish: 'A move prints just enough of a break in the "obvious" direction to collect late entries and protective stops, then reverses and travels the other way.',
    whyItMatters: 'Inducement is why "obvious" trades fail. Recognising it keeps the operator out of the late-entry side of a trap.',
    whatConfirms: 'A modest break of an obvious level (just enough to be visible on retail charts) followed by an immediate reversal that takes out the inducement-leg origin.',
    whatInvalidates: 'The "obvious" break runs cleanly with a full body close beyond and no reversal — it was a real break, not an inducement.',
    termTags: ['inducement', 'trap', 'liquidity_trap', 'false_lead'],
    svgPath: null,
    pngPath: null,
  },

  accumulation_distribution: {
    id: 'accumulation_distribution',
    name: 'Accumulation / Distribution',
    family: 'range_state',
    direction: DIR.EITHER,
    level1Schematic: SCHEMATIC_ACCUM_DISTR,
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the active range here.',
    plainEnglish: 'Price cycles between a defined floor and ceiling for an extended period. Direction is unresolved; the eventual exit reveals which side was absorbing — up = accumulation, down = distribution.',
    whyItMatters: 'Knowing a market is in accumulation/distribution prevents premature directional plays. Wait for the range exit; do not pick a side inside the box.',
    whatConfirms: 'At least two touches of each range boundary on the primary timeframe with no full-body close beyond either.',
    whatInvalidates: 'A full-body close beyond either boundary — the range has resolved (breakout direction tells you accumulation vs distribution after the fact).',
    termTags: ['accumulation', 'distribution', 'range', 'consolidation', 'sideways'],
    svgPath: null,
    pngPath: null,
  },
});

const PATTERN_IDS = Object.freeze(Object.keys(PATTERNS));

// -----------------------------------------------------------------
//  Term → pattern mapping
//
//  Lower-cased keys keep lookups robust. The library can be called
//  with a glossary tag (e.g. 'BOS', 'liquidity_sweep') or a free-form
//  term that maps cleanly onto a pattern (e.g. 'lower high').
// -----------------------------------------------------------------

const TERM_TO_PATTERN_ID = Object.freeze({
  // HH / HL family
  hh: 'hh_hl',
  hl: 'hh_hl',
  'higher high': 'hh_hl',
  'higher low': 'hh_hl',
  'hh/hl': 'hh_hl',
  bullish_trend: 'hh_hl',
  uptrend: 'hh_hl',

  // LH / LL family
  lh: 'lh_ll',
  ll: 'lh_ll',
  'lower high': 'lh_ll',
  'lower low': 'lh_ll',
  'lh/ll': 'lh_ll',
  bearish_trend: 'lh_ll',
  downtrend: 'lh_ll',

  // Structural events
  bos: 'bos',
  break_of_structure: 'bos',
  'break of structure': 'bos',
  structure_break: 'bos',

  choch: 'choch',
  change_of_character: 'choch',
  'change of character': 'choch',
  character_flip: 'choch',

  // Range / breakout
  breakout: 'breakout',
  range_break: 'breakout',
  range_exit: 'breakout',

  calm_retest: 'calm_retest',
  'calm retest': 'calm_retest',
  pullback_continuation: 'calm_retest',
  breakout_retest: 'calm_retest',
  retest_holds: 'calm_retest',

  failed_retest: 'failed_retest',
  'failed retest': 'failed_retest',
  false_break: 'failed_retest',
  breakout_failure: 'failed_retest',

  // Reversal / trap
  liquidity_sweep: 'liquidity_sweep',
  'liquidity sweep': 'liquidity_sweep',
  stop_run: 'liquidity_sweep',
  wick_reversal: 'liquidity_sweep',
  sweep: 'liquidity_sweep',

  exhaustion: 'exhaustion',
  climax: 'exhaustion',
  blow_off: 'exhaustion',
  trend_fatigue: 'exhaustion',

  inducement: 'inducement',
  trap: 'inducement',
  liquidity_trap: 'inducement',
  false_lead: 'inducement',

  // Volatility states
  compression: 'compression',
  squeeze: 'compression',
  volatility_contraction: 'compression',
  tight_range: 'compression',

  expansion: 'expansion',
  volatility_expansion: 'expansion',
  range_expansion: 'expansion',
  wide_range: 'expansion',

  // Trend
  continuation: 'continuation',
  trend_continuation: 'continuation',
  pullback: 'continuation',

  // Range state
  accumulation: 'accumulation_distribution',
  distribution: 'accumulation_distribution',
  range: 'accumulation_distribution',
  consolidation: 'accumulation_distribution',
  sideways: 'accumulation_distribution',
  'accumulation/distribution': 'accumulation_distribution',
});

// -----------------------------------------------------------------
//  Public helpers
// -----------------------------------------------------------------

function getPattern(id) {
  if (!id || typeof id !== 'string') return null;
  return PATTERNS[id] || null;
}

function findPatternForTerm(term) {
  if (!term || typeof term !== 'string') return null;
  const key = term.trim().toLowerCase();
  const id = TERM_TO_PATTERN_ID[key];
  return id ? getPattern(id) : null;
}

function listAll() {
  return PATTERN_IDS.map((id) => PATTERNS[id]);
}

// Resolve the right schematic when a pattern is direction-aware.
function _resolveSchematic(pattern, direction) {
  const s = pattern.level1Schematic;
  if (typeof s === 'string') return s;
  if (s && typeof s === 'object') {
    if (direction === DIR.BULLISH && s[DIR.BULLISH]) return s[DIR.BULLISH];
    if (direction === DIR.BEARISH && s[DIR.BEARISH]) return s[DIR.BEARISH];
    return s[DIR.BULLISH] || s[DIR.BEARISH] || Object.values(s)[0] || '';
  }
  return '';
}

// Discord-safe fenced code block for the ASCII schematic.
function renderSchematicBlock(id, opts) {
  const pattern = getPattern(id);
  if (!pattern) return '';
  const direction = (opts && opts.direction) || pattern.direction || DIR.EITHER;
  const schematic = _resolveSchematic(pattern, direction);
  if (!schematic) return '';
  return '```\n' + schematic + '\n```';
}

// Render a pattern at the requested level.
//
//   opts.level      LEVELS.SCHEMATIC | LEVELS.HISTORICAL | LEVELS.LIVE
//                   (default = SCHEMATIC)
//   opts.direction  DIR.BULLISH | DIR.BEARISH | DIR.EITHER
//                   (defaults to pattern.direction; required for
//                   direction-aware patterns like BOS / CHoCH)
//   opts.heading    boolean — emit a "**Visual pattern — <name>**"
//                   line above the block. Default true.
//   opts.body       boolean — append plain-English / why-it-matters /
//                   confirms / invalidates section. Default true.
function renderPattern(id, opts) {
  const pattern = getPattern(id);
  if (!pattern) return '';
  const o = opts || {};
  const level = o.level || LEVELS.SCHEMATIC;
  const direction = o.direction || pattern.direction || DIR.EITHER;
  const wantHeading = o.heading !== false;
  const wantBody = o.body !== false;

  const lines = [];
  if (wantHeading) {
    lines.push(`**Visual pattern — ${pattern.name}**`);
  }

  if (level === LEVELS.SCHEMATIC) {
    lines.push(renderSchematicBlock(id, { direction }));
  } else if (level === LEVELS.HISTORICAL) {
    lines.push(renderSchematicBlock(id, { direction }));
    lines.push(`_Historical anchor:_ ${pattern.level2Stub}`);
  } else if (level === LEVELS.LIVE) {
    lines.push(renderSchematicBlock(id, { direction }));
    lines.push(`_Live anchor:_ ${pattern.level3Stub}`);
  }

  if (wantBody) {
    lines.push(`**What it is:** ${pattern.plainEnglish}`);
    lines.push(`**Why it matters:** ${pattern.whyItMatters}`);
    lines.push(`**What confirms it:** ${pattern.whatConfirms}`);
    lines.push(`**What invalidates it:** ${pattern.whatInvalidates}`);
  }

  return lines.filter(Boolean).join('\n');
}

module.exports = {
  PATTERNS,
  PATTERN_IDS,
  TERM_TO_PATTERN_ID,
  LEVELS,
  DIR,
  ATLAS_THEME,
  getPattern,
  findPatternForTerm,
  listAll,
  renderSchematicBlock,
  renderPattern,
};
