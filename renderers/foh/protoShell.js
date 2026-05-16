'use strict';

// ============================================================
// renderers/foh/protoShell.js
//
// PHASE 1 — FORENSIC PARITY (operator directive 2026-05-17).
//
// Loads the prototype HTML files at
//   docs/screenshots/dh-foh-v6.html
//   docs/screenshots/market-intel-foh-v3.html
// and exposes them VERBATIM as the renderable source. These are
// the exact reproduction targets — no template substitution at
// this layer.
//
// Phase-3 adapter layer (marketIntelV3Adapter.js / darkHorseV6Adapter.js)
// performs surgical find-and-replace of known strings to inject
// live engine values, while preserving every other byte of the
// prototype HTML.
// ============================================================

const fs = require('fs');
const path = require('path');

// Locate the artefact directory. In production layouts the
// `docs/screenshots/` tree is shipped alongside the renderer.
const _ARTEFACT_DIR = path.join(__dirname, '..', '..', 'docs', 'screenshots');

function _read(name) {
  try {
    return fs.readFileSync(path.join(_ARTEFACT_DIR, name), 'utf8');
  } catch (e) {
    return null;
  }
}

// Cache the file reads so the prototype shell is only loaded
// once per process lifetime.
let _dhV6Cache = null;
let _miV3Cache = null;

function getDarkHorseV6Html() {
  if (_dhV6Cache == null) _dhV6Cache = _read('dh-foh-v6.html');
  return _dhV6Cache;
}

function getMarketIntelV3Html() {
  if (_miV3Cache == null) _miV3Cache = _read('market-intel-foh-v3.html');
  return _miV3Cache;
}

// ── 7-message split for MI v3 ──────────────────────────────
// The prototype is structured as 7 sequential message blocks
// (data-idx="0" through data-idx="6"). Operator brief PR #118
// requires Discord delivery as 6 separate PNG cards. We slice
// the prototype HTML at message-boundary markers and emit each
// slice as a standalone HTML doc with the same <head> + CSS.
//
// Slice mapping (per operator PR #118):
//   Card 1 — Msg 0 (banner + mood + events) + Msg 1 (primary)
//   Card 2 — Msg 2 (reaction paths)
//   Card 3 — Msg 3 (risk escalation)
//   Card 4 — Msg 4 (what to watch)
//   Card 5 — Msg 5 (event-day reference)
//   Card 6 — Msg 6 (briefing summary)
function _extractHead(html) {
  const m = /<head>[\s\S]*?<\/head>/i.exec(html);
  return m ? m[0] : '<head></head>';
}

function _extractChannelHeader(html) {
  const m = /<div class="channel-header">[\s\S]*?<\/div>(?=\s*\n)/i.exec(html);
  return m ? m[0] : '';
}

function _extractMessage(html, idx) {
  const re = new RegExp('<div class="message"[^>]*data-idx="' + idx + '"[\\s\\S]*?</div>\\s*</div>(?:\\s*</div>\\s*</div>)?', 'i');
  const m = re.exec(html);
  return m ? m[0] : '';
}

function _wrapAsChannel(head, channelHeader, ...messages) {
  return '<!doctype html>\n<html>' + head + '\n<body>\n<div class="channel">\n' + channelHeader + '\n' + messages.join('\n') + '\n</div>\n</body></html>';
}

function buildMarketIntelV3Cards(html) {
  if (!html) return [];
  const head = _extractHead(html);
  const ch = _extractChannelHeader(html);
  const msg = (i) => _extractMessage(html, i);
  return [
    { label: 'card-1-mood-events-primary', html: _wrapAsChannel(head, ch, msg(0), msg(1)) },
    { label: 'card-2-reaction-paths',      html: _wrapAsChannel(head, ch, msg(2)) },
    { label: 'card-3-risk-escalation',     html: _wrapAsChannel(head, ch, msg(3)) },
    { label: 'card-4-what-to-watch',       html: _wrapAsChannel(head, ch, msg(4)) },
    { label: 'card-5-event-day-reference', html: _wrapAsChannel(head, ch, msg(5)) },
    { label: 'card-6-briefing-summary',    html: _wrapAsChannel(head, ch, msg(6)) },
  ];
}

// ── DH v6 multi-message split ──────────────────────────────
// The DH v6 prototype is structured as N sequential message
// blocks (banner + per-candidate cards + reference card). We
// split into roughly section-sized cards for Discord delivery:
//   Card 1 — Msg 0 (banner + mood) + Msg 1 (FRESH candidate)
//   Card 2 — Msg 2 (STILL ACTIVE candidate)
//   Card 3 — Msg 3 (FADING candidate)
//   Card 4 — Msg 4+ (reference card + footer if any)
function _countMessages(html) {
  if (!html) return 0;
  const re = /<div class="message"[^>]*data-idx="(\d+)"/g;
  let max = -1, m;
  while ((m = re.exec(html)) !== null) max = Math.max(max, parseInt(m[1], 10));
  return max + 1;
}

function buildDarkHorseV6Cards(html) {
  if (!html) return [];
  const head = _extractHead(html);
  const ch = _extractChannelHeader(html);
  const msg = (i) => _extractMessage(html, i);
  const total = _countMessages(html);
  // Build cards by section. Card 1 always carries the banner.
  // Cards 2-N carry one candidate / reference block each.
  if (total <= 1) return [{ label: 'card-1-full', html }];
  const cards = [];
  cards.push({ label: 'card-1-banner-and-fresh', html: _wrapAsChannel(head, ch, msg(0), msg(1)) });
  if (total >= 3) cards.push({ label: 'card-2-still-active', html: _wrapAsChannel(head, ch, msg(2)) });
  if (total >= 4) cards.push({ label: 'card-3-fading', html: _wrapAsChannel(head, ch, msg(3)) });
  // Roll remaining messages (reference, footer) into Card 4.
  if (total >= 5) {
    const tail = [];
    for (let i = 4; i < total; i++) tail.push(msg(i));
    cards.push({ label: 'card-4-reference-and-footer', html: _wrapAsChannel(head, ch, ...tail) });
  }
  return cards;
}

module.exports = {
  getDarkHorseV6Html,
  getMarketIntelV3Html,
  buildMarketIntelV3Cards,
  buildDarkHorseV6Cards,
};
