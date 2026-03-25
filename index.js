// ============================================================
// ATLAS FX DISCORD BOT — FINAL
// Pipeline: SOURCE -> FRAME -> RENDER -> FILE -> POST
//
// COMMANDS:
//   !ping
//   !chart EURUSDH  -- High timeframes: Weekly, Daily, 4H, 1H
//   !chart EURUSDL  -- Low timeframes:  4H, 1H, 15M, 1M
//   !chart EURUSD   -- High timeframes (default)
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

const sharp    = require('sharp');
const path     = require('path');
const fs       = require('fs');

// ============================================================
// CONFIG
// ============================================================

const TOKEN                  = process.env.DISCORD_BOT_TOKEN;
const SHARED_MACROS_CHANNEL  = process.env.SHARED_MACROS_CHANNEL_ID || '';
const EXPORT_DIR             = process.env.EXPORT_DIR || path.join(__dirname, 'exports');
const MAX_RETRIES            = Number(process.env.MAX_RENDER_RETRIES || 2);

if (!TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

console.log('[BOOT] ATLAS FX Bot starting...');

// ============================================================
// SYMBOL ROUTING
// ============================================================

// Known symbol overrides
const SYMBOL_OVERRIDES = {
  'MICRON': 'NASDAQ:MU',
  'MU':     'NASDAQ:MU',
};

function getTVSymbol(symbol) {
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];

  // 6-char forex pairs -> OANDA
  if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;

  // Metals
  if (symbol === 'XAUUSD') return `OANDA:XAUUSD`;
  if (symbol === 'XAGUSD') return `OANDA:XAGUSD`;

  // Default -> NASDAQ
  return `NASDAQ:${symbol}`;
}

