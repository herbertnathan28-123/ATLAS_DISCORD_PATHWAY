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

const ATLAS_INSTANCE_ID=process.env.ATLAS_INSTANCE_ID||null;
const ATLAS_SIGNING_SECRET=process.env.ATLAS_SIGNING_SECRET||null;
const ATLAS_WATERMARK_ENABLED=process.env.ATLAS_WATERMARK_ENABLED==='true';
const ATLAS_SIGNATURE_ENABLED=process.env.ATLAS_SIGNATURE_ENABLED==='true';
const AUTH_AVAILABLE=!!(ATLAS_INSTANCE_ID&&ATLAS_SIGNING_SECRET);
if(AUTH_AVAILABLE){console.log(`[BOOT] AUTH: VERIFIED — instance:${ATLAS_INSTANCE_ID} sig:${ATLAS_SIGNATURE_ENABLED} watermark:${ATLAS_WATERMARK_ENABLED}`);}
else{console.log('[BOOT] AUTH: UNVERIFIED — auth env vars absent. TRADE PERMITTED permanently blocked.');}
function generateSignature(payload){if(!AUTH_AVAILABLE||!ATLAS_SIGNATURE_ENABLED)return null;return createHmac('sha256',ATLAS_SIGNING_SECRET).update(payload).digest('hex').slice(0,12).toUpperCase();}
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

// ==============================
// AUDIT LOGGER — fire-and-forget Discord webhook on every symbol
// resolution attempt that reaches the resolver. MUST NOT block the
// user reply. Failures are logged with [AUDIT-LOG] tag and swallowed.
// No user-facing surface mentions this logger anywhere.
// ==============================
const AUDIT_LOG_WEBHOOK_URL = process.env.AUDIT_LOG_WEBHOOK_URL || null;
if (!AUDIT_LOG_WEBHOOK_URL) {
  console.log('[AUDIT-LOG] webhook URL not set — audit logging disabled');
}
const AUDIT_OUTCOME_COLOR = { served: 0x00b050, unavailable: 0xe74c3c, policy_rejected: 0xff9100 };
function emitAuditLog(event) {
  if (!AUDIT_LOG_WEBHOOK_URL) return;
  setImmediate(() => {
    let parsed;
    try { parsed = new URL(AUDIT_LOG_WEBHOOK_URL); }
    catch (e) { console.error(`[AUDIT-LOG] invalid webhook URL: ${e.message}`); return; }
    const embed = {
      title: `ATLAS Symbol Audit — ${event.outcome}`,
      color: AUDIT_OUTCOME_COLOR[event.outcome] ?? 0x808080,
      timestamp: event.timestamp,
      fields: [
        { name: 'User',            value: `${event.discord_user_display_name} (\`${event.discord_user_id}\`)`, inline: false },
        { name: 'Channel',         value: event.channel_name ? `#${event.channel_name} (\`${event.channel_id}\`)` : `\`${event.channel_id}\``, inline: false },
        { name: 'Raw Input',       value: `\`${event.raw_input}\``, inline: true },
        { name: 'Resolved Symbol', value: `\`${event.resolved_symbol}\``, inline: true },
        { name: 'Outcome',         value: event.outcome, inline: true },
        { name: 'Reason',          value: event.reason == null ? 'n/a' : event.reason, inline: true },
      ],
    };
    const body = JSON.stringify({ embeds: [embed] });
    const opts = {
      method: 'POST',
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 5000,
    };
    const lib = parsed.protocol === 'http:' ? http : https;
    try {
      const req = lib.request(opts, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error(`[AUDIT-LOG] webhook responded HTTP ${res.statusCode}`);
        }
        res.on('data', () => {});
        res.on('error', (e) => console.error(`[AUDIT-LOG] response error: ${e.message}`));
      });
      req.on('error',   (e) => console.error(`[AUDIT-LOG] request error: ${e.message}`));
      req.on('timeout', ()  => { console.error('[AUDIT-LOG] request timeout'); req.destroy(); });
      req.write(body);
      req.end();
    } catch (e) {
      console.error(`[AUDIT-LOG] unexpected failure: ${e.message}`);
    }
  });
}


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

// ==============================
// TRADER-LANGUAGE TRANSLATION LAYER — v2.0
// Turns scores, probabilities, alignment metrics and invalidation signals
// into plain-English guidance. Used by every build function below.
// ==============================

// Driver headline → plain-English trader label
const DRIVER_LABEL = {
  oilShock: 'oil prices',
  creditStress: 'credit stress',
  geopoliticalStress: 'geopolitical risk',
  growthImpulse: 'growth data',
  usdFlow: 'the US dollar',
  safeHavenFlow: 'safe-haven flows',
  bondStress: 'bond-market stress',
  recessionRisk: 'recession risk',
  equityBreadth: 'equity breadth',
  realYieldPressure: 'real yields'
};

// Readiness score 1–10 derived from conviction + alignment + DNT
function readinessScore(jane) {
  const conv = Math.max(0, Math.min(1, Number(jane.conviction) || 0));
  let score = Math.round(conv * 10);
  if (!jane.ltfAligned) score -= 2;
  if (jane.conflictState === 'HardConflict') score -= 2;
  else if (jane.conflictState === 'PartialConflict') score -= 1;
  if (jane.doNotTrade) score = Math.min(score, 3);
  return Math.max(1, Math.min(10, score));
}

function readinessMeaning(score) {
  if (score >= 8) return 'Clean, high-confidence environment. Structure and macro point the same way and the evidence is stacked.';
  if (score >= 6) return 'Workable environment. Direction is clear enough to act on confirmation, but edges are not overwhelming.';
  if (score >= 4) return 'Mixed-quality environment. Direction exists, but conviction is not strong and false starts are more likely.';
  if (score >= 2) return 'Poor environment. Key forces are pulling in different directions and follow-through is unreliable.';
  return 'Do-not-trade environment. There is no tradable edge right now.';
}

// Conviction label → plain English
function convictionMeaning(label) {
  if (label === 'High') return 'The weight of evidence clearly supports one side.';
  if (label === 'Medium') return 'The edge exists but is not overwhelming — confirmation is required before entry.';
  if (label === 'Low') return 'The edge is thin. Reduced exposure only, and only on clean confirmation.';
  return 'Evidence is fragmented. Stand aside.';
}

// Continuation / Range / Reversal probabilities from structure + conviction
function pathProbabilities(htf, jane) {
  const conv = Math.max(0, Math.min(1, Number(jane.conviction) || 0));
  const first = Object.values(htf.timeframes || {})[0] || {};
  const structure = first.structure || 'Range';
  let cont, range, rev;
  if (structure === 'Trending') {
    cont = Math.round(48 + conv * 30);
    range = Math.round((100 - cont) * 0.55);
    rev = 100 - cont - range;
  } else if (structure === 'Transition') {
    cont = Math.round(38 + conv * 18);
    range = Math.round((100 - cont) * 0.6);
    rev = 100 - cont - range;
  } else if (structure === 'Range') {
    cont = 26; range = 54; rev = 20;
  } else {
    cont = 33; range = 40; rev = 27;
  }
  if (!jane.ltfAligned) { cont = Math.max(15, cont - 8); range += 5; rev = 100 - cont - range; }
  return { cont, range, rev };
}

function probabilityMeaning(p) {
  const { cont, range, rev } = p;
  if (cont >= rev + 20 && cont > range) return 'Price is more likely to continue in the current direction than stall or reverse.';
  if (rev >= cont + 15) return 'The tape is leaning toward a turn rather than further continuation.';
  if (range >= 50) return 'Sideways drift is the dominant outcome until structure resolves.';
  return 'No path is clearly favoured. Expect choppy, low-quality moves.';
}

// Macro alignment — how many major drivers point the same way
function macroAlignment(corey) {
  const ctx = corey.internalMacro?.global?.context || {};
  const inputs = [
    { name: 'the US dollar', v: ctx.usdFlow || 0 },
    { name: 'growth impulse', v: ctx.growthImpulse || 0 },
    { name: 'equity breadth', v: ctx.equityBreadth || 0 },
    { name: 'credit stress', v: -(ctx.creditStress || 0) }
  ];
  const signs = inputs.map(i => Math.sign(i.v)).filter(s => s !== 0);
  const total = 4;
  if (signs.length === 0) return { label: 'Weak', count: 0, total, meaning: 'The major forces have no dominant direction. Treat as low-conviction.' };
  const pos = signs.filter(s => s > 0).length;
  const neg = signs.filter(s => s < 0).length;
  const strongest = Math.max(pos, neg);
  if (strongest >= 3) return { label: 'Strong', count: strongest, total, meaning: 'The key drivers agree, which supports conviction and reduces the need to wait for extra confirmation.' };
  if (strongest === 2) return { label: 'Mixed', count: strongest, total, meaning: 'Some drivers agree, others do not. This weakens conviction and raises the bar for entry.' };
  return { label: 'Weak', count: strongest, total, meaning: 'The major forces are not pointing the same way, which lowers confidence and increases noise.' };
}

// ATLAS verdict — one-word command + one-line reason
function atlasVerdict(jane) {
  if (jane.doNotTrade) return { word: 'Wait', reason: 'Conditions are mixed and not clean enough for aggressive entries.' };
  if (jane.convictionLabel === 'High') return { word: 'Prepare', reason: 'Conditions support action once structure confirms on the lower timeframe.' };
  if (jane.convictionLabel === 'Medium') return { word: 'Prepare with caution', reason: 'Direction is workable, but confirmation is required before entry.' };
  if (jane.convictionLabel === 'Low') return { word: 'Stand aside', reason: 'Edge is thin. Only act on clean confirmation, with reduced exposure.' };
  return { word: 'Stand aside', reason: 'Evidence is fragmented. There is no tradable plan right now.' };
}

// Dollar-first distance converter — $ primary, pips secondary (bracketed)
function dollarPerPip(symbol, lotSize = 1.0) {
  const s = normalizeSymbol(symbol);
  if (s.includes('JPY')) return 8.0 * lotSize;
  if (s === 'XAUUSD') return 10.0 * lotSize;
  if (s === 'XAGUSD') return 5.0 * lotSize;
  if (/USOIL|WTI|BCOUSD|BRENT/.test(s)) return 10.0 * lotSize;
  if (INDEX_SYMBOLS.has(s) || /NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s)) return 1.0 * lotSize;
  if (EQUITY_SYMBOLS.has(s)) return 1.0 * lotSize;
  return 10.0 * lotSize;
}

function distanceAsDollars(distance, symbol) {
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const { pipSize } = getPipSize(symbol);
  const pips = Math.round((distance / pipSize) * 10) / 10;
  const dollars = Math.round(pips * dollarPerPip(symbol));
  const ac = inferAssetClass(normalizeSymbol(symbol));
  // Equity / index / commodity outputs use dollar-only language; FX outputs
  // append a points context (no "pips" wording, even for FX, per equity-aware
  // language filter).
  let text;
  if (ac === ASSET_CLASS.EQUITY) text = `$${dollars} per share`;
  else if (ac === ASSET_CLASS.INDEX) text = `$${dollars} per contract`;
  else if (ac === ASSET_CLASS.COMMODITY) text = `$${dollars}`;
  else text = `$${dollars} (≈ ${pips} pts)`;
  return { dollars, pips, text };
}

// Minimum necessary structural buffer — doctrine-compliant
function structuralBufferPrice(symbol) {
  const { pipSize } = getPipSize(symbol);
  return pipSize * 8; // 8 pip-equivalents minimum for execution reality
}

function bufferDollarDescription(symbol) {
  const d = distanceAsDollars(structuralBufferPrice(symbol), symbol);
  return d ? d.text : '$0';
}

// Setup-age classifier — fresh / valid / weakening / expired
function classifySetupAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 'Fresh';
  const hours = ageMs / 3600000;
  if (hours < 24) return 'Fresh';
  if (hours < 96) return 'Valid';
  if (hours < 240) return 'Weakening';
  return 'Expired';
}

