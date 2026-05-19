'use strict';
// §7 Events / Catalysts. Compact upcoming-events list pulled from the
// calendar snapshot. Operator-facing copy only — no provenance line on
// the user surface (logged to console / audit collapsibles instead).
// Same-currency inflation prints inside the active window are clustered
// into a single row so the "Before / During / After" rule does not
// repeat for every related release.

const INFLATION_PATTERN = /\b(CPI|Core CPI|PPI|Core PPI|Inflation Rate|HICP|PCE)\b/i;

function build(input) {
  const { calendar, symbol } = input;
  const events = (calendar?.snapshot?.events || []).filter(e => e && e.scheduled_time && e.scheduled_time > Date.now());
  const lines = ['## Events / Catalysts'];
  lines.push('');
  if (!events.length) {
    lines.push(`*No upcoming high-impact events in the active window for ${symbol || 'this symbol'}.*`);
    // Provenance still logged for ops grep, never user-rendered.
    if (calendar?.snapshot?.health) {
      console.log('[CATALYSTS-SOURCE] source_used=' + (calendar.snapshot.health.source_used || 'unknown') + ' mode=' + (calendar.snapshot.health.calendar_mode || 'UNKNOWN'));
    }
    return lines.join('\n');
  }

  // Cluster same-currency inflation events scheduled inside the same
  // ±36-hour window into one logical row so action rules don't repeat.
  const top = events.slice(0, 8);
  const used = new Set();
  const rows = [];
  for (let i = 0; i < top.length; i++) {
    if (used.has(i)) continue;
    const e = top[i];
    if (INFLATION_PATTERN.test(e.title || '')) {
      const cluster = [e];
      used.add(i);
      for (let j = i + 1; j < top.length; j++) {
        const e2 = top[j];
        if (used.has(j)) continue;
        if ((e2.currency || '') !== (e.currency || '')) continue;
        if (!INFLATION_PATTERN.test(e2.title || '')) continue;
        if (Math.abs((e2.scheduled_time || 0) - (e.scheduled_time || 0)) > 36 * 3600 * 1000) continue;
        cluster.push(e2);
        used.add(j);
      }
      rows.push({ kind: 'inflation', currency: e.currency, items: cluster });
    } else {
      used.add(i);
      rows.push({ kind: 'single', item: e });
    }
    if (rows.length >= 5) break;
  }

  for (const r of rows) {
    if (r.kind === 'single') {
      const e = r.item;
      const t = new Date(e.scheduled_time).toISOString().replace('T', ' ').slice(0, 16);
      const f = e.expected != null ? e.expected : (e.forecast != null ? e.forecast : '—');
      const p = e.previous != null ? e.previous : '—';
      lines.push(`**${t} UTC · ${e.currency || '—'} · ${e.impact || '—'}:** ${e.title || '—'}`);
      lines.push(`Forecast: ${String(f)} · Previous: ${String(p)}`);
    } else {
      // Inflation cluster — one row, comma-joined event names + earliest time.
      const earliest = r.items.reduce((m, e) => e.scheduled_time < m ? e.scheduled_time : m, r.items[0].scheduled_time);
      const t = new Date(earliest).toISOString().replace('T', ' ').slice(0, 16);
      const titles = r.items.map(e => e.title || '—').join(', ');
      const impacts = [...new Set(r.items.map(e => e.impact).filter(Boolean))].join(' / ') || '—';
      lines.push(`**${t}+ UTC · ${r.currency || '—'} · ${impacts}:** ${r.items.length} ${r.currency || ''} inflation prints`);
      lines.push(`Events: ${titles}`);
      lines.push('Forecast / Previous: grouped');
    }
  }
  lines.push('');

  // Per-cluster commentary: why it matters + likely impact + ONE action
  // rule per cluster (not repeated per individual event).
  for (const r of rows) {
    if (r.kind === 'inflation') {
      lines.push(`**${r.currency} inflation cluster — ${r.items.length} prints inside the active window.**`);
      lines.push('Why it matters: hot or soft surprises reprice the front end of the curve and move the ' + (r.currency || 'currency') + ' against high-beta majors.');
      lines.push('Likely impact: hot prints support ' + (r.currency || 'currency') + ' and pressure non-' + (r.currency || 'currency') + ' majors / metals; soft prints do the opposite.');
      lines.push('Action rule: Entry not probable for this validity window during the ±2h window around any print in this cluster. After the LAST print, wait for fresh primary-timeframe structure to reform before re-engaging.');
      lines.push('');
    } else {
      const e = r.item;
      lines.push(`**${e.title} (${e.currency || '—'})** — ${e.impact || 'standard'} impact. Action: Entry not probable for this validity window during the ±2h release window; resume after fresh primary-timeframe structure prints post-release.`);
      lines.push('');
    }
  }

  // Provenance line goes to console only — never the user surface.
  if (calendar?.snapshot?.health) {
    console.log('[CATALYSTS-SOURCE] source_used=' + (calendar.snapshot.health.source_used || 'unknown') + ' mode=' + (calendar.snapshot.health.calendar_mode || 'UNKNOWN'));
  }
  return lines.join('\n');
}

module.exports = { build };
