#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/preview_dh_foh_v6_live.js
//
// Live-path preview of Dark Horse FOH.1.0.1 (v6 PROTOTYPE
// PARITY). Drives `darkHorseFoh.buildDarkHorseFohPayload`
// against a representative multi-candidate fixture and asserts
// the rendered messages against every locked v6 marker from
// `docs/screenshots/dh-foh-v6-gallery.md` + the canonical
// SAMPLE_MESSAGES at `scripts/render_dh_foh_v6_preview.js`.
//
// ──────────────────────────────────────────────────────────
// ACCEPTANCE REALIGNMENT NOTE (operator directive, 2026-05-14)
// ──────────────────────────────────────────────────────────
// Previous build of this preview asserted the FOH.1.2.1
// INTERMEDIATE marker set (banner subheadings "▸ Today's read"
// / "▸ Market mood", single-line "🛑 RISK-OFF" Where-to-Act,
// conviction without ⚫ inactive disc, "STANDOUT #N of M"
// red ```diff badge per candidate). Per PR #73 doctrine and
// operator-confirmed B8–B14 + D directives, the canonical v6
// target is `scripts/render_dh_foh_v6_preview.js::SAMPLE_MESSAGES`.
//
// A live-path output that passed v1.2.1 markers but failed
// canonical v6 was a false pass. This script was rewritten on
// the restoration branch to enforce the canonical v6 shape.
//
// Run:
//   node scripts/preview_dh_foh_v6_live.js          # summary
//   node scripts/preview_dh_foh_v6_live.js --full   # dump every message
// ============================================================

const path = require('path');
const rank = require(path.join(__dirname, '..', 'darkHorseRanking.js'));
const foh  = require(path.join(__dirname, '..', 'darkHorseFoh.js'));

function dailyCandles(n, base) {
  const out = []; let p = base;
  const t = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);
  const step = base >= 1000 ? 0.6 : base >= 100 ? 0.8 : base >= 10 ? 0.2 : 0.00025;
  for (let i = 0; i < n; i++) {
    const o = p, c = p + step, h = c + step * 0.7, l = o - step * 0.5;
    out.push({ open: o, high: h, low: l, close: c, time: t + i * 86400 });
    p = c;
  }
  return out;
}
function mk(sym, score, dir, sec, base, phase) {
  const e = rank.enrichCandidate(
    { symbol: sym, score, direction: dir, summary: 'higher highs and higher lows', reasons: ['structure 2/2'] },
    dailyCandles(25, base),
    6, { watchThreshold: 8 }
  );
  e.section = sec;
  e.sectionLabel = rank.SECTION_LABEL[sec];
  if (phase) e.movePhase = phase;
  if (phase === 'mid') {
    e.firstSeenAt = Date.parse('2026-05-11T07:40:00Z');
    e.activeCycleCount = 24;
  }
  if (phase === 'late') {
    e.firstSeenAt = Date.parse('2026-05-10T12:00:00Z');
    e.activeCycleCount = 40;
  }
  return e;
}

