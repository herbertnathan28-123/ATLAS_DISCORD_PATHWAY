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
  93: '#FFD600', 96: '#00B0FF',
};
function renderAnsiBlock(raw) {
  raw = String(raw || '').replace(/\x1b/g, '');
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
    // Translate the [[NEW_BADGE:label|state]] token to a styled
    // HTML badge BEFORE escaping. Operator-directed lifecycle:
    // FRESH = solid red filled; ACTIVE = outlined red; FADING =
    // outlined orange. The literal token form keeps the renderer
    // self-contained — no special markdown rule required.
    let raw = p.value.replace(
      /\[\[NEW_BADGE:([^\|\]]+)\|(fresh|active|fading)\]\]/g,
      (_m, label, state) => 'NEWBADGE' + label + '' + state + ''
    );
    // Markdown links [text](url) — render as cyan styled anchors.
    raw = raw.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+|#[^)]+)\)/g,
      (_m, t, href) => 'LINK' + t + '' + href + ''
    );
    let escaped = escapeHtml(raw)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // Substitute placeholder tokens with HTML
    escaped = escaped.replace(
      /NEWBADGE([^]+)(fresh|active|fading)/g,
      (_m, label, state) => renderNewBadge(label, state)
    );
    escaped = escaped.replace(
      /LINK([^]+)([^]+)/g,
      (_m, t, href) => `<a class="term-link" href="${href}" title="${href}">${t}</a>`
    );
    // v6 — inline coloured-price token translation in message
    // content (also applied in field values via renderEmbed).
    // Operator doctrine: invalidation prices RED, caution blocks
    // ORANGE, watch yellow, entry green, dollar amounts gold.
    escaped = escaped
      .replace(/\{\{entry:([^}]+)\}\}/g,    (_m, v) => `<span class="px-entry">${v}</span>`)
      .replace(/\{\{watch:([^}]+)\}\}/g,    (_m, v) => `<span class="px-watch">${v}</span>`)
      .replace(/\{\{caution:([^}]+)\}\}/g,  (_m, v) => `<span class="px-caution">${v}</span>`)
      .replace(/\{\{invalid:([^}]+)\}\}/g,  (_m, v) => `<span class="px-invalid">${v}</span>`)
      .replace(/\{\{money:([^}]+)\}\}/g,    (_m, v) => `<span class="px-money">${v}</span>`);
    return escaped.replace(/\n/g, '<br>');
  }).join('');
}

// ── ATLAS Severity Disc Scale (operator doctrine — 5-disc) ─
// Format: 🟠🟠🟠🟠⚫ 4/5 — Elevated
// Rules:
//   active discs same colour family
//   inactive discs always ⚫ (dimmed same-family surrogate)
//   NEVER mixed rainbow inactive
// Used for: Risk State, Conviction, Volatility, Event Intensity,
// Momentum, Market Mood, Trade Authority, Session Aggression.
function discScale(active, total, label, colour) {
  total = Number.isFinite(total) ? total : 5;
  active = Math.max(0, Math.min(total, Number.isFinite(active) ? active : 0));
  const fillByLevel = { 1: '🟢', 2: '🟡', 3: '🟠', 4: '🟠', 5: '🔴' };
  const filled = colour || fillByLevel[active] || '🟢';
  const dot = '⚫';
  const discs = filled.repeat(active) + dot.repeat(total - active);
  const tail = label ? ` — ${label}` : '';
  return `${discs} ${active}/${total}${tail}`;
}

