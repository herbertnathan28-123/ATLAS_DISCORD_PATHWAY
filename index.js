'use strict';
// ============================================================
// ATLAS FX DISCORD BOT — v4.0
// EXECUTION INTERFACE v4 — INSTITUTIONAL GRADE
// Dark Horse Engine integrated — v4.0.1
// ============================================================
process.on('unhandledRejection',(r)=>{console.error('[UNHANDLED]',r);});
process.on('uncaughtException',(e)=>{console.error('[CRASH]',e);});

const{Client,GatewayIntentBits,ActionRowBuilder,ButtonBuilder,ButtonStyle,AttachmentBuilder}=require('discord.js');
const sharp=require('sharp');
const crypto=require('crypto');
const fs=require('fs');
const https=require('https');
const http=require('http');
const{chromium}=require('playwright');

// ── DARK HORSE ENGINE ─────────────────────────────────────────
const{
  dhInit,
  dhSetPipelineTrigger,
  runDarkHorseScan,
  getDHInternalStore,
  getDHCandidate,
  DH_UNIVERSE,
}=require('./darkHorseEngine');

// ── ENV ──────────────────────────────────────────────────────
const TOKEN=process.env.DISCORD_BOT_TOKEN;
const TWELVE_DATA_KEY=process.env.TWELVE_DATA_API_KEY||'';
if(!TOKEN){console.error('[FATAL] Missing DISCORD_BOT_TOKEN');process.exit(1);}
if(!TWELVE_DATA_KEY){console.error('[FATAL] Missing TWELVE_DATA_API_KEY');process.exit(1);}

// ── SYSTEM STATE ─────────────────────────────────────────────
function getSystemState(){
  const raw=process.env.SYSTEM_STATE;
  if(!raw){console.error('[FATAL] Missing SYSTEM_STATE. Must be BUILD_MODE or FULLY_OPERATIONAL.');process.exit(1);}
  if(raw!=='BUILD_MODE'&&raw!=='FULLY_OPERATIONAL'){console.error(`[FATAL] Invalid SYSTEM_STATE="${raw}".`);process.exit(1);}
  return raw;
}
const SYSTEM_STATE=getSystemState();
console.log(`[BOOT] SYSTEM_STATE: ${SYSTEM_STATE}`);
const isBuildMode=()=>SYSTEM_STATE==='BUILD_MODE';
const isFullyOperational=()=>SYSTEM_STATE==='FULLY_OPERATIONAL';

// ── AUTH LAYER ───────────────────────────────────────────────
const ATLAS_INSTANCE_ID=process.env.ATLAS_INSTANCE_ID||null;
const ATLAS_SIGNING_SECRET=process.env.ATLAS_SIGNING_SECRET||null;
const ATLAS_WATERMARK_ENABLED=process.env.ATLAS_WATERMARK_ENABLED==='true';
const ATLAS_SIGNATURE_ENABLED=process.env.ATLAS_SIGNATURE_ENABLED==='true';
const AUTH_AVAILABLE=!!(ATLAS_INSTANCE_ID&&ATLAS_SIGNING_SECRET);
if(AUTH_AVAILABLE){console.log(`[BOOT] AUTH: VERIFIED — instance:${ATLAS_INSTANCE_ID} sig:${ATLAS_SIGNATURE_ENABLED} watermark:${ATLAS_WATERMARK_ENABLED}`);}
else{console.log('[BOOT] AUTH: UNVERIFIED — auth env vars absent. TRADE PERMITTED permanently blocked.');}

function generateSignature(payload){
  if(!AUTH_AVAILABLE||!ATLAS_SIGNATURE_ENABLED)return null;
  return crypto.createHmac('sha256',ATLAS_SIGNING_SECRET).update(payload).digest('hex').slice(0,12).toUpperCase();
}
function buildVerificationLine(symbol,timestamp){
  if(!AUTH_AVAILABLE)return`ATLAS UNVERIFIED • NO AUTH • ${timestamp}`;
  const sig=generateSignature(`${ATLAS_INSTANCE_ID}:${symbol}:${timestamp}`);
  return`ATLAS VERIFIED • ${ATLAS_INSTANCE_ID} • ${timestamp} • SIG ${sig||'DISABLED'}`;
}
const isTradePermitAllowed=()=>AUTH_AVAILABLE&&isFullyOperational();

// ── TRENDSPIDER CONFIG ───────────────────────────────────────
const TS_ENABLED=process.env.ENABLE_TRENDSPIDER!=='false';
const TS_PORT=parseInt(process.env.TRENDSPIDER_PORT||'3001',10);
const TS_TTL_MS=parseInt(process.env.TRENDSPIDER_SIGNAL_TTL_MS||String(4*60*60*1000),10);
const TS_HISTORY_LIMIT=parseInt(process.env.TRENDSPIDER_HISTORY_LIMIT||'10',10);
const TS_PERSIST_PATH=process.env.TRENDSPIDER_PERSIST_PATH||null;

// ── COOKIE SANITISATION ──────────────────────────────────────
const SAMESITE_MAP={strict:'Strict',lax:'Lax',none:'None',no_restriction:'None',unspecified:'Lax'};
const ALLOWED_COOKIE_FIELDS=new Set(['name','value','domain','path','expires','httpOnly','secure','sameSite']);
function sanitiseCookies(raw){
  return raw.map(c=>{
    const out={};
    for(const f of ALLOWED_COOKIE_FIELDS){if(c[f]!==undefined)out[f]=c[f];}
    out.sameSite=SAMESITE_MAP[String(c.sameSite||'').toLowerCase()]||'Lax';
    if(!out.domain)out.domain='.tradingview.com';
    if(!out.path)out.path='/';
    if(!out.expires&&c.expirationDate)out.expires=c.expirationDate;
    return out;
  }).filter(c=>c.domain&&c.domain.includes('tradingview'));
}
let TV_COOKIES=null;
try{
  if(process.env.TV_COOKIES){
    TV_COOKIES=sanitiseCookies(JSON.parse(process.env.TV_COOKIES));
    console.log(`[BOOT] TV_COOKIES: ${TV_COOKIES.length} cookies loaded`);
  }
}catch(e){console.error('[BOOT] TV_COOKIES parse error:',e.message);}
console.log(`[BOOT] ATLAS FX v4.0 starting... auth:${TV_COOKIES?'COOKIE':'GUEST'} trendspider:${TS_ENABLED?'ENABLED':'DISABLED'}`);

// ── DISCORD CLIENT ───────────────────────────────────────────
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
client.once('clientReady',()=>{
  console.log(`[READY] ATLAS FX Bot online as ${client.user.tag}`);

  // ── DARK HORSE ENGINE INIT ──────────────────────────────────
  // Inject TwelveData OHLC source — same data pipeline as Spidey/Corey
  dhInit(safeOHLC);
  // Register pipeline trigger — Dark Horse feeds Corey → Spidey → Jane
  // Jane NEVER receives raw Dark Horse data directly
  dhSetPipelineTrigger(darkHorsePipelineTrigger);
  // Dark Horse Scheduler — every 15 minutes, market hours only (Mon-Fri UTC)
  function isMarketHours(){
    const now=new Date();
    const day=now.getUTCDay(); // 0=Sun, 6=Sat
    if(day===0||day===6)return false; // Weekend — no scanning
    const h=now.getUTCHours();
    // FX/global markets approx Mon 00:00 – Fri 22:00 UTC
    if(day===5&&h>=22)return false; // Friday after 22:00 UTC — markets closed
    return true;
  }
  setInterval(async()=>{
    if(!isMarketHours()){log('INFO','[DH SCHEDULER] Market closed — scan skipped');return;}
    try{await runDarkHorseScan();}
    catch(e){log('ERROR',`[DH SCHEDULER] ${e.message}`);}
  },15*60*1000);
  log('INFO','[BOOT] Dark Horse Engine active — scanning every 15 minutes (market hours Mon-Fri only)');
});

// ── CONSTANTS ────────────────────────────────────────────────
const MAX_RETRIES=2;
const RENDER_TIMEOUT_MS=45000;
const MESSAGE_DEDUPE_TTL_MS=30000;
const SHARED_MACROS_CHANNEL=process.env.SHARED_MACROS_CHANNEL_ID||'1434253776360968293';
const CACHE_TTL_MS=15*60*1000;
const CHART_W=1920;
const CHART_H=1080;
const MIN_CANVAS_AREA=150000;
const ABORT_THRESHOLD=0.25;
const HTF_INTERVALS=['1W','1D','240','60'];
const LTF_INTERVALS=['30','15','5','1'];
const TF_LABELS={'1W':'Weekly','1D':'Daily','240':'4H','60':'1H','30':'30M','15':'15M','5':'5M','1':'1M'};
const tfLabel=iv=>TF_LABELS[iv]||iv;

// ── ENGINE CONSTANTS ─────────────────────────────────────────
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

// ── MATH HELPERS ─────────────────────────────────────────────
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
function inferAssetClass(s){
  if(EQUITY_SYMBOLS.has(s))return ASSET_CLASS.EQUITY;
  if(COMMODITY_SYMBOLS.has(s))return ASSET_CLASS.COMMODITY;
  if(INDEX_SYMBOLS.has(s))return ASSET_CLASS.INDEX;
  if(isFxPair(s))return ASSET_CLASS.FX;
  if(/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s))return ASSET_CLASS.COMMODITY;
  if(/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s))return ASSET_CLASS.INDEX;
  if(/^[A-Z]{1,5}$/.test(s))return ASSET_CLASS.EQUITY;
  return ASSET_CLASS.UNKNOWN;
}
function parsePairCore(symbol){
  const s=normalizeSymbol(symbol);
  if(isFxPair(s))return{symbol:s,base:s.slice(0,3),quote:s.slice(3,6),assetClass:ASSET_CLASS.FX};
  if(['XAUUSD','XAGUSD','BCOUSD'].includes(s))return{symbol:s,base:s.slice(0,3),quote:s.slice(3,6),assetClass:inferAssetClass(s)};
  return{symbol:s,base:s,quote:'USD',assetClass:inferAssetClass(s)};
}
const makeStubCB=label=>({name:label||'Commodity',stance:STANCE.N_A,direction:STANCE.N_A,rateCycle:RATE_CYCLE.N_A,terminalBias:0,inflationSensitivity:0.5,growthSensitivity:0.5,score:0});
const makeStubEcon=()=>({gdpMomentum:0.5,employment:0.5,inflationControl:0.5,fiscalPosition:0.5,politicalStability:0.5,composite:0.5});

// ── PIP ENGINE ───────────────────────────────────────────────
function getPipSize(symbol){
  const s=normalizeSymbol(symbol);
  if(s.includes('JPY'))return{pipSize:0.01,dp:3};
  if(s==='XAGUSD'||s==='XAGEUR')return{pipSize:0.01,dp:3};
  if(s==='XAUUSD'||s==='XAUEUR')return{pipSize:0.10,dp:2};
  if(/BCOUSD|USOIL|WTI|BRENT/.test(s))return{pipSize:0.01,dp:3};
  if(/NATGAS/.test(s))return{pipSize:0.001,dp:4};
  if(INDEX_SYMBOLS.has(s)||/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s))return{pipSize:1.0,dp:1};
  if(EQUITY_SYMBOLS.has(s)||SEMI_SYMBOLS.has(s))return{pipSize:0.01,dp:3};
  if(isFxPair(s))return{pipSize:0.0001,dp:5};
  return{pipSize:0.0001,dp:5};
}
function fmtPrice(n,symbol){
  if(n==null||!Number.isFinite(n))return'N/A';
  if(symbol){const{dp}=getPipSize(symbol);return Number(n).toFixed(dp);}
  if(n>100)return Number(n).toFixed(2);
  if(n>1)return Number(n).toFixed(4);
  return Number(n).toFixed(5);
}

