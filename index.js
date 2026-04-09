'use strict';
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
const sharp=require('sharp');
const crypto=require('crypto');
const fs=require('fs');
const https=require('https');
const http=require('http');

const{dhInit,dhSetPipelineTrigger,runDarkHorseScan,getDHInternalStore,getDHCandidate,DH_UNIVERSE}=require('./darkHorseEngine');

const TOKEN=process.env.DISCORD_BOT_TOKEN;
const TWELVE_DATA_KEY=process.env.TWELVE_DATA_API_KEY||'';
if(!TOKEN){console.error('[FATAL] Missing DISCORD_BOT_TOKEN');process.exit(1);}
if(!TWELVE_DATA_KEY){console.error('[FATAL] Missing TWELVE_DATA_API_KEY');process.exit(1);}

function getSystemState(){const raw=process.env.SYSTEM_STATE;if(!raw){console.error('[FATAL] Missing SYSTEM_STATE.');process.exit(1);}if(raw!=='BUILD_MODE'&&raw!=='FULLY_OPERATIONAL'){console.error(`[FATAL] Invalid SYSTEM_STATE="${raw}".`);process.exit(1);}return raw;}
const SYSTEM_STATE=getSystemState();
console.log(`[BOOT] SYSTEM_STATE: ${SYSTEM_STATE}`);
const isBuildMode=()=>SYSTEM_STATE==='BUILD_MODE';
const isFullyOperational=()=>SYSTEM_STATE==='FULLY_OPERATIONAL';

const ATLAS_INSTANCE_ID=process.env.ATLAS_INSTANCE_ID||null;
const ATLAS_SIGNING_SECRET=process.env.ATLAS_SIGNING_SECRET||null;
const ATLAS_WATERMARK_ENABLED=process.env.ATLAS_WATERMARK_ENABLED==='true';
const ATLAS_SIGNATURE_ENABLED=process.env.ATLAS_SIGNATURE_ENABLED==='true';
const AUTH_AVAILABLE=!!(ATLAS_INSTANCE_ID&&ATLAS_SIGNING_SECRET);
if(AUTH_AVAILABLE){console.log(`[BOOT] AUTH: VERIFIED — instance:${ATLAS_INSTANCE_ID} sig:${ATLAS_SIGNATURE_ENABLED} watermark:${ATLAS_WATERMARK_ENABLED}`);}
else{console.log('[BOOT] AUTH: UNVERIFIED — auth env vars absent. TRADE PERMITTED permanently blocked.');}
function generateSignature(payload){if(!AUTH_AVAILABLE||!ATLAS_SIGNATURE_ENABLED)return null;return crypto.createHmac('sha256',ATLAS_SIGNING_SECRET).update(payload).digest('hex').slice(0,12).toUpperCase();}
function buildVerificationLine(symbol,timestamp){if(!AUTH_AVAILABLE)return`ATLAS UNVERIFIED • NO AUTH • ${timestamp}`;const sig=generateSignature(`${ATLAS_INSTANCE_ID}:${symbol}:${timestamp}`);return`ATLAS VERIFIED • ${ATLAS_INSTANCE_ID} • ${timestamp} • SIG ${sig||'DISABLED'}`;}
const isTradePermitAllowed=()=>AUTH_AVAILABLE&&isFullyOperational();

const TS_ENABLED=process.env.ENABLE_TRENDSPIDER!=='false';
const TS_PORT=parseInt(process.env.TRENDSPIDER_PORT||'3001',10);
const TS_TTL_MS=parseInt(process.env.TRENDSPIDER_SIGNAL_TTL_MS||String(4*60*60*1000),10);
const TS_HISTORY_LIMIT=parseInt(process.env.TRENDSPIDER_HISTORY_LIMIT||'10',10);
const TS_PERSIST_PATH=process.env.TRENDSPIDER_PERSIST_PATH||null;

