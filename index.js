// ============================================================
// ATLAS FX DISCORD BOT — DEFINITIVE FINAL BUILD
// ============================================================
//
// MODULES:
//   1. Chart Engine     — TradingView 2x2 dark grid via Playwright
//   2. Routing Engine   — Symbol + mode pipeline (hooks prepared)
//   3. Discord Output   — Single clean response per command
//   4. Share Button     — Prep only (no backend yet)
//   5. Performance      — Async, timeout, retry (2 max)
//
// COMMANDS (in group channels only):
//   !EURUSDH  — HTF grid (Weekly, Daily, 4H, 1H)
//   !EURUSDL  — LTF grid (4H, 1H, 15M, 1M)
//   !ping     — Health check
//
// ENV VARS (Render dashboard — no dotenv):
//   DISCORD_BOT_TOKEN
//   AT_COMBINED_WEBHOOK | SK_COMBINED_WEBHOOK
//   NM_COMBINED_WEBHOOK | BR_COMBINED_WEBHOOK
//   SHARED_MACROS_CHANNEL_ID
// ============================================================

process.on('unhandledRejection', (reason) => { console.error('[UNHANDLED]', reason); });
process.on('uncaughtException',  (err)    => { console.error('[CRASH]', err); });

// ── LAYER 1: Environment ────────────────────────────────────
const TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN — set it in Render environment variables');
  process.exit(1);
}

console.log('[BOOT] ATLAS FX Bot starting...');

// ── LAYER 2: Discord client + intents ──────────────────────
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── LAYER 3: Ready event ────────────────────────────────────
client.once('clientReady', () => {
  console.log(`[READY] ATLAS FX Bot online as ${client.user.tag}`);
});

// ── LAYER 4: Config ──────────────────────────────────────────
const EXPORT_DIR            = process.env.EXPORT_DIR || path.join(__dirname, 'exports');
const MAX_RETRIES           = 2;
const RENDER_TIMEOUT_MS     = 30000;
const CHART_LOAD_WAIT_MS    = 3000;
const MESSAGE_DEDUPE_TTL_MS = 30000;
const SHARED_MACROS_CHANNEL = process.env.SHARED_MACROS_CHANNEL_ID || '1434253776360968293';
const CACHE_TTL_MS          = 15 * 60 * 1000;

// ── LAYER 5: Input normalisation + alias mapping ─────────────
const ALIAS_MAP = {
  // Metals
  gold:   'XAUUSD',  xau:    'XAUUSD',
  silver: 'XAGUSD',  xag:    'XAGUSD',
  // Oil
  brent:  'BCOUSD',  wti:    'USOIL',   oil: 'USOIL',
  // Indices
  nas100: 'NAS100',  nas:    'NAS100',  nasdaq: 'NAS100',
  sp500:  'US500',   spx:    'US500',   us500:  'US500',
  dow:    'US30',    dji:    'US30',    us30:   'US30',
  dax:    'GER40',   ger40:  'GER40',
  ftse:   'UK100',   uk100:  'UK100',
  // Gas
  natgas: 'NATGAS',  ng:     'NATGAS',
  // Stocks
  micron: 'MICRON',  mu:     'MICRON',
  amd:    'AMD',     asml:   'ASML',
};

function resolveSymbol(raw) {
  const lower = raw.toLowerCase().trim();
  return ALIAS_MAP[lower] ? ALIAS_MAP[lower] : raw.toUpperCase();
}

// ── LAYER 6: Symbol routing ──────────────────────────────────
const SYMBOL_OVERRIDES = {
  XAUUSD: 'OANDA:XAUUSD',  XAGUSD: 'OANDA:XAGUSD',
  BCOUSD: 'OANDA:BCOUSD',  USOIL:  'OANDA:BCOUSD',
  NAS100: 'OANDA:NAS100USD', US500: 'OANDA:SPX500USD',
  US30:   'OANDA:US30USD',  GER40:  'OANDA:DE30EUR',
  UK100:  'OANDA:UK100GBP', NATGAS: 'NYMEX:NG1!',
  MICRON: 'NASDAQ:MU',      AMD:    'NASDAQ:AMD',
  ASML:   'NASDAQ:ASML',
};

function getTVSymbol(symbol) {
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;
  return `NASDAQ:${symbol}`;
}

