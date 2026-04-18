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

const { renderAllPanels } = require('./renderer');
const sharp=require('sharp');
const crypto=require('crypto');
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

// ==============================
// ATLAS MACRO ENGINE
// ==============================

async function buildMacro(symbol) {
  const corey = await runCorey(symbol);
  const g = corey.internalMacro?.global;
  return {
    symbol,
    bias:        corey.combinedBias ?? "Neutral",
    confidence:  corey.confidence ?? 0,
    structure:   corey.internalMacro?.regime?.regime ?? "Neutral",
    regime:      g?.riskEnv ?? "Neutral",
    risk:        (g?.live?.vix?.level) ?? "Normal",
    htf:         null,
    ltf:         null,
    timestamp:   Date.now()
  };
}

// ==============================
// MACRO FORMATTER v2.0 — INSTITUTIONAL LOCKED SPEC
// Order: Trade Status → Price Table → Roadmap →
//        Event Intelligence → Market Overview →
//        Events/Catalysts → Historical Context →
//        Execution Logic → Validity
// Charts (2×2 HTF + 2×2 LTF) are delivered by deliverResult
// BEFORE the text sections per spec.
// ==============================

const ROADMAP_URL = process.env.ROADMAP_URL || '';
const DISCORD_MAX = 1900;

function dayMode() {
  const d = new Date().getUTCDay();
  if (d === 1) return 'Monday — Full Depth (30–35 page equivalent)';
  if (d === 5) return 'Friday — Execution-Focused';
  return 'Midweek — Maintained; outdated sections removed, explanations intact';
}

function dotScale(conf) {
  const c = Math.max(0, Math.min(1, Number(conf) || 0));
  const level = c >= 0.80 ? 5 : c >= 0.60 ? 4 : c >= 0.40 ? 3 : c >= 0.20 ? 2 : 1;
  return '●'.repeat(level) + '○'.repeat(5 - level);
}

// Mixed arrows mandatory — dominant direction stacked with counter-arrow underneath.
function mixedArrows(bias, conf) {
  const c = Math.max(0, Math.min(1, Number(conf) || 0));
  if (bias === BIAS.BULLISH) {
    const up = Math.max(2, Math.round(1 + c * 3));
    return '⬆️'.repeat(up) + '⬇️';
  }
  if (bias === BIAS.BEARISH) {
    const dn = Math.max(2, Math.round(1 + c * 3));
    return '⬇️'.repeat(dn) + '⬆️';
  }
  return '⬆️⬇️⬆️⬇️';
}

function biasArrow(b) {
  if (b === BIAS.BULLISH || b === STANCE.HAWKISH) return '⬆️';
  if (b === BIAS.BEARISH || b === STANCE.DOVISH) return '⬇️';
  return '⬆️⬇️';
}

function fmtNum(n, dp = 2) {
  return Number.isFinite(n) ? Number(n).toFixed(dp) : 'N/A';
}
function pctLabel(v) { return Math.round((Number(v) || 0) * 100) + '%'; }

function permitStatusLine() {
  if (!AUTH_AVAILABLE) return '🔒 TRADE PERMIT BLOCKED — AUTH UNVERIFIED';
  if (!isTradePermitAllowed()) return '🔒 TRADE PERMIT DISABLED — BUILD MODE';
  return '🔓 TRADE PERMIT AVAILABLE — FULLY OPERATIONAL';
}

function dominantDriver(ctx) {
  const channels = {
    oilShock: Math.abs(ctx.oilShock || 0),
    creditStress: Math.abs(ctx.creditStress || 0),
    geopoliticalStress: Math.abs(ctx.geopoliticalStress || 0),
    growthImpulse: Math.abs(ctx.growthImpulse || 0),
    usdFlow: Math.abs(ctx.usdFlow || 0),
    safeHavenFlow: Math.abs(ctx.safeHavenFlow || 0),
    bondStress: Math.abs(ctx.bondStress || 0),
    recessionRisk: Math.abs(ctx.recessionRisk || 0),
    equityBreadth: Math.abs(ctx.equityBreadth || 0),
    realYieldPressure: Math.abs(ctx.realYieldPressure || 0)
  };
  const sorted = Object.entries(channels).sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

const DRIVER_MAP = {
  oilShock: { headline: 'Oil shock channel dominant', summary: 'Energy prices are repricing breakeven inflation and real yields faster than any other input. Commodity-currency pairs and inflation-sensitive assets will lead the tape.', chain: 'Oil repricing → breakevens shift → real yields adjust → USD flow reconfigures → commodity currencies asymmetric' },
  creditStress: { headline: 'Credit stress channel widening', summary: 'Risk premia on corporate and sovereign credit are expanding. Funding costs are rising and equity multiples are compressing on the margin.', chain: 'Credit spreads widen → funding costs rise → risk appetite contracts → equity breadth deteriorates → safe havens bid' },
  geopoliticalStress: { headline: 'Geopolitical stress channel active', summary: 'Cross-asset safe-haven demand is rising in response to a discrete event. This is the hardest channel to fade and the fastest to rotate.', chain: 'Event shock → safe-haven rotation → DXY/CHF/JPY/XAU bid → equities offered → credit widens' },
  growthImpulse: { headline: 'Growth impulse repricing', summary: 'Data revisions are shifting nominal GDP expectations across the complex. Earnings forecasts and cyclical leadership are the transmission path.', chain: 'Growth prints shift → earnings forecasts revise → equity breadth moves → risk-on/off toggles → FX carry re-rates' },
  usdFlow: { headline: 'USD flow channel dominant', summary: 'Broad dollar positioning is driving cross-asset repricing. Non-USD assets are the pressure release valve for the trade.', chain: 'USD bid → EM FX stress → commodity pressure → risk-off lean → credit widens at the margin' },
  safeHavenFlow: { headline: 'Safe-haven rotation active', summary: 'VIX, gold and JPY are lifting in tandem. Positioning is unwinding in correlated risk books.', chain: 'Safe-haven rotation → equity drawdown → credit widens → DXY bid → carry unwind' },
  bondStress: { headline: 'Rates volatility spike', summary: 'Rates-space volatility is the MOVE-index equivalent of a cross-asset shock. Carry trades and risk-parity books are at the centre of the transmission.', chain: 'Rates vol → carry unwind → equity multiple compression → credit widens → FX crosses re-rate' },
  recessionRisk: { headline: 'Recession risk channel rising', summary: 'Curve, leading indicators and survey data are aligning on a slowdown. Fed/policy expectations are the second-order driver of the move.', chain: 'Recession flags → policy path revises → front-end rally → DXY weakens → risk assets re-rate' },
  equityBreadth: { headline: 'Breadth channel rotating', summary: 'Market breadth is the single largest contributor. Index level moves are being led by a narrow or broad cohort depending on sign.', chain: 'Breadth shift → sector rotation → factor exposures adjust → index level follows → FX crosses respond' },
  realYieldPressure: { headline: 'Real yield channel dominant', summary: 'Real yields are the gravitational constant for duration-sensitive assets. Gold, tech and EM are the most sensitive transmissions.', chain: 'Real yields → duration assets → gold / tech compress → EM FX weakens → DXY bid at the margin' }
};

const AFFECTED_MAP = {
  oilShock:           ['USOIL', 'XAUUSD', 'USDCAD', 'USDNOK', 'NAS100'],
  creditStress:       ['US500', 'NAS100', 'USDJPY', 'XAUUSD', 'EURUSD'],
  geopoliticalStress: ['XAUUSD', 'USDCHF', 'USDJPY', 'USOIL', 'US500'],
  growthImpulse:      ['NAS100', 'US500', 'AUDUSD', 'NZDUSD', 'USDCAD'],
  usdFlow:            ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'NAS100'],
  safeHavenFlow:      ['XAUUSD', 'USDCHF', 'USDJPY', 'US500', 'NAS100'],
  bondStress:         ['US500', 'NAS100', 'USDJPY', 'XAUUSD', 'EURUSD'],
  recessionRisk:      ['XAUUSD', 'USDJPY', 'EURUSD', 'NAS100', 'US500'],
  equityBreadth:      ['US500', 'NAS100', 'AUDUSD', 'EURUSD', 'XAUUSD'],
  realYieldPressure:  ['XAUUSD', 'NAS100', 'EURUSD', 'USDJPY', 'US500']
};

