'use strict';
// §10 Validity footer line. The full Final Assessment lives inside Live
// Plan per §5. This block is the last-line reminder of when the entire
// macro read expires.
//
// Locked wording standard:
//   - Validity must show exact UTC + AWST expiry times.
//   - The vague "until next macro refresh or structure shift" wording
//     is BANNED. Always render: "Valid until [UTC] / [AWST], or earlier
//     if buyer/seller control changes before then."
//   - The early-expiry condition is buyer/seller control change, not
//     "structure shift" or any internal-engine narration.

const VALIDITY_DEFAULT_HOURS = 4;

function build(input) {
  const { structure, calendar } = input;
  const lines = ['## VALIDITY'];
  lines.push('');

  // Compute the validity expiry. Prefer structure.validityMinutes /
  // structure.validityExpiryUtc when the upstream packet supplies them;
  // otherwise default to 4 hours from build time.
  const expiryDate = computeExpiry(structure);
  lines.push(`*Validity:* ${formatExpiryLine(expiryDate)}`);

  const nextHi = nextHighImpact(calendar);
  if (nextHi) {
    const t = new Date(nextHi.scheduled_time).toISOString().replace('T', ' ').slice(0, 16);
    lines.push(`*Next high-impact catalyst:* ${nextHi.title} (${nextHi.currency}) at ${t} UTC — re-read this report inside the 2h pre-event window.`);
  } else {
    lines.push('*No upcoming high-impact catalyst inside the calendar window.*');
  }
  lines.push('');
  lines.push('*Re-read Trade Status before any new entry. Conditions change; the report does not.*');
  return lines.join('\n');
}

function computeExpiry(structure) {
  if (structure && structure.validityExpiryUtc) {
    const t = Date.parse(structure.validityExpiryUtc);
    if (Number.isFinite(t)) return new Date(t);
  }
  if (structure && Number.isFinite(structure.validityMinutes) && structure.validityMinutes > 0) {
    return new Date(Date.now() + structure.validityMinutes * 60 * 1000);
  }
  return new Date(Date.now() + VALIDITY_DEFAULT_HOURS * 60 * 60 * 1000);
}

function formatExpiryLine(d) {
  const pad = function (n) { return n < 10 ? '0' + n : n; };
  const utc = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
  // AWST = UTC+8 (no DST).
  const a = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const awst = pad(a.getUTCHours()) + ':' + pad(a.getUTCMinutes()) + ' AWST';
  return 'Valid until ' + utc + ' / ' + awst + ', or earlier if buyer/seller control changes before then.';
}

function nextHighImpact(calendar) {
  const events = (calendar && calendar.snapshot && calendar.snapshot.events) || [];
  const now = Date.now();
  return events.find(function (e) { return e && e.impact === 'high' && e.scheduled_time > now; }) || null;
}

module.exports = { build };
