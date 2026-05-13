#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_dh_foh_qa.js
//
// QA harness for the Dark Horse Front-of-House (FOH.1.0.1) v3
// wire-up. Asserts the rendered payload against the operator-
// approved visual + wording contract.
//
// Coverage:
//   T1  Payload shape — empty top10 still emits banner + tail
//   T2  Single promoted candidate → banner+embed + tail (2 messages)
//   T3  Multi-candidate → banner+embed1 + (badge+embedK)*K + tail
//   T4  Embed structure — Pack 2.2 fields + state-badge allow-list
//   T5  Colour-active-count conviction format
//   T6  State-badge classifier — allow-list only
//   T7  Banned-wording sweep — zero hits across all messages
//   T8  Discord size guards — content ≤ 2000, embed total ≤ 6000
//   T9  Filter discipline — anchor-less candidates dropped
//   T10 Where to Act — multi-line value, colour-coded actions,
//       late-stage caveat row
//   T11 Direction / Move Type / Mover Stage allow-list
//   T12 Banner format — red NEW divider + gold banner +
//       teal terminology + ▸ subheadings + ⭐ standouts box
//   T13 Sanitiser walker preserves shape
//   T14 Pack 5 TRC- registry file exists + has next-evolution row
//   T15 Pack 8 PR QA checklist exists
//   T16 v3 wording refinements — beginner-readable Long/Short,
//       Trigger Level, Today's Rank, RISK-OFF wording
//   T17 Red NEW BADGE separators between candidates (not plain text)
//   T18 Tail message — BUILDING + visual reference card always emitted
//   T19 Terminology hyperlink support — Markdown links emitted when
//       opts.terminologyUrls is wired
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

// ── Fixtures ────────────────────────────────────────────────
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
// T1 — Empty top10 → banner-only + tail (no embeds)
// ============================================================
console.log('\n[T1] Empty top10 → banner + tail (educational quiet-scan surface)');
{
  const out = foh.buildDarkHorseFohPayload({ top10: [], allCount: 33 }, { level: 'quiet' }, { now: Date.parse('2026-05-13T12:00:00Z') });
  ok('kind = movement_digest_foh_v1_0', out.kind === 'movement_digest_foh_v1_0');
  ok('messages.length === 2 (banner + tail)', Array.isArray(out.messages) && out.messages.length === 2,
     { len: out.messages.length });
  ok('candidateCount === 0', out.candidateCount === 0);
  ok('embedCount === 0', out.embedCount === 0);
  ok('M1 has no embeds (banner only)', !out.messages[0].embeds || out.messages[0].embeds.length === 0);
  ok('M2 (tail) carries visual reference card',
     /📚\s+CLEAN BULLISH BREAKOUT — REFERENCE/.test(out.messages[1].content));
  ok('M2 (tail) carries BUILDING gold heading',
     /📡\s+BUILDING — MARKETS WARMING UP/.test(out.messages[1].content));
}

// ============================================================
// T2 — Single promoted candidate → banner+embed + tail (2 msgs)
// ============================================================
console.log('\n[T2] Single promoted candidate → 2 messages (banner+embed, tail)');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.1)];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  ok('messages.length === 2', out.messages.length === 2, { len: out.messages.length });
  ok('candidateCount === 1', out.candidateCount === 1);
  ok('embedCount === 1', out.embedCount === 1);
  ok('M1 has 1 embed', out.messages[0].embeds && out.messages[0].embeds.length === 1);
  ok('M2 (tail) has no embed', !out.messages[1].embeds || out.messages[1].embeds.length === 0);
}

