'use strict';
// §7 Events / Catalysts. Compact upcoming-events list pulled from corey_calendar snapshot.

function build(input) {
  const { calendar, symbol } = input;
  const events = (calendar?.snapshot?.events || []).filter(e => e && e.scheduled_time && e.scheduled_time > Date.now());
  const next = events.slice(0, 5);
  const lines = ['## Events / Catalysts'];
  lines.push('');
  if (!next.length) {
    lines.push(`*No upcoming high-impact events in the active window for ${symbol || 'this symbol'}.*`);
    return lines.join('\n');
  }
  lines.push(`| When (UTC) | Currency | Event | Impact | Forecast | Previous |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const e of next) {
    const t = new Date(e.scheduled_time).toISOString().replace('T', ' ').slice(0, 16);
    const f = e.expected != null ? e.expected : (e.forecast != null ? e.forecast : '—');
    const p = e.previous != null ? e.previous : '—';
    lines.push(`| ${t} | ${e.currency || '—'} | ${escapePipe(e.title || '—')} | ${e.impact || '—'} | ${escapePipe(String(f))} | ${escapePipe(String(p))} |`);
  }
  lines.push('');
  lines.push(`*Source: ${calendar?.snapshot?.health?.source_used || 'unknown'} (mode: ${calendar?.snapshot?.health?.calendar_mode || 'UNKNOWN'}).*`);
  return lines.join('\n');
}

function escapePipe(s) { return String(s).replace(/\|/g, '\\|'); }

module.exports = { build };
