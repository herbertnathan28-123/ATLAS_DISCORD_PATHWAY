// ============================================================
// ATLAS FX DISCORD BOT — DEFINITIVE FINAL BUILD
// ============================================================
//
// CHART QUALITY: Authenticated TradingView session
//   - Logs in with TV_USERNAME + TV_PASSWORD env vars
//   - Loads your saved layout GmNAOGhI
//   - Renders your exact colour scheme and settings
//   - Falls back to guest dark theme if login fails
//
// COMMANDS (in group channels only):
//   !EURUSDH  — HTF grid (Weekly, Daily, 4H, 1H)
//   !EURUSDL  — LTF grid (4H, 1H, 15M, 1M)
//   !ping     — Health check
//
// ENV VARS (Render dashboard):
//   DISCORD_BOT_TOKEN       — required
//   TV_USERNAME             — TradingView username or email
//   TV_PASSWORD             — TradingView password
//   TV_LAYOUT_ID            — your layout ID (default: GmNAOGhI)
//   AT_COMBINED_WEBHOOK | SK_COMBINED_WEBHOOK
//   NM_COMBINED_WEBHOOK | BR_COMBINED_WEBHOOK
//   SHARED_MACROS_CHANNEL_ID
// ============================================================

process.on('unhandledRejection', (reason) => { console.error('[UNHANDLED]', reason); });
process.on('uncaughtException',  (err)    => { console.error('[CRASH]', err); });

// ── LAYER 1: Environment ─────────────────────────────────────
const TOKEN       = process.env.DISCORD_BOT_TOKEN;
const TV_USER     = process.env.TV_USERNAME    || '';
const TV_PASS     = process.env.TV_PASSWORD    || '';
const TV_LAYOUT   = process.env.TV_LAYOUT_ID   || 'GmNAOGhI';

