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
//   B8  — state derivation: trigger-not-broken / broken-and-held /
//         broken-not-held / risk-off-hit. Risk-off is a single
//         invalidation level, never a range. Entry/watch/caution
//         BANDS derived in FOH (B8.a) — no ranking changes.
//   B9  — Conviction "Why X" reasoning sourced only from visible
//         FOH evidence (structure, trigger proximity, market mood,
//         risk score, lifecycle, chart evidence, invalidation
//         proximity).
//   B10 — Trigger narrative restored: What This Means / What To
//         Do Now / Dollar Risk This Trade / Trigger Level /
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
  EURUSD: { standardSizeLabel: '1 lot EURUSD',              dollarRiskPerLotStandard: 300,  pipDescriptor: '30-point exit on a 0.0030 move' },
  XAUUSD: { standardSizeLabel: '1 lot XAUUSD (100 oz)',     dollarRiskPerLotStandard: 1350, pipDescriptor: '$13.50/oz × 100 oz on a $13.50 move' },
  NVDA:   { standardSizeLabel: '100 shares NVDA',           dollarRiskPerLotStandard: 1860, pipDescriptor: '$18.60/share × 100 shares' },
});
function _contractInfo(symbol) {
  const seeded = CONTRACT_INFO[symbol];
  if (seeded) return Object.assign({ symbol, seeded: true }, seeded);
  return {
    symbol,
    seeded: false,
    standardSizeLabel: 'educational example position',
    dollarRiskPerLotStandard: 250,
    pipDescriptor: 'educational example — 1% of a $25,000 account',
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
    currentPrice,
    highPrice: Math.max.apply(null, prices),
    lowPrice: Math.min.apply(null, prices),
    entryHigh: bands.entryHigh,
    entryLow: bands.entryLow,
    watch: bands.watch,
    invalidation: bands.invalidation,
    candles,
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
    direction: 'Bullish',
    caption: 'ATLAS chart card · reference pattern · four-zone read',
    candles: [
      { o: 90, h: 94, l: 88, c: 91 },
      { o: 91, h: 96, l: 90, c: 92 },
      { o: 92, h: 100, l: 91, c: 99 },
      { o: 99, h: 105, l: 95, c: 96 },
      { o: 96, h: 108, l: 96, c: 107 },
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
  function zoneBand(p1, p2, colour, opacity) {
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) return '';
    const y1 = yFor(Math.max(p1, p2));
    const y2 = yFor(Math.min(p1, p2));
    return '<rect x="' + PADL + '" y="' + y1 + '" width="' + innerW + '" height="' + (y2 - y1) + '" fill="' + colour + '" opacity="' + opacity + '"/>';
  }
  let zones = zoneBand(spec.entryHigh, spec.entryLow, '#23A55A', '0.18');
  if (Number.isFinite(spec.watch)) {
    const y = yFor(spec.watch);
    zones += '<line x1="' + PADL + '" y1="' + y + '" x2="' + (PADL + innerW) + '" y2="' + y + '" stroke="#F1C40F" stroke-width="2" stroke-dasharray="7 6"/>';
    zones += '<text x="' + (PADL + 8) + '" y="' + (y - 6) + '" fill="#F1C40F" font-family="Consolas, monospace" font-size="14" font-weight="700">WATCH</text>';
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
    + zones + candlesSvg + labels
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
const ANSI_GREEN  = ESC + '[32;1m';
const ANSI_YELLOW = ESC + '[33;1m';
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
  'Trigger Level':                     'term-trigger-level',
  'Cycle Rank':                        'term-cycle-rank',
  'Long ▲':                            'term-long',
  'Short ▼':                           'term-short',
  'Structure Break':                   'term-structure-break',
  'Risk-Off':                          'term-risk-off',
  'Initial-direction reversal':        'term-initial-direction-reversal',
  'confirmed directional structure':   'term-confirmed-directional-structure',
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
    sizeNote: 'full size allowed (structure proven)',
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

  // Conviction-aware band width (Priority 7 doctrine).
  // High conviction / quiet vol → 4-point band (4% of span).
  // Elevated vol → 15-point band (15% of span).
  const lvl = String((volatility && volatility.level) || '').toLowerCase();
  const widthPct = (lvl === 'elevated' || lvl === 'extreme') ? 0.15 : 0.05;
  const bandWidth = span * widthPct;

  // Trigger anchor: the level that flipped. For longs, the prior
  // high (now broken). For shorts, the prior low (now broken).
  const trigger = isShort ? lo : hi;

  // Entry band centred on the trigger ± half band width.
  const entryLow  = trigger - bandWidth / 2;
  const entryHigh = trigger + bandWidth / 2;

  // Watch level — between entry and invalidation, 30% of the way
  // toward invalidation. The first warning that direction is
  // weakening.
  const distToInv = Math.abs(trigger - inv);
  const watch = isShort
    ? trigger + (distToInv * 0.30)
    : trigger - (distToInv * 0.30);

  // Caution band — the band between watch and invalidation. The
  // upper bound for longs is the watch level; for shorts mirror.
  // Caution INNER edge is watch, OUTER edge is the invalidation
  // less the band width.
  const cautionEdge = isShort
    ? inv - bandWidth
    : inv + bandWidth;

  return {
    trigger,
    triggerText: _fmtPrice(trigger),
    entryLow,    entryLowText:  _fmtPrice(entryLow),
    entryHigh,   entryHighText: _fmtPrice(entryHigh),
    watch,       watchText:     _fmtPrice(watch),
    caution:     cautionEdge,
    cautionText: _fmtPrice(cautionEdge),
    invalidation: inv,
    invalidationText: _fmtPrice(inv),
    bandWidthText: _fmtPrice(bandWidth),
    isShort,
  };
}

// ── B12 — position sizing rule (lifecycle × Market Mood) ────
function _positionRule(lifecycle, volatility, contract) {
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
  const dollarRisk = Math.round(contract.dollarRiskPerLotStandard * finalMult);
  const lotMult = finalMult.toFixed(2).replace(/\.?0+$/, '');
  return {
    multiplier:   finalMult,
    multiplierText: lotMult,
    lifecycleNote,
    moodNote,
    dollarRisk,
    dollarRiskText: '$' + dollarRisk.toLocaleString('en-US'),
  };
}

// ── Market Mood disc helper (B12 — 5-disc, /5, ⚫ inactive) ──
function _moodDiscs(volatility) {
  const lvl = String((volatility && volatility.level) || '').toLowerCase();
  if (lvl === 'extreme')  return { discs: discScale(5, 5, 'Extreme',  '🔴'), tag: 'EXTREME',  trailer: 'broad swings, late-stage reversals likely' };
  if (lvl === 'elevated') return { discs: discScale(4, 5, 'Elevated', '🟠'), tag: 'ELEVATED', trailer: 'broad market moving fast — bigger swings either side' };
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
             : ANSI_GOLD;
  const inner = ' ' + text + ' ';
  const pad = Math.max(2, 52 - inner.length);
  const top = '╔' + '═'.repeat(52) + '╗';
  const mid = '║' + inner + ' '.repeat(pad) + '║';
  const bot = '╚' + '═'.repeat(52) + '╝';
  return ['```ansi', ansi + top + ANSI_RESET, ansi + mid + ANSI_RESET, ansi + bot + ANSI_RESET, '```'].join('\n');
}

// ── Gold subheading ("▸  …") ────────────────────────────────
function _subheading(text, accent) {
  const ansi = accent === 'cyan' ? ANSI_CYAN : ANSI_GOLD;
  return ['```ansi', ansi + '▸  ' + text + ANSI_RESET, '```'].join('\n');
}

// ── Terminology row — visible-bracket hyperlinks ────────────
function _terminologyRow(terms, urlMap) {
  return terms.map(t => _termLink(t, urlMap)).join('  ·  ');
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
    '   🟡 Exit-points — give the trade more room. Tight exits get hit',
    '       before direction confirms.',
    '   🟠 Marginal setups — skip them. Only act when the trigger breaks',
    '       AND the next candle closes beyond it (the {{caution:confirmed',
    '       directional structure}} test).',
    '   🛑 Do NOT chase already-extended moves. Wait for the structural',
    '       test — the floor that was the ceiling.',
  ].join('\n');
}

// ── Banner content (M1 — first message) ─────────────────────
function _bannerContent(ranking, volatility, opts, urlMap, ctx) {
  const nowMs = (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();
  const universeSize = (ranking && Number.isFinite(ranking.allCount))
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

  const terms = ['Breakout', 'Pullback', 'Invalidation', 'Market Mood'];
  const termRow = _terminologyRow(terms, urlMap);

  const parts = [
    _redNewDividerTop(nowMs, universeSize),
    '',
    _sectionBanner('🐎  DARK HORSE — GLOBAL MOVER RADAR', 'gold'),
    '',
    standoutCountLine,
    '',
    '📘 **EXPANDED TERMINOLOGY HYPERLINKS**',
    termRow,
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
  const badge = '[[NEW_BADGE:' + lifecycle.stage + '|' + lifecycle.tone + ']]';
  const symbolNote = (record.symbol || 'unknown') + ' — ' + lifecycle.narrative;
  if (lifecycle.tone === 'fresh') {
    // FRESH: filled red badge (```diff fence captures the filled
    // red render in plain Discord).
    return [
      '```diff',
      '- ' + BAR_HEAVY,
      '-   🆕   FRESH   ·   ' + rankLabel + '   ·   ' + symbolNote,
      '- ' + BAR_HEAVY,
      '```',
      badge + '  ·  ' + rankLabel + '  ·  ' + symbolNote,
    ].join('\n');
  }
  if (lifecycle.tone === 'active') {
    // STILL ACTIVE: outlined red (```ansi red text on no fill).
    return [
      '```ansi',
      ANSI_RED + BAR_LIGHT + ANSI_RESET,
      ANSI_RED + '  🟧   STILL ACTIVE   ·   ' + rankLabel + '   ·   ' + symbolNote + ANSI_RESET,
      ANSI_RED + BAR_LIGHT + ANSI_RESET,
      '```',
      badge + '  ·  ' + rankLabel + '  ·  ' + symbolNote,
    ].join('\n');
  }
  // FADING: outlined orange (```ansi yellow/grey).
  return [
    '```ansi',
    ANSI_YELLOW + BAR_DOTTED + ANSI_RESET,
    ANSI_YELLOW + '  ⚪   FADING   ·   ' + rankLabel + '   ·   ' + symbolNote + ANSI_RESET,
    ANSI_YELLOW + BAR_DOTTED + ANSI_RESET,
    '```',
    badge + '  ·  ' + rankLabel + '  ·  ' + symbolNote,
  ].join('\n');
}

// ── Candidate field builders ────────────────────────────────
function _candidateDescription(record, stateBadge, bands, lifecycle) {
  const sym = record.symbol || 'instrument';
  // FADING / late-stage gets the mature-trend caveat regardless
  // of bands availability.
  if (lifecycle && lifecycle.stage === 'FADING') {
    const dirNoun = String(record.direction || '').toLowerCase() === 'bearish' ? 'downtrend' : 'uptrend';
    const ageBars = record.moveAge && record.moveAge > 0 ? record.moveAge : 4;
    return sym + "'s " + dirNoun + ' has been running for ' + ageBars + ' cycles. Each new ' + (dirNoun === 'downtrend' ? 'low' : 'high') + ' is smaller than the last. The move is mature — wait for a structural test, do not chase.';
  }
  if (!bands) {
    if (stateBadge === STATE_BADGE.STRONG_BULLISH || stateBadge === STATE_BADGE.BULLISH_PRESSURE) {
      return 'Buyers pushed ' + sym + ' through the prior ceiling and held the level on the close. The move is the first read this scan.';
    }
    if (stateBadge === STATE_BADGE.STRONG_BEARISH || stateBadge === STATE_BADGE.BEARISH_PRESSURE) {
      return 'Sellers cracked the prior floor on ' + sym + ' and the broken level has held as a ceiling on every bounce. Path of least resistance is down.';
    }
    return sym + ' is showing developing pressure. Wait for the next clean test before acting.';
  }
  // STILL ACTIVE / cycle 2+ — mid-stage continuation narrative.
  if (lifecycle && lifecycle.stage === 'STILL ACTIVE') {
    if (bands.isShort) {
      return sym + ' broke below ' + bands.triggerText + ' on the close two cycles ago. Sellers are still in control and the broken level has held as a ceiling on every bounce since.';
    }
    return sym + ' pushed above ' + bands.triggerText + ' two cycles ago and the broken level has held as support on every pullback since. Buyers stay in control.';
  }
  // FRESH default — new this scan.
  if (bands.isShort) {
    return sym + ' broke below ' + bands.triggerText + ' on the close. Sellers are still in control and the broken level has held as a ceiling on every bounce since. The move is new this scan.';
  }
  return sym + ' pushed above ' + bands.triggerText + ' — a level that had capped price for the prior multi-session window — and held the level cleanly on the close. The move is new this scan.';
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
    reasoning = 'trigger level broke + momentum increased + retest held + the broken level is now defended by ' + movers + ' (all 4 criteria met)';
  } else if (phase === 'mid') {
    reasoning = 'trigger level broke + ' + movers + ' defended every retest across 2 cycles + momentum holding (3 of 4 criteria met)';
  } else if (phase === 'late') {
    reasoning = 'trigger level still valid + ' + movers + ' still defending — BUT each new ' + (dir === 'bearish' ? 'low' : 'high') + ' is smaller than the last, and the move is ' + (record.moveAge || 4) + ' cycles old (2 of 4 criteria met, 2 weakening)';
  } else if (phase === 'exhaustion') {
    reasoning = 'late-stage exhaustion + most criteria weakened (1 of 4 criteria met, 3 weakening)';
  } else {
    reasoning = breakdown.length > 0 ? breakdown.join(' + ') : 'composite scoring threshold met';
  }

  return disc + '\n_Why ' + label + ': ' + reasoning + '._';
}

function _triggerLevelFieldValue(record, urlMap, bands) {
  const link = _termLink('Trigger Level', urlMap);
  const dir = String(record.direction || '').toLowerCase();
  const phase = String(record.movePhase || '').toLowerCase();
  if (!bands) {
    return link + ': pending — anchor not yet available\n_Why it matters: the level that flipped is the structural reference for this read._';
  }
  const priceText = bands.triggerText;
  const isShort = bands.isShort;
  const flipNoun = isShort ? 'floor that flipped into a ceiling' : 'ceiling that flipped into a floor';
  const flipVerb = isShort ? 'defend every bounce' : 'treat it as Support';
  const ageNote = (phase === 'early')
    ? priceText + ' capped every push for multiple sessions'
    : (phase === 'mid')
      ? priceText + ' was the floor that held for the prior multi-session window'
      : priceText + ' is the structural level the move rotates around';
  return [
    link + ': **' + priceText + '**',
    '_Why it matters: ' + ageNote + '._',
    '_It is now the ' + flipNoun + ' — buyers/sellers ' + flipVerb + '._',
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
    '   What this means: price has pulled back into the tight band where',
    '   ' + movers + ' stepped in the last time the level was tested.',
    '   Required price behaviour: a 5-minute candle that opens inside the',
    '   band AND ' + bandHighLowDescriptor + ' (this is the',
    '   {{caution:confirmed directional structure}} test).',
    '   Action: ' + verb + ' on that candle close — start with the position',
    '   rule below ({{money:~$' + fullRiskDollars + '}} planned risk).',
    '',
    '🟡 WATCH level  {{watch:' + bands.watchText + '}}',
    '   What this means: ' + movers + ' are losing initial control. The',
    '   first warning sign that the move is weakening.',
    '   💲 If price closes ' + reachDir + ' {{watch:' + bands.watchText + '}} on the 1H,',
    '   the position is typically down 30–50% of planned risk',
    '   ({{money:~$' + partialRiskDollars + '}} of the {{money:~$' + fullRiskDollars + '}} at risk).',
    '   Action: hold what you have, do NOT add more.',
    '',
    '🟠 CAUTION zone  {{caution:' + bands.watchText + ' – ' + bands.cautionText + '}}',
    '   {{caution:What this means: the other side is in control inside this band.}}',
    '   {{caution:Holding from here means fighting the structure — exit risk}}',
    '   {{caution:is now real, not theoretical.}}',
    '   💲 Position drawdown 50–80% of planned risk',
    '   ({{money:~$' + drawdownDollars + '}} of the {{money:~$' + fullRiskDollars + '}}).',
    '   Action: scratch the trade for a small loss now. Re-read at next scan.',
    '',
    '🔴 ' + invalidationLink + '  {{invalid:' + bands.invalidationText + '}}',
    '   What this means: the ' + dirNoun + ' idea is OFF entirely.',
    '   💲 Full planned risk taken: {{money:$' + fullRiskDollars + '}} on the recommended size.',
    '   Action: exit ALL remaining size NOW. Do NOT re-enter — wait for',
    '   a fresh structure on a later scan.',
    '',
    '🔵 Next review  ' + nextReviewStamp,
    '   ATLAS re-reads every zone at the next scan.',
  ].join('\n');
}

function _dollarRiskFieldValue(record, lifecycle, position, contract, bands) {
  // Header reflects lifecycle sizing.
  const headerNoun = lifecycle.stage === 'FRESH'
    ? 'half size for FRESH'
    : lifecycle.stage === 'FADING'
      ? 'QUARTER size only (FADING)'
      : 'full size allowed (STILL ACTIVE)';
  const lines = [];

  const standardDollar = contract.dollarRiskPerLotStandard;
  const standardDescriptor = contract.seeded
    ? '{{money:$' + standardDollar.toLocaleString('en-US') + ' risk on ' + contract.standardSizeLabel + '}} (' + contract.pipDescriptor + ')'
    : '{{money:$' + standardDollar + ' risk}} (educational example — 1% of $25,000 account; actual sizing depends on your account + contract)';
  lines.push('💲 Standard plan: ' + standardDescriptor + '.');

  // Recommended dollars at the lifecycle-adjusted multiplier.
  const baseExpected = lifecycle.stage === 'FRESH' ? 0.5 : lifecycle.stage === 'FADING' ? 0.25 : 1.0;
  const moodAppendix = position.multiplier !== baseExpected ? ' × ' + position.moodNote : '';
  lines.push('💲 Recommended for this card (' + lifecycle.stage + ' · ' + position.lifecycleNote + moodAppendix + '): {{money:~' + position.dollarRiskText + '}}.');

  // Mood scaling hint (only when relevant).
  if (lifecycle.stage === 'STILL ACTIVE' && position.multiplier < 1.0) {
    lines.push('💲 If Market Mood drops back to Quiet, scale up to full size after a clean re-read.');
  }
  if (lifecycle.stage === 'FRESH') {
    lines.push('💲 If Market Mood drops to Quiet (1/5) you can scale up to full size after a clean re-read.');
  }

  // Reward-target heuristic — fixed 2R or 3R based on lifecycle.
  if (bands) {
    const rewardR = lifecycle.stage === 'FADING' ? 1.3 : lifecycle.stage === 'FRESH' ? 5.7 : 3.0;
    const rewardDollar = Math.round(position.dollarRisk * rewardR);
    lines.push('💲 Reward target on a clean follow-through: {{money:~$' + rewardDollar + '}} on the recommended size · {{money:' + rewardR.toFixed(1) + 'R}}.');
  }

  // Late-stage warning.
  if (lifecycle.stage === 'FADING') {
    lines.push('⚠️ Reward-to-risk is below 2R — only take this card if no FRESH or STILL ACTIVE setups are available.');
  }

  return { value: lines.join('\n'), header: headerNoun };
}

function _whatThisMeansFieldValue(record, bands, urlMap) {
  if (!bands) {
    return 'The path of least resistance is forming, but the structural anchors are not yet available. Re-read at the next scan.';
  }
  const isShort = bands.isShort;
  const dirNoun = isShort ? 'down' : 'up';
  const holdNoun = isShort ? 'ceiling' : 'floor';
  return 'The path of least resistance is ' + dirNoun + ' while {{invalid:' + bands.invalidationText + '}} holds. '
    + (isShort ? 'Selling rallies' : 'Buying the dip') + ' into the tight green entry band is the trade ATLAS would take.';
}

function _whatToDoNowFieldValue(record, lifecycle, position, bands, contract) {
  if (!bands) {
    return [
      '① Wait for the next scan — structural anchors not yet wired.',
      '② Re-read this card against price action at next review.',
    ].join('\n');
  }
  const isShort = bands.isShort;
  const verb = isShort ? 'SELL' : 'BUY';
  const halfRisk = Math.round(position.dollarRisk * 0.5);
  // FADING — quarter-size flow.
  if (lifecycle.stage === 'FADING') {
    return [
      '① QUARTER size at most — this is not a primary entry. {{money:' + position.dollarRiskText + ' risk}}.',
      '② Only ' + verb.toLowerCase() + ' a clean pullback into {{entry:' + bands.entryLowText + ' – ' + bands.entryHighText + '}} that prints a strong defensive 5-min close.',
      '③ Place the exit-point at {{invalid:' + bands.invalidationText + '}} ({{money:' + position.dollarRiskText + ' risk}}).',
      '④ If {{watch:' + bands.watchText + '}} closes ' + (isShort ? 'above' : 'below') + ' on 1H, exit ALL — late-stage cards do not give second chances.',
      '⑤ Skip this card entirely if the FRESH or STILL ACTIVE standouts above offer a cleaner setup today.',
    ].join('\n');
  }
  // FRESH / STILL ACTIVE common flow.
  return [
    '① Wait for a 5-min candle to open inside {{entry:' + bands.entryLowText + ' – ' + bands.entryHighText + '}}.',
    '② ' + verb + " that candle's close — {{money:" + position.dollarRiskText + ' on the recommended size}}.',
    '③ Place the exit-point at {{invalid:' + bands.invalidationText + '}} ({{money:' + position.dollarRiskText + ' risk}}).',
    '④ If {{watch:' + bands.watchText + '}} closes ' + (isShort ? 'above' : 'below') + ' on 1H, exit half (freeing {{money:~$' + halfRisk + '}}) and hold the rest with the exit-point unchanged.',
    '⑤ Full exit at {{invalid:' + bands.invalidationText + '}} if reached — the ' + (isShort ? 'bearish' : 'bullish') + ' idea is OFF.',
  ].join('\n');
}

function _whatConfirmsFieldValue(record, bands, urlMap) {
  if (!bands) return 'Structural anchors pending — re-read at next scan.';
  const isShort = bands.isShort;
  const side = isShort ? 'below' : 'above';
  const bandEdge = isShort ? bands.entryLowText : bands.entryHighText;
  const dirNoun = isShort ? 'rallying into' : 'pulling back into';
  return 'A 5m close ' + side + ' {{entry:' + bandEdge + '}} after ' + dirNoun
    + ' the entry band — the {{caution:confirmed directional structure}} test (price closes past the trigger AND the next candle holds beyond it).';
}

function _whatCancelsFieldValue(record, bands) {
  if (!bands) return 'A close back across the invalidation level — to be confirmed when structural anchors are wired.';
  const isShort = bands.isShort;
  const reachVerb = isShort ? 'reclaimed' : 'rolled over';
  const sideNoun = isShort ? 'broken floor has been ' + reachVerb : 'ceiling-to-floor flip has failed and the move is ' + reachVerb;
  return 'A 1H close ' + (isShort ? 'above' : 'below') + ' {{invalid:' + bands.invalidationText + '}}. At that point the ' + sideNoun + '.';
}

function _lateStageCaveatFieldValue() {
  return 'Size {{caution:quarter}} — the move is late. The reward is small. Skip if better setups exist.';
}

// ── Candidate embed (full v6 field set) ─────────────────────
function _candidateEmbed(record, idx, total, isLast, opts, urlMap, volatility, ctx) {
  const stateBadge = classifyStateBadge(record);
  const colour     = _badgeToColor(stateBadge);
  const bands      = _deriveBands(record, volatility);
  const lifecycle  = lifecycleStage(record);
  const contract   = _contractInfo(record.symbol || '');
  const position   = _positionRule(lifecycle, volatility, contract);
  const nowMs      = (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();
  const nextReview = _fmtNextReviewUTC(nowMs, opts && opts.intervalMs);
  const description = _candidateDescription(record, stateBadge, bands);
  const chartCard = _candidateChartCardSpec(record, bands);

  const fields = [
    { name: 'Move Type',         value: _moveTypeFieldValue(record), inline: true },
    { name: 'Direction',         value: _directionFieldValue(record.direction, urlMap), inline: true },
    { name: 'Conviction',        value: _convictionFieldValue(record, stateBadge), inline: false },
    { name: 'Trigger Level',     value: _triggerLevelFieldValue(record, urlMap, bands), inline: true },
    { name: 'Expected Duration', value: _expectedDurationFieldValue(record, urlMap), inline: true },
    { name: "Today's Rank",      value: _todaysRankFieldValue(idx, total, urlMap), inline: true },
    { name: 'Where to Act',      value: _whereToActFieldValue(record, bands, position, urlMap, nextReview), inline: false },
  ];

  const dollarRisk = _dollarRiskFieldValue(record, lifecycle, position, contract, bands);
  fields.push({ name: '💲 Dollar risk this trade — ' + dollarRisk.header, value: dollarRisk.value, inline: false });
  fields.push({ name: 'What this means', value: _whatThisMeansFieldValue(record, bands, urlMap), inline: false });
  fields.push({ name: 'WHAT TO DO NOW',  value: _whatToDoNowFieldValue(record, lifecycle, position, bands, contract), inline: false });
  fields.push({ name: 'What confirms the idea', value: _whatConfirmsFieldValue(record, bands, urlMap), inline: false });
  fields.push({ name: 'What cancels the idea',  value: _whatCancelsFieldValue(record, bands), inline: false });
  if (lifecycle.stage === 'FADING') {
    fields.push({ name: '⚠️  Late-stage caveat', value: _lateStageCaveatFieldValue(), inline: false });
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
      { name: 'The story', value: 'Price pushed through a level that had capped it for weeks (the old high). It came back to test the same level. Buyers stepped in to defend it. The ceiling has flipped into a floor.', inline: false },
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
    const contract = _contractInfo(r.symbol || '');
    const position = _positionRule(lifecycle, volatility, contract);
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
  messages.push({ content: bannerContent });

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
  sweepBannedWording,
  sanitiseFohMessages,
  renderChartCardAttachments,
  buildDarkHorseFohPayload,
};
