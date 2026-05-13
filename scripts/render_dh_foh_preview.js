#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

// ============================================================
// scripts/render_dh_foh_preview.js
//
// FOH.1.0.1 Dark Horse — Discord-style visual prototype renderer.
//
// Self-contained preview renderer. Produces a PNG that approximates
// how Discord renders the FOH Dark Horse output. The renderer is
// NOT a Discord client — it is a faithful local mock that captures:
//
//   - Discord dark-theme background
//   - ```diff fenced blocks rendering with red "-" prefixed lines
//   - ```ansi fenced blocks rendering with gold / teal / red text
//     via ESC[33m / ESC[36m / ESC[31m colour codes
//   - Embeds with left colour bar + title + description + fields
//   - Inline + block fields
//   - NEW separator with NEW badge prominence
//   - Visual reference card (ASCII chart art inside ansi fence)
//
// This is the INTERIM proof artefact per the operator's
// "two-gate" acceptance: local preview PNG now → live Discord
// screenshots after staging trigger before final merge.
//
// Output: docs/screenshots/dh-foh-prototype-v1.png
//
// Hard boundary: Does NOT touch renderer.js. Does NOT touch any
// engine logic. Self-contained sample data only.
// ============================================================

const path = require('path');
const fs   = require('fs');
const puppeteer = require('puppeteer');

// ── Sample FOH visual payload ──────────────────────────────
// This is the prototype's "current sample data" per the
// operator order. It encodes every required visual element so
// the screenshot can prove all 12 acceptance items in one frame.
const ESC = '';
function ansi(code, text) { return `${ESC}[${code}m${text}${ESC}[0m`; }

const RED_NEW_DIVIDER = [
  '```diff',
  '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '- ⚡  🆕  NEW DARK HORSE SCAN  🆕  ⚡',
  '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '```',
].join('\n');

function goldSectionBox(headingText) {
  // Discord renders ESC[33m as gold/orange inside ```ansi.
  // ESC[33;1m is bold gold for extra visual weight.
  return [
    '```ansi',
    `${ESC}[33;1m╔══════════════════════════════════════════════════════╗`,
    `${ESC}[33;1m║   ${headingText.padEnd(50, ' ')}║`,
    `${ESC}[33;1m╚══════════════════════════════════════════════════════╝${ESC}[0m`,
    '```',
  ].join('\n');
}

function tealTerminologyRow(terms) {
  // Discord renders ESC[36m as cyan/teal inside ```ansi.
  const inner = terms.map(t => `${ESC}[36m[${t}]${ESC}[0m`).join('  ');
  return [
    '```ansi',
    inner,
    '```',
  ].join('\n');
}

function visualReferenceCard() {
  // Bullish breakout + retest reference. ASCII chart art inside an
  // ansi fence so the layout stays whole and the gold/teal accents
  // render.
  return [
    '```ansi',
    `${ESC}[33;1m╔══════════════════════════════════════════════════════╗`,
    `${ESC}[33;1m║   📚  CHART REFERENCE — BULLISH BREAKOUT + RETEST    ║`,
    `${ESC}[33;1m╚══════════════════════════════════════════════════════╝${ESC}[0m`,
    '',
    `${ESC}[32m  ▲ price${ESC}[0m`,
    `${ESC}[32m  │                                ╭──── continuation${ESC}[0m`,
    `${ESC}[32m  │                          ╭──╮ ╱${ESC}[0m`,
    `${ESC}[31m  │   ─────────────────────●──╯  ●${ESC}[0m  ← retest holds above old high`,
    `${ESC}[31m  │   old high  (now support)${ESC}[0m`,
    `${ESC}[32m  │            ╭──╮${ESC}[0m`,
    `${ESC}[32m  │     ╭──╮  ╱    ╲ ╱  ← breakout candle body CLOSES above${ESC}[0m`,
    `${ESC}[32m  │  ╱╲╱   ╲╱      V${ESC}[0m`,
    `${ESC}[32m  └────────────────────────────────────────▶ time${ESC}[0m`,
    '',
    `${ESC}[36m  Read:${ESC}[0m  body close above the level → calm retest →`,
    `${ESC}[36m         body stays above → continuation.${ESC}[0m`,
    `${ESC}[36m  Where to act:${ESC}[0m  buy the retest, stop just below the level.`,
    '```',
  ].join('\n');
}

