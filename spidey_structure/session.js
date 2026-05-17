'use strict';

// ============================================================
// spidey_structure/session.js
//
// UTC-hour → trading session mapping. Used by Spidey to surface
// session context (Asia / London / NY / late-NY) for the
// liquidity / structure reads. Liquidity dynamics shift between
// sessions and Spidey's confidence weighting reflects it.
// ============================================================

function detectSession(timestampOrNow) {
  const t = typeof timestampOrNow === 'number' ? timestampOrNow
          : typeof timestampOrNow === 'string' ? Date.parse(timestampOrNow)
          : Date.now();
  if (!Number.isFinite(t)) return { session: 'unknown', utcHour: null };
  const utcHour = new Date(t).getUTCHours();
  let session;
  let liquidity;
  if (utcHour >= 22 || utcHour < 7) { session = 'ASIA';     liquidity = 'thin — slow grinds + range-bound';     }
  else if (utcHour < 12)             { session = 'LONDON';   liquidity = 'expansion — directional impulse most likely'; }
  else if (utcHour < 16)             { session = 'NY_OPEN';  liquidity = 'peak — institutional flow, fastest moves'; }
  else if (utcHour < 21)             { session = 'NY';       liquidity = 'normal — directional reads decay through close'; }
  else                               { session = 'LATE_NY';  liquidity = 'thinning into Asia hand-off'; }
  return { session, utcHour, liquidity };
}

module.exports = { detectSession };