// Format a timestamp as "18 Apr 11:00 UTC"
function fmtUtcShort(ms) {
  if (!ms || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const day = d.getUTCDate();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} UTC`;
}

// Structure timeline — BOS / zone origin / setup age, with timeframe bolded
function structureTimeline(htf, ltf) {
  const pool = [
    { label: '1W',  data: htf?.timeframes?.['1W']  },
    { label: '1D',  data: htf?.timeframes?.['1D']  },
    { label: '4H',  data: htf?.timeframes?.['240'] },
    { label: '1H',  data: htf?.timeframes?.['60']  },
    { label: '30M', data: ltf?.timeframes?.['30']  },
    { label: '15M', data: ltf?.timeframes?.['15']  },
    { label: '5M',  data: ltf?.timeframes?.['5']   }
  ];
  let bos = null;
  // Prefer HTF break if present, fall back to first LTF break
  for (const t of pool) {
    if (t.data && t.data.lastBreak && t.data.lastBreak !== 'None') {
      bos = { tf: t.label, kind: t.data.lastBreak, direction: t.data.breakDirection, level: t.data.breakLevel };
      break;
    }
  }
  let zone = null;
  for (const t of pool) {
    if (!t.data) continue;
    if (t.data.activeSupply) { zone = { tf: t.label, kind: 'supply', high: t.data.activeSupply.high, low: t.data.activeSupply.low, time: t.data.activeSupply.time }; break; }
    if (t.data.activeDemand) { zone = { tf: t.label, kind: 'demand', high: t.data.activeDemand.high, low: t.data.activeDemand.low, time: t.data.activeDemand.time }; break; }
  }
  const now = Date.now();
  const zoneTimeMs = zone?.time ? (typeof zone.time === 'number' ? zone.time * 1000 : new Date(zone.time).getTime()) : null;
  const age = zoneTimeMs ? classifySetupAge(now - zoneTimeMs) : (bos ? 'Fresh' : 'No setup yet');
  return { bos, zone, zoneTimeMs, age };
}

// Permit status — must reconcile with Trade Status. Never returns
// "permit available" when readiness is low or the system has flagged a block.
function permitPlain(jane, readiness) {
  if (!AUTH_AVAILABLE) return 'Trade permit is BLOCKED — ATLAS is running without authentication. Charts and analysis remain available; execution is disabled.';
  if (!isTradePermitAllowed()) return 'Trade permit is BLOCKED — ATLAS is in build mode. Analysis is fully live; execution is disabled until the system is promoted to operational.';
  if (jane && jane.doNotTrade) return `Trade permit is BLOCKED — ${jane.doNotTradeReason || 'do-not-trade conditions are active.'}`;
  const r = Number.isFinite(readiness) ? readiness : (jane ? readinessScore(jane) : 0);
  if (r <= 3) return `Trade permit is BLOCKED — Market Readiness ${r}/10 is below the minimum bar (4/10) for capital. The setup is not mature enough to risk capital.`;
  if (jane && jane.convictionLabel === 'Abstain') return 'Trade permit is BLOCKED — no authorised trade conviction. The system does not have enough clean evidence to risk capital. This does not mean price will not move.';
  if (jane && jane.convictionLabel === 'Low') return 'Trade permit is CONDITIONAL — only experienced traders, only with reduced exposure, and only on confirmed lower-timeframe structure inside the entry zone.';
  return 'Trade permit is AVAILABLE — execution unlocks the moment lower-timeframe structure confirms inside the entry zone, sized to the dollar risk in the Execution tab.';
}

function buildTradeStatus(sym, jane, corey, htf, ltf) {
  const bias = jane.finalBias;
  const conv = jane.conviction;
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const risk = corey.internalMacro?.global?.riskEnv || RISK_ENV.NEUTRAL;
  const verdict = atlasVerdict(jane);
  const readiness = readinessScore(jane);
  const align = macroAlignment(corey);
  const paths = pathProbabilities(htf, jane);

  // Plain-English explanations for required vague-term coverage.
  const biasExplain = bias === BIAS.NEUTRAL
    ? 'NEUTRAL means ATLAS cannot choose buy or sell with enough confidence yet. Direction is not forbidden — it is unproven.'
    : `${bias.toUpperCase()} means ATLAS sees the higher-timeframe and macro layer leaning ${bias.toLowerCase()}, but the trade still requires lower-timeframe confirmation before it is acted on.`;
  const convictionLine = jane.convictionLabel === 'Abstain'
    ? `Conviction: NO AUTHORISED TRADE CONVICTION. This does not mean price will not move. It means the system does not have enough clean evidence to risk capital.`
    : `Conviction: ${jane.convictionLabel} (${pctLabel(conv)}). ${convictionMeaning(jane.convictionLabel)}`;
  const readinessLine = `${readinessMeaning(readiness)} A ${readiness}/10 score means ${readiness} of the 10 ATLAS readiness conditions are currently satisfied. ${readiness <= 3 ? 'The setup is NOT mature enough for capital. Trade Permit MUST be BLOCKED.' : readiness <= 5 ? 'The setup is partially mature — execution remains conditional on lower-timeframe confirmation.' : 'The setup is mature; standard execution rules apply.'}`;

  // Most-likely-behaviour explanations + close-call guard.
  const sortedPaths = [
    { name: 'Continuation', value: paths.cont, def: 'price attempts to keep following the current dominant direction.' },
    { name: 'Range', value: paths.range, def: 'price moves sideways between nearby liquidity, taking out short-term highs and lows without resolving.' },
    { name: 'Reversal', value: paths.rev, def: 'price rejects the current direction and moves the other way through structure.' }
  ].sort((a, b) => b.value - a.value);
  const closeCall = (sortedPaths[0].value - sortedPaths[1].value) <= 5;

  // Permit reconciliation: if Trade Status says blocked, permit MUST say blocked.
  const permit = permitPlain(jane, readiness);
  const blocked = jane.doNotTrade || readiness <= 3 || jane.convictionLabel === 'Abstain' || /BLOCKED/.test(permit);

  // Plain-English verdict paragraph.
  const verdictPlain = blocked
    ? `${verdict.word}. ${verdict.reason} The system is NOT authorising new capital here. This is a decision, not a stop sign — direction may still develop; ATLAS is telling you the read does not yet meet the bar to risk capital.`
    : `${verdict.word}. ${verdict.reason} The plan below is live; act only when the lower-timeframe trigger inside the entry zone confirms.`;

  // "Why" — the actual conflict, in plain language.
  const whyParts = [];
  if (htf.dominantBias !== BIAS.NEUTRAL && ltf.dominantBias !== BIAS.NEUTRAL && htf.dominantBias !== ltf.dominantBias) {
    whyParts.push(`Higher timeframe is ${htf.dominantBias.toLowerCase()} but lower timeframe is ${ltf.dominantBias.toLowerCase()} — the two layers disagree.`);
  }
  if (corey.combinedBias === BIAS.NEUTRAL) whyParts.push('Corey’s macro composite is neutral — no policy or cross-asset edge to lean on.');
  if (regime === REGIME.TRANSITION) whyParts.push('Regime is in transition — failed breaks and one-session reversals are common until structure resolves.');
  if (closeCall) whyParts.push(`Top two scenarios (${sortedPaths[0].name} ${sortedPaths[0].value}% vs ${sortedPaths[1].name} ${sortedPaths[1].value}%) are within 5 percentage points — the leading path is not strong enough to create an edge.`);
  if (jane.doNotTrade) whyParts.push(`Specific block: ${jane.doNotTradeReason || 'do-not-trade conditions are active.'}`);
  if (whyParts.length === 0) whyParts.push('No major conflict — structure, macro and regime are aligned.');

  return [
    `📊 **TRADE STATUS — ${sym}**`,
    ``,
    `**ATLAS VERDICT**`,
    `${verdict.word.toUpperCase()}`,
    ``,
    `**PLAIN ENGLISH**`,
    verdictPlain,
    ``,
    `**WHY**`,
    whyParts.map(p => `• ${p}`).join('\n'),
    ``,
    `**MARKET READINESS — ${readiness} / 10**`,
    readinessLine,
    ``,
    `**DOMINANT BIAS**`,
    `${bias}  ${dotScale(conv)}`,
    `${mixedArrows(bias, conv)}`,
    biasExplain,
    convictionLine,
    ``,
    `**MOST LIKELY BEHAVIOUR**`,
    `Continuation — ${paths.cont}% (${sortedPaths.find(p => p.name === 'Continuation').def})`,
    `Range — ${paths.range}% (${sortedPaths.find(p => p.name === 'Range').def})`,
    `Reversal — ${paths.rev}% (${sortedPaths.find(p => p.name === 'Reversal').def})`,
    closeCall ? '⚠️ The leading path is not strong enough to create an edge. Treat the read as conditional until the spread widens.' : `${probabilityMeaning(paths)}`,
    ``,
    `**MACRO ALIGNMENT — ${align.label} (${align.count}/${align.total})**`,
    `${align.meaning}`,
    ``,
    `**STRUCTURE SNAPSHOT**`,
    `Higher timeframe: ${htf.dominantBias} ${biasArrow(htf.dominantBias)} at ${pctLabel(htf.dominantConviction)} conviction.`,
    `Lower timeframe: ${ltf.dominantBias} ${biasArrow(ltf.dominantBias)} at ${pctLabel(ltf.dominantConviction)} conviction — ${jane.ltfAligned ? 'agrees with the higher timeframe' : 'disagrees with the higher timeframe, which weakens the plan'}.`,
    `Macro (Corey): ${corey.combinedBias} ${biasArrow(corey.combinedBias)} at composite score ${fmtNum(corey.combinedScore, 2)}.`,
    `Regime: ${regime}. Risk environment: ${risk}.`,
    ``,
    `**WHAT TO DO**`,
    blocked
      ? 'New trader: stand aside. Do not pre-position.\nExperienced trader: do not override. Wait for structure and macro to re-align before any new entry.'
      : (jane.convictionLabel === 'High'
          ? 'New trader: prepare the entry. Act only on confirmation, with planned size.\nExperienced trader: act on lower-timeframe confirmation inside the entry zone, sized to the dollar risk in the Execution tab.'
          : 'New trader: stand aside until confirmation prints.\nExperienced trader: act only after lower-timeframe confirmation, with reduced exposure if macro alignment is not strong.'),
    ``,
    `**WHEN TO ACT**`,
    blocked
      ? 'Only once the listed conflict clears AND lower-timeframe structure rebuilds AND a fresh entry zone forms.'
      : 'Only once lower-timeframe structure confirms the direction shown above (BOS or CHoCH on at least the 1H), AND price is inside the planned entry zone.',
    ``,
    `**WHEN TO STAND ASIDE**`,
    'If confirmation does not appear inside the current session, if macro alignment weakens further, or if any catalyst in the Events & Catalysts tab crosses its threshold. No trade is always a valid decision.',
    ``,
    `**TRADE PERMIT**`,
    permit
  ].join('\n');
}

// FORWARD EXPECTATION — daily-movement context driven from the same OHLC the
// engines already consume; no new data sources.
function buildForwardExpectation(sym, jane, corey, htf, ltf, candlesByTf) {
  const ac = inferAssetClass(normalizeSymbol(sym));
  const isEquity = ac === ASSET_CLASS.EQUITY;
  const isIndex = ac === ASSET_CLASS.INDEX;
  const isCommodity = ac === ASSET_CLASS.COMMODITY;
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const vol = corey.internalMacro?.global?.live?.vix?.level || 'Normal';
  const bias = jane.finalBias;

  // Expected behaviour
  let expectedBehaviour;
  if (jane.doNotTrade || regime === REGIME.TRANSITION) expectedBehaviour = 'CHOP — failed breaks and one-session reversals are likely until structure or macro confirms.';
  else if (vol === 'High' && !jane.ltfAligned) expectedBehaviour = 'ABSORB / WAIT FOR CATALYST — elevated volatility plus disagreement between higher and lower timeframes typically absorbs the remaining session range without committing direction.';
  else if (bias === BIAS.NEUTRAL) expectedBehaviour = 'RANGE — no directional edge. Expect price to rotate between nearby liquidity until structure resolves.';
  else if (jane.convictionLabel === 'High' && jane.ltfAligned) expectedBehaviour = `CONTINUATION (${bias.toLowerCase()}) — structure and macro agree. Pullback into the entry zone is the most likely setup.`;
  else if (jane.ltfConflict) expectedBehaviour = 'WAIT FOR STRUCTURE — lower timeframe disagrees with higher. The next clean structural break decides direction.';
  else expectedBehaviour = `WAIT FOR CONFIRMATION — directional lean is ${bias.toLowerCase()} but conviction is below the action threshold; a confirmed lower-timeframe break is required.`;

  // Expected timing
  let timingLine;
  if (regime === REGIME.TRANSITION || jane.doNotTrade) timingLine = 'No reliable time estimate is available. Structure confirmation is required before timing becomes useful.';
  else if (vol === 'High') timingLine = 'Until the next catalyst — elevated volatility tends to compress decision-making into event windows rather than steady drift.';
  else if (jane.convictionLabel === 'High') timingLine = 'Next 1–2 hours — the active edge is short-dated; act on the next confirmation or stand aside until the next regime check.';
  else timingLine = 'Until next regime check (4 hours) — no clean time signature without lower-timeframe structure.';

  // Daily movement context
  const daily = candlesByTf && candlesByTf['1D'];
  let movementBlock;
  if (Array.isArray(daily) && daily.length >= 21) {
    const last20 = daily.slice(-21, -1);
    const ranges = last20.map(c => c.high - c.low).filter(Number.isFinite);
    const typicalRange = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
    const today = daily[daily.length - 1];
    const seenSoFar = today ? Math.abs(today.high - today.low) : 0;
    const remaining = Math.max(0, typicalRange - seenSoFar);
    const fmt = v => isCommodity ? `$${v.toFixed(2)}` : isIndex ? `${v.toFixed(0)} pts` : `$${v.toFixed(2)}`;
    const unit = isEquity ? ' per share' : isIndex ? ' per contract' : '';
    const messy = vol === 'High' || regime === REGIME.TRANSITION || closeCallish(jane);
    movementBlock = [
      `Typical daily movement (last 20 sessions): approx. ${fmt(typicalRange)}${unit}.`,
      `Movement already seen today: approx. ${fmt(seenSoFar)}${unit}.`,
      `Estimated movement remaining: approx. ${fmt(remaining)}${unit}.`,
      ``,
      messy
        ? 'Remaining movement is NOT automatically tradable. In mixed conditions, unused range is often absorbed through chop, false breaks, or late-session drift.'
        : 'Remaining movement is more likely than usual to be clean given current alignment, but still requires lower-timeframe structure before acting.'
    ].join('\n');
  } else {
    movementBlock = 'Daily movement data unavailable for this session — typical range and remaining-range estimates suppressed.';
  }

  // Remaining-movement absorption
  let absorption;
  if (jane.doNotTrade || jane.finalBias === BIAS.NEUTRAL) absorption = 'No reliable directional assignment for the remaining range. Expect sideways absorption inside the current intraday range.';
  else if (bias === BIAS.BULLISH && jane.ltfAligned) absorption = 'Likely UPWARD into nearby resistance / liquidity above current price. Confirm with lower-timeframe break before acting.';
  else if (bias === BIAS.BEARISH && jane.ltfAligned) absorption = 'Likely DOWNWARD into nearby support / demand below current price. Confirm with lower-timeframe break before acting.';
  else absorption = 'Held back until the next catalyst or until lower-timeframe structure agrees with the higher timeframe.';

  // What the trader is waiting for — exact, not generic.
  const waitingFor = (() => {
    if (jane.doNotTrade) return `The named conflict above to clear AND a fresh structural break (BOS or CHoCH) on at least the 1H AND a fresh ${bias === BIAS.BULLISH ? 'demand zone or bullish imbalance' : bias === BIAS.BEARISH ? 'supply zone or bearish imbalance' : 'directional zone'} below/above current price.`;
    if (bias === BIAS.NEUTRAL) return 'A confirmed bullish OR bearish break (BOS / CHoCH) on the 1H or higher with a candle close beyond the break level.';
    return `A ${bias.toLowerCase()} BOS or CHoCH on at least the 1H (candle close beyond the break level), followed by a pullback into the resulting ${bias === BIAS.BULLISH ? 'demand zone or imbalance' : 'supply zone or imbalance'}.`;
  })();

  return [
    `🧭 **FORWARD EXPECTATION — NEXT SESSION WINDOW — ${sym}**`,
    ``,
    `**EXPECTED BEHAVIOUR**`,
    expectedBehaviour,
    ``,
    `**EXPECTED TIMING**`,
    timingLine,
    ``,
    `**DAILY MOVEMENT CONTEXT**`,
    movementBlock,
    ``,
    `**REMAINING MOVEMENT ABSORPTION**`,
    absorption,
    ``,
    `**WHAT THE TRADER IS WAITING FOR**`,
    waitingFor
  ].join('\n');
}

function closeCallish(jane) {
  return jane.convictionLabel === 'Low' || jane.convictionLabel === 'Abstain' || jane.conflictState === 'PartialConflict' || jane.conflictState === 'HardConflict';
}

// TRIGGER MAP — exact levels and timeframes; no generic "lower timeframe" alone.
function buildTriggerMap(sym, jane, htf, ltf) {
  const cp = htf.currentPrice || ltf.currentPrice || 0;
  const tf1H = htf.timeframes?.['60'] || {};
  const tf4H = htf.timeframes?.['240'] || {};
  const tf30 = ltf.timeframes?.['30'] || {};
  const tf15 = ltf.timeframes?.['15'] || {};

  const bullDemand = tf1H.activeDemand || tf4H.activeDemand || tf30.activeDemand;
  const bullBOS = (tf1H.swingHighs && tf1H.swingHighs.length) ? tf1H.swingHighs[tf1H.swingHighs.length - 1].level : null;
  const bearSupply = tf1H.activeSupply || tf4H.activeSupply || tf30.activeSupply;
  const bearBOS = (tf1H.swingLows && tf1H.swingLows.length) ? tf1H.swingLows[tf1H.swingLows.length - 1].level : null;

  const aboveBOS = Number.isFinite(bullBOS) ? fmtPrice(bullBOS, sym) : 'pending';
  const belowBOS = Number.isFinite(bearBOS) ? fmtPrice(bearBOS, sym) : 'pending';
  const noTradeLow = Number.isFinite(bearBOS) ? fmtPrice(bearBOS, sym) : 'pending';
  const noTradeHigh = Number.isFinite(bullBOS) ? fmtPrice(bullBOS, sym) : 'pending';

  return [
    `🎯 **TRIGGER MAP — ${sym}**`,
    ``,
    `**BULLISH SHIFT**`,
    `• Timeframe: 1H (aggressive: 30M for intraday confirmation; broader: 4H for structural confirmation).`,
    `• Level: confirmed close above ${aboveBOS} (1H structure-break reference).`,
    `• Candle close: full 1H candle close beyond the level — wicks alone do NOT qualify.`,
    `• Zone requirement: a fresh DEMAND zone (or bullish imbalance) created by the displacement off the break — pullback into that zone is the entry trigger, not the break itself.`,
    `• Catalyst condition: no scheduled catalyst inside the next 2 hours. If a catalyst is inside the window, NO new entry — manage existing positions only.`,
    `• Invalidation: 1H close back below ${aboveBOS}, OR break of the demand zone low ${bullDemand && Number.isFinite(bullDemand.low) ? `at ${fmtPrice(bullDemand.low, sym)}` : '(zone pending)'}.`,
    ``,
    `**BEARISH SHIFT**`,
    `• Timeframe: 1H (aggressive: 30M for intraday confirmation; broader: 4H for structural confirmation).`,
    `• Level: confirmed close below ${belowBOS} (1H structure-break reference).`,
    `• Candle close: full 1H candle close beyond the level — wicks alone do NOT qualify.`,
    `• Zone requirement: a fresh SUPPLY zone (or bearish imbalance) created by the displacement off the break — pullback into that zone is the entry trigger, not the break itself.`,
    `• Catalyst condition: no scheduled catalyst inside the next 2 hours. If a catalyst is inside the window, NO new entry — manage existing positions only.`,
    `• Invalidation: 1H close back above ${belowBOS}, OR break of the supply zone high ${bearSupply && Number.isFinite(bearSupply.high) ? `at ${fmtPrice(bearSupply.high, sym)}` : '(zone pending)'}.`,
    ``,
    `**NO-TRADE CONDITION**`,
    `Price between ${noTradeLow} and ${noTradeHigh} with no confirmed 1H break in either direction = NO TRADE. The asset remains untradable inside this band until a confirmed 1H structure break with candle-close confirmation forms.`,
    ``,
    `**ATLAS SEQUENCE (mandatory order)**`,
    `Liquidity → structure break (BOS / CHoCH) → candle close → identify fresh supply/demand zone or imbalance → pullback into zone → confirmation/entry plan → invalidation → target. A break above or below a level is NEVER an entry by itself.`
  ].join('\n');
}

// EQUITY LANGUAGE FILTER — strips banned FX/pair language from non-FX outputs.
function equityLanguageFilter(text, sym) {
  if (typeof text !== 'string' || !text) return text;
  const ac = inferAssetClass(normalizeSymbol(sym));
  if (ac === ASSET_CLASS.FX) return text; // FX language permitted on FX outputs only.
  const isEquity = ac === ASSET_CLASS.EQUITY;
  let out = text;
  // Hard substitutions for banned terms in equity / index / commodity outputs.
  out = out.replace(/\bstandard lot\b/gi, isEquity ? '100-share lot' : 'standard contract');
  out = out.replace(/\bnon-USD trade\b/gi, 'non-USD asset');
  out = out.replace(/\bbase currency\b/gi, 'underlying');
  out = out.replace(/\bquote currency\b/gi, 'pricing currency');
  out = out.replace(/\bfor the pair\b/gi, isEquity ? `for ${sym}` : 'for the asset');
  out = out.replace(/\bof the pair\b/gi, isEquity ? `of ${sym}` : 'of the asset');
  out = out.replace(/\bon the pair\b/gi, isEquity ? `on ${sym}` : 'on the asset');
  out = out.replace(/\bthis pair\b/gi, isEquity ? sym : 'this asset');
  out = out.replace(/\bthe pair\b/gi, isEquity ? sym : 'the asset');
  // "pip" / "pips" — keep numeric "≈ N pts" when used as points context, otherwise drop.
  out = out.replace(/(\d+(?:\.\d+)?)\s*pips?\b/gi, '$1 pts');
  out = out.replace(/\bpips?\b/gi, 'points');
  return out;
}

// PRESENTER-QA — the 15-rule contradiction check. Returns { ok, reason }.
function presenterQA(sections, ctx) {
  const allText = sections.join('\n');
  const sym = ctx.symbol;
  const ac = inferAssetClass(normalizeSymbol(sym));
  const isEquityish = ac === ASSET_CLASS.EQUITY || ac === ASSET_CLASS.INDEX || ac === ASSET_CLASS.COMMODITY;
  const blocked = ctx.blocked === true;
  const readiness = Number.isFinite(ctx.readiness) ? ctx.readiness : 0;
  const vol = ctx.vol;
  const ez = ctx.ez;
  const inv = ctx.inv;
  const macroBias = ctx.macroBias;
  const catalystInside2h = ctx.catalystInside2h === true;
  const setupExpired = ctx.setupExpired === true;
  const placeholderSent = ctx.placeholderSent === true;
  const blankChartSent = ctx.blankChartSent === true;
  const r = (reason) => ({ ok: false, reason });

  if (/Trade permit is AVAILABLE/i.test(allText) && /BLOCKED/i.test(allText)) return r('permit_available_and_blocked');
  if (readiness <= 3 && /execution unlocked|TRADE PERMIT AVAILABLE|Trade permit is AVAILABLE/i.test(allText)) return r('readiness_low_but_execution_unlocked');
  if (/Macro Alignment Strong/i.test(allText) && /Corey.{0,30}neutral/i.test(allText) && !/although/i.test(allText)) return r('macro_strong_corey_neutral_no_explanation');
  if (vol === 'High' && /execution conditions are normal/i.test(allText)) return r('vix_elevated_execution_normal');
  if ((!ez || !Number.isFinite(inv)) && /Reward-to-risk on T1 — 1:/i.test(allText)) return r('pending_entry_with_rr_calculated');
  if (!ez && /STOP LOSS\s*[:=]/i.test(allText) && !/Not authorised|pending/i.test(allText)) return r('no_entry_with_active_stop');
  if (isEquityish && /\bpip\b|\bpips\b|\bstandard lot\b|\bbase currency\b|\bquote currency\b/i.test(allText)) return r('equity_output_contains_fx_language');
  if (macroBias === BIAS.NEUTRAL && /matches the macro direction/i.test(allText)) return r('neutral_macro_with_matches_macro');
  if (catalystInside2h && /Trade permit is AVAILABLE/i.test(allText)) return r('catalyst_inside_2h_with_permit_available');
  if (setupExpired && /\*\*ENTRY\*\*[^\n]*[0-9]/.test(allText)) return r('expired_setup_with_active_entry');
  if (placeholderSent) return r('placeholder_chart_sent');
  if (blankChartSent) return r('blank_chart_sent');
  if (!/Level: \w+/i.test(allText) && /TRIGGER MAP/i.test(allText) && /pending/i.test(allText) === false) return r('trigger_map_missing_levels');
  if (/lower timeframe/i.test(allText) && !/30M|15M|5M|1M|1H|4H/.test(allText)) return r('confirmation_timeframe_not_specified');
  if (/\bconfirmation\b/i.test(allText) && !/(BOS|CHoCH|candle close|structure break)/i.test(allText)) return r('confirmation_used_without_definition');
  return { ok: true };
}

function buildPriceTable(sym, jane, htf, ltf) {
  const ac = inferAssetClass(normalizeSymbol(sym));
  const isEquity = ac === ASSET_CLASS.EQUITY;
  const cp = htf.currentPrice || 0;
  const ez = jane.entryZone;
  const inv = jane.invalidationLevel;
  const targets = jane.targets || [];
  const htf1 = Object.values(htf.timeframes)[0] || {};
  const sh = htf1.swingHighs || [];
  const sl = htf1.swingLows || [];
  const hi = sh.length ? sh[sh.length - 1].level : null;
  const lo = sl.length ? sl[sl.length - 1].level : null;
  const planLive = !!(ez && Number.isFinite(inv));

  // RISK / REWARD — only show when an authorised plan exists.
  let rrBlock;
  if (planLive) {
    const mid = (ez.high + ez.low) / 2;
    const rDollars = distanceAsDollars(Math.abs(mid - inv), sym);
    const t1 = targets[0] && Number.isFinite(targets[0].level)
      ? distanceAsDollars(Math.abs(targets[0].level - mid), sym)
      : null;
    rrBlock = [
      rDollars ? `Max loss: ${rDollars.text}` : 'Max loss: pending',
      t1 ? `Target (T1): ${t1.text}` : 'Target (T1): pending structure',
      jane.rrRatio ? `Reward-to-risk on T1 — 1:${jane.rrRatio}` : 'Reward-to-risk — pending structure'
    ];
  } else {
    rrBlock = [
      'Risk plan unavailable because no authorised entry or invalidation exists.',
      'Reward-to-risk is NOT calculated until both an entry zone and an invalidation level are defined.'
    ];
  }

  const targetsBlock = (planLive && targets.length)
    ? targets.map((t) => {
        const mid = (ez.high + ez.low) / 2;
        const dist = Math.abs(t.level - mid);
        const dd = distanceAsDollars(dist, sym);
        return `• ${t.label} at ${fmtPrice(t.level, sym)}${dd ? ` — ${dd.text}` : ''}`;
      }).join('\n')
    : '• Not authorised — no targets exist until entry structure forms.';

  const st = structureTimeline(htf, ltf);
  const bosLine = st.bos
    ? `Last BOS: **${st.bos.tf}** ${String(st.bos.direction || '').toLowerCase() || 'directional'} ${st.bos.kind} ${Number.isFinite(st.bos.level) ? `at ${fmtPrice(st.bos.level, sym)}` : ''}`.trim()
    : 'Last BOS: none on the tracked timeframes — structure is not yet confirmed in either direction.';
  const zoneLine = st.zone
    ? `Zone origin: **${st.zone.tf}** ${st.zone.kind} between ${fmtPrice(st.zone.low, sym)} and ${fmtPrice(st.zone.high, sym)}${st.zoneTimeMs ? ` (formed ${fmtUtcShort(st.zoneTimeMs)})` : ''}`
    : 'Zone origin: no qualifying zone on the tracked timeframes yet.';
  const positionLine = st.zone
    ? (cp > st.zone.high
        ? 'Current position: price is above the zone — no retest yet.'
        : cp < st.zone.low
          ? 'Current position: price has traded through the zone — wait for a new zone to form.'
          : 'Current position: price is inside the zone. Entry still requires lower-timeframe confirmation.')
    : 'Current position: price has no active zone to react from.';
  const ageLine = `Setup age: ${st.age}.`;

  // Stop-loss line is only shown when an entry exists. Until then, "Not authorised".
  const stopLossLine = planLive
    ? `STOP LOSS  ${fmtPrice(inv, sym)}`
    : `STOP LOSS  Not authorised`;
  const targetLineForBox = (planLive && targets[0] && Number.isFinite(targets[0].level))
    ? `TARGET     ${fmtPrice(targets[0].level, sym)}`
    : 'TARGET     Not authorised';

  return [
    `💠 **PRICE TABLE / EXECUTION MAP — ${sym}**`,
    ``,
    '```',
    `🟡 HIGH      ${fmtPrice(hi, sym)}`,
    `🟢 CURRENT   ${fmtPrice(cp, sym)}`,
    planLive ? `🟠 ENTRY     ${fmtPrice(ez.low, sym)} – ${fmtPrice(ez.high, sym)}` : `🟠 ENTRY     Pending`,
    `🔴 ${stopLossLine}`,
    `🎯 ${targetLineForBox}`,
    `🔵 LOW       ${fmtPrice(lo, sym)}`,
    '```',
    ``,
    `**INVALIDATION**`,
    planLive
      ? `Price: ${fmtPrice(inv, sym)}. If price closes beyond this level the trade idea is wrong and must be abandoned.`
      : 'Not defined until entry structure forms. No invalidation exists because no entry exists.',
    ``,
    `**TARGETS**`,
    targetsBlock,
    ``,
    `**RISK / REWARD (${isEquity ? 'dollars per share' : 'dollar-first'})**`,
    ...rrBlock,
    `Buffer applied: ${bufferDollarDescription(sym)}. This is the minimum necessary offset beyond invalidation for execution reality — not a random pad.`,
    ``,
    `**STRUCTURE TIMELINE**`,
    bosLine,
    zoneLine,
    positionLine,
    ageLine,
    ``,
    `**WHAT THIS MEANS**`,
    planLive
      ? `The levels above are the full plan. Entry is the defined structural level with a micro offset for fill certainty. Stop is beyond true invalidation with the minimum buffer needed for execution reality. Position size adjusts to hold the defined dollar risk — sized in ${isEquity ? 'dollars per share' : 'dollars'}, not lot conventions.`
      : 'Without a valid entry zone and invalidation, there is no plan to size. Wait for structure to define both before considering the trade.'
  ].join('\n');
}

