'use strict';

// ============================================================
// darkHorseFoh.js — Dark Horse Front-of-House (FOH.1.2.1)
//
// Formatter / rendering layer only. Engine-layer boundaries
// preserved per operator doctrine:
//   - No scoring / thresholds / scheduler / transport changes.
//   - No Corey, Jane, Spidey, Macro, ranking maths edits.
//   - No darkHorseEngine / darkHorseRanking / index touches.
//   - No ATLAS_ASTRA_RELAY / discord-relay / echarts.min.js
//     touches.
//
// Canonical contract (UNCHANGED — engine call site safe):
//   buildDarkHorseFohPayload(ranking, volatility, opts)
//     → { kind, messages, candidateCount, embedCount,
//         filteredOut, linkRoutingStatus }
//
// FOH.1.2.1 revision (vs FOH.1.2.0):
//   - DEFECT FIX: ASCII chart reference removed from tail.
//     Replaced with a "pending live renderer" status card.
//   - HOOK: opts.chartCard = { url, title?, description? }
//     If supplied by the engine (when chart-card renderer is
//     wired), the tail surfaces it as a rendered embed (image
//     + title + description). Until that wiring exists, the
//     pending card renders.
//   - No other behavioural change vs FOH.1.2.0.
// ============================================================

const DISCORD_CONTENT_LIMIT     = 2000;
const DISCORD_EMBED_TOTAL_LIMIT = 6000;

const STATE_BADGE = Object.freeze({
  STRONG_BULLISH:               'STRONG BULLISH',
  STRONG_BEARISH:               'STRONG BEARISH',
  DEVELOPING_WATCH:             'DEVELOPING WATCH',
  BULLISH_PRESSURE:             'BULLISH PRESSURE',
  BEARISH_PRESSURE:             'BEARISH PRESSURE',
  MARGINAL_REDUCED_CONVICTION:  'MARGINAL · REDUCED CONVICTION',
});
const STATE_BADGE_VALUES = new Set(Object.values(STATE_BADGE));

const COLOR = Object.freeze({
  STRONG_BULLISH:   0x2ECC71,
  STRONG_BEARISH:   0xE74C3C,
  BULLISH_PRESSURE: 0x27AE60,
  BEARISH_PRESSURE: 0xC0392B,
  DEVELOPING_WATCH: 0xF1C40F,
  MARGINAL:         0x95A5A6,
  CHART_REFERENCE:  0xC9A227,
});

const ALLOWED_MOVE_TYPE = new Set(['Breakout', 'Reversal', 'Range Break', 'Continuation']);

const BANNED_PATTERNS = [
  /\bbody close\b/i,
  /\bbreak and hold\b/i,
  /\bretest holds\b/i,
  /\bread weakens\b/i,
  /\bpending\b/i,
  /\bunavailable\b/i,
  /\bLearning Links\b/i,
  /\bBOS\b/,
  /\bCHoCH\b/,
];

const GLOSSARY_URL = 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a';

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
function _badgeGlyph(stateBadge) {
  switch (stateBadge) {
    case STATE_BADGE.STRONG_BULLISH:
    case STATE_BADGE.BULLISH_PRESSURE:
      return '🟢';
    case STATE_BADGE.STRONG_BEARISH:
    case STATE_BADGE.BEARISH_PRESSURE:
      return '🔴';
    case STATE_BADGE.DEVELOPING_WATCH:
      return '🟡';
    case STATE_BADGE.MARGINAL_REDUCED_CONVICTION:
      return '⚪';
    default:
      return '🟠';
  }
}

function convictionScale(score, stateBadge) {
  const active = _scoreToActive(score);
  const label  = _activeToLabel(active);
  const glyph  = _badgeGlyph(stateBadge);
  const inactive = Math.max(0, 5 - active);
  return glyph.repeat(active) + '⚫'.repeat(inactive) + '  ·  ' + label;
}

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

function lifecycleStage(record) {
  const phase = String((record && record.movePhase) || '').toLowerCase();
  if (phase === 'early') {
    return { stage: 'FRESH', glyph: '🆕', tagline: 'Just cleared the bar this scan' };
  }
  if (phase === 'late' || phase === 'exhaustion') {
    return { stage: 'FADING', glyph: '⚪', tagline: 'Energy thinning — attention only' };
  }
  return { stage: 'STILL ACTIVE', glyph: '🟧', tagline: 'Holding rhythm from prior scans' };
}

