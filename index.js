// ============================================================
// ATLAS FX DISCORD BOT
// Pipeline: SOURCE -> FRAME -> RENDER -> FILE -> POST
// ============================================================

process.on('unhandledRejection', (reason) => { console.error('[UNHANDLED REJECTION]', reason); });
process.on('uncaughtException',  (err)    => { console.error('[UNCAUGHT EXCEPTION]', err); });

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');

// ============================================================
// CONFIG
// ============================================================
const DISCORD_BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN;
const ENABLE_4K_SCREENSHOTS = process.env.ENABLE_4K_SCREENSHOTS === 'true';
const EXPORT_DIR            = process.env.EXPORT_DIR || path.join(__dirname, 'exports');
const TV_LAYOUT_ID          = 'GmNAOGhI';
const DISCORD_MAX_BYTES     = 7.5 * 1024 * 1024;
const RENDER_RETRIES        = 2;

if (!DISCORD_BOT_TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN environment variable.');
  process.exit(1);
}

console.log(ENABLE_4K_SCREENSHOTS
  ? '[MODE] 4K Playwright pipeline active.'
  : '[MODE] Standard URL link mode. Set ENABLE_4K_SCREENSHOTS=true to enable 4K.'
);

// ============================================================
// WEBHOOKS
// ============================================================
const SHARED_MACROS_WEBHOOK = 'https://discordapp.com/api/webhooks/1484946852976656516/3Hkehm9GXGm-5sFBHxY_MUrM1PEY1ducOUvWLe4biFW1ka5DHDS23_sH0fglKugWIYCI';

const USER_WEBHOOKS = {
  '690861328507731978':  'https://discordapp.com/api/webhooks/1433501396967358666/hCQBGuiNfF4MWcPGXNtHeh-4kRdYmd0W---Wgt2WOHQWi3xF8fGAVhMqgG4Xo_ff8_sb',
  '763467091171999814':  'https://discordapp.com/api/webhooks/1432643749913296978/hHJRqb_29miv8Q_gcOtdcJzmod3xe7MG4nGhS_iQA94PAba5wKu-B7IaqMICvDqOcrkF',
  '1431173502161129555': 'https://discordapp.com/api/webhooks/1432644152176414811/O3bJqheCn1gW90KA1Jw6FOj8pVwaT0dQueXWvQUhTqcf4cF_HRYJIi5xnIh3XlYUHHiG',
  '1244449071977074798': 'https://discordapp.com/api/webhooks/1483859652662792284/FtxO7zexD_bIaRj2A5j8Ud4IiFB3wopBlIF9GuupPRQp5sFEk6oH8lqsYMBvLlqvrlwt',
};

// Premium users -- add Discord user IDs to enable 4K
const PREMIUM_USERS = new Set([
  '690861328507731978',
]);

// ============================================================
// STAGE 1: SOURCE -- Symbol routing
// ============================================================
const FOREX       = new Set(['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','NZDUSD','USDCHF','XAUUSD','XAGUSD']);
const INDICES     = new Set(['SPX','NDX','DJI','DAX','NAS100','US30','UK100','GER40']);
const COMMODITIES = new Set(['CL','BRENT','UKOIL','NATGAS','NG']);

function getTVSymbol(symbol) {
  if (FOREX.has(symbol))       return 'FX:' + symbol;
  if (INDICES.has(symbol))     return 'INDEX:' + symbol;
  if (COMMODITIES.has(symbol)) return 'NYMEX:' + symbol + '1!';
  return 'NASDAQ:' + symbol;
}

const TIMEFRAMES = [
  { key: 'W',  label: 'Weekly', interval: 'W'   },
  { key: 'D',  label: 'Daily',  interval: 'D'   },
  { key: '4H', label: '4H',     interval: '240' },
  { key: '1H', label: '1H',     interval: '60'  },
];

function buildChartUrl(symbol, interval) {
  return 'https://www.tradingview.com/chart/' + TV_LAYOUT_ID + '/?symbol=' + getTVSymbol(symbol) + '&interval=' + interval;
}