const SAMESITE_MAP={strict:'Strict',lax:'Lax',none:'None',no_restriction:'None',unspecified:'Lax'};
const ALLOWED_COOKIE_FIELDS=new Set(['name','value','domain','path','expires','httpOnly','secure','sameSite']);
function sanitiseCookies(raw){return raw.map(c=>{const out={};for(const f of ALLOWED_COOKIE_FIELDS){if(c[f]!==undefined)out[f]=c[f];}out.sameSite=SAMESITE_MAP[String(c.sameSite||'').toLowerCase()]||'Lax';if(!out.domain)out.domain='.tradingview.com';if(!out.path)out.path='/';if(!out.expires&&c.expirationDate)out.expires=c.expirationDate;return out;}).filter(c=>c.domain&&c.domain.includes('tradingview'));}
let TV_COOKIES=null;
try{if(process.env.TV_COOKIES){TV_COOKIES=sanitiseCookies(JSON.parse(process.env.TV_COOKIES));console.log(`[BOOT] TV_COOKIES: ${TV_COOKIES.length} cookies loaded`);}}catch(e){console.error('[BOOT] TV_COOKIES parse error:',e.message);}
console.log(`[BOOT] ATLAS FX v4.0 starting... auth:${TV_COOKIES?'COOKIE':'GUEST'} trendspider:${TS_ENABLED?'ENABLED':'DISABLED'}`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('clientReady', async () => {

  console.log(`[READY] ATLAS FX Bot online as ${client.user.tag}`);

  // COREY LIVE DATA TEST
  try {
  console.log("COREY: loading module...");

  const { getCoreyLiveData } = require('./corey_live_data');

  console.log("COREY: module loaded");

  console.log("COREY: fetching data...");

  const data = await getCoreyLiveData();

  console.log("COREY LIVE DATA:", JSON.stringify(data, null, 2));

} catch (e) {
  console.error("COREY DATA ERROR FULL:", e);
}

  dhInit(safeOHLC);
  dhSetPipelineTrigger(darkHorsePipelineTrigger);

  setInterval(async () => {
    try {
      await runDarkHorseScan();
    } catch (e) {
      log('ERROR', `[DH SCHEDULER] ${e.message}`);
    }
  }, 15 * 60 * 1000);

  log('INFO', '[BOOT] Dark Horse Engine active — scanning every 15 minutes (market hours Mon-Fri only)');
});

const MAX_RETRIES = 2;
const RENDER_TIMEOUT_MS = 45000;
const MESSAGE_DEDUPE_TTL_MS = 30000;
const SHARED_MACROS_CHANNEL =
  process.env.SHARED_MACROS_CHANNEL_ID || '1434253776360968293';
const CACHE_TTL_MS = 15 * 60 * 1000;
// ── RENDERING LAYER v2 — RESOLUTION ──────────────────────────
const CHART_W=2048;
const CHART_H=1920;
// ─────────────────────────────────────────────────────────────

const MIN_CANVAS_AREA=150000;
const ABORT_THRESHOLD=0.25;
const HTF_INTERVALS=['1W','1D','240','60'];
const LTF_INTERVALS=['30','15','5','1'];
const TF_LABELS={'1W':'Weekly','1D':'Daily','240':'4H','60':'1H','30':'30M','15':'15M','5':'5M','1':'1M'};
const tfLabel=iv=>TF_LABELS[iv]||iv;

const EPSILON=1e-9;
const BIAS=Object.freeze({BULLISH:'Bullish',BEARISH:'Bearish',NEUTRAL:'Neutral'});
const RISK_ENV=Object.freeze({RISK_ON:'RiskOn',RISK_OFF:'RiskOff',NEUTRAL:'Neutral'});
const REGIME=Object.freeze({EXPANSION:'Expansion',GROWTH:'Growth',TRANSITION:'Transition',CONTRACTION:'Contraction',CRISIS:'Crisis',NEUTRAL:'Neutral'});
const ASSET_CLASS=Object.freeze({FX:'FX',EQUITY:'Equity',COMMODITY:'Commodity',INDEX:'Index',UNKNOWN:'Unknown'});
const STANCE=Object.freeze({HAWKISH:'Hawkish',DOVISH:'Dovish',NEUTRAL:'Neutral',N_A:'N/A'});
const RATE_CYCLE=Object.freeze({HIKING:'Hiking',CUTTING:'Cutting',HOLDING:'Holding',N_A:'N/A'});
const THRESHOLDS=Object.freeze({macroBullish:0.15,macroBearish:-0.15,fxBullish:0.20,fxBearish:-0.20,strongConfidence:0.60,moderateConfidence:0.30,tradeValidConfidence:0.45});
const FX_QUOTES=new Set(['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF','SEK','NOK','DKK','SGD','HKD','CNH','CNY']);
const EQUITY_SYMBOLS=new Set(['AMD','MU','ASML','MICRON','NVDA','AVGO','TSM','QCOM','AAPL','MSFT','META','GOOGL','AMZN','TSLA','INTC']);
const COMMODITY_SYMBOLS=new Set(['XAUUSD','XAGUSD','XAUEUR','XAGEUR','USOIL','WTI','BRENT','BCOUSD','NATGAS']);
const INDEX_SYMBOLS=new Set(['NAS100','US500','US30','GER40','UK100','HK50','JPN225','SPX','NDX','DJI']);
const SEMI_SYMBOLS=new Set(['AMD','MU','ASML','MICRON','NVDA','AVGO','TSM','QCOM','INTC']);
const CURRENCY_COUNTRY=Object.freeze({USD:{country:'United States',weight:1.00},EUR:{country:'Eurozone',weight:1.00},GBP:{country:'United Kingdom',weight:0.90},JPY:{country:'Japan',weight:0.90},AUD:{country:'Australia',weight:0.85},NZD:{country:'New Zealand',weight:0.75},CAD:{country:'Canada',weight:0.85},CHF:{country:'Switzerland',weight:0.80},SEK:{country:'Sweden',weight:0.60},NOK:{country:'Norway',weight:0.60},DKK:{country:'Denmark',weight:0.55},SGD:{country:'Singapore',weight:0.65},HKD:{country:'Hong Kong',weight:0.55},CNH:{country:'China Offshore',weight:0.80},CNY:{country:'China',weight:0.85}});
const CENTRAL_BANKS=Object.freeze({USD:{name:'Federal Reserve',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.90,growthSensitivity:0.80},EUR:{name:'European Central Bank',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.85,growthSensitivity:0.70},GBP:{name:'Bank of England',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.90,growthSensitivity:0.75},JPY:{name:'Bank of Japan',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.65,growthSensitivity:0.60},AUD:{name:'Reserve Bank of Australia',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.85,growthSensitivity:0.80},NZD:{name:'Reserve Bank of New Zealand',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.85,growthSensitivity:0.75},CAD:{name:'Bank of Canada',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.85,growthSensitivity:0.75},CHF:{name:'Swiss National Bank',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.75,growthSensitivity:0.65},SEK:{name:'Riksbank',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.75,growthSensitivity:0.65},NOK:{name:'Norges Bank',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.80,growthSensitivity:0.70},DKK:{name:'Danmarks Nationalbank',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.70,growthSensitivity:0.65},SGD:{name:'Monetary Authority of Singapore',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.80,growthSensitivity:0.75},HKD:{name:'Hong Kong Monetary Authority',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.70,growthSensitivity:0.65},CNH:{name:"People's Bank of China Offshore",stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.60,growthSensitivity:0.85},CNY:{name:"People's Bank of China",stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.60,growthSensitivity:0.85}});
const ECONOMIC_BASELINES=Object.freeze({USD:{gdpMomentum:0.68,employment:0.72,inflationControl:0.55,fiscalPosition:0.45,politicalStability:0.55},EUR:{gdpMomentum:0.48,employment:0.57,inflationControl:0.60,fiscalPosition:0.48,politicalStability:0.55},GBP:{gdpMomentum:0.44,employment:0.56,inflationControl:0.52,fiscalPosition:0.42,politicalStability:0.50},JPY:{gdpMomentum:0.45,employment:0.66,inflationControl:0.58,fiscalPosition:0.32,politicalStability:0.72},AUD:{gdpMomentum:0.58,employment:0.64,inflationControl:0.52,fiscalPosition:0.58,politicalStability:0.72},NZD:{gdpMomentum:0.49,employment:0.58,inflationControl:0.50,fiscalPosition:0.56,politicalStability:0.76},CAD:{gdpMomentum:0.54,employment:0.60,inflationControl:0.54,fiscalPosition:0.55,politicalStability:0.72},CHF:{gdpMomentum:0.52,employment:0.66,inflationControl:0.72,fiscalPosition:0.74,politicalStability:0.86},SEK:{gdpMomentum:0.46,employment:0.56,inflationControl:0.62,fiscalPosition:0.68,politicalStability:0.80},NOK:{gdpMomentum:0.57,employment:0.59,inflationControl:0.65,fiscalPosition:0.82,politicalStability:0.84},DKK:{gdpMomentum:0.53,employment:0.61,inflationControl:0.67,fiscalPosition:0.79,politicalStability:0.85},SGD:{gdpMomentum:0.62,employment:0.66,inflationControl:0.63,fiscalPosition:0.78,politicalStability:0.88},HKD:{gdpMomentum:0.49,employment:0.58,inflationControl:0.60,fiscalPosition:0.70,politicalStability:0.64},CNH:{gdpMomentum:0.55,employment:0.60,inflationControl:0.58,fiscalPosition:0.62,politicalStability:0.48},CNY:{gdpMomentum:0.56,employment:0.61,inflationControl:0.59,fiscalPosition:0.63,politicalStability:0.48}});
const DEFAULT_MARKET_CONTEXT=Object.freeze({oilShock:0,creditStress:0,geopoliticalStress:0,growthImpulse:0,inflationImpulse:0,usdFlow:0,bondStress:0,equityBreadth:0,safeHavenFlow:0,semiconductorCycle:0,aiCapexImpulse:0,commodityDemand:0,realYieldPressure:0,recessionRisk:0});

const clamp=(v,min=-1,max=1)=>Number.isFinite(v)?Math.min(Math.max(v,min),max):0;
const clamp01=v=>Number.isFinite(v)?Math.min(Math.max(v,0),1):0;
const round2=v=>{if(!Number.isFinite(v))return 0;return Math.round((v+EPSILON)*100)/100;};
const average=arr=>{const f=arr.filter(Number.isFinite);return f.length?f.reduce((s,v)=>s+v,0)/f.length:0;};
const weightedAvg=items=>{let n=0,d=0;for(const{value,weight}of items){if(!Number.isFinite(value)||!Number.isFinite(weight))continue;n+=value*weight;d+=weight;}return d?n/d:0;};
const deepClone=x=>JSON.parse(JSON.stringify(x));
const scoreToBias=(score,bull=THRESHOLDS.macroBullish,bear=THRESHOLDS.macroBearish)=>score>bull?BIAS.BULLISH:score<bear?BIAS.BEARISH:BIAS.NEUTRAL;
const safeCountry=ccy=>CURRENCY_COUNTRY[ccy]?.country||ccy;
const normalizeSymbol=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,'');
const isFxPair=s=>s.length===6&&FX_QUOTES.has(s.slice(0,3))&&FX_QUOTES.has(s.slice(3,6));
function inferAssetClass(s){if(EQUITY_SYMBOLS.has(s))return ASSET_CLASS.EQUITY;if(COMMODITY_SYMBOLS.has(s))return ASSET_CLASS.COMMODITY;if(INDEX_SYMBOLS.has(s))return ASSET_CLASS.INDEX;if(isFxPair(s))return ASSET_CLASS.FX;if(/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s))return ASSET_CLASS.COMMODITY;if(/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s))return ASSET_CLASS.INDEX;if(/^[A-Z]{1,5}$/.test(s))return ASSET_CLASS.EQUITY;return ASSET_CLASS.UNKNOWN;}
function parsePairCore(symbol){const s=normalizeSymbol(symbol);if(isFxPair(s))return{symbol:s,base:s.slice(0,3),quote:s.slice(3,6),assetClass:ASSET_CLASS.FX};if(['XAUUSD','XAGUSD','BCOUSD'].includes(s))return{symbol:s,base:s.slice(0,3),quote:s.slice(3,6),assetClass:inferAssetClass(s)};return{symbol:s,base:s,quote:'USD',assetClass:inferAssetClass(s)};}
const makeStubCB=label=>({name:label||'Commodity',stance:STANCE.N_A,direction:STANCE.N_A,rateCycle:RATE_CYCLE.N_A,terminalBias:0,inflationSensitivity:0.5,growthSensitivity:0.5,score:0});
const makeStubEcon=()=>({gdpMomentum:0.5,employment:0.5,inflationControl:0.5,fiscalPosition:0.5,politicalStability:0.5,composite:0.5});

function getPipSize(symbol){const s=normalizeSymbol(symbol);if(s.includes('JPY'))return{pipSize:0.01,dp:3};if(s==='XAGUSD'||s==='XAGEUR')return{pipSize:0.01,dp:3};if(s==='XAUUSD'||s==='XAUEUR')return{pipSize:0.10,dp:2};if(/BCOUSD|USOIL|WTI|BRENT/.test(s))return{pipSize:0.01,dp:3};if(/NATGAS/.test(s))return{pipSize:0.001,dp:4};if(INDEX_SYMBOLS.has(s)||/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s))return{pipSize:1.0,dp:1};if(EQUITY_SYMBOLS.has(s)||SEMI_SYMBOLS.has(s))return{pipSize:0.01,dp:3};if(isFxPair(s))return{pipSize:0.0001,dp:5};return{pipSize:0.0001,dp:5};}
function fmtPrice(n,symbol){if(n==null||!Number.isFinite(n))return'N/A';if(symbol){const{dp}=getPipSize(symbol);return Number(n).toFixed(dp);}if(n>100)return Number(n).toFixed(2);if(n>1)return Number(n).toFixed(4);return Number(n).toFixed(5);}

