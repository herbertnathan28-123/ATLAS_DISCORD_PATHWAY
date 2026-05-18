'use strict';

// ============================================================
// renderers/foh/darkHorseV6Shell.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// Prototype shell renderer for Dark Horse v6. Same contract as
// the Market Intel shell. Owns LAYOUT ONLY.
// ============================================================

const protoShell = require('./protoShell');
const dhAdapter = require('./darkHorseV6Adapter');
const { renderHtmlsToPngs, renderHtmlToPdf } = require('./pngRenderer');
const { RENDER_PARAMETERS } = require('./marketIntelV3Shell');
const { renderSurfaceOutput } = require('../../foh/surfaceRouter');

function _scrubExternalLinks(html) {
  if (typeof html !== 'string' || !html.length) return html;
  return html
    .replace(/https?:\/\/(www\.)?notion\.(so|com|site)\/[^\s)"'\]]*/gi, '#')
    .replace(/<a\s+([^>]*?)href=["']#["']([^>]*)>(.*?)<\/a>/gi, '$3');
}

async function render({ packet, viewModel, opts }) {
  opts = Object.assign({}, RENDER_PARAMETERS, opts || {});
  const legacyPayload = (opts && opts.legacyPayload) || packet || {};
  let html = protoShell.getDarkHorseV6Html();
  html = dhAdapter.adapt(html, legacyPayload);
  html = _scrubExternalLinks(html);

  const cards = protoShell.buildDarkHorseV6Cards(html).map(c => ({ ...c, html: _scrubExternalLinks(c.html) }));
  const [pngBatch, pdfSingle] = await Promise.all([
    renderHtmlsToPngs(cards.map(c => c.html)),
    renderHtmlToPdf(html),
  ]);
  const pngs = (pngBatch && pngBatch.pngs ? pngBatch.pngs : []).map((p, i) => Object.assign({ label: cards[i] && cards[i].label }, p));
  const discordText = renderSurfaceOutput({
    surface: 'dark_horse',
    packet: viewModel || {},
    opts: Object.assign({}, opts, { surface: 'dark_horse' }),
  });

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

module.exports = { render, RENDER_PARAMETERS };