function directionField(direction) {
  const d = String(direction || '').toLowerCase();
  if (d === 'bullish') return '▲ Long  ·  rising bias';
  if (d === 'bearish') return '▼ Short  ·  falling bias';
  return '▶ Sideways  ·  no clear bias';
}
function moveType(record) {
  const phase = String((record && record.movePhase) || '').toLowerCase();
  const struct = String((record && record.structureState) || '').toLowerCase();
  if (phase === 'early') return 'Breakout';
  if (phase === 'late' || phase === 'exhaustion') return 'Continuation';
  if (/range|consolidat/.test(struct)) return 'Range Break';
  if (/reversal|reverse|change/.test(struct)) return 'Reversal';
  return 'Continuation';
}
function moverStage(record) {
  const phase = String((record && record.movePhase) || '').toLowerCase();
  if (phase === 'early') return 1;
  if (phase === 'late' || phase === 'exhaustion') return 3;
  return 2;
}

function _fmtPrice(v) {
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) >= 1000) return v.toFixed(2);
  if (Math.abs(v) >= 10)   return v.toFixed(2);
  if (Math.abs(v) >= 1)    return v.toFixed(4);
  return v.toFixed(5);
}

function _entryZoneRange(record) {
  const ev = record && record.evidenceAnchors;
  if (!ev) return null;
  const dir = String((record && record.direction) || '').toLowerCase();
  const isShort = dir === 'bearish';
  const ref = isShort ? ev.recentLow : ev.recentHigh;
  const refPrice = ref && Number.isFinite(ref.price) ? ref.price : null;
  const hi = ev.recentHigh && Number.isFinite(ev.recentHigh.price) ? ev.recentHigh.price : null;
  const lo = ev.recentLow  && Number.isFinite(ev.recentLow.price)  ? ev.recentLow.price  : null;
  if (refPrice == null || hi == null || lo == null) return null;
  const span = Math.abs(hi - lo);
  if (!Number.isFinite(span) || span <= 0) return null;
  const buffer = span * 0.05;
  const zoneLo = refPrice - buffer;
  const zoneHi = refPrice + buffer;
  return {
    lo: zoneLo,
    hi: zoneHi,
    loText: _fmtPrice(zoneLo),
    hiText: _fmtPrice(zoneHi),
  };
}

function _triggerLevelValue(record) {
  const ev = record && record.evidenceAnchors;
  const dir = String((record && record.direction) || '').toLowerCase();
  const phase = String((record && record.movePhase) || '').toLowerCase();
  const ref = dir === 'bearish' ? (ev && ev.recentLow) : (ev && ev.recentHigh);
  const price = ref && ref.priceText;
  if (!price) return (dir === 'bearish' ? 'Below ' : 'Above ') + '0 — waiting for the next push';
  const word = dir === 'bearish' ? 'Below' : 'Above';
  const tail = (phase === 'early' || phase === 'mid')
    ? 'already broken and held'
    : 'waiting for the next push';
  return word + ' ' + price + ' — ' + tail;
}

function _todaysRankValue(idx, total) {
  const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'][idx] || ((idx + 1) + 'th');
  return ord + " of today's " + total + ' standout' + (total === 1 ? '' : 's');
}

function _whereToActValue(record) {
  const ev = record && record.evidenceAnchors;
  const dir = String((record && record.direction) || '').toLowerCase();
  const phase = String((record && record.movePhase) || '').toLowerCase();
  const isShort = dir === 'bearish';
  const verb = isShort ? 'SELL' : 'BUY';
  const inv  = ev && ev.invalidation;
  const invPrice = (inv && inv.priceText) || '0';
  const zone = _entryZoneRange(record);
  let entryLine;
  if (zone && zone.loText && zone.hiText) {
    entryLine = '🟢 ' + verb + ' at ' + zone.loText + '–' + zone.hiText + '  ·  on the dip-and-hold';
  } else {
    const ref = isShort ? (ev && ev.recentLow) : (ev && ev.recentHigh);
    const refText = (ref && ref.priceText) || '0';
    entryLine = '🟢 ' + verb + ' at ' + refText + '  ·  on the dip-and-hold';
  }
  const lines = [
    entryLine,
    '🛑 RISK-OFF at ' + invPrice + '  ·  exit the idea if this level fails',
  ];
  if (phase === 'late' || phase === 'exhaustion') {
    lines.push('⚠️  Size small — the move is late in its cycle');
  }
  return lines.join('\n');
}

