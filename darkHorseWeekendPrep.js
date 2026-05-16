/* eslint-disable */
'use strict';

// ============================================================
// darkHorseWeekendPrep.js — DARK HORSE — MONDAY OPEN PREP BRIEFING
//
// Pre-Dark-Horse preparation intelligence for weekends and the
// pre-reopen window. NOT a trade list, NOT execution authority.
// This module surfaces instruments that COULD become Dark Horses
// once live price confirms after market reopen or upcoming
// catalyst releases.
//
// Hard doctrine (operator brief, May 2026):
//   - Preparation intelligence only — live confirmation required
//     after market open.
//   - No Entry Zone language. No "buy / sell this Monday".
//     No "will go up / down". No raw BOS / CHoCH / "prints" /
//     "Trigger Level".
//   - Probability statements are hedged: "historically tends",
//     "favours", "expected pressure", "Corey leans".
//   - Move-range estimates are labelled by basis: historically
//     sourced / event-class historical / ATR-adjusted / scenario
//     estimate / insufficient evidence.
//   - User-facing transmission label is MARKET IMPACT; internal
//     symbols may keep "mechanism" terminology.
//
// Design boundary:
//   - This module READS from corey_calendar, corey_live_data,
//     darkHorseEngine, darkHorseRanking. It does NOT modify the
//     live Dark Horse scoring engine, scheduler cadence, or
//     symbol selection rules (Cursor's ATL-6 lane).
//   - Self-contained visual primitives mirror the Market Intel
//     v6 shell (gold banner, red NEW divider, disc bar, term
//     hyperlinks). No coupling to darkHorseFoh.js.
//   - The scheduler (start/stop) is env-gated by
//     DARK_HORSE_WEEKEND_PREP_ENABLED so it does NOT auto-post
//     unless explicitly enabled.
// ============================================================

const DH_PREP_GLOSSARY_URL = 'https://www.notion.so/35f51e90f20c81ffa44dd50835013a6a';

const DH_PREP_ESC = String.fromCharCode(27);
const DH_PREP_ANSI_RESET = DH_PREP_ESC + '[0m';
const DH_PREP_ANSI_GOLD  = DH_PREP_ESC + '[33;1m';

const DH_PREP_COLOR = Object.freeze({
  PREP_HEADER:   0xFAA61A, // gold
  MACRO_STATE:   0x5BC0DE, // cyan-blue — informational
  WATCHLIST:     0xE67E22, // amber — active risk building
  CANDIDATES:    0x9B59B6, // purple — preparation set
  GUIDANCE:      0x23A55A, // green — supportive / confirmation
  CANCEL:        0xED4245, // red — invalidation
});

// Discord limits — mirrored from the engine to keep this module
// independent of darkHorseFoh.js / darkHorseEngine.js exports.
const DH_PREP_DISCORD_CONTENT_LIMIT = 2000;
const DH_PREP_DISCORD_EMBED_TOTAL_LIMIT = 6000;

// Promotion rule shown on every event-exposed candidate. Hard
// doctrine: weekend prep is not execution authority.
const PROMOTION_RULE =
  'Promotion rule: can become a Dark Horse only after live price confirms post-reopen / post-release. Preparation intelligence only — live confirmation required after market open.';

// Wired modules (set via init). All read-only.
let _calendar = null;
let _coreyLive = null;
let _dhEngine = null;
let _dhRanking = null;

function init(opts) {
  if (opts && opts.calendarModule) _calendar = opts.calendarModule;
  if (opts && opts.coreyLiveModule) _coreyLive = opts.coreyLiveModule;
  if (opts && opts.darkHorseEngineModule) _dhEngine = opts.darkHorseEngineModule;
  if (opts && opts.darkHorseRankingModule) _dhRanking = opts.darkHorseRankingModule;
}

// ── VISUAL PRIMITIVES (self-contained, mirrors MI / FOH v6) ─

function _pad2(n) { return (n < 10 ? '0' : '') + n; }

function _fmtUtc(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  return d.getUTCFullYear() + '-' + _pad2(d.getUTCMonth() + 1) + '-' + _pad2(d.getUTCDate())
    + ' ' + _pad2(d.getUTCHours()) + ':' + _pad2(d.getUTCMinutes()) + ' UTC';
}

function _fmtAwst(ms) {
  const d = new Date((Number.isFinite(ms) ? ms : Date.now()) + 8 * 3600 * 1000);
  return _pad2(d.getUTCHours()) + ':' + _pad2(d.getUTCMinutes()) + ' AWST';
}

function _termLink(label, url) {
  return '[[' + label + ']](' + (url || DH_PREP_GLOSSARY_URL) + ')';
}

function _discScale(active, total, label, glyph) {
  total = Number.isFinite(total) ? total : 5;
  active = Math.max(0, Math.min(total, Number.isFinite(active) ? active : 0));
  const filled = glyph || '🟢';
  const dot = '⚫';
  return filled.repeat(active) + dot.repeat(total - active) + ' ' + active + '/' + total + (label ? ' — ' + label : '');
}