// ── SYMBOL MAPS ──────────────────────────────────────────────
const SYMBOL_OVERRIDES={XAUUSD:'OANDA:XAUUSD',XAGUSD:'OANDA:XAGUSD',BCOUSD:'OANDA:BCOUSD',USOIL:'OANDA:BCOUSD',NAS100:'OANDA:NAS100USD',US500:'OANDA:SPX500USD',US30:'OANDA:US30USD',GER40:'OANDA:DE30EUR',UK100:'OANDA:UK100GBP',NATGAS:'NYMEX:NG1!',MICRON:'NASDAQ:MU',AMD:'NASDAQ:AMD',ASML:'NASDAQ:ASML'};
const TD_SYMBOL_MAP={XAUUSD:'XAU/USD',XAGUSD:'XAG/USD',BCOUSD:'BCO/USD',USOIL:'WTI/USD',NAS100:'NDX',US500:'SPX',US30:'DJI',GER40:'DAX',UK100:'UKX',NATGAS:'NG/USD',EURUSD:'EUR/USD',GBPUSD:'GBP/USD',USDJPY:'USD/JPY',AUDUSD:'AUD/USD',NZDUSD:'NZD/USD',USDCAD:'USD/CAD',USDCHF:'USD/CHF',EURGBP:'EUR/GBP',EURJPY:'EUR/JPY',GBPJPY:'GBP/JPY',AUDJPY:'AUD/JPY',CADJPY:'CAD/JPY',NZDJPY:'NZD/JPY',CHFJPY:'CHF/JPY',EURCHF:'EUR/CHF',EURAUD:'EUR/AUD',EURCAD:'EUR/CAD',GBPAUD:'GBP/AUD',GBPCAD:'GBP/CAD',GBPCHF:'GBP/CHF',AUDCAD:'AUD/CAD',AUDCHF:'AUD/CHF',AUDNZD:'AUD/NZD',CADCHF:'CAD/CHF',NZDCAD:'NZD/CAD',NZDCHF:'NZD/CHF',MICRON:'MU',AMD:'AMD',ASML:'ASML',NVDA:'NVDA'};
const TD_INTERVAL_MAP={'1W':'1week','1D':'1day','240':'4h','60':'1h','30':'30min','15':'15min','5':'5min','1':'1min'};
function getTVSymbol(s){if(SYMBOL_OVERRIDES[s])return SYMBOL_OVERRIDES[s];if(/^[A-Z]{6}$/.test(s))return`OANDA:${s}`;return`NASDAQ:${s}`;}
function getFeedName(s){const f=getTVSymbol(s).split(':')[0];return{OANDA:'OANDA',NASDAQ:'NASDAQ',NYSE:'NYSE',NYMEX:'NYMEX',TVC:'TVC'}[f]||f;}
const log=(level,msg,...a)=>console.log(`[${new Date().toISOString()}] [${level}] ${msg}`,...a);

// ============================================================
// INPUT VALIDATION
// ============================================================
const CRYPTO_KW=new Set(['BTC','ETH','XRP','SOL','DOGE','ADA','BNB','DOT','MATIC','AVAX','LINK','LTC','BCH','XLM','ALGO','ATOM','VET','ICP','BITCOIN','ETHEREUM','CRYPTO','USDT','USDC','SHIB','PEPE']);
const REJECTED_TERMS=new Set(['LH','HL','HH','LL','BUY','SELL','BULLISH','BEARISH','LONG','SHORT','MACRO','UP','DOWN','CALL','PUT','H','L']);
const REJECTED_GENERIC=new Set(['GOLD','SILVER','OIL','BRENT','WTI','GAS','NATGAS','NAS','NASDAQ','SP500','SPX','DOW','DJI','DAX','FTSE','MICRON','MU']);

function validateInput(raw){
  const t=(raw||'').trim();
  if(!t.startsWith('!'))return{valid:false,reason:'no_prefix'};
  const content=t.slice(1).trim();
  const tokens=content.split(/\s+/);
  if(tokens[0]==='ping')return{valid:false,reason:'ops',op:'ping'};
  if(tokens[0]==='stats')return{valid:false,reason:'ops',op:'stats'};
  if(tokens[0]==='errors')return{valid:false,reason:'ops',op:'errors'};
  if(tokens[0]==='sysstate')return{valid:false,reason:'ops',op:'sysstate'};
  if(tokens[0]==='darkhorse')return{valid:false,reason:'ops',op:'darkhorse'};
  if(tokens.length>1)return{valid:false,reason:'extra_tokens'};
  const sym=tokens[0].toUpperCase();
  if(CRYPTO_KW.has(sym)||sym.endsWith('USDT')||sym.endsWith('USDC')||sym.startsWith('BTC'))return{valid:false,reason:'crypto'};
  if(REJECTED_TERMS.has(sym))return{valid:false,reason:'direction_term'};
  if(REJECTED_GENERIC.has(sym))return{valid:false,reason:'generic_name'};
  if(!/^[A-Z0-9]{2,10}$/.test(sym))return{valid:false,reason:'format'};
  const ac=inferAssetClass(sym);
  if(ac===ASSET_CLASS.UNKNOWN&&!isFxPair(sym)&&sym.length!==6)return{valid:false,reason:'unknown_instrument'};
  return{valid:true,symbol:sym};
}
function inputErrorMsg(){
  return'**ATLAS — INPUT ERROR**\n\nInvalid input format.\n\nOnly enter the instrument code.\n\nExample:\n`!XAGUSD`\n\nDo not include structure, direction, or opinion.';
}

// ── STATS + AUDIT ────────────────────────────────────────────
const REQUEST_LOG=[];
const OUTCOME=Object.freeze({BLOCKED:'BLOCKED',FAILED:'FAILED',PARTIAL:'PARTIAL',SUCCESS:'SUCCESS'});
function auditLog(e){REQUEST_LOG.unshift({...e,time:new Date().toISOString()});if(REQUEST_LOG.length>200)REQUEST_LOG.length=200;}
const STATS={total:0,blocked:0,partial:0,failed:0,success:0,symbols:{}};
function trackStats(sym,outcome){
  STATS.total++;
  if(outcome===OUTCOME.BLOCKED)STATS.blocked++;
  else if(outcome===OUTCOME.PARTIAL)STATS.partial++;
  else if(outcome===OUTCOME.FAILED)STATS.failed++;
  else if(outcome===OUTCOME.SUCCESS)STATS.success++;
  if(sym)STATS.symbols[sym]=(STATS.symbols[sym]||0)+1;
}

// ============================================================
// TRENDSPIDER STORE
// ============================================================
const TS_STORE=new Map();
function tsDir(raw){if(!raw)return'Neutral';const v=String(raw).toLowerCase();if(v.includes('bull')||v==='up'||v==='long'||v==='buy')return'Bullish';if(v.includes('bear')||v==='down'||v==='short'||v==='sell')return'Bearish';return'Neutral';}
function tsSigType(raw){if(!raw)return'Unknown';const v=String(raw).toLowerCase();if(v.includes('break'))return'Breakout';if(v.includes('revers'))return'Reversal';if(v.includes('continu'))return'Continuation';if(v.includes('warn'))return'Warning';if(v.includes('pattern'))return'Pattern';return'Scanner';}
function tsNorm(raw,rt){
  const sym=(raw.symbol||raw.ticker||raw.pair||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const dir=tsDir(raw.direction||raw.trend||raw.signal||''),stype=tsSigType(raw.signal_type||raw.signal||raw.strategy||raw.scanner||'');
  let str=parseFloat(raw.strength||raw.confidence||0.5),conf=parseFloat(raw.confidence||raw.strength||0.5);
  str=Math.max(0,Math.min(1,isNaN(str)?0.5:str));conf=Math.max(0,Math.min(1,isNaN(conf)?0.5:conf));
  const ts=raw.timestamp?(typeof raw.timestamp==='number'?raw.timestamp*(raw.timestamp<1e12?1000:1):Date.parse(raw.timestamp)):rt;
  return{symbol:sym,timeframe:raw.timeframe||null,signalType:stype,direction:dir,pattern:raw.pattern||null,strategy:raw.strategy||null,scanner:raw.scanner||null,strength:str,confidence:conf,price:raw.price?parseFloat(raw.price):null,timestamp:ts,notes:raw.notes||null,raw};
}
function tsGrade(signal,now){const age=now-signal.timestamp;if(age>TS_TTL_MS)return'Stale';if(!signal.direction||signal.direction==='Neutral')return'Unusable';if(age>TS_TTL_MS*0.75)return'FreshLow';if(signal.confidence>=0.70&&age<TS_TTL_MS*0.25)return'FreshHigh';if(signal.confidence>=0.45)return'FreshMedium';return'FreshLow';}
function tsStore(signal){const sym=signal.symbol;if(!TS_STORE.has(sym))TS_STORE.set(sym,{latest:null,history:[]});const e=TS_STORE.get(sym);e.latest=signal;e.history.unshift(signal);if(e.history.length>TS_HISTORY_LIMIT)e.history.length=TS_HISTORY_LIMIT;if(TS_PERSIST_PATH)tsPersist();log('INFO',`[TS STORE] ${sym} ${signal.direction} ${signal.signalType}`);}
function tsGet(sym){const e=TS_STORE.get(sym);return e?e.latest:null;}
function tsPersist(){try{const o={};for(const[k,v]of TS_STORE)o[k]=v;fs.writeFileSync(TS_PERSIST_PATH,JSON.stringify(o),'utf8');}catch(e){log('WARN',`[TS PERSIST] ${e.message}`);}}
function tsLoadPersisted(){
  if(!TS_PERSIST_PATH)return;
  try{if(!fs.existsSync(TS_PERSIST_PATH))return;const data=JSON.parse(fs.readFileSync(TS_PERSIST_PATH,'utf8'));const now=Date.now();let loaded=0;for(const[sym,e]of Object.entries(data)){if(e.latest&&(now-e.latest.timestamp)<TS_TTL_MS){TS_STORE.set(sym,e);loaded++;}}log('INFO',`[TS LOAD] ${loaded} symbols loaded`);}
  catch(e){log('WARN',`[TS LOAD] ${e.message}`);}
}
setInterval(()=>{const now=Date.now();let rm=0;for(const[sym,e]of TS_STORE){if(e.latest&&(now-e.latest.timestamp)>TS_TTL_MS*2){TS_STORE.delete(sym);rm++;}}if(rm>0)log('INFO',`[TS CLEANUP] Removed ${rm}`);},30*60*1000);

// ── TRENDSPIDER WEBHOOK SERVER ────────────────────────────────
function startTSServer(){
  if(!TS_ENABLED){log('INFO','[TS SERVER] Disabled');return;}
  const srv=http.createServer((req,res)=>{
    if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,service:'ATLAS FX v4.0',signals:TS_STORE.size}));return;}
    if(req.method==='POST'&&req.url==='/trendspider'){
      let body='';req.on('data',c=>{body+=c;});
      req.on('end',()=>{
        const rt=Date.now();
        try{const raw=JSON.parse(body);const rawSym=raw.symbol||raw.ticker||raw.pair||'';if(!rawSym){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'Missing symbol'}));return;}const sig=tsNorm(raw,rt);if(!sig.symbol){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'Could not resolve symbol'}));return;}const grade=tsGrade(sig,rt);if(grade!=='Unusable')tsStore(sig);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,symbol:sig.symbol,stored:grade!=='Unusable',status:grade}));}
        catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'Invalid JSON'}));}
      });req.on('error',()=>{res.writeHead(500);res.end();});return;
    }
    res.writeHead(404);res.end();
  });
  srv.on('error',e=>log('ERROR',`[TS SERVER] ${e.message}`));
  srv.listen(TS_PORT,()=>log('INFO',`[TS SERVER] Listening on port ${TS_PORT}`));
}

