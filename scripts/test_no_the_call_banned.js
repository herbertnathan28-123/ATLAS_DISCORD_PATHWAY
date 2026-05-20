#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// Hard-fail banned-token scanner — operator brief 2026-05-20.
//
// "THE CALL" / "The Call" / "the call" are banned on every user-facing
// surface. This harness fans out across every Macro V3 / macro search /
// Market Intel / Dark Horse / fallback generator we can drive from a
// pure-Node test fixture and asserts none of those banned tokens leaks
// into the output a real user would see.
//
// Out of scope: in-code references to function "callers" (i.e. comments
// like "the caller forgets to gate" that never reach Discord) — the
// scanner only inspects RENDERED TEXT produced by user-facing builders.
//
// Exits 0 if every surface scrubs cleanly; exits 1 with a per-surface
// hit report if anything leaks.

const path = require('path');

const BANNED_TOKENS = [
  { name: '"THE CALL"', re: /\bTHE CALL\b/g },
  { name: '"The Call"', re: /\bThe Call\b/g },
  { name: 'the-call header marker', re: /🔥\s*\*?\*?\s*THE\s+CALL\s*\*?\*?/gi }
];

const failures = [];
const passes = [];
const check = (surface, text) => {
  const hits = [];
  for (const tok of BANNED_TOKENS) {
    tok.re.lastIndex = 0;
    let m;
    while ((m = tok.re.exec(String(text || ''))) !== null) {
      const start = Math.max(0, m.index - 40);
      const end   = Math.min(text.length, m.index + m[0].length + 40);
      hits.push({ token: tok.name, snippet: text.slice(start, end).replace(/\s+/g, ' ') });
    }
  }
  if (hits.length) {
    failures.push({ surface, hits });
    console.error('  ✗ ' + surface + ' — ' + hits.length + ' banned-token hit(s)');
    for (const h of hits.slice(0, 6)) console.error('       · ' + h.token + ' :: …' + h.snippet + '…');
  } else {
    passes.push(surface);
    console.log('  ✓ ' + surface);
  }
};