function _redNewDivider(nowMs) {
  const bar = '━'.repeat(50);
  const stamp = _fmtUtc(nowMs) + '   ·   ' + _fmtAwst(nowMs) + '   ·   MONDAY OPEN PREP';
  return [
    '```diff',
    '- ' + bar,
    '- ▼ ▼ ▼   N E W   D A R K   H O R S E   P R E P   B R I E F I N G   ▼ ▼ ▼',
    '- ' + bar,
    '-   🆕   ' + stamp + '   🆕',
    '- ' + bar,
    '```',
  ].join('\n');
}

function _giantBanner(text) {
  const inner = ' ' + text + ' ';
  const pad = Math.max(2, 60 - inner.length);
  return [
    '```ansi',
    DH_PREP_ANSI_GOLD + '╔' + '═'.repeat(60) + '╗' + DH_PREP_ANSI_RESET,
    DH_PREP_ANSI_GOLD + '║' + inner + ' '.repeat(pad) + '║' + DH_PREP_ANSI_RESET,
    DH_PREP_ANSI_GOLD + '╚' + '═'.repeat(60) + '╝' + DH_PREP_ANSI_RESET,
    '```',
  ].join('\n');
}

function _subheading(text) {
  return ['```ansi', DH_PREP_ANSI_GOLD + '▸  ' + text + DH_PREP_ANSI_RESET, '```'].join('\n');
}

// ── DATA READERS (safe-fail) ────────────────────────────────

function _readLiveContext() {
  try {
    const lc = _coreyLive && _coreyLive.getLiveContext && _coreyLive.getLiveContext();
    if (lc && lc.context) return { available: true, ctx: lc.context };
  } catch (_e) { /* safe-fail */ }
  return { available: false, ctx: {} };
}

function _readCalendarHealth() {
  try {
    const snap = _calendar && _calendar.getCalendarSnapshot && _calendar.getCalendarSnapshot();
    if (snap && snap.health) return { mode: snap.health.calendar_mode || 'UNAVAILABLE', source: snap.health.source_used || 'unavailable' };
  } catch (_e) { /* safe-fail */ }
  return { mode: 'UNAVAILABLE', source: 'unavailable' };
}

function _readUpcomingHighImpact(events, windowMs) {
  const now = Date.now();
  return (events || []).filter(e => {
    const t = e && (e.scheduled_time || e.time);
    if (!Number.isFinite(t)) return false;
    if (t < now || t > now + windowMs) return false;
    const imp = String(e.impact || '').toLowerCase();
    return imp === 'high';
  }).sort((a, b) => (a.scheduled_time || a.time) - (b.scheduled_time || b.time));
}

function _readDHCandidates() {
  try {
    const store = _dhEngine && _dhEngine.getDHInternalStore && _dhEngine.getDHInternalStore();
    if (!store) return [];
    return Array.from(store.values()).filter(Boolean);
  } catch (_e) { return []; }
}

// ── WEEKEND MARKET STATE ────────────────────────────────────

function _weekendState(nowMs) {
  const d = new Date(nowMs);
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
  const hourUtc = d.getUTCHours();
  // FX reopens Sun 22:00 UTC (Sydney open). Equities reopen Mon
  // 13:30 UTC (NYSE 09:30 ET). Crypto runs 24/7. We treat Friday
  // close (21:00 UTC) → Sunday 22:00 UTC as the FX gap.
  let phase = 'live';
  if (day === 6) phase = 'weekend-saturday';
  else if (day === 0 && hourUtc < 22) phase = 'weekend-sunday-pre-fx-open';
  else if (day === 0 && hourUtc >= 22) phase = 'sunday-fx-reopening';
  else if (day === 5 && hourUtc >= 21) phase = 'friday-post-close';
  else if (day === 1 && hourUtc < 13) phase = 'monday-pre-nyse';
  return { day, hourUtc, phase };
}

// ── MOVE-RANGE BASIS LABELS ─────────────────────────────────

function _moveRangeBasis(candidateCtx) {
  if (candidateCtx && candidateCtx.analogue) return 'historically sourced';
  if (candidateCtx && candidateCtx.eventClassHistory) return 'event-class historical reaction';
  if (candidateCtx && candidateCtx.atr) return 'ATR-adjusted';
  if (candidateCtx && candidateCtx.dataPresent === false) return 'insufficient evidence';
  return 'scenario estimate';
}

