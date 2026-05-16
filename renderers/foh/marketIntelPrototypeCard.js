'use strict';

// ============================================================
// renderers/foh/marketIntelPrototypeCard.js
//
// EXACT REPRODUCTION of the v3 Market Intel prototype at
//   docs/screenshots/market-intel-foh-v3.html
// on branch claude/resume-n8n-work-LdFVz.
//
// Operator directive 2026-05-17 (post-PR #116):
//   "Stop treating the prototype as inspiration or a design
//    reference. The prototype IS the exact reproduction target."
//   "Do not modernise / simplify / reinterpret / clean up / create
//    a new flow / compress into a report surface / build a better
//    version. Reproduce it as closely as technically possible."
//
// This renderer copies the prototype's CSS, HTML structure,
// message ordering, code-fence ANSI styling, embed cards, and
// prose verbatim. Event-specific values (title, time, currency)
// are substituted from the FOH packet; structural elements are
// invariant. The packet-side content templates already match
// the prototype's prose because they were modelled on it
// (marketIntelDepthContent.js).
//
// Future controlled wording/doctrine improvements come AFTER
// parity, per operator brief.
// ============================================================

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Prototype CSS — copied verbatim from
// docs/screenshots/market-intel-foh-v3.html on branch
// claude/resume-n8n-work-LdFVz.
const PROTO_CSS = `
body {
  margin: 0; padding: 28px 20px;
  background: #36393F;
  color: #DCDDDE;
  font-family: "gg sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 18px;
  line-height: 1.55;
}
.channel {
  max-width: 780px;
  margin: 0 auto;
  background: #36393F;
}
.channel-header {
  border-bottom: 1px solid #2F3136;
  padding-bottom: 16px;
  margin-bottom: 28px;
  color: #B9BBBE;
  font-size: 15px;
  display: flex; gap: 10px; align-items: center;
}
.channel-header .hash { color: #72767D; font-size: 26px; font-weight: 600; }
.channel-header .name { color: #FFFFFF; font-weight: 600; font-size: 17px; }
.message {
  padding: 14px 0 14px 68px;
  position: relative;
  margin-bottom: 16px;
}
.message::before {
  content: ""; position: absolute; left: 12px; top: 14px;
  width: 40px; height: 40px; border-radius: 50%;
  background: linear-gradient(135deg, #5865F2, #EB459E);
}
.message::after {
  content: "ATLAS  ·  Market Intel";
  position: absolute; left: 68px; top: -2px;
  color: #FFFFFF; font-weight: 600; font-size: 16px;
}
.message-content {
  margin-top: 22px;
  color: #DCDDDE;
  white-space: normal;
  word-break: break-word;
}
.message-content pre.fence {
  background: #2F3136;
  border-radius: 6px;
  padding: 14px 16px;
  margin: 10px 0;
  font-family: Consolas, "DejaVu Sans Mono", "Liberation Mono", Monaco, "Courier New", Courier, monospace;
  font-size: 15px;
  line-height: 1.55;
  color: #B9BBBE;
  white-space: pre;
  overflow-x: auto;
}
.embed {
  max-width: 620px;
  margin-top: 14px;
  background: #2F3136;
  border-left: 5px solid #4F545C;
  border-radius: 6px;
  padding: 16px 20px 18px;
}
.embed-title {
  color: #FFFFFF;
  font-weight: 700;
  font-size: 19px;
  margin-bottom: 8px;
  line-height: 1.35;
}
.embed-desc {
  color: #DCDDDE;
  font-size: 16px;
  line-height: 1.55;
  margin-bottom: 14px;
}
.embed-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 24px;
}
.embed-field.block { grid-column: 1 / -1; }
.embed-field.inline { grid-column: span 1; }
.embed-field-name {
  color: #FFFFFF;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.embed-field-value {
  color: #DCDDDE;
  font-size: 16px;
  line-height: 1.6;
}
.embed-field-value .entry    { color: #23A55A; font-weight: 700; display: block; margin: 4px 0; }
.embed-field-value .stop     { color: #ED4245; font-weight: 700; display: block; margin: 4px 0; }
.embed-field-value .caution  { color: #F1C40F; font-weight: 700; display: block; margin: 4px 0; }
.embed-field-value .marginal { color: #E67E22; font-weight: 700; display: block; margin: 4px 0; }
.embed-field-value .warn     { color: #F1C40F; font-weight: 600; display: block; margin: 4px 0; }
.embed-field-value .info-line { color: #5BC0DE; font-weight: 600; display: block; margin: 4px 0; }
.embed-field-value .term-chip { color: #5BC0DE; font-weight: 700; letter-spacing: 0.3px; }
.embed-field-value .money-line { color: #FAA61A; font-weight: 700; display: block; margin: 4px 0; }
.embed-field-value .px-entry   { color: #23A55A; font-weight: 700; }
.embed-field-value .px-watch   { color: #F1C40F; font-weight: 700; }
.embed-field-value .px-caution { color: #E67E22; font-weight: 700; }
.embed-field-value .px-invalid { color: #ED4245; font-weight: 700; }
.embed-field-value .px-money   { color: #FAA61A; font-weight: 700; }
.message-content .px-entry     { color: #23A55A; font-weight: 700; }
.message-content .px-watch     { color: #F1C40F; font-weight: 700; }
.message-content .px-caution   { color: #E67E22; font-weight: 700; }
.message-content .px-invalid   { color: #ED4245; font-weight: 700; }
.message-content .px-money     { color: #FAA61A; font-weight: 700; }
.embed-field-value .term-link,
.message-content .term-link {
  color: #5BC0DE;
  text-decoration: underline;
  text-decoration-color: rgba(91,192,222,0.55);
  text-underline-offset: 2px;
  font-weight: 600;
}
.embed-footer {
  color: #72767D;
  font-size: 13px;
  line-height: 1.5;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #40444B;
}
.chart-card {
  background: #131722;
  border: 1px solid #2B313C;
  border-radius: 6px;
  margin: 12px 0 14px;
  padding: 4px 4px 0;
}
.chart-card svg { display: block; width: 100%; height: auto; border-radius: 4px; }
.chart-card-caption {
  color: #72767D;
  font-size: 12px;
  font-family: Consolas, monospace;
  padding: 6px 8px 8px;
  text-align: center;
}
/* Defeat PDF text-extraction kerning artefacts (operator brief
   2026-05-16: "Confi rmed" / "Y oY" / "Infl ation" word-fragment
   bug in extracted PDFs). */
html, body {
  letter-spacing: normal;
  word-spacing: normal;
  font-feature-settings: "liga" 0, "clig" 0;
  -webkit-font-smoothing: antialiased;
}
`;

