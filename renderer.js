'use strict';
// ============================================================
// ATLAS FX RENDERER — STUB (rendering disabled)
//
// Returns placeholder PNG buffers so the bot boots cleanly and
// continues to deliver macro text output and Dark Horse alerts.
// The real chart rendering layer will be rebuilt in a separate
// session. Zero native dependencies; no Chart.js, no canvas,
// no Puppeteer — just a hardcoded PNG constant.
//
// Interface (unchanged; same shape index.js expects):
//   module.exports = { renderAllPanels }
//   renderAllPanels(symbol) -> Promise<{
//     htfGrid:     Buffer (PNG),
//     ltfGrid:     Buffer (PNG),
//     htfGridName: string,
//     ltfGridName: string
//   }>
// ============================================================

// Canonical 1x1 PNG (67 bytes, transparent). Discord accepts it as
// a valid attachment; content is intentionally minimal so downstream
// code (AttachmentBuilder, deliverResult, etc.) sees a real PNG
// Buffer without any rendering path executing.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk' +
  'AAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64'
);

async function renderAllPanels(symbol) {
  const sym = String(symbol || 'UNKNOWN').toUpperCase();
  console.log('[RENDERER STUB] ' + sym + ' — charts disabled, returning placeholder PNGs');
  return {
    htfGrid:     PLACEHOLDER_PNG,
    ltfGrid:     PLACEHOLDER_PNG,
    htfGridName: sym + '_HTF.png',
    ltfGridName: sym + '_LTF.png'
  };
}

module.exports = { renderAllPanels };
