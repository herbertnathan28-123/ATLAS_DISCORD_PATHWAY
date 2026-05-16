'use strict';

// ============================================================
// renderers/foh/marketIntelV3Adapter.js
//
// PHASE 3 — DATA INJECTION WITHOUT VISUAL DRIFT (operator
// directive 2026-05-17).
//
// Reads the prototype HTML at docs/screenshots/market-intel-foh-v3.html
// (loaded by protoShell.js) and performs SURGICAL find-and-replace
// of known strings to inject live engine values from the FOH
// packet. Every other byte of the prototype HTML is preserved
// byte-identical — no template variables introduced, no
// structural edits, no CSS changes.
//
// Adapter contract: takes (prototypeHtml, fohPacket) and returns
// an adaptedHtml string that is identical to the prototype
// except at named anchor points where live values are injected.
//
// Anchor points are KNOWN STRINGS from the prototype. The
// adapter is intentionally non-invasive — if a packet doesn't
// have a value for an anchor, the prototype default stays.
// ============================================================

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _fmtNow(ms) {
  const d = new Date(ms || Date.now());
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];
  const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  const pad = n => (n < 10 ? '0' : '') + n;
  return dayName + ' ' + d.getUTCDate() + ' ' + monthName + ' · ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC · macro briefing · live intel';
}

// Build the live event rows that replace the prototype's
// hardcoded 3-row events table. Format mirrors the prototype:
//   `HH:MM UTC   <Event title> (<currency>)   <severity discs> N/5 — <SEV>`
function _buildLiveEventsTable(packet) {
  const allEvents = [];
  for (const c of (packet.eventClusters || [])) for (const ev of (c.events || [])) {
    allEvents.push({ ev, ccy: c.currency });
  }
  allEvents.sort((a, b) => (a.ev.time || '').localeCompare(b.ev.time || ''));
  const rows = allEvents.slice(0, 5).map(({ ev, ccy }) => {
    const sevColor = ev.severity === 'HIGH' ? '#ED4245' : '#5BC0DE';
    const discs = ev.severity === 'HIGH' ? '🟠🟠🟠🟠⚫ 4/5 — HIGH'
                : ev.severity === 'MEDIUM' ? '🟠🟠🟠⚫⚫ 3/5 — MEDIUM'
                : '🟡🟡⚫⚫⚫ 2/5 — LOW-MEDIUM';
    const timeUtc = (ev.time && ev.time.split(' · ')[1]) || ev.time || '';
    return `<span style="color:${sevColor};font-weight:700">${_esc(timeUtc)}   ${_esc(ev.title || '')} (${_esc(ccy || ev.currency || 'multi')})   ${discs}</span>`;
  });
  return rows.length ? rows.join('\n') : '<span style="color:#B9BBBE">No high-impact events in the current window — driver-led session.</span>';
}

function adapt(prototypeHtml, packet) {
  if (!prototypeHtml || !packet) return prototypeHtml || '';
  let html = prototypeHtml;
  const ctx = { now: Date.now() };

  // ── Banner timestamp ─────────────────────────────────────
  const liveBanner = _fmtNow(ctx.now);
  html = html.replace(/Tuesday 13 May · 11:00 UTC · macro briefing · live intel/g, liveBanner);

  // ── Event count narrative ────────────────────────────────
  const highCount = (packet.eventClusters || []).reduce((n, c) => n + (c.events || []).filter(e => e.severity === 'HIGH').length, 0);
  const eventCountText = highCount === 0
    ? 'No high-impact event landing in the next 6 hours.'
    : highCount === 1
    ? '1 major event landing in the next 6 hours.'
    : highCount + ' major events landing in the next 6 hours.';
  html = html.replace(/2 major events landing in the next 6 hours\./g, eventCountText);

  // ── Market mood discs + label ────────────────────────────
  const moodDiscs = (packet.marketMood && packet.marketMood.discs) || '🟠🟠🟠🟠⚫';
  const moodLabel = (packet.marketMood && packet.marketMood.label) || '4/5 — Elevated';
  const liveMoodLine = 'Combined risk state: ' + moodDiscs + ' ' + moodLabel + '. See operational read below.';
  html = html.replace(/Combined risk state: 🟠🟠🟠🟠⚫ 4\/5 — Elevated\. See operational read below\./g, liveMoodLine);
  html = html.replace(/▸  Risk State  ·  🟠🟠🟠🟠⚫ 4\/5 — Elevated/g, '▸  Risk State  ·  ' + moodDiscs + ' ' + moodLabel);

  // ── Major events table ───────────────────────────────────
  // Replace the prototype's 3-row events table with live event
  // rows from the packet. The prototype's exact event-table
  // block is identified by the wrapping <pre class="fence">.
  const liveTable = _buildLiveEventsTable(packet);
  const tableRe = /<pre class="fence"><span style="color:#ED4245;font-weight:700">12:30 UTC[\s\S]*?fireside chat[\s\S]*?LOW-MEDIUM<\/span><\/pre>/;
  html = html.replace(tableRe, '<pre class="fence">' + liveTable + '</pre>');

  // ── Primary event card title + time ──────────────────────
  const featured = (packet.eventClusters || []).find(c => c.severity === 'HIGH') || (packet.eventClusters || [])[0];
  const featEvent = featured && featured.events && featured.events[0];
  if (featEvent) {
    const featCcy = (featEvent.currency || featured.currency || 'multi').toUpperCase();
    const ccyFlag = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭' }[featCcy] || '🌐';
    const featTitle = featEvent.title || 'lead catalyst';
    const featTimeUtc = (featEvent.time && featEvent.time.split(' · ')[1]) || featEvent.time || 'pending';
    const sevTag = featEvent.severity === 'HIGH' ? '🟠 HIGH' : featEvent.severity === 'MEDIUM' ? '🟡 MEDIUM' : '🟦 LOW';
    // Embed title (proto: "🇺🇸  ·  US CPI · April release  ·  🟠 HIGH")
    html = html.replace(/🇺🇸  ·  US CPI · April release  ·  🟠 HIGH/g, _esc(ccyFlag) + '  ·  ' + _esc(featTitle) + '  ·  ' + _esc(sevTag));
    // Primary event red diff fence (proto: "- 🆕  PRIMARY EVENT  ·  US CPI · 12:30 UTC")
    html = html.replace(/- 🆕  PRIMARY EVENT  ·  US CPI · 12:30 UTC/g, '- 🆕  PRIMARY EVENT  ·  ' + _esc(featTitle) + ' · ' + _esc(featTimeUtc));
    // Embed "When" field value (proto: "Today  ·  12:30 UTC")
    html = html.replace(/<div class="embed-field-value">Today  ·  12:30 UTC<\/div>/g,
                        '<div class="embed-field-value">Today  ·  ' + _esc(featTimeUtc) + '</div>');
    // Embed footer (proto: "ATLAS · Market Intel · Today  ·  12:30 UTC")
    html = html.replace(/ATLAS · Market Intel · Today  ·  12:30 UTC/g, 'ATLAS · Market Intel · Today  ·  ' + _esc(featTimeUtc));
  }

  return html;
}

module.exports = { adapt };
