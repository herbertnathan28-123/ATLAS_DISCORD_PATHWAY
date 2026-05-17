'use strict';

/**
 * ATLAS orchestrator — runAnalysis(symbol).
 *
 * Single entry point for the doctrine pipeline. Runs evidence engines and
 * the renderer in parallel, assembles the JaneInputPacket with sourceStatus,
 * calls Jane, returns JaneDecisionPacket.
 *
 * No surface other than this orchestrator (and Jane itself) should be
 * importing evidence engines.
 */

const { spideyRun } = require('./spidey');
const { coreyRun } = require('./corey');
const { findHistoricalAnalogues } = require('./coreyClone/findHistoricalAnalogues');
const { macroRun } = require('./macro');
const { runJane } = require('./jane');
const { validatePacket, statusFromValidation } = require('./contracts');
console.log('[BOOT] COREY_CLONE_CHAIN: orchestrator loaded Corey Clone analogue adapter');

let renderer = null;
try { renderer = require('./renderer'); } catch (e) { /* renderer load failure handled below */ }

function safeCall(fn, label) {
  return Promise.resolve()
    .then(fn)
    .catch(err => {
      console.error(`[orchestrator] ${label} failed: ${err.message}`);
      return null;
    });
}

async function runAnalysis(symbol, options = {}) {
  if (!symbol || typeof symbol !== 'string') throw new Error('runAnalysis requires a symbol string');
  const opts = Object.assign({ testMode: process.env.ATLAS_TEST_MODE === '1' }, options);
  const timestamp = new Date().toISOString();

  // Corey must interpret macro first; Corey Clone consumes that interpreted
  // packet before Jane is allowed to synthesise the decision.
  const coreyOut = await safeCall(() => coreyRun(symbol, opts), 'corey');
  const macroIntelligencePacket = {
    symbol,
    generatedAtUTC: timestamp,
    interpretedBy: 'Corey',
    combinedBias: coreyOut && (coreyOut.combinedBias || coreyOut.bias || coreyOut.macroBias) || 'Neutral',
    confidence: coreyOut && coreyOut.confidence,
    evidence: coreyOut && coreyOut.evidence,
    riskModifiers: coreyOut && coreyOut.riskModifiers,
    sourceBasis: ['CoreyOutput', 'live macro context', 'calendar data'],
    confidenceBasis: 'Corey interpreted macro packet',
  };
  console.log(`[COREY-CLONE-CHAIN] macroIntelligencePacket built symbol=${symbol} bias=${macroIntelligencePacket.combinedBias} confidence=${macroIntelligencePacket.confidence}`);
  console.log(`[COREY-CLONE-CHAIN] Corey Clone called symbol=${symbol} input=macroIntelligencePacket`);
  const cloneOut = await safeCall(() => findHistoricalAnalogues(macroIntelligencePacket, opts), 'coreyClone');
  console.log(`[COREY-CLONE-CHAIN] Corey Clone status=${cloneOut?.status || 'BLOCKED'} usableForDecision=${cloneOut?.usableForDecision === true ? 'true' : 'false'} sampleSize=${cloneOut?.sampleSize ?? 0} denominator=${cloneOut?.denominator ?? 0}`);
  console.log(`[COREY-CLONE] status=${cloneOut?.status || 'BLOCKED'} usableForDecision=${cloneOut?.usableForDecision === true ? 'true' : 'false'}`);
  if (coreyOut && typeof coreyOut === 'object') coreyOut.clone = cloneOut;

  const [spideyOut, macroOut, rendererOut] = await Promise.all([
    safeCall(() => spideyRun(symbol, opts), 'spidey'),
    safeCall(() => macroRun(symbol, opts), 'macro'),
    safeCall(() => (renderer && typeof renderer.runRenderer === 'function')
      ? renderer.runRenderer(symbol, opts)
      : null, 'renderer'),
  ]);

  // Determine source status per engine via contracts
  const sourceStatus = {
    spidey: statusFromValidation(spideyOut ? validatePacket(spideyOut, 'SpideyOutput') : null),
    corey: statusFromValidation(coreyOut ? validatePacket(coreyOut, 'CoreyOutput') : null),
    coreyClone: cloneOut && cloneOut.usableForDecision === true ? 'ACTIVE' : (cloneOut && cloneOut.status === 'PARTIAL' ? 'PARTIAL' : 'UNAVAILABLE'),
    macro: statusFromValidation(macroOut ? validatePacket(macroOut, 'MacroOutput') : null),
  };

  // Build Jane input packet — slots always occupied
  const janeInput = {
    symbol,
    timestamp,
    spidey: spideyOut,
    corey: coreyOut,
    coreyMacro: macroIntelligencePacket,
    coreyClone: cloneOut || { status: 'UNAVAILABLE', reason: 'engine returned null', symbol, timestamp },
    macro: macroOut,
    rendererArtefacts: rendererOut,
    sourceStatus,
    engineStatusSummary: {
      corey: sourceStatus.corey,
      coreyClone: sourceStatus.coreyClone,
      spidey: sourceStatus.spidey,
      macro: sourceStatus.macro,
    },
  };

  const inputValidation = validatePacket(janeInput, 'JaneInputPacket');
  if (!inputValidation.valid) {
    console.warn('[orchestrator] JaneInputPacket validation warnings:', inputValidation.errors.join('; '));
  }

  // Jane decides
  const decision = await runJane(janeInput, opts);
  console.log(`[JANE] macro_packet_received=${!!macroIntelligencePacket}`);
  console.log(`[JANE] corey_clone_received=${!!cloneOut}`);
  console.log(`[JANE] spidey_status=${spideyOut ? 'ACTIVE' : 'BLOCKED'}`);
  console.log(`[JANE] final_state=${decision && (decision.actionState || decision.tradeViability || decision.finalBias) || 'unknown'}`);
  console.log(`[JANE] received_inputs corey=${!!coreyOut} coreyClone=${cloneOut?.status || 'BLOCKED'} coreyCloneUsable=${cloneOut?.usableForDecision === true ? 'true' : 'false'} spidey=${!!spideyOut}`);
  return decision;
}

module.exports = { runAnalysis };