// ── Helpers ─────────────────────────────────────────────────

function _termLink(label, anchor) {
  return `<a class="term-link" href="#term-${esc(anchor)}" title="#term-${esc(anchor)}">${esc(label)}</a>`;
}

function _ansiFence(lines) {
  return `<pre class="fence">${lines}</pre>`;
}

function _ansi(colour, text, weight) {
  const w = weight ? `;font-weight:${weight}` : '';
  return `<span style="color:${colour}${w}">${esc(text)}</span>`;
}

// SVG chart card — copied verbatim from the prototype. The
// prototype itself acknowledges "future scans will replace the
// prototype chart with live ATLAS chart snapshots taken during
// real CPI announcements" — for now this is the literal proto
// SVG so the visual cadence matches the reference 1:1.
function _protoChartCard(symbolLabel, captionTrailer) {
  return `
    <div class="chart-card">
      <svg viewBox="0 0 540 220" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="540" height="220" fill="#131722"/>
        <rect x="12" y="85.51" width="438" height="26.99" fill="rgba(35,165,90,0.18)"/>
        <line x1="12" y1="148.48" x2="450" y2="148.48" stroke="#F1C40F" stroke-width="1" stroke-dasharray="4 4"/>
        <text x="18" y="145.48" fill="#F1C40F" font-family="Consolas, monospace" font-size="11">watch</text>
        <line x1="12" y1="193.45" x2="450" y2="193.45" stroke="#ED4245" stroke-width="1.5" stroke-dasharray="6 4"/>
        <text x="18" y="206.45" fill="#ED4245" font-family="Consolas, monospace" font-size="11">invalidation</text>
        <line x1="48.5" y1="103.5" x2="48.5" y2="121.49" stroke="#00ff00" stroke-width="1"/>
        <rect x="27" y="108.9" width="43" height="3.6" fill="#00ff00"/>
        <line x1="121.5" y1="98.1" x2="121.5" y2="116.1" stroke="#00ff00" stroke-width="1"/>
        <rect x="100" y="103.5" width="43" height="5.4" fill="#00ff00"/>
        <line x1="194.5" y1="76.5" x2="194.5" y2="148.48" stroke="#ff0015" stroke-width="1"/>
        <rect x="173" y="103.5" width="43" height="26.99" fill="#ff0015"/>
        <line x1="267.5" y1="49.5" x2="267.5" y2="157.47" stroke="#00ff00" stroke-width="1"/>
        <rect x="246" y="72.9" width="43" height="57.57" fill="#00ff00"/>
        <line x1="340.5" y1="49.5" x2="340.5" y2="85.5" stroke="#00ff00" stroke-width="1"/>
        <rect x="319" y="58.5" width="43" height="14.39" fill="#00ff00"/>
        <line x1="413.5" y1="22.5" x2="413.5" y2="67.5" stroke="#00ff00" stroke-width="1"/>
        <rect x="392" y="31.5" width="43" height="26.99" fill="#00ff00"/>
        <rect x="454" y="0" width="82" height="20" rx="3" fill="#FFD600"/>
        <text x="460" y="14" fill="#000" font-family="Consolas, monospace" font-size="11" font-weight="700">HIGH 1.0985</text>
        <rect x="454" y="84" width="82" height="20" rx="3" fill="#00FF5A"/>
        <text x="460" y="98" fill="#000" font-family="Consolas, monospace" font-size="11" font-weight="700">CURRENT 1.0930</text>
        <rect x="454" y="89" width="82" height="20" rx="3" fill="#FF9100"/>
        <text x="460" y="103" fill="#000" font-family="Consolas, monospace" font-size="11" font-weight="700">ENTRY 1.0928</text>
        <rect x="454" y="156" width="82" height="20" rx="3" fill="#00B0FF"/>
        <text x="460" y="170" fill="#FFF" font-family="Consolas, monospace" font-size="11" font-weight="700">LOW 1.0890</text>
        <text x="12" y="12" fill="#DCDDDE" font-family="gg sans, sans-serif" font-size="12" font-weight="700">${esc(symbolLabel || 'EURUSD · 5m · event window')}</text>
      </svg>
      <div class="chart-card-caption">ATLAS chart card · ${esc(captionTrailer || 'pre-event calm → T-0 chaos → post-settle direction')}</div>
    </div>`;
}

