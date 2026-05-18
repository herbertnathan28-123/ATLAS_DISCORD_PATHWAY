'use strict';

// ============================================================
// renderers/foh/darkHorseV6Adapter.js
//
// PHASE 3 — DATA INJECTION WITHOUT VISUAL DRIFT.
//
// Production safety addition:
// When the live packet has zero standouts, prototype/sample
// candidate sections must be removed from the rendered PDF/PNG.
// A no-standout scan must never attach stale EURUSD / XAUUSD /
// NVDA sample cards.
// ============================================================

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

function _fmtBannerTimestamp(ms) {
  const d = new Date(ms || Date.now());
  const day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  const pad = n => (n < 10 ? '0' : '') + n;
  return day + ' ' + d.getUTCDate() + ' ' + month + ' · ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

function _asArray(v) { return Array.isArray(v) ? v : []; }
function _num(...vals) {
  for (const v of vals) if (Number.isFinite(v)) return v;
  return null;
}
function _safeStandouts(vm) {
  if (Array.isArray(vm && vm.standouts)) return vm.standouts;
  if (Array.isArray(vm && vm.candidates)) return vm.candidates;
  return [];
}
function _marketCount(vm) {
  return _num(
    vm && vm.marketsScanned,
    vm && vm.universeSize,
    vm && vm.marketCount,
    vm && vm.scan && vm.scan.marketsScanned,
    vm && vm.header && vm.header.marketsScanned
  ) || 0;
}
function _marketMood(vm) {
  return (vm && vm.marketMood) || (vm && vm.mood) || {};
}
function _replaceBanner(html, newBanner) {
  let out = html;
  out = out.replace(/Tuesday 13 May · 12:00 UTC · 33 markets scanned/g, newBanner);
  out = out.replace(/[A-Z][a-z]+ \d{1,2} [A-Z][a-z]{2} · \d{2}:\d{2} UTC · \d+ markets scanned/g, newBanner);
  return out;
}
function _removeMessageByIdx(html, idx) {
  const re = new RegExp('\\n?\\s*<div class="message"[^>]*data-idx="' + idx + '"[\\s\\S]*?(?=\\n\\s*<div class="message"[^>]*data-idx="\\d+"|\\n\\s*</div>\\s*</body>|\\n\\s*</body>|$)', 'i');
  return html.replace(re, '\n');
}
function _stripPrototypeStandoutMessages(html) {
  let out = html;
  out = _removeMessageByIdx(out, 1);
  out = _removeMessageByIdx(out, 2);
  out = _removeMessageByIdx(out, 3);
  // Last-line guard for any prototype fragments that live outside the
  // expected message wrappers.
  out = out.replace(/FRESH\s*·\s*STANDOUT #1 of 3[\s\S]*?(?=STILL ACTIVE\s*·\s*STANDOUT|FADING\s*·\s*STANDOUT|BUILDING\s*·\s*CHART REFERENCE|<\/body>)/gi, '');
  out = out.replace(/STILL ACTIVE\s*·\s*STANDOUT #2 of 3[\s\S]*?(?=FADING\s*·\s*STANDOUT|BUILDING\s*·\s*CHART REFERENCE|<\/body>)/gi, '');
  out = out.replace(/FADING\s*·\s*STANDOUT #3 of 3[\s\S]*?(?=BUILDING\s*·\s*CHART REFERENCE|<\/body>)/gi, '');
  out = out.replace(/3 standouts today[\s\S]*?Next scan [^<\n]+\./gi, 'No standouts cleared this scan. Re-read at the next 15-minute Dark Horse cycle.');
  return out;
}

function adapt(prototypeHtml, vm) {
  if (!prototypeHtml) return '';
  vm = vm || {};
  let html = prototypeHtml;

  // ── Banner timestamp + universe size ─────────────────────
  const stamp = _fmtBannerTimestamp(vm.now || vm.generatedAt || vm.generatedAtUTC);
  const universe = _marketCount(vm);
  const newBanner = stamp + ' · ' + universe + ' markets scanned';
  html = _replaceBanner(html, newBanner);

  // ── Standout-count narrative ─────────────────────────────
  const standouts = _safeStandouts(vm);
  const total = standouts.length;
  const fresh = standouts.filter(s => /FRESH/.test(String(s.lifecycle || ''))).length;
  const active = standouts.filter(s => /STILL ACTIVE/.test(String(s.lifecycle || ''))).length;
  const fading = standouts.filter(s => /FADING/.test(String(s.lifecycle || ''))).length;
  html = html.replace(/3 standouts found this cycle\./g,
    total === 0 ? 'No standouts on this scan cycle.'
    : total === 1 ? '1 standout found this cycle.'
    : total + ' standouts found this cycle.');
  html = html.replace(/1 fresh \(new this scan\)\s*·\s*1 still active \(1\+ day\)\s*·\s*1 fading\./g,
    fresh + ' fresh (new this scan)  ·  ' + active + ' still active (1+ day)  ·  ' + fading + ' fading.');

  // Critical live-mode gate: zero live standouts means zero
  // candidate cards in the PDF/PNG. The prototype's EURUSD/XAUUSD/NVDA
  // cards are visual reference material only and must not leak into
  // live no-standout dispatches.
  if (total === 0) {
    return _stripPrototypeStandoutMessages(html);
  }

  // ── Market mood ──────────────────────────────────────────
  const mood = _marketMood(vm);
  const moodDiscs = mood.discs || '🟠🟠🟠🟠⚫';
  const moodLabel = mood.label || '4/5 — Elevated';
  html = html.replace(/▸  Market Mood  ·  🟠🟠🟠🟠⚫ 4\/5 — Elevated/g, '▸  Market Mood  ·  ' + moodDiscs + ' ' + moodLabel);

  // ── Per-candidate substitutions ──────────────────────────
  const protoCandidates = [
    { idx: 1, lifecycle: 'FRESH',        symbol: 'EURUSD', titlePattern: /STANDOUT #1 of 3\s*·\s*EURUSD just appeared on this scan/ },
    { idx: 2, lifecycle: 'STILL ACTIVE', symbol: 'XAUUSD', titlePattern: /STANDOUT #2 of 3\s*·\s*XAUUSD \(cycle 2 — trending 1\+ day\)/ },
    { idx: 3, lifecycle: 'FADING',       symbol: 'NVDA',   titlePattern: /STANDOUT #3 of 3\s*·\s*NVDA — older mover, late-stage caution/ },
  ];
  for (let i = 0; i < protoCandidates.length; i++) {
    const proto = protoCandidates[i];
    const live = standouts[i];
    if (!live || !live.symbol) {
      html = _removeMessageByIdx(html, proto.idx);
      continue;
    }
    const sym = _esc(live.symbol);
    const lifecycleSuffix = /FRESH/.test(live.lifecycle || '') ? 'just appeared on this scan'
                          : /STILL ACTIVE/.test(live.lifecycle || '') ? '(' + _esc(live.durationAlive || 'still active') + ')'
                          : /FADING|EXHAUST/.test(live.lifecycle || '') ? '— older mover, late-stage caution'
                          : '(see card)';
    html = html.replace(proto.titlePattern, 'STANDOUT #' + (i + 1) + ' of ' + total + '  ·  ' + sym + ' ' + lifecycleSuffix);
    const lifecycleLabel = /FRESH/.test(live.lifecycle || '')
      ? (String(live.direction || 'Bullish').toUpperCase() === 'BEARISH' ? 'STRONG BEARISH' : 'STRONG BULLISH')
      : /STILL ACTIVE/.test(live.lifecycle || '') ? 'STILL TRENDING'
      : /FADING|EXHAUST/.test(live.lifecycle || '') ? 'DEVELOPING WATCH'
      : 'CONTINUATION WATCH';
    const embedTitleRe = new RegExp('🐎  ' + proto.symbol + '  ·  [A-Z][A-Z A-Z]+', 'g');
    html = html.replace(embedTitleRe, '🐎  ' + sym + '  ·  ' + lifecycleLabel);
  }

  return html;
}

module.exports = { adapt };
