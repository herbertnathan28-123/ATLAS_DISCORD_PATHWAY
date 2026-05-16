#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/test_dh_foh_qa.js
//
// QA harness for Dark Horse FOH.1.0.1 — v6 PROTOTYPE PARITY.
//
// ──────────────────────────────────────────────────────────
// ACCEPTANCE REALIGNMENT NOTE (operator directive, 2026-05-14)
// ──────────────────────────────────────────────────────────
// This harness was previously written against the FOH.1.2.1
// INTERMEDIATE implementation shape (single-line "🛑 RISK-OFF"
// Where-to-Act, conviction without ⚫ inactive disc, no Why-X
// reasoning, no per-card Dollar Risk / What This Means /
// WHAT TO DO NOW / What Confirms / What Cancels surfaces).
//
// The canonical v6 prototype target (matrix Section A source-
// of-truth) is `scripts/render_dh_foh_v6_preview.js::
// SAMPLE_MESSAGES`. Per PR #73 doctrine and operator-confirmed
// directives B8–B14 + D (2026-05-14), the v1.2.1 marker set is
// historical/intermediate reference only. A test that passes
// the v1.2.1 surface but fails canonical v6 is a failed test.
//
// This harness was rewritten on the
// `claude/dark-horse-foh-restoration-v6-parity` branch to
// enforce the canonical v6 acceptance target and prevent any
// false-pass against the intermediate shape.
//
// Coverage (v6 canonical):
//   T1  Payload shape — empty top10 → banner + BUILDING/ref +
//       tail (3 messages — educational quiet-scan surface)
//   T2  Single promoted candidate → 4 messages (banner +
//       candidate + ref + tail)
//   T3  Multi-candidate → 1 + N + 2 messages (banner + N
//       candidate cards + BUILDING/ref + tail)
//   T4  Embed structure — v6 field set including Conviction
//       (5-disc + Why-X), Decision Level (+ Why it matters),
//       Where to Act (4 zones), Dollar Risk,
//       What This Means, WHAT TO DO NOW (① to ⑤), What
//       Confirms / What Cancels, plus state-badge allow-list
//   T5  Conviction format — 5-disc with ⚫ inactive disc, "N/5"
//       suffix, " — Label" tail, "Why X" reasoning underneath
//   T6  State-badge classifier — allow-list only
//   T7  Banned-wording sweep — zero hits (no BOS, CHoCH,
//       Learning Links, dashed "── NEW ──" text, etc.)
//   T8  Discord size guards — content ≤ 2000, embed total ≤ 6000
//   T9  Filter discipline — anchor-less candidates dropped
//   T10 Where to Act — 4-zone block (ENTRY band, WATCH single
//       level, CAUTION band, INVALIDATION single level) with
//       Next review line; no single-line "🛑 RISK-OFF" form
//   T11 Direction / Move Type / Mover Stage allow-list
//   T12 Banner — red NEW divider + gold DARK HORSE banner +
//       EXPANDED TERMINOLOGY HYPERLINKS row + Market Mood
//       5-disc block + STANDOUTS banner. No "Today's read"
//       v1.2.1 subheading.
//   T13 Sanitiser walker preserves shape
//   T14 Lifecycle badge — FRESH (filled red ```diff fence),
//       STILL ACTIVE / FADING (mobile-safe boxed code-block markers);
//       no dashed "── NEW ──" text
//   T15 BUILDING + Chart Reference — present as its own
//       message with chart-reference embed + chart-card spec
//   T16 Tail — Risk reminder + Briefing summary subheadings
//   T17 Terminology hyperlinks use visible-bracket [[Label]]
//       (url) form (NO escaped \[Label\] form)
//   T18 Dollar Risk field — present with lifecycle-aware
//       header (half size for FRESH / full size allowed (STILL
//       ACTIVE) / QUARTER size only (FADING)) + dollar figure
//   T19 WHAT TO DO NOW — numbered ① to ⑤ checklist
// ============================================================

