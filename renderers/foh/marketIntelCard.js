'use strict';

// ============================================================
// renderers/foh/marketIntelCard.js
//
// Builds the HTML/CSS card for Market Intel FOH (pre-event,
// released-event, daily bulletin, weekend Monday-open mode).
//
// Input shape (`payload`):
//   {
//     kind: 'pre_event' | 'released' | 'daily' | 'weekend',
//     headline:     { title, currency, country?, impact, time, stage?, lifecycle? },
//     mood:         { discs, label, severity },   // severity in HIGH/ELEV/MED/LOW
//     whyThisMatters: 'paragraph',
//     marketImpact:   'transmission chain string',
//     crossAsset:     [{ classLabel, body }, ...],
//     operatorGuidance: { confirms, cancels },
//     nextWatch:    'human-readable line',
//     historical:   { rows: [{label, actual, magnitude, dir, reaction}], basis, sampleN } | null,
//     eventClusters?: [{ currency, country, events: [{title, time, impactSeverity}] }, ...],
//     terminology:  [ 'Dovish', 'Hawkish', 'Yield curve', 'Risk-off', 'Liquidity sweep' ],
//     glossaryUrl:  'https://...',
//     sourceNote:   { source, mode, probabilityBasis, macroNote? },
//     briefingSummary: 'paragraph',
//   }
//
// Returns: full standalone HTML string (CSS inlined).
// ============================================================

const fs = require('fs');
const path = require('path');

const _CSS = fs.readFileSync(path.join(__dirname, 'shared.css'), 'utf8');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function severityClass(s) {
  const v = String(s || '').toLowerCase();
  if (/high|extreme|red/.test(v)) return 'high';
  if (/elev|amber|orange/.test(v)) return 'elev';
  if (/med|mod|yellow/.test(v)) return 'med';
  return 'low';
}

function severityTag(s) {
  const v = String(s || '').toUpperCase();
  if (/HIGH|EXTREME/.test(v)) return 'HIGH IMPACT';
  if (/ELEV/.test(v)) return 'ELEVATED IMPACT';
  if (/MED|MOD/.test(v)) return 'MEDIUM IMPACT';
  return 'LOW IMPACT';
}

function renderTerminologyChip(payload) {
  const terms = Array.isArray(payload.terminology) && payload.terminology.length
    ? payload.terminology
    : ['Dovish', 'Hawkish', 'Yield curve', 'Risk-off', 'Liquidity sweep'];
  const url = payload.glossaryUrl || 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a';
  const chips = terms.map(t => `<a href="${esc(url)}">${esc(t)}</a>`).join('');
  return `<div class="foh-hyperlinks">
    <span class="foh-hyperlinks-label">📘 Expanded Terminology</span>
    ${chips}
  </div>`;
}

function renderHistoricalPanel(historical) {
  if (!historical || !Array.isArray(historical.rows) || !historical.rows.length) return '';
  const rows = historical.rows.slice(0, 3).map(r => {
    const mag = r.magnitude ? `<strong>${esc(r.magnitude)}</strong> ` : '';
    const dir = r.dir ? `(${esc(r.dir)})` : '';
    const reaction = r.reaction ? ` → ${esc(r.reaction)}` : '';
    return `<li><strong>${esc(r.label)}</strong>: ${esc(r.actual)} ${mag}${dir}${reaction}</li>`;
  }).join('');
  const basis = historical.basis || 'engine-derived';
  const n = historical.sampleN || historical.rows.length;
  return `
  <div class="foh-historical">
    <div class="foh-historical-title">📅 Historical reaction context · last ${historical.rows.length}</div>
    <ul>${rows}</ul>
    <div class="foh-historical-basis">Sample n=${esc(n)} · basis: ${esc(basis)}</div>
  </div>`;
}

function renderEventClusters(payload) {
  if (!Array.isArray(payload.eventClusters) || !payload.eventClusters.length) return '';
  const blocks = payload.eventClusters.map(c => {
    const items = (c.events || []).map(ev => {
      const sev = severityClass(ev.impactSeverity || ev.impact);
      const tag = severityTag(ev.impactSeverity || ev.impact);
      return `<li><span class="foh-pill ${sev}">${esc(tag)}</span>${esc(ev.time || '')} — ${esc(ev.title || '(untitled)')}</li>`;
    }).join('');
    const flag = c.country ? esc(c.country) + ' · ' : '';
    return `
    <div class="foh-event-cluster">
      <div class="foh-event-cluster-title">${flag}${esc(c.currency || 'BLOCK')} BLOCK · ${(c.events || []).length} event${((c.events || []).length === 1) ? '' : 's'}</div>
      <ul>${items}</ul>
    </div>`;
  }).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading gold">Event clusters</h3>
    <div class="foh-body">${blocks}</div>
  </div>`;
}

function renderCrossAsset(payload) {
  if (!Array.isArray(payload.crossAsset) || !payload.crossAsset.length) return '';
  const rows = payload.crossAsset.map(c =>
    `<p><strong>${esc(c.classLabel)}:</strong> ${esc(c.body)}</p>`
  ).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading gold">Cross-asset consequences</h3>
    <div class="foh-body">${rows}</div>
  </div>`;
}

