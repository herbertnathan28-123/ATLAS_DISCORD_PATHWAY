'use strict';
// SPEC B — Macro / Roadmap Master Brief v2.0 (locked).
// Section 1 (Chart 2x2) is delivered as image attachment by index.js, not text.
//
// Per the locked dashboard/macro wording standard:
//   - FORWARD EXPECTATION is DELETED as a standalone section. Useful logic
//     folds into Trade Status / Market Overview / Validity.
//   - TRIGGER MAP is DELETED as a standalone section. Useful logic folds
//     into Execution Logic (buyer / seller / price confirmation copy).
//   - FINAL VERDICT / FINAL READ does NOT exist as a separate section —
//     final assessment is merged inside Trade Status.
//   - VERIFICATION is renamed to VALIDITY.
//   - ROADMAP is a real link only (no embedded full content).
//   - EVENT INTELLIGENCE is renamed to "GLOBAL / EVENT INTELLIGENCE".

const LOCKED_ORDER = [
  'livePlan',           // §2 Trade Status / Final Assessment (merged)
  'priceTable',         // §3 PRICE TABLE — ANALYSED TARGETS
  'roadmapLink',        // §4 Roadmap Link (real link only)
  'eventIntel',         // §5 GLOBAL / EVENT INTELLIGENCE
  'marketOverview',     // §6 Market Overview
  'catalysts',          // §7 Events / Catalysts
  'historical',         // §8 Historical Context
  'execution',          // §9 Execution Logic (folds Trigger Map confirmation copy)
  'validity'            // §10 Validity
];

function assemble(order, sections) {
  const out = [];
  for (const key of order) {
    const block = sections[key];
    if (block == null || block === '') continue;
    out.push(block);
  }
  return out.join('\n\n');
}

module.exports = { LOCKED_ORDER, assemble };
