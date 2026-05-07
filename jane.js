'use strict';

/**
 * Jane — final compression, scoring, conflict resolution, decision layer.
 *
 * THE ONLY DECISION VOICE IN ATLAS.
 *
 * Doctrine (locked 7 May 2026):
 *   - Spidey owns structure authority.
 *   - Corey owns current macro/regime/event authority.
 *   - Corey Clone owns historical/base-rate authority.
 *   - Macro Engine normalises broader macro context.
 *   - Jane normalises by lane (NOT volume) and produces the only decision packet.
 *
 * Phase B (this file): minimal but doctrine-aware decision logic. Lanes are
 * gated, not averaged. Spidey UNAVAILABLE → INVALID. Corey Clone not ACTIVE
 * → cap at MARGINAL. Phase D replaces with full Astra authority-lane scoring.
 */

const { validatePacket } = require('./contracts');

const ASSET_CLASS_BY_PREFIX = [
  { test: /^[A-Z]{6}$/, cls: 'fx' },                  // EURUSD etc
  { test: /^(SPX|NDX|DJI|UKX|DAX|N225)$/, cls: 'index' },
  { test: /^(BTC|ETH|XRP|SOL|DOGE)/, cls: 'crypto' },
  { test: /(GOLD|XAU|XAG|OIL|BRENT|WTI|COPPER)/, cls: 'commodity' },
];
function deriveAssetClass(symbol) {
  for (const r of ASSET_CLASS_BY_PREFIX) if (r.test.test(symbol)) return r.cls;
  return 'equity';   // default for tickers like AMD, NVDA
}

function detectConflict(input) {
  const parts = [];
  if (input.spidey && input.corey && Math.abs((input.spidey.score || 0) - (input.corey.score || 0)) > 0.4) {
    parts.push('spidey/corey score divergence');
  }
  if (input.coreyClone && input.coreyClone.warningFlags && input.coreyClone.warningFlags.length) {
    parts.push(`historical warnings: ${input.coreyClone.warningFlags.length}`);
  }
  if (input.corey && input.corey.riskModifiers && input.corey.riskModifiers.length) {
    parts.push(`event risk modifiers: ${input.corey.riskModifiers.length}`);
  }
  return parts.length ? parts.join('; ') : 'no significant conflict';
}

async function runJane(input, opts = {}) {
  const timestamp = new Date().toISOString();
  const testMode = opts.testMode || process.env.ATLAS_TEST_MODE === '1';

  // Authority gating — doctrine first
  const ss = input.sourceStatus || {};
  const spideyActive = ss.spidey === 'ACTIVE';
  const coreyActive = ss.corey === 'ACTIVE';
  const cloneActive = ss.coreyClone === 'ACTIVE';
  const macroActive = ss.macro === 'ACTIVE';

  // Score / confidence aggregation (Phase B: per-lane mean of populated lanes)
  const scoreInputs = [], confInputs = [];
  if (spideyActive && input.spidey && typeof input.spidey.score === 'number') { scoreInputs.push(input.spidey.score); confInputs.push(input.spidey.confidence != null ? input.spidey.confidence : 0); }
  if (coreyActive && input.corey && typeof input.corey.score === 'number') { scoreInputs.push(input.corey.score); confInputs.push(input.corey.confidence != null ? input.corey.confidence : 0); }
  if (cloneActive && input.coreyClone && typeof input.coreyClone.score === 'number') { scoreInputs.push(input.coreyClone.score); confInputs.push(input.coreyClone.confidence != null ? input.coreyClone.confidence : 0); }
  if (macroActive && input.macro && typeof input.macro.score === 'number') { scoreInputs.push(input.macro.score); confInputs.push(input.macro.confidence != null ? input.macro.confidence : 0); }

  const setupQuality = scoreInputs.length ? scoreInputs.reduce((a, b) => a + b, 0) / scoreInputs.length : 0;
  const marketConfidence = confInputs.length ? confInputs.reduce((a, b) => a + b, 0) / confInputs.length : 0;

  // Viability gating (Phase B)
  let tradeViability;
  if (!spideyActive) {
    tradeViability = 'INVALID';   // Spidey is structure authority — without it, no trade
  } else if (marketConfidence >= 0.65 && setupQuality >= 0.55 && spideyActive && coreyActive) {
    tradeViability = 'VALID';
  } else if (marketConfidence >= 0.4) {
    tradeViability = 'MARGINAL';
  } else {
    tradeViability = 'INVALID';
  }

  // Doctrine downgrade: Corey Clone not ACTIVE → cap at MARGINAL
  if (!cloneActive && tradeViability === 'VALID') {
    tradeViability = 'MARGINAL';
  }

  // Final bias from Spidey (structure authority owns directional truth)
  let finalBias = 'neutral';
  if (spideyActive && input.spidey && typeof input.spidey.score === 'number') {
    finalBias = input.spidey.score > 0.55 ? 'long' : input.spidey.score < 0.45 ? 'short' : 'neutral';
  }

  const actionState = tradeViability === 'VALID' ? 'arm' : tradeViability === 'MARGINAL' ? 'wait' : 'stand_down';

  const packet = {
    symbol: input.symbol,
    assetClass: deriveAssetClass(input.symbol),
    timestamp,
    finalBias,
    actionState,
    tradeViability,
    marketConfidence,
    setupQuality,
    reasonSummary: `Phase B foundation decision. Spidey=${ss.spidey}, Corey=${ss.corey}, Clone=${ss.coreyClone}, Macro=${ss.macro}. ${tradeViability}.`,
    structureSummary: input.spidey && input.spidey.evidence ? input.spidey.evidence : null,
    macroSummary: input.macro && input.macro.evidence ? input.macro.evidence : null,
    coreyCloneSummary: input.coreyClone && (input.coreyClone.analogues || input.coreyClone.status) ? (input.coreyClone.analogues || input.coreyClone.status) : null,
    eventCatalystRisk: input.corey && input.corey.riskModifiers ? input.corey.riskModifiers : [],
    conflictSummary: detectConflict(input),
    invalidation: input.spidey && input.spidey.invalidation ? input.spidey.invalidation : null,
    sourceStatus: Object.assign({}, ss),
    chartRefs: input.rendererArtefacts && input.rendererArtefacts.chartRefs ? input.rendererArtefacts.chartRefs : [],
    dashboardURL: null,
    astraSessionContextId: null,
    _phase: 'B-foundation',
  };

  // Self-validate before emitting — Jane never emits a malformed packet
  const v = validatePacket(packet, 'JaneDecisionPacket');
  if (!v.valid) {
    throw new Error(`Jane produced invalid JaneDecisionPacket: ${v.errors.join('; ')}`);
  }

  return packet;
}

module.exports = { runJane };