// ============================================================
// OHLC — TWELVEDATA
// ============================================================
function fetchOHLC(symbol,resolution,count=200){
  return new Promise((resolve,reject)=>{
    const tdSym=encodeURIComponent(TD_SYMBOL_MAP[symbol]||symbol),tdInt=TD_INTERVAL_MAP[resolution]||'1day';
    const opts={hostname:'api.twelvedata.com',path:`/time_series?symbol=${tdSym}&interval=${tdInt}&outputsize=${count}&apikey=${TWELVE_DATA_KEY}&format=JSON`,method:'GET',headers:{'User-Agent':'ATLAS-FX/4.0'},timeout:15000};
    const req=https.request(opts,r=>{let data='';r.on('data',c=>{data+=c;});r.on('end',()=>{try{const p=JSON.parse(data);if(p.status==='error'||!p.values||!Array.isArray(p.values)){reject(new Error(`TwelveData: ${p.message||'unknown'}`));return;}resolve(p.values.slice().reverse().map(v=>({time:Math.floor(new Date(v.datetime).getTime()/1000),open:parseFloat(v.open),high:parseFloat(v.high),low:parseFloat(v.low),close:parseFloat(v.close),volume:v.volume?parseFloat(v.volume):0})));}catch(e){reject(new Error(`TwelveData parse: ${e.message}`));}});});
    req.on('error',reject);req.on('timeout',()=>reject(new Error('TwelveData timeout')));req.end();
  });
}
async function safeOHLC(sym,res,count=200){try{return await fetchOHLC(sym,res,count);}catch(e){log('WARN',`[OHLC] ${sym} ${res}: ${e.message}`);return null;}}

// ============================================================
// SPIDEY — STRUCTURE ENGINE
// ============================================================
function detectSwings(candles,lb=3){
  const sh=[],sl=[];
  for(let i=lb;i<candles.length-lb;i++){const c=candles[i];let isH=true,isL=true;for(let j=i-lb;j<=i+lb;j++){if(j===i)continue;if(candles[j].high>=c.high)isH=false;if(candles[j].low<=c.low)isL=false;}if(isH)sh.push({index:i,level:c.high,time:c.time});if(isL)sl.push({index:i,level:c.low,time:c.time});}
  return{swingHighs:sh,swingLows:sl};
}
function classifyStructure(sh,sl,lb=4){
  const rh=sh.slice(-lb),rl=sl.slice(-lb);
  if(rh.length<2||rl.length<2)return{bias:'Neutral',structure:'Insufficient data',conviction:0.3};
  const hp=[],lp=[];
  for(let i=1;i<rh.length;i++)hp.push(rh[i].level>rh[i-1].level?'HH':'LH');
  for(let i=1;i<rl.length;i++)lp.push(rl[i].level>rl[i-1].level?'HL':'LL');
  const hhC=hp.filter(x=>x==='HH').length,lhC=hp.filter(x=>x==='LH').length,hlC=lp.filter(x=>x==='HL').length,llC=lp.filter(x=>x==='LL').length,total=hp.length+lp.length,bull=(hhC+hlC)/total,bear=(lhC+llC)/total;
  if(bull>=0.75)return{bias:'Bullish',structure:'Trending',conviction:bull};
  if(bear>=0.75)return{bias:'Bearish',structure:'Trending',conviction:bear};
  if(bull>=0.55)return{bias:'Bullish',structure:'Transition',conviction:bull*0.8};
  if(bear>=0.55)return{bias:'Bearish',structure:'Transition',conviction:bear*0.8};
  return{bias:'Neutral',structure:'Range',conviction:0.3};
}
function detectBreaks(candles,sh,sl){
  if(candles.length<5||!sh.length||!sl.length)return{lastBreak:'None',direction:null,breakLevel:null,isEngineered:false};
  const last=candles[candles.length-1],p20=candles.slice(-20),lSH=sh[sh.length-1],lSL=sl[sl.length-1],p5=p20.slice(-5),rH=Math.max(...p5.map(c=>c.high)),rL=Math.min(...p5.map(c=>c.low));
  const bBOS=last.close>lSH.level,bearBOS=last.close<lSL.level,bCHoCH=last.close>rH&&!bBOS,bearCHoCH=last.close<rL&&!bearBOS,wA=p20.some(c=>c.high>lSH.level&&c.close<=lSH.level),wB=p20.some(c=>c.low<lSL.level&&c.close>=lSL.level),isEng=wA||wB;
  if(bBOS)return{lastBreak:'BOS',direction:'Bullish',breakLevel:lSH.level,isEngineered:false};
  if(bearBOS)return{lastBreak:'BOS',direction:'Bearish',breakLevel:lSL.level,isEngineered:false};
  if(bCHoCH)return{lastBreak:'CHoCH',direction:'Bullish',breakLevel:rH,isEngineered:isEng};
  if(bearCHoCH)return{lastBreak:'CHoCH',direction:'Bearish',breakLevel:rL,isEngineered:isEng};
  return{lastBreak:'None',direction:null,breakLevel:null,isEngineered:false};
}
function detectZones(candles){
  const zones={supply:[],demand:[]};if(candles.length<10)return zones;
  const cp=candles[candles.length-1].close;
  for(let i=3;i<candles.length-3;i++){const base=candles[i],imp=candles.slice(i+1,i+4);const bearI=imp.every(c=>c.close<c.open)&&imp.reduce((s,c)=>s+(c.open-c.close),0)>(base.high-base.low)*1.5;const bullI=imp.every(c=>c.close>c.open)&&imp.reduce((s,c)=>s+(c.close-c.open),0)>(base.high-base.low)*1.5;if(bearI&&base.close>base.open)zones.supply.push({high:base.high,low:Math.min(base.open,base.close),time:base.time});if(bullI&&base.close<base.open)zones.demand.push({high:Math.max(base.open,base.close),low:base.low,time:base.time});}
  zones.supply=zones.supply.filter(z=>z.low>cp).sort((a,b)=>a.low-b.low).slice(0,3);
  zones.demand=zones.demand.filter(z=>z.high<cp).sort((a,b)=>b.high-a.high).slice(0,3);
  return zones;
}
function detectImbalances(candles){
  const ims=[],cp=candles[candles.length-1].close;
  for(let i=0;i<candles.length-2;i++){const c1=candles[i],c3=candles[i+2],c2=candles[i+1];if(c3.low>c1.high)ims.push({type:'Bullish',high:c3.low,low:c1.high,time:c2.time,filled:cp>=c1.high});if(c3.high<c1.low)ims.push({type:'Bearish',high:c1.low,low:c3.high,time:c2.time,filled:cp<=c1.low});}
  return ims.filter(im=>!im.filled).slice(-5);
}
function detectLiquidity(candles,tol=0.0005){
  const pools=[],seen=new Set(),cp=candles[candles.length-1].close;
  for(let i=0;i<candles.length-1;i++){for(const type of['EQH','EQL']){const val=type==='EQH'?candles[i].high:candles[i].low,key=`${type}_${val.toFixed(5)}`;if(seen.has(key))continue;const matches=candles.filter(c=>Math.abs((type==='EQH'?c.high:c.low)-val)/val<tol).length;if(matches>=2){seen.add(key);pools.push({type,level:val,strength:matches,time:candles[i].time});}}}
  return pools.sort((a,b)=>b.strength-a.strength).map(p=>({...p,proximate:Math.abs(p.level-cp)/cp<0.005})).slice(0,6);
}

async function runSpideyHTF(symbol,intervals){
  log('INFO',`[SPIDEY-HTF] ${symbol} [${intervals.join(',')}]`);
  const results={},tfW={'1W':4,'1D':3,'240':2,'60':1};
  for(const iv of intervals){
    const candles=await safeOHLC(symbol,iv,200);
    if(!candles||candles.length<20){results[iv]={bias:'Neutral',structure:'No data',conviction:0,lastBreak:'None',currentPrice:0};continue;}
    const{swingHighs:sh,swingLows:sl}=detectSwings(candles,3),st=classifyStructure(sh,sl),br=detectBreaks(candles,sh,sl),zones=detectZones(candles),imbs=detectImbalances(candles),liq=detectLiquidity(candles);
    results[iv]={bias:st.bias,structure:st.structure,conviction:Math.round(st.conviction*100)/100,lastBreak:br.lastBreak,breakDirection:br.direction,breakLevel:br.breakLevel,isEngineered:br.isEngineered,activeSupply:zones.supply[0]||null,activeDemand:zones.demand[0]||null,allSupply:zones.supply,allDemand:zones.demand,imbalances:imbs,liquidityPools:liq,swingHighs:sh.slice(-3),swingLows:sl.slice(-3),currentPrice:candles[candles.length-1].close};
  }
  let wS=0,wT=0;for(const[iv,r]of Object.entries(results)){const w=tfW[iv]||1,s=r.bias==='Bullish'?1:r.bias==='Bearish'?-1:0;wS+=s*w*r.conviction;wT+=w;}
  const norm=wT>0?wS/wT:0,domBias=norm>0.2?'Bullish':norm<-0.2?'Bearish':'Neutral',domConv=Math.min(Math.abs(norm),1);
  const allBr=Object.entries(results).filter(([,r])=>r.lastBreak!=='None').map(([iv,r])=>({...r,timeframe:iv,weight:tfW[iv]||1})).sort((a,b)=>b.weight-a.weight);
  const sigBreak=allBr[0]||null,cp=results[intervals[0]]?.currentPrice||0;
  let nearDraw=null;for(const[,r]of Object.entries(results)){const liq=r.liquidityPools?.find(p=>p.proximate);if(liq){nearDraw=liq;break;}}
  log('INFO',`[SPIDEY-HTF] ${symbol} → ${domBias} (${domConv.toFixed(2)})`);
  return{timeframes:results,dominantBias:domBias,dominantConviction:domConv,significantBreak:sigBreak,nearestDraw:nearDraw,currentPrice:cp};
}

async function runSpideyLTF(symbol,intervals){
  log('INFO',`[SPIDEY-LTF] ${symbol} [${intervals.join(',')}]`);
  const results={},tfW={'30':3,'15':2,'5':1,'1':0.5};
  for(const iv of intervals){
    const candles=await safeOHLC(symbol,iv,150);
    if(!candles||candles.length<20){results[iv]={bias:'Neutral',structure:'No data',conviction:0,lastBreak:'None',currentPrice:0};continue;}
    const{swingHighs:sh,swingLows:sl}=detectSwings(candles,2),st=classifyStructure(sh,sl),br=detectBreaks(candles,sh,sl),zones=detectZones(candles),imbs=detectImbalances(candles),liq=detectLiquidity(candles);
    results[iv]={bias:st.bias,structure:st.structure,conviction:Math.round(st.conviction*100)/100,lastBreak:br.lastBreak,breakDirection:br.direction,breakLevel:br.breakLevel,isEngineered:br.isEngineered,activeSupply:zones.supply[0]||null,activeDemand:zones.demand[0]||null,imbalances:imbs,liquidityPools:liq,swingHighs:sh.slice(-3),swingLows:sl.slice(-3),currentPrice:candles[candles.length-1].close};
  }
  let wS=0,wT=0;for(const[iv,r]of Object.entries(results)){const w=tfW[iv]||1,s=r.bias==='Bullish'?1:r.bias==='Bearish'?-1:0;wS+=s*w*r.conviction;wT+=w;}
  const norm=wT>0?wS/wT:0,domBias=norm>0.15?'Bullish':norm<-0.15?'Bearish':'Neutral',domConv=Math.min(Math.abs(norm),1);
  const cp=results[intervals[0]]?.currentPrice||0;
  let nearDraw=null;for(const[,r]of Object.entries(results)){const liq=r.liquidityPools?.find(p=>p.proximate);if(liq){nearDraw=liq;break;}}
  log('INFO',`[SPIDEY-LTF] ${symbol} → ${domBias} (${domConv.toFixed(2)})`);
  return{timeframes:results,dominantBias:domBias,dominantConviction:domConv,nearestDraw:nearDraw,currentPrice:cp};
}

async function runSpideyMicro(symbol,htfBias){
  const m15=await safeOHLC(symbol,'15',100),m5=await safeOHLC(symbol,'5',100);
  if(!m15||!m5)return{entryConfirmed:false,ltfBias:'No data',sweepDetected:false,inInducement:false,ltfBreak:'None',ltfBreakLevel:null,alignedWithHTF:false};
  const m15S=detectSwings(m15,2),m15St=classifyStructure(m15S.swingHighs,m15S.swingLows),m15B=detectBreaks(m15,m15S.swingHighs,m15S.swingLows),m5S=detectSwings(m5,2),m5B=detectBreaks(m5,m5S.swingHighs,m5S.swingLows);
  const sweep=m15B.isEngineered||m5B.isEngineered,rH15=m15S.swingHighs.slice(-3),inInd=rH15.filter((h,i)=>rH15.some((h2,j)=>j!==i&&Math.abs(h.level-h2.level)/h.level<0.001)).length>0,aligned=m15St.bias===htfBias,confirmed=aligned&&(m15B.lastBreak==='BOS'||m15B.lastBreak==='CHoCH')&&!inInd;
  return{entryConfirmed:confirmed,ltfBias:m15St.bias,ltfConviction:m15St.conviction,sweepDetected:sweep,inInducement:inInd,ltfBreak:m15B.lastBreak,ltfBreakLevel:m15B.breakLevel,alignedWithHTF:aligned,m5Break:m5B.lastBreak};
}