// ── Embed → HTML ───────────────────────────────────────────
function renderEmbed(e) {
  const colour = '#' + (e.color || 0x4F545C).toString(16).padStart(6, '0');
  const title = e.title ? `<div class="embed-title">${escapeHtml(e.title)}</div>` : '';
  const desc = e.description ? `<div class="embed-desc">${escapeHtml(e.description)}</div>` : '';
  const fields = (e.fields || []).map(f => {
    // Pre-process inline colour-coded price tokens BEFORE escaping.
    // Operator doctrine: invalidation prices RED, caution blocks
    // ORANGE, watch levels yellow, entry levels green. Tokens:
    //   {{entry:1.0925}} {{watch:1.0900}} {{caution:text}}
    //   {{invalid:1.0875}} {{money:$300}}
    let raw = String(f.value || '');
    raw = raw
      .replace(/\{\{entry:([^}]+)\}\}/g,    (_m, v) => 'COLENTRY' + v + '')
      .replace(/\{\{watch:([^}]+)\}\}/g,    (_m, v) => 'COLWATCH' + v + '')
      .replace(/\{\{caution:([^}]+)\}\}/g,  (_m, v) => 'COLCAUTION' + v + '')
      .replace(/\{\{invalid:([^}]+)\}\}/g,  (_m, v) => 'COLINVALID' + v + '')
      .replace(/\{\{money:([^}]+)\}\}/g,    (_m, v) => 'COLMONEY' + v + '');
    // Markdown links [text](href) — render as cyan styled anchors.
    raw = raw.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+|#[^)]+)\)/g,
      (_m, t, href) => 'LINK' + t + '' + href + ''
    );
    const escaped = escapeHtml(raw);
    // Multi-line value support — Discord renders \n in field
    // values as actual line breaks. We mark up specific
    // colour-banded action lines (entry / exit / risk-off / etc.).
    const lines = escaped.split('\n').map(line => {
      if (/^🟢\s+(BUY|SELL|ENTRY|HEALTHY|GO)/.test(line))      return `<span class="entry">${line}</span>`;
      if (/^🟡\s+(WATCH|CAUTION|PENDING-CONFIRM)/.test(line))   return `<span class="caution">${line}</span>`;
      if (/^🟠\s+(MARGINAL|TIGHTEN|REDUCE|DANGER|CAUTION)/.test(line))  return `<span class="marginal">${line}</span>`;
      if (/^🛑\s+(RISK-OFF|STOP|INVALIDATION|EXIT|HARD-OFF|Invalidation)/.test(line)) return `<span class="stop">${line}</span>`;
      if (/^🔴\s+(INVALID|DANGER|EXIT|STOP|Invalidation)/.test(line))       return `<span class="stop">${line}</span>`;
      if (/^⚠️\s+/.test(line))                                  return `<span class="warn">${line}</span>`;
      if (/^🔵\s+/.test(line))                                  return `<span class="info-line">${line}</span>`;
      if (/^💲\s+/.test(line))                                  return `<span class="money-line">${line}</span>`;
      if (/^\$\s+/.test(line))                                  return `<span class="money-line">${line}</span>`;
      return line;
    }).join('<br>');
    // Substitute placeholder tokens with HTML
    let withTokens = lines
      .replace(/COLENTRY([^]+)/g,   (_m, v) => `<span class="px-entry">${v}</span>`)
      .replace(/COLWATCH([^]+)/g,   (_m, v) => `<span class="px-watch">${v}</span>`)
      .replace(/COLCAUTION([^]+)/g, (_m, v) => `<span class="px-caution">${v}</span>`)
      .replace(/COLINVALID([^]+)/g, (_m, v) => `<span class="px-invalid">${v}</span>`)
      .replace(/COLMONEY([^]+)/g,   (_m, v) => `<span class="px-money">${v}</span>`)
      .replace(/LINK([^]+)([^]+)/g, (_m, t, href) => `<a class="term-link" href="${href}" title="${href}">${t}</a>`);
    const withChips = withTokens.replace(/(\[[^\]]+\])(?!\()/g, '<span class="term-chip">$1</span>');
    return `
      <div class="embed-field ${f.inline ? 'inline' : 'block'}">
        <div class="embed-field-name">${escapeHtml(f.name)}</div>
        <div class="embed-field-value">${withChips}</div>
      </div>`;
  }).join('');
  const footer = e.footer && e.footer.text
    ? `<div class="embed-footer">${escapeHtml(e.footer.text)}</div>`
    : '';
  const chart = e.chartCard ? renderChartCardSvg(e.chartCard) : '';
  return `
    <div class="embed" style="border-left-color:${colour}">
      ${title}${desc}
      ${chart}
      <div class="embed-fields">${fields}</div>
      ${footer}
    </div>`;
}