const path = require('path');
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
  const step = basePrice >= 1000 ? 0.6 : basePrice >= 100 ? 0.8 : basePrice >= 10 ? 0.2 : 0.00025;
  for (let i = 0; i < n; i++) {
    const open  = p;
    const close = p + step;
    const high  = close + step * 0.7;
    const low   = open - step * 0.5;
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
function mkRanked(symbol, score, direction, sectionKey, basePrice, overridePhase) {
  const enriched = rank.enrichCandidate(
    mkCandidate({ symbol, score, direction }),
    dailyCandles(25, basePrice),
    6, { watchThreshold: 8 }
  );
  enriched.section = sectionKey;
  enriched.sectionLabel = rank.SECTION_LABEL[sectionKey];
  if (overridePhase) enriched.movePhase = overridePhase;
  if (overridePhase === 'mid') {
    enriched.firstSeenAt = Date.parse('2026-05-11T07:40:00Z');
    enriched.activeCycleCount = 24;
  }
  if (overridePhase === 'late') {
    enriched.firstSeenAt = Date.parse('2026-05-10T12:00:00Z');
    enriched.activeCycleCount = 40;
  }
  return enriched;
}

// ============================================================
// T1 — Empty top10 → banner + BUILDING/ref + tail (3 messages)
// ============================================================
console.log('\n[T1] Empty top10 → 3 messages (banner + BUILDING/ref + tail)');
{
  const out = foh.buildDarkHorseFohPayload({ top10: [], allCount: 33 }, { level: 'quiet' }, { now: Date.parse('2026-05-13T12:00:00Z') });
  ok('kind = movement_digest_foh_v1_0', out.kind === 'movement_digest_foh_v1_0');
  ok('messages.length === 3 (banner + ref + tail)', out.messages.length === 3, { len: out.messages.length });
  ok('candidateCount === 0', out.candidateCount === 0);
  ok('embedCount === 0', out.embedCount === 0);
  ok('M1 carries terminology embed', out.messages[0].embeds && /EXPANDED TERMINOLOGY HYPERLINKS/.test(out.messages[0].embeds[0].title));
  ok('M2 (BUILDING/ref) carries the chart reference embed',
     out.messages[1].embeds && /Clean Bullish Breakout — Reference/.test(out.messages[1].embeds[0].title));
  ok('M2 BUILDING banner present (no v1.2.1 "MARKETS WARMING UP" wording)',
     /📡\s+BUILDING — WARMING UP BELOW STANDOUT GRADE/.test(out.messages[1].content));
  ok('M3 (tail) carries Risk reminder + Briefing summary',
     /Risk reminder/.test(out.messages[2].content) && /Briefing summary/.test(out.messages[2].content));
}

// ============================================================
// T2 — Single promoted candidate → 4 messages
// ============================================================
console.log('\n[T2] Single promoted candidate → 4 messages (banner + card + ref + tail)');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.1, 'early')];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  ok('messages.length === 4', out.messages.length === 4, { len: out.messages.length });
  ok('candidateCount === 1', out.candidateCount === 1);
  ok('embedCount === 1', out.embedCount === 1);
  ok('M1 (banner) carries terminology embed', out.messages[0].embeds && /EXPANDED TERMINOLOGY HYPERLINKS/.test(out.messages[0].embeds[0].title));
  ok('M2 carries the candidate embed', out.messages[1].embeds && out.messages[1].embeds.length === 1);
  ok('M2 lifecycle separator names "FRESH"', /FRESH/.test(out.messages[1].content));
}

