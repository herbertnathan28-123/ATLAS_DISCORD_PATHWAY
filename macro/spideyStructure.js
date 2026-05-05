'use strict';
// macro/spideyStructure.js — structured rendering of the Spidey output.
//
// Pulls per-timeframe structure detail (swing high/low + time, BOS levels,
// body-close requirement, pullback/retest, invalidation reference) out of
// runSpideyHTF / runSpideyLTF results. Emits a structured "STRUCTURE READ
// PARTIAL — missing <tf>" block when expected timeframes returned no data,
// instead of bare "HIGH: n/a" lines.
//
// Public API:
//   buildSpideyStructure({ symbol, htf, ltf, coverage }) -> {
//     state: 'OK'|'PARTIAL'|'UNAVAILABLE',
//     reason: string|null,
//     bullishBOS, bearishBOS,                 // levels with timeframe
//     prevSwingHigh, prevSwingLow,            // {price, time, tf}
//     bodyCloseRequirement, wickNotEnough,    // teaching strings
//     pullbackLevel, invalidationReference,
//     missingTimeframes: [],
//     renderForDiscord(): string              // structured block
//   }

function fmtNum(n, dp = 2) { return Number.isFinite(n) ? Number(n).toFixed(dp) : '—'; }
function fmtTime(unixSec) {
  if (!Number.isFinite(unixSec)) return '—';
  const d = new Date(unixSec * 1000);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function pickFromTfs(tfs, order) {
  for (const k of order) if (tfs && tfs[k]) return { tf: k, ref: tfs[k] };
  return null;
}

function buildSpideyStructure({ symbol, htf = {}, ltf = {}, coverage = null }) {
  // Spidey state — prefer coverage-derived if available.
  let state = 'OK', reason = null, missingTimeframes = [];
  if (coverage && coverage.spideyState) {
    const sp = coverage.spideyState();
    state = sp.state; reason = sp.reason;
    missingTimeframes = [...(sp.htfMissing || []), ...(sp.ltfMissing || [])];
  }

  const htfTfs = htf?.timeframes || {};
  const ltfTfs = ltf?.timeframes || {};
  // Prefer 1H / 1D for swing high/low + BOS reference; fall through to other TFs.
  const refHtf = pickFromTfs(htfTfs, ['60', '1H', '240', '4H', '1D']) ||
                 pickFromTfs(ltfTfs, ['30', '15']);
  const refLtf = pickFromTfs(ltfTfs, ['15', '5', '30', '1']);

  const bullishBOS = (function(){
    if (!refHtf) return null;
    const r = refHtf.ref;
    if (r.lastBreak === 'BOS' && r.breakDirection === 'Bullish' && Number.isFinite(r.breakLevel)) return { price: r.breakLevel, tf: refHtf.tf };
    // Fall back to last swing high.
    const sh = r.swingHighs?.slice(-1)[0];
    return sh ? { price: sh.level, tf: refHtf.tf, derived: 'last swing high' } : null;
  })();
  const bearishBOS = (function(){
    if (!refHtf) return null;
    const r = refHtf.ref;
    if (r.lastBreak === 'BOS' && r.breakDirection === 'Bearish' && Number.isFinite(r.breakLevel)) return { price: r.breakLevel, tf: refHtf.tf };
    const sl = r.swingLows?.slice(-1)[0];
    return sl ? { price: sl.level, tf: refHtf.tf, derived: 'last swing low' } : null;
  })();

  const prevSwingHigh = (function(){
    if (!refHtf) return null;
    const sh = refHtf.ref.swingHighs?.slice(-1)[0];
    return sh ? { price: sh.level, time: sh.time, tf: refHtf.tf } : null;
  })();
  const prevSwingLow = (function(){
    if (!refHtf) return null;
    const sl = refHtf.ref.swingLows?.slice(-1)[0];
    return sl ? { price: sl.level, time: sl.time, tf: refHtf.tf } : null;
  })();

  const bodyCloseRequirement = `Trigger requires a body close beyond the level on ${refHtf?.tf || '15M/1H'} — wicks alone are not enough.`;
  const wickNotEnough = `A wick that pierces the level then closes back inside the prior range is a liquidity sweep, not a break. Wait for a body close beyond the level with the impulse imbalance retained.`;

  // Pullback / retest reference — last opposing swing on the LTF side.
  const pullbackLevel = (function(){
    if (!refLtf) return null;
    const r = refLtf.ref;
    if (r.activeDemand) return { price: (r.activeDemand.high + r.activeDemand.low) / 2, type: 'demand zone', tf: refLtf.tf };
    if (r.activeSupply) return { price: (r.activeSupply.high + r.activeSupply.low) / 2, type: 'supply zone', tf: refLtf.tf };
    const sh = r.swingHighs?.slice(-1)[0];
    const sl = r.swingLows?.slice(-1)[0];
    if (htf?.dominantBias === 'Bullish' && sl) return { price: sl.level, type: 'last LTF swing low', tf: refLtf.tf };
    if (htf?.dominantBias === 'Bearish' && sh) return { price: sh.level, type: 'last LTF swing high', tf: refLtf.tf };
    return null;
  })();

  const invalidationReference = (function(){
    if (htf?.dominantBias === 'Bullish' && prevSwingLow) return { price: prevSwingLow.price, tf: prevSwingLow.tf, rule: '15M body close back below prior swing low → bullish read invalidated' };
    if (htf?.dominantBias === 'Bearish' && prevSwingHigh) return { price: prevSwingHigh.price, tf: prevSwingHigh.tf, rule: '15M body close back above prior swing high → bearish read invalidated' };
    if (prevSwingLow && prevSwingHigh)                    return { price: (prevSwingHigh.price + prevSwingLow.price) / 2, tf: prevSwingHigh.tf, rule: 'Range mid-point — directional read invalidates on a clean body close beyond either swing reference' };
    return null;
  })();

  // If coverage didn't detect partial, look at the spidey content. If
  // every timeframe says 'No data' the structure is UNAVAILABLE even if
  // OHLC technically responded with empty arrays.
  if (state === 'OK') {
    const allHtfNo = Object.values(htfTfs).every(r => r.structure === 'No data');
    const allLtfNo = Object.values(ltfTfs).every(r => r.structure === 'No data');
    if (allHtfNo && allLtfNo) { state = 'UNAVAILABLE'; reason = 'all_timeframes_returned_no_data'; }
    else if (allHtfNo)         { state = 'PARTIAL';     reason = 'all_htf_returned_no_data'; }
    else if (allLtfNo)         { state = 'PARTIAL';     reason = 'all_ltf_returned_no_data'; }
  }

  function renderForDiscord() {
    const lines = [];
    lines.push(`🕷 **SPIDEY STRUCTURE — ${symbol}**  (state: ${state}${reason ? ' · ' + reason : ''})`);
    if (state === 'UNAVAILABLE') {
      lines.push('');
      lines.push(`STRUCTURE READ UNAVAILABLE — ${reason || 'no structural timeframes loaded'}.`);
      if (missingTimeframes.length) lines.push(`Missing timeframes: ${missingTimeframes.join(', ')}`);
      lines.push('No swing levels, no BOS reference, no pullback or invalidation level can be issued safely until structure is restored.');
      return lines.join('\n');
    }
    if (state === 'PARTIAL') {
      lines.push('');
      lines.push(`STRUCTURE READ PARTIAL — missing ${missingTimeframes.length ? missingTimeframes.join(', ') : reason || 'some timeframes'}.`);
      lines.push('Levels below are derived from the timeframes that DID load — treat as a partial read, not full structure.');
    }
    lines.push('');
    if (prevSwingHigh) lines.push(`• Previous swing HIGH (${prevSwingHigh.tf}): ${fmtNum(prevSwingHigh.price, 2)} · ${fmtTime(prevSwingHigh.time)}`);
    if (prevSwingLow)  lines.push(`• Previous swing LOW (${prevSwingLow.tf}):  ${fmtNum(prevSwingLow.price, 2)} · ${fmtTime(prevSwingLow.time)}`);
    if (bullishBOS)    lines.push(`• Bullish BOS reference (${bullishBOS.tf}): ${fmtNum(bullishBOS.price, 2)}${bullishBOS.derived ? ' _(derived from ' + bullishBOS.derived + ')_' : ''}`);
    if (bearishBOS)    lines.push(`• Bearish BOS reference (${bearishBOS.tf}): ${fmtNum(bearishBOS.price, 2)}${bearishBOS.derived ? ' _(derived from ' + bearishBOS.derived + ')_' : ''}`);
    lines.push('');
    lines.push(`• Body-close rule: ${bodyCloseRequirement}`);
    lines.push(`• Wick-not-enough: ${wickNotEnough}`);
    if (pullbackLevel)         lines.push(`• Pullback / retest reference (${pullbackLevel.tf}, ${pullbackLevel.type}): ${fmtNum(pullbackLevel.price, 2)}`);
    if (invalidationReference) lines.push(`• Invalidation reference (${invalidationReference.tf}): ${fmtNum(invalidationReference.price, 2)} — ${invalidationReference.rule}`);
    return lines.join('\n');
  }

  return {
    state, reason, missingTimeframes,
    bullishBOS, bearishBOS,
    prevSwingHigh, prevSwingLow,
    bodyCloseRequirement, wickNotEnough,
    pullbackLevel, invalidationReference,
    renderForDiscord
  };
}

module.exports = { buildSpideyStructure };
