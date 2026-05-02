'use strict';
// §15 terminology surfaced as a deeper-layer footer; tags collected at build time and expanded here.

const TERMS = {
  BOS: 'Break of Structure — price closes beyond a prior swing high/low, marking a structural shift.',
  CHoCH: 'Change of Character — first counter-trend break that signals momentum has flipped.',
  liquidity_sweep: 'Liquidity Sweep — wick takes out a known cluster of stops then immediately reverses.',
  imbalance: 'Imbalance / FVG — a candle range with no overlap from neighbours; price often returns to fill it.',
  supply: 'Supply — origin candle of a strong down move; sellers expected on retest.',
  demand: 'Demand — origin candle of a strong up move; buyers expected on retest.',
  execution_authority: 'Execution Authority — the level of confidence required to take the trade now vs wait.',
  macro_driver: 'Macro Driver — the upstream variable (DXY / VIX / yields / event) currently moving the market.',
  event_risk: 'Event Risk — scheduled or unscheduled high-impact catalyst that can override structure.',
  validity_window: 'Validity Window — the time/price range over which the current plan remains in force.',
  flow: 'Flow — directional pressure (toward / away from a level) inferred from order-flow proxies.',
  regime: 'Regime — current market environment (risk-on / risk-off / range / trend).',
  stop_loss: 'Stop Loss — exit level that invalidates the trade idea; never moved against the position.',
  trigger: 'Trigger — the specific price action that arms entry permission.'
};

function lookup(tag) { return TERMS[tag] || null; }

function footer(tagsUsed) {
  const seen = [...new Set(tagsUsed || [])].filter(t => TERMS[t]);
  if (!seen.length) return '';
  const lines = ['---', '**Glossary** (deeper layer)'];
  for (const t of seen) lines.push(`- **${t.replace(/_/g, ' ')}**: ${TERMS[t]}`);
  return lines.join('\n');
}

module.exports = { TERMS, lookup, footer };
