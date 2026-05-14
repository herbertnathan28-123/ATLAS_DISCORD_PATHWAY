'use strict';
// QA harness — Visual Pattern Library v1 (doctrine-complete)
//
// Covers: catalogue completeness, doctrine-complete pattern shape,
// schematic safety (every line ≤ 56 chars, no tabs), Bullish +
// Bearish variants on every applicable pattern, term mapping,
// renderer behaviour at each level, hyperlink architecture
// (default builder + override + per-call builder), concise
// learning-links row, deep glossary entry, Discord chunk-safety,
// catalogue immutability, three polished examples.

const path = require('path');

// Reset module cache so setDeepLinkBuilder side effects from earlier
// runs cannot leak between subsections — load a fresh module per
// "test app" instance via require.cache invalidation.
function freshLib() {
  delete require.cache[require.resolve(path.join('..', 'visualPatternLibrary.js'))];
  return require(path.join('..', 'visualPatternLibrary.js'));
}

const lib = freshLib();

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

// -----------------------------------------------------------------
// T1 — Catalogue completeness
// -----------------------------------------------------------------
section('T1 — Catalogue completeness');

const REQUIRED_IDS = [
  'hh_hl', 'lh_ll', 'bos', 'choch', 'breakout',
  'calm_retest', 'failed_retest', 'liquidity_sweep',
  'compression', 'expansion', 'continuation', 'exhaustion',
  'inducement', 'accumulation_distribution',
];

ok('exactly 14 pattern ids', lib.PATTERN_IDS.length === 14, `got ${lib.PATTERN_IDS.length}`);
REQUIRED_IDS.forEach((id) => {
  ok(`id present: ${id}`, lib.PATTERN_IDS.includes(id));
});

// -----------------------------------------------------------------
// T2 — Doctrine-complete pattern shape
// -----------------------------------------------------------------
section('T2 — Doctrine-complete pattern shape');

const REQUIRED_KEYS = [
  'id', 'slug', 'anchorId', 'name', 'family', 'direction',
  'level1Schematic', 'level2Stub', 'level3Stub',
  'plainEnglish', 'whyItMatters', 'whatConfirms', 'whatInvalidates',
  'commonMistakes', 'atlasInterpretation', 'relatedTerms',
  'termTags', 'svgPath', 'pngPath',
];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ANCHOR_RE = /^[a-z0-9_]+$/;

lib.listAll().forEach((p) => {
  REQUIRED_KEYS.forEach((k) => {
    ok(`pattern ${p.id} has key "${k}"`, Object.prototype.hasOwnProperty.call(p, k));
  });
  ok(`pattern ${p.id}.slug is URL-safe`, typeof p.slug === 'string' && SLUG_RE.test(p.slug), `slug=${p.slug}`);
  ok(`pattern ${p.id}.anchorId is anchor-safe`, typeof p.anchorId === 'string' && ANCHOR_RE.test(p.anchorId), `anchorId=${p.anchorId}`);
  ok(`pattern ${p.id} plainEnglish non-empty`, typeof p.plainEnglish === 'string' && p.plainEnglish.length > 30);
  ok(`pattern ${p.id} whatConfirms non-empty`, typeof p.whatConfirms === 'string' && p.whatConfirms.length > 10);
  ok(`pattern ${p.id} whatInvalidates non-empty`, typeof p.whatInvalidates === 'string' && p.whatInvalidates.length > 10);
  ok(`pattern ${p.id} commonMistakes is non-empty array`, Array.isArray(p.commonMistakes) && p.commonMistakes.length >= 2);
  ok(`pattern ${p.id} atlasInterpretation non-empty`, typeof p.atlasInterpretation === 'string' && p.atlasInterpretation.length > 30);
  ok(`pattern ${p.id} relatedTerms is non-empty array`, Array.isArray(p.relatedTerms) && p.relatedTerms.length >= 2);
  ok(`pattern ${p.id} relatedTerms entries are real pattern ids`, p.relatedTerms.every((r) => !!lib.getPattern(r)));
  ok(`pattern ${p.id} termTags is non-empty array`, Array.isArray(p.termTags) && p.termTags.length > 0);
  ok(`pattern ${p.id} svgPath defaults to null`, p.svgPath === null);
  ok(`pattern ${p.id} pngPath defaults to null`, p.pngPath === null);
});

