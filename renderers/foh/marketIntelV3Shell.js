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
const { renderSurfaceOutput } = require('../../foh/surfaceRouter');

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

function _truncateSurfaceText(s, n, sourceMarker) {
  if (typeof s !== 'string') return '';
  if (s.length <= n) return s;
  const marker = sourceMarker || '🔵 SOURCE NOTE';
  const sourceIdx = s.lastIndexOf(marker);
  if (sourceIdx > 0) {
    const tailStart = Math.max(0, s.lastIndexOf('\n', sourceIdx - 1) + 1);
    const tail = s.slice(tailStart).trimStart();
    const headMax = Math.max(300, n - tail.length - 8);
    if (headMax > 0 && tail.length < n - 100) {
      return s.slice(0, headMax).trimEnd() + '\n…\n' + tail;
    }
  }
  return _truncate(s, n);
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

function _sourceNoteLine(text, fallback) {
  const raw = _safeLine(text, fallback || 'Source: ATLAS runtime · freshness: LIVE');
  const source = raw.match(/Source:\s*([^·\n]+)/i);
  const fresh = raw.match(/freshness:\s*([^·\n]+)/i);
  const confidence = raw.match(/confidence:\s*([^·\n]+)/i);
  if (source || fresh || confidence) {
    return [
      'Source: ' + _safeLine(source && source[1], 'ATLAS runtime'),
      'freshness: ' + _safeLine(fresh && fresh[1], 'LIVE'),
    ].join(' · ');
  }
  return _truncate(raw, 120);
}

function _darkHorseSourceNoteLine(text, fallback) {
  return _sourceNoteLine(text, fallback || 'Source: ATLAS scan engine · freshness: LIVE')
    .replace(/\bATLAS Dark Horse scanner\b/gi, 'ATLAS scan engine')
    .replace(/\bDark Horse scanner\b/gi, 'scan engine');
}

function _sectionLines(text, count, maxEach) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, count)
    .map(line => maxEach ? _truncate(line, maxEach) : line)
    .join('\n');
}

function _fieldFromBlock(block, label) {
  const re = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+)$', 'im');
  const match = String(block || '').match(re);
  return match ? _safeLine(match[1], '') : '';
}

function _compactAffectedGuidance(viewModel, maxRows) {
  const raw = String(viewModel.AFFECTED_MARKETS_EXPANDED || '').trim();
  const rows = raw ? raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean) : [];
  if (!rows.length) return _affectedMarketsControl(viewModel);
  const out = rows.slice(0, maxRows || 2).map(block => {
    const lines = block.split('\n').map(s => s.trim()).filter(Boolean);
    const instrument = _safeLine(lines[0], 'Mapped market');
    const stronger = _fieldFromBlock(block, 'STRONGER-THAN-EXPECTED') || _fieldFromBlock(block, 'STRONGER') || 'support path pending';
    const weaker = _fieldFromBlock(block, 'WEAKER-THAN-EXPECTED') || _fieldFromBlock(block, 'WEAKER') || 'pressure path pending';
    const confirm = _fieldFromBlock(block, 'CONFIRMATION') || 'validation pending';
    const invalid = _fieldFromBlock(block, 'INVALIDATION') || 'invalidation pending';
    return '• ' + instrument + ' — support: ' + _truncate(stronger, 30) + '; pressure: ' + _truncate(weaker, 30) + '; validate: ' + _truncate(confirm, 28) + '; invalidate: ' + _truncate(invalid, 26) + '.';
  });
  return [
    '🎯 AFFECTED MARKETS — SUPPORT / PRESSURE GUIDE',
    out.join('\n'),
  ].join('\n');
}

function _compactRoadmapSequence(viewModel) {
  const eventLines = String(viewModel.NEXT_24_TO_72_HOURS || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^(expected sensitivity|prep):/i.test(line))
    .slice(0, 2)
    .map(line => _truncate(line, 88))
    .join('\n');
  const seq = eventLines || _sectionLines(viewModel.NEXT_24_TO_72_HOURS, 2, 88);
  return seq || 'No 24–72h sequence published this cycle; monitor the next ranked release window.';
}

function _compactScenarioPaths(viewModel) {
  const focus = _fieldFromBlock(viewModel.PRIMARY_EVENT_FOCUS, 'Event') || 'Primary event pending';
  const why = _fieldFromBlock(viewModel.MARKET_IMPACT, 'Market impact') || _firstLines(viewModel.MARKET_IMPACT, 1) || 'market impact pending';
  const stronger = _fieldFromBlock(viewModel.FOUR_WAY_HIGHER, 'Behaviour') || 'stronger-than-expected path pending';
  const weaker = _fieldFromBlock(viewModel.FOUR_WAY_LOWER, 'Behaviour') || 'weaker-than-expected path pending';
  return [
    'Event: ' + _truncate(focus, 72),
    'Why it matters: ' + _truncate(why, 82),
    'Stronger-than-expected path: ' + _truncate(stronger, 82),
    'Weaker-than-expected path: ' + _truncate(weaker, 82),
  ].join('\n');
}