const SYMBOL_OVERRIDES={XAUUSD:'OANDA:XAUUSD',XAGUSD:'OANDA:XAGUSD',BCOUSD:'OANDA:BCOUSD',USOIL:'OANDA:BCOUSD',NAS100:'OANDA:NAS100USD',US500:'OANDA:SPX500USD',US30:'OANDA:US30USD',GER40:'OANDA:DE30EUR',UK100:'OANDA:UK100GBP',NATGAS:'NYMEX:NG1!',MICRON:'NASDAQ:MU',AMD:'NASDAQ:AMD',ASML:'NASDAQ:ASML'};
const TD_SYMBOL_MAP={XAUUSD:'XAU/USD',XAGUSD:'XAG/USD',BCOUSD:'BCO/USD',USOIL:'WTI/USD',NAS100:'NDX',US500:'SPX',US30:'DJI',GER40:'DAX',UK100:'UKX',NATGAS:'NG/USD',EURUSD:'EUR/USD',GBPUSD:'GBP/USD',USDJPY:'USD/JPY',AUDUSD:'AUD/USD',NZDUSD:'NZD/USD',USDCAD:'USD/CAD',USDCHF:'USD/CHF',EURGBP:'EUR/GBP',EURJPY:'EUR/JPY',GBPJPY:'GBP/JPY',AUDJPY:'AUD/JPY',CADJPY:'CAD/JPY',NZDJPY:'NZD/JPY',CHFJPY:'CHF/JPY',EURCHF:'EUR/CHF',EURAUD:'EUR/AUD',EURCAD:'EUR/CAD',GBPAUD:'GBP/AUD',GBPCAD:'GBP/CAD',GBPCHF:'GBP/CHF',AUDCAD:'AUD/CAD',AUDCHF:'AUD/CHF',AUDNZD:'AUD/NZD',CADCHF:'CAD/CHF',NZDCAD:'NZD/CAD',NZDCHF:'NZD/CHF',MICRON:'MU',AMD:'AMD',ASML:'ASML',NVDA:'NVDA'};
const TD_INTERVAL_MAP={'1W':'1week','1D':'1day','240':'4h','60':'1h','30':'30min','15':'15min','5':'5min','1':'1min'};
function getTVSymbol(s){if(SYMBOL_OVERRIDES[s])return SYMBOL_OVERRIDES[s];if(/^[A-Z]{6}$/.test(s))return`OANDA:${s}`;return`NASDAQ:${s}`;}
function getFeedName(s){const f=getTVSymbol(s).split(':')[0];return{OANDA:'OANDA',NASDAQ:'NASDAQ',NYSE:'NYSE',NYMEX:'NYMEX',TVC:'TVC'}[f]||f;}
const log=(level,msg,...a)=>console.log(`[${new Date().toISOString()}] [${level}] ${msg}`,...a);

const CRYPTO_KW=new Set(['BTC','ETH','XRP','SOL','DOGE','ADA','BNB','DOT','MATIC','AVAX','LINK','LTC','BCH','XLM','ALGO','ATOM','VET','ICP','BITCOIN','ETHEREUM','CRYPTO','USDT','USDC','SHIB','PEPE']);
const REJECTED_TERMS=new Set(['LH','HL','HH','LL','BUY','SELL','BULLISH','BEARISH','LONG','SHORT','MACRO','UP','DOWN','CALL','PUT','H','L']);
const REJECTED_GENERIC=new Set(['GOLD','SILVER','OIL','BRENT','WTI','GAS','NATGAS','NAS','NASDAQ','SP500','SPX','DOW','DJI','DAX','FTSE','MICRON','MU']);
function validateInput(raw){const t=(raw||'').trim();if(!t.startsWith('!'))return{valid:false,reason:'no_prefix'};const content=t.slice(1).trim();const tokens=content.split(/\s+/);if(tokens[0]==='ping')return{valid:false,reason:'ops',op:'ping'};if(tokens[0]==='stats')return{valid:false,reason:'ops',op:'stats'};if(tokens[0]==='errors')return{valid:false,reason:'ops',op:'errors'};if(tokens[0]==='sysstate')return{valid:false,reason:'ops',op:'sysstate'};if(tokens[0]==='darkhorse')return{valid:false,reason:'ops',op:'darkhorse'};if(tokens.length>1)return{valid:false,reason:'extra_tokens'};const sym=tokens[0].toUpperCase();if(CRYPTO_KW.has(sym)||sym.endsWith('USDT')||sym.endsWith('USDC')||sym.startsWith('BTC'))return{valid:false,reason:'crypto'};if(REJECTED_TERMS.has(sym))return{valid:false,reason:'direction_term'};if(REJECTED_GENERIC.has(sym))return{valid:false,reason:'generic_name'};if(!/^[A-Z0-9]{2,10}$/.test(sym))return{valid:false,reason:'format'};const ac=inferAssetClass(sym);if(ac===ASSET_CLASS.UNKNOWN&&!isFxPair(sym)&&sym.length!==6)return{valid:false,reason:'unknown_instrument'};return{valid:true,symbol:sym};}
function inputErrorMsg(){return'**ATLAS — INPUT ERROR**\n\nInvalid input format.\n\nOnly enter the instrument code.\n\nExample:\n`!XAGUSD`\n\nDo not include structure, direction, or opinion.';}

const REQUEST_LOG=[];
const OUTCOME=Object.freeze({BLOCKED:'BLOCKED',FAILED:'FAILED',PARTIAL:'PARTIAL',SUCCESS:'SUCCESS'});
function auditLog(e){REQUEST_LOG.unshift({...e,time:new Date().toISOString()});if(REQUEST_LOG.length>200)REQUEST_LOG.length=200;}
const STATS={total:0,blocked:0,partial:0,failed:0,success:0,symbols:{}};
function trackStats(sym,outcome){STATS.total++;if(outcome===OUTCOME.BLOCKED)STATS.blocked++;else if(outcome===OUTCOME.PARTIAL)STATS.partial++;else if(outcome===OUTCOME.FAILED)STATS.failed++;else if(outcome===OUTCOME.SUCCESS)STATS.success++;if(sym)STATS.symbols[sym]=(STATS.symbols[sym]||0)+1;}

const TS_STORE=new Map();
function tsDir(raw){if(!raw)return'Neutral';const v=String(raw).toLowerCase();if(v.includes('bull')||v==='up'||v==='long'||v==='buy')return'Bullish';if(v.includes('bear')||v==='down'||v==='short'||v==='sell')return'Bearish';return'Neutral';}
function tsSigType(raw){if(!raw)return'Unknown';const v=String(raw).toLowerCase();if(v.includes('break'))return'Breakout';if(v.includes('revers'))return'Reversal';if(v.includes('continu'))return'Continuation';if(v.includes('warn'))return'Warning';if(v.includes('pattern'))return'Pattern';return'Scanner';}
function tsNorm(raw,rt){const sym=(raw.symbol||raw.ticker||raw.pair||'').toUpperCase().replace(/[^A-Z0-9]/g,'');const dir=tsDir(raw.direction||raw.trend||raw.signal||''),stype=tsSigType(raw.signal_type||raw.signal||raw.strategy||raw.scanner||'');let str=parseFloat(raw.strength||raw.confidence||0.5),conf=parseFloat(raw.confidence||raw.strength||0.5);str=Math.max(0,Math.min(1,isNaN(str)?0.5:str));conf=Math.max(0,Math.min(1,isNaN(conf)?0.5:conf));const ts=raw.timestamp?(typeof raw.timestamp==='number'?raw.timestamp*(raw.timestamp<1e12?1000:1):Date.parse(raw.timestamp)):rt;return{symbol:sym,timeframe:raw.timeframe||null,signalType:stype,direction:dir,pattern:raw.pattern||null,strategy:raw.strategy||null,scanner:raw.scanner||null,strength:str,confidence:conf,price:raw.price?parseFloat(raw.price):null,timestamp:ts,notes:raw.notes||null,raw};}
function tsGrade(signal,now){const age=now-signal.timestamp;if(age>TS_TTL_MS)return'Stale';if(!signal.direction||signal.direction==='Neutral')return'Unusable';if(age>TS_TTL_MS*0.75)return'FreshLow';if(signal.confidence>=0.70&&age<TS_TTL_MS*0.25)return'FreshHigh';if(signal.confidence>=0.45)return'FreshMedium';return'FreshLow';}
function tsStore(signal){const sym=signal.symbol;if(!TS_STORE.has(sym))TS_STORE.set(sym,{latest:null,history:[]});const e=TS_STORE.get(sym);e.latest=signal;e.history.unshift(signal);if(e.history.length>TS_HISTORY_LIMIT)e.history.length=TS_HISTORY_LIMIT;if(TS_PERSIST_PATH)tsPersist();log('INFO',`[TS STORE] ${sym} ${signal.direction} ${signal.signalType}`);}
function tsGet(sym){const e=TS_STORE.get(sym);return e?e.latest:null;}
function tsPersist(){try{const o={};for(const[k,v]of TS_STORE)o[k]=v;fs.writeFileSync(TS_PERSIST_PATH,JSON.stringify(o),'utf8');}catch(e){log('WARN',`[TS PERSIST] ${e.message}`);}}
function tsLoadPersisted(){if(!TS_PERSIST_PATH)return;try{if(!fs.existsSync(TS_PERSIST_PATH))return;const data=JSON.parse(fs.readFileSync(TS_PERSIST_PATH,'utf8'));const now=Date.now();let loaded=0;for(const[sym,e]of Object.entries(data)){if(e.latest&&(now-e.latest.timestamp)<TS_TTL_MS){TS_STORE.set(sym,e);loaded++;}}log('INFO',`[TS LOAD] ${loaded} symbols loaded`);}catch(e){log('WARN',`[TS LOAD] ${e.message}`);}}
setInterval(()=>{const now=Date.now();let rm=0;for(const[sym,e]of TS_STORE){if(e.latest&&(now-e.latest.timestamp)>TS_TTL_MS*2){TS_STORE.delete(sym);rm++;}}if(rm>0)log('INFO',`[TS CLEANUP] Removed ${rm}`);},30*60*1000);

