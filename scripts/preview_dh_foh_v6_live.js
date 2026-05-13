#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/preview_dh_foh_v6_live.js
//
// Live-path preview of the Dark Horse FOH.1.0.1 (v6 parity) wire-up.
// Drives the production module darkHorseFoh.buildDarkHorseFohPayload
// against a representative multi-candidate fixture, then asserts the
// rendered messages against every locked v6 marker from
// docs/screenshots/dh-foh-v6-gallery.md.
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
  for (let i = 0; i < n; i++) {
    const o = p, c = p + 0.6, h = c + 0.4, l = o - 0.3;
    out.push({ open: o, high: h, low: l, close: c, time: t + i * 86400 });
    p = c;
  }
  return out;
}
function mk(sym, score, dir, sec, base) {
  const e = rank.enrichCandidate(
    { symbol: sym, score, direction: dir, summary: 'higher highs and higher lows', reasons: ['structure 2/2'] },
    dailyCandles(25, base),
    6, { watchThreshold: 8 }
  );
  e.section = sec;
  e.sectionLabel = rank.SECTION_LABEL[sec];
  return e;
}

const top10 = [
  mk('EURUSD', 9, 'Bullish', rank.SECTIONS.FX_MAJORS,   1.10),
  mk('NDX',    8, 'Bullish', rank.SECTIONS.INDICES,     19000),
  mk('NVDA',   8, 'Bullish', rank.SECTIONS.EQUITIES,    900),
  mk('XAUUSD', 8, 'Bearish', rank.SECTIONS.COMMODITIES, 2400),
];
const payload = foh.buildDarkHorseFohPayload(
  { top10, allCount: 33 },
  { level: 'elevated' },
  { now: Date.parse('2026-05-13T12:00:00Z') }
);

const m = payload.messages;
const m1 = m[0].content;
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

