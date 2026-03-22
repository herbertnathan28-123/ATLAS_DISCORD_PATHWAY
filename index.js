process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const N8N_WEBHOOK_URL = 'https://atlas-nathan28.app.n8n.cloud/webhook/atlas-fx';

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN environment variable.');
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

client.once('clientReady', () => {
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
      N8N_WEBHOOK_URL,
      {
        command: raw,
        user: message.author.username,
        channel: message.channel.id,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    console.log(`[OK] user=${message.author.username} command="${raw}"`);
  } catch (error) {
    console.error('[N8N ERROR]', error.message);
  }
});

client.on('shardDisconnect', (event, shardId) => {
  console.warn(`Shard ${shardId} disconnected. Code: ${event.code}`);
});
client.on('shardReconnecting', (shardId) => {
  console.log(`Shard ${shardId} reconnecting...`);
});
client.on('shardResume', (shardId, replayedEvents) => {
  console.log(`Shard ${shardId} resumed. Replayed ${replayedEvents} events.`);
});

setInterval(() => {
  console.log('[keep-alive]', new Date().toISOString());
}, 5 * 60 * 1000);

client.login(DISCORD_BOT_TOKEN);