function startTSServer(){if(!TS_ENABLED){log('INFO','[TS SERVER] Disabled');return;}const srv=http.createServer((req,res)=>{if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,service:'ATLAS FX v4.0',signals:TS_STORE.size}));return;}if(req.method==='POST'&&req.url==='/trendspider'){let body='';req.on('data',c=>{body+=c;});req.on('end',()=>{const rt=Date.now();try{const raw=JSON.parse(body);const rawSym=raw.symbol||raw.ticker||raw.pair||'';if(!rawSym){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'Missing symbol'}));return;}const sig=tsNorm(raw,rt);if(!sig.symbol){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'Could not resolve symbol'}));return;}const grade=tsGrade(sig,rt);if(grade!=='Unusable')tsStore(sig);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,symbol:sig.symbol,stored:grade!=='Unusable',status:grade}));}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'Invalid JSON'}));}});req.on('error',()=>{res.writeHead(500);res.end();});return;}res.writeHead(404);res.end();});srv.on('error',e=>log('ERROR',`[TS SERVER] ${e.message}`));srv.listen(TS_PORT,()=>log('INFO',`[TS SERVER] Listening on port ${TS_PORT}`));}

function fetchOHLC(symbol,resolution,count=200){return new Promise((resolve,reject)=>{const tdSym=encodeURIComponent(TD_SYMBOL_MAP[symbol]||symbol),tdInt=TD_INTERVAL_MAP[resolution]||'1day';const opts={hostname:'api.twelvedata.com',path:`/time_series?symbol=${tdSym}&interval=${tdInt}&outputsize=${count}&apikey=${TWELVE_DATA_KEY}&format=JSON`,method:'GET',headers:{'User-Agent':'ATLAS-FX/4.0'},timeout:15000};const req=https.request(opts,r=>{let data='';r.on('data',c=>{data+=c;});r.on('end',()=>{try{const p=JSON.parse(data);if(p.status==='error'||!p.values||!Array.isArray(p.values)){reject(new Error(`TwelveData: ${p.message||'unknown'}`));return;}resolve(p.values.slice().reverse().map(v=>({time:Math.floor(new Date(v.datetime).getTime()/1000),open:parseFloat(v.open),high:parseFloat(v.high),low:parseFloat(v.low),close:parseFloat(v.close),volume:v.volume?parseFloat(v.volume):0})));}catch(e){reject(new Error(`TwelveData parse: ${e.message}`));}});});req.on('error',reject);req.on('timeout',()=>reject(new Error('TwelveData timeout')));req.end();});}
async function safeOHLC(sym,res,count=200){try{return await fetchOHLC(sym,res,count);}catch(e){log('WARN',`[OHLC] ${sym} ${res}: ${e.message}`);return null;}}

function detectSwings(candles,lb=3){const sh=[],sl=[];for(let i=lb;i<candles.length-lb;i++){const c=candles[i];let isH=true,isL=true;for(let j=i-lb;j<=i+lb;j++){if(j===i)continue;if(candles[j].high>=c.high)isH=false;if(candles[j].low<=c.low)isL=false;}if(isH)sh.push({index:i,level:c.high,time:c.time});if(isL)sl.push({index:i,level:c.low,time:c.time});}return{swingHighs:sh,swingLows:sl};}
function classifyStructure(sh,sl,lb=4){const rh=sh.slice(-lb),rl=sl.slice(-lb);if(rh.length<2||rl.length<2)return{bias:'Neutral',structure:'Insufficient data',conviction:0.3};const hp=[],lp=[];for(let i=1;i<rh.length;i++)hp.push(rh[i].level>rh[i-1].level?'HH':'LH');for(let i=1;i<rl.length;i++)lp.push(rl[i].level>rl[i-1].level?'HL':'LL');const hhC=hp.filter(x=>x==='HH').length,lhC=hp.filter(x=>x==='LH').length,hlC=lp.filter(x=>x==='HL').length,llC=lp.filter(x=>x==='LL').length,total=hp.length+lp.length,bull=(hhC+hlC)/total,bear=(lhC+llC)/total;if(bull>=0.75)return{bias:'Bullish',structure:'Trending',conviction:bull};if(bear>=0.75)return{bias:'Bearish',structure:'Trending',conviction:bear};if(bull>=0.55)return{bias:'Bullish',structure:'Transition',conviction:bull*0.8};if(bear>=0.55)return{bias:'Bearish',structure:'Transition',conviction:bear*0.8};return{bias:'Neutral',structure:'Range',conviction:0.3};}
function detectBreaks(candles,sh,sl){if(candles.length<5||!sh.length||!sl.length)return{lastBreak:'None',direction:null,breakLevel:null,isEngineered:false};const last=candles[candles.length-1],p20=candles.slice(-20),lSH=sh[sh.length-1],lSL=sl[sl.length-1],p5=p20.slice(-5),rH=Math.max(...p5.map(c=>c.high)),rL=Math.min(...p5.map(c=>c.low));const bBOS=last.close>lSH.level,bearBOS=last.close<lSL.level,bCHoCH=last.close>rH&&!bBOS,bearCHoCH=last.close<rL&&!bearBOS,wA=p20.some(c=>c.high>lSH.level&&c.close<=lSH.level),wB=p20.some(c=>c.low<lSL.level&&c.close>=lSL.level),isEng=wA||wB;if(bBOS)return{lastBreak:'BOS',direction:'Bullish',breakLevel:lSH.level,isEngineered:false};if(bearBOS)return{lastBreak:'BOS',direction:'Bearish',breakLevel:lSL.level,isEngineered:false};if(bCHoCH)return{lastBreak:'CHoCH',direction:'Bullish',breakLevel:rH,isEngineered:isEng};if(bearCHoCH)return{lastBreak:'CHoCH',direction:'Bearish',breakLevel:rL,isEngineered:isEng};return{lastBreak:'None',direction:null,breakLevel:null,isEngineered:false};}
function detectZones(candles){const zones={supply:[],demand:[]};if(candles.length<10)return zones;const cp=candles[candles.length-1].close;for(let i=3;i<candles.length-3;i++){const base=candles[i],imp=candles.slice(i+1,i+4);const bearI=imp.every(c=>c.close<c.open)&&imp.reduce((s,c)=>s+(c.open-c.close),0)>(base.high-base.low)*1.5;const bullI=imp.every(c=>c.close>c.open)&&imp.reduce((s,c)=>s+(c.close-c.open),0)>(base.high-base.low)*1.5;if(bearI&&base.close>base.open)zones.supply.push({high:base.high,low:Math.min(base.open,base.close),time:base.time});if(bullI&&base.close<base.open)zones.demand.push({high:Math.max(base.open,base.close),low:base.low,time:base.time});}zones.supply=zones.supply.filter(z=>z.low>cp).sort((a,b)=>a.low-b.low).slice(0,3);zones.demand=zones.demand.filter(z=>z.high<cp).sort((a,b)=>b.high-a.high).slice(0,3);return zones;}
function detectImbalances(candles){const ims=[],cp=candles[candles.length-1].close;for(let i=0;i<candles.length-2;i++){const c1=candles[i],c3=candles[i+2],c2=candles[i+1];if(c3.low>c1.high)ims.push({type:'Bullish',high:c3.low,low:c1.high,time:c2.time,filled:cp>=c1.high});if(c3.high<c1.low)ims.push({type:'Bearish',high:c1.low,low:c3.high,time:c2.time,filled:cp<=c1.low});}return ims.filter(im=>!im.filled).slice(-5);}
function detectLiquidity(candles,tol=0.0005){const pools=[],seen=new Set(),cp=candles[candles.length-1].close;for(let i=0;i<candles.length-1;i++){for(const type of['EQH','EQL']){const val=type==='EQH'?candles[i].high:candles[i].low,key=`${type}_${val.toFixed(5)}`;if(seen.has(key))continue;const matches=candles.filter(c=>Math.abs((type==='EQH'?c.high:c.low)-val)/val<tol).length;if(matches>=2){seen.add(key);pools.push({type,level:val,strength:matches,time:candles[i].time});}}}return pools.sort((a,b)=>b.strength-a.strength).map(p=>({...p,proximate:Math.abs(p.level-cp)/cp<0.005})).slice(0,6);}