function buildRoadmap() {
  const d = new Date().getUTCDay();
  const label =
    d === 1 ? 'Monday — full-depth macro'
    : d === 5 ? 'Friday — execution-focused'
    : 'Midweek — maintained';
  const body =
    d === 1 ? 'Today is the full weekly macro build. Every section is live with maximum depth. Read top-to-bottom before taking any setup — Monday sets the week-wide context that all later updates reference.'
    : d === 5 ? 'Today is Friday, execution-focused. Explanations are trimmed and the focus is live trade decisions, invalidation reviews and clearing stale setups into the weekly close.'
    : 'Today is a midweek update. Outdated sections from Monday are removed, but every explanation the week depends on remains intact. Use this as a refresh, not a replacement for Monday.';
  const lines = [
    `📅 **ROADMAP**`,
    ``,
    `**TODAY**`,
    `${label}`,
    ``,
    `**WHAT THIS MEANS**`,
    body,
    ``,
    `**HOW TO USE IT**`,
    'Treat the roadmap as the one document that frames the week. Every tab below is built on the same snapshot — if two tabs appear to disagree, the roadmap and the Final Verdict tab are the tie-breakers.',
    ``,
    `**REFERENCE**`,
    'ATLAS FX Macro + Roadmap Master Brief v2.0 (LOCKED).'
  ];
  if (ROADMAP_URL) lines.push(ROADMAP_URL);
  return lines.join('\n');
}

function buildEventIntel(sym, corey) {
  const ac = (typeof inferAssetClass === 'function') ? inferAssetClass(normalizeSymbol(sym)) : 'unknown';
  const calendarIntel = coreyCalendar.getEventIntelligence(sym, { assetClass: ac });
  if (calendarIntel) return calendarIntel;
  const g = corey.internalMacro?.global || {};
  const live = g.live || {};
  const ctx = g.context || {};
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const bias = corey.combinedBias;
  const conf = corey.confidence;
  const driver = dominantDriver(ctx);
  const driverLabel = DRIVER_LABEL[driver] || DRIVER_LABEL.usdFlow;
  const meta = DRIVER_MAP[driver] || DRIVER_MAP.equityBreadth;
  const dxyTxt = live.dxy ? `${biasArrow(g.dxyBias)} US dollar is ${String(g.dxyBias || '').toLowerCase()} (DXY proxy ${fmtNum(live.dxy.price, 2)})` : `US dollar read unavailable`;
  const vixTxt = live.vix ? `VIX proxy ${fmtNum(live.vix.price, 2)} — volatility is ${String(live.vix.level || 'Normal').toLowerCase()}` : `Volatility read unavailable`;
  const yldTxt = live.yield ? `10Y-2Y spread ${fmtNum(live.yield.spread, 2)} — yield curve is ${(live.yield.spread || 0) > 0 ? 'normal' : 'inverted'}` : `Yield curve read unavailable`;
  const affected = AFFECTED_MAP[driver] || AFFECTED_MAP.usdFlow;
  const biasFormatted = bias === BIAS.NEUTRAL ? 'no directional lean' : `${bias.toLowerCase()} lean`;
  return [
    `🧠 **EVENT INTELLIGENCE**`,
    ``,
    `**SENTIMENT**`,
    `${bias}  ${dotScale(conf)}`,
    `${mixedArrows(bias, conf)}`,
    ``,
    `**HEADLINE**`,
    `${meta.headline} — ${biasFormatted} for ${sym}.`,
    ``,
    `**TIMESTAMP**`,
    `${fmtUtcShort(Date.now())} — live Corey snapshot.`,
    ``,
    `**WHAT IS HAPPENING**`,
    `${meta.summary} Live cross-asset read: ${dxyTxt}; ${vixTxt}; ${yldTxt}. The regime is currently classified as ${regime} at ${pctLabel(corey.internalMacro?.regime?.confidence || 0)} confidence; the risk environment is ${g.riskEnv}.`,
    ``,
    `**WHY IT MATTERS (AI COMMENTARY)**`,
    `${driverLabel} is the single biggest contributor to today's macro read (composite score ${fmtNum(corey.combinedScore, 2)}). Other channels — growth data, equity breadth, real yields — are smaller and can be overridden by this driver. Expect ${sym} to track prints from ${driverLabel} more tightly than usual until the regime rotates. TrendSpider confirmation: ${corey.alignment ? 'agrees with Corey' : (corey.contradiction ? 'disagrees with Corey — treat the read as contested' : 'not available')}.`,
    ``,
    `**MECHANISM CHAIN (HOW THIS REACHES PRICE)**`,
    `${meta.chain}`,
    ``,
    `**WHAT THIS MEANS FOR PRICE**`,
    bias === BIAS.BULLISH
      ? `Upside attempts are more likely to hold and pullbacks are more likely to be bought, as long as ${driverLabel} stays the dominant driver.`
      : bias === BIAS.BEARISH
        ? `Downside attempts are more likely to hold and rallies are more likely to be sold, as long as ${driverLabel} stays the dominant driver.`
        : `Neither side has a structural advantage from the macro layer. Expect two-way drift until ${driverLabel} resolves in one direction.`,
    ``,
    `**TRADER ACTION**`,
    `Size positions assuming ${driverLabel} stays in control this session. Do not fade the dominant driver. Before counter-positioning, wait for one of the regime-change signals: VIX proxy cross of 20, DXY proxy cross of 100, or 10Y-2Y cross of zero. TrendSpider status: ${corey.trendSpider.grade || 'Unavailable'}.`,
    ``,
    `**WHEN THE IDEA IS INVALID**`,
    `This read stops applying if ${driverLabel} loses dominance to another channel, if any Events & Catalysts threshold crosses, or if the regime reclassifies away from ${regime}. At that point, every downstream paragraph must be re-read before the next trade.`,
    ``,
    `**AFFECTED SYMBOLS**`,
    `${affected.join(' · ')}`
  ].join('\n');
}

function buildMarketOverview(sym, corey) {
  const ac = inferAssetClass(normalizeSymbol(sym));
  const isEquity = ac === ASSET_CLASS.EQUITY || ac === ASSET_CLASS.INDEX;
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

  const volLevel = live.vix?.level || 'Normal';
  // Elevated VIX MUST NOT be paired with "execution conditions are normal".
  const volMeaning =
    volLevel === 'High' ? 'volatility is ELEVATED. Expect wider swings, more fakeouts, lower reliability of early breaks, and reduced confidence unless structure is exceptionally clean.'
    : volLevel === 'Low' ? 'moves are tighter and mean-reverting. Breakouts that have not yet expanded through recent structure are unreliable.'
    : 'volatility is in a moderate band. Standard sizing applies but watch for regime change at every cross.';
  const volAction =
    volLevel === 'High' ? 'Expect gappy execution. Reduce size, widen invalidation, and skip break-and-retest entries that rely on tight fills. Confidence is reduced unless structure is clean.'
    : volLevel === 'Low' ? 'Favour continuation over counter-trend. Avoid chasing breakouts that have not yet expanded through recent structure.'
    : 'Standard sizing. Re-read this paragraph if VIX proxy crosses 20.';

  const curveAction = (live.yield?.spread || 0) < 0
    ? (isEquity
        ? 'A negative spread historically precedes slowdowns. For growth equities and semiconductors specifically, valuation pressure rises and risk-asset leadership weakens; trust defensive rotation more than growth continuation.'
        : 'A negative spread historically precedes slowdowns. Trust recession-sensitive assets (gold, JPY, bonds) more than growth-sensitive ones on conflicting signals.')
    : (isEquity
        ? 'A positive spread historically supports growth equities and risk assets, including semiconductors. Growth-asset continuations get the benefit of the doubt on mixed signals.'
        : 'A positive spread historically supports growth-sensitive assets. Growth-sensitive crosses and equity indices get the benefit of the doubt on mixed signals.');

  const regimeAction = g.riskEnv === RISK_ENV.RISK_ON
    ? 'Risk-on regimes reward trend trades in growth assets. Full size on macro-aligned setups; fade only with clear structure.'
    : g.riskEnv === RISK_ENV.RISK_OFF
      ? 'Risk-off regimes reward defensive rotations. Scale down macro-against-trend setups; prefer safe-haven longs and growth-asset shorts.'
      : 'Neutral regimes punish conviction. Scale down or stand aside until the regime picks a side.';

  // Asset-class-aware central bank framing — no base/quote language for equities.
  let cbAction;
  if (isEquity) {
    const fed = quote.name && /Fed|FOMC/i.test(quote.name) ? quote : (base.name && /Fed|FOMC/i.test(base.name) ? base : null);
    if (fed) {
      cbAction = fed.direction === STANCE.HAWKISH
        ? 'Fed policy backdrop is hawkish — rate-cut expectations are pushed out and valuation pressure on growth equities (incl. semiconductors) increases. Liquidity tailwinds for risk assets are reduced.'
        : fed.direction === STANCE.DOVISH
          ? 'Fed policy backdrop is dovish — rate-cut expectations support valuation for growth equities and semiconductors. Liquidity tailwinds for risk assets improve.'
          : 'Fed policy backdrop is neutral — no structural valuation lean from policy alone. Watch yields and rate-cut pricing instead.';
    } else {
      cbAction = 'Fed policy backdrop unavailable for this symbol — read yields and rate-cut pricing as the primary policy channel.';
    }
  } else {
    cbAction = (base.score || 0) > (quote.score || 0)
      ? 'The base-side central bank is more hawkish than the quote. This is a structural tailwind for the base side before any event shock.'
      : (base.score || 0) < (quote.score || 0)
        ? 'The quote-side central bank is more hawkish than the base. This is a structural headwind for the base side before any event shock.'
        : 'The two central banks are roughly balanced. Event shocks will determine direction; no structural lean from policy alone.';
  }

  // Asset-class-aware breadth wording — no "index-linked pairs" for equities.
  const breadthAction = (ctx.equityBreadth || 0) > 0.15
    ? (isEquity
        ? `Broad equity participation supports risk assets. ${sym} is more likely to follow broad-tape strength than to lead it; size up only if ${sym}-specific structure agrees.`
        : 'Broad participation in equities supports risk assets and pressures safe havens. Use this to size up setups that align with the broad tape.')
    : (ctx.equityBreadth || 0) < -0.15
      ? (isEquity
          ? `Breadth is weak — index moves are being driven by a narrow cohort. ${sym} is exposed to fast reversals when leadership rotates. Prefer mean-reversion until breadth re-broadens.`
          : 'Breadth is weak. Index-level moves are being driven by a narrow cohort and can reverse quickly. Prefer mean-reversion setups when breadth disagrees with structure.')
      : 'Breadth is neutral. No edge from sector rotation alone — rely on direct structure and macro for direction.';

  // DXY framing — secondary input for equities, primary for non-USD pairs.
  const dxyEquityAction = g.dxyBias === BIAS.BULLISH
    ? `Bullish dollar pressures growth-asset valuations marginally. For ${sym} specifically, this is a SECONDARY input — direct rate/yield expectations and chip-sector flows matter more.`
    : g.dxyBias === BIAS.BEARISH
      ? `Bearish dollar supports risk assets and growth-asset valuations marginally. For ${sym} specifically, this is a SECONDARY input — chip-sector flows and rate-cut pricing dominate.`
      : `Dollar bias is neutral. For ${sym} specifically this channel is inactive; direct rate/yield expectations and sector flows drive price.`;
  const dxyFxAction = g.dxyBias === BIAS.BULLISH
    ? 'Favour short non-USD setups; discount long non-USD continuations that have not broken structure.'
    : g.dxyBias === BIAS.BEARISH
      ? 'Favour long non-USD setups; discount short non-USD continuations that have not broken structure.'
      : 'Neutral — do not take dollar-dependent trades on USD direction alone.';
  const dxyAction = isEquity ? dxyEquityAction : dxyFxAction;
  const dxyMeaning = isEquity
    ? `For ${sym}, the dollar is a SECONDARY macro input. The single largest input is the rate/yield channel and chip-sector risk appetite.`
    : 'The dollar is the single largest input to any non-USD trade in this session. Any cross-asset move that disagrees with the dollar is noise until the dollar re-rates.';

  const paragraphs = [
    `**DOLLAR (DXY) — ${isEquity ? 'secondary input' : 'primary input'}**\nReading: proxy ${live.dxy ? fmtNum(live.dxy.price, 2) : 'N/A'}. Bias: ${g.dxyBias || 'Neutral'}. Macro score on this channel: ${fmtNum(g.dxyScore, 2)}.\nWhat this means: ${dxyMeaning}\nTrader action: ${dxyAction} ${dxyArrow}`,
    `**VOLATILITY (VIX proxy)**\nReading: ${live.vix ? fmtNum(live.vix.price, 2) : 'N/A'}. Level: ${volLevel}. Volatility score: ${fmtNum(vol.volatilityScore, 2)}.\nWhat this means: ${volMeaning}\nTrader action: ${volAction} ${volArrow}`,
    `**YIELD CURVE / RATES (10Y-2Y)**\nReading: spread ${live.yield ? fmtNum(live.yield.spread, 2) : 'N/A'}. Real-yield channel: ${fmtNum(ctx.realYieldPressure, 2)}.\nWhat this means: ${isEquity ? `For ${sym}, this is the most direct macro channel. Lower / falling real yields support valuation; higher / rising real yields compress it. The curve is the second-order confirmation of the ${regime} regime.` : `The curve is the second-order confirmation of the ${regime} regime. When the curve and the regime disagree, the regime label is provisional and can be reclassified within two days.`}\nTrader action: ${curveAction} ${yldArrow}`,
    `**REGIME AND RISK ENVIRONMENT**\nRegime: ${regime} at ${pctLabel(corey.internalMacro?.regime?.confidence || 0)} confidence. Risk environment: ${g.riskEnv}. Liquidity: ${liq.state}.\nWhat this means: the regime decides whether macro-aligned trades are full size or scaled down. This is not overrideable inside the session.\nTrader action: ${regimeAction} ${riskArrow}`,
    `**CENTRAL BANK / POLICY BACKDROP**\n${isEquity ? `Fed lean: ${quote.direction || base.direction || 'N/A'} · cycle ${quote.rateCycle || base.rateCycle || 'N/A'}.` : `Base: ${base.name || 'N/A'} — direction ${base.direction || 'N/A'}, cycle ${base.rateCycle || 'N/A'}. Quote: ${quote.name || 'N/A'} — direction ${quote.direction || 'N/A'}, cycle ${quote.rateCycle || 'N/A'}.`}\nWhat this means: ${isEquity ? 'Fed policy + rate-cut pricing set the valuation backdrop. Event shocks operate on top of this layer, not in place of it.' : 'The policy differential is the structural tailwind or headwind before any news hits. Event shocks operate on top of this layer, not in place of it.'}\nTrader action: ${cbAction} ${cbArrow}`,
    `**CROSS-ASSET BREADTH**\nEquity breadth ${fmtNum(ctx.equityBreadth, 2)}, growth impulse ${fmtNum(ctx.growthImpulse, 2)}, commodity demand ${fmtNum(ctx.commodityDemand, 2)}.\nWhat this means: ${isEquity ? `breadth tells you whether the broad tape supports ${sym} specifically or only the wider risk environment. Narrow breadth is fragile — leadership rotates fast.` : 'these are secondary channels. They adjust sizing but do not override the dominant driver.'}\nTrader action: ${breadthAction} ${breadthArrow}`
  ];
  return [`🌐 **MARKET OVERVIEW — ${sym}**`, ``, ...paragraphs].join('\n\n');
}

