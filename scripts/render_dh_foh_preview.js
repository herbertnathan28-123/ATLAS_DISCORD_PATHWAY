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

// v2 prototype — stronger red NEW banner with triple bar + page-width
// wing-arrows pointing at the badge so the boundary reads as a
// "change of scene", not a subtle separator. Discord renders the
// `-` prefixed lines red inside ```diff fences.
const RED_NEW_DIVIDER = [
  '```diff',
  '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '- ▼ ▼ ▼   N E W   D A R K   H O R S E   S C A N   ▼ ▼ ▼',
  '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '- 🆕   Tuesday 13 May · 12:00 UTC · 33 markets scanned   🆕',
  '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '```',
].join('\n');

function goldSectionBox(headingText) {
  // v3 — narrower, page-stable box (52 cols) so it fits cleanly on
  // iPad portrait without horizontal scroll, while still reading as
  // a banner. Bold gold (ESC[33;1m) inside ```ansi.
  return [
    '```ansi',
    `${ESC}[33;1m╔══════════════════════════════════════════════════╗`,
    `${ESC}[33;1m║   ${headingText.padEnd(46, ' ')}║`,
    `${ESC}[33;1m╚══════════════════════════════════════════════════╝${ESC}[0m`,
    '```',
  ].join('\n');
}

function goldSubheading(text) {
  // Bold-gold subheading inside an ansi fence — a level smaller than
  // the section box. Used for "Today's read" / "Market mood" rows.
  return [
    '```ansi',
    `${ESC}[33;1m▸  ${text}${ESC}[0m`,
    '```',
  ].join('\n');
}

function tealTerminologyRow(terms) {
  // Cyan/teal chips inside ```ansi. Bold for stronger weight.
  const inner = terms.map(t => `${ESC}[36;1m[${t}]${ESC}[0m`).join('  ');
  return [
    '```ansi',
    inner,
    '```',
  ].join('\n');
}

function visualReferenceCard() {
  // v3 — comfort + scale pass on the reference card.
  //   - Section box narrower (50 cols, fits iPad portrait)
  //   - Larger spacing between chart and prose
  //   - Reduced from 3 cyan-headed prose sections to 2 (collapsed
  //     "What you're seeing" + "How ATLAS reads it" into a single
  //     "The story" block so the card reads in a glance, then a
  //     "How to act" block for the practical step). Operator
  //     directive: simplify dense sections slightly.
  return [
    '```ansi',
    `${ESC}[33;1m╔════════════════════════════════════════════════╗`,
    `${ESC}[33;1m║   📚  CLEAN BULLISH BREAKOUT — REFERENCE       ║`,
    `${ESC}[33;1m╚════════════════════════════════════════════════╝${ESC}[0m`,
    '',
    `${ESC}[32m   ▲ price${ESC}[0m`,
    `${ESC}[32m   │                            ╭──── higher still${ESC}[0m`,
    `${ESC}[32m   │                      ╭──╮ ╱${ESC}[0m`,
    `${ESC}[31m   │   ─────────────────●──╯  ●${ESC}[0m   ← buyers defended`,
    `${ESC}[31m   │   ceiling, now a floor${ESC}[0m`,
    `${ESC}[32m   │          ╭──╮${ESC}[0m`,
    `${ESC}[32m   │    ╭──╮ ╱    ╲ ╱   ← pushed up through the ceiling${ESC}[0m`,
    `${ESC}[32m   │ ╱╲╱   ╲╱      V${ESC}[0m`,
    `${ESC}[32m   └──────────────────────────────────────▶ time${ESC}[0m`,
    '',
    `${ESC}[36;1m   ▸  The story${ESC}[0m`,
    '       Price pushed through a level that capped it for weeks,',
    '       then came back to test the same level. Buyers stepped',
    '       in to defend it. The ceiling has flipped into a floor.',
    '',
    `${ESC}[36;1m   ▸  How a trader acts${ESC}[0m`,
    '       Buy the pullback to the floor. Place the risk-off just',
    '       under it. If the floor breaks, the idea is off.',
    '```',
  ].join('\n');
}