async function runSpideyHTF(symbol,intervals){log('INFO',`[SPIDEY-HTF] ${symbol} [${intervals.join(',')}]`);const results={},tfW={'1W':4,'1D':3,'240':2,'60':1};for(const iv of intervals){const candles=await safeOHLC(symbol,iv,200);if(!candles||candles.length<20){results[iv]={bias:'Neutral',structure:'No data',conviction:0,lastBreak:'None',currentPrice:0};continue;}const{swingHighs:sh,swingLows:sl}=detectSwings(candles,3),st=classifyStructure(sh,sl),br=detectBreaks(candles,sh,sl),zones=detectZones(candles),imbs=detectImbalances(candles),liq=detectLiquidity(candles);results[iv]={bias:st.bias,structure:st.structure,conviction:Math.round(st.conviction*100)/100,lastBreak:br.lastBreak,breakDirection:br.direction,breakLevel:br.breakLevel,isEngineered:br.isEngineered,activeSupply:zones.supply[0]||null,activeDemand:zones.demand[0]||null,allSupply:zones.supply,allDemand:zones.demand,imbalances:imbs,liquidityPools:liq,swingHighs:sh.slice(-3),swingLows:sl.slice(-3),currentPrice:candles[candles.length-1].close};}let wS=0,wT=0;for(const[iv,r]of Object.entries(results)){const w=tfW[iv]||1,s=r.bias==='Bullish'?1:r.bias==='Bearish'?-1:0;wS+=s*w*r.conviction;wT+=w;}const norm=wT>0?wS/wT:0,domBias=norm>0.2?'Bullish':norm<-0.2?'Bearish':'Neutral',domConv=Math.min(Math.abs(norm),1);const allBr=Object.entries(results).filter(([,r])=>r.lastBreak!=='None').map(([iv,r])=>({...r,timeframe:iv,weight:tfW[iv]||1})).sort((a,b)=>b.weight-a.weight);const sigBreak=allBr[0]||null,cp=results[intervals[0]]?.currentPrice||0;let nearDraw=null;for(const[,r]of Object.entries(results)){const liq=r.liquidityPools?.find(p=>p.proximate);if(liq){nearDraw=liq;break;}}log('INFO',`[SPIDEY-HTF] ${symbol} → ${domBias} (${domConv.toFixed(2)})`);return{timeframes:results,dominantBias:domBias,dominantConviction:domConv,significantBreak:sigBreak,nearestDraw:nearDraw,currentPrice:cp};}
async function runSpideyLTF(symbol,intervals){log('INFO',`[SPIDEY-LTF] ${symbol} [${intervals.join(',')}]`);const results={},tfW={'30':3,'15':2,'5':1,'1':0.5};for(const iv of intervals){const candles=await safeOHLC(symbol,iv,150);if(!candles||candles.length<20){results[iv]={bias:'Neutral',structure:'No data',conviction:0,lastBreak:'None',currentPrice:0};continue;}const{swingHighs:sh,swingLows:sl}=detectSwings(candles,2),st=classifyStructure(sh,sl),br=detectBreaks(candles,sh,sl),zones=detectZones(candles),imbs=detectImbalances(candles),liq=detectLiquidity(candles);results[iv]={bias:st.bias,structure:st.structure,conviction:Math.round(st.conviction*100)/100,lastBreak:br.lastBreak,breakDirection:br.direction,breakLevel:br.breakLevel,isEngineered:br.isEngineered,activeSupply:zones.supply[0]||null,activeDemand:zones.demand[0]||null,imbalances:imbs,liquidityPools:liq,swingHighs:sh.slice(-3),swingLows:sl.slice(-3),currentPrice:candles[candles.length-1].close};}let wS=0,wT=0;for(const[iv,r]of Object.entries(results)){const w=tfW[iv]||1,s=r.bias==='Bullish'?1:r.bias==='Bearish'?-1:0;wS+=s*w*r.conviction;wT+=w;}const norm=wT>0?wS/wT:0,domBias=norm>0.15?'Bullish':norm<-0.15?'Bearish':'Neutral',domConv=Math.min(Math.abs(norm),1);const cp=results[intervals[0]]?.currentPrice||0;let nearDraw=null;for(const[,r]of Object.entries(results)){const liq=r.liquidityPools?.find(p=>p.proximate);if(liq){nearDraw=liq;break;}}log('INFO',`[SPIDEY-LTF] ${symbol} → ${domBias} (${domConv.toFixed(2)})`);return{timeframes:results,dominantBias:domBias,dominantConviction:domConv,nearestDraw:nearDraw,currentPrice:cp};}
async function runSpideyMicro(symbol,htfBias){const m15=await safeOHLC(symbol,'15',100),m5=await safeOHLC(symbol,'5',100);if(!m15||!m5)return{entryConfirmed:false,ltfBias:'No data',sweepDetected:false,inInducement:false,ltfBreak:'None',ltfBreakLevel:null,alignedWithHTF:false};const m15S=detectSwings(m15,2),m15St=classifyStructure(m15S.swingHighs,m15S.swingLows),m15B=detectBreaks(m15,m15S.swingHighs,m15S.swingLows),m5S=detectSwings(m5,2),m5B=detectBreaks(m5,m5S.swingHighs,m5S.swingLows);const sweep=m15B.isEngineered||m5B.isEngineered,rH15=m15S.swingHighs.slice(-3),inInd=rH15.filter((h,i)=>rH15.some((h2,j)=>j!==i&&Math.abs(h.level-h2.level)/h.level<0.001)).length>0,aligned=m15St.bias===htfBias,confirmed=aligned&&(m15B.lastBreak==='BOS'||m15B.lastBreak==='CHoCH')&&!inInd;return{entryConfirmed:confirmed,ltfBias:m15St.bias,ltfConviction:m15St.conviction,sweepDetected:sweep,inInducement:inInd,ltfBreak:m15B.lastBreak,ltfBreakLevel:m15B.breakLevel,alignedWithHTF:aligned,m5Break:m5B.lastBreak};}

