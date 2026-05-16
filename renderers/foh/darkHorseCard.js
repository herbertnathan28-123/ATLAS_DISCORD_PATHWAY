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
//     glossaryUrl:     'https://...',
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
  return '🟧 STILL ACTIVE — continuation watch, full size allowed';
}

function renderTerminologyChip(payload) {
  const terms = Array.isArray(payload.terminology) && payload.terminology.length
    ? payload.terminology
    : ['Decision Level','Entry Zone','Watch Level','Caution Zone','Invalidation','Confirmed Candle Close','Dollar Risk','Reward-to-Risk'];
  const url = payload.glossaryUrl || 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a';
  const chips = terms.map(t => `<a href="${esc(url)}">${esc(t)}</a>`).join('');
  return `<div class="foh-hyperlinks">
    <span class="foh-hyperlinks-label">📘 Expanded Terminology</span>
    ${chips}
  </div>`;
}

function renderStandout(s, idx, total) {
  const lcClass = lifecycleClass(s.lifecycle);
  const lcLabel = lifecycleSeverityLabel(s.lifecycle);
  const pill = lcClass === 'fresh' ? 'fresh' : lcClass === 'fading' ? 'fading' : 'active';
  const firstDet = s.firstDetected ? `<div class="foh-dh-candidate-meta">First detected: <strong>${esc(s.firstDetected)}</strong>${s.durationAlive ? ' · still Dark Horse valid after <strong>' + esc(s.durationAlive) + '</strong>' : ''}</div>` : '';
  const reason = s.reason ? `<div class="foh-dh-candidate-meta">${esc(s.reason)}</div>` : '';
  const decisionLevel = s.decisionLevel ? `<div class="foh-dh-candidate-meta">🎯 Decision level: <strong>${esc(s.decisionLevel)}</strong></div>` : '';
  const invalidation = s.invalidation ? `<div class="foh-dh-candidate-meta">❌ Invalidation: <strong>${esc(s.invalidation)}</strong></div>` : '';
  const risk = s.dollarRisk ? `<div class="foh-dh-candidate-meta">💲 Model risk: <strong>${esc(s.dollarRisk)}</strong>${s.rewardR ? ' · target <strong>' + esc(s.rewardR) + '</strong>' : ''}${s.sizeLabel ? ' · ' + esc(s.sizeLabel) : ''}</div>` : '';
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
    ${decisionLevel}
    ${invalidation}
    ${risk}
  </div>`;
}

function renderDarkHorseCard(payload) {
  payload = payload || {};
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