// Compute a wide-range "expected event move" estimate from a
// recent ATR proxy or fallback scenario heuristic. Returns
// `{ rangeLow, rangeHigh, unit, basis }`. Never claims precision
// beyond the basis we actually have.
function _expectedMoveRange(symbol, ctx) {
  const atr = ctx && Number.isFinite(ctx.atr) ? ctx.atr : null;
  if (atr) {
    return { rangeLow: atr * 0.6, rangeHigh: atr * 1.4, unit: 'price', basis: 'ATR-adjusted' };
  }
  if (/^XAU/.test(symbol))       return { rangeLow: 18, rangeHigh: 42, unit: '$/oz',  basis: 'scenario estimate' };
  if (/^XAG/.test(symbol))       return { rangeLow: 0.4, rangeHigh: 1.1, unit: '$/oz', basis: 'scenario estimate' };
  if (/JPY$/.test(symbol))       return { rangeLow: 45, rangeHigh: 110, unit: 'pips', basis: 'scenario estimate' };
  if (/^(EUR|GBP|AUD|NZD|USD)/.test(symbol) && symbol.length === 6)
                                 return { rangeLow: 35, rangeHigh: 95,  unit: 'pips', basis: 'scenario estimate' };
  if (/^(NAS100|US500|US30|DJI|GER40|UK100)/.test(symbol))
                                 return { rangeLow: 25, rangeHigh: 90,  unit: 'pts',  basis: 'scenario estimate' };
  return { rangeLow: 0, rangeHigh: 0, unit: 'n/a', basis: 'insufficient evidence' };
}

function _fmtRange(r) {
  if (!r || r.basis === 'insufficient evidence') return 'insufficient historical sample — direction read only (basis: insufficient evidence)';
  const lo = r.rangeLow.toFixed(r.unit === 'pips' || r.unit === 'pts' ? 0 : 2);
  const hi = r.rangeHigh.toFixed(r.unit === 'pips' || r.unit === 'pts' ? 0 : 2);
  return lo + '–' + hi + ' ' + r.unit + ' (basis: ' + r.basis + ')';
}

// ── EVENT TRANSMISSION (MARKET IMPACT) ──────────────────────

function _eventCategory(title) {
  const t = String(title || '').toLowerCase();
  if (/cpi|inflation|pce|ppi/.test(t)) return 'inflation';
  if (/payroll|unemploy|jobless|wages|jobs/.test(t)) return 'labour';
  if (/rate decision|interest rate|policy statement|fomc|ecb|boe|boj|rba|rbnz|monetary policy/.test(t)) return 'central-bank';
  if (/gdp|growth|industrial production/.test(t)) return 'growth';
  if (/retail sales|consumer spending/.test(t)) return 'consumer-demand';
  if (/pmi|ism/.test(t)) return 'activity';
  if (/tariff|sanction|conflict|geopolit/.test(t)) return 'geopolitical';
  return 'other';
}

function _eventExplanation(event) {
  const t = (event && event.title) || '';
  const ccy = (event && event.currency) || 'home currency';
  const cat = _eventCategory(t);
  if (cat === 'inflation') return t + ' = inflation reading for ' + ccy + '. It measures how fast prices are rising. Hotter-than-forecast readings historically tend to support ' + ccy + ' and yields (rates expected to stay higher for longer) while pressuring gold and risk indices. Cooler readings favour the reverse rotation.';
  if (cat === 'labour') return t + ' = labour-market reading for ' + ccy + '. Stronger data favours ' + ccy + ' via tighter central-bank policy expectations; weaker data favours the reverse.';
  if (cat === 'central-bank') return t + ' = central-bank decision / statement for ' + ccy + '. The lever is tone vs current market pricing — a hawkish lean supports ' + ccy + ', a dovish lean pressures it.';
  if (cat === 'growth') return t + ' = growth indicator for ' + ccy + '. Stronger readings historically tend to lift risk and ' + ccy + ' jointly when growth-pricing dominates; weaker readings invert the relationship.';
  if (cat === 'consumer-demand') return t + ' = consumer-demand reading for ' + ccy + '. Stronger consumer spending tends to support ' + ccy + ' through growth-pricing; weaker readings favour the reverse.';
  if (cat === 'activity') return t + ' = activity index for ' + ccy + '. Readings above 50 favour expansion (supportive for ' + ccy + ' and risk); below 50 favour contraction.';
  if (cat === 'geopolitical') return t + ' = geopolitical event. Historical reaction is safe-haven rotation: US Dollar Index (DXY), CHF, JPY, gold tend to bid while equities and credit fade.';
  return t + ' = scheduled macro release. Standard transmission: surprise → ' + ccy + ' repositions → correlated risk follows on the first HTF close.';
}

function _eventScenarioSplit(event) {
  const ccy = (event && event.currency) || 'home currency';
  return [
    '**Hotter / stronger than forecast** — expected pressure: supportive for ' + ccy + ' and yields. Pressured: gold, US indices, ' + ccy + '-funded high-beta equities. Supported: ' + ccy + ' against G10. (basis: scenario estimate)',
    '**Cooler / weaker than forecast** — expected pressure: fading ' + ccy + ' and yields. Supported: gold, US indices, ' + ccy + '-funded high-beta equities. Pressured: ' + ccy + ' against G10. (basis: scenario estimate)',
    '**In line / mixed** — muted, choppy reaction. Watch becomes valid only once price aligns through structure post-release. (basis: insufficient evidence)',
  ].join('\n');
}