// Slugs and anchorIds must each be unique across the catalogue.
const slugs = lib.listAll().map((p) => p.slug);
const anchors = lib.listAll().map((p) => p.anchorId);
ok('all slugs unique across catalogue', new Set(slugs).size === slugs.length);
ok('all anchorIds unique across catalogue', new Set(anchors).size === anchors.length);

// -----------------------------------------------------------------
// T3 — Schematic safety
// -----------------------------------------------------------------
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

// -----------------------------------------------------------------
// T4 — Direction-aware coverage doctrine
//
// Every "applicable" pattern must carry BOTH Bullish + Bearish
// schematic variants. Inherent-single-direction (HH/HL, LH/LL) and
// inherent-bidirectional (compression, expansion, accum/distr) are
// exempt.
// -----------------------------------------------------------------
section('T4 — Direction-aware coverage doctrine');

const MUST_HAVE_BOTH_VARIANTS = [
  'bos', 'choch', 'breakout', 'calm_retest', 'failed_retest',
  'liquidity_sweep', 'continuation', 'exhaustion', 'inducement',
];

MUST_HAVE_BOTH_VARIANTS.forEach((id) => {
  const p = lib.getPattern(id);
  const s = p && p.level1Schematic;
  ok(`${id} carries Bullish variant`, !!(s && typeof s === 'object' && s[lib.DIR.BULLISH]));
  ok(`${id} carries Bearish variant`, !!(s && typeof s === 'object' && s[lib.DIR.BEARISH]));
});

const SINGLE_VARIANT_ALLOWED = ['hh_hl', 'lh_ll', 'compression', 'expansion', 'accumulation_distribution'];
SINGLE_VARIANT_ALLOWED.forEach((id) => {
  const p = lib.getPattern(id);
  ok(`${id} is allowed single-schematic (no variant split required)`, typeof p.level1Schematic === 'string');
});

// -----------------------------------------------------------------
// T5 — Term mapping
// -----------------------------------------------------------------
section('T5 — Term mapping');

