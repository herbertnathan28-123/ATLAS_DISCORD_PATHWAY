'use strict';

// ============================================================
// renderers/foh/darkHorseCard.js
//
// Builds the HTML/CSS card for Dark Horse FOH (live scan,
// standouts, lifecycle treatment: FRESH / STILL ACTIVE / FADING).
//
// Input shape (`payload`):
//   {
//     scanTime:        'YYYY-MM-DD HH:MM UTC',
//     marketsScanned:  N,
//     marketMood:      { discs, label, severity },
//     standouts: [
//       { symbol, lifecycle: 'FRESH'|'STILL ACTIVE'|'FADING',
//         direction, score, sizeLabel, dollarRisk, rewardR,
//         firstDetected, durationAlive,
//         reason, decisionLevel, invalidation, chartUrl? },
//       ...
//     ],
//     riskReminder:    'paragraph',
//     briefingSummary: 'paragraph',
//     terminology:     ['Decision Level','Entry Zone',...],
//     sourceNote:      { source, mode, probabilityBasis, macroNote? },
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

function lifecycleClass(lc) {
  const v = String(lc || '').toUpperCase();
  if (/FRESH/.test(v))   return 'fresh';
  if (/FADING/.test(v))  return 'fading';
  return 'active';
}

function lifecycleSeverityLabel(lc) {
  const v = String(lc || '').toUpperCase();
  if (/FRESH/.test(v))   return '🆕 FRESH — just appeared on this scan';
  if (/FADING/.test(v))  return '🟥 FADING — late-stage move, quarter-size only';
  return '🟧 STILL ACTIVE — continuation watch, standard account-risk cap after confirmation';
}

function renderPricePointPlan(plan) {
  if (!plan) return '';
  return `
    <div class="foh-dh-price-grid">
      <div><span>Entry reference price</span><strong>${esc(plan.entryReferencePrice)}</strong></div>
      <div><span>Confirmation condition</span><strong>${esc(plan.confirmationCondition)}</strong></div>
      <div><span>Invalidation / exit price</span><strong>${esc(plan.invalidationExitPrice)}</strong></div>
      <div><span>Minimum ATLAS Buffer</span><strong>${esc(plan.minimumAtlasBuffer)}</strong></div>
      <div><span>Technical distance</span><strong>${esc(plan.technicalDistance)}</strong></div>
      <div><span>Unit type</span><strong>${esc(plan.unitType)}</strong></div>
      <div class="wide"><span>Buffer reason</span><strong>${esc(plan.bufferReason)}</strong></div>
      <div class="wide"><span>Risk basis</span><strong>${esc(plan.riskBasis)}</strong></div>
    </div>`;
}

function renderTerminologyChip(payload) {
  const terms = Array.isArray(payload.terminology) && payload.terminology.length
    ? payload.terminology
    : ['Decision Level','Entry Zone','Watch Level','Caution Zone','Invalidation','Confirmed Candle Close','Account Risk','Reward-to-Risk'];
  const chips = terms.map(t => `<span class="foh-term-chip">${esc(t)}</span>`).join('');
  return `<div class="foh-hyperlinks">
    <span class="foh-hyperlinks-label">📘 EXPANDED TERMINOLOGY HYPERLINKS</span>
    ${chips}
  </div>`;
}

