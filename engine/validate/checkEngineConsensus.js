'use strict';

// ============================================================
// engine/validate/checkEngineConsensus.js
//
// Operator brief 2026-05-17 (assurance directive): cross-engine
// consensus over Corey / Spidey / Jane / Corey Clone.
//
// Consensus states:
//   ALIGNED    — every engine agrees on direction + risk
//   MIXED      — agreement on direction but disagreement on risk/quality
//   CONFLICTED — Corey + Spidey disagree on direction
//   PARTIAL    — at least one engine is PARTIAL but no hard conflict
//   BLOCKED    — at least one critical engine (Corey OR Spidey OR Jane) is BLOCKED
//
// Output drives FOH packet's consensus surface so the user sees
// conflicts plainly rather than getting a clean action that hides
// engine disagreement.
// ============================================================

function _bias(s) { return String((s && s.bias) || '').toUpperCase(); }
function _status(s) { return String((s && s.status) || 'BLOCKED').toUpperCase(); }

function checkEngineConsensus(engineStatuses) {
  const corey = engineStatuses && engineStatuses.corey ? engineStatuses.corey : { status: 'BLOCKED' };
  const spidey = engineStatuses && engineStatuses.spidey ? engineStatuses.spidey : { status: 'BLOCKED' };
  const jane = engineStatuses && engineStatuses.jane ? engineStatuses.jane : { status: 'BLOCKED' };
  const clone = engineStatuses && engineStatuses.coreyClone ? engineStatuses.coreyClone : { status: 'BLOCKED' };

  // Any critical engine BLOCKED → consensus BLOCKED.
  if (_status(corey) === 'BLOCKED' || _status(spidey) === 'BLOCKED' || _status(jane) === 'BLOCKED') {
    return {
      state: 'BLOCKED',
      narrative: 'One or more critical engines (Corey, Spidey, Jane) is BLOCKED — ATLAS cannot create an actionable state until the upstream intelligence completes.',
      engines: { corey: _status(corey), spidey: _status(spidey), jane: _status(jane), coreyClone: _status(clone) },
      details: {
        coreyMissing: corey.missingInputs || [],
        spideyMissing: spidey.missingInputs || [],
        janeMissing: jane.missingInputs || [],
      },
    };
  }

  // Direction conflict: Corey macro bias vs Spidey structure bias.
  const coreyBias = _bias(corey);
  const spideyBias = _bias(spidey);
  if (coreyBias && spideyBias && coreyBias !== spideyBias) {
    return {
      state: 'CONFLICTED',
      narrative: 'Macro risk supports ' + coreyBias.toLowerCase() + ' bias, but current structure has not confirmed ' + coreyBias.toLowerCase() + ' continuation (Spidey reads ' + spideyBias.toLowerCase() + '). ATLAS remains monitoring-only until structure confirms in agreement with the macro tape.',
      engines: { corey: _status(corey), spidey: _status(spidey), jane: _status(jane), coreyClone: _status(clone) },
      coreyBias,
      spideyBias,
    };
  }

  // PARTIAL: any engine is PARTIAL but no hard conflict.
  if (_status(corey) === 'PARTIAL' || _status(spidey) === 'PARTIAL' || _status(jane) === 'PARTIAL' || _status(clone) === 'PARTIAL') {
    const partialEngines = [];
    if (_status(corey)  === 'PARTIAL') partialEngines.push('Corey');
    if (_status(spidey) === 'PARTIAL') partialEngines.push('Spidey');
    if (_status(jane)   === 'PARTIAL') partialEngines.push('Jane');
    if (_status(clone)  === 'PARTIAL') partialEngines.push('Corey Clone');
    return {
      state: 'PARTIAL',
      narrative: 'Engines aligned but ' + partialEngines.join(' / ') + ' returned PARTIAL intelligence. Read the briefing with the degradation note in mind; action remains valid but at reduced confidence.',
      engines: { corey: _status(corey), spidey: _status(spidey), jane: _status(jane), coreyClone: _status(clone) },
      partialEngines,
    };
  }

  // MIXED: every engine OK but disagreement on event risk / quality.
  // (Light-weight check — caller can pass additional risk fields to
  //  this module if desired.)
  const cRisk = String((corey && corey.eventRisk) || '').toUpperCase();
  const jRisk = String((jane && jane.eventRisk) || '').toUpperCase();
  if (cRisk && jRisk && cRisk !== jRisk) {
    return {
      state: 'MIXED',
      narrative: 'Corey reports event risk ' + cRisk + ' but Jane reports ' + jRisk + '. Direction agreement holds; treat the higher risk read as the operating constraint.',
      engines: { corey: _status(corey), spidey: _status(spidey), jane: _status(jane), coreyClone: _status(clone) },
    };
  }

  return {
    state: 'ALIGNED',
    narrative: 'All four engines aligned on direction and risk; consensus is clean.',
    engines: { corey: _status(corey), spidey: _status(spidey), jane: _status(jane), coreyClone: _status(clone) },
  };
}

module.exports = { checkEngineConsensus };