// ============================================================
// COREY — MACRO ENGINE
// ============================================================
function cbScore(cb){
  if(!cb)return 0;let s=0;
  if(cb.direction===STANCE.HAWKISH)s+=0.20;if(cb.direction===STANCE.DOVISH)s-=0.20;
  if(cb.stance===STANCE.HAWKISH)s+=0.10;if(cb.stance===STANCE.DOVISH)s-=0.10;
  if(cb.rateCycle===RATE_CYCLE.HIKING)s+=0.10;if(cb.rateCycle===RATE_CYCLE.CUTTING)s-=0.10;
  s+=clamp(cb.terminalBias||0,-0.20,0.20);return round2(clamp(s,-0.50,0.50));
}
function getCB(ccy){const bl=CENTRAL_BANKS[normalizeSymbol(ccy)];if(!bl)return makeStubCB('Unknown');const o=deepClone(bl);o.score=cbScore(o);return o;}
function getEcon(ccy){const bl=ECONOMIC_BASELINES[normalizeSymbol(ccy)]||makeStubEcon();const e={gdpMomentum:clamp01(bl.gdpMomentum),employment:clamp01(bl.employment),inflationControl:clamp01(bl.inflationControl),fiscalPosition:clamp01(bl.fiscalPosition),politicalStability:clamp01(bl.politicalStability)};e.composite=round2(weightedAvg([{value:e.gdpMomentum,weight:0.26},{value:e.employment,weight:0.22},{value:e.inflationControl,weight:0.20},{value:e.fiscalPosition,weight:0.14},{value:e.politicalStability,weight:0.18}]));return e;}

async function globalMacro(){
  const c={...DEFAULT_MARKET_CONTEXT};
  let dxy=c.usdFlow*0.40+c.safeHavenFlow*0.20+c.creditStress*0.18+c.bondStress*0.12+c.realYieldPressure*0.10-c.growthImpulse*0.14-c.equityBreadth*0.12;
  dxy=round2(clamp(dxy));
  let risk=-c.geopoliticalStress*0.30-c.creditStress*0.22-c.bondStress*0.12-c.oilShock*0.12-c.recessionRisk*0.18-c.safeHavenFlow*0.20+c.growthImpulse*0.22+c.equityBreadth*0.22+c.aiCapexImpulse*0.08+c.semiconductorCycle*0.08;
  risk=round2(clamp(risk));
  return{dxyScore:dxy,dxyBias:dxy>0.10?BIAS.BULLISH:dxy<-0.10?BIAS.BEARISH:BIAS.NEUTRAL,riskScore:risk,riskEnv:risk>0.12?RISK_ENV.RISK_ON:risk<-0.12?RISK_ENV.RISK_OFF:RISK_ENV.NEUTRAL,context:c,confidence:round2(clamp01(average([Math.abs(dxy),Math.abs(risk)])))};
}
function detectRegime(g){let r=REGIME.NEUTRAL;if(g.riskEnv===RISK_ENV.RISK_ON&&g.dxyBias===BIAS.BEARISH)r=REGIME.EXPANSION;else if(g.riskEnv===RISK_ENV.RISK_OFF&&g.dxyBias===BIAS.BULLISH)r=REGIME.CRISIS;else if(g.riskEnv===RISK_ENV.RISK_ON)r=REGIME.GROWTH;else if(g.riskEnv===RISK_ENV.RISK_OFF)r=REGIME.CONTRACTION;else r=REGIME.TRANSITION;return{regime:r,confidence:round2(clamp01(Math.abs(g.riskScore)))};}
function detectVol(g){const c=g.context,v=Math.abs(c.geopoliticalStress)*0.35+Math.abs(c.creditStress)*0.22+Math.abs(c.bondStress)*0.18+Math.abs(c.oilShock)*0.12+Math.abs(c.recessionRisk)*0.13;return{volatilityScore:round2(v),level:v>0.60?'High':v>0.30?'Moderate':'Low'};}
function detectLiq(g){const c=g.context;let s=-c.creditStress*0.40-c.bondStress*0.28-c.realYieldPressure*0.12+c.growthImpulse*0.20+c.equityBreadth*0.12;s=round2(clamp(s));return{liquidityScore:s,state:s>0.20?'Loose':s<-0.20?'Tight':'Neutral'};}

function sectorScore(sym,g){
  const s=normalizeSymbol(sym);let score=0,sector='General';
  if(SEMI_SYMBOLS.has(s)){sector='Semiconductors';score+=g.context.aiCapexImpulse*0.40+g.context.semiconductorCycle*0.40;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.20;}
  else if(EQUITY_SYMBOLS.has(s)){sector='Equity';if(g.riskEnv===RISK_ENV.RISK_ON)score+=0.20;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.20;}
  else if(s==='XAUUSD'||s==='XAUEUR'){sector='Precious Metals';if(g.riskEnv===RISK_ENV.RISK_OFF)score+=0.30;if(g.dxyBias===BIAS.BULLISH)score-=0.18;if(g.dxyBias===BIAS.BEARISH)score+=0.10;}
  else if(s==='XAGUSD'||s==='XAGEUR'){sector='Silver';if(g.dxyBias===BIAS.BEARISH)score+=0.10;if(g.dxyBias===BIAS.BULLISH)score-=0.10;}
  else if(/OIL|WTI|BRENT|BCOUSD|USOIL/.test(s)){sector='Energy';score+=g.context.oilShock*0.26+g.context.commodityDemand*0.18;if(g.context.recessionRisk>0)score-=g.context.recessionRisk*0.14;}
  else if(/NATGAS/.test(s)){sector='Gas';score+=g.context.commodityDemand*0.20;}
  else if(INDEX_SYMBOLS.has(s)){sector='Index';if(g.riskEnv===RISK_ENV.RISK_ON)score+=0.22;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.22;if(g.dxyBias===BIAS.BEARISH)score+=0.06;if(g.dxyBias===BIAS.BULLISH)score-=0.06;}
  return{sector,score:round2(clamp(score))};
}
function assetAdj(sym,g){
  const s=normalizeSymbol(sym),ac=inferAssetClass(s),sec=sectorScore(s,g);let score=sec.score;
  if(ac===ASSET_CLASS.EQUITY){if(g.riskEnv===RISK_ENV.RISK_ON)score+=0.25;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.25;if(g.dxyBias===BIAS.BEARISH)score+=0.10;if(g.dxyBias===BIAS.BULLISH)score-=0.10;}
  if(ac===ASSET_CLASS.COMMODITY&&s==='XAUUSD'){if(g.riskEnv===RISK_ENV.RISK_OFF)score+=0.24;if(g.dxyBias===BIAS.BULLISH)score-=0.12;if(g.dxyBias===BIAS.BEARISH)score+=0.10;}
  if(ac===ASSET_CLASS.INDEX){if(g.riskEnv===RISK_ENV.RISK_ON)score+=0.22;if(g.riskEnv===RISK_ENV.RISK_OFF)score-=0.22;}
  return{assetClass:ac,score:round2(clamp(score,-0.80,0.80)),sectorInfo:sec};
}
function applyAdv(base,sec,vol,liq,regime){
  let a=base;if(vol.level==='High')a*=0.85;if(vol.level==='Low')a*=1.05;if(liq.state==='Loose')a+=0.05;if(liq.state==='Tight')a-=0.05;if(regime.regime===REGIME.CRISIS)a*=0.85;if(regime.regime===REGIME.EXPANSION)a*=1.05;a+=sec.score*0.20;return round2(clamp(a));
}

async function runCoreyMacro(symbol){
  const parsed=parsePairCore(symbol),{base,quote,assetClass}=parsed,g=await globalMacro(),regime=detectRegime(g),vol=detectVol(g),liq=detectLiq(g);
  if(assetClass!==ASSET_CLASS.FX){const aa=assetAdj(parsed.symbol,g),adj=applyAdv(aa.score,aa.sectorInfo,vol,liq,regime),mb=scoreToBias(adj),conf=round2(clamp01(Math.abs(adj)));return{symbol:parsed.symbol,assetClass:aa.assetClass,base:{currency:base,cb:makeStubCB(aa.assetClass),econ:makeStubEcon()},quote:{currency:quote,country:safeCountry(quote),cb:getCB(quote),econ:getEcon(quote)},global:g,regime,volatility:vol,liquidity:liq,sector:aa.sectorInfo,macroScore:adj,macroBias:mb,confidence:conf,parsed};}
  const bCB=getCB(base),qCB=getCB(quote),bE=getEcon(base),qE=getEcon(quote);
  let ms=(bE.composite-qE.composite)*0.80+(bCB.score-qCB.score)*1.00;
  if(parsed.quote==='USD'){if(g.dxyBias===BIAS.BULLISH)ms-=0.15;if(g.dxyBias===BIAS.BEARISH)ms+=0.15;}
  if(parsed.base==='USD'){if(g.dxyBias===BIAS.BULLISH)ms+=0.15;if(g.dxyBias===BIAS.BEARISH)ms-=0.15;}
  if(g.riskEnv===RISK_ENV.RISK_OFF){if(['JPY','CHF','USD'].includes(base))ms+=0.05;if(['JPY','CHF','USD'].includes(quote))ms-=0.05;}
  if(g.riskEnv===RISK_ENV.RISK_ON){if(['AUD','NZD','CAD'].includes(base))ms+=0.05;if(['AUD','NZD','CAD'].includes(quote))ms-=0.05;}
  ms=round2(clamp(ms));const stubSec={sector:'FX',score:0},adj=applyAdv(ms,stubSec,vol,liq,regime),mb=scoreToBias(adj,THRESHOLDS.fxBullish,THRESHOLDS.fxBearish),conf=round2(clamp01(Math.abs(adj)));
  return{symbol:parsed.symbol,assetClass:ASSET_CLASS.FX,base:{currency:base,country:safeCountry(base),cb:bCB,econ:bE},quote:{currency:quote,country:safeCountry(quote),cb:qCB,econ:qE},global:g,regime,volatility:vol,liquidity:liq,sector:stubSec,macroScore:adj,macroBias:mb,confidence:conf,parsed};
}

async function runCoreyTS(symbol){
  if(!TS_ENABLED)return{available:false,fresh:false,signalBias:'Neutral',strength:0,confidence:0,grade:'Unusable'};
  const signal=tsGet(symbol);if(!signal)return{available:false,fresh:false,signalBias:'Neutral',strength:0,confidence:0,grade:'Unusable'};
  const now=Date.now(),grade=tsGrade(signal,now),fresh=grade==='FreshHigh'||grade==='FreshMedium';
  if(!fresh)return{available:true,fresh:false,signalBias:signal.direction,strength:signal.strength,confidence:signal.confidence,ageMs:now-signal.timestamp,grade};
  log('INFO',`[COREY-TS] ${symbol} ${signal.direction} grade:${grade}`);
  return{available:true,fresh,signalBias:signal.direction,signalType:signal.signalType,pattern:signal.pattern,strength:signal.strength,confidence:signal.confidence,ageMs:now-signal.timestamp,grade};
}

