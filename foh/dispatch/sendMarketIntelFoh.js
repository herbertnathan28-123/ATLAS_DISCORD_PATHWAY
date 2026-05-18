'use strict';

// ============================================================
// foh/dispatch/sendMarketIntelFoh.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// OUTPUT DELIVERY CONTROLLER for Market Intel.
//
// Chain (no bypass):
//   engine input
//     → buildMarketIntelPacket  (fixed-contract FOH packet)
//       → marketIntelViewModel  (named-anchor view model)
//         → marketIntelV3Shell  (prototype-shell render)
//           → postFohDeliverable (Discord text + PNGs + PDF)
//
// Discord message structure (must be useful before opening
// attachments):
//   ATLAS Market Intel · [subtitle]
//   Risk State: [disc scale]
//   Generated: [UTC timestamp]
//
//   Briefing Summary
//   [direct intelligence summary]
//
//   What To Do Now
//   [direct action steps]
//
//   Market Impact
//   [plain-English consequence chain]
//
//   Confirmation / Cancellation
//   [what confirms / what cancels]
//
//   Source / Provenance
//   [ATLAS-safe source summary]
//
//   Attachments:
//   - rendered cards
//   - full PDF
// ============================================================

const { buildMarketIntelPacket } = require('../buildMarketIntelPacket');
const miViewModel = require('../adapters/marketIntelViewModel');
const miShell = require('../../renderers/foh/marketIntelV3Shell');
const { postFohDeliverable, containsPrivateBackendUrl } = require('./_discordPost');
const { validateFohOutput } = require('../validate/validateFohOutput');

async function sendMarketIntelFoh({ engine, legacyPacket, coreyClone, spidey, webhookUrl, opts }) {
  opts = opts || {};
  if (process.env.FOH_IMAGE_RENDER_ENABLED !== 'true') {
    return { ok: false, reason: 'env_flag_disabled' };
  }
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return { ok: false, reason: 'no_webhook_url' };
  }

  // 1. ENGINE → FOH PACKET (Corey Clone + Spidey threaded through
  //    so historicalReaction + structureSnapshot carry live engine
  //    output, and degradation surfaces honestly).
  let packet;
  try {
    packet = buildMarketIntelPacket({
      engine: engine || legacyPacket || {},
      coreyClone: coreyClone || null,
      spidey: spidey || null,
      now: opts.now,
      reportId: opts.reportId,
    });
  }
  catch (e) { return { ok: false, reason: 'packet_build_failed', error: e.message }; }

  // 2. PACKET → VIEW MODEL (named anchors)
  const viewModel = miViewModel.toViewModel(packet);
  const v = miViewModel.validate(viewModel);
  // Always build the Discord text — the runtime needs it for the
  // text-only fallback if the renderer fails.
  const discordText = miShell.buildDiscordTextSummary(viewModel || {}, opts);
  if (!v.ok) return { ok: false, reason: 'view_model_missing_anchors', missing: v.missing, discordText };

  // 3. VIEW MODEL → PROTOTYPE SHELL render
  let rendered;
  try {
    rendered = await miShell.render({
      packet,
      viewModel,
      opts: Object.assign({}, opts, { legacyPacket: legacyPacket || engine || {} }),
    });
  } catch (e) {
    return { ok: false, reason: 'shell_render_failed', error: e.message, discordText };
  }
  if (containsPrivateBackendUrl(rendered.discordText || '')) {
    return { ok: false, reason: 'private_backend_url_in_render', discordText };
  }

  // 3.5. PRE-SEND VALIDATOR — operator brief 2026-05-17 assurance
  // gate. Blocks delivery if packet / view-model / Discord text
  // fails any contract rule (banned terms, thin sections, missing
  // required fields, etc).
  const v2 = validateFohOutput({ packet, viewModel, discordText: rendered.discordText });
  if (!v2.ok) {
    return { ok: false, reason: 'foh_contract_validation_failed', failures: v2.failures, warnings: v2.warnings, discordText: rendered.discordText };
  }

  // 4. SHELL → DISCORD POST (text + PNGs + PDF)
  const sent = await postFohDeliverable({
    webhookUrl,
    content: rendered.discordText,
    pngs: rendered.pngs,
    pdf: rendered.pdf,
    namePrefix: 'atlas-foh-market_intel',
    maxAttachmentBytes: opts && opts.maxAttachmentBytes,
  });
  return Object.assign({ kind: 'market_intel', reportId: packet.meta.reportId }, sent);
}

module.exports = { sendMarketIntelFoh };