// ============================================================
// T3 — Multi-candidate → banner+embed1 + (badge+embedK)*K-1 + tail
// ============================================================
console.log('\n[T3] Four promoted candidates → 5 messages (banner+e1, badge+e2, badge+e3, badge+e4, tail)');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,    1.10),
    mkRanked('NDX',    8, 'Bullish', rank.SECTIONS.INDICES,      19000),
    mkRanked('NVDA',   8, 'Bullish', rank.SECTIONS.EQUITIES,     900),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES,  2400),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  ok('messages.length === 5 (banner + 3 badges + tail)', out.messages.length === 5, { len: out.messages.length });
  ok('candidateCount === 4', out.candidateCount === 4);
  ok('embedCount === 4', out.embedCount === 4);
  // Banner is on M1 only
  ok('only M1 carries the gold DARK HORSE banner',
     /🐎  DARK HORSE — GLOBAL MOVER RADAR/.test(out.messages[0].content)
     && !out.messages.slice(1, -1).some(m => /🐎  DARK HORSE — GLOBAL MOVER RADAR/.test(m.content || '')));
  // Red NEW BADGE separator between candidates
  ok('M2 carries red badge separator "STANDOUT #2 of 4"',
     /```diff\n-\s*🆕\s+STANDOUT #2 of 4\n```/.test(out.messages[1].content));
  ok('M3 carries red badge separator "STANDOUT #3 of 4"',
     /```diff\n-\s*🆕\s+STANDOUT #3 of 4\n```/.test(out.messages[2].content));
  ok('M4 carries red badge separator "STANDOUT #4 of 4"',
     /```diff\n-\s*🆕\s+STANDOUT #4 of 4\n```/.test(out.messages[3].content));
  // Tail carries the reference card
  ok('M5 (tail) carries the visual reference card',
     /📚\s+CLEAN BULLISH BREAKOUT — REFERENCE/.test(out.messages[4].content));
  // Last embed footer carries next review
  const lastEmbed = out.messages[3].embeds[0];
  ok('last embed footer carries next-review stamp',
     /next review \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(lastEmbed.footer.text),
     lastEmbed.footer);
}

// ============================================================
// T4 — Embed structure — Pack 2.2 fields + state-badge allow-list
// ============================================================
console.log('\n[T4] Embed structure — fields + state-badge from allow-list');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10)];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, { now: Date.parse('2026-05-13T12:00:00Z') });
  const e = out.messages[0].embeds[0];
  ok('embed.color is a finite decimal', Number.isFinite(e.color));
  ok('embed.title starts with 🐎 + symbol', /^🐎  EURUSD  ·  /.test(e.title), { title: e.title });
  ok('embed.title ends with a state-badge from the allow-list',
     foh.STATE_BADGE_VALUES.has(e.title.replace(/^🐎  [A-Z0-9]+  ·  /, '')),
     { title: e.title });
  ok('embed.description is a non-empty trader-voice line',
     typeof e.description === 'string' && e.description.length > 0 && e.description.length <= 240);
  const fieldNames = e.fields.map(f => f.name);
  ok('field "Move Type" present', fieldNames.includes('Move Type'));
  ok('field "Direction" present', fieldNames.includes('Direction'));
  ok('field "Conviction" present', fieldNames.includes('Conviction'));
  ok('field "Horizon" present', fieldNames.includes('Horizon'));
  ok('field "Today\'s Rank" present (renamed from "Standing")', fieldNames.includes('Today\'s Rank'));
  // Per-candidate "Terms" / "In ATLAS terms" field REMOVED — banner row covers it
  ok('field "In ATLAS terms" REMOVED', !fieldNames.includes('In ATLAS terms') && !fieldNames.includes('Terms'));
}

// ============================================================
// T5 — Conviction colour-active-count scale (Pack §0.2)
// ============================================================
console.log('\n[T5] Conviction value uses colour-active-count, no filler dots');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10)];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, {});
  const conv = out.messages[0].embeds[0].fields.find(f => f.name === 'Conviction').value;
  ok('conviction value uses colour glyph + "/ 5" suffix',
     /^(🟢|🔴|🟡|🟠|⚪)/.test(conv) && / \/ 5 · /.test(conv) && /(Low|Medium|High|Very High)$/.test(conv),
     { conv });
  ok('no empty-circle ○ filler', !/○/.test(conv));
  ok('no inactive ● filler', !/●○/.test(conv));
  ok('score 10 → 5/5 Very High',
     /^🟢🟢🟢🟢🟢 \/ 5 · Very High$/.test(foh.convictionScale(10, foh.STATE_BADGE.STRONG_BULLISH)));
  ok('score 6 bearish → 3/5 🔴 Medium',
     /^🔴🔴🔴 \/ 5 · Medium$/.test(foh.convictionScale(6, foh.STATE_BADGE.BEARISH_PRESSURE)));
}

