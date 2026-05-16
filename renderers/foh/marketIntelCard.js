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
const { renderFormatBadges } = require('./badges');

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
  const badges = renderFormatBadges(payload);
  return `
  <div class="foh-banner">
    <div class="foh-banner-title">${esc(titleMap[k] || titleMap.pre_event)}</div>
    <div class="foh-banner-sub">${esc(subtitleMap[k] || '')}${badges}</div>
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

// ── FOH PRODUCT-DEPTH RENDERER (operator brief 2026-05-16) ──
// Renders the full FOH packet schema. Every section must
// surface either real data OR a "sourced — unavailable" label —
// never silently delete a section. Detects packet shape via the
// `eventClusters` array + `marketState` object that the rich
// packet always carries.
function _isRichPacket(payload) {
  return payload && Array.isArray(payload.eventClusters) && payload.marketState && typeof payload.marketState.available === 'boolean';
}

function _unavail(label, reason) {
  return `<div class="foh-body"><p><em style="color:var(--atlas-text-dim);">${esc(label)} — sourced unavailable${reason ? ' (' + esc(reason) + ')' : ''}.</em></p></div>`;
}

function _renderMarketStateSection(ms) {
  if (!ms || !ms.available) {
    return `<div class="foh-section"><h3 class="foh-section-heading cyan">Market state · macro regime</h3>${_unavail('Live macro context', ms && ms.reason)}</div>`;
  }
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading cyan">Market state · macro regime</h3>
    <div class="foh-body">
      <p><strong>US Dollar Index:</strong> bias ${esc(ms.dxy.bias)} · level ${esc(ms.dxy.level)}</p>
      <p><strong>CBOE Volatility Index:</strong> ${esc(ms.vix.level)}</p>
      <p><strong>Yield curve:</strong> ${esc(ms.yield.regime)}</p>
      <p><strong>Regime read:</strong> ${esc(ms.regime)} · geopolitical level ${esc(ms.geoLevel)}</p>
    </div>
  </div>`;
}