function buildEventsCatalysts(sym, corey) {
  const ac = inferAssetClass(normalizeSymbol(sym));
  const isEquity = ac === ASSET_CLASS.EQUITY || ac === ASSET_CLASS.INDEX;
  const base = corey.internalMacro?.base?.cb || {};
  const quote = corey.internalMacro?.quote?.cb || {};
  const dir2Bias = d => d === STANCE.HAWKISH ? BIAS.BULLISH : d === STANCE.DOVISH ? BIAS.BEARISH : BIAS.NEUTRAL;
  const cbLines = [];
  if (isEquity) {
    const fed = quote.name && /Fed|FOMC/i.test(quote.name) ? quote : (base.name && /Fed|FOMC/i.test(base.name) ? base : null);
    if (fed && fed.name) {
      const leanWord = fed.direction === STANCE.HAWKISH ? 'hawkish (tighter policy)' : fed.direction === STANCE.DOVISH ? 'dovish (easier policy)' : 'neutral';
      cbLines.push(
        `• **${fed.name}** — ${leanWord}, cycle ${fed.rateCycle}. ${biasArrow(dir2Bias(fed.direction))}`,
        `  What it means for ${sym}: ${fed.direction === STANCE.HAWKISH ? 'rate-cut expectations are pushed out, real yields rise, valuation pressure on growth equities and semiconductors increases. Risk-asset leadership weakens.' : fed.direction === STANCE.DOVISH ? 'rate-cut expectations advance, real yields fall, valuation support for growth equities and semiconductors strengthens. Risk-asset leadership improves.' : 'no structural lean from policy alone. Rates and rate-cut pricing become the dominant channel.'}`
      );
    } else {
      cbLines.push(`• No live central bank stance registered for ${sym}. Read yields and rate-cut pricing as the primary policy channel.`);
    }
  } else {
    const describeCb = (cb, role) => {
      if (!cb || !cb.name) return;
      const leanWord = cb.direction === STANCE.HAWKISH ? 'hawkish (tighter policy)' : cb.direction === STANCE.DOVISH ? 'dovish (easier policy)' : 'neutral';
      const currencyEffect = cb.direction === STANCE.HAWKISH ? `stronger ${role}-side currency bias` : cb.direction === STANCE.DOVISH ? `weaker ${role}-side currency bias` : `no lean from policy alone`;
      cbLines.push(
        `• **${cb.name}** (${role} side) — ${leanWord}, cycle ${cb.rateCycle}. ${biasArrow(dir2Bias(cb.direction))}`,
        `  What it means: expect ${currencyEffect} before any data shock. Structural baseline, not a trade signal.`
      );
    };
    describeCb(base, 'base');
    if (quote.name && quote.name !== base.name) describeCb(quote, 'quote');
    if (!cbLines.length) cbLines.push(`• No active central bank stance registered for ${sym}.`);
  }

  const lines = [
    `📆 **EVENTS & CATALYSTS — ${sym}**`,
    ``,
    `**CENTRAL BANK / POLICY BACKDROP**`,
    ...cbLines,
    ``,
    `**LIVE CATALYST THRESHOLDS (monitored on the 1H strip)**`,
    `• **DXY proxy crosses 100**`,
    `  What happens: dollar regime flips sides.`,
    `  Why it matters for ${sym}: ${isEquity ? `secondary input — affects valuation marginally via rates and global liquidity. Larger effect via the rate channel than directly.` : `the dollar is the single biggest input to non-USD pricing.`}`,
    `  Trader action: ${isEquity ? `do not let DXY alone trigger entries; re-read Market Overview first.` : `invalidate every open non-USD thesis and re-read the Market Overview before the next entry.`} ⬆️⬇️`,
    ``,
    `• **VIX proxy crosses 20**`,
    `  What happens: volatility regime flips between calm and stressed.`,
    `  Why it matters: stop sizes, position sizes and break-and-retest reliability all change on this line. Elevated VIX = more fakeouts, lower reliability of early breaks.`,
    `  Trader action: re-size every active plan using the new volatility level before acting. ⬆️⬇️`,
    ``,
    `• **10Y-2Y spread crosses zero**`,
    `  What happens: recession-risk channel flips sides.`,
    `  Why it matters for ${sym}: ${isEquity ? `for growth equities and semiconductors specifically, an inversion historically precedes valuation compression and weaker risk-asset leadership.` : `this line separates curve-normal from curve-inverted, which historically shifts leadership between growth assets and safe havens.`}`,
    `  Trader action: down-weight growth continuations and up-weight defensive rotation on an inversion cross; reverse on a re-steepening. ⬆️⬇️`,
    ``,
    `• **Credit stress crosses +0.25**`,
    `  What happens: risk-off lean is confirmed.`,
    `  Why it matters: credit widening is a reliable leading indicator for equity drawdowns and safe-haven bids.`,
    `  Trader action: block new risk-on setups until the cross reverses. ⬇️`,
    ``,
    `• **Growth impulse crosses +0.20**`,
    `  What happens: risk-on lean is confirmed.`,
    `  Why it matters: growth repricing is where cyclical leadership starts. ${isEquity ? `Direct positive for ${sym} if it sits in a growth bucket.` : ''}`,
    `  Trader action: allow full size on macro-aligned long setups in growth assets. ⬆️`,
    ``,
    `**WHAT TO DO BEFORE, DURING AND AFTER A CATALYST**`,
    `Before: NO new entries in the two hours ahead of a known release. Reduce exposure on open positions or trail to protect. If a major catalyst sits inside the 2-hour window, Trade Permit MUST read BLOCKED — only existing-position management is permitted.`,
    `During: do NOT trade the first five minutes after the print. Spreads widen, fills are poor, and the first move is often a fake.`,
    `After: wait for fresh 15M / 30M structure to reform. Only act once structure confirms the post-release direction.`,
    ``,
    `**WHEN THE IDEA IS INVALID**`,
    `Any cross on the list above invalidates every open thesis on ${sym}, regardless of structure. Re-read Market Overview and Trade Status before the next entry.`
  ];
  return lines.join('\n');
}

function buildHistoricalContext(sym, corey) {
  const g = corey.internalMacro?.global || {};
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const vixLevel = g.live?.vix?.level || 'Normal';
  const regimeResolution = {
    [REGIME.CRISIS]: 'safe-haven bids, dollar strength, equity drawdowns and credit widening',
    [REGIME.EXPANSION]: 'risk-on rotation, dollar weakness, broad equity participation and commodity strength',
    [REGIME.CONTRACTION]: 'defensive rotation, bond bids, commodity weakness and FX carry unwinds',
    [REGIME.GROWTH]: 'cyclical leadership, commodity strength and broad equity participation',
    [REGIME.TRANSITION]: 'chop, single-day reversals and failed breakouts until the regime resolves'
  }[regime] || 'chop until the regime resolves';

  const volMeaning = vixLevel === 'High'
    ? 'when volatility is elevated, index drawdowns tend to continue and the dollar tends to strengthen into the decline'
    : vixLevel === 'Low'
      ? 'when volatility is compressed, continuation squeezes dominate and low-range mean-reversion attempts fail more often than they work'
      : 'when volatility is normal, standard intraday mean-reversion windows apply with ordinary ranges';

  const dxyMeaning = g.dxyBias === BIAS.BULLISH
    ? 'dollar-bullish windows have historically preceded broad commodity pressure, weakness in emerging-market FX and compression in gold'
    : g.dxyBias === BIAS.BEARISH
      ? 'dollar-bearish windows have historically preceded commodity rallies, strength in emerging-market FX and expansion in gold'
      : 'dollar-neutral windows have historically produced range compression across majors, with single-day reversals dominant';

  const paragraphs = [
    `**REGIME ANALOG — ${regime}**\nWhat is happening: the current regime is classified as ${regime}.\nWhy it matters: historical ${regime} windows have resolved via ${regimeResolution}. The resolution is conditional on the dominant macro channel staying dominant. If that channel rotates mid-window, the analog fails and the regime will be reclassified.\nHow to use this: use the analog as a directional guide, not a signal. Do not enter on the analog alone — wait for structure to agree.\nInvalidation of analog: the analog stops applying the moment the dominant channel loses control or any Events & Catalysts threshold crosses. ${g.riskEnv === RISK_ENV.RISK_ON ? '⬆️' : '⬇️'}`,
    `**VOLATILITY ANALOG — ${vixLevel}**\nWhat is happening: volatility is at ${vixLevel} level.\nWhy it matters: ${volMeaning}. Volatility regimes persist at roughly 70% over five-session windows, which makes this analog the most reliable of the four.\nHow to use this: size positions to the current volatility regime, not the last one. Widen invalidation under high volatility and tighten it under low volatility, without forcing reward-to-risk to look prettier than the structure supports.\nInvalidation of analog: a VIX proxy cross of 20 flips the analog. Re-read this block after any cross. ${vixLevel === 'High' ? '⬇️' : '⬆️'}`,
    `**DOLLAR ANALOG — ${g.dxyBias}**\nWhat is happening: the dollar bias is ${g.dxyBias} at score ${fmtNum(g.dxyScore, 2)}.\nWhy it matters: ${dxyMeaning}. Dollar analogs are the most binary of the four — the sign matters more than the size inside this regime.\nHow to use this: align non-USD setups with the dollar side. Discount setups that require the dollar to cooperate against its current bias.\nInvalidation of analog: a DXY proxy cross of 100 invalidates the analog and forces a full re-read. ${g.dxyBias === BIAS.BEARISH ? '⬆️' : '⬇️'}`,
    `**SYMBOL-SPECIFIC ANALOG — ${sym}**\nWhat is happening: ${sym} is inside the current macro window.\nWhy it matters: in prior regimes like this one, ${sym} has delivered directional follow-through when the dominant macro channel stayed uncontested for five or more sessions, and has mean-reverted otherwise.\nHow to use this: check the regime gate daily. If the dominant driver is contested for even a single session, treat follow-through setups with reduced exposure and prefer mean-reversion setups until the gate re-stabilises.\nInvalidation of analog: the moment the dominant driver changes, the analog fails and ${sym} reverts to general-regime behaviour. ${corey.combinedBias === BIAS.BULLISH ? '⬆️' : corey.combinedBias === BIAS.BEARISH ? '⬇️' : '⬆️⬇️'}`
  ];
  return [`📚 **HISTORICAL CONTEXT — ${sym}**`, ``, ...paragraphs].join('\n\n');
}

function buildExecutionLogic(sym, jane, corey) {
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const blocked = jane.doNotTrade || jane.finalBias === BIAS.NEUTRAL;
  const rr = jane.rrRatio;
  const rrInsufficient = Number.isFinite(rr) && rr < 1.5;

  // Scenario machinery — rule-based, no flip language
  const primaryDir = jane.finalBias === BIAS.BULLISH ? 'buy on return' : jane.finalBias === BIAS.BEARISH ? 'sell on return' : null;
  const altDir = jane.finalBias === BIAS.BULLISH ? 'sell' : jane.finalBias === BIAS.BEARISH ? 'buy' : null;
  const dir = jane.finalBias === BIAS.BULLISH ? 'LONG' : jane.finalBias === BIAS.BEARISH ? 'SHORT' : null;
  const confirm = dir === 'LONG' ? 'lower-timeframe break of structure or bullish change-of-character'
                : dir === 'SHORT' ? 'lower-timeframe break of structure or bearish change-of-character'
                : 'a fresh structural break in either direction';
  const ez = jane.entryZone;
  const inv = jane.invalidationLevel;
  const t = jane.targets || [];

  // ---- BLOCKED PATH -----------------------------------------------------
  if (blocked) {
    const reason = jane.doNotTrade
      ? jane.doNotTradeReason
      : 'Evidence is fragmented. No direction can be trusted yet.';
    return [
      `🎯 **EXECUTION LOGIC — ${sym}**`,
      ``,
      `**TRADE STATUS**`,
      `Blocked.`,
      ``,
      `**WHY**`,
      reason,
      ``,
      `**WHAT THIS MEANS**`,
      'Even if direction eventually proves correct, the plan right now does not meet ATLAS standards. Forcing an entry here trades on hope, not structure.',
      ``,
      `**PRIMARY SCENARIO**`,
      'Stand aside.',
      ``,
      `**CONDITION**`,
      `The current ${jane.conflictState === 'HardConflict' ? 'hard conflict' : 'mixed read'} must clear. That means structure and macro must start agreeing on a single direction on the higher timeframe.`,
      ``,
      `**ENTRY REQUIREMENT**`,
      corey.combinedBias === BIAS.NEUTRAL
        ? `Because macro direction is neutral, no directional execution path is authorised yet. A new plan only starts once price prints a confirmed bullish or bearish structure break (BOS or CHoCH) on at least the 1H, AND the macro layer no longer conflicts. Prior levels are not re-usable — rebuild from the new structure.`
        : `Wait for a fresh structural break in the ${corey.combinedBias.toLowerCase()} direction. Required: BOS or CHoCH on at least the 1H, candle-close confirmation, fresh ${corey.combinedBias === BIAS.BULLISH ? 'demand' : 'supply'} zone or imbalance left by the displacement. Prior levels are not re-usable — rebuild the plan from the new structure.`,
      ``,
      `**ALTERNATIVE SCENARIO — ONLY IF CONFIRMED**`,
      `This block only has one valid path until structure confirms. Any directional idea becomes valid only if the higher timeframe prints a confirmed break in that direction and holds it on close.`,
      ``,
      `**WHAT THAT MEANS**`,
      'The original do-not-trade read is no longer the dominant state, and a new directional plan may become tradable — but only from fresh levels.',
      ``,
      `**NO-TRADE TRANSITION RULE**`,
      'If neither side has confirmed structure, do nothing. Absence of signal is a valid signal.',
      ``,
      `**INVALIDATION**`,
      `The blocked state only lifts once: the conflict clears AND lower-timeframe structure confirms AND the regime remains ${regime}. If any of these are missing, the block remains.`,
      ``,
      `**TRIGGERS THAT FORCE A FULL RE-READ**`,
      `• Any Events & Catalysts threshold crosses — every prior thesis is invalid; re-read from Trade Status.`,
      `• Regime reclassifies away from ${regime} — rebuild the plan from scratch before acting.`
    ].join('\n');
  }

  // ---- VALID PATH -------------------------------------------------------
  const riskDollars = (ez && Number.isFinite(inv)) ? distanceAsDollars(Math.abs((ez.high + ez.low) / 2 - inv), sym) : null;
  const rewardDollars = (ez && t[0] && Number.isFinite(t[0].level)) ? distanceAsDollars(Math.abs(t[0].level - (ez.high + ez.low) / 2), sym) : null;

  const rrExplain = rrInsufficient
    ? `The expected reward (${rewardDollars ? rewardDollars.text : 'pending'}) does not clearly justify the risk required to take the trade (${riskDollars ? riskDollars.text : 'pending'}). Even if direction is right, the payoff is too small for the distance to invalidation — the trade is low quality.`
    : `Reward relative to risk meets the ATLAS threshold: every $1 risked targets roughly $${rr ? rr.toFixed(1) : '—'} in reward on T1.`;

  return [
    `🎯 **EXECUTION LOGIC — ${sym}**`,
    ``,
    `**TRADE STATUS**`,
    rrInsufficient ? 'Blocked — reward-to-risk is insufficient.' : 'Live — valid once confirmation prints.',
    ``,
    `**WHY**`,
    rrExplain,
    ``,
    `**TRADE DEFINITION (dollar-first)**`,
    `Max loss: ${riskDollars ? riskDollars.text : 'pending structure'}`,
    `Target (T1): ${rewardDollars ? rewardDollars.text : 'pending structure'}`,
    ``,
    `**PRIMARY SCENARIO**`,
    primaryDir ? `${primaryDir.charAt(0).toUpperCase() + primaryDir.slice(1)} (${dir.toLowerCase()} on return to the zone).` : 'None defined yet.',
    ``,
    `**CONDITION**`,
    `The current ${dir === 'LONG' ? 'bullish' : 'bearish'} structure on the higher timeframe must hold. If it breaks and closes against the direction, this scenario is off.`,
    ``,
    `**ENTRY REQUIREMENT**`,
    ez
      ? `Price must return to the ${fmtPrice(ez.low, sym)} – ${fmtPrice(ez.high, sym)} zone AND confirm with ${confirm} on the lower timeframe. Entry is placed at the zone with only a micro offset for fill certainty — no chasing.`
      : `Price must build lower-timeframe confirmation (${confirm}) and print a valid structural level before the trade is considered live.`,
    ``,
    `**ALTERNATIVE SCENARIO — ONLY IF CONFIRMED**`,
    `A ${altDir} setup becomes valid only if the higher timeframe breaks structure in the opposite direction AND holds on close. Prior levels are not re-usable — the plan rebuilds from the new structure.`,
    ``,
    `**WHAT THAT MEANS**`,
    'The original idea is no longer valid and a new directional plan may become tradable — at new levels, with a new invalidation.',
    ``,
    `**NO-TRADE TRANSITION RULE**`,
    'If neither scenario has confirmed structure, do nothing. Do not pre-position.',
    ``,
    `**BUFFER LOGIC (why the stop sits where it does)**`,
    `Entry: at the defined structural level with a minimal offset for fill certainty.`,
    `Invalidation: ${Number.isFinite(inv) ? `at ${fmtPrice(inv, sym)}, placed just beyond the true structural level` : 'pending structure'}.`,
    `Buffer applied: ${bufferDollarDescription(sym)} — the minimum necessary offset for execution reality (wicks, spread, slippage).`,
    `Why the buffer exists: to protect against a pure execution stop-out on a level that would otherwise hold. It is not padding for comfort.`,
    ``,
    `**IF / THEN PLAN**`,
    ez
      ? `• IF price enters ${fmtPrice(ez.low, sym)} – ${fmtPrice(ez.high, sym)} AND ${confirm} confirms → enter ${dir} ${sym} at the defined zone level, sized to the $ risk above.`
      : `• IF price builds ${confirm} at a fresh structural level → mark a valid ${dir} entry and rebuild the plan from those levels.`,
    Number.isFinite(inv) ? `• IF price closes beyond ${fmtPrice(inv, sym)} → the trade idea is wrong. Exit immediately.` : null,
    t[0] ? `• IF price reaches ${fmtPrice(t[0].level, sym)} (T1) → trail the stop to entry. The trade becomes free.` : null,
    t[1] ? `• IF price reaches ${fmtPrice(t[1].level, sym)} (T2) → book 50% of remaining size, trail the rest.` : null,
    t[2] ? `• IF price reaches ${fmtPrice(t[2].level, sym)} (T3) → close the remainder and stand aside until the next macro refresh.` : null,
    `• IF regime reclassifies away from ${regime} → reassess the thesis before any new action.`,
    `• IF any Events & Catalysts threshold crosses → all targets are invalid and the plan must be re-read from Trade Status.`,
    ``,
    `**WHEN TO ACT**`,
    ez
      ? 'Only when price is inside the entry zone AND lower-timeframe structure has confirmed. Confirmation before zone is not enough; zone before confirmation is not enough.'
      : 'Only once both a fresh structural break and a valid entry level exist. Before that, there is nothing to act on.',
    ``,
    `**WHEN THE IDEA IS INVALID**`,
    Number.isFinite(inv)
      ? `Closing beyond ${fmtPrice(inv, sym)}, a regime reclassification away from ${regime}, or any catalyst threshold cross ends this idea. At that point the plan stops — do not roll the stop, do not double down.`
      : `A regime reclassification away from ${regime} or any catalyst threshold cross ends this idea immediately.`
  ].filter(Boolean).join('\n');
}

