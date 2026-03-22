const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_EXECUTE_URL = 'https://atlas-nathan28.app.n8n.cloud/api/v1/workflows/fQIE0VRzm2cRs0cO/execute';

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN environment variable.');
  process.exit(1);
}

if (!N8N_API_KEY) {
  console.error('Missing N8N_API_KEY environment variable.');
  process.exit(1);
}

const supportedCommands = new Set(['!chart', '!macro', '!roadmap', '!darkhorse']);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`ATLAS FX bot online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const raw = (message.content || '').trim();
  if (!raw.startsWith('!')) return;

  const commandWord = raw.split(/\s+/)[0].toLowerCase();
  if (!supportedCommands.has(commandWord)) return;

  try {
    await axios.post(
      N8N_EXECUTE_URL,
      {
        command: raw,
        user: message.author.username,
        channel: message.channel.id,
      },
      {
        headers: {
          'X-N8N-API-KEY': N8N_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    console.log(`[OK] user=${message.author.username} command="${raw}"`);
  } catch (error) {
    console.error('[N8N ERROR]', error.message);
  }
});

client.login(DISCORD_BOT_TOKEN);