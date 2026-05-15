'use strict';

// ============================================================
// darkHorseFoh.js — Dark Horse Front-of-House (FOH.1.0.1 v6)
//
// Canonical v6 prototype parity restoration. Source of truth:
//   - scripts/render_dh_foh_v6_preview.js::SAMPLE_MESSAGES
//   - docs/screenshots/dh-foh-v6.pdf + dh-foh-v6-gallery.md
//   - docs/foh/restoration/dh-foh-v6-parity-matrix.md (PR #73)
//
// Operator directives applied (B8–B14 + D):
//   B8  — state derivation: decision-not-cleared /
//         decision-cleared-and-held / risk-off-hit. Risk-off is a single
//         invalidation level, never a range. Entry/watch/caution
//         BANDS derived in FOH (B8.a) — no ranking changes.
//   B9  — Conviction "Why X" reasoning sourced only from visible
//         FOH evidence (decision-level proximity, market mood,
//         risk score, lifecycle, chart evidence, invalidation
//         proximity).
//   B10 — Decision-level narrative restored: What This Means / What To
//         Do Now / Dollar Risk / Decision Level /
//         Risk-Off / What Confirms / What Cancels.
//   B11 — Dollar-first risk examples restored as educational /
//         simulation framing. Hybrid contract map: EURUSD,
//         XAUUSD, NVDA seeded; others fall back to educational
//         "1% of $25k account" framing.
//   B12 — Lifecycle + Market Mood: 5-disc bars always /5, with
//         ⚫ inactive disc. FRESH (filled red badge), STILL ACTIVE
//         (outlined red), FADING (outlined orange). No dashed
//         "── NEW ──" text.
//   B13 — Transport: emits Discord-renderable messages with
//         chart-card PNG attachment specs. The engine renders these
//         as Discord `attachment://...png` images before POST. No
//         text-mode or pending chart fallback is standard.
//   B14 — Legacy v1.2/v1.3 surfaces removed from this path. The
//         ATLAS_DH_FOH_LEGACY=1 env-gate at the engine call site
//         remains the rollback lever (engine-side, untouched).
//   D   — Token doctrine: visible bracket hyperlinks via
//         "[[Label]](url)" form (no backslash escapes). Inline
//         colour tokens {{entry:…}} {{watch:…}} {{caution:…}}
//         {{invalid:…}} {{money:…}} stripped to bold Discord
//         markdown before send. No placeholder chart fallback.
//
// Hard boundary preserved:
//   - No scoring / thresholds / scheduler edits.
//   - Minimal darkHorseEngine transport touch is required only to
//     POST Discord multipart attachments; ranking/index untouched.
//   - No ATLAS_ASTRA_RELAY / discord-relay / echarts.min.js
//     touches.
//
// Canonical contract (UNCHANGED — engine call site safe):
//   buildDarkHorseFohPayload(ranking, volatility, opts)
//     → { kind, messages, candidateCount, embedCount,
//         filteredOut, linkRoutingStatus }
// ============================================================

const DISCORD_CONTENT_LIMIT     = 2000;
const DISCORD_EMBED_TOTAL_LIMIT = 6000;
const DISCORD_FIELD_NAME_LIMIT  = 256;
const DISCORD_FIELD_VALUE_LIMIT = 1024;
const DISCORD_EMBED_TITLE_LIMIT = 256;
const DISCORD_EMBED_DESC_LIMIT  = 4096;
const DISCORD_EMBED_FOOTER_LIMIT = 2048;

let _sharp = null;
function _loadSharp() {
  if (_sharp) return _sharp;
  try {
    _sharp = require('sharp');
  } catch (e) {
    throw new Error('Chart card render blocked: sharp dependency is unavailable (' + e.message + ')');
  }
  return _sharp;
}

// ── State badge allow-list (engine-stable) ──────────────────
const STATE_BADGE = Object.freeze({
  STRONG_BULLISH:               'STRONG BULLISH',
  STRONG_BEARISH:               'STRONG BEARISH',
  DEVELOPING_WATCH:             'DEVELOPING WATCH',
  BULLISH_PRESSURE:             'BULLISH PRESSURE',
  BEARISH_PRESSURE:             'BEARISH PRESSURE',
  MARGINAL_REDUCED_CONVICTION:  'MARGINAL · REDUCED CONVICTION',
});
const STATE_BADGE_VALUES = new Set(Object.values(STATE_BADGE));

// ── Per-state embed colour stripe ───────────────────────────
const COLOR = Object.freeze({
  STRONG_BULLISH:   0x2ECC71,
  STRONG_BEARISH:   0xE74C3C,
  BULLISH_PRESSURE: 0x27AE60,
  BEARISH_PRESSURE: 0xC0392B,
  DEVELOPING_WATCH: 0xE67E22,
  MARGINAL:         0x95A5A6,
  CHART_REFERENCE:  0x5BC0DE,
  BUILDING:         0xC9A227,
});

const ALLOWED_MOVE_TYPE = new Set(['Breakout', 'Breakdown', 'Reversal', 'Range Break', 'Continuation']);

// ── Banned-wording guard (legacy trader-shorthand) ──────────
// Maintained: bare "BOS" / "CHoCH" replaced with "[Structure
// Break]" terminology per operator directive. "Learning Links"
// banned in favour of "Expanded Terminology Hyperlinks".
const BANNED_PATTERNS = [
  /\bbody close\b/i,
  /\bbreak and hold\b/i,
  /\bretest holds\b/i,
  /\bread weakens\b/i,
  /\bLearning Links?\b/i,
  /\bBOS\b/,
  /\bCHoCH\b/,
  /\bprints?\b/i,
  /\bTrigger Level\b/i,
  /\btrigger\b/i,
  /\bbroken level\b/i,
  /\bfloor\b/i,
  /\bceiling\b/i,
  /\breclaim(?:ed)?\b/i,
  /\bfighting structure\b/i,
  /\bcleaner setup\b/i,
  /\bbetter setups?\b/i,
  /\bgive the trade more room\b/i,
  /\beither side\b/i,
  /\bMarginal setups?\b/i,
  /\bLate-stage caveat\b/i,
  /\bpath of least resistance\b/i,
  /\bconfirmed directional structure\b/i,
  /\bstructural anchors?\b/i,
  /─── NEW ───/,
];

const GLOSSARY_URL = 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a';

// ── Section ordering (preserved from v1.x) ──────────────────
const SECTION_DISPLAY_ORDER = [
  'fx_majors',
  'fx_crosses',
  'indices',
  'equities',
  'commodities',
  'safe_havens',
  'other',
];
const SECTION_LABEL = {
  fx_majors:   'FX MAJORS',
  fx_crosses:  'FX CROSSES · RISK PAIRS',
  indices:     'GLOBAL INDICES',
  commodities: 'COMMODITIES · INFLATION HEDGE',
  equities:    'MAJOR EQUITIES · MOMENTUM',
  safe_havens: 'SAFE-HAVEN · DEFENSIVE',
  other:       'OTHER',
};

// ── Contract-size map (B11.c — hybrid: seeded + educational) ─
// Doctrine: a Level-1 trader must see dollar risk before they
// see lot sizing. Seeded with prototype trio. All other symbols
// fall back to a labelled "Educational example — 1% of $25,000
// account" framing so the field is never blank but is never
// presented as a live trading recommendation either.
const CONTRACT_INFO = Object.freeze({
  EURUSD: { standardSizeLabel: '1 lot EURUSD',              pointValue: 100000,  pipDescriptor: '1 lot model: price distance × 100,000 notional' },
  XAUUSD: { standardSizeLabel: '1 lot XAUUSD (100 oz)',     pointValue: 100,     pipDescriptor: '1 lot model: dollar distance × 100 oz' },
  NVDA:   { standardSizeLabel: '100 shares NVDA',           pointValue: 100,     pipDescriptor: '100-share model: dollar distance × 100 shares' },
});
function _contractInfo(symbol, record) {
  const seeded = CONTRACT_INFO[symbol];
  if (seeded) return Object.assign({ symbol, seeded: true }, seeded);
  const section = String((record && record.section) || '').toLowerCase();
  const isFx = /^([A-Z]{6})$/.test(symbol || '') || section.indexOf('fx_') === 0;
  const isJpy = /JPY$/.test(symbol || '');
  const isCommodity = section === 'commodities' || /^X[A-Z]{2}USD$/.test(symbol || '');
  const isEquity = section === 'equities';
  const isIndex = section === 'indices';
  return {
    symbol,
    seeded: false,
    standardSizeLabel: isFx ? '1 lot FX model'
      : isCommodity ? '1 contract commodity model'
      : isEquity ? '100-share equity model'
      : isIndex ? '1 index contract model'
      : 'educational example position',
    pointValue: isFx ? (isJpy ? 1000 : 100000)
      : isCommodity ? 100
      : isEquity ? 100
      : isIndex ? 1
      : 1,
    pipDescriptor: 'educational model — exact price distance × model point value',
  };
}

