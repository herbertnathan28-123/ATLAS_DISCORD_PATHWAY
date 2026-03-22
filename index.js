process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN environment variable.');
  process.exit(1);
}

const USER_WEBHOOKS = {
  '690861328507731978': 'https://discordapp.com/api/webhooks/1433501396967358666/hCQBGuiNfF4MWcPGXNtHeh-4kRdYmd0W---Wgt2WOHQWi3xF8fGAVhMqgG4Xo_ff8_sb',
  '763467091171999814': 'https://discordapp.com/api/webhooks/1432643749913296978/hHJRqb_29miv8Q_gcOtdcJzmod3xe7MG4nGhS_iQA94PAba5wKu-B7IaqMICvDqOcrkF',
  '1431173502161129555': 'https://discordapp.com/api/webhooks/1432644152176414811/O3bJqheCn1gW90KA1Jw6FOj8pVwaT0dQueXWvQUhTqcf4cF_HRYJIi5xnIh3XlYUHHiG',
  '1244449071977074798': 'https://discordapp.com/api/webhooks/1483859652662792284/FtxO7zexD_bIaRj2A5j8Ud4IiFB3wopBlIF9GuupPRQp5sFEk6oH8lqsYMBvLlqvrlwt',
};

const SHARED_MACROS_WEBHOOK = 'https://discordapp.com/api/webhooks/1484946852976656516/3Hkehm9GXGm-5sFBHxY_MUrM1PEY1ducOUvWLe4biFW1ka5DHDS23_sH0fglKugWIYCI';

const supportedCommands = new Set(['!chart', '!macro', '!roadmap', '!darkhorse']);

function generateCharts(symbol) {
  const forexPairs = ['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','NZDUSD','USDCHF','XAUUSD','XAGUSD'];
  const indices = ['SPX','NDX','DJI','DAX','NAS100','US30','UK100','GER40'];
  const commodities = ['CL','BRENT','UKOIL','NATGAS','NG'];

  let tv = `NASDAQ:${symbol}`;
  if (forexPairs.includes(symbol)) tv = `FX:${symbol}`;
  else if (indices.includes(symbol)) tv = `INDEX:${symbol}`;
  else if (commodities.includes(symbol)) tv = `NYMEX:${symbol}1!`;

  const layout = 'https://www.tradingview.com/chart/GmNAOGhI/?symbol=';
  return {
    weekly: `${layout}${tv}&interval=W`,
    daily: `${layout}${tv}&interval=D`,
    h4: `${layout}${tv}&interval=240`,
    h1: `${layout}${tv}&interval=60`,
  };
}

async function postChartEmbed(webhookUrl, symbol, charts, username) {
  await axios.post(webhookUrl, {
    embeds: [{
      title: `📊 ${symbol} Chart Analysis`,
      description: `[Weekly](${charts.weekly}) | [Daily](${charts.daily}) | [4H](${charts.h4}) | [1H](${charts.h1})`,
      color: 16711680,
      footer: { text: `Requested by ${username}` }
    }]
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
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
  console.log(`[MSG] ${message.author.username}: ${message.content}`);
  if (message.author.bot) return;
  const raw = (message.content || '').trim();
  if (!raw.startsWith('!')) return;
  const commandWord = raw.split(/\s+/)[0].toLowerCase();
  if (!supportedCommands.has(commandWord)) return;

  const userId = message.author.id;
  const privateWebhook = USER_WEBHOOKS[userId];

  if (!privateWebhook) {
    console.warn(`[UNKNOWN USER] ${message.author.username} (${userId})`);
    return;
  }

  if (commandWord === '!chart') {
    const parts = raw.trim().split(/\s+/);
    const symbol = (parts[1] || '').toUpperCase();

    if (!symbol) {
      await message.reply('Please provide a symbol. Example: `!chart EURUSD`');
      return;
    }

    try {
      const charts = generateCharts(symbol);
      await postChartEmbed(privateWebhook, symbol, charts, message.author.username);
      console.log(`[OK] chart sent to private channel for ${message.author.username} - ${symbol}`);

      await message.reply({
        content: `📊 **${symbol}** charts sent to your channel! Want to share with everyone?`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`share_${symbol}_${userId}`)
              .setLabel('📢 Share in #shared-macros')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('no_share')
              .setLabel('No thanks')
              .setStyle(ButtonStyle.Secondary)
          )
        ]
      });
    } catch (err) {
      console.error('[CHART ERROR]', err.message);
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith('share_')) {
    const parts = interaction.customId.split('_');
    const symbol = parts[1];
    const userId = parts[2];

    try {
      const charts = generateCharts(symbol);
      await postChartEmbed(SHARED_MACROS_WEBHOOK, symbol, charts, interaction.user.username);
      await interaction.update({
        content: `
