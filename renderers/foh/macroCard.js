'use strict';

// ============================================================
// renderers/foh/macroCard.js
//
// Builds the HTML/CSS card for Macro FOH (institutional briefing
// surface — locked CLAUDE.md order: chart → trade status → price
// table → roadmap link → global/event intel → market overview →
// events → historical → execution logic → validity).
//
// This renderer is INTENTIONALLY READ-ONLY of the macro data —
// it does not call formatMacro() or deliverResult() (CLAUDE.md
// "separate dedicated session" zones). It only renders a packet
// the caller assembles. Doctrine-correct macro field mappings
// are the caller's responsibility.
//
// Input shape (`payload`):
//   {
//     dateLabel:    'YYYY-MM-DD AWST',
//     dominantBias: { score, label, arrows },      // 1..5 + ⬆️⬇️
//     regime:       { dxy, vix, yield, riskEnv },  // live macro snapshot
//     marketOverview: [{ heading, body, arrow }, ...],
//     events:       [{ time, title, currency, impact }, ...],
//     historical:   [{ heading, body, arrow }, ...],
//     executionLogic: [ 'IF ... THEN ...', ... ],
//     validity:     'paragraph',
//     roadmapUrl:   'https://...',
//     terminology:  [ ... ],
//     glossaryUrl:  'https://...',
//     sourceNote:   { source, mode, probabilityBasis },
//   }
//
// Returns: full standalone HTML string (CSS inlined).
// ============================================================

const fs = require('fs');
const path = require('path');
const { renderFormatBadges } = require('./badges');

const _CSS = fs.readFileSync(path.join(__dirname, 'shared.css'), 'utf8');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function severityForVix(vix) {
  const v = String(vix || '').toLowerCase();
  if (/elev|high|extreme/.test(v)) return 'elev';
  if (/mod/.test(v)) return 'med';
  return 'low';
}

function renderDotScale(score) {
  const n = Math.max(0, Math.min(5, Number(score) || 0));
  const glyph = n >= 4 ? '🔴' : n >= 3 ? '🟠' : n >= 2 ? '🟡' : '🟢';
  return glyph.repeat(n) + '⚫'.repeat(5 - n);
}

function renderTerminologyChip(payload) {
  const terms = Array.isArray(payload.terminology) && payload.terminology.length
    ? payload.terminology
    : ['Dovish','Hawkish','Yield curve','Risk-off','Confirmed candle close','Structure break'];
  const url = payload.glossaryUrl || 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a';
  const chips = terms.map(t => `<a href="${esc(url)}">${esc(t)}</a>`).join('');
  return `<div class="foh-hyperlinks">
    <span class="foh-hyperlinks-label">📘 Expanded Terminology</span>
    ${chips}
  </div>`;
}

function renderRegimeRow(regime) {
  if (!regime) return '';
  const vixSev = severityForVix(regime.vix);
  return `
  <div class="foh-meta-row">
    ${regime.dxy ?     `<div class="foh-meta-cell">US Dollar Index<strong>${esc(regime.dxy)}</strong></div>` : ''}
    ${regime.vix ?     `<div class="foh-meta-cell">CBOE Volatility Index<strong>${esc(regime.vix)}</strong></div>` : ''}
    ${regime.yield ?   `<div class="foh-meta-cell">Yield curve<strong>${esc(regime.yield)}</strong></div>` : ''}
    ${regime.riskEnv ? `<div class="foh-meta-cell">Risk environment<strong>${esc(regime.riskEnv)}</strong></div>` : ''}
  </div>`;
}