// ── Time / numeric formatters ───────────────────────────────
function _pad2(n) { return (n < 10 ? '0' : '') + n; }
function _fmtUtcStamp(nowMs) {
  const d = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  return d.getUTCFullYear() + '-' + _pad2(d.getUTCMonth() + 1) + '-' + _pad2(d.getUTCDate())
    + ' ' + _pad2(d.getUTCHours()) + ':' + _pad2(d.getUTCMinutes()) + ' UTC';
}
function _fmtAwstStamp(nowMs) {
  const d = new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + 8 * 3600 * 1000);
  return _pad2(d.getUTCHours()) + ':' + _pad2(d.getUTCMinutes()) + ' AWST';
}
function _fmtNextReviewUTC(nowMs, intervalMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const interval = Number.isFinite(intervalMs) ? intervalMs : 15 * 60 * 1000;
  return _fmtUtcStamp(now + interval);
}
function _fmtPrice(v) {
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) >= 1000) return v.toFixed(2);
  if (Math.abs(v) >= 10)   return v.toFixed(2);
  if (Math.abs(v) >= 1)    return v.toFixed(4);
  return v.toFixed(5);
}
function _roundToTick(v, tick) {
  if (!Number.isFinite(v) || !Number.isFinite(tick) || tick <= 0) return v;
  return Math.round(v / tick) * tick;
}
function _fmtPriceForProfile(v, profile) {
  if (!Number.isFinite(v)) return null;
  if (profile && Number.isFinite(profile.decimals)) return v.toFixed(profile.decimals);
  return _fmtPrice(v);
}
function _xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function _ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Rendered chart-card image lane (B13) ─────────────────────
// These cards are not live TradingView screenshots; they are
// Discord-rendered ATLAS reference cards built from the same
// candidate evidence anchors used by the text fields. That keeps
// the live path image-first without inventing extra scoring data.
function _mkCandle(o, c, span) {
  const wick = Math.max(span * 0.08, Math.abs(c - o) * 0.25);
  return {
    o,
    c,
    h: Math.max(o, c) + wick,
    l: Math.min(o, c) - wick,
  };
}
function _chartAnnotation(label, price, candleIndex, tone, anchor) {
  return {
    label,
    price,
    candleIndex,
    tone: tone || 'info',
    anchor: anchor || 'left',
  };
}
function _candidateChartAnnotations(record, bands, candles, currentPrice) {
  const phase = String((record && record.movePhase) || '').toLowerCase();
  const isShort = !!(bands && bands.isShort);
  const sideTone = isShort ? 'danger' : 'entry';
  const defended = isShort ? 'SELLERS DEFENDING' : 'BUYERS DEFENDING';
  const breakLabel = isShort ? 'BREAK BELOW' : 'BREAK ABOVE';
  const structureLabel = isShort ? 'LOWER HIGH' : 'HIGHER LOW';
  const retestLabel = (phase === 'late' || phase === 'exhaustion')
    ? structureLabel
    : (isShort ? 'FAILED RECOVERY' : 'RETEST HELD');
  return [
    _chartAnnotation('DECISION LEVEL', bands.trigger, 2, 'decision', 'right'),
    _chartAnnotation(breakLabel, bands.trigger, 1, sideTone, 'left'),
    _chartAnnotation(retestLabel, candles[3] ? candles[3].c : bands.trigger, 3, 'watch', 'left'),
    _chartAnnotation(defended, candles[3] ? candles[3].h : bands.trigger, 3, sideTone, 'right'),
    _chartAnnotation('ENTRY ZONE', (bands.entryHigh + bands.entryLow) / 2, 2, 'entry', 'left'),
    _chartAnnotation('WATCH LEVEL', bands.watch, 1, 'watch', 'right'),
    _chartAnnotation('INVALIDATION', bands.invalidation, 1, 'danger', 'right'),
    _chartAnnotation(isShort ? 'SHORT IDEA' : 'LONG IDEA', currentPrice, 4, sideTone, 'right'),
  ];
}
function _candidateChartCardSpec(record, bands) {
  if (!record || !bands) return null;
  const sym = String(record.symbol || 'SYMBOL').toUpperCase();
  const dist = Math.abs(bands.trigger - bands.invalidation);
  const pxBase = Math.max(Math.abs(bands.trigger || 0) * 0.0025, 0.0005);
  const span = Math.max(dist || 0, Math.abs(bands.entryHigh - bands.entryLow) * 5, pxBase);
  let candles;
  let currentPrice;
  if (bands.isShort) {
    const p0 = bands.invalidation - span * 0.05;
    const p1 = bands.trigger + span * 0.25;
    const p2 = bands.trigger - span * 0.25;
    const p3 = bands.trigger + span * 0.05;
    currentPrice = bands.trigger - span * 0.15;
    candles = [
      _mkCandle(p0, p1, span),
      _mkCandle(p1, p2, span),
      _mkCandle(p2, p3, span),
      _mkCandle(p3, currentPrice, span),
      _mkCandle(currentPrice + span * 0.06, currentPrice - span * 0.10, span),
    ];
  } else {
    const p0 = bands.invalidation + span * 0.05;
    const p1 = bands.watch;
    const p2 = bands.trigger + span * 0.15;
    const p3 = bands.trigger + span * 0.45;
    currentPrice = bands.trigger + span * 0.10;
    candles = [
      _mkCandle(p0, p1, span),
      _mkCandle(p1, p2, span),
      _mkCandle(p2, p3, span),
      _mkCandle(p3, currentPrice, span),
      _mkCandle(currentPrice - span * 0.05, currentPrice + span * 0.08, span),
    ];
  }
  const prices = candles.reduce((arr, c) => arr.concat([c.o, c.h, c.l, c.c]), [
    bands.entryHigh,
    bands.entryLow,
    bands.watch,
    bands.invalidation,
    currentPrice,
  ]);
  return {
    symbol: sym + ' · 1H',
    direction: bands.isShort ? 'Bearish' : 'Bullish',
    decisionLevel: bands.trigger,
    currentPrice,
    highPrice: Math.max.apply(null, prices),
    lowPrice: Math.min.apply(null, prices),
    entryHigh: bands.entryHigh,
    entryLow: bands.entryLow,
    watch: bands.watch,
    invalidation: bands.invalidation,
    candles,
    annotations: _candidateChartAnnotations(record, bands, candles, currentPrice),
    caption: 'ATLAS chart card · ' + sym + ' · entry '
      + bands.entryLowText + '–' + bands.entryHighText
      + ' · watch ' + bands.watchText
      + ' · invalidation ' + bands.invalidationText,
  };
}
function _referenceChartCardSpec() {
  return {
    symbol: 'REFERENCE · pattern',
    currentPrice: 100,
    highPrice: 110,
    lowPrice: 88,
    entryHigh: 100,
    entryLow: 96,
    watch: 92,
    invalidation: 88,
    decisionLevel: 96,
    direction: 'Bullish',
    caption: 'ATLAS chart card · clean example · break, retest, confirmation, four-zone read',
    candles: [
      { o: 90, h: 94, l: 88, c: 91 },
      { o: 91, h: 96, l: 90, c: 92 },
      { o: 92, h: 100, l: 91, c: 99 },
      { o: 99, h: 105, l: 95, c: 96 },
      { o: 96, h: 108, l: 96, c: 107 },
    ],
    annotations: [
      _chartAnnotation('DECISION LEVEL', 96, 1, 'decision', 'right'),
      _chartAnnotation('BREAK ABOVE', 100, 2, 'entry', 'left'),
      _chartAnnotation('RETEST HELD', 96, 3, 'watch', 'left'),
      _chartAnnotation('CONFIRMED CLOSE', 107, 4, 'entry', 'right'),
      _chartAnnotation('BUYERS DEFENDING', 96, 3, 'entry', 'right'),
      _chartAnnotation('ENTRY ZONE', 98, 2, 'entry', 'left'),
      _chartAnnotation('WATCH LEVEL', 92, 1, 'watch', 'right'),
      _chartAnnotation('INVALIDATION', 88, 0, 'danger', 'right'),
      _chartAnnotation('LONG IDEA', 107, 4, 'info', 'right'),
    ],
  };
}
function _renderChartCardSvg(spec) {
  const W = 720, H = 330;
  const PADL = 22, PADR = 124, PADT = 34, PADB = 54;
  const innerW = W - PADL - PADR, innerH = H - PADT - PADB;
  const candles = Array.isArray(spec && spec.candles) ? spec.candles : [];
  const allPrices = [];
  for (const c of candles) {
    for (const k of ['o', 'h', 'l', 'c']) if (Number.isFinite(c[k])) allPrices.push(c[k]);
  }
  for (const v of [spec.entryHigh, spec.entryLow, spec.watch, spec.invalidation, spec.currentPrice, spec.highPrice, spec.lowPrice]) {
    if (Number.isFinite(v)) allPrices.push(v);
  }
  if (allPrices.length === 0) {
    throw new Error('Chart card render blocked: no price levels available for ' + (spec && spec.symbol || 'unknown'));
  }
  const maxP = Math.max.apply(null, allPrices);
  const minP = Math.min.apply(null, allPrices);
  const rng = maxP === minP ? 1 : (maxP - minP) * 1.12;
  const midP = (maxP + minP) / 2;
  const minScale = midP - rng / 2;
  const maxScale = midP + rng / 2;
  function yFor(p) {
    return PADT + innerH - ((p - minScale) / (maxScale - minScale)) * innerH;
  }
  function xFor(i) {
    const cw = innerW / Math.max(1, candles.length);
    return PADL + cw * (i + 0.5);
  }
  function fmt(p) {
    if (!Number.isFinite(p)) return '';
    return Math.abs(p) >= 1000 ? p.toFixed(2) : Math.abs(p) >= 10 ? p.toFixed(2) : p.toFixed(4);
  }
  const toneColour = {
    entry: '#23A55A',
    watch: '#F1C40F',
    caution: '#E67E22',
    danger: '#ED4245',
    decision: '#5BC0DE',
    info: '#00B0FF',
  };
  function zoneBand(p1, p2, colour, opacity) {
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) return '';
    const y1 = yFor(Math.max(p1, p2));
    const y2 = yFor(Math.min(p1, p2));
    return '<rect x="' + PADL + '" y="' + y1 + '" width="' + innerW + '" height="' + (y2 - y1) + '" fill="' + colour + '" opacity="' + opacity + '"/>';
  }
  let zones = zoneBand(spec.entryHigh, spec.entryLow, '#23A55A', '0.18');
  if (Number.isFinite(spec.decisionLevel)) {
    const y = yFor(spec.decisionLevel);
    zones += '<line x1="' + PADL + '" y1="' + y + '" x2="' + (PADL + innerW) + '" y2="' + y + '" stroke="#5BC0DE" stroke-width="2" stroke-dasharray="10 5"/>';
    zones += '<text x="' + (PADL + innerW - 150) + '" y="' + (y - 7) + '" fill="#5BC0DE" font-family="Consolas, monospace" font-size="14" font-weight="700">DECISION LEVEL</text>';
  }
  if (Number.isFinite(spec.entryHigh) && Number.isFinite(spec.entryLow)) {
    const y = yFor((spec.entryHigh + spec.entryLow) / 2);
    zones += '<text x="' + (PADL + 8) + '" y="' + (y + 5) + '" fill="#23A55A" font-family="Consolas, monospace" font-size="14" font-weight="700">ENTRY ZONE</text>';
  }
  if (Number.isFinite(spec.watch)) {
    const y = yFor(spec.watch);
    zones += '<line x1="' + PADL + '" y1="' + y + '" x2="' + (PADL + innerW) + '" y2="' + y + '" stroke="#F1C40F" stroke-width="2" stroke-dasharray="7 6"/>';
    zones += '<text x="' + (PADL + 8) + '" y="' + (y - 6) + '" fill="#F1C40F" font-family="Consolas, monospace" font-size="14" font-weight="700">WATCH LEVEL</text>';
  }
  if (Number.isFinite(spec.invalidation)) {
    const y = yFor(spec.invalidation);
    zones += '<line x1="' + PADL + '" y1="' + y + '" x2="' + (PADL + innerW) + '" y2="' + y + '" stroke="#ED4245" stroke-width="2.5" stroke-dasharray="9 6"/>';
    zones += '<text x="' + (PADL + 8) + '" y="' + (y + 18) + '" fill="#ED4245" font-family="Consolas, monospace" font-size="14" font-weight="700">INVALIDATION</text>';
  }
  const candleW = Math.max(8, Math.floor((innerW / Math.max(1, candles.length)) * 0.56));
  let candlesSvg = '';
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const cx = xFor(i);
    const oY = yFor(c.o), cY = yFor(c.c), hY = yFor(c.h), lY = yFor(c.l);
    const up = c.c >= c.o;
    const fill = up ? '#00ff00' : '#ff0015';
    const bodyTop = Math.min(oY, cY);
    const bodyH = Math.max(2, Math.abs(oY - cY));
    candlesSvg += '<line x1="' + cx + '" y1="' + hY + '" x2="' + cx + '" y2="' + lY + '" stroke="' + fill + '" stroke-width="2"/>';
    candlesSvg += '<rect x="' + (cx - candleW / 2) + '" y="' + bodyTop + '" width="' + candleW + '" height="' + bodyH + '" fill="' + fill + '"/>';
  }
  function annotationSvg(a, idx) {
    if (!a || !Number.isFinite(a.price)) return '';
    const colour = toneColour[a.tone] || toneColour.info;
    const candleIdx = Number.isFinite(a.candleIndex) ? Math.max(0, Math.min(candles.length - 1, a.candleIndex)) : Math.floor(candles.length / 2);
    const pointX = xFor(candleIdx);
    const pointY = yFor(a.price);
    const right = a.anchor === 'right';
    const boxW = Math.min(150, Math.max(78, String(a.label || '').length * 8 + 16));
    let boxX = right ? pointX + 18 : pointX - boxW - 18;
    boxX = Math.max(PADL, Math.min(PADL + innerW - boxW, boxX));
    let boxY = pointY - 55 + (idx % 3) * 20;
    boxY = Math.max(PADT + 4, Math.min(PADT + innerH - 24, boxY));
    return '<line x1="' + pointX + '" y1="' + pointY + '" x2="' + (right ? boxX : boxX + boxW) + '" y2="' + (boxY + 10) + '" stroke="' + colour + '" stroke-width="1.5" opacity="0.95"/>'
      + '<circle cx="' + pointX + '" cy="' + pointY + '" r="4" fill="' + colour + '" stroke="#131722" stroke-width="1.5"/>'
      + '<rect x="' + boxX + '" y="' + boxY + '" width="' + boxW + '" height="22" rx="4" fill="#1F2430" stroke="' + colour + '" stroke-width="1.5"/>'
      + '<text x="' + (boxX + 7) + '" y="' + (boxY + 15) + '" fill="' + colour + '" font-family="Consolas, monospace" font-size="12" font-weight="700">' + _xmlEscape(a.label || '') + '</text>';
  }
  const annotations = (Array.isArray(spec.annotations) ? spec.annotations : [])
    .slice(0, 9)
    .map(annotationSvg)
    .join('');
  function priceLabel(p, bg, fg, label) {
    if (!Number.isFinite(p)) return '';
    const y = yFor(p);
    const x = W - PADR + 8;
    return '<rect x="' + x + '" y="' + (y - 13) + '" width="' + (PADR - 16) + '" height="26" rx="4" fill="' + bg + '"/>'
      + '<text x="' + (x + 7) + '" y="' + (y + 5) + '" fill="' + fg + '" font-family="Consolas, monospace" font-size="13" font-weight="700">' + _xmlEscape(label + ' ' + fmt(p)) + '</text>';
  }
  const labels =
    priceLabel(spec.highPrice, '#FFD600', '#000000', 'HIGH') +
    priceLabel(spec.currentPrice, '#00FF5A', '#000000', 'CURRENT') +
    priceLabel((spec.entryHigh + spec.entryLow) / 2, '#FF9100', '#000000', 'ENTRY') +
    priceLabel(spec.lowPrice, '#00B0FF', '#FFFFFF', 'LOW');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'
    + '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#131722"/>'
    + '<rect x="12" y="12" width="' + (W - 24) + '" height="' + (H - 24) + '" rx="8" fill="#131722" stroke="#2B313C" stroke-width="2"/>'
    + '<text x="' + PADL + '" y="25" fill="#DCDDDE" font-family="Arial, sans-serif" font-size="16" font-weight="700">' + _xmlEscape(spec.symbol || 'ATLAS chart card') + '</text>'
    + zones + candlesSvg + annotations + labels
    + '<text x="' + PADL + '" y="' + (H - 20) + '" fill="#72767D" font-family="Consolas, monospace" font-size="13">' + _xmlEscape(spec.caption || 'ATLAS chart card') + '</text>'
    + '</svg>';
}
function _chartFileName(spec, idx) {
  const base = String((spec && spec.symbol) || 'chart')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'chart';
  return 'dh-foh-' + String(idx).padStart(2, '0') + '-' + base + '.png';
}
async function renderChartCardAttachments(messages) {
  const out = [];
  let chartCount = 0;
  for (const m of (messages || [])) {
    const nm = Object.assign({}, m);
    const files = Array.isArray(m.files) ? m.files.slice() : [];
    if (Array.isArray(m.embeds)) {
      nm.embeds = [];
      for (const e of m.embeds) {
        const ne = Object.assign({}, e);
        if (e && e.chartCard) {
          chartCount += 1;
          const fileName = _chartFileName(e.chartCard, chartCount);
          const svg = _renderChartCardSvg(e.chartCard);
          const data = await _loadSharp()(Buffer.from(svg, 'utf8')).png().toBuffer();
          files.push({ name: fileName, contentType: 'image/png', data });
          ne.image = { url: 'attachment://' + fileName };
        }
        delete ne.chartCard;
        nm.embeds.push(ne);
      }
    }
    if (files.length > 0) nm.files = files;
    out.push(nm);
  }
  return { messages: out, chartCardCount: chartCount, fileCount: out.reduce((n, m) => n + ((m.files || []).length), 0) };
}

