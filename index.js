// ============================================================
// ATLAS FX DISCORD BOT — UNIFIED FINAL BUILD (FAST MODE)
// ============================================================
//
// COMMANDS (in group channels only):
//   !EURUSDH          — Render HTF charts (Weekly, Daily, 4H, 1H)
//   !EURUSDL          — Render LTF charts (4H, 1H, 15M, 1M)
//   !EURUSDL /macro   — Generate macro analysis
//   !EURUSDL /roadmap — Generate weekly roadmap
//   !ping             — Health check
//
// GROUPS: AT | SK | NM | BR
// Rendering: FAST MODE, 2560x1440, light theme
// Safety: lock before enqueue, per-group+symbol lock, hard timeout, dedupe
// ============================================================

process.on('unhandledRejection', (reason) => { console.error('[UNHANDLED REJECTION]', reason); });
process.on('uncaughtException',  (err)    => { console.error('[UNCAUGHT EXCEPTION]', err); });

const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
} = require('discord.js');

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

// ============================================================
// CONFIG
// ============================================================

const TOKEN       = process.env.DISCORD_BOT_TOKEN;
const EXPORT_DIR  = process.env.EXPORT_DIR || path.join(__dirname, 'exports');
const MAX_RETRIES = Number(process.env.MAX_RENDER_RETRIES || 2);
const STATE_TTL   = 1000 * 60 * 60 * 2; // 2 hours
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS || 15000);
const CHART_LOAD_WAIT_MS = Number(process.env.CHART_LOAD_WAIT_MS || 2000);
const MESSAGE_DEDUPE_TTL_MS = 30000;

if (!TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

console.log('[BOOT] ATLAS FX Bot starting...');

// ============================================================
// GROUP + CHANNEL CONFIG
// ============================================================

const CHANNEL_GROUP_MAP = {
  // request channels
  '1432642672287547453': 'AT',
  '1432643496375881748': 'SK',
  '1432644116868501595': 'NM',
  '1482450651765149816': 'BR',

  // combined channels if commands are ever run there
  '1432080184458350672': 'AT',
  '1430950313484878014': 'SK',
  '1431192381029482556': 'NM',
  '1482451091630194868': 'BR',
};

const COMBINED_WEBHOOKS = {
  AT: process.env.AT_COMBINED_WEBHOOK,
  SK: process.env.SK_COMBINED_WEBHOOK,
  NM: process.env.NM_COMBINED_WEBHOOK,
  BR: process.env.BR_COMBINED_WEBHOOK,
};

// Optional direct output channels
const MACRO_CHANNELS = {
  AT: process.env.AT_MACRO_CHANNEL_ID || null,
  SK: process.env.SK_MACRO_CHANNEL_ID || null,
  NM: process.env.NM_MACRO_CHANNEL_ID || null,
  BR: process.env.BR_MACRO_CHANNEL_ID || null,
};

const ROADMAP_CHANNELS = {
  AT: process.env.AT_ROADMAP_CHANNEL_ID || null,
  SK: process.env.SK_ROADMAP_CHANNEL_ID || null,
  NM: process.env.NM_ROADMAP_CHANNEL_ID || null,
  BR: process.env.BR_ROADMAP_CHANNEL_ID || null,
};

// ============================================================
// VALID SYMBOLS
// ============================================================

const VALID_SYMBOLS = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF',
  'XAUUSD', 'XAGUSD',
  'NAS100', 'US500', 'GER40', 'SPX', 'NDX', 'DJI', 'DAX', 'US30', 'UK100',
  'CL', 'BRENT', 'UKOIL', 'NATGAS', 'NG',
  'MICRON', 'MU', 'AMD', 'ASML',
]);

// ============================================================
// SYMBOL ROUTING
// ============================================================

const SYMBOL_OVERRIDES = {
  'MICRON': 'NASDAQ:MU',
  'MU':     'NASDAQ:MU',
  'AMD':    'NASDAQ:AMD',
  'ASML':   'NASDAQ:ASML',
  'NAS100': 'OANDA:NAS100USD',
  'US500':  'OANDA:SPX500USD',
  'GER40':  'OANDA:DE30EUR',
  'SPX':    'INDEX:SPX',
  'NDX':    'INDEX:NDX',
  'DJI':    'INDEX:DJI',
  'DAX':    'INDEX:DAX',
  'US30':   'INDEX:US30',
  'UK100':  'INDEX:UK100',
  'CL':     'NYMEX:CL1!',
  'BRENT':  'NYMEX:BB1!',
  'NATGAS': 'NYMEX:NG1!',
  'NG':     'NYMEX:NG1!',
};