function renderOperatorGuidance(g) {
  if (!g || (!g.confirms && !g.cancels)) return '';
  const confirms = g.confirms ? `<p><strong style="color:var(--atlas-green);">Confirms:</strong> ${esc(g.confirms)}</p>` : '';
  const cancels  = g.cancels  ? `<p><strong style="color:var(--atlas-red);">Cancels:</strong> ${esc(g.cancels)}</p>` : '';
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading cyan">Operator guidance</h3>
    <div class="foh-body">${confirms}${cancels}</div>
  </div>`;
}

function renderBanner(payload) {
  const k = payload.kind || 'pre_event';
  const titleMap = {
    pre_event: 'ATLAS · Market Intel — Event Watch',
    released:  'ATLAS · Market Intel — Released Event',
    daily:     'ATLAS · Market Intel — Daily Roadmap',
    weekend:   'ATLAS · Market Intel — Weekend / Monday Open Prep',
  };
  const subtitleMap = {
    pre_event: 'v6 · pre-event surface',
    released:  'v6 · post-release surface',
    daily:     'v6 · daily surface',
    weekend:   'v6 · weekend / Monday open prep surface',
  };
  return `
  <div class="foh-banner">
    <div class="foh-banner-title">${esc(titleMap[k] || titleMap.pre_event)}</div>
    <div class="foh-banner-sub">${esc(subtitleMap[k] || '')}</div>
  </div>`;
}

function renderMetaRow(payload) {
  const h = payload.headline || {};
  const cells = [];
  if (h.title)     cells.push(`<div class="foh-meta-cell">📍 Event<strong>${esc(h.title)}</strong></div>`);
  if (h.currency)  cells.push(`<div class="foh-meta-cell">🌍 Currency<strong>${esc(h.currency)}${h.country ? ' (' + esc(h.country) + ')' : ''}</strong></div>`);
  if (h.time)      cells.push(`<div class="foh-meta-cell">⏰ Time<strong>${esc(h.time)}</strong></div>`);
  if (h.impact)    cells.push(`<div class="foh-meta-cell">🎚️ Impact<strong>${esc(h.impact)}</strong></div>`);
  if (h.stage)     cells.push(`<div class="foh-meta-cell">🧭 Stage<strong>${esc(h.stage)}</strong></div>`);
  if (h.lifecycle) cells.push(`<div class="foh-meta-cell">🔄 Lifecycle<strong>${esc(h.lifecycle)}</strong></div>`);
  if (!cells.length) return '';
  return `<div class="foh-meta-row">${cells.join('')}</div>`;
}

function renderMoodPanel(payload) {
  const m = payload.mood || {};
  const sev = severityClass(m.severity);
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading amber">Market mood · regime</h3>
    <div class="foh-severity-panel ${sev}">
      <span><span class="foh-disc-bar">${esc(m.discs || '⚫⚫⚫⚫⚫')}</span><span class="foh-disc-bar-label">${esc(m.label || '')}</span></span>
      <span class="foh-severity-tag">${esc(severityTag(m.severity))}</span>
    </div>
  </div>`;
}

function renderFooter(payload) {
  const s = payload.sourceNote || {};
  const parts = [];
  if (s.source) parts.push(`calendar=<span class="cyan">${esc(s.source)}${s.mode ? '/' + esc(s.mode) : ''}</span>`);
  parts.push(`macro=<span class="gold">ATLAS</span>`);
  if (s.probabilityBasis) parts.push(`probability=${esc(s.probabilityBasis)}`);
  const macroNote = s.macroNote ? `<div>${esc(s.macroNote)}</div>` : '';
  return `
  <div class="foh-footer">
    ${parts.join(' · ')}
    ${macroNote}
    <div style="margin-top:4px;">Bias remains conditional until price confirms through structure.</div>
  </div>`;
}

function renderMarketIntelCard(payload) {
  payload = payload || {};
  const why = payload.whyThisMatters ? `
    <div class="foh-section">
      <h3 class="foh-section-heading gold">Why this matters</h3>
      <div class="foh-body"><p>${esc(payload.whyThisMatters)}</p></div>
    </div>` : '';
  const market = payload.marketImpact ? `
    <div class="foh-section">
      <h3 class="foh-section-heading amber">Market impact · transmission chain</h3>
      <div class="foh-body"><p>${esc(payload.marketImpact)}</p></div>
    </div>` : '';
  const hist = renderHistoricalPanel(payload.historical);
  const histSection = hist ? `
    <div class="foh-section">
      <h3 class="foh-section-heading amber">Historical reaction</h3>
      <div class="foh-body">${hist}</div>
    </div>` : '';
  const briefing = payload.briefingSummary ? `
    <div class="foh-section">
      <h3 class="foh-section-heading cyan">Briefing summary</h3>
      <div class="foh-body"><p><em>${esc(payload.briefingSummary)}</em></p></div>
    </div>` : '';
  const nextWatch = payload.nextWatch ? `
    <div class="foh-section">
      <h3 class="foh-section-heading cyan">Next watch window</h3>
      <div class="foh-body"><p>⏳ ${esc(payload.nextWatch)}</p></div>
    </div>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${_CSS}</style></head>
<body>
  <div class="foh-card">
    ${renderBanner(payload)}
    ${renderMetaRow(payload)}
    ${renderMoodPanel(payload)}
    ${renderEventClusters(payload)}
    ${why}
    ${market}
    ${renderCrossAsset(payload)}
    ${renderOperatorGuidance(payload.operatorGuidance)}
    ${histSection}
    ${nextWatch}
    ${renderTerminologyChip(payload)}
    ${briefing}
    ${renderFooter(payload)}
  </div>
</body></html>`;
}

module.exports = { renderMarketIntelCard };