const TERM_SAMPLES = [
  ['HH', 'hh_hl'], ['HL', 'hh_hl'], ['higher high', 'hh_hl'],
  ['LH', 'lh_ll'], ['LL', 'lh_ll'], ['lower low', 'lh_ll'],
  ['BOS', 'bos'], ['break of structure', 'bos'],
  ['CHoCH', 'choch'], ['change of character', 'choch'],
  ['breakout', 'breakout'],
  ['calm retest', 'calm_retest'],
  ['failed retest', 'failed_retest'], ['false_break', 'failed_retest'],
  ['liquidity sweep', 'liquidity_sweep'], ['stop_run', 'liquidity_sweep'], ['sweep', 'liquidity_sweep'],
  ['compression', 'compression'], ['squeeze', 'compression'],
  ['expansion', 'expansion'],
  ['continuation', 'continuation'], ['pullback', 'continuation'],
  ['exhaustion', 'exhaustion'], ['climax', 'exhaustion'],
  ['inducement', 'inducement'], ['trap', 'inducement'],
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

// -----------------------------------------------------------------
// T6 — Hyperlink architecture
// -----------------------------------------------------------------
section('T6 — Hyperlink architecture');

ok('defaultLinkBuilder returns #<slug>', lib.defaultLinkBuilder('liquidity-sweep') === '#liquidity-sweep');
ok('getSlug returns slug for a known id', lib.getSlug('liquidity_sweep') === 'liquidity-sweep');
ok('getAnchorId returns anchorId for a known id', lib.getAnchorId('liquidity_sweep') === 'liquidity_sweep');
ok('getSlug returns null for unknown id', lib.getSlug('not-real') === null);
ok('getAnchorId returns null for unknown id', lib.getAnchorId('not-real') === null);

// Default builder applies in renderLearningLinksRow when nothing
// registered.
const defaultRow = lib.renderLearningLinksRow(['lh_ll', 'liquidity_sweep', 'failed_retest']);
ok('default row uses #<slug> form', /\[Lower High \/ Lower Low\]\(#lh-ll\)/.test(defaultRow) && /\[Liquidity Sweep\]\(#liquidity-sweep\)/.test(defaultRow));

// Register a global override.
const lib2 = freshLib();
lib2.setDeepLinkBuilder((slug) => `https://atlas-fx.test/glossary/${slug}`);
const overrideRow = lib2.renderLearningLinksRow(['lh_ll', 'liquidity_sweep']);
ok('setDeepLinkBuilder applies to subsequent renders', /\(https:\/\/atlas-fx\.test\/glossary\/lh-ll\)/.test(overrideRow));
ok('override still emits Liquidity Sweep entry', /\(https:\/\/atlas-fx\.test\/glossary\/liquidity-sweep\)/.test(overrideRow));

// Per-call opts.linkBuilder overrides everything.
const perCallRow = lib2.renderLearningLinksRow(['bos'], { linkBuilder: (s) => `/learn/${s}` });
ok('per-call linkBuilder overrides registered builder', /\[Break of Structure\]\(\/learn\/bos\)/.test(perCallRow));

// Reset back to default for following tests.
lib2.setDeepLinkBuilder(null);
ok('setDeepLinkBuilder(null) resets to default', /\[Liquidity Sweep\]\(#liquidity-sweep\)/.test(lib2.renderLearningLinksRow(['liquidity_sweep'])));

// -----------------------------------------------------------------
// T7 — renderLearningLinksRow behaviour
// -----------------------------------------------------------------
section('T7 — renderLearningLinksRow behaviour');

const row = lib.renderLearningLinksRow(['lh_ll', 'liquidity_sweep', 'failed_retest']);
ok('row begins with default 📘 Learn: prefix', /^📘 Learn: /.test(row));
ok('row uses " · " separator', / · /.test(row));
ok('row contains exactly 3 markdown links', (row.match(/\[[^\]]+\]\([^)]+\)/g) || []).length === 3);
ok('row is single-line (no newlines)', !row.includes('\n'));
ok('row drops the parenthetical from pattern names', !/\(bearish trend structure\)/.test(row) && !/\(BOS\)/.test(row));

const rowEmpty = lib.renderLearningLinksRow([]);
ok('empty ids → empty string', rowEmpty === '');
ok('null ids → empty string', lib.renderLearningLinksRow(null) === '');
ok('unknown-id-only list → empty string', lib.renderLearningLinksRow(['not-real']) === '');

const rowCustom = lib.renderLearningLinksRow(['bos', 'choch'], { prefix: 'Quick refs → ', separator: ' | ' });
ok('custom prefix applied', /^Quick refs → /.test(rowCustom));
ok('custom separator applied', / \| /.test(rowCustom));

const rowCapped = lib.renderLearningLinksRow(['bos', 'choch', 'breakout', 'calm_retest', 'failed_retest', 'liquidity_sweep', 'inducement', 'exhaustion'], { maxItems: 3 });
ok('maxItems cap applies', (rowCapped.match(/\[+[^\]]+\]+\([^)]+\)/g) || []).length === 3);

// -----------------------------------------------------------------
// T8 — renderDeepGlossaryEntry behaviour
// -----------------------------------------------------------------
section('T8 — renderDeepGlossaryEntry behaviour');

const deep = lib.renderDeepGlossaryEntry('liquidity_sweep');
ok('deep entry begins with H2 heading', /^## Liquidity Sweep/m.test(deep));
ok('deep entry includes Bullish variant header', /\*\*Bullish variant:\*\*/.test(deep));
ok('deep entry includes Bearish variant header', /\*\*Bearish variant:\*\*/.test(deep));
ok('deep entry includes both schematic code blocks', (deep.match(/```/g) || []).length === 4);
ok('deep entry includes What it is', /\*\*What it is:\*\*/.test(deep));
ok('deep entry includes Why it matters', /\*\*Why it matters:\*\*/.test(deep));
ok('deep entry includes What confirms it', /\*\*What confirms it:\*\*/.test(deep));
ok('deep entry includes What invalidates it', /\*\*What invalidates it:\*\*/.test(deep));
ok('deep entry includes Common mistakes', /\*\*Common mistakes:\*\*/.test(deep));
ok('deep entry includes at least 3 mistake bullets', (deep.match(/^• /gm) || []).length >= 3);
ok('deep entry includes ATLAS interpretation', /\*\*ATLAS interpretation:\*\*/.test(deep));
ok('deep entry includes Related row', /\*\*Related:\*\*/.test(deep));
ok('deep entry related row links to real patterns', /\[Failed Retest\]\(#failed-retest\)/.test(deep));

// Single-variant pattern (LH/LL) should render only one schematic.
const deepSingle = lib.renderDeepGlossaryEntry('lh_ll');
ok('single-variant deep entry has exactly one code block', (deepSingle.match(/```/g) || []).length === 2);
ok('single-variant deep entry has no "Bullish variant:" header', !/\*\*Bullish variant:\*\*/.test(deepSingle));
ok('single-variant deep entry has no "Bearish variant:" header', !/\*\*Bearish variant:\*\*/.test(deepSingle));

// Anchor marker opt-in
const deepAnchored = lib.renderDeepGlossaryEntry('bos', { anchorMarker: true });
ok('anchorMarker emits <a name="bos">', /<a name="bos"><\/a>/.test(deepAnchored));

// includeBothVariants=false collapses to default direction
const deepCollapsed = lib.renderDeepGlossaryEntry('bos', { includeBothVariants: false });
ok('includeBothVariants=false emits only one schematic block', (deepCollapsed.match(/```/g) || []).length === 2);

// -----------------------------------------------------------------
// T9 — renderPattern (legacy contract preserved)
// -----------------------------------------------------------------
section('T9 — renderPattern (legacy contract preserved)');

const lhRender = lib.renderPattern('lh_ll', { level: lib.LEVELS.SCHEMATIC });
ok('LH/LL render begins with bold heading', /^\*\*Visual pattern — Lower High \/ Lower Low/.test(lhRender));
ok('LH/LL render contains fenced code block', /```[\s\S]*?```/.test(lhRender));
ok('LH/LL render carries "What it is"', /\*\*What it is:\*\*/.test(lhRender));
ok('LH/LL render carries "Why it matters"', /\*\*Why it matters:\*\*/.test(lhRender));
ok('LH/LL render carries "What confirms it"', /\*\*What confirms it:\*\*/.test(lhRender));
ok('LH/LL render carries "What invalidates it"', /\*\*What invalidates it:\*\*/.test(lhRender));
ok('LH/LL render heading is bearish (not Higher High / Higher Low)', !/Higher High \/ Higher Low/i.test(lhRender));
ok('LH/LL render schematic block contains LH + LL markers', /```[\s\S]*?LH[\s\S]*?LL[\s\S]*?```/.test(lhRender));

const lvl2 = lib.renderPattern('breakout', { level: lib.LEVELS.HISTORICAL });
const lvl3 = lib.renderPattern('breakout', { level: lib.LEVELS.LIVE });
ok('level 2 render carries "_Historical anchor:_"', /_Historical anchor:_/.test(lvl2));
ok('level 3 render carries "_Live anchor:_"', /_Live anchor:_/.test(lvl3));

const bosBull = lib.renderPattern('bos', { direction: lib.DIR.BULLISH, body: false });
const bosBear = lib.renderPattern('bos', { direction: lib.DIR.BEARISH, body: false });
ok('BOS bullish render references "close above prior high"', /close above prior high/i.test(bosBull));
ok('BOS bearish render references "close below prior low"', /close below prior low/i.test(bosBear));
ok('BOS bullish ≠ BOS bearish render', bosBull !== bosBear);

// New: every must-have-both pattern emits a different render for
// Bullish vs Bearish (proves the variants are wired through
// renderPattern as well).
section('T9b — Variant differentiation across renderPattern');
MUST_HAVE_BOTH_VARIANTS.forEach((id) => {
  const bull = lib.renderPattern(id, { direction: lib.DIR.BULLISH, body: false });
  const bear = lib.renderPattern(id, { direction: lib.DIR.BEARISH, body: false });
  ok(`${id} Bullish render differs from Bearish render`, bull !== bear && bull.length > 0 && bear.length > 0);
});

// -----------------------------------------------------------------
// T10 — Discord chunk safety
// -----------------------------------------------------------------
section('T10 — Discord chunk safety');

const DISCORD_SAFE_BUDGET = 1900;

lib.listAll().forEach((p) => {
  const directions = (typeof p.level1Schematic === 'object')
    ? [lib.DIR.BULLISH, lib.DIR.BEARISH]
    : [p.direction || lib.DIR.EITHER];
  directions.forEach((dir) => {
    const txt = lib.renderPattern(p.id, { level: lib.LEVELS.SCHEMATIC, direction: dir });
    ok(`${p.id}${directions.length > 1 ? ' [' + dir + ']' : ''} renderPattern full body ≤ ${DISCORD_SAFE_BUDGET} chars`, txt.length <= DISCORD_SAFE_BUDGET, `len=${txt.length}`);
  });
});

// Deep entry — these are the link destinations, not surface
// renders. They can be longer than a single Discord message but
// should still fit within a 4×1900 = 7600-char ceiling so they
// chunk into at most four parts.
lib.listAll().forEach((p) => {
  const txt = lib.renderDeepGlossaryEntry(p.id);
  ok(`${p.id} deep entry ≤ 7600 chars (chunks ≤ 4)`, txt.length <= 7600, `len=${txt.length}`);
});

// Learning links row never exceeds Discord message size on its own.
const longRow = lib.renderLearningLinksRow(lib.PATTERN_IDS);
ok('learning-links row over the full catalogue ≤ Discord 2000-char limit', longRow.length <= 2000, `len=${longRow.length}`);

// -----------------------------------------------------------------
// T11 — Three polished examples (operator brief)
// -----------------------------------------------------------------
section('T11 — Three polished examples');

const example1 = lib.renderPattern('lh_ll', { level: lib.LEVELS.SCHEMATIC });
ok('Ex.1 (Bearish LH/LL) — heading correct', /Lower High \/ Lower Low/.test(example1));
ok('Ex.1 (Bearish LH/LL) — schematic block contains LH + LL markers', /```[\s\S]*?LH[\s\S]*?LL[\s\S]*?```/.test(example1));
ok('Ex.1 (Bearish LH/LL) — invalidation references higher high', /higher high|HH/.test(example1));
ok('Ex.1 (Bearish LH/LL) — Discord-safe length', example1.length <= DISCORD_SAFE_BUDGET);

const ex2Parts = [
  lib.renderPattern('breakout', { level: lib.LEVELS.SCHEMATIC, direction: lib.DIR.BULLISH }),
  lib.renderPattern('calm_retest', { level: lib.LEVELS.SCHEMATIC, direction: lib.DIR.BULLISH }),
];
const example2 = ex2Parts.join('\n\n');
ok('Ex.2 — breakout + calm-retest combined render assembles', example2.includes('Breakout') && example2.includes('Calm Retest'));
ok('Ex.2 — both schematic blocks present', (example2.match(/```/g) || []).length === 4);
ok('Ex.2 — Discord-safe length when combined', example2.length <= DISCORD_SAFE_BUDGET);

const example3 = lib.renderPattern('liquidity_sweep', { level: lib.LEVELS.SCHEMATIC, direction: lib.DIR.BEARISH });
ok('Ex.3 (Liquidity sweep) — heading correct', /Liquidity Sweep/.test(example3));
ok('Ex.3 (Liquidity sweep) — body references wick + body close back', /wick/i.test(example3) && /body close/i.test(example3));
ok('Ex.3 (Liquidity sweep) — invalidation references full body close beyond', /full body close beyond/i.test(example3));
ok('Ex.3 (Liquidity sweep) — Discord-safe length', example3.length <= DISCORD_SAFE_BUDGET);

// -----------------------------------------------------------------
// T12 — Theme + SVG/PNG slot availability
// -----------------------------------------------------------------
section('T12 — Theme + SVG/PNG slot availability');

ok('ATLAS_THEME exported', typeof lib.ATLAS_THEME === 'object');
ok('theme background present', typeof lib.ATLAS_THEME.background === 'string' && /^#/.test(lib.ATLAS_THEME.background));
ok('theme accent (gold) present', typeof lib.ATLAS_THEME.accent === 'string' && /^#/.test(lib.ATLAS_THEME.accent));
ok('theme bullish present', typeof lib.ATLAS_THEME.bullish === 'string' && /^#/.test(lib.ATLAS_THEME.bullish));
ok('theme bearish present', typeof lib.ATLAS_THEME.bearish === 'string' && /^#/.test(lib.ATLAS_THEME.bearish));
ok('every pattern carries svgPath slot (null v1)', lib.listAll().every((p) => p.svgPath === null));
ok('every pattern carries pngPath slot (null v1)', lib.listAll().every((p) => p.pngPath === null));

// -----------------------------------------------------------------
// T13 — Frozen catalogue immutability
// -----------------------------------------------------------------
section('T13 — Catalogue immutability');

let topMutationBlocked = false;
try {
  lib.PATTERNS.hh_hl = { id: 'mutated' };
  topMutationBlocked = lib.PATTERNS.hh_hl.id !== 'mutated';
} catch (e) {
  topMutationBlocked = true;
}
ok('top-level PATTERNS object frozen against reassignment', topMutationBlocked);

let levelsFrozen = false;
try {
  lib.LEVELS.SCHEMATIC = 'tampered';
  levelsFrozen = lib.LEVELS.SCHEMATIC !== 'tampered';
} catch (e) {
  levelsFrozen = true;
}
ok('LEVELS object frozen against reassignment', levelsFrozen);

let individualFrozen = false;
try {
  lib.PATTERNS.hh_hl.atlasInterpretation = 'tampered';
  individualFrozen = lib.PATTERNS.hh_hl.atlasInterpretation !== 'tampered';
} catch (e) {
  individualFrozen = true;
}
ok('individual pattern entries frozen against mutation', individualFrozen);

// -----------------------------------------------------------------
console.log('\n==========================');
console.log(`Passed: ${passed}   Failed: ${failed}`);
if (failed === 0) {
  console.log('[VISUAL-PATTERN-LIBRARY-QA] PASS — doctrine-complete 14-pattern catalogue: slug + anchorId + commonMistakes + atlasInterpretation + relatedTerms on every entry; Bullish + Bearish variants on every applicable pattern; hyperlink architecture (default + setDeepLinkBuilder override + per-call linkBuilder) verified; renderLearningLinksRow + renderDeepGlossaryEntry helpers wired; every Discord render chunk-safe; catalogue immutable.');
  process.exit(0);
} else {
  console.log('[VISUAL-PATTERN-LIBRARY-QA] FAIL — see failures above.');
  process.exit(1);
}