function getTVSymbol(symbol) {
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;
  return `NASDAQ:${symbol}`;
}

function buildChartUrl(symbol, interval) {
  const tvSymbol = encodeURIComponent(getTVSymbol(symbol));
  return `https://www.tradingview.com/chart/?symbol=${tvSymbol}&interval=${interval}&theme=light`;
}

// ============================================================
// TIMEFRAMES
// ============================================================

const TF_HIGH = [
  { key: '1W',  label: 'Weekly', interval: '1W'  },
  { key: '1D',  label: 'Daily',  interval: '1D'  },
  { key: '4H',  label: '4H',     interval: '240' },
  { key: '1H',  label: '1H',     interval: '60'  },
];

const TF_LOW = [
  { key: '4H',  label: '4H',  interval: '240' },
  { key: '1H',  label: '1H',  interval: '60'  },
  { key: '15M', label: '15M', interval: '15'  },
  { key: '1M',  label: '1M',  interval: '1'   },
];

// ============================================================
// COMMAND PARSER
// ============================================================

function parseCommand(content) {
  const trimmed = (content || '').trim();

  if (trimmed === '!ping') return { action: 'ping' };

  const chartOnly = trimmed.match(/^!([A-Z0-9]{2,10})([LH])$/i);
  if (chartOnly) {
    return {
      action: 'chart',
      symbol: chartOnly[1].toUpperCase(),
      mode:   chartOnly[2].toUpperCase(),
    };
  }

  const withAction = trimmed.match(/^!([A-Z0-9]{2,10})([LH])\s*\/(macro|roadmap)$/i);
  if (withAction) {
    return {
      action: withAction[3].toLowerCase(),
      symbol: withAction[1].toUpperCase(),
      mode:   withAction[2].toUpperCase(),
    };
  }

  return null;
}

// ============================================================
// HARD TIMEOUT WRAPPER
// ============================================================

function withTimeout(promise, ms = RENDER_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Render timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// ============================================================
// MESSAGE DEDUPE
// ============================================================

const PROCESSED_MESSAGES = new Set();

function rememberMessage(messageId) {
  PROCESSED_MESSAGES.add(messageId);
  setTimeout(() => PROCESSED_MESSAGES.delete(messageId), MESSAGE_DEDUPE_TTL_MS);
}

// ============================================================
// PER-GROUP+SYMBOL LOCK
// Applied BEFORE enqueue to block duplicate commands immediately
// ============================================================

const RUNNING = {};

function getLockKey(group, symbol, action = 'chart') {
  return `${group}::${symbol}::${action}`;
}

function isLocked(lockKey) { return !!RUNNING[lockKey]; }
function lock(lockKey)     { RUNNING[lockKey] = true; }
function unlock(lockKey)   { delete RUNNING[lockKey]; }

// ============================================================
// STATE MACHINE
// ============================================================

const STATE = {};

function ensureState(group, symbol) {
  if (!STATE[group]) STATE[group] = {};
  if (!STATE[group][symbol]) {
    STATE[group][symbol] = {
      ltf: null,
      htf: null,
      macro: null,
      roadmap: null,
      ts: null,
      combinedSignature: null,
    };
  }
  return STATE[group][symbol];
}

function touch(s) {
  s.ts = Date.now();
}

function isFresh(s) {
  return s.ts && (Date.now() - s.ts < STATE_TTL);
}

function isReadyToCombine(s) {
  return s.ltf && s.macro && isFresh(s);
}

function cleanupOldState() {
  const now = Date.now();
  for (const group of Object.keys(STATE)) {
    for (const symbol of Object.keys(STATE[group])) {
      const s = STATE[group][symbol];
      if (!s.ts || now - s.ts > STATE_TTL) {
        delete STATE[group][symbol];
      }
    }
    if (Object.keys(STATE[group]).length === 0) {
      delete STATE[group];
    }
  }
}

// ============================================================
// ARCHIVE
// ============================================================

function buildArchiveDir(symbol) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return path.join(EXPORT_DIR, symbol, dateStr);
}

function buildFilename(symbol, tfKey) {
  const date = new Date().toISOString().slice(0, 10);
  return `${date}_${symbol}_${tfKey}.jpg`;
}

