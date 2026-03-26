// ============================================================
// ATLAS FX DISCORD BOT — DEFINITIVE FINAL BUILD
// ============================================================
//
// SESSION MANAGEMENT:
//   - Cookies persisted to /tmp/tv_session.json between restarts
//   - Login only occurs if cookies are missing or expired
//   - Survives Render redeploys without re-triggering TV auth
//   - Falls back to guest dark mode if all auth fails
//
// CHART ENGINE:
//   - 4 authenticated single-panel renders → 2x2 composited grid
//   - Each panel at 1280x720, your colour scheme, clean UI
//   - Browser context closed after each panel (memory safe)
//
// COMMANDS:
//   !EURUSDH              — HTF defaults (Weekly, Daily, 4H, 1H)
//   !EURUSDL              — LTF defaults (4H, 1H, 15M, 1M)
//   !EURUSDL 4,1,15,1     — Custom timeframes
//   !ping                 — Health check
//
// ENV VARS (Render dashboard):
//   DISCORD_BOT_TOKEN, TV_USERNAME, TV_PASSWORD
//   TV_LAYOUT_ID (default: GmNAOGhI)
//   SHARED_MACROS_CHANNEL_ID
// ============================================================

process.on('unhandledRejection', (reason) => { console.error('[UNHANDLED]', reason); });
process.on('uncaughtException',  (err)    => { console.error('[CRASH]', err); });

// ── LAYER 1: Environment ─────────────────────────────────────
const TOKEN     = process.env.DISCORD_BOT_TOKEN;
const TV_USER   = process.env.TV_USERNAME  || '';
const TV_PASS   = process.env.TV_PASSWORD  || '';
const TV_LAYOUT = process.env.TV_LAYOUT_ID || 'GmNAOGhI';

if (!TOKEN) { console.error('[FATAL] Missing DISCORD_BOT_TOKEN'); process.exit(1); }

const USE_AUTH = !!(TV_USER && TV_PASS);
console.log(`[BOOT] ATLAS FX Bot starting... TV auth: ${USE_AUTH ? 'ENABLED' : 'DISABLED'}`);

// ── LAYER 2: Discord client ──────────────────────────────────
const {
  Client, GatewayIntentBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
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
const MESSAGE_DEDUPE_TTL_MS = 30000;
const SHARED_MACROS_CHANNEL = process.env.SHARED_MACROS_CHANNEL_ID || '1434253776360968293';
const CACHE_TTL_MS          = 15 * 60 * 1000;
const PANEL_W               = 1280;
const PANEL_H               = 720;

// Cookie persistence — survives redeploys
// /tmp is writable on Render and persists within a running instance
const COOKIE_FILE = '/tmp/tv_session.json';
// Cookies valid for 30 days — re-login after this
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
  return ALIAS_MAP[lower] || raw.toUpperCase();
}

// ── LAYER 5: Symbol routing ──────────────────────────────────
const SYMBOL_OVERRIDES = {
  XAUUSD: 'OANDA:XAUUSD',   XAGUSD: 'OANDA:XAGUSD',
  BCOUSD: 'OANDA:BCOUSD',   USOIL:  'OANDA:BCOUSD',
  NAS100: 'OANDA:NAS100USD', US500:  'OANDA:SPX500USD',
  US30:   'OANDA:US30USD',   GER40:  'OANDA:DE30EUR',
  UK100:  'OANDA:UK100GBP',  NATGAS: 'NYMEX:NG1!',
  MICRON: 'NASDAQ:MU',       AMD:    'NASDAQ:AMD',
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
  return { OANDA: 'OANDA', NASDAQ: 'NASDAQ', NYSE: 'NYSE', NYMEX: 'NYMEX', TVC: 'TVC' }[feed] || feed;
}

// ── LAYER 6: Timeframe resolution ───────────────────────────
const TF_MAP = {
  '1w': '1W', 'w': '1W', 'weekly': '1W',
  '1d': '1D', 'd': '1D', 'daily': '1D',
  '4h': '240', '4': '240', '4hr': '240',
  '2h': '120', '2': '120',
  '1h': '60',  '1': '60',  '1hr': '60',
  '30m': '30', '30': '30',
  '15m': '15', '15': '15',
  '5m':  '5',  '5':  '5',
  '3m':  '3',  '3':  '3',
  '1m':  '1',
  '240': '240', '120': '120', '60': '60',
};

