'use strict';

// ============================================================
// darkHorseImageDispatch.js
//
// Sibling module to darkHorseEngine.js — wraps the
// renderers/foh PNG+PDF surface for the Dark Horse digest path.
// Lives outside `darkHorseFoh.js` (Cursor's ATL-6 lane) so the
// wire-in inside darkHorseEngine.js can be reduced to one
// env-gated try-block that delegates to this module.
//
// Public:
//   tryPostDarkHorseAsImage(webhookUrl, ranking, volatility, opts)
//     → { ok, status, attachments?, reason?, error? }
//
// Safe-fail contract:
//   - Never throws. Any internal failure returns ok:false so the
//     caller can drop back to the existing text digest path.
//   - Refuses to send when `FOH_IMAGE_RENDER_ENABLED !== 'true'`
//     so even if the caller forgets to gate, this module enforces
//     the env-flag boundary.
//   - When the renderer fails (puppeteer unavailable, OOM,
//     timeout), returns ok:false with the underlying reason
//     so the caller's fallback path can proceed.
// ============================================================

let _foh = null;
function _fohLazy() {
  if (_foh) return _foh;
  try { _foh = require('./renderers/foh'); return _foh; }
  catch (e) { return null; }
}

let _packet = null;
function _packetLazy() {
  if (_packet) return _packet;
  try { _packet = require('./renderers/foh/darkHorseFohPacket'); return _packet; }
  catch (e) { return null; }
}

// Read live macro context (DXY/VIX/yield) without coupling to
// the production engine. Caller can pass `coreyLiveModule` via
// opts, otherwise we try to resolve it lazily.
function _readLiveContext(opts) {
  try {
    const liveMod = (opts && opts.coreyLiveModule) || (function() { try { return require('./corey_live_data'); } catch (_e) { return null; } })();
    if (!liveMod || typeof liveMod.getLiveContext !== 'function') return null;
    return liveMod.getLiveContext();
  } catch (_e) { return null; }
}

// movePhase → lifecycle pill (renderer expects FRESH / STILL
// ACTIVE / FADING; ranking emits early / mid / late / exhaustion).
function _phaseToLifecycle(movePhase) {
  switch (String(movePhase || '').toLowerCase()) {
    case 'early':      return 'FRESH';
    case 'mid':        return 'STILL ACTIVE';
    case 'late':       return 'FADING';
    case 'exhaustion': return 'FADING';
    default:           return 'STILL ACTIVE';
  }
}

function _volSeverity(level) {
  const v = String(level || '').toLowerCase();
  if (/extreme|storm|high/.test(v)) return 'HIGH';
  if (/elev/.test(v))               return 'ELEV';
  if (/mod/.test(v))                return 'MED';
  return 'LOW';
}

function _discsForSeverity(sev) {
  switch (sev) {
    case 'HIGH': return '🔴🔴🔴🔴🔴';
    case 'ELEV': return '🟠🟠🟠🟠⚫';
    case 'MED':  return '🟡🟡🟡⚫⚫';
    default:     return '🟢🟢⚫⚫⚫';
  }
}

