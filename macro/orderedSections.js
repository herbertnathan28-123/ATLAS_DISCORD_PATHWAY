'use strict';
// §3 Locked Macro Order. Section 1 (Chart 2x2) is delivered as image attachment by index.js, not text.

const LOCKED_ORDER = [
  'livePlan',         // §2 Trade Status / Live Plan (Final Assessment merged inside)
  'priceTable',       // §3 Price Table / Price Matrix
  'roadmapLink',      // §4 Roadmap Link
  'eventIntel',       // §5 Global / Event Intelligence Block
  'marketOverview',   // §6 Market Overview
  'catalysts',        // §7 Events / Catalysts
  'historical',       // §8 Historical Context
  'execution',        // §9 Execution Logic
  'validity'          // §10 Validity / Final Assessment (footer)
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
