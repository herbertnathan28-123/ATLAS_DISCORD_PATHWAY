'use strict';

// ============================================================
// spidey_structure/confidence.js
//
// Combines the individual structure signals into a single
// structureConfidence score in [0, 1]. Weighted contribution:
//
//   BOS direction agreement (HTF ↔ LTF):   0.25
//   CHoCH alignment with active bias:       0.15
//   Liquidity sweep before BOS:             0.15
//   Displacement on the BOS candle:         0.15
//   FVG present in the direction of break:  0.10
//   Supply/Demand zone freshness:           0.10
//   Session liquidity quality:              0.10
//
// Returns { score, breakdown, label }.
// ============================================================

function computeConfidence(parts) {
  parts = parts || {};
  const breakdown = {};
  let total = 0;

  // BOS direction agreement: HTF bias matches the latest BOS.
  const htfBias = parts.htfBias || 'NEUTRAL';
  const ltfBias = parts.ltfBias || 'NEUTRAL';
  const bosBias = parts.bosBias || 'NEUTRAL';
  if (htfBias !== 'NEUTRAL' && ltfBias === htfBias) { breakdown.bos_alignment = 0.25; total += 0.25; }
  else if (htfBias !== 'NEUTRAL' && bosBias === htfBias) { breakdown.bos_alignment = 0.18; total += 0.18; }
  else if (htfBias === ltfBias)                     { breakdown.bos_alignment = 0.10; total += 0.10; }
  else                                              { breakdown.bos_alignment = 0; }

  // CHoCH alignment.
  if (parts.choch && (parts.choch.type === 'BULLISH_CHoCH' || parts.choch.type === 'BEARISH_CHoCH')) {
    const chochBias = parts.choch.type === 'BULLISH_CHoCH' ? 'BULLISH' : 'BEARISH';
    if (chochBias === htfBias || chochBias === ltfBias) { breakdown.choch_alignment = 0.15; total += 0.15; }
    else { breakdown.choch_alignment = 0.05; total += 0.05; }
  } else { breakdown.choch_alignment = 0; }

  // Liquidity sweep before BOS.
  if (Array.isArray(parts.sweeps) && parts.sweeps.length) {
    breakdown.liquidity_sweep = 0.15;
    total += 0.15;
  } else { breakdown.liquidity_sweep = 0; }

  // Displacement on or near the BOS candle.
  if (Array.isArray(parts.displacement) && parts.displacement.length) {
    const strong = parts.displacement.some(d => d.velocity === 'STRONG' || d.velocity === 'EXPLOSIVE');
    breakdown.displacement = strong ? 0.15 : 0.08;
    total += breakdown.displacement;
  } else { breakdown.displacement = 0; }

  // Fresh FVG in the direction of bias.
  if (Array.isArray(parts.fvgs) && parts.fvgs.some(f => f.mitigation === 'UNTOUCHED')) {
    breakdown.fvg_present = 0.10;
    total += 0.10;
  } else { breakdown.fvg_present = 0; }

  // Supply/Demand zone freshness.
  if (Array.isArray(parts.zones) && parts.zones.some(z => z.freshness === 'UNTOUCHED' || z.freshness === 'PARTIALLY_TESTED')) {
    breakdown.zone_freshness = 0.10;
    total += 0.10;
  } else { breakdown.zone_freshness = 0; }

  // Session liquidity quality.
  const session = parts.session && parts.session.session;
  if (session === 'LONDON' || session === 'NY_OPEN') { breakdown.session_liquidity = 0.10; total += 0.10; }
  else if (session === 'NY' || session === 'LATE_NY') { breakdown.session_liquidity = 0.06; total += 0.06; }
  else { breakdown.session_liquidity = 0.03; total += 0.03; }

  const score = Math.max(0, Math.min(1, +total.toFixed(3)));
  const label = score >= 0.70 ? 'HIGH'
              : score >= 0.50 ? 'MEDIUM'
              : score >= 0.30 ? 'LOW'
              : 'INSUFFICIENT';

  return { score, breakdown, label };
}

module.exports = { computeConfidence };