// ============================================================
// T6 — State-badge classifier (allow-list only)
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
    ok(`${label} → "${want}"`, foh.classifyStateBadge(rec) === want);
  }
}

// ============================================================
// T7 — Banned-wording sweep across full payload
// ============================================================
console.log('\n[T7] Banned-wording sweep — zero hits anywhere in the payload');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,   1.10),
    mkRanked('NDX',    8, 'Bullish', rank.SECTIONS.INDICES,     19000),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES, 2400),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {});
  const hits = foh.sweepBannedWording(out.messages);
  ok('banned-wording sweep returns zero hits', hits.length === 0,
     hits.length ? { hits: hits.slice(0, 5) } : undefined);
  const flat = out.messages.map(m => {
    const blob = [m.content || ''];
    for (const e of m.embeds || []) {
      blob.push(e.title || '', e.description || '');
      for (const f of e.fields || []) blob.push(f.value || '');
      if (e.footer && e.footer.text) blob.push(e.footer.text);
    }
    return blob.join('\n');
  }).join('\n');
  for (const re of [
    /\bbody close\b/i, /\bbreak and hold\b/i, /\bretest holds\b/i,
    /\bread weakens\b/i, /\bpending\b/i, /\bunavailable\b/i,
    /\bLearning Links\b/i, /\bBOS\b/, /\bCHoCH\b/,
  ]) {
    ok(`banned wording absent: ${re}`, !re.test(flat));
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
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {});
  for (let i = 0; i < out.messages.length; i++) {
    const meas = foh.measureMessage(out.messages[i]);
    ok(`M${i + 1} content ≤ ${foh.DISCORD_CONTENT_LIMIT}`,
       meas.contentLen <= foh.DISCORD_CONTENT_LIMIT, { contentLen: meas.contentLen });
    for (let j = 0; j < meas.embedTotals.length; j++) {
      ok(`M${i + 1} embed ${j + 1} total ≤ ${foh.DISCORD_EMBED_TOTAL_LIMIT}`,
         meas.embedTotals[j] <= foh.DISCORD_EMBED_TOTAL_LIMIT, { embedTotal: meas.embedTotals[j] });
    }
  }
}

// ============================================================
// T9 — Filter discipline — anchor-less candidates dropped
// ============================================================
console.log('\n[T9] Filter discipline — anchor-less candidates filtered out');
{
  const withAnchors = mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10);
  const withoutAnchors = rank.enrichCandidate(
    mkCandidate({ symbol: 'GBPUSD', score: 8 }), null, 6, { watchThreshold: 8 }
  );
  withoutAnchors.section = rank.SECTIONS.FX_MAJORS;
  withoutAnchors.sectionLabel = rank.SECTION_LABEL[rank.SECTIONS.FX_MAJORS];
  const out = foh.buildDarkHorseFohPayload({ top10: [withAnchors, withoutAnchors], allCount: 33 }, null, {});
  ok('candidateCount = 1 (anchor-less candidate filtered)', out.candidateCount === 1);
  ok('filteredOut = 1', out.filteredOut === 1);
  ok('only EURUSD promoted', /EURUSD/.test(out.messages[0].embeds[0].title));
}