// ── ANSI / box-drawing constants (Discord ```ansi fence) ────
const ESC = '';
const ANSI_RESET  = ESC + '[0m';
const ANSI_GOLD   = ESC + '[33;1m';
const ANSI_BRIGHT_YELLOW = ESC + '[93;1m';
const ANSI_BRIGHT_CYAN   = ESC + '[96;1m';
const ANSI_GREEN  = ESC + '[32;1m';
const ANSI_YELLOW = ESC + '[93;1m';
const ANSI_RED    = ESC + '[31;1m';
const ANSI_CYAN   = ESC + '[36;1m';
const ANSI_MAGENTA = ESC + '[35;1m';
const ANSI_GREY   = ESC + '[30;1m';

const BAR_HEAVY   = '━'.repeat(50);
const BAR_LIGHT   = '─'.repeat(50);
const BAR_DOTTED  = '· '.repeat(25).trimEnd();

// ── Terminology table (visible-bracket hyperlinks) ──────────
const TERMINOLOGY = Object.freeze({
  'Breakout':                          'term-breakout',
  'Pullback':                          'term-pullback',
  'Continuation':                      'term-continuation',
  'Reversal':                          'term-reversal',
  'Support / Resistance':              'term-support-resistance',
  'Invalidation':                      'term-invalidation',
  'Expected Duration':                 'term-expected-duration',
  'Market Mood':                       'term-market-mood',
  'Mover Stage':                       'term-mover-stage',
  'Decision Level':                    'term-decision-level',
  'Cycle Rank':                        'term-cycle-rank',
  'Long ▲':                            'term-long',
  'Short ▼':                           'term-short',
  'Risk-Off':                          'term-risk-off',
  'Initial-direction reversal':        'term-initial-direction-reversal',
  'Confirmed Candle Close':            'term-confirmed-candle-close',
  'Entry Zone':                        'term-entry-zone',
  'Watch Level':                       'term-watch-level',
  'Caution Zone':                      'term-caution-zone',
  'Conviction':                        'term-conviction',
  'Position Size':                     'term-position-size',
  'Dollar Risk':                       'term-dollar-risk',
  'Reward-to-Risk':                    'term-reward-to-risk',
  'Fading Setup':                      'term-fading-setup',
  'Fresh Setup':                       'term-fresh-setup',
  'Still Active Setup':                'term-still-active-setup',
  'Retest':                            'term-retest',
  'Lower High':                        'term-lower-high',
  'Higher Low':                        'term-higher-low',
  'Risk Reduction':                    'term-risk-reduction',
  'Late-Stage Move':                   'term-late-stage-move',
  'Re-entry Structure':                'term-re-entry-structure',
});