function buildTradeStatus(sym, jane, corey, htf, ltf) {
  const bias = jane.finalBias;
  const conv = jane.conviction;
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const risk = corey.internalMacro?.global?.riskEnv || RISK_ENV.NEUTRAL;
  const dnt = jane.doNotTrade ? `⛔ DO NOT TRADE — ${jane.doNotTradeReason}` : '';
  return [
    `📊 **TRADE STATUS — ${sym}**`,
    ``,
    `**Dominant Bias:** ${bias}  ${dotScale(conv)}`,
    `${mixedArrows(bias, conv)}`,
    ``,
    `**Conviction:** ${jane.convictionLabel} · ${pctLabel(conv)}  (composite ${fmtNum(jane.compositeScore, 2)})`,
    `**Regime:** ${regime} · Risk ${risk}`,
    `**HTF Structure:** ${htf.dominantBias} ${biasArrow(htf.dominantBias)} (${pctLabel(htf.dominantConviction)})`,
    `**LTF Structure:** ${ltf.dominantBias} ${biasArrow(ltf.dominantBias)} (${pctLabel(ltf.dominantConviction)}) — ${jane.ltfAligned ? 'Aligned' : 'Conflict'}`,
    `**Macro (Corey):** ${corey.combinedBias} ${biasArrow(corey.combinedBias)} · score ${fmtNum(corey.combinedScore, 2)}`,
    `**TrendSpider:** ${corey.trendSpider.grade || 'Unavailable'} · effect ${jane.trendSpiderEffect}`,
    `**Conflict State:** ${jane.conflictState}`,
    `${permitStatusLine()}`,
    dnt
  ].filter(Boolean).join('\n');
}

function buildPriceTable(sym, jane, htf) {
  const cp = htf.currentPrice || 0;
  const ez = jane.entryZone;
  const inv = jane.invalidationLevel;
  const targets = jane.targets || [];
  const htf1 = Object.values(htf.timeframes)[0] || {};
  const sh = htf1.swingHighs || [];
  const sl = htf1.swingLows || [];
  const hi = sh.length ? sh[sh.length - 1].level : null;
  const lo = sl.length ? sl[sl.length - 1].level : null;
  return [
    `💠 **PRICE TABLE — ${sym}**`,
    ``,
    '```',
    `🟡 HIGH      ${fmtPrice(hi, sym)}`,
    `🟢 CURRENT   ${fmtPrice(cp, sym)}`,
    ez ? `🟠 ENTRY     ${fmtPrice(ez.low, sym)} – ${fmtPrice(ez.high, sym)}` : `🟠 ENTRY     pending confirmation`,
    `🔵 LOW       ${fmtPrice(lo, sym)}`,
    '```',
    ``,
    inv ? `Invalidation: ${fmtPrice(inv, sym)}` : `Invalidation: pending structure`,
    targets.length ? `Targets: ${targets.map(t => `${t.label} ${fmtPrice(t.level, sym)}`).join(' · ')}` : `Targets: pending structure`,
    jane.rrRatio ? `R:R — 1:${jane.rrRatio}` : `R:R — pending`
  ].join('\n');
}

function buildRoadmap() {
  const lines = [
    `📅 **ROADMAP**`,
    ``,
    `Reference → ATLAS FX Macro + Roadmap Master Brief v2.0 (LOCKED)`
  ];
  if (ROADMAP_URL) lines.push(ROADMAP_URL);
  lines.push(``, `Today: ${dayMode()}`);
  return lines.join('\n');
}

function buildEventIntel(sym, corey) {
  const calendarIntel = coreyCalendar.getEventIntelligence(sym);
  if (calendarIntel) return calendarIntel;
  const g = corey.internalMacro?.global || {};
  const live = g.live || {};
  const ctx = g.context || {};
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const bias = corey.combinedBias;
  const conf = corey.confidence;
  const driver = dominantDriver(ctx);
  const meta = DRIVER_MAP[driver] || DRIVER_MAP.equityBreadth;
  const dxyTxt = live.dxy ? `DXY proxy ${fmtNum(live.dxy.price, 2)} (${biasArrow(g.dxyBias)})` : `DXY unavailable`;
  const vixTxt = live.vix ? `VIX proxy ${fmtNum(live.vix.price, 2)} — ${live.vix.level || 'Normal'}` : `VIX unavailable`;
  const yldTxt = live.yield ? `10Y-2Y ${fmtNum(live.yield.spread, 2)}` : `Yield curve unavailable`;
  const affected = AFFECTED_MAP[driver] || AFFECTED_MAP.usdFlow;
  return [
    `🧠 **EVENT INTELLIGENCE**`,
    ``,
    `**Sentiment:** ${bias}  ${dotScale(conf)}`,
    `${mixedArrows(bias, conf)}`,
    ``,
    `**Headline:** ${meta.headline} — ${bias.toLowerCase()} bias for ${sym}`,
    `**Timestamp:** ${new Date().toISOString()} (live Corey snapshot)`,
    ``,
    `**Summary:**`,
    `${meta.summary} Live cross-asset tape: ${dxyTxt}; ${vixTxt}; ${yldTxt}. Regime classification ${regime} at ${pctLabel(corey.internalMacro?.regime?.confidence || 0)} confidence. Risk environment ${g.riskEnv}. These readings are mechanical inputs to the bias — every downstream paragraph is derived from this exact snapshot, not opinion.`,
    ``,
    `**AI Commentary:**`,
    `The ${driver} channel is the single largest contributor to the combined macroScore of ${fmtNum(corey.combinedScore, 2)}. Secondary channels (growth ${fmtNum(ctx.growthImpulse, 2)}, breadth ${fmtNum(ctx.equityBreadth, 2)}, real yields ${fmtNum(ctx.realYieldPressure, 2)}) are being overridden. Expect ${sym} to track ${driver} prints more tightly than usual until the regime rotates. Internal vs combined bias alignment: ${corey.alignment ? 'aligned' : (corey.contradiction ? 'contradicted by TrendSpider' : 'TrendSpider absent')}.`,
    ``,
    `**Mechanism Chain:**`,
    `${meta.chain}`,
    ``,
    `**Trader Note:**`,
    `Size positions assuming the ${driver} channel remains dominant through the session. Do not fade the dominant driver inside the active regime window. Wait for a regime-change signal (VIX cross of 20, DXY cross of proxy 100, 10Y-2Y cross of zero) before counter-positioning. TrendSpider status: ${corey.trendSpider.grade || 'Unavailable'} — tsEffect ${corey.tsEffect}.`,
    ``,
    `**Affected Symbols:** ${affected.join(' · ')}`
  ].join('\n');
}