const SAMPLE_MESSAGES = [
  // ── Message 1: red NEW divider + gold banner + teal terminology row + first embed ──
  {
    content: [
      RED_NEW_DIVIDER,
      '',
      goldSectionBox('🐎  DARK HORSE — GLOBAL MOVER RADAR'),
      '2026-05-13  ·  3 candidates promoted  ·  scan: 12:00 UTC',
      '',
      '📘 **Expanded Terminology Hyperlinks**',
      tealTerminologyRow(['Breakout', 'Retest', 'Continuation', 'Mover Stage 1']),
      '',
      goldSectionBox('⭐  CURRENT STANDOUTS'),
      '',
      '─── NEW ───',
    ].join('\n'),
    embeds: [{
      color: 0x2ECC71,
      title: '🐎 EURUSD · STRONG BULLISH',
      description: 'Multi-day breakout retested cleanly. Mover stage 1.',
      fields: [
        { name: 'Move Type',   value: 'Breakout · Stage 1',                                     inline: true  },
        { name: 'Direction',   value: '▲ Long',                                                  inline: true  },
        { name: 'Conviction',  value: '🟢🟢🟢🟢 / 5 · High',                                       inline: true  },
        { name: 'Trigger',     value: '1.0950 confirmed',                                        inline: true  },
        { name: 'Timeframe',   value: 'Swing (1–5d)',                                            inline: true  },
        { name: 'Where to Act', value: '🟢 ENTRY POINT: 1.0925  ·  🛑 STOP LOSS: 1.0895  ·  Buy on retest of 1.0925', inline: false },
        { name: 'Terms', value: '[Breakout]  [Retest]  [Continuation]  [Mover Stage 1]', inline: false },
      ],
      footer: { text: 'Dark Horse Radar · scan 12:00 UTC · 1/3 candidates' },
    }],
  },

  // ── Message 2: NEW separator + bearish candidate ──
  {
    content: '─── NEW ───',
    embeds: [{
      color: 0xE74C3C,
      title: '🐎 XAUUSD · STRONG BEARISH',
      description: 'Multi-day breakdown retested cleanly. Mover stage 1.',
      fields: [
        { name: 'Move Type',   value: 'Breakout · Stage 1',                                       inline: true  },
        { name: 'Direction',   value: '▼ Short',                                                   inline: true  },
        { name: 'Conviction',  value: '🔴🔴🔴🔴 / 5 · High',                                        inline: true  },
        { name: 'Trigger',     value: '2398.20 confirmed',                                         inline: true  },
        { name: 'Timeframe',   value: 'Swing (1–5d)',                                              inline: true  },
        { name: 'Where to Act', value: '🟢 ENTRY POINT: 2401.50  ·  🛑 STOP LOSS: 2410.30  ·  Sell on retest of 2401.50', inline: false },
        { name: 'Terms', value: '[Breakout]  [Retest]  [Continuation]  [Mover Stage 1]', inline: false },
      ],
      footer: { text: 'Dark Horse Radar · scan 12:00 UTC · 2/3 candidates' },
    }],
  },

  // ── Message 3: NEW separator + developing-watch candidate ──
  {
    content: '─── NEW ───',
    embeds: [{
      color: 0xF1C40F,
      title: '🐎 NVDA · DEVELOPING WATCH',
      description: 'Mature uptrend. Late-entry risk rising.',
      fields: [
        { name: 'Move Type',   value: 'Continuation · Stage 3',                                   inline: true  },
        { name: 'Direction',   value: '▲ Long',                                                    inline: true  },
        { name: 'Conviction',  value: '🟡🟡🟡🟡 / 5 · High',                                        inline: true  },
        { name: 'Trigger',     value: '925.40 · awaiting trigger',                                 inline: true  },
        { name: 'Timeframe',   value: 'Intraday',                                                  inline: true  },
        { name: 'Where to Act', value: '🟢 ENTRY POINT: 921.10  ·  🛑 STOP LOSS: 912.80  ·  Buy on retest of 921.10', inline: false },
        { name: 'Terms', value: '[Breakout]  [Retest]  [Continuation]  [Mover Stage 1]', inline: false },
      ],
      footer: { text: 'Dark Horse Radar · scan 12:00 UTC · 3/3 candidates · next review 12:15 UTC' },
    }],
  },

  // ── Message 4 (quiet-scan reference card surface) ──
  // Per Pack 2 + operator FOH requirement #9 / #10: visual
  // reference card area shows even when scan activity is low.
  {
    content: [
      goldSectionBox('📡  PRE-RADAR / BUILDING PRESSURE'),
      tealTerminologyRow(['Pre-Radar', 'Momentum', 'Structure']),
      '',
      '_Early developmental signals showing structure could form on the next leg._',
      '',
      visualReferenceCard(),
    ].join('\n'),
  },
];

