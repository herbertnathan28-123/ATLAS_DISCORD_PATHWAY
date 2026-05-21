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

// ── COREY LIVE — defensive optional require ───────────────────
// Used solely to source VIX level for FOMO assessment. The
// engine never modifies coreyLive; it only reads getLiveContext().
// CLAUDE.md restricts modification of getLiveContext / getMarketContext,
// not invocation. If the module is unavailable for any reason the
// engine logs vix=unavailable reason=<...> rather than failing.
let _coreyLive = null;
let _coreyLiveLoadReason = null;
try {
  _coreyLive = require('./corey_live_data');
} catch (e) {
  _coreyLiveLoadReason = `corey_live_data_require_threw:${e.message}`;
}

function getVixContext() {
  if (!_coreyLive) {
    return { level: null, available: false,
             reason: _coreyLiveLoadReason || 'corey_live_data_module_unavailable' };
  }
  if (typeof _coreyLive.getLiveContext !== 'function') {
    return { level: null, available: false, reason: 'getLiveContext_not_a_function' };
  }
  let ctx;
  try { ctx = _coreyLive.getLiveContext(); }
  catch (e) { return { level: null, available: false, reason: `getLiveContext_threw:${e.message}` }; }
  if (!ctx) return { level: null, available: false, reason: 'live_context_null' };
  const vix = ctx.vix || (ctx.live && ctx.live.vix) || null;
  if (!vix) return { level: null, available: false, reason: 'vix_field_absent' };
  if (vix.level == null || vix.level === '') return { level: null, available: false, reason: 'vix_level_empty' };
  return { level: vix.level, available: true };
}

// ── UNIVERSE ──────────────────────────────────────────────────
// Full institutional universe — FX, indices, equities, commodities
// Crypto excluded permanently — zero exceptions
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
const DH_SCORE_WATCH    = 7;  // ≥7 → post to Discord + trigger pipeline
const DH_SCORE_INTERNAL = 5;  // 5–6 → store internally only

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
// Provenance for the cooldown timestamp. Set in lock-step with
// _lastMovementDigestAt via _markDigestPosted() so every cooldown
// arming carries the originating event. On in-memory only — a
// process restart clears both back to 0 / null. There is NO
// persistence layer for this cooldown; it cannot survive a deploy.
let _lastMovementDigestMeta = null;

// WATCH dedupe state — keyed by symbol.
// Value: { stateHash, postedAt }. Pruned when entries exceed 7 days.
const _lastWatchByEcho = new Map();

// Identical-state suppression window. Inside this window, the same
// symbol/direction/score/trendPhase/transitionRisk/confirmationLevel
// combination is suppressed with reason=identical_state.
const DH_WATCH_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

// Per-symbol hard floor. Even on a legitimate state change, a symbol
// cannot re-post inside this window. Reason=cooldown_hard_floor.
const DH_WATCH_HARD_FLOOR_MS = 6 * 60 * 60 * 1000;   // 6h

// 7-day prune horizon for the watch-echo map.
const DH_WATCH_ECHO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const dhLog = (level, msg, ...a) =>
  console.log(`[${new Date().toISOString()}] [DH-${level}] ${msg}`, ...a);