function buildValidity(sym, corey, jane) {
  const now = new Date();
  const regime = corey.internalMacro?.regime?.regime || REGIME.NEUTRAL;
  const risk = corey.internalMacro?.global?.riskEnv || RISK_ENV.NEUTRAL;
  const next = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const verdict = jane ? atlasVerdict(jane) : { word: 'Wait', reason: 'Conditions are not yet resolved.' };
  const align = macroAlignment(corey);
  const readiness = jane ? readinessScore(jane) : 0;

  const traderAction = jane
    ? (jane.doNotTrade
        ? 'Stand aside. The current read does not support any entry. Do not pre-position.'
        : jane.convictionLabel === 'High'
          ? 'Prepare the entry. Act on confirmation, size to the $ risk in the Execution tab.'
          : jane.convictionLabel === 'Medium'
            ? 'Prepare with caution. Act only on lower-timeframe confirmation, with reduced exposure.'
            : 'Stand aside unless clean confirmation appears, and then only with reduced exposure.')
    : 'Stand aside until the read resolves.';

  // Reconcile "what changes view" against the live alignment count so we never
  // tell the trader the view changes when alignment "strengthens to 3/4" while
  // the count is already 3/4. The threshold is ALWAYS one step above current.
  const alignTarget = Math.min(align.total, Math.max(3, (align.count || 0) + 1));
  const alignClause = align.count >= alignTarget && corey.combinedBias !== BIAS.NEUTRAL
    ? `Macro alignment is already ${align.count}/${align.total} and Corey’s composite confirms ${corey.combinedBias.toLowerCase()} direction. The view holds while this remains true; it changes if alignment falls below ${alignTarget}/${align.total} OR Corey’s composite turns neutral or opposite.`
    : `Macro alignment strengthens to at least ${alignTarget}/${align.total} drivers (currently ${align.count}/${align.total}) AND Corey’s composite confirms a directional bias.`;

  const changesBullish = [
    `• Higher timeframe (1H or above) prints a confirmed BULLISH BOS or CHoCH AND closes beyond the break level.`,
    `• A fresh demand zone or imbalance forms below current price after the displacement.`,
    `• ${alignClause}`,
    `• No Events & Catalysts threshold is set to cross inside the valid window.`
  ].join('\n');
  const changesBearish = [
    `• Higher timeframe (1H or above) prints a confirmed BEARISH BOS or CHoCH AND closes beyond the break level.`,
    `• A fresh supply zone or imbalance forms above current price after the displacement.`,
    `• ${alignClause}`,
    `• No Events & Catalysts threshold is set to cross inside the valid window.`
  ].join('\n');
  const keepsBlocked = [
    `• Conflict between structure and macro persists (current state: ${jane ? jane.conflictState : 'unresolved'}).`,
    `• Market Readiness remains at or below 3/10 (current: ${readiness}/10).`,
    `• Volatility remains elevated without a clean structural break.`,
    `• Any catalyst threshold is set to cross inside the valid window.`
  ].join('\n');

  // Catalyst window — explicit. If a major event sits inside the next 2 hours,
  // the verdict is fenced as "execution-disabled" regardless of structure.
  const catalystWindow = `No new entries in the 2 hours ahead of a known release. No trading in the first 5 minutes after a print. After a print, wait for fresh 15M / 30M structure before acting.`;

  return [
    `✅ **FINAL VERDICT — ${sym}**`,
    ``,
    `**FINAL DECISION**`,
    `${verdict.word}.`,
    ``,
    `**WHY**`,
    verdict.reason,
    ``,
    `**TRADER ACTION**`,
    traderAction,
    ``,
    `**WHAT CHANGES THE VIEW BULLISH**`,
    changesBullish,
    ``,
    `**WHAT CHANGES THE VIEW BEARISH**`,
    changesBearish,
    ``,
    `**WHAT KEEPS IT BLOCKED**`,
    keepsBlocked,
    ``,
    `**CATALYST WINDOW**`,
    catalystWindow,
    ``,
    `**VALIDITY WINDOW**`,
    `Generated: ${fmtUtcShort(now.getTime())}`,
    `Regime: ${regime} · Risk environment: ${risk}`,
    `Valid until the next regime check: ${fmtUtcShort(next.getTime())}.`,
    `This verdict terminates immediately if any Events & Catalysts threshold crosses — regardless of the time remaining in the window.`
  ].join('\n');
}

function buildVerification(sym) {
  const iso = new Date().toISOString();
  const verLine = buildVerificationLine(sym, iso);
  return [
    `🔐 **VERIFICATION**`,
    ``,
    verLine
  ].join('\n');
}

// Macro v3 wrapper — adapts existing pipeline shape into macro/index.js buildMacroV3 input.
// Returns the same {name, text}[] shape consumed by deliverResult / chunkMessage / presenterQA.
async function formatMacroV3(sym, corey, spideyHTF, spideyLTF, jane, _candlesByTf) {
  const { buildMacroV3 } = require('./macro');
  const cacheReader = require('./cacheReader');
  let history = null;
  try {
    if (await cacheReader.isCached(sym)) {
      history = { recent20: await cacheReader.getRecentCandles(sym, 20) };
    }
  } catch (_e) { history = null; }
  const fmp = await fmpAdapter.enrich(sym);
  const biasWord = (corey?.combinedBias || 'neutral').toString().toLowerCase();
  const sign = biasWord.startsWith('bull') ? 1 : biasWord.startsWith('bear') ? -1 : 0;
  const conviction = Number.isFinite(corey?.confidence) ? corey.confidence : (Number.isFinite(jane?.confidence) ? jane.confidence : 0);
  const ac = (typeof inferAssetClass === 'function') ? inferAssetClass(sym) : 'unknown';
  const structure = {
    assetClass:     ac,
    score: Math.max(-1, Math.min(1, sign * conviction)),
    bias: biasWord,
    conviction,
    trigger:        jane?.entryTrigger || jane?.triggerCondition || null,
    entry:          (jane?.entryZone && (jane.entryZone.mid ?? jane.entryZone.lower)) ?? jane?.entry ?? null,
    entryExtended:  jane?.entryZone?.upper ?? null,
    stopLoss:       jane?.invalidationLevel ?? jane?.stopLoss ?? null,
    targets:        Array.isArray(jane?.targets) ? jane.targets
                    : [jane?.target1, jane?.target2, jane?.target3].filter(x => x != null),
    flow:           jane?.flow || null,
    validityWindow: jane?.validityWindow || null,
    cancellation:   Array.isArray(jane?.cancellation) ? jane.cancellation : [],
    recentHigh:     spideyHTF?.recentHigh ?? jane?.recentHigh ?? null,
    recentLow:      spideyHTF?.recentLow  ?? jane?.recentLow  ?? null,
    currentPrice:   spideyHTF?.currentPrice ?? corey?.lastPrice ?? null,
    triggers:       jane?.triggers || null
  };
  // Asset-class-aware calendar emitter — non-FX paths must use class-specific
  // section headers ("WHAT THIS MEANS FOR THE STOCK / INDEX / INSTRUMENT")
  // so the macro v3 strict scrub does not throw MACRO_BAN_VIOLATION on the
  // FX-only "WHAT THIS MEANS FOR THE PAIR" header.
  const calendarAssetClass = (ac && String(ac).toLowerCase()) || 'fx';
  const buildInput = {
    symbol: sym,
    ctx: coreyLive.getLiveContext(),
    structure,
    calendar: { snapshot: coreyCalendar.getCalendarSnapshot(), intel: coreyCalendar.getEventIntelligence(sym, { assetClass: calendarAssetClass }) },
    charts:   { htfGridName: sym + '_HTF.png', ltfGridName: sym + '_LTF.png' },
    fmp,
    history,
    darkHorse: getDHCandidate(sym),
    _stats: {}   // populated by buildMacroV3
  };
  const text = await buildMacroV3(buildInput);
  // Attach the build stats to the wrapper so formatMacro can log honestly.
  return [{
    name: 'ATLAS_MACRO_V3',
    text: equityLanguageFilter(text, sym),
    _stats: buildInput._stats || {}
  }];
}

