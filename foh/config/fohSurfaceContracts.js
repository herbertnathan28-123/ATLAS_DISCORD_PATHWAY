'use strict';

// Final FOH country contracts. Shared engines can feed every country,
// but Discord text is validated only after an explicit surface route.

const SURFACES = Object.freeze({
  MARKET_INTEL: 'market_intel',
  DARK_HORSE: 'dark_horse',
  MACRO_COMMAND: 'macro_command',
});

const CONTRACTS = Object.freeze({
  market_intel: {
    route: 'surface=market_intel',
    packetAdapter: 'foh/buildMarketIntelPacket -> foh/adapters/marketIntelViewModel',
    discordRenderer: 'foh/surfaceRouter.renderSurfaceOutput(surface=market_intel) -> foh/surfaces/marketIntelText',
    fallback: 'coreyMarketIntel._marketIntelDegradedNotice',
    allowedSections: [
      'NEW MARKET INTEL REPORT',
      'THE CALL',
      'HIGH-IMPACT CALENDAR EVENTS',
      'ROADMAP INTEL',
      'MARKET IMPACT / SCENARIO PATHS',
      'SOURCE NOTE',
      'END OF MARKET INTEL REPORT',
    ],
    bannedPatterns: [
      /\bNEW DARK HORSE SCAN\b/i,
      /\b0 standouts\b/i,
      /\bstandouts? on this scan\b/i,
      /\bpre-radar\b/i,
      /\bwhere to act\b/i,
      /\bDark Horse scanner\b/i,
      /\bnext Dark Horse scan\b/i,
      /\bno Dark Horse entry priority\b/i,
    ],
    requiredPatterns: [
      /\bNEW MARKET INTEL REPORT\b/,
      /\bTHE CALL\b/,
      /\bSOURCE NOTE\b/,
      /\bEND OF MARKET INTEL REPORT\b/,
    ],
  },
  dark_horse: {
    route: 'surface=dark_horse',
    packetAdapter: 'foh/buildDarkHorsePacket -> foh/adapters/darkHorseViewModel',
    discordRenderer: 'foh/surfaceRouter.renderSurfaceOutput(surface=dark_horse) -> foh/surfaces/darkHorseText',
    fallback: 'darkHorseEngine.buildDarkHorseDegradedSummary',
    allowedSections: [
      'NEW DARK HORSE SCAN',
      'Market Mood',
      'CURRENT ADVICE — AT RELEASE',
      'Why nothing promoted',
      'Building / Pre-Radar',
      'What would promote a candidate next',
      'What cancels the watch',
      'Next review / next scan',
      'Source / engine status',
      'END DARK HORSE SCAN',
    ],
    bannedPatterns: [
      /\bTHE CALL\b/i,
      /\bTODAY[’']S RANKED EVENT CALENDAR\b/i,
      /\bBroader market calendar\b/i,
      /\bselected-symbol release\b/i,
      /\bFull Brief\b/i,
      /\bBrief Pending\b/i,
      /\bMarket Intel Daily Roadmap\b/i,
      /\bHigh-impact calendar events\b/i,
    ],
    requiredPatterns: [
      /\bNEW DARK HORSE SCAN\b/,
      /\bMarket Mood\b/i,
      /\bCURRENT ADVICE\b/,
      /\bEND (?:OF )?DARK HORSE SCAN\b/,
    ],
  },
  macro_command: {
    route: 'surface=macro_command',
    packetAdapter: 'macro/searchMacro context packet',
    discordRenderer: 'macro/searchMacro.formatSearchResponse -> foh/surfaceRouter.renderSurfaceOutput(surface=macro_command)',
    fallback: 'macro/searchMacro source/degradation note',
    allowedSections: [
      'NEW MACRO COMMAND REPORT',
      'JANE STATE',
      'MARKET CONTEXT',
      'STRUCTURE STATUS',
      'COREY CLONE STATUS',
      'MARKET IMPACT',
      'CURRENT ADVICE / MONITORING STATE',
      'SOURCE / DEGRADATION NOTE',
      'END OF MACRO COMMAND REPORT',
    ],
    bannedPatterns: [
      /\bNEW DARK HORSE SCAN\b/i,
      /\b0 standouts\b/i,
      /\bNo standout candidates\b/i,
      /\bNo standouts this scan\b/i,
      /\bFull Brief\b/i,
      /\bBrief Pending\b/i,
      /\bTODAY[’']S RANKED EVENT CALENDAR\b/i,
      /\bMARKET INTEL RENDER DEGRADED\b/i,
      /\bDARK HORSE RENDER DEGRADED\b/i,
    ],
    requiredPatterns: [
      /\bNEW MACRO COMMAND REPORT\b/,
      /\bScenario paths:/,
      /\bSOURCE \/ DEGRADATION NOTE\b/,
      /\bEND OF MACRO COMMAND REPORT\b/,
    ],
  },
});

function getSurfaceContract(surface) {
  const key = String(surface || '').trim();
  return CONTRACTS[key] || null;
}

function validateSurfaceText(surface, text) {
  const contract = getSurfaceContract(surface);
  const failures = [];
  if (!contract) {
    return { ok: false, failures: ['unknown_surface:' + String(surface || '')], contract: null };
  }
  const body = String(text || '');
  for (const re of contract.requiredPatterns) {
    if (!re.test(body)) failures.push('missing_required:' + re.toString());
  }
  for (const re of contract.bannedPatterns) {
    if (re.test(body)) failures.push('banned_cross_surface:' + re.toString());
  }
  return { ok: failures.length === 0, failures, contract };
}

module.exports = {
  SURFACES,
  CONTRACTS,
  getSurfaceContract,
  validateSurfaceText,
};