function _eventTransmissionChain(event) {
  const ccy = (event && event.currency) || 'home currency';
  const cat = _eventCategory(event && event.title);
  if (cat === 'inflation') return 'cause: ' + ccy + ' inflation surprise vs forecast → expectation: rate-path repricing in the front end → market reaction: ' + ccy + ' and yields move first → asset impact: US Dollar Index (DXY) direction sets gold / US-index reaction.';
  if (cat === 'labour') return 'cause: ' + ccy + ' labour surprise vs forecast → expectation: central-bank reaction-function pricing → market reaction: short-end rates and ' + ccy + ' reposition → asset impact: rate-sensitive assets (gold, indices) follow on first HTF close.';
  if (cat === 'central-bank') return 'cause: tone vs current market pricing → expectation: rate-path lean shifts → market reaction: ' + ccy + ' repositions on tone, not headline → asset impact: cross-pair flow and rate-sensitive assets follow.';
  if (cat === 'growth') return 'cause: growth surprise vs forecast → expectation: terminal-rate expectations reset → market reaction: ' + ccy + ' and equity indices respond → asset impact: risk appetite shifts on the first HTF close.';
  if (cat === 'geopolitical') return 'cause: geopolitical shock event → expectation: safe-haven rotation → market reaction: US Dollar Index (DXY), CHF, JPY, gold bid → asset impact: equities and credit offered, vol indices lift.';
  return 'cause: surprise vs forecast → expectation: short-term rate-path repricing → market reaction: ' + ccy + ' moves first → asset impact: correlated risk follows on the first HTF close.';
}

// ── EVENT-EXPOSED CANDIDATE LIST ────────────────────────────
//
// Each candidate row carries:
//   - symbol
//   - why exposed (mapping the symbol → event category)
//   - expected pressure if hot / cool
//   - estimated move range (with basis label)
//   - Corey alignment (DXY / VIX / yield context)
//   - what confirms / what cancels
//   - first live scan window
//   - promotion rule

function _symbolsExposedTo(event) {
  const cat = _eventCategory(event && event.title);
  const ccy = String((event && event.currency) || '').toUpperCase();
  const out = new Set();
  if (cat === 'inflation' || cat === 'labour' || cat === 'central-bank' || cat === 'growth' || cat === 'consumer-demand' || cat === 'activity') {
    if (ccy === 'USD') ['EURUSD','GBPUSD','USDJPY','USDCAD','AUDUSD','XAUUSD','NAS100','US500','US30','NVDA','AMD','ASML','AAPL','MSFT'].forEach(s => out.add(s));
    if (ccy === 'EUR') ['EURUSD','EURGBP','EURJPY','EURAUD','GER40','UK100'].forEach(s => out.add(s));
    if (ccy === 'GBP') ['GBPUSD','EURGBP','GBPJPY','GBPAUD','UK100'].forEach(s => out.add(s));
    if (ccy === 'JPY') ['USDJPY','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY'].forEach(s => out.add(s));
    if (ccy === 'AUD' || ccy === 'NZD') ['AUDUSD','AUDJPY','EURAUD','GBPAUD','AUDCAD','AUDNZD','NZDUSD','NZDCAD'].forEach(s => out.add(s));
    if (ccy === 'CAD') ['USDCAD','AUDCAD','EURCAD','GBPCAD'].forEach(s => out.add(s));
  }
  if (cat === 'geopolitical') ['XAUUSD','USDJPY','USDCHF','NAS100','US500'].forEach(s => out.add(s));
  return Array.from(out);
}

function _coreyAlignment(ctx) {
  if (!ctx.available) return 'live macro unavailable';
  const dxy = (ctx.ctx.dxy && ctx.ctx.dxy.bias) || 'neutral';
  const vix = (ctx.ctx.vix && ctx.ctx.vix.level) || 'unavailable';
  const yld = (ctx.ctx.yield_ && ctx.ctx.yield_.regime) || (ctx.ctx.yield && ctx.ctx.yield.regime) || 'unavailable';
  return 'US Dollar Index (DXY) ' + dxy + ' · CBOE Volatility Index (VIX) ' + vix + ' · yield curve ' + yld;
}

