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
    <div class="foh-section-body">${blocks}</div>
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
    <div class="foh-section-body">${rows}</div>
  </div>`;
}

function renderOperatorGuidance(g) {
  if (!g || (!g.confirms && !g.cancels)) return '';
  const confirms = g.confirms ? `<p><strong style="color:var(--atlas-green);">Confirms:</strong> ${esc(g.confirms)}</p>` : '';
  const cancels  = g.cancels  ? `<p><strong style="color:var(--atlas-red);">Cancels:</strong> ${esc(g.cancels)}</p>` : '';
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading cyan">Operator guidance</h3>
    <div class="foh-section-body">${confirms}${cancels}</div>
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
    <div class="foh-section-body">
      <p><strong>US Dollar Index:</strong> bias ${esc(ms.dxy.bias)} · level ${esc(ms.dxy.level)}</p>
      <p><strong>CBOE Volatility Index:</strong> ${esc(ms.vix.level)}</p>
      <p><strong>Yield curve:</strong> ${esc(ms.yield.regime)}</p>
      <p><strong>Regime read:</strong> ${esc(ms.regime)} · geopolitical level ${esc(ms.geoLevel)}</p>
    </div>
  </div>`;
}

function _renderMondayFocusSection(mof) {
  if (!mof || !mof.available) return ''; // weekend-only section — silent when not weekend
  // The narrative already contains a "Lead exposure: …" phrase; do
  // NOT emit a second redundant "Lead exposure:" line below it.
  // Operator screenshots 2026-05-17 flagged the duplicate line.
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading gold">Monday open focus</h3>
    <div class="foh-section-body">
      <p>${esc(mof.narrative)}</p>
    </div>
  </div>`;
}

function _renderRichEvent(ev) {
  const sevCls = ev.severity === 'HIGH' ? 'high' : ev.severity === 'MEDIUM' ? 'med' : ev.severity === 'ELEVATED' ? 'elev' : 'low';
  const sevTag = ev.severity + ' IMPACT';
  // Numeric strip — Actual / Forecast / Previous as labelled chips.
  const numChips = [];
  if (ev.actual   != null) numChips.push('<div class="num"><span class="label">Actual</span><span class="value">' + esc(ev.actual) + '</span></div>');
  if (ev.forecast != null) numChips.push('<div class="num"><span class="label">Forecast</span><span class="value">' + esc(ev.forecast) + '</span></div>');
  if (ev.previous != null) numChips.push('<div class="num"><span class="label">Previous</span><span class="value">' + esc(ev.previous) + '</span></div>');
  const numericsBlock = numChips.length ? '<div class="foh-event-numerics">' + numChips.join('') + '</div>' : '';
  // Driver line drop when generic "Scheduled CCY release" — keep
  // only when distinct from whyExpanded (avoids redundancy).
  const driverLine = ev.driverLine && !/^Scheduled [A-Z]{3} release/.test(ev.driverLine)
    ? '<p style="color:var(--atlas-text-dim);font-size:13px;margin:0 0 8px 0;">' + esc(ev.driverLine) + '</p>'
    : '';
  // Historical reaction — neutral outlined footer, never washed.
  const histPanel = (ev.historicalReaction && ev.historicalReaction.available)
    ? renderHistoricalPanel({ rows: ev.historicalReaction.rows, basis: ev.historicalReaction.basis, sampleN: ev.historicalReaction.sampleN })
    : `<div class="foh-historical"><div class="foh-historical-title">📅 Historical reaction</div><p><em style="color:var(--atlas-text-dim);">sourced unavailable (${esc((ev.historicalReaction && ev.historicalReaction.reason) || 'no sample')})</em></p></div>`;
  const bda = ev.beforeDuringAfter || {};
  return `
  <div class="foh-event-card">
    <div class="foh-event-header ${sevCls}">
      <span>
        <span class="foh-event-header-tier">${esc(sevTag)}</span>
        &nbsp;&nbsp;<span class="foh-event-header-title">${esc(ev.title)}</span>
      </span>
      <span class="foh-event-header-meta">${esc(ev.time)} · ${esc(ev.currency)}</span>
    </div>
    <div class="foh-event-body">
      ${driverLine}
      ${numericsBlock}
      <div class="foh-event-subsection">
        <div class="foh-event-subsection-label gold">Why this matters</div>
        <p style="margin:0;">${esc(ev.whyExpanded)}</p>
      </div>
      <div class="foh-event-subsection">
        <div class="foh-event-subsection-label">Market impact · transmission chain</div>
        <div class="foh-event-quote">${esc(ev.marketImpact)}</div>
      </div>
      <div class="foh-event-subsection">
        <div class="foh-event-subsection-label cyan">Before · During · After</div>
        <div class="foh-event-bda">
          <div class="foh-event-bda-row"><span class="stage-label">BEFORE</span>${esc(bda.before || '—')}</div>
          <div class="foh-event-bda-row"><span class="stage-label">DURING</span>${esc(bda.during || '—')}</div>
          <div class="foh-event-bda-row"><span class="stage-label">AFTER</span>${esc(bda.after || '—')}</div>
        </div>
      </div>
      <div class="foh-event-actions">
        <div class="action confirms"><span class="action-label">Confirms</span>${esc(ev.confirmationPath)}</div>
        <div class="action cancels"><span class="action-label">Cancels</span>${esc(ev.cancellationPath)}</div>
      </div>
      ${histPanel}
    </div>
  </div>`;
}

// Compact event row — used for non-featured events on the daily
// / weekend surface. Keeps the surface scannable while the
// featured event gets the full prototype-grade depth.
function _renderCompactEvent(ev, currency) {
  const sevCls = ev.severity === 'HIGH' ? 'high' : ev.severity === 'MEDIUM' ? 'med' : 'low';
  return `
  <div class="foh-event-row ${sevCls}">
    <span class="foh-event-row-tier ${sevCls}">${esc(ev.severity + ' IMPACT')}</span>
    <span class="foh-event-row-title">${esc(ev.title)}</span>
    <span class="foh-event-row-meta">${esc(ev.time)} · ${esc(ev.currency || currency || 'multi')}</span>
  </div>`;
}

function _renderRichEventClusters(clusters, mode, featuredEventKey) {
  if (!Array.isArray(clusters) || !clusters.length) {
    return `<div class="foh-section"><h3 class="foh-section-heading gold">Event clusters</h3>${_unavail('No clustered catalysts inside the window')}</div>`;
  }
  const blocks = clusters.map(c => {
    const sevCls = c.severity === 'HIGH' ? 'high' : c.severity === 'MEDIUM' ? 'med' : 'low';
    const flag = c.country ? esc(c.country) + ' · ' : '';
    const events = (c.events || []).map(ev => {
      const evKey = c.currency + '::' + ev.title + '::' + ev.time;
      return evKey === featuredEventKey ? _renderRichEvent(ev) : _renderCompactEvent(ev, c.currency);
    }).join('');
    return `
    <div class="foh-event-cluster">
      <div class="foh-event-cluster-title">${flag}${esc(c.currency || 'BLOCK')} BLOCK · ${(c.events || []).length} event${(c.events || []).length === 1 ? '' : 's'} <span class="foh-pill ${sevCls}">${esc(c.severity)}</span></div>
      ${events}
    </div>`;
  }).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading gold">Event clusters${mode === 'weekend' ? ' · weekly window' : ''}</h3>
    <div class="foh-section-body">${blocks}</div>
  </div>`;
}

