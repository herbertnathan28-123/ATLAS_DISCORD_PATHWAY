'use strict';

// ============================================================
// renderers/foh/index.js
//
// Public API for the ATLAS FOH Image Renderer.
//
//   renderFohPng({ kind, payload, opts }) → Promise<{
//     ok, png, width, height, bytes, kind, elapsedMs
//   } | { ok: false, reason, error }>
//
//   postFohPngToDiscord({ kind, payload, webhookUrl, caption?, dashboardUrl?, opts? })
//     → Promise<{ ok, status, attachment?, error?, fallback? }>
//
// Discord posting uses multipart/form-data with the PNG attached
// as `files[0]`. The accompanying `content` field carries a
// short text caption + dashboard link (operator brief: "post PNG
// to Discord with short text caption + dashboard link").
//
// Hard contract:
//   - Safe-fail. If PNG render fails (puppeteer unavailable,
//     OOM, timeout), returns ok:false with reason so callers can
//     fall back to the existing text payload.
//   - Never crashes the caller. Never throws.
//   - Does NOT touch production env vars. Webhook URL must be
//     passed in explicitly by the caller.
// ============================================================

const { renderHtmlToPng } = require('./pngRenderer');
const { renderMarketIntelCard } = require('./marketIntelCard');
const { renderDarkHorseCard }   = require('./darkHorseCard');
const { renderMacroCard }       = require('./macroCard');

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
  try {
    html = _renderHtml(kind, payload);
  } catch (e) {
    return { ok: false, reason: 'html_build_failed', error: e.message, kind };
  }
  const result = await renderHtmlToPng(html, opts || {});
  return Object.assign({ kind }, result);
}

// ── Discord multipart POST ───────────────────────────────────
async function _postMultipart(webhookUrl, jsonPayload, attachments) {
  if (typeof fetch !== 'function') {
    return { ok: false, error: 'global fetch unavailable in this runtime' };
  }
  const boundary = '----atlas-foh-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  const parts = [];
  // payload_json part
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
  const captionParts = [];
  if (caption) captionParts.push(caption);
  if (dashboardUrl) captionParts.push('→ ' + dashboardUrl);
  const content = captionParts.join('\n');

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

module.exports = {
  renderFohPng,
  postFohPngToDiscord,
};
