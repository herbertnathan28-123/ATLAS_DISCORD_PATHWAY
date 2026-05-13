'use strict';
// ============================================================
// ATLAS FX — DARK HORSE FRONT-OF-HOUSE PRESENTATION (FOH.1.0.1)
//
// Binding contract: ATLAS Front-of-House Presentation Contract
// FOH.1.0.1 — Pack 2 Dark Horse + Pack 4 Expanded Terminology
// Hyperlinks + Pack 8 PR QA (Pack 5 Training Capture rows in
// docs/training-capture/).
//
// Scope: presentation-layer ONLY. Does NOT modify:
//   - scoring, thresholds, scheduler, transport, chunking
//   - Corey / Jane / Spidey / macro logic
//   - Market Intel / dashboard / renderer
//   - the existing buildRankedMovementDigestPayload (kept for
//     legacy QA harnesses; FOH path is the engine default).
//
// Output: { kind: 'movement_digest_foh_v1_0', messages: [...] }
// where `messages` is an ordered array of Discord-webhook POST
// bodies. The transport (darkHorseEngine.dhSendWebhook) walks
// the array; sequential delivery, fail-fast, cooldown anchors to
// the first message ID.
//
// Format per FOH.1.0.1 Pack 2:
//   - one embed per promoted candidate
//   - banner content on the first message
//   - `─── NEW ───` separator in the `content` field of each
//     candidate message so candidates do not visually blur
//   - trader-facing Level-1 voice throughout
//   - state-badge allow-list
//   - colour-active-count conviction scale (🟢🟢🟢 / 5)
//   - colour-coded text matching across icon / label / value
//   - section-level Expanded Terminology Hyperlinks (Pack 4)
//   - banned wording absent (Pack 2.6, Pack 8.4)
// ============================================================

const rank = require('./darkHorseRanking');

// ── ANSI / DIFF STYLE PRIMITIVES (Pack 2 — visual surface) ──
// Discord renders ESC[XXm sequences inside ```ansi fences with
// real colour. The single-character ESC byte (0x1B) is what
// triggers the SGR parse. We expose helpers for each of the
// visual primitives the FOH surface uses.
const ESC = '';
const STYLE = {
  GOLD_BOLD: `${ESC}[33;1m`,  // gold/orange section banners + subheadings
  CYAN_BOLD: `${ESC}[36;1m`,  // teal terminology chips + reference-card prose labels
  GREEN:     `${ESC}[32m`,    // chart art — uptrend / buyers
  RED:       `${ESC}[31m`,    // chart art — broken-level marker
  RESET:     `${ESC}[0m`,
};

