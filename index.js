// ============================================================
// ATLAS FX DISCORD BOT — FULL FINAL BUILD (GRID + DARK + STABLE)
// ============================================================

process.on('unhandledRejection', (reason) => console.error('[UNHANDLED]', reason));
process.on('uncaughtException', (err) => console.error('[CRASH]', err));

const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const MAX_RETRIES = 2;
const CHART_LOAD_WAIT_MS = 2000;

if (!TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// ============================================================
// SYMBOL
// ============================================================

function buildChartUrl(symbol, interval) {
  return `https://www.tradingview.com/chart/?symbol=OANDA:${symbol}&interval=${interval}&theme=dark`;
}

// ============================================================
// PLAYWRIGHT
// ============================================================

let browser = null;

async function getBrowser() {
  if (!browser) {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

// ============================================================
// RENDER ENGINE (FULL FIX)
// ============================================================

async function renderChart(symbol, interval) {
  const b = await getBrowser();

  const context = await b.newContext({
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();

  // FORCE DARK BEFORE LOAD
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
  });

  // LOAD PAGE (CRITICAL FIX)
  await page.goto(buildChartUrl(symbol, interval), {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });

  // FORCE DARK AFTER LOAD
  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    document.body.classList.add('theme-dark');
  });

  await page.waitForTimeout(CHART_LOAD_WAIT_MS);

  // CLEAN UI
  await page.evaluate(() => {
    const remove = [
      '[data-name="right-toolbar"]',
      '.layout__area--right',
      '.tv-control-bar',
      '.tv-floating-toolbar'
    ];
    remove.forEach(s => document.querySelectorAll(s).forEach(e => e.remove()));

    document.querySelectorAll('*').forEach(el => {
      const t = (el.innerText || '').trim();
      if (t.startsWith('Vol')) el.remove();
    });
  });

  await page.waitForTimeout(300);

  const img = await page.screenshot({ type: 'png' });

  await context.close();

  return img;
}

// ============================================================
// GRID COMBINE (NEW)
// ============================================================

async function combineGrid(images) {
  const w = 1280;
  const h = 720;

  const resized = await Promise.all(
    images.map(img => sharp(img).resize(w, h).toBuffer())
  );

  return await sharp({
    create: {
      width: w * 2,
      height: h * 2,
      channels: 3,
      background: '#0b0b0b'
    }
  })
    .composite([
      { input: resized[0], left: 0, top: 0 },
      { input: resized[1], left: w, top: 0 },
      { input: resized[2], left: 0, top: h },
      { input: resized[3], left: w, top: h }
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('clientReady', () => {
  console.log('[READY]');
});

// ============================================================
// DUPLICATE PROTECTION
// ============================================================

let busy = false;
let lastMessage = null;

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  if (msg.id === lastMessage) return;
  lastMessage = msg.id;

  if (!msg.content.startsWith('!')) return;

  if (busy) {
    msg.reply('⏳ Busy — wait');
    return;
  }

  busy = true;

  try {
    const raw = msg.content.toUpperCase();

    const symbol = raw.replace('!', '').replace(/[LH]/, '');

    const isLTF = raw.endsWith('L');

    const tfs = isLTF
      ? ['240', '60', '15', '1']
      : ['1W', '1D', '240', '60'];

    await msg.reply(`⏳ Generating ${symbol}...`);

    const imgs = [];

    for (const tf of tfs) {
      imgs.push(await renderChart(symbol, tf));
    }

    const grid = await combineGrid(imgs);

    await msg.channel.send({
      content: `📊 ${symbol} — ${isLTF ? 'LTF' : 'HTF'} GRID`,
      files: [new AttachmentBuilder(grid, { name: 'grid.jpg' })]
    });

  } catch (err) {
    console.error(err);
    msg.reply('❌ Failed');
  }

  busy = false;
});

// ============================================================

client.login(TOKEN);
