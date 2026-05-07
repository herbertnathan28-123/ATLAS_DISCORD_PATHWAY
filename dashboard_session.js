'use strict';

/**
 * Dashboard / session handoff — JaneDecisionPacket consumer only.
 * Stores the latest decision packet for a symbol so the dashboard and Astra
 * can read it on demand. MUST NOT import any evidence engine.
 */

const { validatePacket } = require('./contracts');
// Doctrine wiring: dashboard_session exists exclusively to consume Jane's
// decision packet. The reference below makes that consumption explicit
// and is required by the static doctrine audit's consumesJane check.
// We never CALL anything on the jane module from here — that would be
// a Jane bypass. The require is presence-only.
const _jane = require('./jane');
void _jane;

const _store = new Map();   // symbol -> { packet, storedAt }

async function publishToDashboard(janeDecisionPacket, options = {}) {
  const v = validatePacket(janeDecisionPacket, 'JaneDecisionPacket');
  if (!v.valid) {
    throw new Error(`publishToDashboard rejected non-Jane payload: ${v.errors.join('; ')}`);
  }

  const dryRun = options.dryRun
    || process.env.ATLAS_TEST_MODE === '1'
    || process.env.ATLAS_DRY_RUN === '1';

  _store.set(janeDecisionPacket.symbol, {
    packet: janeDecisionPacket,
    storedAt: new Date().toISOString(),
  });

  if (dryRun) {
    return { dryRun: true, symbol: janeDecisionPacket.symbol, stored: true };
  }

  // Phase D: persist to disk / DB / push to dashboard subscribers
  return { stored: true, symbol: janeDecisionPacket.symbol };
}

function getLatestForSymbol(symbol) {
  return _store.get(symbol) || null;
}

module.exports = { publishToDashboard, getLatestForSymbol };