// Top-of-scan red NEW divider — 5 lines inside ```diff. Discord
// renders `-` lines red, so the whole bar reads as a "change of
// scene" marker between the previous scan and the new one.
function redNewDividerTop(scanTimestamp, universeSize) {
  return [
    '```diff',
    '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '- ▼ ▼ ▼   N E W   D A R K   H O R S E   S C A N   ▼ ▼ ▼',
    '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `- 🆕   ${scanTimestamp} · ${universeSize} markets scanned   🆕`,
    '- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '```',
  ].join('\n');
}

// Per-message red NEW badge — single-line ```diff so every new
// candidate / surface change carries its own red marker, not just
// a plain text divider. Lighter than the top divider but still red.
function newBadgeSeparator(label) {
  return [
    '```diff',
    `- 🆕  ${label}`,
    '```',
  ].join('\n');
}

// Gold section heading box — bold gold ASCII inside ```ansi. The
// heading reads as a banner across the channel.
function goldSectionBox(headingText) {
  const inner = String(headingText).padEnd(46, ' ');
  return [
    '```ansi',
    `${STYLE.GOLD_BOLD}╔══════════════════════════════════════════════════╗`,
    `${STYLE.GOLD_BOLD}║   ${inner}║`,
    `${STYLE.GOLD_BOLD}╚══════════════════════════════════════════════════╝${STYLE.RESET}`,
    '```',
  ].join('\n');
}

// Bold-gold subheading inline — used for "▸ Today's read" /
// "▸ Market mood" / "▸ Risk reminder" rows under the banner.
function goldSubheading(text) {
  return [
    '```ansi',
    `${STYLE.GOLD_BOLD}▸  ${text}${STYLE.RESET}`,
    '```',
  ].join('\n');
}

// Teal/cyan terminology chip row. When `urlMap` carries real
// URLs for any term, we emit Markdown links (Discord auto-styles
// links in its native link colour, no fence required). Otherwise
// we fall back to ```ansi bold-cyan chips so the visual treatment
// is still present even before the glossary site is wired.
function tealTerminologyRow(terms, urlMap) {
  const map = urlMap && typeof urlMap === 'object' ? urlMap : {};
  const hasUrls = terms.some(t => typeof map[t] === 'string' && /^https?:\/\//.test(map[t]));
  if (hasUrls) {
    return terms.map(t => {
      const url = map[t];
      return (typeof url === 'string' && /^https?:\/\//.test(url))
        ? `[${t}](${url})`
        : `[${t}]`;
    }).join(' · ');
  }
  const inner = terms.map(t => `${STYLE.CYAN_BOLD}[${t}]${STYLE.RESET}`).join('  ');
  return [
    '```ansi',
    inner,
    '```',
  ].join('\n');
}

// Visual reference card (simplified, per operator: keep simplified
// for prototype wire-up; rendered ATLAS chart-reference cards are
// the NEXT evolution flagged in docs/training-capture/).
// Gold banner + green/red ASCII chart + 2 cyan-headed prose sections.
function visualReferenceCard() {
  return [
    '```ansi',
    `${STYLE.GOLD_BOLD}╔══════════════════════════════════════════════════╗`,
    `${STYLE.GOLD_BOLD}║   📚  CLEAN BULLISH BREAKOUT — REFERENCE         ║`,
    `${STYLE.GOLD_BOLD}╚══════════════════════════════════════════════════╝${STYLE.RESET}`,
    '',
    `${STYLE.GREEN}   ▲ price${STYLE.RESET}`,
    `${STYLE.GREEN}   │                            ╭──── higher still${STYLE.RESET}`,
    `${STYLE.GREEN}   │                      ╭──╮ ╱${STYLE.RESET}`,
    `${STYLE.RED}   │   ─────────────────●──╯  ●${STYLE.RESET}   ← buyers defended`,
    `${STYLE.RED}   │   ceiling, now a floor${STYLE.RESET}`,
    `${STYLE.GREEN}   │          ╭──╮${STYLE.RESET}`,
    `${STYLE.GREEN}   │    ╭──╮ ╱    ╲ ╱   ← pushed up through the ceiling${STYLE.RESET}`,
    `${STYLE.GREEN}   │ ╱╲╱   ╲╱      V${STYLE.RESET}`,
    `${STYLE.GREEN}   └──────────────────────────────────────▶ time${STYLE.RESET}`,
    '',
    `${STYLE.CYAN_BOLD}   ▸  The story${STYLE.RESET}`,
    '       Price pushed through a level that capped it for weeks,',
    '       then came back to test the same level. Buyers stepped',
    '       in to defend it. The ceiling has flipped into a floor.',
    '',
    `${STYLE.CYAN_BOLD}   ▸  How a trader acts${STYLE.RESET}`,
    '       Buy the pullback to the floor. Place the risk-off just',
    '       under it. If the floor breaks, the idea is off.',
    '```',
  ].join('\n');
}

// ── COLOUR MAP (Pack §0.1 — decimal RGB for Discord embeds) ──
const COLOUR = {
  STRONG_BULL: 3066993,    // #2ECC71
  STRONG_BEAR: 15158332,   // #E74C3C
  CAUTION:     15844367,   // #F1C40F
  MARGINAL:    15105570,   // #E67E22
  INFO:        1752220,    // #1ABC9C
  NEUTRAL:     9807270,    // #95A5A6
};

// ── STATE-BADGE ALLOW-LIST (Pack 2.3) ──────────────────────
const STATE_BADGE = {
  STRONG_BULLISH:                'STRONG BULLISH',
  STRONG_BEARISH:                'STRONG BEARISH',
  DEVELOPING_WATCH:              'DEVELOPING WATCH',
  BEARISH_PRESSURE:              'BEARISH PRESSURE',
  BULLISH_PRESSURE:              'BULLISH PRESSURE',
  MARGINAL_REDUCED_CONVICTION:   'MARGINAL · REDUCED CONVICTION',
  BREAKOUT_CONFIRMED:            'BREAKOUT CONFIRMED',
  RETEST_IN_PROGRESS:            'RETEST IN PROGRESS',
};
const STATE_BADGE_VALUES = new Set(Object.values(STATE_BADGE));

// Classify an enriched ranking record to one of the allow-list
// state badges. Score primary, then phase, then direction.
function classifyStateBadge(r) {
  const dir = r && r.direction;
  const score = Number.isFinite(r && r.score) ? r.score : 0;
  const phase = r && r.movePhase;
  const ev = r && r.evidenceAnchors;
  const hasNumericLevel = ev
    && ev.availability !== 'pending'
    && ev.invalidation
    && ev.invalidation.priceText;

  // Strongest signals first.
  if (score >= 8 && (phase === 'early' || phase === 'mid')) {
    if (dir === 'Bullish') return STATE_BADGE.STRONG_BULLISH;
    if (dir === 'Bearish') return STATE_BADGE.STRONG_BEARISH;
  }
  if (score >= 8 && (phase === 'late' || phase === 'exhaustion')) {
    return STATE_BADGE.DEVELOPING_WATCH;
  }
  if (phase === 'exhaustion') {
    return STATE_BADGE.MARGINAL_REDUCED_CONVICTION;
  }
  if (score >= 6) {
    if (dir === 'Bullish') return STATE_BADGE.BULLISH_PRESSURE;
    if (dir === 'Bearish') return STATE_BADGE.BEARISH_PRESSURE;
  }
  // Score < 6 should not normally promote into the FOH digest
  // (filterPromotedCandidates removes them) — but guard anyway.
  return STATE_BADGE.MARGINAL_REDUCED_CONVICTION;
}

// Map state badge to embed colour (Pack §0.1, state, not magnitude).
function badgeColour(badge) {
  if (badge === STATE_BADGE.STRONG_BULLISH
    || badge === STATE_BADGE.BULLISH_PRESSURE
    || badge === STATE_BADGE.BREAKOUT_CONFIRMED) return COLOUR.STRONG_BULL;
  if (badge === STATE_BADGE.STRONG_BEARISH
    || badge === STATE_BADGE.BEARISH_PRESSURE) return COLOUR.STRONG_BEAR;
  if (badge === STATE_BADGE.DEVELOPING_WATCH
    || badge === STATE_BADGE.RETEST_IN_PROGRESS) return COLOUR.CAUTION;
  if (badge === STATE_BADGE.MARGINAL_REDUCED_CONVICTION) return COLOUR.MARGINAL;
  return COLOUR.NEUTRAL;
}

// ── CONVICTION SCALE (Pack §0.2 colour-active-count) ───────
// Score → active count in 1..5. Colour follows badge state, not
// magnitude. Filler dots and empty circles are banned.
function convictionScale(score, badge) {
  const s = Number.isFinite(score) ? score : 0;
  let active;
  if (s >= 10) active = 5;
  else if (s >= 8) active = 4;
  else if (s >= 6) active = 3;
  else if (s >= 4) active = 2;
  else active = 1;

  let glyph;
  if (badge === STATE_BADGE.STRONG_BULLISH
    || badge === STATE_BADGE.BULLISH_PRESSURE
    || badge === STATE_BADGE.BREAKOUT_CONFIRMED) glyph = '🟢';
  else if (badge === STATE_BADGE.STRONG_BEARISH
    || badge === STATE_BADGE.BEARISH_PRESSURE) glyph = '🔴';
  else if (badge === STATE_BADGE.DEVELOPING_WATCH
    || badge === STATE_BADGE.RETEST_IN_PROGRESS) glyph = '🟡';
  else if (badge === STATE_BADGE.MARGINAL_REDUCED_CONVICTION) glyph = '🟠';
  else glyph = '⚪';

  let label;
  if (active >= 5) label = 'Very High';
  else if (active >= 4) label = 'High';
  else if (active >= 3) label = 'Medium';
  else label = 'Low';

  return `${glyph.repeat(active)} / 5 · ${label}`;
}

// ── DIRECTION + MOVE TYPE + STAGE ──────────────────────────
// Direction field value — beginner-readable. The icon + label is
// the at-a-glance read; the parenthetical is the beginner anchor
// so a Level-1 reader gets what each direction MEANS.
function directionField(direction) {
  if (direction === 'Bullish') return '▲ Long  (rising bias)';
  if (direction === 'Bearish') return '▼ Short  (falling bias)';
  return '▶ Sideways  (no clear bias)';
}

// Move type — derived from move phase + structure read. Spec
// allow-list is Breakout / Reversal / Range Break / Continuation.
function moveType(r) {
  const phase = r && r.movePhase;
  const struct = String((r && r.structureState) || '').toLowerCase();
  if (phase === 'exhaustion') return 'Reversal';
  if (/range/.test(struct) || /coil/.test(struct)) return 'Range Break';
  if (phase === 'early') return 'Breakout';
  return 'Continuation';
}

// Mover Stage 1/2/3 — early=1, mid=2, late/exhaustion=3.
function moverStage(r) {
  const phase = r && r.movePhase;
  if (phase === 'early') return 1;
  if (phase === 'mid') return 2;
  return 3;
}

// ── TIMEFRAME (section + phase aware) ──────────────────────
function timeframeField(r) {
  const sec = r && r.section;
  const phase = r && r.movePhase;
  // Late/exhaustion → shorter horizon, the move is mature.
  if (phase === 'late' || phase === 'exhaustion') return 'Intraday';
  // Commodities / indices tend to swing further on macro flow.
  if (sec === rank.SECTIONS.COMMODITIES || sec === rank.SECTIONS.INDICES) {
    return phase === 'mid' ? 'Position (1–4w)' : 'Swing (1–5d)';
  }
  // FX majors / crosses / equities: swing horizon.
  return 'Swing (1–5d)';
}

// ── TRIGGER LEVEL + WHERE TO ACT ───────────────────────────
// "Trigger level" is the level the candidate just moved through
// (the level the trader checks the chart for). Wording is
// beginner-readable per operator refinement: "Cleared 1.0950
// cleanly" / "Below 2398 cleanly" / "Above 925.40 — waiting for
// the next push". No "pending" / "unavailable" / "N/A" / backend
// state leaks.
function triggerField(r) {
  const ev = r && r.evidenceAnchors;
  if (!ev || ev.availability === 'pending') return null;
  const dir = r && r.direction;
  const anchor = dir === 'Bearish' ? ev.recentLow : ev.recentHigh;
  if (!anchor || !anchor.priceText) return null;
  if (ev.breakoutClose) {
    return dir === 'Bearish'
      ? `Below ${anchor.priceText} — already broken and held`
      : `Above ${anchor.priceText} — already broken and held`;
  }
  return dir === 'Bearish'
    ? `Below ${anchor.priceText} — waiting for the next push`
    : `Above ${anchor.priceText} — waiting for the next push`;
}

// Where to Act — multi-line value with BUY/SELL line + RISK-OFF
// line. Discord renders `\n` in field values as line breaks,
// so each action gets its own colour-banded row on mobile.
// Beginner-readable wording: "if price dips back here and holds"
// instead of "on the dip-and-hold"; "exit the idea if this level
// fails" instead of "level flips back to ceiling".
function whereToActField(r) {
  const ev = r && r.evidenceAnchors;
  if (!ev || ev.availability === 'pending') return null;
  const dir = r && r.direction;
  const anchor = dir === 'Bearish' ? ev.recentLow : ev.recentHigh;
  const inv = ev.invalidation;
  if (!anchor || !anchor.priceText) return null;
  if (!inv || !inv.priceText) return null;
  const isShort = dir === 'Bearish';
  const entryVerb = isShort ? 'SELL' : 'BUY';
  const entryHint = isShort
    ? 'if price bounces back here and stalls'
    : 'if price dips back here and holds';
  const stopHint = 'exit the idea if this level fails';
  const lines = [
    `🟢 ${entryVerb} at ${anchor.priceText}  —  ${entryHint}`,
    `🛑 RISK-OFF at ${inv.priceText}  —  ${stopHint}`,
  ];
  // Late-stage / exhaustion phase carries an explicit caveat row
  // so the trader doesn't size in like an early-stage card.
  if (r.movePhase === 'late' || r.movePhase === 'exhaustion') {
    lines.push('⚠️  Size small — the move is late in its cycle');
  }
  return lines.join('\n');
}

// ── DESCRIPTION — trader-voice one-liner ───────────────────
// ATLAS-grade conversational voice. No banned wording, no
// abbreviation jargon. The reader hears what happened on the
// chart in plain English.
function descriptionLine(r) {
  const phase = r && r.movePhase;
  const dir = r && r.direction;
  if (phase === 'exhaustion') {
    return 'Trend exhaustion at a major level. Reversal risk is rising.';
  }
  if (dir === 'Bullish') {
    if (phase === 'early') return 'Pushed above a multi-week ceiling and held the level cleanly. The move is fresh.';
    if (phase === 'mid')   return 'Bullish structure intact and momentum is expanding. The move has room.';
    if (phase === 'late')  return 'Mature uptrend. Reward is shrinking — wait for the next test, do not chase.';
  }
  if (dir === 'Bearish') {
    if (phase === 'early') return 'Broke under a multi-week floor. Sellers are now in control of the structure.';
    if (phase === 'mid')   return 'Bearish pressure is building and sellers are in control. The move has room.';
    if (phase === 'late')  return 'Mature downtrend. Reward is shrinking — wait for the next test, do not chase.';
  }
  return 'Sideways pressure, a decision is near. Watch the next break either side.';
}

// ── PACK 4 TERMINOLOGY HYPERLINK ROWS ──────────────────────
// Section-level row sits under the digest banner. Per-candidate
// row sits in the embed footer as bracketed inline terms so the
// trader sees the four canonical reference points right where
// the candidate is presented.
const TERMINOLOGY_BANNER = ['Breakout', 'Retest', 'Continuation', 'Mover Stage 1'];
const TERMINOLOGY_CANDIDATE = ['Breakout', 'Retest', 'Continuation', 'Mover Stage 1'];

function renderBracketedTerms(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return '';
  return terms.map(t => `[${t}]`).join(' ');
}

// ── BANNER ──────────────────────────────────────────────────
function _pad2(n) { return (n < 10 ? '0' : '') + n; }
function _fmtUtcStamp(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  return `${d.getUTCFullYear()}-${_pad2(d.getUTCMonth() + 1)}-${_pad2(d.getUTCDate())} ` +
         `${_pad2(d.getUTCHours())}:${_pad2(d.getUTCMinutes())} UTC`;
}
function _fmtUtcDate(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  return `${d.getUTCFullYear()}-${_pad2(d.getUTCMonth() + 1)}-${_pad2(d.getUTCDate())}`;
}

// Build the full banner-message content. This is what message-1
// carries above the first candidate embed:
//   1. Red NEW DARK HORSE SCAN divider (top)
//   2. Gold "🐎 DARK HORSE — GLOBAL MOVER RADAR" section box
//   3. Italic scan summary line (markets / standouts / mood)
//   4. 📘 EXPANDED TERMINOLOGY HYPERLINKS row (teal cyan or
//      Markdown links when `urlMap` carries URLs)
//   5. ▸ Today's read  (gold subheading + prose)
//   6. ▸ Market mood   (gold subheading + prose)
//   7. ⭐ STANDOUTS — TODAY'S STRONGEST MOVERS  (gold section box)
//   8. Red NEW STANDOUT #1 of N badge (immediately above the first
//      candidate embed in the same message)
function buildBanner(opts) {
  opts = opts || {};
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const promotedCount = Number.isFinite(opts.promotedCount) ? opts.promotedCount : 0;
  const universeSize = Number.isFinite(opts.universeSize) ? opts.universeSize : promotedCount;
  const volatilityLabel = (opts.volatilityLabel || '').trim();
  const urlMap = opts.terminologyUrls || null;
  const scanStr = _fmtUtcStamp(nowMs);

  const movedWord = promotedCount === 1 ? 'standout' : 'standouts';
  const summaryLine = promotedCount > 0
    ? `_${promotedCount} ${movedWord} found this cycle._`
    : '_Quiet cycle — markets are warming up below standout grade._';
  const moodLine = volatilityLabel
    ? `_Broader market mood: ${volatilityLabel}._`
    : '';

  const sections = [];
  sections.push(redNewDividerTop(scanStr, universeSize));
  sections.push('');
  sections.push(goldSectionBox('🐎  DARK HORSE — GLOBAL MOVER RADAR'));
  sections.push('');
  sections.push(summaryLine);
  if (moodLine) sections.push(moodLine);
  sections.push('');
  sections.push('📘 **EXPANDED TERMINOLOGY HYPERLINKS**');
  sections.push(tealTerminologyRow(TERMINOLOGY_BANNER, urlMap));
  sections.push('');
  sections.push(goldSubheading('Today\'s read'));
  sections.push(opts.todaysReadLine || _defaultTodaysRead(promotedCount));
  sections.push('');
  sections.push(goldSubheading('Market mood'));
  sections.push(opts.marketMoodLine || _defaultMarketMood(volatilityLabel));
  if (promotedCount > 0) {
    sections.push('');
    sections.push(goldSectionBox('⭐  STANDOUTS — TODAY\'S STRONGEST MOVERS'));
    sections.push('');
    sections.push(newBadgeSeparator(`STANDOUT #1 of ${promotedCount}`));
  }
  return sections.join('\n');
}

function _defaultTodaysRead(promotedCount) {
  if (promotedCount === 0) return 'No markets are standing out yet. The pre-radar surface below carries what is warming up.';
  if (promotedCount === 1) return 'One market is showing real strength today. Full read in the card below.';
  return `${promotedCount} markets are showing real strength today. Full reads in the cards below.`;
}
function _defaultMarketMood(volatilityLabel) {
  if (!volatilityLabel) return 'Reading is steady across the broader market.';
  const lower = volatilityLabel.toLowerCase();
  if (lower.includes('elevated')) return 'Elevated risk — the broader market is moving fast, so size positions with care.';
  if (lower.includes('extreme'))  return 'Extreme volatility — keep size very small and expect whippy levels.';
  if (lower.includes('quiet'))    return 'Quiet across the broader market — clean structure is easier to read in this mood.';
  return 'Reading is steady across the broader market.';
}

// ── PROMOTION FILTER ────────────────────────────────────────
// Spec discipline: "If a field has no value, the candidate
// doesn't promote." For the FOH surface, a candidate promotes
// only when chart-evidence anchors are wired (so Trigger and
// Where to Act both carry a real numeric level). When 1D OHLC
// is missing, the candidate is filtered out — the engine
// finalFire stays the same, but the embed array can be empty.
function filterPromotedCandidates(top10) {
  if (!Array.isArray(top10)) return [];
  return top10.filter((r) => {
    const ev = r && r.evidenceAnchors;
    if (!ev || ev.availability === 'pending') return false;
    const dir = r && r.direction;
    const anchor = dir === 'Bearish' ? ev.recentLow : ev.recentHigh;
    if (!anchor || !anchor.priceText) return false;
    if (!ev.invalidation || !ev.invalidation.priceText) return false;
    return true;
  });
}

// ── EMBED BUILDER (Pack 2.2 + v3 wire-up) ───────────────────
// Field names refined per operator: "Trigger" → "Trigger level"
// (clearer to beginners), "Standing" → "Today's rank". Per-card
// "Terms" / "In ATLAS terms" field removed — banner-level
// terminology row covers it. Multi-line Where to Act baked in via
// whereToActField(). Stage-aware caveat row appears inside Where
// to Act for late / exhaustion candidates.
function buildCandidateEmbed(r, idx, total, scanStampUtc) {
  const badge = classifyStateBadge(r);
  const colour = badgeColour(badge);
  const direction = directionField(r.direction);
  const conviction = convictionScale(r.score, badge);
  const type = moveType(r);
  const stage = moverStage(r);
  const tf = timeframeField(r);
  const trigger = triggerField(r);
  const whereToAct = whereToActField(r);
  // Stage label "early stage" / "mid stage" / "late stage" reads
  // more naturally than "Stage 1 / 2 / 3" for beginners.
  const stageWord = stage === 1 ? 'early stage' : stage === 2 ? 'mid stage' : 'late stage';
  const rankOrdinal = (idx + 1) === 1 ? '1st' : (idx + 1) === 2 ? '2nd' : `${idx + 1}th`;
  const rankValue = total === 1
    ? '1st of today\'s standouts'
    : `${rankOrdinal} of today's ${total} standouts`;

  const fields = [
    { name: 'Move Type',     value: `${type} · ${stageWord}`,    inline: true },
    { name: 'Direction',     value: direction,                    inline: true },
    { name: 'Conviction',    value: conviction,                   inline: true },
  ];
  if (trigger)    fields.push({ name: 'Trigger Level', value: trigger,        inline: true });
  fields.push({ name: 'Horizon',     value: tf,         inline: true });
  fields.push({ name: 'Today\'s Rank', value: rankValue, inline: true });
  if (whereToAct) fields.push({ name: 'Where to Act', value: whereToAct, inline: false });

  return {
    color: colour,
    title: `🐎  ${r.symbol}  ·  ${badge}`,
    description: descriptionLine(r),
    fields,
    footer: { text: `Dark Horse Radar  ·  ${scanStampUtc}  ·  standout ${idx + 1} of ${total}` },
  };
}

// ── MAIN ENTRY ──────────────────────────────────────────────
// buildDarkHorseFohPayload(ranking, volatility, opts)
//   ranking   — output of rank.buildRanking()
//   volatility — fomo volatility assessment (kept for parity with
//                the legacy builder; not rendered in FOH output)
//   opts      — { now?, nextReviewMs?, intervalMs? }
//
// Returns:
//   {
//     kind: 'movement_digest_foh_v1_0',
//     messages: [DiscordMessage...],   // ordered, one per webhook POST
//     embedCount: number,
//     candidateCount: number,          // post-filter count
//     filteredOut: number,             // promoted by ranking but missing anchor data
//     linkRoutingStatus: 'pending'|'partial'|'wired',
//   }
function buildDarkHorseFohPayload(ranking, volatility, opts) {
  opts = opts || {};
  const top = Array.isArray(ranking && ranking.top10) ? ranking.top10 : [];
  const promoted = filterPromotedCandidates(top);
  const filteredOut = top.length - promoted.length;
  const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
  const scanStampUtc = _fmtUtcStamp(nowMs);
  const messages = [];

  const universeSize = Number.isFinite(opts.universeSize)
    ? opts.universeSize
    : Number.isFinite(ranking && ranking.allCount)
      ? ranking.allCount
      : promoted.length;
  const volatilityLabel = (volatility && typeof volatility.level === 'string')
    ? volatility.level
    : '';
  const urlMap = (opts.terminologyUrls && typeof opts.terminologyUrls === 'object')
    ? opts.terminologyUrls
    : null;
  const linkRoutingStatus = (urlMap && TERMINOLOGY_BANNER.some(t =>
    typeof urlMap[t] === 'string' && /^https?:\/\//.test(urlMap[t])
  )) ? 'partial' : 'pending';

  // Build the candidate embeds. The last one's footer carries the
  // "next review" stamp.
  const embeds = promoted.map((r, i) => buildCandidateEmbed(r, i, promoted.length, scanStampUtc));
  if (embeds.length > 0) {
    const nextReviewMs = Number.isFinite(opts.nextReviewMs)
      ? opts.nextReviewMs
      : nowMs + (Number.isFinite(opts.intervalMs) ? opts.intervalMs : 15 * 60 * 1000);
    const last = embeds[embeds.length - 1];
    last.footer = {
      text: `Dark Horse Radar  ·  ${scanStampUtc}  ·  standout ${embeds.length} of ${embeds.length}  ·  next review ${_fmtUtcStamp(nextReviewMs)}`,
    };
  }

  // Message 1: banner + first candidate embed (or banner alone
  // when no candidates promote — the reference-card tail message
  // still carries the educational surface).
  const banner = buildBanner({
    nowMs,
    promotedCount: promoted.length,
    universeSize,
    volatilityLabel,
    terminologyUrls: urlMap,
  });
  if (embeds.length > 0) {
    messages.push({ content: banner, embeds: [embeds[0]] });
  } else {
    messages.push({ content: banner });
  }

  // Messages 2..N: red NEW BADGE separator + candidate embed.
  // Each separator carries the candidate's rank label so the
  // reader sees "STANDOUT #2 of 3" in red, not a plain dashed line.
  for (let i = 1; i < embeds.length; i++) {
    messages.push({
      content: newBadgeSeparator(`STANDOUT #${i + 1} of ${embeds.length}`),
      embeds: [embeds[i]],
    });
  }

  // Tail message: BUILDING / pre-radar gold heading + teal chips +
  // prose + visual reference card + ▸ Risk reminder. Always emitted
  // so even a quiet scan ships a useful educational surface.
  // Per operator: "Visual reference/card area included even during
  // quiet scans" + "At least one useful visual/educational
  // reference card in the generated output."
  const tailContent = [
    newBadgeSeparator('BUILDING  &  CHART REFERENCE'),
    '',
    goldSectionBox('📡  BUILDING — MARKETS WARMING UP'),
    '',
    tealTerminologyRow(['Pre-Radar', 'Momentum', 'Structure'], urlMap),
    '',
    '_These aren\'t ready to act on yet. They\'re close, and worth keeping on the chart._',
    '_If structure firms by the next cycle, they\'ll graduate into a standout._',
    '',
    visualReferenceCard(),
    '',
    goldSubheading('Risk reminder'),
    '_Even a strong standout is a plan, not a guarantee. Cross-check each card against live price before acting. ATLAS reviews again at the next scan._',
  ].join('\n');
  messages.push({ content: tailContent });

  return {
    kind: 'movement_digest_foh_v1_0',
    messages,
    embedCount: embeds.length,
    candidateCount: promoted.length,
    filteredOut,
    linkRoutingStatus,
  };
}

// ── SANITISER WALKER ────────────────────────────────────────
// fomo.sanitize operates on { content }. The FOH payload has
// content + embed strings. Walk the message array and apply
// sanitize() to every string field so banned phrases get
// scrubbed regardless of where they sit. The walker preserves
// the message-array shape so the engine transport stays the
// same.
function sanitiseFohMessages(messages, sanitize) {
  if (!Array.isArray(messages)) return { messages: [], replaced: false };
  let replaced = false;
  const out = messages.map((m) => {
    const next = { ...m };
    if (typeof next.content === 'string' && next.content.length) {
      const r = sanitize({ content: next.content });
      next.content = r.content;
      if (r.replaced) replaced = true;
    }
    if (Array.isArray(next.embeds)) {
      next.embeds = next.embeds.map((e) => {
        const ne = { ...e };
        for (const k of ['title', 'description']) {
          if (typeof ne[k] === 'string' && ne[k].length) {
            const r = sanitize({ content: ne[k] });
            ne[k] = r.content;
            if (r.replaced) replaced = true;
          }
        }
        if (Array.isArray(ne.fields)) {
          ne.fields = ne.fields.map((f) => {
            const nf = { ...f };
            if (typeof nf.value === 'string' && nf.value.length) {
              const r = sanitize({ content: nf.value });
              nf.value = r.content;
              if (r.replaced) replaced = true;
            }
            return nf;
          });
        }
        if (ne.footer && typeof ne.footer.text === 'string' && ne.footer.text.length) {
          const r = sanitize({ content: ne.footer.text });
          ne.footer = { ...ne.footer, text: r.content };
          if (r.replaced) replaced = true;
        }
        return ne;
      });
    }
    return next;
  });
  return { messages: out, replaced };
}

// ── BANNED-WORDING SWEEP (Pack 8.4, defence in depth) ──────
// The FOH builder produces output that should never carry these
// phrases. The sweep is a final guard: if anything slipped past
// the trader-voice writes above, the payload is rejected and the
// engine falls back to a no-op delivery for this scan. The next
// scan retries.
const FOH_BANNED_PATTERNS = [
  /\bBOS\b/,
  /\bCHoCH\b/,
  /\bpending\s+confirmation\b/i,
  /\bconfirmation\s+pending\b/i,
  /\btrigger\s+pending\b/i,
  /\bunavailable\b/i,
  /\bnot\s+online\b/i,
  /\bnot\s+yet\s+ready\b/i,
  /\bN\/A\b/,
  /\bcoming\s+soon\b/i,
  /\bprovider\b/i,
  /\bcache\b/i,
  /\bharvester\b/i,
  /\bmanifest\b/i,
  /\bTwelveData\b/i,
  /\bmatcher\b/i,
  /\bclassifier\b/i,
  /\bz-score\b/i,
  /\bATR percentile\b/i,
  /\bfetch_run_id\b/i,
];

function sweepBannedWording(messages) {
  const hits = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const blob = [m.content || ''];
    if (Array.isArray(m.embeds)) {
      for (const e of m.embeds) {
        if (e.title) blob.push(e.title);
        if (e.description) blob.push(e.description);
        if (Array.isArray(e.fields)) for (const f of e.fields) if (f.value) blob.push(f.value);
        if (e.footer && e.footer.text) blob.push(e.footer.text);
      }
    }
    const text = blob.join('\n');
    for (const re of FOH_BANNED_PATTERNS) {
      const m2 = text.match(re);
      if (m2) hits.push({ messageIdx: i, pattern: re.source, hit: m2[0] });
    }
  }
  return hits;
}

// ── EMBED SIZE GUARDS (Discord) ────────────────────────────
// Per Discord docs: ≤ 6000 chars total per embed (title +
// description + fields + footer + author + thumbnail.url).
// Per-message content ≤ 2000 chars. We measure conservatively
// and abort the send if any embed would exceed the limit, so
// the engine never publishes a partial digest.
const DISCORD_EMBED_TOTAL_LIMIT = 6000;
const DISCORD_CONTENT_LIMIT = 2000;

function measureEmbed(embed) {
  let n = 0;
  if (embed.title) n += embed.title.length;
  if (embed.description) n += embed.description.length;
  if (Array.isArray(embed.fields)) for (const f of embed.fields) {
    if (f.name) n += f.name.length;
    if (f.value) n += f.value.length;
  }
  if (embed.footer && embed.footer.text) n += embed.footer.text.length;
  if (embed.author && embed.author.name) n += embed.author.name.length;
  return n;
}
function measureMessage(message) {
  return {
    contentLen: (message.content || '').length,
    embedTotals: Array.isArray(message.embeds)
      ? message.embeds.map(measureEmbed)
      : [],
  };
}

// ── EXPORTS ─────────────────────────────────────────────────
module.exports = {
  buildDarkHorseFohPayload,
  sanitiseFohMessages,
  sweepBannedWording,
  filterPromotedCandidates,
  classifyStateBadge,
  badgeColour,
  convictionScale,
  directionField,
  moveType,
  moverStage,
  timeframeField,
  triggerField,
  whereToActField,
  descriptionLine,
  buildBanner,
  buildCandidateEmbed,
  renderBracketedTerms,
  measureEmbed,
  measureMessage,
  COLOUR,
  STATE_BADGE,
  STATE_BADGE_VALUES,
  TERMINOLOGY_BANNER,
  TERMINOLOGY_CANDIDATE,
  FOH_BANNED_PATTERNS,
  DISCORD_EMBED_TOTAL_LIMIT,
  DISCORD_CONTENT_LIMIT,
  // v3 visual primitives — exported for the qa:dh-foh harness and
  // for callers wiring future surfaces (rendered ATLAS chart-
  // reference cards, etc.) against the same primitives.
  STYLE,
  redNewDividerTop,
  newBadgeSeparator,
  goldSectionBox,
  goldSubheading,
  tealTerminologyRow,
  visualReferenceCard,
};
