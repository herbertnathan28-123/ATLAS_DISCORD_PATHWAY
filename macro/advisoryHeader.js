'use strict';
// macro/advisoryHeader.js — leading advisory section, ordered:
//
//   1. Current Price
//   2. Time / next candle-close windows
//   3. Bias direction
//   4. Bias momentum
//   5. Trade Probability 1–5
//   6. Market Confidence (Low/Medium/High)
//   7. Key reference levels (recent swing high/low + BOS levels)
//   8. Market Read (one-paragraph plain-English read)
//   9. Forward Watch (next levels to watch with price·time·bias·confidence)
//  10. What improves probability
//  11. What weakens / cancels the watch
//  12. Next reassessment
//
// Long macro report sections render AFTER this header — the header is the
// actionable advisory layer the user reads first.
//
// Public API:
//   buildAdvisoryHeader({ symbol, jane, corey, htf, ltf, candlesByTf, incoregoBlock, dataCoverage }) -> string

const { advisoryActionState, advisoryTradeStatus, marketConfidenceLabel, tradeProbability1to5, remapAdvisoryWording } = require('./advisoryWording');

function fmtNum(n, dp = 2) { return Number.isFinite(n) ? Number(n).toFixed(dp) : '—'; }

function biasMomentumFor(jane, htf, ltf) {
  // Heuristic ladder — explicit field beats derived.
  if (jane && jane.biasMomentum) return remapAdvisoryWording(String(jane.biasMomentum));
  const htfBias = htf?.dominantBias || 'Neutral';
  const ltfBias = ltf?.dominantBias || 'Neutral';
  if (htfBias === 'Neutral' && ltfBias === 'Neutral') return 'Flat';
  if (htfBias === ltfBias) {
    const c = Number(htf?.dominantConviction) || 0;
    if (c >= 0.65) return 'Building';
    if (c >= 0.40) return 'Steady';
    return 'Forming';
  }
  if (htfBias !== 'Neutral' && ltfBias !== 'Neutral' && htfBias !== ltfBias) return 'Reversing';
  return 'Forming';
}

function nextCandleCloseUTC(timeframeMinutes) {
  const now = Date.now();
  const stepMs = timeframeMinutes * 60 * 1000;
  const next = Math.ceil(now / stepMs) * stepMs;
  return next;
}
function fmtUtc(ms) {
  const d = new Date(ms);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
function inMinutes(ms) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (m >= 60) return `${Math.floor(m/60)}h ${m%60}m`;
  return `${m}m`;
}

function pickKeyLevels(htf, ltf) {
  const out = [];
  const h = htf?.timeframes && (htf.timeframes['1H'] || htf.timeframes['60'] || null);
  const d = htf?.timeframes && (htf.timeframes['1D'] || htf.timeframes['1d']  || null);
  const ref = h || d || null;
  if (ref) {
    const swingHi = ref.swingHighs?.slice(-1)[0];
    const swingLo = ref.swingLows?.slice(-1)[0];
    if (swingHi) out.push({ name: 'Recent swing HIGH', price: swingHi.level, source: '1H/1D' });
    if (swingLo) out.push({ name: 'Recent swing LOW',  price: swingLo.level, source: '1H/1D' });
    if (ref.breakLevel != null && ref.lastBreak !== 'None') {
      out.push({ name: ref.lastBreak === 'BOS' ? 'Last BOS level' : 'Last CHoCH level', price: ref.breakLevel, source: '1H/1D · ' + (ref.breakDirection || '') });
    }
  }
  const ltfRef = ltf?.timeframes && (ltf.timeframes['15'] || ltf.timeframes['5'] || null);
  if (ltfRef) {
    const sH = ltfRef.swingHighs?.slice(-1)[0];
    const sL = ltfRef.swingLows?.slice(-1)[0];
    if (sH) out.push({ name: 'LTF swing HIGH', price: sH.level, source: '15M/5M' });
    if (sL) out.push({ name: 'LTF swing LOW',  price: sL.level, source: '15M/5M' });
  }
  return out;
}

function buildMarketRead({ jane, corey, htf, ltf, incoregoBlock }) {
  if (jane && jane.marketRead && typeof jane.marketRead === 'string') {
    return remapAdvisoryWording(jane.marketRead);
  }
  const bias = jane?.finalBias || 'Neutral';
  const htfBias = htf?.dominantBias || 'Neutral';
  const ltfBias = ltf?.dominantBias || 'Neutral';
  const regime = corey?.internalMacro?.regime?.regime || 'Neutral';
  const risk = corey?.internalMacro?.global?.riskEnv || 'Neutral';
  const macroSupport = incoregoBlock ? incoregoBlock.coreyEffectOnJaneProbability : 'neutral';
  return remapAdvisoryWording(
    `Higher timeframe is ${htfBias.toLowerCase()}, lower timeframe is ${ltfBias.toLowerCase()} ` +
    `(${htfBias === ltfBias ? 'aligned' : 'split'}). Macro layer ${macroSupport === 'supports' ? 'supports' : macroSupport === 'weakens' ? 'weakens' : 'is neutral on'} the read. ` +
    `Regime ${regime.toLowerCase()}, risk tone ${risk.toLowerCase()}. ` +
    `Net advisory bias: ${bias.toLowerCase()}.`
  );
}

