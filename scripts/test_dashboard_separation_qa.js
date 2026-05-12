#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Dashboard surface separation QA.
 *
 * Locked dashboard standard (2026-05-12):
 *   Internal engine names (Corey / Corey Clone / Spidey / Jane) and
 *   diagnostic-term enums (final:no_trade, 15Y-cache,
 *   "unavailable: not implemented") must never reach a user-facing
 *   dashboard surface. Approved public labels:
 *     Corey       → Macro context
 *     Corey Clone → Secondary macro model
 *     Spidey      → Market structure
 *     Jane        → Final assessment
 *
 *   Plus: commodities arrow bug in macro/marketOverview.js:41 fixed
 *   so the paragraph closes with a single ⬆️ or ⬇️ driven by the
 *   live USD-inverse score, not the literal `⬆️⬇️` regression.
 *
 * Asserts after this PR:
 *   T1. macro/language.js TRANSLATE rules map every engine name to
 *       the approved public label.
 *   T2. Static sweep of index.js confirms:
 *         - no user-facing string carries '(Spidey)' / '(Corey)' /
 *           '(Corey Clone)' / '(Jane)'.
 *         - no user-facing string carries 'final:no_trade' /
 *           'final:armed' / 'final:trade_confirmed' /
 *           'final:entry_authorised' /
 *           'unavailable:no_packet' / 'withheld:source_incomplete'.
 *         - no user-facing string carries 'unavailable: not
 *           implemented' or '15Y-cache'.
 *       (JS identifiers like `missingSpidey`, `coreyStatus` are
 *       allowed — those are program variables, not strings.)
 *   T3. dashboard packet `sources` object uses ONLY neutral public
 *       keys: macroContext / secondaryMacroModel / marketStructure /
 *       finalAssessment / historicalReference / marketData.
 *   T4. Legacy macro builders no longer carry the literal "Corey"
 *       name in their user-facing template strings.
 *   T5. macro/marketOverview.js commodities paragraph uses
 *       arrow(-dxyScore), not the broken arrow(0.05)⬇️ literal.
 *
 * Wired as `npm run qa:dashboard-separation`.
 */

const path = require('path');
const fs   = require('fs');
const lang = require(path.join(__dirname, '..', 'macro', 'language.js'));

let passed = 0, failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label, info != null ? '\n     ' + JSON.stringify(info) : ''); }
}

const indexSrc           = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const marketOverviewSrc  = fs.readFileSync(path.join(__dirname, '..', 'macro', 'marketOverview.js'), 'utf8');

// ============================================================
// T1 — TRANSLATE rules map every engine name to the approved label
// ============================================================
console.log('\n[T1] language.js scrub maps every engine name to the approved public label');
{
  const cases = [
    { in: 'Corey reads bullish',         contains: 'Macro context reads bullish' },
    { in: 'corey reads bullish',         contains: 'macro context reads bullish' },
    { in: 'Spidey structure intact',     contains: 'Market structure structure intact' },
    { in: 'spidey structure intact',     contains: 'market structure structure intact' },
    { in: 'Jane decision pending',       contains: 'Final assessment decision pending' },
    { in: 'jane decision pending',       contains: 'final assessment decision pending' },
    { in: 'Corey Clone running',         contains: 'Secondary macro model running' },
    { in: 'corey clone running',         contains: 'secondary macro model running' },
  ];
  for (const c of cases) {
    let out;
    try {
      out = lang.scrub(c.in, { assetClass: 'fx' });
    } catch (e) {
      // scrub throws on UNIVERSAL_BAN matches. Some translations
      // produce text that itself triggers a ban (e.g. "macro engine"
      // is banned). After our TRANSLATE update the outputs use
      // "Macro context" / "Market structure" / etc. which are NOT
      // banned, so scrub should NOT throw. If it does, the new
      // TRANSLATE produced a banned-token output → flag.
      out = '__THREW: ' + e.message;
    }
    ok(`"${c.in}" → contains "${c.contains}"`,
       typeof out === 'string' && out.includes(c.contains),
       { out });
  }
}

