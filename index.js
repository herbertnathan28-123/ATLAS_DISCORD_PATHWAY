// ============================================================
// ATLAS FX DISCORD BOT — STABLE BUILD
// ============================================================

process.on('unhandledRejection', (r) => console.error('[UNHANDLED]', r));
process.on('uncaughtException',  (e) => console.error('[EXCEPTION]', e));

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ============================================================
// CONFIG
// ============================================================

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('[FATAL] Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ============================================================
// READY
// ============================================================

client.once('clientReady', () => {
  console.log('[READY] ATLAS FX LIVE as ' + client.user.tag);
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const raw = message.content.trim();

  console.log('[MESSAGE]', message.author.username, raw);

  // ============================
  // BASIC TEST
  // ============================
  if (raw === '!ping') {
    return message.reply('pong');
  }

  // ============================
  // CHART COMMAND
  // ============================
  if (raw.startsWith('!chart')) {

    const parts = raw.split(' ');
    const symbol = (parts[1] || '').toUpperCase();

    if (!symbol) {
      return message.reply('Provide symbol → Example: `!chart EURUSD`');
    }

    console.log('[CHART]', message.author.username, '->', symbol);

    return message.reply({
      content: `📊 **${symbol}** chart request received`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('share_' + symbol)
            .setLabel('Share')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('no_share')
            .setLabel('No thanks')
            .setStyle(ButtonStyle.Secondary),
        )
      ]
    });
  }
});

// ============================================================
// BUTTON HANDLER
// ============================================================

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith('share_')) {
    const symbol = interaction.customId.split('_')[1];

    await interaction.update({
      content: `✅ ${symbol} shared`,
      components: []
    });

    console.log('[SHARED]', symbol);
  }

  if (interaction.customId === 'no_share') {
    await interaction.update({
      content: 'Charts kept private.',
      components: []
    });
  }
});

// ============================================================
// START
// ============================================================

client.login(DISCORD_BOT_TOKEN);