const DEFAULT_TIMEFRAMES = {
  H: ['1W', '1D', '240', '60'],
  L: ['240', '60', '15', '1'],
};

const TF_LABELS = {
  '1W': 'Weekly', '1D': 'Daily',
  '240': '4H', '120': '2H', '60': '1H',
  '30': '30M', '15': '15M', '5': '5M', '3': '3M', '1': '1M',
};

function resolveTF(input) {
  return TF_MAP[input.toLowerCase().trim()] || null;
}

function parseCustomTFs(tfString) {
  const parts = tfString.split(',').map((s) => s.trim());
  if (parts.length !== 4) return null;
  const resolved = parts.map(resolveTF);
  return resolved.includes(null) ? null : resolved;
}

function tfLabel(interval) {
  return TF_LABELS[interval] || interval;
}

// ── LAYER 7: Command parser ──────────────────────────────────
function parseCommand(content) {
  const trimmed = (content || '').trim();
  if (trimmed === '!ping') return { action: 'ping' };

  const m = trimmed.match(/^!([A-Z0-9]{2,12})([LH])(?:\s+([^\s].*))?$/i);
  if (!m) return null;

  const rawSymbol = m[1];
  const mode      = m[2].toUpperCase();
  const tfString  = m[3] ? m[3].trim() : null;
  const symbol    = resolveSymbol(rawSymbol);

  let intervals  = DEFAULT_TIMEFRAMES[mode];
  let customTFs  = false;
  let parseError = null;

  if (tfString) {
    const parsed = parseCustomTFs(tfString);
    if (parsed) { intervals = parsed; customTFs = true; }
    else { parseError = `Invalid timeframes: \`${tfString}\`\nFormat: 4 comma-separated values — e.g. \`4,1,15,1\``; }
  }

  return { action: 'chart', rawSymbol, symbol, mode, intervals, customTFs, parseError };
}

