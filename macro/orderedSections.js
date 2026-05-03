'use strict';
// §3 Locked Macro Order. Section 1 (Chart 2x2) is delivered as image attachment by index.js, not text.

const LOCKED_ORDER = [
  'livePlan',           // §2 + §11 Trade Status / Live Plan (Final Assessment merged)
  'forwardExpectation', // Spec Part 5 — Forward Expectation block
  'triggerMap',         // Spec Part 6 — Trigger Map
  'priceTable',         // §3 Price Table / Execution Map
  'roadmapLink',        // §4 Roadmap Link
  'eventIntel',         // §5 Global / Event Intelligence Block
  'marketOverview',     // §6 Market Overview
  'catalysts',          // §7 Events / Catalysts
  'historical',         // §8 Historical Context
  'execution',          // §9 Execution Logic (IF/THEN)
  'validity'            // §10 Validity (Final Assessment lives inside livePlan)
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