function buildMarketOverview(sym, corey) {
  const g = corey.internalMacro?.global || {};
  const live = g.live || {};
  const ctx = g.context || {};
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const vol = corey.internalMacro?.volatility || { level: 'Moderate', volatilityScore: 0 };
  const liq = corey.internalMacro?.liquidity || { state: 'Neutral', liquidityScore: 0 };
  const base = corey.internalMacro?.base?.cb || {};
  const quote = corey.internalMacro?.quote?.cb || {};
  const dxyArrow = biasArrow(g.dxyBias);
  const riskArrow = g.riskEnv === RISK_ENV.RISK_ON ? '⬆️' : '⬇️';
  const yldArrow = (live.yield?.spread || 0) > 0 ? '⬆️' : '⬇️';
  const volArrow = vol.level === 'High' ? '⬇️' : '⬆️';
  const breadthArrow = (ctx.equityBreadth || 0) > 0 ? '⬆️' : '⬇️';
  const cbArrow = (base.score || 0) >= (quote.score || 0) ? '⬆️' : '⬇️';
  const paragraphs = [
    `**Dollar (DXY):** proxy reading ${live.dxy ? fmtNum(live.dxy.price, 2) : 'N/A'} with ${g.dxyBias} bias (score ${fmtNum(g.dxyScore, 2)}). USD flow channel prints ${fmtNum(ctx.usdFlow, 2)} and safe-haven flow ${fmtNum(ctx.safeHavenFlow, 2)}. The dollar path is the single largest input to non-USD trades in this window; any cross-asset move that does not reconcile with DXY is noise until the dollar re-rates. ${dxyArrow}`,
    `**Volatility (VIX proxy):** ${live.vix ? fmtNum(live.vix.price, 2) : 'N/A'} at ${live.vix?.level || 'Normal'} level with computed volatility score ${fmtNum(vol.volatilityScore, 2)}. Credit stress ${fmtNum(ctx.creditStress, 2)} and bond stress ${fmtNum(ctx.bondStress, 2)} are feeding the read. ${vol.level === 'High' ? 'Expect gappy execution; reduce size and widen stops.' : vol.level === 'Low' ? 'Expect tight ranges; favour continuation over counter-trend.' : 'Normal execution regime — standard sizing.'} ${volArrow}`,
    `**Yield Curve:** 10Y-2Y spread ${live.yield ? fmtNum(live.yield.spread, 2) : 'N/A'}; real yield pressure channel ${fmtNum(ctx.realYieldPressure, 2)}. The curve state is the second-order confirmation for the ${regime} regime classification — when curve sign and regime disagree, the regime label is provisional and subject to flip inside 48 hours. ${yldArrow}`,
    `**Regime / Risk:** classified ${regime} at ${pctLabel(corey.internalMacro?.regime?.confidence || 0)} confidence. Risk environment ${g.riskEnv} with riskScore ${fmtNum(g.riskScore, 2)}. Liquidity state ${liq.state} (score ${fmtNum(liq.liquidityScore, 2)}). The regime gate determines whether macro-aligned trades carry full size or are scaled down; scaling rules are not overrideable inside this session. ${riskArrow}`,
    `**Central Bank Backdrop:** base ${base.name || 'N/A'} — ${base.direction || 'N/A'} / ${base.rateCycle || 'N/A'} (terminal bias ${fmtNum(base.terminalBias, 2)}). Quote ${quote.name || 'N/A'} — ${quote.direction || 'N/A'} / ${quote.rateCycle || 'N/A'} (terminal bias ${fmtNum(quote.terminalBias, 2)}). The CB differential is the structural tailwind/headwind baseline before event shocks; event shocks operate ON TOP of this layer, not in place of it. ${cbArrow}`,
    `**Cross-Asset Breadth:** equity breadth ${fmtNum(ctx.equityBreadth, 2)}, growth impulse ${fmtNum(ctx.growthImpulse, 2)}, semiconductor cycle ${fmtNum(ctx.semiconductorCycle, 2)}, AI capex impulse ${fmtNum(ctx.aiCapexImpulse, 2)}, commodity demand ${fmtNum(ctx.commodityDemand, 2)}. These secondary channels adjust sector scores inside regime-adjusted sizing; they do not override the dominant channel. ${breadthArrow}`
  ];
  return [`🌐 **MARKET OVERVIEW — ${sym}**`, ``, ...paragraphs].join('\n\n');
}

function buildEventsCatalysts(sym, corey) {
  const base = corey.internalMacro?.base?.cb || {};
  const quote = corey.internalMacro?.quote?.cb || {};
  const dir2Bias = d => d === STANCE.HAWKISH ? BIAS.BULLISH : d === STANCE.DOVISH ? BIAS.BEARISH : BIAS.NEUTRAL;
  const lines = [
    `📆 **EVENTS & CATALYSTS — ${sym}**`,
    ``,
    `Central bank watchlist (locked stances):`
  ];
  if (base.name) lines.push(`• ${base.name} — ${base.direction} / ${base.rateCycle} · terminal ${fmtNum(base.terminalBias, 2)} ${biasArrow(dir2Bias(base.direction))}`);
  if (quote.name && quote.name !== base.name) lines.push(`• ${quote.name} — ${quote.direction} / ${quote.rateCycle} · terminal ${fmtNum(quote.terminalBias, 2)} ${biasArrow(dir2Bias(quote.direction))}`);
  lines.push(
    ``,
    `Live cross-asset catalyst thresholds (monitored on 1H strip):`,
    `• DXY proxy cross of 100 → regime re-evaluation required ⬆️⬇️`,
    `• VIX proxy cross of 20 → volatility state flip ⬆️⬇️`,
    `• 10Y-2Y cross of zero → recession-risk channel flip ⬆️⬇️`,
    `• Credit stress cross of +0.25 → risk-off lean confirmed ⬇️`,
    `• Growth impulse cross of +0.20 → risk-on lean confirmed ⬆️`,
    ``,
    `Any cross of the above invalidates stale trade theses regardless of structural bias. Cross detection is live on the Corey module and feeds the next macro refresh.`
  );
  return lines.join('\n');
}