async function formatMacro(sym, corey, spideyHTF, spideyLTF, jane, candlesByTf) {
  if (MACRO_V3_ENABLED) {
    try {
      const v3 = await formatMacroV3(sym, corey, spideyHTF, spideyLTF, jane, candlesByTf);
      const stats = (v3 && v3[0] && v3[0]._stats) || {};
      const built = stats.sectionsBuilt != null ? stats.sectionsBuilt : '?';
      const total = stats.sectionsTotal != null ? stats.sectionsTotal : '?';
      // Honest log: ONE concatenated wrapper containing N built sections.
      // Previous `sections=1` was misleading — it counted wrappers.
      console.log(`[MACRO] v3 ACTIVE — wrappers=${v3.length} sectionsBuilt=${built}/${total} symbol=${sym}`);
      return v3;
    } catch (err) {
      console.error(`[MACRO] v3 FAILED for ${sym} — falling back to legacy formatter: ${err && err.message}`);
    }
  }
  const macroLanguage = require('./macro/language');
  const fallbackAssetClass = (typeof inferAssetClass === 'function') ? inferAssetClass(normalizeSymbol(sym)) : 'unknown';
  const sections = [
    { name: 'TRADE STATUS',      text: buildTradeStatus(sym, jane, corey, spideyHTF, spideyLTF) },
    { name: 'FORWARD EXPECTATION', text: buildForwardExpectation(sym, jane, corey, spideyHTF, spideyLTF, candlesByTf || {}) },
    { name: 'TRIGGER MAP',       text: buildTriggerMap(sym, jane, spideyHTF, spideyLTF) },
    { name: 'PRICE TABLE',       text: buildPriceTable(sym, jane, spideyHTF, spideyLTF) },
    { name: 'ROADMAP',           text: buildRoadmap() },
    { name: 'EVENT INTELLIGENCE', text: buildEventIntel(sym, corey) },
    { name: 'MARKET OVERVIEW',   text: buildMarketOverview(sym, corey) },
    { name: 'EVENTS & CATALYSTS', text: buildEventsCatalysts(sym, corey) },
    { name: 'HISTORICAL CONTEXT', text: buildHistoricalContext(sym, corey) },
    { name: 'EXECUTION LOGIC',   text: buildExecutionLogic(sym, jane, corey) },
    { name: 'FINAL VERDICT',     text: buildValidity(sym, corey, jane) },
    { name: 'VERIFICATION',      text: buildVerification(sym) }
  ];
  // Legacy fallback hardening — scrubSoft so banned strings never reach Discord
  // even when v3 has thrown and the legacy path is running. Asset-class-aware
  // so FX symbols keep "WHAT THIS MEANS FOR THE PAIR" intact.
  return sections.map(s => ({
    name: s.name,
    text: macroLanguage.scrubSoft(equityLanguageFilter(s.text, sym), { assetClass: fallbackAssetClass })
  }));
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
// ==============================
// COMMAND ROUTING — dashboard-link default, render gated by explicit mode
// ==============================
const ATLAS_DASHBOARD_BASE = process.env.ATLAS_DASHBOARD_BASE || 'https://atlas-fx-dashboard.onrender.com/';
const RENDER_MODES = new Set(['analyse','analyze','charts','macro']);
const OPS_COMMANDS = new Set(['ping','stats','errors','sysstate','darkhorse']);
const USER_BY_ID = {
  '690861328507731978':  'AT',
  '1431173502161129555': 'NM',
  '763467091171999814':  'SK',
  '1244449071977074798': 'BR',
};
const USER_BY_CHANNEL = {
  '1432642672287547453': 'AT', '1433750991953596428': 'AT', '1489245537395019908': 'AT',
  '1432643496375881748': 'SK', '1433751801634488372': 'SK', '1489246324552368178': 'SK',
  '1432644116868501595': 'NM', '1433755484057501796': 'NM', '1489248591854702744': 'NM',
  '1482450651765149816': 'BR', '1482450900583710740': 'BR', '1489247239359697067': 'BR',
};
function resolveUserCode(msg) {
  return USER_BY_ID[msg.author.id] || USER_BY_CHANNEL[msg.channelId] || 'AT';
}
function dashboardUrl(symbol, user) {
  return `${ATLAS_DASHBOARD_BASE}?symbol=${encodeURIComponent(symbol)}&user=${encodeURIComponent(user)}`;
}

// Build the Forward Expectation block for the dashboard packet. Always
// returns a populated object with the spec's named fields; when Jane has
// not produced a real forward, every field carries an explicit no-trade-
// condition string instead of being undefined / blank. This lets the
// downstream `Object.keys(packet.forward).length` counter return >0 and
// gives the dashboard renderer structured copy to display.
function buildForwardBlock(jane, sourceMissing) {
  const j = (jane && (jane.forwardExpectation || jane.forward)) || {};
  const reason = (sourceMissing && sourceMissing.missingSpidey)
    ? 'Forward expectation withheld because the structure / trigger source (Spidey) is unavailable. Reassess after the Spidey structure packet is restored.'
    : (sourceMissing && sourceMissing.missingCorey)
      ? 'Forward expectation withheld because the macro / catalyst source (Corey) is unavailable. No timing window beyond candle-close schedule can be trusted.'
      : 'Forward expectation withheld — Jane has not synthesised the forward block for this symbol yet.';
  const realValue = !!(j && (j.expectedBehaviour || j.expectedTiming || j.dailyMovementContext || j.remainingMovementAbsorption));
  return {
    expectedBehaviour:           j.expectedBehaviour           || 'Wait — no authorised directional read until lower-timeframe structure rebuilds.',
    expectedTiming:              j.expectedTiming              || 'Until structure or event resets the read; reassess on the next regime check (≤4h).',
    dailyMovementContext:        j.dailyMovementContext        || 'Withheld — daily movement context cannot be assigned without Spidey ATR / range data.',
    remainingMovementAbsorption: j.remainingMovementAbsorption || 'Withheld — direction not assignable. Expect sideways absorption inside the current intraday range.',
    whatTraderIsWaitingFor:      j.whatTraderIsWaitingFor      || 'A confirmed BOS / CHoCH on at least the 1H, candle-close beyond the break level, and a fresh demand / supply zone created by the displacement.',
    realValue,
    withheldReason: realValue ? null : reason
  };
}

// Build the Trigger Map block for the dashboard packet. Always returns
// `{ bullish, bearish, noTrade, timeframeNote }` where `bullish` and
// `bearish` are populated objects (never null) carrying either real
// trigger fields or a structured `withheldReason`. The downstream check
// distinguishes 'present' (real level + tf) vs 'withheld' (reason set)
// vs 'partial'.
function buildTriggerBlock(jane, sourceMissing) {
  const t = (jane && (jane.triggerMap || jane.triggers)) || {};
  const reason = (sourceMissing && sourceMissing.missingSpidey)
    ? 'Trigger map withheld — Spidey structure / trigger packet unavailable. No bullish or bearish trigger can be printed safely.'
    : 'Trigger map withheld — no qualifying structural break has formed yet on the tracked timeframes.';
  const sideBlock = (side) => {
    const s = t[side] || null;
    if (s && (s.level || s.tf)) {
      // Real trigger present — pass through verbatim.
      return {
        tf:               s.tf || null,
        level:            s.level || null,
        candleClose:      s.candleClose || s.close || null,
        freshDemandSupply: s.freshDemandSupply || s.supplyDemand || s.supply || null,
        catalyst:         s.catalyst || 'no high-impact event inside next 2h',
        invalidation:     s.invalidation || null,
        withheldReason:   null
      };
    }
    // No real trigger — emit a structured withheld payload.
    return {
      tf:               null,
      level:            null,
      candleClose:      null,
      freshDemandSupply: null,
      catalyst:         null,
      invalidation:     null,
      withheldReason:   reason
    };
  };
  return {
    bullish:       sideBlock('bullish'),
    bearish:       sideBlock('bearish'),
    noTrade:       t.noTrade || 'Inside the current range with no fresh impulse — no entry, no preempt limits.',
    timeframeNote: t.timeframeNote || '15M = aggressive intraday confirmation. 30M cleaner. 1H stronger. 4H broader structure. A break of a level is not an entry by itself — sequence: liquidity → structure break → candle close → identify fresh supply/demand or imbalance → pullback → confirmation/entry plan → invalidation → target.'
  };
}

// Build a Jane packet from the real engine outputs and POST it to the
// dashboard service's /load endpoint. The dashboard then renders the
// Execution / Live Plan surface from this packet. Source statuses reflect
// the REAL state of each engine — no fabricated values.
//
// Called from deliverResult() AFTER the macro pipeline runs. Fire-and-forget;
// errors are logged but never block the Discord delivery path.
function postJanePacketToDashboard(symbol, corey, spideyHTF, spideyLTF, jane) {
  try {
    // Co-located [DATA-SOURCE] summary emission. The route-entry call at the
    // top of the messageCreate handler also emits this line, but it fires
    // ~1-2s before the analysis pipeline produces its log batch and may not
    // be captured in the same Render log window the user inspects after a
    // live run. Emitting it again here guarantees the summary line is
    // adjacent to the [JANE-BUILD] / [JANE-POST] block and visible in any
    // post-analysis log dump.
    try { logDataSource(symbol); } catch (_e) { /* logDataSource is bulletproof; defensive only */ }

    const baseUrl = (ATLAS_DASHBOARD_BASE || '').replace(/\/$/, '');
    if (!baseUrl) { console.warn('[JANE-POST] ATLAS_DASHBOARD_BASE not set — skip'); return; }
    const url = baseUrl + '/load';

    // Source statuses — real engine state, no fakery.
    const liveCtx = (typeof coreyLive !== 'undefined' && coreyLive.getLiveContext) ? coreyLive.getLiveContext() : null;
    const coreyRaw = liveCtx?.status || 'unknown';
    // 'uninitialised' is a transient pre-init state; map to 'pending' not 'unavailable'.
    const coreyStatus =
      coreyRaw === 'ok'           ? 'ok'
    : coreyRaw === 'partial'      ? 'partial'
    : coreyRaw === 'degraded'     ? 'degraded'
    : coreyRaw === 'uninitialised'? 'pending'
    : coreyRaw === 'error'        ? 'unavailable: error'
    :                                ('unavailable: ' + coreyRaw);

    const spideyHTFok = !!(spideyHTF && (spideyHTF.bias || spideyHTF.score != null || spideyHTF.currentPrice != null));
    const spideyLTFok = !!(spideyLTF && (spideyLTF.bias || spideyLTF.score != null || spideyLTF.currentPrice != null));
    const spideyStatus = (spideyHTFok && spideyLTFok) ? 'ok' : (spideyHTFok || spideyLTFok) ? 'partial' : 'unavailable';

    let historicalStatus = 'unavailable';
    let historicalSampleCount = null;
    try {
      const cacheReader = require('./cacheReader');
      const symU = String(symbol).toUpperCase();
      if (cacheReader && typeof cacheReader.SYMBOL_GROUP_MAP === 'object' && cacheReader.SYMBOL_GROUP_MAP[symU]) {
        // Cache is 15Y daily — honest label, not 30Y.
        historicalStatus = 'partial: 15Y-cache';
      } else {
        historicalStatus = 'no-match';
      }
    } catch (_) { historicalStatus = 'unavailable'; }
    const coreyCloneStatus = 'unavailable: not implemented';

    // Jane-status semantics — REAL engine state, never 'final' if the
    // underlying source chain is too thin to issue a real decision.
    // Spec-required fine-grained values:
    //   unavailable:no_packet         — no jane object at all
    //   withheld:source_incomplete    — corey/spidey unavailable
    //   withheld:empty_decision_packet — jane object exists but no decision fields
    //   final:no_trade / final:armed / final:entry_authorised / final:trade_confirmed
    const janeIsObject = !!(jane && typeof jane === 'object');
    const janeKeys     = janeIsObject ? Object.keys(jane) : [];
    // 18-field operational decision packet per the macro v3 spec. Each field
    // has a resolver and a structured withheld reason — when the live source
    // chain cannot supply a value, the packet still carries the spec-named
    // field with an explicit `withheld:true, reason` payload instead of
    // silently dropping to zero.
    const __spideyHTFok = !!(spideyHTF && (spideyHTF.bias || spideyHTF.score != null || spideyHTF.currentPrice != null));
    const __spideyLTFok = !!(spideyLTF && (spideyLTF.bias || spideyLTF.score != null || spideyLTF.currentPrice != null));
    const __spideyAny   = __spideyHTFok || __spideyLTFok;
    const __coreyOk     = (typeof coreyStatus !== 'undefined') && coreyStatus === 'ok';
    const __withheld = (reason) => ({ withheld: true, reason });

    // Pre-compute sourceMissing so the resolver and the packet construction
    // share the same view of which engines are present.
    const sourceMissingEarly = {
      missingCorey:      !(coreyStatus === 'ok' || coreyStatus === 'partial'),
      missingSpidey:     spideyStatus === 'unavailable',
      missingHistorical: historicalStatus === 'unavailable' || historicalStatus === 'no-match',
      missingCoreyClone: true
    };
    // Build the structured Forward / Trigger / Candidates payloads ONCE so
    // the resolver and the dashboard packet share the same object identity.
    const __forwardBlockResolved = buildForwardBlock(jane, sourceMissingEarly);
    const __triggerBlockResolved = buildTriggerBlock(jane, sourceMissingEarly);
    const __candidatesResolved = (() => {
      const bull = jane?.bullishCandidate || null;
      const bear = jane?.bearishCandidate || null;
      if (bull || bear) return { bullish: bull, bearish: bear };
      const reason = sourceMissingEarly.missingSpidey
        ? 'Candidates withheld — Spidey structure / trigger packet unavailable.'
        : 'No candidate found above conviction threshold.';
      return {
        bullish: { withheld: true, reason },
        bearish: { withheld: true, reason }
      };
    })();
    const __conditionGridResolved = jane?.grid || jane?.conditionGrid || {
      executionAuthority: 0, structure: 0, liquidityPressure: 0, eventRisk: 0,
      sessionEnergy: 0, macroAlignment: 0, conviction: 0, regime: 0
    };

    // Resolver. Returns a populated value for every spec field — strings
    // for natural no-trade states ('Pending', 'Not authorised'), structured
    // objects for forward / trigger / candidates / grid / scenario, and
    // explicit `{ withheld:true, reason }` payloads only for fields whose
    // upstream is genuinely missing. The downstream `__isPopulated` counts
    // ALL of these as present.
    const __resolveDecisionField = (k) => {
      switch (k) {
        case 'actionState':
          return jane?.actionState
              || (jane?.combinedBias ? `BIAS ${String(jane.combinedBias).toUpperCase()}` : null)
              || (corey?.combinedBias ? `BIAS ${String(corey.combinedBias).toUpperCase()}` : null)
              || 'WAIT — NO TRADE';
        case 'biasDirection':
          return corey?.combinedBias || jane?.bias || jane?.directionPlain || 'Neutral';
        case 'tradePermission':
          return jane?.permitLabel || jane?.permit || 'BLOCKED — no entry authorised';
        case 'conditionGrid':
          // Always a real grid object (zeros if Jane has no scores yet).
          return __conditionGridResolved;
        case 'forwardExpectation':
          // Always a real object — populated with no-trade copy when the
          // forward source is unavailable. See buildForwardBlock().
          return __forwardBlockResolved;
        case 'triggerMap':
          // Always a real { bullish, bearish, noTrade, timeframeNote } —
          // each side is a structured object that may carry a withheldReason.
          return __triggerBlockResolved;
        case 'candidates':
          // Always populated; each side is either a real candidate or a
          // structured `{ withheld:true, reason }`.
          return __candidatesResolved;
        case 'cancellationTrigger':
          return jane?.cancellationTrigger
              || (Array.isArray(jane?.cancellation) && jane.cancellation.length ? jane.cancellation.join('; ') : null)
              || 'Wait for structure / trigger to form before any cancellation can be defined.';
        case 'nextReassessmentTime':
          return jane?.nextReassessmentTime
              || jane?.reassessAt
              || (Number.isFinite(jane?.reassessMinutes) ? `${jane.reassessMinutes}min` : null)
              || '60min';
        case 'validityWindow':
          return jane?.validityWindow
              || (Number.isFinite(jane?.validityMinutes) ? `${jane.validityMinutes}min` : null)
              || '15min';
        case 'sourceFooter':
          return `corey=${coreyStatus} · spidey=${spideyStatus} · historical=${historicalStatus}`;
        case 'entry':
          return (jane?.entryZone?.mid ?? jane?.entry) || 'Pending';
        case 'stopLoss':
          return jane?.invalidationLevel ?? jane?.stopLoss ?? 'Not authorised';
        case 'target':
          return (jane?.targets && jane.targets[0]) || jane?.target1 || 'Not authorised';
        case 'extendedStopLoss':
          return jane?.extendedStop ?? jane?.extendedStopLoss ?? 'Not authorised';
        case 'mechanism':
          return jane?.mechanism || corey?.mechanismSummary || '—';
        case 'scenario':
          // Always a real probabilities object (zeros when unavailable).
          return (jane?.scenario && (jane.scenario.continuation || jane.scenario.range || jane.scenario.reversal))
            ? jane.scenario
            : { continuation: 0, range: 0, reversal: 0 };
        case 'directionPlain':
          return jane?.directionPlain || corey?.combinedBias || 'No clean directional read.';
        case 'convictionLabel':
          return jane?.convictionLabel
              || jane?.conviction
              || (Number.isFinite(corey?.confidence) ? `confidence ${corey.confidence}` : null)
              || 'No authorised trade conviction';
      }
      return __withheld('Unmapped decision field: ' + k);
    };
    const SPEC_DECISION_FIELDS = [
      'actionState','biasDirection','tradePermission','conditionGrid','forwardExpectation',
      'triggerMap','candidates','cancellationTrigger','nextReassessmentTime','validityWindow',
      'sourceFooter','entry','stopLoss','target','extendedStopLoss','mechanism','scenario','convictionLabel'
    ];
    const __resolved = {};
    for (const k of SPEC_DECISION_FIELDS) __resolved[k] = __resolveDecisionField(k);
    // Two distinct counts so the dashboard can distinguish:
    //   present       = field is populated (real value OR structured withheld
    //                   payload with an explicit reason). This is what the
    //                   spec wants surfaced as decisionFieldsPresent.
    //   realValue     = subset of present where the value is NOT a withheld
    //                   payload. Reflects actual signal availability.
    //   withheld      = subset of present where the value IS a withheld
    //                   payload, with a reason field.
    //   absent        = field returned null/undefined/empty (logger gap).
    const __isPopulated = (v) => v != null && v !== '';
    const __isWithheldPayload = (v) => !!(v && typeof v === 'object' && v.withheld === true);
    const __isRealValue = (v) => __isPopulated(v) && !__isWithheldPayload(v);

    const presentDecisionFields  = SPEC_DECISION_FIELDS.filter(k => __isPopulated(__resolved[k]));
    const realValueDecisionFields = SPEC_DECISION_FIELDS.filter(k => __isRealValue(__resolved[k]));
    const withheldDecisionFields = SPEC_DECISION_FIELDS.filter(k => __isWithheldPayload(__resolved[k]));
    const absentDecisionFields   = SPEC_DECISION_FIELDS.filter(k => !__isPopulated(__resolved[k]));

    const decisionWithheldReasons = {};
    for (const k of withheldDecisionFields) decisionWithheldReasons[k] = __resolved[k].reason || 'unset';
    for (const k of absentDecisionFields)   decisionWithheldReasons[k] = 'unset (resolver returned null)';
    // Back-compat — older log lines read `DECISION_FIELDS` and `missingDecisionFields`.
    // `missingDecisionFields` = NOT populated at all (the genuinely missing slots).
    const DECISION_FIELDS = SPEC_DECISION_FIELDS;
    const missingDecisionFields = absentDecisionFields;

    let janeStatus;
    if (!janeIsObject || janeKeys.length === 0) {
      janeStatus = 'unavailable:no_packet';
    } else if (presentDecisionFields.length === 0) {
      janeStatus = 'withheld:empty_decision_packet';
    } else if (coreyStatus !== 'ok' || spideyStatus === 'unavailable') {
      janeStatus = 'withheld:source_incomplete';
    } else {
      const action = String(jane.actionState || jane.combinedBias || jane.permitLabel || jane.verdict || '').toUpperCase();
      janeStatus = action.includes('TRADE CONFIRMED')   ? 'final:trade_confirmed'
                 : action.includes('ENTRY AUTHORISED')  ? 'final:entry_authorised'
                 : action.includes('ARMED')             ? 'final:armed'
                 : 'final:no_trade';
    }

    const sources = {
      marketData: 'pending',         // dashboard fills this from /twelvedata results
      corey:      coreyStatus,
      coreyClone: coreyCloneStatus,
      spidey:     spideyStatus,
      jane:       janeStatus,
      historical: historicalStatus
    };

    // sourceMissing is the same object as sourceMissingEarly (computed before
    // the resolver so the structured no-trade builders share the same view).
    const sourceMissing = sourceMissingEarly;

    console.log(`[JANE-BUILD] symbol=${symbol} corey=${coreyStatus} spidey=${spideyStatus} historical=${historicalStatus} jane=${janeStatus}`);
    console.log(`[JANE-BUILD] janeKeys=${janeKeys.length} present=${janeKeys.slice(0, 12).join(',')}`);
    console.log(`[JANE-BUILD] decisionFieldsPresent=${presentDecisionFields.length}/${DECISION_FIELDS.length} realValue=${realValueDecisionFields.length} withheld=${withheldDecisionFields.length} absent=${absentDecisionFields.length}`);
    if (withheldDecisionFields.length) {
      const __preview = withheldDecisionFields.slice(0, 6).map(k => `${k}="${(decisionWithheldReasons[k] || '').slice(0, 60)}"`).join(' | ');
      console.log(`[JANE-BUILD] withheldDecisionFields=${withheldDecisionFields.join(',')} reason=${__preview}`);
    }
    if (absentDecisionFields.length) {
      console.log(`[JANE-BUILD] absentDecisionFields=${absentDecisionFields.join(',')}`);
    }

    const assetClass = corey?.internalMacro?.assetClass
                    || (/^[A-Z]{6}$/.test(symbol) ? 'fx'
                        : /^(NAS100|US500|US30|DJI|GER40|UK100|SPX|NDX|HK50|JPN225)$/.test(symbol) ? 'index'
                        : /XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(symbol) ? 'commodity'
                        : 'equity');
    // last-price extraction — try every plausible field on corey/spidey/jane.
    const last = jane?.lastPrice
              ?? jane?.currentPrice
              ?? spideyHTF?.currentPrice
              ?? spideyHTF?.lastPrice
              ?? spideyLTF?.currentPrice
              ?? corey?.lastPrice
              ?? corey?.internalMacro?.lastPrice
              ?? null;

    const packet = {
      symbol,
      assetClass,
      lastPrice: last,
      lastChangePct: 0,
      sources,

      // Decision layer — sourced from Jane / structure objects when available.
      actionState:     jane?.actionState     || (jane?.combinedBias ? `BIAS ${jane.combinedBias.toUpperCase()}` : 'WAIT — NO TRADE'),
      actionTone:      jane?.actionTone      || (/AUTHORISED|CONFIRMED/i.test(jane?.actionState||'') ? 'green' : /ARMED/i.test(jane?.actionState||'') ? 'gold' : 'red'),
      biasDirection:   corey?.combinedBias   || jane?.bias || 'Neutral',
      tradePermission: jane?.permitLabel     || (jane ? 'No entry authorised' : 'Withheld — Jane unavailable'),
      validityMinutes: 15,
      reassessMinutes: 60,
      direction:       jane?.directionPlain  || corey?.combinedBias || '',

      entry:            jane?.entryZone?.mid   ?? jane?.entry            ?? 'Pending',
      entrySub:         jane?.entryNote        || '',
      stopLoss:         jane?.invalidationLevel ?? jane?.stopLoss        ?? 'Not authorised',
      extendedStopLoss: jane?.extendedStop     ?? 'Not authorised',
      target:           (jane?.targets && jane.targets[0])              ?? 'Not authorised',
      riskDollars:      jane?.riskDollars      || 'Not active',
      riskSub:          jane?.riskSub          || 'no entry / no invalidation',
      targetDollars:    jane?.targetDollars    || 'Not active',
      costDollars:      jane?.costDollars      || '',
      cancellation:     jane?.cancellationTrigger || '—',

      bullishCandidate: jane?.bullishCandidate || null,
      bearishCandidate: jane?.bearishCandidate || null,

      // Condition grid — fall through to legacy gridScores if present.
      grid:        jane?.grid       || jane?.conditionGrid       || { executionAuthority:0, structure:0, liquidityPressure:0, eventRisk:0, sessionEnergy:0, macroAlignment:0, conviction:0, regime:0 },
      gridNotes:   jane?.gridNotes   || {},
      gridEffects: jane?.gridEffects || {},

      // Forward Expectation block — reuse the same payload the resolver
      // returned so __resolved.forwardExpectation === packet.forward and
      // the dashboard renders the exact structured no-trade copy that
      // counts as the populated decision field.
      forward:     __forwardBlockResolved,
      // Trigger Map block — same identity guarantee.
      triggers:    __triggerBlockResolved,

      historical:      jane?.historical      || [],
      mechanism:       jane?.mechanism       || corey?.mechanismSummary || '',
      mechanismDetail: jane?.mechanismDetail || null,
      scenario:        jane?.scenario        || { continuation:0, range:0, reversal:0 },
      scenarioDetail:  jane?.scenarioDetail  || null,
      events:          jane?.events          || [],
      matrix:          jane?.matrix          || [],

      // Source-incomplete annotations — let the dashboard surface what is
      // missing in the Forward Expectation / Trigger Map blocks per spec.
      sourceMissing: sourceMissing,
      missingDecisionFields: missingDecisionFields,   // array — surfaced by dashboard withhold banner
      // 18-field operational decision packet per macro v3 spec. Each field is
      // either a real value or a structured { withheld:true, reason } payload.
      decisionFields:           __resolved,
      decisionFieldsPresent:    presentDecisionFields,
      decisionFieldsWithheld:   withheldDecisionFields,
      decisionWithheldReasons:  decisionWithheldReasons,
      withholdNotes: {
        forwardExpectation: sourceMissing.missingSpidey ? 'Forward expectation withheld because the structure / trigger source (Spidey) is unavailable. Reassess after Spidey structure packet is restored.'
                          : sourceMissing.missingCorey  ? 'Macro timing and catalyst context unavailable. No timing window beyond candle-close schedule can be trusted.'
                          : null,
        triggerMap:         sourceMissing.missingSpidey ? 'Trigger Map withheld — Spidey structure / trigger packet unavailable. No bullish/bearish trigger can be printed safely.'
                          : null,
        historical:         sourceMissing.missingHistorical ? 'Historical unavailable / no cache match — no historical edge used.'
                          : null
      }
    };

    // (Note: previous override that null'd packet.triggers / packet.forward
    // when Spidey was missing has been removed — buildTriggerBlock /
    // buildForwardBlock above already emit structured withheld payloads
    // that carry the explicit reason. Nulling them again would erase the
    // structured no-trade copy that the dashboard depends on.)
    if (sourceMissing.missingSpidey) {
      packet.bullishCandidate = packet.bullishCandidate || { withheld: true, reason: 'Spidey structure / trigger packet unavailable.' };
      packet.bearishCandidate = packet.bearishCandidate || { withheld: true, reason: 'Spidey structure / trigger packet unavailable.' };
    }
    // Structured-payload-aware status: 'present' = real value, 'withheld'
    // = structured no-trade payload with explicit reason, 'absent' = null.
    const __triggerStatus = (side) => {
      const t = packet.triggers && packet.triggers[side];
      if (!t || typeof t !== 'object') return 'absent';
      if (t.withheldReason) return 'withheld';
      if (t.level && t.tf) return 'present';
      return 'partial';
    };
    const __forwardStatus = () => {
      const f = packet.forward;
      if (!f || typeof f !== 'object') return 'absent';
      if (f.withheldReason && !f.realValue) return 'withheld';
      return Object.keys(f).filter(k => f[k] != null && f[k] !== '').length > 0 ? 'present' : 'absent';
    };
    console.log(`[JANE-BUILD] forwardExpectation fields=${Object.keys(packet.forward||{}).length} status=${__forwardStatus()} triggerMap bullish=${__triggerStatus('bullish')} bearish=${__triggerStatus('bearish')}`);
    console.log(`[JANE-BUILD] packetKeys=${Object.keys(packet).length} actionState="${packet.actionState||''}" biasDirection="${packet.biasDirection||''}" tradePermission="${packet.tradePermission||''}"`);

    const body = JSON.stringify(packet);
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? require('http') : require('https');
    const req = lib.request({
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'http:' ? 80 : 443),
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout:  6000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end',  ()  => {
        if (res.statusCode >= 200 && res.statusCode < 300) console.log(`[JANE-POST] ${symbol} → dashboard ok http=${res.statusCode}`);
        else console.warn(`[JANE-POST] ${symbol} → dashboard non-ok http=${res.statusCode} body=${buf.slice(0, 120)}`);
      });
      res.on('error', (e) => console.warn(`[JANE-POST] response error: ${e.message}`));
    });
    req.on('error',   (e) => console.warn(`[JANE-POST] request error: ${e.message}`));
    req.on('timeout', ()  => { req.destroy(); console.warn(`[JANE-POST] timeout`); });
    req.write(body);
    req.end();
  } catch (e) {
    console.warn(`[JANE-POST] unexpected: ${e.message}`);
  }
}

