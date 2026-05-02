'use strict';
// §5 doctrine: decisive states only. Replaces vague "WAIT / LIGHT PARTICIPATION ONLY" / "if confirmed" language.

const STATES = Object.freeze({
  TRADE_CONFIRMED:           'TRADE CONFIRMED',
  ENTRY_AUTHORISED:          'ENTRY AUTHORISED',
  ARMED_WAITING_TRIGGER:     'ARMED — WAITING FOR TRIGGER',
  ENTRY_NOT_AUTHORISED:      'ENTRY NOT AUTHORISED',
  DO_NOT_TRADE:              'DO NOT TRADE',
  HOLD_CONDITIONS_NOT_BUILT: 'HOLD — CONDITIONS NOT BUILT',
  CONDITIONS_BUILDING:       'CONDITIONS BUILDING',
  TRIGGER_APPROACHING:       'TRIGGER APPROACHING'
});

function resolve({ janeVerdict, missing, eventBlock, structureAgreement }) {
  const m = missing || [];
  if (janeVerdict === 'BLOCK')                   return { state: STATES.DO_NOT_TRADE,              missing: m };
  if (eventBlock === 'BLOCK')                    return { state: STATES.ENTRY_NOT_AUTHORISED,      missing: ['high-impact event window active'].concat(m) };
  if (janeVerdict === 'HOLD' && m.length)        return { state: STATES.HOLD_CONDITIONS_NOT_BUILT, missing: m };
  if (janeVerdict === 'BUILD')                   return { state: STATES.CONDITIONS_BUILDING,        missing: m };
  if (janeVerdict === 'APPROACH')                return { state: STATES.TRIGGER_APPROACHING,        missing: m };
  if (janeVerdict === 'ARMED')                   return { state: STATES.ARMED_WAITING_TRIGGER,      missing: m };
  if (janeVerdict === 'GO' && structureAgreement) return { state: STATES.ENTRY_AUTHORISED,           missing: [] };
  if (janeVerdict === 'GO')                      return { state: STATES.TRADE_CONFIRMED,            missing: [] };
  return { state: STATES.HOLD_CONDITIONS_NOT_BUILT, missing: m.length ? m : ['decision inputs incomplete'] };
}

module.exports = { STATES, resolve };
