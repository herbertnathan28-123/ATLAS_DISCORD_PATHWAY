'use strict';
// ATLAS Visual Pattern Library v1 — doctrine-complete foundation.
//
// Purpose
// -------
// A single reusable spine of chart-pattern visual learning content.
// Two surfaces are produced from one catalogue:
//
//   1. Concise top-of-output learning links row (e.g. Dark Horse,
//      Macro, dashboard, training modules).
//   2. Deep institutional glossary entry — the link destination
//      itself, with full doctrine (schematic + plain-English +
//      why-it-matters + confirmation + invalidation + common
//      mistakes + ATLAS interpretation + related terms).
//
// Doctrine notes (operator brief)
// -------------------------------
//   - The current Dark Horse inline glossary is INTERIM. The
//     long-term doctrine is: concise top-of-output hyperlinks +
//     minimal inline context; full depth lives at the deep
//     glossary destination.
//   - Every applicable pattern carries a Bullish AND a Bearish
//     schematic variant. HH/HL and LH/LL are single-direction by
//     nature; compression / expansion / accumulation_distribution
//     are bidirectional by nature (no split).
//   - Deep destination URL is intentionally NOT hard-coded here.
//     Callers register a builder via setDeepLinkBuilder(fn) or
//     pass opts.linkBuilder per call. Default emits `#<slug>` so
//     the library is useful as-is for in-document anchors and as
//     a Discord-safe label.
//   - SVG/PNG slots are reserved on every pattern. The future
//     dashboard pipeline (echarts.min.js consumer) reads
//     ATLAS_THEME and renders.
//
// Hard boundaries (Lane 1)
// ------------------------
//   - No engine integration in this file. Lane 2 wires this into
//     Dark Horse; this file is foundation only.
//   - No scoring / threshold / ranking / scheduler / transport /
//     macro logic. Pure presentation + content primitives.
//   - No external runtime dependencies. Self-contained.
//
// Public API
// ----------
//   PATTERNS                       frozen catalogue (14 entries)
//   PATTERN_IDS                    enumerated ids (stable order)
//   TERM_TO_PATTERN_ID             glossary term → pattern id
//   LEVELS                         SCHEMATIC / HISTORICAL / LIVE
//   DIR                            BULLISH / BEARISH / EITHER
//   ATLAS_THEME                    SVG/PNG palette slots
//
//   getPattern(id)                 lookup by id
//   findPatternForTerm(term)       lookup by free-form term
//   listAll()                      enumerate patterns
//
//   getSlug(id)                    URL-safe slug for a pattern
//   getAnchorId(id)                in-doc anchor id
//   setDeepLinkBuilder(fn)         register link builder
//   defaultLinkBuilder(slug)       `#<slug>`
//
//   renderSchematicBlock(id, opts) fenced ASCII schematic
//   renderPattern(id, opts)        concise card (heading + block +
//                                  doctrine body) — legacy contract
//   renderLearningLinksRow(ids,opts)
//                                  one-line markdown links row,
//                                  Discord-safe, mobile-readable
//   renderDeepGlossaryEntry(id,opts)
//                                  full institutional entry — the
//                                  link destination itself

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

const DIR = Object.freeze({
  BULLISH: 'Bullish',
  BEARISH: 'Bearish',
  EITHER: 'Either',
});

// -----------------------------------------------------------------
// Schematics (≤ 56 chars/line, no tabs — Discord + mobile safe)
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
  '          ┌─ ● ─┐  ← [Structure Break] confirmed',
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
  '     ●          ┌─ ● ─┐ ← [Structure Break] confirmed',
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

const SCHEMATIC_BREAKOUT_BULL = [
  '                       ●  ← full body',
  '                      ╱     closes ABOVE',
  '                ●    ╱',
  '                │   ╱',
  '────●────●─────●───●─────── range ceiling',
  '     range  range  ╲',
  '                    new side',
  '',
  '   ──→ price exits range upward with a',
  '       full-body close above the level.',
].join('\n');

const SCHEMATIC_BREAKOUT_BEAR = [
  '     range  range',
  '────●────●─────●───●─────── range floor',
  '                │   ╲',
  '                ●    ╲',
  '                      ╲',
  '                       ●  ← full body',
  '                          closes BELOW',
  '',
  '   ──→ price exits range downward with a',
  '       full-body close below the level.',
].join('\n');

const SCHEMATIC_CALM_RETEST_BULL = [
  '       ●── breakout candle (up)',
  '      ╱',
  '─────●─────────────── breakout level',
  '      ╲   ╭── small, calm pullback',
  '       ╲ ╱     wicks the level, body holds',
  '        ●',
  '         ╲',
  '          ● ← continuation higher',
].join('\n');

