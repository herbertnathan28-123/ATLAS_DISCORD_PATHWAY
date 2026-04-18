'use strict';
// ============================================================
// ATLAS FX — DARK HORSE ENGINE v2.0
// Scan layer only. No trades. No execution. No Jane bypass.
// Flow: DarkHorse → FX Bot → Corey → Spidey → Jane
// Unsupported instruments permanently excluded per ATLAS FX doctrine.
// Output: single strongest trending instrument per scan.
// ============================================================

const https = require('https');

// ── UNIVERSE ──────────────────────────────────────────────────
// Full institutional universe — FX, indices, equities, commodities
// Unsupported instrument classes excluded permanently — zero exceptions
const DEFAULT_UNIVERSE = [
  // FX Majors
  'EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD',

  // FX Crosses
  'EURGBP','EURJPY','GBPJPY','AUDJPY','CADJPY','CHFJPY','EURAUD',
  'EURCAD','GBPAUD','GBPCAD','GBPCHF','AUDCAD','AUDNZD','NZDCAD',

  // Indices
  'NAS100','US500','DJI','GER40','UK100',

  // Equities
  'NVDA','AMD','ASML','AAPL','MSFT','META','GOOGL','AMZN','TSLA',

  // Commodities
  'XAUUSD','XAGUSD'
];

const DH_UNIVERSE = DEFAULT_UNIVERSE;

// Policy-rejected instrument filter — applied before every scan
const POLICY_REJECTED_TERMS = new Set([
  'BTC','ETH','XRP','SOL','DOGE','ADA','BNB','DOT','MATIC','AVAX',
  'LINK','LTC','BCH','XLM','ALGO','ATOM','VET','ICP','USDT','USDC',
  'SHIB','PEPE','BITCOIN','ETHEREUM',
]);

function isPolicyRejected(symbol) {
  const s = symbol.toUpperCase();
  for (const kw of POLICY_REJECTED_TERMS) {
    if (s.includes(kw)) return true;
  }
  return false;
}

// ── THRESHOLDS ────────────────────────────────────────────────
const DH_SCORE_WATCH    = 8;  // ≥8 → post to Discord + trigger pipeline
const DH_SCORE_INTERNAL = 5;  // 5–7 → store internally only

// ── WEBHOOK ───────────────────────────────────────────────────
const DH_WEBHOOK_URL = process.env.DARKHORSE_STOCK || null;

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
const dhLog = (level, msg, ...a) =>
  console.log(`[${new Date().toISOString()}] [DH-${level}] ${msg}`, ...a);

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
  if (isPolicyRejected(symbol)) {
    dhLog('WARN', `${symbol} — POLICY_REJECTED, skipping`);
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
function buildDHPayload(candidate) {
  const arrow = candidate.direction === 'Bullish' ? '↑' : candidate.direction === 'Bearish' ? '↓' : '→';

  const content =
    `🐎 **DARK HORSE**\n` +
    `**${candidate.symbol}** ${arrow}\n` +
    `${candidate.summary}\n` +
    `Confidence: ${candidate.score}/10\n\n` +
    `⚠️ Scan flag only — pipeline: Corey → Spidey → Jane`;

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
// Returns: single strongest instrument (highest score)
// ============================================================
async function runDarkHorseScan(universe) {
  if (!isMarketOpen()) {
    dhLog('INFO', '━━━ Scan SKIPPED — market closed (weekend) ━━━');
    return { watch: [], internal: [], ignored: [], scannedAt: new Date().toISOString(), skipped: true };
  }

  // Apply policy-rejected filter to universe
  const symbols = ((universe && universe.length) ? universe : DH_UNIVERSE)
    .filter(s => !isPolicyRejected(s));

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

  // WATCH — post SINGLE STRONGEST only (highest score)
  // Rule: must be specific tradable symbol, correct output format
  if (watch.length > 0) {
    const best = watch[0]; // Already sorted by score desc
    dhLog('INFO', `[WATCH] Best: ${best.symbol} ${best.score}/10 ${best.direction}`);

    if (DH_WEBHOOK_URL) {
      try {
        await dhSendWebhook(DH_WEBHOOK_URL, buildDHPayload(best));
        dhLog('INFO', `[WEBHOOK] Dark Horse posted — ${best.symbol}`);
      } catch (e) {
        dhLog('ERROR', `[WEBHOOK] Failed — ${best.symbol}: ${e.message}`);
      }
    } else {
      dhLog('WARN', 'DARKHORSE_STOCK not set — webhook skipped');
    }

    await triggerPipeline(best);
  }

  return { watch, internal, ignored, scannedAt: new Date().toISOString() };
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
