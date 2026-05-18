'use strict';

// ============================================================
// renderers/foh/marketIntelV3Shell.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// Prototype shell renderer for Market Intel v3. Owns LAYOUT
// ONLY. Does not call engines. Does not fetch any external
// workspace. Does not invent sections. Does not simplify content.
//
// Inputs:
//   { viewModel, opts }
//
// Outputs:
//   {
//     discordText: <string>,                   // direct intelligence summary
//     pngs: [ { label, html, png?, bytes?, error? } ],
//     pdf:  <Buffer | null>,
//     pdfBytes: <number>,
//     pdfError: <string | null>,
//     htmlPreview: <string | null>,            // only when opts.includeRawHtml
//     params: { …RENDER_PARAMETERS }
//   }
// ============================================================

const protoShell = require('./protoShell');
const miAdapter = require('./marketIntelV3Adapter');
const { renderHtmlsToPngs, renderHtmlToPdf } = require('./pngRenderer');

const RENDER_PARAMETERS = Object.freeze({
  format: ['discord_text', 'png_cards', 'pdf'],
  cardSplit: 'prototype_defined',
  theme: 'atlas_black_gold',
  preserveShell: true,
  maxDiscordChunkChars: 1800,
  attachPdf: true,
  attachImages: true,
  includeRawHtml: false,
  includeExternalLinks: false,
});