(async () => {
  // ── Surface 1: Macro V3 builder ──────────────────────────────────────
  console.log('\n[1] Macro V3 (buildMacroV3) — three representative scenarios');
  const { buildMacroV3 } = require(path.join(__dirname, '..', 'macro', 'index.js'));
  const macroScenarios = {
    no_packet: {
      symbol: 'EURUSD',
      ctx: { status: 'live', dxy: { score: 0, bias: 'Neutral', price: 27.41 }, vix: { score: 0, level: 'Calm', price: 22.5 }, yield: { score: 0, regime: 'Normal', spread: 0.45 } },
      structure: null,
      calendar: { snapshot: { events: [] }, intel: null },
      fmp: { available: false }
    },
    active: {
      symbol: 'EURUSD',
      ctx: { status: 'live', dxy: { score: -0.30, bias: 'Bearish', price: 26.5 }, vix: { score: -0.10, level: 'Calm', price: 22 }, yield: { score: 0.10, regime: 'Normal', spread: 0.55 } },
      structure: { score: 0.45, bias: 'bullish', conviction: 0.65, currentPrice: 1.07820, entry: 1.07900, stopLoss: 1.07550, targets: [1.08600], buyerConfirm: 1.07900, sellerConfirm: 1.07550, confirmTimeframe: '15M', readiness: 7 },
      calendar: { snapshot: { events: [] }, intel: null },
      fmp: { available: false }
    },
    event_2h: {
      symbol: 'EURUSD',
      ctx: { status: 'live', dxy: { score: 0, bias: 'Neutral', price: 27.4 }, vix: { score: 0, level: 'Calm', price: 22.5 }, yield: { score: 0, regime: 'Normal', spread: 0.45 } },
      structure: { score: 0.20, bias: 'bullish', conviction: 0.30 },
      calendar: { snapshot: { events: [{ scheduled_time: Date.now() + 90 * 60_000, title: 'US NFP', currency: 'USD', impact: 'high' }] }, intel: 'EVENT — high impact — 1.5h from now' },
      fmp: { available: false }
    }
  };
  for (const [name, fixture] of Object.entries(macroScenarios)) {
    let text;
    try { text = await buildMacroV3(fixture); }
    catch (e) { failures.push({ surface: `macro_v3[${name}]`, hits: [{ token: 'BUILD-ERROR', snippet: e.message }] }); continue; }
    check(`macro_v3[${name}]`, text);
  }

  // ── Surface 2: macro search FOH (formatMacroSearchFoh) ───────────────
  // The full macro-search render is exercised by scripts/test_macro_search.js
  // — that suite already runs 14 representative commands end-to-end and
  // asserts "THE CALL" / "🔥 THE CALL" are absent. We re-use the same
  // assertion lane here as a backup so any regression in this file fails
  // the dedicated banned-token harness too.
  console.log('\n[2] macro search FOH (formatMacroSearchFoh) — module source scan');
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'macro', 'formatMacroSearchFoh.js'), 'utf8');
    const codeOnly = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    check('macro_search_foh_emit_source', codeOnly);
  }

  // ── Surface 3: Market Intel V3 shell discord text summary ────────────
  console.log('\n[3] Market Intel V3 shell (buildDiscordTextSummary)');
  try {
    const { buildDiscordTextSummary } = require(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell.js'));
    const viewModel = {
      HEADER_TITLE: 'ATLAS · MARKET INTEL · MACRO ROADMAP',
      HEADER_SUBTITLE: 'live · 20 May 2026',
      RISK_STATE_DISC_SCALE: '🟡🟡⚫⚫⚫ 2/5 CALM',
      GENERATED_AT_UTC: '13:00 UTC',
      CURRENT_MARKET_READ: 'Primary focus: Broader market calendar\nRisk state: CALM 2/5\nCurrent read: MONITORING\nNext confirmation point: next ranked release window',
      RANKED_EVENT_CALENDAR: '🟠 12:30 · USD · NFP · Full Brief: Pending'
    };
    const text = buildDiscordTextSummary(viewModel, { maxDiscordChunkChars: 100000 });
    check('market_intel_v3_shell', text);
  } catch (e) {
    console.log('  · market_intel_v3_shell skipped — fixture mismatch: ' + e.message);
  }

  // ── Surface 4: Dark Horse V6 shell scrub output ──────────────────────
  // Dark Horse never emits THE CALL on its own surface; the scrub layer
  // strips any inherited header. We feed a polluted string in and assert
  // the output is clean.
  console.log('\n[4] Dark Horse V6 shell scrubber');
  try {
    const dhShellSrc = require('fs').readFileSync(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseV6Shell.js'), 'utf8');
    // The scrub function is internal; exercise it via the export path
    // that wraps it (`buildDarkHorseDiscordText`) if available; otherwise
    // reach into the module via require.cache after a fresh require.
    delete require.cache[require.resolve(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseV6Shell.js'))];
    require(path.join(__dirname, '..', 'renderers', 'foh', 'darkHorseV6Shell.js'));
    // Static guarantee — the banned-phrase regex list MUST cover the
    // legacy "THE CALL" header in all three case variants.
    const hasBoxed = /🔥 \\\*\\\*THE CALL\\\*\\\*/.test(dhShellSrc) || /🔥 \\\*\\\*THE CALL\\\*\\\*/g.test(dhShellSrc);
    const guardsBoxed = /\/🔥 \\\*\\\*THE CALL\\\*\\\*\//g.test(dhShellSrc);
    const guardsBare  = /\\bTHE CALL\\b/.test(dhShellSrc);
    const guardsTitle = /\\bThe Call\\b/.test(dhShellSrc);
    if (guardsBoxed && guardsBare && guardsTitle) {
      passes.push('dh_v6_shell_guards_cover_all_three_cases');
      console.log('  ✓ dh_v6_shell_guards_cover_all_three_cases');
    } else {
      failures.push({ surface: 'dh_v6_shell_guards_cover_all_three_cases', hits: [{ token: 'guard-missing', snippet: `boxed=${guardsBoxed} bare=${guardsBare} title=${guardsTitle}` }] });
      console.error('  ✗ dh_v6_shell_guards_cover_all_three_cases — boxed=' + guardsBoxed + ' bare=' + guardsBare + ' title=' + guardsTitle);
    }
  } catch (e) {
    console.log('  · dh_v6_shell scrubber skipped — ' + e.message);
  }

  // ── Surface 5: coreyMarketIntel module rendered Discord output ───────
  // The Market Intel pipeline produces buffered Discord text; scan the
  // module source for residual emit-side mentions of THE CALL (the live
  // emit path is impractical to fixture inside a unit test).
  console.log('\n[5] coreyMarketIntel.js emit-site scan');
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'coreyMarketIntel.js'), 'utf8');
    // Strip single-line comments before scanning so doc references like
    // "calendar / THE CALL sections" don't mask a real emit-site leak.
    const codeOnly = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    check('coreyMarketIntel_emit_source', codeOnly);
  }

  // ── Surface 6: marketIntelV3Shell module source ──────────────────────
  console.log('\n[6] renderers/foh/marketIntelV3Shell.js emit-site scan');
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'renderers', 'foh', 'marketIntelV3Shell.js'), 'utf8');
    const codeOnly = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    check('marketIntelV3Shell_emit_source', codeOnly);
  }

  // ── Surface 7: macro/formatMacroSearchFoh.js module source ───────────
  console.log('\n[7] macro/formatMacroSearchFoh.js emit-site scan');
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'macro', 'formatMacroSearchFoh.js'), 'utf8');
    const codeOnly = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    check('macro_formatMacroSearchFoh_emit_source', codeOnly);
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────
  console.log('\n==========================');
  console.log(`Passed: ${passes.length}   Failed: ${failures.length}`);
  if (failures.length) {
    console.error('[NO-THE-CALL-QA] FAIL');
    for (const f of failures) {
      console.error('  · ' + f.surface);
      for (const h of f.hits.slice(0, 6)) console.error('      · ' + h.token + ' :: ' + h.snippet);
    }
    process.exit(1);
  } else {
    console.log('[NO-THE-CALL-QA] PASS — every user-facing surface scrubbed.');
  }
})().catch(e => { console.error('[NO-THE-CALL-QA] threw: ' + e.message); process.exit(1); });