function _description(record, stateBadge) {
  const sym = (record && record.symbol) || 'instrument';
  if (stateBadge === STATE_BADGE.STRONG_BULLISH) {
    return 'Price pushed through the prior ceiling on ' + sym + ' and held the level cleanly on the close. The move is fresh and the path of least resistance is up.';
  }
  if (stateBadge === STATE_BADGE.STRONG_BEARISH) {
    return 'Sellers cracked the prior floor on ' + sym + ' and the broken level has held as a ceiling on every bounce. Path of least resistance is down.';
  }
  if (stateBadge === STATE_BADGE.BULLISH_PRESSURE) {
    return sym + ' is building upward pressure — the trigger has not cleared yet, but buyers keep defending dips.';
  }
  if (stateBadge === STATE_BADGE.BEARISH_PRESSURE) {
    return sym + ' is building downward pressure — the trigger has not cleared yet, but sellers keep defending bounces.';
  }
  if (stateBadge === STATE_BADGE.DEVELOPING_WATCH) {
    return sym + ' is mature in its current direction. Reward is shrinking — wait for the next clean test, do not chase.';
  }
  return sym + ' is showing marginal conviction. Only act on a clean break — small size if at all.';
}

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

function _moodDiscs(volatility) {
  const lvl = String((volatility && volatility.level) || '').toLowerCase();
  if (lvl === 'extreme')  return { discs: '🔴🔴🔴🔴🔴', tag: 'EXTREME',  trailer: 'broad swings, late-stage reversals likely' };
  if (lvl === 'elevated') return { discs: '🟠🟠🟠🟠⚫', tag: 'ELEVATED', trailer: 'give trades more room' };
  if (lvl === 'quiet')    return { discs: '🟢🟢⚫⚫⚫', tag: 'QUIET',    trailer: 'liquidity thin, low conviction' };
  return                    { discs: '🟡🟡🟡⚫⚫', tag: 'FORMING',  trailer: 'broad read still developing' };
}

function _todaysReadLine(universeSize, candidateCount, volatility) {
  if (candidateCount === 0) {
    return universeSize + ' markets scanned — no standout cleared the publication bar this cycle';
  }
  const lvl = String((volatility && volatility.level) || '').toLowerCase();
  const moodLine = lvl === 'extreme'  ? 'broad market is fast and unsettled — size with care'
    : lvl === 'elevated' ? 'broad market is moving fast — size positions with care'
    : lvl === 'quiet'    ? 'broad market is subdued — moves can feel larger than the catalyst behind them'
    :                      'broad market read is forming';
  return candidateCount + ' standout' + (candidateCount === 1 ? '' : 's') + ' surfaced this scan  ·  ' + moodLine;
}

const BAR_HEAVY  = '━'.repeat(40);
const BAR_LIGHT  = '─'.repeat(40);
const BAR_DOTTED = '· '.repeat(20).trimEnd();

const ESC = '\u001b';
const ANSI_RESET    = ESC + '[0m';
const ANSI_GOLD     = ESC + '[33;1m';
const ANSI_GREEN    = ESC + '[32;1m';
const ANSI_YELLOW   = ESC + '[33;1m';
const ANSI_RED      = ESC + '[31;1m';
const ANSI_CYAN     = ESC + '[36;1m';
const ANSI_GREY     = ESC + '[30;1m';

function _redNewDivider(nowMs, universeSize) {
  const utc = _fmtUtcStamp(nowMs);
  const awst = _fmtAwstStamp(nowMs);
  const bar = '━'.repeat(50);
  return [
    '```diff',
    '- ' + bar,
    '-       N E W   D A R K   H O R S E   S C A N',
    '-   🆕   ' + utc + '   ·   ' + awst + '   🆕',
    '-         ' + universeSize + ' markets scanned',
    '- ' + bar,
    '```',
  ].join('\n');
}

function _consolidatedBanner(nowMs, universeSize, candidateCount, volatility) {
  const mood = _moodDiscs(volatility);
  const utc = _fmtUtcStamp(nowMs);
  const awst = _fmtAwstStamp(nowMs);
  return [
    '```ansi',
    ANSI_GOLD + '🐎  ATLAS · DARK HORSE — GLOBAL MOVER RADAR' + ANSI_RESET,
    '',
    ANSI_GOLD + '   ▸  Pulse of the desk' + ANSI_RESET,
    '       ' + _todaysReadLine(universeSize, candidateCount, volatility),
    '',
    ANSI_GOLD + '   ▸  Market mood' + ANSI_RESET,
    '       ' + mood.discs + '   ' + mood.tag + '  —  ' + mood.trailer,
    '',
    ANSI_GOLD + '   ▸  Scan signature' + ANSI_RESET,
    '       ' + utc + '  ·  ' + awst + '  ·  ' + universeSize + ' markets',
    '```',
  ].join('\n');
}

