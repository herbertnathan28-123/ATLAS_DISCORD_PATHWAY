'use strict';

// ============================================================
// darkHorseFoh.js — Dark Horse Front-of-House (FOH.1.0.1) wire-up
//
// Production module ported from the canonical v6 prototype lane
// (`scripts/_foh_renderer.js`, `scripts/render_dh_foh_v6_preview.js`,
// `docs/screenshots/dh-foh-v6-*`). Emits a Discord-renderable
// payload that the live engine sends as a sequence of messages
// (banner + per-candidate embeds + tail).
//
// Hard boundary preserved per operator doctrine:
//   - No scoring / thresholds / scheduler / transport changes.
//   - No Corey, Jane, Spidey, Macro, ranking maths edits.
//   - No dashboard / renderer.js changes.
//   - This module sits alongside the existing FOH formatter and
//     is reachable through a separate engine entry point.
//
// Canonical contract:
//   buildDarkHorseFohPayload(ranking, volatility, opts)
//     → { kind, messages, candidateCount, embedCount,
//         filteredOut, linkRoutingStatus }
// ============================================================

// ── Constants ────────────────────────────────────────────────
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

// Discord embed colour palette (decimal integers).
const COLOR = Object.freeze({
  STRONG_BULLISH:   0x2ECC71,
  STRONG_BEARISH:   0xE74C3C,
  BULLISH_PRESSURE: 0x27AE60,
  BEARISH_PRESSURE: 0xC0392B,
  DEVELOPING_WATCH: 0xF1C40F,
  MARGINAL:         0x95A5A6,
});

const ALLOWED_MOVE_TYPE = new Set(['Breakout', 'Reversal', 'Range Break', 'Continuation']);

// Banned wording — v6 doctrine. None of these may appear in any
// rendered message text, embed title, description, field value, or
// footer.
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

// ── Score / state classification ─────────────────────────────
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

// Public — used by both the QA harness directly and by the embed
// builder below.
function convictionScale(score, stateBadge) {
  const active = _scoreToActive(score);
  const label  = _activeToLabel(active);
  const glyph  = _badgeGlyph(stateBadge);
  return glyph.repeat(active) + ' / 5 · ' + label;
}

// Public — classify the candidate to a state-badge from the
// allow-list. See T6 cases for the canonical truth table.
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