// ============================================================
// T3 — Multi-candidate (3) → 6 messages
// ============================================================
console.log('\n[T3] Three promoted candidates (FRESH/STILL ACTIVE/FADING) → 6 messages');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,    1.10, 'early'),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES,  2400, 'mid'),
    mkRanked('NVDA',   7, 'Bullish', rank.SECTIONS.EQUITIES,     900,  'late'),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  ok('messages.length === 6 (banner + 3 candidates + ref + tail)', out.messages.length === 6, { len: out.messages.length });
  ok('candidateCount === 3', out.candidateCount === 3);
  ok('embedCount === 3', out.embedCount === 3);
  // Banner is on M1 only
  ok('only M1 carries the gold DARK HORSE banner',
     /🐎  DARK HORSE — GLOBAL MOVER RADAR/.test(out.messages[0].content)
     && !out.messages.slice(1, -2).some(m => /🐎  DARK HORSE — GLOBAL MOVER RADAR/.test(m.content || '')));
  // Lifecycle separators
  ok('M2 separator says FRESH + STANDOUT #1 of 3',
     /FRESH/.test(out.messages[1].content) && /STANDOUT #1 of 3/.test(out.messages[1].content));
  ok('M3 separator says STILL ACTIVE + STANDOUT #2 of 3',
     /STILL ACTIVE/.test(out.messages[2].content) && /STANDOUT #2 of 3/.test(out.messages[2].content));
  ok('M4 separator says FADING + STANDOUT #3 of 3',
     /FADING/.test(out.messages[3].content) && /STANDOUT #3 of 3/.test(out.messages[3].content));
  // BUILDING + reference card
  ok('M5 carries the BUILDING + chart reference message',
     /Clean Bullish Breakout — Reference/.test((out.messages[4].embeds || [{}])[0].title || ''));
  // Tail
  ok('M6 (tail) carries Briefing summary',
     /Briefing summary/.test(out.messages[5].content));
  // Last candidate footer carries next review
  const lastCandidateEmbed = out.messages[3].embeds[0];
  ok('last candidate footer carries next-review stamp',
     /next review \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(lastCandidateEmbed.footer.text),
     lastCandidateEmbed.footer);
}

// ============================================================
// T4 — Embed structure — v6 canonical field set
// ============================================================
console.log('\n[T4] Embed v6 field set — Move Type / Direction / Conviction / Decision Level / Expected Duration / Today\'s Rank / Where to Act / Dollar Risk / What This Means / WHAT TO DO NOW / What Confirms / What Cancels');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early')];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, { now: Date.parse('2026-05-13T12:00:00Z') });
  const e = out.messages[1].embeds[0];
  ok('embed.color is a finite decimal', Number.isFinite(e.color));
  ok('embed.title starts with 🐎 + symbol', /^🐎  EURUSD  ·  /.test(e.title), { title: e.title });
  ok('embed.title ends with a state-badge from the allow-list',
     foh.STATE_BADGE_VALUES.has(e.title.replace(/^🐎  [A-Z0-9]+  ·  /, '')),
     { title: e.title });
  ok('embed.description is a non-empty narrative line',
     typeof e.description === 'string' && e.description.length > 0 && e.description.length <= 400);

  const fieldNames = e.fields.map(f => f.name);
  ok('field "Move Type" present',         fieldNames.includes('Move Type'));
  ok('field "Direction" present',         fieldNames.includes('Direction'));
  ok('field "Conviction" present',        fieldNames.includes('Conviction'));
  ok('field "ATLAS execution state" present', fieldNames.includes('ATLAS execution state'));
  ok('field "ATLAS confirmation gate" present', fieldNames.includes('ATLAS confirmation gate'));
  ok('field "Decision Level" present',    fieldNames.includes('Decision Level'));
  ok('field "Trigger Level" removed',     !fieldNames.includes('Trigger Level'));
  ok('field "Expected Duration" present (renamed from Horizon)', fieldNames.includes('Expected Duration'));
  ok('field "Horizon" REMOVED',           !fieldNames.includes('Horizon'));
  ok('field "Today\'s Rank" present',     fieldNames.includes("Today's Rank"));
  ok('field "Validity" present',          fieldNames.includes('Validity'));
  ok('field "Where to Act" present',      fieldNames.includes('Where to Act'));
  ok('field starts-with "💲 Dollar Risk" present',
     fieldNames.some(n => /^💲 Dollar Risk/.test(n)));
  ok('field "What this means" present',   fieldNames.includes('What this means'));
  ok('field "WHAT TO DO NOW" present',    fieldNames.includes('WHAT TO DO NOW'));
  ok('field "What confirms the idea" present', fieldNames.includes('What confirms the idea'));
  ok('field "What cancels the idea" present',  fieldNames.includes('What cancels the idea'));
  ok('field "Source proof" present',      fieldNames.includes('Source proof'));
  ok('execution state says Dark Horse is not standalone execution authority',
     /not standalone execution authority/.test(e.fields.find(f => f.name === 'ATLAS execution state').value));
  ok('confirmation gate requires market context + decision/entry/invalidation + candle close + R:R',
     /market context/.test(e.fields.find(f => f.name === 'ATLAS confirmation gate').value)
     && /Decision Level/.test(e.fields.find(f => f.name === 'ATLAS confirmation gate').value)
     && /Entry Zone/.test(e.fields.find(f => f.name === 'ATLAS confirmation gate').value)
     && /Invalidation/.test(e.fields.find(f => f.name === 'ATLAS confirmation gate').value)
     && /Confirmed Candle Close|candle-close confirmation/.test(e.fields.find(f => f.name === 'ATLAS confirmation gate').value)
     && /1:3/.test(e.fields.find(f => f.name === 'ATLAS confirmation gate').value)
     && /2R/.test(e.fields.find(f => f.name === 'ATLAS confirmation gate').value));
  ok('source proof ties text levels and chart labels to same payload',
     /Same evidence payload/.test(e.fields.find(f => f.name === 'Source proof').value)
     && /Chart labels use these same values/.test(e.fields.find(f => f.name === 'Source proof').value));
  // Per-candidate "In ATLAS terms" / "Terms" REMOVED — banner row covers terminology
  ok('field "In ATLAS terms" / "Terms" REMOVED',
     !fieldNames.includes('In ATLAS terms') && !fieldNames.includes('Terms'));
}

// ============================================================
// T5 — Conviction format — 5-disc with ⚫ inactive + "Why X" reasoning
// ============================================================
console.log('\n[T5] Conviction — 5-disc, ⚫ inactive, "Why X" reasoning');
{
  const top10 = [mkRanked('EURUSD', 8, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'mid')];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, {});
  const conv = out.messages[1].embeds[0].fields.find(f => f.name === 'Conviction').value;
  // Canonical v6: "🟢🟢🟢🟢⚫ 4/5 — High\n_Why High: ..._" — 5-disc + ⚫ inactive
  ok('conviction value uses 5-disc + " N/5 — Label" tail',
     /^(🟢|🔴|🟡|🟠|⚪)+⚫? ?\d+\/5 — (Low|Medium|High|Very High)/.test(conv),
     { conv: conv.slice(0, 80) });
  ok('conviction value contains "Why X" reasoning line',
     /_Why (Low|Medium|High|Very High): /.test(conv));
  // Score 8 → mid phase classifies to BULLISH_PRESSURE → 4/5 High
  ok('score 8 mid phase emits 4/5', /4\/5 — High/.test(conv));
  ok('inactive disc is ⚫ (never empty-circle ○ filler)',
     !/○/.test(conv));
  // Score 10 → very high (5/5)
  ok('score 10 → 5/5 Very High',
     /5\/5 — Very High/.test(foh.discScale(5, 5, 'Very High', '🟢')));
  // discScale shape sanity
  ok('discScale(4, 5, "High", "🟢") = "🟢🟢🟢🟢⚫ 4/5 — High"',
     foh.discScale(4, 5, 'High', '🟢') === '🟢🟢🟢🟢⚫ 4/5 — High');
}

