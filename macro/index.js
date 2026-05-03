'use strict';
// ATLAS FX — Macro v3 entry point
// Locked output order per CLAUDE.md §3 + the 2026-05-02 macro rebuild spec.
// Single public function: buildMacroV3({ symbol, ctx, structure, calendar, charts, fmp, history, darkHorse }) -> string

const { LOCKED_ORDER, assemble } = require('./orderedSections');
const livePlan           = require('./livePlan');
const forwardExpectation = require('./forwardExpectation');
const triggerMap         = require('./triggerMap');
const priceTable         = require('./priceTable');
const roadmapLink        = require('./roadmapLink');
const eventIntelligence  = require('./eventIntelligence');
const marketOverview     = require('./marketOverview');
const catalysts          = require('./catalysts');
const historicalContext  = require('./historicalContext');
const executionLogic     = require('./executionLogic');
const validity           = require('./validity');
const language           = require('./language');
const glossary           = require('./glossary');
const contradictionCheck = require('./contradictionCheck');
const fmpAdapter         = require('./fmpAdapter');

async function buildMacroV3(input) {
  const tagsUsed = [];
  const ctx2 = Object.assign({}, input, { tagsUsed });
  const sections = {
    livePlan:           livePlan.build(ctx2),
    forwardExpectation: forwardExpectation.build(ctx2),
    triggerMap:         triggerMap.build(ctx2),
    priceTable:         priceTable.build(ctx2),
    roadmapLink:        roadmapLink.build(ctx2),
    eventIntel:         eventIntelligence.build(ctx2),
    marketOverview:     marketOverview.build(ctx2),
    catalysts:          catalysts.build(ctx2),
    historical:         historicalContext.build(ctx2),
    execution:          executionLogic.build(ctx2),
    validity:           validity.build(ctx2)
  };
  let text = assemble(LOCKED_ORDER, sections);
  const tail = glossary.footer(tagsUsed);
  if (tail) text += '\n\n' + tail;
  text = language.scrub(text);

  // Spec Part 15 — contradiction checker on the assembled string.
  const struct = input.structure || {};
  const qa = contradictionCheck.check(text, {
    symbol:           input.symbol,
    assetClass:       struct.assetClass || inferClass(input.symbol),
    blocked:          /DO NOT TRADE|TRADE INVALID|ENTRY NOT AUTHORISED|WAIT — NO TRADE/i.test(text),
    readiness:        struct.readiness != null ? struct.readiness : null,
    vol:              input.ctx && input.ctx.vix && input.ctx.vix.level,
    entryZone:        struct.entry,
    macroBias:        input.ctx && input.ctx.dxy && input.ctx.dxy.bias,
    catalystInside2h: /high-impact event in [\d.]+h.*entry blocked/i.test(text),
    requestedSymbol:  input.symbol,
    renderedSymbol:   input.symbol
  });
  if (!qa.ok) {
    console.error('[PRESENTER-QA] fail reason=' + qa.reason);
    text += '\n\n*Presenter QA flagged contradiction:* `' + qa.reason + '` — text shown for transparency.';
  } else {
    console.log('[PRESENTER-QA] pass');
  }
  return text;
}

function inferClass(sym) {
  if (!sym) return 'unknown';
  const s = String(sym).toUpperCase();
  if (/^[A-Z]{6}$/.test(s)) return 'fx';
  if (/^(NAS100|US500|US30|DJI|GER40|UK100|SPX|NDX|HK50|JPN225)$/.test(s)) return 'index';
  if (/XAU|XAG|OIL|BRENT|WTI|NATGAS/.test(s)) return 'commodity';
  if (/^[A-Z]{1,5}$/.test(s)) return 'equity';
  return 'unknown';
}

module.exports = { buildMacroV3, fmpAdapter };
