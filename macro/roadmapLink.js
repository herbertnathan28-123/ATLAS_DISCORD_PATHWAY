'use strict';
// §4 Roadmap link block. Roadmap depth doctrine (§14): Mon full / midweek prune / Fri execution.
// URL is provided by env var ATLAS_ROADMAP_URL; if missing, the block tells the reader where it lives.

function build(_input) {
  const url = process.env.ATLAS_ROADMAP_URL || null;
  const day = new Date().getUTCDay(); // 0 Sun .. 6 Sat
  const phase = day === 1 ? 'Monday — full depth (30–35 page equivalent)'
              : day === 5 ? 'Friday — execution-focused'
              : 'Midweek — outdated sections pruned, explanations intact';
  const lines = ['## Roadmap'];
  if (url) lines.push(`**Current roadmap:** ${url}`);
  else     lines.push('**Current roadmap:** link not configured (set `ATLAS_ROADMAP_URL` env).');
  lines.push(`*Phase:* ${phase}.`);
  return lines.join('\n');
}

module.exports = { build };
