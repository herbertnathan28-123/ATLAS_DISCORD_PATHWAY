process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const axios = require('axios');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN environment variable.');
  process.exit(1);
}

// Put these in Render environment variables.
// Example variable names:
// USER_WEBHOOK_690861328507731978
// USER_WEBHOOK_763467091171999814
// USER_WEBHOOK_1431173502161129555
// USER_WEBHOOK_1244449071977074798
const USER_WEBHOOKS = {
  '690861328507731978': process.env.USER_WEBHOOK_690861328507731978,
  '763467091171999814': process.env.USER_WEBHOOK_763467091171999814,
  '1431173502161129555': process.env.USER_WEBHOOK_1431173502161129555,
  '1244449071977074798': process.env.USER_WEBHOOK_1244449071977074798,
};

const SHARED_MACROS_WEBHOOK = process.env.SHARED_MACROS_WEBHOOK;

if (!SHARED_MACROS_WEBHOOK) {
  console.error('Missing SHARED_MACROS_WEBHOOK environment variable.');
  process.exit(1);
}

const supportedCommands = new Set(['!chart', '!macro', '!roadmap', '!darkhorse']);

function generateCharts(symbol) {
  const forexPairs = new Set([
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF',
    'EURJPY', 'GBPJPY', 'AUDJPY', 'EURGBP', 'EURAUD', 'GBPAUD',
  ]);

  const metals = new Set(['XAUUSD', 'XAGUSD']);
  const indices = new Set(['SPX', 'NDX', 'DJI', 'DAX', 'NAS100', 'US30', 'UK100', 'GER40']);
  const commodities = new Set(['CL', 'BRENT', 'UKOIL', 'NATGAS', 'NG']);

  let tvSymbol = `NASDAQ:${symbol}`;

  if (forexPairs.has(symbol)) {
    tvSymbol = `FX:${symbol}`;
  } else if (metals.has(symbol)) {
    tvSymbol = `OANDA:${symbol}`;
  } else if (indices.has(symbol)) {
    tvSymbol = `INDEX:${symbol}`;
  } else if (commodities.has(symbol)) {
    tvSymbol = `NYMEX:${symbol}1!`;
  }

  const layoutBase = 'https://www.tradingview.com/chart/GmNAOGhI/?symbol=';

  return {
    weekly: `${layoutBase}${encodeURIComponent(tvSymbol)}&interval=W`,
    daily: `${layoutBase}${encodeURIComponent(tvSymbol)}&interval=D`,
    h4: `${layoutBase}${encodeURIComponent(tvSymbol)}&interval=240`,
    h1: `${layoutBase}${encodeURIComponent(tvSymbol)}&interval=60`,
  };
}

async function postChartEmbed(webhookUrl, symbol, charts, username, targetLabel) {
  if (!webhookUrl) {
    throw new Error(`Missing webhook URL for target: ${targetLabel}`);
  }

  await axios.post(
    webhookUrl,
    {
      embeds: [
        {
          title: `📊 ${symbol} Chart Analysis`,
          description:
            `[Weekly](${charts.weekly}) | [Daily](${charts.daily}) | [4H](${charts.h4}) | [1H](${charts.h1})`,
          color: 0xff0000,
          footer: {
            text: `Requested by ${username}`,
          },
          timestamp: new Date().toISOString(),
        },
      ],
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    }
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('clientReady', () => {
  console.log(`ATLAS FX bot online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  try {
    if (!message || !message.author) return;
    if (message.author.bot) return;

    const raw = (message.content || '').trim();
    if (!raw.startsWith('!')) return;

    console.log(`[MSG] ${message.author.username}: ${raw}`);

    const commandWord = raw.split(/\s+/)[0].toLowerCase();
    if (!supportedCommands.has(commandWord)) return;

    const userId = message.author.id;
    const privateWebhook = USER_WEBHOOKS[userId];

    if (!privateWebhook) {
      console.warn(`[UNKNOWN USER] ${message.author.username} (${userId})`);
      await message.reply('You do not have a private webhook assigned yet.');
      return;
    }

    if (commandWord === '!chart') {
      const parts = raw.split(/\s+/);
      const symbol = (parts[1] || '').toUpperCase();

      if (!symbol) {
        await message.reply('Please provide a symbol. Example: `!chart EURUSD`');
        return;
      }

      const charts = generateCharts(symbol);

      try {
        await postChartEmbed(privateWebhook, symbol, charts, message.author.username, `private:${userId}`);

        console.log(`[OK] chart sent to private channel for ${message.author.username} - ${symbol}`);

        await message.reply({
          content: `📊 **${symbol}** charts sent to your channel. Share to #shared-macros?`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`share_${symbol}_${userId}`)
                .setLabel('📢 Share in #shared-macros')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`no_share_${symbol}_${userId}`)
                .setLabel('No thanks')
                .setStyle(ButtonStyle.Secondary)
            ),
          ],
        });
      } catch (err) {
        console.error('[CHART ERROR]', err?.response?.data || err.message || err);
        await message.reply('Chart delivery failed. Check webhook and logs.');
      }

      return;
    }

    await message.reply('Command recognised, but only `!chart` is active in this build.');
  } catch (err) {
    console.error('[MESSAGE HANDLER ERROR]', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('share_')) {
      const parts = interaction.customId.split('_');
      const symbol = parts[1];
      const originalUserId = parts[2];

      if (interaction.user.id !== originalUserId) {
        await interaction.reply({
          content: 'Only the original requester can use this button.',
          ephemeral: true,
        });
        return;
      }

      const charts = generateCharts(symbol);

      try {
        await postChartEmbed(
          SHARED_MACROS_WEBHOOK,
          symbol,
          charts,
          interaction.user.username,
          'shared-macros'
        );

        await interaction.update({
          content: `📢 **${symbol}** shared to #shared-macros.`,
          components: [],
        });

        console.log(`[OK] ${interaction.user.username} shared ${symbol} to #shared-macros`);
      } catch (err) {
        console.error('[SHARE ERROR]', err?.response?.data || err.message || err);

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: 'Failed to share chart to #shared-macros.',
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: 'Failed to share chart to #shared-macros.',
            ephemeral: true,
          });
        }
      }

      return;
    }

    if (interaction.customId.startsWith('no_share_')) {
      const parts = interaction.customId.split('_');
      const symbol = parts[2];
      const originalUserId = parts[3];

      if (interaction.user.id !== originalUserId) {
        await interaction.reply({
          content: 'Only the original requester can use this button.',
          ephemeral: true,
        });
        return;
      }

      await interaction.update({
        content: `✅ **${symbol}** kept private.`,
        components: [],
      });

      return;
    }
  } catch (err) {
    console.error('[INTERACTION HANDLER ERROR]', err);

    if (interaction && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: 'An unexpected error occurred.',
          ephemeral: true,
        });
      } catch (replyErr) {
        console.error('[INTERACTION REPLY ERROR]', replyErr);
      }
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
