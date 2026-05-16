'use strict';
// §4 Roadmap link block. Operator directive 2026-05-17: Notion is
// private backend material and must never surface user-side. URL
// precedence is now:
//   1. ATLAS_ROADMAP_URL  (preferred — sanctioned ATLAS-facing URL)
//   2. ROADMAP_URL        (legacy env name, kept for back-compat)
//   3. None — the section emits a "phase only" stub rather than
//      routing the reader to an external workspace. The intelligence
//      is delivered directly in the Macro briefing surface.

function _isAllowedUrl(u) {
  if (typeof u !== 'string' || !/^https?:\/\//.test(u)) return false;
  return !/notion\.(so|com|site)/i.test(u);
}

function build(_input) {
  const candidate = process.env.ATLAS_ROADMAP_URL || process.env.ROADMAP_URL || '';
  const url = _isAllowedUrl(candidate) ? candidate : '';
  const day = new Date().getUTCDay(); // 0 Sun .. 6 Sat
  const phase = day === 1 ? 'Monday — full depth (30–35 page equivalent)'
              : day === 5 ? 'Friday — execution-focused'
              : 'Midweek — outdated sections pruned, explanations intact';
  const lines = ['## ROADMAP LINK'];
  if (url) {
    lines.push('**Current roadmap:** ' + url);
  } else {
    lines.push('**Current roadmap:** delivered inline in this briefing — no external workspace redirect.');
  }
  lines.push('*Phase:* ' + phase + '.');
  return lines.join('\n');
}

module.exports = { build };