// ── Top banner / divider (Msg 0 header) ─────────────────────
function _msgZero(packet, ctx) {
  const dt = new Date(ctx.now || Date.now());
  const pad = n => (n < 10 ? '0' : '') + n;
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()];
  const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getUTCMonth()];
  const dateStr = dayName + ' ' + dt.getUTCDate() + ' ' + monthName + ' · ' + pad(dt.getUTCHours()) + ':' + pad(dt.getUTCMinutes()) + ' UTC · macro briefing · live intel';
  const highCount = (packet.eventClusters || []).reduce((n, c) => n + (c.events || []).filter(e => e.severity === 'HIGH').length, 0);
  const moodDiscs = (packet.marketMood && packet.marketMood.discs) || '🟠🟠🟠🟠⚫';
  const moodLabel = (packet.marketMood && packet.marketMood.label) || (highCount >= 2 ? '4/5 — Elevated' : highCount === 1 ? '3/5 — Active' : '2/5 — Calm');
  const fenceTop = _ansiFence(
    _ansi('#ED4245', '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━') + '\n' +
    _ansi('#ED4245', '- ▼ ▼ ▼   N E W   M A R K E T   I N T E L   ▼ ▼ ▼') + '\n' +
    _ansi('#ED4245', '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━') + '\n' +
    _ansi('#ED4245', '- 📡   ' + dateStr + '   📡') + '\n' +
    _ansi('#ED4245', '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  );
  const banner = _ansiFence(
    _ansi('#FAA61A', '╔══════════════════════════════════════════════════╗', 700) + '\n' +
    _ansi('#FAA61A', '║   📡  MARKET INTEL — LIVE MACRO BRIEFING        ║', 700) + '\n' +
    _ansi('#FAA61A', '╚══════════════════════════════════════════════════╝', 700)
  );
  const subBanner = `_${esc(highCount || 'No')} major event${highCount === 1 ? '' : 's'} landing in the next 6 hours._<br>_Combined risk state: ${esc(moodDiscs)} ${esc(moodLabel)}. See operational read below._`;
  const termsRow = `📘 <strong>EXPANDED TERMINOLOGY HYPERLINKS</strong><br>` + _ansiFence(
    [['CPI','cpi'],['Hawkish','hawkish'],['Dovish','dovish'],['Risk-On / Risk-Off','risk-on-risk-off'],['Yield Spread','yield-spread'],['VIX','vix'],['Expected Duration','expected-duration']]
      .map(([l, _a]) => `<span style="color:#5BC0DE;font-weight:700">${esc(l)}]</span>`)
      .join('  ')
  );
  const moodBanner = _ansiFence(
    _ansi('#FAA61A', '╔══════════════════════════════════════════════════╗', 700) + '\n' +
    _ansi('#FAA61A', '║   🌐  GLOBAL MARKET MOOD  &  RISK STATE         ║', 700) + '\n' +
    _ansi('#FAA61A', '╚══════════════════════════════════════════════════╝', 700)
  );
  const riskRow = _ansiFence(_ansi('#FAA61A', '▸  Risk State  ·  ' + moodDiscs + ' ' + moodLabel, 700));
  const featured = (packet.eventClusters || []).find(c => c.severity === 'HIGH');
  const featEvent = featured && featured.events && featured.events[0];
  const moodPara = `_What ${_termLink('Market Mood','market-mood')} means right now:_<br>` +
    (highCount >= 2
      ? `   Markets are sensitive. ${featEvent ? esc(featEvent.title) + ' at ' + esc(featEvent.time) : 'A high-impact event window'}<br>   plus other clustered catalysts create a window<br>   where surprises can move dollar pairs, gold, and US equities<br>   in a coordinated way.`
      : highCount === 1
      ? `   A single high-impact catalyst is in the window: ${featEvent ? esc(featEvent.title) + ' at ' + esc(featEvent.time) : 'the lead event'}.<br>   Concentrated 30-minute risk envelope around the release.`
      : `   No clustered high-impact catalyst this window. Driver-led<br>   tape — direction set by live US Dollar Index, CBOE Volatility<br>   Index, and yield curve reads.`);
  // Trader-behaviour stages (kept verbatim from prototype prose
  // with event-name substitution so structure stays identical).
  const eventLabel = featEvent ? esc(featEvent.title) : 'the lead event';
  const eventTime = featEvent ? esc(featEvent.time.split(' · ')[1] || featEvent.time) : 'the release window';
  const tbStage = `_What this means for trader behaviour today (dollars-first):_<br>` +
    `   🟢 Pre-event window — If your normal risk per trade is $500 on a<br>` +
    `       $10,000 account, reduce to ~$300 (60% of normal) for the<br>` +
    `       next 6 hours. Why: bigger market swings mean wider exit-points<br>` +
    `       are needed, which means more $$$ at risk per setup.<br>` +
    `   🟡 During ${eventLabel} (${eventTime} → T+5) — do NOT trade. Do NOT add<br>` +
    `       to open positions. The first 60 seconds after the <span class="px-watch">announced</span><br>` +
    `       <span class="px-watch">result</span> routinely moves $500–$1,000 against any position<br>` +
    `       on a standard $100k EURUSD lot.<br>` +
    `   🟠 After ${eventLabel} (T+5 → next catalyst) — wait for the 5-min candle close<br>` +
    `       at T+5 to read direction. Then re-size, still at 60% of<br>` +
    `       normal until the next scheduled catalyst delivers.<br>` +
    `   🛑 If multiple clustered events ALL surprise on the ${_termLink('hawkish','hawkish')} side:<br>` +
    `       stand aside entirely for the rest of the session.`;
  const whyRatingBlock = packet.comparisonNotes && packet.comparisonNotes.whyThisRating
    ? `_Why this rating, not lower or higher:_<br>   ${esc(packet.comparisonNotes.whyThisRating)}`
    : '';
  const majorEventsBanner = _ansiFence(
    _ansi('#5865F2', '╔══════════════════════════════════════════════════╗', 700) + '\n' +
    _ansi('#5865F2', '║   📅  MAJOR EVENTS  ·  NEXT 24 HOURS            ║', 700) + '\n' +
    _ansi('#5865F2', '╚══════════════════════════════════════════════════╝', 700)
  );
  // Build event table (top 5 events from clusters, chronological)
  const allEvents = [];
  for (const c of (packet.eventClusters || [])) for (const ev of (c.events || [])) allEvents.push({ ev, ccy: c.currency });
  allEvents.sort((a, b) => (a.ev.time || '').localeCompare(b.ev.time || ''));
  const rows = allEvents.slice(0, 5).map(({ ev, ccy }) => {
    const sevColor = ev.severity === 'HIGH' ? '#ED4245' : ev.severity === 'MEDIUM' ? '#5BC0DE' : '#5BC0DE';
    const sevDiscs = ev.severity === 'HIGH' ? '🟠🟠🟠🟠⚫ 4/5 — HIGH'
                    : ev.severity === 'MEDIUM' ? '🟠🟠🟠⚫⚫ 3/5 — MEDIUM'
                    : '🟡🟡⚫⚫⚫ 2/5 — LOW-MEDIUM';
    const timeUtc = (ev.time && ev.time.split(' · ')[1]) || ev.time;
    return _ansi(sevColor, (timeUtc || '—') + '   ' + (ev.title || 'untitled') + ' (' + (ccy || ev.currency || 'multi') + ')   ' + sevDiscs, 700);
  }).join('\n');
  const eventsTable = _ansiFence(rows || _ansi('#B9BBBE', 'No high-impact events in the window — driver-led session.'));
  const whyEventsBanner = _ansiFence(_ansi('#FAA61A', '▸  Why these events matter (plain English)', 700));
  const whyEventsBlurb = featEvent
    ? `   ${esc(featEvent.whyExpanded || featEvent.driverLine || 'See WHY THIS MATTERS panel above for the operational read.')}`
    : `   No high-impact catalyst inside the window — read cross-asset<br>   from live DXY / VIX / yield rather than from the calendar.`;
  return `
    <div class="message" data-idx="0">
      <div class="message-content">${fenceTop}<br><br>${banner}<br><br>${subBanner}<br><br>${termsRow}<br><br>${moodBanner}<br><br>${riskRow}<br><br>${moodPara}<br><br>${tbStage}<br><br>${whyRatingBlock}<br><br>${majorEventsBanner}<br><br>${eventsTable}<br><br>${whyEventsBanner}<br><br>${whyEventsBlurb}</div>
    </div>`;
}

// ── Primary event card (Msg 1) ──────────────────────────────
function _msgOne(packet) {
  const featured = (packet.eventClusters || []).find(c => c.severity === 'HIGH') || packet.eventClusters[0];
  const ev = featured && featured.events && featured.events[0];
  if (!ev) return '';
  const ccyFlag = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿', CNY: '🇨🇳' }[ev.currency] || '🌐';
  const sevColor = ev.severity === 'HIGH' ? '#e74c3c' : ev.severity === 'MEDIUM' ? '#F1C40F' : '#5BC0DE';
  const sevTag = ev.severity === 'HIGH' ? '🟠 HIGH' : ev.severity === 'MEDIUM' ? '🟡 MEDIUM' : '🟦 LOW';
  const timeUtc = (ev.time && ev.time.split(' · ')[1]) || ev.time;
  const titleFence = _ansiFence(_ansi('#ED4245', '- 🆕  PRIMARY EVENT  ·  ' + (ev.title || 'untitled') + ' · ' + (timeUtc || '—')));
  const affectedRaw = (packet.affectedMarkets && packet.affectedMarkets.buckets) || {};
  const affectedList = Object.keys(affectedRaw).flatMap(k => affectedRaw[k] || []).slice(0, 9).join('  ·  ');
  const dir = ev.dollarImpactRange && ev.dollarImpactRange.available ? ev.dollarImpactRange : null;
  const dirRows = dir
    ? dir.first60sRanges.map(r => `<span class="money-line">💲   ${esc(r.range)} on ${esc(r.asset)}.</span>`).join('') +
      `<span class="money-line">💲 Median post-settle move: ${esc(dir.postSettleRange)}.</span>`
    : `<span class="money-line">💲 Dollar impact range — sourced unavailable (no scenario profile for this category yet).</span>`;
  // Concrete pre/during/post action lines — copied verbatim
  // from the prototype prose with event-name substitution so the
  // operational rhythm stays identical to the reference.
  const eventName = esc(ev.title);
  const wtwBlock =
    `🟢 BEFORE — Cut all dollar-pair positions to 60% of your normal trade size by ${esc(timeUtc || 'T-5')} − 5min. If your normal trade is 1 lot, begin at 0.6 lot (~<span class="px-money">$300 risk instead of $500</span>). Why: pre-announcement volatility makes wider exit-points necessary, which means more $$$ at risk per trade.<br>` +
    `🟡 DURING — Do NOT trade between ${esc(timeUtc || 'T-0')} and T+5. Do NOT add to open positions. The first 60 seconds is noise — the T+5 candle close shows the real direction.<br>` +
    `🟠 AFTER — Wait for the T+5 5-min candle close. Identify direction. Only re-enter on setups where price closes beyond the trigger level AND the next candle holds beyond it (the <span class="px-caution">confirmed directional structure test</span>). Still at 60% size until the next scheduled catalyst delivers.`;
  return `
    <div class="message" data-idx="1">
      <div class="message-content">${titleFence}</div>
    <div class="embed" style="border-left-color:${sevColor}">
      <div class="embed-title">${esc(ccyFlag)}  ·  ${esc(ev.title)}  ·  ${esc(sevTag)}</div>
      <div class="embed-desc">${esc(ev.whyExpanded || ev.driverLine || 'Scheduled macro release. Standard transmission: surprise → ' + ev.currency + ' repositions → correlated risk follows on the first HTF close.')}</div>
      ${_protoChartCard(ev.currency + ' · 5m · ' + ev.title + ' window')}
      <div class="embed-fields">
        <div class="embed-field inline">
          <div class="embed-field-name">When</div>
          <div class="embed-field-value">Today  ·  ${esc(timeUtc || '—')}</div>
        </div>
        <div class="embed-field inline">
          <div class="embed-field-name">Event Intensity</div>
          <div class="embed-field-value">${esc(ev.severity === 'HIGH' ? '🔴🔴🔴🔴⚫ 4/5 — High' : ev.severity === 'MEDIUM' ? '🟠🟠🟠⚫⚫ 3/5 — Medium' : '🟡🟡⚫⚫⚫ 2/5 — Low')}</div>
        </div>
        <div class="embed-field inline">
          <div class="embed-field-name">Expected Duration</div>
          <div class="embed-field-value">${_termLink('Intraday (next 6 hours)', 'expected-duration')}</div>
        </div>
        <div class="embed-field block">
          <div class="embed-field-name">Affected Markets</div>
          <div class="embed-field-value">${esc(affectedList || 'driver-led exposure')}</div>
        </div>
        <div class="embed-field block">
          <div class="embed-field-name">💲 Dollar impact range</div>
          <div class="embed-field-value"><span class="money-line">💲 Typical first-60-second swing range (scenario estimate basis — historical analogue cache not yet wired):</span>${dirRows}</div>
        </div>
        <div class="embed-field block">
          <div class="embed-field-name">What Traders Should Watch  ·  Pre / During / Post</div>
          <div class="embed-field-value">${wtwBlock}</div>
        </div>
      </div>
      <div class="embed-footer">ATLAS · Market Intel · Today  ·  ${esc(timeUtc || '—')}  ·  monitor in #market-intel</div>
    </div>
    </div>`;
}

// ── Reaction paths (Msg 2) ──────────────────────────────────
function _msgTwo(packet) {
  const featured = (packet.eventClusters || []).find(c => c.severity === 'HIGH') || packet.eventClusters[0];
  const ev = featured && featured.events && featured.events[0];
  const rp = ev && ev.reactionPaths;
  if (!rp || !rp.available || !Array.isArray(rp.scenarios)) {
    return `
    <div class="message" data-idx="2">
      <div class="message-content">${_ansiFence(_ansi('#ED4245', '- 🆕  REACTION PATHS  ·  unavailable (no scenario profile)'))}</div>
    </div>`;
  }
  const titleFence = _ansiFence(_ansi('#ED4245', '- 🆕  REACTION PATHS  ·  WHAT THE 4 OUTCOMES MEAN FOR YOU'));
  const banner = _ansiFence(
    _ansi('#5865F2', '╔══════════════════════════════════════════════════╗', 700) + '\n' +
    _ansi('#5865F2', '║   🎯  POSSIBLE MARKET REACTION PATHS            ║', 700) + '\n' +
    _ansi('#5865F2', '╚══════════════════════════════════════════════════╝', 700)
  );
  const termsRow = _ansiFence(
    ['Hawkish','Dovish','In-Line','Initial-Direction Reversal']
      .map(t => `<span style="color:#5BC0DE;font-weight:700">${esc(t)}]</span>`).join('  ')
  );
  const scenarioColour = (id) => id === 'hawkish' ? '#ED4245' : id === 'dovish' ? '#23A55A' : id === 'inline' ? '#5BC0DE' : '#EB459E';
  const scenarioBanner = (s) => _ansiFence(_ansi(scenarioColour(s.id), '▸  ' + s.label, 700));
  const scenarioBlock = (s) => {
    const beh = (s.expectedBehaviour || []).map(b => `   • ${esc(b)}`).join('<br>');
    const impact = (s.dollarImpactPerAsset || []).map(i => {
      const colour = i.direction === 'favoured' ? 'px-entry' : i.direction === 'pressured' ? 'px-caution' : '';
      return `   • ${esc(i.asset)}: <span class="${colour}">${esc(i.impact)}</span>`;
    }).join('<br>');
    const shouldDo = (s.shouldDo || []).map(x => `   ✓  ${esc(x)}`).join('<br>');
    const shouldNot = (s.shouldNotDo || []).map(x => `   ✘  ${esc(x)}`).join('<br>');
    return scenarioBanner(s) + `<br><br>   Affected markets:  ${(s.affectedMarkets || []).map(m => esc(m)).join('  ·  ')}<br><br>   Expected behaviour:<br>${beh}<br><br>   💲 Dollar impact (first 30 minutes after the release):<br>${impact}<br><br>   What you should do:<br>${shouldNot}<br>${shouldDo}`;
  };
  const scenarios = rp.scenarios.map(scenarioBlock).join('<br><br>');
  return `
    <div class="message" data-idx="2">
      <div class="message-content">${titleFence}<br><br>${banner}<br><br>${termsRow}<br><br>${scenarios}</div>
    </div>`;
}

// ── Risk escalation (Msg 3) ─────────────────────────────────
function _msgThree(packet) {
  const re = packet.riskEscalation;
  if (!re || !re.available) {
    return `
    <div class="message" data-idx="3">
      <div class="message-content">${_ansiFence(_ansi('#ED4245', '- 🆕  RISK ESCALATION  ·  unavailable'))}</div>
    </div>`;
  }
  const titleFence = _ansiFence(_ansi('#ED4245', '- 🆕  RISK ESCALATION  ·  PRE / DURING / POST'));
  const banner = _ansiFence(
    _ansi('#ED4245', '╔══════════════════════════════════════════════════╗', 700) + '\n' +
    _ansi('#ED4245', '║   ⚠️  RISK ESCALATION  ·  TIME-WINDOWED BEHAVIOUR║', 700) + '\n' +
    _ansi('#ED4245', '╚══════════════════════════════════════════════════╝', 700)
  );
  const termsRow = _ansiFence(
    ['Risk Escalation','Stand Aside','Position Sizing','Volatility Window']
      .map(t => `<span style="color:#5BC0DE;font-weight:700">${esc(t)}]</span>`).join('  ')
  );
  const stageColour = (sev, label) => /STAND ASIDE|DANGER|HIGH/i.test(label) || sev === 'HIGH' ? '#ED4245'
    : /CAUTION|MED/i.test(label) || sev === 'MEDIUM' ? '#FAA61A'
    : '#23A55A';
  const stageBlock = (s) => {
    const colour = stageColour(s.severity, s.label);
    return _ansi(colour, s.label, 700) + '<br>' +
      `   ${esc(s.description)}<br>` +
      `   💲 ${esc(s.dollarCost)}<br>` +
      `   Action: ${esc(s.action)}`;
  };
  const stagesText = re.stages.map(stageBlock).join('<br><br>');
  const stages = _ansiFence(stagesText);
  // "What changes this risk state" footnote
  const changes = packet.comparisonNotes && Array.isArray(packet.comparisonNotes.whatChangesThisState)
    ? `<br><br>${_ansiFence(_ansi('#FAA61A', '▸  What changes this risk state', 700))}<br><br>` +
      packet.comparisonNotes.whatChangesThisState.map(c => `   • ${esc(c)}`).join('<br>')
    : '';
  return `
    <div class="message" data-idx="3">
      <div class="message-content">${titleFence}<br><br>${banner}<br><br>${termsRow}<br><br>${stages}${changes}</div>
    </div>`;
}

// ── What to Watch (Msg 4) ───────────────────────────────────
function _msgFour(packet) {
  const featured = (packet.eventClusters || []).find(c => c.severity === 'HIGH') || packet.eventClusters[0];
  const ev = featured && featured.events && featured.events[0];
  const wtw = ev && ev.whatToWatch;
  if (!wtw || !wtw.available) {
    return `
    <div class="message" data-idx="4">
      <div class="message-content">${_ansiFence(_ansi('#ED4245', '- 🆕  WHAT TO WATCH  ·  unavailable'))}</div>
    </div>`;
  }
  const eventName = ev ? ev.title : 'the release';
  const titleFence = _ansiFence(_ansi('#ED4245', '- 🆕  WHAT TO WATCH  ·  PRE / DURING / POST ' + eventName));
  const banner = _ansiFence(
    _ansi('#FAA61A', '╔══════════════════════════════════════════════════╗', 700) + '\n' +
    _ansi('#FAA61A', '║   👀  WHAT TRADERS SHOULD WATCH (each row carries action)║', 700) + '\n' +
    _ansi('#FAA61A', '╚══════════════════════════════════════════════════╝', 700)
  );
  const termsRow = _ansiFence(
    ['DXY','Yield Spread','VIX','Liquidity','Hawkish','Front-End Yields']
      .map(t => `<span style="color:#5BC0DE;font-weight:700">${esc(t)}]</span>`).join('  ')
  );
  const fmtSection = (label, colour, items) => {
    if (!Array.isArray(items) || !items.length) return '';
    const body = items.map(it => {
      const head = `   <strong>${esc(it.indicator)}</strong> — ${esc(it.meaning)}`;
      const action = it.action ? `<br>   Action: <span style="color:#23A55A;">${esc(it.action)}</span>` : '';
      return head + action;
    }).join('<br><br>');
    return _ansiFence(_ansi(colour, '▸  ' + label, 700)) + `<br><br>${body}`;
  };
  const pre = fmtSection('Pre-event indicators (now → T-5)', '#FAA61A', wtw.preEvent);
  const during = fmtSection('During the event (T-0 → T+5)', '#ED4245', wtw.during);
  const post = fmtSection('Post-event reassessment (T+5 onwards)', '#23A55A', wtw.postEvent);
  return `
    <div class="message" data-idx="4">
      <div class="message-content">${titleFence}<br><br>${banner}<br><br>${termsRow}<br><br>${pre}<br><br>${during}<br><br>${post}</div>
    </div>`;
}

// ── Event-Day Reference (Msg 5) ─────────────────────────────
function _msgFive(packet) {
  const titleFence = _ansiFence(_ansi('#ED4245', '- 🆕  EVENT-DAY REFERENCE  ·  THE 4 WINDOWS'));
  const banner = _ansiFence(
    _ansi('#5BC0DE', '╔══════════════════════════════════════════════════╗', 700) + '\n' +
    _ansi('#5BC0DE', '║   📚  EVENT-DAY REFERENCE  ·  THE 4 WINDOWS     ║', 700) + '\n' +
    _ansi('#5BC0DE', '╚══════════════════════════════════════════════════╝', 700)
  );
  const ref = packet.eventDayReference;
  const story = (ref && ref.storyBy4Windows) || '—';
  const windows = (ref && ref.windows) || [];
  const useByWindow = windows.map(w => {
    const colour = w.label === 'T-0 chaos' ? '🛑' : '🟢';
    return `${colour} ${esc(w.label)} (${esc(w.range)}): ${esc(w.action)}`;
  }).join('<br>');
  const dollarByWindow = windows.map(w => `<span class="money-line">💲 ${esc(w.label)}: ${esc(w.dollarContext)}.</span>`).join('');
  return `
    <div class="message" data-idx="5">
      <div class="message-content">${titleFence}<br><br>${banner}</div>
    <div class="embed" style="border-left-color:#5bc0de">
      <div class="embed-title">📚  How to read an event-day chart</div>
      <div class="embed-desc">${esc(story)}</div>
      ${_protoChartCard('EURUSD · 5m · event window')}
      <div class="embed-fields">
        <div class="embed-field block">
          <div class="embed-field-name">The story</div>
          <div class="embed-field-value">${esc(story)}</div>
        </div>
        <div class="embed-field block">
          <div class="embed-field-name">How a trader uses this (concrete, dollars-first)</div>
          <div class="embed-field-value">${useByWindow}</div>
        </div>
        <div class="embed-field block">
          <div class="embed-field-name">💲 Dollar context for each window</div>
          <div class="embed-field-value">${dollarByWindow}</div>
        </div>
        <div class="embed-field block">
          <div class="embed-field-name">Rendered ATLAS event cards — next evolution</div>
          <div class="embed-field-value">Future scans will replace the prototype chart with live ATLAS chart snapshots taken during real announcements, with all four windows annotated on the actual price action.</div>
        </div>
      </div>
      <div class="embed-footer">ATLAS · Market Intel · event-day reference</div>
    </div>
    </div>`;
}

// ── Briefing Summary (Msg 6) ────────────────────────────────
function _msgSix(packet) {
  const ba = packet.briefingActions;
  const actions = ba && Array.isArray(ba.actions) && ba.actions.length
    ? ba.actions
    : ['No high-impact catalyst — driver-led session.', 'Honour live DXY / VIX / yield reads above.', 'Continue normal trade-management.', 'Re-read at the next scheduled tick.', 'Watch for unscheduled headline-driven shifts.'];
  const numbered = actions.map((a, i) => {
    const numerals = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
    return `_${esc(numerals[i] || (i + 1) + '.')} ${esc(a)}_`;
  }).join('<br>');
  const highCount = (packet.eventClusters || []).reduce((n, c) => n + (c.events || []).filter(e => e.severity === 'HIGH').length, 0);
  const moodDiscs = (packet.marketMood && packet.marketMood.discs) || '🟠🟠🟠🟠⚫';
  const moodLabel = (packet.marketMood && packet.marketMood.label) || '4/5 — Elevated';
  const leadIn = highCount >= 2
    ? `_${highCount} macro events land within the session window._<br>_Risk state is ${esc(moodDiscs)} ${esc(moodLabel)} for the next 6 hours._`
    : highCount === 1
    ? `_One high-impact catalyst inside the window._<br>_Risk state is ${esc(moodDiscs)} ${esc(moodLabel)}._`
    : `_Driver-led session — no clustered high-impact catalysts._<br>_Risk state is ${esc(moodDiscs)} ${esc(moodLabel)}._`;
  return `
    <div class="message" data-idx="6">
      <div class="message-content">${_ansiFence(_ansi('#FAA61A', '▸  Briefing summary', 700))}<br><br>${leadIn}<br><br>_Concrete action:_<br>${numbered}</div>
    </div>`;
}

function _channelHeader() {
  return `
  <div class="channel-header">
    <span class="hash">#</span>
    <span class="name">market-intel</span>
    <span style="margin-left:auto;color:#72767D">ATLAS Market Intel · v3 prototype reproduction · live render</span>
  </div>`;
}

function renderMarketIntelPrototypeCard(packet) {
  packet = packet || {};
  const ctx = { now: Date.now() };
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${PROTO_CSS}</style></head>
<body>
<div class="channel">
  ${_channelHeader()}
  ${_msgZero(packet, ctx)}
  ${_msgOne(packet)}
  ${_msgTwo(packet)}
  ${_msgThree(packet)}
  ${_msgFour(packet)}
  ${_msgFive(packet)}
  ${_msgSix(packet)}
</div>
</body></html>`;
}

module.exports = { renderMarketIntelPrototypeCard };
