'use strict';

// ============================================================
// renderers/foh/darkHorseV6Adapter.js
//
// PHASE 3 — DATA INJECTION WITHOUT VISUAL DRIFT (operator
// directive 2026-05-17).
//
// Reads the prototype HTML at docs/screenshots/dh-foh-v6.html
// and performs surgical find-and-replace of known strings to
// inject live ranking values from the Dark Horse engine. Every
// other byte preserved byte-identical.
//
// Adapter contract: (prototypeHtml, viewModel) → adaptedHtml
//
// View model carries:
//   { now, marketsScanned, marketMood: {discs,label},
//     standouts: [ { symbol, lifecycle, direction, score,
//                    durationAlive, decisionLevel, invalidation } ] }
// ============================================================

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _fmtBannerTimestamp(ms) {
  const d = new Date(ms || Date.now());
  const day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  const pad = n => (n < 10 ? '0' : '') + n;
  return day + ' ' + d.getUTCDate() + ' ' + month + ' · ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

function adapt(prototypeHtml, vm) {
  if (!prototypeHtml) return '';
  vm = vm || {};
  let html = prototypeHtml;

  // ── Banner timestamp + universe size ─────────────────────
  const stamp = _fmtBannerTimestamp(vm.now);
  const universe = Number.isFinite(vm.marketsScanned) ? vm.marketsScanned : 33;
  const newBanner = stamp + ' · ' + universe + ' markets scanned';
  html = html.replace(/Tuesday 13 May · 12:00 UTC · 33 markets scanned/g, newBanner);

  // ── Standout-count narrative ─────────────────────────────
  const standouts = Array.isArray(vm.standouts) ? vm.standouts : [];
  const total = standouts.length;
  const fresh = standouts.filter(s => /FRESH/.test(s.lifecycle || '')).length;
  const active = standouts.filter(s => /STILL ACTIVE/.test(s.lifecycle || '')).length;
  const fading = standouts.filter(s => /FADING/.test(s.lifecycle || '')).length;
  html = html.replace(/3 standouts found this cycle\./g,
    total === 0 ? 'No standouts on this scan cycle.'
    : total === 1 ? '1 standout found this cycle.'
    : total + ' standouts found this cycle.');
  html = html.replace(/1 fresh \(new this scan\)  ·  1 still active \(1\+ day\)  ·  1 fading\./g,
    fresh + ' fresh (new this scan)  ·  ' + active + ' still active (1+ day)  ·  ' + fading + ' fading.');

  // ── Market mood ──────────────────────────────────────────
  const moodDiscs = (vm.marketMood && vm.marketMood.discs) || '🟠🟠🟠🟠⚫';
  const moodLabel = (vm.marketMood && vm.marketMood.label) || '4/5 — Elevated';
  html = html.replace(/▸  Market Mood  ·  🟠🟠🟠🟠⚫ 4\/5 — Elevated/g, '▸  Market Mood  ·  ' + moodDiscs + ' ' + moodLabel);

  // ── Per-candidate substitutions ──────────────────────────
  // The prototype hardcodes 3 candidate sections with specific
  // symbols. We swap each symbol/lifecycle line for the live
  // standout's values where available. The chart SVG candle
  // pattern is left as the prototype reference (decorative);
  // the price level box LABELS update through separate hooks
  // below in subsequent passes when live OHLC is wired.
  const protoCandidates = [
    { idx: 1, lifecycle: 'FRESH',        symbol: 'EURUSD', titlePattern: /STANDOUT #1 of 3  ·  EURUSD just appeared on this scan/ },
    { idx: 2, lifecycle: 'STILL ACTIVE', symbol: 'XAUUSD', titlePattern: /STANDOUT #2 of 3  ·  XAUUSD \(cycle 2 — trending 1\+ day\)/ },
    { idx: 3, lifecycle: 'FADING',       symbol: 'NVDA',   titlePattern: /STANDOUT #3 of 3  ·  NVDA — older mover, late-stage caution/ },
  ];
  for (let i = 0; i < protoCandidates.length; i++) {
    const proto = protoCandidates[i];
    const live = standouts[i];
    if (!live || !live.symbol) continue;
    const sym = _esc(live.symbol);
    // Replace standout title line with live symbol + lifecycle.
    const lifecycleSuffix = /FRESH/.test(live.lifecycle || '') ? 'just appeared on this scan'
                          : /STILL ACTIVE/.test(live.lifecycle || '') ? '(' + _esc(live.durationAlive || 'still active') + ')'
                          : /FADING|EXHAUST/.test(live.lifecycle || '') ? '— older mover, late-stage caution'
                          : '(see card)';
    html = html.replace(proto.titlePattern, 'STANDOUT #' + (i + 1) + ' of ' + total + '  ·  ' + sym + ' ' + lifecycleSuffix);
    // Embed title — the prototype uses different label phrases
    // per slot ("STRONG BULLISH" for FRESH, "STILL TRENDING" for
    // STILL ACTIVE, "DEVELOPING WATCH" for FADING). Match any
    // existing trailing label and rewrite with a lifecycle-aware
    // live label.
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
