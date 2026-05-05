'use strict';
// ============================================================
// ATLAS FX — DARK HORSE ENGINE v2.0
// Scan layer only. No trades. No execution. No Jane bypass.
// Flow: DarkHorse → FX Bot → Corey → Spidey → Jane
// Crypto permanently excluded per ATLAS FX doctrine.
// Output: single strongest trending instrument per scan.
// ============================================================

const https = require('https');
const fomo  = require('./darkHorseFomoControl');
const intel = require('./darkHorseIntelligence');

// ── UNIVERSE ──────────────────────────────────────────────────
// Full institutional universe — FX, indices, equities, commodities.
// Crypto excluded permanently — zero exceptions.
//
// v1.1: expanded to cover the full global mover radar mandate.
// JPN225 + AUS200 added to the index group; USOIL kept off the
// commodity group until the FMP/TwelveData free-tier coverage is
// re-validated (BRENT remains banned per CLAUDE.md). Symbols that
// the live OHLC layer cannot resolve are filtered automatically by
// scoreInstrument (insufficient data → skipped, not faked).
const DEFAULT_UNIVERSE = [
  // FX Majors
  'EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD',

  // FX Crosses
  'EURGBP','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY','EURAUD',
  'EURCAD','GBPAUD','GBPCAD','GBPCHF','AUDCAD','AUDNZD','NZDCAD',

  // Indices (global)
  'NAS100','US500','DJI','GER40','UK100','JPN225','AUS200',

  // Equities (US momentum / mega-caps)
  'NVDA','AMD','ASML','AAPL','MSFT','META','GOOGL','AMZN','TSLA',

  // Commodities (safety / inflation)
  'XAUUSD','XAGUSD'
];

const DH_UNIVERSE = DEFAULT_UNIVERSE;

// Crypto exclusion filter — applied before every scan
const CRYPTO_BANNED = new Set([
  'BTC','ETH','XRP','SOL','DOGE','ADA','BNB','DOT','MATIC','AVAX',
  'LINK','LTC','BCH','XLM','ALGO','ATOM','VET','ICP','USDT','USDC',
  'SHIB','PEPE','BITCOIN','ETHEREUM','CRYPTO',
]);

function isCryptoBanned(symbol) {
  const s = symbol.toUpperCase();
  for (const kw of CRYPTO_BANNED) {
    if (s.includes(kw)) return true;
  }
  return false;
}

// ── THRESHOLDS ────────────────────────────────────────────────
const DH_SCORE_WATCH    = 8;  // ≥8 → post to Discord + trigger pipeline
const DH_SCORE_INTERNAL = 5;  // 5–7 → store internally only

// ── WEBHOOK ───────────────────────────────────────────────────
// Webhook URL resolution — prefer the clearer per-channel env key
// `WEEKLY_DARKHORSES` (display name + channel: WEEKLY_DARKHORSES /
// #weekly_darkhorses) and fall back to the legacy `DARKHORSE_STOCK`
// for backwards compatibility while the rename is in flight on Render.
//
// SECURITY: never log the URL itself or any substring. Only the
// resolved env key name is logged via [DH-CHANNEL] env_key=...
const DH_WEBHOOK_URL =
  process.env.WEEKLY_DARKHORSES ||
  process.env.DARKHORSE_STOCK   ||
  null;
const DH_WEBHOOK_ENV_KEY =
  process.env.WEEKLY_DARKHORSES ? 'WEEKLY_DARKHORSES'
  : process.env.DARKHORSE_STOCK ? 'DARKHORSE_STOCK'
  : 'missing';
const DH_TARGET_CHANNEL = 'weekly_darkhorses';

// ── MARKET HOURS GATE ─────────────────────────────────────────
function isMarketOpen() {
  const now    = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day    = nyTime.getDay();
  const mins   = nyTime.getHours() * 60 + nyTime.getMinutes();
  if (day === 5 && mins >= 17 * 60) return false;
  if (day === 6) return false;
  if (day === 0 && mins < 17 * 60) return false;
  return true;
}

// ── STATE ─────────────────────────────────────────────────────
const DH_INTERNAL_STORE = new Map();
let _lastMovementDigestAt = 0;   // FOMO control — cooldown tracker
const dhLog = (level, msg, ...a) =>
  console.log(`[${new Date().toISOString()}] [DH-${level}] ${msg}`, ...a);

