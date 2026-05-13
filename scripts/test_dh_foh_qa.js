#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_dh_foh_qa.js
//
// QA harness for the Dark Horse Front-of-House (FOH.1.0.1)
// presentation contract. Pure unit test — no network, no engine
// scheduler, no Discord. Each scenario builds a synthetic
// ranking record, calls the FOH builder, and asserts the
// resulting payload conforms to:
//
//   Pack 2 — one embed per promoted candidate, allow-list state
//            badges, NEW separator, trader-facing wording,
//            allow-list move type / direction / timeframe
//   Pack 4 — section-level Expanded Terminology Hyperlinks
//   Pack 5 — TRC- registry rows are drafted in docs/training-capture/
//            (this harness verifies the file exists; row content
//            review is operator-side)
//   Pack 8 — banned-wording sweep, colour-active-count format,
//            colour-coded text matching, embed total ≤ 6000,
//            content total ≤ 2000
//
// Wired as `npm run qa:dh-foh`.
// ============================================================

const path = require('path');
const fs   = require('fs');
const rank = require(path.join(__dirname, '..', 'darkHorseRanking.js'));
const foh  = require(path.join(__dirname, '..', 'darkHorseFoh.js'));

let passed = 0, failed = 0;
function ok(label, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label, info != null ? '\n     ' + JSON.stringify(info) : ''); }
}

// ── FIXTURES ────────────────────────────────────────────────
function dailyCandles(n, basePrice) {
  const out = [];
  const startTs = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
  let p = basePrice;
  for (let i = 0; i < n; i++) {
    const open  = p;
    const close = p + 0.8;
    const high  = close + 0.6;
    const low   = open - 0.5;
    out.push({ open, high, low, close, time: startTs + i * 86400 });
    p = close;
  }
  return out;
}
function mkCandidate(over) {
  return Object.assign({
    symbol: 'EURUSD', score: 8, direction: 'Bullish',
    summary: 'higher highs and higher lows forming on 1D',
    reasons: ['structure 2/2', 'momentum 1/2'],
  }, over);
}
function mkRanked(symbol, score, direction, sectionKey, basePrice) {
  const enriched = rank.enrichCandidate(
    mkCandidate({ symbol, score, direction }),
    dailyCandles(25, basePrice),
    6, { watchThreshold: 8 }
  );
  enriched.section = sectionKey;
  enriched.sectionLabel = rank.SECTION_LABEL[sectionKey];
  return enriched;
}

// ============================================================
// T1 — Payload kind + empty top10
// ============================================================
console.log('\n[T1] Payload kind, empty top10 → no messages');
{
  const out = foh.buildDarkHorseFohPayload({ top10: [] }, { level: 'quiet' }, { now: Date.parse('2026-05-13T12:00:00Z') });
  ok('kind = movement_digest_foh_v1_0', out.kind === 'movement_digest_foh_v1_0');
  ok('messages array is empty', Array.isArray(out.messages) && out.messages.length === 0);
  ok('candidateCount = 0', out.candidateCount === 0);
  ok('embedCount = 0', out.embedCount === 0);
}

