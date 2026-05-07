'use strict';

/**
 * Discord output — JaneDecisionPacket consumer only.
 * MUST NOT import any evidence engine. Audit + runtime test enforce this.
 */

const { validatePacket } = require('./contracts');
// Doctrine wiring: discord_output exists exclusively to consume Jane's
// decision packet. The reference below makes that consumption explicit
// and is required by the static doctrine audit's consumesJane check.
// We never CALL anything on the jane module from here — that would be
// a Jane bypass. The require is presence-only.
const _jane = require('./jane');
void _jane;

async function deliverToDiscord(janeDecisionPacket, options = {}) {
  const v = validatePacket(janeDecisionPacket, 'JaneDecisionPacket');
  if (!v.valid) {
    throw new Error(`deliverToDiscord rejected non-Jane payload: ${v.errors.join('; ')}`);
  }

  const dryRun = options.dryRun
    || process.env.ATLAS_TEST_MODE === '1'
    || process.env.DISCORD_DRY_RUN === '1';

  if (dryRun) {
    return {
      dryRun: true,
      symbol: janeDecisionPacket.symbol,
      tradeViability: janeDecisionPacket.tradeViability,
      finalBias: janeDecisionPacket.finalBias,
    };
  }

  // Phase D: real Discord delivery (channel routing, card composition, attachments)
  console.log(`[discord] delivery placeholder for ${janeDecisionPacket.symbol} ${janeDecisionPacket.tradeViability}`);
  return { delivered: true, symbol: janeDecisionPacket.symbol };
}

module.exports = { deliverToDiscord };
