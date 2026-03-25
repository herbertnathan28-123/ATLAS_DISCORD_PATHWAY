// ============================================================
// ATLAS FX DISCORD BOT — DEFINITIVE FINAL BUILD
// ============================================================
//
// COMMANDS (in group channels only):
//   !EURUSDH          — HTF charts (Weekly, Daily, 4H, 1H)
//   !EURUSDL          — LTF charts (4H, 1H, 15M, 1M)
//   !EURUSDL /macro   — Generate macro analysis
//   !EURUSDL /roadmap — Generate weekly roadmap
//   !ping             — Health check
//
// REQUIRED ENV VARS:
//   DISCORD_BOT_TOKEN
//   AT_COMBINED_WEBHOOK
//   SK_COMBINED_WEBHOOK
//   NM_COMBINED_WEBHOOK
//   BR_COMBINED_WEBHOOK
//   SHARED_MACROS_CHANNEL_ID  (1434253776360968293)
//
// OPTIONAL ENV VARS:
//   EXPORT_DIR
//   MAX_RENDER_RETRIES
//   RENDER_TIMEOUT_MS
//   CHART_LOAD_WAIT_MS
//
// OUTPUT: Single dark 2x2 grid image per request
//         Share button posts to #shared-macros
// ============================================================

process.on('unhandledRejection', (reason) => { console.error('[UNHANDLED REJECTION]', reason); });
process.on('uncaughtException',  (err)    => { console.error('[UNCAUGHT EXCEPTION]', err); });

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

// ============================================================
// CONFIG
// ============================================================

const TOKEN                 = process.env.DISCORD_BOT_TOKEN;
const EXPORT_DIR            = process.env.EXPORT_DIR || path.join(__dirname, 'exports');
const MAX_RETRIES           = Number(process.env.MAX_RENDER_RETRIES  || 2);
const STATE_TTL             = 1000 * 60 * 60 * 2;
const RENDER_TIMEOUT_MS     = Number(process.env.RENDER_TIMEOUT_MS   || 30000);
const CHART_LOAD_WAIT_MS    = Number(process.env.CHART_LOAD_WAIT_MS  || 3000);
const MESSAGE_DEDUPE_TTL_MS = 30000;
const SHARED_MACROS_CHANNEL = process.env.SHARED_MACROS_CHANNEL_ID  || '1434253776360968293';
const CACHE_TTL_MS          = 15 * 60 * 1000; // 15 min share cache