// ============================================================
// T2 — One promoted candidate → one banner-bearing message
// ============================================================
console.log('\n[T2] Single promoted candidate → 1 message, banner + embed');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.1)];
  const out = foh.buildDarkHorseFohPayload({ top10 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  ok('messages.length = 1', out.messages.length === 1, { len: out.messages.length });
  ok('candidateCount = 1', out.candidateCount === 1);
  ok('embedCount = 1', out.embedCount === 1);
  const m = out.messages[0];
  ok('message has content', typeof m.content === 'string' && m.content.length > 0);
  ok('message has 1 embed', Array.isArray(m.embeds) && m.embeds.length === 1);
  ok('banner carries the 🐎 marker',
     /🐎 DARK HORSE — GLOBAL MOVER RADAR/.test(m.content));
  ok('banner carries scan-date stamp',
     /2026-05-13/.test(m.content));
  ok('banner carries Pack 4 terminology row',
     /\[Breakout\]/.test(m.content) && /\[Retest\]/.test(m.content)
     && /\[Continuation\]/.test(m.content) && /\[Mover Stage 1\]/.test(m.content));
  ok('banner ends with NEW separator',
     /─── NEW ───/.test(m.content));
}

// ============================================================
// T3 — Multi-candidate payload → N messages, NEW between
// ============================================================
console.log('\n[T3] Four promoted candidates → 4 messages, NEW separator on every message');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,    1.10),
    mkRanked('NDX',    8, 'Bullish', rank.SECTIONS.INDICES,      19000),
    mkRanked('NVDA',   8, 'Bullish', rank.SECTIONS.EQUITIES,     900),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES,  2400),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  ok('messages.length = 4', out.messages.length === 4, { len: out.messages.length });
  ok('candidateCount = 4', out.candidateCount === 4);
  ok('embedCount = 4', out.embedCount === 4);
  // First message has the full banner; subsequent messages don't.
  ok('only message 1 carries the banner',
     /🐎 DARK HORSE — GLOBAL MOVER RADAR/.test(out.messages[0].content)
     && !/🐎 DARK HORSE — GLOBAL MOVER RADAR/.test(out.messages[1].content)
     && !/🐎 DARK HORSE — GLOBAL MOVER RADAR/.test(out.messages[2].content)
     && !/🐎 DARK HORSE — GLOBAL MOVER RADAR/.test(out.messages[3].content));
  ok('every message carries the NEW separator',
     out.messages.every(m => /─── NEW ───/.test(m.content)));
  // Each message has exactly one embed (Pack 2 "one embed per
  // promoted candidate").
  ok('every message has exactly 1 embed',
     out.messages.every(m => Array.isArray(m.embeds) && m.embeds.length === 1));
  // Footer of the LAST embed carries "next review" (Pack 1.7
  // spirit — information not actionable yet lives in footer).
  const lastEmbed = out.messages[3].embeds[0];
  ok('last embed footer carries next-review stamp',
     /next review \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(lastEmbed.footer.text),
     lastEmbed.footer);
}

// ============================================================
// T4 — Embed structure conforms to Pack 2.2
// ============================================================
console.log('\n[T4] Embed structure — Pack 2.2 fields + state-badge allow-list');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10)];
  const out = foh.buildDarkHorseFohPayload({ top10 }, null, { now: Date.parse('2026-05-13T12:00:00Z') });
  const e = out.messages[0].embeds[0];
  ok('embed.color is a finite decimal', Number.isFinite(e.color));
  ok('embed.title starts with 🐎 + symbol',
     /^🐎 EURUSD · /.test(e.title), { title: e.title });
  ok('embed.title ends with a state-badge from the allow-list',
     foh.STATE_BADGE_VALUES.has(e.title.replace(/^🐎 [A-Z0-9]+ · /, '')),
     { title: e.title });
  ok('embed.description is a non-empty trader-voice line',
     typeof e.description === 'string' && e.description.length > 0
     && e.description.length <= 200);
  // Pack 2.2 required fields
  const fieldNames = e.fields.map(f => f.name);
  ok('field Move Type present', fieldNames.includes('Move Type'));
  ok('field Direction present', fieldNames.includes('Direction'));
  ok('field Conviction present', fieldNames.includes('Conviction'));
  ok('field Timeframe present', fieldNames.includes('Timeframe'));
  // The terminology row (Pack 4) sits as a field with name "Terms"
  ok('field Terms (Pack 4 hyperlink row) present', fieldNames.includes('Terms'));
}

// ============================================================
// T5 — Colour-active-count conviction format (Pack §0.2)
// ============================================================
console.log('\n[T5] Conviction value uses colour-active-count, no filler dots');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10)];
  const out = foh.buildDarkHorseFohPayload({ top10 }, null, {});
  const conv = out.messages[0].embeds[0].fields.find(f => f.name === 'Conviction').value;
  // Emoji in JS regex character classes split across surrogate pairs;
  // use a structural check instead — starts with a colour glyph, has
  // the " / 5 · " separator, ends with a confidence label.
  ok('conviction value uses colour glyph + "/ 5" suffix',
     /^(🟢|🔴|🟡|🟠|⚪)/.test(conv)
     && / \/ 5 · /.test(conv)
     && /(Low|Medium|High|Very High)$/.test(conv),
     { conv });
  ok('no empty-circle ○ filler', !/○/.test(conv));
  ok('no inactive ● filler with grey', !/●○/.test(conv));
  // Direct unit tests of the scale function for each band.
  ok('score 10 → 5/5 Very High',
     /^🟢🟢🟢🟢🟢 \/ 5 · Very High$/.test(foh.convictionScale(10, foh.STATE_BADGE.STRONG_BULLISH)));
  ok('score 8 → 4/5 High',
     /^🟢🟢🟢🟢 \/ 5 · High$/.test(foh.convictionScale(8, foh.STATE_BADGE.STRONG_BULLISH)));
  ok('score 6 + bearish → 3/5 🔴 Medium',
     /^🔴🔴🔴 \/ 5 · Medium$/.test(foh.convictionScale(6, foh.STATE_BADGE.BEARISH_PRESSURE)));
  ok('score 4 + marginal → 2/5 🟠 Low',
     /^🟠🟠 \/ 5 · Low$/.test(foh.convictionScale(4, foh.STATE_BADGE.MARGINAL_REDUCED_CONVICTION)));
}