// ============================================================
// STAGE 2+3: FRAME + RENDER -- Playwright 4K with retry
// ============================================================
async function renderChart4K(symbol, interval, tfKey) {
  const { chromium } = require('playwright');
  const sharp        = require('sharp');
  const url          = buildChartUrl(symbol, interval);

  for (let attempt = 1; attempt <= RENDER_RETRIES; attempt++) {
    let browser;
    try {
      console.log('[RENDER] ' + symbol + ' ' + tfKey + ' attempt ' + attempt + '/' + RENDER_RETRIES);

      browser = await chromium.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const context = await browser.newContext({
        viewport:          { width: 3840, height: 2160 },
        deviceScaleFactor: 1,
      });

      const page = await context.newPage();

      // STAGE 2: FRAME -- load and wait for full chart paint
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

      // Wait for canvas element
      await page.waitForSelector('canvas', { timeout: 20000 });

      // Additional wait for chart data to fully render
      await page.waitForTimeout(4000);

      // Attempt fullscreen -- fallback silently if unavailable
      try {
        await page.keyboard.press('Shift+F');
        await page.waitForTimeout(1500);
      } catch (fsErr) {
        console.warn('[WARN] Fullscreen trigger failed, continuing without it.');
      }

      // Extra settle time after fullscreen
      await page.waitForTimeout(1000);

      // STAGE 3: RENDER -- native 4K capture
      const rawPng   = await page.screenshot({ type: 'png', fullPage: false });
      const metadata = await sharp(rawPng).metadata();

      // Validate dimensions
      if (metadata.width !== 3840 || metadata.height !== 2160) {
        throw new Error('Dimension mismatch: ' + metadata.width + 'x' + metadata.height + ' (expected 3840x2160)');
      }

      // Optimise -- lossless first
      let optimised = await sharp(rawPng)
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();

      // Fallback compression if over Discord ceiling
      if (optimised.length > DISCORD_MAX_BYTES) {
        console.warn('[WARN] ' + symbol + ' ' + tfKey + ' over ceiling (' + (optimised.length / 1024 / 1024).toFixed(1) + 'MB), applying fallback compression.');
        optimised = await sharp(rawPng)
          .png({ compressionLevel: 9, quality: 85 })
          .toBuffer();
      }

      console.log('[RENDER OK] ' + symbol + ' ' + tfKey + ' -- ' + (optimised.length / 1024 / 1024).toFixed(1) + 'MB -- ' + metadata.width + 'x' + metadata.height);
      return optimised;

    } catch (err) {
      console.error('[RENDER FAIL] ' + symbol + ' ' + tfKey + ' attempt ' + attempt + ': ' + err.message);
      if (attempt === RENDER_RETRIES) throw err;
      await new Promise(function(r) { setTimeout(r, 3000); });
    } finally {
      if (browser) await browser.close();
    }
  }
}

// ============================================================
// STAGE 4: FILE -- Naming + archive
// ============================================================
function buildFilename(symbol, tfKey) {
  var now  = new Date();
  var date = now.toISOString().slice(0, 10);
  return date + '_' + symbol + '_' + tfKey + '_4K.png';
}

function buildArchiveDir(symbol) {
  var now     = new Date();
  var dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  return path.join(EXPORT_DIR, symbol, dateStr);
}