if (!TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

console.log('[BOOT] ATLAS FX Bot starting...');

// ============================================================
// CHANNEL → GROUP MAP
// ============================================================

const CHANNEL_GROUP_MAP = {
  '1432642672287547453': 'AT', // at-roadmap-macro-request
  '1432643496375881748': 'SK', // sk-roadmap-macro-request
  '1432644116868501595': 'NM', // nm-roadmap-macro-request
  '1482450651765149816': 'BR', // br-roadmap-macro-request
  '1432080184458350672': 'AT', // at-combined
  '1430950313484878014': 'SK', // sk-combined
  '1431192381029482556': 'NM', // nm-combined
  '1482451091630194868': 'BR', // br-combined
};

const MACRO_CHANNELS = {
  AT: '1432356130947858513', // at-roadmap-macro
  SK: '1432355390011605046', // sk-roadmap-macro
  NM: '1432356831656677446', // nm-roadmap-macro
  BR: '1482451021652561982', // br-roadmap-macro
};

const COMBINED_WEBHOOKS = {
  AT: process.env.AT_COMBINED_WEBHOOK,
  SK: process.env.SK_COMBINED_WEBHOOK,
  NM: process.env.NM_COMBINED_WEBHOOK,
  BR: process.env.BR_COMBINED_WEBHOOK,
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
  MICRON: 'NASDAQ:MU',  MU:     'NASDAQ:MU',
  AMD:    'NASDAQ:AMD', ASML:   'NASDAQ:ASML',
  NAS100: 'OANDA:NAS100USD', US500:  'OANDA:SPX500USD',
  GER40:  'OANDA:DE30EUR',   SPX:    'INDEX:SPX',
  NDX:    'INDEX:NDX',       DJI:    'INDEX:DJI',
  DAX:    'INDEX:DAX',       US30:   'INDEX:US30',
  UK100:  'INDEX:UK100',     CL:     'NYMEX:CL1!',
  BRENT:  'NYMEX:BB1!',      UKOIL:  'NYMEX:BB1!',
  NATGAS: 'NYMEX:NG1!',      NG:     'NYMEX:NG1!',
};

function getTVSymbol(symbol) {
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;
  return `NASDAQ:${symbol}`;
}

function buildChartUrl(symbol, interval) {
  const tvSymbol = encodeURIComponent(getTVSymbol(symbol));
  return `https://www.tradingview.com/chart/?symbol=${tvSymbol}&interval=${interval}&theme=dark`;
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
// PARSER
// ============================================================

function parseCommand(content) {
  const trimmed = (content || '').trim();

  if (trimmed === '!ping') return { action: 'ping' };

  const chartOnly = trimmed.match(/^!([A-Z0-9]{2,10})([LH])$/i);
  if (chartOnly) {
    return { action: 'chart', symbol: chartOnly[1].toUpperCase(), mode: chartOnly[2].toUpperCase() };
  }

  const withAction = trimmed.match(/^!([A-Z0-9]{2,10})([LH])\s*\/(macro|roadmap)$/i);
  if (withAction) {
    return { action: withAction[3].toLowerCase(), symbol: withAction[1].toUpperCase(), mode: withAction[2].toUpperCase() };
  }

  return null;
}

// ============================================================
// TIMEOUT
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

function rememberMessage(id) {
  PROCESSED_MESSAGES.add(id);
  setTimeout(() => PROCESSED_MESSAGES.delete(id), MESSAGE_DEDUPE_TTL_MS);
}

// ============================================================
// LOCKS (per group + symbol + action)
// ============================================================

const RUNNING = {};

function getLockKey(group, symbol, action) { return `${group}::${symbol}::${action}`; }
function isLocked(key)  { return !!RUNNING[key]; }
function lock(key)      { RUNNING[key] = true; }
function unlock(key)    { delete RUNNING[key]; }

// ============================================================
// SHARE CACHE (15 min TTL)
// ============================================================

const SHARE_CACHE = new Map();

function cacheGrid(cacheKey, symbol, setLabel, gridBuf, gridName) {
  SHARE_CACHE.set(cacheKey, { symbol, setLabel, gridBuf, gridName, expiresAt: Date.now() + CACHE_TTL_MS });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of SHARE_CACHE.entries()) {
    if (v.expiresAt < now) SHARE_CACHE.delete(k);
  }
}, 60 * 1000);

// ============================================================
// STATE MACHINE
// ============================================================

const STATE = {};

function ensureState(group, symbol) {
  if (!STATE[group])         STATE[group] = {};
  if (!STATE[group][symbol]) STATE[group][symbol] = { ltf: null, htf: null, macro: null, roadmap: null, ts: null, combinedSignature: null };
  return STATE[group][symbol];
}

function touch(s)            { s.ts = Date.now(); }
function isFresh(s)          { return !!(s.ts && (Date.now() - s.ts < STATE_TTL)); }
function isReadyToCombine(s) { return !!(s.ltf && s.macro && isFresh(s)); }

function cleanupOldState() {
  const now = Date.now();
  for (const group of Object.keys(STATE)) {
    for (const symbol of Object.keys(STATE[group])) {
      const s = STATE[group][symbol];
      if (!s.ts || now - s.ts > STATE_TTL) delete STATE[group][symbol];
    }
    if (Object.keys(STATE[group]).length === 0) delete STATE[group];
  }
}

// ============================================================
// ARCHIVE
// ============================================================

function buildFilename(symbol, tfKey) {
  return `${new Date().toISOString().slice(0, 10)}_${symbol}_${tfKey}.jpg`;
}

function saveToArchive(buffer, symbol, tfKey) {
  try {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const dir     = path.join(EXPORT_DIR, symbol, dateStr);
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
    try { await job(); } catch (err) { console.error('[QUEUE ERROR]', err.message); }
  }
  queueRunning = false;
}

// ============================================================
// BROWSER
// ============================================================

let browser = null;

