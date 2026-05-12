'use strict';
// QA harness — Visual Pattern Library v1
//
// Covers: catalogue completeness, schematic safety, term mapping,
// renderer behaviour at each level, direction-aware patterns,
// Discord-safety (chunk size, fenced blocks, ASCII-only width), and
// the three polished examples called out by the operator brief.

const path = require('path');
const lib = require(path.join('..', 'visualPatternLibrary.js'));

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? '  → ' + detail : ''}`);
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

// ----------------------------------------------------------------
// T1 — Catalogue completeness: exactly 14 patterns, every required id
// ----------------------------------------------------------------
section('T1 — Catalogue completeness');

const REQUIRED_IDS = [
  'hh_hl',
  'lh_ll',
  'bos',
  'choch',
  'breakout',
  'calm_retest',
  'failed_retest',
  'liquidity_sweep',
  'compression',
  'expansion',
  'continuation',
  'exhaustion',
  'inducement',
  'accumulation_distribution',
];

ok('exactly 14 pattern ids', lib.PATTERN_IDS.length === 14, `got ${lib.PATTERN_IDS.length}`);
REQUIRED_IDS.forEach((id) => {
  ok(`id present: ${id}`, lib.PATTERN_IDS.includes(id));
});

// ----------------------------------------------------------------
// T2 — Pattern shape: every pattern carries the required keys
// ----------------------------------------------------------------
section('T2 — Pattern shape');

const REQUIRED_KEYS = [
  'id', 'name', 'family', 'direction',
  'level1Schematic', 'level2Stub', 'level3Stub',
  'plainEnglish', 'whyItMatters', 'whatConfirms', 'whatInvalidates',
  'termTags', 'svgPath', 'pngPath',
];

lib.listAll().forEach((p) => {
  REQUIRED_KEYS.forEach((k) => {
    ok(`pattern ${p.id} has key "${k}"`, Object.prototype.hasOwnProperty.call(p, k));
  });
  ok(`pattern ${p.id}.id === '${p.id}'`, p.id === p.id);
  ok(`pattern ${p.id} plainEnglish non-empty`, typeof p.plainEnglish === 'string' && p.plainEnglish.length > 30);
  ok(`pattern ${p.id} whatConfirms non-empty`, typeof p.whatConfirms === 'string' && p.whatConfirms.length > 10);
  ok(`pattern ${p.id} whatInvalidates non-empty`, typeof p.whatInvalidates === 'string' && p.whatInvalidates.length > 10);
  ok(`pattern ${p.id} termTags is non-empty array`, Array.isArray(p.termTags) && p.termTags.length > 0);
  ok(`pattern ${p.id} svgPath defaults to null`, p.svgPath === null);
  ok(`pattern ${p.id} pngPath defaults to null`, p.pngPath === null);
});

// ----------------------------------------------------------------
// T3 — Schematic safety: every line ≤ 56 chars; no tab characters;
//      direction-aware patterns supply both variants
// ----------------------------------------------------------------
section('T3 — Schematic safety');

function checkSchematicString(id, s, variantLabel) {
  ok(`${id}${variantLabel ? ' [' + variantLabel + ']' : ''} is a string`, typeof s === 'string' && s.length > 0);
  const lines = s.split('\n');
  ok(`${id}${variantLabel ? ' [' + variantLabel + ']' : ''} ≥ 4 lines`, lines.length >= 4);
  const tooWide = lines.find((ln) => ln.length > 56);
  ok(`${id}${variantLabel ? ' [' + variantLabel + ']' : ''} every line ≤ 56 chars`, !tooWide, tooWide ? `wide line: "${tooWide}"` : '');
  ok(`${id}${variantLabel ? ' [' + variantLabel + ']' : ''} contains no tab chars`, !s.includes('\t'));
}

lib.listAll().forEach((p) => {
  const s = p.level1Schematic;
  if (typeof s === 'string') {
    checkSchematicString(p.id, s);
  } else {
    ok(`${p.id} direction-aware schematic carries Bullish variant`, !!s[lib.DIR.BULLISH]);
    ok(`${p.id} direction-aware schematic carries Bearish variant`, !!s[lib.DIR.BEARISH]);
    if (s[lib.DIR.BULLISH]) checkSchematicString(p.id, s[lib.DIR.BULLISH], 'Bullish');
    if (s[lib.DIR.BEARISH]) checkSchematicString(p.id, s[lib.DIR.BEARISH], 'Bearish');
  }
});

// ----------------------------------------------------------------
// T4 — Term mapping: every required term maps to a real pattern id
// ----------------------------------------------------------------
section('T4 — Term mapping');

const TERM_SAMPLES = [
  ['HH', 'hh_hl'],
  ['HL', 'hh_hl'],
  ['higher high', 'hh_hl'],
  ['LH', 'lh_ll'],
  ['LL', 'lh_ll'],
  ['lower low', 'lh_ll'],
  ['BOS', 'bos'],
  ['break of structure', 'bos'],
  ['CHoCH', 'choch'],
  ['change of character', 'choch'],
  ['breakout', 'breakout'],
  ['calm retest', 'calm_retest'],
  ['failed retest', 'failed_retest'],
  ['false_break', 'failed_retest'],
  ['liquidity sweep', 'liquidity_sweep'],
  ['stop_run', 'liquidity_sweep'],
  ['compression', 'compression'],
  ['squeeze', 'compression'],
  ['expansion', 'expansion'],
  ['continuation', 'continuation'],
  ['exhaustion', 'exhaustion'],
  ['inducement', 'inducement'],
  ['accumulation', 'accumulation_distribution'],
  ['distribution', 'accumulation_distribution'],
  ['consolidation', 'accumulation_distribution'],
  ['sideways', 'accumulation_distribution'],
];

TERM_SAMPLES.forEach(([term, expectedId]) => {
  const got = lib.findPatternForTerm(term);
  ok(`"${term}" → ${expectedId}`, !!got && got.id === expectedId, got ? `got ${got.id}` : 'no match');
});

ok('unknown term returns null', lib.findPatternForTerm('definitely-not-a-pattern') === null);
ok('null term returns null', lib.findPatternForTerm(null) === null);
ok('empty term returns null', lib.findPatternForTerm('') === null);

// ----------------------------------------------------------------
// T5 — renderPattern at LEVEL 1 (schematic)
// ----------------------------------------------------------------
section('T5 — renderPattern level 1 (schematic)');

const lhRender = lib.renderPattern('lh_ll', { level: lib.LEVELS.SCHEMATIC });
ok('LH/LL render begins with bold heading', /^\*\*Visual pattern — Lower High \/ Lower Low/.test(lhRender));
ok('LH/LL render contains fenced code block', /```[\s\S]*?```/.test(lhRender));
ok('LH/LL render carries "What it is"', /\*\*What it is:\*\*/.test(lhRender));
ok('LH/LL render carries "Why it matters"', /\*\*Why it matters:\*\*/.test(lhRender));
ok('LH/LL render carries "What confirms it"', /\*\*What confirms it:\*\*/.test(lhRender));
ok('LH/LL render carries "What invalidates it"', /\*\*What invalidates it:\*\*/.test(lhRender));
ok('LH/LL render heading is bearish (not Higher High / Higher Low)', !/Higher High \/ Higher Low/i.test(lhRender));
ok('LH/LL render schematic block contains LH + LL markers', /```[\s\S]*?LH[\s\S]*?LL[\s\S]*?```/.test(lhRender));

// ----------------------------------------------------------------
// T6 — Direction-aware rendering (BOS, CHoCH)
// ----------------------------------------------------------------
section('T6 — Direction-aware rendering');

const bosBull = lib.renderPattern('bos', { direction: lib.DIR.BULLISH, body: false });
const bosBear = lib.renderPattern('bos', { direction: lib.DIR.BEARISH, body: false });
ok('BOS bullish render references "close above prior high"', /close above prior high/i.test(bosBull));
ok('BOS bearish render references "close below prior low"', /close below prior low/i.test(bosBear));
ok('BOS bullish and bearish renders differ', bosBull !== bosBear);

const chochBull = lib.renderPattern('choch', { direction: lib.DIR.BULLISH, body: false });
const chochBear = lib.renderPattern('choch', { direction: lib.DIR.BEARISH, body: false });
ok('CHoCH bullish references "first higher high"', /first higher high/i.test(chochBull));
ok('CHoCH bearish references "first lower low"', /first lower low/i.test(chochBear));

// ----------------------------------------------------------------
// T7 — renderPattern at LEVEL 2 / LEVEL 3 (stub propagation)
// ----------------------------------------------------------------
section('T7 — renderPattern levels 2 + 3 stubs');

const lvl2 = lib.renderPattern('breakout', { level: lib.LEVELS.HISTORICAL });
const lvl3 = lib.renderPattern('breakout', { level: lib.LEVELS.LIVE });
ok('level 2 render carries "_Historical anchor:_"', /_Historical anchor:_/.test(lvl2));
ok('level 3 render carries "_Live anchor:_"', /_Live anchor:_/.test(lvl3));
ok('level 2 stub words "pending"', /pending/i.test(lvl2));
ok('level 3 stub words "pending"', /pending/i.test(lvl3));

// ----------------------------------------------------------------
// T8 — Discord chunk safety: full render of every pattern fits in
//      a single Discord message (≤ 1900 chars body-only buffer)
// ----------------------------------------------------------------
section('T8 — Discord chunk safety');

const DISCORD_SAFE_BUDGET = 1900;
lib.listAll().forEach((p) => {
  const directions = (typeof p.level1Schematic === 'object')
    ? [lib.DIR.BULLISH, lib.DIR.BEARISH]
    : [p.direction || lib.DIR.EITHER];
  directions.forEach((dir) => {
    const txt = lib.renderPattern(p.id, { level: lib.LEVELS.SCHEMATIC, direction: dir });
    ok(`${p.id}${directions.length > 1 ? ' [' + dir + ']' : ''} full render ≤ ${DISCORD_SAFE_BUDGET} chars`, txt.length <= DISCORD_SAFE_BUDGET, `len=${txt.length}`);
  });
});

// ----------------------------------------------------------------
// T9 — Heading + body toggles work
// ----------------------------------------------------------------
section('T9 — Heading / body toggles');

const headingOff = lib.renderPattern('compression', { heading: false });
ok('heading=false suppresses heading', !/^\*\*Visual pattern —/.test(headingOff));
ok('heading=false still emits fenced block', /```[\s\S]*?```/.test(headingOff));

const bodyOff = lib.renderPattern('compression', { body: false });
ok('body=false suppresses What it is', !/\*\*What it is:\*\*/.test(bodyOff));
ok('body=false still emits fenced block', /```[\s\S]*?```/.test(bodyOff));

// ----------------------------------------------------------------
// T10 — Three polished examples (operator brief)
// ----------------------------------------------------------------
section('T10 — Three polished examples');

// Example 1 — Bearish LH/LL
const example1 = lib.renderPattern('lh_ll', { level: lib.LEVELS.SCHEMATIC });
ok('Ex.1 (Bearish LH/LL) — heading correct', /Lower High \/ Lower Low/.test(example1));
ok('Ex.1 (Bearish LH/LL) — schematic block present', /```[\s\S]*?LH[\s\S]*?LL[\s\S]*?```/.test(example1));
ok('Ex.1 (Bearish LH/LL) — invalidation references higher high', /higher high|HH/.test(example1));
ok('Ex.1 (Bearish LH/LL) — Discord-safe length', example1.length <= DISCORD_SAFE_BUDGET);

// Example 2 — Breakout + calm retest as a combined render
const ex2Parts = [
  lib.renderPattern('breakout', { level: lib.LEVELS.SCHEMATIC }),
  lib.renderPattern('calm_retest', { level: lib.LEVELS.SCHEMATIC }),
];
const example2 = ex2Parts.join('\n\n');
ok('Ex.2 — breakout + calm-retest combined render assembles', example2.includes('Breakout') && example2.includes('Calm Retest'));
ok('Ex.2 — both schematic blocks present', (example2.match(/```/g) || []).length === 4);
ok('Ex.2 — Discord-safe length when combined', example2.length <= DISCORD_SAFE_BUDGET);