// Build the structured image payload from a ranking object
// (darkHorseRanking.buildRanking() output). Maps the top-N
// candidates into the renderer's standout schema. NEVER reads
// from production state — works purely off the supplied ranking
// + volatility.
function buildDarkHorseImagePayload(ranking, volatility, opts) {
  opts = opts || {};
  const top = Array.isArray(ranking && ranking.top10) ? ranking.top10 : [];
  // Keep the image card compact — the prototype shows up to 3-4
  // standouts at a time. Drop anything below DH_SCORE_WATCH (8).
  const standouts = top
    .filter(c => Number.isFinite(c && c.score) && c.score >= 7)
    .slice(0, 4)
    .map(c => ({
      symbol:        c.symbol,
      lifecycle:     _phaseToLifecycle(c.movePhase),
      direction:     c.direction || 'unspecified',
      score:         c.score,
      firstDetected: c.firstDetectedAt || null,
      durationAlive: c.durationAliveLabel || null,
      reason:        c.summary || (Array.isArray(c.reasons) ? c.reasons.join(' · ') : null),
      decisionLevel: c.decisionLevel || null,
      invalidation:  c.invalidation || null,
      dollarRisk:    c.dollarRiskLabel || null,
      rewardR:       c.rewardRLabel || null,
      sizeLabel:     c.sizeLabel || null,
    }));
  const sev = _volSeverity(volatility && volatility.level);
  const allCount = Number.isFinite(ranking && ranking.allCount) ? ranking.allCount : 0;
  const funnel = opts.funnel || (ranking && ranking.funnel) || {};
  const buildingCount = Number.isFinite(funnel.promotedInternal) ? funnel.promotedInternal : top.filter(c => (c.score || 0) < 8).length;

  return {
    scanTime:        opts.scanTimeLabel || new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    marketsScanned:  Number.isFinite(opts.universeSize) ? opts.universeSize : allCount,
    marketMood:      { discs: _discsForSeverity(sev), label: 'volatility ' + (volatility && volatility.level || 'unknown'), severity: sev },
    standouts:       standouts,
    riskReminder:    'Every zone above is what ATLAS sees right now. Live price moves, the zones move with it. Cross-check current price against the zone before acting.',
    terminology:     ['Decision Level','Entry Zone','Watch Level','Caution Zone','Invalidation','Confirmed Candle Close','Dollar Risk','Reward-to-Risk','Fresh Setup','Still Active Setup','Fading Setup'],
    sourceNote:      { source: 'TradingView', mode: 'LIVE', probabilityBasis: 'engine-derived' },
    briefingSummary: standouts.length
      ? (standouts.length + ' standout' + (standouts.length === 1 ? '' : 's') + ' on this scan. ' + standouts.map(s => s.symbol + ' (' + s.lifecycle + ')').join(' · ') + '.')
      : '0 full standouts. ' + buildingCount + ' building candidate' + (buildingCount === 1 ? '' : 's') + ' detected. Why no full standout: no candidate cleared WATCH threshold; top candidates require structure, volume, or cleaner entry-quality confirmation.',
  };
}

async function tryPostDarkHorseAsImage(webhookUrl, ranking, volatility, opts) {
  if (process.env.FOH_IMAGE_RENDER_ENABLED !== 'true') {
    return { ok: false, reason: 'env_flag_disabled' };
  }
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return { ok: false, reason: 'no_webhook_url' };
  }
  const foh = _fohLazy();
  if (!foh) {
    return { ok: false, reason: 'renderer_unavailable' };
  }
  // Prefer the rich FOH product-depth packet when the new
  // builder is available; fall back to the thin legacy payload
  // shape (PR #112) otherwise.
  let payload;
  const pmod = _packetLazy();
  if (pmod && typeof pmod.buildDarkHorseFohPacket === 'function') {
    try {
      const liveCtx = _readLiveContext(opts);
      payload = pmod.buildDarkHorseFohPacket(ranking, volatility, liveCtx, opts || {});
    } catch (e) {
      payload = null;
    }
  }
  if (!payload) {
    try { payload = buildDarkHorseImagePayload(ranking, volatility, opts || {}); }
    catch (e) { return { ok: false, reason: 'payload_build_failed', error: e.message }; }
  }
  // Operator directive 2026-05-17 PHASE 2 + master order: route DH
  // through the fixed-contract pipeline so the Discord message body
  // carries the expanded FOH intelligence — not just a thin caption.
  // sendDarkHorseFoh builds the FOH packet → view model → expanded
  // Discord text → renders PNG/PDF cards → POSTs all in one message.
  try {
    const { sendDarkHorseFoh } = require('./foh/dispatch/sendDarkHorseFoh');
    const sent = await sendDarkHorseFoh({
      ranking,
      volatility,
      legacyPayload: payload,
      webhookUrl,
      opts: opts || {},
    });
    return sent;
  } catch (e) {
    return { ok: false, reason: 'post_failed', error: e.message };
  }
}

module.exports = {
  buildDarkHorseImagePayload,
  tryPostDarkHorseAsImage,
};
