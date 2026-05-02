'use strict';
// ATLAS FX — Macro v3 entry point
// Locked output order per CLAUDE.md §3 + the 2026-05-02 macro rebuild spec.
// Single public function: buildMacroV3({ symbol, ctx, structure, calendar, charts, fmp, history, darkHorse }) -> string

const { LOCKED_ORDER, assemble } = require('./orderedSections');
const livePlan          = require('./livePlan');
const priceTable        = require('./priceTable');
const roadmapLink       = require('./roadmapLink');
const eventIntelligence = require('./eventIntelligence');
const marketOverview    = require('./marketOverview');
const catalysts         = require('./catalysts');
const historicalContext = require('./historicalContext');
const executionLogic    = require('./executionLogic');
const validity          = require('./validity');
const language          = require('./language');
const glossary          = require('./glossary');
const fmpAdapter        = require('./fmpAdapter');

async function buildMacroV3(input) {
  const tagsUsed = [];
  const ctx2 = Object.assign({}, input, { tagsUsed });
  const sections = {
    livePlan:       livePlan.build(ctx2),
    priceTable:     priceTable.build(ctx2),
    roadmapLink:    roadmapLink.build(ctx2),
    eventIntel:     eventIntelligence.build(ctx2),
    marketOverview: marketOverview.build(ctx2),
    catalysts:      catalysts.build(ctx2),
    historical:     historicalContext.build(ctx2),
    execution:      executionLogic.build(ctx2),
    validity:       validity.build(ctx2)
  };
  let text = assemble(LOCKED_ORDER, sections);
  const tail = glossary.footer(tagsUsed);
  if (tail) text += '\n\n' + tail;
  return language.scrub(text);
}

module.exports = { buildMacroV3, fmpAdapter };
