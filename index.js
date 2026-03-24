// ============================================================
// ATLAS FX DISCORD BOT — FULL BUILD
// Prefix commands:
//   !ping
//   !chart EURUSD
//   !chart EURUSDH
//   !chart EURUSDL
//
// Output:
//   EURUSD   = Weekly, Daily, 4H, 1H
//   EURUSDH  = Weekly, Daily
//   EURUSDL  = 4H, 1H
// ============================================================

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// ============================================================
// CONFIG
// ============================================================

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TV_LAYOUT_ID = process.env.TV_LAYOUT_ID || '';
const SHARED_MACROS_CHANNEL_ID = process.env.SHARED_MACROS_CHANNEL_ID || '';
const EXPORT_DIR = process.env.EXPORT_DIR || path.join(__dirname, 'exports');
const MAX_RENDER_RETRIES = Number(process.env.MAX_RENDER_RETRIES || 2);

if (!DISCORD_BOT_TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

console.log('[BOOT] ATLAS FX full build starting...');

// ============================================================
// SYMBOL ROUTING
// ============================================================

const FOREX = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF',
  'XAUUSD', 'XAGUSD'
]);

const INDICES = new Set([
  'SPX', 'NDX', 'DJI', 'DAX', 'NAS100', 'US30', 'UK100', 'GER40'
]);

const COMMODITIES = new Set([
  'CL', 'BRENT', 'UKOIL', 'NATGAS', 'NG'
]);

const TIMEFRAMES_HIGH = [
  { key: 'W', label: 'Weekly', interval: 'W' },
  { key: 'D', label: 'Daily', interval: 'D' },
];

const TIMEFRAMES_LOW = [
  { key: '4H', label: '4H', interval: '240' },
  { key: '1H', label: '1H', interval: '60' },
];

const TIMEFRAMES_ALL = [...TIMEFRAMES_HIGH, ...TIMEFRAMES_LOW];

function parseSymbolInput(raw) {
  const upper = String(raw || '').trim().toUpperCase();

  if (!upper) {
    return { symbol: '', set: 'ALL', timeframes: TIMEFRAMES_ALL };
  }

  if (upper.endsWith('H')) {
    return { symbol: upper.slice(0, -1), set: 'H', timeframes: TIMEFRAMES_HIGH };
  }

  if (upper.endsWith('L')) {
    return { symbol: upper.slice(0, -1), set: 'L', timeframes: TIMEFRAMES_LOW };
  }

  return { symbol: upper, set: 'ALL', timeframes: TIMEFRAMES_ALL };
}

function getTVSymbol(symbol) {
  if (FOREX.has(symbol)) return `FX:${symbol}`;
  if (INDICES.has(symbol)) return `INDEX:${symbol}`;
  if (COMMODITIES.has(symbol)) return `NYMEX:${symbol}1!`;
  return `NASDAQ:${symbol}`;
}

function buildChartUrl(symbol, interval) {
  const tvSymbol = encodeURIComponent(getTVSymbol(symbol));

  if (TV_LAYOUT_ID) {
    return `https://www.tradingview.com/chart/${TV_LAYOUT_ID}/?symbol=${tvSymbol}&interval=${interval}`;
  }

  return `https://www.tradingview.com/chart/?symbol=${tvSymbol}&interval=${interval}`;
}

// ============================================================
// FILE / CACHE
// ============================================================

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

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
    ensureDir(dir);
    const filePath = path.join(dir, buildFilename(symbol, tfKey));
    fs.writeFileSync(filePath, buffer);
    console.log('[ARCHIVE]', filePath);
  } catch (err) {
    console.error('[ARCHIVE ERROR]', err.message);
  }
}

// In-memory cache for share button
// key -> { symbol, set, files: [{name, buffer}], expiresAt }
const requestCache = new Map();

function pruneCache() {
  const now = Date.now();
  for (const [key, value] of requestCache.entries()) {
    if (!value || value.expiresAt < now) {
      requestCache.delete(key);
    }
  }
}

setInterval(pruneCache, 60 * 1000);

// ============================================================
// PLAYWRIGHT RENDER
// ============================================================

