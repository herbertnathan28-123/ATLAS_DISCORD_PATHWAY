'use strict';

const { SURFACES, validateSurfaceText } = require('./config/fohSurfaceContracts');
const { renderDarkHorseSurface } = require('./surfaces/darkHorseText');
const { renderMarketIntelSurface } = require('./surfaces/marketIntelText');
const { renderMacroCommandSurface } = require('./surfaces/macroCommandText');

function renderSurfaceOutput({ surface, packet, opts }) {
  const key = String(surface || '').trim();
  let text;
  switch (key) {
    case SURFACES.DARK_HORSE:
      text = renderDarkHorseSurface(packet || {}, opts || {});
      break;
    case SURFACES.MARKET_INTEL:
      text = renderMarketIntelSurface(packet || {}, opts || {});
      break;
    case SURFACES.MACRO_COMMAND:
      text = renderMacroCommandSurface(packet || {}, opts || {});
      break;
    default:
      throw new Error('Unknown FOH surface: ' + String(surface || ''));
  }

  const validation = validateSurfaceText(key, text);
  if (!validation.ok) {
    throw new Error('foh_surface_contract_failed:' + validation.failures.join('|'));
  }
  return text;
}

module.exports = { renderSurfaceOutput };