function renderStandout(s, idx, total) {
  const lcClass = lifecycleClass(s.lifecycle);
  const lcLabel = lifecycleSeverityLabel(s.lifecycle);
  const pill = lcClass === 'fresh' ? 'fresh' : lcClass === 'fading' ? 'fading' : 'active';
  const firstDet = s.firstDetected ? `<div class="foh-dh-candidate-meta">First logged: <strong>${esc(s.firstDetected)}</strong>${s.durationAlive ? ' · First active: <strong>' + esc(s.firstDetected) + '</strong> · Still Dark Horse worthy after <strong>' + esc(s.durationAlive) + '</strong>' : ''}</div>` : '';
  const reason = s.reason ? `<div class="foh-dh-candidate-meta">${esc(s.reason)}</div>` : '';
  const decisionLevel = s.decisionLevel ? `<div class="foh-dh-candidate-meta">🎯 Decision level: <strong>${esc(s.decisionLevel)}</strong></div>` : '';
  const invalidation = s.invalidation ? `<div class="foh-dh-candidate-meta">❌ Invalidation: <strong>${esc(s.invalidation)}</strong></div>` : '';
  const move = s.moveMetrics ? `<div class="foh-dh-candidate-meta">${esc((s.temperatureMarker && s.temperatureMarker.icon || '⚠️') + ' ' + (s.temperatureMarker && s.temperatureMarker.label || 'CAUTION'))} · Move <strong>${esc(s.moveMetrics.todayPct == null ? 'pending' : (s.moveMetrics.todayPct >= 0 ? '+' : '') + Number(s.moveMetrics.todayPct).toFixed(1) + '% today')}</strong> · 30D <strong>${esc(s.moveMetrics.growth30D == null ? 'pending' : (s.moveMetrics.growth30D >= 0 ? '+' : '') + Number(s.moveMetrics.growth30D).toFixed(1) + '%')}</strong> · YTD <strong>${esc(s.moveMetrics.growthYTD == null ? 'pending' : (s.moveMetrics.growthYTD >= 0 ? '+' : '') + Number(s.moveMetrics.growthYTD).toFixed(1) + '%')}</strong></div>` : '';
  const riskNote = s.amplifiedInstrument && s.riskDisclosure ? `<div class="foh-dh-candidate-meta">⚠️ ${esc(s.riskDisclosure)}</div>` : '';
  const risk = s.pricePointPlan ? `<div class="foh-dh-candidate-meta">💲 Account risk: <strong>${esc(s.pricePointPlan.riskCap.text)}</strong>${s.rewardR ? ' · target <strong>' + esc(s.rewardR) + '</strong>' : ''}</div>` : (s.dollarRisk ? `<div class="foh-dh-candidate-meta">💲 Account risk: <strong>size by account percentage at invalidation</strong>${s.rewardR ? ' · target <strong>' + esc(s.rewardR) + '</strong>' : ''}</div>` : '');
  return `
  <div class="foh-dh-candidate ${lcClass}">
    <div class="foh-dh-candidate-head">
      <div>
        <span class="foh-pill ${pill}">${esc(s.lifecycle || 'ACTIVE')}</span>
        <span class="foh-dh-candidate-sym">${esc(s.symbol || '???')}</span>
        <span style="color:var(--atlas-text-dim);font-size:12px;margin-left:8px;">STANDOUT #${idx + 1} of ${total}${s.direction ? ' · ' + esc(s.direction) : ''}${typeof s.score === 'number' ? ' · score ' + s.score + '/10' : ''}</span>
      </div>
    </div>
    <div class="foh-dh-candidate-meta"><em>${esc(lcLabel)}</em></div>
    ${firstDet}
    ${reason}
    ${move}
    ${riskNote}
    ${decisionLevel}
    ${invalidation}
    ${renderPricePointPlan(s.pricePointPlan)}
    ${risk}
  </div>`;
}