function _routeTerminology(opts) {
  const urls = (opts && opts.terminologyUrls) || null;
  const map = { __default__: GLOSSARY_URL };
  if (urls && typeof urls === 'object') {
    for (const k of Object.keys(urls)) {
      const v = urls[k];
      if (typeof v === 'string' && /^https?:\/\//.test(v)) map[k] = v;
    }
  }
  return { status: urls ? 'partial' : 'fallback', urlMap: map };
}

// Visible-bracket hyperlink: `[[Label]](url)` — Discord renders as
// "[Label]" styled in link colour. No backslash escapes.
function _termLink(label, urlMap) {
  const slug = TERMINOLOGY[label] || null;
  const url = (urlMap && slug && urlMap[slug]) || (urlMap && urlMap.__default__) || GLOSSARY_URL;
  return '[[' + label + ']](' + url + ')';
}

// Visible-bracket non-link chip (inside ```ansi fences only).
function _termChip(label) { return '[' + label + ']'; }

// ── 5-disc severity scale (operator B12 doctrine) ───────────
// Format: `🟢🟢🟢🟢⚫ 4/5 — High`. Inactive disc always ⚫.
// Same-family active discs (never rainbow).
function discScale(active, total, label, glyph) {
  total = Number.isFinite(total) ? total : 5;
  active = Math.max(0, Math.min(total, Number.isFinite(active) ? active : 0));
  const filled = glyph || '🟢';
  const dot = '⚫';
  const discs = filled.repeat(active) + dot.repeat(total - active);
  const tail = label ? ' — ' + label : '';
  return discs + ' ' + active + '/' + total + tail;
}

function _scoreToActive(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 1;
  if (s >= 9) return 5;
  if (s >= 7) return 4;
  if (s >= 5) return 3;
  if (s >= 3) return 2;
  return 1;
}
function _activeToLabel(active) {
  return ['Low', 'Low', 'Medium', 'High', 'Very High'][active - 1] || 'Low';
}

// ── State badge classifier ──────────────────────────────────
function classifyStateBadge(record) {
  const score = Number(record && record.score);
  const dir   = String((record && record.direction) || '').toLowerCase();
  const phase = String((record && record.movePhase) || '').toLowerCase();
  const isBull = dir === 'bullish';
  if (phase === 'late' || phase === 'exhaustion') {
    if (!Number.isFinite(score) || score < 6) return STATE_BADGE.MARGINAL_REDUCED_CONVICTION;
    return STATE_BADGE.DEVELOPING_WATCH;
  }
  if (!Number.isFinite(score) || score < 5) return STATE_BADGE.MARGINAL_REDUCED_CONVICTION;
  if (score >= 9) return isBull ? STATE_BADGE.STRONG_BULLISH   : STATE_BADGE.STRONG_BEARISH;
  if (score >= 6) return isBull ? STATE_BADGE.BULLISH_PRESSURE : STATE_BADGE.BEARISH_PRESSURE;
  return STATE_BADGE.MARGINAL_REDUCED_CONVICTION;
}

function _badgeGlyph(stateBadge) {
  switch (stateBadge) {
    case STATE_BADGE.STRONG_BULLISH:
    case STATE_BADGE.BULLISH_PRESSURE:
      return '🟢';
    case STATE_BADGE.STRONG_BEARISH:
    case STATE_BADGE.BEARISH_PRESSURE:
      return '🔴';
    case STATE_BADGE.DEVELOPING_WATCH:
      return '🟠';
    case STATE_BADGE.MARGINAL_REDUCED_CONVICTION:
      return '⚪';
    default:
      return '🟡';
  }
}

function _badgeToColor(stateBadge) {
  switch (stateBadge) {
    case STATE_BADGE.STRONG_BULLISH:               return COLOR.STRONG_BULLISH;
    case STATE_BADGE.STRONG_BEARISH:               return COLOR.STRONG_BEARISH;
    case STATE_BADGE.BULLISH_PRESSURE:             return COLOR.BULLISH_PRESSURE;
    case STATE_BADGE.BEARISH_PRESSURE:             return COLOR.BEARISH_PRESSURE;
    case STATE_BADGE.DEVELOPING_WATCH:             return COLOR.DEVELOPING_WATCH;
    case STATE_BADGE.MARGINAL_REDUCED_CONVICTION:  return COLOR.MARGINAL;
    default:                                       return COLOR.MARGINAL;
  }
}

// ── Lifecycle (B12) — FRESH / STILL ACTIVE / FADING ─────────
function lifecycleStage(record) {
  const phase = String((record && record.movePhase) || '').toLowerCase();
  if (phase === 'early') {
    return {
      stage:    'FRESH',
      tone:     'fresh',
      narrative:'just appeared on this scan',
      sizeNote: 'half size for fresh candidate',
    };
  }
  if (phase === 'late' || phase === 'exhaustion') {
    return {
      stage:    'FADING',
      tone:     'fading',
      narrative:'older mover, late-stage caution',
      sizeNote: 'quarter size only — late-stage',
    };
  }
  return {
    stage:    'STILL ACTIVE',
    tone:     'active',
    narrative:'trending across multiple cycles',
    sizeNote: 'full size allowed after repeated level defence',
  };
}

function moveType(record) {
  const phase = String((record && record.movePhase) || '').toLowerCase();
  const struct = String((record && record.structureState) || '').toLowerCase();
  const dir = String((record && record.direction) || '').toLowerCase();
  if (phase === 'early') return dir === 'bearish' ? 'Breakdown' : 'Breakout';
  if (phase === 'late' || phase === 'exhaustion') return 'Continuation';
  if (/range|consolidat/.test(struct)) return 'Range Break';
  if (/reversal|reverse|change/.test(struct)) return 'Reversal';
  return 'Continuation';
}
function moverStage(record) {
  const phase = String((record && record.movePhase) || '').toLowerCase();
  if (phase === 'early') return 'early';
  if (phase === 'late' || phase === 'exhaustion') return 'late';
  return 'mid';
}

function _precisionProfile(record, volatility, trigger) {
  const symbol = String((record && record.symbol) || '').toUpperCase();
  const section = String((record && record.section) || '').toLowerCase();
  const lvl = String((volatility && volatility.level) || '').toLowerCase();
  const volMult = lvl === 'extreme' ? 1.5 : lvl === 'elevated' ? 1.25 : lvl === 'quiet' ? 0.75 : 1;
  const isFx = /^([A-Z]{6})$/.test(symbol) || section.indexOf('fx_') === 0;
  const isJpy = /JPY$/.test(symbol);
  const isMetal = /^XAU|^XAG/.test(symbol) || section === 'commodities';
  const isEquity = section === 'equities';
  const isIndex = section === 'indices';
  let tick = 0.01, decimals = 2, baseBuffer = 0.05, label = 'general 5-cent model buffer';
  if (isFx && isJpy) {
    tick = 0.01; decimals = 2; baseBuffer = 0.02; label = 'JPY FX: 2-pip minimum structural buffer';
  } else if (isFx) {
    tick = 0.0001; decimals = 4; baseBuffer = 0.0002; label = 'FX: 2-pip minimum structural buffer';
  } else if (/^XAU/.test(symbol)) {
    tick = 0.10; decimals = 2; baseBuffer = 1.00; label = 'Gold: $1 minimum structural buffer';
  } else if (/^XAG/.test(symbol)) {
    tick = 0.01; decimals = 2; baseBuffer = 0.03; label = 'Silver: 3-cent minimum structural buffer';
  } else if (isIndex) {
    tick = 0.25; decimals = 2; baseBuffer = Math.max(1.00, Math.abs(trigger || 0) * 0.0004); label = 'Index: tick-aware 0.04% structural buffer';
  } else if (isEquity) {
    tick = 0.01; decimals = 2; baseBuffer = Math.max(0.05, Math.abs(trigger || 0) * 0.0005); label = 'Equity: tick-aware 0.05% structural buffer';
  } else if (isMetal) {
    tick = 0.10; decimals = 2; baseBuffer = Math.max(0.50, Math.abs(trigger || 0) * 0.0005); label = 'Commodity: tick-aware 0.05% structural buffer';
  }
  const entryBuffer = Math.max(tick, _roundToTick(baseBuffer * volMult, tick));
  const invalidationBuffer = Math.max(tick, _roundToTick(baseBuffer * volMult, tick));
  const cautionBuffer = Math.max(tick, _roundToTick(baseBuffer * volMult, tick));
  return {
    tick,
    decimals,
    entryBuffer,
    invalidationBuffer,
    cautionBuffer,
    bufferText: _fmtPriceForProfile(entryBuffer, { decimals }),
    why: label + (volMult !== 1 ? ' × ' + lvl + ' volatility multiplier' : ''),
  };
}

// ── B8.a — band derivation (entry / watch / caution) ────────
// Inputs: record.evidenceAnchors (recentHigh / recentLow /
// invalidation), record.direction, volatility.level. The bands
// scale with conviction: tighter for higher conviction.
function _deriveBands(record, volatility) {
  const ev = (record && record.evidenceAnchors) || {};
  const dir = String((record && record.direction) || '').toLowerCase();
  const isShort = dir === 'bearish';
  const hi = ev.recentHigh && Number.isFinite(ev.recentHigh.price) ? ev.recentHigh.price : null;
  const lo = ev.recentLow  && Number.isFinite(ev.recentLow.price)  ? ev.recentLow.price  : null;
  const inv = ev.invalidation && Number.isFinite(ev.invalidation.price) ? ev.invalidation.price : null;
  if (hi == null || lo == null || inv == null) return null;
  const span = Math.abs(hi - lo);
  if (!Number.isFinite(span) || span <= 0) return null;

  // Decision anchor: the price level the card is built around.
  // For longs, the prior high; for shorts, the prior low.
  const rawTrigger = isShort ? lo : hi;
  const profile = _precisionProfile(record, volatility, rawTrigger);
  const trigger = _roundToTick(rawTrigger, profile.tick);

  // Minimum practical buffer around the true decision level.
  const entryLow  = _roundToTick(trigger - profile.entryBuffer, profile.tick);
  const entryHigh = _roundToTick(trigger + profile.entryBuffer, profile.tick);

  // Invalidation is the actual failure point plus the minimum
  // asset-appropriate buffer, never a wide convenience distance.
  const rawInvalidation = isShort
    ? inv + profile.invalidationBuffer
    : inv - profile.invalidationBuffer;
  const invalidation = _roundToTick(rawInvalidation, profile.tick);

  // Watch level — between entry and invalidation, 30% of the way
  // toward invalidation. The first warning that direction is
  // weakening.
  const distToInv = Math.abs(trigger - invalidation);
  const watch = isShort
    ? _roundToTick(trigger + (distToInv * 0.30), profile.tick)
    : _roundToTick(trigger - (distToInv * 0.30), profile.tick);

  // Caution band — the band between watch and invalidation. The
  // upper bound for longs is the watch level; for shorts mirror.
  // Caution INNER edge is watch, OUTER edge is the invalidation
  // less the band width.
  const cautionEdge = isShort
    ? _roundToTick(invalidation - profile.cautionBuffer, profile.tick)
    : _roundToTick(invalidation + profile.cautionBuffer, profile.tick);

  return {
    trigger,
    triggerText: _fmtPriceForProfile(trigger, profile),
    entryLow,    entryLowText:  _fmtPriceForProfile(entryLow, profile),
    entryHigh,   entryHighText: _fmtPriceForProfile(entryHigh, profile),
    watch,       watchText:     _fmtPriceForProfile(watch, profile),
    caution:     cautionEdge,
    cautionText: _fmtPriceForProfile(cautionEdge, profile),
    invalidation,
    invalidationText: _fmtPriceForProfile(invalidation, profile),
    structureFailure: inv,
    structureFailureText: _fmtPriceForProfile(inv, profile),
    bandWidthText: _fmtPriceForProfile(profile.entryBuffer * 2, profile),
    bufferUsedText: profile.bufferText,
    bufferWhy: profile.why,
    precision: profile,
    isShort,
  };
}

// ── B12 — position sizing rule (lifecycle × Market Mood) ────
function _modelRiskFromBands(contract, bands) {
  if (!contract || !bands || !Number.isFinite(contract.pointValue)) return null;
  const entryMid = (bands.entryLow + bands.entryHigh) / 2;
  const distance = Math.abs(entryMid - bands.invalidation);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  return {
    standardDollarRisk: Math.max(1, Math.round(distance * contract.pointValue)),
    distance,
    distanceText: _fmtPriceForProfile(distance, bands.precision),
  };
}

function _positionRule(lifecycle, volatility, contract, bands) {
  const mood = String((volatility && volatility.level) || '').toLowerCase();
  // Lifecycle base multiplier
  let base = 1.0;
  let lifecycleNote = 'full size';
  if (lifecycle.stage === 'FRESH') {
    base = 0.5;
    lifecycleNote = 'half size for FRESH';
  } else if (lifecycle.stage === 'FADING') {
    base = 0.25;
    lifecycleNote = 'quarter size for FADING';
  }
  // Market-mood reduction (B12 doctrine)
  let moodMult = 1.0;
  let moodNote = 'normal mood';
  if (mood === 'elevated') { moodMult = 0.70; moodNote = 'Market Mood Elevated reduction'; }
  else if (mood === 'extreme') { moodMult = 0.50; moodNote = 'Market Mood Extreme reduction'; }
  else if (mood === 'quiet') { moodMult = 1.0; moodNote = 'Market Mood Quiet — full size'; }
  // Final multiplier (apply mood only when lifecycle is STILL
  // ACTIVE; FRESH and FADING already enforce reduced size).
  const finalMult = lifecycle.stage === 'STILL ACTIVE' ? (base * moodMult) : base;
  const modelRisk = _modelRiskFromBands(contract, bands);
  const standardDollarRisk = modelRisk ? modelRisk.standardDollarRisk : 250;
  const dollarRisk = Math.max(1, Math.round(standardDollarRisk * finalMult));
  const lotMult = finalMult.toFixed(2).replace(/\.?0+$/, '');
  return {
    multiplier:   finalMult,
    multiplierText: lotMult,
    lifecycleNote,
    moodNote,
    standardDollarRisk,
    standardDollarRiskText: '$' + standardDollarRisk.toLocaleString('en-US'),
    dollarRisk,
    dollarRiskText: '$' + dollarRisk.toLocaleString('en-US'),
    riskDistanceText: modelRisk ? modelRisk.distanceText : 'n/a',
  };
}

function _rewardRForLifecycle(lifecycle) {
  if (lifecycle && lifecycle.stage === 'FADING') return 1.3;
  if (lifecycle && lifecycle.stage === 'FRESH') return 5.7;
  return 3.0;
}

function _executionAuthorityState(lifecycle, bands) {
  if (!bands) return 'WAIT FOR CONFIRMATION';
  if (lifecycle.stage === 'FADING') return 'REDUCED SIZE ONLY / NOT PRIMARY';
  if (lifecycle.stage === 'FRESH') return 'WAIT FOR CONFIRMATION';
  return 'EXECUTION CANDIDATE';
}

function _executionAuthorityFieldValue(record, lifecycle, bands, position) {
  const state = _executionAuthorityState(lifecycle, bands);
  const rewardR = _rewardRForLifecycle(lifecycle);
  const lines = [
    '**' + state + '**',
    'Dark Horse scans movers; it is not standalone execution authority.',
  ];
  if (state === 'EXECUTION CANDIDATE') {
    lines.push('Why: STILL ACTIVE + model ' + rewardR.toFixed(1) + 'R meet ATLAS 1:3 before gates.');
  } else if (state === 'WAIT FOR CONFIRMATION') {
    lines.push('Why: model ' + rewardR.toFixed(1) + 'R is acceptable, but timing still needs candle-close confirmation.');
  } else {
    lines.push('Why: model ' + rewardR.toFixed(1) + 'R is below the 2R minimum and ATLAS 1:3 preferred standard.');
    lines.push('Education / observation unless no higher-quality card exists: stronger conviction, closer entry, better R:R, less invalidation pressure.');
  }
  return lines.join('\n');
}

function _confirmationGateFieldValue(record, lifecycle, bands, urlMap) {
  if (!bands) {
    return [
      'Execution gate:',
      '• market context supports direction',
      '• decision, entry, watch, invalidation levels are available',
      '• a ' + _termLink('Confirmed Candle Close', urlMap) + ' appears in the required direction',
      '• model R:R is suitable for the card state',
    ].join('\n');
  }
  return [
    'Execution gate:',
    '• market context supports direction',
    '• ' + _termLink('Decision Level', urlMap) + ': **' + bands.triggerText + '**',
    '• ' + _termLink('Entry Zone', urlMap) + ': **' + bands.entryLowText + ' – ' + bands.entryHighText + '**',
    '• ' + _termLink('Invalidation', urlMap) + ': **' + bands.invalidationText + '**',
    '• candle-close confirmation in required direction',
    '• R:R: ATLAS preferred **1:3**; normal execution never below **2R**',
  ].join('\n');
}

function _sourceProofFieldValue(record, bands) {
  if (!bands) return 'Source proof pending until decision, entry, watch, and invalidation levels are available.';
  return [
    'Same evidence payload feeds text + PNG:',
    'Decision **' + bands.triggerText + '** · Entry **' + bands.entryLowText + ' – ' + bands.entryHighText + '** · Watch **' + bands.watchText + '** · Invalidation **' + bands.invalidationText + '**.',
    'Minimum buffer: **' + bands.bufferUsedText + '**. Why: ' + bands.bufferWhy + '.',
    'Chart labels use these same values.',
  ].join('\n');
}

function buildPricePrecisionAuditRows(ranking, volatility, opts) {
  const top10 = (ranking && Array.isArray(ranking.top10)) ? ranking.top10 : [];
  return top10.filter(_hasAnchors).map(record => {
    const bands = _deriveBands(record, volatility);
    const lifecycle = lifecycleStage(record);
    const contract = _contractInfo(record.symbol || '', record);
    const position = _positionRule(lifecycle, volatility, contract, bands);
    const rewardR = _rewardRForLifecycle(lifecycle);
    const direction = String(record.direction || 'Neutral');
    if (!bands) {
      return {
        symbol: record.symbol || '?',
        direction,
        decisionLevel: 'pending',
        entryZone: 'pending',
        watchLevel: 'pending',
        invalidation: 'pending',
        bufferUsed: 'pending',
        whyThisBuffer: 'levels unavailable',
        dollarRisk: 'pending',
        rewardToRisk: rewardR.toFixed(1) + 'R',
        status: 'FAIL',
      };
    }
    return {
      symbol: record.symbol || '?',
      direction,
      decisionLevel: bands.triggerText,
      entryZone: bands.entryLowText + '–' + bands.entryHighText,
      watchLevel: bands.watchText,
      cautionZone: bands.watchText + '–' + bands.cautionText,
      invalidation: bands.invalidationText,
      bufferUsed: bands.bufferUsedText,
      whyThisBuffer: bands.bufferWhy,
      dollarRisk: position.dollarRiskText,
      rewardToRisk: rewardR.toFixed(1) + 'R',
      status: 'PASS',
    };
  });
}

// ── Market Mood disc helper (B12 — 5-disc, /5, ⚫ inactive) ──
function _moodDiscs(volatility) {
  const lvl = String((volatility && volatility.level) || '').toLowerCase();
  if (lvl === 'extreme')  return { discs: discScale(5, 5, 'Extreme',  '🔴'), tag: 'EXTREME',  trailer: 'broad swings, late-stage reversals likely' };
  if (lvl === 'elevated') return { discs: discScale(4, 5, 'Elevated', '🟠'), tag: 'ELEVATED', trailer: 'broad market moving fast — larger pullbacks and sharper reversals are more likely' };
  if (lvl === 'quiet')    return { discs: discScale(2, 5, 'Quiet',    '🟢'), tag: 'QUIET',    trailer: 'liquidity thin, moves feel larger than catalysts' };
  return                    { discs: discScale(3, 5, 'Forming',  '🟡'), tag: 'FORMING',  trailer: 'broad read still developing' };
}

// ── Top-of-message red NEW divider (```diff fence) ──────────
function _redNewDividerTop(nowMs, universeSize) {
  const utc = _fmtUtcStamp(nowMs);
  const awst = _fmtAwstStamp(nowMs);
  return [
    '```diff',
    '- ' + BAR_HEAVY,
    '- ▼ ▼ ▼   N E W   D A R K   H O R S E   S C A N   ▼ ▼ ▼',
    '- ' + BAR_HEAVY,
    '-   🆕   ' + utc + '   ·   ' + awst + '   ·   ' + universeSize + ' markets scanned   🆕',
    '- ' + BAR_HEAVY,
    '```',
  ].join('\n');
}

// ── Section banner (gold/cyan/magenta box) ──────────────────
function _sectionBanner(text, accent) {
  const ansi = accent === 'cyan' ? ANSI_CYAN
             : accent === 'magenta' ? ANSI_MAGENTA
             : ANSI_BRIGHT_YELLOW;
  const inner = ' ' + text + ' ';
  const pad = Math.max(2, 52 - inner.length);
  const top = '╔' + '═'.repeat(52) + '╗';
  const mid = '║' + inner + ' '.repeat(pad) + '║';
  const bot = '╚' + '═'.repeat(52) + '╝';
  return ['```ansi', ansi + top + ANSI_RESET, ansi + mid + ANSI_RESET, ansi + bot + ANSI_RESET, '```'].join('\n');
}

// ── Gold subheading ("▸  …") ────────────────────────────────
function _subheading(text, accent) {
  const ansi = accent === 'cyan' ? ANSI_CYAN : ANSI_BRIGHT_YELLOW;
  return ['```ansi', ansi + '▸  ' + text + ANSI_RESET, '```'].join('\n');
}

// ── Terminology row — visible-bracket hyperlinks ────────────
function _terminologyRow(terms, urlMap) {
  return terms.map(t => _termLink(t, urlMap)).join('  ·  ');
}
function _terminologyEmbed(urlMap) {
  return {
    color: COLOR.CHART_REFERENCE,
    title: '📘 EXPANDED TERMINOLOGY HYPERLINKS',
    fields: [
      {
        name: 'Core levels',
        value: _terminologyRow(['Decision Level', 'Entry Zone', 'Watch Level', 'Caution Zone', 'Invalidation', 'Confirmed Candle Close'], urlMap),
        inline: false,
      },
      {
        name: 'Risk and lifecycle',
        value: _terminologyRow(['Conviction', 'Position Size', 'Dollar Risk', 'Reward-to-Risk', 'Risk Reduction', 'Fresh Setup', 'Still Active Setup', 'Fading Setup', 'Late-Stage Move'], urlMap),
        inline: false,
      },
      {
        name: 'Chart reading',
        value: _terminologyRow(['Pullback', 'Retest', 'Lower High', 'Higher Low', 'Support / Resistance', 'Re-entry Structure', 'Market Mood'], urlMap),
        inline: false,
      },
    ],
  };
}

// ── Market Mood block (B12 + Priority 1 doctrine) ───────────
function _marketMoodBlock(volatility, urlMap) {
  const mood = _moodDiscs(volatility);
  const moodLink = _termLink('Market Mood', urlMap);
  return [
    _subheading('Market Mood  ·  ' + mood.discs, 'gold'),
    '',
    '_What ' + moodLink + ' means right now:_',
    '   ' + mood.trailer + '.',
    '',
    '_Dollars-first guidance for today:_',
    '   🟢 Position size — if your normal risk is $500 on a $10k account,',
    '       reduce to ~$300 (60%) for the next 6 hours.',
    '   🟡 Exit-points — use the full invalidation level from the card.',
    '       Tight exits get hit before the 5-minute close confirms.',
    '   🟠 Lower-quality cards — skip them. Only act when price closes',
    '       beyond the decision level AND the next candle confirms with',
    '       a close in the required direction.',
    '   🛑 Do NOT chase already-extended moves. Wait for price to return',
    '       to the listed entry zone and confirm with a candle close.',
  ].join('\n');
}

// ── Banner content (M1 — first message) ─────────────────────
function _bannerContent(ranking, volatility, opts, urlMap, ctx) {
  const nowMs = (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();
  const universeSize = (opts && Number.isFinite(opts.universeSize))
    ? opts.universeSize
    : (ranking && Number.isFinite(ranking.allCount))
    ? ranking.allCount
    : ((ranking && ranking.top10 && ranking.top10.length) || 0);
  const promoted = ctx.promotedCount;
  const lifecycleCounts = ctx.lifecycleCounts;
  const standoutCountLine = promoted === 0
    ? '_No standouts cleared the publication bar this scan._'
    : '_' + promoted + ' standout' + (promoted === 1 ? '' : 's') + ' found this cycle._\n_'
      + (lifecycleCounts.fresh  > 0 ? lifecycleCounts.fresh  + ' fresh (new this scan)'  : '0 fresh')
      + '  ·  '
      + (lifecycleCounts.active > 0 ? lifecycleCounts.active + ' still active (1+ day)'  : '0 still active')
      + '  ·  '
      + (lifecycleCounts.fading > 0 ? lifecycleCounts.fading + ' fading'                  : '0 fading')
      + '._';

  const parts = [
    _redNewDividerTop(nowMs, universeSize),
    '',
    _sectionBanner('🐎  DARK HORSE — GLOBAL MOVER RADAR', 'gold'),
    '',
    standoutCountLine,
    '',
    '📘 **EXPANDED TERMINOLOGY HYPERLINKS**',
    '_See the terminology panel attached to this message._',
    '',
    _marketMoodBlock(volatility, urlMap),
  ];

  if (promoted > 0) {
    parts.push('');
    parts.push(_sectionBanner("⭐  STANDOUTS — TODAY'S STRONGEST MOVERS", 'gold'));
  }

  return parts.join('\n');
}

// ── Per-candidate lifecycle separator content ───────────────
// Goes IN FRONT of the candidate's embed in messages 2..N. M1's
// FRESH candidate gets a lifecycle line appended to the banner.
function _lifecycleSeparator(record, lifecycle, idx, total) {
  const rankLabel = 'STANDOUT #' + (idx + 1) + ' of ' + total;
  const symbolNote = (record.symbol || 'unknown') + ' — ' + lifecycle.narrative;
  function boxLine(text) {
    return '║ ' + String(text || '').slice(0, 60).padEnd(60, ' ') + ' ║';
  }
  if (lifecycle.tone === 'fresh') {
    // FRESH stays red-filled in Discord diff syntax.
    return [
      '```diff',
      '- ' + BAR_HEAVY,
      '-   🆕   FRESH   ·   ' + rankLabel + '   ·   ' + symbolNote,
      '- ' + BAR_HEAVY,
      '```',
    ].join('\n');
  }
  if (lifecycle.tone === 'active') {
    // STILL ACTIVE gets a bright cyan boxed banner so it does not
    // blend into the amber section headings.
    return [
      '```ansi',
      ANSI_BRIGHT_CYAN + '╔' + '═'.repeat(62) + '╗' + ANSI_RESET,
      ANSI_BRIGHT_CYAN + boxLine('🟦  STILL ACTIVE   ·   ' + rankLabel) + ANSI_RESET,
      ANSI_BRIGHT_CYAN + boxLine(symbolNote) + ANSI_RESET,
      ANSI_BRIGHT_CYAN + '╚' + '═'.repeat(62) + '╝' + ANSI_RESET,
      '```',
    ].join('\n');
  }
  // FADING gets a bright yellow boxed warning banner.
  return [
    '```ansi',
    ANSI_BRIGHT_YELLOW + '╔' + '═'.repeat(62) + '╗' + ANSI_RESET,
    ANSI_BRIGHT_YELLOW + boxLine('🟨  FADING   ·   ' + rankLabel) + ANSI_RESET,
    ANSI_BRIGHT_YELLOW + boxLine(symbolNote) + ANSI_RESET,
    ANSI_BRIGHT_YELLOW + '╚' + '═'.repeat(62) + '╝' + ANSI_RESET,
    '```',
  ].join('\n');
}

// ── Candidate field builders ────────────────────────────────
function _candidateDescription(record, stateBadge, bands, lifecycle) {
  const sym = record.symbol || 'instrument';
  // FADING / late-stage gets the mature-trend warning regardless
  // of bands availability.
  if (lifecycle && lifecycle.stage === 'FADING') {
    const dirNoun = String(record.direction || '').toLowerCase() === 'bearish' ? 'downtrend' : 'uptrend';
    const ageBars = record.moveAge && record.moveAge > 0 ? record.moveAge : 4;
    return sym + "'s " + dirNoun + ' has been running for ' + ageBars + ' cycles. Each new ' + (dirNoun === 'downtrend' ? 'low' : 'high') + ' is smaller than the last. The setup is late-stage — wait for price to return to the listed entry zone and confirm before acting.';
  }
  if (!bands) {
    if (stateBadge === STATE_BADGE.STRONG_BULLISH || stateBadge === STATE_BADGE.BULLISH_PRESSURE) {
      return 'Buyers moved ' + sym + ' above the decision area and held a candle close above it. The move is the first read this scan.';
    }
    if (stateBadge === STATE_BADGE.STRONG_BEARISH || stateBadge === STATE_BADGE.BEARISH_PRESSURE) {
      return 'Sellers moved ' + sym + ' below the decision area. Each bounce back toward that area has stalled, which shows sellers are defending it.';
    }
    return sym + ' is showing developing pressure. Wait for a decision-level close and a confirmed candle close before acting.';
  }
  // STILL ACTIVE / cycle 2+ — mid-stage continuation narrative.
  if (lifecycle && lifecycle.stage === 'STILL ACTIVE') {
    if (bands.isShort) {
      return sym + ' closed below ' + bands.triggerText + ' two cycles ago. Each rally back toward that area has stalled, which shows sellers are still defending the decision level.';
    }
    return sym + ' closed above ' + bands.triggerText + ' two cycles ago. Each pullback toward that area has held, which shows buyers are still defending the decision level.';
  }
  // FRESH default — new this scan.
  if (bands.isShort) {
    return sym + ' closed below ' + bands.triggerText + '. Each bounce back toward that area has stalled, which shows sellers are defending the decision level. The move is new this scan.';
  }
  return sym + ' closed above ' + bands.triggerText + ' — the decision level for this card — and held a candle close above it. Buyers are defending that area on pullbacks. The move is new this scan.';
}

function _convictionFieldValue(record, stateBadge) {
  const active = _scoreToActive(record.score);
  const label = _activeToLabel(active);
  const glyph = _badgeGlyph(stateBadge);
  const disc = discScale(active, 5, label, glyph);
  // B9 — reasoning from visible FOH evidence only.
  const breakdown = Array.isArray(record.scoreBreakdown) ? record.scoreBreakdown : [];
  const phase = String(record.movePhase || '').toLowerCase();
  const lifecycle = lifecycleStage(record);
  const dir = String(record.direction || '').toLowerCase();
  const movers = dir === 'bearish' ? 'sellers' : 'buyers';

  let reasoning;
  if (phase === 'early') {
    reasoning = 'price closed beyond the decision level + momentum increased + retest held + the decision area is defended by ' + movers + ' (all 4 criteria met)';
  } else if (phase === 'mid') {
    reasoning = 'price closed beyond the decision level + ' + movers + ' defended each retest across 2 cycles + momentum is holding (3 of 4 criteria met)';
  } else if (phase === 'late') {
    reasoning = 'decision level still valid + ' + movers + ' still defending — BUT each new ' + (dir === 'bearish' ? 'low' : 'high') + ' is less efficient than the last, and the move is ' + (record.moveAge || 4) + ' cycles old (2 of 4 criteria met, 2 weakening)';
  } else if (phase === 'exhaustion') {
    reasoning = 'late-stage exhaustion + most criteria weakened (1 of 4 criteria met, 3 weakening)';
  } else {
    reasoning = breakdown.length > 0 ? breakdown.join(' + ') : 'composite scoring threshold met';
  }

  return disc + '\n_Why ' + label + ': ' + reasoning + '._';
}

function _decisionLevelFieldValue(record, urlMap, bands) {
  const link = _termLink('Decision Level', urlMap);
  const dir = String(record.direction || '').toLowerCase();
  const phase = String(record.movePhase || '').toLowerCase();
  if (!bands) {
    return link + ': pending — anchor not yet available\n_Why it matters: this is the price level the setup will be built around once the chart evidence is available._';
  }
  const priceText = bands.triggerText;
  const isShort = bands.isShort;
  const defenders = isShort ? 'sellers' : 'buyers';
  const directionText = isShort ? 'below' : 'above';
  const retestText = isShort
    ? 'Each rally back toward that price has stalled, which shows sellers are defending the area.'
    : 'Each pullback toward that price has held, which shows buyers are defending the area.';
  const ageNote = (phase === 'early')
    ? priceText + ' is the price the setup is built around'
    : (phase === 'mid')
      ? priceText + ' has already been tested across multiple candles'
      : priceText + ' remains the active decision price while this late-stage setup is monitored';
  return [
    link + ': **' + priceText + '**',
    '_Why it matters: ' + ageNote + '._',
    '_Price must stay ' + directionText + ' this level for the ' + (isShort ? 'bearish' : 'bullish') + ' idea to remain valid. ' + retestText + '_',
  ].join('\n');
}

function _expectedDurationFieldValue(record, urlMap) {
  const link = _termLink('Expected Duration', urlMap);
  const phase = String(record.movePhase || '').toLowerCase();
  const section = String(record.section || '').toLowerCase();
  let suffix;
  if (phase === 'late' || phase === 'exhaustion') {
    suffix = 'Intraday — hours, not days';
  } else if (section === 'equities') {
    suffix = 'Intraday — hours, not days';
  } else {
    suffix = 'Swing — days, not minutes';
  }
  return link + ': ' + suffix;
}

function _todaysRankFieldValue(idx, total, urlMap) {
  const link = _termLink('Cycle Rank', urlMap);
  const ord = _ordinal(idx + 1);
  return link + ": " + ord + " of today's " + total + ' standout' + (total === 1 ? '' : 's');
}

function _directionFieldValue(direction, urlMap) {
  const dir = String(direction || '').toLowerCase();
  if (dir === 'bullish') return _termLink('Long ▲', urlMap) + ' — expecting price to keep moving up';
  if (dir === 'bearish') return _termLink('Short ▼', urlMap) + ' — expecting price to keep moving down';
  return '▶ Sideways — no clear directional bias';
}

function _moveTypeFieldValue(record) {
  const mt = moveType(record);
  const stage = moverStage(record);
  return mt + ' · ' + stage + ' stage';
}

function _whereToActFieldValue(record, bands, position, urlMap, nextReviewStamp) {
  if (!bands) {
    return '_Entry / watch / caution bands unavailable — evidence anchors pending. Re-read at next scan._';
  }
  const isShort = bands.isShort;
  const verb = isShort ? 'SELL' : 'BUY';
  const movers = isShort ? 'sellers' : 'buyers';
  const reachDir = isShort ? 'above' : 'below';
  const bandHighLowDescriptor = isShort ? 'closes below the band high' : 'closes above the band low';
  const invalidationLink = _termLink('Invalidation', urlMap);
  const dirNoun = isShort ? 'bearish' : 'bullish';

  // Dollar amounts at each zone — derived from the position rule.
  const fullRiskDollars = position.dollarRisk;
  const partialRiskDollars = Math.round(fullRiskDollars * 0.4);
  const drawdownDollars = Math.round(fullRiskDollars * 0.65);

  return [
    '🟢 ENTRY zone  {{entry:' + bands.entryLowText + ' – ' + bands.entryHighText + '}}',
    '   Meaning: price returned to the band where the last turn occurred.',
    '   Need: 5-minute candle opens inside the band AND ' + bandHighLowDescriptor + '.',
    '   Gate: ' + _termLink('Confirmed Candle Close', urlMap) + '. Action: ' + verb + ' close; model risk {{money:~$' + fullRiskDollars + '}}.',
    '',
    '🟡 WATCH level  {{watch:' + bands.watchText + '}}',
    '   Warning: price is moving against the idea before invalidation.',
    '   If 1H closes ' + reachDir + ' {{watch:' + bands.watchText + '}}, model drawdown is often 30–50%',
    '   ({{money:~$' + partialRiskDollars + '}} of {{money:~$' + fullRiskDollars + '}}). Action: hold; do NOT add.',
    '',
    '🟠 CAUTION zone  {{caution:' + bands.watchText + ' – ' + bands.cautionText + '}}',
    '   {{caution:Price is against the setup. Ignoring this can turn a}}',
    '   {{caution:controlled exit into full invalidation loss.}}',
    '   💲 Drawdown 50–80% ({{money:~$' + drawdownDollars + '}} of {{money:~$' + fullRiskDollars + '}}). Action: scratch and re-read.',
    '',
    '🔴 ' + invalidationLink + '  {{invalid:' + bands.invalidationText + '}}',
    '   ' + dirNoun + ' idea OFF. Full model risk: {{money:$' + fullRiskDollars + '}}.',
    '   Exit ALL. Do NOT re-enter until a new ' + _termLink('Re-entry Structure', urlMap) + ' appears.',
    '',
    '🔵 Next review  ' + nextReviewStamp,
    '   ATLAS re-reads every zone at the next scan.',
  ].join('\n');
}

function _whereToActFields(record, bands, position, urlMap, nextReviewStamp) {
  const value = _whereToActFieldValue(record, bands, position, urlMap, nextReviewStamp);
  if (!bands || value.length <= DISCORD_FIELD_VALUE_LIMIT) {
    return [{ name: 'Where to Act', value, inline: false }];
  }

  const chunks = value.split('\n\n');
  return [
    { name: 'Where to Act', value: chunks.slice(0, 2).join('\n\n'), inline: false },
    { name: 'Where to Act — Caution', value: chunks.slice(2, 3).join('\n\n'), inline: false },
    { name: 'Where to Act — Invalidation', value: chunks.slice(3).join('\n\n'), inline: false },
  ];
}

function _dollarRiskFieldValue(record, lifecycle, position, contract, bands) {
  // Header reflects lifecycle sizing.
  const headerNoun = lifecycle.stage === 'FRESH'
    ? 'half size for FRESH'
    : lifecycle.stage === 'FADING'
      ? 'quarter-size only because this is a FADING card'
      : 'full size allowed (STILL ACTIVE)';
  const lines = [];

  const standardDollar = position.standardDollarRisk;
  const standardDescriptor = contract.seeded
    ? '{{money:$' + standardDollar.toLocaleString('en-US') + ' risk on ' + contract.standardSizeLabel + '}} (distance ' + position.riskDistanceText + ')'
    : '{{money:$' + standardDollar + ' risk}} (model distance ' + position.riskDistanceText + ')';
  lines.push('💲 Model example: ' + standardDescriptor + '.');

  // Recommended dollars at the lifecycle-adjusted multiplier.
  const baseExpected = lifecycle.stage === 'FRESH' ? 0.5 : lifecycle.stage === 'FADING' ? 0.25 : 1.0;
  const moodAppendix = position.multiplier !== baseExpected ? ' × ' + position.moodNote : '';
  if (lifecycle.stage === 'FADING') {
    lines.push('💲 This card uses quarter-size because the setup is late-stage, so model planned risk is {{money:~' + position.dollarRiskText + '}}.');
  } else {
    lines.push('💲 Model size for this card (' + lifecycle.stage + ' · ' + position.lifecycleNote + moodAppendix + '): {{money:~' + position.dollarRiskText + '}}.');
  }

  // Mood scaling hint (only when relevant).
  if (lifecycle.stage === 'STILL ACTIVE' && position.multiplier < 1.0) {
    lines.push('💲 If Market Mood drops back to Quiet, scale up to full size after a valid re-read.');
  }
  if (lifecycle.stage === 'FRESH') {
    lines.push('💲 If Market Mood drops to Quiet (1/5) you can scale up to full size after a valid re-read.');
  }

  // Reward-target heuristic — fixed 2R or 3R based on lifecycle.
  if (bands) {
    const rewardR = _rewardRForLifecycle(lifecycle);
    const rewardDollar = Math.round(position.dollarRisk * rewardR);
    lines.push('💲 Reward target after confirmed follow-through: {{money:~$' + rewardDollar + '}} on the model size · {{money:' + rewardR.toFixed(1) + 'R}}.');
  }

  // Late-stage warning.
  if (lifecycle.stage === 'FADING') {
    lines.push('⚠️ R:R is below 2R — use only if no higher-quality card is available: stronger conviction, closer entry, better R:R, less invalidation pressure.');
  }

  return { value: lines.join('\n'), header: headerNoun };
}

function _whatThisMeansFieldValue(record, bands, urlMap) {
  if (!bands) {
    return 'The setup is forming, but the decision level and invalidation level are not available yet. Re-read at the next scan.';
  }
  const isShort = bands.isShort;
  return isShort
    ? 'The bearish idea remains valid only while price stays below the decision level and below invalidation at {{invalid:' + bands.invalidationText + '}}. Selling a controlled rally into the green entry band is the planned read.'
    : 'The bullish idea remains valid only while price stays above the decision level and above invalidation at {{invalid:' + bands.invalidationText + '}}. Buying a controlled pullback into the green entry band is the planned read.';
}

function _whatToDoNowFieldValue(record, lifecycle, position, bands, contract) {
  if (!bands) {
    return [
      '① Wait for the next scan — decision, entry, watch, and invalidation levels are not available yet.',
      '② Re-read this card against price action at next review.',
    ].join('\n');
  }
  const isShort = bands.isShort;
  const verb = isShort ? 'SELL' : 'BUY';
  const halfRisk = Math.round(position.dollarRisk * 0.5);
  // FADING — quarter-size flow.
  if (lifecycle.stage === 'FADING') {
    return [
      '① QUARTER size at most — not a primary entry. {{money:' + position.dollarRiskText + ' model risk}}.',
      '② Only ' + verb.toLowerCase() + ' if price returns to {{entry:' + bands.entryLowText + ' – ' + bands.entryHighText + '}} and forms a strong 5-minute close in the required direction.',
      '③ Place the exit-point at {{invalid:' + bands.invalidationText + '}} ({{money:' + position.dollarRiskText + ' model risk}}).',
      '④ If {{watch:' + bands.watchText + '}} closes ' + (isShort ? 'above' : 'below') + ' on 1H, exit ALL — late-stage cards do not get second chances.',
      '⑤ Skip if another standout has stronger conviction, closer entry, better R:R, and less invalidation pressure.',
    ].join('\n');
  }
  // FRESH / STILL ACTIVE common flow.
  return [
    '① Wait for a 5-min candle to open inside {{entry:' + bands.entryLowText + ' – ' + bands.entryHighText + '}}.',
    '② ' + verb + " that candle's close — {{money:" + position.dollarRiskText + ' model risk}}.',
    '③ Place the exit-point at {{invalid:' + bands.invalidationText + '}} ({{money:' + position.dollarRiskText + ' model risk}}).',
    '④ If {{watch:' + bands.watchText + '}} closes ' + (isShort ? 'above' : 'below') + ' on 1H, exit half (freeing {{money:~$' + halfRisk + '}}) and keep the exit-point unchanged.',
    '⑤ Full exit at {{invalid:' + bands.invalidationText + '}} if reached — the ' + (isShort ? 'bearish' : 'bullish') + ' idea is OFF.',
  ].join('\n');
}

function _whatConfirmsFieldValue(record, bands, urlMap) {
  if (!bands) return 'Decision, entry, watch, and invalidation levels are pending — re-read at next scan.';
  const isShort = bands.isShort;
  const side = isShort ? 'below' : 'above';
  const bandEdge = isShort ? bands.entryLowText : bands.entryHighText;
  const dirNoun = isShort ? 'rallying into' : 'pulling back into';
  return 'A 5m close ' + side + ' {{entry:' + bandEdge + '}} after ' + dirNoun
    + ' the entry band — the ' + _termLink('Confirmed Candle Close', urlMap) + ' test (price closes beyond the decision level AND the next candle holds in the required direction).';
}

function _whatCancelsFieldValue(record, bands) {
  if (!bands) return 'A close beyond the invalidation level — to be confirmed when decision and invalidation levels are available.';
  const isShort = bands.isShort;
  return 'A 1H close ' + (isShort ? 'above' : 'below') + ' {{invalid:' + bands.invalidationText + '}}. At that point price has invalidated the decision area and the ' + (isShort ? 'bearish' : 'bullish') + ' idea is cancelled.';
}

function _lateStageCaveatFieldValue() {
  return 'Use {{caution:quarter size}} because this is a ' + _termLink('Late-Stage Move') + '. Skip if another card has stronger conviction, closer entry, better R:R, less invalidation pressure.';
}

// ── Candidate embed (full v6 field set) ─────────────────────
function _candidateEmbed(record, idx, total, isLast, opts, urlMap, volatility, ctx) {
  const stateBadge = classifyStateBadge(record);
  const colour     = _badgeToColor(stateBadge);
  const bands      = _deriveBands(record, volatility);
  const lifecycle  = lifecycleStage(record);
  const contract   = _contractInfo(record.symbol || '', record);
  const position   = _positionRule(lifecycle, volatility, contract, bands);
  const nowMs      = (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();
  const nextReview = _fmtNextReviewUTC(nowMs, opts && opts.intervalMs);
  const description = _candidateDescription(record, stateBadge, bands);
  const chartCard = _candidateChartCardSpec(record, bands);

  const fields = [
    { name: 'Move Type',         value: _moveTypeFieldValue(record), inline: true },
    { name: 'Direction',         value: _directionFieldValue(record.direction, urlMap), inline: true },
    { name: 'Conviction',        value: _convictionFieldValue(record, stateBadge), inline: false },
    { name: 'ATLAS execution state', value: _executionAuthorityFieldValue(record, lifecycle, bands, position), inline: false },
    { name: 'ATLAS confirmation gate', value: _confirmationGateFieldValue(record, lifecycle, bands, urlMap), inline: false },
    { name: 'Decision Level',    value: _decisionLevelFieldValue(record, urlMap, bands), inline: true },
    { name: 'Expected Duration', value: _expectedDurationFieldValue(record, urlMap), inline: true },
    { name: "Today's Rank",      value: _todaysRankFieldValue(idx, total, urlMap), inline: true },
  ];
  fields.push(..._whereToActFields(record, bands, position, urlMap, nextReview));

  const dollarRisk = _dollarRiskFieldValue(record, lifecycle, position, contract, bands);
  fields.push({ name: '💲 Dollar Risk — ' + dollarRisk.header, value: dollarRisk.value, inline: false });
  fields.push({ name: 'What this means', value: _whatThisMeansFieldValue(record, bands, urlMap), inline: false });
  fields.push({ name: 'WHAT TO DO NOW',  value: _whatToDoNowFieldValue(record, lifecycle, position, bands, contract), inline: false });
  fields.push({ name: 'What confirms the idea', value: _whatConfirmsFieldValue(record, bands, urlMap), inline: false });
  fields.push({ name: 'What cancels the idea',  value: _whatCancelsFieldValue(record, bands), inline: false });
  fields.push({ name: 'Source proof', value: _sourceProofFieldValue(record, bands), inline: false });
  if (lifecycle.stage === 'FADING') {
    fields.push({ name: '⚠️  Late-stage risk note', value: _lateStageCaveatFieldValue(), inline: false });
  }

  const title = '🐎  ' + (record.symbol || '?') + '  ·  ' + stateBadge;
  const footerText = 'ATLAS · Dark Horse · standout ' + (idx + 1) + ' of ' + total
    + ' · ' + lifecycle.stage.toLowerCase() + ' lifecycle'
    + (isLast ? ' · next review ' + nextReview : '');

  return {
    color: colour,
    title,
    description,
    chartCard,
    fields,
    footer: { text: footerText },
  };
}

// ── BUILDING + Chart Reference message (M_pre-tail) ─────────
function _buildingAndReferenceMessage(opts, urlMap) {
  // BUILDING separator content + reference card embed.
  const badge = '[[NEW_BADGE:BUILDING|active]]  ·  CHART REFERENCE';
  const buildingBanner = _sectionBanner('📡  BUILDING — WARMING UP BELOW STANDOUT GRADE', 'magenta');
  const termRowBuilding = _terminologyRow(['Pullback', 'Support / Resistance', 'Reversal'], urlMap);
  const referenceBanner = _sectionBanner('📚  CHART REFERENCE — HOW TO READ THE FOUR ZONES', 'cyan');

  const content = [
    badge,
    '',
    buildingBanner,
    '',
    termRowBuilding,
    '',
    '_Two markets are close to the standout bar but not there yet._',
    '_Re-reading every 15 minutes — if either firms up by the next scan,_',
    '_they graduate into a standout card with full execution detail._',
    '',
    referenceBanner,
  ].join('\n');

  const embed = {
    color: COLOR.CHART_REFERENCE,
    title: '📚  Clean Bullish Breakout — Reference',
    description: 'Every Dark Horse candidate above is the same pattern in different markets. This is what it looks like on the chart, and what a trader actually does at each zone.',
    chartCard: _referenceChartCardSpec(),
    fields: [
      { name: 'What you are looking at', value: 'Price closed above the decision level, returned to test that same area, and held above it. Buyers defended the level, so the long idea remains valid while invalidation holds.', inline: false },
      { name: 'How a trader acts (concrete, dollars-first)', value: [
        '🟢 BUY the pullback into the {{entry:green ENTRY band}} — ONLY if the next 5-min candle opens inside the band AND closes above the band low.',
        '🔴 Place the exit-point just below the {{invalid:dashed red INVALIDATION line}}. If price closes below it on the 1H, exit immediately.',
        '💲 Dollar risk = (entry price − exit price) × position size × $/point. Size the trade so this number ≤ 1% of your account ({{money:$100 on $10k}}, {{money:$250 on $25k}}, {{money:$1,000 on $100k}}).',
      ].join('\n'), inline: false },
      { name: 'Rendered ATLAS chart card', value: 'The attached chart image shows the same four zones used above: green entry band, yellow watch level, red invalidation line, and ATLAS price boxes.', inline: false },
    ],
    footer: { text: 'ATLAS · Chart reference · rendered four-zone card' },
  };

  return { content, embeds: [embed] };
}

// ── Tail message (M_last) — Risk reminder + Briefing summary ─
function _tailContent(ranking, volatility, opts, urlMap, ctx) {
  const nowMs = (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();
  const intervalMs = (opts && Number.isFinite(opts.intervalMs)) ? opts.intervalMs : 15 * 60 * 1000;
  const nextReview = _fmtNextReviewUTC(nowMs, intervalMs);
  const mood = _moodDiscs(volatility);
  const promoted = ctx.promotedCount;

  const standouts = ctx.standouts || [];
  const summaryLines = standouts.map(s => {
    const lc = s.lifecycle.stage;
    const dollarText = s.position.dollarRiskText;
    const rewardR = lc === 'FADING' ? 1.3 : lc === 'FRESH' ? 5.7 : 3.0;
    return '_The ' + lc + ' ' + s.record.symbol + ' card is the '
      + (lc === 'FRESH' ? 'cleanest reward-to-risk' : lc === 'STILL ACTIVE' ? 'highest-conviction continuation' : 'late-stage scalp')
      + ': {{money:~' + dollarText + ' risk}} · target {{money:' + rewardR.toFixed(1) + 'R}}._';
  });

  const briefingParts = [
    _subheading('Risk reminder', 'gold'),
    '_Every zone above is what ATLAS sees right now. Live price moves, the_',
    '_zones move with it. Cross-check the current price against the zone_',
    '_before acting. ATLAS reviews again at ' + nextReview + '._',
    '',
    _subheading('Briefing summary', 'cyan'),
  ];

  if (promoted === 0) {
    briefingParts.push('_No standouts cleared the publication bar this scan. Market Mood ' + mood.discs + '._');
    briefingParts.push('_Next scan ' + nextReview + '._');
  } else {
    briefingParts.push('_' + promoted + ' standout' + (promoted === 1 ? '' : 's') + ' today (' + ctx.lifecycleCounts.fresh + ' FRESH, ' + ctx.lifecycleCounts.active + ' STILL ACTIVE, ' + ctx.lifecycleCounts.fading + ' FADING). Market Mood ' + mood.discs + '._');
    for (const line of summaryLines) briefingParts.push(line);
    briefingParts.push('_Next scan ' + nextReview + '._');
  }

  return briefingParts.join('\n');
}

// ── Token doctrine — Discord-safe transformation (D1 + bracket) ─
// Operator brief: strip {{X:Y}} tokens to Discord-renderable
// bold markdown. Preserve [[Label]](url) terminology hyperlinks
// (Discord renders these as "[Label]" styled in link colour,
// without backslash escapes). The [[NEW_BADGE:…]] token is
// already represented by the surrounding ```diff / ```ansi
// fences in the lifecycle separator — strip it from the body.
function _stripTokensForDiscord(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let s = text;
  // Inline colour-coded price tokens — convert to bold markdown so
  // the figures still read with emphasis once Discord drops colour.
  s = s.replace(/\{\{entry:([^}]+)\}\}/g,   '**$1**');
  s = s.replace(/\{\{watch:([^}]+)\}\}/g,   '**$1**');
  s = s.replace(/\{\{invalid:([^}]+)\}\}/g, '**$1**');
  s = s.replace(/\{\{money:([^}]+)\}\}/g,   '**$1**');
  // Caution body-prose token — drop emphasis (long sentences read
  // worse when bold-wrapped). The 🟠 emoji at the line head already
  // carries the colour cue.
  s = s.replace(/\{\{caution:([^}]+)\}\}/g, '$1');
  // Lifecycle badge → bold label so the FRESH / STILL ACTIVE /
  // FADING marker survives into the Discord body even when the
  // surrounding ```diff / ```ansi fence has rendered it visually
  // above.
  s = s.replace(/\[\[NEW_BADGE:([^\|\]]+)\|[a-z]+\]\]/g, '**$1**');
  return s;
}