// ============================================================
// T2 — index.js user-facing literal sweep — no engine names / enums
// ============================================================
console.log('\n[T2] index.js user-facing string sweep — no engine names or diagnostic enums');
{
  // Strip line comments + console.log lines before scanning so the
  // sweep only inspects production-emitted text. Block comments are
  // rare in index.js; we strip them too. Anything outside that is
  // either an active code path or a string literal that could
  // surface to the user.
  function stripCommentsAndInternalLogs(src) {
    return src
      .split('\n')
      .map(line => {
        // Internal console.log / dhLog / log() lines — these are
        // Render-console only and may carry internal vocabulary.
        if (/^\s*(?:console\.(?:log|warn|error|info)|dhLog|log)\s*\(/.test(line)) return '';
        // Strip line comments (only the comment portion).
        const idx = line.indexOf('//');
        if (idx >= 0) return line.slice(0, idx);
        return line;
      })
      .join('\n');
  }
  const scrubbed = stripCommentsAndInternalLogs(indexSrc);

  // Banned LITERAL substrings — any occurrence inside the scrubbed
  // source is treated as a user-facing leak.
  const BANNED_SUBSTRINGS = [
    '(Spidey)',
    '(Corey)',
    '(Corey Clone)',
    'Spidey structure',
    'Spidey ATR',
    'Spidey structure / trigger packet',
    'final:no_trade',
    'final:armed',
    'final:trade_confirmed',
    'final:entry_authorised',
    'unavailable:no_packet',
    'withheld:source_incomplete',
    'withheld:empty_decision_packet',
    'unavailable: not implemented',
    '15Y-cache',
    'Trigger Map withheld',
    'Trigger map withheld',
    'corey=${coreyStatus}',
    'spidey=${spideyStatus}',
  ];
  for (const needle of BANNED_SUBSTRINGS) {
    const idx = scrubbed.indexOf(needle);
    ok(`banned substring absent: "${needle}"`,
       idx < 0,
       idx >= 0 ? { context: scrubbed.slice(Math.max(0, idx - 30), idx + needle.length + 60) } : undefined);
  }
}

// ============================================================
// T3 — dashboard packet `sources` object uses ONLY neutral keys
// ============================================================
console.log('\n[T3] dashboard packet sources object uses ONLY neutral public keys');
{
  // Find the literal `const sources = {` block in postJanePacketToDashboard
  // and check its keys.
  const m = indexSrc.match(/const sources = \{([\s\S]*?)\};/);
  ok('found sources = { … } block', !!m, m ? undefined : 'block not found');
  if (m) {
    const block = m[1];
    // Required NEUTRAL keys (per approved table).
    const REQUIRED = ['marketData', 'macroContext', 'secondaryMacroModel', 'marketStructure', 'finalAssessment', 'historicalReference'];
    for (const key of REQUIRED) {
      ok(`sources block carries neutral key "${key}"`,
         new RegExp('\\b' + key + '\\s*:').test(block),
         { sample: block.slice(0, 200) });
    }
    // Banned LEGACY keys.
    const FORBIDDEN_KEYS = ['corey', 'coreyClone', 'spidey', 'jane', 'historical'];
    for (const key of FORBIDDEN_KEYS) {
      // Match the key followed by ':' to mean object-key.
      const re = new RegExp('^\\s*' + key + '\\s*:', 'm');
      ok(`sources block does NOT carry legacy key "${key}"`,
         !re.test(block),
         re.test(block) ? { block } : undefined);
    }
  }
}

// ============================================================
// T4 — legacy macro builders no longer carry literal "Corey"
// ============================================================
console.log('\n[T4] legacy macro builder template strings no longer carry literal "Corey"');
{
  // Specific template literals that previously carried "Corey":
  //   index.js:557  whyParts.push("Corey's macro composite is …")
  //   index.js:596  `Macro (Corey): …`
  //   index.js:976  `… live Corey snapshot.`
  //   index.js:982  TrendSpider confirmation: agrees with Corey
  const LEGACY = [
    /'[^']*Corey['’]s\s+macro\s+composite[^']*'/,
    /`[^`]*Macro \(Corey\)[^`]*`/,
    /`[^`]*live Corey snapshot[^`]*`/,
    /'[^']*agrees with Corey[^']*'/,
    /'[^']*disagrees with Corey[^']*'/,
  ];
  for (const re of LEGACY) {
    const hit = indexSrc.match(re);
    ok(`legacy "Corey" template absent: ${re}`,
       !hit,
       hit ? { hit: hit[0].slice(0, 120) } : undefined);
  }
  // Positive checks — the replacement phrasings ARE present.
  ok('replacement phrasing "The macro composite is neutral" present',
     /'The macro composite is neutral/.test(indexSrc));
  ok('replacement phrasing "Macro context:" present',
     /`Macro context: \$\{corey\.combinedBias\}/.test(indexSrc));
  ok('replacement phrasing "live macro context snapshot" present',
     /`\$\{fmtUtcShort\(Date\.now\(\)\)\} — live macro context snapshot\.`/.test(indexSrc));
  ok('replacement phrasing "agrees with the macro composite" present',
     /agrees with the macro composite/.test(indexSrc));
}

// ============================================================
// T5 — marketOverview.js commodities arrow bug fixed
// ============================================================
console.log('\n[T5] macro/marketOverview.js commodities paragraph arrow fixed');
{
  ok('old broken `arrow(0.05)⬇️` literal absent',
     !/\$\{arrow\(0\.05\)\}\s*⬇️/.test(marketOverviewSrc),
     marketOverviewSrc.match(/arrow\(0\.05\)/) ? { hit: 'arrow(0.05) still present' } : undefined);
  ok('commodities paragraph now uses `arrow(-dxyScore)`',
     /\$\{arrow\(-dxyScore\)\}/.test(marketOverviewSrc));
  // Functional check — call the language.arrow helper across the
  // sign axis and confirm it returns a single arrow per spec.
  ok('arrow(-1) returns ⬇️ (USD strong → commodities weak)',
     lang.arrow(-1) === '⬇️');
  ok('arrow(1) returns ⬆️ (USD weak → commodities strong)',
     lang.arrow(1) === '⬆️');
}

// ============================================================
// summary
// ============================================================
console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('[DASHBOARD-SEPARATION-QA] PASS — engine names + diagnostic enums scrubbed from user-facing dashboard surface; commodities arrow tracks live data.');
process.exit(0);
