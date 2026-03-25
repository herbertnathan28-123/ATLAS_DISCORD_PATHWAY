// ================================
// ATLAS FX DISCORD BOT — FINAL BUILD
// ================================

require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const fetch = require("node-fetch");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ================================
// CONFIG
// ================================

// 🔒 CHANNEL → GROUP MAP
const CHANNEL_GROUP_MAP = {
  "1432080184458350672": "AT",
  "1430950313484878014": "SK",
  "1431192381029482556": "NM",
  "1482451091630194868": "BR"
};

// 🔒 WEBHOOKS (SET IN .env)
const COMBINED_WEBHOOKS = {
  AT: process.env.AT_COMBINED_WEBHOOK,
  SK: process.env.SK_COMBINED_WEBHOOK,
  NM: process.env.NM_COMBINED_WEBHOOK,
  BR: process.env.BR_COMBINED_WEBHOOK
};

// 🔒 STATE
const STATE = {};
const MAX_AGE = 1000 * 60 * 60 * 2; // 2 hours

// 🔒 VALID SYMBOLS
const VALID_SYMBOLS = [
  "EURUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","USDCHF",
  "NAS100","US500","GER40",
  "MICRON","AMD","ASML"
];

// ================================
// HELPERS
// ================================

function getGroup(channelId) {
  return CHANNEL_GROUP_MAP[channelId] || null;
}

function ensureState(group, symbol) {
  if (!STATE[group]) STATE[group] = {};
  if (!STATE[group][symbol]) {
    STATE[group][symbol] = {
      ltf: null,
      htf: null,
      macro: null,
      roadmap: null,
      ts: null
    };
  }
  return STATE[group][symbol];
}

function touch(s) {
  s.ts = Date.now();
}

function isFresh(s) {
  return s.ts && (Date.now() - s.ts < MAX_AGE);
}

function isReady(s) {
  return s.ltf && s.macro && isFresh(s);
}

// ================================
// PARSER
// ================================

function parseCommand(content) {
  const trimmed = content.trim();

  // !EURUSDL
  const chartOnly = trimmed.match(/^!([A-Z]{6,10})([LH])$/i);
  if (chartOnly) {
    return {
      symbol: chartOnly[1].toUpperCase(),
      mode: chartOnly[2].toUpperCase(),
      action: "chart"
    };
  }

  // !EURUSDL /macro
  const full = trimmed.match(/^!([A-Z]{6,10})([LH])\s*\/(macro|roadmap)$/i);
  if (full) {
    return {
      symbol: full[1].toUpperCase(),
      mode: full[2].toUpperCase(),
      action: full[3].toLowerCase()
    };
  }

  return null;
}

function isValidSymbol(symbol) {
  return VALID_SYMBOLS.includes(symbol);
}

// ================================
// QUEUE SYSTEM
// ================================

const queue = [];
let running = false;

async function enqueue(job) {
  queue.push(job);
  processQueue();
}

async function processQueue() {
  if (running) return;
  running = true;

  while (queue.length > 0) {
    const job = queue.shift();
    await job();
  }

  running = false;
}

// ================================
// CHART ENGINE (PLACEHOLDER)
// ================================

async function generateCharts(symbol, mode) {
  // Replace with your Playwright logic
  return [
    `Chart ${symbol} ${mode} TF1`,
    `Chart ${symbol} ${mode} TF2`,
    `Chart ${symbol} ${mode} TF3`,
    `Chart ${symbol} ${mode} TF4`
  ];
}

// ================================
// MACRO ENGINE
// ================================

function generateMacro(symbol, level = 3) {
  const base = {
    bias: "Bearish",
    draw: "1.1550 liquidity",
    state: "Post-sweep → pullback",
    levels: ["1.1625","1.1580","1.1550"]
  };

  if (level === 1) {
    return `**${symbol} Macro**

Bias: ${base.bias}

Liquidity means areas where stop losses sit.
Price is likely moving toward ${base.draw}.

State:
${base.state}

Levels:
${base.levels.join(" / ")}
`;
  }

  if (level === 5) {
    return `**${symbol}**

Bias: ${base.bias}
Draw: ${base.draw}
State: ${base.state}`;
  }

  return `**${symbol} Macro**

Bias: ${base.bias}
Draw: ${base.draw}
State: ${base.state}

Levels:
${base.levels.join(" / ")}`;
}

// ================================
// ROADMAP ENGINE
// ================================

function generateRoadmap(symbol) {
  return `**${symbol} Weekly Roadmap**

Range: 1.1700 – 1.1450
Primary Draw: Downside liquidity
HTF Supply: Holding
`;
}

// ================================
// COMBINE
// ================================

function buildCombined(symbol, s) {
  let out = `**${symbol} — ATLAS VIEW**\n\n`;

  out += `__LTF Charts__\n${s.ltf.join("\n")}\n\n`;

  out += `__Macro (Today)__\n${s.macro}\n\n`;

  if (s.roadmap) {
    out += `__Weekly Context__\n${s.roadmap}\n\n`;
  }

  out += `_Updated: ${new Date(s.ts).toLocaleTimeString()}_`;

  return out;
}

async function sendCombined(group, content) {
  const webhook = COMBINED_WEBHOOKS[group];
  if (!webhook) return;

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
}

async function tryCombine(group, symbol) {
  const s = ensureState(group, symbol);

  if (!isReady(s)) return;

  const combined = buildCombined(symbol, s);
  await sendCombined(group, combined);
}

// ================================
// MAIN BOT LOGIC
// ================================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const group = getGroup(message.channel.id);
  if (!group) return;

  const parsed = parseCommand(message.content);
  if (!parsed) return;

  const { symbol, mode, action } = parsed;

  if (!isValidSymbol(symbol)) {
    return message.reply(`Invalid symbol: ${symbol}`);
  }

  // ========================
  // CHART
  // ========================
  if (action === "chart") {
    enqueue(async () => {
      const charts = await generateCharts(symbol, mode);

      const s = ensureState(group, symbol);

      if (mode === "L") s.ltf = charts;
      if (mode === "H") s.htf = charts;

      touch(s);
      await tryCombine(group, symbol);
    });

    return;
  }

  // ========================
  // MACRO
  // ========================
  if (action === "macro") {
    enqueue(async () => {
      const s = ensureState(group, symbol);

      if (!s.htf) {
        return message.reply(
          `${symbol} — HTF Missing\nRun: !${symbol}H`
        );
      }

      const macro = generateMacro(symbol, 3);
      s.macro = macro;

      touch(s);
      await tryCombine(group, symbol);
    });

    return;
  }

  // ========================
  // ROADMAP
  // ========================
  if (action === "roadmap") {
    enqueue(async () => {
      const roadmap = generateRoadmap(symbol);

      const s = ensureState(group, symbol);
      s.roadmap = roadmap;

      touch(s);
      await tryCombine(group, symbol);
    });

    return;
  }
});

// ================================
// START
// ================================

client.once("ready", () => {
  console.log(`ATLAS FX Bot Ready`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