// Boot-time channel resolution log — emitted once per process so the
// operator can confirm which env var resolved without exposing any URL.
dhLog('INFO', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL}`);

// ── INIT ──────────────────────────────────────────────────────
let _safeOHLC       = null;
let _pipelineTrigger = null;

function dhInit(safeOHLCFn) {
  _safeOHLC = safeOHLCFn;
  dhLog('INFO', 'Dark Horse Engine v2.0 initialised.');
}

function dhSetPipelineTrigger(fn) {
  _pipelineTrigger = fn;
  dhLog('INFO', 'Pipeline trigger registered.');
}

async function dhFetchCandles(symbol, interval, count = 100) {
  if (!_safeOHLC) return null;
  return _safeOHLC(symbol, interval, count);
}

// ============================================================
// SCORING MODEL v2 — 5 criteria × 2pts = 10 max
// Per Astro work order: structure, momentum, breakout,
// cleanliness, continuation probability
// ============================================================

// 1. STRUCTURE STRENGTH (0–2)
// Higher highs / higher lows = bullish structure
// Lower highs / lower lows = bearish structure
function scoreStructure(candles) {
  if (!candles || candles.length < 20) return { score: 0, direction: null, reason: null };

  const recent = candles.slice(-15);
  let hhCount = 0, hlCount = 0, lhCount = 0, llCount = 0;

  for (let i = 1; i < recent.length; i++) {
    if (recent[i].high > recent[i - 1].high) hhCount++;
    if (recent[i].low  > recent[i - 1].low)  hlCount++;
    if (recent[i].high < recent[i - 1].high) lhCount++;
    if (recent[i].low  < recent[i - 1].low)  llCount++;
  }

  const bullScore = (hhCount + hlCount) / (recent.length - 1);
  const bearScore = (lhCount + llCount) / (recent.length - 1);

  if (bullScore >= 0.65) {
    return { score: 2, direction: 'Bullish', reason: `HH/HL structure confirmed (${(bullScore * 100).toFixed(0)}% bullish bars)` };
  }
  if (bearScore >= 0.65) {
    return { score: 2, direction: 'Bearish', reason: `LH/LL structure confirmed (${(bearScore * 100).toFixed(0)}% bearish bars)` };
  }
  if (bullScore >= 0.50) {
    return { score: 1, direction: 'Bullish', reason: `Developing bullish structure (${(bullScore * 100).toFixed(0)}%)` };
  }
  if (bearScore >= 0.50) {
    return { score: 1, direction: 'Bearish', reason: `Developing bearish structure (${(bearScore * 100).toFixed(0)}%)` };
  }

  return { score: 0, direction: null, reason: null };
}

// 2. MOMENTUM STRENGTH (0–2)
// Expanding range + directional candle bodies = momentum
function scoreMomentum(candles) {
  if (!candles || candles.length < 10) return { score: 0, direction: null, reason: null };

  const recent   = candles.slice(-5);
  const baseline = candles.slice(-20, -5);

  const avgBody = arr =>
    arr.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / arr.length;

  const recentBody   = avgBody(recent);
  const baselineBody = avgBody(baseline);

  const bullBars = recent.filter(c => c.close > c.open).length;
  const bearBars = recent.filter(c => c.close < c.open).length;

  const expanding = baselineBody > 0 && recentBody / baselineBody > 1.3;

  if (expanding && bullBars >= 4) {
    return { score: 2, direction: 'Bullish', reason: `Momentum expanding — bullish body ${(recentBody / baselineBody * 100).toFixed(0)}% of baseline` };
  }
  if (expanding && bearBars >= 4) {
    return { score: 2, direction: 'Bearish', reason: `Momentum expanding — bearish body ${(recentBody / baselineBody * 100).toFixed(0)}% of baseline` };
  }
  if (bullBars >= 4) {
    return { score: 1, direction: 'Bullish', reason: `Directional bullish momentum (${bullBars}/5 bull bars)` };
  }
  if (bearBars >= 4) {
    return { score: 1, direction: 'Bearish', reason: `Directional bearish momentum (${bearBars}/5 bear bars)` };
  }

  return { score: 0, direction: null, reason: null };
}

// 3. BREAKOUT QUALITY (0–2)
// Clean breakout from consolidation with body close beyond level
function scoreBreakout(candles) {
  if (!candles || candles.length < 30) return { score: 0, direction: null, reason: null };

  const consolidation = candles.slice(-20, -5);
  const breakoutZone  = candles.slice(-5);

  const consHigh = Math.max(...consolidation.map(c => c.high));
  const consLow  = Math.min(...consolidation.map(c => c.low));
  const consRange = consHigh - consLow;

  // Tight consolidation (range < 0.6% of price)
  const cp = candles[candles.length - 1].close;
  if (consRange / cp > 0.006) return { score: 0, direction: null, reason: null };

  const lastClose  = breakoutZone[breakoutZone.length - 1].close;
  const closeAbove = lastClose > consHigh;
  const closeBelow = lastClose < consLow;

  // Body close beyond consolidation = clean breakout
  if (closeAbove) {
    return { score: 2, direction: 'Bullish', reason: `Clean bullish breakout — closed above consolidation high (${consHigh.toFixed(5)})` };
  }
  if (closeBelow) {
    return { score: 2, direction: 'Bearish', reason: `Clean bearish breakout — closed below consolidation low (${consLow.toFixed(5)})` };
  }

  // Approaching breakout
  const distHigh = Math.abs(lastClose - consHigh) / cp;
  const distLow  = Math.abs(lastClose - consLow)  / cp;
  if (distHigh < 0.002) {
    return { score: 1, direction: 'Bullish', reason: `Approaching consolidation high — breakout setup forming` };
  }
  if (distLow < 0.002) {
    return { score: 1, direction: 'Bearish', reason: `Approaching consolidation low — breakdown setup forming` };
  }

  return { score: 0, direction: null, reason: null };
}

// 4. TREND CLEANLINESS (0–2)
// Low chop = directional movement without excessive retracement
function scoreCleanliness(candles) {
  if (!candles || candles.length < 20) return { score: 0, direction: null, reason: null };

  const recent = candles.slice(-20);
  const cp     = recent[recent.length - 1].close;
  const start  = recent[0].close;

  // Net directional move
  const netMove    = cp - start;
  const totalRange = recent.reduce((s, c) => s + (c.high - c.low), 0);

  // Efficiency ratio — net move vs total path travelled
  const efficiency = totalRange > 0 ? Math.abs(netMove) / totalRange : 0;

  if (efficiency >= 0.45) {
    const dir = netMove > 0 ? 'Bullish' : 'Bearish';
    return { score: 2, direction: dir, reason: `Clean trend — efficiency ratio ${(efficiency * 100).toFixed(0)}% (low chop, directional movement)` };
  }
  if (efficiency >= 0.30) {
    const dir = netMove > 0 ? 'Bullish' : 'Bearish';
    return { score: 1, direction: dir, reason: `Moderate trend cleanliness — efficiency ${(efficiency * 100).toFixed(0)}%` };
  }

  return { score: 0, direction: null, reason: null };
}

// 5. CONTINUATION PROBABILITY (0–2)
// Multi-timeframe alignment + recent acceleration
function scoreContinuation(htfCandles, ltfCandles) {
  if (!htfCandles || !ltfCandles || htfCandles.length < 10 || ltfCandles.length < 10)
    return { score: 0, direction: null, reason: null };

  const htfEnd   = htfCandles[htfCandles.length - 1].close;
  const htfStart = htfCandles[htfCandles.length - 10].close;
  const ltfEnd   = ltfCandles[ltfCandles.length - 1].close;
  const ltfStart = ltfCandles[ltfCandles.length - 10].close;

  const htfDir = htfEnd > htfStart ? 'Bullish' : 'Bearish';
  const ltfDir = ltfEnd > ltfStart ? 'Bullish' : 'Bearish';

  // Check recent acceleration — last 3 candles vs prior 7
  const recent3  = ltfCandles.slice(-3);
  const prior7   = ltfCandles.slice(-10, -3);
  const avgRecent = recent3.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 3;
  const avgPrior  = prior7.reduce((s, c) => s + Math.abs(c.close - c.open), 0)  / 7;
  const accelerating = avgPrior > 0 && avgRecent / avgPrior > 1.4;

  if (htfDir === ltfDir && accelerating) {
    return { score: 2, direction: htfDir, reason: `MTF aligned ${htfDir} with recent acceleration (LTF momentum ${(avgRecent / avgPrior * 100).toFixed(0)}% of baseline)` };
  }
  if (htfDir === ltfDir) {
    return { score: 1, direction: htfDir, reason: `HTF and LTF aligned ${htfDir} — continuation probable` };
  }

  return { score: 0, direction: null, reason: null };
}

// ============================================================
// SCORE SINGLE INSTRUMENT
// ============================================================
async function scoreInstrument(symbol) {
  if (isCryptoBanned(symbol)) {
    dhLog('WARN', `${symbol} — CRYPTO BANNED, skipping`);
    return null;
  }

  dhLog('INFO', `Scoring ${symbol}`);

  const [htf, ltf] = await Promise.all([
    dhFetchCandles(symbol, '1D', 100),
    dhFetchCandles(symbol, '60', 50),
  ]);

  if (!htf || htf.length < 20) {
    dhLog('WARN', `${symbol} — insufficient data, skipping`);
    return null;
  }

  const struct = scoreStructure(htf);
  const mom    = scoreMomentum(htf);
  const brk    = scoreBreakout(htf);
  const clean  = scoreCleanliness(htf);
  const cont   = scoreContinuation(htf, ltf);

  const total = struct.score + mom.score + brk.score + clean.score + cont.score;

  // Determine dominant direction from scoring criteria
  const dirVotes = [struct.direction, mom.direction, brk.direction, clean.direction, cont.direction]
    .filter(Boolean);
  const bullVotes = dirVotes.filter(d => d === 'Bullish').length;
  const bearVotes = dirVotes.filter(d => d === 'Bearish').length;
  const direction = bullVotes > bearVotes ? 'Bullish' : bearVotes > bullVotes ? 'Bearish' : null;

  // Collect triggered reasons
  const reasons = [struct, mom, brk, clean, cont]
    .filter(r => r.score > 0 && r.reason)
    .map(r => r.reason);

  // Build concise one-line summary for Dark Horse output
  const summary = buildSummaryLine(struct, mom, brk, clean, cont, direction);

  dhLog('INFO', `${symbol} → ${total}/10 ${direction || 'Neutral'}`);

  return {
    symbol,
    score:     total,
    direction,
    summary,
    reasons,
    status:    total >= DH_SCORE_WATCH ? 'WATCH' : total >= DH_SCORE_INTERNAL ? 'INTERNAL' : 'IGNORED',
    currentPrice: htf[htf.length - 1].close,
    timestamp: Date.now(),
    // v1.1: hand component objects + raw OHLC slices to the intelligence
    // layer so the enricher can compute move-age / phase / structure
    // detail without re-fetching candles. Internal use only.
    _components: { struct, mom, brk, clean, cont },
    _htf:        htf,
    _ltf:        ltf
  };
}

// Build one concise summary line for output
function buildSummaryLine(struct, mom, brk, clean, cont, direction) {
  if (brk.score === 2 && mom.score === 2) return `Clean breakout continuation with strong momentum`;
  if (brk.score === 2 && struct.score === 2) return `Clean breakout from ${direction === 'Bullish' ? 'bullish' : 'bearish'} structure`;
  if (struct.score === 2 && cont.score === 2) return `Strong trend acceleration with sustained ${direction === 'Bullish' ? 'higher highs' : 'lower lows'}`;
  if (clean.score === 2 && mom.score >= 1) return `High-efficiency directional move with expanding momentum`;
  if (cont.score === 2) return `Multi-timeframe ${direction === 'Bullish' ? 'bullish' : 'bearish'} alignment with acceleration`;
  if (struct.score === 2) return `Strong ${direction === 'Bullish' ? 'bullish' : 'bearish'} structure with HH/HL sequence confirmed`;
  if (mom.score === 2) return `Momentum expansion — ${direction === 'Bullish' ? 'bullish' : 'bearish'} continuation developing`;
  if (brk.score >= 1) return `Breakout setup forming — ${direction === 'Bullish' ? 'bullish' : 'bearish'} continuation likely`;
  return `Composite score threshold met — ${direction === 'Bullish' ? 'bullish' : 'bearish'} trend developing`;
}

// ============================================================
// WEBHOOK DELIVERY
// ============================================================
function dhSendWebhook(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    if (!webhookUrl) { resolve(null); return; }
    const body = JSON.stringify(payload);
    const url  = new URL(webhookUrl);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'ATLAS-FX-DarkHorse/2.0' },
      timeout:  10000,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error',   reject);
    req.on('timeout', () => reject(new Error('Webhook timeout')));
    req.write(body);
    req.end();
  });
}

// ── OUTPUT FORMAT (per Astro work order) ──────────────────────
// 🐎 DARK HORSE
// [SYMBOL] ↑ or ↓
// Short reason describing trend strength
// Confidence: X/10
// + FOMO control: caution line + advisory trailer appended.
function buildDHPayload(candidate) {
  const arrow = candidate.direction === 'Bullish' ? '↑' : candidate.direction === 'Bearish' ? '↓' : '→';

  const content =
    `🐎 **DARK HORSE — WATCH CANDIDATE (advisory only)**\n` +
    `**${candidate.symbol}** ${arrow}\n` +
    `${candidate.summary}\n` +
    `Confidence: ${candidate.score}/10\n\n` +
    `Scan flag only — full ATLAS confirmation path remains: Corey → Spidey → Jane.`;

  return { content };
}

function buildAstraPayload(candidate) {
  const arrow = candidate.direction === 'Bullish' ? '↑' : candidate.direction === 'Bearish' ? '↓' : '→';

  const reasonLines = candidate.reasons.length
    ? candidate.reasons.map(r => `- ${r}`).join('\n')
    : '- Composite score threshold met';

  const content =
    `🐎 **DARK HORSE — PIPELINE FLAG**\n\n` +
    `**${candidate.symbol}** ${arrow}\n` +
    `${candidate.summary}\n` +
    `Confidence: ${candidate.score}/10\n\n` +
    `**Triggered criteria:**\n${reasonLines}\n\n` +
    `**darkHorseFlag:** \`true\`\n` +
    `Jane retains final authority.`;

  return { content };
}