const SCHEMATIC_CALM_RETEST_BEAR = [
  '          ● ← continuation lower',
  '         ╱',
  '        ●',
  '       ╱ ╲     wicks the level, body holds',
  '      ╱   ╰── small, calm pullback',
  '─────●─────────────── breakout level',
  '      ╲',
  '       ●── breakout candle (down)',
].join('\n');

const SCHEMATIC_FAILED_RETEST_BULL = [
  '       ●── breakout candle (up)',
  '      ╱',
  '─────●───────────── breakout level',
  '      ╲',
  '       ╲',
  '        ●── full body close BACK BELOW',
  '       ╱     the level (retest fails)',
  '      ●',
  '     ╱',
  '    ● ← move reverses lower, false break',
].join('\n');

const SCHEMATIC_FAILED_RETEST_BEAR = [
  '    ● ← move reverses higher, false break',
  '     ╲',
  '      ●',
  '       ╲',
  '        ●── full body close BACK ABOVE',
  '       ╱     the level (retest fails)',
  '      ╱',
  '─────●───────────── breakout level',
  '      ╲',
  '       ●── breakout candle (down)',
].join('\n');

const SCHEMATIC_LIQUIDITY_SWEEP_BULL = [
  '            ╲ │',
  '             ╲│ body closes BACK ABOVE',
  '              ● ← reversal candle',
  '────────●  │',
  '────────●──┤───────── stop cluster',
  '         ╲ │ wick takes out the prior',
  '          ╲│ swing low (stops hit)',
  '           ●',
  '            ╲',
  '             ● — move runs the other way',
  '',
  'sweep BELOW low → reversal UP.',
].join('\n');