const top10 = [
  mk('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,    1.10,  'early'),
  mk('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES,  2400,  'mid'),
  mk('NVDA',   7, 'Bullish', rank.SECTIONS.EQUITIES,     900,   'late'),
];
const payload = foh.buildDarkHorseFohPayload(
  { top10, allCount: 33 },
  { level: 'elevated' },
  { now: Date.parse('2026-05-13T12:00:00Z') }
);

const m = payload.messages;
const m1 = m[0].content;
const m2 = m[1];  // FRESH candidate
const m3 = m[2];  // STILL ACTIVE candidate
const m4 = m[3];  // FADING candidate
const m5 = m[4];  // BUILDING + Chart Reference
const tail = m[m.length - 1].content;
const allText = m.map(x => {
  const parts = [x.content || ''];
  for (const e of (x.embeds || [])) {
    parts.push(e.title || '', e.description || '');
    for (const f of (e.fields || [])) parts.push(f.value || '');
    if (e.footer) parts.push(e.footer.text || '');
  }
  return parts.join('\n');
}).join('\n');

const e2 = m2.embeds[0];
const e3 = m3.embeds[0];
const e4 = m4.embeds[0];
const e2WhereToActFields = e2.fields.filter(f => /^Where to Act/.test(f.name));
const e2WhereToAct = e2WhereToActFields.map(f => f.value).join('\n\n');

// ── v6 canonical markers ─────────────────────────────────────
const checks = [
  // Payload shape
  ['kind === movement_digest_foh_v1_0', payload.kind === 'movement_digest_foh_v1_0'],
  ['candidateCount === 3',              payload.candidateCount === 3],
  ['embedCount === 3',                  payload.embedCount === 3],
  ['messages.length === 6 (banner + 3 candidates + ref + tail)', m.length === 6],

  // M1 banner — v6 doctrine
  ['M1 opens with red NEW divider (```diff fence)', /^```diff\n-\s+━{30,}/.test(m1)],
  ['M1 contains "N E W   D A R K   H O R S E   S C A N"', /N E W   D A R K   H O R S E   S C A N/.test(m1)],
  ['M1 has 🆕 markers around scan stamp + universe size',  /🆕[\s\S]+?33 markets scanned[\s\S]+?🆕/.test(m1)],
  ['M1 has gold 🐎 DARK HORSE — GLOBAL MOVER RADAR banner', /🐎  DARK HORSE — GLOBAL MOVER RADAR/.test(m1)],
  ['M1 has standout count line ("3 standouts found")',     /3 standouts? found this cycle/.test(m1)],
  ['M1 has lifecycle decomposition (fresh / still active / fading)',
    /\d+ fresh.*\d+ still active.*\d+ fading/.test(m1)],
  ['M1 has 📘 EXPANDED TERMINOLOGY HYPERLINKS heading',     /📘 \*\*EXPANDED TERMINOLOGY HYPERLINKS\*\*/.test(m1)],
  ['M1 points to terminology panel', /terminology panel/.test(m1)],
  ['M1 terminology embed has required visible-bracket terms',
    /\[\[Decision Level\]\]\(http/.test(allText)
    && /\[\[Entry Zone\]\]\(http/.test(allText)
    && /\[\[Dollar Risk\]\]\(http/.test(allText)
    && /\[\[Reward-to-Risk\]\]\(http/.test(allText)
    && /\[\[Confirmed Candle Close\]\]\(http/.test(allText)],
  ['M1 has Market Mood 5-disc bar',  /Market Mood {2}·\s*(🟢|🟡|🟠|🔴)+⚫* ?\d+\/5/.test(m1)],
  ['M1 Market Mood block carries Dollars-first guidance', /Dollars-first guidance/.test(m1)],
  ['M1 has ⭐ STANDOUTS — TODAY\'S STRONGEST MOVERS banner', /⭐  STANDOUTS — TODAY'S STRONGEST MOVERS/.test(m1)],
  ['no legacy v1.2.1 "▸ Today\'s read" subheading',         !/▸  Today's read/.test(m1)],

  // Lifecycle separators on M2 / M3 / M4
  ['M2 lifecycle separator names "FRESH"',         /FRESH/.test(m2.content)],
  ['M2 lifecycle separator says STANDOUT #1 of 3', /STANDOUT #1 of 3/.test(m2.content)],
  ['M2 lifecycle separator uses yellow boxed code block', /^```\n🟨🟨  FRESH/m.test(m2.content)],
  ['M3 lifecycle separator names "STILL ACTIVE"',  /STILL ACTIVE/.test(m3.content)],
  ['M3 lifecycle separator says STANDOUT #2 of 3', /STANDOUT #2 of 3/.test(m3.content)],
  ['M3 lifecycle separator uses aged validity colour block', /^```\n(?:🟧🟧|🟪🟪|🟥🟥)  STILL ACTIVE · VALIDITY DAY \d+/m.test(m3.content)],
  ['M3 lifecycle separator includes first-logged age', /First logged \d{2}\/\d{2}\/\d{2} \d{2}:\d{2} UTC · still Dark Horse-worthy after/.test(m3.content)],
  ['M4 lifecycle separator names "FADING"',        /FADING/.test(m4.content)],
  ['M4 lifecycle separator says STANDOUT #3 of 3', /STANDOUT #3 of 3/.test(m4.content)],
  ['M4 lifecycle separator uses red boxed code block', /^```\n🟥🟥  FADING · VALIDITY FADING/m.test(m4.content)],
  ['no dashed "── NEW ──" text anywhere',          !/─── NEW ───/.test(allText)],

  // Embed structure — v6 canonical fields
  ['M2 embed.title format: "🐎  SYM  ·  <state-badge>"',    /^🐎  EURUSD  ·  /.test(e2.title)],
  ['M2 embed.title ends with state-badge from allow-list',  foh.STATE_BADGE_VALUES.has(e2.title.replace(/^🐎  [A-Z0-9]+  ·  /, ''))],
  ['M2 description is the FRESH narrative ("new this scan")', /new this scan/.test(e2.description)],
  ['M2 has "Move Type" field',                               e2.fields.some(f => f.name === 'Move Type')],
  ['M2 has "Direction" field',                               e2.fields.some(f => f.name === 'Direction')],
  ['M2 has "Conviction" field',                              e2.fields.some(f => f.name === 'Conviction')],
  ['M2 has "ATLAS execution state" field',                   e2.fields.some(f => f.name === 'ATLAS execution state')],
  ['M2 has "ATLAS confirmation gate" field',                 e2.fields.some(f => f.name === 'ATLAS confirmation gate')],
  ['M2 has "Decision Level" field',                          e2.fields.some(f => f.name === 'Decision Level')],
  ['M2 NO "Trigger Level" field',                            !e2.fields.some(f => f.name === 'Trigger Level')],
  ['M2 has "Expected Duration" field (renamed from Horizon)', e2.fields.some(f => f.name === 'Expected Duration')],
  ['M2 NO "Horizon" field',                                  !e2.fields.some(f => f.name === 'Horizon')],
  ['M2 has "Today\'s Rank" field',                           e2.fields.some(f => f.name === "Today's Rank")],
  ['M2 has "Validity" field',                               e2.fields.some(f => f.name === 'Validity')],
  ['M2 has "Where to Act" field',                            e2.fields.some(f => f.name === 'Where to Act')],
  ['M2 has "💲 Dollar Risk" field',                          e2.fields.some(f => /^💲 Dollar Risk/.test(f.name))],
  ['M2 has "What this means" field',                         e2.fields.some(f => f.name === 'What this means')],
  ['M2 has "WHAT TO DO NOW" field',                          e2.fields.some(f => f.name === 'WHAT TO DO NOW')],
  ['M2 has "What confirms the idea" field',                  e2.fields.some(f => f.name === 'What confirms the idea')],
  ['M2 has "What cancels the idea" field',                   e2.fields.some(f => f.name === 'What cancels the idea')],
  ['M2 has "Source proof" field',                            e2.fields.some(f => f.name === 'Source proof')],
  ['M2 carries chart-card spec for PNG attachment lane',      !!e2.chartCard],
  ['M3 carries chart-card spec for PNG attachment lane',      !!e3.chartCard],
  ['M4 carries chart-card spec for PNG attachment lane',      !!e4.chartCard],
  ['M2 chart card carries visual proof annotations',
    ['DECISION LEVEL', 'ENTRY ZONE', 'WATCH LEVEL', 'INVALIDATION'].every(l => (e2.chartCard.annotations || []).some(a => a.label === l))
    && (e2.chartCard.annotations || []).some(a => /^BREAK /.test(a.label))
    && (e2.chartCard.annotations || []).some(a => /DEFENDING|RETEST HELD|FAILED RECOVERY/.test(a.label))],

  // Conviction — 5-disc + ⚫ inactive + Why-X reasoning
  ['Conviction value uses 5-disc with ⚫ inactive disc OR full-fill',
    /(🟢|🔴|🟡|🟠|⚪)+⚫? ?\d+\/5 — (Low|Medium|High|Very High)/.test(e2.fields.find(f => f.name === 'Conviction').value)],
  ['Conviction value contains "Why X" reasoning underneath',
    /_Why (Low|Medium|High|Very High): /.test(e2.fields.find(f => f.name === 'Conviction').value)],

  // Direction — v6 link form
  ['Direction field uses [[Long ▲]](url) link form',
    /\[\[Long ▲\]\]\(http/.test(e2.fields.find(f => f.name === 'Direction').value)],
  ['Direction field has narrative tail ("expecting price to keep moving up")',
    /expecting price to keep moving up/.test(e2.fields.find(f => f.name === 'Direction').value)],

  // Decision Level — Why it matters narrative
  ['Decision Level value uses [[Decision Level]](url) link form',
    /\[\[Decision Level\]\]\(http/.test(e2.fields.find(f => f.name === 'Decision Level').value)],
  ['Decision Level value contains "Why it matters" narrative line',
    /_Why it matters: /.test(e2.fields.find(f => f.name === 'Decision Level').value)],

  // Expected Duration — renamed field
  ['Expected Duration field uses [[Expected Duration]](url) link form',
    /\[\[Expected Duration\]\]\(http/.test(e2.fields.find(f => f.name === 'Expected Duration').value)],

  // Today's Rank — Cycle Rank link form
  ['Today\'s Rank value uses [[Cycle Rank]](url) link form',
    /\[\[Cycle Rank\]\]\(http/.test(e2.fields.find(f => f.name === "Today's Rank").value)],
  ['Today\'s Rank ordinal "1st of today\'s 3 standouts"',
    /1st of today's 3 standouts/.test(e2.fields.find(f => f.name === "Today's Rank").value)],

  // Where to Act — 4-zone block
  ['Where to Act fields are split under Discord 1024-char cap',
    e2WhereToActFields.length >= 2 && e2WhereToActFields.every(f => f.value.length <= foh.DISCORD_FIELD_VALUE_LIMIT)],
  ['Where to Act has 🟢 ENTRY zone line',  /🟢 ENTRY zone/.test(e2WhereToAct)],
  ['Where to Act has 🟡 WATCH level line', /🟡 WATCH level/.test(e2WhereToAct)],
  ['Where to Act has 🟠 CAUTION zone line', /🟠 CAUTION zone/.test(e2WhereToAct)],
  ['Where to Act has 🔴 Invalidation line', /🔴.+Invalidation.+\*\*[\d.,]+\*\*/.test(e2WhereToAct)],
  ['Where to Act has 🔵 Next review line', /🔵 Next review/.test(e2WhereToAct)],
  ['Where to Act does NOT use v1.2.1 single-line "🛑 RISK-OFF"',
    !/^🛑 RISK-OFF /m.test(e2WhereToAct)],

  // Dollar Risk — lifecycle-aware
  ['M2 (FRESH) Dollar Risk header — "half size for FRESH"',
    /half size for FRESH/.test(e2.fields.find(f => /Dollar Risk/.test(f.name)).name)],
  ['M3 (STILL ACTIVE) Dollar Risk header — "full size allowed (STILL ACTIVE)"',
    /full size allowed \(STILL ACTIVE\)/.test(e3.fields.find(f => /Dollar Risk/.test(f.name)).name)],
  ['M4 (FADING) Dollar Risk header explains reduced late-stage size',
    /quarter-size only because this is a FADING card/.test(e4.fields.find(f => /Dollar Risk/.test(f.name)).name)],
  ['M4 FADING execution state is reduced-size/not primary below 2R',
    /REDUCED SIZE ONLY \/ NOT PRIMARY/.test(e4.fields.find(f => f.name === 'ATLAS execution state').value)
    && /below the 2R minimum/.test(e4.fields.find(f => f.name === 'ATLAS execution state').value)],

  // WHAT TO DO NOW — ① ② ③ ④ ⑤ checklist
  ['WHAT TO DO NOW contains ① to ⑤ numbered steps',
    ['①', '②', '③', '④', '⑤'].every(g => e2.fields.find(f => f.name === 'WHAT TO DO NOW').value.indexOf(g) >= 0)],

  // FADING — late-stage risk explanation present
  ['FADING embed has ⚠️ Late-stage risk note field',
    e4.fields.some(f => /Late-stage risk note/.test(f.name))],

  // M5 — BUILDING + Chart Reference
  ['M5 contains BUILDING heading "WARMING UP BELOW STANDOUT GRADE"', /WARMING UP BELOW STANDOUT GRADE/.test(m5.content)],
  ['M5 contains CHART REFERENCE heading "HOW TO READ THE FOUR ZONES"', /HOW TO READ THE FOUR ZONES/.test(m5.content)],
  ['M5 has reference embed titled "Clean Bullish Breakout — Reference"', /Clean Bullish Breakout — Reference/.test(m5.embeds[0].title)],
  ['M5 reference embed has "What you are looking at" field', m5.embeds[0].fields.some(f => f.name === 'What you are looking at')],
  ['M5 reference embed carries chart-card spec for PNG attachment lane', !!m5.embeds[0].chartCard],
  ['M5 reference chart carries break/retest/confirmation labels',
    ['DECISION LEVEL', 'BREAK ABOVE', 'RETEST HELD', 'CONFIRMED CLOSE', 'ENTRY ZONE', 'WATCH LEVEL', 'INVALIDATION', 'LONG IDEA']
      .every(l => (m5.embeds[0].chartCard.annotations || []).some(a => a.label === l))],
  ['M5 reference embed does not call chart images a future lane', !/Future scans|next evolution|to be replaced/i.test(m5.embeds[0].fields.map(f => f.value).join('\n') + '\n' + (m5.embeds[0].footer && m5.embeds[0].footer.text || ''))],

  // Tail
  ['tail has Risk reminder subheading', /Risk reminder/.test(tail)],
  ['tail has Briefing summary subheading', /Briefing summary/.test(tail)],
  ['tail has "Next scan" line', /Next scan/.test(tail)],

  // Footer on last candidate carries next-review stamp
  ['last candidate footer carries "next review YYYY-MM-DD HH:MM UTC"',
    /next review \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(e4.footer.text)],

  // No backslash-escaped bracket links anywhere
  ['NO escaped \\[Label\\] form anywhere',                       !/\\\[/.test(allText)],
  ['NO literal "{{entry:" token leak (Discord-strip pass ran)',  !/\{\{entry:/.test(allText)],
  ['NO literal "{{watch:" token leak',                           !/\{\{watch:/.test(allText)],
  ['NO literal "{{invalid:" token leak',                         !/\{\{invalid:/.test(allText)],
  ['NO literal "{{money:" token leak',                           !/\{\{money:/.test(allText)],
  ['NO literal "{{caution:" token leak',                         !/\{\{caution:/.test(allText)],
  ['NO literal "[[NEW_BADGE:" token leak',                       !/\[\[NEW_BADGE:/.test(allText)],
];

// Discord size guards
for (let i = 0; i < m.length; i++) {
  const meas = foh.measureMessage(m[i]);
  checks.push([`M${i + 1} content ≤ 2000 chars (got ${meas.contentLen})`, meas.contentLen <= foh.DISCORD_CONTENT_LIMIT]);
  for (let j = 0; j < meas.embedTotals.length; j++) {
    checks.push([`M${i + 1} embed ${j + 1} total ≤ 6000 (got ${meas.embedTotals[j]})`, meas.embedTotals[j] <= foh.DISCORD_EMBED_TOTAL_LIMIT]);
  }
  const violations = foh.findDiscordLimitViolations(m[i]);
  checks.push([`M${i + 1} has no Discord field-level limit violations`, violations.length === 0]);
}

// Banned-wording sweep
const hits = foh.sweepBannedWording(m);
checks.push(['banned-wording sweep returns zero hits across entire payload', hits.length === 0]);
for (const re of [/\bbody close\b/i, /\bbreak and hold\b/i, /\bretest holds\b/i, /\bread weakens\b/i, /\bLearning Links?\b/i, /\bBOS\b/, /\bCHoCH\b/]) {
  checks.push([`banned wording absent: ${re}`, !re.test(allText)]);
}

console.log('=== DARK HORSE FOH v6 — LIVE-PATH PARITY PREVIEW ===');
console.log(`Messages produced: ${m.length}`);
console.log(`Candidate embeds:  ${payload.embedCount}`);
console.log(`Filtered out (no anchors): ${payload.filteredOut}`);
console.log(`Link routing status: ${payload.linkRoutingStatus}`);
console.log('');

let pass = 0, fail = 0;
for (const [label, ok] of checks) {
  if (ok) pass++; else fail++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}`);
}

console.log('');
console.log(fail === 0
  ? `[PREVIEW RESULT] PASS — ${pass}/${pass} canonical v6 markers green. Live-path output matches the locked v6 prototype.`
  : `[PREVIEW RESULT] FAIL — ${fail} of ${pass + fail} markers missing.`);

if (process.argv.includes('--full')) {
  for (let i = 0; i < m.length; i++) {
    const meas = foh.measureMessage(m[i]);
    console.log('');
    console.log(`========== MESSAGE ${i + 1}/${m.length} (content=${meas.contentLen} chars, embeds=${meas.embedTotals.length}) ==========`);
    if (m[i].content) console.log(m[i].content);
    if (m[i].embeds) {
      for (let j = 0; j < m[i].embeds.length; j++) {
        const e = m[i].embeds[j];
        console.log(`-- EMBED ${j + 1} (total=${meas.embedTotals[j]} chars, color=0x${e.color.toString(16)}) --`);
        console.log(`  title:       ${e.title}`);
        console.log(`  description: ${e.description}`);
        for (const f of (e.fields || [])) {
          console.log(`  [${f.name}]: ${(f.value || '').replace(/\n/g, '\n              ')}`);
        }
        if (e.footer) console.log(`  footer:      ${e.footer.text}`);
      }
    }
  }
}

process.exit(fail === 0 ? 0 : 1);