function buildHistoricalContext(sym, corey) {
  const g = corey.internalMacro?.global || {};
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const vixLevel = g.live?.vix?.level || 'Normal';
  const regimeResolution = {
    [REGIME.CRISIS]: 'safe-haven bid, DXY strength, equity drawdown, credit widening',
    [REGIME.EXPANSION]: 'risk-on rotation, DXY weakness, equity breadth expansion, commodity strength',
    [REGIME.CONTRACTION]: 'defensive rotation, bond bid, commodity weakness, FX carry unwind',
    [REGIME.GROWTH]: 'cyclical leadership, commodity strength, EM FX support, equity breadth',
    [REGIME.TRANSITION]: 'chop, single-day reversals, failed breakouts until regime resolves'
  }[regime] || 'chop until regime resolves';
  const paragraphs = [
    `**Regime analog (${regime}):** historical ${regime} windows in similar cross-asset contexts have resolved via ${regimeResolution}. The resolution path is conditional on the dominant channel remaining dominant — if the channel rotates mid-window, the analog fails and the regime reclassifies. ${g.riskEnv === RISK_ENV.RISK_ON ? '⬆️' : '⬇️'}`,
    `**Volatility analog (${vixLevel}):** VIX proxy at ${vixLevel} historically aligns with ${vixLevel === 'High' ? 'index drawdown continuation and DXY strength into the decline' : vixLevel === 'Low' ? 'continuation squeezes and low-range mean-reversion failures' : 'standard intraday mean-reversion windows with normal-range execution'}. Volatility analogs are the most reliable because vol-regime persistence is 70%+ over 5-session windows. ${vixLevel === 'High' ? '⬇️' : '⬆️'}`,
    `**Dollar analog (${g.dxyBias}):** DXY bias ${g.dxyBias} at score ${fmtNum(g.dxyScore, 2)} in prior cycles has preceded ${g.dxyBias === BIAS.BULLISH ? 'broad commodity pressure, EM FX weakness, and XAUUSD compression' : g.dxyBias === BIAS.BEARISH ? 'commodity rally, EM FX strength, and XAUUSD expansion' : 'range compression across majors with single-day reversals dominant'}. Dollar analogs are the most binary — sign matters more than magnitude inside this regime. ${g.dxyBias === BIAS.BEARISH ? '⬆️' : '⬇️'}`,
    `**Symbol-specific analog (${sym}):** prior moves in this regime have delivered directional follow-through when the dominant macro channel stayed uncontested for 5+ sessions; mean-reversion otherwise. Track the regime gate daily — one session of contested dominant driver is sufficient to flip the analog from follow-through to mean-reversion. ${corey.combinedBias === BIAS.BULLISH ? '⬆️' : corey.combinedBias === BIAS.BEARISH ? '⬇️' : '⬆️⬇️'}`
  ];
  return [`📚 **HISTORICAL CONTEXT — ${sym}**`, ``, ...paragraphs].join('\n\n');
}

function buildExecutionLogic(sym, jane, corey) {
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  if (jane.doNotTrade || jane.finalBias === BIAS.NEUTRAL) {
    return [
      `🎯 **EXECUTION LOGIC — ${sym}**`,
      ``,
      `IF conflict state is ${jane.conflictState} AND DNT flag active THEN stand aside — no entries.`,
      `IF HTF bias flips to aligned with macro (${corey.combinedBias}) THEN rebuild setup from scratch, do not re-use prior levels.`,
      `IF DNT flag clears AND structure confirms on 15M/5M THEN await entry zone before action.`,
      `IF dominant macro driver rotates (see Events & Catalysts thresholds) THEN invalidate all prior theses immediately.`,
      `IF regime reclassifies away from ${regime} THEN full reassessment required before next action.`
    ].join('\n');
  }
  const dir = jane.finalBias === BIAS.BULLISH ? 'LONG' : 'SHORT';
  const confirm = dir === 'LONG' ? 'LTF BOS or bullish CHoCH' : 'LTF BOS or bearish CHoCH';
  const ez = jane.entryZone;
  const inv = jane.invalidationLevel;
  const t = jane.targets || [];
  const lines = [
    `🎯 **EXECUTION LOGIC — ${sym}**`,
    ``,
    ez
      ? `IF price enters ${fmtPrice(ez.low, sym)} – ${fmtPrice(ez.high, sym)} AND ${confirm} confirms THEN enter ${dir} ${sym}.`
      : `IF price builds LTF confirmation AND ${confirm} prints THEN mark valid ${dir} entry.`,
    inv ? `IF price closes beyond ${fmtPrice(inv, sym)} THEN invalidate setup — exit immediately.` : null,
    t[0] ? `IF price reaches ${fmtPrice(t[0].level, sym)} THEN trail stop to entry.` : null,
    t[1] ? `IF price reaches ${fmtPrice(t[1].level, sym)} THEN book 50% partial, trail remainder.` : null,
    t[2] ? `IF price reaches ${fmtPrice(t[2].level, sym)} THEN close remainder, stand aside until next macro refresh.` : null,
    `IF regime reclassifies away from ${regime} THEN reassess thesis before next action.`,
    `IF any Events & Catalysts threshold crosses THEN invalidate all targets and re-evaluate.`
  ].filter(Boolean);
  return lines.join('\n');
}

function buildValidity(sym, corey) {
  const now = new Date();
  const iso = now.toISOString();
  const verLine = buildVerificationLine(sym, iso);
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const risk = corey.internalMacro?.global?.riskEnv || RISK_ENV.NEUTRAL;
  const next = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
  return [
    `✅ **VALIDITY**`,
    ``,
    `Generated: ${iso}`,
    `Regime: ${regime} · Risk: ${risk}`,
    `${verLine}`,
    `Valid until next regime check: ${next}`,
    `(Validity terminates immediately on any cross-asset threshold listed in Events & Catalysts.)`
  ].join('\n');
}

function formatMacro(sym, corey, spideyHTF, spideyLTF, jane) {
  return [
    buildTradeStatus(sym, jane, corey, spideyHTF, spideyLTF),
    buildPriceTable(sym, jane, spideyHTF),
    buildRoadmap(),
    buildEventIntel(sym, corey),
    buildMarketOverview(sym, corey),
    buildEventsCatalysts(sym, corey),
    buildHistoricalContext(sym, corey),
    buildExecutionLogic(sym, jane, corey),
    buildValidity(sym, corey)
  ];
}