function saveToArchive(buffer, symbol, tfKey) {
  try {
    const dir = buildArchiveDir(symbol);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, buildFilename(symbol, tfKey)), buffer);
    console.log('[ARCHIVE]', symbol, tfKey);
  } catch (err) {
    console.error('[ARCHIVE ERROR]', err.message);
  }
}

// ============================================================
// QUEUE
// ============================================================

const queue = [];
let queueRunning = false;

function enqueue(job) {
  queue.push(job);
  void processQueue();
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;

  while (queue.length > 0) {
    const job = queue.shift();
    try {
      await job();
    } catch (err) {
      console.error('[QUEUE ERROR]', err.message);
    }
  }

  queueRunning = false;
}

// ============================================================
// BROWSER (persistent, auto-reset on crash)
// ============================================================

let browser = null;

async function getBrowser() {
  if (!browser) {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    browser.on('disconnected', () => {
      console.warn('[BROWSER] Disconnected — will relaunch on next render');
      browser = null;
    });
  }
  return browser;
}

// ============================================================
// FAST RENDER ENGINE
// Minimal interaction for speed + reliability
// ============================================================

async function renderChart(symbol, interval, tfKey) {
  const url = buildChartUrl(symbol, interval);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let context;
    try {
      console.log(`[FAST RENDER] ${symbol} ${tfKey} attempt ${attempt}/${MAX_RETRIES}`);

      const b = await getBrowser();

      context = await b.newContext({
        viewport: { width: 2560, height: 1440 },
        deviceScaleFactor: 2,
      });

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(15000);
      page.setDefaultTimeout(15000);

      await page.addInitScript(() => {
        try {
          localStorage.setItem('theme', 'light');
        } catch (_) {}
      });

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      await page.waitForTimeout(CHART_LOAD_WAIT_MS);

      const raw = await page.screenshot({
        type: 'png',
        fullPage: false,
      });

      await context.close();

      const optimised = await sharp(raw)
        .resize(2560, 1440, { fit: 'cover' })
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();

      console.log(`[FAST OK] ${symbol} ${tfKey} ${(optimised.length / 1024 / 1024).toFixed(2)}MB`);
      return optimised;

    } catch (err) {
      console.error(`[FAST FAIL] ${symbol} ${tfKey} attempt ${attempt}: ${err.message}`);

      if (context) {
        try { await context.close(); } catch (_) {}
      }

      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

// ============================================================
// RENDER BATCH — SEQUENTIAL
// ============================================================

async function renderBatch(symbol, tfs) {
  const files = [];

  for (const tf of tfs) {
    const buf = await withTimeout(
      renderChart(symbol, tf.interval, tf.key),
      RENDER_TIMEOUT_MS
    );

    saveToArchive(buf, symbol, tf.key);

    files.push({
      buf,
      name: buildFilename(symbol, tf.key),
      label: tf.label,
      tfKey: tf.key,
    });
  }

  return files;
}

// ============================================================
// LEVEL SYSTEM
// ============================================================

function getUserLevel(_userId) {
  return 1;
}

// ============================================================
// MACRO + ROADMAP (placeholders)
// ============================================================

function generateMacro(symbol, level = 1) {
  if (level === 5) {
    return `**${symbol} Macro**\n\nBias: Bearish\nDraw: 1.1550 liquidity\nState: Post-sweep → pullback`;
  }

  if (level === 1) {
    return `**${symbol} Macro**\n\nBias: Bearish\n\nLiquidity means areas where orders and stop losses sit.\nPrice is likely moving toward 1.1550 liquidity.\n\nState:\nPost-sweep → pullback\n\nLevels:\n1.1625 / 1.1580 / 1.1550`;
  }

  return `**${symbol} Macro**\n\nBias: Bearish\nDraw: 1.1550 liquidity\nState: Post-sweep → pullback\n\nLevels:\n1.1625 / 1.1580 / 1.1550`;
}

function generateRoadmap(symbol, level = 1) {
  if (level === 5) {
    return `**${symbol} Weekly Roadmap**\n\nRange: 1.1700 – 1.1450\nPrimary Draw: Downside liquidity\nHTF Supply: Holding`;
  }

  if (level === 1) {
    return `**${symbol} Weekly Roadmap**\n\nRange: 1.1700 – 1.1450\nPrimary Draw: Downside liquidity\nHTF Supply: Holding\n\nThis roadmap is the wider week view from now until market close.`;
  }

  return `**${symbol} Weekly Roadmap**\n\nRange: 1.1700 – 1.1450\nPrimary Draw: Downside liquidity\nHTF Supply: Holding`;
}

// ============================================================
// DISCORD / WEBHOOK SENDING
// ============================================================

async function safeReply(msg, content) {
  try {
    return await msg.reply(content);
  } catch (err) {
    console.error('[REPLY ERROR]', err.message);
    return null;
  }
}

async function safeSend(channel, payload) {
  try {
    return await channel.send(payload);
  } catch (err) {
    console.error('[SEND ERROR]', err.message);
    return null;
  }
}

async function sendTextToChannelId(client, channelId, content) {
  if (!channelId) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return false;
    await channel.send({ content });
    return true;
  } catch (err) {
    console.error('[DIRECT CHANNEL SEND ERROR]', err.message);
    return false;
  }
}
async function sendToWebhook(webhookUrl, content, files) {
  if (!webhookUrl) return;

  try {
    // TEXT ONLY
    if (!files || files.length === 0) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      return;
    }

    // WITH FILES (NODE SAFE)
    const form = new FormData();

    form.append("payload_json", JSON.stringify({ content }));

    files.forEach((f, i) => {
      form.append(`files[${i}]`, f.buf, f.name);
    });

    await fetch(webhookUrl, {
      method: "POST",
      body: form
    });

  } catch (err) {
    console.error("[WEBHOOK ERROR]", err.message);
  }
}
// ============================================================
// COMBINE + SEND TO GROUP WEBHOOK
// ============================================================