async function runCorey(symbol){
  log('INFO',`[COREY] ${symbol}`);
  const[macro,ts]=await Promise.all([runCoreyMacro(symbol),runCoreyTS(symbol)]);
  const{macroBias,confidence}=macro,bS={Bullish:1,Neutral:0,Bearish:-1},intScore=bS[macroBias]*confidence;
  let tsScore=0,tsEffect='Unavailable';
  if(ts.available&&ts.fresh&&(ts.grade==='FreshHigh'||ts.grade==='FreshMedium')){tsScore=bS[ts.signalBias]*ts.confidence;tsEffect=ts.signalBias===macroBias?'ConfidenceBoost':'ConfidenceReduction';}else if(ts.grade==='Stale'){tsScore=0;tsEffect='Ignored';}
  const combined=(intScore*0.75)+(tsScore*0.25),combBias=combined>0.15?'Bullish':combined<-0.15?'Bearish':'Neutral',combConf=Math.min(Math.abs(combined),1);
  log('INFO',`[COREY] ${symbol} → internal:${macroBias} TS:${ts.signalBias} combined:${combBias}`);
  return{internalMacro:macro,trendSpider:ts,macroBias,combinedBias:combBias,confidence:Math.round(combConf*100)/100,combinedScore:Math.round(combined*100)/100,alignment:ts.available&&ts.fresh&&ts.signalBias===macroBias,contradiction:ts.available&&ts.fresh&&ts.signalBias!=='Neutral'&&ts.signalBias!==macroBias&&macroBias!=='Neutral',tsEffect};
}

// ============================================================
// JANE — ARBITRATION ENGINE
// PROTECTION: Jane only receives symbol + Corey output + Spidey output.
// Jane NEVER receives Dark Horse data directly.
// ============================================================
function buildLevels(spideyHTF,spideyLTF,bias){
  const htfD=Object.entries(spideyHTF.timeframes)[0]?.[1]||null,ltfD=Object.entries(spideyLTF.timeframes)[0]?.[1]||null;
  const cp=htfD?.currentPrice||ltfD?.currentPrice||0,pip=cp>10?0.01:cp>1?0.0001:0.01;
  let ez=null,inv=null,targets=[];
  if(bias!=='Neutral'){
    if(bias==='Bullish'){const dz=(ltfD?.activeDemand)||(htfD?.activeDemand);if(dz){ez={high:dz.high,low:dz.low};inv=dz.low-pip*10;}else if(htfD?.swingLows?.length){const sl=htfD.swingLows[htfD.swingLows.length-1];ez={high:sl.level+pip*5,low:sl.level-pip*5};inv=sl.level-pip*15;}const hp=(htfD?.liquidityPools||[]).filter(p=>p.level>cp),lp=(ltfD?.liquidityPools||[]).filter(p=>p.level>cp),hi=(htfD?.imbalances||[]).filter(im=>im.type==='Bearish'&&im.low>cp);targets=[...hp.map(p=>({level:p.level})),...lp.map(p=>({level:p.level})),...hi.map(im=>({level:im.high}))].sort((a,b)=>a.level-b.level).slice(0,3).map((t,i)=>({...t,label:`T${i+1}`}));}
    else{const sz=(ltfD?.activeSupply)||(htfD?.activeSupply);if(sz){ez={high:sz.high,low:sz.low};inv=sz.high+pip*10;}else if(htfD?.swingHighs?.length){const sh=htfD.swingHighs[htfD.swingHighs.length-1];ez={high:sh.level+pip*5,low:sh.level-pip*5};inv=sh.level+pip*15;}const hp=(htfD?.liquidityPools||[]).filter(p=>p.level<cp),lp=(ltfD?.liquidityPools||[]).filter(p=>p.level<cp),hi=(htfD?.imbalances||[]).filter(im=>im.type==='Bullish'&&im.high<cp);targets=[...hp.map(p=>({level:p.level})),...lp.map(p=>({level:p.level})),...hi.map(im=>({level:im.low}))].sort((a,b)=>b.level-a.level).slice(0,3).map((t,i)=>({...t,label:`T${i+1}`}));}
  }
  let rr=null;if(ez&&inv&&targets.length>0){const mid=(ez.high+ez.low)/2,sd=Math.abs(mid-inv),td=Math.abs(targets[0].level-mid);rr=sd>0?Math.round((td/sd)*10)/10:null;}
  return{entryZone:ez,invalidationLevel:inv,targets,rrRatio:rr,currentPrice:cp};
}

function runJane(symbol,spideyHTF,spideyLTF,corey){
  // JANE PROTECTION: receives symbol + spideyHTF + spideyLTF + corey only.
  // Dark Horse data does NOT enter this function.
  log('INFO',`[JANE] Synthesising ${symbol}`);
  const htfB=spideyHTF.dominantBias,htfC=spideyHTF.dominantConviction,ltfB=spideyLTF.dominantBias,ltfC=spideyLTF.dominantConviction,cB=corey.combinedBias,cC=corey.confidence,tsB=corey.trendSpider.signalBias,tsG=corey.trendSpider.grade,tsF=corey.trendSpider.fresh,tsA=corey.trendSpider.available;
  const bS={Bullish:1,Neutral:0,Bearish:-1},spS=(bS[htfB]*htfC*0.60)+(bS[ltfB]*ltfC*0.40),cS=bS[cB]*cC;
  let tsAdj=0,tsEff='Unavailable';
  if(tsA&&tsF&&(tsG==='FreshHigh'||tsG==='FreshMedium')){const ts2=bS[tsB]*corey.trendSpider.confidence,agree=tsB===htfB&&tsB===cB,conf2=tsB!=='Neutral'&&(tsB!==htfB||tsB!==cB);if(agree){tsAdj=ts2>0?0.08:-0.08;tsEff='Boosted';}else if(conf2){tsAdj=ts2>0?-0.06:0.06;tsEff='Reduced';}else{tsAdj=0;tsEff='Neutral';}}else{tsEff=tsA?'Ignored':'Unavailable';}
  const comp=(spS*0.40)+(cS*0.30)+tsAdj;
  let fb,conv,cl,dnt=false,dntR=null,cs;
  const spN=htfB==='Neutral',cN=cB==='Neutral',tsN=tsB==='Neutral'||!tsA||!tsF,ltfConf=ltfB!=='Neutral'&&ltfB!==htfB,sAc=!spN&&!cN&&htfB===cB,sCo=!spN&&!cN&&htfB!==cB,tsCS=!tsN&&tsB!==htfB;
  if(htfB==='Bullish'&&cB==='Bullish'&&(!tsA||!tsF||tsB==='Bullish')){fb='Bullish';conv=Math.min(comp+0.1,1);cs='Aligned';}
  else if(htfB==='Bearish'&&cB==='Bearish'&&(!tsA||!tsF||tsB==='Bearish')){fb='Bearish';conv=Math.min(Math.abs(comp)+0.1,1);cs='Aligned';}
  else if(sAc&&tsN){fb=htfB;conv=Math.abs(comp);cs='Aligned';}
  else if(sAc&&tsCS&&tsG==='FreshLow'){fb=htfB;conv=Math.abs(comp)*0.85;cs='PartialConflict';}
  else if(sAc&&tsCS&&tsG==='FreshHigh'){if(htfC>0.65&&cC>0.55){fb=htfB;conv=Math.abs(comp)*0.70;cs='PartialConflict';}else{fb='Neutral';conv=0.2;cs='HardConflict';dnt=true;dntR=`${htfB} structure+macro, strong TS ${tsB} conflict.`;}}
  else if(sCo&&!tsN&&tsB===htfB){fb=htfB;conv=Math.abs(comp)*0.60;cs='PartialConflict';if(htfC<0.55){dnt=true;dntR=`Structure (${htfB}) vs macro (${cB}) conflict.`;}}
  else if(sCo&&!tsN&&tsB===cB){fb='Neutral';conv=0.2;cs='HardConflict';dnt=true;dntR=`Structure (${htfB}) and macro+TS (${cB}) in direct conflict.`;}
  else if(spN&&!cN&&!tsN&&cB===tsB){fb=cB;conv=Math.abs(comp)*0.55;cs='PartialConflict';if(conv<0.35){dnt=true;dntR='Structure neutral. Macro+TS aligned but insufficient confirmation.';}}
  else if(!spN&&cN&&!tsN&&tsB===htfB){fb=htfB;conv=Math.abs(comp)*0.65;cs='PartialConflict';}
  else{fb='Neutral';conv=0;cs='HardConflict';dnt=true;dntR='Evidence fragmented. No clean bias.';}
  if(ltfConf&&!dnt){conv*=0.80;cs=cs==='Aligned'?'PartialConflict':cs;}
  if(conv<0.25&&!dnt){dnt=true;dntR=`Conviction ${(conv*100).toFixed(0)}% — below minimum threshold.`;}
  conv=Math.round(Math.min(conv,1)*100)/100;
  cl=conv>=0.65?'High':conv>=0.40?'Medium':conv>=0.20?'Low':'Abstain';
  if(dnt)cl=conv<0.10?'Abstain':cl;
  const levels=buildLevels(spideyHTF,spideyLTF,fb);
  log('INFO',`[JANE] ${symbol} → ${fb} | ${cl} | conflict:${cs} | TS:${tsEff} | DNT:${dnt}`);
  return{finalBias:fb,conviction:conv,convictionLabel:cl,compositeScore:Math.round(comp*100)/100,doNotTrade:dnt,doNotTradeReason:dntR,trendSpiderEffect:tsEff,conflictState:cs,ltfAligned:!ltfConf,ltfConflict:ltfConf,entryZone:levels.entryZone,invalidationLevel:levels.invalidationLevel,targets:levels.targets,rrRatio:levels.rrRatio};
}

// ============================================================
// CHART ENGINE
// ============================================================
function buildPanelUrl(sym,iv){const tvSym=encodeURIComponent(getTVSymbol(sym)),interval=encodeURIComponent(iv);return`https://www.tradingview.com/chart/?symbol=${tvSym}&interval=${interval}&theme=dark&style=1&hide_top_toolbar=1&hide_side_toolbar=1&hide_legend=1&save_image=false&backgroundColor=%23000000&upColor=%2326a69a&downColor=%23ef5350&borderUpColor=%2326a69a&borderDownColor=%23ef5350&wickUpColor=%2326a69a&wickDownColor=%23ef5350`;}
async function cleanUI(page){await page.evaluate(()=>{['[data-name="header-toolbar"]','[data-name="right-toolbar"]','[data-name="left-toolbar"]','.layout__area--right','.layout__area--left','.layout__area--top','.tv-side-toolbar','.tv-control-bar','.tv-floating-toolbar','.chart-controls-bar','.header-chart-panel','[data-name="legend"]','.chart-toolbar','.topbar','.top-bar','.tv-watermark','#overlap-manager-root'].forEach(sel=>document.querySelectorAll(sel).forEach(el=>el.remove()));}).catch(()=>{});}
async function closePopups(page){const sels=['button[aria-label="Close"]','button:has-text("Accept")','button:has-text("Got it")'];for(const sel of sels){try{const btn=page.locator(sel).first();if(await btn.isVisible({timeout:500}))await btn.click();}catch{}}}
async function makePlaceholder(sym,tfKey,reason){const label=`${sym} ${tfKey}`,r2=(reason||'RENDER FAILED').slice(0,60);const svg=Buffer.from(`<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg"><rect width="${CHART_W}" height="${CHART_H}" fill="#0d0d0d"/><text x="${CHART_W/2}" y="${CHART_H/2-30}" font-family="monospace" font-size="48" fill="#444" text-anchor="middle">${label}</text><text x="${CHART_W/2}" y="${CHART_H/2+30}" font-family="monospace" font-size="28" fill="#333" text-anchor="middle">${r2}</text><text x="${CHART_W/2}" y="${CHART_H/2+80}" font-family="monospace" font-size="22" fill="#222" text-anchor="middle">PLACEHOLDER — DATA UNAVAILABLE</text></svg>`);return await sharp(svg).resize(CHART_W,CHART_H).jpeg({quality:60}).toBuffer();}

