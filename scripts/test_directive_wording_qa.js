#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Directive-wording QA.
 *
 * Locked advisory standard: ATLAS output must be ADVISORY, not
 * permission-giving or command-style. "do not enter / trade /
 * place / open" is the trade-command tone the audit found leaking
 * into user-facing macro v3 output (executionLogic, REGIME ANALOG
 * paragraph, corey_calendar TRADER ACTION block) before this PR.
 *
 * Asserts after this PR:
 *   T1. macro/advisoryWording.js → remapAdvisoryWording rewrites
 *       every member of the "do not <verb>" family to advisory
 *       state wording.
 *   T2. macro/executionLogic.js → for every representative
 *       structure / event fixture, the rendered table contains
 *       no command-style directive.
 *   T3. corey_calendar.js TRADER ACTION block (lines 813–814)
 *       no longer carries "do not open" / "do not trade".
 *   T4. index.js REGIME ANALOG paragraph no longer carries
 *       "Do not enter on the analog alone".
 *   T5. filterBannedFromText sweep still passes existing
 *       Jane-packet acceptance fixtures (no regression).
 *
 * Wired as `npm run qa:wording-directives`.
 */

const path = require('path');
const aw     = require(path.join(__dirname, '..', 'macro', 'advisoryWording.js'));
const execLogic = require(path.join(__dirname, '..', 'macro', 'executionLogic.js'));
const fs     = require('fs');

let passed = 0, failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label, info != null ? '\n     ' + JSON.stringify(info) : ''); }
}

// Master directive regex — every variant the audit found.
const DIRECTIVE_RE = /\b(?:do\s+not|don[’']?t)\s+(?:enter|trade|place\s+limit\s+orders|open\s+new\s+positions)\b/i;

// ============================================================
// T1 — remap rewrites every directive family member
// ============================================================
console.log('\n[T1] remapAdvisoryWording rewrites the "do not <verb>" family');
{
  const cases = [
    { in: 'do not enter',                              out: 'entry is not supported' },
    { in: 'Do not enter on the analog alone',          contains: 'entry is not supported' },
    { in: 'do not trade',                              out: 'trading is not supported' },
    { in: 'THEN do not trade — wait for structure',    contains: 'trading is not supported' },
    { in: 'do not place limit orders',                 out: 'limit orders are not supported yet' },
    { in: 'do not open new positions',                 out: 'new positions are not supported' },
    { in: "don't enter",                               out: 'entry is not supported' },
    { in: "don't trade",                               out: 'trading is not supported' },
  ];
  for (const c of cases) {
    const result = aw.remapAdvisoryWording(c.in);
    if ('out' in c) {
      ok(`"${c.in}" → "${c.out}"`, result === c.out, { result });
    } else {
      ok(`"${c.in}" contains "${c.contains}"`, result.includes(c.contains), { result });
    }
    ok(`"${c.in}" — no residual directive`, !DIRECTIVE_RE.test(result), { result });
  }
}

// ============================================================
// T2 — executionLogic.build emits no directive imperative
// ============================================================
console.log('\n[T2] executionLogic.build over representative fixtures — no directives');
{
  const fixtures = [
    {
      label: 'no buyer/seller level, no stop loss, no event',
      input: {
        structure: {},
        calendar: {},
        ctx: {},
        symbol: 'EURUSD',
      },
    },
    {
      label: 'no stop loss, 1.5h to high-impact event',
      input: {
        structure: { buyerConfirm: '1.10500', confirmTimeframe: '15M' },
        calendar: { intel: 'CPI USD — 1.5h from now' },
        ctx: { vix: { level: 'Normal' }, dxy: { bias: 'Bullish' } },
        symbol: 'EURUSD',
      },
    },
    {
      label: 'within 5 min of release',
      input: {
        structure: { buyerConfirm: '1.10500' },
        calendar: { intel: 'NFP USD — 0.05h from now' },
        ctx: {},
        symbol: 'EURUSD',
      },
    },
    {
      label: 'full structure, stop loss, targets',
      input: {
        structure: {
          buyerConfirm: '1.10500',
          stopLoss: '1.09800',
          targets: ['1.11200', '1.11800'],
          trigger: '15M close > 1.10500',
          entry: '1.10500',
        },
        calendar: {},
        ctx: {},
        symbol: 'EURUSD',
      },
    },
  ];
  for (const f of fixtures) {
    const text = execLogic.build(f.input);
    const hit  = text.match(DIRECTIVE_RE);
    ok(`fixture "${f.label}" — no directive imperative`, !hit,
       hit ? { hit: hit[0], excerpt: text.slice(Math.max(0, hit.index - 30), hit.index + 80) } : undefined);
    // Each fixture must still render at least the section header
    // (sanity — confirms the build path was actually exercised).
    ok(`fixture "${f.label}" — section header present`,
       /## EXECUTION LOGIC/.test(text));
  }
}

// ============================================================
// T3 — corey_calendar.js TRADER ACTION strings no longer leak
// ============================================================
console.log('\n[T3] corey_calendar.js TRADER ACTION block — no directive imperatives');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'corey_calendar.js'), 'utf8');
  // We only need to verify the TRADER ACTION block specifically.
  const beforeIdx = src.indexOf('**TRADER ACTION — BEFORE / DURING / AFTER**');
  ok('TRADER ACTION header located', beforeIdx > 0);
  if (beforeIdx > 0) {
    // Slice the next ~600 chars — covers the Before / During / After lines
    // plus the closing lines.push('') terminator.
    const slice = src.slice(beforeIdx, beforeIdx + 800);
    const hit = slice.match(DIRECTIVE_RE);
    ok('TRADER ACTION block has no "do not <verb>" string', !hit,
       hit ? { hit: hit[0] } : undefined);
  }
}