function buildCombinedText(symbol, s) {
  let out = `📊 **${symbol} — ATLAS VIEW**\n\n`;
  out += `__Macro (Today)__\n${s.macro}\n\n`;

  if (s.roadmap) {
    out += `__Weekly Context__\n${s.roadmap}\n\n`;
  }

  out += `_Updated: ${new Date(s.ts).toUTCString()}_`;
  return out;
}

function buildCombinedSignature(s) {
  const ltfSig = s.ltf ? s.ltf.map(x => x.name).join('|') : '';
  const htfSig = s.htf ? s.htf.map(x => x.name).join('|') : '';
  return JSON.stringify({
    ltfSig,
    htfSig,
    macro: s.macro || '',
    roadmap: s.roadmap || '',
    tsBucket: s.ts ? Math.floor(s.ts / 60000) : 0,
  });
}

async function tryCombine(group, symbol, s) {
  if (!isReadyToCombine(s)) return;

  const webhook = COMBINED_WEBHOOKS[group];
  if (!webhook) {
    console.warn(`[COMBINE] No webhook for group ${group}`);
    return;
  }

  const signature = buildCombinedSignature(s);
  if (s.combinedSignature === signature) {
    console.log(`[COMBINE] ${group} ${symbol} unchanged — skipped`);
    return;
  }

  await sendToWebhook(webhook, buildCombinedText(symbol, s), null);

  if (s.ltf && s.ltf.length > 0) {
    await sendToWebhook(webhook, `📉 **${symbol}** LTF Charts`, s.ltf);
  }

  if (s.htf && s.htf.length > 0) {
    await sendToWebhook(webhook, `📈 **${symbol}** HTF Charts`, s.htf);
  }

  s.combinedSignature = signature;
  console.log(`[COMBINED] ${group} ${symbol} posted`);
}

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('clientReady', () => {
  console.log('[READY] ATLAS FX Bot online as ' + client.user.tag);
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (PROCESSED_MESSAGES.has(msg.id)) return;
  rememberMessage(msg.id);

  const raw = (msg.content || '').trim();
  if (!raw) return;

  if (raw === '!ping') {
    await safeReply(msg, 'pong');
    return;
  }

  const group = CHANNEL_GROUP_MAP[msg.channel.id];
  if (!group) return;

  const parsed = parseCommand(raw);
  if (!parsed) return;

  const { action, symbol, mode } = parsed;

  if (!VALID_SYMBOLS.has(symbol)) {
    await safeReply(msg, `Invalid symbol: **${symbol}**`);
    return;
  }

  const tfs = mode === 'L' ? TF_LOW : TF_HIGH;
  const setLabel = mode === 'L' ? 'LTF' : 'HTF';

  // ── CHART ──────────────────────────────────────────────────
  if (action === 'chart') {
    const lockKey = getLockKey(group, symbol, 'chart');

    if (isLocked(lockKey)) {
      await safeReply(msg, `⚠️ **${symbol}** is already being generated — please wait.`);
      return;
    }

    lock(lockKey);

    enqueue(async () => {
      console.log(`[CHART] ${msg.author.username} ${group} -> ${symbol} ${setLabel}`);
      let progress = null;

      try {
        progress = await safeReply(msg, `⏳ Generating **${symbol}** ${setLabel} charts...`);

        const files = await renderBatch(symbol, tfs);

        for (const f of files) {
          await safeSend(msg.channel, {
            content: `📊 **${symbol}** · ${f.label}`,
            files: [new AttachmentBuilder(f.buf, { name: f.name })],
          });
        }

        if (progress) {
          await progress.edit(`✅ **${symbol}** ${setLabel} charts delivered`);
        }

        const s = ensureState(group, symbol);
        if (mode === 'L') s.ltf = files;
        if (mode === 'H') s.htf = files;
        touch(s);

        await tryCombine(group, symbol, s);

      } catch (err) {
        console.error('[CHART ERROR]', err.message);
        if (progress) {
          await progress.edit(`❌ **${symbol}** chart failed — retry`);
        } else {
          await safeReply(msg, `❌ **${symbol}** chart failed — retry`);
        }
      } finally {
        unlock(lockKey);
      }
    });

    return;
  }

  // ── MACRO ──────────────────────────────────────────────────
  if (action === 'macro') {
    const lockKey = getLockKey(group, symbol, 'macro');

    if (isLocked(lockKey)) {
      await safeReply(msg, `⚠️ **${symbol}** macro is already being generated — please wait.`);
      return;
    }

    lock(lockKey);

    enqueue(async () => {
      console.log(`[MACRO] ${msg.author.username} ${group} -> ${symbol}`);

      try {
        const s = ensureState(group, symbol);

        if (!s.htf) {
          await safeReply(
            msg,
            `**${symbol}** — HTF charts missing.\nRun \`!${symbol}H\` first so ATLAS FX can analyse both higher and lower timeframe context correctly.`
          );
          return;
        }

        const level = getUserLevel(msg.author.id);
        const macro = generateMacro(symbol, level);

        s.macro = macro;
        touch(s);

        const pushed = await sendTextToChannelId(client, MACRO_CHANNELS[group], macro);
        if (!pushed) {
          await safeReply(msg, macro);
        } else {
          await safeReply(msg, `✅ **${symbol}** macro generated`);
        }

        await tryCombine(group, symbol, s);

      } catch (err) {
        console.error('[MACRO ERROR]', err.message);
        await safeReply(msg, `❌ **${symbol}** macro failed — retry`);
      } finally {
        unlock(lockKey);
      }
    });

    return;
  }

  // ── ROADMAP ────────────────────────────────────────────────
  if (action === 'roadmap') {
    const lockKey = getLockKey(group, symbol, 'roadmap');

    if (isLocked(lockKey)) {
      await safeReply(msg, `⚠️ **${symbol}** roadmap is already being generated — please wait.`);
      return;
    }

    lock(lockKey);

    enqueue(async () => {
      console.log(`[ROADMAP] ${msg.author.username} ${group} -> ${symbol}`);

      try {
        const level = getUserLevel(msg.author.id);
        const roadmap = generateRoadmap(symbol, level);

        const s = ensureState(group, symbol);
        s.roadmap = roadmap;
        touch(s);

        const pushed = await sendTextToChannelId(client, ROADMAP_CHANNELS[group], roadmap);
        if (!pushed) {
          await safeReply(msg, roadmap);
        } else {
          await safeReply(msg, `✅ **${symbol}** roadmap generated`);
        }

        await tryCombine(group, symbol, s);

      } catch (err) {
        console.error('[ROADMAP ERROR]', err.message);
        await safeReply(msg, `❌ **${symbol}** roadmap failed — retry`);
      } finally {
        unlock(lockKey);
      }
    });

    return;
  }
});

// ============================================================
// SHARD EVENTS
// ============================================================

client.on('shardDisconnect',   (e, id) => console.warn(`[SHARD] ${id} disconnected. Code: ${e.code}`));
client.on('shardReconnecting', (id)    => console.log(`[SHARD] ${id} reconnecting...`));
client.on('shardResume',       (id, n) => console.log(`[SHARD] ${id} resumed. Replayed ${n} events.`));

// ============================================================
// KEEP ALIVE + STATE CLEANUP
// ============================================================

setInterval(() => {
  cleanupOldState();
  console.log('[KEEP-ALIVE]', new Date().toISOString());
}, 5 * 60 * 1000);

// ============================================================
// START
// ============================================================

client.login(TOKEN);
