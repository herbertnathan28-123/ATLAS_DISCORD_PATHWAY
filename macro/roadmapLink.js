'use strict';
// §4 Roadmap link block — link only (per locked spec; no embedded
// full content). URL precedence:
//   1. ATLAS_ROADMAP_URL  (preferred — live weekly roadmap)
//   2. ROADMAP_URL        (legacy env name, kept for back-compat)
//   3. Locked Notion Macro + Roadmap Master Brief URL (fallback only,
//      used until a proper weekly roadmap URL is supplied; never
//      surfaces as a "missing roadmap" fault to the user).

const NOTION_MASTER_BRIEF_URL =
  'https://www.notion.so/ATLAS-FX-Macro-Roadmap-Master-Brief-v2-0-LOCKED-5-April-2026';

function build(_input) {
  const url = process.env.ATLAS_ROADMAP_URL
           || process.env.ROADMAP_URL
           || NOTION_MASTER_BRIEF_URL;
  const day = new Date().getUTCDay(); // 0 Sun .. 6 Sat
  const phase = day === 1 ? 'Monday — full depth (30–35 page equivalent)'
              : day === 5 ? 'Friday — execution-focused'
              : 'Midweek — outdated sections pruned, explanations intact';
  const lines = ['## ROADMAP LINK'];
  lines.push('**Current roadmap:** ' + url);
  lines.push('*Phase:* ' + phase + '.');
  return lines.join('\n');
}

module.exports = { build };