function cbScore(cb){if(!cb)return 0;let s=0;if(cb.direction===STANCE.HAWKISH)s+=0.20;if(cb.direction===STANCE.DOVISH)s-=0.20;if(cb.stance===STANCE.HAWKISH)s+=0.10;if(cb.stance===STANCE.DOVISH)s-=0.10;if(cb.rateCycle===RATE_CYCLE.HIKING)s+=0.10;if(cb.rateCycle===RATE_CYCLE.CUTTING)s-=0.10;s+=clamp(cb.terminalBias||0,-0.20,0.20);return round2(clamp(s,-0.50,0.50));}
function getCB(ccy){const bl=CENTRAL_BANKS[normalizeSymbol(ccy)];if(!bl)return makeStubCB('Unknown');const o=deepClone(bl);o.score=cbScore(o);return o;}
function getEcon(ccy){const bl=ECONOMIC_BASELINES[normalizeSymbol(ccy)]||makeStubEcon();const e={gdpMomentum:clamp01(bl.gdpMomentum),employment:clamp01(bl.employment),inflationControl:clamp01(bl.inflationControl),fiscalPosition:clamp01(bl.fiscalPosition),politicalStability:clamp01(bl.politicalStability)};e.composite=round2(weightedAvg([{value:e.gdpMomentum,weight:0.26},{value:e.employment,weight:0.22},{value:e.inflationControl,weight:0.20},{value:e.fiscalPosition,weight:0.14},{value:e.politicalStability,weight:0.18}]));return e;}
async function globalMacro(){const c={...DEFAULT_MARKET_CONTEXT};let dxy=c.usdFlow*0.40+c.safeHavenFlow*0.20+c.creditStress*0.18+c.bondStress*0.12+c.realYieldPressure*0.10-c.growthImpulse*0.14-c.equityBreadth*0.12;dxy=round2(clamp(dxy));let risk=-c.geopoliticalStress*0.30-c.creditStress*0.22-c.bondStress*0.12-c.oilShock*0.12-c.recessionRisk*0.18-c.safeHavenFlow*0.20+c.growthImpulse*0.22+c.equityBreadth*0.22+c.aiCapexImpulse*0.08+c.semiconductorCycle*0.08;risk=round2(clamp(risk));return{dxyScore:dxy,dxyBias:dxy>0.10?BIAS.BULLISH:dxy<-0.10?BIAS.BEARISH:BIAS.NEUTRAL,riskScore:risk,riskEnv:risk>0.12?RISK_ENV.RISK_ON:risk<-0.12?RISK_ENV.RISK_OFF:RISK_ENV.NEUTRAL,context:c,confidence:round2(clamp01(average([Math.abs(dxy),Math.abs(risk)])))};}
function detectRegime(g){let r=REGIME.NEUTRAL;if(g.riskEnv===RISK_ENV.RISK_ON&&g.dxyBias===BIAS.BEARISH)r=REGIME.EXPANSION;else if(g.riskEnv===RISK_ENV.RISK_OFF&&g.dxyBias===BIAS.BULLISH)r=REGIME.CRISIS;else if(g.riskEnv===RISK_ENV.RISK_ON)r=REGIME.GROWTH;else if(g.riskEnv===RISK_ENV.RISK_OFF)r=REGIME.CONTRACTION;else r=REGIME.TRANSITION;return{regime:r,confidence:round2(clamp01(Math.abs(g.riskScore)))};}
function detectVol(g){const c=g.context,v=Math.abs(c.geopoliticalStress)*0.35+Math.abs(c.creditStress)*0.22+Math.abs(c.bondStress)*0.18+Math.abs(c.oilShock)*0.12+Math.abs(c.recessionRisk)*0.13;return{volatilityScore:round2(v),level:v>0.60?'High':v>0.30?'Moderate':'Low'};}
function detectLiq(g){const c=g.context;let s=-c.creditStress*0.40-c.bondStress*0.28-c.realYieldPressure*0.12+c.growthImpulse*0.20+c.equityBreadth*0.12;s=round2(clamp(s));return{liquidityScore:s,state:s>0.20?'Loose':s<-0.20?'Tight':'Neutral'};}
function sectorScore(sym,g){const s=normalizeSymbol(sym);let score=0,sector='General';if(SEMI_SYMBOLS.has(s)){sector='Semiconductors';score+=g.context.aiCapexImpulse*0.40+g.context.semiconductorCycle*0.40;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.20;}else if(EQUITY_SYMBOLS.has(s)){sector='Equity';if(g.riskEnv===RISK_ENV.RISK_ON)score+=0.20;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.20;}else if(s==='XAUUSD'||s==='XAUEUR'){sector='Precious Metals';if(g.riskEnv===RISK_ENV.RISK_OFF)score+=0.30;if(g.dxyBias===BIAS.BULLISH)score-=0.18;if(g.dxyBias===BIAS.BEARISH)score+=0.10;}else if(s==='XAGUSD'||s==='XAGEUR'){sector='Silver';if(g.dxyBias===BIAS.BEARISH)score+=0.10;if(g.dxyBias===BIAS.BULLISH)score-=0.10;}else if(/OIL|WTI|BRENT|BCOUSD|USOIL/.test(s)){sector='Energy';score+=g.context.oilShock*0.26+g.context.commodityDemand*0.18;if(g.context.recessionRisk>0)score-=g.context.recessionRisk*0.14;}else if(/NATGAS/.test(s)){sector='Gas';score+=g.context.commodityDemand*0.20;}else if(INDEX_SYMBOLS.has(s)){sector='Index';if(g.riskEnv===RISK_ENV.RISK_ON)score+=0.22;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.22;if(g.dxyBias===BIAS.BEARISH)score+=0.06;if(g.dxyBias===BIAS.BULLISH)score-=0.06;}return{sector,score:round2(clamp(score))};}
function assetAdj(sym,g){const s=normalizeSymbol(sym),ac=inferAssetClass(s),sec=sectorScore(s,g);let score=sec.score;if(ac===ASSET_CLASS.EQUITY){if(g.riskEnv===RISK_ENV.RISK_ON)score+=0.25;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.25;if(g.dxyBias===BIAS.BEARISH)score+=0.10;if(g.dxyBias===BIAS.BULLISH)score-=0.10;}if(ac===ASSET_CLASS.COMMODITY&&s==='XAUUSD'){if(g.riskEnv===RISK_ENV.RISK_OFF)score+=0.24;if(g.dxyBias===BIAS.BULLISH)score-=0.12;if(g.dxyBias===BIAS.BEARISH)score+=0.10;}if(ac===ASSET_CLASS.INDEX){if(g.riskEnv===RISK_ENV.RISK_ON)score+=0.22;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.22;}return{assetClass:ac,score:round2(clamp(score,-0.80,0.80)),sectorInfo:sec};}
function applyAdv(base,sec,vol,liq,regime){let a=base;if(vol.level==='High')a*=0.85;if(vol.level==='Low')a*=1.05;if(liq.state==='Loose')a+=0.05;if(liq.state==='Tight')a-=0.05;if(regime.regime===REGIME.CRISIS)a*=0.85;if(regime.regime===REGIME.EXPANSION)a*=1.05;a+=sec.score*0.20;return round2(clamp(a));}
async function runCoreyMacro(symbol){const parsed=parsePairCore(symbol),{base,quote,assetClass}=parsed,g=await globalMacro(),regime=detectRegime(g),vol=detectVol(g),liq=detectLiq(g);if(assetClass!==ASSET_CLASS.FX){const aa=assetAdj(parsed.symbol,g),adj=applyAdv(aa.score,aa.sectorInfo,vol,liq,regime),mb=scoreToBias(adj),conf=round2(clamp01(Math.abs(adj)));return{symbol:parsed.symbol,assetClass:aa.assetClass,base:{currency:base,cb:makeStubCB(aa.assetClass),econ:makeStubEcon()},quote:{currency:quote,country:safeCountry(quote),cb:getCB(quote),econ:getEcon(quote)},global:g,regime,volatility:vol,liquidity:liq,sector:aa.sectorInfo,macroScore:adj,macroBias:mb,confidence:conf,parsed};}const bCB=getCB(base),qCB=getCB(quote),bE=getEcon(base),qE=getEcon(quote);let ms=(bE.composite-qE.composite)*0.80+(bCB.score-qCB.score)*1.00;if(parsed.quote==='USD'){if(g.dxyBias===BIAS.BULLISH)ms-=0.15;if(g.dxyBias===BIAS.BEARISH)ms+=0.15;}if(parsed.base==='USD'){if(g.dxyBias===BIAS.BULLISH)ms+=0.15;if(g.dxyBias===BIAS.BEARISH)ms-=0.15;}if(g.riskEnv===RISK_ENV.RISK_OFF){if(['JPY','CHF','USD'].includes(base))ms+=0.05;if(['JPY','CHF','USD'].includes(quote))ms-=0.05;}if(g.riskEnv===RISK_ENV.RISK_ON){if(['AUD','NZD','CAD'].includes(base))ms+=0.05;if(['AUD','NZD','CAD'].includes(quote))ms-=0.05;}ms=round2(clamp(ms));const stubSec={sector:'FX',score:0},adj=applyAdv(ms,stubSec,vol,liq,regime),mb=scoreToBias(adj,THRESHOLDS.fxBullish,THRESHOLDS.fxBearish),conf=round2(clamp01(Math.abs(adj)));return{symbol:parsed.symbol,assetClass:ASSET_CLASS.FX,base:{currency:base,country:safeCountry(base),cb:bCB,econ:bE},quote:{currency:quote,country:safeCountry(quote),cb:qCB,econ:qE},global:g,regime,volatility:vol,liquidity:liq,sector:stubSec,macroScore:adj,macroBias:mb,confidence:conf,parsed};}
async function runCoreyTS(symbol){if(!TS_ENABLED)return{available:false,fresh:false,signalBias:'Neutral',strength:0,confidence:0,grade:'Unusable'};const signal=tsGet(symbol);if(!signal)return{available:false,fresh:false,signalBias:'Neutral',strength:0,confidence:0,grade:'Unusable'};const now=Date.now(),grade=tsGrade(signal,now),fresh=grade==='FreshHigh'||grade==='FreshMedium';if(!fresh)return{available:true,fresh:false,signalBias:signal.direction,strength:signal.strength,confidence:signal.confidence,ageMs:now-signal.timestamp,grade};log('INFO',`[COREY-TS] ${symbol} ${signal.direction} grade:${grade}`);return{available:true,fresh,signalBias:signal.direction,signalType:signal.signalType,pattern:signal.pattern,strength:signal.strength,confidence:signal.confidence,ageMs:now-signal.timestamp,grade};}
async function runCorey(symbol){log('INFO',`[COREY] ${symbol}`);const[macro,ts]=await Promise.all([runCoreyMacro(symbol),runCoreyTS(symbol)]);const{macroBias,confidence}=macro,bS={Bullish:1,Neutral:0,Bearish:-1},intScore=bS[macroBias]*confidence;let tsScore=0,tsEffect='Unavailable';if(ts.available&&ts.fresh&&(ts.grade==='FreshHigh'||ts.grade==='FreshMedium')){tsScore=bS[ts.signalBias]*ts.confidence;tsEffect=ts.signalBias===macroBias?'ConfidenceBoost':'ConfidenceReduction';}else if(ts.grade==='Stale'){tsScore=0;tsEffect='Ignored';}const combined=(intScore*0.75)+(tsScore*0.25),combBias=combined>0.15?'Bullish':combined<-0.15?'Bearish':'Neutral',combConf=Math.min(Math.abs(combined),1);log('INFO',`[COREY] ${symbol} → internal:${macroBias} TS:${ts.signalBias} combined:${combBias}`);return{internalMacro:macro,trendSpider:ts,macroBias,combinedBias:combBias,confidence:Math.round(combConf*100)/100,combinedScore:Math.round(combined*100)/100,alignment:ts.available&&ts.fresh&&ts.signalBias===macroBias,contradiction:ts.available&&ts.fresh&&ts.signalBias!=='Neutral'&&ts.signalBias!==macroBias&&macroBias!=='Neutral',tsEffect};}