// ── ATLAS-styled chart card (SVG) ──────────────────────────
// Renders a faux-chart visual that mirrors the ATLAS dashboard
// style: #131722 background, locked candle colours (#00ff00 /
// #ff0015), and the 4-colour price box label system (HIGH yellow,
// CURRENT green, ENTRY orange, LOW blue) from CLAUDE.md.
// Used by Dark Horse v5 candidate cards and Market Intel v2
// event-day reference card. Replaces the ASCII art placeholder
// with a styled chart-shape image embedded in the embed.
//
// Spec:
//   { symbol, currentPrice, highPrice, lowPrice, entryHigh,
//     entryLow, watch, invalidation, candles: [{o,h,l,c}],
//     direction: 'Bullish'|'Bearish' }
function renderChartCardSvg(spec) {
  const W = 540, H = 220;
  const PADL = 12, PADR = 90, PADT = 14, PADB = 18;
  const innerW = W - PADL - PADR, innerH = H - PADT - PADB;

  const candles = Array.isArray(spec.candles) ? spec.candles : [];
  if (candles.length === 0) return '';

  // Find the price range from the candles + zone levels so every
  // line stays in-frame.
  const allPrices = [];
  for (const c of candles) {
    if (Number.isFinite(c.h)) allPrices.push(c.h);
    if (Number.isFinite(c.l)) allPrices.push(c.l);
    if (Number.isFinite(c.o)) allPrices.push(c.o);
    if (Number.isFinite(c.c)) allPrices.push(c.c);
  }
  for (const v of [spec.entryHigh, spec.entryLow, spec.watch, spec.caution, spec.invalidation, spec.currentPrice, spec.highPrice, spec.lowPrice]) {
    if (Number.isFinite(v)) allPrices.push(v);
  }
  const maxP = Math.max.apply(null, allPrices);
  const minP = Math.min.apply(null, allPrices);
  const rng = maxP === minP ? 1 : (maxP - minP) * 1.1;
  const midP = (maxP + minP) / 2;
  const minScale = midP - rng / 2;
  const maxScale = midP + rng / 2;
  function yFor(p) {
    if (!Number.isFinite(p)) return PADT;
    return PADT + innerH - ((p - minScale) / (maxScale - minScale)) * innerH;
  }
  function xFor(i) {
    const cw = innerW / Math.max(1, candles.length);
    return PADL + cw * (i + 0.5);
  }
  const candleW = Math.max(2, Math.floor((innerW / candles.length) * 0.6));

  // Candles
  let candlesSvg = '';
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const cx = xFor(i);
    const oY = yFor(c.o), cY = yFor(c.c), hY = yFor(c.h), lY = yFor(c.l);
    const up = c.c >= c.o;
    const fill = up ? '#00ff00' : '#ff0015';
    const bodyTop = Math.min(oY, cY);
    const bodyH = Math.max(1, Math.abs(oY - cY));
    candlesSvg += `<line x1="${cx}" y1="${hY}" x2="${cx}" y2="${lY}" stroke="${fill}" stroke-width="1"/>`;
    candlesSvg += `<rect x="${cx - candleW / 2}" y="${bodyTop}" width="${candleW}" height="${bodyH}" fill="${fill}"/>`;
  }

  // Zone bands — translucent fills layered behind candles
  function zoneBand(price1, price2, fillRgba) {
    if (!Number.isFinite(price1) || !Number.isFinite(price2)) return '';
    const y1 = yFor(Math.max(price1, price2));
    const y2 = yFor(Math.min(price1, price2));
    return `<rect x="${PADL}" y="${y1}" width="${innerW}" height="${y2 - y1}" fill="${fillRgba}" />`;
  }
  let zones = '';
  // Entry zone (green translucent)
  if (Number.isFinite(spec.entryHigh) && Number.isFinite(spec.entryLow)) {
    zones += zoneBand(spec.entryHigh, spec.entryLow, 'rgba(35,165,90,0.18)');
  }
  // Watch level — single line (yellow)
  if (Number.isFinite(spec.watch)) {
    const y = yFor(spec.watch);
    zones += `<line x1="${PADL}" y1="${y}" x2="${PADL + innerW}" y2="${y}" stroke="#F1C40F" stroke-width="1" stroke-dasharray="4 4"/>`;
    zones += `<text x="${PADL + 6}" y="${y - 3}" fill="#F1C40F" font-family="Consolas, monospace" font-size="11">WATCH LEVEL</text>`;
  }
  // Caution zone — orange warning marker
  if (Number.isFinite(spec.caution)) {
    const y = yFor(spec.caution);
    zones += `<line x1="${PADL}" y1="${y}" x2="${PADL + innerW}" y2="${y}" stroke="#E67E22" stroke-width="1.3" stroke-dasharray="5 4"/>`;
    zones += `<text x="${PADL + 160}" y="${y + 12}" fill="#E67E22" font-family="Consolas, monospace" font-size="11">CAUTION ZONE</text>`;
  }
  // Invalidation — red dashed line
  if (Number.isFinite(spec.invalidation)) {
    const y = yFor(spec.invalidation);
    zones += `<line x1="${PADL}" y1="${y}" x2="${PADL + innerW}" y2="${y}" stroke="#ED4245" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    zones += `<text x="${PADL + 6}" y="${y - 7}" fill="#ED4245" font-family="Consolas, monospace" font-size="11">INVALIDATION</text>`;
  }

  // ATLAS price-label boxes (right side)
  function priceLabel(p, bg, fg, name, y) {
    if (!Number.isFinite(p)) return '';
    const x = W - PADR + 4;
    const lblW = PADR - 8;
    const txt = (Math.abs(p) >= 1000 ? p.toFixed(2) : Math.abs(p) >= 10 ? p.toFixed(2) : p.toFixed(4));
    return `
      <rect x="${x}" y="${y - 10}" width="${lblW}" height="20" rx="3" fill="${bg}"/>
      <text x="${x + 6}" y="${y + 4}" fill="${fg}" font-family="Consolas, monospace" font-size="11" font-weight="700">${escapeHtml(name)} ${escapeHtml(txt)}</text>
    `;
  }
  // Stack: HIGH yellow, CURRENT green, ENTRY orange, LOW blue
  // (CLAUDE.md locked colours)
  const labelY_HIGH = yFor(spec.highPrice);
  const labelY_CUR  = yFor(spec.currentPrice);
  const labelY_ENT  = yFor((spec.entryHigh + spec.entryLow) / 2);
  const labelY_LOW  = yFor(spec.lowPrice);
  const labels =
    priceLabel(spec.highPrice,    '#FFD600', '#000', 'HIGH',    labelY_HIGH) +
    priceLabel(spec.currentPrice, '#00FF5A', '#000', 'CURRENT', labelY_CUR) +
    priceLabel((spec.entryHigh + spec.entryLow) / 2, '#FF9100', '#000', 'ENTRY', labelY_ENT) +
    priceLabel(spec.lowPrice,     '#00B0FF', '#FFF', 'LOW',     labelY_LOW);

  // Title row + footer caption
  const symbolText = escapeHtml(spec.symbol || '');
  const captionText = escapeHtml(spec.caption || 'ATLAS chart card preview · prototype render');

  return `
    <div class="chart-card">
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${W}" height="${H}" fill="#131722"/>
        ${zones}
        ${candlesSvg}
        ${labels}
        <text x="${PADL}" y="${PADT - 2}" fill="#DCDDDE" font-family="gg sans, sans-serif" font-size="12" font-weight="700">${symbolText}</text>
      </svg>
      <div class="chart-card-caption">${captionText}</div>
    </div>`;
}

// ── NEW badge HTML (renderer-side, doctrine lifecycle) ─────
// Replaces the plain text "─── NEW ───" or even a ```diff red bar.
// Operator directive: FRESH = solid red filled box with white
// text; STILL ACTIVE (≥1 day) = outlined red box; FADING = outlined
// orange box. The HTML form lives in message-content where we
// translate a special token `[[NEW_BADGE:label|state]]` into the
// styled HTML element. Plain Discord cannot render filled
// backgrounds, so this is a renderer-only visual goal — captured
// for the rendered-card surface lane (future Discord delivery via
// attached image).
function renderNewBadge(label, state) {
  const cls = state === 'fresh' ? 'badge-fresh'
            : state === 'active' ? 'badge-active'
            : state === 'fading' ? 'badge-fading'
            : 'badge-fresh';
  const labelHtml = escapeHtml(label || 'NEW');
  return `<span class="new-badge ${cls}">${labelHtml}</span>`;
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
    .embed-field-value .money-line { color: #FAA61A; font-weight: 700; display: block; margin: 4px 0; }
    /* Operator doctrine colour-coded price tokens. Watch yellow,
       caution orange, invalidation red, entry green, money gold.
       Used via {{entry:1.0925}} {{watch:1.0900}} etc. in field
       values so the price reads in the doctrine colour wherever it
       appears in prose. */
    .embed-field-value .px-entry   { color: #23A55A; font-weight: 700; }
    .embed-field-value .px-watch   { color: #F1C40F; font-weight: 700; }
    .embed-field-value .px-caution { color: #E67E22; font-weight: 700; }
    .embed-field-value .px-invalid { color: #ED4245; font-weight: 700; }
    .embed-field-value .px-money   { color: #FAA61A; font-weight: 700; }
    .message-content .px-entry     { color: #23A55A; font-weight: 700; }
    .message-content .px-watch     { color: #F1C40F; font-weight: 700; }
    .message-content .px-caution   { color: #E67E22; font-weight: 700; }
    .message-content .px-invalid   { color: #ED4245; font-weight: 700; }
    .message-content .px-money     { color: #FAA61A; font-weight: 700; }
    .embed-field-value .term-link,
    .message-content .term-link {
      color: #5BC0DE;
      text-decoration: underline;
      text-decoration-color: rgba(91,192,222,0.55);
      text-underline-offset: 2px;
      font-weight: 600;
    }
    .embed-footer {
      color: #72767D;
      font-size: 13px;
      line-height: 1.5;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid #40444B;
    }
    /* ─ NEW badge lifecycle variants ────────────────────────
       FRESH / INITIAL = yellow-gold filled for first-appearance
       on a scan; STILL ACTIVE = amber/orange outlined for 1+ day
       still trending; FADING = red-orange outlined for late-stage / older
       candidates. Renderer-only visual — full Discord delivery
       requires the rendered-card-image surface lane.            */
    .new-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 6px;
      font-family: Consolas, monospace;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 1px;
      line-height: 1.2;
      vertical-align: middle;
      margin: 0 4px;
    }
    .new-badge.badge-fresh  { background:#FFD600; color:#111; border:1px solid #FFD600; }
    .new-badge.badge-active { background:rgba(255,145,0,0.14); color:#FFB347; border:2px solid #FF9100; }
    .new-badge.badge-fading { background:rgba(237,66,69,0.12); color:#FF6B35; border:2px solid #ED4245; }
    /* ─ Chart card (ATLAS-styled SVG snapshot) ───────────── */
    .chart-card {
      background: #131722;
      border: 1px solid #2B313C;
      border-radius: 6px;
      margin: 12px 0 14px;
      padding: 4px 4px 0;
    }
    .chart-card svg { display: block; width: 100%; height: auto; border-radius: 4px; }
    .chart-card-caption {
      color: #72767D;
      font-size: 12px;
      font-family: Consolas, monospace;
      padding: 6px 8px 8px;
      text-align: center;
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
    // detailSpecs: [{ messageIdx, selector, label, text?, nth?, padding? }, ...]
    for (const spec of detailSpecs) {
      const msgHandle = messageHandles[spec.messageIdx];
      if (!msgHandle) continue;
      let children = await msgHandle.$$(spec.selector);
      if (spec.text) {
        const needle = String(spec.text);
        const filtered = [];
        for (const child of children) {
          const hasText = await child.evaluate((el, t) => (el.textContent || '').indexOf(t) !== -1, needle);
          if (hasText) filtered.push(child);
        }
        children = filtered;
      }
      if (Number.isFinite(spec.nth)) {
        children = children[spec.nth] ? [children[spec.nth]] : [];
      }
      const pad = Number.isFinite(spec.padding) ? spec.padding : 16;
      for (let j = 0; j < children.length; j++) {
        const c = children[j];
        const bb = await c.boundingBox();
        if (!bb) continue;
        const suffix = children.length > 1 ? `-${j + 1}` : '';
        const filePath = path.join(outDir, `${version}-detail-${spec.label}${suffix}.png`);
        await page.screenshot({
          path: filePath,
          clip: {
            x: Math.max(0, bb.x - pad),
            y: Math.max(0, bb.y - pad),
            width: Math.ceil(bb.width + pad * 2),
            height: Math.ceil(bb.height + pad * 2),
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
  renderChartCardSvg,
  renderNewBadge,
  discScale,
};
