'use strict';
// Decisive states only. Operator-facing strings — no banned tokens
// (no AUTHORISED / TRIGGER / BLOCKED / WITHHELD / PERMITTED). Internal
// enum keys are preserved so existing call-sites keep working.

const STATES = Object.freeze({
  TRADE_CONFIRMED:           'TRADE CONFIRMED',
  ENTRY_AUTHORISED:          'ENTRY CONFIRMED',
  ARMED_WAITING_TRIGGER:     'ARMED — WAITING FOR CONFIRMATION',
  ENTRY_NOT_AUTHORISED:      'ENTRY NOT AVAILABLE',
  DO_NOT_TRADE:              'ENTRY CONDITIONS NOT MET — MONITOR FOR CONFIRMATION',
  HOLD_CONDITIONS_NOT_BUILT: 'HOLD — NO ACTIVE TRADE',
  CONDITIONS_BUILDING:       'CONDITIONS BUILDING',
  TRIGGER_APPROACHING:       'CONFIRMATION APPROACHING'
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
