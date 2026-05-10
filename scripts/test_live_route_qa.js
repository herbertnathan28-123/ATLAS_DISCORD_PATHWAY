#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Live-route presenter QA harness.
 *
 * Exercises the EXACT production code path that `!eurusd analyse`
 * triggers in Discord: formatMacro(sym, corey, spideyHTF, spideyLTF,
 * jane, candlesByTf). Asserts the rendered text is free of every
 * banned token AND of every legacy live-output heading that the
 * May 2026 regression surfaced (FINAL VERDICT / FINAL DECISION /
 * WHAT CHANGES THE VIEW / WHAT KEEPS IT / HardConflict /
 * Market Readiness / macro engine's composite).
 *
 * The previous qa:macro script invoked buildMacroV3 directly — it
 * did NOT cover the production wrapper. This script is the one that
 * mirrors what Discord actually serves.
 *
 * Run: `npm run qa:live-route`
 */

const Module = require('module');
const path = require('path');

// Suppress real Discord login + scheduler side effects from index.js.
process.env.ATLAS_NO_LOGIN = '1';
process.env.DISCORD_TOKEN     = process.env.DISCORD_TOKEN     || 'qa-stub-token';
process.env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || 'qa-stub-token';
process.env.TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY || 'qa-stub-key';
process.env.SYSTEM_STATE      = process.env.SYSTEM_STATE      || 'BUILD_MODE';
process.env.GUILD_ID          = process.env.GUILD_ID          || '0';

// ---------------------------------------------------------------
// Sandbox: stub out every heavy dependency that index.js loads at
// require time (Discord client, Puppeteer renderer, TwelveData adapter,
// FMP, dark horse engine, schedulers). The harness only needs the pure
// formatMacro() wrapper. Without these stubs index.js opens network
// connections and posts to Discord on require — unsafe in CI.
// ---------------------------------------------------------------
const realResolve = Module._resolveFilename;
const realRequire = Module.prototype.require;

const STUBS = {
  'discord.js': {
    Client: class { constructor(){ this.user = { tag: 'stub' }; } login(){ return Promise.resolve(); } on(){ return this; } once(){ return this; } },
    GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 3, GuildMessageReactions: 4 },
    Partials: { Message: 1, Channel: 2, Reaction: 3 },
    AttachmentBuilder: class { constructor(){ } },
    ChannelType: { GuildText: 0 },
    REST: class { constructor(){} setToken(){ return this; } put(){ return Promise.resolve({}); } },
    Routes: { applicationCommands: () => '' }
  },
  'puppeteer': { launch: () => Promise.reject(new Error('puppeteer disabled in QA')) },
  'sharp': () => ({ resize: () => ({ toBuffer: () => Promise.resolve(Buffer.alloc(0)) }) }),
  'express': () => ({ get: () => {}, post: () => {}, use: () => {}, listen: (_p, cb) => { if (cb) cb(); return { close: () => {} }; } }),
  'axios': { get: () => Promise.reject(new Error('network disabled in QA')), post: () => Promise.reject(new Error('network disabled in QA')) },
  'dotenv': { config: () => ({ parsed: {} }) }
};
const localStubs = {
  './renderer':         { renderCharts: () => Promise.resolve({ htfBuf: Buffer.alloc(0), ltfBuf: Buffer.alloc(0) }) },
  './corey_live_data':  {
    init: () => Promise.resolve(),
    getLiveContext: () => ({ status: 'live', dxy: { score: -0.05, bias: 'Neutral', price: 27.41 }, vix: { score: 0.12, level: 'Normal', price: 22.5 }, yield: { score: 0.20, regime: 'Normal', spread: 0.45 } }),
    getMarketContext: () => ({}),
    refresh: () => Promise.resolve()
  },
  './corey_calendar':   {
    getCalendarSnapshot: () => ({ events: [], health: { available: false, source_used: null, calendar_mode: 'UNKNOWN' } }),
    getEventIntelligence: () => null,
    init: () => Promise.resolve()
  },
  './darkHorseEngine':  {
    startEngine: () => {},
    dhInit: () => {},
    dhSetPipelineTrigger: () => {},
    runDarkHorseScan: () => Promise.resolve([]),
    getDHInternalStore: () => ({}),
    getDHCandidate: () => null,
    getCandidate: () => null,
    DH_UNIVERSE: ['EURUSD']
  },
  './darkHorseRanking': { rank: () => null },
  './darkHorseFomoControl': { check: () => ({ ok: true }) },
  './eodhdAdapter':     { fetch: () => Promise.reject(new Error('eodhd disabled in QA')), bootProbe: () => Promise.resolve(), isEnabled: () => false },
  './historicalCache':  { isCached: () => Promise.resolve(false), getRecentCandles: () => Promise.resolve([]) },
  './cacheReader':      { isCached: () => Promise.resolve(false), getRecentCandles: () => Promise.resolve([]) },
  './cacheUpdater':     { update: () => Promise.resolve() },
  './cacheManager':     { init: () => Promise.resolve() }
};

Module.prototype.require = function(req) {
  if (Object.prototype.hasOwnProperty.call(STUBS, req)) return STUBS[req];
  if (Object.prototype.hasOwnProperty.call(localStubs, req)) return localStubs[req];
  return realRequire.call(this, req);
};