function buildForwardWatch({ symbol, jane, htf, ltf, tradeProbability }) {
  // Prefer explicit packet-supplied watch list.
  if (jane && Array.isArray(jane.forwardWatch?.items) && jane.forwardWatch.items.length) {
    return jane.forwardWatch.items.slice(0, 4);
  }
  // Synthesise from triggers/swings.
  const items = [];
  const triggers = jane?.triggers || jane?.triggerMap || null;
  if (triggers?.bullish) {
    items.push({
      price: triggers.bullish.level || triggers.bullish.price || '—',
      time: triggers.bullish.tf ? `${triggers.bullish.tf} close` : 'next 15M/30M close',
      bias: 'Bullish continuation',
      confidence: tradeProbability != null ? `${tradeProbability}/5` : 'pending',
      structure: triggers.bullish.close || triggers.bullish.requirement || 'body close above level with imbalance retained'
    });
  }
  if (triggers?.bearish) {
    items.push({
      price: triggers.bearish.level || triggers.bearish.price || '—',
      time: triggers.bearish.tf ? `${triggers.bearish.tf} close` : 'next 15M/30M close',
      bias: 'Bearish continuation',
      confidence: tradeProbability != null ? `${tradeProbability}/5` : 'pending',
      structure: triggers.bearish.close || triggers.bearish.requirement || 'body close below level with imbalance retained'
    });
  }
  if (!items.length) {
    // Fallback to swing levels from spidey output.
    const ref = htf?.timeframes && (htf.timeframes['1H'] || htf.timeframes['60'] || null);
    if (ref) {
      if (ref.swingHighs?.slice(-1)[0]) items.push({ price: fmtNum(ref.swingHighs.slice(-1)[0].level, 2), time: 'next 1H/15M close', bias: 'Watch for break above', confidence: 'pending', structure: 'body close above the recent 1H swing high' });
      if (ref.swingLows?.slice(-1)[0])  items.push({ price: fmtNum(ref.swingLows.slice(-1)[0].level, 2),  time: 'next 1H/15M close', bias: 'Watch for break below', confidence: 'pending', structure: 'body close below the recent 1H swing low' });
    }
  }
  return items;
}

function buildImproveWeaken({ jane, corey, htf, ltf, incoregoBlock, tradeProbability }) {
  const improves = [];
  const weakens  = [];
  const htfBias = htf?.dominantBias || 'Neutral';
  const ltfBias = ltf?.dominantBias || 'Neutral';
  if (htfBias !== ltfBias && htfBias !== 'Neutral' && ltfBias !== 'Neutral') {
    improves.push('LTF realigns with HTF on a 15M body close');
  } else if (htfBias === ltfBias && htfBias !== 'Neutral') {
    improves.push(`${htfBias.toLowerCase()} BOS on 15M / 30M with imbalance retained on the impulse`);
  }
  if (incoregoBlock?.coreyEffectOnJaneProbability === 'weakens') improves.push('Macro pressure clears (DXY / VIX / yields no longer contradicting)');
  if (incoregoBlock?.activeCatalystWindow && /no high-impact|no active/i.test(incoregoBlock.activeCatalystWindow)) {
    // No catalyst is a positive — leave as a negative absence.
  } else if (incoregoBlock?.activeCatalystWindow) {
    improves.push('Catalyst window clears without violating the structural levels');
  }
  if (tradeProbability != null && tradeProbability < 4) improves.push('Trade Probability lifts from a clean 15M/30M body close inside the watch level + retained zone');

  // Weakens / cancels
  if (htfBias === 'Neutral' || ltfBias === 'Neutral') weakens.push('Structure drifts inside the range without imbalance retained');
  if (incoregoBlock?.coreyEffectOnJaneProbability === 'supports') weakens.push('Macro flips against the bias (DXY / VIX / yields rotate the other way)');
  weakens.push('15M body close back through the trigger level inside two candles → invalidates the watch');
  if (jane?.cancellation && typeof jane.cancellation === 'string') weakens.unshift(remapAdvisoryWording(jane.cancellation));
  return { improves, weakens };
}

function nextReassessment({ jane }) {
  const reassessMin = Number.isFinite(jane?.reassessMinutes) ? jane.reassessMinutes : 60;
  const reassessAt = nextCandleCloseUTC(reassessMin);
  return { at: fmtUtc(reassessAt), in: inMinutes(reassessAt), minutes: reassessMin };
}