// ── DEPTH RENDERERS (prototype-grade decision context) ──────

function _renderDollarImpactRange(dir, label) {
  if (!dir || !dir.available) {
    return `<div class="foh-section"><h3 class="foh-section-heading amber">💲 Dollar impact range${label ? ' · ' + esc(label) : ''}</h3>${_unavail('Dollar impact range', dir && dir.reason)}</div>`;
  }
  const rows = dir.first60sRanges.map(r => `<li><strong>${esc(r.range)}</strong> on ${esc(r.asset)}</li>`).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading amber">💲 Dollar impact range${label ? ' · ' + esc(label) : ''}</h3>
    <div class="foh-section-body">
      <p><strong style="color:var(--atlas-gold);">First-60-second swing range:</strong></p>
      <ul style="margin:4px 0 8px 18px;padding:0;">${rows}</ul>
      <p><strong style="color:var(--atlas-gold);">Post-settle trend move:</strong> ${esc(dir.postSettleRange)}</p>
      <p style="margin-top:6px;font-size:11px;color:var(--atlas-text-dim);font-style:italic;">basis: ${esc(dir.basis)}</p>
    </div>
  </div>`;
}

function _renderReactionPaths(rp, label) {
  if (!rp || rp.available === false || !Array.isArray(rp.scenarios)) {
    return `<div class="foh-section"><h3 class="foh-section-heading red">🎯 Reaction paths · 4 outcomes${label ? ' · ' + esc(label) : ''}</h3>${_unavail('Reaction paths', rp && rp.reason)}</div>`;
  }
  const scenarioColour = (id) => id === 'hawkish' ? 'red' : id === 'dovish' ? 'green' : id === 'inline' ? 'cyan' : 'amber';
  const blocks = rp.scenarios.map(s => {
    const colour = scenarioColour(s.id);
    const markets = (s.affectedMarkets || []).map(m => '<span class="foh-pill low" style="margin-right:4px;font-weight:600;">' + esc(m) + '</span>').join('');
    const beh = (s.expectedBehaviour || []).map(b => '<li>' + esc(b) + '</li>').join('');
    const impact = (s.dollarImpactPerAsset || []).map(i =>
      '<li><strong>' + esc(i.asset) + ':</strong> ' + esc(i.impact) + ' (' + esc(i.direction) + ')</li>'
    ).join('');
    const shouldDo = (s.shouldDo || []).map(x => '<li>✓ ' + esc(x) + '</li>').join('');
    const shouldNot = (s.shouldNotDo || []).map(x => '<li>✘ ' + esc(x) + '</li>').join('');
    return `
    <div class="foh-event-card" style="margin:10px 0;">
      <div class="foh-event-header ${colour === 'red' ? 'high' : colour === 'green' ? 'low' : colour === 'cyan' ? 'neutral' : 'elev'}">
        <span><span class="foh-event-header-tier">${esc(s.id.toUpperCase())}</span>&nbsp;&nbsp;<span class="foh-event-header-title">${esc(s.label)}</span></span>
      </div>
      <div class="foh-event-body">
        <div class="foh-event-subsection">
          <div class="foh-event-subsection-label gold">Affected markets</div>
          <div>${markets}</div>
        </div>
        <div class="foh-event-subsection">
          <div class="foh-event-subsection-label">Expected behaviour</div>
          <ul style="margin:4px 0 0 18px;padding:0;">${beh}</ul>
        </div>
        ${impact ? `<div class="foh-event-subsection">
          <div class="foh-event-subsection-label gold">💲 Dollar impact (first 30 min post-release)</div>
          <ul style="margin:4px 0 0 18px;padding:0;">${impact}</ul>
        </div>` : ''}
        <div class="foh-event-actions">
          <div class="action confirms"><span class="action-label">What you should do</span><ul style="margin:4px 0 0 18px;padding:0;">${shouldDo}</ul></div>
          <div class="action cancels"><span class="action-label">What you should NOT do</span><ul style="margin:4px 0 0 18px;padding:0;">${shouldNot}</ul></div>
        </div>
      </div>
    </div>`;
  }).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading red">🎯 Reaction paths · 4 outcomes${label ? ' · ' + esc(label) : ''}</h3>
    <div class="foh-section-body">${blocks}</div>
  </div>`;
}

