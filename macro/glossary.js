'use strict';
// §15 terminology surfaced as a deeper-layer collapsible footer; tags
// collected at build time and expanded here.
//
// Locked wording standard renames (May 2026 hotfix):
//   - execution_authority  →  execution_confidence
//   - macro_driver         →  market_driver
// The `trigger` glossary entry is removed entirely — that word is
// banned on the user-facing surface and the macro builders now tag
// `confirmation` instead.

const TERMS = {
  BOS: '[Structure Break] — price closes beyond a prior swing high/low, marking a structural shift.',
  CHoCH: '[Initial-direction reversal] — first counter-trend break that signals momentum has flipped.',
  liquidity_sweep: 'Liquidity Sweep — wick takes out a known cluster of stops then immediately reverses.',
  imbalance: 'Imbalance / FVG — a candle range with no overlap from neighbours; price often returns to fill it.',
  supply: 'Supply — origin candle of a strong down move; sellers expected on retest.',
  demand: 'Demand — origin candle of a strong up move; buyers expected on retest.',
  execution_confidence: 'Execution Confidence — the level of confidence required to take the trade now vs wait.',
  market_driver: 'Market Driver — the upstream variable (DXY / VIX / yields / event) currently moving the market.',
  event_risk: 'Event Risk — scheduled or unscheduled high-impact catalyst that can override structure.',
  validity_window: 'Validity Window — the time/price range over which the current plan remains in force.',
  flow: 'Flow — directional pressure (toward / away from a level) inferred from order-flow proxies.',
  regime: 'Regime — current market environment (risk-on / risk-off / range / trend).',
  stop_loss: 'Stop Loss — exit level that invalidates the trade idea; never moved against the position.',
  confirmation: 'Confirmation — the specific price action that activates entry conditions (e.g. full candle body close beyond the level on the primary timeframe).'
};

function lookup(tag) { return TERMS[tag] || null; }

// Pack-4 terminology chip. Operator directive 2026-05-17: Notion is
// private backend material and must never surface user-side. Renders
// as a plain bracket label `[Label]` unless the caller supplies a
// sanctioned ATLAS-facing URL via opts.glossaryUrl. Notion URLs are
// rejected even when explicitly passed.
function termLink(label, opts) {
  const candidate = (opts && typeof opts.glossaryUrl === 'string') ? opts.glossaryUrl : '';
  const url = (candidate && /^https?:\/\//.test(candidate) && !/notion\.(so|com|site)/i.test(candidate))
    ? candidate
    : '';
  if (!url) return '[' + String(label) + ']';
  return '[[' + String(label) + ']](' + url + ')';
}

// Operator-facing glossary surface. The previous full-block footer
// claimed it was "collapsible" but Discord cannot collapse a message
// section, so the wording was misleading. Default behaviour: emit a
// single short reference line pointing the reader to the dashboard
// glossary tab / terminology command. Set ATLAS_DEBUG_AUX=1 to expand
// the full term list inline (operator/audit only).
function footer(tagsUsed) {
  const seen = [...new Set(tagsUsed || [])].filter(t => TERMS[t]);
  if (!seen.length) return '';
  if (process.env.ATLAS_DEBUG_AUX === '1') {
    const lines = ['---', '**Glossary** (audit expansion)'];
    for (const t of seen) lines.push(`- **${t.replace(/_/g, ' ')}**: ${TERMS[t]}`);
    return lines.join('\n');
  }
  return [
    '---',
    'Glossary available via the dashboard glossary tab or the terminology command.'
  ].join('\n');
}

module.exports = { TERMS, lookup, footer, termLink };