// ---------------------------------------------------------------
// Build representative inputs to formatMacro(). These mirror the
// shape produced by runJane / Spidey / Corey in the live pipeline,
// reduced to the fields formatMacroV3 actually reads.
// ---------------------------------------------------------------
function fixture(scenario) {
  const corey = {
    combinedBias: scenario === 'active' ? 'Bullish' : 'Neutral',
    confidence: scenario === 'active' ? 0.55 : 0.05,
    internalMacro: { regime: { regime: 'NEUTRAL' }, global: { riskEnv: 'NEUTRAL' } },
    trendSpider: { signalBias: 'Neutral', grade: 'Unavailable', fresh: false, available: false },
    dxy: { score: -0.05, bias: 'Neutral' },
    vix: { score: 0.10, level: 'Normal' },
    yield: { score: 0.10, regime: 'Normal' }
  };
  const spideyHTF = { dominantBias: scenario === 'active' ? 'Bullish' : 'Neutral', dominantConviction: scenario === 'active' ? 0.55 : 0.10 };
  const spideyLTF = { dominantBias: scenario === 'active' ? 'Bullish' : 'Neutral', dominantConviction: scenario === 'active' ? 0.50 : 0.10 };
  const jane = scenario === 'active'
    ? { finalBias: 'Bullish', conviction: 0.55, convictionLabel: 'Medium', conflictState: 'Aligned', doNotTrade: false, entryZone: { mid: 1.0790, lower: 1.0788, upper: 1.0795 }, invalidationLevel: 1.0755, targets: [1.0860], rrRatio: 2.5 }
    : { finalBias: 'Neutral', conviction: 0.10, convictionLabel: 'Abstain', conflictState: 'HardConflict', doNotTrade: true, doNotTradeReason: 'no clean bias', entryZone: null, invalidationLevel: null, targets: [], rrRatio: null };
  return { corey, spideyHTF, spideyLTF, jane };
}

const BANNED_USER_FACING = [
  /\btrigger\b/i, /\bauthoris(?:ed|e)\b/i, /\bauthoriz(?:ed|e)\b/i,
  /\bpermitted\b/i, /\bpermission\b/i, /\bblocked\b/i, /\bwithheld\b/i,
  /\bno clear edge\b/i, /\bprobability low\b/i, /\btrade probability\b/i,
  /\btrade range\b/i, /\bexecution map\b/i, /\bnot implemented\b/i,
  /\bunavailable\b/i, /\bincomplete\b/i,
  /\bcorey clone\b/i, /(?<![a-z])corey(?![a-z])/i,
  /(?<![a-z])spidey(?![a-z])/i, /(?<![a-z])jane(?![a-z])/i,
  // May 2026 live-output regression set (legacy headings only —
  // body phrasing like "validity window" / "catalyst window" lower-case
  // is allowed within the VALIDITY / EVENTS sections).
  /\bFINAL VERDICT\b/i, /\bFINAL DECISION\b/i, /\bFINAL READ\b/i,
  /\bWHAT CHANGES THE VIEW\b/i, /\bWHAT KEEPS IT\b/i,
  /\bHardConflict\b/, /\bPartialConflict\b/,
  /\bMarket Readiness\b/, /\bmacro engine'?s?\s+composite\b/i,
  /\bstructure engine'?s?\s+packet\b/i,
  /\bmacro engine\b/i, /\bstructure engine\b/i, /\bhistorical engine\b/i
];

(async function main() {
  // Load index.js INSIDE the sandbox so all heavy requires are stubbed.
  // index.js exposes formatMacro on module.exports per the live runtime.
  let formatMacro;
  try {
    const idx = require(path.join(__dirname, '..', 'index.js'));
    formatMacro = idx.formatMacro || idx.default && idx.default.formatMacro;
  } catch (e) {
    console.error('[LIVE-QA] FATAL — could not load index.js sandbox: ' + e.message);
    process.exit(2);
  }
  if (typeof formatMacro !== 'function') {
    console.error('[LIVE-QA] FATAL — index.js did not expose formatMacro(). The live route is broken.');
    process.exit(2);
  }

  let totalHits = 0;
  for (const scenario of ['no_packet', 'active']) {
    const f = fixture(scenario);
    let sections;
    try {
      sections = await formatMacro('EURUSD', f.corey, f.spideyHTF, f.spideyLTF, f.jane, {});
    } catch (e) {
      console.error('[LIVE-QA] scenario=' + scenario + ' BUILD ERROR — ' + e.message);
      totalHits++;
      continue;
    }
    if (!Array.isArray(sections) || !sections.length) {
      console.error('[LIVE-QA] scenario=' + scenario + ' INVALID — formatMacro returned ' + JSON.stringify(sections));
      totalHits++;
      continue;
    }
    const text = sections.map(s => (s && s.text) || '').join('\n\n');
    const hits = [];
    for (const re of BANNED_USER_FACING) {
      const m = text.match(re);
      if (m) {
        const idx = text.indexOf(m[0]);
        hits.push({ term: m[0], context: text.slice(Math.max(0, idx - 25), idx + m[0].length + 25).replace(/\s+/g, ' ').trim() });
      }
    }
    if (hits.length) {
      console.error('[LIVE-QA] scenario=' + scenario + ' HITS=' + hits.length);
      for (const h of hits.slice(0, 12)) {
        console.error('  - "' + h.term + '" :: …' + h.context + '…');
      }
      totalHits += hits.length;
    } else {
      console.log('[LIVE-QA] scenario=' + scenario + ' clean — sections=' + sections.length + ' chars=' + text.length);
    }
  }
  if (totalHits) {
    console.error('[LIVE-QA] FAIL — ' + totalHits + ' banned-token hits across live-route scenarios.');
    process.exit(1);
  }
  console.log('[LIVE-QA] PASS — every live-route scenario clean.');
  // index.js installs setIntervals + setTimeouts at module load that
  // hold the event loop open. The QA harness has nothing left to do
  // once the assertion lands; exit explicitly.
  process.exit(0);
})();