function chunkMessage(text, max) {
  if (!text) return [];
  if (text.length <= max) return [text];
  const out = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if ((buf ? buf.length + 1 : 0) + line.length > max) {
      if (buf) out.push(buf);
      if (line.length > max) {
        for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
        buf = '';
      } else {
        buf = line;
      }
    } else {
      buf = buf ? buf + '\n' + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// ==============================
// DARK HORSE PIPELINE MACRO
// ==============================

async function runMacroPipeline(symbol) {
  const macro = await buildMacro(symbol);

  return {
    symbol,
    macro
  };
}
// ==============================
// ATLAS RENDER ENGINE — PUPPETEER + TV WIDGET
// ==============================
// Rendering delegated to renderer.js (Puppeteer + TradingView widget + custom candle colors)
// renderCharts imported at top of file
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.content.startsWith('!')) return;
    const userInput = msg.content.slice(1).trim();
    /* [SYMBOL] Phase 7 partial — ops pre-check. validateInput's ops branch
       compares against lowercase tokens, but resolveSymbol() uppercases its
       input before validateInput sees it, so the ops detection silently
       fails. Detecting ops here on the lowercased user input keeps the
       "silently return as before" behaviour for ping / stats / etc. and
       prevents the hard-fail reply below from triggering on them. */
    if (['ping','stats','errors','sysstate','darkhorse'].includes(userInput.toLowerCase())) return;
    const raw = resolveSymbol(userInput);
    const validation = validateInput('!' + raw);
    /* [SYMBOL] Phase 7 partial — hard-fail on unresolvable symbols per spec
       7.2. Two failure paths emit "Data unavailable for requested symbol:
       <RAW_INPUT>": (1) validateInput rejects with reason format /
       unknown_instrument; (2) validation passes but isResolvableSymbol
       returns false (catches the inferAssetClass /^[A-Z]{1,5}$/ catch-all
       and the 6-char unknown_instrument loophole that previously let HGUSD
       and XYZ123 through). Operational reasons (ops, extra_tokens, crypto,
       direction_term, generic_name) silently return as before — they are
       not symbol-resolution attempts. Every code path emits one [SYMBOL]
       line so future regressions are visible in logs. */
    if (!validation.valid) {
      if (validation.reason === 'format' || validation.reason === 'unknown_instrument') {
        console.log(`[SYMBOL] raw=${userInput} resolved=unknown outcome=unavailable reason=${validation.reason}`);
        await msg.channel.send({ content: `Data unavailable for requested symbol: ${userInput}` });
      }
      return;
    }
    const symbol = validation.symbol;
    if (!isResolvableSymbol(symbol)) {
      console.log(`[SYMBOL] raw=${userInput} resolved=unknown outcome=unavailable reason=not_in_allowlist mapped=${symbol}`);
      await msg.channel.send({ content: `Data unavailable for requested symbol: ${userInput}` });
      return;
    }
    console.log(`[SYMBOL] raw=${userInput} resolved=${symbol} outcome=served`);
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
    const user = USER_BY_ID[msg.author.id] || USER_BY_CHANNEL[msg.channelId] || 'AT';
    const atlasUrl = `https://atlas-fx-dashboard.onrender.com?symbol=${symbol}&user=${user}`;
    await msg.channel.send({ content: `📊 **${symbol}** — ATLAS Dashboard\n${atlasUrl}` });
  } catch (e) {
    console.error('handler error', e);
  }
});
  client.once('clientReady', async () => {

  console.log(`[READY] ATLAS FX Bot online as ${client.user.tag}`);

  // COREY LIVE DATA TEST
  dhInit(safeOHLC);

  dhSetPipelineTrigger(async (symbol, opts) => {
    log('INFO', `[DH PIPELINE] Triggered for ${symbol} (score: ${opts.dhScore})`);
    try {
      const result = await runMacroPipeline(symbol);
      log('INFO', `[DH PIPELINE] ${symbol} → ${result.macro.bias} (${result.macro.confidence})`);
    } catch (e) {
      log('ERROR', `[DH PIPELINE] ${symbol} failed: ${e.message}`);
    }
  });

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
// ── RENDERING LAYER v3 — RESOLUTION ──────────────────────────
const CHART_W=1920;
const CHART_H=1080;
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
const CENTRAL_BANKS=Object.freeze({
  USD:{name:'Federal Reserve',stance:STANCE.NEUTRAL,direction:STANCE.DOVISH,rateCycle:RATE_CYCLE.CUTTING,terminalBias:-0.10,inflationSensitivity:0.90,growthSensitivity:0.80},
  EUR:{name:'European Central Bank',stance:STANCE.DOVISH,direction:STANCE.DOVISH,rateCycle:RATE_CYCLE.CUTTING,terminalBias:-0.15,inflationSensitivity:0.85,growthSensitivity:0.70},
  GBP:{name:'Bank of England',stance:STANCE.NEUTRAL,direction:STANCE.DOVISH,rateCycle:RATE_CYCLE.HOLDING,terminalBias:-0.05,inflationSensitivity:0.90,growthSensitivity:0.75},
  JPY:{name:'Bank of Japan',stance:STANCE.HAWKISH,direction:STANCE.HAWKISH,rateCycle:RATE_CYCLE.HIKING,terminalBias:0.15,inflationSensitivity:0.65,growthSensitivity:0.60},
  AUD:{name:'Reserve Bank of Australia',stance:STANCE.HAWKISH,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0.10,inflationSensitivity:0.85,growthSensitivity:0.80},
  NZD:{name:'Reserve Bank of New Zealand',stance:STANCE.NEUTRAL,direction:STANCE.DOVISH,rateCycle:RATE_CYCLE.CUTTING,terminalBias:-0.10,inflationSensitivity:0.85,growthSensitivity:0.75},
  CAD:{name:'Bank of Canada',stance:STANCE.DOVISH,direction:STANCE.DOVISH,rateCycle:RATE_CYCLE.CUTTING,terminalBias:-0.15,inflationSensitivity:0.85,growthSensitivity:0.75},
  CHF:{name:'Swiss National Bank',stance:STANCE.DOVISH,direction:STANCE.DOVISH,rateCycle:RATE_CYCLE.CUTTING,terminalBias:-0.20,inflationSensitivity:0.75,growthSensitivity:0.65},
  SEK:{name:'Riksbank',stance:STANCE.DOVISH,direction:STANCE.DOVISH,rateCycle:RATE_CYCLE.CUTTING,terminalBias:-0.15,inflationSensitivity:0.75,growthSensitivity:0.65},
  NOK:{name:'Norges Bank',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0.05,inflationSensitivity:0.80,growthSensitivity:0.70},
  DKK:{name:'Danmarks Nationalbank',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.70,growthSensitivity:0.65},
  SGD:{name:'Monetary Authority of Singapore',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.80,growthSensitivity:0.75},
  HKD:{name:'Hong Kong Monetary Authority',stance:STANCE.NEUTRAL,direction:STANCE.NEUTRAL,rateCycle:RATE_CYCLE.HOLDING,terminalBias:0,inflationSensitivity:0.70,growthSensitivity:0.65},
  CNH:{name:"People's Bank of China Offshore",stance:STANCE.DOVISH,direction:STANCE.DOVISH,rateCycle:RATE_CYCLE.CUTTING,terminalBias:-0.10,inflationSensitivity:0.60,growthSensitivity:0.85},
  CNY:{name:"People's Bank of China",stance:STANCE.DOVISH,direction:STANCE.DOVISH,rateCycle:RATE_CYCLE.CUTTING,terminalBias:-0.10,inflationSensitivity:0.60,growthSensitivity:0.85},
});
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
/* [SYMBOL] Phase 7 partial — strict resolvability allowlist for the Discord
   bot. A symbol is resolvable iff it is either a valid FX pair (FX_QUOTES on
   both halves of a 6-char string) OR a member of one of the explicit symbol
   sets above. The catch-all /^[A-Z]{1,5}$/ branch in inferAssetClass() and
   the 6-char loophole in validateInput() must NOT be sufficient on their
   own — those let HGUSD / XYZ123 / etc. through even though the dashboard
   cannot render them, which surfaced as a silent EURUSD fallback in
   production. Adding membership in the explicit sets here fixes the bot
   side; dashboard-side strictness is a separate phase. */
const isResolvableSymbol=s=>!!s&&(isFxPair(s)||EQUITY_SYMBOLS.has(s)||COMMODITY_SYMBOLS.has(s)||INDEX_SYMBOLS.has(s));
function inferAssetClass(s){if(EQUITY_SYMBOLS.has(s))return ASSET_CLASS.EQUITY;if(COMMODITY_SYMBOLS.has(s))return ASSET_CLASS.COMMODITY;if(INDEX_SYMBOLS.has(s))return ASSET_CLASS.INDEX;if(isFxPair(s))return ASSET_CLASS.FX;if(/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s))return ASSET_CLASS.COMMODITY;if(/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s))return ASSET_CLASS.INDEX;if(/^[A-Z]{1,5}$/.test(s))return ASSET_CLASS.EQUITY;return ASSET_CLASS.UNKNOWN;}
function parsePairCore(symbol){const s=normalizeSymbol(symbol);if(isFxPair(s))return{symbol:s,base:s.slice(0,3),quote:s.slice(3,6),assetClass:ASSET_CLASS.FX};if(['XAUUSD','XAGUSD','BCOUSD'].includes(s))return{symbol:s,base:s.slice(0,3),quote:s.slice(3,6),assetClass:inferAssetClass(s)};return{symbol:s,base:s,quote:'USD',assetClass:inferAssetClass(s)};}
const makeStubCB=label=>({name:label||'Commodity',stance:STANCE.N_A,direction:STANCE.N_A,rateCycle:RATE_CYCLE.N_A,terminalBias:0,inflationSensitivity:0.5,growthSensitivity:0.5,score:0});
const makeStubEcon=()=>({gdpMomentum:0.5,employment:0.5,inflationControl:0.5,fiscalPosition:0.5,politicalStability:0.5,composite:0.5});

