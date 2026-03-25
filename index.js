// ============================================================
// ATLAS FX DISCORD BOT — UNIFIED FINAL BUILD
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
// Rendering: 2560x1440 CMC-style, light theme, no volume bars
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

const TOKEN      = process.env.DISCORD_BOT_TOKEN;
const EXPORT_DIR = process.env.EXPORT_DIR || path.join(__dirname, 'exports');
const MAX_RETRIES = Number(process.env.MAX_RENDER_RETRIES || 2);
const STATE_TTL   = 1000 * 60 * 60 * 2; // 2 hours

if (!TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

console.log('[BOOT] ATLAS FX Bot starting...');

// ============================================================
// GROUP + CHANNEL CONFIG
// ============================================================

const CHANNEL_GROUP_MAP = {
  // Roadmap macro request channels (primary command channels)
  '1432642672287547453': 'AT',
  '1432643496375881748': 'SK',
  '1432644116868501595': 'NM',
  '1482450651765149816': 'BR',
  // Combined channels (also accept commands)
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

const TF_INTERVAL_MAP = {
  '1W':  '1 week',
  '1D':  '1 day',
  '240': '4 hours',
  '60':  '1 hour',
  '15':  '15 minutes',
  '1':   '1 minute',
};

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
// STATE MACHINE
// ============================================================

const STATE = {};

function ensureState(group, symbol) {
  if (!STATE[group])         STATE[group] = {};
  if (!STATE[group][symbol]) {
    STATE[group][symbol] = { ltf: null, htf: null, macro: null, roadmap: null, ts: null };
  }
  return STATE[group][symbol];
}

function touch(s) { s.ts = Date.now(); }

function isFresh(s) { return s.ts && (Date.now() - s.ts < STATE_TTL); }

function isReadyToCombine(s) { return s.ltf && s.macro && isFresh(s); }

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
  processQueue();
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
// RENDER — CMC STYLE
// Resolution: 2560x1440 | Light theme | No volume | Clean UI
// ============================================================

async function renderChart(symbol, interval, tfKey) {
  const url = buildChartUrl(symbol, interval);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let context;
    try {
      console.log(`[RENDER] ${symbol} ${tfKey} attempt ${attempt}/${MAX_RETRIES}`);

      const b = await getBrowser();

      context = await b.newContext({
        viewport:          { width: 2560, height: 1440 },
        deviceScaleFactor: 2, // Retina-style sharpness
      });

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(45000);
      page.setDefaultTimeout(25000);

      // Force light theme via localStorage BEFORE page loads
      await page.addInitScript(() => {
        localStorage.setItem('theme', 'light');
        localStorage.setItem('tv_user_pro_plan', 'pro');
      });

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);

      // Dismiss popups / cookie banners
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
      try { await page.waitForSelector('canvas', { timeout: 15000 }); } catch (_) {}

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
        console.warn(`[TF CLICK FAIL] ${symbol} ${tfKey} — using URL interval`);
      }

      // Reset zoom (Ctrl+0) + fit chart (Alt+R)
      try {
        await page.keyboard.down('Control');
        await page.keyboard.press('0');
        await page.keyboard.up('Control');
        await page.waitForTimeout(400);
        await page.keyboard.press('Alt+R');
        await page.waitForTimeout(400);
      } catch (_) {}

      // ESC to restore any hidden panels
      try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } catch (_) {}

      // Remove UI chrome + volume bars via DOM injection
      await page.evaluate(() => {
        // Hide standard UI elements
        [
          '.chart-controls-bar',
          '.layout__area--left',
          '.layout__area--right',
          '.header-chart-panel',
          '[data-name="legend"]',
          '.tv-floating-toolbar',
        ].forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            el.style.display = 'none';
          });
        });

        // Remove volume pane — find panes containing "Vol" text
        const hideVolume = () => {
          document.querySelectorAll('[class*="pane"]').forEach((p) => {
            if (p.innerText && p.innerText.includes('Vol')) {
              p.style.display = 'none';
            }
          });
        };
        hideVolume();
        setTimeout(hideVolume, 1500);
      });

      // Wait for clean render
      await page.waitForTimeout(3000);

      // Fullscreen hotkey
      try {
        await page.keyboard.press('Shift+F');
        await page.waitForTimeout(1000);
      } catch (_) {}

      // Capture at full 2560x1440
      const raw = await page.screenshot({ type: 'png', fullPage: false });
      await context.close();

      // Compress to high-quality JPEG — retain sharpness
      const optimised = await sharp(raw)
        .resize(2560, 1440, { fit: 'cover' })
        .jpeg({ quality: 90, mozjpeg: true })
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
// RENDER BATCH (parallel)
// ============================================================

async function renderBatch(symbol, tfs) {
  const buffers = await Promise.all(
    tfs.map((tf) => renderChart(symbol, tf.interval, tf.key))
  );

  return buffers.map((buf, i) => {
    saveToArchive(buf, symbol, tfs[i].key);
    return { buf, name: buildFilename(symbol, tfs[i].key), label: tfs[i].label };
  });
}

// ============================================================
// MACRO + ROADMAP (placeholders — replace with live source)
// ============================================================

