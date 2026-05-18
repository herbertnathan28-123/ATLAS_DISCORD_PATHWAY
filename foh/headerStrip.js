'use strict';

// ============================================================
// foh/headerStrip.js
//
// Shared FOH heading primitives:
//   • boxHeader(label, opts)  — the ATLAS ╔══╗ / ║ … ║ / ╚══╝
//                               treatment used at the top of every
//                               FOH report. `opts.color` wraps the
//                               box in a Discord `ansi` code block
//                               so the heading takes on a section
//                               colour (red / orange / yellow /
//                               green / blue / cyan / grey).
//   • controlStrip(opts)      — the user-facing download / open
//                               controls strip that sits directly
//                               under the boxed top heading. Each
//                               control reports honest availability
//                               ('Available' / 'Brief Pending' /
//                               'Not generated for this report')
//                               so the user is never shown a dead
//                               link. Callers may override the row
//                               set + labels for per-report tuning
//                               (Market Intel uses the shorter
//                               'PNG' / 'PDF' / 'Full Calendar' /
//                               'Terminology' / 'Full Briefs' set;
//                               Dark Horse keeps the 'Download'
//                               labels + Open Dashboard).
//
// Box width matches the operator spec (44 ═ chars between the
// corners). Variation-selector codepoints (U+FE0F) add to JS
// `.length` but render zero visual cells, so they are stripped
// before measuring pad width — that keeps emoji like 🗓️ from
// drifting the right edge.
//
// Padding uses U+00A0 (NBSP) rather than ASCII space because the
// Market Intel dispatch sanitiser (validateMarketIntelPayload)
// collapses runs of `[ \t]{2,}` to a single space — which would
// crush the box right edge. NBSPs render visually identical to
// spaces in Discord and survive the collapser.
// ============================================================

const BOX_WIDTH = 44;
const NBSP = ' ';

// Discord ANSI palette (https://gist.github.com/kkrypt0nn/a02506f3712ff2d1c8ca7c9e0aed7c06).
// Bright + bold for headline punch. 'orange' is mapped to yellow
// because the ANSI 8-color palette has no orange — Discord's
// bright-yellow renders close enough to the operator spec.
const ANSI_COLOR = {
  red:     '31',
  orange:  '33',
  yellow:  '33',
  green:   '32',
  blue:    '34',
  cyan:    '36',
  magenta: '35',
  grey:    '30',
  white:   '37',
};

function _visualLen(text) {
  return String(text || '').replace(/️/g, '').length;
}

function _ansiBlock(lines, colorKey) {
  if (!colorKey || !ANSI_COLOR[colorKey]) return lines.join('\n');
  const code = ANSI_COLOR[colorKey];
  const open = '[1;' + code + 'm';
  const close = '[0m';
  const wrapped = lines.map(line => open + line + close);
  return '```ansi\n' + wrapped.join('\n') + '\n```';
}

function boxHeader(label, opts) {
  opts = opts || {};
  const W = BOX_WIDTH;
  const inner = W - 2;
  const text = String(label || '').trim();
  const visualLen = _visualLen(text);
  const pad = visualLen >= inner ? '' : NBSP.repeat(inner - visualLen);
  const lines = [
    '╔' + '═'.repeat(W) + '╗',
    '║ ' + text + pad + ' ║',
    '╚' + '═'.repeat(W) + '╝',
  ];
  return _ansiBlock(lines, opts.color);
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

// Default label map. Callers may override per row via `opts.labels`
// for report-specific wording (Market Intel uses the shorter
// "PNG" / "PDF" / "Full Calendar" / "Terminology" / "Full Briefs"
// set per operator brief 2026-05-18).
const DEFAULT_LABELS = {
  png:       '🖼️ Download PNG',
  pdf:       '📄 Download PDF',
  calendar:  '📅 Full Calendar',
  dashboard: '🔗 Open Dashboard',
  glossary:  '📘 Expanded Terminology',
};

const DEFAULT_ROWS = ['png', 'pdf', 'dashboard', 'glossary'];

// Emits the visible-text-link control strip directly under the
// boxed top heading. Discord button components are imported in
// index.js but not wired into the FOH webhook path, so we use
// visible-text controls per the spec fallback.
//
// opts:
//   png / pdf / calendar / dashboard / glossary — control state
//   rows           — string[] of row keys to emit in order
//                    (default: png, pdf, dashboard, glossary)
//   labels         — { key: 'glyph + label' } override map
//   dashboardLabel — backward-compat shortcut to override the
//                    label for the 'dashboard' row only
//                    (default: 'Open Dashboard'). Market Intel
//                    passes 'Full Briefs'.
function controlStrip(opts) {
  opts = opts || {};
  const rows = Array.isArray(opts.rows) && opts.rows.length ? opts.rows : DEFAULT_ROWS;
  const labels = Object.assign({}, DEFAULT_LABELS, opts.labels || {});
  if (opts.dashboardLabel && !(opts.labels && opts.labels.dashboard)) {
    labels.dashboard = '🔗 ' + opts.dashboardLabel;
  }
  return rows.map(key => (labels[key] || key) + ': ' + _resolveControl(opts[key])).join('\n');
}

module.exports = { boxHeader, controlStrip };