// ============================================================
// T6 — State-badge classifier (allow-list only)
// ============================================================
console.log('\n[T6] State-badge classifier — only allow-list values returned');
{
  const cases = [
    { symbol: 'X', score: 10, direction: 'Bullish', phase: 'early', expected: foh.STATE_BADGE.STRONG_BULLISH },
    { symbol: 'X', score: 10, direction: 'Bearish', phase: 'early', expected: foh.STATE_BADGE.STRONG_BEARISH },
    { symbol: 'X', score:  7, direction: 'Bullish', phase: 'mid',   expected: foh.STATE_BADGE.BULLISH_PRESSURE },
    { symbol: 'X', score:  7, direction: 'Bearish', phase: 'mid',   expected: foh.STATE_BADGE.BEARISH_PRESSURE },
    { symbol: 'X', score:  8, direction: 'Bullish', phase: 'late',  expected: foh.STATE_BADGE.DEVELOPING_WATCH },
    { symbol: 'X', score:  3, direction: 'Bullish', phase: 'mid',   expected: foh.STATE_BADGE.MARGINAL_REDUCED_CONVICTION },
  ];
  for (const c of cases) {
    const got = foh.classifyStateBadge({ symbol: c.symbol, score: c.score, direction: c.direction, movePhase: c.phase });
    ok(`classify ${c.score}/${c.direction}/${c.phase} → ${c.expected}`, got === c.expected, { got });
  }
}

// ============================================================
// T7 — Banned-wording sweep
// ============================================================
console.log('\n[T7] Banned-wording sweep — zero hits anywhere in the payload');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,    1.10, 'early'),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES,  2400, 'mid'),
    mkRanked('NVDA',   7, 'Bullish', rank.SECTIONS.EQUITIES,     900,  'late'),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  const hits = foh.sweepBannedWording(out.messages);
  ok('sweepBannedWording returns []', hits.length === 0, { hits });
}

// ============================================================
// T8 — Discord size guards
// ============================================================
console.log('\n[T8] Discord size guards — content/embed/field limits');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,    1.10, 'early'),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES,  2400, 'mid'),
    mkRanked('NVDA',   7, 'Bullish', rank.SECTIONS.EQUITIES,     900,  'late'),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  for (let i = 0; i < out.messages.length; i++) {
    const meas = foh.measureMessage(out.messages[i]);
    ok(`M${i + 1} content ≤ 2000 (got ${meas.contentLen})`, meas.contentLen <= foh.DISCORD_CONTENT_LIMIT);
    for (let j = 0; j < meas.embedTotals.length; j++) {
      ok(`M${i + 1} embed ${j + 1} total ≤ 6000 (got ${meas.embedTotals[j]})`,
         meas.embedTotals[j] <= foh.DISCORD_EMBED_TOTAL_LIMIT);
    }
    const violations = foh.findDiscordLimitViolations(out.messages[i]);
    ok(`M${i + 1} has no Discord per-field limit violations`, violations.length === 0, violations);
  }
}

// ============================================================
// T9 — Filter discipline — anchor-less candidates dropped
// ============================================================
console.log('\n[T9] Filter discipline — anchor-less candidates filtered out');
{
  // Candidate without evidenceAnchors → availability 'pending' → filtered
  const noAnchorRecord = {
    symbol: 'XYZ', score: 9, direction: 'Bullish', movePhase: 'early',
    section: rank.SECTIONS.FX_MAJORS,
    sectionLabel: rank.SECTION_LABEL[rank.SECTIONS.FX_MAJORS],
    evidenceAnchors: { availability: 'pending' },
  };
  const out = foh.buildDarkHorseFohPayload({ top10: [noAnchorRecord], allCount: 33 }, null, {});
  ok('filteredOut === 1', out.filteredOut === 1);
  ok('candidateCount === 0', out.candidateCount === 0);
  ok('messages.length === 3 (banner + ref + tail — no candidate)', out.messages.length === 3);
}