function _walkMessageStrings(messages, transform) {
  return (messages || []).map(m => {
    const nm = Object.assign({}, m);
    if (typeof m.content === 'string') nm.content = transform(m.content);
    if (Array.isArray(m.embeds)) {
      nm.embeds = m.embeds.map(e => {
        const ne = Object.assign({}, e);
        if (e.title)       ne.title       = transform(e.title);
        if (e.description) ne.description = transform(e.description);
        if (Array.isArray(e.fields)) {
          ne.fields = e.fields.map(f => Object.assign({}, f, {
            name:  typeof f.name === 'string' ? transform(f.name) : f.name,
            value: typeof f.value === 'string' ? transform(f.value) : f.value,
          }));
        }
        if (e.footer && typeof e.footer.text === 'string') {
          ne.footer = Object.assign({}, e.footer, { text: transform(e.footer.text) });
        }
        if (e.author && typeof e.author.name === 'string') {
          ne.author = Object.assign({}, e.author, { name: transform(e.author.name) });
        }
        return ne;
      });
    }
    return nm;
  });
}

// ── Measurement helpers (Discord limits guard) ──────────────
function measureMessage(message) {
  const contentLen = (message && message.content ? message.content : '').length;
  const embeds = (message && message.embeds) || [];
  const embedTotals = embeds.map(_measureEmbed);
  return { contentLen, embedTotals };
}
function _measureEmbed(e) {
  let n = 0;
  if (e.title)       n += String(e.title).length;
  if (e.description) n += String(e.description).length;
  for (const f of (e.fields || [])) {
    if (f.name)  n += String(f.name).length;
    if (f.value) n += String(f.value).length;
  }
  if (e.footer && e.footer.text) n += String(e.footer.text).length;
  if (e.author && e.author.name) n += String(e.author.name).length;
  return n;
}