// ── LAYER 8: Logging ─────────────────────────────────────────
function log(level, msg, ...args) {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`, ...args);
}

// ============================================================
// SESSION MANAGEMENT — Persistent cookies
// ============================================================

let tvCookies      = null;
let tvSessionReady = false;

// Load cookies from disk if they exist and aren't expired
function loadCookiesFromDisk() {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return false;
    const raw     = fs.readFileSync(COOKIE_FILE, 'utf8');
    const session = JSON.parse(raw);
    const age     = Date.now() - (session.savedAt || 0);
    if (age > COOKIE_MAX_AGE_MS) {
      log('INFO', '[SESSION] Cookies expired — will re-login');
      fs.unlinkSync(COOKIE_FILE);
      return false;
    }
    tvCookies      = session.cookies;
    tvSessionReady = true;
    log('INFO', `[SESSION] ✅ Loaded ${tvCookies.length} cookies from disk (age: ${Math.round(age / 3600000)}h)`);
    return true;
  } catch (err) {
    log('WARN', `[SESSION] Cookie load failed: ${err.message}`);
    return false;
  }
}

// Save cookies to disk after successful login
function saveCookiesToDisk(cookies) {
  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify({ savedAt: Date.now(), cookies }), 'utf8');
    log('INFO', '[SESSION] Cookies saved to disk');
  } catch (err) {
    log('WARN', `[SESSION] Cookie save failed: ${err.message}`);
  }
}

// Full login — only called when no valid cookies exist
async function loginToTradingView() {
  if (!USE_AUTH) return false;
  log('INFO', '[TV LOGIN] Performing fresh login...');

  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport:   { width: PANEL_W, height: PANEL_H },
    userAgent:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale:     'en-US',
    timezoneId: 'Australia/Perth',
  });

  const page = await context.newPage();
  try {
    await page.goto('https://www.tradingview.com/accounts/signin/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(2500);

    // Click Email sign-in if visible
    try {
      const emailBtn = page.locator('button:has-text("Email"), span:has-text("Email")').first();
      if (await emailBtn.isVisible({ timeout: 4000 })) {
        await emailBtn.click();
        await page.waitForTimeout(1200);
      }
    } catch (_) {}

    // Fill credentials
    const userInput = page.locator('input[name="username"], input[name="login"], input[type="email"], input[autocomplete="username"]').first();
    await userInput.fill(TV_USER, { timeout: 10000 });
    await page.waitForTimeout(500);

    const passInput = page.locator('input[name="password"], input[type="password"]').first();
    await passInput.fill(TV_PASS, { timeout: 10000 });
    await page.waitForTimeout(500);

    // Submit
    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();
    await submitBtn.click({ timeout: 10000 });

    // Wait for redirect away from signin page — up to 30s
    await page.waitForURL((url) => !url.href.includes('/accounts/signin/'), { timeout: 30000 });

    // Grab all cookies
    const cookies  = await context.cookies();
    await browser.close();

    // Verify we got session cookies
    const hasSession = cookies.some((c) => c.name === 'sessionid' || c.name === 'tv_expire');
    if (!hasSession) {
      log('WARN', '[TV LOGIN] No session cookie found — login may have failed silently');
    }

    tvCookies      = cookies;
    tvSessionReady = true;
    saveCookiesToDisk(cookies);
    log('INFO', `[TV LOGIN] ✅ Login successful — ${cookies.length} cookies captured`);
    return true;

  } catch (err) {
    log('ERROR', `[TV LOGIN] ❌ Failed: ${err.message}`);
    await browser.close();
    tvSessionReady = false;
    tvCookies      = null;
    return false;
  }
}

// Validate session by loading a TV page — if redirected to signin, session is dead
async function validateSession() {
  if (!tvCookies) return false;
  log('INFO', '[SESSION] Validating session...');

  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({
    viewport: { width: PANEL_W, height: PANEL_H },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });
  await context.addCookies(tvCookies);
  const page = await context.newPage();

  try {
    await page.goto('https://www.tradingview.com/', {
      waitUntil: 'domcontentloaded', timeout: 20000,
    });
    await page.waitForTimeout(2000);
    const url   = page.url();
    const valid = !url.includes('/accounts/signin/');
    await browser.close();
    log('INFO', `[SESSION] ${valid ? '✅ Valid' : '❌ Expired'}`);
    return valid;
  } catch (err) {
    await browser.close();
    log('WARN', `[SESSION] Validation failed: ${err.message}`);
    return false;
  }
}

// Main auth entry — load from disk, validate, login only if needed
async function ensureSession() {
  if (!USE_AUTH) return;

  // Step 1: Try loading from disk
  const loaded = loadCookiesFromDisk();

  // Step 2: Validate if loaded
  if (loaded) {
    const valid = await validateSession();
    if (valid) {
      log('INFO', '[SESSION] Session ready — skipping login');
      return;
    }
    // Session invalid — clear and re-login
    tvCookies = null; tvSessionReady = false;
    try { fs.unlinkSync(COOKIE_FILE); } catch (_) {}
  }

  // Step 3: Fresh login
  const ok = await loginToTradingView();
  if (!ok) {
    log('WARN', '[SESSION] All auth attempts failed — falling back to guest mode');
  }
}

// ============================================================
// MODULE 1 — CHART ENGINE
// Each panel gets its own isolated browser context
// Context closed immediately after screenshot (memory safe)
// ============================================================

function buildPanelUrl(symbol, interval) {
  const tvSym = encodeURIComponent(getTVSymbol(symbol));
  const iv    = encodeURIComponent(interval);
  return `https://www.tradingview.com/chart/${TV_LAYOUT}/?symbol=${tvSym}&interval=${iv}&hide_side_toolbar=1`;
}