// ============================================================
// T10 — Where to Act — 4-zone block + Next review
// ============================================================
console.log('\n[T10] Where to Act — 4-zone block (ENTRY/WATCH/CAUTION/INVALIDATION) + Next review');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early')];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  const wtaFields = out.messages[1].embeds[0].fields.filter(f => /^Where to Act/.test(f.name));
  const wta = wtaFields.map(f => f.value).join('\n\n');
  ok('Where to Act is split into Discord-safe fields', wtaFields.length >= 2 && wtaFields.every(f => f.value.length <= foh.DISCORD_FIELD_VALUE_LIMIT), wtaFields.map(f => ({ name: f.name, len: f.value.length })));
  ok('Where to Act has 🟢 ENTRY zone line',          /🟢 ENTRY zone/.test(wta));
  ok('Where to Act has 🟡 WATCH level line',         /🟡 WATCH level/.test(wta));
  ok('Where to Act has 🟠 CAUTION zone line',        /🟠 CAUTION zone/.test(wta));
  ok('Where to Act has 🔴 Invalidation line',        /🔴.+Invalidation.+\*\*[\d.,]+\*\*/.test(wta));
  ok('Where to Act has 🔵 Next review line',         /🔵 Next review/.test(wta));
  // Operator B8: no single-line "🛑 RISK-OFF" reduction.
  ok('Where to Act does NOT use v1.2.1 single-line "🛑 RISK-OFF"', !/^🛑 RISK-OFF /m.test(wta));
}