async function capturePanel(browser,sym,iv,tfKey){
  const url=buildPanelUrl(sym,iv);
  for(let attempt=1;attempt<=MAX_RETRIES;attempt++){
    let page;
    try{
      log('INFO',`[PANEL START] ${sym} ${tfKey} attempt ${attempt}`);
      page=await browser.newPage();
      await page.setViewportSize({width:CHART_W,height:CHART_H});
      if(TV_COOKIES&&TV_COOKIES.length>0)await page.context().addCookies(TV_COOKIES);
      page.setDefaultNavigationTimeout(RENDER_TIMEOUT_MS);page.setDefaultTimeout(RENDER_TIMEOUT_MS);
      await page.addInitScript(()=>{try{localStorage.setItem('theme','dark');}catch{}});
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
      const bodyTxt=await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
      if(/symbol.{0,30}(doesn't|does not|not found|invalid)/i.test(bodyTxt))throw new Error(`Symbol not found: ${sym}`);
      await page.waitForSelector('canvas',{timeout:15000});
      await page.waitForFunction(threshold=>{const c=Array.from(document.querySelectorAll('canvas'));if(!c.length)return false;const l=c.reduce((b,x)=>x.width*x.height>b.width*b.height?x:b,c[0]);return l.width*l.height>=threshold;},MIN_CANVAS_AREA,{timeout:20000});
      await page.waitForFunction(()=>{const c=Array.from(document.querySelectorAll('canvas'));if(!c.length)return false;const l=c.reduce((b,x)=>x.width*x.height>b.width*b.height?x:b,c[0]);try{const ctx=l.getContext('2d');if(!ctx)return false;const w=l.width,h=l.height,d=ctx.getImageData(w*0.1,h*0.3,w*0.8,h*0.4);let nb=0;for(let i=0;i<d.data.length;i+=16){if(d.data[i]>20||d.data[i+1]>20||d.data[i+2]>20)nb++;}return nb>50;}catch{return false;}},{timeout:15000});
      await page.evaluate(()=>{document.querySelectorAll('.loading,.spinner,[class*="loading"],[class*="spinner"]').forEach(el=>el.remove());}).catch(()=>{});
      await page.waitForTimeout(2500);await closePopups(page);await cleanUI(page);
      await page.evaluate((w,h)=>{document.querySelectorAll('.chart-container,.layout__area--center,[class*="chart-markup-table"],.pane-html').forEach(el=>{el.style.width=w+'px';el.style.height=h+'px';});window.dispatchEvent(new Event('resize'));},CHART_W,CHART_H).catch(()=>{});
      await page.waitForTimeout(1500);
      const buf=await page.screenshot({type:'png',fullPage:false,clip:{x:0,y:0,width:CHART_W,height:CHART_H}});
      await page.close().catch(()=>{});
      if(!buf||buf.length<80000)throw new Error(`Weak/blank render — buffer ${buf?.length||0}B (minimum 80KB required)`);
      log('INFO',`[OK] ${sym} ${tfKey} ${(buf.length/1024).toFixed(0)}KB`);
      return buf;
    }catch(err){
      log('ERROR',`[FAIL] ${sym} ${tfKey}: ${err.message}`);
      if(page){try{await page.close();}catch{}}
      if(attempt===MAX_RETRIES)throw err;
      await new Promise(r=>setTimeout(r,3000));
    }
  }
}

async function buildGrid(panels){
  const resized=await Promise.all(panels.map(img=>sharp(img).resize(CHART_W,CHART_H,{fit:'cover',position:'centre'}).png().toBuffer()));
  return sharp({create:{width:CHART_W*2,height:CHART_H*2,channels:4,background:{r:10,g:10,b:10,alpha:1}}}).composite([{input:resized[0],left:0,top:0},{input:resized[1],left:CHART_W,top:0},{input:resized[2],left:0,top:CHART_H},{input:resized[3],left:CHART_W,top:CHART_H}]).jpeg({quality:95}).toBuffer();
}

async function renderAllPanels(symbol){
  const all=[...HTF_INTERVALS.map(iv=>({iv,set:'HTF',key:tfLabel(iv)})),...LTF_INTERVALS.map(iv=>({iv,set:'LTF',key:tfLabel(iv)}))];
  log('INFO',`[BROWSER] Launching Chromium for ${symbol}`);
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
  const htfP=[],ltfP=[];let htfFail=0,ltfFail=0;
  try{
    for(const{iv,set,key}of all){
      let buf;
      try{buf=await capturePanel(browser,symbol,iv,key);}
      catch(err){log('WARN',`[RENDER SKIP] ${symbol} ${key}: ${err.message}`);buf=await makePlaceholder(symbol,key,err.message);if(set==='HTF')htfFail++;else ltfFail++;}
      if(set==='HTF')htfP.push(buf);else ltfP.push(buf);
    }
  }finally{try{await browser.close();log('INFO',`[BROWSER] Closed for ${symbol}`);}catch(e){log('WARN',`[BROWSER] Close error: ${e.message}`);}}
  if(htfFail/HTF_INTERVALS.length>ABORT_THRESHOLD||ltfFail/LTF_INTERVALS.length>ABORT_THRESHOLD)throw new Error(`[ABORT] ${symbol} render integrity failed — HTF:${htfFail}/4 LTF:${ltfFail}/4 panels failed`);
  const htfGrid=await buildGrid(htfP),ltfGrid=await buildGrid(ltfP);
  log('INFO',`[GRID] ${symbol} HTF:${htfFail===0?'OK':`${htfFail} placeholder(s)`} LTF:${ltfFail===0?'OK':`${ltfFail} placeholder(s)`}`);
  return{htfGrid,ltfGrid,htfFail,ltfFail,partial:htfFail>0||ltfFail>0};
}

// ============================================================
// PIPELINE
// Gate: Corey → Spidey → Jane. No bypass path exists.
// runJane() signature is (symbol, spideyHTF, spideyLTF, corey).
// Dark Horse data is never passed to runJane().
// ============================================================
async function runFullPipeline(symbol){
  log('INFO',`[PIPELINE] ${symbol} HTF+LTF`);
  const[corey,spideyHTF]=await Promise.all([runCorey(symbol),runSpideyHTF(symbol,HTF_INTERVALS)]);
  const[spideyLTF,spideyMicro]=await Promise.all([runSpideyLTF(symbol,LTF_INTERVALS),runSpideyMicro(symbol,spideyHTF.dominantBias)]);
  // Jane receives only: symbol + spideyHTF + spideyLTF + corey
  const jane=runJane(symbol,spideyHTF,spideyLTF,corey);
  const{htfGrid,ltfGrid,htfFail,ltfFail,partial}=await renderAllPanels(symbol);
  const ts=Date.now(),outcome=partial?OUTCOME.PARTIAL:OUTCOME.SUCCESS;
  log('INFO',`[PIPELINE] ${symbol} complete — bias:${jane.finalBias} conviction:${jane.convictionLabel} outcome:${outcome}`);
  return{symbol,spideyHTF,spideyLTF,spideyMicro,corey,jane,htfGrid,ltfGrid,htfGridName:`ATLAS_${symbol}_HTF_${ts}.jpg`,ltfGridName:`ATLAS_${symbol}_LTF_${ts}.jpg`,htfFail,ltfFail,partial,outcome,timestamp:new Date().toISOString()};
}

// ============================================================
// DARK HORSE PIPELINE TRIGGER
// Called by DarkHorseEngine for WATCH candidates (score ≥ 8).
// Enforces full pipeline — Jane never sees raw DH data.
// darkHorseFlag is result metadata only, not passed to any engine.
// ============================================================
async function darkHorsePipelineTrigger(symbol,meta){
  log('INFO',`[DH PIPELINE] ${symbol} — darkHorseFlag:${meta?.darkHorseFlag} score:${meta?.dhScore}`);
  try{
    // Full gate: Corey → Spidey → Jane
    const result=await runFullPipeline(symbol);
    // Attach DH metadata to result object only — not to any engine
    result.darkHorseFlag=meta?.darkHorseFlag||false;
    result.dhScore=meta?.dhScore||null;
    result.dhReasons=meta?.dhReasons||[];
    log('INFO',`[DH PIPELINE] ${symbol} complete — bias:${result.jane.finalBias} conviction:${result.jane.convictionLabel}`);
    // Deliver to shared macros channel
    const dhCh=await client.channels.fetch(SHARED_MACROS_CHANNEL).catch(()=>null);
    if(dhCh?.isTextBased()){
      try{
        await dhCh.send({content:`🐎 **DARK HORSE → PIPELINE COMPLETE — ${symbol}**\nDH Score: ${meta?.dhScore}/10 | Jane: **${result.jane.finalBias}** | Conviction: **${result.jane.convictionLabel}**`});
        await dhCh.send({content:`📡 **${symbol} — HTF** (Dark Horse triggered)`,files:[new AttachmentBuilder(result.htfGrid,{name:result.htfGridName})]});
        await dhCh.send({content:`🔬 **${symbol} — LTF** (Dark Horse triggered)`,files:[new AttachmentBuilder(result.ltfGrid,{name:result.ltfGridName})]});
        for(const chunk of chunkMsg(formatExecutionV4(result)))await dhCh.send({content:chunk});
      }catch(e){log('ERROR',`[DH PIPELINE] Deliver failed for ${symbol}: ${e.message}`);}
    }
  }catch(e){log('ERROR',`[DH PIPELINE] runFullPipeline failed for ${symbol}: ${e.message}`);}
}

// ============================================================
// EXECUTION INTERFACE v4 — OUTPUT FORMATTER
// ============================================================
const convBar=c=>{if(!c||c<=0)return'`──────────` 0%';const f=Math.round(c*10);return'`'+'█'.repeat(f)+'─'.repeat(10-f)+'`'+` ${(c*100).toFixed(0)}%`;};
const biasEmoji=b=>b==='Bullish'?'🟢':b==='Bearish'?'🔴':'⚪';

// ── CAPITAL GATING — env-based, never hardcoded ───────────────
const ATLAS_USER_CAPITAL=Number(process.env.ATLAS_USER_CAPITAL||0);

// ── ASTRA STATUS MAPPING ──────────────────────────────────────
// Maps Jane output → Astra status. Hard override rules enforced.
function resolveAstraStatus(jane,ps){
  // HARD OVERRIDE — always forces HOLD regardless of posState
  if(jane.doNotTrade||jane.convictionLabel==='Abstain'||jane.finalBias==='Neutral')return'hold';
  // DIVERGING → HOLD (system invalidation condition)
  if(ps.label==='DIVERGING')return'hold';
  // ACTIVE — execution only
  if(ps.label==='ENTRY ZONE ACTIVE'&&!jane.doNotTrade)return'active';
  // 30M READY — high conviction approaching
  if(ps.label==='APPROACHING'&&jane.convictionLabel==='High')return'ready_30m';
  // 1H WATCH — approaching but not high conviction
  if(ps.label==='APPROACHING'&&jane.convictionLabel!=='High')return'watch_1h';
  // 4H WATCH — dormant with low conviction
  if(ps.label==='DORMANT'&&jane.convictionLabel==='Low')return'watch_4h';
  // Default fallback
  return'hold';
}

// ── ASTRA STATUS BLOCK FORMATTER ─────────────────────────────
// Produces exact Discord output per Astra spec.
// Inserted directly under charts in formatExecutionV4.
function formatAstraBlock(astraStatus,jane,symbol,capital,ps){
  const cap=capital||ATLAS_USER_CAPITAL;
  const showExtended=cap>=5000;
  if(astraStatus==='hold'){
    return[
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '**ATLAS STATUS**',
      '',
      '⚪ **HOLD — NEUTRAL / NO TREND**',
      '',
      '• No directional bias',
      '• Structure not confirmed',
      '• Awaiting alignment',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n');
  }
  if(astraStatus==='watch_4h'){
    return[
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '**ATLAS PRE-TRADE WARNING**',
      '',
      '🟨 **4H WATCH**',
      '',
      '• Structure forming toward POI',
      '• Conditions building',
      '• No execution yet',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n');
  }
  if(astraStatus==='watch_1h'){
    return[
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '**ATLAS PRE-TRADE WARNING**',
      '',
      '🟧 **1H WATCH**',
      '',
      '• Price approaching zone',
      '• Liquidity likely in play',
      '• Monitor closely',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n');
  }
  if(astraStatus==='ready_30m'){
    return[
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '**ATLAS PRE-TRADE WARNING**',
      '',
      '🟩 **30M READY**',
      '',
      '• Zone nearing activation',
      '• Possible reaction forming',
      '• Prepare for confirmation',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n');
  }
  if(astraStatus==='active'){
    const ez=jane.entryZone,inv=jane.invalidationLevel,tgt=jane.targets&&jane.targets.length>0?jane.targets:null;
    const entryP=ez?`${fmtPrice(ez.low,symbol)} – ${fmtPrice(ez.high,symbol)}`:'N/A';
    const entryE=ez?`${fmtPrice(ez.low*(jane.finalBias==='Bullish'?0.9990:1.0010),symbol)} – ${fmtPrice(ez.low,symbol)}`:'N/A';
    const exitLow=tgt?fmtPrice(tgt[0].level,symbol):'N/A';
    const exitHigh=tgt&&tgt.length>1?fmtPrice(tgt[tgt.length-1].level,symbol):exitLow;
    const exitP=tgt?(tgt.length>1?`${exitLow} – ${exitHigh}`:exitLow):'N/A';
    const stopP=inv?fmtPrice(inv,symbol):'N/A';
    const stopE=inv?fmtPrice(inv*(jane.finalBias==='Bullish'?0.9985:1.0015),symbol):'N/A';
    // TREND row — one row only, determined by posState
    const psLabel=ps?ps.label:'';
    const trendVal=psLabel==='APPROACHING'?'⬆️ TOWARDS POI':psLabel==='DIVERGING'?'⬇️ AWAY FROM POI':psLabel==='ENTRY ZONE ACTIVE'?'🎯 AT POI':'⬆️ TOWARDS POI';
    const W='━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    const col1=28,col2=22;
    const row=(a,b)=>`${('**'+a+'**').padEnd(col1)}${b}`;
    const lines=[
      W,
      `${'**RECOMMENDED**'.padEnd(col1)}${'**RANGE / ACTION**'}`,
      W,
      row('🟢 ENTRY POINT:',entryP),
      W,
    ];
    if(showExtended){lines.push(row('🟠 ENTRY EXTENDED:',entryE));lines.push(W);}
    lines.push(row('🔴 EXIT POINT:',exitP));
    lines.push(W);
    lines.push(row('🟨 TREND:',trendVal));
    lines.push(W);
    lines.push(row('⚪ NEUTRAL MARKET:','NO BIAS — WAIT — HOLD'));
    lines.push(W);
    lines.push(row('🛑 SET STOP LOSS (1):',stopP));
    lines.push(W);
    if(showExtended){lines.push(row('🛑 EXT STOP LOSS (2):',stopE));lines.push(W);}
    lines.push(row('⚠️ STOP LOSS RULE:','SELECT ONE (1) OR (2)'));
    lines.push(W);
    return lines.join('\n');
  }
  return'⚪ **HOLD — AWAITING SIGNAL**';
}


function posState(jane,cp){
  if(jane.doNotTrade||jane.finalBias==='Neutral')return{icon:'⚪️',label:'DORMANT'};
  if(!cp||!jane.entryZone)return{icon:'⚪️',label:'DORMANT'};
  const ez=jane.entryZone,inZone=cp>=ez.low&&cp<=ez.high,approaching=jane.finalBias==='Bullish'?(cp<ez.low&&cp>ez.low*0.995):(cp>ez.high&&cp<ez.high*1.005),diverging=jane.finalBias==='Bullish'?cp>ez.high*1.005:cp<ez.low*0.995;
  if(inZone)return{icon:'🟢',label:'ENTRY ZONE ACTIVE'};if(approaching)return{icon:'🟠',label:'APPROACHING'};if(diverging)return{icon:'🔴',label:'DIVERGING'};return{icon:'🟠',label:'APPROACHING'};
}

function tradingPermission(jane,renderOk){
  if(isBuildMode())return{permitted:false,reason:'BUILD MODE'};
  if(!AUTH_AVAILABLE)return{permitted:false,reason:'UNVERIFIED — AUTH ABSENT'};
  if(!renderOk)return{permitted:false,reason:'RENDER INTEGRITY FAILED'};
  if(jane.doNotTrade)return{permitted:false,reason:jane.doNotTradeReason||'ENGINE CONFLICT'};
  if(jane.finalBias==='Neutral')return{permitted:false,reason:'NO DIRECTIONAL BIAS'};
  if(!jane.invalidationLevel)return{permitted:false,reason:'STOP LOSS UNDEFINED'};
  if(jane.rrRatio!==null&&jane.rrRatio<3)return{permitted:false,reason:`R:R ${jane.rrRatio}:1 BELOW 1:3 MINIMUM`};
  return{permitted:true,reason:null};
}

function formatExecutionV4(result){
  const{symbol,spideyHTF,spideyLTF,jane,corey,htfFail,ltfFail}=result;
  const cp=spideyHTF.currentPrice,renderOk=htfFail===0&&ltfFail===0,perm=tradingPermission(jane,renderOk),ps=posState(jane,cp),astraStatus=resolveAstraStatus(jane,ps);
  const now=new Date(),dateStr=now.toLocaleDateString('en-AU',{weekday:'short',day:'2-digit',month:'short',year:'numeric',timeZone:'Australia/Perth'}),timeStr=now.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',timeZone:'Australia/Perth',timeZoneName:'short'}),utcTs=now.toISOString().replace('T',' ').slice(0,19)+' UTC';
  const vLine=buildVerificationLine(symbol,utcTs),feed=getFeedName(symbol),W='═'.repeat(32);
  const L=[];
  L.push(`╔${W}╗`);
  L.push(`  ⚡ **ATLAS FX — ${symbol}** · ${feed}`);
  L.push(`  📅 ${dateStr} · ⏰ ${timeStr}`);
  L.push(`  HTF + LTF · Weekly · Daily · 4H · 1H · 30M · 15M · 5M · 1M`);
  L.push(`╚${W}╝`);L.push('');
  // Dark Horse flag indicator (metadata only — does not affect engine outputs)
  if(result.darkHorseFlag){
    L.push(`🐎 **Dark Horse Engine Flag** — Score: ${result.dhScore}/10`);
    L.push('');
  }
  // ── ASTRA STATUS BLOCK — appears directly under charts ──────
  L.push(formatAstraBlock(astraStatus,jane,symbol,ATLAS_USER_CAPITAL,ps));
  L.push('');
  L.push(`**ATLAS POSITION STATE:** ${ps.icon} ${ps.label}`);
  if(cp)L.push(`**Current Price:** ${fmtPrice(cp,symbol)}`);
  L.push('');
  L.push(`**Bias:** ${biasEmoji(jane.finalBias)} ${jane.finalBias} · **Conviction:** ${jane.convictionLabel} · ${convBar(jane.conviction)}`);
  L.push('');
  if(jane.doNotTrade){L.push(`⛔ ${jane.doNotTradeReason||'Engines conflicted — no valid setup.'}`);}
  else{const sb=spideyHTF.significantBreak;L.push(`${jane.finalBias} structure${sb?.lastBreak!=='None'?` · ${sb.lastBreak} on ${tfLabel(sb.timeframe)}`:''} · Macro ${corey.combinedBias} · HTF/LTF ${jane.ltfConflict?'⚠️ Split':'✅ Aligned'}`);}
  L.push('');L.push('─'.repeat(32));L.push('');
  L.push(`**Entry Zone:**`);
  if(jane.entryZone)L.push(`${fmtPrice(jane.entryZone.low,symbol)} – ${fmtPrice(jane.entryZone.high,symbol)}`);
  else L.push(`Not defined — await structural development`);
  L.push('');
  L.push(`**Set Stop Loss:**`);
  if(jane.invalidationLevel)L.push(`${fmtPrice(jane.invalidationLevel,symbol)}`);
  else L.push(`Undefined — do not enter without stop loss`);
  L.push('');
  L.push(`**Targets:**`);
  if(jane.targets&&jane.targets.length>0)for(const t of jane.targets)L.push(`${t.label}: ${fmtPrice(t.level,symbol)}`);
  else L.push(`Pending structural resolution`);
  L.push('');
  L.push(`**Exit:**`);
  L.push(jane.targets?.length?`Staged: T1 partial → T2 partial → T3 full close. Emergency exit on close through stop loss.`:`Close on structural reversal signal or invalidation breach.`);
  L.push('');
  L.push(`**Risk Profile:**`);
  if(jane.rrRatio)L.push(`R:R ~${jane.rrRatio}:1 ${jane.rrRatio>=3?'✅ Meets ATLAS minimum 1:3':'⚠️ Below ATLAS 1:3 minimum'}`);
  else L.push(`Minimum ATLAS standard 1:3 R:R required before entry is justified.`);
  L.push('');
  L.push(`**Timing Expectation:**`);
  if(ps.label==='ENTRY ZONE ACTIVE')L.push(`Immediate — price inside zone. Confirmation trigger required before committing.`);
  else if(ps.label==='APPROACHING')L.push(`Not yet — probability improves as price reaches entry zone.`);
  else if(ps.label==='DIVERGING')L.push(`Setup not valid at current price. Await retrace to zone.`);
  else L.push(`Await structural BOS on dominant timeframe before entry.`);
  L.push('');
  L.push(`**Current Positioning:**`);
  if(cp&&jane.entryZone){const mid=(jane.entryZone.low+jane.entryZone.high)/2,dp=Math.abs((cp-mid)/cp*100).toFixed(2),rel=cp<jane.entryZone.low?'below':cp>jane.entryZone.high?'above':'inside';L.push(`Price ${fmtPrice(cp,symbol)} is ${dp}% ${rel} the entry zone`);}
  else L.push(`Price ${fmtPrice(cp,symbol)} — entry zone pending structural confirmation`);
  L.push('');
  L.push(`**What We're Waiting For:**`);
  if(jane.finalBias==='Bullish'){L.push(`• Price retraces to demand zone without close below`);L.push(`• LTF CHoCH — downswing fails to make new low`);L.push(`• LTF BOS to upside — confirms institutional buying intent`);L.push(`• Stop loss defined and R:R ≥ 1:3`);}
  else if(jane.finalBias==='Bearish'){L.push(`• Price retraces to supply zone without close above`);L.push(`• LTF CHoCH — upswing fails to make new high`);L.push(`• LTF BOS to downside — confirms institutional selling intent`);L.push(`• Stop loss defined and R:R ≥ 1:3`);}
  else{L.push(`• Clean BOS on dominant timeframe establishing unambiguous direction`);L.push(`• All three engines (Spidey · Corey · Jane) aligned`);L.push(`• Entry zone, stop loss, and R:R all defined`);L.push(`• Render integrity confirmed 4/4 HTF + 4/4 LTF`);}
  L.push('');
  L.push(`**Activation Condition:**`);
  L.push(`Candle CLOSE through LTF BOS level in direction of bias. Not a wick — a close.`);
  L.push('');L.push('─'.repeat(32));L.push('');
  L.push(`**SYSTEM STATE:**`);
  L.push(isBuildMode()?`⚠️ BUILD MODE`:`✅ FULLY OPERATIONAL`);
  L.push('');
  L.push(`**TRADING PERMISSION:**`);
  if(perm.permitted){L.push(`🟢 **TRADE PERMITTED**`);}
  else{L.push(`🔴 **TRADE NOT PERMITTED**`);L.push(`Reason: ${perm.reason}`);}
  L.push('');
  L.push(`**RULE:**`);
  L.push(`*If it does not explicitly show TRADE PERMITTED → you WAIT*`);
  L.push('');L.push('━'.repeat(32));L.push('**ATLAS EXECUTION PANEL**');L.push('━'.repeat(32));L.push('');
  if(perm.permitted){L.push(`🟢 **TRADE PERMITTED | EXECUTION ACTIVE**`);L.push('');L.push(`Entry: ${jane.entryZone?fmtPrice(jane.entryZone.low,symbol)+' – '+fmtPrice(jane.entryZone.high,symbol):'N/A'}`);L.push(`Stop:  ${jane.invalidationLevel?fmtPrice(jane.invalidationLevel,symbol):'N/A'}`);if(jane.targets?.length)L.push(`T1:    ${fmtPrice(jane.targets[0].level,symbol)}`);}
  else{L.push(`⚪ **WAIT | NOTHING HAPPENING**`);}
  L.push('');L.push('━'.repeat(32));L.push('');
  L.push(`\`${vLine}\``);
  return L.join('\n');
}

function chunkMsg(text,max=1900){const chunks=[];let rem=text.trim();while(rem.length>max){let at=rem.lastIndexOf('\n\n',max);if(at<600)at=rem.lastIndexOf('\n',max);if(at<1)at=max;chunks.push(rem.slice(0,at).trim());rem=rem.slice(at).trim();}if(rem.length>0)chunks.push(rem.trim());return chunks;}

// ── ADMIN ALERT ───────────────────────────────────────────────
async function adminAlert(msg,symbol,reason,detail){
  const utcTs=new Date().toISOString().replace('T',' ').slice(0,19)+' UTC';
  const lines=[`**ATLAS — SYSTEM ALERT**`,``,`**Symbol:** ${symbol}`,`**Time:** ${utcTs}`,`**State:** ${SYSTEM_STATE}`,`**Reason:** ${reason}`,detail?`**Detail:** ${detail}`:'',``,`**User-facing status:**`,`🔴 **TRADE NOT PERMITTED**`,`System Status: TEMPORARILY LIMITED`,`Admins aware — system stabilising`,`Please wait for normal operation to resume.`].filter(Boolean).join('\n');
  try{await msg.channel.send({content:lines});}catch(e){log('ERROR',`[ADMIN ALERT] ${e.message}`);}
}

// ── DELIVER ───────────────────────────────────────────────────
async function deliverResult(msg,result){
  const{symbol,htfGrid,ltfGrid,htfGridName,ltfGridName}=result;
  if(!htfGrid||!ltfGrid){await adminAlert(msg,symbol,'Grid buffer null','htfGrid or ltfGrid missing after pipeline');return;}
  const cacheKey=`${msg.id}_${Date.now()}`;
  SHARE_CACHE.set(cacheKey,{...result,expiresAt:Date.now()+CACHE_TTL_MS});
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`share_${cacheKey}`).setLabel('Share to #shared-macros').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`noshare_${cacheKey}`).setLabel('Keep private').setStyle(ButtonStyle.Secondary));
  await msg.channel.send({content:`📡 **${symbol} — HTF** · Weekly · Daily · 4H · 1H`,files:[new AttachmentBuilder(htfGrid,{name:htfGridName})]});
  await msg.channel.send({content:`🔬 **${symbol} — LTF** · 30M · 15M · 5M · 1M`,files:[new AttachmentBuilder(ltfGrid,{name:ltfGridName})]});
  const chunks=chunkMsg(formatExecutionV4(result));
  for(let i=0;i<chunks.length;i++){const isLast=i===chunks.length-1;const payload={content:chunks[i]};if(isLast)payload.components=[row];await msg.channel.send(payload);}
}

// ── SHARE CACHE ───────────────────────────────────────────────
const SHARE_CACHE=new Map();
setInterval(()=>{const n=Date.now();for(const[k,v]of SHARE_CACHE)if(v.expiresAt<n)SHARE_CACHE.delete(k);},60000);
const safeReply=async(msg,payload)=>{try{return await msg.reply(payload);}catch(e){log('ERROR','[REPLY]',e.message);return null;}};
const safeEdit=async(msg,payload)=>{try{return await msg.edit(payload);}catch(e){log('ERROR','[EDIT]',e.message);return null;}};

client.on('interactionCreate',async interaction=>{
  if(!interaction.isButton())return;
  if(interaction.customId.startsWith('noshare_')){try{await interaction.update({content:'Kept private.',components:[]});}catch(_){}return;}
  if(interaction.customId.startsWith('share_')){
    try{await interaction.deferUpdate();}catch(e){log('ERROR','[DEFER]',e.message);return;}
    const cached=SHARE_CACHE.get(interaction.customId.replace('share_',''));
    if(!cached){await interaction.editReply({content:'Share expired — run command again.',components:[]});return;}
    try{
      const ch=await client.channels.fetch(SHARED_MACROS_CHANNEL).catch(()=>null);
      if(!ch?.isTextBased()){await interaction.editReply({content:'Channel not found.',components:[]});return;}
      await ch.send({content:`📤 **${cached.symbol}** shared by **${interaction.user.username}**`,files:[new AttachmentBuilder(cached.htfGrid,{name:cached.htfGridName})]});
      await ch.send({files:[new AttachmentBuilder(cached.ltfGrid,{name:cached.ltfGridName})]});
      for(const chunk of chunkMsg(formatExecutionV4(cached)))await ch.send({content:chunk});
      await interaction.editReply({content:'✅ Shared in #shared-macros',components:[]});
    }catch(e){log('ERROR','[SHARE]',e.message);try{await interaction.editReply({content:'Share failed.',components:[]});}catch(_){}}
  }
});

// ── CHANNEL MAP + QUEUE + LOCK ────────────────────────────────
const CHANNEL_GROUP_MAP={'1432642672287547453':'AT','1432643496375881748':'SK','1432644116868501595':'NM','1482450651765149816':'BR','1432080184458350672':'AT','1430950313484878014':'SK','1431192381029482556':'NM','1482451091630194868':'BR'};
const RUNNING=new Set(),COOLDOWN=new Map(),COOLDOWN_MS=10000;
const isLocked=s=>{if(RUNNING.has(s))return true;const lu=COOLDOWN.get(s);if(lu&&(Date.now()-lu)<COOLDOWN_MS)return true;return false;};
const lock=s=>{RUNNING.add(s);COOLDOWN.delete(s);};
const unlock=s=>{RUNNING.delete(s);COOLDOWN.set(s,Date.now());};
const queue=[];let qRunning=false;
function enqueue(job){queue.push(job);void runQ();}
async function runQ(){if(qRunning)return;qRunning=true;while(queue.length>0){const job=queue.shift();try{await job();}catch(e){log('ERROR','[QUEUE]',e.message);}}qRunning=false;}

// ── MESSAGE HANDLER ───────────────────────────────────────────
const PROCESSED=new Set();
client.on('messageCreate',async msg=>{
  if(msg.author.bot)return;
  if(PROCESSED.has(msg.id))return;
  PROCESSED.add(msg.id);setTimeout(()=>PROCESSED.delete(msg.id),MESSAGE_DEDUPE_TTL_MS);
  const raw=(msg.content||'').trim();if(!raw)return;

  const v=validateInput(raw);

  if(v.reason==='ops'){
    switch(v.op){
      case'ping':await safeReply(msg,'pong');return;
      case'stats':{const top=Object.entries(STATS.symbols).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,c])=>`${s}:${c}`).join(' · ')||'none';await safeReply(msg,[`📊 **ATLAS FX v4.0 — Stats**`,`Total: **${STATS.total}** · Success: **${STATS.success}** · Partial: **${STATS.partial}** · Failed: **${STATS.failed}** · Blocked: **${STATS.blocked}**`,`Top symbols: ${top}`].join('\n'));return;}
      case'errors':{const rec=REQUEST_LOG.filter(r=>r.outcome===OUTCOME.FAILED||r.outcome===OUTCOME.PARTIAL).slice(0,5);if(!rec.length){await safeReply(msg,'✅ No recent errors.');return;}await safeReply(msg,`⚠️ **Recent Issues:**\n${rec.map(r=>`\`${r.time.slice(11,19)}\` ${r.symbol||'?'} — **${r.outcome}**`).join('\n')}`);return;}
      case'sysstate':await safeReply(msg,[`**SYSTEM STATE:** ${isBuildMode()?'⚠️ BUILD MODE':'✅ FULLY OPERATIONAL'}`,`**AUTH:** ${AUTH_AVAILABLE?`✅ VERIFIED — ${ATLAS_INSTANCE_ID}`:'❌ UNVERIFIED — auth env vars absent'}`,`**TRADE PERMITTED:** ${isTradePermitAllowed()?'🟢 POSSIBLE (subject to gating)':'🔴 BLOCKED'}`].join('\n'));return;

      // ── DARK HORSE COMMAND ────────────────────────────────────
      case'darkhorse':{
        const group=CHANNEL_GROUP_MAP[msg.channel.id];
        if(!group)return; // DH command only from known channels
        const dhProgress=await safeReply(msg,
          `🐎 **DARK HORSE** — Manual scan triggered.\nScanning ${DH_UNIVERSE.length} instruments: ${DH_UNIVERSE.join(' · ')}`
        );
        try{
          const scanResult=await runDarkHorseScan();
          const{watch,internal,ignored}=scanResult;
          const watchLines=watch.length
            ?watch.map(c=>`🟢 **${c.symbol}** — ${c.score}/10 → WATCH (pipeline triggered)`).join('\n')
            :'None above threshold.';
          const internalLines=internal.length
            ?internal.map(c=>`🟡 ${c.symbol} — ${c.score}/10 (stored internally)`).join('\n')
            :'None.';
          const reply=
            `🐎 **ATLAS DARK HORSE — SCAN COMPLETE**\n\n`+
            `**Universe:** ${DH_UNIVERSE.join(' · ')}\n\n`+
            `**WATCH (≥8):**\n${watchLines}\n\n`+
            `**INTERNAL (5–7):**\n${internalLines}\n\n`+
            `**Ignored (<5):** ${ignored.length} instrument(s)\n\n`+
            `**Pipeline:** WATCH candidates have entered Corey → Spidey → Jane.\n`+
            `**Rule:** Dark Horse is a scan flag only. Jane has final authority.`;
          if(dhProgress)await safeEdit(dhProgress,reply);
          else await safeReply(msg,reply);
        }catch(e){
          log('ERROR',`[DH CMD] ${e.message}`);
          const errMsg=`❌ Dark Horse scan failed.\n\`${e.message}\``;
          if(dhProgress)await safeEdit(dhProgress,errMsg);
          else await safeReply(msg,errMsg);
        }
        return;
      }
    }
  }

  const group=CHANNEL_GROUP_MAP[msg.channel.id];if(!group)return;

  if(!v.valid){
    if(v.reason==='no_prefix')return;
    if(v.reason==='crypto'){trackStats(raw.slice(1).toUpperCase(),OUTCOME.BLOCKED);await safeReply(msg,`🚫 **${raw.slice(1).toUpperCase()}** — Cryptocurrency not supported.\nATLAS FX supports: FX pairs, equities, indices, commodities.`);return;}
    trackStats(null,OUTCOME.BLOCKED);await safeReply(msg,inputErrorMsg());return;
  }

  const{symbol}=v;
  auditLog({user:msg.author.username,channel:msg.channel.name||msg.channel.id,raw,symbol,flags:[],outcome:null});
  log('INFO',`[REQ] ${msg.author.username} → ${symbol}`);

  if(isLocked(symbol)){await safeReply(msg,`⚠️ **${symbol}** is already generating — please wait.`);return;}
  lock(symbol);

  enqueue(async()=>{
    log('INFO',`[CMD] ${msg.author.username} / ${group} → ${symbol}`);
    const progress=await safeReply(msg,[`⏳ **${symbol}** — ATLAS v4.0 analysis running...`,`📡 HTF: Weekly · Daily · 4H · 1H`,`🔬 LTF: 30M · 15M · 5M · 1M`,`🕷️ Spidey · 🌍 Corey · 🕸️ TrendSpider · 👑 Jane`].join('\n'));
    try{
      const result=await runFullPipeline(symbol);
      if(progress){try{await progress.delete();}catch(_){}}
      trackStats(symbol,result.outcome);
      await deliverResult(msg,result);
    }catch(err){
      log('ERROR',`[CMD FAIL] ${symbol}:`,err.message);
      trackStats(symbol,OUTCOME.FAILED);
      if(progress)await safeEdit(progress,`❌ **${symbol}** — Analysis failed.\n\`${err.message}\``);
      await adminAlert(msg,symbol,'Pipeline failure',err.message);
    }finally{unlock(symbol);}
  });
});

// ── SHARD + KEEPALIVE ─────────────────────────────────────────
client.on('shardDisconnect',(e,id)=>log('WARN',`[SHARD] ${id} disconnected. Code: ${e.code}`));
client.on('shardReconnecting',id=>log('INFO',`[SHARD] ${id} reconnecting...`));
client.on('shardResume',(id,n)=>log('INFO',`[SHARD] ${id} resumed. Replayed ${n} events.`));
setInterval(()=>log('INFO','[KEEP-ALIVE]'),5*60*1000);

// ── STARTUP ───────────────────────────────────────────────────
tsLoadPersisted();
startTSServer();
client.login(TOKEN);
