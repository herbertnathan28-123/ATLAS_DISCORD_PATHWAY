'use strict';

// ============================================================
// foh/adapters/darkHorseViewModel.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// Maps a Dark Horse FOH packet (foh/buildDarkHorsePacket.js
// output) into the prototype shell's named anchor points.
// Same anchor set as the MI adapter so the dispatch controller
// can route both surfaces through one chain.
// ============================================================

const { toViewModel: miToViewModel, validate, REQUIRED_ANCHORS, HARD_PARAMETERS } = require('./marketIntelViewModel');

// DH and MI share the contract — only the upstream packet differs.
// The mapping logic is identical, so we re-use the MI adapter's
// formatters. Kept as a separate module so future DH-specific
// anchor tweaks have a dedicated home.
function toViewModel(packet) {
  return miToViewModel(packet);
}

module.exports = { toViewModel, validate, REQUIRED_ANCHORS, HARD_PARAMETERS };