// ============================================================
// PIPELINE TRIGGER
// ============================================================
async function triggerPipeline(candidate) {
  if (!_pipelineTrigger) {
    dhLog('WARN', `Pipeline trigger not set — ${candidate.symbol} skipped`);
    return;
  }
  dhLog('INFO', `Pipeline trigger → ${candidate.symbol} (score: ${candidate.score}/10)`);
  try {
    await _pipelineTrigger(candidate.symbol, {
      darkHorseFlag: true,
      dhScore:       candidate.score,
      dhReasons:     candidate.reasons,
    });
  } catch (e) {
    dhLog('ERROR', `Pipeline trigger failed for ${candidate.symbol}: ${e.message}`);
  }
}

// ============================================================
// MAIN SCAN
// Returns: single strongest instrument (highest score) + FOMO
// movement digest when WATCH:0 and volatility is elevated.
//
// Backward-compatible call shapes:
//   runDarkHorseScan()                  — default universe
//   runDarkHorseScan([symbols...])      — explicit universe
//   runDarkHorseScan({ universe, vixLevel }) — explicit + VIX hint
// ============================================================
async function runDarkHorseScan(universeOrOpts) {
  // Normalise input
  let universe = null;
  let vixLevel = null;
  if (Array.isArray(universeOrOpts)) {
    universe = universeOrOpts;
  } else if (universeOrOpts && typeof universeOrOpts === 'object') {
    universe = universeOrOpts.universe || null;
    vixLevel = universeOrOpts.vixLevel || null;
  }

  if (!isMarketOpen()) {
    dhLog('INFO', '━━━ Scan SKIPPED — market closed (weekend / outside US session) ━━━');
    return {
      watch: [], internal: [], ignored: [],
      scannedAt: new Date().toISOString(),
      skipped: true,
      skipReason: 'outside_market_hours'
    };
  }

  // Apply crypto ban to universe
  const symbols = ((universe && universe.length) ? universe : DH_UNIVERSE)
    .filter(s => !isCryptoBanned(s));

  dhLog('INFO', `━━━ Scan START — ${symbols.length} instruments ━━━`);

  const results = [];

  for (const symbol of symbols) {
    try {
      const r = await scoreInstrument(symbol);
      if (r) results.push(r);
    } catch (e) {
      dhLog('ERROR', `Score error for ${symbol}: ${e.message}`);
    }
  }

  // Sort by score descending — best opportunity first
  results.sort((a, b) => b.score - a.score);

  const watch    = results.filter(r => r.score >= DH_SCORE_WATCH);
  const internal = results.filter(r => r.score >= DH_SCORE_INTERNAL && r.score < DH_SCORE_WATCH);
  const ignored  = results.filter(r => r.score < DH_SCORE_INTERNAL);

  dhLog('INFO', `━━━ Scan COMPLETE — WATCH:${watch.length} INTERNAL:${internal.length} IGNORED:${ignored.length} ━━━`);

  // Store internal candidates — no Discord output
  for (const r of internal) {
    DH_INTERNAL_STORE.set(r.symbol, { score: r.score, direction: r.direction, reasons: r.reasons, timestamp: r.timestamp });
    dhLog('INFO', `[INTERNAL] ${r.symbol} ${r.score}/10 — stored`);
  }

  // ── FOMO CONTROL — assess volatility from this scan ──
  const allResults = [...watch, ...internal, ...ignored];
  const volatility = fomo.assessVolatility(allResults, vixLevel);
  dhLog('INFO', `[FOMO-ASSESS] level=${volatility.level} watch=${volatility.watchCount} ` +
                `internal=${volatility.internalCount} avgInternal=${volatility.avgInternalScore} ` +
                `vix=${volatility.vixLevel || 'n/a'} reason=${volatility.reason}`);

  // ── v1.1 GLOBAL MOVER INTELLIGENCE ENRICHMENT ───────────────
  // Convert raw scoring records into intelligence-rich candidate
  // objects (section, move age/phase, structure detail, cause, etc).
  // Then rank globally with section caps so the digest shows true
  // cross-market coverage rather than one-section saturation.
  const corey = (universeOrOpts && typeof universeOrOpts === 'object') ? (universeOrOpts.corey || null) : null;
  const calendarHealth = (universeOrOpts && typeof universeOrOpts === 'object') ? (universeOrOpts.calendarHealth || null) : null;

  // Rank candidates by score across the WATCH + INTERNAL pool. We
  // exclude IGNORED from the digest top-10 because they explicitly
  // sit below the radar threshold.
  const rankablePool = [...watch, ...internal];
  const enriched = rankablePool
    .filter(r => r && r._components && r._htf)
    .map(r => intel.enrichCandidate({
      candidate:      r,
      htf:            r._htf,
      ltf:            r._ltf,
      components:     r._components,
      corey,
      watchThreshold: DH_SCORE_WATCH
    }));
  const ranked = intel.rankWithSectionCaps(enriched, { max: 10, capPerSection: 3 });

  // ── [DH-RANKING] structured logs per spec ──
  const sectionsScanned = Object.keys(ranked.bySection || {});
  const top10Symbols    = ranked.top.map(c => c.symbol);
  dhLog('INFO', `[DH-RANKING] universe_size=${symbols.length}`);
  dhLog('INFO', `[DH-RANKING] sections_scanned=${sectionsScanned.join(',') || 'none'}`);
  dhLog('INFO', `[DH-RANKING] top10=${top10Symbols.join(',') || 'none'}`);
  dhLog('INFO', `[DH-RANKING] section_caps_applied=${ranked.sectionCapsApplied}`);
  // ── [DH-CANDIDATE] per-candidate intelligence log ──
  for (const e of ranked.top) {
    const f = intel.buildCandidateLogFields(e);
    dhLog('INFO',
      `[DH-CANDIDATE] symbol=${f.symbol} section=${f.section} score=${f.score} ` +
      `direction=${f.direction} move_strength=${f.move_strength} move_speed=${f.move_speed} ` +
      `move_age=${f.move_age} move_phase=${f.move_phase} relative_strength=${f.relative_strength} ` +
      `structure_state=${f.structure_state} continuation_window="${f.continuation_window}" ` +
      `late_entry_risk=${f.late_entry_risk} why_not_watch="${f.why_not_watch}" ` +
      `promotion_trigger="${f.promotion_trigger}"`);
  }

  // WATCH — post SINGLE STRONGEST only (highest score). v1.1 payload
  // carries the full intelligence block per spec.
  if (watch.length > 0) {
    const best = watch[0]; // already sorted by score desc
    const bestEnriched = ranked.top.find(c => c.symbol === best.symbol)
      || (enriched.find(c => c.symbol === best.symbol) || null);
    dhLog('INFO', `[WATCH] Best: ${best.symbol} ${best.score}/10 ${best.direction}`);

    if (DH_WEBHOOK_URL) {
      try {
        const watchPayload = bestEnriched
          ? intel.buildWatchV11({ candidate: bestEnriched, ranked, corey })
          : buildDHPayload(best); // legacy fallback if enrichment somehow missing
        const payload = fomo.sanitize(fomo.withFomoCaution(watchPayload));
        await dhSendWebhook(DH_WEBHOOK_URL, { content: payload.content });
        dhLog('INFO', `[WEBHOOK] Dark Horse posted — ${best.symbol}` +
                       (payload.replaced ? ' (sanitized)' : ''));
        dhLog('INFO', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=ok kind=watch symbol=${best.symbol}`);
      } catch (e) {
        dhLog('ERROR', `[WEBHOOK] Failed — ${best.symbol}: ${e.message}`);
        dhLog('ERROR', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=watch symbol=${best.symbol} reason=${e.message}`);
      }
    } else {
      dhLog('WARN', 'WEEKLY_DARKHORSES (preferred) and DARKHORSE_STOCK (legacy) both unset — webhook skipped');
      dhLog('WARN', `[DH-CHANNEL] env_key=missing target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=watch reason=env_unset`);
    }

    await triggerPipeline(best);
  }
  // ── MOVEMENT DIGEST — fires only when WATCH:0 + elevated ──
  else if (fomo.shouldPostMovementDigest(volatility, _lastMovementDigestAt)) {
    const expandedCount = Math.min(3, ranked.top.length);
    const compactCount  = Math.max(0, Math.min(7, ranked.top.length - expandedCount));
    dhLog('INFO', `[MOVEMENT-DIGEST] firing — level=${volatility.level} ` +
                  `internal=${volatility.internalCount} reason=${volatility.reason}`);
    dhLog('INFO', `[MOVEMENT-DIGEST] top_expanded=${expandedCount} top_compact=${compactCount} ` +
                  `sections_included=${sectionsScanned.join(',') || 'none'} output_depth=v1.1`);
    if (DH_WEBHOOK_URL) {
      try {
        const digestPayload = intel.buildMovementDigestV11({
          ranked, volatility, corey, calendarHealth
        });
        const payload = fomo.sanitize(digestPayload);
        await dhSendWebhook(DH_WEBHOOK_URL, { content: payload.content });
        _lastMovementDigestAt = Date.now();
        dhLog('INFO', `[WEBHOOK] Movement digest posted` +
                       (payload.replaced ? ' (sanitized)' : ''));
        dhLog('INFO', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=ok kind=movement_digest level=${volatility.level} internal=${volatility.internalCount}`);
      } catch (e) {
        dhLog('ERROR', `[WEBHOOK] Movement digest failed: ${e.message}`);
        dhLog('ERROR', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=movement_digest reason=${e.message}`);
      }
    } else {
      dhLog('WARN', 'WEEKLY_DARKHORSES (preferred) and DARKHORSE_STOCK (legacy) both unset — movement digest skipped');
      dhLog('WARN', `[DH-CHANNEL] env_key=missing target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=movement_digest reason=env_unset`);
    }
  } else if (volatility.level !== 'quiet') {
    // Cooldown blocked — logged explicitly per spec.
    dhLog('INFO', `[MOVEMENT-DIGEST] skipped reason=cooldown`);
  }

  // Strip the enrichment payload (heavy OHLC) from the returned shape;
  // the engine consumers should not need raw candles.
  const stripPrivate = (r) => {
    if (!r) return r;
    const { _components, _htf, _ltf, ...rest } = r;
    return rest;
  };
  return {
    watch:    watch.map(stripPrivate),
    internal: internal.map(stripPrivate),
    ignored:  ignored.map(stripPrivate),
    ranked:   { top: ranked.top, sectionCapsApplied: ranked.sectionCapsApplied, sectionsScanned },
    volatility,
    scannedAt: new Date().toISOString()
  };
}

// ============================================================
// ACCESSORS
// ============================================================
function getDHInternalStore() { return Object.fromEntries(DH_INTERNAL_STORE); }
function getDHCandidate(symbol) { return DH_INTERNAL_STORE.get(symbol) || null; }

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  dhInit,
  dhSetPipelineTrigger,
  runDarkHorseScan,
  getDHInternalStore,
  getDHCandidate,
  DH_UNIVERSE,
};
