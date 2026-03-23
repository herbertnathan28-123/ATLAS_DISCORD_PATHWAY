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

// ===== HARD-CODED (WORKING) =====
const DISCORD_BOT_TOKEN = "PASTE_YOUR_NEW_BOT_TOKEN_HERE";

const SHARED_MACROS_WEBHOOK = "https://discordapp.com/api/webhooks/1484946852976656516/3Hkehm9GXGm-5sFBHxY_MUrM1PEY1ducOUvWLe4biFW1ka5DHDS23_sH0fglKugWIYCI";

const USER_WEBHOOKS = {
  '690861328507731978': "https://discordapp.com/api/webhooks/1433501396967358666/hCQBGuiNfF4MWcPGXNtHeh-4kRdYmd0W---Wgt2WOHQWi3xF8fGAVhMqgG4Xo_ff8_sb",
  '763467091171999814': "https://discordapp.com/api/webhooks/1432643749913296978/hHJRqb_29miv8Q_gcOtdcJzmod3xe7MG4nGhS_iQA94PAba5wKu-B7IaqMICvDqOcrkF",
  '1431173502161129555': "https://discordapp.com/api/webhooks/1432644152176414811/O3bJqheCn1gW90KA1Jw6FOj8pVwaT0dQueXWvQUhTqcf4cF_HRYJIi5xnIh3XlYUHHiG",
  '1244449071977074798': "https://discordapp.com/api/webhooks/1483859652662792284/FtxO7zexD_bIaRj2A5j8Ud4IiFB3wopBlIF9GuupPRQp5sFEk6oH8lqsYMBvLlqvrlwt",
};

// ===== COMMANDS =====
const supportedCommands = new Set(['!chart']);

// ===== CHART GENERATOR =====
function generateCharts(symbol) {
  const forexPairs = new Set([
    'EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','NZDUSD','USDCHF'
  ]);

  let tvSymbol = `NASDAQ:${symbol}`;
  if (forexPairs.has(symbol)) tvSymbol = `FX:${symbol}`;

  const base = 'https://www.tradingview.com/chart/GmNAOGhI/?symbol=';

  return {
    weekly: `${base}${tvSymbol}&interval=W`,
    daily: `${base}${tvSymbol}&interval=D`,
    h4: `${base}${tvSymbol}&interval=240`,
    h1: `${base}${tvSymbol}&interval=60`,
  };
}

// ===== SEND EMBED =====
async function postChartEmbed(webhookUrl, symbol, charts, username) {
  await axios.post(webhookUrl, {
    embeds: [{
      title: `📊 ${symbol} Chart`,
      description:
        `[W](${charts.weekly}) | [D](${charts.daily}) | [4H](${charts.h4}) | [1H](${charts.h1})`,
      color: 0xff0000,
      footer: { text: `By ${username}` }
    }]
  });
}

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('clientReady', () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// ===== MESSAGE =====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const raw = message.content.trim();
  if (!raw.startsWith('!')) return;

  const userId = message.author.id;
  const webhook = USER_WEBHOOKS[userId];

  if (!webhook) {
    message.reply('No webhook set.');
    return;
  }

  if (raw.startsWith('!chart')) {
    const symbol = raw.split(' ')[1]?.toUpperCase();

    if (!symbol) {
      message.reply('Use: !chart EURUSD');
      return;
    }

    const charts = generateCharts(symbol);

    await postChartEmbed(webhook, symbol, charts, message.author.username);

    await message.reply({
      content: `Sent ${symbol}. Share?`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`share_${symbol}_${userId}`)
            .setLabel('Share')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`no_${symbol}_${userId}`)
            .setLabel('No')
            .setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }
});

// ===== BUTTONS =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, symbol, userId] = interaction.customId.split('_');

  if (interaction.user.id !== userId) {
    interaction.reply({ content: 'Not yours', ephemeral: true });
    return;
  }

  if (action === 'share') {
    const charts = generateCharts(symbol);

    await postChartEmbed(
      SHARED_MACROS_WEBHOOK,
      symbol,
      charts,
      interaction.user.username
    );

    await interaction.update({
      content: `${symbol} shared`,
      components: []
    });
  }

  if (action === 'no') {
    await interaction.update({
      content: 'Kept private',
      components: []
    });
  }
});

// ===== START =====
client.login(DISCORD_BOT_TOKEN);
