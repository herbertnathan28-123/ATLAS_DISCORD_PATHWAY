// ============================================================
// ATLAS FX DISCORD BOT — CLEAN VERSION
// ============================================================

process.on('unhandledRejection', (reason) => console.error('[UNHANDLED REJECTION]', reason));
process.on('uncaughtException',  (err)    => console.error('[UNCAUGHT EXCEPTION]', err));

const { Client, GatewayIntentBits } = require('discord.js');

// ============================================================
// CONFIG
// ============================================================

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// ============================================================
// CLIENT SETUP
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ============================================================
// READY EVENT
// ============================================================

client.once('clientReady', () => {
  console.log('[READY] Bot connected as ' + client.user.tag);
});

// ============================================================
// MESSAGE HANDLER (TEST VERSION)
// ============================================================

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  console.log('[MESSAGE]', message.author.username, message.content);

  if (message.content === '!ping') {
    await message.reply('pong');
  }

  if (message.content.startsWith('!chart')) {
    await message.reply('Chart command received ✅');
  }
});

// ============================================================
// START
// ============================================================

client.login(DISCORD_BOT_TOKEN);