// Boot-time channel resolution log — emitted once per process so the
// operator can confirm which env var resolved without exposing any URL.
dhLog('INFO', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL}`);

// ── COOLDOWN GATE ────────────────────────────────────────────
// SINGLE site that arms the movement-digest cooldown. Every call
// records provenance into _lastMovementDigestMeta AND emits a
// [MOVEMENT-DIGEST-COOLDOWN] log line carrying:
//   cooldown_set_by   — which send-path armed cooldown
//   cooldown_timestamp — ISO UTC of the arming
//   cooldown_reason   — symbolic reason ("send_ok", etc.)
//   discord_message_id — proof of delivery if Discord returned one
//   status / kind     — Discord HTTP status + payload kind
// If a future code path ever sets _lastMovementDigestAt directly,
// the meta stays stale and the skip-path log will warn. Don't —
// always go through this function.
function _markDigestPosted(info) {
  info = info || {};
  _lastMovementDigestAt = Date.now();
  _lastMovementDigestMeta = {
    set_by: info.set_by || 'unknown',
    timestamp: new Date(_lastMovementDigestAt).toISOString(),
    reason: info.reason || 'unspecified',
    discord_message_id: info.discord_message_id || null,
    status: info.status == null ? null : info.status,
    kind: info.kind || null,
  };
  dhLog('INFO',
    `[MOVEMENT-DIGEST-COOLDOWN] cooldown_set_by=${_lastMovementDigestMeta.set_by} ` +
    `cooldown_timestamp=${_lastMovementDigestMeta.timestamp} ` +
    `cooldown_reason=${_lastMovementDigestMeta.reason} ` +
    `discord_message_id=${_lastMovementDigestMeta.discord_message_id || 'n/a'} ` +
    `status=${_lastMovementDigestMeta.status == null ? 'n/a' : _lastMovementDigestMeta.status} ` +
    `kind=${_lastMovementDigestMeta.kind || 'n/a'}`
  );
}

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
  };
}

// Build one concise summary line for output
function buildSummaryLine(struct, mom, brk, clean, cont, direction) {
  // Direction-aware HH/HL vs LH/LL phrasing (operator directive
  // 2026-05-12 — Lane 3): for Bearish candidates the structure
  // sequence is LH/LL, not HH/HL. Previously hardcoded "HH/HL
  // sequence confirmed" regardless of direction, producing the
  // contradictory "Strong bearish structure with HH/HL sequence
  // confirmed" → "Strong bearish structure with higher highs and
  // higher lows sequence confirmed" after the jargon translator.
  const seq = direction === 'Bullish' ? 'HH/HL' : 'LH/LL';
  if (brk.score === 2 && mom.score === 2) return `Clean breakout continuation with strong momentum`;
  if (brk.score === 2 && struct.score === 2) return `Clean breakout from ${direction === 'Bullish' ? 'bullish' : 'bearish'} structure`;
  if (struct.score === 2 && cont.score === 2) return `Strong trend acceleration with sustained ${direction === 'Bullish' ? 'higher highs' : 'lower lows'}`;
  if (clean.score === 2 && mom.score >= 1) return `High-efficiency directional move with expanding momentum`;
  if (cont.score === 2) return `Multi-timeframe ${direction === 'Bullish' ? 'bullish' : 'bearish'} alignment with acceleration`;
  if (struct.score === 2) return `Strong ${direction === 'Bullish' ? 'bullish' : 'bearish'} structure with ${seq} sequence confirmed`;
  if (mom.score === 2) return `Momentum expansion — ${direction === 'Bullish' ? 'bullish' : 'bearish'} continuation developing`;
  if (brk.score >= 1) return `Breakout setup forming — ${direction === 'Bullish' ? 'bullish' : 'bearish'} continuation likely`;
  return `Composite score threshold met — ${direction === 'Bullish' ? 'bullish' : 'bearish'} trend developing`;
}

// ============================================================
// WEBHOOK DELIVERY
// ============================================================
// ============================================================
// WEBHOOK DELIVERY
//
// dhSendWebhook(webhookUrl, payload, opts?) -> Promise<{
//   ok, status, body, bodyLen, messageId, durationMs
// } | null>
//
// Resolves with a structured delivery report for every Discord
// response — including 4xx / 5xx error bodies — so the caller can
// log a verifiable send_result instead of treating any non-thrown
// HTTP exchange as success. Network-layer errors (DNS, TLS,
// connection reset, timeout) still reject().
//
// opts.wait — when true, append `wait=true` to the webhook URL so
// Discord returns the message body (and message ID) on success
// instead of 204 No Content. Required for delivery proof.
// ============================================================
function _dhNormaliseWebhookFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((f, idx) => {
    const name = String((f && f.name) || ('attachment-' + idx + '.bin')).replace(/[^\w.\-]+/g, '_');
    const raw = f && (f.data || f.buffer || f.content);
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw == null ? '' : raw);
    return {
      name,
      data,
      contentType: String((f && f.contentType) || (f && f.type) || 'application/octet-stream'),
    };
  }).filter(f => f.data.length > 0);
}

function _dhBuildWebhookBody(payload) {
  const files = _dhNormaliseWebhookFiles(payload && payload.files);
  if (files.length === 0) {
    const body = JSON.stringify(payload || {});
    return {
      body: Buffer.from(body, 'utf8'),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'ATLAS-FX-DarkHorse/2.0',
      },
      fileCount: 0,
    };
  }

  const jsonPayload = Object.assign({}, payload);
  delete jsonPayload.files;
  const existingAttachments = Array.isArray(jsonPayload.attachments) ? jsonPayload.attachments : [];
  jsonPayload.attachments = existingAttachments.concat(files.map((file, idx) => ({
    id: idx,
    filename: file.name,
  })));
  const boundary = 'atlas-dh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const chunks = [];
  function push(s) { chunks.push(Buffer.from(s, 'utf8')); }
  push('--' + boundary + '\r\n');
  push('Content-Disposition: form-data; name="payload_json"\r\n');
  push('Content-Type: application/json\r\n\r\n');
  push(JSON.stringify(jsonPayload));
  push('\r\n');
  files.forEach((file, idx) => {
    push('--' + boundary + '\r\n');
    push('Content-Disposition: form-data; name="files[' + idx + ']"; filename="' + file.name + '"\r\n');
    push('Content-Type: ' + file.contentType + '\r\n\r\n');
    chunks.push(file.data);
    push('\r\n');
  });
  push('--' + boundary + '--\r\n');
  const body = Buffer.concat(chunks);
  return {
    body,
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': body.length,
      'User-Agent': 'ATLAS-FX-DarkHorse/2.0',
    },
    fileCount: files.length,
  };
}

function dhSendWebhook(webhookUrl, payload, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    if (!webhookUrl) { resolve(null); return; }
    const prepared = _dhBuildWebhookBody(payload);
    let urlStr = webhookUrl;
    if (opts.wait) {
      urlStr += (urlStr.indexOf('?') >= 0) ? '&wait=true' : '?wait=true';
    }
    const url  = new URL(urlStr);
    const httpOpts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  prepared.headers,
      timeout:  10000,
    };
    const startedAt = Date.now();
    const req = https.request(httpOpts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        const status = res.statusCode || 0;
        const okHttp = status >= 200 && status < 300;
        let messageId = null;
        if (okHttp && data && data.length) {
          // Discord returns JSON on 200 (when wait=true) containing
          // { id, type, content, channel_id, ... }. 204 has no body.
          try {
            const parsed = JSON.parse(data);
            if (parsed && typeof parsed.id === 'string' && /^\d+$/.test(parsed.id)) {
              messageId = parsed.id;
            }
          } catch (_e) { /* non-JSON 2xx body — leave messageId null */ }
        }
        resolve({
          ok: okHttp,
          status,
          body: data,
          bodyLen: data.length,
          messageId,
          durationMs: Date.now() - startedAt
        });
      });
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
    req.write(prepared.body);
    req.end();
  });
}

// Scrub anything that looks like a Discord webhook URL or token out
// of an arbitrary string. Used when serialising error excerpts for
// log lines so the webhook URL / token can never leak through an
// unexpected error path.
function _dhRedactWebhook(s) {
  return String(s == null ? '' : s)
    .replace(/https?:\/\/[a-zA-Z0-9./_\-]*?webhooks\/\d+\/[A-Za-z0-9_\-]+/g, '<webhook-url-redacted>')
    .replace(/webhooks\/\d+\/[A-Za-z0-9_\-]+/g, 'webhooks/<id>/<token-redacted>');
}

// Compress Discord's JSON error body to a short safe excerpt for
// logs (status + Discord error code + message). Discord 4xx bodies
// look like {"code":50035,"message":"Invalid Form Body",...}.
function _dhExcerptResponse(result) {
  if (!result) return 'no_result';
  const parts = ['status=' + (result.status == null ? '?' : result.status), 'bodyLen=' + (result.bodyLen || 0)];
  if (result.body && result.body.length) {
    try {
      const parsed = JSON.parse(result.body);
      if (parsed && parsed.code != null) parts.push('discord_code=' + parsed.code);
      if (parsed && typeof parsed.message === 'string') parts.push('discord_msg="' + parsed.message.slice(0, 120).replace(/[\r\n]+/g, ' ') + '"');
    } catch (_e) {
      // Non-JSON body — log first 120 chars, scrubbed.
      parts.push('body_head="' + _dhRedactWebhook(result.body.slice(0, 120)).replace(/[\r\n]+/g, ' ') + '"');
    }
  }
  return parts.join(' ');
}

// ============================================================
// DIGEST CHUNKER — Discord-safe transport
//
// Discord webhook content is hard-capped at 2000 chars per POST.
// The v1.1 movement digest can run 4–6k chars on a busy scan. We
// chunk before sending so the digest is delivered in ordered
// parts rather than 400'd by Discord. The split priority is:
//   1. \n\n──\n\n   (between expanded candidates — never broken)
//   2. \n\n         (paragraph)
//   3. \n           (line)
//   4. char         (last-resort hard split)
// Each chunk is wrapped with its own labelled header so a reader
// scrolling Discord sees Part X/Y on every message.
//
// The original 🐎 header in the body is stripped before chunking
// so it isn't duplicated alongside the part label on Part 1.
//
// DH_CHUNK_MAX_DEFAULT is 1800 chars total (label + body) — 200
// chars of headroom below Discord's 2000-char limit so any unicode
// width quirks cannot push a chunk over.
// ============================================================
const DH_CHUNK_MAX_DEFAULT = 1800;
const DH_CHUNK_DISCORD_HARD_LIMIT = 2000;
// Strip any legacy v1.1 outer banner from the body before the
// chunker injects the per-Part transport label. v1.3 FOH bodies
// open with an HR + premium FOH OPERATOR SURFACE block which is
// intentionally NOT stripped — it is the dominant visible header
// on Part 1.
const _DH_DIGEST_HEADER_RE = /^🐎 \*\*DARK HORSE — GLOBAL MOVER RADAR \(v1\.1\)\*\*[ \t]*\n+/;

// Split `text` on `re`, keeping the separator attached to the
// PRECEDING piece. Re-joining the result reproduces the input
// exactly. Used so candidate / paragraph boundaries stay paired
// with their content during greedy packing.
function _dhSplitKeepSep(text, re) {
  const out = [];
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const r = new RegExp(re.source, flags);
  let lastEnd = 0;
  let m;
  while ((m = r.exec(text)) !== null) {
    out.push(text.slice(lastEnd, m.index) + m[0]);
    lastEnd = m.index + m[0].length;
    if (m[0].length === 0) r.lastIndex++;
  }
  if (lastEnd < text.length) out.push(text.slice(lastEnd));
  return out;
}

// Code-fence atomicity (operator directive 2026-05-12).
// Replace internal newlines inside ``` … ``` blocks with U+0001 so
// the progressive splitter sees each fence as a single "line" and
// never breaks inside the ASCII visual diagram. Restore on output.
// Safe: U+0001 cannot appear in legitimate user-facing text.
const _DH_CODE_FENCE_TOKEN = '';
// `### Glossary — chart-pattern terms used above` block stays whole
// in a single chunk so the reader sees the full definition set in
// one place. Same token + restore mechanism as code fences.
const _DH_GLOSSARY_BLOCK_RE = /### Glossary — chart-pattern terms used above[\s\S]*?(?=\n\n⏭️|\n\n⚠️|$)/;
function _dhProtectCodeFences(text) {
  return String(text).replace(/```[\s\S]*?```/g, m => m.replace(/\n/g, _DH_CODE_FENCE_TOKEN));
}
function _dhProtectGlossary(text) {
  return String(text).replace(_DH_GLOSSARY_BLOCK_RE, m => m.replace(/\n/g, _DH_CODE_FENCE_TOKEN));
}
function _dhRestoreCodeFences(text) {
  return String(text).replace(new RegExp(_DH_CODE_FENCE_TOKEN, 'g'), '\n');
}

