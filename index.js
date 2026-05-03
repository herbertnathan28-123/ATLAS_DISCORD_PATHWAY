// ============================================================
// ATLAS FX DISCORD BOT — v4.0
// EXECUTION INTERFACE v4 — INSTITUTIONAL GRADE
// Dark Horse Engine integrated — v4.0.1
// Chart engine: chart-img.com API — RENDERING LAYER v2
// Resolution: 2048x1920 | Theme: deep dark | Candles: high contrast
// ============================================================
process.on('unhandledRejection',(r)=>{console.error('[UNHANDLED]',r);});
process.on('uncaughtException',(e)=>{console.error('[CRASH]',e);});

const{Client,GatewayIntentBits,ActionRowBuilder,ButtonBuilder,ButtonStyle,AttachmentBuilder}=require('discord.js');

const { renderAllPanels } = require('./renderer');
const{createHmac}=require('crypto');
const fs=require('fs');
const https=require('https');
const http=require('http');

const{dhInit,dhSetPipelineTrigger,runDarkHorseScan,getDHInternalStore,getDHCandidate,DH_UNIVERSE}=require('./darkHorseEngine');

const coreyLive = require('./corey_live_data');
const coreyCalendar = require('./corey_calendar');
coreyLive.init();
/* [COREY-CALENDAR] A1.1 — explicit calendar registration. coreyLive.init() is
   async and not awaited above; if its pre-calendar steps reject, the chained
   calendar.startAutoRefresh() never runs and the refresh loop is silently
   orphaned. This line registers the loop unconditionally. Idempotent — the
   guard inside corey_calendar.startAutoRefresh() ignores the second call from
   corey_live_data.js when coreyLive.init() does succeed. */
coreyCalendar.init();

// Macro v3 + FMP enrichment — env-gated; ATLAS_MACRO_V3=off disables v3 (legacy formatter runs).
const fmpAdapter = require('./macro/fmpAdapter');
fmpAdapter.logBootStatus();
const MACRO_V3_ENABLED = process.env.ATLAS_MACRO_V3 !== 'off';
console.log(`[BOOT] MACRO_V3: ${MACRO_V3_ENABLED ? 'ENABLED' : 'DISABLED (legacy formatter)'}`);

// EODHD enrichment adapter — env-gated by EODHD_API_KEY. Provides realtime
// quotes / fundamentals / historical for equities (and FOREX where useful).
// Boot probe runs once and reports status for AAPL.US and MU.US per spec.
// Probe is fire-and-forget; failures do not block startup.
const eodhdAdapter = require('./eodhdAdapter');
eodhdAdapter.bootProbe().catch((e) => {
  console.warn('[EODHD] bootProbe error: ' + (e && e.message));
});


const TOKEN=process.env.DISCORD_BOT_TOKEN;
const TWELVE_DATA_KEY=process.env.TWELVE_DATA_API_KEY||'';
const FMP_API_KEY=process.env.FMP_API_KEY||'';
if(!TOKEN){console.error('[FATAL] Missing DISCORD_BOT_TOKEN');process.exit(1);}
if(!TWELVE_DATA_KEY){console.error('[FATAL] Missing TWELVE_DATA_API_KEY');process.exit(1);}
if(!FMP_API_KEY){console.warn('[BOOT] FMP_API_KEY not set — OHLC will use TwelveData only (no FMP primary).');}

function getSystemState(){const raw=process.env.SYSTEM_STATE;if(!raw){console.error('[FATAL] Missing SYSTEM_STATE.');process.exit(1);}if(raw!=='BUILD_MODE'&&raw!=='FULLY_OPERATIONAL'){console.error(`[FATAL] Invalid SYSTEM_STATE="${raw}".`);process.exit(1);}return raw;}
const SYSTEM_STATE=getSystemState();
console.log(`[BOOT] SYSTEM_STATE: ${SYSTEM_STATE}`);
const isBuildMode=()=>SYSTEM_STATE==='BUILD_MODE';
const isFullyOperational=()=>SYSTEM_STATE==='FULLY_OPERATIONAL';