// ============================================================
// T10 — Where to Act multi-line + colour-coded + late-stage caveat
// ============================================================
console.log('\n[T10] Where to Act — multi-line BUY/RISK-OFF + late-stage caveat');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, {});
  const wta = out.messages[0].embeds[0].fields.find(f => f.name === 'Where to Act');
  ok('Where to Act field present', wta != null);
  // Multi-line — value contains \n between BUY/RISK-OFF
  ok('Where to Act contains \\n line break', wta.value.includes('\n'));
  ok('Where to Act has 🟢 BUY or 🟢 SELL line', /^🟢 (BUY|SELL) at/m.test(wta.value), wta);
  ok('Where to Act has 🛑 RISK-OFF line', /^🛑 RISK-OFF at/m.test(wta.value), wta);
  ok('Where to Act uses beginner-readable "exit the idea" wording',
     /exit the idea if this level fails/.test(wta.value), wta);

  // Late-stage caveat line should appear for late/exhaustion phases.
  const lateRow = mkRanked('NVDA', 7, 'Bullish', rank.SECTIONS.EQUITIES, 900);
  lateRow.movePhase = 'late';
  const out2 = foh.buildDarkHorseFohPayload({ top10: [lateRow], allCount: 33 }, null, {});
  const wta2 = out2.messages[0].embeds[0].fields.find(f => f.name === 'Where to Act');
  ok('late-stage candidate carries ⚠️ caveat line',
     /^⚠️\s+Size small/m.test(wta2.value), wta2);
}

// ============================================================
// T11 — Direction / Move Type / Mover Stage allow-list
// ============================================================
console.log('\n[T11] Direction + Move Type + Mover Stage discipline');
{
  // Direction values must include the beginner-readable hint
  ok('Bullish → "▲ Long  (rising bias)"', foh.directionField('Bullish') === '▲ Long  (rising bias)');
  ok('Bearish → "▼ Short  (falling bias)"', foh.directionField('Bearish') === '▼ Short  (falling bias)');
  ok('Neutral → "▶ Sideways  (no clear bias)"', foh.directionField('Neutral') === '▶ Sideways  (no clear bias)');
  const ALLOWED_MOVE_TYPE = new Set(['Breakout', 'Reversal', 'Range Break', 'Continuation']);
  for (const phase of ['early', 'mid', 'late', 'exhaustion']) {
    const r = { direction: 'Bullish', movePhase: phase, score: 8, structureState: 'higher highs and higher lows', section: rank.SECTIONS.FX_MAJORS };
    ok(`moveType(${phase}) in allow-list`, ALLOWED_MOVE_TYPE.has(foh.moveType(r)));
    ok(`moverStage(${phase}) in 1..3`, [1, 2, 3].includes(foh.moverStage(r)));
  }
}

// ============================================================
// T12 — Banner format — red NEW divider + gold banner + teal
// terminology + ▸ subheadings + ⭐ standouts gold box
// ============================================================
console.log('\n[T12] Banner — red NEW divider + gold banners + teal terminology + ▸ subheadings');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10)];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, { now: Date.parse('2026-05-13T12:00:00Z') });
  const c = out.messages[0].content;
  ok('content opens with red NEW divider (```diff fence)', /^```diff\n-\s+━{30,}/.test(c));
  ok('red NEW divider contains "N E W   D A R K   H O R S E   S C A N"',
     /N E W   D A R K   H O R S E   S C A N/.test(c));
  ok('red NEW divider carries 🆕 markers around the scan stamp',
     /🆕[\s\S]+?33 markets scanned[\s\S]+?🆕/.test(c));
  ok('gold DARK HORSE GLOBAL MOVER RADAR banner present',
     /🐎  DARK HORSE — GLOBAL MOVER RADAR/.test(c));
  ok('gold ⭐ STANDOUTS section box present',
     /⭐  STANDOUTS — TODAY'S STRONGEST MOVERS/.test(c));
  ok('teal cyan terminology row present (```ansi fallback)',
     /```ansi\n.*\[Breakout\][\s\S]*\[Retest\][\s\S]*\[Continuation\][\s\S]*\[Mover Stage 1\][\s\S]*```/.test(c));
  ok('▸ Today\'s read subheading present', /▸  Today's read/.test(c));
  ok('▸ Market mood subheading present',  /▸  Market mood/.test(c));
}