function getFeedName(symbol) {
  const tv   = getTVSymbol(symbol);
  const feed = tv.split(':')[0];
  const map  = { OANDA: 'OANDA', NASDAQ: 'NASDAQ', NYSE: 'NYSE', NYMEX: 'NYMEX', INDEX: 'INDEX', TVC: 'TVC' };
  return map[feed] || feed;
}

function buildChartUrl(symbol, interval) {
  const tvSymbol = encodeURIComponent(getTVSymbol(symbol));
  return `https://www.tradingview.com/chart/?symbol=${tvSymbol}&interval=${interval}&theme=dark`;
}

// ── LAYER 7: Command parser ──────────────────────────────────
function parseCommand(content) {
  const trimmed = (content || '').trim();
  if (trimmed === '!ping') return { action: 'ping' };
  const m = trimmed.match(/^!([A-Z0-9]{2,12})([LH])$/i);
  if (m) {
    return {
      action:    'chart',
      rawSymbol: m[1],
      symbol:    resolveSymbol(m[1]),
      mode:      m[2].toUpperCase(),
    };
  }
  return null;
}

// ── LAYER 8: Logging ─────────────────────────────────────────
function log(level, msg, ...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`, ...args);
}

// ============================================================
// MODULE 1 — CHART ENGINE
// ============================================================

const TIMEFRAMES = {
  H: [
    { key: '1W',  label: 'Weekly', interval: '1W'  },
    { key: '1D',  label: 'Daily',  interval: '1D'  },
    { key: '4H',  label: '4H',     interval: '240' },
    { key: '1H',  label: '1H',     interval: '60'  },
  ],
  L: [
    { key: '4H',  label: '4H',  interval: '240' },
    { key: '1H',  label: '1H',  interval: '60'  },
    { key: '15M', label: '15M', interval: '15'  },
    { key: '1M',  label: '1M',  interval: '1'   },
  ],
};

// Browser singleton
let browser = null;

async function getBrowser() {
  if (!browser) {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    browser.on('disconnected', () => {
      log('WARN', 'Browser disconnected — will relaunch on next render');
      browser = null;
    });
  }
  return browser;
}

// Timeout wrapper
function withTimeout(promise, ms = RENDER_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// Render one chart panel with retry
async function renderChart(symbol, interval, tfKey) {
  const url = buildChartUrl(symbol, interval);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let context = null;
    try {
      log('INFO', `[RENDER] ${symbol} ${tfKey} attempt ${attempt}/${MAX_RETRIES}`);

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

      // Short timeframes need extra time to fetch candle data
      const tfWait = (interval === '1' || interval === '15')
        ? CHART_LOAD_WAIT_MS + 2000
        : CHART_LOAD_WAIT_MS;
      await page.waitForTimeout(tfWait);

      // Dismiss popups
      for (const sel of [
        'button[aria-label="Close"]',
        'button:has-text("Accept")',
        'button:has-text("Got it")',
      ]) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 800 })) {
            await btn.click({ timeout: 800 });
            await page.waitForTimeout(300);
          }
        } catch (_) {}
      }

      // Wait for chart canvas
      try { await page.waitForSelector('canvas', { timeout: 15000 }); } catch (_) {}

      // Clean UI — remove chrome, toolbars, volume bars
      await page.evaluate(() => {
        [
          '[data-name="right-toolbar"]', '.layout__area--right',
          '.tv-control-bar',            '.tv-floating-toolbar',
          '.js-symbol-logo',            '.chart-controls-bar',
          '.layout__area--left',        '.header-chart-panel',
          '[data-name="legend"]',
        ].forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
        });
        // Remove volume bars
        document.querySelectorAll('*').forEach((el) => {
          const t = (el.innerText || '').trim();
          if (t === 'Vol' || t.startsWith('Vol ')) el.style.display = 'none';
        });
      }).catch(() => {});

      await page.waitForTimeout(500);

      const raw = await page.screenshot({ type: 'png', fullPage: false });
      await context.close();
      context = null;

      // Blank render guard — under 50KB means the chart never loaded
      if (raw.length < 50000) {
        throw new Error(`Blank render (${raw.length}B) for ${symbol} ${tfKey}`);
      }

      log('INFO', `[RENDER OK] ${symbol} ${tfKey}`);
      return raw;

    } catch (err) {
      log('ERROR', `[RENDER FAIL] ${symbol} ${tfKey} attempt ${attempt}: ${err.message}`);
      if (context) { try { await context.close(); } catch (_) {} }
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Compose 4 raw PNG buffers into a single 2x2 dark grid
async function buildGrid(rawImages) {
  const W = 1920;
  const H = 1080;

  const resized = await Promise.all(
    rawImages.map((img) => sharp(img).resize(W, H, { fit: 'cover' }).png().toBuffer())
  );

  return await sharp({
    create: {
      width:    W * 2,
      height:   H * 2,
      channels: 4,
      background: { r: 11, g: 11, b: 11, alpha: 1 },
    },
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

// Archive individual chart to disk
function archiveChart(buffer, symbol, tfKey) {
  try {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const dir     = path.join(EXPORT_DIR, symbol, dateStr);
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${new Date().toISOString().slice(0, 10)}_${symbol}_${tfKey}.jpg`;
    fs.writeFileSync(path.join(dir, filename), buffer);
  } catch (err) {
    log('WARN', `[ARCHIVE] ${err.message}`);
  }
}