client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.content || !msg.content.startsWith('!')) return;
    const userInput = msg.content.slice(1).trim();
    console.log(`[COMMAND] raw=!${userInput}`);
    console.log(`[SYMBOL-TRACE] rawCommand=!${userInput}`);

    if (OPS_COMMANDS.has(userInput.toLowerCase())) return;

    const tokens = userInput.split(/\s+/).filter(Boolean);
    const symRaw = tokens[0] || '';
    const modeRaw = (tokens[1] || '').toLowerCase();
    console.log(`[SYMBOL-TRACE] parsedSymbol=${symRaw} modeRaw=${modeRaw}`);
    const isRenderMode = RENDER_MODES.has(modeRaw);
    if (tokens.length > 1 && !isRenderMode) return;

    const auditBase = {
      discord_user_id: msg.author.id,
      discord_user_display_name: msg.member?.displayName || msg.author.username || msg.author.tag || 'unknown',
      channel_id: msg.channelId,
      channel_name: msg.channel?.name ?? null,
      raw_input: userInput,
    };

    const mappedUpper = symRaw.toUpperCase();
    if (POLICY_REJECTED_TERMS.has(mappedUpper)) {
      console.log(`[SYMBOL] raw=${symRaw} resolved=unknown outcome=unavailable reason=policy_rejected mapped=${mappedUpper}`);
      emitAuditLog({ ...auditBase, timestamp: new Date().toISOString(), resolved_symbol: 'unknown', outcome: 'policy_rejected', reason: 'policy_rejected' });
      await msg.channel.send({ content: 'Cryptocurrency is not supported on ATLAS. Please search a supported instrument.' });
      return;
    }

    const resolved = resolveSymbol(symRaw);
    console.log(`[SYMBOL] raw=${symRaw} resolved=${resolved}`);
    console.log(`[SYMBOL-TRACE] resolvedSymbol=${resolved}`);
    const validation = validateInput('!' + resolved);
    if (!validation.valid) {
      if (validation.reason === 'format' || validation.reason === 'unknown_instrument') {
        console.log(`[SYMBOL] raw=${symRaw} resolved=unknown outcome=unavailable reason=${validation.reason}`);
        emitAuditLog({ ...auditBase, timestamp: new Date().toISOString(), resolved_symbol: 'unknown', outcome: 'unavailable', reason: validation.reason });
        await msg.channel.send({ content: `Data unavailable for requested symbol: ${symRaw}` });
      }
      return;
    }
    const symbol = validation.symbol;
    if (!isResolvableSymbol(symbol)) {
      console.log(`[SYMBOL] raw=${symRaw} resolved=unknown outcome=unavailable reason=not_in_allowlist mapped=${symbol}`);
      emitAuditLog({ ...auditBase, timestamp: new Date().toISOString(), resolved_symbol: 'unknown', outcome: 'unavailable', reason: 'not_in_allowlist' });
      await msg.channel.send({ content: `Data unavailable for requested symbol: ${symRaw}` });
      return;
    }
    console.log(`[SYMBOL] raw=${symRaw} resolved=${symbol} outcome=served`);
    console.log(`[SYMBOL-TRACE] validatedSymbol=${symbol}`);
    emitAuditLog({ ...auditBase, timestamp: new Date().toISOString(), resolved_symbol: symbol, outcome: 'served', reason: null });

    const user = resolveUserCode(msg);

    if (!isRenderMode) {
      const dUrl = dashboardUrl(symbol, user);
      console.log(`[ROUTE] dashboard_link symbol=${symbol} user=${user}`);
      console.log(`[SYMBOL-TRACE] dashboardUrl=${dUrl}`);
      await msg.channel.send({ content: `📊 **${symbol} — ATLAS Dashboard**\n${dUrl}` });
      console.log(`[DISCORD] dashboard link sent symbol=${symbol} user=${user}`);
      return;
    }

    console.log(`[ROUTE] live_analysis symbol=${symbol} mode=${modeRaw}`);
    console.log(`[SYMBOL-TRACE] renderSymbol=${symbol}`);
    // [DATA-SOURCE] line — always fires, defensive internals. The earlier
    // try/catch suppressed any logger error and could explain the missing
    // line on the post-PR-#21 live run. logDataSource() now never throws.
    logDataSource(symbol);
    await msg.channel.send({ content: `📡 Analysing **${symbol}** — please wait` });

    let renderResult;
    try {
      renderResult = await renderAllPanelsV3(symbol);
    } catch (e) {
      console.log(`[DISCORD] live render blocked reason=render_threw:${e.message}`);
      await msg.channel.send({ content: `⚠️ Chart capture failed for ${symbol} — analysis withheld until valid chart render is available.` });
      return;
    }
    const v = Array.isArray(renderResult.validation) ? renderResult.validation : null;
    if (!v) {
      console.log(`[DISCORD] live render blocked reason=invalid_chart_capture`);
      await msg.channel.send({ content: `⚠️ Chart capture failed for ${symbol} — analysis withheld until valid chart render is available.` });
      return;
    }
    if (v.some(x => !x.ok)) {
      console.log(`[DISCORD] live render blocked reason=invalid_chart_capture`);
      const failed = v.filter(x => !x.ok).map(x => x.label || x.interval).join(', ');
      await msg.channel.send({ content: `⚠️ Chart capture failed for ${symbol} (${failed}) — analysis withheld until valid chart render is available.` });
      return;
    }

    console.log(`[SYMBOL-TRACE] deliverSymbol=${symbol} renderResultKeys=${Object.keys(renderResult || {}).join(',')} renderResultSymbol=${renderResult && renderResult.symbol !== undefined ? renderResult.symbol : 'undefined'}`);
    await deliverResult(msg, { symbol, mode: modeRaw, ...renderResult });
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
function inferAssetClass(s){if(EQUITY_SYMBOLS.has(s))return ASSET_CLASS.EQUITY;if(COMMODITY_SYMBOLS.has(s))return ASSET_CLASS.COMMODITY;if(INDEX_SYMBOLS.has(s))return ASSET_CLASS.INDEX;if(isFxPair(s))return ASSET_CLASS.FX;if(/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s))return ASSET_CLASS.COMMODITY;if(/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s))return ASSET_CLASS.INDEX;if(/^[A-Z]{1,5}$/.test(s))return ASSET_CLASS.EQUITY;return ASSET_CLASS.UNKNOWN;}

// ── DATA-SOURCE ROUTER LOG ──────────────────────────────────────────
// Emits a single [DATA-SOURCE] line per !micron analyse summarising which
// provider feeds each data type (quote / ohlc / fundamentals / calendar /
// historical) given the active env config + asset class. Routing rules:
//   equity:    quote → eodhd (else twelvedata) | ohlc → twelvedata (FMP demoted)
//              fundamentals → eodhd | historical → 15Y-cache (else eodhd)
//   FX/cmdty:  quote → twelvedata (else eodhd) | ohlc → fmp+twelvedata
//              fundamentals → n/a | historical → 15Y-cache (else eodhd)
//   calendar:  whichever source corey_calendar last reported as source_used.
//
// IMPORTANT: this function NEVER throws and ALWAYS emits the [DATA-SOURCE]
// line — even if every internal lookup fails. The earlier wrapping
// try/catch + internal try/catch combo could swallow the line entirely
// when something below the route went wrong. We now compute each field
// independently with its own catch, then emit the line unconditionally.
function logDataSource(symbol) {
  let ac = 'unknown';
  try { ac = inferAssetClass(normalizeSymbol(symbol)); } catch (_e) {}
  let eodhdOn = false;
  try { eodhdOn = !!(eodhdAdapter && eodhdAdapter.isEnabled && eodhdAdapter.isEnabled()); } catch (_e) {}
  const tdOn = !!TWELVE_DATA_KEY;
  const fmpOn = !!FMP_API_KEY;
  let quote = 'none', ohlc = 'none', fundamentals = 'none';
  try {
    if (ac === ASSET_CLASS.EQUITY) {
      quote        = eodhdOn ? 'eodhd' : (tdOn ? 'twelvedata' : 'none');
      ohlc         = tdOn ? 'twelvedata' : (eodhdOn ? 'eodhd' : 'none');
      fundamentals = eodhdOn ? 'eodhd' : 'none';
    } else {
      quote        = tdOn ? 'twelvedata' : (eodhdOn ? 'eodhd' : 'none');
      ohlc         = fmpOn ? 'fmp+twelvedata' : (tdOn ? 'twelvedata' : (eodhdOn ? 'eodhd' : 'none'));
      fundamentals = 'none';
    }
  } catch (_e) {}
  let calendar = 'none';
  try {
    const h = (coreyCalendar.getCalendarHealth && coreyCalendar.getCalendarHealth()) || {};
    calendar = h.source_used === 'tradingview'       ? 'tradingview'
             : h.source_used === 'trading_economics' ? 'te'
             : h.source_used === 'degraded'          ? 'degraded'
             : 'none';
  } catch (_e) {}
  let cacheHit = false;
  try {
    const cacheReader = require('./cacheReader');
    const symU = String(symbol).toUpperCase();
    cacheHit = !!(cacheReader && cacheReader.SYMBOL_GROUP_MAP && cacheReader.SYMBOL_GROUP_MAP[symU]);
  } catch (_e) {}
  const historical = cacheHit ? '15Y-cache' : (eodhdOn ? 'eodhd' : 'none');
  // Single-line emit — guaranteed to fire on every live route.
  console.log(`[DATA-SOURCE] symbol=${symbol} quote=${quote} ohlc=${ohlc} fundamentals=${fundamentals} calendar=${calendar} historical=${historical}`);
  return { ac, quote, ohlc, fundamentals, calendar, historical };
}
function parsePairCore(symbol){const s=normalizeSymbol(symbol);if(isFxPair(s))return{symbol:s,base:s.slice(0,3),quote:s.slice(3,6),assetClass:ASSET_CLASS.FX};if(['XAUUSD','XAGUSD','BCOUSD'].includes(s))return{symbol:s,base:s.slice(0,3),quote:s.slice(3,6),assetClass:inferAssetClass(s)};return{symbol:s,base:s,quote:'USD',assetClass:inferAssetClass(s)};}
const makeStubCB=label=>({name:label||'Commodity',stance:STANCE.N_A,direction:STANCE.N_A,rateCycle:RATE_CYCLE.N_A,terminalBias:0,inflationSensitivity:0.5,growthSensitivity:0.5,score:0});
const makeStubEcon=()=>({gdpMomentum:0.5,employment:0.5,inflationControl:0.5,fiscalPosition:0.5,politicalStability:0.5,composite:0.5});

function getPipSize(symbol){const s=normalizeSymbol(symbol);if(s.includes('JPY'))return{pipSize:0.01,dp:3};if(s==='XAGUSD'||s==='XAGEUR')return{pipSize:0.01,dp:3};if(s==='XAUUSD'||s==='XAUEUR')return{pipSize:0.10,dp:2};if(/BCOUSD|USOIL|WTI|BRENT/.test(s))return{pipSize:0.01,dp:3};if(/NATGAS/.test(s))return{pipSize:0.001,dp:4};if(INDEX_SYMBOLS.has(s)||/NAS|US500|US30|GER40|UK100|SPX|NDX|DJI|HK50|JPN225/.test(s))return{pipSize:1.0,dp:1};if(EQUITY_SYMBOLS.has(s)||SEMI_SYMBOLS.has(s))return{pipSize:0.01,dp:3};if(isFxPair(s))return{pipSize:0.0001,dp:5};return{pipSize:0.0001,dp:5};}
function fmtPrice(n,symbol){if(n==null||!Number.isFinite(n))return'N/A';if(symbol){const{dp}=getPipSize(symbol);return Number(n).toFixed(dp);}if(n>100)return Number(n).toFixed(2);if(n>1)return Number(n).toFixed(4);return Number(n).toFixed(5);}

const SYMBOL_OVERRIDES={XAUUSD:'OANDA:XAUUSD',XAGUSD:'OANDA:XAGUSD',BCOUSD:'OANDA:BCOUSD',USOIL:'OANDA:BCOUSD',NAS100:'OANDA:NAS100USD',US500:'OANDA:SPX500USD',US30:'OANDA:US30USD',GER40:'OANDA:DE30EUR',UK100:'OANDA:UK100GBP',NATGAS:'NYMEX:NG1!',MICRON:'NASDAQ:MU',AMD:'NASDAQ:AMD',ASML:'NASDAQ:ASML'};
const TD_SYMBOL_MAP={XAUUSD:'XAU/USD',XAGUSD:'XAG/USD',BCOUSD:'BCO/USD',USOIL:'WTI/USD',NAS100:'NDX',US500:'SPX',US30:'DIA',DJI:'DIA',GER40:'DAX',UK100:'UKX',NATGAS:'NG/USD',EURUSD:'EUR/USD',GBPUSD:'GBP/USD',USDJPY:'USD/JPY',AUDUSD:'AUD/USD',NZDUSD:'NZD/USD',USDCAD:'USD/CAD',USDCHF:'USD/CHF',EURGBP:'EUR/GBP',EURJPY:'EUR/JPY',GBPJPY:'GBP/JPY',AUDJPY:'AUD/JPY',CADJPY:'CAD/JPY',NZDJPY:'NZD/JPY',CHFJPY:'CHF/JPY',EURCHF:'EUR/CHF',EURAUD:'EUR/AUD',EURCAD:'EUR/CAD',GBPAUD:'GBP/AUD',GBPCAD:'GBP/CAD',GBPCHF:'GBP/CHF',AUDCAD:'AUD/CAD',AUDCHF:'AUD/CHF',AUDNZD:'AUD/NZD',CADCHF:'CAD/CHF',NZDCAD:'NZD/CAD',NZDCHF:'NZD/CHF',MICRON:'MU',AMD:'AMD',ASML:'ASML',NVDA:'NVDA'};
const TD_INTERVAL_MAP={'1W':'1week','1D':'1day','240':'4h','60':'1h','30':'30min','15':'15min','5':'5min','1':'1min'};

// ── FMP OHLC mapping ────────────────────────────────────────────────
// FMP /stable historical-chart endpoint covers intraday 1min..4hour.
// FMP /stable historical-price-eod/full covers daily. Weekly is not a
// native FMP interval; we leave '1W' unmapped so weekly calls fall
// through to TwelveData (which has native /1week support).
//
// FX: FMP uses concatenated pair tickers (EURUSD, GBPUSD, ...)
// Equities: same ticker as internal (MU, AMD, NVDA, ASML)
// Metals: FMP supports XAUUSD, XAGUSD natively
// Indexes: FMP uses ^GSPC / ^DJI / ^NDX / ^GDAXI / ^FTSE
// Energy/NatGas: aliased to FMP commodity tickers
// Anything not in FMP_SYMBOL_MAP falls through to FMP using the input
// symbol directly; if that fails the caller falls back to TwelveData.
const FMP_SYMBOL_MAP={
  XAUUSD:'XAUUSD',XAGUSD:'XAGUSD',
  BCOUSD:'BZUSD',USOIL:'CLUSD',NATGAS:'NGUSD',
  NAS100:'^NDX',US500:'^GSPC',US30:'^DJI',DJI:'^DJI',GER40:'^GDAXI',UK100:'^FTSE',
  EURUSD:'EURUSD',GBPUSD:'GBPUSD',USDJPY:'USDJPY',AUDUSD:'AUDUSD',NZDUSD:'NZDUSD',
  USDCAD:'USDCAD',USDCHF:'USDCHF',EURGBP:'EURGBP',EURJPY:'EURJPY',GBPJPY:'GBPJPY',
  AUDJPY:'AUDJPY',CADJPY:'CADJPY',NZDJPY:'NZDJPY',CHFJPY:'CHFJPY',EURCHF:'EURCHF',
  EURAUD:'EURAUD',EURCAD:'EURCAD',GBPAUD:'GBPAUD',GBPCAD:'GBPCAD',GBPCHF:'GBPCHF',
  AUDCAD:'AUDCAD',AUDCHF:'AUDCHF',AUDNZD:'AUDNZD',CADCHF:'CADCHF',NZDCAD:'NZDCAD',NZDCHF:'NZDCHF',
  MICRON:'MU',MU:'MU',AMD:'AMD',ASML:'ASML',NVDA:'NVDA'
};
// Resolution → FMP interval. 'EOD' is a sentinel meaning "use the daily
// historical-price-eod endpoint". '1W' is intentionally absent.
const FMP_INTERVAL_MAP={'1D':'EOD','240':'4hour','60':'1hour','30':'30min','15':'15min','5':'5min','1':'1min'};
function getTVSymbol(s){if(SYMBOL_OVERRIDES[s])return SYMBOL_OVERRIDES[s];if(/^[A-Z]{6}$/.test(s))return`OANDA:${s}`;return`NASDAQ:${s}`;}
function getFeedName(s){const f=getTVSymbol(s).split(':')[0];return{OANDA:'OANDA',NASDAQ:'NASDAQ',NYSE:'NYSE',NYMEX:'NYMEX',TVC:'TVC'}[f]||f;}
const log=(level,msg,...a)=>console.log(`[${new Date().toISOString()}] [${level}] ${msg}`,...a);