// ============================================================
// T13 — Sanitiser walker preserves shape
// ============================================================
console.log('\n[T13] Sanitiser walker — applies sanitize() to every string field');
{
  const fake = ({ content }) => ({ content: String(content).replace(/Corey/g, '[REDACTED-FOMO]'), replaced: /Corey/.test(content) });
  const input = [{
    content: 'banner with Corey leak',
    embeds: [{
      title: 'Corey title',
      description: 'description with Corey',
      fields: [{ name: 'Trigger Level', value: 'value with Corey' }],
      footer: { text: 'footer with Corey' },
    }],
  }];
  const out = foh.sanitiseFohMessages(input, fake);
  ok('walker reports replaced=true', out.replaced === true);
  ok('content was sanitised', /\[REDACTED-FOMO\]/.test(out.messages[0].content));
  ok('embed.title sanitised', /\[REDACTED-FOMO\]/.test(out.messages[0].embeds[0].title));
  ok('embed.description sanitised', /\[REDACTED-FOMO\]/.test(out.messages[0].embeds[0].description));
  ok('embed field value sanitised', /\[REDACTED-FOMO\]/.test(out.messages[0].embeds[0].fields[0].value));
  ok('embed footer text sanitised', /\[REDACTED-FOMO\]/.test(out.messages[0].embeds[0].footer.text));
}

// ============================================================
// T14 — Pack 5 TRC- registry file exists + next-evolution row
// ============================================================
console.log('\n[T14] Pack 5 — TRC- registry rows file + next-evolution row');
{
  const trcPath = path.join(__dirname, '..', 'docs', 'training-capture', 'TRC-foh-dark-horse.md');
  const exists = fs.existsSync(trcPath);
  ok('docs/training-capture/TRC-foh-dark-horse.md exists', exists);
  if (exists) {
    const body = fs.readFileSync(trcPath, 'utf8');
    ok('file contains at least 5 TRC- IDs',
       (body.match(/TRC-\d{8}-\d{3}/g) || []).length >= 5);
    ok('every TRC- row carries source_section field',
       body.split(/^## TRC-/m).slice(1).every(rowBlock => /"source_section":/.test(rowBlock)));
    ok('contains next-evolution flag for rendered ATLAS chart-reference cards',
       /rendered ATLAS chart-reference cards/i.test(body) || /rendered chart-reference card/i.test(body));
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
    const normalised = body.replace(/\n>\s*/g, ' ').replace(/\s+/g, ' ');
    ok('checklist carries Pack 8 acceptance line verbatim',
       /Front-of-house presentation PR reviewed against FOH\.1\.0\.1\. Merge approval depends on screenshots, QA checklist completion, and zero engine-scope drift\./.test(normalised));
  }
}

// ============================================================
// T16 — v3 wording refinements (beginner-readable)
// ============================================================
console.log('\n[T16] v3 wording refinements — clear, practical, beginner-readable');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10)];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {});
  const e = out.messages[0].embeds[0];
  const trigger = e.fields.find(f => f.name === 'Trigger Level').value;
  const rank_ = e.fields.find(f => f.name === 'Today\'s Rank').value;
  ok('Trigger Level value reads "Above|Below <level> — already broken and held" OR "— waiting for the next push"',
     /(Above|Below) \d+(\.\d+)? — (already broken and held|waiting for the next push)/.test(trigger),
     { trigger });
  ok('Today\'s Rank value uses ordinal "1st of today\'s 1 standouts"',
     /^1st of today's \d+ standouts?$/.test(rank_) || /^1st of today's standouts$/.test(rank_),
     { rank: rank_ });
}

