'use strict';

// ============================================================
// foh/dispatch/_discordPost.js
//
// Operator directive 2026-05-17 — FIXED-CONTRACT FOH PIPELINE.
// Thin multipart Discord webhook POST helper. The dispatch
// controllers render via the prototype shell first, then call
// this helper to attach the intelligence + PNGs + PDF in a
// single Discord webhook message.
//
// HARD RULE: this helper rejects any message body that contains
// a private-backend URL (notion.so / notion.com / notion.site).
// Belt-and-braces — the cleansers upstream should have already
// stripped them; this is the last line of defence before any
// byte hits the user-facing Discord surface.
// ============================================================

const DEFAULT_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const PRIVATE_BACKEND_PATTERNS = [
  /notion\.so/i,
  /notion\.com/i,
  /notion\.site/i,
];

function containsPrivateBackendUrl(s) {
  if (typeof s !== 'string' || !s.length) return false;
  return PRIVATE_BACKEND_PATTERNS.some(re => re.test(s));
}

function scrubPrivateBackend(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const re of PRIVATE_BACKEND_PATTERNS) {
    out = out.replace(new RegExp(re.source + '\\S*', re.flags), '[private backend reference]');
  }
  out = out.replace(/\bNotion\b/g, 'private backend');
  return out;
}

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

async function postFohDeliverable({ webhookUrl, content, pngs, pdf, namePrefix, maxAttachmentBytes }) {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return { ok: false, reason: 'no_webhook_url' };
  }
  // Final guard: scrub any leaked private-backend URLs from the
  // user-facing message body. The cleansers upstream should have
  // already neutralised them; this is the last line of defence.
  const safeContent = scrubPrivateBackend(content || '');
  if (containsPrivateBackendUrl(safeContent)) {
    return { ok: false, reason: 'private_backend_url_in_content' };
  }
  const cap = Number.isFinite(maxAttachmentBytes) ? maxAttachmentBytes : DEFAULT_MAX_ATTACHMENT_BYTES;
  const stamp = Date.now();
  const attachments = [];
  const skipped = [];
  (pngs || []).forEach((p, i) => {
    if (!p || !p.png) { skipped.push({ label: p && p.label, reason: 'render_failed:' + ((p && p.error) || 'unknown') }); return; }
    const bytes = p.bytes || p.png.length;
    if (bytes > cap) { skipped.push({ label: p.label, reason: 'exceeds_cap:' + bytes + '>' + cap }); return; }
    attachments.push({
      name: (namePrefix || 'atlas-foh') + '-' + (p.label || ('card-' + (i + 1))) + '-' + stamp + '.png',
      contentType: 'image/png',
      data: p.png,
    });
  });
  let pdfSkipped = false, pdfSkipReason = null;
  if (pdf) {
    if (pdf.length <= cap) {
      attachments.push({
        name: (namePrefix || 'atlas-foh') + '-full-' + stamp + '.pdf',
        contentType: 'application/pdf',
        data: pdf,
      });
    } else {
      pdfSkipped = true; pdfSkipReason = 'pdf_exceeds_cap:' + pdf.length + '>' + cap;
    }
  }
  if (!attachments.length) {
    return { ok: false, reason: 'no_attachments_buildable', error: JSON.stringify(skipped) };
  }
  const sent = await _postMultipart(webhookUrl, { content: safeContent }, attachments);
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
  postFohDeliverable,
  scrubPrivateBackend,
  containsPrivateBackendUrl,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  PRIVATE_BACKEND_PATTERNS,
};