// ── v6 canonical markers ─────────────────────────────────────
const checks = [
  // Payload shape
  ['kind === movement_digest_foh_v1_0', payload.kind === 'movement_digest_foh_v1_0'],
  ['candidateCount === 4',              payload.candidateCount === 4],
  ['embedCount === 4',                  payload.embedCount === 4],
  ['messages.length === 5 (banner + 3 badges + tail)', m.length === 5],
  // M1 banner content — v6 doctrine
  ['M1 opens with red NEW divider (```diff fence)', /^```diff\n-\s+━{30,}/.test(m1)],
  ['M1 contains "N E W   D A R K   H O R S E   S C A N"', /N E W   D A R K   H O R S E   S C A N/.test(m1)],
  ['M1 has 🆕 markers around scan stamp + universe size',  /🆕[\s\S]+?33 markets scanned[\s\S]+?🆕/.test(m1)],
  ['M1 has gold "🐎  DARK HORSE — GLOBAL MOVER RADAR"',     /🐎  DARK HORSE — GLOBAL MOVER RADAR/.test(m1)],
  ['M1 has gold "⭐  STANDOUTS — TODAY\'S STRONGEST MOVERS"', /⭐  STANDOUTS — TODAY'S STRONGEST MOVERS/.test(m1)],
  ['M1 has ▸ Today\'s read subheading',                     /▸  Today's read/.test(m1)],
  ['M1 has ▸ Market mood subheading',                       /▸  Market mood/.test(m1)],
  ['M1 terminology row uses ```ansi cyan-chip fallback',     /```ansi\n.*\[Breakout\][\s\S]*\[Retest\][\s\S]*\[Continuation\][\s\S]*\[Mover Stage 1\]/.test(m1)],
  // Embed structure (Pack 2.2 fields)
  ['embed.title format: "🐎  SYM  ·  <state-badge>"',       /^🐎  EURUSD  ·  /.test(m[0].embeds[0].title)],
  ['embed.title ends with a state-badge from allow-list',   foh.STATE_BADGE_VALUES.has(m[0].embeds[0].title.replace(/^🐎  [A-Z0-9]+  ·  /, ''))],
  ['Conviction field uses 5-disc colour-active scale',      /(🟢|🔴|🟡|🟠)+\s\/\s5\s·\s(Low|Medium|High|Very High)/.test(m[0].embeds[0].fields.find(f => f.name === 'Conviction').value)],
  ['v6 polish: full 5-disc scale with ⚫ inactive remainder when active < 5',
    m.slice(0, -1).every(x => x.embeds.every(e => {
      const v = e.fields.find(f => f.name === 'Conviction').value;
      const activeMatch = v.match(/^(🟢|🔴|🟡|🟠)+/u);
      const active = activeMatch ? Array.from(activeMatch[0]).length : 0;
      const inactiveMatch = v.match(/⚫+/u);
      const inactive = inactiveMatch ? inactiveMatch[0].length : 0;
      return active + inactive === 5;
    }))],
  ['v6 polish: conviction discs never render as neutral ⚪ white', !m.slice(0, -1).some(x => x.embeds.some(e => /^⚪/.test(e.fields.find(f => f.name === 'Conviction').value)))],
  ['no ●/○ filler anywhere in candidate embeds',            !m.slice(0, -1).some(x => x.embeds && x.embeds.some(e => e.fields.some(f => /[●○]/.test(f.value))))],
  ['v6 polish: Direction uses plain-English translation ("Long — expecting higher prices")',
    /(Long — expecting higher prices|Short — expecting lower prices|Sideways — no clear directional bias)/.test(m[0].embeds[0].fields.find(f => f.name === 'Direction').value)],
  ['Move Type field present + in allow-list',               ['Breakout','Reversal','Range Break','Continuation'].some(t => m[0].embeds[0].fields.find(f => f.name === 'Move Type').value.startsWith(t))],
  ['Trigger Level value uses "(Above|Below) N — ..." form', /(Above|Below) \d+(\.\d+)? — /.test(m[0].embeds[0].fields.find(f => f.name === 'Trigger Level').value)],
  ['Today\'s Rank uses ordinal "Nth of today\'s K standouts"', /^1st of today's \d+ standouts?$/.test(m[0].embeds[0].fields.find(f => f.name === "Today's Rank").value)],
  ['"In ATLAS terms" / "Terms" field REMOVED',              !m[0].embeds[0].fields.some(f => /In ATLAS terms|Terms/.test(f.name))],
  // Where to Act — v6 polish
  ['v6 polish: Where to Act uses tight price range (X.XX – Y.YY), not single price',
    /^🟢 (BUY|SELL) [0-9.]+ – [0-9.]+ —/m.test(m[0].embeds[0].fields.find(f => f.name === 'Where to Act').value)],
  ['Where to Act includes 🛑 RISK-OFF line',                /^🛑 RISK-OFF at/m.test(m[0].embeds[0].fields.find(f => f.name === 'Where to Act').value)],
  ['v6 polish: RISK-OFF explains the consequence ("abandon the long/short idea")',
    /abandon the (long|short) idea/.test(m[0].embeds[0].fields.find(f => f.name === 'Where to Act').value)],
  ['v6 polish: "on the dip-and-hold" wording REMOVED',      !/on the dip-and-hold/.test(allText)],
  // WHAT TO DO NOW — mandatory v6 polish field
  ['v6 polish: WHAT TO DO NOW field present on every candidate embed',
    m.slice(0, -1).every(x => x.embeds[0].fields.some(f => f.name === 'WHAT TO DO NOW'))],
  ['WHAT TO DO NOW uses ① ② ③ ④ ⑤ numbered glyphs',
    /①[\s\S]*②[\s\S]*③[\s\S]*④[\s\S]*⑤/.test(m[0].embeds[0].fields.find(f => f.name === 'WHAT TO DO NOW').value)],
  // Red NEW BADGE separators
  ['M2 has "STANDOUT #2 of 4" red badge',                   /```diff\n-\s*🆕\s+STANDOUT #2 of 4\n```/.test(m[1].content)],
  ['M3 has "STANDOUT #3 of 4" red badge',                   /```diff\n-\s*🆕\s+STANDOUT #3 of 4\n```/.test(m[2].content)],
  ['M4 has "STANDOUT #4 of 4" red badge',                   /```diff\n-\s*🆕\s+STANDOUT #4 of 4\n```/.test(m[3].content)],
  ['no plain "─── NEW ───" text fallback anywhere',         !/─── NEW ───/.test(allText)],
  // Last embed footer carries next-review stamp
  ['last embed footer carries "next review YYYY-MM-DD HH:MM UTC"',
    /next review \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(m[3].embeds[0].footer.text)],
  // Tail — BUILDING + reference card
  ['tail has BUILDING & CHART REFERENCE red badge',         /```diff\n-\s*🆕\s+BUILDING\s+&\s+CHART REFERENCE\n```/.test(tail)],
  ['tail has 📡 BUILDING — MARKETS WARMING UP gold heading', /📡\s+BUILDING — MARKETS WARMING UP/.test(tail)],
  ['tail has 📚 CLEAN BULLISH BREAKOUT — REFERENCE card',    /📚\s+CLEAN BULLISH BREAKOUT — REFERENCE/.test(tail)],
  ['tail has ▸ Risk reminder subheading',                   /▸  Risk reminder/.test(tail)],
];

// Discord size guards
for (let i = 0; i < m.length; i++) {
  const meas = foh.measureMessage(m[i]);
  checks.push([`M${i + 1} content ≤ 2000 chars`,           meas.contentLen <= foh.DISCORD_CONTENT_LIMIT]);
  for (let j = 0; j < meas.embedTotals.length; j++) {
    checks.push([`M${i + 1} embed ${j + 1} total ≤ 6000`, meas.embedTotals[j] <= foh.DISCORD_EMBED_TOTAL_LIMIT]);
  }
}

// Banned-wording sweep
const hits = foh.sweepBannedWording(m);
checks.push(['banned-wording sweep returns zero hits across entire payload', hits.length === 0]);
for (const re of [/\bbody close\b/i, /\bbreak and hold\b/i, /\bretest holds\b/i, /\bread weakens\b/i, /\bpending\b/i, /\bunavailable\b/i, /\bLearning Links\b/i, /\bBOS\b/, /\bCHoCH\b/]) {
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