function _buildExposedCandidate(symbol, event, liveCtx, scanWindow) {
  const ccy = (event && event.currency) || 'home currency';
  const cat = _eventCategory(event && event.title);
  // Decide expected-pressure narrative direction per symbol.
  // FX vs ccy + indices+gold inverse to yields is the simplest
  // useful model without faking precision.
  const isCcyBase = symbol.startsWith(String(ccy).toUpperCase());
  const isCcyQuote = symbol.endsWith(String(ccy).toUpperCase());
  let hotDir, coolDir;
  if (/^XAU/.test(symbol)) {
    hotDir = 'pressured (inverse to yields)';
    coolDir = 'supported (inverse to yields)';
  } else if (/^(NAS100|US500|US30|DJI|GER40|UK100)/.test(symbol)) {
    hotDir = 'pressured on a rate-path repricing';
    coolDir = 'supported on a rate-path repricing';
  } else if (isCcyBase) {
    hotDir = ccy + ' supported — pair favoured higher';
    coolDir = ccy + ' fades — pair favoured lower';
  } else if (isCcyQuote) {
    hotDir = ccy + ' supported — pair favoured lower';
    coolDir = ccy + ' fades — pair favoured higher';
  } else if (cat === 'geopolitical') {
    hotDir = /^USDCHF$|JPY$|CHF$|^XAU/.test(symbol) ? 'safe-haven bid' : 'risk-off pressured';
    coolDir = /^USDCHF$|JPY$|CHF$|^XAU/.test(symbol) ? 'safe-haven fade' : 'risk-on supported';
  } else {
    hotDir = 'follows correlated risk';
    coolDir = 'follows correlated risk inverse';
  }
  const range = _expectedMoveRange(symbol, null);
  const alignment = _coreyAlignment(liveCtx);
  return [
    '• **' + symbol + '** — exposed to ' + cat + ' read on ' + ccy + '.',
    '  Hot/strong release: ' + hotDir + '. Cool/weak release: ' + coolDir + '.',
    '  Expected event range: ' + _fmtRange(range) + '.',
    '  Corey alignment: ' + alignment + '.',
    '  Confirms after reopen: clean directional structure-break in the surprise direction on the 1H close AND cross-asset agreement.',
    '  Cancels: post-release impulse retraces fully within 30 min, lead pair and ' + ccy + '-sensitive risk disagree, or 1H closes back inside pre-release range.',
    '  First live scan window: ' + String(scanWindow).replace(/\.$/, '') + '.',
  ].join('\n');
}

function _firstScanWindow(symbol) {
  if (/^XAU|^XAG|^USOIL/.test(symbol)) return 'Asia open (Sun 22:00 UTC) — commodities run alongside FX.';
  if (/^(NAS100|US500|US30|DJI)/.test(symbol)) return 'NY premarket (Mon 12:00 UTC) → NY cash open (Mon 13:30 UTC).';
  if (/^(GER40|UK100)/.test(symbol)) return 'London open (Mon 07:00 UTC) → London cash (Mon 08:00 UTC).';
  if (symbol.length === 6 && /^(EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY)/.test(symbol)) return 'Asia open (Sun 22:00 UTC) → London open (Mon 07:00 UTC).';
  return 'NY premarket (Mon 12:00 UTC) → NY cash open (Mon 13:30 UTC).';
}

// ── MONDAY CONTINUATION / REVERSAL / HIGH-BETA SETS ────────

// Friday survivors — candidates from the live DH internal store
// that remained structurally relevant into Friday close. We pull
// from getDHInternalStore() and surface the top survivors by
// score. Read-only; never modifies engine state.
function _fridaySurvivors() {
  const all = _readDHCandidates();
  // The engine stores internal candidates from 5+; survivors are
  // those at score >= 6 (close to watch threshold). Sort desc.
  return all
    .filter(c => Number.isFinite(c && c.score) && c.score >= 6)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 6);
}

function _continuationCandidates(survivors) {
  // Continuation = direction held into close and historically
  // tends to persist on first 1H of new week. We surface the
  // survivors with directional confidence; promotion still
  // requires live confirmation after reopen.
  return survivors.filter(c => c && (c.direction === 'Bullish' || c.direction === 'Bearish')).slice(0, 5);
}

function _reversalCandidates(survivors) {
  // Reversal / gap-fade = extended into close with the highest
  // surface scores; historically more prone to fade open extension.
  // This is a list of "watch for fade", not a sell list.
  return survivors.filter(c => (c.score || 0) >= 7).slice(0, 5);
}

function _highBetaReopen(survivors) {
  // High-beta = equities + indices in the survivor set. These
  // are most likely to react strongly when liquidity returns.
  return survivors.filter(c => {
    const s = String((c && c.symbol) || '');
    return /^(NVDA|AMD|ASML|AAPL|MSFT|META|GOOGL|AMZN|TSLA|NAS100|US500|US30|DJI|GER40|UK100)$/.test(s);
  }).slice(0, 5);
}

function _renderCandidateRow(c) {
  if (!c || !c.symbol) return '';
  const dir = c.direction || 'unspecified';
  const score = Number.isFinite(c.score) ? (c.score + '/10') : '—';
  const range = _expectedMoveRange(c.symbol, null);
  return '• **' + c.symbol + '** · ' + dir + ' lean · internal score ' + score + ' · expected event range ' + _fmtRange(range);
}

function _renderCandidateList(list, emptyText) {
  if (!list || !list.length) return emptyText || 'No survivors at this watch tier — Corey leans no continuation read into reopen (basis: insufficient evidence).';
  return list.map(_renderCandidateRow).filter(Boolean).join('\n');
}