// Policy-rejected instrument terms — neutrally named per doctrine. Matched
// case-insensitively against normalised (uppercased, trimmed) user input in
// the messageCreate handler BEFORE validateInput / resolveSymbol run. When a
// user types a term from this set, the handler replies with the fixed
// "Cryptocurrency is not supported on ATLAS" message and emits a [SYMBOL]
// line with reason=policy_rejected.
const POLICY_REJECTED_TERMS=new Set(['BTC','ETH','XRP','DOGE','ADA','SOL','DOT','AVAX','MATIC','LINK','LTC','BCH','XLM','ATOM','ALGO','BITCOIN','ETHEREUM']);
// Allowlist gate — resolved canonical ticker must be a known tradable instrument.
// Protects against format-valid-but-unsupported symbols like HGUSD / XYZ123 /
// 6-char junk that slip past validateInput's format regex and unknown_instrument
// check. Returns true only if the symbol is in one of the known universes
// (FX pair OR equity OR commodity OR index symbol set).
const isResolvableSymbol=s=>!!s&&(isFxPair(s)||EQUITY_SYMBOLS.has(s)||COMMODITY_SYMBOLS.has(s)||INDEX_SYMBOLS.has(s));
const REJECTED_TERMS=new Set(['LH','HL','HH','LL','BUY','SELL','BULLISH','BEARISH','LONG','SHORT','MACRO','UP','DOWN','CALL','PUT','H','L']);
const REJECTED_GENERIC=new Set([]);
const SYMBOL_ALIASES={SILVER:'XAGUSD',XAG:'XAGUSD',GOLD:'XAUUSD',XAU:'XAUUSD',NASDAQ:'NAS100',NDX:'NAS100',NAS:'NAS100',SP500:'US500',SPX:'US500',DOW:'US30',DJI:'US30',DAX:'GER40',FTSE:'UK100',OIL:'USOIL',BRENT:'BCOUSD',WTI:'USOIL',GAS:'NATGAS',MICRON:'MU',ASML:'ASML',AMD:'AMD'};
function resolveSymbol(s){if(!s)return s;const up=s.toUpperCase().trim();return SYMBOL_ALIASES[up]||up;}
function validateInput(raw){const t=(raw||'').trim();if(!t.startsWith('!'))return{valid:false,reason:'no_prefix'};const content=t.slice(1).trim();const tokens=content.split(/\s+/);if(tokens[0]==='ping')return{valid:false,reason:'ops',op:'ping'};if(tokens[0]==='stats')return{valid:false,reason:'ops',op:'stats'};if(tokens[0]==='errors')return{valid:false,reason:'ops',op:'errors'};if(tokens[0]==='sysstate')return{valid:false,reason:'ops',op:'sysstate'};if(tokens[0]==='darkhorse')return{valid:false,reason:'ops',op:'darkhorse'};if(tokens.length>1)return{valid:false,reason:'extra_tokens'};const sym=tokens[0].toUpperCase();if(REJECTED_TERMS.has(sym))return{valid:false,reason:'direction_term'};if(REJECTED_GENERIC.has(sym))return{valid:false,reason:'generic_name'};if(!/^[A-Z0-9]{2,10}$/.test(sym))return{valid:false,reason:'format'};const ac=inferAssetClass(sym);if(ac===ASSET_CLASS.UNKNOWN&&!isFxPair(sym)&&sym.length!==6)return{valid:false,reason:'unknown_instrument'};return{valid:true,symbol:sym};}
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

function fetchOHLCTD(symbol,resolution,count=200){return new Promise((resolve,reject)=>{const tdSym=encodeURIComponent(TD_SYMBOL_MAP[symbol]||symbol),tdInt=TD_INTERVAL_MAP[resolution]||'1day';const opts={hostname:'api.twelvedata.com',path:`/time_series?symbol=${tdSym}&interval=${tdInt}&outputsize=${count}&apikey=${TWELVE_DATA_KEY}&format=JSON`,method:'GET',headers:{'User-Agent':'ATLAS-FX/4.0'},timeout:15000};const req=https.request(opts,r=>{let data='';r.on('data',c=>{data+=c;});r.on('end',()=>{try{const p=JSON.parse(data);if(p.status==='error'||!p.values||!Array.isArray(p.values)){reject(new Error(`TwelveData: ${p.message||'unknown'}`));return;}resolve(p.values.slice().reverse().map(v=>({time:Math.floor(new Date(v.datetime).getTime()/1000),open:parseFloat(v.open),high:parseFloat(v.high),low:parseFloat(v.low),close:parseFloat(v.close),volume:v.volume?parseFloat(v.volume):0})));}catch(e){reject(new Error(`TwelveData parse: ${e.message}`));}});});req.on('error',reject);req.on('timeout',()=>reject(new Error('TwelveData timeout')));req.end();});}

// ── FMP OHLC fetcher ─────────────────────────────────────────────────
// Endpoints:
//   intraday: GET /stable/historical-chart/{interval}?symbol=X&apikey=K
//             returns [{date:'YYYY-MM-DD HH:MM:SS', open, high, low, close, volume}, ...] (descending)
//   daily:    GET /stable/historical-price-eod/full?symbol=X&apikey=K
//             returns either {symbol, historical:[{date:'YYYY-MM-DD', open, high, low, close, volume}, ...]}
//             or a bare array of the same shape (FMP varies); we handle both.
function fetchOHLCFMP(symbol,resolution,count=200){
  return new Promise((resolve,reject)=>{
    if(!FMP_API_KEY){reject(new Error('FMP_API_KEY not set'));return;}
    const fmpInt=FMP_INTERVAL_MAP[resolution];
    if(!fmpInt){reject(new Error(`FMP unsupported resolution: ${resolution}`));return;}
    const fmpSym=encodeURIComponent(FMP_SYMBOL_MAP[symbol]||symbol);
    const path=fmpInt==='EOD'
      ?`/stable/historical-price-eod/full?symbol=${fmpSym}&apikey=${encodeURIComponent(FMP_API_KEY)}`
      :`/stable/historical-chart/${fmpInt}?symbol=${fmpSym}&apikey=${encodeURIComponent(FMP_API_KEY)}`;
    const opts={hostname:'financialmodelingprep.com',path,method:'GET',headers:{'User-Agent':'ATLAS-FX/4.0','Accept':'application/json'},timeout:15000};
    const req=https.request(opts,r=>{
      let data='';r.on('data',c=>{data+=c;});
      r.on('end',()=>{
        if(r.statusCode<200||r.statusCode>=300){reject(new Error(`FMP ${r.statusCode}: ${(data||'').slice(0,120)}`));return;}
        let parsed;
        try{parsed=JSON.parse(data);}
        catch(e){reject(new Error(`FMP parse: ${e.message}`));return;}
        // Unwrap response variants
        let rows;
        if(Array.isArray(parsed))rows=parsed;
        else if(parsed&&Array.isArray(parsed.historical))rows=parsed.historical;
        else if(parsed&&parsed['Error Message'])return reject(new Error(`FMP: ${parsed['Error Message']}`));
        else return reject(new Error('FMP: unexpected response shape'));
        if(!rows.length)return reject(new Error('FMP: empty result'));
        // FMP returns descending (newest first). We need ascending (oldest first) per existing consumers.
        const sliced=rows.slice(0,count).reverse();
        const out=sliced.map(v=>{
          const ds=v.date||v.datetime||'';
          // intraday "YYYY-MM-DD HH:MM:SS" — treat as UTC; daily "YYYY-MM-DD" — treat as midnight UTC.
          const iso=ds.length===10?`${ds}T00:00:00Z`:ds.replace(' ','T')+'Z';
          return{
            time:Math.floor(new Date(iso).getTime()/1000),
            open:parseFloat(v.open),
            high:parseFloat(v.high),
            low:parseFloat(v.low),
            close:parseFloat(v.close),
            volume:v.volume!=null?parseFloat(v.volume):0
          };
        }).filter(c=>Number.isFinite(c.time)&&Number.isFinite(c.close));
        if(!out.length)return reject(new Error('FMP: no parseable candles'));
        resolve(out);
      });
    });
    req.on('error',reject);
    req.on('timeout',()=>{req.destroy();reject(new Error('FMP timeout'));});
    req.end();
  });
}

// Asset-class-aware OHLC dispatcher. FMP free-tier returns 402 on equity
// historical endpoints; we demote FMP to legacy_optional for equities and
// route TwelveData primary. FX / commodity / index keep FMP-primary
// (FMP free coverage is OK there). Unsupported FMP resolutions (e.g. '1W')
// go straight to TwelveData. The public signature is unchanged.
//
// Emits a [DATA-SOURCE-FETCH] line per resolution with the actual provider
// that delivered candles — ground-truth proof of routing for the live log.
async function fetchOHLC(symbol,resolution,count=200){
  const ac = inferAssetClass(normalizeSymbol(symbol));
  const fmpUsable = FMP_API_KEY && FMP_INTERVAL_MAP[resolution];
  const fmpDemoted = ac === ASSET_CLASS.EQUITY;
  if (fmpDemoted && FMP_API_KEY) {
    log('INFO',`[OHLC] asset=equity ${symbol} ${resolution} — FMP=legacy_optional disabled_for_ohlc, routing TwelveData primary`);
  }
  if (fmpUsable && !fmpDemoted){
    try{
      const data=await fetchOHLCFMP(symbol,resolution,count);
      log('INFO',`[OHLC] FMP ${symbol} ${resolution} candles=${data.length}`);
      console.log(`[DATA-SOURCE-FETCH] symbol=${symbol} resolution=${resolution} provider=fmp candles=${data.length}`);
      return data;
    }catch(e){
      log('WARN',`[OHLC] FMP ${symbol} ${resolution} failed: ${e.message} — falling back to TwelveData`);
    }
  }
  try {
    const tdData=await fetchOHLCTD(symbol,resolution,count);
    log('INFO',`[OHLC] TD ${symbol} ${resolution} candles=${tdData.length}`);
    console.log(`[DATA-SOURCE-FETCH] symbol=${symbol} resolution=${resolution} provider=twelvedata candles=${tdData.length}`);
    return tdData;
  } catch (tdErr) {
    // Last-resort FMP attempt for equities, only when TwelveData also failed.
    if (fmpDemoted && fmpUsable) {
      log('WARN',`[OHLC] TD ${symbol} ${resolution} failed: ${tdErr.message} — last-resort FMP attempt`);
      const data = await fetchOHLCFMP(symbol,resolution,count);
      log('INFO',`[OHLC] FMP-lastresort ${symbol} ${resolution} candles=${data.length}`);
      console.log(`[DATA-SOURCE-FETCH] symbol=${symbol} resolution=${resolution} provider=fmp-lastresort candles=${data.length}`);
      return data;
    }
    console.log(`[DATA-SOURCE-FETCH] symbol=${symbol} resolution=${resolution} provider=none error=${(tdErr && tdErr.message) || 'unknown'}`);
    throw tdErr;
  }
}
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
// RENDERING LAYER v3 — chart-img.com renderer lives in renderer.js
// ============================================================
async function renderAllPanelsV3(symbol){
  log("INFO", `[CHART] ${symbol} — rendering via chart-img.com`);
  const result = await renderAllPanels(symbol);
  const validation = Array.isArray(result.validation) ? result.validation : [];
  const htfFail = validation.slice(0, 4).filter(v => !v.ok).length;
  const ltfFail = validation.slice(4, 8).filter(v => !v.ok).length;
  return { ...result, htfFail, ltfFail, partial: htfFail > 0 || ltfFail > 0 };
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
  const { symbol, htfGrid, ltfGrid, htfGridName, ltfGridName, mode, validation } = result;
  console.log(`[PRESENTER] active_formatter=index.js#formatMacro mode=${mode || 'analyse'}`);
  console.log(`[SYMBOL-TRACE] presenterSymbol=${symbol} attachmentNameHTF=${htfGridName} attachmentNameLTF=${ltfGridName}`);

  if (!htfGrid || !ltfGrid) {
    log('ERROR', `[DELIVER] ${symbol} missing chart grids`);
    console.log(`[DISCORD] live render blocked reason=missing_chart_grids`);
    await msg.channel.send({ content: `⚠️ Chart capture failed for ${symbol} — analysis withheld until valid chart render is available.` });
    return;
  }
  // Validation gate — placeholders MUST NOT reach Discord. Routing handler
  // already enforces this for the standard mode; this is the second wall.
  if (Array.isArray(validation) && validation.some(v => !v.ok)) {
    console.log(`[DISCORD] live render blocked reason=invalid_chart_capture`);
    const failed = validation.filter(v => !v.ok).map(v => v.label || v.interval).join(', ');
    await msg.channel.send({ content: `⚠️ Chart capture failed for ${symbol} (${failed}) — analysis withheld until valid chart render is available.` });
    return;
  }

  // Charts mode — deliver charts only, no macro text.
  if (mode === 'charts') {
    await msg.channel.send({ content: `📡 **${symbol} — HTF** · Weekly · Daily · 4H · 1H`,  files: [new AttachmentBuilder(htfGrid, { name: htfGridName })] });
    await msg.channel.send({ content: `🔬 **${symbol} — LTF** · 30M · 15M · 5M · 1M`,        files: [new AttachmentBuilder(ltfGrid, { name: ltfGridName })] });
    console.log(`[PRESENTER] sections generated=0 (charts mode)`);
    console.log(`[PRESENTER-QA] pass`);
    return;
  }

  // 1. HTF chart block
  console.log(`[SYMBOL-TRACE] chartTitleSymbol=${symbol} block=HTF`);
  await msg.channel.send({
    content: `📡 **${symbol} — HTF** · Weekly · Daily · 4H · 1H`,
    files: [new AttachmentBuilder(htfGrid, { name: htfGridName })]
  });

  // 2. LTF chart block
  console.log(`[SYMBOL-TRACE] chartTitleSymbol=${symbol} block=LTF`);
  await msg.channel.send({
    content: `🔬 **${symbol} — LTF** · 30M · 15M · 5M · 1M`,
    files: [new AttachmentBuilder(ltfGrid, { name: ltfGridName })]
  });

  // 3. Gather live data surface (+ daily candles for Forward Expectation)
  let corey, spideyHTF, spideyLTF, jane, dailyCandles;
  try {
    [corey, spideyHTF, spideyLTF, dailyCandles] = await Promise.all([
      runCorey(symbol),
      runSpideyHTF(symbol, HTF_INTERVALS),
      runSpideyLTF(symbol, LTF_INTERVALS),
      safeOHLC(symbol, '1D', 25)
    ]);
    jane = runJane(symbol, spideyHTF, spideyLTF, corey);
  } catch (e) {
    log('ERROR', `[DELIVER] ${symbol} data gather failed: ${e.message}`);
    await msg.channel.send({ content: `⚠️ Macro data unavailable for ${symbol}: ${e.message}` });
    return;
  }

  const candlesByTf = { '1D': dailyCandles };
  console.log(`[SYMBOL-TRACE] macroSymbol=${symbol} coreyParsedSymbol=${corey?.internalMacro?.parsed?.symbol || 'n/a'} coreyAssetClass=${corey?.internalMacro?.assetClass || 'n/a'} janeSymbol=${jane?.symbol || 'n/a'}`);
  const sections = await formatMacro(symbol, corey, spideyHTF, spideyLTF, jane, candlesByTf);
  console.log(`[PRESENTER] sections generated=${sections.length}`);

  // Post the Jane packet to the dashboard service — populates the Execution
  // / Live Plan surface for ?symbol=<sym>. Source statuses reflect REAL
  // engine results (no fake values). Fire-and-forget — never blocks Discord
  // delivery.
  postJanePacketToDashboard(symbol, corey, spideyHTF, spideyLTF, jane);

  // Macro mode skips the chart blocks above by sending charts-then-text. To
  // honour mode=macro semantics we suppress only the visual chart resends if
  // a macro-only invocation is requested in future. Today, mode=macro and
  // mode=analyse share the same downstream content order (charts already sent).

  // PRESENTER-QA — run before sending text.
  const readiness = readinessScore(jane);
  const blocked = jane.doNotTrade || readiness <= 3 || jane.convictionLabel === 'Abstain';
  const qa = presenterQA(sections.map(s => s.text), {
    symbol,
    blocked,
    readiness,
    vol: corey.internalMacro?.global?.live?.vix?.level || 'Normal',
    ez: jane.entryZone,
    inv: jane.invalidationLevel,
    macroBias: corey.combinedBias,
    catalystInside2h: false,
    setupExpired: false,
    placeholderSent: false,
    blankChartSent: false
  });
  if (qa.ok) {
    console.log(`[PRESENTER-QA] pass`);
  } else {
    console.log(`[PRESENTER-QA] fail reason=${qa.reason}`);
    // Hard fail: we still ship the sections rather than stay silent, but we
    // surface the QA failure as a system warning so the contradiction is
    // visible to the trader and the operator.
    await msg.channel.send({ content: `⚠️ Presenter QA flagged a contradiction (\`${qa.reason}\`). Investigate before acting on this read.` });
  }

  // 4. Send sections in locked order, chunked, with logging.
  let totalChunks = 0;
  for (const section of sections) {
    const chunks = chunkMessage(section.text, DISCORD_MAX);
    console.log(`[PRESENTER] chunk count section=${section.name} chunks=${chunks.length}`);
    totalChunks += chunks.length;
    for (let i = 0; i < chunks.length; i++) {
      await msg.channel.send({ content: chunks[i] });
      console.log(`[DISCORD] section sent ${section.name} ${i + 1}`);
    }
  }
  console.log(`[PRESENTER] complete sections=${sections.length} chunks=${totalChunks}`);
}
client.login(TOKEN);