// ============================================================
// T6 — State-badge classification (allow-list discipline)
// ============================================================
console.log('\n[T6] State-badge classifier — only allow-list values returned');
{
  function mk(score, dir, phase) {
    return {
      score, direction: dir, movePhase: phase,
      evidenceAnchors: { availability: 'partial', invalidation: { priceText: '1.0' } },
    };
  }
  const cases = [
    ['score 9 + Bullish + early', mk(9, 'Bullish', 'early'), foh.STATE_BADGE.STRONG_BULLISH],
    ['score 9 + Bearish + mid',   mk(9, 'Bearish', 'mid'),   foh.STATE_BADGE.STRONG_BEARISH],
    ['score 9 + Bullish + late',  mk(9, 'Bullish', 'late'),  foh.STATE_BADGE.DEVELOPING_WATCH],
    ['score 7 + Bullish + mid',   mk(7, 'Bullish', 'mid'),   foh.STATE_BADGE.BULLISH_PRESSURE],
    ['score 6 + Bearish + early', mk(6, 'Bearish', 'early'), foh.STATE_BADGE.BEARISH_PRESSURE],
    ['score 8 + Bullish + exhaust', mk(8, 'Bullish', 'exhaustion'), foh.STATE_BADGE.DEVELOPING_WATCH],
    ['score 4 + Bullish + exhaust', mk(4, 'Bullish', 'exhaustion'), foh.STATE_BADGE.MARGINAL_REDUCED_CONVICTION],
  ];
  for (const [label, rec, want] of cases) {
    const got = foh.classifyStateBadge(rec);
    ok(`${label} → "${want}"`, got === want, { got, want });
  }
  // Every classifier output must be from the allow-list.
  for (const [, rec] of cases) {
    ok('classification is in the allow-list',
       foh.STATE_BADGE_VALUES.has(foh.classifyStateBadge(rec)));
  }
}

// ============================================================
// T7 — Banned-wording sweep (Pack 2.6 + Pack 8.4)
// ============================================================
console.log('\n[T7] Banned-wording sweep — every Pack 2.6 + Pack 8.4 phrase absent');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,   1.10),
    mkRanked('NDX',    8, 'Bullish', rank.SECTIONS.INDICES,     19000),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES, 2400),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10 }, { level: 'elevated' }, {});
  const hits = foh.sweepBannedWording(out.messages);
  ok('banned-wording sweep returns zero hits', hits.length === 0,
     hits.length ? { hits: hits.slice(0, 5) } : undefined);
  // Spot-check each banned token individually.
  const flat = out.messages.map(m => {
    const blob = [m.content || ''];
    for (const e of m.embeds || []) {
      blob.push(e.title || '', e.description || '');
      for (const f of e.fields || []) blob.push(f.value || '');
      if (e.footer && e.footer.text) blob.push(e.footer.text);
    }
    return blob.join('\n');
  }).join('\n');
  const BANNED_TERMS = [
    '\\bBOS\\b', '\\bCHoCH\\b',
    '\\bpending\\s+confirmation\\b', '\\bconfirmation\\s+pending\\b',
    '\\bunavailable\\b', '\\bnot\\s+online\\b', '\\bN/A\\b',
    '\\bcache\\b', '\\bharvester\\b', '\\bmanifest\\b',
    '\\bTwelveData\\b', '\\bprovider\\b',
  ];
  for (const t of BANNED_TERMS) {
    ok(`token /${t}/ absent`, !(new RegExp(t, 'i')).test(flat));
  }
}