function findDiscordLimitViolations(message) {
  const violations = [];
  const contentLen = (message && message.content ? message.content : '').length;
  if (contentLen > DISCORD_CONTENT_LIMIT) {
    violations.push({ path: 'content', limit: DISCORD_CONTENT_LIMIT, actual: contentLen });
  }
  const embeds = (message && message.embeds) || [];
  embeds.forEach((e, ei) => {
    const total = _measureEmbed(e);
    if (total > DISCORD_EMBED_TOTAL_LIMIT) {
      violations.push({ path: 'embeds[' + ei + ']', limit: DISCORD_EMBED_TOTAL_LIMIT, actual: total });
    }
    if (e.title && String(e.title).length > DISCORD_EMBED_TITLE_LIMIT) {
      violations.push({ path: 'embeds[' + ei + '].title', limit: DISCORD_EMBED_TITLE_LIMIT, actual: String(e.title).length });
    }
    if (e.description && String(e.description).length > DISCORD_EMBED_DESC_LIMIT) {
      violations.push({ path: 'embeds[' + ei + '].description', limit: DISCORD_EMBED_DESC_LIMIT, actual: String(e.description).length });
    }
    (e.fields || []).forEach((f, fi) => {
      const nameLen = f.name ? String(f.name).length : 0;
      const valueLen = f.value ? String(f.value).length : 0;
      if (nameLen > DISCORD_FIELD_NAME_LIMIT) {
        violations.push({ path: 'embeds[' + ei + '].fields[' + fi + '].name', limit: DISCORD_FIELD_NAME_LIMIT, actual: nameLen });
      }
      if (valueLen > DISCORD_FIELD_VALUE_LIMIT) {
        violations.push({ path: 'embeds[' + ei + '].fields[' + fi + '].value', limit: DISCORD_FIELD_VALUE_LIMIT, actual: valueLen, name: f.name || '' });
      }
    });
    if (e.footer && e.footer.text && String(e.footer.text).length > DISCORD_EMBED_FOOTER_LIMIT) {
      violations.push({ path: 'embeds[' + ei + '].footer.text', limit: DISCORD_EMBED_FOOTER_LIMIT, actual: String(e.footer.text).length });
    }
  });
  return violations;
}