// ── BANNER + EMBED BUILDERS ─────────────────────────────────

function _bannerContent(nowMs) {
  const terms = [
    _termLink('Market Impact'),
    _termLink('Event-Exposed Watchlist'),
    _termLink('Promotion Rule'),
    _termLink('Move Range Basis'),
    _termLink('Corey Alignment'),
  ].join('  ·  ');
  return [
    _redNewDivider(nowMs),
    '',
    _giantBanner('🐎  DARK HORSE — MONDAY OPEN PREP BRIEFING'),
    '',
    '_Preparation intelligence only — live confirmation required after market open._',
    '',
    '📘 **EXPANDED TERMINOLOGY HYPERLINKS**',
    terms,
  ].join('\n');
}

function _macroStateEmbed(nowMs, liveCtx, weekendState, upcoming) {
  const moodActive = upcoming.length >= 3 ? 5 : upcoming.length >= 2 ? 4 : upcoming.length >= 1 ? 3 : 2;
  const moodGlyph = moodActive >= 5 ? '🔴' : moodActive >= 4 ? '🟠' : '🟡';
  const moodLabel = moodActive >= 5 ? 'EXTREME — multiple high-impact catalysts ahead' : moodActive >= 4 ? 'High — clustered catalyst exposure' : moodActive >= 3 ? 'Elevated — single high-impact catalyst' : 'Calm — no clustered high-impact catalyst';
  const phaseLabel = {
    'weekend-saturday': 'Saturday — markets closed, FX gap active',
    'weekend-sunday-pre-fx-open': 'Sunday pre-FX-open — preparation window',
    'sunday-fx-reopening': 'Sunday — FX reopening (Asia first)',
    'friday-post-close': 'Friday post-close — weekend gap building',
    'monday-pre-nyse': 'Monday pre-NYSE — Asia / London live, NY pending',
    'live': 'Live session — weekend prep mode is informational only',
  }[weekendState.phase] || 'Markets transitioning';
  const upcomingList = upcoming.slice(0, 5).map(e => {
    const t = e.scheduled_time || e.time;
    return '• ' + (e.title || 'untitled') + ' (' + (e.currency || 'multi-ccy') + ') — ' + _fmtUtc(t) + ' / ' + _fmtAwst(t);
  }).join('\n') || '• No clustered high-impact catalysts inside the prep window.';
  const transmission = upcoming.length
    ? _eventTransmissionChain(upcoming[0])
    : 'No dominant catalyst — driver-led tape on reopen; read cross-asset from the live macro state rather than from the calendar.';
  return {
    color: DH_PREP_COLOR.MACRO_STATE,
    title: '🌐  WEEKEND MARKET STATE · COREY MACRO',
    description: 'Weekend phase: **' + phaseLabel + '**. This briefing identifies instruments that *could become* Dark Horse candidates once live price confirms after market reopen — not active trade setups.',
    fields: [
      { name: 'WEEKEND MARKET STATE',
        value: 'Weekend phase: ' + phaseLabel + '.\nMonday Open Mood: ' + _discScale(moodActive, 5, moodLabel, moodGlyph),
        inline: false },
      { name: 'COREY MACRO STATE',
        value: liveCtx.available
          ? 'US Dollar Index (DXY): bias **' + (liveCtx.ctx.dxy && liveCtx.ctx.dxy.bias || 'neutral') + '** (level ' + ((liveCtx.ctx.dxy && liveCtx.ctx.dxy.level) || 'unavailable') + ')\nCBOE Volatility Index (VIX): level **' + ((liveCtx.ctx.vix && liveCtx.ctx.vix.level) || 'unavailable') + '**\nYield curve: regime **' + ((liveCtx.ctx.yield_ && liveCtx.ctx.yield_.regime) || (liveCtx.ctx.yield && liveCtx.ctx.yield.regime) || 'unavailable') + '**'
          : 'Live macro context unavailable — reading from event mechanics alone (basis: insufficient evidence).',
        inline: false },
      { name: 'UPCOMING EVENT EXPOSURE',
        value: upcomingList,
        inline: false },
      { name: 'EVENT TRANSMISSION MAP (MARKET IMPACT)',
        value: transmission,
        inline: false },
    ],
  };
}