function _dhChunkDigest(content, opts) {
  opts = opts || {};
  const max = Number.isFinite(opts.max) && opts.max > 200
    ? opts.max
    : DH_CHUNK_MAX_DEFAULT;
  // Per-Part transport label (operator directive 2026-05-13).
  // Default updated from the legacy v1.1 "GLOBAL MOVER RADAR"
  // wording to the FOH transport label so the legacy identity
  // does not visually dominate every Discord message. Callers
  // can still override via opts.headerTemplate (legacy fallback
  // payload supplies its own template).
  const headerTemplate = opts.headerTemplate ||
    '**🐎 ATLAS · DARK HORSE FOH** — Part {x}/{y}\n\n';

  // Strip the outer header, then protect any ``` code fences from
  // mid-block splits. The fence-token substitution preserves byte
  // counts (one `\n` becomes one ``), so the budget math is
  // unchanged.
  const bodyRaw = String(content == null ? '' : content)
    .replace(_DH_DIGEST_HEADER_RE, '');
  // Order: code-fence protection first (so any code fence INSIDE
  // the glossary block — there is none today, but the regex is
  // future-proof — is preserved verbatim), then glossary block.
  const body = _dhProtectGlossary(_dhProtectCodeFences(bodyRaw));

  // Budget the body under the worst-case label size so even a 99/99
  // chunk still fits under `max`.
  const sampleLabel = headerTemplate.replace('{x}', '99').replace('{y}', '99');
  const bodyMax = Math.max(200, max - sampleLabel.length);

  // Progressive split — candidate > paragraph > line > char.
  const blocks = [];
  for (const piece1 of _dhSplitKeepSep(body, /\n\n──\n\n/)) {
    if (piece1.length <= bodyMax) { blocks.push(piece1); continue; }
    for (const piece2 of _dhSplitKeepSep(piece1, /\n\n+/)) {
      if (piece2.length <= bodyMax) { blocks.push(piece2); continue; }
      for (const piece3 of _dhSplitKeepSep(piece2, /\n/)) {
        if (piece3.length <= bodyMax) { blocks.push(piece3); continue; }
        let rem = piece3;
        while (rem.length > bodyMax) {
          blocks.push(rem.slice(0, bodyMax));
          rem = rem.slice(bodyMax);
        }
        if (rem.length) blocks.push(rem);
      }
    }
  }

  // Greedy-pack blocks into bodies of at most bodyMax chars.
  const bodies = [];
  let cur = '';
  for (const b of blocks) {
    if (cur.length === 0) { cur = b; continue; }
    if ((cur + b).length <= bodyMax) { cur += b; continue; }
    bodies.push(cur);
    cur = b;
  }
  if (cur.length) bodies.push(cur);
  if (bodies.length === 0) bodies.push('');

  const y = bodies.length;
  return bodies.map((b, i) => {
    const label = headerTemplate
      .replace('{x}', String(i + 1))
      .replace('{y}', String(y));
    // Restore code-fence newlines on the final chunk text, then
    // trim leading/trailing blank lines as before.
    const restored = _dhRestoreCodeFences(b).replace(/^[\n]+|[\n]+$/g, '');
    // First-chunk prefix — operator directive 2026-05-12. Renders
    // above the Part 1/N label ONCE per digest (chunk 0 only) so
    // consecutive Dark Horse scans in the Discord channel are
    // visually distinct. Parts 2..N never carry this block;
    // their Part X/N label is enough to identify the continuation.
    const firstChunkPrefix = (i === 0 && typeof opts.firstChunkPrefix === 'string' && opts.firstChunkPrefix.length)
      ? opts.firstChunkPrefix + '\n\n'
      : '';
    return firstChunkPrefix + label + restored;
  });
}

// ============================================================
// WATCH PAYLOAD HELPERS — trend age, phase, exhaustion risk,
// confirmation/cancellation levels, next-review formatting.
// All derived from the HTF/LTF candle arrays already fetched
// during scoreInstrument. No new fetches.
// ============================================================

// 3-bar fractal swing detection. Returns array of {idx, price, time}.
function findSwingLows(candles) {
  if (!Array.isArray(candles) || candles.length < 3) return [];
  const out = [];
  for (let i = 1; i < candles.length - 1; i++) {
    if (candles[i].low < candles[i - 1].low && candles[i].low <= candles[i + 1].low) {
      out.push({ idx: i, price: candles[i].low, time: candles[i].time || null });
    }
  }
  return out;
}
function findSwingHighs(candles) {
  if (!Array.isArray(candles) || candles.length < 3) return [];
  const out = [];
  for (let i = 1; i < candles.length - 1; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].high >= candles[i + 1].high) {
      out.push({ idx: i, price: candles[i].high, time: candles[i].time || null });
    }
  }
  return out;
}

// Walk swing series backward; return the most recent confirmed HL/LH
// (a swing that's above/below its prior swing of the same kind).
function lastConfirmedHigherLow(candles) {
  const sl = findSwingLows(candles);
  for (let i = sl.length - 1; i >= 1; i--) {
    if (sl[i].price > sl[i - 1].price) return sl[i];
  }
  return null;
}
function lastConfirmedLowerHigh(candles) {
  const sh = findSwingHighs(candles);
  for (let i = sh.length - 1; i >= 1; i--) {
    if (sh[i].price < sh[i - 1].price) return sh[i];
  }
  return null;
}