function _renderRiskEscalation(re) {
  if (!re || re.available === false || !Array.isArray(re.stages)) {
    return `<div class="foh-section"><h3 class="foh-section-heading red">⚠️ Risk escalation · time-windowed behaviour</h3>${_unavail('Risk escalation', re && re.reason)}</div>`;
  }
  const sevToCls = (sev) => sev === 'HIGH' ? 'high' : sev === 'MEDIUM' ? 'med' : 'low';
  const rows = re.stages.map(s => `
    <div class="foh-event-card" style="margin:8px 0;">
      <div class="foh-event-header ${sevToCls(s.severity)}">
        <span><span class="foh-event-header-tier">${esc(s.stage)}</span>&nbsp;&nbsp;<span class="foh-event-header-title">${esc(s.label)}</span></span>
        <span class="foh-event-header-meta">${esc(s.timeWindow)}</span>
      </div>
      <div class="foh-event-body">
        <p style="margin:0 0 6px 0;">${esc(s.description)}</p>
        <p style="margin:0 0 6px 0;"><strong style="color:var(--atlas-gold);">💲 $ cost:</strong> ${esc(s.dollarCost)}</p>
        <p style="margin:0;"><strong style="color:#6FE8A0;">Action:</strong> ${esc(s.action)}</p>
      </div>
    </div>`).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading red">⚠️ Risk escalation · time-windowed behaviour</h3>
    <div class="foh-section-body">${rows}</div>
  </div>`;
}

function _renderWhatToWatch(wtw) {
  if (!wtw || wtw.available === false) {
    return `<div class="foh-section"><h3 class="foh-section-heading amber">👀 What traders should watch</h3>${_unavail('What to watch', wtw && wtw.reason)}</div>`;
  }
  const fmt = (items, label, colour) => {
    if (!Array.isArray(items) || !items.length) return '';
    const rows = items.map(it => `<li><strong>${esc(it.indicator)}:</strong> ${esc(it.meaning)}${it.action ? ' <em style="color:#6FE8A0;">Action: ' + esc(it.action) + '</em>' : ''}</li>`).join('');
    return `
    <div class="foh-event-subsection">
      <div class="foh-event-subsection-label ${colour}">${esc(label)}</div>
      <ul style="margin:4px 0 0 18px;padding:0;">${rows}</ul>
    </div>`;
  };
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading amber">👀 What traders should watch</h3>
    <div class="foh-section-body">
      ${fmt(wtw.preEvent, 'Pre-event indicators (now → T-5)', 'gold')}
      ${fmt(wtw.during, 'During the event (T-0 → T+5)', 'red')}
      ${fmt(wtw.postEvent, 'Post-event reassessment (T+5 onwards)', 'cyan')}
    </div>
  </div>`;
}