// ============================================================
// T8 — Discord size guards
// ============================================================
console.log('\n[T8] Discord size guards — content ≤ 2000, embed total ≤ 6000');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,   1.10),
    mkRanked('GBPUSD', 8, 'Bullish', rank.SECTIONS.FX_MAJORS,   1.25),
    mkRanked('NDX',    8, 'Bullish', rank.SECTIONS.INDICES,     19000),
    mkRanked('NVDA',   8, 'Bullish', rank.SECTIONS.EQUITIES,    900),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES, 2400),
    mkRanked('AMD',    7, 'Bullish', rank.SECTIONS.EQUITIES,    180),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10 }, { level: 'elevated' }, {});
  for (let i = 0; i < out.messages.length; i++) {
    const meas = foh.measureMessage(out.messages[i]);
    ok(`message ${i + 1} content ≤ ${foh.DISCORD_CONTENT_LIMIT}`,
       meas.contentLen <= foh.DISCORD_CONTENT_LIMIT,
       { contentLen: meas.contentLen });
    for (let j = 0; j < meas.embedTotals.length; j++) {
      ok(`message ${i + 1} embed ${j + 1} total ≤ ${foh.DISCORD_EMBED_TOTAL_LIMIT}`,
         meas.embedTotals[j] <= foh.DISCORD_EMBED_TOTAL_LIMIT,
         { embedTotal: meas.embedTotals[j] });
    }
  }
}

// ============================================================
// T9 — Filter discipline — candidates without anchor data drop
// ============================================================
console.log('\n[T9] Filter discipline — candidates without anchor data are filtered out');
{
  // One candidate with anchors, one without (null candles → pending availability).
  const withAnchors = mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10);
  const withoutAnchors = rank.enrichCandidate(
    mkCandidate({ symbol: 'GBPUSD', score: 8 }), null, 6, { watchThreshold: 8 }
  );
  withoutAnchors.section = rank.SECTIONS.FX_MAJORS;
  withoutAnchors.sectionLabel = rank.SECTION_LABEL[rank.SECTIONS.FX_MAJORS];
  const out = foh.buildDarkHorseFohPayload({ top10: [withAnchors, withoutAnchors] }, null, {});
  ok('candidateCount = 1 (anchor-less candidate filtered)', out.candidateCount === 1);
  ok('filteredOut = 1', out.filteredOut === 1);
  ok('only EURUSD promoted (the anchored one)',
     out.messages.length === 1
     && /EURUSD/.test(out.messages[0].embeds[0].title));
}

// ============================================================
// T10 — Colour-coded text matching (Pack §0.4)
// ============================================================
console.log('\n[T10] Colour-coded text matching — Where to Act uses 🟢 ENTRY / 🛑 STOP');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10)];
  const out = foh.buildDarkHorseFohPayload({ top10 }, null, {});
  const wta = out.messages[0].embeds[0].fields.find(f => f.name === 'Where to Act');
  ok('Where to Act field present', wta != null);
  ok('Where to Act uses 🟢 ENTRY POINT', /🟢 ENTRY POINT: /.test(wta.value), wta);
  ok('Where to Act uses 🛑 STOP LOSS',   /🛑 STOP LOSS: /.test(wta.value), wta);
  ok('Where to Act value uses uppercase labels',
     /ENTRY POINT/.test(wta.value) && /STOP LOSS/.test(wta.value));
}

// ============================================================
// T11 — Direction + Move Type + Stage allow-lists
// ============================================================
console.log('\n[T11] Direction + Move Type + Stage allow-list discipline');
{
  const ALLOWED_DIRECTION = new Set(['▲ Long', '▼ Short', '▶ Sideways']);
  const ALLOWED_MOVE_TYPE = new Set(['Breakout', 'Reversal', 'Range Break', 'Continuation']);
  const ALLOWED_STAGE = new Set([1, 2, 3]);
  for (const dir of ['Bullish', 'Bearish']) {
    for (const phase of ['early', 'mid', 'late', 'exhaustion']) {
      const r = {
        direction: dir, movePhase: phase, score: 8,
        structureState: 'higher highs and higher lows', section: rank.SECTIONS.FX_MAJORS,
      };
      ok(`direction(${dir}/${phase}) in allow-list`,
         ALLOWED_DIRECTION.has(foh.directionField(dir)));
      ok(`moveType(${dir}/${phase}) in allow-list`,
         ALLOWED_MOVE_TYPE.has(foh.moveType(r)));
      ok(`moverStage(${dir}/${phase}) in allow-list`,
         ALLOWED_STAGE.has(foh.moverStage(r)));
    }
  }
}

