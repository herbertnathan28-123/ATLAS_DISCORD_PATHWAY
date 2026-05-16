'use strict';

// ============================================================
// renderers/foh/index.js
//
// Public API for the ATLAS FOH Renderer.
//
//   renderFohPng({ kind, payload, opts })     → PNG only
//   renderFohPdf({ kind, payload, opts })     → PDF only
//   renderFohExport({ kind, payload, opts })  → both PNG + PDF
//                                                in one launch
//
//   postFohPngToDiscord({ kind, payload, webhookUrl,
//                         caption?, dashboardUrl?, opts? })
//     → POSTs the PNG as a single attachment.
//
//   postFohExportToDiscord({ kind, payload, webhookUrl,
//                            caption?, dashboardUrl?,
//                            opts?, maxAttachmentBytes? })
//     → POSTs PNG + PDF together when both fit under Discord's
//       per-file attachment cap (defaults to 8MB — the safe
//       webhook ceiling without server-boost). When PDF would
//       overrun, PNG is posted alone and the result carries a
//       `pdfSkipped` flag so the caller / dashboard layer can
//       offer the PDF as a separate download instead.
//
// Discord attachment cap notes:
//   - 8MB is the safe webhook default (no Nitro / no boost).
//     Most servers cap webhooks at this regardless of plan.
//   - Operators can pass `maxAttachmentBytes: 25 * 1024 * 1024`
//     when posting to a Nitro-boosted server.
//
// Hard contract:
//   - Safe-fail. If PNG render fails (puppeteer unavailable,
//     OOM, timeout), returns ok:false with reason so callers
//     can fall back to the existing text payload.
//   - Never crashes the caller. Never throws.
//   - Does NOT touch production env vars. Webhook URL must be
//     passed in explicitly by the caller.
// ============================================================

const { renderHtmlToPng, renderHtmlToPdf, renderHtmlBoth, renderHtmlsToPngs } = require('./pngRenderer');
const { renderMarketIntelCard } = require('./marketIntelCard');
const { renderMarketIntelPrototypeCards } = require('./marketIntelPrototypeCard');
const { renderDarkHorseCard }   = require('./darkHorseCard');
const { renderMacroCard }       = require('./macroCard');
const protoShell                = require('./protoShell');
const miV3Adapter               = require('./marketIntelV3Adapter');
const dhV6Adapter               = require('./darkHorseV6Adapter');

const DEFAULT_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB safe webhook cap

function _renderHtml(kind, payload) {
  switch (kind) {
    case 'market_intel': return renderMarketIntelCard(payload);
    case 'dark_horse':   return renderDarkHorseCard(payload);
    case 'macro':        return renderMacroCard(payload);
    default:
      throw new Error('Unknown FOH kind: ' + kind);
  }
}

async function renderFohPng({ kind, payload, opts }) {
  let html;
  try { html = _renderHtml(kind, payload); }
  catch (e) { return { ok: false, reason: 'html_build_failed', error: e.message, kind }; }
  const result = await renderHtmlToPng(html, opts || {});
  return Object.assign({ kind }, result);
}

async function renderFohPdf({ kind, payload, opts }) {
  let html;
  try { html = _renderHtml(kind, payload); }
  catch (e) { return { ok: false, reason: 'html_build_failed', error: e.message, kind }; }
  const result = await renderHtmlToPdf(html, opts || {});
  return Object.assign({ kind }, result);
}

async function renderFohExport({ kind, payload, opts }) {
  let html;
  try { html = _renderHtml(kind, payload); }
  catch (e) { return { ok: false, reason: 'html_build_failed', error: e.message, kind }; }
  const result = await renderHtmlBoth(html, opts || {});
  return Object.assign({ kind }, result);
}

// ── Discord multipart POST ───────────────────────────────────
async function _postMultipart(webhookUrl, jsonPayload, attachments) {
  if (typeof fetch !== 'function') {
    return { ok: false, error: 'global fetch unavailable in this runtime' };
  }
  const boundary = '----atlas-foh-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  const parts = [];
  parts.push(Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="payload_json"\r\n' +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(jsonPayload) + '\r\n'
  ));
  attachments.forEach((a, idx) => {
    parts.push(Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="files[' + idx + ']"; filename="' + a.name + '"\r\n' +
      'Content-Type: ' + (a.contentType || 'application/octet-stream') + '\r\n\r\n'
    ));
    parts.push(a.data);
    parts.push(Buffer.from('\r\n'));
  });
  parts.push(Buffer.from('--' + boundary + '--\r\n'));
  const body = Buffer.concat(parts);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': String(body.length),
      },
      body,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function postFohPngToDiscord({ kind, payload, webhookUrl, caption, dashboardUrl, opts }) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return { ok: false, reason: 'no_webhook_url', error: 'webhookUrl is required' };
  }
  const rendered = await renderFohPng({ kind, payload, opts });
  if (!rendered.ok) {
    return { ok: false, reason: rendered.reason, error: rendered.error, fallback: 'use_text_payload' };
  }
  const content = [caption, dashboardUrl ? '→ ' + dashboardUrl : null].filter(Boolean).join('\n');
  const attachment = {
    name: 'atlas-foh-' + kind + '-' + Date.now() + '.png',
    contentType: 'image/png',
    data: rendered.png,
  };
  const sent = await _postMultipart(webhookUrl, { content }, [attachment]);
  return {
    ok: sent.ok,
    status: sent.status,
    error: sent.error,
    attachment: { name: attachment.name, bytes: rendered.png.length, width: rendered.width, height: rendered.height },
  };
}