// ── RICH FOH PACKET PATH (operator brief 2026-05-16 product depth) ──
// Detected via marketState + scanState presence on the payload.
function _isRichDhPacket(p) {
  return p && p.scanState && p.marketState && typeof p.marketState.available === 'boolean';
}
function _dhUnavail(label, reason) {
  return `<div class="foh-body"><p><em style="color:var(--atlas-text-dim);">${esc(label)} — sourced unavailable${reason ? ' (' + esc(reason) + ')' : ''}.</em></p></div>`;
}
function _renderDhMarketState(ms) {
  if (!ms || !ms.available) {
    return `<div class="foh-section"><h3 class="foh-section-heading cyan">Market state · macro regime</h3>${_dhUnavail('Live macro context', ms && ms.reason)}</div>`;
  }
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading cyan">Market state · macro regime</h3>
    <div class="foh-body">
      <p><strong>US Dollar Index:</strong> bias ${esc(ms.dxy.bias)} · level ${esc(ms.dxy.level)}</p>
      <p><strong>CBOE Volatility Index:</strong> ${esc(ms.vix.level)}</p>
      <p><strong>Yield curve:</strong> ${esc(ms.yield.regime)}</p>
      <p><strong>Regime read:</strong> ${esc(ms.regime)}</p>
    </div>
  </div>`;
}
function _renderDhRichStandout(s, idx, total) {
  const lcClass = lifecycleClass(s.lifecycle);
  const lcLabel = lifecycleSeverityLabel(s.lifecycle);
  const pill = lcClass === 'fresh' ? 'fresh' : lcClass === 'fading' ? 'fading' : 'active';
  const lines = [];
  if (s.firstDetected) lines.push(`<div class="foh-dh-candidate-meta">First logged: <strong>${esc(s.firstDetected)}</strong>${s.durationAlive ? ' · First active: <strong>' + esc(s.firstDetected) + '</strong> · Still Dark Horse worthy after <strong>' + esc(s.durationAlive) + '</strong>' : ''}</div>`);
  if (s.whyFlagged)     lines.push(`<div class="foh-dh-candidate-meta">${esc(s.whyFlagged)}</div>`);
  if (s.moveMetrics) {
    const pct = v => v == null ? 'pending' : ((v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%');
    lines.push(`<div class="foh-dh-candidate-meta">${esc((s.temperatureMarker && s.temperatureMarker.icon || '⚠️') + ' ' + (s.temperatureMarker && s.temperatureMarker.label || 'CAUTION'))} · Move <strong>${esc(pct(s.moveMetrics.todayPct))}</strong> today · 30D <strong>${esc(pct(s.moveMetrics.growth30D))}</strong> · YTD <strong>${esc(pct(s.moveMetrics.growthYTD))}</strong></div>`);
    if (s.moveMetrics.plainEnglish) lines.push(`<div class="foh-dh-candidate-meta">${esc(s.moveMetrics.plainEnglish)}</div>`);
  }
  if (s.amplifiedInstrument && s.riskDisclosure) lines.push(`<div class="foh-dh-candidate-meta">⚠️ ${esc(s.riskDisclosure)}</div>`);
  if (s.structureState) lines.push(`<div class="foh-dh-candidate-meta">📐 Structure: <strong>${esc(s.structureState)}</strong></div>`);
  if (s.decisionLevel)  lines.push(`<div class="foh-dh-candidate-meta">🎯 Decision level: <strong>${esc(s.decisionLevel)}</strong></div>`);
  if (s.confirmation)   lines.push(`<div class="foh-dh-candidate-meta">✅ Confirms: ${esc(s.confirmation)}</div>`);
  if (s.invalidation)   lines.push(`<div class="foh-dh-candidate-meta">❌ Invalidation: <strong>${esc(s.invalidation)}</strong></div>`);
  if (s.pricePointPlan) lines.push(renderPricePointPlan(s.pricePointPlan));
  if (s.continuationWindow) lines.push(`<div class="foh-dh-candidate-meta">⏱️ Window: ${esc(s.continuationWindow)}</div>`);
  if (s.lateEntryRisk)  lines.push(`<div class="foh-dh-candidate-meta">⚠️ Late-entry risk: <strong>${esc(s.lateEntryRisk)}</strong></div>`);
  if (s.atlasState)     lines.push(`<div class="foh-dh-candidate-meta">🛰️ ATLAS state: ${esc(s.atlasState)}</div>`);
  if (s.pricePointPlan) lines.push(`<div class="foh-dh-candidate-meta">💲 Account risk: <strong>${esc(s.pricePointPlan.riskCap.text)}</strong>${s.rewardR ? ' · target <strong>' + esc(s.rewardR) + '</strong>' : ''}</div>`);
  else if (s.dollarRisk) lines.push(`<div class="foh-dh-candidate-meta">💲 Account risk: <strong>size by account percentage at invalidation</strong>${s.rewardR ? ' · target <strong>' + esc(s.rewardR) + '</strong>' : ''}</div>`);
  return `
  <div class="foh-dh-candidate ${lcClass}">
    <div class="foh-dh-candidate-head">
      <div>
        <span class="foh-pill ${pill}">${esc(s.lifecycle || 'ACTIVE')}</span>
        <span class="foh-dh-candidate-sym">${esc(s.symbol || '???')}</span>
        <span style="color:var(--atlas-text-dim);font-size:12px;margin-left:8px;">STANDOUT #${idx + 1} of ${total}${s.direction ? ' · ' + esc(s.direction) : ''}${typeof s.score === 'number' ? ' · score ' + s.score + '/10' : ''}${s.sectionLabel ? ' · ' + esc(s.sectionLabel) : ''}</span>
      </div>
    </div>
    <div class="foh-dh-candidate-meta"><em>${esc(lcLabel)}</em></div>
    ${lines.join('')}
  </div>`;
}
function _renderDhNearMisses(nm) {
  if (!nm || nm.available === false) {
    return `<div class="foh-section"><h3 class="foh-section-heading amber">Near-miss watchlist</h3>${_dhUnavail('Near-miss watchlist', nm && nm.reason)}</div>`;
  }
  const rows = nm.candidates.map(c => `<li><strong>${esc(c.symbol)}</strong> · ${esc(c.direction)} · score <strong>${esc(c.score)}/10</strong> · ${esc(c.section)}</li>`).join('');
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading amber">Near-miss watchlist · 5-7 score band (${nm.count})</h3>
    <div class="foh-body"><ul style="margin:0;padding:0 0 0 18px;">${rows}</ul></div>
  </div>`;
}
function _renderDhUniverseCoverage(uc) {
  if (!uc || uc.available === false) {
    return `<div class="foh-section"><h3 class="foh-section-heading cyan">Universe coverage</h3>${_dhUnavail('Universe coverage', uc && uc.reason)}</div>`;
  }
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading cyan">Universe coverage</h3>
    <div class="foh-body">
      <p><strong>Symbols scanned:</strong> ${esc(uc.scanned)} · <strong>Watch (≥8):</strong> ${esc(uc.watch)} · <strong>Internal (5-7):</strong> ${esc(uc.internal)} · <strong>Ignored (<5):</strong> ${esc(uc.ignored)}</p>
    </div>
  </div>`;
}
function _renderDhAggregate(label, accent, obj) {
  if (!obj || obj.available === false) {
    return `<div class="foh-section"><h3 class="foh-section-heading ${accent}">${esc(label)}</h3>${_dhUnavail(label, obj && obj.reason)}</div>`;
  }
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading ${accent}">${esc(label)}</h3>
    <div class="foh-body"><p>${esc(obj.narrative || obj.confirms || obj.cancels || '')}</p></div>
  </div>`;
}
function _renderDhOperatorGuidance(g) {
  if (!g || g.available === false) {
    return `<div class="foh-section"><h3 class="foh-section-heading cyan">Operator guidance</h3>${_dhUnavail('Operator guidance', g && g.reason)}</div>`;
  }
  return `
  <div class="foh-section">
    <h3 class="foh-section-heading cyan">Operator guidance</h3>
    <div class="foh-body">
      <p><strong style="color:var(--atlas-green);">Confirms:</strong> ${esc(g.confirms)}</p>
      <p><strong style="color:var(--atlas-red);">Cancels:</strong> ${esc(g.cancels)}</p>
    </div>
  </div>`;
}
function _renderDhRichCard(packet) {
  const standouts = Array.isArray(packet.standouts) ? packet.standouts : [];
  const mood = packet.marketMood || {};
  const moodSev = severityClass(mood.severity);
  const moodPanel = mood.available
    ? `<div class="foh-severity-panel ${moodSev}"><span><span class="foh-disc-bar">${esc(mood.discs || '⚫⚫⚫⚫⚫')}</span><span class="foh-disc-bar-label">${esc(mood.label || 'Market mood')}</span></span><span class="foh-severity-tag">MARKET MOOD</span></div>`
    : _dhUnavail('Market mood', mood.reason);
  const standoutBlocks = standouts.length
    ? standouts.map((s, i) => _renderDhRichStandout(s, i, standouts.length)).join('')
    : _dhUnavail('Standouts', 'no candidates ≥ score threshold on this scan');
  const ss = packet.scanState || {};
  const badges = renderFormatBadges(packet);
  const source = packet.sourceNote || {};
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${_CSS}</style></head>
<body>
  <div class="foh-card">
    <div class="foh-banner">
      <div class="foh-banner-title">ATLAS · Dark Horse — Live Scan</div>
      <div class="foh-banner-sub">v6 · ${esc(standouts.length)} standout${standouts.length === 1 ? '' : 's'}${ss.scanTime ? ' · scan ' + esc(ss.scanTime) : ''}${ss.marketsScanned ? ' · ' + esc(ss.marketsScanned) + ' markets scanned' : ''}${badges}</div>
    </div>
    ${_renderDhMarketState(packet.marketState)}
    <div class="foh-section">
      <h3 class="foh-section-heading amber">Market mood · regime</h3>
      <div class="foh-body">${moodPanel}</div>
    </div>
    <div class="foh-section">
      <h3 class="foh-section-heading gold">Standouts</h3>
      <div class="foh-body">${standoutBlocks}</div>
    </div>
    ${_renderDhAggregate('Market impact', 'amber', packet.marketImpact)}
    ${_renderDhOperatorGuidance(packet.operatorGuidance)}
    ${_renderDhNearMisses(packet.nearMisses)}
    ${_renderDhUniverseCoverage(packet.universeCoverage)}
    ${_renderDhAggregate('Risk reminder', 'red', packet.riskReminder)}
    ${renderTerminologyChip(packet)}
    <div class="foh-footer">
      calendar=<span class="cyan">${esc(source.source || 'TradingView')}${source.mode ? '/' + esc(source.mode) : ''}</span> · macro=<span class="gold">ATLAS</span>${source.macroProxies ? ' · ' + esc(source.macroProxies) : ''} · probability=${esc(source.probabilityBasis || 'engine-derived')}
      <div style="margin-top:4px;">Live confirmation required before execution.</div>
    </div>
  </div>
</body></html>`;
}

function renderDarkHorseCard(payload) {
  payload = payload || {};
  if (_isRichDhPacket(payload)) return _renderDhRichCard(payload);
  const standouts = Array.isArray(payload.standouts) ? payload.standouts : [];
  const standoutBlocks = standouts.map((s, i) => renderStandout(s, i, standouts.length)).join('');

  const mood = payload.marketMood || {};
  const moodSev = severityClass(mood.severity);
  const moodPanel = `
    <div class="foh-severity-panel ${moodSev}">
      <span><span class="foh-disc-bar">${esc(mood.discs || '⚫⚫⚫⚫⚫')}</span><span class="foh-disc-bar-label">${esc(mood.label || 'Market mood')}</span></span>
      <span class="foh-severity-tag">MARKET MOOD</span>
    </div>`;

  const reminder = payload.riskReminder ? `
    <div class="foh-section">
      <h3 class="foh-section-heading red">Risk reminder</h3>
      <div class="foh-body"><p><em>${esc(payload.riskReminder)}</em></p></div>
    </div>` : '';

  const briefing = payload.briefingSummary ? `
    <div class="foh-section">
      <h3 class="foh-section-heading cyan">Briefing summary</h3>
      <div class="foh-body"><p><em>${esc(payload.briefingSummary)}</em></p></div>
    </div>` : '';

  const sourceNote = payload.sourceNote || {};
  const footer = `
    <div class="foh-footer">
      calendar=<span class="cyan">${esc(sourceNote.source || 'tradingview')}${sourceNote.mode ? '/' + esc(sourceNote.mode) : ''}</span> · macro=<span class="gold">ATLAS</span> · probability=${esc(sourceNote.probabilityBasis || 'engine-derived')}
      <div style="margin-top:4px;">Live confirmation required before execution.</div>
    </div>`;

  const badges = renderFormatBadges(payload);
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${_CSS}</style></head>
<body>
  <div class="foh-card">
    <div class="foh-banner">
      <div class="foh-banner-title">ATLAS · Dark Horse — Live Scan</div>
      <div class="foh-banner-sub">v6 · ${esc(standouts.length)} standout${standouts.length === 1 ? '' : 's'} · scan ${esc(payload.scanTime || 'now')}${payload.marketsScanned ? ' · ' + esc(payload.marketsScanned) + ' markets scanned' : ''}${badges}</div>
    </div>
    <div class="foh-section">
      <h3 class="foh-section-heading amber">Market mood · regime</h3>
      <div class="foh-body">${moodPanel}</div>
    </div>
    <div class="foh-section">
      <h3 class="foh-section-heading gold">Standouts</h3>
      <div class="foh-body">${standoutBlocks || '<p><em>No standouts on this scan window.</em></p>'}</div>
    </div>
    ${reminder}
    ${renderTerminologyChip(payload)}
    ${briefing}
    ${footer}
  </div>
</body></html>`;
}

module.exports = { renderDarkHorseCard };