function _watchlistEmbed(upcoming, liveCtx) {
  if (!upcoming.length) {
    return {
      color: DH_PREP_COLOR.WATCHLIST,
      title: '⚠️  EVENT-EXPOSED WATCHLIST',
      description: 'No high-impact catalyst inside the prep window. Watch is driver-led — Corey leans no event-exposed prep candidates (basis: insufficient evidence).\n\n_Scenario split: n/a — no clustered catalyst to split against (basis: insufficient evidence)._',
      fields: [
        { name: 'PROMOTION RULE',
          value: PROMOTION_RULE,
          inline: false },
      ],
    };
  }
  const event = upcoming[0];
  const exposed = _symbolsExposedTo(event).slice(0, 6);
  const rows = exposed.map(s => _buildExposedCandidate(s, event, liveCtx, _firstScanWindow(s)));
  return {
    color: DH_PREP_COLOR.WATCHLIST,
    title: '⚠️  EVENT-EXPOSED WATCHLIST · ' + (event.title || 'lead catalyst'),
    description: _eventExplanation(event) + '\n\n_Scenario split:_\n' + _eventScenarioSplit(event),
    fields: [
      { name: 'EVENT-EXPOSED CANDIDATES',
        value: rows.join('\n\n') || 'No symbols mapped to this catalyst — read cross-asset from the live macro tape.',
        inline: false },
      { name: 'PROMOTION RULE',
        value: PROMOTION_RULE,
        inline: false },
    ],
  };
}

function _candidatesEmbed() {
  const survivors = _fridaySurvivors();
  const continuation = _continuationCandidates(survivors);
  const reversal = _reversalCandidates(survivors);
  const highBeta = _highBetaReopen(survivors);
  return {
    color: DH_PREP_COLOR.CANDIDATES,
    title: '📊  FRIDAY SURVIVORS · CONTINUATION / REVERSAL / HIGH-BETA',
    description: 'Instruments from the live Dark Horse internal store that remained structurally relevant into Friday close. Surface only — promotion still requires live confirmation after reopen.',
    fields: [
      { name: 'MONDAY CONTINUATION CANDIDATES',
        value: _renderCandidateList(continuation, 'No continuation survivors — Corey leans driver-led tape on reopen (basis: insufficient evidence).'),
        inline: false },
      { name: 'MONDAY REVERSAL / GAP-FADE CANDIDATES',
        value: _renderCandidateList(reversal, 'No reversal / gap-fade survivors — no extended-close watch (basis: insufficient evidence).'),
        inline: false },
      { name: 'HIGH-BETA REOPEN WATCH',
        value: _renderCandidateList(highBeta, 'No high-beta survivors in the equity / index set (basis: insufficient evidence).'),
        inline: false },
    ],
  };
}

function _guidanceEmbed(sourceHealth) {
  return {
    color: DH_PREP_COLOR.GUIDANCE,
    title: '✅  OPERATOR GUIDANCE · CONFIRMATION & CANCELLATION · SCAN WINDOWS',
    description: 'Embedded operator guidance — confirmation gates, cancellation triggers, and first live scan windows for the prep set.',
    fields: [
      { name: 'CONFIRMATION NEEDED AFTER REOPEN',
        value: '• Live price must show a clean directional structure-break in the surprise direction on the 1H close.\n• Cross-asset agreement — lead pair, gold, indices, and Corey live macro must agree on direction.\n• Friday close structure must hold or be cleanly broken; gap-fills inside 30 min void the surprise read.',
        inline: false },
      { name: 'WHAT CANCELS THE WATCH',
        value: '• Post-release impulse retraces fully within 30 minutes — directional read is liquidity, not direction.\n• Lead pair and currency-sensitive risk disagree on direction — stand aside.\n• Competing catalyst overrides the release before structure forms.\n• 1H closes back inside the pre-release range — surprise bias voided entirely.',
        inline: false },
      { name: 'FIRST LIVE SCAN WINDOW',
        value: '• Asia open (Sun 22:00 UTC) — FX majors + crosses + commodities.\n• London open (Mon 07:00 UTC) — EUR / GBP pairs + EU indices.\n• NY premarket (Mon 12:00 UTC) — US indices + equities.\n• NY cash open (Mon 13:30 UTC) — full equity universe live.',
        inline: false },
      { name: 'PREPARATION-ONLY RISK NOTE',
        value: 'This briefing is preparation intelligence only. No execution authority, no fixed entry levels, no directional commitment for the new week. All directional language is hedged — "expected pressure", "favours", "historically tends", "Corey leans". Live confirmation is mandatory before any candidate can be promoted to a Dark Horse.',
        inline: false },
      { name: 'SOURCE / CONFIDENCE NOTE',
        value: 'Source: ' + (sourceHealth.source || 'unavailable') + ' (calendar_mode=' + (sourceHealth.mode || 'UNAVAILABLE') + '). Live macro: ' + (sourceHealth.liveOk ? 'wired' : 'unavailable') + '. Probability basis: scenario estimate unless labelled historically sourced / event-class historical / ATR-adjusted / insufficient evidence. Move-range estimates do not claim precision beyond the basis attached to each row.',
        inline: false },
    ],
  };
}

// ── PUBLIC PAYLOAD BUILDER ──────────────────────────────────