function buildAdvisoryHeader({ symbol, jane, corey, htf, ltf, candlesByTf, incoregoBlock, dataCoverage }) {
  const price = (function pickPrice(){
    if (jane && Number.isFinite(jane.lastPrice)) return Number(jane.lastPrice);
    const tfs = candlesByTf || {};
    for (const k of ['1','5','15','30','60','240','1D','1W']) {
      const arr = tfs[k];
      if (Array.isArray(arr) && arr.length) return arr[arr.length - 1].close;
    }
    if (htf?.currentPrice) return htf.currentPrice;
    if (ltf?.currentPrice) return ltf.currentPrice;
    return null;
  })();

  const probability = tradeProbability1to5(jane || {});
  const confidence = marketConfidenceLabel(jane?.marketConfidence ?? jane?.conviction ?? corey?.confidence ?? 0);
  const action = advisoryActionState(jane?.actionState || jane?.combinedBias || 'HOLD — BIAS STILL FORMING');
  const tradeStatus = advisoryTradeStatus(jane?.tradeStatus || jane?.tradePermission || jane?.permitLabel || '');
  const biasDir = jane?.biasDirection || jane?.finalBias || htf?.dominantBias || 'Neutral';
  const biasMom = biasMomentumFor(jane || {}, htf || {}, ltf || {});

  const next15 = nextCandleCloseUTC(15);
  const next60 = nextCandleCloseUTC(60);
  const reassess = nextReassessment({ jane: jane || {} });
  const keyLevels = pickKeyLevels(htf || {}, ltf || {});
  const marketRead = buildMarketRead({ jane: jane || {}, corey: corey || {}, htf: htf || {}, ltf: ltf || {}, incoregoBlock });
  const watch = buildForwardWatch({ symbol, jane: jane || {}, htf: htf || {}, ltf: ltf || {}, tradeProbability: probability });
  const { improves, weakens } = buildImproveWeaken({ jane: jane || {}, corey: corey || {}, htf: htf || {}, ltf: ltf || {}, incoregoBlock, tradeProbability: probability });

  const lines = [];
  lines.push(`📍 **ATLAS ADVISORY — ${symbol}**`);
  lines.push(`Action State: **${action}**`);
  lines.push('');
  // 1. Current Price
  lines.push(`**1. Current Price** · ${price != null ? fmtNum(price, /^[A-Z]{6}$/.test(symbol) ? 5 : 2) : 'pending'}`);
  // 2. Time / next candle-close windows
  lines.push(`**2. Time** · UTC ${fmtUtc(Date.now())} · next 15M close ${fmtUtc(next15)} (in ${inMinutes(next15)}) · next 1H close ${fmtUtc(next60)} (in ${inMinutes(next60)})`);
  // 3 + 4. Bias + Momentum
  lines.push(`**3. Bias Direction** · ${biasDir}`);
  lines.push(`**4. Bias Momentum** · ${biasMom}`);
  // 5. Trade Probability
  lines.push(`**5. Trade Probability** · ${probability} / 5`);
  // 6. Market Confidence
  lines.push(`**6. Market Confidence** · ${confidence}`);
  // 7. Key reference levels
  lines.push(`**7. Key Reference Levels**`);
  if (keyLevels.length) {
    for (const k of keyLevels) lines.push(`• ${k.name}: ${fmtNum(k.price, 2)}${k.source ? '  _(' + k.source + ')_' : ''}`);
  } else {
    lines.push('• Pending — structure read incomplete');
  }
  // 8. Market Read
  lines.push(`**8. Market Read**`);
  lines.push(marketRead);
  // 9. Forward Watch
  lines.push(`**9. Forward Watch — Price · Time · Bias · Confidence**`);
  if (watch.length) {
    for (const w of watch) {
      lines.push(`• ${w.price} · ${w.time} · ${w.bias} · ${w.confidence}${w.structure ? ' — ' + remapAdvisoryWording(w.structure) : ''}`);
    }
  } else {
    lines.push('• Pending — Jane has not posted a watch list yet.');
  }
  // 10. Improves
  lines.push(`**10. What Improves Probability**`);
  if (improves.length) for (const i of improves) lines.push(`• ${remapAdvisoryWording(i)}`);
  else lines.push('• Pending');
  // 11. Cancels
  lines.push(`**11. What Weakens / Cancels the Watch**`);
  if (weakens.length) for (const w of weakens) lines.push(`• ${remapAdvisoryWording(w)}`);
  else lines.push('• Pending');
  // 12. Next reassessment
  lines.push(`**12. Next Reassessment** · ${reassess.at} (in ${reassess.in}) · cadence ${reassess.minutes}m`);
  lines.push('');
  lines.push(`Trade Status: ${tradeStatus}`);
  if (dataCoverage) {
    const sum = (typeof dataCoverage.summarise === 'function') ? dataCoverage.summarise() : null;
    if (sum) lines.push(`Data coverage: OHLC ${sum.state} (${sum.okCount}/${sum.total} resolutions)`);
  }
  return lines.join('\n');
}

module.exports = { buildAdvisoryHeader };
