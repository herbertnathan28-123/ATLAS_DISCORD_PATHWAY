'use strict';

const PROBABILITY_LABEL = Object.freeze({
  HISTORICALLY_SOURCED: 'historically sourced',
  ENGINE_DERIVED: 'engine-derived',
  FORMULA_DERIVED: 'formula-derived',
  PENDING_HISTORICAL_VALIDATION: 'pending historical validation'
});

function isFiniteProbability(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function normaliseBasis(basis) {
  return String(basis || '').trim().toLowerCase().replace(/_/g, '-');
}

function isHistoricalBasis(basis) {
  const normalisedBasis = normaliseBasis(basis);
  return normalisedBasis === 'historical'
    || normalisedBasis === 'historically-sourced'
    || normalisedBasis === 'verified-historical';
}

function labelProbability(value, basis) {
  const normalisedBasis = normaliseBasis(basis);

  if (!isFiniteProbability(value)) {
    return { value: null, label: PROBABILITY_LABEL.PENDING_HISTORICAL_VALIDATION };
  }

  if (isHistoricalBasis(basis)) {
    return { value: Number(value), label: PROBABILITY_LABEL.HISTORICALLY_SOURCED };
  }

  if (normalisedBasis === 'formula' || normalisedBasis === 'formula-derived') {
    return { value: Number(value), label: PROBABILITY_LABEL.FORMULA_DERIVED };
  }

  if (normalisedBasis === 'engine' || normalisedBasis === 'engine-derived') {
    return { value: Number(value), label: PROBABILITY_LABEL.ENGINE_DERIVED };
  }

  return { value: null, label: PROBABILITY_LABEL.PENDING_HISTORICAL_VALIDATION };
}

function pendingHistoricalValidation() {
  return { value: null, label: PROBABILITY_LABEL.PENDING_HISTORICAL_VALIDATION };
}

function labelFourWayProbabilities(input) {
  const probabilities = input && input.probabilities ? input.probabilities : {};
  const basis = input && input.basis ? input.basis : {};

  return {
    above: isFiniteProbability(probabilities.above)
      ? labelProbability(probabilities.above, basis.above)
      : pendingHistoricalValidation(),
    below: isFiniteProbability(probabilities.below)
      ? labelProbability(probabilities.below, basis.below)
      : pendingHistoricalValidation(),
    inLine: (isFiniteProbability(probabilities.inLine) && isHistoricalBasis(basis.inLine))
      ? labelProbability(probabilities.inLine, basis.inLine)
      : pendingHistoricalValidation(),
    reversal: (isFiniteProbability(probabilities.reversal) && isHistoricalBasis(basis.reversal))
      ? labelProbability(probabilities.reversal, basis.reversal)
      : pendingHistoricalValidation()
  };
}

module.exports = {
  PROBABILITY_LABEL,
  labelProbability,
  labelFourWayProbabilities,
  pendingHistoricalValidation
};
