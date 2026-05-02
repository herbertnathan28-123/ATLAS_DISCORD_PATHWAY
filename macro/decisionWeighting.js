'use strict';
// §10 Corey 40 / Spidey 40 / event-override 20 reconciliation -> Jane verdict.

function reconcile({ corey, spidey, eventOverride }) {
  const c = clamp(corey?.score   ?? 0, -1, 1);
  const s = clamp(spidey?.score  ?? 0, -1, 1);
  const e = clamp(eventOverride?.score ?? 0, -1, 1);
  const composite = 0.40 * c + 0.40 * s + 0.20 * e;
  const agreement = Math.sign(c) === Math.sign(s) && Math.abs(c) > 0.15 && Math.abs(s) > 0.15;
  let verdict;
  if (eventOverride?.permission === 'BLOCK')        verdict = 'BLOCK';
  else if (Math.abs(composite) >= 0.55 && agreement) verdict = 'GO';
  else if (Math.abs(composite) >= 0.35 && agreement) verdict = 'ARMED';
  else if (Math.abs(composite) >= 0.20)              verdict = 'APPROACH';
  else if (Math.abs(composite) >= 0.10)              verdict = 'BUILD';
  else                                               verdict = 'HOLD';
  return { composite, verdict, agreement, weights: { corey: 0.40, spidey: 0.40, event: 0.20 } };
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

module.exports = { reconcile };