async function getBrowser() {
  if (!browser) {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    browser.on('disconnected', () => {
      console.warn('[BROWSER] Disconnected — will relaunch');
      browser = null;
    });
  }
  return browser;
}

// ============================================================
// RENDER — fast mode, dark theme, sequential
// ============================================================

async function renderChart(symbol, interval, tfKey) {
  const url = buildChartUrl(symbol, interval);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let context = null;
    try {
      console.log(`[RENDER] ${symbol} ${tfKey} attempt ${attempt}/${MAX_RETRIES}`);

      const b = await getBrowser();
      context = await b.newContext({
        viewport:          { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(30000);

      // Force dark theme before load
      await page.addInitScript(() => {
        try { localStorage.setItem('theme', 'dark'); } catch (_) {}
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(CHART_LOAD_WAIT_MS);

      // Dismiss popups
      for (const sel of ['button[aria-label="Close"]', 'button:has-text("Accept")', 'button:has-text("Got it")']) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 800 })) {
            await btn.click({ timeout: 800 });
            await page.waitForTimeout(300);
          }
        } catch (_) {}
      }

      // Wait for canvas
      try { await page.waitForSelector('canvas', { timeout: 15000 }); } catch (_) {}

      // Clean UI + remove volume
      await page.evaluate(() => {
        [
          '[data-name="right-toolbar"]',
          '.layout__area--right',
          '.tv-control-bar',
          '.tv-floating-toolbar',
          '.js-symbol-logo',
          '.chart-controls-bar',
          '.layout__area--left',
          '.header-chart-panel',
          '[data-name="legend"]',
        ].forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
        });

        document.querySelectorAll('*').forEach((el) => {
          const t = (el.innerText || '').trim();
          if (t === 'Vol' || t.startsWith('Vol ')) el.style.display = 'none';
        });
      }).catch(() => {});

      await page.waitForTimeout(500);

      const raw = await page.screenshot({ type: 'png', fullPage: false });
      await context.close();
      context = null;

      console.log(`[RENDER OK] ${symbol} ${tfKey}`);
      return raw;

    } catch (err) {
      console.error(`[RENDER FAIL] ${symbol} ${tfKey} attempt ${attempt}: ${err.message}`);
      if (context) { try { await context.close(); } catch (_) {} }
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ============================================================
// GRID COMPOSE — 2x2 dark layout
// ============================================================

async function buildGrid(rawImages) {
  const W = 1920;
  const H = 1080;

  const resized = await Promise.all(
    rawImages.map((img) => sharp(img).resize(W, H, { fit: 'cover' }).png().toBuffer())
  );

  return await sharp({
    create: { width: W * 2, height: H * 2, channels: 4, background: { r: 11, g: 11, b: 11, alpha: 1 } },
  })
    .composite([
      { input: resized[0], left: 0, top: 0 },
      { input: resized[1], left: W, top: 0 },
      { input: resized[2], left: 0, top: H },
      { input: resized[3], left: W, top: H },
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

// ============================================================
// RENDER BATCH — sequential + grid compose
// ============================================================

async function renderBatch(symbol, tfs) {
  const rawImages = [];

  for (const tf of tfs) {
    const raw = await withTimeout(renderChart(symbol, tf.interval, tf.key), RENDER_TIMEOUT_MS);
    saveToArchive(raw, symbol, tf.key);
    rawImages.push(raw);
  }

  const gridBuf = await buildGrid(rawImages);
  return gridBuf;
}

// ============================================================
// MACRO + ROADMAP (placeholders)
// ============================================================

function generateMacro(symbol) {
  return `**${symbol} Macro**\n\nBias: Bearish\nDraw: 1.1550 liquidity\nState: Post-sweep → pullback\n\nLevels: 1.1625 / 1.1580 / 1.1550`;
}

function generateRoadmap(symbol) {
  return `**${symbol} Weekly Roadmap**\n\nRange: 1.1700 – 1.1450\nPrimary Draw: Downside liquidity\nHTF Supply: Holding`;
}

// ============================================================
// COMBINE + SEND
// ============================================================

function buildCombinedText(symbol, s) {
  let out = `📊 **${symbol} — ATLAS VIEW**\n\n`;
  out += `__Macro (Today)__\n${s.macro}\n\n`;
  if (s.roadmap) out += `__Weekly Context__\n${s.roadmap}\n\n`;
  out += `_Updated: ${new Date(s.ts).toUTCString()}_`;
  return out;
}

async function sendToWebhook(webhookUrl, content, files) {
  if (!webhookUrl) return;
  try {
    if (!files || files.length === 0) {
      await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content }),
      });
      return;
    }
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content }));
    files.forEach((f, i) => {
      form.append(`files[${i}]`, new Blob([f.buf], { type: 'image/jpeg' }), f.name);
    });
    await fetch(webhookUrl, { method: 'POST', body: form });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err.message);
  }
}

