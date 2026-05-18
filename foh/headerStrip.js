'use strict';

// ============================================================
// foh/headerStrip.js
//
// Shared FOH heading primitives:
//   • boxHeader(label)        — the ATLAS ╔══╗ / ║ … ║ / ╚══╝
//                               treatment used at the top of every
//                               FOH report.
//   • controlStrip(opts)      — the user-facing download / open
//                               controls strip that sits directly
//                               under the boxed top heading. Each
//                               control reports honest availability
//                               ('Available' / 'Brief Pending' /
//                               'Not generated for this report')
//                               so the user is never shown a dead
//                               link.
//
// Box width matches the operator spec (44 ═ chars between the
// corners). Variation-selector codepoints (U+FE0F) add to JS
// `.length` but render zero visual cells, so they are stripped
// before measuring pad width — that keeps emoji like 🗓️ from
// drifting the right edge.
// ============================================================

const BOX_WIDTH = 44;

function _visualLen(text) {
  return String(text || '').replace(/️/g, '').length;
}

function boxHeader(label) {
  const W = BOX_WIDTH;
  const inner = W - 2;
  const text = String(label || '').trim();
  const visualLen = _visualLen(text);
  const pad = visualLen >= inner ? '' : ' '.repeat(inner - visualLen);
  return [
    '╔' + '═'.repeat(W) + '╗',
    '║ ' + text + pad + ' ║',
    '╚' + '═'.repeat(W) + '╝',
  ].join('\n');
}

// Normalises a control value into its user-facing string. Accepts:
//   • a literal "Available" / "Brief Pending" / "Not generated…"
//     string — returned untouched
//   • the shorthand 'available' / true   → "Available"
//   • 'pending' / null / undefined / ''  → "Brief Pending"
//   • 'skipped' / false                  → "Not generated for this report"
//   • any other non-empty string         → returned as-is (used for
//                                          'Available / Brief Pending'
//                                          mixed states on the MI
//                                          Full Briefs row)
function _resolveControl(state) {
  if (state === true || state === 'available' || state === 'Available') return 'Available';
  if (state === false || state === 'skipped') return 'Not generated for this report';
  if (state === 'pending' || state == null || state === '') return 'Brief Pending';
  if (typeof state === 'string') return state.trim();
  return 'Brief Pending';
}

// Emits the visible-text-link control strip directly under the
// boxed top heading. Discord button components are imported in
// index.js but not wired into the FOH webhook path, so we use
// visible-text controls per the spec fallback.
//
// opts:
//   png        — control state for "Download PNG"
//   pdf        — control state for "Download PDF"
//   dashboard  — control state for the third row ("Open Dashboard"
//                / "Full Briefs" / etc — the row LABEL is set by
//                `dashboardLabel`; default "Open Dashboard")
//   dashboardLabel — string label for the third row (default
//                "Open Dashboard"; Market Intel sets this to
//                "Full Briefs")
//   glossary   — control state for "Expanded Terminology"
function controlStrip(opts) {
  opts = opts || {};
  const lines = [
    '🖼️ Download PNG: ' + _resolveControl(opts.png),
    '📄 Download PDF: ' + _resolveControl(opts.pdf),
    '🔗 ' + (opts.dashboardLabel || 'Open Dashboard') + ': ' + _resolveControl(opts.dashboard),
    '📘 Expanded Terminology: ' + _resolveControl(opts.glossary),
  ];
  return lines.join('\n');
}

module.exports = { boxHeader, controlStrip };