// ============================================================
// MODULE 2 — ROUTING ENGINE
// ============================================================

// Channel → group map
const CHANNEL_GROUP_MAP = {
  '1432642672287547453': 'AT',
  '1432643496375881748': 'SK',
  '1432644116868501595': 'NM',
  '1482450651765149816': 'BR',
  '1432080184458350672': 'AT',
  '1430950313484878014': 'SK',
  '1431192381029482556': 'NM',
  '1482451091630194868': 'BR',
};

const MACRO_CHANNELS = {
  AT: '1432356130947858513',
  SK: '1432355390011605046',
  NM: '1432356831656677446',
  BR: '1482451021652561982',
};

// Per-symbol lock (check before enqueue)
const RUNNING = {};
function isLocked(symbol)  { return !!RUNNING[symbol]; }
function lock(symbol)      { RUNNING[symbol] = true; }
function unlock(symbol)    { RUNNING[symbol] = false; }

// Sequential job queue
const queue        = [];
let   queueRunning = false;

function enqueue(job) {
  queue.push(job);
  void runQueue();
}

async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try { await job(); } catch (err) { log('ERROR', '[QUEUE]', err.message); }
  }
  queueRunning = false;
}

// Pipeline entry point
// Hooks for Corey/Spidey/Jane are prepared here but not yet active
async function runChartPipeline(symbol, mode) {
  const tfs      = TIMEFRAMES[mode];
  const setLabel = mode === 'H' ? 'HTF' : 'LTF';

  log('INFO', `[PIPELINE] ${symbol} ${setLabel} — resolving charts`);

  // Step 1: Render all 4 panels sequentially (avoids browser crash)
  const rawImages = [];
  for (const tf of tfs) {
    const raw = await withTimeout(renderChart(symbol, tf.interval, tf.key));
    archiveChart(raw, symbol, tf.key);
    rawImages.push(raw);
  }

  // Step 2: Compose into 2x2 grid
  const gridBuf  = await buildGrid(rawImages);
  const gridName = `${new Date().toISOString().slice(0, 10)}_${symbol}_${setLabel}_grid.jpg`;

  log('INFO', `[PIPELINE] ${symbol} ${setLabel} — grid ready`);

  // Hook: macro analysis (Spidey → Jane) — NOT YET ACTIVE
  // const macro = await macroModule.run(symbol, mode);

  // Hook: roadmap generation — NOT YET ACTIVE
  // const roadmap = await roadmapModule.run(symbol);

  return { gridBuf, gridName, symbol, setLabel };
}

// ============================================================
// MODULE 3 — DISCORD OUTPUT
// ============================================================

// Share cache for button (15 min TTL)
const SHARE_CACHE = new Map();

function cacheForShare(key, data) {
  SHARE_CACHE.set(key, { ...data, expiresAt: Date.now() + CACHE_TTL_MS });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of SHARE_CACHE.entries()) {
    if (v.expiresAt < now) SHARE_CACHE.delete(k);
  }
}, 60 * 1000);

async function safeReply(msg, payload)   {
  try { return await msg.reply(payload);   } catch (e) { log('ERROR', '[REPLY]', e.message); return null; }
}
async function safeEdit(msg, payload)    {
  try { return await msg.edit(payload);    } catch (e) { log('ERROR', '[EDIT]',  e.message); return null; }
}