function buildDarkHorseWeekendPrepPayload(opts) {
  const nowMs = (opts && Number.isFinite(opts.now)) ? opts.now : Date.now();
  const fixtureEvents = opts && Array.isArray(opts.upcomingEvents) ? opts.upcomingEvents : null;
  const fixtureLive   = opts && opts.liveContext ? { available: true, ctx: opts.liveContext } : null;
  // Live readers fall back to fixture data when wired modules are
  // missing — keeps the staging script offline-safe.
  let upcomingHigh;
  if (fixtureEvents) {
    upcomingHigh = _readUpcomingHighImpact(fixtureEvents, 4 * 24 * 60 * 60 * 1000);
  } else {
    let events = [];
    try {
      events = (_calendar && _calendar.getUpcomingEvents && _calendar.getUpcomingEvents('BROAD_MARKET')) || [];
    } catch (_e) { events = []; }
    upcomingHigh = _readUpcomingHighImpact(events, 4 * 24 * 60 * 60 * 1000);
  }
  const liveCtx = fixtureLive || _readLiveContext();
  const calHealth = _readCalendarHealth();
  const sourceHealth = { mode: calHealth.mode, source: calHealth.source, liveOk: liveCtx.available };
  const weekendState = _weekendState(nowMs);

  const content = _bannerContent(nowMs);
  const embeds = [
    _macroStateEmbed(nowMs, liveCtx, weekendState, upcomingHigh),
    _watchlistEmbed(upcomingHigh, liveCtx),
    _candidatesEmbed(),
    _guidanceEmbed(sourceHealth),
  ];
  return { content, embeds, kind: 'dark-horse-weekend-prep' };
}

// ── EMBED SIZE VALIDATION ───────────────────────────────────

function measurePayload(payload) {
  const contentLen = String((payload && payload.content) || '').length;
  const embedTotals = (payload && Array.isArray(payload.embeds) ? payload.embeds : []).map(e => {
    let t = 0;
    if (e.title) t += String(e.title).length;
    if (e.description) t += String(e.description).length;
    if (Array.isArray(e.fields)) for (const f of e.fields) {
      if (f && f.name) t += String(f.name).length;
      if (f && f.value) t += String(f.value).length;
    }
    if (e.footer && e.footer.text) t += String(e.footer.text).length;
    return t;
  });
  return { contentLen, embedTotals };
}

// ── SCHEDULER (env-gated, off by default) ───────────────────

let _timer = null;
function start() {
  if (process.env.DARK_HORSE_WEEKEND_PREP_ENABLED !== 'true') {
    return { started: false, reason: 'DARK_HORSE_WEEKEND_PREP_ENABLED!=true' };
  }
  const webhookUrl = process.env.DARK_HORSE_WEEKEND_PREP_WEBHOOK || '';
  if (!webhookUrl) {
    return { started: false, reason: 'DARK_HORSE_WEEKEND_PREP_WEBHOOK not set' };
  }
  // Configured post hour (UTC). Defaults to 12:00 UTC Saturday.
  // Hard cadence: tick once per hour, post when within
  // ±30 min of the configured target on Saturday only.
  const tickMs = 60 * 60 * 1000;
  if (_timer) return { started: false, reason: 'already running' };
  _timer = setInterval(tick, tickMs);
  return { started: true };
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  return { stopped: true };
}

let _lastPostedAt = 0;
async function tick() {
  if (process.env.DARK_HORSE_WEEKEND_PREP_ENABLED !== 'true') return { posted: false, reason: 'disabled' };
  const webhookUrl = process.env.DARK_HORSE_WEEKEND_PREP_WEBHOOK || '';
  if (!webhookUrl) return { posted: false, reason: 'no webhook url' };
  const targetHour = Number.parseInt(process.env.DARK_HORSE_WEEKEND_PREP_TIME_UTC || '12', 10);
  const now = new Date();
  if (now.getUTCDay() !== 6) return { posted: false, reason: 'not Saturday' };
  if (now.getUTCHours() !== targetHour) return { posted: false, reason: 'not target hour' };
  if (Date.now() - _lastPostedAt < 23 * 60 * 60 * 1000) return { posted: false, reason: 'already posted today' };
  const payload = buildDarkHorseWeekendPrepPayload({});
  try {
    const res = await sendWebhook(webhookUrl, payload);
    if (res && res.ok) { _lastPostedAt = Date.now(); return { posted: true, status: res.status }; }
    return { posted: false, reason: 'webhook status ' + (res && res.status) };
  } catch (e) {
    return { posted: false, reason: 'webhook error: ' + e.message };
  }
}

async function sendWebhook(url, payload) {
  if (!url || typeof fetch !== 'function') return { ok: false, status: 0 };
  const body = JSON.stringify({ content: payload.content, embeds: payload.embeds });
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

// ── EXPORTS ─────────────────────────────────────────────────

module.exports = {
  init,
  buildDarkHorseWeekendPrepPayload,
  measurePayload,
  start, stop, tick,
  sendWebhook,
  DH_PREP_COLOR,
  DH_PREP_DISCORD_CONTENT_LIMIT,
  DH_PREP_DISCORD_EMBED_TOTAL_LIMIT,
  PROMOTION_RULE,
};