function buildLevels(spideyHTF,spideyLTF,bias){const htfD=Object.entries(spideyHTF.timeframes)[0]?.[1]||null,ltfD=Object.entries(spideyLTF.timeframes)[0]?.[1]||null;const cp=htfD?.currentPrice||ltfD?.currentPrice||0,pip=cp>10?0.01:cp>1?0.0001:0.01;let ez=null,inv=null,targets=[];if(bias!=='Neutral'){if(bias==='Bullish'){const dz=(ltfD?.activeDemand)||(htfD?.activeDemand);if(dz){ez={high:dz.high,low:dz.low};inv=dz.low-pip*10;}else if(htfD?.swingLows?.length){const sl=htfD.swingLows[htfD.swingLows.length-1];ez={high:sl.level+pip*5,low:sl.level-pip*5};inv=sl.level-pip*15;}const hp=(htfD?.liquidityPools||[]).filter(p=>p.level>cp),lp=(ltfD?.liquidityPools||[]).filter(p=>p.level>cp),hi=(htfD?.imbalances||[]).filter(im=>im.type==='Bearish'&&im.low>cp);targets=[...hp.map(p=>({level:p.level})),...lp.map(p=>({level:p.level})),...hi.map(im=>({level:im.high}))].sort((a,b)=>a.level-b.level).slice(0,3).map((t,i)=>({...t,label:`T${i+1}`}));}else{const sz=(ltfD?.activeSupply)||(htfD?.activeSupply);if(sz){ez={high:sz.high,low:sz.low};inv=sz.high+pip*10;}else if(htfD?.swingHighs?.length){const sh=htfD.swingHighs[htfD.swingHighs.length-1];ez={high:sh.level+pip*5,low:sh.level-pip*5};inv=sh.level+pip*15;}const hp=(htfD?.liquidityPools||[]).filter(p=>p.level<cp),lp=(ltfD?.liquidityPools||[]).filter(p=>p.level<cp),hi=(htfD?.imbalances||[]).filter(im=>im.type==='Bullish'&&im.high<cp);targets=[...hp.map(p=>({level:p.level})),...lp.map(p=>({level:p.level})),...hi.map(im=>({level:im.low}))].sort((a,b)=>b.level-a.level).slice(0,3).map((t,i)=>({...t,label:`T${i+1}`}));}}let rr=null;if(ez&&inv&&targets.length>0){const mid=(ez.high+ez.low)/2,sd=Math.abs(mid-inv),td=Math.abs(targets[0].level-mid);rr=sd>0?Math.round((td/sd)*10)/10:null;}return{entryZone:ez,invalidationLevel:inv,targets,rrRatio:rr,currentPrice:cp};}
function runJane(symbol,spideyHTF,spideyLTF,corey){log('INFO',`[JANE] Synthesising ${symbol}`);const htfB=spideyHTF.dominantBias,htfC=spideyHTF.dominantConviction,ltfB=spideyLTF.dominantBias,ltfC=spideyLTF.dominantConviction,cB=corey.combinedBias,cC=corey.confidence,tsB=corey.trendSpider.signalBias,tsG=corey.trendSpider.grade,tsF=corey.trendSpider.fresh,tsA=corey.trendSpider.available;const bS={Bullish:1,Neutral:0,Bearish:-1},spS=(bS[htfB]*htfC*0.60)+(bS[ltfB]*ltfC*0.40),cS=bS[cB]*cC;let tsAdj=0,tsEff='Unavailable';if(tsA&&tsF&&(tsG==='FreshHigh'||tsG==='FreshMedium')){const ts2=bS[tsB]*corey.trendSpider.confidence,agree=tsB===htfB&&tsB===cB,conf2=tsB!=='Neutral'&&(tsB!==htfB||tsB!==cB);if(agree){tsAdj=ts2>0?0.08:-0.08;tsEff='Boosted';}else if(conf2){tsAdj=ts2>0?-0.06:0.06;tsEff='Reduced';}else{tsAdj=0;tsEff='Neutral';}}else{tsEff=tsA?'Ignored':'Unavailable';}const comp=(spS*0.40)+(cS*0.30)+tsAdj;let fb,conv,cl,dnt=false,dntR=null,cs;const spN=htfB==='Neutral',cN=cB==='Neutral',tsN=tsB==='Neutral'||!tsA||!tsF,ltfConf=ltfB!=='Neutral'&&ltfB!==htfB,sAc=!spN&&!cN&&htfB===cB,sCo=!spN&&!cN&&htfB!==cB,tsCS=!tsN&&tsB!==htfB;if(htfB==='Bullish'&&cB==='Bullish'&&(!tsA||!tsF||tsB==='Bullish')){fb='Bullish';conv=Math.min(comp+0.1,1);cs='Aligned';}else if(htfB==='Bearish'&&cB==='Bearish'&&(!tsA||!tsF||tsB==='Bearish')){fb='Bearish';conv=Math.min(Math.abs(comp)+0.1,1);cs='Aligned';}else if(sAc&&tsN){fb=htfB;conv=Math.abs(comp);cs='Aligned';}else if(sAc&&tsCS&&tsG==='FreshLow'){fb=htfB;conv=Math.abs(comp)*0.85;cs='PartialConflict';}else if(sAc&&tsCS&&tsG==='FreshHigh'){if(htfC>0.65&&cC>0.55){fb=htfB;conv=Math.abs(comp)*0.70;cs='PartialConflict';}else{fb='Neutral';conv=0.2;cs='HardConflict';dnt=true;dntR=`${htfB} structure+macro, strong TS ${tsB} conflict.`;}}else if(sCo&&!tsN&&tsB===htfB){fb=htfB;conv=Math.abs(comp)*0.60;cs='PartialConflict';if(htfC<0.55){dnt=true;dntR=`Structure (${htfB}) vs macro (${cB}) conflict.`;}}else if(sCo&&!tsN&&tsB===cB){fb='Neutral';conv=0.2;cs='HardConflict';dnt=true;dntR=`Structure (${htfB}) and macro+TS (${cB}) in direct conflict.`;}else if(spN&&!cN&&!tsN&&cB===tsB){fb=cB;conv=Math.abs(comp)*0.55;cs='PartialConflict';if(conv<0.35){dnt=true;dntR='Structure neutral. Macro+TS aligned but insufficient confirmation.';}}else if(!spN&&cN&&!tsN&&tsB===htfB){fb=htfB;conv=Math.abs(comp)*0.65;cs='PartialConflict';}else{fb='Neutral';conv=0;cs='HardConflict';dnt=true;dntR='Evidence fragmented. No clean bias.';}if(ltfConf&&!dnt){conv*=0.80;cs=cs==='Aligned'?'PartialConflict':cs;}if(conv<0.25&&!dnt){dnt=true;dntR=`Conviction ${(conv*100).toFixed(0)}% — below minimum threshold.`;}conv=Math.round(Math.min(conv,1)*100)/100;cl=conv>=0.65?'High':conv>=0.40?'Medium':conv>=0.20?'Low':'Abstain';if(dnt)cl=conv<0.10?'Abstain':cl;const levels=buildLevels(spideyHTF,spideyLTF,fb);log('INFO',`[JANE] ${symbol} → ${fb} | ${cl} | conflict:${cs} | TS:${tsEff} | DNT:${dnt}`);return{finalBias:fb,conviction:conv,convictionLabel:cl,compositeScore:Math.round(comp*100)/100,doNotTrade:dnt,doNotTradeReason:dntR,trendSpiderEffect:tsEff,conflictState:cs,ltfAligned:!ltfConf,ltfConflict:ltfConf,entryZone:levels.entryZone,invalidationLevel:levels.invalidationLevel,targets:levels.targets,rrRatio:levels.rrRatio};}