// Hard scrub: even if the prototype HTML or the substituted view
// model ever introduces a notion URL, the shell strips it before
// any byte reaches a PNG, PDF, or Discord post.
function _scrubExternalLinks(html) {
  if (typeof html !== 'string' || !html.length) return html;
  return html
    .replace(/https?:\/\/(www\.)?notion\.(so|com|site)\/[^\s)"'\]]*/gi, '#')
    .replace(/<a\s+([^>]*?)href=["']#["']([^>]*)>(.*?)<\/a>/gi, '$3');
}

function _truncate(s, n) {
  if (typeof s !== 'string') return '';
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

const HARD_BOUNDARY = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

function _safeLine(s, fallback) {
  const out = String(s || '').replace(/\s+/g, ' ').trim();
  return out || fallback || 'Pending';
}

function _firstLines(text, count) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, count)
    .join('\n');
}

function _reportId(viewModel, opts, prefix) {
  return (opts && opts.reportId) || viewModel.REPORT_ID || (prefix + '-pending');
}

function _controlBlock(mode) {
  if (mode === 'rendered') {
    return [
      '🧭 Controls:',
      '🖼️ PNG: Available',
      '📄 PDF: Available',
      '📅 Full Calendar: Available',
      '📘 Terms: Available',
      '🔗 Full Briefs: Available / Brief Pending',
    ].join('\n');
  }
  return [
    '🧭 Controls:',
    '📅 Full Calendar: Available',
    '📘 Terms: Available',
    '🔗 Full Briefs: Brief Pending',
    '',
    'Exports:',
    'PNG/PDF pending this cycle.',
  ].join('\n');
}

function _affectedMarketsControl(viewModel) {
  const raw = String(viewModel.AFFECTED_MARKETS_EXPANDED || '');
  const symbols = [];
  for (const match of raw.matchAll(/(?:^|\n)-?\s*([^—\n]+?)\s+—/g)) {
    const s = _safeLine(match[1], '');
    if (s && !symbols.includes(s)) symbols.push(s);
  }
  if (!symbols.length) {
    const fallback = String(viewModel.PRIMARY_EVENT_FOCUS || '').match(/Affected markets:\s*([^\n]+)/i);
    if (fallback) symbols.push(...fallback[1].split(/[·,]/).map(s => s.trim()).filter(Boolean));
  }
  const primary = symbols.slice(0, 4).join(' · ') || 'Mapped markets pending';
  const secondary = symbols.slice(4, 6).join(' · ') || 'Full Brief';
  return [
    '🎯 AFFECTED MARKETS',
    'Primary: ' + primary,
    'Secondary: ' + secondary,
    'More: Full Brief',
  ].join('\n');
}

function _buildMarketIntelControlSurface(viewModel, opts) {
  const reportId = _reportId(viewModel, opts, 'MI');
  const generated = viewModel.GENERATED_AT_UTC || new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const nextRefresh = (opts && opts.nextRefreshUTC) || 'next scheduled refresh';
  const controlsMode = opts && opts.controlsMode === 'pending' ? 'pending' : 'rendered';
  const calendar = _firstLines(viewModel.RANKED_EVENT_CALENDAR, 12) || 'No ranked high-impact events available · Brief Pending';
  const marketImpact = _firstLines(viewModel.MARKET_IMPACT, 5) || 'Market impact summary pending.';
  const briefLine = /Brief Pending/i.test(calendar) ? '🔗 FULL BRIEF: Brief Pending' : '🔗 FULL BRIEF: Available where linked';
  const lines = [
    HARD_BOUNDARY,
    '🟨 NEW MARKET INTEL REPORT',
    'Report ID: ' + reportId,
    'Generated: ' + generated,
    'Part: 1/1',
    HARD_BOUNDARY,
    _controlBlock(controlsMode),
    '',
    '🔴 THE CALL',
    viewModel.THE_CALL || 'Current read: MONITORING — no confirmed execution read yet.',
    '',
    '🟠 HIGH-IMPACT CALENDAR EVENTS',
    calendar,
    '',
    '🟡 RISK STATE',
    'Jane/FOH state: ' + (viewModel.RISK_STATE_DISC_SCALE || 'risk state pending'),
    '',
    '🔵 MARKET IMPACT SUMMARY',
    marketImpact,
    '',
    _affectedMarketsControl(viewModel),
    '',
    briefLine,
    '',
    '🔵 SOURCE NOTE',
    _firstLines(viewModel.SOURCE_PROVENANCE, 2) || 'Source: ATLAS runtime · freshness: LIVE',
    '',
    HARD_BOUNDARY,
    '✅ END OF MARKET INTEL REPORT',
    'Report ID: ' + reportId,
    'Next scheduled refresh: ' + nextRefresh,
    HARD_BOUNDARY,
  ];
  return lines.join('\n');
}

function _buildDarkHorseControlSurface(viewModel, opts) {
  const reportId = _reportId(viewModel, opts, 'DH');
  const generated = viewModel.GENERATED_AT_UTC || new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const currentAdvice = _firstLines(viewModel.WHAT_TO_DO_NOW, 12) || 'No standout advice block published this cycle.';
  const lines = [
    HARD_BOUNDARY,
    '🐎 NEW DARK HORSE REPORT',
    'Report ID: ' + reportId,
    'Generated: ' + generated,
    'Part: 1/1',
    HARD_BOUNDARY,
    '🟡 Market mood: ' + (viewModel.RISK_STATE_DISC_SCALE || 'market mood pending'),
    '',
    '🔴 CURRENT ADVICE — AT RELEASE',
    currentAdvice,
    '',
    'Entry zone: See CURRENT ADVICE block; pending if no executable zone was published.',
    'Stop / invalidation: ' + _safeLine(viewModel.CANCELS_WHEN, 'Pending'),
    'Extended stop: Pending unless shown in the rendered card.',
    'Risk cap: Use reduced size until Jane / structure confirms.',
    'Next review: Next scheduled Dark Horse scan.',
    'Visual/chart: PNG attached when render succeeds.',
    '',
    '🔵 SOURCE NOTE',
    _firstLines(viewModel.SOURCE_PROVENANCE, 2) || 'Source: ATLAS Dark Horse runtime',
    '',
    HARD_BOUNDARY,
    '✅ END OF DARK HORSE REPORT',
    'Report ID: ' + reportId,
    HARD_BOUNDARY,
  ];
  return lines.join('\n');
}

function buildDiscordTextSummary(viewModel, opts) {
  opts = opts || {};
  const maxChars = Number.isFinite(opts.maxDiscordChunkChars) ? opts.maxDiscordChunkChars : RENDER_PARAMETERS.maxDiscordChunkChars;
  const isDarkHorseSurface = /dark horse/i.test(String(viewModel.HEADER_TITLE || viewModel.HEADER_SUBTITLE || opts.surface || ''));
  if (isDarkHorseSurface) {
    return _truncate(_buildDarkHorseControlSurface(viewModel || {}, opts), maxChars);
  }
  const isMarketIntelCalendarSurface = !!(viewModel.THE_CALL || viewModel.RANKED_EVENT_CALENDAR);
  if (isMarketIntelCalendarSurface) {
    return _truncate(_buildMarketIntelControlSurface(viewModel || {}, opts), maxChars);
  }
  // Priority order — the live Discord surface is calendar-first.
  // THE CALL + ranked event table lead, then Market Impact and
  // source provenance fit before the Discord cap. Deeper operator
  // detail expands in the PDF/rendered cards if this summary truncates.
  const lines = [];
  lines.push('**' + viewModel.HEADER_TITLE + ' · ' + viewModel.HEADER_SUBTITLE + '**');
  lines.push('Risk State: ' + viewModel.RISK_STATE_DISC_SCALE);
  lines.push('Generated: ' + viewModel.GENERATED_AT_UTC);
  lines.push('');
  if (isMarketIntelCalendarSurface) {
    lines.push('__Market Impact__');
    lines.push(viewModel.MARKET_IMPACT);
    lines.push('');
    lines.push('__Confirmation / Cancellation__');
    lines.push('Confirms: ' + viewModel.CONFIRMS_WHEN);
    lines.push('Cancels: ' + viewModel.CANCELS_WHEN);
    lines.push('');
    lines.push('__Source / Provenance__');
    lines.push(viewModel.SOURCE_PROVENANCE);
    lines.push('');
    lines.push('__Briefing Summary__');
    lines.push(viewModel.BRIEFING_SUMMARY);
    lines.push('');
  } else {
    lines.push('__Briefing Summary__');
    lines.push(viewModel.BRIEFING_SUMMARY);
    lines.push('');
    lines.push('__Market Impact__');
    lines.push(viewModel.MARKET_IMPACT);
    lines.push('');
  }
  if (!isMarketIntelCalendarSurface) {
    lines.push('__Confirmation / Cancellation__');
    lines.push('Confirms: ' + viewModel.CONFIRMS_WHEN);
    lines.push('Cancels: ' + viewModel.CANCELS_WHEN);
    lines.push('');
    lines.push('__Source / Provenance__');
    lines.push(viewModel.SOURCE_PROVENANCE);
    lines.push('');
  }
  lines.push('__Structure (Spidey Phase D)__');
  lines.push(viewModel.STRUCTURE_SNAPSHOT || '—');
  lines.push('');
  lines.push('__Historical Analogue (Corey Clone)__');
  lines.push(viewModel.HISTORICAL_ANALOGUE || '—');
  lines.push('');
  lines.push('__Operational Read__');
  lines.push(viewModel.OPERATIONAL_NARRATIVE || '—');
  lines.push('');
  lines.push('__What To Do Now__');
  lines.push(viewModel.WHAT_TO_DO_NOW);
  lines.push('');
  lines.push('__Primary Event Focus__');
  lines.push(viewModel.PRIMARY_EVENT_FOCUS || '—');
  return _truncate(lines.join('\n'), maxChars);
}

async function render({ packet, viewModel, opts }) {
  opts = Object.assign({}, RENDER_PARAMETERS, opts || {});
  // The shell consumes either (a) the legacy MI FOH packet via the
  // existing marketIntelV3Adapter for full prototype parity, or
  // (b) a fixed-contract packet for the Discord text summary.
  // Both paths are supported — the dispatch controller passes both.
  const legacyPacket = (opts && opts.legacyPacket) || packet || {};
  let html = protoShell.getMarketIntelV3Html();
  html = miAdapter.adapt(html, legacyPacket);
  html = _scrubExternalLinks(html);

  const cards = protoShell.buildMarketIntelV3Cards(html).map(c => ({ ...c, html: _scrubExternalLinks(c.html) }));
  const [pngBatch, pdfSingle] = await Promise.all([
    renderHtmlsToPngs(cards.map(c => c.html)),
    renderHtmlToPdf(html),
  ]);
  const pngs = (pngBatch && pngBatch.pngs ? pngBatch.pngs : []).map((p, i) => Object.assign({ label: cards[i] && cards[i].label }, p));
  const discordText = buildDiscordTextSummary(viewModel || {}, opts);

  return {
    discordText,
    pngs,
    pdf: pdfSingle && pdfSingle.ok ? pdfSingle.pdf : null,
    pdfBytes: pdfSingle && pdfSingle.ok ? (pdfSingle.bytes || (pdfSingle.pdf && pdfSingle.pdf.length) || 0) : 0,
    pdfError: pdfSingle && !pdfSingle.ok ? pdfSingle.error : null,
    htmlPreview: opts.includeRawHtml ? html : null,
    params: RENDER_PARAMETERS,
  };
}

module.exports = { render, buildDiscordTextSummary, RENDER_PARAMETERS };