function getPipSize(symbol){const s=normalizeSymbol(symbol);if(s.includes('JPY'))return{pipSize:0.01,dp:3};if(s==='XAGUSD'||s==='XAGEUR')return{pipSize:0.01,dp:3};if(s==='XAUUSD'||s==='XAUEUR')return{pipSize:0.10,dp:2};if(/BCOUSD|USOIL|WTI|BRENT/.test(s))return{pipSize:0.01,dp:3};if(/NATGAS/.test(s))return{pipSize:0.001,dp:4};if(INDEX_SYMBOLS.has(s)||/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s))return{pipSize:1.0,dp:1};if(EQUITY_SYMBOLS.has(s)||SEMI_SYMBOLS.has(s))return{pipSize:0.01,dp:3};if(isFxPair(s))return{pipSize:0.0001,dp:5};return{pipSize:0.0001,dp:5};}
function fmtPrice(n,symbol){if(n==null||!Number.isFinite(n))return'N/A';if(symbol){const{dp}=getPipSize(symbol);return Number(n).toFixed(dp);}if(n>100)return Number(n).toFixed(2);if(n>1)return Number(n).toFixed(4);return Number(n).toFixed(5);}

const SYMBOL_OVERRIDES={XAUUSD:'OANDA:XAUUSD',XAGUSD:'OANDA:XAGUSD',BCOUSD:'OANDA:BCOUSD',USOIL:'OANDA:BCOUSD',NAS100:'OANDA:NAS100USD',US500:'OANDA:SPX500USD',US30:'OANDA:US30USD',GER40:'OANDA:DE30EUR',UK100:'OANDA:UK100GBP',NATGAS:'NYMEX:NG1!',MICRON:'NASDAQ:MU',AMD:'NASDAQ:AMD',ASML:'NASDAQ:ASML'};
const TD_SYMBOL_MAP={XAUUSD:'XAU/USD',XAGUSD:'XAG/USD',BCOUSD:'BCO/USD',USOIL:'WTI/USD',NAS100:'NDX',US500:'SPX',US30:'DIA',DJI:'DIA',GER40:'DAX',UK100:'UKX',NATGAS:'NG/USD',EURUSD:'EUR/USD',GBPUSD:'GBP/USD',USDJPY:'USD/JPY',AUDUSD:'AUD/USD',NZDUSD:'NZD/USD',USDCAD:'USD/CAD',USDCHF:'USD/CHF',EURGBP:'EUR/GBP',EURJPY:'EUR/JPY',GBPJPY:'GBP/JPY',AUDJPY:'AUD/JPY',CADJPY:'CAD/JPY',NZDJPY:'NZD/JPY',CHFJPY:'CHF/JPY',EURCHF:'EUR/CHF',EURAUD:'EUR/AUD',EURCAD:'EUR/CAD',GBPAUD:'GBP/AUD',GBPCAD:'GBP/CAD',GBPCHF:'GBP/CHF',AUDCAD:'AUD/CAD',AUDCHF:'AUD/CHF',AUDNZD:'AUD/NZD',CADCHF:'CAD/CHF',NZDCAD:'NZD/CAD',NZDCHF:'NZD/CHF',MICRON:'MU',AMD:'AMD',ASML:'ASML',NVDA:'NVDA'};
const TD_INTERVAL_MAP={'1W':'1week','1D':'1day','240':'4h','60':'1h','30':'30min','15':'15min','5':'5min','1':'1min'};
function getTVSymbol(s){if(SYMBOL_OVERRIDES[s])return SYMBOL_OVERRIDES[s];if(/^[A-Z]{6}$/.test(s))return`OANDA:${s}`;return`NASDAQ:${s}`;}
function getFeedName(s){const f=getTVSymbol(s).split(':')[0];return{OANDA:'OANDA',NASDAQ:'NASDAQ',NYSE:'NYSE',NYMEX:'NYMEX',TVC:'TVC'}[f]||f;}
const log=(level,msg,...a)=>console.log(`[${new Date().toISOString()}] [${level}] ${msg}`,...a);