// ── Per-field helpers (public) ───────────────────────────────
function directionField(direction) {
  const d = String(direction || '').toLowerCase();
  if (d === 'bullish') return '▲ Long  (rising bias)';
  if (d === 'bearish') return '▼ Short  (falling bias)';
  return '▶ Sideways  (no clear bias)';
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

// Trigger Level value — beginner-readable.
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

// Today's Rank value — "1st of today's N standouts".
function _todaysRankValue(idx, total) {
  const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'][idx] || ((idx + 1) + 'th');
  return ord + " of today's " + total + ' standout' + (total === 1 ? '' : 's');
}

// Where to Act — multi-line BUY/SELL + RISK-OFF + late-stage
// caveat (when phase is late or exhaustion).
function _whereToActValue(record) {
  const ev = record && record.evidenceAnchors;
  const dir = String((record && record.direction) || '').toLowerCase();
  const phase = String((record && record.movePhase) || '').toLowerCase();
  const isShort = dir === 'bearish';
  const verb = isShort ? 'SELL' : 'BUY';
  const ref  = isShort ? (ev && ev.recentLow)  : (ev && ev.recentHigh);
  const inv  = ev && ev.invalidation;
  const entryPrice = (ref && ref.priceText) || '0';
  const invPrice   = (inv && inv.priceText) || '0';
  const lines = [
    '🟢 ' + verb + ' at ' + entryPrice + ' — on the dip-and-hold',
    '🛑 RISK-OFF at ' + invPrice + ' — exit the idea if this level fails',
  ];
  if (phase === 'late' || phase === 'exhaustion') {
    lines.push('⚠️  Size small — the move is late in its cycle.');
  }
  return lines.join('\n');
}

// Description — single-line trader voice, ≤ 240 chars.
function _description(record, stateBadge) {
  const sym = (record && record.symbol) || 'instrument';
  const dir = String((record && record.direction) || '').toLowerCase();
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

// ── Banner construction (M1.content) ─────────────────────────
function _fmtNextReviewUTC(nowMs, intervalMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const interval = Number.isFinite(intervalMs) ? intervalMs : 15 * 60 * 1000;
  const d = new Date(now + interval);
  const pad = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
    + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}
function _fmtScanStamp(nowMs) {
  const d = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  const pad = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
    + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

function _redNewDivider(scanStamp, universeSize) {
  const bar = '━'.repeat(50);
  return [
    '```diff',
    '- ' + bar,
    '-       N E W   D A R K   H O R S E   S C A N',
    '-   🆕   ' + scanStamp + '   ·   ' + universeSize + ' markets scanned   🆕',
    '- ' + bar,
    '```',
  ].join('\n');
}
function _goldBanner(text) {
  return ['```ansi', '[33;1m' + text + '[0m', '```'].join('\n');
}
function _subheading(text) {
  return ['```ansi', '[33;1m▸  ' + text + '[0m', '```'].join('\n');
}
function _termRowCyanFallback(terms) {
  const inner = terms.map(t => '[36;1m[' + t + '][0m').join('  ');
  return ['```ansi', inner, '```'].join('\n');
}
function _termRowMarkdown(terms, urlMap) {
  return terms.map(t => '[' + t + '](' + urlMap[t] + ')').join('  ·  ');
}
function _todaysReadLine(universeSize, candidateCount, volatility) {
  if (candidateCount === 0) {
    return universeSize + ' markets scanned, no standout cleared the publication bar this cycle.';
  }
  const lvl = String((volatility && volatility.level) || '').toLowerCase();
  const moodLine = lvl === 'extreme' ? 'broad market is fast and unsettled — size with care'
                 : lvl === 'elevated' ? 'broad market is moving fast — size positions with care'
                 : lvl === 'quiet' ? 'broad market is subdued — moves can feel larger than the catalyst behind them'
                 : 'broad market read is forming.';
  return candidateCount + ' standout' + (candidateCount === 1 ? '' : 's') + ' surfaced this scan · ' + moodLine + '.';
}
function _marketMoodLine(volatility) {
  const lvl = String((volatility && volatility.level) || '').toLowerCase();
  if (lvl === 'extreme')  return '🔴🔴🔴🔴🔴 / 5 · Extreme — broad swings, late-stage reversals likely.';
  if (lvl === 'elevated') return '🟠🟠🟠🟠⚫ 4/5 · Elevated — bigger swings either side, give trades more room.';
  if (lvl === 'quiet')    return '🟢🟢⚫⚫⚫ 2/5 · Quiet — liquidity thin, low-conviction regime.';
  return '🟡🟡🟡⚫⚫ 3/5 · Reading forming.';
}

function _bannerContent(ranking, volatility, opts) {
  const nowMs = (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();
  const scanStamp = _fmtScanStamp(nowMs);
  const universeSize = (ranking && Number.isFinite(ranking.allCount))
    ? ranking.allCount
    : ((ranking && ranking.top10 && ranking.top10.length) || 0);
  const top10 = (ranking && ranking.top10) || [];
  const promoted = top10.filter(_hasAnchors).length;
  const linkRouting = _routeTerminology(opts);
  const terms = ['Breakout', 'Retest', 'Continuation', 'Mover Stage 1'];

  const termRow = linkRouting.status === 'partial'
    ? _termRowMarkdown(terms, linkRouting.urlMap)
    : _termRowCyanFallback(terms);

  return [
    _redNewDivider(scanStamp, universeSize),
    '',
    _goldBanner('🐎  DARK HORSE — GLOBAL MOVER RADAR'),
    '',
    _subheading("Today's read"),
    _todaysReadLine(universeSize, promoted, volatility),
    '',
    _subheading('Market mood'),
    _marketMoodLine(volatility),
    '',
    '📘 **EXPANDED TERMINOLOGY**',
    termRow,
    '',
    _goldBanner("⭐  STANDOUTS — TODAY'S STRONGEST MOVERS"),
  ].join('\n');
}

// ── Tail message — BUILDING + visual reference card ──────────
function _tailContent() {
  return [
    '```diff',
    '-     🆕  BUILDING & CHART REFERENCE',
    '```',
    '',
    _goldBanner('📡  BUILDING — MARKETS WARMING UP'),
    '',
    '_Below the publication bar but worth keeping on the internal radar. ATLAS will re-scan every 15 minutes — surfaces will promote here when momentum + structure align._',
    '',
    _goldBanner('📚  CLEAN BULLISH BREAKOUT — REFERENCE'),
    '',
    '```',
    'price ↑',
    '       │                              ┌── higher still',
    '       │                              │',
    '       │   ── ceiling, now a floor ──●─●  ← buyers defended',
    '       │   ─────────────────────────',
    '       │                /‾‾\\',
    '       │   /\\  /‾\\  /‾‾   ←── pushed through the ceiling',
    '       │__/_\\/___\\/____________________→ time',
    '```',
    '_The story: price pushed through a level that capped it for weeks, then came back to test the same level. Buyers stepped in to defend it. The ceiling has flipped into a floor._',
    '_How a trader acts: buy the pullback to the floor. Place the exit-point just under it. If the floor breaks, the idea is off._',
    '',
    _subheading('Risk reminder'),
    '_ATLAS surfaces conditions, not directives. Late-stage moves carry elevated reversal risk; reassess every read against the per-candidate criteria at the next scan._',
  ].join('\n');
}

// ── Per-candidate embed builder ──────────────────────────────
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
  const horizon = (record.section && /equities/i.test(record.sectionLabel || '')) ? 'Hours, not days' : 'Days, not minutes';
  const rankVal = _todaysRankValue(idx, total);
  const whereTo = _whereToActValue(record);

  const fields = [
    { name: 'Move Type',     value: moveT + ' · Mover Stage ' + moverStage(record), inline: true },
    { name: 'Direction',     value: dirVal, inline: true },
    { name: 'Conviction',    value: conviction, inline: true },
    { name: 'Trigger Level', value: triggerVal, inline: true },
    { name: 'Horizon',       value: horizon, inline: true },
    { name: "Today's Rank",  value: rankVal, inline: true },
    { name: 'Where to Act',  value: whereTo, inline: false },
  ];

  const embed = { color, title, description: desc, fields };
  if (isLast) {
    embed.footer = { text: 'next review ' + _fmtNextReviewUTC(opts && opts.now, opts && opts.intervalMs) };
  }
  return embed;
}

// ── Terminology URL routing ──────────────────────────────────
function _routeTerminology(opts) {
  const urls = (opts && opts.terminologyUrls) || null;
  if (!urls || typeof urls !== 'object') return { status: 'pending', urlMap: {} };
  const valid = {};
  let anyWired = false;
  for (const k of Object.keys(urls)) {
    const v = urls[k];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) {
      valid[k] = v;
      anyWired = true;
    }
  }
  return { status: anyWired ? 'partial' : 'pending', urlMap: valid };
}

// ── Public — measurement / sweep / sanitiser ─────────────────
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

// ── Main entry ───────────────────────────────────────────────
function buildDarkHorseFohPayload(ranking, volatility, opts) {
  opts = opts || {};
  const top10 = (ranking && Array.isArray(ranking.top10)) ? ranking.top10 : [];
  const withAnchors = top10.filter(_hasAnchors);
  const filteredOut = top10.length - withAnchors.length;

  const linkRouting = _routeTerminology(opts);
  const messages = [];

  const banner = _bannerContent(ranking, volatility, opts);

  if (withAnchors.length === 0) {
    // M1: banner only (no embeds). M_last: tail.
    messages.push({ content: banner });
  } else {
    // M1: banner + first candidate embed
    const isLastM1 = withAnchors.length === 1;
    messages.push({
      content: banner,
      embeds: [_candidateEmbed(withAnchors[0], 0, withAnchors.length, isLastM1, opts)],
    });
    // M2..Mn: red NEW BADGE + candidate embed
    for (let i = 1; i < withAnchors.length; i++) {
      const isLast = i === withAnchors.length - 1;
      const badge = [
        '```diff',
        '-     🆕  STANDOUT #' + (i + 1) + ' of ' + withAnchors.length,
        '```',
      ].join('\n');
      messages.push({
        content: badge,
        embeds: [_candidateEmbed(withAnchors[i], i, withAnchors.length, isLast, opts)],
      });
    }
  }
  // Tail message — always shipped, even on empty top10.
  messages.push({ content: _tailContent() });

  return {
    kind: 'movement_digest_foh_v1_0',
    messages,
    candidateCount: withAnchors.length,
    embedCount: withAnchors.length,
    filteredOut,
    linkRoutingStatus: linkRouting.status,
  };
}

// ── Exports ─────────────────────────────────────────────────
module.exports = {
  // Constants
  DISCORD_CONTENT_LIMIT,
  DISCORD_EMBED_TOTAL_LIMIT,
  STATE_BADGE,
  STATE_BADGE_VALUES,
  COLOR,
  // Classifiers / formatters
  classifyStateBadge,
  convictionScale,
  directionField,
  moveType,
  moverStage,
  // Measurement / sweep / sanitiser
  measureMessage,
  sweepBannedWording,
  sanitiseFohMessages,
  // Main entry
  buildDarkHorseFohPayload,
};