async function renderChart(symbol, interval, tfKey) {
  const { chromium } = require('playwright');

  const url = buildChartUrl(symbol, interval);
  let browser;

  for (let attempt = 1; attempt <= MAX_RENDER_RETRIES; attempt++) {
    try {
      console.log(`[RENDER] ${symbol} ${tfKey} attempt ${attempt}/${MAX_RENDER_RETRIES}`);
      console.log(`[URL] ${url}`);

      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });

      const page = await context.newPage();

      page.setDefaultNavigationTimeout(45000);
      page.setDefaultTimeout(25000);

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);

      // Try to dismiss common popups/cookie banners
      const dismissSelectors = [
        'button[aria-label="Close"]',
        'button[title="Close"]',
        'button:has-text("Accept")',
        'button:has-text("I Accept")',
        'button:has-text("Got it")',
      ];

      for (const selector of dismissSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 1000 })) {
            await btn.click({ timeout: 1000 });
            await page.waitForTimeout(500);
          }
        } catch (_) {
          // ignore
        }
      }

      // Wait for chart to paint
      try {
        await page.waitForSelector('canvas', { timeout: 15000 });
      } catch (_) {
        // continue - TradingView can still render late
      }

      await page.waitForTimeout(4000);

      // Fullscreen hotkey often helps
      try {
        await page.keyboard.press('Shift+F');
        await page.waitForTimeout(1500);
      } catch (_) {
        // ignore
      }

      const raw = await page.screenshot({ type: 'png', fullPage: false });

      const optimised = await sharp(raw)
        .resize(1920, 1080, { fit: 'cover' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();

      console.log(`[RENDER OK] ${symbol} ${tfKey} ${(optimised.length / 1024 / 1024).toFixed(2)}MB`);

      await browser.close();
      return optimised;
    } catch (err) {
      console.error(`[RENDER FAIL] ${symbol} ${tfKey} ${err.message}`);
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
      if (attempt === MAX_RENDER_RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }

  throw new Error(`Render failed for ${symbol} ${tfKey}`);
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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const raw = (message.content || '').trim();
  if (!raw) return;

  console.log('[MESSAGE]', message.author.username, raw);

  if (raw === '!ping') {
    await message.reply('pong');
    return;
  }

  if (!raw.toLowerCase().startsWith('!chart')) {
    return;
  }

  const parts = raw.split(/\s+/);
  const input = parts[1] || '';

  if (!input) {
    await message.reply('Use: `!chart EURUSD`, `!chart EURUSDH`, or `!chart EURUSDL`');
    return;
  }

  const parsed = parseSymbolInput(input);

  if (!parsed.symbol) {
    await message.reply('Invalid symbol.');
    return;
  }

  const setLabel =
    parsed.set === 'H' ? 'HTF' :
    parsed.set === 'L' ? 'LTF' :
    'ALL';

  console.log(`[CHART] ${message.author.username} -> ${parsed.symbol} ${setLabel}`);

  const progressMsg = await message.reply(`Generating **${parsed.symbol}** ${setLabel} charts...`);

  try {
    const files = [];

    for (const tf of parsed.timeframes) {
      const buffer = await renderChart(parsed.symbol, tf.interval, tf.key);
      saveToArchive(buffer, parsed.symbol, tf.key);

      files.push({
        name: buildFilename(parsed.symbol, tf.key),
        label: tf.label,
        tfKey: tf.key,
        buffer,
      });
    }

    const discordFiles = files.map((file) =>
      new AttachmentBuilder(file.buffer, { name: file.name })
    );

    const cacheKey = `${message.id}_${Date.now()}`;
    requestCache.set(cacheKey, {
      symbol: parsed.symbol,
      set: parsed.set,
      files,
      expiresAt: Date.now() + (15 * 60 * 1000),
    });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`share_${cacheKey}`)
        .setLabel('Share in #shared-macros')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`no_share_${cacheKey}`)
        .setLabel('No thanks')
        .setStyle(ButtonStyle.Secondary)
    );

    await progressMsg.edit({
      content: `✅ **${parsed.symbol}** ${setLabel} charts generated`,
      files: discordFiles,
      components: SHARED_MACROS_CHANNEL_ID ? [buttons] : [],
    });

  } catch (err) {
    console.error('[CHART ERROR]', err);
    await progressMsg.edit(`Failed to generate **${parsed.symbol}** charts.\nReason: ${err.message}`);
  }
});

// ============================================================
// BUTTON HANDLER
// ============================================================

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith('no_share_')) {
    await interaction.update({
      content: 'Charts kept private.',
      components: [],
    });
    return;
  }

  if (!interaction.customId.startsWith('share_')) return;

  const cacheKey = interaction.customId.replace('share_', '');
  const cached = requestCache.get(cacheKey);

  if (!cached) {
    await interaction.update({
      content: 'Share expired. Run the chart command again.',
      components: [],
    });
    return;
  }

  if (!SHARED_MACROS_CHANNEL_ID) {
    await interaction.update({
      content: 'Shared channel is not configured.',
      components: [],
    });
    return;
  }

  const targetChannel = await client.channels.fetch(SHARED_MACROS_CHANNEL_ID).catch(() => null);

  if (!targetChannel || !targetChannel.isTextBased()) {
    await interaction.update({
      content: 'Shared channel not found.',
      components: [],
    });
    return;
  }

  try {
    const attachments = cached.files.map((file) =>
      new AttachmentBuilder(file.buffer, { name: file.name })
    );

    await targetChannel.send({
      content: `📊 **${cached.symbol}** charts shared by **${interaction.user.username}**`,
      files: attachments,
    });

    await interaction.update({
      content: `✅ **${cached.symbol}** charts shared`,
      components: [],
    });

    console.log('[SHARED]', cached.symbol, 'by', interaction.user.username);
  } catch (err) {
    console.error('[SHARE ERROR]', err);
    await interaction.update({
      content: 'Failed to share charts.',
      components: [],
    });
  }
});

// ============================================================
// KEEP ALIVE
// ============================================================

setInterval(() => {
  console.log('[KEEP-ALIVE]', new Date().toISOString());
}, 5 * 60 * 1000);

// ============================================================
// START
// ============================================================

client.login(DISCORD_BOT_TOKEN);