// ============================================================
// RENDERING LAYER v2 — chart-img.com
// POST JSON | native https | 2048x1920 | deep dark theme
// ============================================================
const CHART_IMG_API_KEY=process.env.CHART_IMG_API_KEY||null;

function getCISymbol(symbol){const overrides={XAUUSD:'OANDA:XAUUSD',XAGUSD:'OANDA:XAGUSD',BCOUSD:'OANDA:BCOUSD',USOIL:'OANDA:BCOUSD',NAS100:'OANDA:NAS100USD',US500:'OANDA:SPX500USD',US30:'OANDA:US30USD',EURUSD:'OANDA:EURUSD',GBPUSD:'OANDA:GBPUSD',USDJPY:'OANDA:USDJPY',AUDUSD:'OANDA:AUDUSD',AUDJPY:'OANDA:AUDJPY',GBPJPY:'OANDA:GBPJPY',USDCAD:'OANDA:USDCAD',USDCHF:'OANDA:USDCHF',NZDUSD:'OANDA:NZDUSD',MICRON:'NASDAQ:MU',AMD:'NASDAQ:AMD',NVDA:'NASDAQ:NVDA',ASML:'NASDAQ:ASML'};if(overrides[symbol])return overrides[symbol];if(/^[A-Z]{6}$/.test(symbol))return`OANDA:${symbol}`;return`NASDAQ:${symbol}`;}

const CI_INTERVAL_MAP={'1W':'1W','1D':'1D','240':'4h','60':'1h','30':'30m','15':'15m','5':'5m','1':'1m'};

async function fetchChartImage(symbol,iv){
  if(!CHART_IMG_API_KEY)throw new Error('CHART_IMG_API_KEY not set');
  const ciSym=getCISymbol(symbol);
  const ciInt=CI_INTERVAL_MAP[iv]||'1D';
  const payload=JSON.stringify({
    symbol:ciSym,
    interval:ciInt,
    theme:'dark',
    style:'candle',
    width:CHART_W,
    height:CHART_H,
    timezone:'Australia/Perth',
    overrides:{
      'paneProperties.background':'#0A0F1A',
      'paneProperties.vertGridProperties.color':'#121826',
      'paneProperties.horzGridProperties.color':'#121826',
      'paneProperties.crossHairProperties.color':'#2A3345',
      'paneProperties.vertGridProperties.style':0,
      'paneProperties.horzGridProperties.style':0,
      'scalesProperties.textColor':'#AAB4C3',
      'scalesProperties.lineColor':'#1C2433',
      'symbolWatermarkProperties.transparency':90,
      'mainSeriesProperties.candleStyle.upColor':'#00C896',
      'mainSeriesProperties.candleStyle.downColor':'#FF4D4F',
      'mainSeriesProperties.candleStyle.borderUpColor':'#00C896',
      'mainSeriesProperties.candleStyle.borderDownColor':'#FF4D4F',
      'mainSeriesProperties.candleStyle.wickUpColor':'#00C896',
      'mainSeriesProperties.candleStyle.wickDownColor':'#FF4D4F',
      'mainSeriesProperties.candleStyle.barColorsOnPrevClose':false,
    },
    studies:[],
  });
  return new Promise((resolve,reject)=>{
    const opts={hostname:'api.chart-img.com',path:'/v2/tradingview/advanced-chart',method:'POST',headers:{'x-api-key':CHART_IMG_API_KEY,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'User-Agent':'ATLAS-FX/4.2.0'},timeout:60000};
    const req=https.request(opts,res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{if(res.statusCode!==200){const body=Buffer.concat(chunks).toString();reject(new Error(`chart-img ${res.statusCode}: ${body.slice(0,200)}`));return;}resolve(Buffer.concat(chunks));});});
    req.on('error',reject);req.on('timeout',()=>reject(new Error('chart-img timeout')));req.write(payload);req.end();
  });
}

async function makePlaceholder(sym,tfKey,reason){
  const r2=(reason||'NO DATA').slice(0,60);
  const svg=`<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg"><rect width="${CHART_W}" height="${CHART_H}" fill="#0A0F1A"/><text x="${CHART_W/2}" y="${CHART_H/2-30}" font-family="monospace" font-size="48" fill="#333" text-anchor="middle">${sym} ${tfKey}</text><text x="${CHART_W/2}" y="${CHART_H/2+30}" font-family="monospace" font-size="28" fill="#222" text-anchor="middle">${r2}</text></svg>`;
  return sharp(Buffer.from(svg)).resize(CHART_W,CHART_H).png().toBuffer();
}

async function buildGrid(panels){
  const resized=await Promise.all(panels.map(img=>sharp(img).resize(CHART_W,CHART_H,{fit:'cover',position:'centre'}).png().toBuffer()));
  return sharp({create:{width:CHART_W*2,height:CHART_H*2,channels:4,background:{r:10,g:15,b:26,alpha:1}}})
    .composite([{input:resized[0],left:0,top:0},{input:resized[1],left:CHART_W,top:0},{input:resized[2],left:0,top:CHART_H},{input:resized[3],left:CHART_W,top:CHART_H}])
    .jpeg({quality:95}).toBuffer();
}

async function renderAllPanels(symbol){
  if(!CHART_IMG_API_KEY){log('ERROR','[CHART] CHART_IMG_API_KEY not set');throw new Error('CHART_IMG_API_KEY missing from environment');}
  log('INFO',`[CHART] ${symbol} — fetching 8 panels from chart-img.com`);
  const htfP=[],ltfP=[];let htfFail=0,ltfFail=0;
  for(const iv of HTF_INTERVALS){const key=tfLabel(iv);try{const buf=await fetchChartImage(symbol,iv);htfP.push(buf);log('INFO',`[CHART] ${symbol} ${key} OK (${(buf.length/1024).toFixed(0)}KB)`);}catch(e){log('WARN',`[CHART] ${symbol} ${key} failed: ${e.message}`);htfP.push(await makePlaceholder(symbol,key,e.message));htfFail++;}}
  for(const iv of LTF_INTERVALS){const key=tfLabel(iv);try{const buf=await fetchChartImage(symbol,iv);ltfP.push(buf);log('INFO',`[CHART] ${symbol} ${key} OK (${(buf.length/1024).toFixed(0)}KB)`);}catch(e){log('WARN',`[CHART] ${symbol} ${key} failed: ${e.message}`);ltfP.push(await makePlaceholder(symbol,key,e.message));ltfFail++;}}
  if(htfFail/HTF_INTERVALS.length>ABORT_THRESHOLD||ltfFail/LTF_INTERVALS.length>ABORT_THRESHOLD)throw new Error(`[ABORT] ${symbol} chart render failed — HTF:${htfFail}/4 LTF:${ltfFail}/4`);
  const htfGrid=await buildGrid(htfP),ltfGrid=await buildGrid(ltfP);
  log('INFO',`[CHART] ${symbol} grids built — HTF:${htfFail===0?'OK':`${htfFail} placeholder(s)`} LTF:${ltfFail===0?'OK':`${ltfFail} placeholder(s)`}`);
  return{htfGrid,ltfGrid,htfFail,ltfFail,partial:htfFail>0||ltfFail>0};
}
// ── END RENDERING LAYER v2 ────────────────────────────────────

async function deliverResult(msg,result){

const{symbol,htfGrid,ltfGrid,htfGridName,ltfGridName}=result;

if(!htfGrid||!ltfGrid){
await adminAlert(
msg,
symbol,
'Grid buffer null',
'htfGrid or ltfGrid missing after pipeline'
);
return;
}

const cacheKey=`${msg.id}_${Date.now()}`;

SHARE_CACHE.set(
cacheKey,
{...result,expiresAt:Date.now()+CACHE_TTL_MS}
);

const row=new ActionRowBuilder().addComponents(

new ButtonBuilder()
.setCustomId(`share_${cacheKey}`)
.setLabel('Share to #shared-macros')
.setStyle(ButtonStyle.Primary),

new ButtonBuilder()
.setCustomId(`noshare_${cacheKey}`)
.setLabel('Keep private')
.setStyle(ButtonStyle.Secondary)

);

await msg.channel.send({
content:`📡 **${symbol} — HTF** · Weekly · Daily · 4H · 1H`,
files:[
new AttachmentBuilder(
htfGrid,
{name:htfGridName}
)
]
});

await msg.channel.send({
content:`🔬 **${symbol} — LTF** · 30M · 15M · 5M · 1M`,
files:[
new AttachmentBuilder(
ltfGrid,
{name:ltfGridName}
)
]
});

await msg.channel.send({
content:`⚡ **ATLAS FX — ${symbol}**\nCharts generated · Macro disabled`,
components:[row]
});

}