// ============================================================
// T11 — Direction + Move Type + Mover Stage discipline
// ============================================================
console.log('\n[T11] Direction + Move Type + Mover Stage discipline');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early'),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES, 2400, 'early'),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, { now: Date.parse('2026-05-13T12:00:00Z') });
  const e0 = out.messages[1].embeds[0];
  const e1 = out.messages[2].embeds[0];
  const dir0 = e0.fields.find(f => f.name === 'Direction').value;
  const dir1 = e1.fields.find(f => f.name === 'Direction').value;
  // v6 doctrine: "[[Long ▲]](url) — expecting price to keep moving up"
  ok('Bullish direction emits [[Long ▲]] link',  /\[\[Long ▲\]\]\(http/.test(dir0));
  ok('Bearish direction emits [[Short ▼]] link', /\[\[Short ▼\]\]\(http/.test(dir1));
  // Move type
  const mt0 = e0.fields.find(f => f.name === 'Move Type').value;
  const mt1 = e1.fields.find(f => f.name === 'Move Type').value;
  ok('Move Type bullish early = "Breakout · early stage"',  /^Breakout · early stage$/.test(mt0));
  ok('Move Type bearish early = "Breakdown · early stage"', /^Breakdown · early stage$/.test(mt1));
}

// ============================================================
// T12 — Banner — red NEW divider + gold banners + terminology + Market Mood
// ============================================================
console.log('\n[T12] Banner — red NEW divider + gold DARK HORSE banner + EXPANDED TERMINOLOGY HYPERLINKS + Market Mood 5-disc block + STANDOUTS banner');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early')];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
  });
  const banner = out.messages[0].content;
  ok('banner opens with red NEW divider (```diff fence)', /^```diff\n-/.test(banner));
  ok('banner has "N E W   D A R K   H O R S E   S C A N" line', /N E W   D A R K   H O R S E   S C A N/.test(banner));
  ok('banner has 🆕 markers around scan stamp', /🆕[\s\S]*33 markets scanned[\s\S]*🆕/.test(banner));
  ok('banner has 🐎 DARK HORSE — GLOBAL MOVER RADAR section banner', /🐎  DARK HORSE — GLOBAL MOVER RADAR/.test(banner));
  ok('banner has EXPANDED TERMINOLOGY HYPERLINKS heading', /EXPANDED TERMINOLOGY HYPERLINKS/.test(banner));
  ok('banner points to terminology panel', /terminology panel/.test(banner));
  ok('banner has Market Mood 5-disc bar', /Market Mood {2}·\s*(🟢|🟡|🟠|🔴)+⚫* ?\d+\/5/.test(banner));
  ok('banner has Dollars-first guidance subsection', /Dollars-first guidance/.test(banner));
  ok('banner has ⭐ STANDOUTS banner',  /⭐  STANDOUTS — TODAY'S STRONGEST MOVERS/.test(banner));
  ok('banner has lifecycle colour key', /Colour key: 🟨 initial standout today/.test(banner));
  // No legacy v1.2.1 subheading
  ok('NO v1.2.1 "▸  Today\'s read" subheading',  !/▸  Today's read/.test(banner));

  const liveCountOut = foh.buildDarkHorseFohPayload({ top10, allCount: 4 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-13T12:00:00Z'),
    universeSize: 33,
  });
  ok('banner uses engine universeSize over ranking.allCount for "markets scanned"',
     /33 markets scanned/.test(liveCountOut.messages[0].content)
     && !/4 markets scanned/.test(liveCountOut.messages[0].content));
}

// ============================================================
// T13 — Sanitiser walker preserves shape
// ============================================================
console.log('\n[T13] Sanitiser walker preserves message shape');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early')];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, {});
  const wrapped = foh.sanitiseFohMessages(out.messages, ({ content }) => ({ content, replaced: false }));
  ok('sanitised payload preserves message count', wrapped.messages.length === out.messages.length);
  ok('sanitised first message preserves embeds', Array.isArray(wrapped.messages[1].embeds) && wrapped.messages[1].embeds.length === 1);
  ok('sanitised replaced flag = false when sanitize is identity', wrapped.replaced === false);
}

// ============================================================
// T14 — Lifecycle badge — FRESH yellow, carryovers age-coloured
// ============================================================
console.log('\n[T14] Lifecycle badges — FRESH/STILL ACTIVE/FADING — no dashed "── NEW ──"');
{
  const top10 = [
    mkRanked('A', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,   1.10, 'early'),
    mkRanked('B', 8, 'Bullish', rank.SECTIONS.INDICES,     19000, 'mid'),
    mkRanked('C', 7, 'Bullish', rank.SECTIONS.EQUITIES,    900,   'late'),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, { now: Date.parse('2026-05-13T12:00:00Z') });
  // FRESH = Discord-native yellow boxed code block
  ok('FRESH separator uses yellow boxed code block',  /^```\n🟨🟨  FRESH/m.test(out.messages[1].content));
  ok('FRESH separator contains "FRESH" label',           /FRESH/.test(out.messages[1].content));
  // STILL ACTIVE = aged validity colour block with first-logged detail
  ok('STILL ACTIVE separator uses aged validity colour block', /^```\n(?:🟧🟧|🟪🟪|🟥🟥)  STILL ACTIVE · VALIDITY DAY \d+/m.test(out.messages[2].content));
  ok('STILL ACTIVE separator includes first-logged age', /First logged \d{2}\/\d{2}\/\d{2} \d{2}:\d{2} UTC · still Dark Horse-worthy after/.test(out.messages[2].content));
  // FADING = Discord-native red boxed code block
  ok('FADING separator uses red boxed code block', /^```\n🟥🟥  FADING · VALIDITY FADING/m.test(out.messages[3].content));
  ok('FADING separator contains "FADING" label',         /FADING/.test(out.messages[3].content));
  // No dashed text fallback anywhere
  const allText = out.messages.map(m => (m.content || '') + JSON.stringify(m.embeds || '')).join('\n');
  ok('no dashed "── NEW ──" text anywhere',              !/─── NEW ───/.test(allText));
}

// ============================================================
// T15 — BUILDING + Chart Reference message
// ============================================================
console.log('\n[T15] BUILDING + Chart Reference present as its own message');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early')];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, { now: Date.parse('2026-05-13T12:00:00Z') });
  const refMsg = out.messages[out.messages.length - 2];
  ok('BUILDING content present in ref message', /BUILDING — WARMING UP BELOW STANDOUT GRADE/.test(refMsg.content));
  ok('CHART REFERENCE banner present in ref message', /CHART REFERENCE/.test(refMsg.content));
  ok('Reference embed title = "📚  Clean Bullish Breakout — Reference"', refMsg.embeds[0].title === '📚  Clean Bullish Breakout — Reference');
  const refFieldNames = refMsg.embeds[0].fields.map(f => f.name);
  ok('Reference embed field "What you are looking at" present',         refFieldNames.includes('What you are looking at'));
  ok('Reference embed field "How a trader acts" present',               refFieldNames.includes('How a trader acts (concrete, dollars-first)'));
  ok('Reference embed field "Rendered ATLAS chart card" present',       refFieldNames.includes('Rendered ATLAS chart card'));
  ok('Reference embed carries chart-card spec for PNG attachment lane',  !!refMsg.embeds[0].chartCard);
}