// Combined PNG + PDF post. Attaches both files when each fits
// under `maxAttachmentBytes` (default 8MB safe webhook cap).
// When PDF would exceed cap, posts PNG alone and returns
// `pdfSkipped: true` so the caller / dashboard layer can route
// the PDF to a separate download surface.
async function postFohExportToDiscord({ kind, payload, webhookUrl, caption, dashboardUrl, opts, maxAttachmentBytes }) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return { ok: false, reason: 'no_webhook_url', error: 'webhookUrl is required' };
  }
  const cap = Number.isFinite(maxAttachmentBytes) ? maxAttachmentBytes : DEFAULT_MAX_ATTACHMENT_BYTES;
  const rendered = await renderFohExport({ kind, payload, opts });
  if (!rendered.ok) {
    return { ok: false, reason: rendered.reason, error: rendered.error, fallback: 'use_text_payload' };
  }
  if (!rendered.png) {
    // PNG is the mandatory surface — if it failed but PDF succeeded,
    // still treat as a render failure for posting purposes (PDF
    // alone is not the operator-facing surface). The caller can
    // route the PDF separately via the dashboard download path.
    return { ok: false, reason: 'png_unavailable', error: rendered.pngError, fallback: 'use_text_payload', pdfBytes: rendered.pdfBytes };
  }

  const stamp = Date.now();
  const attachments = [{
    name: 'atlas-foh-' + kind + '-' + stamp + '.png',
    contentType: 'image/png',
    data: rendered.png,
  }];
  let pdfSkipped = false;
  let pdfSkipReason = null;
  if (rendered.pdf) {
    if (rendered.pdfBytes <= cap) {
      attachments.push({
        name: 'atlas-foh-' + kind + '-' + stamp + '.pdf',
        contentType: 'application/pdf',
        data: rendered.pdf,
      });
    } else {
      pdfSkipped = true;
      pdfSkipReason = 'pdf_exceeds_cap:' + rendered.pdfBytes + '>' + cap;
    }
  } else if (rendered.pdfError) {
    pdfSkipped = true;
    pdfSkipReason = 'pdf_render_error:' + rendered.pdfError;
  }

  const content = [caption, dashboardUrl ? '→ ' + dashboardUrl : null].filter(Boolean).join('\n');
  const sent = await _postMultipart(webhookUrl, { content }, attachments);
  return {
    ok: sent.ok,
    status: sent.status,
    error: sent.error,
    attachments: attachments.map(a => ({ name: a.name, contentType: a.contentType, bytes: a.data.length })),
    pdfSkipped,
    pdfSkipReason,
    width: rendered.width,
    height: rendered.height,
  };
}

