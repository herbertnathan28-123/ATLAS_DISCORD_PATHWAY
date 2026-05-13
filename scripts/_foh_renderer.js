'use strict';
// ============================================================
// scripts/_foh_renderer.js
//
// Shared FOH.1.0.1 Discord-style preview renderer. Used by:
//   - scripts/render_dh_foh_preview.js       (Dark Horse v3 prototype)
//   - scripts/render_dh_foh_v4_preview.js    (Dark Horse v4 prototype)
//   - scripts/render_market_intel_foh_preview.js (Market Intel FOH)
//
// Exposes:
//   buildHtml(messages, opts)            — synthesises the full
//                                           channel HTML page
//   renderAll(messages, opts)            — async; runs puppeteer,
//                                           writes PNG / PDF /
//                                           per-section / detail
//                                           crops + the HTML source
//
// The renderer is NOT a Discord client. It is a faithful local
// mock that captures the Discord rendering rules the FOH surface
// relies on:
//   - dark theme (#36393F)
//   - ```diff fenced blocks rendering with red "-" prefixed lines
//   - ```ansi fenced blocks rendering with gold/teal/red text via
//     ESC[33m / ESC[36m / ESC[31m colour codes
//   - embeds with left colour bar + title + description + fields
//   - inline + block field grid
//
// Hard boundary: renderer.js (the live ATLAS chart renderer) is
// NOT touched. This module is a self-contained preview shell that
// the operator can inspect locally before any engine wire-up.
// ============================================================

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// ── HTML escaping ──────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── ANSI → HTML (Discord SGR codes) ────────────────────────
const ANSI_FG = {
  30: '#4F545C', 31: '#ED4245', 32: '#23A55A', 33: '#FAA61A',
  34: '#5865F2', 35: '#EB459E', 36: '#5BC0DE', 37: '#FFFFFF',
};
function renderAnsiBlock(raw) {
  const segments = raw.split('[');
  let html = '';
  let openSpan = false;
  let activeColour = null;
  let activeBold = false;
  let activeUnderline = false;
  function closeSpan() { if (openSpan) { html += '</span>'; openSpan = false; } }
  function openWith(colour, bold, underline) {
    closeSpan();
    const styles = [];
    if (colour) styles.push(`color:${colour}`);
    if (bold) styles.push('font-weight:700');
    if (underline) styles.push('text-decoration:underline');
    if (styles.length) { html += `<span style="${styles.join(';')}">`; openSpan = true; }
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

// ── diff fence → HTML (Discord syntax highlighting) ────────
function renderDiffBlock(raw) {
  const lines = raw.split('\n').map(l => {
    if (l.startsWith('- ')) return `<span style="color:#ED4245">${escapeHtml(l)}</span>`;
    if (l.startsWith('+ ')) return `<span style="color:#23A55A">${escapeHtml(l)}</span>`;
    return escapeHtml(l);
  });
  return lines.join('\n');
}

// ── Content (markdown + fenced blocks) ─────────────────────
function renderContent(content) {
  if (typeof content !== 'string' || content.length === 0) return '';
  const parts = [];
  const fenceRe = /```([a-zA-Z]*)\n([\s\S]*?)\n```/g;
  let lastIdx = 0;
  let m;
  while ((m = fenceRe.exec(content)) !== null) {
    if (m.index > lastIdx) parts.push({ kind: 'text', value: content.slice(lastIdx, m.index) });
    parts.push({ kind: 'fence', lang: m[1].toLowerCase(), value: m[2] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < content.length) parts.push({ kind: 'text', value: content.slice(lastIdx) });
  return parts.map(p => {
    if (p.kind === 'fence') {
      let inner;
      if (p.lang === 'ansi')      inner = renderAnsiBlock(p.value);
      else if (p.lang === 'diff') inner = renderDiffBlock(p.value);
      else                        inner = escapeHtml(p.value);
      return `<pre class="fence">${inner}</pre>`;
    }
    const escaped = escapeHtml(p.value)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    return escaped.replace(/\n/g, '<br>');
  }).join('');
}

// ── Embed → HTML ───────────────────────────────────────────
function renderEmbed(e) {
  const colour = '#' + (e.color || 0x4F545C).toString(16).padStart(6, '0');
  const title = e.title ? `<div class="embed-title">${escapeHtml(e.title)}</div>` : '';
  const desc = e.description ? `<div class="embed-desc">${escapeHtml(e.description)}</div>` : '';
  const fields = (e.fields || []).map(f => {
    const escaped = escapeHtml(f.value || '');
    // Multi-line value support — Discord renders \n in field
    // values as actual line breaks. We mark up specific
    // colour-banded action lines (entry / exit / risk-off / etc.)
    // so each row gets its own visual band.
    const lines = escaped.split('\n').map(line => {
      if (/^🟢\s+(BUY|SELL|ENTRY|HEALTHY|GO)/.test(line))      return `<span class="entry">${line}</span>`;
      if (/^🟡\s+(WATCH|CAUTION|PENDING-CONFIRM)/.test(line))   return `<span class="caution">${line}</span>`;
      if (/^🟠\s+(MARGINAL|TIGHTEN|REDUCE|DANGER)/.test(line))  return `<span class="marginal">${line}</span>`;
      if (/^🛑\s+(RISK-OFF|STOP|INVALIDATION|EXIT|HARD-OFF)/.test(line)) return `<span class="stop">${line}</span>`;
      if (/^🔴\s+(INVALID|DANGER|EXIT|STOP)/.test(line))       return `<span class="stop">${line}</span>`;
      if (/^⚠️\s+/.test(line))                                  return `<span class="warn">${line}</span>`;
      if (/^🔵\s+/.test(line))                                  return `<span class="info-line">${line}</span>`;
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

function renderMessage(m, idx, channelName, displayName) {
  const content = renderContent(m.content);
  const embeds = (m.embeds || []).map(renderEmbed).join('');
  return `
    <div class="message" data-idx="${idx}">
      ${content ? `<div class="message-content">${content}</div>` : ''}
      ${embeds}
    </div>`;
}

// ── Build full HTML page ───────────────────────────────────
function buildHtml(messages, opts) {
  opts = opts || {};
  const title       = opts.title       || 'FOH.1.0.1 — Visual Prototype';
  const channelName = opts.channelName || 'preview';
  const displayName = opts.displayName || 'ATLAS  ·  FOH preview';
  const subtitle    = opts.subtitle    || 'FOH.1.0.1 prototype · sample data';

  // CSS: comfort + readability pass (v3 baseline) — 18px base
  // font, 1.55 line-height, 620px embed width, 2-col field grid.
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
      content: "${displayName}";
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
      line-height: 1.6;
    }
    .embed-field-value .entry    { color: #23A55A; font-weight: 700; display: block; margin: 4px 0; }
    .embed-field-value .stop     { color: #ED4245; font-weight: 700; display: block; margin: 4px 0; }
    .embed-field-value .caution  { color: #F1C40F; font-weight: 700; display: block; margin: 4px 0; }
    .embed-field-value .marginal { color: #E67E22; font-weight: 700; display: block; margin: 4px 0; }
    .embed-field-value .warn     { color: #F1C40F; font-weight: 600; display: block; margin: 4px 0; }
    .embed-field-value .info-line { color: #5BC0DE; font-weight: 600; display: block; margin: 4px 0; }
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
  const messagesHtml = messages.map((m, i) => renderMessage(m, i, channelName, displayName)).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${css}</style></head>
<body>
<div class="channel">
  <div class="channel-header">
    <span class="hash">#</span>
    <span class="name">${escapeHtml(channelName)}</span>
    <span style="margin-left:auto;color:#72767D">${escapeHtml(subtitle)}</span>
  </div>
  ${messagesHtml}
</div>
</body></html>`;
}

// ── Async: render + write all artefacts ─────────────────────
async function renderAll(messages, opts) {
  opts = opts || {};
  const outDir       = opts.outDir       || path.join(__dirname, '..', 'docs', 'screenshots');
  const version      = opts.version      || 'preview';
  const channelName  = opts.channelName  || 'preview';
  const displayName  = opts.displayName  || 'ATLAS · FOH preview';
  const subtitle     = opts.subtitle     || `FOH.1.0.1 preview · ${version}`;
  const title        = opts.title        || `FOH.1.0.1 — ${version}`;
  const sectionNames = Array.isArray(opts.sectionNames) ? opts.sectionNames : [];
  const detailSpecs  = Array.isArray(opts.detailSpecs)  ? opts.detailSpecs  : [];

  fs.mkdirSync(outDir, { recursive: true });

  const html = buildHtml(messages, { title, channelName, displayName, subtitle });
  const htmlPath = path.join(outDir, `${version}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const written = [htmlPath];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready').catch(() => {});

    const box = await (await page.$('body')).boundingBox();
    await page.setViewport({
      width: 800,
      height: Math.max(800, Math.ceil(box.height + 40)),
      deviceScaleFactor: 2,
    });

    // (1) Full-strip PNG
    const pngPath = path.join(outDir, `${version}.png`);
    await page.screenshot({ path: pngPath, fullPage: true });
    written.push(pngPath);

    // (2) PDF — universally viewable
    const pdfPath = path.join(outDir, `${version}.pdf`);
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      width: '820px',
      height: '1160px',
      margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
    });
    written.push(pdfPath);

    // (3) Per-message PNGs
    const messageHandles = await page.$$('.message');
    for (let i = 0; i < messageHandles.length; i++) {
      const handle = messageHandles[i];
      const sectionLabel = sectionNames[i] || `section-${i + 1}`;
      const sectionPath = path.join(outDir, `${version}-section-${i + 1}-${sectionLabel}.png`);
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
      written.push(sectionPath);
    }

    // (4) Finer detail crops per caller-supplied spec
    // detailSpecs: [{ messageIdx, selector, label }, ...]
    for (const spec of detailSpecs) {
      const msgHandle = messageHandles[spec.messageIdx];
      if (!msgHandle) continue;
      const children = await msgHandle.$$(spec.selector);
      for (let j = 0; j < children.length; j++) {
        const c = children[j];
        const bb = await c.boundingBox();
        if (!bb) continue;
        const suffix = children.length > 1 ? `-${j + 1}` : '';
        const filePath = path.join(outDir, `${version}-detail-${spec.label}${suffix}.png`);
        await page.screenshot({
          path: filePath,
          clip: {
            x: Math.max(0, bb.x - 16),
            y: Math.max(0, bb.y - 16),
            width: Math.ceil(bb.width + 32),
            height: Math.ceil(bb.height + 32),
          },
        });
        written.push(filePath);
      }
    }
  } finally {
    await browser.close();
  }
  return written;
}

module.exports = {
  buildHtml,
  renderAll,
  // exported for downstream callers / tests
  escapeHtml,
  renderAnsiBlock,
  renderDiffBlock,
  renderContent,
  renderEmbed,
};