// Single clean output per command — no multi-message spam
async function deliverChart(msg, result) {
  const { gridBuf, gridName, symbol, setLabel } = result;
  const feed     = getFeedName(symbol);
  const cacheKey = `${msg.id}_${Date.now()}`;

  cacheForShare(cacheKey, result);

  // MODULE 4 — Share button (prep only, no backend yet)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`share_${cacheKey}`)
      .setLabel('Share')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noshare_${cacheKey}`)
      .setLabel('No thanks')
      .setStyle(ButtonStyle.Secondary)
  );

  return await msg.channel.send({
    content:    `📊 **${symbol}** · ${setLabel} · ${feed}`,
    files:      [new AttachmentBuilder(gridBuf, { name: gridName })],
    components: [row],
  });
}

// ============================================================
// BUTTON HANDLER
// ============================================================

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // No thanks — clear buttons
  if (interaction.customId.startsWith('noshare_')) {
    try { await interaction.update({ content: 'Kept private.', components: [] }); } catch (_) {}
    return;
  }

  // Share — post to #shared-macros
  if (interaction.customId.startsWith('share_')) {
    try { await interaction.deferUpdate(); } catch (err) {
      log('ERROR', '[DEFER]', err.message);
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

      await interaction.editReply({ content: `✅ Shared in #shared-macros`, components: [] });
      log('INFO', `[SHARED] ${cached.symbol} ${cached.setLabel} by ${interaction.user.username}`);

    } catch (err) {
      log('ERROR', '[SHARE]', err.message);
      try { await interaction.editReply({ content: 'Share failed — retry.', components: [] }); } catch (_) {}
    }
  }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

// Atomic dedupe — check AND add synchronously before any await
const PROCESSED_MESSAGES = new Set();

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  // Atomic dedupe — prevents double-fire from Discord shard events
  if (PROCESSED_MESSAGES.has(msg.id)) return;
  PROCESSED_MESSAGES.add(msg.id);
  setTimeout(() => PROCESSED_MESSAGES.delete(msg.id), MESSAGE_DEDUPE_TTL_MS);

  const raw = (msg.content || '').trim();
  if (!raw) return;

  // Ping — works in any channel
  if (raw === '!ping') {
    await safeReply(msg, 'pong');
    return;
  }

  // All chart commands require a mapped group channel
  const group = CHANNEL_GROUP_MAP[msg.channel.id];
  if (!group) return;

  const parsed = parseCommand(raw);
  if (!parsed || parsed.action !== 'chart') return;

  const { symbol, mode } = parsed;

  // Lock before enqueue — one render per symbol at a time
  if (isLocked(symbol)) {
    await safeReply(msg, `⚠️ **${symbol}** is already generating — please wait.`);
    return;
  }

  lock(symbol);

  enqueue(async () => {
    log('INFO', `[CMD] ${msg.author.username} / ${group} → ${symbol} ${mode === 'H' ? 'HTF' : 'LTF'}`);

    const progress = await safeReply(msg, `⏳ Generating **${symbol}** ${mode === 'H' ? 'HTF' : 'LTF'} grid...`);

    try {
      // MODULE 2: routing pipeline
      const result = await runChartPipeline(symbol, mode);

      // Delete progress message
      if (progress) { try { await progress.delete(); } catch (_) {} }

      // MODULE 3: single clean output
      await deliverChart(msg, result);

    } catch (err) {
      log('ERROR', `[CMD FAIL] ${symbol}:`, err.message);
      if (progress) {
        await safeEdit(progress, `❌ **${symbol}** chart failed — retry`);
      }
    } finally {
      unlock(symbol);
    }
  });
});

// ============================================================
// SHARD EVENTS
// ============================================================

client.on('shardDisconnect',   (e, id) => log('WARN',  `[SHARD] ${id} disconnected. Code: ${e.code}`));
client.on('shardReconnecting', (id)    => log('INFO',  `[SHARD] ${id} reconnecting...`));
client.on('shardResume',       (id, n) => log('INFO',  `[SHARD] ${id} resumed. Replayed ${n} events.`));

// ============================================================
// KEEP ALIVE
// ============================================================

setInterval(() => {
  log('INFO', '[KEEP-ALIVE]');
}, 5 * 60 * 1000);

// ============================================================
// START
// ============================================================

client.login(TOKEN);