function ensureExportDir(symbol) {
  var dir = buildArchiveDir(symbol);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveToArchive(buffer, symbol, tfKey) {
  try {
    var dir      = ensureExportDir(symbol);
    var filename = buildFilename(symbol, tfKey);
    var filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    console.log('[ARCHIVE] ' + filepath);
    return filepath;
  } catch (err) {
    console.error('[ARCHIVE ERROR] ' + err.message);
    return null;
  }
}

// ============================================================
// STAGE 5: POST -- Discord delivery
// ============================================================

// Standard URL embed (free tier)
async function postChartEmbed(webhookUrl, symbol, username) {
  var links = TIMEFRAMES.map(function(tf) {
    return '[' + tf.label + '](' + buildChartUrl(symbol, tf.interval) + ')';
  }).join(' | ');

  await axios.post(webhookUrl, {
    embeds: [{
      title:       '[CHART] ' + symbol + ' Chart Analysis',
      description: links,
      color:       16711680,
      footer:      { text: 'Requested by ' + username },
    }],
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
}

// 4K image upload (premium tier)
async function post4KChart(webhookUrl, symbol, tfKey, imageBuffer, username) {
  var filename = buildFilename(symbol, tfKey);
  var form     = new FormData();

  form.append('file', imageBuffer, { filename: filename, contentType: 'image/png' });
  form.append('payload_json', JSON.stringify({
    embeds: [{
      title:  '[CHART] ' + symbol + ' -- ' + tfKey + ' (4K)',
      color:  16711680,
      image:  { url: 'attachment://' + filename },
      footer: { text: 'Requested by ' + username + ' - ATLAS FX Premium' },
    }],
  }));

  await axios.post(webhookUrl, form, {
    headers:       form.getHeaders(),
    maxBodyLength: Infinity,
    timeout:       45000,
  });
}

// Post archived 4K files to a webhook (used for share -- avoids re-render)
async function postArchivedCharts(webhookUrl, symbol, username) {
  var dir    = buildArchiveDir(symbol);
  var posted = 0;

  if (!fs.existsSync(dir)) {
    console.warn('[ARCHIVE MISS] Directory not found: ' + dir);
    return false;
  }

  for (var i = 0; i < TIMEFRAMES.length; i++) {
    var tf       = TIMEFRAMES[i];
    var filename = buildFilename(symbol, tf.key);
    var filepath = path.join(dir, filename);

    if (!fs.existsSync(filepath)) {
      console.warn('[ARCHIVE MISS] File not found: ' + filepath);
      continue;
    }

    try {
      var buffer = fs.readFileSync(filepath);
      var form   = new FormData();

      form.append('file', buffer, { filename: filename, contentType: 'image/png' });
      form.append('payload_json', JSON.stringify({
        embeds: [{
          title:  '[CHART] ' + symbol + ' -- ' + tf.key + ' (4K)',
          color:  16711680,
          image:  { url: 'attachment://' + filename },
          footer: { text: 'Shared by ' + username + ' - ATLAS FX Premium' },
        }],
      }));

      await axios.post(webhookUrl, form, {
        headers:       form.getHeaders(),
        maxBodyLength: Infinity,
        timeout:       45000,
      });

      console.log('[ARCHIVE POST OK] ' + symbol + ' ' + tf.key);
      posted++;
    } catch (err) {
      console.error('[ARCHIVE POST FAIL] ' + symbol + ' ' + tf.key + ': ' + err.message);
    }
  }

  return posted > 0;
}

// ============================================================
// BATCH DISPATCHER
// ============================================================
async function dispatchCharts(webhookUrl, symbol, username, userId) {
  var isPremium = ENABLE_4K_SCREENSHOTS && PREMIUM_USERS.has(userId);

  if (!isPremium) {
    await postChartEmbed(webhookUrl, symbol, username);
    return { mode: 'standard', success: TIMEFRAMES.length, failed: 0 };
  }

  var batchStart = new Date().toISOString();
  var results    = { mode: '4K', success: 0, failed: 0, files: [] };

  console.log('[BATCH START] ' + symbol + ' -- ' + batchStart);

  for (var i = 0; i < TIMEFRAMES.length; i++) {
    var tf = TIMEFRAMES[i];
    try {
      var buffer   = await renderChart4K(symbol, tf.interval, tf.key);
      var filepath = saveToArchive(buffer, symbol, tf.key);
      await post4KChart(webhookUrl, symbol, tf.key, buffer, username);
      results.success++;
      if (filepath) results.files.push(filepath);
      console.log('[BATCH] ' + symbol + ' ' + tf.key + ' OK');
    } catch (err) {
      console.error('[BATCH FAIL] ' + symbol + ' ' + tf.key + ': ' + err.message);
      results.failed++;
    }
  }

  console.log('[BATCH DONE] ' + symbol + ' -- ' + results.success + '/' + TIMEFRAMES.length + ' succeeded, ' + results.failed + ' failed.');
  return results;
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

client.once('clientReady', function() {
  console.log('[READY] ATLAS FX Bot online as ' + client.user.tag);
});

// ============================================================
// MESSAGE HANDLER
// ============================================================
client.on('messageCreate', async function(message) {
  if (message.author.bot) return;

  var raw = (message.content || '').trim();
  if (!raw.startsWith('!chart')) return;

  var userId         = message.author.id;
  var privateWebhook = USER_WEBHOOKS[userId];

  if (!privateWebhook) {
    console.warn('[UNKNOWN USER] ' + message.author.username + ' (' + userId + ')');
    return;
  }

  var parts  = raw.split(/\s+/);
  var symbol = (parts[1] || '').toUpperCase();

  if (!symbol) {
    await message.reply('Please provide a symbol. Example: !chart EURUSD');
    return;
  }

  try {
    var results = await dispatchCharts(privateWebhook, symbol, message.author.username, userId);
    var modeTag = results.mode === '4K' ? '[4K] 4K' : '[CHART]';
    console.log('[CHART] ' + message.author.username + ' -> ' + symbol + ' (' + results.mode + ')');

    await message.reply({
      content: modeTag + ' **' + symbol + '** charts sent to your channel! Want to share with the group?',
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('share_' + symbol + '_' + userId)
            .setLabel('Share in #shared-macros')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('no_share')
            .setLabel('No thanks')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });

  } catch (err) {
    console.error('[CHART ERROR] ' + err.message);
    await message.reply('Failed to generate charts. Try again.');
  }
});

// ============================================================
// BUTTON HANDLER
// ============================================================
client.on('interactionCreate', async function(interaction) {
  if (!interaction.isButton()) return;

  // ── Share button ──────────────────────────────────────────
  if (interaction.customId.startsWith('share_')) {

    // CRITICAL: Defer immediately -- Discord requires a response within 3 seconds.
    // deferUpdate() acknowledges the interaction and removes the timeout.
    // All async work (archive reads / re-renders) happens after this.
    try {
      await interaction.deferUpdate();
    } catch (deferErr) {
      console.error('[DEFER FAIL] Interaction already expired: ' + deferErr.message);
      return;
    }

    var parts  = interaction.customId.split('_');
    var symbol = parts[1];
    var userId = parts[2];

    try {
      // Serve from today's archive first -- fast, no Playwright required.
      // Falls back to full re-render if archive files are missing (e.g. date rollover).
      var served = await postArchivedCharts(
        SHARED_MACROS_WEBHOOK,
        symbol,
        interaction.user.username
      );

      if (!served) {
        console.warn('[SHARE] Archive miss for ' + symbol + ', falling back to re-render...');
        await dispatchCharts(SHARED_MACROS_WEBHOOK, symbol, interaction.user.username, userId);
      }

      // editReply() is required after deferUpdate() -- update() will throw
      await interaction.editReply({
        content:    '[OK] **' + symbol + '** charts shared in #shared-macros!',
        components: [],
      });

      console.log('[SHARED] ' + symbol + ' by ' + interaction.user.username
        + (served ? ' (from archive)' : ' (re-rendered)'));

    } catch (err) {
      console.error('[SHARE ERROR] ' + err.message);
      try {
        await interaction.editReply({
          content:    'Failed to share charts. Try again.',
          components: [],
        });
      } catch (replyErr) {
        console.error('[EDIT REPLY FAIL] ' + replyErr.message);
      }
    }

    return;
  }

  // ── No thanks button ──────────────────────────────────────
  if (interaction.customId === 'no_share') {
    try {
      await interaction.update({ content: 'Charts kept private.', components: [] });
    } catch (err) {
      console.error('[NO_SHARE ERROR] ' + err.message);
    }
  }
});

// ============================================================
// SHARD EVENTS
// ============================================================
client.on('shardDisconnect',   function(event, id) { console.warn('[SHARD] ' + id + ' disconnected. Code: ' + event.code); });
client.on('shardReconnecting', function(id)        { console.log('[SHARD] ' + id + ' reconnecting...'); });
client.on('shardResume',       function(id, n)     { console.log('[SHARD] ' + id + ' resumed. Replayed ' + n + ' events.'); });

// ============================================================
// KEEP ALIVE
// ============================================================
setInterval(function() { console.log('[KEEP-ALIVE] ' + new Date().toISOString()); }, 5 * 60 * 1000);

// ============================================================
// START
// ============================================================
client.login(DISCORD_BOT_TOKEN);
