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
function directionField(direction) {
  if (direction === 'Bullish') return '▲ Long';
  if (direction === 'Bearish') return '▼ Short';
  return '▶ Sideways';
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

// ── TRIGGER + WHERE TO ACT ─────────────────────────────────
// Trigger field surfaces the trigger price + state. The state
// uses the approved replacement wording from Pack 2.7:
//   - confirmed (when chart-evidence anchor is wired and breakoutClose set)
//   - awaiting trigger (when level exists but no breakout candle yet)
//   - setup developing (when level exists but no confirmation yet)
// "pending" / "pending confirmation" / "unavailable" / "N/A" are
// BANNED — never reach a user-facing field.
function triggerField(r) {
  const ev = r && r.evidenceAnchors;
  if (!ev || ev.availability === 'pending') return null;  // suppress field
  const dir = r && r.direction;
  const anchor = dir === 'Bearish' ? ev.recentLow : ev.recentHigh;
  if (!anchor || !anchor.priceText) return null;
  if (ev.breakoutClose) return `${anchor.priceText} confirmed`;
  return `${anchor.priceText} · awaiting trigger`;
}

// Where to Act — colour-coded text matching (Pack §0.4).
// Format: 🟢 ENTRY POINT: <level> · 🛑 STOP LOSS: <level>
// When evidence-anchor data is missing the entire field is
// suppressed (no "pending" leak).
function whereToActField(r) {
  const ev = r && r.evidenceAnchors;
  if (!ev || ev.availability === 'pending') return null;
  const dir = r && r.direction;
  const anchor = dir === 'Bearish' ? ev.recentLow : ev.recentHigh;
  const inv = ev.invalidation;
  if (!anchor || !anchor.priceText) return null;
  if (!inv || !inv.priceText) return null;
  const verb = dir === 'Bearish' ? 'Sell on retest of' : 'Buy on retest of';
  return `🟢 ENTRY POINT: ${anchor.priceText} · 🛑 STOP LOSS: ${inv.priceText} · ${verb} ${anchor.priceText}`;
}

// ── DESCRIPTION — trader-voice one-liner ───────────────────
// No backend wording. No "pending" / "unavailable". Approved
// trader voice patterns from Pack 2.5.
function descriptionLine(r) {
  const phase = r && r.movePhase;
  const dir = r && r.direction;
  const stage = moverStage(r);
  if (phase === 'exhaustion') {
    return 'Trend exhaustion at major level. Reversal risk rising.';
  }
  if (dir === 'Bullish') {
    if (phase === 'early') return `Multi-day breakout retested cleanly. Mover stage ${stage}.`;
    if (phase === 'mid')   return `Bullish structure intact, momentum expanding. Mover stage ${stage}.`;
    if (phase === 'late')  return `Mature uptrend. Late-entry risk rising.`;
  }
  if (dir === 'Bearish') {
    if (phase === 'early') return `Multi-day breakdown retested cleanly. Mover stage ${stage}.`;
    if (phase === 'mid')   return `Bearish pressure building, sellers in control. Mover stage ${stage}.`;
    if (phase === 'late')  return `Mature downtrend. Late-entry risk rising.`;
  }
  return `Sideways pressure, decision near. Mover stage ${stage}.`;
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

function buildBanner(promotedCount, nowMs) {
  const dateStr = _fmtUtcDate(nowMs);
  const scanStr = _fmtUtcStamp(nowMs);
  const candidateWord = promotedCount === 1 ? 'candidate promoted' : 'candidates promoted';
  return [
    '═══════════════════════════════════════════',
    '🐎 DARK HORSE — GLOBAL MOVER RADAR',
    `${dateStr} · ${promotedCount} ${candidateWord} · scan: ${scanStr}`,
    '═══════════════════════════════════════════',
    '',
    renderBracketedTerms(TERMINOLOGY_BANNER),
  ].join('\n');
}

// Between-candidate separator (Pack 2.4). Two blank lines either
// side baked into the content string.
const NEW_SEPARATOR = '\n\n─── NEW ───\n\n';

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

// ── EMBED BUILDER (Pack 2.2) ───────────────────────────────
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
  const fields = [
    { name: 'Move Type',  value: `${type} · Stage ${stage}`, inline: true },
    { name: 'Direction',  value: direction,                  inline: true },
    { name: 'Conviction', value: conviction,                 inline: true },
  ];
  if (trigger)    fields.push({ name: 'Trigger',     value: trigger,    inline: true });
  fields.push({ name: 'Timeframe', value: tf, inline: true });
  if (whereToAct) fields.push({ name: 'Where to Act', value: whereToAct, inline: false });
  fields.push({
    name: 'Terms',
    value: renderBracketedTerms(TERMINOLOGY_CANDIDATE),
    inline: false,
  });

  return {
    color: colour,
    title: `🐎 ${r.symbol} · ${badge}`,
    description: descriptionLine(r),
    fields,
    footer: { text: `Dark Horse Radar · scan ${scanStampUtc} · ${idx + 1}/${total} candidates` },
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

  if (promoted.length === 0) {
    // No promotable candidates → no FOH messages emitted.
    return {
      kind: 'movement_digest_foh_v1_0',
      messages: [],
      embedCount: 0,
      candidateCount: 0,
      filteredOut,
      linkRoutingStatus: 'pending',
    };
  }

  // Build the per-candidate embeds first so we know the total
  // for the "k/N candidates" footer.
  const embeds = promoted.map((r, i) => buildCandidateEmbed(r, i, promoted.length, scanStampUtc));

  // Bake the next-review timestamp into the LAST embed's footer
  // (Pack 1.7 spirit: information not actionable yet stays in
  // a footer rather than its own field).
  const nextReviewMs = Number.isFinite(opts.nextReviewMs)
    ? opts.nextReviewMs
    : nowMs + (Number.isFinite(opts.intervalMs) ? opts.intervalMs : 15 * 60 * 1000);
  const lastEmbed = embeds[embeds.length - 1];
  lastEmbed.footer = {
    text: `Dark Horse Radar · scan ${scanStampUtc} · ${promoted.length}/${promoted.length} candidates · next review ${_fmtUtcStamp(nextReviewMs)}`,
  };

  // Message 1: banner + first candidate embed.
  const banner = buildBanner(promoted.length, nowMs);
  messages.push({
    content: banner + NEW_SEPARATOR.replace(/^\n\n/, '\n\n'),
    embeds: [embeds[0]],
  });

  // Messages 2..N: separator + candidate embed.
  for (let i = 1; i < embeds.length; i++) {
    messages.push({
      content: NEW_SEPARATOR.trim(),  // "─── NEW ───" with surrounding blank handled by Discord
      embeds: [embeds[i]],
    });
  }

  return {
    kind: 'movement_digest_foh_v1_0',
    messages,
    embedCount: embeds.length,
    candidateCount: promoted.length,
    filteredOut,
    linkRoutingStatus: 'pending',
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
  NEW_SEPARATOR,
  DISCORD_EMBED_TOTAL_LIMIT,
  DISCORD_CONTENT_LIMIT,
};