// ── Renderer ───────────────────────────────────────────────
// Discord-style HTML/CSS that mimics the channel rendering for:
//   - dark theme background (#36393F)
//   - embed shape (color bar + dark inner box)
//   - ```diff and ```ansi code-fence colour rendering
//   - markdown bold / italic
//
// The renderer is deliberately minimal. It is faithful enough to
// prove the visual style; it is NOT a pixel-perfect Discord
// emulator. The final acceptance gate is a real Discord
// screenshot from staging.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Translate Discord ANSI inside ```ansi fences to spans with the
// matching colour. Supports the codes Discord recognises:
//   30 black · 31 red · 32 green · 33 yellow/gold · 34 blue
//   35 magenta · 36 cyan/teal · 37 white
//   1 bold · 4 underline · 0 reset
const ANSI_FG = {
  30: '#4F545C', 31: '#ED4245', 32: '#23A55A', 33: '#FAA61A',
  34: '#5865F2', 35: '#EB459E', 36: '#5BC0DE', 37: '#FFFFFF',
};
function renderAnsiBlock(raw) {
  // Use the actual ESC byte to drive the parser. Discord supports
  // SGR sequences as ESC[...m. We split on ESC[ and process each
  // segment, accumulating active style.
  const segments = raw.split('[');
  let html = '';
  let openSpan = false;
  let activeColour = null;
  let activeBold = false;
  let activeUnderline = false;
  function closeSpan() {
    if (openSpan) { html += '</span>'; openSpan = false; }
  }
  function openWith(colour, bold, underline) {
    closeSpan();
    const styles = [];
    if (colour) styles.push(`color:${colour}`);
    if (bold) styles.push('font-weight:700');
    if (underline) styles.push('text-decoration:underline');
    if (styles.length) {
      html += `<span style="${styles.join(';')}">`;
      openSpan = true;
    }
  }
  html += escapeHtml(segments[0]);
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const mIdx = seg.indexOf('m');
    if (mIdx === -1) { html += escapeHtml(seg); continue; }
    const codeStr = seg.slice(0, mIdx);
    const after = seg.slice(mIdx + 1);
    const codes = codeStr.split(';').map(c => parseInt(c, 10)).filter(n => !Number.isNaN(n));
    for (const c of codes) {
      if (c === 0) { activeColour = null; activeBold = false; activeUnderline = false; }
      else if (c === 1) activeBold = true;
      else if (c === 4) activeUnderline = true;
      else if (ANSI_FG[c]) activeColour = ANSI_FG[c];
    }
    openWith(activeColour, activeBold, activeUnderline);
    html += escapeHtml(after);
  }
  closeSpan();
  return html;
}

