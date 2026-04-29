'use strict';

// =============================================================================
// commandRouter.js — ATLAS FX Discord command routing
// -----------------------------------------------------------------------------
// Default route for any resolvable symbol/alias is the dashboard link.
// The Puppeteer/TradingView live-render path only runs under an explicit
// analysis subcommand: `!<symbol> analyse | analyze | charts | macro`.
//
// Render-mode requirements:
//   * If the renderer reports any timeframe failure (or does not surface a
//     per-timeframe validation array at all), the live render is BLOCKED —
//     no placeholders are sent to Discord, only an explicit "analysis
//     withheld" warning.
//
// All routing-relevant state changes are logged with stable prefixes:
//   [COMMAND] raw=!<input>
//   [SYMBOL]  raw=<sym> resolved=<resolved>
//   [ROUTE]   dashboard_link | live_render
//   [DISCORD] dashboard link sent | live render blocked
//   [CHART]   <sym> <interval> validation=pass|fail [reason=<reason>]
// =============================================================================

const DASHBOARD_BASE = 'https://atlas-fx-dashboard.onrender.com/';

const RENDER_MODES = new Set(['analyse', 'analyze', 'charts', 'macro']);

const OPS_COMMANDS = new Set(['ping', 'stats', 'errors', 'sysstate', 'darkhorse']);

const USER_BY_ID = {
  '690861328507731978':  'AT', // AT (atlas.4693)
  '1431173502161129555': 'NM', // NM (Nathan McKay)
  '763467091171999814':  'SK', // SK
  '1244449071977074798': 'BR', // BR
};

const USER_BY_CHANNEL = {
  '1432642672287547453': 'AT', // at-chart-macro-request
  '1433750991953596428': 'AT', // at-training
  '1489245537395019908': 'AT', // at-chat-with-astra
  '1432643496375881748': 'SK', // sk-chart-macro-request
  '1433751801634488372': 'SK', // sk-training
  '1489246324552368178': 'SK', // sk-chat-with-astra
  '1432644116868501595': 'NM', // nm-chart-macro-request
  '1433755484057501796': 'NM', // nm-training
  '1489248591854702744': 'NM', // nm-chat-with-astra
  '1482450651765149816': 'BR', // br-chart-macro-request
  '1482450900583710740': 'BR', // br-training
  '1489247239359697067': 'BR', // br-chat-with-astra
};

function resolveUserCode(msg) {
  return USER_BY_ID[msg.author.id]
    || USER_BY_CHANNEL[msg.channelId]
    || 'AT';
}

function dashboardUrl(symbol, user) {
  return `${DASHBOARD_BASE}?symbol=${encodeURIComponent(symbol)}&user=${encodeURIComponent(user)}`;
}

function nowIso() { return new Date().toISOString(); }

function buildAuditBase(msg, userInput) {
  return {
    discord_user_id: msg.author.id,
    discord_user_display_name:
      msg.member?.displayName || msg.author.username || msg.author.tag || 'unknown',
    channel_id: msg.channelId,
    channel_name: msg.channel?.name ?? null,
    raw_input: userInput,
  };
}

async function sendDashboardLink(msg, symbol, user) {
  const url = dashboardUrl(symbol, user);
  console.log(`[ROUTE] dashboard_link symbol=${symbol} user=${user}`);
  await msg.channel.send({
    content: `📊 **${symbol} — ATLAS Dashboard**\n${url}`,
  });
  console.log(`[DISCORD] dashboard link sent symbol=${symbol} user=${user}`);
}

async function runLiveRender(msg, symbol, mode, deps) {
  const { renderAllPanelsV3, deliverResult } = deps;
  console.log(`[ROUTE] live_render symbol=${symbol} mode=${mode}`);
  await msg.channel.send({ content: `📡 Analysing **${symbol}** — please wait` });

  let result;
  try {
    result = await renderAllPanelsV3(symbol);
  } catch (e) {
    console.log(`[DISCORD] live render blocked reason=render_threw:${e.message}`);
    await msg.channel.send({
      content: `⚠️ Chart capture failed for ${symbol} — analysis withheld until valid render available.`,
    });
    return;
  }

  const validation = Array.isArray(result && result.validation) ? result.validation : null;
  if (!validation) {
    console.log(`[DISCORD] live render blocked reason=invalid_chart_capture`);
    await msg.channel.send({
      content: `⚠️ Chart capture failed for ${symbol} — analysis withheld until valid render available.`,
    });
    return;
  }

  let anyFail = false;
  for (const v of validation) {
    if (v.ok) {
      console.log(`[CHART] ${symbol} ${v.interval} validation=pass`);
    } else {
      anyFail = true;
      console.log(
        `[CHART] ${symbol} ${v.interval} validation=fail reason=${v.reason || 'candles_not_detected'}`
      );
    }
  }
  if (anyFail) {
    console.log(`[DISCORD] live render blocked reason=invalid_chart_capture`);
    const failed = validation.filter(v => !v.ok).map(v => v.label || v.interval).join(', ');
    await msg.channel.send({
      content: `⚠️ Chart capture failed for ${symbol} (${failed}) — analysis withheld until valid render available.`,
    });
    return;
  }

  await deliverResult(msg, { symbol, ...result });
}

