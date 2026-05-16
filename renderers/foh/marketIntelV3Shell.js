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

function buildDiscordTextSummary(viewModel, opts) {
  opts = opts || {};
  const maxChars = Number.isFinite(opts.maxDiscordChunkChars) ? opts.maxDiscordChunkChars : RENDER_PARAMETERS.maxDiscordChunkChars;
  const lines = [];
  lines.push('**' + viewModel.HEADER_TITLE + ' · ' + viewModel.HEADER_SUBTITLE + '**');
  lines.push('Risk State: ' + viewModel.RISK_STATE_DISC_SCALE);
  lines.push('Generated: ' + viewModel.GENERATED_AT_UTC);
  lines.push('');
  lines.push('__Briefing Summary__');
  lines.push(viewModel.BRIEFING_SUMMARY);
  lines.push('');
  lines.push('__What To Do Now__');
  lines.push(viewModel.WHAT_TO_DO_NOW);
  lines.push('');
  lines.push('__Market Impact__');
  lines.push(viewModel.MARKET_IMPACT);
  lines.push('');
  lines.push('__Confirmation / Cancellation__');
  lines.push('Confirms: ' + viewModel.CONFIRMS_WHEN);
  lines.push('Cancels: ' + viewModel.CANCELS_WHEN);
  lines.push('');
  lines.push('__Source / Provenance__');
  lines.push(viewModel.SOURCE_PROVENANCE);
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