function renderDiffBlock(raw) {
  // Lines starting with "- " render red; lines starting with "+ "
  // render green; everything else is plain. Discord uses a slightly
  // muted red/green for diff syntax highlighting.
  const lines = raw.split('\n').map(l => {
    if (l.startsWith('- ')) {
      return `<span style="color:#ED4245">${escapeHtml(l)}</span>`;
    }
    if (l.startsWith('+ ')) {
      return `<span style="color:#23A55A">${escapeHtml(l)}</span>`;
    }
    return escapeHtml(l);
  });
  return lines.join('\n');
}

// Render a single content string (markdown bits + fenced blocks).
// Order of operations:
//   1. Extract ```diff / ```ansi / ``` blocks first so their content
//      is treated as raw (no markdown bolding inside).
//   2. Render the surrounding text with simple bold / italic / NEW
//      separator handling.
function renderContent(content) {
  if (typeof content !== 'string' || content.length === 0) return '';
  const parts = [];
  const fenceRe = /```([a-zA-Z]*)\n([\s\S]*?)\n```/g;
  let lastIdx = 0;
  let m;
  while ((m = fenceRe.exec(content)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ kind: 'text', value: content.slice(lastIdx, m.index) });
    }
    parts.push({ kind: 'fence', lang: m[1].toLowerCase(), value: m[2] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < content.length) {
    parts.push({ kind: 'text', value: content.slice(lastIdx) });
  }
  return parts.map(p => {
    if (p.kind === 'fence') {
      let inner;
      if (p.lang === 'ansi') inner = renderAnsiBlock(p.value);
      else if (p.lang === 'diff') inner = renderDiffBlock(p.value);
      else inner = escapeHtml(p.value);
      return `<pre class="fence">${inner}</pre>`;
    }
    // Render bold (**...**) + line-breaks. Keep it simple.
    const escaped = escapeHtml(p.value)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // Promote --- NEW --- style separator to a centred caption row.
    const withSep = escaped.replace(
      /(^|\n)─── NEW ───(\n|$)/g,
      '$1<span class="new-sep">─── NEW ───</span>$2'
    );
    return withSep.replace(/\n/g, '<br>');
  }).join('');
}

function renderEmbed(e) {
  const colour = '#' + (e.color || 0x4F545C).toString(16).padStart(6, '0');
  const title = e.title ? `<div class="embed-title">${escapeHtml(e.title)}</div>` : '';
  const desc = e.description ? `<div class="embed-desc">${escapeHtml(e.description)}</div>` : '';
  const fields = (e.fields || []).map(f => {
    const value = (f.value || '')
      .replace(/^(🟢 ENTRY POINT:.*)$/m, '<span class="entry">$1</span>')
      .replace(/(🛑 STOP LOSS:[^·]+)/g, '<span class="stop">$1</span>')
      .replace(/(\[[^\]]+\])/g, '<span class="term-chip">$1</span>');
    return `
      <div class="embed-field ${f.inline ? 'inline' : 'block'}">
        <div class="embed-field-name">${escapeHtml(f.name)}</div>
        <div class="embed-field-value">${value}</div>
      </div>`;
  }).join('');
  const footer = e.footer && e.footer.text
    ? `<div class="embed-footer">${escapeHtml(e.footer.text)}</div>`
    : '';
  return `
    <div class="embed" style="border-left-color:${colour}">
      ${title}${desc}
      <div class="embed-fields">${fields}</div>
      ${footer}
    </div>`;
}

function renderMessage(m, idx) {
  const content = renderContent(m.content);
  const embeds = (m.embeds || []).map(renderEmbed).join('');
  return `
    <div class="message" data-idx="${idx}">
      ${content ? `<div class="message-content">${content}</div>` : ''}
      ${embeds}
    </div>`;
}