async function handle(msg, deps) {
  const {
    resolveSymbol,
    validateInput,
    isResolvableSymbol,
    POLICY_REJECTED_TERMS,
    emitAuditLog,
  } = deps;

  if (msg.author.bot) return;
  if (!msg.content || !msg.content.startsWith('!')) return;

  const userInput = msg.content.slice(1).trim();
  console.log(`[COMMAND] raw=!${userInput}`);

  // Ops pre-check — case-insensitive — stay silent.
  if (OPS_COMMANDS.has(userInput.toLowerCase())) return;

  // Tokenise: "<symbolOrAlias> [mode]"
  const tokens = userInput.split(/\s+/).filter(Boolean);
  const symRaw = tokens[0] || '';
  const modeRaw = (tokens[1] || '').toLowerCase();
  const isRenderMode = RENDER_MODES.has(modeRaw);

  // Reject unknown subcommands silently — only blank or a known mode is valid.
  if (tokens.length > 1 && !isRenderMode) return;

  const auditBase = buildAuditBase(msg, userInput);

  // Policy rejection (e.g. crypto) — match on the symbol token only.
  const mappedUpper = symRaw.toUpperCase();
  if (POLICY_REJECTED_TERMS.has(mappedUpper)) {
    console.log(
      `[SYMBOL] raw=${symRaw} resolved=unknown outcome=unavailable reason=policy_rejected mapped=${mappedUpper}`
    );
    emitAuditLog({
      ...auditBase,
      timestamp: nowIso(),
      resolved_symbol: 'unknown',
      outcome: 'policy_rejected',
      reason: 'policy_rejected',
    });
    await msg.channel.send({
      content: 'Cryptocurrency is not supported on ATLAS. Please search a supported instrument.',
    });
    return;
  }

  const resolved = resolveSymbol(symRaw);
  console.log(`[SYMBOL] raw=${symRaw} resolved=${resolved}`);

  // validateInput expects "!<symbol>" with no extra tokens — pass just the symbol.
  const v = validateInput('!' + resolved);
  if (!v.valid) {
    if (v.reason === 'format' || v.reason === 'unknown_instrument') {
      console.log(
        `[SYMBOL] raw=${symRaw} resolved=unknown outcome=unavailable reason=${v.reason}`
      );
      emitAuditLog({
        ...auditBase,
        timestamp: nowIso(),
        resolved_symbol: 'unknown',
        outcome: 'unavailable',
        reason: v.reason,
      });
      await msg.channel.send({ content: `Data unavailable for requested symbol: ${symRaw}` });
    }
    return;
  }
  const symbol = v.symbol;

  if (!isResolvableSymbol(symbol)) {
    console.log(
      `[SYMBOL] raw=${symRaw} resolved=unknown outcome=unavailable reason=not_in_allowlist mapped=${symbol}`
    );
    emitAuditLog({
      ...auditBase,
      timestamp: nowIso(),
      resolved_symbol: 'unknown',
      outcome: 'unavailable',
      reason: 'not_in_allowlist',
    });
    await msg.channel.send({ content: `Data unavailable for requested symbol: ${symRaw}` });
    return;
  }

  console.log(`[SYMBOL] raw=${symRaw} resolved=${symbol} outcome=served`);
  emitAuditLog({
    ...auditBase,
    timestamp: nowIso(),
    resolved_symbol: symbol,
    outcome: 'served',
    reason: null,
  });

  const user = resolveUserCode(msg);

  if (!isRenderMode) {
    await sendDashboardLink(msg, symbol, user);
    return;
  }

  await runLiveRender(msg, symbol, modeRaw, deps);
}

module.exports = {
  handle,
  RENDER_MODES,
  USER_BY_ID,
  USER_BY_CHANNEL,
  resolveUserCode,
  dashboardUrl,
};
