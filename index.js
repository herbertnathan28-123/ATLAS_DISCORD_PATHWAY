// ============================================================
// ATLAS FX DISCORD BOT — DEFINITIVE FINAL BUILD (STABLE CORE)
// ============================================================

process.on('unhandledRejection', (r) => console.error('[UNHANDLED]', r));
process.on('uncaughtException', (e) => console.error('[CRASH]', e));

// ── ENV ─────────────────────────────────────────────────────
const TOKEN     = process.env.DISCORD_BOT_TOKEN;
const TV_LAYOUT = process.env.TV_LAYOUT_ID || 'GmNAOGhI';
const TV_COOKIES = process.env.TV_COOKIES ? JSON.parse(process.env.TV_COOKIES) : null;

if (!TOKEN) process.exit(1);

const {
  Client, GatewayIntentBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder
} = require('discord.js');

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');
const { chromium } = require('playwright');

// ── CLIENT ───────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('clientReady', () => {
  console.log(`[READY] ${client.user.tag}`);
});

// ── CONFIG ───────────────────────────────────────────────────
const PANEL_W = 1280;
const PANEL_H = 720;

// ── SYMBOL MAP (RESTORED — CRITICAL) ─────────────────────────
const SYMBOL_OVERRIDES = {
  MICRON: 'NASDAQ:MU',
  AMD: 'NASDAQ:AMD',
  ASML: 'NASDAQ:ASML',
  XAUUSD: 'OANDA:XAUUSD',
  XAGUSD: 'OANDA:XAGUSD'
};

function getTVSymbol(symbol) {
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];
  if (/^[A-Z]{6}$/.test(symbol)) return `OANDA:${symbol}`;
  return `NASDAQ:${symbol}`;
}

// ── TIMEFRAMES ───────────────────────────────────────────────
const DEFAULT_TIMEFRAMES = {
  H: ['1W','1D','240','60'],
  L: ['240','60','15','1'],
};

// ============================================================
// SINGLE SESSION ENGINE (NO LOGIN)
// ============================================================

let browser = null;
let context = null;

async function initSession() {
  if (browser) return;

  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage']
  });

  context = await browser.newContext({
    viewport: { width: PANEL_W, height: PANEL_H }
  });

  if (TV_COOKIES) {
    await context.addCookies(TV_COOKIES);
    console.log('[SESSION] Cookies loaded');
  } else {
    console.log('[SESSION] Running in guest mode');
  }
}

// ============================================================
// CHART ENGINE (FIXED)
// ============================================================

function buildPanelUrl(symbol, interval) {
  const tvSym = encodeURIComponent(getTVSymbol(symbol));
  const iv    = encodeURIComponent(interval);

  // 🔥 SINGLE CHART MODE (NO LAYOUT)
  return `https://www.tradingview.com/chart/?symbol=${tvSym}&interval=${iv}&hide_side_toolbar=1`;
}

async function cleanUI(page) {
  await page.evaluate(() => {
    [
      '[data-name="header-toolbar"]',
      '.tv-side-toolbar'
    ].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.style.display = 'none');
    });
  });
}

async function renderPanel(symbol, tf) {

  const page = await context.newPage();
  const url = buildPanelUrl(symbol, tf);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  await cleanUI(page);

  // 🔥 NORMALIZE VIEW
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.click();

    for (let i = 0; i < 6; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    }

    for (let i = 0; i < 5; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    }
  });

  await page.waitForTimeout(1200);

  const img = await page.screenshot({ type: 'png' });
  await page.close();

  return img;
}

// ── GRID ─────────────────────────────────────────────────────
async function buildGrid(images) {
  const resized = await Promise.all(
    images.map(img => sharp(img).resize(PANEL_W, PANEL_H).toBuffer())
  );

  return sharp({
    create: {
      width: PANEL_W * 2,
      height: PANEL_H * 2,
      channels: 4,
      background: { r: 11, g: 11, b: 11 }
    }
  })
  .composite([
    { input: resized[0], left: 0, top: 0 },
    { input: resized[1], left: PANEL_W, top: 0 },
    { input: resized[2], left: 0, top: PANEL_H },
    { input: resized[3], left: PANEL_W, top: PANEL_H },
  ])
  .jpeg({ quality: 95 })
  .toBuffer();
}

// ============================================================
// 🕷️ SPIDEY (ACTIVE FOUNDATION)
// ============================================================

function spidey(symbol) {
  return {
    bias: 'Neutral',
    structure: 'Range',
    key: 'TBD'
  };
}

// ============================================================
// 🌍 COREY (MACRO PLACEHOLDER)
// ============================================================

function corey(symbol) {
  return { macro: 'Pending' };
}

// ============================================================
// 👑 JANE OUTPUT
// ============================================================

function jane(sp, co) {
  return `
🕷️ SPIDEY → ${sp.bias} | ${sp.structure}
🌍 COREY → ${co.macro}
`;
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const text = msg.content.trim();
  if (!text.startsWith('!')) return;

  const raw = text.replace('!','').toUpperCase();
  const mode = raw.endsWith('H') ? 'H' : 'L';
  const symbol = raw.replace(/[HL]/,'');

  const tfs = DEFAULT_TIMEFRAMES[mode];

  await msg.reply(`⏳ ${symbol} loading...`);

  try {
    await initSession();

    const panels = [];
    for (let tf of tfs) {
      panels.push(await renderPanel(symbol, tf));
    }

    const grid = await buildGrid(panels);

    const sp = spidey(symbol);
    const co = corey(symbol);
    const output = jane(sp, co);

    await msg.channel.send({
      content: `📊 ${symbol}\n${output}`,
      files: [new AttachmentBuilder(grid, { name: `${symbol}.jpg` })]
    });

  } catch (err) {
    console.error(err);
    await msg.reply('❌ Failed');
  }
});

// ============================================================
// START
// ============================================================

client.login(TOKEN);