function buildHtml(messages) {
  const css = `
    body {
      margin: 0; padding: 20px;
      background: #36393F;
      color: #DCDDDE;
      font-family: "gg sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 16px; line-height: 1.4;
    }
    .channel {
      max-width: 720px;
      margin: 0 auto;
      background: #36393F;
    }
    .channel-header {
      border-bottom: 1px solid #2F3136;
      padding-bottom: 12px;
      margin-bottom: 24px;
      color: #B9BBBE;
      font-size: 14px;
      display: flex; gap: 8px; align-items: center;
    }
    .channel-header .hash { color: #72767D; font-size: 22px; font-weight: 600; }
    .channel-header .name { color: #FFFFFF; font-weight: 600; }
    .message {
      padding: 8px 0 8px 56px;
      position: relative;
      margin-bottom: 4px;
    }
    .message::before {
      content: ""; position: absolute; left: 12px; top: 8px;
      width: 32px; height: 32px; border-radius: 50%;
      background: linear-gradient(135deg, #5865F2, #EB459E);
    }
    .message::after {
      content: "ATLAS  ·  Dark Horse Radar";
      position: absolute; left: 56px; top: -4px;
      color: #FFFFFF; font-weight: 600; font-size: 15px;
    }
    .message-content {
      margin-top: 18px;
      color: #DCDDDE;
      white-space: normal;
      word-break: break-word;
    }
    .message-content pre.fence {
      background: #2F3136;
      border-radius: 4px;
      padding: 8px 10px;
      margin: 6px 0;
      font-family: Consolas, "Andale Mono WT", "Andale Mono", "Lucida Console", "Lucida Sans Typewriter", "DejaVu Sans Mono", "Bitstream Vera Sans Mono", "Liberation Mono", "Nimbus Mono L", Monaco, "Courier New", Courier, monospace;
      font-size: 13.5px;
      line-height: 1.35;
      color: #B9BBBE;
      white-space: pre;
      overflow-x: auto;
    }
    .new-sep {
      display: block;
      text-align: center;
      color: #ED4245;
      font-weight: 700;
      letter-spacing: 2px;
      margin: 14px 0;
      font-family: Consolas, monospace;
    }
    .embed {
      max-width: 520px;
      margin-top: 8px;
      background: #2F3136;
      border-left: 4px solid #4F545C;
      border-radius: 4px;
      padding: 10px 14px 12px;
    }
    .embed-title {
      color: #FFFFFF;
      font-weight: 700;
      font-size: 15px;
      margin-bottom: 6px;
    }
    .embed-desc {
      color: #DCDDDE;
      font-size: 14px;
      margin-bottom: 8px;
    }
    .embed-fields {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px 16px;
    }
    .embed-field.block { grid-column: 1 / -1; }
    .embed-field.inline { grid-column: span 1; }
    .embed-field-name {
      color: #FFFFFF;
      font-weight: 700;
      font-size: 13px;
      margin-bottom: 2px;
    }
    .embed-field-value {
      color: #DCDDDE;
      font-size: 14px;
    }
    .embed-field-value .entry { color: #23A55A; font-weight: 700; }
    .embed-field-value .stop { color: #ED4245; font-weight: 700; }
    .embed-field-value .term-chip {
      color: #5BC0DE;
      font-weight: 700;
    }
    .embed-footer {
      color: #72767D;
      font-size: 12px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #40444B;
    }
  `;
  const messagesHtml = messages.map(renderMessage).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>FOH.1.0.1 Dark Horse — Visual Prototype v1</title>
<style>${css}</style></head>
<body>
<div class="channel">
  <div class="channel-header">
    <span class="hash">#</span>
    <span class="name">dark-horse-radar</span>
    <span style="margin-left:auto;color:#72767D">FOH.1.0.1 prototype · sample data</span>
  </div>
  ${messagesHtml}
</div>
</body></html>`;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const html = buildHtml(SAMPLE_MESSAGES);
  const htmlPath = path.join(outDir, 'dh-foh-prototype-v1.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready').catch(() => {});

    const bodyHandle = await page.$('body');
    const box = await bodyHandle.boundingBox();
    await page.setViewport({
      width: 800,
      height: Math.max(800, Math.ceil(box.height + 40)),
      deviceScaleFactor: 2,
    });

    const pngPath = path.join(outDir, 'dh-foh-prototype-v1.png');
    await page.screenshot({ path: pngPath, fullPage: true });
    console.log('Wrote:', pngPath);
    console.log('Wrote:', htmlPath);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