// ============================================================
// T17 — Red NEW BADGE separator between candidates
// ============================================================
console.log('\n[T17] Red NEW BADGE separator — no plain "─── NEW ───" text fallback');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES, 2400),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, {});
  const c2 = out.messages[1].content;
  ok('M2 content is wrapped in ```diff fence', /^```diff\n/.test(c2) && /\n```/.test(c2));
  ok('M2 content has the 🆕 NEW BADGE token', /🆕\s+STANDOUT #2 of 2/.test(c2));
  // Plain "─── NEW ───" text fallback must NOT appear anywhere.
  const flat = out.messages.map(m => m.content || '').join('\n');
  ok('no plain "─── NEW ───" text fallback anywhere', !/─── NEW ───/.test(flat));
}

// ============================================================
// T18 — Tail message — BUILDING + reference card always emitted
// ============================================================
console.log('\n[T18] Tail — BUILDING + visual reference card always shipped');
{
  // Even on completely empty top10 (quiet scan), the tail message
  // ships so the channel always carries the educational surface.
  const out = foh.buildDarkHorseFohPayload({ top10: [], allCount: 33 }, { level: 'quiet' }, {});
  const tail = out.messages[out.messages.length - 1];
  ok('tail message exists', tail != null);
  ok('tail has no embeds', !tail.embeds || tail.embeds.length === 0);
  ok('tail BUILDING & CHART REFERENCE red badge',
     /```diff\n-\s*🆕\s+BUILDING\s+&\s+CHART REFERENCE\n```/.test(tail.content));
  ok('tail BUILDING gold section heading',
     /📡\s+BUILDING — MARKETS WARMING UP/.test(tail.content));
  ok('tail visual reference card',
     /📚\s+CLEAN BULLISH BREAKOUT — REFERENCE/.test(tail.content));
  ok('tail Risk reminder ▸ subheading',
     /▸  Risk reminder/.test(tail.content));
}

// ============================================================
// T19 — Terminology hyperlink support
// ============================================================
console.log('\n[T19] Terminology hyperlinks — Markdown links emitted when URLs are wired');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10)];
  // No URL map → cyan-chip fallback inside ```ansi fence
  const outA = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, { now: Date.parse('2026-05-13T12:00:00Z') });
  ok('without URL map → ```ansi cyan chip fallback',
     /```ansi\n.*\[Breakout\][\s\S]*```/.test(outA.messages[0].content));
  ok('linkRoutingStatus = "pending" when no URLs wired',
     outA.linkRoutingStatus === 'pending');

  // With a URL map → Markdown links inline (no ansi fence wrap for that row)
  const outB = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, {
    now: Date.parse('2026-05-13T12:00:00Z'),
    terminologyUrls: {
      'Breakout':       'https://example.com/glossary/breakout',
      'Retest':         'https://example.com/glossary/retest',
      'Continuation':   'https://example.com/glossary/continuation',
      'Mover Stage 1':  'https://example.com/glossary/mover-stage-1',
    },
  });
  ok('with URL map → Markdown link form emitted in banner content',
     /\[Breakout\]\(https:\/\/example\.com\/glossary\/breakout\)/.test(outB.messages[0].content));
  ok('linkRoutingStatus = "partial" when at least one URL wired',
     outB.linkRoutingStatus === 'partial');
}

// ============================================================
// Summary
// ============================================================
console.log('\n==========================');
console.log('Passed: ' + passed + '   Failed: ' + failed);
if (failed > 0) process.exit(1);
console.log('[DH-FOH-QA] PASS — v3 wire-up green: banner+candidate+tail structure; red NEW divider + per-message red NEW BADGE separators; gold section banners + ▸ subheadings; teal terminology (cyan chip fallback + Markdown-link form when wired); v3 candidate embed fields (Trigger Level + Today\'s Rank); multi-line Where to Act with BUY/RISK-OFF + late-stage caveat; beginner-readable Long/Short; visual reference card always shipped; banned-wording sweep clean; Pack 5 TRC rows on file; Pack 8 checklist on file.');
process.exit(0);