function _renderEventDayReference(ref) {
  if (!ref || ref.available === false) return '';
  const rows = (ref.windows || []).map(w => `
    <div class="foh-event-bda-row">
      <span class="stage-label">${esc(w.label).toUpperCase()}</span>
      <strong>${esc(w.range)}</strong> — ${esc(w.candleBehaviour)}.
      <br><span style="color:var(--atlas-gold);">💲 ${esc(w.dollarContext)}.</span>
      <br><span style="color:#6FE8A0;">Action: ${esc(w.action)}.</span>
    </div>`).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading cyan">📚 Event-day reference · 4 windows</h3>
    <div class="foh-section-body">
      <p style="margin:0 0 8px 0;">${esc(ref.storyBy4Windows)}</p>
      <div class="foh-event-bda">${rows}</div>
    </div>
  </div>`;
}

function _renderComparisonNotes(cn) {
  if (!cn || cn.available === false) return '';
  const what = (cn.whatChangesThisState || []).map(x => '<li>' + esc(x) + '</li>').join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading neutral">📊 Why this rating · what changes it</h3>
    <div class="foh-section-body">
      <p style="margin:0 0 8px 0;"><strong style="color:var(--atlas-gold);">Why this rating, not lower or higher:</strong> ${esc(cn.whyThisRating)}</p>
      <p style="margin:0 0 4px 0;"><strong style="color:var(--atlas-cyan);">What changes this state:</strong></p>
      <ul style="margin:4px 0 0 18px;padding:0;">${what}</ul>
    </div>
  </div>`;
}