const CRYPTO_KW=new Set(['BTC','ETH','XRP','SOL','DOGE','ADA','BNB','DOT','MATIC','AVAX','LINK','LTC','BCH','XLM','ALGO','ATOM','VET','ICP','BITCOIN','ETHEREUM','CRYPTO','USDT','USDC','SHIB','PEPE']);
const REJECTED_TERMS=new Set(['LH','HL','HH','LL','BUY','SELL','BULLISH','BEARISH','LONG','SHORT','MACRO','UP','DOWN','CALL','PUT','H','L']);
const REJECTED_GENERIC=new Set([]);
const SYMBOL_ALIASES={SILVER:'XAGUSD',XAG:'XAGUSD',GOLD:'XAUUSD',XAU:'XAUUSD',NASDAQ:'NAS100',NDX:'NAS100',NAS:'NAS100',SP500:'US500',SPX:'US500',DOW:'US30',DJI:'US30',DAX:'GER40',FTSE:'UK100',OIL:'USOIL',BRENT:'BCOUSD',WTI:'USOIL',GAS:'NATGAS',MICRON:'MU',ASML:'ASML',AMD:'AMD'};
function resolveSymbol(s){if(!s)return s;const up=s.toUpperCase().trim();return SYMBOL_ALIASES[up]||up;}
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
async function globalMacro(){
  const liveCtx=coreyLive.getMarketContext();
  const c={...DEFAULT_MARKET_CONTEXT,...liveCtx};
  let dxy=c.usdFlow*0.40+c.safeHavenFlow*0.20+c.creditStress*0.18+c.bondStress*0.12+c.realYieldPressure*0.10-c.growthImpulse*0.14-c.equityBreadth*0.12;
  dxy=round2(clamp(dxy));
  let risk=-c.geopoliticalStress*0.30-c.creditStress*0.22-c.bondStress*0.12-c.oilShock*0.12-c.recessionRisk*0.18-c.safeHavenFlow*0.20+c.growthImpulse*0.22+c.equityBreadth*0.22+c.aiCapexImpulse*0.08+c.semiconductorCycle*0.08;
  risk=round2(clamp(risk));
  const liveData=coreyLive.getLiveContext();
  if(liveData.lastUpdated){log('INFO',`[COREY-MACRO] live DXY:${liveData.dxy?.price?.toFixed(2)||'N/A'} VIX:${liveData.vix?.price?.toFixed(2)||'N/A'} Yield:${liveData.yield?.spread?.toFixed(2)||'N/A'} status:${liveData.status}`);}
  return{
    dxyScore:dxy,
    dxyBias:dxy>0.10?BIAS.BULLISH:dxy<-0.10?BIAS.BEARISH:BIAS.NEUTRAL,
    riskScore:risk,
    riskEnv:risk>0.12?RISK_ENV.RISK_ON:risk<-0.12?RISK_ENV.RISK_OFF:RISK_ENV.NEUTRAL,
    context:c,
    confidence:round2(clamp01(average([Math.abs(dxy),Math.abs(risk)]))),
    live:{dxy:liveData.dxy,vix:liveData.vix,yield:liveData.yield,status:liveData.status},
  };
}

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
// RENDERING LAYER v3 — ATLAS STYLE
// chart-img.com | POST JSON | 2048x1920 | pure black theme
// custom price box overlays | crisp PNG grid merge
// ============================================================
const CHART_IMG_API_KEY=process.env.CHART_IMG_API_KEY||null;
const BOX_HIGH='#FFD600';
const BOX_CURRENT='#00FF5A';
const BOX_ENTRY='#FF9100';
const BOX_LOW='#00B0FF';

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
    backgroundColor:'#000000',
    hideControls:true,
    zoom:2.2,
    padding:0,
    overrides:{
      'paneProperties.background':'#000000',
      'paneProperties.backgroundType':'solid',
      'paneProperties.vertGridProperties.color':'rgba(255,255,255,0.02)',
      'paneProperties.horzGridProperties.color':'rgba(255,255,255,0.02)',
      'paneProperties.crossHairProperties.color':'#1A1A1A',
      'paneProperties.vertGridProperties.style':2,
      'paneProperties.horzGridProperties.style':2,
      'paneProperties.legendProperties.showStudyArguments':false,
      'paneProperties.legendProperties.showStudyTitles':false,
      'paneProperties.legendProperties.showStudyValues':false,
      'paneProperties.legendProperties.showSeriesTitle':true,
      'paneProperties.legendProperties.showSeriesOHLC':true,
      'paneProperties.legendProperties.showLegend':true,
      'scalesProperties.backgroundColor':'#000000',
      'scalesProperties.textColor':'#9aa4ad',
      'scalesProperties.lineColor':'rgba(255,255,255,0.15)',
      'scalesProperties.fontSize':12,
      'symbolWatermarkProperties.transparency':100,
      'mainSeriesProperties.candleStyle.upColor':'#26A69A',
      'mainSeriesProperties.candleStyle.downColor':'#EF5350',
      'mainSeriesProperties.candleStyle.borderUpColor':'#26A69A',
      'mainSeriesProperties.candleStyle.borderDownColor':'#EF5350',
      'mainSeriesProperties.candleStyle.wickUpColor':'#26A69A',
      'mainSeriesProperties.candleStyle.wickDownColor':'#EF5350',
      'mainSeriesProperties.candleStyle.drawWick':true,
      'mainSeriesProperties.candleStyle.drawBorder':true,
      'mainSeriesProperties.candleStyle.barColorsOnPrevClose':false,
      'mainSeriesProperties.showPriceLine':false,
    },
    studies:[],
  });
  return new Promise((resolve,reject)=>{
    const opts={hostname:'api.chart-img.com',path:'/v2/tradingview/advanced-chart',method:'POST',headers:{'x-api-key':CHART_IMG_API_KEY,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'User-Agent':'ATLAS-FX/4.3.0'},timeout:60000};
    const req=https.request(opts,res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{if(res.statusCode!==200){const body=Buffer.concat(chunks).toString();reject(new Error(`chart-img ${res.statusCode}: ${body.slice(0,200)}`));return;}resolve(Buffer.concat(chunks));});});
    req.on('error',reject);req.on('timeout',()=>reject(new Error('chart-img timeout')));req.write(payload);req.end();
  });
}