// ── Banned-wording sweep ────────────────────────────────────
function _flattenMessage(m) {
  const parts = [m.content || ''];
  for (const e of (m.embeds || [])) {
    parts.push(e.title || '', e.description || '');
    for (const f of (e.fields || [])) parts.push(f.value || '');
    if (e.footer && e.footer.text) parts.push(e.footer.text);
  }
  return parts.join('\n');
}
function sweepBannedWording(messages) {
  const hits = [];
  for (const m of (messages || [])) {
    const text = _flattenMessage(m);
    for (const re of BANNED_PATTERNS) {
      const match = text.match(re);
      if (match) hits.push({ pattern: re.toString(), match: match[0] });
    }
  }
  return hits;
}

// ── Sanitiser walker (external fomo.sanitize integration) ────
function sanitiseFohMessages(messages, sanitize) {
  let replaced = false;
  function applyStr(s) {
    if (typeof s !== 'string') return s;
    const r = sanitize({ content: s });
    if (r && r.replaced) replaced = true;
    return r.content;
  }
  const out = _walkMessageStrings(messages, applyStr);
  return { messages: out, replaced };
}

// ── Anchor presence guard ────────────────────────────────────
function _hasAnchors(r) {
  return !!(r && r.evidenceAnchors && r.evidenceAnchors.availability && r.evidenceAnchors.availability !== 'pending');
}

