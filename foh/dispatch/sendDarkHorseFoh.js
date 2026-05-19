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

function _phaseToLifecycle(movePhase) {
  const p = String(movePhase || '').toLowerCase();
  if (p === 'early') return 'FRESH';
  if (p === 'late' || p === 'exhaustion') return 'FADING';
  return 'STILL ACTIVE';
}

function _liveStandoutsFromRanking(ranking) {
  const top = ranking && Array.isArray(ranking.top10) ? ranking.top10 : [];
  return top
    .filter(c => Number.isFinite(c && c.score) && c.score >= 7)
    .slice(0, 4)
    .map(c => ({
      symbol: c.symbol,
      lifecycle: _phaseToLifecycle(c.movePhase),
      direction: c.direction || 'unspecified',
      score: c.score,
      firstDetected: c.firstDetectedAt || c.firstDetected || null,
      durationAlive: c.durationAliveLabel || c.durationAlive || null,
      reason: c.summary || (Array.isArray(c.reasons) ? c.reasons.join(' · ') : null),
      decisionLevel: c.decisionLevel || null,
      invalidation: c.invalidation || null,
    }));
}

async function sendDarkHorseFoh({ ranking, volatility, legacyPayload, webhookUrl, opts }) {
  if (process.env.FOH_IMAGE_RENDER_ENABLED !== 'true') {
    return { ok: false, reason: 'env_flag_disabled' };
  }
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return { ok: false, reason: 'no_webhook_url' };
  }

  // 1. ENGINE → FOH PACKET
  let packet;
  try { packet = buildDarkHorsePacket({ ranking: ranking || {}, volatility: volatility || null, now: opts && opts.now, universeSize: opts && opts.universeSize }); }
  catch (e) { return { ok: false, reason: 'packet_build_failed', error: e.message }; }

  // 2. PACKET → VIEW MODEL (named anchors)
  const viewModel = dhViewModel.toViewModel(packet);
  const v = dhViewModel.validate(viewModel);
  if (!v.ok) return { ok: false, reason: 'view_model_missing_anchors', missing: v.missing };

  // 2.5. Attach the live Dark Horse candidate list to the shell VM.
  // The generic MI-compatible view-model intentionally does not carry
  // Dark Horse standout objects. The prototype shell needs them so live
  // zero-standout scans suppress the static EURUSD/XAUUSD/NVDA sample cards
  // and live non-zero scans keep only real candidates.
  const _internalArr = (opts && Array.isArray(opts.internal)) ? opts.internal : [];
  const _ignoredArr  = (opts && Array.isArray(opts.ignored))  ? opts.ignored  : [];
  const liveViewModel = Object.assign({}, viewModel, {
    now: opts && opts.now,
    marketsScanned: (opts && Number.isFinite(opts.universeSize)) ? opts.universeSize : (ranking && Number.isFinite(ranking.allCount) ? ranking.allCount : 0),
    marketMood: {
      discs: packet && packet.header && packet.header.severityDiscs,
      label: packet && packet.header && packet.header.riskState,
    },
    standouts: _liveStandoutsFromRanking(ranking || {}),
    // Issue #159: surface WATCH / INTERNAL / IGNORED evidence on
    // the Dark Horse Discord text so the 0-standout case carries
    // concrete what/why/evidence/changes-if. The engine threads
    // opts.internal / opts.ignored; honest empty arrays when the
    // caller hasn't wired them yet.
    internalCandidates: _internalArr.slice(0, 6).map(c => ({
      symbol: c && c.symbol,
      score: Number.isFinite(c && c.score) ? c.score : null,
      section: c && c.section,
    })),
    internalCount: _internalArr.length,
    ignoredCount: _ignoredArr.length,
  });

  // 3. VIEW MODEL → PROTOTYPE SHELL render
  let rendered;
  try {
    rendered = await dhShell.render({
      packet,
      viewModel: liveViewModel,
      opts: Object.assign({}, opts, { legacyPayload: legacyPayload || {} }),
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