const SCHEMATIC_LIQUIDITY_SWEEP_BEAR = [
  '          ╱│ wick takes out the prior',
  '         ╱ │ swing high (stops hit)',
  '────────●  │',
  '────────●──┤───────── stop cluster',
  '         ╲ │',
  '          ╲│ body closes BACK BELOW',
  '           ● ← reversal candle',
  '            ╲',
  '             ● ← move runs the other way',
  '',
  'sweep ABOVE high → reversal DOWN.',
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

const SCHEMATIC_CONTINUATION_BULL = [
  'trend already in force (up) —',
  '',
  '            ●',
  '          ╱',
  '   ●    ╱',
  '  ╱ ╲  ╱   ← shallow pullback',
  ' ╱   ●╱       inside trend',
  '●',
  '             ●',
  '            ╱',
  '           ●  ← trend resumes higher',
].join('\n');

const SCHEMATIC_CONTINUATION_BEAR = [
  'trend already in force (down) —',
  '',
  '●',
  ' ╲',
  '  ╲    ●',
  '   ╲  ╱ ╲   ← shallow pullback',
  '    ╲╱   ●     inside trend',
  '    ●',
  '             ●',
  '              ╲',
  '               ●  ← trend resumes lower',
].join('\n');

const SCHEMATIC_EXHAUSTION_BULL = [
  '       ●  ← climax candle, large body',
  '      ╱      up with long wick',
  '     ╱',
  '   ●╱',
  '   ╱',
  '  ●     ← upside follow-through fails',
  ' ╱       (lower close after climax)',
  '●',
  '',
  'momentum drops; trend at risk of flip.',
].join('\n');

const SCHEMATIC_EXHAUSTION_BEAR = [
  '●',
  ' ╲',
  '  ╲',
  '   ●╲',
  '     ╲',
  '      ●   ← climax candle, large body',
  '      ╱      down with long wick',
  '     ╱',
  '    ●     ← downside follow-through fails',
  '   ╱       (higher close after climax)',
  '  ●',
  '',
  'momentum drops; trend at risk of flip.',
].join('\n');

const SCHEMATIC_INDUCEMENT_BULL = [
  '   ●╲',
  '     ╲    ← fake break DOWN baits shorts',
  '──●───●───────── bait level',
  '       ╲   ╱',
  '        ╲ ╱  ← price returns and',
  '         ●     collects late shorts',
  '          ╲',
  '           ● ← real move runs UP',
].join('\n');

const SCHEMATIC_INDUCEMENT_BEAR = [
  '            ●╲',
  '              ╲  ← fake break UP baits longs',
  '   ───●───────●────  bait level',
  '       ╲       ╲',
  '        ╲       ● ← price returns and',
  '         ╲       ╲   collects late longs',
  '          ●       ╲',
  '                   ● ← real move runs DOWN',
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
// Pattern catalogue (14 entries) — doctrine-complete schema
// -----------------------------------------------------------------

const PATTERNS = Object.freeze({
  hh_hl: Object.freeze({
    id: 'hh_hl',
    slug: 'hh-hl',
    anchorId: 'hh_hl',
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
    commonMistakes: [
      'Calling a single new high an uptrend before the next HL is confirmed.',
      'Treating a wick-only break of the prior HL as an invalidation — only a full body close counts.',
      'Buying every pullback regardless of macro / event-risk context — structure is necessary but not sufficient.',
    ],
    atlasInterpretation: 'ATLAS reads HH/HL as a permissive context, not a trade signal. It opens the door for trend-direction setups (continuation, calm retest, [Structure Break]); the actual entry still needs a confirmed structural event on the operating timeframe.',
    relatedTerms: ['lh_ll', 'bos', 'choch', 'continuation', 'calm_retest'],
    termTags: ['HH', 'HL', 'bullish_trend', 'uptrend'],
    svgPath: null,
    pngPath: null,
  }),

  lh_ll: Object.freeze({
    id: 'lh_ll',
    slug: 'lh-ll',
    anchorId: 'lh_ll',
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
    commonMistakes: [
      'Calling a single lower low a downtrend before the next LH is confirmed.',
      'Treating a wick-only break of the prior LH as an invalidation — only a full body close counts.',
      'Shorting every rally without checking macro / event-risk context.',
    ],
    atlasInterpretation: 'ATLAS reads LH/LL as a permissive context, not a trade signal. It opens the door for bear-direction setups (continuation lower, breakdown + retest, [Structure Break] down); the actual entry still needs a confirmed structural event on the operating timeframe.',
    relatedTerms: ['hh_hl', 'bos', 'choch', 'continuation', 'calm_retest'],
    termTags: ['LH', 'LL', 'bearish_trend', 'downtrend'],
    svgPath: null,
    pngPath: null,
  }),

  bos: Object.freeze({
    id: 'bos',
    slug: 'bos',
    anchorId: 'bos',
    name: 'Break of Structure (BOS)',
    family: 'structural_event',
    direction: DIR.EITHER,
    level1Schematic: Object.freeze({
      [DIR.BULLISH]: SCHEMATIC_BOS_BULL,
      [DIR.BEARISH]: SCHEMATIC_BOS_BEAR,
    }),
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the most recent BOS bar here.',
    plainEnglish: 'A break of structure is the first candle that closes (full body) beyond a prior swing high (for a bullish BOS) or below a prior swing low (for a bearish BOS). It is the moment the structural read changes.',
    whyItMatters: 'BOS is the first piece of evidence that a trend is extending — without a confirmed BOS the move is still inside the prior range.',
    whatConfirms: 'A full candle BODY closes beyond the prior swing level on the primary timeframe — not just a wick.',
    whatInvalidates: 'Price closes back inside the prior range on the same timeframe. A wick-only break never counts.',
    commonMistakes: [
      'Treating any candle that exceeds the prior swing as a BOS — wicks do not count.',
      'Reading a BOS on a low timeframe as if it changed the higher-timeframe trend.',
      'Acting on the BOS bar itself rather than waiting for the calm retest or next confirmation.',
    ],
    atlasInterpretation: 'ATLAS treats BOS as the structural anchor that unlocks trend-direction plays. The setup family that follows (calm retest, continuation) is what produces the actual entry; the BOS itself is the prerequisite.',
    relatedTerms: ['choch', 'continuation', 'calm_retest', 'failed_retest'],
    termTags: ['BOS', 'break_of_structure', 'structure_break'],
    svgPath: null,
    pngPath: null,
  }),

  choch: Object.freeze({
    id: 'choch',
    slug: 'choch',
    anchorId: 'choch',
    name: 'Change of Character (CHoCH)',
    family: 'structural_event',
    direction: DIR.EITHER,
    level1Schematic: Object.freeze({
      [DIR.BULLISH]: SCHEMATIC_CHOCH_BULL,
      [DIR.BEARISH]: SCHEMATIC_CHOCH_BEAR,
    }),
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the CHoCH bar here.',
    plainEnglish: 'CHoCH is the first counter-trend break: an uptrend printing its first lower low, or a downtrend printing its first higher high. It is the earliest sign of a flip.',
    whyItMatters: 'CHoCH signals that the prior trend has lost grip — the next BOS in the new direction tends to follow.',
    whatConfirms: 'A full candle body close beyond the most recent counter-trend swing, on the primary timeframe.',
    whatInvalidates: 'Price immediately reverses and resumes the prior trend with a fresh trend-direction BOS.',
    commonMistakes: [
      'Trading the CHoCH bar itself — CHoCH is a warning, not an entry signal.',
      'Confusing a CHoCH on a low timeframe with a higher-timeframe character flip.',
      'Skipping the subsequent BOS in the new direction and acting on CHoCH alone.',
    ],
    atlasInterpretation: 'ATLAS treats CHoCH as a stand-down tell for the prior trend, not as a reverse-direction entry. Entries in the new direction require a follow-up structural event (BOS, calm retest) on the operating timeframe.',
    relatedTerms: ['bos', 'hh_hl', 'lh_ll', 'liquidity_sweep'],
    termTags: ['CHoCH', 'change_of_character', 'character_flip'],
    svgPath: null,
    pngPath: null,
  }),

  breakout: Object.freeze({
    id: 'breakout',
    slug: 'breakout',
    anchorId: 'breakout',
    name: 'Breakout',
    family: 'range_event',
    direction: DIR.EITHER,
    level1Schematic: Object.freeze({
      [DIR.BULLISH]: SCHEMATIC_BREAKOUT_BULL,
      [DIR.BEARISH]: SCHEMATIC_BREAKOUT_BEAR,
    }),
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the breakout bar here.',
    plainEnglish: 'A breakout is a full-body close beyond a defined range edge after a period of compression. The level must have been respected at least twice to count as a range edge.',
    whyItMatters: 'Breakouts are where range-bound markets become trending markets. The first clean break sets the direction of the next leg.',
    whatConfirms: 'Full candle body closes beyond the level on the primary timeframe; participation expands on the break.',
    whatInvalidates: 'Wick-only break with body back inside the range, or a fast reclaim of the level on the next bar.',
    commonMistakes: [
      'Buying the breakout candle itself with no plan for the retest.',
      'Treating a wick beyond the level as a confirmed breakout.',
      'Ignoring event-risk windows — breakouts that print into a high-impact catalyst often fail on the release.',
    ],
    atlasInterpretation: 'ATLAS prefers the calm retest of a confirmed breakout over the breakout-candle entry. The retest is where structural conviction is paid for; the breakout itself often pays the FOMO premium.',
    relatedTerms: ['calm_retest', 'failed_retest', 'compression', 'expansion'],
    termTags: ['breakout', 'range_break', 'range_exit'],
    svgPath: null,
    pngPath: null,
  }),

  calm_retest: Object.freeze({
    id: 'calm_retest',
    slug: 'calm-retest',
    anchorId: 'calm_retest',
    name: 'Calm Retest',
    family: 'continuation_event',
    direction: DIR.EITHER,
    level1Schematic: Object.freeze({
      [DIR.BULLISH]: SCHEMATIC_CALM_RETEST_BULL,
      [DIR.BEARISH]: SCHEMATIC_CALM_RETEST_BEAR,
    }),
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the retest bar here.',
    plainEnglish: 'After a breakout, price drifts back to the broken level with small, low-energy candles — wicks may touch the level but the bodies hold the new side. That is the calm-retest signature.',
    whyItMatters: 'A calm retest is the cleanest continuation signal because it shows the new side is being defended without panic.',
    whatConfirms: 'Body close holds the new side on retest; pullback uses 30–60% of the breakout-candle range, no more.',
    whatInvalidates: 'A full body close BACK through the level — that becomes a failed retest, not a calm retest.',
    commonMistakes: [
      'Confusing a deep, high-energy pullback with a calm retest — those usually fail.',
      'Skipping the retest and chasing the breakout, then taking the calm retest as confirmation only after the second leg has already run.',
      'Treating wick touches of the level as invalidations — wicks are allowed; bodies are not.',
    ],
    atlasInterpretation: 'ATLAS rates the calm retest the highest-confidence continuation entry. Energy of the pullback is the primary tell — quiet = healthy, hot = suspect.',
    relatedTerms: ['breakout', 'failed_retest', 'bos', 'continuation'],
    termTags: ['calm_retest', 'pullback_continuation', 'breakout_retest', 'retest_holds'],
    svgPath: null,
    pngPath: null,
  }),

  failed_retest: Object.freeze({
    id: 'failed_retest',
    slug: 'failed-retest',
    anchorId: 'failed_retest',
    name: 'Failed Retest',
    family: 'invalidation_event',
    direction: DIR.EITHER,
    level1Schematic: Object.freeze({
      [DIR.BULLISH]: SCHEMATIC_FAILED_RETEST_BULL,
      [DIR.BEARISH]: SCHEMATIC_FAILED_RETEST_BEAR,
    }),
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the failed-retest bar here.',
    plainEnglish: 'After a breakout, price returns to the broken level and closes a full body BACK through it. The break did not hold; the breakout has failed.',
    whyItMatters: 'A failed retest converts a continuation read into a reversal read. Existing breakout plans should stand down.',
    whatConfirms: 'Full candle body close BACK through the broken level on the primary timeframe.',
    whatInvalidates: 'Price re-reclaims the level with another full body close on the breakout side. That converts back to a (later, weaker) continuation.',
    commonMistakes: [
      'Holding a breakout trade through a failed retest in the hope that price will recover.',
      'Reading every wick-back through the level as a failed retest — the body has to close.',
      'Flipping direction immediately on the failed-retest bar rather than waiting for the new structural confirmation.',
    ],
    atlasInterpretation: 'ATLAS treats the failed retest as a hard invalidator: the prior plan is dead, and a brand-new structural confirmation is required before opening a counter-direction trade.',
    relatedTerms: ['calm_retest', 'breakout', 'inducement', 'liquidity_sweep'],
    termTags: ['failed_retest', 'false_break', 'breakout_failure'],
    svgPath: null,
    pngPath: null,
  }),

  liquidity_sweep: Object.freeze({
    id: 'liquidity_sweep',
    slug: 'liquidity-sweep',
    anchorId: 'liquidity_sweep',
    name: 'Liquidity Sweep',
    family: 'reversal_event',
    direction: DIR.EITHER,
    level1Schematic: Object.freeze({
      [DIR.BULLISH]: SCHEMATIC_LIQUIDITY_SWEEP_BULL,
      [DIR.BEARISH]: SCHEMATIC_LIQUIDITY_SWEEP_BEAR,
    }),
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the sweep bar here.',
    plainEnglish: 'A wick takes out a known cluster of stops sitting above a swing high (or below a swing low), and the candle BODY closes BACK on the original side. The stops were taken; the move was not.',
    whyItMatters: 'A liquidity sweep is one of the strongest reversal tells — it shows the level was raided for liquidity, not broken with intent.',
    whatConfirms: 'Long wick beyond the prior swing high/low + same-bar body close back on the original side, ideally with the next bar following through.',
    whatInvalidates: 'A subsequent full body close beyond the swept level. Then it was a real break, not a sweep.',
    commonMistakes: [
      'Calling every wick a sweep — the body must close back on the original side on the same bar.',
      'Entering on the sweep candle itself rather than waiting for follow-through.',
      'Reading sweeps inside major event-risk windows as structural — releases can take stops AND keep going.',
    ],
    atlasInterpretation: 'ATLAS treats a liquidity sweep as a high-conviction reversal tell only when the body close + the next-bar follow-through both line up. Sweep without follow-through is a flag, not a trade.',
    relatedTerms: ['failed_retest', 'inducement', 'exhaustion', 'choch'],
    termTags: ['liquidity_sweep', 'stop_run', 'wick_reversal', 'sweep'],
    svgPath: null,
    pngPath: null,
  }),

  compression: Object.freeze({
    id: 'compression',
    slug: 'compression',
    anchorId: 'compression',
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
    commonMistakes: [
      'Trying to pick a direction inside the squeeze rather than waiting for the resolution.',
      'Reading every quiet bar as compression — compression requires a sequence, not a single quiet candle.',
      'Sizing the next leg from the squeeze midpoint instead of the squeeze edge.',
    ],
    atlasInterpretation: 'ATLAS treats compression as a stand-down state for new directional trades. The trade lives at the resolution; inside the squeeze, sizing and entries are suspended.',
    relatedTerms: ['expansion', 'breakout', 'accumulation_distribution'],
    termTags: ['compression', 'squeeze', 'volatility_contraction', 'tight_range'],
    svgPath: null,
    pngPath: null,
  }),

  expansion: Object.freeze({
    id: 'expansion',
    slug: 'expansion',
    anchorId: 'expansion',
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
    commonMistakes: [
      'Using prior-baseline stop sizes inside an expansion regime — stops get hunted on noise.',
      'Reading every wide bar as expansion — expansion is a multi-bar regime, not one big candle.',
      'Failing to step aside when expansion turns into chop / reversal.',
    ],
    atlasInterpretation: 'ATLAS treats expansion as the regime where structural setups deliver. Risk is sized against the expanded range, not the prior baseline; trade selectivity goes up, not down.',
    relatedTerms: ['compression', 'breakout', 'continuation', 'exhaustion'],
    termTags: ['expansion', 'volatility_expansion', 'range_expansion', 'wide_range'],
    svgPath: null,
    pngPath: null,
  }),

  continuation: Object.freeze({
    id: 'continuation',
    slug: 'continuation',
    anchorId: 'continuation',
    name: 'Continuation',
    family: 'trend_event',
    direction: DIR.EITHER,
    level1Schematic: Object.freeze({
      [DIR.BULLISH]: SCHEMATIC_CONTINUATION_BULL,
      [DIR.BEARISH]: SCHEMATIC_CONTINUATION_BEAR,
    }),
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the continuation leg here.',
    plainEnglish: 'Inside an existing trend, a shallow pullback ends and the trend resumes in the prior direction. No structure flip; the pullback was just a pause.',
    whyItMatters: 'Continuation is the highest-base-rate trade family — playing with the trend after a shallow pullback.',
    whatConfirms: 'Pullback respects the prior trend-direction swing point AND the next leg prints a fresh trend-direction extreme (HH for bullish, LL for bearish).',
    whatInvalidates: 'Pullback breaks the prior trend-direction swing point — read switches to potential CHoCH / reversal.',
    commonMistakes: [
      'Buying / selling deep counter-trend pullbacks that have already invalidated the prior swing.',
      'Entering on the pullback before any structural confirmation that the trend has resumed.',
      'Ignoring volatility regime — continuation entries inside compression often whip; inside expansion they travel.',
    ],
    atlasInterpretation: 'ATLAS treats continuation as the default trade family while structure is intact. It is the bread-and-butter setup; setup quality is high when trend + volatility + macro context all line up.',
    relatedTerms: ['hh_hl', 'lh_ll', 'bos', 'calm_retest', 'expansion'],
    termTags: ['continuation', 'trend_continuation', 'pullback'],
    svgPath: null,
    pngPath: null,
  }),

  exhaustion: Object.freeze({
    id: 'exhaustion',
    slug: 'exhaustion',
    anchorId: 'exhaustion',
    name: 'Exhaustion',
    family: 'reversal_event',
    direction: DIR.EITHER,
    level1Schematic: Object.freeze({
      [DIR.BULLISH]: SCHEMATIC_EXHAUSTION_BULL,
      [DIR.BEARISH]: SCHEMATIC_EXHAUSTION_BEAR,
    }),
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the climax bar here.',
    plainEnglish: 'A large-body climax candle prints in the trend direction, but the next bar fails to extend — closing below the prior close (or above, in a downtrend). The fuel is gone.',
    whyItMatters: 'Exhaustion warns that trend-direction trades are no longer favoured. It is a stand-down tell more than an entry tell.',
    whatConfirms: 'Climax candle with body materially larger than recent average AND immediate failure to follow through on the next bar.',
    whatInvalidates: 'The next bar extends in the trend direction — trend is still in force, the climax was just another impulse.',
    commonMistakes: [
      'Selling tops / buying bottoms on the climax bar itself with no follow-through confirmation.',
      'Treating large bodies inside expansion as exhaustion — context matters, not just bar size.',
      'Flipping to counter-trend trades on exhaustion without a follow-up CHoCH / BOS in the new direction.',
    ],
    atlasInterpretation: 'ATLAS uses exhaustion as a position-management tell first (trail / take off), and only as a reversal trade setup once a follow-up structural confirmation lines up.',
    relatedTerms: ['expansion', 'choch', 'liquidity_sweep', 'failed_retest'],
    termTags: ['exhaustion', 'climax', 'blow_off', 'trend_fatigue'],
    svgPath: null,
    pngPath: null,
  }),

  inducement: Object.freeze({
    id: 'inducement',
    slug: 'inducement',
    anchorId: 'inducement',
    name: 'Inducement',
    family: 'trap_event',
    direction: DIR.EITHER,
    level1Schematic: Object.freeze({
      [DIR.BULLISH]: SCHEMATIC_INDUCEMENT_BULL,
      [DIR.BEARISH]: SCHEMATIC_INDUCEMENT_BEAR,
    }),
    level2Stub: 'Historical anchor pending — Corey Clone replay slot.',
    level3Stub: 'Live anchor pending — engine attaches the inducement leg here.',
    plainEnglish: 'A move prints just enough of a break in the "obvious" direction to collect late entries and protective stops, then reverses and travels the other way.',
    whyItMatters: 'Inducement is why "obvious" trades fail. Recognising it keeps the operator out of the late-entry side of a trap.',
    whatConfirms: 'A modest break of an obvious level (just enough to be visible on retail charts) followed by an immediate reversal that takes out the inducement-leg origin.',
    whatInvalidates: 'The "obvious" break runs cleanly with a full body close beyond and no reversal — it was a real break, not an inducement.',
    commonMistakes: [
      'Entering on the obvious break that "looks too good".',
      'Confusing every false break with inducement — inducement requires a clean reversal that takes out the bait-leg origin.',
      'Reading inducement only after the fact and chasing the real move late.',
    ],
    atlasInterpretation: 'ATLAS treats inducement as a flag to wait — the bait leg itself is never an entry. The real entry comes after the bait fails and the structural read in the OPPOSITE direction is confirmed.',
    relatedTerms: ['failed_retest', 'liquidity_sweep', 'breakout'],
    termTags: ['inducement', 'trap', 'liquidity_trap', 'false_lead'],
    svgPath: null,
    pngPath: null,
  }),

  accumulation_distribution: Object.freeze({
    id: 'accumulation_distribution',
    slug: 'accumulation-distribution',
    anchorId: 'accumulation_distribution',
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
    commonMistakes: [
      'Picking a direction inside the range based on a single touch of one boundary.',
      'Reading every range as accumulation by default; sometimes it is distribution and the direction reveals only on the exit.',
      'Setting stops just outside the range — they are exactly where the sweep candle hunts.',
    ],
    atlasInterpretation: 'ATLAS treats accumulation/distribution as a range-respect state: no directional trades until the range exits with a confirmed breakout + retest. The character of the exit (clean breakout vs sweep + reclaim) tells you whether the prior phase was real absorption or just chop.',
    relatedTerms: ['compression', 'breakout', 'liquidity_sweep', 'failed_retest'],
    termTags: ['accumulation', 'distribution', 'range', 'consolidation', 'sideways'],
    svgPath: null,
    pngPath: null,
  }),
});

const PATTERN_IDS = Object.freeze(Object.keys(PATTERNS));

// -----------------------------------------------------------------
// Term → pattern mapping
// -----------------------------------------------------------------

const TERM_TO_PATTERN_ID = Object.freeze({
  hh: 'hh_hl',
  hl: 'hh_hl',
  'higher high': 'hh_hl',
  'higher low': 'hh_hl',
  'hh/hl': 'hh_hl',
  bullish_trend: 'hh_hl',
  uptrend: 'hh_hl',

  lh: 'lh_ll',
  ll: 'lh_ll',
  'lower high': 'lh_ll',
  'lower low': 'lh_ll',
  'lh/ll': 'lh_ll',
  bearish_trend: 'lh_ll',
  downtrend: 'lh_ll',

  bos: 'bos',
  break_of_structure: 'bos',
  'break of structure': 'bos',
  structure_break: 'bos',

  choch: 'choch',
  change_of_character: 'choch',
  'change of character': 'choch',
  character_flip: 'choch',

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

  compression: 'compression',
  squeeze: 'compression',
  volatility_contraction: 'compression',
  tight_range: 'compression',

  expansion: 'expansion',
  volatility_expansion: 'expansion',
  range_expansion: 'expansion',
  wide_range: 'expansion',

  continuation: 'continuation',
  trend_continuation: 'continuation',
  pullback: 'continuation',

  accumulation: 'accumulation_distribution',
  distribution: 'accumulation_distribution',
  range: 'accumulation_distribution',
  consolidation: 'accumulation_distribution',
  sideways: 'accumulation_distribution',
  'accumulation/distribution': 'accumulation_distribution',
});

// -----------------------------------------------------------------
// Deep-link architecture
//
// The deep glossary destination is intentionally pluggable. Default
// returns `#<slug>` so the library is useful in any markdown
// surface without configuration. Surfaces with a real destination
// (dashboard, docs site, in-Discord pinned doc) register their own
// builder via setDeepLinkBuilder(fn) at boot, or pass
// opts.linkBuilder per call.
// -----------------------------------------------------------------

function defaultLinkBuilder(slug) {
  return `#${slug}`;
}

let _deepLinkBuilder = defaultLinkBuilder;

function setDeepLinkBuilder(fn) {
  if (typeof fn !== 'function') {
    _deepLinkBuilder = defaultLinkBuilder;
    return;
  }
  _deepLinkBuilder = fn;
}

function _resolveLinkBuilder(opts) {
  if (opts && typeof opts.linkBuilder === 'function') return opts.linkBuilder;
  return _deepLinkBuilder;
}

// -----------------------------------------------------------------
// Public helpers
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

function getSlug(id) {
  const p = getPattern(id);
  return p ? p.slug : null;
}

function getAnchorId(id) {
  const p = getPattern(id);
  return p ? p.anchorId : null;
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

function _hasBothVariants(pattern) {
  const s = pattern.level1Schematic;
  return !!(s && typeof s === 'object' && s[DIR.BULLISH] && s[DIR.BEARISH]);
}

// Short name for link rendering — drop the parenthetical
// "(bullish trend structure)" suffix to keep links compact.
function _shortName(pattern) {
  return pattern.name.replace(/\s*\(.*?\)\s*$/, '').trim();
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

// Concise card render — heading + schematic + doctrine body.
// Backwards-compatible with the v1 contract.
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

// One-line compact links row — designed for the very top of a
// Dark Horse / Macro / dashboard surface. Routes the reader into
// the deep glossary destination.
//
//   ids               array of pattern ids to surface
//   opts.linkBuilder  override the registered deep-link builder
//   opts.prefix       leading label (default '📘 Learn: ')
//   opts.separator    separator between links (default ' · ')
//   opts.maxItems     cap on number of links rendered (default 6)
function renderLearningLinksRow(ids, opts) {
  if (!Array.isArray(ids) || ids.length === 0) return '';
  const o = opts || {};
  const builder = _resolveLinkBuilder(o);
  const prefix = (typeof o.prefix === 'string') ? o.prefix : '📘 Learn: ';
  const separator = (typeof o.separator === 'string') ? o.separator : ' · ';
  const maxItems = Number.isFinite(o.maxItems) && o.maxItems > 0 ? o.maxItems : 6;

  const links = ids
    .map((id) => getPattern(id))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((p) => `[${_shortName(p)}](${builder(p.slug)})`);

  if (links.length === 0) return '';
  return prefix + links.join(separator);
}

// Full institutional entry — the deep glossary destination itself.
// Every doctrine field surfaces here; this is what the link-row
// hyperlink points to.
//
//   id                pattern id
//   opts.includeBothVariants
//                     when the pattern is direction-aware, render
//                     both Bullish and Bearish schematics
//                     (default true)
//   opts.heading      emit the H2-style heading (default true)
//   opts.anchorMarker emit a bare <a name="..."> anchor before the
//                     heading. Markdown surfaces ignore it; HTML
//                     surfaces use it. (default false)
function renderDeepGlossaryEntry(id, opts) {
  const pattern = getPattern(id);
  if (!pattern) return '';
  const o = opts || {};
  const wantBoth = o.includeBothVariants !== false;
  const wantHeading = o.heading !== false;
  const wantAnchor = o.anchorMarker === true;

  const lines = [];
  if (wantAnchor) {
    lines.push(`<a name="${pattern.anchorId}"></a>`);
  }
  if (wantHeading) {
    lines.push(`## ${pattern.name}`);
  }

  // Schematic(s)
  if (_hasBothVariants(pattern) && wantBoth) {
    lines.push('**Bullish variant:**');
    lines.push(renderSchematicBlock(id, { direction: DIR.BULLISH }));
    lines.push('**Bearish variant:**');
    lines.push(renderSchematicBlock(id, { direction: DIR.BEARISH }));
  } else {
    lines.push(renderSchematicBlock(id, { direction: pattern.direction }));
  }

  // Doctrine sections
  lines.push(`**What it is:** ${pattern.plainEnglish}`);
  lines.push(`**Why it matters:** ${pattern.whyItMatters}`);
  lines.push(`**What confirms it:** ${pattern.whatConfirms}`);
  lines.push(`**What invalidates it:** ${pattern.whatInvalidates}`);

  // Common mistakes (bulleted)
  if (Array.isArray(pattern.commonMistakes) && pattern.commonMistakes.length) {
    lines.push('**Common mistakes:**');
    pattern.commonMistakes.forEach((m) => lines.push(`• ${m}`));
  }

  // ATLAS interpretation
  if (pattern.atlasInterpretation) {
    lines.push(`**ATLAS interpretation:** ${pattern.atlasInterpretation}`);
  }

  // Related terms — rendered as a compact links row to other
  // glossary entries.
  if (Array.isArray(pattern.relatedTerms) && pattern.relatedTerms.length) {
    const row = renderLearningLinksRow(pattern.relatedTerms, {
      prefix: '**Related:** ',
      separator: ' · ',
      maxItems: 8,
      linkBuilder: _resolveLinkBuilder(o),
    });
    if (row) lines.push(row);
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
  getSlug,
  getAnchorId,

  defaultLinkBuilder,
  setDeepLinkBuilder,

  renderSchematicBlock,
  renderPattern,
  renderLearningLinksRow,
  renderDeepGlossaryEntry,
};