async function tryCombine(group, symbol, s) {
  if (!isReadyToCombine(s)) return;
  const webhook = COMBINED_WEBHOOKS[group];
  if (!webhook) return;
  await sendToWebhook(webhook, buildCombinedText(symbol, s), null);
  if (s.ltfGrid) await sendToWebhook(webhook, `📉 **${symbol}** LTF Grid`, [{ buf: s.ltfGrid, name: `${symbol}_LTF_grid.jpg` }]);
  if (s.htfGrid) await sendToWebhook(webhook, `📈 **${symbol}** HTF Grid`, [{ buf: s.htfGrid, name: `${symbol}_HTF_grid.jpg` }]);
  console.log(`[COMBINED] ${group} ${symbol} posted`);
}

async function safeReply(msg, content)   { try { return await msg.reply(content);   } catch (e) { console.error('[REPLY ERROR]', e.message); return null; } }
async function safeSend(channel, payload){ try { return await channel.send(payload); } catch (e) { console.error('[SEND ERROR]', e.message);  return null; } }

async function sendTextToMacroChannel(channelId, content) {
  if (!channelId) return false;
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch) return false;
    await ch.send({ content });
    return true;
  } catch (err) {
    console.error('[MACRO CHANNEL ERROR]', err.message);
    return false;
  }
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

  // Atomic dedupe — check AND add synchronously before any await
  if (PROCESSED_MESSAGES.has(msg.id)) return;
  PROCESSED_MESSAGES.add(msg.id);
  setTimeout(() => PROCESSED_MESSAGES.delete(msg.id), MESSAGE_DEDUPE_TTL_MS);

  const raw = (msg.content || '').trim();
  if (!raw) return;

  if (raw === '!ping') { await safeReply(msg, 'pong'); return; }

  const group = CHANNEL_GROUP_MAP[msg.channel.id];
  if (!group) return;

  const parsed = parseCommand(raw);
  if (!parsed) return;

  const { action, symbol, mode } = parsed;

  if (!VALID_SYMBOLS.has(symbol)) {
    await safeReply(msg, `Invalid symbol: **${symbol}**`);
    return;
  }

  // ── CHART ──────────────────────────────────────────────────
  if (action === 'chart') {
    const tfs      = mode === 'L' ? TF_LOW : TF_HIGH;
    const setLabel = mode === 'L' ? 'LTF' : 'HTF';
    const lockKey  = getLockKey(group, symbol, `chart_${mode}`);

    if (isLocked(lockKey)) {
      await safeReply(msg, `⚠️ **${symbol}** is already generating — please wait.`);
      return;
    }

    lock(lockKey);

    enqueue(async () => {
      console.log(`[CHART] ${msg.author.username} ${group} -> ${symbol} ${setLabel}`);
      let progress = null;

      try {
        progress = await safeReply(msg, `⏳ Generating **${symbol}** ${setLabel} grid...`);

        const gridBuf  = await renderBatch(symbol, tfs);
        const gridName = `${new Date().toISOString().slice(0, 10)}_${symbol}_${setLabel}_grid.jpg`;

        // Cache for share button
        const cacheKey = `${msg.id}_${Date.now()}`;
        cacheGrid(cacheKey, symbol, setLabel, gridBuf, gridName);

        // Share button
        const components = [];
        if (SHARED_MACROS_CHANNEL) {
          components.push(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`share_${cacheKey}`)
                .setLabel('Share in #shared-macros')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`noshare_${cacheKey}`)
                .setLabel('No thanks')
                .setStyle(ButtonStyle.Secondary)
            )
          );
        }

        if (progress) {
          await progress.edit({
            content:    `✅ **${symbol}** ${setLabel}`,
            files:      [new AttachmentBuilder(gridBuf, { name: gridName })],
            components,
          });
        }

        // Update state for combine
        const s = ensureState(group, symbol);
        if (mode === 'L') { s.ltf = [{ buf: gridBuf, name: gridName }]; s.ltfGrid = gridBuf; }
        if (mode === 'H') { s.htf = [{ buf: gridBuf, name: gridName }]; s.htfGrid = gridBuf; }
        touch(s);

        await tryCombine(group, symbol, s);

      } catch (err) {
        console.error('[CHART ERROR]', err.message);
        if (progress) await progress.edit(`❌ **${symbol}** chart failed — retry`);
        else await safeReply(msg, `❌ **${symbol}** chart failed — retry`);
      } finally {
        unlock(lockKey);
      }
    });

    return;
  }

  // ── MACRO ──────────────────────────────────────────────────
  if (action === 'macro') {
    const lockKey = getLockKey(group, symbol, 'macro');
    if (isLocked(lockKey)) { await safeReply(msg, `⚠️ **${symbol}** macro already generating.`); return; }
    lock(lockKey);

    enqueue(async () => {
      console.log(`[MACRO] ${msg.author.username} ${group} -> ${symbol}`);
      try {
        const s = ensureState(group, symbol);
        if (!s.htf) {
          await safeReply(msg, `**${symbol}** — HTF charts missing. Run \`!${symbol}H\` first.`);
          return;
        }
        const macro = generateMacro(symbol);
        s.macro = macro;
        touch(s);
        const pushed = await sendTextToMacroChannel(MACRO_CHANNELS[group], macro);
        if (!pushed) await safeReply(msg, macro);
        else await safeReply(msg, `✅ **${symbol}** macro generated`);
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
    if (isLocked(lockKey)) { await safeReply(msg, `⚠️ **${symbol}** roadmap already generating.`); return; }
    lock(lockKey);

    enqueue(async () => {
      console.log(`[ROADMAP] ${msg.author.username} ${group} -> ${symbol}`);
      try {
        const roadmap = generateRoadmap(symbol);
        const s = ensureState(group, symbol);
        s.roadmap = roadmap;
        touch(s);
        const pushed = await sendTextToMacroChannel(MACRO_CHANNELS[group], roadmap);
        if (!pushed) await safeReply(msg, roadmap);
        else await safeReply(msg, `✅ **${symbol}** roadmap generated`);
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
// BUTTON HANDLER
// ============================================================

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // ── No thanks ──────────────────────────────────────────────
  if (interaction.customId.startsWith('noshare_')) {
    try { await interaction.update({ content: 'Charts kept private.', components: [] }); } catch (_) {}
    return;
  }

  // ── Share ──────────────────────────────────────────────────
  if (interaction.customId.startsWith('share_')) {
    // Defer immediately — Discord 3s timeout
    try { await interaction.deferUpdate(); } catch (err) {
      console.error('[DEFER FAIL]', err.message);
      return;
    }

    const cacheKey = interaction.customId.replace('share_', '');
    const cached   = SHARE_CACHE.get(cacheKey);

    if (!cached) {
      await interaction.editReply({ content: 'Share expired — run the command again.', components: [] });
      return;
    }

    try {
      const channel = await client.channels.fetch(SHARED_MACROS_CHANNEL).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        await interaction.editReply({ content: 'Shared channel not found.', components: [] });
        return;
      }

      await channel.send({
        content: `📊 **${cached.symbol}** ${cached.setLabel} shared by **${interaction.user.username}**`,
        files:   [new AttachmentBuilder(cached.gridBuf, { name: cached.gridName })],
      });

      await interaction.editReply({
        content:    `✅ **${cached.symbol}** ${cached.setLabel} shared in #shared-macros`,
        components: [],
      });

      console.log(`[SHARED] ${cached.symbol} ${cached.setLabel} by ${interaction.user.username}`);

    } catch (err) {
      console.error('[SHARE ERROR]', err.message);
      try { await interaction.editReply({ content: 'Failed to share — retry.', components: [] }); } catch (_) {}
    }

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
