// ============================================================
// ATLAS FX DISCORD BOT — FINAL (FAST + FIXED)
// ============================================================

const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
} = require('discord.js');

const sharp = require('sharp');
const { chromium } = require('playwright');

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// ============================================================
// SYMBOL ROUTING
// ============================================================

function getSymbol(symbol) {
  symbol = symbol.toUpperCase();

  if (symbol === 'MICRON') return 'NASDAQ:MU';

  if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;

  return `NASDAQ:${symbol}`;
}

// ============================================================
// TIMEFRAMES
// ============================================================

const TF_HIGH = [
  { key: '1W', interval: '1W' },
  { key: '1D', interval: '1D' },
  { key: '4H', interval: '240' },
  { key: '1H', interval: '60' },
];

const TF_LOW = [
  { key: '4H', interval: '240' },
  { key: '1H', interval: '60' },
  { key: '15M', interval: '15' },
  { key: '1M', interval: '1' },
];

// ============================================================
// PARSER
// ============================================================

function parse(input) {
  input = input.toUpperCase();

  if (input.endsWith('L')) {
    return { symbol: input.slice(0, -1), tfs: TF_LOW };
  }

  return { symbol: input.replace('H', ''), tfs: TF_HIGH };
}

// ============================================================
// BROWSER (REUSED)
// ============================================================

let browser;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browser;
}

// ============================================================
// RENDER
// ============================================================

async function render(symbol, interval) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(getSymbol(symbol))}&interval=${interval}`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // FORCE TIMEFRAME (CRITICAL)
  const map = {
    '1W': '1 week',
    '1D': '1 day',
    '240': '4 hours',
    '60': '1 hour',
    '15': '15 minutes',
    '1': '1 minute',
  };

  try {
    await page.click('[data-name="header-intervals-button"]');
    await page.waitForTimeout(500);

    const label = map[interval];
    if (label) {
      await page.click(`text=${label}`);
      await page.waitForTimeout(1200);
    }
  } catch {}

  // FIT SCREEN
  try {
    await page.keyboard.press('Alt+R');
    await page.waitForTimeout(300);
    await page.keyboard.press('Shift+R');
  } catch {}

  const shot = await page.screenshot({ type: 'png' });

  await context.close();

  return sharp(shot)
    .resize(1920, 1080)
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ============================================================
// DISCORD
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (!msg.content.startsWith('!chart')) return;

  const input = msg.content.split(' ')[1];

  if (!input) return;

  const { symbol, tfs } = parse(input);

  const loading = await msg.reply(`Generating ${symbol}...`);

  try {
    // PARALLEL EXECUTION (FAST)
    const results = await Promise.all(
      tfs.map(tf => render(symbol, tf.interval))
    );

    const files = results.map((buf, i) =>
      new AttachmentBuilder(buf, {
        name: `${symbol}_${tfs[i].key}.jpg`,
      })
    );

    await loading.edit({
      content: `✅ ${symbol}`,
      files,
    });

  } catch (e) {
    await loading.edit(`❌ Failed: ${e.message}`);
  }
});

client.login(TOKEN);