function generateMacro(symbol) {
  return `**${symbol} Macro**

Bias: Bearish
Draw: 1.1550 liquidity
State: Post-sweep → pullback

Levels: 1.1625 / 1.1580 / 1.1550`;
}

function generateRoadmap(symbol) {
  return `**${symbol} Weekly Roadmap**

Range: 1.1700 – 1.1450
Primary Draw: Downside liquidity
HTF Supply: Holding`;
}

// ============================================================
// COMBINE + SEND TO GROUP WEBHOOK
// ============================================================

function buildCombinedText(symbol, s) {
  let out = `📊 **${symbol} — ATLAS VIEW**\n\n`;
  out += `__Macro__\n${s.macro}\n\n`;
  if (s.roadmap) out += `__Weekly Context__\n${s.roadmap}\n\n`;
  out += `_Updated: ${new Date(s.ts).toUTCString()}_`;
  return out;
}

async function sendToWebhook(webhookUrl, content, files) {
  if (!webhookUrl) return;

  const FormData = require('form-data');
  const axios    = require('axios');

  if (files && files.length > 0) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content }));
    files.forEach((f, i) => {
      form.append(`files[${i}]`, f.buf, { filename: f.name, contentType: 'image/jpeg' });
    });
    await axios.post(webhookUrl, form, {
      headers:       form.getHeaders(),
      maxBodyLength: Infinity,
      timeout:       60000,
    });
  } else {
    const axios = require('axios');
    await axios.post(webhookUrl, { content }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
  }
}

async function tryCombine(group, symbol, s) {
  if (!isReadyToCombine(s)) return;

  const webhook = COMBINED_WEBHOOKS[group];
  if (!webhook) {
    console.warn(`[COMBINE] No webhook for group ${group}`);
    return;
  }

  await sendToWebhook(webhook, buildCombinedText(symbol, s), null);
  if (s.ltf  && s.ltf.length  > 0) await sendToWebhook(webhook, `📉 **${symbol}** LTF Charts`, s.ltf);
  if (s.htf  && s.htf.length  > 0) await sendToWebhook(webhook, `📈 **${symbol}** HTF Charts`, s.htf);

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

  const raw = (msg.content || '').trim();
  if (!raw) return;

  if (raw === '!ping') {
    await msg.reply('pong');
    return;
  }

  const group = CHANNEL_GROUP_MAP[msg.channel.id];
  if (!group) return;

  const parsed = parseCommand(raw);
  if (!parsed) return;

  const { action, symbol, mode } = parsed;

  if (action !== 'ping' && !VALID_SYMBOLS.has(symbol)) {
    await msg.reply(`Invalid symbol: **${symbol}**`);
    return;
  }

  const tfs      = mode === 'L' ? TF_LOW : TF_HIGH;
  const setLabel = mode === 'L' ? 'LTF' : 'HTF';

  // ── CHART ──────────────────────────────────────────────────
  if (action === 'chart') {
    enqueue(async () => {
      console.log(`[CHART] ${msg.author.username} ${group} -> ${symbol} ${setLabel}`);
      const progress = await msg.reply(`⏳ Generating **${symbol}** ${setLabel} charts...`);

      try {
        const files = await renderBatch(symbol, tfs);

        // Send each chart as a separate attachment for full Discord expand
        for (const f of files) {
          await msg.channel.send({
            content: `📊 **${symbol}** · ${f.label}`,
            files:   [new AttachmentBuilder(f.buf, { name: f.name })],
          });
        }

        await progress.edit(`✅ **${symbol}** ${setLabel} charts delivered`);

        const s = ensureState(group, symbol);
        if (mode === 'L') s.ltf = files;
        if (mode === 'H') s.htf = files;
        touch(s);

        await tryCombine(group, symbol, s);

      } catch (err) {
        console.error('[CHART ERROR]', err.message);
        await progress.edit(`❌ Failed: ${err.message}`);
      }
    });
    return;
  }

  // ── MACRO ──────────────────────────────────────────────────
  if (action === 'macro') {
    enqueue(async () => {
      console.log(`[MACRO] ${msg.author.username} ${group} -> ${symbol}`);
      const s = ensureState(group, symbol);

      if (!s.htf) {
        await msg.reply(`**${symbol}** — HTF charts missing. Run \`!${symbol}H\` first.`);
        return;
      }

      const macro = generateMacro(symbol);
      s.macro = macro;
      touch(s);

      await msg.reply(macro);
      await tryCombine(group, symbol, s);
    });
    return;
  }

  // ── ROADMAP ────────────────────────────────────────────────
  if (action === 'roadmap') {
    enqueue(async () => {
      console.log(`[ROADMAP] ${msg.author.username} ${group} -> ${symbol}`);
      const roadmap = generateRoadmap(symbol);

      const s = ensureState(group, symbol);
      s.roadmap = roadmap;
      touch(s);

      await msg.reply(roadmap);
      await tryCombine(group, symbol, s);
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
// KEEP ALIVE
// ============================================================

setInterval(() => {
  console.log('[KEEP-ALIVE]', new Date().toISOString());
}, 5 * 60 * 1000);

// ============================================================
// START
// ============================================================

client.login(TOKEN);
