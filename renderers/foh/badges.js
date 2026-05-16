'use strict';

// ============================================================
// renderers/foh/badges.js
//
// Tiny helper that emits the Download PNG / Download PDF badge
// group used in every FOH card banner. Operator brief: badges
// must sit under the heading or far-right of the header without
// overpowering the banner title.
//
// Behaviour:
//   - If `dashboardDownloadUrls.png` / `dashboardDownloadUrls.pdf`
//     are provided, the badge is wrapped in `<a href="...">` so
//     it links to the dashboard download endpoint.
//   - Otherwise the badge is decorative `<span>` — informs the
//     viewer that the file IS available as PNG / PDF (the
//     Discord attachment itself IS the download).
//   - Caller controls visibility per card via `formats: ['png','pdf']`
//     (defaults to both).
// ============================================================

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderFormatBadges(payload) {
  const formats = Array.isArray(payload && payload.formats) && payload.formats.length
    ? payload.formats
    : ['png', 'pdf'];
  const urls = (payload && payload.dashboardDownloadUrls) || {};
  const items = [];
  for (const f of formats) {
    const cls = f === 'pdf' ? 'pdf' : 'png';
    const label = f === 'pdf' ? 'PDF' : 'PNG';
    const url = urls[f];
    if (url) {
      items.push('<a class="foh-format-badge ' + cls + '" href="' + esc(url) + '">' + label + '</a>');
    } else {
      items.push('<span class="foh-format-badge ' + cls + '">' + label + '</span>');
    }
  }
  if (!items.length) return '';
  return '<span class="foh-format-badges">' + items.join('') + '</span>';
}

module.exports = { renderFormatBadges };