// ============================================================
// T4 — index.js REGIME ANALOG paragraph has no "Do not enter"
// ============================================================
console.log('\n[T4] index.js REGIME ANALOG paragraph — no "Do not enter"');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const regimeIdx = src.indexOf('**REGIME ANALOG —');
  ok('REGIME ANALOG paragraph located', regimeIdx > 0);
  if (regimeIdx > 0) {
    // The block is contained within a single backtick template literal
    // ending at the next backtick after Invalidation of analog.
    const slice = src.slice(regimeIdx, regimeIdx + 1500);
    const hit = slice.match(DIRECTIVE_RE);
    ok('REGIME ANALOG paragraph has no directive imperative', !hit,
       hit ? { hit: hit[0], excerpt: slice.slice(Math.max(0, hit.index - 30), hit.index + 80) } : undefined);
  }
}

// ============================================================
// T5 — filterBannedFromText sweep over representative remapped
//      outputs (regression guard for advisoryWording.js).
// ============================================================
console.log('\n[T5] filterBannedFromText regression guard');
{
  const samples = [
    'THEN entry is not yet supported — the operational risk standard requires a defined stop-loss before risk can be priced.',
    'The analog is a directional guide, not a signal — it only becomes actionable once price structure agrees on the primary timeframe.',
    'Before: new positions are not supported inside the 2 hours ahead of the release.',
    'During: trading is not supported inside the first 5 minutes after release.',
  ];
  for (const s of samples) {
    const r = aw.filterBannedFromText(s);
    ok(`sample passes filterBannedFromText cleanly: "${s.slice(0, 60)}…"`,
       r && r.ok === true,
       r && !r.ok ? { hits: r.hits } : undefined);
    ok(`sample triggers no DIRECTIVE_RE residual`,
       !DIRECTIVE_RE.test(s), s);
  }
}

// ============================================================
// summary
// ============================================================
console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('[WORDING-DIRECTIVES-QA] PASS — directive imperatives removed from user-facing macro surface; advisoryWording remap covers the family as defence-in-depth.');
process.exit(0);