function renderDominantBias(b) {
  if (!b) return '';
  const score = Number.isFinite(b.score) ? b.score : 0;
  const arrows = esc(b.arrows || '');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading gold">Dominant bias</h3>
    <div class="foh-body">
      <div class="foh-severity-panel ${score >= 4 ? 'high' : score >= 3 ? 'elev' : score >= 2 ? 'med' : 'low'}">
        <span><span class="foh-disc-bar">${renderDotScale(score)}</span><span class="foh-disc-bar-label">${esc(b.label || '')}</span></span>
        <span class="foh-severity-tag">${arrows}</span>
      </div>
    </div>
  </div>`;
}

function renderMarketOverview(payload) {
  if (!Array.isArray(payload.marketOverview) || !payload.marketOverview.length) return '';
  const rows = payload.marketOverview.map(p =>
    `<p><strong>${esc(p.heading)}:</strong> ${esc(p.body)} <span style="color:var(--atlas-gold);">${esc(p.arrow || '')}</span></p>`
  ).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading gold">Market overview</h3>
    <div class="foh-body">${rows}</div>
  </div>`;
}

function renderEvents(payload) {
  if (!Array.isArray(payload.events) || !payload.events.length) return '';
  const rows = payload.events.map(ev =>
    `<li>${esc(ev.time || '')} — <strong>${esc(ev.title || '')}</strong> (${esc(ev.currency || '')}) <span class="foh-pill ${(ev.impact || '').toLowerCase() === 'high' ? 'high' : (ev.impact || '').toLowerCase() === 'medium' ? 'med' : 'low'}">${esc(ev.impact || 'LOW')}</span></li>`
  ).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading amber">Events / catalysts</h3>
    <div class="foh-body"><ul style="margin:0;padding:0 0 0 18px;">${rows}</ul></div>
  </div>`;
}

function renderHistorical(payload) {
  if (!Array.isArray(payload.historical) || !payload.historical.length) return '';
  const rows = payload.historical.map(p =>
    `<p><strong>${esc(p.heading)}:</strong> ${esc(p.body)} <span style="color:var(--atlas-gold);">${esc(p.arrow || '')}</span></p>`
  ).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading amber">Historical context</h3>
    <div class="foh-body">${rows}</div>
  </div>`;
}

function renderExecutionLogic(payload) {
  if (!Array.isArray(payload.executionLogic) || !payload.executionLogic.length) return '';
  const rows = payload.executionLogic.map(line => `<p>• ${esc(line)}</p>`).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading red">Execution logic — IF / THEN</h3>
    <div class="foh-body">${rows}</div>
  </div>`;
}

function renderValidity(payload) {
  if (!payload.validity) return '';
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading cyan">Validity window</h3>
    <div class="foh-body"><p>${esc(payload.validity)}</p></div>
  </div>`;
}

function renderRoadmapLink(payload) {
  if (!payload.roadmapUrl) return '';
  return `
  <div class="foh-section" style="padding:10px 26px;">
    <a href="${esc(payload.roadmapUrl)}" style="color:var(--atlas-gold);font-weight:600;text-decoration:none;font-size:13px;">→ Full ATLAS macro roadmap dashboard</a>
  </div>`;
}

function renderMacroCard(payload) {
  payload = payload || {};
  const sourceNote = payload.sourceNote || {};

  const badges = renderFormatBadges(payload);
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${_CSS}</style></head>
<body>
  <div class="foh-card">
    <div class="foh-banner">
      <div class="foh-banner-title">ATLAS · Macro — Institutional Briefing</div>
      <div class="foh-banner-sub">v6 · macro surface · ${esc(payload.dateLabel || '')}${badges}</div>
    </div>
    ${renderRegimeRow(payload.regime)}
    ${renderDominantBias(payload.dominantBias)}
    ${renderRoadmapLink(payload)}
    ${renderMarketOverview(payload)}
    ${renderEvents(payload)}
    ${renderHistorical(payload)}
    ${renderExecutionLogic(payload)}
    ${renderValidity(payload)}
    ${renderTerminologyChip(payload)}
    <div class="foh-footer">
      calendar=<span class="cyan">${esc(sourceNote.source || 'tradingview')}${sourceNote.mode ? '/' + esc(sourceNote.mode) : ''}</span> · macro=<span class="gold">ATLAS</span> · probability=${esc(sourceNote.probabilityBasis || 'engine-derived')}
      <div style="margin-top:4px;">Every paragraph above ends with ⬆️ or ⬇️ per locked macro doctrine.</div>
    </div>
  </div>
</body></html>`;
}

module.exports = { renderMacroCard };