// ============================================================
// T15b — Chart-card PNG attachment rendering
// ============================================================
console.log('\n[T15b] Chart-card specs render to Discord attachment images');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,    1.10, 'early'),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES,  2400, 'mid'),
    mkRanked('NVDA',   7, 'Bullish', rank.SECTIONS.EQUITIES,     900,  'late'),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, { now: Date.parse('2026-05-13T12:00:00Z') });
  ok('candidate embeds carry chart-card specs before transport render',
     out.messages.slice(1, 4).every(m => m.embeds && m.embeds[0] && m.embeds[0].chartCard));
  ok('candidate chart cards include visual proof annotations',
     out.messages.slice(1, 4).every(m => {
       const labels = ((m.embeds[0].chartCard && m.embeds[0].chartCard.annotations) || []).map(a => a.label);
       return labels.includes('DECISION LEVEL')
         && labels.includes('ENTRY ZONE')
         && labels.includes('WATCH LEVEL')
         && labels.includes('INVALIDATION')
         && labels.some(l => /^BREAK /.test(l))
         && labels.some(l => /DEFENDING|RETEST HELD|FAILED RECOVERY|LOWER HIGH|HIGHER LOW/.test(l));
     }));
  ok('reference chart includes break/retest/confirmation teaching labels',
     (() => {
       const ref = out.messages[out.messages.length - 2].embeds[0].chartCard;
       const labels = (ref.annotations || []).map(a => a.label);
       return ['DECISION LEVEL', 'BREAK ABOVE', 'RETEST HELD', 'CONFIRMED CLOSE', 'ENTRY ZONE', 'WATCH LEVEL', 'INVALIDATION', 'LONG IDEA']
         .every(l => labels.includes(l));
     })());
  // `renderChartCardAttachments` is async; the promise is awaited in
  // the final summary gate below.
  global.__chartAttachmentPromise = foh.renderChartCardAttachments(out.messages).then(rendered => {
    ok('renders 4 PNG chart-card attachments (3 candidates + reference)', rendered.chartCardCount === 4, rendered);
    ok('candidate chartCard internal specs are stripped before Discord POST',
       rendered.messages.slice(1, 4).every(m => !m.embeds[0].chartCard));
    ok('every rendered candidate embed points at an attachment:// PNG',
       rendered.messages.slice(1, 4).every(m => /^attachment:\/\/dh-foh-.*\.png$/.test(m.embeds[0].image && m.embeds[0].image.url)));
    ok('every rendered candidate message includes a PNG file buffer',
       rendered.messages.slice(1, 4).every(m => m.files && m.files[0] && Buffer.isBuffer(m.files[0].data) && m.files[0].data.length > 1000));
  }).catch(e => {
    ok('chart-card attachment render did not throw', false, e.message);
  });
}

// ============================================================
// T16 — Tail — Risk reminder + Briefing summary
// ============================================================
console.log('\n[T16] Tail message — Risk reminder + Briefing summary');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early'),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES, 2400, 'mid'),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, { now: Date.parse('2026-05-13T12:00:00Z') });
  const tail = out.messages[out.messages.length - 1].content;
  ok('tail has Risk reminder subheading', /Risk reminder/.test(tail));
  ok('tail has Briefing summary subheading', /Briefing summary/.test(tail));
  ok('tail has Next-scan stamp', /Next scan/.test(tail));
}

