'use strict';
// §10 Validity footer line. The full Final Assessment lives inside Live Plan per §5.
// This block is the last-line reminder of when the entire macro read expires.

function build(input) {
  const { structure, calendar } = input;
  const lines = ['## Validity'];
  lines.push('');
  const window = structure?.validityWindow || 'until next macro refresh or structure shift';
  const nextHi = nextHighImpact(calendar);
  lines.push(`*Validity window:* ${window}.`);
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

function nextHighImpact(calendar) {
  const events = calendar?.snapshot?.events || [];
  const now = Date.now();
  return events.find(e => e && e.impact === 'high' && e.scheduled_time > now) || null;
}

module.exports = { build };