function _goldSubtitle(text) {
  return ['```ansi', ANSI_GOLD + text + ANSI_RESET, '```'].join('\n');
}

function _termRowMarkdown(terms, urlMap) {
  const fallback = (urlMap && urlMap.__default__) || GLOSSARY_URL;
  return terms.map(t => {
    const url = (urlMap && urlMap[t]) || fallback;
    return '[\\[' + t + '\\]](' + url + ')';
  }).join('  ·  ');
}

function _bannerContent(ranking, volatility, opts) {
  const nowMs = (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();
  const universeSize = (ranking && Number.isFinite(ranking.allCount))
    ? ranking.allCount
    : ((ranking && ranking.top10 && ranking.top10.length) || 0);
  const top10 = (ranking && ranking.top10) || [];
  const promoted = top10.filter(_hasAnchors).length;
  const linkRouting = _routeTerminology(opts);
  const terms = ['Breakout', 'Retest', 'Continuation', 'Mover Stage', 'Trigger Level', 'Risk-Off'];
  const termRow = _termRowMarkdown(terms, linkRouting.urlMap);

  const parts = [
    _redNewDivider(nowMs, universeSize),
    '',
    _consolidatedBanner(nowMs, universeSize, promoted, volatility),
    '',
    '📘 **EXPANDED TERMINOLOGY**',
    termRow,
  ];

  if (promoted > 0) {
    parts.push('');
    parts.push(_goldSubtitle("⭐  STANDOUTS — TODAY'S STRONGEST MOVERS"));
  }

  return parts.join('\n');
}

function _sectionStatusFromRows(rows) {
  if (!rows || rows.length === 0) return { glyph: '⚪', tag: 'QUIET',    ansi: ANSI_GREY  };
  for (const r of rows) {
    const ph = String((r && r.movePhase) || '').toLowerCase();
    if (ph === 'exhaustion') return { glyph: '🔴', tag: 'DANGER',   ansi: ANSI_RED };
  }
  const total = rows.reduce((s, r) => s + (Number(r.score) || 0), 0);
  const avg = total / rows.length;
  if (avg >= 8)   return { glyph: '🟢', tag: 'HEALTHY',  ansi: ANSI_GREEN  };
  if (avg >= 6.5) return { glyph: '🟡', tag: 'BUILDING', ansi: ANSI_YELLOW };
  if (avg >= 5)   return { glyph: '🟠', tag: 'CAUTION',  ansi: ANSI_YELLOW };
  return            { glyph: '🔵', tag: 'CONTEXT',  ansi: ANSI_CYAN   };
}
function _sectionBannerContent(sectionKey, rows) {
  const label = SECTION_LABEL[sectionKey] || String(sectionKey || 'SECTION').toUpperCase();
  const status = _sectionStatusFromRows(rows);
  const total = rows.reduce((s, r) => s + (Number(r.score) || 0), 0);
  const avg = rows.length > 0 ? (total / rows.length) : 0;
  const avgText = avg.toFixed(1) + ' / 10';
  const countText = rows.length + ' standout' + (rows.length === 1 ? '' : 's') + ' in section';
  return [
    '```ansi',
    status.ansi + BAR_LIGHT + ANSI_RESET,
    status.ansi + '   ' + status.glyph + '  ' + label + ANSI_RESET,
    status.ansi + '   ' + status.tag + '  ·  avg ' + avgText + '  ·  ' + countText + ANSI_RESET,
    status.ansi + BAR_LIGHT + ANSI_RESET,
    '```',
  ].join('\n');
}

function _lifecycleBadgeContent(record, idx, total) {
  const lc = lifecycleStage(record);
  const rankLabel = '#' + (idx + 1) + ' of ' + total;

  if (lc.stage === 'FRESH') {
    return [
      '```diff',
      '- ' + BAR_HEAVY,
      '- 🆕  FRESH  ·  NEW STANDOUT  ·  ' + rankLabel,
      '-     ' + lc.tagline,
      '- ' + BAR_HEAVY,
      '```',
    ].join('\n');
  }

  if (lc.stage === 'STILL ACTIVE') {
    return [
      '```ansi',
      ANSI_RED + BAR_LIGHT + ANSI_RESET,
      ANSI_RED + '🟧  STILL ACTIVE  ·  ON RADAR  ·  ' + rankLabel + ANSI_RESET,
      ANSI_RED + '    ' + lc.tagline + ANSI_RESET,
      ANSI_RED + BAR_LIGHT + ANSI_RESET,
      '```',
    ].join('\n');
  }

  return [
    '```ansi',
    ANSI_GREY + BAR_DOTTED + ANSI_RESET,
    ANSI_GREY + '⚪  FADING  ·  LATE STAGE  ·  ' + rankLabel + ANSI_RESET,
    ANSI_GREY + '    ' + lc.tagline + ANSI_RESET,
    ANSI_GREY + BAR_DOTTED + ANSI_RESET,
    '```',
  ].join('\n');
}

function _chartReferenceMessages(opts) {
  const card = opts && opts.chartCard;
  if (card && typeof card === 'object' && typeof card.url === 'string' && /^https?:\/\//.test(card.url)) {
    return [{
      content: _goldSubtitle('📈  CHART REFERENCE'),
    }, {
      embeds: [{
        color: COLOR.CHART_REFERENCE,
        title: card.title || 'Chart reference',
        description: card.description || 'Rendered chart card — candles, entry zone, watch level, invalidation line, HIGH / CURRENT / ENTRY / LOW labels.',
        image: { url: card.url },
      }],
    }];
  }

  const pendingCard = [
    '```ansi',
    ANSI_GOLD + BAR_LIGHT + ANSI_RESET,
    ANSI_GOLD + '   📈  CHART REFERENCE' + ANSI_RESET,
    ANSI_GOLD + '   Pending live renderer' + ANSI_RESET,
    ANSI_GOLD + BAR_LIGHT + ANSI_RESET,
    '```',
    'A rendered ATLAS chart card will appear here once the live chart renderer is wired into the Dark Horse digest.',
    '',
    'The wired card will include: candles, entry zone, watch level, invalidation line, and HIGH / CURRENT / ENTRY / LOW labels.',
    '',
    'For now, open the symbol on your charting platform of choice and use the Trigger Level and Where to Act values from each candidate card above as your reference points.',
    '',
    'Glossary: [\\[Breakout\\]](' + GLOSSARY_URL + ')  ·  [\\[Retest\\]](' + GLOSSARY_URL + ')  ·  [\\[Continuation\\]](' + GLOSSARY_URL + ')',
  ].join('\n');

  return [{ content: pendingCard }];
}

function _tailContent(opts) {
  const nowMs = (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();
  const intervalMs = (opts && Number.isFinite(opts.intervalMs)) ? opts.intervalMs : 15 * 60 * 1000;
  const nextUtc = _fmtNextReviewUTC(nowMs, intervalMs);

  return [
    '```ansi',
    ANSI_GOLD + '   ▸  Risk reminder' + ANSI_RESET,
    '       ATLAS surfaces conditions, not directives. Late-stage moves carry elevated reversal risk; reassess every read against the per-candidate criteria at the next scan.',
    '',
    ANSI_GOLD + '   ▸  Next sweep' + ANSI_RESET,
    '       ' + nextUtc + '  ·  ATLAS stays watching',
    '```',
  ].join('\n');
}

function _hasAnchors(r) {
  return !!(r && r.evidenceAnchors && r.evidenceAnchors.availability && r.evidenceAnchors.availability !== 'pending');
}

function _candidateEmbed(record, idx, total, isLast, opts) {
  const stateBadge = classifyStateBadge(record);
  const title = '🐎  ' + (record.symbol || '?') + '  ·  ' + stateBadge;
  const color = _badgeToColor(stateBadge);
  const desc  = _description(record, stateBadge);
  const conviction = convictionScale(record.score, stateBadge);
  const triggerVal = _triggerLevelValue(record);
  const moveT = moveType(record);
  const dirVal = directionField(record.direction);
  const horizon = /equities/i.test(record.sectionLabel || '') ? 'Hours, not days' : 'Days, not minutes';
  const rankVal = _todaysRankValue(idx, total);
  const whereTo = _whereToActValue(record);

  const fields = [
    { name: 'Move Type',     value: moveT + '  ·  Mover Stage ' + moverStage(record), inline: true },
    { name: 'Direction',     value: dirVal,     inline: true },
    { name: 'Conviction',    value: conviction, inline: true },
    { name: 'Trigger Level', value: triggerVal, inline: true },
    { name: 'Horizon',       value: horizon,    inline: true },
    { name: "Today's Rank",  value: rankVal,    inline: true },
    { name: 'Where to Act',  value: whereTo,    inline: false },
  ];

  const embed = { color, title, description: desc, fields };
  if (isLast) {
    embed.footer = { text: 'next sweep ' + _fmtNextReviewUTC(opts && opts.now, opts && opts.intervalMs) };
  }
  return embed;
}

function _routeTerminology(opts) {
  const urls = (opts && opts.terminologyUrls) || null;
  const map = { __default__: GLOSSARY_URL };
  if (urls && typeof urls === 'object') {
    for (const k of Object.keys(urls)) {
      const v = urls[k];
      if (typeof v === 'string' && /^https?:\/\//.test(v)) {
        map[k] = v;
      }
    }
  }
  return { status: 'partial', urlMap: map };
}

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

function sanitiseFohMessages(messages, sanitize) {
  let replaced = false;
  function bump(r) { if (r && r.replaced) replaced = true; }
  function applyStr(s) {
    if (typeof s !== 'string') return s;
    const r = sanitize({ content: s });
    bump(r);
    return r.content;
  }
  const out = (messages || []).map(m => {
    const nm = Object.assign({}, m);
    if (typeof m.content === 'string') nm.content = applyStr(m.content);
    if (Array.isArray(m.embeds)) {
      nm.embeds = m.embeds.map(e => {
        const ne = Object.assign({}, e);
        if (e.title)       ne.title       = applyStr(e.title);
        if (e.description) ne.description = applyStr(e.description);
        if (Array.isArray(e.fields)) {
          ne.fields = e.fields.map(f => Object.assign({}, f, { value: applyStr(f.value) }));
        }
        if (e.footer && typeof e.footer.text === 'string') {
          ne.footer = Object.assign({}, e.footer, { text: applyStr(e.footer.text) });
        }
        if (e.author && typeof e.author.name === 'string') {
          ne.author = Object.assign({}, e.author, { name: applyStr(e.author.name) });
        }
        return ne;
      });
    }
    return nm;
  });
  return { messages: out, replaced };
}

function buildDarkHorseFohPayload(ranking, volatility, opts) {
  opts = opts || {};
  const top10 = (ranking && Array.isArray(ranking.top10)) ? ranking.top10 : [];
  const withAnchors = top10.filter(_hasAnchors);
  const filteredOut = top10.length - withAnchors.length;

  const linkRouting = _routeTerminology(opts);
  const messages = [];

  const banner = _bannerContent(ranking, volatility, opts);

  if (withAnchors.length === 0) {
    messages.push({ content: banner });
  } else {
    messages.push({ content: banner });

    const bySection = {};
    for (const r of withAnchors) {
      const sec = (r && r.section) || 'other';
      if (!bySection[sec]) bySection[sec] = [];
      bySection[sec].push(r);
    }
    const orderedSections = SECTION_DISPLAY_ORDER.filter(s => bySection[s] && bySection[s].length > 0);
    for (const k of Object.keys(bySection)) {
      if (!orderedSections.includes(k)) orderedSections.push(k);
    }

    let runningIdx = 0;
    for (const sec of orderedSections) {
      const rows = bySection[sec];
      messages.push({ content: _sectionBannerContent(sec, rows) });
      for (let i = 0; i < rows.length; i++) {
        const record = rows[i];
        const isLast = (runningIdx === withAnchors.length - 1);
        messages.push({
          content: _lifecycleBadgeContent(record, runningIdx, withAnchors.length),
          embeds: [_candidateEmbed(record, runningIdx, withAnchors.length, isLast, opts)],
        });
        runningIdx += 1;
      }
    }
  }

  for (const m of _chartReferenceMessages(opts)) messages.push(m);

  messages.push({ content: _tailContent(opts) });

  return {
    kind: 'movement_digest_foh_v1_0',
    messages,
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
  classifyStateBadge,
  convictionScale,
  directionField,
  moveType,
  moverStage,
  lifecycleStage,
  measureMessage,
  sweepBannedWording,
  sanitiseFohMessages,
  buildDarkHorseFohPayload,
};