const SAMPLE_MESSAGES = [
  // ── Message 1 — Red NEW divider + gold banner + scan summary + teal terminology row ──
  // + Today's read + Market mood + ⭐ Standouts heading + NEW separator + first embed.
  {
    content: [
      RED_NEW_DIVIDER,
      '',
      goldSectionBox('🐎  DARK HORSE — GLOBAL MOVER RADAR'),
      '',
      '_The standout movers ATLAS found this cycle._',
      '_Three strong moves. Two bullish, one bearish. Broader market mood is jumpy — keep size measured._',
      '',
      '📘 **EXPANDED TERMINOLOGY HYPERLINKS**',
      tealTerminologyRow(['Breakout', 'Retest', 'Continuation', 'Mover Stage 1']),
      '',
      goldSubheading('Today\'s read'),
      'Three markets are showing real strength. The full picture is below.',
      '',
      goldSubheading('Market mood'),
      'Elevated risk — broad market is moving fast, so size positions with care.',
      '',
      goldSectionBox('⭐  STANDOUTS — TODAY\'S STRONGEST MOVERS'),
      '',
      '─── NEW ───',
    ].join('\n'),
    embeds: [{
      color: 0x2ECC71,
      title: '🐎  EURUSD  ·  STRONG BULLISH',
      description: 'Pushed above a multi-week ceiling and held the level cleanly. The move is fresh.',
      fields: [
        { name: 'Move Type',   value: 'Breakout · early stage',                                  inline: true  },
        { name: 'Direction',   value: '▲ Long',                                                   inline: true  },
        { name: 'Conviction',  value: '🟢🟢🟢🟢 / 5 · High',                                        inline: true  },
        { name: 'The Setup',   value: 'Above 1.0950 — broken cleanly',                            inline: true  },
        { name: 'Horizon',     value: 'Days, not minutes',                                        inline: true  },
        { name: 'Standing',    value: 'Standout #1 of 3',                                         inline: true  },
        // Multi-line value — Discord renders \n in field values as
        // line breaks. Each action carries its own colour-coded line
        // for mobile readability.
        { name: 'Where to Act',
          value: [
            '🟢 BUY 1.0925 — on the dip-and-hold',
            '🛑 RISK-OFF 1.0895 — if the floor fails, level flips back to ceiling',
          ].join('\n'),
          inline: false },
      ],
      footer: { text: 'Dark Horse Radar  ·  12:00 UTC  ·  standout 1 of 3' },
    }],
  },

  // ── Message 2 — NEW separator + bearish embed ──
  {
    content: '─── NEW ───',
    embeds: [{
      color: 0xE74C3C,
      title: '🐎  XAUUSD  ·  STRONG BEARISH',
      description: 'Gold has broken under a multi-week floor. Sellers are now in control of the structure.',
      fields: [
        { name: 'Move Type',   value: 'Breakdown · early stage',                                  inline: true  },
        { name: 'Direction',   value: '▼ Short',                                                   inline: true  },
        { name: 'Conviction',  value: '🔴🔴🔴🔴 / 5 · High',                                        inline: true  },
        { name: 'The Setup',   value: 'Below 2398.20 — broken cleanly',                           inline: true  },
        { name: 'Horizon',     value: 'Days, not minutes',                                        inline: true  },
        { name: 'Standing',    value: 'Standout #2 of 3',                                         inline: true  },
        { name: 'Where to Act',
          value: [
            '🟢 SELL 2401.50 — on the bounce-and-stall',
            '🛑 RISK-OFF 2410.30 — if it reclaims, the bear thesis is off',
          ].join('\n'),
          inline: false },
      ],
      footer: { text: 'Dark Horse Radar  ·  12:00 UTC  ·  standout 2 of 3' },
    }],
  },

  // ── Message 3 — NEW separator + developing-watch embed ──
  {
    content: '─── NEW ───',
    embeds: [{
      color: 0xF1C40F,
      title: '🐎  NVDA  ·  DEVELOPING WATCH',
      description: 'NVIDIA\'s uptrend is mature. Reward is shrinking — wait for the next test, do not chase.',
      fields: [
        { name: 'Move Type',   value: 'Continuation · late stage',                                inline: true  },
        { name: 'Direction',   value: '▲ Long',                                                    inline: true  },
        { name: 'Conviction',  value: '🟡🟡🟡🟡 / 5 · High',                                        inline: true  },
        { name: 'The Setup',   value: 'Above 925.40 — waiting on the next push',                  inline: true  },
        { name: 'Horizon',     value: 'Hours, not days',                                          inline: true  },
        { name: 'Standing',    value: 'Standout #3 of 3',                                         inline: true  },
        { name: 'Where to Act',
          value: [
            '🟢 BUY 921.10 — only on a pullback that holds',
            '🛑 RISK-OFF 912.80 — if it fails, the late-stage idea is off',
            '⚠️  Size small — the move is late in its cycle.',
          ].join('\n'),
          inline: false },
      ],
      footer: { text: 'Dark Horse Radar  ·  12:00 UTC  ·  standout 3 of 3  ·  next review 12:15 UTC' },
    }],
  },

  // ── Message 4 — Pre-radar + visual reference card ──
  // Quiet-scan surface: when no candidate clears the standout bar,
  // the radar still teaches. The gold heading + cyan terminology +
  // visual chart card carry the page.
  {
    content: [
      goldSectionBox('📡  BUILDING — MARKETS WARMING UP'),
      '',
      tealTerminologyRow(['Pre-Radar', 'Momentum', 'Structure']),
      '',
      '_These aren\'t ready to act on yet. They\'re close, and worth keeping on the chart._',
      '_If structure firms by the next cycle, they\'ll graduate into a standout._',
      '',
      visualReferenceCard(),
      '',
      goldSubheading('Risk reminder'),
      '_Even a strong standout is a plan, not a guarantee. Cross-check each card against live price before acting. ATLAS reviews again at 12:15 UTC._',
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
    // Render line breaks in field values (Discord renders \n in field
    // values as actual line breaks; we match that for multi-line
    // Where-to-Act surfaces). Colour-code BUY (green) and RISK-OFF
    // (red) lines on a per-line basis so each gets its own visual
    // band on mobile.
    const escaped = escapeHtml(f.value || '');
    const lines = escaped.split('\n').map(line => {
      if (/^🟢\s+(BUY|SELL|ENTRY)/.test(line)) return `<span class="entry">${line}</span>`;
      if (/^🛑\s+(RISK-OFF|STOP)/.test(line))   return `<span class="stop">${line}</span>`;
      return line;
    }).join('<br>');
    const withChips = lines.replace(/(\[[^\]]+\])/g, '<span class="term-chip">$1</span>');
    return `
      <div class="embed-field ${f.inline ? 'inline' : 'block'}">
        <div class="embed-field-name">${escapeHtml(f.name)}</div>
        <div class="embed-field-value">${withChips}</div>
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
  // v3 — comfort + readability refinement pass. Direction (red NEW
  // divider, gold section boxes, teal terminology, state-coloured
  // embeds, visual reference card) is LOCKED — no rollback.
  // Comfort knobs tuned:
  //   - base font 16 → 18px
  //   - line-height 1.4 → 1.55
  //   - embed max-width 520 → 620px
  //   - embed padding 10/14/12 → 16/20/18
  //   - title 15 → 17px / desc 14 → 16px / fields 13–14 → 15–16px /
  //     footer 12 → 13px
  //   - fence font 13.5 → 15px, line-height 1.35 → 1.55
  //   - per-message vertical spacing 4 → 16px
  //   - inline-field grid relaxed: 1fr 1fr 1fr → 1fr 1fr on narrower
  //     viewports + larger gap so 2-up reads at iPad portrait scale
  //   - the entry/stop colour bands break to their own line for
  //     mobile readability
  const css = `
    body {
      margin: 0; padding: 28px 20px;
      background: #36393F;
      color: #DCDDDE;
      font-family: "gg sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 18px;
      line-height: 1.55;
    }
    .channel {
      max-width: 780px;
      margin: 0 auto;
      background: #36393F;
    }
    .channel-header {
      border-bottom: 1px solid #2F3136;
      padding-bottom: 16px;
      margin-bottom: 28px;
      color: #B9BBBE;
      font-size: 15px;
      display: flex; gap: 10px; align-items: center;
    }
    .channel-header .hash { color: #72767D; font-size: 26px; font-weight: 600; }
    .channel-header .name { color: #FFFFFF; font-weight: 600; font-size: 17px; }
    .message {
      padding: 14px 0 14px 68px;
      position: relative;
      margin-bottom: 16px;
    }
    .message::before {
      content: ""; position: absolute; left: 12px; top: 14px;
      width: 40px; height: 40px; border-radius: 50%;
      background: linear-gradient(135deg, #5865F2, #EB459E);
    }
    .message::after {
      content: "ATLAS  ·  Dark Horse Radar";
      position: absolute; left: 68px; top: -2px;
      color: #FFFFFF; font-weight: 600; font-size: 16px;
    }
    .message-content {
      margin-top: 22px;
      color: #DCDDDE;
      white-space: normal;
      word-break: break-word;
    }
    .message-content pre.fence {
      background: #2F3136;
      border-radius: 6px;
      padding: 14px 16px;
      margin: 10px 0;
      font-family: Consolas, "Andale Mono WT", "Andale Mono", "Lucida Console", "Lucida Sans Typewriter", "DejaVu Sans Mono", "Bitstream Vera Sans Mono", "Liberation Mono", "Nimbus Mono L", Monaco, "Courier New", Courier, monospace;
      font-size: 15px;
      line-height: 1.55;
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
      margin: 22px 0;
      font-family: Consolas, monospace;
      font-size: 16px;
    }
    .embed {
      max-width: 620px;
      margin-top: 14px;
      background: #2F3136;
      border-left: 5px solid #4F545C;
      border-radius: 6px;
      padding: 16px 20px 18px;
    }
    .embed-title {
      color: #FFFFFF;
      font-weight: 700;
      font-size: 19px;
      margin-bottom: 8px;
      line-height: 1.35;
    }
    .embed-desc {
      color: #DCDDDE;
      font-size: 16px;
      line-height: 1.55;
      margin-bottom: 14px;
    }
    .embed-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px 24px;
    }
    .embed-field.block { grid-column: 1 / -1; }
    .embed-field.inline { grid-column: span 1; }
    .embed-field-name {
      color: #FFFFFF;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .embed-field-value {
      color: #DCDDDE;
      font-size: 16px;
      line-height: 1.5;
    }
    .embed-field-value .entry { color: #23A55A; font-weight: 700; display: block; margin: 2px 0; }
    .embed-field-value .stop  { color: #ED4245; font-weight: 700; display: block; margin: 2px 0; }
    .embed-field-value .term-chip {
      color: #5BC0DE;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .embed-footer {
      color: #72767D;
      font-size: 13px;
      line-height: 1.5;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid #40444B;
    }
  `;
  const messagesHtml = messages.map(renderMessage).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>FOH.1.0.1 Dark Horse — Visual Prototype v3</title>
<style>${css}</style></head>
<body>
<div class="channel">
  <div class="channel-header">
    <span class="hash">#</span>
    <span class="name">dark-horse-radar</span>
    <span style="margin-left:auto;color:#72767D">FOH.1.0.1 prototype v3 · sample data · comfort + scale pass</span>
  </div>
  ${messagesHtml}
</div>
</body></html>`;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const html = buildHtml(SAMPLE_MESSAGES);
  const version = process.env.FOH_PREVIEW_VERSION || 'v3';
  const htmlPath = path.join(outDir, `dh-foh-prototype-${version}.html`);
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

    // (1) Full-strip PNG — the original delivery.
    const pngPath = path.join(outDir, `dh-foh-prototype-${version}.png`);
    await page.screenshot({ path: pngPath, fullPage: true });
    console.log('Wrote:', pngPath);

    // (2) Multi-page PDF — universally viewable on iPad/iPhone/Mac/
    //     Windows. Page width matches the channel width so the
    //     content lays out cleanly across pages.
    const pdfPath = path.join(outDir, `dh-foh-prototype-${version}.pdf`);
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      width: '820px',
      height: '1160px',  // close to iPad portrait aspect, multi-page
      margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
    });
    console.log('Wrote:', pdfPath);

    // (3) Per-message PNGs — one PNG per scan element so the operator
    //     can inspect each banner / candidate / reference card on its
    //     own, instead of fighting one 5000-pixel-tall strip. Each
    //     PNG is captured at the same 2x DPR but only the bounding
    //     box of that message div, plus a little breathing pad.
    const sectionNames = ['banner-and-first-card', 'bearish', 'watch', 'reference-card'];
    const messageHandles = await page.$$('.message');
    for (let i = 0; i < messageHandles.length; i++) {
      const handle = messageHandles[i];
      const sectionLabel = sectionNames[i] || `section-${i + 1}`;
      const sectionPath = path.join(outDir, `dh-foh-prototype-${version}-section-${i + 1}-${sectionLabel}.png`);
      // `clip` honours the bounding box exactly; we expand by ~12px
      // padding so the avatar / header line doesn't hug the edge.
      const bb = await handle.boundingBox();
      if (!bb) continue;
      await page.screenshot({
        path: sectionPath,
        clip: {
          x: Math.max(0, bb.x - 12),
          y: Math.max(0, bb.y - 12),
          width: Math.ceil(bb.width + 24),
          height: Math.ceil(bb.height + 24),
        },
      });
      console.log('Wrote:', sectionPath);
    }

    // Finer slices for sections the operator wants to inspect alone:
    //   - the red NEW divider + banner header (top of M1)
    //   - the first candidate embed (bottom of M1)
    //   - the visual reference card (bottom of M4)
    // These are operator-friendly snapshots that crop out everything
    // else, so each visual element can be reviewed in isolation.
    async function snapshotChild(messageIdx, selector, label) {
      const msgHandle = messageHandles[messageIdx];
      if (!msgHandle) return;
      const childs = await msgHandle.$$(selector);
      for (let j = 0; j < childs.length; j++) {
        const c = childs[j];
        const bb = await c.boundingBox();
        if (!bb) continue;
        const filename = `dh-foh-prototype-${version}-detail-${label}${childs.length > 1 ? '-' + (j + 1) : ''}.png`;
        const filePath = path.join(outDir, filename);
        await page.screenshot({
          path: filePath,
          clip: {
            x: Math.max(0, bb.x - 16),
            y: Math.max(0, bb.y - 16),
            width: Math.ceil(bb.width + 32),
            height: Math.ceil(bb.height + 32),
          },
        });
        console.log('Wrote:', filePath);
      }
    }
    // M1's message-content carries the full banner (red NEW divider +
    // gold banner + teal terminology row + ▸ subheadings + ⭐ standouts
    // gold box). M1 also has the first candidate embed below the
    // content. M4's content carries the BUILDING + reference card.
    await snapshotChild(0, '.message-content', 'banner');
    await snapshotChild(0, '.embed', 'first-candidate-embed');
    await snapshotChild(3, '.message-content', 'reference-card');

    console.log('Wrote:', htmlPath);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