// ── MAIN — buildDarkHorseFohPayload ─────────────────────────
function buildDarkHorseFohPayload(ranking, volatility, opts) {
  opts = opts || {};
  const top10 = (ranking && Array.isArray(ranking.top10)) ? ranking.top10 : [];
  const withAnchors = top10.filter(_hasAnchors);
  const filteredOut = top10.length - withAnchors.length;

  const linkRouting = _routeTerminology(opts);
  const urlMap = linkRouting.urlMap;

  // Build the lifecycle context used by banner + tail.
  let freshN = 0, activeN = 0, fadingN = 0;
  const standoutsCtx = withAnchors.map(r => {
    const lifecycle = lifecycleStage(r);
    if (lifecycle.stage === 'FRESH')  freshN++;
    else if (lifecycle.stage === 'STILL ACTIVE') activeN++;
    else if (lifecycle.stage === 'FADING') fadingN++;
    const bands = _deriveBands(r, volatility);
    const contract = _contractInfo(r.symbol || '', r);
    const position = _positionRule(lifecycle, volatility, contract, bands);
    return { record: r, lifecycle, contract, position };
  });
  const ctx = {
    promotedCount: withAnchors.length,
    lifecycleCounts: { fresh: freshN, active: activeN, fading: fadingN },
    standouts: standoutsCtx,
  };

  const messages = [];

  // ── Message 1: banner (red NEW divider + section banner +
  // standout count + terminology row + Market Mood block +
  // STANDOUTS banner). Always banner-only — the FRESH candidate
  // ships as its own message so that Discord's 2000-char content
  // limit is comfortably respected even on heavy Market Mood
  // copy. The canonical prototype's "M1 = banner + FRESH" is a
  // preview-renderer surface; production Discord requires the
  // split.
  const bannerContent = _bannerContent(ranking, volatility, opts, urlMap, ctx);
  messages.push({ content: bannerContent, embeds: [_terminologyEmbed(urlMap)] });

  // ── Candidate messages — one per promoted standout.
  for (let i = 0; i < withAnchors.length; i++) {
    const record = withAnchors[i];
    const lifecycle = lifecycleStage(record);
    const separator = _lifecycleSeparator(record, lifecycle, i, withAnchors.length);
    const isLast = (i === withAnchors.length - 1);
    const embed = _candidateEmbed(record, i, withAnchors.length, isLast, opts, urlMap, volatility, ctx);
    messages.push({ content: separator, embeds: [embed] });
  }

  // ── BUILDING + Chart Reference message (always emitted,
  // educational surface).
  messages.push(_buildingAndReferenceMessage(opts, urlMap));

  // ── Tail (Risk reminder + Briefing summary).
  messages.push({ content: _tailContent(ranking, volatility, opts, urlMap, ctx) });

  // ── Discord-safe token transformation (D1 + bracket doctrine) ─
  const discordSafe = _walkMessageStrings(messages, _stripTokensForDiscord);

  return {
    kind: 'movement_digest_foh_v1_0',
    messages: discordSafe,
    candidateCount: withAnchors.length,
    embedCount: withAnchors.length,
    filteredOut,
    linkRoutingStatus: linkRouting.status,
  };
}

module.exports = {
  DISCORD_CONTENT_LIMIT,
  DISCORD_EMBED_TOTAL_LIMIT,
  DISCORD_FIELD_NAME_LIMIT,
  DISCORD_FIELD_VALUE_LIMIT,
  STATE_BADGE,
  STATE_BADGE_VALUES,
  COLOR,
  GLOSSARY_URL,
  SECTION_DISPLAY_ORDER,
  SECTION_LABEL,
  CONTRACT_INFO,
  TERMINOLOGY,
  classifyStateBadge,
  discScale,
  lifecycleStage,
  moveType,
  moverStage,
  measureMessage,
  findDiscordLimitViolations,
  sweepBannedWording,
  sanitiseFohMessages,
  renderChartCardAttachments,
  buildPricePrecisionAuditRows,
  buildDarkHorseFohPayload,
};