if (!TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

const USE_AUTH = !!(TV_USER && TV_PASS);
console.log(`[BOOT] ATLAS FX Bot starting... TV auth: ${USE_AUTH ? 'ENABLED' : 'DISABLED (guest mode)'}`);

// ── LAYER 2: Discord client ──────────────────────────────────
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

client.once('clientReady', () => {
  console.log(`[READY] ATLAS FX Bot online as ${client.user.tag}`);
});

// ── LAYER 3: Config ──────────────────────────────────────────
const EXPORT_DIR            = process.env.EXPORT_DIR || path.join(__dirname, 'exports');
const MAX_RETRIES           = 2;
const RENDER_TIMEOUT_MS     = 45000;
const CHART_LOAD_WAIT_MS    = 4000;
const MESSAGE_DEDUPE_TTL_MS = 30000;
const SHARED_MACROS_CHANNEL = process.env.SHARED_MACROS_CHANNEL_ID || '1434253776360968293';
const CACHE_TTL_MS          = 15 * 60 * 1000;

// ── LAYER 4: Alias mapping ───────────────────────────────────
const ALIAS_MAP = {
  gold:   'XAUUSD',  xau:    'XAUUSD',
  silver: 'XAGUSD',  xag:    'XAGUSD',
  brent:  'BCOUSD',  wti:    'USOIL',   oil:    'USOIL',
  nas100: 'NAS100',  nas:    'NAS100',  nasdaq: 'NAS100',
  sp500:  'US500',   spx:    'US500',   us500:  'US500',
  dow:    'US30',    dji:    'US30',    us30:   'US30',
  dax:    'GER40',   ger40:  'GER40',
  ftse:   'UK100',   uk100:  'UK100',
  natgas: 'NATGAS',  ng:     'NATGAS',
  micron: 'MICRON',  mu:     'MICRON',
  amd:    'AMD',     asml:   'ASML',
};

function resolveSymbol(raw) {
  const lower = raw.toLowerCase().trim();
  return ALIAS_MAP[lower] ? ALIAS_MAP[lower] : raw.toUpperCase();
}

// ── LAYER 5: Symbol routing ──────────────────────────────────
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

// Build chart URL — uses layout ID when authenticated, plain URL for guest
function buildChartUrl(symbol, interval, useLayout) {
  const tvSymbol = encodeURIComponent(getTVSymbol(symbol));
  if (useLayout) {
    return `https://www.tradingview.com/chart/${TV_LAYOUT}/?symbol=${tvSymbol}&interval=${interval}`;
  }
  return `https://www.tradingview.com/chart/?symbol=${tvSymbol}&interval=${interval}&theme=dark`;
}

// ── LAYER 6: Command parser ──────────────────────────────────
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

// ── LAYER 7: Logging ─────────────────────────────────────────
function log(level, msg, ...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`, ...args);
}

// ============================================================
// BROWSER + SESSION MANAGEMENT
// ============================================================

let browser        = null;
let tvSessionReady = false;   // true once login confirmed
let tvCookies      = null;    // persisted across renders

async function getBrowser() {
  if (!browser) {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    browser.on('disconnected', () => {
      log('WARN', 'Browser disconnected — will relaunch');
      browser        = null;
      tvSessionReady = false;
      tvCookies      = null;
    });
  }
  return browser;
}

// ── TV LOGIN ─────────────────────────────────────────────────
// Called once at startup and after session expiry
async function loginToTradingView() {
  if (!USE_AUTH) return false;

  log('INFO', '[TV LOGIN] Authenticating with TradingView...');

  const b       = await getBrowser();
  const context = await b.newContext({
    viewport:       { width: 1920, height: 1080 },
    userAgent:      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale:         'en-US',
    timezoneId:     'Australia/Perth',
  });

  const page = await context.newPage();

  try {
    // Go to sign-in page
    await page.goto('https://www.tradingview.com/accounts/signin/', {
      waitUntil: 'domcontentloaded',
      timeout:   30000,
    });

    await page.waitForTimeout(2000);

    // Click "Email" sign-in option if visible
    try {
      const emailBtn = page.locator('button:has-text("Email"), span:has-text("Email")').first();
      if (await emailBtn.isVisible({ timeout: 3000 })) {
        await emailBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch (_) {}

    // Fill credentials
    await page.fill('input[name="username"], input[type="text"]', TV_USER);
    await page.waitForTimeout(500);
    await page.fill('input[name="password"], input[type="password"]', TV_PASS);
    await page.waitForTimeout(500);

    // Submit
    await page.click('button[type="submit"], button:has-text("Sign in")');

    // Wait for successful login — URL changes away from /accounts/signin/
    await page.waitForURL((url) => !url.href.includes('/accounts/signin/'), { timeout: 20000 });

    // Capture session cookies
    tvCookies      = await context.cookies();
    tvSessionReady = true;

    log('INFO', '[TV LOGIN] ✅ Login successful');
    await context.close();
    return true;

  } catch (err) {
    log('ERROR', `[TV LOGIN] ❌ Login failed: ${err.message}`);
    tvSessionReady = false;
    tvCookies      = null;
    await context.close();
    return false;
  }
}

// ── CREATE AUTHENTICATED CONTEXT ─────────────────────────────
async function getAuthContext() {
  const b = await getBrowser();

  const context = await b.newContext({
    viewport:       { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    userAgent:      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale:         'en-US',
    timezoneId:     'Australia/Perth',
  });

  // Inject saved cookies for authenticated session
  if (tvCookies && tvCookies.length > 0) {
    await context.addCookies(tvCookies);
  }

  return context;
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

function withTimeout(promise, ms = RENDER_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// Clean TradingView UI — removes all chrome, leaving only the chart canvas
async function cleanUI(page) {
  await page.evaluate(() => {
    const remove = [
      // Toolbars + sidebars
      '[data-name="header-toolbar"]',
      '[data-name="right-toolbar"]',
      '[data-name="left-toolbar"]',
      '.layout__area--right',
      '.layout__area--left',
      '.layout__area--top',
      '.tv-side-toolbar',
      '.tv-control-bar',
      '.tv-floating-toolbar',
      '.js-symbol-logo',
      '.chart-controls-bar',
      '.header-chart-panel',
      '[data-name="legend"]',
      '.chart-toolbar',
      // Top bar
      '.topbar',
      '.top-bar',
      '#header-toolbar-chart-styles',
      '#header-toolbar-studies',
      '#header-toolbar-watchlist-screener',
      // Watermark
      '.tv-watermark',
      // Alerts
      '[data-name="alerts-icon"]',
    ];
    remove.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    });

    // Remove volume pane
    document.querySelectorAll('[class*="pane"]').forEach((el) => {
      const text = (el.innerText || '').trim();
      if (text === 'Vol' || text.startsWith('Vol ')) el.style.display = 'none';
    });
    document.querySelectorAll('*').forEach((el) => {
      const text = (el.innerText || '').trim();
      if (text === 'Vol' || text.startsWith('Vol ')) el.style.display = 'none';
    });
  }).catch(() => {});
}

// Render a single chart panel
async function renderChart(symbol, interval, tfKey) {
  const useLayout = tvSessionReady && tvCookies !== null;
  const url       = buildChartUrl(symbol, interval, useLayout);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let context = null;
    try {
      log('INFO', `[RENDER] ${symbol} ${tfKey} attempt ${attempt}/${MAX_RETRIES} | auth:${useLayout}`);

      context = await getAuthContext();
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(40000);
      page.setDefaultTimeout(40000);

      // Force dark theme regardless of auth state
      await page.addInitScript(() => {
        try {
          localStorage.setItem('theme', 'dark');
          localStorage.setItem('chart.background', '#0f1116');
        } catch (_) {}
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });

      // Wait for chart to fully load — longer for auth (layout is heavier)
      const baseWait = useLayout ? CHART_LOAD_WAIT_MS + 2000 : CHART_LOAD_WAIT_MS;
      const tfWait   = (interval === '1' || interval === '15') ? baseWait + 2000 : baseWait;
      await page.waitForTimeout(tfWait);

      // Dismiss any popups or modals
      for (const sel of [
        'button[aria-label="Close"]',
        'button:has-text("Accept")',
        'button:has-text("Got it")',
        'button:has-text("Dismiss")',
        '[data-name="close-button"]',
      ]) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 600 })) {
            await btn.click({ timeout: 600 });
            await page.waitForTimeout(300);
          }
        } catch (_) {}
      }

      // Wait for canvas
      try { await page.waitForSelector('canvas', { timeout: 15000 }); } catch (_) {}

      // If session expired mid-render, detect and flag
      const currentUrl = page.url();
      if (currentUrl.includes('/accounts/signin/')) {
        log('WARN', '[RENDER] Session expired — triggering re-login');
        tvSessionReady = false;
        tvCookies      = null;
        throw new Error('Session expired');
      }

      // Clean all UI chrome
      await cleanUI(page);
      await page.waitForTimeout(600);

      const raw = await page.screenshot({ type: 'png', fullPage: false });
      await context.close();
      context = null;

      // Blank render guard
      if (raw.length < 50000) {
        throw new Error(`Blank render (${raw.length}B) — chart may not have loaded`);
      }

      log('INFO', `[RENDER OK] ${symbol} ${tfKey} ${(raw.length / 1024).toFixed(0)}KB`);
      return raw;

    } catch (err) {
      log('ERROR', `[RENDER FAIL] ${symbol} ${tfKey} attempt ${attempt}: ${err.message}`);
      if (context) { try { await context.close(); } catch (_) {} }

      // If session expired, try to re-login before next attempt
      if (err.message.includes('Session expired') && USE_AUTH) {
        log('INFO', '[RENDER] Re-authenticating...');
        await loginToTradingView();
      }

      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}

// Compose 4 raw PNGs into a 2x2 dark grid
async function buildGrid(rawImages) {
  const W = 1920;
  const H = 1080;

  const resized = await Promise.all(
    rawImages.map((img) => sharp(img).resize(W, H, { fit: 'cover' }).png().toBuffer())
  );

  return await sharp({
    create: {
      width:      W * 2,
      height:     H * 2,
      channels:   4,
      background: { r: 11, g: 11, b: 11, alpha: 1 },
    },
  })
    .composite([
      { input: resized[0], left: 0, top: 0 },
      { input: resized[1], left: W, top: 0 },
      { input: resized[2], left: 0, top: H },
      { input: resized[3], left: W, top: H },
    ])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

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

const RUNNING = {};
function isLocked(sym)  { return !!RUNNING[sym]; }
function lock(sym)      { RUNNING[sym] = true; }
function unlock(sym)    { RUNNING[sym] = false; }

const queue        = [];
let   queueRunning = false;

function enqueue(job) { queue.push(job); void runQueue(); }

async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try { await job(); } catch (err) { log('ERROR', '[QUEUE]', err.message); }
  }
  queueRunning = false;
}

async function runChartPipeline(symbol, mode) {
  const tfs      = TIMEFRAMES[mode];
  const setLabel = mode === 'H' ? 'HTF' : 'LTF';

  log('INFO', `[PIPELINE] ${symbol} ${setLabel} — starting`);

  const rawImages = [];
  for (const tf of tfs) {
    const raw = await withTimeout(renderChart(symbol, tf.interval, tf.key));
    archiveChart(raw, symbol, tf.key);
    rawImages.push(raw);
  }

  const gridBuf  = await buildGrid(rawImages);
  const gridName = `${new Date().toISOString().slice(0, 10)}_${symbol}_${setLabel}_grid.jpg`;

  log('INFO', `[PIPELINE] ${symbol} ${setLabel} — complete`);

  // Hooks prepared — not yet active
  // const macro   = await macroModule.run(symbol, mode);
  // const roadmap = await roadmapModule.run(symbol);

  return { gridBuf, gridName, symbol, setLabel };
}

// ============================================================
// MODULE 3 — DISCORD OUTPUT
// ============================================================

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

async function safeReply(msg, payload) {
  try { return await msg.reply(payload); } catch (e) { log('ERROR', '[REPLY]', e.message); return null; }
}
async function safeEdit(msg, payload) {
  try { return await msg.edit(payload);  } catch (e) { log('ERROR', '[EDIT]',  e.message); return null; }
}

async function deliverChart(msg, result) {
  const { gridBuf, gridName, symbol, setLabel } = result;
  const feed     = getFeedName(symbol);
  const cacheKey = `${msg.id}_${Date.now()}`;
  cacheForShare(cacheKey, result);

  // MODULE 4 — Share button (prep only)
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

  if (interaction.customId.startsWith('noshare_')) {
    try { await interaction.update({ content: 'Kept private.', components: [] }); } catch (_) {}
    return;
  }

  if (interaction.customId.startsWith('share_')) {
    try { await interaction.deferUpdate(); } catch (err) {
      log('ERROR', '[DEFER]', err.message); return;
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
      await interaction.editReply({ content: '✅ Shared in #shared-macros', components: [] });
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

const PROCESSED_MESSAGES = new Set();

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (PROCESSED_MESSAGES.has(msg.id)) return;
  PROCESSED_MESSAGES.add(msg.id);
  setTimeout(() => PROCESSED_MESSAGES.delete(msg.id), MESSAGE_DEDUPE_TTL_MS);

  const raw = (msg.content || '').trim();
  if (!raw) return;

  if (raw === '!ping') { await safeReply(msg, 'pong'); return; }

  const group = CHANNEL_GROUP_MAP[msg.channel.id];
  if (!group) return;

  const parsed = parseCommand(raw);
  if (!parsed || parsed.action !== 'chart') return;

  const { symbol, mode } = parsed;

  if (isLocked(symbol)) {
    await safeReply(msg, `⚠️ **${symbol}** is already generating — please wait.`);
    return;
  }

  lock(symbol);

  enqueue(async () => {
    log('INFO', `[CMD] ${msg.author.username} / ${group} → ${symbol} ${mode === 'H' ? 'HTF' : 'LTF'}`);
    const progress = await safeReply(msg, `⏳ Generating **${symbol}** ${mode === 'H' ? 'HTF' : 'LTF'} grid...`);

    try {
      const result = await runChartPipeline(symbol, mode);
      if (progress) { try { await progress.delete(); } catch (_) {} }
      await deliverChart(msg, result);
    } catch (err) {
      log('ERROR', `[CMD FAIL] ${symbol}:`, err.message);
      if (progress) await safeEdit(progress, `❌ **${symbol}** chart failed — retry`);
    } finally {
      unlock(symbol);
    }
  });
});

// ============================================================
// SHARD EVENTS
// ============================================================

client.on('shardDisconnect',   (e, id) => log('WARN', `[SHARD] ${id} disconnected. Code: ${e.code}`));
client.on('shardReconnecting', (id)    => log('INFO', `[SHARD] ${id} reconnecting...`));
client.on('shardResume',       (id, n) => log('INFO', `[SHARD] ${id} resumed. Replayed ${n} events.`));

// ============================================================
// KEEP ALIVE
// ============================================================

setInterval(() => { log('INFO', '[KEEP-ALIVE]'); }, 5 * 60 * 1000);

// ============================================================
// STARTUP SEQUENCE
// ============================================================

async function startup() {
  // Attempt TradingView login before connecting to Discord
  if (USE_AUTH) {
    const ok = await loginToTradingView();
    if (!ok) {
      log('WARN', '[STARTUP] TV login failed — charts will render in guest dark mode');
    }
  } else {
    log('WARN', '[STARTUP] No TV credentials set — add TV_USERNAME and TV_PASSWORD in Render env vars for premium quality');
  }

  // Connect to Discord
  await client.login(TOKEN);
}

startup();