function priceBoxSVG(label,value,color,y){
  const bw=120,bh=36,x=CHART_W-bw-4;
  return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${color}" rx="0"/>`
    +`<text x="${x+6}" y="${y+13}" font-family="monospace" font-size="9" font-weight="bold" fill="#000000">${label}</text>`
    +`<text x="${x+6}" y="${y+29}" font-family="monospace" font-size="12" font-weight="bold" fill="#000000">${value}</text>`;
}

async function overlayPriceBoxes(imgBuf,candles){
  if(!candles||candles.length<2)return imgBuf;
  const recent=candles.slice(-50);
  const high=Math.max(...recent.map(c=>c.high));
  const low=Math.min(...recent.map(c=>c.low));
  const current=candles[candles.length-1].close;
  const last=candles[candles.length-1];
  const entry=last.close>last.open?(last.low+last.close)/2:(last.high+last.close)/2;
  const fmt=v=>v>100?v.toFixed(2):v>1?v.toFixed(4):v.toFixed(5);
  const boxes=priceBoxSVG('HIGH',fmt(high),BOX_HIGH,50)
    +priceBoxSVG('CURRENT',fmt(current),BOX_CURRENT,96)
    +priceBoxSVG('ENTRY',fmt(entry),BOX_ENTRY,CHART_H-86)
    +priceBoxSVG('LOW',fmt(low),BOX_LOW,CHART_H-44);
  const overlaySvg=`<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg">${boxes}</svg>`;
  return sharp(imgBuf).composite([{input:Buffer.from(overlaySvg),top:0,left:0}]).png().toBuffer();
}

async function makePlaceholder(sym,tfKey,reason){
  const r2=(reason||'NO DATA').slice(0,60);
  const svg=`<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg"><rect width="${CHART_W}" height="${CHART_H}" fill="#000000"/><text x="${CHART_W/2}" y="${CHART_H/2-30}" font-family="monospace" font-size="48" fill="#222222" text-anchor="middle">${sym} ${tfKey}</text><text x="${CHART_W/2}" y="${CHART_H/2+30}" font-family="monospace" font-size="28" fill="#181818" text-anchor="middle">${r2}</text></svg>`;
  return sharp(Buffer.from(svg)).resize(CHART_W,CHART_H).png().toBuffer();
}

async function buildGrid(panels,tfKeys){
  const resized=await Promise.all(panels.map(async(img,i)=>{
    const base=await sharp(img).resize(CHART_W,CHART_H,{fit:'fill'}).png().toBuffer();
    const label=tfKeys&&tfKeys[i]?tfKeys[i]:'';
    if(!label)return base;
    const lw=label.length*12+20;
    const labelSvg=`<svg width="${CHART_W}" height="${CHART_H}" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="${lw}" height="26" fill="#000000"/><text x="18" y="27" font-family="monospace" font-size="15" font-weight="bold" fill="#888888">${label}</text></svg>`;
    return sharp(base).composite([{input:Buffer.from(labelSvg),top:0,left:0}]).png().toBuffer();
  }));
  const gw=CHART_W*2,gh=CHART_H*2;
  const divSvg=`<svg width="${gw}" height="${gh}" xmlns="http://www.w3.org/2000/svg"><line x1="${CHART_W}" y1="0" x2="${CHART_W}" y2="${gh}" stroke="#1A1A1A" stroke-width="2"/><line x1="0" y1="${CHART_H}" x2="${gw}" y2="${CHART_H}" stroke="#1A1A1A" stroke-width="2"/></svg>`;
  return sharp({create:{width:gw,height:gh,channels:4,background:{r:0,g:0,b:0,alpha:1}}})
    .composite([{input:resized[0],left:0,top:0},{input:resized[1],left:CHART_W,top:0},{input:resized[2],left:0,top:CHART_H},{input:resized[3],left:CHART_W,top:CHART_H},{input:Buffer.from(divSvg),left:0,top:0}])
    .png({compressionLevel:6}).toBuffer();
}

async function renderAllPanelsV3(symbol){
  log("INFO", "[CHART] " + symbol + " — rendering via Puppeteer/TradingView widget");
  const result = await renderAllPanels(symbol);
  return { ...result, htfFail: 0, ltfFail: 0, partial: false };
}
// ── END RENDERING LAYER v3 ────────────────────────────────────

// ==============================
// DELIVER RESULT — institutional orchestrator
// Output order: Chart 2×2 (HTF) → Chart 2×2 (LTF) →
//   Trade Status → Price Table → Roadmap →
//   Event Intelligence → Market Overview →
//   Events/Catalysts → Historical Context →
//   Execution Logic → Validity
// ==============================
async function deliverResult(msg, result) {
  const { symbol, htfGrid, ltfGrid, htfGridName, ltfGridName } = result;
  if (!htfGrid || !ltfGrid) {
    log('ERROR', `[DELIVER] ${symbol} missing chart grids`);
    await msg.channel.send({ content: `⚠️ Chart render failed for ${symbol} — macro aborted.` });
    return;
  }

  // 1. Chart 2×2 (HTF: Weekly · Daily · 4H · 1H)
  await msg.channel.send({
    content: `📡 **${symbol} — HTF** · Weekly · Daily · 4H · 1H`,
    files: [new AttachmentBuilder(htfGrid, { name: htfGridName })]
  });

  // 2. Chart 2×2 (LTF: 30M · 15M · 5M · 1M)
  await msg.channel.send({
    content: `🔬 **${symbol} — LTF** · 30M · 15M · 5M · 1M`,
    files: [new AttachmentBuilder(ltfGrid, { name: ltfGridName })]
  });

  // 3. Gather live data surface
  let corey, spideyHTF, spideyLTF, jane;
  try {
    [corey, spideyHTF, spideyLTF] = await Promise.all([
      runCorey(symbol),
      runSpideyHTF(symbol, HTF_INTERVALS),
      runSpideyLTF(symbol, LTF_INTERVALS)
    ]);
    jane = runJane(symbol, spideyHTF, spideyLTF, corey);
  } catch (e) {
    log('ERROR', `[DELIVER] ${symbol} data gather failed: ${e.message}`);
    await msg.channel.send({ content: `⚠️ Macro data unavailable for ${symbol}: ${e.message}` });
    return;
  }

  // 4. Build and deliver all text sections in locked order
  const sections = formatMacro(symbol, corey, spideyHTF, spideyLTF, jane);
  for (const section of sections) {
    for (const chunk of chunkMessage(section, DISCORD_MAX)) {
      await msg.channel.send({ content: chunk });
    }
  }
}
client.login(TOKEN);