// ============================================================
// T12 — Banner format (FOH date · N candidates · scan)
// ============================================================
console.log('\n[T12] Banner format');
{
  const b = foh.buildBanner(3, Date.parse('2026-05-13T12:00:00Z'));
  ok('banner has top rule line', /^═══════════════════════════════════════════/.test(b));
  ok('banner has bottom rule line', /═══════════════════════════════════════════/.test(b.split('\n')[3]));
  ok('banner reads "3 candidates promoted"', /3 candidates promoted/.test(b));
  ok('banner reads singular form for n=1',
     /1 candidate promoted/.test(foh.buildBanner(1, Date.parse('2026-05-13T12:00:00Z'))));
  ok('banner carries scan timestamp UTC',
     /scan: 2026-05-13 12:00 UTC/.test(b));
}

// ============================================================
// T13 — Sanitiser walker preserves message shape
// ============================================================
console.log('\n[T13] Sanitiser walker — applies sanitize() to every string field');
{
  const fake = {
    sanitize: ({ content }) => ({ content: String(content).replace(/Corey/g, '[REDACTED-FOMO]'), replaced: /Corey/.test(content) }),
  };
  const input = [
    {
      content: 'banner text · Corey leak',
      embeds: [{
        title: 'Corey title',
        description: 'description with Corey',
        fields: [{ name: 'Trigger', value: 'value with Corey' }],
        footer: { text: 'footer with Corey' },
      }],
    },
  ];
  const out = foh.sanitiseFohMessages(input, fake.sanitize);
  ok('walker reports replaced=true', out.replaced === true);
  ok('content was sanitised', /\[REDACTED-FOMO\]/.test(out.messages[0].content));
  ok('embed.title was sanitised', /\[REDACTED-FOMO\]/.test(out.messages[0].embeds[0].title));
  ok('embed.description was sanitised', /\[REDACTED-FOMO\]/.test(out.messages[0].embeds[0].description));
  ok('embed field value was sanitised',
     /\[REDACTED-FOMO\]/.test(out.messages[0].embeds[0].fields[0].value));
  ok('embed footer text was sanitised',
     /\[REDACTED-FOMO\]/.test(out.messages[0].embeds[0].footer.text));
}

// ============================================================
// T14 — Pack 5 Training Capture stub exists
// ============================================================
console.log('\n[T14] Pack 5 — TRC- registry rows file exists');
{
  const trcPath = path.join(__dirname, '..', 'docs', 'training-capture', 'TRC-foh-dark-horse.md');
  const exists = fs.existsSync(trcPath);
  ok('docs/training-capture/TRC-foh-dark-horse.md exists', exists);
  if (exists) {
    const body = fs.readFileSync(trcPath, 'utf8');
    ok('file contains at least 3 TRC- IDs',
       (body.match(/TRC-\d{8}-\d{3}/g) || []).length >= 3);
    ok('every TRC- row carries source_section field',
       body.split(/^## TRC-/m).slice(1).every(rowBlock => /"source_section":/.test(rowBlock)));
  }
}

// ============================================================
// T15 — Pack 8 PR QA checklist file exists
// ============================================================
console.log('\n[T15] Pack 8 — PR QA checklist file exists');
{
  const checklistPath = path.join(__dirname, '..', 'docs', 'foh-1.0.1-pr-qa-checklist.md');
  const exists = fs.existsSync(checklistPath);
  ok('docs/foh-1.0.1-pr-qa-checklist.md exists', exists);
  if (exists) {
    const body = fs.readFileSync(checklistPath, 'utf8');
    ok('checklist references FOH.1.0.1', /FOH\.1\.0\.1/.test(body));
    // Pack 8.11 acceptance line is reproduced inside a blockquote
    // (markdown line-wraps + leading "> " on continuation lines).
    // Normalise to a single line before asserting verbatim match.
    const normalised = body.replace(/\n>\s*/g, ' ').replace(/\s+/g, ' ');
    ok('checklist carries Pack 8 acceptance line verbatim',
       /Front-of-house presentation PR reviewed against FOH\.1\.0\.1\. Merge approval depends on screenshots, QA checklist completion, and zero engine-scope drift\./.test(normalised));
  }
}

// ============================================================
// Summary
// ============================================================
console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('[DH-FOH-QA] PASS — FOH.1.0.1 Dark Horse presentation contract green; one embed per promoted candidate; NEW separator; state-badge allow-list; colour-active-count conviction; colour-coded text matching; banned-wording sweep clean; Pack 4 terminology row; Pack 5 TRC rows drafted; Pack 8 checklist on file.');
process.exit(0);