function _renderBriefingActions(ba) {
  if (!ba || ba.available === false || !Array.isArray(ba.actions)) return '';
  const rows = ba.actions.map((a, i) => `<li><strong style="color:var(--atlas-gold);">${i + 1}.</strong> ${esc(a)}</li>`).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading gold">📋 Briefing actions</h3>
    <div class="foh-section-body">
      <ol style="margin:4px 0 0 0;padding:0 0 0 4px;list-style:none;">${rows}</ol>
    </div>
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
    <div class="foh-section-body"><p>${esc(body)}</p></div>
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
    <div class="foh-section-body">${confirms}${cancels}</div>
  </div>`;
}

function _renderRichAffectedMarkets(am) {
  if (!am || am.available === false || !am.buckets) {
    return `<div class="foh-section"><h3 class="foh-section-heading amber">Affected markets</h3>${_unavail('Affected markets', am && am.reason)}</div>`;
  }
  const rows = [];
  for (const k of Object.keys(am.buckets)) {
    if (am.buckets[k] && am.buckets[k].length) {
      const cells = am.buckets[k].slice(0, 6).map(s => String(s)).join(', ');
      // Suppress redundant "Header: Header" row (e.g. solo DXY) —
      // same dedup the text-builder enforces; image renderer was
      // previously emitting "• DXY: DXY" (banned regression).
      if (cells === k) {
        rows.push('<p>• <strong>' + esc(k) + '</strong></p>');
      } else {
        rows.push('<p>• <strong>' + esc(k) + ':</strong> ' + esc(cells) + '</p>');
      }
    }
  }
  if (!rows.length) return `<div class="foh-section"><h3 class="foh-section-heading amber">Affected markets</h3>${_unavail('Affected markets')}</div>`;
  return `<div class="foh-section"><h3 class="foh-section-heading amber">Affected markets</h3><div class="foh-section-body">${rows.join('')}</div></div>`;
}

function _renderRichHistoricalAggregate(h) {
  if (!h || h.available === false) {
    return `<div class="foh-section"><h3 class="foh-section-heading amber">Historical reaction · lead event</h3>${_unavail('Historical reaction', h && h.reason)}</div>`;
  }
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading amber">Historical reaction · lead event${h.eventLabel ? ' · ' + esc(h.eventLabel) : ''}</h3>
    <div class="foh-section-body">${renderHistoricalPanel(h)}</div>
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

function _featuredEvent(packet) {
  if (!packet || !packet.featuredEventKey || !Array.isArray(packet.eventClusters)) return null;
  for (const c of packet.eventClusters) {
    for (const ev of (c.events || [])) {
      const k = c.currency + '::' + ev.title + '::' + ev.time;
      if (k === packet.featuredEventKey) return ev;
    }
  }
  return null;
}

function _renderRichMarketIntelCard(packet) {
  const featured = _featuredEvent(packet);
  const featLabel = featured ? featured.title : null;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${_CSS}</style></head>
<body>
  <div class="foh-card">
    ${_renderRichBanner(packet)}
    ${_renderMarketStateSection(packet.marketState)}
    ${_renderMondayFocusSection(packet.mondayOpenFocus)}
    ${_renderRichEventClusters(packet.eventClusters, packet.mode, packet.featuredEventKey)}
    ${featured ? _renderDollarImpactRange(featured.dollarImpactRange, featLabel) : ''}
    ${featured ? _renderReactionPaths(featured.reactionPaths, featLabel) : ''}
    ${_renderRiskEscalation(packet.riskEscalation)}
    ${featured ? _renderWhatToWatch(featured.whatToWatch) : ''}
    ${_renderEventDayReference(packet.eventDayReference)}
    ${_renderAggregateSection('Market impact · transmission chain', 'amber', packet.marketImpact)}
    ${_renderRichAffectedMarkets(packet.affectedMarkets)}
    ${_renderAggregateSection('Confirmation path', 'green', packet.confirmationPath)}
    ${_renderAggregateSection('Cancellation path', 'red',   packet.cancellationPath)}
    ${_renderRichOperatorGuidance(packet.operatorGuidance)}
    ${_renderRichHistoricalAggregate(packet.historicalReaction)}
    ${_renderComparisonNotes(packet.comparisonNotes)}
    ${_renderBriefingActions(packet.briefingActions)}
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
      <div class="foh-section-body"><p>${esc(payload.whyThisMatters)}</p></div>
    </div>` : '';
  const market = payload.marketImpact ? `
    <div class="foh-section">
      <h3 class="foh-section-heading amber">Market impact · transmission chain</h3>
      <div class="foh-section-body"><p>${esc(payload.marketImpact)}</p></div>
    </div>` : '';
  const hist = renderHistoricalPanel(payload.historical);
  const histSection = hist ? `
    <div class="foh-section">
      <h3 class="foh-section-heading amber">Historical reaction</h3>
      <div class="foh-section-body">${hist}</div>
    </div>` : '';
  const briefing = payload.briefingSummary ? `
    <div class="foh-section">
      <h3 class="foh-section-heading cyan">Briefing summary</h3>
      <div class="foh-section-body"><p><em>${esc(payload.briefingSummary)}</em></p></div>
    </div>` : '';
  const nextWatch = payload.nextWatch ? `
    <div class="foh-section">
      <h3 class="foh-section-heading cyan">Next watch window</h3>
      <div class="foh-section-body"><p>⏳ ${esc(payload.nextWatch)}</p></div>
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
