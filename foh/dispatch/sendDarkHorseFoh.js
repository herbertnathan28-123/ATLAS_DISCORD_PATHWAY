'use strict';

// ============================================================
// foh/dispatch/sendDarkHorseFoh.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// OUTPUT DELIVERY CONTROLLER for Dark Horse. Same chain shape
// as the Market Intel dispatcher.
// ============================================================

const { buildDarkHorsePacket } = require('../buildDarkHorsePacket');
const dhViewModel = require('../adapters/darkHorseViewModel');
const dhShell = require('../../renderers/foh/darkHorseV6Shell');
const { postFohDeliverable, containsPrivateBackendUrl } = require('./_discordPost');
const { validateFohOutput } = require('../validate/validateFohOutput');

async function sendDarkHorseFoh({ ranking, volatility, legacyPayload, webhookUrl, opts }) {
  opts = opts || {};
  if (process.env.FOH_IMAGE_RENDER_ENABLED !== 'true') {
    return { ok: false, reason: 'env_flag_disabled' };
  }
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return { ok: false, reason: 'no_webhook_url' };
  }

  // 1. ENGINE → FOH PACKET
  let packet;
  try { packet = buildDarkHorsePacket({ ranking: ranking || {}, volatility: volatility || null, now: opts.now, universeSize: opts.universeSize, reportId: opts.reportId }); }
  catch (e) { return { ok: false, reason: 'packet_build_failed', error: e.message }; }

  // 2. PACKET → VIEW MODEL (named anchors)
  const viewModel = dhViewModel.toViewModel(packet);
  const v = dhViewModel.validate(viewModel);
  if (!v.ok) return { ok: false, reason: 'view_model_missing_anchors', missing: v.missing };

  // 3. VIEW MODEL → PROTOTYPE SHELL render
  let rendered;
  try {
    rendered = await dhShell.render({
      packet,
      viewModel,
      opts: Object.assign({}, opts, { legacyPayload: legacyPayload || {}, reportId: packet.meta && packet.meta.reportId, surface: 'dark_horse' }),
    });
  } catch (e) {
    return { ok: false, reason: 'shell_render_failed', error: e.message };
  }
  if (containsPrivateBackendUrl(rendered.discordText || '')) {
    return { ok: false, reason: 'private_backend_url_in_render' };
  }

  // 3.5. PRE-SEND VALIDATOR — operator brief 2026-05-17 assurance gate.
  const v2 = validateFohOutput({ packet, viewModel, discordText: rendered.discordText });
  if (!v2.ok) {
    return { ok: false, reason: 'foh_contract_validation_failed', failures: v2.failures, warnings: v2.warnings };
  }

  // 4. SHELL → DISCORD POST (text + PNGs + PDF)
  const sent = await postFohDeliverable({
    webhookUrl,
    content: rendered.discordText,
    pngs: rendered.pngs,
    pdf: rendered.pdf,
    namePrefix: 'atlas-foh-dark_horse',
    maxAttachmentBytes: opts && opts.maxAttachmentBytes,
  });
  return Object.assign({ kind: 'dark_horse', reportId: packet.meta.reportId }, sent);
}

module.exports = { sendDarkHorseFoh };