// Format a Unix-second candle timestamp as YYYY-MM-DD (UTC) for display.
function fmtSwingDate(unixSec) {
  if (!Number.isFinite(unixSec)) return null;
  const d = new Date(unixSec * 1000);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Compute average body size of an arbitrary candle slice.
function avgBody(candles) {
  if (!candles || !candles.length) return 0;
  return candles.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / candles.length;
}

// Round a price to a sensible display precision based on magnitude.
function priceDp(price) {
  const p = Math.abs(Number(price) || 0);
  if (p === 0) return 2;
  if (p < 1) return 5;
  if (p < 10) return 4;
  if (p < 100) return 3;
  return 2;
}
function fmtPrice(price) {
  if (!Number.isFinite(price)) return null;
  return Number(price).toFixed(priceDp(price));
}

// Classify trend phase from age + momentum decay.
// Early       : age ≤ 25% of typical (≤ 5 candles)
// Mid-trend   : age 26-60%           (6-12 candles)
// Mature      : age 61-90%           (13-18 candles)
// Late-stage  : age > 90% AND momentum decay
// "Typical" baseline is 20 HTF candles on the 1D timeframe.
function classifyTrendPhase(trendAgeCandles, momentumDecay) {
  const a = Number(trendAgeCandles) || 0;
  if (a <= 5)  return 'Early trend';
  if (a <= 12) return 'Mid-trend continuation';
  if (a <= 18) return 'Mature trend';
  if (momentumDecay) return 'Late-stage / exhaustion risk building';
  return 'Mature trend';
}

// Bearish-transition (or bullish-transition for short candidates) risk
// label from phase + momentum decay + distance-to-cancel-level.
function classifyTransitionRisk(phase, momentumDecay, ageCandles) {
  if (phase === 'Late-stage / exhaustion risk building') return 'Rising';
  if (phase === 'Mature trend' && momentumDecay)         return 'Rising';
  if (phase === 'Mature trend')                          return 'Moderate';
  if (phase === 'Mid-trend continuation' && momentumDecay) return 'Moderate';
  if (phase === 'Mid-trend continuation')                return 'Low';
  if (ageCandles <= 3)                                   return 'Low';
  return 'Low';
}

// Expected continuation window — probabilistic phrasing keyed on phase.
function continuationWindowText(phase, direction, confirmationLevel) {
  const dir = direction === 'Bullish' ? 'Bullish' : direction === 'Bearish' ? 'Bearish' : 'Directional';
  const pressureWord = dir === 'Bullish' ? 'upside' : dir === 'Bearish' ? 'downside' : 'directional';
  const verb = dir === 'Bullish' ? 'above' : 'below';
  const lvl = confirmationLevel != null ? fmtPrice(confirmationLevel) : null;
  const lvlClause = lvl ? ` if price keeps closing ${verb} ${lvl}` : '';
  if (phase === 'Early trend')                              return `${dir} pressure may continue for the next 2–4 sessions${lvlClause}.`;
  if (phase === 'Mid-trend continuation')                   return `${dir} pressure may continue for the next 1–3 sessions${lvlClause}.`;
  if (phase === 'Mature trend')                             return `${dir} pressure may continue for the next 0–2 sessions${lvlClause}. Late-buyer / late-seller chase risk is rising.`;
  if (phase === 'Late-stage / exhaustion risk building')    return `${dir} pressure is in its late stage. Continuation is possible but unreliable; reversion risk is elevated.`;
  return `${dir} ${pressureWord} pressure observed${lvlClause}.`;
}

// Build a sentence about transition risk increase conditions.
function transitionRiskReason(direction, cancellationLevel, levelTimeframe) {
  const oppositeDir = direction === 'Bullish' ? 'bearish' : 'bullish';
  const closeWord = direction === 'Bullish' ? 'below' : 'above';
  const swingWord = direction === 'Bullish' ? 'higher low' : 'lower high';
  const lvl = cancellationLevel != null ? fmtPrice(cancellationLevel) : null;
  const tf = levelTimeframe || '1D';
  if (lvl) {
    return `Risk increases if price closes ${closeWord} ${lvl} on ${tf}, fails to make a fresh ${direction === 'Bullish' ? 'high' : 'low'}, or breaks the last confirmed ${swingWord} at ${lvl}.`;
  }
  return `Risk increases if price loses the last confirmed ${swingWord} on ${tf} or momentum into the opposite (${oppositeDir}) direction expands.`;
}

// Layman-first VIX label per the locked wording rule. Local to Dark
// Horse output; PR B will replace this with a shared macro helper.
function laymanVixLabel(level) {
  if (!level) return null;
  return `market fear / volatility gauge (VIX) is ${String(level).toLowerCase()}`;
}

// Format the next-review timestamp in both UTC and AWST (UTC+8).
// Rounds up to the next scan-interval boundary so the user sees a
// scheduling-aligned wall-clock target rather than "now + 15m".
function nextReviewLine(nowMs, intervalMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const step = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 15 * 60 * 1000;
  const next = new Date(Math.ceil((now + 1) / step) * step);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const utcH = pad(next.getUTCHours());
  const utcM = pad(next.getUTCMinutes());
  const awst = new Date(next.getTime() + 8 * 60 * 60 * 1000);
  const awstH = pad(awst.getUTCHours());
  const awstM = pad(awst.getUTCMinutes());
  return `${utcH}:${utcM} UTC / ${awstH}:${awstM} AWST`;
}

// ============================================================
// ENRICH WATCH CANDIDATE — adds trend-age / phase / continuation /
// transition / level fields. Returns the original candidate with
// new fields merged in (does not mutate input).
// ============================================================
function enrichWatchCandidate(candidate, htfCandles, ltfCandles) {
  if (!candidate || !candidate.direction) {
    return Object.assign({}, candidate || {}, { dataReliable: false });
  }
  const htf = Array.isArray(htfCandles) ? htfCandles : [];
  const ltf = Array.isArray(ltfCandles) ? ltfCandles : [];

  // Require ≥ 30 HTF candles for a reliable HL/LH walk-back.
  if (htf.length < 30) {
    return Object.assign({}, candidate, { dataReliable: false, reliabilityReason: 'htf_lt_30_candles' });
  }

  const isBull = candidate.direction === 'Bullish';
  const lastConfirmedSwing = isBull
    ? lastConfirmedHigherLow(htf)
    : lastConfirmedLowerHigh(htf);

  if (!lastConfirmedSwing) {
    return Object.assign({}, candidate, { dataReliable: false, reliabilityReason: 'no_confirmed_swing' });
  }

  // Trend age = HTF candles between the confirmed swing and current bar.
  const trendAgeCandles = (htf.length - 1) - lastConfirmedSwing.idx;
  const trendAgeSessions = trendAgeCandles; // HTF is 1D — candles ≡ sessions.

  // Confirmation level — recent consolidation high (bullish) / low (bearish)
  // from the same window scoreBreakout uses. Falls back to most recent
  // swing high/low if the consolidation band is too wide to publish.
  const consolidation = htf.slice(-20, -5);
  const lastClose = htf[htf.length - 1].close;
  let confirmationLevel = null;
  if (consolidation.length >= 10) {
    const consHigh = Math.max(...consolidation.map(c => c.high));
    const consLow  = Math.min(...consolidation.map(c => c.low));
    const consRange = consHigh - consLow;
    if (lastClose > 0 && consRange / lastClose < 0.10) {
      confirmationLevel = isBull ? consHigh : consLow;
    }
  }
  if (!Number.isFinite(confirmationLevel)) {
    const swings = isBull ? findSwingHighs(htf) : findSwingLows(htf);
    const last = swings.length ? swings[swings.length - 1] : null;
    if (last) confirmationLevel = last.price;
  }

  const cancellationLevel = lastConfirmedSwing.price;
  if (!Number.isFinite(confirmationLevel) || !Number.isFinite(cancellationLevel)) {
    return Object.assign({}, candidate, { dataReliable: false, reliabilityReason: 'level_unresolvable' });
  }

  // Momentum decay — recent 3 vs prior 7 LTF candle bodies. Falls back
  // to HTF window when LTF is thin.
  const decayWindow = ltf.length >= 10 ? ltf : htf;
  const recent3 = decayWindow.slice(-3);
  const prior7  = decayWindow.slice(-10, -3);
  const recentBody = avgBody(recent3);
  const priorBody  = avgBody(prior7);
  const momentumDecay = priorBody > 0 && recentBody / priorBody < 0.85;

  const trendPhase = classifyTrendPhase(trendAgeCandles, momentumDecay);
  const transitionRisk = classifyTransitionRisk(trendPhase, momentumDecay, trendAgeCandles);

  return Object.assign({}, candidate, {
    trendAgeCandles,
    trendAgeSessions,
    lastSwingPrice: lastConfirmedSwing.price,
    lastSwingTimestamp: lastConfirmedSwing.time,
    lastSwingDate: fmtSwingDate(lastConfirmedSwing.time),
    trendPhase,
    transitionRisk,
    momentumDecay,
    confirmationLevel,
    cancellationLevel,
    levelTimeframe: '1D',
    dataReliable: true,
  });
}

// ============================================================
// WATCH DEDUPE — pure decision function.
// Inputs: enriched candidate, state Map<symbol, {stateHash, postedAt}>.
// Returns: { post, reason, stateHash, prior, nextEligibleAt }
// Rules:
//   1. Hard floor (DH_WATCH_HARD_FLOOR_MS): no re-post regardless of
//      state change. Reason='cooldown_hard_floor'.
//   2. Inside DH_WATCH_MIN_INTERVAL_MS with identical stateHash:
//      Reason='identical_state'.
//   3. Otherwise post.
// ============================================================
function computeWatchStateHash(candidate) {
  const c = candidate || {};
  const lvl = Number.isFinite(c.confirmationLevel)
    ? Number(c.confirmationLevel).toFixed(priceDp(c.confirmationLevel))
    : 'none';
  return [
    String(c.symbol || ''),
    String(c.direction || ''),
    String(c.score != null ? c.score : ''),
    String(c.trendPhase || ''),
    String(c.transitionRisk || ''),
    lvl,
  ].join('|');
}

function evaluateWatchPostDecision(candidate, state, options) {
  const opts = options || {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const minIntervalMs = Number.isFinite(opts.minIntervalMs)
    ? opts.minIntervalMs : DH_WATCH_MIN_INTERVAL_MS;
  const hardFloorMs = Number.isFinite(opts.hardFloorMs)
    ? opts.hardFloorMs : DH_WATCH_HARD_FLOOR_MS;
  const stateHash = computeWatchStateHash(candidate);
  const prior = (state && typeof state.get === 'function')
    ? state.get(candidate.symbol)
    : null;
  if (prior) {
    const elapsed = now - Number(prior.postedAt || 0);
    if (elapsed < hardFloorMs) {
      return {
        post: false, reason: 'cooldown_hard_floor',
        stateHash, prior, nextEligibleAt: Number(prior.postedAt || 0) + hardFloorMs,
      };
    }
    if (elapsed < minIntervalMs && prior.stateHash === stateHash) {
      return {
        post: false, reason: 'identical_state',
        stateHash, prior, nextEligibleAt: Number(prior.postedAt || 0) + minIntervalMs,
      };
    }
  }
  return { post: true, reason: 'new_or_state_change', stateHash };
}

// Prune watch-echo entries older than DH_WATCH_ECHO_TTL_MS.
function pruneWatchEcho(state, nowMs) {
  if (!state || typeof state.entries !== 'function') return 0;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let removed = 0;
  for (const [sym, entry] of state.entries()) {
    if (now - Number(entry.postedAt || 0) > DH_WATCH_ECHO_TTL_MS) {
      state.delete(sym);
      removed++;
    }
  }
  return removed;
}

// Build the user-facing "Why it is flagged" sentence. Plain English.
function whyFlaggedSentence(candidate) {
  const sym = candidate.symbol || 'this instrument';
  if (candidate.direction === 'Bullish') {
    return `${sym} is showing sustained upside pressure and repeated higher highs.`;
  }
  if (candidate.direction === 'Bearish') {
    return `${sym} is showing sustained downside pressure and repeated lower lows.`;
  }
  return `${sym} cleared the WATCH threshold with directional pressure.`;
}

// Move-quality label — direction-explicit, derived from score band.
function moveQualityLabel(candidate) {
  const dir = candidate.direction === 'Bullish'
    ? 'bullish'
    : candidate.direction === 'Bearish'
    ? 'bearish'
    : 'directional';
  const s = Number(candidate.score) || 0;
  if (s >= 9) return `Strong ${dir} acceleration`;
  if (s === 8) return `Sustained ${dir} pressure`;
  return `Developing ${dir} momentum`;
}

// ============================================================
// BUILD WATCH PAYLOAD
// New locked structure (per 2026-05 cleanup spec):
//   DARK HORSE WATCH — SYM
//   Status / Move Quality / Confidence
//   Trend age | Trend phase | Continuation window | Transition risk
//   Why flagged | Trader action | What confirms | What cancels
//   Next review (UTC / AWST)
// Fallback when dataReliable=false drops the trend block and
// states "Trend duration not reliable enough to publish yet."
// No "Corey / Spidey / Jane / confirmation path / trade alert /
// confirmed structure" wording anywhere in either shape.
// ============================================================
function buildDHPayload(candidate, options) {
  const opts = options || {};
  const c = candidate || {};
  const sym = c.symbol || 'UNKNOWN';
  const moveQ = moveQualityLabel(c);
  const score = Number.isFinite(c.score) ? c.score : '—';
  const reviewLine = nextReviewLine(opts.now, opts.intervalMs);
  const whyFlagged = whyFlaggedSentence(c);
  const traderAction = 'Do not chase the move. This is a watch candidate only.';

  const head =
    `🐎 **DARK HORSE WATCH — ${sym}**\n` +
    `**Status:** Watch candidate only\n` +
    `**Move Quality:** ${moveQ}\n` +
    `**Confidence:** ${score}/10\n\n`;

  if (!c.dataReliable) {
    const content =
      head +
      `Trend duration not reliable enough to publish yet. Treat this as a watch candidate only.\n\n` +
      `**Why it is flagged:**\n${whyFlagged}\n\n` +
      `**Trader action:**\n${traderAction}\n\n` +
      `No reliable confirmation level is available yet. Keep this as a watch candidate only.\n\n` +
      `**Next review:**\n${reviewLine}`;
    return { content, kind: 'watch_fallback' };
  }

  const dirWord = c.direction === 'Bullish' ? 'Bullish' : 'Bearish';
  const swingWord = c.direction === 'Bullish' ? 'higher low' : 'lower high';
  const dateClause = c.lastSwingDate ? ` on ${c.lastSwingDate}` : '';
  const trendAge =
    `${dirWord} sequence has been active for ${c.trendAgeCandles} candle${c.trendAgeCandles === 1 ? '' : 's'} / ` +
    `${c.trendAgeSessions} session${c.trendAgeSessions === 1 ? '' : 's'} since the last confirmed ${swingWord}${dateClause}.`;

  const continuation = continuationWindowText(c.trendPhase, c.direction, c.confirmationLevel);
  const transitionLine = transitionRiskReason(c.direction, c.cancellationLevel, c.levelTimeframe);

  const confLvl = fmtPrice(c.confirmationLevel);
  const cancLvl = fmtPrice(c.cancellationLevel);
  const tf = c.levelTimeframe || '1D';
  const closeAbove = c.direction === 'Bullish' ? 'above' : 'below';
  const closeOpposite = c.direction === 'Bullish' ? 'below' : 'above';
  const whatConfirms = `A full candle body close ${closeAbove} ${confLvl} on ${tf}, followed by a calm retest that holds ${closeAbove} ${cancLvl}.`;
  const whatCancels  = `A full candle body close ${closeOpposite} ${cancLvl} on ${tf}, or momentum fading before a valid pullback forms.`;

  const content =
    head +
    `**Trend age:**\n${trendAge}\n\n` +
    `**Trend phase:**\n${c.trendPhase}\n\n` +
    `**Expected continuation window:**\n${continuation}\n\n` +
    `**${c.direction === 'Bullish' ? 'Bearish' : 'Bullish'}-transition risk:**\n${c.transitionRisk}\n${transitionLine}\n\n` +
    `**Why it is flagged:**\n${whyFlagged}\n\n` +
    `**Trader action:**\n${traderAction}\n\n` +
    `**What would confirm the watch:**\n${whatConfirms}\n\n` +
    `**What cancels the watch:**\n${whatCancels}\n\n` +
    `**Next review:**\n${reviewLine}`;

  return { content, kind: 'watch' };
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
  // VIX precedence: explicit caller override > corey_live_data >
  // unavailable (with logged reason). Caller passes null/undefined
  // to indicate "engine should self-source from corey_live_data".
  const allResults = [...watch, ...internal, ...ignored];
  let effectiveVixLevel = (vixLevel != null && vixLevel !== '') ? vixLevel : null;
  let vixSource = effectiveVixLevel ? 'caller' : null;
  let vixUnavailableReason = null;
  if (!effectiveVixLevel) {
    const vctx = getVixContext();
    if (vctx.available) {
      effectiveVixLevel = vctx.level;
      vixSource = 'corey_live_data';
    } else {
      vixUnavailableReason = vctx.reason;
    }
  }

  const volatility = fomo.assessVolatility(allResults, effectiveVixLevel);
  const vixDisplay = volatility.vixLevel
    ? `vix=${volatility.vixLevel} vix_source=${vixSource}`
    : `vix=unavailable reason=${vixUnavailableReason || 'unknown'}`;
  dhLog('INFO', `[FOMO-ASSESS] level=${volatility.level} watch=${volatility.watchCount} ` +
                `internal=${volatility.internalCount} avgInternal=${volatility.avgInternalScore} ` +
                `${vixDisplay} reason=${volatility.reason}`);

  // ── MOVEMENT DIGEST DECISION LOGGING — emitted on every scan ──
  // Always fires, regardless of WATCH branch. Operators must always
  // be able to see why the digest did or did not post.
  const decision = fomo.evaluateDigestDecision(volatility, _lastMovementDigestAt);
  const webhookConfig = DH_WEBHOOK_URL ? 'present' : 'missing';
  const eligibleButNoWebhook = decision.fire && webhookConfig === 'missing';
  const finalFire = decision.fire && !eligibleButNoWebhook;
  const finalReason = eligibleButNoWebhook ? 'webhook_missing' : decision.reason;

  dhLog('INFO', `[MOVEMENT-DIGEST] decision=${finalFire ? 'fire' : 'skip'}`);
  if (!finalFire) {
    dhLog('INFO', `[MOVEMENT-DIGEST] skipped reason=${finalReason}`);
  }
  dhLog('INFO', `[MOVEMENT-DIGEST] cooldown_active=${decision.cooldown_active}`);
  dhLog('INFO', `[MOVEMENT-DIGEST] cooldown_remaining_ms=${decision.cooldown_remaining_ms}`);
  dhLog('INFO', `[MOVEMENT-DIGEST] threshold_pass=${decision.threshold_pass}`);
  dhLog('INFO', `[MOVEMENT-DIGEST] webhook_config=${webhookConfig}`);
  dhLog('INFO', `[MOVEMENT-DIGEST] env_key=${DH_WEBHOOK_ENV_KEY}`);

  // Replay the provenance of the *last* cooldown arming whenever we
  // skip because of cooldown. This is the operator's primary tool
  // for answering "which prior send armed the gate?" — it always
  // includes the Discord message ID if we have one. If meta is null
  // but _lastMovementDigestAt > 0, surface the discrepancy as a
  // WARN so an out-of-band write is detectable.
  if (finalReason === 'cooldown') {
    if (_lastMovementDigestMeta) {
      const ageMs = Date.now() - _lastMovementDigestAt;
      dhLog('INFO',
        `[MOVEMENT-DIGEST] cooldown_set_by=${_lastMovementDigestMeta.set_by} ` +
        `cooldown_timestamp=${_lastMovementDigestMeta.timestamp} ` +
        `cooldown_reason=${_lastMovementDigestMeta.reason} ` +
        `discord_message_id=${_lastMovementDigestMeta.discord_message_id || 'n/a'} ` +
        `cooldown_age_ms=${ageMs}`
      );
    } else if (_lastMovementDigestAt > 0) {
      dhLog('WARN',
        `[MOVEMENT-DIGEST] cooldown_active but meta=null — ` +
        `_lastMovementDigestAt was set outside _markDigestPosted. ` +
        `last_at_ms=${_lastMovementDigestAt}`
      );
    } else {
      dhLog('WARN',
        `[MOVEMENT-DIGEST] cooldown decision reported cooldown but ` +
        `_lastMovementDigestAt=0 — fomo decision module disagreement`
      );
    }
  }

  // WATCH — post SINGLE STRONGEST only (highest score)
  // Rule: must be specific tradable symbol, correct output format,
  // gated by per-symbol dedupe (identical_state + 6h hard floor).
  if (watch.length > 0) {
    const raw = watch[0]; // Already sorted by score desc
    dhLog('INFO', `[WATCH] Best: ${raw.symbol} ${raw.score}/10 ${raw.direction}`);

    // Enrich with trend age / phase / continuation / transition risk
    // / confirmation+cancellation levels. Uses the cached HTF/LTF
    // candles from scoreInstrument via _safeOHLC (no double-fetch).
    let enriched = raw;
    try {
      const [htf, ltf] = await Promise.all([
        dhFetchCandles(raw.symbol, '1D', 100),
        dhFetchCandles(raw.symbol, '60', 50),
      ]);
      enriched = enrichWatchCandidate(raw, htf || [], ltf || []);
    } catch (e) {
      dhLog('WARN', `[WATCH] enrich failed for ${raw.symbol}: ${e.message} — using fallback payload shape`);
      enriched = Object.assign({}, raw, { dataReliable: false, reliabilityReason: 'enrich_threw' });
    }

    pruneWatchEcho(_lastWatchByEcho);
    const decision = evaluateWatchPostDecision(enriched, _lastWatchByEcho);

    if (!decision.post) {
      const prior = decision.prior || {};
      const lastPosted = prior.postedAt ? new Date(prior.postedAt).toISOString() : 'n/a';
      const nextElig = decision.nextEligibleAt ? new Date(decision.nextEligibleAt).toISOString() : 'n/a';
      dhLog('INFO', `[DH-WATCH] dedupe skip symbol=${enriched.symbol} reason=${decision.reason} stateHash=${decision.stateHash} last_posted=${lastPosted} next_eligible=${nextElig}`);
    } else if (DH_WEBHOOK_URL) {
      try {
        const payload = fomo.sanitize(buildDHPayload(enriched));
        const contentLen = (payload.content || '').length;
        // Watch payloads are single-symbol and well under the 2000-char
        // Discord webhook limit, but we request `wait=true` so the same
        // delivery-proof path (status + message ID) covers both kinds.
        const send = await dhSendWebhook(DH_WEBHOOK_URL, { content: payload.content }, { wait: true });
        if (send && send.ok) {
          _lastWatchByEcho.set(enriched.symbol, { stateHash: decision.stateHash, postedAt: Date.now() });
          dhLog('INFO', `[DH-WATCH] post symbol=${enriched.symbol} stateHash=${decision.stateHash} kind=${payload.kind || 'watch'}` +
                         (payload.replaced ? ' sanitized=true' : ''));
          dhLog('INFO', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=ok kind=watch symbol=${enriched.symbol} ` +
                         `status=${send.status} discord_msg_id=${send.messageId || 'n/a'} contentLen=${contentLen} durationMs=${send.durationMs}`);
        } else {
          dhLog('ERROR', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=watch symbol=${enriched.symbol} contentLen=${contentLen} ${_dhExcerptResponse(send)}`);
        }
      } catch (e) {
        dhLog('ERROR', `[WEBHOOK] Failed — ${enriched.symbol}: ${_dhRedactWebhook(e.message)}`);
        dhLog('ERROR', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=watch symbol=${enriched.symbol} reason=${_dhRedactWebhook(e.message)}`);
      }
    } else {
      dhLog('WARN', 'WEEKLY_DARKHORSES (preferred) and DARKHORSE_STOCK (legacy) both unset — webhook skipped');
      dhLog('WARN', `[DH-CHANNEL] env_key=missing target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=watch reason=env_unset`);
    }

    await triggerPipeline(enriched);
  }
  // ── MOVEMENT DIGEST — finalFire already accounts for cooldown,
  // threshold, watch_present, and webhook_missing. The skip-path
  // logging (with structured reason) was emitted above. ──
  else if (finalFire) {
    dhLog('INFO', `[MOVEMENT-DIGEST] firing — level=${volatility.level} ` +
                  `internal=${volatility.internalCount} reason=${volatility.reason}`);
    try {
      // ── DARK HORSE FOH.1.0.1 — v6 prototype parity ──
      // Default path. Builds a sequence of Discord-renderable
      // messages (banner + per-candidate embeds + tail) from the
      // canonical v6 doctrine. Bypasses the chunker — each message
      // is already Discord-sized and ships in one POST.
      //
      // The legacy v1.3/v1.1 chunked path is preserved below as a
      // fallback (enabled via ATLAS_DH_FOH_LEGACY=1) so a fast
      // env-only rollback exists if a regression surfaces.
      const useFohV6 = process.env.ATLAS_DH_FOH_LEGACY !== '1';
      if (useFohV6) {
        try {
          const foh  = require('./darkHorseFoh');
          const rank = require('./darkHorseRanking');
          const candleProvider = async (sym) => {
            if (typeof _safeOHLC !== 'function') return null;
            try { return await _safeOHLC(sym, '1D', 100); } catch (_e) { return null; }
          };
          const rankingUniverse = [...watch, ...internal];
          const ranking = await rank.buildRanking(rankingUniverse, candleProvider, {
            topN: 10, sectionCap: 2, sectionCapMax: 3,
            watchThreshold: DH_SCORE_WATCH,
          });
          rank.emitRankingLogs(ranking, (line) => dhLog('INFO', line));
          // ── FOH_IMAGE_RENDER_ENABLED — opt-in image path ──
          // When the env flag is set, render the premium PNG+PDF
          // card via the sibling darkHorseImageDispatch module
          // and POST as a single Discord message. Any failure
          // (puppeteer unavailable, render error, post non-2xx)
          // falls through to the existing 6-message text digest
          // below. Production behaviour unchanged unless operator
          // flips the env flag. NEVER reads/writes engine state.
          if (process.env.FOH_IMAGE_RENDER_ENABLED === 'true') {
            try {
              const dhImage = require('./darkHorseImageDispatch');
              const imgRes = await dhImage.tryPostDarkHorseAsImage(DH_WEBHOOK_URL, ranking, volatility, {
                universeSize: DH_UNIVERSE.length,
                watch, internal, ignored,
                coreyLiveModule: _coreyLive,
              });
              if (imgRes && imgRes.ok) {
                _markDigestPosted({
                  set_by: 'movement_digest_send_ok',
                  reason: 'discord_2xx_ack_foh_v6_image',
                  status: imgRes.status,
                  kind: 'movement_digest_foh_v1_0_image',
                });
                dhLog('INFO', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=ok kind=image status=${imgRes.status} pdf_skipped=${imgRes.pdfSkipped ? 'true' : 'false'}`);
                return { watch, internal, ignored, volatility, scannedAt: new Date().toISOString() };
              }
              dhLog('WARN', `[DH-FOH-IMAGE] image render path returned not-ok reason=${imgRes && imgRes.reason}, falling through to text`);
            } catch (imgErr) {
              dhLog('WARN', `[DH-FOH-IMAGE] image render path threw, falling through to text: ${imgErr.message}`);
            }
            // Fall through to existing text FOH v6 path below.
          }
          const fohPayload = foh.buildDarkHorseFohPayload(ranking, volatility, {
            now: Date.now(),
            universeSize: DH_UNIVERSE.length,
            terminologyUrls: null,
          });
          // Sanitiser walker — wraps the existing fomo.sanitize so
          // banned phrases are scrubbed from every embed string field.
          const sanitisedPayload = foh.sanitiseFohMessages(fohPayload.messages, fomo.sanitize);
          const renderedFoh = await foh.renderChartCardAttachments(sanitisedPayload.messages);
          const digestId = 'dh' + Date.now().toString(36);
          dhLog('INFO', `[DH-CHANNEL-DEBUG] kind=${fohPayload.kind} digest_id=${digestId} ` +
                         `candidateCount=${fohPayload.candidateCount} embedCount=${fohPayload.embedCount} ` +
                         `filteredOut=${fohPayload.filteredOut} messageCount=${renderedFoh.messages.length} ` +
                         `chartCardCount=${renderedFoh.chartCardCount} sanitized=${sanitisedPayload.replaced ? 'true' : 'false'}`);
          // Hard guard — refuse to send if any message would exceed
          // Discord limits (content, embed total, or per-field caps).
          let oversize = -1;
          let oversizeDetail = null;
          for (let i = 0; i < renderedFoh.messages.length; i++) {
            const violations = foh.findDiscordLimitViolations(renderedFoh.messages[i]);
            if (violations.length) { oversize = i; oversizeDetail = violations[0]; break; }
          }
          if (oversize >= 0) {
            dhLog('ERROR', `[WEBHOOK] FOH digest aborted — message ${oversize + 1} exceeds Discord limits (${JSON.stringify(oversizeDetail)}). Cooldown NOT armed.`);
          } else {
            // Sequential delivery. Each message awaits the previous.
            // Chain aborts on the first non-ok send.
            const sends = [];
            let aborted = false, failedAt = -1;
            for (let i = 0; i < renderedFoh.messages.length; i++) {
              const m = renderedFoh.messages[i];
              const partLabel = `${i + 1}/${renderedFoh.messages.length}`;
              const body = { content: m.content || '' };
              if (Array.isArray(m.embeds) && m.embeds.length) body.embeds = m.embeds;
              if (Array.isArray(m.files) && m.files.length) body.files = m.files;
              const send = await dhSendWebhook(DH_WEBHOOK_URL, body, { wait: true });
              sends.push(send);
              if (send && send.ok) {
                dhLog('INFO', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=ok kind=${fohPayload.kind} digest_id=${digestId} part=${partLabel} status=${send.status} discord_msg_id=${send.messageId || 'n/a'} embedCount=${(m.embeds||[]).length} fileCount=${(m.files||[]).length} bodyLen=${send.bodyLen} durationMs=${send.durationMs}`);
              } else {
                failedAt = i; aborted = true;
                dhLog('ERROR', `[WEBHOOK] FOH digest aborted at part ${partLabel}. Cooldown NOT armed.`);
                dhLog('ERROR', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=${fohPayload.kind} digest_id=${digestId} part=${partLabel} ${_dhExcerptResponse(send)} level=${volatility.level} internal=${volatility.internalCount}`);
                break;
              }
            }
            if (!aborted) {
              const anchorSend = sends[0];
              _markDigestPosted({
                set_by: 'movement_digest_send_ok',
                reason: 'discord_2xx_ack_foh_v6_' + sanitisedPayload.messages.length,
                discord_message_id: anchorSend.messageId || null,
                status: anchorSend.status,
                kind: fohPayload.kind,
              });
              dhLog('INFO', `[WEBHOOK] FOH digest posted (${sanitisedPayload.messages.length} messages)` +
                             (sanitisedPayload.replaced ? ' (sanitized)' : ''));
            } else {
              dhLog('ERROR', `[WEBHOOK] FOH digest NOT delivered — failed at message ${failedAt + 1}/${sanitisedPayload.messages.length}.`);
            }
          }
          return { watch, internal, ignored, volatility, scannedAt: new Date().toISOString() };
        } catch (fohErr) {
          dhLog('WARN', `[DH-FOH] v6 path failed, falling through to v1.3 legacy: ${fohErr.message}`);
          // Fall through to v1.3 chunked path below.
        }
      }

      // ── DARK HORSE v1.1/v1.3 — chunked legacy fallback ──
      // Original behaviour. Builds a single content string and
      // chunks it through _dhChunkDigest. Reachable only when the
      // FOH v6 path is disabled via ATLAS_DH_FOH_LEGACY=1 or when
      // the FOH builder throws above.
      let payload;
      let kind = 'movement_digest';
      try {
        const rank = require('./darkHorseRanking');
        const candleProvider = async (sym) => {
          if (typeof _safeOHLC !== 'function') return null;
          try { return await _safeOHLC(sym, '1D', 100); }
          catch (_e) { return null; }
        };
        // Universe for ranking = everything that scored > 0 on this scan.
        const rankingUniverse = [...watch, ...internal];
        const ranking = await rank.buildRanking(rankingUniverse, candleProvider, {
          topN: 10, sectionCap: 2, sectionCapMax: 3,
          watchThreshold: DH_SCORE_WATCH,
        });
        rank.emitRankingLogs(ranking, (line) => dhLog('INFO', line));
        // Pre-Radar / Near-Miss lane (operator directive 2026-05-12).
        // The digest builder consumes the FULL scan output (internal +
        // ignored counts + universe size) so it can render the
        // pre-radar / near-miss / quiet-market-reason / waiting-for /
        // universe-coverage supporting-intelligence layer below the
        // main section radar. PRESENTATION LAYER ONLY — does not
        // alter scoring, thresholds, scheduler, transport, or
        // ranking foundation.
        payload = fomo.sanitize(rank.buildRankedMovementDigestPayload(ranking, volatility, {
          internal,                          // 5–7 score band (Pre-Radar + Near-Miss universe)
          ignored,                           // <5 score (Universe Coverage counts only)
          universeSize: DH_UNIVERSE.length,  // total symbols actually scanned this cycle
        }));
        kind = 'movement_digest_v1_1';
      } catch (rankErr) {
        dhLog('WARN', `[DH-RANKING] v1.1 build failed, falling back to v0.1: ${rankErr.message}`);
        payload = fomo.sanitize(fomo.buildMovementDigestPayload(volatility, internal));
      }

      // Post-sanitisation polish (operator directive 2026-05-12 — Lane 3).
      // fomo.sanitize replaces banned phrases with the literal
      // marker "[REDACTED-FOMO]". The marker must never reach the
      // user-facing surface — scrub it here, then clean up the
      // sentence shape (orphan spaces / stray trailing commas /
      // collapsed blank lines) so the redacted text still reads
      // naturally.
      if (payload && payload.content) {
        const before = payload.content;
        let s = payload.content;
        // Strip the redaction markers entirely. Surrounding spacing
        // collapses to a single space.
        s = s.replace(/\[REDACTED-FOMO\]/g, '');
        // Collapse triple+ blank lines that the marker removal may
        // have left behind.
        s = s.replace(/\n{3,}/g, '\n\n');
        // Strip orphan trailing commas at the end of a line (the
        // operator caught "### Heading,\n" and "paragraph,\n"
        // patterns after sanitisation).
        s = s.replace(/,(\s*\n)/g, '$1');
        // Collapse repeated whitespace within a line (excluding
        // newlines) — guards against "word  word" gaps where the
        // marker sat between two words.
        s = s.replace(/[ \t]{2,}/g, ' ');
        // Tidy " ." / " ," / " ;" leftovers from marker removal.
        s = s.replace(/\s+([.,;:])/g, '$1');
        // Tidy trailing spaces left at end-of-line by earlier passes.
        s = s.replace(/[ \t]+\n/g, '\n');
        if (s !== before) {
          dhLog('INFO', '[DH-POLISH] post-sanitisation cleanup applied (redaction-marker / trailing-comma / whitespace polish)');
        }
        payload.content = s;
      }

      const totalContentLen = (payload.content || '').length;
      // Stable identifier for this digest. Lets the operator group
      // every chunk's send_result line in Render logs back to a
      // single scan output.
      const digestId = 'dh' + Date.now().toString(36);

      // Build the ordered chunk list. The chunker preserves
      // section/candidate boundaries and labels each chunk
      // "Part X/Y". A digest that fits under DH_CHUNK_MAX_DEFAULT
      // is returned as a single chunk so single-message delivery
      // is fully backwards compatible.
      const chunks = _dhChunkDigest(payload.content, {
        max: DH_CHUNK_MAX_DEFAULT,
        // Operator directive 2026-05-12 — pass the "NEW DARK HORSE
        // SCAN" boundary block returned by buildRankedMovementDigestPayload
        // through to the chunker so it renders ONCE at the top of
        // Part 1, never on Parts 2..N.
        firstChunkPrefix: payload.firstChunkPrefix,
      });
      const chunkCount = chunks.length;

      // Preflight log — emitted BEFORE any send so the operator
      // can see total content length + chunk count even if zero
      // chunks reach Discord.
      dhLog('INFO', `[DH-CHANNEL-DEBUG] kind=${kind} digest_id=${digestId} ` +
                     `totalContentLen=${totalContentLen} chunkCount=${chunkCount} ` +
                     `chunkMax=${DH_CHUNK_MAX_DEFAULT} wait=true ` +
                     `sanitized=${payload.replaced ? 'true' : 'false'}`);

      // Hard guard: refuse to even attempt a send if any chunk
      // would exceed Discord's 2000-char absolute limit. Cooldown
      // is NOT armed; the next scan retries.
      const oversizeIdx = chunks.findIndex(c => c.length > DH_CHUNK_DISCORD_HARD_LIMIT);
      if (oversizeIdx >= 0) {
        dhLog('ERROR', `[WEBHOOK] Movement digest aborted — chunk ${oversizeIdx + 1}/${chunkCount} length=${chunks[oversizeIdx].length} exceeds Discord ${DH_CHUNK_DISCORD_HARD_LIMIT}-char limit. Cooldown NOT armed.`);
        dhLog('ERROR', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=${kind} digest_id=${digestId} part=${oversizeIdx + 1}/${chunkCount} contentLen=${chunks[oversizeIdx].length} reason=chunk_exceeds_hard_limit level=${volatility.level} internal=${volatility.internalCount}`);
      } else {
        // Sequential delivery. Each chunk awaits the previous
        // result. The chain aborts on the first non-ok send so
        // we never publish a partially delivered digest.
        const sends = [];
        let aborted = false;
        let failedAt = -1;
        for (let i = 0; i < chunkCount; i++) {
          const partLabel = `${i + 1}/${chunkCount}`;
          const chunkContent = chunks[i];
          const chunkLen = chunkContent.length;
          dhLog('INFO', `[DH-CHANNEL-DEBUG] kind=${kind} digest_id=${digestId} part=${partLabel} chunkLen=${chunkLen} wait=true`);
          const send = await dhSendWebhook(DH_WEBHOOK_URL, { content: chunkContent }, { wait: true });
          sends.push(send);
          if (send && send.ok) {
            dhLog('INFO', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=ok kind=${kind} digest_id=${digestId} part=${partLabel} ` +
                           `status=${send.status} discord_msg_id=${send.messageId || 'n/a'} contentLen=${chunkLen} bodyLen=${send.bodyLen} durationMs=${send.durationMs}`);
          } else {
            failedAt = i;
            aborted = true;
            dhLog('ERROR', `[WEBHOOK] Movement digest aborted at part ${partLabel} — Discord rejected the chunk. Cooldown NOT armed.`);
            dhLog('ERROR', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=${kind} digest_id=${digestId} part=${partLabel} contentLen=${chunkLen} ${_dhExcerptResponse(send)} level=${volatility.level} internal=${volatility.internalCount}`);
            break;
          }
        }
        if (!aborted) {
          // Every chunk delivered. Anchor cooldown to the FIRST
          // chunk's message ID so the operator can match the
          // cooldown line back to the visible Discord post that
          // started the digest.
          const anchorSend = sends[0];
          _markDigestPosted({
            set_by: 'movement_digest_send_ok',
            reason: chunkCount > 1
              ? `discord_2xx_ack_chunked_${chunkCount}`
              : 'discord_2xx_ack',
            discord_message_id: anchorSend.messageId || null,
            status: anchorSend.status,
            kind,
          });
          dhLog('INFO', `[WEBHOOK] Movement digest posted (${chunkCount} chunk${chunkCount > 1 ? 's' : ''})` +
                         (payload.replaced ? ' (sanitized)' : ''));
        } else {
          dhLog('ERROR', `[WEBHOOK] Movement digest NOT delivered — failed at chunk ${failedAt + 1}/${chunkCount}. ${failedAt} prior chunk${failedAt === 1 ? '' : 's'} were posted but the digest is incomplete.`);
        }
      }
    } catch (e) {
      dhLog('ERROR', `[WEBHOOK] Movement digest failed: ${_dhRedactWebhook(e.message)}`);
      dhLog('ERROR', `[DH-CHANNEL] env_key=${DH_WEBHOOK_ENV_KEY} target_channel=${DH_TARGET_CHANNEL} send_result=fail kind=movement_digest reason=${_dhRedactWebhook(e.message)}`);
    }
  }

  return { watch, internal, ignored, volatility, scannedAt: new Date().toISOString() };
}

// ============================================================
// ACCESSORS
// ============================================================
function getDHInternalStore() { return Object.fromEntries(DH_INTERNAL_STORE); }
function getDHCandidate(symbol) { return DH_INTERNAL_STORE.get(symbol) || null; }

// ============================================================
// EXPORTS
// ============================================================
// Test hook: reset the watch-echo dedupe map. Used by
// scripts/test_dark_horse_watch.js. NOT for runtime use.
function __resetWatchEchoForTests() { _lastWatchByEcho.clear(); }
// Test hook: read-only snapshot of the watch-echo map.
function __getWatchEchoForTests() {
  const out = {};
  for (const [k, v] of _lastWatchByEcho.entries()) out[k] = { stateHash: v.stateHash, postedAt: v.postedAt };
  return out;
}

// ── Movement-digest cooldown test hooks ──
// Used by scripts/test_dh_cooldown_qa.js. NOT for runtime use.
function __resetMovementDigestForTests() {
  _lastMovementDigestAt = 0;
  _lastMovementDigestMeta = null;
}
function __getMovementDigestAtForTests() { return _lastMovementDigestAt; }
function __getMovementDigestMetaForTests() {
  return _lastMovementDigestMeta ? Object.assign({}, _lastMovementDigestMeta) : null;
}

module.exports = {
  dhInit,
  dhSetPipelineTrigger,
  runDarkHorseScan,
  getDHInternalStore,
  getDHCandidate,
  DH_UNIVERSE,
  // Watch payload + dedupe surface — exported for tests + downstream consumers.
  buildDHPayload,
  enrichWatchCandidate,
  computeWatchStateHash,
  evaluateWatchPostDecision,
  pruneWatchEcho,
  laymanVixLabel,
  DH_WATCH_MIN_INTERVAL_MS,
  DH_WATCH_HARD_FLOOR_MS,
  DH_WATCH_ECHO_TTL_MS,
  __resetWatchEchoForTests,
  __getWatchEchoForTests,
  // Delivery-verification surface — exported for the qa:dh-delivery
  // harness. dhSendWebhook returns the structured delivery report;
  // the redact + excerpt helpers are exposed so the harness can
  // verify webhook URLs never leak into log lines.
  dhSendWebhook,
  _dhRedactWebhook,
  _dhExcerptResponse,
  // Transport-chunking surface — exported for the qa:dh-chunking
  // harness. _dhChunkDigest splits a v1.1 digest into Part X/Y
  // ordered chunks that each fit under Discord's webhook limit.
  _dhChunkDigest,
  DH_CHUNK_MAX_DEFAULT,
  DH_CHUNK_DISCORD_HARD_LIMIT,
  // Cooldown provenance surface — exported for the qa:dh-cooldown
  // harness. _markDigestPosted is the SINGLE write site for the
  // movement-digest cooldown; the test hooks let the harness reset
  // state, drive the gate, and inspect provenance without going
  // through a full scan.
  _markDigestPosted,
  __resetMovementDigestForTests,
  __getMovementDigestAtForTests,
  __getMovementDigestMetaForTests,
};