// Example 3 — Liquidity sweep
const example3 = lib.renderPattern('liquidity_sweep', { level: lib.LEVELS.SCHEMATIC });
ok('Ex.3 (Liquidity sweep) — heading correct', /Liquidity Sweep/.test(example3));
ok('Ex.3 (Liquidity sweep) — body references wick + body close back', /wick/i.test(example3) && /body close/i.test(example3));
ok('Ex.3 (Liquidity sweep) — invalidation references full body close beyond', /full body close beyond/i.test(example3));
ok('Ex.3 (Liquidity sweep) — Discord-safe length', example3.length <= DISCORD_SAFE_BUDGET);

// ----------------------------------------------------------------
// T11 — Theme slots present for dashboard pipeline (no values used
//       by Discord; just confirmed available for SVG/PNG later)
// ----------------------------------------------------------------
section('T11 — Theme + SVG/PNG slot availability');

ok('ATLAS_THEME exported', typeof lib.ATLAS_THEME === 'object');
ok('theme background present', typeof lib.ATLAS_THEME.background === 'string' && /^#/.test(lib.ATLAS_THEME.background));
ok('theme accent (gold) present', typeof lib.ATLAS_THEME.accent === 'string' && /^#/.test(lib.ATLAS_THEME.accent));
ok('theme bullish present', typeof lib.ATLAS_THEME.bullish === 'string' && /^#/.test(lib.ATLAS_THEME.bullish));
ok('theme bearish present', typeof lib.ATLAS_THEME.bearish === 'string' && /^#/.test(lib.ATLAS_THEME.bearish));
ok('every pattern carries svgPath slot (null v1)', lib.listAll().every((p) => p.svgPath === null));
ok('every pattern carries pngPath slot (null v1)', lib.listAll().every((p) => p.pngPath === null));

// ----------------------------------------------------------------
// T12 — Frozen catalogue immutability
// ----------------------------------------------------------------
section('T12 — Catalogue immutability');

let mutationBlocked = false;
try {
  lib.PATTERNS.hh_hl = { id: 'mutated' };
  mutationBlocked = lib.PATTERNS.hh_hl.id !== 'mutated';
} catch (e) {
  mutationBlocked = true;
}
ok('top-level PATTERNS object frozen against reassignment', mutationBlocked);

let levelsFrozen = false;
try {
  lib.LEVELS.SCHEMATIC = 'tampered';
  levelsFrozen = lib.LEVELS.SCHEMATIC !== 'tampered';
} catch (e) {
  levelsFrozen = true;
}
ok('LEVELS object frozen against reassignment', levelsFrozen);

// ----------------------------------------------------------------
console.log('\n==========================');
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed === 0) {
  console.log('[VISUAL-PATTERN-LIBRARY-QA] PASS — 14-pattern catalogue intact; term mapping resolves cleanly; renderer respects level + direction + heading/body toggles; every render Discord-chunk-safe; SVG/PNG slots reserved.');
  process.exit(0);
} else {
  console.log('[VISUAL-PATTERN-LIBRARY-QA] FAIL — see failures above.');
  process.exit(1);
}