// ============================================================
// T17 — Terminology hyperlinks — visible-bracket [[Label]](url)
//        form, NEVER escaped \[Label\] form
// ============================================================
console.log('\n[T17] Terminology hyperlinks — visible-bracket [[Label]](url) form');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early')];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, { now: Date.parse('2026-05-13T12:00:00Z') });
  const allText = out.messages.map(m => {
    const parts = [m.content || ''];
    for (const e of (m.embeds || [])) {
      parts.push(e.title || '', e.description || '');
      for (const f of (e.fields || [])) parts.push(f.value || '');
      if (e.footer) parts.push(e.footer.text || '');
    }
    return parts.join('\n');
  }).join('\n');
  // Visible-bracket form present
  ok('terminology panel uses [[Decision Level]](url) form', /\[\[Decision Level\]\]\(http/.test(allText));
  ok('terminology panel includes required risk/lifecycle terms',
     /\[\[Entry Zone\]\]\(http/.test(allText)
     && /\[\[Dollar Risk\]\]\(http/.test(allText)
     && /\[\[Reward-to-Risk\]\]\(http/.test(allText)
     && /\[\[Fading Setup\]\]\(http/.test(allText)
     && /\[\[Confirmed Candle Close\]\]\(http/.test(allText));
  ok('Decision Level field uses [[Decision Level]](url)', /\[\[Decision Level\]\]\(http/.test(allText));
  // No backslash-escaped form
  ok('NO escaped \\[Label\\] form anywhere',            !/\\\[/.test(allText));
}

// ============================================================
// T18 — Dollar Risk field — lifecycle-aware header + dollar figure
// ============================================================
console.log('\n[T18] Dollar Risk — lifecycle-aware header + dollar amounts');
{
  const top10 = [
    mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,    1.10, 'early'),
    mkRanked('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES,  2400, 'mid'),
    mkRanked('NVDA',   7, 'Bullish', rank.SECTIONS.EQUITIES,     900,  'late'),
  ];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, { level: 'elevated' }, { now: Date.parse('2026-05-13T12:00:00Z') });
  const dr0 = out.messages[1].embeds[0].fields.find(f => /Dollar Risk/.test(f.name));
  const dr1 = out.messages[2].embeds[0].fields.find(f => /Dollar Risk/.test(f.name));
  const dr2 = out.messages[3].embeds[0].fields.find(f => /Dollar Risk/.test(f.name));
  ok('FRESH dollar-risk header — "half size for FRESH"',    /half size for FRESH/.test(dr0.name));
  ok('STILL ACTIVE dollar-risk header — "full size allowed (STILL ACTIVE)"', /full size allowed \(STILL ACTIVE\)/.test(dr1.name));
  ok('FADING dollar-risk header explains reduced late-stage size', /quarter-size only because this is a FADING card/.test(dr2.name));
  // Body contains dollar figures
  ok('FRESH dollar-risk body contains "$" amount',        /\$\d+/.test(dr0.value));
  ok('STILL ACTIVE dollar-risk body contains "$" amount', /\$\d+/.test(dr1.value));
  ok('FADING dollar-risk body contains "$" amount',       /\$\d+/.test(dr2.value));
  ok('dollar-risk examples are labelled model/example, not personalised advice',
     /Model example/.test(dr0.value) && /Model example/.test(dr1.value) && /Model example/.test(dr2.value));
  const fadingState = out.messages[3].embeds[0].fields.find(f => f.name === 'ATLAS execution state').value;
  ok('FADING below-2R card is not presented as normal execution',
     /REDUCED SIZE ONLY \/ NOT PRIMARY/.test(fadingState)
     && /below the 2R minimum/.test(fadingState)
     && /ATLAS 1:3 preferred/.test(fadingState));
}

// ============================================================
// T19 — WHAT TO DO NOW — numbered ① to ⑤ checklist
// ============================================================
console.log('\n[T19] WHAT TO DO NOW — numbered ① to ⑤ checklist');
{
  const top10 = [mkRanked('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS, 1.10, 'early')];
  const out = foh.buildDarkHorseFohPayload({ top10, allCount: 33 }, null, { now: Date.parse('2026-05-13T12:00:00Z') });
  const wtdn = out.messages[1].embeds[0].fields.find(f => f.name === 'WHAT TO DO NOW').value;
  for (const glyph of ['①', '②', '③', '④', '⑤']) {
    ok(`WHAT TO DO NOW contains "${glyph}" step`, wtdn.indexOf(glyph) >= 0);
  }
}

// ============================================================
// T20 — Price precision audit rows — minimum buffer doctrine
// ============================================================
console.log('\n[T20] Price precision audit — minimum buffer proof rows');
{
  const top10 = [
    mkRanked('GBPUSD', 5, 'Bearish', rank.SECTIONS.FX_MAJORS,   1.27, 'late'),
    mkRanked('GBPCAD', 5, 'Bearish', rank.SECTIONS.FX_CROSSES,  1.74, 'late'),
    mkRanked('US500',  5, 'Bullish', rank.SECTIONS.INDICES,     5200, 'mid'),
    mkRanked('GOOGL',  5, 'Bullish', rank.SECTIONS.EQUITIES,    170,  'early'),
  ];
  const rows = foh.buildPricePrecisionAuditRows({ top10, allCount: 4 }, { level: 'elevated' }, {
    now: Date.parse('2026-05-14T23:50:00Z'),
    universeSize: 35,
  });
  ok('price precision audit returns one PASS row per candidate', rows.length === 4 && rows.every(r => r.status === 'PASS'), rows);
  ok('FX rows use tight 0.0003 elevated buffer, not broad percentage range',
     rows.filter(r => /GBP/.test(r.symbol)).every(r => r.bufferUsed === '0.0003' && /^1\.\d{4}–1\.\d{4}$/.test(r.entryZone)),
     rows);
  ok('non-FX rows carry asset-specific buffer explanations',
     /Index: tick-aware/.test(rows.find(r => r.symbol === 'US500').whyThisBuffer)
     && /Equity: tick-aware/.test(rows.find(r => r.symbol === 'GOOGL').whyThisBuffer),
     rows);
  ok('audit rows include dollar risk and R:R generated from exact bands',
     rows.every(r => /^\$\d+/.test(r.dollarRisk) && /\d\.\dR/.test(r.rewardToRisk)),
     rows);
}

// ============================================================
(async function summary() {
  if (global.__chartAttachmentPromise) await global.__chartAttachmentPromise;
  console.log(`\n[QA RESULT] ${passed} passed · ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