function buildChartUrl(symbol, interval) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(getTVSymbol(symbol))}&interval=${interval}`;
}

// ============================================================
// TIMEFRAMES
// ============================================================

const TF_HIGH = [
  { key: '1W',  label: 'Weekly',  interval: '1W'  },
  { key: '1D',  label: 'Daily',   interval: '1D'  },
  { key: '4H',  label: '4H',      interval: '240' },
  { key: '1H',  label: '1H',      interval: '60'  },
];

const TF_LOW = [
  { key: '4H',  label: '4H',      interval: '240' },
  { key: '1H',  label: '1H',      interval: '60'  },
  { key: '15M', label: '15M',     interval: '15'  },
  { key: '1M',  label: '1M',      interval: '1'   },
];

const TF_INTERVAL_MAP = {
  '1W':  '1 week',
  '1D':  '1 day',
  '240': '4 hours',
  '60':  '1 hour',
  '15':  '15 minutes',
  '1':   '1 minute',
};

// ============================================================
// PARSER
// ============================================================

function parse(input) {
  const upper = (input || '').toUpperCase().trim();

  if (upper.endsWith('L')) {
    return { symbol: upper.slice(0, -1), tfs: TF_LOW, setLabel: 'LTF' };
  }

  if (upper.endsWith('H')) {
    return { symbol: upper.slice(0, -1), tfs: TF_HIGH, setLabel: 'HTF' };
  }

  // No suffix -- default to high timeframes
  return { symbol: upper, tfs: TF_HIGH, setLabel: 'HTF' };
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
    const filePath = path.join(dir, buildFilename(symbol, tfKey));
    fs.writeFileSync(filePath, buffer);
    console.log('[ARCHIVE]', filePath);
  } catch (err) {
    console.error('[ARCHIVE ERROR]', err.message);
  }
}

// ============================================================
// IN-MEMORY CACHE (for share button, 15 min TTL)
// ============================================================

const requestCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of requestCache.entries()) {
    if (val.expiresAt < now) requestCache.delete(key);
  }
}, 60 * 1000);

// ============================================================
// BROWSER (persistent, reset on crash)
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
// RENDER
// ============================================================

async function renderChart(symbol, interval, tfKey) {
  const url = buildChartUrl(symbol, interval);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let context;
    try {
      console.log(`[RENDER] ${symbol} ${tfKey} attempt ${attempt}/${MAX_RETRIES}`);
      console.log(`[URL] ${url}`);

      const b = await getBrowser();

      context = await b.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(45000);
      page.setDefaultTimeout(25000);

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);

      // Dismiss popups/cookie banners
      const dismissSelectors = [
        'button[aria-label="Close"]',
        'button[title="Close"]',
        'button:has-text("Accept")',
        'button:has-text("I Accept")',
        'button:has-text("Got it")',
      ];
      for (const sel of dismissSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 800 })) {
            await btn.click({ timeout: 800 });
            await page.waitForTimeout(400);
          }
        } catch (_) {}
      }

      // Wait for chart canvas
      try {
        await page.waitForSelector('canvas', { timeout: 15000 });
      } catch (_) {}

      // Force timeframe via UI click
      try {
        await page.click('[data-name="header-intervals-button"]');
        await page.waitForTimeout(600);
        const label = TF_INTERVAL_MAP[interval];
        if (label) {
          await page.click(`text=${label}`);
          await page.waitForTimeout(1500);
          console.log(`[TF SET] ${symbol} -> ${label}`);
        }
      } catch (_) {
        console.warn(`[TF CLICK FAIL] ${symbol} ${tfKey} -- using URL interval`);
      }

      // Extra settle
      await page.waitForTimeout(2000);

      // Fullscreen
      try {
        await page.keyboard.press('Shift+F');
        await page.waitForTimeout(1000);
      } catch (_) {}

      const raw = await page.screenshot({ type: 'png', fullPage: false });
      await context.close();

      const optimised = await sharp(raw)
        .resize(1920, 1080, { fit: 'cover' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();

      console.log(`[RENDER OK] ${symbol} ${tfKey} ${(optimised.length / 1024 / 1024).toFixed(2)}MB`);
      return optimised;

    } catch (err) {
      console.error(`[RENDER FAIL] ${symbol} ${tfKey} attempt ${attempt}: ${err.message}`);
      if (context) { try { await context.close(); } catch (_) {} }
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 2500));
    }
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

  const raw = (msg.content || '').trim();
  if (!raw) return;

  // Ping
  if (raw === '!ping') {
    await msg.reply('pong');
    return;
  }

  if (!raw.toLowerCase().startsWith('!chart')) return;

  const parts  = raw.split(/\s+/);
  const input  = parts[1] || '';

  if (!input) {
    await msg.reply('Usage: `!chart EURUSDH` (HTF) or `!chart EURUSDL` (LTF)');
    return;
  }

  const { symbol, tfs, setLabel } = parse(input);

  if (!symbol) {
    await msg.reply('Invalid symbol.');
    return;
  }

  console.log(`[CHART] ${msg.author.username} -> ${symbol} ${setLabel}`);

  const progress = await msg.reply(`⏳ Generating **${symbol}** ${setLabel} charts...`);

  try {
    // Parallel render all timeframes simultaneously
    const buffers = await Promise.all(
      tfs.map((tf) => renderChart(symbol, tf.interval, tf.key))
    );

    // Archive and build attachments
    const files = buffers.map((buf, i) => {
      saveToArchive(buf, symbol, tfs[i].key);
      return new AttachmentBuilder(buf, { name: buildFilename(symbol, tfs[i].key) });
    });

    // Cache for share button (15 min TTL)
    const cacheKey = `${msg.id}_${Date.now()}`;
    requestCache.set(cacheKey, {
      symbol,
      setLabel,
      buffers: buffers.map((buf, i) => ({
        buf,
        name: buildFilename(symbol, tfs[i].key),
      })),
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    // Build share buttons if channel is configured
    const components = [];
    if (SHARED_MACROS_CHANNEL) {
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`share_${cacheKey}`)
            .setLabel('Share in #shared-macros')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`no_share_${cacheKey}`)
            .setLabel('No thanks')
            .setStyle(ButtonStyle.Secondary)
        )
      );
    }

    await progress.edit({
      content:    `✅ **${symbol}** ${setLabel} charts`,
      files,
      components,
    });

  } catch (err) {
    console.error('[CHART ERROR]', err.message);
    await progress.edit(`❌ Failed to generate **${symbol}** charts.\nReason: ${err.message}`);
  }
});

// ============================================================
// BUTTON HANDLER
// ============================================================

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // No thanks
  if (interaction.customId.startsWith('no_share_')) {
    try {
      await interaction.update({ content: 'Charts kept private.', components: [] });
    } catch (err) {
      console.error('[NO_SHARE ERROR]', err.message);
    }
    return;
  }

  // Share
  if (interaction.customId.startsWith('share_')) {

    // Defer immediately -- Discord 3s timeout
    try {
      await interaction.deferUpdate();
    } catch (err) {
      console.error('[DEFER FAIL] Interaction expired:', err.message);
      return;
    }

    const cacheKey = interaction.customId.replace('share_', '');
    const cached   = requestCache.get(cacheKey);

    if (!cached) {
      await interaction.editReply({ content: 'Share expired — run the command again.', components: [] });
      return;
    }

    if (!SHARED_MACROS_CHANNEL) {
      await interaction.editReply({ content: 'Shared channel not configured.', components: [] });
      return;
    }

    try {
      const channel = await client.channels.fetch(SHARED_MACROS_CHANNEL).catch(() => null);

      if (!channel || !channel.isTextBased()) {
        await interaction.editReply({ content: 'Shared channel not found.', components: [] });
        return;
      }

      const attachments = cached.buffers.map((f) =>
        new AttachmentBuilder(f.buf, { name: f.name })
      );

      await channel.send({
        content: `📊 **${cached.symbol}** ${cached.setLabel} charts shared by **${interaction.user.username}**`,
        files:   attachments,
      });

      await interaction.editReply({
        content:    `✅ **${cached.symbol}** ${cached.setLabel} charts shared in #shared-macros`,
        components: [],
      });

      console.log('[SHARED]', cached.symbol, cached.setLabel, 'by', interaction.user.username);

    } catch (err) {
      console.error('[SHARE ERROR]', err.message);
      try {
        await interaction.editReply({ content: 'Failed to share charts.', components: [] });
      } catch (_) {}
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
// KEEP ALIVE
// ============================================================

setInterval(() => {
  console.log('[KEEP-ALIVE]', new Date().toISOString());
}, 5 * 60 * 1000);

// ============================================================
// START
// ============================================================

client.login(TOKEN);