function _renderMondayFocusSection(mof) {
  if (!mof || !mof.available) return ''; // weekend-only section — silent when not weekend
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading gold">Monday open focus</h3>
    <div class="foh-body">
      <p>${esc(mof.narrative)}</p>
      ${Array.isArray(mof.focusInstruments) && mof.focusInstruments.length
        ? '<p><strong>Lead exposure:</strong> ' + mof.focusInstruments.map(esc).join(' · ') + '</p>'
        : ''}
    </div>
  </div>`;
}

function _renderRichEvent(ev) {
  const sevCls = ev.severity === 'HIGH' ? 'high' : ev.severity === 'MEDIUM' ? 'med' : 'low';
  const sevTag = ev.severity + ' IMPACT';
  const numerics = [
    ev.actual   != null ? '<strong>Actual:</strong> ' + esc(ev.actual)   : null,
    ev.forecast != null ? '<strong>Forecast:</strong> ' + esc(ev.forecast) : null,
    ev.previous != null ? '<strong>Previous:</strong> ' + esc(ev.previous) : null,
  ].filter(Boolean).join(' · ');
  const histPanel = (ev.historicalReaction && ev.historicalReaction.available)
    ? renderHistoricalPanel({ rows: ev.historicalReaction.rows, basis: ev.historicalReaction.basis, sampleN: ev.historicalReaction.sampleN })
    : `<div class="foh-historical"><div class="foh-historical-title">📅 Historical reaction</div><p><em style="color:var(--atlas-text-dim);">sourced unavailable (${esc((ev.historicalReaction && ev.historicalReaction.reason) || 'no sample')})</em></p></div>`;
  const bda = ev.beforeDuringAfter || {};
  return `
  <div class="foh-severity-panel ${sevCls}" style="display:block;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span><strong style="color:var(--atlas-gold);">${esc(ev.title)}</strong> · ${esc(ev.time)} · ${esc(ev.currency)}</span>
      <span class="foh-severity-tag">${esc(sevTag)}</span>
    </div>
    <p style="margin:4px 0;color:var(--atlas-text-dim);font-size:12px;">${esc(ev.driverLine)}</p>
    ${numerics ? '<p style="margin:4px 0;font-size:13px;">' + numerics + '</p>' : ''}
    <p style="margin:8px 0 4px 0;"><strong style="color:var(--atlas-gold);">Why this matters:</strong> ${esc(ev.whyExpanded)}</p>
    <p style="margin:4px 0;"><strong style="color:var(--atlas-amber);">Market impact:</strong> ${esc(ev.marketImpact)}</p>
    <div style="margin:6px 0;font-size:12px;">
      <strong style="color:var(--atlas-cyan);">Before:</strong> ${esc(bda.before || '—')}<br>
      <strong style="color:var(--atlas-cyan);">During:</strong> ${esc(bda.during || '—')}<br>
      <strong style="color:var(--atlas-cyan);">After:</strong> ${esc(bda.after || '—')}
    </div>
    <p style="margin:4px 0;font-size:12px;"><strong style="color:var(--atlas-green);">Confirms:</strong> ${esc(ev.confirmationPath)}</p>
    <p style="margin:4px 0;font-size:12px;"><strong style="color:var(--atlas-red);">Cancels:</strong> ${esc(ev.cancellationPath)}</p>
    ${histPanel}
  </div>`;
}

function _renderRichEventClusters(clusters, mode) {
  if (!Array.isArray(clusters) || !clusters.length) {
    return `<div class="foh-section"><h3 class="foh-section-heading gold">Event clusters</h3>${_unavail('No clustered catalysts inside the window')}</div>`;
  }
  const blocks = clusters.map(c => {
    const sevCls = c.severity === 'HIGH' ? 'high' : c.severity === 'MEDIUM' ? 'med' : 'low';
    const flag = c.country ? esc(c.country) + ' · ' : '';
    const events = (c.events || []).map(_renderRichEvent).join('');
    return `
    <div class="foh-event-cluster">
      <div class="foh-event-cluster-title">${flag}${esc(c.currency || 'BLOCK')} BLOCK · ${(c.events || []).length} event${(c.events || []).length === 1 ? '' : 's'} <span class="foh-pill ${sevCls}">${esc(c.severity)}</span></div>
      ${events}
    </div>`;
  }).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading gold">Event clusters${mode === 'weekend' ? ' · weekly window' : ''}</h3>
    <div class="foh-body">${blocks}</div>
  </div>`;
}

function _renderAggregateSection(label, accent, obj) {
  if (!obj || obj.available === false) {
    return `<div class="foh-section"><h3 class="foh-section-heading ${accent}">${esc(label)}</h3>${_unavail(label, obj && obj.reason)}</div>`;
  }
  const body = obj.narrative || obj.confirms || obj.cancels || '';
  if (!body) return '';
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading ${accent}">${esc(label)}</h3>
    <div class="foh-body"><p>${esc(body)}</p></div>
  </div>`;
}

function _renderRichOperatorGuidance(g) {
  if (!g || g.available === false) {
    return `<div class="foh-section"><h3 class="foh-section-heading cyan">Operator guidance</h3>${_unavail('Operator guidance', g && g.reason)}</div>`;
  }
  const confirms = g.confirms ? `<p><strong style="color:var(--atlas-green);">Confirms:</strong> ${esc(g.confirms)}</p>` : '';
  const cancels  = g.cancels  ? `<p><strong style="color:var(--atlas-red);">Cancels:</strong> ${esc(g.cancels)}</p>` : '';
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading cyan">Operator guidance</h3>
    <div class="foh-body">${confirms}${cancels}</div>
  </div>`;
}