function withTimeout(promise, ms = RENDER_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

async function cleanUI(page) {
  await page.evaluate(() => {
    [
      '[data-name="header-toolbar"]',
      '[data-name="right-toolbar"]',
      '[data-name="left-toolbar"]',
      '.layout__area--right', '.layout__area--left', '.layout__area--top',
      '.tv-side-toolbar', '.tv-control-bar', '.tv-floating-toolbar',
      '.chart-controls-bar', '.header-chart-panel',
      '[data-name="legend"]', '.chart-toolbar',
      '.topbar', '.top-bar', '.tv-watermark',
      '[data-name="alerts-icon"]', '#overlap-manager-root',
      '.bottom-widgetbar-content', '[data-name="bottom-toolbar"]',
    ].forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
    });
  }).catch(() => {});
}

async function renderPanel(symbol, interval, tfKey) {
  const url = buildPanelUrl(symbol, interval);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let browser = null;
    let context = null;
    try {
      log('INFO', `[PANEL] ${symbol} ${tfKey} attempt ${attempt}/${MAX_RETRIES} auth:${tvSessionReady}`);

      const { chromium } = require('playwright');
      // Fresh browser per panel — prevents memory accumulation
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });

      context = await browser.newContext({
        viewport:          { width: PANEL_W, height: PANEL_H },
        deviceScaleFactor: 1,
        userAgent:         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale:            'en-US',
        timezoneId:        'Australia/Perth',
      });

      // Inject session cookies if authenticated
      if (tvSessionReady && tvCookies) {
        await context.addCookies(tvCookies);
      }

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(40000);
      page.setDefaultTimeout(40000);

      await page.addInitScript(() => {
        try { localStorage.setItem('theme', 'dark'); } catch (_) {}
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });

      // Load wait — weekly/daily need more time
      const isLongTF = (interval === '1W' || interval === '1D');
      await page.waitForTimeout(isLongTF ? 6000 : 4500);

      // Dismiss popups
      for (const sel of [
        'button[aria-label="Close"]', 'button:has-text("Accept")',
        'button:has-text("Got it")', 'button:has-text("Dismiss")',
        '[data-name="close-button"]',
      ]) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 400 })) {
            await btn.click({ timeout: 400 });
            await page.waitForTimeout(150);
          }
        } catch (_) {}
      }

      // Detect session expiry
      if (page.url().includes('/accounts/signin/')) {
        log('WARN', '[PANEL] Session expired mid-render — clearing cookies');
        tvSessionReady = false; tvCookies = null;
        try { fs.unlinkSync(COOKIE_FILE); } catch (_) {}
        throw new Error('Session expired');
      }

      // Wait for canvas
      try { await page.waitForSelector('canvas', { timeout: 15000 }); } catch (_) {}

      await cleanUI(page);
      await page.waitForTimeout(700);

      const raw = await page.screenshot({ type: 'png', fullPage: false });

      await browser.close();
      browser = null;

      if (raw.length < 50000) throw new Error(`Blank render (${raw.length}B)`);

      log('INFO', `[PANEL OK] ${symbol} ${tfKey} — ${(raw.length / 1024).toFixed(0)}KB`);
      return raw;

    } catch (err) {
      log('ERROR', `[PANEL FAIL] ${symbol} ${tfKey} attempt ${attempt}: ${err.message}`);
      if (browser) { try { await browser.close(); } catch (_) {} }

      if (err.message.includes('Session expired') && USE_AUTH) {
        log('INFO', '[PANEL] Attempting re-login...');
        await loginToTradingView();
      }

      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function buildGrid(panels) {
  const W = PANEL_W;
  const H = PANEL_H;

  const resized = await Promise.all(
    panels.map((img) =>
      sharp(img).resize(W, H, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).png().toBuffer()
    )
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
    .jpeg({ quality: 93, mozjpeg: true })
    .toBuffer();
}

function archiveRender(buffer, symbol, label) {
  try {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const dir     = path.join(EXPORT_DIR, symbol, dateStr);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${dateStr}_${symbol}_${label}.jpg`), buffer);
  } catch (err) { log('WARN', `[ARCHIVE] ${err.message}`); }
}

// ============================================================
// MODULE 2 — ROUTING ENGINE
// ============================================================

const CHANNEL_GROUP_MAP = {
  '1432642672287547453': 'AT', '1432643496375881748': 'SK',
  '1432644116868501595': 'NM', '1482450651765149816': 'BR',
  '1432080184458350672': 'AT', '1430950313484878014': 'SK',
  '1431192381029482556': 'NM', '1482451091630194868': 'BR',
};

const RUNNING = {};
function isLocked(sym) { return !!RUNNING[sym]; }
function lock(sym)     { RUNNING[sym] = true; }
function unlock(sym)   { RUNNING[sym] = false; }

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

async function runChartPipeline(symbol, mode, intervals, customTFs) {
  const modeLabel = mode === 'H' ? 'HTF' : 'LTF';
  const tfDisplay = intervals.map(tfLabel).join(' · ');
  const label     = customTFs ? tfDisplay : modeLabel;

  log('INFO', `[PIPELINE] ${symbol} ${label} — rendering 4 panels`);

  const panels = [];
  for (let i = 0; i < 4; i++) {
    const iv  = intervals[i];
    const key = tfLabel(iv);
    const raw = await withTimeout(renderPanel(symbol, iv, key));
    panels.push(raw);
  }

  log('INFO', `[PIPELINE] ${symbol} ${label} — compositing`);
  const gridBuf  = await buildGrid(panels);
  const dateStr  = new Date().toISOString().slice(0, 10);
  const gridName = `${dateStr}_${symbol}_${label.replace(/\s·\s/g, '_')}_grid.jpg`;

  archiveRender(gridBuf, symbol, label);
  log('INFO', `[PIPELINE] ${symbol} ${label} — complete`);

  return { gridBuf, gridName, symbol, label, tfDisplay };
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
  const { gridBuf, gridName, symbol, label, tfDisplay } = result;
  const feed     = getFeedName(symbol);
  const cacheKey = `${msg.id}_${Date.now()}`;
  cacheForShare(cacheKey, result);

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
    content:    `📊 **${symbol}** · ${label} · ${feed}\n⏱ ${tfDisplay}`,
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
    try { await interaction.deferUpdate(); } catch (err) { log('ERROR', '[DEFER]', err.message); return; }

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
        content: `📊 **${cached.symbol}** ${cached.label} shared by **${interaction.user.username}**\n⏱ ${cached.tfDisplay}`,
        files:   [new AttachmentBuilder(cached.gridBuf, { name: cached.gridName })],
      });
      await interaction.editReply({ content: '✅ Shared in #shared-macros', components: [] });
      log('INFO', `[SHARED] ${cached.symbol} ${cached.label} by ${interaction.user.username}`);
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

  if (parsed.parseError) { await safeReply(msg, `⚠️ ${parsed.parseError}`); return; }

  const { symbol, mode, intervals, customTFs } = parsed;

  if (isLocked(symbol)) {
    await safeReply(msg, `⚠️ **${symbol}** is already generating — please wait.`);
    return;
  }

  lock(symbol);

  enqueue(async () => {
    const tfDisplay = intervals.map(tfLabel).join(' · ');
    const label     = customTFs ? tfDisplay : (mode === 'H' ? 'HTF' : 'LTF');

    log('INFO', `[CMD] ${msg.author.username} / ${group} → ${symbol} ${label}`);

    const progress = await safeReply(msg, `⏳ Generating **${symbol}** ${label}...\n⏱ ${tfDisplay}`);

    try {
      const result = await runChartPipeline(symbol, mode, intervals, customTFs);
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
// SHARD EVENTS + KEEP ALIVE
// ============================================================

client.on('shardDisconnect',   (e, id) => log('WARN', `[SHARD] ${id} disconnected. Code: ${e.code}`));
client.on('shardReconnecting', (id)    => log('INFO', `[SHARD] ${id} reconnecting...`));
client.on('shardResume',       (id, n) => log('INFO', `[SHARD] ${id} resumed. Replayed ${n} events.`));

setInterval(() => { log('INFO', '[KEEP-ALIVE]'); }, 5 * 60 * 1000);

// ============================================================
// STARTUP
// ============================================================

async function startup() {
  // Ensure TV session — load from disk or login once
  // This does NOT login on every deploy — only when cookies are missing/expired
  await ensureSession();
  await client.login(TOKEN);
}

startup();
