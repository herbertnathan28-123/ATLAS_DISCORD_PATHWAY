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
const { coreyCloneRun } = require('./corey_clone');
const { macroRun } = require('./macro');
const { runJane } = require('./jane');
const { validatePacket, statusFromValidation } = require('./contracts');

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

  // Parallel — evidence engines + renderer artefacts
  const [spideyOut, coreyOut, cloneOut, macroOut, rendererOut] = await Promise.all([
    safeCall(() => spideyRun(symbol, opts), 'spidey'),
    safeCall(() => coreyRun(symbol, opts), 'corey'),
    safeCall(() => coreyCloneRun(symbol, opts), 'coreyClone'),
    safeCall(() => macroRun(symbol, opts), 'macro'),
    safeCall(() => (renderer && typeof renderer.runRenderer === 'function')
      ? renderer.runRenderer(symbol, opts)
      : null, 'renderer'),
  ]);

  // Determine source status per engine via contracts
  const sourceStatus = {
    spidey: statusFromValidation(spideyOut ? validatePacket(spideyOut, 'SpideyOutput') : null),
    corey: statusFromValidation(coreyOut ? validatePacket(coreyOut, 'CoreyOutput') : null),
    coreyClone: statusFromValidation(cloneOut ? validatePacket(cloneOut, 'CoreyCloneOutput') : null),
    macro: statusFromValidation(macroOut ? validatePacket(macroOut, 'MacroOutput') : null),
  };

  // Build Jane input packet — slots always occupied
  const janeInput = {
    symbol,
    timestamp,
    spidey: spideyOut,
    corey: coreyOut,
    coreyClone: cloneOut || { status: 'UNAVAILABLE', reason: 'engine returned null', symbol, timestamp },
    macro: macroOut,
    rendererArtefacts: rendererOut,
    sourceStatus,
  };

  const inputValidation = validatePacket(janeInput, 'JaneInputPacket');
  if (!inputValidation.valid) {
    console.warn('[orchestrator] JaneInputPacket validation warnings:', inputValidation.errors.join('; '));
  }

  // Jane decides
  const decision = await runJane(janeInput, opts);
  return decision;
}

module.exports = { runAnalysis };