function _renderRichAffectedMarkets(am) {
  if (!am || am.available === false || !am.buckets) {
    return `<div class="foh-section"><h3 class="foh-section-heading amber">Affected markets</h3>${_unavail('Affected markets', am && am.reason)}</div>`;
  }
  const rows = [];
  for (const k of Object.keys(am.buckets)) {
    if (am.buckets[k] && am.buckets[k].length) {
      rows.push(`<p>• <strong>${esc(k)}:</strong> ${esc(am.buckets[k].slice(0, 6).join(', '))}</p>`);
    }
  }
  if (!rows.length) return `<div class="foh-section"><h3 class="foh-section-heading amber">Affected markets</h3>${_unavail('Affected markets')}</div>`;
  return `<div class="foh-section"><h3 class="foh-section-heading amber">Affected markets</h3><div class="foh-body">${rows.join('')}</div></div>`;
}

function _renderRichHistoricalAggregate(h) {
  if (!h || h.available === false) {
    return `<div class="foh-section"><h3 class="foh-section-heading amber">Historical reaction · lead event</h3>${_unavail('Historical reaction', h && h.reason)}</div>`;
  }
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading amber">Historical reaction · lead event${h.eventLabel ? ' · ' + esc(h.eventLabel) : ''}</h3>
    <div class="foh-body">${renderHistoricalPanel(h)}</div>
  </div>`;
}

function _renderRichFooter(packet) {
  const s = packet.sourceNote || {};
  const parts = [];
  parts.push('calendar=<span class="cyan">' + esc(s.source || 'unavailable') + (s.mode ? '/' + esc(s.mode) : '') + '</span>');
  parts.push('macro=<span class="gold">ATLAS</span>');
  if (s.macroProxies) parts.push(esc(s.macroProxies));
  if (s.probabilityBasis) parts.push('probability=' + esc(s.probabilityBasis));
  return `
  <div class="foh-footer">
    ${parts.join(' · ')}
    <div style="margin-top:4px;">Bias remains conditional until price confirms through structure.</div>
  </div>`;
}

function _renderRichTerminologyChip(packet) {
  const g = packet.glossaryTerms || {};
  if (!g.available) return '';
  const url = g.glossaryUrl || 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a';
  const terms = Array.isArray(g.terms) && g.terms.length ? g.terms : ['Dovish','Hawkish','Yield curve','Risk-off','Liquidity sweep'];
  const chips = terms.map(t => '<a href="' + esc(url) + '">' + esc(t) + '</a>').join('');
  return `<div class="foh-hyperlinks">
    <span class="foh-hyperlinks-label">📘 Expanded Terminology</span>
    ${chips}
  </div>`;
}

function _renderRichBanner(packet) {
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
  const k = packet.mode || 'daily';
  const badges = renderFormatBadges(packet);
  return `
  <div class="foh-banner">
    <div class="foh-banner-title">${esc(titleMap[k] || titleMap.daily)}</div>
    <div class="foh-banner-sub">${esc(subtitleMap[k] || '')}${badges}</div>
  </div>`;
}

function _renderRichMarketIntelCard(packet) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${_CSS}</style></head>
<body>
  <div class="foh-card">
    ${_renderRichBanner(packet)}
    ${_renderMarketStateSection(packet.marketState)}
    ${_renderMondayFocusSection(packet.mondayOpenFocus)}
    ${_renderRichEventClusters(packet.eventClusters, packet.mode)}
    ${_renderAggregateSection('Market impact · transmission chain', 'amber', packet.marketImpact)}
    ${_renderRichAffectedMarkets(packet.affectedMarkets)}
    ${_renderAggregateSection('Confirmation path', 'green', packet.confirmationPath)}
    ${_renderAggregateSection('Cancellation path', 'red',   packet.cancellationPath)}
    ${_renderRichOperatorGuidance(packet.operatorGuidance)}
    ${_renderRichHistoricalAggregate(packet.historicalReaction)}
    ${_renderRichTerminologyChip(packet)}
    ${_renderRichFooter(packet)}
  </div>
</body></html>`;
}

function renderMarketIntelCard(payload) {
  payload = payload || {};
  // Rich FOH packet path (operator brief 2026-05-16) — full
  // product depth. Detected via marketState + eventClusters.
  if (_isRichPacket(payload)) {
    return _renderRichMarketIntelCard(payload);
  }
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
