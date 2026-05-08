'use strict';

/**
 * ATLAS FX — Corey Clone Phase D version constants.
 *
 * Spec authority: D.1.0.3 (locked 2026-05-08, accepted via implementation
 * authority message in the build thread).
 *
 * Rule:
 *   - spec-only edits (docs, comments, descriptive text) do NOT bump
 *     MATCHER_VERSION or OUTCOME_CLASSIFIER_VERSION.
 *   - algorithmic changes to the matcher or the outcome classifier DO
 *     require a version bump and a reproducibility re-run.
 */

const PHASE_D_SPEC_VERSION         = 'D.1.0.3';
const MATCHER_VERSION              = 'D.1.0.3';
const OUTCOME_CLASSIFIER_VERSION   = 'D.1.0.3';

module.exports = {
  PHASE_D_SPEC_VERSION,
  MATCHER_VERSION,
  OUTCOME_CLASSIFIER_VERSION,
};