function _compactCalendar(text) {
  const line = _firstLines(text, 1);
  if (!line) return '';
  const parts = line.split('|').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 4) return parts.slice(0, 4).join(' | ');
  return _truncate(line, 110);
}

function _compactDarkHorseAdvice(viewModel) {
  const raw = String(viewModel.WHAT_TO_DO_NOW || '');
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const keep = [];
  const action = lines.find(line => /^\d+\./.test(line)) || lines[0];
  const confirmation = lines.find(line => /^CONFIRMATION:/i.test(line));
  const dollars = lines.find(line => /^\$\$:/i.test(line));
  if (action) keep.push(_truncate(action, 112));
  if (confirmation) keep.push(_truncate(confirmation, 96));
  if (dollars) keep.push(_truncate(dollars, 96));
  return keep.join('\n') || 'No standout advice block published this cycle.';
}

function _reportId(viewModel, opts, prefix) {
  return (opts && opts.reportId) || viewModel.REPORT_ID || (prefix + '-pending');
}

function _controlBlock(mode) {
  if (mode === 'rendered') {
    return [
      '🧭 Controls: PNG/PDF · Full Calendar · Terms · Full Briefs Available / Brief Pending',
    ].join('\n');
  }
  return [
    '🧭 Controls: Full Calendar · Terms · Full Briefs Brief Pending · PNG/PDF pending.',
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
  const calendar = _compactCalendar(viewModel.RANKED_EVENT_CALENDAR) || 'No ranked high-impact events available · Brief Pending';
  const roadmap = _compactRoadmapSequence(viewModel);
  const scenarioPaths = _compactScenarioPaths(viewModel);
  const briefLine = /Brief Pending/i.test(calendar) ? '🔗 FULL BRIEF: Brief Pending' : '🔗 FULL BRIEF: Available where linked';
  const confirms = _safeLine(viewModel.CONFIRMS_WHEN, 'Validation condition pending.');
  const cancels = _safeLine(viewModel.CANCELS_WHEN, 'Invalidation condition pending.');
  const structure = _sectionLines(viewModel.STRUCTURE_SNAPSHOT, 3, 96) || 'Structure status: NOT_INVOKED — structure read not supplied to this packet.';
  const clone = _sectionLines(viewModel.HISTORICAL_ANALOGUE, 5, 96) || 'Corey Clone status: NOT_INVOKED — historical analogue read not supplied to this packet.';
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
    _sectionLines(viewModel.THE_CALL, 2, 90) || 'Current read: MONITORING — no confirmed execution read yet.',
    '',
    '🟠 HIGH-IMPACT CALENDAR EVENTS',
    calendar,
    '',
    '🟡 RISK STATE',
    'Jane/FOH state: ' + (viewModel.RISK_STATE_DISC_SCALE || 'risk state pending'),
    '',
    '🔵 MARKET IMPACT / SCENARIO PATHS',
    'Market Impact: live catalyst path and confirmation map.',
    scenarioPaths,
    '',
    '🟣 ROADMAP INTEL — NEXT 24–72H SEQUENCE',
    roadmap,
    '',
    _compactAffectedGuidance(viewModel, 1),
    '',
    '🧭 EXPOSURE / NEW-RISK POSTURE',
    'Existing exposure: review stops/size before the window.',
    'New risk: Jane-gated only — no fresh direction until validation prints.',
    'Validation: ' + _truncate(confirms, 76),
    'Invalidation: ' + _truncate(cancels, 76),
    '',
    '🧱 Structure (Spidey Phase D)',
    structure,
    '',
    '🧬 Historical Analogue (Corey Clone)',
    clone,
    '',
    briefLine,
    '',
    '🔵 SOURCE NOTE',
    _sourceNoteLine(viewModel.SOURCE_PROVENANCE, 'Source: ATLAS runtime · freshness: LIVE'),
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
  const subtitle = _safeLine(viewModel.HEADER_SUBTITLE, '');
  const standoutMatch = subtitle.match(/(\d+)\s+standouts?/i);
  const standoutCount = Number.isFinite(opts && opts.standoutCount)
    ? opts.standoutCount
    : standoutMatch ? Number(standoutMatch[1]) : null;
  if (standoutCount === 0) {
    return _buildDarkHorseZeroStandoutSurface(viewModel, opts);
  }
  const lifecycle = _sectionLines(viewModel.BRIEFING_SUMMARY, 2, 82) || 'Lifecycle summary pending.';
  const currentAdvice = _compactDarkHorseAdvice(viewModel);
  const riskCap = (String(viewModel.WHAT_TO_DO_NOW || '').split('\n').find(line => /\$\$:/i.test(line)) || '').replace(/^\s*\$\$:\s*/i, '').trim();
  const whatToWatch = _fieldFromBlock(viewModel.EVENT_DAY_REFERENCE, 'What to watch') || 'Pending unless published in CURRENT ADVICE.';
  const chartReference = _fieldFromBlock(viewModel.EVENT_DAY_REFERENCE, 'Chart study') || _sectionLines(viewModel.EVENT_DAY_REFERENCE, 1, 96) || 'Chart reference pending.';
  const building = _sectionLines(viewModel.MARKET_IMPACT, 1, 105) || 'Building read pending.';
  const lines = [
    HARD_BOUNDARY,
    '🐎 NEW DARK HORSE SCAN',
    'Report ID: ' + reportId,
    'Generated: ' + generated,
    'Part: 1/1',
    HARD_BOUNDARY,
    '🟡 LIFECYCLE SUMMARY',
    lifecycle,
    '',
    '🟡 MARKET MOOD',
    viewModel.RISK_STATE_DISC_SCALE || 'market mood pending',
    '',
    '🔴 CURRENT ADVICE / WHAT TO DO NOW — AT RELEASE',
    currentAdvice,
    '',
    '🟠 ENTRY / WATCH ZONE',
    'Entry/watch zone: ' + _truncate(whatToWatch, 96),
    'Caution zone: ' + _truncate(_safeLine(viewModel.RISK_ESCALATION_CAUTION, 'Pending'), 66),
    'Invalidation zone: ' + _truncate(_safeLine(viewModel.CANCELS_WHEN, 'Pending'), 66),
    '',
    '💵 DOLLAR RISK / RISK CAP',
    _truncate(riskCap || 'Account-percentage risk cap only after entry reference, confirmation, and invalidation are published.', 82),
    '',
    '✅ WHAT CONFIRMS',
    _truncate(_safeLine(viewModel.CONFIRMS_WHEN, 'Pending'), 78),
    '',
    '⛔ WHAT CANCELS',
    _truncate(_safeLine(viewModel.CANCELS_WHEN, 'Pending'), 78),
    '',
    '🧱 BUILDING',
    building,
    '',
    '📈 CHART REFERENCE',
    chartReference + '; PNG attached when render succeeds.',
    '',
    '🧾 NEXT REVIEW / NEXT SCAN',
    'Next review: Next scheduled Dark Horse scan.',
    '',
    '🔵 SOURCE NOTE',
    _darkHorseSourceNoteLine(viewModel.SOURCE_PROVENANCE, 'Source: ATLAS scan engine · freshness: LIVE'),
    '',
    HARD_BOUNDARY,
    '✅ END OF DARK HORSE SCAN',
    'Report ID: ' + reportId,
    HARD_BOUNDARY,
  ];
  return lines.join('\n');
}

function _buildDarkHorseZeroStandoutSurface(viewModel, opts) {
  const reportId = _reportId(viewModel, opts, 'DH');
  const generated = viewModel.GENERATED_AT_UTC || new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const subtitle = _safeLine(viewModel.HEADER_SUBTITLE, '0 standouts · markets scanned');
  const nextReview = (opts && opts.nextReviewUTC) || 'Next scheduled Dark Horse scan.';
  const source = _darkHorseSourceNoteLine(viewModel.SOURCE_PROVENANCE, 'Source: ATLAS scan engine · freshness: LIVE');
  const lines = [
    HARD_BOUNDARY,
    '🐎 NEW DARK HORSE SCAN',
    subtitle.replace(/on this scan\s*·\s*/i, '· '),
    'Report ID: ' + reportId,
    'Generated: ' + generated,
    'Part: 1/1',
    HARD_BOUNDARY,
    '🟡 Market Mood',
    viewModel.RISK_STATE_DISC_SCALE || 'market mood pending',
    '',
    '🔴 CURRENT ADVICE — AT RELEASE',
    'No trade priority. No fresh exposure from this scan. Stand aside until a candidate clears the publication threshold.',
    '',
    '🧾 Why nothing promoted',
    _truncate(_sectionLines(viewModel.BRIEFING_SUMMARY, 2, 112) || 'No candidate cleared the publication threshold on this scan.', 260),
    '',
    '🧱 Building / Pre-Radar',
    _truncate(_sectionLines(viewModel.MARKET_IMPACT, 1, 130) || 'Building reads remain below publication grade; keep them internal until structure strengthens.', 180),
    '',
    '✅ What would promote a candidate next',
    _truncate(_safeLine(viewModel.CONFIRMS_WHEN, 'A future scan publishes at least one candidate at the publication-grade threshold.'), 160),
    '',
    '⛔ What cancels the watch',
    _truncate(_safeLine(viewModel.CANCELS_WHEN, 'No candidate clears threshold on the next scan or the macro/volatility backdrop reverses.'), 160),
    '',
    '🧾 Next review / next scan',
    nextReview,
    '',
    '🔵 Source / engine status',
    source,
    '',
    HARD_BOUNDARY,
    '✅ END DARK HORSE SCAN',
    'Report ID: ' + reportId,
    HARD_BOUNDARY,
  ];
  return lines.join('\n');
}

function buildDiscordTextSummary(viewModel, opts) {
  opts = opts || {};
  const surface = String(opts.surface || '').trim();
  if (!surface) throw new Error('explicit_foh_surface_required');
  return renderSurfaceOutput({ surface, packet: viewModel || {}, opts: Object.assign({ maxDiscordChunkChars: RENDER_PARAMETERS.maxDiscordChunkChars }, opts) });
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
  const discordText = buildDiscordTextSummary(viewModel || {}, Object.assign({}, opts, { surface: 'market_intel' }));

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