'use strict';
// ============================================================
// ATLAS FX — DARK HORSE ENGINE v1.0
// Scan layer only. No trades. No execution. No Jane bypass.
// Flow: DarkHorseEngine → FX Bot → Corey → Spidey → Jane
// ============================================================

const https = require('https');

// ── CONFIGURATION ─────────────────────────────────────────────
const DH_UNIVERSE = (process.env.DARKHORSE_UNIVERSE || '')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean).length
    ? (process.env.DARKHORSE_UNIVERSE || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDJPY', 'NAS100', 'SPX', 'XAGUSD', 'MICRON'];

const DH_SCORE_WATCH    = 8;
const DH_SCORE_INTERNAL = 5;

// Webhooks — env only, never hardcoded
// Names match Render environment variables exactly
const DH_WEBHOOK_URL = process.env.DARKHORSE_STOCK || null;

// Astra individual channels — Dark Horse does NOT post here
// Dark Horse posts to DARKHORSE_STOCK only (one shared channel)
const DH_ASTRA_WEBHOOKS = {};

// ── MARKET HOURS GATE ─────────────────────────────────────────
// No scanning Friday 17:00 NY time through Sunday 17:00 NY time
// (covers weekend market closure globally)
function isMarketOpen() {
  const now = new Date();
  // Convert to New York time
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyTime.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  // Friday after 17:00 NY → market closed
  if (day === 5 && timeInMinutes >= 17 * 60) return false;
  // Saturday — always closed
  if (day === 6) return false;
  // Sunday before 17:00 NY → still closed
  if (day === 0 && timeInMinutes < 17 * 60) return false;

  return true;
}

// ── INTERNAL STATE ────────────────────────────────────────────
// Flagged candidates score 5–7 — stored internally, no Discord output
const DH_INTERNAL_STORE = new Map();

// ── LOGGER ────────────────────────────────────────────────────
const dhLog = (level, msg, ...a) =>
  console.log(`[${new Date().toISOString()}] [DH-${level}] ${msg}`, ...a);

// ============================================================
// INIT — inject safeOHLC from bot.js at startup
// ============================================================
let _safeOHLC = null;

function dhInit(safeOHLCFn) {
  _safeOHLC = safeOHLCFn;
  dhLog('INFO', 'Dark Horse Engine initialised.');
}

async function dhFetchCandles(symbol, interval, count = 100) {
  if (!_safeOHLC) {
    dhLog('WARN', `safeOHLC not injected — cannot fetch ${symbol} ${interval}`);
    return null;
  }
  return _safeOHLC(symbol, interval, count);
}

// ============================================================
// SCORING — 5 conditions × 2pts = 10 max
// ============================================================

// 1. LIQUIDITY BUILD (+2)
// Equal highs or equal lows — retail stops clustered above/below price.
function scoreLiquidityBuild(htfCandles) {
  const reasons = [];
  if (!htfCandles || htfCandles.length < 20) return { score: 0, reasons };

  const tol = 0.0008;
  let eqH = 0, eqL = 0;

  for (let i = 0; i < htfCandles.length - 1; i++) {
    for (let j = i + 1; j < htfCandles.length; j++) {
      const dH = Math.abs(htfCandles[i].high - htfCandles[j].high) / (htfCandles[i].high || 1);
      const dL = Math.abs(htfCandles[i].low  - htfCandles[j].low)  / (htfCandles[i].low  || 1);
      if (dH < tol) eqH++;
      if (dL < tol) eqL++;
    }
  }

  if (eqH >= 2 || eqL >= 2) {
    const tag = eqH >= 2 && eqL >= 2
      ? 'Equal highs + equal lows — bilateral liquidity build detected'
      : eqH >= 2
        ? 'Equal highs present — buy-side liquidity resting above price'
        : 'Equal lows present — sell-side liquidity resting below price';
    reasons.push(tag);
    return { score: 2, reasons };
  }
  return { score: 0, reasons };
}

// 2. COMPRESSION (+2)
// Tight range relative to baseline — coil before expansion.
function scoreCompression(htfCandles) {
  const reasons = [];
  if (!htfCandles || htfCandles.length < 30) return { score: 0, reasons };

  const recent   = htfCandles.slice(-10);
  const baseline = htfCandles.slice(-30, -10);

  const avgRange = arr =>
    arr.reduce((s, c) => s + (c.high - c.low), 0) / arr.length;

  const rR = avgRange(recent);
  const bR = avgRange(baseline);

  if (bR > 0 && rR / bR < 0.55) {
    reasons.push(
      `Compression active — recent range ${(rR / bR * 100).toFixed(0)}% of baseline average (expansion imminent)`
    );
    return { score: 2, reasons };
  }
  return { score: 0, reasons };
}

// 3. HTF MISALIGNMENT (+2)
// LTF moving against HTF dominant trend — counter-trend move in progress.
function scoreHTFMisalignment(htfCandles, ltfCandles) {
  const reasons = [];
  if (!htfCandles || !ltfCandles || htfCandles.length < 20 || ltfCandles.length < 10)
    return { score: 0, reasons };

  const htfOld   = htfCandles[htfCandles.length - 20].close;
  const htfNow   = htfCandles[htfCandles.length - 1].close;
  const htfTrend = htfNow > htfOld ? 'Bullish' : 'Bearish';

  const ltfSlice = ltfCandles.slice(-5);
  const ltfStart = ltfSlice[0].close;
  const ltfEnd   = ltfSlice[ltfSlice.length - 1].close;
  const ltfMomentum = ltfEnd > ltfStart ? 'Bullish' : 'Bearish';

  if (htfTrend !== ltfMomentum) {
    reasons.push(
      `HTF trend ${htfTrend} — LTF momentum ${ltfMomentum} (counter-trend move against dominant structure)`
    );
    return { score: 2, reasons };
  }
  return { score: 0, reasons };
}

// 4. IMBALANCE PROXIMITY (+2)
// Unfilled FVG within 0.5% of current price.
function scoreImbalanceProximity(htfCandles) {
  const reasons = [];
  if (!htfCandles || htfCandles.length < 10) return { score: 0, reasons };

  const cp = htfCandles[htfCandles.length - 1].close;
  const proxThreshold = 0.005;

  for (let i = 0; i < htfCandles.length - 2; i++) {
    const c1 = htfCandles[i];
    const c3 = htfCandles[i + 2];

    if (c3.low > c1.high) {
      const mid = (c1.high + c3.low) / 2;
      if (Math.abs(cp - mid) / (cp || 1) < proxThreshold) {
        reasons.push(
          `Bullish imbalance (FVG) unfilled — gap ${c1.high.toFixed(5)}–${c3.low.toFixed(5)} within 0.5% of current price`
        );
        return { score: 2, reasons };
      }
    }

    if (c3.high < c1.low) {
      const mid = (c1.low + c3.high) / 2;
      if (Math.abs(cp - mid) / (cp || 1) < proxThreshold) {
        reasons.push(
          `Bearish imbalance (FVG) unfilled — gap ${c3.high.toFixed(5)}–${c1.low.toFixed(5)} within 0.5% of current price`
        );
        return { score: 2, reasons };
      }
    }
  }
  return { score: 0, reasons };
}

// 5. INDUCEMENT (+2)
// Retail zone swept or price at round number — institutional trap in progress.
function scoreInducement(htfCandles) {
  const reasons = [];
  if (!htfCandles || htfCandles.length < 20) return { score: 0, reasons };

  const cp  = htfCandles[htfCandles.length - 1].close;
  const recent = htfCandles.slice(-20);

  const swingH = Math.max(...recent.slice(0, -3).map(c => c.high));
  const swingL = Math.min(...recent.slice(0, -3).map(c => c.low));

  const lastCandle = htfCandles[htfCandles.length - 1];
  const sweptHigh  = lastCandle.high > swingH && lastCandle.close < swingH;
  const sweptLow   = lastCandle.low  < swingL && lastCandle.close > swingL;

  if (sweptHigh) {
    reasons.push(
      `Buy-side sweep complete — price raided swing high (${swingH.toFixed(5)}) and closed below (inducement confirmed)`
    );
    return { score: 2, reasons };
  }
  if (sweptLow) {
    reasons.push(
      `Sell-side sweep complete — price raided swing low (${swingL.toFixed(5)}) and closed above (inducement confirmed)`
    );
    return { score: 2, reasons };
  }

  // Round number proximity
  const roundMagnitude = cp > 100 ? 10 : cp > 10 ? 1 : cp > 1 ? 0.1 : 0.01;
  const nearestRound   = Math.round(cp / roundMagnitude) * roundMagnitude;
  const roundDist      = Math.abs(cp - nearestRound) / (cp || 1);

  if (roundDist < 0.003) {
    reasons.push(
      `Round number inducement — price within 0.3% of ${nearestRound} (retail magnet, institutional trap zone)`
    );
    return { score: 2, reasons };
  }

  return { score: 0, reasons };
}

// ============================================================
// SCORE SINGLE INSTRUMENT
// ============================================================
async function scoreInstrument(symbol) {
  dhLog('INFO', `Scoring ${symbol}`);

  const [htf, ltf] = await Promise.all([
    dhFetchCandles(symbol, '1D', 100),
    dhFetchCandles(symbol, '60', 100),
  ]);

  if (!htf || htf.length < 20) {
    dhLog('WARN', `${symbol} — insufficient HTF data, skipping`);
    return null;
  }

  const liq  = scoreLiquidityBuild(htf);
  const comp = scoreCompression(htf);
  const misA = scoreHTFMisalignment(htf, ltf);
  const imbP = scoreImbalanceProximity(htf);
  const indu = scoreInducement(htf);

  const total   = liq.score + comp.score + misA.score + imbP.score + indu.score;
  const reasons = [
    ...liq.reasons,
    ...comp.reasons,
    ...misA.reasons,
    ...imbP.reasons,
    ...indu.reasons,
  ];

  dhLog('INFO', `${symbol} → ${total}/10 (${reasons.length} condition(s) triggered)`);

  return {
    symbol,
    score:        total,
    reasons,
    status:       total >= DH_SCORE_WATCH ? 'WATCH' : total >= DH_SCORE_INTERNAL ? 'INTERNAL' : 'IGNORED',
    currentPrice: htf[htf.length - 1].close,
    timestamp:    Date.now(),
  };
}

// ============================================================
// WEBHOOK DELIVERY
// ============================================================
function dhSendWebhook(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    if (!webhookUrl) {
      resolve(null);
      return;
    }

    const body = JSON.stringify(payload);
    const url  = new URL(webhookUrl);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'ATLAS-FX-DarkHorse/1.0',
      },
      timeout: 10000,
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

// Dark Horse channel payload
function buildDHPayload(candidate) {
  const reasonLines = candidate.reasons.length
    ? candidate.reasons.map(r => `- ${r}`).join('\n')
    : '- Composite score threshold met';

  const content =
    `🐎 **ATLAS DARK HORSE**\n\n` +
    `**Symbol:** ${candidate.symbol}\n` +
    `**Score:** ${candidate.score}/10\n\n` +
    `**Reasons:**\n${reasonLines}\n\n` +
    `**Status:**\n⏳ WATCH — Await confirmation\n\n` +
    `**Rule:**\nThis is NOT a trade signal.\n` +
    `Dark Horse is a scan flag only. Pipeline: Corey → Spidey → Jane.`;

  return { content };
}

// Astra channel payload — includes darkHorseFlag for Astra context
function buildAstraPayload(candidate) {
  const reasonLines = candidate.reasons.length
    ? candidate.reasons.map(r => `- ${r}`).join('\n')
    : '- Composite score threshold met';

  const content =
    `🐎 **ATLAS DARK HORSE — PIPELINE FLAG**\n\n` +
    `**Symbol:** ${candidate.symbol}\n` +
    `**Score:** ${candidate.score}/10\n` +
    `**darkHorseFlag:** \`true\`\n\n` +
    `**Triggered Conditions:**\n${reasonLines}\n\n` +
    `**Astra Reference:**\n` +
    `This instrument has been flagged by Dark Horse Engine and is entering the standard pipeline.\n` +
    `Corey → Spidey → Jane will deliver full analysis.\n\n` +
    `⚠️ Dark Horse flag alone does NOT constitute a trade decision.\n` +
    `Jane retains final authority.`;

  return { content };
}

// ============================================================
// PIPELINE TRIGGER
// Injects symbol into standard pipeline via injected function.
// darkHorseFlag is metadata only — Jane receives symbol + Corey + Spidey output.
// Jane NEVER receives raw Dark Horse data directly.
// ============================================================
let _pipelineTrigger = null;

function dhSetPipelineTrigger(fn) {
  _pipelineTrigger = fn;
  dhLog('INFO', 'Pipeline trigger registered.');
}

async function triggerPipeline(candidate) {
  if (!_pipelineTrigger) {
    dhLog('WARN', `Pipeline trigger not set — ${candidate.symbol} will not enter pipeline automatically`);
    return;
  }
  dhLog('INFO', `Pipeline trigger → ${candidate.symbol} (DH score: ${candidate.score}/10)`);
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
// ============================================================
async function runDarkHorseScan(universe) {
  // Market hours gate — no scanning on weekends
  if (!isMarketOpen()) {
    dhLog('INFO', '━━━ Scan SKIPPED — market closed (weekend) ━━━');
    return { watch: [], internal: [], ignored: [], scannedAt: new Date().toISOString(), skipped: true };
  }
  const symbols = (universe && universe.length) ? universe : DH_UNIVERSE;
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

  const watch    = results.filter(r => r.score >= DH_SCORE_WATCH);
  const internal = results.filter(r => r.score >= DH_SCORE_INTERNAL && r.score < DH_SCORE_WATCH);
  const ignored  = results.filter(r => r.score < DH_SCORE_INTERNAL);

  dhLog('INFO', `━━━ Scan COMPLETE — WATCH:${watch.length} INTERNAL:${internal.length} IGNORED:${ignored.length} ━━━`);

  // Store internal 5–7 — no Discord output
  for (const r of internal) {
    DH_INTERNAL_STORE.set(r.symbol, {
      score:     r.score,
      reasons:   r.reasons,
      timestamp: r.timestamp,
    });
    dhLog('INFO', `[INTERNAL] ${r.symbol} ${r.score}/10 — stored, no output`);
  }

  // WATCH ≥8 — post to Discord + trigger pipeline
  for (const candidate of watch) {
    dhLog('INFO', `[WATCH] ${candidate.symbol} ${candidate.score}/10`);

    // Dark Horse channel
    if (DH_WEBHOOK_URL) {
      try {
        await dhSendWebhook(DH_WEBHOOK_URL, buildDHPayload(candidate));
        dhLog('INFO', `[WEBHOOK] Dark Horse posted — ${candidate.symbol}`);
      } catch (e) {
        dhLog('ERROR', `[WEBHOOK] Dark Horse failed — ${candidate.symbol}: ${e.message}`);
      }
    } else {
      dhLog('WARN', 'DARKHORSE_STOCK not set — Dark Horse channel skipped');
    }

    // All Astra channels (AT / SK / NM / BR)
    for (const [user, url] of Object.entries(DH_ASTRA_WEBHOOKS)) {
      if (!url) {
        dhLog('WARN', `ASTRA_WEBHOOK_${user} not configured — skipped`);
        continue;
      }
      try {
        await dhSendWebhook(url, buildAstraPayload(candidate));
        dhLog('INFO', `[ASTRA] Posted to ${user} — ${candidate.symbol}`);
      } catch (e) {
        dhLog('ERROR', `[ASTRA] Failed ${user} / ${candidate.symbol}: ${e.message}`);
      }
    }

    // Standard pipeline — Corey → Spidey → Jane
    await triggerPipeline(candidate);
  }

  return {
    watch,
    internal,
    ignored,
    scannedAt: new Date().toISOString(),
  };
}

// ============================================================
// ACCESSORS
// ============================================================
function getDHInternalStore() {
  return Object.fromEntries(DH_INTERNAL_STORE);
}

function getDHCandidate(symbol) {
  return DH_INTERNAL_STORE.get(symbol) || null;
}

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