// ── MULTI-CARD SPLIT (operator directive 2026-05-17) ─────────
// Splits the prototype reproduction into 6 separate PNG cards
// for Discord readability (single 12,000px PNG was technically
// rendered but visually unusable). PDF stays single-document.
// Currently MI only; DH / Macro pass through to single-card path.
async function renderFohSplit({ kind, payload, opts }) {
  // Operator directive 2026-05-17 (PHASE 1/2/3): route MI + DH
  // through the prototype HTML SHELL with surgical data adapter
  // injection. Every byte of the prototype HTML is preserved
  // except the named anchor points the adapter substitutes.
  if (kind === 'market_intel') {
    const protoHtml = protoShell.getMarketIntelV3Html();
    if (!protoHtml) {
      // Fall back to the older template-substitution path so the
      // dispatch chain still works if the prototype file is
      // missing for any reason (defensive — shouldn't happen).
      const single = await renderFohExport({ kind, payload, opts });
      if (!single.ok) return single;
      return Object.assign({}, single, { pngs: single.png ? [{ png: single.png, label: 'card-1', width: single.width, height: single.height, bytes: single.png.length }] : [] });
    }
    const adapted = miV3Adapter.adapt(protoHtml, payload || {});
    const cards = protoShell.buildMarketIntelV3Cards(adapted);
    const start = Date.now();
    const [pngBatch, pdfSingle] = await Promise.all([
      renderHtmlsToPngs(cards.map(c => c.html), opts || {}),
      renderHtmlToPdf(adapted, opts || {}),
    ]);
    if (!pngBatch.ok) return { ok: false, reason: pngBatch.reason || 'png_batch_failed', error: pngBatch.error, kind };
    return {
      ok: true,
      kind,
      pngs: pngBatch.pngs.map((p, i) => Object.assign({ label: cards[i].label }, p)),
      pdf: pdfSingle && pdfSingle.ok ? pdfSingle.pdf : null,
      pdfBytes: pdfSingle && pdfSingle.ok ? pdfSingle.pdf.length : 0,
      pdfError: pdfSingle && !pdfSingle.ok ? pdfSingle.error : null,
      elapsedMs: Date.now() - start,
    };
  }
  if (kind === 'dark_horse') {
    const protoHtml = protoShell.getDarkHorseV6Html();
    if (!protoHtml) {
      const single = await renderFohExport({ kind, payload, opts });
      if (!single.ok) return single;
      return Object.assign({}, single, { pngs: single.png ? [{ png: single.png, label: 'card-1', width: single.width, height: single.height, bytes: single.png.length }] : [] });
    }
    const adapted = dhV6Adapter.adapt(protoHtml, payload || {});
    const cards = protoShell.buildDarkHorseV6Cards(adapted);
    const start = Date.now();
    const [pngBatch, pdfSingle] = await Promise.all([
      renderHtmlsToPngs(cards.map(c => c.html), opts || {}),
      renderHtmlToPdf(adapted, opts || {}),
    ]);
    if (!pngBatch.ok) return { ok: false, reason: pngBatch.reason || 'png_batch_failed', error: pngBatch.error, kind };
    return {
      ok: true,
      kind,
      pngs: pngBatch.pngs.map((p, i) => Object.assign({ label: cards[i].label }, p)),
      pdf: pdfSingle && pdfSingle.ok ? pdfSingle.pdf : null,
      pdfBytes: pdfSingle && pdfSingle.ok ? pdfSingle.pdf.length : 0,
      pdfError: pdfSingle && !pdfSingle.ok ? pdfSingle.error : null,
      elapsedMs: Date.now() - start,
    };
  }
  // Non-MI / non-DH kinds: single card + PDF (back-compat).
  const single = await renderFohExport({ kind, payload, opts });
  if (!single.ok) return single;
  return Object.assign({}, single, { pngs: single.png ? [{ png: single.png, label: 'card-1', width: single.width, height: single.height, bytes: single.png.length }] : [] });
}

// POST split MI render to Discord as multi-attachment message:
// up to 6 PNG cards + 1 PDF in a SINGLE Discord message. Caption
// + dashboard link in the message content. Skips PDF when over
// maxAttachmentBytes (default 8 MB). Skips any PNG that exceeds
// the cap with a per-card pdfSkipped equivalent on the result.
async function postFohSplitToDiscord({ kind, payload, webhookUrl, caption, dashboardUrl, opts, maxAttachmentBytes }) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return { ok: false, reason: 'no_webhook_url', error: 'webhookUrl is required' };
  }
  const cap = Number.isFinite(maxAttachmentBytes) ? maxAttachmentBytes : DEFAULT_MAX_ATTACHMENT_BYTES;
  const rendered = await renderFohSplit({ kind, payload, opts });
  if (!rendered.ok) {
    return { ok: false, reason: rendered.reason, error: rendered.error, fallback: 'use_text_payload' };
  }
  const stamp = Date.now();
  const attachments = [];
  const skipped = [];
  rendered.pngs.forEach((p, i) => {
    if (!p.png) { skipped.push({ label: p.label, reason: 'render_failed:' + (p.error || 'unknown') }); return; }
    if (p.bytes > cap) { skipped.push({ label: p.label, reason: 'exceeds_cap:' + p.bytes + '>' + cap }); return; }
    attachments.push({
      name: 'atlas-foh-' + kind + '-' + p.label + '-' + stamp + '.png',
      contentType: 'image/png',
      data: p.png,
    });
  });
  let pdfSkipped = false, pdfSkipReason = null;
  if (rendered.pdf) {
    if (rendered.pdfBytes <= cap) {
      attachments.push({
        name: 'atlas-foh-' + kind + '-full-' + stamp + '.pdf',
        contentType: 'application/pdf',
        data: rendered.pdf,
      });
    } else {
      pdfSkipped = true; pdfSkipReason = 'pdf_exceeds_cap:' + rendered.pdfBytes + '>' + cap;
    }
  } else if (rendered.pdfError) {
    pdfSkipped = true; pdfSkipReason = 'pdf_render_error:' + rendered.pdfError;
  }
  if (!attachments.length) {
    return { ok: false, reason: 'no_attachments_buildable', error: JSON.stringify(skipped), fallback: 'use_text_payload' };
  }
  const content = [caption, dashboardUrl ? '→ ' + dashboardUrl : null].filter(Boolean).join('\n');
  const sent = await _postMultipart(webhookUrl, { content }, attachments);
  return {
    ok: sent.ok,
    status: sent.status,
    error: sent.error,
    attachments: attachments.map(a => ({ name: a.name, contentType: a.contentType, bytes: a.data.length })),
    skipped,
    pdfSkipped,
    pdfSkipReason,
  };
}

module.exports = {
  renderFohPng,
  renderFohPdf,
  renderFohExport,
  renderFohSplit,
  postFohPngToDiscord,
  postFohExportToDiscord,
  postFohSplitToDiscord,
  DEFAULT_MAX_ATTACHMENT_BYTES,
};
